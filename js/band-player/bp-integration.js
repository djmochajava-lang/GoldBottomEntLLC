/* ============================================
   bp-integration.js — Integration glue for band-player.js → FRD-20 modules

   Provides a single entrypoint, BPIntegration.mount({ ... }), that:
     1. Renders the mixer panel (BPMixer-backed) inside a host element
     2. Renders the practice bar with metronome/loop/speed controls
     3. Wires all UI events to BPMixer/BPTransport/BPPractice/BPCharts state
     4. Loads saved mixer state from localStorage (SR-5.7.2)
     5. Persists state on every change
     6. Calls BPTransport.applyMixer() whenever mixer state changes

   Integration path from existing band-player.js (one-line hook):
     var host = document.getElementById('bp-stems-host-' + songId);
     BPIntegration.mount({
       host: host,
       songId: song.id,
       userId: Auth.currentUserId(),
       stems: song.stems,   // { name: url }
       barTimings: null     // optional, for follow-bar
     });

   Backward compatible:
     - If BPMixer / BPTransport aren't loaded, this module gracefully no-ops.
     - The existing legacy stem-play controls are NOT removed by this layer;
       caller chooses which UI renders.
     - Web Audio is opt-in via BPIntegration.startTransport() (requires user
       gesture on iOS Safari).
   ============================================ */
