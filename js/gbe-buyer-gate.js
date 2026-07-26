/* =============================================================================
 * gbe-buyer-gate.js — SHARED buyer human-check + magic-LINK issuer widget
 * story-ticket-buyer-flow-hardening-2026-07-23 (Wave 2 — owner override D-A:
 * EMAIL LINK, not OTP code). Supersedes the S2 OTP-card build.
 *
 * ONE component, owned in TWO byte-identical copies (independent public repos —
 * no auto-sync). To change it: edit one copy, copy it VERBATIM over the other,
 * and confirm `md5 <both paths>` MATCH before committing. Never fork or inline.
 *   • GoldBottomEntLLC/js/gbe-buyer-gate.js
 *   • LAYoungBandPage/js/gbe-buyer-gate.js
 *
 * WHAT IT DOES NOW (magic-link issuer — replaces the old 6-digit OTP + in-page
 * pass mint, which are GONE):
 *   Turnstile human-check up front → a "Verify email" button that stays
 *   disabled until (a) the host reports its info is ready AND (b) the human-
 *   check has passed → on tap it POSTs a verify-LINK request → a terminal
 *   "Check your email" state with a Resend control. The button in the email is
 *   what advances the buyer (server-side single-use link); this widget NEVER
 *   mints a pass and NEVER holds inventory — it only proves a live inbox +
 *   a human, then hands off to email.
 *
 * WHY host-driven (endpoint + context): the verify-link endpoint and its body
 * are surface-specific (the ticket checkout binds eventId). The host passes
 *   opts.verifyUrl   — where to POST
 *   opts.getContext  — () => extra body fields (e.g. {eventId,buyerName,…})
 * so this file carries ZERO surface-specific knowledge and any surface can
 * adopt the magic-link flow by pointing it at its own endpoint.
 *
 * ACTIVATION IS EXPLICIT (structural, not a soft probe): the widget renders the
 * issuer card ONLY when the host mounts it with opts.flow === 'magic-link'.
 * Any other mount returns a benign NO-OP controller and renders NOTHING — this
 * is the interim posture for surfaces (quote/booking) not yet migrated to the
 * link model; it matches their current pre-golive prod state (render nothing)
 * and keeps their host submit buttons fully enabled and unaffected.
 *
 * API — window.GBEBuyerGate.mount(container, opts):
 *   opts.flow          {string}   'magic-link' activates the issuer; anything
 *                                 else → no-op controller, no DOM.
 *   opts.purpose       {string}   'quote' | 'ticket' | 'booking' (drives copy +
 *                                 the server purpose binding sent in the body)
 *   opts.verifyUrl     {string}   POST target for the verify-link request
 *   opts.verifyHeaders {object}   extra request headers merged onto the POST
 *                                 (e.g. a Supabase anon apikey + Authorization)
 *   opts.getEmail      {Function} () => string — read the buyer email LIVE
 *   opts.getContext    {Function} () => object — extra body fields merged into
 *                                 the verify-link POST (undefined values dropped;
 *                                 the host owns every surface-specific field —
 *                                 eventId, buyerName, fanOptIn, …)
 *   opts.onStateChange {Function} (state) => void — optional host hook
 *                                 ('idle' | 'sending' | 'sent')
 * Returns a controller: { getPass, reset, destroy, emailChanged, refresh }.
 *   getPass()      → always null (this widget no longer mints a pass; the pass
 *                    is minted server-side when the emailed link is consumed).
 *   refresh()      → re-evaluate the "Verify email" button enabled state (call
 *                    on host input changes).
 *   emailChanged() → alias of refresh() (kept for host back-compat).
 *   reset()        → back to a fresh idle card (new human-check).
 *   destroy()      → full teardown (DOM, Turnstile, listeners).
 *
 * SCOPE FENCE (truthfulness): copy never claims verification "protects" or is
 * "required" in-widget; the enforcement is server-side at the atomic purchase.
 * No skip/override path exists here (QAE bypass is server-only, never client).
 * Mobile-first: 390px, every interactive element >= 44px tap height.
 * ===========================================================================*/
