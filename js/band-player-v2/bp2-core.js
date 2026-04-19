/* ============================================
   bp2-core.js — Orchestrator, Event Bus, State Container
   Band Player v2.0

   WHAT IT DOES:
     Central hub. Holds all shared state (playlists, songs, currentIndex,
     isPlaying, volume, etc.). Provides a pub/sub event bus so modules
     communicate via events, never importing each other directly.
     Sequences module initialization. Checks auth and determines whether
     to show the onboarding gate or the player.

   WHAT IT OWNS:
     - Event bus: on(event, fn), off(event, fn), emit(event, payload)
     - Shared state: get(key), set(key, value) — auto-emits 'state:key'
     - Firebase refs: db (Firestore), storage (Firebase Storage)
     - Auth context: user, role
     - Init sequence: core → auth check → (gate OR player modules)

   WHO CALLS IT:
     - band-player-v2.html <script> block calls BP2Core.init()
     - Every other bp2-* module calls BP2Core.on/emit/get/set

   DEPENDENCIES:
     - bp2-utils.js (must load first)
   ============================================ */
(function(global) {
  'use strict';

  var BP2Core = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Core;
  } else if (global) {
    global.BP2Core = BP2Core;
  }
})(typeof window !== 'undefined' ? window : this);
