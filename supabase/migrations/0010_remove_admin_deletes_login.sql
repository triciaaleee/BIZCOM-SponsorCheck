-- ============================================================
-- 0010_remove_admin_deletes_login.sql
--
-- Makes "Remove" in Settings delete the person's login as well as
-- their whitelist row.
--
-- The problem: removing an admin only deleted the `admins` row. Their
-- Supabase Auth account stayed behind, so they still appeared under
-- Authentication > Users forever. Harmless (every RLS policy checks
-- is_admin(), and login-page.js signs a non-whitelisted account
-- straight back out) but it left orphan accounts piling up, and if the
-- person was ever re-added they would silently sign in with their old
-- password instead of onboarding afresh.
--
-- Why a function: deleting from auth.users cannot be done with the
-- publishable key, and the service_role key must never ship in browser
-- code. A SECURITY DEFINER function runs with the privileges of the
-- role that created it (postgres, via the SQL Editor), which is the
-- standard way to do this without a backend.
--
-- This also moves the two safety rules server-side. They were only
-- enforced in settings-page.js before, so a determined super-admin
-- could bypass them by calling the REST API directly:
--   * the super-admin seat cannot be removed (transfer it first)
--   * you cannot remove yourself
--
-- Atomic on purpose: if the auth.users delete fails, the whole thing
-- rolls back and the admin row stays. A loud failure is better than
-- half-removing someone and believing they are gone.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

create or replace function public.remove_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.admins%rowtype;
  v_caller text := auth.jwt() ->> 'email';
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_target from public.admins where email = lower(trim(p_email));
  if not found then
    raise exception 'admin % is not on the team', p_email;
  end if;
  if v_target.role = 'super_admin' then
    raise exception 'cannot remove the super-admin, transfer the role first';
  end if;
  if v_target.email = v_caller then
    raise exception 'cannot remove yourself';
  end if;

  -- Whitelist row first; admins.user_id is ON DELETE SET NULL against
  -- auth.users, so this ordering keeps the reference from interfering.
  delete from public.admins where email = v_target.email;

  -- Then the login itself. Prefer the linked id; fall back to the email
  -- for admins added before link_admin_user() started recording it (0008).
  if v_target.user_id is not null then
    delete from auth.users where id = v_target.user_id;
  else
    delete from auth.users u where lower(u.email) = v_target.email;
  end if;
end;
$$;

grant execute on function public.remove_admin(text) to authenticated;

commit;

-- ------------------------------------------------------------
-- Sanity check before relying on this (run separately):
--   select count(*) from auth.users;
-- If that errors, this function will not be able to delete logins
-- either, and the Remove button will fail loudly rather than silently
-- half-removing someone.
--
-- Existing orphans from before this migration are not cleaned up
-- automatically. To list logins with no matching admin row:
--   select u.id, u.email from auth.users u
--    where not exists (select 1 from public.admins a
--                       where a.email = lower(u.email));
-- ------------------------------------------------------------
