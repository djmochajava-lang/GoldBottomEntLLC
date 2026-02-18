// js/navigation.js

/**
 * Public Navigation Module
 * Handles mobile menu toggle and active link highlighting
 */

const Navigation = {
  mobileToggle: null,
  mobileOverlay: null,

  init() {
    this.mobileToggle = document.querySelector('.mobile-menu-toggle');
    this.mobileOverlay = document.getElementById('mobile-nav-overlay');

    this.setupMobileMenu();
    this.setupMobileLinks();

    console.log('✅ Navigation initialized');
  },

  /**
   * Setup mobile hamburger toggle
   */
  setupMobileMenu() {
    if (!this.mobileToggle) return;

    this.mobileToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMobileMenu();
    });

    // Close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isMobileMenuOpen()) {
        this.closeMobileMenu();
      }
    });

    // Close on backdrop click
    if (this.mobileOverlay) {
      this.mobileOverlay.addEventListener('click', (e) => {
        if (e.target === this.mobileOverlay) {
          this.closeMobileMenu();
        }
      });
    }
  },

  /**
   * Setup mobile nav links to close menu on click
   */
  setupMobileLinks() {
    document.querySelectorAll('.mobile-nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        this.closeMobileMenu();
      });
    });
  },

  /**
   * Toggle mobile menu
   */
  toggleMobileMenu() {
    if (this.isMobileMenuOpen()) {
      this.closeMobileMenu();
    } else {
      this.openMobileMenu();
    }
  },

  /**
   * Open mobile menu
   */
  openMobileMenu() {
    if (this.mobileToggle) {
      this.mobileToggle.classList.add('active');
      this.mobileToggle.setAttribute('aria-expanded', 'true');
    }
    if (this.mobileOverlay) {
      this.mobileOverlay.classList.add('active');
    }
    document.body.classList.add('mobile-menu-open');
  },

  /**
   * Close mobile menu
   */
  closeMobileMenu() {
    if (this.mobileToggle) {
      this.mobileToggle.classList.remove('active');
      this.mobileToggle.setAttribute('aria-expanded', 'false');
    }
    if (this.mobileOverlay) {
      this.mobileOverlay.classList.remove('active');
    }
    document.body.classList.remove('mobile-menu-open');
  },

  /**
   * Check if mobile menu is open
   */
  isMobileMenuOpen() {
    return this.mobileOverlay && this.mobileOverlay.classList.contains('active');
  },
};

// Auto-initialize
if (typeof module === 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Navigation.init());
  } else {
    Navigation.init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Navigation;
}
