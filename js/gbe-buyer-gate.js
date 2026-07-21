/* =============================================================================
 * gbe-buyer-gate.js — SHARED buyer email-verification + human-check widget
 * story-buyer-gate-s2-verify-ui (EO design-in: eo_designin_buyer_gate_s2_2026_07_21,
 * including the binding pre-golive reachability amendment).
 *
 * ONE component, consumed by THREE buyer surfaces:
 *   • Quote request   — GoldBottomEntLLC/pages/entertainment/quote.html
 *   • Booking accept  — GoldBottomEntLLC/pages/accept.html
 *   • Ticket checkout — LAYoungBandPage/pages/shows.html
 *
 * OWNING CONTRACT / CROSS-REPO PARITY (story-shared-ux-components-owned,
 * 2026-07-16 — the same regime as gbe-mock-payment.js): this file is the single
 * OWNER of the buyer-gate UX. Because the two public repos are independent
 * (no auto-sync), the file is kept in BOTH and the copies MUST stay
 * BYTE-IDENTICAL:
 *   • GoldBottomEntLLC/js/gbe-buyer-gate.js
 *   • LAYoungBandPage/js/gbe-buyer-gate.js
 * To change it: edit one copy, copy it VERBATIM over the other, and confirm
 * they match (`md5 <both paths>`) BEFORE committing. Never fork or inline
 * this markup in a consumer page.
 *
 * WHAT IT DOES (S2 = buyer-facing half only; server gate shipped in S1):
 *   1. REACHABILITY-GATED RENDER (EO amendment, BINDING): before rendering
 *      ANYTHING it fires a side-effect-free probe at the buyer-gate endpoint
 *      with a bounded ~2.5s timeout. Reachable → the idle "Verify your email"
 *      card renders. 403 / timeout / any error → it renders NOTHING (zero
 *      DOM, no skeleton) — the page is identical to pre-S2. This makes
 *      go-live a pure Worker ALLOW flip with zero client commit.
 *      PROBE MECHANICS (engineering latitude granted by the EO — the binding
 *      requirement is the observable behavior: side-effect-free, bounded-time,
 *      fail-hidden): an explicit fetch(method:'OPTIONS') can NEVER succeed
 *      through the gbe-tickets Worker — OPTIONS is not a CORS-safelisted
 *      method, so the browser preflights it with
 *      Access-Control-Request-Method: OPTIONS, and the Worker's preflight
 *      handler checks THAT method against an ALLOW list that only carries
 *      POST/GET entries → 403 even post-golive. So the probe is instead a
 *      CORS-SIMPLE request (POST, Content-Type: text/plain, no preflight).
 *      Pre-golive the Worker answers 403 at the edge (never reaches the
 *      origin). Post-golive it forwards; express.json ignores text/plain so
 *      the route's Joi validation rejects the empty body with 400 BEFORE any
 *      service call — no DB row, no email, no issue-cap consumption. 400 (or
 *      any 2xx) = reachable; 403/5xx/timeout/network error = hidden. This is
 *      end-to-end stronger than an edge-only OPTIONS: a dead tunnel (Worker
 *      502/503) correctly hides the widget too. NEVER a real issue-code call.
 *   2. Invited (NEVER blocking) email verification: issue-code → 6-digit
 *      "verification code" email (S1) → code entry + Cloudflare Turnstile
 *      human-check → verify → Buyer-Pass held in the controller. Host forms'
 *      real submit buttons are untouched — S2 has zero server enforcement.
 *   3. Turnstile: EXPLICIT render only (?render=explicit — no data-sitekey
 *      auto-render), rendered ONLY at the awaiting-code step, reset on EVERY
 *      failed verify (incl. network-level), removed on teardown/page-leave.
 *      The library script is lazily injected ONCE by this file (idempotent —
 *      SPA PageLoaders re-execute fragment scripts on every navigation, and
 *      pre-golive prod pages must load nothing new at all).
 *
 * API — window.GBEBuyerGate.mount(container, opts):
 *   opts.purpose       {string}   'quote' | 'ticket' | 'booking' (drives copy
 *                                 + the server purpose binding)
 *   opts.getEmail      {Function} () => string — read the buyer email LIVE
 *   opts.emailEditable {boolean}  true: host page owns an email input and
 *                                 calls controller.emailChanged() on its
 *                                 blur/change (auto-activate + stale-pass
 *                                 discard). false: known-email surface
 *                                 (booking accept) — shown as read-only TEXT,
 *                                 never an input; auto-activates on mount.
 *   opts.onPassChange  {Function} (passOrNull) => void — optional
 * Returns a controller:
 *   getPass()      → the minted Buyer-Pass ONLY while verified AND the pass's
 *                    email still matches getEmail() live; otherwise null.
 *   reset()        → discard pass + all state, hide; next email trigger
 *                    re-activates (probe result is cached per page load).
 *   destroy()      → full teardown (DOM, Turnstile, listeners).
 *   emailChanged() → host hook: activates on a valid-shaped email; discards a
 *                    stale pass / in-flight code if the email was edited.
 *
 * States: idle → sending → awaiting-code → verifying → verified
 *                                        ↘ failed (→ awaiting-code)
 *
 * SCOPE FENCE (truthfulness — S2): the pass is NOT consumed by any server
 * path yet. Host submit buttons stay fully enabled regardless of widget
 * state. Copy never claims verification is "required" or "protects" anything.
 * No skip/override code path of any kind exists in this file (QAE-only
 * mechanisms are server-enforced and never appear in buyer-facing client code).
 * Mobile-first: 390px, every interactive element ≥ 44px tap height.
 * ===========================================================================*/
