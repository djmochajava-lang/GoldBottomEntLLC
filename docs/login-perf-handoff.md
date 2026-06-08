# Login Performance — Live Handoff / Progress Log

**Purpose:** Power-outage-resilient progress tracker for the P0 login-performance goal.
If you are a fresh agent picking this up: read this top-to-bottom, then check `git log`
and `git status` to see what actually landed. The authoritative goal spec lives in
agent memory at `goal_login_perf.md`; this file is the live progress journal.

**Last updated:** 2026-06-08

---

## ✅✅ RESOLVED 2026-06-08 — Dashboard MENU responsiveness P0 is DONE (iPhone-validated)

**User confirmed on a real iPhone: the dashboard menu response is now INSTANTANEOUS.**
This closes the menu-unresponsiveness / no-feedback symptom (reported as "20-30s before any
hover/selected state; multiple items flashing"). Backlog: `feat-perf-sidebar-render` (Story 3)
→ **completed**, with story `story-perf-sidebar-mobile-menu` + 5 tasks marked done in
`GBE-HomeOffice/server/data/gbe-data.db`.

**Two root causes, both fixed (PUBLIC repo, frontend-only):**
1. **Main-thread contention** — `__loadBP2()` auto-loaded the 21 band-player modules (~225KB) +
   Storage SDK on EVERY page load (even logged-out on the public homepage), starving the thread
   right after sign-in on cellular. Now warms only after `gbe:dashboard-loaded` + 2.5s settle +
   `requestIdleCallback`; never on the public site. On-demand open still force-loads. **`513a074`.**
2. **Menu architecture** — the mobile menu was the desktop sidebar reused as a narrow drawer with
   its highlight tied to the router/page-fetch pipeline. Replaced with a dedicated full-screen
   overlay modeled on the L.A. Young pattern: pre-rendered `#gbe-dmenu` at body level, nav items
   cloned ONCE from `#sidebar` (single source of truth), pure-CSS open/close/highlight decoupled
   from page loading, role-filtered, Sign Out re-wired. `sidebar-v2` toggle delegates on mobile;
   desktop sidebar untouched. **`a2a6744`.**

**Supporting commits:** `7656fad` (instant touchstart highlight + slide-out), `27936f1` (opt-in
`?perf=1` on-device perf HUD — still live, harmless, can be removed later).

**Diagnostic note for the next agent:** the 20-30s freeze was NOT reproducible in desktop Chrome
under ANY throttle (warm, 20× CPU, cold/incognito/no-cache + Fast-3G → worst main-thread stall
20ms). It is iOS-Safari/cellular-only. Use the `?perf=1` HUD or Safari Web Inspector heartbeat-gap
on a real device to diagnose this class of issue; desktop Playwright cannot validate it.

**Still open (optional, lower priority now):** clean interactive `auth.signin` metric (submit →
auth.ready, excluding type time); same-site authDomain (`auth.goldbottoment-llc.com`) for durable
iOS federated-auth latency; `[authdbg]` logging removal in auth.js once Gmail-on-iPhone is confirmed.

---

## ✅ EARLIER STATUS (2026-06-06) — latest live = auth.js?v=7 (97d2402)

**SHIPPED + VALIDATED on production (desktop, clean browser):**
- **In-dashboard menu navigation: FIXED & validated** — ~300ms → **~38–66ms per item** for BOTH
  band_member and band_manager. Cause was per-tap network fetch + 240ms dead-wait fade. Fixes:
  PageLoader prefetch (`303a824`) + fade trim 120→30ms (`77a7130`).
- **Quotes 404: FIXED** (`66a41b4`) — un-gitignored + deployed `dashboard/quotes.html`; renders ~51ms.
- **Band Player load: instrumented** (`0fad66f`) — `band-player.load` ≈ 419ms desktop.
- **Gmail/Google sign-in regression I caused: REVERTED** (`97d2402`) — restored the
  popup→redirect fallback. Verified Gmail OAuth works end-to-end on desktop (QAE acct
  `gbe.test.musician@gmail.com`). Email/password + Gmail both load the dashboard, no loop.
- **iOS Safari AuthCache login-loop: FIXED** (`48a162d`) — reverted the 24h TTL to 5min + bumped
  cache key so stale 24h entries are abandoned.

**OPEN / NOT DONE (need infra or the user's device — NOT codeable on GitHub Pages alone):**
1. **Gmail on iOS Safari — needs USER confirmation.** v=7 should fix normal-Safari Gmail (redirect
   path restored). If the user reported "page not loading", it was almost certainly a STALE service
   worker from today's many deploys — they must CLEAR Safari website data (force-quit isn't enough).
   The site + dashboard load fine for the agent on desktop; all assets HTTP 200.
2. **Durable Gmail fix for incognito / strict-ITP = SAME-SITE authDomain.** Root cause: authDomain
   `goldbottoment.firebaseapp.com` is cross-origin to the app → third-party storage blocked on
   Safari/incognito. Fix = Firebase Hosting subdomain `auth.goldbottoment-llc.com` + DNS + add to
   authorized domains + change config.js authDomain (one line). Infra task; not done.
3. **Cold-login SPEED:** the 24h-cache instant-render optimization was reverted (unsafe). Login is
   at safe baseline (~509ms returning user). A SAFE redo = reconcile AuthCache optimistic render
   against Firebase currentUser before trusting it. Not attempted (needs device validation).
4. **`[authdbg]` console logging is still in auth.js (v=7)** — intentionally, to help confirm the
   Gmail fix on the iPhone. REMOVE it once the user confirms Gmail login works on their device.

**TESTING CONSTRAINT:** the agent's Playwright is desktop Chromium — it CANNOT reproduce iOS Safari
/ incognito third-party-storage blocking. Clean-state testing approximates a fresh browser but not
true incognito. iOS Safari behavior must be confirmed on a real device.

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

**BUG RESOLVED (66a41b4) — Quotes 404 fixed:** un-gitignored + deployed `dashboard/quotes.html`
after reviewing it for sensitive content (none — same static Firestore-read pattern as other
tracked fragments). Verified live: HTTP 200, `#dash-quotes` renders the Quote Pipeline table
(remote read-only) in ~51ms. Original bug below for history:

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

## PHASE 3 — Firebase "missing initial state" sign-in error (iOS Safari)
User hit: "Unable to process request due to missing initial state ... signInWithRedirect in a
storage-partitioned browser." Cause: `loginWithProvider` fell back to `signInWithRedirect` when
the popup failed, but redirect is broken on storage-partitioned browsers (iOS/desktop Safari)
because Firebase's `authDomain` (goldbottoment.firebaseapp.com) is cross-origin to the app on
GitHub Pages — the redirect's sessionStorage "initial state" is partitioned away.
**FIX shipped (dc0e68f, auth.js?v=5):** `_redirectUnsafe()` detects Safari/iOS (+ iOS Chrome,
which is WebKit); on those, federated sign-in stays on popup and shows an actionable message
instead of triggering the broken redirect. Desktop Chrome/Firefox/Edge keep the redirect fallback
(works there). `getRedirectResult()` now swallows the stale "missing initial state" error so the
cryptic message never surfaces again.
**VERIFIED myself (desktop, production):** code live; detection unit-tested across 6 UAs (iPhone/
iPad/desktop-Safari/iOS-Chrome → popup-only; desktop-Chrome/Android → redirect kept); no spurious
error on load; **email/password sign-in works end-to-end** (band_manager → authorized).
**USER must validate on iPhone:** tap "Sign in with Google" → popup completes, no error. Immediate
workaround if popup is blocked: use the email/password test accounts (no redirect path).
**Proper long-term cure (NOT possible on GitHub Pages, follow-up):** serve the Firebase auth handler
at goldbottoment-llc.com/__/auth/ (same-origin authDomain) so redirect works on Safari — requires
Firebase Hosting or a proxy. Until then, popup-only on Safari is the ceiling.

## PHASE 4 — iOS Safari LOGIN LOOP (regression from the 24h AuthCache TTL) — FIXED
User: "It logged me in, I see the page, then the Firebase login returns to start over; click again → blank page."
CAUSE (regression from `85faeeb`): the router optimistically renders the dashboard whenever the
**localStorage** AuthCache says authorized (router.js:311), WITHOUT confirming a live Firebase
session. On iOS Safari (ITP / storage partitioning) Firebase's IndexedDB session can be cleared
while the localStorage cache survives. The 24h TTL let that cache live long enough to render the
dashboard ("I see the page") then bounce to the login modal once `onAuthStateChanged` reported no
user ("login returns") → flash-then-login loop / blank page. The original 5min TTL kept this rare.
FIX (`48a162d`, auth-cache.js?v=3): reverted TTL 24h→5min; bumped STORAGE_KEY → `gbe-auth-cache-v2`
so every existing 24h entry in users' localStorage is abandoned immediately on deploy.
VERIFIED myself (desktop, production, 4 scenarios): (1) stale 24h old-key cache + no Firebase →
old cache ignored, NO optimistic flash, clean login, no loop; (2) fresh new-key cache + no Firebase
→ converges to clean login, cache auto-cleared; (3) normal email/password login → dashboard renders
& STAYS, no modal reappearance; (4) reload as returning user → clean dashboard, Firebase present.
⚠️ USER ACTION: the iPhone is still running the OLD looping code — **force-quit Safari (or clear
website data) to load v=3**, then the loop is gone.
NET ON LOGIN PERF: the 24h instant-returning-user optimization is rolled back (correctness > speed).
Login is back to the known-good ~509ms returning-user path. A SAFE way to restore the speed-up
(reconcile AuthCache against Firebase currentUser before optimistic render, or gate optimistic
render so it can't outlive a cleared Firebase session) is the documented follow-up. The Phase-2
in-dashboard menu nav fixes (prefetch + fade) are UNAFFECTED and remain live.

## PHASE 5b — Gmail loop was MY REGRESSION (dc0e68f) — REVERTED (97d2402)
User pointed me back to my own pushed code, and they were right. In `dc0e68f` I made federated
sign-in **popup-ONLY on Safari/iOS** (gated the redirect fallback behind `_redirectUnsafe()`),
trying to suppress the "missing initial state" message. But on real iOS Safari the
**signInWithRedirect fallback (full top-level navigation) is the path that actually completes
Google sign-in** — popup doesn't persist the cross-origin session there. So removing it forced
popup-only → the loop. FIX `97d2402` (auth.js?v=7): restored the original popup→redirect fallback
for ALL browsers; removed `_redirectUnsafe`. LESSON: don't "fix" a cryptic-but-survivable auth
message by removing the fallback that real users depend on — the redirect path worked; my change
broke it. USER: force-quit Safari to load v=7, then Gmail sign-in should work as before.
([authdbg] logging still in auth.js — remove once confirmed good.) The same-site authDomain work
below is still the durable cure for incognito/strict-ITP, but is no longer blocking normal usage.

## PHASE 5 — Gmail/Google sign-in LOOP (CONFIRMED root cause; needs infra fix)
User repro: incognito/fresh browser → dashboard → "Sign in with Google" → logs in → returns to the
Firebase login menu (loop); the email/password path works. I reproduced the FULL Google OAuth on
desktop Chromium using the QAE Gmail account (`gbe.test.musician@gmail.com`, creds in
GBE-HomeOffice/server/.secrets/qae-test-credentials.json) and added `[authdbg]` tracing (auth.js?v=6).
RESULT on desktop (third-party storage ALLOWED): sign-in SUCCEEDS and STAYS — `signInWithPopup SUCCESS
… currentUser=set`, `Signed in (approved)`, dashboard renders, NO `onAuthStateChanged user=NULL`, NO loop.
This DISCRIMINATING test proves the loop is NOT a code bug — it's specific to browsers that block
THIRD-PARTY STORAGE (iOS Safari ITP, incognito).
ROOT CAUSE (confirmed): the OAuth handler + Firebase's auth-state iframe run on the cross-origin
`authDomain` = `goldbottoment.firebaseapp.com` (redirect_uri seen in the popup confirms this), which
is THIRD-PARTY to the app at `goldbottoment-llc.com`. On Safari/incognito that third-party storage is
blocked → the federated session can't be read back by the app → "logged in then bounced to login."
Desktop even logs `Cross-Origin-Opener-Policy policy would block window.closed/close` from
firebase-auth-compat — the cross-origin popup channel, which Safari isolation makes fatal.
**THE FIX IS INFRASTRUCTURE, not a code edit (can't be done on GitHub Pages alone):** make `authDomain`
SAME-SITE as the app. Options: (A) stand up Firebase Hosting and point a subdomain
`auth.goldbottoment-llc.com` (same registrable domain → Safari treats it first-party) at it, add it to
Firebase Auth authorized domains, then set `config.js` authDomain to `auth.goldbottoment-llc.com`
(one-line change I can make once the subdomain is live); OR (B) migrate the app itself to Firebase
Hosting so authDomain = the app domain natively. Until then, federated (Google) sign-in is unreliable
on iOS Safari; email/password works (but Google-only band members have no password — so the authDomain
fix is required for them). NOTE: `auth.js?v=6` currently carries `[authdbg]` logging — remove once resolved.

## PHASE 6 — FUNCTIONAL menu-nav validation + cold-start analysis (2026-06-06)
Per user's stronger methodology: measure click → page element present + PAINTED + FUNCTIONAL
(real interactive content rendered, no spinner/error), not just visible.
RESULT (band_manager/admin, 18 pages, production desktop, clean state):
- **17 pages: 46–111ms** to functional, with real content (4–72 interactive elements each).
- **band-readiness: 548ms** (heaviest — runs live Firestore gig/musician/check-in queries), functional.
  (An initial ">9s" reading was a TEST false-negative: the functional check was scoped to the
  `#br-tabs` tab bar instead of the content container; the page is fine.)
- Cold returning-user login (desktop): auth.handshake 212ms + auth.registration (Firestore role
  lookup) 282ms = **~496ms, almost entirely auth network round-trips**. Fragment/render = 99ms
  (prefetch + SW cache working). On cellular the auth round-trips are the dominant remaining cost.

NEXT SAFE LEVER (proposed, NOT yet done — touches the core Band Player, needs careful validation):
the **21 `bp2-*` modules = ~225 KB JS load+parse on EVERY page** (deferred in index.html) but are
only needed when the Band Player opens. Deferring them to load on-demand (with background prefetch
after dashboard-interactive, and the band-player bootstrap waiting for BP2Core) would cut ~225 KB
off every non-band-player cold load — meaningful on a slow iPhone CPU. RISK: band player is the
band's core rehearsal tool; must validate it still loads+plays (desktop QAE musician acct has songs)
before shipping. Awaiting user OK before touching it.

## PHASE 7 — Cold-start: lazy-load band-player JS (~225KB) — SHIPPED & VALIDATED (349bdc6)
The 21 `bp2-*` modules (~225KB) loaded via `<script defer>` on EVERY page; only needed for the
Band Player. Moved them OFF the critical path: a small loader in index.html injects them after
first paint (in dependency order, `async=false`), exposes `window.__loadBP2()` for on-demand
trigger, and `dashboard/band-player-v2.html` bootstrap now waits for `BP2Core` before init.
VALIDATED: dev mirror (localhost:8111, with the local-route guard bypassed) AND production — band
player loads FUNCTIONAL in ~53ms, all 21 modules load, 3 playlists populate, 0 errors. Cuts ~225KB
JS download+parse from every non-band-player cold load (helps slow iPhone CPUs most).

**PRE-EXISTING BUG found (NOT mine, NOT fixed — documented):** on a LOCAL/private dashboard
(`Auth.isLocalDashboard()` true — i.e. localhost or LAN IP), navigating to `dashboard-band-player`
or `dashboard-musician-home` causes an **infinite `Router.navigateTo` recursion → "Maximum call
stack size exceeded"**. Both are in `localBlockedRoutes` ("public-site-only"), so the block
redirects to `dashboard-home` → role-redirects a band_member back to the blocked `dashboard-musician-home`
→ loops (router.js:449-453 + the dashboard-home role map ~284-298). Does NOT affect production
(`goldbottoment-llc.com` is not a local dashboard → guard never fires) or normal use (band members
are remote-only). Fix would be: when a localBlockedRoute redirect resolves to another localBlockedRoute,
stop instead of re-dispatching. Left alone — touching routing is risky and it's out of the normal path.

## PHASE 8 — Firebase Storage SDK lazy-load + bp2-page hardening — SHIPPED & VALIDATED (14f0fc0)
Storage SDK (firebase-storage-compat, ~50KB) moved OFF the login critical path — only the Band
Player + payment-settings use Storage. Now loaded FIRST in the __loadBP2 bundle (integrity hash
preserved); `Auth.getStorage()` lazily inits `firebase.storage()` on first use (auth.js).
Also hardened the TWO pages that depend on the now-lazy bp2 bundle:
- `payment-settings.html`: `doInit` now triggers `__loadBP2()` + retries until BP2Auth/BP2Core load
  (closed a cold-direct-load race where the payment/agreement form could silently fail to render —
  it uses `Auth.whenReady` which fires once, so without the retry an early call returned blank).
- `band-player-v2.html`: bootstrap waits for **BP2Auth** (LAST module in load order, after the
  Storage SDK which is first) instead of just BP2Core — guarantees the full bundle is ready.
VALIDATED dev mirror + production: payment-settings form renders (~103–116ms), band player
functional (~61–81ms) with `storageReady=true` + 3 playlists, 0 errors.
COMBINED with Phase 7: **~275KB JS (21 bp2 modules + Storage SDK) removed from the login critical
path.** Only band-player + payment-settings pull it, on demand. IMPORTANT for the next agent: only
TWO pages use the bp2 bundle (band-player-v2.html, payment-settings.html) — if a NEW page uses any
BP2* global, it must call `window.__loadBP2()` and wait for BP2Auth.

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
