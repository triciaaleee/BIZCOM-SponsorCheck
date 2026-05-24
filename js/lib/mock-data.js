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
    { id: 's1',  name: 'KOI Thé',           normalised: 'koi the',          industry: 'food_beverage',         category: 'master',    notes: '' },
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
    { id: 's20', name: 'Singapore Pools',    normalised: 'singapore pools',  industry: 'entertainment_leisure', category: 'banned',    ban_reason: 'Annex A — Gaming & Betting' },
    { id: 's21', name: 'Asia Pacific Breweries', normalised: 'asia pacific breweries', industry: 'food_beverage', category: 'banned', ban_reason: 'Annex A — Alcoholic Products' },
    { id: 's22', name: 'Marlboro',           normalised: 'marlboro',         industry: 'retail_general',        category: 'banned',    ban_reason: 'Annex A — Tobacco Products' },
    { id: 's23', name: 'Durex',              normalised: 'durex',            industry: 'beauty_personal_care',  category: 'banned',    ban_reason: 'Annex A — Sexual Products' },
    { id: 's24', name: 'AIA Insurance',      normalised: 'aia',              industry: 'professional_services', category: 'banned',    ban_reason: 'Annex A — Insurance Companies' },
    { id: 's25', name: 'Prudential',         normalised: 'prudential',       industry: 'professional_services', category: 'banned',    ban_reason: 'Annex A — Insurance Companies' },
    { id: 's26', name: 'Shaw Foundation',    normalised: 'shaw foundation',  industry: 'non_profit_government', category: 'banned',    ban_reason: 'Annex A — Foundations' },
    { id: 's27', name: 'Lee Foundation',     normalised: 'lee foundation',   industry: 'non_profit_government', category: 'banned',    ban_reason: 'Annex A — Foundations' },
    { id: 's28', name: 'DBS Bank',           normalised: 'dbs',              industry: 'professional_services', category: 'banned',    ban_reason: 'Annex B — Banks & Financial' },
    { id: 's29', name: 'OCBC Bank',          normalised: 'ocbc',             industry: 'professional_services', category: 'banned',    ban_reason: 'Annex B — Banks & Financial' },

    // closed / defunct
    { id: 's40', name: 'Robinsons',          normalised: 'robinsons',        industry: 'retail_general',        category: 'closed',    notes: 'Ceased operations 2020' },
    { id: 's41', name: 'Crystal Jade Express',normalised:'crystal jade express',industry:'food_beverage',       category: 'closed',    notes: 'Brand discontinued 2023' },

    // alumni
    { id: 's50', name: 'Tea Tribe',          normalised: 'tea tribe',        industry: 'food_beverage',         category: 'alumni',    alumni_owner: 'Wong YJ, BBM 2019' },
    { id: 's51', name: 'Crave Bakery',       normalised: 'crave bakery',     industry: 'food_beverage',         category: 'alumni',    alumni_owner: 'Tan ML, ACCT 2017' },
    { id: 's52', name: 'Loop Studio',        normalised: 'loop studio',      industry: 'activities_experiences',category: 'alumni',    alumni_owner: 'Kumar A, ISIT 2020' }
  ],

  // Simulated outreach counts (last 30 days) — keyed by sponsor id
  outreachCounts: {
    's1':  9,   // KOI — heavily contacted
    's2':  10,  // LiHO — at cap
    's3':  3,
    's4':  1,
    's5':  4,
    's11': 11,  // Grab — over cap → cooldown
    's15': 2
  },

  settings: {
    outreach_cap_per_30d: 10,
    cooldown_days: 30,
    event_cap_small: 300,
    event_cap_medium: 600,
    event_cap_large: 1000
  },

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
    { email: 'biz@sa.smu.edu.sg',          role: 'super_admin', added_at: '2026-01-01', added_by: 'system' },
    { email: 'biz.deputy@sa.smu.edu.sg',   role: 'admin',       added_at: '2026-01-04', added_by: 'biz@sa.smu.edu.sg' },
    { email: 'biz.outreach@sa.smu.edu.sg', role: 'admin',       added_at: '2026-02-12', added_by: 'biz@sa.smu.edu.sg' }
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
      status: 'new',
      reviewed_by: null,
      reviewed_at: null,
      notes: '',
      sponsor_list: [
        { name: 'KOI Thé',          status: 'caution',    industry: 'food_beverage' },
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
      status: 'completed',
      reviewed_by: 'biz@sa.smu.edu.sg',
      reviewed_at: '2026-05-17T09:00:00+08:00',
      notes: 'Approved. Reminded club to coordinate with OAR on the 2 alumni sponsors before reaching out.',
      sponsor_list: [
        { name: 'KOI Thé',          status: 'caution',    industry: 'food_beverage' },
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
      status: 'reviewing',
      reviewed_by: 'biz@sa.smu.edu.sg',
      reviewed_at: '2026-05-20T08:30:00+08:00',
      notes: 'Reviewing alumni list overlaps with OAR.',
      sponsor_list: []
    }
  ],

  // Activity log. Append-only; newest first.
  activity: [
    { id: 'a-101', at: '2026-05-23T17:02:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'submission.viewed',         entity: 'Code Sprint 2026',           details: 'Opened submission for review' },
    { id: 'a-100', at: '2026-05-22T15:30:00+08:00', actor: 'biz.deputy@sa.smu.edu.sg',   action: 'sponsor.updated',           entity: 'KOI Thé',                    details: 'Industry changed from "other" to "food_beverage"' },
    { id: 'a-099', at: '2026-05-22T11:14:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'submission.received',       entity: 'Bizad Charity Run 2026',     details: 'New submission from Accountancy Society, 47 sponsors' },
    { id: 'a-098', at: '2026-05-21T10:05:00+08:00', actor: 'biz.deputy@sa.smu.edu.sg',   action: 'submission.status_changed', entity: 'Loop Music Festival',        details: 'Status changed from "new" to "reviewing"' },
    { id: 'a-097', at: '2026-05-20T16:48:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.created',           entity: 'Challenger',                 details: 'Added as master, industry tech_electronics' },
    { id: 'a-096', at: '2026-05-19T09:22:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.status_changed',    entity: 'Robinsons',                  details: 'Status changed from "master" to "closed". Notes: "Ceased operations 2020"' },
    { id: 'a-095', at: '2026-05-17T09:00:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'submission.status_changed', entity: 'Freshmen Welcome Tea',       details: 'Status changed from "reviewing" to "completed"' },
    { id: 'a-094', at: '2026-05-15T14:10:00+08:00', actor: 'biz.outreach@sa.smu.edu.sg', action: 'sponsor.created',           entity: 'Tea Tribe',                  details: 'Added as alumni, owner "Wong YJ, BBM 2019"' },
    { id: 'a-093', at: '2026-05-14T11:33:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.updated',           entity: 'AIA Insurance',              details: 'Ban reason updated to "Annex A — Insurance Companies"' },
    { id: 'a-092', at: '2026-05-12T15:42:00+08:00', actor: 'biz.outreach@sa.smu.edu.sg', action: 'submission.status_changed', entity: 'Hackathon 2026',             details: 'Status changed from "reviewing" to "completed". 3 sponsors removed from list.' },
    { id: 'a-091', at: '2026-05-11T13:25:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'submission.status_changed', entity: 'Annual Dinner & Dance',      details: 'Status changed from "reviewing" to "completed"' },
    { id: 'a-090', at: '2026-05-10T08:14:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'submission.received',       entity: 'Hackathon 2026',             details: 'New submission from SMU Tech, 89 sponsors' },
    { id: 'a-089', at: '2026-05-08T16:00:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.status_changed',    entity: 'Crystal Jade Express',       details: 'Status changed from "master" to "closed". Notes: "Brand discontinued 2023"' },
    { id: 'a-088', at: '2026-05-06T10:15:00+08:00', actor: 'biz.deputy@sa.smu.edu.sg',   action: 'sponsor.created',           entity: 'Crave Bakery',               details: 'Added as alumni, owner "Tan ML, ACCT 2017"' },
    { id: 'a-087', at: '2026-05-03T13:20:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'admin.added',               entity: 'biz.outreach@sa.smu.edu.sg', details: 'New admin invited' },
    { id: 'a-086', at: '2026-04-28T09:45:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.updated',           entity: 'Razer',                      details: 'Notes updated' },
    { id: 'a-085', at: '2026-04-20T11:11:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.status_changed',    entity: 'Singapore Pools',            details: 'Status changed from "master" to "banned". Reason: Annex A — Gaming & Betting' },
    { id: 'a-084', at: '2026-04-15T15:00:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.created',           entity: 'Logitech',                   details: 'Added as master, industry tech_electronics' },
    { id: 'a-083', at: '2026-04-04T10:00:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'sponsor.created',           entity: 'KOI Thé',                    details: 'Added as master, industry food_beverage' },
    { id: 'a-082', at: '2026-01-04T09:30:00+08:00', actor: 'biz@sa.smu.edu.sg',          action: 'admin.added',               entity: 'biz.deputy@sa.smu.edu.sg',   details: 'New admin invited' },
    { id: 'a-081', at: '2026-01-01T00:00:00+08:00', actor: 'system',                     action: 'admin.added',               entity: 'biz@sa.smu.edu.sg',          details: 'Super-admin seat initialised' }
  ]
};
