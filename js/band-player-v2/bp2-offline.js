/* ============================================
   bp2-offline.js — Offline Cache Management
   Band Player v2.0

   WHAT IT DOES:
     Cache API storage for offline audio playback.
     localStorage index with timestamps. LRU eviction at 20-song limit.
     Cache-first URL resolution.

   WHO CALLS IT:
     - bp2-player.js calls getCachedAudioUrl before network fetch
     - bp2-render.js reads isCached for indicator
   ============================================ */
(function(global) {
  'use strict';

  var CACHE_NAME = 'bp-offline-audio';
  var MAX_SONGS = 20;
  var INDEX_KEY = 'bp2-cache-index';
  var _index = null;

  function _loadIndex() {
    if (_index) return _index;
    try {
      var raw = localStorage.getItem(INDEX_KEY);
      _index = raw ? JSON.parse(raw) : {};
    } catch (e) { _index = {}; }
    return _index;
  }

  function _saveIndex() {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(_index || {})); }
    catch (e) { /* quota */ }
  }

  var BP2Offline = {
    loadCacheIndex: function() { _loadIndex(); },

    isCached: function(songId) {
      var idx = _loadIndex();
      return !!(idx && idx[songId]);
    },

    getCachedAudioUrl: function(songId) {
      if (!('caches' in window) || !this.isCached(songId)) return Promise.resolve(null);
      return caches.open(CACHE_NAME).then(function(cache) {
        return cache.match('audio/' + songId);
      }).then(function(response) {
        if (!response) return null;
        return response.blob().then(function(blob) { return URL.createObjectURL(blob); });
      }).catch(function() { return null; });
    },

    saveOffline: function(songId, songsMap, storage, renderCallback) {
      if (!('caches' in window)) {
        if (typeof Toast !== 'undefined') Toast.info('Offline storage not supported');
        return;
      }
      var song = songsMap[songId];
      if (!song || !song.audioPath) return;
      if (this.isCached(songId)) {
        if (typeof Toast !== 'undefined') Toast.info(song.title + ' is already saved offline');
        return;
      }
      if (!storage) {
        if (typeof Toast !== 'undefined') Toast.error('Storage not available');
        return;
      }

      var self = this;
      var idx = _loadIndex();
      var ids = Object.keys(idx);

      // LRU eviction
      if (ids.length >= MAX_SONGS) {
        var oldest = ids.sort(function(a, b) { return (idx[a].savedAt || 0) - (idx[b].savedAt || 0); })[0];
        self._removeCached(oldest).then(function() {
          self._doSave(song, storage, renderCallback);
        });
      } else {
        self._doSave(song, storage, renderCallback);
      }
    },

    _doSave: function(song, storage, renderCallback) {
      var self = this;
      if (typeof Toast !== 'undefined') Toast.info('Saving "' + song.title + '" for offline...');

      storage.ref(song.audioPath).getDownloadURL().then(function(url) {
        return fetch(url);
      }).then(function(response) {
        if (!response.ok) throw new Error('Download failed');
        return caches.open(CACHE_NAME).then(function(cache) {
          return cache.put('audio/' + song.id, response);
        });
      }).then(function() {
        var idx = _loadIndex();
        idx[song.id] = { title: song.title, savedAt: Date.now() };
        _saveIndex();
        if (renderCallback) renderCallback();
        if (typeof Toast !== 'undefined') Toast.success('"' + song.title + '" saved offline');
      }).catch(function(e) {
        console.error('[BP2Offline] Save failed:', e);
        if (typeof Toast !== 'undefined') Toast.error('Could not save offline: ' + e.message);
      });
    },

    removeOffline: function(songId, songsMap, renderCallback) {
      var song = songsMap ? songsMap[songId] : null;
      var title = song ? song.title : 'song';
      var self = this;
      this._removeCached(songId).then(function() {
        if (renderCallback) renderCallback();
        if (typeof Toast !== 'undefined') Toast.success('"' + title + '" removed from offline');
      });
    },

    _removeCached: function(songId) {
      var idx = _loadIndex();
      delete idx[songId];
      _saveIndex();
      if (!('caches' in window)) return Promise.resolve();
      return caches.open(CACHE_NAME).then(function(cache) {
        return cache.delete('audio/' + songId);
      }).catch(function() {});
    },

    getCacheCount: function() {
      var idx = _loadIndex();
      return idx ? Object.keys(idx).length : 0;
    },

    downloadTrack: function(songId, songsMap, playlist, storage) {
      var song = songsMap ? songsMap[songId] : null;
      if (!song || !song.audioPath) return;
      if (playlist && playlist.downloadPolicy === 'disabled') {
        if (typeof Toast !== 'undefined') Toast.info('Downloads are disabled for this playlist.');
        return;
      }
      if (!storage) return;
      storage.ref(song.audioPath).getDownloadURL().then(function(url) {
        var a = document.createElement('a');
        a.href = url;
        a.download = (song.title || 'track') + '.' + (song.audioPath.split('.').pop() || 'mp3');
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }).catch(function(err) {
        if (typeof Toast !== 'undefined') Toast.error('Download failed: ' + err.message);
      });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Offline;
  else if (global) global.BP2Offline = BP2Offline;
})(typeof window !== 'undefined' ? window : this);
