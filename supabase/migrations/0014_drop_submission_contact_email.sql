-- ============================================================
-- 0014_drop_submission_contact_email.sql
--
-- Drops submissions.contact_email.
--
-- Why: it was never used for anything. Nothing emails from the app
-- (the public checker composes a mail client message on the student's
-- own machine and writes nothing here), and the admin console only
-- ever displayed the address back to whoever typed it in. The club's
-- own name is already on the row, and every real conversation happens
-- over email outside the tool, so an address stored here was a field
-- to maintain rather than a fact anyone read.
--
-- The column-level INSERT/UPDATE grants from 0012 name contact_email
-- explicitly. Postgres drops a column's privileges along with the
-- column, so the remaining grants are untouched and no re-grant is
-- needed. The derived columns stay locked away from the client.
--
-- DESTRUCTIVE: the stored addresses are gone. There is no soft-delete
-- and no audit copy, so take a snapshot first if any of them matter.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

alter table public.submissions drop column if exists contact_email;

commit;

-- ------------------------------------------------------------
-- Verify (run separately):
--
-- 1. The column is gone:
--      select column_name from information_schema.columns
--       where table_schema = 'public' and table_name = 'submissions'
--       order by ordinal_position;
--
-- 2. Submissions still insert and update as a signed-in admin:
--      update public.submissions set notes = notes;
--
-- 3. The derived columns are still locked (this must FAIL):
--      update public.submissions set sponsor_count = 999;
-- ------------------------------------------------------------
