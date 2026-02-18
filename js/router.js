// js/router.js

/**
 * Router Module — Dual-Layout SPA
 * Hash-based routing with automatic layout switching.
 * Routes prefixed with 'dashboard-' use the dashboard layout.
 * All other routes use the public layout.
 */

const Router = {
  routes: {
    // Public pages
    'home': 'pages/home.html',
    'roster': 'pages/roster.html',
    'services': 'pages/services.html',
    'shop': 'pages/shop.html',
    'about': 'pages/about.html',
    'contact': 'pages/contact.html',
    'legal': 'pages/legal.html',
    // Dashboard pages
    'dashboard-home': 'dashboard/home.html',
    'dashboard-roster': 'dashboard/roster.html',
    'dashboard-contracts': 'dashboard/contracts.html',
    'dashboard-finances': 'dashboard/finances.html',
    'dashboard-booking': 'dashboard/booking.html',
    'dashboard-merch': 'dashboard/merch.html',
    'dashboard-travel': 'dashboard/travel.html',
    'dashboard-calendar': 'dashboard/calendar.html',
    'dashboard-ip': 'dashboard/ip-rights.html',
    'dashboard-distribution': 'dashboard/distribution.html',
    'dashboard-documents': 'dashboard/documents.html',
    'dashboard-integrations': 'dashboard/integrations.html',
    'dashboard-settings': 'dashboard/settings.html',
  },

  currentPage: null,
  currentLayout: null,
  defaultPage: 'home',

  /**
   * Initialize router
   */
  init() {
    this.setupNavigation();
    this.handleInitialRoute();
    this.handleBrowserNavigation();
    console.log('✅ Router initialized (dual-layout)');
  },

  /**
   * Check if a route is a dashboard route
   */
  isDashboardRoute(pageName) {
    return pageName.startsWith('dashboard-');
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
    // Validate route
    if (!this.routes[pageName]) {
      console.warn(`Route "${pageName}" not found, loading default`);
      pageName = this.defaultPage;
    }

    // Auth guard — block unauthenticated dashboard access
    if (typeof Auth !== 'undefined' && Auth.initialized) {
      if (!Auth.guardRoute(pageName)) {
        return; // Blocked — login modal shown by Auth
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
    const hash = window.location.hash.substring(1);
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
      const hash = window.location.hash.substring(1);
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
    // Public nav
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
      'dashboard-merch': 'Merch & Ecommerce',
      'dashboard-travel': 'Travel & Logistics',
      'dashboard-calendar': 'Calendar',
      'dashboard-ip': 'IP & Rights',
      'dashboard-distribution': 'Distribution',
      'dashboard-documents': 'Documents',
      'dashboard-integrations': 'Integrations',
      'dashboard-settings': 'Settings',
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
