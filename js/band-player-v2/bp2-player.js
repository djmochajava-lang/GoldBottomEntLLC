/* ============================================
   bp2-player.js — Audio Playback Engine
   Band Player v2.0

   WHAT IT DOES:
     Manages HTML5 Audio element for single-track playback.
     Play, pause, next, prev, seek, volume, mute, repeat.
     Cache-first URL resolution. Practice tracking at 80%.
     Auto-pauses on page hide/unload.

   WHO CALLS IT:
     - BP2Core emits 'player:init' → this module sets up
     - UI events routed through BP2Core

   DEPENDENCIES:
     - bp2-core.js
     - bp2-offline.js (optional, for cache-first)
   ============================================ */
(function(global) {
  'use strict';

  var _audio = null;
  var _core = null;
  // E1 — full-song pitch-preserving speed. SPEED_OPTIONS mirrors BP2Practice.
  var _speed = 1.0;
  var SPEED_OPTIONS = [0.5, 0.75, 0.85, 1.0, 1.15, 1.25];

  function _getCore() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  // Turn ON pitch preservation so slow/fast playback keeps the original key
  // (no chipmunk / no muddy detune). Native HTMLAudioElement feature; set all
  // vendor spellings (webkit for iOS Safari, moz for older Firefox). Idempotent —
  // re-assert after each load() because some engines reset it when src changes.
  function _applyPreservesPitch() {
    if (!_audio) return;
    try {
      _audio.preservesPitch = true;
      _audio.webkitPreservesPitch = true;   // iOS/Safari
      _audio.mozPreservesPitch = true;       // older Firefox
    } catch (e) { /* property may be read-only on some engines — non-fatal */ }
  }

  function _setupAudio() {
    if (_audio) return;
    _audio = document.createElement('audio');
    _audio.preload = 'metadata';
    _applyPreservesPitch();
    _audio.playbackRate = _speed;

    _audio.addEventListener('timeupdate', function() {
      var c = _getCore();
      if (!c) return;
      c.emit('player:timeupdate', {
        currentTime: _audio.currentTime,
        duration: _audio.duration || 0,
        progress: _audio.duration ? _audio.currentTime / _audio.duration : 0
      });

      // Practice tracking: 80% threshold
      if (_audio.duration && c.ref('currentIndex') >= 0) {
        var pct = _audio.currentTime / _audio.duration;
        if (pct >= 0.80) {
          var songs = c.ref('songs');
          var song = songs[c.ref('currentIndex')];
          var logged = c.ref('loggedThisSession');
          if (song && !logged[song.id]) {
            _logPlayback(song.id, 'complete', pct);
            logged[song.id] = true;
            var completed = c.ref('completedTracks');
            completed[song.id] = true;
            c.emit('player:track-completed', { songId: song.id });
          }
        }
      }
    });

    _audio.addEventListener('loadedmetadata', function() {
      var c = _getCore();
      if (!c) return;
      var songs = c.ref('songs');
      var idx = c.ref('currentIndex');
      if (songs[idx]) songs[idx].duration = _audio.duration;
      c.emit('player:metadata', { duration: _audio.duration });
    });

    _audio.addEventListener('ended', function() {
      var c = _getCore();
      if (!c) return;

      // Log if not already at 80%
      var songs = c.ref('songs');
      var idx = c.ref('currentIndex');
      var song = songs[idx];
      var logged = c.ref('loggedThisSession');
      if (song && !logged[song.id]) {
        _logPlayback(song.id, 'complete', 1.0);
        logged[song.id] = true;
        var completed = c.ref('completedTracks');
        completed[song.id] = true;
      }

      var mode = c.ref('repeatMode');
      if (mode === 'one') {
        _audio.currentTime = 0;
        _audio.play();
      } else if (mode === 'all') {
        BP2Player.next();
      } else {
        if (idx < songs.length - 1) {
          BP2Player.next();
        } else {
          c.set('isPlaying', false);
          c.emit('player:stopped');
        }
      }
    });

    _audio.volume = 0.8;
  }

  function _logPlayback(trackId, eventType, progress) {
    var c = _getCore();
    if (!c || !c.getDb() || !c.getUser()) return;
    var db = c.getDb();
    var user = c.getUser();

    db.collection('playback-events').add({
      userId: user.uid,
      trackId: trackId,
      playlistId: c.ref('currentPlaylist') ? c.ref('currentPlaylist').id : null,
      eventType: eventType,
      progress: Math.round(progress * 100) / 100,
      listenedSeconds: Math.round(_audio.currentTime || 0),
      duration: Math.round(_audio.duration || 0),
      timestamp: Auth._serverTimestamp()
    }).catch(function(err) {
      console.warn('[BP2Player] Playback log failed:', err.message);
    });
  }

  function _loadCompletedTracks(playlistId) {
    var c = _getCore();
    if (!c || !c.getDb() || !c.getUser()) return;

    c.getDb().collection('playback-events')
      .where('userId', '==', c.getUser().uid)
      .where('playlistId', '==', playlistId)
      .where('eventType', '==', 'complete')
      .get()
      .then(function(snap) {
        var completed = {};
        snap.forEach(function(doc) { completed[doc.data().trackId] = true; });
        c.set('completedTracks', completed);
      })
      .catch(function() {});
  }

  // ── Public API ───────────────────────────────
  var BP2Player = {
    init: function() {
      _setupAudio();
      var c = _getCore();
      if (!c) return;

      // Listen for events
      c.on('player:init', function() { _setupAudio(); });
      c.on('playlist:selected', function(data) {
        if (data && data.playlistId) _loadCompletedTracks(data.playlistId);
      });

      // E1 — SPEED tool button: cycle through SPEED_OPTIONS (pitch preserved),
      // then re-render the tracklist so the button label reflects the new rate.
      c.on('tool:speed', function() {
        var cur = _speed;
        var idx = SPEED_OPTIONS.indexOf(cur);
        var next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
        BP2Player.setSpeed(next);
        if (typeof Toast !== 'undefined') Toast.info('Speed: ' + (next === 1.0 ? '1.0' : next) + 'x (pitch preserved)');
        c.emit('render:tracklist');
      });

      // Auto-pause on page hide
      document.addEventListener('visibilitychange', function() {
        if (document.hidden && c.ref('isPlaying')) {
          BP2Player.pause();
        }
      });

      if (typeof global.addEventListener === 'function') {
        global.addEventListener('beforeunload', function() {
          if (c.ref('isPlaying')) BP2Player.pause();
        });
      }
    },

    play: function(index) {
      var c = _getCore();
      if (!c) return;
      var songs = c.ref('songs');
      if (index < 0 || index >= songs.length) return;
      var song = songs[index];
      if (!song || !song.audioPath) return;

      _setupAudio();

      // Stop everything first
      _audio.pause();
      _audio.currentTime = 0;
      c.emit('stems:stop');
      c.set('isPlaying', false);
      c.set('currentIndex', index);

      // Try cache first, then network
      var cachePromise = (global.BP2Offline && global.BP2Offline.getCachedAudioUrl)
        ? global.BP2Offline.getCachedAudioUrl(song.id)
        : Promise.resolve(null);

      cachePromise.then(function(cachedUrl) {
        if (cachedUrl) {
          _loadAndPlay(cachedUrl);
        } else {
          // Mint a short-lived Supabase signed URL at play-tap time.
          var supabase = c.getSupabase ? c.getSupabase() : null;
          if (!supabase) {
            if (typeof Toast !== 'undefined') Toast.error('Storage not available');
            return;
          }
          supabase.storage.from(c.supaBucket()).createSignedUrl(c.supaKey(song.audioPath), 3600)
            .then(function(res) {
              if (res && res.data && res.data.signedUrl) {
                _loadAndPlay(res.data.signedUrl);
              } else {
                console.error('[BP2Player] Failed to get audio URL:', res && res.error);
                if (typeof Toast !== 'undefined') Toast.error('Could not load audio file');
              }
            }).catch(function(e) {
              console.error('[BP2Player] Failed to get audio URL:', e);
              if (typeof Toast !== 'undefined') Toast.error('Could not load audio file');
            });
        }
      });
    },

    _loadAndPlay: function(url) { _loadAndPlay(url); },

    pause: function() {
      var c = _getCore();
      if (!c) return;
      _audio.pause();
      c.set('isPlaying', false);
      c.emit('player:paused');
    },

    togglePlay: function() {
      var c = _getCore();
      if (!c) return;
      var idx = c.ref('currentIndex');
      var songs = c.ref('songs');

      if (idx === -1 && songs.length > 0) {
        BP2Player.play(0);
        return;
      }

      if (c.ref('isPlaying')) {
        BP2Player.pause();
      } else {
        _audio.play().then(function() {
          c.set('isPlaying', true);
          c.emit('player:playing');
        }).catch(function(err) {
          console.warn('[BP2Player] Resume blocked:', err.name);
        });
      }
    },

    next: function() {
      var c = _getCore();
      if (!c) return;
      var songs = c.ref('songs');
      var idx = c.ref('currentIndex');
      if (songs.length === 0) return;

      if (idx < songs.length - 1) {
        BP2Player.play(idx + 1);
      } else if (c.ref('repeatMode') === 'all') {
        BP2Player.play(0);
      }
    },

    prev: function() {
      var c = _getCore();
      if (!c) return;
      var songs = c.ref('songs');
      if (songs.length === 0) return;

      if (_audio.currentTime > 3) {
        _audio.currentTime = 0;
        return;
      }
      var idx = c.ref('currentIndex');
      if (idx > 0) BP2Player.play(idx - 1);
    },

    seek: function(pct) {
      if (_audio.duration) {
        _audio.currentTime = pct * _audio.duration;
      }
    },

    setVolume: function(val) {
      var c = _getCore();
      if (!c) return;
      var v = Math.max(0, Math.min(1, val));
      if (v > 0) c.set('prevVolume', v);
      c.set('volume', v);
      _audio.volume = v;
      c.emit('player:volume', { volume: v });
    },

    toggleMute: function() {
      var c = _getCore();
      if (!c) return;
      if (c.ref('volume') > 0) {
        BP2Player.setVolume(0);
      } else {
        BP2Player.setVolume(c.ref('prevVolume') || 0.8);
      }
    },

    toggleRepeat: function() {
      var c = _getCore();
      if (!c) return;
      var modes = ['off', 'all', 'one'];
      var idx = modes.indexOf(c.ref('repeatMode'));
      var next = modes[(idx + 1) % 3];
      c.set('repeatMode', next);
      c.emit('player:repeat', { mode: next });
    },

    // E1 — pitch-preserving speed for the full song. Snaps to the nearest
    // SPEED_OPTION, keeps pitch (preservesPitch), and keeps BP2Practice in sync
    // so the shared speed UI shows the same value across player + mixer.
    SPEED_OPTIONS: SPEED_OPTIONS,
    setSpeed: function(rate) {
      var v = parseFloat(rate);
      if (isNaN(v)) return _speed;
      var closest = SPEED_OPTIONS[0], bestD = Math.abs(v - closest);
      for (var i = 1; i < SPEED_OPTIONS.length; i++) {
        var d = Math.abs(SPEED_OPTIONS[i] - v);
        if (d < bestD) { closest = SPEED_OPTIONS[i]; bestD = d; }
      }
      _speed = closest;
      _setupAudio();
      _applyPreservesPitch();       // re-assert before changing rate
      _audio.playbackRate = _speed;
      if (global.BP2Practice && global.BP2Practice.setSpeed) {
        try { global.BP2Practice.setSpeed(_speed); } catch (e) {}
      }
      var c = _getCore();
      if (c) c.emit('player:speed', { speed: _speed });
      return _speed;
    },
    getSpeed: function() { return _speed; },

    getAudio: function() { return _audio; },
    getCurrentTime: function() { return _audio ? _audio.currentTime : 0; },
    getDuration: function() { return _audio ? _audio.duration : 0; }
  };

  function _loadAndPlay(url) {
    var c = _getCore();
    _audio.src = url;
    _audio.load();
    // Re-assert pitch preservation + speed after src/load (some engines reset them).
    _applyPreservesPitch();
    _audio.playbackRate = _speed;

    _audio.play().then(function() {
      c.set('isPlaying', true);
      c.emit('player:playing');
    }).catch(function(err) {
      console.warn('[BP2Player] Play blocked:', err.name, '— waiting for canplay');
      _audio.addEventListener('canplay', function retry() {
        _audio.removeEventListener('canplay', retry);
        _audio.play().then(function() {
          c.set('isPlaying', true);
          c.emit('player:playing');
        }).catch(function(e) {
          console.warn('[BP2Player] Retry failed:', e.name);
          if (typeof Toast !== 'undefined') Toast.error('Tap play to start audio');
        });
      });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Player;
  } else if (global) {
    global.BP2Player = BP2Player;
  }
})(typeof window !== 'undefined' ? window : this);
