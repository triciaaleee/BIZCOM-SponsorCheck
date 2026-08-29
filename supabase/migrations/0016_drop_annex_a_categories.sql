-- ============================================================
-- 0016_drop_annex_a_categories.sql
--
-- Drops the annex_a_categories reference table (the prohibited
-- category *types* from Standing Order Annex A: Alcohol, Tobacco,
-- Foundations, and so on).
--
-- Why: nothing reads it. There is no SELECT on it anywhere in the
-- app, no PublicData or AdminAPI helper for it, and no screen that
-- renders it. The rows it held came from the 0002 seed and were
-- never shown to anyone. DATABASE_GUIDE.md described the admin
-- Sponsors page as displaying an Annex A panel built from this table,
-- but that panel was never built.
--
-- It had also already drifted out of the live database: the table was
-- absent from the deployed project while 0001 still declared it, so
-- the migrations and the real schema disagreed. Dropping it settles
-- that disagreement in the direction the app actually took.
--
-- What is NOT affected: prohibited *companies* are untouched. They
-- live in `sponsors` as category = 'prohibited' rows, described by
-- `ban_reason` (e.g. "Annex A, Board of Trustees"), which is what the
-- checker and the directory have always matched against. Annex B
-- partners, which are prohibited sponsors carrying a `contract_ends`
-- date, are likewise untouched.
--
-- Trade-off accepted: the Annex A category types are no longer stored
-- as editable data. They remain policy text in the Standing Order. If
-- an Annex A panel is ever built, re-adding the table is one migration
-- plus the read path and UI, which were always the real work.
--
-- Run once in the SQL Editor on a project deployed before this change.
-- Fresh installs from 0001/0002 never create the table and can skip it.
-- Idempotent: safe to re-run. Dropping the table takes its policies,
-- unique constraint and grants with it.
-- ============================================================

begin;

-- Listed for the record; both are owned by the table and go with it.
drop policy if exists annexa_read  on public.annex_a_categories;
drop policy if exists annexa_write on public.annex_a_categories;

drop table if exists public.annex_a_categories;

commit;

-- ------------------------------------------------------------
-- Verify (run separately):
--
--   select to_regclass('public.annex_a_categories');
--
-- must return NULL. Prohibited companies are unaffected:
--
--   select count(*) from public.sponsors where category = 'prohibited';
-- ------------------------------------------------------------
