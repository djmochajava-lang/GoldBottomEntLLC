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

  // E2 — pitch-preserving time-stretch worklet. Loaded lazily; if it fails to
  // load (older engine / fetch error) we fall back to the legacy playbackRate
  // path (which pitch-shifts) so playback NEVER breaks — worst case is the old
  // chipmunk behavior, never silence.
  var _workletState = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'failed'
  var _workletPromise = null;
  var WORKLET_URL = 'js/band-player-v2/bp2-timestretch-worklet.js?v=1';

  function _loadWorklet() {
    if (_workletPromise) return _workletPromise;
    var ctx = _getCtx();
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
      _workletState = 'failed';
      _workletPromise = Promise.resolve(false);
      return _workletPromise;
    }
    _workletState = 'loading';
    _workletPromise = ctx.audioWorklet.addModule(WORKLET_URL).then(function() {
      _workletState = 'ready';
      return true;
    }).catch(function(e) {
      console.warn('[BP2Transport] time-stretch worklet load failed — falling back to playbackRate:', e && e.message);
      _workletState = 'failed';
      return false;
    });
    return _workletPromise;
  }

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
    src.onended = function() {
      if (_playing && !rec._seeking) _emit('ended', { stem: name });
    };

    // E2: pitch-preserving path. If the worklet is READY and we're off 1.0x,
    // route source(rate 1.0) -> timeStretch(tempo=_rate) -> gainNode so the
    // TEMPO changes but the PITCH is preserved. Otherwise use the legacy
    // playbackRate path (pitch-shifts) — the safe fallback.
    if (rec.stretch) { try { rec.stretch.disconnect(); } catch (e) {} rec.stretch = null; }
    if (_workletState === 'ready' && Math.abs(_rate - 1.0) > 1e-3 &&
        typeof global.AudioWorkletNode === 'function') {
      try {
        var node = new global.AudioWorkletNode(ctx, 'bp2-timestretch', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]
        });
        node.parameters.get('tempo').value = _rate;
        src.playbackRate.value = 1.0;         // source at natural pitch; worklet does tempo
        src.connect(node);
        node.connect(rec.gainNode);
        rec.stretch = node;
        rec.source = src;
        return src;
      } catch (e) {
        console.warn('[BP2Transport] worklet node create failed — playbackRate fallback:', e && e.message);
      }
    }
    // Legacy / fallback path (pitch-shifts).
    src.playbackRate.value = _rate;
    src.connect(rec.gainNode);
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
      if (rec.stretch) { try { rec.stretch.disconnect(); } catch (e) {} rec.stretch = null; }
      rec._seeking = false;
    }
  }

  // Rebuild all playing sources from the current offset — used when the graph
  // topology must change (engaging/disengaging the time-stretch worklet) since
  // a node can't be inserted into a running source chain.
  function _rebuildPlaying() {
    if (!_playing) return;
    var offset = BP2Transport.currentTime();
    _stopAll(true);
    _startOffset = Math.max(0, offset);
    var ctx = _getCtx();
    var when = ctx.currentTime + 0.05;
    var names = Object.keys(_stems);
    for (var i = 0; i < names.length; i++) {
      var src = _createSource(names[i], _startOffset);
      if (src) src.start(when, _startOffset);
    }
    _startTimeCtx = when;
    if (global.BP2Mixer) BP2Transport.applyMixer(_lastSongId);
  }

  var BP2Transport = {
    load: function(songId, stems) {
      if (!stems || typeof stems !== 'object') return Promise.reject(new Error('stems required'));
      _lastSongId = songId;
      this.destroy();
      _buildMaster();
      _loadWorklet();  // E2: warm the pitch-preserving worklet so speed changes are ready
      var ctx = _getCtx();
      var names = Object.keys(stems);
      var loaders = names.map(function(name) {
        return fetch(stems[name], { credentials: 'omit', mode: 'cors' })
          .then(function(r) { if (!r.ok) throw new Error('Fetch ' + r.status + ' for ' + name); return r.arrayBuffer(); })
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
      var prev = _rate;
      _rate = Math.max(0.25, Math.min(4.0, rate));
      var atOne = Math.abs(_rate - 1.0) < 1e-3;

      // If we have (or want) the pitch-preserving worklet, ensure it's loaded,
      // then rebuild the graph so the source chain includes/excludes the
      // time-stretch node correctly. A node can't be spliced into a running
      // chain, so crossing between the 1.0x (no worklet) and off-1.0x (worklet)
      // states — or changing tempo while the worklet is active — rebuilds.
      var names = Object.keys(_stems);

      function applyToLive() {
        for (var i = 0; i < names.length; i++) {
          var rec = _stems[names[i]];
          if (!rec) continue;
          if (rec.stretch && rec.stretch.parameters) {
            // worklet active — just retune tempo (no rebuild, seamless)
            try { rec.stretch.parameters.get('tempo').value = _rate; } catch (e) {}
          } else if (rec.source && _workletState !== 'ready') {
            // legacy path — playbackRate (pitch-shifts)
            rec.source.playbackRate.value = _rate;
          }
        }
      }

      if (atOne) {
        // Going back to 1.0x: if a worklet is spliced in, rebuild to drop it
        // (passthrough anyway, but keeps the graph clean); else just set rate.
        var hasStretch = names.some(function(n){ return _stems[n] && _stems[n].stretch; });
        if (hasStretch && _playing) { _rebuildPlaying(); }
        else { applyToLive(); }
        return;
      }

      // Off 1.0x — prefer the worklet.
      if (_workletState === 'ready') {
        var haveStretch = names.every(function(n){ return !_stems[n] || _stems[n].stretch; });
        if (haveStretch) { applyToLive(); }          // already on worklet — retune
        else if (_playing) { _rebuildPlaying(); }     // splice worklet in
        else { applyToLive(); }
      } else if (_workletState === 'unloaded' || _workletState === 'loading') {
        _loadWorklet().then(function(ok){
          if (ok && Math.abs(_rate - 1.0) > 1e-3 && _playing) _rebuildPlaying();
          else applyToLive();
        });
      } else {
        // worklet failed — legacy pitch-shift fallback
        applyToLive();
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
