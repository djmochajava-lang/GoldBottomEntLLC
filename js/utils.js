/* ============================================
   utils.js — Gold Bottom Ent. LLC Utility Functions
   Version: 1.0.0-prototype
   ============================================ */

const Utils = {

  /**
   * Generate a unique ID with GBE prefix
   * @returns {string} Unique ID like 'gbe_1708000000000_a3f2'
   */
  generateId: function() {
    var hex = Math.floor(Math.random() * 65536).toString(16).padStart(4, '0');
    return 'gbe_' + Date.now() + '_' + hex;
  },

  /**
   * Format a number as US currency
   * @param {number} amount
   * @returns {string} Formatted currency string like '$1,234.56'
   */
  formatCurrency: function(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '$0.00';
    return '$' + Number(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  /**
   * Format a date string as 'MMM DD, YYYY'
   * @param {string|Date} dateStr
   * @returns {string} Formatted date like 'Feb 17, 2026'
   */
  formatDate: function(dateStr) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  },

  /**
   * Format a date string as 'MM/DD/YY'
   * @param {string|Date} dateStr
   * @returns {string} Formatted date like '02/17/26'
   */
  formatDateShort: function(dateStr) {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Invalid Date';
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var yy = String(d.getFullYear()).slice(-2);
    return mm + '/' + dd + '/' + yy;
  },

  /**
   * Return a human-readable relative time string
   * @param {string|Date} dateStr
   * @returns {string} Relative time like '2 hours ago', 'Yesterday', '3 days ago'
   */
  timeAgo: function(dateStr) {
    var now = new Date();
    var then = new Date(dateStr);
    if (isNaN(then.getTime())) return 'Unknown';

    var seconds = Math.floor((now - then) / 1000);
    if (seconds < 0) return 'Just now';
    if (seconds < 60) return seconds <= 5 ? 'Just now' : seconds + ' seconds ago';

    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes === 1 ? '1 minute ago' : minutes + ' minutes ago';

    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? '1 hour ago' : hours + ' hours ago';

    var days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';

    var weeks = Math.floor(days / 7);
    if (weeks === 1) return '1 week ago';
    if (weeks < 4) return weeks + ' weeks ago';

    var months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    if (months < 12) return months + ' months ago';

    var years = Math.floor(days / 365);
    return years === 1 ? '1 year ago' : years + ' years ago';
  },

  /**
   * Truncate a string to a given length and append '...'
   * @param {string} str
   * @param {number} len - Maximum length (default 100)
   * @returns {string}
   */
  truncate: function(str, len) {
    if (!str) return '';
    len = len || 100;
    if (str.length <= len) return str;
    return str.substring(0, len).trimEnd() + '...';
  },

  /**
   * Convert a string to a URL-safe slug
   * @param {string} str
   * @returns {string} Slug like 'my-page-title'
   */
  slugify: function(str) {
    if (!str) return '';
    return str
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  },

  /**
   * Debounce a function call
   * @param {Function} fn
   * @param {number} delay - Delay in ms (default 300)
   * @returns {Function}
   */
  debounce: function(fn, delay) {
    var timer = null;
    delay = delay || 300;
    return function() {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() {
        fn.apply(context, args);
      }, delay);
    };
  },

  /**
   * Throttle a function call
   * @param {Function} fn
   * @param {number} limit - Minimum interval in ms (default 300)
   * @returns {Function}
   */
  throttle: function(fn, limit) {
    var waiting = false;
    limit = limit || 300;
    return function() {
      if (!waiting) {
        fn.apply(this, arguments);
        waiting = true;
        setTimeout(function() {
          waiting = false;
        }, limit);
      }
    };
  },

  /**
   * Escape HTML entities to prevent XSS
   * @param {string} str
   * @returns {string}
   */
  escapeHtml: function(str) {
    if (!str) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, function(m) { return map[m]; });
  },

  /**
   * Validate an email address
   * @param {string} email
   * @returns {boolean}
   */
  isValidEmail: function(email) {
    if (!email) return false;
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.trim());
  },

  /**
   * Validate a US phone number (accepts various formats)
   * @param {string} phone
   * @returns {boolean}
   */
  isValidPhone: function(phone) {
    if (!phone) return false;
    var cleaned = phone.replace(/[\s\-\(\)\.]+/g, '');
    var re = /^(\+?1)?[2-9]\d{2}[2-9]\d{6}$/;
    return re.test(cleaned);
  },

  /**
   * Capitalize the first letter of a string
   * @param {string} str
   * @returns {string}
   */
  capitalize: function(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  },

  /**
   * Get initials from a full name
   * @param {string} name
   * @returns {string} Initials like 'JD' from 'John Doe'
   */
  getInitials: function(name) {
    if (!name) return '';
    return name
      .split(/\s+/)
      .filter(function(part) { return part.length > 0; })
      .map(function(part) { return part.charAt(0).toUpperCase(); })
      .join('');
  },

  /**
   * Return a random element from an array
   * @param {Array} arr
   * @returns {*}
   */
  randomFromArray: function(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  },

  /**
   * Deep clone an object via JSON serialization
   * @param {*} obj
   * @returns {*}
   */
  deepClone: function(obj) {
    if (obj === null || obj === undefined) return obj;
    return JSON.parse(JSON.stringify(obj));
  },

  /**
   * Check if a value is empty (null, undefined, empty string, empty array, empty object)
   * @param {*} val
   * @returns {boolean}
   */
  isEmpty: function(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string' && val.trim() === '') return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return true;
    return false;
  },

  /**
   * Download a JavaScript object as a JSON file
   * @param {*} data
   * @param {string} filename - File name (default 'export.json')
   */
  downloadJSON: function(data, filename) {
    filename = filename || 'export.json';
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Copy text to the system clipboard
   * @param {string} text
   * @returns {Promise}
   */
  copyToClipboard: function(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function() {
        if (typeof Toast !== 'undefined' && Toast.success) {
          Toast.success('Copied to clipboard');
        }
      }).catch(function() {
        Utils._fallbackCopy(text);
      });
    }
    Utils._fallbackCopy(text);
    return Promise.resolve();
  },

  /**
   * Fallback copy using textarea + execCommand
   * @private
   */
  _fallbackCopy: function(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (typeof Toast !== 'undefined' && Toast.success) {
        Toast.success('Copied to clipboard');
      }
    } catch (e) {
      if (typeof Toast !== 'undefined' && Toast.error) {
        Toast.error('Failed to copy');
      }
    }
    document.body.removeChild(ta);
  },

  /* ------------------------------------------
     LocalStorage Wrapper — safe get/set/remove
     ------------------------------------------ */

  storage: {
    /**
     * Get a value from localStorage (JSON-parsed)
     * @param {string} key
     * @param {*} [fallback=null] - Default if key doesn't exist
     * @returns {*}
     */
    get: function(key, fallback) {
      if (typeof fallback === 'undefined') fallback = null;
      try {
        var val = localStorage.getItem(key);
        if (val === null) return fallback;
        return JSON.parse(val);
      } catch (e) {
        console.warn('[Utils.storage] Failed to read "' + key + '":', e);
        return fallback;
      }
    },

    /**
     * Save a value to localStorage (JSON-stringified)
     * @param {string} key
     * @param {*} value
     */
    set: function(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn('[Utils.storage] Failed to write "' + key + '":', e);
      }
    },

    /**
     * Remove a key from localStorage
     * @param {string} key
     */
    remove: function(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn('[Utils.storage] Failed to remove "' + key + '":', e);
      }
    }
  },

  /**
   * Initialize utility module
   */
  init: function() {
    console.log('[Utils] Utility functions loaded — v1.0.0');
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { Utils.init(); });
} else {
  Utils.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = Utils;
