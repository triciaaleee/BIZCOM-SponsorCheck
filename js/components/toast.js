/* ============================================================
   js/components/toast.js
   Simple toast notification. Use: window.toast({ ... })

   `title` and `message` are TEXT, never markup. Both are escaped
   before they reach innerHTML: almost every caller passes a name
   it did not write (an event name, a club, a sponsor, a company
   read out of a club's uploaded CSV on Vet & Upload), and an
   unescaped one of those ran script in the signed-in admin's
   browser, where window.sb holds the live session. Keep them
   escaped: no caller passes HTML, so nothing needs the hole.
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

  // Same rules as AdminShell.escapeHtml, repeated here because toast.js loads
  // on the public pages too, which never load the admin shell.
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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
        ${title ? `<div class="toast__title">${escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="toast__message">${escapeHtml(message)}</div>` : ''}
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
