/* ============================================
   auth.js — Gold Bottom Ent. LLC Auth System
   Federated Sign-In (Google, Apple, Microsoft)
   + PIN-based local auth for home LAN access
   Firestore-based registration & approval
   Version: 1.2.1
   ============================================ */

const Auth = {
  initialized: false,

  /** @type {boolean} Whether auth init is in progress (verifying PIN session) */
  _initializing: false,

  /** @type {Object|null} Firebase app instance */
  _app: null,

  /** @type {Object|null} Firebase auth instance */
  _auth: null,

  /** @type {Object|null} Firestore instance */
  _db: null,

  /** @type {Object} Auth providers (Google, Apple, Microsoft) */
  _providers: {},

  /** @type {Object|null} Current Firebase user */
  _user: null,

  /** @type {string|null} Route to navigate to after successful login */
  _pendingRoute: null,

  /** @type {Array<Function>} Auth state change listeners */
  _listeners: [],

  /** @type {boolean} Whether a sign-in is currently in progress */
  _signingIn: false,

  /** @type {boolean} Whether the current user is approved for dashboard */
  _authorized: false,

  /** @type {string|null} Registration status: null, 'pending', 'approved', 'denied' */
  _registrationStatus: null,

  /** @type {string|null} User's role: 'admin' or 'member' */
  _role: null,

  /** @type {string|null} PIN session token (stored in localStorage) */
  _sessionToken: null,

  /** @type {string|null} Server base URL when on LAN (e.g., 'http://192.168.1.191:3000') */
  _serverUrl: null,

  /** @type {boolean} Whether authenticated via PIN (not Firebase) */
  _isPinAuth: false,

  /* ------------------------------------------
     Initialization
     ------------------------------------------ */

  /**
   * Initialize auth system:
   * 1. Check for LAN PIN session first (fast, no internet needed)
   * 2. If no PIN session, fall through to Firebase Auth
   */
  init: function() {
    if (this.initialized || this._initializing) return;

    // Detect if we're on the local server
    this._serverUrl = this._detectServerUrl();

    // If on local server, check for existing PIN session FIRST
    if (this._serverUrl) {
      this._sessionToken = localStorage.getItem('gbe-session-token');
      if (this._sessionToken) {
        // Mark as initializing so guardRoute blocks dashboard access until verified
        this._initializing = true;

        // Verify the stored session with the server
        this._verifySession().then(function(result) {
          Auth._initializing = false;

          if (result.valid) {
            // PIN session is valid — we're authenticated!
            Auth._isPinAuth = true;
            Auth._authorized = true;
            Auth._registrationStatus = 'approved';
            Auth._role = 'admin';
            Auth.initialized = true;
            Auth._updatePinUI(result.user || 'Admin (Local)');
            Auth._notifyListeners(null);
            console.log('[Auth] PIN session restored — dashboard access granted');

            // If the URL hash points to a dashboard route, navigate there now
            var hash = window.location.hash.substring(1);
            if (hash && hash.startsWith('dashboard-') && typeof Router !== 'undefined') {
              Router.navigateTo(hash, true);
            }
          } else {
            // Token expired or invalid — clear it
            localStorage.removeItem('gbe-session-token');
            Auth._sessionToken = null;
            console.log('[Auth] PIN session expired — cleared');
            // Fall through to Firebase init
            Auth._initFirebase();
          }
        }).catch(function() {
          Auth._initializing = false;
          // Server unreachable — keep the token but init Firebase as fallback
          console.warn('[Auth] Server unreachable — trying Firebase auth');
          Auth._initFirebase();
        });
        return; // Don't init Firebase yet — wait for verify result
      }
    }

    // No PIN session — initialize Firebase Auth normally
    this._initFirebase();
  },

  /**
   * Initialize Firebase Auth + Firestore with federated providers.
   * This is the original init() logic, extracted so PIN session can bypass it.
   * @private
   */
  _initFirebase: function() {
    if (this.initialized) return;

    // Check if Firebase SDK is loaded
    if (typeof firebase === 'undefined') {
      console.warn('[Auth] Firebase SDK not loaded — auth disabled');
      // Still mark as initialized so guardRoute works (falls through to allow)
      this.initialized = true;
      return;
    }

    // Check feature flag
    if (typeof SiteConfig !== 'undefined' &&
        SiteConfig.features && !SiteConfig.features.enableAuth) {
      console.log('[Auth] Auth disabled by feature flag');
      this.initialized = true;
      return;
    }

    // Get Firebase config
    var config = (typeof SiteConfig !== 'undefined' && SiteConfig.integrations)
      ? SiteConfig.integrations.firebase
      : null;

    if (!config || !config.apiKey || config.apiKey === '[FIREBASE_API_KEY]') {
      console.warn('[Auth] Firebase config not set — auth disabled');
      console.log('[Auth] Add your Firebase credentials to config.js → integrations.firebase');
      this.initialized = true;
      return;
    }

    // Initialize Firebase app (idempotent)
    try {
      if (!firebase.apps.length) {
        this._app = firebase.initializeApp({
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          projectId: config.projectId,
          storageBucket: config.storageBucket,
          messagingSenderId: config.messagingSenderId,
          appId: config.appId
        });
      } else {
        this._app = firebase.app();
      }

      this._auth = firebase.auth();

      // Initialize Firestore
      if (typeof firebase.firestore === 'function') {
        this._db = firebase.firestore();
        console.log('[Auth] Firestore connected');
      } else {
        console.warn('[Auth] Firestore SDK not loaded — registration disabled');
      }

      // Set up federated providers
      // Google
      var google = new firebase.auth.GoogleAuthProvider();
      google.setCustomParameters({ prompt: 'select_account' });
      this._providers.google = google;

      // Apple
      var apple = new firebase.auth.OAuthProvider('apple.com');
      apple.addScope('email');
      apple.addScope('name');
      this._providers.apple = apple;

      // Microsoft
      var microsoft = new firebase.auth.OAuthProvider('microsoft.com');
      microsoft.setCustomParameters({ prompt: 'select_account' });
      this._providers.microsoft = microsoft;

    } catch (error) {
      console.error('[Auth] Firebase initialization failed:', error);
      this.initialized = true;
      return;
    }

    // Set persistence to LOCAL (survives browser restarts — Firebase default)
    this._auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    // Listen for auth state changes
    this._auth.onAuthStateChanged(function(user) {
      // Don't override PIN auth state
      if (Auth._isPinAuth) return;

      Auth._user = user;

      if (user) {
        // Check Firestore registration + approval status
        Auth._checkRegistration(user).then(function(status) {
          Auth._registrationStatus = status;
          Auth._authorized = (status === 'approved');
          Auth._updateUI(user);
          Auth._notifyListeners(user);

          if (status === 'approved') {
            console.log('[Auth] Signed in (approved):', user.displayName || user.email);
            // Close login modal and welcome user
            if (typeof Modal !== 'undefined' && Modal.isOpen) Modal.close();
            if (typeof Toast !== 'undefined') {
              Toast.success('Welcome, ' + Auth.getUserDisplayName());
            }
            // Navigate to pending route if any
            if (Auth._pendingRoute) {
              var route = Auth._pendingRoute;
              Auth._pendingRoute = null;
              if (typeof Router !== 'undefined') {
                Router.navigateTo(route, true);
              }
            }
          } else if (status === 'pending') {
            console.log('[Auth] Signed in (pending approval):', user.email);
            // Show pending screen — don't sign them out, keep session alive
            Auth._showPendingApproval(user);
          } else if (status === 'denied') {
            console.warn('[Auth] Access denied:', user.email);
            Auth._auth.signOut();
            Auth._showLoginError('Your access request has been denied.');
          }
        }).catch(function(err) {
          console.error('[Auth] Registration check failed:', err);
          // Fail open for Firestore errors — allow access so site isn't broken
          Auth._authorized = true;
          Auth._registrationStatus = 'approved';
          Auth._role = 'admin';
          Auth._updateUI(user);
          Auth._notifyListeners(user);
        });
      } else {
        Auth._authorized = false;
        Auth._registrationStatus = null;
        Auth._role = null;
        Auth._updateUI(user);
        Auth._notifyListeners(user);
        console.log('[Auth] Signed out');

        // If currently on a dashboard route, redirect to home
        if (typeof Router !== 'undefined' &&
            Router.currentPage &&
            Router.isDashboardRoute(Router.currentPage)) {
          Router.navigateTo('home');
        }
      }
    });

    this.initialized = true;
    console.log('[Auth] Firebase Auth initialized (Google, Apple, Microsoft + Firestore)');
  },

  /* ------------------------------------------
     PIN Auth (LAN-only)
     ------------------------------------------ */

  /**
   * Detect if we're running on the local home server.
   * Returns the server base URL if on LAN, null otherwise.
   * @returns {string|null}
   * @private
   */
  _detectServerUrl: function() {
    var hostname = window.location.hostname;

    // Check for private IP ranges or localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return window.location.origin;
    }

    // 192.168.x.x
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return window.location.origin;
    }

    // 10.x.x.x
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return window.location.origin;
    }

    // 172.16-31.x.x
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return window.location.origin;
    }

    return null;
  },

  /**
   * Check if we're on the local server (LAN or localhost)
   * @returns {boolean}
   */
  _isOnLocalServer: function() {
    return !!this._serverUrl;
  },

  /**
   * Whether the current environment is the full local dashboard.
   * Returns true on LAN/localhost (home server), false on GitHub Pages or any public host.
   * Used by Router, DataStore, and dashboard pages to determine tier (full vs read-only).
   * @returns {boolean}
   */
  isLocalDashboard: function() {
    return this._isOnLocalServer();
  },

  /**
   * Authenticate with a PIN code (LAN-only).
   * Sends PIN to server, stores session token on success.
   * @param {string} pin - The PIN entered by the user
   * @returns {Promise<Object>} { success, message }
   */
  loginWithPin: function(pin) {
    if (!this._serverUrl) {
      return Promise.reject(new Error('PIN auth only available on local network'));
    }

    return fetch(this._serverUrl + '/api/v1/auth/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin })
    }).then(function(response) {
      return response.json().then(function(data) {
        if (!response.ok) {
          return { success: false, message: data.message || 'Authentication failed' };
        }

        // Success — store token and set auth state
        Auth._sessionToken = data.token;
        Auth._isPinAuth = true;
        Auth._authorized = true;
        Auth._registrationStatus = 'approved';
        Auth._role = 'admin';
        Auth.initialized = true;

        localStorage.setItem('gbe-session-token', data.token);

        // Update UI
        Auth._updatePinUI(data.user || 'Admin (Local)');
        Auth._notifyListeners(null);

        // Close modal and welcome
        if (typeof Modal !== 'undefined' && Modal.isOpen) Modal.close();
        if (typeof Toast !== 'undefined') {
          Toast.success('Welcome, Admin');
        }

        // Navigate to pending route
        if (Auth._pendingRoute) {
          var route = Auth._pendingRoute;
          Auth._pendingRoute = null;
          if (typeof Router !== 'undefined') {
            Router.navigateTo(route, true);
          }
        }

        console.log('[Auth] PIN login successful');
        return { success: true, message: 'Authenticated' };
      });
    }).catch(function(err) {
      console.error('[Auth] PIN login error:', err);
      return { success: false, message: 'Server unreachable. Is the home server running?' };
    });
  },

  /**
   * Verify a stored session token with the server.
   * @returns {Promise<Object>} { valid: boolean, user: string, expiresAt: string }
   * @private
   */
  _verifySession: function() {
    if (!this._serverUrl || !this._sessionToken) {
      return Promise.resolve({ valid: false });
    }

    return fetch(this._serverUrl + '/api/v1/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this._sessionToken })
    }).then(function(response) {
      return response.json();
    }).catch(function() {
      return { valid: false };
    });
  },

  /**
   * Invalidate the PIN session on the server and clear local storage.
   * @returns {Promise}
   * @private
   */
  _logoutPinSession: function() {
    var token = this._sessionToken;
    var serverUrl = this._serverUrl;

    console.log('[Auth] _logoutPinSession — clearing local state');

    // Clear local state immediately (synchronous)
    this._sessionToken = null;
    this._isPinAuth = false;
    this._authorized = false;
    this._registrationStatus = null;
    this._role = null;
    localStorage.removeItem('gbe-session-token');

    // Verify it's actually gone
    var stillThere = localStorage.getItem('gbe-session-token');
    if (stillThere) {
      console.error('[Auth] localStorage token NOT removed! Forcing clear.');
      localStorage.removeItem('gbe-session-token');
      localStorage.clear(); // Nuclear option
    }

    // Tell server to invalidate the session
    if (serverUrl && token) {
      console.log('[Auth] Sending DELETE to server to invalidate session');
      return fetch(serverUrl + '/api/v1/auth/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      }).then(function(response) {
        console.log('[Auth] Server DELETE response:', response.status);
      }).catch(function(err) {
        console.warn('[Auth] Failed to invalidate server session:', err);
      });
    }

    console.log('[Auth] No server URL or token — skipping server invalidation');
    return Promise.resolve();
  },

  /**
   * Update UI elements for PIN-authenticated user.
   * @param {string} userName - Display name (e.g., 'Admin (Local)')
   * @private
   */
  _updatePinUI: function(userName) {
    // Update topbar user name
    var userNameEl = document.querySelector('.user-name');
    if (userNameEl) {
      userNameEl.textContent = userName;
    }

    // Update user avatar — show lock icon for PIN auth
    var userAvatarEl = document.querySelector('.user-avatar');
    if (userAvatarEl) {
      userAvatarEl.innerHTML = '<i class="fa-solid fa-user-shield" style="color:#d4a017;"></i>';
    }

    // Show logout button in sidebar and bind click handler
    var logoutBtn = document.getElementById('sidebar-logout-btn');
    if (logoutBtn) {
      logoutBtn.style.display = '';

      // Remove inline onclick and use proper event listener for reliability
      logoutBtn.removeAttribute('onclick');

      // Remove any previous listener to avoid duplicates
      if (Auth._logoutClickHandler) {
        logoutBtn.removeEventListener('click', Auth._logoutClickHandler);
      }

      Auth._logoutClickHandler = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Auth] Sign Out button clicked');
        Auth.logout().then(function() {
          if (typeof Toast !== 'undefined') Toast.success('Signed out');
          if (typeof Router !== 'undefined') Router.navigateTo('home');
        }).catch(function(err) {
          console.error('[Auth] Logout error:', err);
          // Force cleanup even on error
          localStorage.removeItem('gbe-session-token');
          Auth._isPinAuth = false;
          Auth._authorized = false;
          Auth._sessionToken = null;
          if (typeof Router !== 'undefined') Router.navigateTo('home');
        });
      };

      logoutBtn.addEventListener('click', Auth._logoutClickHandler);
    }

    // Update topbar tooltip
    var topbarUser = document.getElementById('topbar-user');
    if (topbarUser) {
      topbarUser.title = 'Authenticated via local PIN';
    }

    // Show admin-only items (PIN auth = admin)
    var teamLink = document.getElementById('sidebar-team-link');
    if (teamLink) {
      teamLink.style.display = '';
    }
  },

  /* ------------------------------------------
     Firestore Registration & Approval
     ------------------------------------------ */

  /**
   * Check or create a user's registration in Firestore.
   * Returns the approval status: 'approved', 'pending', or 'denied'.
   *
   * Firestore collection: 'users'
   * Document ID: user.uid
   * Fields:
   *   - displayName (string) — plain text name from Google
   *   - emailHash (string) — SHA-256 hash of email (privacy)
   *   - photoURL (string) — profile photo URL
   *   - provider (string) — sign-in provider
   *   - status (string) — 'pending' | 'approved' | 'denied'
   *   - role (string) — 'admin' | 'member'
   *   - registeredAt (timestamp) — when they first signed in
   *   - lastLoginAt (timestamp) — updated each sign-in
   *
   * @param {Object} user - Firebase user object
   * @returns {Promise<string>} 'approved', 'pending', or 'denied'
   */
  _checkRegistration: function(user) {
    if (!this._db) {
      // No Firestore — fall back to open access
      console.warn('[Auth] No Firestore — allowing access');
      return Promise.resolve('approved');
    }

    var userRef = this._db.collection('users').doc(user.uid);

    return this._hashEmail(user.email).then(function(emailHash) {
      return userRef.get().then(function(doc) {
        if (doc.exists) {
          // Existing user — update last login and return their status
          var data = doc.data();
          Auth._role = data.role || 'member';
          userRef.update({
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
            displayName: user.displayName || data.displayName,
            photoURL: user.photoURL || data.photoURL || ''
          }).catch(function(e) {
            console.warn('[Auth] Failed to update last login:', e);
          });
          return data.status || 'pending';
        } else {
          // New user — create registration with 'pending' status
          Auth._role = 'member';
          return userRef.set({
            displayName: user.displayName || user.email.split('@')[0],
            emailHash: emailHash,
            photoURL: user.photoURL || '',
            provider: user.providerData && user.providerData[0]
              ? user.providerData[0].providerId
              : 'unknown',
            status: 'pending',
            role: 'member',
            registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(function() {
            console.log('[Auth] New registration created for:', user.displayName || user.email);
            return 'pending';
          });
        }
      });
    });
  },

  /**
   * Hash an email address using SHA-256 (lowercase, trimmed).
   * Used internally for privacy — emails are never stored in plain text.
   * @param {string} email
   * @returns {Promise<string>} hex-encoded SHA-256 hash
   * @private
   */
  _hashEmail: function(email) {
    var normalized = (email || '').trim().toLowerCase();
    var encoder = new TextEncoder();
    var data = encoder.encode(normalized);
    return crypto.subtle.digest('SHA-256', data).then(function(buffer) {
      var hashArray = Array.from(new Uint8Array(buffer));
      return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  },

  /**
   * Public helper: hash an email for debugging/admin use.
   * Usage in console: Auth.hashEmail('someone@gmail.com').then(h => console.log(h))
   * @param {string} email
   * @returns {Promise<string>}
   */
  hashEmail: function(email) {
    return this._hashEmail(email);
  },

  /* ------------------------------------------
     Public API
     ------------------------------------------ */

  /**
   * Check if a user is currently authenticated AND approved.
   * Works for both Firebase auth and PIN auth.
   * @returns {boolean}
   */
  isAuthenticated: function() {
    // PIN auth: no _user object, but _authorized is true
    if (this._isPinAuth && this._authorized) return true;
    // Firebase auth: need both user and authorized
    return !!this._user && this._authorized;
  },

  /**
   * Check if the current user has admin role
   * @returns {boolean}
   */
  isAdmin: function() {
    return this.isAuthenticated() && this._role === 'admin';
  },

  /**
   * Get the current user's role
   * @returns {string|null} 'admin', 'member', or null
   */
  getRole: function() {
    return this._role;
  },

  /**
   * Get the current user's registration status
   * @returns {string|null} 'approved', 'pending', 'denied', or null
   */
  getRegistrationStatus: function() {
    return this._registrationStatus;
  },

  /**
   * Get the current Firebase user object
   * @returns {Object|null}
   */
  getCurrentUser: function() {
    return this._user;
  },

  /**
   * Get a display-friendly name for the current user
   * @returns {string}
   */
  getUserDisplayName: function() {
    if (this._isPinAuth) return 'Admin (Local)';
    if (!this._user) return 'Guest';
    return this._user.displayName || this._user.email.split('@')[0];
  },

  /**
   * Get the current user's email
   * @returns {string}
   */
  getUserEmail: function() {
    if (this._isPinAuth) return 'Local PIN Auth';
    if (!this._user) return '';
    return this._user.email || '';
  },

  /**
   * Get the current user's photo URL (from profile)
   * @returns {string}
   */
  getUserPhoto: function() {
    if (!this._user) return '';
    return this._user.photoURL || '';
  },

  /**
   * Sign in with a federated provider popup
   * @param {string} providerName - 'google', 'apple', or 'microsoft'
   * @returns {Promise}
   */
  loginWithProvider: function(providerName) {
    if (!this._auth) return Promise.reject(new Error('Auth not initialized'));
    var provider = this._providers[providerName];
    if (!provider) return Promise.reject(new Error('Unknown provider: ' + providerName));
    return this._auth.signInWithPopup(provider);
  },

  /**
   * Sign out the current user (handles both PIN and Firebase auth)
   * @returns {Promise}
   */
  logout: function() {
    console.log('[Auth] logout() called — isPinAuth:', this._isPinAuth);

    // PIN auth logout
    if (this._isPinAuth) {
      return this._logoutPinSession().then(function() {
        // Ensure all state is fully cleared
        Auth._isPinAuth = false;
        Auth._authorized = false;
        Auth._registrationStatus = null;
        Auth._role = null;
        Auth._sessionToken = null;

        Auth._updateUI(null);
        Auth._notifyListeners(null);
        console.log('[Auth] PIN session signed out — localStorage cleared:',
          !localStorage.getItem('gbe-session-token'));

        // Redirect to home if on dashboard
        if (typeof Router !== 'undefined' &&
            Router.currentPage &&
            Router.isDashboardRoute(Router.currentPage)) {
          Router.navigateTo('home');
        }
      });
    }

    // Firebase auth logout
    if (!this._auth) return Promise.reject(new Error('Auth not initialized'));
    return this._auth.signOut();
  },

  /**
   * Subscribe to auth state changes
   * @param {Function} callback - Called with user object or null
   */
  onAuthStateChanged: function(callback) {
    this._listeners.push(callback);
    // Immediately invoke with current state
    callback(this._user);
  },

  /**
   * Set a route to navigate to after successful login
   * @param {string} route
   */
  setPendingRoute: function(route) {
    this._pendingRoute = route;
  },

  /* ------------------------------------------
     Route Guard (called by Router)
     ------------------------------------------ */

  /**
   * Check if navigation to a route should be allowed.
   * Returns true if allowed, false if blocked (login shown).
   * @param {string} pageName
   * @returns {boolean}
   */
  guardRoute: function(pageName) {
    // Check if auth is disabled by feature flag
    if (typeof SiteConfig !== 'undefined' &&
        SiteConfig.features && !SiteConfig.features.enableAuth) {
      return true;
    }

    // Only guard dashboard routes
    if (typeof Router !== 'undefined' && !Router.isDashboardRoute(pageName)) {
      return true;
    }

    // If auth is still initializing (verifying PIN session), block and queue
    // The init callback will navigate to the dashboard route once verified
    if (this._initializing) {
      console.log('[Auth] Auth initializing — queuing dashboard route:', pageName);
      this._pendingRoute = pageName;
      return false;
    }

    // If auth hasn't initialized yet (no PIN, no Firebase), show login
    if (!this.initialized) {
      this._pendingRoute = pageName;
      this.showLoginModal();
      return false;
    }

    // If authenticated and approved (works for both PIN and Firebase), allow
    if (this.isAuthenticated()) return true;

    // If signed in but pending — show pending screen
    if (this._user && this._registrationStatus === 'pending') {
      this._showPendingApproval(this._user);
      return false;
    }

    // Not authenticated — block and show login
    this._pendingRoute = pageName;
    this.showLoginModal();
    return false;
  },

  /* ------------------------------------------
     Login UI
     ------------------------------------------ */

  /**
   * Show the login modal with PIN option (on LAN) + Google/Apple/Microsoft
   */
  showLoginModal: function() {
    if (typeof Modal === 'undefined') {
      console.error('[Auth] Modal system not available');
      return;
    }

    var isLocal = this._isOnLocalServer();

    // Shared button base styles
    var btnBase =
      'display:flex;align-items:center;justify-content:center;gap:12px;' +
      'width:100%;padding:12px 24px;border-radius:8px;' +
      'font-family:\'Inter\',\'Roboto\',sans-serif;font-size:15px;font-weight:500;' +
      'cursor:pointer;transition:background 0.2s,box-shadow 0.2s,opacity 0.2s;' +
      'box-shadow:0 1px 3px rgba(0,0,0,0.08);border:1px solid;';

    // ── PIN section (only shown on LAN) ──
    var pinSectionHTML = '';
    if (isLocal) {
      pinSectionHTML =
        '<div style="margin-bottom:20px;">' +
          // PIN icon + label
          '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;">' +
            '<i class="fa-solid fa-lock" style="color:#d4a017;font-size:16px;"></i>' +
            '<span style="color:rgba(255,255,255,0.7);font-size:14px;font-weight:600;">Local PIN</span>' +
          '</div>' +
          // PIN input + unlock button
          '<div style="display:flex;gap:8px;max-width:300px;margin:0 auto;">' +
            '<input id="auth-pin-input" type="password" inputmode="numeric" pattern="[0-9]*" ' +
              'placeholder="Enter PIN" autocomplete="off" maxlength="8" ' +
              'style="flex:1;padding:12px 16px;border-radius:8px;border:1px solid rgba(255,215,0,0.3);' +
              'background:rgba(255,215,0,0.05);color:#ffd700;font-size:18px;font-weight:600;' +
              'text-align:center;letter-spacing:6px;outline:none;font-family:\'Inter\',monospace;' +
              'transition:border-color 0.2s;" />' +
            '<button id="auth-pin-submit" type="button" style="' +
              'padding:12px 20px;border-radius:8px;border:1px solid #d4a017;' +
              'background:linear-gradient(135deg,#d4a017,#b8860b);color:#fff;' +
              'font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;' +
              'transition:opacity 0.2s;">' +
              '<i class="fa-solid fa-unlock"></i>' +
            '</button>' +
          '</div>' +
          // PIN error area
          '<div id="auth-pin-error" style="display:none;margin-top:8px;' +
            'color:#ff6b6b;font-size:12px;text-align:center;">' +
          '</div>' +
        '</div>' +
        // Divider
        '<div style="display:flex;align-items:center;gap:12px;margin:16px auto;max-width:300px;">' +
          '<div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>' +
          '<span style="color:rgba(255,255,255,0.3);font-size:12px;">or sign in with</span>' +
          '<div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>' +
        '</div>';
    }

    // Google "G" SVG
    var googleSvg =
      '<svg width="20" height="20" viewBox="0 0 48 48">' +
        '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
        '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
        '<path fill="#34A853" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
        '<path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
      '</svg>';

    // Apple logo SVG
    var appleSvg =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>' +
      '</svg>';

    // Microsoft logo SVG
    var microsoftSvg =
      '<svg width="20" height="20" viewBox="0 0 23 23">' +
        '<rect x="1" y="1" width="10" height="10" fill="#f25022"/>' +
        '<rect x="12" y="1" width="10" height="10" fill="#7fba00"/>' +
        '<rect x="1" y="12" width="10" height="10" fill="#00a4ef"/>' +
        '<rect x="12" y="12" width="10" height="10" fill="#ffb900"/>' +
      '</svg>';

    var contentHTML =
      '<div style="text-align:center;padding:8px 0;">' +
        // Shield icon + heading
        '<div style="margin-bottom:' + (isLocal ? '16px' : '24px') + ';">' +
          '<i class="fa-solid fa-shield-halved" style="font-size:36px;color:#d4a017;margin-bottom:12px;display:block;"></i>' +
          '<p style="margin:0;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.5;">' +
            (isLocal
              ? 'Enter your PIN or sign in<br>to access the dashboard.'
              : 'Sign in to request<br>dashboard access.') +
          '</p>' +
        '</div>' +
        // PIN section (LAN only)
        pinSectionHTML +
        // Provider buttons container
        '<div style="display:flex;flex-direction:column;gap:12px;max-width:300px;margin:0 auto;">' +
          // Google
          '<button class="auth-provider-btn" data-provider="google" type="button" style="' +
            btnBase + 'background:#fff;color:#3c4043;border-color:#dadce0;">' +
            googleSvg +
            '<span>Sign in with Google</span>' +
          '</button>' +
          // Apple
          '<button class="auth-provider-btn" data-provider="apple" type="button" style="' +
            btnBase + 'background:#000;color:#fff;border-color:#333;">' +
            appleSvg +
            '<span>Sign in with Apple</span>' +
          '</button>' +
          // Microsoft
          '<button class="auth-provider-btn" data-provider="microsoft" type="button" style="' +
            btnBase + 'background:#2f2f2f;color:#fff;border-color:#444;">' +
            microsoftSvg +
            '<span>Sign in with Microsoft</span>' +
          '</button>' +
        '</div>' +
        // Error area
        '<div id="auth-error" style="display:none;margin-top:16px;' +
          'padding:10px;border-radius:8px;background:rgba(220,53,69,0.15);color:#ff6b6b;font-size:13px;">' +
        '</div>' +
        // Note
        '<p style="margin:20px 0 0;color:rgba(255,255,255,0.3);font-size:11px;">' +
          'New accounts require admin approval.' +
        '</p>' +
      '</div>';

    Modal.open({
      title: 'Dashboard Access',
      content: contentHTML,
      size: 'sm',
      showFooter: false,
      onCancel: function() {
        Auth._pendingRoute = null;
      }
    });

    // Bind click handlers after modal renders
    setTimeout(function() {
      // ── PIN handlers (LAN only) ──
      if (isLocal) {
        var pinInput = document.getElementById('auth-pin-input');
        var pinSubmit = document.getElementById('auth-pin-submit');

        if (pinInput && pinSubmit) {
          // Focus the PIN input
          pinInput.focus();

          // Gold border on focus
          pinInput.addEventListener('focus', function() {
            this.style.borderColor = '#d4a017';
          });
          pinInput.addEventListener('blur', function() {
            this.style.borderColor = 'rgba(255,215,0,0.3)';
          });

          // Submit on Enter key
          pinInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              pinSubmit.click();
            }
          });

          // Click handler for unlock button
          pinSubmit.addEventListener('click', function() {
            var pin = pinInput.value.trim();
            if (!pin) {
              Auth._showPinError('Enter your PIN');
              pinInput.focus();
              return;
            }

            // Disable while verifying
            pinInput.disabled = true;
            pinSubmit.disabled = true;
            pinSubmit.style.opacity = '0.5';
            Auth._hidePinError();

            Auth.loginWithPin(pin).then(function(result) {
              if (!result.success) {
                pinInput.disabled = false;
                pinSubmit.disabled = false;
                pinSubmit.style.opacity = '1';
                Auth._showPinError(result.message);
                pinInput.value = '';
                pinInput.focus();
              }
              // If success, modal closes automatically via loginWithPin
            });
          });
        }
      }

      // ── Provider button handlers ──
      var buttons = document.querySelectorAll('.auth-provider-btn');
      buttons.forEach(function(btn) {
        // Hover effects
        btn.addEventListener('mouseenter', function() {
          this.style.opacity = '0.85';
          this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        });
        btn.addEventListener('mouseleave', function() {
          this.style.opacity = '1';
          this.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
        });

        // Click handler
        btn.addEventListener('click', function() {
          var provider = this.getAttribute('data-provider');
          Auth._handleProviderSignIn(provider, this);
        });
      });
    }, 100);
  },

  /**
   * Show an error message under the PIN input
   * @param {string} message
   * @private
   */
  _showPinError: function(message) {
    var el = document.getElementById('auth-pin-error');
    if (el) {
      el.textContent = message;
      el.style.display = 'block';
    }
  },

  /**
   * Hide the PIN error message
   * @private
   */
  _hidePinError: function() {
    var el = document.getElementById('auth-pin-error');
    if (el) el.style.display = 'none';
  },

  /**
   * Show the "Pending Approval" screen after a new user registers
   * @param {Object} user - Firebase user object
   * @private
   */
  _showPendingApproval: function(user) {
    if (typeof Modal === 'undefined') return;

    var displayName = user.displayName || user.email.split('@')[0];
    var photoHTML = user.photoURL
      ? '<img src="' + user.photoURL + '" alt="' + displayName + '" ' +
        'style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin-bottom:16px;border:2px solid #d4a017;" />'
      : '<i class="fa-solid fa-user-clock" style="font-size:48px;color:#d4a017;margin-bottom:16px;display:block;"></i>';

    var contentHTML =
      '<div style="text-align:center;padding:16px 0;">' +
        photoHTML +
        '<h3 style="margin:0 0 8px;color:#e6edf3;font-size:18px;">Welcome, ' + displayName + '</h3>' +
        '<div style="display:inline-block;padding:4px 16px;border-radius:20px;' +
          'background:rgba(210,153,34,0.15);color:#d29922;font-size:13px;font-weight:600;' +
          'margin-bottom:20px;">' +
          '<i class="fa-solid fa-clock" style="margin-right:6px;"></i>Pending Approval' +
        '</div>' +
        '<p style="margin:0 0 16px;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;">' +
          'Your access request has been submitted.<br>' +
          'An administrator will review and approve your account.' +
        '</p>' +
        '<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.04);' +
          'border:1px solid rgba(255,255,255,0.08);margin-bottom:16px;">' +
          '<p style="margin:0;color:rgba(255,255,255,0.4);font-size:12px;">' +
            'You\'ll get immediate access once approved.<br>Just sign in again after approval.' +
          '</p>' +
        '</div>' +
        '<button id="auth-pending-signout" type="button" style="' +
          'padding:8px 24px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);' +
          'background:transparent;color:rgba(255,255,255,0.6);cursor:pointer;font-size:13px;' +
          'transition:all 0.2s;">' +
          'Sign Out' +
        '</button>' +
      '</div>';

    Modal.open({
      title: 'Access Requested',
      content: contentHTML,
      size: 'sm',
      showFooter: false,
      onCancel: function() {
        Auth._pendingRoute = null;
      }
    });

    // Bind sign-out button
    setTimeout(function() {
      var btn = document.getElementById('auth-pending-signout');
      if (btn) {
        btn.addEventListener('click', function() {
          Auth.logout().then(function() {
            Modal.close();
            if (typeof Toast !== 'undefined') Toast.success('Signed out');
            if (typeof Router !== 'undefined') Router.navigateTo('home');
          });
        });
      }
    }, 100);
  },

  /**
   * Handle federated provider sign-in
   * @param {string} providerName - 'google', 'apple', or 'microsoft'
   * @param {HTMLElement} btn - The button element clicked
   * @private
   */
  _handleProviderSignIn: function(providerName, btn) {
    if (this._signingIn) return;
    this._signingIn = true;

    // Disable all provider buttons
    var allBtns = document.querySelectorAll('.auth-provider-btn');
    var originalLabel = btn.querySelector('span').textContent;
    allBtns.forEach(function(b) {
      b.disabled = true;
      b.style.opacity = '0.5';
      b.style.cursor = 'wait';
    });
    btn.style.opacity = '0.8';
    btn.querySelector('span').textContent = 'Signing in...';

    // Hide any previous error
    var errorDiv = document.getElementById('auth-error');
    if (errorDiv) errorDiv.style.display = 'none';

    Auth.loginWithProvider(providerName)
      .then(function() {
        Auth._signingIn = false;
        // Don't close modal yet — onAuthStateChanged will handle it
        // based on registration status (approved → close, pending → swap to pending screen)
      })
      .catch(function(error) {
        Auth._signingIn = false;

        // Re-enable all buttons
        allBtns.forEach(function(b) {
          b.disabled = false;
          b.style.opacity = '1';
          b.style.cursor = 'pointer';
        });
        btn.querySelector('span').textContent = originalLabel;

        // Map Firebase error codes to user-friendly messages
        var message = 'Sign in failed. Please try again.';
        if (error && error.code) {
          switch (error.code) {
            case 'auth/popup-closed-by-user':
            case 'auth/cancelled-popup-request':
              // User closed the popup — not an error
              return;
            case 'auth/popup-blocked':
              message = 'Popup was blocked by your browser. Please allow popups for this site.';
              break;
            case 'auth/account-exists-with-different-credential':
              message = 'An account already exists with this email using a different sign-in method.';
              break;
            case 'auth/unauthorized-domain':
              message = 'This domain is not authorized. Add it in Firebase Console \u2192 Auth \u2192 Settings.';
              break;
            case 'auth/user-disabled':
              message = 'This account has been disabled.';
              break;
            case 'auth/network-request-failed':
              message = 'Network error. Check your connection.';
              break;
          }
        }

        Auth._showLoginError(message);
        console.warn('[Auth] ' + providerName + ' sign-in failed:', error);
      });
  },

  /**
   * Show an error message in the login modal
   * @param {string} message
   * @private
   */
  _showLoginError: function(message) {
    var errorDiv = document.getElementById('auth-error');
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
    }
  },

  /* ------------------------------------------
     UI Updates
     ------------------------------------------ */

  /**
   * Update UI elements based on auth state
   * @param {Object|null} user
   * @private
   */
  _updateUI: function(user) {
    // If PIN-authenticated, use the PIN-specific UI update
    if (this._isPinAuth && this._authorized) {
      this._updatePinUI('Admin (Local)');
      return;
    }

    // Update topbar user name
    var userNameEl = document.querySelector('.user-name');
    if (userNameEl) {
      userNameEl.textContent = user ? Auth.getUserDisplayName() : 'Guest';
    }

    // Update user avatar — show profile photo if available
    var userAvatarEl = document.querySelector('.user-avatar');
    if (userAvatarEl) {
      if (user && user.photoURL) {
        userAvatarEl.innerHTML = '<img src="' + user.photoURL + '" alt="' +
          Auth.getUserDisplayName() + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" />';
      } else {
        userAvatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
      }
    }

    // Show/hide logout button in sidebar
    var logoutBtn = document.getElementById('sidebar-logout-btn');
    if (logoutBtn) {
      logoutBtn.style.display = (user && Auth._authorized) ? '' : 'none';
    }

    // Update topbar user email tooltip
    var topbarUser = document.getElementById('topbar-user');
    if (topbarUser) {
      topbarUser.title = user ? Auth.getUserEmail() : '';
    }

    // Show/hide admin-only sidebar items
    Auth._updateAdminUI();
  },

  /**
   * Show or hide admin-only sidebar elements based on role
   * @private
   */
  _updateAdminUI: function() {
    var teamLink = document.getElementById('sidebar-team-link');
    if (teamLink) {
      teamLink.style.display = this.isAdmin() ? '' : 'none';
    }
  },

  /**
   * Notify all registered listeners of auth state change
   * @param {Object|null} user
   * @private
   */
  _notifyListeners: function(user) {
    for (var i = 0; i < this._listeners.length; i++) {
      try {
        this._listeners[i](user);
      } catch (e) {
        console.error('[Auth] Listener error:', e);
      }
    }
  }
};

// Auto-initialize
if (typeof module === 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { Auth.init(); });
  } else {
    Auth.init();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = Auth;
