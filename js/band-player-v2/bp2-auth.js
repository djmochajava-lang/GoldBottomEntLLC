/* ============================================
   bp2-auth.js — Musician Onboarding Gate
   Band Player v2.0

   WHAT IT DOES:
     Two-screen onboarding flow that gates access to the player for
     band_member and artist roles. Admin and band_manager skip straight
     to the player.

     Screen 1: Band Confidentiality & Agreement
       - IP ownership, contribution ownership, material confidentiality
       - Checkbox enables Accept button
       - Saves confidentialityAcceptedAt to Firestore users/{uid}
       - Auto-grants default playlists

     Screen 2: Payment Setup & GBE Freelance Musician Agreement
       - 6 payment methods (Direct Deposit, Venmo, Zelle, CashApp, Check, Other)
       - AES-256-GCM encryption of payment fields before Firestore write
       - Bank routing/account sent to HomeOffice server only (never Firestore)
       - Freelance Musician Agreement checkbox
       - W-9 tax info section

     Setup Complete: confirmation screen with Enter Portal button

   WHAT IT OWNS:
     - Screen 1, 2, and Setup Complete DOM rendering
     - Payment method field visibility toggling
     - AES-256-GCM encryption (fetchEncryptionKey, encryptField)
     - Bank details XHR to HomeOffice server
     - Edit mode (returning users updating payment info)

   WHO CALLS IT:
     - bp2-core.js init() checks role + Firestore user doc → delegates here
     - Calls back to bp2-core.js onComplete to init the player

   CRITICAL:
     - Agreement text must be BYTE-IDENTICAL to v1 (legal copy)
     - 34 agreement-copy-preservation tests exist — do not modify copy

   DEPENDENCIES:
     - bp2-core.js (db ref, user, role, onComplete callback)
     - bp2-utils.js (escHtml)
     - crypto.subtle (for AES-256-GCM — requires HTTPS)
   ============================================ */
(function(global) {
  'use strict';

  var BP2Auth = {
    // TODO: implement
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BP2Auth;
  } else if (global) {
    global.BP2Auth = BP2Auth;
  }
})(typeof window !== 'undefined' ? window : this);
