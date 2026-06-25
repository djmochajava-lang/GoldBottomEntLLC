// sw.js — GBE Offline Shell Service Worker
// Caches the app shell and CDN assets so the Music Player works in airplane mode.
// Audio files are cached separately by BandPlayer via the Cache API (bp-offline-audio).
// Integrity: ASSET_HASHES verified via Web Crypto SHA-256 to prevent cache poisoning (M-4).

// SHELL_CACHE is intentionally stable across normal code deploys. The install
// handler is diff-aware (hashes cached body against ASSET_HASHES, only fetches
// the diff), so a code commit no longer needs to evict the whole cache. Bump
// this name ONLY when you need a clean break — precache contract change, hash
// algorithm change, or a one-time force-evict for a bad cache. Bumping per
// commit recreates the install-storm-vs-OAuth bug we fixed in May 2026.
// Activate handler still deletes other gbe-shell-vN caches so a one-off bump
// remains a working escape hatch.
var SHELL_CACHE = 'gbe-shell-v38';
var AUDIO_CACHE = 'bp-offline-audio'; // Owned by BandPlayer — never delete this cache

// SHA-256 hashes of precached assets — populated by generate-sw-hashes.js
var ASSET_HASHES = {
  './css/base.css': '2a43744f37cfb253154beefd8cb0e6c2054c11cf72f1041434a2c9d3cce630ab',
  './css/layout.css': 'c470cb81aec9099aee3ecd23187a57cba0cd33b7622bee7cdff5db70b3ddf9ef',
  './css/components.css': '6f570f9a4aaa3c36d36fb09c9c54ce6df43474ec2516834c15e75d9ca9b7130b',
  './css/sections.css': 'e9218a68c262d4a3d8767c1a3f305c3c1e0ab5693598319aa434991678535b29',
  './css/pages.css': '10b388c8d0d39bc508a028fe9dfeefa89b3415af7fc8104d194aab71d909afa2',
  './css/dashboard.css': '4256a19f113a7317827c73ee343d92f2b8e5ccf42ca5442cf0a4ea06b9eb0216',
  './css/animations.css': '97ae5536821674cf9ead7114e508260b951ffb5885127a538861a28f3ddbc85c',
  './css/responsive.css': '7cef683bb181698cd90754e1166eab0fd08d1c49acff74f7780ff9c824075ce0',
  './js/config.js': 'ecccd34b9e117160fdcc939503a32a021e01603bbb454e0966a3ec98b3b733f3',
  './js/utils.js': '66fb16aef97d5ec7ba6dcbae1e72aa1777e65e797b4a5ec1a1f68fc660a0c796',
  './js/mobile-detect.js': 'a5fc7d286ca4497e9a88f72c9cf092d207ad0875fa2b45dc550287e62daaf94e',
  './js/toast.js': '74bfec8e52dbd0cc437b09851756f642d268ba21c2b28cd3563c3ca703f146f4',
  './js/modal.js': 'fd60926db530a6855a03a486b48500a4463808bfae140a592cc86cffcc8b006b',
  './js/auth.js': '373542cd629c6b10fb28fc2ae30b1579552cc411668e6908dd391503b44972df',
  './js/page-loader.js': '4dbe80f06bed8021ffd1da9d21f5d51925fce5d4557c721e658ff6f9e7795bac',
  './js/scroll-animations.js': '765ee4aad4c8499874ce827c4705611a9f5d6ddece76d2607ba275271806267c',
  './js/router.js': '5fdd8f5238e44dd0f6228f6da99fae235aa390b4e307418b0c339b8c2fa1e387',
  './js/navigation.js': 'a18c890b22580388af444e9b164935d0e7bd8589dfcbe9a4899cea2b78893254',
  './js/sidebar.js': '629752996e35c993c2b16cd0c02cbeec060226cfe4877b6b2f828e8d81eba312',
  './js/auth-cache.js': '6042f6a875e3d6846be70e3b733b6398e680ec1a1448a6e64efd983bb87de5f6',
  './js/sidebar-v2.js': '822146e4ef9d261bc58bf0de5f51121d14541dc4adb85e4b67ca295e2e947e21',
  './js/data-store.js': '6c5518ac697dd6072006290c5fd8465bc190907ce4c44f5fc0268ed8ecd561a4',
  './js/forms.js': '95f367096cd2f9ff19a90f6b0405f934f47f5f769fa1176cc604e3d8e84d2840',
  './js/table-manager.js': '48472d850800b118c57e850844a3dff7121fa661db818f238afd0135daa40ca8',
  './js/dashboard-widgets.js': '689cf2f3529404f220e4ac2d4c3def22d3c3b1f4d425d2f8d21e95f86338700f',
  './js/calendar.js': 'ccd8b682e0714c56ff0e5e9bc9f4e880a5b58fb973b765e260c79fffd34b1ac5',
  './js/main.js': 'a0c2717e96b0e041d80e5a3349093c29a0206bb96a1d16fdebced18801a7c03d',
  './images/logo/gbe-logo.svg': '1e780d4036cf711a07d6d9091d37ce184440eda7cde4e2b2faef251c6f9219ee',
  './css/band-player-v2.css': '20fefafa6977deeaa0d99de51d0fb286e6e1d709f9d70adfe54123f3032448d1',
  './dashboard/band-player-v2.html': 'b870a370beb3c2eeeb768f149339157729a184722d08869822df155b2e591b96',
  './js/band-player-v2/bp2-utils.js': '8fbe63449c3956ad213c7eadb0548ed23802370d69f5091148e90a6201758879',
  './js/band-player-v2/bp2-core.js': 'e3bb5e062e22d2adc3f9bb5543bd560d806ad629d3f29302d169e10dea815263',
  './js/band-player-v2/bp2-player.js': '3cd170810e69e5b809dc2e951c61fb41de532a6b343c9a0d1165d94c22fe85f5',
  './js/band-player-v2/bp2-playlist.js': '9babace653f32ea050e3662c35db3e31600b92031d2fd2149b82355946e71491',
  './js/band-player-v2/bp2-render.js': 'e8f68e74f53bf4bfb604e046e65c4576f96768f5e621aa67c2b6f0fd70cbffde',
  './js/band-player-v2/bp2-render-edit.js': 'e4b942ee7fd429ce5afae06e195285e3f08967808677eb36d8425290a6036302',
  './js/band-player-v2/bp2-render-stems.js': '42a4c2efcf8e3142585af89ee6702d6112a8cfaee4bc9ba54afd69ff7daf9b22',
  './js/band-player-v2/bp2-offline.js': 'f8f658739b48821f1471a26d873bbee5a6f20dec37ff0d07bd7f641182efefd7',
  './js/band-player-v2/bp2-stems.js': 'cb9fbc91b34f3248a733d48f1a7d3ceb83639cf3d62c26c62c829c8a4d7b066c',
  './js/band-player-v2/bp2-mixer.js': '0a3dfd66e4281a05c0a7ca2dad52b9112bdd350b393c6024ecc14be92bed530e',
  './js/band-player-v2/bp2-transport.js': 'c86594d9cf2ffa54b1cf0fb072a50380632d2fa324faebbae954fc4bf65b3870',
  './js/band-player-v2/bp2-practice.js': '4b4428730733e4ed2e903464f454261cb7c0bd7f051a5158cf24e99794120158',
  './js/band-player-v2/bp2-charts.js': '9abb8f8f4f5bf2c602e1a09960ed0d5b10a29a5ed60c317e421eb81e9af10f7e',
  './js/band-player-v2/bp2-lyrics.js': '5ae039ad37a25542b33cf807f0f2ce7505f53a1573b031e732d2b110f6552cb5',
  './js/band-player-v2/bp2-notes.js': '71ef2fc765b3077f427c466f81e89b25a2b1e32e3de6d053d3f1add9c248c3d7',
  './js/band-player-v2/bp2-upload.js': 'e311617c5bb92f16fdbe687f3a6f5c84321b134328313af188733d45c73e28f4',
  './js/band-player-v2/bp2-permissions.js': '3ddaff2487249c6cee9d0d1f2ea82c416a853c2b43a8ea6059a6d652d8921920',
  './js/band-player-v2/bp2-edit.js': '5e2eca10851e407fedc559a817d9cb7a7882cf520451d6a7c1fba51263f3fb7e',
  './js/band-player-v2/bp2-integration.js': 'a4e74c5ce264f7ef56f91a41d6628da8cb7895eeade564ad59c248d676b5ecb6',
  './js/band-player-v2/bp2-progress.js': 'b8366d73b421e9215d183b273ee1865f509e691fb27a88749a3ad16139873467',
  './js/band-player-v2/bp2-auth.js': '853d982e53d375c82efa325e085be52f93a29345e3f082a7e7be417ce2586f58'
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
  './js/main.js',
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

// ── Utility: is this asset already cached with the expected body hash? ──
// Used by the diff-aware install to skip re-fetching unchanged assets.
// Returns false on any uncertainty (no manifest hash, no cache entry, hash
// mismatch, read error) so the caller falls through to fetch + verify + put.
function _isCacheFresh(cache, url, absoluteUrl) {
  var hashKey = _resolveHashKey(absoluteUrl);
  var expectedHash = hashKey ? ASSET_HASHES[hashKey] : null;
  if (!expectedHash) return Promise.resolve(false);
  return cache.match(url).then(function(cached) {
    if (!cached) return false;
    return cached.clone().arrayBuffer().then(_computeHash).then(function(actualHash) {
      return actualHash === expectedHash;
    });
  }).catch(function() {
    return false;
  });
}

// ── Install: diff-aware precache against a stable SHELL_CACHE ─
//
// Deploy contract (Story 5, epic-perf-architecture-modernization):
// We do NOT call skipWaiting() here. A new SW must enter the standard
// waiting state and only activate after every tab using the old SW has
// closed. This is what guarantees "deploys never disrupt active sessions."
// If skipWaiting() is reintroduced, you also force every open tab to
// re-fetch the precache mid-session — that is the bug we just fixed.
//
// Diff-aware install: SHELL_CACHE is intentionally stable across normal
// deploys. For each precache asset we hash the cached body and compare to
// ASSET_HASHES (regenerated by the pre-commit hook). Hits → skip fetch.
// Misses → fetch + verify + put. On a typical 1–3 file deploy, returning
// users do 1–3 install fetches instead of 50, so the install storm no
// longer competes with sign-in OAuth requests on cellular. Bump SHELL_CACHE
// only when you need a clean break (precache contract change, hash algo
// change, force-evict bad cache) — never just because code changed.
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function(cache) {
      return Promise.all(PRECACHE_ASSETS.map(function(url) {
        var absoluteUrl = new URL(url, self.location.href).href;
        return _isCacheFresh(cache, url, absoluteUrl).then(function(fresh) {
          if (fresh) return;
          return fetch(url).then(function(response) {
            if (!response.ok) {
              console.warn('[SW] Fetch failed for precache: ' + url + ' (' + response.status + ')');
              return;
            }
            return _verifyResponse(response, absoluteUrl).then(function(result) {
              if (result.valid) {
                return cache.put(url, result.response);
              }
              console.warn(result.reason + ' — skipping cache');
            });
          }).catch(function(err) {
            console.warn('[SW] Could not precache: ' + url, err.message);
          });
        });
      })).then(function() {
        // GC: drop precache-shaped entries (no query string) that are no
        // longer in PRECACHE_ASSETS, so removed assets don't accumulate
        // forever in a stable cache. Runtime-cached entries with ?v= and
        // navigation HTML are left alone.
        var precacheUrls = PRECACHE_ASSETS.map(function(u) {
          return new URL(u, self.location.href).href;
        });
        return cache.keys().then(function(reqs) {
          return Promise.all(reqs.map(function(req) {
            if (req.url.indexOf('?') !== -1) return;
            if (precacheUrls.indexOf(req.url) !== -1) return;
            return cache.delete(req);
          }));
        });
      });
    })
  );
});

