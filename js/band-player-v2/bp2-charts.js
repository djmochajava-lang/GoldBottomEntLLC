/* ============================================
   bp2-charts.js — Chart Viewer, Review, Annotations
   Band Player v2.0

   WHAT IT DOES:
     Chart picker modal: shows per-instrument charts for a song with
     approve/flag review buttons and version tracking. Inline PDF.js
     viewer with pinch-zoom, two-finger pan, and page navigation.
     Chart re-upload for band managers. Annotation CRUD via server API.

   WHAT IT OWNS:
     - Chart picker modal rendering
     - Chart review state (approve/flag per instrument)
     - PDF.js inline viewer (canvas, zoom, page nav)
     - Pinch-to-zoom gesture handling
     - Chart annotation CRUD (list/save/update/delete via /api/v1/annotations)
     - Chart re-upload flow (Firebase Storage put + Firestore update)

   WHO CALLS IT:
     - bp2-render.js action button "Charts" → opens chart picker modal
     - bp2-render-stems.js per-stem chart PDF button → opens PDF viewer

   DEPENDENCIES:
     - bp2-core.js (state, events, db + storage refs)
     - window.pdfjsLib (PDF.js, loaded via CDN or vendor)
   ============================================ */
(function(global) {
  'use strict';

  var BP2Charts = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Charts;
  } else if (global) {
    global.BP2Charts = BP2Charts;
  }
})(typeof window !== 'undefined' ? window : this);
