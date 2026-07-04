/* ============================================
   bp2-write.js — Write Shim (Firestore → Supabase), DARK/UNWIRED
   Band Player v2.0

   PLANB-2 (story-planb2-write-shim-dual-drive). Narrow write shim covering
   5 DISTINCT OPERATIONS across 7 real write call sites (CTO fresh-grep
   re-derivation, verdict_planb2_writeshim_dualdrive_2026_07_04 — the plan
   doc's stale "15 call sites" claim is NOT the source of truth here):

     1. Confidentiality signature accept   — bp2-auth.js Screen 1
     2. House-band/freelance agreement accept — bp2-auth.js Screen 2 (non-PII leg)
     3. Payment-setup mark                 — bp2-auth.js Screen 2 (non-PII leg)
     4. Stems request-trigger              — bp2-stems.js
     5. Playlist scoped-field update       — bp2-edit.js / bp2-playlist.js / bp2-permissions.js

   THIS STORY SHIPS NOTHING LIVE-FACING. bp2-write.js is a standalone,
   UNUSED module this story — no existing call site is rewired to call it.
   Wiring happens in a future story (PLANB-3). Zero production behavior
   change is a hard acceptance criterion.

   Source-of-truth flag: window.BP2_WRITE_SOURCE (index.html, mirrors
   BP2_READ_SOURCE's exact placement/convention). Default 'firebase' —
   every method below resolves to the EXISTING Firestore call, byte-
   equivalent to what the live call sites already do today. The Supabase
   leg is present but UNREACHED while the flag stays 'firebase'.

   BINDING CONDITIONS (carried from CTO verdict_planb2_writeshim_dualdrive_2026_07_04):
     - CONDITION PLANB-C4 / bp2_auth_hybrid_pii_split: the existing PII leg
       (_encryptPiiServerSide(), bp2-auth.js) is NEVER touched by this shim.
       This module only ever becomes a drop-in replacement for the FIRST
       (non-PII) leg of that Promise.all — never the second.
     - CONDITION D (A&R, 2026-04-06 reorder-incident precedent): the
       playlist-update method NEVER accepts or forwards a full raw_doc/blob
       replace — named partial fields only, matching each existing call
       site's field-set exactly. songOrder/sort_order is never touched by
       this shim beyond passing through the SAME named field the existing
       code already writes (sets/songOrder as one existing atomic payload,
       or downloadPolicy alone) — no reordering/sorting/dedup logic here.
     - The stems-request write is a NEW/re-queue REQUEST creation only —
       NOT the status-lifecycle updates (those are stem-listener.js's
       server-side dual-drive, a separate Backend task).
     - bp2_accept_once is a Supabase RPC (SECURITY INVOKER, idempotent via
       an atomic IS-NULL guard) with a hard-coded 4-field allow-list:
       confidentiality_accepted_at / house_band_agreed_at /
       freelance_agreement_accepted_at / payment_setup_at. Calling it twice
       does NOT re-stamp the timestamp (Data Steward-verified live).

   OPEN QUESTION RESOLVED (Screen-1 signature-capture UI, PLANB2-C3):
     Screen-1's current live handler (bp2-auth.js ~182-192) writes ONLY a
     timestamp (confidentialityAcceptedAt) plus a signature object that is
     already captured client-side (name/email/userAgent/signedFromUrl) —
     it does NOT yet route that signature payload through any encryption
     leg. This shim's acceptConfidentiality() method mirrors that: it
     writes the accept-once timestamp via bp2_accept_once AND is able to
     carry the SAME already-existing signature fields the client already
     collects, so that a future wiring story (PLANB-3) can route them to
     confidentiality_signature_enc via the existing _encryptPiiServerSide()
     Edge Function pattern if/when that becomes the live path. NO NEW
     client-side signature-CAPTURE UI is added here — Screen-1 already
     collects name/email/userAgent/signedFromUrl inline at accept time;
     building new capture UI is out of this story's scope (dark shim only).

   WHO CALLS IT:
     - Nobody yet. Dark/unwired this story. A future PLANB-3 story wires
       these methods into the 7 real call sites named above.
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _getCore() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  // ── Source selection ─────────────────────────
  // undefined and any non-'supabase' value => 'firebase' (safe default,
  // mirrors bp2-data.js's _src() convention exactly).
  function _writeSrc() {
    return global.BP2_WRITE_SOURCE === 'supabase' ? 'supabase' : 'firebase';
  }

  function _supabase() {
    var c = _getCore();
    return c && c.getSupabase ? c.getSupabase() : null;
  }

  function _db() {
    var c = _getCore();
    return c && c.getDb ? c.getDb() : null;
  }

  // ══════════════════════════════════════════════════════════════════
  // OPERATIONS 1–3: accept-once timestamp fields (RPC-backed on Supabase)
  //   bp2-auth.js Screen 1 (confidentiality) + Screen 2 (house-band/
  //   freelance agreement + payment-setup). All three route through the
  //   SAME bp2_accept_once RPC on the Supabase leg — a 4-field allow-list,
  //   SECURITY INVOKER, idempotent (never re-stamps on a 2nd call).
  // ══════════════════════════════════════════════════════════════════

  // Firestore impl — byte-equivalent to bp2-auth.js Screen 1's existing
  // db.collection('users').doc(uid).update({...}) call. extra carries the
  // sibling non-accept-once fields the live call already writes alongside
  // the timestamp (confidentialitySignature, roster_tier, activity) so
  // this method can be a true drop-in replacement for that ONE call, not
  // a partial one.
  function _fsAcceptOnce(uid, field, extra) {
    var db = _db();
    if (!db || !uid || !field) return Promise.reject(new Error('bp2-write: missing db/uid/field'));
    var payload = Object.assign({}, extra || {});
    payload[field] = firebase.firestore.FieldValue.serverTimestamp();
    return db.collection('users').doc(uid).update(payload);
  }

  // Supabase impl — calls the PLANB-1-shipped bp2_accept_once(uid, field, extra)
  // RPC (SECURITY INVOKER; hard-coded 4-field allow-list; atomic IS-NULL
  // guard so a 2nd call is a no-op, never re-stamping). extra is passed
  // through as-is (e.g. house_band_agreed_version) for the RPC's own
  // sibling-field handling — this shim does not interpret or reshape it.
  function _sbAcceptOnce(uid, field, extra) {
    var sb = _supabase();
    if (!sb || !uid || !field) return Promise.reject(new Error('bp2-write: missing supabase client/uid/field'));
    return sb.rpc('bp2_accept_once', {
      p_uid: uid,
      p_field: field,
      p_extra: extra || null
    }).then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return res.data;
    });
  }

  // Public: confidentiality signature accept (Screen 1). field is fixed to
  // 'confidentiality_accepted_at' (the only Screen-1 accept-once field).
  // extra carries the Firestore-shape sibling fields the live call writes
  // today (confidentialitySignature/roster_tier/activity) so the Firestore
  // leg stays a byte-equivalent drop-in; the Supabase leg passes extra to
  // the RPC unmodified (a future wiring story decides its exact shape).
  function acceptConfidentiality(uid, extra) {
    return _writeSrc() === 'supabase'
      ? _sbAcceptOnce(uid, 'confidentiality_accepted_at', extra)
      : _fsAcceptOnce(uid, 'confidentialityAcceptedAt', extra);
  }

  // Public: house-band/freelance agreement accept (Screen 2, non-PII leg
  // only). Live Firestore call sets houseBandAgreedAt + houseBandAgreedVersion
  // + freelanceAgreementAcceptedAt together (bp2-auth.js ~634-636) — extra
  // carries houseBandAgreedVersion so the Firestore leg remains a faithful
  // drop-in. On the Supabase side this maps to house_band_agreed_at (the
  // RPC's allow-listed field); freelance_agreement_accepted_at is a
  // SEPARATE allow-listed field the RPC also supports — call it as a
  // second acceptOnce if/when a future wiring story needs both stamped
  // distinctly. This method covers the house-band field; see
  // acceptFreelanceAgreement() for the sibling field.
  function acceptHouseBandAgreement(uid, extra) {
    return _writeSrc() === 'supabase'
      ? _sbAcceptOnce(uid, 'house_band_agreed_at', extra)
      : _fsAcceptOnce(uid, 'houseBandAgreedAt', Object.assign({
          houseBandAgreedVersion: extra && extra.house_band_agreed_version
        }, extra));
  }

  function acceptFreelanceAgreement(uid, extra) {
    return _writeSrc() === 'supabase'
      ? _sbAcceptOnce(uid, 'freelance_agreement_accepted_at', extra)
      : _fsAcceptOnce(uid, 'freelanceAgreementAcceptedAt', extra);
  }

  // Public: payment-setup mark (Screen 2, non-PII leg). field fixed to
  // 'payment_setup_at' / 'paymentSetupAt'.
  function markPaymentSetup(uid, extra) {
    return _writeSrc() === 'supabase'
      ? _sbAcceptOnce(uid, 'payment_setup_at', extra)
      : _fsAcceptOnce(uid, 'paymentSetupAt', extra);
  }

  // ══════════════════════════════════════════════════════════════════
  // A separate, NON-accept-once primitive: payment_method is an
  // overwritable LABEL (e.g. "cashapp"), not a tiered timestamp — it must
  // NOT be routed through bp2_accept_once (which has no idempotency
  // semantics to protect here; overwriting it is the whole point of an
  // edit). This is the shim's "plain non-PII field write" primitive.
  // ══════════════════════════════════════════════════════════════════

  function _fsUpsertMerge(uid, fields) {
    var db = _db();
    if (!db || !uid || !fields) return Promise.reject(new Error('bp2-write: missing db/uid/fields'));
    return db.collection('users').doc(uid).update(fields);
  }

  function _sbUpsertMerge(uid, fields) {
    var sb = _supabase();
    if (!sb || !uid || !fields) return Promise.reject(new Error('bp2-write: missing supabase client/uid/fields'));
    // public.users, own-row RLS (pre-existing, unaltered by this shim).
    return sb.from('users').update(fields).eq('id', uid).then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return res.data;
    });
  }

  // Public: plain non-PII field write (e.g. { paymentMethod: 'cashapp' } /
  // { payment_method: 'cashapp' }). NOT accept-once — always overwrites.
  function upsertNonPiiFields(uid, fields) {
    return _writeSrc() === 'supabase' ? _sbUpsertMerge(uid, fields) : _fsUpsertMerge(uid, fields);
  }

  // ══════════════════════════════════════════════════════════════════
  // OPERATION 4: Stems request-trigger — bp2-stems.js requestStems()
  //   NEW/re-queue REQUEST creation only. NOT the status-lifecycle
  //   updates (those belong to stem-listener.js's server-side dual-drive,
  //   a separate Backend task — this shim never writes progress/
  //   human_stage/error_message/status transitions).
  // ══════════════════════════════════════════════════════════════════

  // Firestore impl — byte-equivalent to bp2-stems.js requestStems()'s
  // existing c.getDb().collection('stem-requests').doc(songId).set({...}).
  function _fsRequestStems(songId, song, uid, role) {
    var db = _db();
    if (!db || !songId) return Promise.reject(new Error('bp2-write: missing db/songId'));
    return db.collection('stem-requests').doc(songId).set({
      status: 'pending',
      songId: songId,
      audioPath: song && song.audioPath,
      title: (song && song.title) || '',
      requestedBy: uid,
      requestedByRole: role,
      requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // Supabase impl — writes to the PLANB-1-shipped stem_requests table
  // (ALTERed shape: song_id, progress, human_stage, error_message,
  // trace_id, updated_at, status CHECK-constrained to 6 values). This is
  // a NEW REQUEST row (status='pending'), not a status-lifecycle update —
  // stem-listener.js/chart-generator.js's dual-drive owns every
  // subsequent status transition on this same row.
  function _sbRequestStems(songId, song, uid, role) {
    var sb = _supabase();
    if (!sb || !songId) return Promise.reject(new Error('bp2-write: missing supabase client/songId'));
    return sb.from('stem_requests').upsert({
      song_id: songId,
      status: 'pending',
      requested_by: uid,
      updated_at: new Date().toISOString()
    }, { onConflict: 'song_id' }).then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return res.data;
    });
  }

  // Public: request (or re-queue) stem separation for a song.
  function requestStems(songId, song, uid, role) {
    return _writeSrc() === 'supabase'
      ? _sbRequestStems(songId, song, uid, role)
      : _fsRequestStems(songId, song, uid, role);
  }

  // ══════════════════════════════════════════════════════════════════
  // OPERATION 5: Playlist scoped-field update — bp2-edit.js /
  //   bp2-playlist.js / bp2-permissions.js (4 confirmed call sites:
  //   bp2-edit.js:69-72, bp2-playlist.js:419-422, bp2-playlist.js:466-469,
  //   bp2-permissions.js:68).
  //
  //   BINDING CONDITION D (A&R, non-negotiable, 2026-04-06 reorder
  //   incident): this MUST be a scoped/partial column update — NEVER a
  //   full raw_doc/blob replace. The caller supplies the EXACT named
  //   fields it wants written (matching what the live call site already
  //   sends); this method does not add, reorder, sort, or dedupe
  //   anything. songOrder/sort_order is passed through byte-for-byte,
  //   never touched/recomputed here.
  // ══════════════════════════════════════════════════════════════════

  function _fsUpdatePlaylistFields(playlistId, fields) {
    var db = _db();
    if (!db || !playlistId || !fields) return Promise.reject(new Error('bp2-write: missing db/playlistId/fields'));
    return db.collection('playlists').doc(playlistId).update(fields);
  }

  // Supabase impl — a scoped/partial UPDATE on the songs/playlists
  // catalog table (PLANB-1-shipped, ALTER not CREATE, songOrder-sacred
  // certified). Named-field payload only, mirrored 1:1 from the caller —
  // NEVER a raw_doc/blob replace (Condition D).
  function _sbUpdatePlaylistFields(playlistId, fields) {
    var sb = _supabase();
    if (!sb || !playlistId || !fields) return Promise.reject(new Error('bp2-write: missing supabase client/playlistId/fields'));
    return sb.from('playlists').update(fields).eq('id', playlistId).then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return res.data;
    });
  }

  // Public: update NAMED fields on a single playlist (e.g.
  // { sets, songOrder, updatedAt } or { downloadPolicy }). Caller decides
  // the exact field-set — this method never expands, reorders, or
  // replaces it wholesale.
  function updatePlaylistFields(playlistId, fields) {
    return _writeSrc() === 'supabase'
      ? _sbUpdatePlaylistFields(playlistId, fields)
      : _fsUpdatePlaylistFields(playlistId, fields);
  }

  // ── Public API ───────────────────────────────
  var BP2Write = {
    // Ops 1–3 (accept-once timestamps, RPC-backed on Supabase)
    acceptConfidentiality: acceptConfidentiality,
    acceptHouseBandAgreement: acceptHouseBandAgreement,
    acceptFreelanceAgreement: acceptFreelanceAgreement,
    markPaymentSetup: markPaymentSetup,
    // Plain overwritable non-PII field write (payment_method label, etc.)
    upsertNonPiiFields: upsertNonPiiFields,
    // Op 4 (stems request-trigger — new/re-queue request only)
    requestStems: requestStems,
    // Op 5 (playlist scoped-field update — named fields only, never a blob replace)
    updatePlaylistFields: updatePlaylistFields
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Write;
  } else if (global) {
    global.BP2Write = BP2Write;
  }
})(typeof window !== 'undefined' ? window : this);
