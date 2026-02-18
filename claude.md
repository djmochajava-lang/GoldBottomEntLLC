# Gold Bottom Ent. LLC — Corporate Management Portal

## Project Overview

Single-page application (SPA) serving as both a **public-facing corporate website** and an **internal management dashboard** for Gold Bottom Ent. LLC. The company operates across two verticals:

- **Gold Bottom Entertainment** — Talent management, booking, creative services (music/arts)
- **Gold Bottom Enterprise** — Web development, app development, tech consulting

The owner (DJ Moka) is a first-time business operator, so the portal includes guided setup wizards, placeholders for credentials, and a comprehensive business setup checklist.

## Company Name Convention

**IMPORTANT**: The LLC has multiple name variants used in different contexts:

| Variant | Type | Usage | Config Key |
|---------|------|-------|------------|
| **Gold Bottom Ent LLC** | Official LLC filing name (no period) | Legal contexts: contracts, copyright notices, privacy policy, terms of service, IP ownership, EIN/formation docs, DataStore seed data for parties/owners | `SiteConfig.company.legalName` |
| **Gold Bottom Ent. LLC** | Marketing/branding name (with period) | Public-facing copy: page titles, hero sections, meta descriptions, headers, about page narrative, contact cards, logo text, CSS file headers | `SiteConfig.company.name` |
| **Gold Bottom Entertainment** | DBA trade name (entertainment vertical) | Talent management, booking, music, creative services. Used in about page, services page, legal trademark notice, d/b/a disclosures | `SiteConfig.company.dba[0]` |
| **Gold Bottom Enterprise** | DBA trade name (tech vertical) | Web development, app development, tech consulting. Used in about page, services page, legal trademark notice, d/b/a disclosures | `SiteConfig.company.dba[1]` |

All variants are available in `js/config.js` under `SiteConfig.company`.

**Rules for new content:**
- Use the **legal name** (no period) in contracts, copyright notices, legal pages, and anywhere the entity's official identity matters
- Use the **marketing name** (with period) in public-facing branding, headers, and narrative copy
- Use the **DBA names** when referring to a specific vertical (entertainment or tech) — these never include "LLC"
- In legal disclosures, use the full form: *"Gold Bottom Ent LLC, d/b/a Gold Bottom Entertainment and Gold Bottom Enterprise"*

## Architecture

### Stack
- **Pure vanilla JS SPA** — no frameworks, no bundler, no build step
- **Hash-based routing** (`#home`, `#dashboard-roster`, etc.)
- **Dual-layout system** — public layout (navbar + content + footer) and dashboard layout (sidebar + topbar + content)
- **localStorage** via `DataStore` module for all persistence (prototype — designed for easy backend swap)
- **CSS Variables** for consistent theming across 8 stylesheets
- **Google Fonts** (Montserrat headings + Inter body) + **Font Awesome 6** icons via CDN

### Routing
- Router detects `dashboard-` prefix in hash routes and switches to dashboard layout
- `PageLoader` dynamically fetches page fragments from `pages/` (public) or `dashboard/` (dashboard) directories
- 7 public routes + 13 dashboard routes = 20 total

### Module Pattern
All JS modules use singleton pattern:
```js
const ModuleName = {
  init() { /* setup */ },
  // methods...
};
```
With auto-init guard and CommonJS export fallback at bottom of each file.

## File Structure

