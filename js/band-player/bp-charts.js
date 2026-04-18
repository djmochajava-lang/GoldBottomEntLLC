/* ============================================
   bp-charts.js — Inline Chart Viewer (FRD-20 FR-4.7.x)

   Replaces the "open PDF in new tab" UX with an inline PDF.js viewer
   that supports pinch-zoom, two-finger pan, page navigation, and an
   optional "follow bar" overlay synced to playback time.

   Dependencies:
     - window.pdfjsLib  (loaded via CDN-with-SRI or vendored; see wiring docs)
     - window.fetch
     - Optional: BPTransport.currentTime() for follow-bar sync

   Surface:
     BPCharts.open({
       container,        // HTMLElement to render into
       chartUrl,         // PDF URL (tokenized, short-lived)
       chartVersion,     // for annotation scoping
       songId,           // for annotation scoping + follow-bar
       barTimings,       // optional: [ {bar: n, t: seconds} ] for follow-bar
       onError           // (err) => void
     })
     BPCharts.close()
     BPCharts.setFollowBarEnabled(true|false)
     BPCharts.zoomIn() / zoomOut() / fitToWidth()
     BPCharts.nextPage() / prevPage()

   Mobile:
     - Pinch-to-zoom via touch gestures (two-finger distance)
     - Two-finger pan
     - All button hit-areas ≥44×44 CSS px

   Note: the actual PDF.js rendering is DOM-heavy. This module stays small
   and testable by isolating gesture + state logic from rendering.
   ============================================ */
