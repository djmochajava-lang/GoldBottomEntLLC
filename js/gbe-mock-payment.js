/* =============================================================================
 * gbe-mock-payment.js — SHARED customer-facing mock/sandbox payment SCREEN
 * story-mock-payment-visible-screen (EO vetting 2026-07-15)
 *
 * ONE component, consumed by BOTH consumer paths:
 *   • Ticket checkout  — LAYoungBandPage/pages/shows.html
 *   • Booking deposit  — GoldBottomEntLLC/pages/accept.html
 * This file is authored ONCE and dropped VERBATIM into each repo's js/ dir.
 * It is the single source of truth for the mock-payment UX — do NOT fork.
 *
 * WHAT IT RENDERS (the visible screen the EO asked for):
 *   1. An unmistakable "TEST MODE — no real payment" banner on the SCREEN,
 *      on the card MOCKUP, and on the RECEIPT.
 *   2. Itemized line items + a purpose-labelled total (deposit vs full vs
 *      ticket tiers), currency-formatted.
 *   3. A card MOCKUP that is a pure NON-INTERACTIVE GRAPHIC — no <input>, no
 *      <form>, nothing submittable. Pre-filled with obviously-fake test
 *      values. It captures NO cardholder data, so it fully honours the
 *      SAQ-A / C6 posture ("no card FIELD renders on a GBE page") while still
 *      showing a fan/buyer what the payment moment looks like.
 *   4. A visible processing -> success transition (never instant-silent),
 *      with the state announced to assistive tech (aria-live).
 *
 * ENGINE STAYS SERVER-SIDE (thin client): this component owns UX only. The
 * host page supplies an async onPay() that talks to its OWN existing mock
 * rail (tickets: POST /orders/:id/pay nonce:'mock'; booking: the server
 * settlement path). No secrets, no processor SDK, no real capture here.
 *
 * API — window.GBEMockPay.mount(container, opts):
 *   opts.testMode      {boolean}  show TEST-MODE labelling (default true)
 *   opts.purpose       {string}   'ticket' | 'deposit' (drives copy only)
 *   opts.heading       {string}   e.g. event / booking name
 *   opts.subheading    {string}   e.g. date · venue
 *   opts.currency      {string}   ISO 4217, default 'USD'
 *   opts.lineItems     {Array}    [{ label, amount /* cents *\/, qty? }]
 *   opts.totalLabel    {string}   e.g. 'Total' | 'Deposit due (50%)'
 *   opts.totalCents    {number}   integer cents
 *   opts.payLabel      {string}   button label (default derived from total)
 *   opts.onPay         {Function} () => Promise<receipt>  (performs mock charge)
 *                                  receipt may carry { confirmationCode }.
 *                                  Reject with err.friendly for a shown message.
 *   opts.onReceipt     {Function} (slotEl, receipt) => void  consumer add-ons
 *                                  (QR grid, print buttons, confirming note…)
 *   opts.receiptTitle  {string}   success headline (default "You're in!")
 *   opts.receiptNote   {string}   extra line under the headline
 *
 * Returns a small controller: { el, reset(), destroy() }.
 * Mobile-first: renders correctly at 390px, all targets >= 44px.
 * ===========================================================================*/
