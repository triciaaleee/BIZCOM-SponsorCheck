/* ============================================================
   js/admin/login-page.js
   Mock authentication. Sets session and redirects on success.

   Auth rules:
     - biz@sa.smu.edu.sg                → super_admin
     - *@sa.smu.edu.sg in MOCK_DATA.admins → role from admins list
     - anything else                    → reject
   ============================================================ */

(function () {
  'use strict';

  // If already signed in, skip the form and redirect.
  document.addEventListener('DOMContentLoaded', function () {
    const existing = window.AdminShell && window.AdminShell.getSession();
    if (existing) {
      window.location.href = 'sponsors.html';
      return;
    }

    const form = document.getElementById('login-form');
    const emailEl = document.getElementById('login-email');
    const errorEl = document.getElementById('login-error');

    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.classList.remove('is-shown');
      errorEl.textContent = '';

      const email = emailEl.value.trim().toLowerCase();

      if (!email) {
        return;
      }

      // Look up email in the admins list
      const admins = (window.MOCK_DATA && window.MOCK_DATA.admins) || [];
      const found = admins.find(function (a) {
        return a.email.toLowerCase() === email;
      });

      if (!found) {
        errorEl.textContent = 'Email not recognised. Contact biz@sa.smu.edu.sg for access.';
        errorEl.classList.add('is-shown');
        return;
      }

      // Mock success: persist session and redirect
      window.AdminShell.setSession({
        email: found.email,
        role: found.role,
        signed_in_at: new Date().toISOString()
      });

      window.location.href = 'sponsors.html';
    });
  });
})();
