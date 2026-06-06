# Login Performance — Live Handoff / Progress Log

**Purpose:** Power-outage-resilient progress tracker for the P0 login-performance goal.
If you are a fresh agent picking this up: read this top-to-bottom, then check `git log`
and `git status` to see what actually landed. The authoritative goal spec lives in
agent memory at `goal_login_perf.md`; this file is the live progress journal.

**Last updated:** 2026-06-06 (session 1f5ffe48 continuation)

---

## The Goal (one line)
Make band-member login on the **live public site** `https://goldbottoment-llc.com` feel
fast on a **real iPhone**. This is a PRODUCTION issue — measure/verify ONLY against the
live public site (dev ports 9111/4000 do NOT reproduce real network/Firebase/SW behavior).

## Hard Constraints (do not violate)
1. **Two production systems.** The private GBE HomeOffice server (LAN :3000) is ALSO
   production (SoR = home office SQLite). Firebase = resilience cache so the public site
   works when the home office is offline. NEVER break the private site; never assume the
   LAN server is reachable during remote login (`_serverUrl = null` for remote users).
2. **No repo sync.** Public (`GoldBottomEntLLC/`) and private (`GBE-HomeOffice/`) repos are
   independent since 2026-03-25. This work touches the PUBLIC repo only. Never mirror edits.
   (The stale "MANDATORY SYNC RULE" in CLAUDE.md is obsolete — ignore it.)
3. **All [perf] marks must `console.log('[perf] ...')`** — the user reads them from Safari
   Web Inspector on the iPhone. `performance.mark()` alone is invisible on device.
4. **SW cache regen on every JS/CSS/HTML change** (pre-commit hook) + bump `?v=N` on changed
   files in `index.html` manually.

## Test Credentials (live site)
- Musician: `musician@gbe-test.local` / `TestPass2026!MU`
- Login modal fields are `readonly` (anti-autofill): in Playwright, `click()` the field THEN type.
  There are decoy empty `email`/`password` inputs; the real fields have dynamic names
  (`gbe-auth-email-<ts>`, `gbe-auth-pw-<ts>`). Verify value length before submitting.

---

## ROOT-CAUSE DIAGNOSIS (confirmed 2026-06-06)

**Production cold baseline (Playwright desktop, fast network):**
- Already-signed-in cold reload: `auth.total` = **509ms** (handshake 207 + registration 302). Fast.
- Interactive first sign-in: `auth.total` is MEANINGLESS (spans human modal/type time, measured 83s).
  Real machine cost ≈ handshake 448 + registration 381 + dashboard 310 ≈ 700ms.

**Why it feels slow on a real iPhone (user-confirmed: "login genuinely feels slow"):**
`AuthCache` (instant-render cache, `js/auth-cache.js`) had a **5-minute TTL**, but the app
enforces a **24-hour sliding session** (`auth.js:353-363`). So a band member returning >5min
later ALWAYS missed the cache → forced down the BLOCKING path in `router.js:325-334` (show
skeleton, queue route, wait for full Firebase SDK init + Firestore role lookup). ~509ms on
desktop, but 1.5-3s on real cellular = "feels slow." Cache HIT (`router.js:311`) renders the
dashboard instantly and revalidates Firebase in the background.

---

## THE FIX (implemented, see git status — may be uncommitted/committed depending on where you are)

3 files, all PUBLIC repo, all frontend-only, all pass `node --check`:
1. `js/auth-cache.js` — **TTL 5min → 24h** (`24 * 60 * 60 * 1000`), aligned with the 24h
   session policy. THE core fix. Returning users render instantly from cache.
2. `js/router.js` — `[perf]` logs at the cache-hit and cache-miss branches so the iPhone
   shows `auth.path = CACHE-HIT (instant)` vs `CACHE-MISS (blocking on Firebase)`.
   Added marks `auth.cache.hit` / `auth.cache.miss` + measure `auth.cache.hitToRender`.
