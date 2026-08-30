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

    // This page only ever edits an existing sponsor. Nothing links here without
    // an id, and new companies are added from the Sponsors page's bulk dialog or
    // the Annex B panel, so a bare URL goes back to the list rather than opening
    // a second, unreachable create form.
    if (!sponsorId) {
      window.location.href = 'sponsors.html';
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'sponsors.html',  // highlight the parent nav item
      pageTitle: 'Edit sponsor'
    });
    if (!session) return;

    // ---------- elements ----------
    const heading = document.getElementById('sponsor-form-heading');
    const form = document.getElementById('sponsor-form');
    const nameEl = document.getElementById('sp-name');
    const statusBtns = document.querySelectorAll('[data-status]');
    const industryEl = document.getElementById('sp-industry');
    const notesEl = document.getElementById('sp-notes');
    const notesLabelEl = document.getElementById('sp-notes-label');
    const annexCatEl = document.getElementById('sp-annex-category');
    const contractEl = document.getElementById('sp-contract-ends');

    const grpAnnex = document.getElementById('grp-annex-category');
    const grpContract = document.getElementById('grp-contract-ends');

    const dangerZone = document.getElementById('danger-zone');
    const deleteBtn = document.getElementById('sp-delete');
    const saveBtn = document.getElementById('sp-save');

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
    const annexById = {};  // annex_categories id -> { annex, name }

    // Local calendar date as YYYY-MM-DD, to compare against a date input's value.
    function todayISODate() {
      const d = new Date();
      const p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    // contract_ends is the BIZCOM partner contract, not a general annex field:
    // Banks & Financial Institution and Government Entity are permanent
    // restrictions with no end date. Only the partner category is time-boxed,
    // so only it gets the date field. Mirrors the Annex B "Add" modal on the
    // sponsors page, which files every company it adds under this category.
    function isPartnerCategory(id) {
      const cat = id ? annexById[id] : null;
      return !!(cat && cat.annex === 'B' && (cat.name || '').toLowerCase() === 'bizcom partner');
    }

    // Notes live in one column for every status, so only the wording changes.
    const NOTES_COPY = {
      approved:   { label: 'Notes', placeholder: 'Any context for BIZCOM, e.g. previous events...' },
      alumni:     { label: 'Notes', placeholder: 'e.g. Founder is an SMU alumnus, OAR sign-off obtained.' },
      prohibited: { label: 'Notes', placeholder: 'e.g. Signed for AY25/26 orientation season.' },
      closed:     { label: 'Closed notes', placeholder: 'e.g. Ceased operations 2020' }
    };

    // The contract date row only makes sense for the partner category, so it is
    // re-evaluated whenever either the status or the annex category changes.
    function syncContractField() {
      const show = currentStatus === 'prohibited' && isPartnerCategory(annexCatEl.value);
      grpContract.style.display = show ? '' : 'none';
    }

    function setStatus(s) {
      currentStatus = s;
      statusBtns.forEach(function (b) {
        const on = b.getAttribute('data-status') === s;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
      // Notes apply to every status, so the field always shows and only its
      // wording changes. The annex picker and the partner contract date are the
      // genuinely status-specific rows.
      const copy = NOTES_COPY[s] || NOTES_COPY.approved;
      if (notesLabelEl) {
        notesLabelEl.innerHTML = copy.label +
          ' <span class="form-label__optional">optional</span>';
      }
      notesEl.placeholder = copy.placeholder;
      grpAnnex.style.display = (s === 'prohibited') ? '' : 'none';
      syncContractField();
    }

    statusBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setStatus(btn.getAttribute('data-status'));
      });
    });

    annexCatEl.addEventListener('change', syncContractField);

    // Build the row values from the form. normalised uses the shared matcher key
    // so a saved sponsor is found by the same lookup the checker uses.
    //
    // annex_category_id and contract_ends are written on every save, not only
    // when they have a value, because the DB check constraint allows both only
    // while category = 'prohibited'. Sending them as null is what clears a
    // former partner's date when it is approved, or when its annex category
    // moves from BIZCOM Partner to a permanent one.
    function buildValues() {
      const name = nameEl.value.trim();
      const values = {
        name: name,
        normalised: window.Matcher.normalise(name),
        industry: industryEl.value,
        category: currentStatus,
        notes: notesEl.value.trim(),
        annex_category_id: null,
        contract_ends: null
      };
      if (currentStatus === 'prohibited') {
        values.annex_category_id = annexCatEl.value || null;
        if (isPartnerCategory(values.annex_category_id)) {
          values.contract_ends = contractEl.value || null;
        }
      }
      return values;
    }

    function describeDiff(a, b) {
      const out = [];
      if (a.name !== b.name) out.push('Name: "' + a.name + '" → "' + b.name + '"');
      if (a.industry !== b.industry) out.push('Industry: ' + a.industry + ' → ' + b.industry);
      if (a.category !== b.category) out.push('Status: ' + a.category + ' → ' + b.category);
      if ((a.notes || '') !== (b.notes || '')) out.push('Notes updated');
      if ((a.annex_category_id || '') !== (b.annex_category_id || '')) out.push('Annex category updated');
      if ((a.contract_ends || '') !== (b.contract_ends || '')) out.push('Contract end date updated');
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
        annexCatEl.focus();
        return;
      }
      if (currentStatus === 'prohibited' && isPartnerCategory(annexCatEl.value)) {
        if (!contractEl.value) {
          toastMsg({ type: 'error', title: 'Contract end date required', message: 'Pick when the partnership ends.' });
          contractEl.focus();
          return;
        }
        // A date already past would file the company straight into the lapsed
        // half of the Annex B panel and hide it from the sponsors table, which
        // is never what someone editing a live partner means to do.
        if (contractEl.value < todayISODate() &&
            !confirm('That contract end date has already passed, so this partner will read as ended and drop out of the sponsors list. Save anyway?')) {
          contractEl.focus();
          return;
        }
      }

      const values = buildValues();

      // No actual change, so skip the write.
      if (original) {
        const diffs = describeDiff(original, values);
        if (diffs.length === 0) {
          toastMsg({ type: 'info', title: 'No changes', message: 'Nothing to save.' });
          return;
        }
      }

      saveBtn.disabled = true;
      try {
        await window.AdminAPI.updateSponsor(sponsorId, values);
        toastMsg({ type: 'success', title: 'Saved', message: name });
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
      annexCats.forEach(function (a) { annexById[a.id] = a; });

      annexCatEl.appendChild(new Option('Select a category...', ''));
      [['A', 'Annex A, prohibited'], ['B', 'Annex B, restricted']].forEach(function (pair) {
        const inAnnex = annexCats.filter(function (a) { return a.annex === pair[0]; });
        if (!inAnnex.length) return;
        const grp = document.createElement('optgroup');
        grp.label = pair[1];
        inAnnex.forEach(function (a) { grp.appendChild(new Option(a.name, a.id)); });
        annexCatEl.appendChild(grp);
      });

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
      nameEl.value = sponsor.name;
      industryEl.value = sponsor.industry;
      notesEl.value = sponsor.notes || '';
      // The annex category and contract date are set before setStatus, because
      // setStatus decides whether the contract row shows by reading the picker.
      annexCatEl.value = sponsor.annex_category_id || '';
      contractEl.value = sponsor.contract_ends || '';
      setStatus(sponsor.category);

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

      // Delete is open to any admin, matching the trash icon on the sponsors
      // table, the Annex B panel's Remove, and the sponsors_write RLS policy,
      // which is what actually decides. Gating this on super_admin here only
      // hid a button the same person could press one screen earlier.
      dangerZone.style.display = '';
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
