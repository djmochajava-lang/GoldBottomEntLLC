// js/auth-cache.js

/**
 * AuthCache — Cached auth state for instant UI rendering.
 *
 * Stores { role, activeRole, linkedRoles, authorized, expiry } in localStorage.
 * Read is synchronous (< 1ms). Written by Auth after verification completes.
 * SidebarV2 and Router read from this instead of waiting for Auth.guardRoute().
 *
 * TTL: 24 hours — deliberately aligned with the app's 24-hour sliding session
 * expiry (see auth.js: gbe-last-activity / TWENTY_FOUR_HOURS). A returning band
 * member who is still validly logged in (visited within 24h) gets an INSTANT
 * optimistic dashboard render from this cache instead of being forced down the
 * slow blocking Firebase+Firestore path. The old 5-minute TTL meant any return
 * after 5 minutes — i.e. almost every real return — missed the cache and waited
 * on the full handshake, which feels slow on a real device/cellular even though
 * it's ~0.5s on fast desktop. Safety: Auth's background onAuthStateChanged verify
 * runs on every load and ejects signed-out (clears cache + redirects) and denied
 * (forces signOut) users; Firestore security rules are the real data gate, so the
 * optimistic render only ever shows the role-appropriate shell, never unauthorized
 * data. The 24h bound never outlives the session itself.
 * On sign-out or role change, cache is cleared/rewritten.
 */

const AuthCache = {
  STORAGE_KEY: 'gbe-auth-cache',
  TTL: 24 * 60 * 60 * 1000, // 24 hours — matches the 24h sliding session expiry in auth.js

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
