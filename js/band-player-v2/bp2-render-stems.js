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

  var LABELS = { vocals: 'Vocals', drums: 'Drums', bass: 'Bass', other: 'Other', guitar: 'Guitar', piano: 'Keys', instrumental: 'Inst.' };
  var COLORS = { vocals: '#00e676', drums: '#ff1744', bass: '#2979ff', guitar: '#ff9100', piano: '#d500f9', other: '#651fff', instrumental: '#78909c' };
  var ICONS = { vocals: 'fa-microphone', drums: 'fa-drum', bass: 'fa-guitar', guitar: 'fa-guitar', piano: 'fa-keyboard', other: 'fa-sliders', instrumental: 'fa-compact-disc' };

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
      var stemNames = Object.keys(stems);

      var html = '<div class="bp2-channel-rack" style="padding:4px 8px;">';

      stemNames.forEach(function(name) {
        var label = LABELS[name] || name;
        var color = COLORS[name] || '#8b949e';
        var icon = ICONS[name] || 'fa-music';
        var stemId = songId + '_' + name;
        var isPlaying = playingStemId === stemId;
        var hasChart = !!(song.charts && song.charts[name]);

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
