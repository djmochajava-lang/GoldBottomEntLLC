/* ============================================
   auth.js — Gold Bottom Ent. LLC Firebase Auth
   Federated Sign-In (Google, Apple, Microsoft)
   Firestore-based registration & approval
   Version: 1.1.0-prototype
   ============================================ */

const Auth = {
  initialized: false,

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

  /* ------------------------------------------
     Initialization
     ------------------------------------------ */

  /**
   * Initialize Firebase Auth + Firestore with federated providers
   */
  init: function() {
    if (this.initialized) return;

    // Check if Firebase SDK is loaded
    if (typeof firebase === 'undefined') {
      console.warn('[Auth] Firebase SDK not loaded — auth disabled');
      return;
    }

    // Check feature flag
    if (typeof SiteConfig !== 'undefined' &&
        SiteConfig.features && !SiteConfig.features.enableAuth) {
      console.log('[Auth] Auth disabled by feature flag');
      return;
    }

    // Get Firebase config
    var config = (typeof SiteConfig !== 'undefined' && SiteConfig.integrations)
      ? SiteConfig.integrations.firebase
      : null;

    if (!config || !config.apiKey || config.apiKey === '[FIREBASE_API_KEY]') {
      console.warn('[Auth] Firebase config not set — auth disabled');
      console.log('[Auth] Add your Firebase credentials to config.js → integrations.firebase');
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
      return;
    }

    // Set persistence to LOCAL (survives browser restarts — Firebase default)
    this._auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    // Listen for auth state changes
    this._auth.onAuthStateChanged(function(user) {
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
   * Check if a user is currently authenticated AND approved
   * @returns {boolean}
   */
  isAuthenticated: function() {
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
    if (!this._user) return 'Guest';
    return this._user.displayName || this._user.email.split('@')[0];
  },

  /**
   * Get the current user's email
   * @returns {string}
   */
  getUserEmail: function() {
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
   * Sign out the current user
   * @returns {Promise}
   */
  logout: function() {
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
    // If auth is disabled or not initialized, allow all
    if (!this.initialized) return true;

    if (typeof SiteConfig !== 'undefined' &&
        SiteConfig.features && !SiteConfig.features.enableAuth) {
      return true;
    }

    // Only guard dashboard routes
    if (typeof Router !== 'undefined' && !Router.isDashboardRoute(pageName)) {
      return true;
    }

    // If authenticated and approved, allow
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
   * Show the login modal with Google, Apple, and Microsoft sign-in buttons
   */
  showLoginModal: function() {
    if (typeof Modal === 'undefined') {
      console.error('[Auth] Modal system not available');
      return;
    }

    // Shared button base styles
    var btnBase =
      'display:flex;align-items:center;justify-content:center;gap:12px;' +
      'width:100%;padding:12px 24px;border-radius:8px;' +
      'font-family:\'Inter\',\'Roboto\',sans-serif;font-size:15px;font-weight:500;' +
      'cursor:pointer;transition:background 0.2s,box-shadow 0.2s,opacity 0.2s;' +
      'box-shadow:0 1px 3px rgba(0,0,0,0.08);border:1px solid;';

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
        '<div style="margin-bottom:24px;">' +
          '<i class="fa-solid fa-shield-halved" style="font-size:36px;color:#d4a017;margin-bottom:12px;display:block;"></i>' +
          '<p style="margin:0;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.5;">' +
            'Sign in to request<br>dashboard access.' +
          '</p>' +
        '</div>' +
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
