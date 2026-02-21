/* ==========================================================================
   Gold Bottom Ent. LLC — Scroll Animations
   IntersectionObserver: reveals, stagger grids, animated counters
   ========================================================================== */

(function() {
  'use strict';

  // Respect reduced motion preference
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Scroll Reveal ---------- */
  function initReveals() {
    var reveals = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (!reveals.length) return;

    if (prefersReducedMotion) {
      reveals.forEach(function(el) { el.classList.add('in-view'); });
      return;
    }

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(function(el) { observer.observe(el); });
  }

  /* ---------- Stagger Grid Reveal ---------- */
  function initStaggerGrids() {
    var grids = document.querySelectorAll('.stagger-grid');
    if (!grids.length) return;

    if (prefersReducedMotion) {
      grids.forEach(function(grid) { grid.classList.add('in-view'); });
      return;
    }

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    grids.forEach(function(grid) { observer.observe(grid); });
  }

  /* ---------- Animated Counters ---------- */
  function animateCounter(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var duration = 1500; // ms
    var startTime = null;
    var isFloat = target % 1 !== 0;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = eased * target;

      if (isFloat) {
        el.textContent = prefix + current.toFixed(1) + suffix;
      } else {
        el.textContent = prefix + Math.floor(current) + suffix;
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = prefix + target + suffix;
      }
    }

    requestAnimationFrame(step);
  }

  function initCounters() {
    var counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;

    if (prefersReducedMotion) {
      counters.forEach(function(el) {
        var prefix = el.getAttribute('data-prefix') || '';
        var suffix = el.getAttribute('data-suffix') || '';
        el.textContent = prefix + el.getAttribute('data-count') + suffix;
      });
      return;
    }

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(function(el) { observer.observe(el); });
  }

  /* ---------- Public Init ---------- */
  window.initScrollAnimations = function() {
    initReveals();
    initStaggerGrids();
    initCounters();
  };

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initScrollAnimations);
  } else {
    window.initScrollAnimations();
  }
})();
