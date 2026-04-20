/* ============================================
   bp2-integration.js — Mixer + Practice Wiring Glue
   Band Player v2.0

   Wires mixer, transport, and practice together.
   Engage/Disengage lifecycle. iOS AudioContext handling.

   WHO CALLS IT:
     - bp2-render-stems.js mounts after stem panel renders
   ============================================ */
(function(global) {
  'use strict';

  var STEM_LABELS = {
    vocals: 'Vocals', drums: 'Drums', bass: 'Bass', other: 'Other',
    guitar: 'Guitar', piano: 'Keys / Piano', instrumental: 'Instrumental'
  };
  var STEM_COLORS = {
    vocals: '#00e676', drums: '#ff1744', bass: '#2979ff', other: '#651fff',
    guitar: '#ff9100', piano: '#d500f9', instrumental: '#78909c'
  };

  var _current = null;

  function _esc(s) { return global.BP2Utils ? global.BP2Utils.esc(s) : String(s || ''); }

  function _renderPanel(host, songId, stems) {
    var panel = document.createElement('div');
    panel.className = 'bp2-mixer';

    // Engage button
    var engageHtml = '<button class="bp2-console-engage" data-role="engage" aria-pressed="false"><span class="bp2-console-engage-led"></span><span>ENGAGE MIXER</span></button>';

    // Channel strips
    var channelsHtml = '<div class="bp2-console-channels" style="display:flex;gap:2px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:16px 12px 12px;justify-content:center;">';
    var names = Object.keys(stems);
    names.forEach(function(name) {
      var label = (STEM_LABELS[name] || name).substring(0, 3).toUpperCase();
      var color = STEM_COLORS[name] || '#8b949e';
      channelsHtml +=
        '<div class="bp2-console-ch" style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:44px;flex:0 0 auto;">' +
          '<div class="bp2-console-ch-label" style="color:' + color + ';font-size:8px;font-weight:900;letter-spacing:0.08em;">' + label + '</div>' +
          '<div class="bp2-console-fader-track">' +
            '<input type="range" class="bp2-console-fader" min="0" max="100" value="80" data-stem="' + _esc(name) + '">' +
            '<div class="bp2-console-fader-bg"></div>' +
          '</div>' +
          '<div style="display:flex;gap:4px;">' +
            '<button class="bp2-console-s" data-stem="' + _esc(name) + '" data-role="solo">S</button>' +
            '<button class="bp2-console-m" data-stem="' + _esc(name) + '" data-role="mute">M</button>' +
          '</div>' +
        '</div>';
    });
    channelsHtml += '</div>';

    // Practice pads
    var practiceHtml =
      '<div class="bp2-practice-module">' +
        '<button class="bp2-practice-pad" data-role="metronome"><i class="fa-solid fa-music"></i><span>120</span><small>BPM</small></button>' +
        '<button class="bp2-practice-pad" data-role="loop"><i class="fa-solid fa-repeat"></i><span>LOOP</span><small>A-B</small></button>' +
        '<button class="bp2-practice-pad" data-role="speed"><i class="fa-solid fa-gauge-high"></i><span>1.0x</span><small>SPEED</small></button>' +
      '</div>';

    panel.innerHTML = engageHtml + channelsHtml;
    host.appendChild(panel);

    var practiceDiv = document.createElement('div');
    practiceDiv.innerHTML = practiceHtml;
    host.appendChild(practiceDiv.firstChild);
  }

  function _wireEvents(host, opts) {
    var songId = opts.songId;
    var userId = opts.userId;

    host.addEventListener('input', function(e) {
      if (!e.target.classList.contains('bp2-console-fader')) return;
      var stem = e.target.getAttribute('data-stem');
      if (global.BP2Mixer) {
        global.BP2Mixer.setFader(songId, stem, e.target.value);
        if (global.BP2Transport) global.BP2Transport.applyMixer(songId);
        // Persist
        if (global.BP2Mixer.storageKey && global.localStorage) {
          try { localStorage.setItem(global.BP2Mixer.storageKey(userId, songId), global.BP2Mixer.serialize(songId)); } catch (ex) {}
        }
      }
    });

    host.addEventListener('click', function(e) {
      var btn = e.target.closest('button');
      if (!btn) return;

      // Engage/disengage
      if (btn.classList.contains('bp2-console-engage')) {
        var isOn = btn.getAttribute('aria-pressed') === 'true';
        var label = btn.querySelector('span:last-child');
        if (!isOn) {
          // Pause main player
          try {
            if (global.BP2Player) {
              var audio = global.BP2Player.getAudio();
              if (audio && !audio.paused) {
                global.BP2Player.pause();
              }
            }
          } catch (ex) {}

          if (global.BP2Transport) {
            var ctx = global.BP2Transport.getAudioContext();
            if (ctx && ctx.state === 'suspended') try { ctx.resume(); } catch (ex) {}

            // Resolve Firebase Storage paths to download URLs before loading
            var stemNames = Object.keys(opts.stems);
            var storage = (global.BP2Core && global.BP2Core.getStorage) ? global.BP2Core.getStorage() : null;

            var resolveUrls;
            if (storage) {
              var urlPromises = stemNames.map(function(name) {
                var path = opts.stems[name];
                // If already a full URL, use directly
                if (path && (path.startsWith('https://') || path.startsWith('http://'))) {
                  return Promise.resolve({ name: name, url: path });
                }
                var ref = (path && path.startsWith('gs://')) ? storage.refFromURL(path) : storage.ref(path);
                return ref.getDownloadURL().then(function(url) {
                  return { name: name, url: url };
                });
              });
              resolveUrls = Promise.all(urlPromises).then(function(results) {
                var resolved = {};
                results.forEach(function(r) { resolved[r.name] = r.url; });
                return resolved;
              });
            } else {
              // No storage available — use paths as-is (fallback)
              resolveUrls = Promise.resolve(opts.stems);
            }

            resolveUrls.then(function(resolvedStems) {
              return global.BP2Transport.load(songId, resolvedStems);
            }).then(function() {
              if (global.BP2Mixer) global.BP2Transport.applyMixer(songId);
              global.BP2Transport.play();
              // Re-query button — original may have been replaced by re-render during load
              var engBtn = host.querySelector('.bp2-console-engage') || document.querySelector('.bp2-console-engage');
              if (engBtn) {
                engBtn.setAttribute('aria-pressed', 'true');
                engBtn.classList.add('is-active');
                var engLabel = engBtn.querySelector('span:last-child');
                if (engLabel) engLabel.textContent = 'DISENGAGE';
              }
            }).catch(function(err) {
              console.error('[BP2Integration] Engage failed:', err);
              if (typeof Toast !== 'undefined') Toast.error('Could not load stems');
            });
          }
        } else {
          try { if (global.BP2Transport) global.BP2Transport.pause(); } catch (ex) {}
          btn.setAttribute('aria-pressed', 'false');
          btn.classList.remove('is-active');
          if (label) label.textContent = 'ENGAGE MIXER';
        }
        return;
      }

      // Solo/Mute
      if (btn.classList.contains('bp2-console-s') || btn.classList.contains('bp2-console-m')) {
        var stem = btn.getAttribute('data-stem');
        var role = btn.getAttribute('data-role');
        if (global.BP2Mixer) {
          if (role === 'solo') global.BP2Mixer.setSolo(songId, stem);
          if (role === 'mute') global.BP2Mixer.setMute(songId, stem);
          // Update DOM
          var state = global.BP2Mixer.getState(songId);
          var solos = host.querySelectorAll('.bp2-console-s');
          var mutes = host.querySelectorAll('.bp2-console-m');
          solos.forEach(function(s) { s.classList.toggle('is-on', !!state.soloed[s.getAttribute('data-stem')]); });
          mutes.forEach(function(m) { m.classList.toggle('is-on', !!state.muted[m.getAttribute('data-stem')]); });
          if (global.BP2Transport) global.BP2Transport.applyMixer(songId);
          if (global.BP2Mixer.storageKey && global.localStorage) {
            try { localStorage.setItem(global.BP2Mixer.storageKey(userId, songId), global.BP2Mixer.serialize(songId)); } catch (ex) {}
          }
        }
        return;
      }

      // Practice pads
      if (btn.classList.contains('bp2-practice-pad')) {
        var prole = btn.getAttribute('data-role');
        if (prole === 'metronome' && global.BP2Practice) {
          if (global.BP2Practice.isMetronomeOn()) {
            global.BP2Practice.metronomeOff();
            btn.classList.remove('is-on');
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
          } else {
            global.BP2Practice.setAudioContextRef(function() {
              return global.BP2Transport ? global.BP2Transport.getAudioContext() : null;
            });
            global.BP2Practice.metronomeOn();
            btn.classList.add('is-on');
            btn.classList.add('is-active');
            btn.setAttribute('aria-pressed', 'true');
          }
        } else if (prole === 'loop' && global.BP2Practice) {
          var enabled = global.BP2Practice.toggleLoopEnabled();
          btn.classList.toggle('is-on', enabled);
          btn.classList.toggle('is-active', enabled);
          btn.setAttribute('aria-pressed', String(enabled));
        } else if (prole === 'speed' && global.BP2Practice) {
          var order = [1.0, 0.85, 0.75];
          var cur = global.BP2Practice.getSpeed();
          var idx = order.indexOf(cur);
          var next = order[(idx + 1) % order.length];
          global.BP2Practice.setSpeed(next);
          if (global.BP2Transport) global.BP2Transport.setPlaybackRate(next);
          btn.classList.toggle('is-on', next !== 1.0);
          var span = btn.querySelector('span');
          if (span) span.textContent = next === 1.0 ? '1.0x' : next + 'x';
        }
      }
    });
  }

  var BP2Integration = {
    mount: function(opts) {
      if (!opts || !opts.host || !opts.songId || !opts.stems) return { panel: null, cleanup: function() {} };
      if (!global.BP2Mixer) return { panel: null, cleanup: function() {} };

      if (_current && _current.cleanup) _current.cleanup();

      var host = opts.host;
      host.innerHTML = '';

      global.BP2Mixer.registerStems(Object.keys(opts.stems));

      // Hydrate saved state
      if (global.BP2Mixer.storageKey && global.localStorage) {
        try {
          var key = global.BP2Mixer.storageKey(opts.userId || null, opts.songId);
          var payload = localStorage.getItem(key);
          if (payload) global.BP2Mixer.hydrate(opts.songId, payload);
        } catch (ex) {}
      }

      _renderPanel(host, opts.songId, opts.stems);
      _wireEvents(host, opts);

      if (global.BP2Transport && global.BP2Transport.applyMixer) {
        try { global.BP2Transport.applyMixer(opts.songId); } catch (ex) {}
      }

      if (global.BP2Practice && opts.barTimings && Array.isArray(opts.barTimings)) {
        try {
          var boundaries = opts.barTimings.map(function(t, i) { return { bar: i + 1, t: t }; });
          if (global.BP2Practice.setBarBoundaries) global.BP2Practice.setBarBoundaries(boundaries);
        } catch (ex) {}
      }

      _current = {
        host: host, songId: opts.songId,
        cleanup: function() {
          try {
            if (global.BP2Practice) global.BP2Practice.metronomeOff();
            if (global.BP2Transport) global.BP2Transport.destroy();
          } catch (ex) {}
          host.innerHTML = '';
          _current = null;
        }
      };
      return _current;
    },

    getCurrent: function() { return _current; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Integration;
  else if (global) global.BP2Integration = BP2Integration;
})(typeof window !== 'undefined' ? window : this);
