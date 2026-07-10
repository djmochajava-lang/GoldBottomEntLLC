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
   BP2_READ_SOURCE's per-table OBJECT shape) — a per-table map keyed by
   users / stem_requests / playlists, each defaulting to 'firebase'.
   _writeSrc(tableKey) resolves the leg per table (and still tolerates a
   legacy bare-string value). Per-table shape lets a future slice flip ONE
   table's writes without affecting others.

   ── WRITE-MODEL (PLANB-3-D-2, CTO verdict_planb3d_writeflip_design_2026_07_08
      sub-block PLANB_3_D_2) ──────────────────────────────────────────────
   TWO shapes now coexist in this shim:

   (1) DUAL-DRIVE (the two users-agreement-path methods — acceptConfidentiality
       and upsertNonPiiFields). The Firestore PRIMARY leg runs UNCONDITIONALLY
       (byte-identical to _fsAcceptOnce / _fsUpsertMerge today) — this keeps the
       D-27 rollback net fresh, and the returned Promise's success is governed
       by the Firestore primary leg. The Supabase MIRROR leg runs ADDITIONALLY
       and ONLY when _writeSrc('users') === 'supabase'. For these two methods
       the users flag's write-side meaning is therefore "IS THE SUPABASE MIRROR
       ENABLED" — NOT "which single leg runs" (Firestore primary is always on).
       This mirrors stem-listener.js's server-side dual-drive discipline
       (primary governs; mirror is best-effort) but on the client write path.
       Mirror-leg failure is NON-FATAL: it is logged via console.warn and NEVER
       rejects the accept — a mirror hiccup must not block a musician's
       acceptance or break the Firestore-primary flow. Default users:'firebase'
       ⇒ mirror OFF ⇒ still DARK, zero behavior change on merge.

   (2) SWITCH-STYLE (all other methods — acceptHouseBandAgreement /
       acceptFreelanceAgreement / markPaymentSetup / requestStems /
       updatePlaylistFields). Legacy _writeSrc()==='supabase' ? sb : fs — one
       leg OR the other. With every key 'firebase' these resolve to the EXISTING
       Firestore call, byte-equivalent to what the live call sites do today; the
       Supabase leg is present but UNREACHED. Left switch-style intentionally
       (out of PLANB-3-D-2 scope).

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

  // ── Source selection (per-table) ─────────────
  // BP2_WRITE_SOURCE is a per-table object ({ users, stem_requests,
  // playlists }). Resolve the leg for tableKey; undefined/unknown key and
  // any non-'supabase' value => 'firebase' (safe default, mirrors
  // bp2-data.js's _src() convention). A legacy bare-string value is still
  // honored globally so an old flag can't silently mis-route.
  function _writeSrc(tableKey) {
    var src = global.BP2_WRITE_SOURCE;
    // Legacy scalar tolerance: if a bare string was set, honor it globally.
    if (typeof src === 'string') return src === 'supabase' ? 'supabase' : 'firebase';
    // Per-table object (current shape). Unknown/undefined key => safe 'firebase'.
    var v = src && tableKey ? src[tableKey] : undefined;
    return v === 'supabase' ? 'supabase' : 'firebase';
  }

  function _supabase() {
    var c = _getCore();
    return c && c.getSupabase ? c.getSupabase() : null;
  }

  function _db() {
    var c = _getCore();
    return c && c.getDb ? c.getDb() : null;
  }

  // ── Server-side PII encryption for the Supabase mirror leg (D-11/D-34) ──────
  // The encryption key is NEVER client-side. Screen-1's confidentiality
  // signature is PII (name+email) and MUST land in Supabase as enc:v1:...
  // ciphertext, never plaintext. bp2-auth.js's _encryptPiiServerSide is PRIVATE
  // to its own IIFE (and bp2-auth.js must not be modified this story), so we
  // replicate its self-contained pattern here: resolve the Supabase session
  // access token via the SAME accessor chain as bp2-auth.js _supaAccessToken,
  // then POST plaintext over TLS + JWT to the encrypt-pii Edge Function, which
  // holds the key (Edge secret), encrypts AES-256-GCM, and writes the *_enc
  // column via service_role. It returns { ok, fields } — ciphertext is NEVER
  // returned to the client (key stays server-side, D-11).
  var _PII_FN_URL = 'https://rklvvuzedmadydmohouu.functions.supabase.co/encrypt-pii';

  function _supaAccessToken() {
    try {
      var sb = (global.Auth && global.Auth.getSupabase && global.Auth.getSupabase())
        || global.GBE_SUPABASE
        || (global.BP2Core && global.BP2Core.getSupabase && global.BP2Core.getSupabase());
      if (!sb || !sb.auth || !sb.auth.getSession) return Promise.resolve(null);
      return sb.auth.getSession().then(function(res) {
        return (res && res.data && res.data.session && res.data.session.access_token) || null;
      }).catch(function() { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // Encrypt the Screen-1 confidentiality signature server-side. Sends the
  // PLAINTEXT signature JSON to the encrypt-pii Edge Function (this is the
  // sanctioned D-11 path — plaintext over TLS+JWT to the key-holder, NOT a
  // plaintext write to a data column). Returns Promise<boolean> (true =
  // persisted), never throws — a signature-encrypt hiccup must not abort the
  // rest of the best-effort mirror.
  //
  // FIELD-NAME → COLUMN MAPPING (RESOLVED, PLANB-3-D-3 prereq — the D-2
  // carryover-1 fix). Screen-1's confidentiality/IP-agreement signature has its
  // OWN cache column, `confidentiality_signature_enc`, distinct from Screen-2's
  // general-agreement `signature_enc`. This mirror therefore POSTs the input
  // field `confidentialitySignature`, which the encrypt-pii Edge Function
  // FIELD_MAP (GBE-HomeOffice/supabase/functions/encrypt-pii/index.ts) maps to
  // `confidentiality_signature_enc`. The Edge Function's pre-existing
  // `signature → signature_enc` mapping (used by Screen-2's bp2-auth.js path)
  // is left untouched — the new key is ADDITIVE, so the two signatures never
  // collide. Both are stored as enc:v1:… ciphertext; the plaintext goes ONLY to
  // the key-holding Edge Function over TLS+JWT (never to a data column).
  // OPERATOR NOTE: this mapping must be LIVE on the deployed Edge Function
  // (`supabase functions deploy encrypt-pii`) before BP2_WRITE_SOURCE.users is
  // flipped to 'supabase' at D-3 — until then the mirror is DARK and inert.
  function _encryptSignatureServerSide(uid, sigObj) {
    return _supaAccessToken().then(function(token) {
      if (!token) return false;
      return fetch(_PII_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ uid: uid, fields: { confidentialitySignature: JSON.stringify(sigObj) } })
      }).then(function(r) { return r.ok; }).catch(function() { return false; });
    });
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
    // Backend-aware timestamp: under Supabase (GBE_AUTH_SOURCE==='supabase')
    // Auth._serverTimestamp() returns an ISO string that the Supabase DB adapter
    // can write into the confidentiality_accepted_at timestamptz column; under
    // the legacy firebase default it returns the firebase serverTimestamp()
    // sentinel — byte-identical to the prior behavior. Falls back to the raw
    // firebase sentinel if Auth is unavailable.
    payload[field] = (typeof Auth !== 'undefined' && typeof Auth._serverTimestamp === 'function')
      ? Auth._serverTimestamp()
      : firebase.firestore.FieldValue.serverTimestamp();
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

  // Supabase MIRROR leg for Screen-1 confidentiality accept. Runs ONLY when
  // the users flag is 'supabase'. Three sub-writes, none of which may ever put
  // the plaintext signature object into a data column or the RPC p_extra:
  //   (a) SIGNATURE (PII) → encrypt-pii Edge Function → *_enc CIPHERTEXT.
  //       Plaintext goes ONLY to the key-holding Edge Function over TLS+JWT.
  //   (b) accept-once timestamp → bp2_accept_once RPC with p_extra = NULL.
  //       p_extra is DELIBERATELY null: the RPC's confidentiality_accepted_at
  //       branch does confidentiality_signature_enc = COALESCE(p_extra, ...),
  //       so passing the plaintext signature (or any extra) here would POISON
  //       the _enc column with plaintext. The signature is written as
  //       ciphertext via the Edge Function in (a); null leaves it intact.
  //   (c) non-PII scalar labels roster_tier / activity → plain own-row
  //       .update() (they are not in the RPC allow-list, and are non-PII).
  function _sbMirrorConfidentiality(uid, extra) {
    var sb = _supabase();
    if (!sb || !uid) return Promise.reject(new Error('bp2-write: missing supabase client/uid'));
    var ops = [];
    // (a) signature ciphertext (only if the live call captured one)
    var sig = extra && extra.confidentialitySignature;
    ops.push(sig ? _encryptSignatureServerSide(uid, sig) : Promise.resolve(true));
    // (b) accept-once timestamp — p_extra MUST be null (see above)
    ops.push(sb.rpc('bp2_accept_once', {
      p_uid: uid,
      p_field: 'confidentiality_accepted_at',
      p_extra: null
    }).then(function(res) { if (res.error) return Promise.reject(res.error); return res.data; }));
    // (c) non-PII scalar labels (separate plain own-row update)
    var scalars = {};
    if (extra && extra.roster_tier != null) scalars.roster_tier = extra.roster_tier;
    if (extra && extra.activity != null) scalars.activity = extra.activity;
    if (Object.keys(scalars).length) {
      ops.push(sb.from('users').update(scalars).eq('id', uid)
        .then(function(res) { if (res.error) return Promise.reject(res.error); return res.data; }));
    }
    return Promise.all(ops);
  }

  // Public: confidentiality signature accept (Screen 1) — DUAL-DRIVE.
  // Firestore PRIMARY runs UNCONDITIONALLY (byte-identical to today's
  // _fsAcceptOnce; the plaintext signature it stores in Firestore is
  // pre-existing behavior, out of scope). The returned Promise is the
  // Firestore primary — the accept's success is governed by it. The Supabase
  // mirror runs ADDITIONALLY only when the users flag is 'supabase', after the
  // primary resolves, and its failure is NON-FATAL (logged, never rejects).
  function acceptConfidentiality(uid, extra) {
    var primary = _fsAcceptOnce(uid, 'confidentialityAcceptedAt', extra);
    if (_writeSrc('users') === 'supabase') {
      primary.then(function() {
        return _sbMirrorConfidentiality(uid, extra);
      }).catch(function(err) {
        console.warn('[bp2-write] supabase mirror failed', err);
      });
    }
    return primary;
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
    return _writeSrc('users') === 'supabase'
      ? _sbAcceptOnce(uid, 'house_band_agreed_at', extra)
      : _fsAcceptOnce(uid, 'houseBandAgreedAt', Object.assign({
          houseBandAgreedVersion: extra && extra.house_band_agreed_version
        }, extra));
  }

  function acceptFreelanceAgreement(uid, extra) {
    return _writeSrc('users') === 'supabase'
      ? _sbAcceptOnce(uid, 'freelance_agreement_accepted_at', extra)
      : _fsAcceptOnce(uid, 'freelanceAgreementAcceptedAt', extra);
  }

  // Public: payment-setup mark (Screen 2, non-PII leg). field fixed to
  // 'payment_setup_at' / 'paymentSetupAt'.
  function markPaymentSetup(uid, extra) {
    return _writeSrc('users') === 'supabase'
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

  // NOTE: the former _sbUpsertMerge (a single plain sb.from('users').update()
  // of the whole blob) was REMOVED in PLANB-3-D-2 — that full-blob update was
  // the exact re-stamp anti-pattern the accept-once split below exists to
  // avoid. The Supabase mirror now goes through _sbMirrorNonPii, which routes
  // the accept-once timestamps through the idempotent bp2_accept_once RPC and
  // only the overwritable payment_method label through a scoped .update().

  // Supabase MIRROR leg for Screen-2's non-PII write. Runs ONLY when the users
  // flag is 'supabase'. SPLITS the blob — a single plain .update() would
  // re-stamp the accept-once timestamps on an edit re-save, destroying the
  // RPC's no-re-stamp legal guarantee. So:
  //   - Each accept-once field PRESENT (detected by KEY PRESENCE — the values
  //     are Firestore serverTimestamp sentinels and must NEVER be sent to
  //     Supabase; the RPC sets now() itself) routes through bp2_accept_once
  //     (idempotent — a 2nd call does not re-stamp):
  //       houseBandAgreedAt          → house_band_agreed_at
  //         (p_extra = houseBandAgreedVersion || null — the RPC pairs the
  //          version into house_band_agreed_version atomically)
  //       freelanceAgreementAcceptedAt → freelance_agreement_accepted_at (no extra)
  //       paymentSetupAt             → payment_setup_at (no extra)
  //   - Only the plain OVERWRITABLE label paymentMethod → payment_method goes
  //     through a plain own-row .update() (it is NOT in the RPC allow-list and
  //     is meant to be overwritable). Firestore-cased → snake_case here.
  //   (Screen-2's real PII — legalName/phone/mailingAddress/paymentDetail/
  //    signature — is encrypted OUTSIDE this shim by bp2-auth.js's own
  //    _encryptPiiServerSide, so this method has no PII concern.)
  function _sbMirrorNonPii(uid, fields) {
    var sb = _supabase();
    if (!sb || !uid || !fields) return Promise.reject(new Error('bp2-write: missing supabase client/uid/fields'));
    var has = function(k) { return Object.prototype.hasOwnProperty.call(fields, k); };
    var ops = [];
    if (has('houseBandAgreedAt')) {
      ops.push(_sbAcceptOnce(uid, 'house_band_agreed_at', fields.houseBandAgreedVersion || null));
    }
    if (has('freelanceAgreementAcceptedAt')) {
      ops.push(_sbAcceptOnce(uid, 'freelance_agreement_accepted_at', null));
    }
    if (has('paymentSetupAt')) {
      ops.push(_sbAcceptOnce(uid, 'payment_setup_at', null));
    }
    if (has('paymentMethod')) {
      ops.push(sb.from('users').update({ payment_method: fields.paymentMethod }).eq('id', uid)
        .then(function(res) { if (res.error) return Promise.reject(res.error); return res.data; }));
    }
    return Promise.all(ops);
  }

  // Public: Screen-2 non-PII write — DUAL-DRIVE. Firestore PRIMARY runs
  // UNCONDITIONALLY (byte-identical to today's _fsUpsertMerge; it may re-stamp
  // on an edit re-save — pre-existing Firestore behavior, out of scope). The
  // returned Promise is the Firestore primary. The Supabase mirror runs
  // ADDITIONALLY only when the users flag is 'supabase', after the primary
  // resolves, split per _sbMirrorNonPii; its failure is NON-FATAL (logged,
  // never rejects).
  function upsertNonPiiFields(uid, fields) {
    var primary = _fsUpsertMerge(uid, fields);
    if (_writeSrc('users') === 'supabase') {
      primary.then(function() {
        return _sbMirrorNonPii(uid, fields);
      }).catch(function(err) {
        console.warn('[bp2-write] supabase mirror failed', err);
      });
    }
    return primary;
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
      requestedAt: Auth._serverTimestamp()
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
    return _writeSrc('stem_requests') === 'supabase'
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

  // Supabase impl — arrangement (sets + songOrder) update via the
  // Data-Steward RPC bp2_update_playlist_arrangement (SECURITY INVOKER,
  // EXECUTE authenticated-only). CORRECTED (STORY C, CTO
  // CRITICAL_FINDING_playlist_writeshim_wrong 2026-07-09): the prior impl
  // did sb.from('playlists').update({sets,songOrder,updatedAt}) as TOP-LEVEL
  // columns, but the READER (bp2-data.js _normalize) reads sets/songOrder
  // FROM raw_doc — so those top-level writes were either 42703 (no such
  // column) or INVISIBLE to the reader. The RPC does jsonb_set on ONLY
  // raw_doc.sets + raw_doc.songOrder (+raw_doc.updatedAt) and keeps the typed
  // sets/song_order cols in sync, writing p_song_order VERBATIM (no reorder,
  // no dedupe — Condition D, A&R songOrder-sacred). updatedAt is handled
  // INSIDE the RPC, so it is dropped from the client call. Named-field
  // arrangement payload only — NEVER a raw_doc/blob replace.
  function _sbUpdatePlaylistFields(playlistId, fields) {
    var sb = _supabase();
    if (!sb || !playlistId || !fields) return Promise.reject(new Error('bp2-write: missing supabase client/playlistId/fields'));
    return sb.rpc('bp2_update_playlist_arrangement', {
      p_id: playlistId,
      p_sets: fields.sets,
      p_song_order: fields.songOrder
    }).then(function(res) {
      if (res.error) return Promise.reject(res.error);
      return res.data;
    });
  }

  // Public: update NAMED fields on a single playlist (e.g.
  // { sets, songOrder, updatedAt } or { downloadPolicy }). Caller decides
  // the exact field-set — this method never expands, reorders, or
  // replaces it wholesale.
  function updatePlaylistFields(playlistId, fields) {
    return _writeSrc('playlists') === 'supabase'
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