// ── Activate: remove old caches (passive — does NOT disrupt live tabs) ─
//
// Deploy contract (Story 5): we do NOT call clients.claim() and we do NOT
// navigate live tabs. The old SW continues serving live tabs from its old
// cache until those tabs close. Once they do, the next fresh load gets
// the new SW + new cache. Users in the middle of signing in or filling a
// form are never reloaded out from under their work.
//
// We still delete OTHER stale shell caches (gbe-shell-vN where N != current)
// at activation so disk doesn't grow unbounded across deploys. This is
// safe because the activated SW is by definition not serving from those
// other caches.
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key !== SHELL_CACHE && key !== AUDIO_CACHE) {
          console.log('[SW] Removing old cache: ' + key);
          return caches.delete(key);
        }
      }));
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

  // HTML navigation requests: NETWORK FIRST, cache fallback.
  // The HTML shell controls which JS/CSS versions load via ?v=N params.
  // If we serve stale HTML, users get old scripts — defeating every fix.
  // CSS/JS/images: stale-while-revalidate (fast from cache, update in bg).
  var isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') !== -1 &&
     url.pathname.match(/\/$|\.html$/));

  if (url.origin === self.location.origin && isNavigation) {
    // HTML: always try network first — user gets latest version
    event.respondWith(
      fetch(req).then(function(response) {
        if (response && response.ok) {
          caches.open(SHELL_CACHE).then(function(cache) {
            cache.put(req, response.clone());
          });
        }
        return response;
      }).catch(function() {
        // Offline: fall back to cached HTML
        return caches.match(req).then(function(cached) {
          return cached || new Response('Offline', { status: 503 });
        });
      })
    );
  } else if (url.origin === self.location.origin) {
    // CSS/JS/images: serve cached version immediately, fetch fresh in background
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
