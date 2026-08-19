-- ============================================================
-- 0007_widen_admin_email_domain.sql
--
-- Widens who may be added to the admins whitelist.
--
--   before: email like '%@sa.smu.edu.sg'   (that one subdomain only)
--   after:  smu.edu.sg itself, or any subdomain of it
--
-- So all of these are now accepted:
--   name@smu.edu.sg
--   name@sa.smu.edu.sg
--   name@computing.smu.edu.sg
--   name@business.smu.edu.sg
--
-- and these are still rejected:
--   name@notsmu.edu.sg        (no dot before smu.edu.sg)
--   name@evil-smu.edu.sg      (hyphen, not a subdomain separator)
--   name@smu.edu.sg.evil.com  (smu.edu.sg not at the end)
--
-- The two LIKE patterns mirror the isSmuEmail() regex in
-- js/admin/settings-page.js. Keep them in step.
--
-- Run once in the SQL Editor on a project deployed before this change.
-- Fresh installs from 0001 already have the wider rule and can skip it.
-- Idempotent: safe to re-run.
-- ============================================================

begin;

-- The domain CHECK is auto-named on the inline column constraint, so find it
-- by definition rather than by name.
do $$
declare c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.admins'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%smu.edu.sg%'
  loop
    execute format('alter table public.admins drop constraint %I', c);
  end loop;
end $$;

alter table public.admins
  add constraint admins_email_domain_check
  check (email like '%@smu.edu.sg' or email like '%@%.smu.edu.sg');

commit;

-- ------------------------------------------------------------
-- Verify (run separately; should return zero rows):
--   select email from public.admins
--    where not (email like '%@smu.edu.sg' or email like '%@%.smu.edu.sg');
-- ------------------------------------------------------------
