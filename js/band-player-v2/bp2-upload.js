/* ============================================
   bp2-upload.js — Song Upload Modal
   Band Player v2.0

   Upload modal: title, artist, audio file, lyrics, charts.
   Firebase Storage upload with progress. Song deletion.

   WHO CALLS IT:
     - bp2-render.js "Upload" manager button
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  var BP2Upload = {
    init: function() {
      var c = _c();
      if (!c) return;
      // Wired via manager button events — no automatic init needed
    },

    showUploadModal: function() {
      if (typeof Modal === 'undefined') return;
      Modal.open({
        title: 'Upload Song to Inventory',
        size: 'md',
        content:
          '<div style="display:flex;flex-direction:column;gap:14px;">' +
            '<div><label class="form-label">Song Title *</label><input id="bp2-u-title" class="form-input" placeholder="e.g. No One Can Love You More" /></div>' +
            '<div><label class="form-label">Artist</label><input id="bp2-u-artist" class="form-input" value="L.A. Young" /></div>' +
            '<div><label class="form-label">Audio File *</label><input id="bp2-u-audio" type="file" accept=".mp3,.m4a,.aac,.wav,.flac,audio/*" class="form-input" /></div>' +
            '<div><label class="form-label">Lyrics (optional)</label><textarea id="bp2-u-lyrics" class="form-input" rows="4" placeholder="Paste lyrics here..."></textarea></div>' +
            '<div id="bp2-u-progress" style="display:none;">' +
              '<div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:6px;">Uploading...</div>' +
              '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;">' +
                '<div id="bp2-u-progress-bar" style="height:100%;width:0%;background:#d4a017;border-radius:3px;transition:width 200ms;"></div>' +
              '</div>' +
            '</div>' +
          '</div>',
        saveText: 'Upload to Inventory',
        onSave: function() { return BP2Upload._handleUpload(); }
      });
      setTimeout(function() { var el = document.getElementById('bp2-u-title'); if (el) el.focus(); }, 100);
    },

    _handleUpload: function() {
      var c = _c();
      if (!c) return Promise.resolve();

      var title = (document.getElementById('bp2-u-title') || {}).value || '';
      var artist = (document.getElementById('bp2-u-artist') || {}).value || 'L.A. Young';
      var audioInput = document.getElementById('bp2-u-audio');
      var lyrics = (document.getElementById('bp2-u-lyrics') || {}).value || '';

      if (!title.trim()) { if (typeof Toast !== 'undefined') Toast.error('Song title is required'); return Promise.resolve(); }
      if (!audioInput || !audioInput.files || !audioInput.files[0]) { if (typeof Toast !== 'undefined') Toast.error('Select an audio file'); return Promise.resolve(); }

      var audioFile = audioInput.files[0];
      var ext = audioFile.name.split('.').pop().toLowerCase() || 'mp3';
      var songId = 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
      var audioPath = 'band-media/audio/' + songId + '.' + ext;

      var progDiv = document.getElementById('bp2-u-progress');
      var progBar = document.getElementById('bp2-u-progress-bar');
      if (progDiv) progDiv.style.display = '';

      var storage = c.getStorage();
      var db = c.getDb();
      if (!storage || !db) {
        if (typeof Toast !== 'undefined') Toast.error('Storage not available');
        return Promise.resolve();
      }

      return new Promise(function(resolve) {
        var uploadTask = storage.ref(audioPath).put(audioFile);
        uploadTask.on('state_changed',
          function(snap) {
            var pct = (snap.bytesTransferred / snap.totalBytes * 90);
            if (progBar) progBar.style.width = pct + '%';
          },
          function(error) {
            if (typeof Toast !== 'undefined') Toast.error('Upload failed: ' + error.message);
            if (progDiv) progDiv.style.display = 'none';
            resolve();
          },
          function() {
            if (progBar) progBar.style.width = '90%';
            var songData = {
              title: title,
              artist: artist,
              audioPath: audioPath,
              lyrics: lyrics || null,
              charts: null,
              duration: null,
              createdBy: c.getUser() ? c.getUser().uid : 'pin',
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            db.collection('songs').doc(songId).set(songData).then(function() {
              if (progBar) progBar.style.width = '100%';
              if (typeof Modal !== 'undefined') Modal.close();
              var saved = Object.assign({ id: songId }, songData);
              var songsMap = c.ref('allSongsMap');
              songsMap[songId] = saved;
              var inventory = c.ref('inventory');
              inventory.push(saved);
              if (typeof Toast !== 'undefined') Toast.success('Song uploaded: ' + title);
              resolve();
            }).catch(function(e) {
              if (typeof Toast !== 'undefined') Toast.error('Save failed: ' + e.message);
              if (progDiv) progDiv.style.display = 'none';
              resolve();
            });
          }
        );
      });
    },

    showInventory: function() {
      var c = _c();
      if (!c || typeof Modal === 'undefined') return;
      var songs = c.ref('inventory');

      if (!songs || songs.length === 0) {
        Modal.open({
          title: 'Song Inventory',
          size: 'md',
          content: '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);"><i class="fa-solid fa-box-open" style="font-size:32px;display:block;margin-bottom:10px;"></i>No songs uploaded yet.</div>',
          saveText: 'Close', onSave: function() { Modal.close(); }
        });
        return;
      }

      var esc = global.BP2Utils ? global.BP2Utils.esc : function(s) { return s; };
      var tc = global.BP2Utils ? global.BP2Utils.titleCase : function(s) { return s; };
      var html = '<div style="max-height:60vh;overflow-y:auto;">';
      songs.forEach(function(song) {
        html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
          '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;color:#e6edf3;">' + esc(tc(song.title)) + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">' + esc(song.artist || 'Unknown') + '</div></div>' +
          '<button data-action="delete-song" data-song="' + song.id + '" style="width:32px;height:32px;border-radius:6px;border:1px solid rgba(248,81,73,0.15);background:rgba(248,81,73,0.06);color:rgba(248,81,73,0.6);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-trash"></i></button>' +
        '</div>';
      });
      html += '</div>';
      Modal.open({ title: 'Song Inventory (' + songs.length + ')', size: 'md', content: html, saveText: 'Close', onSave: function() { Modal.close(); } });
    },

    showAddToPlaylistModal: function() {
      var c = _c();
      if (!c || typeof Modal === 'undefined') return;
      var allPlaylists = c.ref('playlists') || [];
      var currentPl = c.ref('currentPlaylist');
      if (allPlaylists.length === 0) {
        if (typeof Toast !== 'undefined') Toast.error('No playlists available');
        return;
      }
      var songs = c.ref('inventory') || [];
      if (songs.length === 0) {
        Modal.open({
          title: 'Add Song to Playlist',
          size: 'md',
          content: '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);"><i class="fa-solid fa-box-open" style="font-size:32px;display:block;margin-bottom:10px;"></i>No songs in inventory. Upload songs first.</div>',
          saveText: 'Close', onSave: function() { Modal.close(); }
        });
        return;
      }

      // Store target playlist — defaults to current, user can change
      BP2Upload._addTargetPlaylistId = currentPl ? currentPl.id : allPlaylists[0].id;

      var esc = global.BP2Utils ? global.BP2Utils.esc : function(s) { return s; };
      var tc = global.BP2Utils ? global.BP2Utils.titleCase : function(s) { return s; };

      // Playlist selector at top
      var html = '<div style="margin-bottom:14px;">';
      html += '<label style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;">Add to playlist:</label>';
      html += '<select id="bp2-add-target-pl" style="width:100%;margin-top:6px;padding:10px 12px;border-radius:6px;border:1px solid rgba(201,162,39,0.3);background:rgba(201,162,39,0.08);color:#d4a017;font-size:14px;font-weight:600;">';
      allPlaylists.forEach(function(p) {
        var sel = p.id === BP2Upload._addTargetPlaylistId ? ' selected' : '';
        html += '<option value="' + esc(p.id) + '"' + sel + '>' + esc(p.title || p.name || 'Untitled') + '</option>';
      });
      html += '</select></div>';

      html += '<div id="bp2-add-song-list" style="max-height:50vh;overflow-y:auto;">';
      html += BP2Upload._renderSongList(songs, esc, tc);
      html += '</div>';

      Modal.open({
        title: 'Add Song to Playlist',
        size: 'md',
        content: html,
        saveText: 'Done',
        onSave: function() { Modal.close(); }
      });

      // Wire playlist selector change — re-renders song list with correct "In playlist" badges
      setTimeout(function() {
        var sel = document.getElementById('bp2-add-target-pl');
        if (sel) {
          sel.addEventListener('change', function() {
            BP2Upload._addTargetPlaylistId = sel.value;
            var listEl = document.getElementById('bp2-add-song-list');
            if (listEl) {
              listEl.innerHTML = BP2Upload._renderSongList(songs, esc, tc);
            }
          });
        }
      }, 100);
    },

    _renderSongList: function(songs, esc, tc) {
      var c = _c();
      if (!c) return '';
      // Find target playlist to check which songs are already in it
      var playlists = c.ref('playlists') || [];
      var targetPl = null;
      for (var i = 0; i < playlists.length; i++) {
        if (playlists[i].id === BP2Upload._addTargetPlaylistId) { targetPl = playlists[i]; break; }
      }
      var alreadyInPl = {};
      if (targetPl) {
        var sets = targetPl.sets || [];
        sets.forEach(function(set) {
          if (set.intro) alreadyInPl[set.intro] = true;
          (set.songs || []).forEach(function(id) { alreadyInPl[id] = true; });
          if (set.outro) alreadyInPl[set.outro] = true;
        });
        // Also check songOrder for legacy playlists without sets
        (targetPl.songOrder || []).forEach(function(id) { alreadyInPl[id] = true; });
      }

      var html = '';
      songs.forEach(function(song) {
        var inPl = !!alreadyInPl[song.id];
        var sid = (song.id || '').replace(/"/g, '&quot;');
        html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
          '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;color:#e6edf3;">' + esc(tc(song.title || '')) + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">' + esc(song.artist || 'Unknown') + '</div></div>' +
          (inPl
            ? '<span style="font-size:12px;color:rgba(82,196,26,0.7);padding:4px 10px;border:1px solid rgba(82,196,26,0.2);border-radius:4px;">In playlist</span>'
            : '<button id="bp2-add-btn-' + sid + '" onclick="event.stopPropagation();window.BP2Upload._handleAddClick(\'' + sid + '\');return false;" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(212,160,23,0.3);background:rgba(212,160,23,0.1);color:#d4a017;cursor:pointer;font-size:12px;font-weight:600;"><i class="fa-solid fa-plus" style="margin-right:4px;"></i>Add</button>') +
        '</div>';
      });
      return html;
    },

    _addTargetPlaylistId: null,

    // Called directly from each row's onclick — bulletproof, no event delegation
    _handleAddClick: function(songId) {
      if (!songId || !global.BP2Playlist) return;
      var btnEl = document.getElementById('bp2-add-btn-' + songId);
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      }
      // Use the explicitly selected target playlist, not just currentPlaylist
      var targetId = BP2Upload._addTargetPlaylistId;
      if (targetId) {
        global.BP2Playlist.addSongToPlaylistById(songId, targetId);
      } else {
        global.BP2Playlist.addSongToPlaylist(songId);
      }
      setTimeout(function() {
        if (btnEl && btnEl.parentNode) {
          btnEl.outerHTML = '<span style="font-size:12px;color:rgba(82,196,26,0.7);padding:4px 10px;border:1px solid rgba(82,196,26,0.2);border-radius:4px;">Added</span>';
        }
      }, 500);
    },

    deleteSong: function(songId) {
      var c = _c();
      if (!c || !c.getDb()) return;
      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      if (!song) return;

      if (typeof Modal !== 'undefined') {
        var esc = global.BP2Utils ? global.BP2Utils.esc : function(s) { return s; };
        Modal.open({
          title: 'Delete Song',
          size: 'sm',
          content: '<p style="color:#e6edf3;">Permanently delete <strong>' + esc(song.title) + '</strong>?</p>',
          saveText: 'Delete',
          onSave: function() {
            c.getDb().collection('songs').doc(songId).delete().then(function() {
              var inv = c.ref('inventory');
              for (var i = inv.length - 1; i >= 0; i--) { if (inv[i].id === songId) inv.splice(i, 1); }
              delete songsMap[songId];
              var songs = c.ref('songs');
              for (var j = songs.length - 1; j >= 0; j--) { if (songs[j].id === songId) songs.splice(j, 1); }
              if (typeof Modal !== 'undefined') Modal.close();
              if (typeof Toast !== 'undefined') Toast.success('Song deleted');
              // Clean storage in background
              var storage = c.getStorage();
              if (song.audioPath && storage) storage.ref(song.audioPath).delete().catch(function() {});
              c.emit('render:tracklist');
            }).catch(function(e) {
              if (typeof Toast !== 'undefined') Toast.error('Delete failed: ' + e.message);
            });
          }
        });
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Upload;
  else if (global) global.BP2Upload = BP2Upload;
})(typeof window !== 'undefined' ? window : this);
