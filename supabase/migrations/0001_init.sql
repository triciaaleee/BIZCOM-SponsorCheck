-- ============================================================
-- 0001_init.sql  —  BIZCOM SponsorCheck schema (finalised)
--
-- Run this FIRST in the Supabase SQL Editor, then run 0002_seed.sql.
-- Derived from the actual admin + public pages (not the older draft):
--   public/  index.html, dashboard.html, sponsor-check.html, standing-order.html
--   admin/   home, sponsors, sponsor, vet-upload, settings, login
--
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
--
-- DESIGN NOTES
--   * One companies table (`sponsors`). Annex A and Annex B companies are just
--     `category = 'banned'` rows — described by `ban_reason`, and (for time-boxed
--     BIZCOM partners) auto-expiring via `contract_ends`. There is deliberately
--     NO separate "annex companies" table.
--   * `annex_a_categories` holds only the prohibited *category types* (Alcohol,
--     Tobacco, Foundations, …) shown on the Sponsors page — these are policy
--     rules, not companies, so they can't live in `sponsors`.
--   * Outreach cap/cooldown is an append-only `outreach_log`; the running count
--     and live cooldown state are DERIVED in the `sponsor_outreach` view, which
--     encodes the confirmed rule (count resets to 0 once a cooldown elapses).
--     Writes go through the `log_outreach()` RPC so the rule lives in one place.
--   * Submissions are admin-managed (the public checker only emails BIZCOM); RLS
--     locks submissions + line items to signed-in admins.
-- ============================================================

-- ---------- Extensions -------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;     -- trigram fuzzy match (matcher.js fallback)

-- ============================================================
-- TABLES
-- ============================================================

-- 15 canonical industries. Referenced by sponsors + submission line items.
create table if not exists public.industries (
  code         text primary key,
  display_name text not null,
  sort_order   int  not null default 0
);

-- Master company list. `category` is the vetting status; `normalised` is the
-- lower-cased / suffix-stripped key the matcher does its exact lookup on and is
-- supplied by the app via the shared normalize() helper in js/lib/matcher.js.
--
-- Banned companies (Annex A + Annex B) all live here:
--   * Annex A permanent bans  -> category='banned', ban_reason set, contract_ends NULL
--   * Board-of-Trustees cos    -> category='banned', ban_reason='Annex A, Board of Trustees'
--   * Annex B BIZCOM partners  -> category='banned', ban_reason set, contract_ends set
-- The single "currently banned?" rule used everywhere (matcher, lists, panels):
--   category='banned' AND (contract_ends IS NULL OR contract_ends >= current_date)
create table if not exists public.sponsors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  normalised   text not null unique,
  industry     text not null references public.industries(code),
  category     text not null check (category in ('approved','banned','closed','alumni')),
  notes        text not null default '',        -- used by approved, closed, and alumni notes
  ban_reason   text,                             -- required when category='banned'
  -- Annex B (time-boxed BIZCOM partner). NULL = permanent ban. A partner whose
  -- contract has lapsed drops out of the active banned set automatically.
  contract_ends date,
  -- Outreach cap/cooldown state. The running count is DERIVED (sponsor_outreach
  -- view) by counting outreach_log rows since count_reset_at. When the count hits
  -- settings.outreach_cap, cooldown_started_at is stamped; when that cooldown
  -- elapses the count is treated as reset (view returns 0) and the next
  -- log_outreach() call advances count_reset_at + clears the stamp.
  cooldown_started_at timestamptz,
  count_reset_at      timestamptz,
  created_at   timestamptz not null default now(),
  -- Field requirements mirror the sponsor form's validation.
  constraint sponsors_category_fields check (
    (category <> 'banned' or ban_reason is not null) and
    (contract_ends is null or category = 'banned')
  )
);

-- Append-only record of every logged contact. The cumulative count used for the
-- cap/cooldown is derived from this in sponsor_outreach (rows since count_reset_at).
create table if not exists public.outreach_log (
  id            uuid primary key default gen_random_uuid(),
  sponsor_id    uuid not null references public.sponsors(id) on delete cascade,
  contacted_at  timestamptz not null default now(),
  contacted_by  text,            -- admin email (set by log_outreach) or null
  note          text
);

-- Prohibited category *types* from Standing Order Annex A (not companies).
-- Rendered as tags on the admin Sponsors page. Editable reference data.
create table if not exists public.annex_a_categories (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  sort_order int  not null default 0
);

