# Supabase backend — BIZCOM SponsorCheck

This folder holds the database schema and seed data for the app. The frontend
is **not** wired up yet (that's a later step) — for now these scripts stand up a
real backend that mirrors `js/lib/mock-data.js`.

| Project URL | `https://qapczpyehtyybwyqbfov.supabase.co` |
| ----------- | ------------------------------------------- |

## How to run

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the full contents of [`migrations/0001_init.sql`](migrations/0001_init.sql) and **Run**.
3. New query → paste [`migrations/0002_seed.sql`](migrations/0002_seed.sql) and **Run**.

Both scripts are safe to re-run — `0001` uses `IF NOT EXISTS` / `CREATE OR
REPLACE`, and `0002` guards every insert so it won't create duplicates.

## What gets created

**Tables**

| Table | Purpose |
| ----- | ------- |
| `industries` | 15 canonical industry codes |
| `sponsors` | master list — name, normalised key, industry, category (`master`/`banned`/`closed`/`alumni`), notes, ban_reason, alumni_owner |
| `outreach_log` | append-only contact events; the rolling 30-day count is derived from this |
| `submissions` | one row per club's submitted sponsor list |
| `submission_sponsors` | the companies on each submission + their computed status |
| `admins` | EXCO whitelist + role (`super_admin`/`admin`) |
| `activity_log` | append-only audit trail |
| `settings` | single-row caps + cooldown window |

**Views**

- `sponsor_outreach` — `(sponsor_id, contact_count, cooldown_started_at, in_cooldown)`. `contact_count` is the cumulative outreach total since the sponsor's `count_reset_at`; `in_cooldown` reflects the `cooldown_started_at` timer against `settings.cooldown_days`. Public-readable, but exposes only the aggregate (raw `outreach_log` rows stay admin-only).
- `dashboard_stats` — live counts (total / master / banned / alumni / submissions this month / in cooldown) computed from real rows.

## Important notes

### 1. The old `dashboardStats` numbers are gone on purpose
The mock had inflated demo figures (`total: 12403`, etc.). Those are **not**
seeded — `dashboard_stats` now returns the *real* counts from the seeded data
(30 sponsors, 7 submissions, …). When you connect the frontend, read from the
view instead of hardcoding.

### 2. Admins must also exist in Supabase Auth
The `admins` table is just the **whitelist + roles**. For someone to actually
log in (email + password), they need a real account in **Authentication →
Users**. Create one account per admin email:

- `biz@sa.smu.edu.sg` (super admin)
- `biz.deputy@sa.smu.edu.sg`
- `biz.outreach@sa.smu.edu.sg`

Use **Add user → Create new user** (set a password, mark email confirmed), or
send an invite. RLS authorises them by matching the JWT's `email` claim against
the `admins` table via the `is_admin()` / `is_super_admin()` functions — so the
email on the auth account **must match exactly** the email in `admins`.

> Tip: when an admin first signs in, you can store their `auth.users.id` in
> `admins.user_id` if you want a hard FK link, but the email match is what RLS
> uses.

### 3. Security model (RLS) at a glance

| Data | Public (anon) | Signed-in admin |
| ---- | ------------- | --------------- |
| industries, sponsors, settings | read | read + write |
| `sponsor_outreach`, `dashboard_stats` | read | read |
| submissions / submission_sponsors | **insert only** (lodge a list) | full read + manage |
| outreach_log | none | full |
| admins | none | read; **super-admin** writes |
| activity_log | none | read + append; **super-admin** deletes |
| settings updates | none | **super-admin** only |

### 4. Public submission flow — generate the id client-side
Because anon can `INSERT` a submission but cannot `SELECT` it back, don't rely
on `insert().select()` to return the new id for an anonymous submit. Instead,
generate the UUID in the browser (`crypto.randomUUID()`), insert the parent
`submissions` row and its `submission_sponsors` children with that same known
id, so no read-back is needed.

### 5. `normalised` is supplied by the app
The matcher's normalisation rules (lower-case, strip suffixes like `PTE`/`Ltd`)
live in `js/lib/matcher.js`. Keep that the single source of truth: when the
admin app inserts/updates a sponsor, compute `normalised` with the shared
`normalize()` helper rather than duplicating the logic in SQL. A `pg_trgm` GIN
index on `sponsors.normalised` is already in place to support the fuzzy
fallback when you move matching server-side.

## Next step (not done yet)
Wire the frontend to these tables: add the `supabase-js` client + config, then
replace the `MOCK_DATA` reads page by page. Ping me when you're ready.
