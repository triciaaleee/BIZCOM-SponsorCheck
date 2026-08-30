-- ============================================================
-- 0021_grant_annex_categories_read.sql
--
-- Grants the table-level SELECT privilege on `annex_categories`
-- that 0017 never issued.
--
-- WHY
-- 0017 created the table, enabled RLS, and added a read policy:
--
--   create policy annex_categories_read
--     on public.annex_categories for select using (true);
--
-- and stopped there. A policy is not a privilege. Postgres checks the
-- GRANT first and only then applies RLS to narrow which rows come back,
-- so a role with a permissive policy and no grant is still refused at
-- the door. Every other anon-readable table got its grant in 0001:
--
--   grant select on public.industries, public.sponsors, public.settings
--     to anon, authenticated;
--   grant select on public.sponsor_outreach to anon, authenticated;
--
-- `annex_categories` was added five migrations later and missed that
-- line. The privilege was subsequently applied by hand against the live
-- database, which is why the public site works today, and why the gap
-- is invisible until someone rebuilds from the migrations.
--
-- WHAT BREAKS WITHOUT IT
-- The public checker reads this table to tell Annex A (prohibited,
-- remove from the list) from Annex B (restricted, keep it and let
-- BIZCOM decide). PublicData.listAnnexCategories() is one of the five
-- calls in the checker's loadData(), so a refusal rejects the whole
-- Promise.all: the boot load logs an error, and pressing "Check against
-- database" fails with the "Could not reach the database" toast. The
-- sponsor directory loses its Annex A and Annex B cards the same way.
-- On a fresh `supabase db reset` the public site ships broken.
--
-- The admin side reads the same table as `authenticated`, which has no
-- grant either, so the Sponsors and Vet & Upload screens depend on the
-- same manual fix.
--
-- SAFETY
-- Idempotent: re-granting a privilege the role already holds is a no-op,
-- so this is safe to run against the live database as well as a rebuild.
-- It grants SELECT only. Writes stay gated by annex_categories_write,
-- which requires is_admin().
-- ============================================================

begin;

grant select on public.annex_categories to anon, authenticated;

commit;

-- ------------------------------------------------------------
-- Verify (run separately):
--
--   select has_table_privilege('anon', 'public.annex_categories', 'select');
--     -- expect t
--   select has_table_privilege('authenticated', 'public.annex_categories', 'select');
--     -- expect t
-- ------------------------------------------------------------
