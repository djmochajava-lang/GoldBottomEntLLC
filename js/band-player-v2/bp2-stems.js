/* ============================================
   bp2-stems.js — Stem Separation & Individual Stem Playback
   Band Player v2.0

   WHAT IT DOES:
     Writes stem-request docs to Firestore. Polls status every 10s.
     Plays individual stems via HTML5 Audio. Manages expanded state.

   WHO CALLS IT:
     - bp2-render.js triggers via events
     - bp2-core.js calls init()

   READ-SOURCE FLIP (PLANB-3-A, dark this story):
     checkPendingRequests() and _pollStatus() read stem-request status. Both
     now check window.BP2_READ_SOURCE.stem_requests (mirrors bp2-data.js's
     _src() idiom exactly) — default/anything-but-'supabase' => the EXISTING
     Firestore c.getDb().collection('stem-requests').doc(songId).get() path,
     byte-unchanged. When 'supabase', reads the PLANB-2 dual-drive-mirrored
     Supabase stem_requests table by song_id instead (stem-listener.js keeps
     it fresh regardless of which side the client still WRITES through — the
     write call below stays on Firestore, untouched, this story).
   ============================================ */
(function(global) {
  'use strict';

  var _stemAudio = null;
  var _core = null;

  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  // Mirrors bp2-data.js's _src() idiom exactly: undefined/any non-'supabase'
  // value => 'firestore' (safe default, dark this story).
  function _src(table) {
    var cfg = global.BP2_READ_SOURCE;
    return (cfg && cfg[table]) === 'supabase' ? 'supabase' : 'firestore';
  }

  // Supabase read of the mirrored stem_requests row, normalized back to the
  // Firestore doc shape this module already expects: { status, progress,
  // humanStage, error, traceId, projectId, stems, title }. Columns per
  // PLANB-1/2 DDL: song_id, status, progress, human_stage, error_message,
  // trace_id, updated_at (+ project_id/stems if present on the row).
  // maybeSingle(): 0 rows => null (not an error), matching !doc.exists.
  function _sbGetStemRequest(songId) {
    var c = _c();
    var sb = c && c.getSupabase ? c.getSupabase() : null;
    if (!sb || !songId) return Promise.resolve(null);
    return sb.from('stem_requests').select('*').eq('song_id', songId).maybeSingle()
      .then(function(res) {
        if (res.error) return Promise.reject(res.error);
        var row = res.data;
        if (!row) return null;
        return {
          status: row.status,
          progress: row.progress,
          humanStage: row.human_stage,
          error: row.error_message,
          traceId: row.trace_id,
          projectId: row.project_id,
          stems: row.stems,
          title: row.title
        };
      });
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

        var _read = _src('stem_requests') === 'supabase'
          ? _sbGetStemRequest(song.id)
          : c.getDb().collection('stem-requests').doc(song.id).get().then(function(doc) {
              return doc.exists ? Object.assign({}, doc.data()) : null;
            });

        _read.then(function(data) {
          if (!data) return;
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
        requestedAt: Auth._serverTimestamp()
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

        var _poll = _src('stem_requests') === 'supabase'
          ? _sbGetStemRequest(songId)
          : c.getDb().collection('stem-requests').doc(songId).get().then(function(doc) {
              return doc.exists ? Object.assign({}, doc.data()) : null;
            });

        _poll.then(function(data) {
          if (!data) { clearInterval(timer); return; }
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
