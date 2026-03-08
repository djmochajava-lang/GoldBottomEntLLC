/* ============================================
   mobile-detect.js — Gold Bottom Ent. LLC Device Detection
   Version: 1.0.0-prototype
   ============================================ */

const MobileDetect = {

  /** @type {boolean} Whether the current device is mobile */
  isMobile: false,

  /** @type {boolean} Whether the current device is a tablet */
  isTablet: false,

  /** @type {boolean} Whether the current device is desktop */
  isDesktop: false,

  /** @type {boolean} Whether the device supports touch input */
  isTouchDevice: false,

  /** @type {string} Current breakpoint: 'mobile', 'tablet', or 'desktop' */
  currentBreakpoint: 'desktop',

  /**
   * Detect if the user agent indicates a mobile device
   * @returns {boolean}
   * @private
   */
  _detectMobile: function() {
    var ua = navigator.userAgent || navigator.vendor || window.opera || '';
    return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Windows Phone/i.test(ua);
  },

  /**
   * Detect if the user agent indicates a tablet device
   * @returns {boolean}
   * @private
   */
  _detectTablet: function() {
    var ua = navigator.userAgent || '';
    return /iPad|Android(?!.*Mobile)|Tablet|Kindle|Silk|PlayBook/i.test(ua);
  },

  /**
   * Detect if the device supports touch input
   * @returns {boolean}
   * @private
   */
  _detectTouch: function() {
    return ('ontouchstart' in window) ||
           (navigator.maxTouchPoints > 0) ||
           (navigator.msMaxTouchPoints > 0);
  },

  /**
   * Get the current responsive breakpoint based on viewport width
   * @returns {string} 'mobile' (<768px), 'tablet' (<1024px), or 'desktop'
   */
  getBreakpoint: function() {
    var width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  },

  /**
   * Set data attributes on the document body for CSS/JS targeting
   * @private
   */
  _setBodyAttributes: function() {
    var body = document.body;
    if (!body) return;

    body.setAttribute('data-device', this.isMobile ? 'mobile' : (this.isTablet ? 'tablet' : 'desktop'));
    body.setAttribute('data-touch', this.isTouchDevice ? 'true' : 'false');
    body.setAttribute('data-breakpoint', this.currentBreakpoint);
  },

  /**
   * Handle window resize — update breakpoint and body attributes
   * @private
   */
  _onResize: function() {
    var newBreakpoint = MobileDetect.getBreakpoint();
    if (newBreakpoint !== MobileDetect.currentBreakpoint) {
      var oldBreakpoint = MobileDetect.currentBreakpoint;
      MobileDetect.currentBreakpoint = newBreakpoint;
      MobileDetect._setBodyAttributes();

      // Dispatch a custom event so other modules can react
      var event = new CustomEvent('breakpointChange', {
        detail: {
          from: oldBreakpoint,
          to: newBreakpoint,
          width: window.innerWidth
        }
      });
      window.dispatchEvent(event);
    }
  },

  /**
   * Initialize device detection, set attributes, and bind resize listener
   */
  init: function() {
    // Detect device type
    this.isMobile = this._detectMobile();
    this.isTablet = this._detectTablet();
    this.isDesktop = !this.isMobile && !this.isTablet;
    this.isTouchDevice = this._detectTouch();
    this.currentBreakpoint = this.getBreakpoint();

    // Set body data attributes
    this._setBodyAttributes();

    // Listen for resize with a debounced handler
    var resizeTimer = null;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(MobileDetect._onResize, 150);
    });

    console.log('[MobileDetect] Device: ' +
      (this.isMobile ? 'Mobile' : this.isTablet ? 'Tablet' : 'Desktop') +
      ' | Touch: ' + this.isTouchDevice +
      ' | Breakpoint: ' + this.currentBreakpoint);
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { MobileDetect.init(); });
} else {
  MobileDetect.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = MobileDetect;
