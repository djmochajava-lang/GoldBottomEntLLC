/* ============================================
   bp2-edit.js — Edit Mode Logic & Set Management
   Band Player v2.0

   Toggle edit mode (role-gated). Dirty tracking.
   Song reorder, move between sets, set management.
   Firestore save on exit.

   WHO CALLS IT:
     - bp2-render.js edit button
     - bp2-render-edit.js calls operations
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  var BP2Edit = {
    init: function() {
      var c = _c();
      if (!c) return;
      c.on('edit:toggle', function() { BP2Edit.toggleEditMode(); });
      c.on('edit:move-song', function(d) { BP2Edit.moveSong(d.setIndex, d.position, d.songIndex, d.direction); });
      c.on('edit:remove-song', function(d) { BP2Edit.removeSong(d.setIndex, d.position, d.songIndex); });
      c.on('edit:add-set', function() { BP2Edit.addSet(); });
      c.on('edit:remove-set', function(d) { BP2Edit.removeSet(d.setIndex); });
      c.on('edit:move-set', function(d) { BP2Edit.moveSet(d.setIndex, d.direction); });
      c.on('edit:rename-set', function(d) { BP2Edit.renameSet(d.setIndex); });
      c.on('edit:set-position', function(d) { BP2Edit.setSongPosition(d.setIndex, d.songIndex, d.position); });
      c.on('edit:move-to-set', function(d) { BP2Edit.moveToSet(d.setIndex, d.position, d.songIndex); });
      c.on('edit:assign-intro', function(d) { BP2Edit.assignIntro(d.setIndex); });
      c.on('edit:assign-outro', function(d) { BP2Edit.assignOutro(d.setIndex); });
      c.on('edit:clear-intro', function(d) { BP2Edit.clearIntro(d.setIndex); });
      c.on('edit:clear-outro', function(d) { BP2Edit.clearOutro(d.setIndex); });
    },

    toggleEditMode: function() {
      var c = _c();
      if (!c || !c.canEdit()) return;
      if (c.ref('editMode')) {
        this._exitEdit();
      } else {
        this._enterEdit();
      }
    },

    _enterEdit: function() {
      var c = _c();
      c.set('editMode', true);
      c.set('editDirty', false);
      // Pause playback
      if (c.ref('isPlaying') && global.BP2Player) global.BP2Player.pause();
      c.emit('render:tracklist');
    },

    _exitEdit: function() {
      var c = _c();
      c.set('editMode', false);

      if (c.ref('editDirty') && c.ref('currentPlaylist') && c.getDb()) {
        var pl = c.ref('currentPlaylist');
        var sets = pl.sets || [];
        var flatOrder = global.BP2Playlist ? global.BP2Playlist.setsToSongOrder(sets) : [];

        c.getDb().collection('playlists').doc(pl.id).update({
          sets: sets,
          songOrder: flatOrder,
          updatedAt: Auth._serverTimestamp()
        }).then(function() {
          pl.songOrder = flatOrder;
          if (typeof Toast !== 'undefined') Toast.success('Arrangement saved');
        }).catch(function(e) {
          console.error('[BP2Edit] Save failed:', e);
          if (typeof Toast !== 'undefined') Toast.error('Failed to save');
        });
      }

      c.set('editDirty', false);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    moveSong: function(setIndex, position, songIndex, direction) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var arr = pl.sets[setIndex].songs;
      if (position !== 'song' || !arr) return;
      var toIndex = songIndex + direction;

      // Cross-set movement: move song to adjacent set
      if (toIndex < 0 && setIndex > 0) {
        // Moving up past top of current set → append to previous set
        var songId = arr.splice(songIndex, 1)[0];
        pl.sets[setIndex - 1].songs.push(songId);
        c.set('editDirty', true);
        this._rebuildFlat();
        c.emit('render:tracklist');
        return;
      }
      if (toIndex >= arr.length && setIndex < pl.sets.length - 1) {
        // Moving down past bottom of current set → prepend to next set
        var songId = arr.splice(songIndex, 1)[0];
        pl.sets[setIndex + 1].songs.unshift(songId);
        c.set('editDirty', true);
        this._rebuildFlat();
        c.emit('render:tracklist');
        return;
      }

      if (toIndex < 0 || toIndex >= arr.length) return;
      var temp = arr[songIndex];
      arr[songIndex] = arr[toIndex];
      arr[toIndex] = temp;
      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    removeSong: function(setIndex, position, songIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var set = pl.sets[setIndex];
      if (position === 'intro') set.intro = null;
      else if (position === 'outro') set.outro = null;
      else if (set.songs) set.songs.splice(songIndex, 1);
      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    addSet: function() {
      var c = _c();
      if (!c || !c.canEdit()) return;
      var pl = c.ref('currentPlaylist');
      if (!pl) return;
      if (global.BP2Playlist) global.BP2Playlist.migrateToSets(pl);
      var sets = pl.sets;
      sets.push({ label: 'Set ' + (sets.length + 1), intro: null, songs: [], outro: null });
      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    removeSet: function(setIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      pl.sets.splice(setIndex, 1);
      if (pl.sets.length === 0) pl.sets.push({ label: 'Set 1', intro: null, songs: [], outro: null });
      pl.sets.forEach(function(s, i) { if (/^Set \d+$/.test(s.label)) s.label = 'Set ' + (i + 1); });
      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    setSongPosition: function(setIndex, songIndex, position) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var set = pl.sets[setIndex];
      var songId = set.songs[songIndex];
      if (!songId) return;

      if (position === 'intro') {
        if (set.intro === songId) {
          // Already intro — toggle off, put back in songs list
          set.intro = null;
        } else {
          // If another song was intro, put it back in songs
          if (set.intro) set.songs.unshift(set.intro);
          set.intro = songId;
          set.songs.splice(set.songs.indexOf(songId), 1);
        }
      } else if (position === 'outro') {
        if (set.outro === songId) {
          set.outro = null;
        } else {
          if (set.outro) set.songs.push(set.outro);
          set.outro = songId;
          set.songs.splice(set.songs.indexOf(songId), 1);
        }
      }

      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    renameSet: function(setIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var set = pl.sets[setIndex];
      var current = set.label || 'Set ' + (setIndex + 1);
      var newName = prompt('Rename set:', current);
      if (newName === null || newName.trim() === '') return;
      set.label = newName.trim();
      c.set('editDirty', true);
      c.emit('render:tracklist');
    },

    moveSet: function(setIndex, direction) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets) return;
      var toIndex = setIndex + direction;
      if (toIndex < 0 || toIndex >= pl.sets.length) return;
      var temp = pl.sets[setIndex];
      pl.sets[setIndex] = pl.sets[toIndex];
      pl.sets[toIndex] = temp;
      pl.sets.forEach(function(s, i) { if (/^Set \d+$/.test(s.label)) s.label = 'Set ' + (i + 1); });
      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    moveToSet: function(fromSetIndex, position, songIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || pl.sets.length < 2) return;
      var sets = pl.sets;
      var fromSet = sets[fromSetIndex];
      var songId;
      if (position === 'intro') songId = fromSet.intro;
      else if (position === 'outro') songId = fromSet.outro;
      else songId = (fromSet.songs || [])[songIndex];
      if (!songId) return;

      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      var title = song ? (global.BP2Utils ? global.BP2Utils.esc(global.BP2Utils.titleCase(song.title)) : song.title) : 'this song';
      var self = this;

      var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
      sets.forEach(function(set, si) {
        if (si === fromSetIndex) return;
        html += '<button onclick="BP2Edit._executeMoveTo(' + fromSetIndex + ',\'' + position + '\',' + songIndex + ',' + si + ')" ' +
          'style="padding:12px 16px;border-radius:8px;border:1px solid rgba(88,166,255,0.2);background:rgba(88,166,255,0.06);color:#58a6ff;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;text-align:left;">' +
          '<i class="fa-solid fa-arrow-right" style="margin-right:8px;"></i>' +
          (global.BP2Utils ? global.BP2Utils.esc(set.label || ('Set ' + (si + 1))) : set.label) +
          '<span style="color:rgba(255,255,255,0.3);font-weight:400;margin-left:8px;">' + ((set.songs || []).length) + ' songs</span>' +
        '</button>';
      });
      html += '</div>';

      if (typeof Modal !== 'undefined') {
        Modal.open({
          title: 'Move \u201c' + title + '\u201d to...',
          size: 'sm',
          content: html,
          saveText: 'Cancel',
          onSave: function() { Modal.close(); }
        });
      }
    },

    _executeMoveTo: function(fromSetIndex, position, songIndex, toSetIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets) return;
      var fromSet = pl.sets[fromSetIndex];
      var songId;
      if (position === 'intro') { songId = fromSet.intro; fromSet.intro = null; }
      else if (position === 'outro') { songId = fromSet.outro; fromSet.outro = null; }
      else { songId = (fromSet.songs || [])[songIndex]; if (fromSet.songs) fromSet.songs.splice(songIndex, 1); }
      if (songId && pl.sets[toSetIndex]) pl.sets[toSetIndex].songs.push(songId);
      c.set('editDirty', true);
      this._rebuildFlat();
      if (typeof Modal !== 'undefined') Modal.close();
      c.emit('render:tracklist');
    },

    assignIntro: function(setIndex) { this._assignSlot(setIndex, 'intro'); },
    assignOutro: function(setIndex) { this._assignSlot(setIndex, 'outro'); },

    _assignSlot: function(setIndex, slot) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var set = pl.sets[setIndex];

      // Build list from songs already in this set
      var songsMap = c.ref('allSongsMap');
      var songs = (set.songs || []).map(function(id, i) { return { id: id, idx: i, song: songsMap[id] }; }).filter(function(e) { return e.song; });

      if (songs.length === 0) {
        if (typeof Toast !== 'undefined') Toast.info('No songs in this set to assign as ' + slot);
        return;
      }

      var esc = global.BP2Utils ? global.BP2Utils.esc : function(s) { return String(s || ''); };
      var tc = global.BP2Utils ? global.BP2Utils.titleCase : function(s) { return String(s || ''); };
      var html = '<div style="max-height:60vh;overflow-y:auto;">';
      songs.forEach(function(entry) {
        html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
          '<div style="width:36px;height:36px;border-radius:8px;background:rgba(212,160,23,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
            '<i class="fa-solid fa-music" style="color:#d4a017;font-size:14px;"></i></div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:14px;font-weight:600;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(tc(entry.song.title)) + '</div>' +
            '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">' + esc(entry.song.artist || 'Unknown') + '</div>' +
          '</div>' +
          '<button onclick="BP2Edit._selectSlotSong(' + setIndex + ',\'' + slot + '\',' + entry.idx + ')" ' +
            'style="padding:6px 14px;border-radius:6px;border:1px solid rgba(212,160,23,0.25);background:rgba(212,160,23,0.1);color:#d4a017;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;">Select</button>' +
        '</div>';
      });
      html += '</div>';

      if (typeof Modal !== 'undefined') {
        Modal.open({
          title: 'Choose ' + (slot === 'intro' ? 'Intro' : 'Outro') + ' for ' + (set.label || 'Set ' + (setIndex + 1)),
          size: 'md',
          content: html,
          saveText: 'Cancel',
          onSave: function() { Modal.close(); }
        });
      }
    },

    _selectSlotSong: function(setIndex, slot, songIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var set = pl.sets[setIndex];
      var songId = set.songs[songIndex];
      if (!songId) return;
      // If current slot has a song, put it back
      if (set[slot]) set.songs.push(set[slot]);
      set[slot] = songId;
      set.songs.splice(songIndex, 1);
      c.set('editDirty', true);
      this._rebuildFlat();
      if (typeof Modal !== 'undefined') Modal.close();
      c.emit('render:tracklist');
    },

    clearIntro: function(setIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var set = pl.sets[setIndex];
      if (set.intro) { set.songs.unshift(set.intro); set.intro = null; }
      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    clearOutro: function(setIndex) {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      if (!pl || !pl.sets || !pl.sets[setIndex]) return;
      var set = pl.sets[setIndex];
      if (set.outro) { set.songs.push(set.outro); set.outro = null; }
      c.set('editDirty', true);
      this._rebuildFlat();
      c.emit('render:tracklist');
    },

    _rebuildFlat: function() {
      var c = _c();
      if (!c) return;
      var pl = c.ref('currentPlaylist');
      var sets = pl ? pl.sets : [];
      var playOrder = global.BP2Playlist ? global.BP2Playlist.flattenSets(sets) : [];
      var songsMap = c.ref('allSongsMap');
      var songs = [];
      var finalPO = [];
      playOrder.forEach(function(entry) {
        var song = songsMap[entry.songId];
        if (song) { songs.push(song); finalPO.push(entry); }
      });
      c.set('songs', songs);
      c.set('playOrder', finalPO);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Edit;
  else if (global) global.BP2Edit = BP2Edit;
})(typeof window !== 'undefined' ? window : this);
