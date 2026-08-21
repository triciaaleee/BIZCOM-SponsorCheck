-- ============================================================
-- 0011_settings_editable_by_any_admin.sql
--
-- Lets any signed-in admin edit the outreach cap, cooldown window
-- and per-event sponsor limits. Previously only the super-admin
-- could, so the whole Settings page was hidden from normal admins.
--
--   before: settings_update  using (is_super_admin())
--   after:  settings_update  using (is_admin())
--
-- Deliberately unchanged: `admins_write` still requires
-- is_super_admin(). Managing the team (invite, rename, remove,
-- transfer the role) stays a super-admin job. Normal admins can
-- already READ the team via admins_read, which is is_admin(), so the
-- Settings page can show the roster read-only without any change
-- here. The UI hides the team actions for them, and this policy is
-- what actually enforces it: a normal admin calling the REST API
-- directly still cannot write to `admins`.
--
-- The remove_admin() and transfer_super_admin() RPCs also check
-- is_super_admin() internally, so they stay closed too.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update
  using (public.is_admin()) with check (public.is_admin());

commit;

-- ------------------------------------------------------------
-- Verify (run separately as a normal admin; should succeed now):
--   update public.settings set outreach_cap = outreach_cap;
--
-- And this should still fail for a normal admin:
--   update public.admins set name = name;
-- ------------------------------------------------------------
