-- ============================================================
-- 0009_drop_submission_sponsors.sql
--
-- Drops the submission_sponsors table (the per-company line items
-- of a club's submission).
--
-- Why: the table was never wired up. Nothing in the app read it and
-- nothing wrote to it, so the only rows it ever held came from the
-- 0002 seed file. It was designed for an in-app submission flow that
-- was removed when submissions became admin-only and clubs started
-- emailing their list instead (see the note in supabase/README.md).
--
-- Keeping it was not free: its status CHECK had to be kept in step
-- with the matcher's vocabulary, so 0006 spent half its length
-- renaming 'blocked' -> 'prohibited' inside a table with no readers.
-- Every future status change would have cost the same.
--
-- What is NOT affected: `submissions` itself stays exactly as it is.
-- It is the table the admin Home calendar reads, and it holds its own
-- summary of the list size in submissions.sponsor_count (a figure the
-- club reports, never derived from these line items).
--
-- Trade-off accepted: there is no longer a place to record which
-- companies a given club asked for. Nothing recorded that anyway, so
-- no live capability is lost. Restoring it later is a single migration
-- plus the read/write paths and UI that were always the real work.
--
-- Run once in the SQL Editor on a project deployed before this change.
-- Fresh installs from 0001/0002 never create the table and can skip it.
-- Idempotent: safe to re-run. Dropping the table takes its index, RLS
-- policy, foreign keys and grants with it.
-- ============================================================

begin;

-- Listed for the record; all of these are owned by the table and go with it.
drop policy if exists subsponsors_all on public.submission_sponsors;

drop index if exists public.subsponsors_submission_idx;

drop table if exists public.submission_sponsors;

commit;

-- ------------------------------------------------------------
-- Verify (run separately; should return zero rows):
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'submission_sponsors';
-- ------------------------------------------------------------
