<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Side Hustle Assistant Implementation Plan

- **Plan**: context/changes/side-hustle-assistant/plan.md
- **Scope**: Phase 1 of 6
- **Reviewed phases**: 1
- **Date**: 2026-10-26
- **Verdict**: NEEDS ATTENTION (round 1); APPROVED (round 2, see below)
- **Findings**: 0 critical, 3 warnings, 4 observations

Reviewed `git diff main...HEAD` (commits `68e5b67`, `b4c650a`, `c16a8a9`) against Phase 1, Critical Implementation Details and the Review decisions (including the three new Phase 1 rows). The migration was compared with the live schema of `gigsqrnwyeioqlkngfqe` using read-only catalog queries only (`pg_constraint`, `pg_indexes`, `information_schema.triggers`, `pg_policies`, `pg_views`, `role_table_grants`) plus `SELECT`s on `channels`, `content_items`, `tasks`, `weekly_stats`. Nothing was applied or written.

## What was verified (no finding)

- **In-place rename is safe.** Every object name the migration references exists on live with exactly that name: `channels_pkey`, `channels_slug_key`, `channels_yt_channel_id_key`, `content_items_channel_id_fkey`, `weekly_stats_channel_id_fkey`, `content_items_channel_id_idx`. `ALTER INDEX … RENAME` on a constraint-backed index also renames its constraint, so the PK/unique constraints end up as `projects_*`. Nothing is dropped.
- **Dependents survive.** The FKs (`ON DELETE SET NULL` / `CASCADE`), the `weekly_stats_pkey (channel_id, week_start)` PK (its column follows the rename), the `touch` trigger, the `owner_all` policy and `v_xp_events` (column reference by attnum; output columns unchanged, `security_invoker=true` kept) are all bound by OID and follow the renames. `touch_updated_at()` only special-cases `tasks` and `content_items` by `tg_table_name`, so it works unchanged on `projects`, `gates`, `video_daily`.
- **New tables.** `gates` and `video_daily` have RLS enabled, an `owner_all` policy for `authenticated`, `anon` revoked (matches live: `anon` has no grants on any existing table), and the `touch` trigger. `v_video_recent` is `security_invoker = true`, so it is filtered by `video_daily`'s RLS; `anon` revoked, `authenticated` gets select.
- **Data section.** Live has exactly one `channels` row (`sceny-sezonowe`, `yt_channel_id` null), so the Slowfall update hits it and the unique `yt_channel_id` cannot clash. `i01` and `i03` exist; `yt_video_id` values do not collide with other rows. The task mapping matches the Review decisions row; all listed `legacy_id`s exist and the only gap in t01–t26 is `t12`, which does not exist on live. Gates insert yields 2 rows (join on the renamed `slowfall-scenes`). After apply: `projects = 3`, `gates = 2`, as criterion 1.1 expects.
- **Run-once safety.** No `if not exists`, so a second run fails on the first statement (`relation "public.channels" does not exist`) before changing anything; no data-destroying statements anywhere.
- **No code reads `channels` / `channel_id`.** `grep` over `src/` finds only `yt_channel_id` and one comment (`src/lib/game.ts:25`). `loadAll` reads `projects`, `gates`, `v_video_recent`; `saveRow`/`archiveRow` key weeks on `project_id`; the empty "—" project option is saved as `null` (`Sheet.tsx` submit trims `""` to `null`), so no invalid-uuid writes.
- **Code contract.** `loadAll(db = supabase())`, `Data.projects/gates/videos`, `Project`/`Gate`/`GateRule`/`VideoRecent` types, project picker on tasks/items/weeks/subs and project chips on task rows, cost rows and subscription cards match the plan and the "Phase 1 Sheet" decision.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Apply/merge order guarantees a broken window and the two docs disagree

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261026120000_projects.sql:3
- **Detail**: The migration header says "Do not apply before the matching code is merged", while plan "Migration Notes" says "apply the phase 1 migration right before merging its PR". Either order breaks the live app until the other half lands: before the migration, the new `loadAll` fails on `projects`/`gates`/`v_video_recent`; after the migration but before the deploy, the live `main` build fails on `channels`. `loadAll` uses `Promise.all` + `check`, so any one failing read blanks the whole app (all tabs). The plan accepts a short gap, but the window also includes the Workers Builds deploy time, and the backup step from Migration Notes is not done yet.
- **Fix**: Make the header match the plan (apply immediately before merge) and run a fixed sequence: JSON backup of all tables → `apply_migration` → `select count(*)` checks (projects = 3, gates = 2) → merge → wait for the Workers Build → reload on the phone.
  - Strength: One documented order; the gap is bounded by one build (minutes) for a single-user app.
  - Tradeoff: Still a few minutes of a blank app; avoiding it would need a compatibility view `channels` plus a second cleanup migration, which is not worth it here.
  - Confidence: HIGH — both failure modes follow directly from the table names in `src/lib/data.ts:13-24`.
  - Blind spot: Actual Workers Builds duration not measured.