(function(global) {
  'use strict';

  var STEM_LABELS = {
    vocals: 'Vocals',
    drums:  'Drums',
    bass:   'Bass',
    other:  'Other',
    guitar: 'Guitar',
    piano:  'Keys / Piano',
    instrumental: 'Instrumental'
  };

  var STEM_COLORS = {
    vocals: '#27ae60',
    drums:  '#c0392b',
    bass:   '#2980b9',
    other:  '#8e44ad',
    guitar: '#e67e22',
    piano:  '#9b59b6',
    instrumental: '#2c3e50'
  };

  // Module-level state: one mount active at a time (simple, matches SPA)
  var _current = null;

  function _escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _mixerRowHtml(stemName) {
    var label = STEM_LABELS[stemName] || stemName;
    var color = STEM_COLORS[stemName] || '#8b949e';
    return (
      '<div class="bp-mixer-row" data-stem="' + _escape(stemName) + '">' +
        '<div class="bp-mixer-stripe" style="background:' + color + '"></div>' +
        '<div class="bp-mixer-label">' + _escape(label) + '</div>' +
        '<input type="range" class="bp-mixer-fader" min="0" max="100" value="80" ' +
                'aria-label="' + _escape(label) + ' volume"/>' +
        '<button class="bp-mixer-btn" data-role="solo" aria-label="Solo ' + _escape(label) + '">S</button>' +
        '<button class="bp-mixer-btn" data-role="mute" aria-label="Mute ' + _escape(label) + '">M</button>' +
      '</div>'
    );
  }

  function _practiceBarHtml() {
    return (
      '<div class="bp-practice-bar" role="toolbar" aria-label="Practice controls">' +
        '<button class="bp-practice-btn" data-role="metronome" aria-pressed="false">' +
          '<i class="fa-solid fa-music"></i><span>Metronome</span>' +
        '</button>' +
        '<button class="bp-practice-btn" data-role="loop" aria-pressed="false">' +
          '<i class="fa-solid fa-repeat"></i><span>Loop</span>' +
        '</button>' +
        '<button class="bp-practice-btn" data-role="speed" aria-pressed="false">' +
          '<i class="fa-solid fa-gauge-high"></i><span>Speed</span>' +
        '</button>' +
      '</div>'
    );
  }

  function _engageButtonHtml() {
    // FRD-20: explicit Engage toggle to switch from legacy single-track
    // playback to Web Audio stems + mixer. Satisfies iOS Safari user-gesture
    // requirement for AudioContext.
    return (
      '<div class="bp-mixer-engage-row">' +
        '<button class="bp-mixer-engage-btn" data-role="engage" aria-pressed="false">' +
          '<i class="fa-solid fa-sliders" aria-hidden="true"></i>' +
          '<span class="bp-mixer-engage-label">Engage Mixer</span>' +
        '</button>' +
        '<div class="bp-mixer-engage-hint">Click to switch playback to the per-stem mixer.</div>' +
      '</div>'
    );
  }

  function _renderPanel(host, songId, stems) {
    var panel = document.createElement('div');
    panel.className = 'bp-mixer-panel';
    panel.setAttribute('data-song-id', songId);
    var rows = Object.keys(stems).map(_mixerRowHtml).join('');
    panel.innerHTML = _engageButtonHtml() + rows;
    host.appendChild(panel);

    var bar = document.createElement('div');
    bar.innerHTML = _practiceBarHtml();
    host.appendChild(bar.firstChild);
  }

  function _applyStateToDom(host, songId) {
    if (!global.BPMixer) return;
    var state = global.BPMixer.getState(songId);
    var rows = host.querySelectorAll('.bp-mixer-row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var stem = row.getAttribute('data-stem');
      var fader = row.querySelector('.bp-mixer-fader');
      var solo  = row.querySelector('[data-role="solo"]');
      var mute  = row.querySelector('[data-role="mute"]');
      if (fader) fader.value = state.faders[stem] != null ? state.faders[stem] : 80;
      if (solo)  solo.classList.toggle('is-active', !!state.soloed[stem]);
      if (mute)  mute.classList.toggle('is-active', !!state.muted[stem]);
    }
  }

  function _persist(userId, songId) {
    if (!global.BPMixer || !global.localStorage) return;
    try {
      var key = global.BPMixer.storageKey(userId, songId);
      global.localStorage.setItem(key, global.BPMixer.serialize(songId));
    } catch (e) { /* quota exceeded or disabled — best-effort */ }
  }

  function _hydrate(userId, songId) {
    if (!global.BPMixer || !global.localStorage) return false;
    try {
      var key = global.BPMixer.storageKey(userId, songId);
      var payload = global.localStorage.getItem(key);
      if (payload) return global.BPMixer.hydrate(songId, payload);
    } catch (e) { /* ignore */ }
    return false;
  }

  function _wireEvents(host, opts) {
    var songId = opts.songId;
    var userId = opts.userId;

    host.addEventListener('input', function(evt) {
      var t = evt.target;
      if (!t.classList.contains('bp-mixer-fader')) return;
      var stem = t.closest('.bp-mixer-row').getAttribute('data-stem');
      global.BPMixer.setFader(songId, stem, t.value);
      if (global.BPTransport) global.BPTransport.applyMixer(songId);
      _persist(userId, songId);
    });

    host.addEventListener('click', function(evt) {
      var t = evt.target.closest('button');
      if (!t) return;

      // Engage / disengage mixer — this is the iOS user-gesture hook.
      if (t.classList.contains('bp-mixer-engage-btn')) {
        var isOn = t.getAttribute('aria-pressed') === 'true';
        var label = t.querySelector('.bp-mixer-engage-label');
        if (!isOn) {
          // Pause any existing BandPlayer <audio>
          try {
            if (typeof global.BandPlayer !== 'undefined' && global.BandPlayer &&
                global.BandPlayer._audio && !global.BandPlayer._audio.paused) {
              global.BandPlayer._audio.pause();
              if (typeof global.BandPlayer._isPlaying !== 'undefined') {
                global.BandPlayer._isPlaying = false;
                if (global.BandPlayer.updateNowPlaying) global.BandPlayer.updateNowPlaying();
              }
            }
          } catch (e) { /* swallow */ }

          // Load stems into BPTransport and start.
          // CRITICAL: create/resume the AudioContext synchronously inside
          // this click handler so iOS Safari recognises it as a user gesture.
          // The async load+decode chain below may resolve after the gesture
          // window closes (~100ms), so ctx.resume() must happen NOW.
          if (global.BPTransport) {
            var ctx = global.BPTransport.getAudioContext();
            if (ctx && ctx.state === 'suspended') {
              try { ctx.resume(); } catch (e) { /* ignore */ }
            }
            global.BPTransport.load(songId, opts.stems).then(function() {
              global.BPTransport.applyMixer(songId);
              global.BPTransport.play();
              t.setAttribute('aria-pressed', 'true');
              t.classList.add('is-active');
              if (label) label.textContent = 'Disengage Mixer';
            }).catch(function(err) {
              console.warn('[BPIntegration] engage failed:', err && err.message);
              if (typeof global.Toast !== 'undefined' && global.Toast.error) {
                global.Toast.error('Could not load stems — try again');
              }
            });
          }
        } else {
          // Disengage: stop Web Audio, let user resume legacy playback via main button
          try { if (global.BPTransport) global.BPTransport.pause(); } catch (e) { /* ignore */ }
          t.setAttribute('aria-pressed', 'false');
          t.classList.remove('is-active');
          if (label) label.textContent = 'Engage Mixer';
        }
        return;
      }

      // Mixer buttons
      if (t.classList.contains('bp-mixer-btn')) {
        var row = t.closest('.bp-mixer-row');
        var stem = row.getAttribute('data-stem');
        var role = t.getAttribute('data-role');
        if (role === 'solo') global.BPMixer.setSolo(songId, stem);
        if (role === 'mute') global.BPMixer.setMute(songId, stem);
        _applyStateToDom(host, songId);
        if (global.BPTransport) global.BPTransport.applyMixer(songId);
        _persist(userId, songId);
        return;
      }

      // Practice bar buttons
      if (t.classList.contains('bp-practice-btn')) {
        var prole = t.getAttribute('data-role');
        if (prole === 'metronome') {
          if (!global.BPPractice) return;
          if (global.BPPractice.isMetronomeOn()) {
            global.BPPractice.metronomeOff();
            t.classList.remove('is-active');
            t.setAttribute('aria-pressed', 'false');
          } else {
            global.BPPractice.setAudioContextRef(function() {
              return global.BPTransport && global.BPTransport.getAudioContext
                ? global.BPTransport.getAudioContext()
                : null;
            });
            global.BPPractice.metronomeOn();
            t.classList.add('is-active');
            t.setAttribute('aria-pressed', 'true');
          }
        } else if (prole === 'loop') {
          if (!global.BPPractice) return;
          var enabled = global.BPPractice.toggleLoopEnabled();
          t.classList.toggle('is-active', enabled);
          t.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        } else if (prole === 'speed') {
          // Cycle 1.0 → 0.85 → 0.75 → 1.0
          if (!global.BPPractice) return;
          var order = [1.0, 0.85, 0.75];
          var cur = global.BPPractice.getSpeed();
          var idx = order.indexOf(cur);
          var next = order[(idx + 1) % order.length];
          global.BPPractice.setSpeed(next);
          if (global.BPTransport) global.BPTransport.setPlaybackRate(next);
          t.classList.toggle('is-active', next !== 1.0);
          t.setAttribute('aria-pressed', next !== 1.0 ? 'true' : 'false');
          // Show the current speed in the label
          var span = t.querySelector('span');
          if (span) span.textContent = next === 1.0 ? 'Speed' : (next + 'x');
        }
      }
    });
  }

  var BPIntegration = {
    /**
     * Mount the mixer panel + practice bar inside `host`. Wires all events.
     * Idempotent: calling twice replaces the previous mount.
     *
     * @param {object} opts
     * @param {HTMLElement} opts.host      — container to render into (cleared first)
     * @param {string}      opts.songId
     * @param {string}      [opts.userId]  — for scoped persistence
     * @param {object}      opts.stems     — { stemName: audioUrl }
     * @param {Array}       [opts.barTimings] — for follow-bar sync
     * @returns {object} { panel, practiceBar, cleanup }
     */
    mount: function(opts) {
      if (!opts || !opts.host || !opts.songId || !opts.stems) {
        throw new Error('BPIntegration.mount requires { host, songId, stems }');
      }
      if (!global.BPMixer) {
        // Modules not loaded — graceful no-op
        return { panel: null, cleanup: function(){} };
      }

      // Tear down previous mount
      if (_current && _current.cleanup) _current.cleanup();

      var host = opts.host;
      host.innerHTML = '';
      host.classList.add('bp-integration-host');

      // Register stem list for this song
      global.BPMixer.registerStems(Object.keys(opts.stems));

      // Hydrate persisted state (if any)
      _hydrate(opts.userId || null, opts.songId);

      // Render + wire
      _renderPanel(host, opts.songId, opts.stems);
      _applyStateToDom(host, opts.songId);
      _wireEvents(host, opts);

      // Initial mixer apply if transport already has stems loaded
      if (global.BPTransport && global.BPTransport.applyMixer) {
        try { global.BPTransport.applyMixer(opts.songId); } catch (e) { /* ignore */ }
      }

      _current = {
        host: host,
        songId: opts.songId,
        panel: host.querySelector('.bp-mixer-panel'),
        practiceBar: host.querySelector('.bp-practice-bar'),
        cleanup: function() {
          try {
            if (global.BPPractice) global.BPPractice.metronomeOff();
            if (global.BPTransport) global.BPTransport.destroy();
          } catch (e) { /* ignore */ }
          host.innerHTML = '';
          host.classList.remove('bp-integration-host');
          _current = null;
        }
      };

      return _current;
    },

    /**
     * Begin loading audio via BPTransport. Requires a user gesture on iOS
     * (e.g., must be called from a click handler).
     */
    startTransport: function(songId, stems) {
      if (!global.BPTransport) return Promise.reject(new Error('BPTransport not loaded'));
      return global.BPTransport.load(songId, stems).then(function() {
        if (global.BPMixer) global.BPTransport.applyMixer(songId);
      });
    },

    getCurrent: function() { return _current; },

    // Test hooks
    _renderPanel: _renderPanel,
    _escape: _escape,
    _practiceBarHtml: _practiceBarHtml,
    _mixerRowHtml: _mixerRowHtml
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BPIntegration;
  } else if (global) {
    global.BPIntegration = BPIntegration;
  }
})(typeof window !== 'undefined' ? window : this);
