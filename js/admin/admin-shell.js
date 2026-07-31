/* ============================================================
   js/admin/admin-shell.js
   Shared admin shell logic, loaded on every admin page except
   login.html.

   Responsibilities:
   1. Auth guard: if no session, redirect to login.
   2. Render sidebar nav with active-page highlight.
   3. Render top-bar with signed-in email + role badge + sign out.
   4. Action helpers: logActivity (audit-log insert), signOut.

   Auth is now wired to Supabase: the guard verifies the live auth
   session (window.sb) and sign-out calls supabase.auth.signOut().
   The sessionStorage cache (email/name/role) drives the immediate,
   synchronous guard + UI; RLS enforces real security on every query.
   ============================================================ */

(function () {
  'use strict';

  // ---------- Session ----------

  function getSession() {
    try {
      const raw = sessionStorage.getItem('sponsorcheck_admin_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s.email || !s.role) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function setSession(session) {
    sessionStorage.setItem('sponsorcheck_admin_session', JSON.stringify(session));
  }

  function clearSession() {
    sessionStorage.removeItem('sponsorcheck_admin_session');
  }

  // ---------- Activity log ----------

  // Append an entry to the activity_log audit trail. Best-effort and
  // fire-and-forget: a logging failure must never block the user's action, so
  // errors are only warned to the console. RLS lets any signed-in admin insert.
  function logActivity(action, entity, details) {
    if (!window.sb || !action) return;
    const s = getSession();
    window.sb.from('activity_log').insert({
      actor_email: s ? s.email : null,
      action: action,
      entity: entity != null ? String(entity) : null,
      details: details != null ? String(details) : null
    }).then(function (res) {
      if (res && res.error) console.warn('[logActivity] ' + res.error.message);
    }, function () { /* swallow */ });
  }

  // ---------- Sidebar ----------

  const NAV_ITEMS = [
    { href: 'home.html',        label: 'Home',          icon: 'bi-house-door-fill' },
    { href: 'vet-upload.html',  label: 'Vet & Upload',  icon: 'bi-clipboard-check-fill' },
    { href: 'sponsors.html',    label: 'Sponsors',      icon: 'bi-building'      },
    { href: 'settings.html',    label: 'Settings',      icon: 'bi-gear-fill',    superOnly: true }
  ];

  function renderSidebar(currentPage, session) {
    const aside = document.createElement('aside');
    aside.className = 'admin-nav';
    aside.setAttribute('aria-label', 'Admin navigation');

    const brand = document.createElement('a');
    brand.href = 'home.html';
    brand.className = 'admin-nav__brand';
    brand.innerHTML =
      '<img src="../admin/assets/bizcom-logo.png" alt="SMU BIZCOM">' +
      '<span class="admin-nav__brand-sub">Admin</span>';
    aside.appendChild(brand);

    const list = document.createElement('nav');
    list.className = 'admin-nav__list';

    NAV_ITEMS.forEach(function (item) {
      if (item.superOnly && session.role !== 'super_admin') return;
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'admin-nav__link' + (item.href === currentPage ? ' is-active' : '');
      a.innerHTML = '<i class="bi ' + item.icon + '"></i><span>' + item.label + '</span>';
      list.appendChild(a);
    });

    aside.appendChild(list);

    // Public-site link at the bottom
    const footer = document.createElement('div');
    footer.className = 'admin-nav__footer';
    footer.innerHTML =
      '<a href="../index.html" class="admin-nav__link admin-nav__link--secondary">' +
        '<i class="bi bi-box-arrow-up-left"></i><span>Back to public site</span>' +
      '</a>';
    aside.appendChild(footer);

    return aside;
  }

  // ---------- Top bar ----------

  function renderTopBar(session, pageTitle) {
    const header = document.createElement('header');
    header.className = 'admin-header';

    const title = document.createElement('h1');
    title.className = 'admin-header__title';
    title.textContent = pageTitle || '';
    header.appendChild(title);

    const user = document.createElement('div');
    user.className = 'admin-header__user';

    const badgeText = session.role === 'super_admin' ? 'Super-admin' : 'Admin';
    const badgeClass = session.role === 'super_admin' ? 'role-badge--super' : 'role-badge--admin';

    user.innerHTML =
      '<span class="role-badge ' + badgeClass + '">' + badgeText + '</span>' +
      '<span class="admin-header__email">' + escapeHtml(session.email) + '</span>' +
      '<button type="button" class="btn btn--secondary btn--sm" id="admin-sign-out">' +
        '<i class="bi bi-box-arrow-right"></i> Sign out' +
      '</button>';

    header.appendChild(user);
    return header;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Sponsor name wrapped in a Google Maps search link. Appended " Singapore"
  // narrows results to local hits since most SG sponsor names are chains.
  function mapsLink(name) {
    const safe = escapeHtml(name);
    const q = encodeURIComponent(name + ' Singapore');
    return '<a class="maps-link" href="https://www.google.com/maps/search/?api=1&query=' + q + '"' +
           ' target="_blank" rel="noopener" title="Look up on Google Maps">' +
           safe + ' <i class="bi bi-geo-alt"></i></a>';
  }

  // ---------- Mount ----------

  function mount(opts) {
    opts = opts || {};
    const session = getSession();

    // Auth guard (skipped only on login page). The sessionStorage cache gives
    // an instant, synchronous decision; the live Supabase session is verified
    // just below to catch a stale cache.
    if (!opts.skipAuth && !session) {
      window.location.href = 'login.html';
      return null;
    }

    // Background verification of the real Supabase session: bounces to login if
    // the cache is stale (token expired, or signed out in another tab). Security
    // itself is enforced server-side by RLS on every query, not by this check.
    if (session && !opts.skipAuth && window.sb) {
      window.sb.auth.getSession().then(function (res) {
        const live = res && res.data ? res.data.session : null;
        if (!live) {
          clearSession();
          window.location.href = 'login.html';
        }
      });
      window.sb.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT') {
          clearSession();
          window.location.href = 'login.html';
        }
      });
    }

    // Super-admin guard: bounce non-super-admins to sponsors list.
    if (opts.requiresSuperAdmin && session && session.role !== 'super_admin') {
      window.location.href = 'sponsors.html';
      return null;
    }

    // Mount demo banner + sidebar + top bar around the existing main content.
    if (!opts.skipShell) {
      const body = document.body;
      const main = document.querySelector('main.admin-main');
      if (!main) {
        console.error('[admin-shell] No <main class="admin-main"> found on page.');
        return session;
      }

      // Wrap everything in admin-shell container
      const shell = document.createElement('div');
      shell.className = 'admin-shell';

      const sidebar = renderSidebar(opts.currentPage, session);
      const content = document.createElement('div');
      content.className = 'admin-content';

      const topBar = renderTopBar(session, opts.pageTitle);
      content.appendChild(topBar);

      // Move main into content
      main.parentNode.removeChild(main);
      content.appendChild(main);

      shell.appendChild(sidebar);
      shell.appendChild(content);

      body.appendChild(shell);

      // Reveal the main content (was hidden via CSS to prevent flash)
      body.classList.add('admin-shell-mounted');

      // Wire sign-out
      const signOutBtn = document.getElementById('admin-sign-out');
      if (signOutBtn) {
        signOutBtn.addEventListener('click', function () {
          if (!confirm('Sign out?')) return;
          const finish = function () {
            clearSession();
            window.location.href = 'login.html';
          };
          // End the real Supabase session first, then clear the local cache.
          if (window.sb) window.sb.auth.signOut().then(finish, finish);
          else finish();
        });
      }
    }

    return session;
  }

  // Expose
  window.AdminShell = {
    mount: mount,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    logActivity: logActivity,
    escapeHtml: escapeHtml,
    mapsLink: mapsLink
  };
})();
