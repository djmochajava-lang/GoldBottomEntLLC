/* ============================================
   show-card.js — GBE Shared Public Show-Card Renderer
   (story-show-wizard-w5-preview-publish, spec §4.5 shared-renderer doctrine)

   ONE source of truth for the public show-card DOM: the public tickets page
   (pages/entertainment/tickets.html) AND the Band Manager wizard's Preview
   step (dashboard/tickets.html) both call GBEShowCard.render() — the
   see-it-before-you-commit doctrine enforced by construction. The function
   accepts a readmodel-shaped row (public ticket_event_readmodel keys; the
   manager readmodel deliberately supersets them, so a manager-readmodel row
   renders as exactly the public card it will become).

   Card doctrine carried VERBATIM from the page renderer this was extracted
   from (D-52 story-showcase-wave1 + S2 owner A2 admission model):
   - Admission is ALWAYS stated: "Free — no ticket needed" chip
     (ticket_required=0) or "Tickets — $X[ – $Y]". A missing/null
     ticket_required flag ⇒ ticketed, so a paywall is never hidden by a
     stale cache row.
   - Readmodel prices are integer CENTS (price_cents) — the publisher ends
     the dollars/cents ambiguity at the boundary (D-52 §ii.2).
   - NULL venue_name ⇒ "Venue TBA — City, ST" (TBA convention).
   - No image_url ⇒ the standard artwork placeholder icon.
   - 'YYYY-MM-DD' is a CALENDAR date — parsed as local, never UTC midnight.
   - Card CSS is injected once (#gbe-show-card-styles, modal.js precedent)
     so both consumers render pixel-identically from the same rules.
   ============================================ */

