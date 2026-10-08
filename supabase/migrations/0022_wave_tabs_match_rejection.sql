-- ============================================================
-- 0022_wave_tabs_match_rejection.sql
--
-- Server side of the wave-tab rework on Vet & Upload.
--
-- 1. submission_sponsors.rejected_sponsor_id
--    "Not the same company". The matcher's partial-name and fuzzy
--    passes can pin a club's "KOI" on "KOI Cafe Singapore" when they
--    are different businesses. An admin can now say so, and the
--    judgement has to outlive a reload, so it is stored on the line
--    item: the page re-vets the row with that sponsor taken out of
--    the pool. A sponsor (not a flag) is stored so a company the
--    admin then adds under its own name still matches normally.
--
-- 2. record_submission_wave(p_submission_id, p_entries, p_refresh_only)
--    * p_refresh_only: the page now saves every list the moment it is
--      uploaded, and later edits (a confirmed link, a rejected match,
--      a lapsed cooldown) only ever touch rows that already exist. The
--      old function inserted anything it did not recognise, so a row
--      another admin had removed in the meantime came back as a new
--      wave. Refresh-only never inserts.
--    * Carries rejected_sponsor_id, and lets a rejection clear the
--      sponsor_id it rejects (the old coalesce could never null it).
--    * One sponsor per submission. A company listed under a second
--      spelling ("KOI" in wave 1, "KOI Cafe" in wave 2) was written as
--      a second line item with the same sponsor_id. log_outreach finds
--      its line item BY sponsor_id, so one of the two could never be
--      logged. Insert and refresh now both skip a sponsor the
--      submission already holds.
--    * Refuses a completed submission.
--    * Moves a 'new' submission to 'reviewing' once its first wave is
--      saved, so the status on Home tracks the work without anyone
--      having to remember to change it.
--
-- 3. log_outreach
--    * Returns 'completed' for a completed submission, writing nothing.
--    * Finds the line item deterministically. With two line items on
--      one sponsor (data from before this migration) it used to pick
--      either; it now prefers the logged one, so the answer is a
--      stable 'duplicate' rather than a second contact for the event.
--
-- Depends on 0015. Run once in the SQL Editor. Idempotent.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. The rejected match lives on the line item
-- ------------------------------------------------------------
alter table public.submission_sponsors
  add column if not exists rejected_sponsor_id uuid
    references public.sponsors(id) on delete set null;

comment on column public.submission_sponsors.rejected_sponsor_id is
  'Set when an admin marks the matched sponsor as NOT the same company. The vetting page re-matches this row with that sponsor excluded. Written only through record_submission_wave().';

-- ------------------------------------------------------------
-- 2. record_submission_wave: refresh-only mode, rejections, one
--    sponsor per submission, completed lock, new -> reviewing
-- ------------------------------------------------------------
-- The signature changes, so the two-argument version has to go first or
-- PostgREST would see two candidates for a two-argument call.
drop function if exists public.record_submission_wave(uuid, jsonb);

