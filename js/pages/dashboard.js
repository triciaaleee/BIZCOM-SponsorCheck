/* ============================================================
   js/pages/dashboard.js
   Renders the Sponsor Directory:
   - 15 industry category cards
   - Browseable prohibited / closed / alumni tables with search

   Reads live from window.PublicData (Supabase, anon-readable).
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

  // The 15 sponsor categories are fixed reference data, so they are hardcoded
  // here (mirrors supabase/migrations/0002_seed.sql) instead of fetched at boot.
  // The category cards then render instantly without a Supabase round-trip.
  const industries = [
    { code: 'food_beverage',          display_name: 'Food & Beverage',          sort_order: 1 },
    { code: 'apparel_accessories',    display_name: 'Apparel & Accessories',    sort_order: 2 },
    { code: 'beauty_personal_care',   display_name: 'Beauty & Personal Care',   sort_order: 3 },
    { code: 'entertainment_leisure',  display_name: 'Entertainment & Leisure',  sort_order: 4 },
    { code: 'activities_experiences', display_name: 'Activities & Experiences', sort_order: 5 },
    { code: 'tech_electronics',       display_name: 'Tech & Electronics',       sort_order: 6 },
    { code: 'education_services',     display_name: 'Education & Services',      sort_order: 7 },
    { code: 'health_wellness',        display_name: 'Health & Wellness',         sort_order: 8 },
    { code: 'transport_mobility',     display_name: 'Transport & Mobility',      sort_order: 9 },
    { code: 'home_lifestyle',         display_name: 'Home & Lifestyle',         sort_order: 10 },
    { code: 'professional_services',  display_name: 'Professional Services',    sort_order: 11 },
    { code: 'media_publishing',       display_name: 'Media & Publishing',       sort_order: 12 },
    { code: 'non_profit_government',  display_name: 'Non-profit & Government',  sort_order: 13 },
    { code: 'retail_general',         display_name: 'Retail (General)',         sort_order: 14 },
    { code: 'other',                  display_name: 'Other / Uncategorised',    sort_order: 15 }
  ];

  // Live data (loaded from Supabase at boot).
  let sponsors = [];
  let annexCategories = [];

  function todayISO() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  const todayStr = todayISO();

  function renderIndustries() {
    const grid = document.getElementById('industries-grid');
    if (!grid) return;

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

  // -- Annex B / Closed / Alumni reference cards --
  // The public page names companies as a plain reference list only. It never
  // labels them "prohibited" and never shows contract dates — just the company
  // names, so an external reader can't infer anything negative from the page.

  // Annex B partners come from the partner category, not from "has a
  // contract_ends date". The date was only ever a proxy for the category, and
  // it quietly dropped any partner recorded without an end date.
  //
  // A missing contract_ends means an open-ended partnership, so it counts as
  // live. That matches isLiveContract() in matcher-core.js, which decides the
  // same question for the checker; the two must not disagree about who is
  // restricted. Lapsed partners drop off: they are no longer restricted.
  function annexBPartners() {
    const cat = annexCatsFor('B').filter(isPartnerCategory)[0];
    if (!cat) return [];
    return sponsors.filter(function (s) {
      if (s.annex_category_id !== cat.id) return false;
      return !s.contract_ends || String(s.contract_ends) >= todayStr;
    });
  }

  function renderNameList(containerId, rows, emptyMsg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="annex-empty">' + escapeHtml(emptyMsg) + '</div>';
      return;
    }
    el.innerHTML = '<ul class="annex-list">' + rows.map(function (s) {
      return '<li>' + escapeHtml(s.name) + '</li>';
    }).join('') + '</ul>';
  }

  // -- Annex A --
  // Both annex cards have the same two halves, now read from Supabase instead
  // of being typed into the markup: one named category listed company by
  // company, and the type-level restrictions as tags underneath.
  //
  // Which category gets named is editorial, not structural. Annex A names the
  // Board of Trustees because the standing order does; the other Annex A
  // entries ban a whole type, so their members are not listed. Annex B names
  // BIZCOM's own partners for the same reason. Nothing in the data marks that
  // distinction, so these two are matched by name. If either is renamed in the
  // admin, its list renders empty and the category joins the tag row instead,
  // which is wrong but not misleading.
  const TRUSTEES_CATEGORY = 'board of trustees';
  const PARTNER_CATEGORY  = 'bizcom partner';

  function annexCatsFor(letter) {
    return annexCategories
      .filter(function (c) { return c.annex === letter; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  }

  function nameIs(target) {
    return function (c) { return String(c.name || '').trim().toLowerCase() === target; };
  }
  const isTrusteesCategory = nameIs(TRUSTEES_CATEGORY);
  const isPartnerCategory  = nameIs(PARTNER_CATEGORY);

  function trusteeCompanies() {
    const cat = annexCatsFor('A').filter(isTrusteesCategory)[0];
    if (!cat) return [];
    return sponsors.filter(function (s) { return s.annex_category_id === cat.id; });
  }

  // Annex B types the Standing Order lists but annex_categories deliberately
  // does not hold. SMU Alumni is restricted on paper, yet a company is filed
  // under the top-level 'alumni' sponsor category rather than under an annex
  // category, so there is no row for it to render from. Hardcoded here so the
  // card still lists what the Standing Order lists. Keep in step with the same
  // constant in js/admin/sponsors-page.js.
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
      return '<span class="annex-tag">' + escapeHtml(n) + '</span>';
    }).join('');
  }

  // The Closed and Alumni cards stay as static notes: they describe the
  // restriction without naming any specific company.
  function renderReferenceCards() {
    renderNameList('public-annex-a-trustees', trusteeCompanies(),
      'No companies currently listed.');
    renderAnnexTags('public-annex-a-tags', 'A', isTrusteesCategory);

    renderNameList('public-annex-b-list', annexBPartners(),
      'No partner companies currently under contract.');
    renderAnnexTags('public-annex-b-tags', 'B', isPartnerCategory);
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

  // Boot: category cards are hardcoded, so render them immediately. Only the
  // restricted sponsor tables need live data from Supabase.
  function boot() {
    renderIndustries();

    if (!window.sbPublic || !window.PublicData) {
      requestAnimationFrame(boot);
      return;
    }
    Promise.all([
      window.PublicData.allSponsors(),
      window.PublicData.listAnnexCategories()
    ])
      .then(function (out) { sponsors = out[0] || []; annexCategories = out[1] || []; })
      .catch(function (e) {
        console.error('[dashboard] could not load the annex data', e);
        sponsors = []; annexCategories = [];
      })
      .then(function () {
        renderReferenceCards();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
