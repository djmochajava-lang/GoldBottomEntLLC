/* ============================================
   bp-practice.js — Practice Primitives (FRD-20 FR-4.6.x)

   Metronome + A/B Loop + Playback Speed.

   Pure state module for testability. The UI layer reads state and renders;
   the integration with bp-transport.js is done by the player shell (not here).

   - Metronome: schedules a click tone via AudioContext at BPM intervals.
                Provides getTickAt(bpm, t) for unit tests.
   - A/B Loop:  stores marker positions (seconds); caller's transport tick
                checks shouldLoopNow(currentTime) and seeks A.
   - Speed:     simple 0.5..1.25 multiplier exposed to transport.
                Pitch preservation deferred to Phase 2 (SoundTouch library).
   ============================================ */
(function(global) {
  'use strict';

  // ── Metronome ────────────────────────────────
  var _metroEnabled = false;
  var _metroBpm = 120;
  var _metroVolume = 0.5;
  var _metroLookaheadSec = 0.1;
  var _metroScheduleIntervalMs = 25;
  var _metroNextTickAt = 0;      // AudioContext seconds of next click
  var _metroTimer = null;
  var _metroCtxRef = null;       // provided by caller: () => AudioContext
  var _metroListeners = [];

  function _scheduleNextTicks() {
    if (!_metroEnabled || !_metroCtxRef) return;
    var ctx = _metroCtxRef();
    if (!ctx) return;
    var now = ctx.currentTime;
    var secondsPerBeat = 60 / _metroBpm;

    // Initialize next-tick if stale
    if (_metroNextTickAt < now) _metroNextTickAt = now + 0.05;

    while (_metroNextTickAt < now + _metroLookaheadSec) {
      _scheduleClick(ctx, _metroNextTickAt);
      for (var i = 0; i < _metroListeners.length; i++) {
        try { _metroListeners[i]({ at: _metroNextTickAt }); } catch (e) { /* ignore */ }
      }
      _metroNextTickAt += secondsPerBeat;
    }
  }

  function _scheduleClick(ctx, atTime) {
    // Short 0.03s beep at 1000 Hz (subtle, not ear-splitting)
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1000, atTime);
    gain.gain.setValueAtTime(_metroVolume, atTime);
    gain.gain.exponentialRampToValueAtTime(0.001, atTime + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(atTime);
    osc.stop(atTime + 0.03);
  }

  // ── A/B Loop ─────────────────────────────────
  var _loopA = null;  // seconds, or null
  var _loopB = null;
  var _loopEnabled = false;
  var _barBoundaries = [];  // optional, for snap-to-bar

  // ── Speed ────────────────────────────────────
  var _speed = 1.0;
  var SPEED_OPTIONS = [0.5, 0.75, 0.85, 1.0, 1.15, 1.25];

  // ── Public API ───────────────────────────────
  var BPPractice = {
    SPEED_OPTIONS: SPEED_OPTIONS,

    // ── Metronome ──
    /**
     * Set the AudioContext provider (caller supplies so we share with transport).
     * Example: BPPractice.setAudioContextRef(() => sharedContext);
     */
    setAudioContextRef: function(fn) { _metroCtxRef = fn; },

    setMetronomeBpm: function(bpm) {
      if (isNaN(bpm)) return;
      _metroBpm = Math.max(20, Math.min(300, bpm));
    },
    getMetronomeBpm: function() { return _metroBpm; },

    setMetronomeVolume: function(v) { _metroVolume = Math.max(0, Math.min(1, v)); },
    getMetronomeVolume: function() { return _metroVolume; },

    metronomeOn: function() {
      if (_metroEnabled) return;
      _metroEnabled = true;
      _metroNextTickAt = 0; // will be reset by first schedule
      if (typeof global.setInterval === 'function') {
        _metroTimer = global.setInterval(_scheduleNextTicks, _metroScheduleIntervalMs);
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

    /**
     * Subscribe to tick events (e.g. for visual downbeat flash).
     * Respects prefers-reduced-motion — UI is responsible for that gate.
     */
    onTick: function(fn) { _metroListeners.push(fn); },

    /**
     * Compute the absolute time of the Nth tick starting from t0 at the given BPM.
     * Pure; no audio output. For unit tests.
     */
    getTickAt: function(bpm, t0, n) {
      var secondsPerBeat = 60 / bpm;
      return t0 + (n * secondsPerBeat);
    },

    // ── A/B Loop ──
    setLoopA: function(seconds) {
      if (seconds == null) { _loopA = null; _loopEnabled = false; return; }
      _loopA = Math.max(0, seconds);
      // Snap to nearest bar if bar boundaries configured and within 0.1s
      if (_barBoundaries.length) {
        _loopA = this._snapToBar(_loopA);
      }
    },
    setLoopB: function(seconds) {
      if (seconds == null) { _loopB = null; _loopEnabled = false; return; }
      _loopB = Math.max(0, seconds);
      if (_barBoundaries.length) {
        _loopB = this._snapToBar(_loopB);
      }
      // Auto-enable loop when both markers are set and B > A
      if (_loopA != null && _loopB > _loopA) _loopEnabled = true;
    },
    clearLoop: function() { _loopA = null; _loopB = null; _loopEnabled = false; },

    getLoop: function() {
      return { a: _loopA, b: _loopB, enabled: _loopEnabled };
    },

    toggleLoopEnabled: function() {
      _loopEnabled = !_loopEnabled;
      return _loopEnabled;
    },

    /**
     * Given current playback time, return the seconds to seek to (A) if we've
     * crossed B while looping. Returns null otherwise.
     */
    shouldLoopNow: function(currentTimeSec) {
      if (!_loopEnabled || _loopA == null || _loopB == null) return null;
      if (currentTimeSec >= _loopB) return _loopA;
      return null;
    },

    /**
     * Configure bar boundaries for snap-to-bar (FR-4.6.2).
     * Caller passes sorted array of seconds for bar starts.
     */
    setBarBoundaries: function(arr) {
      _barBoundaries = Array.isArray(arr) ? arr.slice().sort(function(a,b){return a-b;}) : [];
    },

    _snapToBar: function(sec) {
      if (!_barBoundaries.length) return sec;
      var best = _barBoundaries[0];
      var bestDelta = Math.abs(sec - best);
      for (var i = 1; i < _barBoundaries.length; i++) {
        var d = Math.abs(_barBoundaries[i] - sec);
        if (d < bestDelta) { best = _barBoundaries[i]; bestDelta = d; }
      }
      // Only snap if within 200ms
      return bestDelta < 0.2 ? best : sec;
    },

    // ── Speed ──
    setSpeed: function(rate) {
      var v = parseFloat(rate);
      if (isNaN(v)) return;
      // Find the closest supported option
      var closest = SPEED_OPTIONS[0];
      var bestDelta = Math.abs(v - closest);
      for (var i = 1; i < SPEED_OPTIONS.length; i++) {
        var d = Math.abs(SPEED_OPTIONS[i] - v);
        if (d < bestDelta) { closest = SPEED_OPTIONS[i]; bestDelta = d; }
      }
      _speed = closest;
    },
    getSpeed: function() { return _speed; },

    // ── Test hooks ──
    _resetAll: function() {
      this.metronomeOff();
      _metroBpm = 120;
      _metroVolume = 0.5;
      _metroListeners = [];
      _loopA = _loopB = null;
      _loopEnabled = false;
      _barBoundaries = [];
      _speed = 1.0;
    }
  };

  // ── Auto-cleanup: stop metronome when page is hidden or unloaded ──
  // Prevents the click track from playing forever in the background
  // when the user switches tabs, minimizes, or navigates away.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function() {
      if (document.hidden && _metroEnabled) {
        BPPractice.metronomeOff();
      }
    });
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('beforeunload', function() {
        if (_metroEnabled) BPPractice.metronomeOff();
      });
    }
  }

  // ── Export ────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BPPractice;
  } else if (global) {
    global.BPPractice = BPPractice;
  }
})(typeof window !== 'undefined' ? window : this);
