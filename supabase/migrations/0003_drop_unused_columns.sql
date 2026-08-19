-- ============================================================
-- 0003_drop_unused_columns.sql
--
-- Applies to an ALREADY-DEPLOYED database. 0001/0002 have been updated to the
-- final shape for fresh installs; this migration brings an existing project in
-- line by dropping columns the frontend never reads:
--
--   sponsors.updated_at     (+ trigger trg_sponsors_updated)
--   sponsors.alumni_owner   (+ relax the category CHECK)
--   admins.created_at
--   settings.updated_at     (+ trigger trg_settings_updated)
--
-- (KEPT activity_log.created_at at the time; the whole table was later
--  dropped in 0005_drop_activity_log.sql.)
-- Safe to re-run: uses IF EXISTS everywhere.
-- ============================================================

begin;

-- ---- sponsors: drop updated_at (+ its trigger) and alumni_owner (+ CHECK) ----
drop trigger if exists trg_sponsors_updated on public.sponsors;

alter table public.sponsors drop constraint if exists sponsors_category_fields;

alter table public.sponsors
  drop column if exists updated_at,
  drop column if exists alumni_owner;

-- Re-add the CHECK without the alumni_owner clause (banned still needs a reason;
-- contract_ends only allowed on banned rows).
alter table public.sponsors add constraint sponsors_category_fields check (
  (category <> 'banned' or ban_reason is not null) and
  (contract_ends is null or category = 'banned')
);

-- ---- admins: drop created_at ------------------------------------------------
alter table public.admins drop column if exists created_at;

-- ---- settings: drop updated_at (+ its trigger) ------------------------------
drop trigger if exists trg_settings_updated on public.settings;
alter table public.settings drop column if exists updated_at;

commit;
