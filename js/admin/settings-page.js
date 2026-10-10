/* ============================================================
   js/admin/settings-page.js
   Super-admin-only Settings page. Three sections:
     1. Team members — list, invite, rename, remove, and transfer
        the super-admin role.
     2. Cooldown & event limits — outreach cap, cooldown days, and
        per-event sponsor caps.
     3. Standing Order PDF — the document shown on the public
        standing-order.html. Any admin may replace it; the upload
        deletes the previous file so one version is stored at a time
        (Storage bucket `standing-order`, see 0023).

   Reads/writes live via window.AdminAPI (Supabase). Team writes and
   settings updates are super-admin only (enforced by RLS). No MOCK_DATA.

   NOTE on remove: removal goes through the remove_admin() RPC, which
   deletes the `admins` row AND the person's Supabase Auth login in one
   transaction. A plain delete would leave the login behind forever.
   See 0010_remove_admin_deletes_login.sql.

   NOTE on invite: inserting the `admins` row is the whitelist half.
   The publishable key cannot create Supabase Auth accounts, so the
   invited person creates their own on first sign-in: they request a
   one-time link from the login page, which is gated on this whitelist
   by is_admin_email(). See 0008_magic_link_onboarding.sql. Admins with
   no linked account yet are shown as "No login yet" in the team list.
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
      pageTitle: 'Settings'
    });
    if (!session) return;

    // Any admin may open this page and edit the cooldown/event limits. Managing
    // the team stays super-admin only: the roster below is read-only for a
    // normal admin, and RLS (admins_write) enforces that regardless of the UI.
    const canManageTeam = session.role === 'super_admin';

    const esc = window.AdminShell.escapeHtml;

    // ---------- state ----------
    let admins = [];
    let settings = {};

    // ---------- elements ----------
    const tbody = document.getElementById('team-tbody');
    const countEl = document.getElementById('team-count');
    const inviteOpenBtn = document.getElementById('invite-open-btn');
    const teamReadonlyNote = document.getElementById('team-readonly-note');

    const inviteName = document.getElementById('invite-name');
    const inviteEmail = document.getElementById('invite-email');
    const inviteSubmit = document.getElementById('invite-submit');

    const transferTargetEl = document.getElementById('transfer-target-email');
    const transferConfirm = document.getElementById('transfer-confirm');

    const setCap = document.getElementById('set-cap');
    const setCooldown = document.getElementById('set-cooldown');
    const setEventSmall = document.getElementById('set-event-small');
    const setEventMedium = document.getElementById('set-event-medium');
    const setEventLarge = document.getElementById('set-event-large');
    const settingsSave = document.getElementById('settings-save');

    const soCurrent = document.getElementById('so-current');
    const soDropZone = document.getElementById('so-drop-zone');
    const soFileInput = document.getElementById('so-file-input');
    const soDropTitle = document.getElementById('so-drop-title');

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

    // Added to the whitelist but never signed in, so no auth account is linked
    // yet. Flags the case where someone was invited and never onboarded.
    function pendingBadge(admin) {
      if (admin.user_id) return '';
      return ' <span class="pill pill--caution" title="This admin has not signed in yet. ' +
             'They sign in themselves from the login page using a one-time link.">' +
             '<i class="bi bi-hourglass-split pill__icon"></i>No login yet</span>';
    }

    function emailLooksValid(s) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    }
    // The admins table CHECK requires an SMU address: smu.edu.sg itself or
    // any of its subdomains (sa., computing., business., and so on).
    function isSmuEmail(s) {
      return /@([a-z0-9-]+\.)*smu\.edu\.sg$/i.test(s);
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
        if (!canManageTeam) {
          actions = '<span class="text-xs text-muted">-</span>';
        } else if (self && isSuper) {
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
                (canManageTeam
                  ? ' <button type="button" class="table__action table__action--inline" data-action="edit-name" data-email="' + esc(a.email) + '" title="Edit name" aria-label="Edit name">' +
                      '<i class="bi bi-pencil"></i>' +
                    '</button>'
                  : '') +
              '</div>' +
            '</td>' +
            '<td><span class="text-sm text-secondary">' + esc(a.email) + '</span></td>' +
            '<td>' + roleBadge(a.role) + pendingBadge(a) + '</td>' +
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
      if (!canManageTeam) {
        toastMsg({ type: 'error', title: 'Super-admin only', message: 'Only a super-admin can change the team.' });
        return;
      }
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

      toastMsg({ type: 'success', title: 'Name updated', message: name });
      render();
    }

    // ---------- invite ----------
    function resetInviteForm() {
      inviteName.value = '';
      inviteEmail.value = '';
    }

    async function submitInvite() {
      if (!canManageTeam) {
        toastMsg({ type: 'error', title: 'Super-admin only', message: 'Only a super-admin can change the team.' });
        return;
      }
      const name = inviteName.value.trim();
      const email = inviteEmail.value.trim().toLowerCase();

      if (!name) {
        toastMsg({ type: 'error', title: 'Name required', message: 'Enter the admin’s name.' });
        return;
      }
      if (!emailLooksValid(email) || !isSmuEmail(email)) {
        toastMsg({ type: 'error', title: 'Invalid email', message: 'Admin emails must be an SMU address ending in smu.edu.sg.' });
        return;
      }
      if (findAdmin(email)) {
        toastMsg({ type: 'error', title: 'Already an admin', message: email + ' is already on the team.' });
        return;
      }
      // Everyone joins as an admin. There is one super-admin at a time (a
      // partial unique index enforces it), and the seat moves with Transfer,
      // so the invite form does not offer the role at all.
      inviteSubmit.disabled = true;
      let created;
      try {
        created = await window.AdminAPI.inviteAdmin({ email: email, name: name, role: 'admin' });
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

      admins.push(created || { email: email, name: name, role: 'admin' });
      toastMsg({
        type: 'success',
        title: 'Admin added',
        message: name + ' is on the team. Ask them to open the admin login page and '
                 + 'choose "Email me a sign-in link" to set up their account.'
      });

      resetInviteForm();
      window.closeModal && window.closeModal('invite-modal');
      render();
    }

    // ---------- remove ----------
    async function removeAdmin(email) {
      if (!canManageTeam) {
        toastMsg({ type: 'error', title: 'Super-admin only', message: 'Only a super-admin can change the team.' });
        return;
      }
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
      if (!confirm('Remove ' + email + ' from the team? '
                   + 'This deletes their login as well, so they lose access immediately '
                   + 'and would have to be invited again from scratch.')) return;

      try {
        await window.AdminAPI.removeAdmin(email);
      } catch (e) {
        toastError('Could not remove admin', e);
        return;
      }

      const idx = admins.indexOf(admin);
      if (idx >= 0) admins.splice(idx, 1);

      toastMsg({ type: 'success', title: 'Admin removed', message: email + ' and their login are gone.' });
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
      if (!canManageTeam) {
        toastMsg({ type: 'error', title: 'Super-admin only', message: 'Only a super-admin can change the team.' });
        return;
      }
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
        { el: setCap,         label: 'Outreach cap',      key: 'outreach_cap' },
        { el: setCooldown,    label: 'Cooldown period',   key: 'cooldown_days' },
        { el: setEventSmall,  label: 'Small event cap',   key: 'event_cap_small' },
        { el: setEventMedium, label: 'Medium event cap',  key: 'event_cap_medium' },
        { el: setEventLarge,  label: 'Large event cap',   key: 'event_cap_large' }
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

      // Nothing actually edited - skip the write (matches the other save paths).
      const unchanged = Object.keys(patch).every(function (k) {
        return Number(settings[k]) === patch[k];
      });
      if (unchanged) {
        toastMsg({ type: 'info', title: 'No changes', message: 'Nothing to save.' });
        return;
      }

      // Confirm, and name every number that moves. These are not this screen's
      // own settings: they re-cap every event at once, including submissions
      // already part-way through their outreach, so lowering an event cap can
      // put a live submission over it and lock its outreach button. Adding a
      // handful of sponsors already asks; this reaches further than that.
      const changes = fields
        .filter(function (f) { return Number(settings[f.key]) !== patch[f.key]; })
        .map(function (f) {
          const was = settings[f.key];
          return f.label + ': ' + (was == null ? 'unset' : was) + ' to ' + patch[f.key];
        });
      if (!confirm('Change the outreach and event limits?\n\n' + changes.join('\n') +
                   '\n\nThis applies to every club and every event straight away, ' +
                   'including submissions already in progress.')) return;

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

      toastMsg({ type: 'success', title: 'Settings saved', message: 'Outreach cap and event limits updated.' });
    }

    // ---------- standing order PDF ----------
    // Mirrors the bucket's file_size_limit (0023). The bucket enforces it
    // regardless; checking here just fails fast with a clear message.
    const SO_MAX_BYTES = 20 * 1024 * 1024;
    const SO_DROP_TITLE = soDropTitle.textContent;
    const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let standingOrder = null;   // { name, url, uploadedAt, size } | null
    let soBusy = false;

    // e.g. "10 Oct 2026, 3:04 pm"
    function formatWhen(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const h = d.getHours() % 12 || 12;
      const m = String(d.getMinutes()).padStart(2, '0');
      return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear() +
             ', ' + h + ':' + m + ' ' + (d.getHours() < 12 ? 'am' : 'pm');
    }

    function formatBytes(n) {
      if (!n && n !== 0) return '';
      if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
      return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function renderStandingOrder(loadError) {
      let icon, name, meta, actions = '';
      if (loadError) {
        icon = 'bi-exclamation-triangle';
        name = 'Could not load the current PDF';
        meta = loadError.message || 'Please refresh and try again.';
      } else if (!standingOrder) {
        icon = 'bi-file-earmark-x';
        name = 'No PDF uploaded yet';
        meta = 'The public page points students to the SMUSA Gazette until one is uploaded.';
      } else {
        icon = 'bi-file-earmark-pdf';
        name = 'Standing Order PDF';
        meta = ['Uploaded ' + formatWhen(standingOrder.uploadedAt), formatBytes(standingOrder.size)]
          .filter(Boolean).join(' · ');
        actions =
          '<a class="btn btn--secondary btn--sm" href="' + esc(standingOrder.url) + '" target="_blank" rel="noopener">' +
            '<i class="bi bi-eye"></i> View PDF' +
          '</a>' +
          '<a class="btn btn--tertiary btn--sm" href="../standing-order.html" target="_blank" rel="noopener">' +
            '<i class="bi bi-box-arrow-up-right"></i> Public page' +
          '</a>';
      }
      soCurrent.innerHTML =
        '<div class="upload-status">' +
          '<div class="upload-status__icon"><i class="bi ' + icon + '"></i></div>' +
          '<div class="upload-status__body">' +
            '<div class="upload-status__name">' + esc(name) + '</div>' +
            '<div class="upload-status__meta">' + esc(meta) + '</div>' +
          '</div>' +
          (actions ? '<div class="upload-status__actions">' + actions + '</div>' : '') +
        '</div>';
    }

    function setSoBusy(busy) {
      soBusy = busy;
      soDropZone.classList.toggle('is-busy', busy);
      soFileInput.disabled = busy;
      soDropTitle.textContent = busy ? 'Uploading…' : SO_DROP_TITLE;
    }

    // A real PDF starts with "%PDF-". Checked so a renamed Word or image file
    // is refused here instead of being published as a page that cannot open.
    async function looksLikePdf(file) {
      try {
        return (await file.slice(0, 5).text()) === '%PDF-';
      } catch (e) {
        return true;   // cannot read it here; let the bucket's type check decide
      }
    }

    async function handleStandingOrderFile(file) {
      if (soBusy) return;
      soFileInput.value = '';   // so choosing the same file again still fires change

      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        toastMsg({ type: 'error', title: 'PDF only', message: file.name + ' is not a PDF.' });
        return;
      }
      if (file.size > SO_MAX_BYTES) {
        toastMsg({ type: 'error', title: 'File too large', message: file.name + ' is ' + formatBytes(file.size) + '. The limit is 20 MB.' });
        return;
      }
      if (!file.size || !(await looksLikePdf(file))) {
        toastMsg({ type: 'error', title: 'Not a valid PDF', message: file.name + ' could not be read as a PDF.' });
        return;
      }

      const prompt = standingOrder
        ? 'Replace the Standing Order PDF with "' + file.name + '"?\n\n' +
          'The current PDF (uploaded ' + formatWhen(standingOrder.uploadedAt) + ') is deleted, ' +
          'and students see the new one on the public page straight away.'
        : 'Publish "' + file.name + '" as the Standing Order PDF?\n\n' +
          'Students see it on the public page straight away.';
      if (!confirm(prompt)) return;

      setSoBusy(true);
      let result;
      try {
        result = await window.AdminAPI.uploadStandingOrder(file);
      } catch (e) {
        setSoBusy(false);
        toastError('Could not upload the PDF', e);
        return;
      }
      setSoBusy(false);

      standingOrder = result.file;
      renderStandingOrder();

      if (result.cleanupError) {
        console.error('[settings] standing order clean-up', result.cleanupError);
        toastMsg({
          type: 'warning',
          title: 'PDF published, old file not deleted',
          message: 'Students already see the new PDF. The previous file is removed automatically on the next upload.'
        });
      } else {
        toastMsg({ type: 'success', title: 'Standing Order updated', message: file.name + ' is now on the public page.' });
      }
    }

    soDropZone.addEventListener('dragenter', soDragOver);
    soDropZone.addEventListener('dragover', soDragOver);
    function soDragOver(e) { e.preventDefault(); if (!soBusy) soDropZone.classList.add('is-drag-over'); }
    ['dragleave', 'drop'].forEach(function (evt) {
      soDropZone.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === 'dragleave' && e.target !== soDropZone) return;
        soDropZone.classList.remove('is-drag-over');
      });
    });
    soDropZone.addEventListener('drop', function (e) {
      const file = e.dataTransfer.files[0];
      if (file) handleStandingOrderFile(file);
    });
    soFileInput.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) handleStandingOrderFile(file);
    });

    // ---------- role-based UI ----------
    // The team section is read-only for a normal admin: no invite, no row
    // actions, no rename. Cooldown and event limits stay editable for everyone.
    if (!canManageTeam) {
      if (inviteOpenBtn) inviteOpenBtn.hidden = true;
      if (teamReadonlyNote) teamReadonlyNote.hidden = false;
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
        toastError('Could not load the settings page', e);
        admins = [];
        settings = {};
      }
      render();
      loadSettings();
    })();

    // Separate from the boot above so a Storage hiccup cannot blank the team
    // list or the limits, and vice versa.
    (async function bootStandingOrder() {
      soCurrent.innerHTML = '<div class="text-sm text-muted">Loading…</div>';
      try {
        standingOrder = await window.AdminAPI.getStandingOrder();
      } catch (e) {
        console.error('[settings] could not load the standing order PDF', e);
        renderStandingOrder(e);
        return;
      }
      renderStandingOrder();
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
