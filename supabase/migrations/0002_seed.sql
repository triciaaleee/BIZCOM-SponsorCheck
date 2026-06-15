-- ============================================================
-- 0002_seed.sql  —  seed data from js/lib/mock-data.js
--
-- Run AFTER 0001_init.sql. Idempotent: tables with natural keys use
-- ON CONFLICT DO NOTHING; the rest are guarded with WHERE NOT EXISTS so
-- re-running won't duplicate rows.
--
-- NOTE: the old hardcoded dashboardStats (total 12403, etc.) are intentionally
-- NOT seeded — those numbers are now computed live by the dashboard_stats view.
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
insert into public.settings (id, outreach_cap_per_30d, cooldown_days, event_cap_small, event_cap_medium, event_cap_large)
values (true, 10, 30, 300, 600, 1000)
on conflict (id) do nothing;

-- ---------- admins -----------------------------------------------------------
insert into public.admins (email, name, role, added_at, added_by) values
  ('biz@sa.smu.edu.sg',          'Tricia',  'super_admin', '2026-01-01'::timestamptz, 'system'),
  ('biz.deputy@sa.smu.edu.sg',   'Wei Jie', 'admin',       '2026-01-04'::timestamptz, 'biz@sa.smu.edu.sg'),
  ('biz.outreach@sa.smu.edu.sg', 'Arjun',   'admin',       '2026-02-12'::timestamptz, 'biz@sa.smu.edu.sg')
on conflict (email) do nothing;

-- ---------- sponsors ---------------------------------------------------------
-- master (approved)
insert into public.sponsors (name, normalised, industry, category, notes, ban_reason, alumni_owner) values
  ('KOI Thé',            'koi the',                'food_beverage',          'master', '', null, null),
  ('LiHO TEA',           'liho tea',               'food_beverage',          'master', '', null, null),
  ('Starbucks',          'starbucks',              'food_beverage',          'master', '', null, null),
  ('Subway',             'subway',                 'food_beverage',          'master', '', null, null),
  ('Uniqlo',             'uniqlo',                 'apparel_accessories',    'master', '', null, null),
  ('Charles & Keith',    'charles and keith',      'apparel_accessories',    'master', '', null, null),
  ('Watsons',            'watsons',                'beauty_personal_care',   'master', '', null, null),
  ('Sephora',            'sephora',                'beauty_personal_care',   'master', '', null, null),
  ('Razer',              'razer',                  'tech_electronics',       'master', '', null, null),
  ('Logitech',           'logitech',               'tech_electronics',       'master', '', null, null),
  ('Grab',               'grab',                   'transport_mobility',     'master', '', null, null),
  ('MUJI',               'muji',                   'home_lifestyle',         'master', '', null, null),
  ('Climb Central',      'climb central',          'activities_experiences', 'master', '', null, null),
  ('BoulderPlus',        'boulderplus',            'activities_experiences', 'master', '', null, null),
  ('Cathay Cineplexes',  'cathay cineplexes',      'entertainment_leisure',  'master', '', null, null),
  -- banned (Annex A / B)
  ('Singapore Pools',        'singapore pools',        'entertainment_leisure',  'banned', '', 'Annex A, Gaming & Betting',     null),
  ('Asia Pacific Breweries', 'asia pacific breweries', 'food_beverage',          'banned', '', 'Annex A, Alcoholic Products',   null),
  ('Marlboro',               'marlboro',               'retail_general',         'banned', '', 'Annex A, Tobacco Products',     null),
  ('Durex',                  'durex',                  'beauty_personal_care',   'banned', '', 'Annex A, Sexual Products',      null),
  ('AIA Insurance',          'aia',                    'professional_services',  'banned', '', 'Annex A, Insurance Companies',  null),
  ('Prudential',             'prudential',             'professional_services',  'banned', '', 'Annex A, Insurance Companies',  null),
  ('Shaw Foundation',        'shaw foundation',        'non_profit_government',  'banned', '', 'Annex A, Foundations',          null),
  ('Lee Foundation',         'lee foundation',         'non_profit_government',  'banned', '', 'Annex A, Foundations',          null),
  ('DBS Bank',               'dbs',                    'professional_services',  'banned', '', 'Annex B, Banks & Financial',    null),
  ('OCBC Bank',              'ocbc',                   'professional_services',  'banned', '', 'Annex B, Banks & Financial',    null),
  -- closed / defunct
  ('Robinsons',            'robinsons',             'retail_general', 'closed', 'Ceased operations 2020',  null, null),
  ('Crystal Jade Express', 'crystal jade express',  'food_beverage',  'closed', 'Brand discontinued 2023', null, null),
  -- alumni-affiliated
  ('Tea Tribe',    'tea tribe',    'food_beverage',          'alumni', '', null, 'Wong YJ, BBM 2019'),
  ('Crave Bakery', 'crave bakery', 'food_beverage',          'alumni', '', null, 'Tan ML, ACCT 2017'),
  ('Loop Studio',  'loop studio',  'activities_experiences', 'alumni', '', null, 'Kumar A, ISIT 2020')
