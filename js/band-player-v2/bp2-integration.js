/* ============================================
   bp2-integration.js — Mixer + Practice Wiring Glue
   Band Player v2.0

   WHAT IT DOES:
     Wires the mixer panel, transport, and practice modules together.
     When the user clicks Engage Mixer, this module:
     1. Creates/resumes AudioContext (iOS user-gesture safe)
     2. Loads stems into transport
     3. Applies mixer gains
     4. Starts playback
     Handles fader/mute/solo changes → transport gain updates.
     Handles metronome/loop/speed pad interactions.
     Manages the Engage/Disengage lifecycle.
     Provides mount() for attaching to a host element and
     cleanup() for teardown.

   WHAT IT OWNS:
     - Engage/Disengage state machine
     - iOS AudioContext user-gesture handling
     - Fader change → transport.applyMixer() wiring
     - Speed change → transport.setPlaybackRate() wiring
     - Metronome AudioContext ref → practice module
     - mount() / cleanup() lifecycle

   WHO CALLS IT:
     - bp2-render-stems.js calls mount() after stem panel renders
     - bp2-render-stems.js triggers engage/disengage via events

   DEPENDENCIES:
     - bp2-mixer.js (fader/mute/solo state)
     - bp2-transport.js (Web Audio playback)
     - bp2-practice.js (metronome/loop/speed)
     - bp2-core.js (events)
   ============================================ */
(function(global) {
  'use strict';

  var BP2Integration = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Integration;
  } else if (global) {
    global.BP2Integration = BP2Integration;
  }
})(typeof window !== 'undefined' ? window : this);
