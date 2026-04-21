/* ============================================
   bp2-render-edit.js — Edit Mode Rendering
   Band Player v2.0

   Renders edit-mode tracklist: per-set sections with reorder controls,
   intro/outro slots, add-set button.

   WHO CALLS IT:
     - bp2-render.js delegates when editMode is true
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

  var _handler = null; // single click handler reference — prevents listener stacking

  function _onClick(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (!action) return;

    var c2 = _c();
    if (!c2) return;

    if (action === 'edit:move-song') {
      c2.emit('edit:move-song', {
        setIndex: parseInt(btn.getAttribute('data-set'), 10),
        position: btn.getAttribute('data-pos'),
        songIndex: parseInt(btn.getAttribute('data-idx'), 10),
        direction: parseInt(btn.getAttribute('data-dir'), 10)
      });
    } else if (action === 'edit:remove-song') {
      c2.emit('edit:remove-song', {
        setIndex: parseInt(btn.getAttribute('data-set'), 10),
        position: btn.getAttribute('data-pos'),
        songIndex: parseInt(btn.getAttribute('data-idx'), 10)
      });
    } else if (action === 'edit:move-set') {
      c2.emit('edit:move-set', {
        setIndex: parseInt(btn.getAttribute('data-set'), 10),
        direction: parseInt(btn.getAttribute('data-dir'), 10)
      });
    } else if (action === 'edit:remove-set') {
      c2.emit('edit:remove-set', { setIndex: parseInt(btn.getAttribute('data-set'), 10) });
    } else if (action === 'edit:add-set') {
      c2.emit('edit:add-set');
    } else if (action === 'edit:rename-set') {
      c2.emit('edit:rename-set', { setIndex: parseInt(btn.getAttribute('data-set'), 10) });
    } else if (action === 'edit:move-to-set') {
      c2.emit('edit:move-to-set', {
        setIndex: parseInt(btn.getAttribute('data-set'), 10),
        position: btn.getAttribute('data-pos') || 'song',
        songIndex: parseInt(btn.getAttribute('data-idx'), 10)
      });
    } else if (action === 'edit:assign-intro') {
      c2.emit('edit:assign-intro', { setIndex: parseInt(btn.getAttribute('data-set'), 10) });
    } else if (action === 'edit:assign-outro') {
      c2.emit('edit:assign-outro', { setIndex: parseInt(btn.getAttribute('data-set'), 10) });
    } else if (action === 'edit:clear-intro') {
      c2.emit('edit:clear-intro', { setIndex: parseInt(btn.getAttribute('data-set'), 10) });
    } else if (action === 'edit:clear-outro') {
      c2.emit('edit:clear-outro', { setIndex: parseInt(btn.getAttribute('data-set'), 10) });
    }
  }

  var BP2RenderEdit = {
    init: function() {},

    render: function(container) {
      var c = _c();
      if (!c) return;

      var pl = c.ref('currentPlaylist');
      var songsMap = c.ref('allSongsMap');
      var sets = (pl && pl.sets) || [];
      var plArt = (pl && pl.albumArt) || '';
      var artThumb = plArt
        ? '<div class="bp2-rack-art"><img src="' + _esc(plArt) + '" alt=""></div>'
        : '<div class="bp2-rack-art"><img src="images/logo/gbe-square.svg" alt=""></div>';

      var html = '<div style="padding:8px 12px;font-size:12px;font-weight:700;color:#448aff;display:flex;justify-content:space-between;align-items:center;letter-spacing:0.06em;">' +
        '<span><i class="fa-solid fa-layer-group" style="margin-right:6px;"></i>SET ARRANGEMENT</span>' +
        '<span style="color:#4a4f5a;font-weight:400;">' + sets.length + ' set' + (sets.length !== 1 ? 's' : '') + '</span></div>';

      sets.forEach(function(set, si) {
        var isFirst = si === 0;
        var isLast = si === sets.length - 1;

        html += '<div class="bp2-rack-divider"><span>' + _esc(set.label || 'Set ' + (si + 1)) + '</span></div>';

        // Set action buttons
        html += '<div style="display:flex;gap:4px;padding:2px 12px 6px;">' +
          '<button data-action="edit:move-set" data-set="' + si + '" data-dir="-1" class="bp2-hw-btn bp2-hw-tiny"' + (isFirst ? ' disabled style="opacity:0.2;"' : '') + ' title="Move up"><i class="fa-solid fa-chevron-up"></i></button>' +
          '<button data-action="edit:move-set" data-set="' + si + '" data-dir="1" class="bp2-hw-btn bp2-hw-tiny"' + (isLast ? ' disabled style="opacity:0.2;"' : '') + ' title="Move down"><i class="fa-solid fa-chevron-down"></i></button>' +
          '<button data-action="edit:rename-set" data-set="' + si + '" class="bp2-hw-btn bp2-hw-tiny" style="color:#448aff;border-color:rgba(68,138,255,0.2);" title="Rename set"><i class="fa-solid fa-pen"></i></button>' +
          '<button data-action="edit:remove-set" data-set="' + si + '" class="bp2-hw-btn bp2-hw-tiny" style="color:#ff1744;border-color:rgba(255,23,68,0.2);" title="Remove set"><i class="fa-solid fa-trash"></i></button>' +
        '</div>';

        var multiSet = sets.length > 1;

        // Intro slot
        if (set.intro) {
          var introSong = songsMap[set.intro];
          html += '<div class="bp2-rack-unit" style="cursor:default;border-left:2px solid #00e676;">' +
            '<div class="bp2-rack-led"></div>' +
            '<div class="bp2-rack-num"><span style="color:#00e676;font-size:9px;font-weight:700;">INT</span></div>' +
            artThumb +
            '<div class="bp2-rack-info"><div class="bp2-rack-title">' + _esc(_tc(introSong ? introSong.title : '?')) + ' <span class="bp2-tag" style="background:rgba(0,230,118,0.15);color:#00e676;font-size:9px;padding:1px 5px;border-radius:3px;">INTRO</span></div><div class="bp2-rack-meta">' + _esc(introSong ? (introSong.artist || 'Unknown').toUpperCase() : '') + '</div></div>' +
            '<div style="display:flex;gap:3px;">' +
              '<button data-action="edit:clear-intro" data-set="' + si + '" class="bp2-hw-btn bp2-hw-tiny" style="color:#ff1744;border-color:rgba(255,23,68,0.2);" title="Remove intro"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
          '</div>';
        } else {
          html += '<div style="padding:4px 12px;">' +
            '<button data-action="edit:assign-intro" data-set="' + si + '" style="padding:6px 12px;border-radius:6px;border:1px dashed rgba(0,230,118,0.25);background:rgba(0,230,118,0.04);color:#00e676;cursor:pointer;font-size:11px;font-weight:600;font-family:inherit;width:100%;"><i class="fa-solid fa-plus" style="margin-right:6px;"></i>Set Intro</button>' +
          '</div>';
        }

        // Songs in set
        (set.songs || []).forEach(function(songId, songIdx) {
          var song = songsMap[songId];
          if (!song) return;
          var isFirstSong = songIdx === 0;
          var isLastSong = songIdx === (set.songs || []).length - 1;
          // Arrows: disable only if at boundary AND no adjacent set to cross into
          var disableUp = isFirstSong && isFirst;
          var disableDown = isLastSong && isLast;

          html += '<div class="bp2-rack-unit" style="cursor:default;">' +
            '<div class="bp2-rack-led"></div>' +
            '<div class="bp2-rack-num"><span style="color:#4a4f5a;font-size:11px;">' + (songIdx + 1) + '</span></div>' +
            artThumb +
            '<div class="bp2-rack-info"><div class="bp2-rack-title">' + _esc(_tc(song.title)) + '</div><div class="bp2-rack-meta">' + _esc((song.artist || 'Unknown').toUpperCase()) + '</div></div>' +
            '<div style="display:flex;gap:3px;">' +
              '<button data-action="edit:move-song" data-set="' + si + '" data-pos="song" data-idx="' + songIdx + '" data-dir="-1" class="bp2-hw-btn bp2-hw-tiny"' + (disableUp ? ' disabled style="opacity:0.2;"' : '') + ' title="Move up"><i class="fa-solid fa-chevron-up"></i></button>' +
              '<button data-action="edit:move-song" data-set="' + si + '" data-pos="song" data-idx="' + songIdx + '" data-dir="1" class="bp2-hw-btn bp2-hw-tiny"' + (disableDown ? ' disabled style="opacity:0.2;"' : '') + ' title="Move down"><i class="fa-solid fa-chevron-down"></i></button>' +
              (multiSet ? '<button data-action="edit:move-to-set" data-set="' + si + '" data-pos="song" data-idx="' + songIdx + '" class="bp2-hw-btn bp2-hw-tiny" style="color:#58a6ff;border-color:rgba(88,166,255,0.2);" title="Move to another set"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>' : '') +
              '<button data-action="edit:remove-song" data-set="' + si + '" data-pos="song" data-idx="' + songIdx + '" class="bp2-hw-btn bp2-hw-tiny" style="color:#ff1744;border-color:rgba(255,23,68,0.2);" title="Remove"><i class="fa-solid fa-trash"></i></button>' +
            '</div>' +
          '</div>';
        });

        // Outro slot
        if (set.outro) {
          var outroSong = songsMap[set.outro];
          html += '<div class="bp2-rack-unit" style="cursor:default;border-left:2px solid #448aff;">' +
            '<div class="bp2-rack-led"></div>' +
            '<div class="bp2-rack-num"><span style="color:#448aff;font-size:9px;font-weight:700;">OUT</span></div>' +
            artThumb +
            '<div class="bp2-rack-info"><div class="bp2-rack-title">' + _esc(_tc(outroSong ? outroSong.title : '?')) + ' <span class="bp2-tag" style="background:rgba(68,138,255,0.15);color:#448aff;font-size:9px;padding:1px 5px;border-radius:3px;">OUTRO</span></div><div class="bp2-rack-meta">' + _esc(outroSong ? (outroSong.artist || 'Unknown').toUpperCase() : '') + '</div></div>' +
            '<div style="display:flex;gap:3px;">' +
              '<button data-action="edit:clear-outro" data-set="' + si + '" class="bp2-hw-btn bp2-hw-tiny" style="color:#ff1744;border-color:rgba(255,23,68,0.2);" title="Remove outro"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
          '</div>';
        } else {
          html += '<div style="padding:4px 12px;">' +
            '<button data-action="edit:assign-outro" data-set="' + si + '" style="padding:6px 12px;border-radius:6px;border:1px dashed rgba(68,138,255,0.25);background:rgba(68,138,255,0.04);color:#448aff;cursor:pointer;font-size:11px;font-weight:600;font-family:inherit;width:100%;"><i class="fa-solid fa-plus" style="margin-right:6px;"></i>Set Outro</button>' +
          '</div>';
        }
      });

      // Add set button
      html += '<div style="padding:12px;text-align:center;">' +
        '<button data-action="edit:add-set" style="padding:10px 24px;border-radius:8px;border:1px dashed rgba(232,160,18,0.3);background:rgba(232,160,18,0.04);color:#e8a012;cursor:pointer;font-size:13px;font-weight:700;width:100%;font-family:inherit;letter-spacing:0.04em;">' +
          '<i class="fa-solid fa-plus" style="margin-right:8px;"></i>ADD SET' +
        '</button>' +
      '</div>';

      container.innerHTML = html;

      // Wire edit actions via delegation — remove old handler first to prevent stacking
      if (_handler) container.removeEventListener('click', _handler);
      _handler = _onClick;
      container.addEventListener('click', _handler);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2RenderEdit;
  else if (global) global.BP2RenderEdit = BP2RenderEdit;
})(typeof window !== 'undefined' ? window : this);
