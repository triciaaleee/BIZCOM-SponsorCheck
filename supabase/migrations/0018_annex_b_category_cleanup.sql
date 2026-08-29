-- ============================================================
-- 0018_annex_b_category_cleanup.sql
--
-- Trims and renames the Annex B categories seeded by 0017 so the
-- table matches what the Standing Order actually lists:
--
--   'BIZCOM partner'                    -> 'BIZCOM Partner'
--   'Government-linked statutory boards' -> 'Government Entities'
--   'Telecommunications'                 -> removed
--
-- WHY
-- Telecommunications was seeded in 0017 on the assumption that telcos
-- are restricted as a class. They are not: the telco that matters is
-- Singtel, which is already Annex A under Board of Trustees, so the
-- category listed a restriction that does not exist. The two renames
-- are wording only, bringing the stored names in line with how BIZCOM
-- writes them.
--
-- The renames are safe by construction: sponsors point at these rows by
-- `annex_category_id`, not by name, so no company row changes and no
-- backfill is needed. The unique constraint is on (annex, name), and
-- neither new name collides with an existing one.
--
-- The delete is NOT safe by construction. `sponsors.annex_category_id`
-- is `on delete restrict`, so if any company is filed under
-- Telecommunications this migration aborts rather than orphaning it.
-- That is deliberate: a company sitting in a category that is about to
-- stop existing needs a human decision (is it Annex A, another Annex B
-- category, or simply approved?), and this file cannot make it. If the
-- migration aborts, re-file those companies on the Sponsors page first,
-- then re-run.
--
-- NOTE ON `annex_categories.note`: the guidance text is unchanged. It is
-- student-facing copy printed under the checker's status, and nothing in
-- it named telecommunications specifically.
--
-- 0017's seed is left as written, for the record. A fresh install runs
-- 0017 then this file, and lands in the same place.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Renames. Keyed on the old name, so a re-run is a no-op.
-- ------------------------------------------------------------
update public.annex_categories
   set name = 'BIZCOM Partner'
 where annex = 'B' and name = 'BIZCOM partner';

update public.annex_categories
   set name = 'Government Entities'
 where annex = 'B' and name = 'Government-linked statutory boards';

-- ------------------------------------------------------------
-- 2. Refuse to drop a category that still has companies in it.
-- ------------------------------------------------------------
do $$
declare in_use int;
begin
  select count(*) into in_use
    from public.sponsors s
    join public.annex_categories c on c.id = s.annex_category_id
   where c.annex = 'B' and c.name = 'Telecommunications';
  if in_use > 0 then
    raise exception
      'Cannot remove the Telecommunications category: % company/companies are still filed under it. Re-file them on the admin Sponsors page, then re-run this migration.', in_use;
  end if;
end $$;

delete from public.annex_categories
 where annex = 'B' and name = 'Telecommunications';

commit;

-- ------------------------------------------------------------
-- Verify (run separately):
--
--   select annex, name, sort_order from public.annex_categories
--    where annex = 'B' order by sort_order;
--     -- expect exactly three rows:
--     --   BIZCOM Partner, Banks & Financial, Government Entities
--
--   select count(*) from public.sponsors where category = 'prohibited'
--                                          and annex_category_id is null;
--     -- must still be 0
-- ------------------------------------------------------------
