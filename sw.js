// sw.js — GBE Offline Shell Service Worker
// Caches the app shell and CDN assets so the Music Player works in airplane mode.
// Audio files are cached separately by BandPlayer via the Cache API (bp-offline-audio).
// Integrity: ASSET_HASHES verified via Web Crypto SHA-256 to prevent cache poisoning (M-4).

// FRD-20 SR-5.4.1/5.4.2: bumped for band-player module additions + CSS.
// Activate handler deletes any cache that starts with 'gbe-shell-' but isn't the
// current version, so older shells auto-evict on next activation.
var SHELL_CACHE = 'gbe-shell-v19';
var AUDIO_CACHE = 'bp-offline-audio'; // Owned by BandPlayer — never delete this cache

// SHA-256 hashes of precached assets — populated by generate-sw-hashes.js
var ASSET_HASHES = {
  './': 'c5a7b9534a20a608ce40f58d9fcbf1c82e58bcfee34db6eacd81e81c0ecdbfba',
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
  './js/auth.js': '5c725971d112a6a03dfcf06a98806099adc233586e0a3859419b99643e887282',
  './js/page-loader.js': '9d244b6d5a314c7b7915f35189f1079b56869fe7ad48dc9529e283a8ab475cb3',
  './js/scroll-animations.js': '765ee4aad4c8499874ce827c4705611a9f5d6ddece76d2607ba275271806267c',
  './js/router.js': '5a685bbd38ac7701014e93d7987cdc1bf29d98edbf9f7fb52d657833ffa6f06c',
  './js/navigation.js': '57419e244635f61165b7e94ea451eef0642981c6f018ea9464209970248e410b',
  './js/sidebar.js': '22f78ac9fbdc4efc58e7f3b2fb93353370ca23c897b3defd0bfed7451b9fdb74',
  './js/data-store.js': 'ffa4b8001aabde2c4740a129c85832976c20feffecbadbad617cce0117456d1e',
  './js/forms.js': '95f367096cd2f9ff19a90f6b0405f934f47f5f769fa1176cc604e3d8e84d2840',
  './js/table-manager.js': '48472d850800b118c57e850844a3dff7121fa661db818f238afd0135daa40ca8',
  './js/dashboard-widgets.js': '689cf2f3529404f220e4ac2d4c3def22d3c3b1f4d425d2f8d21e95f86338700f',
  './js/calendar.js': 'ccd8b682e0714c56ff0e5e9bc9f4e880a5b58fb973b765e260c79fffd34b1ac5',
  './js/main.js': 'a0c2717e96b0e041d80e5a3349093c29a0206bb96a1d16fdebced18801a7c03d',
  './images/logo/gbe-logo.svg': '1e780d4036cf711a07d6d9091d37ce184440eda7cde4e2b2faef251c6f9219ee',
  './css/band-player-v2.css': '879f1e5edde058bcf04dc2456d76a63a0ecd2c5985def54504ac39c6ed390ef7',
  './dashboard/band-player-v2.html': 'ac9c11a1bd298f89804960fc18c5a72d2c88248e8807025667f18af98cdd842e',
  './js/band-player-v2/bp2-utils.js': '8fbe63449c3956ad213c7eadb0548ed23802370d69f5091148e90a6201758879',
  './js/band-player-v2/bp2-core.js': 'e3bb5e062e22d2adc3f9bb5543bd560d806ad629d3f29302d169e10dea815263',
  './js/band-player-v2/bp2-player.js': '3cd170810e69e5b809dc2e951c61fb41de532a6b343c9a0d1165d94c22fe85f5',
  './js/band-player-v2/bp2-playlist.js': 'a7d0d715321f026601e9a53fe14cedcc49f6e563f9d2200c76f36e3d376ba298',
  './js/band-player-v2/bp2-render.js': 'bf766fcbf26c9723fb58ce16ba51c0c77a3b8543e2352793b4b35fae05642896',
  './js/band-player-v2/bp2-render-edit.js': '102122537c1ad2659bdf689988066ea37b5e44475a7e189a7396f075f5debbfd',
  './js/band-player-v2/bp2-render-stems.js': '29763a1e7839f4d5ebc6e0f210e73375d6f3f3a01a99ffbe35d51a9b261d6f2d',
  './js/band-player-v2/bp2-offline.js': '76b070ab9310e574316838dcc0a38e4847415b0eb8aa554469e66c30ff70eba9',
  './js/band-player-v2/bp2-stems.js': '23311a4461c9937bf13320731e33d52dff99c6c45de7714da45677528655fcd6',
  './js/band-player-v2/bp2-mixer.js': '791832933eac1370df85821e25e2ebbdd402eab5e2c53df6ce274f9039455c77',
  './js/band-player-v2/bp2-transport.js': '6d4077a56487fd45ee1680714158d79d57b7ee1f2dcb102c349a8bda8690ac2a',
  './js/band-player-v2/bp2-practice.js': '4b4428730733e4ed2e903464f454261cb7c0bd7f051a5158cf24e99794120158',
  './js/band-player-v2/bp2-charts.js': 'cb995c50235615429cc62cda55e16312c161c3414434428a4789a7f0b2286091',
  './js/band-player-v2/bp2-lyrics.js': '5ae039ad37a25542b33cf807f0f2ce7505f53a1573b031e732d2b110f6552cb5',
  './js/band-player-v2/bp2-notes.js': '71ef2fc765b3077f427c466f81e89b25a2b1e32e3de6d053d3f1add9c248c3d7',
  './js/band-player-v2/bp2-upload.js': '36409599340ed962d9cb13440423f0aafcc14b3793bb5933f54e4ec89f6c28d6',
  './js/band-player-v2/bp2-permissions.js': '3ddaff2487249c6cee9d0d1f2ea82c416a853c2b43a8ea6059a6d652d8921920',
  './js/band-player-v2/bp2-edit.js': '1acd460ab0923f707543f0d8f4a3b3f3146448e8a56959390d1f4e80be012df3',
  './js/band-player-v2/bp2-integration.js': '52c8877dca65340c525fd324456f8bdd4c46704a42eeb65c09fa1a0e0b55f642',
  './js/band-player-v2/bp2-progress.js': 'b8366d73b421e9215d183b273ee1865f509e691fb27a88749a3ad16139873467',
  './js/band-player-v2/bp2-auth.js': '82a5d9894002bad689b14d5d02f87806949322bf13aaf06ff939c600153acda6'
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
  './css/band-player.css',
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
  './js/band-player/bp-mixer.js',
  './js/band-player/bp-transport.js',
  './js/band-player/bp-practice.js',
  './js/band-player/bp-charts.js',
  './js/band-player/bp-progress.js',
  './js/band-player/bp-integration.js',
  './js/main.js',
  './dashboard/band-player.html',
  './images/logo/gbe-logo.svg',
  // Band Player v2.0
  './css/band-player-v2.css',
  './dashboard/band-player-v2.html',
  './js/band-player-v2/bp2-utils.js',
  './js/band-player-v2/bp2-core.js',
  './js/band-player-v2/bp2-player.js',
  './js/band-player-v2/bp2-playlist.js',
  './js/band-player-v2/bp2-render.js',
  './js/band-player-v2/bp2-render-edit.js',
  './js/band-player-v2/bp2-render-stems.js',
  './js/band-player-v2/bp2-offline.js',
  './js/band-player-v2/bp2-stems.js',
  './js/band-player-v2/bp2-mixer.js',
  './js/band-player-v2/bp2-transport.js',
  './js/band-player-v2/bp2-practice.js',
  './js/band-player-v2/bp2-charts.js',
  './js/band-player-v2/bp2-lyrics.js',
  './js/band-player-v2/bp2-notes.js',
  './js/band-player-v2/bp2-upload.js',
  './js/band-player-v2/bp2-permissions.js',
  './js/band-player-v2/bp2-edit.js',
  './js/band-player-v2/bp2-integration.js',
  './js/band-player-v2/bp2-progress.js',
  './js/band-player-v2/bp2-auth.js',
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
