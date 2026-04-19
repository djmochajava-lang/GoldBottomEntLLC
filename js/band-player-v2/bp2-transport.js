/* ============================================
   bp2-transport.js — Web Audio Multi-Stem Synchronized Playback
   Band Player v2.0

   WHAT IT DOES:
     Manages an AudioContext with N AudioBufferSourceNodes for
     synchronized multi-stem playback. Loads all stems in parallel,
     decodes to AudioBuffers, starts all sources at the same reference
     time (50ms lookahead for sync — <20ms drift between stems).
     Applies mixer gains via per-stem GainNodes with 20ms smooth ramp.
     Supports play/pause/seek/playback rate changes.

   WHAT IT OWNS:
     - AudioContext singleton
     - Per-stem: AudioBuffer, BufferSourceNode, GainNode
     - Master GainNode
     - Transport state (playing, offset, playback rate)
     - Event emitter (play, pause, seek, ended, ready, error)

   WHO CALLS IT:
     - bp2-integration.js loads stems and starts transport on Engage
     - bp2-render-stems.js triggers engage/disengage via events
     - bp2-mixer.js state changes → applyMixer() updates GainNodes
     - bp2-practice.js reads AudioContext ref for metronome

   DEPENDENCIES:
     - bp2-mixer.js (reads effectiveGains for gain routing)
     - Web Audio API (browser)
   ============================================ */
(function(global) {
  'use strict';

  var BP2Transport = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Transport;
  } else if (global) {
    global.BP2Transport = BP2Transport;
  }
})(typeof window !== 'undefined' ? window : this);