- **Must fix before apply**: yes (procedure and header comment, not schema).
- **Decision**: Accepted — fixed in 6c08dcf

### F2 — New `owner_all` policies call `is_owner()` per row instead of `(select is_owner())`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261026120000_projects.sql:94-95
- **Detail**: Every live `owner_all` policy is `using ((select is_owner()))` / `with check ((select is_owner()))` (initPlan, evaluated once per statement). The new policies use bare `public.is_owner()`, a `security definer` function that queries `app_owners` with `auth.jwt()`, so it runs once per row. Harmless for `gates`, but `video_daily` grows by one row per video per day and is read through `v_video_recent` on every load; Supabase's performance advisor flags this pattern (`auth_rls_initplan`). Fixing it later needs a second migration.
- **Fix**: Use `using ((select public.is_owner())) with check ((select public.is_owner()))` on both policies.
- **Must fix before apply**: recommended (one-line change now vs. a follow-up migration later).
- **Decision**: Accepted — fixed in 6c08dcf

### F3 — Slowfall row picked by `order by created_at limit 1`, not by explicit slug

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261026120000_projects.sql:104
- **Detail**: Review decision F1 says "explicit slugs". The update targets "the oldest row" instead of `slug = 'sceny-sezonowe'`. It works on live today (exactly one row, verified), but it is the one statement in the data section whose target is implicit; on any other database (a branch, a restore with extra rows) it would silently rename the wrong project and the gates would attach to it.
- **Fix**: `where slug = 'sceny-sezonowe'` (the live slug).
- **Must fix before apply**: recommended.
- **Decision**: Accepted — fixed in 6c08dcf

### F4 — Pre-apply checklist items are not in the repo

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/changes/side-hustle-assistant/plan.md:397-401
- **Detail**: The migration is not idempotent, which is fine (a re-run fails harmlessly at line 7), but its atomicity relies on `apply_migration` running the file as one transaction. If it is ever run another way (e.g. statement by statement in the SQL editor) and fails mid-way, it leaves a half-renamed schema. The JSON backup is still a manual step.
- **Fix**: Apply only via `apply_migration` (single transaction), after the JSON backup; do not paste it into the SQL editor in pieces.
- **Decision**: Accepted — no change

### F5 — `v_video_recent.weeks` includes partial weeks at both ends

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261026120000_projects.sql:73
- **Detail**: `date >= current_date - 35` is a rolling 36-day window, so the oldest week in `weeks` is usually cut and the newest is incomplete (plus the ~2-day report lag). This matches the decision row, but Phase 2 rules (`impressions_wow_rising`, the impressions-drop alert) must apply the plan's "complete week" definition themselves, otherwise a partial week reads as a drop.
- **Fix**: In Phase 2, filter `weeks` to complete weeks (Sunday ≥ 3 days before today) before any week-over-week comparison; no schema change.
- **Decision**: Deferred to Phase 2 (complete-week filter)

