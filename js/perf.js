// js/perf.js
//
// Lightweight performance instrumentation for the BM/member auth + dashboard
// hot path. Wraps performance.mark/measure with a prefix, logs durations to
// console, exposes window.__gbePerf for inspection from Safari Web Inspector.
//
// Phase B (Task 8) of epic-perf-auth-and-dashboard-sluggish.
//
// Usage:
//   Perf.mark('auth.state.first');         // record a timestamp
//   Perf.measure('auth.bootstrap',         // measure between two marks
//                'boot.start', 'auth.ready');
//   Perf.dump();                           // print summary table to console
//
// All marks are stored in window.__gbePerf so a remote debug session can
// read them: connect Safari Web Inspector to the iPhone and run
// `JSON.stringify(__gbePerf.measures)` to capture the durations.

(function () {
  if (typeof window === 'undefined') return;
  var hasPerf = (typeof performance !== 'undefined') && performance.mark && performance.measure;

  var Perf = {
    PREFIX: 'gbe.',
    marks: {},          // name → timestamp (ms since navigation start)
    measures: {},       // label → duration (ms)
    enabled: true,

    mark: function (name) {
      if (!this.enabled) return;
      var full = this.PREFIX + name;
      var t = (performance && performance.now) ? performance.now() : Date.now();
      this.marks[name] = t;
      if (hasPerf) {
        try { performance.mark(full); } catch (e) { /* duplicate name OK */ }
      }
      try { console.log('[perf] ' + name + ' @ ' + Math.round(t) + 'ms'); } catch (e) {}
    },

    measure: function (label, startMark, endMark) {
      if (!this.enabled) return null;
      var s = this.marks[startMark];
      var e = endMark ? this.marks[endMark] : ((performance && performance.now) ? performance.now() : Date.now());
      if (s == null) return null;
      var dur = Math.round(e - s);
      this.measures[label] = dur;
      if (hasPerf) {
        try { performance.measure(this.PREFIX + label, this.PREFIX + startMark, endMark ? this.PREFIX + endMark : undefined); }
        catch (err) { /* mark may not exist */ }
      }
      try { console.log('[perf] ' + label + ' = ' + dur + 'ms'); } catch (e2) {}
      return dur;
    },

    /** Print a summary table of all recorded measures. */
    dump: function () {
      var rows = Object.keys(this.measures).map(function (k) {
        return { measure: k, durationMs: Perf.measures[k] };
      });
      try {
        if (console.table) console.table(rows);
        else console.log('[perf] measures:', JSON.stringify(this.measures, null, 2));
      } catch (e) {}
      return rows;
    },

    /** Reset all marks and measures (useful between sign-in attempts). */
    reset: function () {
      this.marks = {};
      this.measures = {};
      if (hasPerf && performance.clearMarks) {
        try { performance.clearMarks(); performance.clearMeasures(); } catch (e) {}
      }
    }
  };

  window.Perf = Perf;
  window.__gbePerf = Perf;

  // Record the boot start mark immediately so all subsequent measurements
  // can be relative to page load, not module load.
  Perf.mark('boot.start');

  // Auto-dump on auth-ready event so the iPhone debug session sees a
  // summary as soon as the dashboard is interactive.
  document.addEventListener('gbe:auth-ready', function () {
    Perf.mark('auth.ready');
    Perf.measure('auth.total', 'boot.start', 'auth.ready');
    setTimeout(function () { Perf.dump(); }, 0);
    _startHeartbeat();
  });

  // Dump again on first dashboard fragment load.
  document.addEventListener('gbe:dashboard-loaded', function () {
    Perf.mark('dashboard.loaded');
    Perf.measure('dashboard.firstLoad', 'auth.ready', 'dashboard.loaded');
    setTimeout(function () { Perf.dump(); }, 0);
  });

  // ── Long task observer ────────────────────────────────────────────────
  // PerformanceObserver entryType "longtask" emits any task >50ms blocking
  // the main thread. On Safari Web Inspector during iPhone testing, a
  // sequence of long tasks reveals exactly when JS is hogging the thread
  // and preventing tap events from being processed. Each line says when
  // the block started and how long it lasted, so a 45-second tap latency
  // shows up as a chain of long tasks ending right before the menu paints.
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      var ltObs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          try {
            console.log('[perf] longtask @ ' + Math.round(e.startTime) + 'ms took ' + Math.round(e.duration) + 'ms');
          } catch (err) {}
        });
      });
      ltObs.observe({ entryTypes: ['longtask'] });
    } catch (e) { /* longtask not supported on this engine */ }

    // First Input Delay: how long between the user's first interaction and
    // the browser actually processing the event. Captures the iPhone "I
    // tapped but nothing happened" experience as a single number.
    try {
      var fidObs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          var delay = Math.round(e.processingStart - e.startTime);
          var sinceAuthReady = Perf.marks['auth.ready'] != null
            ? Math.round(e.startTime - Perf.marks['auth.ready']) : null;
          try {
            console.log('[perf] first-input ' + (e.name || 'event')
              + ' delay=' + delay + 'ms'
              + (sinceAuthReady != null ? ' (' + sinceAuthReady + 'ms after auth.ready)' : ''));
          } catch (err) {}
          Perf.measures['first-input.delay'] = delay;
        });
      });
      fidObs.observe({ type: 'first-input', buffered: true });
    } catch (e) { /* first-input not supported */ }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────
  // Every 250ms after auth.ready for 30 seconds, log a heartbeat with the
  // gap since the last beat. If the main thread blocks for N seconds,
  // beats stop firing during the block and the next beat shows the gap.
  // A line like "[perf] heartbeat @ 8500ms (gap 7200ms)" is a smoking gun
  // for "8200ms of main-thread blockage starting near auth.ready+1300ms".
  function _startHeartbeat() {
    var t0 = Perf.marks['auth.ready'] || performance.now();
    var lastBeat = performance.now();
    var beatCount = 0;
    var maxBeats = 120; // 30 seconds @ 250ms intervals
    var interval = setInterval(function () {
      var now = performance.now();
      var sinceAuth = Math.round(now - t0);
      var gap = Math.round(now - lastBeat);
      lastBeat = now;
      beatCount++;
      // Only log "interesting" beats: every 4th OR a beat with a big gap (>=400ms)
      if (gap >= 400 || beatCount % 4 === 0) {
        try {
          console.log('[perf] heartbeat @ ' + sinceAuth + 'ms (gap ' + gap + 'ms)');
        } catch (e) {}
      }
      if (beatCount >= maxBeats) clearInterval(interval);
    }, 250);
  }
})();
