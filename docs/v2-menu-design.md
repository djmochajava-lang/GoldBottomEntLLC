# V2 Dashboard Menu System — Design Document

**Date:** 2026-04-23
**Status:** Design review — awaiting CEO approval before implementation
**Problem:** Dashboard sidebar menu is unresponsive on iPhone. Taps are swallowed for 2-8 seconds while Firebase auth initializes. The site is unusable on mobile for band managers, band members, and artists.

---

## Design Principles (from industry analysis)

These six principles govern every decision in this document:

1. **Menu click = immediate visual response (< 200ms).** Auth verification is a separate concern that never blocks the menu toggle or link tap.
2. **Trust cached auth state for UI. Verify in background.** On page load, read cached role/authorized state from localStorage. Render the dashboard optimistically. Fire background re-validation.
3. **Auth SDK is not a critical-path dependency.** The app shell (including the menu) must work before Firebase loads.
4. **Menu visibility and route access are two separate systems.** A centralized permission utility filters menu items. Route guards independently verify on navigation. They do not block each other.
5. **Service workers never force-reload without user consent.** Show a notification. Let the user decide when to reload.
6. **Components have single responsibilities and dependencies point inward.** UI components depend on state. State depends on infrastructure. Never the reverse.

---

## Current Architecture Problems

### The Circular Dependency Problem

```
Auth ──calls──▶ Router.navigateTo()  (pending route after login)
Router ──calls──▶ Auth.guardRoute()  (every navigation)
Auth ──manipulates──▶ Sidebar DOM    (_updateRoleUI sets display:none)
Router ──manipulates──▶ Sidebar DOM  (closeMobileMenus)
Sidebar ──calls──▶ Auth.isLocalDashboard() (inbox badge)
```

No component has a clean boundary. Every object reaches into every other object.

### The Synchronous Gate Problem

```
User taps "Roster" link
  → Router.navigateTo('dashboard-roster')
    → Auth.guardRoute() checks _initializing flag
      → if _initializing === true → return false → TAP SWALLOWED
      → no visual feedback, no redirect, no loading state
```

`guardRoute()` is a synchronous boolean gate sitting in the middle of an async pipeline. When it returns `false`, the user gets silence.

### The No-Cache Problem

Every page load runs the full auth flow from scratch:
1. Firebase `onAuthStateChanged` (async, 1-3s)
2. Firestore `_checkRegistration()` (network read, 1-5s)
3. Only then: `_initializing = false`, navigation unblocked

During this 2-8 second window, every dashboard tap does nothing.

---

## V2 Architecture

### Core Principle: The menu is a pure UI component with zero auth dependencies.

