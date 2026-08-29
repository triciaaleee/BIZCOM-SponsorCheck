-- ============================================================
-- 0017_annex_categories.sql
--
-- Replaces the free-text `sponsors.ban_reason` with a foreign key
-- to a real lookup table, and splits the single "prohibited" idea
-- into the two things the Standing Order actually describes:
--
--   Annex A  -> status "Prohibited". May not be approached at all.
--               The club removes these from its list before emailing.
--   Annex B  -> status "Restricted". The club KEEPS these on the list
--               and BIZCOM decides. Existing BIZCOM clients will not be
--               approved; banks, telcos and government entities are
--               re-vetted against the club's stated purpose.
--
-- WHY A TABLE INSTEAD OF FREE TEXT
-- `ban_reason` was the only field saying which annex a company was in,
-- and it disagreed with `contract_ends` on real rows: DBS Bank and OCBC
-- Bank read "Annex B, Banks & Financial" while carrying no contract end
-- date, which the 0001 schema comment defined as Annex A. Two fields,
-- one fact, no tiebreak. A foreign key cannot be typed wrongly and
-- cannot drift, so the annex becomes unambiguous.
--
-- One table with an `annex` column, not two tables. Annex A and Annex B
-- rows are structurally identical (name + guidance note), so two tables
-- would mean duplicated shape, two nullable foreign keys on `sponsors`,
-- and a "can it be in both?" question nobody wants to answer.
--
-- WHAT `category` MEANS NOW
-- `sponsors.category` is unchanged and still holds 'prohibited' for every
-- annex-listed company, Annex A and Annex B alike. It is the umbrella
-- ("this company is on an annex"); the annex letter is what decides the
-- status the checker shows. Storing 'prohibited' vs 'restricted' in
-- `category` as well would put the same fact in two columns, which is the
-- exact failure this migration exists to remove. The wart is that the
-- umbrella is still named 'prohibited' while some of its rows display as
-- Restricted; renaming it is a separate migration and a lot of blast
-- radius, so it is left alone.
--
-- NOT INCLUDED, deliberately:
--   * Pharmaceuticals. Confirmed as not belonging to any annex, so the
--     category is not seeded and the Standing Order page drops it.
--   * Ceased operations / defunct. Now carried by `category = 'closed'`
--     and its own "Closed" status, so it is not an annex category.
--   * Insurance under Annex B. Insurance is always Annex A; the old
--     cross-reference between the two annexes is gone.
--
-- Run once in the SQL Editor. Idempotent: safe to re-run.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. The lookup table.
-- ------------------------------------------------------------
-- `note` is student-facing: it is what the checker prints under the
-- status, so it carries the difference between an Annex B company that
-- BIZCOM will never release (an existing client) and one it will simply
-- re-vet (banks, telcos, statutory boards). That difference is data, not
-- code, so BIZCOM can change the guidance without a deploy.
create table if not exists public.annex_categories (
  id          uuid primary key default gen_random_uuid(),
  annex       text not null check (annex in ('A', 'B')),
  name        text not null,
  note        text not null default '',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  constraint annex_categories_unique unique (annex, name)
);

comment on table public.annex_categories is
  'Standing Order Annex A (prohibited) and Annex B (restricted) categories. Referenced by sponsors.annex_category_id.';

-- ------------------------------------------------------------
-- 2. Seed the categories.
-- ------------------------------------------------------------
-- Annex A: the club removes these from its list. Every name here matches
-- the text after the comma in the old ban_reason values, so step 4 can
-- backfill by string match.
insert into public.annex_categories (annex, name, note, sort_order) values
  ('A', 'Alcoholic Products',  'Prohibited under Annex A. Remove from your list.',                    10),
  ('A', 'Tobacco Products',    'Prohibited under Annex A. Remove from your list.',                    20),
  ('A', 'Gaming & Betting',    'Prohibited under Annex A. Remove from your list.',                    30),
  ('A', 'Sexual Products',     'Prohibited under Annex A. Remove from your list.',                    40),
  ('A', 'Foundations',         'Prohibited under Annex A. Remove from your list.',                    50),
  ('A', 'Insurance Companies', 'Prohibited under Annex A. Remove from your list.',                    60),
  ('A', 'Board of Trustees',   'Tied to the SMU Board of Trustees. Remove from your list.',           70)
