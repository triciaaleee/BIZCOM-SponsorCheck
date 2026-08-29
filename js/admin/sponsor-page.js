/* ============================================================
   js/admin/sponsor-page.js
   Detail/edit form for a single sponsor. URL param ?id=X loads
   the record; no param means create-mode.

   Reads/writes live via window.AdminAPI (Supabase). No MOCK_DATA.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.sb || !window.AdminAPI || !window.Matcher) {
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

    // ---------- elements ----------
    const heading = document.getElementById('sponsor-form-heading');
    const form = document.getElementById('sponsor-form');
    const nameEl = document.getElementById('sp-name');
    const statusBtns = document.querySelectorAll('[data-status]');
    const industryEl = document.getElementById('sp-industry');
    const notesEl = document.getElementById('sp-notes');
    const annexCatEl = document.getElementById('sp-annex-category');
    const closedNotesEl = document.getElementById('sp-closed-notes');

    const grpNotes = document.getElementById('grp-notes');
    const grpAnnex = document.getElementById('grp-annex-category');
    const grpClosed = document.getElementById('grp-closed-notes');

    const dangerZone = document.getElementById('danger-zone');
    const deleteBtn = document.getElementById('sp-delete');
    const saveBtn = document.getElementById('sp-save');
    const saveLabel = document.getElementById('sp-save-label');

    // ---------- helpers ----------
    function toastMsg(o) { if (window.toast) window.toast(o); }
    function toastError(title, e) {
      console.error('[sponsor]', title, e);
      toastMsg({ type: 'error', title: title, message: (e && e.message) || 'Please try again.' });
    }
    function formatDate(d) {
      if (!d) return '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    let currentStatus = 'approved';
    let original = null;   // the loaded sponsor row (edit mode), for change detection

    function setStatus(s) {
      currentStatus = s;
      statusBtns.forEach(function (b) {
        const on = b.getAttribute('data-status') === s;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
      // Show only the relevant status-specific field. Alumni reuses the general
      // (optional) notes field — there is no dedicated alumni-owner field.
      grpNotes.style.display  = (s === 'approved' || s === 'alumni') ? '' : 'none';
      grpAnnex.style.display  = (s === 'prohibited') ? '' : 'none';
      grpClosed.style.display = (s === 'closed') ? '' : 'none';
    }

    statusBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setStatus(btn.getAttribute('data-status'));
      });
    });

    // Build the row values from the form. normalised uses the shared matcher key
    // so a saved sponsor is found by the same lookup the checker uses.
    // Leaving 'prohibited' clears annex_category_id + contract_ends to satisfy the
    // DB check constraint (both only allowed when prohibited).
    function buildValues() {
      const name = nameEl.value.trim();
      const values = {
        name: name,
        normalised: window.Matcher.normalise(name),
        industry: industryEl.value,
        category: currentStatus,
        notes: '',
        annex_category_id: null
      };
      if (currentStatus === 'approved' || currentStatus === 'alumni') values.notes = notesEl.value.trim();
      else if (currentStatus === 'closed') values.notes = closedNotesEl.value.trim();
      else if (currentStatus === 'prohibited') values.annex_category_id = annexCatEl.value || null;
      if (currentStatus !== 'prohibited') values.contract_ends = null;
      return values;
    }

    function describeDiff(a, b) {
      const out = [];
      if (a.name !== b.name) out.push('Name: "' + a.name + '" → "' + b.name + '"');
      if (a.industry !== b.industry) out.push('Industry: ' + a.industry + ' → ' + b.industry);
      if (a.category !== b.category) out.push('Status: ' + a.category + ' → ' + b.category);
      if ((a.notes || '') !== (b.notes || '')) out.push('Notes updated');
      if ((a.annex_category_id || '') !== (b.annex_category_id || '')) out.push('Annex category updated');
      return out;
    }

    // ---------- save ----------
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const name = nameEl.value.trim();
      if (!name) {
        toastMsg({ type: 'error', title: 'Name required', message: 'Enter a company name.' });
        return;
      }
      if (currentStatus === 'prohibited' && !annexCatEl.value) {
        toastMsg({ type: 'error', title: 'Annex category required', message: 'Pick the Annex A or Annex B category.' });
        return;
      }

      const values = buildValues();

      // Edit with no actual change — skip the write.
      if (!isCreate && original) {
        const diffs = describeDiff(original, values);
        if (diffs.length === 0) {
          toastMsg({ type: 'info', title: 'No changes', message: 'Nothing to save.' });
          return;
        }
      }

      saveBtn.disabled = true;
      try {
        if (isCreate) {
          await window.AdminAPI.addSponsor(values);
          toastMsg({ type: 'success', title: 'Sponsor created', message: name });
        } else {
          await window.AdminAPI.updateSponsor(sponsorId, values);
          toastMsg({ type: 'success', title: 'Saved', message: name });
        }
      } catch (err) {
        saveBtn.disabled = false;
        if (window.AdminAPI.isUniqueViolation(err)) {
          toastMsg({ type: 'error', title: 'Duplicate name', message: 'A sponsor with that name already exists.' });
        } else {
          toastError('Could not save sponsor', err);
        }
        return;
      }

      // Redirect back (short delay so the success toast is visible first).
      setTimeout(function () { window.location.href = 'sponsors.html'; }, 600);
    });

    // ---------- delete (super-admin only; danger zone) ----------
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async function () {
        if (!confirm('Delete this sponsor? This cannot be undone, but it can be added again.')) return;
        const name = original ? original.name : nameEl.value.trim();
        deleteBtn.disabled = true;
        try {
          await window.AdminAPI.deleteSponsor(sponsorId);
        } catch (err) {
          deleteBtn.disabled = false;
          toastError('Could not delete sponsor', err);
          return;
        }
        toastMsg({ type: 'success', title: 'Deleted', message: name });
        setTimeout(function () { window.location.href = 'sponsors.html'; }, 600);
      });
    }

    // ---------- boot ----------
    (async function boot() {
      // Populate industries
      let industries;
      try {
        industries = await window.AdminAPI.listIndustries();
      } catch (e) {
        toastError('Could not load industries', e);
        industries = [];
      }
      industries.forEach(function (ind) {
        const opt = document.createElement('option');
        opt.value = ind.code;
        opt.textContent = ind.display_name;
        industryEl.appendChild(opt);
      });

      // Annex categories, grouped A then B so the two are visually separate.
      let annexCats;
      try {
        annexCats = await window.AdminAPI.listAnnexCategories();
      } catch (e) {
        toastError('Could not load annex categories', e);
        annexCats = [];
      }
      annexCatEl.appendChild(new Option('Select a category...', ''));
      [['A', 'Annex A, prohibited'], ['B', 'Annex B, restricted']].forEach(function (pair) {
        const inAnnex = annexCats.filter(function (a) { return a.annex === pair[0]; });
        if (!inAnnex.length) return;
        const grp = document.createElement('optgroup');
        grp.label = pair[1];
        inAnnex.forEach(function (a) { grp.appendChild(new Option(a.name, a.id)); });
        annexCatEl.appendChild(grp);
      });

      if (isCreate) {
        heading.textContent = 'Add sponsor';
        saveLabel.textContent = 'Create sponsor';
        setStatus('approved');
        industryEl.value = 'other';
        document.getElementById('sponsor-side').style.display = 'none';
        return;
      }

      // Edit: load the existing record.
      let sponsor;
      try {
        sponsor = await window.AdminAPI.getSponsor(sponsorId);
      } catch (e) {
        toastError('Could not load sponsor', e);
        return;
      }
      if (!sponsor) {
        heading.textContent = 'Sponsor not found';
        form.style.display = 'none';
        document.getElementById('sponsor-side').style.display = 'none';
        return;
      }

      original = sponsor;
      heading.innerHTML = 'Edit ' + window.AdminShell.mapsLink(sponsor.name);
      saveLabel.textContent = 'Save changes';
      nameEl.value = sponsor.name;
      industryEl.value = sponsor.industry;
      setStatus(sponsor.category);
      notesEl.value = sponsor.notes || '';        // approved + alumni notes
      annexCatEl.value = sponsor.annex_category_id || '';
      closedNotesEl.value = sponsor.notes || '';  // closed uses notes field

      // Side panel
      document.getElementById('meta-id').textContent = sponsor.id;
      try {
        const st = await window.AdminAPI.getOutreachState(sponsor.id);
        document.getElementById('meta-outreach').textContent = st.count + ' / ' + st.cap;
        if (st.inCooldown && st.cooldownEndsAt) {
          document.getElementById('meta-cooldown-row').hidden = false;
          document.getElementById('meta-cooldown').textContent = 'Until ' + formatDate(st.cooldownEndsAt);
        }
      } catch (e) {
        document.getElementById('meta-outreach').textContent = '—';
      }

      // Danger zone (delete) is super-admin only.
      if (session.role === 'super_admin') {
        dangerZone.style.display = '';
      }
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