```
┌─────────────────────────────────────────────────┐
│                    index.html                     │
│                                                   │
│  ┌──────────────┐    ┌──────────────────────┐    │
│  │ SidebarV2    │    │ dashboard-content     │    │
│  │ (pure UI)    │    │ (page fragments)      │    │
│  │              │    │                        │    │
│  │ • toggle     │    │  Loaded by PageLoader  │    │
│  │ • open/close │    │  after auth clears     │    │
│  │ • nav links  │    │                        │    │
│  │ • role filter│    │                        │    │
│  │   (from      │    │                        │    │
│  │    cached    │    │                        │    │
│  │    state)    │    │                        │    │
│  └──────────────┘    └──────────────────────┘    │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ AuthCache (new) — localStorage layer      │    │
│  │  • read on page load (sync, < 1ms)        │    │
│  │  • provides role + authorized for UI       │    │
│  │  • background verify updates cache         │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ Auth (existing) — Firebase/PIN layer      │    │
│  │  • init runs in background                 │    │
│  │  • on resolve: updates AuthCache           │    │
│  │  • emits 'gbe:auth-ready' event            │    │
│  │  • NEVER blocks navigation                 │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### New Files

| File | Purpose | Size Est. |
|------|---------|-----------|
| `js/sidebar-v2.js` | Pure UI sidebar controller — toggle, nav links, role filter from cache | ~120 lines |
| `js/auth-cache.js` | localStorage read/write for cached auth state (role, authorized, expiry) | ~60 lines |

### Modified Files

| File | Change |
|------|--------|
| `index.html` | Add V2 toggle button (second hamburger, different class). Add `sidebar-v2.js` and `auth-cache.js` to sync script block. |
| `js/router.js` | `navigateTo()` reads from `AuthCache` instead of calling `Auth.guardRoute()`. If cache says authorized → proceed immediately. If cache is empty/expired → show loading skeleton in content area (not block). |
| `js/auth.js` | After auth resolves, write to `AuthCache` and emit `gbe:auth-ready` event. Remove `_pendingRoute` logic — Router handles its own pending state. Remove `_updateRoleUI()` — SidebarV2 handles its own role filtering. |

### NOT Modified (V1 stays intact for other users)

| File | Why |
|------|-----|
| `js/sidebar.js` | V1 sidebar stays for all non-band_manager roles during testing |
| `js/navigation.js` | Public menu is working fine — don't touch it |

---

## Component Design

### AuthCache (js/auth-cache.js)

```
AuthCache = {
  STORAGE_KEY: 'gbe-auth-cache',
  TTL: 5 * 60 * 1000,  // 5 minutes

  read()    → { role, authorized, activeRole, linkedRoles, expiry } | null
  write(data) → saves to localStorage with Date.now() + TTL expiry
  clear()   → removes from localStorage
  isValid() → cache exists AND expiry > Date.now()
}
```

**When it's written:**
- After `Auth._checkRegistration()` resolves with `approved`
- After PIN session verification succeeds
- After role switch via role-switcher

**When it's read:**
- `SidebarV2.init()` — to filter nav items by cached role
- `Router.navigateTo()` — to decide whether to show content or loading skeleton

**When it's cleared:**
- On sign-out
- On `Auth._checkRegistration()` returning `denied` or `pending`
- On background verify finding role change (cache is rewritten with new role)

### SidebarV2 (js/sidebar-v2.js)

```
SidebarV2 = {
  initialized: false,
  sidebar: null,         // #sidebar element
  toggleBtn: null,       // .sidebar-v2-toggle element

  init() {
    if (this.initialized) return;
    this.sidebar = document.getElementById('sidebar');
    this.toggleBtn = document.querySelector('.sidebar-v2-toggle');
    if (!this.sidebar || !this.toggleBtn) return;

    this.attachToggle();      // click → toggle .mobile-open (PURE CSS)
    this.attachNavClicks();   // click → close sidebar + emit nav event
    this.filterByRole();      // read AuthCache, hide items not for this role
    this.listenForAuthReady(); // on 'gbe:auth-ready' → re-filter

    this.initialized = true;
  },

  attachToggle() {
    // touchstart for instant feedback, click for actual toggle
    this.toggleBtn.addEventListener('touchstart', () => {
      this.toggleBtn.classList.add('pressed');
    }, { passive: true });

    this.toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleBtn.classList.remove('pressed');
      this.toggle();
    });
  },

  toggle() {
    this.sidebar.classList.toggle('mobile-open');
    document.body.classList.toggle('sidebar-mobile-open');
  },

  close() {
    this.sidebar.classList.remove('mobile-open');
    document.body.classList.remove('sidebar-mobile-open');
  },

  attachNavClicks() {
    // Delegated — works for dynamically added items too
    this.sidebar.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;
      this.close();  // Close sidebar immediately — navigation happens via Router's existing delegation
    });
  },

  filterByRole() {
    const cache = typeof AuthCache !== 'undefined' ? AuthCache.read() : null;
    const role = cache ? (cache.activeRole || cache.role) : null;

    this.sidebar.querySelectorAll('[data-roles]').forEach(item => {
      if (!role) {
        item.style.display = 'none';  // No cached role → hide everything role-gated
        return;
      }
      const allowed = item.getAttribute('data-roles').split(',');
      item.style.display = allowed.includes(role) ? '' : 'none';
    });
  },

  listenForAuthReady() {
    document.addEventListener('gbe:auth-ready', () => {
      this.filterByRole();  // Re-filter with fresh auth state
    });
  }
}
```

**Key design decisions:**
1. `attachToggle()` uses `touchstart` for instant visual feedback + `click` for the actual toggle. This gives < 50ms response on iOS.
2. `attachNavClicks()` uses delegation on the sidebar element, not individual listeners on each nav item. This means dynamically shown/hidden items work without re-binding.
3. `filterByRole()` reads from `AuthCache` (sync localStorage read, < 1ms), not from `Auth` (which may still be initializing).
4. `listenForAuthReady()` re-filters when Auth completes background verification. If the role changed, the menu updates silently.
5. **Zero calls to Auth, Router, or any other module.** SidebarV2 is completely self-contained.

### Router Changes

In `navigateTo()`, replace the synchronous `Auth.guardRoute()` gate with:

```js
// OLD (blocks):
if (typeof Auth !== 'undefined') {
  if (!Auth.guardRoute(pageName)) {
    return; // tap swallowed
  }
}

