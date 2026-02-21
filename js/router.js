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
    'legal': 'pages/legal.html',

    // Entertainment pages (ent-* prefix)
    'ent-home': 'pages/entertainment/home.html',
    'ent-roster': 'pages/entertainment/roster.html',
    'ent-services': 'pages/entertainment/services.html',
    'ent-shop': 'pages/entertainment/shop.html',
    'ent-events': 'pages/entertainment/events.html',
    'ent-about': 'pages/entertainment/about.html',
    'ent-contact': 'pages/entertainment/contact.html',

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

    // IT Dept pages
    'dashboard-architecture': 'dashboard/architecture.html',
    'dashboard-credentials': 'dashboard/credentials.html',
    'dashboard-servers': 'dashboard/servers.html',
  },

  /**
   * Legacy route redirects (pre-split URLs → new prefixed routes)
   */
  legacyRedirects: {
    'roster': 'ent-roster',
    'shop': 'ent-shop',
    'services': 'home',
    'about': 'home',
    'contact': 'home',
  },

  /**
   * Routes only available on the local (LAN) dashboard.
   * On remote (GitHub Pages), these routes are blocked and redirect to dashboard-home.
   */
  localOnlyRoutes: [
    'dashboard-finances',
    'dashboard-documents',
    'dashboard-integrations',
    'dashboard-settings',
    'dashboard-team',
    'dashboard-credentials',
  ],

  currentPage: null,
  currentLayout: null,
  currentVertical: null,
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
   * Setup click delegation for navigation links
   */
  setupNavigation() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || href === '#') return;

      e.preventDefault();
      const pageName = href.substring(1);
      this.navigateTo(pageName);
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

    // Validate route
    if (!this.routes[pageName]) {
      console.warn(`Route "${pageName}" not found, loading default`);
      pageName = this.defaultPage;
    }

    // Auth guard — block unauthenticated dashboard access
    if (typeof Auth !== 'undefined') {
      if (!Auth.guardRoute(pageName)) {
        return; // Blocked — login modal shown, or auth still initializing
      }

      // Admin guard — block non-admin access to admin-only routes
      if (pageName === 'dashboard-team' && !Auth.isAdmin()) {
        if (typeof Toast !== 'undefined') {
          Toast.error('Access denied. Admin privileges required.');
        }
        return;
      }

      // Environment guard — block local-only routes on remote dashboard
      if (this.localOnlyRoutes.includes(pageName) && !Auth.isLocalDashboard()) {
        if (typeof Toast !== 'undefined') {
          Toast.error('This section is only available on the local dashboard.');
        }
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
    let hash = window.location.hash.substring(1);

    // Apply legacy redirects to initial route too
    if (this.legacyRedirects[hash]) {
      hash = this.legacyRedirects[hash];
    }

    const initialPage = hash && this.routes[hash] ? hash : this.defaultPage;

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
      let hash = window.location.hash.substring(1);

      // Apply legacy redirects
      if (this.legacyRedirects[hash]) {
        hash = this.legacyRedirects[hash];
      }

      const pageName = hash && this.routes[hash] ? hash : this.defaultPage;
      this.navigateTo(pageName, true);
    });
  },

  /**
   * Update URL hash without triggering popstate
   */
  updateURL(pageName) {
    const url = `#${pageName}`;
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
