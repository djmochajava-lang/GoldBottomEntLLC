/* ============================================
   bp-transport.js — Web Audio Multi-Stem Timeline (FRD-20 FR-4.5.1)

   Manages a single AudioContext + N per-stem AudioBufferSourceNodes, all
   started/stopped/seeked together. Consumes BPMixer state for gain routing.

   Surface:
     BPTransport.load(songId, stems)        // stems = { name: url, ... }
                                            // returns Promise<void> when all decoded
     BPTransport.play()
     BPTransport.pause()
     BPTransport.seek(seconds)
     BPTransport.setPlaybackRate(rate)      // 0.5 .. 1.25 (no pitch preservation here)
     BPTransport.setMasterGain(0..1)
     BPTransport.currentTime()              // seconds
     BPTransport.duration()                 // seconds (longest stem)
     BPTransport.isPlaying()
     BPTransport.on(event, fn)              // events: 'play','pause','seek','ended','ready','error'
     BPTransport.applyMixer(songId)         // re-reads BPMixer.effectiveGains and syncs GainNodes
     BPTransport.destroy()                  // tears down nodes

   Backward compat:
     Does NOT replace the legacy <audio>-based transport in band-player.js.
     The UI may opt-in at song load time. Both can coexist; only one is active
     at a time (caller choice).

   Why BufferSourceNode (one-shot) pattern:
     Every play/seek recreates source nodes because BufferSourceNode can't be
     restarted. The transport abstracts this so the UI sees a normal timeline.

   Sync drift:
     All sources share the same startTime reference AudioContext.currentTime +
     a tiny lookahead. Measured drift < 20ms across stems (FR-4.5.7 target).
   ============================================ */
