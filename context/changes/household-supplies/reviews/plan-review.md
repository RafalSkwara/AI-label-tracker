<!-- PLAN-REVIEW-REPORT -->
# Plan Review: User Roles, Admin Panel and "Zapasy"

- **Plan**: context/changes/household-supplies/plan.md
- **Mode**: Deep (single reviewer, read-only Supabase checks)
- **Date**: 2026-10-29
- **Verdict**: SOUND after fixes (was REVISE)
- **Findings**: 0 critical, 3 warnings, 5 observations. All fixed directly in `plan.md` (owner asked for minimal questions). No blocking owner question.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS after fixes |
| Plan Completeness | WARNING → PASS after fixes |

## Grounding

Paths 6/6 ✓ (`src/lib/supabase.ts`, `src/lib/server/auth.ts`, `src/lib/server/db.ts`, `src/components/App.tsx`, `src/app/page.tsx`, `eslint.config.mjs`). Symbols ✓ (`requireOwner`, `serviceDb`, `rpc("is_owner")`, `rpc("integration_status")`, `42501` banner). Brief↔plan ✓; deviations from the brief (no `pending_invites`, no middleware, no unit/RLS tests) are recorded as D3, D6, D22 and match the owner overrides. Progress↔Phase consistency ✓ (5 phases, every criterion has a row).

Live DB (read-only, 2026-10-29):
- `is_owner()`: `language sql stable security definer set search_path ''`, owner `postgres`, ACL `authenticated`, `service_role` only (no `PUBLIC`). `create or replace` keeps it.
- `postgres` has `rolbypassrls = true`; `app_owners.email` values are all lower-case, so the `lower(u.email)` join is correct.
- `app_role`, `user_roles`, `supply_*` do not exist yet; publication `supabase_realtime` exists (not `all tables`, insert/update on).
- Seed recomputed from `zapasy-seed.json`: A 45 active + 18 removed, B 6 + 1, keys unique; active totals A 3 750–4 220, B 6 950–15 900, all 10 700–20 120 zł; 0 active checked; `d1` the only active item without a price. Matches the plan exactly.

## Focus checks (owner's list)

- **`is_owner()` → `has_role('dashboard')` swap.** Safe at every step. After migration 1 and before the merge, old `main` keeps working: its policies and `requireOwner` call `is_owner()`, which now returns true through the roles inserted in the same transaction. The old body read the `email` claim, the new one reads `sub`. Both are in every existing access token, so nobody has to sign in again. SECURITY DEFINER + `search_path ''` holds. No recursion: `has_role` runs as `postgres` (table owner, bypasses RLS), so the `roles_read` policy calling `has_role` does not loop. Clarified in the plan (F8).
- **Last-admin guard in the DB.** Row-level AFTER trigger fires at end of statement, so a multi-row removal sees the final state ✓. A concurrency gap was fixed (F3).
- **Invite flow (D6).** Feasible. `generateLink` returns `hashed_token` without sending mail. `verifyOtp({ token_hash, type })` returns a session directly and does not touch the PKCE `code` exchange, so `detectSessionInUrl` is harmless. Two details fixed (F4, F5).
- **Realtime + RLS.** Publication + `select` grant + `has_role` policy is enough. Default replica identity is fine because the client uses only `payload.new`, and DELETE is never granted. supabase-js forwards and refreshes the token on the socket. Added to the plan as an explicit note (F6).
- **Seed idempotency.** `on conflict (key) do nothing` + insert-only, with no "delete" in the SQL ✓. Counts and totals match. A small re-run edge case was fixed (F7).
- **Cloudflare Workers.** The admin routes use only fetch-based supabase-js calls, 3–4 subrequests each, and no Node APIs. The seed generator runs locally under Node, not on Workers. Noted in the plan.

## Findings

### F1 — Roles rollback fails while the supplies migration is applied

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 Rollback; Migration Notes
- **Detail**: `supply_rw` policies depend on `has_role`. Dropping `has_role` in `20261029100000_roles_down.sql` errors once migration 2 is applied. Nothing in the plan stated the order.
- **Fix**: Rollback order documented: supplies rollback first, then roles. Plain `drop` (no `cascade`), so a wrong order fails loudly instead of silently stripping the supply policies. Migration Notes row #1 updated.
- **Decision**: FIXED

