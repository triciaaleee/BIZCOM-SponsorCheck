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

    // Reveal WITHOUT requestAnimationFrame.
    //
    // rAF does not fire while the page is not being painted — a background tab,
    // a minimised window — but the auto-dismiss below is a setTimeout, which
    // keeps running. The two clocks drift apart, and the toast was created,
    // never given `is-visible`, and then removed on schedule having never been
    // seen: opacity 0 for its whole life. Reading offsetWidth forces the style
    // flush the CSS transition needs, synchronously, whatever the paint state.
    //
    // This bites hardest after a long write. Logging outreach for a whole wave
    // is one request per company and can run for tens of seconds, so the admin
    // looks away, and the toast is the only thing that reports the result.
    void toast.offsetWidth;
    toast.classList.add('is-visible');

    let timer = null;

    const closeBtn = toast.querySelector('.toast__close');
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      toast.classList.remove('is-visible');
      setTimeout(function () {
        toast.remove();
      }, 300);
    }
    closeBtn.addEventListener('click', dismiss);

    // Hold the countdown while the page is hidden, so a toast raised while the
    // admin is in another tab is still waiting when they come back rather than
    // having expired unseen.
    function startTimer() {
      if (duration <= 0 || timer) return;
      timer = setTimeout(dismiss, duration);
    }
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      startTimer();
    }

    if (duration > 0) {
      if (document.visibilityState === 'visible') startTimer();
      else document.addEventListener('visibilitychange', onVisibilityChange);
    }
  }

  window.toast = show;
})();
