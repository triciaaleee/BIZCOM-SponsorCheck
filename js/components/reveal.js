/* ============================================================
   js/components/reveal.js
   Scroll-triggered reveal animations using IntersectionObserver.
   Add .reveal to any element to fade-in + translate-up on scroll.
   Optional .delay-N for staggered entry.
   ============================================================ */

(function () {
  'use strict';

  // Tells the inline gate in index.html that this file ran, so it leaves the
  // .js-reveal class in place. Set first: if anything below throws, the gate's
  // timer is the only thing standing between a script error and a blank page,
  // and it should still fire.
  function revealAll() {
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)) {
    revealAll();
    window.__revealReady = true;
    return;
  }

  let fired = false;
  const observer = new IntersectionObserver(function (entries) {
    fired = true;
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -40px 0px'
  });

  document.querySelectorAll('.reveal').forEach(function (el) {
    observer.observe(el);
  });

  window.__revealReady = true;

  // An observer that is registered but never delivers a callback (some
  // embedded webviews, print and thumbnail contexts) would otherwise leave
  // everything hidden. If nothing has come back by now, give up on the
  // animation and just show the content.
  setTimeout(function () {
    if (!fired) {
      observer.disconnect();
      revealAll();
    }
  }, 2000);
})();