```
GoldBottomEntLLC/
├── index.html                    # Main SPA shell (both layouts)
├── claude.md                     # This file
├── .gitignore
├── css/
│   ├── base.css                  # CSS variables, reset, typography
│   ├── layout.css                # Public header/footer + dashboard sidebar/topbar
│   ├── components.css            # Buttons, cards, forms, tables, badges, modals, toasts
│   ├── sections.css              # Hero, content wrappers
│   ├── pages.css                 # Public page-specific styles
│   ├── dashboard.css             # Dashboard widgets, metrics, pipeline, data tables
│   ├── animations.css            # Keyframes, transitions, prefers-reduced-motion
│   └── responsive.css            # Media queries (1024px, 768px, 480px breakpoints)
├── js/
│   ├── config.js                 # SiteConfig: company info, social, integration keys, feature flags
│   ├── utils.js                  # Utils: generateId, formatCurrency, formatDate, escapeHtml, debounce, storage helpers
│   ├── mobile-detect.js          # Device detection, body data attributes
│   ├── toast.js                  # Toast notification system (success/error/info/warning)
│   ├── modal.js                  # Modal: open/close/confirm/alert, sizes sm/md/lg
│   ├── page-loader.js            # PageLoader: dual-container fetch with fade transitions
│   ├── router.js                 # Router: 20 routes, layout switching, hash navigation
│   ├── navigation.js             # Public nav: mobile menu hamburger toggle
│   ├── sidebar.js                # Dashboard sidebar: collapse/expand, localStorage persist
│   ├── data-store.js             # DataStore: localStorage CRUD for 16+ entity types, seed data
│   ├── forms.js                  # Form validation and handling utilities
│   ├── table-manager.js          # TableManager: sortable, filterable, responsive tables
│   ├── dashboard-widgets.js      # DashboardWidgets: metric cards, activity feed, quick actions
│   ├── calendar.js               # Calendar: month-view grid, event dots, navigation
│   └── main.js                   # App controller: initializes all modules in dependency order
├── pages/                        # Public page fragments (loaded by PageLoader)
│   ├── home.html                 # Hero, service verticals, featured talent, CTAs
│   ├── roster.html               # Public talent showcase grid with filter
│   ├── services.html             # Entertainment + Enterprise verticals
│   ├── shop.html                 # Merch storefront (Shopify embed placeholder)
│   ├── about.html                # Company story, owner profile, mission
│   ├── contact.html              # Inquiry form (booking/talent/tech/partnership/general)
│   └── legal.html                # Privacy Policy, ToS, Copyright (tabbed, with attorney review TODOs)
├── dashboard/                    # Dashboard page fragments (loaded by PageLoader)
│   ├── home.html                 # 6 metric cards, activity feed, quick actions
│   ├── roster.html               # Talent table with CRUD, category filter, rider requirements
│   ├── contracts.html            # Contract tracker, status pipeline, e-signature integration
│   ├── finances.html             # 5-tab: Revenue, Expenses, Invoices, Commissions, Taxes
│   ├── booking.html              # Booking pipeline (8 stages), venue DB, cancellation policy, ratings
│   ├── calendar.html             # Month-view calendar, event types color-coded, add/edit events
│   ├── merch.html                # Product catalog, Shopify/Printful/Square integration slots
│   ├── travel.html               # Tour itinerary builder, per diem calculator, logistics
│   ├── ip-rights.html            # IP registry (songs, recordings, copyrights, software)
│   ├── distribution.html         # DIY music distribution, direct platform uploads, ISRC/UPC self-registration
│   ├── documents.html            # Document vault (operating agreement, EIN, insurance, etc.)
│   ├── integrations.html         # Central hub for all 3rd-party service connections
│   └── settings.html             # Company info, owner profile, business setup checklist
└── images/
    ├── logo/gbe-logo.svg         # Placeholder SVG logo
    ├── talent/                   # Talent headshot placeholders
    └── hero/                     # Hero background images
```

## CSS Variable Naming Conventions

All CSS variables use these prefixes (defined in `css/base.css`):
- `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`, `--space-2xl`, `--space-3xl` — spacing
- `--color-bg`, `--color-bg-secondary`, `--color-bg-tertiary` — backgrounds
- `--color-text`, `--color-text-secondary`, `--color-text-muted` — text colors
- `--color-gold`, `--color-danger`, `--color-success` — semantic colors
- `--color-border` — border color
- `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full` — border radius
- `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, etc. — font sizes
- `--fw-normal`, `--fw-medium`, `--fw-semibold`, `--fw-bold`, `--fw-extrabold` — font weights

**IMPORTANT**: Always use `--space-` prefix, never `--spacing-`. This was a consistency issue that was fixed across the codebase.

## Design System

- **Theme**: Corporate dark — `#0d1117` background (GitHub-dark inspired)
- **Accent**: Gold `#ffd700` with gradient variants (`#ffed4a`, `#e6c200`)
- **Glass morphism**: `backdrop-filter: blur()` on dashboard cards
- **Typography**: Montserrat for headings, Inter for body text
- **Icons**: Font Awesome 6 (CDN)
- **Mobile-first**: Responsive at 1024px, 768px, 480px breakpoints

## DataStore Entity Keys

```js
DataStore.KEYS = {
  ROSTER, CONTRACTS, FINANCES_REVENUE, FINANCES_EXPENSES,
  INVOICES, EVENTS, BOOKINGS, IP_RIGHTS, DOCUMENTS,
  MERCH_PRODUCTS, MERCH_ORDERS, TRAVEL, DISTRIBUTION,
  INTEGRATIONS, SETTINGS, CHECKLIST, ACTIVITY
}
```