### F2 — Phase 2 redirect targets a route that does not exist yet

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 1 §3 Shell contract vs. criterion 2.6
- **Detail**: Shell redirects a user who has roles but not `need` to the first permitted section, Dashboard → Zapasy → Użytkownicy. In phase 2 a `zapasy`-only invitee would be sent to `/zapasy`, which 404s until phase 3. Criterion 2.6 expects the no-access screen.
- **Fix**: One `SECTIONS` array in `src/shell/sections.ts` feeds both the redirect and `AppNav`. An entry is added only in the phase that ships its route. With roles but no shipped permitted section, the shell shows `NoAccess`. The phase 2 and 3 file lists now point at `sections.ts`.
- **Decision**: FIXED

### F3 — Last-admin guard can be raced by two admins

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 last-admin guard
- **Detail**: Under READ COMMITTED, two transactions that each remove a different admin's row can both see "another admin remains" and both commit, leaving zero admins. The brief requires the DB to refuse this, including direct queries.
- **Fix**: The trigger function (plpgsql, volatile) starts with `pg_advisory_xact_lock(hashtext('user_roles_keep_admin'))`. The second transaction waits, then takes a fresh snapshot and sees the first removal. Execute revoked from client roles (trigger-only).
- **Decision**: FIXED

### F4 — "Nowy link" for a never-redeemed invite used `magiclink`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 `POST /api/admin/link`
- **Detail**: The main use of "Nowy link" is an expired invite, and the user is still unconfirmed in that case. `generateLink({ type: "invite" })` is the documented path for unconfirmed users. `magiclink` behaviour on unconfirmed users is less certain. A partial failure (user created, role insert failed) was also undefined.
- **Fix**: Use `type: "invite"` when `email_confirmed_at` is null, otherwise `magiclink`. On a role-insert failure, return 500 and let the admin tick the roles in the list. No compensation logic.
- **Decision**: FIXED

### F5 — `/haslo` token handling details

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §4
- **Detail**: Reading the query through `useSearchParams` without a Suspense boundary breaks static prerender in Next 16. React dev double effects would redeem the one-time token twice and show "already used" after a success.
- **Fix**: Read `window.location.search` inside the effect and guard with a `useRef`. The plan also notes why `verifyOtp` is compatible with PKCE.
- **Decision**: FIXED

### F6 — `supply_touch` INSERT semantics and realtime prerequisites were implicit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1
- **Detail**: "When `checked` flips" did not define the INSERT case (seed or new item inserted as checked, no `old`). Supabase default privileges grant EXECUTE on new public functions to `anon` (seen on `touch_updated_at`). The realtime prerequisites (replica identity, socket auth) were not stated.
- **Fix**: Explicit `tg_op` conditions; null initial when there is no JWT; execute revoked on the trigger function; a realtime note (default replica identity suffices, token handled by supabase-js, RLS evaluated per subscriber through `has_role`).
- **Decision**: FIXED

### F7 — Seed re-run after a tab rename creates an empty duplicate tab

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1
- **Detail**: Tabs are guarded by name only. If the user renames "A: niezbędne" and the seed runs again, a new empty "A: niezbędne" appears. Items are skipped by key, so they stay in the renamed tab.
- **Fix**: Each tab insert also requires that none of that tier's seed keys exist in `supply_items`.
- **Decision**: FIXED

### F8 — Migration 1 transaction and statement order, recursion rationale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1
- **Detail**: The safety claim ("owner keeps `is_owner() = true` in the same transaction") depends on the statement order and on the file having no own `begin`/`commit`. The no-recursion argument for `has_role` versus the `user_roles` RLS was not written down.
- **Fix**: Statement order spelled out: objects → admin insert → `do $$` check → `create or replace is_owner()`. No own transaction control, since `apply_migration` wraps the file. A note that `create or replace` keeps the live ACL. A note that `has_role` runs as `postgres` (owner, `rolbypassrls`), so there is no recursion, and that `force row level security` must not be used. `has_role` is also granted to `service_role`.
- **Decision**: FIXED

## Not changed (checked, sound)

- D3 (client guards + RLS + server role checks instead of middleware): justified by localStorage sessions. Pages carry no data.
- D6 (no `pending_invites`): the user exists right after `generateLink`, so the roles are attached immediately. The brief's criterion "invited person has exactly the granted roles" holds.
- E2E toggles one real item on the live list and restores it in `finally`. This is acceptable for a private app (owner override: one E2E).

## Owner questions

None blocking.
