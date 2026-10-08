/* ============================================================
   js/admin/vet-upload-page.js
   Admin "Vet & Upload" page.

   Two screens.

     A. Browse club submissions as cards, by year and then by month.
        Year is the primary control because the tracker outlives any
        one committee; the stepper mirrors the one on Home. Completed
        and All band the cards by the month the club submitted;
        Active stays a flat queue ordered by due date. Each card says
        what is left on it ("3 to vet", "12 ready"), read from the
        saved line items, so unfinished work is visible without
        opening anything.

     B. One submission: its cap meter, then ONE TAB PER WAVE the club
        has sent, plus a tab for uploading the next one. Reached by
        clicking a card or by ?submission=<id>[&wave=<n>] from Home.

   Every list is saved the moment it is uploaded (after a confirmation
   that says what is in it), so there is no unsaved state to lose:
   leave halfway and the wave is waiting in its tab, re-checked against
   today's database, the next time the submission is opened. That
   re-check is written back straight away (refresh only, never an
   insert), so a lapsed cooldown or a company added since shows up as
   the status the server will act on.

   Working a wave:

     * Not in the database: confirm a possible match with "Same
       company", or add the companies to the database in one go from
       an editable table, correcting the name where the club spelled it
       wrong. Adding a company that already exists under another name
       would duplicate it, so confirming is the only correct move there.
     * Found in the database: any match that is not exact can be
       marked "Not the same company". That verdict is stored on the
       line item (rejected_sponsor_id, migration 0022) and the row is
       re-matched without that sponsor.
     * Approve for outreach: one action over every approved and alumni
       company on the wave. BIZCOM assumes the club will contact all of
       them, so this is what moves the event cap. It does not wait for
       the unvetted ones: they stay on the wave and get their own
       approval once vetted. A company is never approved twice for one
       event.
     * Once every wave has nothing left to vet or approve, the
       submission can be marked completed, which locks it (here and in
       record_submission_wave / log_outreach).

   One sponsor appears once per submission. A company the club lists
   again under another spelling ("KOI", then "KOI Cafe") is skipped on
   upload, and any older data holding it twice is flagged for removal:
   log_outreach finds its line item by sponsor, so a second copy could
   never be approved.

   Data layer (Supabase, no MOCK_DATA):
     * Matching:      Matcher.checkOne over live data loaded by AdminAPI.
     * Save / update: AdminAPI.recordSubmissionWave() -> the
                      record_submission_wave RPC (insert a new wave, or
                      refresh-only for edits to a saved one).
     * Approve:       AdminAPI.logOutreach() -> log_outreach RPC, passed
                      the submission so it stamps the line item and owns
                      the event cap.
     * Add sponsors:  AdminAPI.bulkAddSponsors(), one call per batch.
     * submissions.sponsor_count / listed_count / wave_count are
       re-derived by a trigger (migrations 0012, 0013, 0015).
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
    const mapsLink = window.AdminShell.mapsLink;

    // ---------- element refs ----------
    // Screen A — browsing club submissions.
    const browseEl      = document.getElementById('vet-browse');
    const browseResults = document.getElementById('browse-results');
    const yearPrev      = document.getElementById('year-prev');
    const yearNext      = document.getElementById('year-next');
    const yearLabel     = document.getElementById('year-label');
    const yearCount     = document.getElementById('year-count');
    const tabsEl        = document.getElementById('vet-tabs');

    // Screen B — one submission.
    const detailEl      = document.getElementById('vet-detail');
    const backBtn       = document.getElementById('vet-back');
    const subEventEl    = document.getElementById('vet-sub-event');
    const subClubEl     = document.getElementById('vet-sub-club');
    const subStatusEl   = document.getElementById('vet-sub-status');
    const subCountEl    = document.getElementById('vet-sub-count');
    const subWavesEl    = document.getElementById('vet-sub-waves');
    const subBar        = document.getElementById('vet-sub-bar');
    const completeBtn   = document.getElementById('vet-complete-btn');
    const completedBanner = document.getElementById('completed-banner');
    const waveTabsEl    = document.getElementById('wave-tabs');
    const waveContent   = document.getElementById('wave-content');
    const uploadPane    = document.getElementById('upload-pane');

    // The upload tab.
    const dropZone      = document.getElementById('drop-zone');
    const dropZoneTitle = document.getElementById('drop-zone-title');
    const dropZoneHint  = document.getElementById('drop-zone-hint');
    const fileInput     = document.getElementById('file-input');
    const sampleLink    = document.getElementById('load-sample-link');
    const uploadStatus  = document.getElementById('upload-status');

    // The confirmation dialog.
    const dlg           = document.getElementById('vet-dialog');
    const dlgTitle      = document.getElementById('vet-dialog-title');
    const dlgBody       = document.getElementById('vet-dialog-body');
    const dlgIcon       = document.getElementById('vet-dialog-icon');
    const dlgOk         = document.getElementById('vet-dialog-ok');
    const dlgCancel     = document.getElementById('vet-dialog-cancel');

    // ---------- state ----------
    // Live data (loaded from Supabase at boot / refreshed after writes).
    let sponsors = [];
    let industries = [];
    let annexCats = [];
    let outreachMap = {};       // { sponsorId: { count, cooldown_started_at, in_cooldown } }
    let settings = {};
    let loadError = false;

    let submissionList = [];    // every submission, for the cards
    let lineSummary = new Map();// submissionId -> { toVet, ready } from saved line items
    let submissionId = null;    // the one open on screen B, or null
    let submission = null;      // its row (sponsor_count/wave_count are derived)
    let browseYear = new Date().getFullYear();
    let browseTab = 'active';          // 'active' | 'completed' | 'all'
    let lastAppliedId = undefined;     // guards the per-submission reset on a real change
    let recordedRows = [];             // every line item on the open submission
    let recordedByNorm = new Map();    // normalised -> line item
    let currentView = [];              // recordedRows, vetted against today's database
    let activeTab = null;              // wave number, 'upload', or null
    let drafts = new Map();            // line id -> unsaved "add to database" row (see draftFor)
    let loadingWaves = false;          // a submission's line items are on their way
    let uploadIndustry = new Map();    // normalised -> industry code the club gave
    const todayStr = todayISODate();
    let readyPromise = null;

    // ---------- helpers ----------
    function toastMsg(o) { if (window.toast) window.toast(o); }
    function toastError(title, e) {
      console.error('[vet-upload]', title, e);
      toastMsg({ type: 'error', title: title, message: (e && e.message) || 'Please try again.' });
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    // Live cap/cooldown state for a sponsor, read from the loaded outreach
    // snapshot + settings.
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

    function sponsorById(id) {
      if (!id) return null;
      return sponsors.find(function (x) { return x.id === id; }) || null;
    }

    function prepSponsors(rows) {
      sponsors = rows || [];
      // Reuse the shared normalise for the lookup key so it can't drift.
      sponsors.forEach(function (s) { s.normalised = window.Matcher.normalise(s.name); });
      // Resolve each sponsor's annex so Annex A (prohibited) and Annex B
      // (restricted) can be told apart.
      window.Matcher.attachAnnex(sponsors, annexCats);
    }

    function loadData() {
      return Promise.all([
        window.AdminAPI.listIndustries(),
        window.AdminAPI.allSponsors(),
        window.AdminAPI.outreachSnapshot(),
        window.AdminAPI.getSettings(),
        window.AdminAPI.listSubmissions(),
        window.AdminAPI.listAnnexCategories(),
        window.AdminAPI.listSubmissionLineSummary()
      ]).then(function (out) {
        industries = out[0] || [];
        outreachMap = out[2] || {};
        settings = out[3] || {};
        submissionList = out[4] || [];
        annexCats = out[5] || [];
        prepSponsors(out[1]);
        buildLineSummary(out[6] || []);
      }).catch(function (e) {
        loadError = true;
        toastError('Could not load the sponsor database', e);
      });
    }
    function refreshOutreach() {
      return window.AdminAPI.outreachSnapshot().then(function (map) { outreachMap = map || {}; }, function () {});
    }
    function refreshSponsors() {
      return window.AdminAPI.allSponsors().then(prepSponsors, function () {});
    }

    // ============================================================
    // MATCHING
    // ============================================================

    // Statuses that may be approved for outreach (and so may ever use the
    // event cap). The server's counts_toward_cap() (0013) is the authority.
    function countsTowardCap(bucket) {
      return window.AdminAPI.countsTowardCap(bucket);
    }

    // Build the row by running the confirmed sponsor back through the matcher,
    // rather than hand-copying fields onto it. The Annex A/B split and the
    // lapsed-contract case both live in checkOne(); a hand copy once carried
    // the category across but not the annex letter, and filed an Annex B
    // partner as prohibited. The sponsor is handed over under the input's own
    // lookup key so checkOne's exact-match pass fires on it, which is precisely
    // what confirming a link asserts.
    function linkedResult(r, s) {
      const standIn = {};
      Object.keys(s).forEach(function (k) { standIn[k] = s[k]; });
      standIn.normalised = window.Matcher.normalise(r.input);

      const out = window.Matcher.checkOne(r.input, null, {
        sponsors: [standIn], capState: capState, today: todayStr
      });
      // A sponsor with no industry on record should not wipe the guess the
      // matcher already made for this row.
      if (!out.industry) out.industry = r.industry;
      out.matchType = 'linked';
      out.matchScore = null;
      out.matched = s.name;
      out.matchedName = s.name;
      out.reason = 'Confirmed by an admin as the same company as ' + s.name;
      return out;
    }

    // Vet one company name against today's database.
    //   sponsorId  — the sponsor already on its line item. It wins over
    //                whatever the matcher would pick now: it is the judgement
    //                the server acts on (log_outreach looks it up by sponsor),
    //                and it is how a confirmed "Same company" persists.
    //   rejectedId — a sponsor an admin said this is NOT. Taken out of the
    //                pool, so the row matches the next best or nothing.
    function vetName(name, sponsorId, rejectedId, industry) {
      const pool = rejectedId
        ? sponsors.filter(function (s) { return s.id !== rejectedId; })
        : sponsors;
      const r = window.Matcher.checkOne(name, industry || null, {
        sponsors: pool, capState: capState, today: todayStr
      });
      if (sponsorId && r.matchedId !== sponsorId) {
        const s = sponsorById(sponsorId);
        if (s) return linkedResult(r, s);
      }
      return r;
    }

    // Bucket a Matcher result by the matched company's real DB category, so
    // prohibited / approved / closed / alumni are distinguished. 'review' = not on
    // record. Cap state is read live so a just-approved company re-buckets.
    function classify(r) {
      switch (r.matchedCategory) {
        case 'prohibited':
          // A lapsed Annex B contract leaves nothing restricting the company.
          if (r.status === 'clear') return 'approved';
          return r.matchedAnnex === 'B' ? 'restricted' : 'prohibited';
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
    // VIEW — the open submission's line items, vetted against today
    // ============================================================

    function isCompleted() { return !!submission && submission.status === 'completed'; }
    function editable() { return !!submission && !isCompleted() && !busy; }

    // A line item is frozen when there is nothing left to decide about it:
    // outreach is approved (its status is history), or the submission is
    // completed. Frozen rows show what was saved, not what the matcher says
    // today, so an approved company that has since gone into cooldown still
    // reads as approved for this event.
    function vetLine(line, frozenAll) {
      if (frozenAll || line.outreach_logged_at) {
        const s = sponsorById(line.sponsor_id);
        return {
          line: line, frozen: true, bucket: line.status || 'review',
          r: {
            input: line.company_name, matchedId: line.sponsor_id || null,
            matchedName: s ? s.name : null, matchType: null, reason: '',
            industry: s ? s.industry : null, suggestion: null
          }
        };
      }
      const r = vetName(line.company_name, line.sponsor_id, line.rejected_sponsor_id,
                        uploadIndustry.get(line.normalised));
      return { line: line, frozen: false, r: r, bucket: classify(r) };
    }

    function lineOrder(a, b) {
      return ((a.wave || 1) - (b.wave || 1)) ||
             (new Date(a.recorded_at) - new Date(b.recorded_at)) ||
             String(a.company_name).localeCompare(String(b.company_name));
    }

    // One sponsor, one line item. A sponsor already held by another line item
    // makes this one a duplicate: the saved sponsor_id claims first (a logged
    // copy before an unlogged one), then today's matches in wave order.
    function computeView() {
      const frozenAll = isCompleted();
      const lines = recordedRows.slice().sort(lineOrder);

      const owner = new Map();
      lines.forEach(function (l) {
        if (!l.sponsor_id) return;
        const o = owner.get(l.sponsor_id);
        if (!o || (!o.outreach_logged_at && l.outreach_logged_at)) owner.set(l.sponsor_id, l);
      });

      const rows = lines.map(function (l) { return vetLine(l, frozenAll); });
      rows.forEach(function (v) {
        if (v.frozen || !v.r.matchedId) return;
        const o = owner.get(v.r.matchedId);
        if (o && o.id !== v.line.id) { v.dupOf = o; v.bucket = 'duplicate'; }
        else if (!o) owner.set(v.r.matchedId, v.line);
      });

      rows.forEach(function (v) {
        v.logged = !!v.line.outreach_logged_at;
        v.changed = !v.frozen && v.bucket !== 'duplicate' &&
          (v.line.status !== v.bucket ||
           (v.r.matchedId || null) !== (v.line.sponsor_id || null));
        v.loggable = !v.frozen && !v.logged && !!v.r.matchedId && countsTowardCap(v.bucket);
      });
      return rows;
    }

    function viewRow(lineId) {
      return currentView.find(function (v) { return v.line.id === lineId; }) || null;
    }

    function waveNumbers() {
      const set = new Set(recordedRows.map(function (r) { return r.wave || 1; }));
      return Array.from(set).sort(function (a, b) { return a - b; });
    }

    function rowsOfWave(w) {
      return currentView.filter(function (v) { return (v.line.wave || 1) === w; });
    }

    function waveStats(rows) {
      const st = { n: rows.length, toVet: 0, dup: 0, ready: 0, cooldown: 0, logged: 0 };
      rows.forEach(function (v) {
        if (v.logged) { st.logged++; return; }
        if (v.bucket === 'review') st.toVet++;
        else if (v.bucket === 'duplicate') st.dup++;
        else if (v.bucket === 'cooldown') st.cooldown++;
        if (v.loggable) st.ready++;
      });
      st.toResolve = st.toVet + st.dup;
      st.done = st.toResolve === 0 && st.ready === 0;
      return st;
    }

    // Another line item on this submission that already holds the sponsor.
    function sponsorOwner(sponsorId, exceptLineId) {
      if (!sponsorId) return null;
      const hit = currentView.find(function (v) {
        return v.line.id !== exceptLineId && v.bucket !== 'duplicate' &&
               (v.line.sponsor_id === sponsorId || v.r.matchedId === sponsorId);
      });
      return hit ? hit.line : null;
    }

    function entryFor(line, r, rejectedId) {
      return {
        company_name: line.company_name,
        normalised: line.normalised,
        sponsor_id: r.matchedId || null,
        status: classify(r),
        rejected_sponsor_id: rejectedId || null
      };
    }

    // ============================================================
    // DIALOG — every write on this page asks through here
    // ============================================================

    let dialogResolve = null;
    let dialogReturnFocus = null;

    // o: { title, body (HTML), ok, cancel (null for a one-button notice),
    //      tone: 'primary' | 'danger', icon: 'bi-…' }  -> Promise<boolean>
    function askDialog(o) {
      if (dialogResolve) closeDialog(false);
      const danger = o.tone === 'danger';
      dlgTitle.textContent = o.title;
      dlgBody.innerHTML = o.body || '';
      dlgOk.textContent = o.ok || 'OK';
      dlgOk.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');
      dlgCancel.hidden = o.cancel === null;
      dlgCancel.textContent = o.cancel || 'Cancel';
      dlgIcon.className = 'vet-dialog__icon' + (danger ? ' vet-dialog__icon--danger' : '');
      dlgIcon.innerHTML = '<i class="bi ' + (o.icon || (danger ? 'bi-exclamation-triangle' : 'bi-question-lg')) + '"></i>';

      dialogReturnFocus = document.activeElement;
      dlg.classList.add('is-open');
      dlg.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      // A destructive action starts on Cancel, so Enter does the safe thing.
      setTimeout(function () { (danger && !dlgCancel.hidden ? dlgCancel : dlgOk).focus(); }, 0);
      return new Promise(function (resolve) { dialogResolve = resolve; });
    }

    function closeDialog(result) {
      if (!dialogResolve) return;
      const resolve = dialogResolve;
      dialogResolve = null;
      dlg.classList.remove('is-open');
      dlg.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
      resolve(result);
    }

    dlg.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-dialog]');
      if (btn) { closeDialog(btn.getAttribute('data-dialog') === 'ok'); return; }
      if (e.target === dlg) closeDialog(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dialogResolve) closeDialog(false);
    });

    function dialogList(names, max) {
      max = max || 8;
      const shown = names.slice(0, max);
      return '<ul class="vet-dialog__list">' +
        shown.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
        (names.length > max ? '<li class="vet-dialog__more">and ' + (names.length - max) + ' more</li>' : '') +
        '</ul>';
    }

    // ============================================================
    // SUBMISSION CONTEXT
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

    function urlParam(name) {
      try {
        return new URLSearchParams(window.location.search).get(name) || null;
      } catch (e) {
        return null;
      }
    }

    // Keep ?submission= and &wave= in step with the screen so a refresh (or a
    // bookmark) lands back on the same wave.
    function syncUrl() {
      if (!window.history || !window.history.replaceState) return;
      const url = new URL(window.location.href);
      if (submissionId) url.searchParams.set('submission', submissionId);
      else url.searchParams.delete('submission');
      if (submissionId && activeTab != null) url.searchParams.set('wave', String(activeTab));
      else url.searchParams.delete('wave');
      window.history.replaceState({}, '', url.toString());
    }

    // ---------- screen switching ----------
    function showScreen(which) {
      browseEl.hidden = which !== 'browse';
      detailEl.hidden = which === 'browse';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showBrowse() {
      if (busy) return;
      applySubmission(null);
      showScreen('browse');
      renderBrowse();
    }

    // ============================================================
    // SCREEN A — browse: year, then month
    // ============================================================
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

    // Saved statuses, not live ones: the cards need a count per submission,
    // and the open submission writes its live statuses back on every visit.
    function buildLineSummary(rows) {
      lineSummary = new Map();
      rows.forEach(addToSummary);
    }
    function addToSummary(r) {
      if (!lineSummary.has(r.submission_id)) lineSummary.set(r.submission_id, { toVet: 0, ready: 0 });
      if (r.outreach_logged_at) return;
      const e = lineSummary.get(r.submission_id);
      if (r.status === 'review') e.toVet++;
      else if (countsTowardCap(r.status)) e.ready++;
    }
    function refreshSummaryFor(id) {
      lineSummary.delete(id);
      recordedRows.forEach(function (r) { addToSummary({
        submission_id: id, status: r.status, outreach_logged_at: r.outreach_logged_at
      }); });
    }

    // Mirrors the due chip on Home so the same submission reads the same on both.
    function dueFlagHtml(s) {
      if (s.status === 'completed') return '';
      const cls = 'vet-flag vet-flag--line';
      if (!s.complete_by) return '<span class="' + cls + '">No due date</span>';
      const n = daysUntil(s.complete_by);
      if (n < 0)   return '<span class="' + cls + ' vet-flag--overdue">Overdue ' + Math.abs(n) + 'd</span>';
      if (n === 0) return '<span class="' + cls + ' vet-flag--soon">Due today</span>';
      if (n <= 3)  return '<span class="' + cls + ' vet-flag--soon">Due in ' + n + 'd</span>';
      return '<span class="' + cls + '">Due ' + esc(formatDateShort(new Date(s.complete_by))) + '</span>';
    }

    // What is left to do on a submission, so the queue can be worked from the
    // cards without opening each one.
    function nextActionHtml(s) {
      if (s.status === 'completed' || !(s.wave_count > 0)) return '';
      const e = lineSummary.get(s.id) || { toVet: 0, ready: 0 };
      let out = '';
      if (e.toVet) out += '<span class="vet-flag vet-flag--todo">' + e.toVet + ' to vet</span>';
      if (e.ready) out += '<span class="vet-flag vet-flag--ready">' + e.ready + ' ready</span>';
      return out || '<span class="vet-flag vet-flag--done">Up to date</span>';
    }

    function statusPillHtml(status) {
      const label = { new: 'New', reviewing: 'Reviewing', completed: 'Completed' }[status] || status;
      return '<span class="sub-status sub-status--' + esc(status) + '">' + label + '</span>';
    }

    function submissionCardHtml(s) {
      const cap = capForSize(s.event_size);
      const used = s.sponsor_count || 0;
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
                ' <small>/ ' + cap.toLocaleString() + ' contacted</small></span>' +
            '</div>' +
            '<div class="sub-cap__meter"><span class="' + barCls + '" style="width:' + pct + '%"></span></div>' +
          '</div>' +
          '<div class="sub-card__meta">' +
            '<span>' + (waves ? '<b>' + waves + '</b> ' + (waves === 1 ? 'wave' : 'waves') : 'No waves yet') + '</span>' +
            nextActionHtml(s) +
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
      // The caption only earns its place once there is something to count.
      // On an empty year it is taken out of the layout entirely, not just
      // blanked, so the year stays centred between the arrows.
      const hasAny = ofYear.length > 0;
      yearCount.hidden = !hasAny;
      yearCount.textContent = hasAny
        ? ofYear.length + (ofYear.length === 1 ? ' submission' : ' submissions')
        : '';

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
          '<div class="sub-empty">No ' +
          (browseTab === 'all' ? '' : browseTab + ' ') +
          'submissions in ' + browseYear + '.</div>';
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

    browseResults.addEventListener('click', function (e) {
      const card = e.target.closest('[data-open]');
      if (card) openSubmission(card.getAttribute('data-open'));
    });

    yearPrev.addEventListener('click', function () { browseYear--; renderBrowse(); });
    yearNext.addEventListener('click', function () { browseYear++; renderBrowse(); });

    tabsEl.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      browseTab = btn.getAttribute('data-tab');
      tabsEl.querySelectorAll('[data-tab]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      renderBrowse();
    });

    backBtn.addEventListener('click', showBrowse);

    // ============================================================
    // SCREEN B — rendering
    // ============================================================

    function renderAll() {
      currentView = submission ? computeView() : [];
      renderSubmissionCard();
      renderTabs();
      renderWave();
      setUploadGate();
      syncUrl();
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

      // The cap limits contacts, not the size of the list, so the two numbers
      // sit side by side: they are far apart by design.
      const listed = submission.listed_count || 0;
      subCountEl.textContent =
        used.toLocaleString() + ' / ' + cap.toLocaleString() + ' contacted' +
        (listed ? ', ' + listed.toLocaleString() + ' listed' : '');
      subWavesEl.textContent =
        waves === 0 ? 'No waves yet' : waves + (waves === 1 ? ' wave' : ' waves');

      subBar.style.width = pct + '%';
      subBar.classList.toggle('sub-cap__bar--full', cap > 0 && used >= cap);
      subBar.classList.toggle('sub-cap__bar--near', cap > 0 && used < cap && pct >= 80);

      completedBanner.hidden = !isCompleted();

      // Offered only once there is nothing left to vet or approve anywhere.
      const waveNos = waveNumbers();
      const allDone = waveNos.length > 0 && waveNos.every(function (w) {
        return waveStats(rowsOfWave(w)).done;
      });
      completeBtn.hidden = isCompleted() || !allDone;
      completeBtn.disabled = busy;
    }

    function renderTabs() {
      if (!submission) { waveTabsEl.innerHTML = ''; return; }
      const waves = waveNumbers();
      let html = waves.map(function (w) {
        let badge = '';
        if (!isCompleted()) {
          const st = waveStats(rowsOfWave(w));
          if (st.toResolve) badge = '<span class="wave-tab__chip wave-tab__chip--todo">' + st.toResolve + ' to resolve</span>';
          else if (st.ready) badge = '<span class="wave-tab__chip wave-tab__chip--ready">' + st.ready + ' ready</span>';
          else badge = '<i class="bi bi-check-circle-fill wave-tab__done" aria-label="Nothing left to do"></i>';
        }
        return '<button type="button" role="tab" class="wave-tab" data-wave-tab="' + w + '" ' +
          'aria-selected="' + (activeTab === w) + '">Wave ' + w + badge + '</button>';
      }).join('');
      if (!isCompleted()) {
        const next = (waves.length ? waves[waves.length - 1] : 0) + 1;
        html += '<button type="button" role="tab" class="wave-tab wave-tab--upload" data-wave-tab="upload" ' +
          'aria-selected="' + (activeTab === 'upload') + '">' +
          '<i class="bi bi-upload"></i> Upload wave ' + next + '</button>';
      }
      waveTabsEl.innerHTML = html;
    }

    waveTabsEl.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-wave-tab]');
      if (!btn || busy) return;
      const t = btn.getAttribute('data-wave-tab');
      activeTab = t === 'upload' ? 'upload' : parseInt(t, 10);
      renderAll();
    });

    // Which tab to land on: the one asked for if it exists, else the first
    // wave with something left to do, else the latest wave. A submission with
    // nothing saved yet opens straight on the upload tab.
    function pickTab(wanted) {
      const waves = waveNumbers();
      if (wanted === 'upload' && !isCompleted()) return 'upload';
      const n = parseInt(wanted, 10);
      if (waves.indexOf(n) !== -1) return n;
      if (!isCompleted()) {
        const open = waves.find(function (w) { return !waveStats(rowsOfWave(w)).done; });
        if (open != null) return open;
      }
      if (waves.length) return waves[waves.length - 1];
      return isCompleted() ? null : 'upload';
    }

    function renderWave() {
      const onUpload = activeTab === 'upload';
      uploadPane.hidden = !onUpload;
      waveContent.hidden = onUpload;
      if (onUpload) return;

      if (!submission || activeTab == null) {
        waveContent.innerHTML = '<div class="vet-panel__empty">' +
          (loadingWaves ? 'Loading this submission&hellip;' : 'No lists were saved on this submission.') + '</div>';
        return;
      }

      const rows = rowsOfWave(activeTab);
      if (!rows.length) { waveContent.innerHTML = ''; return; }
      const st = waveStats(rows);

      let first = null, savedBy = null;
      rows.forEach(function (v) {
        const d = new Date(v.line.recorded_at);
        if (!first || d < first) { first = d; savedBy = v.line.recorded_by; }
      });

      // A wave can be thrown away whole while nothing on it is approved, which
      // covers the commonest mistake here: the wrong file dropped in.
      const canDiscard = editable() && st.logged === 0;

      waveContent.innerHTML =
        '<div class="wave-meta">' +
          '<div class="wave-meta__text">Received ' + esc(first ? formatDateShort(first) : '') +
            ' &middot; ' + plural(rows.length, 'company', 'companies') +
            (savedBy ? ' &middot; saved by ' + esc(savedBy) : '') + '</div>' +
          (canDiscard
            ? '<button type="button" class="btn btn--tertiary btn--sm" data-act="discard-wave">' +
                '<i class="bi bi-trash3"></i> Discard wave</button>'
            : '') +
        '</div>' +
        summaryHtml(rows) +
        (isCompleted() ? '' : actionBarHtml(st)) +
        reviewPanelHtml(rows) +
        foundPanelHtml(rows);
      refreshReviewSelection();
    }

    function summaryHtml(rows) {
      const counts = { approved: 0, alumni: 0, cooldown: 0, prohibited: 0, restricted: 0, closed: 0, review: 0 };
      rows.forEach(function (v) { if (counts[v.bucket] !== undefined) counts[v.bucket]++; });
      return '<div class="bulk-summary">' +
        statTile('approved',   counts.approved,   'Approved') +
        statTile('alumni',     counts.alumni,     'Alumni') +
        statTile('cooldown',   counts.cooldown,   'Cooldown') +
        statTile('prohibited', counts.prohibited, 'Prohibited') +
        statTile('restricted', counts.restricted, 'Restricted') +
        statTile('closed',     counts.closed,     'Closed') +
        statTile('review',     counts.review,     'Not in database') +
      '</div>';
    }

    function statTile(mod, value, label) {
      return '<div class="bulk-stat bulk-stat--' + mod + '">' +
        '<div class="bulk-stat__value">' + value + '</div>' +
        '<div class="bulk-stat__label">' + label + '</div>' +
      '</div>';
    }

    // The sticky bar: where the wave stands, and the one action it needs.
    // Approval does not wait for the unvetted rows, so the two steps can both
    // be open at once; the track shows each one's own state.
    function actionBarHtml(st) {
      const cap = submissionCap();
      const used = submission.sponsor_count || 0;
      const wouldBe = used + st.ready;
      const over = cap > 0 && st.ready > 0 && wouldBe > cap;

      const parts = [];
      if (st.toVet) parts.push(plural(st.toVet, 'company', 'companies') + ' to vet');
      if (st.dup) parts.push(plural(st.dup, 'duplicate', 'duplicates') + ' to remove');
      if (st.ready) parts.push(st.ready + ' ready for outreach');
      const title = parts.length ? parts.join(' · ') : 'Nothing left to do on this wave';
      const note = st.cooldown
        ? plural(st.cooldown, 'company is', 'companies are') +
          ' in cooldown and can be approved once it ends.'
        : '';

      function dot(n, label, state) {
        return '<li class="vet-next__dot' + (state ? ' is-' + state : '') + '"><span>' + n + '</span>' + label + '</li>';
      }

      return (
        '<div class="vet-next' + (st.done ? ' is-done' : '') + '">' +
          (over
            ? '<div class="banner banner--warn vet-next__banner">' +
                '<i class="bi bi-exclamation-triangle-fill banner__icon"></i>' +
                '<div class="banner__body">' +
                  '<div class="banner__title">Over the event cap</div>' +
                  '<div class="banner__message">' + esc(submission.event_name) + ' is a ' +
                    esc((SIZE_LABEL[submission.event_size] || submission.event_size).toLowerCase()) +
                    ' event, capped at ' + cap + ' contacted. ' + used + ' are approved already, and this wave ' +
                    'would add ' + st.ready + ' (' + wouldBe + ' in total). Remove at least ' +
                    plural(wouldBe - cap, 'company', 'companies') + ' from this wave below, or change the ' +
                    'event size on Home if the cap is wrong.</div>' +
                '</div>' +
              '</div>'
            : '') +
          '<div class="vet-next__row">' +
            '<ol class="vet-next__track" aria-label="Progress">' +
              dot(1, 'Saved', 'done') +
              dot(2, 'Vetted', st.toResolve ? 'current' : 'done') +
              dot(3, 'Approved', st.ready ? (st.toResolve ? '' : 'current') : 'done') +
            '</ol>' +
            '<div class="vet-next__text">' +
              '<div class="vet-next__title">' + esc(title) + '</div>' +
              (note ? '<div class="vet-next__note">' + esc(note) + '</div>' : '') +
            '</div>' +
            (st.ready
              ? '<button type="button" class="btn btn--primary btn--sm vet-next__btn" id="approve-btn" ' +
                  'data-act="approve"' + (over || busy ? ' disabled' : '') + '>' +
                  '<i class="bi bi-send-check"></i> <span id="approve-text">Approve ' + st.ready +
                  ' for outreach</span></button>'
              : '') +
          '</div>' +
          '<div class="vet-next__progress" id="approve-progress" hidden>' +
            '<div class="vet-next__progress-text" id="approve-progress-text"></div>' +
            '<div class="progress"><div class="progress__bar" id="approve-progress-bar" style="width:0%"></div></div>' +
          '</div>' +
        '</div>'
      );
    }

    // ---------- Not in the database ----------
    // An editable table rather than one form per company: a club list can carry
    // dozens of unknowns, and most of them go in as approved, so the common
    // case is "check the list, click once". Each row keeps a draft that
    // survives re-renders, so a correction is not lost when something else on
    // the wave is saved.
    //
    // The name field is the name the company goes into the database under.
    // Clubs misspell and abbreviate, so it can be corrected; the club's own
    // spelling stays on the submission as the record of what they sent.
    const STATUS_OPTIONS = [
      { value: 'approved',   label: 'Approved' },
      { value: 'prohibited', label: 'Prohibited / Restricted' },
      { value: 'closed',     label: 'Closed' },
      { value: 'alumni',     label: 'Alumni' }
    ];

    function draftFor(v) {
      let d = drafts.get(v.line.id);
      if (!d) {
        // The matcher's keyword guess may name a code the industries table
        // does not have. Left as it is, the picker shows its first option
        // while the draft quietly saves the unknown code.
        const known = function (code) { return industries.some(function (i) { return i.code === code; }); };
        const industry = known(v.r.industry) ? v.r.industry
          : (known('other') ? 'other' : (industries[0] ? industries[0].code : 'other'));
        d = { name: v.line.company_name, category: 'approved',
              industry: industry, annex: '', checked: true };
        drafts.set(v.line.id, d);
      }
      return d;
    }

    function isEdited(v, d) {
      return window.Matcher.normalise(d.name) !== v.line.normalised;
    }

    // Is a corrected name already a company on the database? An exact match
    // (the same lookup key) cannot be added at all, so the row is held back
    // and offered as a link. A partial or close match is only a warning: the
    // admin may know they are different businesses. The club's own spelling
    // has already been through the matcher, so only an edited name is checked.
    function nameConflict(v, d) {
      if (!isEdited(v, d)) return null;
      const norm = window.Matcher.normalise(d.name);
      if (!norm) return null;
      const exact = sponsors.find(function (s) { return s.normalised === norm; });
      if (exact) return { sponsor: exact, hard: true };
      const r = vetName(d.name, null, v.line.rejected_sponsor_id, null);
      const s = r.matchedId ? sponsorById(r.matchedId) : null;
      return s ? { sponsor: s, hard: false } : null;
    }

    function selectedForAdd(v) {
      const d = draftFor(v);
      if (!d.checked) return false;
      const c = nameConflict(v, d);
      return !(c && c.hard);
    }

    function nameHintHtml(v, d) {
      const c = nameConflict(v, d);
      if (c) {
        return '<div class="vet-name-hint' + (c.hard ? ' is-hard' : '') + '">' +
          '<i class="bi bi-exclamation-triangle-fill"></i> ' +
          (c.hard ? 'Already in the database as ' : 'Close to ') + esc(c.sponsor.name) + '. ' +
          '<button type="button" class="vet-textbtn" data-act="link-to" data-id="' + esc(v.line.id) + '" ' +
            'data-sponsor="' + esc(c.sponsor.id) + '">Link instead</button>' +
        '</div>';
      }
      return isEdited(v, d) ? '<div class="vet-name-hint">Edited from the club’s spelling</div>' : '';
    }

    function optionsHtml(list, selected) {
      return list.map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' +
          esc(o.label) + '</option>';
      }).join('');
    }

    // BIZCOM Partner is absent on purpose: a partner needs a contract end date,
    // which this table has no field for. Partners are added from the Annex B
    // panel on the Sponsors page instead. (Same rule as staging-table.js.)
    function isPartnerCategory(cat) {
      return cat.annex === 'B' && (cat.name || '').toLowerCase() === 'bizcom partner';
    }

    function annexOptionsHtml(selected) {
      const cats = annexCats.filter(function (a) { return !isPartnerCategory(a); });
      let out = '<option value="">Annex category…</option>';
      [['A', 'Prohibited (Annex A)'], ['B', 'Restricted (Annex B)']].forEach(function (pair) {
        const inAnnex = cats.filter(function (a) { return a.annex === pair[0]; });
        if (!inAnnex.length) return;
        out += '<optgroup label="' + esc(pair[1]) + '">' +
          inAnnex.map(function (a) {
            return '<option value="' + esc(a.id) + '"' + (a.id === selected ? ' selected' : '') + '>' +
              esc(a.name) + '</option>';
          }).join('') +
          '</optgroup>';
      });
      return out;
    }

    function statusLabel(d) {
      if (d.category === 'prohibited') {
        const cat = annexCats.find(function (a) { return a.id === d.annex; });
        return cat && cat.annex === 'B' ? 'Restricted' : 'Prohibited';
      }
      return STATUS_OPTIONS.find(function (o) { return o.value === d.category; }).label;
    }

    function rejectedNoteHtml(v, canEdit) {
      const rejected = sponsorById(v.line.rejected_sponsor_id);
      if (!rejected) return '';
      return '<div class="vet-rejected">Not ' + esc(rejected.name) +
        (canEdit ? ' <button type="button" class="vet-textbtn" data-act="unreject" data-id="' + esc(v.line.id) + '">Undo</button>' : '') +
        '</div>';
    }

    function reviewPanelHtml(rows) {
      const list = rows.filter(function (v) { return v.bucket === 'review'; });
      if (!list.length) return '';
      const canEdit = editable();

      const head =
        '<div class="vet-panel__head">' +
          '<h3 class="vet-panel__title"><i class="bi bi-search"></i> Not in the database</h3>' +
          '<span class="vet-panel__sub">' +
            (canEdit
              ? 'No confident match was found. If a possible match is the same company, use ' +
                '&ldquo;Same company&rdquo;; adding it again would duplicate the record it already has. ' +
                'Otherwise tick the companies to add, correct any name the club spelled wrong, and add ' +
                'them in one go. The club’s spelling stays on the submission. None of this holds up ' +
                'approving the rest of the wave.'
              : 'These companies were never vetted.') +
          '</span>' +
        '</div>';

      if (!canEdit) {
        return (
          '<div class="vet-panel vet-panel--review">' + head +
            '<div class="table-wrapper table-wrapper--responsive">' +
              '<table class="table">' +
                '<thead><tr><th style="width: 44px">#</th><th>Company (from list)</th>' +
                  '<th>Possible match in database</th></tr></thead>' +
                '<tbody>' + list.map(function (v) {
                  return '<tr>' +
                    '<td class="table__cell-secondary" data-label="#">' + (rows.indexOf(v) + 1) + '</td>' +
                    '<td data-label="Company (from list)"><div class="table__cell-primary">' + mapsLink(v.r.input) + '</div>' +
                      rejectedNoteHtml(v, false) + '</td>' +
                    '<td data-label="Possible match in database">' + suggestionCell(v.r) + '</td>' +
                  '</tr>';
                }).join('') + '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>'
        );
      }

      const industryOpts = industries.map(function (i) { return { value: i.code, label: i.display_name }; });
      const body = list.map(function (v) {
        const r = v.r;
        const d = draftFor(v);
        const c = nameConflict(v, d);
        const blocked = !!(c && c.hard);
        return (
          '<tr class="' + (r.suggestion ? 'vet-suggest-row' : '') + '" data-row="' + esc(v.line.id) + '">' +
            '<td data-label="Add"><input type="checkbox" class="bulk-staging__check" data-draft="checked"' +
              (d.checked && !blocked ? ' checked' : '') + (blocked ? ' disabled' : '') +
              ' aria-label="Add ' + esc(v.line.company_name) + ' to the database"></td>' +
            '<td class="table__cell-secondary" data-label="#">' + (rows.indexOf(v) + 1) + '</td>' +
            '<td data-label="Company (from list)"><div class="table__cell-primary">' + mapsLink(r.input) + '</div>' +
              rejectedNoteHtml(v, true) + '</td>' +
            '<td data-label="Name in database">' +
              '<input type="text" class="form-input vet-name-input" data-draft="name" value="' + esc(d.name) + '" ' +
                'aria-label="Name to add ' + esc(v.line.company_name) + ' under">' +
              '<div data-hint>' + nameHintHtml(v, d) + '</div>' +
            '</td>' +
            '<td data-label="Status">' +
              '<select class="form-input" data-draft="category">' + optionsHtml(STATUS_OPTIONS, d.category) + '</select>' +
              '<select class="form-input vet-annex-select" data-draft="annex"' + (d.category === 'prohibited' ? '' : ' hidden') + '>' +
                annexOptionsHtml(d.annex) + '</select>' +
            '</td>' +
            '<td data-label="Industry"><select class="form-input" data-draft="industry">' +
              optionsHtml(industryOpts, d.industry) + '</select></td>' +
            '<td data-label="Possible match in database">' + suggestionCell(r) +
              (r.suggestion
                ? '<div><button type="button" class="btn btn--secondary btn--sm vet-link-btn" data-act="link" data-id="' + esc(v.line.id) + '">' +
                    '<i class="bi bi-link-45deg"></i> Same company</button></div>'
                : '') +
            '</td>' +
            '<td data-label="Remove">' + removeCellHtml(v) + '</td>' +
          '</tr>'
        );
      }).join('');

      const allOn = list.every(selectedForAdd);
      return (
        '<div class="vet-panel vet-panel--review">' + head +
          '<div class="vet-review-tools">' +
            '<label class="vet-review-tools__set">Set selected to ' +
              '<select class="form-input" data-bulk="category">' +
                '<option value="">Choose a status…</option>' + optionsHtml(STATUS_OPTIONS, '') +
              '</select></label>' +
          '</div>' +
          '<div class="table-wrapper table-wrapper--responsive">' +
            '<table class="table vet-review-table">' +
              '<thead><tr>' +
                '<th style="width: 40px"><input type="checkbox" class="bulk-staging__check" data-draft-all' +
                  (allOn ? ' checked' : '') + ' aria-label="Select every company"></th>' +
                '<th style="width: 44px">#</th>' +
                '<th>Company (from list)</th>' +
                '<th style="min-width: 220px">Name in database</th>' +
                '<th style="width: 190px">Status</th>' +
                '<th style="width: 180px">Industry</th>' +
                '<th>Possible match in database</th>' +
                '<th style="width: 48px"></th>' +
              '</tr></thead>' +
              '<tbody>' + body + '</tbody>' +
            '</table>' +
          '</div>' +
          '<div class="vet-review-foot">' +
            '<span class="vet-review-foot__count" data-sel-count></span>' +
            '<button type="button" class="btn btn--primary btn--sm" data-act="bulk-add" data-bulk-add>' +
              '<i class="bi bi-database-add"></i> <span data-bulk-add-text></span></button>' +
          '</div>' +
        '</div>'
      );
    }

    // The footer count and button, and the select-all box, follow the drafts.
    // Updated in place while typing, so the name field keeps its focus.
    function refreshReviewSelection() {
      const list = rowsOfWave(activeTab).filter(function (v) { return v.bucket === 'review'; });
      const n = list.filter(selectedForAdd).length;
      const count = waveContent.querySelector('[data-sel-count]');
      const btn = waveContent.querySelector('[data-bulk-add]');
      const text = waveContent.querySelector('[data-bulk-add-text]');
      const all = waveContent.querySelector('[data-draft-all]');
      if (count) count.textContent = n + ' selected';
      if (text) text.textContent = 'Add ' + n + ' to database';
      if (btn) btn.disabled = n === 0;
      if (all) all.checked = list.length > 0 && n === list.length;
    }

    // ---------- Found in the database ----------
    const SEVERITY = { duplicate: -1, prohibited: 0, restricted: 1, cooldown: 2, closed: 3, alumni: 4, approved: 5 };

    function foundPanelHtml(rows) {
      const list = rows.filter(function (v) { return SEVERITY[v.bucket] !== undefined; })
        .sort(function (a, b) { return SEVERITY[a.bucket] - SEVERITY[b.bucket]; });

      const body = list.length
        ? list.map(function (v) {
            const idx = rows.indexOf(v) + 1;
            const flagged = v.bucket === 'prohibited' || v.bucket === 'closed' ||
                            v.bucket === 'cooldown' || v.bucket === 'duplicate';
            return (
              '<tr class="' + (flagged ? 'is-flagged' : '') + '">' +
                '<td class="table__cell-secondary" data-label="#">' + idx + '</td>' +
                '<td data-label="Company (from list)"><div class="table__cell-primary">' + mapsLink(v.r.input) + '</div></td>' +
                '<td data-label="Matched in database">' + matchCell(v) + '</td>' +
                '<td data-label="Status">' + pillFor(v.bucket) + '</td>' +
                '<td data-label="Outreach count">' + outreachCell(v) + '</td>' +
                '<td data-label="This event">' + eventCell(v) + '</td>' +
                '<td data-label="Remarks" class="text-secondary text-xs">' + esc(remarkFor(v)) + '</td>' +
                '<td data-label="Remove">' + removeCellHtml(v) + '</td>' +
              '</tr>'
            );
          }).join('')
        : '';

      return (
        '<div class="vet-panel">' +
          '<div class="vet-panel__head">' +
            '<h3 class="vet-panel__title"><i class="bi bi-database-check"></i> Found in the database</h3>' +
          '</div>' +
          (list.length
            ? '<div class="table-wrapper table-wrapper--responsive">' +
                '<table class="table">' +
                  '<thead><tr>' +
                    '<th style="width: 44px">#</th>' +
                    '<th>Company (from list)</th>' +
                    '<th>Matched in database</th>' +
                    '<th>Status</th>' +
                    // Two different counts: the company's own running total
                    // across every event, and whether THIS event approved it.
                    '<th>Outreach count</th>' +
                    '<th>This event</th>' +
                    '<th>Remarks</th>' +
                    '<th style="width: 48px"></th>' +
                  '</tr></thead>' +
                  '<tbody>' + body + '</tbody>' +
                '</table>' +
              '</div>'
            : '<div class="vet-panel__empty">None of the companies on this wave were found in the database.</div>') +
        '</div>'
      );
    }

    function remarkFor(v) {
      if (v.bucket === 'duplicate' && v.dupOf) {
        return 'Same company as "' + v.dupOf.company_name + '" on wave ' + (v.dupOf.wave || 1) +
               '. A company can only be on a submission once, so remove one of the two.';
      }
      return v.r.reason || '';
    }

    function matchCell(v) {
      const r = v.r;
      const name = r.matchedName || r.matched || '';
      if (!name) return '<span class="text-muted text-xs">-</span>';
      let caveat = '';
      if (r.matchType === 'linked') {
        caveat = ' <span class="vet-linked" title="Confirmed by an admin as the same company">linked</span>';
      } else if (r.matchType === 'fuzzy') {
        caveat = ' <span class="vet-approx" title="Approximate match, please verify">approx. ' +
          (r.matchScore || '') + '%</span>';
      } else if (r.matchType === 'contains') {
        // Containment fires only when one name's whole word set sits inside
        // the other's, so it is labelled apart from the fuzzy guess. It is still
        // an assertion worth checking: "KOI" may be a different business from
        // "KOI Cafe Singapore".
        caveat = ' <span class="vet-approx" title="One name is contained in the other, ' +
          'so this is a shortened or extended form rather than the name as written. Please verify.">' +
          'partial name' + (r.matchScore ? ', ' + r.matchScore + '%' : '') + '</span>';
      }
      // An exact match cannot be wrong in the way the others can, and a
      // company with the same name could not be added again anyway.
      const canReject = editable() && !v.frozen && r.matchedId && r.matchType && r.matchType !== 'exact';
      return '<span class="table__cell-primary">' + esc(name) + '</span>' + caveat +
        (canReject
          ? '<div><button type="button" class="vet-textbtn" data-act="reject" data-id="' + esc(v.line.id) + '">' +
              'Not the same company</button></div>'
          : '');
    }

    function pillFor(bucket) {
      const map = {
        approved:   { cls: 'pill--clear',      icon: 'bi-check-circle-fill',        label: 'Approved' },
        cooldown:   { cls: 'pill--cooldown',   icon: 'bi-clock-fill',               label: 'Cooldown' },
        prohibited: { cls: 'pill--prohibited', icon: 'bi-x-circle-fill',            label: 'Prohibited' },
        restricted: { cls: 'pill--restricted', icon: 'bi-exclamation-triangle-fill', label: 'Restricted' },
        closed:     { cls: 'pill--closed',     icon: 'bi-slash-circle-fill',        label: 'Closed' },
        alumni:     { cls: 'pill--alumni',     icon: 'bi-mortarboard-fill',         label: 'Alumni' },
        duplicate:  { cls: 'pill--neutral',    icon: 'bi-files',                    label: 'Duplicate' }
      };
      const m = map[bucket] || { cls: 'pill--neutral', icon: 'bi-question-circle', label: 'Unvetted' };
      return '<span class="pill ' + m.cls + '"><i class="bi ' + m.icon + ' pill__icon"></i>' + m.label + '</span>';
    }

    // The sponsor's own running outreach count, which is global and separate
    // from the event cap. Cooldown is included because the count and its end
    // date are the whole reason that row is flagged.
    const HAS_OUTREACH_COUNT = { approved: 1, alumni: 1, cooldown: 1 };
    function outreachCell(v) {
      if (!v.r.matchedId || !HAS_OUTREACH_COUNT[v.bucket]) {
        return '<span class="text-muted text-xs">n/a</span>';
      }
      const st = capState(v.r.matchedId);
      let cls = 'vet-cap';
      if (st.inCooldown) cls += ' vet-cap--over';
      else if (st.approaching) cls += ' vet-cap--near';
      let html = '<span class="' + cls + '">' + st.count + ' / ' + st.cap + '</span>';
      if (st.inCooldown && st.cooldownEndsAt) {
        html += '<span class="vet-cap__note">until ' + esc(formatDateShort(st.cooldownEndsAt)) + '</span>';
      }
      return html;
    }

    // Where the company stands for THIS event. Keyed off the line item's own
    // stamp first, so an approved company that has since hit its cap still
    // reads as approved here rather than going blank.
    function eventCell(v) {
      const line = v.line;
      if (line.outreach_logged_at) {
        return '<span class="wave-contacted">Approved ' + esc(formatDateShort(new Date(line.outreach_logged_at))) + '</span>' +
          (line.outreach_logged_by ? '<span class="vet-cap__note">by ' + esc(line.outreach_logged_by) + '</span>' : '');
      }
      if (v.loggable) return '<span class="vet-ready">Ready</span>';
      switch (v.bucket) {
        case 'duplicate':  return '<span class="wave-nope">Remove one copy</span>';
        case 'prohibited':
        case 'closed':     return '<span class="wave-nope">Cannot be approached</span>';
        case 'restricted': return '<span class="wave-nope">Restricted, not contacted</span>';
        case 'cooldown':   return '<span class="wave-nope">In cooldown</span>';
        default:           return '<span class="wave-nope">Not approved</span>';
      }
    }

    // The one control that takes a company back off a submission. Withheld
    // once outreach is approved: the outreach_log row would stay behind with
    // nothing on the event pointing at it.
    function removeCellHtml(v) {
      if (!editable() || v.line.outreach_logged_at) return '';
      return '<button type="button" class="wave-remove" data-act="remove" data-id="' + esc(v.line.id) + '" ' +
        'title="Remove from this submission" ' +
        'aria-label="Remove ' + esc(v.line.company_name) + ' from this submission">' +
        '<i class="bi bi-trash3"></i></button>';
    }

    function suggestionCell(r) {
      if (!r.suggestion) return '<span class="text-muted text-xs">None found</span>';
      const s = r.suggestion;
      return '<span class="vet-suggest">' +
        '<i class="bi bi-exclamation-triangle-fill vet-suggest__icon"></i>' +
        '<span class="table__cell-primary">' + esc(s.name) + '</span>' +
        catPill(s.annex === 'B' ? 'restricted' : s.category) +
        '<span class="vet-suggest__score">' + s.score + '% similar</span>' +
      '</span>';
    }

    function catPill(cat) {
      const labels = { approved: 'Approved', prohibited: 'Prohibited', restricted: 'Restricted', closed: 'Closed', alumni: 'Alumni' };
      return '<span class="status-pill status-pill--' + esc(cat) + '">' + esc(labels[cat] || cat) + '</span>';
    }

    function industryDisplay(code) {
      const ind = industries.find(function (i) { return i.code === code; });
      return ind ? ind.display_name : code;
    }

    function formatDateShort(d) {
      if (!d) return '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    // ============================================================
    // SCREEN B — actions
    // ============================================================

    waveContent.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn || busy) return;
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      if (act === 'approve')       approveWave(activeTab);
      else if (act === 'discard-wave') discardWave(activeTab);
      else if (act === 'remove')   removeLineItem(id);
      else if (act === 'link')     linkSuggestion(id);
      else if (act === 'link-to')  linkTo(id, btn.getAttribute('data-sponsor'));
      else if (act === 'reject')   rejectMatch(id);
      else if (act === 'unreject') unreject(id);
      else if (act === 'bulk-add') bulkAdd();
    });

    function draftRow(el) {
      const tr = el.closest('[data-row]');
      const v = tr ? viewRow(tr.getAttribute('data-row')) : null;
      return v ? { tr: tr, v: v, d: draftFor(v) } : null;
    }

    // Typing a name: keep the draft, and re-check it against the database in
    // place (a re-render would steal the focus mid-word).
    waveContent.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-draft') !== 'name') return;
      const row = draftRow(e.target);
      if (!row) return;
      row.d.name = e.target.value;
      row.tr.querySelector('[data-hint]').innerHTML = nameHintHtml(row.v, row.d);
      const c = nameConflict(row.v, row.d);
      const box = row.tr.querySelector('[data-draft="checked"]');
      box.disabled = !!(c && c.hard);
      box.checked = row.d.checked && !box.disabled;
      refreshReviewSelection();
    });

    waveContent.addEventListener('change', function (e) {
      const t = e.target;
      if (t.hasAttribute('data-draft-all')) {
        rowsOfWave(activeTab).forEach(function (v) {
          if (v.bucket === 'review') draftFor(v).checked = t.checked;
        });
        renderWave();
        return;
      }
      if (t.getAttribute('data-bulk') === 'category') {
        if (!t.value) return;
        rowsOfWave(activeTab).forEach(function (v) {
          if (v.bucket === 'review' && selectedForAdd(v)) draftFor(v).category = t.value;
        });
        renderWave();
        return;
      }
      const field = t.getAttribute('data-draft');
      if (!field || field === 'name') return;
      const row = draftRow(t);
      if (!row) return;
      if (field === 'checked') row.d.checked = t.checked;
      else row.d[field] = t.value;
      // Prohibited needs an annex category instead of nothing.
      if (field === 'category') {
        row.tr.querySelector('[data-draft="annex"]').hidden = t.value !== 'prohibited';
      }
      if (field === 'annex') t.classList.remove('is-invalid');
      refreshReviewSelection();
    });

    completeBtn.addEventListener('click', markCompleted);

    // Re-read what the server holds after a write.
    function reloadSubmission() {
      return Promise.all([loadRecorded(), refreshSubmission()]);
    }

    // Edits to rows that are already saved. Refresh-only, so a company another
    // admin removed in the meantime is not brought back as a new wave.
    function saveRows(entries) {
      if (!entries.length) return Promise.resolve();
      return window.AdminAPI.recordSubmissionWave(submissionId, entries, true)
        .then(reloadSubmission);
    }

    // Write back every row whose live verdict differs from what is saved, so
    // the server (which approves by saved status) agrees with the screen.
    async function syncChanged() {
      const changed = computeView().filter(function (v) { return v.changed; });
      await saveRows(changed.map(function (v) {
        return entryFor(v.line, v.r, v.line.rejected_sponsor_id);
      }));
      return changed.length;
    }

    async function runBusy(fn) {
      setBusy(true);
      try {
        return await fn();
      } finally {
        setBusy(false);
        renderAll();
      }
    }

    // "Same company": file this row under the suggested sponsor.
    function linkSuggestion(id) {
      const v = viewRow(id);
      if (v && v.r.suggestion) linkTo(id, v.r.suggestion.id);
    }

    // File a row under an existing sponsor: the matcher's suggestion, or the
    // company a corrected name turned out to be.
    async function linkTo(id, sponsorId) {
      const v = viewRow(id);
      const s = sponsorById(sponsorId);
      if (!v || !s) return;
      const owner = sponsorOwner(s.id, v.line.id);
      if (owner) {
        toastMsg({ type: 'error', title: 'Already on this submission',
                   message: s.name + ' is already here as "' + owner.company_name + '" on wave ' +
                            (owner.wave || 1) + '. Remove one of the two rows instead.' });
        return;
      }
      try {
        await runBusy(function () {
          return saveRows([entryFor(v.line, linkedResult(v.r, s), v.line.rejected_sponsor_id)]);
        });
      } catch (e) { toastError('Could not link this company', e); return; }
      drafts.delete(id);
      toastMsg({ type: 'success', title: 'Linked',
                 message: '“' + v.line.company_name + '” is recorded as ' + s.name + '.' });
    }

    // Re-vet a row under a different rejection and save the result. When the
    // next-best sponsor is already held by another row it is saved unmatched,
    // and shows up as a duplicate to remove rather than being refused.
    async function saveRejection(v, rejectedId) {
      const r = vetName(v.line.company_name, null, rejectedId, uploadIndustry.get(v.line.normalised));
      const entry = entryFor(v.line, r, rejectedId);
      if (entry.sponsor_id && sponsorOwner(entry.sponsor_id, v.line.id)) {
        entry.sponsor_id = null;
        entry.status = 'review';
      }
      await runBusy(function () { return saveRows([entry]); });
    }

    async function rejectMatch(id) {
      const v = viewRow(id);
      if (!v || !v.r.matchedId) return;
      const name = v.r.matchedName || v.r.matched;
      try { await saveRejection(v, v.r.matchedId); }
      catch (e) { toastError('Could not save that', e); return; }
      toastMsg({ type: 'success', title: 'Marked as a different company',
                 message: '“' + v.line.company_name + '” is no longer filed as ' + name + '.' });
    }

    async function unreject(id) {
      const v = viewRow(id);
      if (!v) return;
      try { await saveRejection(v, null); }
      catch (e) { toastError('Could not undo that', e); }
    }

    // Add every ticked company to the database in one insert, then file each
    // one on the wave under its new record. A corrected name no longer matches
    // the club's spelling, so the link is written explicitly rather than left
    // to the matcher.
    async function bulkAdd() {
      const list = rowsOfWave(activeTab).filter(function (v) { return v.bucket === 'review'; });
      const picked = [];
      const seen = new Set();
      let problem = null;
      list.forEach(function (v) {
        if (problem || !selectedForAdd(v)) return;
        const d = draftFor(v);
        const name = d.name.trim();
        const norm = window.Matcher.normalise(name);
        const tr = waveContent.querySelector('[data-row="' + v.line.id + '"]');
        if (!norm) {
          problem = { msg: 'Every selected company needs a name.', el: tr && tr.querySelector('[data-draft="name"]') };
        } else if (d.category === 'prohibited' && !d.annex) {
          problem = { msg: name + ' needs an annex category.', el: tr && tr.querySelector('[data-draft="annex"]') };
        } else if (seen.has(norm)) {
          problem = { msg: '“' + name + '” is selected twice. Untick one of them.', el: tr && tr.querySelector('[data-draft="name"]') };
        } else {
          seen.add(norm);
          picked.push({ v: v, d: d, name: name, norm: norm });
        }
      });
      if (problem) {
        if (problem.el) { problem.el.classList.add('is-invalid'); problem.el.focus(); }
        toastMsg({ type: 'error', title: 'Check the selected rows', message: problem.msg });
        return;
      }
      if (!picked.length) return;

      const ok = await askDialog({
        title: 'Add ' + plural(picked.length, 'company', 'companies') + ' to the sponsor database?',
        icon: 'bi-database-add',
        body: '<ul class="vet-dialog__list">' + picked.map(function (p) {
                return '<li><b>' + esc(p.name) + '</b> &middot; ' + esc(statusLabel(p.d)) + ', ' +
                  esc(industryDisplay(p.d.industry)) +
                  (isEdited(p.v, p.d)
                    ? ' <span class="vet-dialog__was">(listed as “' + esc(p.v.line.company_name) + '”)</span>'
                    : '') +
                  '</li>';
              }).join('') + '</ul>' +
              '<p class="vet-dialog__note">They are filed on wave ' + activeTab + ' straight away. Adding to ' +
              'the database applies to every club and every event from now on, not just this list.</p>',
        ok: 'Add ' + picked.length + ' to database'
      });
      if (!ok) return;

      let added = 0, linked = 0;
      try {
        await runBusy(async function () {
          const inserted = await window.AdminAPI.bulkAddSponsors(picked.map(function (p) {
            return {
              name: p.name, normalised: p.norm, industry: p.d.industry, category: p.d.category,
              notes: '', annex_category_id: p.d.category === 'prohibited' ? p.d.annex : null
            };
          }));
          added = inserted.length;
          await refreshSponsors();

          // Anything the insert skipped was added by someone else meanwhile;
          // it is on the database all the same, so it is linked like the rest.
          const entries = [];
          picked.forEach(function (p) {
            const s = sponsors.find(function (x) { return x.normalised === p.norm; });
            if (!s || sponsorOwner(s.id, p.v.line.id)) return;
            entries.push(entryFor(p.v.line, linkedResult(p.v.r, s), p.v.line.rejected_sponsor_id));
            drafts.delete(p.v.line.id);
            linked++;
          });
          await saveRows(entries);
        });
      } catch (e) { toastError('Could not add these companies', e); return; }

      let msg = plural(added, 'company is', 'companies are') + ' now on record and filed on wave ' + activeTab + '.';
      if (picked.length > added) msg += ' ' + (picked.length - added) + ' already existed and were linked instead.';
      if (linked < picked.length) msg += ' ' + (picked.length - linked) + ' could not be filed: that company is already on this submission.';
      toastMsg({ type: linked < picked.length ? 'warning' : 'success', title: 'Added to the database', message: msg });
    }

    async function removeLineItem(id) {
      const v = viewRow(id);
      if (!v || v.line.outreach_logged_at) return;
      const name = v.line.company_name;
      const ok = await askDialog({
        title: 'Remove “' + name + '”?',
        tone: 'danger',
        icon: 'bi-trash3',
        body: '<p>It comes off wave ' + (v.line.wave || 1) + ' of <b>' + esc(submission.event_name) + '</b>.</p>' +
              '<p class="vet-dialog__note">The company itself stays in the sponsor database. If the club ' +
              'sends it again in a later list, it is added to that wave.</p>',
        ok: 'Remove'
      });
      if (!ok) return;

      try {
        await runBusy(function () {
          return window.AdminAPI.deleteSubmissionSponsor(id).then(reloadSubmission);
        });
      } catch (e) { toastError('Could not remove this company', e); return; }
      if (!rowsOfWave(activeTab).length) { activeTab = pickTab(null); renderAll(); }
      toastMsg({ type: 'success', title: 'Removed', message: '“' + name + '” is no longer on ' + submission.event_name + '.' });
    }

    async function discardWave(w) {
      const rows = rowsOfWave(w);
      if (!rows.length || rows.some(function (v) { return v.line.outreach_logged_at; })) return;
      const ok = await askDialog({
        title: 'Discard wave ' + w + '?',
        tone: 'danger',
        icon: 'bi-trash3',
        body: '<p>All ' + plural(rows.length, 'company', 'companies') + ' on this wave come off ' +
              '<b>' + esc(submission.event_name) + '</b>. Nothing on it has been approved for outreach, ' +
              'so nothing else changes.</p>' +
              '<p class="vet-dialog__note">Use this when the wrong list was uploaded. The companies stay ' +
              'in the sponsor database.</p>',
        ok: 'Discard wave'
      });
      if (!ok) return;

      try {
        await runBusy(function () {
          return window.AdminAPI.deleteSubmissionWave(submissionId, w).then(reloadSubmission);
        });
      } catch (e) { toastError('Could not discard this wave', e); return; }
      activeTab = pickTab(null);
      renderAll();
      toastMsg({ type: 'success', title: 'Wave ' + w + ' discarded', message: plural(rows.length, 'company', 'companies') + ' removed.' });
    }

    // ---------- Approve for outreach: one action for the whole wave ----------
    async function approveWave(w) {
      if (busy || !editable()) return;
      // The submission is captured once. The loop below runs for a while, and
      // reading submissionId on each pass would send the rest to whichever
      // submission happened to be open by then.
      const forId = submissionId;

      // Bring saved statuses up to date first: the server approves by what is
      // saved, so a row that only became approved today has to say so.
      try { await runBusy(syncChanged); }
      catch (e) { toastError('Could not bring this wave up to date', e); return; }

      const rows = rowsOfWave(w);
      const st = waveStats(rows);
      const targets = rows.filter(function (v) { return v.loggable; });
      if (!targets.length) {
        toastMsg({ type: 'info', title: 'Nothing to approve', message: 'Nothing on wave ' + w + ' can be approved for outreach right now.' });
        return;
      }
      const cap = submissionCap();
      const used = submission.sponsor_count || 0;
      if (cap > 0 && used + targets.length > cap) return;   // the bar explains

      const ok = await askDialog({
        title: 'Approve ' + plural(targets.length, 'company', 'companies') + ' for outreach?',
        icon: 'bi-send-check',
        body: '<p>BIZCOM treats every company below as one the club will contact for ' +
              '<b>' + esc(submission.event_name) + '</b>.</p>' +
              dialogList(targets.map(function (v) { return v.line.company_name; })) +
              '<div class="vet-dialog__stat">Contacted on this event <b>' + used + ' &rarr; ' +
                (used + targets.length) + '</b>' + (cap > 0 ? ' of ' + cap : '') + '</div>' +
              (st.toVet
                ? '<p class="vet-dialog__note">' + plural(st.toVet, 'company', 'companies') +
                  ' on this wave ' + (st.toVet === 1 ? 'is' : 'are') + ' still unvetted. ' +
                  (st.toVet === 1 ? 'It stays' : 'They stay') + ' on the wave and can be approved once vetted.</p>'
                : '') +
              '<p class="vet-dialog__note">Each company\'s running outreach count goes up by 1. ' +
              'This can\'t be undone.</p>',
        ok: 'Approve ' + targets.length + ' for outreach'
      });
      if (!ok) return;

      const total = targets.length;
      setBusy(true);
      const btnText = document.getElementById('approve-text');
      const progress = document.getElementById('approve-progress');
      const progressText = document.getElementById('approve-progress-text');
      const progressBar = document.getElementById('approve-progress-bar');
      function showProgress(done) {
        if (btnText) btnText.textContent = 'Approving ' + done + ' of ' + total + '…';
        if (progressText) {
          progressText.textContent = done === total
            ? 'Saving the results…'
            : 'Approving wave ' + w + ', ' + done + ' of ' + total + ' done. Leave this page open.';
        }
        if (progressBar) progressBar.style.width = Math.round((done / total) * 100) + '%';
      }
      if (progress) progress.hidden = false;
      showProgress(0);

      // One request per company, and the server takes a row lock on the
      // submission for each, so this is genuinely slow on a long wave. Every
      // step is reported so it never reads as a hung page.
      const tally = { logged: 0, capped: 0, skipped: 0, duplicate: 0, not_recorded: 0,
                      event_capped: 0, not_approachable: 0, completed: 0, failed: 0 };
      let done = 0;
      for (const t of targets) {
        let res;
        try {
          res = await window.AdminAPI.logOutreach(t.r.matchedId, null, forId);
        } catch (e) {
          tally.failed++;
          showProgress(++done);
          continue;
        }
        if (res === 'capped') { tally.logged++; tally.capped++; }
        else if (tally[res] !== undefined) tally[res]++;
        showProgress(++done);
      }

      // The meter moves on this write (sponsor_count is the contacted count).
      await Promise.all([refreshOutreach(), loadRecorded(), refreshSubmission()]);
      setBusy(false);
      renderAll();

      let msg = 'Approved ' + plural(tally.logged, 'company', 'companies') + ' for outreach.';
      if (tally.capped) msg += ' ' + (tally.capped === 1 ? '1 reached its outreach cap and is now in cooldown.' : tally.capped + ' reached their outreach cap and are now in cooldown.');
      if (tally.skipped) msg += ' ' + tally.skipped + ' skipped (already in cooldown).';
      if (tally.duplicate) msg += ' ' + tally.duplicate + ' skipped (already approved for this event).';
      if (tally.not_recorded) msg += ' ' + tally.not_recorded + ' skipped (no longer on this submission).';
      if (tally.event_capped) msg += ' ' + tally.event_capped + ' skipped (the event cap is full).';
      if (tally.not_approachable) msg += ' ' + tally.not_approachable + ' skipped (cannot be approached).';
      if (tally.completed) msg += ' ' + tally.completed + ' skipped (the submission was completed).';
      if (tally.failed) msg += ' ' + tally.failed + ' failed.';
      toastMsg({
        type: (tally.failed || tally.not_recorded || tally.event_capped || tally.completed) ? 'warning' : 'success',
        title: 'Outreach approved', message: msg
      });
    }

    async function markCompleted() {
      if (!editable()) return;
      const cooldown = currentView.filter(function (v) { return !v.logged && v.bucket === 'cooldown'; }).length;
      const ok = await askDialog({
        title: 'Mark “' + submission.event_name + '” as completed?',
        icon: 'bi-check2-circle',
        body: '<p>Every wave is vetted and approved. Completing the submission locks it: no more lists, ' +
              'approvals or removals.</p>' +
              (cooldown
                ? '<p class="vet-dialog__note">' + plural(cooldown, 'company is', 'companies are') +
                  ' still in cooldown and will not be approved for this event.</p>'
                : '') +
              '<p class="vet-dialog__note">You can reopen it on Home.</p>',
        ok: 'Mark as completed'
      });
      if (!ok) return;

      let updated;
      try {
        updated = await runBusy(function () {
          return window.AdminAPI.updateSubmission(submissionId, {
            status: 'completed',
            reviewed_by: session.email,
            reviewed_at: new Date().toISOString()
          });
        });
      } catch (e) { toastError('Could not complete this submission', e); return; }
      if (updated) setSubmissionRow(updated);
      activeTab = pickTab(activeTab);
      renderAll();
      toastMsg({ type: 'success', title: 'Submission completed', message: submission.event_name });
    }

    // ============================================================
    // UPLOAD TAB — parse, vet, confirm, save as a new wave
    // ============================================================

    dropZone.addEventListener('dragenter', dragOver);
    dropZone.addEventListener('dragover', dragOver);
    function dragOver(e) { e.preventDefault(); dropZone.classList.add('is-drag-over'); }
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

    fileInput.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) handleFile(file);
    });

    sampleLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (!uploadAllowed()) return;
      checkAndSave(SAMPLE_TEXT, 'the sample list');
    });

    // A drop lands on the zone regardless of the disabled input, so guard here too.
    function uploadAllowed() {
      if (busy) return false;
      if (!submission) {
        toastMsg({ type: 'error', title: 'Choose a submission first',
                   message: 'Every list vetted here belongs to a club submission. Open one from the list.' });
        showBrowse();
        return false;
      }
      if (isCompleted()) {
        toastMsg({ type: 'error', title: 'Submission completed',
                   message: 'Reopen it on Home to add another list.' });
        return false;
      }
      return true;
    }

    function handleFile(file) {
      if (!uploadAllowed()) return;
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
            '<div class="upload-status__meta">' + (file.size / 1024).toFixed(1) + ' KB, checking…</div>' +
            '<div class="progress mt-2"><div class="progress__bar progress__bar--indeterminate"></div></div>' +
          '</div>' +
        '</div>';

      const reader = new FileReader();
      reader.onload = function (e) { checkAndSave(e.target.result, file.name); };
      reader.onerror = function () {
        toastMsg({ type: 'error', title: 'Read failed', message: 'Could not read the file.' });
        clearUpload();
      };
      reader.readAsText(file);
    }

    function clearUpload() {
      uploadStatus.innerHTML = '';
      fileInput.value = '';
    }

    // ---- parsing (company_name[, industry_code] per line; header optional) ----
    function parseCsvLine(line) {
      const out = [];
      let buf = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          // "" inside a quoted field is a literal quote.
          if (inQ && line[i + 1] === '"') { buf += '"'; i++; continue; }
          inQ = !inQ;
          continue;
        }
        if (c === ',' && !inQ) { out.push(buf); buf = ''; continue; }
        buf += c;
      }
      out.push(buf);
      return out;
    }

    // Header labels, matched in FULL rather than by substring. A substring test
    // read a first row of "Nameless Cafe" as a header and dropped it without a
    // word. Row 1 is data unless it says one of these outright.
    const NAME_HEADERS = ['company name', 'company', 'name', 'sponsor', 'sponsor name'];
    const IND_HEADERS  = ['industry code', 'industry', 'category', 'type', 'code'];

    function headerKey(cell) {
      return String(cell == null ? '' : cell)
        .toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function parseRows(text) {
      const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
      if (lines.length === 0) throw new Error('This file appears to be empty.');

      const headerCols = parseCsvLine(lines[0]).map(headerKey);
      const hasHeader = headerCols.some(function (c) { return NAME_HEADERS.indexOf(c) !== -1; });
      const nameIdx = hasHeader
        ? headerCols.findIndex(function (c) { return NAME_HEADERS.indexOf(c) !== -1; })
        : 0;
      // Without a header the columns are positional, in the order the format
      // hint on the page documents: company_name first, industry_code second.
      const indIdx = hasHeader
        ? headerCols.findIndex(function (c) { return IND_HEADERS.indexOf(c) !== -1; })
        : 1;
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const rows = [];
      dataLines.forEach(function (line) {
        const cols = parseCsvLine(line);
        const name = (cols[nameIdx] || '').trim();
        if (!name) return;
        // Codes are stored lowercase, so a club writing "Food_Beverage" still lands.
        const industry = indIdx >= 0 ? (cols[indIdx] || '').trim().toLowerCase() : '';
        rows.push({ name: name, industry: industry || null });
      });

      if (rows.length === 0) throw new Error('No company names found in the file.');
      return rows;
    }

    // Sort an uploaded list into what is new to this submission and what it
    // already holds, under the same name or (through the matcher) the same
    // sponsor under another spelling.
    function vetUpload(parsed) {
      currentView = computeView();
      const ownerBySponsor = new Map();
      currentView.forEach(function (v) {
        const sid = v.frozen ? v.line.sponsor_id : v.r.matchedId;
        if (sid && v.bucket !== 'duplicate' && !ownerBySponsor.has(sid)) ownerBySponsor.set(sid, v.line);
      });

      const seenNorm = new Set();
      const seenSponsor = new Set();
      const out = { fresh: [], onSubmission: [], repeats: 0 };

      parsed.forEach(function (row) {
        const norm = window.Matcher.normalise(row.name);
        if (!norm) return;
        if (seenNorm.has(norm)) { out.repeats++; return; }
        seenNorm.add(norm);

        const same = recordedByNorm.get(norm);
        if (same) { out.onSubmission.push({ name: row.name, line: same }); return; }

        // An industry code only means something against the loaded list, and
        // an unrecognised one would reach the add form's picker as nothing.
        const industry = row.industry && industries.some(function (i) { return i.code === row.industry; })
          ? row.industry : null;
        const r = vetName(row.name, null, null, industry);
        if (r.matchedId) {
          const owner = ownerBySponsor.get(r.matchedId);
          if (owner) { out.onSubmission.push({ name: row.name, line: owner }); return; }
          if (seenSponsor.has(r.matchedId)) { out.repeats++; return; }
          seenSponsor.add(r.matchedId);
        }
        out.fresh.push({ name: row.name, norm: norm, industry: industry, r: r, bucket: classify(r) });
      });
      return out;
    }

    async function checkAndSave(text, sourceName) {
      let parsed;
      try {
        parsed = parseRows(text);
      } catch (err) {
        toastMsg({ type: 'error', title: 'Could not read this list', message: (err && err.message) || 'Check the file format and try again.' });
        clearUpload();
        return;
      }

      await readyPromise;
      if (loadError) {
        clearUpload();
        toastMsg({ type: 'error', title: 'Database not loaded', message: 'Could not load the sponsor list. Refresh and try again.' });
        return;
      }

      const out = vetUpload(parsed);
      const waves = waveNumbers();
      const wave = (waves.length ? waves[waves.length - 1] : 0) + 1;

      const skippedHtml = out.onSubmission.length
        ? '<p class="vet-dialog__note">' + plural(out.onSubmission.length, 'company is', 'companies are') +
          ' already on this submission and will be skipped:</p>' +
          dialogList(out.onSubmission.map(function (o) {
            const asName = o.line.company_name !== o.name ? ' as “' + o.line.company_name + '”' : '';
            return o.name + ' (wave ' + (o.line.wave || 1) + asName + ')';
          }), 5)
        : '';
      const repeatsHtml = out.repeats
        ? '<p class="vet-dialog__note">' + plural(out.repeats, 'row repeats', 'rows repeat') +
          ' a company already on the list and will be ignored.</p>'
        : '';

      if (!out.fresh.length) {
        clearUpload();
        await askDialog({
          title: 'Nothing new on this list',
          icon: 'bi-info-lg',
          body: '<p>Every company on ' + esc(sourceName) + ' is already on this submission.</p>' + skippedHtml + repeatsHtml,
          ok: 'OK', cancel: null
        });
        return;
      }

      const LABELS = [['approved', 'Approved'], ['alumni', 'Alumni'], ['cooldown', 'Cooldown'],
                      ['prohibited', 'Prohibited'], ['restricted', 'Restricted'], ['closed', 'Closed'],
                      ['review', 'Not in database']];
      const counts = {};
      out.fresh.forEach(function (f) { counts[f.bucket] = (counts[f.bucket] || 0) + 1; });
      const chips = LABELS.filter(function (p) { return counts[p[0]]; }).map(function (p) {
        return '<span class="vet-dialog__chip vet-dialog__chip--' + p[0] + '"><b>' + counts[p[0]] + '</b> ' + p[1] + '</span>';
      }).join('');

      const ok = await askDialog({
        title: 'Save as wave ' + wave + '?',
        icon: 'bi-journal-plus',
        body: '<p>' + plural(out.fresh.length, 'new company', 'new companies') + ' from ' + esc(sourceName) +
              ' will be saved to <b>' + esc(submission.event_name) + '</b>.</p>' +
              '<div class="vet-dialog__chips">' + chips + '</div>' +
              skippedHtml + repeatsHtml +
              '<p class="vet-dialog__note">Saving does not use the event cap. Nothing is contacted until ' +
              'you approve the wave for outreach.</p>',
        ok: 'Save as wave ' + wave
      });
      if (!ok) { clearUpload(); return; }

      out.fresh.forEach(function (f) { if (f.industry) uploadIndustry.set(f.norm, f.industry); });
      const entries = out.fresh.map(function (f) {
        return {
          company_name: f.name, normalised: f.norm,
          sponsor_id: f.r.matchedId || null, status: f.bucket, rejected_sponsor_id: null
        };
      });

      let res;
      try {
        res = await runBusy(function () {
          return window.AdminAPI.recordSubmissionWave(submissionId, entries, false).then(function (r) {
            return reloadSubmission().then(function () { return r; });
          });
        });
      } catch (e) {
        toastError('Could not save this list', e);
        return;
      } finally {
        clearUpload();
      }

      res = res || {};
      activeTab = pickTab(res.wave || wave);
      renderAll();
      waveTabsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toastMsg({ type: 'success', title: 'Wave ' + (res.wave || wave) + ' saved',
                 message: plural(res.added || 0, 'company', 'companies') + ' added to ' + submission.event_name + '.' });
    }

    // ============================================================
    // BUSY LOCK, UPLOAD GATE
    // ============================================================
    // Approving a wave is one request per company and can run for tens of
    // seconds. While any write runs, everything that could change the list
    // underneath it is shut: the tabs, the back button, the drop zone, and
    // every control in the wave. The renders after each write set the
    // controls back from the data, so this only has to flip the lock.
    let busy = false;

    function setBusy(on) {
      busy = on;
      backBtn.disabled = on;
      completeBtn.disabled = on;
      waveTabsEl.classList.toggle('is-busy', on);
      waveContent.classList.toggle('is-busy', on);
      const approve = document.getElementById('approve-btn');
      if (approve) approve.disabled = on;
      setUploadGate();
    }

    // A refresh mid-approval abandons the calls that have not been sent,
    // leaving the wave half approved. The browser's own guard is the only
    // thing that can interrupt a reload.
    window.addEventListener('beforeunload', function (e) {
      if (!busy) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    function setUploadGate() {
      const open = !!submission && !busy && !isCompleted();
      dropZone.classList.toggle('is-locked', !open);
      fileInput.disabled = !open;
      dropZoneTitle.textContent = busy ? 'Saving' : 'Drop a .csv list here';
      dropZoneHint.textContent = busy ? 'wait for the current write to finish' : 'or click to browse';
      sampleLink.classList.toggle('is-disabled', !open);
      sampleLink.setAttribute('aria-disabled', String(!open));
    }

    // ============================================================
    // OPENING A SUBMISSION
    // ============================================================

    function setSubmissionRow(row) {
      submission = row;
      const i = submissionList.findIndex(function (s) { return s.id === row.id; });
      if (i !== -1) submissionList[i] = row;
    }

    // Re-read the parent row so the trigger-derived counts shown here match
    // the database after a write.
    function refreshSubmission() {
      if (!submissionId) return Promise.resolve();
      const forId = submissionId;
      return window.AdminAPI.getSubmission(forId).then(function (row) {
        if (!row || submissionId !== forId) return;
        setSubmissionRow(row);
      }, function () {});
    }

    function indexRecorded() {
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
        refreshSummaryFor(forId);
      });
    }

    // Open one submission: switch screens, then load and re-check its waves.
    function openSubmission(id, wantedTab) {
      showScreen('detail');
      return applySubmission(id, wantedTab);
    }

    async function applySubmission(id, wantedTab) {
      submissionId = id || null;
      submission = submissionId
        ? (submissionList.find(function (s) { return s.id === submissionId; }) || null)
        : null;

      if (submissionId && !submission) {
        // Linked from a stale tab, or the submission was deleted meanwhile.
        toastMsg({ type: 'warning', title: 'Submission not found',
                   message: 'That submission no longer exists. Pick one to carry on.' });
        submissionId = null;
        showScreen('browse');
        renderBrowse();
      }

      if (submissionId !== lastAppliedId) {
        drafts = new Map();
        uploadIndustry = new Map();
        clearUpload();
      }
      lastAppliedId = submissionId;

      recordedRows = [];
      indexRecorded();
      activeTab = null;
      loadingWaves = !!submissionId;
      renderAll();
      if (!submissionId) return;

      const forId = submissionId;
      try {
        await loadRecorded();
      } catch (e) {
        loadingWaves = false;
        renderAll();
        toastError('Could not load this submission’s waves', e);
        return;
      }
      if (submissionId !== forId) return;

      // Write back anything that has moved since the last visit (a cooldown
      // ended, a company was added on the Sponsors page), so the saved status
      // the server approves by matches what the tab shows.
      if (!isCompleted()) {
        try {
          const n = await runBusy(syncChanged);
          if (n) {
            toastMsg({ type: 'info', title: 'Brought up to date',
                       message: plural(n, 'company has', 'companies have') +
                                ' a new status since this submission was last saved.' });
          }
        } catch (e) {
          console.warn('[vet-upload] could not refresh saved statuses', e);
        }
      }
      if (submissionId !== forId) return;

      loadingWaves = false;
      currentView = computeView();
      activeTab = pickTab(wantedTab);
      renderAll();
    }

    // ---------- boot ----------
    setUploadGate();
    readyPromise = loadData().then(function () {
      if (loadError) return;           // nothing loaded, so nothing to attach to

      const deepLink = urlParam('submission');
      const target = deepLink
        ? submissionList.find(function (x) { return x.id === deepLink; })
        : null;

      // A deep link from Home opens that submission and starts the browse view
      // on its year, so going back lands where the submission actually lives.
      if (target) browseYear = submissionYear(target);
      renderBrowse();

      if (deepLink) return openSubmission(deepLink, urlParam('wave'));
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
