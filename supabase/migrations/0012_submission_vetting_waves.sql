-- ============================================================
-- 0012_submission_vetting_waves.sql
--
-- Links the admin Home calendar's club submissions to the Vet &
-- Upload page, so a submission's sponsor count is a fact the system
-- derives rather than a number an admin types in.
--
-- Three things change.
--
-- 1. `submission_sponsors` comes back - this time wired up.
--    0009 dropped it because nothing read or wrote it. It now holds
--    one row per company vetted under a submission, written by the
--    Vet & Upload page through record_submission_wave() below. This
--    is exactly the "single migration plus the read/write paths"
--    that 0009 said restoring it would cost.
--
--    Deliberately NO check constraint on `status`: 0009's main
--    complaint about the old table was that its status CHECK had to
--    be kept in step with the matcher's vocabulary (0006 spent half
--    its length on that rename). The column is a snapshot of what
--    the vetting screen showed at the time, so it is free text.
--
-- 2. Waves. A club rarely sends its whole list at once. Every call
--    to record_submission_wave() that records at least one new
--    company gets the next wave number for that submission, so the
--    history of "they sent 120, then 80, then 40" survives.
--    Re-recording a company already on the submission is a no-op
--    (unique on submission_id + normalised), so re-uploading the
--    same CSV cannot inflate the count.
--
-- 3. The event cap moves server-side. record_submission_wave()
--    reads settings.event_cap_{small,medium,large} for the
--    submission's event_size and refuses a wave that would push the
--    total past it. Same pattern as log_outreach(): the cap rule
--    lives in one place, on the server, so the browser cannot talk
--    its way around it.
--
-- And the bug fix: submissions.sponsor_count was a plain int the
-- Home side-panel let anyone edit. It is now maintained by a trigger
-- from submission_sponsors, and column-level grants stop the client
-- writing it at all - a REST call that tries is rejected, not just a
-- disabled input. Same for the new wave_count.
--
-- MIGRATION NOTE: existing sponsor_count values are recomputed from
-- submission_sponsors, which starts empty. Every existing submission
-- therefore resets to 0 and climbs again as its lists are recorded
-- through the vetting page. The old figures were self-reported and
-- unverified, so nothing checkable is lost.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Line items: one row per company vetted under a submission
-- ------------------------------------------------------------
create table if not exists public.submission_sponsors (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  wave          int  not null default 1 check (wave >= 1),
  company_name  text not null,              -- as the club wrote it
  normalised    text not null,              -- Matcher.normalise(company_name)
  sponsor_id    uuid references public.sponsors(id) on delete set null,
  status        text not null default '',   -- vetting bucket at the time; see header
  recorded_by   text,                       -- admin email (not an FK, like outreach_log)
  recorded_at   timestamptz not null default now(),
  -- One row per company per submission: a later wave re-listing the same
  -- company is skipped rather than counted twice.
  constraint submission_sponsors_unique unique (submission_id, normalised)
);

create index if not exists subsponsors_submission_idx on public.submission_sponsors (submission_id);
create index if not exists subsponsors_sponsor_idx    on public.submission_sponsors (sponsor_id);

-- ------------------------------------------------------------
-- 2. Derived totals on the parent row
-- ------------------------------------------------------------
alter table public.submissions
  add column if not exists wave_count int not null default 0;

comment on column public.submissions.sponsor_count is
  'Derived: number of companies recorded in submission_sponsors. Maintained by trg_subsponsors_totals; not writable by the client (see grants).';
comment on column public.submissions.wave_count is
  'Derived: highest wave number recorded for this submission. Same trigger.';

