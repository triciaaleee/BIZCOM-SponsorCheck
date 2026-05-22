/* ============================================================
   js/components/count-up.js
   Tiny standalone count-up. Animates from 0 → target.
   Usage: <span data-countup="1234" data-duration="800">0</span>
   Trigger by calling window.runCountUps() or wait for
   IntersectionObserver to fire automatically.
   ============================================================ */

(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animate(el) {
    const target = parseFloat(el.getAttribute('data-countup'));
    if (isNaN(target)) return;
    const duration = parseInt(el.getAttribute('data-duration') || '800', 10);
    const decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    const prefix = el.getAttribute('data-prefix') || '';
    const suffix = el.getAttribute('data-suffix') || '';

    if (reduced) {
      el.textContent = prefix + target.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + suffix;
      return;
    }

    const start = performance.now();
    function step(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      const value = target * eased;
      el.textContent = prefix + value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function runAll(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-countup]').forEach(animate);
  }

  // Auto-trigger when in viewport
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animate(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    document.querySelectorAll('[data-countup]').forEach(function (el) {
      observer.observe(el);
    });
  } else {
    runAll();
  }

  // Expose for manual triggering (e.g., after results render)
  window.runCountUps = runAll;
  window.animateCountUp = animate;
})();
