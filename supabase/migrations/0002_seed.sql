-- ============================================================
-- 0002_seed.sql  —  seed data (finalised)
--
-- Run AFTER 0001_init.sql. Idempotent: natural-key tables use ON CONFLICT
-- DO NOTHING; the rest are guarded with WHERE NOT EXISTS.
--
-- Annex A + Annex B companies are seeded as `category='prohibited'` rows in
-- `sponsors` (there is no separate annex-companies table). The Board-of-Trustees
-- companies are seeded as prohibited sponsors too, so the matcher flags them. Only
-- the prohibited category *types* live in `annex_a_categories`.
-- ============================================================

-- ---------- industries -------------------------------------------------------
insert into public.industries (code, display_name, sort_order) values
  ('food_beverage',          'Food & Beverage',          1),
  ('apparel_accessories',    'Apparel & Accessories',    2),
  ('beauty_personal_care',   'Beauty & Personal Care',   3),
  ('entertainment_leisure',  'Entertainment & Leisure',  4),
  ('activities_experiences', 'Activities & Experiences', 5),
  ('tech_electronics',       'Tech & Electronics',       6),
  ('education_services',     'Education & Services',      7),
  ('health_wellness',        'Health & Wellness',         8),
  ('transport_mobility',     'Transport & Mobility',      9),
  ('home_lifestyle',         'Home & Lifestyle',         10),
  ('professional_services',  'Professional Services',    11),
  ('media_publishing',       'Media & Publishing',       12),
  ('non_profit_government',  'Non-profit & Government',  13),
  ('retail_general',         'Retail (General)',         14),
  ('other',                  'Other / Uncategorised',    15)
on conflict (code) do nothing;

-- ---------- settings (single row) -------------------------------------------
insert into public.settings (id, outreach_cap, cooldown_days, event_cap_small, event_cap_medium, event_cap_large)
values (true, 10, 30, 300, 600, 1000)
on conflict (id) do nothing;

-- ---------- admins -----------------------------------------------------------
insert into public.admins (email, name, role) values
  ('biz@sa.smu.edu.sg',          'Tricia',  'super_admin')
on conflict (email) do nothing;

-- ---------- annex_a_categories (prohibited *types*, not companies) ----------
insert into public.annex_a_categories (label, sort_order) values
  ('Foundations',              1),
  ('Alcohol',                  2),
  ('Tobacco',                  3),
  ('Gaming & betting',         4),
  ('Sexual products',          5),
  ('Insurance',                6),
  ('Multi-level marketing',    7),
  ('SMU Commencement sponsors',8)
on conflict (label) do nothing;

-- ---------- sponsors ---------------------------------------------------------
-- approved / prohibited examples / closed / alumni
insert into public.sponsors (name, normalised, industry, category, notes, ban_reason) values
  -- approved
  ('KOI',                'koi',                    'food_beverage',          'approved', '', null),
  ('LiHO',               'liho',                   'food_beverage',          'approved', '', null),
  ('Starbucks',          'starbucks',              'food_beverage',          'approved', '', null),
  ('Subway',             'subway',                 'food_beverage',          'approved', '', null),
  ('Uniqlo',             'uniqlo',                 'apparel_accessories',    'approved', '', null),
  ('Charles & Keith',    'charles and keith',      'apparel_accessories',    'approved', '', null),
  ('Watsons',            'watsons',                'beauty_personal_care',   'approved', '', null),
  ('Sephora',            'sephora',                'beauty_personal_care',   'approved', '', null),
  ('Razer',              'razer',                  'tech_electronics',       'approved', '', null),
  ('Logitech',           'logitech',               'tech_electronics',       'approved', '', null),
  ('Grab',               'grab',                   'transport_mobility',     'approved', '', null),
  ('MUJI',               'muji',                   'home_lifestyle',         'approved', '', null),
  ('Climb Central',      'climb central',          'activities_experiences', 'approved', '', null),
  ('BoulderPlus',        'boulderplus',            'activities_experiences', 'approved', '', null),
  ('Cathay Cineplexes',  'cathay cineplexes',      'entertainment_leisure',  'approved', '', null),
  -- prohibited (Annex A example companies)
  ('Singapore Pools',        'singapore pools',        'entertainment_leisure',  'prohibited', '', 'Annex A, Gaming & Betting'),
  ('Asia Pacific Breweries', 'asia pacific breweries', 'food_beverage',          'prohibited', '', 'Annex A, Alcoholic Products'),
  ('Marlboro',               'marlboro',               'retail_general',         'prohibited', '', 'Annex A, Tobacco Products'),
  ('Durex',                  'durex',                  'beauty_personal_care',   'prohibited', '', 'Annex A, Sexual Products'),
  ('AIA Insurance',          'aia insurance',          'professional_services',  'prohibited', '', 'Annex A, Insurance Companies'),
  ('Prudential',             'prudential',             'professional_services',  'prohibited', '', 'Annex A, Insurance Companies'),
  ('Shaw Foundation',        'shaw foundation',        'non_profit_government',  'prohibited', '', 'Annex A, Foundations'),
  ('Lee Foundation',         'lee foundation',         'non_profit_government',  'prohibited', '', 'Annex A, Foundations'),
  ('DBS Bank',               'dbs bank',               'professional_services',  'prohibited', '', 'Annex B, Banks & Financial'),
  ('OCBC Bank',              'ocbc bank',              'professional_services',  'prohibited', '', 'Annex B, Banks & Financial'),
  -- closed / defunct
  ('Robinsons',            'robinsons',             'retail_general', 'closed', 'Ceased operations 2020',  null),
  ('Crystal Jade Express', 'crystal jade express',  'food_beverage',  'closed', 'Brand discontinued 2023', null),
  -- alumni-affiliated
  ('Tea Tribe',    'tea tribe',    'food_beverage',          'alumni', '', null),
  ('Crave Bakery', 'crave bakery', 'food_beverage',          'alumni', '', null),
  ('Loop Studio',  'loop studio',  'activities_experiences', 'alumni', '', null)
