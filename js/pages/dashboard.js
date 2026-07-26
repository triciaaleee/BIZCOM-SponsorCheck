/* ============================================================
   js/pages/dashboard.js
   Renders the Sponsor Directory:
   - 15 industry category cards
   - Browseable banned / closed / alumni tables with search
   ============================================================ */

(function () {
  'use strict';

  // Map industry code to icon + short description + examples
  const INDUSTRY_META = {
    food_beverage:         { icon: 'bi-cup-hot-fill',          tone: 'navy',   examples: 'e.g. KOI, Starbucks, Subway' },
    apparel_accessories:   { icon: 'bi-bag-fill',              tone: 'navy',   examples: 'e.g. Uniqlo, Charles & Keith, Adidas' },
    beauty_personal_care:  { icon: 'bi-stars',                 tone: 'gold',   examples: 'e.g. Watsons, Sephora, The Body Shop' },
    entertainment_leisure: { icon: 'bi-film',                  tone: 'gold',   examples: 'e.g. Cathay Cineplexes, Timezone' },
    activities_experiences:{ icon: 'bi-controller',            tone: 'green',  examples: 'e.g. Climb Central, Boulder Planet, Xcape' },
    tech_electronics:      { icon: 'bi-cpu-fill',              tone: 'navy',   examples: 'e.g. Razer, Logitech, Challenger' },
    education_services:    { icon: 'bi-mortarboard-fill',      tone: 'navy',   examples: 'e.g. tuition centres, learning studios' },
    health_wellness:       { icon: 'bi-heart-pulse-fill',      tone: 'green',  examples: 'e.g. Anytime Fitness, ClassPass, yoga studios' },
    transport_mobility:    { icon: 'bi-truck',                 tone: 'orange', examples: 'e.g. Grab, GetGo, SG Bike' },
    home_lifestyle:        { icon: 'bi-house-heart-fill',      tone: 'gold',   examples: 'e.g. MUJI, IKEA, Daiso' },
    professional_services: { icon: 'bi-briefcase-fill',        tone: 'navy',   examples: 'e.g. consulting, legal, accounting' },
    media_publishing:      { icon: 'bi-newspaper',             tone: 'gold',   examples: 'e.g. magazines, podcasts, content houses' },
    non_profit_government: { icon: 'bi-building',              tone: 'orange', examples: 'e.g. NGOs, statutory boards (route via OAR)' },
    retail_general:        { icon: 'bi-shop',                  tone: 'navy',   examples: 'e.g. department stores, general retail' },
    other:                 { icon: 'bi-three-dots',            tone: 'navy',   examples: 'anything else, BIZCOM will reclassify' }
  };

  function renderIndustries() {
    const grid = document.getElementById('industries-grid');
    if (!grid) return;
    const industries = window.MOCK_DATA.industries;

    grid.innerHTML = industries.map(function (ind) {
      const meta = INDUSTRY_META[ind.code] || { icon: 'bi-tag', tone: 'navy', examples: '' };
      return (
        '<div class="industry-card industry-card--' + meta.tone + '">' +
          '<div class="industry-card__icon"><i class="bi ' + meta.icon + '"></i></div>' +
          '<div class="industry-card__body">' +
            '<div class="industry-card__name">' + escapeHtml(ind.display_name) + '</div>' +
            '<code class="industry-card__code">' + escapeHtml(ind.code) + '</code>' +
            (meta.examples ? '<div class="industry-card__examples">' + escapeHtml(meta.examples) + '</div>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  // -- Restricted sponsors tabs and table --

  let activeTab = 'banned';

  function getIndustryDisplay(code) {
    const ind = window.MOCK_DATA.industries.find(function (i) { return i.code === code; });
    return ind ? ind.display_name : code;
  }

  function rowsForTab(tab) {
    const all = window.MOCK_DATA.sponsors;
    if (tab === 'banned') return all.filter(function (s) { return s.category === 'banned'; });
    if (tab === 'closed') return all.filter(function (s) { return s.category === 'closed'; });
    if (tab === 'alumni') return all.filter(function (s) { return s.category === 'alumni'; });
    return [];
  }

  function reasonFor(sponsor, tab) {
    if (tab === 'banned') return sponsor.ban_reason || 'On the banned list';
    if (tab === 'closed') return sponsor.notes || 'Ceased operations';
    if (tab === 'alumni') return sponsor.alumni_owner ? ('Owned by ' + sponsor.alumni_owner) : 'Alumni-affiliated, OAR clearance needed';
    return '';
  }

  function updateCounts() {
    const elBanned = document.getElementById('count-banned');
    const elClosed = document.getElementById('count-closed');
    const elAlumni = document.getElementById('count-alumni');
    if (elBanned) elBanned.textContent = rowsForTab('banned').length;
    if (elClosed) elClosed.textContent = rowsForTab('closed').length;
    if (elAlumni) elAlumni.textContent = rowsForTab('alumni').length;
  }

  function updateReasonHeader() {
    const h = document.getElementById('reason-col-header');
    if (!h) return;
    if (activeTab === 'banned') h.textContent = 'Reason';
    else if (activeTab === 'closed') h.textContent = 'Status';
    else if (activeTab === 'alumni') h.textContent = 'Affiliation';
  }

  function renderRestricted() {
    const tbody = document.getElementById('restricted-tbody');
    const empty = document.getElementById('restricted-empty');
    if (!tbody) return;

    const rows = rowsForTab(activeTab);

    if (!rows.length) {
      tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    tbody.innerHTML = rows.map(function (s) {
      const pill = pillFor(activeTab);
      return (
        '<tr>' +
          '<td>' +
            '<div class="restricted-table__name">' + escapeHtml(s.name) + '</div>' +
            '<div class="restricted-table__pill">' + pill + '</div>' +
          '</td>' +
          '<td class="restricted-table__industry">' + escapeHtml(getIndustryDisplay(s.industry)) + '</td>' +
          '<td class="restricted-table__reason">' + escapeHtml(reasonFor(s, activeTab)) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function pillFor(tab) {
    if (tab === 'banned') return '<span class="pill pill--blocked"><i class="bi bi-x-circle-fill pill__icon"></i>Blocked</span>';
    if (tab === 'closed') return '<span class="pill pill--blocked"><i class="bi bi-slash-circle-fill pill__icon"></i>Closed</span>';
    if (tab === 'alumni') return '<span class="pill pill--alumni"><i class="bi bi-mortarboard-fill pill__icon"></i>Alumni</span>';
    return '';
  }

  function bindTabs() {
    const tabs = document.querySelectorAll('.restricted-tab');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.forEach(function (b) {
          b.classList.remove('is-active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
        activeTab = btn.getAttribute('data-tab');
        updateReasonHeader();
        renderRestricted();
      });
    });
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Boot when DOM ready and MOCK_DATA loaded
  function boot() {
    if (!window.MOCK_DATA) {
      // mock-data.js loads with defer too; wait one frame
      requestAnimationFrame(boot);
      return;
    }
    renderIndustries();
    updateCounts();
    updateReasonHeader();
    renderRestricted();
    bindTabs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
