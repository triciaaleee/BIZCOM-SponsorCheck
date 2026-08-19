-- ============================================================
-- 0004_rename_master_to_approved.sql
--
-- Renames the sponsor category value 'master' -> 'approved'.
-- ('master' was an internal/misleading term; the UI already showed
-- "Approved".) Only public.sponsors.category holds this value —
-- submission_sponsors.status is a matcher status, not a category.
--
-- Run once in the SQL Editor on a project deployed before this change.
-- Fresh installs from 0001/0002 already use 'approved' and can skip it.
-- Idempotent: the UPDATE is a no-op once no 'master' rows remain.
-- ============================================================

begin;

-- 1. Drop the CHECK that enforces the category value set (auto-named on the
--    inline column check), found dynamically so the exact name doesn't matter.
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.sponsors'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%category%master%';
  if c is not null then
    execute format('alter table public.sponsors drop constraint %I', c);
  end if;
end $$;

-- 2. Migrate the data.
update public.sponsors set category = 'approved' where category = 'master';

-- 3. Reinstate the CHECK with the new value set.
alter table public.sponsors
  add constraint sponsors_category_check
  check (category in ('approved','banned','closed','alumni'));
-- NOTE: 'banned' was renamed to 'prohibited' in 0006, which reinstates this
-- constraint with the new value set. Do not run this file after 0006.

commit;
