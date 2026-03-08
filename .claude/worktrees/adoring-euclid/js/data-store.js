// js/data-store.js

/**
 * DataStore Module — localStorage-based data layer
 * Full CRUD for all business entities with seed data.
 * Designed for easy migration to a real backend (API swap).
 */

const DataStore = {
  KEYS: {
    ROSTER: 'gbe-roster',
    CONTRACTS: 'gbe-contracts',
    FINANCES_REVENUE: 'gbe-revenue',
    FINANCES_EXPENSES: 'gbe-expenses',
    INVOICES: 'gbe-invoices',
    EVENTS: 'gbe-events',
    BOOKINGS: 'gbe-bookings',
    IP_RIGHTS: 'gbe-ip-rights',
    DOCUMENTS: 'gbe-documents',
    MERCH_PRODUCTS: 'gbe-merch-products',
    MERCH_ORDERS: 'gbe-merch-orders',
    TRAVEL: 'gbe-travel',
    DISTRIBUTION: 'gbe-distribution',
    INTEGRATIONS: 'gbe-integrations',
    SETTINGS: 'gbe-settings',
    CHECKLIST: 'gbe-checklist',
    VENUE_LEADS: 'gbe-venue-leads',
    IT_CREDENTIALS: 'gbe-it-credentials',
    IT_SERVERS: 'gbe-it-servers',
    ACTIVITY: 'gbe-activity',
  },

  init() {
    this.seedIfEmpty();
    console.log('✅ DataStore initialized');
  },

  // ============================================================
  // GENERIC CRUD HELPERS
  // ============================================================

  _getAll(key) {
    return Utils.storage.get(key, []);
  },

  _save(key, data) {
    Utils.storage.set(key, data);
  },

  _getById(key, id) {
    const items = this._getAll(key);
    return items.find((item) => item.id === id) || null;
  },

  _add(key, item) {
    const items = this._getAll(key);
    item.id = item.id || Utils.generateId();
    item.createdAt = item.createdAt || new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    items.push(item);
    this._save(key, items);
    this._logActivity('create', key, item);
    return item;
  },

  _update(key, id, updates) {
    const items = this._getAll(key);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    items[index] = { ...items[index], ...updates, updatedAt: new Date().toISOString() };
    this._save(key, items);
    this._logActivity('update', key, items[index]);
    return items[index];
  },

  _delete(key, id) {
    const items = this._getAll(key);
    const item = items.find((i) => i.id === id);
    const filtered = items.filter((item) => item.id !== id);
    this._save(key, filtered);
    if (item) this._logActivity('delete', key, item);
    return filtered;
  },

  // ============================================================
  // ACTIVITY LOG
  // ============================================================

  _logActivity(action, entityKey, entity) {
    const activities = this._getAll(this.KEYS.ACTIVITY);
    const entityLabels = {
      [this.KEYS.ROSTER]: 'talent',
      [this.KEYS.CONTRACTS]: 'contract',
      [this.KEYS.FINANCES_REVENUE]: 'revenue',
      [this.KEYS.FINANCES_EXPENSES]: 'expense',
      [this.KEYS.INVOICES]: 'invoice',
      [this.KEYS.EVENTS]: 'event',
      [this.KEYS.BOOKINGS]: 'booking',
      [this.KEYS.IP_RIGHTS]: 'IP entry',
      [this.KEYS.MERCH_PRODUCTS]: 'product',
      [this.KEYS.MERCH_ORDERS]: 'order',
      [this.KEYS.TRAVEL]: 'itinerary',
      [this.KEYS.DISTRIBUTION]: 'release',
      [this.KEYS.VENUE_LEADS]: 'venue lead',
      [this.KEYS.IT_CREDENTIALS]: 'credential',
      [this.KEYS.IT_SERVERS]: 'server',
    };

    const label = entityLabels[entityKey] || 'item';
    const name = entity.name || entity.title || entity.description || 'Unknown';

    activities.unshift({
      id: Utils.generateId(),
      action,
      entityType: label,
      entityName: name,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 50 activities
    if (activities.length > 50) activities.length = 50;
    this._save(this.KEYS.ACTIVITY, activities);
  },

  getActivity(limit = 10) {
    return this._getAll(this.KEYS.ACTIVITY).slice(0, limit);
  },

  // ============================================================
  // ROSTER (Talent / Creatives / Developers)
  // ============================================================

  getRoster() { return this._getAll(this.KEYS.ROSTER); },
  getTalent(id) { return this._getById(this.KEYS.ROSTER, id); },
  addTalent(talent) { return this._add(this.KEYS.ROSTER, talent); },
  updateTalent(id, data) { return this._update(this.KEYS.ROSTER, id, data); },
  deleteTalent(id) { return this._delete(this.KEYS.ROSTER, id); },

  getRosterByCategory(category) {
    return this.getRoster().filter((t) => t.category === category);
  },

  getActiveRoster() {
    return this.getRoster().filter((t) => t.status === 'active');
  },

  // ============================================================
  // CONTRACTS
  // ============================================================

  getContracts() { return this._getAll(this.KEYS.CONTRACTS); },
  getContract(id) { return this._getById(this.KEYS.CONTRACTS, id); },
  addContract(contract) { return this._add(this.KEYS.CONTRACTS, contract); },
  updateContract(id, data) { return this._update(this.KEYS.CONTRACTS, id, data); },
  deleteContract(id) { return this._delete(this.KEYS.CONTRACTS, id); },

  getContractsByStatus(status) {
    return this.getContracts().filter((c) => c.status === status);
  },

  getActiveContracts() {
    return this.getContracts().filter((c) => c.status === 'signed' || c.status === 'active');
  },

  // ============================================================
  // FINANCES — Revenue
  // ============================================================

  getRevenue() { return this._getAll(this.KEYS.FINANCES_REVENUE); },
  addRevenue(entry) { return this._add(this.KEYS.FINANCES_REVENUE, entry); },
  updateRevenue(id, data) { return this._update(this.KEYS.FINANCES_REVENUE, id, data); },
  deleteRevenue(id) { return this._delete(this.KEYS.FINANCES_REVENUE, id); },

  getTotalRevenue() {
    return this.getRevenue().reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  },

  // ============================================================
  // FINANCES — Expenses
  // ============================================================

  getExpenses() { return this._getAll(this.KEYS.FINANCES_EXPENSES); },
  addExpense(entry) { return this._add(this.KEYS.FINANCES_EXPENSES, entry); },
  updateExpense(id, data) { return this._update(this.KEYS.FINANCES_EXPENSES, id, data); },
  deleteExpense(id) { return this._delete(this.KEYS.FINANCES_EXPENSES, id); },

  getTotalExpenses() {
    return this.getExpenses().reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  },

  getNetIncome() {
    return this.getTotalRevenue() - this.getTotalExpenses();
  },

  // ============================================================
  // INVOICES
  // ============================================================

  getInvoices() { return this._getAll(this.KEYS.INVOICES); },
  addInvoice(invoice) { return this._add(this.KEYS.INVOICES, invoice); },
  updateInvoice(id, data) { return this._update(this.KEYS.INVOICES, id, data); },
  deleteInvoice(id) { return this._delete(this.KEYS.INVOICES, id); },

  getOutstandingInvoices() {
    return this.getInvoices().filter((i) => i.status === 'sent' || i.status === 'overdue');
  },

  // ============================================================
  // EVENTS / CALENDAR
  // ============================================================

  getEvents() { return this._getAll(this.KEYS.EVENTS); },
  getEvent(id) { return this._getById(this.KEYS.EVENTS, id); },
  addEvent(event) { return this._add(this.KEYS.EVENTS, event); },
  updateEvent(id, data) { return this._update(this.KEYS.EVENTS, id, data); },
  deleteEvent(id) { return this._delete(this.KEYS.EVENTS, id); },

  getUpcomingEvents(limit = 10) {
    const now = new Date().toISOString();
    return this.getEvents()
      .filter((e) => e.date >= now)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, limit);
  },

  getEventsByMonth(year, month) {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    return this.getEvents().filter((e) => e.date.startsWith(prefix));
  },

  // ============================================================
  // BOOKINGS (Pipeline)
  // ============================================================

  getBookings() { return this._getAll(this.KEYS.BOOKINGS); },
  getBooking(id) { return this._getById(this.KEYS.BOOKINGS, id); },
  addBooking(booking) { return this._add(this.KEYS.BOOKINGS, booking); },
  updateBooking(id, data) { return this._update(this.KEYS.BOOKINGS, id, data); },
  deleteBooking(id) { return this._delete(this.KEYS.BOOKINGS, id); },

  getBookingsByStage(stage) {
    return this.getBookings().filter((b) => b.stage === stage);
  },

  // ============================================================
  // IP & RIGHTS
  // ============================================================

  getIPRights() { return this._getAll(this.KEYS.IP_RIGHTS); },
  getIPRight(id) { return this._getById(this.KEYS.IP_RIGHTS, id); },
  addIPRight(entry) { return this._add(this.KEYS.IP_RIGHTS, entry); },
  updateIPRight(id, data) { return this._update(this.KEYS.IP_RIGHTS, id, data); },
  deleteIPRight(id) { return this._delete(this.KEYS.IP_RIGHTS, id); },

  // ============================================================
  // MERCH — Products & Orders
  // ============================================================

  getMerchProducts() { return this._getAll(this.KEYS.MERCH_PRODUCTS); },
  addMerchProduct(product) { return this._add(this.KEYS.MERCH_PRODUCTS, product); },
  updateMerchProduct(id, data) { return this._update(this.KEYS.MERCH_PRODUCTS, id, data); },
  deleteMerchProduct(id) { return this._delete(this.KEYS.MERCH_PRODUCTS, id); },

  getMerchOrders() { return this._getAll(this.KEYS.MERCH_ORDERS); },
  addMerchOrder(order) { return this._add(this.KEYS.MERCH_ORDERS, order); },
  updateMerchOrder(id, data) { return this._update(this.KEYS.MERCH_ORDERS, id, data); },

  getMerchRevenue() {
    return this.getMerchOrders().reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
  },

  // ============================================================
  // TRAVEL
  // ============================================================

  getTravel() { return this._getAll(this.KEYS.TRAVEL); },
  getTrip(id) { return this._getById(this.KEYS.TRAVEL, id); },
  addTrip(trip) { return this._add(this.KEYS.TRAVEL, trip); },
  updateTrip(id, data) { return this._update(this.KEYS.TRAVEL, id, data); },
  deleteTrip(id) { return this._delete(this.KEYS.TRAVEL, id); },

  // ============================================================
  // DISTRIBUTION (Music Releases)
  // ============================================================

  getReleases() { return this._getAll(this.KEYS.DISTRIBUTION); },
  addRelease(release) { return this._add(this.KEYS.DISTRIBUTION, release); },
  updateRelease(id, data) { return this._update(this.KEYS.DISTRIBUTION, id, data); },
  deleteRelease(id) { return this._delete(this.KEYS.DISTRIBUTION, id); },

  // ============================================================
  // DOCUMENTS
  // ============================================================

  getDocuments() { return this._getAll(this.KEYS.DOCUMENTS); },
  addDocument(doc) { return this._add(this.KEYS.DOCUMENTS, doc); },
  updateDocument(id, data) { return this._update(this.KEYS.DOCUMENTS, id, data); },
  deleteDocument(id) { return this._delete(this.KEYS.DOCUMENTS, id); },

  // ============================================================
  // VENUE LEADS
  // ============================================================

  getVenueLeads() { return this._getAll(this.KEYS.VENUE_LEADS); },
  getVenueLead(id) { return this._getById(this.KEYS.VENUE_LEADS, id); },
  addVenueLead(lead) { return this._add(this.KEYS.VENUE_LEADS, lead); },
  updateVenueLead(id, data) { return this._update(this.KEYS.VENUE_LEADS, id, data); },
  deleteVenueLead(id) { return this._delete(this.KEYS.VENUE_LEADS, id); },

  getVenueLeadsByCategory(category) {
    return this.getVenueLeads().filter(function(l) { return l.category === category; });
  },

  getVenueLeadsByStatus(status) {
    return this.getVenueLeads().filter(function(l) { return l.outreachStatus === status; });
  },

  // ============================================================
  // IT CREDENTIALS (Service Accounts & Passwords)
  // ============================================================

  getCredentials() { return this._getAll(this.KEYS.IT_CREDENTIALS); },
  getCredential(id) { return this._getById(this.KEYS.IT_CREDENTIALS, id); },
  addCredential(cred) { return this._add(this.KEYS.IT_CREDENTIALS, cred); },
  updateCredential(id, data) { return this._update(this.KEYS.IT_CREDENTIALS, id, data); },
  deleteCredential(id) { return this._delete(this.KEYS.IT_CREDENTIALS, id); },

  getCredentialsByCategory(category) {
    return this.getCredentials().filter(function(c) { return c.category === category; });
  },

  // ============================================================
  // IT SERVERS & SUBSCRIPTIONS
  // ============================================================

  getServers() { return this._getAll(this.KEYS.IT_SERVERS); },
  getServer(id) { return this._getById(this.KEYS.IT_SERVERS, id); },
  addServer(server) { return this._add(this.KEYS.IT_SERVERS, server); },
  updateServer(id, data) { return this._update(this.KEYS.IT_SERVERS, id, data); },
  deleteServer(id) { return this._delete(this.KEYS.IT_SERVERS, id); },

  getActiveServers() {
    return this.getServers().filter(function(s) { return s.status === 'active'; });
  },

  getTotalMonthlyCost() {
    return this.getActiveServers().reduce(function(sum, s) {
      return sum + (parseFloat(s.monthlyCost) || 0);
    }, 0);
  },

  // ============================================================
  // INTEGRATIONS STATE
  // ============================================================

  getIntegrations() {
    return Utils.storage.get(this.KEYS.INTEGRATIONS, {});
  },

  updateIntegration(service, data) {
    const integrations = this.getIntegrations();
    integrations[service] = { ...integrations[service], ...data, updatedAt: new Date().toISOString() };
    Utils.storage.set(this.KEYS.INTEGRATIONS, integrations);
    return integrations[service];
  },

  // ============================================================
  // SETTINGS
  // ============================================================

  getSettings() {
    return Utils.storage.get(this.KEYS.SETTINGS, {});
  },

  updateSettings(data) {
    const settings = this.getSettings();
    Object.assign(settings, data);
    settings.updatedAt = new Date().toISOString();
    Utils.storage.set(this.KEYS.SETTINGS, settings);
    return settings;
  },

  // ============================================================
  // BUSINESS CHECKLIST
  // ============================================================

  getChecklist() {
    return Utils.storage.get(this.KEYS.CHECKLIST, []);
  },

  updateChecklistItem(id, checked) {
    const checklist = this.getChecklist();
    const item = checklist.find((c) => c.id === id);
    if (item) {
      item.checked = checked;
      item.updatedAt = new Date().toISOString();
      Utils.storage.set(this.KEYS.CHECKLIST, checklist);
    }
    return checklist;
  },

  // ============================================================
  // DASHBOARD METRICS
  // ============================================================

  getMetrics() {
    var isLocal = (typeof Auth !== 'undefined' && Auth.isLocalDashboard && Auth.isLocalDashboard());
    var metrics = {
      rosterCount: this.getActiveRoster().length,
      totalRoster: this.getRoster().length,
      activeContracts: this.getActiveContracts().length,
      totalContracts: this.getContracts().length,
      upcomingEvents: this.getUpcomingEvents(5).length,
      totalBookings: this.getBookings().length,
      ipEntries: this.getIPRights().length,
      totalVenueLeads: this.getVenueLeads().length,
      contactedVenues: this.getVenueLeadsByStatus('contacted').length,
      bookedVenues: this.getVenueLeadsByStatus('booked').length,
    };
    // Financial metrics only on local dashboard
    if (isLocal) {
      metrics.revenueYTD = this.getTotalRevenue();
      metrics.expensesYTD = this.getTotalExpenses();
      metrics.netIncome = this.getNetIncome();
      metrics.merchSales = this.getMerchRevenue();
      metrics.outstandingInvoices = this.getOutstandingInvoices().reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
    }
    return metrics;
  },

  // ============================================================
  // SEED DATA — Pre-populate on first load
  // ============================================================

  seedIfEmpty() {
    var isLocal = (typeof Auth !== 'undefined' && Auth.isLocalDashboard && Auth.isLocalDashboard());

    // Remote tier migration: if remote user has old financial seed data, clear it
    if (!isLocal && !Utils.storage.get('gbe-data-v2')) {
      var sensitiveKeys = [this.KEYS.FINANCES_REVENUE, this.KEYS.FINANCES_EXPENSES,
        this.KEYS.INVOICES, this.KEYS.DOCUMENTS, this.KEYS.SETTINGS, this.KEYS.CHECKLIST];
      sensitiveKeys.forEach(function(key) { Utils.storage.remove(key); });
      Utils.storage.set('gbe-data-v2', 'remote');
      console.log('🔒 DataStore: cleared sensitive data for remote tier');
    }

    // One-time migration: seed venue leads for existing users
    if (!Utils.storage.get(this.KEYS.VENUE_LEADS)) {
      this.seedVenueLeads();
      console.log('🏛️ DataStore: migrated venue leads');
    }

    // One-time migration: seed IT credentials for existing users (local only)
    if (isLocal && !Utils.storage.get(this.KEYS.IT_CREDENTIALS)) {
      this.seedITCredentials();
      console.log('🔑 DataStore: migrated IT credentials');
    }

    // One-time migration: seed IT servers for existing users
    if (!Utils.storage.get(this.KEYS.IT_SERVERS)) {
      this.seedITServers();
      console.log('🖥️ DataStore: migrated IT servers');
    }

    if (Utils.storage.get(this.KEYS.ROSTER)) {
      console.log('📦 DataStore: existing data found');
      return;
    }

    console.log('🌱 DataStore: seeding initial data (' + (isLocal ? 'full' : 'remote-safe') + ')...');

    // Both tiers — non-sensitive data
    this.seedRoster();
    this.seedContracts();
    this.seedEvents();
    this.seedBookings();
    this.seedIPRights();
    this.seedMerch();
    this.seedTravel();
    this.seedDistribution();
    this.seedVenueLeads();
    this.seedITServers();
    this.seedActivity();

    // Local-only — financial and sensitive config data
    if (isLocal) {
      this.seedFinances();
      this.seedDocuments();
      this.seedSettings();
      this.seedChecklist();
      this.seedITCredentials();
    }

    console.log('✅ DataStore: seed complete');
  },

  seedRoster() {
    this._save(this.KEYS.ROSTER, [
      {
        id: 'talent-001',
        name: 'L.A. Young',
        category: 'artist',
        genre: 'Soul / Jazz / Blues / R&B',
        status: 'active',
        email: 'layoung@goldbottom-ent.com',
        phone: '[PHONE]',
        bio: 'International soul artist, Phyllis Hyman tribute performer. #1 UK FM Radio, 5 Top-5 UK hits, Maryland Artist of Year 2018.',
        website: '../LAYoungBandPage/index.html',
        contractStart: '2025-01-15',
        contractEnd: '2027-12-31',
        commission: 15,
        image: '',
        // Performance & Logistics (from Booking Agent Requirements)
        rateType: 'flat',
        standardRate: 0,
        minimumRate: 0,
        depositPercent: 30,
        travelRadius: 'National',
        availabilityStatus: 'available',
        riderNeeds: '[RIDER REQUIREMENTS — e.g. sound system, green room, meals]',
        noGoZones: '[ANY RESTRICTIONS — e.g. outdoor events without covered stage]',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'talent-002',
        name: '[Artist Name]',
        category: 'artist',
        genre: 'Hip-Hop / R&B',
        status: 'prospect',
        email: '[EMAIL]',
        phone: '[PHONE]',
        bio: '[Placeholder — Add artist bio here]',
        website: '',
        contractStart: '',
        contractEnd: '',
        commission: 15,
        image: '',
        rateType: 'flat',
        standardRate: 0,
        minimumRate: 0,
        depositPercent: 30,
        travelRadius: '',
        availabilityStatus: 'available',
        riderNeeds: '',
        noGoZones: '',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
      {
        id: 'talent-003',
        name: '[Creative Name]',
        category: 'creative',
        genre: 'Graphic Design / Video Production',
        status: 'prospect',
        email: '[EMAIL]',
        phone: '[PHONE]',
        bio: '[Placeholder — Add creative professional bio here]',
        website: '',
        contractStart: '',
        contractEnd: '',
        commission: 10,
        image: '',
        rateType: 'hourly',
        standardRate: 0,
        minimumRate: 0,
        depositPercent: 0,
        travelRadius: 'Local Only',
        availabilityStatus: 'available',
        riderNeeds: '',
        noGoZones: '',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
      {
        id: 'talent-004',
        name: '[Developer Name]',
        category: 'developer',
        genre: 'Full-Stack / Web / Mobile',
        status: 'prospect',
        email: '[EMAIL]',
        phone: '[PHONE]',
        bio: '[Placeholder — Add developer bio here]',
        website: '',
        contractStart: '',
        contractEnd: '',
        commission: 10,
        image: '',
        rateType: 'hourly',
        standardRate: 0,
        minimumRate: 0,
        depositPercent: 0,
        travelRadius: 'Remote',
        availabilityStatus: 'available',
        riderNeeds: '',
        noGoZones: '',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
    ]);
  },

  seedContracts() {
    this._save(this.KEYS.CONTRACTS, [
      {
        id: 'contract-001',
        name: 'L.A. Young — Artist Management Agreement',
        type: 'management',
        parties: 'Gold Bottom Ent LLC / L.A. Young',
        status: 'signed',
        startDate: '2025-01-15',
        endDate: '2027-12-31',
        value: 0,
        commission: 15,
        notes: 'Full artist management — booking, branding, distribution, touring.',
        talentId: 'talent-001',
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      },
      {
        id: 'contract-002',
        name: 'Venue Booking — [Venue Name]',
        type: 'booking',
        parties: 'Gold Bottom Ent LLC / [Venue Name]',
        status: 'draft',
        startDate: '2026-06-15',
        endDate: '2026-06-15',
        value: 0,
        commission: 15,
        notes: '[SAMPLE] Edit with your actual booking contract details.',
        talentId: 'talent-001',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
      {
        id: 'contract-003',
        name: 'Web Development — [Client Project]',
        type: 'development',
        parties: 'Gold Bottom Ent LLC / [Client Name]',
        status: 'draft',
        startDate: '2026-03-01',
        endDate: '2026-05-31',
        value: 0,
        commission: 0,
        notes: '[SAMPLE] Edit with your actual development contract details.',
        talentId: '',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
    ]);
  },

  seedFinances() {
    this._save(this.KEYS.FINANCES_REVENUE, [
      { id: 'rev-001', date: '2026-01-15', source: 'Performance — [Venue Name]', amount: 0, category: 'booking', talentId: 'talent-001', notes: '[SAMPLE] Edit with your actual revenue', createdAt: '2026-01-15T00:00:00Z', updatedAt: '2026-01-15T00:00:00Z' },
      { id: 'rev-002', date: '2026-02-01', source: 'Music Streaming Royalties', amount: 0, category: 'royalties', talentId: 'talent-001', notes: '[SAMPLE] Edit with your actual streaming income', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);

    this._save(this.KEYS.FINANCES_EXPENSES, [
      { id: 'exp-001', date: '2026-01-10', description: 'Website Hosting (Annual)', amount: 0, category: 'operations', vendor: '[Hosting Provider]', notes: '[SAMPLE] Edit with actual amount', createdAt: '2026-01-10T00:00:00Z', updatedAt: '2026-01-10T00:00:00Z' },
      { id: 'exp-002', date: '2026-01-20', description: 'Studio Session — Recording', amount: 0, category: 'production', vendor: '[Studio Name]', notes: '[SAMPLE] Edit with actual amount', createdAt: '2026-01-20T00:00:00Z', updatedAt: '2026-01-20T00:00:00Z' },
      { id: 'exp-003', date: '2026-02-01', description: 'LLC Annual Filing Fee', amount: 0, category: 'legal', vendor: 'State of Maryland', notes: '[SAMPLE] Edit with actual amount', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);

    this._save(this.KEYS.INVOICES, [
      { id: 'inv-001', invoiceNumber: 'GBE-2026-001', client: '[Client Name]', amount: 0, status: 'draft', dueDate: '2026-06-01', description: '[SAMPLE] Edit with your actual invoice', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);
  },

  seedEvents() {
    this._save(this.KEYS.EVENTS, [
      { id: 'evt-001', title: 'L.A. Young — [Venue Name]', date: '2026-06-15T20:00:00', endDate: '2026-06-15T23:00:00', type: 'gig', venue: '[Venue, City]', notes: '[SAMPLE] Edit with your actual event', color: '#d4a017', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
      { id: 'evt-002', title: 'Studio Session', date: '2026-03-10T14:00:00', endDate: '2026-03-10T18:00:00', type: 'studio', venue: '[Studio Name]', notes: '[SAMPLE] Edit with your actual session details', color: '#58a6ff', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
      { id: 'evt-003', title: 'Quarterly Tax Deadline', date: '2026-04-15T00:00:00', endDate: '', type: 'deadline', venue: '', notes: 'Q1 estimated tax payment due', color: '#f85149', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
      { id: 'evt-004', title: 'Networking Event', date: '2026-05-20T18:00:00', endDate: '2026-05-20T21:00:00', type: 'meeting', venue: '[Event Location]', notes: '[SAMPLE] Edit with your actual event', color: '#3fb950', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);
  },

  seedBookings() {
    this._save(this.KEYS.BOOKINGS, [
      {
        id: 'book-001', name: '[Sample] Venue Show', venue: '[Venue Name, City]', date: '2026-06-15', artist: 'L.A. Young',
        stage: 'confirmed', value: 0, deposit: 0, depositPaid: false,
        // Intake fields (from Booking Agent Requirements)
        eventType: 'bar-club', guestCount: 0, hoursNeeded: 3, indoorOutdoor: 'indoor',
        budgetRange: 'Let\'s Discuss', soundSystem: 'yes', riderMet: 'pending', referralSource: '',
        // Post-event
        rating: 0, rebook: false, outcome: '',
        // Contact
        contactName: '[Venue Contact]', contactEmail: '[EMAIL]', contactPhone: '[PHONE]',
        notes: '[SAMPLE] Edit with your actual booking details.',
        createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
      },
      {
        id: 'book-002', name: '[Sample] Corporate Event', venue: '[Client TBD]', date: '2026-12-10', artist: 'L.A. Young',
        stage: 'lead', value: 0, deposit: 0, depositPaid: false,
        eventType: 'corporate', guestCount: 0, hoursNeeded: 3, indoorOutdoor: 'indoor',
        budgetRange: 'Let\'s Discuss', soundSystem: 'not-sure', riderMet: 'na', referralSource: '',
        rating: 0, rebook: false, outcome: '',
        contactName: '', contactEmail: '', contactPhone: '',
        notes: '[SAMPLE] Edit with your actual booking details.',
        createdAt: '2026-02-10T00:00:00Z', updatedAt: '2026-02-10T00:00:00Z',
      },
    ]);
  },

  seedIPRights() {
    this._save(this.KEYS.IP_RIGHTS, [
      { id: 'ip-001', title: '[Song Title]', type: 'recording', artist: 'L.A. Young', writers: '[Writer Names]', owners: 'Gold Bottom Ent LLC', ownershipPct: 100, registrationStatus: 'pending', registrationNumber: '[PENDING]', pro: '[BMI/ASCAP/SESAC]', notes: '[SAMPLE] Edit with your actual IP details. Register with copyright.gov.', createdAt: '2025-06-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'ip-002', title: '[Website Name]', type: 'software', artist: '', writers: '[Developer Name]', owners: 'Gold Bottom Ent LLC', ownershipPct: 100, registrationStatus: 'registered', registrationNumber: '[N/A — Copyright by creation]', pro: '', notes: '[SAMPLE] Website code and design — work for hire.', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
      { id: 'ip-003', title: '[New Song Title]', type: 'song', artist: 'L.A. Young', writers: '[Writer Names]', owners: 'Gold Bottom Ent LLC / [Co-owners]', ownershipPct: 50, registrationStatus: 'not-registered', registrationNumber: '', pro: '', notes: '[Placeholder — Register with copyright.gov and your PRO]', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);
  },

  seedDocuments() {
    this._save(this.KEYS.DOCUMENTS, [
      { id: 'doc-001', name: 'Articles of Organization', category: 'formation', status: 'received', fileName: 'Articles-of-Organization_SDAT-Acknowledgement_2026-01-19.pdf', notes: 'Filed 1/19/2026, acknowledged 2/18/2026. SDAT ID: W26910547. Filing #5000000012515994. Stored in business-docs/01-Formation-Legal/.', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-18T00:00:00Z' },
      { id: 'doc-002', name: 'EIN Confirmation Letter (SS-4)', category: 'formation', status: 'missing', fileName: '', notes: '[UPLOAD YOUR EIN CONFIRMATION FROM IRS]', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'doc-003', name: 'Operating Agreement', category: 'formation', status: 'missing', fileName: '', notes: '[UPLOAD YOUR OPERATING AGREEMENT]', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'doc-004', name: 'Business Insurance Policy', category: 'insurance', status: 'missing', fileName: '', notes: '[UPLOAD YOUR INSURANCE CERTIFICATE]', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'doc-005', name: 'Registered Agent Info', category: 'compliance', status: 'received', fileName: '', notes: 'Northwest Registered Agent Service, Inc. — 5000 Thayer Ctr, Oakland MD 21550. Confirmed on Articles of Organization.', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-18T00:00:00Z' },
      { id: 'doc-006', name: 'State Annual Report', category: 'compliance', status: 'missing', fileName: '', notes: '[DUE DATE: Check your state requirements]', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'doc-007', name: 'W-9 Form', category: 'tax', status: 'missing', fileName: '', notes: '[YOUR COMPLETED W-9]', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'doc-008', name: 'Beneficial Ownership Report (BOI)', category: 'compliance', status: 'missing', fileName: '', notes: '[FILE WITH FinCEN — fincen.gov/boi]', required: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]);
  },

  seedMerch() {
    this._save(this.KEYS.MERCH_PRODUCTS, [
      { id: 'merch-001', name: 'GBE Logo T-Shirt', price: 29.99, category: 'apparel', status: 'active', inventory: 0, printOnDemand: true, shopifyId: '', image: '', description: 'Gold Bottom Ent branded tee — print on demand via Printful', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
      { id: 'merch-002', name: 'L.A. Young — Vinyl Record', price: 24.99, category: 'music', status: 'coming-soon', inventory: 0, printOnDemand: false, shopifyId: '', image: '', description: '"No One Can Love You More" limited pressing', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);
    this._save(this.KEYS.MERCH_ORDERS, []);
  },

  seedTravel() {
    this._save(this.KEYS.TRAVEL, [
      { id: 'trip-001', name: '[Sample] Venue Show — [City]', date: '2026-06-14', returnDate: '2026-06-16', city: '[City, State]', venue: '[Venue Name]', hotel: '[HOTEL TBD]', flight: 'N/A', perDiem: 0, totalBudget: 0, expenses: [], checklist: ['Confirm hotel', 'Arrange equipment transport', 'Confirm sound check time'], notes: '[SAMPLE] Edit with your actual travel details', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);
  },

  seedDistribution() {
    this._save(this.KEYS.DISTRIBUTION, [
      { id: 'rel-001', title: '[Song Title]', artist: 'L.A. Young', type: 'single', releaseDate: '2024-01-01', distributor: 'Self-Distributed', status: 'released', platforms: ['Spotify', 'Apple Music', 'YouTube Music', 'Amazon Music', 'Tidal'], isrc: '[YOUR ISRC CODE — register at usisrc.org]', upc: '[YOUR UPC CODE — purchase at gs1us.org]', spotifyUrl: '[SPOTIFY URL]', appleMusicUrl: '[APPLE MUSIC URL]', royaltyIncome: 0, roadmapSteps: [false,false,false,false,false,false,false,false,false,false,false,false,false,false], notes: '[SAMPLE] DIY release — register your own ISRC at usisrc.org and purchase UPC from GS1 US. Edit with your actual release details.', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);
  },

  seedVenueLeads() {
    this._save(this.KEYS.VENUE_LEADS, [
      // ── Restaurants (8) ──
      { id: 'vl-001', name: 'JoJo Restaurant & Bar', category: 'restaurant', city: 'Washington', state: 'DC', capacity: '150', website: 'https://www.jojorestaurantdc.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Upscale dining with live entertainment. Located in U Street corridor.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-002', name: 'Blues Alley', category: 'restaurant', city: 'Washington', state: 'DC', capacity: '125', website: 'https://www.bluesalley.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Legendary Georgetown jazz supper club. Premier jazz venue since 1965.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-003', name: 'City Winery DC', category: 'restaurant', city: 'Washington', state: 'DC', capacity: '300', website: 'https://citywinery.com/washington-dc', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Winery, restaurant & concert venue at The Wharf. Intimate seated shows.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-004', name: 'The Hamilton Live', category: 'restaurant', city: 'Washington', state: 'DC', capacity: '400', website: 'https://www.thehamiltondc.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Restaurant & performance space near the White House. Diverse live music lineup nightly.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-005', name: '219 Restaurant', category: 'restaurant', city: 'Alexandria', state: 'VA', capacity: '150', website: 'https://www.219restaurant.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Old Town Alexandria. Upscale dining with live jazz & blues.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-006', name: 'Bethesda Blues & Jazz', category: 'restaurant', city: 'Bethesda', state: 'MD', capacity: '200', website: 'https://www.bethesdabluesjazz.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Dedicated jazz & blues supper club in downtown Bethesda.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-007', name: 'Clyde\'s Restaurant Group', category: 'restaurant', city: 'Various', state: 'DMV', capacity: '200', website: 'https://www.clydes.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Multiple upscale locations across DMV. Hosts live music at select venues.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-008', name: 'Hen Quarter', category: 'restaurant', city: 'Alexandria', state: 'VA', capacity: '175', website: 'https://www.henquarter.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Southern cuisine with live music. Old Town Alexandria & other locations.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },

      // ── Theaters & Performance Venues (9) ──
      { id: 'vl-009', name: 'The Birchmere', category: 'theater', city: 'Alexandria', state: 'VA', capacity: '500', website: 'https://www.birchmere.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Legendary listening room. National touring acts plus regional artists.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-010', name: 'Kennedy Center — Millennium Stage', category: 'theater', city: 'Washington', state: 'DC', capacity: '400', website: 'https://www.kennedy-center.org', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Free daily performances on the Millennium Stage. Apply through their artist submission process.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-011', name: 'The Howard Theatre', category: 'theater', city: 'Washington', state: 'DC', capacity: '650', website: 'https://www.thehowardtheatre.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Historic U Street venue. Recently restored. R&B, soul, and jazz programming.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-012', name: 'Strathmore — Music Center', category: 'theater', city: 'North Bethesda', state: 'MD', capacity: '1976', website: 'https://www.strathmore.org', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'World-class concert hall. Hosts jazz, classical, and pop. Multiple venue sizes.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-013', name: 'Wolf Trap', category: 'theater', city: 'Vienna', state: 'VA', capacity: '7000', website: 'https://www.wolftrap.org', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'National Park for the Performing Arts. The Barns (smaller indoor venue) seats 382.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-014', name: 'The Anthem', category: 'theater', city: 'Washington', state: 'DC', capacity: '6000', website: 'https://www.theanthemdc.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'low', lastContact: '', notes: 'Major concert venue at The Wharf. Adjustable capacity. Book through Live Nation/I.M.P.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-015', name: 'Rams Head On Stage', category: 'theater', city: 'Annapolis', state: 'MD', capacity: '350', website: 'https://www.ramsheadonstage.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Intimate dinner-theater format. Strong R&B/soul/jazz bookings.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-016', name: 'Creative Alliance', category: 'theater', city: 'Baltimore', state: 'MD', capacity: '250', website: 'https://www.creativealliance.org', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Highlandtown arts venue. Eclectic programming. Community-focused.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-017', name: 'Hylton Performing Arts Center', category: 'theater', city: 'Manassas', state: 'VA', capacity: '1129', website: 'https://www.hyltoncenter.org', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'George Mason University venue. Multiple performance spaces.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },

      // ── Corporate / Gala Venues (6) ──
      { id: 'vl-018', name: 'Gaylord National Resort', category: 'corporate', city: 'National Harbor', state: 'MD', capacity: '2000', website: 'https://www.marriott.com/hotels/travel/wasgn-gaylord-national-resort-and-convention-center', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Major convention center & resort. Corporate galas, holiday events, large-scale entertainment.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-019', name: 'The Ritz-Carlton, Tysons Corner', category: 'corporate', city: 'McLean', state: 'VA', capacity: '500', website: 'https://www.ritzcarlton.com/en/hotels/iadrc-the-ritz-carlton-tysons-corner', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Luxury hotel. Corporate events, galas, and private entertainment.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-020', name: 'Four Seasons Georgetown', category: 'corporate', city: 'Washington', state: 'DC', capacity: '350', website: 'https://www.fourseasons.com/washington', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Luxury hotel. Private events, corporate dinners, and VIP entertainment.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-021', name: 'MGM National Harbor', category: 'corporate', city: 'Oxon Hill', state: 'MD', capacity: '3000', website: 'https://www.mgmnationalharbor.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Casino resort with theater and event spaces. National touring acts and private events.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-022', name: 'National Museum of Women in the Arts', category: 'corporate', city: 'Washington', state: 'DC', capacity: '400', website: 'https://nmwa.org', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Museum event space. Galas, fundraisers, and cultural events with live entertainment.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-023', name: 'Ronald Reagan Building', category: 'corporate', city: 'Washington', state: 'DC', capacity: '5000', website: 'https://www.rrbitc.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Iconic DC event venue. International Trade Center. Galas, inaugurals, corporate events.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },

      // ── Wedding / Event Venues (5) ──
      { id: 'vl-024', name: 'Salamander Resort & Spa', category: 'wedding', city: 'Middleburg', state: 'VA', capacity: '500', website: 'https://www.salamanderresort.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Luxury resort in Virginia wine country. Weddings, corporate retreats, galas.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-025', name: 'Decatur House', category: 'wedding', city: 'Washington', state: 'DC', capacity: '300', website: 'https://www.decaturhouse.org', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Historic venue on Lafayette Square. Weddings and upscale private events.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-026', name: 'The Fillmore Silver Spring', category: 'wedding', city: 'Silver Spring', state: 'MD', capacity: '2000', website: 'https://www.fillmoresilverspring.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Live Nation venue. Available for private events and weddings on select dates.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-027', name: 'Newton White Mansion', category: 'wedding', city: 'Mitchellville', state: 'MD', capacity: '250', website: 'https://www.pgparks.com/3040/Newton-White-Mansion', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Prince George\'s County historic estate. Weddings, receptions, and private events.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-028', name: 'Oxon Hill Manor', category: 'wedding', city: 'Oxon Hill', state: 'MD', capacity: '300', website: 'https://www.pgparks.com/3035/Oxon-Hill-Manor', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'medium', lastContact: '', notes: 'Georgian Revival mansion overlooking the Potomac. Weddings, galas, corporate events.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },

      // ── Talent Agencies / Booking Partners (3) ──
      { id: 'vl-029', name: 'Washington Talent Agency', category: 'agency', city: 'Washington', state: 'DC', capacity: '', website: 'https://www.washingtontalent.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'DMV\'s largest event entertainment agency. Books acts for corporate events, weddings, galas.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-030', name: 'Extraordinary Entertainment', category: 'agency', city: 'Rockville', state: 'MD', capacity: '', website: 'https://www.extraordinaryentertainment.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'high', lastContact: '', notes: 'Full-service entertainment agency. Weddings, corporate, private events across DMV.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'vl-031', name: 'Live Nation — DC Market', category: 'agency', city: 'Washington', state: 'DC', capacity: '', website: 'https://www.livenation.com', contactName: '', contactEmail: '', contactPhone: '', outreachStatus: 'not-contacted', priority: 'low', lastContact: '', notes: 'Major promoter. Books The Anthem, Fillmore, Merriweather. Long-term relationship target.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
    ]);
  },

  seedITCredentials() {
    this._save(this.KEYS.IT_CREDENTIALS, [
      { id: 'cred-001', name: 'GitHub', category: 'hosting', loginUrl: 'https://github.com/login', username: '[YOUR GITHUB USERNAME]', password: '[YOUR PASSWORD]', apiKey: '', notes: 'Main repo: GoldBottomEntLLC. GitHub Pages deployment. Workflows in .github/workflows/static.yml.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'cred-002', name: 'Firebase Console', category: 'database', loginUrl: 'https://console.firebase.google.com/', username: '[YOUR GOOGLE EMAIL]', password: '[GOOGLE ACCOUNT]', apiKey: '[SEE js/config.js firebaseConfig]', notes: 'Project: goldbottoment. Auth (Google/Apple/Microsoft) + Firestore (users, contact_submissions, booking_requests).', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'cred-003', name: 'DigitalOcean', category: 'hosting', loginUrl: 'https://cloud.digitalocean.com/login', username: '[YOUR EMAIL]', password: '[YOUR PASSWORD]', apiKey: '', notes: 'Backend hosting. Droplet for API server and Listmonk email service.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'cred-004', name: 'Domain Registrar', category: 'hosting', loginUrl: '[YOUR REGISTRAR URL]', username: '[YOUR USERNAME]', password: '[YOUR PASSWORD]', apiKey: '', notes: 'Domain name management and DNS settings. CNAME to GitHub Pages.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'cred-005', name: 'Listmonk (Email)', category: 'email', loginUrl: '[YOUR LISTMONK URL]/admin', username: 'admin', password: '[YOUR PASSWORD]', apiKey: '', notes: 'Self-hosted email marketing on DigitalOcean. Subscriber lists and campaigns.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'cred-006', name: 'Home Server (LAN)', category: 'server', loginUrl: 'http://[YOUR-LAN-IP]:3000', username: 'PIN Auth', password: '[PIN from server/.env]', apiKey: '[API KEY from server/.env]', notes: 'Node.js/Express on home network. SQLite database. PIN: GBE_DASHBOARD_PIN in server/.env.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'cred-007', name: 'Shopify', category: 'ecommerce', loginUrl: 'https://[YOUR-STORE].myshopify.com/admin', username: '[YOUR EMAIL]', password: '[YOUR PASSWORD]', apiKey: '[STOREFRONT TOKEN]', notes: 'Merch storefront. Printful integration for print-on-demand fulfillment.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'cred-008', name: 'Stripe', category: 'payments', loginUrl: 'https://dashboard.stripe.com', username: '[YOUR EMAIL]', password: '[YOUR PASSWORD]', apiKey: '[PUBLISHABLE KEY]', notes: 'Payment processing for online sales. Connect to Shopify and direct payments.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
    ]);
  },

  seedITServers() {
    this._save(this.KEYS.IT_SERVERS, [
      { id: 'srv-001', name: 'GitHub Pages', provider: 'GitHub', category: 'hosting', purpose: 'Public website hosting — GBE corporate site + L.A. Young band page', url: 'https://djmochajava-lang.github.io/GoldBottomEntLLC/', ip: '', status: 'active', monthlyCost: 0, billingCycle: 'free', renewalDate: '', notes: 'Free tier. Auto-deploys from master branch via GitHub Actions (.github/workflows/static.yml).', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'srv-002', name: 'Home Server', provider: 'Self-Hosted', category: 'server', purpose: 'Local API server — Express + SQLite, PIN auth, full dashboard access', url: 'http://[YOUR-LAN-IP]:3000', ip: '[YOUR-LAN-IP]', status: 'active', monthlyCost: 0, billingCycle: 'free', renewalDate: '', notes: 'Node.js on home LAN. WAL-mode SQLite. PM2 process manager in production. server/ directory.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'srv-003', name: 'DigitalOcean Droplet', provider: 'DigitalOcean', category: 'hosting', purpose: 'Remote backend — API endpoints + Listmonk email service', url: '[YOUR DROPLET URL]', ip: '[YOUR DROPLET IP]', status: 'active', monthlyCost: 0, billingCycle: 'monthly', renewalDate: '', notes: 'Ubuntu droplet. Hosts Listmonk self-hosted email + remote API. Update cost when active.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'srv-004', name: 'Firebase', provider: 'Google', category: 'database', purpose: 'Authentication (Google/Apple/Microsoft sign-in) + Firestore database', url: 'https://console.firebase.google.com', ip: '', status: 'active', monthlyCost: 0, billingCycle: 'free', renewalDate: '', notes: 'Spark (free) plan. Project: goldbottoment. Collections: users, contact_submissions, booking_requests.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'srv-005', name: 'Domain Name', provider: '[Registrar]', category: 'domain', purpose: 'Primary domain name — DNS to GitHub Pages', url: '[YOUR DOMAIN]', ip: '', status: 'active', monthlyCost: 0, billingCycle: 'annual', renewalDate: '[RENEWAL DATE]', notes: 'DNS configured with CNAME to GitHub Pages. Update with actual registrar and cost.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
      { id: 'srv-006', name: 'Shopify Store', provider: 'Shopify', category: 'ecommerce', purpose: 'Merch storefront + Printful print-on-demand fulfillment', url: '[YOUR STORE URL]', ip: '', status: 'planned', monthlyCost: 0, billingCycle: 'monthly', renewalDate: '', notes: 'Not yet active. Will host merchandise with print-on-demand via Printful. Update plan cost when activated.', createdAt: '2026-02-20T00:00:00Z', updatedAt: '2026-02-20T00:00:00Z' },
    ]);
  },

  seedSettings() {
    Utils.storage.set(this.KEYS.SETTINGS, {
      companyName: 'Gold Bottom Ent LLC',
      dba1: 'Gold Bottom Entertainment',
      dba2: 'Gold Bottom Enterprise',
      ein: '[YOUR EIN HERE — apply at irs.gov]',
      sdatId: 'W26910547',
      stateOfFormation: 'Maryland',
      registeredAgent: 'Northwest Registered Agent Service, Inc. — 5000 Thayer Ctr, Oakland MD 21550',
      attorney: '[YOUR ATTORNEY]',
      accountant: '[YOUR ACCOUNTANT / CPA]',
      insurance: '[YOUR BUSINESS INSURANCE]',
      bankName: '[BANK NAME]',
      ownerName: 'Jeffery Ponder, CISSP',
      ownerEmail: '[YOUR EMAIL]',
      ownerPhone: '[YOUR PHONE]',
      notifyEmail: true,
      notifyDashboard: true,
      updatedAt: new Date().toISOString(),
    });
  },

  seedChecklist() {
    Utils.storage.set(this.KEYS.CHECKLIST, [
      // Formation & Legal
      { id: 'chk-001', category: 'Formation & Legal', label: 'Filed Articles of Organization', checked: true },
      { id: 'chk-002', category: 'Formation & Legal', label: 'Received EIN from IRS', checked: true },
      { id: 'chk-003', category: 'Formation & Legal', label: 'Drafted Operating Agreement', checked: false },
      { id: 'chk-004', category: 'Formation & Legal', label: 'Filed Beneficial Ownership Report (FinCEN BOI)', checked: false },
      { id: 'chk-005', category: 'Formation & Legal', label: 'Obtained Business Insurance (General Liability + E&O)', checked: false },
      { id: 'chk-006', category: 'Formation & Legal', label: 'Retained Business Attorney', checked: false },
      { id: 'chk-007', category: 'Formation & Legal', label: 'Retained CPA / Accountant', checked: false },
      { id: 'chk-007a', category: 'Formation & Legal', label: 'Filed DBA registrations (Gold Bottom Enterprise, Gold Bottom Entertainment)', checked: false },
      // Banking & Finance
      { id: 'chk-008', category: 'Banking & Finance', label: 'Opened Business Bank Account', checked: false },
      { id: 'chk-009', category: 'Banking & Finance', label: 'Set Up Accounting System (QuickBooks, Wave, etc.)', checked: false },
      { id: 'chk-010', category: 'Banking & Finance', label: 'Connected Payment Processor (Stripe / PayPal Business)', checked: false },
      { id: 'chk-011', category: 'Banking & Finance', label: 'Registered with State Tax Authority', checked: false },
      { id: 'chk-012', category: 'Banking & Finance', label: 'Set Up Quarterly Estimated Tax Reminders', checked: false },
      { id: 'chk-013', category: 'Banking & Finance', label: 'Set Up Payroll System (if hiring W-2 employees)', checked: false },
      // Music Industry
      { id: 'chk-014', category: 'Music Industry', label: 'Registered with BMI / ASCAP / SESAC (PRO)', checked: false },
      { id: 'chk-015', category: 'Music Industry', label: 'Registered with SoundExchange (digital royalties)', checked: false },
      { id: 'chk-016', category: 'Music Industry', label: 'Set up DIY distribution accounts on all major platforms (Spotify, Apple, YouTube, Amazon, etc.)', checked: false },
      { id: 'chk-017', category: 'Music Industry', label: 'Claimed Spotify for Artists profile', checked: false },
      { id: 'chk-018', category: 'Music Industry', label: 'Claimed YouTube Studio / Apple Music for Artists', checked: false },
      { id: 'chk-018a', category: 'Music Industry', label: 'Registered as ISRC registrant at usisrc.org (one-time ~$95, then assign unlimited codes)', checked: false },
      { id: 'chk-018b', category: 'Music Industry', label: 'Purchased UPC barcodes from GS1 US for all releases (gs1us.org)', checked: false },
      // Ecommerce & Merch
      { id: 'chk-019', category: 'Ecommerce & Merch', label: 'Set Up Shopify Store (or alternative)', checked: false },
      { id: 'chk-020', category: 'Ecommerce & Merch', label: 'Connected Printful (print-on-demand) or fulfillment', checked: false },
      { id: 'chk-021', category: 'Ecommerce & Merch', label: 'Set Up Square POS (for live event sales)', checked: false },
      // Online Presence
      { id: 'chk-022', category: 'Online Presence', label: 'Registered Domain Name', checked: false },
      { id: 'chk-023', category: 'Online Presence', label: 'Created Business Email', checked: false },
      { id: 'chk-024', category: 'Online Presence', label: 'Set Up Social Media Accounts (Business pages)', checked: false },
      { id: 'chk-025', category: 'Online Presence', label: 'Connected Google Business Profile', checked: false },
      // Contracts & Operations
      { id: 'chk-026', category: 'Contracts & Operations', label: 'Created Contract Templates (management, booking, dev)', checked: false },
      { id: 'chk-027', category: 'Contracts & Operations', label: 'Set Up E-Signature Service (DocuSign / HelloSign)', checked: false },
      { id: 'chk-028', category: 'Contracts & Operations', label: 'Created Booking Request Form', checked: false },
      { id: 'chk-029', category: 'Contracts & Operations', label: 'Created Media Kit / EPK', checked: true },
    ]);
  },

  seedActivity() {
    this._save(this.KEYS.ACTIVITY, [
      { id: 'act-001', action: 'create', entityType: 'talent', entityName: 'L.A. Young', timestamp: '2025-01-15T00:00:00Z' },
      { id: 'act-002', action: 'create', entityType: 'contract', entityName: 'L.A. Young — Artist Management Agreement', timestamp: '2025-01-15T00:00:00Z' },
      { id: 'act-003', action: 'create', entityType: 'IP entry', entityName: '[Song Title]', timestamp: '2025-06-01T00:00:00Z' },
      { id: 'act-004', action: 'create', entityType: 'revenue', entityName: 'Performance — [Venue Name]', timestamp: '2026-01-15T00:00:00Z' },
      { id: 'act-005', action: 'create', entityType: 'booking', entityName: '[Sample] Venue Show', timestamp: '2026-02-01T00:00:00Z' },
    ]);
  },

  // ============================================================
  // RESET — Clear all data and re-seed
  // ============================================================

  resetAll() {
    Object.values(this.KEYS).forEach((key) => {
      Utils.storage.remove(key);
    });
    this.seedIfEmpty();
    console.log('🔄 DataStore reset and re-seeded');
  },
};

// Auto-initialize
if (typeof module === 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => DataStore.init());
  } else {
    DataStore.init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataStore;
}
