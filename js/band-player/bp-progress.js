/* ============================================
   bp-progress.js — Resumable stem-separation progress UI
   FRD-20 FR-4.2.3 + FR-4.2.4 + FR-4.9.1

   Two responsibilities:
     1. **Resumable** — progress state is persisted per songId to localStorage
        on every update so reopening the browser shows the latest known stage
        instead of "queued 0%".
     2. **Mobile sticky-bar pill** — renders a thumb-reachable progress pill
        in a user-supplied host element. Respects safe-area insets, 44px hit
        target on retry, cancellable pollers.

   Pure state + render. Polling is owned by whatever watches Firestore /
   the progress API — BPProgress just consumes `update(songId, payload)` calls.

   Consumed payload (from Firestore stem-requests/{songId}):
     {
       status: 'queued' | 'processing' | 'separating' | ...
       progress: 0..100,
       humanStage: 'Separating stems — ...',
       error?: 'user-safe message',
       traceId?: '...'
     }
   ============================================ */
(function(global) {
  'use strict';

  var STORAGE_PREFIX = 'bp-prog-v1-';

  var _state = {};        // songId → payload
  var _hosts = {};        // songId → hostElement
  var _retryHandlers = {}; // songId → fn to call on retry click

  function _escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _storageKey(songId) { return STORAGE_PREFIX + songId; }

  function _persist(songId) {
    try {
      if (!global.localStorage) return;
      var payload = _state[songId];
      if (!payload) {
        global.localStorage.removeItem(_storageKey(songId));
        return;
      }
      global.localStorage.setItem(_storageKey(songId), JSON.stringify(payload));
    } catch (e) { /* quota exceeded or storage disabled */ }
  }

  function _hydrate(songId) {
    try {
      if (!global.localStorage) return null;
      var raw = global.localStorage.getItem(_storageKey(songId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _render(songId) {
    var host = _hosts[songId];
    if (!host) return;
    var s = _state[songId];
    if (!s) { host.innerHTML = ''; return; }

    var status = s.status || 'queued';
    var pct = typeof s.progress === 'number' ? Math.max(0, Math.min(100, s.progress)) : 0;
    var label = s.humanStage || _defaultLabelFor(status, pct);
    var isFailed = status === 'error' || status === 'failed';
    var isDone = status === 'complete' || pct >= 100;

    var errHtml = '';
    if (isFailed) {
      errHtml =
        '<div class="bp-prog-error">' + _escape(s.error || 'Separation failed') + '</div>' +
        '<button class="bp-prog-retry" data-role="retry" aria-label="Retry stem separation">' +
          '<i class="fa-solid fa-rotate-right"></i><span>Try again</span>' +
        '</button>';
    }

    var iconClass =
      isDone   ? 'fa-circle-check'
    : isFailed ? 'fa-circle-exclamation'
    : pct === 0 ? 'fa-clock'
    :            'fa-waveform-lines fa-spin';

    host.innerHTML =
      '<div class="bp-prog-pill ' + (isFailed ? 'is-error' : (isDone ? 'is-done' : 'is-active')) + '">' +
        '<div class="bp-prog-header">' +
          '<i class="fa-solid ' + iconClass + '" aria-hidden="true"></i>' +
          '<span class="bp-prog-label">' + _escape(label) + '</span>' +
          '<span class="bp-prog-pct" aria-hidden="true">' + pct + '%</span>' +
        '</div>' +
        (isFailed ? '' :
          '<div class="bp-prog-bar" role="progressbar" aria-valuenow="' + pct +
          '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="bp-prog-fill" style="width:' + pct + '%"></div></div>') +
        errHtml +
      '</div>';
  }

  function _defaultLabelFor(status, pct) {
    if (status === 'queued')      return 'Queued — waiting to start';
    if (status === 'separating')  return 'Separating stems — ' + pct + '%';
    if (status === 'processing')  return 'Working — ' + pct + '%';
    if (status === 'detecting')   return 'Detecting instruments…';
    if (status === 'charting')    return 'Generating charts…';
    if (status === 'complete')    return 'Done — stems ready';
    if (status === 'error' || status === 'failed') return 'Something went wrong';
    return 'Working…';
  }

  function _attachRetryHandler(host, songId) {
    host.addEventListener('click', function(evt) {
      var t = evt.target && evt.target.closest && evt.target.closest('[data-role="retry"]');
      if (!t) return;
      evt.preventDefault();
      var fn = _retryHandlers[songId];
      if (typeof fn === 'function') {
        t.disabled = true;
        Promise.resolve().then(fn).catch(function(e) {
          console.warn('[BPProgress] retry failed:', e && e.message);
        }).then(function() {
          t.disabled = false;
        });
      }
    });
  }

  var BPProgress = {
    /**
     * Attach a host element to a songId. The module will render into it on
     * every `update()` for that songId. Pass `onRetry` to supply a callback
     * that fires when the user taps Try Again after a failure.
     *
     * Idempotent — re-attaching replaces the previous host.
     */
    attach: function(songId, hostElement, onRetry) {
      if (!songId || !hostElement) throw new Error('attach requires songId + hostElement');
      _hosts[songId] = hostElement;
      if (typeof onRetry === 'function') _retryHandlers[songId] = onRetry;
      _attachRetryHandler(hostElement, songId);

      // Hydrate state from localStorage if we don't already have in-memory
      if (!_state[songId]) {
        var restored = _hydrate(songId);
        if (restored) _state[songId] = restored;
      }
      _render(songId);
    },

    detach: function(songId) {
      delete _hosts[songId];
      delete _retryHandlers[songId];
    },

    /**
     * Record the latest progress payload from Firestore / polling.
     */
    update: function(songId, payload) {
      if (!songId) return;
      if (!payload) { delete _state[songId]; _persist(songId); _render(songId); return; }
      var prev = _state[songId] || {};
      _state[songId] = {
        status: payload.status || prev.status || 'queued',
        progress: typeof payload.progress === 'number' ? payload.progress : (prev.progress || 0),
        humanStage: payload.humanStage || prev.humanStage,
        error: payload.error,
        traceId: payload.traceId || prev.traceId,
        updatedAt: Date.now()
      };
      _persist(songId);
      _render(songId);
    },

    getState: function(songId) {
      if (_state[songId]) return Object.assign({}, _state[songId]);
      var restored = _hydrate(songId);
      return restored ? Object.assign({}, restored) : null;
    },

    clear: function(songId) {
      delete _state[songId];
      _persist(songId);
      _render(songId);
    },

    // Test hooks
    _resetAll: function() {
      _state = {};
      _hosts = {};
      _retryHandlers = {};
    },
    _escape: _escape
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BPProgress;
  } else if (global) {
    global.BPProgress = BPProgress;
  }
})(typeof window !== 'undefined' ? window : this);