create or replace function public.record_submission_wave(
  p_submission_id uuid,
  p_entries       jsonb,
  p_refresh_only  boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_sub       public.submissions%rowtype;
  v_clean     jsonb;
  v_cap       int;
  v_incoming  int;
  v_added     int := 0;
  v_refreshed int;
  v_counted   int;
  v_listed    int;
  v_wave      int;
  v_email     text := auth.jwt() ->> 'email';
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  select * into v_sub from public.submissions where id = p_submission_id for update;
  if not found then
    raise exception 'That submission no longer exists.' using errcode = 'no_data_found';
  end if;

  if v_sub.status = 'completed' then
    raise exception 'This submission is completed. Reopen it on Home to change it.';
  end if;

  select case v_sub.event_size
           when 'small'  then event_cap_small
           when 'medium' then event_cap_medium
           else               event_cap_large
         end
    into v_cap
    from public.settings limit 1;
  v_cap := coalesce(v_cap, 2147483647);

  -- De-duplicate the payload once, then read it twice (refresh, then insert).
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
    into v_clean
    from (
      select distinct on (btrim(x.normalised))
             btrim(x.company_name)   as company_name,
             btrim(x.normalised)     as normalised,
             x.sponsor_id            as sponsor_id,
             coalesce(x.status, '')  as status,
             x.rejected_sponsor_id   as rejected_sponsor_id
        from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb))
          as x(company_name text, normalised text, sponsor_id uuid, status text,
               rejected_sponsor_id uuid)
       where btrim(coalesce(x.normalised, ''))   <> ''
         and btrim(coalesce(x.company_name, '')) <> ''
       order by btrim(x.normalised)
    ) e;

  select count(*) into v_incoming
    from jsonb_to_recordset(v_clean)
      as i(company_name text, normalised text, sponsor_id uuid, status text, rejected_sponsor_id uuid);

  -- (a) Refresh companies whose verdict has moved since they were recorded.
  --     Contacted rows are history and are left alone. A rejection may clear
  --     the sponsor it rejects; otherwise a missing sponsor_id keeps the one
  --     on record. A sponsor already held by another line item is not taken.
  update public.submission_sponsors ss
     set status              = i.status,
         sponsor_id          = case when i.rejected_sponsor_id is not null then i.sponsor_id
                                    else coalesce(i.sponsor_id, ss.sponsor_id) end,
         rejected_sponsor_id = i.rejected_sponsor_id
    from jsonb_to_recordset(v_clean)
      as i(company_name text, normalised text, sponsor_id uuid, status text, rejected_sponsor_id uuid)
   where ss.submission_id = p_submission_id
     and ss.normalised    = i.normalised
     and ss.outreach_logged_at is null
     and (i.sponsor_id is null or not exists (
           select 1 from public.submission_sponsors o
            where o.submission_id = p_submission_id
              and o.sponsor_id    = i.sponsor_id
              and o.id <> ss.id))
     and (ss.status is distinct from i.status
          or ss.sponsor_id is distinct from
             (case when i.rejected_sponsor_id is not null then i.sponsor_id
                   else coalesce(i.sponsor_id, ss.sponsor_id) end)
          or ss.rejected_sponsor_id is distinct from i.rejected_sponsor_id);
  get diagnostics v_refreshed = row_count;

  -- (b) Insert the genuinely new companies as the next wave, unless this is
  --     a refresh. One line item per sponsor: the first spelling in the
  --     payload wins, and a sponsor already on the submission is skipped.
  if not coalesce(p_refresh_only, false) then
    select coalesce(max(wave), 0) + 1 into v_wave
      from public.submission_sponsors where submission_id = p_submission_id;

    insert into public.submission_sponsors
      (submission_id, wave, company_name, normalised, sponsor_id, status,
       rejected_sponsor_id, recorded_by)
    select p_submission_id, v_wave, i.company_name, i.normalised, i.sponsor_id, i.status,
           i.rejected_sponsor_id, v_email
      from (
        select x.*, row_number() over (partition by x.sponsor_id order by x.normalised) as rn
          from jsonb_to_recordset(v_clean)
            as x(company_name text, normalised text, sponsor_id uuid, status text,
                 rejected_sponsor_id uuid)
      ) i
     where i.sponsor_id is null
        or (i.rn = 1 and not exists (
              select 1 from public.submission_sponsors o
               where o.submission_id = p_submission_id
                 and o.sponsor_id    = i.sponsor_id))
    on conflict (submission_id, normalised) do nothing;
    get diagnostics v_added = row_count;
  end if;

  -- The first saved wave means somebody is working on it.
  if v_added > 0 and v_sub.status = 'new' then
    update public.submissions set status = 'reviewing' where id = p_submission_id;
  end if;

  -- No cap check: recording a company is not approaching it, so it cannot
  -- breach the cap. log_outreach owns that rule (0015).
  select count(*) filter (where outreach_logged_at is not null), count(*)
    into v_counted, v_listed
    from public.submission_sponsors where submission_id = p_submission_id;

  select coalesce(max(wave), 0) into v_wave
    from public.submission_sponsors where submission_id = p_submission_id;

  return jsonb_build_object(
    'wave',       v_wave,
    'added',      v_added,
    'refreshed',  v_refreshed,
    'skipped',    case when coalesce(p_refresh_only, false) then 0 else v_incoming - v_added end,
    'counted',    v_counted,
    'listed',     v_listed,
    'cap',        v_cap,
    'event_size', v_sub.event_size);
