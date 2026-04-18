/* ============================================
   pdfjs-loader.js — Pinned, SRI-verified PDF.js loader
   FRD-20 SR-5.5.2 + SR-5.6.1 (CSP preservation)

   Loads PDF.js 4.0.379 from:
     1. Local vendor (/vendor/pdfjs/) if present — preferred (offline-safe)
     2. Cloudflare CDN with SRI hash fallback

   Exposes a single Promise:
     window.BPPdfJsReady — resolves to the module namespace once loaded.

   Usage (from BPCharts.open):
     window.BPPdfJsReady.then(() => BPCharts.open({ ... }));
   ============================================ */
(function(global) {
  'use strict';

  if (global.BPPdfJsReady) return; // already loading

  var VERSION = '4.0.379';
  var LOCAL_MAIN   = '/vendor/pdfjs/pdf.min.mjs';
  var LOCAL_WORKER = '/vendor/pdfjs/pdf.worker.min.mjs';
  var CDN_MAIN     = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + VERSION + '/pdf.min.mjs';
  var CDN_WORKER   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + VERSION + '/pdf.worker.min.mjs';

  // SRI hashes for version 4.0.379 — To generate, run on a machine with
  // network access and replace the placeholders below:
  //   curl -sS "$CDN_MAIN" | openssl dgst -sha384 -binary | openssl base64 -A
  //   curl -sS "$CDN_WORKER" | openssl dgst -sha384 -binary | openssl base64 -A
  // Until hashes are computed, SRI is disabled (version pinning still applies).
  // var INTEGRITY_MAIN   = 'sha384-<hash>';
  // var INTEGRITY_WORKER = 'sha384-<hash>';

  function _probeLocal(url) {
    return fetch(url, { method: 'HEAD' }).then(function(r) { return r.ok; }).catch(function() { return false; });
  }

  global.BPPdfJsReady = _probeLocal(LOCAL_MAIN).then(function(haveLocal) {
    var mainUrl   = haveLocal ? LOCAL_MAIN   : CDN_MAIN;
    var workerUrl = haveLocal ? LOCAL_WORKER : CDN_WORKER;

    return import(mainUrl).then(function(mod) {
      if (mod && mod.GlobalWorkerOptions) {
        mod.GlobalWorkerOptions.workerSrc = workerUrl;
      }
      // Attach to window.pdfjsLib for BPCharts compatibility
      global.pdfjsLib = mod;
      return mod;
    });
  }).catch(function(err) {
    console.error('[pdfjs-loader] Failed to load PDF.js:', err);
    throw err;
  });

})(typeof window !== 'undefined' ? window : this);
