// sw.js — GBE Offline Shell Service Worker
// Caches the app shell and CDN assets so the Music Player works in airplane mode.
// Audio files are cached separately by BandPlayer via the Cache API (bp-offline-audio).
// Integrity: ASSET_HASHES verified via Web Crypto SHA-256 to prevent cache poisoning (M-4).

var SHELL_CACHE = 'gbe-shell-v5';
var AUDIO_CACHE = 'bp-offline-audio'; // Owned by BandPlayer — never delete this cache

// SHA-256 hashes of precached assets — populated by generate-sw-hashes.js
var ASSET_HASHES = {
  './': '25d201a4e2ead50bfd3697e1a4394526ff4bccbc333bc794055f35ef090b55e6',
  './css/base.css': '09ed9f4ad7cdc8d3def4b02cdf4acf56d4437787d0730310fbd34fa8d4338374',
  './css/layout.css': '976cb8820b1b9c3a3cb8df912c7cd91a212a35264ca6e365da78b269bd6acd7a',
  './css/components.css': '6f570f9a4aaa3c36d36fb09c9c54ce6df43474ec2516834c15e75d9ca9b7130b',
  './css/sections.css': 'e9218a68c262d4a3d8767c1a3f305c3c1e0ab5693598319aa434991678535b29',
  './css/pages.css': '10b388c8d0d39bc508a028fe9dfeefa89b3415af7fc8104d194aab71d909afa2',
  './css/dashboard.css': '77641ade5ec89775c7cb55af0da7b2d59187003586ab2454961b6e572740cd1d',
  './css/animations.css': '97ae5536821674cf9ead7114e508260b951ffb5885127a538861a28f3ddbc85c',
  './css/responsive.css': 'd57c05605001cbaf18e6278aef7383dffff6533ed07a69348f04580d803cc656',
  './js/config.js': '554df20227108457eba49f9e01645fefe2b0414fea2dea12c04335cfb2e84b6b',
  './js/utils.js': '66fb16aef97d5ec7ba6dcbae1e72aa1777e65e797b4a5ec1a1f68fc660a0c796',
  './js/mobile-detect.js': 'a5fc7d286ca4497e9a88f72c9cf092d207ad0875fa2b45dc550287e62daaf94e',
  './js/toast.js': '74bfec8e52dbd0cc437b09851756f642d268ba21c2b28cd3563c3ca703f146f4',
  './js/modal.js': 'fd60926db530a6855a03a486b48500a4463808bfae140a592cc86cffcc8b006b',
  './js/auth.js': '2e559619d566d4f56017e93503ff6d34209426b6e31fec3367e702b2f17223a1',
  './js/page-loader.js': '9d244b6d5a314c7b7915f35189f1079b56869fe7ad48dc9529e283a8ab475cb3',
  './js/scroll-animations.js': '765ee4aad4c8499874ce827c4705611a9f5d6ddece76d2607ba275271806267c',
  './js/router.js': 'f43b6cbf0093ae4bf28b7031b618f064fbc67aee3859cf5fd6b4eaee480bfb0e',
  './js/navigation.js': '57419e244635f61165b7e94ea451eef0642981c6f018ea9464209970248e410b',
  './js/sidebar.js': '22f78ac9fbdc4efc58e7f3b2fb93353370ca23c897b3defd0bfed7451b9fdb74',
  './js/data-store.js': 'ffa4b8001aabde2c4740a129c85832976c20feffecbadbad617cce0117456d1e',
  './js/forms.js': 'e2d1c64425f89e50c9f3bbeb0a5ae16eeef967c5eeec3122824630c0a504ea14',
  './js/table-manager.js': '48472d850800b118c57e850844a3dff7121fa661db818f238afd0135daa40ca8',
  './js/dashboard-widgets.js': '689cf2f3529404f220e4ac2d4c3def22d3c3b1f4d425d2f8d21e95f86338700f',
  './js/calendar.js': 'ccd8b682e0714c56ff0e5e9bc9f4e880a5b58fb973b765e260c79fffd34b1ac5',
  './js/band-player.js': '004ca8a3824e30323d688a0a01b1365e572476d1266528212767cfce992a287d',
  './js/main.js': 'a0c2717e96b0e041d80e5a3349093c29a0206bb96a1d16fdebced18801a7c03d',
  './dashboard/band-player.html': '602febe52a1f7b748d556588e3a4304ef0a64bd639981f34e7f9ad9f11af54c9',
  './images/logo/gbe-logo.svg': '1e780d4036cf711a07d6d9091d37ce184440eda7cde4e2b2faef251c6f9219ee'
};

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

// ── Utility: compute SHA-256 hex digest of an ArrayBuffer ──
function _computeHash(arrayBuffer) {
  return crypto.subtle.digest('SHA-256', arrayBuffer).then(function(hashBuffer) {
    var bytes = new Uint8Array(hashBuffer);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      hex += (h.length === 1 ? '0' : '') + h;
    }
    return hex;
  });
}

// ── Utility: resolve the ASSET_HASHES key for a request URL ──
function _resolveHashKey(requestUrl) {
  var swScope = self.registration.scope;
  // Normalize: strip the scope prefix to get relative path, then prepend './'
  if (requestUrl.indexOf(swScope) === 0) {
    var relative = requestUrl.substring(swScope.length);
    if (relative === '' || relative === 'index.html') {
      return './';
    }
    return './' + relative;
  }
  return null;
}

// ── Utility: verify response integrity against ASSET_HASHES ──
// Returns a Promise that resolves to { valid: true, response: clonedResponse }
// or { valid: false, reason: string }.
// If no hash exists for this URL, passes through as valid (no hash = no check).
function _verifyResponse(response, requestUrl) {
  var hashKey = _resolveHashKey(requestUrl);
  var expectedHash = hashKey ? ASSET_HASHES[hashKey] : null;

  // No hash in manifest — skip verification (asset not in precache list or hashes not generated)
  if (!expectedHash) {
    return Promise.resolve({ valid: true, response: response });
  }

  // Clone the response so we can read the body for hashing
  // and still return the original for caching/serving
  var cloneForHash = response.clone();
  return cloneForHash.arrayBuffer().then(function(buffer) {
    return _computeHash(buffer);
  }).then(function(actualHash) {
    if (actualHash === expectedHash) {
      return { valid: true, response: response };
    }
    return {
      valid: false,
      reason: '[SW] Integrity mismatch for ' + hashKey +
        ' (expected: ' + expectedHash.substring(0, 12) + '...' +
        ', got: ' + actualHash.substring(0, 12) + '...)'
    };
  });
}

// ── Install: precache app shell with integrity verification ─
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function(cache) {
      return Promise.all(PRECACHE_ASSETS.map(function(url) {
        return fetch(url).then(function(response) {
          if (!response.ok) {
            console.warn('[SW] Fetch failed for precache: ' + url + ' (' + response.status + ')');
            return;
          }
          return _verifyResponse(response, new URL(url, self.location.href).href).then(function(result) {
            if (result.valid) {
              return cache.put(url, result.response);
            }
            console.warn(result.reason + ' — skipping cache');
          });
        }).catch(function(err) {
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
            // Verify integrity before updating cache
            var responseToCache = response.clone();
            _verifyResponse(responseToCache, req.url).then(function(result) {
              if (result.valid) {
                caches.open(SHELL_CACHE).then(function(cache) {
                  cache.put(req, result.response);
                });
              } else {
                console.warn(result.reason + ' — keeping cached version');
              }
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
    // No integrity check for cross-origin — hashes only cover same-origin precached assets
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
