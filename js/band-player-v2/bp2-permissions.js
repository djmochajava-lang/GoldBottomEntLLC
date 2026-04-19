/* ============================================
   bp2-permissions.js — Playlist Permissions Modal
   Band Player v2.0

   Access level, download policy, charts access.
   Saves to Firestore playlist-permissions.

   WHO CALLS IT:
     - bp2-render.js "Permissions" manager button
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  var BP2Permissions = {
    init: function() {},

    show: function() {
      var c = _c();
      if (!c || !c.getDb()) return;
      var pl = c.ref('currentPlaylist');
      if (!pl) return;

      c.getDb().collection('playlist-permissions').doc(pl.id).get().then(function(doc) {
        var perms = doc.exists ? doc.data() : { accessLevel: 'all_band', downloadPolicy: 'allowed', chartsAccess: 'all' };

        var content =
          '<div style="display:flex;flex-direction:column;gap:16px;">' +
            '<div><label style="font-size:13px;display:block;margin-bottom:6px;font-weight:600;">Access Level</label>' +
              '<select id="bp2-perm-level" style="width:100%;padding:8px;background:var(--color-bg-tertiary,#1a1c22);border:1px solid var(--color-border,#282c36);border-radius:6px;color:var(--color-text,#e8e8e8);min-height:44px;">' +
                '<option value="all_band"' + (perms.accessLevel === 'all_band' ? ' selected' : '') + '>All Band Members</option>' +
                '<option value="assigned_only"' + (perms.accessLevel === 'assigned_only' ? ' selected' : '') + '>Assigned Gig Musicians Only</option>' +
                '<option value="custom"' + (perms.accessLevel === 'custom' ? ' selected' : '') + '>Custom</option>' +
              '</select></div>' +
            '<div><label style="font-size:13px;display:block;margin-bottom:6px;font-weight:600;">Download Policy</label>' +
              '<select id="bp2-perm-download" style="width:100%;padding:8px;background:var(--color-bg-tertiary,#1a1c22);border:1px solid var(--color-border,#282c36);border-radius:6px;color:var(--color-text,#e8e8e8);min-height:44px;">' +
                '<option value="allowed"' + (perms.downloadPolicy !== 'disabled' ? ' selected' : '') + '>Allowed</option>' +
                '<option value="disabled"' + (perms.downloadPolicy === 'disabled' ? ' selected' : '') + '>Disabled</option>' +
              '</select></div>' +
            '<div><label style="font-size:13px;display:block;margin-bottom:6px;font-weight:600;">Charts Access</label>' +
              '<select id="bp2-perm-charts" style="width:100%;padding:8px;background:var(--color-bg-tertiary,#1a1c22);border:1px solid var(--color-border,#282c36);border-radius:6px;color:var(--color-text,#e8e8e8);min-height:44px;">' +
                '<option value="all"' + (perms.chartsAccess !== 'instrument_only' ? ' selected' : '') + '>All Charts</option>' +
                '<option value="instrument_only"' + (perms.chartsAccess === 'instrument_only' ? ' selected' : '') + '>Own Instrument Only</option>' +
              '</select></div>' +
          '</div>';

        if (typeof Modal !== 'undefined') {
          Modal.open({
            title: 'Permissions \u2014 ' + (pl.name || 'Playlist'),
            body: content,
            size: 'md',
            buttons: [
              { label: 'Cancel', class: 'btn-secondary', close: true },
              { label: 'Save', class: 'btn-primary', callback: function() {
                var data = {
                  playlistId: pl.id,
                  accessLevel: document.getElementById('bp2-perm-level').value,
                  downloadPolicy: document.getElementById('bp2-perm-download').value,
                  chartsAccess: document.getElementById('bp2-perm-charts').value,
                  updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                c.getDb().collection('playlist-permissions').doc(pl.id).set(data, { merge: true }).then(function() {
                  c.getDb().collection('playlists').doc(pl.id).update({ downloadPolicy: data.downloadPolicy });
                  pl.downloadPolicy = data.downloadPolicy;
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
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Permissions;
  else if (global) global.BP2Permissions = BP2Permissions;
})(typeof window !== 'undefined' ? window : this);
