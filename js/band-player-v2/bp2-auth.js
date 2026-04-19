/* ============================================
   bp2-auth.js — Musician Onboarding Gate
   Band Player v2.0

   Two-screen onboarding for band_member/artist roles.
   Screen 1: Confidentiality Agreement
   Screen 2: Payment Setup + Agreement + W-9
   Admin/band_manager skip to player.

   CRITICAL: Agreement text BYTE-IDENTICAL to v1.

   WHO CALLS IT:
     - bp2-core.js init() emits 'auth:show-gate'
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }
  function _esc(s) { return global.BP2Utils ? global.BP2Utils.esc(s) : String(s || ''); }

  // ── Encryption ─────────────────────────────
  var _encKey = null;

  function _fetchEncKey(db) {
    if (_encKey) return Promise.resolve(_encKey);
    if (!db) return Promise.resolve(null);
    return db.collection('config').doc('encryption').get().then(function(doc) {
      if (doc.exists && doc.data().key) {
        var raw = new Uint8Array(doc.data().key.match(/.{1,2}/g).map(function(b) { return parseInt(b, 16); }));
        return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']).then(function(k) {
          _encKey = k;
          return k;
        });
      }
      return null;
    }).catch(function() { return null; });
  }

  function _encrypt(plaintext, key) {
    if (!plaintext || !key) return Promise.resolve('');
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var encoded = new TextEncoder().encode(plaintext);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, key, encoded).then(function(encrypted) {
      var enc = new Uint8Array(encrypted);
      var ct = enc.slice(0, enc.length - 16);
      var tag = enc.slice(enc.length - 16);
      function hex(arr) { return Array.from(arr).map(function(b) { return b.toString(16).padStart(2, '0'); }).join(''); }
      return 'enc:v1:' + hex(iv) + ':' + hex(tag) + ':' + hex(ct);
    });
  }

  // ── Container helper ───────────────────────
  function _getContainer() {
    return document.getElementById('band-player-content') ||
      document.querySelector('.band-player-container') ||
      document.querySelector('#dash-band-player-v2 .bp2-rack') ||
      document.getElementById('bp2-tracklist');
  }

  var BP2Auth = {
    init: function() {
      var c = _c();
      if (!c) return;
      c.on('auth:show-gate', function(d) {
        if (d.screen === 1) BP2Auth.showScreen1();
      });
    },

    showScreen1: function() {
      var container = _getContainer();
      if (!container) return;
      var c = _c();

      // AGREEMENT TEXT — MUST BE BYTE-IDENTICAL TO V1
      container.innerHTML =
        '<div style="max-width:560px;margin:24px auto;padding:16px;">' +
          '<div style="background:var(--color-bg-secondary,#161b22);border:1px solid var(--color-border,#282c36);border-radius:14px;padding:24px;">' +
            '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,160,23,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;"><i class="fa-solid fa-shield-halved" style="font-size:24px;color:#d4a017;"></i></div>' +
            '<h2 style="color:var(--color-text,#e8e8e8);font-size:18px;margin-bottom:8px;text-align:center;">Band Confidentiality &amp; Agreement</h2>' +
            '<p style="color:var(--color-text-secondary,#8b949e);font-size:14px;margin-bottom:16px;text-align:center;line-height:1.6;">Welcome to the L.A. Young Soul Society band portal!</p>' +
            '<p style="color:var(--color-text-secondary,#8b949e);font-size:14px;margin-bottom:12px;text-align:left;line-height:1.6;">Before you can access the original songs, demos, charts, and rehearsal materials, please read and agree:</p>' +
            '<div style="background:var(--color-bg,#0d1117);border:1px solid var(--color-border,#282c36);border-radius:10px;padding:16px;text-align:left;font-size:14px;color:var(--color-text-secondary,#8b949e);line-height:1.8;margin-bottom:16px;max-height:38vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
              '&bull; All original compositions, lyrics, demos, and arrangements by LA Young are the sole property of Gold Bottom Ent LLC.<br><br>' +
              '&bull; Any contributions, harmonies, adaptations, or ideas I add to LA Young\u2019s pre-existing original material become derivative works owned solely by Gold Bottom Ent LLC / LA Young. I will not claim any ownership, co-writing credit, or royalties unless we specifically agree in writing.<br><br>' +
              '&bull; Rehearsal recordings, charts, setlists, and private band materials are for internal use only. I will not share, distribute, copy, or post them publicly without written permission.<br><br>' +
              '&bull; This applies during our working relationship and for 3 years after (or until the material is publicly released).<br><br>' +
              '<em>I understand I am working as a freelance independent contractor for Gold Bottom Ent LLC only.</em>' +
            '</div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--color-text,#e8e8e8);cursor:pointer;justify-content:center;margin-bottom:16px;padding:12px;border-radius:8px;min-height:44px;">' +
              '<input type="checkbox" id="bp2-screen1-cb" style="width:22px;height:22px;accent-color:#d4a017;flex:0 0 22px;">' +
              ' I have read, understand, and agree to the above.' +
            '</label>' +
            '<div style="text-align:center;">' +
              '<button id="bp2-screen1-btn" disabled style="padding:14px 32px;border-radius:12px;background:#d4a017;color:#000;border:none;font-weight:600;font-size:15px;cursor:pointer;opacity:0.4;width:100%;min-height:48px;">Accept &amp; Continue</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      var cb = document.getElementById('bp2-screen1-cb');
      var btn = document.getElementById('bp2-screen1-btn');
      if (cb && btn) {
        cb.addEventListener('change', function() {
          btn.disabled = !cb.checked;
          btn.style.opacity = cb.checked ? '1' : '0.4';
        });
        btn.addEventListener('click', function() {
          if (!cb.checked) return;
          btn.disabled = true;
          btn.textContent = 'Saving...';
          var user = c.getUser();
          var db = c.getDb();
          if (user && db) {
            db.collection('users').doc(user.uid).update({
              confidentialityAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
              roster_tier: 'on_call',
              activity: 'active'
            }).then(function() {
              if (global.BP2Playlist) global.BP2Playlist.grantDefaultPlaylists(user.uid);
              if (typeof Toast !== 'undefined') Toast.success('Welcome to Soul Society!');
              c.initPlayer();
            }).catch(function(err) {
              console.error('[BP2Auth] Screen 1 save failed:', err);
              if (typeof Toast !== 'undefined') Toast.error('Failed to save. Please try again.');
              btn.disabled = false;
              btn.textContent = 'Accept & Continue';
            });
          }
        });
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Auth;
  else if (global) global.BP2Auth = BP2Auth;
})(typeof window !== 'undefined' ? window : this);
