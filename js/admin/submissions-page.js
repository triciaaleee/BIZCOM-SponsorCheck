/* ============================================================
   js/admin/submissions-page.js
   Inbox-style list with side-panel for detail editing.
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
    let openSubmissionId = null;
    let pendingStatus = null;
    let pendingNotes = '';

    // ---------- elements ----------
    const tbody = document.getElementById('submissions-tbody');
    const empty = document.getElementById('submissions-empty');
    const tabs = document.querySelectorAll('.admin-tab');

    const backdrop = document.getElementById('panel-backdrop');
    const panel = document.getElementById('side-panel');
    const closeBtn = document.getElementById('panel-close');
    const cancelBtn = document.getElementById('panel-cancel');
    const saveBtn = document.getElementById('panel-save');

    const panelTitle = document.getElementById('panel-title');
    const panelSub = document.getElementById('panel-sub');
    const panelEvent = document.getElementById('panel-event');
    const panelClub = document.getElementById('panel-club');
    const panelSize = document.getElementById('panel-size');
    const panelContact = document.getElementById('panel-contact');
    const panelSpcount = document.getElementById('panel-spcount');
    const panelSubmitted = document.getElementById('panel-submitted');
    const panelReviewed = document.getElementById('panel-reviewed');
    const panelSponsorsTbody = document.getElementById('panel-sponsors-tbody');
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

    function statusPill(status) {
      const labels = { new: 'New', reviewing: 'Reviewing', completed: 'Completed' };
      return '<span class="status-pill status-pill--' + status + '">' + (labels[status] || status) + '</span>';
    }

    function sizeLabel(s) {
      return { small: 'Small (<50)', medium: 'Medium (50-150)', large: 'Large (>150)' }[s] || s;
    }

    function rowStatusPill(rowStatus) {
      // Inside the panel mini-table we use compact pill style
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
      // Sort: newest first
      all.sort(function (a, b) {
        return new Date(b.submitted_at) - new Date(a.submitted_at);
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
    }

    function render() {
      const rows = getFiltered();
      if (!rows.length) {
        tbody.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';

      tbody.innerHTML = rows.map(function (s) {
        return (
          '<tr data-sub-id="' + esc(s.id) + '">' +
            '<td>' +
              '<div class="table__cell-primary">' + esc(s.event_name) + '</div>' +
              '<div class="table__cell-secondary">' + esc(s.club) + '</div>' +
            '</td>' +
            '<td><span class="text-sm text-secondary">' + esc(sizeLabel(s.event_size)) + '</span></td>' +
            '<td><span class="text-sm text-secondary">' + s.sponsor_count + '</span></td>' +
            '<td><span class="text-xs text-muted">' + esc(formatDateTime(s.submitted_at)) + '</span></td>' +
            '<td>' + statusPill(s.status) + '</td>' +
          '</tr>'
        );
      }).join('');

      // Wire row clicks
      tbody.querySelectorAll('tr[data-sub-id]').forEach(function (tr) {
        tr.addEventListener('click', function () {
          openPanel(tr.getAttribute('data-sub-id'));
        });
      });
    }

    // ---------- panel ----------
    function openPanel(submissionId) {
      const sub = window.MOCK_DATA.submissions.find(function (s) { return s.id === submissionId; });
      if (!sub) return;

      openSubmissionId = submissionId;
      pendingStatus = sub.status;
      pendingNotes = sub.notes || '';

      panelTitle.textContent = sub.event_name;
      panelSub.textContent = sub.club;
      panelEvent.textContent = sub.event_name;
      panelClub.textContent = sub.club;
      panelSize.textContent = sizeLabel(sub.event_size);
      panelContact.textContent = sub.contact_email;
      panelSpcount.textContent = sub.sponsor_count;
      panelSubmitted.textContent = formatDateTime(sub.submitted_at);
      panelReviewed.textContent = sub.reviewed_at
        ? formatDateTime(sub.reviewed_at) + ' by ' + sub.reviewed_by.split('@')[0] + '@'
        : 'Not yet reviewed';

      // Sponsor list mini-table
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

      panelNotes.value = pendingNotes;
      setPanelStatus(sub.status);

      // Open
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
      pendingNotes = '';
    }

    function setPanelStatus(s) {
      pendingStatus = s;
      panelStatusBtns.forEach(function (b) {
        const on = b.getAttribute('data-panel-status') === s;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
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
      if (e.key === 'Escape' && openSubmissionId) closePanel();
    });

    saveBtn.addEventListener('click', function () {
      if (!openSubmissionId) return;
      const sub = window.MOCK_DATA.submissions.find(function (s) { return s.id === openSubmissionId; });
      if (!sub) return;

      const newNotes = panelNotes.value;
      const statusChanged = sub.status !== pendingStatus;
      const notesChanged = (sub.notes || '') !== newNotes;

      if (!statusChanged && !notesChanged) {
        window.toast && window.toast({ type: 'info', title: 'No changes', message: 'Nothing to save.' });
        return;
      }

      const oldStatus = sub.status;
      sub.status = pendingStatus;
      sub.notes = newNotes;
      sub.reviewed_by = session.email;
      sub.reviewed_at = new Date().toISOString();

      if (statusChanged) {
        window.AdminShell.logActivity('submission.status_changed', sub.event_name,
          'Status changed from "' + oldStatus + '" to "' + pendingStatus + '"');
      } else if (notesChanged) {
        window.AdminShell.logActivity('submission.updated', sub.event_name, 'Notes updated');
      }

      window.toast && window.toast({ type: 'success', title: 'Saved', message: sub.event_name });
      renderCounts();
      render();
      closePanel();
    });

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
