/* ============================================
   bp2-practice.js — Metronome, A/B Loop, Speed Control
   Band Player v2.0

   WHAT IT DOES:
     Metronome: schedules click tones via AudioContext oscillator at
     BPM intervals using lookahead scheduling for timing accuracy.
     A/B Loop: stores marker positions, caller's transport checks
     shouldLoopNow() and seeks back to A when crossing B.
     Speed: 0.5x–1.25x multiplier applied to transport playback rate.
     Auto-stops metronome on page hide/unload.

   WHAT IT OWNS:
     - Metronome state (on/off, BPM, volume, tick scheduling)
     - A/B loop markers and enabled state
     - Bar boundaries for snap-to-bar
     - Speed state and options list
     - Tick event emitter (for visual beat flash)

   WHO CALLS IT:
     - bp2-render-stems.js triggers metronome/loop/speed via pad clicks
     - bp2-transport.js provides AudioContext ref
     - bp2-integration.js wires speed changes to transport rate

   DEPENDENCIES:
     - None (pure state + AudioContext scheduling)
     - AudioContext ref provided by caller, not created here
   ============================================ */
(function(global) {
  'use strict';

  var BP2Practice = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Practice;
  } else if (global) {
    global.BP2Practice = BP2Practice;
  }
})(typeof window !== 'undefined' ? window : this);
