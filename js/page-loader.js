// js/page-loader.js

/**
 * Page Loader Module — Dual-Layout SPA
 * Handles dynamic loading of page content into the correct container
 * (public-content or dashboard-content) based on current layout.
 */

const PageLoader = {
  publicContainer: null,
  dashboardContainer: null,
  cache: {},
  loadingClass: 'page-loading',
  transitionDuration: 250,

  /**
   * Initialize page loader — get references to both content containers
   */
  init() {
    this.publicContainer = document.getElementById('public-content');
    this.dashboardContainer = document.getElementById('dashboard-content');

    if (!this.publicContainer) {
      console.error('❌ Public content container not found');
    }
    if (!this.dashboardContainer) {
      console.error('❌ Dashboard content container not found');
    }

    console.log('✅ PageLoader initialized (dual-layout)');
  },

  /**
   * Get the active container based on current layout
   */
  getActiveContainer() {
    if (typeof Router !== 'undefined' && Router.currentLayout === 'dashboard') {
      return this.dashboardContainer;
    }
    return this.publicContainer;
  },

  /**
   * Load a page into the active container
   */
  async loadPage(pageName, pageUrl) {
    const container = this.getActiveContainer();

    if (!container) {
      console.error('No active container for layout');
      return;
    }

    try {
      // Show loading state
      this.showLoading();

      // Get page content (from cache or fetch)
      const content = await this.getPageContent(pageName, pageUrl);

      // Fade out current content
      await this.fadeOut(container);

      // Insert new content
      container.innerHTML = content;

      // Execute any inline scripts (innerHTML doesn't run them)
      this.executeInlineScripts(container);

      // Fade in new content
      await this.fadeIn(container);

      // Scroll to top
      container.scrollTop = 0;
      window.scrollTo(0, 0);

      // Initialize page-specific features
      this.initializePageFeatures(pageName);

      // Hide loading state
      this.hideLoading();

      console.log(`📄 Loaded: ${pageName}`);
    } catch (error) {
      console.error('Error loading page:', error);
      this.showError(container, `Failed to load page "${pageName}". Please try again.`);
    }
  },

  /**
   * Get page content (with caching)
   */
  async getPageContent(pageName, pageUrl) {
    // Check cache first
    if (this.cache[pageName]) {
      return this.cache[pageName];
    }

    // Build fetch options — include session token for dashboard routes
    const fetchOpts = {};
    if (pageUrl.startsWith('dashboard/') && typeof Auth !== 'undefined' && Auth._sessionToken) {
      fetchOpts.headers = { 'X-GBE-Session': Auth._sessionToken };
    }

    // Fetch from server
    const response = await fetch(pageUrl, fetchOpts);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // Cache the content
    this.cache[pageName] = content;

    return content;
  },

  /**
   * Show loading indicator
   */
  showLoading() {
    document.body.classList.add(this.loadingClass);
  },

  /**
   * Hide loading indicator
   */
  hideLoading() {
    document.body.classList.remove(this.loadingClass);
  },

  /**
   * Fade out animation
   */
  fadeOut(container) {
    return new Promise((resolve) => {
      container.style.opacity = '0';
      container.style.transform = 'translateY(8px)';
      setTimeout(resolve, this.transitionDuration);
    });
  },

  /**
   * Fade in animation
   */
  fadeIn(container) {
    return new Promise((resolve) => {
      // Force reflow
      container.offsetHeight;
      container.style.opacity = '1';
      container.style.transform = 'translateY(0)';
      setTimeout(resolve, this.transitionDuration);
    });
  },

  /**
   * Initialize page-specific features after load
   */
  initializePageFeatures(pageName) {
    // Dashboard pages — init widgets, tables, etc.
    if (pageName === 'dashboard-home' && typeof DashboardWidgets !== 'undefined') {
      DashboardWidgets.init();
    }

    if (pageName === 'dashboard-calendar' && typeof Calendar !== 'undefined') {
      Calendar.init();
    }

    // Form pages
    if ((pageName === 'contact' || pageName.startsWith('dashboard-')) && typeof Forms !== 'undefined') {
      Forms.init();
    }

    // Table pages — TableManager auto-inits via inline scripts

    // Lazy load images
    if (typeof Utils !== 'undefined' && Utils.lazyLoadImages) {
      Utils.lazyLoadImages();
    }
  },

  /**
   * Execute inline scripts after innerHTML insertion
   * (Browsers don't run <script> tags inserted via innerHTML)
   */
  executeInlineScripts(container) {
    if (!container) return;
    const scripts = container.querySelectorAll('script');
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script');
      // Copy attributes (src, type, etc.)
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value);
      });
      // Copy inline code
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  },

  /**
   * Show error message in container
   */
  showError(container, message) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <h3 class="empty-state-title">Oops!</h3>
        <p class="empty-state-text">${message}</p>
        <button onclick="location.reload()" class="btn btn-primary">Reload Page</button>
      </div>
    `;
    this.hideLoading();
  },

  /**
   * Clear cache
   */
  clearCache() {
    this.cache = {};
    console.log('🗑️ Page cache cleared');
  },

  /**
   * Preload a page into cache
   */
  async preloadPage(pageName, pageUrl) {
    if (!this.cache[pageName]) {
      try {
        await this.getPageContent(pageName, pageUrl);
        console.log(`⏳ Preloaded: ${pageName}`);
      } catch (error) {
        console.error(`Failed to preload ${pageName}:`, error);
      }
    }
  },
};

// Auto-initialize
if (typeof module === 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PageLoader.init());
  } else {
    PageLoader.init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageLoader;
}
