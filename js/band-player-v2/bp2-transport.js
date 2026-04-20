/* ============================================
   bp2-transport.js — Web Audio Multi-Stem Synchronized Playback
   Band Player v2.0

   Manages AudioContext + N AudioBufferSourceNodes.
   50ms lookahead sync (<20ms drift).

   WHO CALLS IT:
     - bp2-integration.js loads and starts
     - bp2-mixer.js state → applyMixer updates GainNodes
   ============================================ */
(function(global) {
  'use strict';

  var _ctx = null;
  function _getCtx() {
    if (_ctx && _ctx.state !== 'closed') return _ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) throw new Error('Web Audio not supported');
    _ctx = new AC();
    return _ctx;
  }

  var _stems = {};
  var _masterGain = null;
  var _playing = false;
  var _startTimeCtx = 0;
  var _startOffset = 0;
  var _rate = 1.0;
  var _listeners = {};
  var _lastSongId = null;

  function _emit(event, payload) {
    var arr = _listeners[event];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) {}
    }
  }

  function _buildMaster() {
    var ctx = _getCtx();
    if (!_masterGain) {
      _masterGain = ctx.createGain();
      _masterGain.gain.value = 0.8;
      _masterGain.connect(ctx.destination);
    }
  }

  function _createSource(name, offset) {
    var ctx = _getCtx();
    var rec = _stems[name];
    if (!rec || !rec.buffer) return null;
    if (rec.source) {
      try { rec.source.stop(); } catch (e) {}
      rec.source.disconnect();
      rec.source = null;
    }
    if (!rec.gainNode) {
      rec.gainNode = ctx.createGain();
      rec.gainNode.gain.value = 0;
      rec.gainNode.connect(_masterGain);
    }
    var src = ctx.createBufferSource();
    src.buffer = rec.buffer;
    src.playbackRate.value = _rate;
    src.connect(rec.gainNode);
    src.onended = function() {
      if (_playing && !rec._seeking) _emit('ended', { stem: name });
    };
    rec.source = src;
    return src;
  }

  function _stopAll(seeking) {
    var names = Object.keys(_stems);
    for (var i = 0; i < names.length; i++) {
      var rec = _stems[names[i]];
      if (!rec.source) continue;
      rec._seeking = !!seeking;
      try { rec.source.stop(); } catch (e) {}
      rec.source.disconnect();
      rec.source = null;
      rec._seeking = false;
    }
  }

  var BP2Transport = {
    load: function(songId, stems) {
      if (!stems || typeof stems !== 'object') return Promise.reject(new Error('stems required'));
      _lastSongId = songId;
      this.destroy();
      _buildMaster();
      var ctx = _getCtx();
      var names = Object.keys(stems);
      var loaders = names.map(function(name) {
        return new Promise(function(resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', stems[name], true);
          xhr.responseType = 'arraybuffer';
          xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(xhr.response);
            } else {
              reject(new Error('XHR ' + xhr.status + ' for ' + name));
            }
          };
          xhr.onerror = function() { reject(new Error('Network error loading ' + name)); };
          xhr.send();
        })
          .then(function(buf) {
            return new Promise(function(resolve, reject) {
              var p = ctx.decodeAudioData(buf, resolve, reject);
              if (p && typeof p.then === 'function') p.then(resolve, reject);
            });
          })
          .then(function(audioBuffer) { _stems[name] = { buffer: audioBuffer, source: null, gainNode: null }; });
      });
      return Promise.all(loaders).then(function() {
        var maxDur = 0;
        for (var i = 0; i < names.length; i++) {
          var rec = _stems[names[i]];
          if (rec && rec.buffer) maxDur = Math.max(maxDur, rec.buffer.duration);
        }
        _emit('ready', { songId: songId, count: names.length, duration: maxDur });
        return { count: names.length, duration: maxDur };
      }).catch(function(err) {
        _emit('error', { error: err });
        throw err;
      });
    },

    play: function() {
      if (_playing) return;
      var ctx = _getCtx();
      if (ctx.state === 'suspended') ctx.resume();
      _buildMaster();
      var when = ctx.currentTime + 0.05;
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var src = _createSource(names[i], _startOffset);
        if (src) src.start(when, _startOffset);
      }
      _startTimeCtx = when;
      _playing = true;
      _emit('play', { offset: _startOffset });
    },

    pause: function() {
      if (!_playing) return;
      var elapsed = (_getCtx().currentTime - _startTimeCtx) * _rate;
      _startOffset = Math.max(0, _startOffset + elapsed);
      _stopAll(true);
      _playing = false;
      _emit('pause', { offset: _startOffset });
    },

    seek: function(seconds) {
      _startOffset = Math.max(0, seconds);
      if (_playing) {
        _stopAll(true);
        var ctx = _getCtx();
        var when = ctx.currentTime + 0.05;
        var names = Object.keys(_stems);
        for (var i = 0; i < names.length; i++) {
          var src = _createSource(names[i], _startOffset);
          if (src) src.start(when, _startOffset);
        }
        _startTimeCtx = when;
      }
      _emit('seek', { offset: _startOffset });
    },

    setPlaybackRate: function(rate) {
      _rate = Math.max(0.25, Math.min(4.0, rate));
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var rec = _stems[names[i]];
        if (rec.source) rec.source.playbackRate.value = _rate;
      }
    },

    setMasterGain: function(v) {
      _buildMaster();
      _masterGain.gain.value = Math.max(0, Math.min(1, v));
    },

    currentTime: function() {
      if (!_playing) return _startOffset;
      var elapsed = (_getCtx().currentTime - _startTimeCtx) * _rate;
      return _startOffset + Math.max(0, elapsed);
    },

    duration: function() {
      var names = Object.keys(_stems);
      var max = 0;
      for (var i = 0; i < names.length; i++) {
        var rec = _stems[names[i]];
        if (rec && rec.buffer) max = Math.max(max, rec.buffer.duration);
      }
      return max;
    },

    isPlaying: function() { return _playing; },

    applyMixer: function(songId) {
      _buildMaster();
      if (!global.BP2Mixer) return;
      var gains = global.BP2Mixer.effectiveGains(songId || _lastSongId);
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var rec = _stems[names[i]];
        if (!rec.gainNode) {
          rec.gainNode = _getCtx().createGain();
          rec.gainNode.connect(_masterGain);
        }
        var g = gains[names[i]] != null ? gains[names[i]] : 0;
        var now = _getCtx().currentTime;
        rec.gainNode.gain.cancelScheduledValues(now);
        rec.gainNode.gain.setValueAtTime(rec.gainNode.gain.value, now);
        rec.gainNode.gain.linearRampToValueAtTime(g, now + 0.02);
      }
    },

    on: function(event, fn) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },

    destroy: function() {
      _stopAll(false);
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var rec = _stems[names[i]];
        if (rec.gainNode) try { rec.gainNode.disconnect(); } catch (e) {}
      }
      _stems = {};
      _playing = false;
      _startOffset = 0;
    },

    getAudioContext: function() {
      try { return _getCtx(); } catch (e) { return null; }
    },

    _state: function() {
      return { playing: _playing, offset: _startOffset, playbackRate: _rate, stemCount: Object.keys(_stems).length, lastSongId: _lastSongId };
    }
  };

  // Auto-pause on page hide
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function() {
      if (document.hidden && _playing) BP2Transport.pause();
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Transport;
  else if (global) global.BP2Transport = BP2Transport;
})(typeof window !== 'undefined' ? window : this);
