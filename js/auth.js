/* ============================================
   auth.js — Gold Bottom Ent. LLC Auth System
   Federated Sign-In (Google, Apple, Microsoft, Email/Password)
   + PIN-based local auth for home LAN access
   + Duplicate email detection via emailHash
   + Provider claim normalization (IDP-001 policy)
   Firestore-based registration & approval
   Version: 2.0.0
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

  /** @type {string|null} User's primary role — use _setRole/_getRole internally (tamper-resistant) */
  _role: null,

  /** @type {Array<string>} All roles this user is allowed to switch between */
  _linkedRoles: [],

  /** @type {string|null} The role the user is currently acting as (may differ from _role) */
  _activeRole: null,

  /** @type {string|null} Band member's instrument role (drums, guitar, keys, bass, vocals, etc.) */
  _instrument: null,

  /** @type {Object|null} Firebase Storage instance */
  _storage: null,

  /** @type {string|null} PIN session token (stored in localStorage) */
  _sessionToken: null,

  /** @type {string|null} Server base URL when on LAN (e.g., 'http://192.168.1.191:3000') */
  _serverUrl: null,

  /**
   * Freeze _role, _activeRole, _linkedRoles after server sets them.
   * After freezing, direct assignment (Auth._role = 'admin') is silently ignored.
   * Only Auth._setRoleInternal() can change values (uses closure token).
   * @private
   */
  _freezeRoles: (function() {
    var _token = Math.random().toString(36) + Date.now().toString(36);
    var _store = { role: null, activeRole: null, linkedRoles: [] };
    var _frozen = false;

    // Expose the internal setter on Auth (called from within auth.js only)
    // Usage: Auth._setRoleInternal('_role', 'admin')
    function makeSetRoleInternal(authObj) {
      authObj._setRoleInternal = function(prop, val) {
        if (prop === '_role') _store.role = val;
        else if (prop === '_activeRole') _store.activeRole = val;
        else if (prop === '_linkedRoles') _store.linkedRoles = Array.isArray(val) ? val.slice() : [];
      };
    }

    return function freezeRoles() {
      if (_frozen) return; // only freeze once
      var self = this;
      _store.role = self._role;
      _store.activeRole = self._activeRole;
      _store.linkedRoles = (self._linkedRoles || []).slice();

      makeSetRoleInternal(self);

      Object.defineProperty(self, '_role', {
        get: function() { return _store.role; },
        set: function() { /* silently ignore console tampering */ },
        configurable: false, enumerable: true
      });
      Object.defineProperty(self, '_activeRole', {
        get: function() { return _store.activeRole; },
        set: function() { /* silently ignore console tampering */ },
        configurable: false, enumerable: true
      });
      Object.defineProperty(self, '_linkedRoles', {
        get: function() { return _store.linkedRoles; },
        set: function() { /* silently ignore console tampering */ },
        configurable: false, enumerable: true
      });
      _frozen = true;
    };
  })(),

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
            Auth._linkedRoles = ['admin'];
            Auth._activeRole = 'admin';
            Auth._freezeRoles(); // Lock role properties against console tampering

            // Still initialize Firestore so contact forms can write submissions
            Auth._initFirestoreOnly();

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
        // Enable offline persistence so Music Player works in airplane mode
        this._db.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
          if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
            console.warn('[Auth] Firestore offline persistence error:', err.code);
          }
        });
        console.log('[Auth] Firestore connected');
      } else {
        console.warn('[Auth] Firestore SDK not loaded — registration disabled');
      }

      // Initialize Firebase Storage
      if (typeof firebase.storage === 'function') {
        this._storage = firebase.storage();
        console.log('[Auth] Firebase Storage connected');
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
          // Handle duplicate detection (IDP-001 §4.2)
          if (status && status.indexOf && status.indexOf('duplicate:') === 0) {
            var primaryProvider = status.split(':')[1];
            Auth._registrationStatus = 'duplicate';
            Auth._authorized = false;
            Auth._updateUI(user);
            Auth._notifyListeners(user);
            // Sign out the duplicate session
            Auth._auth.signOut();
            Auth._showDuplicateAccount(primaryProvider);
            return;
          }

          Auth._registrationStatus = status;

          // Email/Password users: require email verification (IDP-001 §6.3)
          var isEmailPassword = user.providerData && user.providerData.length > 0 &&
            user.providerData[0].providerId === 'password';
          if (isEmailPassword && !user.emailVerified) {
            Auth._authorized = false;
            Auth._updateUI(user);
            Auth._notifyListeners(user);
            Auth._showEmailVerificationRequired(user);
            console.log('[Auth] Email not verified — blocking access');
            return;
          }

          Auth._authorized = (status === 'approved');
          Auth._updateUI(user);
          Auth._notifyListeners(user);

          if (status === 'approved') {
            console.log('[Auth] Signed in (approved)');
            // Close login modal and welcome user
            if (typeof Modal !== 'undefined' && Modal.isOpen) Modal.close();
            if (typeof Toast !== 'undefined') {
              Toast.success('Welcome, ' + Auth.getUserDisplayName());
            }
            // Navigate to pending route or role-appropriate landing page
            if (Auth._pendingRoute) {
              var route = Auth._pendingRoute;
              Auth._pendingRoute = null;
              if (typeof Router !== 'undefined') {
                Router.navigateTo(route, true);
              }
            } else {
              // Session restore (returning to site) — send band members to My Portal
              var _restoreRole = Auth._activeRole || Auth._role || '';
              if (_restoreRole === 'band_member' || _restoreRole === 'artist') {
                if (typeof Router !== 'undefined') Router.navigateTo('dashboard-musician-home', true);
              }
            }
          } else if (status === 'pending') {
            console.log('[Auth] Signed in (pending approval)');
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
          // Log fail-open event per IDP-001 §7.2
          console.warn('[Auth] FAIL-OPEN: Granting temporary access due to Firestore error');
          Auth._authorized = true;
          Auth._registrationStatus = 'approved';
          Auth._role = 'admin';
          Auth._linkedRoles = ['admin'];
          Auth._activeRole = 'admin';
          Auth._updateUI(user);
          Auth._notifyListeners(user);
        });
      } else {
        Auth._authorized = false;
        Auth._registrationStatus = null;
        Auth._role = null;
        Auth._linkedRoles = [];
        Auth._activeRole = null;
        Auth._clearActiveRoleStorage();
        Auth._updateUI(user);
        Auth._notifyListeners(user);
        console.log('[Auth] Signed out');

        // If there's a pending dashboard route (queued before auth was ready),
        // show the login modal now so the user can authenticate.
        if (Auth._pendingRoute && typeof Router !== 'undefined' &&
            Router.isDashboardRoute(Auth._pendingRoute)) {
          Auth.showLoginModal();
        }
        // If currently on a dashboard route, redirect to home
        else if (typeof Router !== 'undefined' &&
            Router.currentPage &&
            Router.isDashboardRoute(Router.currentPage)) {
          Router.navigateTo('home');
        }
      }
    });

    this.initialized = true;
    console.log('[Auth] Firebase Auth initialized (Google, Apple, Microsoft, Email/Password + Firestore)');
  },

  /**
   * Initialize Firebase App + Firestore only (no auth providers or listeners).
   * Used by PIN auth path so contact forms can still write to Firestore.
   * @private
   */
  _initFirestoreOnly: function() {
    if (this._db) return; // Already initialized
    if (typeof firebase === 'undefined') return;

    var config = (typeof SiteConfig !== 'undefined' && SiteConfig.integrations)
      ? SiteConfig.integrations.firebase : null;
    if (!config || !config.apiKey || config.apiKey === '[FIREBASE_API_KEY]') return;

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

      if (typeof firebase.firestore === 'function') {
        this._db = firebase.firestore();
        this._db.enablePersistence({ synchronizeTabs: true }).catch(function() {});
        console.log('[Auth] Firestore connected (PIN auth path)');
      }
      if (typeof firebase.storage === 'function') {
        this._storage = firebase.storage();
      }
    } catch (e) {
      console.warn('[Auth] Firestore init failed in PIN path:', e);
    }
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
    var isPrivate = false;

    // Check for private IP ranges or localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      isPrivate = true;
    }
    // 192.168.x.x
    else if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      isPrivate = true;
    }
    // 10.x.x.x
    else if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      isPrivate = true;
    }
    // 172.16-31.x.x
    else if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      isPrivate = true;
    }

    if (!isPrivate) return null;

    // If already on the API server port (3000), use origin as-is.
    // Otherwise the SPA is served by a different server (e.g. VS Code
    // Live Server on 8080), so point to the API on port 3000.
    var port = window.location.port;
    if (port === '3000') {
      return window.location.origin;
    }
    return window.location.protocol + '//' + hostname + ':3000';
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
        Auth._linkedRoles = ['admin'];
        Auth._activeRole = 'admin';
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
    this._linkedRoles = [];
    this._activeRole = null;
    this._clearActiveRoleStorage();
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

    // Show admin-only sidebar items (PIN auth = full admin)
    Auth._updateRoleUI();

    // Update role switcher (PIN auth always has single 'admin' role — will not show)
    Auth._updateRoleSwitcher();
  },

  /* ------------------------------------------
     Firestore Registration & Approval
     ------------------------------------------ */

  /**
   * Check or create a user's registration in Firestore.
   * Returns the approval status: 'approved', 'pending', 'denied', or 'duplicate:{provider}'.
   *
   * Implements IDP-001 §4 (duplicate detection via emailHash) and §5 (unified profile).
   *
   * Firestore collection: 'users'
   * Document ID: user.uid
   * Fields:
   *   - displayName (string) — from provider profile or email local part
   *   - emailHash (string) — SHA-256 hash of email (privacy)
   *   - photoURL (string) — profile photo URL (null for Apple/Email)
   *   - provider (string) — sign-in provider ID (first login)
   *   - primaryProvider (string) — the provider used for first registration
   *   - linkedProviders (string[]) — all provider IDs that have matched this emailHash
   *   - status (string) — 'pending' | 'approved' | 'denied'
   *   - role (string) — 'admin' | 'member'
   *   - registeredAt (timestamp) — when they first signed in
   *   - lastLoginAt (timestamp) — updated each sign-in
   *
   * @param {Object} user - Firebase user object
   * @returns {Promise<string>} 'approved', 'pending', 'denied', or 'duplicate:{providerId}'
   */
  _checkRegistration: function(user) {
    if (!this._db) {
      // No Firestore — fall back to open access
      console.warn('[Auth] No Firestore — allowing access');
      return Promise.resolve('approved');
    }

    var userRef = this._db.collection('users').doc(user.uid);
    var currentProvider = (user.providerData && user.providerData.length > 0)
      ? user.providerData[0].providerId
      : 'unknown';

    // Use email if available; fall back to UID-based placeholder (Apple may hide email)
    var emailForHash = user.email || (user.uid + '@noemail.placeholder');

    return this._hashEmail(emailForHash).then(function(emailHash) {
      return userRef.get().then(function(doc) {
        if (doc.exists) {
          // Existing user — update last login, ensure current provider is tracked
          var data = doc.data();
          Auth._role = data.role || 'member';
          Auth._instrument = data.instrument || null;
          Auth._linkedRoles = (data.linkedRoles && data.linkedRoles.length)
            ? data.linkedRoles
            : [Auth._role];
          Auth._activeRole = Auth._restoreActiveRole(user.uid);

          // Build linkedProviders array, adding current provider if not yet listed
          var linked = data.linkedProviders || [data.provider || currentProvider];
          if (linked.indexOf(currentProvider) === -1) {
            linked.push(currentProvider);
          }

          // Normalize displayName: use provider value, fall back to stored, then email local part
          var displayName = user.displayName || data.displayName ||
            (user.email ? user.email.split('@')[0] : 'User');

          userRef.update({
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
            displayName: displayName,
            photoURL: user.photoURL || data.photoURL || '',
            linkedProviders: linked
          }).catch(function(e) {
            console.warn('[Auth] Failed to update last login:', e);
          });
          return data.status || 'pending';
        } else {
          // New user — check for duplicate emailHash before creating (IDP-001 §4.2)
          return Auth._checkDuplicateEmail(emailHash, user.uid).then(function(primaryDoc) {
            if (primaryDoc) {
              // Duplicate found — add current provider to primary's linkedProviders
              var primaryData = primaryDoc.data();
              var primaryLinked = primaryData.linkedProviders || [primaryData.provider || 'unknown'];
              if (primaryLinked.indexOf(currentProvider) === -1) {
                primaryLinked.push(currentProvider);
              }
              primaryDoc.ref.update({
                linkedProviders: primaryLinked
              }).catch(function(e) {
                console.warn('[Auth] Failed to update primary linkedProviders:', e);
              });

              console.log('[Auth] Duplicate detected — primary UID:', primaryDoc.id,
                'provider:', primaryData.primaryProvider || primaryData.provider,
                '| duplicate UID:', user.uid, 'provider:', currentProvider);

              // Return special status so onAuthStateChanged can handle it
              return 'duplicate:' + (primaryData.primaryProvider || primaryData.provider || 'unknown');
            }

            // No duplicate — check for onboarding invite token (FRD-4)
            var inviteToken = localStorage.getItem('gbe-invite-token');
            if (inviteToken) {
              return Auth._acceptInvitation(user, inviteToken).then(function(result) {
                if (result && result.success) {
                  Auth._role = result.role || 'band_member';
                  Auth._instrument = result.instrument || null;
                  Auth._linkedRoles = [Auth._role];
                  Auth._activeRole = Auth._role;
                  localStorage.removeItem('gbe-invite-token');
                  console.log('[Auth] Onboarding invite accepted — auto-approved as ' + Auth._role);
                  return 'approved';
                }
                // Invite failed — fall through to normal registration
                localStorage.removeItem('gbe-invite-token');
                return Auth._showAccessRequestForm(user, emailHash, userRef, currentProvider,
                  user.displayName || (user.email ? user.email.split('@')[0] : 'User'));
              });
            }

            // No invite token — check Firestore invitations for matching email (auto-approve)
            var displayName = user.displayName ||
              (user.email ? user.email.split('@')[0] : 'User');

            return Auth._checkFirestoreInvitation(emailHash).then(function(invitation) {
              if (invitation) {
                // Matching invitation found — auto-approve with invitation role
                var role = invitation.role || 'band_member';
                Auth._role = role;
                Auth._instrument = invitation.instrument || null;
                Auth._linkedRoles = [role];
                Auth._activeRole = role;

                return userRef.set({
                  displayName: displayName,
                  emailHash: emailHash,
                  photoURL: user.photoURL || '',
                  provider: currentProvider,
                  primaryProvider: currentProvider,
                  linkedProviders: [currentProvider],
                  status: 'approved',
                  role: role,
                  requestedRole: role,
                  requestNote: 'Auto-approved via invitation ' + invitation.id,
                  invitationId: invitation.id,
                  instrument: invitation.instrument || null,
                  registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
                  lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function() {
                  // Mark invitation as accepted in Firestore
                  Auth._markInvitationAccepted(invitation.id);
                  console.log('[Auth] Auto-approved via invitation:', invitation.id, 'role:', role);
                  return 'approved';
                });
              }

              // No invitation found — normal registration flow
              Auth._role = 'member';
              Auth._linkedRoles = ['member'];
              Auth._activeRole = 'member';
              return Auth._showAccessRequestForm(user, emailHash, userRef, currentProvider, displayName);
            });
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

  /**
   * Check if any existing user document has a matching emailHash with a different UID.
   * Used for duplicate identity detection per IDP-001 §4.2.
   * Returns the primary user document (earliest registeredAt) or null.
   * @param {string} emailHash - SHA-256 hash of the email
   * @param {string} currentUid - The current user's UID to exclude
   * @returns {Promise<Object|null>} Firestore document snapshot or null
   * @private
   */
  _checkDuplicateEmail: function(emailHash, currentUid) {
    if (!this._db) return Promise.resolve(null);

    return this._db.collection('users')
      .where('emailHash', '==', emailHash)
      .limit(5)
      .get()
      .then(function(snapshot) {
        var primary = null;
        snapshot.forEach(function(doc) {
          if (doc.id !== currentUid) {
            // Found a different user with the same email hash
            // Pick the one with earliest registeredAt as primary
            if (!primary) {
              primary = doc;
            } else {
              var existingDate = primary.data().registeredAt;
              var candidateDate = doc.data().registeredAt;
              if (candidateDate && existingDate && candidateDate.toMillis && existingDate.toMillis &&
                  candidateDate.toMillis() < existingDate.toMillis()) {
                primary = doc;
              }
            }
          }
        });
        if (primary) {
          console.log('[Auth] Duplicate emailHash detected — primary UID found');
        }
        return primary;
      })
      .catch(function(e) {
        console.warn('[Auth] Duplicate email check failed:', e);
        return null; // Fail open — allow registration
      });
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
   * Check if the current user has admin-level access.
   * True for both 'admin' (site admin) and 'band_manager' (CEO/band manager).
   * Checks the active role (which may differ from primary role when switching).
   * @returns {boolean}
   */
  isAdmin: function() {
    var role = this._activeRole || this._role;
    return this.isAuthenticated() && (role === 'admin' || role === 'band_manager');
  },

  /**
   * Get the current active role.
   * @returns {string} role key (e.g. 'admin', 'band_manager', 'artist', etc.)
   */
  getRole: function() {
    return this._activeRole || this._role || 'member';
  },

  /**
   * Check if user is the technical site administrator.
   * @returns {boolean}
   */
  isSiteAdmin: function() {
    return this.isAuthenticated() && (this._activeRole || this._role) === 'admin';
  },

  /**
   * Check if user is the band manager / CEO.
   * @returns {boolean}
   */
  isBandManager: function() {
    return this.isAuthenticated() && (this._activeRole || this._role) === 'band_manager';
  },

  /**
   * Check if user is internal staff (admin or band manager).
   * Internal staff get the full operations dashboard.
   * @returns {boolean}
   */
  isInternalStaff: function() {
    var role = this._activeRole || this._role;
    return this.isAuthenticated() && (role === 'admin' || role === 'band_manager');
  },

  /**
   * Check if user is the singer / principal artist.
   * @returns {boolean}
   */
  isSinger: function() {
    return this.isAuthenticated() && (this._activeRole || this._role) === 'artist';
  },

  /**
   * Check if user is a band member / musician.
   * @returns {boolean}
   */
  isBandMember: function() {
    return this.isAuthenticated() && (this._activeRole || this._role) === 'band_member';
  },

  /**
   * Check if user is a venue owner (confirmed booking).
   * @returns {boolean}
   */
  isVenueOwner: function() {
    return this.isAuthenticated() && (this._activeRole || this._role) === 'venue_owner';
  },

  /**
   * Check if user is a promoter (confirmed engagement).
   * @returns {boolean}
   */
  isPromoter: function() {
    return this.isAuthenticated() && (this._activeRole || this._role) === 'promoter';
  },

  /**
   * Check if user is part of the band team (internal music access).
   * @returns {boolean}
   */
  isBandTeam: function() {
    var role = this._activeRole || this._role;
    return this.isAuthenticated() && ['admin', 'band_manager', 'artist', 'band_member'].indexOf(role) !== -1;
  },

  /**
   * Get the band member's instrument role.
   * @returns {string|null} e.g. 'drums', 'guitar', 'keys', 'bass', 'vocals', 'saxophone', or null
   */
  getInstrument: function() {
    return this._instrument || null;
  },

  /**
   * Get Firebase Storage instance.
   * @returns {Object|null}
   */
  getStorage: function() {
    return this._storage || null;
  },

  /**
   * Check if user has any portal access (any approved, authenticated user).
   * @returns {boolean}
   */
  hasPortalAccess: function() {
    return this.isAuthenticated();
  },

  /**
   * Get all roles available to the current user for switching.
   * @returns {Array<string>}
   */
  getLinkedRoles: function() {
    return this._linkedRoles || [];
  },

  /**
   * Check if the current user can switch roles (has more than one linked role).
   * @returns {boolean}
   */
  canSwitchRoles: function() {
    return this._linkedRoles && this._linkedRoles.length > 1;
  },

  /**
   * Switch the active role to a different role in the user's linkedRoles.
   * Persists the selection in sessionStorage so it survives page refreshes.
   * @param {string} newRole
   * @returns {boolean} true if switch succeeded
   */
  switchRole: function(newRole) {
    if (!this.isAuthenticated()) return false;
    if (this._linkedRoles.indexOf(newRole) === -1) {
      console.warn('[Auth] Role not available for switching:', newRole);
      return false;
    }
    this._activeRole = newRole;
    // Persist for this session (cleared on logout)
    try {
      var uid = this._user ? this._user.uid : 'pin';
      sessionStorage.setItem('gbe-active-role-' + uid, newRole);
    } catch(e) {}
    // Update UI and notify listeners so page content can react
    this._updateUI(this._user);
    this._notifyListeners(this._user);
    if (typeof Toast !== 'undefined') {
      Toast.success('Switched to ' + this.getRoleLabel());
    }
    console.log('[Auth] Switched to role:', newRole);
    document.dispatchEvent(new CustomEvent('gbe:role-switched', { detail: { role: newRole } }));
    return true;
  },

  /**
   * Restore the active role from sessionStorage (survives page refreshes within a session).
   * Only restores if the stored role is still in the user's linkedRoles.
   * @param {string} uid
   * @returns {string} The role to use as active role
   * @private
   */
  _restoreActiveRole: function(uid) {
    try {
      var stored = sessionStorage.getItem('gbe-active-role-' + uid);
      if (stored && this._linkedRoles.indexOf(stored) !== -1) {
        console.log('[Auth] Restored active role from session:', stored);
        return stored;
      }
    } catch(e) {}
    return this._role;
  },

  /**
   * Clear active role from sessionStorage for the current user.
   * Called on logout.
   * @private
   */
  _clearActiveRoleStorage: function() {
    try {
      var uid = this._user ? this._user.uid : 'pin';
      sessionStorage.removeItem('gbe-active-role-' + uid);
      // Also clear all gbe-active-role-* keys in case of multiple sessions
      var toRemove = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var key = sessionStorage.key(i);
        if (key && key.indexOf('gbe-active-role-') === 0) toRemove.push(key);
      }
      toRemove.forEach(function(k) { sessionStorage.removeItem(k); });
    } catch(e) {}
  },

  /**
   * Get a human-readable label for the current user's active role.
   * @returns {string}
   */
  getRoleLabel: function() {
    var role = this._activeRole || this._role;
    var labels = {
      'admin':        'Site Admin',
      'band_manager': 'Band Manager',
      'artist':       'Artist',
      'band_member':  'Band Member',
      'venue_owner':  'Venue Owner',
      'promoter':     'Promoter',
      'member':       'Member'
    };
    return labels[role] || 'Member';
  },

  // getRole() defined at line 880 — do not duplicate here

  /**
   * Get the current user's primary role (as assigned in Firestore, never changes in-session).
   * @returns {string|null}
   */
  getPrimaryRole: function() {
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
   * Sign in with email and password (IDP-001 §6).
   * @param {string} email
   * @param {string} password
   * @returns {Promise}
   */
  loginWithEmail: function(email, password) {
    if (!this._auth) return Promise.reject(new Error('Auth not initialized'));
    return this._auth.signInWithEmailAndPassword(email, password);
  },

  /**
   * Register a new account with email and password.
   * Sends email verification after creation (IDP-001 §6.3).
   * @param {string} email
   * @param {string} password
   * @param {string} displayName - Display name for the user profile
   * @returns {Promise}
   */
  registerWithEmail: function(email, password, displayName) {
    if (!this._auth) return Promise.reject(new Error('Auth not initialized'));
    return this._auth.createUserWithEmailAndPassword(email, password)
      .then(function(credential) {
        // Set display name on the Firebase Auth profile
        if (displayName && credential.user.updateProfile) {
          credential.user.updateProfile({ displayName: displayName }).catch(function(e) {
            console.warn('[Auth] Failed to set display name:', e);
          });
        }
        // Send verification email
        if (credential.user && credential.user.sendEmailVerification) {
          credential.user.sendEmailVerification().catch(function(e) {
            console.warn('[Auth] Failed to send verification email:', e);
          });
        }
        console.log('[Auth] Email/Password account created');
        return credential;
      });
  },

  /**
   * Send a password reset email (IDP-001 §6.2).
   * @param {string} email
   * @returns {Promise}
   */
  sendPasswordReset: function(email) {
    if (!this._auth) return Promise.reject(new Error('Auth not initialized'));
    return this._auth.sendPasswordResetEmail(email);
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
        Auth._linkedRoles = [];
        Auth._activeRole = null;
        Auth._clearActiveRoleStorage();
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

    // If auth is still initializing (verifying PIN session) OR hasn't started
    // yet (modules loading), block and queue — don't show login prematurely.
    // The init callback will navigate to the dashboard route once verified.
    if (this._initializing || !this.initialized) {
      console.log('[Auth] Auth not ready — queuing dashboard route:', pageName);
      this._pendingRoute = pageName;
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

    // Auto-login: if ?autologin=true (linked from LA Young Band Portal), skip modal and go straight to Google sign-in
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('autologin') === 'true') {
        // Clean URL
        if (window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        }
        // Trigger Google sign-in directly
        if (typeof firebase !== 'undefined' && firebase.auth) {
          var provider = new firebase.auth.GoogleAuthProvider();
          firebase.auth().signInWithPopup(provider).catch(function(err) {
            if (err.code !== 'auth/popup-closed-by-user') {
              console.error('[Auth] Auto-login failed:', err.code);
            }
            // Fall back to showing the modal
            Auth.showLoginModal();
          });
          return;
        }
      }
    } catch (e) { /* ignore */ }

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
        // Email/Password divider
        '<div style="display:flex;align-items:center;gap:12px;margin:20px auto;max-width:300px;">' +
          '<div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>' +
          '<span style="color:rgba(255,255,255,0.3);font-size:12px;">or use email</span>' +
          '<div style="flex:1;height:1px;background:rgba(255,255,255,0.1);"></div>' +
        '</div>' +
        // Email/Password form (IDP-001 §6)
        '<div id="auth-email-section" style="max-width:300px;margin:0 auto;">' +
          // Display name (register mode only — hidden by default)
          '<input id="auth-email-name" type="text" placeholder="Display name" ' +
            'style="display:none;width:100%;padding:10px 14px;margin-bottom:8px;' +
            'border-radius:8px;border:1px solid rgba(255,255,255,0.15);' +
            'background:rgba(255,255,255,0.05);color:#e6edf3;font-size:14px;' +
            'font-family:inherit;outline:none;box-sizing:border-box;' +
            'transition:border-color 0.2s;" />' +
          // Email input
          '<input id="auth-email-input" type="email" placeholder="Email address" ' +
            'autocomplete="email" style="width:100%;padding:10px 14px;margin-bottom:8px;' +
            'border-radius:8px;border:1px solid rgba(255,255,255,0.15);' +
            'background:rgba(255,255,255,0.05);color:#e6edf3;font-size:14px;' +
            'font-family:inherit;outline:none;box-sizing:border-box;' +
            'transition:border-color 0.2s;" />' +
          // Password input
          '<input id="auth-email-password" type="password" placeholder="Password" ' +
            'autocomplete="current-password" style="width:100%;padding:10px 14px;margin-bottom:4px;' +
            'border-radius:8px;border:1px solid rgba(255,255,255,0.15);' +
            'background:rgba(255,255,255,0.05);color:#e6edf3;font-size:14px;' +
            'font-family:inherit;outline:none;box-sizing:border-box;' +
            'transition:border-color 0.2s;" />' +
          // Password requirements (register mode only — hidden by default)
          '<div id="auth-email-requirements" style="display:none;margin-bottom:8px;' +
            'color:rgba(255,255,255,0.3);font-size:11px;text-align:left;padding-left:2px;">' +
            'Minimum 8 characters' +
          '</div>' +
          // Submit button
          '<button id="auth-email-submit" type="button" style="' +
            btnBase + 'background:linear-gradient(135deg,#d4a017,#b8860b);color:#fff;' +
            'border-color:#b8860b;margin-top:8px;margin-bottom:8px;">' +
            '<i class="fa-solid fa-envelope"></i>' +
            '<span>Sign In with Email</span>' +
          '</button>' +
          // Toggle + forgot password links
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:0 2px;">' +
            '<a id="auth-email-toggle" href="#" style="color:#d4a017;font-size:12px;' +
              'text-decoration:none;transition:opacity 0.2s;">Create an account</a>' +
            '<a id="auth-email-forgot" href="#" style="color:rgba(255,255,255,0.4);font-size:12px;' +
              'text-decoration:none;transition:opacity 0.2s;">Forgot password?</a>' +
          '</div>' +
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

      // ── Email/Password handlers (IDP-001 §6) ──
      var emailName = document.getElementById('auth-email-name');
      var emailInput = document.getElementById('auth-email-input');
      var emailPassword = document.getElementById('auth-email-password');
      var emailSubmit = document.getElementById('auth-email-submit');
      var emailToggle = document.getElementById('auth-email-toggle');
      var emailForgot = document.getElementById('auth-email-forgot');
      var emailRequirements = document.getElementById('auth-email-requirements');

      if (emailSubmit && emailInput && emailPassword) {
        var isRegisterMode = false;

        // Focus styling for email inputs
        [emailInput, emailPassword, emailName].forEach(function(input) {
          if (!input) return;
          input.addEventListener('focus', function() {
            this.style.borderColor = 'rgba(212,160,23,0.5)';
          });
          input.addEventListener('blur', function() {
            this.style.borderColor = 'rgba(255,255,255,0.15)';
          });
        });

        // Toggle between sign-in and register mode
        if (emailToggle) {
          emailToggle.addEventListener('click', function(e) {
            e.preventDefault();
            isRegisterMode = !isRegisterMode;
            if (emailName) emailName.style.display = isRegisterMode ? 'block' : 'none';
            if (emailRequirements) emailRequirements.style.display = isRegisterMode ? 'block' : 'none';
            if (emailForgot) emailForgot.style.display = isRegisterMode ? 'none' : '';
            emailSubmit.querySelector('span').textContent = isRegisterMode
              ? 'Create Account' : 'Sign In with Email';
            emailToggle.textContent = isRegisterMode
              ? 'Sign in instead' : 'Create an account';
            emailPassword.setAttribute('autocomplete', isRegisterMode
              ? 'new-password' : 'current-password');
            // Hide any previous error
            var errorDiv = document.getElementById('auth-error');
            if (errorDiv) errorDiv.style.display = 'none';
          });
        }

        // Forgot password handler
        if (emailForgot) {
          emailForgot.addEventListener('click', function(e) {
            e.preventDefault();
            var email = emailInput.value.trim();
            if (!email) {
              Auth._showLoginError('Enter your email address first.');
              emailInput.focus();
              return;
            }
            Auth.sendPasswordReset(email).then(function() {
              // Show as info (gold) instead of error (red)
              var errorDiv = document.getElementById('auth-error');
              if (errorDiv) {
                errorDiv.textContent = 'Password reset email sent. Check your inbox.';
                errorDiv.style.display = 'block';
                errorDiv.style.background = 'rgba(212,160,23,0.15)';
                errorDiv.style.color = '#d4a017';
              }
            }).catch(function(err) {
              var msg = 'Failed to send reset email.';
              if (err && err.code === 'auth/user-not-found') {
                msg = 'No account found with this email.';
              }
              Auth._showLoginError(msg);
            });
          });
        }

        // Submit handler (sign in or register)
        emailSubmit.addEventListener('click', function() {
          var email = emailInput.value.trim();
          var password = emailPassword.value;
          var name = emailName ? emailName.value.trim() : '';

          // Validate
          if (!email) {
            Auth._showLoginError('Enter your email address.');
            emailInput.focus();
            return;
          }
          if (!password) {
            Auth._showLoginError('Enter your password.');
            emailPassword.focus();
            return;
          }
          if (isRegisterMode && password.length < 8) {
            Auth._showLoginError('Password must be at least 8 characters.');
            emailPassword.focus();
            return;
          }

          // Disable form during auth
          emailInput.disabled = true;
          emailPassword.disabled = true;
          emailSubmit.disabled = true;
          emailSubmit.style.opacity = '0.5';
          emailSubmit.style.cursor = 'wait';
          var originalLabel = emailSubmit.querySelector('span').textContent;
          emailSubmit.querySelector('span').textContent = isRegisterMode
            ? 'Creating account...' : 'Signing in...';
          var errorDiv = document.getElementById('auth-error');
          if (errorDiv) errorDiv.style.display = 'none';

          // Also disable provider buttons
          var provBtns = document.querySelectorAll('.auth-provider-btn');
          provBtns.forEach(function(b) { b.disabled = true; b.style.opacity = '0.5'; });

          var action;
          if (isRegisterMode) {
            action = Auth.registerWithEmail(email, password, name || email.split('@')[0]);
          } else {
            action = Auth.loginWithEmail(email, password);
          }

          action.catch(function(error) {
            // Re-enable form
            emailInput.disabled = false;
            emailPassword.disabled = false;
            emailSubmit.disabled = false;
            emailSubmit.style.opacity = '1';
            emailSubmit.style.cursor = 'pointer';
            emailSubmit.querySelector('span').textContent = originalLabel;
            provBtns.forEach(function(b) { b.disabled = false; b.style.opacity = '1'; });

            var message = 'Authentication failed. Please try again.';
            if (error && error.code) {
              switch (error.code) {
                case 'auth/user-not-found':
                  message = 'No account found with this email. Create an account first.';
                  break;
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                  message = 'Invalid email or password.';
                  break;
                case 'auth/email-already-in-use':
                  message = 'An account with this email already exists. Try signing in.';
                  break;
                case 'auth/weak-password':
                  message = 'Password must be at least 8 characters.';
                  break;
                case 'auth/invalid-email':
                  message = 'Invalid email address.';
                  break;
                case 'auth/too-many-requests':
                  message = 'Too many attempts. Please wait and try again.';
                  break;
              }
            }
            Auth._showLoginError(message);
            console.warn('[Auth] Email auth failed:', error);
          });
        });

        // Enter key: email → focus password, password → submit
        emailInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); emailPassword.focus(); }
        });
        emailPassword.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); emailSubmit.click(); }
        });
        if (emailName) {
          emailName.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); emailInput.focus(); }
          });
        }
      }
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
   * Accept an onboarding invitation via the server (FRD-4).
   * Calls the accept endpoint which writes the Firestore doc via Admin SDK.
   * @param {Object} user - Firebase Auth user
   * @param {string} token - Invitation token from localStorage
   * @returns {Promise<{success: boolean, role: string, instrument: string}|null>}
   * @private
   */
  _acceptInvitation: function(user, token) {
    var apiBase = window.location.origin;
    return fetch(apiBase + '/api/v1/onboarding/invite/' + encodeURIComponent(token) + '/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || ''
      })
    })
    .then(function(res) { return res.ok ? res.json() : null; })
    .catch(function(err) {
      console.warn('[Auth] Invite accept failed:', err);
      return null;
    });
  },

  /**
   * Check Firestore invitations collection for a pending invitation matching
   * the given emailHash. Used during registration to auto-approve invited users.
   * Returns the invitation doc data (with id) if found, or null.
   * @param {string} emailHash - SHA-256 hash of the user's email
   * @returns {Promise<Object|null>}
   * @private
   */
  _checkFirestoreInvitation: function(emailHash) {
    if (!this._db) return Promise.resolve(null);

    return this._db.collection('invitations')
      .where('emailHash', '==', emailHash)
      .where('status', 'in', ['pending', 'sent', 'opened'])
      .limit(1)
      .get()
      .then(function(snapshot) {
        if (snapshot.empty) return null;
        var doc = snapshot.docs[0];
        var data = doc.data();
        // Check expiry client-side
        if (data.expiresAt && data.expiresAt.toDate && data.expiresAt.toDate() < new Date()) {
          console.log('[Auth] Found invitation but it is expired:', doc.id);
          return null;
        }
        console.log('[Auth] Found pending invitation:', doc.id);
        return { id: doc.id, role: data.role, instrument: data.instrument };
      })
      .catch(function(err) {
        console.warn('[Auth] Invitation check failed:', err);
        return null;
      });
  },

  /**
   * Mark an invitation as accepted in Firestore.
   * Fire-and-forget — the user doc is already created as approved.
   * Note: Firestore rules block client writes to invitations collection,
   * but the server Admin SDK (via scheduled sync or the next invitation check)
   * will pick up the acceptance. We update via a temporary accepted_by field
   * on the user doc instead, which the server can read.
   * @param {string} invitationId
   * @private
   */
  _markInvitationAccepted: function(invitationId) {
    // The invitations collection is read-only for clients (Firestore rules).
    // The server will detect the acceptance because the user doc has invitationId.
    // Log for debugging only.
    console.log('[Auth] Invitation acceptance recorded on user doc, invitationId:', invitationId);
  },

  /**
   * Show "Tell us about yourself" form for brand-new users.
   * Collects requestedRole + optional note before writing the Firestore doc.
   * Returns a Promise that resolves to 'pending' after the doc is created.
   * @private
   */
  _showAccessRequestForm: function(user, emailHash, userRef, currentProvider, displayName) {
    return new Promise(function(resolve) {

      // Fallback: if Modal is not ready, create doc silently without request info
      if (typeof Modal === 'undefined') {
        userRef.set({
          displayName: displayName,
          emailHash: emailHash,
          photoURL: user.photoURL || '',
          provider: currentProvider,
          primaryProvider: currentProvider,
          linkedProviders: [currentProvider],
          status: 'pending',
          role: 'member',
          requestedRole: 'member',
          requestNote: '',
          registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function() { resolve('pending'); });
        return;
      }

      var photoHTML = user.photoURL
        ? '<img src="' + user.photoURL + '" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #d4a017;margin-bottom:12px;" />'
        : '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,160,23,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;"><i class="fa-solid fa-user" style="font-size:22px;color:#d4a017;"></i></div>';

      var contentHTML =
        '<div style="text-align:center;padding:8px 0 0;">' +
          photoHTML +
          '<h3 style="margin:0 0 4px;color:#e6edf3;font-size:17px;">Welcome, ' + displayName + '</h3>' +
          '<p style="margin:0 0 20px;color:rgba(255,255,255,0.5);font-size:13px;">Tell us a bit about yourself so we can assign the right access.</p>' +
        '</div>' +
        '<div style="margin-bottom:14px;">' +
          '<label style="display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">What role are you requesting?</label>' +
          '<select id="auth-req-role" style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#161b22;color:#e6edf3;font-size:13px;cursor:pointer;">' +
            '<option value="band_member">Band Member — Musician or vocalist in the band</option>' +
            '<option value="artist">Artist — Principal performing artist</option>' +
            '<option value="venue_owner">Venue Owner — I run or own a venue</option>' +
            '<option value="promoter">Promoter — I handle promotions and events</option>' +
            '<option value="member">Not sure — just checking it out</option>' +
          '</select>' +
        '</div>' +
        '<div style="margin-bottom:20px;">' +
          '<label style="display:block;font-size:12px;font-weight:600;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Note <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>' +
          '<textarea id="auth-req-note" rows="2" maxlength="200" placeholder="e.g. I\'m the drummer, I run Venue X, etc." style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:#161b22;color:#e6edf3;font-size:13px;resize:none;box-sizing:border-box;font-family:inherit;"></textarea>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button id="auth-req-cancel" type="button" style="padding:8px 18px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.6);cursor:pointer;font-size:13px;">Cancel</button>' +
          '<button id="auth-req-submit" type="button" style="padding:8px 20px;border-radius:6px;border:none;background:#d4a017;color:#0d1117;font-size:13px;font-weight:600;cursor:pointer;">Request Access</button>' +
        '</div>';

      Modal.open({
        title: 'Request Dashboard Access',
        content: contentHTML,
        size: 'sm',
        showFooter: false,
        onCancel: function() {
          Auth.signOut();
        }
      });

      // Wire up buttons after modal renders
      setTimeout(function() {
        var submitBtn = document.getElementById('auth-req-submit');
        var cancelBtn = document.getElementById('auth-req-cancel');

        if (cancelBtn) {
          cancelBtn.addEventListener('click', function() {
            Modal.close();
            Auth.signOut();
          });
        }

        if (submitBtn) {
          submitBtn.addEventListener('click', function() {
            var roleEl  = document.getElementById('auth-req-role');
            var noteEl  = document.getElementById('auth-req-note');
            var requestedRole = roleEl  ? roleEl.value  : 'member';
            var requestNote   = noteEl  ? noteEl.value.trim().slice(0, 200) : '';

            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting…';

            userRef.set({
              displayName: displayName,
              emailHash: emailHash,
              photoURL: user.photoURL || '',
              provider: currentProvider,
              primaryProvider: currentProvider,
              linkedProviders: [currentProvider],
              status: 'pending',
              role: 'member',
              requestedRole: requestedRole,
              requestNote: requestNote,
              registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
              lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(function() {
              console.log('[Auth] New registration created for:', displayName,
                '(' + currentProvider + ') — requested role:', requestedRole);
              Modal.close();
              resolve('pending');
            }).catch(function(err) {
              console.error('[Auth] Registration write failed:', err);
              submitBtn.disabled = false;
              submitBtn.textContent = 'Request Access';
              var noteEl2 = document.getElementById('auth-req-note');
              if (noteEl2) noteEl2.placeholder = 'Error saving — please try again.';
            });
          });
        }
      }, 50);
    });
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
          '<p id="auth-pending-status" style="margin:0;color:rgba(255,255,255,0.4);font-size:12px;">' +
            'Checking for approval automatically&hellip;' +
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
        stopPendingPoll();
      }
    });

    // Auto-poll Firestore every 4s — resolves immediately when admin approves
    var _pendingPollTimer = null;
    var _pendingAttempts = 0;
    var MAX_PENDING_ATTEMPTS = 75; // 5 min max

    function stopPendingPoll() {
      if (_pendingPollTimer) {
        clearInterval(_pendingPollTimer);
        _pendingPollTimer = null;
      }
    }

    _pendingPollTimer = setInterval(function() {
      _pendingAttempts++;
      if (_pendingAttempts > MAX_PENDING_ATTEMPTS) {
        stopPendingPoll();
        var statusEl = document.getElementById('auth-pending-status');
        if (statusEl) statusEl.textContent = 'You\'ll get immediate access once approved. Sign in again after approval.';
        return;
      }

      if (!Auth._db) return;

      Auth._db.collection('users').doc(user.uid).get().then(function(doc) {
        if (!doc.exists) return;
        var data = doc.data();
        if (data.status === 'approved') {
          stopPendingPoll();
          var statusEl = document.getElementById('auth-pending-status');
          if (statusEl) {
            statusEl.style.color = '#3fb950';
            statusEl.textContent = '✓ Approved! Loading dashboard…';
          }
          setTimeout(function() {
            Auth._authorized = true;
            Auth._registrationStatus = 'approved';
            Auth._role = data.role || 'member';
            Auth._linkedRoles = (data.linkedRoles && data.linkedRoles.length)
              ? data.linkedRoles : [Auth._role];
            Auth._activeRole = Auth._restoreActiveRole(user.uid);
            if (typeof Modal !== 'undefined') Modal.close();
            Auth._updateUI(user);
            Auth._notifyListeners(user);
            if (typeof Toast !== 'undefined') {
              Toast.success('Welcome, ' + Auth.getUserDisplayName() + '!');
            }
            if (Auth._pendingRoute) {
              var route = Auth._pendingRoute;
              Auth._pendingRoute = null;
              if (typeof Router !== 'undefined') Router.navigateTo(route, true);
            } else {
              if (typeof Router !== 'undefined') Router.navigateTo('dashboard-home');
            }
          }, 1200);
        } else if (data.status === 'denied') {
          stopPendingPoll();
          if (typeof Modal !== 'undefined') Modal.close();
          Auth._auth.signOut();
          Auth._showLoginError('Your access request has been denied.');
        }
      }).catch(function(e) {
        console.warn('[Auth] Pending poll error:', e);
      });
    }, 4000);

    // Bind sign-out button
    setTimeout(function() {
      var btn = document.getElementById('auth-pending-signout');
      if (btn) {
        btn.addEventListener('click', function() {
          stopPendingPoll();
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
   * Show duplicate account detection message (IDP-001 §4.2).
   * Prompts user to sign in with their primary provider.
   * @param {string} primaryProvider - The primary provider ID (e.g., 'google.com')
   * @private
   */
  _showDuplicateAccount: function(primaryProvider) {
    var providerNames = {
      'google.com': 'Google',
      'apple.com': 'Apple',
      'microsoft.com': 'Microsoft',
      'password': 'Email/Password'
    };
    var providerLabel = providerNames[primaryProvider] || primaryProvider;

    if (typeof Modal === 'undefined') return;

    Modal.open({
      title: 'Existing Account Found',
      content:
        '<div style="text-align:center;padding:16px 0;">' +
          '<i class="fa-solid fa-user-group" style="font-size:36px;color:#d4a017;margin-bottom:16px;display:block;"></i>' +
          '<p style="margin:0 0 16px;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;">' +
            'You already have an account using<br>' +
            '<strong style="color:#d4a017;">' + providerLabel + '</strong>.' +
          '</p>' +
          '<p style="margin:0 0 20px;color:rgba(255,255,255,0.5);font-size:13px;line-height:1.5;">' +
            'Please sign in with that provider instead.<br>' +
            'Accounts are linked by email address for security.' +
          '</p>' +
          '<button id="auth-dup-ok" type="button" style="' +
            'padding:10px 32px;border-radius:8px;border:1px solid #d4a017;' +
            'background:linear-gradient(135deg,#d4a017,#b8860b);color:#fff;font-size:14px;' +
            'font-weight:600;cursor:pointer;transition:opacity 0.2s;">' +
            'OK, Sign In with ' + providerLabel +
          '</button>' +
        '</div>',
      size: 'sm',
      showFooter: false
    });

    setTimeout(function() {
      var btn = document.getElementById('auth-dup-ok');
      if (btn) {
        btn.addEventListener('click', function() {
          Modal.close();
          // Re-open the login modal so user can pick the correct provider
          setTimeout(function() { Auth.showLoginModal(); }, 200);
        });
      }
    }, 100);
  },

  /**
   * Show email verification required message (IDP-001 §6.3).
   * Offers resend verification or sign out.
   * @param {Object} user - Firebase user object
   * @private
   */
  _showEmailVerificationRequired: function(user) {
    if (typeof Modal === 'undefined') return;

    Modal.open({
      title: 'Email Verification Required',
      content:
        '<div style="text-align:center;padding:16px 0;">' +
          '<i class="fa-solid fa-envelope-circle-check" style="font-size:36px;color:#d4a017;margin-bottom:16px;display:block;"></i>' +
          '<p style="margin:0 0 12px;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6;">' +
            'Please verify your email address<br>before accessing the dashboard.' +
          '</p>' +
          '<p style="margin:0 0 20px;color:rgba(255,255,255,0.4);font-size:13px;">' +
            'A verification link was sent to<br>' +
            '<strong style="color:#e6edf3;">' + (user.email || '') + '</strong>' +
          '</p>' +
          '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
            '<button id="auth-verify-resend" type="button" style="' +
              'padding:10px 24px;border-radius:8px;border:1px solid #d4a017;' +
              'background:linear-gradient(135deg,#d4a017,#b8860b);color:#fff;font-size:14px;' +
              'font-weight:600;cursor:pointer;transition:opacity 0.2s;">' +
              'Resend Verification' +
            '</button>' +
            '<button id="auth-verify-signout" type="button" style="' +
              'padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);' +
              'background:transparent;color:rgba(255,255,255,0.6);font-size:14px;' +
              'cursor:pointer;transition:all 0.2s;">' +
              'Sign Out' +
            '</button>' +
          '</div>' +
          '<p id="auth-verify-status" style="margin:16px 0 0;color:rgba(255,255,255,0.3);font-size:11px;">' +
            'Checking automatically every few seconds&hellip;' +
          '</p>' +
        '</div>',
      size: 'sm',
      showFooter: false
    });

    // Auto-poll: reload the Firebase user every 3s — resolves automatically
    // when the user clicks the link in a different browser/device.
    var _verifyPollTimer = null;
    var _verifyAttempts = 0;
    var MAX_VERIFY_ATTEMPTS = 60; // 3 min max

    function stopVerifyPoll() {
      if (_verifyPollTimer) {
        clearInterval(_verifyPollTimer);
        _verifyPollTimer = null;
      }
    }

    _verifyPollTimer = setInterval(function() {
      _verifyAttempts++;
      if (_verifyAttempts > MAX_VERIFY_ATTEMPTS) {
        stopVerifyPoll();
        var statusEl = document.getElementById('auth-verify-status');
        if (statusEl) statusEl.textContent = 'Tap "Resend Verification" then sign in again after clicking the link.';
        return;
      }

      user.reload().then(function() {
        if (user.emailVerified) {
          stopVerifyPoll();
          console.log('[Auth] Email verified — proceeding automatically');
          var statusEl = document.getElementById('auth-verify-status');
          if (statusEl) {
            statusEl.style.color = '#3fb950';
            statusEl.textContent = '✓ Email verified! Loading dashboard…';
          }
          // Small delay so user sees the success message, then re-trigger auth flow
          setTimeout(function() {
            if (typeof Modal !== 'undefined') Modal.close();
            // Re-run registration check now that email is verified
            Auth._checkRegistration(user).then(function(status) {
              Auth._registrationStatus = status;
              Auth._authorized = (status === 'approved');
              Auth._updateUI(user);
              Auth._notifyListeners(user);
              if (Auth._authorized && Auth._pendingRoute) {
                var route = Auth._pendingRoute;
                Auth._pendingRoute = null;
                if (typeof Router !== 'undefined') Router.navigateTo(route);
              } else if (Auth._authorized) {
                if (typeof Router !== 'undefined') Router.navigateTo('dashboard-home');
              }
            }).catch(function() {
              Auth._updateUI(user);
              Auth._notifyListeners(user);
            });
          }, 1200);
        }
      }).catch(function(e) {
        console.warn('[Auth] Verify poll reload error:', e);
      });
    }, 3000);

    setTimeout(function() {
      var resendBtn = document.getElementById('auth-verify-resend');
      var signoutBtn = document.getElementById('auth-verify-signout');

      if (resendBtn) {
        resendBtn.addEventListener('click', function() {
          resendBtn.disabled = true;
          resendBtn.textContent = 'Sending...';
          resendBtn.style.opacity = '0.5';
          user.sendEmailVerification().then(function() {
            resendBtn.textContent = 'Sent!';
            resendBtn.style.opacity = '1';
            setTimeout(function() {
              resendBtn.disabled = false;
              resendBtn.textContent = 'Resend Verification';
            }, 3000);
          }).catch(function(e) {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend Verification';
            resendBtn.style.opacity = '1';
            console.warn('[Auth] Failed to resend verification:', e);
            if (typeof Toast !== 'undefined') {
              Toast.error('Failed to send. Try again later.');
            }
          });
        });
      }

      if (signoutBtn) {
        signoutBtn.addEventListener('click', function() {
          stopVerifyPoll();
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

    // Disable all provider buttons + email form
    var allBtns = document.querySelectorAll('.auth-provider-btn');
    var originalLabel = btn.querySelector('span').textContent;
    allBtns.forEach(function(b) {
      b.disabled = true;
      b.style.opacity = '0.5';
      b.style.cursor = 'wait';
    });
    btn.style.opacity = '0.8';
    btn.querySelector('span').textContent = 'Signing in...';

    // Also disable email form during OAuth
    var emailSubmitBtn = document.getElementById('auth-email-submit');
    var emailInputEl = document.getElementById('auth-email-input');
    var emailPassEl = document.getElementById('auth-email-password');
    if (emailSubmitBtn) { emailSubmitBtn.disabled = true; emailSubmitBtn.style.opacity = '0.5'; }
    if (emailInputEl) emailInputEl.disabled = true;
    if (emailPassEl) emailPassEl.disabled = true;

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

        // Re-enable all buttons + email form
        allBtns.forEach(function(b) {
          b.disabled = false;
          b.style.opacity = '1';
          b.style.cursor = 'pointer';
        });
        btn.querySelector('span').textContent = originalLabel;
        if (emailSubmitBtn) { emailSubmitBtn.disabled = false; emailSubmitBtn.style.opacity = '1'; }
        if (emailInputEl) emailInputEl.disabled = false;
        if (emailPassEl) emailPassEl.disabled = false;

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
              message = 'An account already exists with this email using a different sign-in method. Try another provider.';
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
    Auth._updateRoleUI();

    // Update role switcher in topbar (only when user has multiple linked roles)
    Auth._updateRoleSwitcher();
  },

  /**
   * Show/hide sidebar nav items based on the current user's role.
   * Processes data-roles attributes on nav items and auto-hides empty section labels.
   * @private
   */
  _updateRoleUI: function() {
    var role = this._activeRole || this._role || 'member';

    // Show/hide each nav item that declares which roles can see it
    var items = document.querySelectorAll('.sidebar-nav-item[data-roles]');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var allowed = item.getAttribute('data-roles').split(',');
      item.style.display = allowed.indexOf(role) !== -1 ? '' : 'none';
    }

    // Auto-hide group labels when all nav items in the group are hidden
    var groups = document.querySelectorAll('.sidebar-nav-group');
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var groupItems = group.querySelectorAll('.sidebar-nav-item');
      var anyVisible = false;
      for (var j = 0; j < groupItems.length; j++) {
        if (groupItems[j].style.display !== 'none') {
          anyVisible = true;
          break;
        }
      }
      var label = group.querySelector('.sidebar-nav-label');
      if (label) label.style.display = anyVisible ? '' : 'none';
    }
  },

  /**
   * Inject or refresh the role-switcher dropdown in the topbar.
   * Only shown when the authenticated user has 2+ valid linked roles.
   * Filters _linkedRoles against SiteConfig.roles — unknown/stale entries
   * (e.g. typos from Firestore console) are silently ignored.
   * @private
   */
  _updateRoleSwitcher: function() {
    // Remove any existing switcher first (handles state changes / logout)
    var existing = document.getElementById('topbar-role-switcher');
    if (existing) existing.remove();

    if (!this.isAuthenticated()) return;

    var roleRegistry = (typeof SiteConfig !== 'undefined' && SiteConfig.roles) || {};

    // Only include roles that exist in the registry — filters out stale/junk Firestore data
    var validRoles = (this._linkedRoles || []).filter(function(r) {
      return !!roleRegistry[r];
    });

    // Only render when user has 2+ valid linked roles
    if (validRoles.length < 2) return;

    var topbarActions = document.querySelector('.topbar-actions');
    if (!topbarActions) return;

    var activeRole = this._activeRole || this._role;
    var activeInfo = roleRegistry[activeRole] || { label: activeRole, icon: 'fa-user', color: '#8b949e' };

    // Build option buttons for each valid linked role
    var optionsHtml = validRoles.map(function(role) {
      var info = roleRegistry[role];
      var isActive = (role === activeRole);
      return '<button class="gbe-role-opt" data-role="' + role + '" style="' +
        'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;' +
        'background:' + (isActive ? 'rgba(255,255,255,0.06)' : 'transparent') + ';' +
        'border:none;color:' + (isActive ? info.color : 'var(--color-text)') + ';' +
        'cursor:pointer;font-size:13px;border-radius:4px;text-align:left;white-space:nowrap;">' +
        '<i class="fa-solid ' + info.icon + '" style="color:' + info.color + ';width:16px;flex-shrink:0;"></i>' +
        '<span>' + info.label + '</span>' +
        (isActive ? '<i class="fa-solid fa-check" style="margin-left:auto;font-size:10px;padding-left:12px;"></i>' : '') +
        '</button>';
    }).join('');

    // Build switcher container
    var switcherEl = document.createElement('div');
    switcherEl.id = 'topbar-role-switcher';
    switcherEl.style.cssText = 'position:relative;display:flex;align-items:center;margin-right:8px;';
    switcherEl.innerHTML =
      '<button id="gbe-role-btn" title="Switch active role" style="' +
        'display:flex;align-items:center;gap:6px;padding:4px 10px;' +
        'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);' +
        'border-radius:20px;cursor:pointer;color:' + activeInfo.color + ';' +
        'font-size:12px;font-weight:600;line-height:1;white-space:nowrap;">' +
        '<i class="fa-solid ' + activeInfo.icon + '" style="font-size:11px;"></i>' +
        '<span>' + activeInfo.label + '</span>' +
        '<i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--color-text-muted);margin-left:2px;"></i>' +
      '</button>' +
      '<div id="gbe-role-dropdown" style="' +
        'display:none;position:absolute;top:calc(100% + 6px);right:0;' +
        'background:var(--color-bg-secondary,#161b22);border:1px solid var(--color-border,rgba(255,255,255,0.1));' +
        'border-radius:8px;padding:6px;min-width:180px;z-index:10000;' +
        'box-shadow:0 4px 20px rgba(0,0,0,0.5);">' +
        '<div style="padding:4px 12px 6px;font-size:10px;color:var(--color-text-muted);' +
          'font-weight:700;letter-spacing:0.08em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:4px;">View As</div>' +
        optionsHtml +
      '</div>';

    // Insert before the topbar-user element
    var topbarUser = document.getElementById('topbar-user');
    if (topbarUser) {
      topbarActions.insertBefore(switcherEl, topbarUser);
    } else {
      topbarActions.appendChild(switcherEl);
    }

    // Toggle dropdown
    var btn = document.getElementById('gbe-role-btn');
    var dropdown = document.getElementById('gbe-role-dropdown');

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display !== 'none' ? 'none' : 'block';
    });

    // Role option click handler
    dropdown.querySelectorAll('.gbe-role-opt').forEach(function(optBtn) {
      optBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.style.display = 'none';
        Auth.switchRole(optBtn.getAttribute('data-role'));
      });
    });

    // Close on outside click
    setTimeout(function() {
      document.addEventListener('click', function closeDropdown(e) {
        if (dropdown && !dropdown.contains(e.target) && e.target !== btn) {
          dropdown.style.display = 'none';
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 0);
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
