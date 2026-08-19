-- ============================================================
-- 0006_rename_banned_to_prohibited.sql
--
-- Standardises the terminology across the admin and public sites.
-- Two separate values change, in two different tables:
--
--   sponsors.category            'banned'  -> 'prohibited'
--   submission_sponsors.status   'blocked' -> 'prohibited'
--
-- The admin site said "Banned" and the public checker said "Blocked"
-- for what is the same underlying idea. Both now read "Prohibited",
-- which also matches the wording already used for the Annex A
-- category types.
--
-- NOT renamed: the `ban_reason` column keeps its name. It is internal
-- and never shown as a column label, so renaming it would churn a
-- dozen call sites for no user-visible gain.
--
-- Run once in the SQL Editor on a project deployed before this change.
-- Fresh installs from 0001/0002 already use the new values and can
-- skip it. Idempotent: re-running is a harmless no-op.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. sponsors.category
-- ------------------------------------------------------------

-- Drop both CHECKs that mention the old value. The value-set check is
-- named `sponsors_category_check` on projects that ran 0004 but is
-- auto-named on fresh installs from 0001, so drop the known names
-- first and then sweep up anything auto-named that still refers to it.
alter table public.sponsors drop constraint if exists sponsors_category_fields;
alter table public.sponsors drop constraint if exists sponsors_category_check;

do $$
declare c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.sponsors'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%banned%'
  loop
    execute format('alter table public.sponsors drop constraint %I', c);
  end loop;
end $$;

update public.sponsors
   set category = 'prohibited'
 where category = 'banned';

alter table public.sponsors
  add constraint sponsors_category_check
  check (category in ('approved','prohibited','closed','alumni'));

-- A prohibited row must carry a reason; only a prohibited row may carry
-- a contract end date (Annex B partners).
alter table public.sponsors
  add constraint sponsors_category_fields check (
    (category <> 'prohibited' or ban_reason is not null) and
    (contract_ends is null or category = 'prohibited')
  );

-- ------------------------------------------------------------
-- 2. submission_sponsors.status
--
-- NOTE: submission_sponsors was dropped in 0009. This section only
-- applies to projects that ran 0006 before that. Do not run this file
-- after 0009: the ADD CONSTRAINT below would fail on a missing table.
-- ------------------------------------------------------------

alter table public.submission_sponsors
  drop constraint if exists submission_sponsors_status_check;

do $$
declare c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.submission_sponsors'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%blocked%'
  loop
    execute format('alter table public.submission_sponsors drop constraint %I', c);
  end loop;
end $$;

update public.submission_sponsors
   set status = 'prohibited'
 where status = 'blocked';

alter table public.submission_sponsors
  add constraint submission_sponsors_status_check
  check (status in
    ('clear','caution','cooldown','alumni','prohibited','unverified','duplicate'));

commit;

-- ------------------------------------------------------------
-- Verify (run separately; both should return zero rows):
--   select category, count(*) from public.sponsors
--     where category = 'banned' group by category;
--   select status, count(*) from public.submission_sponsors
--     where status = 'blocked' group by status;
-- ------------------------------------------------------------
