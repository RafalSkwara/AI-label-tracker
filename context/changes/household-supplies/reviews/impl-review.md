# Implementation review — household-supplies (phases 1–5)

Reviewer: Opus, 2026-10-29. Scope (owner asked for a focused review): migrations, rollbacks, seed, RLS/Realtime, admin routes, client guards, module isolation. No style pass.

**Verdict: APPROVE** after one minor fix (F1, applied). Typecheck, lint, test:int and build are green.

## Live DB precheck (read-only, `execute_sql`)

`app_owners` = 1 row matching the single `auth.users` row; `user_roles`, `supply_*`, `app_role`, `has_role`, `supply_touch` and `user_roles_keep_admin` do not exist yet. `supabase_realtime` exists with no tables. `is_owner` ACL = postgres, authenticated, service_role. 12 policies reference `is_owner`. Both migrations apply cleanly onto this state.

## Checked, no finding

- **Safe while `main` is live.** Migration 1 grants the owner `admin` + `dashboard` in the same transaction that rewrites `is_owner()`, and the `do $$` block aborts if no admin exists. `create or replace` keeps the signature and ACL, so the live app's `requireOwner` → `rpc('is_owner')` and the 12 policies keep working. Migration 2 is purely additive.
- **`has_role`** is `security definer`, `set search_path = ''`, fully qualified, with execute revoked from public/anon and granted to authenticated/service_role. It cannot recurse into the `user_roles` policies because it runs as owner.
- **Last-admin guard.** It is an AFTER ROW trigger on delete/update, so multi-row deletes see the final state. The advisory lock plus the fresh READ COMMITTED snapshot per statement (plpgsql is volatile) serialises two admins removing each other. It also guards the cascade from `auth.users`, as the plan intends.
- **Rollbacks.** Supplies rollback first, then roles, with plain `drop` and no cascade, so a wrong order fails loudly. `is_owner()` is restored before `has_role` is dropped.
- **"delete" rule.** The seed (the only `execute_sql` script) contains no "delete". The migrations and rollbacks do contain it in DDL (`on delete cascade`, `for delete` policy, delete grant, trigger event). That is expected because they go through `apply_migration` (plan §Migration Notes).
- **Seed.** It is insert-only, with tabs guarded by name plus absence of their keys, and items guarded by `on conflict (key) do nothing`. It wraps itself in `begin`/`commit` and ends with the count SELECT. A static count gives 2 tabs, 70 items, 19 removed and 51 active, matching what was expected.
- **RLS / Realtime.** `supply_rw` is `for all to authenticated` and gated on `has_role('zapasy')`. The grants are select/insert/update only, with no DELETE (soft removal). Both tables are added to `supabase_realtime`. The client channel relies on RLS per subscriber, and the client ignores DELETE payloads.
- **Admin routes.** All three call `requireRole(req, 'admin')` using the caller's token (`getUser` plus `rpc has_role`) before any `serviceDb()` use. Inputs are validated: e-mail regex and a role allow-list. `serviceDb` lives only in `src/lib/server/db.ts` and is imported only by server routes. The client bundle has no `SUPABASE_SECRET_KEY`.
- **Client guards / nav.** `Shell need=` is set on `/`, `/zapasy` and `/admin/uzytkownicy`. A user without the role is redirected to their first allowed section, and a user with no roles sees `NoAccess`. `AppNav` lists only the sections where `can(role)` is true, and admin passes all checks, mirroring `has_role`. The DB is the real boundary in every case.
- **Isolation.** ESLint `no-restricted-imports` works both ways. A grep confirms `src/features/supplies/**` imports only React, local files and `@/lib/supabase`. Only `src/app/zapasy/page.tsx` imports the module.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | Low | `supply_touch()` set `checked_by/at/initial` only on the unchecked→checked transition. An UPDATE that kept `checked = true` could rewrite who/when from the client. | **Fixed**: the still-checked branch now copies the `old.` values (migration 2, not yet applied). |

## Apply order (orchestrator, after owner approval)

1. `apply_migration` `20261029100000_roles.sql`, then verify:
   `select u.email, r.role from public.user_roles r join auth.users u on u.id = r.user_id order by 2;` → owner × `admin`, `dashboard`
   `select prosecdef, proconfig from pg_proc where proname = 'has_role';` → `true`, `{search_path=""}`
2. `apply_migration` `20261029110000_supplies.sql`, then verify:
   `select tablename from pg_publication_tables where pubname = 'supabase_realtime';` → `supply_tabs`, `supply_items`
   `select tablename, policyname, cmd from pg_policies where tablename like 'supply_%';` → 2 × `supply_rw` / ALL
3. `execute_sql` `supabase/seed/supplies_seed.sql`. Its final SELECT must return `tabs 2, active 51, removed 19`. A re-run must return the same counts.
4. Merge the PR.

Rollback: `supabase/rollback/20261029110000_supplies_down.sql`, then `20261029100000_roles_down.sql`, both via `apply_migration`.
