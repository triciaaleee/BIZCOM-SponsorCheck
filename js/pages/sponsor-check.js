/* ============================================================
   js/pages/sponsor-check.js
   Orchestrates the full flow:
   metadata → upload → parse → preview → check → results
   ============================================================ */

(function () {
  'use strict';

  // ---------- Element refs ----------
  const dropZone     = document.getElementById('drop-zone');
  const fileInput    = document.getElementById('file-input');
  const eventName    = document.getElementById('event-name');
  const eventClub    = document.getElementById('event-club');
  const eventSizeBtns= document.querySelectorAll('[data-event-size]');

  const uploadState  = document.getElementById('state-upload');
  const previewState = document.getElementById('state-preview');
  const checkingState= document.getElementById('state-checking');
  const resultsState = document.getElementById('state-results');

  const uploadStatus = document.getElementById('upload-status');
  const previewBody  = document.getElementById('preview-body');
  const previewTotal = document.getElementById('preview-total');
  const previewCap   = document.getElementById('preview-cap');
  const submitBtn    = document.getElementById('submit-check');
  const reuploadBtn  = document.getElementById('reupload');

  const startOverBtn = document.getElementById('start-over');
  const downloadCsvBtn = document.getElementById('download-csv');
  const emailBizcomBtn = document.getElementById('email-bizcom');

  const resultsTbody = document.getElementById('results-tbody');
  const filterChips  = document.querySelectorAll('[data-filter]');
  const summary      = {
    clear: document.getElementById('count-clear'),
    caution: document.getElementById('count-caution'),
    alumni: document.getElementById('count-alumni'),
    blocked: document.getElementById('count-blocked'),
    cooldown: document.getElementById('count-cooldown')
  };

  // ---------- State ----------
  let parsedRows = [];   // [{ name, industry }]
  let results    = [];   // [{ input, status, matched, industry, reason, ... }]
  let eventSize  = 'medium';
  let activeFilter = 'all';

  const CAPS = { small: 300, medium: 600, large: 1000 };
  const SIZE_LABELS = { small: 'Small (<50 attendees)', medium: 'Medium (50–150)', large: 'Large (>150)' };

  // ---------- Event size segmented control ----------
  eventSizeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      eventSizeBtns.forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      eventSize = btn.getAttribute('data-event-size');
      // Update cap display if preview is currently shown
      if (previewCap) {
        previewCap.textContent = SIZE_LABELS[eventSize] + ' · cap ' + CAPS[eventSize].toLocaleString();
      }
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
    // Validation: type
    const okExt = /\.(csv|txt)$/i.test(file.name);
    if (!okExt) {
      shakeDropZone();
      window.toast({
        type: 'error',
        title: 'Wrong file type',
        message: 'We accept .csv and .txt only. Convert .xlsx in Excel → Save As → CSV.'
      });
      return;
    }
    // Validation: size 5MB
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
    uploadStatus.innerHTML = `
      <div class="upload-status">
        <div class="upload-status__icon"><i class="bi bi-file-earmark-text"></i></div>
        <div class="upload-status__body">
          <div class="upload-status__name">${escapeHtml(file.name)}</div>
          <div class="upload-status__meta">${(file.size / 1024).toFixed(1)} KB · parsing…</div>
          <div class="progress mt-2"><div class="progress__bar progress__bar--indeterminate"></div></div>
        </div>
      </div>
    `;
  }

  // ---------- Parser (CSV/TXT) ----------
  function parseContent(text, filename) {
    const isCsv = /\.csv$/i.test(filename);
    const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });

    if (lines.length === 0) {
      throw new Error('This file appears to be empty.');
    }

    let rows = [];

    if (isCsv) {
      // Detect header
      const headerLine = lines[0];
      const headerCols = parseCsvLine(headerLine).map(function (c) { return c.toLowerCase().trim(); });
      const hasHeader = headerCols.some(function (c) { return /name|company/.test(c); });
      const nameIdx = hasHeader ? headerCols.findIndex(function (c) { return /name|company/.test(c); }) : 0;
      const indIdx  = hasHeader ? headerCols.findIndex(function (c) { return /industry|category|type/.test(c); }) : -1;
      const dataLines = hasHeader ? lines.slice(1) : lines;
      dataLines.forEach(function (line) {
        const cols = parseCsvLine(line);
        const name = (cols[nameIdx] || '').trim();
        if (!name) return;
        const industry = indIdx >= 0 ? (cols[indIdx] || '').trim() : '';
        rows.push({ name: name, industry: industry || null });
      });
    } else {
      // TXT — one name per line
      lines.forEach(function (line) {
        const name = line.trim();
        if (name) rows.push({ name: name, industry: null });
      });
    }

    if (rows.length === 0) {
      throw new Error('No company names found in the file.');
    }

    // Validate against cap
    if (rows.length > CAPS[eventSize]) {
      showCapExceededModal(rows.length);
      return;
    }

    parsedRows = rows;
    showPreview();
  }

  function parseCsvLine(line) {
    // Minimal CSV parser handling quoted commas
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
    document.getElementById('cap-modal-cap').textContent   = CAPS[eventSize].toLocaleString();
    document.getElementById('cap-modal-size').textContent  = SIZE_LABELS[eventSize];
    window.openModal('cap-modal');
    resetToUpload();
  }

  // ---------- Preview ----------
  function showPreview() {
    uploadState.classList.add('d-none');
    previewState.classList.remove('d-none');

    previewTotal.textContent = parsedRows.length.toLocaleString();
    previewCap.textContent = SIZE_LABELS[eventSize] + ' · cap ' + CAPS[eventSize].toLocaleString() + ' ✓';

    // First 10 rows
    previewBody.innerHTML = parsedRows.slice(0, 10).map(function (r, i) {
      return `
        <tr>
          <td class="table__cell-secondary">${i + 1}</td>
          <td class="table__cell-primary">${escapeHtml(r.name)}</td>
          <td>${r.industry ? `<span class="tag">${escapeHtml(r.industry)}</span>` : '<span class="text-muted text-xs">auto</span>'}</td>
        </tr>
      `;
    }).join('');

    if (parsedRows.length > 10) {
      previewBody.innerHTML += `
        <tr><td colspan="3" class="text-center text-muted text-xs" style="padding: var(--space-3)">
          + ${parsedRows.length - 10} more rows…
        </td></tr>
      `;
    }
  }

  if (reuploadBtn) reuploadBtn.addEventListener('click', resetToUpload);
  if (submitBtn) submitBtn.addEventListener('click', runCheck);

  // ---------- Check ----------
  function runCheck() {
    previewState.classList.add('d-none');
    checkingState.classList.remove('d-none');

    window.Matcher.checkBatch(parsedRows).then(function (data) {
      results = data;
      renderResults();
    });
  }

  // ---------- Results ----------
  function renderResults() {
    checkingState.classList.add('d-none');
    resultsState.classList.remove('d-none');

    // Counts
    const counts = { clear: 0, caution: 0, alumni: 0, blocked: 0, cooldown: 0, duplicate: 0 };
    results.forEach(function (r) {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });

    // Animate counts
    Object.keys(summary).forEach(function (key) {
      if (summary[key]) {
        summary[key].setAttribute('data-countup', counts[key] || 0);
        summary[key].textContent = '0';
        window.animateCountUp(summary[key]);
      }
    });

    renderTable();

    // Confetti if 100% clear
    if (counts.clear === results.length && results.length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (window.confetti) {
        window.confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.3 },
          colors: ['#2E529D', '#D6B238', '#2A9463']
        });
      }
    }

    // Scroll into view
    resultsState.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTable() {
    const filtered = activeFilter === 'all'
      ? results
      : results.filter(function (r) { return r.status === activeFilter; });

    if (filtered.length === 0) {
      resultsTbody.innerHTML = `
        <tr><td colspan="5">
          <div class="empty-state">
            <i class="bi bi-search empty-state__icon"></i>
            <div class="empty-state__title">No matches for this filter</div>
            <div class="empty-state__description">Try a different status or clear the filter.</div>
          </div>
        </td></tr>
      `;
      return;
    }

    resultsTbody.innerHTML = filtered.map(function (r, i) {
      const pill = pillFor(r.status);
      const industryLabel = r.industry ? industryDisplayName(r.industry) : '—';
      const sourceLabel = r.classificationSource ? `<span class="text-xs text-muted">(${r.classificationSource})</span>` : '';
      const matchedLabel = r.matched ? `<div class="table__cell-secondary">matched: ${escapeHtml(r.matched)}</div>` : '';
      return `
        <tr class="${r.status === 'blocked' || r.status === 'cooldown' ? 'is-flagged' : ''}">
          <td class="table__cell-secondary" data-label="#">${i + 1}</td>
          <td data-label="Company">
            <div class="table__cell-primary">${escapeHtml(r.input)}</div>
            ${matchedLabel}
          </td>
          <td data-label="Status">${pill}</td>
          <td data-label="Industry"><span class="tag">${escapeHtml(industryLabel)}</span> ${sourceLabel}</td>
          <td data-label="Reason" class="text-secondary text-xs">${escapeHtml(r.reason || '')}</td>
        </tr>
      `;
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
      clear:    { cls: 'pill--clear',    icon: 'bi-check-circle-fill',       label: 'Clear' },
      caution:  { cls: 'pill--caution',  icon: 'bi-exclamation-circle-fill', label: 'Caution' },
      alumni:   { cls: 'pill--alumni',   icon: 'bi-mortarboard-fill',        label: 'Alumni' },
      blocked:  { cls: 'pill--blocked',  icon: 'bi-x-circle-fill',           label: 'Blocked' },
      cooldown: { cls: 'pill--cooldown', icon: 'bi-clock-fill',              label: 'Cooldown' },
      duplicate:{ cls: 'pill--neutral',  icon: 'bi-files',                   label: 'Duplicate' }
    };
    const m = map[status] || map.duplicate;
    return `<span class="pill ${m.cls}"><i class="bi ${m.icon} pill__icon"></i>${m.label}</span>`;
  }

  function industryDisplayName(code) {
    const ind = window.MOCK_DATA.industries.find(function (i) { return i.code === code; });
    return ind ? ind.display_name : code;
  }

  // ---------- Download CSV ----------
  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener('click', function () {
      const header = ['name', 'status', 'matched_name', 'industry_classified', 'classification_source', 'reason'];
      const lines = [header.join(',')];
      results.forEach(function (r) {
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
      const event = eventName.value || '(unnamed event)';
      const club  = eventClub.value || '(club name)';
      const subject = encodeURIComponent('[Sponsor Check] ' + event + ' — ' + club);
      const body = encodeURIComponent(
        'Hi BIZCOM team,\n\n' +
        'Pre-check results for the following:\n\n' +
        '  Event: ' + event + '\n' +
        '  Club:  ' + club + '\n' +
        '  Size:  ' + SIZE_LABELS[eventSize] + '\n' +
        '  Total: ' + results.length + ' sponsors\n\n' +
        'Please find the annotated CSV attached.\n\n' +
        'Thanks!'
      );
      window.location.href = 'mailto:biz.secretary@sa.smu.edu.sg?subject=' + subject + '&body=' + body;
    });
  }

  // ---------- Start over ----------
  if (startOverBtn) {
    startOverBtn.addEventListener('click', resetToUpload);
  }

  function resetToUpload() {
    parsedRows = [];
    results = [];
    if (fileInput) fileInput.value = '';
    if (uploadStatus) uploadStatus.innerHTML = '';
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
})();

// Shake keyframe for invalid-drop feedback
(function () {
  const styleId = '__shake_kf';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }
  `;
  document.head.appendChild(style);
})();
