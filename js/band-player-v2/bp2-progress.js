/* ============================================
   bp2-progress.js — Resumable Stem Processing Progress
   Band Player v2.0

   Progress pill per songId. Persists to localStorage.
   Retry button on failure.

   WHO CALLS IT:
     - bp2-stems.js feeds updates
   ============================================ */
(function(global) {
  'use strict';

  var PREFIX = 'bp2-prog-v1-';
  var _state = {};
  var _hosts = {};
  var _retryHandlers = {};

  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function _persist(songId) {
    try {
      if (!global.localStorage) return;
      var p = _state[songId];
      if (!p) { global.localStorage.removeItem(PREFIX + songId); return; }
      global.localStorage.setItem(PREFIX + songId, JSON.stringify(p));
    } catch (e) {}
  }

  function _hydrate(songId) {
    try {
      if (!global.localStorage) return null;
      var raw = global.localStorage.getItem(PREFIX + songId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _labelFor(status, pct) {
    if (status === 'queued') return 'Queued';
    if (status === 'separating') return 'Separating \u2014 ' + pct + '%';
    if (status === 'processing') return 'Working \u2014 ' + pct + '%';
    if (status === 'detecting') return 'Detecting instruments\u2026';
    if (status === 'charting') return 'Generating charts\u2026';
    if (status === 'complete') return 'Done \u2014 stems ready';
    if (status === 'error' || status === 'failed') return 'Something went wrong';
    return 'Working\u2026';
  }

  function _render(songId) {
    var host = _hosts[songId];
    if (!host) return;
    var s = _state[songId];
    if (!s) { host.innerHTML = ''; return; }

    var status = s.status || 'queued';
    var pct = typeof s.progress === 'number' ? Math.max(0, Math.min(100, s.progress)) : 0;
    var label = s.humanStage || _labelFor(status, pct);
    var isFailed = status === 'error' || status === 'failed';
    var isDone = status === 'complete' || pct >= 100;

    host.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:8px;background:' + (isFailed ? 'rgba(255,23,68,0.08)' : isDone ? 'rgba(0,230,118,0.08)' : 'rgba(68,138,255,0.08)') + ';border:1px solid ' + (isFailed ? 'rgba(255,23,68,0.2)' : isDone ? 'rgba(0,230,118,0.2)' : 'rgba(68,138,255,0.2)') + ';margin:4px 0;">' +
        '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;">' +
          '<span style="flex:1;">' + _esc(label) + '</span>' +
          '<span style="font-variant-numeric:tabular-nums;font-size:11px;opacity:0.6;">' + pct + '%</span>' +
        '</div>' +
        (isFailed ? '' :
          '<div style="height:3px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;">' +
            '<div style="height:100%;width:' + pct + '%;background:' + (isDone ? '#00e676' : '#448aff') + ';transition:width 0.3s ease;"></div>' +
          '</div>') +
        (isFailed ? '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px;">' + _esc(s.error || 'Failed') + '</div>' : '') +
      '</div>';
  }

  var BP2Progress = {
    attach: function(songId, hostEl, onRetry) {
      if (!songId || !hostEl) return;
      _hosts[songId] = hostEl;
      if (typeof onRetry === 'function') _retryHandlers[songId] = onRetry;
      if (!_state[songId]) {
        var restored = _hydrate(songId);
        if (restored) _state[songId] = restored;
      }
      _render(songId);
    },

    detach: function(songId) { delete _hosts[songId]; delete _retryHandlers[songId]; },

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

    clear: function(songId) { delete _state[songId]; _persist(songId); _render(songId); },
    _resetAll: function() { _state = {}; _hosts = {}; _retryHandlers = {}; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Progress;
  else if (global) global.BP2Progress = BP2Progress;
})(typeof window !== 'undefined' ? window : this);
