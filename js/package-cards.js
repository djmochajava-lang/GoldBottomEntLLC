/* =============================================================================
 * package-cards.js — SHARED customer-facing SHOW-PACKAGE CARD component
 * story-quote-form-show-package-card (EO vetting 2026-07-15)
 *
 * ONE component, single source of truth for the eight show-package cards.
 * Consumed by:
 *   • Quote form  — pages/entertainment/quote.html  (select → inline card)
 *   • Services page — pages/entertainment/services.html (story-services-page-
 *     interactive-best-fit reuses this SAME component — do NOT fork)
 *
 * CONTENT CONTRACT — CUSTOMER-FACING FIELDS ONLY:
 *   label · tagline · personnel · runtime · inclusions[]
 * There is NO price and NO internal/per-musician rate in this component. The
 * public quote flow never exposes a number ("custom quote within 24 hours"),
 * and the trade-secret pricing model stays 100% server-side. This file ships
 * to the PUBLIC repo, so it must contain zero confidential data.
 *
 * Copy is sourced verbatim from the already-public services.html "Show Menu".
 * Phyllis-only tribute policy (D-52): no confidential show elements here.
 *
 * API — window.GBEPackageCards:
 *   .PACKAGES                     -> ordered array of the 8 package objects
 *   .get(id)                      -> one package object (or null)
 *   .render(id, containerEl, opt) -> renders the card into containerEl;
 *                                    empty/unknown id => clears + hides.
 * Thin client: presentation only, no engine logic, no secrets.
 * ========================================================================== */
