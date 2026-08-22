-- ============================================================
-- 0015_cap_counts_contacted_only.sql
--
-- Moves the event cap from "recorded" to "contacted".
--
-- 0013 had submissions.sponsor_count count every approachable
-- company recorded against a submission. That made recording a
-- club's list consume the cap, which is wrong: writing a company
-- down is not approaching it. A club can send 400 names, have 300
-- of them approvable, and still only ever contact 120 — under the
-- old rule they had "used" 300 of their cap for outreach that never
-- happened.
--
-- After this migration:
--
--   sponsor_count = companies with outreach_logged_at set
--                 = how many sponsors this event has ACTUALLY approached
--
-- Which is what the cap has always meant in the Standing Order.
--
-- Two knock-on changes:
--
-- 1. record_submission_wave() no longer rejects a wave for breaching
--    the cap, because recording can no longer breach it. Recording
--    stays free: the submission should hold the whole list the club
--    sent, whatever the cap is. The function still returns the
--    totals so the UI can warn.
--
-- 2. log_outreach() takes the cap check over. Given a submission it
--    refuses a contact that would push the event past its cap and
--    returns 'event_capped', writing nothing. This is now the only
--    place the event cap is enforced, which is also the only place
--    it can be: the outreach is the thing being capped.
--
-- counts_toward_cap() is kept. It no longer decides the count, but
-- the UI still uses it to say which companies are *eligible* to be
-- contacted, and log_outreach uses it as a guard.
--
-- Existing counts are recomputed, so a submission that recorded 300
-- companies but contacted 40 drops from 300 to 40. That is the
-- correction, not data loss: the line items are untouched.
--
-- Depends on 0013. Run once in the SQL Editor. Idempotent.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. The count is now the contacted subset
-- ------------------------------------------------------------
comment on column public.submissions.sponsor_count is
  'Derived: companies on this submission with outreach_logged_at set, i.e. how many sponsors this event has actually approached. This is what the event cap limits. Trigger-maintained; not writable by the client.';

create or replace function public.recalc_submission_totals(p_submission_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update public.submissions s
     set sponsor_count = (select count(*) filter (where ss.outreach_logged_at is not null)
                            from public.submission_sponsors ss where ss.submission_id = p_submission_id),
         listed_count  = (select count(*)
                            from public.submission_sponsors ss where ss.submission_id = p_submission_id),
         wave_count    = (select coalesce(max(ss.wave), 0)
                            from public.submission_sponsors ss where ss.submission_id = p_submission_id)
   where s.id = p_submission_id;
$fn$;

-- Re-derive every submission under the corrected rule.
update public.submissions s
   set sponsor_count = (select count(*) filter (where ss.outreach_logged_at is not null)
                          from public.submission_sponsors ss where ss.submission_id = s.id),
       listed_count  = (select count(*)
                          from public.submission_sponsors ss where ss.submission_id = s.id),
       wave_count    = (select coalesce(max(ss.wave), 0)
                          from public.submission_sponsors ss where ss.submission_id = s.id);

-- ------------------------------------------------------------
-- 2. Recording no longer touches the cap
-- ------------------------------------------------------------
create or replace function public.record_submission_wave(
  p_submission_id uuid,
  p_entries       jsonb
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_sub       public.submissions%rowtype;
  v_clean     jsonb;
  v_cap       int;
  v_incoming  int;
  v_added     int;
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
             coalesce(x.status, '')  as status
        from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb))
          as x(company_name text, normalised text, sponsor_id uuid, status text)
       where btrim(coalesce(x.normalised, ''))   <> ''
         and btrim(coalesce(x.company_name, '')) <> ''
       order by btrim(x.normalised)
    ) e;

  select count(*) into v_incoming
    from jsonb_to_recordset(v_clean) as i(company_name text, normalised text, sponsor_id uuid, status text);

  -- (a) Refresh companies whose verdict has moved since they were recorded.
  --     Contacted rows are history and are left alone.
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

  -- (b) Insert the genuinely new companies as the next wave.
  select coalesce(max(wave), 0) + 1 into v_wave
    from public.submission_sponsors where submission_id = p_submission_id;

  insert into public.submission_sponsors
    (submission_id, wave, company_name, normalised, sponsor_id, status, recorded_by)
  select p_submission_id, v_wave, i.company_name, i.normalised, i.sponsor_id, i.status, v_email
    from jsonb_to_recordset(v_clean)
      as i(company_name text, normalised text, sponsor_id uuid, status text)
  on conflict (submission_id, normalised) do nothing;
  get diagnostics v_added = row_count;

  -- No cap check: recording a company is not approaching it, so it cannot
  -- breach the cap. log_outreach owns that rule now.
  select count(*) filter (where outreach_logged_at is not null), count(*)
    into v_counted, v_listed
    from public.submission_sponsors where submission_id = p_submission_id;

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
-- 3. log_outreach enforces the event cap
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

    select id, outreach_logged_at, status into v_line_id, v_logged, v_status
      from public.submission_sponsors
     where submission_id = p_submission_id and sponsor_id = p_sponsor_id
     for update;

    -- Not on the submission: record the wave first.
    if not found then return 'not_recorded'; end if;

    -- Already contacted for this event. One outreach per company per event.
    if v_logged is not null then return 'duplicate'; end if;

    -- Not a company this event may approach at all.
    if not public.counts_toward_cap(v_status) then return 'not_approachable'; end if;

    -- The event cap, which now counts contacts rather than records.
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
-- 1. The count is the contacted subset:
--      select sponsor_count, listed_count,
--             (select count(*) from public.submission_sponsors ss
--               where ss.submission_id = s.id and ss.outreach_logged_at is not null) as contacted
--        from public.submissions s where id = '<uuid>';
--    sponsor_count must equal contacted, and be <= listed_count.
--
-- 2. Recording does NOT move the count. Record a wave, then re-check
--    sponsor_count: unchanged. listed_count goes up.
--
-- 3. Logging DOES move it, and stops at the cap:
--      select public.log_outreach('<sponsor>', null, '<submission>');
--    -> 'logged' until the event cap is reached, then 'event_capped'
--       with nothing written.
--
-- 4. A company that cannot be approached is refused:
--    (a prohibited/closed/unvetted line item) -> 'not_approachable'
-- ------------------------------------------------------------
