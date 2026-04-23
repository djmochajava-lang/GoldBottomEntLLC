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

  init() {
    if (this.initialized) return;

    // If SidebarV2 is active for this user, V1 steps aside
    if (typeof SidebarV2 !== 'undefined' && SidebarV2.initialized) {
      var v1btn = document.querySelector('.sidebar-mobile-toggle');
      if (v1btn) v1btn.style.display = 'none';
      this.initialized = true; // Prevent main.js from retrying
      console.log('[Sidebar V1] Yielding to SidebarV2');
      return;
    }

    this.sidebar = document.getElementById('sidebar');
    this.collapseBtn = document.querySelector('.sidebar-collapse-btn');
    this.mobileToggle = document.querySelector('.sidebar-mobile-toggle');

    if (!this.sidebar) return;

    this.setupToggle();
    this.setupMobileToggle();
    this.setupNavClicks();
    this.restoreState();
    this.startInboxBadge();

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
   * Set active sidebar link
   */
  setActiveLink(pageName) {
    document.querySelectorAll('.sidebar-nav-item').forEach((item) => {
      const itemPage = item.getAttribute('data-page');
      item.classList.toggle('active', itemPage === pageName);
    });
  },

  // ── Inbox Unread Badge ──────────────────────────────

  _inboxPollTimer: null,

  startInboxBadge() {
    // Only poll on LAN (where the server API is reachable)
    // Auth may not be loaded yet (deferred) — skip silently
    if (typeof Auth === 'undefined' || !Auth.isLocalDashboard || !Auth.isLocalDashboard()) return;

    this.refreshInboxBadge();
    this._inboxPollTimer = setInterval(() => this.refreshInboxBadge(), 60000);
  },

  refreshInboxBadge() {
    const badge = document.getElementById('inbox-unread-badge');
    if (!badge) return;

    // Skip immediately on remote — no server API available
    // Auth may not be loaded yet (deferred) — skip silently
    if (typeof Auth === 'undefined' || !Auth.isLocalDashboard || !Auth.isLocalDashboard()) {
      badge.style.display = 'none';
      return;
    }

    Utils.apiFetch('/api/v1/inbox/stats')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) { badge.style.display = 'none'; return; }
        const count = data.unread || 0;
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : count;
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      })
      .catch(() => { badge.style.display = 'none'; });
  },
};

// Auto-initialize immediately — sidebar elements exist above the script tags.
// Do NOT wait for DOMContentLoaded; that fires after Firebase + band player
// finish loading, which takes 10-30s on mobile cellular. Sidebar must work now.
if (typeof module === 'undefined') {
  Sidebar.init();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Sidebar;
}
