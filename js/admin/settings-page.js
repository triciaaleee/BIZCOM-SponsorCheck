/* ============================================================
   js/admin/settings-page.js
   Super-admin-only Settings page. Two sections:
     1. Team members — list, invite, promote, demote, remove, and
        transfer the super-admin role.
     2. Cooldown & event limits — outreach cap, cooldown days, and
        per-event sponsor caps.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.MOCK_DATA) {
      requestAnimationFrame(init);
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'settings.html',
      pageTitle: 'Settings',
      requiresSuperAdmin: true
    });
    if (!session) return;

    const esc = window.AdminShell.escapeHtml;

    // ---------- elements ----------
    const tbody = document.getElementById('team-tbody');
    const countEl = document.getElementById('team-count');

    const inviteName = document.getElementById('invite-name');
    const inviteEmail = document.getElementById('invite-email');
    const inviteRole = document.getElementById('invite-role');
    const inviteSubmit = document.getElementById('invite-submit');

    const transferTargetEl = document.getElementById('transfer-target-email');
    const transferConfirm = document.getElementById('transfer-confirm');

    // Settings section
    const setCap = document.getElementById('set-cap');
    const setCooldown = document.getElementById('set-cooldown');
    const setEventSmall = document.getElementById('set-event-small');
    const setEventMedium = document.getElementById('set-event-medium');
    const setEventLarge = document.getElementById('set-event-large');
    const settingsSave = document.getElementById('settings-save');

    // ---------- helpers ----------
    function roleBadge(role) {
      if (role === 'super_admin') {
        return '<span class="role-badge role-badge--super">Super-admin</span>';
      }
      return '<span class="role-badge role-badge--admin">Admin</span>';
    }

    function emailLooksValid(s) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    }

    function isSelf(admin) {
      return admin.email === session.email;
    }

    function findAdmin(email) {
      return window.MOCK_DATA.admins.find(function (a) { return a.email === email; });
    }

    // ---------- render ----------
    function render() {
      const admins = window.MOCK_DATA.admins.slice().sort(function (a, b) {
        // Super-admin pinned first, then alphabetical by email.
        if (a.role !== b.role) return a.role === 'super_admin' ? -1 : 1;
        return a.email.localeCompare(b.email);
      });

      countEl.textContent = admins.length;

      tbody.innerHTML = admins.map(function (a) {
        const self = isSelf(a);
        const isSuper = a.role === 'super_admin';
        const youTag = self ? ' <span class="text-xs text-muted">(you)</span>' : '';

        let actions = '';
        if (self && isSuper) {
          // Acting super-admin: no destructive actions on yourself.
          actions = '<span class="text-xs text-muted">Use Transfer on another admin</span>';
        } else if (isSuper) {
          // Should never happen unless data has multiple super-admins.
          actions = '<span class="text-xs text-muted">-</span>';
        } else {
          actions =
            '<button type="button" class="btn btn--secondary btn--sm" data-action="transfer" data-email="' + esc(a.email) + '">' +
              '<i class="bi bi-arrow-left-right"></i> Transfer super-admin' +
            '</button>' +
            ' ' +
            '<button type="button" class="btn btn--tertiary btn--sm" data-action="remove" data-email="' + esc(a.email) + '">' +
              '<i class="bi bi-trash"></i> Remove' +
            '</button>';
        }

        return (
          '<tr>' +
            '<td>' +
              '<div class="table__cell-primary" data-name-wrap="' + esc(a.email) + '">' +
                '<span class="team-name">' + esc(a.name || '(unnamed)') + '</span>' + youTag +
                ' <button type="button" class="table__action table__action--inline" data-action="edit-name" data-email="' + esc(a.email) + '" title="Edit name" aria-label="Edit name">' +
                  '<i class="bi bi-pencil"></i>' +
                '</button>' +
              '</div>' +
            '</td>' +
            '<td><span class="text-sm text-secondary">' + esc(a.email) + '</span></td>' +
            '<td>' + roleBadge(a.role) + '</td>' +
            '<td class="text-right">' + actions + '</td>' +
          '</tr>'
        );
      }).join('');

      wireActions();
    }

    function wireActions() {
      tbody.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const action = btn.getAttribute('data-action');
          const email = btn.getAttribute('data-email');
          if (action === 'remove') removeAdmin(email);
          if (action === 'transfer') openTransferModal(email);
          if (action === 'edit-name') startEditName(email);
        });
      });
    }

    // ---------- inline name editing ----------
    function startEditName(email) {
      const admin = findAdmin(email);
      if (!admin) return;
      const wrap = tbody.querySelector('[data-name-wrap="' + email + '"]');
      if (!wrap) return;

      wrap.innerHTML =
        '<span class="team-name-edit">' +
          '<input type="text" class="form-input team-name-input" value="' + esc(admin.name || '') + '" maxlength="60" aria-label="Admin name">' +
          '<button type="button" class="btn btn--primary btn--sm" data-name-save title="Save"><i class="bi bi-check-lg"></i></button>' +
          '<button type="button" class="btn btn--secondary btn--sm" data-name-cancel title="Cancel"><i class="bi bi-x"></i></button>' +
        '</span>';

      const input = wrap.querySelector('.team-name-input');
      input.focus();
      input.select();
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveName(email, input.value); }
        else if (e.key === 'Escape') { e.preventDefault(); render(); }
      });
      wrap.querySelector('[data-name-save]').addEventListener('click', function () { saveName(email, input.value); });
      wrap.querySelector('[data-name-cancel]').addEventListener('click', function () { render(); });
    }

    function saveName(email, value) {
      const admin = findAdmin(email);
      if (!admin) return;
      const name = value.trim();
      if (!name) {
        window.toast && window.toast({ type: 'error', title: 'Name required', message: 'Enter a name.' });
        return;
      }
      if (name === admin.name) { render(); return; }

      admin.name = name;
      // If editing your own record, keep the live session name in sync so the
      // top-bar greeting and home page reflect the change immediately.
      if (email === session.email) {
        session.name = name;
        window.AdminShell.setSession(session);
      }

      window.AdminShell.logActivity('admin.updated', email, 'Name changed to "' + name + '"');
      window.toast && window.toast({ type: 'success', title: 'Name updated', message: name });
      render();
    }

    // ---------- invite ----------
    function resetInviteForm() {
      inviteName.value = '';
      inviteEmail.value = '';
      inviteRole.value = 'admin';
    }

    function submitInvite() {
      const name = inviteName.value.trim();
      const email = inviteEmail.value.trim().toLowerCase();
      const role = inviteRole.value;

      if (!name) {
        window.toast && window.toast({ type: 'error', title: 'Name required', message: 'Enter the admin’s name.' });
        return;
      }
      if (!emailLooksValid(email)) {
        window.toast && window.toast({ type: 'error', title: 'Invalid email', message: 'Enter a valid email address.' });
        return;
      }
      if (findAdmin(email)) {
        window.toast && window.toast({ type: 'error', title: 'Already an admin', message: email + ' is already on the team.' });
        return;
      }

      // If inviting a super-admin, demote the current one (transfer semantics).
      // Be loud about it: require confirmation via the transfer flow instead.
      if (role === 'super_admin') {
        window.toast && window.toast({
          type: 'warning',
          title: 'Use transfer instead',
          message: 'Invite as Admin first, then use Transfer super-admin.'
        });
        inviteRole.value = 'admin';
        return;
      }

      const newAdmin = {
        email: email,
        name: name,
        role: role
      };
      window.MOCK_DATA.admins.push(newAdmin);

      window.AdminShell.logActivity('admin.added', email, name + ' invited as ' + role);

      // Fire the invite email (mock now, Supabase later).
      if (window.AdminShell.sendInviteEmail) {
        window.AdminShell.sendInviteEmail(newAdmin);
      } else {
        window.toast && window.toast({ type: 'success', title: 'Admin added', message: email });
      }

      resetInviteForm();
      window.closeModal && window.closeModal('invite-modal');
      render();
    }

    // ---------- remove ----------
    function removeAdmin(email) {
      const admin = findAdmin(email);
      if (!admin) return;
      if (admin.role === 'super_admin') {
        window.toast && window.toast({ type: 'error', title: 'Cannot remove super-admin', message: 'Transfer the role first.' });
        return;
      }
      if (isSelf(admin)) {
        window.toast && window.toast({ type: 'error', title: 'Cannot remove yourself', message: 'Ask another super-admin to remove you.' });
        return;
      }
      if (!confirm('Remove ' + email + ' from the team? This cannot be undone.')) return;

      const idx = window.MOCK_DATA.admins.indexOf(admin);
      if (idx >= 0) window.MOCK_DATA.admins.splice(idx, 1);

      window.AdminShell.logActivity('admin.removed', email, 'Removed by ' + session.email);
      window.toast && window.toast({ type: 'success', title: 'Admin removed', message: email });
      render();
    }

    // ---------- transfer super-admin ----------
    let transferTarget = null;

    function openTransferModal(email) {
      const target = findAdmin(email);
      if (!target) return;
      if (target.role === 'super_admin') {
        window.toast && window.toast({ type: 'info', title: 'Already super-admin', message: email });
        return;
      }
      transferTarget = email;
      transferTargetEl.textContent = email;
      window.openModal && window.openModal('transfer-modal');
    }

    function doTransfer() {
      if (!transferTarget) return;
      const target = findAdmin(transferTarget);
      const me = findAdmin(session.email);
      if (!target || !me) return;

      target.role = 'super_admin';
      me.role = 'admin';

      window.AdminShell.logActivity('admin.role_changed', target.email, 'Promoted to super-admin');
      window.AdminShell.logActivity('admin.role_changed', me.email, 'Demoted to admin (transferred role)');
      window.toast && window.toast({ type: 'success', title: 'Role transferred', message: target.email + ' is now super-admin.' });

      // Update local session role so the rest of the SPA reflects the change.
      session.role = 'admin';
      window.AdminShell.setSession(session);

      transferTarget = null;
      window.closeModal && window.closeModal('transfer-modal');

      // After transfer, this page is no longer accessible. Bounce.
      window.location.href = 'sponsors.html';
    }

    // ---------- settings ----------
    function num(v, fallback) {
      return (v != null) ? v : fallback;
    }

    function loadSettings() {
      const s = window.MOCK_DATA.settings || {};
      setCap.value = num(s.outreach_cap, 10);
      setCooldown.value = num(s.cooldown_days, 30);
      setEventSmall.value = num(s.event_cap_small, 300);
      setEventMedium.value = num(s.event_cap_medium, 600);
      setEventLarge.value = num(s.event_cap_large, 1000);
    }

    function saveSettings() {
      const fields = [
        { el: setCap,         label: 'Outreach cap' },
        { el: setCooldown,    label: 'Cooldown period' },
        { el: setEventSmall,  label: 'Small event cap' },
        { el: setEventMedium, label: 'Medium event cap' },
        { el: setEventLarge,  label: 'Large event cap' }
      ];
      const vals = {};
      for (let i = 0; i < fields.length; i++) {
        const n = parseInt(fields[i].el.value, 10);
        if (!Number.isInteger(n) || n < 1) {
          window.toast && window.toast({
            type: 'error',
            title: 'Invalid value',
            message: fields[i].label + ' must be a whole number of at least 1.'
          });
          fields[i].el.focus();
          return;
        }
        vals[i] = n;
      }

      const s = window.MOCK_DATA.settings;
      s.outreach_cap = vals[0];
      s.cooldown_days = vals[1];
      s.event_cap_small = vals[2];
      s.event_cap_medium = vals[3];
      s.event_cap_large = vals[4];

      // Persist so the change survives navigation and reaches the other pages
      // (admin home + public sponsor-check, same origin). mock-data.js hydrates
      // MOCK_DATA.settings from this key on load. Swap for a Supabase update
      // when the backend lands.
      try {
        const key = window.SETTINGS_STORAGE_KEY || 'sponsorcheck_settings';
        localStorage.setItem(key, JSON.stringify({
          outreach_cap: s.outreach_cap,
          cooldown_days: s.cooldown_days,
          event_cap_small: s.event_cap_small,
          event_cap_medium: s.event_cap_medium,
          event_cap_large: s.event_cap_large
        }));
      } catch (e) { /* storage unavailable — in-memory change still applies this session */ }

      window.AdminShell.logActivity('settings.updated', 'settings',
        'Outreach cap ' + s.outreach_cap + ', cooldown ' + s.cooldown_days + 'd');
      window.toast && window.toast({ type: 'success', title: 'Settings saved', message: 'Outreach cap and event limits updated.' });
    }

    // ---------- wire ----------
    inviteSubmit.addEventListener('click', submitInvite);
    transferConfirm.addEventListener('click', doTransfer);
    settingsSave.addEventListener('click', saveSettings);

    // ---------- boot ----------
    render();
    loadSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
