/* ============================================
   bp2-playlist.js — Playlist Management
   Band Player v2.0

   WHAT IT DOES:
     Loads playlists from Firestore with role-based filtering.
     Loads song inventory. Batch-fetches songs for selected playlist.
     Set arrangement helpers. Playlist creation. Add songs to playlist.

   WHO CALLS IT:
     - BP2Core emits 'playlist:load' and 'inventory:load'
     - BP2Render reads playlists/songs from core state

   DEPENDENCIES:
     - bp2-core.js
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _getCore() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  // ── Set Arrangement Helpers (pure functions) ──

  function _migratePlaylistToSets(pl) {
    if (pl.sets && pl.sets.length > 0) return;
    if (pl.songOrder && pl.songOrder.length > 0) {
      pl.sets = [{ label: 'Set 1', intro: null, songs: pl.songOrder.slice(), outro: null }];
    } else {
      pl.sets = [{ label: 'Set 1', intro: null, songs: [], outro: null }];
    }
  }

  function _flattenSets(sets) {
    var flat = [];
    (sets || []).forEach(function(set, si) {
      if (set.intro) flat.push({ songId: set.intro, setIndex: si, position: 'intro' });
      (set.songs || []).forEach(function(id) {
        flat.push({ songId: id, setIndex: si, position: 'song' });
      });
      if (set.outro) flat.push({ songId: set.outro, setIndex: si, position: 'outro' });
    });
    return flat;
  }

  function _allSongIdsFromSets(sets) {
    var ids = {};
    (sets || []).forEach(function(set) {
      if (set.intro) ids[set.intro] = true;
      (set.songs || []).forEach(function(id) { ids[id] = true; });
      if (set.outro) ids[set.outro] = true;
    });
    return Object.keys(ids);
  }

  function _setsToSongOrder(sets) {
    var order = [];
    (sets || []).forEach(function(set) {
      if (set.intro) order.push(set.intro);
      (set.songs || []).forEach(function(id) { order.push(id); });
      if (set.outro) order.push(set.outro);
    });
    return order;
  }

  // ── Public API ───────────────────────────────
  var BP2Playlist = {
    // Pure helpers (exported for bp2-edit.js)
    migrateToSets: _migratePlaylistToSets,
    flattenSets: _flattenSets,
    allSongIdsFromSets: _allSongIdsFromSets,
    setsToSongOrder: _setsToSongOrder,

    init: function() {
      var c = _getCore();
      if (!c) return;

      c.on('playlist:load', function() { BP2Playlist.loadPlaylists(); });
      c.on('inventory:load', function() { BP2Playlist.loadInventory(); });
    },

    loadPlaylists: function() {
      var c = _getCore();
      if (!c || !c.getDb()) return;
      var db = c.getDb();
      var user = c.getUser();
      var isManager = c.isManager();

      db.collection('playlists').orderBy('createdAt', 'desc').get()
        .then(function(snap) {
          var playlists = [];
          snap.forEach(function(doc) {
            playlists.push(Object.assign({ id: doc.id }, doc.data()));
          });

          // Band members: filter to gig-linked playlists
          if (!isManager && user) {
            db.collection('gigs')
              .where('assignedMusicians', 'array-contains', user.uid)
              .where('status', '==', 'upcoming')
              .get()
              .then(function(gigsSnap) {
                var gigPlaylistIds = {};
                gigsSnap.forEach(function(doc) {
                  var gig = doc.data();
                  if (gig.playlistId) gigPlaylistIds[gig.playlistId] = true;
                });
                if (Object.keys(gigPlaylistIds).length > 0) {
                  playlists = playlists.filter(function(pl) {
                    return gigPlaylistIds[pl.id] || pl.isPublic;
                  });
                }
                c.set('playlists', playlists);
                c.emit('playlists:loaded', { playlists: playlists });
                if (playlists.length > 0) BP2Playlist.selectPlaylist(playlists[0].id);
                else c.emit('playlists:empty');
              })
              .catch(function() {
                c.set('playlists', playlists);
                c.emit('playlists:loaded', { playlists: playlists });
                if (playlists.length > 0) BP2Playlist.selectPlaylist(playlists[0].id);
                else c.emit('playlists:empty');
              });
            return;
          }

          c.set('playlists', playlists);
          c.emit('playlists:loaded', { playlists: playlists });
          if (playlists.length > 0) BP2Playlist.selectPlaylist(playlists[0].id);
          else c.emit('playlists:empty');
        })
        .catch(function(e) {
          console.error('[BP2Playlist] Failed to load playlists:', e);
          c.emit('playlists:error', { error: e });
        });
    },

    loadInventory: function() {
      var c = _getCore();
      if (!c || !c.getDb()) return;

      c.getDb().collection('songs').orderBy('createdAt', 'desc').get()
        .then(function(snap) {
          var inventory = [];
          var songsMap = c.ref('allSongsMap');
          snap.forEach(function(doc) {
            var data = Object.assign({ id: doc.id }, doc.data());
            inventory.push(data);
            songsMap[doc.id] = data;
          });
          c.set('inventory', inventory);
          console.log('[BP2Playlist] Inventory loaded: ' + inventory.length + ' songs');
        })
        .catch(function(e) {
          console.error('[BP2Playlist] Failed to load inventory:', e);
        });
    },

    selectPlaylist: function(playlistId) {
      var c = _getCore();
      if (!c) return;
      var playlists = c.ref('playlists');
      var pl = null;
      for (var i = 0; i < playlists.length; i++) {
        if (playlists[i].id === playlistId) { pl = playlists[i]; break; }
      }
      if (!pl) return;

      // Stop all playback
      c.emit('player:stop-all');
      c.set('isPlaying', false);
      c.set('currentIndex', -1);
      c.set('loggedThisSession', {});
      c.set('completedTracks', {});

      // Migrate legacy flat playlists to sets
      _migratePlaylistToSets(pl);
      c.set('currentPlaylist', pl);

      var playOrder = _flattenSets(pl.sets);
      var uniqueIds = _allSongIdsFromSets(pl.sets);

      if (uniqueIds.length === 0) {
        c.set('songs', []);
        c.set('playOrder', []);
        c.emit('playlist:selected', { playlistId: playlistId });
        return;
      }

      // Batch-fetch songs (Firestore in-queries max 10)
      var db = c.getDb();
      var batches = [];
      for (var b = 0; b < uniqueIds.length; b += 10) {
        batches.push(uniqueIds.slice(b, b + 10));
      }

      Promise.all(batches.map(function(batch) {
        return db.collection('songs').where(firebase.firestore.FieldPath.documentId(), 'in', batch).get();
      }))
      .then(function(snapshots) {
        var songMap = c.ref('allSongsMap');
        snapshots.forEach(function(snap) {
          snap.forEach(function(doc) {
            var data = Object.assign({ id: doc.id }, doc.data());
            songMap[doc.id] = data;
          });
        });

        var songs = [];
        var finalPlayOrder = [];
        playOrder.forEach(function(entry) {
          var song = songMap[entry.songId];
          if (song) {
            songs.push(song);
            finalPlayOrder.push(entry);
          }
        });

        c.set('songs', songs);
        c.set('playOrder', finalPlayOrder);
        c.emit('playlist:selected', { playlistId: playlistId });
      })
      .catch(function(e) {
        console.error('[BP2Playlist] Failed to load songs:', e);
      });
    },

    addSongToPlaylist: function(songId) {
      var c = _getCore();
      if (!c || !c.getDb()) return;
      var pl = c.ref('currentPlaylist');
      if (!pl) return;

      _migratePlaylistToSets(pl);
      var sets = pl.sets;
      var allIds = _allSongIdsFromSets(sets);
      if (allIds.indexOf(songId) !== -1) return;

      var lastSet = sets[sets.length - 1];
      lastSet.songs.push(songId);
      var flatOrder = _setsToSongOrder(sets);

      c.getDb().collection('playlists').doc(pl.id).update({
        sets: sets,
        songOrder: flatOrder,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function() {
        pl.songOrder = flatOrder;
        var songMap = c.ref('allSongsMap');
        var song = songMap[songId];
        if (song) {
          var songs = c.ref('songs');
          songs.push(song);
          var po = c.ref('playOrder');
          po.push({ songId: songId, setIndex: sets.length - 1, position: 'song' });
          c.emit('playlist:song-added', { songId: songId });
        }
      }).catch(function(e) {
        lastSet.songs.pop();
        if (typeof Toast !== 'undefined') Toast.error('Failed to add song: ' + e.message);
      });
    },

    // Ensure playlist permissions for a user
    ensurePermissions: function(uid) {
      var c = _getCore();
      if (!c || !c.getDb()) return;
      var db = c.getDb();

      db.collection('playlist-permissions').where('user_uid', '==', uid).limit(1).get()
        .then(function(snap) {
          if (snap.empty) BP2Playlist.grantDefaultPlaylists(uid);
        })
        .catch(function() {});
    },

    grantDefaultPlaylists: function(uid) {
      var c = _getCore();
      if (!c || !c.getDb()) return;
      var db = c.getDb();

      db.collection('playlists').where('isDefault', '==', true).get()
        .then(function(snap) {
          var batch = db.batch();
          snap.forEach(function(doc) {
            var permRef = db.collection('playlist-permissions').doc();
            batch.set(permRef, {
              user_uid: uid,
              playlist_id: doc.id,
              granted_at: firebase.firestore.FieldValue.serverTimestamp(),
              granted_by: 'system_onboarding'
            });
          });
          if (!snap.empty) return batch.commit();
        })
        .catch(function(err) {
          console.warn('[BP2Playlist] Failed to grant default playlists:', err.message);
        });
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Playlist;
  } else if (global) {
    global.BP2Playlist = BP2Playlist;
  }
})(typeof window !== 'undefined' ? window : this);