on conflict (normalised) do nothing;

-- ---------- outreach_log -----------------------------------------------------
-- One row per contact, spread across the last ~28 days so the 30-day view
-- reproduces the mock outreachCounts:
--   KOI Thé 9, LiHO TEA 10, Starbucks 3, Subway 1, Uniqlo 4, Grab 11, Cathay Cineplexes 2
insert into public.outreach_log (sponsor_id, contacted_at)
select s.id,
       now() - ((g.i % 28) || ' days')::interval - (g.i || ' hours')::interval
from (values
  ('koi the',           9),
  ('liho tea',          10),
  ('starbucks',         3),
  ('subway',            1),
  ('uniqlo',            4),
  ('grab',              11),
  ('cathay cineplexes', 2)
) as c(normalised, n)
join public.sponsors s on s.normalised = c.normalised
cross join lateral generate_series(1, c.n) as g(i)
where not exists (select 1 from public.outreach_log);

-- ---------- submissions ------------------------------------------------------
insert into public.submissions
  (event_name, club, contact_email, event_size, sponsor_count, submitted_at, complete_by, status, reviewed_by, reviewed_at, notes)
select * from (values
  ('Bizad Charity Run 2026', 'Accountancy Society',            'charityrun@smu.edu.sg', 'medium', 47,
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
     'Approved with 3 sponsors removed (banned per Annex A/B).'),
  ('Annual Dinner & Dance', 'Lifestyle, Sports & Recreation', 'lsr.dnd@smu.edu.sg', 'large', 156,
     '2026-05-08T20:11:00+08:00'::timestamptz, '2026-05-12'::date, 'completed',
     'biz@sa.smu.edu.sg', '2026-05-11T13:25:00+08:00'::timestamptz, 'Approved.'),
  ('Investment Conference', 'Finance Society', 'finsoc@smu.edu.sg', 'medium', 64,
     '2026-05-19T12:00:00+08:00'::timestamptz, '2026-06-10'::date, 'reviewing',
     'biz@sa.smu.edu.sg', '2026-05-20T08:30:00+08:00'::timestamptz,
     'Reviewing alumni list overlaps with OAR.')
) as v(event_name, club, contact_email, event_size, sponsor_count, submitted_at, complete_by, status, reviewed_by, reviewed_at, notes)
where not exists (select 1 from public.submissions);

-- ---------- submission_sponsors ---------------------------------------------
-- Joined to the parent on event_name (unique among the seed submissions).
insert into public.submission_sponsors (submission_id, position, name, status, industry)
select sub.id, x.position, x.name, x.status, x.industry
from (values
  ('Bizad Charity Run 2026', 1, 'KOI Thé',          'caution',    'food_beverage'),
  ('Bizad Charity Run 2026', 2, 'LiHO TEA',         'cooldown',   'food_beverage'),
  ('Bizad Charity Run 2026', 3, 'Uniqlo',           'clear',      'apparel_accessories'),
  ('Bizad Charity Run 2026', 4, 'Tea Tribe',        'alumni',     'food_beverage'),
  ('Bizad Charity Run 2026', 5, 'Singapore Pools',  'blocked',    'entertainment_leisure'),
  ('Bizad Charity Run 2026', 6, 'Logitech',         'clear',      'tech_electronics'),
  ('Bizad Charity Run 2026', 7, 'Razer',            'clear',      'tech_electronics'),
  ('Bizad Charity Run 2026', 8, 'Climb Central',    'clear',      'activities_experiences'),
  ('Loop Music Festival',    1, 'Loop Studio',      'alumni',     'activities_experiences'),
  ('Loop Music Festival',    2, 'Crave Bakery',     'alumni',     'food_beverage'),
  ('Loop Music Festival',    3, 'Cathay Cineplexes','clear',      'entertainment_leisure'),
  ('Loop Music Festival',    4, 'Sephora',          'clear',      'beauty_personal_care'),
  ('Loop Music Festival',    5, 'MUJI',             'clear',      'home_lifestyle'),
  ('Code Sprint 2026',       1, 'Razer',            'clear',      'tech_electronics'),
  ('Code Sprint 2026',       2, 'Logitech',         'clear',      'tech_electronics'),
  ('Code Sprint 2026',       3, 'Challenger',       'unverified', 'tech_electronics'),
  ('Freshmen Welcome Tea',   1, 'KOI Thé',          'caution',    'food_beverage'),
  ('Freshmen Welcome Tea',   2, 'Tea Tribe',        'alumni',     'food_beverage'),
  ('Freshmen Welcome Tea',   3, 'Watsons',          'clear',      'beauty_personal_care'),
  ('Hackathon 2026',         1, 'Grab',             'cooldown',   'transport_mobility'),
  ('Hackathon 2026',         2, 'Razer',            'clear',      'tech_electronics'),
  ('Hackathon 2026',         3, 'DBS Bank',         'blocked',    'professional_services')
) as x(event_name, position, name, status, industry)
join public.submissions sub on sub.event_name = x.event_name
where not exists (select 1 from public.submission_sponsors);