3. `js/auth.js` — after `__gbePerf.reset()` on logout, re-mark `boot.start` so in-session
   re-login loops produce a valid `auth.total` instead of silently recording null.

**Safety of the TTL change:** background `onAuthStateChanged` verify runs every load and
ejects signed-out (clears cache + redirects, `auth.js:496,509`) and denied (`signOut`,
`auth.js:466`) users. Firestore security rules are the real data gate — optimistic render
only shows the role-appropriate SHELL, never unauthorized data. 24h cache never outlives
the session. Trade-off: a revoked user may see the shell for ~0.5-3s before background boot.
(Note: `auth.js:471-483` fail-OPENS to admin role on Firestore error — pre-existing, flagged
"per IDP-001 §7.2", NOT touched by this work.)

**Deploy mechanics:** bump `?v=` in `index.html` — router.js v10→v11, auth-cache.js v1→v2,
auth.js v3→v4. Pre-commit hook regens SW hashes. Push master → GitHub Pages auto-deploys.

---

## PLAN & PROGRESS

- [x] **Step 0** — Correct the goal: production-only framing + two-production-systems
      guardrail. Recorded in `goal_login_perf.md`, `feedback_data_architecture.md`, `MEMORY.md`.
- [x] **Step 1** — `auth.total` clean baseline: sign-out reset already shipped (`22cbfce`);
      added boot.start re-mark for in-session robustness.
- [x] **Step 2** — Measure production cold baseline (done; 509ms returning-user).
- [x] **Step 3** — Diagnose returning-user slowness → 5min TTL root cause.
- [x] **Step 4** — Implement fix (TTL→24h + perf logging + boot.start re-mark).
- [x] **Step 5** — Deployed: commit `85faeeb` pushed to master (22cbfce..85faeeb). ?v bumps
      (router v11, auth-cache v2, auth v4), SW hashes regenerated by pre-commit hook.
      NOTE: the hook also regenerated `GBE-HomeOffice/sw.js` (private repo) — left UNCOMMITTED
      on purpose (out of scope; committing private is not part of this work). No private source
      touched. GitHub Pages auto-deploys in ~1-2 min after push.
