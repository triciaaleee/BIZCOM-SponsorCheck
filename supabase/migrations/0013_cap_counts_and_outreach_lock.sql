-- ============================================================
-- 0013_cap_counts_and_outreach_lock.sql
--
-- Corrects what an event cap actually counts, and stops the same
-- company being contacted twice for the same event.
--
-- 0012 got the meaning of the cap wrong. It counted every company a
-- club listed. But the cap is "how many sponsors this event may
-- APPROACH", not "how many names the club may send". A club sending
-- 14 companies of which 5 are prohibited or closed has used 9 of its
-- cap, not 14.
--
-- Three changes.
--
-- 1. Only approachable companies count.
--    counts_toward_cap() is the single definition, used by both the
--    recalc trigger and the wave RPC:
--
--      counts:         approved, alumni
--      does not count: prohibited, closed, cooldown, review
--
--    Alumni count because they ARE approachable once OAR has cleared
--    them. Cooldown does not, because the company cannot be contacted
--    right now. "review" (not on the database) does not, because
--    nothing is known about it yet.
--
--    Every listed company is still STORED, so you keep the full
--    record of what the club sent and why each was rejected. Only
--    the count changes. submissions.listed_count carries the raw
--    total alongside sponsor_count.
--
-- 2. A company's status can be refreshed by a later wave.
--    0012's unique constraint meant a company recorded once was
--    frozen. That broke two real cases: a company in cooldown in
--    wave 1 that reopens by wave 3, and a company that was "not on
--    the database" until an admin added it in step 2. Both must be
--    able to start counting. record_submission_wave() now refreshes
--    the status of an existing row, but ONLY while no outreach has
--    been logged against it. Once you have approached a company, its
--    record of why is history and stops moving.
--
-- 3. Outreach is logged once per company per submission.
--    log_outreach() takes an optional p_submission_id. When given it
--    stamps submission_sponsors.outreach_logged_at, refuses a second
--    log for that pair ('duplicate'), and refuses a company that is
--    not on the submission at all ('not_recorded'). outreach_log
--    also gains submission_id, so the contact history finally records
--    WHICH event a contact was for - something it could never say
--    before.
--
--    No new table is needed for any of this: submission_sponsors is
--    already exactly one row per (submission, company).
--
-- Ordering this imposes on the admin: resolve unknown companies in
-- step 2, record the wave, THEN log outreach. A company cannot be
-- contacted for an event it was never recorded against.
--
-- Depends on 0012. Run once in the SQL Editor. Idempotent.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. The single definition of "counts towards the event cap"
-- ------------------------------------------------------------
-- Kept as a function rather than a CHECK constraint or a stored
-- boolean so the rule lives in one place and changing it is one
-- CREATE OR REPLACE plus a recount, not a data migration. Statuses
-- outside this list simply do not count, which is the safe default
-- if the matcher ever grows a new bucket.
create or replace function public.counts_toward_cap(p_status text)
returns boolean language sql immutable as $fn$
  select coalesce(p_status, '') in ('approved', 'alumni');
$fn$;

-- ------------------------------------------------------------
-- 2. Outreach lock lives on the line item
-- ------------------------------------------------------------
alter table public.submission_sponsors
  add column if not exists outreach_logged_at timestamptz,
  add column if not exists outreach_logged_by text;

comment on column public.submission_sponsors.outreach_logged_at is
  'Set by log_outreach() when this company is contacted for this submission. Non-null means it cannot be logged again for the same submission, and its status is frozen.';

-- Which event a contact was for. Nullable: outreach logged outside a
-- submission (or before this migration) simply has no event.
alter table public.outreach_log
  add column if not exists submission_id uuid references public.submissions(id) on delete set null;

create index if not exists outreach_submission_idx on public.outreach_log (submission_id);

-- Raw "how many names did the club send", alongside the capped count.
alter table public.submissions
  add column if not exists listed_count int not null default 0;

comment on column public.submissions.sponsor_count is
  'Derived: companies on this submission that count towards the event cap (see counts_toward_cap). Trigger-maintained; not writable by the client.';
comment on column public.submissions.listed_count is
  'Derived: every company the club listed, including prohibited/closed/cooldown ones that do not consume cap. Same trigger, same lockdown.';

