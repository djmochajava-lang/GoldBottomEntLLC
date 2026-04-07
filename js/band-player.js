// js/band-player.js — Soul Society Music Player
// Firebase-backed: Firestore for metadata, Storage for audio/charts.
// Role-gated: admin, band_manager, artist, band_member only.

const BandPlayer = {
  initialized: false,
  _db: null,
  _storage: null,
  _audio: null,
  _playlists: [],
  _songs: [],         // songs for current playlist
  _allSongsMap: {},    // songId → song doc cache
  _inventory: [],      // all songs in Firestore (full inventory)
  _currentPlaylist: null,
  _currentIndex: -1,
  _isPlaying: false,
  _volume: 0.8,
  _prevVolume: 0.8,
  _repeatMode: 'off', // off, all, one
  _editMode: false,
  _editDirty: false,
  _stemStatuses: {}, // songId → { status, projectId, stems }
  _cacheName: 'bp-offline-audio',
  _cacheMaxSongs: 20,
  _cacheIndex: null, // { songId: { savedAt, title } }
  _completedTracks: {}, // trackId → true (practiced to >=80%)
  _loggedThisSession: {}, // trackId → true (debounce: one log per track per session)
  _playOrder: [], // parallel to _songs: { songId, setIndex, position: 'intro'|'song'|'outro' }

  init: function() {
    if (this.initialized) return;
    this._db = (typeof Auth !== 'undefined' && Auth._db) ? Auth._db : null;
    this._storage = (typeof Auth !== 'undefined' && Auth.getStorage) ? Auth.getStorage() : null;

    if (!this._db) {
      console.warn('[BandPlayer] Firestore not available yet — will retry');
      return;
    }

    // Create audio element (Chrome-safe pattern from LA Young player)
    if (!this._audio) {
      this._audio = document.createElement('audio');
      this._audio.preload = 'metadata';
    }

    // Two-screen onboarding gate (band_member and artist only):
    //   Screen 1: Band Confidentiality & Agreement (confidentialityAcceptedAt)
    //   Screen 2: Payment Setup & GBE Freelance Musician Agreement (paymentSetupAt)
    // Admin and band_manager skip straight to the player.
    var self = this;
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'member';
    var skipGate = (role === 'admin' || role === 'band_manager');

    if (skipGate) {
      this._initPlayer();
    } else if (user && this._db) {
      this._db.collection('users').doc(user.uid).get().then(function(doc) {
        var data = doc.exists ? doc.data() : {};
        if (!data.confidentialityAcceptedAt) {
          self._showScreen1();
        } else {
          // Repair missing onboarding fields if needed (e.g. accepted before fields existed)
          var repair = {};
          if (!data.roster_tier) repair.roster_tier = 'on_call';
          if (!data.activity) repair.activity = 'active';
          if (Object.keys(repair).length > 0) {
            self._db.collection('users').doc(user.uid).update(repair).catch(function() {});
          }
          // Ensure playlist permissions are granted
          self._ensurePlaylistPermissions(user.uid);
          self._initPlayer();
        }
      }).catch(function() {
        if (typeof Toast !== 'undefined') Toast.error('Could not verify permissions. Please try again.');
      });
    } else {
      this._showScreen1();
    }
    this.initialized = true;

    // Debug: log auth state for troubleshooting
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'unknown';
    console.log('🎵 Soul Society initialized | uid:', user ? user.uid : 'none', '| role:', role, '| db:', !!this._db, '| storage:', !!this._storage);
  },

  // ── Player Init (after NDA check) ────────────────────

  _initPlayer: function() {
    this._setupAudioEvents();
    this._loadCacheIndex();
    this.loadPlaylists();
    this.loadInventory();
    this._checkPortalBanner();
  },

  _checkPortalBanner: function() {
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    if (!user || !this._db) return;
    var self = this;
    this._db.collection('notifications').doc(user.uid).collection('items')
      .where('status', '==', 'unread').limit(1).get()
      .then(function(snap) {
        if (!snap.empty) {
          var container = self._getContainer();
          if (!container || document.getElementById('bp-portal-banner')) return;
          var banner = document.createElement('div');
          banner.id = 'bp-portal-banner';
          banner.style.cssText = 'background:rgba(210,153,34,0.08);border:1px solid rgba(210,153,34,0.2);border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:13px;color:#d29922;display:flex;align-items:center;gap:8px;';
          banner.innerHTML = '<i class="fa-solid fa-bell"></i> You have items to review in <a href="#dashboard-my-portal" style="color:#d4a017;font-weight:600;">My Portal</a>';
          container.insertBefore(banner, container.firstChild);
        }
      })
      .catch(function() { /* silent */ });
  },

  // ── Set Arrangement Helpers ──────────────────────────

  _migratePlaylistToSets: function(pl) {
    if (pl.sets && pl.sets.length > 0) return;
    if (pl.songOrder && pl.songOrder.length > 0) {
      pl.sets = [{ label: 'Set 1', intro: null, songs: pl.songOrder.slice(), outro: null }];
    } else {
      pl.sets = [{ label: 'Set 1', intro: null, songs: [], outro: null }];
    }
  },

  _flattenSets: function(sets) {
    var flat = [];
    (sets || []).forEach(function(set, si) {
      if (set.intro) flat.push({ songId: set.intro, setIndex: si, position: 'intro' });
      (set.songs || []).forEach(function(id) {
        flat.push({ songId: id, setIndex: si, position: 'song' });
      });
      if (set.outro) flat.push({ songId: set.outro, setIndex: si, position: 'outro' });
    });
    return flat;
  },

  _allSongIdsFromSets: function(sets) {
    var ids = {};
    (sets || []).forEach(function(set) {
      if (set.intro) ids[set.intro] = true;
      (set.songs || []).forEach(function(id) { ids[id] = true; });
      if (set.outro) ids[set.outro] = true;
    });
    return Object.keys(ids);
  },

  _setsToSongOrder: function(sets) {
    var order = [];
    (sets || []).forEach(function(set) {
      if (set.intro) order.push(set.intro);
      (set.songs || []).forEach(function(id) { order.push(id); });
      if (set.outro) order.push(set.outro);
    });
    return order;
  },

  _findSongInSets: function(flatIndex) {
    if (!this._playOrder || !this._playOrder[flatIndex]) return null;
    return this._playOrder[flatIndex];
  },

  // ── Roster + Playlist Helpers ──

  _ensurePlaylistPermissions: function(uid) {
    if (!this._db) return;
    var self = this;
    var db = this._db;
    db.collection('playlist-permissions').where('user_uid', '==', uid).limit(1).get()
      .then(function(snap) {
        if (snap.empty) {
          self._grantDefaultPlaylists(uid);
        }
      })
      .catch(function() { /* silent — permissions will work on next load */ });
  },

  _grantDefaultPlaylists: function(uid) {
    if (!this._db) return;
    var db = this._db;
    // Find all playlists flagged as default and grant permissions
    db.collection('playlists').where('isDefault', '==', true).get()
      .then(function(snap) {
        var batch = db.batch();
        snap.forEach(function(doc) {
          var permRef = db.collection('playlist-permissions').doc();
          batch.set(permRef, {
            user_uid: uid,
            playlist_id: doc.id,
            granted_at: firebase.firestore.FieldValue.serverTimestamp(),
            granted_by: 'system_onboarding'
          });
        });
        if (!snap.empty) {
          return batch.commit();
        }
      })
      .then(function() {
        console.log('[BandPlayer] Default playlists granted for', uid);
      })
      .catch(function(err) {
        console.warn('[BandPlayer] Failed to grant default playlists:', err.message);
      });
  },

  // ── Payment Encryption Helpers ──

  _encKey: null,

  _fetchEncryptionKey: async function() {
    if (this._encKey) return this._encKey;
    // Try Firestore config doc
    if (this._db) {
      try {
        var configDoc = await this._db.collection('config').doc('encryption').get();
        if (configDoc.exists && configDoc.data().key) {
          var raw = new Uint8Array(configDoc.data().key.match(/.{1,2}/g).map(function(b) { return parseInt(b, 16); }));
          this._encKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
          return this._encKey;
        }
      } catch (e) { /* fall through */ }
    }
    // Try sessionStorage
    var cached = sessionStorage.getItem('gbe-enc-key');
    if (cached) {
      var raw2 = new Uint8Array(cached.match(/.{1,2}/g).map(function(b) { return parseInt(b, 16); }));
      this._encKey = await crypto.subtle.importKey('raw', raw2, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return this._encKey;
    }
    return null;
  },

  _encryptField: async function(plaintext, key) {
    if (!plaintext || !key) return '';
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var encoded = new TextEncoder().encode(plaintext);
    var encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, key, encoded);
    var encBytes = new Uint8Array(encrypted);
    var ciphertext = encBytes.slice(0, encBytes.length - 16);
    var authTag = encBytes.slice(encBytes.length - 16);
    function toHex(arr) { return Array.from(arr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(''); }
    return 'enc:v1:' + toHex(iv) + ':' + toHex(authTag) + ':' + toHex(ciphertext);
  },

  // ── Onboarding Helpers ──

  _getContainer: function() {
    return document.getElementById('band-player-content') ||
      document.querySelector('.band-player-container') ||
      document.querySelector('#dash-band-player .dashboard-page-content') ||
      document.querySelector('#dash-band-player');
  },

  _btnStyle: 'padding:12px 32px;border-radius:var(--radius-full);background:var(--color-gold);color:#000;border:none;font-weight:var(--fw-semibold);font-size:var(--text-sm);cursor:pointer;transition:opacity 150ms ease;',
  _inputStyle: 'width:100%;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--color-border);background:var(--color-bg);color:var(--color-text);font-size:var(--text-sm);',
  _labelStyle: 'display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:var(--color-text);',

  // ── SCREEN 1: Band Confidentiality & Agreement ──

  _showScreen1: function() {
    var container = this._getContainer();
    if (!container) return;
    var self = this;

    container.innerHTML =
      '<div style="max-width:560px;margin:var(--space-xl) auto;padding:var(--space-lg);">' +
        '<div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-xl);">' +
          '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,160,23,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-md);">' +
            '<i class="fa-solid fa-shield-halved" style="font-size:24px;color:var(--color-gold);"></i>' +
          '</div>' +
          '<h2 style="color:var(--color-text);font-size:var(--text-lg);margin-bottom:var(--space-xs);text-align:center;">Band Confidentiality &amp; Agreement</h2>' +
          '<p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-bottom:var(--space-lg);text-align:center;line-height:1.6;">' +
            'Welcome to the L.A. Young Soul Society band portal!' +
          '</p>' +
          '<p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-bottom:var(--space-md);text-align:left;line-height:1.6;">' +
            'Before you can access the original songs, demos, charts, and rehearsal materials, please read and agree:' +
          '</p>' +
          '<div style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-md);text-align:left;font-size:var(--text-sm);color:var(--color-text-secondary);line-height:1.8;margin-bottom:var(--space-lg);">' +
            '&bull; All original compositions, lyrics, demos, and arrangements by LA Young are the sole property of Gold Bottom Ent LLC.<br><br>' +
            '&bull; Any contributions, harmonies, adaptations, or ideas I add to LA Young\u2019s pre-existing original material become derivative works owned solely by Gold Bottom Ent LLC / LA Young. I will not claim any ownership, co-writing credit, or royalties unless we specifically agree in writing.<br><br>' +
            '&bull; Rehearsal recordings, charts, setlists, and private band materials are for internal use only. I will not share, distribute, copy, or post them publicly without written permission.<br><br>' +
            '&bull; This applies during our working relationship and for 3 years after (or until the material is publicly released).<br><br>' +
            '<em>I understand I am working as a freelance independent contractor for Gold Bottom Ent LLC only.</em>' +
          '</div>' +
          '<label style="display:flex;align-items:flex-start;gap:8px;font-size:var(--text-sm);color:var(--color-text);cursor:pointer;justify-content:center;margin-bottom:var(--space-lg);">' +
            '<input type="checkbox" id="screen1-checkbox" style="width:18px;height:18px;accent-color:var(--color-gold);margin-top:2px;">' +
            ' I have read, understand, and agree to the above.' +
          '</label>' +
          '<div style="text-align:center;">' +
            '<button id="screen1-btn" disabled style="' + this._btnStyle + 'opacity:0.4;">Accept &amp; Continue</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var checkbox = document.getElementById('screen1-checkbox');
    var btn = document.getElementById('screen1-btn');
    if (checkbox && btn) {
      checkbox.addEventListener('change', function() {
        btn.disabled = !checkbox.checked;
        btn.style.opacity = checkbox.checked ? '1' : '0.4';
      });
      btn.addEventListener('click', function() {
        if (!checkbox.checked) return;
        btn.disabled = true;
        btn.textContent = 'Saving...';
        var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
        if (user && self._db) {
          // Update user doc: confidentiality acceptance + roster fields
          self._db.collection('users').doc(user.uid).update({
            confidentialityAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
            roster_tier: 'on_call',
            activity: 'active'
          }).then(function() {
            // Auto-grant default playlists
            self._grantDefaultPlaylists(user.uid);
            if (typeof Toast !== 'undefined') Toast.success('Welcome to Soul Society!');
            self._initPlayer();
          }).catch(function(err) {
            console.error('[BandPlayer] Screen 1 save failed:', err);
            if (typeof Toast !== 'undefined') Toast.error('Failed to save. Please try again.');
            btn.disabled = false;
            btn.textContent = 'Accept & Continue';
          });
        }
      });
    }
  },

  // ── SCREEN 2: Payment Setup & GBE Freelance Musician Agreement ──
  // mode: 'onboarding' (first time, shows HBA + W-9) or 'edit' (returning, payment only + back button)

  _showScreen2: function(mode) {
    var container = this._getContainer();
    if (!container) return;
    var self = this;
    var IS = this._inputStyle;
    var LS = this._labelStyle;
    var isEdit = (mode === 'edit');
    var title = isEdit ? 'Update Payment Info' : 'Payment Setup &amp; GBE Freelance Musician Agreement';
    var subtitle = isEdit
      ? 'Change how you\u2019d like to get paid. We\u2019ll use these details for all future payments.'
      : 'Thanks for joining the band! Let\u2019s get you set up so we can pay you quickly and easily after every gig.';

    // Pre-fill from Firestore if editing
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    var prefill = function(data) {

    container.innerHTML =
      '<div style="max-width:600px;margin:var(--space-xl) auto;padding:var(--space-lg);">' +
        '<div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-xl);">' +
          (isEdit ? '<div style="margin-bottom:var(--space-md);"><a href="#" id="pay-back-btn" style="color:var(--color-text-secondary);font-size:var(--text-sm);text-decoration:none;"><i class="fa-solid fa-arrow-left" style="margin-right:4px;"></i> Back to Player</a></div>' : '') +
          '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,160,23,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-md);">' +
            '<i class="fa-solid fa-credit-card" style="font-size:24px;color:var(--color-gold);"></i>' +
          '</div>' +
          '<h2 style="color:var(--color-text);font-size:var(--text-lg);margin-bottom:var(--space-xs);text-align:center;">' + title + '</h2>' +
          '<p style="color:var(--color-text-secondary);font-size:var(--text-sm);margin-bottom:var(--space-lg);text-align:center;line-height:1.6;">' + subtitle + '</p>' +

          // Payment Method
          '<div style="margin-bottom:var(--space-lg);">' +
            '<h3 style="font-size:var(--text-base);color:var(--color-gold);margin-bottom:var(--space-sm);">' + (isEdit ? '' : 'Step 1: ') + 'How would you like to get paid?</h3>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:var(--space-sm);">' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);"><input type="radio" name="pay-method" value="direct_deposit"' + (data.paymentMethod === 'direct_deposit' ? ' checked' : '') + '> Direct Deposit</label>' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);"><input type="radio" name="pay-method" value="venmo"' + (data.paymentMethod === 'venmo' ? ' checked' : '') + '> Venmo</label>' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);"><input type="radio" name="pay-method" value="zelle"' + (data.paymentMethod === 'zelle' ? ' checked' : '') + '> Zelle</label>' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);"><input type="radio" name="pay-method" value="cashapp"' + (data.paymentMethod === 'cashapp' ? ' checked' : '') + '> Cash App</label>' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);"><input type="radio" name="pay-method" value="check"' + (data.paymentMethod === 'check' ? ' checked' : '') + '> Check</label>' +
              '<label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);"><input type="radio" name="pay-method" value="other"' + (data.paymentMethod === 'other' ? ' checked' : '') + '> Other</label>' +
            '</div>' +
            '<div id="pay-bank-fields" style="display:' + (data.paymentMethod === 'direct_deposit' ? 'block' : 'none') + ';margin-top:var(--space-sm);">' +
              '<div style="display:grid;gap:10px;">' +
                '<div><label style="' + LS + '">Bank Name <span style="color:var(--color-gold);">*</span></label><input id="pay-bank" type="text" style="' + IS + '" placeholder="e.g. Chase, Bank of America" /></div>' +
                '<div><label style="' + LS + '">Routing Number <span style="color:var(--color-gold);">*</span></label><input id="pay-routing" type="password" style="' + IS + '" placeholder="9-digit routing number" maxlength="9" autocomplete="off" /></div>' +
                '<div><label style="' + LS + '">Account Number <span style="color:var(--color-gold);">*</span></label><input id="pay-account" type="password" style="' + IS + '" placeholder="Account number" autocomplete="off" /></div>' +
              '</div>' +
            '</div>' +
            '<div id="pay-app-fields" style="display:' + (['venmo','zelle','cashapp'].indexOf(data.paymentMethod) >= 0 ? 'block' : 'none') + ';margin-top:var(--space-sm);">' +
              '<div><label style="' + LS + '">Username / Handle <span style="color:var(--color-gold);">*</span></label><input id="pay-handle" type="text" style="' + IS + '" placeholder="e.g. @yourname" value="' + (data.paymentHandle || '').replace(/"/g, '&quot;') + '" /></div>' +
            '</div>' +
            '<div id="pay-check-fields" style="display:' + (data.paymentMethod === 'check' ? 'block' : 'none') + ';margin-top:var(--space-sm);">' +
              '<div><label style="' + LS + '">Mailing Address <span style="color:var(--color-gold);">*</span></label><input id="pay-check-address" type="text" style="' + IS + '" placeholder="Where should we mail the check?" value="' + (data.checkAddress || '').replace(/"/g, '&quot;') + '" /></div>' +
            '</div>' +
            '<div id="pay-other-fields" style="display:' + (data.paymentMethod === 'other' ? 'block' : 'none') + ';margin-top:var(--space-sm);">' +
              '<div><label style="' + LS + '">Please describe <span style="color:var(--color-gold);">*</span></label><input id="pay-other" type="text" style="' + IS + '" placeholder="How would you like to be paid?" value="' + (data.paymentOther || '').replace(/"/g, '&quot;') + '" /></div>' +
            '</div>' +
            '<p id="pay-error" style="display:none;color:#f85149;font-size:var(--text-sm);margin-top:var(--space-xs);"></p>' +
          '</div>' +

          // GBE Freelance Musician Agreement — show based on completion status, not edit/onboard mode
          (data.houseBandAgreedAt ? (
          // ACCEPTED — show green status card with "View Agreement" link
          '<div style="margin-bottom:var(--space-lg);background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);border-radius:var(--radius-md);padding:var(--space-md);">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--space-xs);">' +
              '<i class="fa-solid fa-circle-check" style="color:#3fb950;font-size:18px;"></i>' +
              '<h3 style="font-size:var(--text-base);color:#3fb950;margin:0;">GBE Freelance Musician Agreement — Accepted</h3>' +
            '</div>' +
            '<p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-sm);">Accepted on ' + (data.houseBandAgreedAt.toDate ? data.houseBandAgreedAt.toDate().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'}) : 'file') + '. A copy is kept on record with Gold Bottom Ent LLC.</p>' +
            '<a href="#" id="hba-view-link" style="font-size:var(--text-sm);color:var(--color-gold);text-decoration:none;"><i class="fa-solid fa-file-lines" style="margin-right:4px;"></i>View Agreement</a>' +
            '<div id="hba-view-content" style="display:none;margin-top:var(--space-sm);background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-md);font-size:var(--text-sm);color:var(--color-text-secondary);line-height:1.8;">' +
              '&bull; You are a freelance independent contractor for Gold Bottom Ent LLC only (not an employee). You handle your own taxes and insurance.<br><br>' +
              '&bull; LA Young\u2019s original compositions, lyrics, and demos are her / Gold Bottom Ent LLC\u2019s sole property. Any contributions or arrangements you make to her pre-existing originals are derivative works owned solely by her / the LLC. You will not claim ownership, co-writing credit, or royalties unless we agree in writing.<br><br>' +
              '&bull; Rehearsal materials, charts, and recordings are for band use only \u2014 please don\u2019t share them publicly.<br><br>' +
              '&bull; No extra pay for rehearsals, local travel, or prep unless we note it for a specific gig.<br><br>' +
              '&bull; You\u2019re responsible for your own gear. We\u2019re not liable for loss or damage unless caused by our direct negligence.<br><br>' +
              '&bull; All obligations are with Gold Bottom Ent LLC only \u2014 no personal liability for Jeffery Ponder or LA Young.' +
            '</div>' +
          '</div>'
          ) : (
          // NOT YET ACCEPTED — show agreement for acceptance
          '<div style="margin-bottom:var(--space-lg);">' +
            '<h3 style="font-size:var(--text-base);color:var(--color-gold);margin-bottom:var(--space-sm);cursor:pointer;" id="hba-toggle">' + (isEdit ? '' : 'Step 2: ') + 'GBE Freelance Musician Agreement <i class="fa-solid fa-chevron-down" style="font-size:12px;margin-left:4px;"></i></h3>' +
            '<p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-sm);line-height:1.5;">Please review our GBE Freelance Musician Agreement terms (this formalizes what we\u2019ve already been doing):</p>' +
            '<div id="hba-content" style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-md);text-align:left;font-size:var(--text-sm);color:var(--color-text-secondary);line-height:1.8;margin-bottom:var(--space-sm);">' +
              '&bull; You are a freelance independent contractor for Gold Bottom Ent LLC only (not an employee). You handle your own taxes and insurance.<br><br>' +
              '&bull; LA Young\u2019s original compositions, lyrics, and demos are her / Gold Bottom Ent LLC\u2019s sole property. Any contributions or arrangements you make to her pre-existing originals are derivative works owned solely by her / the LLC. You will not claim ownership, co-writing credit, or royalties unless we agree in writing.<br><br>' +
              '&bull; Rehearsal materials, charts, and recordings are for band use only \u2014 please don\u2019t share them publicly.<br><br>' +
              '&bull; No extra pay for rehearsals, local travel, or prep unless we note it for a specific gig.<br><br>' +
              '&bull; You\u2019re responsible for your own gear. We\u2019re not liable for loss or damage unless caused by our direct negligence.<br><br>' +
              '&bull; All obligations are with Gold Bottom Ent LLC only \u2014 no personal liability for Jeffery Ponder or LA Young.' +
            '</div>' +
            '<label style="display:flex;align-items:flex-start;gap:8px;font-size:var(--text-sm);color:var(--color-text);cursor:pointer;margin-bottom:var(--space-sm);">' +
              '<input type="checkbox" id="hba-checkbox" style="width:18px;height:18px;accent-color:var(--color-gold);margin-top:2px;">' +
              ' I have read and agree to the GBE Freelance Musician Agreement terms above.' +
            '</label>' +
          '</div>'
          )) +

          // W-9 Tax Information — always show, with status indicator
          '<div style="margin-bottom:var(--space-lg);">' +
            (data.w9LegalName ? (
            // W-9 ON FILE — green status
            '<div style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-sm);">' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<i class="fa-solid fa-circle-check" style="color:#3fb950;font-size:18px;"></i>' +
                '<h3 style="font-size:var(--text-base);color:#3fb950;margin:0;">W-9 Information On File</h3>' +
              '</div>' +
              '<p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:var(--space-xs);">Name: ' + (data.w9LegalName || '').replace(/</g,'&lt;') + '</p>' +
            '</div>'
            ) : (
            // W-9 MISSING — yellow warning
            '<div style="background:rgba(210,153,34,0.08);border:1px solid rgba(210,153,34,0.3);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-sm);">' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:var(--space-xs);">' +
                '<i class="fa-solid fa-triangle-exclamation" style="color:#d29922;font-size:18px;"></i>' +
                '<h3 style="font-size:var(--text-base);color:#d29922;margin:0;">' + (isEdit ? '' : 'Step 3: ') + 'Tax Information (W-9)</h3>' +
              '</div>' +
              '<p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:var(--space-sm);line-height:1.5;"><strong>Required for payments over $2,000 within a calendar year.</strong> The IRS requires us to file a 1099-NEC for independent contractors paid $2,000+ annually. Please provide your W-9 info so we can pay you without delay.</p>' +
              '<div style="display:grid;gap:10px;">' +
                '<div><label style="' + LS + '">Legal Full Name <span style="color:var(--color-gold);">*</span></label><input id="w9-name" type="text" style="' + IS + '" placeholder="As it appears on your tax return" /></div>' +
                '<div><label style="' + LS + '">Mailing Address</label><input id="w9-address" type="text" style="' + IS + '" placeholder="Street, City, State, ZIP" /></div>' +
              '</div>' +
            '</div>'
            )) +
          '</div>' +

          // Security notice
          '<div style="background:rgba(210,153,34,0.08);border:1px solid rgba(210,153,34,0.2);border-radius:8px;padding:10px 14px;margin:16px 0;font-size:12px;color:#d29922;line-height:1.5;">' +
            '<i class="fa-solid fa-shield-halved" style="margin-right:6px;"></i> For your security, never share banking or payment details over phone, text, or regular email. Always use your secure portal link.' +
          '</div>' +

          // Save button
          '<div style="text-align:center;">' +
            '<button id="screen2-btn" disabled style="' + self._btnStyle + 'opacity:0.4;">' + (isEdit ? 'Save Changes' : 'Save Payment Info &amp; Agreement') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Wire up interactions
    var radios = container.querySelectorAll('input[name="pay-method"]');
    var bankFields = document.getElementById('pay-bank-fields');
    var appFields = document.getElementById('pay-app-fields');
    var checkFields = document.getElementById('pay-check-fields');
    var otherFields = document.getElementById('pay-other-fields');
    var payError = document.getElementById('pay-error');
    var hbaCheckbox = document.getElementById('hba-checkbox');
    var saveBtn = document.getElementById('screen2-btn');

    function updateSaveBtn() {
      var methodRadio = container.querySelector('input[name="pay-method"]:checked');
      var hbaOk = isEdit || (hbaCheckbox && hbaCheckbox.checked);
      var ok = methodRadio && hbaOk;
      if (saveBtn) {
        saveBtn.disabled = !ok;
        saveBtn.style.opacity = ok ? '1' : '0.4';
      }
    }

    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener('change', function() {
        var v = this.value;
        bankFields.style.display = v === 'direct_deposit' ? 'block' : 'none';
        appFields.style.display = (['venmo','zelle','cashapp'].indexOf(v) >= 0) ? 'block' : 'none';
        checkFields.style.display = v === 'check' ? 'block' : 'none';
        otherFields.style.display = v === 'other' ? 'block' : 'none';
        if (payError) payError.style.display = 'none';
        updateSaveBtn();
      });
    }

    if (hbaCheckbox) hbaCheckbox.addEventListener('change', updateSaveBtn);

    // HBA toggle (acceptance mode)
    var hbaToggle = document.getElementById('hba-toggle');
    var hbaContent = document.getElementById('hba-content');
    if (hbaToggle && hbaContent) {
      hbaToggle.addEventListener('click', function() {
        var visible = hbaContent.style.display !== 'none';
        hbaContent.style.display = visible ? 'none' : 'block';
        var icon = hbaToggle.querySelector('i');
        if (icon) icon.className = visible ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-down';
      });
    }

    // HBA view link (read-only mode — already accepted)
    var hbaViewLink = document.getElementById('hba-view-link');
    var hbaViewContent = document.getElementById('hba-view-content');
    if (hbaViewLink && hbaViewContent) {
      hbaViewLink.addEventListener('click', function(e) {
        e.preventDefault();
        var visible = hbaViewContent.style.display !== 'none';
        hbaViewContent.style.display = visible ? 'none' : 'block';
        hbaViewLink.innerHTML = visible
          ? '<i class="fa-solid fa-file-lines" style="margin-right:4px;"></i>View Agreement'
          : '<i class="fa-solid fa-file-lines" style="margin-right:4px;"></i>Hide Agreement';
      });
    }

    // Back button (edit mode)
    var backBtn = document.getElementById('pay-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function(e) {
        e.preventDefault();
        self._initPlayer();
      });
    }

    // Validate required details for selected method
    function validateDetails(method) {
      if (method === 'direct_deposit') {
        var bank = (document.getElementById('pay-bank') || {}).value || '';
        var routing = (document.getElementById('pay-routing') || {}).value || '';
        var account = (document.getElementById('pay-account') || {}).value || '';
        if (!bank.trim()) return 'Please enter your bank name.';
        if (!routing.trim() || routing.trim().length < 9) return 'Please enter a valid 9-digit routing number.';
        if (!account.trim()) return 'Please enter your account number.';
      } else if (method === 'venmo' || method === 'zelle' || method === 'cashapp') {
        var handle = (document.getElementById('pay-handle') || {}).value || '';
        if (!handle.trim()) return 'Please enter your ' + method.charAt(0).toUpperCase() + method.slice(1).replace('app','App') + ' username or handle.';
      } else if (method === 'check') {
        var addr = (document.getElementById('pay-check-address') || {}).value || '';
        if (!addr.trim()) return 'Please enter the mailing address for your check.';
      } else if (method === 'other') {
        var desc = (document.getElementById('pay-other') || {}).value || '';
        if (!desc.trim()) return 'Please describe how you\u2019d like to be paid.';
      }
      return null;
    }

    // Save handler
    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        var methodRadio = container.querySelector('input[name="pay-method"]:checked');
        if (!methodRadio) return;
        var method = methodRadio.value;

        // Validate details
        var err = validateDetails(method);
        if (err) {
          if (payError) { payError.textContent = err; payError.style.display = 'block'; }
          return;
        }
        if (payError) payError.style.display = 'none';

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        var _resetBtn = function() {
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? 'Save Changes' : 'Save Payment Info & Agreement';
        };

        if (!user || !self._db) {
          if (typeof Toast !== 'undefined') Toast.error('Not signed in. Please refresh and try again.');
          _resetBtn();
          return;
        }

        try {
          var paymentData = { method: method };
          if (method === 'direct_deposit') {
            paymentData.bankName = (document.getElementById('pay-bank') || {}).value || '';
          } else if (method === 'venmo' || method === 'zelle' || method === 'cashapp') {
            paymentData.handle = (document.getElementById('pay-handle') || {}).value || '';
          } else if (method === 'check') {
            paymentData.checkAddress = (document.getElementById('pay-check-address') || {}).value || '';
          } else if (method === 'other') {
            paymentData.description = (document.getElementById('pay-other') || {}).value || '';
          }

          // Encrypt payment fields before Firestore write
          var encKey = await self._fetchEncryptionKey();
          var methodEnc = encKey ? await self._encryptField(paymentData.method, encKey) : paymentData.method;
          var handleEnc = encKey && paymentData.handle ? await self._encryptField(paymentData.handle, encKey) : (paymentData.handle || '');
          var bankEnc = encKey && paymentData.bankName ? await self._encryptField(paymentData.bankName, encKey) : (paymentData.bankName || '');
          var checkEnc = encKey && paymentData.checkAddress ? await self._encryptField(paymentData.checkAddress, encKey) : (paymentData.checkAddress || '');

          var updateData = {
            paymentSetupAt: firebase.firestore.FieldValue.serverTimestamp(),
            // Encrypted fields (Firestore = cache, HomeOffice decrypts on sync)
            payment_method_enc: methodEnc,
            payment_handle_enc: handleEnc,
            bank_name_enc: bankEnc,
            check_address_enc: checkEnc,
            // Keep plain text method name for BM visibility (not sensitive)
            paymentMethod: paymentData.method,
            paymentOther: paymentData.description || '',
            onboardingComplete: true
          };
          // Save Freelance Musician Agreement acceptance
          if (hbaCheckbox && hbaCheckbox.checked && !data.freelanceAgreementAcceptedAt && !data.houseBandAgreedAt) {
            updateData.freelanceAgreementAcceptedAt = firebase.firestore.FieldValue.serverTimestamp();
            updateData.houseBandAgreedAt = firebase.firestore.FieldValue.serverTimestamp();
            updateData.houseBandAgreementVersion = '1.0';
          }
          // Save W-9 if fields are present and filled
          var w9Name = (document.getElementById('w9-name') || {}).value || '';
          var w9Addr = (document.getElementById('w9-address') || {}).value || '';
          if (w9Name.trim()) {
            updateData.w9LegalName = w9Name;
            updateData.w9Address = w9Addr;
          }

          await self._db.collection('users').doc(user.uid).update(updateData);

          // Send sensitive bank details to server (not Firestore)
          if (method === 'direct_deposit') {
            var routing = (document.getElementById('pay-routing') || {}).value || '';
            var account = (document.getElementById('pay-account') || {}).value || '';
            if (routing || account) {
              self._sendBankDetails(user.uid, paymentData.bankName, routing, account);
            }
          }
          _resetBtn();
          if (isEdit) {
            if (typeof Toast !== 'undefined') Toast.success('Payment info updated!');
            self._initPlayer();
          } else {
            self._showSetupComplete();
          }
        } catch (err) {
          console.error('[BandPlayer] Screen 2 save failed:', err);
          if (typeof Toast !== 'undefined') Toast.error('Failed to save. Please try again.');
          _resetBtn();
        }
      });
    }

    }; // end prefill callback

    // Load existing data for pre-fill
    if (user && this._db) {
      this._db.collection('users').doc(user.uid).get().then(function(doc) {
        prefill(doc.exists ? doc.data() : {});
      }).catch(function() { prefill({}); });
    } else {
      prefill({});
    }
  },

  // Open payment settings from the player (edit mode)
  showPaymentSettings: function() {
    this._showScreen2('edit');
  },

  _sendBankDetails: function(uid, bankName, routing, account) {
    // Send bank details to home office server for encrypted storage — NOT Firestore
    var isLocal = (typeof Auth !== 'undefined' && Auth.isLocalDashboard && Auth.isLocalDashboard());
    if (!isLocal) return; // Only send when on LAN
    var baseUrl = window.location.protocol + '//' + window.location.hostname + ':3000';
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', baseUrl + '/api/v1/onboarding/payment-details', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      var token = localStorage.getItem('gbe-session-token') || '';
      if (token) xhr.setRequestHeader('X-GBE-Session', token);
      xhr.send(JSON.stringify({ uid: uid, bankName: bankName, routing: routing, account: account }));
    } catch (e) {
      console.warn('[BandPlayer] Bank details send failed (non-critical):', e.message);
    }
  },

  _showSetupComplete: function() {
    var container = this._getContainer();
    if (!container) return;
    var self = this;

    container.innerHTML =
      '<div style="max-width:520px;margin:var(--space-xl) auto;text-align:center;padding:var(--space-lg);">' +
        '<div style="background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:var(--space-xl);">' +
          '<div style="width:64px;height:64px;border-radius:50%;background:rgba(63,185,80,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-md);">' +
            '<i class="fa-solid fa-check" style="font-size:28px;color:#3fb950;"></i>' +
          '</div>' +
          '<h2 style="color:var(--color-text);font-size:var(--text-lg);margin-bottom:var(--space-sm);">You\u2019re all set!</h2>' +
          '<p style="color:var(--color-text-secondary);font-size:var(--text-sm);line-height:1.6;margin-bottom:var(--space-lg);">' +
            'Payment setup complete! Looking forward to the next gig with you.' +
          '</p>' +
          '<button id="setup-done-btn" style="' + this._btnStyle + '">Enter the Band Portal</button>' +
        '</div>' +
      '</div>';

    var doneBtn = document.getElementById('setup-done-btn');
    if (doneBtn) {
      doneBtn.addEventListener('click', function() {
        if (typeof Toast !== 'undefined') Toast.success('Welcome to Soul Society!');
        self._initPlayer();
      });
    }
  },

  // ── Data Loading ──────────────────────────────────────

  loadPlaylists: function() {
    var self = this;
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'member';
    var isManager = (role === 'admin' || role === 'band_manager');

    this._db.collection('playlists').orderBy('createdAt', 'desc').get()
      .then(function(snap) {
        self._playlists = [];
        snap.forEach(function(doc) {
          self._playlists.push(Object.assign({ id: doc.id }, doc.data()));
        });

        // For band members: filter to playlists assigned to their gigs
        if (!isManager && user) {
          self._db.collection('gigs')
            .where('assignedMusicians', 'array-contains', user.uid)
            .where('status', '==', 'upcoming')
            .get()
            .then(function(gigsSnap) {
              var gigPlaylistIds = {};
              gigsSnap.forEach(function(doc) {
                var gig = doc.data();
                if (gig.playlistId) gigPlaylistIds[gig.playlistId] = true;
              });
              // If gigs have linked playlists, filter; otherwise show all (graceful)
              if (Object.keys(gigPlaylistIds).length > 0) {
                self._playlists = self._playlists.filter(function(pl) {
                  return gigPlaylistIds[pl.id] || pl.isPublic;
                });
              }
              self.renderPlaylistDropdown();
              if (self._playlists.length > 0) { self.selectPlaylist(self._playlists[0].id); }
              else { self._renderEmptyState(); }
            })
            .catch(function() {
              // Firestore error — show all playlists (graceful degradation)
              self.renderPlaylistDropdown();
              if (self._playlists.length > 0) self.selectPlaylist(self._playlists[0].id);
              else self._renderEmptyState();
            });
          return;
        }

        self.renderPlaylistDropdown();
        // Auto-select first playlist
        if (self._playlists.length > 0) {
          self.selectPlaylist(self._playlists[0].id);
        } else {
          self._renderEmptyState();
        }
      })
      .catch(function(e) {
        console.error('[BandPlayer] Failed to load playlists:', e);
        var el = document.getElementById('bp-tracklist');
        if (el) el.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.4);">Could not load playlists. Check your connection.</div>';
      });
  },

  loadInventory: function() {
    var self = this;
    this._db.collection('songs').orderBy('createdAt', 'desc').get()
      .then(function(snap) {
        self._inventory = [];
        snap.forEach(function(doc) {
          var data = Object.assign({ id: doc.id }, doc.data());
          self._inventory.push(data);
          self._allSongsMap[doc.id] = data;
        });
        console.log('[BandPlayer] Inventory loaded: ' + self._inventory.length + ' songs');
      })
      .catch(function(e) {
        console.error('[BandPlayer] Failed to load inventory:', e);
      });
  },

  selectPlaylist: function(playlistId) {
    var self = this;
    var pl = this._playlists.find(function(p) { return p.id === playlistId; });
    if (!pl) return;

    // Stop playback when switching playlists
    if (this._audio) {
      this._audio.pause();
      this._audio.currentTime = 0;
    }
    this._isPlaying = false;
    this._currentPlaylist = pl;
    this._currentIndex = -1;
    this._songs = [];
    this._playOrder = [];
    this._loggedThisSession = {};
    this._completedTracks = {};

    // Migrate legacy flat playlists to sets
    this._migratePlaylistToSets(pl);

    var playOrder = this._flattenSets(pl.sets);
    var uniqueIds = this._allSongIdsFromSets(pl.sets);

    if (uniqueIds.length === 0) {
      self._songs = [];
      self._playOrder = [];
      self.renderTrackList();
      return;
    }

    // Batch-fetch songs (Firestore in queries max 10 per batch)
    var batches = [];
    for (var i = 0; i < uniqueIds.length; i += 10) {
      batches.push(uniqueIds.slice(i, i + 10));
    }

    Promise.all(batches.map(function(batch) {
      return self._db.collection('songs').where(firebase.firestore.FieldPath.documentId(), 'in', batch).get();
    }))
    .then(function(snapshots) {
      var songMap = {};
      snapshots.forEach(function(snap) {
        snap.forEach(function(doc) {
          var data = Object.assign({ id: doc.id }, doc.data());
          songMap[doc.id] = data;
          self._allSongsMap[doc.id] = data;
        });
      });
      // Build _songs and _playOrder in flattened set order
      self._playOrder = [];
      self._songs = [];
      playOrder.forEach(function(entry) {
        var song = songMap[entry.songId];
        if (song) {
          self._songs.push(song);
          self._playOrder.push(entry);
        }
      });
      self.renderTrackList();
      self._loadCompletedTracks(playlistId);
    })
    .catch(function(e) {
      console.error('[BandPlayer] Failed to load songs:', e);
    });

    // Update dropdown selection
    var sel = document.getElementById('bp-playlist-select');
    if (sel) sel.value = playlistId;
  },

  // ── Playback (matches LA Young pattern) ──────────────

  play: function(index) {
    if (index < 0 || index >= this._songs.length) return;
    var song = this._songs[index];
    if (!song || !song.audioPath) return;

    var self = this;

    // Stop completely before loading new track
    this._audio.pause();
    this._audio.currentTime = 0;
    this._isPlaying = false;
    this._currentIndex = index;
    this.updateNowPlaying();
    this.renderTrackList();

    // Try cache first, then fall back to network
    this._getCachedAudioUrl(song.id).then(function(cachedUrl) {
      if (cachedUrl) {
        console.log('[BandPlayer] Playing from cache: ' + song.title);
        self._loadAndPlay(cachedUrl);
      } else if (self._storage) {
        var ref = self._storage.ref(song.audioPath);
        ref.getDownloadURL().then(function(url) {
          self._loadAndPlay(url);
        }).catch(function(e) {
          console.error('[BandPlayer] Failed to get audio URL:', e);
          if (typeof Toast !== 'undefined') Toast.error('Could not load audio file');
        });
      } else {
        if (typeof Toast !== 'undefined') Toast.error('Storage not available');
      }
    });
  },

  _loadAndPlay: function(url) {
    var self = this;
    this._audio.src = url;
    this._audio.load();

    this._audio.play().then(function() {
      self._isPlaying = true;
      self.updateNowPlaying();
      self.renderTrackList();
    }).catch(function(err) {
      console.warn('[BandPlayer] Play blocked:', err.name, '— waiting for canplay');
      self._audio.addEventListener('canplay', function retry() {
        self._audio.removeEventListener('canplay', retry);
        self._audio.play().then(function() {
          self._isPlaying = true;
          self.updateNowPlaying();
          self.renderTrackList();
        }).catch(function(e) {
          console.warn('[BandPlayer] Retry failed:', e.name);
          if (typeof Toast !== 'undefined') Toast.error('Tap play to start audio');
        });
      });
    });
  },

  togglePlay: function() {
    if (this._currentIndex === -1 && this._songs.length > 0) {
      this.play(0);
      return;
    }
    var self = this;
    if (this._isPlaying) {
      this._audio.pause();
      this._isPlaying = false;
      this.updateNowPlaying();
      this.renderTrackList();
    } else {
      this._audio.play().then(function() {
        self._isPlaying = true;
        self.updateNowPlaying();
        self.renderTrackList();
      }).catch(function(err) {
        console.warn('[BandPlayer] Resume blocked:', err.name);
      });
    }
  },

  next: function() {
    if (this._songs.length === 0) return;
    if (this._currentIndex < this._songs.length - 1) {
      this.play(this._currentIndex + 1);
    } else if (this._repeatMode === 'all') {
      this.play(0);
    }
  },

  prev: function() {
    if (this._songs.length === 0) return;
    if (this._audio.currentTime > 3) {
      this._audio.currentTime = 0;
      return;
    }
    if (this._currentIndex > 0) {
      this.play(this._currentIndex - 1);
    }
  },

  seek: function(pct) {
    if (this._audio.duration) {
      this._audio.currentTime = pct * this._audio.duration;
    }
  },

  setVolume: function(val) {
    this._volume = Math.max(0, Math.min(1, val));
    if (this._volume > 0) this._prevVolume = this._volume;
    this._audio.volume = this._volume;
    var slider = document.getElementById('bp-vol-slider');
    if (slider) slider.value = Math.round(this._volume * 100);
    var icon = document.getElementById('bp-vol-icon');
    if (icon) icon.className = 'fa-solid ' + (this._volume === 0 ? 'fa-volume-xmark' : this._volume < 0.5 ? 'fa-volume-low' : 'fa-volume-high');
  },

  toggleMute: function() {
    if (this._volume > 0) {
      this._prevVolume = this._volume;
      this.setVolume(0);
    } else {
      this.setVolume(this._prevVolume || 0.8);
    }
  },

  toggleRepeat: function() {
    var modes = ['off', 'all', 'one'];
    var idx = modes.indexOf(this._repeatMode);
    this._repeatMode = modes[(idx + 1) % 3];
    var btn = document.getElementById('bp-repeat-btn');
    var badge = document.getElementById('bp-repeat-badge');
    if (btn) {
      btn.className = this._repeatMode !== 'off' ? 'bp-ctrl-active' : '';
      btn.style.color = this._repeatMode !== 'off' ? '#d4a017' : 'rgba(255,255,255,0.45)';
    }
    if (badge) badge.style.display = this._repeatMode === 'one' ? '' : 'none';
  },

  _setupAudioEvents: function() {
    var self = this;
    this._audio.addEventListener('timeupdate', function() {
      var prog = document.getElementById('bp-prog-fill');
      var timeEl = document.getElementById('bp-prog-current');
      if (prog && self._audio.duration) {
        prog.style.width = (self._audio.currentTime / self._audio.duration * 100) + '%';
      }
      if (timeEl) timeEl.textContent = self._formatTime(self._audio.currentTime);
    });
    this._audio.addEventListener('loadedmetadata', function() {
      var durEl = document.getElementById('bp-prog-total');
      if (durEl) durEl.textContent = self._formatTime(self._audio.duration);
      // Save duration to song data
      if (self._songs[self._currentIndex]) {
        self._songs[self._currentIndex].duration = self._audio.duration;
      }
    });
    // Track 80% completion threshold for practice logging
    this._audio.addEventListener('timeupdate', function() {
      if (self._audio.duration && self._currentIndex >= 0) {
        var pct = self._audio.currentTime / self._audio.duration;
        if (pct >= 0.80) {
          var song = self._songs[self._currentIndex];
          if (song && !self._loggedThisSession[song.id]) {
            self._logPlaybackEvent(song.id, 'complete', pct);
            self._loggedThisSession[song.id] = true;
            self._completedTracks[song.id] = true;
            self.renderTrackList(); // refresh checkmarks
          }
        }
      }
    });
    this._audio.addEventListener('ended', function() {
      // Log completion if not already logged at 80%
      var song = self._songs[self._currentIndex];
      if (song && !self._loggedThisSession[song.id]) {
        self._logPlaybackEvent(song.id, 'complete', 1.0);
        self._loggedThisSession[song.id] = true;
        self._completedTracks[song.id] = true;
      }
      if (self._repeatMode === 'one') {
        self._audio.currentTime = 0;
        self._audio.play();
      } else if (self._repeatMode === 'all') {
        self.next();
      } else {
        // off — stop at end of playlist
        if (self._currentIndex < self._songs.length - 1) {
          self.next();
        } else {
          self._isPlaying = false;
          self.updateNowPlaying();
          self.renderTrackList();
        }
      }
    });
    this._audio.volume = this._volume;
  },

  /**
   * Log a playback event to Firestore for practice tracking.
   * Debounced: one complete event per track per session.
   */
  _logPlaybackEvent: function(trackId, eventType, progress) {
    if (!this._db) return;
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    if (!user) return;

    var data = {
      userId: user.uid,
      trackId: trackId,
      playlistId: this._currentPlaylist ? this._currentPlaylist.id : null,
      eventType: eventType,
      progress: Math.round(progress * 100) / 100,
      listenedSeconds: Math.round(this._audio.currentTime || 0),
      duration: Math.round(this._audio.duration || 0),
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    this._db.collection('playback-events').add(data).catch(function(err) {
      console.warn('[BandPlayer] Playback log failed:', err.message);
    });
  },

  /**
   * Load completed track IDs for the current user + playlist.
   * Called on playlist load.
   */
  _loadCompletedTracks: function(playlistId) {
    if (!this._db) return;
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    if (!user) return;
    var self = this;

    this._db.collection('playback-events')
      .where('userId', '==', user.uid)
      .where('playlistId', '==', playlistId)
      .where('eventType', '==', 'complete')
      .get()
      .then(function(snapshot) {
        self._completedTracks = {};
        snapshot.forEach(function(doc) {
          self._completedTracks[doc.data().trackId] = true;
        });
        self.renderTrackList();
      })
      .catch(function(err) {
        console.warn('[BandPlayer] Completed tracks load failed:', err.message);
      });
  },

  // ── Lyrics & Charts ──────────────────────────────────

  // Template lyrics for new songs
  _templateLyrics: '[Verse 1]\nPlaceholder lyrics line one\nPlaceholder lyrics line two\nPlaceholder lyrics line three\nPlaceholder lyrics line four\n\n[Chorus]\nPlaceholder chorus line one\nPlaceholder chorus line two\nPlaceholder chorus line three\n\n[Verse 2]\nPlaceholder lyrics line five\nPlaceholder lyrics line six\nPlaceholder lyrics line seven\nPlaceholder lyrics line eight\n\n[Chorus]\nPlaceholder chorus line one\nPlaceholder chorus line two\nPlaceholder chorus line three\n\n[Bridge]\nPlaceholder bridge line one\nPlaceholder bridge line two\n\n[Outro]\nPlaceholder outro line',

  showLyrics: function(songId) {
    var song = this._allSongsMap[songId];
    if (!song) return;
    var lyrics = song.lyrics || this._templateLyrics;
    var self = this;

    // Build lyrics paper lines from text
    var lines = lyrics.split('\n');
    var bodyHtml = lines.map(function(line) {
      var trimmed = line.trim();
      if (!trimmed) return '<p class="bp-lyric-line bp-verse-gap">&nbsp;</p>';
      if (/^\[.*\]$/.test(trimmed)) {
        return '<p class="bp-lyric-line bp-section-label">' + self._escHtml(trimmed.replace(/[\[\]]/g, '')) + '</p>';
      }
      if (/chorus/i.test(lyrics.substring(0, lyrics.indexOf(line)).split('\n').pop())) {
        return '<p class="bp-lyric-line bp-chorus">' + self._escHtml(trimmed) + '</p>';
      }
      return '<p class="bp-lyric-line">' + self._escHtml(trimmed) + '</p>';
    }).join('');

    // Create overlay (LA Young paper style)
    var overlay = document.createElement('div');
    overlay.id = 'bp-lyrics-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,2,5,0.96);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);display:flex;align-items:center;justify-content:center;padding:40px 20px;overflow-y:auto;';
    overlay.innerHTML =
      '<div style="position:relative;width:100%;max-width:720px;background:#f9f6f0;padding:50px 55px 60px;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.4);margin:auto 0;">' +
        '<button onclick="document.getElementById(\'bp-lyrics-overlay\').remove()" style="position:absolute;top:16px;right:20px;width:40px;height:40px;border:1px solid rgba(0,0,0,0.1);background:#f9f6f0;color:#2a2a2a;font-size:1.8rem;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">&times;</button>' +
        '<div style="text-align:center;margin-bottom:8px;">' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:10px;color:#999;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">PROPRIETARY &amp; CONFIDENTIAL</p>' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:10px;color:#aaa;letter-spacing:1px;">Gold Bottom Entertainment</p>' +
        '</div>' +
        '<div style="text-align:center;margin-bottom:30px;">' +
          '<img src="images/logo/gbe-logo.svg" style="width:60px;height:60px;margin-bottom:12px;opacity:0.15;" onerror="this.style.display=\'none\'">' +
          '<h2 style="font-family:\'Times New Roman\',Georgia,serif;font-size:22px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#2a2a2a;margin-bottom:8px;">' + this._escHtml(song.title) + '</h2>' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:13px;font-style:italic;color:#888;letter-spacing:1px;">Written by ' + this._escHtml(song.artist || 'L.A. Young') + '</p>' +
          '<div style="width:80px;height:1px;background:#ccc;margin:20px auto;"></div>' +
        '</div>' +
        '<div style="text-align:center;">' + bodyHtml + '</div>' +
        '<div style="text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid #ddd;">' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:9px;color:#aaa;letter-spacing:1px;">&copy; 2026 Gold Bottom Ent LLC. All rights reserved.</p>' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:9px;color:#aaa;letter-spacing:1px;">Unauthorized reproduction or distribution prohibited.</p>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },

  showChart: function(songId) {
    var song = this._allSongsMap[songId];
    if (!song) return;
    var self = this;

    // Always re-fetch from Firestore so we get the latest charts field
    // (song may have been cached before charts were generated)
    var fetchAndShow = function(latestSong) {
      var charts = (latestSong.charts && Object.keys(latestSong.charts).length > 0) ? latestSong.charts : null;

      if (charts) {
        // All band team members see the chart picker (FRD-4 permissions)
        self._showChartPicker(latestSong, charts);
        return;
      }

      // No charts yet — show placeholder
      self._showTemplateChart(latestSong);
    };

    // Re-fetch song from Firestore to get latest charts
    if (this._db) {
      this._db.collection('songs').doc(songId).get().then(function(doc) {
        var latestSong = doc.exists ? Object.assign({ id: songId }, doc.data()) : song;
        // Update local cache
        self._allSongsMap[songId] = latestSong;
        fetchAndShow(latestSong);
      }).catch(function() {
        // Fall back to cached song on error
        fetchAndShow(song);
      });
    } else {
      fetchAndShow(song);
    }
  },

  _showChartPicker: function(song, charts) {
    var self = this;
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'member';
    var isManager = (role === 'admin' || role === 'band_manager');

    // Load chart review status from Firestore, then render
    var reviewsPromise = this._db ?
      this._db.collection('chart-reviews').where('songId', '==', song.id).get() :
      Promise.resolve({ docs: [] });

    reviewsPromise.then(function(snap) {
      var reviews = {};
      snap.docs.forEach(function(doc) {
        var data = doc.data();
        reviews[data.instrument] = data;
      });
      self._renderChartPickerModal(song, charts, reviews, isManager);
    }).catch(function() {
      self._renderChartPickerModal(song, charts, {}, isManager);
    });
  },

  _renderChartPickerModal: function(song, charts, reviews, isManager) {
    var LABELS = { drums: 'Drums', bass: 'Bass', other: 'Keys / Guitar', vocals: 'Vocals' };
    var ICONS  = { drums: 'fa-drum', bass: 'fa-guitar-electric', other: 'fa-piano-keyboard', vocals: 'fa-microphone' };
    var songId = song.id;

    var html = '<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">';
    Object.keys(charts).forEach(function(key) {
      var label = LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
      var icon  = ICONS[key] || 'fa-music';
      var review = reviews[key] || {};
      var status = review.status || 'pending';
      var version = review.version || 1;

      // Status badge
      var badge = '';
      if (status === 'approved') {
        badge = '<span style="font-size:11px;background:rgba(63,185,80,0.15);color:#3fb950;padding:2px 8px;border-radius:10px;margin-left:8px;"><i class="fa-solid fa-check" style="margin-right:3px;"></i>Approved</span>';
      } else if (status === 'flagged') {
        badge = '<span style="font-size:11px;background:rgba(248,81,73,0.15);color:#f85149;padding:2px 8px;border-radius:10px;margin-left:8px;"><i class="fa-solid fa-flag" style="margin-right:3px;"></i>Flagged</span>';
      }
      if (version > 1) {
        badge += '<span style="font-size:10px;color:rgba(255,255,255,0.3);margin-left:6px;">v' + version + '</span>';
      }

      // Chart row — view button
      var borderColor = status === 'flagged' ? 'rgba(248,81,73,0.3)' : status === 'approved' ? 'rgba(63,185,80,0.2)' : 'rgba(255,255,255,0.1)';
      html += '<div style="background:rgba(255,255,255,0.04);border:1px solid ' + borderColor + ';border-radius:8px;padding:12px 14px;">';
      html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">';
      html += '<i class="fa-solid ' + icon + '" style="width:20px;text-align:center;color:rgba(255,255,255,0.4);"></i>';
      html += '<span style="font-size:15px;color:rgba(255,255,255,0.85);flex:1;">' + label + badge + '</span>';
      html += '<button onclick="BandPlayer._openChartFile(\'' + BandPlayer._escHtml(charts[key]) + '\',\'' + BandPlayer._escHtml(song.title + ' \u2014 ' + label) + '\');" ' +
        'style="background:none;border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:rgba(255,255,255,0.6);padding:4px 10px;cursor:pointer;font-size:12px;">View PDF</button>';
      html += '</div>';

      // Action buttons row
      html += '<div style="display:flex;gap:8px;margin-top:6px;">';

      // Approve button (all band team except when already approved by this user)
      html += '<button id="chart-approve-' + key + '" onclick="BandPlayer.reviewChart(\'' + songId + '\',\'' + key + '\',\'approved\')" ' +
        'style="flex:1;padding:6px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid ' +
        (status === 'approved' ? 'rgba(63,185,80,0.4);background:rgba(63,185,80,0.15);color:#3fb950;' : 'rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.6);') + '">' +
        '<i class="fa-solid fa-check" style="margin-right:4px;"></i>' + (status === 'approved' ? 'Approved' : 'Approve') + '</button>';

      // Flag button
      html += '<button id="chart-flag-' + key + '" onclick="BandPlayer.reviewChart(\'' + songId + '\',\'' + key + '\',\'flagged\')" ' +
        'style="flex:1;padding:6px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid ' +
        (status === 'flagged' ? 'rgba(248,81,73,0.4);background:rgba(248,81,73,0.15);color:#f85149;' : 'rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.6);') + '">' +
        '<i class="fa-solid fa-flag" style="margin-right:4px;"></i>' + (status === 'flagged' ? 'Flagged' : 'Flag') + '</button>';

      // Re-upload button (band_manager only, visible for flagged charts)
      if (isManager) {
        html += '<button onclick="BandPlayer.reuploadChart(\'' + songId + '\',\'' + key + '\')" ' +
          'style="padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid rgba(210,153,34,0.3);background:rgba(210,153,34,0.1);color:#d29922;">' +
          '<i class="fa-solid fa-upload" style="margin-right:4px;"></i>Re-upload</button>';
      }

      html += '</div></div>';
    });
    html += '</div>';

    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: '\u266A ' + this._escHtml(this._titleCase(song.title)),
        size: 'md',
        content: html,
        saveText: '',
        cancelText: 'Close'
      });
    }
  },

  // ── Chart Review (approve / flag per instrument) ────

  reviewChart: function(songId, instrument, status) {
    var self = this;
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    if (!user || !this._db) return;

    var docId = songId + '_' + instrument;
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'member';

    // Load existing review to preserve version
    this._db.collection('chart-reviews').doc(docId).get().then(function(doc) {
      var existing = doc.exists ? doc.data() : {};
      var version = existing.version || 1;

      return self._db.collection('chart-reviews').doc(docId).set({
        songId: songId,
        instrument: instrument,
        status: status,
        version: version,
        reviewedBy: user.uid,
        reviewerName: user.displayName || user.email || '',
        reviewerRole: role,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }).then(function() {
      if (typeof Toast !== 'undefined') {
        Toast.success(instrument.charAt(0).toUpperCase() + instrument.slice(1) + ' chart ' + (status === 'approved' ? 'approved' : 'flagged'));
      }
      // Update button states in the modal without closing it
      var approveBtn = document.getElementById('chart-approve-' + instrument);
      var flagBtn = document.getElementById('chart-flag-' + instrument);
      if (approveBtn) {
        approveBtn.style.borderColor = status === 'approved' ? 'rgba(63,185,80,0.4)' : 'rgba(255,255,255,0.12)';
        approveBtn.style.background = status === 'approved' ? 'rgba(63,185,80,0.15)' : 'rgba(255,255,255,0.03)';
        approveBtn.style.color = status === 'approved' ? '#3fb950' : 'rgba(255,255,255,0.6)';
        approveBtn.innerHTML = '<i class="fa-solid fa-check" style="margin-right:4px;"></i>' + (status === 'approved' ? 'Approved' : 'Approve');
      }
      if (flagBtn) {
        flagBtn.style.borderColor = status === 'flagged' ? 'rgba(248,81,73,0.4)' : 'rgba(255,255,255,0.12)';
        flagBtn.style.background = status === 'flagged' ? 'rgba(248,81,73,0.15)' : 'rgba(255,255,255,0.03)';
        flagBtn.style.color = status === 'flagged' ? '#f85149' : 'rgba(255,255,255,0.6)';
        flagBtn.innerHTML = '<i class="fa-solid fa-flag" style="margin-right:4px;"></i>' + (status === 'flagged' ? 'Flagged' : 'Flag');
      }
    }).catch(function(err) {
      if (typeof Toast !== 'undefined') Toast.error('Review failed: ' + err.message);
    });
  },

  // ── Chart Re-upload (band_manager corrects flagged chart) ──

  reuploadChart: function(songId, instrument) {
    var self = this;
    if (!this._db || !this._storage) return;
    var song = this._allSongsMap[songId];
    if (!song) return;

    var LABELS = { drums: 'Drums', bass: 'Bass', other: 'Keys / Guitar', vocals: 'Vocals' };
    var label = LABELS[instrument] || instrument;

    var content = '<div style="display:flex;flex-direction:column;gap:12px;">' +
      '<p style="font-size:14px;color:rgba(255,255,255,0.7);">Upload a corrected chart for <strong>' + this._escHtml(label) + '</strong>.</p>' +
      '<input id="bp-reupload-file" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" />' +
      '</div>';

    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: 'Re-upload Chart — ' + label,
        size: 'sm',
        content: content,
        buttons: [
          { label: 'Cancel', class: 'btn-secondary', close: true },
          { label: 'Upload', class: 'btn-primary', callback: function() {
            var fileInput = document.getElementById('bp-reupload-file');
            if (!fileInput || !fileInput.files.length) {
              if (typeof Toast !== 'undefined') Toast.error('Please select a file');
              return;
            }
            var file = fileInput.files[0];
            var ext = file.name.split('.').pop().toLowerCase();
            var storagePath = 'band-media/charts/' + songId + '/' + instrument + '.' + ext;
            var ref = self._storage.ref(storagePath);

            if (typeof Toast !== 'undefined') Toast.info('Uploading...');

            ref.put(file).then(function() {
              // Update song charts in Firestore
              var chartUpdate = {};
              chartUpdate['charts.' + instrument] = storagePath;
              return self._db.collection('songs').doc(songId).update(chartUpdate);
            }).then(function() {
              // Increment version and clear flagged status in chart-reviews
              var docId = songId + '_' + instrument;
              return self._db.collection('chart-reviews').doc(docId).get().then(function(doc) {
                var existing = doc.exists ? doc.data() : {};
                var newVersion = (existing.version || 1) + 1;
                return self._db.collection('chart-reviews').doc(docId).set({
                  songId: songId,
                  instrument: instrument,
                  status: 'pending',
                  version: newVersion,
                  updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
              });
            }).then(function() {
              if (typeof Modal !== 'undefined') Modal.close();
              if (typeof Toast !== 'undefined') Toast.success(label + ' chart updated — awaiting re-review');
              // Update local cache
              if (song.charts) song.charts[instrument] = storagePath;
            }).catch(function(err) {
              if (typeof Toast !== 'undefined') Toast.error('Upload failed: ' + err.message);
            });
          }}
        ]
      });
    }
  },

  _showTemplateChart: function(song) {
    var self = this;
    // SVG music staff with notes (placeholder chart)
    var staffSvg = '';
    for (var s = 0; s < 4; s++) {
      var yOff = s * 80;
      // 5 staff lines
      staffSvg += '<g transform="translate(0,' + yOff + ')">';
      for (var l = 0; l < 5; l++) {
        staffSvg += '<line x1="0" y1="' + (l * 10) + '" x2="580" y2="' + (l * 10) + '" stroke="#999" stroke-width="0.7"/>';
      }
      // Treble clef
      staffSvg += '<text x="4" y="32" font-size="42" font-family="serif" fill="#2a2a2a">&#119070;</text>';
      // Time signature
      staffSvg += '<text x="40" y="18" font-size="20" font-family="serif" font-weight="bold" fill="#2a2a2a">4</text>';
      staffSvg += '<text x="40" y="36" font-size="20" font-family="serif" font-weight="bold" fill="#2a2a2a">4</text>';
      // Notes (quarter + eighth notes placed on staff)
      var notePositions = [
        {x:80,y:30},{x:130,y:20},{x:180,y:25},{x:230,y:10},
        {x:290,y:35},{x:340,y:15},{x:390,y:20},{x:440,y:30},
        {x:500,y:25},{x:540,y:10}
      ];
      notePositions.forEach(function(n) {
        // Note head (filled oval)
        staffSvg += '<ellipse cx="' + n.x + '" cy="' + n.y + '" rx="6" ry="4.5" fill="#2a2a2a" transform="rotate(-15,' + n.x + ',' + n.y + ')"/>';
        // Stem
        staffSvg += '<line x1="' + (n.x + 5) + '" y1="' + n.y + '" x2="' + (n.x + 5) + '" y2="' + (n.y - 28) + '" stroke="#2a2a2a" stroke-width="1.2"/>';
      });
      // Bar lines
      staffSvg += '<line x1="270" y1="0" x2="270" y2="40" stroke="#2a2a2a" stroke-width="1"/>';
      staffSvg += '<line x1="480" y1="0" x2="480" y2="40" stroke="#2a2a2a" stroke-width="1"/>';
      staffSvg += '<line x1="580" y1="0" x2="580" y2="40" stroke="#2a2a2a" stroke-width="1.5"/>';
      staffSvg += '</g>';
    }

    var overlay = document.createElement('div');
    overlay.id = 'bp-chart-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,2,5,0.96);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);display:flex;align-items:center;justify-content:center;padding:40px 20px;overflow-y:auto;';
    overlay.innerHTML =
      '<div style="position:relative;width:100%;max-width:720px;background:#f9f6f0;padding:50px 40px 60px;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.4);margin:auto 0;">' +
        '<button onclick="document.getElementById(\'bp-chart-overlay\').remove()" style="position:absolute;top:16px;right:20px;width:40px;height:40px;border:1px solid rgba(0,0,0,0.1);background:#f9f6f0;color:#2a2a2a;font-size:1.8rem;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">&times;</button>' +
        '<div style="text-align:center;margin-bottom:30px;">' +
          '<h2 style="font-family:\'Times New Roman\',Georgia,serif;font-size:22px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#2a2a2a;margin-bottom:8px;">' + this._escHtml(song.title) + '</h2>' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:14px;font-style:italic;color:#888;">Keys / Guitar Chart</p>' +
          '<div style="width:80px;height:1px;background:#ccc;margin:16px auto;"></div>' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:10px;color:#bbb;letter-spacing:1px;text-transform:uppercase;">Gold Bottom Ent. LLC &mdash; Confidential</p>' +
        '</div>' +
        '<div style="overflow-x:auto;padding:10px 0;">' +
          '<svg viewBox="0 0 590 320" style="width:100%;max-width:590px;margin:0 auto;display:block;">' + staffSvg + '</svg>' +
        '</div>' +
        '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #ddd;text-align:center;">' +
          '<p style="font-family:\'Times New Roman\',Georgia,serif;font-size:11px;color:#aaa;font-style:italic;">Tempo: &#9833; = 120 BPM &nbsp;&bull;&nbsp; Key: C Major &nbsp;&bull;&nbsp; Time: 4/4</p>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },

  _openChartFile: function(storagePath, title) {
    var storage = (typeof Auth !== 'undefined' && Auth.getStorage) ? Auth.getStorage() : null;
    if (!storage) return;
    // storagePath may be a relative path like 'band-media/charts/...' or a full gs:// URL
    var ref;
    if (storagePath.startsWith('gs://') || storagePath.startsWith('https://')) {
      ref = storage.refFromURL(storagePath);
    } else {
      ref = storage.ref(storagePath);
    }
    ref.getDownloadURL().then(function(url) {
      window.open(url, '_blank');
      if (typeof Modal !== 'undefined') Modal.close();
    }).catch(function(e) {
      console.error('[BandPlayer] Chart download failed:', e);
      if (typeof Toast !== 'undefined') Toast.error('Could not load chart file');
    });
  },

  // ── Track Notes & Flagging ───────────────────────────

  showTrackNotes: function(songId) {
    var song = this._allSongsMap[songId];
    if (!song) return;
    var self = this;
    var user = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user : null;
    if (!user || !this._db) return;

    // Load existing notes for this track from Firestore
    var noteDocId = songId + '_' + user.uid;
    this._db.collection('track-notes').doc(noteDocId).get().then(function(doc) {
      var existing = doc.exists ? doc.data() : {};
      var noteText = existing.notes || '';
      var flagged = existing.flagged || false;

      var content = '<div style="margin-bottom:12px;">'
        + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:12px;">'
        + '<input type="checkbox" id="tn-flag" ' + (flagged ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:#d29922;" />'
        + '<span style="font-size:14px;"><i class="fa-solid fa-flag" style="color:#d29922;margin-right:4px;"></i> Flag for discussion with band manager</span>'
        + '</label>'
        + '<textarea id="tn-notes" rows="5" placeholder="Your notes on this track (practice reminders, questions, arrangement ideas...)" '
        + 'style="width:100%;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);padding:10px;font-family:inherit;resize:vertical;">'
        + self._escHtml(noteText) + '</textarea></div>';

      if (typeof Modal !== 'undefined') {
        Modal.open({
          title: 'Notes — ' + self._titleCase(song.title),
          body: content,
          size: 'md',
          buttons: [
            { label: 'Cancel', class: 'btn-secondary', close: true },
            { label: 'Save Notes', class: 'btn-primary', callback: function() {
              var notes = document.getElementById('tn-notes').value.trim();
              var flag = document.getElementById('tn-flag').checked;
              self._db.collection('track-notes').doc(noteDocId).set({
                songId: songId,
                userId: user.uid,
                userName: user.displayName || user.email || '',
                songTitle: song.title,
                notes: notes,
                flagged: flag,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              }, { merge: true }).then(function() {
                if (typeof Modal !== 'undefined') Modal.close();
                if (typeof Toast !== 'undefined') Toast.success('Notes saved!');
              }).catch(function(err) {
                if (typeof Toast !== 'undefined') Toast.error('Save failed: ' + err.message);
              });
            }}
          ]
        });
      }
    });
  },

  // ── Permissions (band_manager / admin only) ──────────

  showPermissions: function() {
    if (!this._db || !this._currentPlaylist) return;
    var self = this;
    var plId = this._currentPlaylist.id;

    // Load current permissions doc for this playlist
    this._db.collection('playlist-permissions').doc(plId).get().then(function(doc) {
      var perms = doc.exists ? doc.data() : { accessLevel: 'all_band', restrictedSongs: [] };

      var content = '<div style="display:flex;flex-direction:column;gap:16px;">'
        + '<div><label style="font-size:13px;display:block;margin-bottom:6px;font-weight:600;">Access Level</label>'
        + '<select id="perm-level" style="width:100%;padding:8px;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);">'
        + '<option value="all_band"' + (perms.accessLevel === 'all_band' ? ' selected' : '') + '>All Band Members</option>'
        + '<option value="assigned_only"' + (perms.accessLevel === 'assigned_only' ? ' selected' : '') + '>Assigned Gig Musicians Only</option>'
        + '<option value="custom"' + (perms.accessLevel === 'custom' ? ' selected' : '') + '>Custom (by musician)</option>'
        + '</select></div>'
        + '<div><label style="font-size:13px;display:block;margin-bottom:6px;font-weight:600;">Download Policy</label>'
        + '<select id="perm-download" style="width:100%;padding:8px;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);">'
        + '<option value="allowed"' + (perms.downloadPolicy !== 'disabled' ? ' selected' : '') + '>Downloads Allowed</option>'
        + '<option value="disabled"' + (perms.downloadPolicy === 'disabled' ? ' selected' : '') + '>Downloads Disabled</option>'
        + '</select></div>'
        + '<div><label style="font-size:13px;display:block;margin-bottom:6px;font-weight:600;">Charts & Lyrics</label>'
        + '<select id="perm-charts" style="width:100%;padding:8px;background:var(--color-bg-tertiary);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);">'
        + '<option value="all"' + (perms.chartsAccess !== 'instrument_only' ? ' selected' : '') + '>All Charts Visible</option>'
        + '<option value="instrument_only"' + (perms.chartsAccess === 'instrument_only' ? ' selected' : '') + '>Own Instrument Only</option>'
        + '</select></div>'
        + '</div>';

      if (typeof Modal !== 'undefined') {
        Modal.open({
          title: 'Playlist Permissions — ' + (self._currentPlaylist.name || 'Playlist'),
          body: content,
          size: 'md',
          buttons: [
            { label: 'Cancel', class: 'btn-secondary', close: true },
            { label: 'Save', class: 'btn-primary', callback: function() {
              var data = {
                playlistId: plId,
                accessLevel: document.getElementById('perm-level').value,
                downloadPolicy: document.getElementById('perm-download').value,
                chartsAccess: document.getElementById('perm-charts').value,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              };
              self._db.collection('playlist-permissions').doc(plId).set(data, { merge: true }).then(function() {
                // Also update the playlist doc with downloadPolicy for inline checks
                self._db.collection('playlists').doc(plId).update({ downloadPolicy: data.downloadPolicy });
                self._currentPlaylist.downloadPolicy = data.downloadPolicy;
                if (typeof Modal !== 'undefined') Modal.close();
                if (typeof Toast !== 'undefined') Toast.success('Permissions saved!');
              }).catch(function(err) {
                if (typeof Toast !== 'undefined') Toast.error('Save failed: ' + err.message);
              });
            }}
          ]
        });
      }
    });
  },

  // ── Edit Mode (band_manager / admin only) ─────────────

  toggleEditMode: function() {
    if (this._editMode) {
      this._exitEditMode();
    } else {
      this._enterEditMode();
    }
  },

  _enterEditMode: function() {
    this._editMode = true;
    this._editDirty = false;
    // Pause playback when entering edit mode
    if (this._isPlaying) {
      this._audio.pause();
      this._isPlaying = false;
      this.updateNowPlaying();
    }
    var btn = document.getElementById('bp-edit-toggle');
    if (btn) {
      btn.style.background = 'rgba(88,166,255,0.15)';
      btn.style.color = '#58a6ff';
      btn.style.borderColor = 'rgba(88,166,255,0.3)';
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    }
    this.renderTrackList();
  },

  _exitEditMode: function() {
    var self = this;
    this._editMode = false;
    var btn = document.getElementById('bp-edit-toggle');
    if (btn) {
      btn.style.background = 'rgba(255,255,255,0.04)';
      btn.style.color = 'rgba(255,255,255,0.5)';
      btn.style.borderColor = 'rgba(255,255,255,0.1)';
      btn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    }
    // Save sets to Firestore if changed
    if (this._editDirty && this._currentPlaylist) {
      var sets = this._currentPlaylist.sets || [];
      var flatOrder = this._setsToSongOrder(sets);
      this._db.collection('playlists').doc(this._currentPlaylist.id).update({
        sets: sets,
        songOrder: flatOrder,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function() {
        self._currentPlaylist.songOrder = flatOrder;
        if (typeof Toast !== 'undefined') Toast.success('Set arrangement saved');
      }).catch(function(e) {
        console.error('[BandPlayer] Failed to save sets:', e);
        if (typeof Toast !== 'undefined') Toast.error('Failed to save arrangement');
      });
    }
    this._editDirty = false;
    // Rebuild flat arrays from current sets
    var playOrder = this._flattenSets(this._currentPlaylist ? this._currentPlaylist.sets : []);
    var songMap = this._allSongsMap;
    this._playOrder = [];
    this._songs = [];
    var self2 = this;
    playOrder.forEach(function(entry) {
      var song = songMap[entry.songId];
      if (song) {
        self2._songs.push(song);
        self2._playOrder.push(entry);
      }
    });
    this.renderTrackList();
  },

  moveSong: function(setIndex, position, songIndex, direction) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || !sets[setIndex]) return;
    var arr = sets[setIndex].songs;
    if (position !== 'song' || !arr) return;
    var toIndex = songIndex + direction;
    if (toIndex < 0 || toIndex >= arr.length) return;
    var temp = arr[songIndex];
    arr[songIndex] = arr[toIndex];
    arr[toIndex] = temp;
    this._editDirty = true;
    this._rebuildFlatFromSets();
    this.renderTrackList();
  },

  removeSong: function(setIndex, position, songIndex) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || !sets[setIndex]) return;
    var set = sets[setIndex];
    var songId = (position === 'intro') ? set.intro : (position === 'outro') ? set.outro : (set.songs || [])[songIndex];
    var song = this._allSongsMap[songId];
    var title = song ? this._escHtml(song.title) : 'this song';

    var self = this;
    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: 'Remove Song',
        size: 'sm',
        content: '<p style="color:#e6edf3;font-size:15px;">Remove <strong>' + title + '</strong> from this set?</p>' +
          '<p style="color:rgba(255,255,255,0.45);font-size:13px;margin-top:8px;">The song won\'t be deleted — it can be added back later.</p>',
        saveText: 'Remove',
        onSave: function() {
          if (position === 'intro') set.intro = null;
          else if (position === 'outro') set.outro = null;
          else if (set.songs) set.songs.splice(songIndex, 1);
          self._editDirty = true;
          self._rebuildFlatFromSets();
          Modal.close();
          self.renderTrackList();
        }
      });
    }
  },

  // ── Set Management ──────────────────────────────────────

  addSet: function() {
    if (!this._currentPlaylist) return;
    this._migratePlaylistToSets(this._currentPlaylist);
    var sets = this._currentPlaylist.sets;
    sets.push({ label: 'Set ' + (sets.length + 1), intro: null, songs: [], outro: null });
    this._editDirty = true;
    this._rebuildFlatFromSets();
    this.renderTrackList();
  },

  removeSet: function(setIndex) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || !sets[setIndex]) return;
    var self = this;
    var label = sets[setIndex].label || ('Set ' + (setIndex + 1));
    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: 'Remove Set',
        size: 'sm',
        content: '<p style="color:#e6edf3;font-size:15px;">Remove <strong>' + this._escHtml(label) + '</strong> and all its songs from this arrangement?</p>' +
          '<p style="color:rgba(255,255,255,0.45);font-size:13px;margin-top:8px;">Songs won\'t be deleted from inventory.</p>',
        saveText: 'Remove',
        onSave: function() {
          sets.splice(setIndex, 1);
          // Always keep at least one set
          if (sets.length === 0) sets.push({ label: 'Set 1', intro: null, songs: [], outro: null });
          // Re-label default-named sets
          sets.forEach(function(s, i) { if (/^Set \d+$/.test(s.label)) s.label = 'Set ' + (i + 1); });
          self._editDirty = true;
          self._rebuildFlatFromSets();
          Modal.close();
          self.renderTrackList();
        }
      });
    }
  },

  moveSet: function(setIndex, direction) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets) return;
    var toIndex = setIndex + direction;
    if (toIndex < 0 || toIndex >= sets.length) return;
    var temp = sets[setIndex];
    sets[setIndex] = sets[toIndex];
    sets[toIndex] = temp;
    // Re-label default-named sets
    sets.forEach(function(s, i) { if (/^Set \d+$/.test(s.label)) s.label = 'Set ' + (i + 1); });
    this._editDirty = true;
    this._rebuildFlatFromSets();
    this.renderTrackList();
  },

  assignIntro: function(setIndex) {
    this._assignSlot(setIndex, 'intro');
  },

  assignOutro: function(setIndex) {
    this._assignSlot(setIndex, 'outro');
  },

  _assignSlot: function(setIndex, slot) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || !sets[setIndex]) return;
    var self = this;

    // Build picker from inventory
    var assigned = {};
    this._allSongIdsFromSets(sets).forEach(function(id) { assigned[id] = true; });
    var available = this._inventory.filter(function(s) { return !assigned[s.id]; });

    if (available.length === 0) {
      if (typeof Toast !== 'undefined') Toast.info('No available songs. Upload or remove songs from other slots first.');
      return;
    }

    var html = '<div style="max-height:60vh;overflow-y:auto;">';
    available.forEach(function(song) {
      html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
        '<div style="width:36px;height:36px;border-radius:8px;background:rgba(212,160,23,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<i class="fa-solid fa-music" style="color:#d4a017;font-size:14px;"></i></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:14px;font-weight:600;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escHtml(self._titleCase(song.title)) + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">' + self._escHtml(song.artist || 'Unknown') + '</div>' +
        '</div>' +
        '<button onclick="BandPlayer._selectSlotSong(' + setIndex + ',\'' + slot + '\',\'' + song.id + '\')" ' +
          'style="padding:6px 14px;border-radius:6px;border:1px solid rgba(212,160,23,0.25);background:rgba(212,160,23,0.1);color:#d4a017;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;white-space:nowrap;">' +
          'Select</button>' +
      '</div>';
    });
    html += '</div>';

    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: 'Choose ' + (slot === 'intro' ? 'Intro' : 'Outro') + ' for ' + (sets[setIndex].label || 'Set ' + (setIndex + 1)),
        size: 'md',
        content: html,
        saveText: 'Cancel',
        onSave: function() { Modal.close(); }
      });
    }
  },

  _selectSlotSong: function(setIndex, slot, songId) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || !sets[setIndex]) return;
    sets[setIndex][slot] = songId;
    this._editDirty = true;
    this._rebuildFlatFromSets();
    if (typeof Modal !== 'undefined') Modal.close();
    this.renderTrackList();
  },

  clearIntro: function(setIndex) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || !sets[setIndex]) return;
    sets[setIndex].intro = null;
    this._editDirty = true;
    this._rebuildFlatFromSets();
    this.renderTrackList();
  },

  clearOutro: function(setIndex) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || !sets[setIndex]) return;
    sets[setIndex].outro = null;
    this._editDirty = true;
    this._rebuildFlatFromSets();
    this.renderTrackList();
  },

  moveToSet: function(fromSetIndex, position, songIndex) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets || sets.length < 2) return;

    var fromSet = sets[fromSetIndex];
    var songId;
    if (position === 'intro') songId = fromSet.intro;
    else if (position === 'outro') songId = fromSet.outro;
    else songId = (fromSet.songs || [])[songIndex];
    if (!songId) return;

    var song = this._allSongsMap[songId];
    var title = song ? this._escHtml(this._titleCase(song.title)) : 'this song';
    var self = this;

    var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
    sets.forEach(function(set, si) {
      if (si === fromSetIndex) return;
      html += '<button onclick="BandPlayer._executeMoveTo(' + fromSetIndex + ',\'' + position + '\',' + songIndex + ',' + si + ')" ' +
        'style="padding:12px 16px;border-radius:8px;border:1px solid rgba(88,166,255,0.2);background:rgba(88,166,255,0.06);color:#58a6ff;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;text-align:left;transition:background 120ms;">' +
        '<i class="fa-solid fa-arrow-right" style="margin-right:8px;"></i>' + self._escHtml(set.label || ('Set ' + (si + 1))) +
        '<span style="color:rgba(255,255,255,0.3);font-weight:400;margin-left:8px;">' + ((set.songs || []).length) + ' songs</span>' +
      '</button>';
    });
    html += '</div>';

    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: 'Move "' + title + '" to...',
        size: 'sm',
        content: html,
        saveText: 'Cancel',
        onSave: function() { Modal.close(); }
      });
    }
  },

  _executeMoveTo: function(fromSetIndex, position, songIndex, toSetIndex) {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : null;
    if (!sets) return;

    var fromSet = sets[fromSetIndex];
    var songId;

    // Remove from source
    if (position === 'intro') {
      songId = fromSet.intro;
      fromSet.intro = null;
    } else if (position === 'outro') {
      songId = fromSet.outro;
      fromSet.outro = null;
    } else {
      songId = (fromSet.songs || [])[songIndex];
      if (fromSet.songs) fromSet.songs.splice(songIndex, 1);
    }

    // Add to destination set's songs array
    if (songId && sets[toSetIndex]) {
      sets[toSetIndex].songs.push(songId);
    }

    this._editDirty = true;
    this._rebuildFlatFromSets();
    if (typeof Modal !== 'undefined') Modal.close();
    this.renderTrackList();
  },

  _rebuildFlatFromSets: function() {
    var sets = this._currentPlaylist ? this._currentPlaylist.sets : [];
    var playOrder = this._flattenSets(sets);
    var songMap = this._allSongsMap;
    this._playOrder = [];
    this._songs = [];
    var self = this;
    playOrder.forEach(function(entry) {
      var song = songMap[entry.songId];
      if (song) {
        self._songs.push(song);
        self._playOrder.push(entry);
      }
    });
  },

  // ── Stem Separation (band_manager / admin only) ───────

  /**
   * Write a stem-request to Firestore. The home server picks it up within seconds.
   * Works from anywhere — no direct LAN connection required.
   */
  requestStems: function(songId) {
    var self = this;
    if (!this._db) { if (typeof Toast !== 'undefined') Toast.error('Not connected'); return; }

    var song = this._allSongsMap[songId];
    if (!song) { if (typeof Toast !== 'undefined') Toast.error('Song not found'); return; }
    if (!song.audioPath) { if (typeof Toast !== 'undefined') Toast.error('Song has no audio file yet'); return; }

    var existing = this._stemStatuses[songId];
    if (existing && existing.status === 'processing') {
      if (typeof Toast !== 'undefined') Toast.info('Stem separation already in progress');
      return;
    }
    if (existing && existing.status === 'complete') {
      if (typeof Toast !== 'undefined') Toast.info('Stems already generated for this song');
      return;
    }

    var uid = (typeof Auth !== 'undefined' && Auth._user) ? Auth._user.uid : 'band_manager';
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'unknown';

    this._db.collection('stem-requests').doc(songId).set({
      status: 'pending',
      songId: songId,
      audioPath: song.audioPath,
      title: song.title || '',
      requestedBy: uid,
      requestedByRole: role,
      requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function() {
      self._stemStatuses[songId] = { status: 'queued' };
      self.renderTrackList();
      if (typeof Toast !== 'undefined') Toast.success('Stem request sent — processing will begin shortly');
      self._pollStemStatus(songId);
    }).catch(function(e) {
      console.error('[BandPlayer] Failed to write stem-request:', e);
      if (typeof Toast !== 'undefined') Toast.error('Failed to send stem request');
    });
  },

  /**
   * Poll a stem-request doc every 10s until complete or error.
   */
  _pollStemStatus: function(songId) {
    var self = this;
    var maxAttempts = 60; // 10 minutes max
    var attempts = 0;

    var timer = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) { clearInterval(timer); return; }

      self._db.collection('stem-requests').doc(songId).get().then(function(doc) {
        if (!doc.exists) { clearInterval(timer); return; }
        var data = doc.data();
        self._stemStatuses[songId] = {
          status: data.status,
          projectId: data.projectId,
          stems: data.stems,
          progress: data.progress,
          error: data.error
        };
        self.renderTrackList();

        if (data.status === 'complete' || data.status === 'error') {
          clearInterval(timer);
          if (data.status === 'complete' && typeof Toast !== 'undefined') {
            Toast.success('Stems ready for: ' + (data.title || songId));
          }
          if (data.status === 'error' && typeof Toast !== 'undefined') {
            Toast.error('Stem separation failed: ' + (data.error || 'unknown error'));
          }
        }
      }).catch(function() { /* ignore transient errors */ });
    }, 10000);
  },

  /**
   * Get a display label for stem status on a song.
   */
  _stemStatusLabel: function(songId) {
    var s = this._stemStatuses[songId];
    if (!s) return null;
    var map = {
      pending: { icon: 'fa-clock', color: 'rgba(255,255,255,0.4)', label: 'Queued' },
      processing: { icon: 'fa-spinner fa-spin', color: '#58a6ff', label: 'Requesting...' },
      queued: { icon: 'fa-hourglass-half', color: '#d4a017', label: 'In queue' },
      separating: { icon: 'fa-waveform-lines fa-spin', color: '#58a6ff', label: 'Separating...' },
      complete: { icon: 'fa-check-circle', color: '#3fb950', label: 'Stems ready' },
      error: { icon: 'fa-circle-exclamation', color: '#f85149', label: 'Failed' }
    };
    return map[s.status] || null;
  },

  // ── Upload (band_manager / admin only) ────────────────

  showUploadSong: function() {
    if (typeof Modal === 'undefined') return;
    Modal.open({
      title: 'Upload Song to Inventory',
      size: 'md',
      content:
        '<div style="display:flex;flex-direction:column;gap:14px;">' +
          '<div><label class="form-label">Song Title *</label><input id="bp-u-title" class="form-input" placeholder="e.g. No One Can Love You More" /></div>' +
          '<div><label class="form-label">Artist</label><input id="bp-u-artist" class="form-input" value="L.A. Young" /></div>' +
          '<div><label class="form-label">Audio File (MP3) *</label><input id="bp-u-audio" type="file" accept=".mp3,audio/mpeg" class="form-input" /></div>' +
          '<div><label class="form-label">Lyrics (optional)</label><textarea id="bp-u-lyrics" class="form-input" rows="4" placeholder="Paste lyrics here..."></textarea></div>' +
          '<details style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;">' +
            '<summary style="cursor:pointer;font-weight:600;font-size:14px;color:rgba(255,255,255,0.7);">' +
              '<i class="fa-solid fa-file-pdf" style="margin-right:6px;color:#f0883e;"></i>Instrument Charts (optional)</summary>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">' +
              '<div><label class="form-label">Drums</label><input id="bp-u-chart-drums" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Guitar</label><input id="bp-u-chart-guitar" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Keys</label><input id="bp-u-chart-keys" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Bass</label><input id="bp-u-chart-bass" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Vocals</label><input id="bp-u-chart-vocals" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
              '<div><label class="form-label">Saxophone</label><input id="bp-u-chart-saxophone" type="file" accept=".pdf,.png,.jpg,.jpeg" class="form-input" /></div>' +
            '</div>' +
          '</details>' +
          '<div id="bp-u-progress" style="display:none;">' +
            '<div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:6px;">Uploading...</div>' +
            '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;">' +
              '<div id="bp-u-progress-bar" style="height:100%;width:0%;background:#d4a017;border-radius:3px;transition:width 200ms;"></div>' +
            '</div>' +
          '</div>' +
        '</div>',
      saveText: 'Upload to Inventory',
      onSave: function() { return BandPlayer._handleUploadSong(); }
    });
    setTimeout(function() { var el = document.getElementById('bp-u-title'); if (el) el.focus(); }, 100);
  },

  _handleUploadSong: function() {
    var title = (document.getElementById('bp-u-title') || {}).value || '';
    var artist = (document.getElementById('bp-u-artist') || {}).value || 'L.A. Young';
    var audioInput = document.getElementById('bp-u-audio');
    var lyrics = (document.getElementById('bp-u-lyrics') || {}).value || '';

    if (!title.trim()) { Toast.error('Song title is required'); return Promise.resolve(); }
    if (!audioInput || !audioInput.files || !audioInput.files[0]) { Toast.error('Please select an MP3 file'); return Promise.resolve(); }

    var audioFile = audioInput.files[0];
    var songId = 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    var audioPath = 'band-media/audio/' + songId + '.mp3';

    // Collect chart files
    var chartFiles = {};
    ['drums', 'guitar', 'keys', 'bass', 'vocals', 'saxophone'].forEach(function(inst) {
      var input = document.getElementById('bp-u-chart-' + inst);
      if (input && input.files && input.files[0]) {
        chartFiles[inst] = input.files[0];
      }
    });

    var progDiv = document.getElementById('bp-u-progress');
    var progBar = document.getElementById('bp-u-progress-bar');
    if (progDiv) progDiv.style.display = '';

    var self = this;
    var storage = this._storage;

    if (!storage) {
      Toast.error('Storage not available — try refreshing');
      return Promise.resolve();
    }

    // Return a Promise so Modal stays open during upload
    return new Promise(function(resolve) {
      var audioRef = storage.ref(audioPath);
      var uploadTask = audioRef.put(audioFile);

      uploadTask.on('state_changed',
        function(snapshot) {
          var pct = (snapshot.bytesTransferred / snapshot.totalBytes * 70);
          if (progBar) progBar.style.width = pct + '%';
        },
        function(error) {
          Toast.error('Audio upload failed: ' + error.code + ' — ' + error.message);
          if (progDiv) progDiv.style.display = 'none';
          resolve();
        },
        function() {
          if (progBar) progBar.style.width = '70%';

          var chartPaths = {};
          var chartKeys = Object.keys(chartFiles);
          var chartPromises = chartKeys.map(function(inst, i) {
            var chartPath = 'band-media/charts/' + songId + '/' + inst + '.' + chartFiles[inst].name.split('.').pop();
            chartPaths[inst] = chartPath;
            return storage.ref(chartPath).put(chartFiles[inst]).then(function() {
              if (progBar) progBar.style.width = (70 + ((i + 1) / chartKeys.length * 20)) + '%';
            });
          });

          Promise.all(chartPromises).then(function() {
            if (progBar) progBar.style.width = '90%';

            var songData = {
              title: title,
              artist: artist,
              audioPath: audioPath,
              lyrics: lyrics || null,
              charts: Object.keys(chartPaths).length > 0 ? chartPaths : null,
              duration: null,
              createdBy: (typeof Auth !== 'undefined' && Auth._user) ? Auth._user.uid : 'pin',
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            self._db.collection('songs').doc(songId).set(songData).then(function() {
              if (progBar) progBar.style.width = '100%';
              Modal.close();
              var savedSong = Object.assign({ id: songId }, songData);
              self._allSongsMap[songId] = savedSong;
              self._inventory.push(savedSong);
              Toast.success('Song uploaded to inventory: ' + title);
              resolve();
            }).catch(function(e) {
              Toast.error('Song save failed: ' + e.code + ' — ' + e.message);
              if (progDiv) progDiv.style.display = 'none';
              resolve();
            });
          }).catch(function(e) {
            Toast.error('Chart upload failed: ' + e.message);
            if (progDiv) progDiv.style.display = 'none';
            resolve();
          });
        }
      );
    });
  },

  showCreatePlaylist: function() {
    if (typeof Modal === 'undefined') return;

    // Pre-load gigs for the "Link to Gig" dropdown
    var self = this;
    var gigsHtml = '<option value="">None</option>';
    var gigsReady = false;

    if (this._db) {
      this._db.collection('gigs').where('status', '==', 'upcoming').orderBy('date', 'asc').get()
        .then(function(snap) {
          snap.forEach(function(doc) {
            var g = doc.data();
            var dateStr = g.date && g.date.toDate ? g.date.toDate().toLocaleDateString() : '';
            gigsHtml += '<option value="' + doc.id + '">' + (g.title || 'Gig') + (dateStr ? ' (' + dateStr + ')' : '') + '</option>';
          });
          var sel = document.getElementById('bp-pl-gig');
          if (sel) sel.innerHTML = gigsHtml;
        }).catch(function() {});
    }

    Modal.open({
      title: 'Create Playlist',
      size: 'sm',
      content:
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
          '<div><label class="form-label">Playlist Name *</label><input id="bp-pl-name" class="form-input" placeholder="e.g. Friday Night Set" /></div>' +
          '<div><label class="form-label">Description</label><input id="bp-pl-desc" class="form-input" placeholder="e.g. Blues Alley show — 90 min set" /></div>' +
          '<div><label class="form-label">Link to Gig</label><select id="bp-pl-gig" class="form-input">' + gigsHtml + '</select></div>' +
          '<div><label class="form-label">Album Art</label>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<div id="bp-pl-art-preview" style="width:60px;height:60px;border-radius:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">' +
                '<i class="fa-solid fa-image" style="color:rgba(255,255,255,0.2);font-size:20px;"></i></div>' +
              '<div style="flex:1;display:flex;flex-direction:column;gap:6px;">' +
                '<input id="bp-pl-art-url" class="form-input" placeholder="Paste image URL" style="font-size:12px;" />' +
                '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;border:1px dashed rgba(255,255,255,0.15);cursor:pointer;font-size:12px;color:rgba(255,255,255,0.4);">' +
                  '<i class="fa-solid fa-upload"></i> or upload' +
                  '<input type="file" id="bp-pl-art-file" accept="image/*" style="display:none;" />' +
                '</label>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>',
      saveText: 'Create',
      onSave: function() {
        var name = (document.getElementById('bp-pl-name') || {}).value || '';
        var desc = (document.getElementById('bp-pl-desc') || {}).value || '';
        var artUrl = (document.getElementById('bp-pl-art-url') || {}).value || '';
        if (!name.trim()) { Toast.error('Playlist name is required'); return; }

        var gigId = (document.getElementById('bp-pl-gig') || {}).value || '';

        function createPlaylist(albumArt) {
          var plData = {
            name: name,
            description: desc,
            albumArt: albumArt || '',
            sets: [{ label: 'Set 1', intro: null, songs: [], outro: null }],
            songOrder: [],
            gigId: gigId || null,
            createdBy: (typeof Auth !== 'undefined' && Auth._user) ? Auth._user.uid : 'pin',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          BandPlayer._db.collection('playlists').add(plData).then(function(ref) {
            // If linked to a gig, update the gig's playlistId
            if (gigId && BandPlayer._db) {
              BandPlayer._db.collection('gigs').doc(gigId).update({ playlistId: ref.id }).catch(function() {});
            }
            Modal.close();
            Toast.success('Playlist created: ' + name);
            plData.id = ref.id;
            BandPlayer._playlists.unshift(plData);
            BandPlayer.renderPlaylistDropdown();
            BandPlayer.selectPlaylist(ref.id);
          }).catch(function(e) {
            Toast.error('Failed to create playlist: ' + e.message);
          });
        }

        // If a file was selected, upload to Firebase Storage first
        var fileInput = document.getElementById('bp-pl-art-file');
        if (fileInput && fileInput.files && fileInput.files[0]) {
          var file = fileInput.files[0];
          var path = 'band-media/album-art/' + Date.now() + '-' + file.name;
          var ref = firebase.storage().ref(path);
          Toast.info('Uploading album art...');
          ref.put(file).then(function(snap) {
            return snap.ref.getDownloadURL();
          }).then(function(url) {
            createPlaylist(url);
          }).catch(function(e) {
            Toast.error('Art upload failed: ' + e.message);
          });
        } else {
          createPlaylist(artUrl);
        }
      }
    });
    setTimeout(function() {
      var el = document.getElementById('bp-pl-name');
      if (el) el.focus();
      // Art preview handlers
      var artUrl = document.getElementById('bp-pl-art-url');
      var artFile = document.getElementById('bp-pl-art-file');
      var artPreview = document.getElementById('bp-pl-art-preview');
      if (artUrl) {
        artUrl.addEventListener('input', function() {
          if (this.value) artPreview.innerHTML = '<img src="' + BandPlayer._escHtml(this.value) + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.innerHTML=\'<i class=\\\'fa-solid fa-image\\\' style=\\\'color:rgba(255,255,255,0.2);font-size:20px;\\\'></i>\'" />';
          else artPreview.innerHTML = '<i class="fa-solid fa-image" style="color:rgba(255,255,255,0.2);font-size:20px;"></i>';
        });
      }
      if (artFile) {
        artFile.addEventListener('change', function() {
          if (this.files && this.files[0]) {
            var reader = new FileReader();
            reader.onload = function(e) {
              artPreview.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;" />';
              if (artUrl) artUrl.value = '';
            };
            reader.readAsDataURL(this.files[0]);
          }
        });
      }
    }, 100);
  },

  // ── Album Art Management ─────────────────────────────

  showSetAlbumArt: function() {
    if (!this._currentPlaylist || typeof Modal === 'undefined') return;
    var self = this;
    var current = this._currentPlaylist.albumArt || '';
    Modal.open({
      title: 'Set Album Art',
      size: 'sm',
      content:
        '<div style="display:flex;flex-direction:column;gap:12px;align-items:center;">' +
          '<div id="bp-art-edit-preview" style="width:120px;height:120px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;overflow:hidden;">' +
            (current ? '<img src="' + this._escHtml(current) + '" style="width:100%;height:100%;object-fit:cover;" />' : '<i class="fa-solid fa-image" style="color:rgba(255,255,255,0.2);font-size:32px;"></i>') +
          '</div>' +
          '<input id="bp-art-edit-url" class="form-input" placeholder="Paste image URL" value="' + this._escHtml(current) + '" style="width:100%;font-size:13px;" />' +
          '<label style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:6px;border:1px dashed rgba(255,255,255,0.15);cursor:pointer;font-size:13px;color:rgba(255,255,255,0.4);">' +
            '<i class="fa-solid fa-upload"></i> Upload image' +
            '<input type="file" id="bp-art-edit-file" accept="image/*" style="display:none;" />' +
          '</label>' +
          (current ? '<button onclick="document.getElementById(\'bp-art-edit-url\').value=\'\';document.getElementById(\'bp-art-edit-preview\').innerHTML=\'<i class=\\\'fa-solid fa-image\\\' style=\\\'color:rgba(255,255,255,0.2);font-size:32px;\\\'></i>\'" style="background:none;border:none;color:rgba(248,81,73,0.7);font-size:12px;cursor:pointer;">Remove art</button>' : '') +
        '</div>',
      saveText: 'Save',
      onSave: function() {
        var url = (document.getElementById('bp-art-edit-url') || {}).value || '';
        var fileInput = document.getElementById('bp-art-edit-file');

        function saveArt(artUrl) {
          self._db.collection('playlists').doc(self._currentPlaylist.id).update({
            albumArt: artUrl,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(function() {
            self._currentPlaylist.albumArt = artUrl;
            Modal.close();
            Toast.success('Album art updated');
            self.renderTrackList();
          }).catch(function(e) { Toast.error('Failed: ' + e.message); });
        }

        if (fileInput && fileInput.files && fileInput.files[0]) {
          var file = fileInput.files[0];
          var path = 'band-media/album-art/' + Date.now() + '-' + file.name;
          Toast.info('Uploading...');
          firebase.storage().ref(path).put(file).then(function(snap) {
            return snap.ref.getDownloadURL();
          }).then(function(dlUrl) { saveArt(dlUrl); })
          .catch(function(e) { Toast.error('Upload failed: ' + e.message); });
        } else {
          saveArt(url);
        }
      }
    });
    setTimeout(function() {
      var urlInput = document.getElementById('bp-art-edit-url');
      var fileInput = document.getElementById('bp-art-edit-file');
      var preview = document.getElementById('bp-art-edit-preview');
      if (urlInput) {
        urlInput.addEventListener('input', function() {
          if (this.value) preview.innerHTML = '<img src="' + BandPlayer._escHtml(this.value) + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.innerHTML=\'<i class=\\\'fa-solid fa-image\\\' style=\\\'color:rgba(255,255,255,0.2);font-size:32px;\\\'></i>\'" />';
          else preview.innerHTML = '<i class="fa-solid fa-image" style="color:rgba(255,255,255,0.2);font-size:32px;"></i>';
        });
      }
      if (fileInput) {
        fileInput.addEventListener('change', function() {
          if (this.files && this.files[0]) {
            var reader = new FileReader();
            reader.onload = function(e) {
              preview.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;" />';
              if (urlInput) urlInput.value = '';
            };
            reader.readAsDataURL(this.files[0]);
          }
        });
      }
    }, 100);
  },

  // ── Inventory & Add to Playlist ──────────────────────

  showInventory: function() {
    if (typeof Modal === 'undefined') return;
    var self = this;
    var songs = this._inventory;

    if (songs.length === 0) {
      Modal.open({
        title: 'Song Inventory',
        size: 'md',
        content: '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);">' +
          '<i class="fa-solid fa-box-open" style="font-size:32px;display:block;margin-bottom:10px;"></i>' +
          'No songs uploaded yet. Use "Upload Song" to add to inventory.</div>',
        saveText: 'Close',
        onSave: function() { Modal.close(); }
      });
      return;
    }

    var html = '<div style="max-height:60vh;overflow-y:auto;">';
    songs.forEach(function(song) {
      var hasLyrics = !!(song.lyrics);
      var hasCharts = !!(song.charts && Object.keys(song.charts).length > 0);
      var chartList = hasCharts ? Object.keys(song.charts).join(', ') : '';

      html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
        '<div style="width:36px;height:36px;border-radius:8px;background:rgba(212,160,23,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<i class="fa-solid fa-music" style="color:#d4a017;font-size:14px;"></i></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:14px;font-weight:600;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escHtml(self._titleCase(song.title)) + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">' + self._escHtml(song.artist || 'Unknown') +
            (hasLyrics ? ' · <i class="fa-solid fa-align-left"></i> lyrics' : '') +
            (hasCharts ? ' · <i class="fa-solid fa-file-pdf"></i> ' + chartList : '') +
          '</div>' +
        '</div>' +
        '<button onclick="BandPlayer.deleteSongFromInventory(\'' + song.id + '\')" title="Delete from inventory" ' +
          'style="width:32px;height:32px;border-radius:6px;border:1px solid rgba(248,81,73,0.15);background:rgba(248,81,73,0.06);color:rgba(248,81,73,0.6);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">' +
          '<i class="fa-solid fa-trash"></i></button>' +
      '</div>';
    });
    html += '</div>';

    Modal.open({
      title: 'Song Inventory (' + songs.length + ')',
      size: 'md',
      content: html,
      saveText: 'Close',
      onSave: function() { Modal.close(); }
    });
  },

  deleteSongFromInventory: function(songId) {
    var self = this;
    var song = this._allSongsMap[songId];
    if (!song) return;

    if (typeof Modal !== 'undefined') {
      Modal.open({
        title: 'Delete Song',
        size: 'sm',
        content: '<p style="color:#e6edf3;font-size:15px;">Permanently delete <strong>' + this._escHtml(song.title) + '</strong>?</p>' +
          '<p style="color:rgba(255,255,255,0.45);font-size:13px;margin-top:8px;">This removes the song record and its files from storage. It will be removed from all playlists.</p>',
        saveText: 'Delete',
        onSave: function() {
          // Delete Firestore doc
          self._db.collection('songs').doc(songId).delete().then(function() {
            // Remove from local state
            self._inventory = self._inventory.filter(function(s) { return s.id !== songId; });
            delete self._allSongsMap[songId];
            // Remove from current playlist songs if present
            self._songs = self._songs.filter(function(s) { return s.id !== songId; });
            Modal.close();
            Toast.success('Song deleted');
            // Clean up storage files in background (best-effort)
            if (song.audioPath && self._storage) {
              self._storage.ref(song.audioPath).delete().catch(function() {});
            }
            if (song.charts && self._storage) {
              Object.keys(song.charts).forEach(function(inst) {
                self._storage.ref(song.charts[inst]).delete().catch(function() {});
              });
            }
            self.renderTrackList();
          }).catch(function(e) {
            Toast.error('Failed to delete: ' + e.message);
          });
        }
      });
    }
  },

  showAddFromInventory: function() {
    if (typeof Modal === 'undefined') return;
    if (!this._currentPlaylist) {
      Toast.info('Select or create a playlist first');
      return;
    }

    var self = this;
    var currentIds = this._allSongIdsFromSets(this._currentPlaylist.sets || []);

    // Filter to songs not already in this playlist
    var available = this._inventory.filter(function(song) {
      return currentIds.indexOf(song.id) === -1;
    });

    if (available.length === 0) {
      Modal.open({
        title: 'Add to Playlist',
        size: 'sm',
        content: '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);">' +
          (this._inventory.length === 0
            ? '<i class="fa-solid fa-box-open" style="font-size:28px;display:block;margin-bottom:8px;"></i>No songs in inventory. Upload songs first.'
            : '<i class="fa-solid fa-check-circle" style="font-size:28px;display:block;margin-bottom:8px;color:#3fb950;"></i>All inventory songs are already in this playlist.') +
          '</div>',
        saveText: 'Close',
        onSave: function() { Modal.close(); }
      });
      return;
    }

    var html = '<div style="max-height:60vh;overflow-y:auto;">';
    available.forEach(function(song) {
      var hasLyrics = !!(song.lyrics);
      var hasCharts = !!(song.charts && Object.keys(song.charts).length > 0);

      html += '<div style="display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
        '<div style="width:36px;height:36px;border-radius:8px;background:rgba(212,160,23,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          '<i class="fa-solid fa-music" style="color:#d4a017;font-size:14px;"></i></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:14px;font-weight:600;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escHtml(self._titleCase(song.title)) + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">' + self._escHtml(song.artist || 'Unknown') +
            (hasLyrics ? ' · lyrics' : '') +
            (hasCharts ? ' · charts' : '') +
          '</div>' +
        '</div>' +
        '<button onclick="BandPlayer._addSongToPlaylist(\'' + song.id + '\', this)" ' +
          'style="padding:6px 14px;border-radius:6px;border:1px solid rgba(63,185,80,0.25);background:rgba(63,185,80,0.1);color:#3fb950;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;white-space:nowrap;">' +
          '<i class="fa-solid fa-plus" style="margin-right:4px;"></i>Add</button>' +
      '</div>';
    });
    html += '</div>';

    Modal.open({
      title: 'Add to: ' + this._escHtml(this._currentPlaylist.name),
      size: 'md',
      content: html,
      saveText: 'Done',
      onSave: function() { Modal.close(); }
    });
  },

  _addSongToPlaylist: function(songId, btnEl) {
    var self = this;
    if (!this._currentPlaylist) return;

    // Ensure sets exist
    this._migratePlaylistToSets(this._currentPlaylist);
    var sets = this._currentPlaylist.sets;

    // Check if already in any set
    var allIds = this._allSongIdsFromSets(sets);
    if (allIds.indexOf(songId) !== -1) return;

    // Add to last set's songs array
    var lastSet = sets[sets.length - 1];
    lastSet.songs.push(songId);
    var flatOrder = this._setsToSongOrder(sets);

    // Disable button immediately
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = '<i class="fa-solid fa-check"></i> Added';
      btnEl.style.color = 'rgba(255,255,255,0.35)';
      btnEl.style.borderColor = 'rgba(255,255,255,0.08)';
      btnEl.style.background = 'rgba(255,255,255,0.03)';
      btnEl.style.cursor = 'default';
    }

    this._db.collection('playlists').doc(this._currentPlaylist.id).update({
      sets: sets,
      songOrder: flatOrder,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function() {
      self._currentPlaylist.songOrder = flatOrder;
      var song = self._allSongsMap[songId];
      if (song) {
        self._songs.push(song);
        self._playOrder.push({ songId: songId, setIndex: sets.length - 1, position: 'song' });
      }
      self.renderTrackList();
    }).catch(function(e) {
      // Revert on failure
      lastSet.songs.pop();
      if (typeof Toast !== 'undefined') Toast.error('Failed to add song: ' + e.message);
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:4px;"></i>Add';
        btnEl.style.color = '#3fb950';
        btnEl.style.borderColor = 'rgba(63,185,80,0.25)';
        btnEl.style.background = 'rgba(63,185,80,0.1)';
        btnEl.style.cursor = 'pointer';
      }
    });
  },

  // ── Rendering ─────────────────────────────────────────

  renderPlaylistDropdown: function() {
    var el = document.getElementById('bp-playlist-select');
    if (!el) return;
    if (this._playlists.length === 0) {
      el.innerHTML = '<option value="">No playlists — create one above</option>';
      return;
    }
    el.innerHTML = this._playlists.map(function(pl) {
      return '<option value="' + pl.id + '">' + BandPlayer._escHtml(BandPlayer._titleCase(pl.name)) + '</option>';
    }).join('');
  },

  renderTrackList: function() {
    var el = document.getElementById('bp-tracklist');
    if (!el) return;

    // Update playlist description
    var plHeader = document.getElementById('bp-playlist-header');
    var plDescEl = document.getElementById('bp-playlist-header-desc');
    if (plHeader && this._currentPlaylist) {
      var desc = this._currentPlaylist.description || '';
      if (desc) { plHeader.style.display = ''; if (plDescEl) plDescEl.textContent = desc; }
      else { plHeader.style.display = 'none'; }
    } else if (plHeader) { plHeader.style.display = 'none'; }

    var sets = (this._currentPlaylist && this._currentPlaylist.sets) || [];
    var totalSongsInSets = this._allSongIdsFromSets(sets).length;

    if (this._songs.length === 0 && totalSongsInSets === 0) {
      el.innerHTML = '<div style="padding:30px;text-align:center;color:rgba(255,255,255,0.35);font-size:15px;">' +
        '<i class="fa-solid fa-music" style="font-size:28px;display:block;margin-bottom:10px;color:rgba(255,255,255,0.15);"></i>' +
        (this._currentPlaylist ? 'No songs in this playlist yet.' : 'Select or create a playlist to get started.') +
        '</div>';
      return;
    }

    var self = this;
    var plArt = (this._currentPlaylist && this._currentPlaylist.albumArt) || '';
    var artThumb = plArt
      ? '<div class="bp-track-art"><img src="' + this._escHtml(plArt) + '" alt="" style="width:100%;height:100%;object-fit:cover;" /></div>'
      : '<div class="bp-track-art"><img src="images/logo/gbe-square.svg" alt="GBE" style="width:100%;height:100%;object-fit:cover;" /></div>';
    var multiSet = sets.length > 1;

    if (this._editMode) {
      // ── EDIT MODE: per-set sections ──
      var editHtml = '<div class="bp-edit-banner">' +
        '<span><i class="fa-solid fa-layer-group" style="margin-right:6px;"></i>Set Arrangement</span>' +
        '<span style="color:rgba(255,255,255,0.4);font-weight:400;">' + sets.length + ' set' + (sets.length !== 1 ? 's' : '') + ' · ' + this._songs.length + ' song' + (this._songs.length !== 1 ? 's' : '') + '</span>' +
        '</div>';

      sets.forEach(function(set, si) {
        var isFirstSet = (si === 0);
        var isLastSet = (si === sets.length - 1);

        // Set header
        editHtml += '<div class="bp-set-divider">' +
          '<span class="bp-set-label">' + self._escHtml(set.label || ('Set ' + (si + 1))) + '</span>' +
          '<div class="bp-set-actions">' +
            '<button class="bp-edit-btn" onclick="BandPlayer.moveSet(' + si + ',-1)" title="Move set up"' +
              (isFirstSet ? ' disabled style="opacity:0.2;cursor:default;"' : '') + '>' +
              '<i class="fa-solid fa-chevron-up"></i></button>' +
            '<button class="bp-edit-btn" onclick="BandPlayer.moveSet(' + si + ',1)" title="Move set down"' +
              (isLastSet ? ' disabled style="opacity:0.2;cursor:default;"' : '') + '>' +
              '<i class="fa-solid fa-chevron-down"></i></button>' +
            '<button class="bp-edit-btn bp-edit-btn-danger" onclick="BandPlayer.removeSet(' + si + ')" title="Remove set">' +
              '<i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>';

        // Intro slot
        var introSong = set.intro ? self._allSongsMap[set.intro] : null;
        if (introSong) {
          editHtml += '<div class="bp-track bp-slot-row" style="cursor:default;">' +
            '<div class="bp-track-num"><span class="bp-slot-badge bp-slot-intro">IN</span></div>' +
            artThumb +
            '<div class="bp-track-info">' +
              '<div class="bp-track-title">' + self._escHtml(self._titleCase(introSong.title)) + '</div>' +
              '<div class="bp-track-artist">' + self._escHtml(introSong.artist || 'Unknown') + '</div>' +
            '</div>' +
            '<div class="bp-track-edit-actions" onclick="event.stopPropagation()">' +
              (multiSet ? '<button class="bp-edit-btn" onclick="BandPlayer.moveToSet(' + si + ',\'intro\',0)" title="Move to set" style="color:#58a6ff;border-color:rgba(88,166,255,0.2);"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>' : '') +
              '<button class="bp-edit-btn bp-edit-btn-danger" onclick="BandPlayer.clearIntro(' + si + ')" title="Clear intro"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
          '</div>';
        } else {
          editHtml += '<div class="bp-slot-empty" onclick="BandPlayer.assignIntro(' + si + ')">' +
            '<i class="fa-solid fa-arrow-right-to-bracket" style="margin-right:6px;"></i>Tap to assign intro' +
          '</div>';
        }

        // Songs
        (set.songs || []).forEach(function(songId, songIdx) {
          var song = self._allSongsMap[songId];
          if (!song) return;
          var isFirstSong = (songIdx === 0);
          var isLastSong = (songIdx === (set.songs || []).length - 1);
          var stemInfo = self._stemStatusLabel(song.id);
          var stemBtn = song.audioPath
            ? (stemInfo
              ? '<button class="bp-edit-btn" onclick="BandPlayer.requestStems(\'' + song.id + '\')" title="Stems: ' + stemInfo.label + '" style="color:' + stemInfo.color + ';border-color:' + stemInfo.color.replace(')', ',0.25)').replace('rgb', 'rgba') + ';">' +
                  '<i class="fa-solid ' + stemInfo.icon + '"></i></button>'
              : '<button class="bp-edit-btn" onclick="BandPlayer.requestStems(\'' + song.id + '\')" title="Separate stems">' +
                  '<i class="fa-solid fa-code-branch"></i></button>')
            : '';

          editHtml += '<div class="bp-track" style="cursor:default;">' +
            '<div class="bp-track-num"><span style="color:rgba(255,255,255,0.3);font-size:12px;">' + (songIdx + 1) + '</span></div>' +
            artThumb +
            '<div class="bp-track-info">' +
              '<div class="bp-track-title">' + self._escHtml(self._titleCase(song.title)) + '</div>' +
              '<div class="bp-track-artist">' + self._escHtml(song.artist || 'Unknown') + '</div>' +
            '</div>' +
            '<div class="bp-track-edit-actions" onclick="event.stopPropagation()">' +
              stemBtn +
              (multiSet ? '<button class="bp-edit-btn" onclick="BandPlayer.moveToSet(' + si + ',\'song\',' + songIdx + ')" title="Move to set" style="color:#58a6ff;border-color:rgba(88,166,255,0.2);"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>' : '') +
              '<button class="bp-edit-btn" onclick="BandPlayer.moveSong(' + si + ',\'song\',' + songIdx + ',-1)" title="Move up"' +
                (isFirstSong ? ' disabled style="opacity:0.2;cursor:default;"' : '') + '>' +
                '<i class="fa-solid fa-chevron-up"></i></button>' +
              '<button class="bp-edit-btn" onclick="BandPlayer.moveSong(' + si + ',\'song\',' + songIdx + ',1)" title="Move down"' +
                (isLastSong ? ' disabled style="opacity:0.2;cursor:default;"' : '') + '>' +
                '<i class="fa-solid fa-chevron-down"></i></button>' +
              '<button class="bp-edit-btn bp-edit-btn-danger" onclick="BandPlayer.removeSong(' + si + ',\'song\',' + songIdx + ')" title="Remove">' +
                '<i class="fa-solid fa-trash"></i></button>' +
            '</div>' +
          '</div>';
        });

        // Outro slot
        var outroSong = set.outro ? self._allSongsMap[set.outro] : null;
        if (outroSong) {
          editHtml += '<div class="bp-track bp-slot-row" style="cursor:default;">' +
            '<div class="bp-track-num"><span class="bp-slot-badge bp-slot-outro">OUT</span></div>' +
            artThumb +
            '<div class="bp-track-info">' +
              '<div class="bp-track-title">' + self._escHtml(self._titleCase(outroSong.title)) + '</div>' +
              '<div class="bp-track-artist">' + self._escHtml(outroSong.artist || 'Unknown') + '</div>' +
            '</div>' +
            '<div class="bp-track-edit-actions" onclick="event.stopPropagation()">' +
              (multiSet ? '<button class="bp-edit-btn" onclick="BandPlayer.moveToSet(' + si + ',\'outro\',0)" title="Move to set" style="color:#58a6ff;border-color:rgba(88,166,255,0.2);"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>' : '') +
              '<button class="bp-edit-btn bp-edit-btn-danger" onclick="BandPlayer.clearOutro(' + si + ')" title="Clear outro"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
          '</div>';
        } else {
          editHtml += '<div class="bp-slot-empty" onclick="BandPlayer.assignOutro(' + si + ')">' +
            '<i class="fa-solid fa-arrow-right-from-bracket" style="margin-right:6px;"></i>Tap to assign outro' +
          '</div>';
        }
      });

      // Add Set button at bottom of edit mode
      editHtml += '<div style="padding:16px 24px;text-align:center;">' +
        '<button onclick="BandPlayer.addSet()" style="padding:10px 24px;border-radius:8px;border:1px dashed rgba(212,160,23,0.3);background:rgba(212,160,23,0.06);color:#d4a017;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;width:100%;transition:background 120ms;">' +
          '<i class="fa-solid fa-plus" style="margin-right:8px;"></i>Add Set' +
        '</button>' +
      '</div>';

      el.innerHTML = editHtml;
      return;
    }

    // ── LISTEN MODE: track list with set dividers ──
    var completedCount = 0;
    for (var c = 0; c < this._songs.length; c++) {
      if (this._completedTracks[this._songs[c].id]) completedCount++;
    }
    var html = '';
    if (this._songs.length > 0 && completedCount > 0) {
      html += '<div style="padding:8px 16px;font-size:12px;color:rgba(255,255,255,0.5);display:flex;justify-content:space-between;align-items:center;">'
        + '<span><i class="fa-solid fa-check-circle" style="color:#3fb950;margin-right:4px;"></i>' + completedCount + ' of ' + this._songs.length + ' tracks practiced</span>'
        + '<span style="color:#3fb950;font-weight:600;">' + Math.round(completedCount / this._songs.length * 100) + '%</span>'
        + '</div>';
    }

    var trackNum = 0;
    var lastSetIndex = -1;
    this._songs.forEach(function(song, i) {
      var po = self._playOrder[i];
      var isActive = (i === self._currentIndex);
      var hasLyrics = !!(song.lyrics);
      var hasCharts = !!(song.charts && Object.keys(song.charts).length > 0);
      var cached = self.isCached(song.id);
      var duration = song.duration ? self._formatTime(song.duration) : '';
      var practiced = self._completedTracks[song.id];

      // Set divider (only for multi-set playlists)
      if (multiSet && po && po.setIndex !== lastSetIndex) {
        var setLabel = sets[po.setIndex] ? (sets[po.setIndex].label || ('Set ' + (po.setIndex + 1))) : '';
        html += '<div class="bp-set-divider-listen"><span>' + self._escHtml(setLabel) + '</span></div>';
        lastSetIndex = po.setIndex;
      }

      trackNum++;
      var positionBadge = '';
      if (po && po.position === 'intro') positionBadge = '<span class="bp-slot-badge bp-slot-intro" style="margin-left:6px;">Intro</span>';
      else if (po && po.position === 'outro') positionBadge = '<span class="bp-slot-badge bp-slot-outro" style="margin-left:6px;">Outro</span>';

      html += '<div class="bp-track' + (isActive ? ' bp-track-active' : '') + '" onclick="BandPlayer.play(' + i + ')">' +
        '<div class="bp-track-num">' +
          (isActive && self._isPlaying
            ? '<div class="bp-eq"><span></span><span></span><span></span><span></span></div>'
            : practiced
              ? '<i class="fa-solid fa-check-circle" style="color:#3fb950;font-size:14px;" title="Practiced"></i>'
              : '<span>' + trackNum + '</span>') +
        '</div>' +
        artThumb +
        '<div class="bp-track-info">' +
          '<div class="bp-track-title">' + BandPlayer._escHtml(BandPlayer._titleCase(song.title)) + positionBadge +
            (cached ? ' <i class="fa-solid fa-cloud-arrow-down" style="font-size:10px;color:#3fb950;margin-left:4px;" title="Saved offline"></i>' : '') +
          '</div>' +
          '<div class="bp-track-artist">' + BandPlayer._escHtml(song.artist || 'Unknown') + '</div>' +
        '</div>' +
        (duration ? '<span class="bp-track-duration">' + duration + '</span>' : '') +
        '<div class="bp-track-actions" onclick="event.stopPropagation()">' +
          '<button class="bp-action-btn" onclick="BandPlayer.showLyrics(\'' + song.id + '\')" title="Lyrics"><i class="fa-solid fa-align-left"></i></button>' +
          '<button class="bp-action-btn" onclick="BandPlayer.showChart(\'' + song.id + '\')" title="' + (hasCharts ? 'View Charts' : 'Chart') + '"' + (hasCharts ? ' style="color:#d4a017;border-color:rgba(212,160,23,0.25);"' : '') + '><i class="fa-solid fa-music"></i></button>' +
          '<button class="bp-action-btn" onclick="BandPlayer.showTrackNotes(\'' + song.id + '\')" title="Notes / Flag"><i class="fa-solid fa-comment-dots"></i></button>' +
          (song.audioPath ? '<button class="bp-action-btn" onclick="BandPlayer.downloadTrack(\'' + song.id + '\')" title="Download"><i class="fa-solid fa-download"></i></button>' : '') +
          (cached
            ? '<button class="bp-action-btn" onclick="BandPlayer.removeOffline(\'' + song.id + '\')" title="Remove offline" style="color:#3fb950;border-color:rgba(63,185,80,0.2);"><i class="fa-solid fa-cloud-arrow-down"></i></button>'
            : '<button class="bp-action-btn" onclick="BandPlayer.saveOffline(\'' + song.id + '\')" title="Save offline"><i class="fa-regular fa-cloud-arrow-down"></i></button>') +
        '</div>' +
      '</div>';

      if (isActive) {
        html += '<div class="bp-progress-row">' +
          '<span id="bp-prog-current" style="min-width:32px;">0:00</span>' +
          '<div class="bp-prog-bar" onclick="event.stopPropagation();BandPlayer.seek(event.offsetX/this.offsetWidth)">' +
            '<div class="bp-prog-fill" id="bp-prog-fill"></div>' +
          '</div>' +
          '<span id="bp-prog-total" style="min-width:32px;text-align:right;">' + (duration || '0:00') + '</span>' +
        '</div>';
      }
    });

    el.innerHTML = html;
  },

  updateNowPlaying: function() {
    var playBtn = document.getElementById('bp-play-icon');
    if (playBtn) playBtn.className = 'fa-solid ' + (this._isPlaying ? 'fa-pause' : 'fa-play');
  },

  _renderEmptyState: function() {
    var el = document.getElementById('bp-tracklist');
    var role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'member';
    var isManager = (role === 'admin' || role === 'band_manager');
    if (el) {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.35);">' +
        '<i class="fa-solid fa-headphones" style="font-size:36px;display:block;margin-bottom:12px;color:rgba(255,255,255,0.12);"></i>' +
        '<div style="font-size:16px;font-weight:600;margin-bottom:6px;">No Playlists Yet</div>' +
        (isManager
          ? '<div style="font-size:14px;">Create a playlist and start adding songs.</div>'
          : '<div style="font-size:14px;">Your band manager hasn\'t set up any playlists yet.</div>') +
        '</div>';
    }
  },

  // ── Offline Cache ────────────────────────────────────

  _loadCacheIndex: function() {
    try {
      var raw = localStorage.getItem('bp-cache-index');
      this._cacheIndex = raw ? JSON.parse(raw) : {};
    } catch (e) {
      this._cacheIndex = {};
    }
  },

  _saveCacheIndex: function() {
    try {
      localStorage.setItem('bp-cache-index', JSON.stringify(this._cacheIndex));
    } catch (e) {
      console.warn('[BandPlayer] Could not save cache index');
    }
  },

  isCached: function(songId) {
    return !!(this._cacheIndex && this._cacheIndex[songId]);
  },

  _getCachedAudioUrl: function(songId) {
    if (!('caches' in window) || !this.isCached(songId)) {
      return Promise.resolve(null);
    }
    return caches.open(this._cacheName).then(function(cache) {
      return cache.match('audio/' + songId);
    }).then(function(response) {
      if (!response) return null;
      return response.blob().then(function(blob) {
        return URL.createObjectURL(blob);
      });
    }).catch(function() {
      return null;
    });
  },

  downloadTrack: function(songId) {
    var song = this._allSongsMap[songId];
    if (!song || !song.audioPath) return;
    var self = this;

    // Check download policy on playlist
    if (this._currentPlaylist && this._currentPlaylist.downloadPolicy === 'disabled') {
      if (typeof Toast !== 'undefined') Toast.info('Downloads are disabled for this playlist.');
      return;
    }

    // Get the download URL from Firebase Storage
    if (this._storage) {
      this._storage.ref(song.audioPath).getDownloadURL().then(function(url) {
        var a = document.createElement('a');
        a.href = url;
        a.download = (song.title || 'track') + '.mp3';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (typeof Toast !== 'undefined') Toast.success('Downloading ' + self._titleCase(song.title));
      }).catch(function(err) {
        if (typeof Toast !== 'undefined') Toast.error('Download failed: ' + err.message);
      });
    }
  },

  saveOffline: function(songId) {
    if (!('caches' in window)) {
      Toast.info('Offline storage not supported on this browser');
      return;
    }
    var song = this._allSongsMap[songId];
    if (!song || !song.audioPath) return;
    if (this.isCached(songId)) {
      Toast.info(song.title + ' is already saved offline');
      return;
    }

    // Lazy re-acquire storage if it wasn't available at init time
    if (!this._storage && typeof Auth !== 'undefined' && Auth.getStorage) {
      this._storage = Auth.getStorage();
    }
    if (!this._storage) {
      Toast.error('Storage not available — sign in and try again');
      return;
    }

    var self = this;

    // Evict oldest if at limit
    var ids = Object.keys(this._cacheIndex);
    if (ids.length >= this._cacheMaxSongs) {
      // Find oldest by savedAt
      var oldest = ids.sort(function(a, b) {
        return (self._cacheIndex[a].savedAt || 0) - (self._cacheIndex[b].savedAt || 0);
      })[0];
      var oldTitle = self._cacheIndex[oldest].title || 'Unknown';
      self._removeCachedSong(oldest).then(function() {
        console.log('[BandPlayer] Evicted oldest cached song: ' + oldTitle);
        self._doSaveOffline(song);
      });
    } else {
      this._doSaveOffline(song);
    }
  },

  _doSaveOffline: function(song) {
    var self = this;
    Toast.info('Saving "' + song.title + '" for offline...');

    // Get download URL then fetch the blob
    // audioPath is always a relative storage path — use ref(), not refFromURL()
    var ref = this._storage.ref(song.audioPath);
    ref.getDownloadURL().then(function(url) {
      return fetch(url);
    }).then(function(response) {
      if (!response.ok) throw new Error('Download failed');
      return caches.open(self._cacheName).then(function(cache) {
        return cache.put('audio/' + song.id, response);
      });
    }).then(function() {
      self._cacheIndex[song.id] = {
        title: song.title,
        savedAt: Date.now()
      };
      self._saveCacheIndex();
      self.renderTrackList();
      Toast.success('"' + song.title + '" saved offline');
    }).catch(function(e) {
      console.error('[BandPlayer] Offline save failed:', e);
      Toast.error('Could not save offline: ' + e.message);
    });
  },

  removeOffline: function(songId) {
    var self = this;
    var song = this._allSongsMap[songId];
    var title = song ? song.title : 'song';
    this._removeCachedSong(songId).then(function() {
      self.renderTrackList();
      Toast.success('"' + title + '" removed from offline');
    });
  },

  _removeCachedSong: function(songId) {
    var self = this;
    delete this._cacheIndex[songId];
    this._saveCacheIndex();
    if (!('caches' in window)) return Promise.resolve();
    return caches.open(this._cacheName).then(function(cache) {
      return cache.delete('audio/' + songId);
    }).catch(function() {});
  },

  getCacheCount: function() {
    return this._cacheIndex ? Object.keys(this._cacheIndex).length : 0;
  },

  // ── Helpers ───────────────────────────────────────────

  _formatTime: function(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  },

  _escHtml: function(str) {
    var d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  _titleCase: function(str) {
    if (!str) return '';
    return str.replace(/\b\w+/g, function(w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }
};

// CommonJS export fallback
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BandPlayer;
}