(function (global) {
  'use strict';

  // Minimal HTML-escape (component is self-contained; does not assume Utils).
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Single source of truth — customer-facing package data (NO rates) ──
  var PACKAGES = [
    {
      id: 'solo',
      label: 'Solo Performance w/ Tracks',
      tagline: 'L.A., a microphone, and a room that forgets to check its phone.',
      personnel: 'L.A. Young — solo',
      runtime: 'One 20–30 minute set',
      inclusions: [
        'Professional backing tracks',
        'Ideal for cocktail hours &amp; intimate moments',
        'Indoor or outdoor'
      ]
    },
    {
      id: 'duo',
      label: 'Acoustic Duo — Intimate Setting',
      tagline: 'Stripped-down soul for cocktail hours, ceremonies, and rooms that lean in close.',
      personnel: '2-piece — vocals &amp; live accompaniment',
      runtime: 'Flexible sets',
      inclusions: [
        'Live acoustic instrumentation',
        'Perfect for ceremonies &amp; cocktail hours',
        'Indoor or outdoor'
      ]
    },
    {
      id: 'la-with-dj',
      label: 'L.A. with DJ — Live Vocals over Curated Mixes',
      tagline: 'The energy of a club night with a live voice on top — seamless, danceable, unstoppable.',
      personnel: 'L.A. Young + DJ',
      runtime: 'Flexible sets',
      inclusions: [
        'Live vocals over curated DJ mixes',
        'Built for dance floors &amp; late nights',
        'Indoor or outdoor'
      ]
    },
    {
      id: 'small-band',
      label: 'Small Band — 5-Piece Live',
      tagline: 'Full live-band soul, sized for lounges, galas, and mid-size rooms.',
      personnel: '5-piece live band',
      runtime: 'Two 45-minute sets',
      inclusions: [
        'Full live rhythm section',
        'Lounges, galas &amp; mid-size rooms',
        'Indoor or outdoor'
      ]
    },
    {
      id: 'full-band',
      label: 'Full Band — 7-Piece Live Show',
      tagline: 'Seven pieces of wall-to-wall soul — the package that turns an event into a concert.',
      personnel: '7-piece live band',
      runtime: 'Two 45-minute sets',
      inclusions: [
        'Full horn-and-rhythm powerhouse',
        'Turns an event into a concert',
        'Indoor or outdoor'
      ]
    },
    {
      id: 'full-show',
      label: 'Full Show / Tribute Experience — Full Band + Vocalists',
      tagline: 'The complete production — full band, background vocalists, and a themed show.',
      personnel: 'Full band + background vocalists',
      runtime: 'Two 45-minute sets',
      inclusions: [
        'Themed production, including The Phyllis Hyman Experience and The Sade Tribute Show',
        'Full band with background vocalists',
        'Our signature headline experience'
      ]
    },
    {
      id: 'hosting-mc',
      label: 'Hosting &amp; MC — Event Emcee',
      tagline: 'A commanding, warm stage presence to run your program and keep the night on time.',
      personnel: 'Solo host / emcee',
      runtime: 'Runs your full program',
      inclusions: [
        'Professional event emcee',
        'Keeps your program on time',
        'Pairs with any performance package'
      ]
    },
    {
      id: 'studio-session',
      label: 'Studio Recording Session',
      tagline: 'That rare contralto on your track — lead vocals, features, and session work.',
      personnel: 'Lead vocals / features',
      runtime: 'Per project',
      inclusions: [
        'Lead vocals, features &amp; session work',
        'Select projects considered',
        'Studio or remote delivery'
      ]
    }
  ];

  var BY_ID = {};
  PACKAGES.forEach(function (p) { BY_ID[p.id] = p; });

  // Common footer note — matches the already-public services.html copy.
  var OPTIONS_NOTE = 'Indoor or outdoor · your PA or ours with a professional engineer · multi-show &amp; residency discounts';
  var PRICE_NOTE = 'Custom quote within 24 hours — every event is priced to your room, format, and budget.';

  // ── Scoped styles injected once (self-contained; uses existing CSS vars) ──
  function ensureStyles() {
    if (document.getElementById('gbe-pkg-card-styles')) return;
    var css = [
      '.gbe-pkg-card{padding:var(--space-lg);margin-top:var(--space-md);',
      'border:1px solid rgba(212,160,23,0.28);border-radius:var(--radius-md);',
      'background:rgba(212,160,23,0.06);animation:gbePkgFade .25s ease-out;}',
      '@keyframes gbePkgFade{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}',
      '@media (prefers-reduced-motion: reduce){.gbe-pkg-card{animation:none;}}',
      '.gbe-pkg-card__eyebrow{font-size:var(--text-xs);letter-spacing:.12em;text-transform:uppercase;',
      'color:var(--color-gold);margin:0 0 var(--space-xs);}',
      '.gbe-pkg-card__title{font-family:"Montserrat",sans-serif;font-size:var(--text-lg);',
      'margin:0 0 var(--space-xs);color:var(--color-text);}',
      '.gbe-pkg-card__tagline{color:var(--color-text-secondary);line-height:1.6;margin:0 0 var(--space-md);}',
      '.gbe-pkg-card__meta{display:flex;flex-wrap:wrap;gap:var(--space-sm);margin:0 0 var(--space-md);}',
      '.gbe-pkg-card__chip{display:inline-flex;align-items:center;gap:6px;min-height:32px;',
      'padding:6px 12px;border-radius:var(--radius-full);background:rgba(255,255,255,0.05);',
      'border:1px solid var(--color-border);font-size:var(--text-sm);color:var(--color-text-secondary);}',
      '.gbe-pkg-card__chip i{color:var(--color-gold);}',
      '.gbe-pkg-card__incl{list-style:none;margin:0 0 var(--space-md);padding:0;}',
      '.gbe-pkg-card__incl li{position:relative;padding:6px 0 6px 26px;color:var(--color-text-secondary);',
      'font-size:var(--text-sm);line-height:1.5;min-height:32px;}',
      '.gbe-pkg-card__incl li i{position:absolute;left:0;top:9px;color:var(--color-gold);}',
      '.gbe-pkg-card__note{margin:0;font-size:var(--text-xs);color:var(--color-text-muted);line-height:1.6;}',
      '.gbe-pkg-card__note--price{color:var(--color-text-secondary);margin-bottom:var(--space-xs);}',
      '.gbe-pkg-card__empty{padding:var(--space-md) var(--space-lg);margin-top:var(--space-md);',
      'border:1px dashed var(--color-border);border-radius:var(--radius-md);',
      'color:var(--color-text-muted);font-size:var(--text-sm);}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'gbe-pkg-card-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function cardHtml(p) {
    var incl = (p.inclusions || []).map(function (item) {
      // item copy may contain intentional &amp; entities — render as-is.
      return '<li><i class="fa-solid fa-check" aria-hidden="true"></i>' + item + '</li>';
    }).join('');
    return '' +
      '<div class="glass-card gbe-pkg-card" role="group" aria-label="' + esc(stripEntities(p.label)) + ' package details">' +
        '<p class="gbe-pkg-card__eyebrow"><i class="fa-solid fa-music" aria-hidden="true"></i> Your selected package</p>' +
        '<h4 class="gbe-pkg-card__title">' + p.label + '</h4>' +
        '<p class="gbe-pkg-card__tagline">' + p.tagline + '</p>' +
        '<div class="gbe-pkg-card__meta">' +
          '<span class="gbe-pkg-card__chip"><i class="fa-solid fa-users" aria-hidden="true"></i> ' + p.personnel + '</span>' +
          '<span class="gbe-pkg-card__chip"><i class="fa-solid fa-clock" aria-hidden="true"></i> ' + p.runtime + '</span>' +
        '</div>' +
        '<ul class="gbe-pkg-card__incl">' + incl + '</ul>' +
        '<p class="gbe-pkg-card__note gbe-pkg-card__note--price"><i class="fa-solid fa-tag" aria-hidden="true"></i> ' + PRICE_NOTE + '</p>' +
        '<p class="gbe-pkg-card__note">' + OPTIONS_NOTE + '</p>' +
      '</div>';
  }

  // label carries &amp; entities for display; strip for aria-label plain text.
  function stripEntities(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');
  }

  function emptyHtml(msg) {
    return '<div class="gbe-pkg-card__empty">' + esc(msg || 'Package details coming soon — request a quote and we’ll walk you through it.') + '</div>';
  }

  var GBEPackageCards = {
    PACKAGES: PACKAGES,

    get: function (id) {
      return (id && BY_ID[id]) ? BY_ID[id] : null;
    },

    /**
     * Render the selected package card inline.
     * @param {string} id         package id (dropdown value)
     * @param {HTMLElement} el     container to render into
     * @param {object} [opts]      { emptyText: string }  copy for "no data yet"
     */
    render: function (id, el, opts) {
      if (!el) return;
      ensureStyles();
      opts = opts || {};
      if (!id) {
        // Cleared selection — hide entirely, no layout artifact.
        el.innerHTML = '';
        el.hidden = true;
        return;
      }
      var p = BY_ID[id];
      el.hidden = false;
      if (!p) {
        // Known selection with no card data yet — graceful placeholder.
        el.innerHTML = emptyHtml(opts.emptyText);
        return;
      }
      el.innerHTML = cardHtml(p);
    }
  };

  global.GBEPackageCards = GBEPackageCards;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GBEPackageCards;
  }
})(typeof window !== 'undefined' ? window : this);
