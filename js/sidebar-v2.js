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
    this.attachNavFeedback();
    this.attachNavClicks();
    this.attachBackdropClose();
    this.filterByRole();
    this.listenForAuthReady();

    this.initialized = true;
    console.log('[SidebarV2] Initialized');
  },

  /**
   * Attach toggle button handlers.
   *
   * Fast-path: fire toggle on `touchstart` instead of waiting for `click`.
   * On iOS Safari, when the main thread is busy (initial dashboard render,
   * Firestore first-snapshot delivery, etc.), the synthetic `click` can sit
   * in the task queue behind that work for many seconds — even though the
   * actual JS in toggle() takes 0ms. touchstart is delivered from a
   * higher-priority pointer-event queue and arrives sooner on a busy thread.
   *
   * Desktop and any non-touch device falls through to the click handler.
   * The lastTouchAt guard suppresses the synthetic click that follows a
   * real touch so we don't double-toggle.
   */
  attachToggle: function() {
    var self = this;
    var lastTouchAt = 0;

    this.toggleBtn.addEventListener('touchstart', function() {
      self.toggleBtn.classList.add('pressed');
      var t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      lastTouchAt = t;
      try { console.log('[perf] sidebar.touchstart @ ' + Math.round(t) + 'ms'); } catch (e) {}
      self.toggle();
    }, { passive: true });

    this.toggleBtn.addEventListener('touchend', function() {
      self.toggleBtn.classList.remove('pressed');
    }, { passive: true });

    this.toggleBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      self.toggleBtn.classList.remove('pressed');
      var nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      // Suppress the synthetic click that follows a real touchstart-driven toggle.
      if (nowT - lastTouchAt < 500) {
        try { console.log('[perf] sidebar.click suppressed-after-touch @ ' + Math.round(nowT) + 'ms'); } catch (e2) {}
        return;
      }
      try { console.log('[perf] sidebar.click @ ' + Math.round(nowT) + 'ms'); } catch (e3) {}
      self.toggle();
    });
  },

  /**
   * Instant visual feedback when a nav item is pressed.
   *
   * On touch devices there is no :hover, and the synthetic `click` that drives
   * navigation can sit behind a busy main thread for many seconds. So we
   * highlight the pressed item immediately on `touchstart` (delivered from the
   * high-priority pointer-event queue) — the user sees which item they selected
   * the instant their finger lands, before navigation or page load even begins.
   * `mousedown` gives the same instant feedback on non-touch devices.
   *
   * We add the same `.active` class the router uses for the current page, so the
   * highlight looks identical and Router.updateActiveNav() later reconciles it
   * to the page that actually loads (a no-op when, as usual, they match).
   */
  attachNavFeedback: function() {
    var self = this;
    var markPressed = function(target) {
      var item = (target && target.closest) ? target.closest('.sidebar-nav-item') : null;
      if (!item) return;
      self.sidebar.querySelectorAll('.sidebar-nav-item.active').forEach(function(el) {
        if (el !== item) el.classList.remove('active');
      });
      item.classList.add('active');
    };
    this.sidebar.addEventListener('touchstart', function(e) {
      markPressed(e.target);
    }, { passive: true });
    this.sidebar.addEventListener('mousedown', function(e) {
      markPressed(e.target);
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
    if (typeof Perf !== 'undefined') Perf.mark('sidebar.toggle.tap');
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
    if (typeof Perf !== 'undefined') {
      Perf.mark('sidebar.toggle.opened');
      Perf.measure('sidebar.toggle', 'sidebar.toggle.tap', 'sidebar.toggle.opened');
      // Two rAFs: the next paint actually commits the new transform.
      // Logs the "tap to visible" delta — what the user perceives as the
      // hamburger lag — separate from the synchronous JS work above.
      var tapAt = Perf.marks['sidebar.toggle.tap'];
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (tapAt == null) return;
          var paintedAt = performance.now();
          var dur = Math.round(paintedAt - tapAt);
          try { console.log('[perf] sidebar.tap-to-painted = ' + dur + 'ms'); } catch (e) {}
          Perf.measures['sidebar.tap-to-painted'] = dur;
        });
      });
    }
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
    if (typeof Perf !== 'undefined') Perf.mark('sidebar.render.start');
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
    if (typeof Perf !== 'undefined') {
      Perf.mark('sidebar.render.end');
      Perf.measure('sidebar.render', 'sidebar.render.start', 'sidebar.render.end');
    }
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
