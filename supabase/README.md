# Supabase backend — BIZCOM SponsorCheck

This folder holds the finalised database schema and seed data for the app. It is
derived from the **actual admin + public pages** (not the earlier draft), so it
is the source of truth for the backend build.

> 📘 For a visual, plain-English walkthrough of the whole database — the ER
> diagram, every foreign key, the business rules, and how each screen uses the
> data — see **[`DATABASE_GUIDE.md`](DATABASE_GUIDE.md)**. This README is the
> build/ops guide; the guide is the conceptual reference.

| Project URL | `https://qapczpyehtyybwyqbfov.supabase.co` |
| ----------- | ------------------------------------------- |

## How to run

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the full contents of [`migrations/0001_init.sql`](migrations/0001_init.sql) and **Run**.
3. New query → paste [`migrations/0002_seed.sql`](migrations/0002_seed.sql) and **Run**.

Both scripts are safe to re-run — `0001` uses `IF NOT EXISTS` / `CREATE OR
REPLACE`, and `0002` guards every insert so it won't create duplicates.

**Already deployed an earlier version?** `0001`/`0002` won't alter existing
tables, so run [`migrations/0003_drop_unused_columns.sql`](migrations/0003_drop_unused_columns.sql)
once to bring a live project in line (it drops `sponsors.updated_at`,
`sponsors.alumni_owner`, `admins.created_at`, `settings.updated_at`). Fresh
installs from `0001` already have the final shape and can skip it.

## What gets created

**Tables**

| Table | Purpose |
| ----- | ------- |
| `industries` | 15 canonical industry codes |
| `sponsors` | every company — name, normalised key, industry, category (`approved`/`prohibited`/`closed`/`alumni`), notes, ban_reason, contract_ends, cooldown state |
| `outreach_log` | append-only contact events; the running count is derived from this |
| `annex_a_categories` | prohibited *category types* from Standing Order Annex A (Alcohol, Tobacco, …) — reference data, not companies |
| `submissions` | one row per club's submitted sponsor list (admin-managed Home calendar) |
| `submission_sponsors` | the companies on each submission + their computed status |
| `admins` | EXCO whitelist + role (`super_admin`/`admin`); at most one super-admin |
| `settings` | single-row caps + cooldown window |

**Views**

- `sponsor_outreach` — `(sponsor_id, contact_count, cooldown_started_at, in_cooldown)`. Encodes the confirmed cap rule, **including the reset**: once a cooldown elapses `contact_count` reads `0`. Public-readable, but exposes only the aggregate (raw `outreach_log` rows stay admin-only).

**Functions (RPC)**

- `log_outreach(sponsor_id, note?)` → `'logged' | 'capped' | 'skipped'`. The server-side twin of the app's cap logic: rejects contacts during an active cooldown, resets an elapsed cooldown, writes the `outreach_log` row, and stamps `cooldown_started_at` on reaching the cap. **Use this instead of inserting into `outreach_log` directly** so the rule lives in one place.
- `transfer_super_admin(target_email)` — atomically moves the single super-admin seat (demotes the current holder first so the one-super-admin index is never violated).
- `is_admin()` / `is_super_admin()` — RLS helpers, matching the JWT `email` claim against `admins`.

## Key modelling decisions

### 1. Annex A + Annex B companies are just `prohibited` sponsors
There is **no separate annex-companies table**. Everything prohibited/restricted
lives in `sponsors` with `category = 'prohibited'`, distinguished by:

- `ban_reason` — free text (`'Annex A, Gaming & Betting'`, `'Annex A, Board of Trustees'`, `'Annex B, BIZCOM partner'`, …)
- `contract_ends` — set only for **time-boxed BIZCOM partners** (Annex B). `NULL` = permanently prohibited. A partner whose contract has lapsed drops out of the active prohibited set automatically.

The single "currently prohibited?" rule used by the matcher, lists and panels is:

```
category = 'prohibited' AND (contract_ends IS NULL OR contract_ends >= current_date)
```

The Board-of-Trustees companies are seeded as prohibited sponsors too (so the checker
flags them). The Sponsors-page "Board of Trustees" panel lists them by querying
`ban_reason = 'Annex A, Board of Trustees'`. Only the prohibited **category
types** (which aren't companies) live in `annex_a_categories`.

### 2. Submissions are admin-managed
The public checker (`sponsor-check.html`) only **emails** BIZCOM — it does not
write to the database. Admins log/edit each club's submission on the Home
calendar. RLS therefore locks `submissions` + `submission_sponsors` to signed-in
admins (no anonymous insert). If you later add a public submit form, add an
`anon` INSERT policy and generate the row id client-side with `crypto.randomUUID()`.

### 3. Admins must also exist in Supabase Auth
The `admins` table is the **whitelist + roles**. To actually log in, each admin
needs an account in **Authentication → Users** whose email matches exactly:

- `biz@sa.smu.edu.sg` (super admin)
- `biz.deputy@sa.smu.edu.sg`
- `biz.outreach@sa.smu.edu.sg`

RLS authorises them by matching the JWT `email` claim against `admins` via
`is_admin()` / `is_super_admin()`. Optionally store `auth.users.id` in
`admins.user_id` on first sign-in, but the email match is what RLS uses.

### 4. `normalised` is supplied by the app
The normalisation rules (lower-case, strip `Pte`/`Ltd`/`LLP`, drop parenthesised
locales, `&` → `and`) live in `js/lib/matcher.js` — keep that the single source
of truth. When the admin app inserts/updates a sponsor, compute `normalised` with
the shared `normalise()` helper rather than duplicating the logic in SQL.

> Note: `sponsor-page.js` / `sponsors-page.js` currently use a **simpler** inline
> `normalise()` that does *not* strip legal suffixes. When wiring the backend,
> switch those to `Matcher.normalise()` so a saved key can't drift from the
> lookup key (a mismatch would let a prohibited company read as "unverified").

### 5. Security model (RLS) at a glance

| Data | Public (anon) | Signed-in admin |
| ---- | ------------- | --------------- |
| industries, sponsors, settings, annex_a_categories | read | read + write¹ |
| `sponsor_outreach` view | read | read |
| submissions / submission_sponsors | none | full |
| outreach_log | none | full (write via `log_outreach`) |
| admins | none | read; **super-admin** writes |
| settings updates | none | **super-admin** only |

¹ `settings` writes are super-admin only; the rest are any admin.

## Changed vs the earlier draft
- Renamed `sponsors.category` `banned` -> `prohibited` and `submission_sponsors.status` `blocked` -> `prohibited` (0006), standardising the term across both sites.
- Dropped `activity_log` (0005): it was write-only, nothing ever read it back.
- Added `annex_a_categories` (types only).
- Added `log_outreach()` + `transfer_super_admin()` RPCs and the one-super-admin index.
- `sponsor_outreach` now resets `contact_count` to 0 when a cooldown elapses (previously it kept counting).
- Submissions are admin-only (removed the anonymous-insert flow — the app emails instead).
- Dropped the unused `dashboard_stats` view (no page reads it; the public dashboard counts client-side, and the admin list uses a paged `count`).
- Field-integrity `CHECK`s mirror the sponsor form (prohibited⇒ban_reason, contract_ends only when prohibited).

## Next step (not done yet)
Wire the frontend to these tables: add the `supabase-js` client + config, then
replace the `MOCK_DATA` reads page by page. Ping me when you're ready.