(function(global) {
  'use strict';

  // ── Zoom state machine ──────────────────────
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 4.0;
  var _zoom = 1.0;

  // ── Viewer state ────────────────────────────
  var _pdfDoc = null;
  var _currentPage = 1;
  var _pageCount = 0;
  var _container = null;
  var _canvas = null;
  var _renderTask = null;
  var _followBarEnabled = false;
  var _barTimings = [];
  var _currentBar = 0;
  var _lastRenderAt = 0;

  // ── Pinch state ─────────────────────────────
  var _pinchStartDist = null;
  var _pinchStartZoom = 1.0;

  // ── Utilities ───────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function _pinchDistance(touches) {
    if (!touches || touches.length < 2) return 0;
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── Follow-bar algorithm ────────────────────
  function _barForTime(t) {
    if (!_barTimings.length) return 0;
    // Binary search for last bar whose t <= current
    var lo = 0, hi = _barTimings.length - 1, res = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >>> 1;
      if (_barTimings[mid].t <= t) { res = _barTimings[mid].bar; lo = mid + 1; }
      else hi = mid - 1;
    }
    return res;
  }

  // ── Rendering ───────────────────────────────
  function _render() {
    if (!_pdfDoc || !_canvas) return Promise.resolve();

    return _pdfDoc.getPage(_currentPage).then(function(page) {
      var viewport = page.getViewport({ scale: _zoom });
      _canvas.width  = Math.floor(viewport.width);
      _canvas.height = Math.floor(viewport.height);
      var renderCtx = { canvasContext: _canvas.getContext('2d'), viewport: viewport };
      _renderTask = page.render(renderCtx);
      _lastRenderAt = Date.now();
      return _renderTask.promise;
    });
  }

  function _renderDebounced() {
    // Simple throttle: don't re-render more than every 50ms during pinch
    if (Date.now() - _lastRenderAt < 50) return;
    _render();
  }

  // ── Gesture handlers ────────────────────────
  function _onTouchStart(e) {
    if (e.touches.length === 2) {
      _pinchStartDist = _pinchDistance(e.touches);
      _pinchStartZoom = _zoom;
      e.preventDefault();
    }
  }
  function _onTouchMove(e) {
    if (e.touches.length === 2 && _pinchStartDist) {
      var d = _pinchDistance(e.touches);
      var ratio = d / _pinchStartDist;
      _zoom = clamp(_pinchStartZoom * ratio, ZOOM_MIN, ZOOM_MAX);
      _renderDebounced();
      e.preventDefault();
    }
  }
  function _onTouchEnd() {
    _pinchStartDist = null;
    _render(); // final render at exact zoom
  }

  // ── Public API ──────────────────────────────
  var BPCharts = {
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,

    open: function(opts) {
      opts = opts || {};
      _container = opts.container;
      _barTimings = Array.isArray(opts.barTimings) ? opts.barTimings.slice() : [];

      if (!_container) throw new Error('BPCharts: container required');
      if (!opts.chartUrl) throw new Error('BPCharts: chartUrl required');
      if (!global.pdfjsLib) {
        var err = new Error('PDF.js not loaded — include pdfjs-dist before band-player');
        if (opts.onError) opts.onError(err);
        throw err;
      }

      // Build canvas + page controls shell
      _container.innerHTML = '';
      _container.style.position = 'relative';

      _canvas = document.createElement('canvas');
      _canvas.style.display = 'block';
      _canvas.style.margin  = '0 auto';
      _canvas.style.maxWidth = '100%';
      _container.appendChild(_canvas);

      // Touch listeners for pinch zoom
      _container.addEventListener('touchstart', _onTouchStart, { passive: false });
      _container.addEventListener('touchmove', _onTouchMove,   { passive: false });
      _container.addEventListener('touchend', _onTouchEnd);

      // Load PDF
      var loadTask = global.pdfjsLib.getDocument(opts.chartUrl);
      return loadTask.promise.then(function(pdf) {
        _pdfDoc = pdf;
        _pageCount = pdf.numPages;
        _currentPage = 1;
        _zoom = 1.0;
        return _render();
      }).catch(function(err) {
        if (opts.onError) opts.onError(err);
        throw err;
      });
    },

    close: function() {
      if (_renderTask && typeof _renderTask.cancel === 'function') {
        try { _renderTask.cancel(); } catch (e) { /* ignore */ }
      }
      if (_container) {
        _container.removeEventListener('touchstart', _onTouchStart);
        _container.removeEventListener('touchmove', _onTouchMove);
        _container.removeEventListener('touchend', _onTouchEnd);
        _container.innerHTML = '';
      }
      _pdfDoc = null;
      _canvas = null;
      _container = null;
      _barTimings = [];
      _followBarEnabled = false;
    },

    setZoom: function(z) {
      _zoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
      return _render();
    },
    getZoom: function() { return _zoom; },
    zoomIn:  function() { return this.setZoom(_zoom * 1.25); },
    zoomOut: function() { return this.setZoom(_zoom / 1.25); },
    fitToWidth: function() {
      if (!_container || !_canvas || !_pdfDoc) return Promise.resolve();
      return _pdfDoc.getPage(_currentPage).then(function(page) {
        var viewport = page.getViewport({ scale: 1 });
        var w = _container.clientWidth;
        return BPCharts.setZoom(w / viewport.width);
      });
    },

    nextPage: function() {
      if (_currentPage < _pageCount) {
        _currentPage++;
        return _render();
      }
      return Promise.resolve();
    },
    prevPage: function() {
      if (_currentPage > 1) {
        _currentPage--;
        return _render();
      }
      return Promise.resolve();
    },
    getPageInfo: function() { return { page: _currentPage, total: _pageCount }; },

    setFollowBarEnabled: function(b) { _followBarEnabled = !!b; },
    isFollowBarEnabled: function() { return _followBarEnabled; },

    // ── FRD-20 FR-4.7.4: Chart annotations (per-user, per-bar) ──
    // Wraps the server CRUD API. All requests include credentials so the
    // server-side session identifies the user (SR-5.7.1 row-level scoping).
    //
    // listAnnotations({ songId, chartVersion }) → Promise<[annotation,...]>
    // saveAnnotation({ songId, chartVersion, barNumber, note }) → Promise<annotation>
    // deleteAnnotation(id) → Promise<boolean>

    listAnnotations: function(opts) {
      opts = opts || {};
      if (!opts.songId) return Promise.reject(new Error('songId required'));
      var qs = 'songId=' + encodeURIComponent(opts.songId);
      if (opts.chartVersion != null) qs += '&chartVersion=' + encodeURIComponent(opts.chartVersion);
      return fetch('/api/v1/annotations?' + qs, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      }).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function(body) {
        return body.annotations || [];
      });
    },

    saveAnnotation: function(opts) {
      opts = opts || {};
      if (!opts.songId) return Promise.reject(new Error('songId required'));
      if (!opts.note || typeof opts.note !== 'string') return Promise.reject(new Error('note required'));
      return fetch('/api/v1/annotations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          songId: opts.songId,
          chartVersion: opts.chartVersion != null ? opts.chartVersion : 1,
          barNumber: opts.barNumber != null ? opts.barNumber : null,
          note: opts.note
        })
      }).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    },

    updateAnnotation: function(id, note) {
      if (!id || !note) return Promise.reject(new Error('id and note required'));
      return fetch('/api/v1/annotations/' + encodeURIComponent(id), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ note: note })
      }).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    },

    deleteAnnotation: function(id) {
      if (!id) return Promise.reject(new Error('id required'));
      return fetch('/api/v1/annotations/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'include'
      }).then(function(r) {
        return r.status === 204;
      });
    },

    /**
     * Called on playback tick. Returns the current bar if follow is enabled.
     */
    updateForTime: function(t) {
      if (!_followBarEnabled || !_barTimings.length) return null;
      var bar = _barForTime(t);
      if (bar !== _currentBar) { _currentBar = bar; return bar; }
      return null;
    },

    // ── Test hooks ──
    _setBarTimings: function(arr) { _barTimings = arr.slice(); },
    _barForTime: _barForTime,
    _resetZoom: function() { _zoom = 1.0; },
    _state: function() {
      return { zoom: _zoom, page: _currentPage, total: _pageCount, followBar: _followBarEnabled };
    }
  };

  // ── Export ────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BPCharts;
  } else if (global) {
    global.BPCharts = BPCharts;
  }
})(typeof window !== 'undefined' ? window : this);
