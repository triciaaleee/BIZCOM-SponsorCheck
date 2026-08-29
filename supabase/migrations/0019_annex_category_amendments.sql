-- ============================================================
-- 0019_annex_category_amendments.sql
--
-- Brings annex_categories in line with the names BIZCOM actually uses,
-- and adds the two Annex A categories 0017 never seeded.
--
-- STATUS: the live database was edited by hand before this file was
-- written, so on that database every statement below is already true and
-- this migration is a no-op. It exists so that a fresh install from
-- 0001 -> 0020 lands on exactly the same names, instead of drifting from
-- production the way 0001 drifted before 0016 settled it.
--
-- FINAL STATE (12 rows)
--   Annex A (9): Alcoholic Products, Tobacco Products, Gaming & Betting,
--                Sexual Products, Foundation, Insurance,
--                Board of Trustees, Multi-Level Marketing,
--                SMU Commencement Sponsor
--   Annex B (3): BIZCOM Partner, Banks & Financial Institution,
--                Government Entity
--
-- WHY THE TWO ADDITIONS
-- Multi-Level Marketing and SMU Commencement Sponsor are both listed on
-- the admin Sponsors page's Annex A card, but 0017 never seeded them, so
-- the card advertised categories the picker could not file a company
-- under. This closes that gap.
--
-- WHY THE RENAMES ARE SAFE
-- Sponsors reference these rows by `annex_category_id`, never by name, so
-- renaming changes no company row and needs no backfill. The unique
-- constraint is on (annex, name) and none of the new names collide. The
-- one place code still matches on a name is the Annex B "Add" button in
-- js/admin/sponsors-page.js, which compares case-insensitively against
-- 'bizcom partner' and is unaffected.
--
-- Each rename is keyed on the old name, so re-running is a no-op and the
-- order of statements does not matter.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. New Annex A categories, ordered after Board of Trustees (70),
--    which is the order the Annex A card lists them in.
-- ------------------------------------------------------------
insert into public.annex_categories (annex, name, note, sort_order) values
  ('A', 'Multi-Level Marketing',    'Prohibited under Annex A. Remove from your list.', 80),
  ('A', 'SMU Commencement Sponsor', 'Prohibited under Annex A. Remove from your list.', 90)
on conflict (annex, name) do nothing;

-- ------------------------------------------------------------
-- 2. Annex A renames to singular, matching the Standing Order wording.
-- ------------------------------------------------------------
update public.annex_categories set name = 'Foundation'
 where annex = 'A' and name = 'Foundations';

update public.annex_categories set name = 'Insurance'
 where annex = 'A' and name = 'Insurance Companies';

-- ------------------------------------------------------------
-- 3. Annex B renames.
-- ------------------------------------------------------------
-- 'Banks & Financial' is the 0017 seed name. The plural variant is also
-- handled: an earlier draft of this file used it, so a database that ran
-- that draft still converges here.
update public.annex_categories set name = 'Banks & Financial Institution'
 where annex = 'B' and name in ('Banks & Financial', 'Banks & Financial Institutions');

-- 'Government Entities' is the name 0018 renamed to; this corrects it to
-- the singular form the live database uses.
update public.annex_categories set name = 'Government Entity'
 where annex = 'B' and name in ('Government-linked statutory boards', 'Government Entities');

commit;

-- ------------------------------------------------------------
-- Verify (run separately):
--
--   select annex, name, sort_order from public.annex_categories
--    order by annex, sort_order;
--     -- expect the 12 rows listed at the top of this file, and no
--     -- 'Telecommunications' row (0018 removed it)
--
--   select count(*) from public.sponsors where category = 'prohibited'
--                                          and annex_category_id is null;
--     -- must still be 0
-- ------------------------------------------------------------
