/* ============================================
   bp2-mixer.js — Per-Stem Fader, Mute, Solo State
   Band Player v2.0

   Pure state module — NO DOM, NO Web Audio.
   Tracks fader (0-100), mute, solo per stem per song.
   Computes effectiveGain. Serializes to localStorage.

   WHO CALLS IT:
     - bp2-render-stems.js reads state for UI
     - bp2-transport.js reads effectiveGains for GainNodes
   ============================================ */
(function(global) {
  'use strict';

  var VERSION = 1;
  var DEFAULT_FADER = 80;
  var MAX_FADER = 100;
  var _state = {};
  var _stemNames = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'];

  function clamp(v, lo, hi) {
    if (v == null || isNaN(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
  }

  function _default() {
    var f = {}, m = {}, s = {};
    for (var i = 0; i < _stemNames.length; i++) {
      f[_stemNames[i]] = DEFAULT_FADER;
      m[_stemNames[i]] = false;
      s[_stemNames[i]] = false;
    }
    return { faders: f, muted: m, soloed: s };
  }

  function _ensure(songId) {
    if (!songId) return _default();
    if (!_state[songId]) _state[songId] = _default();
    return _state[songId];
  }

  var BP2Mixer = {
    VERSION: VERSION,
    DEFAULT_FADER: DEFAULT_FADER,

    registerStems: function(names) {
      if (Array.isArray(names)) _stemNames = names.slice();
    },

    getState: function(songId) {
      var s = _ensure(songId);
      return { faders: Object.assign({}, s.faders), muted: Object.assign({}, s.muted), soloed: Object.assign({}, s.soloed) };
    },

    setFader: function(songId, stem, value) {
      _ensure(songId).faders[stem] = clamp(parseInt(value, 10), 0, MAX_FADER);
    },

    setMute: function(songId, stem, force) {
      var s = _ensure(songId);
      s.muted[stem] = force === undefined ? !s.muted[stem] : !!force;
    },

    setSolo: function(songId, stem, force) {
      var s = _ensure(songId);
      s.soloed[stem] = force === undefined ? !s.soloed[stem] : !!force;
    },

    clearSolo: function(songId) {
      var s = _ensure(songId);
      for (var k in s.soloed) s.soloed[k] = false;
    },

    reset: function(songId) { _state[songId] = _default(); },

    effectiveGain: function(songId, stem) {
      var s = _ensure(songId);
      var anySolo = false;
      for (var k in s.soloed) { if (s.soloed[k]) { anySolo = true; break; } }
      if (anySolo && !s.soloed[stem]) return 0;
      if (s.muted[stem]) return 0;
      var f = s.faders[stem];
      if (f == null) f = DEFAULT_FADER;
      return clamp(f, 0, MAX_FADER) / MAX_FADER;
    },

    effectiveGains: function(songId) {
      var s = _ensure(songId);
      var out = {};
      var names = Object.keys(s.faders);
      for (var i = 0; i < names.length; i++) out[names[i]] = this.effectiveGain(songId, names[i]);
      return out;
    },

    serialize: function(songId) {
      return JSON.stringify({ v: VERSION, state: _ensure(songId) });
    },

    hydrate: function(songId, payload) {
      if (!payload) return false;
      try {
        var parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!parsed || parsed.v !== VERSION || !parsed.state) return false;
        var h = _default();
        var src = parsed.state;
        for (var k in h.faders) {
          if (src.faders && typeof src.faders[k] === 'number') h.faders[k] = clamp(src.faders[k], 0, MAX_FADER);
          if (src.muted && typeof src.muted[k] === 'boolean') h.muted[k] = src.muted[k];
          if (src.soloed && typeof src.soloed[k] === 'boolean') h.soloed[k] = src.soloed[k];
        }
        _state[songId] = h;
        return true;
      } catch (e) { return false; }
    },

    storageKey: function(userId, songId) {
      return 'bp2-mix-v' + VERSION + '-' + (userId || 'anon') + '-' + songId;
    },

    _resetAll: function() { _state = {}; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Mixer;
  else if (global) global.BP2Mixer = BP2Mixer;
})(typeof window !== 'undefined' ? window : this);