(function (global) {
  'use strict';

  var STYLE_ID = 'gbemp-styles';

  /* ── Currency formatting (Intl when available, safe fallback) ──────────── */
  function fmtMoney(cents, currency) {
    var n = (typeof cents === 'number' && isFinite(cents)) ? cents / 100 : 0;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: currency || 'USD'
      }).format(n);
    } catch (e) {
      return '$' + n.toFixed(2);
    }
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── One-time style injection (scoped with the gbemp- prefix) ──────────── */
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
    '.gbemp{--gbemp-gold:#ffd700;--gbemp-test:#ffb020;box-sizing:border-box;' +
      'width:100%;max-width:440px;margin:0 auto;color:#f4f4f4;' +
      'font-family:inherit;-webkit-text-size-adjust:100%;}' +
    '.gbemp *,.gbemp *::before,.gbemp *::after{box-sizing:border-box;}' +
    /* TEST-MODE banners */
    '.gbemp-testbanner{display:flex;gap:.5rem;align-items:flex-start;' +
      'background:rgba(255,176,32,.14);border:1px solid rgba(255,176,32,.5);' +
      'border-radius:10px;padding:.7rem .8rem;margin:0 0 1rem;font-size:.82rem;' +
      'line-height:1.4;color:#ffe4b0;}' +
    '.gbemp-testbanner .gbemp-dot{flex:0 0 auto;font-size:.9rem;line-height:1.3;}' +
    '.gbemp-testbanner strong{text-transform:uppercase;letter-spacing:.05em;color:#ffcf80;}' +
    /* summary / line items */
    '.gbemp-head{margin:0 0 .15rem;font-size:1.05rem;font-weight:700;color:#fff;}' +
    '.gbemp-sub{margin:0 0 1rem;font-size:.82rem;color:rgba(255,255,255,.6);}' +
    '.gbemp-lines{border:1px solid rgba(255,255,255,.12);border-radius:10px;' +
      'padding:.35rem .8rem;margin:0 0 1rem;}' +
    '.gbemp-line{display:flex;justify-content:space-between;gap:.75rem;' +
      'padding:.5rem 0;font-size:.9rem;border-bottom:1px solid rgba(255,255,255,.08);}' +
    '.gbemp-line:last-child{border-bottom:0;}' +
    '.gbemp-line .gbemp-l{color:rgba(255,255,255,.8);}' +
    '.gbemp-line .gbemp-v{color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '.gbemp-total{display:flex;justify-content:space-between;gap:.75rem;' +
      'align-items:baseline;padding:.6rem 0 .1rem;font-weight:700;}' +
    '.gbemp-total .gbemp-l{color:rgba(255,255,255,.7);font-size:.9rem;}' +
    '.gbemp-total .gbemp-v{color:var(--gbemp-gold);font-size:1.2rem;' +
      'font-variant-numeric:tabular-nums;}' +
    /* the fake card GRAPHIC — no inputs, purely illustrative */
    '.gbemp-cardwrap{margin:0 0 1rem;}' +
    '.gbemp-cardlabel{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;' +
      'color:rgba(255,255,255,.45);margin:0 0 .4rem;}' +
    '.gbemp-card{position:relative;border-radius:14px;padding:1rem 1.05rem 1.1rem;' +
      'background:linear-gradient(135deg,#2a2a3a 0%,#1c1c28 100%);' +
      'border:1px solid rgba(255,255,255,.14);overflow:hidden;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.35);user-select:none;}' +
    '.gbemp-card[aria-disabled="true"]{opacity:.92;}' +
    '.gbemp-card-ribbon{position:absolute;top:12px;right:-34px;transform:rotate(45deg);' +
      'background:var(--gbemp-test);color:#241a00;font-size:.62rem;font-weight:800;' +
      'letter-spacing:.08em;padding:.15rem 2.6rem;text-transform:uppercase;}' +
    '.gbemp-card-top{display:flex;justify-content:space-between;align-items:center;' +
      'margin-bottom:1.4rem;}' +
    '.gbemp-chip{width:34px;height:26px;border-radius:5px;' +
      'background:linear-gradient(135deg,#d9b96b,#b8912f);opacity:.85;}' +
    '.gbemp-brand{font-size:.72rem;font-weight:700;letter-spacing:.1em;' +
      'color:rgba(255,255,255,.5);text-transform:uppercase;}' +
    '.gbemp-card-number{font-size:1.15rem;letter-spacing:.14em;color:#e9e9f2;' +
      'font-variant-numeric:tabular-nums;margin-bottom:.9rem;font-family:monospace;}' +
    '.gbemp-card-row{display:flex;gap:1.4rem;}' +
    '.gbemp-card-field{min-width:0;}' +
    '.gbemp-card-field .gbemp-cap{display:block;font-size:.56rem;' +
      'text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.4);' +
      'margin-bottom:.15rem;}' +
    '.gbemp-card-field .gbemp-val{font-size:.82rem;color:#dcdce6;font-family:monospace;}' +
    '.gbemp-card-note{margin:.5rem 0 0;font-size:.7rem;color:var(--gbemp-test);' +
      'text-align:center;line-height:1.35;}' +
    /* pay button */
    '.gbemp-pay{display:block;width:100%;min-height:48px;border:0;cursor:pointer;' +
      'border-radius:10px;padding:.85rem 1rem;font-size:1rem;font-weight:700;' +
      'color:#1a1a1a;background:var(--gbemp-gold);transition:opacity .15s;}' +
    '.gbemp-pay:hover{opacity:.88;}' +
    '.gbemp-pay:disabled{opacity:.5;cursor:not-allowed;}' +
    '.gbemp-err{color:#ff8b8b;font-size:.85rem;margin:.2rem 0 .8rem;min-height:1px;}' +
    /* processing */
    '.gbemp-proc{text-align:center;padding:1.6rem .5rem;}' +
    '.gbemp-spin{width:40px;height:40px;margin:0 auto 1rem;border-radius:50%;' +
      'border:3px solid rgba(255,255,255,.15);border-top-color:var(--gbemp-gold);' +
      'animation:gbemp-spin .8s linear infinite;}' +
    '@keyframes gbemp-spin{to{transform:rotate(360deg);}}' +
    '@media (prefers-reduced-motion:reduce){.gbemp-spin{animation-duration:2s;}}' +
    '.gbemp-proc p{color:rgba(255,255,255,.7);font-size:.92rem;margin:0;}' +
    /* receipt */
    '.gbemp-receipt{text-align:center;}' +
    '.gbemp-receipt-icon{font-size:2.6rem;margin:.2rem 0 .3rem;}' +
    '.gbemp-receipt h3{margin:0 0 .3rem;color:var(--gbemp-gold);font-size:1.25rem;}' +
    '.gbemp-receipt-note{color:rgba(255,255,255,.7);font-size:.9rem;margin:0 0 .8rem;}' +
    '.gbemp-receipt-code{display:inline-block;font-family:monospace;font-size:1.05rem;' +
      'letter-spacing:.06em;color:#fff;background:rgba(255,255,255,.08);' +
      'border:1px dashed rgba(255,255,255,.25);border-radius:8px;padding:.4rem .8rem;' +
      'margin:0 0 1rem;}' +
    '.gbemp-receipt-slot{margin:.5rem 0 0;}' +
    '.gbemp-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
      'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ── The fake card graphic (NO inputs — pure illustration) ─────────────── */
  function cardMarkup(testMode) {
    return '' +
      '<div class="gbemp-cardwrap">' +
        '<p class="gbemp-cardlabel">Payment method</p>' +
        '<div class="gbemp-card" aria-disabled="true" role="img" ' +
             'aria-label="Sample test card — pre-filled demonstration only, no card entry required">' +
          (testMode ? '<span class="gbemp-card-ribbon">Sample</span>' : '') +
          '<div class="gbemp-card-top">' +
            '<span class="gbemp-chip" aria-hidden="true"></span>' +
            (testMode ? '' : '<span class="gbemp-brand">Card</span>') +
          '</div>' +
          '<div class="gbemp-card-number">4242&nbsp;4242&nbsp;4242&nbsp;4242</div>' +
          '<div class="gbemp-card-row">' +
            '<div class="gbemp-card-field"><span class="gbemp-cap">Card holder</span>' +
              '<span class="gbemp-val">TEST / SANDBOX</span></div>' +
            '<div class="gbemp-card-field"><span class="gbemp-cap">Expires</span>' +
              '<span class="gbemp-val">12&thinsp;/&thinsp;34</span></div>' +
            '<div class="gbemp-card-field"><span class="gbemp-cap">CVC</span>' +
              '<span class="gbemp-val">•••</span></div>' +
          '</div>' +
        '</div>' +
        '<p class="gbemp-card-note">Sample card shown for preview only &mdash; ' +
          'no card number is requested or collected.</p>' +
      '</div>';
  }

  function linesMarkup(opts) {
    var items = Array.isArray(opts.lineItems) ? opts.lineItems : [];
    var rows = items.map(function (it) {
      var label = esc(it.label || 'Item') + (it.qty ? ' <span style="color:rgba(255,255,255,.5)">&times;' + esc(it.qty) + '</span>' : '');
      return '<div class="gbemp-line"><span class="gbemp-l">' + label +
        '</span><span class="gbemp-v">' + esc(fmtMoney(it.amount, opts.currency)) + '</span></div>';
    }).join('');
    if (opts.hideTotal) {
      return '<div class="gbemp-lines">' + rows + '</div>';
    }
    var totalLabel = esc(opts.totalLabel || 'Total');
    var totalVal = esc(fmtMoney(opts.totalCents, opts.currency));
    return '<div class="gbemp-lines">' + rows +
      '<div class="gbemp-total"><span class="gbemp-l">' + totalLabel +
      '</span><span class="gbemp-v">' + totalVal + '</span></div></div>';
  }

  function testBanner(purpose) {
    var what = (purpose === 'deposit')
      ? 'This is a live preview of the deposit payment screen. No real payment is collected and no card details are requested.'
      : 'This checkout is a live preview of our ticketing. No real payment is processed and no card is required.';
    return '<div class="gbemp-testbanner" role="note">' +
      '<span class="gbemp-dot" aria-hidden="true">&#9888;&#65039;</span>' +
      '<span><strong>Test mode</strong> &mdash; ' + what +
      ' Test orders are not valid ' + (purpose === 'deposit' ? 'bookings' : 'tickets') + '.</span></div>';
  }

  /* ── Mount ─────────────────────────────────────────────────────────────── */
  function mount(container, opts) {
    if (!container) throw new Error('GBEMockPay.mount: container required');
    opts = opts || {};
    if (opts.testMode == null) opts.testMode = true;
    ensureStyles();

    var testMode = !!opts.testMode;
    var purpose = opts.purpose || 'ticket';
    var payLabel = opts.payLabel ||
      ((purpose === 'deposit' ? 'Pay deposit ' : 'Pay ') + fmtMoney(opts.totalCents, opts.currency) +
       (testMode ? ' (Test)' : ''));

    var root = document.createElement('div');
    root.className = 'gbemp';

    function view(html) { root.innerHTML = html; }

    /* aria-live region for state announcements (a11y) */
    function announce(msg) {
      var live = root.querySelector('.gbemp-live');
      if (live) live.textContent = msg;
    }

    function renderForm(errMsg) {
      view(
        (testMode ? testBanner(purpose) : '') +
        (opts.heading ? '<p class="gbemp-head">' + esc(opts.heading) + '</p>' : '') +
        (opts.subheading ? '<p class="gbemp-sub">' + esc(opts.subheading) + '</p>' : '') +
        linesMarkup(opts) +
        cardMarkup(testMode) +
        '<div class="gbemp-err" role="alert">' + (errMsg ? esc(errMsg) : '') + '</div>' +
        '<button type="button" class="gbemp-pay">' + esc(payLabel) + '</button>' +
        '<span class="gbemp-live gbemp-sr" role="status" aria-live="polite"></span>'
      );
      var btn = root.querySelector('.gbemp-pay');
      btn.addEventListener('click', doPay);
    }

    function renderProcessing() {
      var msg = testMode
        ? (purpose === 'deposit'
            ? 'Recording your TEST deposit &mdash; no real payment is processed&hellip;'
            : 'Confirming your TEST order &mdash; no real payment is processed&hellip;')
        : 'Processing payment&hellip;';
      view(
        '<div class="gbemp-proc">' +
          '<div class="gbemp-spin" aria-hidden="true"></div>' +
          '<p>' + msg + '</p>' +
          '<span class="gbemp-live gbemp-sr" role="status" aria-live="polite"></span>' +
        '</div>'
      );
      announce(testMode ? 'Processing your test payment.' : 'Processing your payment.');
    }

    function renderReceipt(receipt) {
      receipt = receipt || {};
      var code = receipt.confirmationCode || receipt.code || '';
      view(
        '<div class="gbemp-receipt">' +
          (testMode ? testBanner(purpose) : '') +
          '<div class="gbemp-receipt-icon" aria-hidden="true">' +
            (purpose === 'deposit' ? '&#127881;' : '&#127915;') + '</div>' +
          '<h3>' + esc(opts.receiptTitle || (purpose === 'deposit' ? 'Deposit received' : "You're in!")) + '</h3>' +
          (opts.receiptNote ? '<p class="gbemp-receipt-note">' + esc(opts.receiptNote) + '</p>' : '') +
          (code ? '<div class="gbemp-receipt-code">' + esc(code) + '</div>' : '') +
          '<div class="gbemp-receipt-slot"></div>' +
          '<span class="gbemp-live gbemp-sr" role="status" aria-live="polite"></span>' +
        '</div>'
      );
      announce(testMode
        ? 'Test payment complete. ' + (code ? 'Confirmation code ' + code + '. ' : '') + 'No real payment was processed.'
        : 'Payment complete.' + (code ? ' Confirmation code ' + code + '.' : ''));
      if (typeof opts.onReceipt === 'function') {
        try { opts.onReceipt(root.querySelector('.gbemp-receipt-slot'), receipt); }
        catch (e) { /* consumer add-on failure must not break the receipt */ }
      }
    }

    var _busy = false;
    function doPay() {
      if (_busy) return;
      _busy = true;
      renderProcessing();
      var p;
      try {
        p = (typeof opts.onPay === 'function') ? opts.onPay() : Promise.resolve({});
      } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(function (receipt) {
        _busy = false;
        renderReceipt(receipt);
      }).catch(function (err) {
        _busy = false;
        var msg = (err && err.friendly) ? err.friendly
          : (testMode
              ? 'Something went wrong with the test payment — nothing was charged. Please try again.'
              : 'Something went wrong on our side — you have not been charged. Please try again.');
        renderForm(msg);
      });
    }

    container.appendChild(root);
    renderForm();

    return {
      el: root,
      reset: function () { _busy = false; renderForm(); },
      showReceipt: function (r) { _busy = false; renderReceipt(r); },
      destroy: function () { if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  /* ── Embed mode: render just the VISIBLE SCREEN (banner + itemized summary
   *    + fake card graphic), no pay button, no state machine. For hosts that
   *    already own their own confirm action + receipt (the ticket checkout's
   *    submit/confirmation; the booking deposit's Square-hosted link + poll)
   *    but need the shared, honest, card-less mock-payment SCREEN in front of
   *    it. Same single source of truth — no forked markup. ───────────────── */
  function renderScreen(container, opts) {
    if (!container) throw new Error('GBEMockPay.renderScreen: container required');
    opts = opts || {};
    if (opts.testMode == null) opts.testMode = true;
    ensureStyles();
    var root = document.createElement('div');
    root.className = 'gbemp';
    root.innerHTML =
      (opts.testMode ? testBanner(opts.purpose || 'ticket') : '') +
      (opts.heading ? '<p class="gbemp-head">' + esc(opts.heading) + '</p>' : '') +
      (opts.subheading ? '<p class="gbemp-sub">' + esc(opts.subheading) + '</p>' : '') +
      linesMarkup(opts) +
      cardMarkup(!!opts.testMode);
    container.innerHTML = '';
    container.appendChild(root);
    return { el: root };
  }

  global.GBEMockPay = {
    mount: mount,
    renderScreen: renderScreen,
    fmtMoney: fmtMoney,
    version: '1.0.0'
  };

})(typeof window !== 'undefined' ? window : this);
