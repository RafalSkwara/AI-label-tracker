# User Roles, Admin Panel and "Zapasy" — Plan Brief

> Full plan: `context/changes/household-supplies/plan.md`
> Inputs: `context/changes/household-supplies/inputs/` (brief, prototype, seed)

## What & Why

Rafał wants to share parts of Side Hustle Assistant with other people (his wife first) without exposing the dashboard. We add roles (`admin`, `dashboard`, `zapasy`), an admin panel with invites, and a new, isolated main-nav section "Zapasy": one shared, fully editable household emergency-supplies list with sub-tabs and live sync, used on a phone in the shop.

## Starting Point

A client-only Next.js app (session in localStorage, no middleware) on one route `/`. All dashboard data is global and guarded by 12 RLS policies that call `public.is_owner()`, an e-mail allow-list (`app_owners`, 1 row = the only auth user). A service-role client already exists for server routes and the cron. Realtime publication is empty.

## Desired End State

Rafał is `admin` + `dashboard` and sees everything as before. An app-level nav shows Dashboard / Zapasy / Użytkownicy by role; a user without roles sees "Nie masz jeszcze dostępu. Poproś administratora." The admin invites people with chosen roles and shares a one-time link; they set a password. `/zapasy` shows the seeded list (2 sub-tabs, 51 active, 19 removed), every field editable, filters, sticky totals, and changes appear on the other phone within ~2 s.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Dashboard data scoping | Stays global; every `dashboard`/`admin` user shares the same workspace | Data never had a `user_id`; access was always all-or-nothing |
| Existing `owner_all`/`owner_read` | Untouched; `is_owner()` body becomes `has_role('dashboard')` | One atomic change moves all 12 policies, `integration_status()` and server checks to roles |
| First admin | Migration grants `admin`+`dashboard` to the auth user matching `app_owners`; aborts if none | Existing owner mechanism, no e-mail in repo or SQL |
| Last admin | AFTER row trigger on `user_roles` rejects removing the last `admin` | Enforced by the DB, also for direct queries |
| Route protection | Client guards + RLS + role checks in server routes; no middleware | localStorage sessions are invisible to middleware; pages hold no data |
| Invites | Server `generateLink(invite)` with the service-role client; roles granted at once; admin shares the link (copy/share/mailto); `/haslo` redeems it and sets a password | Built-in SMTP doesn't reach non-team addresses; no `pending_invites` needed |
| Isolation | `src/features/supplies/**` imports only React + `@/lib/supabase`; ESLint rule both ways | Removing Zapasy stays trivial |
| Supplies data | `supply_tabs`, `supply_items` (brief's columns + `checked_initial`), soft removal only, RLS `has_role('zapasy')`, realtime publication | Matches the brief; initials without a profile table |
| Seed | Generated insert-only SQL, `on conflict (key) do nothing` | Idempotent and never overwrites later edits |
| Tests | One E2E (admin + `zapasy`-only contexts: route guard, check, realtime); no unit/RLS tests | Owner override |

## Scope

**In scope:** roles + RLS, shell nav + no-access screen, admin panel, invite links, set-password page, `/zapasy` (sub-tabs, CRUD, own price, reorder arrows, filters, summary, removed list, realtime, light/dark, 390 px), seed, one E2E.

**Out of scope:** per-user dashboard data, cookie sessions/middleware, Supabase e-mail sending/SMTP, multiple households, notifications, export, payments, hard removal, drag-and-drop, unit and RLS test suites.

## Architecture / Approach

`src/shell` owns session, roles (`user_roles` read on start) and nav; pages compose `<Shell need=…>` with the dashboard (`/`), the admin panel (`/admin/uzytkownicy`) or the supplies app (`/zapasy`). The database is the security boundary (`has_role()` in RLS, `is_owner()` = dashboard). Admin routes (`/api/admin/*`) verify the caller's token with `has_role('admin')` and then use `serviceDb()`. Supplies load all rows once, apply optimistic writes and merge `postgres_changes` by `updated_at`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Roles and RLS | `app_role`, `user_roles`, `has_role`, last-admin guard, `is_owner` → roles, first admin; shell + nav + no-access | Locking the owner out — mitigated by same-transaction admin insert and abort-if-missing |
| 2. Admin panel and invites | `/admin/uzytkownicy`, `/api/admin/*`, `/haslo` | Link expiry (OTP, 1 h) — "Nowy link" regenerates |
| 3. Supplies module | `supply_*` tables + realtime, `/zapasy` UI, lint boundary | Realtime gaps after the phone sleeps — refetch on visibility/reconnect |
| 4. Seed | Generator script + idempotent SQL; 2 tabs, 51/19 items | Wrong totals — checked against computed numbers |
| 5. E2E | One Playwright test, two accounts | Needs the test `zapasy` account from phase 2 |

**Prerequisites:** Supabase Auth Redirect URLs already include `https://side-hustle-assistant.sidereus.workers.dev/**` (Phase 4 of the rename). Rafał approves each migration; the orchestrator applies them via MCP before the merge.
**Estimated effort:** ~3–4 sessions across 5 phases, one PR at the end.

## Open Risks & Assumptions

- Assumes the admin `generateLink` invite works with the project's current Auth settings (it does not need SMTP); if not, fallback is creating the user in the Supabase dashboard and using "Nowy link".
- Route protection is client-side by design (D3); data is protected by RLS regardless.
- A `dashboard` user can also connect/sync YouTube (shared workspace, D1).

## Success Criteria (Summary)

- Rafał's dashboard works exactly as before; a `zapasy`-only account can't reach it (menu, URL, or direct queries) and vice versa.
- His wife accepts an invite on her phone and edits the shared list; he sees every change live.
- After the seed the list and totals match the file (51 active, 19 removed, 10 700–20 120 zł).
