/* ============================================================
   js/admin/submissions-page.js
   Inbox-style list with side-panel for create + detail editing.
   Inline status edit on the list (Monday-style popover).
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.MOCK_DATA) {
      requestAnimationFrame(init);
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'submissions.html',
      pageTitle: 'Submissions'
    });
    if (!session) return;

    const esc = window.AdminShell.escapeHtml;

    // ---------- state ----------
    let activeStatus = 'all';
    let mode = 'edit';           // 'edit' or 'create'
    let openSubmissionId = null;
    let pendingStatus = null;
    let inlineMenu = null;       // currently open inline status menu element

    // ---------- elements ----------
    const tbody = document.getElementById('submissions-tbody');
    const empty = document.getElementById('submissions-empty');
    const tabs = document.querySelectorAll('.admin-tab');
    const countLabel = document.getElementById('submissions-count');
    const addBtn = document.getElementById('add-submission');

    const backdrop = document.getElementById('panel-backdrop');
    const panel = document.getElementById('side-panel');
    const closeBtn = document.getElementById('panel-close');
    const cancelBtn = document.getElementById('panel-cancel');
    const saveBtn = document.getElementById('panel-save');
    const saveLabel = document.getElementById('panel-save-label');

    const panelTitle = document.getElementById('panel-title');
    const panelSub = document.getElementById('panel-sub');
    const panelEventInput = document.getElementById('panel-event-input');
    const panelClubInput = document.getElementById('panel-club-input');
    const panelContactInput = document.getElementById('panel-contact-input');
    const panelSizeInput = document.getElementById('panel-size-input');
    const panelSpcountInput = document.getElementById('panel-spcount-input');
    const panelCompleteByInput = document.getElementById('panel-complete-by-input');
    const panelSubmittedEl = document.getElementById('panel-submitted');
    const panelReviewedEl = document.getElementById('panel-reviewed');
    const panelSponsorsTbody = document.getElementById('panel-sponsors-tbody');
    const panelMetaSection = document.getElementById('panel-meta-section');
    const panelSponsorsSection = document.getElementById('panel-sponsors-section');
    const panelNotes = document.getElementById('panel-notes');
    const panelStatusBtns = document.querySelectorAll('[data-panel-status]');

    // ---------- helpers ----------
    function formatDateTime(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const time = d.toTimeString().slice(0,5);
      return d.getDate() + ' ' + months[d.getMonth()] + ', ' + time;
    }

    function formatDateShort(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    function startOfToday() {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      return t;
    }

    function daysUntil(iso) {
      const target = new Date(iso);
      target.setHours(0, 0, 0, 0);
      const diff = target.getTime() - startOfToday().getTime();
      return Math.round(diff / 86400000);
    }

    function urgencyClass(sub) {
      if (sub.status === 'completed') return '';
      if (!sub.complete_by) return '';
      const n = daysUntil(sub.complete_by);
      if (n < 0) return 'is-overdue';
      if (n <= 3) return 'is-soon';
      return '';
    }

    function statusLabel(status) {
      return ({ new: 'New', reviewing: 'Reviewing', completed: 'Completed' })[status] || status;
    }

    function statusPillHtml(status, editable) {
      const cls = 'status-pill status-pill--' + status + (editable ? ' status-pill--edit' : '');
      const caret = editable ? ' <i class="bi bi-caret-down-fill"></i>' : '';
      return '<span class="' + cls + '" data-current-status="' + status + '">' + statusLabel(status) + caret + '</span>';
    }

    function rowStatusPill(rowStatus) {
      const map = {
        clear:      { cls: 'status-pill--master', label: 'Clear' },
        caution:    { cls: 'status-pill--alumni', label: 'Caution' },
        alumni:     { cls: 'status-pill--alumni', label: 'Alumni' },
        blocked:    { cls: 'status-pill--banned', label: 'Blocked' },
        cooldown:   { cls: 'status-pill--banned', label: 'Cooldown' },
        unverified: { cls: 'status-pill--closed', label: 'Unverified' }
      };
      const m = map[rowStatus] || { cls: 'status-pill--closed', label: rowStatus };
      return '<span class="status-pill ' + m.cls + '">' + m.label + '</span>';
    }

    function sizeLabel(s) {
      return { small: 'Small (<50)', medium: 'Medium (50-150)', large: 'Large (>150)' }[s] || s;
    }

    function countsByStatus() {
      const c = { all: 0, new: 0, reviewing: 0, completed: 0 };
      window.MOCK_DATA.submissions.forEach(function (s) {
        c.all++;
        if (c[s.status] !== undefined) c[s.status]++;
      });
      return c;
    }

    function getFiltered() {
      const all = window.MOCK_DATA.submissions.slice();
      // Sort ascending by complete_by (most urgent first).
      // Rows without complete_by fall to the bottom.
      all.sort(function (a, b) {
        if (!a.complete_by && !b.complete_by) return 0;
        if (!a.complete_by) return 1;
        if (!b.complete_by) return -1;
        return new Date(a.complete_by) - new Date(b.complete_by);
      });
      if (activeStatus === 'all') return all;
      return all.filter(function (s) { return s.status === activeStatus; });
    }

    // ---------- render ----------
    function renderCounts() {
      const c = countsByStatus();
      ['all', 'new', 'reviewing', 'completed'].forEach(function (k) {
        const el = document.getElementById('sub-count-' + k);
        if (el) el.textContent = c[k];
      });
      countLabel.textContent = c.all;
    }

    function render() {
      closeInlineMenu();
      const rows = getFiltered();
      if (!rows.length) {
        tbody.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';

      tbody.innerHTML = rows.map(function (s) {
        const urg = urgencyClass(s);
        const dueText = s.complete_by ? formatDateShort(s.complete_by) : '-';
        return (
          '<tr data-sub-id="' + esc(s.id) + '">' +
            '<td>' +
              '<div class="table__cell-primary">' + esc(s.event_name) + '</div>' +
              '<div class="table__cell-secondary">' + esc(s.club) + '</div>' +
            '</td>' +
            '<td class="cell-status">' + statusPillHtml(s.status, true) + '</td>' +
            '<td><span class="due-date ' + urg + '">' + esc(dueText) + '</span></td>' +
          '</tr>'
        );
      }).join('');

      // Row click opens panel (but not when clicking the editable status pill).
      tbody.querySelectorAll('tr[data-sub-id]').forEach(function (tr) {
        tr.addEventListener('click', function (e) {
          if (e.target.closest('.status-pill--edit')) return;
          openPanel(tr.getAttribute('data-sub-id'));
        });
      });

      // Status pill click opens inline menu.
      tbody.querySelectorAll('.status-pill--edit').forEach(function (pill) {
        pill.addEventListener('click', function (e) {
          e.stopPropagation();
          const tr = pill.closest('tr[data-sub-id]');
          openInlineMenu(pill, tr.getAttribute('data-sub-id'));
        });
      });
    }

    // ---------- inline status menu ----------
    function closeInlineMenu() {
      if (inlineMenu && inlineMenu.parentNode) {
        inlineMenu.parentNode.removeChild(inlineMenu);
      }
      inlineMenu = null;
    }

    function openInlineMenu(anchor, subId) {
      closeInlineMenu();
      const sub = window.MOCK_DATA.submissions.find(function (s) { return s.id === subId; });
      if (!sub) return;

      const menu = document.createElement('div');
      menu.className = 'status-menu';
      ['new', 'reviewing', 'completed'].forEach(function (st) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'status-menu__item' + (st === sub.status ? ' is-active' : '');
        opt.innerHTML = '<span class="status-pill status-pill--' + st + '">' + statusLabel(st) + '</span>';
        opt.addEventListener('click', function (e) {
          e.stopPropagation();
          changeStatusInline(sub.id, st);
        });
        menu.appendChild(opt);
      });

      // Position under the anchor.
      const r = anchor.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.left = r.left + 'px';

      document.body.appendChild(menu);
      inlineMenu = menu;
    }

    function changeStatusInline(subId, newStatus) {
      const sub = window.MOCK_DATA.submissions.find(function (s) { return s.id === subId; });
      if (!sub || sub.status === newStatus) {
        closeInlineMenu();
        return;
      }
      const oldStatus = sub.status;
      sub.status = newStatus;
      sub.reviewed_by = session.email;
      sub.reviewed_at = new Date().toISOString();

      window.AdminShell.logActivity('submission.status_changed', sub.event_name,
        'Status changed from "' + oldStatus + '" to "' + newStatus + '"');
      window.toast && window.toast({ type: 'success', title: 'Status updated', message: sub.event_name });

      closeInlineMenu();
      renderCounts();
      render();
    }

    // Click-outside / Esc / scroll close the inline menu.
    document.addEventListener('click', function (e) {
      if (inlineMenu && !inlineMenu.contains(e.target) && !e.target.closest('.status-pill--edit')) {
        closeInlineMenu();
      }
    });
    window.addEventListener('scroll', closeInlineMenu, true);
    window.addEventListener('resize', closeInlineMenu);

    // ---------- panel ----------
    function setPanelStatus(s) {
      pendingStatus = s;
      panelStatusBtns.forEach(function (b) {
        const on = b.getAttribute('data-panel-status') === s;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
    }

    function openPanel(submissionId) {
      const sub = window.MOCK_DATA.submissions.find(function (s) { return s.id === submissionId; });
      if (!sub) return;

      mode = 'edit';
      openSubmissionId = submissionId;

      panelTitle.textContent = sub.event_name;
      panelSub.textContent = sub.club;
      panelEventInput.value = sub.event_name;
      panelClubInput.value = sub.club;
      panelContactInput.value = sub.contact_email;
      panelSizeInput.value = sub.event_size;
      panelSpcountInput.value = sub.sponsor_count;
      panelCompleteByInput.value = sub.complete_by || '';
      panelNotes.value = sub.notes || '';
      setPanelStatus(sub.status);

      panelSubmittedEl.textContent = formatDateTime(sub.submitted_at);
      panelReviewedEl.textContent = sub.reviewed_at
        ? formatDateTime(sub.reviewed_at) + ' by ' + sub.reviewed_by.split('@')[0] + '@'
        : 'Not yet reviewed';
      panelMetaSection.style.display = '';

      const mapsLink = window.AdminShell.mapsLink;
      if (sub.sponsor_list && sub.sponsor_list.length) {
        panelSponsorsTbody.innerHTML = sub.sponsor_list.map(function (r) {
          return (
            '<tr>' +
              '<td>' + mapsLink(r.name) + '</td>' +
              '<td>' + rowStatusPill(r.status) + '</td>' +
            '</tr>'
          );
        }).join('');
      } else {
        panelSponsorsTbody.innerHTML =
          '<tr><td colspan="2" class="text-xs text-muted text-center" style="padding: var(--space-3)">Sponsor list not attached.</td></tr>';
      }
      panelSponsorsSection.style.display = '';

      saveLabel.textContent = 'Save';
      openPanelUi();
    }

    function openCreatePanel() {
      mode = 'create';
      openSubmissionId = null;

      panelTitle.textContent = 'New submission';
      panelSub.textContent = '';
      panelEventInput.value = '';
      panelClubInput.value = '';
      panelContactInput.value = '';
      panelSizeInput.value = 'medium';
      panelSpcountInput.value = '';
      panelCompleteByInput.value = '';
      panelNotes.value = '';
      setPanelStatus('new');

      panelMetaSection.style.display = 'none';
      panelSponsorsSection.style.display = 'none';

      saveLabel.textContent = 'Create';
      openPanelUi();
    }

    function openPanelUi() {
      backdrop.classList.add('is-open');
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
    }

    function closePanel() {
      backdrop.classList.remove('is-open');
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      openSubmissionId = null;
      pendingStatus = null;
      mode = 'edit';
    }

    function readPanelForm() {
      return {
        event_name: panelEventInput.value.trim(),
        club: panelClubInput.value.trim(),
        contact_email: panelContactInput.value.trim(),
        event_size: panelSizeInput.value,
        sponsor_count: parseInt(panelSpcountInput.value, 10) || 0,
        complete_by: panelCompleteByInput.value,
        notes: panelNotes.value,
        status: pendingStatus
      };
    }

    function validateForm(form) {
      if (!form.event_name) return 'Event name is required.';
      if (!form.club) return 'Club is required.';
      if (!form.contact_email) return 'Contact email is required.';
      if (!form.complete_by) return 'Complete by date is required.';
      return null;
    }

    function saveEdit() {
      const sub = window.MOCK_DATA.submissions.find(function (s) { return s.id === openSubmissionId; });
      if (!sub) return;
      const form = readPanelForm();
      const err = validateForm(form);
      if (err) {
        window.toast && window.toast({ type: 'error', title: 'Missing field', message: err });
        return;
      }

      const oldStatus = sub.status;
      const statusChanged = sub.status !== form.status;
      let anyChanged = statusChanged;
      ['event_name', 'club', 'contact_email', 'event_size', 'sponsor_count', 'complete_by', 'notes'].forEach(function (k) {
        if ((sub[k] || '') !== (form[k] || '')) anyChanged = true;
      });

      if (!anyChanged) {
        window.toast && window.toast({ type: 'info', title: 'No changes', message: 'Nothing to save.' });
        return;
      }

      Object.assign(sub, form);
      sub.reviewed_by = session.email;
      sub.reviewed_at = new Date().toISOString();

      if (statusChanged) {
        window.AdminShell.logActivity('submission.status_changed', sub.event_name,
          'Status changed from "' + oldStatus + '" to "' + form.status + '"');
      } else {
        window.AdminShell.logActivity('submission.updated', sub.event_name, 'Submission details updated');
      }

      window.toast && window.toast({ type: 'success', title: 'Saved', message: sub.event_name });
      renderCounts();
      render();
      closePanel();
    }

    function saveCreate() {
      const form = readPanelForm();
      const err = validateForm(form);
      if (err) {
        window.toast && window.toast({ type: 'error', title: 'Missing field', message: err });
        return;
      }

      const newId = 'sub-' + Date.now().toString(36);
      const nowIso = new Date().toISOString();
      const newSub = {
        id: newId,
        event_name: form.event_name,
        club: form.club,
        contact_email: form.contact_email,
        event_size: form.event_size,
        sponsor_count: form.sponsor_count,
        submitted_at: nowIso,
        complete_by: form.complete_by,
        status: form.status,
        reviewed_by: null,
        reviewed_at: null,
        notes: form.notes,
        sponsor_list: []
      };
      window.MOCK_DATA.submissions.unshift(newSub);

      window.AdminShell.logActivity('submission.received', newSub.event_name,
        'Added by admin, club "' + newSub.club + '"');
      window.toast && window.toast({ type: 'success', title: 'Submission created', message: newSub.event_name });

      renderCounts();
      render();
      closePanel();
    }

    // ---------- wire events ----------
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        activeStatus = btn.getAttribute('data-status');
        render();
      });
    });

    panelStatusBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPanelStatus(btn.getAttribute('data-panel-status'));
      });
    });

    closeBtn.addEventListener('click', closePanel);
    cancelBtn.addEventListener('click', closePanel);
    backdrop.addEventListener('click', closePanel);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (inlineMenu) closeInlineMenu();
      else if (panel.classList.contains('is-open')) closePanel();
    });

    saveBtn.addEventListener('click', function () {
      if (mode === 'create') saveCreate();
      else saveEdit();
    });

    addBtn.addEventListener('click', openCreatePanel);

    // ---------- boot ----------
    renderCounts();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
