/* ============================================================
   js/admin/login-page.js
   Real authentication via Supabase Auth (email + password).

   Flow:
     1. supabase.auth.signInWithPassword({ email, password }).
     2. On success, look the email up in the `admins` whitelist to
        get the display name + role (admin | super_admin). RLS lets a
        signed-in admin read that table; a valid login that is NOT on
        the whitelist gets an empty result and is signed straight back
        out (authenticated, but not authorised for the console).
     3. Cache { email, name, role } in sessionStorage (UI only — drives
        nav + role display) and redirect to home. Real security is
        enforced server-side by RLS on every query, not by this cache.
   ============================================================ */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('login-form');
    const emailEl = document.getElementById('login-email');
    const passwordEl = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    if (!window.sb) {
      showError('Could not reach the sign-in service. Refresh the page and try again.');
      return;
    }

    // Bounced back here by the admin shell because the session ended on its own.
    // Clear the flag from the URL so a refresh does not repeat the message.
    if (/[?&]expired=1(&|$)/.test(window.location.search)) {
      showError('Your session has ended. Please sign in again.');
      if (window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    // Already signed in (valid live session + still whitelisted)? Skip the form.
    window.sb.auth.getSession().then(function (res) {
      const session = res && res.data ? res.data.session : null;
      if (!session || !session.user) return;
      resolveAdmin(session.user.email).then(function (admin) {
        if (admin) cacheAndGo(admin);
        else window.sb.auth.signOut();   // signed in but not an admin — clear it
      });
    });

    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearError();

      const email = emailEl.value.trim().toLowerCase();
      const password = passwordEl.value;
      if (!email || !password) return;

      setLoading(true);

      window.sb.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) {
            setLoading(false);
            showError(mapAuthError(res.error));
            return;
          }
          // Authenticated — now enforce the admin whitelist (name + role).
          return resolveAdmin(email).then(function (admin) {
            if (!admin) {
              return window.sb.auth.signOut().then(function () {
                setLoading(false);
                showError('This account is not authorised for the admin console. ' +
                          'Contact biz@sa.smu.edu.sg for access.');
              });
            }
            cacheAndGo(admin);
          });
        })
        .catch(function () {
          setLoading(false);
          showError('Something went wrong signing in. Please try again.');
        });
    });

    // Look the signed-in email up in the admins table.
    // Returns { email, name, role } or null when not whitelisted.
    function resolveAdmin(email) {
      return window.sb
        .from('admins')
        .select('email, name, role')
        .eq('email', String(email).toLowerCase())
        .maybeSingle()
        .then(function (res) {
          if (res.error || !res.data) return null;
          return { email: res.data.email, name: res.data.name, role: res.data.role };
        }, function () { return null; });
    }

    function cacheAndGo(admin) {
      window.AdminShell.setSession({
        email: admin.email,
        name: admin.name || admin.email.split('@')[0],
        role: admin.role,
        signed_in_at: new Date().toISOString()
      });
      window.location.href = 'home.html';
    }

    function mapAuthError(error) {
      const msg = (error && error.message) || '';
      if (/invalid login credentials/i.test(msg)) return 'Email or password is incorrect.';
      if (/email not confirmed/i.test(msg)) {
        return 'This account’s email is not confirmed yet. Confirm it in Supabase, then try again.';
      }
      return msg || 'Could not sign in. Please try again.';
    }

    function showError(text) {
      if (!errorEl) return;
      errorEl.textContent = text;
      errorEl.classList.add('is-shown');
    }
    function clearError() {
      if (!errorEl) return;
      errorEl.textContent = '';
      errorEl.classList.remove('is-shown');
    }
    function setLoading(on) {
      if (submitBtn) submitBtn.disabled = on;
    }
  });
})();
