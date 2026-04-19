/* ============================================
   bp2-lyrics.js — Lyrics Display Overlay
   Band Player v2.0

   WHAT IT DOES:
     Renders a full-screen overlay with the song's lyrics in a
     confidential paper-style design. Serif typography, section
     labels as badges, PROPRIETARY & CONFIDENTIAL header, GBE
     copyright footer. 48px close button (fixed, always visible).
     Backdrop tap closes. Swipe-down closes on mobile.

   WHAT IT OWNS:
     - Lyrics overlay DOM (creates/destroys)
     - Paper-style rendering (header, body, footer)
     - Section label parsing ([Verse 1], [Chorus], etc.)
     - Close button (48px, fixed top-right)
     - Backdrop dismiss
     - Entry/exit animations

   WHO CALLS IT:
     - bp2-render.js "Lyrics" action button → opens overlay

   DEPENDENCIES:
     - bp2-core.js (reads song data from state)
     - bp2-utils.js (escHtml)
   ============================================ */
(function(global) {
  'use strict';

  var BP2Lyrics = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Lyrics;
  } else if (global) {
    global.BP2Lyrics = BP2Lyrics;
  }
})(typeof window !== 'undefined' ? window : this);