(function (global) {
  'use strict';

  // Idempotent under SPA fragment re-execution (PageLoader re-creates script
  // tags on every navigation to a cached page).
  if (global.GBEBuyerGate) return;

  /* ── Named constants ───────────────────────────────────────────────────── */
  // Cloudflare's documented ALWAYS-PASS TEST sitekey — the ONLY sitekey
  // allowed anywhere in shipped S2 client code (real key swap is an
  // owner-gated golive-ops action, not S2's job).
  var TURNSTILE_SITEKEY = '1x00000000000000000000AA';
  var TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var TURNSTILE_SCRIPT_ID = 'gbe-turnstile-api';
  // ONE shared endpoint for all three surfaces (gbe-tickets Worker already
  // allowlists both public origins — InfoSec S1 condition 7).
  var GATE_ENDPOINT_PROD = 'https://gbe-tickets.goldbottom.workers.dev/api/v1/public/buyer-gate';
  var PROBE_TIMEOUT_MS = 2500;   // bounded probe (house fetchWithTimeout pattern)
  var REQUEST_TIMEOUT_MS = 8000; // issue-code / verify calls
  var STYLE_ID = 'gbebg-styles';

  // Server purposeCopy strings VERBATIM (services/buyer-gate.js) — keeps the
  // widget's escalation copy consistent with the S1 email the buyer holds.
  var PURPOSE_PHRASE = {
    quote: 'your quote request',
    ticket: 'your ticket purchase',
    booking: 'your booking'
  };

  var COPY_SEND_FAIL = 'We couldn’t send that just now — please try again in a moment.';
  var COPY_VERIFY_FAIL = 'That code didn’t work. Double-check it and try again, or request a new one below.';
  var COPY_TURNSTILE_TROUBLE = 'Having trouble with the human-check — please try again.';
  var COPY_HOLD_SAFE = 'Verifying your email won’t affect your ticket hold.';

  /* ── Dev-host API base (house pattern: forms.js LAN detection) ──────────
     Shipped default is ALWAYS the Worker URL. On loopback/LAN hosts only
     (dev 9111 / local serves), calls go direct to the dev API on :4000 so
     dev exercise never needs the edge. NO special headers, NO query flags,
     NO client toggles — host-derived only. */
  function apiBase() {
    try {
      var h = global.location.hostname;
      if (h === 'localhost' || h === '127.0.0.1' ||
          /^192\.168\./.test(h) || /^10\./.test(h) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
        return global.location.protocol + '//' + h + ':4000/api/v1/public/buyer-gate';
      }
    } catch (e) { /* fall through to prod */ }
    return GATE_ENDPOINT_PROD;
  }

  /* ── Small helpers ─────────────────────────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function normEmail(s) { return String(s || '').trim().toLowerCase(); }
  function emailShaped(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

  function fetchWithTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, ms);
    var fetchOpts = Object.assign({}, opts || {}, { signal: ctrl.signal });
    return fetch(url, fetchOpts).finally(function () { clearTimeout(tid); });
  }

  /* ── Reachability probe (see header §1) — success cached per page load ── */
  var _reachable = null; // null = unknown; true = confirmed this page load
  function probeReachable() {
    if (_reachable === true) return Promise.resolve(true);
    return fetchWithTimeout(apiBase(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // CORS-simple: no preflight
      body: 'gbe-buyer-gate-reachability-probe'   // Joi-rejected 400, zero side effects
    }, PROBE_TIMEOUT_MS).then(function (res) {
      var ok = (res.status === 400 || res.ok);
      if (ok) _reachable = true;
      return ok;
    }).catch(function () { return false; });
  }

  /* ── Turnstile library (lazy, idempotent, explicit-render only) ────────── */
  var _tsPromise = null;
  function ensureTurnstile() {
    if (global.turnstile) return Promise.resolve(global.turnstile);
    if (_tsPromise) return _tsPromise;
    _tsPromise = new Promise(function (resolve, reject) {
      var existing = document.getElementById(TURNSTILE_SCRIPT_ID);
      var script = existing;
      if (!script) {
        script = document.createElement('script');
        script.id = TURNSTILE_SCRIPT_ID;
        script.src = TURNSTILE_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      var settled = false;
      function check() {
        if (settled) return;
        if (global.turnstile) { settled = true; resolve(global.turnstile); }
      }
      script.addEventListener('load', check);
      script.addEventListener('error', function () {
        if (!settled) { settled = true; _tsPromise = null; reject(new Error('turnstile load failed')); }
      });
      // Belt-and-suspenders poll (script may already be past 'load')
      var tries = 0;
      (function poll() {
        check();
        if (settled) return;
        if (++tries > 100) { settled = true; _tsPromise = null; reject(new Error('turnstile unavailable')); return; }
        setTimeout(poll, 100);
      })();
    });
    return _tsPromise;
  }

  /* ── One-time style injection (gbebg- prefix; GBEMockPay precedent) ────── */
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
    '.gbebg{--gbebg-accent:#ffd700;box-sizing:border-box;width:100%;' +
      'margin:0.6rem 0 0.2rem;color:#f4f4f4;font-family:inherit;' +
      'border:1px solid rgba(255,255,255,.14);border-radius:10px;' +
      'padding:.8rem .9rem;background:rgba(255,255,255,.03);' +
      'font-size:.9rem;line-height:1.45;-webkit-text-size-adjust:100%;}' +
    '.gbebg *,.gbebg *::before,.gbebg *::after{box-sizing:border-box;}' +
    '.gbebg-head{margin:0 0 .25rem;font-size:.95rem;font-weight:700;color:#fff;}' +
    '.gbebg-body{margin:0 0 .6rem;color:rgba(255,255,255,.72);font-size:.84rem;}' +
    '.gbebg-note{margin:.4rem 0 0;color:rgba(255,255,255,.55);font-size:.78rem;}' +
    '.gbebg-email{color:#fff;font-weight:600;overflow-wrap:anywhere;}' +
    '.gbebg-btn{display:inline-flex;align-items:center;justify-content:center;' +
      'min-height:44px;padding:.6rem 1rem;border:0;border-radius:8px;' +
      'cursor:pointer;font-size:.92rem;font-weight:700;font-family:inherit;' +
      'color:#1a1a1a;background:var(--gbebg-accent);transition:opacity .15s;}' +
    '.gbebg-btn:hover{opacity:.88;}' +
    '.gbebg-btn:disabled{opacity:.5;cursor:not-allowed;}' +
    '.gbebg-btn-row{display:flex;gap:.6rem;flex-wrap:wrap;margin:.6rem 0 0;}' +
    '.gbebg-btn-row .gbebg-btn{flex:1 1 45%;min-width:120px;}' +
    '.gbebg-btn-text{display:inline-flex;align-items:center;justify-content:center;' +
      'min-height:44px;padding:.4rem .6rem;border:0;background:transparent;' +
      'color:rgba(255,255,255,.65);text-decoration:underline;cursor:pointer;' +
      'font-size:.84rem;font-family:inherit;}' +
    '.gbebg-btn-text:hover{color:#fff;}' +
    '.gbebg-label{display:block;margin:.6rem 0 .3rem;font-size:.8rem;' +
      'color:rgba(255,255,255,.7);}' +
    '.gbebg-input{width:100%;min-height:44px;padding:.55rem .7rem;' +
      'background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.2);' +
      'border-radius:8px;color:#fff;font-size:16px;letter-spacing:.18em;' +
      'font-variant-numeric:tabular-nums;font-family:inherit;}' +
    '.gbebg-input:focus{outline:2px solid var(--gbebg-accent);outline-offset:1px;}' +
    '.gbebg-status{margin:.55rem 0 0;font-size:.84rem;color:rgba(255,255,255,.8);' +
      'min-height:1.2em;overflow-wrap:anywhere;}' +
    '.gbebg-status.gbebg-err{color:#ff9d9d;}' +
    '.gbebg-turnstile{margin:.6rem 0 0;}' +
    '.gbebg-verified{display:flex;align-items:center;gap:.5rem;' +
      'color:#7ee2a0;font-weight:700;font-size:.95rem;}' +
    '.gbebg-verified .gbebg-tick{font-size:1.1rem;}' +
    '.gbebg-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
      'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ── mount ─────────────────────────────────────────────────────────────── */
  function mount(container, opts) {
    opts = opts || {};
    var purpose = PURPOSE_PHRASE[opts.purpose] ? opts.purpose : 'quote';
    var getEmail = (typeof opts.getEmail === 'function') ? opts.getEmail : function () { return ''; };
    var emailEditable = opts.emailEditable !== false;
    var onPassChange = (typeof opts.onPassChange === 'function') ? opts.onPassChange : function () {};

    var state = 'hidden';       // hidden|idle|sending|awaiting|verifying|verified|removed|destroyed
    var activated = false;      // probe fired for this activation cycle
    var issuedEmail = null;     // email the current code was issued for
    var mintedEmail = null;     // email the held pass was minted for
    var pass = null;
    var resendTaps = 0;         // in-memory UX ladder only (never a server claim)
    var transportFails = 0;     // consecutive issue-code transport failures
    var tsWidgetId = null;

    if (!container) return { getPass: function () { return null; }, reset: function () {}, destroy: function () {}, emailChanged: function () {} };
    container.style.display = 'none';

    /* page-leave teardown (SPA hash nav swaps the fragment out from under us:
       remove the Turnstile instance so repeat visits never accumulate).
       controller is hoisted and assigned before any hashchange can fire. */
    function onHashChange() {
      if (!container.isConnected) controller.destroy();
    }
    global.addEventListener('hashchange', onHashChange);

    function announce(msg) {
      var live = container.querySelector('.gbebg-live');
      if (live) live.textContent = msg || '';
    }
    function setStatus(msg, isErr) {
      var el = container.querySelector('.gbebg-status');
      if (el) {
        el.textContent = msg || '';
        el.className = 'gbebg-status' + (isErr ? ' gbebg-err' : '');
      }
    }

    function teardownTurnstile() {
      if (tsWidgetId !== null && global.turnstile && typeof global.turnstile.remove === 'function') {
        try { global.turnstile.remove(tsWidgetId); } catch (e) { /* already gone */ }
      }
      tsWidgetId = null;
    }
    function resetTurnstile() {
      if (tsWidgetId !== null && global.turnstile && typeof global.turnstile.reset === 'function') {
        try { global.turnstile.reset(tsWidgetId); } catch (e) { /* no-op */ }
      }
    }

    function discardPass() {
      if (pass !== null) {
        pass = null; mintedEmail = null;
        try { onPassChange(null); } catch (e) { /* consumer error — never break the widget */ }
      }
    }

    function post(bodyObj) {
      return fetchWithTimeout(apiBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj)
      }, REQUEST_TIMEOUT_MS).then(function (res) {
        return res.text().then(function (txt) {
          var body;
          try { body = txt ? JSON.parse(txt) : {}; } catch (e) { body = { _nonJson: true }; }
          return { status: res.status, ok: res.ok, body: body };
        });
      });
    }

    /* ── Renders ─────────────────────────────────────────────────────────── */
    function shell(inner) {
      ensureStyles();
      container.innerHTML =
        '<div class="gbebg" data-testid="gbebg-' + esc(purpose) + '">' + inner +
          '<div class="gbebg-live gbebg-sr" role="status" aria-live="polite"></div>' +
        '</div>';
      container.style.display = '';
    }

    function renderIdle() {
      state = 'idle';
      teardownTurnstile();
      var body;
      if (!emailEditable) {
        body = '<p class="gbebg-body">We’ll send a verification code to ' +
               '<span class="gbebg-email">' + esc(getEmail()) + '</span>.</p>';
      } else {
        body = '<p class="gbebg-body">We’ll email you a verification code — verify it’s you.</p>';
      }
      if (purpose === 'ticket') {
        body += '<p class="gbebg-note">' + COPY_HOLD_SAFE + '</p>';
      }
      shell(
        '<p class="gbebg-head">Verify your email</p>' + body +
        '<div class="gbebg-btn-row"><button type="button" class="gbebg-btn" data-gbebg="send">Verify email</button></div>' +
        '<p class="gbebg-status"></p>'
      );
      container.querySelector('[data-gbebg="send"]').addEventListener('click', sendTap);
    }

    function renderAwaiting() {
      state = 'awaiting';
      shell(
        '<p class="gbebg-head">Enter your verification code</p>' +
        '<p class="gbebg-body">We emailed a verification code to ' +
          '<span class="gbebg-email">' + esc(issuedEmail) + '</span>. It can take a minute to arrive.</p>' +
        (purpose === 'ticket' ? '<p class="gbebg-note">' + COPY_HOLD_SAFE + '</p>' : '') +
        '<label class="gbebg-label" for="gbebg-code-' + esc(purpose) + '">Verification code</label>' +
        '<input class="gbebg-input" id="gbebg-code-' + esc(purpose) + '" type="text" inputmode="numeric" ' +
          'autocomplete="one-time-code" maxlength="6" placeholder="6-digit code">' +
        '<div class="gbebg-turnstile"></div>' +
        '<div class="gbebg-btn-row">' +
          '<button type="button" class="gbebg-btn" data-gbebg="verify">Verify</button>' +
          '<button type="button" class="gbebg-btn" data-gbebg="resend">Resend code</button>' +
        '</div>' +
        (emailEditable
          ? '<button type="button" class="gbebg-btn-text" data-gbebg="change">Change email</button>'
          : '') +
        '<p class="gbebg-status"></p>'
      );
      container.querySelector('[data-gbebg="verify"]').addEventListener('click', verifyTap);
      container.querySelector('[data-gbebg="resend"]').addEventListener('click', resendTap);
      var chg = container.querySelector('[data-gbebg="change"]');
      if (chg) chg.addEventListener('click', function () { teardownTurnstile(); renderIdle(); });

      // EXPLICIT Turnstile render, only at this step (token stays freshest
      // right when it's needed; ~300s TTL, single-use).
      var tsHost = container.querySelector('.gbebg-turnstile');
      ensureTurnstile().then(function (ts) {
        if (state !== 'awaiting' && state !== 'verifying') return; // moved on
        if (!tsHost || !tsHost.isConnected) return;
        var narrow = false;
        try { narrow = tsHost.getBoundingClientRect().width < 300; } catch (e) {}
        try {
          tsWidgetId = ts.render(tsHost, {
            sitekey: TURNSTILE_SITEKEY,
            size: narrow ? 'compact' : 'flexible',
            callback: function () { /* token read at verify time */ },
            'error-callback': function () {
              setStatus(COPY_TURNSTILE_TROUBLE, true);
              announce(COPY_TURNSTILE_TROUBLE);
              resetTurnstile();
            },
            'expired-callback': function () {
              setStatus(COPY_TURNSTILE_TROUBLE, true);
              resetTurnstile();
            }
          });
        } catch (e) { /* render failure → verify will neutral-fail; copy shown then */ }
      }).catch(function () { /* library unreachable → same neutral posture */ });
    }

    function renderVerified() {
      state = 'verified';
      teardownTurnstile();
      shell(
        '<div class="gbebg-verified"><span class="gbebg-tick" aria-hidden="true">✓</span>' +
          '<span>Email verified</span></div>' +
        '<p class="gbebg-note">Verified for <span class="gbebg-email">' + esc(mintedEmail) + '</span>.</p>' +
        '<p class="gbebg-status"></p>'
      );
      announce('Your email is verified.');
    }

    function removeSelf() {
      // Quiet self-removal (hidden-not-broken): the host form is unaffected.
      state = 'removed';
      teardownTurnstile();
      container.innerHTML = '';
      container.style.display = 'none';
    }

    /* ── Actions ─────────────────────────────────────────────────────────── */
    function setButtonsDisabled(disabled) {
      var btns = container.querySelectorAll('.gbebg-btn, .gbebg-btn-text');
      for (var i = 0; i < btns.length; i++) btns[i].disabled = disabled;
    }

    function sendTap() {
      var em = String(getEmail() || '').trim();
      if (!emailShaped(em)) {
        setStatus('Enter your email address above, then tap Verify email.', true);
        return;
      }
      issueCode(em, false);
    }

    function issueCode(em, isResend) {
      var prevState = state;
      state = 'sending';
      setButtonsDisabled(true);
      var sendBtn = container.querySelector('[data-gbebg="send"]');
      if (sendBtn) sendBtn.textContent = 'Sending…';
      announce('Sending your verification code.');
      post({ action: 'issue-code', email: em, purpose: purpose }).then(function (r) {
        if (r.ok && r.body && r.body.ok === true) {
          transportFails = 0;
          issuedEmail = em;
          if (isResend) {
            state = 'awaiting';
            setButtonsDisabled(false);
            var msg;
            if (resendTaps <= 1) msg = 'Code sent — check your inbox (it can take a minute).';
            else if (resendTaps === 2) msg = 'Code sent. Still not seeing it? Check your spam folder.';
            else msg = 'Code sent. If it doesn’t arrive in a few minutes, email booking@layoungbandpage.com and we’ll help you complete ' + PURPOSE_PHRASE[purpose] + '.';
            setStatus(msg, false);
            announce(msg);
          } else {
            renderAwaiting();
            announce('Code sent — check your inbox (it can take a minute).');
          }
          return;
        }
        // Transport-level failure: fetch reject handled below; here it's a
        // non-200 or an unparseable/unexpected body — treated identically.
        handleIssueFailure(prevState);
      }).catch(function () {
        handleIssueFailure(prevState);
      });
    }

    function handleIssueFailure(prevState) {
      transportFails++;
      if (transportFails >= 2) { removeSelf(); return; }
      // NEVER claim "Code sent" on a failed request. Stay where we were
      // (idle stays idle — do NOT advance to code entry), re-enable instantly.
      if (prevState === 'awaiting') {
        state = 'awaiting';
        setButtonsDisabled(false);
        setStatus(COPY_SEND_FAIL, true);
        announce(COPY_SEND_FAIL);
      } else {
        renderIdle();
        setStatus(COPY_SEND_FAIL, true);
        announce(COPY_SEND_FAIL);
      }
    }

    function resendTap() {
      resendTaps++;
      issueCode(issuedEmail || String(getEmail() || '').trim(), true);
    }

    function verifyTap() {
      var input = container.querySelector('.gbebg-input');
      var code = input ? String(input.value || '').trim() : '';
      if (!code) {
        setStatus('Enter the code from your email, then tap Verify.', true);
        return;
      }
      var token = '';
      try {
        if (tsWidgetId !== null && global.turnstile && typeof global.turnstile.getResponse === 'function') {
          token = global.turnstile.getResponse(tsWidgetId) || '';
        }
      } catch (e) { token = ''; }
      state = 'verifying';
      setButtonsDisabled(true);
      announce('Checking your code.');
      post({ action: 'verify', email: issuedEmail, purpose: purpose, code: code, turnstileToken: token })
        .then(function (r) {
          if (r.ok && r.body && r.body.ok === true && typeof r.body.pass === 'string') {
            pass = r.body.pass;
            mintedEmail = issuedEmail;
            renderVerified();
            try { onPassChange(pass); } catch (e) { /* consumer error — never break the widget */ }
            return;
          }
          // EVERY verify failure (opaque {ok:false}, non-200, unparseable,
          // network) gets the SAME humane copy + a fresh Turnstile challenge
          // (a spent/expired token hard-fails siteverify on retry).
          handleVerifyFailure();
        }).catch(function () {
          handleVerifyFailure();
        });
    }

    function handleVerifyFailure() {
      state = 'awaiting';
      resetTurnstile();
      setButtonsDisabled(false);
      setStatus(COPY_VERIFY_FAIL, true);
      announce(COPY_VERIFY_FAIL);
    }

    /* ── Activation (reachability-gated render — EO amendment) ───────────── */
    function activate() {
      if (activated || state === 'removed' || state === 'destroyed') return;
      var em = String(getEmail() || '').trim();
      if (!emailShaped(em)) return;
      activated = true;
      probeReachable().then(function (ok) {
        if (state === 'removed' || state === 'destroyed') return;
        if (!ok) {
          // Not reachable (pre-golive 403 / tunnel down / slow / ambiguous):
          // render NOTHING — zero buyer-gate DOM, page identical to pre-S2.
          container.innerHTML = '';
          container.style.display = 'none';
          return;
        }
        renderIdle();
      });
    }

    /* ── Controller ──────────────────────────────────────────────────────── */
    var controller = {
      getPass: function () {
        if (state !== 'verified' || pass === null) return null;
        // A pass is minted for ONE exact email+purpose: never hand back a
        // pass that no longer matches the live email.
        if (normEmail(getEmail()) !== normEmail(mintedEmail)) return null;
        return pass;
      },
      reset: function () {
        if (state === 'destroyed') return;
        discardPass();
        teardownTurnstile();
        issuedEmail = null;
        resendTaps = 0;
        transportFails = 0;
        activated = false;
        state = 'hidden';
        container.innerHTML = '';
        container.style.display = 'none';
      },
      destroy: function () {
        discardPass();
        teardownTurnstile();
        state = 'destroyed';
        global.removeEventListener('hashchange', onHashChange);
        container.innerHTML = '';
        container.style.display = 'none';
      },
      emailChanged: function () {
        if (state === 'removed' || state === 'destroyed') return;
        var emNow = normEmail(getEmail());
        if (state === 'verified') {
          if (emNow !== normEmail(mintedEmail)) {
            // Edited after verified → the pass no longer matches the visible
            // email. Discard and drop back to idle (never silently stale).
            discardPass();
            renderIdle();
          }
          return;
        }
        if ((state === 'awaiting' || state === 'verifying' || state === 'sending') &&
            issuedEmail && emNow !== normEmail(issuedEmail)) {
          teardownTurnstile();
          renderIdle();
          return;
        }
        if (!activated) activate();
      }
    };

    // Known-email surfaces (booking accept) have no buyer-typed email —
    // activate immediately on mount.
    if (!emailEditable) activate();

    return controller;
  }

  global.GBEBuyerGate = { mount: mount };

})(typeof window !== 'undefined' ? window : this);