end;
$fn$;

grant execute on function public.record_submission_wave(uuid, jsonb, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. log_outreach: completed lock, deterministic line lookup
--    (otherwise identical to 0015)
-- ------------------------------------------------------------
create or replace function public.log_outreach(
  p_sponsor_id    uuid,
  p_note          text default null,
  p_submission_id uuid default null
) returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_cap int; v_days int; v_count int;
  v_stamp timestamptz; v_reset timestamptz;
  v_line_id uuid;
  v_logged  timestamptz;
  v_status  text;
  v_sub     public.submissions%rowtype;
  v_event_cap int;
  v_used    int;
  v_result  text;
  v_email   text := auth.jwt() ->> 'email';
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  -- Submission-scoped rules, before anything is written.
  if p_submission_id is not null then
    -- Lock the submission so two admins logging at once cannot both pass the
    -- cap check and jointly overshoot it.
    select * into v_sub from public.submissions where id = p_submission_id for update;
    if not found then return 'not_recorded'; end if;

    -- A completed submission is history.
    if v_sub.status = 'completed' then return 'completed'; end if;

    -- A logged line item first, so a sponsor held twice (pre-0022 data)
    -- answers 'duplicate' every time instead of being contacted twice.
    select id, outreach_logged_at, status into v_line_id, v_logged, v_status
      from public.submission_sponsors
     where submission_id = p_submission_id and sponsor_id = p_sponsor_id
     order by (outreach_logged_at is null), recorded_at
     limit 1
     for update;

    -- Not on the submission: record the wave first.
    if not found then return 'not_recorded'; end if;

    -- Already contacted for this event. One outreach per company per event.
    if v_logged is not null then return 'duplicate'; end if;

    -- Not a company this event may approach at all.
    if not public.counts_toward_cap(v_status) then return 'not_approachable'; end if;

    -- The event cap, which counts contacts rather than records.
    select case v_sub.event_size
             when 'small'  then event_cap_small
             when 'medium' then event_cap_medium
             else               event_cap_large
           end
      into v_event_cap
      from public.settings limit 1;
    v_event_cap := coalesce(v_event_cap, 2147483647);

    select count(*) into v_used
      from public.submission_sponsors
     where submission_id = p_submission_id and outreach_logged_at is not null;

    if v_used + 1 > v_event_cap then return 'event_capped'; end if;
  end if;

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

  insert into public.outreach_log (sponsor_id, contacted_by, note, submission_id)
    values (p_sponsor_id, v_email, p_note, p_submission_id);
  v_count := v_count + 1;

  if v_count >= v_cap then
    update public.sponsors set cooldown_started_at = now() where id = p_sponsor_id;
    v_result := 'capped';
  else
    v_result := 'logged';
  end if;

  -- Stamping the line item is what moves submissions.sponsor_count, via the
  -- trigger on submission_sponsors.
  if v_line_id is not null then
    update public.submission_sponsors
       set outreach_logged_at = now(), outreach_logged_by = v_email
     where id = v_line_id;
  end if;

  return v_result;
end;
$fn$;

commit;

-- ------------------------------------------------------------
-- Verify (run separately, signed in as an admin):
--
-- 1. The column exists:
--      select rejected_sponsor_id from public.submission_sponsors limit 1;
--
-- 2. Refresh-only never inserts:
--      select public.record_submission_wave('<submission>',
--        '[{"company_name":"Nowhere Co","normalised":"nowhere","status":"review"}]', true);
--    -> "added": 0, and no "nowhere" row on the submission.
--
-- 3. A completed submission refuses both writes:
--      record_submission_wave(...)            -> raises
--      log_outreach('<sponsor>', null, '<id>') -> 'completed'
-- ------------------------------------------------------------
