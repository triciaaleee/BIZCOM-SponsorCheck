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

  function logActivity(action, entity, details) {
    if (!window.MOCK_DATA) return;
    const session = getSession();
    if (!session) return;
    const entry = {
      id: 'a-' + Date.now().toString(36),
      at: new Date().toISOString(),
      actor: session.email,
      action: action,
      entity: entity,
      details: details || ''
    };
    window.MOCK_DATA.activity.unshift(entry);
  }

  // ---------- Demo banner ----------

  function renderDemoBanner() {
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML =
      '<i class="bi bi-cone-striped"></i>' +
      '<span><strong>Demo mode.</strong> ' +
      'Mock authentication, mock data. ' +
      'Changes do not persist across browser sessions.</span>';
    return banner;
  }

  // ---------- Sidebar ----------

  const NAV_ITEMS = [
    { href: 'sponsors.html',    label: 'Sponsors',    icon: 'bi-building'   },
    { href: 'submissions.html', label: 'Submissions', icon: 'bi-inbox-fill' },
    { href: 'activity.html',    label: 'Activity',    icon: 'bi-clock-history' }
  ];

  function renderSidebar(currentPage) {
    const aside = document.createElement('aside');
    aside.className = 'admin-nav';
    aside.setAttribute('aria-label', 'Admin navigation');

    const brand = document.createElement('a');
    brand.href = 'sponsors.html';
    brand.className = 'admin-nav__brand';
    brand.innerHTML =
      '<img src="../admin/assets/bizcom-logo.png" alt="SMU BIZCOM">' +
      '<span class="admin-nav__brand-sub">Admin</span>';
    aside.appendChild(brand);

    const list = document.createElement('nav');
    list.className = 'admin-nav__list';

    NAV_ITEMS.forEach(function (item) {
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

  // ---------- Mount ----------

  function mount(opts) {
    opts = opts || {};
    const session = getSession();

    // Auth guard (skipped only on login page)
    if (!opts.skipAuth && !session) {
      window.location.href = 'login.html';
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

      const sidebar = renderSidebar(opts.currentPage);
      const content = document.createElement('div');
      content.className = 'admin-content';

      const topBar = renderTopBar(session, opts.pageTitle);
      content.appendChild(topBar);

      // Move main into content
      main.parentNode.removeChild(main);
      content.appendChild(main);

      shell.appendChild(sidebar);
      shell.appendChild(content);

      // Demo banner at very top, above shell
      body.insertBefore(renderDemoBanner(), body.firstChild);
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
    escapeHtml: escapeHtml
  };
})();
