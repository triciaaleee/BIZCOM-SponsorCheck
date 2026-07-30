/* ============================================================
   js/admin/home-page.js
   Admin landing page:
     1. Welcome card + KPI tiles (queue at a glance).
     2. Submissions calendar — 12 months (3x4) for a year, grouped
        by the date each submission was submitted. Past months are
        greyed out but stay fully editable. Click + on a month to
        add a submission to it; click a submission to edit it.

   Create/edit uses the same side-panel that the old submissions
   page used. When Supabase lands, swap the MOCK_DATA reads/writes
   for table queries; the panel contract stays the same.
   ============================================================ */

(function () {
  'use strict';

  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_LONG = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  function init() {
    if (!window.MOCK_DATA) {
      requestAnimationFrame(init);
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'home.html',
      pageTitle: 'Home'
    });
    if (!session) return;

    const esc = window.AdminShell.escapeHtml;

    // ---------- state ----------
    let currentYear = new Date().getFullYear();
    let mode = 'edit';            // 'edit' or 'create'
    let openSubmissionId = null;
    let pendingStatus = null;
    let pendingSubmittedAt = null; // ISO stamp used when creating into a month

    // ---------- elements ----------
    const welcomeName = document.getElementById('welcome-name');
    const pendingList = document.getElementById('pending-list');
    const pendingCount = document.getElementById('pending-count');
    const pendingEmpty = document.getElementById('pending-empty');

    const grid = document.getElementById('calendar-grid');
    const yearEl = document.getElementById('cal-year');
    const prevBtn = document.getElementById('cal-prev');
    const nextBtn = document.getElementById('cal-next');

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
    const panelSubmittedLine = document.getElementById('panel-submitted-line');
    const panelNotes = document.getElementById('panel-notes');
    const panelStatusBtns = document.querySelectorAll('[data-panel-status]');

    // ---------- helpers ----------
    // Date only (no time) — e.g. "8 May 2026".
    function formatDate(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
    }

    // ISO stamp used when creating a submission into a given month. If the
    // month is the current one, use "now"; otherwise pin to mid-month noon so
    // the submission buckets into that month regardless of timezone.
    function monthIso(year, month) {
      const now = new Date();
      if (year === now.getFullYear() && month === now.getMonth()) {
        return now.toISOString();
      }
      return new Date(year, month, 15, 12, 0, 0).toISOString();
    }

    function submissionsInMonth(year, month) {
      return window.MOCK_DATA.submissions
        .filter(function (s) {
          const d = new Date(s.submitted_at);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .sort(function (a, b) { return new Date(b.submitted_at) - new Date(a.submitted_at); });
    }

    // ---------- banner: pending submissions ----------
    function startOfToday() {
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      return t;
    }

    function daysUntil(iso) {
      const target = new Date(iso);
      target.setHours(0, 0, 0, 0);
      return Math.round((target.getTime() - startOfToday().getTime()) / 86400000);
    }

    // Due-date chip: red if overdue, amber if due within 3 days, plain otherwise.
    function dueChipHtml(sub) {
      if (!sub.complete_by) return '<span class="due-chip">No due date</span>';
      const n = daysUntil(sub.complete_by);
      if (n < 0) return '<span class="due-chip due-chip--overdue">Overdue ' + Math.abs(n) + 'd</span>';
      if (n === 0) return '<span class="due-chip due-chip--soon">Due today</span>';
      if (n <= 3) return '<span class="due-chip due-chip--soon">Due in ' + n + 'd</span>';
      return '<span class="due-chip">Due ' + formatDate(sub.complete_by) + '</span>';
    }

    function renderBanner() {
      welcomeName.textContent = session.name || session.email.split('@')[0];

      // Not-completed submissions, soonest due date first; undated fall last.
      const pending = window.MOCK_DATA.submissions
        .filter(function (s) { return s.status !== 'completed'; })
        .sort(function (a, b) {
          if (!a.complete_by && !b.complete_by) return 0;
          if (!a.complete_by) return 1;
          if (!b.complete_by) return -1;
          return new Date(a.complete_by) - new Date(b.complete_by);
        });

      pendingCount.textContent = pending.length + ' to finish';

      if (!pending.length) {
        pendingList.innerHTML = '';
        pendingEmpty.hidden = false;
        return;
      }
      pendingEmpty.hidden = true;

      pendingList.innerHTML = pending.map(function (s) {
        return (
          '<li class="pending-item" data-sub-id="' + esc(s.id) + '" title="' + esc(s.event_name) + ' — ' + esc(s.club) + '">' +
            '<span class="pending-item__dot cal-sub__dot--' + esc(s.status) + '"></span>' +
            '<span class="pending-item__text">' +
              '<span class="pending-item__event">' + esc(s.event_name) + '</span>' +
              '<span class="pending-item__club">' + esc(s.club) + '</span>' +
            '</span>' +
            dueChipHtml(s) +
          '</li>'
        );
      }).join('');
    }

    // Clicking a pending row opens that submission for editing.
    pendingList.addEventListener('click', function (e) {
      const row = e.target.closest('.pending-item');
      if (row) openPanel(row.getAttribute('data-sub-id'));
    });

    // ---------- calendar ----------
    function renderCalendar() {
      yearEl.textContent = currentYear;

      const now = new Date();
      const thisYear = now.getFullYear();
      const thisMonth = now.getMonth();

      let html = '';
      for (let m = 0; m < 12; m++) {
        const subs = submissionsInMonth(currentYear, m);
        const isPast = currentYear < thisYear || (currentYear === thisYear && m < thisMonth);
        const isCurrent = currentYear === thisYear && m === thisMonth;

        let cls = 'cal-cell';
        if (isPast) cls += ' is-past';
        if (isCurrent) cls += ' is-current';

        let list;
        if (subs.length) {
          list = '<ul class="cal-cell__list">' + subs.map(function (s) {
            return (
              '<li class="cal-sub" data-sub-id="' + esc(s.id) + '" title="' + esc(s.event_name) + ' — ' + esc(s.club) + '">' +
                '<span class="cal-sub__dot cal-sub__dot--' + esc(s.status) + '"></span>' +
                '<span class="cal-sub__text">' +
                  '<span class="cal-sub__name">' + esc(s.event_name) + '</span>' +
                  '<span class="cal-sub__club">' + esc(s.club) + '</span>' +
                '</span>' +
              '</li>'
            );
          }).join('') + '</ul>';
        } else {
          list = '<div class="cal-cell__empty">No submissions</div>';
        }

        const countLabel = subs.length
          ? subs.length + (subs.length === 1 ? ' submission' : ' submissions')
          : '';

        html += (
          '<div class="' + cls + '" data-year="' + currentYear + '" data-month="' + m + '">' +
            '<div class="cal-cell__head">' +
              '<span class="cal-cell__month">' + MONTHS_SHORT[m] +
                (isCurrent ? ' <span class="cal-cell__badge">Now</span>' : '') +
              '</span>' +
              '<button type="button" class="cal-cell__add" data-add ' +
                'title="Add submission to ' + MONTHS_LONG[m] + ' ' + currentYear + '" ' +
                'aria-label="Add submission to ' + MONTHS_LONG[m] + ' ' + currentYear + '">' +
                '<i class="bi bi-plus-lg"></i>' +
              '</button>' +
            '</div>' +
            (countLabel ? '<div class="cal-cell__count">' + countLabel + '</div>' : '') +
            list +
          '</div>'
        );
      }
      grid.innerHTML = html;
    }

    // Single delegated handler (grid is re-rendered but the node is stable).
    grid.addEventListener('click', function (e) {
      const addBtn = e.target.closest('[data-add]');
      if (addBtn) {
        const cell = addBtn.closest('.cal-cell');
        openCreatePanel(parseInt(cell.dataset.year, 10), parseInt(cell.dataset.month, 10));
        return;
      }
      const subEl = e.target.closest('.cal-sub');
      if (subEl) {
        openPanel(subEl.getAttribute('data-sub-id'));
      }
    });

    prevBtn.addEventListener('click', function () { currentYear--; renderCalendar(); });
    nextBtn.addEventListener('click', function () { currentYear++; renderCalendar(); });

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
      pendingSubmittedAt = null;

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

      panelSubmittedEl.textContent = formatDate(sub.submitted_at);
      panelSubmittedLine.style.display = '';

      saveLabel.textContent = 'Save';
      openPanelUi();
    }

    function openCreatePanel(year, month) {
      mode = 'create';
      openSubmissionId = null;
      pendingSubmittedAt = monthIso(year, month);

      panelTitle.textContent = 'New submission';
      panelSub.textContent = 'Adding to ' + MONTHS_LONG[month] + ' ' + year;
      panelEventInput.value = '';
      panelClubInput.value = '';
      panelContactInput.value = '';
      panelSizeInput.value = 'medium';
      panelSpcountInput.value = '';
      panelCompleteByInput.value = '';
      panelNotes.value = '';
      setPanelStatus('new');

      panelSubmittedLine.style.display = 'none';

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
      pendingSubmittedAt = null;
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
      renderBanner();
      renderCalendar();
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
      const newSub = {
        id: newId,
        event_name: form.event_name,
        club: form.club,
        contact_email: form.contact_email,
        event_size: form.event_size,
        sponsor_count: form.sponsor_count,
        submitted_at: pendingSubmittedAt || new Date().toISOString(),
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

      renderBanner();
      renderCalendar();
      closePanel();
    }

    // ---------- wire panel events ----------
    panelStatusBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPanelStatus(btn.getAttribute('data-panel-status'));
      });
    });

    closeBtn.addEventListener('click', closePanel);
    cancelBtn.addEventListener('click', closePanel);
    backdrop.addEventListener('click', closePanel);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
    });

    saveBtn.addEventListener('click', function () {
      if (mode === 'create') saveCreate();
      else saveEdit();
    });

    // Label the event-size dropdown with the caps configured on the Settings
    // page, so an admin picking a size sees the current per-size sponsor cap
    // rather than a static label. Reads live from MOCK_DATA.settings (hydrated
    // from localStorage on load).
    function labelSizeOptions() {
      const s = window.MOCK_DATA.settings || {};
      const names  = { small: 'Small',  medium: 'Medium',  large: 'Large' };
      const ranges = { small: '<50',    medium: '50-150',  large: '>150' };
      const caps   = {
        small:  s.event_cap_small,
        medium: s.event_cap_medium,
        large:  s.event_cap_large
      };
      Array.prototype.forEach.call(panelSizeInput.options, function (opt) {
        const k = opt.value;
        if (!names[k]) return;
        const cap = (caps[k] != null) ? Number(caps[k]).toLocaleString() : '?';
        opt.textContent = names[k] + ' (' + ranges[k] + ') · cap ' + cap;
      });
    }

    // ---------- boot ----------
    labelSizeOptions();
    renderBanner();
    renderCalendar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
