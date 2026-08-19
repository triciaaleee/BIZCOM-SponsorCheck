/* ============================================================
   js/admin/sponsors-page.js
   Main sponsors list. Reads/writes live via window.AdminAPI
   (Supabase). No MOCK_DATA on this page.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    // Wait for the client + data layer + canonical normalise() to be ready.
    if (!window.sb || !window.AdminAPI || !window.Matcher) {
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

    // Status shown as a coloured tag (icon + label).
    function statusPill(category) {
      const meta = {
        approved: { label: 'Approved', icon: 'bi-check-circle-fill' },
        banned: { label: 'Banned',   icon: 'bi-slash-circle-fill' },
        closed: { label: 'Closed',   icon: 'bi-dash-circle-fill' },
        alumni: { label: 'Alumni',   icon: 'bi-mortarboard-fill' }
      };
      const m = meta[category] || { label: category, icon: 'bi-tag-fill' };
      return '<span class="status-pill status-pill--' + category + '">' +
        '<i class="bi ' + m.icon + '"></i>' + m.label + '</span>';
    }

    function notesFor(sponsor) {
      if (sponsor.category === 'banned' && sponsor.ban_reason) return sponsor.ban_reason;
      return sponsor.notes || '';
    }

    function isFiltering() {
      return searchQuery.trim() !== '' || statusFilter.length > 0 || industryFilter.length > 0;
    }

    // ----------------- cap alert -----------------
    // Companies whose cooldown ends in the current calendar month — i.e. those
    // that free up for outreach again this month. Always visible at the top,
    // independent of the search box.
    async function renderCapAlert() {
      const capList = document.getElementById('cap-list');
      const capEmpty = document.getElementById('cap-empty');
      if (!capList) return;

      let rows;
      try {
        rows = await window.AdminAPI.cooldownsEndingThisMonth();
      } catch (e) {
        toastError('Could not load cooldowns', e);
        capList.innerHTML = '';
        if (capEmpty) capEmpty.hidden = false;
        return;
      }

      if (!rows.length) {
        capList.innerHTML = '';
        if (capEmpty) capEmpty.hidden = false;
        return;
      }
      if (capEmpty) capEmpty.hidden = true;

      capList.innerHTML = rows.map(function (r) {
        return (
          '<li class="cap-item">' +
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
    // Annex A is a fixed policy reference — hardcoded directly in sponsors.html
    // for instant load (no DB query). See the "Annex A — Prohibited" card there.

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
            '<button type="button" class="annex-partner__remove" data-remove-id="' + esc(p.id) + '" title="Remove from database" aria-label="Remove ' + esc(p.name) + '">' +
              '<i class="bi bi-trash"></i>' + (expired ? ' Remove' : '') +
            '</button>' +
          '</span>' +
        '</li>';
      }).join('') + '</ul>';

      listEl.querySelectorAll('[data-remove-id]').forEach(function (btn) {
        btn.addEventListener('click', function () { removeAnnexBPartner(btn.getAttribute('data-remove-id')); });
      });
    }

    function renderAnnexes() {
      renderAnnexBList();
    }

    // ---- Annex B add / remove ----
    async function addAnnexBPartner(name, dateStr, industry, notes) {
      const payload = {
        name: name,
        normalised: window.Matcher.normalise(name),
        industry: industry || 'other',
        category: 'banned',
        ban_reason: 'Annex B, BIZCOM partner',
        notes: notes || '',
        contract_ends: dateStr
      };
      try {
        await window.AdminAPI.addSponsor(payload);
      } catch (e) {
        if (window.AdminAPI.isUniqueViolation(e)) {
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

    async function removeAnnexBPartner(id) {
      const partner = contractPartnersCache.find(function (s) { return s.id === id; });
      const name = partner ? partner.name : 'this partner';
      if (!confirm('Remove ' + name + ' from the database? This cannot be undone.')) return;
      try {
        await window.AdminAPI.deleteSponsor(id);
      } catch (e) {
        toastError('Could not remove partner', e);
        return;
      }
      toastMsg({ type: 'success', title: 'Removed', message: name });
      renderAnnexBList();
      render();
    }

    // ----------------- list render -----------------
    async function render() {
      let res;
      try {
        res = await window.AdminAPI.querySponsors({
          page: currentPage,
          pageSize: PAGE_SIZE,
          search: searchQuery,
          status: statusFilter,
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
            '<td>' + statusPill(s.category) + '</td>' +
            '<td><span class="tag tag--rounded">' + esc(industryDisplay(s.industry)) + '</span></td>' +
            '<td><div class="table__cell-secondary truncate" title="' + esc(notes) + '">' + esc(notes) + '</div></td>' +
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
        renderAnnexBList();   // in case the deleted row was an active Annex B partner
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

    // ----------------- boot -----------------
    (async function boot() {
      try {
        industries = await window.AdminAPI.listIndustries();
      } catch (e) {
        toastError('Could not load industries', e);
        industries = [];
      }
      buildIndustryPanel();
      populateAnnexIndustry();

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
