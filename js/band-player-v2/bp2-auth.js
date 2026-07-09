/* ============================================
   bp2-auth.js — Musician Onboarding Gate
   Band Player v2.0

   Two-screen onboarding for band_member/artist roles.
   Screen 1: Confidentiality Agreement
   Screen 2: Payment Setup + Agreement + W-9
   Admin/band_manager skip to player.

   NOTE: Agreement text is now VERSIONED (v2.0) — Legal LC-2 Maryland
   governing-law added (PLANB-3-D-4). The prior "byte-identical to v1"
   invariant is intentionally retired by Legal for this change; existing
   v1.0 acceptance records remain valid and untouched. Do NOT edit the
   separate agreements.html in any repo.

   WHO CALLS IT:
     - bp2-core.js init() emits 'auth:show-gate'
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }
  function _esc(s) { return global.BP2Utils ? global.BP2Utils.esc(s) : String(s || ''); }
  // Ciphertext (enc:v*:...) must never be rendered as a plaintext value. The
  // cache only holds *_enc ciphertext for PII now (decryptable server-side only);
  // the browser shows a masked placeholder. Prefer a plaintext value if present.
  function _plainOr(plain, encVal, fallback) {
    if (plain != null && String(plain).trim() !== '') return String(plain);
    if (encVal != null && String(encVal).indexOf('enc:v') === 0) return '•••• (saved)';
    if (encVal != null && String(encVal).trim() !== '') return String(encVal);
    return fallback;
  }

  // ── Server-side PII encryption (D-11/D-34: ENCRYPT-IN-SUPABASE) ─────────────
  // The encryption key is NEVER in the browser. Sensitive PII is POSTed as
  // plaintext over TLS + the user's Supabase session JWT to the Supabase Edge
  // Function `encrypt-pii`, which holds the key (Edge secret), encrypts
  // AES-256-GCM, and writes the *_enc ciphertext to public.users via
  // service_role. The prior client-side WebCrypto path (_fetchEncKey/_encrypt,
  // key from Firestore config/encryption) is RETIRED — Firestore is retired and
  // a client-held key violates D-31.
  var PII_FN_URL = 'https://rklvvuzedmadydmohouu.functions.supabase.co/encrypt-pii';

  // Resolve the current Supabase session JWT (from the app's Supabase client).
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

  // Send PLAINTEXT PII fields to the Edge Function for server-side encryption +
  // write to the cache. Returns Promise<boolean> (true = persisted). Never sends
  // tax/SSN/bank routing/account (SoR-only). No key, no ciphertext, client-side.
  function _encryptPiiServerSide(uid, fields) {
    return _supaAccessToken().then(function(token) {
      if (!token) return false;
      return fetch(PII_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ uid: uid, fields: fields })
      }).then(function(r) { return r.ok; }).catch(function() { return false; });
    });
  }

  // ── Freelance Agreement Text (BYTE-IDENTICAL to agreements.html) ──
  var AGREEMENT_TEXT =
    '\u2022 You are a freelance independent contractor for Gold Bottom Ent LLC only (not an employee). You handle your own taxes and insurance.\n\n' +
    '\u2022 LA Young\u2019s original compositions, lyrics, and demos are her / Gold Bottom Ent LLC\u2019s sole property. Any contributions or arrangements you make to her pre-existing originals are derivative works owned solely by her / the LLC. You will not claim ownership, co-writing credit, or royalties unless we agree in writing.\n\n' +
    '\u2022 Rehearsal materials, charts, and recordings are for band use only \u2014 please don\u2019t share them publicly.\n\n' +
    '\u2022 No extra pay for rehearsals, local travel, or prep unless we note it for a specific gig.\n\n' +
    '\u2022 You\u2019re responsible for your own gear. We\u2019re not liable for loss or damage unless caused by our direct negligence.\n\n' +
    '\u2022 All obligations are with Gold Bottom Ent LLC only \u2014 no personal liability for Jeffery Ponder or LA Young.\n\n' +
    '\u2022 This agreement is governed by the laws of the State of Maryland, and any dispute will be handled exclusively in the state or federal courts located in Maryland.';

  // LC-3: Screen-2 agreement text materially changed (LC-2 MD governing-law
  // bullet), so bump to v2.0. Existing '1.0' records remain valid/untouched.
  var AGREEMENT_VERSION = '2.0';
  // LC-3: Screen-1 confidentiality/IP agreement version (independent of the
  // Screen-2 house-band agreement version).
  var CONFIDENTIALITY_VERSION = '1.0';
  // LC-3 canonical operative text of the Screen-1 confidentiality/IP agreement,
  // INCLUDING the LC-2 Maryland governing-law sentence. Hashed at accept time to
  // bind the acceptance record to the exact terms shown. Kept in lockstep with
  // the rendered confidentiality box in showScreen1().
  var CONFIDENTIALITY_TEXT =
    '\u2022 All original compositions, lyrics, demos, and arrangements by LA Young are the sole property of Gold Bottom Ent LLC.\n\n' +
    '\u2022 Any contributions, harmonies, adaptations, or ideas I add to LA Young\u2019s pre-existing original material become derivative works owned solely by Gold Bottom Ent LLC / LA Young. I will not claim any ownership, co-writing credit, or royalties unless we specifically agree in writing.\n\n' +
    '\u2022 Rehearsal recordings, charts, setlists, and private band materials are for internal use only. I will not share, distribute, copy, or post them publicly without written permission.\n\n' +
    '\u2022 This applies during our working relationship and for 3 years after (or until the material is publicly released).\n\n' +
    'I understand I am working as a freelance independent contractor for Gold Bottom Ent LLC only.\n\n' +
    'This agreement is governed by the laws of the State of Maryland, without regard to its conflict-of-laws rules. Any dispute arising out of or relating to it will be brought exclusively in the state or federal courts located in Maryland, and I consent to the jurisdiction of those courts.';
  var W9_THRESHOLD = 600;

  // ── Container helper ───────────────────────
  var _overrideContainer = null;
  function _getContainer() {
    return _overrideContainer ||
      document.getElementById('band-player-content') ||
      document.querySelector('.band-player-container') ||
      document.querySelector('#dash-band-player-v2 .bp2-rack') ||
      document.getElementById('bp2-tracklist');
  }

  // LC-3: SHA-256 hex of a UTF-8 string via SubtleCrypto. PLAIN non-PII
  // provability metadata — the returned hash is NEVER routed through the
  // encrypt-pii Edge Function / piiFields. Async; resolves '' if unavailable
  // (never rejects — a hashing hiccup must not block an acceptance).
  function _sha256Hex(text) {
    try {
      var subtle = global.crypto && global.crypto.subtle;
      if (!subtle || typeof TextEncoder === 'undefined') return Promise.resolve('');
      var buf = new TextEncoder().encode(String(text));
      return subtle.digest('SHA-256', buf).then(function(digest) {
        var bytes = new Uint8Array(digest);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
        return hex;
      }).catch(function() { return ''; });
    } catch (e) { return Promise.resolve(''); }
  }

  // LC-1: ESIGN Act / Maryland UETA consent recital + 4 required disclosures.
  // Static verbatim literals (Legal-drafted) — rendered in DOM order IMMEDIATELY
  // ABOVE the accept checkbox on BOTH Screen 1 and Screen 2.
  function _esignSectionHtml() {
    var wrap = 'background:var(--color-bg,#0d1117);border:1px solid var(--color-border,#282c36);border-radius:10px;padding:14px;margin-bottom:16px;text-align:left;';
    var head = 'font-size:13px;color:var(--color-text,#e8e8e8);font-weight:600;margin-bottom:8px;';
    var body = 'font-size:12px;color:var(--color-text-secondary,#8b949e);line-height:1.6;margin-bottom:10px;';
    var item = 'font-size:12px;color:var(--color-text-secondary,#8b949e);line-height:1.6;margin:0 0 8px 18px;text-indent:-18px;';
    return '<div style="' + wrap + '">' +
      '<div style="' + head + '">Signing this agreement electronically</div>' +
      '<div style="' + body + '">By checking the box below, you agree to sign this agreement electronically and to conduct this onboarding by electronic means. Your electronic signature has the same legal effect as a handwritten (ink) signature under the federal ESIGN Act (15 U.S.C. ch. 96) and the Maryland Uniform Electronic Transactions Act.</div>' +
      '<div style="' + item + '">• You have the right to receive a paper copy of this agreement at no charge. To request one, email jeffery.ponder@goldbottoment-llc.com or write to Gold Bottom Ent LLC, 5000 Thayer Center, Oakland, MD 21550.</div>' +
      '<div style="' + item + '">• You may withdraw your consent to sign and do business electronically at any time before you check the box below. If you withdraw consent, you will not be able to complete onboarding electronically and we will arrange a paper signing process instead; withdrawal does not affect the validity of anything you have already signed electronically.</div>' +
      '<div style="' + item + '">• To withdraw consent, or to update the email or mailing address we use to reach you, email jeffery.ponder@goldbottoment-llc.com.</div>' +
      '<div style="' + item + '">• To sign and keep a copy of this agreement you need a device with a current web browser, internet access, and the ability to view and save web-page or PDF documents.</div>' +
    '</div>';
  }

  // LC-6: PII / data-handling disclosure (Screen 2). Static verbatim literal.
  function _piiDisclosureHtml() {
    var wrap = 'background:var(--color-bg,#0d1117);border:1px solid var(--color-border,#282c36);border-radius:10px;padding:14px;margin-bottom:16px;text-align:left;';
    var body = 'font-size:12px;color:var(--color-text-secondary,#8b949e);line-height:1.6;';
    return '<div style="' + wrap + '">' +
      '<div style="' + body + '"><strong style="color:var(--color-text,#e8e8e8);">How we handle your information:</strong> The personal details you enter here — your legal name, phone, mailing address, and payment information — are encrypted and accessible only to Gold Bottom Ent LLC management. We use them solely to pay you and to meet tax and legal obligations, including collecting a W-9 and issuing an IRS Form 1099 once your payments reach $600 in a calendar year. We never sell this information or share it for marketing.</div>' +
    '</div>';
  }

  var BP2Auth = {
    init: function() {
      var c = _c();
      if (!c) return;
      c.on('auth:show-gate', function(d) {
        if (d.screen === 1) BP2Auth.showScreen1();
        else if (d.screen === 2) BP2Auth.showScreen2('onboard');
      });
    },

    // Allow external override of container (payment-settings.html uses this)
    setContainer: function(el) { _overrideContainer = el; },

    showScreen1: function() {
      var container = _getContainer();
      if (!container) return;
      var c = _c();

      // AGREEMENT TEXT — MUST BE BYTE-IDENTICAL TO V1
      container.innerHTML =
        '<div style="max-width:560px;margin:24px auto;padding:16px;">' +
          '<div style="background:var(--color-bg-secondary,#161b22);border:1px solid var(--color-border,#282c36);border-radius:14px;padding:24px;">' +
            '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,160,23,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><i class="fa-solid fa-shield-halved" style="font-size:24px;color:#d4a017;"></i></div>' +
            '<h2 style="color:var(--color-text,#e8e8e8);font-size:18px;margin-bottom:8px;text-align:center;">Band Confidentiality &amp; Agreement</h2>' +
            '<p style="color:var(--color-text-secondary,#8b949e);font-size:14px;margin-bottom:16px;text-align:center;line-height:1.6;">Welcome to the L.A. Young Soul Society band portal!</p>' +
            '<p style="color:var(--color-text-secondary,#8b949e);font-size:14px;margin-bottom:12px;text-align:left;line-height:1.6;">Before you can access the original songs, demos, charts, and rehearsal materials, please read and agree:</p>' +
            '<div style="background:var(--color-bg,#0d1117);border:1px solid var(--color-border,#282c36);border-radius:10px;padding:16px;text-align:left;font-size:14px;color:var(--color-text-secondary,#8b949e);line-height:1.8;margin-bottom:16px;max-height:38vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
              '&bull; All original compositions, lyrics, demos, and arrangements by LA Young are the sole property of Gold Bottom Ent LLC.<br><br>' +
              '&bull; Any contributions, harmonies, adaptations, or ideas I add to LA Young\u2019s pre-existing original material become derivative works owned solely by Gold Bottom Ent LLC / LA Young. I will not claim any ownership, co-writing credit, or royalties unless we specifically agree in writing.<br><br>' +
              '&bull; Rehearsal recordings, charts, setlists, and private band materials are for internal use only. I will not share, distribute, copy, or post them publicly without written permission.<br><br>' +
              '&bull; This applies during our working relationship and for 3 years after (or until the material is publicly released).<br><br>' +
              '<em>I understand I am working as a freelance independent contractor for Gold Bottom Ent LLC only.</em>' +
              '<div style="margin-top:12px;">This agreement is governed by the laws of the State of Maryland, without regard to its conflict-of-laws rules. Any dispute arising out of or relating to it will be brought exclusively in the state or federal courts located in Maryland, and I consent to the jurisdiction of those courts.</div>' +
              '<div style="border-top:1px solid var(--color-border,#282c36);margin-top:16px;padding-top:16px;">' +
                '<div style="margin-bottom:12px;">' +
                  '<div style="font-size:11px;color:var(--color-text-muted,#6e7681);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Offered By</div>' +
                  '<div style="font-size:14px;color:var(--color-text,#e8e8e8);font-weight:600;">Jeffery Ponder</div>' +
                  '<div style="font-size:12px;color:var(--color-text-secondary,#8b949e);">Managing Member, Gold Bottom Ent LLC</div>' +
                  '<div style="font-size:12px;color:var(--color-text-secondary,#8b949e);">5000 Thayer Ctr, Oakland, MD 21550</div>' +
                  '<div id="bp2-s1-ceo-date" style="font-size:12px;color:var(--color-text-secondary,#8b949e);"></div>' +
                '</div>' +
                '<div id="bp2-s1-musician-sig" style="display:none;">' +
                  '<div style="font-size:11px;color:var(--color-text-muted,#6e7681);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Accepted By</div>' +
                  '<div id="bp2-s1-sig-name" style="font-size:14px;color:#3fb950;font-weight:600;"></div>' +
                  '<div id="bp2-s1-sig-date" style="font-size:12px;color:var(--color-text-secondary,#8b949e);"></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            // LC-6 (optional Screen-1 one-liner) — privacy/PII note.
            '<p style="color:var(--color-text-secondary,#8b949e);font-size:12px;text-align:left;line-height:1.6;margin-bottom:16px;">Any personal information you provide during onboarding is encrypted and kept confidential to Gold Bottom Ent LLC management, and is used only to manage your work with the band and meet legal and tax obligations.</p>' +
            // LC-4: legal-name signatory input (required; mirrors Screen 2).
            '<div style="text-align:left;margin-bottom:16px;">' +
              '<label style="display:block;font-size:13px;color:var(--color-text-secondary,#8b949e);margin-bottom:4px;font-weight:500;">Legal Full Name</label>' +
              '<input type="text" id="bp2-s1-legalname" name="name" autocomplete="name" placeholder="As it appears on your tax documents" style="width:100%;padding:12px;border-radius:8px;border:1px solid var(--color-border,#282c36);background:var(--color-bg,#0d1117);color:var(--color-text,#e8e8e8);font-size:14px;min-height:44px;box-sizing:border-box;" />' +
            '</div>' +
            // LC-1: ESIGN/UETA consent recital + disclosures, immediately above the checkbox.
            _esignSectionHtml() +
            '<label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--color-text,#e8e8e8);cursor:pointer;justify-content:center;margin-bottom:16px;padding:12px;border-radius:8px;min-height:44px;">' +
              '<input type="checkbox" id="bp2-screen1-cb" style="width:22px;height:22px;accent-color:#d4a017;flex:0 0 22px;">' +
              ' I have read, understand, and agree to the above.' +
            '</label>' +
            '<div style="text-align:center;">' +
              '<button id="bp2-screen1-btn" disabled style="padding:14px 32px;border-radius:12px;background:#d4a017;color:#000;border:none;font-weight:600;font-size:15px;cursor:pointer;opacity:0.4;width:100%;min-height:48px;">Accept &amp; Continue</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      // Populate CEO date from user doc (invitedAt or registeredAt)
      var user = c ? c.getUser() : null;
      var db = c ? c.getDb() : null;
      if (user && db) {
        db.collection('users').doc(user.uid).get().then(function(doc) {
          var data = doc.exists ? doc.data() : {};
          var ceoDateEl = document.getElementById('bp2-s1-ceo-date');
          var offerDate = data.invitedAt || data.registeredAt;
          if (ceoDateEl && offerDate && offerDate.toDate) {
            ceoDateEl.textContent = 'Date: ' + offerDate.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          } else if (ceoDateEl) {
            // LC-5: never fabricate an offer date — render blank when none exists.
            ceoDateEl.textContent = '';
          }
          // LC-4: prefill the legal-name signatory from the user doc if present.
          var lnEl = document.getElementById('bp2-s1-legalname');
          if (lnEl && data.legalName) lnEl.value = data.legalName;
          _validateScreen1();
        }).catch(function() {});
      }

      var cb = document.getElementById('bp2-screen1-cb');
      var btn = document.getElementById('bp2-screen1-btn');
      var lnInput = document.getElementById('bp2-s1-legalname');

      // LC-4: gate the Accept button on BOTH the checkbox AND a non-empty legal name.
      function _validateScreen1() {
        if (!cb || !btn) return;
        var ok = cb.checked && !!(lnInput && lnInput.value.trim());
        btn.disabled = !ok;
        btn.style.opacity = ok ? '1' : '0.4';
      }

      if (cb && btn) {
        cb.addEventListener('change', _validateScreen1);
        if (lnInput) lnInput.addEventListener('input', _validateScreen1);
        btn.addEventListener('click', function() {
          var legalName = (lnInput && lnInput.value.trim()) || '';
          // LC-4: require both the checkbox and a legal name — never proceed without.
          if (!cb.checked || !legalName) return;
          btn.disabled = true;
          btn.textContent = 'Saving...';
          var user = c.getUser();
          var db = c.getDb();
          if (user && db) {
            var sigEmail = user.email || '';
            // LC-4: signatory is the musician's entered LEGAL name — never
            // displayName/email-prefix.
            var sigName = legalName;
            // LC-3: compute the content hash of the exact confidentiality terms
            // shown (incl. the LC-2 MD governing-law line) BEFORE writing.
            _sha256Hex(CONFIDENTIALITY_TEXT).then(function(cHash) {
              return BP2Write.acceptConfidentiality(user.uid, {
                confidentialitySignature: {
                  name: sigName,
                  email: sigEmail,
                  userAgent: navigator.userAgent,
                  signedFromUrl: window.location.href
                },
                // LC-4: plain non-PII field so Screen 2 prefills the legal name.
                // (See InfoSec note: legalName is also carried encrypted inside
                // confidentialitySignature.name; this plain copy is for prefill.)
                legalName: legalName,
                // LC-3: version + content hash — plain non-PII provability
                // metadata; NEVER routed through encrypt-pii/piiFields.
                confidentialityVersion: CONFIDENTIALITY_VERSION,
                confidentialityTextHash: cHash,
                roster_tier: 'on_call',
                activity: 'active'
              });
            }).then(function() {
              if (global.BP2Playlist) global.BP2Playlist.grantDefaultPlaylists(user.uid);
              if (typeof Toast !== 'undefined') Toast.success('Welcome to Soul Society!');
              if (global.BP2Core && typeof global.BP2Core.initPlayer === 'function') {
                global.BP2Core.initPlayer();
              }
            }).catch(function(err) {
              console.error('[BP2Auth] Screen 1 save failed:', err);
              if (typeof Toast !== 'undefined') Toast.error('Failed to save. Please try again.');
              btn.disabled = false;
              btn.textContent = 'Accept & Continue';
            });
          }
        });
      }
    },

    // ── Screen 2: Payment Setup + Agreement + W-9 ──────
    // mode: 'onboard' (first time, after Screen 1) or 'edit' (from payment-settings page)
    // Read-only summary view of saved payment data
    _renderReadOnly: function(container, data, db, uid) {
      var cardStyle = 'background:var(--color-bg-secondary,#161b22);border:1px solid var(--color-border,#282c36);border-radius:14px;padding:24px;';
      var labelStyle = 'font-size:12px;color:var(--color-text-muted,#6e7681);margin-bottom:2px;';
      var valueStyle = 'font-size:15px;color:var(--color-text,#e8e8e8);word-break:break-word;';
      var rowStyle = 'padding:12px 0;border-bottom:1px solid var(--color-border,#282c36);';
      var lastRowStyle = 'padding:12px 0;';

      var methodLabels = {
        check: 'Check', zelle: 'Zelle', cashapp: 'Cash App',
        venmo: 'Venmo', paypal: 'PayPal', direct_deposit: 'Direct Deposit (ACH)'
      };

      var methodDisplay = methodLabels[data.paymentMethod] || data.paymentMethod || 'Not set';

      // Mask sensitive detail if present
      var detailVal = '';
      if (data.payment_method_enc && data.payment_method_enc.indexOf(':') > -1) {
        // Encrypted or method:detail format
        var parts = data.payment_method_enc.split(':');
        if (parts[0] === 'enc') {
          detailVal = '(encrypted)';
        } else if (parts.length >= 2) {
          detailVal = parts.slice(1).join(':');
        }
      }

      // Agreement date
      var agreedDate = '';
      var ts = data.houseBandAgreedAt || data.freelanceAgreementAcceptedAt;
      if (ts && ts.toDate) agreedDate = ts.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // Payment setup date
      var setupDate = '';
      if (data.paymentSetupAt && data.paymentSetupAt.toDate) {
        setupDate = data.paymentSetupAt.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      }

      var self = this;
      container.innerHTML =
        '<div style="max-width:560px;margin:24px auto;padding:16px;">' +
          '<div style="' + cardStyle + '">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
              '<div style="display:flex;align-items:center;gap:12px;">' +
                '<div style="width:44px;height:44px;border-radius:50%;background:rgba(63,185,80,0.12);display:flex;align-items:center;justify-content:center;">' +
                  '<i class="fa-solid fa-circle-check" style="font-size:20px;color:#3fb950;"></i>' +
                '</div>' +
                '<div>' +
                  '<h2 style="color:var(--color-text,#e8e8e8);font-size:18px;margin:0;">Payment Settings</h2>' +
                  (setupDate ? '<p style="color:var(--color-text-muted,#6e7681);font-size:12px;margin:2px 0 0;">Last updated ' + setupDate + '</p>' : '') +
                '</div>' +
              '</div>' +
              '<button id="bp2-s2-edit-btn" style="padding:10px 20px;border-radius:10px;background:transparent;border:1px solid var(--color-border,#282c36);color:var(--color-text,#e8e8e8);font-size:14px;font-weight:500;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:6px;">' +
                '<i class="fa-solid fa-pen-to-square" style="font-size:13px;color:#d4a017;"></i> Edit' +
              '</button>' +
            '</div>' +

            // Personal Info
            '<h3 style="font-size:13px;color:var(--color-text-muted,#6e7681);margin-bottom:8px;letter-spacing:0.5px;text-transform:uppercase;"><i class="fa-solid fa-user" style="margin-right:6px;color:#d4a017;"></i> Personal Info</h3>' +
            '<div style="' + rowStyle + '">' +
              '<div style="' + labelStyle + '">Legal Full Name</div>' +
              '<div style="' + valueStyle + '">' + _esc(data.legalName || data.displayName || 'Not set') + '</div>' +
            '</div>' +
            '<div style="' + rowStyle + '">' +
              '<div style="' + labelStyle + '">Phone</div>' +
              '<div style="' + valueStyle + '">' + _esc(_plainOr(data.phone, data.phone_enc, 'Not set')) + '</div>' +
            '</div>' +
            '<div style="' + lastRowStyle + '">' +
              '<div style="' + labelStyle + '">Mailing Address</div>' +
              '<div style="' + valueStyle + '">' + _esc(_plainOr(data.mailingAddress, data.mailingAddress_enc, 'Not set')) + '</div>' +
            '</div>' +

            // Payment
            '<h3 style="font-size:13px;color:var(--color-text-muted,#6e7681);margin:20px 0 8px;letter-spacing:0.5px;text-transform:uppercase;"><i class="fa-solid fa-credit-card" style="margin-right:6px;color:#d4a017;"></i> Payment Method</h3>' +
            '<div style="' + rowStyle + '">' +
              '<div style="' + labelStyle + '">Method</div>' +
              '<div style="' + valueStyle + '">' + _esc(methodDisplay) + '</div>' +
            '</div>' +
            (detailVal ? '<div style="' + lastRowStyle + '"><div style="' + labelStyle + '">Account</div><div style="' + valueStyle + '">' + _esc(detailVal) + '</div></div>' : '') +

            // Agreement
            (agreedDate ?
              '<div style="margin-top:20px;display:flex;align-items:center;gap:8px;padding:12px;border-radius:8px;background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.25);">' +
                '<i class="fa-solid fa-circle-check" style="color:#3fb950;font-size:16px;"></i>' +
                '<span style="font-size:13px;color:#3fb950;">Freelance Agreement accepted on ' + agreedDate + '</span>' +
              '</div>'
            : '') +
          '</div>' +
        '</div>';

      // Edit button handler
      var editBtn = document.getElementById('bp2-s2-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', function() {
          self.showScreen2('edit');
        });
      }
    },

    showScreen2: function(mode) {
      var container = _getContainer();
      if (!container) return;
      var c = _c();
      var db = c ? c.getDb() : null;
      var user = c ? c.getUser() : null;
      if (!user || !db) return;

      var isEdit = (mode === 'edit');
      var isView = (mode === 'view');
      var uid = user.uid;

      // Styles shared by all form inputs
      var inputStyle = 'width:100%;padding:12px;border-radius:8px;border:1px solid var(--color-border,#282c36);background:var(--color-bg,#0d1117);color:var(--color-text,#e8e8e8);font-size:14px;min-height:44px;box-sizing:border-box;';
      var labelStyle = 'display:block;font-size:13px;color:var(--color-text-secondary,#8b949e);margin-bottom:4px;font-weight:500;';
      var sectionStyle = 'margin-bottom:20px;';
      var cardStyle = 'background:var(--color-bg-secondary,#161b22);border:1px solid var(--color-border,#282c36);border-radius:14px;padding:24px;';

      container.innerHTML =
        '<div style="max-width:560px;margin:24px auto;padding:16px;">' +
          '<div style="' + cardStyle + '">' +
            // Header
            '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,160,23,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">' +
              '<i class="fa-solid fa-wallet" style="font-size:24px;color:#d4a017;"></i>' +
            '</div>' +
            '<h2 style="color:var(--color-text,#e8e8e8);font-size:18px;margin-bottom:4px;text-align:center;">' +
              (isEdit ? 'Payment Settings' : 'Payment &amp; Agreement Setup') +
            '</h2>' +
            '<p style="color:var(--color-text-secondary,#8b949e);font-size:13px;margin-bottom:24px;text-align:center;line-height:1.5;">' +
              (isEdit ? 'Update your payment information and review your agreement.' : 'Set up how you get paid and review the freelance agreement.') +
            '</p>' +

            // Section 1: Personal Info
            '<div style="' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:12px;"><i class="fa-solid fa-user" style="margin-right:6px;color:#d4a017;"></i> Personal Info</h3>' +
              '<div style="display:grid;gap:12px;">' +
                '<div>' +
                  '<label style="' + labelStyle + '">Legal Full Name</label>' +
                  '<input type="text" id="bp2-s2-name" name="name" autocomplete="name" placeholder="As it appears on your tax documents" style="' + inputStyle + '" />' +
                '</div>' +
                '<div>' +
                  '<label style="' + labelStyle + '">Phone Number</label>' +
                  '<input type="tel" id="bp2-s2-phone" name="tel" autocomplete="tel" placeholder="(555) 555-5555" style="' + inputStyle + '" />' +
                '</div>' +
                '<div>' +
                  '<label style="' + labelStyle + '">Mailing Address</label>' +
                  '<textarea id="bp2-s2-address" name="street-address" autocomplete="street-address" rows="2" placeholder="Street, City, State ZIP" style="' + inputStyle + 'resize:vertical;min-height:60px;"></textarea>' +
                '</div>' +
              '</div>' +
            '</div>' +

            // Section 2: Payment Preference
            '<div style="' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:12px;"><i class="fa-solid fa-credit-card" style="margin-right:6px;color:#d4a017;"></i> Payment Preference</h3>' +
              '<select id="bp2-s2-method" style="' + inputStyle + 'cursor:pointer;">' +
                '<option value="">Select how you want to be paid...</option>' +
                '<option value="check">Check (mailed to address above)</option>' +
                '<option value="zelle">Zelle</option>' +
                '<option value="cashapp">Cash App</option>' +
                '<option value="venmo">Venmo</option>' +
                '<option value="paypal">PayPal</option>' +
                '<option value="direct_deposit">Direct Deposit (ACH)</option>' +
              '</select>' +
              '<div id="bp2-s2-method-detail" style="margin-top:12px;display:none;">' +
                '<label style="' + labelStyle + '" id="bp2-s2-detail-label">Account Details</label>' +
                '<input type="text" id="bp2-s2-detail" placeholder="" style="' + inputStyle + '" />' +
              '</div>' +
            '</div>' +

            // Section 3: Freelance Agreement
            '<div style="' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:12px;"><i class="fa-solid fa-file-signature" style="margin-right:6px;color:#d4a017;"></i> Freelance Musician Agreement <span style="font-size:11px;color:var(--color-text-muted,#6e7681);">(v' + AGREEMENT_VERSION + ')</span></h3>' +
              '<div id="bp2-s2-agreement-box" style="background:var(--color-bg,#0d1117);border:1px solid var(--color-border,#282c36);border-radius:10px;padding:16px;font-size:13px;color:var(--color-text-secondary,#8b949e);line-height:1.8;max-height:30vh;overflow-y:auto;-webkit-overflow-scrolling:touch;white-space:pre-wrap;margin-bottom:12px;">' +
                '<div id="bp2-s2-sig-block" style="border-top:1px solid var(--color-border,#282c36);margin-top:16px;padding-top:16px;">' +
                  '<div style="margin-bottom:12px;">' +
                    '<div style="font-size:11px;color:var(--color-text-muted,#6e7681);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Offered By</div>' +
                    '<div style="font-size:14px;color:var(--color-text,#e8e8e8);font-weight:600;">Jeffery Ponder</div>' +
                    '<div style="font-size:12px;color:var(--color-text-secondary,#8b949e);">Managing Member, Gold Bottom Ent LLC</div>' +
                    '<div style="font-size:12px;color:var(--color-text-secondary,#8b949e);">5000 Thayer Ctr, Oakland, MD 21550</div>' +
                    '<div id="bp2-s2-ceo-date" style="font-size:12px;color:var(--color-text-secondary,#8b949e);"></div>' +
                  '</div>' +
                  '<div id="bp2-s2-musician-sig" style="display:none;">' +
                    '<div style="font-size:11px;color:var(--color-text-muted,#6e7681);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Accepted By</div>' +
                    '<div id="bp2-s2-sig-name" style="font-size:14px;color:#3fb950;font-weight:600;"></div>' +
                    '<div id="bp2-s2-sig-email" style="font-size:12px;color:var(--color-text-secondary,#8b949e);"></div>' +
                    '<div id="bp2-s2-sig-date" style="font-size:12px;color:var(--color-text-secondary,#8b949e);"></div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div id="bp2-s2-agreement-status"></div>' +
            '</div>' +

            // Section 4: W-9 (conditional)
            '<div id="bp2-s2-w9-section" style="display:none;' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:8px;"><i class="fa-solid fa-file-invoice-dollar" style="margin-right:6px;color:#f0c040;"></i> W-9 Tax Form Required</h3>' +
              '<div style="background:rgba(240,192,64,0.08);border:1px solid rgba(240,192,64,0.25);border-radius:10px;padding:14px;font-size:13px;color:var(--color-text-secondary,#8b949e);line-height:1.6;">' +
                '<p style="margin:0 0 8px;"><strong style="color:#f0c040;">Your payments this year have reached the $' + W9_THRESHOLD + ' IRS reporting threshold.</strong></p>' +
                '<p style="margin:0;">Gold Bottom Ent LLC is required to file a 1099 for payments over $' + W9_THRESHOLD + '. Please submit a completed W-9 form to management. You can download the blank form from <a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" target="_blank" rel="noopener" style="color:#58a6ff;">irs.gov</a>.</p>' +
              '</div>' +
            '</div>' +

            // LC-6: PII / data-handling disclosure (just above the Save button).
            _piiDisclosureHtml() +

            // Save button
            '<div style="text-align:center;margin-top:8px;">' +
              '<button id="bp2-s2-save" disabled style="padding:14px 32px;border-radius:12px;background:#d4a017;color:#000;border:none;font-weight:600;font-size:15px;cursor:pointer;opacity:0.4;width:100%;min-height:48px;">' +
                (isEdit ? 'Save Changes' : 'Complete Setup') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      // Populate agreement text
      var agBox = document.getElementById('bp2-s2-agreement-box');
      if (agBox) agBox.textContent = AGREEMENT_TEXT;

      // Payment method detail toggle
      var methodSel = document.getElementById('bp2-s2-method');
      var detailWrap = document.getElementById('bp2-s2-method-detail');
      var detailLabel = document.getElementById('bp2-s2-detail-label');
      var detailInput = document.getElementById('bp2-s2-detail');

      var detailMap = {
        zelle: { label: 'Zelle Email or Phone', placeholder: 'email@example.com or (555) 555-5555' },
        cashapp: { label: 'Cash App $Cashtag', placeholder: '$YourCashtag' },
        venmo: { label: 'Venmo Username', placeholder: '@YourVenmo' },
        paypal: { label: 'PayPal Email', placeholder: 'email@example.com' },
        direct_deposit: { label: 'Routing & Account Number', placeholder: 'Routing: XXXXXXXXX / Account: XXXXXXXXXX' }
      };

      if (methodSel) {
        methodSel.addEventListener('change', function() {
          var info = detailMap[methodSel.value];
          if (info) {
            detailLabel.textContent = info.label;
            detailInput.placeholder = info.placeholder;
            detailWrap.style.display = '';
          } else {
            detailWrap.style.display = 'none';
            detailInput.value = '';
          }
          _validateScreen2();
        });
      }

      // Agreement checkbox or already-signed indicator
      var agStatus = document.getElementById('bp2-s2-agreement-status');
      var _agreementAccepted = false;

      db.collection('users').doc(uid).get().then(function(doc) {
        var data = doc.exists ? doc.data() : {};

        // If view mode and payment data already saved, show read-only
        if (isView && data.paymentSetupAt) {
          BP2Auth._renderReadOnly(container, data, db, uid);
          return;
        }

        // Prefill personal info
        var nameEl = document.getElementById('bp2-s2-name');
        var phoneEl = document.getElementById('bp2-s2-phone');
        var addrEl = document.getElementById('bp2-s2-address');
        if (nameEl && data.legalName) nameEl.value = data.legalName;
        else if (nameEl && data.displayName) nameEl.value = data.displayName;
        // Never prefill ciphertext into an editable input — only a plaintext value
        // (legacy) prefills; if the value is server-encrypted, leave blank (re-enter).
        function _plainInput(plain, encVal) {
          if (plain != null && String(plain).trim() !== '') return String(plain);
          if (encVal != null && String(encVal).indexOf('enc:v') === 0) return '';
          return (encVal != null ? String(encVal) : '');
        }
        if (phoneEl) phoneEl.value = _plainInput(data.phone, data.phone_enc);
        if (addrEl) addrEl.value = _plainInput(data.mailingAddress, data.mailingAddress_enc);

        // Prefill payment method + detail
        if (methodSel && data.paymentMethod) {
          methodSel.value = data.paymentMethod;
          methodSel.dispatchEvent(new Event('change'));
          // Prefill detail from payment_method_enc (format: "method:detail")
          if (data.payment_method_enc) {
            var pmParts = data.payment_method_enc.split(':');
            if (pmParts.length >= 2 && pmParts[0] !== 'enc') {
              var detailEl = document.getElementById('bp2-s2-detail');
              if (detailEl) detailEl.value = pmParts.slice(1).join(':');
            }
          }
        }

        // Agreement status
        if (data.houseBandAgreedAt || data.freelanceAgreementAcceptedAt) {
          _agreementAccepted = true;
          var agreedDate = '';
          var ts = data.houseBandAgreedAt || data.freelanceAgreementAcceptedAt;
          if (ts && ts.toDate) agreedDate = ts.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          agStatus.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:8px;background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.25);">' +
              '<i class="fa-solid fa-circle-check" style="color:#3fb950;font-size:16px;"></i>' +
              '<span style="font-size:13px;color:#3fb950;">Agreement accepted' + (agreedDate ? ' on ' + agreedDate : '') + '</span>' +
            '</div>';
        } else {
          agStatus.innerHTML =
            // LC-1: ESIGN/UETA consent recital + disclosures, immediately above the checkbox.
            _esignSectionHtml() +
            '<label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--color-text,#e8e8e8);cursor:pointer;padding:12px;border-radius:8px;min-height:44px;">' +
              '<input type="checkbox" id="bp2-s2-agree-cb" style="width:22px;height:22px;accent-color:#d4a017;flex:0 0 22px;">' +
              ' I have read and agree to the Freelance Musician Agreement above.' +
            '</label>';
          var agreeCb = document.getElementById('bp2-s2-agree-cb');
          if (agreeCb) {
            agreeCb.addEventListener('change', function() {
              _agreementAccepted = agreeCb.checked;
              _validateScreen2();
            });
          }
        }

        // Populate signature block dates
        var ceoDateEl = document.getElementById('bp2-s2-ceo-date');
        var offerDate = data.invitedAt || data.registeredAt;
        if (ceoDateEl && offerDate && offerDate.toDate) {
          ceoDateEl.textContent = 'Date: ' + offerDate.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        } else if (ceoDateEl) {
          // LC-5: never fabricate an offer date — render blank when none exists.
          ceoDateEl.textContent = '';
        }

        // Show musician signature if already accepted
        if (data.houseBandAgreedAt || data.freelanceAgreementAcceptedAt) {
          var sigBlock = document.getElementById('bp2-s2-musician-sig');
          var sigNameEl = document.getElementById('bp2-s2-sig-name');
          var sigEmailEl = document.getElementById('bp2-s2-sig-email');
          var sigDateEl = document.getElementById('bp2-s2-sig-date');
          if (sigBlock) sigBlock.style.display = '';
          var sig = data.freelanceSignature || {};
          if (sigNameEl) sigNameEl.textContent = sig.name || data.displayName || '';
          if (sigEmailEl) sigEmailEl.textContent = sig.email || data.email || '';
          var sigTs = data.houseBandAgreedAt || data.freelanceAgreementAcceptedAt;
          if (sigDateEl && sigTs && sigTs.toDate) {
            sigDateEl.textContent = 'Date: ' + sigTs.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          }
        }

        // W-9 check — query YTD payments
        db.collection('payments').where('musicianId', '==', uid).get().then(function(snap) {
          var ytd = 0;
          var currentYear = new Date().getFullYear();
          snap.forEach(function(pdoc) {
            var pd = pdoc.data();
            var amount = parseFloat(pd.amount) || 0;
            var payDate = pd.paymentDate && pd.paymentDate.toDate ? pd.paymentDate.toDate() : new Date(pd.paymentDate);
            if (payDate.getFullYear() === currentYear) ytd += amount;
          });
          if (ytd >= W9_THRESHOLD) {
            var w9Section = document.getElementById('bp2-s2-w9-section');
            if (w9Section) w9Section.style.display = '';
          }
        }).catch(function() {});

        _validateScreen2();
      }).catch(function(err) {
        console.error('[BP2Auth] Screen 2 prefill failed:', err);
      });

      // Validation
      function _validateScreen2() {
        var nameVal = document.getElementById('bp2-s2-name');
        var methodVal = document.getElementById('bp2-s2-method');
        var saveBtn = document.getElementById('bp2-s2-save');
        if (!saveBtn) return;

        var valid = !!(nameVal && nameVal.value.trim()) &&
                    !!(methodVal && methodVal.value) &&
                    _agreementAccepted;

        // If method needs detail, require it
        var info = detailMap[methodVal ? methodVal.value : ''];
        if (info) {
          var detVal = document.getElementById('bp2-s2-detail');
          valid = valid && !!(detVal && detVal.value.trim());
        }

        saveBtn.disabled = !valid;
        saveBtn.style.opacity = valid ? '1' : '0.4';
      }

      // Wire up live validation on all inputs
      ['bp2-s2-name', 'bp2-s2-phone', 'bp2-s2-address', 'bp2-s2-detail'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', _validateScreen2);
      });

      // Save handler
      var saveBtn = document.getElementById('bp2-s2-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', function() {
          if (saveBtn.disabled) return;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';

          var nameVal = (document.getElementById('bp2-s2-name').value || '').trim();
          var phoneVal = (document.getElementById('bp2-s2-phone').value || '').trim();
          var addrVal = (document.getElementById('bp2-s2-address').value || '').trim();
          var methodVal = document.getElementById('bp2-s2-method').value;
          var detailVal = (document.getElementById('bp2-s2-detail').value || '').trim();

          var paymentInfo = methodVal;
          if (detailVal) paymentInfo += ':' + detailVal;

          // Split the write: NON-PII fields go through the normal cache write;
          // PII (legalName/phone/mailingAddress/paymentDetail/signature) is sent
          // to the Edge Function for SERVER-SIDE encryption (key never client-side).
          // No plaintext PII is ever put in the .update() payload.
          var nonPiiUpdate = {
            paymentMethod: methodVal, // method LABEL only (e.g. "cashapp") — not sensitive
            paymentSetupAt: Auth._serverTimestamp()
          };

          var piiFields = {
            legalName: nameVal,
            phone: phoneVal,
            mailingAddress: addrVal,
            paymentDetail: paymentInfo // "method:detail" — the detail (handle) is sensitive
          };

          // Only set agreement timestamp + signature if not already set
          var agreeCb = document.getElementById('bp2-s2-agree-cb');
          if (agreeCb && agreeCb.checked) {
            var _sigUser = (global.Auth && global.Auth.currentUser && global.Auth.currentUser())
              || (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) || {};
            nonPiiUpdate.houseBandAgreedAt = Auth._serverTimestamp();
            nonPiiUpdate.houseBandAgreedVersion = AGREEMENT_VERSION;
            nonPiiUpdate.freelanceAgreementAcceptedAt = Auth._serverTimestamp();
            // Signature carries name + email (PII) — encrypt it server-side, not plaintext in the cache.
            piiFields.signature = JSON.stringify({
              name: nameVal,
              email: _sigUser.email || '',
              userAgent: navigator.userAgent,
              signedFromUrl: window.location.href
            });
          }

          // LC-3: bind the acceptance to the exact agreement text via a SHA-256
          // content hash (plain non-PII field), computed BEFORE the write and
          // only when actually accepting. Non-PII — never sent to encrypt-pii.
          (agreeCb && agreeCb.checked ? _sha256Hex(AGREEMENT_TEXT) : Promise.resolve('')).then(function(agHash) {
            if (agHash) nonPiiUpdate.agreementTextHash = agHash;
            // 1) write non-PII fields to the cache; 2) send PII to the encrypt-pii
            // Edge Function. Both must resolve; PII failure surfaces as a save error.
            return Promise.all([
              BP2Write.upsertNonPiiFields(uid, nonPiiUpdate),
              _encryptPiiServerSide(uid, piiFields).then(function(ok) {
                if (!ok) throw new Error('PII encryption service unavailable');
                return true;
              })
            ]);
          }).then(function() {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'Save Changes' : 'Complete Setup';
            if (typeof Toast !== 'undefined') Toast.success(isEdit ? 'Payment settings saved!' : 'Setup complete \u2014 welcome to the band!');
            if (isEdit) {
              // Switch back to read-only view after save
              BP2Auth.showScreen2('view');
            } else if (c) {
              c.initPlayer();
            }
          }).catch(function(err) {
            console.error('[BP2Auth] Screen 2 save failed:', err);
            if (typeof Toast !== 'undefined') Toast.error('Failed to save. Please try again.');
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'Save Changes' : 'Complete Setup';
          });
        });
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Auth;
  else if (global) global.BP2Auth = BP2Auth;
})(typeof window !== 'undefined' ? window : this);
