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
var SHELL_CACHE = 'gbe-shell-v39';
var AUDIO_CACHE = 'bp-offline-audio'; // Owned by BandPlayer — never delete this cache

// SHA-256 hashes of precached assets — populated by generate-sw-hashes.js
var GBE_BUILD = '2026.08.21-0414.2c476a5';
var ASSET_HASHES = {
  './css/base.css': '2a43744f37cfb253154beefd8cb0e6c2054c11cf72f1041434a2c9d3cce630ab',
  './css/layout.css': '8fcda4a8cfbff5da7a66f651eeb6846eb8c4cf23058006c3ff06dd3e99789e54',
  './css/components.css': '6f570f9a4aaa3c36d36fb09c9c54ce6df43474ec2516834c15e75d9ca9b7130b',
  './css/sections.css': 'e9218a68c262d4a3d8767c1a3f305c3c1e0ab5693598319aa434991678535b29',
  './css/pages.css': '10b388c8d0d39bc508a028fe9dfeefa89b3415af7fc8104d194aab71d909afa2',
  './css/dashboard.css': 'c70fe8411bbcce30dcfd574301e7423f21113174f99c56fa3d3eb9863f9ca033',
  './css/animations.css': '97ae5536821674cf9ead7114e508260b951ffb5885127a538861a28f3ddbc85c',
  './css/responsive.css': 'bee3150eedac7fbb0a0910c42682f196dee864c7da6dfeea0f29110ea3b8bbe7',
  './js/build.js': '5fb13bafda7083bb4d3481070b46d2cd53e3e26de9b71408772ae4af4467e9a9',
  './js/config.js': '3a1c13c57f5d2eabada50937b9bb90c3ea5529b2506ad8b11bb215de85556842',
  './js/utils.js': '49dc7ead1f12a1d817f2a1d182ced257c2c0842f6fd649444d7687ad2be95c38',
  './js/mobile-detect.js': 'a5fc7d286ca4497e9a88f72c9cf092d207ad0875fa2b45dc550287e62daaf94e',
  './js/toast.js': '74bfec8e52dbd0cc437b09851756f642d268ba21c2b28cd3563c3ca703f146f4',
  './js/modal.js': '0954ed6565e7e66c7b4bd2999106986eb2856efe63f1f8c199c2c4212f48361a',
  './js/auth.js': '9c62ddfe931b63d7cc3799554190c9d82e450c0df9a5c79b3523eabf64ad4b4e',
  './js/page-loader.js': '4148f5c97d106c034f9524723b5838342c028fc6eceff6b76f9cf34ecc34330a',
  './js/scroll-animations.js': '8432cbd23b9bd38d07f0a081a1cafc8cdc30ef55f9f6b2c7a4cca4db6cc9cef1',
  './js/router.js': 'f8cfee182628ff87003e568a953d9a3e4fb021b0580b83208112b296efac801c',
  './js/navigation.js': 'a18c890b22580388af444e9b164935d0e7bd8589dfcbe9a4899cea2b78893254',
  './js/sidebar.js': '629752996e35c993c2b16cd0c02cbeec060226cfe4877b6b2f828e8d81eba312',
  './js/auth-cache.js': '4790c386f084a9764f7fda46348c6846b3bdab7e0fce536cf59b7b516c6588d2',
  './js/sidebar-v2.js': '822146e4ef9d261bc58bf0de5f51121d14541dc4adb85e4b67ca295e2e947e21',
  './js/data-store.js': '946c2d347c47a913915bf670877835a8ca94d48fb0dd3a4e3b8392badba35660',
  './js/forms.js': '8f7e8303d873734db662a8d532163eeffe649528186877dc90b92f71f8841750',
  './js/table-manager.js': '48472d850800b118c57e850844a3dff7121fa661db818f238afd0135daa40ca8',
  './js/dashboard-widgets.js': '689cf2f3529404f220e4ac2d4c3def22d3c3b1f4d425d2f8d21e95f86338700f',
  './js/calendar.js': 'ccd8b682e0714c56ff0e5e9bc9f4e880a5b58fb973b765e260c79fffd34b1ac5',
  './js/main.js': 'a0c2717e96b0e041d80e5a3349093c29a0206bb96a1d16fdebced18801a7c03d',
  './js/build-tag.js': 'e7481518d8d9cda649aee34d255dfc3834455c988ce96eac8c4cb6925c9e3c4d',
  './images/logo/gbe-logo.svg': '1e780d4036cf711a07d6d9091d37ce184440eda7cde4e2b2faef251c6f9219ee',
  './js/vendor/supabase-js-2.110.2.umd.js': '21035ce4ffb6f1d6c5ba5344bbac8309bf394cdbba0b1371267a05a1d811fed8',
  './css/band-player-v2.css': '20fefafa6977deeaa0d99de51d0fb286e6e1d709f9d70adfe54123f3032448d1',
  './dashboard/band-player-v2.html': 'b870a370beb3c2eeeb768f149339157729a184722d08869822df155b2e591b96',
  './js/band-player-v2/bp2-utils.js': '8fbe63449c3956ad213c7eadb0548ed23802370d69f5091148e90a6201758879',
  './js/band-player-v2/bp2-core.js': '9c0d33bcb30a7fb15ef52412dcb91fa98db285257339edd7e8035b91f68dc94d',
  './js/band-player-v2/bp2-data.js': 'ec2b15ea9a6a646560b84e4ebef718284409a320342ae9893dd77bd31173a5e9',
  './js/band-player-v2/bp2-player.js': '88fb1c39038e7a203976afdfd40f881797fbc002a35c0e95890f4400a5d2709c',
  './js/band-player-v2/bp2-playlist.js': 'adae8532c3ea7f2a6583597f5bdc36084cd4a2c2fa419ce46a132e1954abac3d',
  './js/band-player-v2/bp2-render.js': '79b7bc8fdd6aa5dd8b28919cafc65970dcad54408439ed9dac8a11096b3526df',
  './js/band-player-v2/bp2-render-edit.js': 'e4b942ee7fd429ce5afae06e195285e3f08967808677eb36d8425290a6036302',
  './js/band-player-v2/bp2-render-stems.js': '42a4c2efcf8e3142585af89ee6702d6112a8cfaee4bc9ba54afd69ff7daf9b22',
  './js/band-player-v2/bp2-offline.js': 'd75f303b8824fd104f99b23f22c682904197d1947812d8f50805d9b75b8ea9a7',
  './js/band-player-v2/bp2-stems.js': 'b2066180cd0b39f851d65b8ddca72d62ea286c3a37ddb5067c5668fe6fbe5ff9',
  './js/band-player-v2/bp2-mixer.js': '0a3dfd66e4281a05c0a7ca2dad52b9112bdd350b393c6024ecc14be92bed530e',
  './js/band-player-v2/bp2-transport.js': '769c44fb0ae86f64c62a426a4f497b85124b6934fa8dd6a997cbee4235c6f1f4',
  './js/band-player-v2/bp2-practice.js': '4b4428730733e4ed2e903464f454261cb7c0bd7f051a5158cf24e99794120158',
  './js/band-player-v2/bp2-charts.js': 'b276b26674ff401c4432a96bfb9467e593286c9df55ddeaea98b77e737221cd9',
  './js/band-player-v2/bp2-lyrics.js': '5ae039ad37a25542b33cf807f0f2ce7505f53a1573b031e732d2b110f6552cb5',
  './js/band-player-v2/bp2-notes.js': '9cf4487646d142ecd46fbb68b6857c6e841a3a007bef3226ee8ac2412ea771dc',
  './js/band-player-v2/bp2-upload.js': '1add57ac665bfc5e88f6c3e9ba9a55e620cb1885db915ffaf019a7aa83c2163d',
  './js/band-player-v2/bp2-permissions.js': 'd02380492e38ccb60b502042e2f7758010e32ab003755a949e3f7250ee64d512',
  './js/band-player-v2/bp2-edit.js': '1cb8f78ecee8da083ae7299479d78ba305e458276d77a2322896b9a38cf69ab8',
  './js/band-player-v2/bp2-integration.js': 'b716e69c02c94a86d12221e4ce70523463f849b899cf2d0946f6d83f6bef97a1',
  './js/band-player-v2/bp2-progress.js': 'b8366d73b421e9215d183b273ee1865f509e691fb27a88749a3ad16139873467',
  './js/band-player-v2/bp2-auth.js': '6039c5a29ba821922e120c792b82c7bc6e88bcf195254305c919a33581d71cc2'
};

