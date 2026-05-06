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
  });

  // Dump again on first dashboard fragment load.
  document.addEventListener('gbe:dashboard-loaded', function () {
    Perf.mark('dashboard.loaded');
    Perf.measure('dashboard.firstLoad', 'auth.ready', 'dashboard.loaded');
    setTimeout(function () { Perf.dump(); }, 0);
  });
})();
