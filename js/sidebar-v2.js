// js/sidebar-v2.js

/**
 * SidebarV2 — Pure UI sidebar controller.
 *
 * Design principles:
 *   1. ZERO dependencies on Auth, Router, or any other module.
 *   2. Reads role from AuthCache (sync localStorage, < 1ms).
 *   3. Listens for 'gbe:auth-ready' event to re-filter menu items.
 *   4. Toggle response is pure CSS class manipulation (< 50ms on any device).
 *   5. Nav link clicks are handled via event delegation (no per-item binding).
 *
 * V2 is active for ALL authenticated dashboard roles.
 * V1 (sidebar.js) is superseded. V2 uses a grid icon toggle
 * (.sidebar-v2-toggle) to visually distinguish from V1's hamburger.
 */

const SidebarV2 = {
  initialized: false,
  sidebar: null,
  toggleBtn: null,

  /**
   * Initialize V2 sidebar. Active for all roles; menu items filtered by role.
   */
  init: function() {
    if (this.initialized) return;

    this.toggleBtn = document.querySelector('.sidebar-v2-toggle');
    this.sidebar = document.getElementById('sidebar');

    if (!this.toggleBtn || !this.sidebar) return;

    // V2 is active for all roles — hide V1 toggle, show V2 toggle
    var v1btn = document.querySelector('.sidebar-mobile-toggle');
    if (v1btn) v1btn.style.display = 'none';
    this.toggleBtn.style.display = 'inline-flex';

    // If V1 already grabbed the sidebar, mark it as yielded so it doesn't conflict
    if (typeof Sidebar !== 'undefined' && Sidebar.initialized) {
      Sidebar.mobileToggle = null; // V1 won't respond to clicks on hidden button
    }

    this.attachToggle();
    this.attachNavClicks();
    this.attachBackdropClose();
    this.filterByRole();
    this.listenForAuthReady();

    this.initialized = true;
    console.log('[SidebarV2] Initialized');
  },

  /**
   * Attach toggle button handlers.
   * touchstart = instant visual feedback. click = actual toggle.
   */
  attachToggle: function() {
    var self = this;

    this.toggleBtn.addEventListener('touchstart', function() {
      self.toggleBtn.classList.add('pressed');
    }, { passive: true });

    this.toggleBtn.addEventListener('touchend', function() {
      self.toggleBtn.classList.remove('pressed');
    }, { passive: true });

    this.toggleBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      self.toggleBtn.classList.remove('pressed');
      self.toggle();
    });
  },

  /**
   * Delegated nav click handler on sidebar.
   * Closes sidebar when any hash link inside it is tapped.
   * Navigation itself happens via Router's existing document-level click delegation.
   */
  attachNavClicks: function() {
    var self = this;
    this.sidebar.addEventListener('click', function(e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      // Close sidebar immediately — Router handles the navigation
      self.close();
    });
  },

  /**
   * Close sidebar on backdrop click (outside sidebar) or ESC.
   */
  attachBackdropClose: function() {
    var self = this;

    document.addEventListener('click', function(e) {
      if (!self.sidebar.classList.contains('mobile-open')) return;
      if (self.sidebar.contains(e.target)) return;
      if (e.target === self.toggleBtn || self.toggleBtn.contains(e.target)) return;
      self.close();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && self.sidebar.classList.contains('mobile-open')) {
        self.close();
      }
    });
  },

  /**
   * Toggle sidebar open/closed. Pure CSS class manipulation.
   */
  toggle: function() {
    var isOpen = this.sidebar.classList.contains('mobile-open');
    if (isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open: function() {
    this.sidebar.classList.add('mobile-open');
    document.body.classList.add('sidebar-mobile-open');
  },

  close: function() {
    this.sidebar.classList.remove('mobile-open');
    document.body.classList.remove('sidebar-mobile-open');
  },

  /**
   * Filter sidebar nav items by cached role.
   * Items with data-roles attribute are shown only if the current role is listed.
   * Items without data-roles are always shown.
   */
  filterByRole: function() {
    var cache = typeof AuthCache !== 'undefined' ? AuthCache.read() : null;
    var role = cache ? (cache.activeRole || cache.role) : null;

    this.sidebar.querySelectorAll('[data-roles]').forEach(function(item) {
      if (!role) {
        // No cached role — hide role-gated items
        item.style.display = 'none';
        return;
      }
      var allowed = item.getAttribute('data-roles').split(',');
      item.style.display = allowed.indexOf(role) !== -1 ? '' : 'none';
    });
  },

  /**
   * Re-filter menu when Auth finishes background verification.
   */
  listenForAuthReady: function() {
    var self = this;
    document.addEventListener('gbe:auth-ready', function() {
      self.filterByRole();
    });
  }
};

// Auto-initialize immediately — sidebar DOM exists above this script tag.
if (typeof module === 'undefined') {
  SidebarV2.init();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SidebarV2;
}