(function() {
  'use strict';

  var KICKER = 'L.A. Young & Soul Society present';

  // Quote-escaping matters here: some fields land inside quoted HTML attributes
  // (img alt/src, data-event-id), where textContent→innerHTML alone is not enough.
  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Readmodel prices are integer CENTS (price_cents).
  function fmtCents(c) {
    if (!c || c === 0) return 'Free';
    return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      // 'YYYY-MM-DD' is a CALENDAR date — parse as local, not UTC midnight
      // (which renders the previous day in US timezones).
      var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      var dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
      return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    } catch(_) { return d; }
  }

  function venueLine(ev) {
    var locality = [ev.venue_city, ev.venue_state].filter(Boolean).join(', ');
    return ev.venue_name
      ? (ev.venue_name + (locality ? ' — ' + locality : ''))
      : ('Venue TBA' + (locality ? ' — ' + locality : ''));
  }

  function statusChip(status) {
    var map = {
      announced: 'Announced',
      on_sale: 'On Sale',
      selling_fast: 'Selling Fast',
      almost_sold_out: 'Almost Gone',
      sold_out: 'Sold Out'
    };
    return map[status] || 'Announced';
  }

  /**
   * Render ONE public show card from a readmodel-shaped row.
   * @param {object} ev   readmodel row: id, event_name, event_date, venue_name,
   *                      venue_city, venue_state, status, ticket_required,
   *                      image_url, tiers[{ price_cents }]
   * @param {object} [opts]
   * @param {string} [opts.extraClass]  extra class(es) appended to the card div
   *                      (the public listing passes 'reveal' for its scroll
   *                      animation; the wizard preview passes nothing).
   * @returns {string} the card's HTML (markup identical for both consumers).
   */
  function render(ev, opts) {
    opts = opts || {};
    var tiers = ev.tiers || [];
    if (typeof tiers === 'string') { try { tiers = JSON.parse(tiers); } catch (_) { tiers = []; } }
    if (!Array.isArray(tiers)) tiers = [];

    // Admission model (S2, owner A2): every card states it. Missing flag
    // (stale cache row) ⇒ ticketed, so a paywall is never hidden.
    var isFree = ev.ticket_required != null && Number(ev.ticket_required) === 0;
    var prices = tiers.map(function(t) { return t.price_cents; }).filter(function(p) { return p != null; });
    var minPrice = prices.length ? Math.min.apply(null, prices) : 0;
    var maxPrice = prices.length ? Math.max.apply(null, prices) : 0;
    var priceStr = minPrice === maxPrice
      ? (minPrice === 0 ? 'Free' : fmtCents(minPrice))
      : fmtCents(minPrice) + ' – ' + fmtCents(maxPrice);
    var admissionHtml = isFree
      ? '<span class="tix-free-chip">Free — no ticket needed</span>'
      : '<span class="tix-event-price">Tickets — ' + priceStr + '</span>';
    var imgHtml = ev.image_url
      ? '<img src="' + escHtml(ev.image_url) + '" alt="' + escHtml(ev.event_name) + '">'
      : '<i class="fa-solid fa-music"></i>';

    return '<div class="tix-event-card' + (opts.extraClass ? ' ' + opts.extraClass : '') + '" data-event-id="' + escHtml(ev.id) + '">' +
      '<div class="tix-event-card-img">' + imgHtml + '</div>' +
      '<div class="tix-event-card-body">' +
        (String(ev.event_name || '').indexOf('L.A. Young & Soul Society') === 0 ? '' :
          '<div class="tix-event-card-kicker">' + escHtml(KICKER) + '</div>') +
        '<h3>' + escHtml(ev.event_name) + '</h3>' +
        '<div class="tix-event-card-meta">' +
          '<span><i class="fa-solid fa-calendar"></i> ' + fmtDate(ev.event_date) + '</span>' +
          '<span><i class="fa-solid fa-location-dot"></i> ' + escHtml(venueLine(ev)) + '</span>' +
          (isFree ? '' : '<span><span class="tix-status-chip">' + escHtml(statusChip(ev.status)) + '</span></span>') +
        '</div>' +
        '<div class="tix-event-card-footer">' +
          admissionHtml +
          '<button class="btn btn-primary btn-sm shimmer-sweep">' + (isFree ? 'Details' : 'Details &amp; Tickets') + '</button>' +
        '</div>' +
      '</div></div>';
  }

  // ── Card styles: injected once so both consumers share the exact rules
  //    (moved verbatim from pages/entertainment/tickets.html; modal.js precedent) ──
  function ensureStyles() {
    if (document.getElementById('gbe-show-card-styles')) return;
    var style = document.createElement('style');
    style.id = 'gbe-show-card-styles';
    style.textContent =
      '.tix-event-card {' +
      '  background: var(--color-bg-secondary);' +
      '  border-radius: var(--radius-md);' +
      '  overflow: hidden;' +
      '  border: 1px solid var(--color-border);' +
      '  transition: transform 0.2s, box-shadow 0.2s;' +
      '  cursor: pointer;' +
      '}' +
      '.tix-event-card:hover {' +
      '  transform: translateY(-4px);' +
      '  box-shadow: 0 12px 32px rgba(0,0,0,0.3);' +
      '  border-color: rgba(212,160,23,0.3);' +
      '}' +
      '.tix-event-card-img {' +
      '  height: 180px;' +
      '  background: linear-gradient(135deg, rgba(212,160,23,0.2), rgba(212,160,23,0.05));' +
      '  display: flex; align-items: center; justify-content: center;' +
      '  position: relative; overflow: hidden;' +
      '}' +
      '.tix-event-card-img i { font-size: 3rem; color: rgba(212,160,23,0.4); }' +
      '.tix-event-card-img img { width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; }' +
      '.tix-event-card-body { padding: var(--space-md); }' +
      '.tix-event-card-kicker { font-size: var(--text-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 4px; }' +
      '.tix-event-card-body h3 { margin: 0 0 var(--space-xs); font-size: var(--text-lg); }' +
      '.tix-event-card-meta { display: flex; flex-direction: column; gap: 4px; margin-bottom: var(--space-sm); font-size: var(--text-sm); color: var(--color-text-muted); }' +
      '.tix-event-card-footer { display: flex; justify-content: space-between; align-items: center; padding-top: var(--space-sm); border-top: 1px solid var(--color-border); }' +
      '.tix-event-price { font-weight: 700; color: var(--color-gold); font-size: var(--text-lg); }' +
      '.tix-status-chip {' +
      '  display: inline-block; font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;' +
      '  letter-spacing: 0.04em; padding: 2px 10px; border-radius: 20px;' +
      '  background: rgba(212,160,23,0.12); color: var(--color-gold); border: 1px solid rgba(212,160,23,0.25);' +
      '}' +
      /* FREE show admission chip (ticket_required=0, S2 owner A2): the card's
         admission model when there is no price row and no checkout. */
      '.tix-free-chip {' +
      '  display: inline-block; font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;' +
      '  letter-spacing: 0.04em; padding: 2px 10px; border-radius: 20px;' +
      '  background: rgba(63,185,80,0.12); color: #3fb950; border: 1px solid rgba(63,185,80,0.3);' +
      '}' +
      '@media (max-width: 768px) {' +
      '  .tix-event-card-img { height: 140px; }' +
      '}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureStyles);
  } else {
    ensureStyles();
  }

  window.GBEShowCard = {
    KICKER: KICKER,
    escHtml: escHtml,
    fmtCents: fmtCents,
    fmtDate: fmtDate,
    venueLine: venueLine,
    statusChip: statusChip,
    render: render,
    ensureStyles: ensureStyles
  };
})();