on conflict (normalised) do nothing;

-- Board of Trustees & associated companies (Annex A). Seeded as prohibited sponsors
-- so the checker flags them; the Sponsors-page "Board of Trustees" panel lists
-- them via ban_reason = 'Annex A, Board of Trustees'. normalised follows the
-- matcher's rules (parens dropped, & -> and, legal suffixes like Pte Ltd/LLP/Corp
-- stripped).
insert into public.sponsors (name, normalised, industry, category, ban_reason) values
  ('Banyan Tree Group',                        'banyan tree group',          'home_lifestyle',        'prohibited', 'Annex A, Board of Trustees'),
  ('Global Business Integrators',              'global business integrators', 'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Reed Exhibitions',                         'reed exhibitions',           'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Hup Soon Global Corporation',              'hup soon global',            'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Singapore Telecommunications (Singtel)',   'singapore telecommunications','tech_electronics',     'prohibited', 'Annex A, Board of Trustees'),
  ('Chinatrust Commercial Bank',               'chinatrust commercial bank', 'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Kuok (S)',                                 'kuok',                       'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Raffles Medical Corp',                     'raffles medical',            'health_wellness',       'prohibited', 'Annex A, Board of Trustees'),
  ('Phoenix Advisers',                         'phoenix advisers',           'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Infosys Technologies',                     'infosys technologies',       'tech_electronics',      'prohibited', 'Annex A, Board of Trustees'),
  ('WongPartnership LLP',                      'wongpartnership',            'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('SMRT',                                     'smrt',                       'transport_mobility',    'prohibited', 'Annex A, Board of Trustees'),
  ('Bangkok Bank',                             'bangkok bank',               'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Symphony Asia Holdings',                   'symphony asia holdings',     'professional_services', 'prohibited', 'Annex A, Board of Trustees'),
  ('Dane Court',                               'dane court',                 'other',                 'prohibited', 'Annex A, Board of Trustees')
on conflict (normalised) do nothing;

-- Annex B (BIZCOM partners): prohibited sponsors with a contract end date. One active,
-- one lapsed — demo placeholders; replace with the real partner list. The lapsed
-- one drops out of the active prohibited set automatically (contract_ends < current_date).
insert into public.sponsors (name, normalised, industry, category, ban_reason, contract_ends) values
  ('Aurora Events Co',     'aurora events co', 'entertainment_leisure', 'prohibited', 'Annex B, BIZCOM partner', (current_date + interval '2 months')::date),
  ('Legacy Media Pte Ltd', 'legacy media',     'media_publishing',      'prohibited', 'Annex B, BIZCOM partner', (current_date - interval '20 days')::date)
on conflict (normalised) do nothing;

-- ---------- outreach_log -----------------------------------------------------
-- One row per contact; counts are cumulative and map straight to
-- sponsor_outreach.contact_count:
--   KOI 9, LiHO 10 (at cap), Starbucks 3, Subway 1, Uniqlo 4,
--   Grab 10 (at cap), Cathay Cineplexes 2
insert into public.outreach_log (sponsor_id, contacted_at)
select s.id,
       now() - ((g.i % 28) || ' days')::interval - (g.i || ' hours')::interval
from (values
  ('koi',               9),
  ('liho',              10),
  ('starbucks',         3),
  ('subway',            1),
  ('uniqlo',            4),
  ('grab',              10),
  ('cathay cineplexes', 2)
) as c(normalised, n)
join public.sponsors s on s.normalised = c.normalised
cross join lateral generate_series(1, c.n) as g(i)
where not exists (select 1 from public.outreach_log);

-- Sponsors at the cap are in cooldown: stamp cooldown_started_at so
-- sponsor_outreach reports in_cooldown (LiHO 8 days in, Grab 18).
update public.sponsors set cooldown_started_at = now() - interval '8 days'  where normalised = 'liho';
update public.sponsors set cooldown_started_at = now() - interval '18 days' where normalised = 'grab';

-- ---------- submissions ------------------------------------------------------
insert into public.submissions
  (event_name, club, contact_email, event_size, sponsor_count, submitted_at, complete_by, status, reviewed_by, reviewed_at, notes)
select * from (values
  ('Bizad Charity Run 2026', 'Accountancy Society', 'charityrun@smu.edu.sg', 'medium', 47,
     '2026-05-22T09:42:00+08:00'::timestamptz, '2026-06-05'::date, 'new',
     null::text, null::timestamptz, ''),
  ('Loop Music Festival', 'Music Interest Group', 'mig.exco@smu.edu.sg', 'large', 112,
     '2026-05-20T14:18:00+08:00'::timestamptz, '2026-05-28'::date, 'reviewing',
     'biz.deputy@sa.smu.edu.sg', '2026-05-21T10:05:00+08:00'::timestamptz,
     'Flagged 4 alumni-affiliated sponsors back to club. Awaiting their revised list.'),
  ('Code Sprint 2026', 'SMU Tech', 'smutech@smu.edu.sg', 'small', 18,
     '2026-05-23T16:55:00+08:00'::timestamptz, '2026-05-24'::date, 'new',
     null, null, ''),
  ('Freshmen Welcome Tea', 'School of Economics', 'soe.welcome@smu.edu.sg', 'medium', 32,
     '2026-05-15T11:30:00+08:00'::timestamptz, '2026-05-19'::date, 'completed',
     'biz@sa.smu.edu.sg', '2026-05-17T09:00:00+08:00'::timestamptz,
     'Approved. Reminded club to coordinate with OAR on the 2 alumni sponsors before reaching out.'),
  ('Hackathon 2026', 'SMU Tech', 'smutech@smu.edu.sg', 'large', 89,
     '2026-05-10T08:14:00+08:00'::timestamptz, '2026-05-15'::date, 'completed',
     'biz.outreach@sa.smu.edu.sg', '2026-05-12T15:42:00+08:00'::timestamptz,
     'Approved with 3 sponsors removed (prohibited per Annex A/B).'),
  ('Annual Dinner & Dance', 'Lifestyle, Sports & Recreation', 'lsr.dnd@smu.edu.sg', 'large', 156,
     '2026-05-08T20:11:00+08:00'::timestamptz, '2026-05-12'::date, 'completed',
     'biz@sa.smu.edu.sg', '2026-05-11T13:25:00+08:00'::timestamptz, 'Approved.'),
  ('Investment Conference', 'Finance Society', 'finsoc@smu.edu.sg', 'medium', 64,
     '2026-05-19T12:00:00+08:00'::timestamptz, '2026-06-10'::date, 'reviewing',
     'biz@sa.smu.edu.sg', '2026-05-20T08:30:00+08:00'::timestamptz,
     'Reviewing alumni list overlaps with OAR.')
) as v(event_name, club, contact_email, event_size, sponsor_count, submitted_at, complete_by, status, reviewed_by, reviewed_at, notes)
where not exists (select 1 from public.submissions);