-- One row per club's submitted sponsor list (the admin Home calendar cards).
-- Admin-managed: students email their list, an admin logs/edits it here.
create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  event_name    text not null,
  club          text not null,
  contact_email text not null,
  event_size    text not null check (event_size in ('small','medium','large')),
  sponsor_count int  not null default 0,           -- reported total by the club
  submitted_at  timestamptz not null default now(),
  complete_by   date,
  status        text not null default 'new' check (status in ('new','reviewing','completed')),
  reviewed_by   text,            -- admin email or null
  reviewed_at   timestamptz,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Child rows of a submission: each company on the list + its computed status.
-- (Present in the data model; not yet read/written by any current admin page.)
create table if not exists public.submission_sponsors (
  id                  uuid primary key default gen_random_uuid(),
  submission_id       uuid not null references public.submissions(id) on delete cascade,
  position            int  not null default 0,     -- preserves list order
  name                text not null,
  status              text not null check (status in
                        ('clear','caution','cooldown','alumni','blocked','unverified','duplicate')),
  industry            text references public.industries(code),
  matched_sponsor_id  uuid references public.sponsors(id) on delete set null
);

-- EXCO whitelist + roles. Authorises the matching auth.users account as admin.
create table if not exists public.admins (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email like '%@sa.smu.edu.sg'),
  name       text not null,
  role       text not null default 'admin' check (role in ('super_admin','admin')),
  user_id    uuid references auth.users(id) on delete set null   -- linked on first sign-in
);

-- Exactly one super-admin at a time (transfer semantics). See transfer_super_admin().
create unique index if not exists admins_one_super_admin
  on public.admins (role) where role = 'super_admin';

-- Single-row global settings (caps + cooldown window). id check pins one row.
create table if not exists public.settings (
  id                boolean primary key default true check (id),
  outreach_cap      int not null default 10,
  cooldown_days     int not null default 30,
  event_cap_small   int not null default 300,
  event_cap_medium  int not null default 600,
  event_cap_large   int not null default 1000
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists sponsors_category_idx      on public.sponsors (category);
create index if not exists sponsors_industry_idx      on public.sponsors (industry);
create index if not exists sponsors_normalised_trgm   on public.sponsors using gin (normalised gin_trgm_ops);
create index if not exists outreach_sponsor_idx       on public.outreach_log (sponsor_id);
create index if not exists outreach_contacted_at_idx  on public.outreach_log (contacted_at);
create index if not exists submissions_status_idx     on public.submissions (status);
create index if not exists submissions_submitted_idx  on public.submissions (submitted_at desc);
create index if not exists subsponsors_submission_idx on public.submission_sponsors (submission_id);

-- ============================================================
-- HELPER FUNCTIONS (auth) — SECURITY DEFINER so they read `admins`
-- while bypassing its own RLS (avoids recursion).
-- ============================================================
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'));
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    where a.email = (auth.jwt() ->> 'email') and a.role = 'super_admin'
  );
$$;

-- Keep updated_at fresh on row changes. (Only `submissions` carries updated_at.)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_submissions_updated on public.submissions;
create trigger trg_submissions_updated before update on public.submissions
  for each row execute function public.set_updated_at();

-- ============================================================
-- BUSINESS-RULE FUNCTIONS (RPC)
-- ============================================================

