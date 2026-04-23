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

  // ── Freelance Agreement Text (BYTE-IDENTICAL to agreements.html) ──
  var AGREEMENT_TEXT =
    '\u2022 You are a freelance independent contractor for Gold Bottom Ent LLC only (not an employee). You handle your own taxes and insurance.\n\n' +
    '\u2022 LA Young\u2019s original compositions, lyrics, and demos are her / Gold Bottom Ent LLC\u2019s sole property. Any contributions or arrangements you make to her pre-existing originals are derivative works owned solely by her / the LLC. You will not claim ownership, co-writing credit, or royalties unless we agree in writing.\n\n' +
    '\u2022 Rehearsal materials, charts, and recordings are for band use only \u2014 please don\u2019t share them publicly.\n\n' +
    '\u2022 No extra pay for rehearsals, local travel, or prep unless we note it for a specific gig.\n\n' +
    '\u2022 You\u2019re responsible for your own gear. We\u2019re not liable for loss or damage unless caused by our direct negligence.\n\n' +
    '\u2022 All obligations are with Gold Bottom Ent LLC only \u2014 no personal liability for Jeffery Ponder or LA Young.';

  var AGREEMENT_VERSION = '1.0';
  var W9_THRESHOLD = 600;

  // ── Container helper ───────────────────────
  var _overrideContainer = null;
  function _getContainer() {
    return _overrideContainer ||
      document.getElementById('band-player-content') ||
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
        else if (d.screen === 2) BP2Auth.showScreen2('onboard');
      });
    },

    // Allow external override of container (payment-settings.html uses this)
    setContainer: function(el) { _overrideContainer = el; },

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
              BP2Auth.showScreen2('onboard');
            }).catch(function(err) {
              console.error('[BP2Auth] Screen 1 save failed:', err);
              if (typeof Toast !== 'undefined') Toast.error('Failed to save. Please try again.');
              btn.disabled = false;
              btn.textContent = 'Accept & Continue';
            });
          }
        });
      }
    },

    // ── Screen 2: Payment Setup + Agreement + W-9 ──────
    // mode: 'onboard' (first time, after Screen 1) or 'edit' (from payment-settings page)
    showScreen2: function(mode) {
      var container = _getContainer();
      if (!container) return;
      var c = _c();
      var db = c ? c.getDb() : null;
      var user = c ? c.getUser() : null;
      if (!user || !db) return;

      var isEdit = (mode === 'edit');
      var uid = user.uid;

      // Styles shared by all form inputs
      var inputStyle = 'width:100%;padding:12px;border-radius:8px;border:1px solid var(--color-border,#282c36);background:var(--color-bg,#0d1117);color:var(--color-text,#e8e8e8);font-size:14px;min-height:44px;box-sizing:border-box;';
      var labelStyle = 'display:block;font-size:13px;color:var(--color-text-secondary,#8b949e);margin-bottom:4px;font-weight:500;';
      var sectionStyle = 'margin-bottom:20px;';
      var cardStyle = 'background:var(--color-bg-secondary,#161b22);border:1px solid var(--color-border,#282c36);border-radius:14px;padding:24px;';

      container.innerHTML =
        '<div style="max-width:560px;margin:24px auto;padding:16px;">' +
          '<div style="' + cardStyle + '">' +
            // Header
            '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,160,23,0.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">' +
              '<i class="fa-solid fa-wallet" style="font-size:24px;color:#d4a017;"></i>' +
            '</div>' +
            '<h2 style="color:var(--color-text,#e8e8e8);font-size:18px;margin-bottom:4px;text-align:center;">' +
              (isEdit ? 'Payment Settings' : 'Payment &amp; Agreement Setup') +
            '</h2>' +
            '<p style="color:var(--color-text-secondary,#8b949e);font-size:13px;margin-bottom:24px;text-align:center;line-height:1.5;">' +
              (isEdit ? 'Update your payment information and review your agreement.' : 'Set up how you get paid and review the freelance agreement.') +
            '</p>' +

            // Section 1: Personal Info
            '<div style="' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:12px;"><i class="fa-solid fa-user" style="margin-right:6px;color:#d4a017;"></i> Personal Info</h3>' +
              '<div style="display:grid;gap:12px;">' +
                '<div>' +
                  '<label style="' + labelStyle + '">Legal Full Name</label>' +
                  '<input type="text" id="bp2-s2-name" placeholder="As it appears on your tax documents" style="' + inputStyle + '" />' +
                '</div>' +
                '<div>' +
                  '<label style="' + labelStyle + '">Phone Number</label>' +
                  '<input type="tel" id="bp2-s2-phone" placeholder="(555) 555-5555" style="' + inputStyle + '" />' +
                '</div>' +
                '<div>' +
                  '<label style="' + labelStyle + '">Mailing Address</label>' +
                  '<textarea id="bp2-s2-address" rows="2" placeholder="Street, City, State ZIP" style="' + inputStyle + 'resize:vertical;min-height:60px;"></textarea>' +
                '</div>' +
              '</div>' +
            '</div>' +

            // Section 2: Payment Preference
            '<div style="' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:12px;"><i class="fa-solid fa-credit-card" style="margin-right:6px;color:#d4a017;"></i> Payment Preference</h3>' +
              '<select id="bp2-s2-method" style="' + inputStyle + 'cursor:pointer;">' +
                '<option value="">Select how you want to be paid...</option>' +
                '<option value="check">Check (mailed to address above)</option>' +
                '<option value="zelle">Zelle</option>' +
                '<option value="cashapp">Cash App</option>' +
                '<option value="venmo">Venmo</option>' +
                '<option value="paypal">PayPal</option>' +
                '<option value="direct_deposit">Direct Deposit (ACH)</option>' +
              '</select>' +
              '<div id="bp2-s2-method-detail" style="margin-top:12px;display:none;">' +
                '<label style="' + labelStyle + '" id="bp2-s2-detail-label">Account Details</label>' +
                '<input type="text" id="bp2-s2-detail" placeholder="" style="' + inputStyle + '" />' +
              '</div>' +
            '</div>' +

            // Section 3: Freelance Agreement
            '<div style="' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:12px;"><i class="fa-solid fa-file-signature" style="margin-right:6px;color:#d4a017;"></i> Freelance Musician Agreement <span style="font-size:11px;color:var(--color-text-muted,#6e7681);">(v' + AGREEMENT_VERSION + ')</span></h3>' +
              '<div id="bp2-s2-agreement-box" style="background:var(--color-bg,#0d1117);border:1px solid var(--color-border,#282c36);border-radius:10px;padding:16px;font-size:13px;color:var(--color-text-secondary,#8b949e);line-height:1.8;max-height:30vh;overflow-y:auto;-webkit-overflow-scrolling:touch;white-space:pre-wrap;margin-bottom:12px;"></div>' +
              '<div id="bp2-s2-agreement-status"></div>' +
            '</div>' +

            // Section 4: W-9 (conditional)
            '<div id="bp2-s2-w9-section" style="display:none;' + sectionStyle + '">' +
              '<h3 style="font-size:14px;color:var(--color-text,#e8e8e8);margin-bottom:8px;"><i class="fa-solid fa-file-invoice-dollar" style="margin-right:6px;color:#f0c040;"></i> W-9 Tax Form Required</h3>' +
              '<div style="background:rgba(240,192,64,0.08);border:1px solid rgba(240,192,64,0.25);border-radius:10px;padding:14px;font-size:13px;color:var(--color-text-secondary,#8b949e);line-height:1.6;">' +
                '<p style="margin:0 0 8px;"><strong style="color:#f0c040;">Your payments this year have reached the $' + W9_THRESHOLD + ' IRS reporting threshold.</strong></p>' +
                '<p style="margin:0;">Gold Bottom Ent LLC is required to file a 1099 for payments over $' + W9_THRESHOLD + '. Please submit a completed W-9 form to management. You can download the blank form from <a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" target="_blank" rel="noopener" style="color:#58a6ff;">irs.gov</a>.</p>' +
              '</div>' +
            '</div>' +

            // Save button
            '<div style="text-align:center;margin-top:8px;">' +
              '<button id="bp2-s2-save" disabled style="padding:14px 32px;border-radius:12px;background:#d4a017;color:#000;border:none;font-weight:600;font-size:15px;cursor:pointer;opacity:0.4;width:100%;min-height:48px;">' +
                (isEdit ? 'Save Changes' : 'Complete Setup') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      // Populate agreement text
      var agBox = document.getElementById('bp2-s2-agreement-box');
      if (agBox) agBox.textContent = AGREEMENT_TEXT;

      // Payment method detail toggle
      var methodSel = document.getElementById('bp2-s2-method');
      var detailWrap = document.getElementById('bp2-s2-method-detail');
      var detailLabel = document.getElementById('bp2-s2-detail-label');
      var detailInput = document.getElementById('bp2-s2-detail');

      var detailMap = {
        zelle: { label: 'Zelle Email or Phone', placeholder: 'email@example.com or (555) 555-5555' },
        cashapp: { label: 'Cash App $Cashtag', placeholder: '$YourCashtag' },
        venmo: { label: 'Venmo Username', placeholder: '@YourVenmo' },
        paypal: { label: 'PayPal Email', placeholder: 'email@example.com' },
        direct_deposit: { label: 'Routing & Account Number', placeholder: 'Routing: XXXXXXXXX / Account: XXXXXXXXXX' }
      };

      if (methodSel) {
        methodSel.addEventListener('change', function() {
          var info = detailMap[methodSel.value];
          if (info) {
            detailLabel.textContent = info.label;
            detailInput.placeholder = info.placeholder;
            detailWrap.style.display = '';
          } else {
            detailWrap.style.display = 'none';
            detailInput.value = '';
          }
          _validateScreen2();
        });
      }

      // Agreement checkbox or already-signed indicator
      var agStatus = document.getElementById('bp2-s2-agreement-status');
      var _agreementAccepted = false;

      db.collection('users').doc(uid).get().then(function(doc) {
        var data = doc.exists ? doc.data() : {};

        // Prefill personal info
        var nameEl = document.getElementById('bp2-s2-name');
        var phoneEl = document.getElementById('bp2-s2-phone');
        var addrEl = document.getElementById('bp2-s2-address');
        if (nameEl && data.legalName) nameEl.value = data.legalName;
        else if (nameEl && data.displayName) nameEl.value = data.displayName;
        if (phoneEl && data.phone) phoneEl.value = data.phone;
        if (addrEl && data.mailingAddress) addrEl.value = data.mailingAddress;

        // Prefill payment method
        if (methodSel && data.paymentMethod) {
          methodSel.value = data.paymentMethod;
          methodSel.dispatchEvent(new Event('change'));
        }

        // Agreement status
        if (data.houseBandAgreedAt || data.freelanceAgreementAcceptedAt) {
          _agreementAccepted = true;
          var agreedDate = '';
          var ts = data.houseBandAgreedAt || data.freelanceAgreementAcceptedAt;
          if (ts && ts.toDate) agreedDate = ts.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          agStatus.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:8px;background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.25);">' +
              '<i class="fa-solid fa-circle-check" style="color:#3fb950;font-size:16px;"></i>' +
              '<span style="font-size:13px;color:#3fb950;">Agreement accepted' + (agreedDate ? ' on ' + agreedDate : '') + '</span>' +
            '</div>';
        } else {
          agStatus.innerHTML =
            '<label style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--color-text,#e8e8e8);cursor:pointer;padding:12px;border-radius:8px;min-height:44px;">' +
              '<input type="checkbox" id="bp2-s2-agree-cb" style="width:22px;height:22px;accent-color:#d4a017;flex:0 0 22px;">' +
              ' I have read and agree to the Freelance Musician Agreement above.' +
            '</label>';
          var agreeCb = document.getElementById('bp2-s2-agree-cb');
          if (agreeCb) {
            agreeCb.addEventListener('change', function() {
              _agreementAccepted = agreeCb.checked;
              _validateScreen2();
            });
          }
        }

        // W-9 check — query YTD payments
        db.collection('payments').where('musicianId', '==', uid).get().then(function(snap) {
          var ytd = 0;
          var currentYear = new Date().getFullYear();
          snap.forEach(function(pdoc) {
            var pd = pdoc.data();
            var amount = parseFloat(pd.amount) || 0;
            var payDate = pd.paymentDate && pd.paymentDate.toDate ? pd.paymentDate.toDate() : new Date(pd.paymentDate);
            if (payDate.getFullYear() === currentYear) ytd += amount;
          });
          if (ytd >= W9_THRESHOLD) {
            var w9Section = document.getElementById('bp2-s2-w9-section');
            if (w9Section) w9Section.style.display = '';
          }
        }).catch(function() {});

        _validateScreen2();
      }).catch(function(err) {
        console.error('[BP2Auth] Screen 2 prefill failed:', err);
      });

      // Validation
      function _validateScreen2() {
        var nameVal = document.getElementById('bp2-s2-name');
        var methodVal = document.getElementById('bp2-s2-method');
        var saveBtn = document.getElementById('bp2-s2-save');
        if (!saveBtn) return;

        var valid = !!(nameVal && nameVal.value.trim()) &&
                    !!(methodVal && methodVal.value) &&
                    _agreementAccepted;

        // If method needs detail, require it
        var info = detailMap[methodVal ? methodVal.value : ''];
        if (info) {
          var detVal = document.getElementById('bp2-s2-detail');
          valid = valid && !!(detVal && detVal.value.trim());
        }

        saveBtn.disabled = !valid;
        saveBtn.style.opacity = valid ? '1' : '0.4';
      }

      // Wire up live validation on all inputs
      ['bp2-s2-name', 'bp2-s2-phone', 'bp2-s2-address', 'bp2-s2-detail'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', _validateScreen2);
      });

      // Save handler
      var saveBtn = document.getElementById('bp2-s2-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', function() {
          if (saveBtn.disabled) return;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';

          var nameVal = (document.getElementById('bp2-s2-name').value || '').trim();
          var phoneVal = (document.getElementById('bp2-s2-phone').value || '').trim();
          var addrVal = (document.getElementById('bp2-s2-address').value || '').trim();
          var methodVal = document.getElementById('bp2-s2-method').value;
          var detailVal = (document.getElementById('bp2-s2-detail').value || '').trim();

          var paymentInfo = methodVal;
          if (detailVal) paymentInfo += ':' + detailVal;

          // Encrypt sensitive fields then save
          _fetchEncKey(db).then(function(key) {
            return Promise.all([
              _encrypt(phoneVal, key),
              _encrypt(addrVal, key),
              _encrypt(paymentInfo, key)
            ]);
          }).then(function(encrypted) {
            var update = {
              legalName: nameVal,
              phone_enc: encrypted[0] || phoneVal,
              mailingAddress_enc: encrypted[1] || addrVal,
              payment_method_enc: encrypted[2] || paymentInfo,
              paymentMethod: methodVal,
              paymentSetupAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            // Only set agreement timestamp if not already set
            var agreeCb = document.getElementById('bp2-s2-agree-cb');
            if (agreeCb && agreeCb.checked) {
              update.houseBandAgreedAt = firebase.firestore.FieldValue.serverTimestamp();
              update.houseBandAgreedVersion = AGREEMENT_VERSION;
              update.freelanceAgreementAcceptedAt = firebase.firestore.FieldValue.serverTimestamp();
            }

            return db.collection('users').doc(uid).update(update);
          }).then(function() {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'Save Changes' : 'Complete Setup';
            if (typeof Toast !== 'undefined') Toast.success(isEdit ? 'Payment settings saved!' : 'Setup complete \u2014 welcome to the band!');
            if (!isEdit && c) {
              c.initPlayer();
            }
          }).catch(function(err) {
            console.error('[BP2Auth] Screen 2 save failed:', err);
            if (typeof Toast !== 'undefined') Toast.error('Failed to save. Please try again.');
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'Save Changes' : 'Complete Setup';
          });
        });
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Auth;
  else if (global) global.BP2Auth = BP2Auth;
})(typeof window !== 'undefined' ? window : this);