(function (global) {
  'use strict';

  // Idempotent under SPA fragment re-execution (PageLoader re-creates script
  // tags on every navigation to a cached page).
  if (global.GBEBuyerGate) return;

  /* ── Named constants ───────────────────────────────────────────────────── */
  // Cloudflare's documented ALWAYS-PASS TEST sitekey — the ONLY sitekey allowed
  // in shipped client code (the real key swap is an owner-gated golive action).
  var TURNSTILE_SITEKEY = '0x4AAAAAAD-aQ_y9La1yK1HJ';
  var TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var TURNSTILE_SCRIPT_ID = 'gbe-turnstile-api';
  var REQUEST_TIMEOUT_MS = 12000; // verify-link call
  var STYLE_ID = 'gbebg-styles';

  var PURPOSE_PHRASE = {
    quote: 'your quote request',
    ticket: 'your ticket purchase',
    booking: 'your booking'
  };

  var COPY_SEND_FAIL = 'We couldn’t send that just now — please try again in a moment.';
  var COPY_HUMAN_FAIL = 'That human-check didn’t pass — please try again.';
  var COPY_TURNSTILE_TROUBLE = 'Having trouble with the human-check — please try again.';
  var COPY_INFO_FIRST = 'Enter your name and email above, then complete the check.';

  /* ── Small helpers ─────────────────────────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function emailShaped(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

  function fetchWithTimeout(url, opts, ms) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, ms);
    var fetchOpts = Object.assign({}, opts || {}, { signal: ctrl.signal });
    return fetch(url, fetchOpts).finally(function () { clearTimeout(tid); });
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
    '.gbebg-btn-row .gbebg-btn{flex:1 1 100%;}' +
    '.gbebg-btn-text{display:inline-flex;align-items:center;justify-content:center;' +
      'min-height:44px;padding:.4rem .6rem;border:0;background:transparent;' +
      'color:rgba(255,255,255,.65);text-decoration:underline;cursor:pointer;' +
      'font-size:.84rem;font-family:inherit;}' +
    '.gbebg-btn-text:hover{color:#fff;}' +
    '.gbebg-status{margin:.55rem 0 0;font-size:.84rem;color:rgba(255,255,255,.8);' +
      'min-height:1.2em;overflow-wrap:anywhere;}' +
    '.gbebg-status.gbebg-err{color:#ff9d9d;}' +
    '.gbebg-turnstile{margin:.6rem 0 0;min-height:1px;}' +
    '.gbebg-sent{display:flex;align-items:center;gap:.5rem;' +
      'color:#7ee2a0;font-weight:700;font-size:.95rem;}' +
    '.gbebg-sent .gbebg-tick{font-size:1.1rem;}' +
    '.gbebg-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
      'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ── No-op controller (non-magic-link mounts render nothing) ───────────── */
  function noopController(container) {
    if (container) { container.innerHTML = ''; container.style.display = 'none'; }
    return {
      getPass: function () { return null; },
      reset: function () {},
      destroy: function () {},
      emailChanged: function () {},
      refresh: function () {}
    };
  }

  /* ── mount ─────────────────────────────────────────────────────────────── */
  function mount(container, opts) {
    opts = opts || {};

    // Structural activation: ONLY the magic-link flow renders. Everything else
    // (quote/booking pre-migration) gets a benign no-op — zero DOM, host
    // submit untouched, getPass() null.
    if (opts.flow !== 'magic-link' || !container || !opts.verifyUrl) {
      return noopController(container);
    }

    var purpose = PURPOSE_PHRASE[opts.purpose] ? opts.purpose : 'ticket';
    var verifyUrl = opts.verifyUrl;
    var verifyHeaders = (opts.verifyHeaders && typeof opts.verifyHeaders === 'object') ? opts.verifyHeaders : null;
    var getEmail = (typeof opts.getEmail === 'function') ? opts.getEmail : function () { return ''; };
    var getContext = (typeof opts.getContext === 'function') ? opts.getContext : function () { return {}; };
    var onStateChange = (typeof opts.onStateChange === 'function') ? opts.onStateChange : function () {};

    var state = 'idle';       // idle | sending | sent | destroyed
    var tsWidgetId = null;
    var tsToken = '';
    var sentEmail = '';

    /* page-leave teardown (SPA hash nav swaps the fragment out): remove the
       Turnstile instance so repeat visits never accumulate. */
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
    function emit(s) { try { onStateChange(s); } catch (e) { /* host error — never break the widget */ } }

    function teardownTurnstile() {
      if (tsWidgetId !== null && global.turnstile && typeof global.turnstile.remove === 'function') {
        try { global.turnstile.remove(tsWidgetId); } catch (e) { /* already gone */ }
      }
      tsWidgetId = null;
      tsToken = '';
    }
    function resetTurnstile() {
      tsToken = '';
      if (tsWidgetId !== null && global.turnstile && typeof global.turnstile.reset === 'function') {
        try { global.turnstile.reset(tsWidgetId); } catch (e) { /* no-op */ }
      }
    }

    function post(bodyObj) {
      var headers = { 'Content-Type': 'application/json' };
      if (verifyHeaders) {
        for (var h in verifyHeaders) {
          if (Object.prototype.hasOwnProperty.call(verifyHeaders, h)) headers[h] = verifyHeaders[h];
        }
      }
      return fetchWithTimeout(verifyUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(bodyObj)
      }, REQUEST_TIMEOUT_MS).then(function (res) {
        return res.text().then(function (txt) {
          var body;
          try { body = txt ? JSON.parse(txt) : {}; } catch (e) { body = { _nonJson: true }; }
          return { status: res.status, ok: res.ok, body: body };
        });
      });
    }

    /* ── Readiness (host info present + human-check passed) ───────────────── */
    function hostReady() {
      if (!emailShaped(getEmail())) return false;
      var ctx = getContext() || {};
      if (!String(ctx.buyerName || '').trim()) return false;
      return true;
    }
    function updateBtn() {
      var btn = container.querySelector('[data-gbebg="verify"]');
      if (!btn) return;
      btn.disabled = !(hostReady() && !!tsToken);
    }
    function readToken() {
      if (tsToken) return tsToken;
      try {
        if (tsWidgetId !== null && global.turnstile && typeof global.turnstile.getResponse === 'function') {
          return global.turnstile.getResponse(tsWidgetId) || '';
        }
      } catch (e) {}
      return '';
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

    function renderIdle(isResend) {
      state = 'idle';
      emit('idle');
      shell(
        '<p class="gbebg-head">' + (isResend ? 'Resend your link' : 'Verify your email') + '</p>' +
        '<p class="gbebg-body">We’ll email you a secure link to finish ' + esc(PURPOSE_PHRASE[purpose]) +
          '. Tap it and you’ll land right back here on the payment step.</p>' +
        '<div class="gbebg-turnstile"></div>' +
        '<div class="gbebg-btn-row">' +
          '<button type="button" class="gbebg-btn" data-gbebg="verify" disabled>' +
            (isResend ? 'Resend email' : 'Verify email') + '</button>' +
        '</div>' +
        '<p class="gbebg-status"></p>'
      );
      container.querySelector('[data-gbebg="verify"]').addEventListener('click', verifyTap);

      var tsHost = container.querySelector('.gbebg-turnstile');
      ensureTurnstile().then(function (ts) {
        if (state !== 'idle') return;
        if (!tsHost || !tsHost.isConnected) return;
        var narrow = false;
        try { narrow = tsHost.getBoundingClientRect().width < 300; } catch (e) {}
        try {
          tsWidgetId = ts.render(tsHost, {
            sitekey: TURNSTILE_SITEKEY,
            size: narrow ? 'compact' : 'flexible',
            callback: function (token) { tsToken = token || ''; updateBtn(); },
            'error-callback': function () {
              tsToken = '';
              setStatus(COPY_TURNSTILE_TROUBLE, true);
              announce(COPY_TURNSTILE_TROUBLE);
              resetTurnstile();
              updateBtn();
            },
            'expired-callback': function () {
              tsToken = '';
              resetTurnstile();
              updateBtn();
            }
          });
        } catch (e) { /* render failure → button stays disabled, no send possible */ }
      }).catch(function () { /* library unreachable → same posture */ });

      updateBtn();
    }

    function renderSent() {
      state = 'sent';
      emit('sent');
      teardownTurnstile();
      shell(
        '<div class="gbebg-sent"><span class="gbebg-tick" aria-hidden="true">✉️</span>' +
          '<span>Check your email</span></div>' +
        '<p class="gbebg-body">We just sent a secure checkout link to ' +
          '<span class="gbebg-email">' + esc(sentEmail) + '</span>. Open it on this ' +
          'device — or any device — to finish. The link works once and expires in about 30 minutes.</p>' +
        '<p class="gbebg-note">Didn’t get it? Check your spam folder, or resend below.</p>' +
        '<div class="gbebg-btn-row">' +
          '<button type="button" class="gbebg-btn-text" data-gbebg="resend">Resend email</button>' +
        '</div>' +
        '<p class="gbebg-status"></p>'
      );
      container.querySelector('[data-gbebg="resend"]').addEventListener('click', function () {
        renderIdle(true);
      });
      announce('We sent a secure checkout link to ' + sentEmail + '.');
    }

    /* ── Actions ─────────────────────────────────────────────────────────── */
    function setButtonsDisabled(disabled) {
      var btns = container.querySelectorAll('.gbebg-btn, .gbebg-btn-text');
      for (var i = 0; i < btns.length; i++) btns[i].disabled = disabled;
    }

    function verifyTap() {
      if (!hostReady()) { setStatus(COPY_INFO_FIRST, true); return; }
      var token = readToken();
      if (!token) { setStatus('Please complete the human-check above, then tap again.', true); return; }

      // Widget owns email + token; the host's getContext() owns every surface-
      // specific field (eventId, buyerName, fanOptIn — NOT purpose, NOT phone).
      var body = { email: String(getEmail() || '').trim(), turnstileToken: token };
      var ctx = getContext() || {};
      for (var k in ctx) {
        if (Object.prototype.hasOwnProperty.call(ctx, k) && ctx[k] !== undefined && ctx[k] !== null) {
          body[k] = ctx[k];
        }
      }

      state = 'sending';
      emit('sending');
      setButtonsDisabled(true);
      setStatus('Sending your secure link…', false);
      announce('Sending your secure checkout link.');

      post(body).then(function (r) {
        if (r.ok && r.body && r.body.ok === true) {
          sentEmail = body.email;
          renderSent();
          return;
        }
        if (r.ok && r.body && r.body.ok === false) {
          // Human-check failed server-side → re-prompt Turnstile, stay on idle.
          state = 'idle';
          resetTurnstile();
          setButtonsDisabled(false);
          setStatus(COPY_HUMAN_FAIL, true);
          announce(COPY_HUMAN_FAIL);
          updateBtn();
          return;
        }
        handleSendFailure();
      }).catch(handleSendFailure);
    }

    function handleSendFailure() {
      state = 'idle';
      resetTurnstile();
      setButtonsDisabled(false);
      setStatus(COPY_SEND_FAIL, true);
      announce(COPY_SEND_FAIL);
      updateBtn();
    }

    /* ── Controller ──────────────────────────────────────────────────────── */
    var controller = {
      getPass: function () { return null; }, // never mints a pass (server does)
      refresh: function () { if (state === 'idle') updateBtn(); },
      emailChanged: function () { if (state === 'idle') updateBtn(); },
      reset: function () {
        if (state === 'destroyed') return;
        teardownTurnstile();
        renderIdle(false);
      },
      destroy: function () {
        teardownTurnstile();
        state = 'destroyed';
        global.removeEventListener('hashchange', onHashChange);
        container.innerHTML = '';
        container.style.display = 'none';
      }
    };

    renderIdle(false);
    return controller;
  }

  global.GBEBuyerGate = { mount: mount };

})(typeof window !== 'undefined' ? window : this);
