/* ============================================================
   js/lib/mock-data.js
   Placeholder sponsor data. Replace with Supabase queries in Phase 1.
   Mirrors the structure from PRD §13 data model.
   ============================================================ */

window.MOCK_DATA = {
  // 15 canonical industries per PRD §11.1
  industries: [
    { code: 'food_beverage',         display_name: 'Food & Beverage' },
    { code: 'apparel_accessories',   display_name: 'Apparel & Accessories' },
    { code: 'beauty_personal_care',  display_name: 'Beauty & Personal Care' },
    { code: 'entertainment_leisure', display_name: 'Entertainment & Leisure' },
    { code: 'activities_experiences', display_name: 'Activities & Experiences' },
    { code: 'tech_electronics',      display_name: 'Tech & Electronics' },
    { code: 'education_services',    display_name: 'Education & Services' },
    { code: 'health_wellness',       display_name: 'Health & Wellness' },
    { code: 'transport_mobility',    display_name: 'Transport & Mobility' },
    { code: 'home_lifestyle',        display_name: 'Home & Lifestyle' },
    { code: 'professional_services', display_name: 'Professional Services' },
    { code: 'media_publishing',      display_name: 'Media & Publishing' },
    { code: 'non_profit_government', display_name: 'Non-profit & Government' },
    { code: 'retail_general',        display_name: 'Retail (General)' },
    { code: 'other',                 display_name: 'Other / Uncategorised' }
  ],

  // Sample sponsors covering each status category
  sponsors: [
    // master (approved)
    { id: 's1',  name: 'KOI',               normalised: 'koi',              industry: 'food_beverage',         category: 'master',    notes: '' },
    { id: 's2',  name: 'LiHO TEA',          normalised: 'liho tea',         industry: 'food_beverage',         category: 'master',    notes: '' },
    { id: 's3',  name: 'Starbucks',         normalised: 'starbucks',        industry: 'food_beverage',         category: 'master',    notes: '' },
    { id: 's4',  name: 'Subway',            normalised: 'subway',           industry: 'food_beverage',         category: 'master',    notes: '' },
    { id: 's5',  name: 'Uniqlo',            normalised: 'uniqlo',           industry: 'apparel_accessories',   category: 'master',    notes: '' },
    { id: 's6',  name: 'Charles & Keith',   normalised: 'charles and keith',industry: 'apparel_accessories',   category: 'master',    notes: '' },
    { id: 's7',  name: 'Watsons',           normalised: 'watsons',          industry: 'beauty_personal_care',  category: 'master',    notes: '' },
    { id: 's8',  name: 'Sephora',           normalised: 'sephora',          industry: 'beauty_personal_care',  category: 'master',    notes: '' },
    { id: 's9',  name: 'Razer',             normalised: 'razer',            industry: 'tech_electronics',      category: 'master',    notes: '' },
    { id: 's10', name: 'Logitech',          normalised: 'logitech',         industry: 'tech_electronics',      category: 'master',    notes: '' },
    { id: 's11', name: 'Grab',              normalised: 'grab',             industry: 'transport_mobility',    category: 'master',    notes: '' },
    { id: 's12', name: 'MUJI',              normalised: 'muji',             industry: 'home_lifestyle',        category: 'master',    notes: '' },
    { id: 's13', name: 'Climb Central',     normalised: 'climb central',    industry: 'activities_experiences',category: 'master',    notes: '' },
    { id: 's14', name: 'BoulderPlus',       normalised: 'boulderplus',      industry: 'activities_experiences',category: 'master',    notes: '' },
    { id: 's15', name: 'Cathay Cineplexes', normalised: 'cathay cineplexes',industry: 'entertainment_leisure', category: 'master',    notes: '' },

    // banned per Annex A / B
    { id: 's20', name: 'Singapore Pools',    normalised: 'singapore pools',  industry: 'entertainment_leisure', category: 'banned',    ban_reason: 'Annex A, Gaming & Betting' },
    { id: 's21', name: 'Asia Pacific Breweries', normalised: 'asia pacific breweries', industry: 'food_beverage', category: 'banned', ban_reason: 'Annex A, Alcoholic Products' },
    { id: 's22', name: 'Marlboro',           normalised: 'marlboro',         industry: 'retail_general',        category: 'banned',    ban_reason: 'Annex A, Tobacco Products' },
    { id: 's23', name: 'Durex',              normalised: 'durex',            industry: 'beauty_personal_care',  category: 'banned',    ban_reason: 'Annex A, Sexual Products' },
    { id: 's24', name: 'AIA Insurance',      normalised: 'aia insurance',    industry: 'professional_services', category: 'banned',    ban_reason: 'Annex A, Insurance Companies' },
    { id: 's25', name: 'Prudential',         normalised: 'prudential',       industry: 'professional_services', category: 'banned',    ban_reason: 'Annex A, Insurance Companies' },
    { id: 's26', name: 'Shaw Foundation',    normalised: 'shaw foundation',  industry: 'non_profit_government', category: 'banned',    ban_reason: 'Annex A, Foundations' },
    { id: 's27', name: 'Lee Foundation',     normalised: 'lee foundation',   industry: 'non_profit_government', category: 'banned',    ban_reason: 'Annex A, Foundations' },
    { id: 's28', name: 'DBS Bank',           normalised: 'dbs bank',         industry: 'professional_services', category: 'banned',    ban_reason: 'Annex B, Banks & Financial' },
    { id: 's29', name: 'OCBC Bank',          normalised: 'ocbc bank',        industry: 'professional_services', category: 'banned',    ban_reason: 'Annex B, Banks & Financial' },

    // closed / defunct
    { id: 's40', name: 'Robinsons',          normalised: 'robinsons',        industry: 'retail_general',        category: 'closed',    notes: 'Ceased operations 2020' },
    { id: 's41', name: 'Crystal Jade Express',normalised:'crystal jade express',industry:'food_beverage',       category: 'closed',    notes: 'Brand discontinued 2023' },

    // alumni
    { id: 's50', name: 'Tea Tribe',          normalised: 'tea tribe',        industry: 'food_beverage',         category: 'alumni',    alumni_owner: 'Wong YJ, BBM 2019' },
    { id: 's51', name: 'Crave Bakery',       normalised: 'crave bakery',     industry: 'food_beverage',         category: 'alumni',    alumni_owner: 'Tan ML, ACCT 2017' },
    { id: 's52', name: 'Loop Studio',        normalised: 'loop studio',      industry: 'activities_experiences',category: 'alumni',    alumni_owner: 'Kumar A, ISIT 2020' },

    // Annex B — BIZCOM collaboration partners. Modelled as banned sponsors with a
    // contract_ends date (permanent bans have contract_ends = null). Blocked while
    // the contract is active; once it lapses they drop out of the banned set.
    // These two are demo placeholders (one active, one lapsed) — dates seeded at
    // the bottom of this file. Replace with the real partner list.
    { id: 'b1', name: 'Aurora Events Co',     normalised: 'aurora events co', industry: 'entertainment_leisure', category: 'banned', ban_reason: 'Annex B, BIZCOM partner', contract_ends: null },
    { id: 'b2', name: 'Legacy Media Pte Ltd', normalised: 'legacy media',     industry: 'media_publishing',      category: 'banned', ban_reason: 'Annex B, BIZCOM partner', contract_ends: null }
  ],

  // Per-sponsor outreach state, keyed by sponsor id. This is a CUMULATIVE
  // running count (not a rolling 30-day window): each admin-logged outreach
  // adds 1. When count reaches settings.outreach_cap a cooldown starts
  // (cooldown_started_at is stamped); once settings.cooldown_days elapse the
  // count resets to 0 and the company is contactable again. Derivation lives
  // in window.Caps below so the rule sits in one place.
  //   count never exceeds the cap; a company at the cap has cooldown_started_at set.
  outreach: {
    's1':  { count: 9,  cooldown_started_at: null },  // KOI, one short of the cap
    's2':  { count: 10, cooldown_started_at: null },  // LiHO, at cap (date seeded below)
    's3':  { count: 3,  cooldown_started_at: null },
    's4':  { count: 1,  cooldown_started_at: null },
    's5':  { count: 4,  cooldown_started_at: null },
    's11': { count: 10, cooldown_started_at: null },  // Grab, at cap (date seeded below)
    's15': { count: 2,  cooldown_started_at: null }
  },

  settings: {
    outreach_cap:     10,   // contacts allowed before a cooldown starts
    cooldown_days:    30,   // cooldown length; count resets to 0 when it ends
    event_cap_small:  300,
    event_cap_medium: 600,
    event_cap_large:  1000
  },

  // ---- Sponsorship Standing Order, Annex A (prohibited) ----
  // Companies/types that must NEVER be approached. Transcribed from the PDF.
  annexA: {
    trustees: {
      label: 'SMU Board of Trustees & associated',
      companies: [
        'Banyan Tree Group', 'Global Business Integrators', 'Reed Exhibitions',
        'Hup Soon Global Corporation', 'Singapore Telecommunications (Singtel)',
        'Chinatrust Commercial Bank', 'Kuok (S)', 'Raffles Medical Corp',
        'Phoenix Advisers', 'Infosys Technologies', 'WongPartnership LLP', 'SMRT',
        'Bangkok Bank', 'Symphony Asia Holdings', 'Dane Court'
      ]
    },
    // Categories the PDF illustrates with example companies.
    examples: [
      { label: 'Foundations',     companies: ['Lee Foundation', 'Shaw Foundation', 'Tanoto Foundation'] },
      { label: 'Alcohol',         companies: ['Asia Pacific Breweries'] },
      { label: 'Tobacco',         companies: ['Marlboro'] },
      { label: 'Gaming & betting', companies: ['Singapore Pools'] },
      { label: 'Sexual products', companies: ['Durex'] }
    ],
    // Categories banned outright with no company list in the PDF.
    blanket: ['Insurance', 'Multi-level marketing', 'SMU Commencement sponsors']
  },
  // Annex B partners now live in the sponsors array (category 'banned' +
  // contract_ends); its static category notes are in sponsors.html.

  // Public dashboard placeholders
  dashboardStats: {
    total: 12403,
    master: 8821,
    banned: 218,
    alumni: 47,
    submissionsThisMonth: 142,
    inCooldown: 16
  },

  // ============================================================
  // ADMIN-SIDE MOCK DATA
  // Replaced by Supabase queries in Phase 2. All admin pages read
  // from these arrays so changes are visible across navigation
  // within the same browser session.
  // ============================================================

  // Registered admins. The super-admin seat transfers via the team
  // page (not built in v1 admin); for now the seat is fixed.
  admins: [
    { email: 'biz@sa.smu.edu.sg',          name: 'Tricia',       role: 'super_admin', added_at: '2026-01-01', added_by: 'system' },
    { email: 'biz.deputy@sa.smu.edu.sg',   name: 'Wei Jie',      role: 'admin',       added_at: '2026-01-04', added_by: 'biz@sa.smu.edu.sg' },
    { email: 'biz.outreach@sa.smu.edu.sg', name: 'Arjun',        role: 'admin',       added_at: '2026-02-12', added_by: 'biz@sa.smu.edu.sg' }
  ],

  // Submission inbox. Each row is one club's emailed sponsor list.
  // status: 'new' | 'reviewing' | 'completed'
  submissions: [
    {
      id: 'sub-001',
      event_name: 'Bizad Charity Run 2026',
      club: 'Accountancy Society',
      contact_email: 'charityrun@smu.edu.sg',
      event_size: 'medium',
      sponsor_count: 47,
      submitted_at: '2026-05-22T09:42:00+08:00',
      complete_by: '2026-06-05',
      status: 'new',
      reviewed_by: null,
      reviewed_at: null,
      notes: '',
      sponsor_list: [
        { name: 'KOI',               status: 'caution',    industry: 'food_beverage' },
        { name: 'LiHO TEA',         status: 'cooldown',   industry: 'food_beverage' },
        { name: 'Uniqlo',           status: 'clear',      industry: 'apparel_accessories' },
        { name: 'Tea Tribe',        status: 'alumni',     industry: 'food_beverage' },
        { name: 'Singapore Pools',  status: 'blocked',    industry: 'entertainment_leisure' },
        { name: 'Logitech',         status: 'clear',      industry: 'tech_electronics' },
        { name: 'Razer',            status: 'clear',      industry: 'tech_electronics' },
        { name: 'Climb Central',    status: 'clear',      industry: 'activities_experiences' }
      ]
    },
    {
      id: 'sub-002',
      event_name: 'Loop Music Festival',
      club: 'Music Interest Group',
      contact_email: 'mig.exco@smu.edu.sg',
      event_size: 'large',
      sponsor_count: 112,
      submitted_at: '2026-05-20T14:18:00+08:00',
      complete_by: '2026-05-28',
      status: 'reviewing',
      reviewed_by: 'biz.deputy@sa.smu.edu.sg',
      reviewed_at: '2026-05-21T10:05:00+08:00',
      notes: 'Flagged 4 alumni-affiliated sponsors back to club. Awaiting their revised list.',
      sponsor_list: [
        { name: 'Loop Studio',      status: 'alumni',     industry: 'activities_experiences' },
        { name: 'Crave Bakery',     status: 'alumni',     industry: 'food_beverage' },
        { name: 'Cathay Cineplexes',status: 'clear',      industry: 'entertainment_leisure' },
        { name: 'Sephora',          status: 'clear',      industry: 'beauty_personal_care' },
        { name: 'MUJI',             status: 'clear',      industry: 'home_lifestyle' }
      ]
    },
    {
      id: 'sub-003',
      event_name: 'Code Sprint 2026',
      club: 'SMU Tech',
      contact_email: 'smutech@smu.edu.sg',
      event_size: 'small',
      sponsor_count: 18,
      submitted_at: '2026-05-23T16:55:00+08:00',
      complete_by: '2026-05-24',
      status: 'new',
      reviewed_by: null,
      reviewed_at: null,
      notes: '',
      sponsor_list: [
        { name: 'Razer',            status: 'clear',      industry: 'tech_electronics' },
        { name: 'Logitech',         status: 'clear',      industry: 'tech_electronics' },
        { name: 'Challenger',       status: 'unverified', industry: 'tech_electronics' }
      ]
    },
    {
      id: 'sub-004',
      event_name: 'Freshmen Welcome Tea',
      club: 'School of Economics',
      contact_email: 'soe.welcome@smu.edu.sg',
      event_size: 'medium',
      sponsor_count: 32,
      submitted_at: '2026-05-15T11:30:00+08:00',
      complete_by: '2026-05-19',
      status: 'completed',
      reviewed_by: 'biz@sa.smu.edu.sg',
      reviewed_at: '2026-05-17T09:00:00+08:00',
      notes: 'Approved. Reminded club to coordinate with OAR on the 2 alumni sponsors before reaching out.',
      sponsor_list: [
        { name: 'KOI',               status: 'caution',    industry: 'food_beverage' },
        { name: 'Tea Tribe',        status: 'alumni',     industry: 'food_beverage' },
        { name: 'Watsons',          status: 'clear',      industry: 'beauty_personal_care' }
      ]
    },
    {
      id: 'sub-005',
      event_name: 'Hackathon 2026',
      club: 'SMU Tech',
      contact_email: 'smutech@smu.edu.sg',
      event_size: 'large',
      sponsor_count: 89,
      submitted_at: '2026-05-10T08:14:00+08:00',
      complete_by: '2026-05-15',
      status: 'completed',
      reviewed_by: 'biz.outreach@sa.smu.edu.sg',
      reviewed_at: '2026-05-12T15:42:00+08:00',
      notes: 'Approved with 3 sponsors removed (banned per Annex A/B).',
      sponsor_list: [
        { name: 'Grab',             status: 'cooldown',   industry: 'transport_mobility' },
        { name: 'Razer',            status: 'clear',      industry: 'tech_electronics' },
        { name: 'DBS Bank',         status: 'blocked',    industry: 'professional_services' }
      ]
    },
    {
      id: 'sub-006',
      event_name: 'Annual Dinner & Dance',
      club: 'Lifestyle, Sports & Recreation',
      contact_email: 'lsr.dnd@smu.edu.sg',
      event_size: 'large',
      sponsor_count: 156,
      submitted_at: '2026-05-08T20:11:00+08:00',
      complete_by: '2026-05-12',
      status: 'completed',
      reviewed_by: 'biz@sa.smu.edu.sg',
      reviewed_at: '2026-05-11T13:25:00+08:00',
      notes: 'Approved.',
      sponsor_list: []
    },
    {
      id: 'sub-007',
      event_name: 'Investment Conference',
      club: 'Finance Society',
      contact_email: 'finsoc@smu.edu.sg',
      event_size: 'medium',
      sponsor_count: 64,
      submitted_at: '2026-05-19T12:00:00+08:00',
      complete_by: '2026-06-10',
      status: 'reviewing',
      reviewed_by: 'biz@sa.smu.edu.sg',
      reviewed_at: '2026-05-20T08:30:00+08:00',
      notes: 'Reviewing alumni list overlaps with OAR.',
      sponsor_list: []
    }
  ]
};

