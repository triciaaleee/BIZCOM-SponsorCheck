/* ============================================================
   js/components/navbar.js
   Navbar scroll state + mobile drawer toggle.
   ============================================================ */

(function () {
  'use strict';

  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  // ---------- Shadow on scroll ----------
  function updateScrollState() {
    if (window.scrollY > 8) {
      navbar.classList.add('is-scrolled');
    } else {
      navbar.classList.remove('is-scrolled');
    }
  }

  let ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        updateScrollState();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
  updateScrollState();

  // ---------- Mobile drawer ----------
  const toggle = navbar.querySelector('.navbar__toggle');
  const drawer = document.querySelector('.navbar__drawer');

  if (toggle && drawer) {
    toggle.addEventListener('click', function () {
      const isOpen = drawer.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      // Swap icon
      const icon = toggle.querySelector('i');
      if (icon) {
        icon.className = isOpen ? 'bi bi-x-lg' : 'bi bi-list';
      }
    });

    // Close drawer when a link inside is clicked
    drawer.addEventListener('click', function (e) {
      if (e.target.matches('a, a *')) {
        drawer.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        const icon = toggle.querySelector('i');
        if (icon) icon.className = 'bi bi-list';
      }
    });
  }

  // ---------- Active link highlighting ----------
  // Compare filenames, not paths. The links are written relative
  // ("./dashboard.html") while location.pathname is absolute
  // ("/dashboard.html"), so a direct string compare never matched and no link
  // ever highlighted. The .html suffix is dropped on both sides so this also
  // works where the host serves clean URLs ("/dashboard").
  function pageId(path) {
    const file = (path.split('?')[0].split('#')[0].split('/').pop() || 'index.html');
    return file.toLowerCase().replace(/\.html$/, '') || 'index';
  }

  const current = pageId(window.location.pathname);
  navbar.querySelectorAll('.navbar__link').forEach(function (link) {
    const href = link.getAttribute('href');
    if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return;
    if (pageId(href) === current) {
      link.classList.add('is-active');
    }
  });
})();