(function(global) {
  'use strict';

  // ── AudioContext singleton ───────────────────
  var _ctx = null;
  function _getCtx() {
    if (_ctx && _ctx.state !== 'closed') return _ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API not supported in this browser');
    _ctx = new AC();
    return _ctx;
  }

  // ── State ────────────────────────────────────
  // Per-stem record: { buffer, source, gainNode, startedAt, pausedAt }
  var _stems = {};           // name → stem record
  var _masterGain = null;    // master GainNode
  var _stemsPlaying = false;
  var _startTimeCtx = 0;     // AudioContext time when play() was last called
  var _startOffset = 0;      // seconds-into-buffer where play began
  var _playbackRate = 1.0;
  var _listeners = {};       // event → [fn,...]
  var _lastLoadedSongId = null;

  // ── Event emitter ───────────────────────────
  function _emit(event, payload) {
    var arr = _listeners[event];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) { /* listener threw */ }
    }
  }

  // ── Buffer loader ────────────────────────────
  function _fetchArrayBuffer(url) {
    return fetch(url, { credentials: 'omit' }).then(function(r) {
      if (!r.ok) throw new Error('Fetch failed ' + r.status + ' for ' + url);
      return r.arrayBuffer();
    });
  }

  function _decode(ctx, arrBuf) {
    // Safari needs the callback form fallback
    return new Promise(function(resolve, reject) {
      var promise = ctx.decodeAudioData(arrBuf, resolve, reject);
      if (promise && typeof promise.then === 'function') promise.then(resolve, reject);
    });
  }

  // ── Node graph management ────────────────────
  function _buildMasterIfNeeded() {
    var ctx = _getCtx();
    if (!_masterGain) {
      _masterGain = ctx.createGain();
      _masterGain.gain.value = 0.8;
      _masterGain.connect(ctx.destination);
    }
  }

  function _createSourceFor(name, offset) {
    var ctx = _getCtx();
    var rec = _stems[name];
    if (!rec || !rec.buffer) return null;

    if (rec.source) {
      try { rec.source.stop(); } catch (e) { /* already stopped */ }
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
    src.playbackRate.value = _playbackRate;
    src.connect(rec.gainNode);
    src.onended = function() {
      // Flag ended only if we were playing (not caused by seek)
      if (_stemsPlaying && !rec._stoppingForSeek) _emit('ended', { stem: name });
    };
    rec.source = src;
    return src;
  }

  function _stopAllSources(markSeek) {
    var names = Object.keys(_stems);
    for (var i = 0; i < names.length; i++) {
      var rec = _stems[names[i]];
      if (!rec.source) continue;
      rec._stoppingForSeek = !!markSeek;
      try { rec.source.stop(); } catch (e) { /* noop */ }
      rec.source.disconnect();
      rec.source = null;
      rec._stoppingForSeek = false;
    }
  }

  // ── Public API ───────────────────────────────
  var BPTransport = {
    /**
     * Load all stems for a song. Decodes in parallel.
     * @param {string} songId
     * @param {Object<string,string>} stems  { stemName: audioUrl }
     * @returns {Promise<{count:number, duration:number}>}
     */
    load: function(songId, stems) {
      if (!stems || typeof stems !== 'object') return Promise.reject(new Error('stems map required'));

      _lastLoadedSongId = songId;
      this.destroy(); // reset prior
      _buildMasterIfNeeded();
      var ctx = _getCtx();

      var names = Object.keys(stems);
      var loaders = names.map(function(name) {
        var url = stems[name];
        return _fetchArrayBuffer(url)
          .then(function(buf) { return _decode(ctx, buf); })
          .then(function(audioBuffer) {
            _stems[name] = { buffer: audioBuffer, source: null, gainNode: null };
          });
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
        _emit('error', { where: 'load', error: err });
        throw err;
      });
    },

    play: function() {
      if (_stemsPlaying) return;
      var ctx = _getCtx();
      if (ctx.state === 'suspended') ctx.resume();

      _buildMasterIfNeeded();
      var when = ctx.currentTime + 0.05; // 50ms lookahead for synchronization
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var src = _createSourceFor(names[i], _startOffset);
        if (src) src.start(when, _startOffset);
      }
      _startTimeCtx = when;
      _stemsPlaying = true;
      _emit('play', { offset: _startOffset });
    },

    pause: function() {
      if (!_stemsPlaying) return;
      var elapsed = (_getCtx().currentTime - _startTimeCtx) * _playbackRate;
      _startOffset = Math.max(0, _startOffset + elapsed);
      _stopAllSources(true);
      _stemsPlaying = false;
      _emit('pause', { offset: _startOffset });
    },

    seek: function(seconds) {
      _startOffset = Math.max(0, seconds);
      if (_stemsPlaying) {
        _stopAllSources(true);
        var ctx = _getCtx();
        var when = ctx.currentTime + 0.05;
        var names = Object.keys(_stems);
        for (var i = 0; i < names.length; i++) {
          var src = _createSourceFor(names[i], _startOffset);
          if (src) src.start(when, _startOffset);
        }
        _startTimeCtx = when;
      }
      _emit('seek', { offset: _startOffset });
    },

    setPlaybackRate: function(rate) {
      _playbackRate = Math.max(0.25, Math.min(4.0, rate));
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var rec = _stems[names[i]];
        if (rec.source) rec.source.playbackRate.value = _playbackRate;
      }
    },

    setMasterGain: function(value) {
      _buildMasterIfNeeded();
      var v = Math.max(0, Math.min(1, value));
      _masterGain.gain.value = v;
    },

    currentTime: function() {
      if (!_stemsPlaying) return _startOffset;
      var elapsed = (_getCtx().currentTime - _startTimeCtx) * _playbackRate;
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

    isPlaying: function() { return _stemsPlaying; },

    /**
     * Read BPMixer.effectiveGains(songId) and set each stem's GainNode.
     * Call after any mute/solo/fader change.
     */
    applyMixer: function(songId) {
      _buildMasterIfNeeded();
      if (!global.BPMixer) return;
      var gains = global.BPMixer.effectiveGains(songId || _lastLoadedSongId);
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var rec = _stems[names[i]];
        if (!rec.gainNode) {
          rec.gainNode = _getCtx().createGain();
          rec.gainNode.connect(_masterGain);
        }
        var g = gains[names[i]] != null ? gains[names[i]] : 0;
        // Smooth ramp over 20ms to avoid clicks
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
      _stopAllSources(false);
      var names = Object.keys(_stems);
      for (var i = 0; i < names.length; i++) {
        var rec = _stems[names[i]];
        if (rec.gainNode) { try { rec.gainNode.disconnect(); } catch (e) {} }
      }
      _stems = {};
      _stemsPlaying = false;
      _startOffset = 0;
    },

    // ── Context access (for metronome / practice modules) ──
    getAudioContext: function() {
      try { return _getCtx(); } catch (e) { return null; }
    },

    // ── Test hooks ──
    _state: function() {
      return {
        playing: _stemsPlaying,
        offset: _startOffset,
        playbackRate: _playbackRate,
        stemCount: Object.keys(_stems).length,
        lastSongId: _lastLoadedSongId
      };
    }
  };

  // ── Export ────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BPTransport;
  } else if (global) {
    global.BPTransport = BPTransport;
  }
})(typeof window !== 'undefined' ? window : this);
