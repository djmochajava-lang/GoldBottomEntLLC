/* ============================================
   bp2-mixer.js — Per-Stem Fader, Mute, Solo State
   Band Player v2.0

   WHAT IT DOES:
     Pure state module — NO DOM, NO Web Audio, NO side effects.
     Tracks fader (0-100), mute (boolean), solo (boolean) per stem
     per song. Computes effective gain considering solo semantics:
     multi-solo is additive, mute overrides solo. Serializes/hydrates
     to localStorage for per-user per-song persistence.

   WHAT IT OWNS:
     - Mixer state: { songId: { faders, muted, soloed } }
     - effectiveGain computation (solo + mute + fader → 0..1)
     - Serialize/hydrate to localStorage
     - Default fader value (80%)
     - Stem name registration

   WHO CALLS IT:
     - bp2-render-stems.js reads state for UI rendering
     - bp2-render-stems.js writes state on fader/mute/solo interaction
     - bp2-transport.js reads effectiveGains to set Web Audio GainNodes
     - bp2-integration.js wires mixer ↔ transport on state changes

   DEPENDENCIES:
     - None (pure module, no imports)
     - Unit testable in Node.js
   ============================================ */
(function(global) {
  'use strict';

  var BP2Mixer = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Mixer;
  } else if (global) {
    global.BP2Mixer = BP2Mixer;
  }
})(typeof window !== 'undefined' ? window : this);
