/* ============================================================
   js/admin/vet-upload-page.js
   Admin "Vet & Upload" page.

   Every list vetted here belongs to a club submission. Step 1 stays
   locked until one is chosen, from ?submission=<id> (the "Vet a list"
   action on Home) or the picker at the top of the page.

     * The list is measured against that club's event-size cap
       (settings.event_cap_small/medium/large).
     * Only companies the club may actually APPROACH consume the cap:
       approved and alumni. Prohibited, closed and in-cooldown ones
       are recorded for the record but counted at zero. So a list of
       14 names where 5 are prohibited uses 9 of the cap, not 14.
     * Recording writes one WAVE of submission_sponsors rows, so a
       club sending its list in instalments accumulates towards one
       cap rather than starting over each time.
     * A company already on the submission is not counted twice, so
       re-uploading a list is safe. Its status is refreshed though,
       which is how a lapsed cooldown or a newly-added company starts
       counting.
     * submissions.sponsor_count is re-derived by a trigger — this
       page is the only thing that moves it (migrations 0012, 0013).

   Order of work, enforced rather than suggested:

     1. pick the submission
     2. upload and vet
     3. resolve anything not on the database in step 2
     4. record the list as a wave
     5. log outreach — only for companies on the submission, and only
        once each per event (submission_sponsors.outreach_logged_at)

   Two connected steps:

     1. Vet a list — upload a CSV of company names (company_name +
        optional industry_code, the same template the public checker
        uses) and run it through AdminMatcher against the LIVE sponsor
        list. Matched companies are flagged by their database status;
        companies not on record are listed for individual review.

     2. Add to database — an editable staging table. The admin sets
        each company's status + industry and adds them all at once via
        a bulk insert. This step works without a submission attached,
        so it doubles as the bulk entry screen for the sponsor list.
        It records no outreach: a contact belongs to an event, so it
        is logged in step 1 against a recorded submission.

   Data layer (Supabase, no MOCK_DATA):
     * Matching:      AdminMatcher.checkBatch(rows, ctx) over live data
                      loaded by AdminAPI (reuses Matcher.normalise).
     * Log outreach:  AdminAPI.logOutreach() -> log_outreach RPC,
                      passed the submission so it stamps the line item
                      and refuses a second log for the same event.
     * Bulk add:      AdminAPI.bulkAddSponsors() -> insert (skip dupes).
     * Record a wave: AdminAPI.recordSubmissionWave() -> the
                      record_submission_wave RPC, which owns the
                      event cap the same way log_outreach owns the
                      outreach cap.
   ============================================================ */