-- SECURITY DEFINER on purpose: the column-level grants further down stop
-- `authenticated` updating sponsor_count/wave_count, so the trigger has to
-- run as the owner to write them.
create or replace function public.recalc_submission_totals(p_submission_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update public.submissions s
     set sponsor_count = (select count(*)                  from public.submission_sponsors ss where ss.submission_id = p_submission_id),
         wave_count    = (select coalesce(max(ss.wave), 0) from public.submission_sponsors ss where ss.submission_id = p_submission_id)
   where s.id = p_submission_id;
$fn$;

-- NEW and OLD cannot both be read: in PL/pgSQL, OLD is unassigned on INSERT
-- and NEW on DELETE, and touching an unassigned record is an error. Branch on
-- TG_OP instead, and recalculate both sides if an update moved a row between
-- submissions.
create or replace function public.sync_submission_totals()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_new_id uuid;
  v_old_id uuid;
begin
  if tg_op <> 'DELETE' then v_new_id := new.submission_id; end if;
  if tg_op <> 'INSERT' then v_old_id := old.submission_id; end if;

  if v_new_id is not null then
    perform public.recalc_submission_totals(v_new_id);
  end if;
  if v_old_id is not null and v_old_id is distinct from v_new_id then
    perform public.recalc_submission_totals(v_old_id);
  end if;
  return null;
end;
$fn$;

-- Row-level rather than statement-level with transition tables: a wave is at
-- most one event cap's worth of rows (1000 for a large event), so the repeated
-- recount costs milliseconds and the trigger stays readable.
drop trigger if exists trg_subsponsors_totals on public.submission_sponsors;
create trigger trg_subsponsors_totals
  after insert or update or delete on public.submission_sponsors
  for each row execute function public.sync_submission_totals();

-- Bring every existing submission in line with the trigger's definition.
update public.submissions s
   set sponsor_count = (select count(*)                  from public.submission_sponsors ss where ss.submission_id = s.id),
       wave_count    = (select coalesce(max(ss.wave), 0) from public.submission_sponsors ss where ss.submission_id = s.id);

-- ------------------------------------------------------------
-- 3. The cap rule, server-side
-- ------------------------------------------------------------
-- Records one wave of a club's list against a submission.
--   p_entries: [{ company_name, normalised, sponsor_id, status }, ...]
--   returns:   { wave, added, skipped, total, cap, event_size }
--
-- Rules, in order:
--   * caller must be an admin
--   * the payload is de-duplicated on normalised (a club's own list can
--     repeat a company; the vetting screen flags those as duplicates)
--   * companies already on this submission are skipped, not re-counted
--   * the total after this wave must stay within the event-size cap, else
--     the whole call is rejected and nothing is written
--   * a wave that adds nothing new does not burn a wave number
create or replace function public.record_submission_wave(
  p_submission_id uuid,
  p_entries       jsonb
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_sub      public.submissions%rowtype;
  v_clean    jsonb;
  v_cap      int;
  v_existing int;
  v_incoming int;
  v_new      int;
  v_wave     int;
  v_email    text := auth.jwt() ->> 'email';
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

  -- De-duplicate the payload once, then read it twice (count, then insert).
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

  select count(*) into v_existing
    from public.submission_sponsors where submission_id = p_submission_id;

  -- How many of the incoming companies are new to this submission. The left
  -- join cannot multiply rows: submission_sponsors is unique on
  -- (submission_id, normalised), so count(ss.id) is exactly the already-known
  -- ones and the difference is what this wave would add.
  select count(*), count(*) - count(ss.id)
    into v_incoming, v_new
    from jsonb_to_recordset(v_clean)
      as i(company_name text, normalised text, sponsor_id uuid, status text)
    left join public.submission_sponsors ss
      on ss.submission_id = p_submission_id
     and ss.normalised    = i.normalised;

  if v_new = 0 then
    return jsonb_build_object(
      'wave', v_sub.wave_count, 'added', 0, 'skipped', v_incoming,
      'total', v_existing, 'cap', v_cap, 'event_size', v_sub.event_size);
  end if;

  if v_existing + v_new > v_cap then
    raise exception
      'Over the cap for a % event. % already recorded, this wave adds % new, cap is %.',
      v_sub.event_size, v_existing, v_new, v_cap
      using errcode = 'check_violation';
  end if;

  select coalesce(max(wave), 0) + 1 into v_wave
    from public.submission_sponsors where submission_id = p_submission_id;

  insert into public.submission_sponsors
    (submission_id, wave, company_name, normalised, sponsor_id, status, recorded_by)
  select p_submission_id, v_wave, i.company_name, i.normalised, i.sponsor_id, i.status, v_email
    from jsonb_to_recordset(v_clean)
      as i(company_name text, normalised text, sponsor_id uuid, status text)
  on conflict (submission_id, normalised) do nothing;

  return jsonb_build_object(
    'wave', v_wave, 'added', v_new, 'skipped', v_incoming - v_new,
    'total', v_existing + v_new, 'cap', v_cap, 'event_size', v_sub.event_size);
end;
$fn$;

-- ------------------------------------------------------------
-- 4. Row-level security + grants
-- ------------------------------------------------------------
alter table public.submission_sponsors enable row level security;

-- Admin-only, matching `submissions` itself.
drop policy if exists subsponsors_all on public.submission_sponsors;
create policy subsponsors_all on public.submission_sponsors for all
  using (public.is_admin()) with check (public.is_admin());

-- Read and delete only. INSERT/UPDATE are withheld on purpose so every write
-- goes through record_submission_wave() and cannot skip the cap check - the
-- same reasoning as log_outreach() owning the outreach cap. Delete stays open
-- so an admin can drop a company recorded against the wrong submission.
grant select, delete on public.submission_sponsors to authenticated;
grant execute on function public.record_submission_wave(uuid, jsonb) to authenticated;

-- Lock sponsor_count + wave_count away from the client. Table-level INSERT and
-- UPDATE are replaced by column lists, so a REST call naming either derived
-- column is rejected outright rather than merely hidden by the UI.
revoke insert, update on public.submissions from authenticated;
grant insert (event_name, club, contact_email, event_size, submitted_at,
              complete_by, status, reviewed_by, reviewed_at, notes)
  on public.submissions to authenticated;
grant update (event_name, club, contact_email, event_size, submitted_at,
              complete_by, status, reviewed_by, reviewed_at, notes)
  on public.submissions to authenticated;

commit;

-- ------------------------------------------------------------
-- Verify (run separately, signed in as an admin):
--
-- 1. The count is derived and cannot be typed in - this must FAIL
--    with "permission denied for table submissions":
--      update public.submissions set sponsor_count = 999;
--
-- 2. Everything else on a submission is still editable:
--      update public.submissions set notes = notes;
--
-- 3. Waves accumulate and stop at the cap. With a small-event
--    submission (cap 300 by default):
--      select public.record_submission_wave(
--        '<submission-uuid>',
--        '[{"company_name":"Test Co","normalised":"test co","status":"review"}]'::jsonb);
--    -> {"wave":1,"added":1,"skipped":0,"total":1,...}
--    Re-running the same call returns added 0, skipped 1, wave unchanged.
--
-- 4. The trigger kept the parent row honest:
--      select sponsor_count, wave_count from public.submissions where id = '<uuid>';
-- ------------------------------------------------------------
