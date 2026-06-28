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

      BP2Data.getPlaylists()
        .then(function(playlists) {
          // playlists is already the plain array of {id, ...} objects.

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
                if (playlists.length > 0) {
                  var lastId = null;
                  try { lastId = localStorage.getItem('bp2-last-playlist'); } catch (e) {}
                  var target = lastId && playlists.some(function(p) { return p.id === lastId; }) ? lastId : playlists[0].id;
                  BP2Playlist.selectPlaylist(target);
                }
                else c.emit('playlists:empty');
              })
              .catch(function() {
                c.set('playlists', playlists);
                c.emit('playlists:loaded', { playlists: playlists });
                if (playlists.length > 0) {
                  var lastId = null;
                  try { lastId = localStorage.getItem('bp2-last-playlist'); } catch (e) {}
                  var target = lastId && playlists.some(function(p) { return p.id === lastId; }) ? lastId : playlists[0].id;
                  BP2Playlist.selectPlaylist(target);
                }
                else c.emit('playlists:empty');
              });
            return;
          }

          c.set('playlists', playlists);
          c.emit('playlists:loaded', { playlists: playlists });
          if (playlists.length > 0) {
            // Restore last selected playlist if available
            var lastId = null;
            try { lastId = localStorage.getItem('bp2-last-playlist'); } catch (e) {}
            var target = lastId && playlists.some(function(p) { return p.id === lastId; }) ? lastId : playlists[0].id;
            BP2Playlist.selectPlaylist(target);
          }
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

      BP2Data.getSongs()
        .then(function(inventory) {
          var songsMap = c.ref('allSongsMap');
          inventory.forEach(function(data) {
            // data already has .id (plain object from the shim)
            songsMap[data.id] = data;
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

      // Persist selection so it restores on reload
      try { localStorage.setItem('bp2-last-playlist', playlistId); } catch (e) {}

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

      // Fetch songs for this playlist's ids via the read shim (the shim's
      // Firestore impl handles the in-query 10-batch chunking; the Supabase
      // impl does a single .in() — Postgres has no in-list limit).
      BP2Data.getSongsByIds(uniqueIds)
      .then(function(songsArr) {
        var songMap = c.ref('allSongsMap');
        songsArr.forEach(function(data) {
          // data already has .id (plain object from the shim)
          songMap[data.id] = data;
        });

        // Resolve artwork URLs for songs that have artworkPath.
        // Primary case (band-media/ relative paths) → Supabase signed URL.
        // Legacy gs:// / https:// values → guarded Firebase fallback.
        var supabase = c.getSupabase ? c.getSupabase() : null;
        var storage = c.getStorage ? c.getStorage() : null;
        Object.keys(songMap).forEach(function(sid) {
          var s = songMap[sid];
          if (!s.artworkPath || s.artworkUrl) return;
          var isLegacy = s.artworkPath.startsWith('gs://') || s.artworkPath.startsWith('https://');
          if (!isLegacy && supabase) {
            supabase.storage.from(c.supaBucket()).createSignedUrl(c.supaKey(s.artworkPath), 3600)
              .then(function(res) {
                if (res && res.data && res.data.signedUrl) {
                  s.artworkUrl = res.data.signedUrl;
                  c.emit('render:tracklist');
                }
              }).catch(function() { /* use fallback */ });
          } else if (isLegacy && storage) {
            // Legacy Firebase artwork (gs:// / https://) — leave on Firebase.
            storage.refFromURL(s.artworkPath).getDownloadURL().then(function(url) {
              s.artworkUrl = url;
              c.emit('render:tracklist');
            }).catch(function() { /* use fallback */ });
          }
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

    showCreatePlaylistModal: function() {
      var c = _getCore();
      if (!c || !c.getDb() || typeof Modal === 'undefined') return;
      var db = c.getDb();

      var gigsHtml = '<option value="">None</option>';
      // Pre-load upcoming gigs for "Link to Gig" dropdown (non-blocking)
      db.collection('gigs').where('status', '==', 'upcoming').orderBy('date', 'asc').get()
        .then(function(snap) {
          snap.forEach(function(doc) {
            var g = doc.data();
            var dateStr = g.date && g.date.toDate ? g.date.toDate().toLocaleDateString() : '';
            gigsHtml += '<option value="' + doc.id + '">' + (g.title || 'Gig') + (dateStr ? ' (' + dateStr + ')' : '') + '</option>';
          });
          var sel = document.getElementById('bp2-pl-gig');
          if (sel) sel.innerHTML = gigsHtml;
        }).catch(function() {});

      Modal.open({
        title: 'Create Playlist',
        size: 'sm',
        content:
          '<div style="display:flex;flex-direction:column;gap:12px;">' +
            '<div><label class="form-label">Playlist Name *</label><input id="bp2-pl-name" class="form-input" placeholder="e.g. Phyllis Hyman Tribute" /></div>' +
            '<div><label class="form-label">Description</label><input id="bp2-pl-desc" class="form-input" placeholder="e.g. 90-min tribute set" /></div>' +
            '<div><label class="form-label">Link to Gig</label><select id="bp2-pl-gig" class="form-input">' + gigsHtml + '</select></div>' +
            '<div><label class="form-label">Album Art URL (optional)</label><input id="bp2-pl-art-url" class="form-input" placeholder="https://..." /></div>' +
          '</div>',
        saveText: 'Create',
        onSave: function() {
          return BP2Playlist._handleCreatePlaylist();
        }
      });
      setTimeout(function() {
        var el = document.getElementById('bp2-pl-name');
        if (el) el.focus();
      }, 100);
    },

    _handleCreatePlaylist: function() {
      var c = _getCore();
      if (!c || !c.getDb()) return Promise.resolve();
      var db = c.getDb();
      var user = c.getUser();

      var name = (document.getElementById('bp2-pl-name') || {}).value || '';
      var desc = (document.getElementById('bp2-pl-desc') || {}).value || '';
      var gigId = (document.getElementById('bp2-pl-gig') || {}).value || '';
      var artUrl = (document.getElementById('bp2-pl-art-url') || {}).value || '';

      if (!name.trim()) {
        if (typeof Toast !== 'undefined') Toast.error('Playlist name is required');
        return Promise.resolve();
      }

      var plData = {
        name: name,
        title: name,
        description: desc,
        albumArt: artUrl,
        sets: [{ label: 'Set 1', intro: null, songs: [], outro: null }],
        songOrder: [],
        gigId: gigId || null,
        createdBy: user ? user.uid : 'pin',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      return db.collection('playlists').add(plData).then(function(ref) {
        if (gigId) {
          db.collection('gigs').doc(gigId).update({ playlistId: ref.id }).catch(function() {});
        }
        if (typeof Modal !== 'undefined') Modal.close();
        if (typeof Toast !== 'undefined') Toast.success('Playlist created: ' + name);
        plData.id = ref.id;
        var playlists = c.ref('playlists');
        playlists.unshift(plData);
        c.emit('playlists:loaded', { playlists: playlists });
        BP2Playlist.selectPlaylist(ref.id);
      }).catch(function(e) {
        if (typeof Toast !== 'undefined') Toast.error('Failed to create playlist: ' + e.message);
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

      var plName = pl.title || pl.name || 'playlist';
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
          c.emit('render:tracklist');
          if (typeof Toast !== 'undefined') Toast.success('Added to ' + plName);
        }
      }).catch(function(e) {
        lastSet.songs.pop();
        if (typeof Toast !== 'undefined') Toast.error('Failed to add to ' + plName + ': ' + e.message);
      });
    },

    addSongToPlaylistById: function(songId, playlistId) {
      var c = _getCore();
      if (!c || !c.getDb()) return;

      // Find the target playlist from the in-memory list
      var playlists = c.ref('playlists') || [];
      var pl = null;
      for (var i = 0; i < playlists.length; i++) {
        if (playlists[i].id === playlistId) { pl = playlists[i]; break; }
      }
      if (!pl) return;

      _migratePlaylistToSets(pl);
      var sets = pl.sets;
      var allIds = _allSongIdsFromSets(sets);
      if (allIds.indexOf(songId) !== -1) return;

      var lastSet = sets[sets.length - 1];
      lastSet.songs.push(songId);
      var flatOrder = _setsToSongOrder(sets);

      var plName = pl.title || pl.name || 'playlist';
      var isCurrent = c.ref('currentPlaylist') && c.ref('currentPlaylist').id === playlistId;

      c.getDb().collection('playlists').doc(pl.id).update({
        sets: sets,
        songOrder: flatOrder,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function() {
        pl.songOrder = flatOrder;
        // Only update the live tracklist if adding to the currently viewed playlist
        if (isCurrent) {
          var songMap = c.ref('allSongsMap');
          var song = songMap[songId];
          if (song) {
            var songs = c.ref('songs');
            songs.push(song);
            var po = c.ref('playOrder');
            po.push({ songId: songId, setIndex: sets.length - 1, position: 'song' });
            c.emit('playlist:song-added', { songId: songId });
            c.emit('render:tracklist');
          }
        }
        if (typeof Toast !== 'undefined') Toast.success('Added to ' + plName);
      }).catch(function(e) {
        lastSet.songs.pop();
        if (typeof Toast !== 'undefined') Toast.error('Failed to add to ' + plName + ': ' + e.message);
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

      BP2Data.getDefaultPlaylists()
        .then(function(defaults) {
          // defaults is the plain array of default playlist {id, ...} objects.
          // The playlist-permissions batch WRITE stays Firestore (writes never flip).
          var batch = db.batch();
          defaults.forEach(function(pl) {
            var permRef = db.collection('playlist-permissions').doc();
            batch.set(permRef, {
              user_uid: uid,
              playlist_id: pl.id,
              granted_at: firebase.firestore.FieldValue.serverTimestamp(),
              granted_by: 'system_onboarding'
            });
          });
          if (defaults.length > 0) return batch.commit();
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
