-- ============================================================
-- 0005_drop_activity_log.sql
--
-- Drops the activity_log audit trail.
--
-- Why: the table was write-only. The only thing that ever touched it
-- was AdminShell.logActivity() in the browser, which inserted rows
-- fire-and-forget. Nothing ever read it back: no SELECT anywhere in
-- the app, no AdminAPI helper, no admin screen displaying it. It was
-- also best-effort by design (errors were swallowed to the console),
-- so it was never a dependable audit record in the first place.
--
-- What is NOT affected: outreach history still lives in outreach_log,
-- and submission review is still stamped on submissions.reviewed_by /
-- reviewed_at. Only the general audit trail goes away.
--
-- Trade-off accepted: sponsor/admin deletions no longer leave any
-- trace of who removed them or when.
--
-- Run once in the SQL Editor on a project deployed before this change.
-- Fresh installs from 0001/0002 never create the table and can skip it.
-- Idempotent: safe to re-run. Dropping the table takes its policies,
-- index and grants with it.
-- ============================================================

begin;

-- Policies and the created_at index are owned by the table and are
-- dropped with it; listed here only so the intent is on the record.
drop policy if exists activity_read   on public.activity_log;
drop policy if exists activity_insert on public.activity_log;
drop policy if exists activity_delete on public.activity_log;

drop index if exists public.activity_created_idx;

drop table if exists public.activity_log;

commit;