- [x] **Step 6** — Validated on production (Playwright, 2026-06-06). RESULTS:
      * New code confirmed live (router.js?v=11, auth.js?v=4, auth-cache TTL=86400000).
      * `[perf] auth.path = CACHE-HIT` fires on production — optimistic path works.
      * Clean cold load landing on dashboard: dashboard visible at **390ms**, and
        `dashboard.loaded` (390ms) fired BEFORE `auth.ready` (444ms) — proving the dashboard
        renders before Firebase finishes verifying. auth.handshake ~222ms, auth.total ~444-488ms.
        No main-thread blocking (heartbeats steady 250ms), 0 console errors.
      * KEY INSIGHT: on fast desktop, Firebase WINS THE RACE — it restores auth and rewrites
        the cache before the router reads it, so cache-hit vs cache-miss is indistinguishable
        (~390-671ms either way). The 24h cache's value only materializes when Firebase is SLOW
        (real iPhone/cellular), where it skips a 2-3s wait. Desktop CANNOT show this win — that
        is exactly why iPhone validation (Step 8, user's role) is the real proof.
      * (Ignore the earlier 24127ms `auth.cache.hitToRender` reading — artifact of back-to-back
        goto hash-nav, not a real perf signal; heartbeats proved no blocking.)
- [x] **Step 7** — Instrumented Band Player load. `band-player.load.start` marked in
      `dashboard/band-player-v2.html` just before `BP2Core.init()`; `band-player.load.ready`
      + measure `band-player.load` marked in `bp2-render.js` `_render()` on first playlist
      render (one-time guard, reset in `BP2Render._reset`). Emits `[perf] band-player.load = Xms`.
      NOTE found while instrumenting: the bootstrap polls for `Auth.initialized` every 200ms and
      `db` every 500ms with a 300ms initial delay (`band-player-v2.html:410,415,439`) — built-in
      latency that hurts on slow devices; candidate optimization once measured on iPhone.
      VALIDATED on production (commit 0fad66f live): `band-player.load = 419ms` desktop
      (BP2 bootstrap → first playlist render; test musician has 3 playlists, 48-song inventory).
- [ ] **Step 8 — AWAITING USER (iPhone ground-truth)** — Validation script below.
- [ ] **Step 9** — After iPhone numbers come in: update goal DoD with before/after; decide on
      `auth.signin` metric (submit → auth.ready, excluding type time) for first-sign-in; consider
      whether the band-player bootstrap polling (200/500/300ms) is worth optimizing.

## PHASE 2 — In-dashboard menu navigation (user: "menu items not responding at acceptable rate")
User tests as **band manager** (the test account `band.manager@gbe-test.local` actually has
Firestore role=**admin** → lands on `#dashboard-admin`, 19 visible menu items). Both band_manager
and band_member must be fast.

**Measured production scorecard (desktop, clean browser, 2026-06-06):**
- band_member (6 items): each settles ~285-360ms; Band Player ~1.6s; ZERO main-thread blocking.
- admin/band_manager (19 items): each settles ~290-520ms; Band Player ~0.9s; ZERO blocking.
- EVERY item dominated by `nav.fragment` ≈ **300ms = the network fetch of the HTML fragment**.

**Root cause:** every menu tap re-fetches the page fragment over the network because:
1. `page-loader.js` cache-busts every fragment fetch with `_v=Date.now()` (unique URL → SW/HTTP
   cache never matches). 2. The SW is **network-first for all `.html`** (`sw.js:313-337`).
3. Only **1 of 39** dashboard fragments is precached in the SW. So first-in-session taps always
   hit the network. ~300ms desktop → multi-second on cellular = the unresponsiveness.
(Repeat taps of the same item are fast — served from PageLoader's in-memory `this.cache`.)

**FIX shipped (PageLoader-only, low risk — no SW-strategy change):**
`page-loader.js` `prefetchMenuFragments()` — after the first dashboard page loads, warms the
in-memory cache for ALL visible menu fragments in the background (idle-scheduled, sequential).
Once cached, `loadPage()` serves them synchronously with zero network → menu taps render instantly.
Logs `[perf] menu prefetch complete: N fragments warmed`. Cache-bust kept (freshness preserved);
taps after prefetch never fetch, so it doesn't matter. `page-loader.js?v=3 → v=4`.

**FIX #2 shipped — the bigger, device-independent win:** the content containers have NO CSS
opacity transition (computed transition-duration = 0s), so PageLoader's `fadeOut`+`fadeIn`
`setTimeout(120ms)` were **240ms of pure dead wait per navigation with zero visual effect.**
Trimmed `transitionDuration` 120 → 30ms. Saves ~180ms on EVERY nav, every device. `page-loader.js?v=5`.

**RIGOROUS MEASUREMENT (per user: measure click → the target page's ELEMENT is visible, not just
that the link was clicked).** Per-page confirm selector = `#dash-<name>` (e.g. `#dash-roster`),
`#dash-band-player-v2`, `#br-tabs` (band-readiness). Harness clicks the real sidebar link and polls
until that element has layout + is visible. After prefetch (pre-fade-fix), desktop click→visible
was ~135–167ms for all working pages. Re-measure after the fade fix should drop further.

**BUG FOUND — Quotes is broken on remote (404):** `dashboard/quotes.html` is **gitignored**
(`.gitignore:50`) so it was never deployed → live site returns HTTP 404 → band managers tapping
"Quotes" get a "Failed to load" error. Route intends it to work remotely (router.js:157, allowed for
admin/band_manager). DECISION NEEDED (user): either (a) un-gitignore + deploy quotes.html if its
content is safe for the public repo, or (b) hide the Quotes nav item on remote. NOT auto-fixed —
publishing a deliberately-gitignored file could expose sensitive pricing/quote logic.
(27 of 39 dashboard fragments are tracked; the other 12 are intentionally local-only. `dashboard-claude-agent`
is local-only and correctly 404s on remote — its nav item probably shouldn't show for this account.)

**Deferred (more efficient but higher risk — NOT done):** make the SW serve dashboard fragments
cache-first (narrow network-first to the shell only) AND precache all 39 fragments at install.
That would make first-visit-ever instant and avoid per-session re-download. Left for a deliberate,
clean-browser-validated change. See sw.js:313-337 + the precache ASSETS list (only band-player-v2.html).

**VALIDATED before/after (clean browser, desktop, rigorous click→element-visible, band_manager 17 items):**
```
Original (network fetch per tap + 240ms dead-wait fade):  ~300ms/item
After prefetch (network fetch eliminated):                ~135-167ms/item
After fade-delay removal (BOTH fixes, shipped):           ~37-66ms/item   ← all under 100ms "instant"
```
Both fixes live: `85faeeb`(login) `0fad66f`(bp) `303a824`(prefetch) `77a7130`(fade). Shared by band_member + band_manager (same PageLoader). iPhone gain will be larger (prefetch also kills the cellular fetch). USER must re-validate on iPhone — they tested BEFORE these fixes.

## FINDINGS / FOLLOW-UPS discovered this session
- **Deep-link redirect bug (not login-perf, but real):** a band_member who DEEP-LINKS to
  `#dashboard-band-player` on a cold load gets bounced to their role home (`#dashboard-musician`)
  the moment Firebase `auth.ready` fires (~post-auth role-home redirect in router.js). Normal
  in-app navigation (tap Band Player after auth resolved) is unaffected. Worth fixing separately
  so bookmarks/PWA deep links to the player work. Repro: cold-load `#dashboard-band-player` signed in.
- **Testing gotcha (for the next agent):** the browser HTTP disk cache serves a stale `index.html`
  even after SW unregister + CacheStorage clear. To force the very latest deploy in a test browser,
  load the root with a query cache-bust: `https://goldbottoment-llc.com/?fresh=1#...`. On a real
  iPhone, force-quit Safari achieves the same.
- **Band-player bootstrap polling:** `band-player-v2.html:410,415,439` polls Auth/db every
  200/500ms with a 300ms initial delay — adds latency on slow devices; candidate optimization.

## ⏳ STEP 8 — iPhone validation script (USER ACTION)
1. Force-quit Safari (swipe up) to drop the cached service worker.
2. Open `https://goldbottoment-llc.com` and sign in (or you're already signed in).
3. Open Safari Web Inspector from the Mac (Develop → [iPhone] → the page).
4. In the console, look for these `[perf]` lines:
   - On return within 24h: `[perf] auth.path = CACHE-HIT (optimistic, instant render — no Firebase wait)`
     → login should feel instant. If you instead see `CACHE-MISS`, the cache expired/cleared.
   - Tap Band Player → `[perf] band-player.load = Xms` → report the number.
5. Tell the agent: did login FEEL faster, and what were the `auth.total` / `band-player.load` numbers?

## Key Files
- `js/auth-cache.js` — the cache (TTL lives here)
- `js/router.js` — optimistic vs blocking auth path (lines ~307-340)
- `js/auth.js` — auth init, onAuthStateChanged (line ~337+), 24h session (353-363), logout (1487)
- `js/perf.js` — Perf.mark/measure, window.__gbePerf, auth.total measured on `gbe:auth-ready`
- `index.html` — script `?v=` versions to bump

## How to measure on production (Playwright)
1. Fresh navigate `https://goldbottoment-llc.com`, confirm logged-out (`#home`, login modal).
2. Click Dashboard (e17) → click email field → type email → click pw field → type pw → Sign In.
3. Read `window.__gbePerf.measures` and console `[perf]` logs.
4. For cache-hit test: reload within 24h while signed in → expect `auth.path = CACHE-HIT`.
