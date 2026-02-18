/* ============================================
   config.js — Gold Bottom Ent. LLC Site Configuration
   Version: 1.0.0-prototype
   ============================================ */

const SiteConfig = {
  company: {
    legalName: 'Gold Bottom Ent LLC',        // Official LLC filing name (no period)
    name: 'Gold Bottom Ent. LLC',            // Marketing / branding name (with period)
    shortName: 'GBE',
    dba: ['Gold Bottom Entertainment', 'Gold Bottom Enterprise'],  // Official DBA trade names
    tagline: 'Elevating Talent. Building Brands. Creating Legacy.',
    description: 'Talent Management, Creative Services & Enterprise Solutions',
    year: 2026,
    email: '[YOUR BUSINESS EMAIL]',
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

  version: '1.0.0-prototype'
};

if (typeof module !== 'undefined' && module.exports) module.exports = SiteConfig;
