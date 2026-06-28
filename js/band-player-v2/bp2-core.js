/* ============================================
   bp2-core.js — Orchestrator, Event Bus, State Container
   Band Player v2.0

   WHAT IT DOES:
     Central hub. Holds all shared state. Provides pub/sub event bus.
     Sequences module initialization. Checks auth and determines
     whether to show onboarding gate or player.

   WHAT IT OWNS:
     - Event bus: on(event, fn), off(event, fn), emit(event, payload)
     - Shared state: get(key), set(key, value) — auto-emits 'state:key'
     - Firebase refs: db (Firestore), storage (Firebase Storage)
     - Auth context: user, role
     - Init sequence

   WHO CALLS IT:
     - band-player-v2.html calls BP2Core.init()
     - Every other bp2-* module uses on/emit/get/set

   DEPENDENCIES:
     - bp2-utils.js (must load first)
   ============================================ */
(function(global) {
  'use strict';

  // ── Supabase Storage (band-media) ────────────
  // Media (audio/charts/artwork) is served from a PRIVATE Supabase Storage
  // bucket via short-lived signed URLs minted at use. Firebase Storage stays
  // loaded underneath as a guarded fallback / clean rollback. The anon
  // (publishable) key is client-safe and intentionally committed; the
  // service_role key must NEVER appear here (RULE-S05).
  var SUPABASE_URL = 'https://rklvvuzedmadydmohouu.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oIOHXXN_pwkeoeAfcQkNbg_rJkDFNZK';
  var SUPABASE_BUCKET = 'band-media';
  var _supabase = null;

  function _initSupabase() {
    if (_supabase) return _supabase;
    // window.supabase is the UMD global from @supabase/supabase-js v2,
    // loaded alongside the Firebase Storage SDK in index.html's __loadBP2().
    if (global.supabase && typeof global.supabase.createClient === 'function') {
      try {
        _supabase = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        global.GBE_SUPABASE = _supabase;
      } catch (e) {
        console.warn('[BP2Core] Supabase client init failed:', e && e.message);
      }
    }
    return _supabase;
  }

  // Firestore song fields carry the FULL bucket path (e.g.
  // "band-media/audio/<id>.mp3") but objects were uploaded with STRIPPED keys
  // ("audio/<id>.mp3"). Strip the leading "band-media/" before createSignedUrl.
  function _supaKey(path) {
    return String(path || '').replace(/^band-media\//, '');
  }

  // ── Event Bus ────────────────────────────────
  var _listeners = {};

  function _on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }

  function _off(event, fn) {
    var arr = _listeners[event];
    if (!arr) return;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] === fn) arr.splice(i, 1);
    }
  }

  function _emit(event, payload) {
    var arr = _listeners[event];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) {
        console.warn('[BP2Core] listener error on "' + event + '":', e.message);
      }
    }
  }

  // ── State Container ──────────────────────────
  var _state = {
    // Playlists & songs
    playlists: [],
    songs: [],
    inventory: [],
    allSongsMap: {},
    currentPlaylist: null,
    playOrder: [],

    // Playback
    currentIndex: -1,
    isPlaying: false,
    volume: 0.8,
    prevVolume: 0.8,
    repeatMode: 'off',   // off | all | one

    // Edit mode
    editMode: false,
    editDirty: false,

    // Stems
    stemStatuses: {},
    expandedStems: {},
    playingStemId: null,

    // Practice tracking
    completedTracks: {},
    loggedThisSession: {},

    // Auth
    user: null,
    role: 'member',

    // Firebase
    db: null,
    storage: null
  };

  function _get(key) {
    var val = _state[key];
    // Return defensive copies for objects/arrays
    if (Array.isArray(val)) return val.slice();
    if (val && typeof val === 'object' && val.constructor === Object) {
      return Object.assign({}, val);
    }
    return val;
  }

  function _set(key, value) {
    var old = _state[key];
    _state[key] = value;
    _emit('state:' + key, { key: key, value: value, prev: old });
  }

  // Direct ref access (no copy — for performance-critical paths like rendering)
  function _ref(key) {
    return _state[key];
  }

  // ── Init ─────────────────────────────────────
  var _initialized = false;

  function _init(opts) {
    if (_initialized) return;
    _initialized = true;

    opts = opts || {};

    // Store Firebase refs
    _state.db = opts.db || null;
    _state.storage = opts.storage || null;

    // Create the Supabase Storage client once (media path).
    _initSupabase();

    // Auth context
    _state.user = opts.user || null;
    _state.role = opts.role || 'member';

    var skipGate = (_state.role === 'admin' || _state.role === 'band_manager');

    console.log('[BP2Core] init | uid:', _state.user ? _state.user.uid : 'none',
      '| role:', _state.role, '| db:', !!_state.db, '| storage:', !!_state.storage);

    if (skipGate) {
      _initPlayer();
    } else if (_state.user && _state.db) {
      // Check onboarding status
      _state.db.collection('users').doc(_state.user.uid).get().then(function(doc) {
        var data = doc.exists ? doc.data() : {};
        if (!data.confidentialityAcceptedAt) {
          _emit('auth:show-gate', { screen: 1 });
        } else {
          // Repair missing fields
          var repair = {};
          if (!data.roster_tier) repair.roster_tier = 'on_call';
          if (!data.activity) repair.activity = 'active';
          if (Object.keys(repair).length > 0) {
            _state.db.collection('users').doc(_state.user.uid).update(repair).catch(function() {});
          }
          _initPlayer();
        }
      }).catch(function() {
        if (typeof Toast !== 'undefined') Toast.error('Could not verify permissions. Please try again.');
      });
    } else {
      _emit('auth:show-gate', { screen: 1 });
    }
  }

  function _initPlayer() {
    _emit('player:init');
    _emit('playlist:load');
    _emit('inventory:load');
  }

  // ── Public API ───────────────────────────────
  var BP2Core = {
    // Event bus
    on: _on,
    off: _off,
    emit: _emit,

    // State
    get: _get,
    set: _set,
    ref: _ref,

    // Init
    init: _init,
    initPlayer: _initPlayer,

    // Convenience — frequently accessed
    getDb: function() { return _state.db; },
    getStorage: function() { return _state.storage; },
    // Supabase Storage singleton + key helper (media: audio/charts/artwork).
    // Lazily inits if not yet created (e.g. called before BP2Core.init()).
    getSupabase: function() { return _supabase || _initSupabase(); },
    supaBucket: function() { return SUPABASE_BUCKET; },
    supaKey: _supaKey,
    getUser: function() { return _state.user; },
    getRole: function() { return _state.role; },
    isManager: function() { return _state.role === 'admin' || _state.role === 'band_manager'; },
    canEdit: function() { return _state.role === 'admin' || _state.role === 'band_manager' || _state.role === 'artist'; },

    // Reset (for testing)
    _reset: function() {
      _initialized = false;
      _listeners = {};
      for (var k in _state) {
        if (Array.isArray(_state[k])) _state[k] = [];
        else if (_state[k] && typeof _state[k] === 'object' && _state[k].constructor === Object) _state[k] = {};
        else if (typeof _state[k] === 'boolean') _state[k] = false;
        else if (typeof _state[k] === 'number') _state[k] = k === 'volume' ? 0.8 : (k === 'currentIndex' ? -1 : 0);
        else if (typeof _state[k] === 'string') _state[k] = k === 'repeatMode' ? 'off' : (k === 'role' ? 'member' : '');
        else _state[k] = null;
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Core;
  } else if (global) {
    global.BP2Core = BP2Core;
  }
})(typeof window !== 'undefined' ? window : this);
