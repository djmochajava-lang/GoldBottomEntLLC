/* ============================================
   bp2-notes.js — Track Notes & Flagging
   Band Player v2.0

   WHAT IT DOES:
     Modal for per-user per-track notes. Textarea + flag checkbox.
     Firestore track-notes/{songId}_{uid} persistence.

   WHO CALLS IT:
     - bp2-render.js "Notes" action button
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  function _esc(s) { return global.BP2Utils ? global.BP2Utils.esc(s) : String(s || ''); }
  function _tc(s) { return global.BP2Utils ? global.BP2Utils.titleCase(s) : String(s || ''); }

  var BP2Notes = {
    init: function() {
      var c = _c();
      if (!c) return;
      c.on('tool:notes', function(d) { BP2Notes.show(d.songId); });
    },

    show: function(songId) {
      var c = _c();
      if (!c || !c.getDb() || !c.getUser()) return;

      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      if (!song) return;

      var db = c.getDb();
      var user = c.getUser();
      var noteDocId = songId + '_' + user.uid;

      db.collection('track-notes').doc(noteDocId).get().then(function(doc) {
        var existing = doc.exists ? doc.data() : {};
        var noteText = existing.notes || '';
        var flagged = existing.flagged || false;

        var content =
          '<div style="margin-bottom:12px;">' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:12px;padding:8px;border-radius:6px;">' +
              '<input type="checkbox" id="bp2-tn-flag" ' + (flagged ? 'checked' : '') + ' style="width:20px;height:20px;accent-color:#d29922;" />' +
              '<span style="font-size:14px;"><i class="fa-solid fa-flag" style="color:#d29922;margin-right:4px;"></i> Flag for discussion with band manager</span>' +
            '</label>' +
            '<textarea id="bp2-tn-notes" rows="5" placeholder="Your notes on this track (practice reminders, questions, arrangement ideas...)" ' +
              'style="width:100%;background:var(--color-bg-tertiary,#1a1c22);border:1px solid var(--color-border,#282c36);border-radius:6px;color:var(--color-text,#e8e8e8);padding:10px;font-family:inherit;resize:vertical;font-size:14px;">' +
              _esc(noteText) +
            '</textarea>' +
          '</div>';

        if (typeof Modal !== 'undefined') {
          Modal.open({
            title: 'Notes \u2014 ' + _tc(song.title),
            body: content,
            size: 'md',
            buttons: [
              { label: 'Cancel', class: 'btn-secondary', close: true },
              { label: 'Save Notes', class: 'btn-primary', callback: function() {
                var notes = document.getElementById('bp2-tn-notes').value.trim();
                var flag = document.getElementById('bp2-tn-flag').checked;
                db.collection('track-notes').doc(noteDocId).set({
                  songId: songId,
                  userId: user.uid,
                  userName: user.displayName || user.email || '',
                  songTitle: song.title,
                  notes: notes,
                  flagged: flag,
                  updatedAt: Auth._serverTimestamp()
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
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Notes;
  else if (global) global.BP2Notes = BP2Notes;
})(typeof window !== 'undefined' ? window : this);