// NEW (never blocks):
if (this.isDashboardRoute(pageName)) {
  var cache = typeof AuthCache !== 'undefined' ? AuthCache.read() : null;

  if (!cache || !cache.authorized) {
    // No cached auth — show loading skeleton in content area
    // Auth will emit 'gbe:auth-ready' when done, triggering retry
    this._pendingDashboardRoute = pageName;
    this.switchLayout('dashboard');
    PageLoader.showLoading();  // spinner in content area — sidebar still works
    return;
  }
  // Cache says authorized — proceed immediately
}
```

And add a listener:
```js
document.addEventListener('gbe:auth-ready', () => {
  if (Router._pendingDashboardRoute) {
    var route = Router._pendingDashboardRoute;
    Router._pendingDashboardRoute = null;
    Router.navigateTo(route, true);
  }
});
```

**Result:** Dashboard navigation is never silently blocked. Either it proceeds immediately (cached auth) or it shows a loading skeleton and retries when auth resolves. The sidebar toggle and nav links work at all times.

---

## Testing Strategy: V2 Alongside V1

### Two Toggle Buttons

V1 toggle (existing): `.sidebar-mobile-toggle` — hamburger icon (fa-bars)
V2 toggle (new): `.sidebar-v2-toggle` — grid/dashboard icon (fa-grid-2, or fa-grip)

Both are in the topbar. **V2 toggle is only visible to band_manager role** (via AuthCache check at init time + CSS class). All other roles see only V1 toggle.

### Gating V2 to Band Manager Only

In `sidebar-v2.js` init:
```js
init() {
  var cache = typeof AuthCache !== 'undefined' ? AuthCache.read() : null;
  // V2 is only active for band_manager during testing
  if (!cache || cache.role !== 'band_manager') {
    // Hide V2 toggle, let V1 handle everything
    var v2btn = document.querySelector('.sidebar-v2-toggle');
    if (v2btn) v2btn.style.display = 'none';
    return;
  }
  // ... proceed with V2 init
}
```

V1's `Sidebar.init()` checks for V2:
```js
init() {
  if (this.initialized) return;
  // If SidebarV2 is active for this user, V1 steps aside
  if (typeof SidebarV2 !== 'undefined' && SidebarV2.initialized) {
    // Hide V1 toggle
    var v1btn = document.querySelector('.sidebar-mobile-toggle');
    if (v1btn) v1btn.style.display = 'none';
    return;
  }
  // ... existing V1 init
}
```

### Acceptance Criteria

| Test | Expected | Measured By |
|------|----------|-------------|
| V2 toggle tap → sidebar opens | < 100ms | Playwright click + screenshot timing |
| Sidebar nav link tap → page loads | < 500ms total (sidebar close + content appear) | Playwright click + waitForSelector |
| Page load during auth init | Loading skeleton shows, then content appears when auth resolves | Playwright sequence |
| Role filter matches user role | Only band_manager items visible | Playwright snapshot |
| V1 still works for band_member | V1 toggle visible, V1 behavior unchanged | Playwright with band_member login |
| Auth background verify changes role | Menu re-filters within 1s | Manual test |
| SW update does not force-reload | Toast notification, no auto-reload | Manual test |

---

## Migration Path (After V2 Proves Stable)

1. **Week 1:** V2 active for band_manager only. CEO tests on iPhone.
2. **Week 2:** If stable, extend V2 to all roles. Remove V1 toggle.
3. **Week 3:** Remove V1 sidebar.js entirely. Remove `Auth._updateRoleUI()`. Remove `Auth.guardRoute()`. Remove synchronous gate from Router.
4. **Week 4:** Address SW force-reload (replace with toast notification + user-initiated reload).

---

## Files to Create/Modify (Implementation Order)

1. **Create** `js/auth-cache.js` (sync script, ~60 lines)
2. **Create** `js/sidebar-v2.js` (sync script, ~120 lines)
3. **Modify** `index.html` — add V2 toggle button in topbar, add script tags for auth-cache.js and sidebar-v2.js in sync block
4. **Modify** `js/auth.js` — after auth resolves, write AuthCache + emit `gbe:auth-ready` event
5. **Modify** `js/router.js` — replace `Auth.guardRoute()` call with AuthCache read + loading skeleton pattern
6. **Modify** `js/sidebar.js` — add V2 awareness check (step aside if V2 is active)
7. **Run** SW hash regeneration (`node server/tools/generate-sw-hashes.js`)
8. **Test** in Playwright at 375x812
