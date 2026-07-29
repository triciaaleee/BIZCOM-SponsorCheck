/* ============================================================
   js/admin/vet-upload-page.js
   Admin "Vet & upload" page. Two connected steps:

     1. Vet a list — upload a CSV of company names (company_name +
        optional industry_code, the same template the public checker
        uses) and run it through the shared Matcher. Matched companies
        are flagged by their database status (banned / approved /
        closed / alumni); companies not on record are listed in a
        separate panel for the admin to review one by one.

     2. Add to database — an editable staging table. The
        not-on-record companies flow in from step 1; the admin sets
        each one's status (banned or approved, etc.) and industry and
        adds them all at once. Also works standalone (Add row) for
        manual bulk entry, on top of sponsor.html.

   MOCK MODE (today): writes push to window.MOCK_DATA.sponsors, so
   additions are visible across admin pages within the session but
   reset on reload — same contract as the single-add flow in
   sponsor-page.js.

   SUPABASE MODE (Phase 2): replace the push in commitStaging() with
     await supabase.from('sponsors').insert(payloads);
   The rest of the page (parse, match, staging UI) is unchanged.
   ============================================================ */

(function () {
  'use strict';

  // Sponsor categories, mirroring sponsor-page.js / the DB check constraint.
  const STATUS_OPTIONS = [
    { value: 'master', label: 'Approved' },
    { value: 'banned', label: 'Banned'   },
    { value: 'closed', label: 'Closed'   },
    { value: 'alumni', label: 'Alumni'   }
  ];

  // Placeholder + whether the "detail" field is required, per status. The
  // detail column maps to notes (master/closed), ban_reason (banned) or
  // alumni_owner (alumni) when the row is committed.
  const DETAIL_META = {
    master: { placeholder: 'Notes (optional)',              required: false },
    banned: { placeholder: 'Ban reason, e.g. Annex A, Gaming', required: true },
    closed: { placeholder: 'Closed notes (optional)',       required: false },
    alumni: { placeholder: 'Alumni owner, e.g. Wong YJ, BBM 2019', required: true }
  };

  const SAMPLE_TEXT =
    'company_name,industry_code\n' +
    'KOI,food_beverage\n' +
    'Singapore Pools,\n' +
    'Robinsons,\n' +
    'Tea Tribe,food_beverage\n' +
    'Bloom & Co Cafe,\n' +
    'Pixel Labs,tech_electronics\n' +
    'Northwind Traders,\n';

  function init() {
    if (!window.MOCK_DATA || !window.Matcher) {
      requestAnimationFrame(init);
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'vet-upload.html',
      pageTitle: 'Vetting & bulk upload'
    });
    if (!session) return; // redirected away by the auth guard

    const esc = window.AdminShell.escapeHtml;

    // ---------- element refs ----------
    const dropZone      = document.getElementById('drop-zone');
    const fileInput     = document.getElementById('file-input');
    const sampleLink    = document.getElementById('load-sample-link');
    const uploadStatus  = document.getElementById('upload-status');

    const checkUpload   = document.getElementById('check-upload');
    const checkLoading  = document.getElementById('check-loading');
    const checkResults  = document.getElementById('check-results');

    const resultsHead   = document.getElementById('results-headline');
    const summaryEl     = document.getElementById('bulk-summary');
    const dupBanner     = document.getElementById('dup-banner');
    const dupCountEl    = document.getElementById('dup-count');
    const reuploadBtn   = document.getElementById('reupload');

    const matchedTbody  = document.getElementById('matched-tbody');
    const matchedEmpty  = document.getElementById('matched-empty');
    const reviewTbody   = document.getElementById('review-tbody');
    const reviewEmpty   = document.getElementById('review-empty');
    const reviewFoot    = document.getElementById('review-foot');
    const reviewCountEl = document.getElementById('review-count-text');
    const sendToStaging = document.getElementById('send-to-staging');

    const stagingTbody  = document.getElementById('staging-tbody');
    const stagingEmpty  = document.getElementById('staging-empty');
    const stagingAll    = document.getElementById('staging-all');
    const stagingCount  = document.getElementById('staging-count');
    const stagingSaveCt = document.getElementById('staging-save-count');
    const addRowBtn     = document.getElementById('add-row');
    const clearBtn      = document.getElementById('staging-clear');
    const saveBtn       = document.getElementById('staging-save');

    // ---------- state ----------
    let results = [];          // Matcher output for the uploaded list
    let stagingRows = [];       // [{ uid, name, category, industry, detail, include }]
    let uidSeq = 0;

    // Bucket a Matcher result by the matched company's real DB category, so
    // banned / approved / closed / alumni are distinguished (status alone
    // collapses banned + closed into 'blocked'). 'review' = not on record.
    function classify(r) {
      if (r.status === 'duplicate') return 'duplicate';
      switch (r.matchedCategory) {
        case 'banned': return 'banned';
        case 'closed': return 'closed';
        case 'alumni': return 'alumni';
        // A capped, in-cooldown company is off-limits right now, so it is
        // flagged as 'cooldown' rather than shown as plain 'approved'.
        case 'master': return r.status === 'cooldown' ? 'cooldown' : 'approved';
        default:       return 'review';
      }
    }

    // ============================================================
    // STEP 1 — upload, parse, vet
    // ============================================================

    function setCheckState(which) {
      checkUpload.classList.toggle('d-none',  which !== 'upload');
      checkLoading.classList.toggle('d-none', which !== 'loading');
      checkResults.classList.toggle('d-none', which !== 'results');
    }

    // ---- drag & drop ----
    if (dropZone) {
      ['dragenter', 'dragover'].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
          e.preventDefault();
          dropZone.classList.add('is-drag-over');
        });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
          e.preventDefault();
          if (evt === 'dragleave' && e.target !== dropZone) return;
          dropZone.classList.remove('is-drag-over');
        });
      });
      dropZone.addEventListener('drop', function (e) {
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) handleFile(file);
      });
    }

    if (sampleLink) {
      sampleLink.addEventListener('click', function (e) {
        e.preventDefault();
        parseAndCheck(SAMPLE_TEXT);
      });
    }

    function handleFile(file) {
      if (!/\.csv$/i.test(file.name)) {
        window.toast && window.toast({
          type: 'error',
          title: 'Wrong file type',
          message: 'Only .csv is accepted. Save your Excel file as CSV first.'
        });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        window.toast && window.toast({
          type: 'error',
          title: 'File too large',
          message: 'Maximum upload size is 5 MB.'
        });
        return;
      }

      uploadStatus.innerHTML =
        '<div class="upload-status">' +
          '<div class="upload-status__icon"><i class="bi bi-file-earmark-spreadsheet"></i></div>' +
          '<div class="upload-status__body">' +
            '<div class="upload-status__name">' + esc(file.name) + '</div>' +
            '<div class="upload-status__meta">' + (file.size / 1024).toFixed(1) + ' KB, parsing…</div>' +
            '<div class="progress mt-2"><div class="progress__bar progress__bar--indeterminate"></div></div>' +
          '</div>' +
        '</div>';

      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          parseAndCheck(e.target.result);
        } catch (err) {
          window.toast && window.toast({
            type: 'error',
            title: 'Could not parse file',
            message: (err && err.message) || 'Check the file format and try again.'
          });
          uploadStatus.innerHTML = '';
        }
      };
      reader.onerror = function () {
        window.toast && window.toast({ type: 'error', title: 'Read failed', message: 'Could not read the file.' });
        uploadStatus.innerHTML = '';
      };
      reader.readAsText(file);
    }

    // ---- parsing (company_name[, industry_code] per line; header optional) ----
    function parseCsvLine(line) {
      const out = [];
      let buf = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; continue; }
        if (c === ',' && !inQ) { out.push(buf); buf = ''; continue; }
        buf += c;
      }
      out.push(buf);
      return out;
    }

    function parseRows(text) {
      const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
      if (lines.length === 0) throw new Error('This file appears to be empty.');

      const headerCols = parseCsvLine(lines[0]).map(function (c) { return c.toLowerCase().trim(); });
      const hasHeader = headerCols.some(function (c) { return /name|company/.test(c); });
      const nameIdx = hasHeader ? headerCols.findIndex(function (c) { return /name|company/.test(c); }) : 0;
      const indIdx  = hasHeader ? headerCols.findIndex(function (c) { return /industry|category|type|code/.test(c); }) : -1;
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const rows = [];
      dataLines.forEach(function (line) {
        const cols = parseCsvLine(line);
        const name = (cols[nameIdx] || '').trim();
        if (!name) return;
        const industry = indIdx >= 0 ? (cols[indIdx] || '').trim() : '';
        rows.push({ name: name, industry: industry || null });
      });

      if (rows.length === 0) throw new Error('No company names found in the file.');
      return rows;
    }

    function parseAndCheck(text) {
      const rows = parseRows(text);
      setCheckState('loading');
      window.Matcher.checkBatch(rows).then(function (data) {
        results = data;
        renderCheck();
        setCheckState('results');
        checkResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (reuploadBtn) {
      reuploadBtn.addEventListener('click', function () {
        results = [];
        if (fileInput) fileInput.value = '';
        uploadStatus.innerHTML = '';
        setCheckState('upload');
      });
    }

    // ---- render step-1 results ----
    function reviewCompanies() {
      return results.filter(function (r) { return classify(r) === 'review'; });
    }

    function renderCheck() {
      const counts = { approved: 0, cooldown: 0, banned: 0, closed: 0, alumni: 0, review: 0, duplicate: 0 };
      results.forEach(function (r) { counts[classify(r)]++; });

      const total = results.length;
      resultsHead.textContent = 'Checked ' + total + (total === 1 ? ' company' : ' companies') + ' against the database.';

      summaryEl.innerHTML =
        statTile('approved', counts.approved, 'Approved') +
        statTile('cooldown', counts.cooldown, 'Cooldown') +
        statTile('banned',   counts.banned,   'Banned') +
        statTile('closed',   counts.closed,   'Closed') +
        statTile('alumni',   counts.alumni,   'Alumni') +
        statTile('review',   counts.review,   'Not in database');

      if (counts.duplicate > 0) {
        dupCountEl.textContent = String(counts.duplicate);
        dupBanner.hidden = false;
      } else {
        dupBanner.hidden = true;
      }

      renderMatched();
      renderReview();
    }

    function statTile(mod, value, label) {
      return '<div class="bulk-stat bulk-stat--' + mod + '">' +
        '<div class="bulk-stat__value">' + value + '</div>' +
        '<div class="bulk-stat__label">' + label + '</div>' +
      '</div>';
    }

    // Panel A — companies found in the database, most-severe first.
    const SEVERITY = { banned: 0, cooldown: 1, closed: 2, alumni: 3, approved: 4 };
    function renderMatched() {
      const rows = results.filter(function (r) {
        return SEVERITY[classify(r)] !== undefined;
      }).sort(function (a, b) {
        return SEVERITY[classify(a)] - SEVERITY[classify(b)];
      });

      if (rows.length === 0) {
        matchedTbody.innerHTML = '';
        matchedEmpty.hidden = false;
        return;
      }
      matchedEmpty.hidden = true;

      matchedTbody.innerHTML = rows.map(function (r) {
        const bucket = classify(r);
        const idx = results.indexOf(r) + 1;         // original row number in the file
        const flaggedCls = (bucket === 'banned' || bucket === 'closed' || bucket === 'cooldown') ? 'is-flagged' : '';
        const industryLabel = r.industry ? industryDisplay(r.industry) : '';
        return (
          '<tr class="' + flaggedCls + '">' +
            '<td class="table__cell-secondary" data-label="#">' + idx + '</td>' +
            '<td data-label="Company (from list)"><div class="table__cell-primary">' + esc(r.input) + '</div></td>' +
            '<td data-label="Matched in database">' + matchCell(r) + '</td>' +
            '<td data-label="Status">' + pillFor(bucket) + '</td>' +
            '<td data-label="Industry">' +
              (industryLabel ? '<span class="tag">' + esc(industryLabel) + '</span>' : '<span class="text-muted text-xs">unknown</span>') +
            '</td>' +
            '<td data-label="Outreach">' + outreachCell(r) + '</td>' +
          '</tr>'
        );
      }).join('');
    }

    // Panel B — the separate review window for companies not on record.
    function renderReview() {
      const rows = reviewCompanies();
      if (rows.length === 0) {
        reviewTbody.innerHTML = '';
        reviewEmpty.hidden = false;
        reviewFoot.style.display = 'none';
        return;
      }
      reviewEmpty.hidden = true;
      reviewFoot.style.display = '';
      reviewCountEl.textContent = rows.length + (rows.length === 1 ? ' company' : ' companies') + ' to review.';

      reviewTbody.innerHTML = rows.map(function (r) {
        const idx = results.indexOf(r) + 1;
        const industryLabel = r.industry ? industryDisplay(r.industry) : '';
        const rowCls = r.suggestion ? 'vet-suggest-row' : '';
        return (
          '<tr class="' + rowCls + '">' +
            '<td class="table__cell-secondary" data-label="#">' + idx + '</td>' +
            '<td data-label="Company (from list)"><div class="table__cell-primary">' + esc(r.input) + '</div></td>' +
            '<td data-label="Suggested industry">' +
              (industryLabel ? '<span class="tag">' + esc(industryLabel) + '</span>' : '<span class="text-muted text-xs">unknown</span>') +
            '</td>' +
            '<td data-label="Possible match in database">' + suggestionCell(r) + '</td>' +
          '</tr>'
        );
      }).join('');
    }

    function pillFor(bucket) {
      const map = {
        approved: { cls: 'pill--clear',    icon: 'bi-check-circle-fill',  label: 'Approved' },
        cooldown: { cls: 'pill--cooldown', icon: 'bi-clock-fill',         label: 'Cooldown' },
        banned:   { cls: 'pill--blocked',  icon: 'bi-x-octagon-fill',     label: 'Banned' },
        closed:   { cls: 'pill--neutral',  icon: 'bi-slash-circle-fill',  label: 'Closed' },
        alumni:   { cls: 'pill--alumni',   icon: 'bi-mortarboard-fill',   label: 'Alumni' }
      };
      const m = map[bucket] || map.approved;
      return '<span class="pill ' + m.cls + '"><i class="bi ' + m.icon + ' pill__icon"></i>' + m.label + '</span>';
    }

    // The database record a row matched to. For fuzzy matches, append an
    // "approx." badge with the score so the admin knows to eyeball it.
    function matchCell(r) {
      const name = r.matchedName || r.matched || '';
      if (!name) return '<span class="text-muted text-xs">-</span>';
      const approx = (r.matchType === 'fuzzy')
        ? ' <span class="vet-approx" title="Approximate match, please verify">approx. ' + (r.matchScore || '') + '%</span>'
        : '';
      return '<span class="table__cell-primary">' + esc(name) + '</span>' + approx;
    }

    // Outreach usage for a matched approved company (running count / cap).
    // Not applicable to banned/closed/alumni, since those are not approached.
    // A company in cooldown shows its full count and the date it frees up.
    function outreachCell(r) {
      if (r.matchedCategory !== 'master' || !r.matchedId || !window.Caps) {
        return '<span class="text-muted text-xs">n/a</span>';
      }
      const st = window.Caps.state(r.matchedId);
      let cls = 'vet-cap';
      if (st.inCooldown) cls += ' vet-cap--over';
      else if (st.approaching) cls += ' vet-cap--near';
      let html = '<span class="' + cls + '">' + st.count + ' / ' + st.cap + '</span>';
      if (st.inCooldown && st.cooldownEndsAt) {
        html += '<span class="vet-cap__note">until ' + esc(window.Caps.formatDate(st.cooldownEndsAt)) + '</span>';
      }
      return html;
    }

    // Closest near-miss record for a not-on-record company, so a real (but
    // differently-named) sponsor isn't re-added as a duplicate.
    function suggestionCell(r) {
      if (!r.suggestion) return '<span class="text-muted text-xs">None found</span>';
      const s = r.suggestion;
      return '<span class="vet-suggest">' +
        '<i class="bi bi-exclamation-triangle-fill vet-suggest__icon"></i>' +
        '<span class="table__cell-primary">' + esc(s.name) + '</span>' +
        catPill(s.category) +
        '<span class="vet-suggest__score">' + s.score + '% similar</span>' +
      '</span>';
    }

    function catPill(cat) {
      const labels = { master: 'Approved', banned: 'Banned', closed: 'Closed', alumni: 'Alumni' };
      return '<span class="status-pill status-pill--' + cat + '">' + (labels[cat] || cat) + '</span>';
    }

    // ---- send not-on-record companies to the staging table ----
    if (sendToStaging) {
      sendToStaging.addEventListener('click', function () {
        const staged = new Set(stagingRows.map(function (r) { return window.Matcher.normalise(r.name); }));
        let added = 0;
        reviewCompanies().forEach(function (r) {
          const norm = window.Matcher.normalise(r.input);
          if (staged.has(norm)) return; // already staged, skip
          staged.add(norm);
          stagingRows.push(makeRow({ name: r.input, industry: r.industry || 'other' }));
          added++;
        });
        renderStaging();
        document.getElementById('section-add').scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.toast) {
          window.toast(added > 0
            ? { type: 'success', title: 'Staged', message: added + (added === 1 ? ' company' : ' companies') + ' ready to review.' }
            : { type: 'info', title: 'Already staged', message: 'These companies are already in the table below.' });
        }
      });
    }

    // ============================================================
    // STEP 2 — staging table (bulk add)
    // ============================================================

    function makeRow(seed) {
      seed = seed || {};
      return {
        uid: 'r' + (uidSeq++),
        name: seed.name || '',
        category: seed.category || 'master',
        industry: seed.industry || 'other',
        detail: seed.detail || '',
        include: true
      };
    }

    function industryOptions(selected) {
      return window.MOCK_DATA.industries.map(function (ind) {
        return '<option value="' + ind.code + '"' + (ind.code === selected ? ' selected' : '') + '>' +
          esc(ind.display_name) + '</option>';
      }).join('');
    }

    function statusOptions(selected) {
      return STATUS_OPTIONS.map(function (o) {
        return '<option value="' + o.value + '"' + (o.value === selected ? ' selected' : '') + '>' +
          o.label + '</option>';
      }).join('');
    }

    function industryDisplay(code) {
      const ind = window.MOCK_DATA.industries.find(function (i) { return i.code === code; });
      return ind ? ind.display_name : code;
    }

    function renderStaging() {
      if (stagingRows.length === 0) {
        stagingTbody.innerHTML = '';
        stagingEmpty.style.display = '';
      } else {
        stagingEmpty.style.display = 'none';
        stagingTbody.innerHTML = stagingRows.map(function (row) {
          const meta = DETAIL_META[row.category];
          return (
            '<tr data-uid="' + row.uid + '" class="' + (row.include ? '' : 'is-excluded') + '">' +
              '<td><input type="checkbox" class="bulk-staging__check" data-field="include"' +
                (row.include ? ' checked' : '') + ' aria-label="Include this row"></td>' +
              '<td><input type="text" class="form-input" data-field="name" value="' + esc(row.name) + '" placeholder="Company name"></td>' +
              '<td><select class="form-input" data-field="category">' + statusOptions(row.category) + '</select></td>' +
              '<td><select class="form-input" data-field="industry">' + industryOptions(row.industry) + '</select></td>' +
              '<td><input type="text" class="form-input" data-field="detail" value="' + esc(row.detail) + '" placeholder="' + esc(meta.placeholder) + '"></td>' +
              '<td><button type="button" class="bulk-staging__remove" data-field="remove" title="Remove row"><i class="bi bi-trash"></i></button></td>' +
            '</tr>'
          );
        }).join('');
      }
      updateStagingCount();
    }

    function rowByUid(uid) {
      return stagingRows.find(function (r) { return r.uid === uid; });
    }

    // Event delegation: one listener for the whole tbody. Field edits mutate the
    // model in place (no re-render, so inputs keep focus); structural changes
    // (remove) trigger a re-render.
    stagingTbody.addEventListener('input', function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const row = rowByUid(tr.getAttribute('data-uid'));
      if (!row) return;
      const field = e.target.getAttribute('data-field');
      if (field === 'name')     row.name = e.target.value;
      if (field === 'detail')   row.detail = e.target.value;
      e.target.classList.remove('is-invalid');
    });

    stagingTbody.addEventListener('change', function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const row = rowByUid(tr.getAttribute('data-uid'));
      if (!row) return;
      const field = e.target.getAttribute('data-field');

      if (field === 'include') {
        row.include = e.target.checked;
        tr.classList.toggle('is-excluded', !row.include);
        syncSelectAll();
        updateStagingCount();
      }
      if (field === 'industry') row.industry = e.target.value;
      if (field === 'category') {
        row.category = e.target.value;
        // Update the detail field's placeholder to match the new status.
        const detailInput = tr.querySelector('[data-field="detail"]');
        if (detailInput) {
          detailInput.placeholder = DETAIL_META[row.category].placeholder;
          detailInput.classList.remove('is-invalid');
        }
      }
    });

    stagingTbody.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-field="remove"]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const uid = tr.getAttribute('data-uid');
      stagingRows = stagingRows.filter(function (r) { return r.uid !== uid; });
      renderStaging();
    });

    function updateStagingCount() {
      const included = stagingRows.filter(function (r) { return r.include; }).length;
      stagingCount.textContent = included + ' selected';
      stagingSaveCt.textContent = included;
      saveBtn.disabled = included === 0;
    }

    function syncSelectAll() {
      if (stagingRows.length === 0) { stagingAll.checked = false; return; }
      stagingAll.checked = stagingRows.every(function (r) { return r.include; });
    }

    if (stagingAll) {
      stagingAll.addEventListener('change', function () {
        const on = stagingAll.checked;
        stagingRows.forEach(function (r) { r.include = on; });
        stagingTbody.querySelectorAll('tr').forEach(function (tr) {
          const cb = tr.querySelector('[data-field="include"]');
          if (cb) cb.checked = on;
          tr.classList.toggle('is-excluded', !on);
        });
        updateStagingCount();
      });
    }

    if (addRowBtn) {
      addRowBtn.addEventListener('click', function () {
        stagingRows.push(makeRow());
        renderStaging();
        // Focus the name field of the row just added.
        const rows = stagingTbody.querySelectorAll('tr');
        const last = rows[rows.length - 1];
        if (last) { const nm = last.querySelector('[data-field="name"]'); if (nm) nm.focus(); }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (stagingRows.length === 0) return;
        if (!confirm('Clear all staged rows? This does not touch the database.')) return;
        stagingRows = [];
        renderStaging();
      });
    }

    // ---- commit: validate, dedupe, write to MOCK_DATA.sponsors ----
    if (saveBtn) {
      saveBtn.addEventListener('click', commitStaging);
    }

    function commitStaging() {
      const included = stagingRows.filter(function (r) { return r.include; });
      if (included.length === 0) return;

      // 1. Validate. Collect the first invalid field per problem and flag it.
      let firstError = null;
      included.forEach(function (row) {
        const tr = stagingTbody.querySelector('[data-uid="' + row.uid + '"]');
        const nameInput = tr && tr.querySelector('[data-field="name"]');
        const detailInput = tr && tr.querySelector('[data-field="detail"]');

        if (!row.name.trim()) {
          if (nameInput) nameInput.classList.add('is-invalid');
          firstError = firstError || { el: nameInput, msg: 'Every included row needs a company name.' };
        }
        if (DETAIL_META[row.category].required && !row.detail.trim()) {
          if (detailInput) detailInput.classList.add('is-invalid');
          const what = row.category === 'banned' ? 'a ban reason' : 'an alumni owner';
          firstError = firstError || { el: detailInput, msg: (row.name.trim() || 'A row') + ' needs ' + what + '.' };
        }
      });

      if (firstError) {
        window.toast && window.toast({ type: 'error', title: 'Check the highlighted rows', message: firstError.msg });
        if (firstError.el) firstError.el.focus();
        return;
      }

      // 2. Dedupe — within the batch and against existing sponsors, by
      //    normalised name (the matcher's lookup key).
      const existing = new Set(window.MOCK_DATA.sponsors.map(function (s) {
        return s.normalised || window.Matcher.normalise(s.name);
      }));
      const seen = new Set();
      const payloads = [];
      const skipped = [];
      const now = Date.now();

      included.forEach(function (row, i) {
        const norm = window.Matcher.normalise(row.name);
        if (existing.has(norm) || seen.has(norm)) {
          skipped.push(row.name.trim());
          return;
        }
        seen.add(norm);

        const payload = {
          id: 's-' + now.toString(36) + '-' + i,
          name: row.name.trim(),
          normalised: norm,
          industry: row.industry,
          category: row.category,
          notes: '',
          ban_reason: undefined,
          alumni_owner: undefined
        };
        if (row.category === 'master') payload.notes = row.detail.trim();
        if (row.category === 'closed') payload.notes = row.detail.trim();
        if (row.category === 'banned') payload.ban_reason = row.detail.trim();
        if (row.category === 'alumni') payload.alumni_owner = row.detail.trim();
        payloads.push(payload);
      });

      if (payloads.length === 0) {
        window.toast && window.toast({
          type: 'info',
          title: 'Nothing added',
          message: 'All selected companies are already in the database.'
        });
        return;
      }

      // 3. Write. In Supabase mode this becomes a single insert().
      payloads.forEach(function (p) { window.MOCK_DATA.sponsors.push(p); });
      window.AdminShell.logActivity('sponsor.bulk_added', payloads.length + ' sponsors',
        'Bulk add of ' + payloads.length + ' sponsors' + (skipped.length ? ' (' + skipped.length + ' skipped as duplicates)' : ''));

      // 4. Remove the committed + skipped rows; keep only unticked ones.
      stagingRows = stagingRows.filter(function (r) { return !r.include; });
      renderStaging();

      const parts = ['Added ' + payloads.length + (payloads.length === 1 ? ' sponsor' : ' sponsors') + '.'];
      if (skipped.length) parts.push(skipped.length + ' skipped (already in the database).');
      window.toast && window.toast({ type: 'success', title: 'Database updated', message: parts.join(' ') });
    }

    // ---------- boot ----------
    setCheckState('upload');
    renderStaging();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
