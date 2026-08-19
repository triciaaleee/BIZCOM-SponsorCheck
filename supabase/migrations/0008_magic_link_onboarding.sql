-- ============================================================
-- 0008_magic_link_onboarding.sql
--
-- Supports onboarding a new admin without anyone touching the
-- Supabase dashboard.
--
-- The flow:
--   1. A super-admin adds the person in Settings (a row in `admins`).
--   2. The person opens the admin login page, enters their SMU email
--      and asks for a one-time sign-in link.
--   3. They click the link, land signed in, and set a password.
--   4. From then on they sign in with email + password, which sends
--      no email at all. That matters: the built-in Supabase mailer
--      allows only 2 emails per hour project-wide, so the link is
--      used once per admin, not on every sign-in.
--
-- Two functions are needed because neither step is possible with the
-- publishable key under existing RLS:
--
--   is_admin_email()  - the login page must know whether an address is
--                       on the whitelist BEFORE asking Supabase to send
--                       a link. Anonymous visitors cannot read `admins`
--                       (admins_read requires is_admin()), so this is a
--                       security definer wrapper that answers only
--                       yes/no. Without the gate, a stranger could
--                       trigger sign-in emails for arbitrary addresses
--                       and exhaust the 2/hour budget for everyone.
--
--   link_admin_user() - records which auth account belongs to which
--                       admin row. `admins.user_id` was declared in
--                       0001 as "linked on first sign-in" but nothing
--                       ever wrote it, so it was always NULL. Writing
--                       it needs super-admin rights under admins_write,
--                       which a new admin does not have, hence the
--                       definer. It only ever touches the caller's own
--                       row, matched on their JWT email.
--
-- PRIVACY NOTE: is_admin_email() lets an anonymous caller learn whether
-- a given address is a BIZCOM admin. For a small, publicly-known EXCO
-- team this is an acceptable trade for not letting strangers burn the
-- shared email quota. It reveals nothing beyond that yes/no.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

-- ---- Is this address on the admin whitelist? (login gate) ----
-- Deliberately returns a bare boolean and never any row data.
create or replace function public.is_admin_email(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a where a.email = lower(trim(p_email))
  );
$$;

-- ---- Link the caller's auth account to their admin row ----
-- Safe by construction: the WHERE clause is the caller's own JWT email,
-- so this cannot be used to claim or alter anyone else's row.
create or replace function public.link_admin_user()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.admins
     set user_id = auth.uid()
   where email = (auth.jwt() ->> 'email')
     and user_id is distinct from auth.uid();
end;
$$;

grant execute on function public.is_admin_email(text)  to anon, authenticated;
grant execute on function public.link_admin_user()     to authenticated;

commit;

-- ------------------------------------------------------------
-- Backfill (optional, run separately): admins who already signed in
-- before this migration have a NULL user_id, so the Settings page will
-- show them as "No login yet" until their next sign-in, which links
-- them automatically. To link them immediately instead:
--
--   update public.admins a
--      set user_id = u.id
--     from auth.users u
--    where lower(u.email) = a.email
--      and a.user_id is null;
-- ------------------------------------------------------------
