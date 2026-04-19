/* ============================================
   bp2-edit.js — Edit Mode Logic & Set Management
   Band Player v2.0

   WHAT IT DOES:
     Toggle edit mode (role-gated: admin, band_manager, artist only).
     Pauses playback on enter. Tracks dirty state. Saves sets +
     songOrder to Firestore on exit if changed. Song reorder within
     sets. Move songs between sets. Add/remove/reorder sets.
     Assign/clear intro and outro slots.

   WHAT IT OWNS:
     - Edit mode state (on/off, dirty flag)
     - moveSong(setIndex, position, songIndex, direction)
     - removeSong(setIndex, position, songIndex)
     - addSet(), removeSet(setIndex), moveSet(setIndex, direction)
     - assignIntro/Outro(setIndex), clearIntro/Outro(setIndex)
     - moveToSet(fromSet, position, songIndex, toSet)
     - rebuildFlatFromSets()
     - Firestore save on exit (sets + songOrder)

   WHO CALLS IT:
     - bp2-render.js edit button triggers toggleEditMode via event
     - bp2-render-edit.js calls move/remove/add operations via events
     - bp2-core.js listens for edit state changes

   DOES NOT OWN:
     - Edit mode DOM rendering (→ bp2-render-edit.js)

   DEPENDENCIES:
     - bp2-core.js (state, events, db ref)
     - bp2-playlist.js (set arrangement helpers: flattenSets, setsToSongOrder)
   ============================================ */
(function(global) {
  'use strict';

  var BP2Edit = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Edit;
  } else if (global) {
    global.BP2Edit = BP2Edit;
  }
})(typeof window !== 'undefined' ? window : this);
