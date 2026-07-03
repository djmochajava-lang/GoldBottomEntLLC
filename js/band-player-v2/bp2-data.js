/* ============================================
   bp2-data.js — Read Shim (Firestore ↔ Supabase)
   Band Player v2.0

   WHAT IT DOES:
     A thin read shim for the songs/playlists catalog. Each public function
     dispatches to one of TWO private implementations behind a per-collection
     flag — window.BP2_READ_SOURCE = { songs:'firestore', playlists:'firestore' }.

       - Firestore impl  = today's EXACT .get() logic, relocated here verbatim
                           (the rollback path; kept byte-faithful).
       - Supabase impl   = supabase.from(...).select(...) on the parallel copy,
                           normalizing each row's lossless raw_doc back to the
                           Firestore doc shape ({id, ...rawDoc}). Dormant until
                           the flag is flipped to 'supabase'.

     Each function resolves to a PLAIN array of {id, ...} objects — NOT a
     Firestore snapshot. Consumers in bp2-playlist.js adapt to plain arrays.

     The flag DEFAULTS to 'firestore' for BOTH collections (the dark build).
     The songs/playlists FLIP is CEO real-device gated (D-20) — this module
     only BUILDS the path; it does not flip it.

   WHO CALLS IT:
     - bp2-playlist.js — loadPlaylists / loadInventory / selectPlaylist /
       grantDefaultPlaylists call BP2Data.* instead of reading Firestore.

   DEPENDENCIES:
     - bp2-core.js (BP2Core.getDb() for Firestore, BP2Core.getSupabase()
       for the Supabase client — anon key only; no key is ever held here).
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _getCore() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  // ── Source selection per collection ──────────
  // undefined and any non-'supabase' value => 'firestore' (safe default).
  function _src(collection) {
    var cfg = global.BP2_READ_SOURCE;
    return (cfg && cfg[collection]) === 'supabase' ? 'supabase' : 'firestore';
  }

  // Normalize a Supabase row back to the Firestore doc shape.
  // raw_doc is the lossless original Firestore document (already a parsed JS
  // object — supabase-js returns jsonb parsed; do NOT JSON.parse). The PK `id`
  // is overlaid last so it is authoritative. songOrder lives inside raw_doc and
  // passes through byte-for-byte (no sort/dedupe/reorder).
  function _normalize(row) {
    return Object.assign({}, row.raw_doc, { id: row.id });
  }

  // ── Firestore implementations (the rollback path — byte-faithful) ──

  function _fsGetPlaylists() {
    var c = _getCore();
    var db = c && c.getDb();
    if (!db) return Promise.resolve([]);
    return db.collection('playlists').orderBy('createdAt', 'desc').get()
      .then(function(snap) {
        var out = [];
        snap.forEach(function(doc) {
          out.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return out;
      });
  }

  function _fsGetSongs() {
    var c = _getCore();
    var db = c && c.getDb();
    if (!db) return Promise.resolve([]);
    return db.collection('songs').orderBy('createdAt', 'desc').get()
      .then(function(snap) {
        var out = [];
        snap.forEach(function(doc) {
          out.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return out;
      });
  }

  function _fsGetSongsByIds(ids) {
    var c = _getCore();
    var db = c && c.getDb();
    if (!db) return Promise.resolve([]);
    ids = ids || [];
    if (ids.length === 0) return Promise.resolve([]);
    // Firestore in-queries max 10 — chunk into batches of 10.
    var batches = [];
    for (var b = 0; b < ids.length; b += 10) {
      batches.push(ids.slice(b, b + 10));
    }
    return Promise.all(batches.map(function(batch) {
      return db.collection('songs').where(firebase.firestore.FieldPath.documentId(), 'in', batch).get();
    })).then(function(snapshots) {
      var out = [];
      snapshots.forEach(function(snap) {
        snap.forEach(function(doc) {
          out.push(Object.assign({ id: doc.id }, doc.data()));
        });
      });
      return out;
    });
  }

  function _fsGetSongById(songId) {
    var c = _getCore();
    var db = c && c.getDb();
    if (!db || !songId) return Promise.resolve(null);
    return db.collection('songs').doc(songId).get()
      .then(function(doc) {
        return doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
      });
  }

  function _fsGetDefaultPlaylists() {
    var c = _getCore();
    var db = c && c.getDb();
    if (!db) return Promise.resolve([]);
    return db.collection('playlists').where('isDefault', '==', true).get()
      .then(function(snap) {
        var out = [];
        snap.forEach(function(doc) {
          out.push(Object.assign({ id: doc.id }, doc.data()));
        });
        return out;
      });
  }

  // ── Supabase implementations (the flip target — dormant until flag flips) ──

  function _sbGetPlaylists() {
    var c = _getCore();
    var sb = c && c.getSupabase ? c.getSupabase() : null;
    if (!sb) return Promise.resolve([]);
    return sb.from('playlists').select('*').then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return (res.data || []).map(_normalize);
    });
  }

  function _sbGetSongs() {
    var c = _getCore();
    var sb = c && c.getSupabase ? c.getSupabase() : null;
    if (!sb) return Promise.resolve([]);
    return sb.from('songs').select('*').then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return (res.data || []).map(_normalize);
    });
  }

  function _sbGetSongsByIds(ids) {
    var c = _getCore();
    var sb = c && c.getSupabase ? c.getSupabase() : null;
    if (!sb) return Promise.resolve([]);
    ids = ids || [];
    if (ids.length === 0) return Promise.resolve([]);
    // Postgres has no in-list limit — a SINGLE call, no chunking.
    return sb.from('songs').select('*').in('id', ids).then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return (res.data || []).map(_normalize);
    });
  }

  function _sbGetSongById(songId) {
    var c = _getCore();
    var sb = c && c.getSupabase ? c.getSupabase() : null;
    if (!sb || !songId) return Promise.resolve(null);
    // Single-id case of _sbGetSongsByIds — same songs catalog + _normalize path.
    // maybeSingle(): 0 rows -> null (not an error); charts live intact in raw_doc.
    return sb.from('songs').select('*').eq('id', songId).maybeSingle().then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return res.data ? _normalize(res.data) : null;
    });
  }

  function _sbGetDefaultPlaylists() {
    var c = _getCore();
    var sb = c && c.getSupabase ? c.getSupabase() : null;
    if (!sb) return Promise.resolve([]);
    // Postgres column is `is_default`; raw_doc carries the original `isDefault`.
    return sb.from('playlists').select('*').eq('is_default', true).then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return (res.data || []).map(_normalize);
    });
  }

  // ── Bench-scope read (F4 — replaces the direct Firestore gigs query) ──
  // Reads the authenticated client's OWN rows of the Supabase
  // session_assignment_readmodel (own-row RLS enforces the scope server-side:
  // USING(musician_uid=(auth.uid())::text) — no service-role key, anon/
  // authenticated client only). Returns the set of session_ids the musician is
  // assigned to (status invited|accepted|tentative; declined excluded).
  //
  // NOTE (F4-C2 documented no-op): the intended assignment->playlist link is
  // session_id -> band_sessions.playlist_id, but that column is NULL on all
  // live rows and is NOT in any client-readable whitelist today, so there is
  // NO client-readable path to a playlist id right now. This shim therefore
  // returns the assigned session_ids; the CONSUMER resolves them to
  // scopedPlaylistIds, which is EMPTY in practice today (safe no-op) — the
  // scope degrades to the public-default rehearsal set. If a future story
  // publishes a playlist link it can flow through this same path. No new
  // publish leg / DDL is invented here (explicitly deferred / out of scope).
  function _sbGetBenchScope() {
    var c = _getCore();
    var sb = c && c.getSupabase ? c.getSupabase() : null;
    if (!sb) return Promise.resolve([]);
    return sb.from('session_assignment_readmodel')
      .select('session_id, status')
      .in('status', ['invited', 'accepted', 'tentative'])
      .then(function(res) {
        if (res.error) return Promise.reject(res.error);
        var ids = {};
        (res.data || []).forEach(function(row) {
          if (row && row.session_id) ids[row.session_id] = true;
        });
        return Object.keys(ids);
      });
  }

  // ── Public API ───────────────────────────────
  var BP2Data = {
    getPlaylists: function() {
      return _src('playlists') === 'supabase' ? _sbGetPlaylists() : _fsGetPlaylists();
    },
    getSongs: function() {
      return _src('songs') === 'supabase' ? _sbGetSongs() : _fsGetSongs();
    },
    getSongsByIds: function(ids) {
      return _src('songs') === 'supabase' ? _sbGetSongsByIds(ids) : _fsGetSongsByIds(ids);
    },
    // F4: single-song read (charts picker). Honors the same per-collection
    // 'songs' flag as getSongs/getSongsByIds. Resolves to a single normalized
    // {id, ...raw_doc} object (charts intact) or null if not found.
    getSongById: function(songId) {
      return _src('songs') === 'supabase' ? _sbGetSongById(songId) : _fsGetSongById(songId);
    },
    getDefaultPlaylists: function() {
      return _src('playlists') === 'supabase' ? _sbGetDefaultPlaylists() : _fsGetDefaultPlaylists();
    },
    // F4: own-row bench-scope read from the F3-published Supabase readmodel.
    // Always Supabase (no Firestore rollback path — this REPLACES the direct
    // Firestore gigs scoping query that F4 retires). Returns an array of the
    // session_ids the authenticated musician is assigned to.
    getBenchScope: function() {
      return _sbGetBenchScope();
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Data;
  } else if (global) {
    global.BP2Data = BP2Data;
  }
})(typeof window !== 'undefined' ? window : this);
