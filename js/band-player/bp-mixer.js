/* ============================================
   bp-mixer.js — Per-Stem Mixer State (FRD-20 FR-4.5.x)

   Pure state module — no DOM, no Web Audio API here. Consumed by
   bp-transport.js (which wires the gain nodes) and the UI layer (which
   renders faders). That split lets us unit-test the mixer logic in Node.

   State shape (per song):
     faders:  { stemName: 0..100 }          // 0 = silent, 100 = unity
     muted:   { stemName: true|false }
     soloed:  { stemName: true|false }

   Solo semantics (SR match FR-4.5.2):
     - If ANY stem is soloed, only those stems are audible.
     - Multi-solo is additive (solo guitar + solo drums → both audible).
     - Muted state is preserved independently; a muted stem stays silent
       even if soloed elsewhere (unless user explicitly un-mutes it).

   Persistence:
     - localStorage key: 'bp-mix-v1-{userId}-{songId}'
     - Caller passes load/save; module has no I/O

   Backward compat:
     - New module; existing band-player.js continues to work.
     - UI layer opts in by invoking BPMixer.init(...) after the existing
       BandPlayer.init(). See tests/fixtures for integration example.
   ============================================ */
(function(global) {
  'use strict';

  // ── Constants ────────────────────────────────
  var MIXER_VERSION = 1;
  var DEFAULT_FADER = 80;   // 80% default gain — matches existing volume default
  var MAX_FADER    = 100;

  // ── Private state ─────────────────────────────
  // Shape: { songId: { faders: {...}, muted: {...}, soloed: {...} } }
  var _state = {};
  var _stemNames = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'];

  // ── Utilities ────────────────────────────────
  function clamp(v, lo, hi) {
    if (v == null || isNaN(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
  }

  function _defaultSongState() {
    var faders = {};
    var muted = {};
    var soloed = {};
    for (var i = 0; i < _stemNames.length; i++) {
      faders[_stemNames[i]] = DEFAULT_FADER;
      muted[_stemNames[i]] = false;
      soloed[_stemNames[i]] = false;
    }
    return { faders: faders, muted: muted, soloed: soloed };
  }

  function _ensureSong(songId) {
    if (!songId) throw new Error('BPMixer: songId required');
    if (!_state[songId]) _state[songId] = _defaultSongState();
    return _state[songId];
  }

  // ── Public API ───────────────────────────────
  var BPMixer = {
    VERSION: MIXER_VERSION,
    DEFAULT_FADER: DEFAULT_FADER,

    /**
     * Register the full stem list for a song (e.g. ['vocals','drums',...]).
     * Idempotent. Any stem not in the list still gets a default entry.
     */
    registerStems: function(stemNames) {
      if (!Array.isArray(stemNames)) return;
      _stemNames = stemNames.slice();
    },

    /**
     * Get the current state for a song (creates default if absent).
     * Returns a defensive copy so caller mutation won't affect state.
     */
    getState: function(songId) {
      var s = _ensureSong(songId);
      return {
        faders: Object.assign({}, s.faders),
        muted:  Object.assign({}, s.muted),
        soloed: Object.assign({}, s.soloed)
      };
    },

    /**
     * Set fader value 0..100 for one stem on a song.
     */
    setFader: function(songId, stemName, value) {
      var s = _ensureSong(songId);
      s.faders[stemName] = clamp(parseInt(value, 10), 0, MAX_FADER);
    },

    /**
     * Toggle or explicitly set mute for a stem.
     * - setMute(songId, stemName) with no 3rd arg toggles
     * - setMute(songId, stemName, true|false) sets explicitly
     */
    setMute: function(songId, stemName, forceValue) {
      var s = _ensureSong(songId);
      if (forceValue === undefined) s.muted[stemName] = !s.muted[stemName];
      else s.muted[stemName] = !!forceValue;
    },

    /**
     * Toggle or explicitly set solo for a stem. Multi-solo is additive.
     */
    setSolo: function(songId, stemName, forceValue) {
      var s = _ensureSong(songId);
      if (forceValue === undefined) s.soloed[stemName] = !s.soloed[stemName];
      else s.soloed[stemName] = !!forceValue;
    },

    /**
     * Clear all solos on a song.
     */
    clearSolo: function(songId) {
      var s = _ensureSong(songId);
      for (var k in s.soloed) s.soloed[k] = false;
    },

    /**
     * Reset all faders and mute/solo to defaults.
     */
    reset: function(songId) {
      _state[songId] = _defaultSongState();
    },

    /**
     * Compute the effective gain (0..1) for a stem considering solo, mute, fader.
     * This is what the Web Audio layer should feed into the GainNode.value.
     *
     * Rules:
     *   1. If anyStemSoloed(song) AND !soloed[stem] → gain = 0
     *   2. If muted[stem] → gain = 0
     *   3. Otherwise → fader / 100
     */
    effectiveGain: function(songId, stemName) {
      var s = _ensureSong(songId);
      var anySolo = false;
      for (var k in s.soloed) { if (s.soloed[k]) { anySolo = true; break; } }

      if (anySolo && !s.soloed[stemName]) return 0;
      if (s.muted[stemName])              return 0;
      var f = s.faders[stemName];
      if (f == null) f = DEFAULT_FADER;
      return clamp(f, 0, MAX_FADER) / MAX_FADER;
    },

    /**
     * Map of stemName → effective gain (0..1).
     */
    effectiveGains: function(songId) {
      var s = _ensureSong(songId);
      var out = {};
      var names = Object.keys(s.faders);
      for (var i = 0; i < names.length; i++) {
        out[names[i]] = this.effectiveGain(songId, names[i]);
      }
      return out;
    },

    /**
     * Serialize a song's state for localStorage.
     */
    serialize: function(songId) {
      var s = _ensureSong(songId);
      return JSON.stringify({ v: MIXER_VERSION, state: s });
    },

    /**
     * Hydrate from a serialized payload. Returns true on success.
     * Silent on version mismatch (falls back to defaults).
     */
    hydrate: function(songId, payload) {
      if (!payload) return false;
      try {
        var parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!parsed || parsed.v !== MIXER_VERSION || !parsed.state) return false;
        // Ensure all current stems are represented; unknown keys ignored
        var hydrated = _defaultSongState();
        var src = parsed.state;
        for (var k in hydrated.faders) {
          if (src.faders && typeof src.faders[k] === 'number') hydrated.faders[k] = clamp(src.faders[k], 0, MAX_FADER);
          if (src.muted  && typeof src.muted[k]  === 'boolean') hydrated.muted[k]  = src.muted[k];
          if (src.soloed && typeof src.soloed[k] === 'boolean') hydrated.soloed[k] = src.soloed[k];
        }
        _state[songId] = hydrated;
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * Build the localStorage key per SR-5.7.2.
     */
    storageKey: function(userId, songId) {
      // Namespace with version so we can bump schema without leaking stale state
      return 'bp-mix-v' + MIXER_VERSION + '-' + (userId || 'anon') + '-' + songId;
    },

    // ── Test-only reset of module state ──
    _resetAll: function() { _state = {}; }
  };

  // ── Export ────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BPMixer;
  } else if (global) {
    global.BPMixer = BPMixer;
  }
})(typeof window !== 'undefined' ? window : this);
