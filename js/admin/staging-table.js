/* ============================================================
   js/admin/staging-table.js
   The bulk "add sponsors" table, shared by the two screens that
   need it:

     * Vet & Upload step 2 — companies pulled off a club's list that
       are not on the database yet.
     * Sponsors — the "Add sponsor" action, so the approved list can
       be built several companies at a time instead of one form per
       company.

   It owns the editable rows, the include/exclude state, validation,
   de-duplication and the bulk insert. It owns no data of its own:
   the host page supplies the industry list and the set of names
   already on the database through callbacks, so whichever page is
   using it stays the single source of that data.

   Usage:
     const table = window.StagingTable.create({
       tbody, empty, selectAll, countEl, saveCountEl,
       addBtn, clearBtn, saveBtn,
       industries: function () { return [...]; },
       existingNormalised: function () { return new Set([...]); },
       onChange:    function () {},           // rows added/removed
       onCommitted: function (summary) {}     // after a successful insert
     });
     table.addRows([{ name: 'Razer', industry: 'tech_electronics' }]);

   Depends on window.AdminAPI, window.Matcher and window.AdminShell.
   ============================================================ */
(function () {
  'use strict';

  // Sponsor categories, mirroring sponsor-page.js / the DB check constraint.
  const STATUS_OPTIONS = [
    { value: 'approved',   label: 'Approved'   },
    { value: 'prohibited', label: 'Prohibited' },
    { value: 'closed',     label: 'Closed'     },
    { value: 'alumni',     label: 'Alumni'     }
  ];

  // Placeholder + whether the "detail" field is required, per status. The
  // detail column maps to notes (approved/closed/alumni) or, for prohibited,
  // the chosen annex_categories id. Prohibited therefore renders a picker
  // rather than a text box: the annex is a foreign key now, not free text.
  const DETAIL_META = {
    approved:   { placeholder: 'Notes (optional)',                        required: false },
    prohibited: { placeholder: 'Pick the annex category...',              required: true  },
    closed:     { placeholder: 'Closed notes (optional)',                 required: false },
    alumni:     { placeholder: 'Notes (optional)',                        required: false }
  };

  function create(opts) {
    const esc = window.AdminShell.escapeHtml;

    const tbody       = opts.tbody;
    const emptyEl     = opts.empty;
    const selectAll   = opts.selectAll;
    const countEl     = opts.countEl;
    const saveCountEl = opts.saveCountEl;
    const addBtn      = opts.addBtn;
    const clearBtn    = opts.clearBtn;
    const saveBtn     = opts.saveBtn;

    const getIndustries = opts.industries || function () { return []; };
    const getAnnexCats  = opts.annexCategories || function () { return []; };
    const getExisting   = opts.existingNormalised || function () { return new Set(); };
    const onChange      = opts.onChange || function () {};
    const onCommitted   = opts.onCommitted || function () {};

    let rows = [];
    let uidSeq = 0;

    function toastMsg(o) { if (window.toast) window.toast(o); }
    function toastError(title, e) {
      console.error('[staging-table]', title, e);
      toastMsg({ type: 'error', title: title, message: (e && e.message) || 'Please try again.' });
    }

    function makeRow(seed) {
      seed = seed || {};
      return {
        uid: 'r' + (uidSeq++),
        name: seed.name || '',
        category: seed.category || 'approved',
        industry: seed.industry || 'other',
        detail: seed.detail || '',
        include: true
      };
    }

    function industryOptions(selected) {
      return getIndustries().map(function (ind) {
        return '<option value="' + ind.code + '"' + (ind.code === selected ? ' selected' : '') + '>' +
          esc(ind.display_name) + '</option>';
      }).join('');
    }

    // Grouped A then B, so it is obvious which half of the Standing Order a
    // category comes from.
    function annexOptions(selected) {
      const cats = getAnnexCats();
      let out = '<option value="">' + esc(DETAIL_META.prohibited.placeholder) + '</option>';
      [['A', 'Annex A, prohibited'], ['B', 'Annex B, restricted']].forEach(function (pair) {
        const inAnnex = cats.filter(function (a) { return a.annex === pair[0]; });
        if (!inAnnex.length) return;
        out += '<optgroup label="' + esc(pair[1]) + '">';
        inAnnex.forEach(function (a) {
          out += '<option value="' + esc(a.id) + '"' + (a.id === selected ? ' selected' : '') + '>' +
            esc(a.name) + '</option>';
        });
        out += '</optgroup>';
      });
      return out;
    }

    // Prohibited rows pick an annex category; everything else types a note.
    function detailCell(row, meta) {
      if (row.category === 'prohibited') {
        return '<select class="form-input" data-field="detail">' + annexOptions(row.detail) + '</select>';
      }
      return '<input type="text" class="form-input" data-field="detail" value="' + esc(row.detail) +
        '" placeholder="' + esc(meta.placeholder) + '">';
    }

    function statusOptions(selected) {
      return STATUS_OPTIONS.map(function (o) {
        return '<option value="' + o.value + '"' + (o.value === selected ? ' selected' : '') + '>' +
          o.label + '</option>';
      }).join('');
    }

    function render() {
      if (rows.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
      } else {
        if (emptyEl) emptyEl.style.display = 'none';
        tbody.innerHTML = rows.map(function (row) {
          const meta = DETAIL_META[row.category];
          return (
            '<tr data-uid="' + row.uid + '" class="' + (row.include ? '' : 'is-excluded') + '">' +
              '<td><input type="checkbox" class="bulk-staging__check" data-field="include"' +
                (row.include ? ' checked' : '') + ' aria-label="Include this row"></td>' +
              '<td><input type="text" class="form-input" data-field="name" value="' + esc(row.name) + '" placeholder="Company name"></td>' +
              '<td><select class="form-input" data-field="category">' + statusOptions(row.category) + '</select></td>' +
              '<td><select class="form-input" data-field="industry">' + industryOptions(row.industry) + '</select></td>' +
              '<td>' + detailCell(row, meta) + '</td>' +
              '<td><button type="button" class="bulk-staging__remove" data-field="remove" title="Remove row"><i class="bi bi-trash"></i></button></td>' +
            '</tr>'
          );
        }).join('');
      }
      updateCount();
    }

    function rowByUid(uid) {
      return rows.find(function (r) { return r.uid === uid; });
    }

    function updateCount() {
      const included = rows.filter(function (r) { return r.include; }).length;
      if (countEl) countEl.textContent = included + ' selected';
      if (saveCountEl) saveCountEl.textContent = included;
      if (saveBtn) saveBtn.disabled = included === 0;
    }

    function syncSelectAll() {
      if (!selectAll) return;
      selectAll.checked = rows.length > 0 && rows.every(function (r) { return r.include; });
    }

    tbody.addEventListener('input', function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const row = rowByUid(tr.getAttribute('data-uid'));
      if (!row) return;
      const field = e.target.getAttribute('data-field');
      if (field === 'name')   row.name = e.target.value;
      if (field === 'detail') row.detail = e.target.value;
      e.target.classList.remove('is-invalid');
    });

    tbody.addEventListener('change', function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const row = rowByUid(tr.getAttribute('data-uid'));
      if (!row) return;
      const field = e.target.getAttribute('data-field');

      if (field === 'include') {
        row.include = e.target.checked;
        tr.classList.toggle('is-excluded', !row.include);
        syncSelectAll();
        updateCount();
      }
      if (field === 'industry') row.industry = e.target.value;
      if (field === 'category') {
        row.category = e.target.value;
        // The detail control is a picker for prohibited and a text box
        // otherwise, so the whole row is redrawn rather than relabelled.
        row.detail = '';
        render();
      }
    });

    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-field="remove"]');
      if (!btn) return;
      const uid = btn.closest('tr').getAttribute('data-uid');
      rows = rows.filter(function (r) { return r.uid !== uid; });
      render();
      onChange();
    });

    if (selectAll) {
      selectAll.addEventListener('change', function () {
        const on = selectAll.checked;
        tbody.querySelectorAll('tr').forEach(function (tr) {
          const row = rowByUid(tr.getAttribute('data-uid'));
          if (!row) return;
          row.include = on;
          const cb = tr.querySelector('[data-field="include"]');
          if (cb) cb.checked = on;
          tr.classList.toggle('is-excluded', !on);
        });
        updateCount();
      });
    }

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        rows.push(makeRow());
        render();
        const trs = tbody.querySelectorAll('tr');
        const last = trs[trs.length - 1];
        if (last) { const nm = last.querySelector('[data-field="name"]'); if (nm) nm.focus(); }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (rows.length === 0) return;
        if (!confirm('Clear all staged rows? This does not touch the database.')) return;
        rows = [];
        render();
        onChange();
      });
    }

    if (saveBtn) saveBtn.addEventListener('click', commit);

    // ---- commit: validate, dedupe, bulk-insert ----
    // No outreach is recorded here on purpose: a contact belongs to an event, so
    // it is logged on Vet & Upload against a recorded submission.
    async function commit() {
      const included = rows.filter(function (r) { return r.include; });
      if (included.length === 0) return;

      // 1. Validate.
      let firstError = null;
      included.forEach(function (row) {
        const tr = tbody.querySelector('[data-uid="' + row.uid + '"]');
        const nameInput = tr && tr.querySelector('[data-field="name"]');
        const detailInput = tr && tr.querySelector('[data-field="detail"]');
        if (!row.name.trim()) {
          if (nameInput) nameInput.classList.add('is-invalid');
          firstError = firstError || { el: nameInput, msg: 'Every included row needs a company name.' };
        }
        if (DETAIL_META[row.category].required && !row.detail.trim()) {
          if (detailInput) detailInput.classList.add('is-invalid');
          firstError = firstError || { el: detailInput, msg: (row.name.trim() || 'A row') + ' needs an annex category.' };
        }
      });
      if (firstError) {
        toastMsg({ type: 'error', title: 'Check the highlighted rows', message: firstError.msg });
        if (firstError.el) firstError.el.focus();
        return;
      }

      // 2. Dedupe within the batch and against what is already on the database.
      const existing = getExisting();
      const seen = new Set();
      const payloads = [];
      const skipped = [];

      included.forEach(function (row) {
        const norm = window.Matcher.normalise(row.name);
        if (existing.has(norm) || seen.has(norm)) {
          skipped.push(row.name.trim());
          return;
        }
        seen.add(norm);
        const payload = {
          name: row.name.trim(),
          normalised: norm,
          industry: row.industry,
          category: row.category,
          notes: '',
          annex_category_id: null
        };
        if (row.category === 'prohibited') payload.annex_category_id = row.detail || null;
        else payload.notes = row.detail.trim();
        payloads.push(payload);
      });

      if (payloads.length === 0) {
        toastMsg({ type: 'info', title: 'Nothing added', message: 'All selected companies are already in the database.' });
        return;
      }

      // 3. Bulk insert (skips any that already exist by normalised).
      saveBtn.disabled = true;
      let inserted;
      try {
        inserted = await window.AdminAPI.bulkAddSponsors(payloads);
      } catch (e) {
        saveBtn.disabled = false;
        toastError('Could not add sponsors', e);
        return;
      }
      const added = inserted.length;
      const dbSkipped = payloads.length - added;

      // 4. Drop the committed rows; keep only the unticked ones.
      rows = rows.filter(function (r) { return !r.include; });
      render();
      saveBtn.disabled = false;

      onCommitted({
        added: added,
        skipped: skipped.length + dbSkipped,
        payloads: payloads,
        inserted: inserted
      });
    }

    return {
      render: render,
      addRows: function (seeds) {
        (seeds || []).forEach(function (seed) { rows.push(makeRow(seed)); });
        render();
      },
      // Normalised names currently staged, so the host can hide them elsewhere.
      stagedNormalised: function () {
        return new Set(rows.map(function (r) {
          return window.Matcher.normalise(r.name);
        }).filter(Boolean));
      },
      clear: function () { rows = []; render(); },
      count: function () { return rows.length; }
    };
  }

  window.StagingTable = {
    create: create,
    STATUS_OPTIONS: STATUS_OPTIONS,
    DETAIL_META: DETAIL_META
  };
})();
