/* ============================================================
   js/admin/settings-page.js
   Super-admin-only Settings page. Two sections:
     1. Team members — list, invite, rename, remove, and transfer
        the super-admin role.
     2. Cooldown & event limits — outreach cap, cooldown days, and
        per-event sponsor caps.

   Reads/writes live via window.AdminAPI (Supabase). Team writes and
   settings updates are super-admin only (enforced by RLS). No MOCK_DATA.

   NOTE on invite: inserting the `admins` row is the whitelist half.
   The actual Supabase Auth account (so the person can sign in) is
   created separately in the dashboard / a server-side invite — the
   publishable key can't create auth users. The toast says as much.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.sb || !window.AdminAPI) {
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

    // ---------- state ----------
    let admins = [];
    let settings = {};

    // ---------- elements ----------
    const tbody = document.getElementById('team-tbody');
    const countEl = document.getElementById('team-count');

    const inviteName = document.getElementById('invite-name');
    const inviteEmail = document.getElementById('invite-email');
    const inviteRole = document.getElementById('invite-role');
    const inviteSubmit = document.getElementById('invite-submit');

    const transferTargetEl = document.getElementById('transfer-target-email');
    const transferConfirm = document.getElementById('transfer-confirm');

    const setCap = document.getElementById('set-cap');
    const setCooldown = document.getElementById('set-cooldown');
    const setEventSmall = document.getElementById('set-event-small');
    const setEventMedium = document.getElementById('set-event-medium');
    const setEventLarge = document.getElementById('set-event-large');
    const settingsSave = document.getElementById('settings-save');

    // ---------- helpers ----------
    function toastMsg(o) { if (window.toast) window.toast(o); }
    function toastError(title, e) {
      console.error('[settings]', title, e);
      toastMsg({ type: 'error', title: title, message: (e && e.message) || 'Please try again.' });
    }

    function roleBadge(role) {
      if (role === 'super_admin') return '<span class="role-badge role-badge--super">Super-admin</span>';
      return '<span class="role-badge role-badge--admin">Admin</span>';
    }

    function emailLooksValid(s) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    }
    // The admins table CHECK requires the SMU staff domain.
    function isSmuEmail(s) {
      return /@sa\.smu\.edu\.sg$/i.test(s);
    }

    function isSelf(admin) { return admin.email === session.email; }
    function findAdmin(email) { return admins.find(function (a) { return a.email === email; }); }

    // ---------- render ----------
    function render() {
      const sorted = admins.slice().sort(function (a, b) {
        if (a.role !== b.role) return a.role === 'super_admin' ? -1 : 1;
        return a.email.localeCompare(b.email);
      });

      countEl.textContent = admins.length;

      tbody.innerHTML = sorted.map(function (a) {
        const self = isSelf(a);
        const isSuper = a.role === 'super_admin';
        const youTag = self ? ' <span class="text-xs text-muted">(you)</span>' : '';

        let actions = '';
        if (self && isSuper) {
          actions = '<span class="text-xs text-muted">Use Transfer on another admin</span>';
        } else if (isSuper) {
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

    async function saveName(email, value) {
      const admin = findAdmin(email);
      if (!admin) return;
      const name = value.trim();
      if (!name) {
        toastMsg({ type: 'error', title: 'Name required', message: 'Enter a name.' });
        return;
      }
      if (name === admin.name) { render(); return; }

      try {
        await window.AdminAPI.updateAdminName(email, name);
      } catch (e) {
        toastError('Could not update name', e);
        return;
      }

      admin.name = name;
      // Keep the live session name in sync if editing your own record.
      if (email === session.email) {
        session.name = name;
        window.AdminShell.setSession(session);
      }

      window.AdminShell.logActivity('admin.updated', email, 'Name changed to "' + name + '"');
      toastMsg({ type: 'success', title: 'Name updated', message: name });
      render();
    }

    // ---------- invite ----------
    function resetInviteForm() {
      inviteName.value = '';
      inviteEmail.value = '';
      inviteRole.value = 'admin';
    }

    async function submitInvite() {
      const name = inviteName.value.trim();
      const email = inviteEmail.value.trim().toLowerCase();
      const role = inviteRole.value;

      if (!name) {
        toastMsg({ type: 'error', title: 'Name required', message: 'Enter the admin’s name.' });
        return;
      }
      if (!emailLooksValid(email) || !isSmuEmail(email)) {
        toastMsg({ type: 'error', title: 'Invalid email', message: 'Admin emails must end with @sa.smu.edu.sg.' });
        return;
      }
      if (findAdmin(email)) {
        toastMsg({ type: 'error', title: 'Already an admin', message: email + ' is already on the team.' });
        return;
      }
      // One super-admin at a time — invite as admin, then Transfer.
      if (role === 'super_admin') {
        toastMsg({ type: 'warning', title: 'Use transfer instead', message: 'Invite as Admin first, then use Transfer super-admin.' });
        inviteRole.value = 'admin';
        return;
      }

      inviteSubmit.disabled = true;
      let created;
      try {
        created = await window.AdminAPI.inviteAdmin({ email: email, name: name, role: role });
      } catch (e) {
        inviteSubmit.disabled = false;
        if (window.AdminAPI.isUniqueViolation(e)) {
          toastMsg({ type: 'error', title: 'Already an admin', message: email + ' is already on the team.' });
        } else {
          toastError('Could not add admin', e);
        }
        return;
      }
      inviteSubmit.disabled = false;

      admins.push(created || { email: email, name: name, role: role });
      window.AdminShell.logActivity('admin.added', email, name + ' invited as ' + role);
      toastMsg({
        type: 'success',
        title: 'Admin added',
        message: name + ' is on the team. Create their login in Supabase Auth so they can sign in.'
      });

      resetInviteForm();
      window.closeModal && window.closeModal('invite-modal');
      render();
    }

    // ---------- remove ----------
    async function removeAdmin(email) {
      const admin = findAdmin(email);
      if (!admin) return;
      if (admin.role === 'super_admin') {
        toastMsg({ type: 'error', title: 'Cannot remove super-admin', message: 'Transfer the role first.' });
        return;
      }
      if (isSelf(admin)) {
        toastMsg({ type: 'error', title: 'Cannot remove yourself', message: 'Ask another super-admin to remove you.' });
        return;
      }
      if (!confirm('Remove ' + email + ' from the team? This cannot be undone.')) return;

      try {
        await window.AdminAPI.removeAdmin(email);
      } catch (e) {
        toastError('Could not remove admin', e);
        return;
      }

      const idx = admins.indexOf(admin);
      if (idx >= 0) admins.splice(idx, 1);

      window.AdminShell.logActivity('admin.removed', email, 'Removed by ' + session.email);
      toastMsg({ type: 'success', title: 'Admin removed', message: email });
      render();
    }

    // ---------- transfer super-admin ----------
    let transferTarget = null;

    function openTransferModal(email) {
      const target = findAdmin(email);
      if (!target) return;
      if (target.role === 'super_admin') {
        toastMsg({ type: 'info', title: 'Already super-admin', message: email });
        return;
      }
      transferTarget = email;
      transferTargetEl.textContent = email;
      window.openModal && window.openModal('transfer-modal');
    }

    async function doTransfer() {
      if (!transferTarget) return;
      const target = findAdmin(transferTarget);
      const me = findAdmin(session.email);
      if (!target || !me) return;

      transferConfirm.disabled = true;
      try {
        await window.AdminAPI.transferSuperAdmin(transferTarget);
      } catch (e) {
        transferConfirm.disabled = false;
        toastError('Could not transfer role', e);
        return;
      }

      target.role = 'super_admin';
      me.role = 'admin';

      window.AdminShell.logActivity('admin.role_changed', target.email, 'Promoted to super-admin');
      window.AdminShell.logActivity('admin.role_changed', me.email, 'Demoted to admin (transferred role)');
      toastMsg({ type: 'success', title: 'Role transferred', message: target.email + ' is now super-admin.' });

      // This page is super-admin only; update the session and bounce.
      session.role = 'admin';
      window.AdminShell.setSession(session);

      transferTarget = null;
      window.closeModal && window.closeModal('transfer-modal');
      window.location.href = 'sponsors.html';
    }

    // ---------- settings ----------
    function num(v, fallback) { return (v != null) ? v : fallback; }

    function loadSettings() {
      setCap.value = num(settings.outreach_cap, 10);
      setCooldown.value = num(settings.cooldown_days, 30);
      setEventSmall.value = num(settings.event_cap_small, 300);
      setEventMedium.value = num(settings.event_cap_medium, 600);
      setEventLarge.value = num(settings.event_cap_large, 1000);
    }

    async function saveSettings() {
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
          toastMsg({ type: 'error', title: 'Invalid value', message: fields[i].label + ' must be a whole number of at least 1.' });
          fields[i].el.focus();
          return;
        }
        vals[i] = n;
      }

      const patch = {
        outreach_cap: vals[0],
        cooldown_days: vals[1],
        event_cap_small: vals[2],
        event_cap_medium: vals[3],
        event_cap_large: vals[4]
      };

      settingsSave.disabled = true;
      let updated;
      try {
        updated = await window.AdminAPI.updateSettings(patch);
      } catch (e) {
        settingsSave.disabled = false;
        toastError('Could not save settings', e);
        return;
      }
      settingsSave.disabled = false;

      settings = updated || Object.assign(settings, patch);

      // Bridge: also mirror to localStorage so the not-yet-wired public checker
      // (which reads settings via mock-data.js) reflects the change. Drop this
      // once the public pages read settings from Supabase directly.
      try {
        const key = window.SETTINGS_STORAGE_KEY || 'sponsorcheck_settings';
        localStorage.setItem(key, JSON.stringify(patch));
      } catch (e) { /* storage unavailable — DB is still the source of truth */ }

      window.AdminShell.logActivity('settings.updated', 'settings',
        'Outreach cap ' + patch.outreach_cap + ', cooldown ' + patch.cooldown_days + 'd');
      toastMsg({ type: 'success', title: 'Settings saved', message: 'Outreach cap and event limits updated.' });
    }

    // ---------- wire ----------
    inviteSubmit.addEventListener('click', submitInvite);
    transferConfirm.addEventListener('click', doTransfer);
    settingsSave.addEventListener('click', saveSettings);

    // ---------- boot ----------
    (async function boot() {
      try {
        const out = await Promise.all([window.AdminAPI.listAdmins(), window.AdminAPI.getSettings()]);
        admins = out[0] || [];
        settings = out[1] || {};
      } catch (e) {
        toastError('Could not load settings', e);
        admins = [];
        settings = {};
      }
      render();
      loadSettings();
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
