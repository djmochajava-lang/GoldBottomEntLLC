/* ============================================
   bp2-render.js — Listen Mode Track List Rendering
   Band Player v2.0

   WHAT IT DOES:
     Renders tracklist in listen mode using the approved hardware design.
     Track rows, set dividers, practice stats, playlist dropdown,
     now-playing indicator, empty states.

   WHO CALLS IT:
     - BP2Core state changes trigger re-renders
     - BP2Player emits play/pause → UI updates

   DEPENDENCIES:
     - bp2-core.js, bp2-utils.js
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  var _utils = null;

  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  function _u() {
    if (!_utils && global.BP2Utils) _utils = global.BP2Utils;
    return _utils;
  }

  function _esc(s) { return _u() ? _u().esc(s) : String(s || ''); }
  function _tc(s) { return _u() ? _u().titleCase(s) : String(s || ''); }
  function _ft(s) { return _u() ? _u().formatTime(s) : '0:00'; }

  // ── Playlist Dropdown ────────────────────────
  function _renderPlaylistDropdown() {
    var c = _c();
    if (!c) return;
    var el = document.getElementById('bp2-playlist-select');
    var nameEl = document.querySelector('.bp2-playlist-name span');
    if (!el) return;

    var playlists = c.ref('playlists');
    if (!playlists || playlists.length === 0) {
      el.innerHTML = '<option value="">No playlists</option>';
      if (nameEl) nameEl.textContent = 'No Playlists';
      return;
    }

    el.innerHTML = playlists.map(function(pl) {
      return '<option value="' + _esc(pl.id) + '">' + _esc(_tc(pl.name)) + '</option>';
    }).join('');

    var current = c.ref('currentPlaylist');
    if (current) {
      el.value = current.id;
      if (nameEl) nameEl.textContent = _tc(current.name);
    }
  }

  // ── Practice Stats ───────────────────────────
  function _renderStats() {
    var c = _c();
    if (!c) return;
    var el = document.getElementById('bp2-practice-stats');
    if (!el) return;

    var songs = c.ref('songs');
    var completed = c.ref('completedTracks');
    if (!songs || songs.length === 0) {
      el.style.display = 'none';
      return;
    }

    var count = 0;
    for (var i = 0; i < songs.length; i++) {
      if (completed[songs[i].id]) count++;
    }

    if (count === 0) {
      el.style.display = 'none';
      return;
    }

    var pct = Math.round(count / songs.length * 100);
    el.style.display = '';
    el.innerHTML =
      '<span><i class="fa-solid fa-check-circle" style="color:var(--bp2-led-green);"></i> ' + count + ' / ' + songs.length + ' PRACTICED</span>' +
      '<span class="bp2-stats-meter"><span class="bp2-stats-meter-fill" style="width:' + pct + '%;"></span></span>' +
      '<span class="bp2-stats-pct">' + pct + '%</span>';
  }

  // ── Now Playing (transport display) ──────────
  function _updateTransportDisplay() {
    var c = _c();
    if (!c) return;

    var songs = c.ref('songs');
    var idx = c.ref('currentIndex');
    var song = (idx >= 0 && songs[idx]) ? songs[idx] : null;

    // Song title in LCD
    var songEl = document.getElementById('bp2-lcd-song-text');
    if (songEl) {
      songEl.textContent = song ? _tc(song.title) : '';
      songEl.style.display = song ? '' : 'none';
    }

    // Artist
    var artistEl = document.getElementById('bp2-lcd-artist-text');
    if (artistEl) {
      artistEl.textContent = song ? (song.artist || 'L.A. Young').toUpperCase() : '';
      artistEl.style.display = song ? '' : 'none';
    }

    // LCD album art — use per-song artwork or GBE logo fallback
    var lcdArt = document.querySelector('.bp2-lcd-art img');
    if (lcdArt) {
      var artSrc = (song && song.artworkUrl) ? song.artworkUrl : 'images/logo/gbe-square.svg';
      if (lcdArt.getAttribute('src') !== artSrc) lcdArt.setAttribute('src', artSrc);
    }

    // Play/pause icon
    var playIcon = document.getElementById('bp2-play-icon');
    if (playIcon) {
      playIcon.className = 'fa-solid ' + (c.ref('isPlaying') ? 'fa-pause' : 'fa-play');
    }

    // Repeat indicator
    var repeatBtn = document.getElementById('bp2-repeat-btn');
    if (repeatBtn) {
      var mode = c.ref('repeatMode');
      repeatBtn.classList.toggle('is-on', mode !== 'off');
    }
  }

  // ── Timeline Progress ────────────────────────
  function _updateTimeline(data) {
    var fillEl = document.getElementById('bp2-timeline-fill');
    var headEl = document.getElementById('bp2-timeline-playhead');
    var curEl = document.getElementById('bp2-time-current');
    var totEl = document.getElementById('bp2-time-total');

    if (!data) return;
    var pct = data.progress ? (data.progress * 100) : 0;

    if (fillEl) fillEl.style.width = pct + '%';
    if (headEl) headEl.style.left = pct + '%';
    if (curEl) curEl.textContent = _ft(data.currentTime);
    if (totEl && data.duration) totEl.textContent = _ft(data.duration);
  }

  // ── Tracklist ────────────────────────────────
  function _renderTracklist() {
    var c = _c();
    if (!c) return;
    var el = document.getElementById('bp2-tracklist');
    if (!el) return;

    // Delegate to edit-mode renderer when editMode flag is set
    if (c.ref('editMode') && global.BP2RenderEdit && typeof global.BP2RenderEdit.render === 'function') {
      global.BP2RenderEdit.render(el);
      return;
    }

    var songs = c.ref('songs');
    var playOrder = c.ref('playOrder');
    var currentPlaylist = c.ref('currentPlaylist');
    var currentIndex = c.ref('currentIndex');
    var isPlaying = c.ref('isPlaying');
    var completed = c.ref('completedTracks');
    var sets = (currentPlaylist && currentPlaylist.sets) || [];
    var multiSet = sets.length > 1;
    var plArt = (currentPlaylist && currentPlaylist.albumArt) || '';

    if (!songs || songs.length === 0) {
      el.innerHTML =
        '<div style="padding:40px 16px;text-align:center;">' +
          '<div style="font-size:28px;color:rgba(255,255,255,0.06);margin-bottom:10px;"><i class="fa-solid fa-headphones"></i></div>' +
          '<div style="font-size:14px;font-weight:600;color:#4a4f5a;">' +
            (currentPlaylist ? 'No songs in this playlist yet.' : 'Select or create a playlist.') +
          '</div>' +
        '</div>';
      return;
    }

    var defaultArt = plArt || 'images/logo/gbe-square.svg';

    var html = '';
    var trackNum = 0;
    var lastSetIndex = -1;

    for (var i = 0; i < songs.length; i++) {
      var song = songs[i];
      var po = playOrder[i];
      var isActive = (i === currentIndex);
      var practiced = completed[song.id];
      var duration = song.duration ? _ft(song.duration) : '';
      var cached = (global.BP2Offline && global.BP2Offline.isCached) ? global.BP2Offline.isCached(song.id) : false;

      // Set divider
      if (multiSet && po && po.setIndex !== lastSetIndex) {
        var setLabel = sets[po.setIndex] ? (sets[po.setIndex].label || ('Set ' + (po.setIndex + 1))) : '';
        html += '<div class="bp2-rack-divider"><span>' + _esc(setLabel).toUpperCase() + '</span></div>';
        lastSetIndex = po.setIndex;
      }

      trackNum++;

      // Position badge
      var badge = '';
      if (po && po.position === 'intro') badge = ' <span class="bp2-tag" style="background:rgba(0,230,118,0.15);color:#00e676;">INTRO</span>';
      else if (po && po.position === 'outro') badge = ' <span class="bp2-tag" style="background:rgba(68,138,255,0.15);color:#448aff;">OUTRO</span>';

      // LED state
      var ledClass = isActive ? ' on' : (practiced ? ' practiced' : '');
      var hasStems = !!(song.stems && Object.keys(song.stems).length > 0);
      var stemStatus = c.ref('stemStatuses') ? c.ref('stemStatuses')[song.id] : null;
      var isProcessing = stemStatus && stemStatus.status && stemStatus.status !== 'complete' && stemStatus.status !== 'error';

      // Track number cell
      var numHtml;
      if (isActive && isPlaying) {
        numHtml = '<div class="bp2-eq"><span></span><span></span><span></span><span></span></div>';
      } else if (practiced) {
        numHtml = '<i class="fa-solid fa-check-circle bp2-practiced-icon"></i>';
      } else {
        numHtml = '<span>' + trackNum + '</span>';
      }

      html +=
        '<div class="bp2-rack-unit' + (isActive ? ' is-active' : '') + '" data-index="' + i + '">' +
          '<div class="bp2-rack-led' + ledClass + '"></div>' +
          '<div class="bp2-rack-num">' + numHtml + '</div>' +
          '<div class="bp2-rack-art"><img src="' + _esc(song.artworkUrl || defaultArt) + '" alt="" onerror="this.src=\'images/logo/gbe-square.svg\'"></div>' +
          '<div class="bp2-rack-info">' +
            '<div class="bp2-rack-title">' + _esc(_tc(song.title)) + badge +
              (cached ? ' <i class="fa-solid fa-cloud-arrow-down bp2-cached-icon"></i>' : '') +
            '</div>' +
            '<div class="bp2-rack-meta">' + _esc((song.artist || 'Unknown').toUpperCase()) + '</div>' +
          '</div>' +
          (duration ? '<span class="bp2-rack-time">' + duration + '</span>' : '') +
          (hasStems
            ? '<button data-action="toggle-stems" data-song="' + song.id + '" title="Toggle stems" style="flex-shrink:0;padding:3px 6px;border-radius:4px;background:rgba(232,160,18,0.08);border:1px solid rgba(232,160,18,0.15);color:#e8a012;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-music"></i></button>'
            : (isProcessing
                ? '<span title="Stems processing" style="flex-shrink:0;padding:3px 6px;border-radius:4px;background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.15);color:#58a6ff;font-size:12px;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-gear fa-spin"></i></span>'
                : (c.canEdit && c.canEdit()
                    ? '<button data-action="request-stems" data-song="' + song.id + '" title="Process stems" style="flex-shrink:0;padding:3px 6px;border-radius:4px;background:rgba(82,196,26,0.06);border:1px dashed rgba(82,196,26,0.25);color:#52c41a;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-wand-magic-sparkles"></i></button>'
                    : ''))) +
        '</div>';

      // Tool drawer — only on the ACTIVE track (not every track)
      if (isActive) {
        var hasCharts = !!(song.charts && Object.keys(song.charts).length > 0);
        var hasLyrics = !!song.lyrics;
        html +=
          '<div class="bp2-tool-drawer">' +
            '<button class="bp2-tool-btn' + (hasLyrics ? ' is-lit' : '') + '" data-action="lyrics" data-song="' + song.id + '"><i class="fa-solid fa-align-left"></i><span>LYR</span></button>' +
            '<button class="bp2-tool-btn' + (hasCharts ? ' is-lit' : '') + '" data-action="charts" data-song="' + song.id + '"><i class="fa-solid fa-music"></i><span>CHT</span></button>' +
            '<button class="bp2-tool-btn" data-action="notes" data-song="' + song.id + '"><i class="fa-solid fa-comment-dots"></i><span>NOTE</span></button>' +
            '<button class="bp2-tool-btn" data-action="download" data-song="' + song.id + '"><i class="fa-solid fa-download"></i><span>DL</span></button>' +
            '<button class="bp2-tool-btn" data-action="offline" data-song="' + song.id + '"><i class="fa-' + (cached ? 'solid' : 'regular') + ' fa-cloud-arrow-down"></i><span>SAVE</span></button>' +
          '</div>';
      }

      // Expanded stems panel (toggle is inline with the track row now)
      if (hasStems) {
        var expanded = c.ref('expandedStems')[song.id];
        if (expanded) {
          html += '<div class="bp2-stems-module" id="bp2-stems-panel-' + song.id + '" style="margin:0 8px 8px;"></div>';
        }
      }
    }

    el.innerHTML = html;

    // Mount stem panels for expanded songs
    if (global.BP2RenderStems) {
      for (var j = 0; j < songs.length; j++) {
        var s = songs[j];
        if (s.stems && Object.keys(s.stems).length > 0 && c.ref('expandedStems')[s.id]) {
          var panel = document.getElementById('bp2-stems-panel-' + s.id);
          if (panel) global.BP2RenderStems.renderForSong(s.id, panel);
        }
      }
    }
  }

  // ── Event Delegation ─────────────────────────
  function _bindEvents() {
    var c = _c();
    if (!c) return;

    // Tracklist clicks (event delegation)
    var tracklist = document.getElementById('bp2-tracklist');
    if (tracklist) {
      tracklist.addEventListener('click', function(e) {
        // Stems badge click → toggle stems
        var stemsBadge = e.target.closest('[data-action="toggle-stems"]');
        if (stemsBadge) {
          e.stopPropagation();
          c.emit('stems:toggle', { songId: stemsBadge.getAttribute('data-song') });
          return;
        }

        // Request stems click → kick off stem separation pipeline
        var reqStemsBtn = e.target.closest('[data-action="request-stems"]');
        if (reqStemsBtn) {
          e.stopPropagation();
          c.emit('stems:request', { songId: reqStemsBtn.getAttribute('data-song') });
          return;
        }

        // Track row click → play
        var rackUnit = e.target.closest('.bp2-rack-unit');
        if (rackUnit && !e.target.closest('.bp2-tool-btn')) {
          var idx = parseInt(rackUnit.getAttribute('data-index'), 10);
          if (!isNaN(idx)) {
            // Collapse all expanded stems when switching active track
            var expanded = c.ref('expandedStems');
            for (var key in expanded) {
              if (expanded.hasOwnProperty(key)) expanded[key] = false;
            }
            c.emit('player:play', { index: idx });
          }
          return;
        }

        // Tool button click
        var toolBtn = e.target.closest('.bp2-tool-btn');
        if (toolBtn) {
          e.stopPropagation();
          var action = toolBtn.getAttribute('data-action');
          var songId = toolBtn.getAttribute('data-song');
          c.emit('tool:' + action, { songId: songId });
          return;
        }

      });
    }

    // Transport controls
    var playBtn = document.getElementById('bp2-btn-play');
    if (playBtn) playBtn.addEventListener('click', function() { c.emit('player:toggle-play'); });

    var prevBtn = document.getElementById('bp2-btn-prev');
    if (prevBtn) prevBtn.addEventListener('click', function() { c.emit('player:prev'); });

    var nextBtn = document.getElementById('bp2-btn-next');
    if (nextBtn) nextBtn.addEventListener('click', function() { c.emit('player:next'); });

    var repeatBtn = document.getElementById('bp2-repeat-btn');
    if (repeatBtn) repeatBtn.addEventListener('click', function() { c.emit('player:toggle-repeat'); });

    // Volume
    var volSlider = document.getElementById('bp2-vol-slider');
    if (volSlider) {
      volSlider.addEventListener('input', function() {
        c.emit('player:set-volume', { volume: parseInt(this.value, 10) / 100 });
      });
    }

    var muteBtn = document.getElementById('bp2-btn-mute');
    if (muteBtn) muteBtn.addEventListener('click', function() { c.emit('player:toggle-mute'); });

    // Playlist selector
    var plSelect = document.getElementById('bp2-playlist-select');
    if (plSelect) {
      plSelect.addEventListener('change', function() {
        c.emit('playlist:select', { playlistId: this.value });
      });
    }

    // Manager selector actions — New playlist
    var newPlBtn = document.getElementById('bp2-btn-new-playlist');
    if (newPlBtn) newPlBtn.addEventListener('click', function() {
      if (!c.canEdit || !c.canEdit()) {
        if (typeof Toast !== 'undefined') Toast.error('Create playlist requires band manager access');
        return;
      }
      if (global.BP2Playlist && typeof global.BP2Playlist.showCreatePlaylistModal === 'function') {
        global.BP2Playlist.showCreatePlaylistModal();
      } else if (typeof Toast !== 'undefined') {
        Toast.error('Playlist module not loaded');
      }
    });

    // Manager selector actions — Upload
    var uploadBtn = document.getElementById('bp2-btn-upload');
    if (uploadBtn) uploadBtn.addEventListener('click', function() {
      if (global.BP2Upload && typeof global.BP2Upload.showUploadModal === 'function') {
        global.BP2Upload.showUploadModal();
      } else if (typeof Toast !== 'undefined') {
        Toast.error('Upload module not loaded');
      }
    });

    // Manager selector actions — Add song to current playlist
    var addSongBtn = document.getElementById('bp2-btn-add-song');
    if (addSongBtn) addSongBtn.addEventListener('click', function() {
      if (global.BP2Upload && typeof global.BP2Upload.showAddToPlaylistModal === 'function') {
        global.BP2Upload.showAddToPlaylistModal();
      } else if (typeof Toast !== 'undefined') {
        Toast.error('Add-song module not loaded');
      }
    });

    // Manager selector actions — Toggle Edit mode on current playlist
    var editBtn = document.getElementById('bp2-btn-edit-playlist');
    if (editBtn) editBtn.addEventListener('click', function() {
      if (!c.canEdit || !c.canEdit()) {
        if (typeof Toast !== 'undefined') Toast.error('Edit requires band manager access');
        return;
      }
      c.emit('edit:toggle');
    });

    // Timeline seek
    var timeline = document.getElementById('bp2-timeline-track');
    if (timeline) {
      timeline.addEventListener('click', function(e) {
        var pct = e.offsetX / this.offsetWidth;
        c.emit('player:seek', { pct: pct });
      });
    }
  }

  // ── Full Re-render ───────────────────────────
  function _render() {
    _renderPlaylistDropdown();
    _renderStats();
    _renderTracklist();
    _updateTransportDisplay();
  }

  // ── Public API ───────────────────────────────
  var _rInitialized = false;

  var BP2Render = {
    init: function() {
      if (_rInitialized) return;
      _rInitialized = true;
      var c = _c();
      if (!c) return;

      _bindEvents();

      // Subscribe to state changes
      c.on('playlists:loaded', _render);
      c.on('playlists:empty', _render);
      c.on('playlist:selected', _render);
      c.on('playlist:song-added', _render);
      c.on('player:playing', function() { _renderTracklist(); _updateTransportDisplay(); });
      c.on('player:paused', function() { _renderTracklist(); _updateTransportDisplay(); });
      c.on('player:stopped', function() { _renderTracklist(); _updateTransportDisplay(); });
      c.on('player:timeupdate', _updateTimeline);
      c.on('player:metadata', function(d) { _updateTimeline({ duration: d.duration, currentTime: 0, progress: 0 }); });
      c.on('player:track-completed', _renderTracklist);
      c.on('player:volume', function(d) {
        var sl = document.getElementById('bp2-vol-slider');
        if (sl) sl.value = Math.round(d.volume * 100);
        var icon = document.getElementById('bp2-vol-icon');
        if (icon) icon.className = 'fa-solid ' + (d.volume === 0 ? 'fa-volume-xmark' : d.volume < 0.5 ? 'fa-volume-low' : 'fa-volume-high');
      });
      c.on('player:repeat', function() { _updateTransportDisplay(); });
      c.on('state:currentIndex', function() { _renderTracklist(); _updateTransportDisplay(); });

      // Wire player events to player module
      c.on('player:play', function(d) { if (global.BP2Player) global.BP2Player.play(d.index); });
      c.on('player:toggle-play', function() { if (global.BP2Player) global.BP2Player.togglePlay(); });
      c.on('player:prev', function() { if (global.BP2Player) global.BP2Player.prev(); });
      c.on('player:next', function() { if (global.BP2Player) global.BP2Player.next(); });
      c.on('player:toggle-repeat', function() { if (global.BP2Player) global.BP2Player.toggleRepeat(); });
      c.on('player:set-volume', function(d) { if (global.BP2Player) global.BP2Player.setVolume(d.volume); });
      c.on('player:toggle-mute', function() { if (global.BP2Player) global.BP2Player.toggleMute(); });
      c.on('player:seek', function(d) { if (global.BP2Player) global.BP2Player.seek(d.pct); });
      c.on('playlist:select', function(d) { if (global.BP2Playlist) global.BP2Playlist.selectPlaylist(d.playlistId); });
      c.on('player:stop-all', function() {
        if (global.BP2Player) {
          var audio = global.BP2Player.getAudio();
          if (audio) { audio.pause(); audio.currentTime = 0; }
        }
      });

      // Stems toggle — handled by bp2-stems.js, re-render on its event
      c.on('render:tracklist', _renderTracklist);
    },

    render: _render,
    renderTracklist: _renderTracklist,
    updateTransportDisplay: _updateTransportDisplay,
    _reset: function() { _rInitialized = false; _core = null; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Render;
  } else if (global) {
    global.BP2Render = BP2Render;
  }
})(typeof window !== 'undefined' ? window : this);