Each entity supports full CRUD via generic helpers: `_getAll`, `_add`, `_update`, `_delete`, `_getById`.

Activity logging is automatic on create/update/delete operations.

Seed data is loaded on first visit (when `gbe-roster` key is empty in localStorage).

## Booking Pipeline Stages

The booking system uses an 8-stage pipeline inspired by the Talent Booking Agent Automation Requirements Guide:

| Stage | Label | Description |
|-------|-------|-------------|
| `lead` | New Lead | Initial inquiry received |
| `qualified` | Qualified | All intake fields collected, budget/date validated |
| `proposed` | Proposed | Formal proposal sent to client |
| `negotiating` | Negotiating | Counter-offers or changes in progress |
| `confirmed` | Confirmed | Client agreed, awaiting contract/deposit |
| `contracted` | Contracted | Contract signed, deposit paid |
| `completed` | Completed | Event executed successfully |
| `closed` | Closed | Closed-Won, Closed-Lost, Cancelled, or No Response |

### Booking Intake Fields
Each booking tracks: event type (vibe), guest count, budget range, hours needed, indoor/outdoor, sound system availability, referral source, rider requirements — in addition to standard fields (name, venue, date, artist, value, deposit, contact info).

### Cancellation Policy Tiers
- 30+ days: Full refund minus admin fee
- 14–29 days: 50% deposit refund
- Under 14 days: No refund (deposit forfeited)

## Roster Talent Fields

Each talent entry includes:
- Standard: name, category (artist/creative/developer), genre/skill, status, email, phone, bio
- Business: contractStart, contractEnd, commission %, website
- Performance: rateType (flat/hourly), standardRate, minimumRate, depositPercent
- Logistics: riderNeeds, travelRadius, noGoZones, availability status

## DIY Distribution Model

Gold Bottom Ent operates a **self-distribution model** — no third-party aggregator distributors (DistroKid, TuneCore, CD Baby). Music is uploaded **directly to each platform** (Spotify, Apple Music, YouTube, Amazon, SoundCloud, Bandcamp, Tidal, Deezer, Audiomack).

This means:
- **ISRC codes** must be obtained directly from [usisrc.org](https://www.usisrc.org) (~$95 one-time registrant fee, then assign unlimited codes)
- **UPC barcodes** must be purchased directly from [GS1 US](https://www.gs1us.org) (~$30 per single UPC, bulk packs available)
- Royalty tracking is done per-platform (no single distributor dashboard)
- 100% revenue retention — no distributor fees or revenue share
- Full control over pricing, release timing, metadata, and takedowns

The Distribution dashboard page includes:
- DIY release checklist (step-by-step self-distribution workflow)
- Audio & artwork spec requirements for platform uploads
- Direct upload portal links for 9 platforms
- Streaming analytics dashboard links
- ISRC & UPC self-registration guides with direct links
- DIY vs distributor comparison explaining why we chose this model

## Key Placeholders

Throughout the codebase, these markers indicate where real data is needed:
- `[YOUR EIN HERE]`, `[YOUR REGISTERED AGENT]`
- `[STRIPE API KEY]`, `[PAYPAL CLIENT ID]`, `[SHOPIFY STORE URL]`
- `[EVENTBRITE API KEY]`, `[BANDSINTOWN ARTIST ID]`, `[GOOGLE CALENDAR ID]`
- `[DOCUSIGN API KEY]`, `[PRO MEMBER ID]`, `[SPOTIFY ARTIST URI]`
- `<!-- TODO: Have your attorney review -->` — legal page markers

## Custom Events

Dashboard pages communicate via custom DOM events:
```js
document.dispatchEvent(new CustomEvent('gbe:data-updated'));
```
Used by `DashboardWidgets` to refresh metric cards when data changes.

## Testing Checklist

1. Open `index.html` — public home page loads
2. All 7 public nav links render their pages
3. Click "Dashboard" — layout switches to sidebar + content
4. Navigate all 13 dashboard pages via sidebar
5. CRUD operations: Roster, Contracts, Finances, Bookings, IP Rights, etc.
6. Booking pipeline: add booking, move through 8 stages
7. Calendar: add events, navigate months
8. Settings: business checklist persists in localStorage
9. Mobile (375px): sidebar overlay, tables become cards, all pages scroll
10. "View Site" returns to public layout
11. Clear localStorage → seed data repopulates

## Related Projects

- **L.A. Young Band Page**: `../LAYoungBandPage/` — The primary talent's public website (same vanilla SPA architecture)
- Linked from roster entry `talent-001`
