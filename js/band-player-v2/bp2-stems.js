/* ============================================
   bp2-stems.js — Stem Separation & Individual Stem Playback
   Band Player v2.0

   WHAT IT DOES:
     Writes stem-request docs to Firestore. Polls status every 10s.
     Plays individual stems via HTML5 Audio. Manages expanded state.

   WHO CALLS IT:
     - bp2-render.js triggers via events
     - bp2-core.js calls init()
   ============================================ */
(function(global) {
  'use strict';

  var _stemAudio = null;
  var _core = null;

  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  var _initialized = false;

  var BP2Stems = {
    init: function() {
      if (_initialized) return;
      _initialized = true;
      var c = _c();
      if (!c) return;

      c.on('stems:toggle', function(d) {
        var expanded = c.ref('expandedStems');
        var wasExpanded = expanded[d.songId];
        // Collapse all others — only one expanded at a time
        for (var key in expanded) {
          if (expanded.hasOwnProperty(key)) expanded[key] = false;
        }
        // Toggle the clicked one
        expanded[d.songId] = !wasExpanded;
        c.emit('render:tracklist');
      });

      c.on('stems:request', function(d) { BP2Stems.requestStems(d.songId); });
      c.on('stems:play', function(d) { BP2Stems.playStem(d.songId, d.stemName); });
      c.on('stems:stop', function() { BP2Stems.stopStem(); });

      // Check for in-progress stem requests when playlist is selected
      c.on('playlist:selected', function() { BP2Stems.checkPendingRequests(); });
    },

    checkPendingRequests: function() {
      var c = _c();
      if (!c || !c.getDb()) return;
      var songs = c.ref('songs') || [];
      var statuses = c.ref('stemStatuses');

      songs.forEach(function(song) {
        // Skip songs that already have stems
        if (song.stems && Object.keys(song.stems).length > 0) return;
        // Skip songs we're already tracking
        if (statuses[song.id]) return;

        c.getDb().collection('stem-requests').doc(song.id).get().then(function(doc) {
          if (!doc.exists) return;
          var data = doc.data();
          if (data.status === 'complete' || data.status === 'error') return;
          statuses[song.id] = { status: data.status || 'queued' };
          c.emit('render:tracklist');
          BP2Stems._pollStatus(song.id);
        }).catch(function() {});
      });
    },

    requestStems: function(songId) {
      var c = _c();
      if (!c || !c.getDb()) { if (typeof Toast !== 'undefined') Toast.error('Not connected'); return; }

      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      if (!song) { if (typeof Toast !== 'undefined') Toast.error('Song not found'); return; }
      if (!song.audioPath) { if (typeof Toast !== 'undefined') Toast.error('Song has no audio file'); return; }

      var statuses = c.ref('stemStatuses');
      var existing = statuses[songId];
      if (existing && existing.status === 'processing') {
        if (typeof Toast !== 'undefined') Toast.info('Already processing');
        return;
      }
      if (existing && existing.status === 'complete') {
        if (typeof Toast !== 'undefined') Toast.info('Stems already ready');
        return;
      }

      var uid = c.getUser() ? c.getUser().uid : 'band_manager';
      var role = c.getRole();

      // Optimistically mark as processing BEFORE async call — prevents duplicate clicks
      statuses[songId] = { status: 'processing' };
      c.emit('render:tracklist');

      c.getDb().collection('stem-requests').doc(songId).set({
        status: 'pending',
        songId: songId,
        audioPath: song.audioPath,
        title: song.title || '',
        requestedBy: uid,
        requestedByRole: role,
        requestedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function() {
        statuses[songId] = { status: 'queued' };
        c.emit('render:tracklist');
        if (typeof Toast !== 'undefined') Toast.success('Stem request sent — processing will begin shortly');
        BP2Stems._pollStatus(songId);
      }).catch(function(e) {
        console.error('[BP2Stems] Failed:', e);
        delete statuses[songId];
        c.emit('render:tracklist');
        if (typeof Toast !== 'undefined') Toast.error('Failed to send stem request');
      });
    },

    _pollStatus: function(songId) {
      var c = _c();
      if (!c || !c.getDb()) return;
      var attempts = 0;
      var maxAttempts = 60;

      var timer = setInterval(function() {
        attempts++;
        if (attempts > maxAttempts) { clearInterval(timer); return; }

        c.getDb().collection('stem-requests').doc(songId).get().then(function(doc) {
          if (!doc.exists) { clearInterval(timer); return; }
          var data = doc.data();
          var statuses = c.ref('stemStatuses');
          statuses[songId] = {
            status: data.status,
            projectId: data.projectId,
            stems: data.stems,
            progress: data.progress,
            error: data.error
          };

          if (global.BP2Progress && global.BP2Progress.update) {
            try {
              global.BP2Progress.update(songId, {
                status: data.status,
                progress: data.progress,
                humanStage: data.humanStage,
                error: data.error,
                traceId: data.traceId
              });
            } catch (e) { /* don't block poller */ }
          }

          c.emit('render:tracklist');

          if (data.status === 'complete' || data.status === 'error') {
            clearInterval(timer);
            if (data.status === 'complete') {
              // Refresh song data from Firestore
              c.getDb().collection('songs').doc(songId).get().then(function(songDoc) {
                if (songDoc.exists) {
                  var fresh = songDoc.data();
                  var songsMap = c.ref('allSongsMap');
                  if (songsMap[songId]) Object.assign(songsMap[songId], fresh);
                  var songs = c.ref('songs');
                  for (var i = 0; i < songs.length; i++) {
                    if (songs[i] && songs[i].id === songId) { Object.assign(songs[i], fresh); break; }
                  }
                  c.emit('render:tracklist');
                }
              }).catch(function() {});
              if (typeof Toast !== 'undefined') Toast.success('Stems ready: ' + (data.title || songId));
            }
            if (data.status === 'error' && typeof Toast !== 'undefined') {
              Toast.error('Stem separation failed: ' + (data.error || 'unknown'));
            }
          }
        }).catch(function(err) {
          console.warn('[BP2Stems] Poll failed:', err.message);
        });
      }, 10000);
    },

    statusLabel: function(songId) {
      var c = _c();
      if (!c) return null;
      var statuses = c.ref('stemStatuses');
      var s = statuses[songId];
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

    playStem: function(songId, stemName) {
      var c = _c();
      if (!c) return;
      var stemId = songId + '_' + stemName;

      // Toggle off if already playing this stem
      if (c.ref('playingStemId') === stemId && _stemAudio) {
        BP2Stems.stopStem();
        c.emit('render:tracklist');
        return;
      }

      BP2Stems.stopStem();

      // Pause main player
      if (c.ref('isPlaying') && global.BP2Player) {
        global.BP2Player.pause();
      }

      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      if (!song || !song.stems || !song.stems[stemName]) {
        if (typeof Toast !== 'undefined') Toast.error('Stem not available');
        return;
      }

      var storagePath = song.stems[stemName];

      // Issue B (R2 read-path): single-stem preview loads from the PRIVATE R2
      // bucket via the private Worker — same source as the synced mixer path.
      // The catalog stores object keys ("stems/<id>/<stem>.aac"); build the
      // Worker URL via BP2Core.getStemUrl(). Bucket stays private; no R2 key in
      // the browser. A full URL is used directly.
      if (!c.getStemUrl) {
        if (typeof Toast !== 'undefined') Toast.error('Storage not available');
        return;
      }

      if (typeof Toast !== 'undefined') Toast.info('Loading ' + stemName + '...');

      var urlPromise = Promise.resolve(c.getStemUrl(storagePath));

      urlPromise.then(function(url) {
        _stemAudio = new Audio(url);
        c.set('playingStemId', stemId);
        _stemAudio.play().then(function() {
          c.emit('render:tracklist');
        }).catch(function(e) {
          console.error('[BP2Stems] Playback failed:', e);
          if (typeof Toast !== 'undefined') Toast.error('Could not play stem');
          c.set('playingStemId', null);
        });
        _stemAudio.addEventListener('ended', function() {
          c.set('playingStemId', null);
          _stemAudio = null;
          c.emit('render:tracklist');
        });
        // Emit timeupdate for stem progress bar
        _stemAudio.addEventListener('timeupdate', function() {
          c.emit('stem:timeupdate', {
            stemId: stemId,
            currentTime: _stemAudio.currentTime,
            duration: _stemAudio.duration || 0
          });
        });
      }).catch(function(e) {
        console.error('[BP2Stems] URL failed:', e);
        if (typeof Toast !== 'undefined') Toast.error('Could not load stem');
      });
    },

    stopStem: function() {
      if (_stemAudio) {
        _stemAudio.pause();
        _stemAudio = null;
      }
      var c = _c();
      if (c) c.set('playingStemId', null);
    },

    getStemAudio: function() { return _stemAudio; },
    _reset: function() { _initialized = false; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Stems;
  else if (global) global.BP2Stems = BP2Stems;
})(typeof window !== 'undefined' ? window : this);
