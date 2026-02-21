// js/sidebar.js

/**
 * Dashboard Sidebar Module
 * Handles collapse/expand, mobile overlay, and active link management
 */

const Sidebar = {
  sidebar: null,
  collapseBtn: null,
  mobileToggle: null,
  collapsed: false,
  initialized: false,

  /** @type {string|null} Snapshot of the original sidebar nav HTML before filtering */
  _navOriginalHTML: null,

  init() {
    if (this.initialized) return;

    this.sidebar = document.getElementById('sidebar');
    this.collapseBtn = document.querySelector('.sidebar-collapse-btn');
    this.mobileToggle = document.querySelector('.sidebar-mobile-toggle');

    if (!this.sidebar) return;

    this.setupToggle();
    this.setupMobileToggle();
    this.setupNavClicks();
    this.restoreState();
    this.setupAccessFilter();

    this.initialized = true;
    console.log('✅ Sidebar initialized');
  },

  /**
   * Setup collapse/expand toggle (desktop)
   */
  setupToggle() {
    if (!this.collapseBtn) return;

    this.collapseBtn.addEventListener('click', () => {
      this.toggle();
    });
  },

  /**
   * Setup mobile sidebar toggle
   */
  setupMobileToggle() {
    if (!this.mobileToggle) return;

    this.mobileToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMobile();
    });

    // Close sidebar on backdrop click (mobile)
    document.addEventListener('click', (e) => {
      if (
        this.sidebar &&
        this.sidebar.classList.contains('mobile-open') &&
        !this.sidebar.contains(e.target) &&
        e.target !== this.mobileToggle &&
        !this.mobileToggle.contains(e.target)
      ) {
        this.closeMobile();
      }
    });

    // Close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.sidebar.classList.contains('mobile-open')) {
        this.closeMobile();
      }
    });
  },

  /**
   * Setup nav item clicks to close mobile sidebar
   */
  setupNavClicks() {
    document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        // Close mobile sidebar on nav
        if (this.sidebar.classList.contains('mobile-open')) {
          this.closeMobile();
        }
      });
    });
  },

  /**
   * Toggle sidebar collapsed state (desktop)
   */
  toggle() {
    this.collapsed = !this.collapsed;
    this.sidebar.classList.toggle('collapsed', this.collapsed);

    // Update collapse button icon
    const icon = this.collapseBtn.querySelector('i');
    if (icon) {
      icon.className = this.collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
    }

    // Save state
    if (typeof Utils !== 'undefined') {
      Utils.storage.set('gbe-sidebar-collapsed', this.collapsed);
    }
  },

  /**
   * Toggle mobile sidebar overlay
   */
  toggleMobile() {
    if (this.sidebar.classList.contains('mobile-open')) {
      this.closeMobile();
    } else {
      this.openMobile();
    }
  },

  /**
   * Open mobile sidebar
   */
  openMobile() {
    this.sidebar.classList.add('mobile-open');
    document.body.classList.add('sidebar-mobile-open');
  },

  /**
   * Close mobile sidebar
   */
  closeMobile() {
    this.sidebar.classList.remove('mobile-open');
    document.body.classList.remove('sidebar-mobile-open');
  },

  /**
   * Restore saved collapsed state
   */
  restoreState() {
    if (typeof Utils !== 'undefined') {
      const saved = Utils.storage.get('gbe-sidebar-collapsed', false);
      if (saved) {
        this.collapsed = true;
        this.sidebar.classList.add('collapsed');
        const icon = this.collapseBtn?.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-angles-right';
      }
    }
  },

  /**
   * Listen for auth access changes and filter sidebar items accordingly.
   * Auth dispatches 'gbe:auth-access-ready' after computing the user's
   * effective dashboard access (Firestore config + environment restrictions).
   */
  setupAccessFilter() {
    document.addEventListener('gbe:auth-access-ready', () => {
      this.filterMenuItems();
    });
  },

  /**
   * Remove inaccessible sidebar menu items from the DOM entirely.
   * Reads Auth.getDashboardAccess() which returns the effective list of
   * accessible route names for this session (Firestore-stored per-user config
   * intersected with environment restrictions like localOnlyRoutes).
   *
   * Items are fully removed — not hidden — so they cannot be discovered
   * via DOM inspection. A snapshot of the original nav HTML is stored on
   * first run so items can be restored when access changes (e.g., re-login).
   *
   * Removes entire nav groups when all their items are inaccessible.
   */
  filterMenuItems() {
    if (!this.sidebar) return;
    if (typeof Auth === 'undefined' || !Auth.getDashboardAccess) return;

    const access = Auth.getDashboardAccess();
    if (!access) return;

    const nav = this.sidebar.querySelector('.sidebar-nav');
    if (!nav) return;

    // First call: snapshot the full nav HTML so we can restore on access changes
    if (this._navOriginalHTML === null) {
      this._navOriginalHTML = nav.innerHTML;
    }

    // Restore full nav from snapshot (clean slate before filtering)
    nav.innerHTML = this._navOriginalHTML;

    // Remove inaccessible items from the DOM
    nav.querySelectorAll('.sidebar-nav-item[data-page]').forEach((item) => {
      const page = item.getAttribute('data-page');
      if (!page || !page.startsWith('dashboard-')) return;
      if (access.indexOf(page) === -1) {
        item.remove();
      }
    });

    // Remove groups that have no remaining items
    nav.querySelectorAll('.sidebar-nav-group').forEach((group) => {
      if (group.querySelectorAll('.sidebar-nav-item').length === 0) {
        group.remove();
      }
    });

    // Re-bind mobile close handlers on the fresh DOM elements
    this.setupNavClicks();
  },

  /**
   * Set active sidebar link
   */
  setActiveLink(pageName) {
    document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
      const itemPage = item.getAttribute('data-page');
      item.classList.toggle('active', itemPage === pageName);
    });
  },
};

// Auto-initialize
if (typeof module === 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Sidebar.init());
  } else {
    Sidebar.init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Sidebar;
}
