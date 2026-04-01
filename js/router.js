// js/router.js

/**
 * Router Module — Dual-Layout SPA with Vertical Sub-Sites
 * Hash-based routing with automatic layout switching and theme management.
 *
 * Route prefixes:
 *   - 'ent-'       → Entertainment sub-site (gold theme)
 *   - 'biz-'       → Enterprise sub-site (blue theme)
 *   - 'dashboard-' → Dashboard layout (no theme override)
 *   - (none)       → Root/shared pages (neutral theme)
 */

const Router = {
  routes: {
    // Root / Shared pages
    'home': 'pages/home.html',
    'contact': 'pages/contact.html',
    'legal': 'pages/legal.html',
    'onboard': 'pages/onboard.html',
    '404': 'pages/404.html',

    // Entertainment pages (ent-* prefix)
    'ent-home': 'pages/entertainment/home.html',
    'ent-roster': 'pages/entertainment/roster.html',
    'ent-services': 'pages/entertainment/services.html',
    'ent-shop': 'pages/entertainment/shop.html',
    'ent-events': 'pages/entertainment/events.html',
    'ent-about': 'pages/entertainment/about.html',
    'ent-contact': 'pages/entertainment/contact.html',
    'ent-promoter': 'pages/entertainment/promoter.html',
    'ent-inquiry': 'pages/entertainment/inquiry.html',
    'ent-quote': 'pages/entertainment/quote.html',
    'ent-series': 'pages/entertainment/series.html',

    // Enterprise pages (biz-* prefix)
    'biz-home': 'pages/enterprise/home.html',
    'biz-services': 'pages/enterprise/services.html',
    'biz-portfolio': 'pages/enterprise/portfolio.html',
    'biz-about': 'pages/enterprise/about.html',
    'biz-contact': 'pages/enterprise/contact.html',

    // Dashboard pages (unchanged)
    'dashboard-home': 'dashboard/home.html',
    'dashboard-roster': 'dashboard/roster.html',
    'dashboard-contracts': 'dashboard/contracts.html',
    'dashboard-finances': 'dashboard/finances.html',
    'dashboard-booking': 'dashboard/booking.html',
    'dashboard-gigs': 'dashboard/gigs.html',
    'dashboard-band-readiness': 'dashboard/band-readiness.html',
    'dashboard-inbox': 'dashboard/inbox.html',
    'dashboard-leads': 'dashboard/leads.html',
    'dashboard-merch': 'dashboard/merch.html',
    'dashboard-travel': 'dashboard/travel.html',
    'dashboard-calendar': 'dashboard/calendar.html',
    'dashboard-ip': 'dashboard/ip-rights.html',
    'dashboard-distribution': 'dashboard/distribution.html',
    'dashboard-documents': 'dashboard/documents.html',
    'dashboard-integrations': 'dashboard/integrations.html',
    'dashboard-settings': 'dashboard/settings.html',
    'dashboard-team': 'dashboard/team.html',
    'dashboard-quotes': 'dashboard/quotes.html',

    // IT Dept pages
    'dashboard-architecture': 'dashboard/architecture.html',
    'dashboard-credentials': 'dashboard/credentials.html',
    'dashboard-servers': 'dashboard/servers.html',

    // Analytics & Export (OPS-METRICS-001)
    'dashboard-metrics': 'dashboard/metrics.html',
    'dashboard-export': 'dashboard/export.html',

    // Booking Inbox + CRM
    'dashboard-contacts': 'dashboard/contacts.html',

    // CRM Contacts (local-only admin page)
    'dashboard-crm-contacts': 'dashboard/crm-contacts.html',

    // Band Manager Field View (mobile-optimized)
    'dashboard-field': 'dashboard/field.html',

    // Band Music Player (rehearsal tracks, charts, lyrics)
    'dashboard-band-player': 'dashboard/band-player.html',

    // Payment Settings (musician self-service)
    'dashboard-payment-settings': 'dashboard/payment-settings.html',

    // Musician Portal (band member landing page)
    'dashboard-musician-home': 'dashboard/musician-home.html',

    // Agreement Management (band manager)
    'dashboard-agreements': 'dashboard/agreements.html',

    // Ticket Sales (FRD-8)
    'dashboard-tickets': 'dashboard/tickets.html',

    // Claude Agent Dashboard (FRD-16)
    'dashboard-claude-agent': 'dashboard/claude-agent.html',

    // Agreement Signing (public, token-based)
    'sign': 'pages/sign.html',

    // Public Ticket Sales (FRD-8)
    'ent-tickets': 'pages/entertainment/tickets.html',
  },

  /**
   * Legacy route redirects (pre-split URLs → new prefixed routes)
   */
  legacyRedirects: {
    'roster': 'ent-roster',
    'shop': 'ent-shop',
    'services': 'home',
    'about': 'home',
  },

  /**
   * Routes only available on the local (LAN) dashboard.
   * On remote (GitHub Pages), these routes are blocked and redirect to dashboard-home.
   */
  /**
   * Routes blocked on the local (private) dashboard — public-site only features.
   * On local (port 3000/4000), these redirect to dashboard-home.
   */
  localBlockedRoutes: [
    'dashboard-band-player', // Music Player lives on the public site only
    'dashboard-musician-home', // Musician Portal lives on the public site only
  ],

  localOnlyRoutes: [
    'dashboard-finances',
    'dashboard-documents',
    'dashboard-integrations',
    'dashboard-settings',
    'dashboard-team',
    'dashboard-credentials',
    'dashboard-architecture',
    'dashboard-servers',
    'dashboard-metrics',
    'dashboard-export',
    // dashboard-quotes removed from local-only — now uses Firestore quote_pipeline for remote read access
    // dashboard-inbox removed from local-only — now uses Firestore inbox_pipeline for remote read access
    'dashboard-contacts',
    'dashboard-crm-contacts',
    'dashboard-claude-agent',
    // dashboard-tickets removed from local-only — now uses Firestore for event/tier CRUD (DEF-013)
    // dashboard-field is intentionally NOT local-only — it has offline fallbacks
    // and should be accessible on remote mobile for band managers on the road
  ],

  currentPage: null,
  currentLayout: null,
  currentVertical: null,
  currentQueryParams: null,
  defaultPage: 'home',

  initialized: false,

  /**
   * Initialize router
   */
  init() {
    if (this.initialized) return;
    this.setupNavigation();
    this.handleInitialRoute();
    this.handleBrowserNavigation();
    this.initialized = true;
    console.log('✅ Router initialized (dual-layout + vertical sub-sites)');
  },

  /**
   * Check if a route is a dashboard route
   */
  isDashboardRoute(pageName) {
    return pageName.startsWith('dashboard-');
  },

  /**
   * Detect vertical context from route name
   * @returns {'ent' | 'biz' | 'neutral'}
   */
  getVerticalForPage(pageName) {
    if (pageName.startsWith('ent-')) return 'ent';
    if (pageName.startsWith('biz-')) return 'biz';
    return 'neutral';
  },

  /**
   * Get the layout mode for a given page
   */
  getLayoutForPage(pageName) {
    return this.isDashboardRoute(pageName) ? 'dashboard' : 'public';
  },

  /**
   * Parse a hash string into route name and query params.
   * e.g. 'sign?id=abc123' → { route: 'sign', query: 'id=abc123' }
   * e.g. 'dashboard-home' → { route: 'dashboard-home', query: '' }
   */
  _parseHash(hash) {
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) {
      return { route: hash, query: '' };
    }
    return { route: hash.substring(0, qIndex), query: hash.substring(qIndex + 1) };
  },

  /**
   * Get current query parameters as a URLSearchParams object.
   * Pages can call Router.getQueryParams().get('id') to read params.
   */
  getQueryParams() {
    return new URLSearchParams(this.currentQueryParams || '');
  },

  /**
   * Setup click delegation for navigation links
   */
  setupNavigation() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || href === '#') return;

      e.preventDefault();
      const raw = href.substring(1);
      const { route, query } = this._parseHash(raw);
      this.currentQueryParams = query;
      this.navigateTo(route);
    });
  },

  /**
   * Navigate to a page
   */
  async navigateTo(pageName, forceLoad = false) {
    // Legacy route redirects (pre-split URLs)
    if (this.legacyRedirects[pageName]) {
      pageName = this.legacyRedirects[pageName];
    }

    // Role-based dashboard home redirect
    if (pageName === 'dashboard-home' && typeof Auth !== 'undefined' && Auth.getRole) {
      var _homeRole = Auth.getRole();
      if (_homeRole === 'band_member' || _homeRole === 'artist') {
        // Musicians/artists → Musician Portal
        pageName = 'dashboard-musician-home';
      } else if (window.innerWidth <= 768 && (_homeRole === 'admin' || _homeRole === 'band_manager')) {
        // Mobile admin/manager → Field View
        pageName = 'dashboard-field';
      }
    }

    // Validate route — show 404 for unknown routes
    if (!this.routes[pageName]) {
      console.warn(`Route "${pageName}" not found, loading 404`);
      pageName = '404';
    }

    // Auth guard — block unauthenticated dashboard access
    if (typeof Auth !== 'undefined') {
      if (!Auth.guardRoute(pageName)) {
        return; // Blocked — login modal shown, or auth still initializing
      }

      // Role guard — block pages not accessible to current role
      if (Auth.isAuthenticated && Auth.isAuthenticated()) {
        var _rolePageAccess = {
          'dashboard-roster':       ['admin', 'band_manager'],
          'dashboard-booking':      ['admin', 'band_manager'],
          'dashboard-gigs':         ['admin', 'band_manager'],
          'dashboard-band-readiness': ['admin', 'band_manager'],
          'dashboard-quotes':       ['admin', 'band_manager'],
          'dashboard-inbox':        ['admin', 'band_manager'],
          'dashboard-contacts':     ['admin', 'band_manager'],
          'dashboard-crm-contacts': ['admin', 'band_manager'],
          'dashboard-leads':        ['admin', 'band_manager'],
          'dashboard-finances':     ['admin', 'band_manager'],
          'dashboard-documents':    ['admin', 'band_manager'],
          'dashboard-integrations': ['admin'],
          'dashboard-metrics':      ['admin', 'band_manager'],
          'dashboard-export':       ['admin'],
          'dashboard-settings':     ['admin', 'band_manager'],
          'dashboard-team':         ['admin', 'band_manager'],
          'dashboard-field':        ['admin', 'band_manager'],
          'dashboard-architecture': ['admin'],
          'dashboard-credentials':  ['admin'],
          'dashboard-servers':      ['admin'],
          'dashboard-merch':        ['admin', 'band_manager', 'artist'],
          'dashboard-ip':           ['admin', 'band_manager', 'artist'],
          'dashboard-distribution': ['admin', 'band_manager', 'artist'],
          'dashboard-musician-home': ['admin', 'band_manager', 'artist', 'band_member'],
          'dashboard-calendar':     ['admin', 'band_manager', 'artist', 'band_member'],
          'dashboard-band-player': ['admin', 'band_manager', 'artist', 'band_member'],
          'dashboard-payment-settings': ['admin', 'band_manager', 'artist', 'band_member'],
          'dashboard-travel':       ['admin', 'band_manager', 'artist', 'band_member'],
          'dashboard-contracts':    ['admin', 'band_manager', 'artist', 'band_member', 'venue_owner', 'promoter'],
          'dashboard-claude-agent': ['admin'],
        };
        var _allowedRoles = _rolePageAccess[pageName];
        var _currentRole = Auth.getRole ? Auth.getRole() : 'member';

        // For dashboard pages: deny by default if not explicitly listed in ACL
        if (pageName.indexOf('dashboard-') === 0) {
          if (_allowedRoles) {
            if (_allowedRoles.indexOf(_currentRole) === -1) {
              if (typeof Toast !== 'undefined') {
                Toast.error('Your role does not have access to this section.');
              }
              // Redirect to role-appropriate home
              if (_currentRole === 'band_member' || _currentRole === 'artist') {
                this.navigateTo('dashboard-musician-home');
              } else {
                this.navigateTo('dashboard-home');
              }
              return;
            }
          } else {
            // Not in ACL at all — only admin and band_manager can access unlisted dashboard pages
            if (_currentRole !== 'admin' && _currentRole !== 'band_manager') {
              if (typeof Toast !== 'undefined') {
                Toast.error('Your role does not have access to this section.');
              }
              if (_currentRole === 'band_member' || _currentRole === 'artist') {
                this.navigateTo('dashboard-musician-home');
              } else {
                this.navigateTo('dashboard-home');
              }
              return;
            }
          }
        } else if (_allowedRoles && _allowedRoles.indexOf(_currentRole) === -1) {
          // Non-dashboard pages with explicit ACL
          if (typeof Toast !== 'undefined') {
            Toast.error('Your role does not have access to this section.');
          }
          this.navigateTo('dashboard-home');
          return;
        }
      }

      // Environment guard — block local-only routes on remote dashboard
      if (this.localOnlyRoutes.includes(pageName) && !Auth.isLocalDashboard()) {
        if (typeof Toast !== 'undefined') {
          Toast.error('This section is only available on the local dashboard.');
        }
        this.navigateTo('dashboard-home');
        return;
      }

      // Environment guard — block public-only routes on local (private) dashboard
      if (this.localBlockedRoutes.includes(pageName) && Auth.isLocalDashboard()) {
        this.navigateTo('dashboard-home');
        return;
      }
    }

    // Skip if already on this page (unless forced)
    if (pageName === this.currentPage && !forceLoad) {
      return;
    }

    // Switch layout if needed
    const targetLayout = this.getLayoutForPage(pageName);
    if (targetLayout !== this.currentLayout) {
      this.switchLayout(targetLayout);
    }

    // Update vertical theme and nav visibility
    this.updateTheme(pageName);

    // Close mobile menus
    this.closeMobileMenus();

    // Load the page
    await this.loadPage(pageName);

    // Update URL
    this.updateURL(pageName);

    // Update current page
    this.currentPage = pageName;

    // Update active nav states
    this.updateActiveNav(pageName);

    // Update breadcrumb
    this.updateBreadcrumb(pageName);

    // Track page view
    if (typeof Analytics !== 'undefined') {
      Analytics.trackPageView(`/#${pageName}`);
    }
  },

  /**
   * Update body theme class and nav visibility based on vertical context
   */
  updateTheme(pageName) {
    const vertical = this.getVerticalForPage(pageName);

    // Skip theme changes for dashboard routes
    if (this.isDashboardRoute(pageName)) return;

    // Remove all theme classes
    document.body.classList.remove('ent-theme', 'biz-theme');

    // Apply vertical-specific theme
    if (vertical === 'ent') {
      document.body.classList.add('ent-theme');
    } else if (vertical === 'biz') {
      document.body.classList.add('biz-theme');
    }

    // Update nav visibility (desktop)
    var entNav = document.getElementById('ent-nav');
    var bizNav = document.getElementById('biz-nav');
    var rootNav = document.getElementById('root-nav');

    if (entNav) entNav.style.display = vertical === 'ent' ? '' : 'none';
    if (bizNav) bizNav.style.display = vertical === 'biz' ? '' : 'none';
    if (rootNav) rootNav.style.display = vertical === 'neutral' ? '' : 'none';

    // Update mobile nav visibility
    var entMobileNav = document.getElementById('ent-nav-mobile');
    var bizMobileNav = document.getElementById('biz-nav-mobile');
    var rootMobileNav = document.getElementById('root-nav-mobile');

    if (entMobileNav) entMobileNav.style.display = vertical === 'ent' ? '' : 'none';
    if (bizMobileNav) bizMobileNav.style.display = vertical === 'biz' ? '' : 'none';
    if (rootMobileNav) rootMobileNav.style.display = vertical === 'neutral' ? '' : 'none';

    this.currentVertical = vertical;
  },

  /**
   * Load page content via PageLoader
   */
  async loadPage(pageName) {
    const pageUrl = this.routes[pageName];
    if (typeof PageLoader !== 'undefined') {
      await PageLoader.loadPage(pageName, pageUrl);
    } else {
      console.error('PageLoader not found');
    }
  },

  /**
   * Switch between public and dashboard layouts
   */
  switchLayout(mode) {
    const publicLayout = document.getElementById('public-layout');
    const dashboardLayout = document.getElementById('dashboard-layout');

    if (!publicLayout || !dashboardLayout) {
      console.error('Layout containers not found');
      return;
    }

    if (mode === 'dashboard') {
      publicLayout.style.display = 'none';
      dashboardLayout.style.display = 'flex';
    } else {
      publicLayout.style.display = '';
      dashboardLayout.style.display = 'none';
    }

    this.currentLayout = mode;
    document.body.setAttribute('data-layout', mode);

    console.log(`🔀 Layout switched to: ${mode}`);
  },

  /**
   * Handle initial page load from URL hash
   */
  handleInitialRoute() {
    const rawHash = window.location.hash.substring(1);
    const { route, query } = this._parseHash(rawHash);
    let hash = route;
    this.currentQueryParams = query;

    // Apply legacy redirects to initial route too
    if (this.legacyRedirects[hash]) {
      hash = this.legacyRedirects[hash];
    }

    const initialPage = hash ? (this.routes[hash] ? hash : '404') : this.defaultPage;

    // Small delay to ensure DOM is ready
    setTimeout(() => {
      this.navigateTo(initialPage, true);
    }, 100);
  },

  /**
   * Handle browser back/forward buttons
   */
  handleBrowserNavigation() {
    window.addEventListener('popstate', () => {
      const rawHash = window.location.hash.substring(1);
      const { route, query } = this._parseHash(rawHash);
      let hash = route;
      this.currentQueryParams = query;

      // Apply legacy redirects
      if (this.legacyRedirects[hash]) {
        hash = this.legacyRedirects[hash];
      }

      const pageName = hash ? (this.routes[hash] ? hash : '404') : this.defaultPage;
      this.navigateTo(pageName, true);
    });
  },

  /**
   * Update URL hash without triggering popstate
   */
  updateURL(pageName) {
    const queryStr = this.currentQueryParams ? `?${this.currentQueryParams}` : '';
    const url = `#${pageName}${queryStr}`;
    if (window.location.hash !== url) {
      window.history.pushState({ page: pageName }, '', url);
    }
  },

  /**
   * Update active state on nav links
   */
  updateActiveNav(pageName) {
    // Public nav (all three vertical navs use .nav-link)
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach((link) => {
      const linkPage = link.getAttribute('data-page');
      link.classList.toggle('active', linkPage === pageName);
    });

    // Dashboard sidebar
    document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
      const itemPage = item.getAttribute('data-page');
      item.classList.toggle('active', itemPage === pageName);
    });
  },

  /**
   * Update dashboard breadcrumb
   */
  updateBreadcrumb(pageName) {
    const breadcrumb = document.getElementById('topbar-breadcrumb');
    if (!breadcrumb) return;

    const labels = {
      'dashboard-home': 'Dashboard',
      'dashboard-roster': 'Roster Management',
      'dashboard-contracts': 'Contracts',
      'dashboard-finances': 'Finances & Accounting',
      'dashboard-booking': 'Booking Pipeline',
      'dashboard-gigs': 'Band Gigs',
      'dashboard-band-readiness': 'Band Readiness',
      'dashboard-inbox': 'Contact Queue',
      'dashboard-leads': 'Venue Leads',
      'dashboard-merch': 'Merch & Ecommerce',
      'dashboard-travel': 'Travel & Logistics',
      'dashboard-calendar': 'Calendar',
      'dashboard-ip': 'IP & Rights',
      'dashboard-distribution': 'Distribution',
      'dashboard-documents': 'Documents',
      'dashboard-integrations': 'Integrations',
      'dashboard-settings': 'Settings',
      'dashboard-team': 'Team Management',
      'dashboard-architecture': 'Site Architecture',
      'dashboard-credentials': 'Credentials & Connections',
      'dashboard-servers': 'Servers & Costs',
      'dashboard-metrics': 'Metrics & Analytics',
      'dashboard-export': 'Evidence Export',
      'dashboard-field': 'Field View',
      'dashboard-band-player': 'Band Player',
      'dashboard-payment-settings': 'Payment Info',
      'dashboard-crm-contacts': 'CRM Contacts',
      'dashboard-quotes': 'Quote Pipeline',
      'dashboard-tickets': 'Ticket Sales',
      'dashboard-agreements': 'Agreements',
    };

    const label = labels[pageName] || 'Dashboard';
    breadcrumb.innerHTML = `<span class="breadcrumb-label">${label}</span>`;
  },

  /**
   * Close all mobile menus
   */
  closeMobileMenus() {
    // Public mobile menu
    const mobileOverlay = document.getElementById('mobile-nav-overlay');
    const mobileToggle = document.querySelector('.mobile-menu-toggle');
    if (mobileOverlay) mobileOverlay.classList.remove('active');
    if (mobileToggle) {
      mobileToggle.classList.remove('active');
      mobileToggle.setAttribute('aria-expanded', 'false');
    }
    document.body.classList.remove('mobile-menu-open');

    // Dashboard sidebar (mobile)
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');
  },

  /**
   * Get current page name
   */
  getCurrentPage() {
    return this.currentPage;
  },

  /**
   * Get current vertical ('ent', 'biz', or 'neutral')
   */
  getCurrentVertical() {
    return this.currentVertical;
  },

  /**
   * Preload a page into cache
   */
  async preloadPage(pageName) {
    if (!this.routes[pageName]) return;
    if (typeof PageLoader !== 'undefined') {
      await PageLoader.preloadPage(pageName, this.routes[pageName]);
    }
  },
};

// Auto-initialize
if (typeof module === 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Router.init());
  } else {
    Router.init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Router;
}
