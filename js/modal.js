/* ============================================
   modal.js — Gold Bottom Ent. LLC Reusable Modal System
   Version: 1.0.0-prototype
   ============================================ */

const Modal = {

  /** @type {HTMLElement|null} The overlay element */
  overlay: null,

  /** @type {boolean} Whether a modal is currently open */
  isOpen: false,

  /** @type {Object|null} Current modal options */
  _currentOptions: null,

  /** @type {Object} Size presets in pixels */
  sizes: {
    sm: 400,
    md: 560,
    lg: 720
  },

  /**
   * Open a modal dialog
   * @param {Object} options
   * @param {string} [options.title=''] - Modal title
   * @param {string} [options.content=''] - Modal body content (HTML string)
   * @param {string} [options.size='md'] - Size: 'sm', 'md', or 'lg'
   * @param {string} [options.saveText='Save'] - Save/confirm button text
   * @param {string} [options.cancelText='Cancel'] - Cancel button text
   * @param {Function} [options.onSave] - Callback when save is clicked
   * @param {Function} [options.onCancel] - Callback when cancel is clicked
   * @param {boolean} [options.showFooter=true] - Whether to show the footer buttons
   */
  open: function(options) {
    options = options || {};
    this._currentOptions = options;

    var title = options.title || '';
    var content = options.content || '';
    var size = options.size || 'md';
    var saveText = options.saveText || 'Save';
    var cancelText = options.cancelText || 'Cancel';
    var showFooter = options.showFooter !== undefined ? options.showFooter : true;
    var maxWidth = this.sizes[size] || this.sizes.md;

    // Ensure overlay exists
    this._ensureOverlay();

    // Clear any existing content
    this.overlay.innerHTML = '';

    // Build modal content wrapper
    var modalContent = document.createElement('div');
    modalContent.className = 'modal-content modal-size-' + size;
    modalContent.style.maxWidth = maxWidth + 'px';

    // --- Header ---
    var header = document.createElement('div');
    header.className = 'modal-header';

    var titleEl = document.createElement('h3');
    titleEl.className = 'modal-title';
    titleEl.textContent = title;

    var closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close modal');
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', function() {
      Modal.close();
      if (options.onCancel) options.onCancel();
    });

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // --- Body ---
    var body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = content;

    // --- Footer ---
    var footer = null;
    if (showFooter) {
      footer = document.createElement('div');
      footer.className = 'modal-footer';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'modal-btn modal-btn-cancel';
      cancelBtn.type = 'button';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', function() {
        Modal.close();
        if (options.onCancel) options.onCancel();
      });

      var saveBtn = document.createElement('button');
      saveBtn.className = 'modal-btn modal-btn-save';
      saveBtn.type = 'button';
      saveBtn.textContent = saveText;
      saveBtn.addEventListener('click', function() {
        if (options.onSave) options.onSave();
        Modal.close();
      });

      footer.appendChild(cancelBtn);
      footer.appendChild(saveBtn);
    }

    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(body);
    if (footer) modalContent.appendChild(footer);

    this.overlay.appendChild(modalContent);

    // Prevent clicks inside modal from closing it
    modalContent.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    // Show overlay
    this.overlay.classList.add('modal-active');
    this.isOpen = true;

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Animate in after next frame
    requestAnimationFrame(function() {
      modalContent.classList.add('modal-content-visible');
    });

    // Bind ESC key
    this._boundEscHandler = this._handleEsc.bind(this);
    document.addEventListener('keydown', this._boundEscHandler);
  },

  /**
   * Close the currently open modal
   */
  close: function() {
    if (!this.overlay || !this.isOpen) return;

    var content = this.overlay.querySelector('.modal-content');
    if (content) {
      content.classList.remove('modal-content-visible');
      content.classList.add('modal-content-exit');
    }

    this.overlay.classList.remove('modal-active');
    this.overlay.classList.add('modal-closing');
    this.isOpen = false;

    // Restore body scroll
    document.body.style.overflow = '';

    // Remove ESC listener
    if (this._boundEscHandler) {
      document.removeEventListener('keydown', this._boundEscHandler);
      this._boundEscHandler = null;
    }

    // Clean up after animation
    setTimeout(function() {
      if (Modal.overlay) {
        Modal.overlay.classList.remove('modal-closing');
        Modal.overlay.innerHTML = '';
      }
      Modal._currentOptions = null;
    }, 300);
  },

  /**
   * Show a confirmation dialog
   * @param {string} message - Confirmation message
   * @param {Function} [onConfirm] - Called if user confirms
   * @param {Function} [onCancel] - Called if user cancels
   */
  confirm: function(message, onConfirm, onCancel) {
    this.open({
      title: 'Confirm',
      content: '<p style="margin:0;line-height:1.6;">' + message + '</p>',
      size: 'sm',
      saveText: 'Confirm',
      cancelText: 'Cancel',
      onSave: onConfirm || function() {},
      onCancel: onCancel || function() {}
    });
  },

  /**
   * Show a simple alert dialog
   * @param {string} title - Alert title
   * @param {string} message - Alert message
   */
  alert: function(title, message) {
    this.open({
      title: title,
      content: '<p style="margin:0;line-height:1.6;">' + message + '</p>',
      size: 'sm',
      saveText: 'OK',
      showFooter: true,
      onSave: function() {},
      onCancel: function() {}
    });

    // Hide the cancel button for alert dialogs
    var cancelBtn = this.overlay.querySelector('.modal-btn-cancel');
    if (cancelBtn) cancelBtn.style.display = 'none';
  },

  /**
   * Handle ESC key press to close modal
   * @param {KeyboardEvent} e
   * @private
   */
  _handleEsc: function(e) {
    if (e.key === 'Escape' && Modal.isOpen) {
      Modal.close();
      if (Modal._currentOptions && Modal._currentOptions.onCancel) {
        Modal._currentOptions.onCancel();
      }
    }
  },

  /**
   * Ensure the overlay element exists in the DOM
   * @private
   */
  _ensureOverlay: function() {
    this.overlay = document.getElementById('modal-overlay');
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.id = 'modal-overlay';
      this.overlay.className = 'modal-overlay';
      document.body.appendChild(this.overlay);
    }

    // Backdrop click closes modal
    this.overlay.addEventListener('click', function(e) {
      if (e.target === Modal.overlay && Modal.isOpen) {
        Modal.close();
        if (Modal._currentOptions && Modal._currentOptions.onCancel) {
          Modal._currentOptions.onCancel();
        }
      }
    });

    // Inject styles if not already present
    if (!document.getElementById('modal-styles')) {
      var style = document.createElement('style');
      style.id = 'modal-styles';
      style.textContent = this._getStyles();
      document.head.appendChild(style);
    }
  },

  /**
   * Return the CSS styles for the modal system
   * @returns {string}
   * @private
   */
  _getStyles: function() {
    return '' +
      '.modal-overlay {' +
      '  position: fixed; top: 0; left: 0; right: 0; bottom: 0;' +
      '  background: rgba(0, 0, 0, 0); z-index: 9999;' +
      '  display: none; align-items: center; justify-content: center;' +
      '  padding: 20px;' +
      '  transition: background 0.3s ease;' +
      '}' +
      '.modal-overlay.modal-active {' +
      '  display: flex; background: rgba(0, 0, 0, 0.6);' +
      '}' +
      '.modal-overlay.modal-closing {' +
      '  display: flex; background: rgba(0, 0, 0, 0);' +
      '}' +
      '.modal-content {' +
      '  background: #1a1a2e; color: #e0e0e0; border-radius: 14px;' +
      '  width: 100%; position: relative; overflow: hidden;' +
      '  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);' +
      '  transform: scale(0.85); opacity: 0;' +
      '  transition: transform 0.3s cubic-bezier(0.21,1.02,0.73,1), opacity 0.3s ease;' +
      '  font-family: "Inter", "Segoe UI", sans-serif;' +
      '}' +
      '.modal-content-visible {' +
      '  transform: scale(1); opacity: 1;' +
      '}' +
      '.modal-content-exit {' +
      '  transform: scale(0.85); opacity: 0;' +
      '}' +
      '.modal-header {' +
      '  display: flex; align-items: center; justify-content: space-between;' +
      '  padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.08);' +
      '}' +
      '.modal-title {' +
      '  margin: 0; font-size: 18px; font-weight: 600; color: #fff;' +
      '}' +
      '.modal-close {' +
      '  background: none; border: none; color: rgba(255,255,255,0.4);' +
      '  font-size: 18px; cursor: pointer; padding: 6px 8px; border-radius: 6px;' +
      '  transition: color 0.2s, background 0.2s;' +
      '}' +
      '.modal-close:hover {' +
      '  color: #fff; background: rgba(255,255,255,0.1);' +
      '}' +
      '.modal-body {' +
      '  padding: 24px; font-size: 14px; line-height: 1.6;' +
      '  max-height: 60vh; overflow-y: auto;' +
      '}' +
      '.modal-footer {' +
      '  display: flex; justify-content: flex-end; gap: 10px;' +
      '  padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.08);' +
      '}' +
      '.modal-btn {' +
      '  padding: 10px 22px; border-radius: 8px; font-size: 14px;' +
      '  font-weight: 500; cursor: pointer; border: none;' +
      '  transition: background 0.2s, transform 0.1s;' +
      '  font-family: inherit;' +
      '}' +
      '.modal-btn:active { transform: scale(0.97); }' +
      '.modal-btn-cancel {' +
      '  background: rgba(255,255,255,0.08); color: #bbb;' +
      '}' +
      '.modal-btn-cancel:hover {' +
      '  background: rgba(255,255,255,0.14); color: #fff;' +
      '}' +
      '.modal-btn-save {' +
      '  background: linear-gradient(135deg, #d4af37, #b8962e);' +
      '  color: #000; font-weight: 600;' +
      '}' +
      '.modal-btn-save:hover {' +
      '  background: linear-gradient(135deg, #e0c04a, #c9a63a);' +
      '}' +
      /* Responsive */
      '@media (max-width: 480px) {' +
      '  .modal-overlay { padding: 10px; }' +
      '  .modal-content { border-radius: 10px; }' +
      '  .modal-header { padding: 16px 18px; }' +
      '  .modal-body { padding: 18px; max-height: 50vh; }' +
      '  .modal-footer { padding: 12px 18px; }' +
      '}';
  },

  /**
   * Initialize the modal system
   */
  init: function() {
    this._ensureOverlay();
    console.log('[Modal] Modal system ready');
  }
};

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { Modal.init(); });
} else {
  Modal.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = Modal;
