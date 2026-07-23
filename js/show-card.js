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
   - No image_url ⇒ the standard GBE brand card (images/show-card-default.jpg,
     owner directive 2026-07-17) until a unique image replaces it.
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

  // story-external-ticketing-override (slice 4): the readmodel's external_ticket_url
  // (https, validated server-side) — the honest "Tickets via {host}" cue + the
  // external CTA target. hostOf strips the scheme/path for the display cue.
  function hostOf(url) {
    try { return new URL(String(url)).hostname.replace(/^www\./, ''); }
    catch (_) {
      var m = String(url || '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0];
      return m.replace(/^www\./, '') || 'the venue';
    }
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

  // ── Restacked two-button footer for INTERNAL ticketed shows ──────────────
  // story-tour-notify (owner-decided 2026-07-22): every internal ticketed card
  // ALWAYS carries BOTH a state-driven Tickets button AND a Notify Me button
  // that NEVER disappears. Only the Tickets button's label/enabled-state
  // changes by ev.status. The footer restacks: price + status on one row, a
  // full-width ~50/50 two-button row beneath.
  //
  // This renderer stays PURE MARKUP — it emits data-gbe-notify attributes but
  // wires NO behavior. The public tickets page (pages/entertainment/tickets.html)
  // is the ONLY consumer that wires the modal capture; the BM wizard preview
  // (dashboard/tickets.html) renders the identical card but never wires an
  // opt-in, so the button is inert there by construction (see spec §3).
  //
  // Per-state matrix (owner-locked):
  //   announced          → Tickets DISABLED "On sale soon" + Notify "Notify Me"   (wants=onsale)
  //   on_sale/selling_   → Tickets ENABLED  "Get Tickets"   + Notify "Remind Me"  (wants=reminder)
  //     fast/almost_
  //   sold_out           → Tickets DISABLED "Sold Out"      + Notify "Join Waitlist" (wants=waitlist)
  function ticketedFooter(ev, admissionHtml) {
    var status = ev.status || 'announced';
    var ticketsBtn, notifyLabel, wants;
    if (status === 'sold_out') {
      ticketsBtn = '<button type="button" class="btn btn-sm tix-cta tix-cta-off" disabled aria-disabled="true">Sold Out</button>';
      notifyLabel = 'Join Waitlist'; wants = 'waitlist';
    } else if (status === 'on_sale' || status === 'selling_fast' || status === 'almost_sold_out') {
      ticketsBtn = '<button type="button" class="btn btn-primary btn-sm shimmer-sweep tix-cta">Get Tickets</button>';
      notifyLabel = 'Remind Me'; wants = 'reminder';
    } else { // announced — and ANY unknown status ⇒ safest "not yet on sale"
      ticketsBtn = '<button type="button" class="btn btn-sm tix-cta tix-cta-off" disabled aria-disabled="true">On sale soon</button>';
      notifyLabel = 'Notify Me'; wants = 'onsale';
    }
    var notifyBtn = '<button type="button" class="btn btn-outline btn-sm tix-cta tix-notify-btn"' +
      ' data-gbe-notify="1"' +
      ' data-notify-id="' + escHtml(ev.id) + '"' +
      ' data-notify-name="' + escHtml(ev.event_name) + '"' +
      ' data-notify-state="' + escHtml(status) + '"' +
      ' data-notify-wants="' + wants + '">' + escHtml(notifyLabel) + '</button>';
    return '<div class="tix-event-card-footer tix-footer-stacked">' +
        '<div class="tix-footer-info">' + admissionHtml +
          '<span class="tix-status-chip">' + escHtml(statusChip(status)) + '</span>' +
        '</div>' +
        '<div class="tix-footer-actions">' + ticketsBtn + notifyBtn + '</div>' +
      '</div>';
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

    // story-external-ticketing-override (slice 4): an external ticketing URL
    // OVERRIDES internal ticketing. The card's CTA sends buyers to the venue's
    // own link (new tab) and ALL internal admission UI (price/tier chips,
    // status chip, internal checkout) is suppressed — the SoR also rejects
    // internal checkout/scan for this event server-side. An honest
    // "Tickets via {host}" cue replaces the price row.
    var extUrl = (ev.external_ticket_url != null && String(ev.external_ticket_url).trim() !== '') ? String(ev.external_ticket_url).trim() : '';
    var isExternal = extUrl !== '';

    // Admission model (S2, owner A2): every card states it. Missing flag
    // (stale cache row) ⇒ ticketed, so a paywall is never hidden.
    var isFree = !isExternal && ev.ticket_required != null && Number(ev.ticket_required) === 0;
    var prices = tiers.map(function(t) { return t.price_cents; }).filter(function(p) { return p != null; });
    var minPrice = prices.length ? Math.min.apply(null, prices) : 0;
    var maxPrice = prices.length ? Math.max.apply(null, prices) : 0;
    var priceStr = minPrice === maxPrice
      ? (minPrice === 0 ? 'Free' : fmtCents(minPrice))
      : fmtCents(minPrice) + ' – ' + fmtCents(maxPrice);
    var admissionHtml = isExternal
      ? '<span class="tix-ext-cue"><i class="fa-solid fa-arrow-up-right-from-square"></i> Tickets via ' + escHtml(hostOf(extUrl)) + '</span>'
      : isFree
        ? '<span class="tix-free-chip">Free — no ticket needed</span>'
        : '<span class="tix-event-price">Tickets — ' + priceStr + '</span>';
    // No unique image yet ⇒ the standard GBE brand card (owner directive
    // 2026-07-17: the brand card is the standing default "until replaced by a
    // unique image"). Same markup shape as the real-image branch, so both
    // consumers (public page + wizard preview) stay byte-identical. The path
    // is root-relative — the SPA serves all pages from the origin root.
    var imgHtml = ev.image_url
      ? '<img src="' + escHtml(ev.image_url) + '" alt="' + escHtml(ev.event_name) + '">'
      : '<img src="images/show-card-default.jpg" alt="' + escHtml(ev.event_name) + '">';

    // External CTA is a real anchor (accessible, works without JS) → new tab,
    // rel="noopener". Internal cards keep the button (the page's delegated
    // handler opens the internal detail/checkout). data-external-url lets the
    // page handler route a whole-card tap to the external link too.
    var ctaHtml = isExternal
      ? '<a class="btn btn-primary btn-sm shimmer-sweep" href="' + escHtml(extUrl) + '" target="_blank" rel="noopener">Details &amp; Tickets</a>'
      : '<button class="btn btn-primary btn-sm shimmer-sweep">' + (isFree ? 'Details' : 'Details &amp; Tickets') + '</button>';

    return '<div class="tix-event-card' + (opts.extraClass ? ' ' + opts.extraClass : '') + '" data-event-id="' + escHtml(ev.id) + '"' +
        (isExternal ? ' data-external-url="' + escHtml(extUrl) + '"' : '') + '>' +
      '<div class="tix-event-card-img">' + imgHtml + '</div>' +
      '<div class="tix-event-card-body">' +
        (String(ev.event_name || '').indexOf('L.A. Young & Soul Society') === 0 ? '' :
          '<div class="tix-event-card-kicker">' + escHtml(KICKER) + '</div>') +
        '<h3>' + escHtml(ev.event_name) + '</h3>' +
        '<div class="tix-event-card-meta">' +
          '<span><i class="fa-solid fa-calendar"></i> ' + fmtDate(ev.event_date) + '</span>' +
          '<span><i class="fa-solid fa-location-dot"></i> ' + escHtml(venueLine(ev)) + '</span>' +
          // status chip relocated to the footer info row for internal ticketed
          // cards (story-tour-notify "price/status on its own row"); free /
          // external cards never showed it here.
        '</div>' +
        // Internal ticketed shows get the restacked two-button footer (Tickets +
        // Notify Me). Free / external shows keep their single-button footer
        // UNCHANGED (no Notify Me — a free announcement has nothing to notify,
        // and an external show's checkout is off-site).
        ((!isFree && !isExternal)
          ? ticketedFooter(ev, admissionHtml)
          : ('<div class="tix-event-card-footer">' + admissionHtml + ctaHtml + '</div>')) +
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
      /* story-tour-notify: restacked two-button footer for internal ticketed
         cards. Row 1 = price + status; Row 2 = Tickets | Notify Me (~50/50). */
      '.tix-footer-stacked {' +
      '  flex-direction: column; align-items: stretch; justify-content: flex-start;' +
      '  gap: var(--space-sm);' +
      '}' +
      '.tix-footer-info {' +
      '  display: flex; align-items: center; justify-content: space-between;' +
      '  gap: var(--space-xs); flex-wrap: wrap;' +
      '}' +
      '.tix-footer-actions { display: flex; gap: var(--space-sm); align-items: stretch; }' +
      /* 50/50 split; min-width:0 lets flex items shrink so two buttons never
         clip or overflow the ~297px card footer at a 390px viewport. */
      '.tix-footer-actions .tix-cta { flex: 1 1 0; min-width: 0; padding-left: 8px; padding-right: 8px; }' +
      '.tix-cta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
      /* Legible disabled Tickets CTA — NOT opacity-only (owner: a real text
         label must stay readable). Overrides .btn:disabled { opacity:.5 }. */
      '.btn.tix-cta-off, .btn.tix-cta-off:disabled, .btn.tix-cta-off[disabled] {' +
      '  opacity: 1; color: var(--color-text-secondary);' +
      '  background: var(--color-bg-tertiary); border-color: var(--color-border);' +
      '  cursor: default; box-shadow: none; transform: none; pointer-events: none;' +
      '}' +
      /* Per-event confirmed pill (localStorage keyed by event id) — swaps in for
         the Notify Me button on the ONE card the fan signed up for. */
      '.tix-notify-confirmed {' +
      '  flex: 1 1 0; min-width: 0; display: inline-flex; align-items: center;' +
      '  justify-content: center; gap: 6px; min-height: 30px; padding: 6px 8px;' +
      '  font-size: var(--text-xs); font-weight: 700; color: #3fb950;' +
      '  border: 1px solid rgba(63,185,80,0.3); border-radius: var(--radius-sm);' +
      '  background: rgba(63,185,80,0.10); white-space: nowrap; overflow: hidden;' +
      '  text-overflow: ellipsis;' +
      '}' +
      /* FREE show admission chip (ticket_required=0, S2 owner A2): the card's
         admission model when there is no price row and no checkout. */
      '.tix-free-chip {' +
      '  display: inline-block; font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;' +
      '  letter-spacing: 0.04em; padding: 2px 10px; border-radius: 20px;' +
      '  background: rgba(63,185,80,0.12); color: #3fb950; border: 1px solid rgba(63,185,80,0.3);' +
      '}' +
      /* EXTERNAL ticketing cue (slice 4): the card's admission model when
         ticketing is via the venue's own service — "Tickets via {host}". */
      '.tix-ext-cue {' +
      '  display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-sm); font-weight: 700;' +
      '  color: var(--color-gold); max-width: 60%;' +
      '}' +
      '.tix-ext-cue i { font-size: 0.85em; opacity: 0.85; }' +
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