-- ------------------------------------------------------------
-- 3. Recount: sponsor_count is now the capped subset
-- ------------------------------------------------------------
create or replace function public.recalc_submission_totals(p_submission_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update public.submissions s
     set sponsor_count = (select count(*) filter (where public.counts_toward_cap(ss.status))
                            from public.submission_sponsors ss where ss.submission_id = p_submission_id),
         listed_count  = (select count(*)
                            from public.submission_sponsors ss where ss.submission_id = p_submission_id),
         wave_count    = (select coalesce(max(ss.wave), 0)
                            from public.submission_sponsors ss where ss.submission_id = p_submission_id)
   where s.id = p_submission_id;
$fn$;

-- The trigger already fires on status updates (0012 declared it for
-- insert/update/delete), so refreshing a status recounts automatically.

-- Re-derive every submission under the corrected rule. Counts recorded
-- under 0012 were inflated by prohibited/closed/cooldown rows; this is
-- what brings them back in line.
update public.submissions s
   set sponsor_count = (select count(*) filter (where public.counts_toward_cap(ss.status))
                          from public.submission_sponsors ss where ss.submission_id = s.id),
       listed_count  = (select count(*)
                          from public.submission_sponsors ss where ss.submission_id = s.id),
       wave_count    = (select coalesce(max(ss.wave), 0)
                          from public.submission_sponsors ss where ss.submission_id = s.id);

-- ------------------------------------------------------------
-- 4. Recording a wave: refresh, insert, then check the cap
-- ------------------------------------------------------------
-- Writes first and validates after, on purpose. An unhandled exception
-- aborts the transaction, so a rejected wave rolls back both the status
-- refresh and the insert - nothing is left half-applied. Doing it this
-- way means the cap is checked against the real post-merge count rather
-- than an arithmetic guess, which is what 0012 got wrong.
create or replace function public.record_submission_wave(
  p_submission_id uuid,
  p_entries       jsonb
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_sub       public.submissions%rowtype;
  v_clean     jsonb;
  v_cap       int;
  v_before    int;
  v_incoming  int;
  v_added     int;
  v_refreshed int;
  v_counted   int;
  v_listed    int;
  v_wave      int;
  v_email     text := auth.jwt() ->> 'email';
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  -- Lock the submission so two admins recording at once cannot both pass the
  -- cap check and jointly overshoot it.
  select * into v_sub from public.submissions where id = p_submission_id for update;
  if not found then
    raise exception 'That submission no longer exists.' using errcode = 'no_data_found';
  end if;

  select case v_sub.event_size
           when 'small'  then event_cap_small
           when 'medium' then event_cap_medium
           else               event_cap_large
         end
    into v_cap
    from public.settings limit 1;
  v_cap := coalesce(v_cap, 2147483647);   -- no settings row: do not block work

  v_before := v_sub.sponsor_count;

  -- De-duplicate the payload on normalised. A club's own list can repeat a
  -- company; the vetting screen flags those and does not send them, but the
  -- guard stays here because this function owns the rule.
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
    into v_clean
    from (
      select distinct on (btrim(x.normalised))
             btrim(x.company_name)   as company_name,
             btrim(x.normalised)     as normalised,
             x.sponsor_id            as sponsor_id,
             coalesce(x.status, '')  as status
        from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb))
          as x(company_name text, normalised text, sponsor_id uuid, status text)
       where btrim(coalesce(x.normalised, ''))   <> ''
         and btrim(coalesce(x.company_name, '')) <> ''
       order by btrim(x.normalised)
    ) e;

  select count(*) into v_incoming
    from jsonb_to_recordset(v_clean) as i(company_name text, normalised text, sponsor_id uuid, status text);

  -- (a) Refresh companies already on this submission whose verdict has moved
  --     since they were recorded: a cooldown that has since lapsed, or an
  --     unknown company an admin has since added to the database. Rows that
  --     have already been contacted are left alone - that record is history.
  update public.submission_sponsors ss
     set status     = i.status,
         sponsor_id = coalesce(i.sponsor_id, ss.sponsor_id)
    from jsonb_to_recordset(v_clean)
      as i(company_name text, normalised text, sponsor_id uuid, status text)
   where ss.submission_id = p_submission_id
     and ss.normalised    = i.normalised
     and ss.outreach_logged_at is null
     and (ss.status is distinct from i.status
          or ss.sponsor_id is distinct from coalesce(i.sponsor_id, ss.sponsor_id));
  get diagnostics v_refreshed = row_count;

  -- (b) Insert the genuinely new companies as the next wave. If none are new,
  --     no row carries v_wave, so max(wave) is unchanged and no wave is burnt.
  select coalesce(max(wave), 0) + 1 into v_wave
    from public.submission_sponsors where submission_id = p_submission_id;

  insert into public.submission_sponsors
    (submission_id, wave, company_name, normalised, sponsor_id, status, recorded_by)
  select p_submission_id, v_wave, i.company_name, i.normalised, i.sponsor_id, i.status, v_email
    from jsonb_to_recordset(v_clean)
      as i(company_name text, normalised text, sponsor_id uuid, status text)
  on conflict (submission_id, normalised) do nothing;
  get diagnostics v_added = row_count;

  -- (c) Validate against the real post-merge totals.
  select count(*) filter (where public.counts_toward_cap(status)), count(*)
    into v_counted, v_listed
    from public.submission_sponsors where submission_id = p_submission_id;

  if v_counted > v_cap then
    raise exception
      'Over the cap for a % event. % of % already counted, this list takes it to % (% over). Only approved and alumni companies count towards the cap.',
      v_sub.event_size, v_before, v_cap, v_counted, v_counted - v_cap
      using errcode = 'check_violation';
  end if;

  select coalesce(max(wave), 0) into v_wave
    from public.submission_sponsors where submission_id = p_submission_id;

  return jsonb_build_object(
    'wave',       v_wave,
    'added',      v_added,
    'refreshed',  v_refreshed,
    'skipped',    v_incoming - v_added,
    'counted',    v_counted,
    'listed',     v_listed,
    'cap',        v_cap,
    'event_size', v_sub.event_size);
