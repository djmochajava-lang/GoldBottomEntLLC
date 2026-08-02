// js/auth-cache.js

/**
 * AuthCache — Cached auth state for instant UI rendering.
 *
 * Stores { role, activeRole, linkedRoles, authorized, expiry } in localStorage.
 * Read is synchronous (< 1ms). Written by Auth after verification completes.
 * SidebarV2 and Router read from this instead of waiting for Auth.guardRoute().
 *
 * TTL: 5 minutes. REVERTED from a 24h experiment that caused a login loop on iOS
 * Safari. The router optimistically renders the dashboard whenever this localStorage
 * cache says authorized (router.js), WITHOUT first confirming a live Firebase session.
 * On iOS Safari (ITP / storage partitioning) Firebase's own IndexedDB session can be
 * cleared while this localStorage cache survives — so a long TTL made the app render
 * the dashboard ("I see the page") and then bounce to the login modal once Firebase
 * reported no user ("login returns to start over"), i.e. a flash-then-login loop.
 * A short 5-minute TTL keeps the optimistic path scoped to genuinely-active sessions,
 * so a stale cache can't outlive a cleared Firebase session by much. A safer way to
 * restore the returning-user speed-up (e.g. reconcile the cache against Firebase
 * currentUser before optimistic render) is tracked as a follow-up.
 * STORAGE_KEY is versioned (-v2) so every existing 24h-TTL entry already in users'
 * localStorage is abandoned immediately on deploy rather than lingering up to 24h.
 * On sign-out or role change, cache is cleared/rewritten.
 */

const AuthCache = {
  // -v3 (CEO ruling R-1, 2026-08-02) invalidates EVERY cached grant written before the
  // auth fail-open was closed. The removed branch wrote {role:'admin', authorized:true}
  // here on any registration-check error, so a code fix alone would have left live admin
  // grants sitting in users' localStorage until they expired. Bumping the key abandons
  // them all on deploy — the same technique the -v2 bump used, and the reason the key is
  // versioned at all. Do not reuse -v2.
  STORAGE_KEY: 'gbe-auth-cache-v3',
  TTL: 5 * 60 * 1000, // 5 minutes (reverted from 24h — see header: caused iOS Safari login loop)

  /**
   * Read cached auth state.
   * @returns {{ role: string, activeRole: string, linkedRoles: string[], authorized: boolean, expiry: number } | null}
   */
  read: function() {
    try {
      var raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data.expiry !== 'number') return null;
      if (Date.now() > data.expiry) {
        // Expired — remove stale cache
        localStorage.removeItem(this.STORAGE_KEY);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  },

  /**
   * Write auth state to cache.
   * @param {{ role: string, activeRole: string, linkedRoles: string[], authorized: boolean }} data
   */
  write: function(data) {
    try {
      var cached = {
        role: data.role || null,
        activeRole: data.activeRole || data.role || null,
        linkedRoles: data.linkedRoles || [],
        authorized: !!data.authorized,
        expiry: Date.now() + this.TTL
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cached));
    } catch (e) {
      // localStorage full or unavailable — degrade silently
    }
  },

  /**
   * Clear cached auth state (on sign-out or denied).
   */
  clear: function() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  },

  /**
   * Check if cache exists and is not expired.
   * @returns {boolean}
   */
  isValid: function() {
    var data = this.read();
    return data !== null && data.authorized === true;
  }
};

// No auto-init needed — AuthCache is a pure data utility.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthCache;
}
