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

  /* ------------------------------------------
     Anti-spam (P8c) — honeypot + fill-time
     ------------------------------------------ */

  /**
   * Arm a form with anti-spam instrumentation:
   * - a visually-hidden honeypot input named `website` (humans never see or
   *   fill it; naive bots do). Hidden via off-screen position/clip — NOT
   *   display:none, which many bots skip.
   * - a render timestamp (data-antispam-ts) used to compute `fillMs`
   *   (ms from form render to submit; the server scores <3000ms against).
   * Idempotent — safe to call more than once on the same form.
   * @param {HTMLFormElement} formElement
   */
  armAntiSpam: function (formElement) {
    if (!formElement) return;
    if (!formElement.getAttribute('data-antispam-ts')) {
      formElement.setAttribute('data-antispam-ts', String(Date.now()));
    }
    if (formElement.querySelector('input[name="website"]')) return;
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = 'website';
    hp.value = '';
    hp.autocomplete = 'off';
    hp.tabIndex = -1;
    hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute !important;left:-9999px;top:auto;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;';
    formElement.appendChild(hp);
  },

  /**
   * Read the anti-spam signals from an armed form.
   * @param {HTMLFormElement} formElement
   * @returns {{website: string, fillMs: (number|null)}}
   */
  collectAntiSpam: function (formElement) {
    var out = { website: '', fillMs: null };
    if (!formElement) return out;
    var hp = formElement.querySelector('input[name="website"]');
    if (hp) out.website = String(hp.value || '');
    var ts = parseInt(formElement.getAttribute('data-antispam-ts'), 10);
    if (!isNaN(ts) && ts > 0) out.fillMs = Math.max(0, Date.now() - ts);
    return out;
  },

  /** @type {Object|null} Cached anonymous Supabase client (fallback when Auth._sb is absent) */
  _sbClient: null,

  /**
   * Anonymous-safe Supabase client for the staging write. Prefers the client
   * Auth already created (Auth._sb — created at init for ALL visitors,
   * signed-in or not, when GBE_AUTH_SOURCE==='supabase'). Falls back to a
   * one-off anon-key client (no session persisted, no tokens minted) so the
   * staging write also works if the auth flag is rolled back to 'firebase'.
   * @private
   * @returns {Object|null}
   */
  _getSupabaseClient: function () {
    if (typeof Auth !== 'undefined' && Auth._sb) return Auth._sb;
    if (this._sbClient) return this._sbClient;
    try {
      var cfg = (typeof SiteConfig !== 'undefined' && SiteConfig.integrations)
        ? SiteConfig.integrations.supabase : null;
      if (!cfg || !cfg.url || !cfg.anonKey) return null;
      if (typeof window === 'undefined' || !window.supabase ||
          typeof window.supabase.createClient !== 'function') return null;
      this._sbClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      return this._sbClient;
    } catch (e) {
      return null;
    }
  },

  /**
   * Payload key → Supabase contact_submissions column. camelCase names on the
   * right are REAL (quoted) Postgres columns — deliberate: the SoR pull
   * (supabase-pull.js) copies cache column names verbatim into staging and
   * the intake normalizer reads these exact camelCase wire keys (fillMs,
   * additionalNotes, budgetRange, ...). Keys NOT in this map never become
   * columns (no 42703 risk) — they are preserved in the raw_doc jsonb.
   * @private
   */
  _CS_COLUMNS: {
    formType: 'form_type', inquiryType: 'inquiry_type', eventDate: 'event_date',
    routeTo: 'route_to',
    source: 'source', name: 'name', email: 'email', phone: 'phone',
    subject: 'subject', message: 'message', venue: 'venue', city: 'city',
    organization: 'organization', company: 'company', budget: 'budget',
    timeline: 'timeline', notes: 'notes', website: 'website',
    fillMs: 'fillMs', showCount: 'showCount', projectType: 'projectType',
    eventTime: 'eventTime', eventType: 'eventType', guestCount: 'guestCount',
    performanceFormat: 'performanceFormat', indoorOutdoor: 'indoorOutdoor',
    soundSystem: 'soundSystem', budgetRange: 'budgetRange',
    referralSource: 'referralSource', additionalNotes: 'additionalNotes',
    productionNeeds: 'productionNeeds', loadInDetails: 'loadInDetails'
  },

  /**
   * Submit a contact form payload with fallback strategy:
   * 1. Server API (LAN Express, ports 3000/4000 only) — SQLite queue_records
   *    + inline booking_inbox landing via the intake normalizer
   * 2. Supabase staging write — INSERT into the contact_submissions cache
   *    table (write-only for anonymous visitors: INSERT policy only, no
   *    read-back, no tokens minted). The HomeOffice SoR pull
   *    (supabase-pull → intake-normalizer) lands it in booking_inbox.
   * 3. Legacy Firestore — rollback net ONLY while GBE_AUTH_SOURCE==='firebase'
   *    (D-27 window); never used when the Supabase backend is live.
   * No localStorage fallback — business workflow data must reach the server
   * or a staging store. Silent local saves are invisible to the BM.
   * @param {Object} payload - Form data with at least { formType, email }
   * @param {HTMLFormElement} [formElement] - when provided, anti-spam signals
   *   (honeypot `website`, timing `fillMs`) are collected from the armed form
   *   and merged into the payload (see armAntiSpam).
   * @returns {Promise<{ok: boolean, method: string}>}
   */
  submitContact: function (payload, formElement) {
    var self = this;
    var serverUrl = null;

    // Merge anti-spam signals from the armed form (see armAntiSpam)
    if (formElement) {
      var spam = this.collectAntiSpam(formElement);
      payload.website = spam.website;
      if (spam.fillMs !== null) payload.fillMs = spam.fillMs;
    }

    // Detect LAN server — only use Express API when on port 3000 (or 4000 dev).
    // Port 8111 is http-server (static only, no POST support).
    var port = window.location.port;
    if ((port === '3000' || port === '4000') && typeof Auth !== 'undefined' && Auth.isLocalDashboard && Auth.isLocalDashboard()) {
      serverUrl = window.location.protocol + '//' + window.location.host + '/api/v1/contact';
    }

    // DEF-049: never let DOM elements leak into a store — extract .value.
    function cleanValue(val) {
      if (val && typeof val === 'object' && val.nodeType) return val.value || '';
      return val;
    }

    // JSON-safe clone of the full payload (raw_doc archive / server body).
    function cleanPayload() {
      var out = {};
      for (var k in payload) {
        if (!payload.hasOwnProperty(k)) continue;
        var val = cleanValue(payload[k]);
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          out[k] = val;
        } else if (val && typeof val === 'object') {
          // arrays / plain objects (e.g. multi-show `shows`) — keep if JSON-safe
          try { out[k] = JSON.parse(JSON.stringify(val)); } catch (e) { /* drop */ }
        }
      }
      return out;
    }

    // Strategy 1: Server API (Express on port 3000/4000 only)
    function tryServer() {
      if (!serverUrl) return Promise.reject('not on Express server');
      var serverPayload = cleanPayload();
      serverPayload.submittedAt = new Date().toISOString();
      return fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverPayload)
      }).then(function (res) {
        if (!res.ok) throw new Error('Server returned ' + res.status);
        return { ok: true, method: 'server' };
      });
    }

    // Strategy 2: Supabase staging write (anonymous-safe, INSERT-only).
    // Known payload keys map to real columns; the FULL payload is archived in
    // raw_doc jsonb. No firebase global required (doc-rot fix: this strategy
    // was previously documented as "Firestore" and gated on window.firebase).
    function trySupabaseStaging() {
      var sb = self._getSupabaseClient();
      if (!sb) return Promise.reject('Supabase staging not available');
      var clean = cleanPayload();
      var row = {
        id: 'cs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
        submitted_at: new Date().toISOString(),
        raw_doc: clean
      };
      for (var k in clean) {
        if (!clean.hasOwnProperty(k)) continue;
        var col = self._CS_COLUMNS[k];
        if (!col) continue; // un-columned keys live in raw_doc only
        var val = clean[k];
        if (k === 'shows') continue; // handled below (jsonb column)
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          row[col] = val;
        }
      }
      if (Array.isArray(clean.shows)) {
        row.shows = clean.shows;
        row.showCount = typeof clean.showCount === 'number' ? clean.showCount : clean.shows.length;
      }
      return sb.from('contact_submissions').insert(row).then(function (res) {
        if (res && res.error) throw res.error;
        return { ok: true, method: 'supabase' };
      });
    }

    // Strategy 3: Legacy Firestore — ONLY when the auth backend is Firebase
    // (rollback net through the D-27 window). Uses an ISO timestamp, never
    // the serverTimestamp() sentinel.
    function tryLegacyFirestore() {
      var src = (typeof window !== 'undefined' && window.GBE_AUTH_SOURCE) || 'firebase';
      if (src === 'supabase' || typeof firebase === 'undefined' ||
          typeof Auth === 'undefined' || !Auth._db) {
        return Promise.reject('legacy Firestore not available');
      }
      var fsPayload = {};
      var clean = cleanPayload();
      for (var k in clean) {
        if (clean.hasOwnProperty(k)) {
          var val = clean[k];
          if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
            fsPayload[k] = val;
          }
        }
      }
      fsPayload.submittedAt = new Date().toISOString();
      return Auth._db.collection('contact_submissions').add(fsPayload).then(function () {
        return { ok: true, method: 'firestore' };
      });
    }

    // Try in order: server → Supabase staging → legacy Firestore → fail with
    // a clear message. No localStorage fallback.
    return tryServer()
      .catch(function () { return trySupabaseStaging(); })
      .catch(function (err) {
        if (err && err.message) console.warn('[Forms] Supabase staging write failed:', err.message);
        return tryLegacyFirestore();
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