on conflict (annex, name) do nothing;

-- Annex B: the club KEEPS these on the list. BIZCOM approves or rejects.
insert into public.annex_categories (annex, name, note, sort_order) values
  ('B', 'BIZCOM partner',
        'Existing BIZCOM client. Keep it on your list, but BIZCOM will not approve an approach while the partnership runs.', 10),
  ('B', 'Banks & Financial',
        'Keep it on your list. BIZCOM will re-check why your club is approaching this company.',                             20),
  ('B', 'Telecommunications',
        'Keep it on your list. BIZCOM will re-check why your club is approaching this company.',                             30),
  ('B', 'Government-linked statutory boards',
        'Keep it on your list. BIZCOM will re-check the purpose of your approach and route it through OSL.',                 40)
on conflict (annex, name) do nothing;

-- ------------------------------------------------------------
-- 3. Point sponsors at a category.
-- ------------------------------------------------------------
-- Nullable: only prohibited/restricted companies carry one. `on delete
-- restrict` so a category still in use cannot be deleted out from under
-- the companies that reference it.
alter table public.sponsors
  add column if not exists annex_category_id uuid
    references public.annex_categories(id) on delete restrict;

create index if not exists sponsors_annex_category_idx
  on public.sponsors (annex_category_id);

-- ------------------------------------------------------------
-- 4. Backfill from the old free text, then verify.
-- ------------------------------------------------------------
-- Old values are all of the form 'Annex A, Tobacco Products'. Match on
-- the annex letter plus the text after the first comma.
update public.sponsors s
   set annex_category_id = c.id
  from public.annex_categories c
 where s.annex_category_id is null
   and s.ban_reason is not null
   and substring(s.ban_reason from 7 for 1) = c.annex
   and btrim(substring(s.ban_reason from position(',' in s.ban_reason) + 1)) = c.name;

-- Refuse to continue if any prohibited row failed to map. Better to roll
-- the whole migration back than to drop ban_reason while a company's only
-- record of WHY it is prohibited is still in that column.
do $$
declare unmapped int;
begin
  select count(*) into unmapped
    from public.sponsors
   where category = 'prohibited' and annex_category_id is null;
  if unmapped > 0 then
    raise exception 'Backfill incomplete: % prohibited sponsor(s) have no annex category. Fix ban_reason on those rows and re-run.', unmapped;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. Swap the constraint, then drop the column.
-- ------------------------------------------------------------
-- Old rule: prohibited => ban_reason present.
-- New rule: prohibited => annex_category_id present. A foreign key is a
-- stronger guarantee than "this text box is not empty".
alter table public.sponsors drop constraint if exists sponsors_category_fields;
alter table public.sponsors add  constraint sponsors_category_fields check (
  (category <> 'prohibited' or annex_category_id is not null) and
  (annex_category_id is null or category = 'prohibited') and
  (contract_ends is null or category = 'prohibited')
);

alter table public.sponsors drop column if exists ban_reason;

-- ------------------------------------------------------------
-- 6. RLS. Mirrors `industries`: anyone reads, admins write.
-- ------------------------------------------------------------
-- The public checker has to read this table to tell Prohibited from
-- Restricted, and it runs on the anon key with no login.
alter table public.annex_categories enable row level security;

drop policy if exists annex_categories_read  on public.annex_categories;
drop policy if exists annex_categories_write on public.annex_categories;
create policy annex_categories_read  on public.annex_categories for select using (true);
create policy annex_categories_write on public.annex_categories for all
  using (public.is_admin()) with check (public.is_admin());

commit;

-- ------------------------------------------------------------
-- Verify (run separately):
--
--   select annex, count(*) from public.annex_categories group by annex;
--     -- expect A = 7, B = 4
--
--   select c.annex, c.name, count(s.id) as companies
--     from public.annex_categories c
--     left join public.sponsors s on s.annex_category_id = c.id
--    group by c.annex, c.name order by c.annex, c.name;
--     -- expect 23 companies across Annex A, 12 across Annex B
--
--   select count(*) from public.sponsors where category = 'prohibited'
--                                          and annex_category_id is null;
--     -- must be 0
-- ------------------------------------------------------------
