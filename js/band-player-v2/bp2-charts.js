/* ============================================
   bp2-charts.js — Chart Viewer, Review, Annotations
   Band Player v2.0

   Chart picker modal with approve/flag. PDF.js viewer.
   Chart re-upload. Annotation CRUD.

   WHO CALLS IT:
     - bp2-render.js "Charts" action button
     - bp2-render-stems.js per-stem chart button
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

  var LABELS = { drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals', guitar: 'Guitar', piano: 'Keys / Piano', instrumental: 'Instrumental' };
  var ICONS = { drums: 'fa-drum', bass: 'fa-guitar', other: 'fa-sliders', vocals: 'fa-microphone', guitar: 'fa-guitar', piano: 'fa-keyboard' };

  var BP2Charts = {
    init: function() {
      var c = _c();
      if (!c) return;
      c.on('tool:charts', function(d) { BP2Charts.showPicker(d.songId); });
    },

    showPicker: function(songId) {
      var c = _c();
      if (!c || !c.getDb()) return;
      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      if (!song) return;

      // Re-fetch from Firestore for latest charts
      c.getDb().collection('songs').doc(songId).get().then(function(doc) {
        var latestSong = doc.exists ? Object.assign({ id: songId }, doc.data()) : song;
        songsMap[songId] = latestSong;

        var charts = (latestSong.charts && Object.keys(latestSong.charts).length > 0) ? latestSong.charts : null;
        if (!charts) {
          if (typeof Toast !== 'undefined') Toast.info('No charts available for this song yet');
          return;
        }

        // Load reviews
        var reviewsPromise = c.getDb().collection('chart-reviews').where('songId', '==', songId).get();
        reviewsPromise.then(function(snap) {
          var reviews = {};
          snap.docs.forEach(function(d) { var data = d.data(); reviews[data.instrument] = data; });
          BP2Charts._renderPicker(latestSong, charts, reviews);
        }).catch(function() {
          BP2Charts._renderPicker(latestSong, charts, {});
        });
      }).catch(function() {
        var charts = (song.charts && Object.keys(song.charts).length > 0) ? song.charts : null;
        if (charts) BP2Charts._renderPicker(song, charts, {});
        else if (typeof Toast !== 'undefined') Toast.info('No charts available');
      });
    },

    _renderPicker: function(song, charts, reviews) {
      var c = _c();
      var isManager = c && c.isManager();
      var songId = song.id;

      var html = '<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0;">';
      Object.keys(charts).forEach(function(key) {
        var label = LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
        var icon = ICONS[key] || 'fa-music';
        var review = reviews[key] || {};
        var status = review.status || 'pending';

        var badge = '';
        if (status === 'approved') badge = '<span style="font-size:11px;background:rgba(63,185,80,0.15);color:#3fb950;padding:2px 8px;border-radius:10px;margin-left:8px;"><i class="fa-solid fa-check" style="margin-right:3px;"></i>Approved</span>';
        else if (status === 'flagged') badge = '<span style="font-size:11px;background:rgba(248,81,73,0.15);color:#f85149;padding:2px 8px;border-radius:10px;margin-left:8px;"><i class="fa-solid fa-flag" style="margin-right:3px;"></i>Flagged</span>';

        html += '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px 14px;">';
        html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">';
        html += '<i class="fa-solid ' + icon + '" style="width:20px;text-align:center;color:rgba(255,255,255,0.4);"></i>';
        html += '<span style="font-size:15px;color:rgba(255,255,255,0.85);flex:1;">' + label + badge + '</span>';
        html += '<button data-action="view-chart" data-path="' + _esc(charts[key]) + '" data-title="' + _esc(song.title + ' \u2014 ' + label) + '" style="background:none;border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:rgba(255,255,255,0.6);padding:4px 10px;cursor:pointer;font-size:12px;">View PDF</button>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button data-action="review-chart" data-song="' + songId + '" data-inst="' + key + '" data-status="approved" style="flex:1;padding:6px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid ' + (status === 'approved' ? 'rgba(63,185,80,0.4);background:rgba(63,185,80,0.15);color:#3fb950;' : 'rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.6);') + '"><i class="fa-solid fa-check" style="margin-right:4px;"></i>' + (status === 'approved' ? 'Approved' : 'Approve') + '</button>';
        html += '<button data-action="review-chart" data-song="' + songId + '" data-inst="' + key + '" data-status="flagged" style="flex:1;padding:6px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid ' + (status === 'flagged' ? 'rgba(248,81,73,0.4);background:rgba(248,81,73,0.15);color:#f85149;' : 'rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.6);') + '"><i class="fa-solid fa-flag" style="margin-right:4px;"></i>' + (status === 'flagged' ? 'Flagged' : 'Flag') + '</button>';
        if (isManager) {
          html += '<button data-action="reupload-chart" data-song="' + songId + '" data-inst="' + key + '" data-path="' + _esc(charts[key]) + '" style="flex:1;padding:6px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid rgba(201,162,39,0.4);background:rgba(201,162,39,0.15);color:#c9a227;"><i class="fa-solid fa-arrow-up-from-bracket" style="margin-right:4px;"></i>Re-upload</button>';
        }
        html += '</div></div>';
      });
      html += '</div>';

      if (typeof Modal !== 'undefined') {
        Modal.open({
          title: '\u266A ' + _tc(song.title),
          size: 'md',
          content: html,
          saveText: '',
          cancelText: 'Close'
        });

        // Wire events via delegation
        setTimeout(function() {
          var modal = document.querySelector('.modal-overlay');
          if (!modal) return;
          modal.addEventListener('click', function(e) {
            var viewBtn = e.target.closest('[data-action="view-chart"]');
            if (viewBtn) {
              BP2Charts.openChartFile(viewBtn.getAttribute('data-path'), viewBtn.getAttribute('data-title'));
              return;
            }
            var reviewBtn = e.target.closest('[data-action="review-chart"]');
            if (reviewBtn) {
              BP2Charts.reviewChart(reviewBtn.getAttribute('data-song'), reviewBtn.getAttribute('data-inst'), reviewBtn.getAttribute('data-status'));
              return;
            }
            var reuploadBtn = e.target.closest('[data-action="reupload-chart"]');
            if (reuploadBtn) {
              BP2Charts.reuploadChart(reuploadBtn.getAttribute('data-song'), reuploadBtn.getAttribute('data-inst'), reuploadBtn.getAttribute('data-path'));
            }
          });
        }, 100);
      }
    },

    openChartFile: function(storagePath, title) {
      var c = _c();
      var storage = c ? c.getStorage() : null;
      if (!storage) return;
      var ref = (storagePath.startsWith('gs://') || storagePath.startsWith('https://'))
        ? storage.refFromURL(storagePath) : storage.ref(storagePath);
      ref.getDownloadURL().then(function(url) {
        window.open(url, '_blank');
      }).catch(function(e) {
        if (typeof Toast !== 'undefined') Toast.error('Could not load chart');
      });
    },

    reviewChart: function(songId, instrument, status) {
      var c = _c();
      if (!c || !c.getDb() || !c.getUser()) return;
      var db = c.getDb();
      var user = c.getUser();
      var docId = songId + '_' + instrument;
      var role = c.getRole();

      db.collection('chart-reviews').doc(docId).get().then(function(doc) {
        var existing = doc.exists ? doc.data() : {};
        var version = existing.version || 1;
        return db.collection('chart-reviews').doc(docId).set({
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
        if (typeof Toast !== 'undefined') Toast.success(instrument + ' chart ' + (status === 'approved' ? 'approved' : 'flagged'));
      }).catch(function(err) {
        if (typeof Toast !== 'undefined') Toast.error('Review failed: ' + err.message);
      });
    },

    reuploadChart: function(songId, instrument, oldPath) {
      var c = _c();
      if (!c || !c.isManager()) return;

      // Create a hidden file input for PDF selection
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', function() {
        var file = input.files && input.files[0];
        document.body.removeChild(input);
        if (!file) return;
        if (file.type !== 'application/pdf') {
          if (typeof Toast !== 'undefined') Toast.error('Please select a PDF file');
          return;
        }

        var storage = c.getStorage();
        var db = c.getDb();
        if (!storage || !db) return;

        // Upload to same path (overwrite)
        var storagePath = oldPath || ('band-media/charts/' + songId + '/' + instrument + '.pdf');
        if (storagePath.startsWith('gs://') || storagePath.startsWith('https://')) {
          // Extract relative path from full URL
          var match = storagePath.match(/\/o\/(.+?)(\?|$)/);
          storagePath = match ? decodeURIComponent(match[1]) : storagePath;
        }

        if (typeof Toast !== 'undefined') Toast.info('Uploading ' + instrument + ' chart...');
        var ref = storage.ref(storagePath);
        ref.put(file, { contentType: 'application/pdf' }).then(function() {
          // Bump chart version in reviews
          var docId = songId + '_' + instrument;
          return db.collection('chart-reviews').doc(docId).get().then(function(doc) {
            var existing = doc.exists ? doc.data() : {};
            var newVersion = (existing.version || 1) + 1;
            return db.collection('chart-reviews').doc(docId).set({
              songId: songId,
              instrument: instrument,
              status: 'pending',
              version: newVersion,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          });
        }).then(function() {
          if (typeof Toast !== 'undefined') Toast.success(instrument + ' chart re-uploaded — pending review');
          // Re-open picker to show updated state
          BP2Charts.showPicker(songId);
        }).catch(function(err) {
          if (typeof Toast !== 'undefined') Toast.error('Upload failed: ' + err.message);
        });
      });

      input.click();
    },

    // Annotation CRUD
    listAnnotations: function(opts) {
      if (!opts || !opts.songId) return Promise.reject(new Error('songId required'));
      var qs = 'songId=' + encodeURIComponent(opts.songId);
      if (opts.chartVersion != null) qs += '&chartVersion=' + encodeURIComponent(opts.chartVersion);
      return fetch('/api/v1/annotations?' + qs, { credentials: 'include', headers: { 'Accept': 'application/json' } })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function(body) { return body.annotations || []; });
    },

    saveAnnotation: function(opts) {
      if (!opts || !opts.songId || !opts.note) return Promise.reject(new Error('songId + note required'));
      return fetch('/api/v1/annotations', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ songId: opts.songId, chartVersion: opts.chartVersion || 1, barNumber: opts.barNumber || null, note: opts.note })
      }).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    },

    deleteAnnotation: function(id) {
      if (!id) return Promise.reject(new Error('id required'));
      return fetch('/api/v1/annotations/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' })
        .then(function(r) { return r.status === 204; });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Charts;
  else if (global) global.BP2Charts = BP2Charts;
})(typeof window !== 'undefined' ? window : this);
