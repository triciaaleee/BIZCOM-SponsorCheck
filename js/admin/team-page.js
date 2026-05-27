/* ============================================================
   js/admin/team-page.js
   Super-admin-only page: list, invite, promote, demote, remove,
   and transfer the super-admin role.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.MOCK_DATA) {
      requestAnimationFrame(init);
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'team.html',
      pageTitle: 'Team',
      requiresSuperAdmin: true
    });
    if (!session) return;

    const esc = window.AdminShell.escapeHtml;

    // ---------- elements ----------
    const tbody = document.getElementById('team-tbody');
    const countEl = document.getElementById('team-count');

    const inviteEmail = document.getElementById('invite-email');
    const inviteRole = document.getElementById('invite-role');
    const inviteSubmit = document.getElementById('invite-submit');

    const transferTargetEl = document.getElementById('transfer-target-email');
    const transferConfirm = document.getElementById('transfer-confirm');

    // ---------- helpers ----------
    function formatDate(iso) {
      if (!iso) return '-';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    function roleBadge(role) {
      if (role === 'super_admin') {
        return '<span class="role-badge role-badge--super">Super-admin</span>';
      }
      return '<span class="role-badge role-badge--admin">Admin</span>';
    }

    function shortActor(email) {
      if (!email) return '-';
      if (email === 'system') return 'system';
      return email.split('@')[0] + '@';
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
            '<td><div class="table__cell-primary">' + esc(a.email) + youTag + '</div></td>' +
            '<td>' + roleBadge(a.role) + '</td>' +
            '<td><span class="text-xs text-muted">' + esc(formatDate(a.added_at)) + '</span></td>' +
            '<td><span class="text-xs text-muted">' + esc(shortActor(a.added_by)) + '</span></td>' +
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
        });
      });
    }

    // ---------- invite ----------
    function resetInviteForm() {
      inviteEmail.value = '';
      inviteRole.value = 'admin';
    }

    function submitInvite() {
      const email = inviteEmail.value.trim().toLowerCase();
      const role = inviteRole.value;

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

      window.MOCK_DATA.admins.push({
        email: email,
        role: role,
        added_at: new Date().toISOString().slice(0, 10),
        added_by: session.email
      });

      window.AdminShell.logActivity('admin.added', email, 'Invited as ' + role);
      window.toast && window.toast({ type: 'success', title: 'Admin added', message: email });

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

    // ---------- wire ----------
    inviteSubmit.addEventListener('click', submitInvite);
    transferConfirm.addEventListener('click', doTransfer);

    // ---------- boot ----------
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
