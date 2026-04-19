/* ============================================
   bp2-practice.js — Metronome, A/B Loop, Speed Control
   Band Player v2.0

   Metronome via AudioContext oscillator. A/B loop with snap-to-bar.
   Speed 0.5x-1.25x via transport playback rate.
   Auto-stops metronome on page hide.
   ============================================ */
(function(global) {
  'use strict';

  var _metroEnabled = false;
  var _metroBpm = 120;
  var _metroVolume = 0.5;
  var _metroLookahead = 0.1;
  var _metroInterval = 25;
  var _metroNextTick = 0;
  var _metroTimer = null;
  var _metroCtxRef = null;
  var _metroListeners = [];

  var _loopA = null, _loopB = null, _loopEnabled = false;
  var _barBoundaries = [];
  var _speed = 1.0;
  var SPEED_OPTIONS = [0.5, 0.75, 0.85, 1.0, 1.15, 1.25];

  function _scheduleTicks() {
    if (!_metroEnabled || !_metroCtxRef) return;
    var ctx = _metroCtxRef();
    if (!ctx) return;
    var now = ctx.currentTime;
    var spb = 60 / _metroBpm;
    if (_metroNextTick < now) _metroNextTick = now + 0.05;
    while (_metroNextTick < now + _metroLookahead) {
      _click(ctx, _metroNextTick);
      for (var i = 0; i < _metroListeners.length; i++) {
        try { _metroListeners[i]({ at: _metroNextTick }); } catch (e) {}
      }
      _metroNextTick += spb;
    }
  }

  function _click(ctx, at) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1000, at);
    gain.gain.setValueAtTime(_metroVolume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.03);
  }

  function _snapToBar(sec) {
    if (!_barBoundaries.length) return sec;
    var best = _barBoundaries[0], bestD = Math.abs(sec - best);
    for (var i = 1; i < _barBoundaries.length; i++) {
      var d = Math.abs(_barBoundaries[i] - sec);
      if (d < bestD) { best = _barBoundaries[i]; bestD = d; }
    }
    return bestD < 0.2 ? best : sec;
  }

  var BP2Practice = {
    SPEED_OPTIONS: SPEED_OPTIONS,
    setAudioContextRef: function(fn) { _metroCtxRef = fn; },
    setMetronomeBpm: function(bpm) { if (!isNaN(bpm)) _metroBpm = Math.max(20, Math.min(300, bpm)); },
    getMetronomeBpm: function() { return _metroBpm; },
    setMetronomeVolume: function(v) { _metroVolume = Math.max(0, Math.min(1, v)); },
    getMetronomeVolume: function() { return _metroVolume; },

    metronomeOn: function() {
      if (_metroEnabled) return;
      _metroEnabled = true;
      _metroNextTick = 0;
      if (typeof global.setInterval === 'function') {
        _metroTimer = global.setInterval(_scheduleTicks, _metroInterval);
      }
    },

    metronomeOff: function() {
      _metroEnabled = false;
      if (_metroTimer && typeof global.clearInterval === 'function') {
        global.clearInterval(_metroTimer);
        _metroTimer = null;
      }
    },

    isMetronomeOn: function() { return _metroEnabled; },
    onTick: function(fn) { _metroListeners.push(fn); },

    getTickAt: function(bpm, t0, n) { return t0 + (n * 60 / bpm); },

    setLoopA: function(sec) {
      if (sec == null) { _loopA = null; _loopEnabled = false; return; }
      _loopA = _barBoundaries.length ? _snapToBar(Math.max(0, sec)) : Math.max(0, sec);
    },
    setLoopB: function(sec) {
      if (sec == null) { _loopB = null; _loopEnabled = false; return; }
      _loopB = _barBoundaries.length ? _snapToBar(Math.max(0, sec)) : Math.max(0, sec);
      if (_loopA != null && _loopB > _loopA) _loopEnabled = true;
    },
    clearLoop: function() { _loopA = _loopB = null; _loopEnabled = false; },
    getLoop: function() { return { a: _loopA, b: _loopB, enabled: _loopEnabled }; },
    toggleLoopEnabled: function() { _loopEnabled = !_loopEnabled; return _loopEnabled; },

    shouldLoopNow: function(t) {
      if (!_loopEnabled || _loopA == null || _loopB == null) return null;
      return t >= _loopB ? _loopA : null;
    },

    setBarBoundaries: function(arr) {
      _barBoundaries = Array.isArray(arr) ? arr.slice().sort(function(a, b) { return a - b; }) : [];
    },

    setSpeed: function(rate) {
      var v = parseFloat(rate);
      if (isNaN(v)) return;
      var closest = SPEED_OPTIONS[0], bestD = Math.abs(v - closest);
      for (var i = 1; i < SPEED_OPTIONS.length; i++) {
        var d = Math.abs(SPEED_OPTIONS[i] - v);
        if (d < bestD) { closest = SPEED_OPTIONS[i]; bestD = d; }
      }
      _speed = closest;
    },
    getSpeed: function() { return _speed; },

    _resetAll: function() {
      this.metronomeOff();
      _metroBpm = 120; _metroVolume = 0.5; _metroListeners = [];
      _loopA = _loopB = null; _loopEnabled = false; _barBoundaries = [];
      _speed = 1.0;
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function() {
      if (document.hidden && _metroEnabled) BP2Practice.metronomeOff();
    });
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('beforeunload', function() {
        if (_metroEnabled) BP2Practice.metronomeOff();
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Practice;
  else if (global) global.BP2Practice = BP2Practice;
})(typeof window !== 'undefined' ? window : this);
