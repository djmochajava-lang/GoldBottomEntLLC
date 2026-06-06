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
- [ ] **Step 5 — CURRENT** — Deploy to production (commit+push, ?v bumps, SW regen).
- [ ] **Step 6** — Validate on production via Playwright: prove cache-HIT optimistic path
      (look for `[perf] auth.path = CACHE-HIT`); measure time-to-dashboard-visible delta.
- [ ] **Step 7** — Instrument dashboard → Band Player navigation (currently has NO perf
      marks). Add `band-player.load.start/ready`. Measure on production.
- [ ] **Step 8** — iPhone validation by user: force-quit Safari → reload → sign in → return
      within 24h → confirm CACHE-HIT + fast render in Web Inspector.
- [ ] **Step 9** — Update goal DoD + this doc with before/after results. Consider whether
      to add a clean `auth.signin` metric (submit → auth.ready, excluding type time) for the
      interactive first-sign-in path.

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
