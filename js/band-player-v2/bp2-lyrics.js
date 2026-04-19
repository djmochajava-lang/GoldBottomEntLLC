/* ============================================
   bp2-lyrics.js — Lyrics Display Overlay
   Band Player v2.0

   WHAT IT DOES:
     Full-screen overlay with confidential paper-style lyrics.
     48px close button (fixed, always visible). Backdrop tap closes.
     Swipe-down closes on mobile.

   WHO CALLS IT:
     - bp2-render.js "Lyrics" action button
   ============================================ */
(function(global) {
  'use strict';

  var _core = null;
  var _overlay = null;
  var _touchStartY = 0;

  function _c() {
    if (!_core && global.BP2Core) _core = global.BP2Core;
    return _core;
  }

  function _esc(s) {
    return global.BP2Utils ? global.BP2Utils.esc(s) : String(s || '');
  }

  function _tc(s) {
    return global.BP2Utils ? global.BP2Utils.titleCase(s) : String(s || '');
  }

  function _close() {
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
  }

  var BP2Lyrics = {
    init: function() {
      var c = _c();
      if (!c) return;
      c.on('tool:lyrics', function(d) { BP2Lyrics.show(d.songId); });
    },

    show: function(songId) {
      var c = _c();
      if (!c) return;
      var songsMap = c.ref('allSongsMap');
      var song = songsMap[songId];
      if (!song) return;

      var lyrics = song.lyrics || '[No lyrics available for this song yet]';

      // Parse lyrics into styled HTML
      var lines = lyrics.split('\n');
      var bodyHtml = lines.map(function(line) {
        var trimmed = line.trim();
        if (!trimmed) return '<p style="height:12px;"></p>';
        if (/^\[.*\]$/.test(trimmed)) {
          return '<p style="font-weight:600;color:#999;font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-top:24px;margin-bottom:8px;">' + _esc(trimmed.replace(/[\[\]]/g, '')) + '</p>';
        }
        return '<p style="margin:4px 0;">' + _esc(trimmed) + '</p>';
      }).join('');

      // Create overlay
      _overlay = document.createElement('div');
      _overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(5,5,7,0.97);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);overflow-y:auto;-webkit-overflow-scrolling:touch;';

      _overlay.innerHTML =
        // Close button — fixed, always visible, 48px
        '<button id="bp2-lyrics-close" style="position:fixed;top:12px;right:12px;z-index:10001;width:48px;height:48px;border-radius:50%;background:#1a1c22;border:1px solid #282c36;color:#e8e8e8;font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.5);">&times;</button>' +
        // Content card
        '<div style="width:100%;max-width:720px;margin:60px auto 40px;padding:0 16px;">' +
          '<div style="background:#f9f6f0;border-radius:10px;padding:48px 36px 56px;box-shadow:0 12px 40px rgba(0,0,0,0.6);color:#2a2a2a;">' +
            // Header
            '<div style="text-align:center;margin-bottom:8px;">' +
              '<p style="font-family:Georgia,serif;font-size:9px;color:#aaa;letter-spacing:2px;text-transform:uppercase;">PROPRIETARY &amp; CONFIDENTIAL</p>' +
              '<p style="font-family:Georgia,serif;font-size:9px;color:#bbb;letter-spacing:1px;">Gold Bottom Entertainment</p>' +
            '</div>' +
            '<div style="text-align:center;margin-bottom:30px;">' +
              '<h2 style="font-family:Georgia,serif;font-size:22px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#2a2a2a;margin:12px 0 8px;">' + _esc(_tc(song.title)) + '</h2>' +
              '<p style="font-family:Georgia,serif;font-size:13px;font-style:italic;color:#888;">Written by ' + _esc(song.artist || 'L.A. Young') + '</p>' +
              '<div style="width:60px;height:1px;background:#ccc;margin:20px auto;"></div>' +
            '</div>' +
            // Body
            '<div style="text-align:center;font-family:Georgia,serif;font-size:15px;line-height:2;color:#2a2a2a;">' + bodyHtml + '</div>' +
            // Footer
            '<div style="text-align:center;margin-top:28px;padding-top:16px;border-top:1px solid #ddd;">' +
              '<p style="font-family:Georgia,serif;font-size:9px;color:#aaa;letter-spacing:1px;">&copy; 2026 Gold Bottom Ent LLC. All rights reserved.</p>' +
              '<p style="font-family:Georgia,serif;font-size:9px;color:#aaa;letter-spacing:1px;">Unauthorized reproduction or distribution prohibited.</p>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.body.appendChild(_overlay);

      // Close button click
      var closeBtn = document.getElementById('bp2-lyrics-close');
      if (closeBtn) closeBtn.addEventListener('click', _close);

      // Backdrop click closes
      _overlay.addEventListener('click', function(e) {
        if (e.target === _overlay) _close();
      });

      // Swipe-down to close (mobile)
      _overlay.addEventListener('touchstart', function(e) {
        _touchStartY = e.touches[0].clientY;
      }, { passive: true });

      _overlay.addEventListener('touchend', function(e) {
        var deltaY = e.changedTouches[0].clientY - _touchStartY;
        if (deltaY > 100 && _overlay.scrollTop <= 0) _close();
      }, { passive: true });
    },

    close: _close
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BP2Lyrics;
  else if (global) global.BP2Lyrics = BP2Lyrics;
})(typeof window !== 'undefined' ? window : this);
