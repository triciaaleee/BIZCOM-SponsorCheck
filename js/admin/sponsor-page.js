/* ============================================================
   js/admin/sponsor-page.js
   Detail/edit form for a single sponsor. URL param ?id=X loads
   the record; no param means create-mode.

   When Supabase lands, replace the MOCK_DATA reads/writes with
   table queries. The form contract stays the same.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.MOCK_DATA) {
      requestAnimationFrame(init);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const sponsorId = params.get('id');
    const isCreate = !sponsorId;

    const session = window.AdminShell.mount({
      currentPage: 'sponsors.html',  // highlight the parent nav item
      pageTitle: isCreate ? 'Add sponsor' : 'Edit sponsor'
    });
    if (!session) return;

    const esc = window.AdminShell.escapeHtml;

    // ---------- elements ----------
    const heading = document.getElementById('sponsor-form-heading');
    const form = document.getElementById('sponsor-form');
    const nameEl = document.getElementById('sp-name');
    const statusBtns = document.querySelectorAll('[data-status]');
    const industryEl = document.getElementById('sp-industry');
    const notesEl = document.getElementById('sp-notes');
    const banReasonEl = document.getElementById('sp-ban-reason');
    const alumniOwnerEl = document.getElementById('sp-alumni-owner');
    const closedNotesEl = document.getElementById('sp-closed-notes');

    const grpNotes = document.getElementById('grp-notes');
    const grpBan = document.getElementById('grp-ban-reason');
    const grpAlumni = document.getElementById('grp-alumni-owner');
    const grpClosed = document.getElementById('grp-closed-notes');

    const dangerZone = document.getElementById('danger-zone');
    const deleteBtn = document.getElementById('sp-delete');
    const saveLabel = document.getElementById('sp-save-label');

    // Populate industries
    window.MOCK_DATA.industries.forEach(function (ind) {
      const opt = document.createElement('option');
      opt.value = ind.code;
      opt.textContent = ind.display_name;
      industryEl.appendChild(opt);
    });

    let currentStatus = 'master';

    function setStatus(s) {
      currentStatus = s;
      statusBtns.forEach(function (b) {
        const on = b.getAttribute('data-status') === s;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
      // Show only the relevant status-specific field
      grpNotes.style.display     = (s === 'master')  ? '' : 'none';
      grpBan.style.display       = (s === 'banned')  ? '' : 'none';
      grpClosed.style.display    = (s === 'closed')  ? '' : 'none';
      grpAlumni.style.display    = (s === 'alumni')  ? '' : 'none';
    }

    statusBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setStatus(btn.getAttribute('data-status'));
      });
    });

    // ---------- load existing or set defaults ----------
    let original = null;

    if (isCreate) {
      heading.textContent = 'Add sponsor';
      saveLabel.textContent = 'Create sponsor';
      setStatus('master');
      industryEl.value = 'other';
      // Hide side panel content for new sponsor
      document.getElementById('sponsor-side').style.display = 'none';
    } else {
      const sponsor = window.MOCK_DATA.sponsors.find(function (s) { return s.id === sponsorId; });
      if (!sponsor) {
        heading.textContent = 'Sponsor not found';
        form.style.display = 'none';
        document.getElementById('sponsor-side').style.display = 'none';
        return;
      }
      original = JSON.parse(JSON.stringify(sponsor));
      heading.textContent = 'Edit sponsor';
      saveLabel.textContent = 'Save changes';
      nameEl.value = sponsor.name;
      industryEl.value = sponsor.industry;
      setStatus(sponsor.category);
      notesEl.value = sponsor.notes || '';
      banReasonEl.value = sponsor.ban_reason || '';
      alumniOwnerEl.value = sponsor.alumni_owner || '';
      closedNotesEl.value = sponsor.notes || '';  // closed uses notes field

      // Populate side panel
      document.getElementById('meta-id').textContent = sponsor.id;
      const creationLog = window.MOCK_DATA.activity.find(function (a) {
        return a.entity === sponsor.name && a.action === 'sponsor.created';
      });
      document.getElementById('meta-created').textContent = creationLog
        ? formatDate(creationLog.at) + ' by ' + creationLog.actor.split('@')[0] + '@'
        : 'Unknown';

      const lastLog = window.MOCK_DATA.activity.find(function (a) {
        return a.entity === sponsor.name && a.action.indexOf('sponsor.') === 0;
      });
      document.getElementById('meta-updated').textContent = lastLog
        ? formatDate(lastLog.at) + ' by ' + lastLog.actor.split('@')[0] + '@'
        : 'Unknown';

      const oc = window.MOCK_DATA.outreachCounts[sponsor.id];
      document.getElementById('meta-outreach').textContent = (oc != null ? oc : 0) + ' / ' + window.MOCK_DATA.settings.outreach_cap_per_30d;

      // Per-sponsor activity log
      renderSponsorActivity(sponsor.name);

      // Show danger zone for super-admin
      if (session.role === 'super_admin') {
        dangerZone.style.display = '';
      }
    }

    function renderSponsorActivity(sponsorName) {
      const list = document.getElementById('activity-mini-list');
      const entries = window.MOCK_DATA.activity.filter(function (a) {
        return a.entity === sponsorName;
      });
      if (!entries.length) return;
      list.innerHTML = entries.map(function (e) {
        return (
          '<li class="activity-mini__item">' +
            '<div class="activity-mini__when">' + esc(formatDate(e.at)) + ', ' + esc(e.actor.split('@')[0]) + '@</div>' +
            '<div class="activity-mini__what">' + esc(e.details || e.action) + '</div>' +
          '</li>'
        );
      }).join('');
    }

    function formatDate(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    // ---------- save ----------
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const name = nameEl.value.trim();
      if (!name) {
        window.toast && window.toast({ type: 'error', title: 'Name required', message: 'Enter a company name.' });
        return;
      }
      // Validate status-specific fields
      if (currentStatus === 'banned' && !banReasonEl.value.trim()) {
        window.toast && window.toast({ type: 'error', title: 'Ban reason required', message: 'Add the Annex reference.' });
        return;
      }
      if (currentStatus === 'alumni' && !alumniOwnerEl.value.trim()) {
        window.toast && window.toast({ type: 'error', title: 'Alumni owner required', message: 'Add the owner name.' });
        return;
      }

      const payload = {
        id: isCreate ? generateId() : sponsorId,
        name: name,
        normalised: normalise(name),
        industry: industryEl.value,
        category: currentStatus,
        notes: '',
        ban_reason: undefined,
        alumni_owner: undefined
      };

      if (currentStatus === 'master') payload.notes = notesEl.value.trim();
      if (currentStatus === 'banned') payload.ban_reason = banReasonEl.value.trim();
      if (currentStatus === 'closed') payload.notes = closedNotesEl.value.trim();
      if (currentStatus === 'alumni') payload.alumni_owner = alumniOwnerEl.value.trim();

      if (isCreate) {
        window.MOCK_DATA.sponsors.push(payload);
        window.AdminShell.logActivity('sponsor.created', name,
          'Added as ' + currentStatus + ', industry ' + payload.industry);
        window.toast && window.toast({ type: 'success', title: 'Sponsor created', message: name });
      } else {
        const idx = window.MOCK_DATA.sponsors.findIndex(function (s) { return s.id === sponsorId; });
        if (idx === -1) return;
        const diffs = describeDiff(original, payload);
        window.MOCK_DATA.sponsors[idx] = payload;
        if (diffs.length === 0) {
          window.toast && window.toast({ type: 'info', title: 'No changes', message: 'Nothing to save.' });
          return;
        }
        // Pick the most material change for the log entry
        if (original.category !== payload.category) {
          window.AdminShell.logActivity('sponsor.status_changed', name,
            'Status changed from "' + original.category + '" to "' + payload.category + '"');
        } else {
          window.AdminShell.logActivity('sponsor.updated', name, diffs.join('; '));
        }
        window.toast && window.toast({ type: 'success', title: 'Saved', message: name });
      }

      // Redirect back
      setTimeout(function () { window.location.href = 'sponsors.html'; }, 600);
    });

    // ---------- delete ----------
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!confirm('Delete this sponsor? This is logged but reversible by re-adding it.')) return;
        const idx = window.MOCK_DATA.sponsors.findIndex(function (s) { return s.id === sponsorId; });
        if (idx === -1) return;
        const name = window.MOCK_DATA.sponsors[idx].name;
        window.MOCK_DATA.sponsors.splice(idx, 1);
        window.AdminShell.logActivity('sponsor.deleted', name, 'Sponsor removed from database');
        window.toast && window.toast({ type: 'success', title: 'Deleted', message: name });
        setTimeout(function () { window.location.href = 'sponsors.html'; }, 600);
      });
    }

    function describeDiff(a, b) {
      const out = [];
      if (a.name !== b.name) out.push('Name: "' + a.name + '" \u2192 "' + b.name + '"');
      if (a.industry !== b.industry) out.push('Industry: ' + a.industry + ' \u2192 ' + b.industry);
      if (a.category !== b.category) out.push('Status: ' + a.category + ' \u2192 ' + b.category);
      if ((a.notes || '') !== (b.notes || '')) out.push('Notes updated');
      if ((a.ban_reason || '') !== (b.ban_reason || '')) out.push('Ban reason updated');
      if ((a.alumni_owner || '') !== (b.alumni_owner || '')) out.push('Alumni owner updated');
      return out;
    }

    function generateId() {
      return 's-' + Date.now().toString(36);
    }

    function normalise(name) {
      return String(name).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
