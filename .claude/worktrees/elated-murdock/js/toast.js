/* ============================================
   toast.js — Gold Bottom Ent. LLC Toast Notification System
   Version: 1.0.0-prototype
   ============================================ */

const Toast = {

  /** @type {HTMLElement|null} Toast container element */
  container: null,

  /** @type {number} Maximum number of visible toasts */
  maxVisible: 5,

  /** @type {Object} Icon class map per toast type */
  icons: {
    success: 'fa-solid fa-check',
    error: 'fa-solid fa-xmark',
    info: 'fa-solid fa-circle-info',
    warning: 'fa-solid fa-triangle-exclamation'
  },

  /**
   * Show a toast notification
   * @param {string} message - The notification message
   * @param {string} [type='info'] - Toast type: 'success', 'error', 'info', 'warning'
   * @param {number} [duration=4000] - Auto-dismiss duration in milliseconds
   */
  show: function(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;

    if (!this.container) {
      this._createContainer();
    }

    // Enforce max visible — remove oldest if exceeded
    var existing = this.container.querySelectorAll('.toast');
    if (existing.length >= this.maxVisible) {
      this._removeToast(existing[0]);
    }

    // Build toast element
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    // Icon
    var iconEl = document.createElement('i');
    iconEl.className = this.icons[type] || this.icons.info;
    iconEl.classList.add('toast-icon');

    // Message text
    var msgEl = document.createElement('span');
    msgEl.className = 'toast-message';
    msgEl.textContent = message;

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', function() {
      Toast._removeToast(toast);
    });

    // Progress bar
    var progressWrap = document.createElement('div');
    progressWrap.className = 'toast-progress-wrap';
    var progressBar = document.createElement('div');
    progressBar.className = 'toast-progress toast-progress-' + type;
    progressBar.style.animationDuration = duration + 'ms';
    progressWrap.appendChild(progressBar);

    // Assemble
    toast.appendChild(iconEl);
    toast.appendChild(msgEl);
    toast.appendChild(closeBtn);
    toast.appendChild(progressWrap);

    // Append and animate in
    this.container.appendChild(toast);

    // Force reflow for animation
    toast.offsetHeight;
    toast.classList.add('toast-visible');

    // Auto-dismiss
    var dismissTimer = setTimeout(function() {
      Toast._removeToast(toast);
    }, duration);

    // Store timer reference so close button can clear it
    toast._dismissTimer = dismissTimer;
  },

  /**
   * Show a success toast
   * @param {string} message
   */
  success: function(message) {
    this.show(message, 'success');
  },

  /**
   * Show an error toast
   * @param {string} message
   */
  error: function(message) {
    this.show(message, 'error');
  },

  /**
   * Show an info toast
   * @param {string} message
   */
  info: function(message) {
    this.show(message, 'info');
  },

  /**
   * Show a warning toast
   * @param {string} message
   */
  warning: function(message) {
    this.show(message, 'warning');
  },

  /**
   * Remove a toast element with slide-out animation
   * @param {HTMLElement} toast
   * @private
   */
  _removeToast: function(toast) {
    if (!toast || !toast.parentNode) return;

    // Clear auto-dismiss timer
    if (toast._dismissTimer) {
      clearTimeout(toast._dismissTimer);
    }

    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');

    setTimeout(function() {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  },

  /**
   * Create the toast container element if it does not exist
   * @private
   */
  _createContainer: function() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    }

    // Inject styles if not already present
    if (!document.getElementById('toast-styles')) {
      var style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = this._getStyles();
      document.head.appendChild(style);
    }
  },

  /**
   * Return the CSS styles for toast notifications
   * @returns {string}
   * @private
   */
  _getStyles: function() {
    return '' +
      '#toast-container {' +
      '  position: fixed; top: 20px; right: 20px; z-index: 10000;' +
      '  display: flex; flex-direction: column; gap: 10px;' +
      '  pointer-events: none; max-width: 400px; width: 100%;' +
      '}' +
      '.toast {' +
      '  display: flex; align-items: center; gap: 12px;' +
      '  padding: 14px 18px; border-radius: 10px;' +
      '  background: #1a1a2e; color: #fff;' +
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.3);' +
      '  pointer-events: all; position: relative; overflow: hidden;' +
      '  transform: translateX(120%); opacity: 0;' +
      '  transition: transform 0.35s cubic-bezier(0.21,1.02,0.73,1), opacity 0.35s ease;' +
      '  font-family: "Inter", "Segoe UI", sans-serif; font-size: 14px;' +
      '}' +
      '.toast-visible {' +
      '  transform: translateX(0); opacity: 1;' +
      '}' +
      '.toast-exit {' +
      '  transform: translateX(120%); opacity: 0;' +
      '}' +
      '.toast-icon { font-size: 18px; flex-shrink: 0; }' +
      '.toast-message { flex: 1; line-height: 1.4; }' +
      '.toast-close {' +
      '  background: none; border: none; color: rgba(255,255,255,0.5);' +
      '  cursor: pointer; font-size: 14px; padding: 4px; flex-shrink: 0;' +
      '  transition: color 0.2s;' +
      '}' +
      '.toast-close:hover { color: #fff; }' +
      '.toast-progress-wrap {' +
      '  position: absolute; bottom: 0; left: 0; right: 0; height: 3px;' +
      '  background: rgba(255,255,255,0.1);' +
      '}' +
      '.toast-progress {' +
      '  height: 100%; width: 100%;' +
      '  animation: toastProgress linear forwards;' +
      '  transform-origin: left;' +
      '}' +
      '@keyframes toastProgress {' +
      '  from { transform: scaleX(1); }' +
      '  to { transform: scaleX(0); }' +
      '}' +
      /* Type-specific colors */
      '.toast-success { border-left: 4px solid #00c853; }' +
      '.toast-success .toast-icon { color: #00c853; }' +
      '.toast-progress-success { background: #00c853; }' +
      '.toast-error { border-left: 4px solid #ff1744; }' +
      '.toast-error .toast-icon { color: #ff1744; }' +
      '.toast-progress-error { background: #ff1744; }' +
      '.toast-info { border-left: 4px solid #2979ff; }' +
      '.toast-info .toast-icon { color: #2979ff; }' +
      '.toast-progress-info { background: #2979ff; }' +
      '.toast-warning { border-left: 4px solid #ffc107; }' +
      '.toast-warning .toast-icon { color: #ffc107; }' +
      '.toast-progress-warning { background: #ffc107; }' +
      /* Responsive */
      '@media (max-width: 480px) {' +
      '  #toast-container { top: 10px; right: 10px; left: 10px; max-width: none; }' +
      '}';
  },

  /**
   * Initialize the toast system
   */
  init: function() {
    this._createContainer();
    console.log('[Toast] Notification system ready');
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { Toast.init(); });
} else {
  Toast.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = Toast;
