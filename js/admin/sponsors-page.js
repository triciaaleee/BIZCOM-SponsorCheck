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
    let currentPage = 1;

    // ----------------- elements -----------------
    const tbody = document.getElementById('sponsors-tbody');
    const empty = document.getElementById('sponsors-empty');
    const emptyTitle = document.getElementById('sponsors-empty-title');
    const emptySub = document.getElementById('sponsors-empty-sub');
    const countEl = document.getElementById('sponsors-count');
    const searchInput = document.getElementById('sponsors-search-input');
    const pager = document.getElementById('sponsors-pager');
    const pagerNav = document.getElementById('sponsors-pager-nav');
    const pagerRange = document.getElementById('sponsors-range');

    // ----------------- helpers -----------------
    function industryDisplay(code) {
      const ind = window.MOCK_DATA.industries.find(function (i) { return i.code === code; });
      return ind ? ind.display_name : code;
    }

    function statusPill(category) {
      const labels = { master: 'Approved', banned: 'Banned', closed: 'Closed', alumni: 'Alumni' };
      const cls = 'status-pill--' + category;
      return '<span class="status-pill ' + cls + '">' + (labels[category] || category) + '</span>';
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
    function getFilteredSponsors() {
      const all = window.MOCK_DATA.sponsors;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [];
      return all.filter(function (s) {
        // Lapsed Annex B partners are dormant history — they live only in the
        // Annex B panel (for removal), not the active sponsor list.
        if (window.Bans.isExpired(s)) return false;
        return s.name.toLowerCase().indexOf(q) !== -1;
      });
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

    // Annex A reference (static policy from MOCK_DATA.annexA).
    function renderAnnexA() {
      const esc = window.AdminShell.escapeHtml;
      const a = window.MOCK_DATA.annexA;
      const aEl = document.getElementById('annex-a-body');
      if (!aEl || !a) return;
      let html =
        '<div class="annex-group__label">' + esc(a.trustees.label) + '</div>' +
        '<div class="annex-group__companies">' + a.trustees.companies.map(esc).join(', ') + '</div>' +
        '<dl class="annex-rows">' +
          a.examples.map(function (c) {
            return '<dt>' + esc(c.label) + '</dt><dd>' + c.companies.map(esc).join(', ') + '</dd>';
          }).join('') +
        '</dl>';
      if (a.blanket && a.blanket.length) {
        html += '<div class="annex-blanket">Blanket bans (no list): ' + a.blanket.map(esc).join(' · ') + '</div>';
      }
      aEl.innerHTML = html;
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
          '<span class="annex-partner__name">' + esc(p.name) + '</span>' +
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

    function addAnnexBPartner(name, dateStr) {
      const sponsor = {
        id: 'b-' + Date.now().toString(36),
        name: name,
        normalised: normaliseName(name),
        industry: 'other',
        category: 'banned',
        ban_reason: 'Annex B, BIZCOM partner',
        notes: '',
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

    // The list is search-driven: nothing is shown until the admin types a search
    // term. Keeps the page fast and uncluttered as the database grows.
    function hasActiveQuery() {
      return searchQuery.trim() !== '';
    }

    function render() {
      if (!hasActiveQuery()) {
        tbody.innerHTML = '';
        countEl.textContent = 0;
        pager.hidden = true;
        empty.style.display = '';
        empty.classList.add('empty-card--search');
        emptyTitle.textContent = 'Search the sponsor list';
        emptySub.textContent = 'Type a company name to see matching sponsors.';
        return;
      }
      empty.classList.remove('empty-card--search');

      const rows = getFilteredSponsors();
      countEl.textContent = rows.length;

      if (rows.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = '';
        pager.hidden = true;
        emptyTitle.textContent = 'No sponsors match';
        emptySub.textContent = 'Try a different name.';
        return;
      }

      empty.style.display = 'none';

      const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const start = (currentPage - 1) * PAGE_SIZE;
      const pageRows = rows.slice(start, start + PAGE_SIZE);

      const esc = window.AdminShell.escapeHtml;
      const mapsLink = window.AdminShell.mapsLink;

      tbody.innerHTML = pageRows.map(function (s) {
        const notes = notesFor(s);
        return (
          '<tr>' +
            '<td><div class="table__cell-primary">' + mapsLink(s.name) + '</div></td>' +
            '<td>' + statusPill(s.category) + '</td>' +
            '<td><span class="text-sm text-secondary">' + esc(industryDisplay(s.industry)) + '</span></td>' +
            '<td><div class="table__cell-secondary truncate" title="' + esc(notes) + '">' + esc(notes) + '</div></td>' +
            '<td>' +
              '<a href="sponsor.html?id=' + encodeURIComponent(s.id) + '" class="table__action" title="Edit">' +
                '<i class="bi bi-pencil-fill"></i>' +
              '</a>' +
            '</td>' +
          '</tr>'
        );
      }).join('');

      renderPager(rows.length, totalPages, start);
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
    searchInput.addEventListener('input', function (e) {
      searchQuery = e.target.value || '';
      currentPage = 1;
      render();
    });

    // Annex B add-partner form (name + contract end date).
    const annexAddBtn = document.getElementById('annex-b-add-btn');
    const annexForm = document.getElementById('annex-b-form');
    const annexName = document.getElementById('annex-b-name');
    const annexDate = document.getElementById('annex-b-date');
    const annexCancel = document.getElementById('annex-b-cancel');

    function toggleAnnexForm(show) {
      annexForm.hidden = !show;
      if (show) { annexName.value = ''; annexDate.value = ''; annexName.focus(); }
    }

    if (annexAddBtn && annexForm) {
      annexAddBtn.addEventListener('click', function () { toggleAnnexForm(annexForm.hidden); });
      annexCancel.addEventListener('click', function () { toggleAnnexForm(false); });
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
        addAnnexBPartner(name, date);
        toggleAnnexForm(false);
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
