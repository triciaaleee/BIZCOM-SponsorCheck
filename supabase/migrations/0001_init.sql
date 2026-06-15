-- ============================================================
-- 0001_init.sql  —  BIZCOM SponsorCheck schema
--
-- Run this FIRST in the Supabase SQL Editor, then run 0002_seed.sql.
-- Mirrors the data model in js/lib/mock-data.js (PRD §13).
--
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY
-- IF EXISTS throughout.
-- ============================================================

-- ---------- Extensions -------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;     -- trigram fuzzy match (matcher.js fallback)

-- ============================================================
-- TABLES
-- ============================================================

-- 15 canonical industries (PRD §11.1). Referenced by sponsors + submission rows.
create table if not exists public.industries (
  code         text primary key,
  display_name text not null,
  sort_order   int  not null default 0
);

-- Master sponsor list. `category` is the vetting status; `normalised` is the
-- lower-cased / suffix-stripped key the matcher does its exact lookup on and
-- is supplied by the app via the shared normalize() helper.
create table if not exists public.sponsors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  normalised   text not null unique,
  industry     text not null references public.industries(code),
  category     text not null check (category in ('master','banned','closed','alumni')),
  notes        text not null default '',
  ban_reason   text,            -- populated when category = 'banned'
  alumni_owner text,            -- populated when category = 'alumni'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Append-only record of every time a sponsor was contacted. The rolling
-- 30-day count (used for cooldown / cap logic) is derived from this in the
-- sponsor_outreach_30d view, so the count decays correctly over time rather
-- than being a frozen integer.
create table if not exists public.outreach_log (
  id            uuid primary key default gen_random_uuid(),
  sponsor_id    uuid not null references public.sponsors(id) on delete cascade,
  contacted_at  timestamptz not null default now(),
  contacted_by  text,           -- admin email or null
  note          text
);

-- One row per club's submitted sponsor list (the admin "submission inbox").
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
  reviewed_by   text,           -- admin email or null
  reviewed_at   timestamptz,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Child rows of a submission: each company on the list plus its computed status.
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

-- EXCO whitelist + roles. Login is gated to these emails; role drives access.
-- A row here authorises the matching auth.users account to act as an admin.
create table if not exists public.admins (
  id        uuid primary key default gen_random_uuid(),
  email     text not null unique check (email like '%@sa.smu.edu.sg'),
  name      text not null,
  role      text not null default 'admin' check (role in ('super_admin','admin')),
  added_at  timestamptz not null default now(),
  added_by  text not null default 'system',
  user_id   uuid references auth.users(id) on delete set null  -- linked on first sign-in
);

-- Append-only audit trail (newest first when ordered by `at` desc).
create table if not exists public.activity_log (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  actor   text not null,        -- admin email or 'system'
  action  text not null,        -- e.g. 'sponsor.created', 'submission.status_changed'
  entity  text,                 -- sponsor name / event name / admin email
  details text
);

-- Single-row global settings (caps + cooldown window). The id check pins it
-- to exactly one row.
create table if not exists public.settings (
  id                   boolean primary key default true check (id),
  outreach_cap_per_30d int not null default 10,
  cooldown_days        int not null default 30,
  event_cap_small      int not null default 300,
  event_cap_medium     int not null default 600,
  event_cap_large      int not null default 1000,
  updated_at           timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists sponsors_category_idx       on public.sponsors (category);
create index if not exists sponsors_industry_idx       on public.sponsors (industry);
create index if not exists sponsors_normalised_trgm    on public.sponsors using gin (normalised gin_trgm_ops);
create index if not exists outreach_sponsor_idx        on public.outreach_log (sponsor_id);
create index if not exists outreach_contacted_at_idx   on public.outreach_log (contacted_at);
create index if not exists submissions_status_idx      on public.submissions (status);
create index if not exists submissions_submitted_idx   on public.submissions (submitted_at desc);
create index if not exists subsponsors_submission_idx  on public.submission_sponsors (submission_id);
create index if not exists activity_at_idx             on public.activity_log (at desc);
create index if not exists activity_actor_idx          on public.activity_log (actor);
create index if not exists activity_action_idx         on public.activity_log (action);

-- ============================================================
-- HELPER FUNCTIONS (auth) — SECURITY DEFINER so they can read the
-- admins table while bypassing its own RLS (avoids recursion).
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where a.email = (auth.jwt() ->> 'email')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where a.email = (auth.jwt() ->> 'email')
      and a.role = 'super_admin'
  );
$$;