// Supabase backend hostname(s) — never intercept; the supabase-js SDK manages
// auth (PKCE token exchange, session refresh), Postgres REST, and Storage signed
// URLs directly. Intercepting these would break the OAuth ?code= exchange and
// token refresh. (Week-3 Supabase Auth cutover; also covers band-media Storage.)
var SUPABASE_API_HOSTS = [
  'rklvvuzedmadydmohouu.supabase.co',
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
  // Supabase JS v2 UMD — self-hosted, version-pinned vendor copy
  // (story-supabase-js-sri-pin). Same-origin, so the ASSET_HASHES integrity
  // gate covers the auth SDK; also makes auth offline-capable/outage-immune.
  './js/vendor/supabase-js-2.110.2.umd.js',
  // Band Player v2.0
  './css/band-player-v2.css',
  './dashboard/band-player-v2.html',
  './js/band-player-v2/bp2-utils.js',
  './js/band-player-v2/bp2-core.js',
  './js/band-player-v2/bp2-data.js',
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

  // Skip Supabase backend calls — supabase-js manages auth/PKCE/REST/Storage
  // directly; intercepting would break the OAuth code exchange + token refresh.
  var isSupabaseApi = SUPABASE_API_HOSTS.some(function(host) {
    return url.hostname === host;
  });
  if (isSupabaseApi) return;

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
    // Auth-critical JS → NETWORK-FIRST (always fresh, like HTML). Serving STALE
    // auth code strands returning users on broken login after a deploy (e.g. an
    // old cached config.js with a pre-fix authDomain → storage-partition failure
    // → bounce to homepage). This removes the dependency on manually bumping ?v=.
    // Falls back to cache only when offline.
    if (/\/js\/(config|auth|router|auth-cache|main)\.js$/.test(url.pathname)) {
      event.respondWith(
        fetch(req).then(function(response) {
          if (response && response.ok) {
            var freshClone = response.clone();
            caches.open(SHELL_CACHE).then(function(cache) { cache.put(req, freshClone); });
          }
          return response;
        }).catch(function() {
          return caches.match(req).then(function(cached) {
            return cached || new Response('', { status: 503, statusText: 'Offline' });
          });
        })
      );
      return;
    }
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
    // Cross-origin (Google Fonts, Font Awesome CDN — supabase-js is now
    // self-hosted + precached same-origin, story-supabase-js-sri-pin):
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
