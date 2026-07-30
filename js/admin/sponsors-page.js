/* ============================================================
   js/admin/sponsors-page.js
   Main sponsors list. Reads from window.MOCK_DATA.sponsors.
   ============================================================ */

(function () {
  'use strict';

  function init() {
    if (!window.MOCK_DATA) {
      requestAnimationFrame(init);
      return;
    }

    // Mount admin shell first (handles auth guard)
    const session = window.AdminShell.mount({
      currentPage: 'sponsors.html',
      pageTitle: 'Sponsors'
    });
    if (!session) return; // redirected away

    // ----------------- state -----------------
    const PAGE_SIZE = 50;
    let searchQuery = '';
    let statusFilter = [];     // empty = all statuses; otherwise multi-select of categories
    let industryFilter = [];   // empty = all industries; otherwise multi-select of codes
    let currentPage = 1;
    let pendingDeleteId = null;

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
    function industryDisplay(code) {
      const ind = window.MOCK_DATA.industries.find(function (i) { return i.code === code; });
      return ind ? ind.display_name : code;
    }

    // Status shown as a coloured tag (icon + label) — same data as before, just
    // presented as a chip so the list reads less flat.
    function statusPill(category) {
      const meta = {
        master: { label: 'Approved', icon: 'bi-check-circle-fill' },
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
      if (sponsor.category === 'alumni' && sponsor.alumni_owner) return sponsor.alumni_owner;
      return sponsor.notes || '';
    }

    // ----------------- render -----------------
    // Search-only: the list is driven purely by the name search box. Status and
    // industry filters were removed — at thousands of rows, browsing the whole
    // list isn't useful, so the admin searches for the company they need.
    // Query layer — mirrors a server-side paged query. Today it filters, sorts
    // and slices the in-memory MOCK_DATA. When Supabase is wired this becomes a
    // single .select(count).ilike().eq().range() call with the same inputs and
    // the same { rows, total, page } output, so render() doesn't have to change.
    // The point: the UI only ever holds one page, never the whole table — so it
    // scales the same at 50 rows or 50,000.
    function querySponsors(params) {
      const q = (params.search || '').trim().toLowerCase();
      const statuses = params.status || [];       // array; empty = all
      const industries = params.industry || [];   // array; empty = all
      const pageSize = params.pageSize || PAGE_SIZE;

      const matched = window.MOCK_DATA.sponsors.filter(function (s) {
        // Lapsed Annex B partners are dormant history — they live only in the
        // Annex B panel (for removal), not the active sponsor list.
        if (window.Bans.isExpired(s)) return false;
        if (q && s.name.toLowerCase().indexOf(q) === -1) return false;
        if (statuses.length && statuses.indexOf(s.category) === -1) return false;
        if (industries.length && industries.indexOf(s.industry) === -1) return false;
        return true;
      }).sort(function (a, b) {
        return a.name.localeCompare(b.name);   // alphabetical default
      });

      const total = matched.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(Math.max(1, params.page || 1), totalPages);
      const start = (page - 1) * pageSize;
      return {
        rows: matched.slice(start, start + pageSize),
        total: total, page: page, totalPages: totalPages, start: start
      };
    }

    function isFiltering() {
      return searchQuery.trim() !== '' || statusFilter.length > 0 || industryFilter.length > 0;
    }

    // Companies whose cooldown ends in the current calendar month — i.e. those
    // that free up for outreach again this month. Always
    // visible at the top of the page (independent of the search box), so the
    // team can see which sponsors are maxed out before reaching out again.
    function renderCapAlert() {
      const capList = document.getElementById('cap-list');
      const capEmpty = document.getElementById('cap-empty');
      const capSub = document.getElementById('cap-alert-sub');
      if (!capList) return;

      const esc = window.AdminShell.escapeHtml;
      const outreach = window.MOCK_DATA.outreach || {};
      const now = new Date();
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

      if (capSub) capSub.textContent = 'Free to approach again in ' + MONTHS[now.getMonth()];

      const rows = Object.keys(outreach)
        .map(function (id) {
          const sp = window.MOCK_DATA.sponsors.find(function (s) { return s.id === id; });
          if (!sp) return null;
          const st = window.Caps.state(id);
          // Only companies whose cooldown ends in the current calendar month.
          if (!st.inCooldown || !st.cooldownEndsAt) return null;
          const ends = st.cooldownEndsAt;
          if (ends.getFullYear() !== now.getFullYear() || ends.getMonth() !== now.getMonth()) return null;
          return { id: id, name: sp.name, ends: ends };
        })
        .filter(Boolean)
        .sort(function (a, b) { return a.ends - b.ends; }); // soonest to free up first

      if (!rows.length) {
        capList.innerHTML = '';
        capEmpty.hidden = false;
        return;
      }
      capEmpty.hidden = true;

      capList.innerHTML = rows.map(function (r) {
        return (
          '<li class="cap-item">' +
            '<a class="cap-item__link" href="sponsor.html?id=' + encodeURIComponent(r.id) + '">' +
              '<span class="cap-item__name">' + esc(r.name) + '</span>' +
              '<span class="cap-item__meter"><span class="cap-item__bar cap-item__bar--over" style="width:100%"></span></span>' +
              '<span class="cap-item__count cap-item__count--over">Ends ' + esc(window.Caps.formatDate(r.ends)) + '</span>' +
            '</a>' +
          '</li>'
        );
      }).join('');
    }

    // Annex A reference (static policy from MOCK_DATA.annexA). Only the Board of
    // Trustees enumerates companies; everything else is a list of category names.
    function renderAnnexA() {
      const esc = window.AdminShell.escapeHtml;
      const a = window.MOCK_DATA.annexA;
      const aEl = document.getElementById('annex-a-body');
      if (!aEl || !a) return;
      aEl.innerHTML =
        '<div class="annex-group__label">' + esc(a.trustees.label) + ' <span class="annex-group__kind">companies</span></div>' +
        '<ul class="annex-list">' +
          a.trustees.companies.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') +
        '</ul>' +
        '<div class="annex-group__label">Prohibited categories <span class="annex-group__kind">types</span></div>' +
        '<div class="annex-tags">' +
          a.categories.map(function (c) { return '<span class="annex-tag">' + esc(c) + '</span>'; }).join('') +
        '</div>';
    }

    // Annex B partner list — BIZCOM partners are banned sponsors carrying a
    // contract_ends date. Active partners show normally; lapsed ones are muted
    // with a Remove button so the team can clear them from the database.
    function renderAnnexBList() {
      const esc = window.AdminShell.escapeHtml;
      const listEl = document.getElementById('annex-b-list');
      if (!listEl) return;

      const partners = window.MOCK_DATA.sponsors.filter(function (s) {
        return window.Bans.isContractPartner(s);
      }).sort(function (x, y) {
        const ex = window.Bans.isExpired(x), ey = window.Bans.isExpired(y);
        if (ex !== ey) return ex ? 1 : -1;                       // active first
        return new Date(x.contract_ends) - new Date(y.contract_ends); // soonest to end first
      });

      if (!partners.length) {
        listEl.innerHTML = '<div class="annex-empty">No partner companies yet. Use “Add” to add one with its contract end date.</div>';
        return;
      }

      listEl.innerHTML = '<ul class="annex-partners">' + partners.map(function (p) {
        const expired = window.Bans.isExpired(p);
        const ends = new Date(p.contract_ends);
        const dateText = (expired ? 'Ended ' : 'Ends ') + window.Caps.formatDate(ends);
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
      renderAnnexA();
      renderAnnexBList();
    }

    // ---- Annex B add / remove ----
    function normaliseName(name) {
      return String(name).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function addAnnexBPartner(name, dateStr, industry, notes) {
      const sponsor = {
        id: 'b-' + Date.now().toString(36),
        name: name,
        normalised: normaliseName(name),
        industry: industry || 'other',
        category: 'banned',
        ban_reason: 'Annex B, BIZCOM partner',
        notes: notes || '',
        contract_ends: dateStr
      };
      window.MOCK_DATA.sponsors.push(sponsor);
      window.AdminShell.logActivity('sponsor.created', name, 'Added to Annex B, contract ends ' + dateStr);
      window.toast && window.toast({ type: 'success', title: 'Partner added', message: name });
      renderAnnexBList();
      render();
    }

    function removeAnnexBPartner(id) {
      const idx = window.MOCK_DATA.sponsors.findIndex(function (s) { return s.id === id; });
      if (idx === -1) return;
      const name = window.MOCK_DATA.sponsors[idx].name;
      if (!confirm('Remove ' + name + ' from the database? This cannot be undone.')) return;
      window.MOCK_DATA.sponsors.splice(idx, 1);
      window.AdminShell.logActivity('sponsor.deleted', name, 'Removed from Annex B');
      window.toast && window.toast({ type: 'success', title: 'Removed', message: name });
      renderAnnexBList();
      render();
    }

    // The list shows page 1 (alphabetical) on load — not an empty screen — and
    // narrows as the admin searches or filters. Only ever one page is rendered,
    // so it stays fast no matter how large the underlying table grows.
    function render() {
      const res = querySponsors({
        page: currentPage,
        pageSize: PAGE_SIZE,
        search: searchQuery,
        status: statusFilter,
        industry: industryFilter
      });
      currentPage = res.page;
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

      const esc = window.AdminShell.escapeHtml;
      const mapsLink = window.AdminShell.mapsLink;

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
      // Returns the list of page numbers + ellipsis markers to show.
      // Shape: 1, ..., current-1, current, current+1, ..., total
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
          // Scroll the table back into view after page change.
          const wrap = document.querySelector('.admin-table-wrap');
          if (wrap) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      });
    }

    // ----------------- wire events -----------------
    // Debounce typing so we only re-query after the admin pauses (~250ms) —
    // matches the cadence you'd want against a real backend, not on every keystroke.
    let searchDebounce;
    searchInput.addEventListener('input', function (e) {
      searchQuery = e.target.value || '';
      currentPage = 1;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(render, 250);
    });

    // Industry filter — multi-select dropdown (checkbox panel). 15 industries is
    // too many for a pill row, so a compact trigger opens a checklist; the button
    // label summarises the selection ("All industries" / a name / "N industries").
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
    if (industryPanelEl) {
      // Build the checklist (+ a Clear action).
      const optsHtml = window.MOCK_DATA.industries.map(function (ind) {
        return '<label class="multiselect__option">' +
          '<input type="checkbox" value="' + ind.code + '"> ' + window.AdminShell.escapeHtml(ind.display_name) +
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
    // Close the panel on outside click / Escape.
    document.addEventListener('click', function (e) {
      if (industryWrapEl && !industryWrapEl.contains(e.target)) openIndustryPanel(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') openIndustryPanel(false);
    });

    // Status filter — multi-select pills. "All" clears the selection; clicking a
    // status toggles it in/out. With nothing selected the list shows every status.
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

    // Delete a sponsor straight from the table. Trash icon → confirmation modal →
    // remove from the database. Available to all admins; the action is logged.
    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-delete-id]');
      if (!btn) return;
      pendingDeleteId = btn.getAttribute('data-delete-id');
      const sp = window.MOCK_DATA.sponsors.find(function (s) { return s.id === pendingDeleteId; });
      if (deleteNameEl) deleteNameEl.textContent = sp ? sp.name : 'this sponsor';
      window.openModal && window.openModal('delete-sponsor-modal');
    });
    if (deleteConfirmEl) {
      deleteConfirmEl.addEventListener('click', function () {
        if (!pendingDeleteId) return;
        const idx = window.MOCK_DATA.sponsors.findIndex(function (s) { return s.id === pendingDeleteId; });
        if (idx === -1) { window.closeModal && window.closeModal('delete-sponsor-modal'); return; }
        const name = window.MOCK_DATA.sponsors[idx].name;
        window.MOCK_DATA.sponsors.splice(idx, 1);
        window.AdminShell.logActivity('sponsor.deleted', name, 'Sponsor removed from database');
        window.toast && window.toast({ type: 'success', title: 'Deleted', message: name });
        pendingDeleteId = null;
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

    // Populate the industry dropdown from the canonical list, defaulting to
    // "Other" — the same source the sponsor form uses, so codes stay in sync.
    if (annexIndustry) {
      window.MOCK_DATA.industries.forEach(function (ind) {
        const opt = document.createElement('option');
        opt.value = ind.code;
        opt.textContent = ind.display_name;
        annexIndustry.appendChild(opt);
      });
      annexIndustry.value = 'other';
    }

    if (annexAddBtn && annexForm) {
      annexAddBtn.addEventListener('click', function () {
        annexForm.reset();
        if (annexIndustry) annexIndustry.value = 'other';
        window.openModal && window.openModal('annex-b-modal');
      });

      annexForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const name = annexName.value.trim();
        const date = annexDate.value;
        if (!name) {
          window.toast && window.toast({ type: 'error', title: 'Name required', message: 'Enter the company name.' });
          annexName.focus();
          return;
        }
        if (!date) {
          window.toast && window.toast({ type: 'error', title: 'Contract end date required', message: 'Pick when the contract ends.' });
          annexDate.focus();
          return;
        }
        addAnnexBPartner(name, date, annexIndustry ? annexIndustry.value : 'other', annexNotes ? annexNotes.value.trim() : '');
        window.closeModal && window.closeModal('annex-b-modal');
      });
    }

    // ----------------- boot -----------------
    renderCapAlert();
    renderAnnexes();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