end;
$fn$;

-- ------------------------------------------------------------
-- 5. log_outreach becomes submission-aware
-- ------------------------------------------------------------
-- The 2-argument version is dropped and replaced by a 3-argument one whose
-- third parameter defaults to null, so an existing caller that passes only
-- p_sponsor_id/p_note keeps working and simply records no event.
drop function if exists public.log_outreach(uuid, text);

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
  v_result  text;
  v_email   text := auth.jwt() ->> 'email';
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  -- Submission-scoped rules, before anything is written.
  if p_submission_id is not null then
    select id, outreach_logged_at into v_line_id, v_logged
      from public.submission_sponsors
     where submission_id = p_submission_id and sponsor_id = p_sponsor_id
     for update;

    -- Not on the submission: record the wave first. This is what forces the
    -- order "resolve unknowns -> record the wave -> log outreach".
    if not found then return 'not_recorded'; end if;

    -- Already contacted for this event. One outreach per company per event.
    if v_logged is not null then return 'duplicate'; end if;
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

  -- Stamp the line item so the vetting screen can lock this company's tick box
  -- for this submission, and so its status stops being refreshed by later waves.
  if v_line_id is not null then
    update public.submission_sponsors
       set outreach_logged_at = now(), outreach_logged_by = v_email
     where id = v_line_id;
  end if;

  return v_result;
end;
$fn$;

grant execute on function public.log_outreach(uuid, text, uuid)        to authenticated;
grant execute on function public.counts_toward_cap(text)               to authenticated, anon;

commit;

-- ------------------------------------------------------------
-- Verify (run separately, signed in as an admin):
--
-- 1. Only approachable companies count. On a submission holding a mix:
--      select status, count(*), bool_and(public.counts_toward_cap(status)) as counts
--        from public.submission_sponsors
--       where submission_id = '<uuid>' group by status;
--      select sponsor_count, listed_count, wave_count
--        from public.submissions where id = '<uuid>';
--    sponsor_count must equal the total of the rows where counts = true;
--    listed_count must equal every row.
--
-- 2. Outreach cannot be logged twice for one event:
--      select public.log_outreach('<sponsor-uuid>', null, '<submission-uuid>');
--    -> 'logged' the first time, 'duplicate' every time after.
--
-- 3. A company not on the submission is refused:
--      select public.log_outreach('<some-other-sponsor>', null, '<submission-uuid>');
--    -> 'not_recorded'
--
-- 4. The contact history now knows which event it was for:
--      select sponsor_id, contacted_by, submission_id from public.outreach_log
--       order by contacted_at desc limit 5;
--
-- 5. A contacted company is frozen. Re-record the wave with a different
--    status for that company; its row must NOT change:
--      select status, outreach_logged_at from public.submission_sponsors
--       where submission_id = '<uuid>' and sponsor_id = '<sponsor-uuid>';
-- ------------------------------------------------------------
