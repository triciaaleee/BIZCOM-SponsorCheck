/* ============================================================
   js/components/modal.js
   Open / close modals. Triggered by [data-modal-open="ID"]
   and [data-modal-close] inside the modal. ESC also closes.
   ============================================================ */

(function () {
  'use strict';

  function openModal(modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // Focus first focusable element
    const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
  }

  function closeModal(modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function closeAll() {
    document.querySelectorAll('.modal.is-open').forEach(closeModal);
  }

  // Open triggers
  document.addEventListener('click', function (e) {
    const opener = e.target.closest('[data-modal-open]');
    if (opener) {
      const id = opener.getAttribute('data-modal-open');
      const modal = document.getElementById(id);
      if (modal) {
        e.preventDefault();
        openModal(modal);
      }
      return;
    }

    // Close triggers
    if (e.target.matches('[data-modal-close]') || e.target.closest('[data-modal-close]')) {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal);
      return;
    }

    // Click on backdrop (the .modal element itself, not the dialog)
    if (e.target.classList.contains('modal')) {
      closeModal(e.target);
    }
  });

  // ESC key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeAll();
    }
  });

  window.openModal = function (id) {
    const m = document.getElementById(id);
    if (m) openModal(m);
  };
  window.closeModal = function (id) {
    const m = document.getElementById(id);
    if (m) closeModal(m);
  };
})();
