/* ============================================================
   js/admin/home-page.js
   Admin landing page:
     1. Welcome card + pending list (queue at a glance).
     2. Submissions calendar — 12 months (3x4) for a year, grouped
        by the date each submission was submitted. Past months are
        greyed out but stay fully editable. Click + on a month to
        add a submission to it; click a submission to edit it.

   Reads/writes live via window.AdminAPI (the `submissions` table).
   Submissions are admin-only under RLS. No MOCK_DATA on this page.
   ============================================================ */

(function () {
  'use strict';

  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_LONG = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  function init() {
    if (!window.sb || !window.AdminAPI) {
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
    let submissions = [];         // loaded from Supabase at boot
    let settings = {};            // for the event-size cap labels
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
    const deleteBtn = document.getElementById('panel-delete');

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
    function toastMsg(o) { if (window.toast) window.toast(o); }
    function toastError(title, e) {
      console.error('[home]', title, e);
      toastMsg({ type: 'error', title: title, message: (e && e.message) || 'Please try again.' });
    }

    // Date only (no time) — e.g. "8 May 2026".
    function formatDate(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
    }

    // ISO stamp used when creating a submission into a given month.
    function monthIso(year, month) {
      const now = new Date();
      if (year === now.getFullYear() && month === now.getMonth()) {
        return now.toISOString();
      }
      return new Date(year, month, 15, 12, 0, 0).toISOString();
    }

    function submissionsInMonth(year, month) {
      return submissions
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

      const pending = submissions
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
      const sub = submissions.find(function (s) { return s.id === submissionId; });
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
      if (deleteBtn) deleteBtn.hidden = false;   // existing row, so deletable
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
      if (deleteBtn) deleteBtn.hidden = true;    // nothing saved yet to delete
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
      saveBtn.disabled = false;
      if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.hidden = true; }
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

    async function saveEdit() {
      const sub = submissions.find(function (s) { return s.id === openSubmissionId; });
      if (!sub) return;
      const form = readPanelForm();
      const err = validateForm(form);
      if (err) {
        toastMsg({ type: 'error', title: 'Missing field', message: err });
        return;
      }

      const statusChanged = sub.status !== form.status;
      let anyChanged = statusChanged;
      ['event_name', 'club', 'contact_email', 'event_size', 'sponsor_count', 'complete_by', 'notes'].forEach(function (k) {
        if ((sub[k] || '') !== (form[k] || '')) anyChanged = true;
      });

      if (!anyChanged) {
        toastMsg({ type: 'info', title: 'No changes', message: 'Nothing to save.' });
        return;
      }

      const patch = Object.assign({}, form, {
        reviewed_by: session.email,
        reviewed_at: new Date().toISOString()
      });

      saveBtn.disabled = true;
      let updated;
      try {
        updated = await window.AdminAPI.updateSubmission(openSubmissionId, patch);
      } catch (e) {
        saveBtn.disabled = false;
        toastError('Could not save submission', e);
        return;
      }
      Object.assign(sub, updated || patch);

      toastMsg({ type: 'success', title: 'Saved', message: sub.event_name });
      renderBanner();
      renderCalendar();
      closePanel();
    }

    async function saveCreate() {
      const form = readPanelForm();
      const err = validateForm(form);
      if (err) {
        toastMsg({ type: 'error', title: 'Missing field', message: err });
        return;
      }

      const payload = {
        event_name: form.event_name,
        club: form.club,
        contact_email: form.contact_email,
        event_size: form.event_size,
        sponsor_count: form.sponsor_count,
        submitted_at: pendingSubmittedAt || new Date().toISOString(),
        complete_by: form.complete_by,
        status: form.status,
        notes: form.notes
      };

      saveBtn.disabled = true;
      let created;
      try {
        created = await window.AdminAPI.createSubmission(payload);
      } catch (e) {
        saveBtn.disabled = false;
        toastError('Could not create submission', e);
        return;
      }
      if (created) submissions.unshift(created);

      toastMsg({ type: 'success', title: 'Submission created', message: form.event_name });

      renderBanner();
      renderCalendar();
      closePanel();
    }

    async function deleteSubmission() {
      const sub = submissions.find(function (s) { return s.id === openSubmissionId; });
      if (!sub) return;

      // Permanent: there is no soft-delete or audit trail to recover this from.
      if (!confirm('Delete the submission for "' + sub.event_name + '" by ' + sub.club +
                   '? This cannot be undone.')) return;

      const id = openSubmissionId;
      deleteBtn.disabled = true;
      try {
        await window.AdminAPI.deleteSubmission(id);
      } catch (e) {
        deleteBtn.disabled = false;
        toastError('Could not delete submission', e);
        return;
      }

      // Drop it from the local list so the calendar and banner update without a reload.
      const i = submissions.findIndex(function (s) { return s.id === id; });
      if (i !== -1) submissions.splice(i, 1);

      toastMsg({ type: 'success', title: 'Submission deleted', message: sub.event_name });

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
    if (deleteBtn) deleteBtn.addEventListener('click', deleteSubmission);
    backdrop.addEventListener('click', closePanel);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
    });

    saveBtn.addEventListener('click', function () {
      if (mode === 'create') saveCreate();
      else saveEdit();
    });

    // Label the event-size dropdown with the caps configured on Settings.
    function labelSizeOptions() {
      const s = settings || {};
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
    welcomeName.textContent = session.name || session.email.split('@')[0];
    (async function boot() {
      try {
        const out = await Promise.all([window.AdminAPI.listSubmissions(), window.AdminAPI.getSettings()]);
        submissions = out[0] || [];
        settings = out[1] || {};
      } catch (e) {
        toastError('Could not load the dashboard', e);
        submissions = [];
        settings = {};
      }
      labelSizeOptions();
      renderBanner();
      renderCalendar();
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
