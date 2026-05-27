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
    let activeStatus = 'all';
    let searchQuery = '';
    let industryFilter = 'all';
    let currentPage = 1;

    // ----------------- elements -----------------
    const tbody = document.getElementById('sponsors-tbody');
    const empty = document.getElementById('sponsors-empty');
    const emptyTitle = document.getElementById('sponsors-empty-title');
    const emptySub = document.getElementById('sponsors-empty-sub');
    const countEl = document.getElementById('sponsors-count');
    const tabs = document.querySelectorAll('.admin-tab');
    const searchInput = document.getElementById('sponsors-search-input');
    const industrySel = document.getElementById('sponsors-industry-filter');
    const welcomeName = document.getElementById('welcome-name');
    const kpiDueSoon = document.getElementById('kpi-due-soon');
    const kpiAtCap = document.getElementById('kpi-at-cap');
    const kpiNewSubs = document.getElementById('kpi-new-subs');
    const pager = document.getElementById('sponsors-pager');
    const pagerNav = document.getElementById('sponsors-pager-nav');
    const pagerRange = document.getElementById('sponsors-range');

    // Populate industry dropdown
    window.MOCK_DATA.industries.forEach(function (ind) {
      const opt = document.createElement('option');
      opt.value = ind.code;
      opt.textContent = ind.display_name;
      industrySel.appendChild(opt);
    });

    // Welcome card greeting and KPIs.
    function renderWelcome() {
      // Local-part of email as a friendly name fallback.
      welcomeName.textContent = session.email.split('@')[0];

      const subs = window.MOCK_DATA.submissions || [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const weekEnd = new Date(today.getTime() + 7 * 86400000);

      const dueSoon = subs.filter(function (s) {
        if (s.status === 'completed' || !s.complete_by) return false;
        const d = new Date(s.complete_by);
        return d.getTime() <= weekEnd.getTime();
      }).length;

      const newSubs = subs.filter(function (s) { return s.status === 'new'; }).length;

      const cap = (window.MOCK_DATA.settings && window.MOCK_DATA.settings.outreach_cap_per_30d) || 10;
      const counts = window.MOCK_DATA.outreachCounts || {};
      const atCap = Object.keys(counts).filter(function (id) {
        return counts[id] >= cap - 2;
      }).length;

      kpiDueSoon.textContent = dueSoon;
      kpiAtCap.textContent = atCap;
      kpiNewSubs.textContent = newSubs;
    }
    renderWelcome();

    // ----------------- helpers -----------------
    const STATUS_TO_CATEGORY = {
      master:   'master',
      banned:   'banned',
      closed:   'closed',
      alumni:   'alumni'
    };

    function industryDisplay(code) {
      const ind = window.MOCK_DATA.industries.find(function (i) { return i.code === code; });
      return ind ? ind.display_name : code;
    }

    function statusPill(category) {
      const labels = { master: 'Approved', banned: 'Banned', closed: 'Closed', alumni: 'Alumni' };
      const cls = 'status-pill--' + category;
      return '<span class="status-pill ' + cls + '">' + (labels[category] || category) + '</span>';
    }

    function lastUpdatedFor(sponsorId) {
      // Walk activity log for the latest entry matching this sponsor name.
      // (In a real backend this would be sponsor.updated_at; here we synthesise.)
      const sponsor = window.MOCK_DATA.sponsors.find(function (s) { return s.id === sponsorId; });
      if (!sponsor) return '';
      const log = window.MOCK_DATA.activity.find(function (a) {
        return (a.entity === sponsor.name) && a.action.indexOf('sponsor.') === 0;
      });
      if (!log) return '';
      return formatDateShort(log.at) + ', by ' + log.actor.split('@')[0] + '@';
    }

    function formatDateShort(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return d.getDate() + ' ' + months[d.getMonth()];
    }

    function notesFor(sponsor) {
      if (sponsor.category === 'banned' && sponsor.ban_reason) return sponsor.ban_reason;
      if (sponsor.category === 'alumni' && sponsor.alumni_owner) return sponsor.alumni_owner;
      return sponsor.notes || '';
    }

    // ----------------- render -----------------
    function getFilteredSponsors() {
      const all = window.MOCK_DATA.sponsors;
      const q = searchQuery.trim().toLowerCase();
      return all.filter(function (s) {
        if (activeStatus !== 'all' && s.category !== STATUS_TO_CATEGORY[activeStatus]) return false;
        if (industryFilter !== 'all' && s.industry !== industryFilter) return false;
        if (q && s.name.toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
    }

    function renderCounts() {
      const all = window.MOCK_DATA.sponsors;
      const counts = {
        all: all.length,
        master: 0, banned: 0, closed: 0, alumni: 0
      };
      all.forEach(function (s) {
        if (counts[s.category] !== undefined) counts[s.category]++;
      });
      Object.keys(counts).forEach(function (k) {
        const el = document.getElementById('tab-count-' + k);
        if (el) el.textContent = counts[k];
      });
    }

    function render() {
      const rows = getFilteredSponsors();
      countEl.textContent = rows.length;

      if (rows.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = '';
        pager.hidden = true;
        if (searchQuery || industryFilter !== 'all' || activeStatus !== 'all') {
          emptyTitle.textContent = 'No sponsors match';
          emptySub.textContent = 'Try clearing your filters or search term.';
        } else {
          emptyTitle.textContent = 'No sponsors yet';
          emptySub.textContent = 'Add your first sponsor to get started.';
        }
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
            '<td><span class="table__cell-secondary">' + esc(lastUpdatedFor(s.id)) + '</span></td>' +
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
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        activeStatus = btn.getAttribute('data-status');
        currentPage = 1;
        render();
      });
    });

    searchInput.addEventListener('input', function (e) {
      searchQuery = e.target.value || '';
      currentPage = 1;
      render();
    });

    industrySel.addEventListener('change', function (e) {
      industryFilter = e.target.value;
      currentPage = 1;
      render();
    });

    // ----------------- boot -----------------
    renderCounts();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