### F6 — `i01` already has its video id on live

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261026120000_projects.sql:111
- **Detail**: Live `i01.yt_video_id` is already `yL4czbAFQ54` (the plan's Current State says `yt_video_id` is empty). The update is a harmless no-op; `i03` is the only real change.
- **Fix**: None needed.
- **Decision**: Accepted — no change

### F7 — Success criteria: 1.1 and manual checks still open; automated checks not re-run here

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/side-hustle-assistant/plan.md:442-450
- **Detail**: 1.2–1.4 are marked `[x]` against `b4c650a`; they were not re-run in this review (the review worktree has no `node_modules`; the code here is identical to that commit). 1.1 is correctly left open until the migration is applied. Manual 1.5 (tabs, XP, badges on the phone) and 1.6 (project picker and chip) are pending and can only be checked after apply + deploy. Expect XP to be unchanged: `v_xp_events` week refs change only in name, and `weekly_stats` has 0 rows.
- **Fix**: After apply, run the 1.1 counts and tick 1.1; then do 1.5/1.6 on the phone.
- **Decision**: Accepted — no change

## Before the migration is applied

1. F1 — agree the order (backup → apply → counts → merge → build) and fix the header comment.
2. F2 — wrap `is_owner()` in `(select …)` in both new policies (recommended; otherwise a follow-up migration).
3. F3 — target the Slowfall row by `slug = 'sceny-sezonowe'` (recommended).

Everything else can wait for Phase 2 or the manual checks.

Note: per the orchestrating session's instruction, only this file is committed; `change.md` was not stamped `impl_reviewed`.

---

## Round 2 — expand + contract split (2026-10-26)

- **Scope**: diff `6223768..1001100` — `supabase/migrations/20261026120000_projects.sql` (EXPAND), new `supabase/migrations/20261026130000_projects_cleanup.sql` (CONTRACT), plan Migration Notes / Review decisions / Progress 1.1, 1.7.
- **Reviewed phases**: 1
- **Verdict (round 2)**: APPROVED
- **Findings (round 2)**: 0 critical, 1 warning, 4 observations
- Round 1 F1 (broken window) is resolved by the split; the F2 and F3 fixes are present (`…projects.sql:124-125`, `:134`).

Checked against `git show origin/main:src/lib/data.ts` / `src/components/Sheet.tsx` (old code) and the Phase 1 code, plus read-only catalog queries on live (PostgreSQL 17.11): column lists of `channels`, `content_items`, `weekly_stats`; `pg_depend` rewrite dependencies; default ACLs; event triggers; and `SELECT` counts. Nothing was applied or written.

### What was verified (no finding)

- **Compat view `channels`** (`…projects.sql:26-29`): exactly the 7 live columns (`id, slug, name, niche, yt_channel_id, created_at, updated_at`), a single-table select with no expressions, so it is auto-updatable (an insert or update through it would hit `projects`, with base defaults for `kind`/`status`). `main` only reads it (`select("id,name,niche").order("created_at")`) and never writes. With `security_invoker = true`, the `owner_all` RLS on `projects` applies to the caller. Default ACLs would grant `anon` everything on a new view; line 28 revokes that, and line 29 matches the existing table grants. The table rename frees the name in the same transaction, so `create view` cannot clash. The old app will list 3 channels in its pickers (expected).
- **Backfill before triggers**: `update … set project_id = channel_id` (`:34-35`) runs before the triggers exist (`:51-54`), and the unique index (`:37`) is built after the backfill (`weekly_stats` has 0 rows today anyway).
- **Sync trigger** (`:41-54`), case by case:
  - Old-code insert (`channel_id` only) → `project_id := channel_id`. New-code insert (`project_id` only) → `channel_id := project_id`. This is filled *before* the NOT NULL / PK check on `weekly_stats.channel_id`, so new-code inserts into `weekly_stats` succeed.
  - Old-code update of items (`out` carries `channel_id`, including `null` for "—") → `project_id` follows. New-code update (`project_id`) → `channel_id` follows. Neither code version ever sends both columns (Sheet `submit` only emits `FIELDS` keys), so the "both changed" rule is never hit.
  - Upsert `onConflict: "channel_id,week_start"` (old) uses the still-present PK as arbiter. `onConflict: "project_id,week_start"` (new) is inferred from `weekly_stats_project_week_key` (unique, non-partial). Because the two keys are always equal, a conflict on one is a conflict on the other, so the non-arbiter index never raises. On the DO UPDATE path PostgREST sets only payload columns, and `EXCLUDED` already carries the BEFORE INSERT result. The UPDATE trigger then sees no key change → no-op.
  - New code setting `weekly_stats.project_id` to null → `channel_id := null` → NOT NULL error (fails loudly, no corruption).
  - No recursion: the function only assigns `NEW` and runs no DML. Its order relative to `touch` (alphabetical: `sync_project_channel`, then `touch`) does not matter.
  - FK actions: on a hard project removal, the `channel_id` SET NULL action fires the trigger, which nulls `project_id` too; the second SET NULL then matches no rows. `weekly_stats` cascades through either FK. The app only soft-archives projects.
- **`v_xp_events` after EXPAND**: the only rewrite dependency on `weekly_stats`/`content_items` columns is `v_xp_events` (`pg_rewrite` 17727, including `weekly_stats.channel_id` att 1). It keeps reading `channel_id`, which stays, so its output is unchanged.
- **`v_xp_events` in CONTRACT** (`…cleanup.sql:13-26`): same column names, order and types (`kind text, ref text, title text, at timestamptz, xp int`), so `create or replace` is accepted. `security_invoker` is restated, and grants survive `create or replace`. Week `ref` values are identical (`project_id = channel_id`), so XP and badges don't change. The view is recreated *before* `drop column channel_id` (`:32`), so the drop has no dependent view and needs no CASCADE.
- **CONTRACT drops only redundant objects**: the compat view, the two triggers, the function, the old PK (replaced at `:31` with `using index`, which renames the index to `weekly_stats_pkey`), and the two duplicate `channel_id` columns (their FKs and `content_items_channel_id_idx` go with them). The `project_id` FKs, `content_items_project_id_idx`, RLS and all `owner_all` policies are untouched. The word "delete" does not occur in the cleanup file.
- **Applies once via `apply_migration`**: every referenced name exists on live. The new auto-named FKs (`content_items_project_id_fkey`, `weekly_stats_project_id_fkey`) and the new index names don't clash, because the old ones are no longer renamed. On PG 17, `ADD PRIMARY KEY USING INDEX` works with `project_id` set NOT NULL at `:29`, and `week_start` keeps its NOT NULL after the old PK is dropped.

### R1 — CONTRACT drops `channel_id` without checking it equals `project_id`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261026130000_projects_cleanup.sql:29-35
- **Detail**: The drop is lossless only if the triggers kept both columns equal on every row. Triggers can be bypassed (e.g. `session_replication_role = replica`, or a manual fix in the SQL editor), and `set not null` at `:29` would only catch `weekly_stats` rows with a null `project_id`, not rows where the two columns differ.
- **Fix**: Before applying CONTRACT, run read-only checks and proceed only if both return 0: `select count(*) from content_items where channel_id is distinct from project_id`, and the same for `weekly_stats`. Alternatively, put the same check at the top of the file as a `do $$ … raise exception … $$` guard.
- **Must fix**: before CONTRACT (not before EXPAND).
- **Decision**: Accepted — fixed in 2cca551

### R2 — `sync_project_channel()` has no fixed `search_path`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261026120000_projects.sql:41
- **Detail**: Supabase's security advisor flags functions without `set search_path` (`function_search_path_mutable`). The body references no objects, so there is no real risk, and CONTRACT drops the function.
- **Fix**: Optional: add `set search_path = ''`, or ignore it, since the function only exists until CONTRACT.
- **Decision**: Accepted — fixed in 2cca551

### R3 — EXPAND backfill bumps `updated_at` on existing rows

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261026120000_projects.sql:34, 140-141, 154-159
- **Detail**: The `touch` trigger fires on the backfill and on the data updates, so all 3 `content_items` and the 17 mapped `tasks` get `updated_at = now()`. Round 1 did the same for tasks and did not flag it. XP is unaffected: on live there are 0 done tasks without `done_at` and 0 live items without `live_at`, and `src/lib/game.ts:51` uses `updated_at` only after `publish_date`/`live_at`. The only loss is the "last modified" time.
- **Fix**: None needed; accept.
- **Decision**: Accepted — no change

### R4 — EXPAND still contains the word "delete"

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/migrations/20261026120000_projects.sql:29, 32, 33, 58, 59, 66, 82, 127
- **Detail**: Every occurrence is a privilege (`grant … delete`) or an FK action (`on delete set null|cascade`), not data removal. If a guard on `apply_migration` enforces the "no `delete` in SQL" rule, the apply will be refused. The cleanup file is clean.
- **Fix**: Confirm the guard does not cover `apply_migration`, or have Rafał approve that apply explicitly.
- **Decision**: Accepted — the rule covers execute_sql only; apply via apply_migration

### R5 — Old bundles break after CONTRACT

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261026130000_projects_cleanup.sql:7
- **Detail**: Any tab or installed PWA still running the `main` bundle loses `channels` when CONTRACT runs. The plan's phone check after deploy covers this only if every client was reloaded.
- **Fix**: Reload the phone PWA (and close desktop tabs) on the new build before CONTRACT.
- **Decision**: Accepted — reload all clients before CONTRACT (in Migration Notes)

### Dry run

Recommended for EXPAND, not strictly required. The analysis above found no failure path, but EXPAND has no down-migration (rollback means a manual restore from the JSON backup), and the zero-downtime claim depends on PostgREST behaviour that this review has only reasoned about. A dry run is possible without touching live data:

1. Start a local Supabase (`supabase start`, Docker, PostgreSQL 17); no live access needed.
2. Recreate the current live schema locally: either `supabase db dump --linked --schema public` (schema only, no data; the CLI must be logged in, so Rafał runs it) or a hand-written baseline from the catalog output in this review.
3. Seed a few fake rows (one channel `sceny-sezonowe`, items `i01`–`i03`, tasks `t01`–`t26`, one `weekly_stats` row), with no personal data.
4. Apply EXPAND, then run the `main` build against the local API (`NEXT_PUBLIC_SUPABASE_URL` pointed at the local instance) and exercise: load, add/edit an item with and without a channel, add a week, edit the same week (upsert), move a week to another channel. Then repeat with the Phase 1 build.
5. Run the R1 queries and confirm they return 0, apply CONTRACT, re-run the Phase 1 build, and compare `v_xp_events` before and after.

A cheaper alternative is a SQL-only script on the local DB that replays PostgREST's statements as role `authenticated` (`insert … on conflict (channel_id, week_start) do update …` and `on conflict (project_id, week_start)`). It covers everything except PostgREST's schema-cache reload. A Supabase branch (`create_branch`) would also work, but it costs money and starts without data.

### Must fix before apply (round 2)

- EXPAND: nothing blocking. Settle R4 (the guard vs. the word "delete") before calling `apply_migration`.
- CONTRACT: R1 (equality checks return 0 rows) and R5 (every client on the new build).
