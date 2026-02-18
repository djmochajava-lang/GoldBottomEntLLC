// js/forms.js

/**
 * Forms Module — Form Validation & Handling
 * Provides validation, data extraction, population, error display,
 * and real-time validation on blur/input events.
 */

const Forms = {

  /**
   * Initialize — scan current page for forms with [data-validate]
   * and attach real-time validation listeners.
   */
  init: function () {
    var forms = document.querySelectorAll('form[data-validate]');
    for (var i = 0; i < forms.length; i++) {
      this.initValidation(forms[i]);
    }
    console.log('Forms initialized');
  },

  /**
   * Validate all inputs in a form element.
   * Checks: required, email pattern, min/max (numbers), minlength/maxlength.
   * @param {HTMLFormElement} formElement
   * @returns {{ valid: boolean, errors: Array<{field: string, message: string}> }}
   */
  validate: function (formElement) {
    if (!formElement) return { valid: false, errors: [{ field: '', message: 'Form element not found' }] };

    this.clearErrors(formElement);

    var errors = [];
    var inputs = formElement.querySelectorAll('input, select, textarea');

    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var fieldErrors = this._validateField(input);

      for (var e = 0; e < fieldErrors.length; e++) {
        errors.push(fieldErrors[e]);
        this.showError(input, fieldErrors[e].message);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  },

  /**
   * Validate a single field and return array of error objects.
   * @param {HTMLElement} input
   * @returns {Array<{field: string, message: string}>}
   */
  _validateField: function (input) {
    var errors = [];
    var name = input.name || input.id || '';
    var value = (input.value || '').trim();
    var type = (input.type || '').toLowerCase();

    // Required check
    if (input.hasAttribute('required') && !value) {
      var label = this._getFieldLabel(input);
      errors.push({ field: name, message: label + ' is required.' });
      return errors; // Skip further checks if empty and required
    }

    // Skip further validation if field is empty and not required
    if (!value) return errors;

    // Email pattern check
    if (type === 'email' || input.hasAttribute('data-type-email')) {
      var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(value)) {
        errors.push({ field: name, message: 'Please enter a valid email address.' });
      }
    }

    // Min / Max for number inputs
    if (type === 'number' || type === 'range') {
      var numVal = parseFloat(value);
      if (input.hasAttribute('min')) {
        var min = parseFloat(input.getAttribute('min'));
        if (!isNaN(min) && numVal < min) {
          errors.push({ field: name, message: 'Value must be at least ' + min + '.' });
        }
      }
      if (input.hasAttribute('max')) {
        var max = parseFloat(input.getAttribute('max'));
        if (!isNaN(max) && numVal > max) {
          errors.push({ field: name, message: 'Value must be no more than ' + max + '.' });
        }
      }
    }

    // Minlength
    if (input.hasAttribute('minlength')) {
      var minLen = parseInt(input.getAttribute('minlength'), 10);
      if (!isNaN(minLen) && value.length < minLen) {
        errors.push({ field: name, message: 'Must be at least ' + minLen + ' characters.' });
      }
    }

    // Maxlength
    if (input.hasAttribute('maxlength')) {
      var maxLen = parseInt(input.getAttribute('maxlength'), 10);
      if (!isNaN(maxLen) && value.length > maxLen) {
        errors.push({ field: name, message: 'Must be no more than ' + maxLen + ' characters.' });
      }
    }

    return errors;
  },

  /**
   * Get a human-readable label for a form field.
   * @param {HTMLElement} input
   * @returns {string}
   */
  _getFieldLabel: function (input) {
    // Check for associated <label>
    if (input.id) {
      var label = document.querySelector('label[for="' + input.id + '"]');
      if (label) return label.textContent.trim().replace(/[*:]+$/, '');
    }

    // Check for parent label
    var parentLabel = input.closest('label');
    if (parentLabel) {
      var text = parentLabel.textContent.trim().replace(/[*:]+$/, '');
      // Truncate if label wraps the input (text includes input value)
      if (text.length > 50) text = text.substring(0, 50);
      return text;
    }

    // Fallback to placeholder, name, or generic
    return input.placeholder || input.name || 'This field';
  },

  /**
   * Extract all form data as a plain object.
   * @param {HTMLFormElement} formElement
   * @returns {Object}
   */
  getData: function (formElement) {
    if (!formElement) return {};

    var data = {};
    var formData = new FormData(formElement);
    var entries = formData.entries();
    var entry = entries.next();

    while (!entry.done) {
      var key = entry.value[0];
      var val = entry.value[1];

      // Handle multiple values (e.g., checkboxes with same name)
      if (data.hasOwnProperty(key)) {
        if (!Array.isArray(data[key])) {
          data[key] = [data[key]];
        }
        data[key].push(val);
      } else {
        data[key] = val;
      }

      entry = entries.next();
    }

    return data;
  },

  /**
   * Populate form fields from a data object.
   * @param {HTMLFormElement} formElement
   * @param {Object} data - Key/value pairs matching field names
   */
  setData: function (formElement, data) {
    if (!formElement || !data) return;

    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = data[key];
      var elements = formElement.elements[key];

      if (!elements) continue;

      // Handle NodeList (radio buttons, etc.)
      if (elements.length !== undefined && elements.tagName === undefined) {
        for (var r = 0; r < elements.length; r++) {
          var el = elements[r];
          if (el.type === 'radio') {
            el.checked = (el.value === String(value));
          } else if (el.type === 'checkbox') {
            el.checked = Array.isArray(value)
              ? value.indexOf(el.value) !== -1
              : el.value === String(value);
          }
        }
      } else {
        // Single element
        var field = elements;
        if (field.type === 'checkbox') {
          field.checked = !!value;
        } else if (field.type === 'radio') {
          field.checked = (field.value === String(value));
        } else if (field.tagName === 'SELECT') {
          field.value = String(value);
        } else {
          field.value = value !== null && value !== undefined ? String(value) : '';
        }
      }
    }
  },

  /**
   * Reset a form to its default state and clear errors.
   * @param {HTMLFormElement} formElement
   */
  reset: function (formElement) {
    if (!formElement) return;
    formElement.reset();
    this.clearErrors(formElement);
  },

  /**
   * Display an error for a specific input field.
   * Adds .form-input-error class and a .form-error-message span below the input.
   * @param {HTMLElement} inputElement
   * @param {string} message
   */
  showError: function (inputElement, message) {
    if (!inputElement) return;

    // Add error class to input
    inputElement.classList.add('form-input-error');

    // Check if error message span already exists for this input
    var existingError = inputElement.parentNode.querySelector('.form-error-message[data-for="' + (inputElement.name || inputElement.id) + '"]');
    if (existingError) {
      existingError.textContent = message;
      return;
    }

    // Create error message span
    var errorSpan = document.createElement('span');
    errorSpan.className = 'form-error-message';
    errorSpan.setAttribute('data-for', inputElement.name || inputElement.id || '');
    errorSpan.textContent = message;

    // Insert after the input (or its wrapper if inside a form-group)
    if (inputElement.nextSibling) {
      inputElement.parentNode.insertBefore(errorSpan, inputElement.nextSibling);
    } else {
      inputElement.parentNode.appendChild(errorSpan);
    }
  },

  /**
   * Clear all error indicators from a form.
   * @param {HTMLFormElement} formElement
   */
  clearErrors: function (formElement) {
    if (!formElement) return;

    // Remove error classes
    var errorInputs = formElement.querySelectorAll('.form-input-error');
    for (var i = 0; i < errorInputs.length; i++) {
      errorInputs[i].classList.remove('form-input-error');
    }

    // Remove error message spans
    var errorMessages = formElement.querySelectorAll('.form-error-message');
    for (var m = 0; m < errorMessages.length; m++) {
      errorMessages[m].parentNode.removeChild(errorMessages[m]);
    }
  },

  /**
   * Initialize real-time validation on a form.
   * Attaches blur and input event listeners for immediate feedback.
   * @param {HTMLFormElement} formElement
   */
  initValidation: function (formElement) {
    if (!formElement) return;

    var self = this;

    // Mark as initialized to prevent duplicates
    if (formElement.getAttribute('data-validation-init') === 'true') return;
    formElement.setAttribute('data-validation-init', 'true');

    var inputs = formElement.querySelectorAll('input, select, textarea');

    for (var i = 0; i < inputs.length; i++) {
      (function (input) {
        // Validate on blur
        input.addEventListener('blur', function () {
          self._clearFieldError(input);
          var fieldErrors = self._validateField(input);
          for (var e = 0; e < fieldErrors.length; e++) {
            self.showError(input, fieldErrors[e].message);
          }
        });

        // Clear error on input (while typing)
        input.addEventListener('input', function () {
          self._clearFieldError(input);
        });
      })(inputs[i]);
    }

    // Prevent default submission and validate
    formElement.addEventListener('submit', function (e) {
      var result = self.validate(formElement);
      if (!result.valid) {
        e.preventDefault();
        // Focus the first errored field
        var firstError = formElement.querySelector('.form-input-error');
        if (firstError) firstError.focus();

        if (typeof Toast !== 'undefined') {
          Toast.error('Please fix the errors before submitting.');
        }
      }
    });
  },

  /**
   * Clear error indicators for a single field.
   * @param {HTMLElement} input
   */
  _clearFieldError: function (input) {
    if (!input) return;

    input.classList.remove('form-input-error');

    var fieldId = input.name || input.id || '';
    var errorSpan = input.parentNode.querySelector('.form-error-message[data-for="' + fieldId + '"]');
    if (errorSpan) {
      errorSpan.parentNode.removeChild(errorSpan);
    }
  }
};

// Auto-initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { if (Forms.init) Forms.init(); });
} else {
  if (Forms.init) Forms.init();
}

if (typeof module !== 'undefined' && module.exports) module.exports = Forms;
