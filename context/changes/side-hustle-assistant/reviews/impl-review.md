<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Side Hustle Assistant Implementation Plan

- **Plan**: context/changes/side-hustle-assistant/plan.md
- **Scope**: Phase 1 of 6
- **Reviewed phases**: 1
- **Date**: 2026-10-26
- **Verdict**: NEEDS ATTENTION
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
- **Decision**: Accepted — fixed in SHA

### F2 — New `owner_all` policies call `is_owner()` per row instead of `(select is_owner())`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261026120000_projects.sql:94-95
- **Detail**: Every live `owner_all` policy is `using ((select is_owner()))` / `with check ((select is_owner()))` (initPlan, evaluated once per statement). The new policies use bare `public.is_owner()`, a `security definer` function that queries `app_owners` with `auth.jwt()`, so it runs once per row. Harmless for `gates`, but `video_daily` grows by one row per video per day and is read through `v_video_recent` on every load; Supabase's performance advisor flags this pattern (`auth_rls_initplan`). Fixing it later needs a second migration.
- **Fix**: Use `using ((select public.is_owner())) with check ((select public.is_owner()))` on both policies.
- **Must fix before apply**: recommended (one-line change now vs. a follow-up migration later).
- **Decision**: Accepted — fixed in SHA

### F3 — Slowfall row picked by `order by created_at limit 1`, not by explicit slug

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261026120000_projects.sql:104
- **Detail**: Review decision F1 says "explicit slugs". The update targets "the oldest row" instead of `slug = 'sceny-sezonowe'`. It works on live today (exactly one row, verified), but it is the one statement in the data section whose target is implicit; on any other database (a branch, a restore with extra rows) it would silently rename the wrong project and the gates would attach to it.
- **Fix**: `where slug = 'sceny-sezonowe'` (the live slug).
- **Must fix before apply**: recommended.
- **Decision**: Accepted — fixed in SHA

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
