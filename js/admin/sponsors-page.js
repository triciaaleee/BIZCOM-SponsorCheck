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
    let activeStatus = 'all';
    let searchQuery = '';
    let industryFilter = 'all';

    // ----------------- elements -----------------
    const tbody = document.getElementById('sponsors-tbody');
    const empty = document.getElementById('sponsors-empty');
    const emptyTitle = document.getElementById('sponsors-empty-title');
    const emptySub = document.getElementById('sponsors-empty-sub');
    const countEl = document.getElementById('sponsors-count');
    const tabs = document.querySelectorAll('.admin-tab');
    const searchInput = document.getElementById('sponsors-search-input');
    const industrySel = document.getElementById('sponsors-industry-filter');

    // Populate industry dropdown
    window.MOCK_DATA.industries.forEach(function (ind) {
      const opt = document.createElement('option');
      opt.value = ind.code;
      opt.textContent = ind.display_name;
      industrySel.appendChild(opt);
    });

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
      const labels = { master: 'Master', banned: 'Banned', closed: 'Closed', alumni: 'Alumni' };
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

      const esc = window.AdminShell.escapeHtml;

      tbody.innerHTML = rows.map(function (s) {
        const notes = notesFor(s);
        return (
          '<tr>' +
            '<td><div class="table__cell-primary">' + esc(s.name) + '</div></td>' +
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
    }

    // ----------------- wire events -----------------
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        activeStatus = btn.getAttribute('data-status');
        render();
      });
    });

    searchInput.addEventListener('input', function (e) {
      searchQuery = e.target.value || '';
      render();
    });

    industrySel.addEventListener('change', function (e) {
      industryFilter = e.target.value;
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