(function () {
  'use strict';

  // Sponsor categories, mirroring sponsor-page.js / the DB check constraint.
  const STATUS_OPTIONS = [
    { value: 'approved', label: 'Approved' },
    { value: 'prohibited', label: 'Prohibited'   },
    { value: 'closed', label: 'Closed'   },
    { value: 'alumni', label: 'Alumni'   }
  ];

  // Placeholder + whether the "detail" field is required, per status. The
  // detail column maps to notes (approved/closed/alumni) or ban_reason (prohibited).
  const DETAIL_META = {
    approved: { placeholder: 'Notes (optional)',                 required: false },
    prohibited: { placeholder: 'Prohibited reason, e.g. Annex A, Gaming', required: true },
    closed: { placeholder: 'Closed notes (optional)',          required: false },
    alumni: { placeholder: 'Notes (optional)',                 required: false }
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

  function todayISODate() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function init() {
    if (!window.sb || !window.AdminAPI || !window.Matcher) {
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
    const dropZoneTitle = document.getElementById('drop-zone-title');
    const dropZoneHint  = document.getElementById('drop-zone-hint');
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
    const matchedFootNote = document.getElementById('matched-foot-note');
    const logAll        = document.getElementById('log-all');
    const logBtn        = document.getElementById('log-outreach-btn');
    const logCountEl    = document.getElementById('log-count');
    const reviewTbody   = document.getElementById('review-tbody');
    const reviewEmpty   = document.getElementById('review-empty');
    const reviewFoot    = document.getElementById('review-foot');
    const reviewAll     = document.getElementById('review-all');
    const reviewSelText = document.getElementById('review-sel-text');
    const sendToStaging = document.getElementById('send-to-staging');

    // Submission context (the link to the Home calendar).
    const subSelect     = document.getElementById('vet-sub-select');
    const subDetail     = document.getElementById('vet-sub-detail');
    const subNone       = document.getElementById('vet-sub-none');
    const subMeta       = document.getElementById('vet-sub-meta');
    const subCountEl    = document.getElementById('vet-sub-count');
    const subWavesEl    = document.getElementById('vet-sub-waves');
    const subBar        = document.getElementById('vet-sub-bar');
    const recordBar     = document.getElementById('vet-record');
    const recordTitle   = document.getElementById('vet-record-title');
    const recordMsg     = document.getElementById('vet-record-msg');
    const recordCountEl = document.getElementById('vet-record-count');
    const recordBtn     = document.getElementById('vet-record-btn');
    const capBanner     = document.getElementById('cap-banner');
    const capBannerMsg  = document.getElementById('cap-banner-msg');

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

    // Live data (loaded from Supabase at boot / refreshed after writes).
    let sponsors = [];
    let industries = [];
    let outreachMap = {};       // { sponsorId: { count, cooldown_started_at, in_cooldown } }
    let settings = {};
    let loadError = false;

    // Submission context.
    let submissionList = [];    // every submission, for the picker
    let submissionId = null;    // the one this run is attached to, or null
    let submission = null;      // its row (sponsor_count/wave_count are derived)
    let recordedNorms = new Set();     // normalised names already on the submission
    let recordedByNorm = new Map();    // normalised -> line item (carries the outreach lock)
    let recordedRows = [];
    const todayStr = todayISODate();
    let readyPromise = null;

    // ---------- helpers ----------
    function toastMsg(o) { if (window.toast) window.toast(o); }
    function toastError(title, e) {
      console.error('[vet-upload]', title, e);
      toastMsg({ type: 'error', title: title, message: (e && e.message) || 'Please try again.' });
    }

    // Live cap/cooldown state for a sponsor, mirroring the old window.Caps.state
    // but reading the loaded outreach snapshot + settings (no globals).
    const DAY_MS = 86400000;
    function capState(sponsorId) {
      const cap = (settings.outreach_cap != null) ? settings.outreach_cap : 10;
      const cooldownDays = (settings.cooldown_days != null) ? settings.cooldown_days : 30;
      const rec = outreachMap[sponsorId];
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

    function matchCtx() {
      return { sponsors: sponsors, capState: capState, today: todayStr };
    }

    function loadData() {
      return Promise.all([
        window.AdminAPI.listIndustries(),
        window.AdminAPI.allSponsors(),
        window.AdminAPI.outreachSnapshot(),
        window.AdminAPI.getSettings(),
        window.AdminAPI.listSubmissions()
      ]).then(function (out) {
        industries = out[0] || [];
        sponsors = out[1] || [];
        outreachMap = out[2] || {};
        settings = out[3] || {};
        submissionList = out[4] || [];
        // Reuse the shared normalise for the lookup key so it can't drift.
        sponsors.forEach(function (s) { s.normalised = window.Matcher.normalise(s.name); });
      }).catch(function (e) {
        loadError = true;
        toastError('Could not load the sponsor database', e);
      });
    }
    function refreshOutreach() {
      return window.AdminAPI.outreachSnapshot().then(function (map) { outreachMap = map || {}; }, function () {});
    }
    function refreshSponsors() {
      return window.AdminAPI.allSponsors().then(function (rows) {
        sponsors = rows || [];
        sponsors.forEach(function (s) { s.normalised = window.Matcher.normalise(s.name); });
      }, function () {});
    }

    // Bucket a Matcher result by the matched company's real DB category, so
    // prohibited / approved / closed / alumni are distinguished. 'review' = not on
    // record. Cap state is read live so a just-logged company re-buckets.
    function classify(r) {
      if (r.status === 'duplicate') return 'duplicate';
      switch (r.matchedCategory) {
        case 'prohibited': return 'prohibited';
        case 'closed': return 'closed';
        case 'alumni': return 'alumni';
        case 'approved': {
          const st = r.matchedId ? capState(r.matchedId) : null;
          return (st && st.inCooldown) ? 'cooldown' : 'approved';
        }
        default: return 'review';
      }
    }

    // ============================================================
    // SUBMISSION CONTEXT — which club list this run is counted against
    // ============================================================

    const SIZE_LABEL = { small: 'Small', medium: 'Medium', large: 'Large' };

    function capForSize(size) {
      const caps = {
        small:  settings.event_cap_small,
        medium: settings.event_cap_medium,
        large:  settings.event_cap_large
      };
      const fallbacks = { small: 300, medium: 600, large: 1000 };
      const v = caps[size];
      return (v != null) ? Number(v) : (fallbacks[size] || 0);
    }

    function submissionCap() {
      return submission ? capForSize(submission.event_size) : 0;
    }

    function submissionIdFromUrl() {
      try {
        return new URLSearchParams(window.location.search).get('submission') || null;
      } catch (e) {
        return null;
      }
    }

    // Keep ?submission= in step with the picker so a refresh (or a bookmark)
    // lands back on the same submission.
    function syncUrl() {
      if (!window.history || !window.history.replaceState) return;
      const url = new URL(window.location.href);
      if (submissionId) url.searchParams.set('submission', submissionId);
      else url.searchParams.delete('submission');
      window.history.replaceState({}, '', url.toString());
    }

    function fillSubmissionOptions() {
      if (!subSelect) return;
      const opts = ['<option value="">Choose a submission…</option>'];
      submissionList.forEach(function (s) {
        const when = formatDateShort(new Date(s.submitted_at));
        const done = s.status === 'completed' ? ' — completed' : '';
        opts.push(
          '<option value="' + esc(s.id) + '">' +
            esc(s.event_name) + ' — ' + esc(s.club) + ' (' + esc(when) + ')' + done +
          '</option>'
        );
      });
      subSelect.innerHTML = opts.join('');
      subSelect.value = submissionId || '';
    }

    function renderSubmissionCard() {
      if (!subDetail) return;

      if (!submission) {
        subDetail.hidden = true;
        if (subNone) subNone.hidden = false;
        return;
      }
      subDetail.hidden = false;
      if (subNone) subNone.hidden = true;

      const cap = submissionCap();
      const used = submission.sponsor_count || 0;
      const waves = submission.wave_count || 0;
      const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

      subMeta.innerHTML =
        '<span><strong>' + esc(submission.club) + '</strong></span>' +
        '<span>' + esc(submission.contact_email) + '</span>' +
        '<span>' + esc(SIZE_LABEL[submission.event_size] || submission.event_size) +
          ' event · cap ' + cap.toLocaleString() + '</span>' +
        (submission.complete_by
          ? '<span>Due ' + esc(formatDateShort(new Date(submission.complete_by))) + '</span>'
          : '') +
        '<span><a href="home.html">View on Home</a></span>';

      const listed = submission.listed_count || 0;
      subCountEl.textContent = used.toLocaleString() + ' / ' + cap.toLocaleString() + ' sponsors';
      subWavesEl.textContent =
        (waves === 0 ? 'No waves yet' : waves + (waves === 1 ? ' wave' : ' waves')) +
        (listed > used ? ' · ' + listed.toLocaleString() + ' listed, ' +
                         (listed - used).toLocaleString() + ' not approachable' : '');

      subBar.style.width = pct + '%';
      subBar.classList.toggle('sub-cap__bar--full', cap > 0 && used >= cap);
      subBar.classList.toggle('sub-cap__bar--near', cap > 0 && used < cap && pct >= 80);
    }

    // Every company on the uploaded list, minus the rows the matcher flagged as
    // duplicates of an earlier row — those are the club listing one company
    // twice, not two sponsors.
    function listedCompanies() {
      return results.filter(function (r) { return r.status !== 'duplicate'; });
    }

    // Of those, the ones not already on this submission.
    function unrecordedCompanies() {
      return listedCompanies().filter(function (r) {
        return !recordedNorms.has(window.Matcher.normalise(r.input));
      });
    }

    // The cap counts sponsors the event may APPROACH, not names the club sent.
    // Approved and alumni consume it; prohibited, closed, in-cooldown and
    // not-yet-vetted companies are recorded but do not. Mirrors the server's
    // counts_toward_cap() (migration 0013).
    function countsTowardCap(bucket) {
      return window.AdminAPI.countsTowardCap(bucket);
    }

    function countedCompanies() {
      return listedCompanies().filter(function (r) { return countsTowardCap(classify(r)); });
    }

    // Companies with no verdict yet. These must be added to the database in
    // step 2 before the wave can be recorded, otherwise they would sit on the
    // submission as permanent unknowns consuming nothing.
    function unresolvedCompanies() {
      return listedCompanies().filter(function (r) { return classify(r) === 'review'; });
    }

    // The whole list is sent, not just the new ones: the RPC de-dupes and skips
    // anything already recorded, so a stale local snapshot cannot double-count.
    function waveEntries() {
      return listedCompanies().map(function (r) {
        return {
          company_name: r.input,
          normalised: window.Matcher.normalise(r.input),
          sponsor_id: r.matchedId || null,
          status: classify(r)
        };
      });
    }

    function renderRecordBar() {
      if (!recordBar) return;

      if (!submission) {
        recordBar.hidden = true;
        if (capBanner) capBanner.hidden = true;
        return;
      }
      recordBar.hidden = false;

      const listed = listedCompanies().length;
      const fresh = unrecordedCompanies().length;
      const unresolved = unresolvedCompanies().length;
      const cap = submissionCap();
      const used = submission.sponsor_count || 0;

      // Only the approachable ones among the new companies move the cap.
      const freshCounting = unrecordedCompanies()
        .filter(function (r) { return countsTowardCap(classify(r)); }).length;
      const wouldBe = used + freshCounting;
      const over = cap > 0 && wouldBe > cap;

      recordCountEl.textContent = fresh;
      recordBtn.disabled = fresh === 0 || over || unresolved > 0;
      recordBar.classList.toggle('is-done', fresh === 0 && unresolved === 0);

      if (unresolved > 0) {
        // Deliberately blocking: an unvetted company has no verdict, so it can
        // neither consume cap nor be contacted. Resolve it in step 2 first.
        recordTitle.textContent = 'Resolve ' + unresolved +
          (unresolved === 1 ? ' company' : ' companies') + ' first';
        recordMsg.textContent =
          unresolved + (unresolved === 1 ? ' company on this list is' : ' companies on this list are') +
          ' not on the database yet. Add ' + (unresolved === 1 ? 'it' : 'them') +
          ' in step 2 below with a status, then this list can be recorded.';
      } else if (fresh === 0) {
        recordTitle.textContent = 'Already recorded';
        recordMsg.textContent = listed === 0
          ? 'Nothing on this list to record.'
          : 'Every company on this list is already on ' + submission.event_name +
            ' (' + used + ' of ' + cap + ' counting towards the cap).';
      } else {
        const notCounting = fresh - freshCounting;
        recordTitle.textContent = 'Record this list as wave ' + ((submission.wave_count || 0) + 1);
        recordMsg.textContent =
          fresh + (fresh === 1 ? ' new company' : ' new companies') + ', of which ' +
          freshCounting + ' count' + (freshCounting === 1 ? 's' : '') + ' towards the cap' +
          (notCounting
            ? ' (' + notCounting + ' prohibited, closed or in cooldown, recorded but not counted)'
            : '') +
          '. That takes ' + submission.event_name + ' to ' + wouldBe + ' of ' + cap + '.';
      }

      if (capBanner) {
        capBanner.hidden = !over;
        if (over) {
          capBannerMsg.textContent =
            submission.event_name + ' is a ' + (SIZE_LABEL[submission.event_size] || submission.event_size).toLowerCase() +
            ' event, capped at ' + cap + ' approachable sponsors. It already has ' + used +
            ' and this list adds ' + freshCounting + ' more (' + wouldBe + ' in total). ' +
            'Trim the list by ' + (wouldBe - cap) +
            ', or change the event size on Home if the cap is wrong.';
        }
      }
    }

    function indexRecorded() {
      recordedNorms = new Set(recordedRows.map(function (r) { return r.normalised; }));
      recordedByNorm = new Map();
      recordedRows.forEach(function (r) { recordedByNorm.set(r.normalised, r); });
    }

    function loadRecorded() {
      const forId = submissionId;
      if (!forId) {
        recordedRows = [];
        indexRecorded();
        return Promise.resolve();
      }
      return window.AdminAPI.listSubmissionSponsors(forId).then(function (rows) {
        if (submissionId !== forId) return;   // the admin switched while this was in flight
        recordedRows = rows || [];
        indexRecorded();
      }, function (e) {
        toastError('Could not load what is already recorded', e);
      });
    }

    // The line item for an uploaded row, if this company is already on the
    // submission. Carries outreach_logged_at, which locks its tick box.
    function lineFor(r) {
      return recordedByNorm.get(window.Matcher.normalise(r.input)) || null;
    }

    // Step 1 is locked until a submission is chosen: every list vetted here
    // belongs to a club, so there is nothing sensible to do without one.
    function setUploadGate() {
      const open = !!submission;
      if (dropZone) dropZone.classList.toggle('is-locked', !open);
      if (fileInput) fileInput.disabled = !open;
      if (dropZoneTitle) {
        dropZoneTitle.textContent = open
          ? 'Drop a .csv list here'
          : 'Choose a submission to start';
      }
      if (dropZoneHint) {
        dropZoneHint.textContent = open
          ? 'or click to browse'
          : 'the picker is at the top of the page';
      }
      if (sampleLink) {
        sampleLink.classList.toggle('is-disabled', !open);
        sampleLink.setAttribute('aria-disabled', String(!open));
      }
    }

    // Re-read the parent row so the trigger-derived sponsor_count/wave_count
    // shown here match the database after a wave is recorded.
    function refreshSubmission() {
      if (!submissionId) return Promise.resolve();
      const forId = submissionId;
      return window.AdminAPI.getSubmission(forId).then(function (row) {
        if (!row || submissionId !== forId) return;
        submission = row;
        const i = submissionList.findIndex(function (s) { return s.id === forId; });
        if (i !== -1) submissionList[i] = row;
      }, function () {});
    }

    function applySubmission(id) {
      submissionId = id || null;
      submission = submissionId
        ? (submissionList.find(function (s) { return s.id === submissionId; }) || null)
        : null;

      if (submissionId && !submission) {
        // Linked from a stale tab, or the submission was deleted meanwhile.
        toastMsg({ type: 'warning', title: 'Submission not found',
                   message: 'That submission no longer exists. Pick one to carry on.' });
        submissionId = null;
      }

      recordedRows = [];
      indexRecorded();
      if (subSelect) subSelect.value = submissionId || '';
      syncUrl();
      setUploadGate();
      renderSubmissionCard();
      renderRecordBar();
      renderMatchedIfShown();

      return loadRecorded().then(function () {
        renderSubmissionCard();
        renderRecordBar();
        renderMatchedIfShown();
      });
    }

    // Panel A's tick boxes depend on what is recorded, so re-render them when
    // the submission changes under a list that is already on screen.
    function renderMatchedIfShown() {
      if (results.length) renderMatched();
    }

    if (subSelect) {
      subSelect.addEventListener('change', function () {
        applySubmission(subSelect.value || null);
      });
    }

    if (recordBtn) {
      recordBtn.addEventListener('click', async function () {
        if (!submission) return;
        const entries = waveEntries();
        if (!entries.length) return;

        const fresh = unrecordedCompanies().length;
        const counting = unrecordedCompanies()
          .filter(function (r) { return countsTowardCap(classify(r)); }).length;
        const wave = (submission.wave_count || 0) + 1;
        if (!confirm('Record ' + fresh + (fresh === 1 ? ' company' : ' companies') +
                     ' against "' + submission.event_name + '" as wave ' + wave + '?\n\n' +
                     counting + ' of them count towards the cap. The rest are kept on the ' +
                     'record but do not use it up.')) return;

        recordBtn.disabled = true;
        let res;
        try {
          res = await window.AdminAPI.recordSubmissionWave(submission.id, entries);
        } catch (e) {
          recordBtn.disabled = false;
          // The cap rejection is a deliberate, readable message from the RPC.
          toastError('Could not record this list', e);
          return;
        }

        await refreshSubmission();
        await loadRecorded();
        renderSubmissionCard();
        renderRecordBar();
        renderMatchedIfShown();   // recorded companies can now be ticked for outreach

        res = res || {};
        const added = res.added || 0;
        let msg = 'Wave ' + (res.wave || wave) + ': ' + added +
                  (added === 1 ? ' company' : ' companies') + ' recorded.';
        if (res.refreshed) msg += ' ' + res.refreshed + ' updated.';
        if (res.skipped) msg += ' ' + res.skipped + ' already on the list.';
        msg += ' ' + submission.event_name + ' is at ' + (res.counted || 0) +
               ' of ' + (res.cap || submissionCap()) + ' towards the cap';
        msg += (res.listed && res.listed !== res.counted)
          ? ' (' + res.listed + ' listed in all).'
          : '.';
        toastMsg({ type: 'success', title: 'Recorded to submission', message: msg });
      });
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
        if (submissionRequired()) return;
        parseAndCheck(SAMPLE_TEXT);
      });
    }

    // Refuse anything that arrives before a submission is chosen (a drop lands
    // on the zone regardless of the disabled input, so guard here too).
    function submissionRequired() {
      if (submission) return false;
      toastMsg({ type: 'error', title: 'Choose a submission first',
                 message: 'Every list vetted here is counted against a club submission. Pick one at the top of the page.' });
      if (subSelect) subSelect.focus();
      return true;
    }

    function handleFile(file) {
      if (submissionRequired()) return;
      if (!/\.csv$/i.test(file.name)) {
        toastMsg({ type: 'error', title: 'Wrong file type', message: 'Only .csv is accepted. Save your Excel file as CSV first.' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toastMsg({ type: 'error', title: 'File too large', message: 'Maximum upload size is 5 MB.' });
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
          toastMsg({ type: 'error', title: 'Could not parse file', message: (err && err.message) || 'Check the file format and try again.' });
          uploadStatus.innerHTML = '';
        }
      };
      reader.onerror = function () {
        toastMsg({ type: 'error', title: 'Read failed', message: 'Could not read the file.' });
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
      // Matching is synchronous, but wait for the live sponsor data to load first.
      readyPromise.then(function () {
        if (loadError) {
          setCheckState('upload');
          toastMsg({ type: 'error', title: 'Database not loaded', message: 'Could not load the sponsor list. Refresh and try again.' });
          return;
        }
        results = window.Matcher.checkBatch(rows, matchCtx());
        renderCheck();
        setCheckState('results');
        checkResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Re-run the vet on the same rows against the (now-refreshed) live data.
    function revet() {
      if (!parsedRows.length) return;
      results = window.Matcher.checkBatch(parsedRows, matchCtx());
      renderCheck();
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
    function reviewCompanies() {
      const staged = new Set(stagingRows.map(function (r) {
        return window.Matcher.normalise(r.name);
      }).filter(Boolean));
      return results.filter(function (r) {
        return classify(r) === 'review' && !staged.has(window.Matcher.normalise(r.input));
      });
    }

    function renderCheck() {
      const counts = { approved: 0, cooldown: 0, prohibited: 0, closed: 0, alumni: 0, review: 0, duplicate: 0 };
      results.forEach(function (r) { counts[classify(r)]++; });
      counts.review = reviewCompanies().length;

      const total = results.length;
      resultsHead.textContent = 'Checked ' + total + (total === 1 ? ' company' : ' companies') + ' against the database.';

      summaryEl.innerHTML =
        statTile('approved', counts.approved, 'Approved') +
        statTile('cooldown', counts.cooldown, 'Cooldown') +
        statTile('prohibited',   counts.prohibited,   'Prohibited') +
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
      renderRecordBar();
    }

    function statTile(mod, value, label) {
      return '<div class="bulk-stat bulk-stat--' + mod + '">' +
        '<div class="bulk-stat__value">' + value + '</div>' +
        '<div class="bulk-stat__label">' + label + '</div>' +
      '</div>';
    }

    // Panel A — companies found in the database, most-severe first.
    const SEVERITY = { prohibited: 0, cooldown: 1, closed: 2, alumni: 3, approved: 4 };
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

      let eligible = 0, approachableTotal = 0, lockedTotal = 0, loggedTotal = 0;
      matchedTbody.innerHTML = rows.map(function (r) {
        const bucket = classify(r);
        const idx = results.indexOf(r) + 1;         // original row number in the file
        const flaggedCls = (bucket === 'prohibited' || bucket === 'closed' || bucket === 'cooldown') ? 'is-flagged' : '';
        const industryLabel = r.industry ? industryDisplay(r.industry) : '';
        // Outreach is scoped to the submission: a company must be recorded on
        // it, and can only be logged once for that event.
        const line = lineFor(r);
        const approachable = bucket === 'approved' && r.matchedId;
        const canLog = approachable && line && !line.outreach_logged_at;
        if (approachable) approachableTotal++;
        if (canLog) eligible++;
        else if (approachable && line) loggedTotal++;
        else if (approachable) lockedTotal++;

        let checkCell = '';
        if (canLog) {
          checkCell = '<input type="checkbox" class="vet-log-check bulk-staging__check" data-id="' +
            esc(r.matchedId) + '" aria-label="Select for outreach">';
        } else if (approachable && line && line.outreach_logged_at) {
          checkCell = '<span class="vet-logged" title="Outreach already logged for this event on ' +
            esc(formatDateShort(new Date(line.outreach_logged_at))) + '">' +
            '<i class="bi bi-check-circle-fill"></i></span>';
        } else if (approachable && !line) {
          checkCell = '<span class="vet-locked" title="Record this list against the submission first">' +
            '<i class="bi bi-lock-fill"></i></span>';
        }
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

      matchedFoot.style.display = approachableTotal ? '' : 'none';
      if (matchedFootNote) {
        if (lockedTotal) {
          matchedFootNote.textContent =
            lockedTotal + (lockedTotal === 1 ? ' approved company is' : ' approved companies are') +
            ' not on this submission yet. Record the list above first, then log outreach.';
        } else if (!eligible && loggedTotal) {
          matchedFootNote.textContent =
            'Outreach is already logged for every approved company on this list. ' +
            'A company can only be logged once per event.';
        } else {
          matchedFootNote.textContent =
            'Logging adds 1 to each ticked company’s outreach count. Companies that reach the cap ' +
            'move into cooldown.' +
            (loggedTotal ? ' ' + loggedTotal + ' already logged for this event.' : '');
        }
      }
      if (logAll) logAll.checked = false;
      updateLogCount();
    }

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
        prohibited:   { cls: 'pill--prohibited',  icon: 'bi-x-circle-fill',     label: 'Prohibited' },
        closed:   { cls: 'pill--neutral',  icon: 'bi-slash-circle-fill',  label: 'Closed' },
        alumni:   { cls: 'pill--alumni',   icon: 'bi-mortarboard-fill',   label: 'Alumni' }
      };
      const m = map[bucket] || map.approved;
      return '<span class="pill ' + m.cls + '"><i class="bi ' + m.icon + ' pill__icon"></i>' + m.label + '</span>';
    }

    function matchCell(r) {
      const name = r.matchedName || r.matched || '';
      if (!name) return '<span class="text-muted text-xs">-</span>';
      const approx = (r.matchType === 'fuzzy')
        ? ' <span class="vet-approx" title="Approximate match, please verify">approx. ' + (r.matchScore || '') + '%</span>'
        : '';
      return '<span class="table__cell-primary">' + esc(name) + '</span>' + approx;
    }

    function outreachCell(r) {
      if (r.matchedCategory !== 'approved' || !r.matchedId) {
        return '<span class="text-muted text-xs">n/a</span>';
      }
      const st = capState(r.matchedId);
      let cls = 'vet-cap';
      if (st.inCooldown) cls += ' vet-cap--over';
      else if (st.approaching) cls += ' vet-cap--near';
      let html = '<span class="' + cls + '">' + st.count + ' / ' + st.cap + '</span>';
      if (st.inCooldown && st.cooldownEndsAt) {
        html += '<span class="vet-cap__note">until ' + esc(formatDateShort(st.cooldownEndsAt)) + '</span>';
      }
      return html;
    }

    function formatDateShort(d) {
      if (!d) return '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

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
      const labels = { approved: 'Approved', prohibited: 'Prohibited', closed: 'Closed', alumni: 'Alumni' };
      return '<span class="status-pill status-pill--' + cat + '">' + (labels[cat] || cat) + '</span>';
    }

    // ---- outreach logging (Panel A) ----
    function updateLogCount() {
      if (!logBtn || !logCountEl) return;
      const n = matchedTbody.querySelectorAll('.vet-log-check:checked').length;
      logCountEl.textContent = n;
      logBtn.disabled = n === 0;
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
          if (staged.has(norm)) return;
          staged.add(norm);
          stagingRows.push(makeRow({ name: r.input, industry: r.industry || 'other' }));
          added++;
        });
        renderStaging();
        renderReview();
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
      logBtn.addEventListener('click', async function () {
        const boxes = Array.prototype.slice.call(matchedTbody.querySelectorAll('.vet-log-check:checked'));
        if (boxes.length === 0) return;
        const label = boxes.length === 1 ? '1 company' : boxes.length + ' companies';
        if (!confirm('Log an outreach for ' + label + '? This adds 1 to each running count and cannot be undone here.')) return;

        logBtn.disabled = true;
        let logged = 0, capped = 0, skipped = 0, duplicate = 0, notRecorded = 0, failed = 0;
        for (const b of boxes) {
          let res;
          try {
            res = await window.AdminAPI.logOutreach(b.getAttribute('data-id'), null, submissionId);
          } catch (e) {
            failed++;
            continue;
          }
          if (res === 'logged') logged++;
          else if (res === 'capped') { logged++; capped++; }
          else if (res === 'skipped') skipped++;
          else if (res === 'duplicate') duplicate++;
          else if (res === 'not_recorded') notRecorded++;
        }

        // Reload the line items so the newly-logged companies show as locked.
        await Promise.all([refreshOutreach(), loadRecorded()]);
        revet();  // refresh status, remarks, outreach and panels consistently

        if (window.toast) {
          let msg = 'Added 1 outreach to ' + (logged === 1 ? '1 company' : logged + ' companies') + '.';
          if (capped) msg += ' ' + (capped === 1 ? '1 reached its cap and is now in cooldown.' : capped + ' reached their cap and are now in cooldown.');
          if (skipped) msg += ' ' + skipped + ' skipped (already in cooldown).';
          if (duplicate) msg += ' ' + duplicate + ' skipped (already logged for this event).';
          if (notRecorded) msg += ' ' + notRecorded + ' skipped (not recorded against this submission yet).';
          if (failed) msg += ' ' + failed + ' failed.';
          window.toast({
            type: (failed || notRecorded) ? 'warning' : 'success',
            title: 'Outreach logged', message: msg
          });
        }
      });
    }

    // ============================================================
    // STEP 2 — staging table (bulk add)
    // ============================================================

    function makeRow(seed) {
      seed = seed || {};
      const category = seed.category || 'approved';
      return {
        uid: 'r' + (uidSeq++),
        name: seed.name || '',
        category: category,
        industry: seed.industry || 'other',
        detail: seed.detail || '',
        include: true
      };
    }

    function industryOptions(selected) {
      return industries.map(function (ind) {
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
      const ind = industries.find(function (i) { return i.code === code; });
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

    stagingTbody.addEventListener('input', function (e) {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const row = rowByUid(tr.getAttribute('data-uid'));
      if (!row) return;
      const field = e.target.getAttribute('data-field');
      if (field === 'name')   row.name = e.target.value;
      if (field === 'detail') row.detail = e.target.value;
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
      renderReview();
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
        });
        updateStagingCount();
      });
    }

    if (addRowBtn) {
      addRowBtn.addEventListener('click', function () {
        stagingRows.push(makeRow());
        renderStaging();
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
        renderReview();
      });
    }

    // ---- commit: validate, dedupe, bulk-insert, log first outreach ----
    if (saveBtn) {
      saveBtn.addEventListener('click', commitStaging);
    }

    async function commitStaging() {
      const included = stagingRows.filter(function (r) { return r.include; });
      if (included.length === 0) return;

      // 1. Validate.
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
          firstError = firstError || { el: detailInput, msg: (row.name.trim() || 'A row') + ' needs a prohibited reason.' };
        }
      });
      if (firstError) {
        toastMsg({ type: 'error', title: 'Check the highlighted rows', message: firstError.msg });
        if (firstError.el) firstError.el.focus();
        return;
      }

      // 2. Dedupe within the batch and against the loaded sponsors, by normalised name.
      const existing = new Set(sponsors.map(function (s) {
        return s.normalised || window.Matcher.normalise(s.name);
      }));
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
          ban_reason: null
        };
        if (row.category === 'approved' || row.category === 'alumni') payload.notes = row.detail.trim();
        else if (row.category === 'closed') payload.notes = row.detail.trim();
        else if (row.category === 'prohibited') payload.ban_reason = row.detail.trim();
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

      // 4. Refresh the local snapshot so the re-vet below sees the new rows.
      //    No outreach is logged here on purpose: a contact belongs to an event,
      //    so it is logged in step 1 against a recorded submission. Logging it at
      //    add time would bypass the once-per-event lock and double-count.
      await refreshSponsors();

      // 5. Remove the committed rows; keep only unticked ones.
      stagingRows = stagingRows.filter(function (r) { return !r.include; });
      renderStaging();
      saveBtn.disabled = false;

      const totalSkipped = skipped.length + dbSkipped;
      const parts = ['Added ' + added + (added === 1 ? ' sponsor' : ' sponsors') + '.'];
      if (totalSkipped) parts.push(totalSkipped + ' skipped (already in the database).');
      if (submission) parts.push('Record the list against the submission to count them.');
      toastMsg({ type: 'success', title: 'Database updated', message: parts.join(' ') });

      // Re-vet so anything just added moves up into "Found in the database".
      revet();
    }

    // ---------- boot ----------
    setCheckState('upload');
    setUploadGate();                   // locked until a submission is chosen
    renderStaging();
    readyPromise = loadData().then(function () {
      if (loadError) return;           // nothing loaded, so nothing to attach to
      fillSubmissionOptions();
      return applySubmission(submissionIdFromUrl());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
