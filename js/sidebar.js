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

  /** @type {string|null} Snapshot of the static sidebar nav HTML (standard items from index.html) */
  _navStaticHTML: null,

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
   * Build the sidebar nav from two sources:
   *
   * 1. Static items — standard menu groups hardcoded in index.html
   *    (Overview, Management, Creative, Operations). These are restored
   *    from a snapshot and filtered by the user's access list.
   *
   * 2. Dynamic items — privileged menu groups fetched from Firestore
   *    (e.g., IT Dept). These never appear in the public repo HTML.
   *    Only items present in the user's dashboardAccess are rendered.
   *
   * Items removed from the DOM cannot be discovered via inspection.
   */
  filterMenuItems() {
    if (!this.sidebar) return;
    if (typeof Auth === 'undefined') return;

    const access = Auth.getDashboardAccess();
    if (!access) return;

    const nav = this.sidebar.querySelector('.sidebar-nav');
    if (!nav) return;

    // Snapshot the static HTML on first run
    if (this._navStaticHTML === null) {
      this._navStaticHTML = nav.innerHTML;
    }

    // ── 1. Restore and filter static items ──
    nav.innerHTML = this._navStaticHTML;

    // Remove static items the user doesn't have access to
    nav.querySelectorAll('.sidebar-nav-item[data-page]').forEach((item) => {
      const page = item.getAttribute('data-page');
      if (page && access.indexOf(page) === -1) {
        item.remove();
      }
    });

    // Remove static groups that are now empty
    nav.querySelectorAll('.sidebar-nav-group').forEach((group) => {
      if (group.querySelectorAll('.sidebar-nav-item').length === 0) {
        group.remove();
      }
    });

    // ── 2. Append privileged items from Firestore config ──
    const config = Auth.getMenuConfig ? Auth.getMenuConfig() : null;
    if (config && config.groups) {
      config.groups.forEach((group) => {
        const visibleItems = group.items.filter((item) =>
          access.indexOf(item.route) !== -1
        );

        if (visibleItems.length === 0) return;

        let groupHTML = '<div class="sidebar-nav-group">';
        groupHTML += '<span class="sidebar-nav-label">' + this._escapeHTML(group.label) + '</span>';

        visibleItems.forEach((item) => {
          groupHTML += '<a href="#' + item.route + '" class="sidebar-nav-item" data-page="' + item.route + '">';
          groupHTML += '<i class="' + this._escapeHTML(item.icon) + '"></i>';
          groupHTML += '<span class="sidebar-nav-text">' + this._escapeHTML(item.label) + '</span>';
          groupHTML += '</a>';
        });

        groupHTML += '</div>';
        nav.insertAdjacentHTML('beforeend', groupHTML);
      });
    }

    // Re-bind mobile close handlers on the fresh DOM elements
    this.setupNavClicks();

    // Re-apply active state for the current page
    if (typeof Router !== 'undefined' && Router.currentPage) {
      this.setActiveLink(Router.currentPage);
    }
  },

  /**
   * Escape a string for safe insertion into HTML.
   * @param {string} str
   * @returns {string}
   * @private
   */
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
