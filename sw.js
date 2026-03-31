// sw.js — GBE Offline Shell Service Worker
// Caches the app shell and CDN assets so the Music Player works in airplane mode.
// Audio files are cached separately by BandPlayer via the Cache API (bp-offline-audio).

var SHELL_CACHE = 'gbe-shell-v2';
var AUDIO_CACHE = 'bp-offline-audio'; // Owned by BandPlayer — never delete this cache

// Firebase backend API hostnames — never intercept these; let Firebase SDK handle them
var FIREBASE_API_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
];

// Same-origin assets to precache at install time
var PRECACHE_ASSETS = [
  './',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/sections.css',
  './css/pages.css',
  './css/dashboard.css',
  './css/animations.css',
  './css/responsive.css',
  './js/config.js',
  './js/utils.js',
  './js/mobile-detect.js',
  './js/toast.js',
  './js/modal.js',
  './js/auth.js',
  './js/page-loader.js',
  './js/scroll-animations.js',
  './js/router.js',
  './js/navigation.js',
  './js/sidebar.js',
  './js/data-store.js',
  './js/forms.js',
  './js/table-manager.js',
  './js/dashboard-widgets.js',
  './js/calendar.js',
  './js/band-player.js',
  './js/main.js',
  './dashboard/band-player.html',
  './images/logo/gbe-logo.svg',
];

// ── Install: precache app shell ──────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function(cache) {
      return Promise.all(PRECACHE_ASSETS.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('[SW] Could not precache: ' + url, err.message);
        });
      }));
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activate: remove old shell caches ───────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== SHELL_CACHE && key !== AUDIO_CACHE) {
          console.log('[SW] Removing old cache: ' + key);
          return caches.delete(key);
        }
      }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch: serve from cache, update in background ───────
self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Skip Firebase backend API calls — Firebase SDK manages these with its own offline cache
  var isFirebaseApi = FIREBASE_API_HOSTS.some(function(host) {
    return url.hostname === host;
  });
  if (isFirebaseApi) return;

  if (url.origin === self.location.origin) {
    // Same-origin assets (CSS, JS, HTML fragments):
    // Serve cached version immediately, fetch fresh copy in background
    event.respondWith(
      caches.match(req).then(function(cached) {
        var networkFetch = fetch(req).then(function(response) {
          if (response && response.ok) {
            caches.open(SHELL_CACHE).then(function(cache) {
              cache.put(req, response.clone());
            });
          }
          return response;
        }).catch(function() {
          return null;
        });
        // Return cache immediately if available; otherwise wait for network
        return cached || networkFetch;
      })
    );
  } else {
    // Cross-origin (Firebase SDK, Google Fonts, Font Awesome CDN):
    // Try network first, fall back to cache, cache successful responses
    event.respondWith(
      fetch(req).then(function(response) {
        if (response && (response.ok || response.type === 'opaque')) {
          caches.open(SHELL_CACHE).then(function(cache) {
            cache.put(req, response.clone());
          });
        }
        return response;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
  }
});
