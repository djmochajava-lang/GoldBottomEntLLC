// js/mobile-dash-menu.js

/**
 * MobileDashMenu — dedicated full-screen mobile dashboard menu.
 *
 * Modeled on the L.A. Young band-page pattern (which is fast precisely because
 * its mobile menu is a separate, pre-rendered, full-screen overlay whose
 * open/close/highlight are pure CSS class toggles — completely decoupled from
 * page loading). The GBE dashboard's drawer reused the DESKTOP sidebar and tied
 * its highlight to the router/page-fetch pipeline, so on a busy thread it felt
 * unresponsive. This overlay fixes the architecture on the GBE side only.
 *
 * Design principles (mirroring L.A. Young):
 *   1. Dedicated overlay element (#gbe-dmenu), full-screen, slides in.
 *   2. Open/close/highlight are pure class toggles — never wait on a fetch.
 *   3. SINGLE SOURCE OF TRUTH: nav items are cloned from #sidebar, so there is
 *      no second menu to maintain. Clones keep `.sidebar-nav-item` + `data-page`,
 *      so Router.updateActiveNav() syncs their selected state for free.
 *   4. Role filtering mirrors SidebarV2.filterByRole (reads AuthCache, < 1ms).
 *   5. Mobile only (CSS hides it >=1025px); the desktop sidebar is untouched.
 */

const MobileDashMenu = {
  initialized: false,
  overlay: null,
  nav: null,
  built: false,

  init: function () {
    if (this.initialized) return;
    this.overlay = document.getElementById('gbe-dmenu');
    if (!this.overlay) return;
    this.nav = this.overlay.querySelector('.gbe-dmenu-nav');

    var self = this;

    var closeBtn = this.overlay.querySelector('.gbe-dmenu-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { self.close(); });

    // Tap on the dimmed area outside the panel closes the menu.
    this.overlay.addEventListener('click', function (e) {
      if (e.target === self.overlay) self.close();
    });

    // Instant press feedback — highlight the item the moment a finger lands
    // (touchstart is delivered ahead of the synthetic click even on a busy
    // thread). mousedown covers non-touch. Pure visual; Router reconciles later.
    this.nav.addEventListener('touchstart', function (e) { self._press(e.target); }, { passive: true });
    this.nav.addEventListener('mousedown', function (e) { self._press(e.target); });

    // Navigation: clones are real <a href="#..."> so the Router's document-level
    // click delegation performs the nav. We only close the overlay. Sign Out is
    // the exception — its real handler is bound by id in auth.js and is lost when
    // the button is cloned (ids stripped), so we re-wire it here.
    this.nav.addEventListener('click', function (e) {
      var t = e.target;
      var logout = (t && t.closest) ? t.closest('.sidebar-logout-btn') : null;
      if (logout) {
        e.preventDefault();
        self.close();
        if (typeof Auth !== 'undefined' && Auth.logout) {
          Auth.logout().then(function () {
            if (typeof Toast !== 'undefined') Toast.success('Signed out');
            if (typeof Router !== 'undefined') Router.navigateTo('home');
          });
        }
        return;
      }
      if (t && t.closest && t.closest('a[href^="#"]')) self.close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && self.isOpen()) self.close();
    });

    // Role can resolve/flip after background auth verification — rebuild so the
    // overlay always reflects the current role's items.
    document.addEventListener('gbe:auth-ready', function () {
      self.built = false;
      if (self.isOpen()) self.build();
    });

    this.initialized = true;
    console.log('[MobileDashMenu] initialized');
  },

  /** Instant highlight of the pressed item (single-selection). */
  _press: function (target) {
    var item = (target && target.closest) ? target.closest('.sidebar-nav-item') : null;
    if (!item) return;
    this.nav.querySelectorAll('.sidebar-nav-item.active').forEach(function (el) {
      if (el !== item) el.classList.remove('active');
    });
    item.classList.add('active');
  },

  /** Clone the (already role-aware) sidebar nav + footer into the overlay. */
  build: function () {
    if (!this.nav) return;
    var src = document.querySelector('#sidebar .sidebar-nav');
    if (!src) return;

    this.nav.innerHTML = src.innerHTML;

    var foot = document.querySelector('#sidebar .sidebar-footer');
    if (foot) {
      var fwrap = document.createElement('div');
      fwrap.className = 'gbe-dmenu-footer';
      fwrap.innerHTML = foot.innerHTML;
      this.nav.appendChild(fwrap);
    }

    // Strip duplicated ids so the clones don't collide with the live sidebar.
    this.nav.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });

    // Role filter — same rule as SidebarV2.filterByRole.
    var role = null;
    try {
      var c = (typeof AuthCache !== 'undefined') ? AuthCache.read() : null;
      role = c ? (c.activeRole || c.role) : null;
    } catch (e) {}
    this.nav.querySelectorAll('[data-roles]').forEach(function (item) {
      if (!role) { item.style.display = 'none'; return; }
      item.style.display = (item.getAttribute('data-roles').split(',').indexOf(role) !== -1) ? '' : 'none';
    });

    // Sign Out is shown post-auth on the source via id; the clone lost the id,
    // so make sure it's visible (the user is authenticated if they're here).
    var lo = this.nav.querySelector('.sidebar-logout-btn');
    if (lo) lo.style.display = '';

    // Reflect the current page as selected.
    if (typeof Router !== 'undefined' && Router.currentPage) {
      this.nav.querySelectorAll('.sidebar-nav-item').forEach(function (it) {
        it.classList.toggle('active', it.getAttribute('data-page') === Router.currentPage);
      });
    }

    this.built = true;
  },

  open: function () {
    if (!this.overlay) return;
    if (!this.built) this.build();
    this.overlay.classList.add('open');
    this.overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('gbe-dmenu-open');
  },

  close: function () {
    if (!this.overlay) return;
    this.overlay.classList.remove('open');
    this.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('gbe-dmenu-open');
  },

  toggle: function () { this.isOpen() ? this.close() : this.open(); },

  isOpen: function () { return this.overlay && this.overlay.classList.contains('open'); }
};

if (typeof module === 'undefined') {
  MobileDashMenu.init();
}
if (typeof window !== 'undefined') {
  window.MobileDashMenu = MobileDashMenu;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileDashMenu;
}
