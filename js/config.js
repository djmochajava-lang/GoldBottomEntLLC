/* ============================================
   config.js — Gold Bottom Ent. LLC Site Configuration
   Version: 1.0.0-prototype
   ============================================ */

const SiteConfig = {
  company: {
    legalName: 'Gold Bottom Ent LLC',        // Official LLC filing name (no period)
    name: 'Gold Bottom Ent. LLC',            // Marketing / branding name (with period)
    shortName: 'GBE',
    dba: ['Gold Bottom Enterprise', 'Gold Bottom Entertainment'],  // Official DBA trade names
    tagline: 'Elevating Talent. Building Brands. Creating Legacy.',
    description: 'Talent Management, Creative Services & Enterprise Solutions',
    year: 2026,
    email: 'booking@layoungbandpage.com',
    phone: '[YOUR BUSINESS PHONE]',
    address: '[YOUR BUSINESS ADDRESS]',
    state: 'Maryland',
    ein: '[YOUR EIN HERE]',
    registeredAgent: '[YOUR REGISTERED AGENT]',
    attorney: '[YOUR ATTORNEY]',
    accountant: '[YOUR ACCOUNTANT / CPA]',
    insurance: '[YOUR BUSINESS INSURANCE]'
  },

  social: {
    instagram: '#',
    facebook: '#',
    twitter: '#',
    youtube: '#',
    spotify: '#',
    soundcloud: '#',
    linkedin: '#',
    github: '#'
  },

  integrations: {
    stripe: { publicKey: '[STRIPE API KEY]', connected: false },
    paypal: { clientId: '[PAYPAL CLIENT ID]', connected: false },
    shopify: { storeUrl: '[SHOPIFY STORE URL]', storefrontToken: '[SHOPIFY STOREFRONT TOKEN]', connected: false },
    printful: { apiKey: '[PRINTFUL API KEY]', connected: false },
    square: { appId: '[SQUARE APPLICATION ID]', connected: false },
    quickbooks: { clientId: '[QUICKBOOKS CLIENT ID]', connected: false },
    eventbrite: { apiKey: '[EVENTBRITE API KEY]', connected: false },
    bandsintown: { artistId: '[BANDSINTOWN ARTIST ID]', connected: false },
    googleCalendar: { calendarId: '[GOOGLE CALENDAR ID]', connected: false },
    docusign: { apiKey: '[DOCUSIGN API KEY]', connected: false },
    distrokid: { connected: false },
    spotifyArtists: { uri: '[SPOTIFY ARTIST URI]', connected: false },
    youtubeStudio: { connected: false },
    firebase: {
      apiKey: 'AIzaSyBxdl4Rq11ogyXwhH-2QCKhxB_RnT_bSEk',
      authDomain: 'goldbottoment.firebaseapp.com',
      projectId: 'goldbottoment',
      storageBucket: 'goldbottoment.firebasestorage.app',
      messagingSenderId: '963268881384',
      appId: '1:963268881384:web:2ca6af27366263f23dd25d',
      connected: false
    }
  },

  features: {
    enableShop: false,
    enableBookingForm: true,
    enableAnalytics: false,
    enableNotifications: true,
    enableAuth: true,
    debugMode: false
  },

  /**
   * Role registry — single source of truth for all portal roles.
   * Used by auth.js helpers, team.html, and the portal nav builder.
   *
   * Role hierarchy:
   *   admin        — Site Admin (technical): user management, system settings
   *   band_manager — CEO / Band Manager (business): bookings, contracts, calendar, content
   *   artist       — Principal Artist: schedule view, content approval, contract review
   *   band_member  — Musicians & vocalists in the band: schedule, rehearsal details, set lists, logistics
   *   venue_owner  — Confirmed venue client: own booking details + contract
   *   promoter     — Confirmed promotional client: own engagement + promo materials
   *   member       — Default / unassigned (pending role assignment by admin)
   *
   * A single user account can be assigned multiple roles via the linkedRoles array
   * in their Firestore document (see auth.js _switchRole / _activeRole).
   */
  roles: {
    admin:        { label: 'Site Admin',   icon: 'fa-shield-halved', color: '#58a6ff',  description: 'User management, system settings, technical access' },
    band_manager: { label: 'Band Manager', icon: 'fa-briefcase',     color: '#d4a017',  description: 'Bookings, contracts, calendar, content, artist management' },
    artist:       { label: 'Artist',       icon: 'fa-microphone',    color: '#c778d9',  description: 'Schedule view, content approval, contract review' },
    band_member:  { label: 'Band Member',  icon: 'fa-guitar',        color: '#3fb950',  description: 'Musicians & vocalists: schedule, rehearsal details, set lists, logistics' },
    venue_owner:  { label: 'Venue Owner',  icon: 'fa-building',      color: '#d29922',  description: 'Own booking details, contract, venue logistics' },
    promoter:     { label: 'Promoter',     icon: 'fa-bullhorn',      color: '#f0883e',  description: 'Own engagement details, promo materials, contract' },
    member:       { label: 'Member',       icon: 'fa-user',          color: '#8b949e',  description: 'Default — awaiting role assignment' }
  },

  version: '1.0.0-prototype'
};

if (typeof module !== 'undefined' && module.exports) module.exports = SiteConfig;
