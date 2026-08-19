/* ============================================================
   js/pages/sponsor-check.js
   Orchestrates the full flow:
   metadata, upload, parse, preview, check, results.

   v3 notes:
   - Default event size is 'small' (matches HTML).
   - CSV-only uploads (no .txt).
   - Email-to-BIZCOM button stays disabled until event name,
     club, and size are all set.
   - Results table shows only status, industry, and reason.
     The matched-database-name and (provided|inherited|...) tags
     have been removed for a cleaner student view.
   - CSV download is sorted by status alphabetically, then by
     company name, so BIZCOM can vet in one pass.
   ============================================================ */

(function () {
  'use strict';

  // ---------- Element refs ----------
  const dropZone      = document.getElementById('drop-zone');
  const fileInput     = document.getElementById('file-input');
  const eventName     = document.getElementById('event-name');
  const eventClub     = document.getElementById('event-club');
  const eventSizeBtns = document.querySelectorAll('[data-event-size]');

  const uploadState   = document.getElementById('state-upload');
  const previewState  = document.getElementById('state-preview');
  const checkingState = document.getElementById('state-checking');
  const resultsState  = document.getElementById('state-results');

  const uploadStatus  = document.getElementById('upload-status');
  const previewBody   = document.getElementById('preview-body');
  const previewTotal  = document.getElementById('preview-total');
  const previewCap    = document.getElementById('preview-cap');
  const submitBtn     = document.getElementById('submit-check');
  const reuploadBtn   = document.getElementById('reupload');

  const startOverBtn  = document.getElementById('start-over');
  const downloadCsvBtn = document.getElementById('download-csv');
  const emailBizcomBtn = document.getElementById('email-bizcom');
  const emailError     = document.getElementById('email-error');
  const emailErrorText = document.getElementById('email-error-text');

  const resultsTbody  = document.getElementById('results-tbody');
  const filterChips   = document.querySelectorAll('[data-filter]');
  const summary = {
    clear:      document.getElementById('count-clear'),
    caution:    document.getElementById('count-caution'),
    alumni:     document.getElementById('count-alumni'),
    prohibited:    document.getElementById('count-prohibited'),
    cooldown:   document.getElementById('count-cooldown'),
    unverified: document.getElementById('count-unverified'),
    duplicate:  document.getElementById('count-duplicate')
  };

  // ---------- State ----------
  let parsedRows = [];
  let results = [];
  let eventSize = 'small';
  let activeFilter = 'all';
  let isFromSample = false;

  // ---------- Live data (Supabase, anon-readable) ----------
  let sponsors = [];
  let industries = [];
  let outreachMap = {};
  let settings = {};
  let readyPromise = null;
  const DAY_MS = 86400000;

  function todayISO() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  const todayStr = todayISO();

  function loadData() {
    return Promise.all([
      window.PublicData.allSponsors(),
      window.PublicData.listIndustries(),
      window.PublicData.outreachSnapshot(),
      window.PublicData.getSettings()
    ]).then(function (out) {
      sponsors = out[0] || [];
      industries = out[1] || [];
      outreachMap = out[2] || {};
      settings = out[3] || {};
      // Reuse the shared normalise for the lookup key so it can't drift.
      sponsors.forEach(function (s) { s.normalised = window.Matcher.normalise(s.name); });
    });
  }

  // Live cap/cooldown state for a sponsor (mirrors the admin cap logic), read
  // from the loaded outreach snapshot + settings.
  function capState(id) {
    const cap = (settings.outreach_cap != null) ? settings.outreach_cap : 10;
    const cooldownDays = (settings.cooldown_days != null) ? settings.cooldown_days : 30;
    const rec = outreachMap[id];
    let count = rec ? (rec.count || 0) : 0;
    let inCooldown = false, cooldownEndsAt = null;
    if (rec && rec.cooldown_started_at) {
      const end = new Date(rec.cooldown_started_at).getTime() + cooldownDays * DAY_MS;
      if (Date.now() < end) { inCooldown = true; cooldownEndsAt = new Date(end); }
      else { count = 0; }
    }
    const atCap = count >= cap;
    return {
      count: count, cap: cap, cooldownDays: cooldownDays,
      inCooldown: inCooldown, cooldownEndsAt: cooldownEndsAt,
      atCap: atCap, approaching: !inCooldown && !atCap && count >= cap - 2
    };
  }
  function matchCtx() { return { sponsors: sponsors, capState: capState, today: todayStr }; }

  // Per-size sponsor caps, read from the live settings row loaded at boot.
  // Falls back to the PRD defaults if settings are missing.
  function eventCaps() {
    const s = settings || {};
    return {
      small:  (s.event_cap_small  != null) ? s.event_cap_small  : 300,
      medium: (s.event_cap_medium != null) ? s.event_cap_medium : 600,
      large:  (s.event_cap_large  != null) ? s.event_cap_large  : 1000
    };
  }
  const SIZE_LABELS = {
    small:  'Small (under 50 attendees)',
    medium: 'Medium (50 to 150 attendees)',
    large:  'Large (over 150 attendees)'
  };

  // ---------- Email validation ----------
  // The "Email to BIZCOM" button stays clickable at all times. A greyed-out
  // button gives no reason why, so the mandatory section 1 fields are checked
  // on click instead, with a message and a jump to the first empty field.

  // Returns the empty section 1 fields, first one first.
  function missingEventFields() {
    const missing = [];
    if (!eventName || !eventName.value.trim()) missing.push(eventName);
    if (!eventClub || !eventClub.value.trim()) missing.push(eventClub);
    if (!eventSize) missing.push(document.querySelector('[data-event-size]'));
    return missing;
  }

  function showEmailError(text) {
    if (!emailError || !emailErrorText) return;
    emailErrorText.textContent = text;
    emailError.hidden = false;
  }

  function clearEmailError() {
    if (!emailError || !emailErrorText) return;
    emailErrorText.textContent = '';
    emailError.hidden = true;
  }

  // Clear a standing error as soon as the fields are put right.
  function updateEmailButtonState() {
    if (emailError && !emailError.hidden && missingEventFields().length === 0) {
      clearEmailError();
    }
  }

  if (eventName) eventName.addEventListener('input', updateEmailButtonState);
  if (eventClub) eventClub.addEventListener('input', updateEmailButtonState);

  // ---------- Event size tile picker ----------
  eventSizeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      eventSizeBtns.forEach(function (b) {
        b.classList.remove('is-active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-checked', 'true');
      eventSize = btn.getAttribute('data-event-size');
      if (previewCap) {
        previewCap.textContent = SIZE_LABELS[eventSize] + ', cap ' + eventCaps()[eventSize].toLocaleString();
      }
      updateEmailButtonState();
    });
  });

  // ---------- Drag-and-drop ----------
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

  // ---------- File handling ----------
  function handleFile(file) {
    const okExt = /\.csv$/i.test(file.name);
    if (!okExt) {
      shakeDropZone();
      window.toast({
        type: 'error',
        title: 'Wrong file type',
        message: 'Only .csv is accepted. Download the Excel template, fill it in, and save as CSV before uploading.'
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      shakeDropZone();
      window.toast({
        type: 'error',
        title: 'File too large',
        message: 'Maximum upload size is 5 MB. For larger lists, contact BIZCOM directly.'
      });
      return;
    }

    showUploadStatus(file);

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        parseContent(e.target.result, file.name);
      } catch (err) {
        window.toast({
          type: 'error',
          title: 'Could not parse file',
          message: err.message || 'Please check the file format and try again.'
        });
        resetToUpload();
      }
    };
    reader.onerror = function () {
      window.toast({ type: 'error', title: 'Read failed', message: 'Could not read the file.' });
      resetToUpload();
    };
    reader.readAsText(file);
  }

  function shakeDropZone() {
    dropZone.style.animation = 'none';
    void dropZone.offsetWidth;
    dropZone.style.animation = 'shake 300ms';
  }

  function showUploadStatus(file) {
    uploadStatus.innerHTML =
      '<div class="upload-status">' +
        '<div class="upload-status__icon"><i class="bi bi-file-earmark-text"></i></div>' +
        '<div class="upload-status__body">' +
          '<div class="upload-status__name">' + escapeHtml(file.name) + '</div>' +
          '<div class="upload-status__meta">' + (file.size / 1024).toFixed(1) + ' KB, parsing...</div>' +
          '<div class="progress mt-2"><div class="progress__bar progress__bar--indeterminate"></div></div>' +
        '</div>' +
      '</div>';
  }

  // ---------- Parser (CSV) ----------
  function parseContent(text, filename) {
    const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });

    if (lines.length === 0) {
      throw new Error('This file appears to be empty.');
    }

    const rows = [];
    const headerLine = lines[0];
    const headerCols = parseCsvLine(headerLine).map(function (c) { return c.toLowerCase().trim(); });
    const hasHeader = headerCols.some(function (c) { return /name|company/.test(c); });
    const nameIdx = hasHeader ? headerCols.findIndex(function (c) { return /name|company/.test(c); }) : 0;
    const indIdx  = hasHeader ? headerCols.findIndex(function (c) { return /industry|category|type|code/.test(c); }) : -1;
    const dataLines = hasHeader ? lines.slice(1) : lines;
    dataLines.forEach(function (line) {
      const cols = parseCsvLine(line);
      const name = (cols[nameIdx] || '').trim();
      if (!name) return;
      const industry = indIdx >= 0 ? (cols[indIdx] || '').trim() : '';
      rows.push({ name: name, industry: industry || null });
    });

    if (rows.length === 0) {
      throw new Error('No company names found in the file.');
    }

    if (rows.length > eventCaps()[eventSize]) {
      showCapExceededModal(rows.length);
      return;
    }

    parsedRows = rows;
    showPreview();
  }

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

  function showCapExceededModal(count) {
    document.getElementById('cap-modal-count').textContent = count.toLocaleString();
    document.getElementById('cap-modal-cap').textContent   = eventCaps()[eventSize].toLocaleString();
    document.getElementById('cap-modal-size').textContent  = SIZE_LABELS[eventSize];
    window.openModal('cap-modal');
    resetToUpload();
  }

  // ---------- Preview ----------
  function showPreview() {
    uploadState.classList.add('d-none');
    previewState.classList.remove('d-none');

    previewTotal.textContent = parsedRows.length.toLocaleString();
    previewCap.textContent = SIZE_LABELS[eventSize] + ', cap ' + eventCaps()[eventSize].toLocaleString() + ' OK';

    previewBody.innerHTML = parsedRows.slice(0, 10).map(function (r, i) {
      const indCell = r.industry
        ? '<span class="tag">' + escapeHtml(r.industry) + '</span>'
        : '<span class="text-muted text-xs">auto</span>';
      return (
        '<tr>' +
          '<td class="table__cell-secondary">' + (i + 1) + '</td>' +
          '<td class="table__cell-primary">' + escapeHtml(r.name) + '</td>' +
          '<td>' + indCell + '</td>' +
        '</tr>'
      );
    }).join('');

    if (parsedRows.length > 10) {
      previewBody.innerHTML +=
        '<tr><td colspan="3" class="text-center text-muted text-xs" style="padding: var(--space-3)">' +
          '+ ' + (parsedRows.length - 10) + ' more rows...' +
        '</td></tr>';
    }

    // If this came from the sample button, the user has already implicitly
    // confirmed the data. Hide the check button and auto-run.
    if (isFromSample && submitBtn) {
      submitBtn.style.display = 'none';
      setTimeout(function () {
        // Reset the flag so a later manual upload behaves normally
        isFromSample = false;
        runCheck();
      }, 600);
    } else if (submitBtn) {
      submitBtn.style.display = '';
    }
  }

  if (reuploadBtn) reuploadBtn.addEventListener('click', resetToUpload);
  if (submitBtn) submitBtn.addEventListener('click', runCheck);

  // ---------- Check ----------
  function runCheck() {
    previewState.classList.add('d-none');
    checkingState.classList.remove('d-none');

    // Ensure the live sponsor data is loaded, then match (synchronous). The
    // short delay keeps the "cross-checking" animation visible.
    (readyPromise || loadData()).then(function () {
      setTimeout(function () {
        results = window.Matcher.checkBatch(parsedRows, matchCtx());
        renderResults();
      }, 700);
    }, function (e) {
      checkingState.classList.add('d-none');
      previewState.classList.remove('d-none');
      window.toast && window.toast({ type: 'error', title: 'Could not reach the database', message: (e && e.message) || 'Please try again.' });
    });
  }

  // ---------- Results ----------
  function renderResults() {
    checkingState.classList.add('d-none');
    resultsState.classList.remove('d-none');

    const counts = { clear: 0, caution: 0, alumni: 0, prohibited: 0, cooldown: 0, unverified: 0, duplicate: 0 };
    results.forEach(function (r) {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });

    Object.keys(summary).forEach(function (key) {
      if (summary[key]) {
        summary[key].setAttribute('data-countup', counts[key] || 0);
        summary[key].textContent = '0';
        if (typeof window.animateCountUp === 'function') {
          window.animateCountUp(summary[key]);
        } else {
          summary[key].textContent = String(counts[key] || 0);
        }
      }
    });

    // Duplicate-row nudge banner. Visible only when count > 0.
    const dupBanner = document.getElementById('duplicate-banner');
    const dupCountEl = document.getElementById('duplicate-banner-count');
    if (dupBanner && dupCountEl) {
      if (counts.duplicate > 0) {
        dupCountEl.textContent = String(counts.duplicate);
        dupBanner.hidden = false;
      } else {
        dupBanner.hidden = true;
      }
    }

    renderTable();

    // Confetti only when there are zero issues to act on.
    // "Issues" = prohibited, cooldown, alumni (alumni still needs OAR coordination).
    // Unverified is fine, that's just BIZCOM's normal job.
    const hasIssues = counts.prohibited > 0 || counts.cooldown > 0 || counts.alumni > 0;
    if (!hasIssues && results.length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (window.confetti) {
        window.confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.3 },
          colors: ['#2E529D', '#D6B238', '#2A9463']
        });
      }
    }

    resultsState.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTable() {
    const filtered = activeFilter === 'all'
      ? results
      : results.filter(function (r) { return r.status === activeFilter; });

    if (filtered.length === 0) {
      resultsTbody.innerHTML =
        '<tr><td colspan="5">' +
          '<div class="empty-state">' +
            '<i class="bi bi-search empty-state__icon"></i>' +
            '<div class="empty-state__title">No matches for this filter</div>' +
            '<div class="empty-state__description">Try a different status or clear the filter.</div>' +
          '</div>' +
        '</td></tr>';
      return;
    }

    resultsTbody.innerHTML = filtered.map(function (r, i) {
      const pill = pillFor(r.status);
      const industryLabel = r.industry ? industryDisplayName(r.industry) : '';
      const flagClass = (r.status === 'prohibited' || r.status === 'cooldown') ? 'is-flagged' : '';
      return (
        '<tr class="' + flagClass + '">' +
          '<td class="table__cell-secondary" data-label="#">' + (i + 1) + '</td>' +
          '<td data-label="Company">' +
            '<div class="table__cell-primary">' + escapeHtml(r.input) + '</div>' +
          '</td>' +
          '<td data-label="Status">' + pill + '</td>' +
          '<td data-label="Industry">' +
            (industryLabel ? '<span class="tag">' + escapeHtml(industryLabel) + '</span>' : '<span class="text-muted text-xs">unknown</span>') +
          '</td>' +
          '<td data-label="Reason" class="text-secondary text-xs">' + escapeHtml(r.reason || '') + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  filterChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      filterChips.forEach(function (c) { c.classList.remove('is-active'); });
      chip.classList.add('is-active');
      activeFilter = chip.getAttribute('data-filter');
      renderTable();
    });
  });

  function pillFor(status) {
    const map = {
      clear:      { cls: 'pill--clear',    icon: 'bi-check-circle-fill',       label: 'Clear' },
      caution:    { cls: 'pill--caution',  icon: 'bi-exclamation-circle-fill', label: 'Caution' },
      alumni:     { cls: 'pill--alumni',   icon: 'bi-mortarboard-fill',        label: 'Alumni' },
      prohibited:    { cls: 'pill--prohibited',  icon: 'bi-x-circle-fill',           label: 'Prohibited' },
      cooldown:   { cls: 'pill--cooldown', icon: 'bi-clock-fill',              label: 'Cooldown' },
      unverified: { cls: 'pill--neutral',  icon: 'bi-question-circle-fill',    label: 'Unverified' },
      duplicate:  { cls: 'pill--neutral',  icon: 'bi-files',                   label: 'Duplicate' }
    };
    const m = map[status] || map.duplicate;
    return '<span class="pill ' + m.cls + '"><i class="bi ' + m.icon + ' pill__icon"></i>' + m.label + '</span>';
  }

  function industryDisplayName(code) {
    const ind = industries.find(function (i) { return i.code === code; });
    return ind ? ind.display_name : code;
  }

  // ---------- Download CSV ----------
  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener('click', function () {
      const header = ['name', 'status', 'matched_name', 'industry_classified', 'classification_source', 'reason'];
      const lines = [header.join(',')];

      // Sort by status alphabetically, then by company name within each status.
      // This groups all rows of the same status together for easier vetting.
      const sorted = results.slice().sort(function (a, b) {
        const sa = (a.status || '').toLowerCase();
        const sb = (b.status || '').toLowerCase();
        if (sa < sb) return -1;
        if (sa > sb) return 1;
        const na = (a.input || '').toLowerCase();
        const nb = (b.input || '').toLowerCase();
        if (na < nb) return -1;
        if (na > nb) return 1;
        return 0;
      });

      sorted.forEach(function (r) {
        const row = [
          csvEscape(r.input),
          r.status,
          csvEscape(r.matched || ''),
          r.industry || '',
          r.classificationSource || '',
          csvEscape(r.reason || '')
        ];
        lines.push(row.join(','));
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sponsor-check-results.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.toast({ type: 'success', title: 'Download started', message: 'sponsor-check-results.csv' });
    });
  }

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ---------- Email BIZCOM ----------
  if (emailBizcomBtn) {
    emailBizcomBtn.addEventListener('click', function () {
      // Section 1 is the only prerequisite: the draft needs the event name,
      // club and size to be meaningful. Anything missing is reported in place
      // and the student is taken straight to the first empty field.
      const missing = missingEventFields();
      if (missing.length) {
        showEmailError('Ensure all information in Section 1 is filled before emailing BIZCOM.');

        const target = missing[0];
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Focus after the scroll so the browser does not jump instantly.
          setTimeout(function () { target.focus({ preventScroll: true }); }, 350);
        }
        return;
      }
      clearEmailError();

      const event = eventName.value.trim();
      const club  = eventClub.value.trim();

      const subject = encodeURIComponent('[Sponsor Check] ' + event + ', ' + club);
      const body = encodeURIComponent(
        'Hi BIZCOM team,\n\n' +
        'Please find our sponsor list for the following event:\n\n' +
        '  Event: ' + event + '\n' +
        '  Club:  ' + club + '\n' +
        '  Size:  ' + SIZE_LABELS[eventSize] + '\n' +
        '  Total: ' + results.length + ' sponsors\n\n' +
        'Attachments:\n' +
        '  1. Annotated sponsor list (sponsor-check-results.csv)\n' +
        '  2. Sponsorship deck\n' +
        '  3. Outreach email template\n\n' +
        'Thanks!'
      );
      window.location.href = 'mailto:biz@sa.smu.edu.sg,a.biz@sa.smu.edu.sg,biz.secretary@smu.edu.sg?subject=' + subject + '&body=' + body;
    });
  }

  // ---------- Start over ----------
  if (startOverBtn) startOverBtn.addEventListener('click', resetToUpload);

  function resetToUpload() {
    parsedRows = [];
    results = [];
    isFromSample = false;
    if (fileInput) fileInput.value = '';
    if (uploadStatus) uploadStatus.innerHTML = '';
    if (submitBtn) submitBtn.style.display = '';
    previewState.classList.add('d-none');
    checkingState.classList.add('d-none');
    resultsState.classList.add('d-none');
    uploadState.classList.remove('d-none');
  }

  // ---------- Utilities ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Expose hook for the inline loadSample() helper in sponsor-check.html
  window.__markSampleLoad = function () {
    isFromSample = true;
  };

  // Overwrite the static "Cap: N sponsors" text on each size tile with the
  // admin-configured cap, so the public page matches the Settings page.
  function syncTileCaps() {
    const caps = eventCaps();
    eventSizeBtns.forEach(function (btn) {
      const size = btn.getAttribute('data-event-size');
      const capEl = btn.querySelector('.size-tile__cap');
      if (capEl && caps[size] != null) {
        capEl.textContent = 'Cap: ' + caps[size].toLocaleString() + ' sponsors';
      }
    });
  }

  // Run once at boot: reflect the initial empty fields, then load the live
  // sponsor data + settings and sync the size-tile caps.
  updateEmailButtonState();
  readyPromise = (window.PublicData && window.Matcher)
    ? loadData()
    : Promise.reject(new Error('data layer not ready'));
  readyPromise.then(syncTileCaps, function (e) {
    console.error('[sponsor-check] could not load data', e);
    syncTileCaps();
  });
})();

// Shake keyframe for invalid-drop feedback
(function () {
  const styleId = '__shake_kf';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent =
    '@keyframes shake {' +
      '0%, 100% { transform: translateX(0); }' +
      '20% { transform: translateX(-6px); }' +
      '40% { transform: translateX(6px); }' +
      '60% { transform: translateX(-4px); }' +
      '80% { transform: translateX(4px); }' +
    '}';
  document.head.appendChild(style);
})();
