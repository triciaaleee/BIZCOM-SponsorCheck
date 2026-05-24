/* ============================================================
   js/admin/activity-page.js
   Global audit log. Read-only.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.MOCK_DATA) {
      requestAnimationFrame(init);
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'activity.html',
      pageTitle: 'Activity'
    });
    if (!session) return;

    const esc = window.AdminShell.escapeHtml;

    // ---------- state ----------
    let actorFilter = 'all';
    let actionFilter = 'all';

    // ---------- elements ----------
    const tbody = document.getElementById('activity-tbody');
    const empty = document.getElementById('activity-empty');
    const countEl = document.getElementById('activity-count');
    const actorSel = document.getElementById('filter-actor');
    const actionSel = document.getElementById('filter-action');

    // Populate actors dropdown from admins list
    window.MOCK_DATA.admins.forEach(function (a) {
      const opt = document.createElement('option');
      opt.value = a.email;
      opt.textContent = a.email;
      actorSel.appendChild(opt);
    });

    // ---------- helpers ----------
    function formatDateTime(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const time = d.toTimeString().slice(0, 5);
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + time;
    }

    function actionTag(action) {
      // sponsor.created / sponsor.updated / sponsor.status_changed / sponsor.deleted
      // submission.received / submission.status_changed / submission.updated / submission.viewed
      // admin.added / admin.removed
      const parts = action.split('.');
      const verb = parts[1] || '';
      let cls = 'action-tag--update';
      if (verb === 'created' || verb === 'received') cls = 'action-tag--create';
      else if (verb === 'status_changed') cls = 'action-tag--status';
      else if (parts[0] === 'admin') cls = 'action-tag--admin';
      else if (parts[0] === 'submission') cls = 'action-tag--submit';
      else if (verb === 'deleted') cls = 'action-tag--admin';
      return '<span class="action-tag ' + cls + '">' + esc(action.replace('.', ' ')) + '</span>';
    }

    function roleFor(email) {
      const admin = window.MOCK_DATA.admins.find(function (a) { return a.email === email; });
      if (!admin) return null;
      return admin.role;
    }

    // ---------- render ----------
    function getFiltered() {
      return window.MOCK_DATA.activity.filter(function (e) {
        if (actorFilter !== 'all' && e.actor !== actorFilter) return false;
        if (actionFilter !== 'all' && e.action !== actionFilter) return false;
        return true;
      });
    }

    function render() {
      const rows = getFiltered();
      countEl.textContent = rows.length;
      if (!rows.length) {
        tbody.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';

      tbody.innerHTML = rows.map(function (e) {
        const role = roleFor(e.actor);
        const badge = role === 'super_admin'
          ? '<span class="role-badge role-badge--super" style="margin-left: var(--space-2); font-size: 9px">Super</span>'
          : role === 'admin'
            ? '<span class="role-badge role-badge--admin" style="margin-left: var(--space-2); font-size: 9px">Admin</span>'
            : '';
        return (
          '<tr>' +
            '<td><div class="table__cell-secondary text-nowrap">' + esc(formatDateTime(e.at)) + '</div></td>' +
            '<td>' +
              '<div class="table__cell-secondary font-mono">' + esc(e.actor) + '</div>' +
              badge +
            '</td>' +
            '<td>' +
              '<div>' + actionTag(e.action) + '<span class="table__cell-primary">' + esc(e.entity) + '</span></div>' +
              '<div class="table__cell-secondary">' + esc(e.details || '') + '</div>' +
            '</td>' +
          '</tr>'
        );
      }).join('');
    }

    // ---------- wire events ----------
    actorSel.addEventListener('change', function (e) {
      actorFilter = e.target.value;
      render();
    });
    actionSel.addEventListener('change', function (e) {
      actionFilter = e.target.value;
      render();
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
