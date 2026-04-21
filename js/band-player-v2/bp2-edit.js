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
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
