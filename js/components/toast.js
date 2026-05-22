/* ============================================================
   js/components/toast.js
   Simple toast notification. Use: window.toast({ ... })
   ============================================================ */

(function () {
  'use strict';

  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }

  const ICONS = {
    success: 'bi-check-circle-fill',
    error:   'bi-x-circle-fill',
    info:    'bi-info-circle-fill',
    warning: 'bi-exclamation-triangle-fill'
  };

  function show(opts) {
    const {
      title = '',
      message = '',
      type = 'info',
      duration = type === 'error' ? 5000 : 3000
    } = opts || {};

    const toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.innerHTML = `
      <i class="bi ${ICONS[type] || ICONS.info} toast__icon"></i>
      <div class="toast__body">
        ${title ? `<div class="toast__title">${title}</div>` : ''}
        ${message ? `<div class="toast__message">${message}</div>` : ''}
      </div>
      <button class="toast__close" aria-label="Dismiss"><i class="bi bi-x"></i></button>
    `;
    container.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('is-visible');
    });

    const closeBtn = toast.querySelector('.toast__close');
    function dismiss() {
      toast.classList.remove('is-visible');
      setTimeout(function () {
        toast.remove();
      }, 300);
    }
    closeBtn.addEventListener('click', dismiss);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  }

  window.toast = show;
})();
