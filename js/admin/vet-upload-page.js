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
    const matchedFoot   = document.getElementById('matched-foot');
    const logAll        = document.getElementById('log-all');
    const logBtn        = document.getElementById('log-outreach-btn');
    const logCountEl    = document.getElementById('log-count');
    const reviewTbody   = document.getElementById('review-tbody');
    const reviewEmpty   = document.getElementById('review-empty');
    const reviewFoot    = document.getElementById('review-foot');
    const reviewAll     = document.getElementById('review-all');
    const reviewSelText = document.getElementById('review-sel-text');
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
    let parsedRows = [];        // the parsed CSV rows, kept so we can re-vet in place
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
        // flagged as 'cooldown' rather than shown as plain 'approved'. Read the
        // cap state live (not the snapshot in r.status) so the bucket updates
        // the moment outreach is logged below.
        case 'master': {
          const st = (r.matchedId && window.Caps) ? window.Caps.state(r.matchedId) : null;
          return (st && st.inCooldown) ? 'cooldown' : 'approved';
        }
        default: return 'review';
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
      parsedRows = rows;
      setCheckState('loading');
      window.Matcher.checkBatch(rows).then(function (data) {
        results = data;
        renderCheck();
        setCheckState('results');
        checkResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Re-run the vet on the same rows against the (now-mutated) database and
    // re-render, so status, remarks, outreach and which panel a row sits in
    // all stay consistent after outreach is logged. delay:0 makes it instant.
    function revet() {
      if (!parsedRows.length) return;   // nothing uploaded, so no panels to refresh
      window.Matcher.checkBatch(parsedRows, { delay: 0 }).then(function (data) {
        results = data;
        renderCheck();
      });
    }

    if (reuploadBtn) {
      reuploadBtn.addEventListener('click', function () {
        results = [];
        parsedRows = [];
        if (fileInput) fileInput.value = '';
        uploadStatus.innerHTML = '';
        setCheckState('upload');
      });
    }

    // ---- render step-1 results ----
    // Companies not on record AND not already queued in the staging table.
    // Staging a company removes it from here; removing it from staging (or
    // clearing) brings it back — the two lists behave as one moving queue.
    function reviewCompanies() {
      const staged = new Set(stagingRows.map(function (r) {
        return window.Matcher.normalise(r.name);
      }).filter(Boolean));
      return results.filter(function (r) {
        return classify(r) === 'review' && !staged.has(window.Matcher.normalise(r.input));
      });
    }

    function renderCheck() {
      const counts = { approved: 0, cooldown: 0, banned: 0, closed: 0, alumni: 0, review: 0, duplicate: 0 };
      results.forEach(function (r) { counts[classify(r)]++; });
      // The "Not in database" tile counts only companies still shown in Panel B
      // (staged ones are excluded, since they've moved to step 2).
      counts.review = reviewCompanies().length;

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
        matchedFoot.style.display = 'none';
        return;
      }
      matchedEmpty.hidden = true;

      let eligible = 0;
      matchedTbody.innerHTML = rows.map(function (r) {
        const bucket = classify(r);
        const idx = results.indexOf(r) + 1;         // original row number in the file
        const flaggedCls = (bucket === 'banned' || bucket === 'closed' || bucket === 'cooldown') ? 'is-flagged' : '';
        const industryLabel = r.industry ? industryDisplay(r.industry) : '';
        // Only approved companies can receive outreach; everything else (banned,
        // closed, alumni, already-in-cooldown) gets no tick-box.
        const canLog = bucket === 'approved' && r.matchedId;
        if (canLog) eligible++;
        const checkCell = canLog
          ? '<input type="checkbox" class="vet-log-check bulk-staging__check" data-id="' + esc(r.matchedId) + '" aria-label="Select for outreach">'
          : '';
        return (
          '<tr class="' + flaggedCls + '">' +
            '<td data-label="Log">' + checkCell + '</td>' +
            '<td class="table__cell-secondary" data-label="#">' + idx + '</td>' +
            '<td data-label="Company (from list)"><div class="table__cell-primary">' + esc(r.input) + '</div></td>' +
            '<td data-label="Matched in database">' + matchCell(r) + '</td>' +
            '<td data-label="Status">' + pillFor(bucket) + '</td>' +
            '<td data-label="Industry">' +
              (industryLabel ? '<span class="tag">' + esc(industryLabel) + '</span>' : '<span class="text-muted text-xs">unknown</span>') +
            '</td>' +
            '<td data-label="Outreach">' + outreachCell(r) + '</td>' +
            '<td data-label="Remarks" class="text-secondary text-xs">' + esc(r.reason || '') + '</td>' +
          '</tr>'
        );
      }).join('');

      matchedFoot.style.display = eligible ? '' : 'none';
      if (logAll) logAll.checked = false;
      updateLogCount();
    }

    // Keep the summary "Not in database" tile in step with what Panel B shows.
    function updateReviewTile(n) {
      const el = summaryEl.querySelector('.bulk-stat--review .bulk-stat__value');
      if (el) el.textContent = n;
    }

    // Panel B — the separate review window for companies not on record.
    function renderReview() {
      const rows = reviewCompanies();
      updateReviewTile(rows.length);

      if (rows.length === 0) {
        reviewTbody.innerHTML = '';
        reviewFoot.style.display = 'none';
        reviewEmpty.hidden = false;
        // Distinguish "all handled" from "some queued in step 2".
        const totalReview = results.filter(function (r) { return classify(r) === 'review'; }).length;
        reviewEmpty.textContent = totalReview > 0
          ? 'All new companies are staged for adding in step 2.'
          : 'Every company on the list was found in the database.';
        if (reviewAll) reviewAll.checked = false;
        updateReviewCount();
        return;
      }
      reviewEmpty.hidden = true;
      reviewFoot.style.display = '';

      reviewTbody.innerHTML = rows.map(function (r) {
        const ri = results.indexOf(r);
        const industryLabel = r.industry ? industryDisplay(r.industry) : '';
        const rowCls = r.suggestion ? 'vet-suggest-row' : '';
        return (
          '<tr class="' + rowCls + '">' +
            '<td data-label="Log"><input type="checkbox" class="vet-review-check bulk-staging__check" data-ri="' + ri + '" aria-label="Select for adding or outreach"></td>' +
            '<td class="table__cell-secondary" data-label="#">' + (ri + 1) + '</td>' +
            '<td data-label="Company (from list)"><div class="table__cell-primary">' + esc(r.input) + '</div></td>' +
            '<td data-label="Suggested industry">' +
              (industryLabel ? '<span class="tag">' + esc(industryLabel) + '</span>' : '<span class="text-muted text-xs">unknown</span>') +
            '</td>' +
            '<td data-label="Possible match in database">' + suggestionCell(r) + '</td>' +
          '</tr>'
        );
      }).join('');

      if (reviewAll) reviewAll.checked = false;
      updateReviewCount();
    }

    // Selected review rows, resolved back to their Matcher result objects.
    function selectedReviewResults() {
      return Array.prototype.slice.call(reviewTbody.querySelectorAll('.vet-review-check:checked'))
        .map(function (b) { return results[parseInt(b.getAttribute('data-ri'), 10)]; })
        .filter(Boolean);
    }

    function updateReviewCount() {
      const n = reviewTbody.querySelectorAll('.vet-review-check:checked').length;
      if (reviewSelText) reviewSelText.textContent = n + ' selected';
      if (sendToStaging) sendToStaging.disabled = n === 0;
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

    // ---- outreach logging (Panel A) ----

    function updateLogCount() {
      if (!logBtn || !logCountEl) return;
      const n = matchedTbody.querySelectorAll('.vet-log-check:checked').length;
      logCountEl.textContent = n;
      logBtn.disabled = n === 0;
    }

    // Record one outreach against a sponsor: +1 to the running count, mirroring
    // the rule in window.Caps. At the cap the company enters cooldown; an
    // elapsed prior cooldown (count already reset) has its stale stamp cleared.
    // In Supabase this becomes: insert into outreach_log (sponsor_id, ...).
    function logOutreach(id) {
      const o = window.MOCK_DATA.outreach || (window.MOCK_DATA.outreach = {});
      const st = window.Caps.state(id);
      if (st.inCooldown) return 'skipped';           // already capped; not selectable
      const rec = o[id] || (o[id] = { count: 0, cooldown_started_at: null });
      const next = st.count + 1;
      if (next >= st.cap) {
        rec.count = st.cap;
        rec.cooldown_started_at = new Date().toISOString();
        return 'capped';
      }
      rec.count = next;
      rec.cooldown_started_at = null;
      return 'logged';
    }

    // ---- Panel B: select-all + per-row sync ----
    if (reviewAll) {
      reviewAll.addEventListener('change', function () {
        const on = reviewAll.checked;
        reviewTbody.querySelectorAll('.vet-review-check').forEach(function (b) { b.checked = on; });
        updateReviewCount();
      });
    }

    reviewTbody.addEventListener('change', function (e) {
      if (!e.target.classList.contains('vet-review-check')) return;
      const all = Array.prototype.slice.call(reviewTbody.querySelectorAll('.vet-review-check'));
      if (reviewAll) reviewAll.checked = all.length > 0 && all.every(function (b) { return b.checked; });
      updateReviewCount();
    });

    // ---- send selected not-on-record companies to the staging table ----
    if (sendToStaging) {
      sendToStaging.addEventListener('click', function () {
        const sel = selectedReviewResults();
        if (sel.length === 0) return;
        const staged = new Set(stagingRows.map(function (r) { return window.Matcher.normalise(r.name); }));
        let added = 0;
        sel.forEach(function (r) {
          const norm = window.Matcher.normalise(r.input);
          if (staged.has(norm)) return; // already staged, skip
          staged.add(norm);
          stagingRows.push(makeRow({ name: r.input, industry: r.industry || 'other' }));
          added++;
        });
        renderStaging();
        renderReview();   // staged companies leave Panel B
        document.getElementById('section-add').scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.toast) {
          window.toast(added > 0
            ? { type: 'success', title: 'Staged', message: added + (added === 1 ? ' company' : ' companies') + ' ready to review.' }
            : { type: 'info', title: 'Already staged', message: 'These companies are already in the table below.' });
        }
      });
    }

    // ---- Panel A outreach logging: select-all, per-row sync, and commit ----
    if (logAll) {
      logAll.addEventListener('change', function () {
        const on = logAll.checked;
        matchedTbody.querySelectorAll('.vet-log-check').forEach(function (b) { b.checked = on; });
        updateLogCount();
      });
    }

    matchedTbody.addEventListener('change', function (e) {
      if (!e.target.classList.contains('vet-log-check')) return;
      const all = Array.prototype.slice.call(matchedTbody.querySelectorAll('.vet-log-check'));
      if (logAll) logAll.checked = all.length > 0 && all.every(function (b) { return b.checked; });
      updateLogCount();
    });

    if (logBtn) {
      logBtn.addEventListener('click', function () {
        const boxes = Array.prototype.slice.call(matchedTbody.querySelectorAll('.vet-log-check:checked'));
        if (boxes.length === 0) return;
        const label = boxes.length === 1 ? '1 company' : boxes.length + ' companies';
        if (!confirm('Log an outreach for ' + label + '? This adds 1 to each running count and cannot be undone here.')) return;

        let logged = 0, capped = 0;
        boxes.forEach(function (b) {
          const res = logOutreach(b.getAttribute('data-id'));
          if (res === 'logged') logged++;
          else if (res === 'capped') { logged++; capped++; }
        });

        window.AdminShell.logActivity('outreach.logged', logged + ' companies',
          'Logged outreach for ' + logged + ' companies' + (capped ? ' (' + capped + ' reached the cap)' : ''));

        revet();  // refresh status, remarks, outreach and panels consistently

        if (window.toast) {
          let msg = 'Added 1 outreach to ' + (logged === 1 ? '1 company' : logged + ' companies') + '.';
          if (capped) msg += ' ' + (capped === 1 ? '1 reached its cap and is now in cooldown.' : capped + ' reached their cap and are now in cooldown.');
          window.toast({ type: 'success', title: 'Outreach logged', message: msg });
        }
      });
    }

    // ============================================================
    // STEP 2 — staging table (bulk add)
    // ============================================================

    function makeRow(seed) {
      seed = seed || {};
      const category = seed.category || 'master';
      return {
        uid: 'r' + (uidSeq++),
        name: seed.name || '',
        category: category,
        industry: seed.industry || 'other',
        detail: seed.detail || '',
        include: true,
        logOutreach: category === 'master'   // default on for approved companies only
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
              '<td class="bulk-staging__log"><input type="checkbox" class="bulk-staging__check" data-field="logOutreach"' +
                (row.include && row.category === 'master' && row.logOutreach ? ' checked' : '') +
                (row.include && row.category === 'master' ? '' : ' disabled') + ' aria-label="Log first outreach"></td>' +
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

    // Sync a row's "Log outreach" checkbox to its state: only an INCLUDED,
    // approved row can log outreach. Unticking the sponsor, or setting any
    // status other than Approved, clears + disables the outreach box.
    function applyLogState(tr, row) {
      const logInput = tr.querySelector('[data-field="logOutreach"]');
      if (!logInput) return;
      const canLog = row.include && row.category === 'master';
      row.logOutreach = canLog;
      logInput.checked = canLog;
      logInput.disabled = !canLog;
    }

    stagingTbody.addEventListener('change', function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const row = rowByUid(tr.getAttribute('data-uid'));
      if (!row) return;
      const field = e.target.getAttribute('data-field');

      if (field === 'include') {
        row.include = e.target.checked;
        tr.classList.toggle('is-excluded', !row.include);
        applyLogState(tr, row);   // unticking the sponsor also clears its outreach box
        syncSelectAll();
        updateStagingCount();
      }
      if (field === 'industry') row.industry = e.target.value;
      if (field === 'logOutreach') row.logOutreach = e.target.checked;
      if (field === 'category') {
        row.category = e.target.value;
        // Update the detail field's placeholder to match the new status.
        const detailInput = tr.querySelector('[data-field="detail"]');
        if (detailInput) {
          detailInput.placeholder = DETAIL_META[row.category].placeholder;
          detailInput.classList.remove('is-invalid');
        }
        applyLogState(tr, row);
      }
    });

    stagingTbody.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-field="remove"]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const uid = tr.getAttribute('data-uid');
      stagingRows = stagingRows.filter(function (r) { return r.uid !== uid; });
      renderStaging();
      renderReview();   // a removed company returns to Panel B if it came from there
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
        stagingTbody.querySelectorAll('tr').forEach(function (tr) {
          const row = rowByUid(tr.getAttribute('data-uid'));
          if (!row) return;
          row.include = on;
          const cb = tr.querySelector('[data-field="include"]');
          if (cb) cb.checked = on;
          tr.classList.toggle('is-excluded', !on);
          applyLogState(tr, row);   // clear outreach boxes when unticking all
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
        renderReview();   // cleared companies return to Panel B
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
      const toLog = [];          // ids to record a first outreach against
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
        if (row.category === 'master' && row.logOutreach) toLog.push(payload.id);
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

      // Record a first outreach for approved rows that opted in.
      let loggedCount = 0;
      toLog.forEach(function (id) { if (logOutreach(id) !== 'skipped') loggedCount++; });

      window.AdminShell.logActivity('sponsor.bulk_added', payloads.length + ' sponsors',
        'Bulk add of ' + payloads.length + ' sponsors' + (loggedCount ? ', ' + loggedCount + ' with first outreach' : '') + (skipped.length ? ' (' + skipped.length + ' skipped as duplicates)' : ''));

      // 4. Remove the committed + skipped rows; keep only unticked ones.
      stagingRows = stagingRows.filter(function (r) { return !r.include; });
      renderStaging();

      const parts = ['Added ' + payloads.length + (payloads.length === 1 ? ' sponsor' : ' sponsors') + '.'];
      if (loggedCount) parts.push('First outreach recorded for ' + loggedCount + '.');
      if (skipped.length) parts.push(skipped.length + ' skipped (already in the database).');
      window.toast && window.toast({ type: 'success', title: 'Database updated', message: parts.join(' ') });

      // Re-vet the uploaded list so anything just added moves from the review
      // panel up into "Found in the database", where its outreach can be logged.
      revet();
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
