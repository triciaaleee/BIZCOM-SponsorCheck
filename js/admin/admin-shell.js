/* ============================================================
   js/admin/admin-shell.js
   Shared admin shell logic, loaded on every admin page except
   login.html.

   Responsibilities:
   1. Auth guard: if no session, redirect to login.
   2. Render sidebar nav with active-page highlight.
   3. Render top-bar with signed-in email + role badge + sign out.
   4. Mock action helpers: logActivity, signOut.

   When Supabase lands, the session check becomes a Supabase
   auth.getUser() call and logActivity becomes a Supabase insert.
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

  // The Activity page and its mock data were removed. logActivity is kept as a
  // no-op so existing call sites stay valid; wire a Supabase audit insert here
  // if a server-side audit trail is reintroduced later.
  function logActivity(/* action, entity, details */) {}

  // ---------- Sidebar ----------

  const NAV_ITEMS = [
    { href: 'home.html',        label: 'Home',        icon: 'bi-house-door-fill' },
    { href: 'sponsors.html',    label: 'Sponsors',    icon: 'bi-building'      },
    { href: 'bulk.html',        label: 'Bulk tools',  icon: 'bi-cloud-arrow-up-fill' },
    { href: 'settings.html',    label: 'Settings',    icon: 'bi-gear-fill',    superOnly: true }
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

  /*
   * Send the invite email to a newly added admin.
   *
   * MOCK MODE (today): logs to console, shows a success toast so the
   * inviting admin sees confirmation.
   *
   * SUPABASE MODE (Phase 2): swap the body for:
   *
   *   await supabase.auth.admin.inviteUserByEmail(admin.email, {
   *     data: { name: admin.name, role: admin.role },
   *     redirectTo: 'https://your-domain.tld/admin/login.html'
   *   });
   *
   * Supabase emails a magic-link signup automatically. The {data} payload
   * lands in user_metadata on the new auth.user row so you can read name
   * and role after they sign in.
   */
  function sendInviteEmail(admin) {
    if (!admin || !admin.email) return;
    console.log('[sendInviteEmail] would email', admin.email,
      'with name="' + (admin.name || '') + '" role="' + (admin.role || 'admin') + '"');
    if (window.toast) {
      window.toast({
        type: 'success',
        title: 'Invite sent',
        message: (admin.name || admin.email) + ' will receive a signup link.'
      });
    }
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

    // Auth guard (skipped only on login page)
    if (!opts.skipAuth && !session) {
      window.location.href = 'login.html';
      return null;
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
          if (confirm('Sign out?')) {
            clearSession();
            window.location.href = 'login.html';
          }
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
    sendInviteEmail: sendInviteEmail,
    escapeHtml: escapeHtml,
    mapsLink: mapsLink
  };
})();