// ============================================================
// OUTREACH CAP + COOLDOWN — derivation helper (window.Caps)
// Confirmed rule: each admin-logged outreach adds 1 to a company's running
// count. At settings.outreach_cap a cooldown of settings.cooldown_days days
// starts; once it elapses the count resets to 0 and the company reopens.
//
// Both the admin UI and the student matcher read cap state through here so
// the rule lives in exactly one place. When Supabase lands this is replaced
// by a view/RPC; the shape of state() stays the same.
// ============================================================
window.Caps = (function () {
  'use strict';

  var DAY_MS = 86400000;

  function settings() {
    return window.MOCK_DATA.settings || {};
  }

  function record(sponsorId) {
    var o = window.MOCK_DATA.outreach || {};
    return o[sponsorId] || null;
  }

  // Live cap state for a sponsor id:
  //   { count, cap, cooldownDays, inCooldown, cooldownEndsAt, atCap, approaching }
  // A cooldown that has already elapsed is reported as reset (count 0), which
  // is what the backend will do on the next write.
  function state(sponsorId) {
    var s = settings();
    var cap = (s.outreach_cap != null) ? s.outreach_cap : 10;
    var cooldownDays = (s.cooldown_days != null) ? s.cooldown_days : 30;
    var rec = record(sponsorId);

    var count = rec ? (rec.count || 0) : 0;
    var inCooldown = false;
    var cooldownEndsAt = null;

    if (rec && rec.cooldown_started_at) {
      var end = new Date(rec.cooldown_started_at).getTime() + cooldownDays * DAY_MS;
      if (Date.now() < end) {
        inCooldown = true;
        cooldownEndsAt = new Date(end);
      } else {
        count = 0; // cooldown elapsed → count has reset, company reopens
      }
    }

    var atCap = count >= cap;
    return {
      count: count,
      cap: cap,
      cooldownDays: cooldownDays,
      inCooldown: inCooldown,
      cooldownEndsAt: cooldownEndsAt,
      atCap: atCap,
      approaching: !inCooldown && !atCap && count >= cap - 2
    };
  }

  function formatDate(d) {
    if (!d) return '';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  return { state: state, formatDate: formatDate };
})();

// ============================================================
// BANNED / ANNEX helper (window.Bans) — the single definition of
// "is this company currently banned?". Annex A = permanent ban
// (contract_ends null). Annex B = BIZCOM partner banned only while
// its contract runs (contract_ends set); once it lapses the ban is
// no longer active. Every read site (matcher, sponsor list, Annex B
// panel) uses these so the rule never drifts.
// ============================================================
window.Bans = (function () {
  'use strict';

  // Annex B partner = a banned sponsor that carries a contract end date.
  function isContractPartner(s) {
    return !!(s && s.category === 'banned' && s.contract_ends);
  }

  // Contract has lapsed (date-only comparison, so it flips at midnight).
  function isExpired(s) {
    if (!isContractPartner(s)) return false;
    var end = new Date(s.contract_ends); end.setHours(0, 0, 0, 0);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return end < today;
  }

  // Currently enforced: any permanent ban, or a partner still under contract.
  function isActiveBan(s) {
    return !!(s && s.category === 'banned' && (!s.contract_ends || !isExpired(s)));
  }

  return { isContractPartner: isContractPartner, isExpired: isExpired, isActiveBan: isActiveBan };
})();

// Anchor the two seeded cooldowns relative to "now" so the demo stays realistic
// whenever the mock is run: LiHO's cooldown ENDS this month (so it shows in the
// "cooldowns ending this month" box) while Grab's ends next month (excluded, to
// show the filter working). cooldown_started_at = end - cooldown_days.
(function seedCooldowns() {
  var day = 86400000;
  var now = new Date();
  var cd = window.MOCK_DATA.settings.cooldown_days || 30;

  // Ends this month: ~6 days out, clamped to the last day of the month.
  var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  var endThisMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate() + 6, lastDay), 23, 0, 0);
  window.MOCK_DATA.outreach.s2.cooldown_started_at = new Date(endThisMonth.getTime() - cd * day).toISOString();

  // Ends next month (10th): outside the current month, so it won't show.
  var endNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 10, 12, 0, 0);
  window.MOCK_DATA.outreach.s11.cooldown_started_at = new Date(endNextMonth.getTime() - cd * day).toISOString();
})();

// Seed the two demo Annex B partners: one active contract, one lapsed — so the
// Annex B panel shows both the normal and the muted/removable states.
(function seedAnnexBPartners() {
  function iso(d) { return d.toISOString().slice(0, 10); }
  var now = new Date();
  var active = new Date(now.getFullYear(), now.getMonth() + 2, 15);  // ~2 months out
  var lapsed = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 20); // 20 days ago
  var byId = {};
  window.MOCK_DATA.sponsors.forEach(function (s) { byId[s.id] = s; });
  if (byId.b1) byId.b1.contract_ends = iso(active);
  if (byId.b2) byId.b2.contract_ends = iso(lapsed);
})();
