/* ============================================================
   js/admin/sponsors-page.js
   Main sponsors list. Reads/writes live via window.AdminAPI
   (Supabase). No MOCK_DATA on this page.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    // Wait for the client + data layer + canonical normalise() to be ready.
    if (!window.sb || !window.AdminAPI || !window.Matcher || !window.StagingTable) {
      requestAnimationFrame(init);
      return;
    }

    // Mount admin shell first (handles auth guard)
    const session = window.AdminShell.mount({
      currentPage: 'sponsors.html',
      pageTitle: 'Sponsors'
    });
    if (!session) return; // redirected away

    const esc = window.AdminShell.escapeHtml;
    const mapsLink = window.AdminShell.mapsLink;

    // ----------------- state -----------------
    const PAGE_SIZE = 50;
    let searchQuery = '';
    let statusFilter = [];     // empty = all statuses; otherwise multi-select of categories
    let industryFilter = [];   // empty = all industries; otherwise multi-select of codes
    let currentPage = 1;
    let pendingDeleteId = null;
    let pendingDeleteName = '';

    let industries = [];             // fetched once at boot
    let annexCats = [];              // annex_categories, fetched once at boot
    const annexById = {};            // id -> { annex, name }
    let currentRows = [];            // the sponsors on the page currently shown
    let contractPartnersCache = [];  // Annex B partners currently rendered

    // ----------------- elements -----------------
    const tbody = document.getElementById('sponsors-tbody');
    const empty = document.getElementById('sponsors-empty');
    const emptyTitle = document.getElementById('sponsors-empty-title');
    const emptySub = document.getElementById('sponsors-empty-sub');
    const countEl = document.getElementById('sponsors-count');
    const searchInput = document.getElementById('sponsors-search-input');
    const statusFilterEl = document.getElementById('sponsors-status-filter');
    const industryWrapEl = document.getElementById('sponsors-industry-filter');
    const industryTriggerEl = document.getElementById('sponsors-industry-trigger');
    const industryPanelEl = document.getElementById('sponsors-industry-panel');
    const industryLabelEl = document.getElementById('sponsors-industry-label');
    const deleteNameEl = document.getElementById('delete-sponsor-name');
    const deleteConfirmEl = document.getElementById('delete-sponsor-confirm');
    const pager = document.getElementById('sponsors-pager');
    const pagerNav = document.getElementById('sponsors-pager-nav');
    const pagerRange = document.getElementById('sponsors-range');

    // ----------------- helpers -----------------
    function toastMsg(opts) { if (window.toast) window.toast(opts); }
    function toastError(title, e) {
      console.error('[sponsors]', title, e);
      toastMsg({ type: 'error', title: title, message: (e && e.message) || 'Please try again.' });
    }

    function industryDisplay(code) {
      const ind = industries.find(function (i) { return i.code === code; });
      return ind ? ind.display_name : code;
    }

    // Local calendar date as YYYY-MM-DD, to compare against a date input's value.
    function todayISODate() {
      const d = new Date();
      const p = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    // Date only — "8 May 2026".
    function formatDate(d) {
      if (!d) return '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }

    // Annex B partner whose contract has lapsed (date-only comparison).
    function partnerIsExpired(s) {
      if (!s || !s.contract_ends) return false;
      const end = new Date(s.contract_ends); end.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return end < today;
    }

    // The DB keeps one 'prohibited' umbrella category for every annex-listed
    // company; the annex letter is what the club acts on. Annex A reads
    // Prohibited (remove it from the list), Annex B reads Restricted (keep it,
    // BIZCOM decides). Same rule as the public checker in matcher-core.js.
    function displayStatus(sponsor) {
      if (sponsor.category !== 'prohibited') return sponsor.category;
      const cat = sponsor.annex_category_id ? annexById[sponsor.annex_category_id] : null;
      return (cat && cat.annex === 'B') ? 'restricted' : 'prohibited';
    }

    // Status shown as a coloured tag (icon + label).
    function statusPill(sponsor) {
      const meta = {
        approved: { label: 'Approved', icon: 'bi-check-circle-fill' },
        prohibited: { label: 'Prohibited', icon: 'bi-x-circle-fill' },
        restricted: { label: 'Restricted', icon: 'bi-shield-fill-exclamation' },
        closed: { label: 'Closed',   icon: 'bi-dash-circle-fill' },
        alumni: { label: 'Alumni',   icon: 'bi-mortarboard-fill' }
      };
      const status = displayStatus(sponsor);
      const m = meta[status] || { label: status, icon: 'bi-tag-fill' };
      return '<span class="status-pill status-pill--' + status + '">' +
        '<i class="bi ' + m.icon + '"></i>' + m.label + '</span>';
    }

    // Which category names its members and which is only a type is editorial,
    // not structural: nothing in the data marks the difference. Annex A names
    // the Board of Trustees because the standing order does, and Annex B names
    // BIZCOM's own partners. Both are matched by name, the same way the public
    // directory does it in js/pages/dashboard.js. Keep the two in step: if a
    // category is renamed in the database, its list renders empty and it joins
    // the tag row instead, which is wrong but not misleading.
    const TRUSTEES_CATEGORY = 'board of trustees';
    const PARTNER_CATEGORY  = 'bizcom partner';

    function annexCatsFor(letter) {
      return annexCats
        .filter(function (a) { return a.annex === letter; })
        .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    }

    function nameIs(target) {
      return function (c) { return String(c.name || '').trim().toLowerCase() === target; };
    }
    const isTrusteesCategory = nameIs(TRUSTEES_CATEGORY);
    const isPartnerCategory  = nameIs(PARTNER_CATEGORY);

    // The status pills mix plain categories with the two annex pills. Annex A
    // and Annex B are not categories in the database, so they are turned into
    // the annex_categories ids they cover and filtered on annex_category_id.
    function annexIdsFor(letter) {
      return annexCatsFor(letter).map(function (a) { return a.id; });
    }

    function statusParams() {
      const categories = [];
      let annexIds = [];
      let wantsAnnex = false;
      statusFilter.forEach(function (v) {
        if (v === 'annex_a' || v === 'annex_b') {
          wantsAnnex = true;
          annexIds = annexIds.concat(annexIdsFor(v === 'annex_a' ? 'A' : 'B'));
        } else {
          categories.push(v);
        }
      });
      // If the annex categories failed to load there are no ids to match on.
      // Filter on a value no row can hold, so the pill returns nothing rather
      // than silently falling back to every sponsor.
      if (wantsAnnex && !annexIds.length) categories.push('__none__');
      return { status: categories, annexIds: annexIds };
    }

    // "Annex A, Tobacco Products" - the same string the old free-text
    // ban_reason column used to hold, now built from the category row.
    function annexLabel(sponsor) {
      const cat = sponsor.annex_category_id ? annexById[sponsor.annex_category_id] : null;
      return cat ? 'Annex ' + cat.annex + ', ' + cat.name : '';
    }

    // Prohibited rows lead with the annex label, because that is what the club
    // acts on, but the notes are appended rather than discarded: a partner's
    // "Signed for AY25/26 orientation season" is the only place that context
    // lives, and hiding it here made it look like an empty field.
    function notesFor(sponsor) {
      const notes = sponsor.notes || '';
      if (sponsor.category !== 'prohibited') return notes;
      const label = annexLabel(sponsor);
      if (!label) return notes;
      return notes ? label + ' · ' + notes : label;
    }

    function isFiltering() {
      return searchQuery.trim() !== '' || statusFilter.length > 0 || industryFilter.length > 0;
    }

    // ----------------- cap alert -----------------
    // Every company currently in cooldown, soonest to free up first. Always
    // visible at the top, independent of the search box.
    async function renderCapAlert() {
      const capList = document.getElementById('cap-list');
      const capEmpty = document.getElementById('cap-empty');
      if (!capList) return;

      let rows;
      try {
        rows = await window.AdminAPI.activeCooldowns();
      } catch (e) {
        toastError('Could not load cooldowns', e);
        capList.innerHTML = '';
        if (capEmpty) {
          capEmpty.hidden = false;
          // "No companies are in cooldown" would be a claim, and the read just
          // failed, so say what actually happened instead.
          capEmpty.textContent = 'Could not load cooldowns. Refresh to try again.';
        }
        return;
      }

      if (!rows.length) {
        capList.innerHTML = '';
        if (capEmpty) {
          capEmpty.textContent = 'No companies are in cooldown.';
          capEmpty.hidden = false;
        }
        return;
      }
      if (capEmpty) capEmpty.hidden = true;

      capList.innerHTML = rows.map(function (r) {
        return (
          '<li>' +
            '<a class="cap-item__link" href="sponsor.html?id=' + encodeURIComponent(r.id) + '">' +
              '<span class="cap-item__name">' + esc(r.name) + '</span>' +
              '<span class="cap-item__meter"><span class="cap-item__bar cap-item__bar--over" style="width:100%"></span></span>' +
              '<span class="cap-item__count cap-item__count--over">Ends ' + esc(formatDate(r.ends)) + '</span>' +
            '</a>' +
          '</li>'
        );
      }).join('');
    }

    // ----------------- Annex A / B -----------------
    // Both cards read from the database, so this page cannot drift from what the
    // checker actually enforces. Each card has the same two halves: one named
    // category listed company by company, and the remaining categories as type
    // tags underneath. This mirrors the public Sponsor Directory (dashboard.js).

    // Plain reference list of company names, matching the public directory.
    function renderNameList(el, rows, emptyMsg) {
      if (!rows.length) {
        el.innerHTML = '<div class="annex-empty">' + esc(emptyMsg) + '</div>';
        return;
      }
      el.innerHTML = '<ul class="annex-list">' + rows.map(function (r) {
        return '<li>' + esc(r.name) + '</li>';
      }).join('') + '</ul>';
    }

    // Annex B types the Standing Order lists but annex_categories deliberately
    // does not hold. SMU Alumni is restricted on paper, yet a company is filed
    // under the top-level 'alumni' sponsor category rather than under an annex
    // category, so there is no row for it to render from. Hardcoded here so the
    // card still lists what the Standing Order lists. Keep in step with the same
    // constant in js/pages/dashboard.js.
    const EXTRA_ANNEX_TAGS = { B: ['SMU Alumni'] };

    // The tag row for one annex, leaving out the category whose members are
    // already named in the list above it.
    function renderAnnexTags(containerId, letter, isNamed) {
      const el = document.getElementById(containerId);
      if (!el) return;
      const cats = annexCatsFor(letter).filter(function (c) { return !isNamed(c); });
      // A failed category read must not hide behind the hardcoded chips, so the
      // unavailable notice is keyed on the database half alone.
      if (!cats.length) {
        el.innerHTML = '<div class="annex-empty">Categories unavailable, please try again later.</div>';
        return;
      }
      const names = cats.map(function (c) { return c.name; })
        .concat(EXTRA_ANNEX_TAGS[letter] || []);
      el.innerHTML = names.map(function (n) {
        return '<span class="annex-tag">' + esc(n) + '</span>';
      }).join('');
    }

    // Annex A companies: everything filed under Board of Trustees. Read-only:
    // Annex A is standing-order policy, so it is not editable from this card the
    // way BIZCOM's own partners are.
    async function renderAnnexAList() {
      const listEl = document.getElementById('annex-a-trustees');
      if (!listEl) return;

      const cat = annexCatsFor('A').filter(isTrusteesCategory)[0];
      if (!cat) {
        renderNameList(listEl, [], 'Board of Trustees category unavailable.');
        return;
      }

      let rows;
      try {
        rows = await window.AdminAPI.listByAnnexCategory(cat.id);
      } catch (e) {
        toastError('Could not load Annex A companies', e);
        renderNameList(listEl, [], 'Could not load companies. Refresh to try again.');
        return;
      }
      renderNameList(listEl, rows, 'No companies currently listed.');
    }

    // Annex B partner list — active partners show normally; lapsed ones are
    // muted with a Remove button so the team can clear them from the database.
    async function renderAnnexBList() {
      const listEl = document.getElementById('annex-b-list');
      if (!listEl) return;

      let partners;
      try {
        partners = await window.AdminAPI.listContractPartners();
      } catch (e) {
        toastError('Could not load Annex B partners', e);
        return;
      }

      partners = partners.slice().sort(function (x, y) {
        const ex = partnerIsExpired(x), ey = partnerIsExpired(y);
        if (ex !== ey) return ex ? 1 : -1;                        // active first
        return new Date(x.contract_ends) - new Date(y.contract_ends); // soonest to end first
      });
      contractPartnersCache = partners;

      if (!partners.length) {
        listEl.innerHTML = '<div class="annex-empty">No partner companies yet. Use "Add" to add one with its contract end date.</div>';
        return;
      }

      listEl.innerHTML = '<ul class="annex-partners">' + partners.map(function (p) {
        const expired = partnerIsExpired(p);
        const ends = new Date(p.contract_ends);
        const dateText = (expired ? 'Ended ' : 'Ends ') + formatDate(ends);
        return '<li class="annex-partner' + (expired ? ' is-expired' : '') + '">' +
          '<span class="annex-partner__main">' +
            '<span class="annex-partner__name">' + esc(p.name) + '</span>' +
            '<span class="annex-partner__industry">' + esc(industryDisplay(p.industry)) + '</span>' +
          '</span>' +
          '<span class="annex-partner__meta">' +
            '<span class="annex-partner__date">' + esc(dateText) + '</span>' +
            '<button type="button" class="annex-partner__restore" data-restore-id="' + esc(p.id) + '" title="Move back to Approved" aria-label="Move ' + esc(p.name) + ' back to Approved">' +
              '<i class="bi bi-arrow-counterclockwise"></i>' + (expired ? ' Approve' : '') +
            '</button>' +
          '</span>' +
        '</li>';
      }).join('') + '</ul>';

      listEl.querySelectorAll('[data-restore-id]').forEach(function (btn) {
        btn.addEventListener('click', function () { restorePartnerToApproved(btn.getAttribute('data-restore-id')); });
      });
    }

    function renderAnnexes() {
      renderAnnexAList();
      renderAnnexTags('annex-a-tags', 'A', isTrusteesCategory);
      renderAnnexBList();
      renderAnnexTags('annex-b-tags', 'B', isPartnerCategory);
    }

    // ---- Annex B add / remove ----
    // Plain-word standing of a company already on the database, for the
    // convert prompt below.
    function describeExisting(s) {
      const status = displayStatus(s);
      if (status === 'restricted') {
        return s.contract_ends
          ? 'already a BIZCOM partner until ' + formatDate(new Date(s.contract_ends))
          : 'already restricted under ' + (annexLabel(s) || 'Annex B');
      }
      if (status === 'prohibited') return 'currently ' + (annexLabel(s) || 'prohibited under Annex A');
      if (status === 'approved') return 'currently approved';
      return 'currently ' + status;
    }

    async function addAnnexBPartner(name, dateStr, industry, notes) {
      // Every company added through this panel is a BIZCOM partner by
      // definition, so it takes that Annex B category.
      const partnerCat = annexCatsFor('B').filter(isPartnerCategory)[0];
      if (!partnerCat) {
        // Reached whenever the category list is unavailable, which is far more
        // often a failed read than a missing row, so the message does not guess.
        toastMsg({ type: 'error', title: 'Could not add partner',
          message: 'The BIZCOM Partner category is not available. Refresh and try again.' });
        return false;
      }

      const normalised = window.Matcher.normalise(name);
      const values = {
        name: name,
        normalised: normalised,
        industry: industry || 'other',
        category: 'prohibited',
        annex_category_id: partnerCat.id,
        notes: notes || '',
        contract_ends: dateStr
      };

      // A company signing with BIZCOM is usually one already on the database as
      // Approved, so look first rather than inserting and reporting the unique
      // violation as a dead end. Converting is an update on the existing row,
      // which keeps its id and therefore its outreach history.
      let existing = null;
      try {
        existing = await window.AdminAPI.findByNormalised(normalised);
      } catch (e) {
        toastError('Could not check for an existing company', e);
        return false;
      }

      if (existing) {
        // Re-adding an existing partner is a renewal, not a conversion, so the
        // prompt says which one is happening.
        const renewing = displayStatus(existing) === 'restricted' && !!existing.contract_ends;
        const until = formatDate(new Date(dateStr));
        const ok = confirm(renewing
          ? existing.name + ' is ' + describeExisting(existing) + '. Extend the contract to ' + until + '?'
          : existing.name + ' is already on the database, ' + describeExisting(existing) + '. ' +
            'Convert it to a BIZCOM partner until ' + until + '? Its outreach history is kept.'
        );
        if (!ok) return false;
        // Only the partner standing is written. The existing row's name and
        // industry were vetted when it was first added and the modal's fields
        // default to 'other', so patching them here would quietly downgrade a
        // correctly filed company. Notes are appended rather than replaced, for
        // the same reason: the earlier context is the part worth keeping.
        const patch = {
          category: 'prohibited',
          annex_category_id: partnerCat.id,
          contract_ends: dateStr
        };
        const added = (notes || '').trim();
        const prior = (existing.notes || '').trim();
        if (added) patch.notes = prior && prior !== added ? prior + ' ' + added : added;
        try {
          await window.AdminAPI.updateSponsor(existing.id, patch);
        } catch (e) {
          toastError('Could not convert to a partner', e);
          return false;
        }
        toastMsg({ type: 'success', title: 'Converted to partner', message: existing.name });
        // renderAnnexes(), not just the B list: converting a company that was
        // filed under Board of Trustees moves it off the Annex A card too.
        renderAnnexes();
        render();
        return true;
      }

      try {
        await window.AdminAPI.addSponsor(values);
      } catch (e) {
        if (window.AdminAPI.isUniqueViolation(e)) {
          // Only reachable if the row appeared between the lookup and the insert.
          toastMsg({ type: 'error', title: 'Already exists', message: name + ' is already in the database.' });
        } else {
          toastError('Could not add partner', e);
        }
        return false;
      }
      toastMsg({ type: 'success', title: 'Partner added', message: name });
      renderAnnexBList();
      render();
      return true;
    }

    // Ending a partnership is not a deletion. The company stays on the database
    // and goes back to Approved, which keeps its id and therefore its outreach
    // history, and puts it back in the sponsors table where it can be found and
    // approached again. Clearing the annex category and the contract date is
    // required, not tidying: the DB check constraint allows both only while the
    // category is 'prohibited'. Notes are left alone, since why the partnership
    // existed is still worth knowing afterwards.
    async function restorePartnerToApproved(id) {
      const partner = contractPartnersCache.find(function (s) { return s.id === id; });
      const name = partner ? partner.name : 'this partner';
      const expired = partner && partnerIsExpired(partner);
      const when = partner && partner.contract_ends
        ? formatDate(new Date(partner.contract_ends)) : '';

      const ask = expired
        ? name + "'s contract ended " + when + '. Move it back to Approved so clubs can approach it again?'
        : name + ' is still under contract until ' + when +
          '. End the partnership now and move it back to Approved?';
      if (!confirm(ask)) return;

      try {
        await window.AdminAPI.updateSponsor(id, {
          category: 'approved',
          annex_category_id: null,
          contract_ends: null
        });
      } catch (e) {
        toastError('Could not move the partner back to Approved', e);
        return;
      }
      toastMsg({ type: 'success', title: 'Moved to Approved', message: name });
      renderAnnexes();
      render();
    }

    // ----------------- list render -----------------
    async function render() {
      let res;
      try {
        const sf = statusParams();
        res = await window.AdminAPI.querySponsors({
          page: currentPage,
          pageSize: PAGE_SIZE,
          search: searchQuery,
          status: sf.status,
          annexIds: sf.annexIds,
          industry: industryFilter
        });
      } catch (e) {
        toastError('Could not load sponsors', e);
        tbody.innerHTML = '';
        empty.style.display = '';
        emptyTitle.textContent = 'Could not load sponsors';
        emptySub.textContent = (e && e.message) || 'Check your connection and try again.';
        pager.hidden = true;
        countEl.textContent = '0';
        return;
      }

      currentPage = res.page;
      currentRows = res.rows;
      countEl.textContent = res.total;

      if (res.total === 0) {
        tbody.innerHTML = '';
        empty.style.display = '';
        pager.hidden = true;
        if (isFiltering()) {
          emptyTitle.textContent = 'No sponsors match';
          emptySub.textContent = 'Try a different search or clear the filters.';
        } else {
          emptyTitle.textContent = 'No sponsors yet';
          emptySub.textContent = 'Add your first sponsor to get started.';
        }
        return;
      }

      empty.style.display = 'none';

      tbody.innerHTML = res.rows.map(function (s) {
        const notes = notesFor(s);
        return (
          '<tr>' +
            '<td><div class="table__cell-primary">' + mapsLink(s.name) + '</div></td>' +
            '<td>' + statusPill(s) + '</td>' +
            '<td><span class="tag tag--rounded">' + esc(industryDisplay(s.industry)) + '</span></td>' +
            '<td><div class="table__cell-secondary" title="' + esc(notes) + '">' + esc(notes) + '</div></td>' +
            '<td>' +
              '<div class="table__actions">' +
                '<a href="sponsor.html?id=' + encodeURIComponent(s.id) + '" class="table__action" title="Edit ' + esc(s.name) + '" aria-label="Edit ' + esc(s.name) + '">' +
                  '<i class="bi bi-pencil-fill"></i>' +
                '</a>' +
                '<button type="button" class="table__action table__action--danger" data-delete-id="' + esc(s.id) + '" title="Delete ' + esc(s.name) + '" aria-label="Delete ' + esc(s.name) + '">' +
                  '<i class="bi bi-trash-fill"></i>' +
                '</button>' +
              '</div>' +
            '</td>' +
          '</tr>'
        );
      }).join('');

      renderPager(res.total, res.totalPages, res.start);
    }

    function pageList(current, total) {
      if (total <= 7) {
        const out = [];
        for (let i = 1; i <= total; i++) out.push(i);
        return out;
      }
      const out = [1];
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      if (start > 2) out.push('...');
      for (let i = start; i <= end; i++) out.push(i);
      if (end < total - 1) out.push('...');
      out.push(total);
      return out;
    }

    function renderPager(totalRows, totalPages, start) {
      if (totalPages <= 1) {
        pager.hidden = true;
        return;
      }
      pager.hidden = false;
      const end = Math.min(start + PAGE_SIZE, totalRows);
      pagerRange.textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + totalRows;

      const parts = [];
      parts.push(
        '<button type="button" class="admin-table-footer__btn" data-page="prev"' +
        (currentPage === 1 ? ' disabled' : '') + ' aria-label="Previous page">' +
          '<i class="bi bi-chevron-left"></i>' +
        '</button>'
      );
      pageList(currentPage, totalPages).forEach(function (p) {
        if (p === '...') {
          parts.push('<span class="admin-table-footer__ellipsis">...</span>');
        } else {
          parts.push(
            '<button type="button" class="admin-table-footer__btn' +
            (p === currentPage ? ' is-active' : '') + '" data-page="' + p + '" aria-label="Page ' + p + '"' +
            (p === currentPage ? ' aria-current="page"' : '') + '>' + p + '</button>'
          );
        }
      });
      parts.push(
        '<button type="button" class="admin-table-footer__btn" data-page="next"' +
        (currentPage === totalPages ? ' disabled' : '') + ' aria-label="Next page">' +
          '<i class="bi bi-chevron-right"></i>' +
        '</button>'
      );
      pagerNav.innerHTML = parts.join('');

      pagerNav.querySelectorAll('[data-page]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const target = btn.getAttribute('data-page');
          if (target === 'prev') currentPage--;
          else if (target === 'next') currentPage++;
          else currentPage = parseInt(target, 10);
          render();
          const wrap = document.querySelector('.admin-table-wrap');
          if (wrap) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      });
    }

    // ----------------- wire events -----------------
    // Debounce typing so we only re-query after the admin pauses (~250ms).
    let searchDebounce;
    searchInput.addEventListener('input', function (e) {
      searchQuery = e.target.value || '';
      currentPage = 1;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(render, 250);
    });

    // Industry filter — multi-select dropdown (checkbox panel).
    function updateIndustryLabel() {
      if (!industryLabelEl) return;
      const n = industryFilter.length;
      if (n === 0) industryLabelEl.textContent = 'All industries';
      else if (n === 1) industryLabelEl.textContent = industryDisplay(industryFilter[0]);
      else industryLabelEl.textContent = n + ' industries';
      if (industryWrapEl) industryWrapEl.classList.toggle('has-selection', n > 0);
    }
    function openIndustryPanel(open) {
      if (!industryPanelEl || !industryTriggerEl) return;
      industryPanelEl.hidden = !open;
      industryTriggerEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    // Build the industry checklist from the fetched industries (+ Clear action).
    function buildIndustryPanel() {
      if (!industryPanelEl) return;
      const optsHtml = industries.map(function (ind) {
        return '<label class="multiselect__option">' +
          '<input type="checkbox" value="' + ind.code + '"> ' + esc(ind.display_name) +
        '</label>';
      }).join('');
      industryPanelEl.innerHTML = optsHtml +
        '<div class="multiselect__panel-actions"><button type="button" class="btn btn--tertiary btn--sm" data-industry-clear>Clear</button></div>';

      industryPanelEl.addEventListener('change', function (e) {
        const cb = e.target.closest('input[type="checkbox"]');
        if (!cb) return;
        const code = cb.value;
        const i = industryFilter.indexOf(code);
        if (cb.checked && i === -1) industryFilter.push(code);
        else if (!cb.checked && i !== -1) industryFilter.splice(i, 1);
        currentPage = 1;
        updateIndustryLabel();
        render();
      });
      industryPanelEl.addEventListener('click', function (e) {
        if (!e.target.closest('[data-industry-clear]')) return;
        industryFilter = [];
        industryPanelEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
        currentPage = 1;
        updateIndustryLabel();
        render();
      });
    }
    if (industryTriggerEl) {
      industryTriggerEl.addEventListener('click', function (e) {
        e.stopPropagation();
        openIndustryPanel(industryPanelEl.hidden);
      });
    }
    document.addEventListener('click', function (e) {
      if (industryWrapEl && !industryWrapEl.contains(e.target)) openIndustryPanel(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') openIndustryPanel(false);
    });

    // Status filter — multi-select pills.
    function syncStatusPills() {
      if (!statusFilterEl) return;
      statusFilterEl.querySelectorAll('[data-status]').forEach(function (btn) {
        const val = btn.getAttribute('data-status');
        const active = val === 'all' ? statusFilter.length === 0 : statusFilter.indexOf(val) !== -1;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    if (statusFilterEl) {
      statusFilterEl.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-status]');
        if (!btn) return;
        const val = btn.getAttribute('data-status');
        if (val === 'all') {
          statusFilter = [];
        } else {
          const i = statusFilter.indexOf(val);
          if (i === -1) statusFilter.push(val); else statusFilter.splice(i, 1);
        }
        currentPage = 1;
        syncStatusPills();
        render();
      });
      syncStatusPills();
    }

    // Delete a sponsor straight from the table.
    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-delete-id]');
      if (!btn) return;
      pendingDeleteId = btn.getAttribute('data-delete-id');
      const sp = currentRows.find(function (s) { return s.id === pendingDeleteId; });
      pendingDeleteName = sp ? sp.name : 'this sponsor';
      if (deleteNameEl) deleteNameEl.textContent = pendingDeleteName;
      window.openModal && window.openModal('delete-sponsor-modal');
    });
    if (deleteConfirmEl) {
      deleteConfirmEl.addEventListener('click', async function () {
        if (!pendingDeleteId) return;
        const id = pendingDeleteId;
        const name = pendingDeleteName;
        deleteConfirmEl.disabled = true;
        try {
          await window.AdminAPI.deleteSponsor(id);
        } catch (e) {
          deleteConfirmEl.disabled = false;
          toastError('Could not delete sponsor', e);
          return;
        }
        deleteConfirmEl.disabled = false;
        toastMsg({ type: 'success', title: 'Deleted', message: name });
        pendingDeleteId = null;
        pendingDeleteName = '';
        window.closeModal && window.closeModal('delete-sponsor-modal');
        renderAnnexes();   // the deleted row may have been named on either card
        render();
      });
    }

    // Annex B add-client modal (name + contract end date + industry + notes).
    const annexAddBtn = document.getElementById('annex-b-add-btn');
    const annexForm = document.getElementById('annex-b-form');
    const annexName = document.getElementById('annex-b-name');
    const annexDate = document.getElementById('annex-b-date');
    const annexIndustry = document.getElementById('annex-b-industry');
    const annexNotes = document.getElementById('annex-b-notes');

    function populateAnnexIndustry() {
      if (!annexIndustry) return;
      annexIndustry.innerHTML = industries.map(function (ind) {
        return '<option value="' + ind.code + '">' + esc(ind.display_name) + '</option>';
      }).join('');
      annexIndustry.value = 'other';
    }

    if (annexAddBtn && annexForm) {
      annexAddBtn.addEventListener('click', function () {
        annexForm.reset();
        if (annexIndustry) annexIndustry.value = 'other';
        window.openModal && window.openModal('annex-b-modal');
      });

      annexForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const name = annexName.value.trim();
        const date = annexDate.value;
        if (!name) {
          toastMsg({ type: 'error', title: 'Name required', message: 'Enter the company name.' });
          annexName.focus();
          return;
        }
        if (!date) {
          toastMsg({ type: 'error', title: 'Contract end date required', message: 'Pick when the contract ends.' });
          annexDate.focus();
          return;
        }
        // A date already past files the partner straight into the lapsed half of
        // this panel and hides it from the sponsors table, which is never what
        // someone adding a live partnership means.
        if (date < todayISODate()) {
          toastMsg({ type: 'error', title: 'Date already passed',
            message: 'Pick a date from today onwards, or the partnership reads as ended.' });
          annexDate.focus();
          return;
        }
        // Keep the modal open on failure so the typed values are not lost.
        const submitBtn = annexForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        const ok = await addAnnexBPartner(
          name, date,
          annexIndustry ? annexIndustry.value : 'other',
          annexNotes ? annexNotes.value.trim() : ''
        );
        if (submitBtn) submitBtn.disabled = false;
        if (ok) window.closeModal && window.closeModal('annex-b-modal');
      });
    }

    // ----------------- add sponsors (bulk) -----------------
    // The same table as Vet & Upload step 2, so the approved list can be built
    // several companies at a time rather than one form per company.
    const addStaging = window.StagingTable.create({
      tbody:       document.getElementById('add-staging-tbody'),
      empty:       document.getElementById('add-staging-empty'),
      selectAll:   document.getElementById('add-staging-all'),
      countEl:     document.getElementById('add-staging-count'),
      saveCountEl: document.getElementById('add-staging-save-count'),
      addBtn:      document.getElementById('add-staging-row'),
      clearBtn:    document.getElementById('add-staging-clear'),
      saveBtn:     document.getElementById('add-staging-save'),
      industries: function () { return industries; },
      annexCategories: function () { return annexCats; },
      // The list is paged server-side, so there is no full local copy to check
      // against. bulkAddSponsors upserts on the unique normalised name, which
      // already skips anything that exists; this only catches repeats typed
      // into the table itself.
      existingNormalised: function () { return new Set(); },
      onCommitted: function (summary) {
        const parts = ['Added ' + summary.added +
          (summary.added === 1 ? ' sponsor' : ' sponsors') + '.'];
        if (summary.skipped) {
          // These names were typed into this table by hand, so say which ones
          // were already there rather than leaving a bare count to guess at.
          const names = summary.skippedNames || [];
          const shown = names.slice(0, 3).join(', ');
          const more = names.length - 3;
          parts.push(shown
            ? 'Skipped (already in the database): ' + shown + (more > 0 ? ' and ' + more + ' more.' : '.')
            : summary.skipped + ' skipped (already in the database).');
        }
        toastMsg({ type: 'success', title: 'Database updated', message: parts.join(' ') });
        if (addStaging.count() === 0 && window.closeModal) window.closeModal('add-sponsors-modal');
        render();
        renderCapAlert();
        renderAnnexes();
      }
    });

    // Open with one blank row ready, so the dialog is never an empty box.
    document.querySelectorAll('[data-modal-open="add-sponsors-modal"]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (addStaging.count() === 0) addStaging.addRows([{}]);
      });
    });

    // ----------------- boot -----------------
    (async function boot() {
      try {
        industries = await window.AdminAPI.listIndustries();
      } catch (e) {
        toastError('Could not load industries', e);
        industries = [];
      }
      try {
        annexCats = await window.AdminAPI.listAnnexCategories();
      } catch (e) {
        toastError('Could not load annex categories', e);
        annexCats = [];
      }
      annexCats.forEach(function (a) { annexById[a.id] = a; });

      buildIndustryPanel();
      populateAnnexIndustry();
      addStaging.render();

      renderCapAlert();
      renderAnnexes();
      render();
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