-- ---------- activity_log -----------------------------------------------------
insert into public.activity_log (at, actor, action, entity, details)
select * from (values
  ('2026-05-23T17:02:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'submission.viewed',         'Code Sprint 2026',           'Opened submission for review'),
  ('2026-05-22T15:30:00+08:00'::timestamptz, 'biz.deputy@sa.smu.edu.sg',   'sponsor.updated',           'KOI Thé',                    'Industry changed from "other" to "food_beverage"'),
  ('2026-05-22T11:14:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'submission.received',       'Bizad Charity Run 2026',     'New submission from Accountancy Society, 47 sponsors'),
  ('2026-05-21T10:05:00+08:00'::timestamptz, 'biz.deputy@sa.smu.edu.sg',   'submission.status_changed', 'Loop Music Festival',        'Status changed from "new" to "reviewing"'),
  ('2026-05-20T16:48:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.created',           'Challenger',                 'Added as master, industry tech_electronics'),
  ('2026-05-19T09:22:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.status_changed',    'Robinsons',                  'Status changed from "master" to "closed". Notes: "Ceased operations 2020"'),
  ('2026-05-17T09:00:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'submission.status_changed', 'Freshmen Welcome Tea',       'Status changed from "reviewing" to "completed"'),
  ('2026-05-15T14:10:00+08:00'::timestamptz, 'biz.outreach@sa.smu.edu.sg', 'sponsor.created',           'Tea Tribe',                  'Added as alumni, owner "Wong YJ, BBM 2019"'),
  ('2026-05-14T11:33:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.updated',           'AIA Insurance',              'Ban reason updated to "Annex A, Insurance Companies"'),
  ('2026-05-12T15:42:00+08:00'::timestamptz, 'biz.outreach@sa.smu.edu.sg', 'submission.status_changed', 'Hackathon 2026',             'Status changed from "reviewing" to "completed". 3 sponsors removed from list.'),
  ('2026-05-11T13:25:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'submission.status_changed', 'Annual Dinner & Dance',      'Status changed from "reviewing" to "completed"'),
  ('2026-05-10T08:14:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'submission.received',       'Hackathon 2026',             'New submission from SMU Tech, 89 sponsors'),
  ('2026-05-08T16:00:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.status_changed',    'Crystal Jade Express',       'Status changed from "master" to "closed". Notes: "Brand discontinued 2023"'),
  ('2026-05-06T10:15:00+08:00'::timestamptz, 'biz.deputy@sa.smu.edu.sg',   'sponsor.created',           'Crave Bakery',               'Added as alumni, owner "Tan ML, ACCT 2017"'),
  ('2026-05-03T13:20:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'admin.added',               'biz.outreach@sa.smu.edu.sg', 'New admin invited'),
  ('2026-04-28T09:45:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.updated',           'Razer',                      'Notes updated'),
  ('2026-04-20T11:11:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.status_changed',    'Singapore Pools',            'Status changed from "master" to "banned". Reason: Annex A, Gaming & Betting'),
  ('2026-04-15T15:00:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.created',           'Logitech',                   'Added as master, industry tech_electronics'),
  ('2026-04-04T10:00:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'sponsor.created',           'KOI Thé',                    'Added as master, industry food_beverage'),
  ('2026-01-04T09:30:00+08:00'::timestamptz, 'biz@sa.smu.edu.sg',          'admin.added',               'biz.deputy@sa.smu.edu.sg',   'New admin invited'),
  ('2026-01-01T00:00:00+08:00'::timestamptz, 'system',                     'admin.added',               'biz@sa.smu.edu.sg',          'Super-admin seat initialised')
) as v(at, actor, action, entity, details)
where not exists (select 1 from public.activity_log);
