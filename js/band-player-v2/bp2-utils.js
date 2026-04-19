/* ============================================
   bp2-utils.js — Shared Pure Utilities (Band Player v2.0)

   Pure functions used across all v2 modules.
   No DOM, no side effects, no state — fully unit-testable.
   ============================================ */
(function(global) {
  'use strict';

  var BP2Utils = {
    /**
     * HTML-escape a string to prevent XSS.
     */
    esc: function(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /**
     * Title-case a string: "hello world" → "Hello World"
     */
    titleCase: function(str) {
      if (!str) return '';
      return str.replace(/\b\w+/g, function(w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      });
    },

    /**
     * Format seconds into "m:ss" display.
     */
    formatTime: function(sec) {
      if (!sec || isNaN(sec)) return '0:00';
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    },

    /**
     * Clamp a number between lo and hi.
     */
    clamp: function(v, lo, hi) {
      if (v == null || isNaN(v)) return lo;
      return Math.max(lo, Math.min(hi, v));
    },

    /**
     * Generate a unique ID: "bp2_{timestamp}_{random}"
     */
    generateId: function(prefix) {
      return (prefix || 'bp2') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    },

    /**
     * Simple debounce: delays fn execution until wait ms after last call.
     */
    debounce: function(fn, wait) {
      var timer;
      return function() {
        var ctx = this, args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function() { fn.apply(ctx, args); }, wait);
      };
    },

    /**
     * Simple throttle: executes fn at most once per wait ms.
     */
    throttle: function(fn, wait) {
      var last = 0;
      return function() {
        var now = Date.now();
        if (now - last >= wait) {
          last = now;
          fn.apply(this, arguments);
        }
      };
    }
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Utils;
  } else if (global) {
    global.BP2Utils = BP2Utils;
  }
})(typeof window !== 'undefined' ? window : this);