-- Record one outreach against a sponsor, enforcing the cap/cooldown rule in a
-- single place (the server-side twin of window.Caps + vet-upload logOutreach):
--   * in an active cooldown            -> 'skipped' (no row written)
--   * a prior cooldown that has elapsed -> reset the cycle first, then log
--   * reaching the cap                 -> stamp cooldown_started_at, return 'capped'
--   * otherwise                        -> 'logged'
create or replace function public.log_outreach(p_sponsor_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cap int; v_days int; v_count int;
  v_stamp timestamptz; v_reset timestamptz;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  select outreach_cap, cooldown_days into v_cap, v_days from public.settings limit 1;

  select cooldown_started_at, count_reset_at into v_stamp, v_reset
    from public.sponsors where id = p_sponsor_id for update;
  if not found then raise exception 'sponsor % not found', p_sponsor_id; end if;

  -- Active cooldown -> not contactable.
  if v_stamp is not null and now() < v_stamp + make_interval(days => v_days) then
    return 'skipped';
  end if;

  -- Elapsed cooldown -> start a fresh cycle before counting this contact.
  if v_stamp is not null then
    update public.sponsors set count_reset_at = now(), cooldown_started_at = null
      where id = p_sponsor_id;
    v_reset := now();
  end if;

  select count(*) into v_count from public.outreach_log
    where sponsor_id = p_sponsor_id
      and contacted_at > coalesce(v_reset, '-infinity'::timestamptz);

  insert into public.outreach_log (sponsor_id, contacted_by, note)
    values (p_sponsor_id, auth.jwt() ->> 'email', p_note);
  v_count := v_count + 1;

  if v_count >= v_cap then
    update public.sponsors set cooldown_started_at = now() where id = p_sponsor_id;
    return 'capped';
  end if;
  return 'logged';
end;
$$;

-- Move the single super-admin seat to another admin, atomically (demote current
-- first so the admins_one_super_admin index is never violated mid-transfer).
create or replace function public.transfer_super_admin(p_target_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.admins where email = p_target_email) then
    raise exception 'target % is not an admin', p_target_email;
  end if;
  update public.admins set role = 'admin'       where role = 'super_admin';
  update public.admins set role = 'super_admin' where email = p_target_email;
end;
$$;

-- ============================================================
-- VIEWS
-- ============================================================

-- Cumulative outreach count + live cooldown state per sponsor. Encodes the
-- confirmed rule so reads match window.Caps.state() exactly, including the lazy
-- reset: once a cooldown has elapsed the count reads 0 (even before the next
-- write clears the stamp). Owned by the migration role, so it reads outreach_log
-- past RLS and exposes only the aggregate — anon sees counts, never raw contacts.
create or replace view public.sponsor_outreach as
  select
    s.id as sponsor_id,
    case
      when s.cooldown_started_at is not null
           and now() >= s.cooldown_started_at + make_interval(days => cfg.cooldown_days)
      then 0
      else count(o.id) filter (
        where o.contacted_at > coalesce(s.count_reset_at, '-infinity'::timestamptz)
      )
    end as contact_count,
    s.cooldown_started_at,
    (
      s.cooldown_started_at is not null
      and now() < s.cooldown_started_at + make_interval(days => cfg.cooldown_days)
    ) as in_cooldown
  from public.sponsors s
  cross join (select cooldown_days from public.settings limit 1) cfg
  left join public.outreach_log o on o.sponsor_id = s.id
  group by s.id, cfg.cooldown_days;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.industries          enable row level security;
alter table public.sponsors            enable row level security;
alter table public.outreach_log        enable row level security;
alter table public.annex_a_categories  enable row level security;
alter table public.submissions         enable row level security;
alter table public.submission_sponsors enable row level security;
alter table public.admins              enable row level security;
alter table public.settings            enable row level security;

-- ---- industries: public read, admin write ----
drop policy if exists industries_read  on public.industries;
drop policy if exists industries_write on public.industries;
create policy industries_read  on public.industries for select using (true);
create policy industries_write on public.industries for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- sponsors: public read (directory + matcher), admin write ----
drop policy if exists sponsors_read  on public.sponsors;
drop policy if exists sponsors_write on public.sponsors;
create policy sponsors_read  on public.sponsors for select using (true);
create policy sponsors_write on public.sponsors for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- outreach_log: admin only (aggregate exposed via sponsor_outreach) ----
drop policy if exists outreach_admin on public.outreach_log;
create policy outreach_admin on public.outreach_log for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- annex_a_categories: public read, admin write ----
drop policy if exists annexa_read  on public.annex_a_categories;
drop policy if exists annexa_write on public.annex_a_categories;
create policy annexa_read  on public.annex_a_categories for select using (true);
create policy annexa_write on public.annex_a_categories for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- submissions: admin only (public checker emails; it does not insert) ----
drop policy if exists submissions_all on public.submissions;
create policy submissions_all on public.submissions for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- submission_sponsors: admin only ----
drop policy if exists subsponsors_all on public.submission_sponsors;
create policy subsponsors_all on public.submission_sponsors for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- admins: admins read the team; super-admin manages it ----
drop policy if exists admins_read  on public.admins;
drop policy if exists admins_write on public.admins;
create policy admins_read  on public.admins for select using (public.is_admin());
create policy admins_write on public.admins for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---- settings: public read (caps shown to students), super-admin updates ----
drop policy if exists settings_read   on public.settings;
drop policy if exists settings_update on public.settings;
create policy settings_read   on public.settings for select using (true);
create policy settings_update on public.settings for update
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ============================================================
-- GRANTS  (RLS still gates which rows each role can touch)
-- ============================================================
grant usage on schema public to anon, authenticated;

-- public, read-only data
grant select on public.industries, public.sponsors, public.settings,
                public.annex_a_categories                     to anon, authenticated;
grant select on public.sponsor_outreach                       to anon, authenticated;

-- admins (any signed-in user; RLS narrows to whitelisted emails)
grant select, insert, update, delete on
  public.industries, public.sponsors, public.outreach_log, public.annex_a_categories,
  public.submissions, public.submission_sponsors,
  public.admins, public.settings
  to authenticated;

grant execute on function public.log_outreach(uuid, text)      to authenticated;
grant execute on function public.transfer_super_admin(text)    to authenticated;
