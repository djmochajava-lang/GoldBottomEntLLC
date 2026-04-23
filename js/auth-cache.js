// js/auth-cache.js

/**
 * AuthCache — Cached auth state for instant UI rendering.
 *
 * Stores { role, activeRole, linkedRoles, authorized, expiry } in localStorage.
 * Read is synchronous (< 1ms). Written by Auth after verification completes.
 * SidebarV2 and Router read from this instead of waiting for Auth.guardRoute().
 *
 * TTL: 5 minutes. Background re-validation by Auth updates the cache.
 * On sign-out or role change, cache is cleared/rewritten.
 */

const AuthCache = {
  STORAGE_KEY: 'gbe-auth-cache',
  TTL: 5 * 60 * 1000, // 5 minutes

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