-- Keep updated_at fresh on row changes.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sponsors_updated on public.sponsors;
create trigger trg_sponsors_updated
  before update on public.sponsors
  for each row execute function public.set_updated_at();

drop trigger if exists trg_submissions_updated on public.submissions;
create trigger trg_submissions_updated
  before update on public.submissions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_settings_updated on public.settings;
create trigger trg_settings_updated
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- VIEWS
-- ============================================================

-- Rolling 30-day contact count per sponsor (0 for sponsors never contacted).
-- Owned by the migration role, so it reads outreach_log past RLS and exposes
-- only the aggregate — anon can see counts without seeing raw contact rows.
create or replace view public.sponsor_outreach_30d as
  select
    s.id as sponsor_id,
    count(o.id) filter (where o.contacted_at >= now() - interval '30 days') as contact_count
  from public.sponsors s
  left join public.outreach_log o on o.sponsor_id = s.id
  group by s.id;

-- Live counts for the public landing/dashboard stats. Replaces the hardcoded
-- dashboardStats object — these are now computed from real rows.
create or replace view public.dashboard_stats as
  select
    (select count(*) from public.sponsors)                              as total,
    (select count(*) from public.sponsors where category = 'master')    as master,
    (select count(*) from public.sponsors where category = 'banned')    as banned,
    (select count(*) from public.sponsors where category = 'alumni')    as alumni,
    (select count(*) from public.submissions
       where submitted_at >= date_trunc('month', now()))                as submissions_this_month,
    (select count(*) from public.sponsor_outreach_30d v
       where v.contact_count >= (select outreach_cap_per_30d from public.settings limit 1)) as in_cooldown;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.industries          enable row level security;
alter table public.sponsors            enable row level security;
alter table public.outreach_log        enable row level security;
alter table public.submissions         enable row level security;
alter table public.submission_sponsors enable row level security;
alter table public.admins              enable row level security;
alter table public.activity_log        enable row level security;
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

-- ---- outreach_log: admin only (aggregates exposed via view) ----
drop policy if exists outreach_admin on public.outreach_log;
create policy outreach_admin on public.outreach_log for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- submissions: anyone may submit; only admins read/manage ----
drop policy if exists submissions_insert on public.submissions;
drop policy if exists submissions_read   on public.submissions;
drop policy if exists submissions_update on public.submissions;
drop policy if exists submissions_delete on public.submissions;
create policy submissions_insert on public.submissions for insert with check (true);
create policy submissions_read   on public.submissions for select using (public.is_admin());
create policy submissions_update on public.submissions for update
  using (public.is_admin()) with check (public.is_admin());
create policy submissions_delete on public.submissions for delete using (public.is_admin());

-- ---- submission_sponsors: anyone may insert (children of a submission) ----
drop policy if exists subsponsors_insert on public.submission_sponsors;
drop policy if exists subsponsors_read   on public.submission_sponsors;
drop policy if exists subsponsors_update on public.submission_sponsors;
drop policy if exists subsponsors_delete on public.submission_sponsors;
create policy subsponsors_insert on public.submission_sponsors for insert with check (true);
create policy subsponsors_read   on public.submission_sponsors for select using (public.is_admin());
create policy subsponsors_update on public.submission_sponsors for update
  using (public.is_admin()) with check (public.is_admin());
create policy subsponsors_delete on public.submission_sponsors for delete using (public.is_admin());

-- ---- admins: admins read the team; super-admin manages it ----
drop policy if exists admins_read  on public.admins;
drop policy if exists admins_write on public.admins;
create policy admins_read  on public.admins for select using (public.is_admin());
create policy admins_write on public.admins for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---- activity_log: admins read + append; super-admin clears (weekly) ----
drop policy if exists activity_read   on public.activity_log;
drop policy if exists activity_insert on public.activity_log;
drop policy if exists activity_delete on public.activity_log;
create policy activity_read   on public.activity_log for select using (public.is_admin());
create policy activity_insert on public.activity_log for insert with check (public.is_admin());
create policy activity_delete on public.activity_log for delete using (public.is_super_admin());
-- (no update policy = append-only)

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
grant select on public.industries, public.sponsors, public.settings to anon, authenticated;
grant select on public.sponsor_outreach_30d, public.dashboard_stats   to anon, authenticated;

-- students can lodge a submission + its rows
grant insert on public.submissions, public.submission_sponsors to anon, authenticated;

-- admins (any signed-in user; RLS narrows to whitelisted emails)
grant select, insert, update, delete on
  public.industries, public.sponsors, public.outreach_log,
  public.submissions, public.submission_sponsors,
  public.admins, public.activity_log, public.settings
  to authenticated;
