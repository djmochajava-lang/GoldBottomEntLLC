/* ============================================
   build-tag.js — visible build stamp + session association (stale-cache diagnostic)
   Reads window.GBE_BUILD (from the auto-generated js/build.js) and:
     1) renders an unobtrusive, tap-to-copy "build <id>" tag in the corner of
        the dashboard + band player (only on authenticated/dashboard views);
     2) associates the running build id with the session (localStorage
        diagnostics) so "who / what session / what build" all correlate when
        troubleshooting a stale cache.
   No secrets: the build id is a git short-sha + date only.
   ============================================ */
(function (global) {
  'use strict';

  var BUILD = global.GBE_BUILD || 'unknown';

  // ── Session association ──────────────────────────────────────────────────
  // Record the build the CURRENT session is actually running. If it differs
  // from a previously-recorded build for this browser, that's a stale-cache /
  // just-updated signal worth surfacing in diagnostics.
  try {
    var KEY = 'gbe-diag-session';
    var prev = null;
    try { prev = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    var diag = {
      build: BUILD,
      prevBuild: prev && prev.build && prev.build !== BUILD ? prev.build : (prev ? prev.prevBuild : null),
      firstSeen: (prev && prev.firstSeen) || new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      userAgent: (global.navigator && navigator.userAgent) || ''
    };
    localStorage.setItem(KEY, JSON.stringify(diag));
    global.GBE_DIAG = diag; // expose for the console / auth session context
  } catch (e) { /* localStorage may be unavailable (private mode edge) — non-fatal */ }

  // ── Nav-trail recorder (diagnostic) ──────────────────────────────────────
  // Router calls window.GBE_recordNav(page, source, from) on every navigateTo.
  // We keep a small capped ring in the session diag so ONE owner repro captures
  // the exact sequence (queued band-player -> auth-ready nav -> any override).
  // Route names + timestamps only — no PII.
  global.GBE_recordNav = function (page, source, from) {
    try {
      var K = 'gbe-diag-session';
      var rec = null;
      try { rec = JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) {}
      if (!rec) rec = {};
      if (!Array.isArray(rec.navTrail)) rec.navTrail = [];
      rec.navTrail.push({ t: new Date().toISOString(), to: String(page || ''), src: String(source || ''), from: String(from || '') });
      if (rec.navTrail.length > 25) rec.navTrail = rec.navTrail.slice(-25); // cap
      rec.build = rec.build || BUILD;
      localStorage.setItem(K, JSON.stringify(rec));
      global.GBE_DIAG = rec;
    } catch (e) { /* non-fatal */ }
  };

  // ── Visible tag ──────────────────────────────────────────────────────────
  function isDashboardView() {
    // Show only on the authenticated dashboard / band player, not public pages.
    var h = (global.location && global.location.hash) || '';
    return h.indexOf('#dashboard') === 0 || h.indexOf('band-player') !== -1;
  }

  function ensureTag() {
    if (!global.document) return;
    var el = document.getElementById('gbe-build-tag');
    if (!isDashboardView()) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'gbe-build-tag';
      el.setAttribute('title', 'Build id — tap to copy (for troubleshooting stale cache)');
      el.style.cssText = [
        'position:fixed', 'bottom:6px', 'right:8px', 'z-index:2147483000',
        'font:10px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",monospace',
        'color:rgba(255,255,255,0.35)', 'background:rgba(0,0,0,0.35)',
        'padding:2px 7px', 'border-radius:8px', 'letter-spacing:0.02em',
        'pointer-events:auto', 'cursor:pointer', 'user-select:all',
        '-webkit-user-select:all', 'backdrop-filter:blur(2px)'
      ].join(';');
      el.textContent = 'build ' + BUILD;
      el.addEventListener('click', function () {
        var text = 'GBE build ' + BUILD;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
          }
        } catch (e) {}
        var old = el.textContent;
        el.textContent = 'copied ✓';
        setTimeout(function () { el.textContent = old; }, 1200);
      });
      document.body.appendChild(el);
    } else {
      el.style.display = '';
      el.textContent = 'build ' + BUILD;
    }
  }

  function boot() {
    ensureTag();
    // Re-evaluate visibility on route changes (SPA hash routing).
    if (global.addEventListener) {
      global.addEventListener('hashchange', ensureTag);
    }
    if (global.document && document.addEventListener) {
      document.addEventListener('gbe:auth-ready', ensureTag);
    }
  }

  if (global.document) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : this);
