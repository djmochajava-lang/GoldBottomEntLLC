// js/main.js

/**
 * Gold Bottom Ent. LLC — App Controller
 * Initializes all modules in dependency order.
 */

(function () {
  'use strict';

  const App = {
    version: '1.0.0',
    name: 'Gold Bottom Ent. LLC Portal',
    initialized: false,
    modules: {},

    init() {
      if (this.initialized) return;

      console.log(`\n🏢 ${this.name} v${this.version}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      this.initModules();
      this.setupGlobalListeners();
      this.initialized = true;

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Application initialized\n');
    },

    /**
     * Initialize all modules in dependency order
     */
    initModules() {
      // Foundation (no dependencies)
      this.initModule('Utils', typeof Utils !== 'undefined' ? Utils : null);
      this.initModule('MobileDetect', typeof MobileDetect !== 'undefined' ? MobileDetect : null);

      // UI Utilities
      this.initModule('Toast', typeof Toast !== 'undefined' ? Toast : null);
      this.initModule('Modal', typeof Modal !== 'undefined' ? Modal : null);

      // Auth (must be before Router so guard is ready for initial route)
      this.initModule('Auth', typeof Auth !== 'undefined' ? Auth : null);

      // Core SPA
      this.initModule('PageLoader', typeof PageLoader !== 'undefined' ? PageLoader : null);
      this.initModule('Router', typeof Router !== 'undefined' ? Router : null);

      // Navigation
      this.initModule('Navigation', typeof Navigation !== 'undefined' ? Navigation : null);
      this.initModule('Sidebar', typeof Sidebar !== 'undefined' ? Sidebar : null);

      // Data Layer
      this.initModule('DataStore', typeof DataStore !== 'undefined' ? DataStore : null);

      // Features (lazy — these init themselves when their pages load)
      this.registerModule('Forms', typeof Forms !== 'undefined' ? Forms : null);
      this.registerModule('TableManager', typeof TableManager !== 'undefined' ? TableManager : null);
      this.registerModule('DashboardWidgets', typeof DashboardWidgets !== 'undefined' ? DashboardWidgets : null);
      this.registerModule('Calendar', typeof Calendar !== 'undefined' ? Calendar : null);
    },

    /**
     * Initialize a module with error handling
     */
    initModule(name, module) {
      if (!module) {
        console.warn(`⚠️ Module "${name}" not found`);
        return;
      }

      try {
        if (typeof module.init === 'function' && !module.initialized) {
          module.init();
        }
        this.modules[name] = module;
      } catch (error) {
        console.error(`❌ Failed to initialize "${name}":`, error);
      }
    },

    /**
     * Register a module without initializing (lazy modules)
     */
    registerModule(name, module) {
      if (module) {
        this.modules[name] = module;
      }
    },

    /**
     * Setup global event listeners
     */
    setupGlobalListeners() {
      // Listen for data updates to refresh dashboard widgets
      document.addEventListener('gbe:data-updated', () => {
        if (typeof DashboardWidgets !== 'undefined' && Router.getCurrentPage() === 'dashboard-home') {
          DashboardWidgets.refresh();
        }
      });

      // Handle online/offline status
      window.addEventListener('online', () => {
        if (typeof Toast !== 'undefined') {
          Toast.success('Connection restored');
        }
      });

      window.addEventListener('offline', () => {
        if (typeof Toast !== 'undefined') {
          Toast.warning('You are offline. Changes are saved locally.');
        }
      });

      // Global error handler
      window.addEventListener('error', (e) => {
        console.error('Uncaught error:', e.error);
      });

      window.addEventListener('unhandledrejection', (e) => {
        console.error('Unhandled promise rejection:', e.reason);
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K → Focus search (if on dashboard)
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          const searchInput = document.querySelector('.search-input');
          if (searchInput) {
            e.preventDefault();
            searchInput.focus();
          }
        }
      });
    },

    /**
     * Get a module reference
     */
    getModule(name) {
      return this.modules[name] || null;
    },
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }

  // Expose for debugging (read-only in production)
  window.GBEApp = Object.freeze({
    version: App.version,
    getModule: App.getModule.bind(App),
    resetData: () => {
      if (typeof DataStore !== 'undefined') {
        DataStore.resetAll();
        location.reload();
      }
    },
  });
})();
