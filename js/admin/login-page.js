/* ============================================================
   js/admin/login-page.js
   Real authentication via Supabase Auth (email + password).

   Two ways in:
     A. Password sign-in (normal, day to day). Sends no email.
     B. One-time sign-in link, for a first sign-in or a forgotten
        password. Gated on the admins whitelist by is_admin_email()
        so strangers cannot burn the shared email quota (the built-in
        Supabase mailer allows only 2 messages an hour project-wide,
        which is why the link is a one-off and not the daily route).
        The link returns here with ?setup=1, and the card then offers
        to set a password so the next sign-in needs no email at all.

   Either way, link_admin_user() records which auth account belongs to
   the admin row, which is what drives "No login yet" in Settings.

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
    const noticeEl = document.getElementById('login-notice');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    const altBlock    = document.getElementById('login-alt');
    const magicBtn    = document.getElementById('magic-link-btn');
    const setupForm   = document.getElementById('setup-form');
    const setupPw     = document.getElementById('setup-password');
    const setupPw2    = document.getElementById('setup-password-2');

    // The one-time link comes back to this same page with ?setup=1, which is
    // how we know to offer the password step rather than redirecting away.
    const SETUP_FLAG = 'setup=1';
    const arrivedFromLink = window.location.search.indexOf(SETUP_FLAG) !== -1;

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

    // A failed or expired link comes back with an error in the hash.
    if (window.location.hash.indexOf('error') !== -1) {
      showError('That sign-in link is no longer valid. Request a new one below.');
      history.replaceState(null, '', window.location.pathname);
    }

    // Already signed in (valid live session + still whitelisted)? Skip the form.
    window.sb.auth.getSession().then(function (res) {
      const session = res && res.data ? res.data.session : null;
      if (!session || !session.user) return;
      resolveAdmin(session.user.email).then(function (admin) {
        if (!admin) {
          window.sb.auth.signOut();      // signed in but not an admin — clear it
          return;
        }
        // Arrived from a one-time link: offer the password step instead of
        // bouncing straight to the console.
        if (arrivedFromLink) showSetupPanel();
        else linkAndGo(admin);
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
            linkAndGo(admin);
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
        .select('email, name, role, user_id')
        .eq('email', String(email).toLowerCase())
        .maybeSingle()
        .then(function (res) {
          if (res.error || !res.data) return null;
          return {
            email: res.data.email,
            name: res.data.name,
            role: res.data.role,
            user_id: res.data.user_id
          };
        }, function () { return null; });
    }

    // Record which auth account belongs to this admin row, then continue.
    // Best-effort: a failure here must never block a valid sign-in, it only
    // means the team list keeps showing "No login yet" until the next attempt.
    function linkAndGo(admin) {
      window.sb.rpc('link_admin_user').then(function () {
        cacheAndGo(admin);
      }, function () {
        cacheAndGo(admin);
      });
    }

    function showNotice(text) {
      if (!noticeEl) return;
      noticeEl.textContent = text;
      noticeEl.hidden = false;
    }
    function clearNotice() {
      if (!noticeEl) return;
      noticeEl.textContent = '';
      noticeEl.hidden = true;
    }

    // Swap the card over to "choose a password" after a one-time-link sign-in.
    function showSetupPanel() {
      clearError();
      clearNotice();
      if (form) form.hidden = true;
      if (altBlock) altBlock.hidden = true;
      if (setupForm) setupForm.hidden = false;
      if (setupPw) setupPw.focus();
    }

    // ---------- One-time sign-in link ----------
    if (magicBtn) {
      magicBtn.addEventListener('click', function () {
        clearError();
        clearNotice();

        const email = emailEl.value.trim().toLowerCase();
        if (!email) {
          showError('Enter your SMU email above first.');
          emailEl.focus();
          return;
        }

        magicBtn.disabled = true;

        // Only whitelisted addresses get a link. Without this gate anyone could
        // trigger sign-in emails and exhaust the shared 2-per-hour budget.
        window.sb.rpc('is_admin_email', { p_email: email })
          .then(function (res) {
            if (res.error) throw res.error;
            if (res.data !== true) {
              magicBtn.disabled = false;
              showError('That email is not on the BIZCOM admin team. ' +
                        'Ask a super-admin to add you first.');
              return null;
            }
            return window.sb.auth.signInWithOtp({
              email: email,
              options: {
                shouldCreateUser: true,
                emailRedirectTo: window.location.origin +
                                 window.location.pathname + '?' + SETUP_FLAG
              }
            });
          })
          .then(function (res) {
            if (!res) return;                       // not whitelisted, already handled
            magicBtn.disabled = false;
            if (res.error) {
              showError(mapOtpError(res.error));
              return;
            }
            showNotice('Check your inbox. We have sent a sign-in link to ' + email +
                       '. It expires shortly, so use it soon.');
          })
          .catch(function () {
            magicBtn.disabled = false;
            showError('Could not send the sign-in link. Please try again.');
          });
      });
    }

    // ---------- Set a password after arriving from the link ----------
    if (setupForm) {
      setupForm.addEventListener('submit', function (e) {
        e.preventDefault();
        clearError();

        const pw1 = setupPw.value;
        const pw2 = setupPw2.value;
        if (pw1.length < 8) {
          showError('Use a password of at least 8 characters.');
          setupPw.focus();
          return;
        }
        if (pw1 !== pw2) {
          showError('Those two passwords do not match.');
          setupPw2.focus();
          return;
        }

        const btn = setupForm.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        window.sb.auth.updateUser({ password: pw1 }).then(function (res) {
          if (res.error) {
            if (btn) btn.disabled = false;
            showError(res.error.message || 'Could not save that password.');
            return;
          }
          // Drop ?setup=1 so a refresh does not reopen this panel.
          history.replaceState(null, '', window.location.pathname);
          return window.sb.auth.getSession().then(function (r) {
            const sess = r && r.data ? r.data.session : null;
            if (!sess || !sess.user) { window.location.reload(); return; }
            return resolveAdmin(sess.user.email).then(function (admin) {
              if (admin) linkAndGo(admin);
              else window.location.reload();
            });
          });
        }, function () {
          if (btn) btn.disabled = false;
          showError('Could not save that password. Please try again.');
        });
      });
    }

    function mapOtpError(error) {
      const msg = (error && error.message) || '';
      // The built-in mailer allows only 2 messages an hour across the project.
      if (/rate limit|too many requests|for security purposes/i.test(msg)) {
        return 'Too many sign-in emails have been requested recently. ' +
               'Wait a few minutes and try again.';
      }
      return msg || 'Could not send the sign-in link. Please try again.';
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
