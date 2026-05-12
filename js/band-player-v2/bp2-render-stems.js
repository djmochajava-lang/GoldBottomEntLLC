/* ============================================
   bp2-render-stems.js — Stem Panel, Mixer Console, Practice Pads
   Band Player v2.0

   Renders stem expansion: channel rows with LEDs and level meters,
   stem progress bars, mixer console, practice pads.

   WHO CALLS IT:
     - bp2-render.js after tracklist render
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }
  function _esc(s) { return global.BP2Utils ? global.BP2Utils.esc(s) : String(s || ''); }
  function _ft(s) { return global.BP2Utils ? global.BP2Utils.formatTime(s) : '0:00'; }

  var LABELS = {
    vocals: 'Vocals', drums: 'Drums', percussion: 'Perc',
    bass: 'Bass',
    piano: 'Keys', keys1: 'Keys 1', keys2: 'Keys 2',
    guitar: 'Guitar', saxophone: 'Sax',
    other: 'Other', instrumental: 'Inst.',
    violin: 'Violin', strings: 'Strings', brass: 'Brass'
  };
  var COLORS = {
    vocals: '#00e676', drums: '#ff1744', percussion: '#e74c3c',
    bass: '#2979ff',
    guitar: '#ff9100', saxophone: '#f39c12',
    piano: '#d500f9', keys1: '#d500f9', keys2: '#8e44ad',
    other: '#651fff', instrumental: '#78909c',
    violin: '#1abc9c', strings: '#16a085', brass: '#d4ac0d'
  };
  var ICONS = {
    vocals: 'fa-microphone', drums: 'fa-drum', percussion: 'fa-drum',
    bass: 'fa-guitar',
    guitar: 'fa-guitar', saxophone: 'fa-music',
    piano: 'fa-keyboard', keys1: 'fa-keyboard', keys2: 'fa-keyboard',
    other: 'fa-sliders', instrumental: 'fa-compact-disc',
    violin: 'fa-music', strings: 'fa-music', brass: 'fa-music'
  };

  var BP2RenderStems = {
    init: function() {
      var c = _c();
      if (!c) return;

      // Update stem progress bar on timeupdate
      c.on('stem:timeupdate', function(d) {
        var fillEl = document.getElementById('bp2-stem-prog-fill-' + d.stemId);
        var curEl = document.getElementById('bp2-stem-prog-cur-' + d.stemId);
        var totEl = document.getElementById('bp2-stem-prog-tot-' + d.stemId);
        if (fillEl && d.duration) fillEl.style.width = (d.currentTime / d.duration * 100) + '%';
        if (curEl) curEl.textContent = _ft(d.currentTime);
        if (totEl && d.duration) totEl.textContent = _ft(d.duration);
      });
    },

    renderForSong: function(songId, container) {
      var c = _c();
      if (!c) return;

      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      if (!song || !song.stems) return;

      var playingStemId = c.ref('playingStemId');
      var stems = song.stems;
      var emptyStems = (song.emptyStems && typeof song.emptyStems === 'object')
        ? (Array.isArray(song.emptyStems) ? song.emptyStems : Object.keys(song.emptyStems).filter(function(k){ return song.emptyStems[k]; }))
        : [];
      var emptySet = {}; for (var ei = 0; ei < emptyStems.length; ei++) emptySet[emptyStems[ei]] = true;
      // Sort stems: instrumental, vocals, drums, percussion, bass, keys1, keys2, piano, guitar, saxophone, violin, strings, brass, other
      var STEM_ORDER = ['instrumental', 'vocals', 'drums', 'percussion', 'bass', 'keys1', 'keys2', 'piano', 'guitar', 'saxophone', 'violin', 'strings', 'brass', 'other'];
      var stemNames = Object.keys(stems).sort(function(a, b) {
        var ai = STEM_ORDER.indexOf(a);
        var bi = STEM_ORDER.indexOf(b);
        if (ai === -1) ai = 99;
        if (bi === -1) bi = 99;
        return ai - bi;
      });

      var html = '<div class="bp2-channel-rack" style="padding:4px 8px;">';

      stemNames.forEach(function(name) {
        var label = LABELS[name] || name;
        var color = COLORS[name] || '#8b949e';
        var icon = ICONS[name] || 'fa-music';
        var stemId = songId + '_' + name;
        var isPlaying = playingStemId === stemId;
        var hasChart = !!(song.charts && song.charts[name]);
        var isEmpty = !!emptySet[name];

        if (isEmpty) {
          html += '<div class="bp2-channel-unit is-empty" data-action="stem-empty-info" data-stem="' + _esc(name) + '" aria-disabled="true" title="Not on this track" style="opacity:0.55;cursor:default;">' +
            '<div class="bp2-ch-indicator" style="background:#3a3f4a;"></div>' +
            '<button class="bp2-ch-play" disabled aria-disabled="true" style="color:#5a5f6a;border-color:#3a3f4a;cursor:not-allowed;"><i class="fa-solid fa-circle-minus"></i></button>' +
            '<span class="bp2-ch-name" style="color:#7a7f8a;"><i class="fa-solid ' + icon + '" style="color:#5a5f6a;margin-right:4px;font-size:10px;"></i>' + label + ' <span style="font-size:9px;color:#5a5f6a;margin-left:4px;">Not on this track</span></span>' +
            '<div class="bp2-ch-meter"><div class="bp2-ch-meter-fill" style="width:0%;background:#3a3f4a;"></div></div>' +
            (hasChart ? '<button class="bp2-ch-pdf has-chart" data-action="stem-chart" data-path="' + _esc(song.charts[name]) + '" data-title="' + _esc(song.title + ' \u2014 ' + label) + '"><i class="fa-solid fa-file-pdf"></i></button>' : '<div style="width:24px;"></div>') +
          '</div>';
          return;
        }

        html += '<div class="bp2-channel-unit' + (isPlaying ? ' is-playing' : '') + '">' +
          '<div class="bp2-ch-indicator" style="background:' + color + ';' + (isPlaying ? 'box-shadow:0 0 6px ' + color + ';' : '') + '"></div>' +
          '<button class="bp2-ch-play" data-action="stem-play" data-song="' + _esc(songId) + '" data-stem="' + _esc(name) + '" style="color:' + color + ';' + (isPlaying ? 'border-color:' + color + ';' : '') + '"><i class="fa-solid ' + (isPlaying ? 'fa-pause' : 'fa-play') + '"></i></button>' +
          '<span class="bp2-ch-name"><i class="fa-solid ' + icon + '" style="color:' + color + ';margin-right:4px;font-size:10px;"></i>' + label + '</span>' +
          '<div class="bp2-ch-meter"><div class="bp2-ch-meter-fill" style="width:' + Math.round(Math.random() * 50 + 30) + '%;background:' + color + ';"></div></div>' +
          (hasChart ? '<button class="bp2-ch-pdf has-chart" data-action="stem-chart" data-path="' + _esc(song.charts[name]) + '" data-title="' + _esc(song.title + ' \u2014 ' + label) + '"><i class="fa-solid fa-file-pdf"></i></button>' : '<div style="width:24px;"></div>') +
        '</div>';

        // Stem progress bar (only for playing stem)
        if (isPlaying) {
          html += '<div style="display:flex;align-items:center;gap:6px;padding:0 8px 6px;margin-left:40px;">' +
            '<span id="bp2-stem-prog-cur-' + stemId + '" style="font-family:monospace;font-size:9px;color:#4a4f5a;min-width:26px;">0:00</span>' +
            '<div style="flex:1;height:2px;background:#050507;border-radius:1px;overflow:hidden;">' +
              '<div id="bp2-stem-prog-fill-' + stemId + '" style="height:100%;width:0%;background:' + color + ';border-radius:1px;transition:width 100ms linear;"></div>' +
            '</div>' +
            '<span id="bp2-stem-prog-tot-' + stemId + '" style="font-family:monospace;font-size:9px;color:#4a4f5a;min-width:26px;">0:00</span>' +
          '</div>';
        }
      });

      html += '</div>';

      // Mixer mount point
      html += '<div id="bp2-mixer-host-' + _esc(songId) + '"></div>';

      container.innerHTML = html;

      // Wire stem play clicks
      container.addEventListener('click', function(e) {
        var playBtn = e.target.closest('[data-action="stem-play"]');
        if (playBtn) {
          e.stopPropagation();
          var c2 = _c();
          if (c2) c2.emit('stems:play', { songId: playBtn.getAttribute('data-song'), stemName: playBtn.getAttribute('data-stem') });
          return;
        }
        var chartBtn = e.target.closest('[data-action="stem-chart"]');
        if (chartBtn) {
          e.stopPropagation();
          if (global.BP2Charts) global.BP2Charts.openChartFile(chartBtn.getAttribute('data-path'), chartBtn.getAttribute('data-title'));
          return;
        }
        var emptyUnit = e.target.closest('[data-action="stem-empty-info"]');
        if (emptyUnit) {
          e.stopPropagation();
          var n = emptyUnit.getAttribute('data-stem') || 'this instrument';
          var lbl = LABELS[n] || n;
          if (global.Toast && global.Toast.info) global.Toast.info('Not on this track — no ' + lbl.toLowerCase() + ' detected for this song.');
        }
      });

      // Mount mixer integration
      setTimeout(function() {
        var mixerHost = document.getElementById('bp2-mixer-host-' + songId);
        if (mixerHost && global.BP2Integration) {
          var userId = c.getUser() ? c.getUser().uid : null;
          global.BP2Integration.mount({
            host: mixerHost,
            songId: songId,
            userId: userId,
            stems: song.stems,
            barTimings: song.barTimings || null
          });
        }
      }, 50);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2RenderStems;
  else if (global) global.BP2RenderStems = BP2RenderStems;
})(typeof window !== 'undefined' ? window : this);
