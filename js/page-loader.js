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
  // The content containers (#dashboard-content / #public-content) have NO CSS
  // opacity/transform transition (computed transition-duration is 0s), so the
  // fadeOut/fadeIn opacity changes are instant — there is no visible fade. The
  // old 120ms here was therefore pure dead wait: 240ms (fadeOut + fadeIn) added
  // to EVERY navigation with zero visual benefit. Trimmed to one-frame-ish so the
  // content swap still happens while the container is hidden (no flash of old
  // content) but without the artificial delay. This is the single biggest, most
  // device-independent win for in-dashboard menu responsiveness.
  transitionDuration: 30,
  _navigating: false,
  _navigationId: 0,

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
    // Navigation lock — cancel any in-flight navigation so rapid taps
    // don't race and corrupt the DOM. Each call gets a unique ID; if a
    // newer call starts, the older one bails at the next await point.
    const navId = ++this._navigationId;
    this._navigating = true;

    const container = this.getActiveContainer();

    if (!container) {
      console.error('No active container for layout');
      this._navigating = false;
      return;
    }

    try {
      // Show loading state
      this.showLoading();

      // Get page content (from cache or fetch)
      const content = await this.getPageContent(pageName, pageUrl);
      if (navId !== this._navigationId) return; // superseded by newer nav

      // Fade out current content
      await this.fadeOut(container);
      if (navId !== this._navigationId) return; // superseded

      // Insert new content
      container.innerHTML = content;

      // Contact Registry hydration (CEO rule 2026-07-22) — fill [data-gbe-email]
      // from SiteConfig BEFORE inline scripts run, so scripts see final DOM.
      if (typeof Utils !== 'undefined' && Utils.hydrateContacts) Utils.hydrateContacts(container);

      // Execute any inline scripts (innerHTML doesn't run them)
      this.executeInlineScripts(container);

      // Fade in new content
      await this.fadeIn(container);

      // Mark fragment as loaded for perf instrumentation. Pairs with
      // nav.tap.start in router.js#markNavLoading to measure menu-tap → fragment-visible.
      if (typeof Perf !== 'undefined') {
        Perf.mark('nav.fragment.loaded');
        Perf.measure('nav.fragment', 'nav.tap.start', 'nav.fragment.loaded');
      }

      // Scroll to top
      container.scrollTop = 0;
      window.scrollTo(0, 0);

      // Initialize page-specific features
      this.initializePageFeatures(pageName);

      // Hide loading state
      this.hideLoading();
      this._navigating = false;

      // Fire one-shot event the first time a dashboard fragment finishes
      // loading after auth — used by perf.js to measure dashboard.firstLoad.
      if (!this._firstDashboardLoaded && pageName.indexOf('dashboard-') === 0) {
        this._firstDashboardLoaded = true;
        document.dispatchEvent(new CustomEvent('gbe:dashboard-loaded', { detail: { pageName: pageName } }));
        // Warm the in-memory cache for the rest of the menu so subsequent taps
        // render instantly (no per-tap network fetch). Delay so it never competes
        // with the dashboard the user just opened.
        setTimeout(() => PageLoader.prefetchMenuFragments(), 800);
      }

      console.log(`📄 Loaded: ${pageName}`);
    } catch (error) {
      this._navigating = false;
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

    // Fetch from server (cache-bust to avoid stale CDN/browser cache)
    const bustUrl = pageUrl + (pageUrl.includes('?') ? '&' : '?') + '_v=' + Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetchOpts.signal = controller.signal;
    let response;
    try {
      response = await fetch(bustUrl, fetchOpts);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // Cache the content
    this.cache[pageName] = content;

    return content;
  },

  /**
   * Prefetch every visible dashboard menu fragment into the in-memory cache,
   * in the background, after the first dashboard page loads. The dominant cost
   * of in-dashboard menu navigation is the per-tap network fetch of each fragment
   * (the SW is network-first for .html and only 1 of 39 fragments is precached),
   * which is ~300ms on desktop but multiple seconds on cellular. Once a fragment
   * is in this.cache, loadPage() serves it synchronously with zero network — so
   * warming the cache up front makes subsequent menu taps render instantly.
   * Runs once per session, sequentially, during idle time so it never competes
   * with the page the user is actually looking at.
   */
  _menuPrefetched: false,
  prefetchMenuFragments() {
    if (this._menuPrefetched) return;
    this._menuPrefetched = true;
    const self = this;
    const routes = (typeof Router !== 'undefined' && Router.routes) ? Router.routes : {};
    const pages = Array.prototype.slice
      .call(document.querySelectorAll('.sidebar-nav-item[data-page]'))
      .filter((a) => a.offsetParent !== null)        // visible to this role only
      .map((a) => a.getAttribute('data-page'))
      .filter((p) => routes[p] && !self.cache[p]);    // skip unknown + already-cached
    if (!pages.length) return;
    const idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 200); };
    let i = 0;
    function fetchNext() {
      if (i >= pages.length) {
        try { console.log('[perf] menu prefetch complete: ' + pages.length + ' fragments warmed'); } catch (e) {}
        return;
      }
      const p = pages[i++];
      self.getPageContent(p, routes[p]).catch(() => {}).then(() => idle(fetchNext));
    }
    idle(fetchNext);
  },

  /**
   * Show loading indicator — immediate visual feedback when a menu link is tapped.
   * Puts a centered spinner in the active content container so the user knows
   * their tap registered, even if the page fetch takes a moment.
   */
  showLoading() {
    document.body.classList.add(this.loadingClass);
    const container = this.getActiveContainer();
    if (container) {
      container.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;min-height:40vh;opacity:0.6;">' +
          '<div style="width:28px;height:28px;border:3px solid rgba(255,255,255,0.15);border-top-color:#d4a017;border-radius:50%;animation:spin .7s linear infinite;"></div>' +
          '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>' +
        '</div>';
    }
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

    // Dashboard calendar page has its own inline script with full CRUD.
    // Calendar.init() would overwrite #calendar-container with class-based
    // HTML that has no CSS, breaking the layout. Skip it here.
    // if (pageName === 'dashboard-calendar' && typeof Calendar !== 'undefined') {
    //   Calendar.init();
    // }

    // Form pages
    if ((pageName === 'contact' || pageName.startsWith('dashboard-')) && typeof Forms !== 'undefined') {
      Forms.init();
    }

    // Table pages — TableManager auto-inits via inline scripts

    // Enterprise home — terminal typing effect
    if (pageName === 'biz-home') {
      this.initTerminalTyping();
    }

    // Lazy load images
    if (typeof Utils !== 'undefined' && Utils.lazyLoadImages) {
      Utils.lazyLoadImages();
    }

    // Scroll-triggered animations (reveals, counters, stagger)
    if (typeof initScrollAnimations === 'function') {
      initScrollAnimations();
    }
  },

  /**
   * Terminal typing effect — lines 1-3 appear instantly, lines 4-8 type
   * character by character, then loop with a 5-second pause.
   */
  initTerminalTyping() {
    const terminal = document.querySelector('#page-biz-home .hero-code-terminal');
    if (!terminal) return;

    const allLines = terminal.querySelectorAll('.code-line');
    if (!allLines.length) return;

    // Lines 1-3 (index 0-2) reveal instantly after terminal slides in
    const staticLines = Array.from(allLines).slice(0, 3);
    const typingLines = Array.from(allLines).slice(3); // lines 4-8 (index 3-7)

    // Save original HTML and extract plain text for each typing line
    const lineData = typingLines.map((line) => {
      const content = line.querySelector('.line-content');
      return {
        el: line,
        contentEl: content,
        originalHTML: content.innerHTML,
        text: content.textContent
      };
    });

    // Move cursor to a ref we can relocate
    const cursor = terminal.querySelector('.terminal-cursor');

    const CHAR_SPEED = 45;       // ms per character
    const LINE_PAUSE = 200;      // ms pause between lines
    const LOOP_PAUSE = 10000;    // 10 sec pause before restarting
    const INITIAL_DELAY = 1800;  // wait for terminal slide-in

    // Reveal static lines (1-3) immediately after terminal appears
    setTimeout(() => {
      staticLines.forEach((line) => line.classList.add('typed'));
    }, INITIAL_DELAY);

    // Start the typing loop for lines 4-8
    let loopTimer = null;
    let charTimers = [];
    let active = true;

    function clearAllTimers() {
      charTimers.forEach(clearTimeout);
      charTimers = [];
      if (loopTimer) clearTimeout(loopTimer);
    }

    function resetTypingLines() {
      lineData.forEach(({ el, contentEl }) => {
        el.classList.remove('typed');
        contentEl.innerHTML = '';
      });
      // Hide cursor during reset
      if (cursor) cursor.style.display = 'none';
    }

    function typeLines() {
      if (!active) return;
      resetTypingLines();

      let totalDelay = 0;

      lineData.forEach(({ el, contentEl, originalHTML, text }, lineIdx) => {
        const lineStart = totalDelay;

        // Show the line container (with line number visible)
        charTimers.push(setTimeout(() => {
          el.classList.add('typed');
          contentEl.innerHTML = '';
          // Place cursor in this line
          if (cursor) {
            contentEl.appendChild(cursor);
            cursor.style.display = '';
          }
        }, lineStart));

        // Type each character
        for (let c = 0; c < text.length; c++) {
          charTimers.push(setTimeout(() => {
            // Build plain text up to this character, then append cursor
            const typed = text.substring(0, c + 1);
            contentEl.textContent = typed;
            if (cursor) contentEl.appendChild(cursor);
          }, lineStart + (c + 1) * CHAR_SPEED));
        }

        totalDelay += (text.length + 1) * CHAR_SPEED;

        // After line is fully typed, swap in the syntax-highlighted HTML
        charTimers.push(setTimeout(() => {
          contentEl.innerHTML = originalHTML;
          // If this is the last line, put cursor back
          if (lineIdx === lineData.length - 1 && cursor) {
            // cursor is already in originalHTML for last line
          }
        }, totalDelay));

        totalDelay += LINE_PAUSE;
      });

      // After all lines typed, pause 5 sec then restart
      loopTimer = setTimeout(() => {
        if (active) typeLines();
      }, totalDelay + LOOP_PAUSE);
    }

    // Kick off first cycle after initial delay + time for static lines
    setTimeout(() => {
      typeLines();
    }, INITIAL_DELAY + 400);

    // Clean up if page navigates away
    this._terminalCleanup = () => {
      active = false;
      clearAllTimers();
    };
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

// Auto-initialize immediately — all DOM containers exist above the script tags.
// Do NOT wait for DOMContentLoaded; that fires after Firebase + band player
// finish loading, which takes 10-30s on mobile cellular. Navigation must work now.
if (typeof module === 'undefined') {
  PageLoader.init();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageLoader;
}
