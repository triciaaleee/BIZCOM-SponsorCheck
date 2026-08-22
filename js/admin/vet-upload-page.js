/* ============================================================
   js/admin/vet-upload-page.js
   Admin "Vet & Upload" page.

   Two screens.

     A. Browse club submissions as cards, by year and then by month.
        Year is the primary control because the tracker outlives any
        one committee; the stepper mirrors the one on Home. Completed
        and All band the cards by the month the club submitted;
        Active stays a flat queue ordered by due date.

     B. One submission: its cap meter, the WAVE HISTORY (every list
        the club has sent and which companies were approached in it),
        then steps 1 and 2. Reached by clicking a card or by
        ?submission=<id> from the "Vet a list" action on Home.
        Step 2's table is shared with the Sponsors page, which is
        where sponsors are added outside a club list.

   Every list vetted here belongs to a club submission, so step 1
   only exists on screen B.

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
       which is how a lapsed cooldown, a newly-added company or a
       confirmed match starts counting. A company that has been
       contacted is frozen and stops being refreshed.
     * submissions.sponsor_count is re-derived by a trigger — this
       page is the only thing that moves it (migrations 0012, 0013).

   Order of work:

     1. pick the submission
     2. upload and vet
     3. record the list as a wave — this is NOT gated on the list being
        fully vetted. An unknown company is recorded at zero and starts
        counting once it is resolved and the list is recorded again.
     4. resolve the unknowns, in whichever order suits: add them in step
        2, or confirm a possible match with "Same company" (adding a
        company that already exists under another name would duplicate
        it, so confirming is the only correct move there)
     5. log outreach — one action covering every approved company on
        the wave. No per-row selection, so nothing can be left behind
        and then locked out. Each company it covers is closed for this
        event afterwards. If a company on that wave only becomes
        approachable later (it was unvetted, or in cooldown), it gets
        its own action then; the ones already contacted stay locked,
        so a company is never contacted twice for one event.

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
    if (!window.sb || !window.AdminAPI || !window.Matcher || !window.StagingTable) {
      requestAnimationFrame(init);
      return;
    }

    const session = window.AdminShell.mount({
      currentPage: 'vet-upload.html',
      pageTitle: 'Vetting & bulk upload'
    });
    if (!session) return; // redirected away by the auth guard

    const esc = window.AdminShell.escapeHtml;
    const mapsLink = window.AdminShell.mapsLink;

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
    const logBtn        = document.getElementById('log-outreach-btn');
    const logCountEl    = document.getElementById('log-count');
    const reviewTbody   = document.getElementById('review-tbody');
    const reviewEmpty   = document.getElementById('review-empty');
    const reviewFoot    = document.getElementById('review-foot');
    const reviewAll     = document.getElementById('review-all');
    const reviewSelText = document.getElementById('review-sel-text');
    const sendToStaging = document.getElementById('send-to-staging');

    // Screen A — browsing club submissions.
    const browseEl      = document.getElementById('vet-browse');
    const browseResults = document.getElementById('browse-results');
    const yearPrev      = document.getElementById('year-prev');
    const yearNext      = document.getElementById('year-next');
    const yearLabel     = document.getElementById('year-label');
    const yearCount     = document.getElementById('year-count');
    const tabsEl        = document.getElementById('vet-tabs');

    // Screen B — one submission (or step 2 on its own).
    const detailEl      = document.getElementById('vet-detail');
    const backBtn       = document.getElementById('vet-back');
    const sectionVet    = document.getElementById('section-vet');
    const sectionWaves  = document.getElementById('section-waves');
    const wavesList     = document.getElementById('waves-list');
    const wavesEmpty    = document.getElementById('waves-empty');

    const subCard       = document.getElementById('vet-sub');
    const subEventEl    = document.getElementById('vet-sub-event');
    const subClubEl     = document.getElementById('vet-sub-club');
    const subStatusEl   = document.getElementById('vet-sub-status');
    const subCountEl    = document.getElementById('vet-sub-count');
    const subWavesEl    = document.getElementById('vet-sub-waves');
    const subBar        = document.getElementById('vet-sub-bar');
    const actionsBar    = document.getElementById('vet-actions');
    const actionsTrack  = document.getElementById('vet-next-track');
    const actionsTitle  = document.getElementById('vet-next-title');
    const actionsMsg    = document.getElementById('vet-next-msg');
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
    let screen = 'browse';             // 'browse' | 'detail'
    let browseYear = new Date().getFullYear();
    let browseTab = 'active';          // 'active' | 'completed' | 'all'
    let lastAppliedId = undefined;     // guards the results reset on a real change
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

    // ---------- manual "same company" links ----------
    // The matcher's fuzzy pass is deliberately cautious: a near-miss below the
    // threshold lands in panel B as a *possible* match rather than a match, so a
    // company already on record under another name is not silently mis-filed.
    // Confirming one is a human judgement, and it must NOT be resolved by adding
    // the company again — that creates the very duplicate panel B exists to catch.
    //
    // A confirmed link is stored as the line item's sponsor_id when the wave is
    // recorded, so the database is the persistent home for it; linkedByNorm is
    // rebuilt from those rows on load. Before recording it lives here only, and
    // can be undone.
    let linkedByNorm = new Map();   // normalised(input) -> sponsor row

    // Fold confirmed links into the matcher's output so everything downstream —
    // classify, the panels, the cap count, the wave payload — sees a normal match.
    function applyLinks(rows) {
      rows.forEach(function (r) {
        if (r.status === 'duplicate' || r.matchedId) return;
        const s = linkedByNorm.get(window.Matcher.normalise(r.input));
        if (!s) return;
        r.matchedId = s.id;
        r.matchedName = s.name;
        r.matchedCategory = s.category;
        r.matchType = 'linked';
        r.matchScore = null;
        r.reason = 'Confirmed by an admin as the same company as ' + s.name + '.';
        if (s.industry) r.industry = s.industry;
      });
      return rows;
    }

    function linkSuggestion(ri) {
      const r = results[ri];
      if (!r || !r.suggestion) return;
      const s = sponsors.find(function (x) { return x.id === r.suggestion.id; });
      if (!s) return;
      linkedByNorm.set(window.Matcher.normalise(r.input), s);
      applyLinks(results);
      renderCheck();
      toastMsg({ type: 'success', title: 'Linked',
                 message: '“' + r.input + '” is recorded as ' + s.name + '.' });
    }

    function unlink(ri) {
      const r = results[ri];
      if (!r) return;
      linkedByNorm.delete(window.Matcher.normalise(r.input));
      revet();   // rebuild from the matcher so the row falls back to unmatched
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

    // ---------- screen switching ----------
    function showScreen(which) {
      screen = which;
      browseEl.hidden = which !== 'browse';
      detailEl.hidden = which === 'browse';
      if (subCard) subCard.hidden = which !== 'detail';
      if (sectionWaves) sectionWaves.hidden = which !== 'detail';
      if (sectionVet) sectionVet.hidden = which !== 'detail';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showBrowse() {
      applySubmission(null);
      showScreen('browse');
      renderBrowse();
    }

    // ---------- browse: year, then month ----------
    const MONTHS_LONG = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];

    function isActive(s) { return s.status !== 'completed'; }
    function submissionYear(s) { return new Date(s.submitted_at).getFullYear(); }
    function submissionMonth(s) { return new Date(s.submitted_at).getMonth(); }

    function daysUntil(iso) {
      const target = new Date(iso); target.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return Math.round((target.getTime() - today.getTime()) / 86400000);
    }

    // Mirrors the due chip on Home so the same submission reads the same on both.
    function dueFlagHtml(s) {
      if (s.status === 'completed') return '';
      if (!s.complete_by) return '<span class="vet-flag">No due date</span>';
      const n = daysUntil(s.complete_by);
      if (n < 0)   return '<span class="vet-flag vet-flag--due">Overdue ' + Math.abs(n) + 'd</span>';
      if (n === 0) return '<span class="vet-flag vet-flag--due">Due today</span>';
      if (n <= 3)  return '<span class="vet-flag vet-flag--due">Due in ' + n + 'd</span>';
      return '<span class="vet-flag">Due ' + esc(formatDateShort(new Date(s.complete_by))) + '</span>';
    }

    function statusPillHtml(status) {
      const label = { new: 'New', reviewing: 'Reviewing', completed: 'Completed' }[status] || status;
      return '<span class="sub-status sub-status--' + esc(status) + '">' + label + '</span>';
    }

    function submissionCardHtml(s) {
      const cap = capForSize(s.event_size);
      const used = s.sponsor_count || 0;
      const listed = s.listed_count || 0;
      const waves = s.wave_count || 0;
      const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

      let barCls = 'sub-cap__bar';
      if (cap > 0 && used >= cap) barCls += ' sub-cap__bar--full';
      else if (cap > 0 && pct >= 80) barCls += ' sub-cap__bar--near';

      return (
        '<button type="button" class="sub-card sub-card--' + esc(s.status) + '" data-open="' + esc(s.id) + '">' +
          '<div class="sub-card__top">' +
            '<div>' +
              '<div class="sub-card__event">' + esc(s.event_name) + '</div>' +
              '<div class="sub-card__club">' + esc(s.club) + '</div>' +
            '</div>' +
            statusPillHtml(s.status) +
          '</div>' +
          '<div class="sub-card__cap">' +
            '<div class="sub-card__figures">' +
              '<span class="sub-card__count">' + used.toLocaleString() +
                ' <small>/ ' + cap.toLocaleString() + '</small></span>' +
              '<span class="sub-card__listed">' +
                (listed ? listed.toLocaleString() + ' listed' : 'nothing recorded') + '</span>' +
            '</div>' +
            '<div class="sub-cap__meter"><span class="' + barCls + '" style="width:' + pct + '%"></span></div>' +
          '</div>' +
          '<div class="sub-card__meta">' +
            '<span>' + (waves ? '<b>' + waves + '</b> ' + (waves === 1 ? 'wave' : 'waves') : 'No waves yet') + '</span>' +
            '<span>' + esc(SIZE_LABEL[s.event_size] || s.event_size) + ' event</span>' +
            dueFlagHtml(s) +
          '</div>' +
        '</button>'
      );
    }

    function gridHtml(rows) {
      return '<div class="sub-grid">' + rows.map(submissionCardHtml).join('') + '</div>';
    }

    function renderBrowse() {
      const ofYear = submissionList.filter(function (s) { return submissionYear(s) === browseYear; });

      yearLabel.textContent = browseYear;
      yearCount.textContent = ofYear.length
        ? ofYear.length + (ofYear.length === 1 ? ' submission' : ' submissions')
        : 'nothing yet';

      const activeCount = ofYear.filter(isActive).length;
      document.getElementById('tab-count-active').textContent = activeCount;
      document.getElementById('tab-count-completed').textContent = ofYear.length - activeCount;
      document.getElementById('tab-count-all').textContent = ofYear.length;

      let rows = ofYear.filter(function (s) {
        if (browseTab === 'active') return isActive(s);
        if (browseTab === 'completed') return !isActive(s);
        return true;
      });

      if (!rows.length) {
        browseResults.innerHTML =
          '<div class="sub-empty"><b>Nothing yet</b>No ' +
          (browseTab === 'all' ? '' : browseTab + ' ') + 'submissions in ' + browseYear + '.</div>';
        return;
      }

      if (browseTab === 'active') {
        // A working queue, so it is ordered by what is due rather than banded
        // by month. Submissions with no due date sink to the bottom.
        rows.sort(function (a, b) {
          if (!a.complete_by && !b.complete_by) return 0;
          if (!a.complete_by) return 1;
          if (!b.complete_by) return -1;
          return new Date(a.complete_by) - new Date(b.complete_by);
        });
        browseResults.innerHTML = gridHtml(rows);
        return;
      }

      // Archive views band by the month the club submitted, newest first.
      const byMonth = new Map();
      rows.forEach(function (s) {
        const m = submissionMonth(s);
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push(s);
      });

      browseResults.innerHTML = Array.from(byMonth.keys())
        .sort(function (a, b) { return b - a; })
        .map(function (m) {
          const inMonth = byMonth.get(m);
          return (
            '<section class="sub-month">' +
              '<div class="sub-month__head">' +
                '<h3 class="sub-month__name">' + MONTHS_LONG[m] + ' ' + browseYear + '</h3>' +
                '<span class="sub-month__count">' + inMonth.length +
                  (inMonth.length === 1 ? ' submission' : ' submissions') + '</span>' +
              '</div>' +
              gridHtml(inMonth) +
            '</section>'
          );
        }).join('');
    }

    if (browseResults) {
      browseResults.addEventListener('click', function (e) {
        const card = e.target.closest('[data-open]');
        if (card) openSubmission(card.getAttribute('data-open'));
      });
    }

    if (yearPrev) yearPrev.addEventListener('click', function () { browseYear--; renderBrowse(); });
    if (yearNext) yearNext.addEventListener('click', function () { browseYear++; renderBrowse(); });

    if (tabsEl) {
      tabsEl.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        browseTab = btn.getAttribute('data-tab');
        tabsEl.querySelectorAll('[data-tab]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        renderBrowse();
      });
    }

    if (backBtn) backBtn.addEventListener('click', showBrowse);

    // Open one submission: attach it, switch screens, then load its line items.
    function openSubmission(id) {
      showScreen('detail');
      return applySubmission(id);
    }

    function renderSubmissionCard() {

      if (!submission) return;

      const cap = submissionCap();
      const used = submission.sponsor_count || 0;
      const waves = submission.wave_count || 0;
      const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

      subEventEl.textContent = submission.event_name;
      subClubEl.textContent = submission.club;
      subStatusEl.innerHTML = statusPillHtml(submission.status);

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

    // ---------- wave history ----------
    // Reads the line items already loaded for the outreach lock, so opening a
    // submission costs no extra query. Nothing here is new data: wave,
    // recorded_at and outreach_logged_at have been on submission_sponsors
    // since 0012/0013.
    function sponsorName(id) {
      if (!id) return null;
      const hit = sponsors.find(function (x) { return x.id === id; });
      return hit ? hit.name : null;
    }

    // Whether OUR outreach log has an entry for this company on this event.
    // Deliberately not phrased as "contacted": the stamp records that an admin
    // logged an approach, which is not the same claim as the club having
    // actually reached the company.
    function contactedCell(row) {
      if (row.outreach_logged_at) {
        return '<span class="wave-contacted">Logged ' +
          esc(formatDateShort(new Date(row.outreach_logged_at))) + '</span>';
      }
      if (row.status === 'prohibited' || row.status === 'closed') {
        return '<span class="wave-nope">Cannot be approached</span>';
      }
      if (row.status === 'cooldown') return '<span class="wave-nope">In cooldown</span>';
      if (row.status === 'review')   return '<span class="wave-nope">Not vetted yet</span>';
      return '<span class="wave-nope">Not logged</span>';
    }

    function waveRowHtml(row) {
      const matched = sponsorName(row.sponsor_id);
      const counts = window.AdminAPI.countsTowardCap(row.status);
      return (
        '<tr>' +
          '<td data-label="Company"><div class="table__cell-primary">' + mapsLink(row.company_name) + '</div></td>' +
          '<td data-label="Matched record">' +
            (matched ? esc(matched) : '<span class="text-muted text-xs">-</span>') + '</td>' +
          '<td data-label="Status">' + statusTagHtml(row.status) + '</td>' +
          '<td data-label="Counts">' + (counts ? 'Yes' : 'No') + '</td>' +
          '<td data-label="Outreach">' + contactedCell(row) + '</td>' +
          '<td data-label="Logged by" class="text-secondary text-xs">' +
            esc(row.outreach_logged_by || '—') + '</td>' +
        '</tr>'
      );
    }

    function statusTagHtml(status) {
      const labels = {
        approved: 'Approved', alumni: 'Alumni', prohibited: 'Prohibited',
        closed: 'Closed', cooldown: 'Cooldown', review: 'Unvetted'
      };
      const cls = labels[status] ? status : 'review';
      return '<span class="wave-tag wave-tag--' + esc(cls) + '">' +
        esc(labels[status] || status || 'Unvetted') + '</span>';
    }

    function renderWaves() {
      if (!wavesList) return;

      if (!submission || !recordedRows.length) {
        wavesList.innerHTML = '';
        if (wavesEmpty) wavesEmpty.hidden = false;
        return;
      }
      if (wavesEmpty) wavesEmpty.hidden = true;

      const byWave = new Map();
      recordedRows.forEach(function (r) {
        const w = r.wave || 1;
        if (!byWave.has(w)) byWave.set(w, []);
        byWave.get(w).push(r);
      });

      wavesList.innerHTML = Array.from(byWave.keys())
        .sort(function (a, b) { return b - a; })          // newest wave first
        .map(function (w) {
          const rows = byWave.get(w);
          const counted = rows.filter(function (r) { return window.AdminAPI.countsTowardCap(r.status); }).length;
          const unvetted = rows.filter(function (r) { return r.status === 'review'; }).length;
          const contacted = rows.filter(function (r) { return !!r.outreach_logged_at; });

          // A wave has no row of its own, so its dates come from its companies.
          let first = null, lastContact = null;
          rows.forEach(function (r) {
            const d = new Date(r.recorded_at);
            if (!first || d < first) first = d;
            if (r.outreach_logged_at) {
              const c = new Date(r.outreach_logged_at);
              if (!lastContact || c > lastContact) lastContact = c;
            }
          });

          const open = w === Math.max.apply(null, Array.from(byWave.keys()));
          return (
            '<div class="wave' + (open ? ' is-open' : '') + '" data-wave="' + w + '">' +
              '<button type="button" class="wave__head">' +
                '<span class="wave__no">Wave ' + w + '</span>' +
                '<span class="wave__date">' + esc(first ? formatDateShort(first) : '') + '</span>' +
                '<span class="wave__stats">' +
                  '<span><b>' + rows.length + '</b> ' + (rows.length === 1 ? 'company' : 'companies') + '</span>' +
                  '<span><b>' + counted + '</b> count</span>' +
                  (unvetted ? '<span class="vet-flag vet-flag--todo">' + unvetted + ' unvetted</span>' : '') +
                  (contacted.length
                    ? '<span class="vet-flag vet-flag--done">' + contacted.length + ' outreach logged' +
                      (lastContact ? ' ' + esc(formatDateShort(lastContact)) : '') + '</span>'
                    : '<span class="vet-flag">No outreach logged</span>') +
                '</span>' +
                '<i class="bi bi-chevron-right wave__chev"></i>' +
              '</button>' +
              '<div class="wave__body">' +
                '<div class="table-wrapper table-wrapper--responsive">' +
                  '<table class="table">' +
                    '<thead><tr>' +
                      '<th>Company</th><th>Matched record</th><th>Status</th>' +
                      '<th>Counts</th><th>Outreach</th><th>Logged by</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rows.map(waveRowHtml).join('') + '</tbody>' +
                  '</table>' +
                '</div>' +
              '</div>' +
            '</div>'
          );
        }).join('');
    }

    if (wavesList) {
      wavesList.addEventListener('click', function (e) {
        const head = e.target.closest('.wave__head');
        if (head) head.parentNode.classList.toggle('is-open');
      });
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

    // Companies with no verdict yet. These do NOT block recording: the
    // submission should say what the club actually sent, on the day they sent
    // it, and vetting is work that happens afterwards. They are stored with
    // status 'review' and count zero towards the cap until someone resolves
    // them, either by adding them in step 2 or by confirming a possible match.
    //
    // Forcing them to be resolved first was a dead end: a company with a
    // possible match cannot be "resolved" by adding it, because that creates
    // the duplicate panel B exists to prevent.
    function unresolvedCompanies() {
      return listedCompanies().filter(function (r) { return classify(r) === 'review'; });
    }

    // Companies already on the submission whose verdict has moved since they
    // were recorded: an unknown that has since been added or linked, or a
    // cooldown that has lapsed. Re-recording refreshes them, which is how they
    // start counting. Contacted companies are frozen and never appear here.
    function refreshableCompanies() {
      return listedCompanies().filter(function (r) {
        const line = lineFor(r);
        return !!line && !line.outreach_logged_at && line.status !== classify(r);
      });
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

    // How the approved companies on this list stand for outreach.
    function outreachTotals() {
      let approachable = 0, loggable = 0, locked = 0, logged = 0;
      results.forEach(function (r) {
        if (classify(r) !== 'approved' || !r.matchedId) return;
        approachable++;
        const line = lineFor(r);
        if (!line) locked++;
        else if (line.outreach_logged_at) logged++;
        else loggable++;
      });
      return { approachable: approachable, loggable: loggable, locked: locked, logged: logged };
    }

    // ---------- the next action ----------
    // Recording and logging outreach are two writes that must happen in order,
    // and the admin only ever has one of them to do. Showing both at once (or
    // parking them in a separate section below the results) made the page read
    // as a pile of controls, so this renders whichever step is current and
    // nothing else. The bar is sticky, so the action stays in reach while the
    // two result panels are read.
    function renderActions() {
      if (!actionsBar) return;

      if (!submission || !results.length) {
        actionsBar.hidden = true;
        if (capBanner) capBanner.hidden = true;
        return;
      }
      actionsBar.hidden = false;

      const listed = listedCompanies().length;
      const fresh = unrecordedCompanies().length;
      const unresolved = unresolvedCompanies().length;
      const refreshable = refreshableCompanies().length;
      const cap = submissionCap();
      const used = submission.sponsor_count || 0;
      const out = outreachTotals();

      // Only the approachable ones move the cap: the new companies that count,
      // plus any already-recorded row whose verdict has since become countable.
      const freshCounting = unrecordedCompanies()
        .filter(function (r) { return countsTowardCap(classify(r)); }).length;
      const newlyCounting = refreshableCompanies().filter(function (r) {
        const line = lineFor(r);
        return countsTowardCap(classify(r)) && !countsTowardCap(line.status);
      }).length;
      const wouldBe = used + freshCounting + newlyCounting;
      const over = cap > 0 && wouldBe > cap;

      // Unresolved companies are recorded at zero, so they never block.
      const recordDone = fresh === 0 && refreshable === 0;

      // Over cap keeps the button visible but disabled, so the banner below has
      // something to point at.
      recordBtn.hidden = recordDone;
      recordBtn.disabled = over;
      recordCountEl.textContent = fresh || refreshable;

      logBtn.hidden = recordDone ? out.loggable === 0 : true;
      logBtn.disabled = false;
      if (logCountEl) logCountEl.textContent = out.loggable;

      const pending = unresolved
        ? ' ' + unresolved + (unresolved === 1 ? ' company is' : ' companies are') +
          ' still unvetted, recorded at zero until you add ' +
          (unresolved === 1 ? 'it' : 'them') + ' in step 2 or confirm a possible match.'
        : '';

      let step;   // 1 = record, 2 = outreach, 3 = both finished

      if (!recordDone) {
        step = 1;
        if (fresh === 0) {
          // Nothing new, but verdicts have moved since these were recorded.
          actionsTitle.textContent = 'Update ' + refreshable +
            (refreshable === 1 ? ' company' : ' companies');
          actionsMsg.textContent =
            refreshable + (refreshable === 1 ? ' company on this list has' : ' companies on this list have') +
            ' a new verdict since ' + (refreshable === 1 ? 'it was' : 'they were') + ' recorded' +
            (newlyCounting ? ', ' + newlyCounting + ' of which now count towards the cap' : '') +
            '. Record again to update ' + submission.event_name + ' to ' + wouldBe +
            ' of ' + cap + '.' + pending;
        } else {
          const notCounting = fresh - freshCounting;
          actionsTitle.textContent = 'Record this list as wave ' + ((submission.wave_count || 0) + 1);
          actionsMsg.textContent =
            fresh + (fresh === 1 ? ' new company' : ' new companies') + ', of which ' +
            freshCounting + ' count' + (freshCounting === 1 ? 's' : '') + ' towards the cap' +
            (notCounting
              ? ' (' + notCounting + ' prohibited, closed, in cooldown or unvetted, recorded but not counted)'
              : '') +
            (refreshable ? ', plus ' + refreshable + ' updated' : '') +
            '. That takes ' + submission.event_name + ' to ' + wouldBe + ' of ' + cap + '.' + pending;
        }
      } else if (out.loggable > 0) {
        step = 2;
        const waves = waveLabel(openWaves());
        actionsTitle.textContent = 'Log outreach for ' + waves;
        actionsMsg.textContent =
          'Records one outreach for all ' + out.loggable + ' approved ' +
          (out.loggable === 1 ? 'company' : 'companies') + ' on ' + waves +
          ', adding 1 to each running count. Companies that reach the cap move into ' +
          'cooldown. This cannot be undone.' +
          (out.logged ? ' ' + out.logged + ' already logged for this event.' : '') + pending;
      } else {
        step = 3;
        const on = loggedOnDate();
        actionsTitle.textContent = out.logged ? 'This list is done' : 'Recorded';
        actionsMsg.textContent = (out.logged
          ? 'Recorded against ' + submission.event_name + ', and outreach logged for ' +
            out.logged + (out.logged === 1 ? ' company' : ' companies') +
            (on ? ' on ' + formatDateShort(on) : '') + '.'
          : (listed === 0
              ? 'Nothing on this list to record.'
              : 'Every company on this list is on ' + submission.event_name +
                ' (' + used + ' of ' + cap + ' counting towards the cap). ' +
                'None of them can be contacted for this event.')) + pending;
      }

      actionsBar.classList.toggle('is-done', step === 3);
      if (actionsTrack) {
        actionsTrack.querySelectorAll('[data-step]').forEach(function (li) {
          const n = parseInt(li.getAttribute('data-step'), 10);
          li.classList.toggle('is-current', n === step);
          li.classList.toggle('is-done', n < step);
        });
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

      // Rebuild confirmed "same company" links from the database. A line item
      // carrying a sponsor_id is the persisted form of that judgement, so a
      // reload (or another admin's session) picks it up rather than dropping the
      // company back into panel B.
      recordedRows.forEach(function (row) {
        if (!row.sponsor_id || linkedByNorm.has(row.normalised)) return;
        const s = sponsors.find(function (x) { return x.id === row.sponsor_id; });
        if (s) linkedByNorm.set(row.normalised, s);
      });
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
          : 'Open a submission to start';
      }
      if (dropZoneHint) {
        dropZoneHint.textContent = open
          ? 'or click to browse'
          : 'every list belongs to a club submission';
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

      // A different submission means a different list, so clear the last one
      // rather than leaving another club's results on screen.
      if (id !== lastAppliedId) {
        results = [];
        parsedRows = [];
        linkedByNorm = new Map();
        if (fileInput) fileInput.value = '';
        if (uploadStatus) uploadStatus.innerHTML = '';
        setCheckState('upload');
      }
      lastAppliedId = id || null;

      recordedRows = [];
      indexRecorded();
      syncUrl();
      setUploadGate();
      renderSubmissionCard();
      renderWaves();
      renderActions();
      renderMatchedIfShown();

      return loadRecorded().then(function () {
        renderSubmissionCard();
        renderWaves();
        renderActions();
        renderMatchedIfShown();
      });
    }

    // Panel A's tick boxes depend on what is recorded, so re-render them when
    // the submission changes under a list that is already on screen.
    function renderMatchedIfShown() {
      if (results.length) renderMatched();
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
        if (fresh && !confirm('Record ' + fresh + (fresh === 1 ? ' company' : ' companies') +
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
        renderWaves();            // the new wave appears in the history
        renderActions();
        renderMatchedIfShown();   // recorded companies can now be logged for outreach

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
                 message: 'Every list vetted here is counted against a club submission. Open one from the submission list.' });
      showBrowse();
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
        results = applyLinks(window.Matcher.checkBatch(rows, matchCtx()));
        renderCheck();
        setCheckState('results');
        checkResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Re-run the vet on the same rows against the (now-refreshed) live data.
    function revet() {
      if (!parsedRows.length) return;
      results = applyLinks(window.Matcher.checkBatch(parsedRows, matchCtx()));
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

    function industryDisplay(code) {
      const ind = industries.find(function (i) { return i.code === code; });
      return ind ? ind.display_name : code;
    }

    // ---- render step-1 results ----
    function reviewCompanies() {
      const staged = staging.stagedNormalised();
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
      renderActions();
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
        return;
      }
      matchedEmpty.hidden = true;

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

        // No tick boxes: outreach is a single wave-wide action, so this column
        // only reports state.
        let checkCell = '';
        if (canLog) {
          checkCell = '<span class="vet-pending" title="Included when outreach is logged for this wave">' +
            '<i class="bi bi-circle"></i></span>';
        } else if (approachable && line && line.outreach_logged_at) {
          checkCell = '<span class="vet-logged" title="Outreach logged for this event on ' +
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
            '<td data-label="Company (from list)"><div class="table__cell-primary">' + mapsLink(r.input) + '</div></td>' +
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
    }

    // Every approved company on this list that is recorded on the submission and
    // has not been contacted for it. Outreach is one action over this whole set:
    // there is no per-row selection, so nothing can be accidentally left behind
    // and then locked out by the wave closing.
    function loggableCompanies() {
      if (!submission) return [];
      return results.filter(function (r) {
        if (classify(r) !== 'approved' || !r.matchedId) return false;
        const line = lineFor(r);
        return !!line && !line.outreach_logged_at;
      });
    }

    // The waves this list touches that have not been contacted yet.
    function openWaves() {
      const waves = new Set();
      loggableCompanies().forEach(function (r) {
        const line = lineFor(r);
        if (line) waves.add(line.wave);
      });
      return Array.from(waves).sort(function (a, b) { return a - b; });
    }

    function waveLabel(waves) {
      if (!waves.length) return '';
      return waves.length === 1 ? 'wave ' + waves[0] : 'waves ' + waves.join(', ');
    }

    // When outreach was logged for the list already on screen.
    function loggedOnDate() {
      let latest = null;
      results.forEach(function (r) {
        const line = lineFor(r);
        if (!line || !line.outreach_logged_at) return;
        const d = new Date(line.outreach_logged_at);
        if (!latest || d > latest) latest = d;
      });
      return latest;
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
            '<td data-label="Company (from list)"><div class="table__cell-primary">' + mapsLink(r.input) + '</div></td>' +
            '<td data-label="Suggested industry">' +
              (industryLabel ? '<span class="tag">' + esc(industryLabel) + '</span>' : '<span class="text-muted text-xs">unknown</span>') +
            '</td>' +
            '<td data-label="Possible match in database">' + suggestionCell(r) + '</td>' +
            '<td data-label="Same company?">' + linkCell(r, ri) + '</td>' +
          '</tr>'
        );
      }).join('');

      if (reviewAll) reviewAll.checked = false;
      updateReviewCount();
    }

    // The confirm action for a possible match. Adding the company again would
    // duplicate the record it already has, so this is the only correct way out
    // of panel B when the suggestion is right.
    function linkCell(r, ri) {
      if (!r.suggestion) return '<span class="text-muted text-xs">-</span>';
      return '<button type="button" class="btn btn--secondary btn--sm vet-link-btn" data-link="' + ri + '">' +
        '<i class="bi bi-link-45deg"></i> Same company</button>';
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
      if (r.matchType === 'linked') {
        const ri = results.indexOf(r);
        return '<span class="table__cell-primary">' + esc(name) + '</span>' +
          ' <span class="vet-linked" title="Confirmed by an admin as the same company">linked</span>' +
          ' <button type="button" class="vet-unlink" data-unlink="' + ri + '" ' +
          'title="Undo this link" aria-label="Undo this link"><i class="bi bi-x"></i></button>';
      }
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

    // ---- Panel B: select-all + per-row sync ----
    if (reviewAll) {
      reviewAll.addEventListener('change', function () {
        const on = reviewAll.checked;
        reviewTbody.querySelectorAll('.vet-review-check').forEach(function (b) { b.checked = on; });
        updateReviewCount();
      });
    }

    reviewTbody.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-link]');
      if (btn) linkSuggestion(parseInt(btn.getAttribute('data-link'), 10));
    });

    // Undo a link that has not been recorded yet. Once the wave is recorded the
    // sponsor_id is on the line item and re-recording will not clear it, so a
    // mistake at that point needs the company removed from the submission.
    matchedTbody.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-unlink]');
      if (!btn) return;
      const ri = parseInt(btn.getAttribute('data-unlink'), 10);
      const r = results[ri];
      if (r && recordedNorms.has(window.Matcher.normalise(r.input))) {
        toastMsg({ type: 'error', title: 'Already recorded',
                   message: 'This link is saved on the submission. Remove the company from the submission to change it.' });
        return;
      }
      unlink(ri);
    });

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
        const staged = staging.stagedNormalised();
        const seeds = [];
        sel.forEach(function (r) {
          const norm = window.Matcher.normalise(r.input);
          if (staged.has(norm)) return;
          staged.add(norm);
          seeds.push({ name: r.input, industry: r.industry || 'other' });
        });
        const added = seeds.length;
        staging.addRows(seeds);
        renderReview();
        document.getElementById('section-add').scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.toast) {
          window.toast(added > 0
            ? { type: 'success', title: 'Staged', message: added + (added === 1 ? ' company' : ' companies') + ' ready to review.' }
            : { type: 'info', title: 'Already staged', message: 'These companies are already in the table below.' });
        }
      });
    }

    // ---- Panel A outreach logging: one action for the whole wave ----
    if (logBtn) {
      logBtn.addEventListener('click', async function () {
        const targets = loggableCompanies();
        if (targets.length === 0) return;
        const waves = waveLabel(openWaves());
        const label = targets.length === 1 ? '1 company' : targets.length + ' companies';
        if (!confirm('Log an outreach for all ' + label + ' on ' + waves + '?\n\n' +
                     'This adds 1 to each running count and closes ' + waves +
                     ' for outreach. It cannot be undone.')) return;

        logBtn.disabled = true;
        let logged = 0, capped = 0, skipped = 0, duplicate = 0, notRecorded = 0, failed = 0;
        for (const t of targets) {
          let res;
          try {
            res = await window.AdminAPI.logOutreach(t.matchedId, null, submissionId);
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

        // Reload the line items so the closed wave shows as closed.
        await Promise.all([refreshOutreach(), loadRecorded()]);
        logBtn.disabled = false;
        renderWaves();   // the contacted stamps land in the history too
        revet();         // refresh status, remarks, outreach and panels consistently

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
    // The table itself lives in js/admin/staging-table.js, shared with
    // the Sponsors page so the approved list can be built several
    // companies at a time from either screen.
    // ============================================================

    const staging = window.StagingTable.create({
      tbody:       stagingTbody,
      empty:       stagingEmpty,
      selectAll:   stagingAll,
      countEl:     stagingCount,
      saveCountEl: stagingSaveCt,
      addBtn:      addRowBtn,
      clearBtn:    clearBtn,
      saveBtn:     saveBtn,
      industries: function () { return industries; },
      existingNormalised: function () {
        return new Set(sponsors.map(function (s) {
          return s.normalised || window.Matcher.normalise(s.name);
        }));
      },
      // Staged companies drop out of panel B, so it always shows what is
      // still outstanding.
      onChange: function () { renderReview(); },
      onCommitted: async function (summary) {
        // Refresh the local snapshot so the re-vet below sees the new rows.
        await refreshSponsors();

        const parts = ['Added ' + summary.added +
          (summary.added === 1 ? ' sponsor' : ' sponsors') + '.'];
        if (summary.skipped) parts.push(summary.skipped + ' skipped (already in the database).');
        if (submission) parts.push('Record the list against the submission to count them.');
        toastMsg({ type: 'success', title: 'Database updated', message: parts.join(' ') });

        // Re-vet so anything just added moves up into "Found in the database".
        revet();
      }
    });

    // ---------- boot ----------
    setCheckState('upload');
    setUploadGate();
    staging.render();
    readyPromise = loadData().then(function () {
      if (loadError) return;           // nothing loaded, so nothing to attach to

      const deepLink = submissionIdFromUrl();
      const target = deepLink
        ? submissionList.find(function (x) { return x.id === deepLink; })
        : null;

      // A deep link from Home opens that submission and starts the browse view
      // on its year, so going back lands where the submission actually lives.
      if (target) browseYear = submissionYear(target);
      renderBrowse();

      if (deepLink) return openSubmission(deepLink);
      showScreen('browse');
      return applySubmission(null);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
