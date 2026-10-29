# User Roles, Admin Panel and "Zapasy" Implementation Plan

## Overview

Add a role system (`admin`, `dashboard`, `zapasy`) to Side Hustle Assistant so Rafał can share parts of the app with other people (his wife first), an admin panel to invite users and grant or revoke roles, and a new, fully isolated main-nav section **"Zapasy"**: one shared, fully editable household emergency-supplies list with sub-tabs, live sync between devices (Supabase Realtime), mobile-first, light and dark.

Input: `inputs/prompt-zapasy-role.md` (brief, Polish), `inputs/lista-zapasow.html` (prototype the owner liked; visual/UX reference), `inputs/zapasy-seed.json` (70 items, 51 active). Owner overrides (given to the planner on 2026-10-29) win over the brief: private app with few users, no over-engineering; **no unit tests and no RLS test suite**, one E2E test only; first admin derived from the existing owner mechanism, no e-mail in the repo or in SQL; additive, zero-downtime migrations with rollback; invites server-side with the existing service-role client; mobile-first at 390 px; Polish UI, English code and docs; the supplies module stays isolated.

All decisions were made by the planner (the owner asked for as few questions as possible); each one is recorded in "Decisions" at the end.

## Current State Analysis

- **Auth is client-only.** `src/lib/supabase.ts:6` creates a browser supabase-js client (`flowType: "pkce"`, session in localStorage). `src/components/App.tsx:9-25` shows `Login` or `Tracker`. There is no `middleware`/`proxy.ts`, no cookie session, and `@supabase/ssr` is installed but unused. Every page is a static client shell; data is read from the browser and guarded by RLS.
- **The "owner" mechanism**: table `public.app_owners(email text)` (1 row, RLS on, no policies) and `public.is_owner()` (`security definer`, `search_path ''`): `exists (select 1 from app_owners o where o.email = lower(auth.jwt() ->> 'email'))`. Live DB has exactly **1 auth user**, and it matches the single `app_owners` row (verified read-only on 2026-10-29).
- **Dashboard data is global, not per user.** No dashboard table has a `user_id`. Access is all-or-nothing through 12 policies, all `to authenticated`, all `(select is_owner())`: `owner_all` (ALL) on `content_items, gates, projects, royalties, settings, subscriptions, tasks, video_daily, weekly_stats`; `owner_read` (SELECT) on `video_search_terms, video_stats_hourly, video_traffic`. `integrations` has RLS on, no policies, privileges revoked. The four views (`v_video_recent, v_views_24h, v_xp_events, v_royalties_month`) are `security_invoker`, so they inherit table RLS. `integration_status()` checks `is_owner()` itself.
- **Server routes** (`src/app/api/**`) authenticate with `requireOwner` (`src/lib/server/auth.ts:7`): Bearer token → `auth.getUser` → `rpc("is_owner")` with the caller's own token. The cron (`worker.ts` → `/api/cron`) uses the service-role client `serviceDb()` (`src/lib/server/db.ts:5`, `SUPABASE_SECRET_KEY` via `src/lib/server/env.ts`), so it bypasses RLS.
- **Navigation**: there is no app-level nav. The dashboard is one route `/` (`src/app/page.tsx`) with internal tabs (`TABS` in `src/components/Tracker.tsx:15`). The header with "Odśwież" and "Wyloguj" is in `Tracker.tsx`.
- **Design system**: tokens on `:root` with dark-mode overrides in `src/app/globals.css:2-20` (`--bg, --surface, --sunk, --ink, --muted, --line, --accent, --good, --warn, --bad, --r`, fonts `--f-display/--f-body/--f-mono`), shared classes `.btn`, `.btn.primary`, `.btn.danger`, `.chip`, `.field`, `.scrim`, `.sheet`, `.banner`, `.toast`, `.empty`, `.label`, `.sub`, `.num`, `.linkbtn`. `Sheet.tsx` is dashboard-specific (bound to `Coll`), so it is not reused as a component, only its CSS classes.
- **Realtime**: publication `supabase_realtime` exists and has no tables.
- **Tests**: `tests/integration/{ytMap,distrokid}.test.ts` (`npm run test:int`), one Playwright smoke `tests/e2e/smoke.spec.ts` (manual, env credentials, 390 px viewport, `playwright.config.ts`). CI (`.github/workflows/ci.yml`) runs typecheck, lint, test:int, build.
- **Seed** (`inputs/zapasy-seed.json`): 70 items, keys unique, tiers `A`/`B`, 14 categories; A: 45 active + 18 removed, B: 6 active + 1 removed. Active totals (own price wins, else range; no-price items skipped): A **3 750–4 220 zł**, B **6 950–15 900 zł**, all **10 700–20 120 zł**; 0 active items checked; 1 active item without any price (`d1`, label "własne środki").

## Desired End State

- `user_roles` holds roles; `has_role(role)` drives RLS; `admin` passes every check. Rafał's existing account is `admin` + `dashboard`. The last `admin` role cannot be removed, also by a direct query.
- The dashboard behaves exactly as today for Rafał. A `dashboard`-role user sees the same shared dashboard data. A user without `dashboard`/`admin` gets nothing from dashboard tables (RLS returns empty rows / write errors) and never sees the dashboard UI.
- An app shell with a main nav shows only the sections the user may open: **Dashboard** (`/`), **Zapasy** (`/zapasy`), **Użytkownicy** (`/admin/uzytkownicy`). Signed-in users with no role see "Nie masz jeszcze dostępu. Poproś administratora."
- `/admin/uzytkownicy`: list of users with role checkboxes, invite (e-mail + roles → invite link generated server-side), new link, revoke access.
- `/zapasy`: the shared list with sub-tabs ("Wszystko" + every active `supply_tabs` row), everything editable, filters, sticky summary, removed section, live updates between devices within ~2 s. After the seed: 2 sub-tabs, 51 active and 19 removed items, totals as listed above.
- Verification: typecheck, lint, test:int, build green; one E2E test (`tests/e2e/smoke.spec.ts`) covers role-based route protection, the supplies basic flow and realtime; Rafał confirms on the phone.

### Key Discoveries:

- `public.is_owner()` is the single choke point of all dashboard RLS (12 policies), `integration_status()` and `requireOwner` — redefining its body moves the whole dashboard to roles without touching any policy (`pg_policies`, live DB).
- `app_owners` already identifies the owner by e-mail inside the database, so the migration can find the first admin with a join against `auth.users` — no e-mail literal anywhere.
- `src/lib/supabase.ts:6` — localStorage session: a Next middleware/proxy cannot see who is signed in; switching to cookie sessions would sign everybody out and depends on OpenNext middleware support on Workers. The data boundary is RLS, and server routes already check roles with the caller's token (`src/lib/server/auth.ts:7`).
- Supabase's built-in SMTP only delivers to members of the project's organisation and is heavily rate-limited, and links from the default e-mail templates use the implicit flow, which does not match this client's PKCE setup. `auth.admin.generateLink({ type: "invite" })` creates the user and returns `properties.hashed_token` without sending e-mail; the client redeems it with `auth.verifyOtp({ token_hash, type })`.
- Realtime `postgres_changes` honours RLS for the subscriber, so the tables need: `alter publication supabase_realtime add table …`, `select` granted to `authenticated`, and policies that `has_role()` satisfies.
- `Tracker.tsx` error banner already maps `42501`/policy errors to "Konto … nie ma dostępu do danych." — useful when a role is revoked during a session.

## What We're NOT Doing

- No unit tests, no RLS test suite (owner override). One E2E test plus `test:int` unchanged.
- No per-user dashboard data or `user_id` columns on dashboard tables: the dashboard stays one shared workspace.
- No change to any existing policy name or definition (`owner_all`, `owner_read`); no `app_owners` drop.
- No cookie/SSR session migration, no Next middleware (see decision D3).
- No e-mail sending by Supabase (no custom SMTP setup); the admin sends the invite link himself (decision D6).
- No multiple households, notifications, export, payments (brief, out of scope). No hard removal of supplies or tabs (soft only). No drag-and-drop on phones (arrows). No offline write queue.
- No category table (text + suggestions). No user display-name profile (initial from e-mail).
- No edits to dashboard features besides moving "Wyloguj" into the shell header.

## Implementation Approach

Five phases, one commit each, all on branch `claude/household-supplies`, one PR at the end (merge is Rafał's). Two migrations, both strictly additive and safe for the live `main` app; the orchestrator applies each via Supabase MCP `apply_migration` after Rafał approves it and **before the merge**; the seed is an insert-only SQL script run once via `execute_sql`.

1. **Roles + RLS**: `app_role`, `user_roles`, `has_role`, last-admin guard; `is_owner()` becomes "has dashboard (or admin)"; first admin from `app_owners`. App shell with roles, main nav, no-access screen, client route guards.
2. **Admin panel + invites**: server routes with the service-role client, `/admin/uzytkownicy`, `/haslo` (redeem link + set password).
3. **Supplies module**: `supply_tabs`, `supply_items`, RLS, triggers, realtime; `/zapasy` UI in an isolated folder, ESLint import boundary.
4. **Seed**: generator script + idempotent insert-only SQL.
5. **E2E**: one Playwright test for roles + supplies + realtime.

Module layout (the isolation rule that ESLint enforces in phase 3):

- `src/shell/**` — shared: session, roles hook, nav, no-access, route guard. Imports only `@/lib/supabase`.
- `src/features/admin/**` — admin panel (client) — imports `@/lib/supabase`, `@/shell/*`.
- `src/features/supplies/**` — the supplies module. Imports only `react`, `@/lib/supabase` and its own files.
- Dashboard = `src/components/**`, `src/lib/**` (except `supabase.ts`). Never imports `@/features/supplies`.
- Pages compose: `src/app/page.tsx`, `src/app/zapasy/page.tsx`, `src/app/admin/uzytkownicy/page.tsx`, `src/app/haslo/page.tsx`.

## Critical Implementation Details

- **Migration order vs. merge.** Both migrations must be applied before the PR is merged (new code reads `user_roles` and `supply_*`); both are safe to apply while `main` runs, because the owner keeps `is_owner() = true` in the same transaction that changes it. Never apply the `is_owner()` change without the admin insert (same migration file, one `apply_migration` call).
- **Last-admin guard must be row-level AFTER.** An `AFTER DELETE OR UPDATE … FOR EACH ROW` trigger on `user_roles` that raises when `old.role = 'admin'` and no other admin row remains sees the final state of a multi-row statement, so "remove all admins at once" also fails. It also blocks removing the last admin's auth account (FK cascade), which is intended.
- **Invite links.** Build the link yourself: `${origin}/haslo?token_hash=<properties.hashed_token>&type=invite` (`type=magiclink` for "Nowy link"); do not hand out `properties.action_link` (implicit flow, `#access_token`, conflicts with PKCE `detectSessionInUrl`). The OTP expiry (Auth settings, default 1 h) bounds the link's life; the panel says so.
- **Realtime merge.** Apply `payload.new` by `id` only if its `updated_at` is not older than the local row (own optimistic writes echo back). On `visibilitychange` → visible after > 60 s, and on channel `SUBSCRIBED` after a reconnect, refetch the whole list (the phone sleeps in the shop).

## Phase 1: Roles and RLS

### Overview

Introduce roles in the database and the app shell that reads them. After this phase the live app behaves the same for Rafał, a no-role account sees the no-access screen, and the nav exists (with "Zapasy" hidden until phase 3 ships its route — the nav item is added in phase 3).

### Changes Required:

#### 1. Migration `supabase/migrations/20261029100000_roles.sql`

**Intent**: Role model enforced in the database; the dashboard moves from the e-mail allow-list to roles without touching policies or data.

**Contract**:
- `create type public.app_role as enum ('admin', 'dashboard', 'zapasy')`.
- `public.user_roles (user_id uuid not null references auth.users(id) on delete cascade, role app_role not null, granted_by uuid null references auth.users(id) on delete set null default auth.uid(), granted_at timestamptz not null default now(), primary key (user_id, role))` (the PK is the unique pair).
- `public.has_role(r app_role) returns boolean` — `language sql stable security definer set search_path = ''`: exists a `user_roles` row for `auth.uid()` with `role = r or role = 'admin'`. `revoke execute … from public, anon; grant execute … to authenticated`.
- RLS on `user_roles`: `roles_read` SELECT `to authenticated using (user_id = (select auth.uid()) or (select public.has_role('admin')))`; `roles_admin_insert` INSERT `with check ((select public.has_role('admin')))`; `roles_admin_remove` DELETE `using ((select public.has_role('admin')))`. No UPDATE policy. Grants: `revoke all … from anon, authenticated; grant select, insert, delete … to authenticated`.
- Last-admin guard: trigger function `public.user_roles_keep_admin()` (`security definer`, `search_path ''`) + `create trigger … after delete or update on public.user_roles for each row` → `raise exception 'last admin' using errcode = 'P0001', hint = 'keep_admin'` when `old.role = 'admin'` and no row with `role = 'admin'` remains.
- First admin: `insert into public.user_roles (user_id, role, granted_by) select u.id, r.role, null from auth.users u join public.app_owners o on o.email = lower(u.email) cross join (values ('admin'::public.app_role), ('dashboard'::public.app_role)) r(role) on conflict do nothing;` then `do $$ … if not exists (admin row) then raise exception 'no owner found' … $$` so the migration aborts (and rolls back) instead of leaving the app without an admin.
- `create or replace function public.is_owner()` — same signature, `security definer`, `search_path ''`, body `select public.has_role('dashboard')`; `comment on function` explaining it now means "may use the dashboard (dashboard or admin role)". Name kept on purpose (decision D2).
- Header comment: additive, safe before merge, rollback file name.

#### 2. Rollback `supabase/rollback/20261029100000_roles_down.sql`

**Intent**: Return to the e-mail allow-list in one transaction.

**Contract**: restore the original `is_owner()` body (`select exists (select 1 from public.app_owners o where o.email = lower(auth.jwt() ->> 'email'))`) first, then drop the trigger, trigger function, `user_roles` (policies go with it), `has_role`, `app_role`. Run via `apply_migration` only on the orchestrator's instruction. Roles granted in the meantime are lost (acceptable; documented).

#### 3. App shell

**File**: `src/shell/Shell.tsx`, `src/shell/useRoles.ts`, `src/shell/AppNav.tsx`, `src/shell/NoAccess.tsx`, `src/components/App.tsx` (removed; logic moves into the shell), `src/app/page.tsx`, `src/components/Tracker.tsx` (header), `src/app/globals.css`

**Intent**: One client shell owns the session (the current `App.tsx` logic), loads the user's roles, renders the main nav and guards each page by a required role, so pages only render for permitted users.

**Contract**:
- `useRoles()` → `{ roles: Set<AppRole>, can(role) }` from `select role from user_roles where user_id = <me>`; `can(r) = roles.has(r) || roles.has("admin")`. Roles load on every app start and on `onAuthStateChange` (so a change applies at the latest after a reload — brief criterion).
- `<Shell need="dashboard" | "zapasy" | "admin" | null>{(ctx) => …}</Shell>` with `ctx = { session, email, userId, can }`. States: loading ("Wczytywanie…"), no session → `Login`, no roles at all → `NoAccess` (text: "Nie masz jeszcze dostępu. Poproś administratora." + "Wyloguj"), has roles but not `need` → client redirect (`router.replace`) to the first permitted section in order Dashboard → Zapasy → Użytkownicy; else children.
- `AppNav`: links (next/link) only for permitted sections — "Dashboard" `/` (`dashboard`), "Użytkownicy" `/admin/uzytkownicy` (`admin`; route arrives in phase 2, the link is added there), and "Wyloguj" on the right (moved from `Tracker`'s header; "Odśwież" stays in Tracker). `aria-current="page"` on the active link. 44 px tall targets, horizontal scroll on overflow, tokens only.
- `src/app/page.tsx` renders `<Shell need="dashboard">` → `<Tracker email=… />`.
- `src/lib/supabase.ts` comment updated (RLS now through `has_role` / `is_owner`).

#### 4. Server helper

**File**: `src/lib/server/auth.ts`

**Intent**: Role check for server routes, next to `requireOwner` (which keeps working: `is_owner()` now means dashboard).

**Contract**: `requireRole(req, role): Promise<{ userId: string } | null>` — Bearer token → `auth.getUser(token)` → `rpc("has_role", { r: role })` with the caller's token; returns the user id on success. `requireOwner` unchanged.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly via `apply_migration` and `select role from user_roles` returns exactly `admin`, `dashboard` for the single existing user
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration tests pass: `npm run test:int`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- Before merge (migration applied, old `main` still live): Rafał's dashboard on the phone loads and saves as before, YouTube sync card shows status
- On the branch preview: the dashboard works as before at 390 px, the nav shows "Dashboard" and "Wyloguj", light and dark mode
- Read-only check via `execute_sql` in a rolled-back transaction: `set local role authenticated` with `request.jwt.claims` of a random uuid returns 0 rows from `tasks` and `false` from `is_owner()` (the last-admin guard is checked through the UI in 2.7, so no removal SQL runs through MCP)

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 2.

---

## Phase 2: Admin panel and invites

### Overview

`/admin/uzytkownicy` for the admin: list users with role checkboxes, invite by e-mail with roles, regenerate a link, revoke access. `/haslo` lets an invited person redeem the link and set a password (login is password-first and works without e-mail delivery).

### Changes Required:

#### 1. Server routes (service-role client, admin only)

**File**: `src/app/api/admin/users/route.ts`, `src/app/api/admin/invite/route.ts`, `src/app/api/admin/link/route.ts`

**Intent**: Everything that needs `auth.admin` runs on the server with `serviceDb()`; the secret key never reaches the browser. Each route first calls `requireRole(req, "admin")` → 401/403.

**Contract**:
- `GET /api/admin/users` → `{ users: { id, email, createdAt, lastSignInAt, invited: boolean, roles: AppRole[] }[] }` from `auth.admin.listUsers({ perPage: 200 })` + `user_roles`. `invited` = never signed in.
- `POST /api/admin/invite` `{ email, roles: AppRole[] }` (email trimmed, lower-cased, basic format check; `roles` non-empty subset of the enum) → `auth.admin.generateLink({ type: "invite", email })`; on "already registered" → 409 `{ error: "exists" }`. On success insert `user_roles` rows `(newUserId, role, granted_by = admin userId)` with the service client and return `{ link }` where `link = ${origin}/haslo?token_hash=${properties.hashed_token}&type=invite` (`origin` from the request URL, as in `api/yt/connect`).
- `POST /api/admin/link` `{ userId }` → `generateLink({ type: "magiclink", email: <looked up by id> })` → `{ link }` with `type=magiclink`. Used for "Nowy link" (expired invite, forgotten password).
- Errors are logged by message only (no e-mail in logs), responses carry Polish-mappable codes.

#### 2. Role changes from the client

**File**: `src/features/admin/UsersAdmin.tsx`, `src/features/admin/api.ts`

**Intent**: Ticking a role inserts a `user_roles` row, unticking removes it, directly through supabase-js with the admin's own session — RLS and the last-admin trigger enforce the rules in the database, not in the UI.

**Contract**: optimistic toggle, revert on error; `hint = keep_admin` / message `last admin` → toast "Musi zostać co najmniej jeden administrator."; "Odbierz dostęp" (`.btn.danger` with the existing armed-confirm pattern) removes all roles of that user (one statement; the guard protects the last admin). Your own row shows "(Ty)".

#### 3. Admin page

**File**: `src/app/admin/uzytkownicy/page.tsx`, `src/shell/AppNav.tsx` (add "Użytkownicy"), `src/app/globals.css`

**Intent**: Mobile-first panel built from existing classes (`.panel`, `.field`, `.btn`, `.chip`, `.toast`, `.empty`).

**Contract**: `<Shell need="admin">`. Sections: "Zaproś" (e-mail field, role checkboxes `Administrator`, `Dashboard`, `Zapasy` — default `Zapasy` ticked, button "Utwórz zaproszenie") → result card with the link, "Kopiuj link" (`navigator.clipboard`), "Udostępnij" (`navigator.share`, shown when available), "Wyślij e-mailem" (`mailto:` with the address and a short Polish text containing the link), and the note "Link działa raz i wygasa po godzinie." Then "Użytkownicy": one card per user — e-mail, "zaproszony" chip if never signed in, three role checkboxes (44 px targets), "Nowy link", "Odbierz dostęp".

#### 4. Redeem link and set password

**File**: `src/app/haslo/page.tsx` (+ `src/shell/SetPassword.tsx`)

**Intent**: The invited person opens the link on her phone, gets signed in, sets a password and lands on her section. Also usable later by anyone signed in to change the password.

**Contract**: on mount, if `token_hash` and `type` are in the query → `auth.verifyOtp({ token_hash, type })` (`invite` | `magiclink`), then drop the query from the URL; errors → "Link wygasł lub został już użyty. Poproś administratora o nowy." Then (signed in) form "Ustaw hasło" (min. 8 chars, twice) → `auth.updateUser({ password })` → `router.replace("/")` (the shell redirects to the permitted section). Not wrapped in a role guard (a user with no role can still set a password). The nav gets a small "Hasło" link next to "Wyloguj".

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration tests pass: `npm run test:int`
- OpenNext build passes: `npm run build`
- `SUPABASE_SECRET_KEY` and `serviceDb` are not referenced from any client file: `grep -rl "serviceDb\|SUPABASE_SECRET_KEY" src --include=*.tsx` is empty

#### Manual Verification:

- Rafał invites a test account with role `zapasy` on the phone, opens the link in a private window, sets a password, and lands on the no-access screen until phase 3 ships (then on `/zapasy`)
- Unticking his own `admin` role (the only admin) shows "Musi zostać co najmniej jeden administrator." and the checkbox returns
- Granting `dashboard` to the test account shows the dashboard after a reload; "Odbierz dostęp" brings it back to the no-access screen after a reload
- `/admin/uzytkownicy` opened by the non-admin test account redirects away; `GET /api/admin/users` with its token returns 403

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 3. Keep the test account (`zapasy` only) — phase 5 uses it.

---

## Phase 3: Supplies module

### Overview

Tables, RLS and realtime for the shared list, and the `/zapasy` UI modelled on `inputs/lista-zapasow.html` (one narrow column, sticky summary with progress bar, chip bar, category groups of checkable rows, price button that becomes an input, × to remove, "Usunięte z listy" with ↺ restore), restyled with the app's tokens and components.

### Changes Required:

#### 1. Migration `supabase/migrations/20261029110000_supplies.sql`

**Intent**: Isolated, removable tables for the list; strictly additive.

**Contract**:
- `public.supply_tabs (id uuid pk default gen_random_uuid(), name text not null check (length(trim(name)) > 0), description text null, sort_order int not null default 0, archived boolean not null default false, created_by uuid null default auth.uid() references auth.users on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.
- `public.supply_items (id uuid pk default gen_random_uuid(), key text not null unique default gen_random_uuid()::text, tab_id uuid not null references public.supply_tabs(id), category text not null default 'Inne', name text not null check (length(trim(name)) > 0), quantity text null, details text null, price_min numeric(10,2) null check (price_min >= 0), price_max numeric(10,2) null, price_label text null, own_price numeric(10,2) null check (own_price >= 0), checked boolean not null default false, checked_by uuid null references auth.users on delete set null, checked_initial text null, checked_at timestamptz null, removed boolean not null default false, sort_order int not null default 0, created_by uuid null default auth.uid() references auth.users on delete set null, created_at, updated_at, check (price_max is null or (price_min is not null and price_max >= price_min)))`; index `(tab_id, category, sort_order)`.
- Own trigger function `public.supply_touch()` (`search_path ''`, not shared with the dashboard's `touch_updated_at`): sets `updated_at`; on `supply_items`, when `checked` flips to true: `checked_by = auth.uid()`, `checked_at = now()`, `checked_initial = upper(left(auth.jwt() ->> 'email', 1))`; when it flips to false: all three null. BEFORE INSERT OR UPDATE on both tables.
- RLS on both: one policy `supply_rw` FOR ALL `to authenticated using ((select public.has_role('zapasy'))) with check ((select public.has_role('zapasy')))` (admin passes via `has_role`). Grants: `revoke all … from anon, authenticated; grant select, insert, update on … to authenticated` (no row removal from the client — soft only).
- `alter publication supabase_realtime add table public.supply_tabs, public.supply_items;`
- Rollback `supabase/rollback/20261029110000_supplies_down.sql`: remove both tables from the publication, drop `supply_items`, `supply_tabs`, `supply_touch()`.

#### 2. Data layer

**File**: `src/features/supplies/data.ts`, `src/features/supplies/types.ts`, `src/features/supplies/money.ts`

**Intent**: Load, write and subscribe; pure helpers for totals.

**Contract**:
- `loadSupplies()` → `{ tabs: SupplyTab[] (all, incl. archived), items: SupplyItem[] (all, incl. removed) }`, ordered by `sort_order`. ~70 rows, so one select each (well under the 1000-row cap).
- `updateItem(id, patch)`, `insertItem(fields)`, `updateTab(id, patch)`, `insertTab(fields)` — patches send only changed columns (last write wins per field).
- `subscribe(onTab, onItem, onStatus)` → one channel `supplies` with `postgres_changes` (`*`) on both tables; returns an unsubscribe.
- `money.ts`: `effective(item) → { min, max, own: boolean } | null` (own price → `{own, own}`; else `price_min..price_max ?? price_min`; else null); `sum(items) → [min, max]` skipping nulls; `fmtRange(min, max)` → `"3 750–4 220 zł"` / `"80 zł"` (pl-PL, no decimals unless present). Own copy of formatting — no import from `@/lib/format`.

#### 3. UI

**File**: `src/features/supplies/SuppliesApp.tsx`, `TabBar.tsx`, `Summary.tsx`, `ItemRow.tsx`, `ItemSheet.tsx`, `TabsSheet.tsx`, `RemovedList.tsx`, `supplies.module.css`; `src/app/zapasy/page.tsx`; `src/shell/AppNav.tsx` (add "Zapasy" for `zapasy`)

**Intent**: The prototype's UX on live data, every value editable, big touch targets, works in light and dark via the existing tokens.

**Contract**:
- **Page**: `<Shell need="zapasy">` → `<SuppliesApp />`. Title "Zapasy"; live status in the summary ("Na żywo" / "Łączenie…" / "Brak połączenia — zmiany zapiszą się po odświeżeniu"); error banner with "Spróbuj ponownie" on load failure; "Wczytywanie…" while loading.
- **Sub-tab bar** (sticky with the summary): chip "Wszystko" + one chip per non-archived tab by `sort_order`, + "⋯" opening `TabsSheet`. Selected sub-tab kept in `sessionStorage` (`supplies-tab`).
- **TabsSheet**: list of tabs with name + description inputs (save on blur), ↑/↓ to reorder (swap `sort_order`), "Archiwizuj" (if the tab has active items: armed second tap "Archiwizuj z N pozycjami?"), section "Zarchiwizowane" with "Przywróć"; "Dodaj podzakładkę" (name required). Items keep their `tab_id`; an archived tab's items disappear from every view and the summary and come back with it.
- **List**: in a sub-tab — groups by `category` (order = first `sort_order` in the group); in "Wszystko" — sections per active tab (heading = tab name, description below, per-tab sum "razem ok. …"), then categories. Rows: checkbox (24 px, whole row label ≥ 44 px), name, quantity, details (2-line clamp, tap row text to open `ItemSheet`), price button, ↑/↓ (within the category; swap `sort_order` with the neighbour), × remove. Checked row = struck name + `--good` tint + initial badge (`checked_initial`, or ✓ when null).
- **Price**: tapping the price turns it into an input for `own_price` (as in the prototype): Enter/blur saves, empty input clears `own_price` (back to the estimate), Escape cancels; "Twoja cena" marker when own price is set; items without any price show `price_label` or "dodaj cenę".
- **ItemSheet** (bottom sheet using the global `.scrim/.sheet/.field/.btn` classes): name*, sub-tab (select of active tabs — moving sets `sort_order` to the end of the target category), category (text + `<datalist>` of categories used in that tab), quantity, details (textarea, shown as plain text), estimate: "Od" / "Do" (one amount = leave "Do" empty → stored as `price_max = null`), price label, own price; "Zapisz", "Usuń z listy". "+ Dodaj" button (sticky bottom-right FAB ≥ 48 px) opens it empty, pre-set to the current sub-tab (first active tab in "Wszystko").
- **Filters** (row under the chips): "Ukryj kupione" toggle, search input (name + details, case- and diacritics-insensitive), category select (categories of the current scope; resets when the sub-tab changes). Filters change the list, not the summary.
- **Summary** (sticky): for the current sub-tab, or all active tabs in "Wszystko": "Kupione X / Y" (Y = active items in scope), "Wydane" = sum over checked, "Zostało" = sum over unchecked, both as ranges unless min = max; progress bar X/Y. Removed items, items of archived tabs and items without a price are excluded from amounts (they still count in Y except removed/archived).
- **RemovedList**: "Usunięte z listy" for the current scope, ↺ restore one tap.
- **Realtime**: as in Critical Implementation Details; optimistic local updates, revert + toast "Nie zapisano: …" on error.
- CSS module uses only tokens from `globals.css` (`--surface, --line, --muted, --accent, --good, --r`, fonts) and the shared classes; no new colours except `color-mix` of tokens.

#### 4. Isolation rule

**File**: `eslint.config.mjs`

**Intent**: Make "no imports between Zapasy and the dashboard" a lint failure, so removal stays trivial.

**Contract**: `no-restricted-imports` overrides — files `src/features/supplies/**`: forbid `@/components/*`, `@/lib/*` except `@/lib/supabase`, `@/shell/*`, `@/features/admin/*`; files `src/components/**`, `src/lib/**`, `src/shell/**`, `src/features/admin/**`: forbid `@/features/supplies*`. Only `src/app/zapasy/page.tsx` composes Shell + SuppliesApp; `AppNav` links to `/zapasy` by URL only.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly via `apply_migration`; `select tablename from pg_publication_tables where pubname = 'supabase_realtime'` lists `supply_tabs` and `supply_items`
- Type checking passes: `npm run typecheck`
- Linting passes, including the import boundary: `npm run lint`
- Integration tests pass: `npm run test:int`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- On the phone (390 px), light and dark: the test `zapasy` account adds a sub-tab, adds an item to it, changes its name, details, quantity and price, moves it to another sub-tab; Rafał sees each change live on another device
- Checking an item on one device appears on the other within ~2 s with the right initial
- Archiving a sub-tab with items asks for confirmation and hides its items; restoring brings them back
- Own price: tap, type, Enter → "Twoja cena"; clearing restores the range; summary updates
- The `zapasy`-only account sees only "Zapasy" in the nav; `/` redirects to `/zapasy`; a `dashboard`-only account does not see "Zapasy" and `/zapasy` redirects to `/`

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 4.

---

## Phase 4: Seed

### Overview

Import `inputs/zapasy-seed.json` once: 2 sub-tabs and 70 items, idempotent, never overwriting later edits.

### Changes Required:

#### 1. Generator and SQL

**File**: `scripts/gen-supplies-seed.mjs`, `supabase/seed/supplies_seed.sql`, `package.json` (script `seed:supplies:sql`)

**Intent**: A small Node script turns the JSON into one insert-only SQL file; the SQL is committed and run once by the orchestrator via MCP `execute_sql` (no "delete" anywhere in it).

**Contract**:
- Reads `context/changes/household-supplies/inputs/zapasy-seed.json` (path argument, default that path), writes `supabase/seed/supplies_seed.sql`, escaping quotes.
- Tabs: `insert into supply_tabs (name, description, sort_order) select … where not exists (select 1 from supply_tabs where name = …)` for "A: niezbędne" (sort 1, description "niezbędne, niedrogie") and "B: droższe" (sort 2, description "droższe, bardzo przydatne") — descriptions from the prototype's tier tags.
- Items: `insert into supply_items (key, tab_id, category, name, quantity, details, price_min, price_max, price_label, own_price, checked, removed, sort_order) select …, (select id from supply_tabs where name = <tier tab> and not archived order by created_at limit 1), … on conflict (key) do nothing` — `tier A → "A: niezbędne"`, `B → "B: droższe"`, `details = null`. "Upsert by key" is implemented as insert-or-skip so user edits are never overwritten (brief: runs once, never overrides later changes).
- Wrapped in `begin; … commit;`; ends with a verification `select` (tabs, active, removed counts).

### Success Criteria:

#### Automated Verification:

- `npm run seed:supplies:sql` regenerates an identical `supabase/seed/supplies_seed.sql` (`git diff --exit-code`)
- After running the SQL: `select count(*) from supply_tabs` = 2, active items = 51, removed = 19; running it a second time inserts 0 rows
- Type checking, lint, test:int and build pass: `npm run typecheck && npm run lint && npm run test:int && npm run build`

#### Manual Verification:

- `/zapasy` shows "A: niezbędne" and "B: droższe"; "Wszystko" summary: Kupione 0 / 51, Zostało 10 700–20 120 zł; A: 3 750–4 220 zł; B: 6 950–15 900 zł; "Usunięte z listy" has 19 entries in "Wszystko"

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 5.

---

## Phase 5: E2E

### Overview

One Playwright test that covers the risks only a browser shows: role-based route protection, the supplies basic flow and realtime between two accounts.

### Changes Required:

#### 1. Test

**File**: `tests/e2e/smoke.spec.ts`, `playwright.config.ts` (comment on env vars)

**Intent**: Keep the existing Dziś check and add one test with two browser contexts: the admin (`E2E_EMAIL`/`E2E_PASSWORD`) and the `zapasy`-only test account (`E2E_SUPPLIES_EMAIL`/`E2E_SUPPLIES_PASSWORD`, created in phase 2). Credentials from env only; the test skips when they are missing.

**Contract** (one `test(...)`):
- Supplies user: login → lands on `/zapasy`; nav has "Zapasy" and no "Dashboard"/"Użytkownicy"; `goto("/")` → URL ends with `/zapasy`; `goto("/admin/uzytkownicy")` → not on the admin page.
- Admin: login → nav has "Dashboard", "Zapasy", "Użytkownicy"; open `/zapasy`.
- Flow: in the supplies context pick the first unchecked item row in "A: niezbędne", check it → "Kupione" count rises by 1; the admin context shows the same row checked within 5 s (realtime). Then uncheck it in the admin context and expect the supplies context to show it unchecked — state restored, in a `finally` as well.
- Runs at 390 px against `npm run preview` (same as today); not in CI.

### Success Criteria:

#### Automated Verification:

- E2E passes: `npx playwright test` (with the four env vars set)
- Type checking, lint, test:int and build pass: `npm run typecheck && npm run lint && npm run test:int && npm run build`

#### Manual Verification:

- Rafał runs the full acceptance pass on the phone (Testing Strategy, manual steps) and the existing dashboard tabs work as before

**Implementation Note**: After this phase, open the PR (Rafał merges).

---

## Testing Strategy

Owner override (2026-10-29): no unit tests, no RLS test suite.

### Unit Tests:

- None (deliberate). Totals are checked against the seed numbers in phase 4.

### Integration Tests:

- Existing `tests/integration/ytMap.test.ts` and `distrokid.test.ts` must keep passing (`npm run test:int`).
- E2E (one test, phase 5): route protection per role, check/uncheck, realtime between two accounts.

### Manual Testing Steps:

1. Phone, 390 px, light and dark: dashboard unchanged for Rafał (all tabs, save a task, YouTube card).
2. Invite flow end to end with the test account; set password; land on `/zapasy`.
3. Role matrix: `zapasy`-only cannot open `/` or `/admin/uzytkownicy`; `dashboard`-only cannot open `/zapasy`; no role → no-access screen; a role change applies after reload.
4. Last admin cannot be removed: unticking the own `admin` role and "Odbierz dostęp" on himself both fail with the Polish message.
5. Two devices: every edit type from the brief's acceptance list appears live.
6. Seed totals match the numbers in phase 4.

## Performance Considerations

- ~70 items, 2–5 tabs: load everything once, filter and sum in memory; no pagination.
- One realtime channel per open `/zapasy` page; realtime RLS checks call `has_role` per change (tiny table, PK lookup).
- `(select public.has_role(...))` in policies so Postgres evaluates it once per statement.

## Migration Notes

| # | File | Kind | Apply when | Safe for live `main`? | Rollback |
| --- | --- | --- | --- | --- | --- |
| 1 | `20261029100000_roles.sql` | expand (schema + `is_owner` body + 2 role rows) | after Rafał approves, before merge | yes: the owner gets `admin`+`dashboard` in the same transaction, so `is_owner()` stays true | `supabase/rollback/20261029100000_roles_down.sql` (restores the e-mail `is_owner` body, drops role objects) |
| 2 | `20261029110000_supplies.sql` | expand (new tables, publication) | after approval, before merge | yes: nothing existing changes | `supabase/rollback/20261029110000_supplies_down.sql` |
| 3 | `supabase/seed/supplies_seed.sql` | data, insert-only, `execute_sql` | after #2, before merge | yes | none needed (fresh tables); to start over, roll back #2 and re-apply |

- Order: (0) read-only `select` checks: 1 auth user, 1 `app_owners` row matching it → (1) apply #1 → verify roles (`select count(*) from user_roles` = 2) and that the live app still loads for Rafał → (2) apply #2 → verify publication → (3) run seed → verify counts → merge → Workers build → phone check.
- No contract step: `is_owner()` keeps its name and `app_owners` stays as an inert record (the migration reads it once). Optional later cleanup, not in this change.
- Removing "Zapasy" later: drop `src/features/supplies`, `src/app/zapasy`, the nav entry and the lint override, run the supplies rollback. The `zapasy` enum value can stay.
- `execute_sql` rule: no "delete" in SQL run through MCP; the seed is insert-only and every write is verified with a `select`. Migrations and rollbacks go through `apply_migration`.

## References

- Brief: `context/changes/household-supplies/inputs/prompt-zapasy-role.md`
- Prototype: `context/changes/household-supplies/inputs/lista-zapasow.html`
- Seed: `context/changes/household-supplies/inputs/zapasy-seed.json`
- Working rules: `context/handoff.md`
- Conventions and migration style: `context/changes/side-hustle-assistant/plan.md`, `supabase/migrations/20261028120000_royalties.sql`
- Session/app shell today: `src/components/App.tsx:9`, `src/lib/supabase.ts:6`
- Server auth: `src/lib/server/auth.ts:7`, service client `src/lib/server/db.ts:5`, secrets `src/lib/server/env.ts:4`
- Dashboard tabs/header: `src/components/Tracker.tsx:15`
- Tokens and shared classes: `src/app/globals.css:2`
- E2E: `tests/e2e/smoke.spec.ts`, `playwright.config.ts`

## Decisions

Made by the planner on 2026-10-29 (owner asked for no questions; non-UI technical choices are the agent's call per `context/handoff.md`).

| # | Topic | Decision | Why |
| --- | --- | --- | --- |
| D1 | Dashboard data scoping | Dashboard data stays global (no `user_id`); every `dashboard` or `admin` user sees and edits the same shared dashboard, incl. connecting/syncing YouTube | Data was never per user; access was always "is the owner". A second dashboard person is a collaborator on the same workspace |
| D2 | Existing `owner_all` / `owner_read` policies | Unchanged. `is_owner()` body becomes `has_role('dashboard')` (admin passes); name kept | One atomic change moves 12 policies, `integration_status()` and `requireOwner` to roles; no policy dropped or rewritten, rollback = old body |
| D3 | Route protection | Client-side guards in the shell + RLS on all data + role checks in every server route. No Next middleware, no cookie sessions | Sessions live in localStorage (middleware can't see them); pages are static shells without data, so the real boundary is the database. Cookie migration would sign everyone out and depends on OpenNext middleware support — not worth it for a private app (owner: don't over-engineer) |
| D4 | First admin | Migration grants `admin` + `dashboard` to the `auth.users` row whose e-mail matches `app_owners`; aborts if none | Uses the existing owner mechanism; no e-mail in repo or SQL |
| D5 | Role writes | Direct `insert`/`delete` on `user_roles` under RLS (admin only) + AFTER row trigger guarding the last admin | DB-enforced, no RPC layer needed |
| D6 | Invites | Server route `generateLink({type:"invite"})` with the service-role client; roles granted immediately to the new user id; the admin shares the link (copy / share sheet / mailto). No `pending_invites` table | Supabase's built-in SMTP won't deliver to non-team addresses, and its links are implicit-flow (clash with PKCE). The invited user exists right after `generateLink`, so roles need no pending table. Switching to `inviteUserByEmail` later only needs custom SMTP |
| D7 | Invited user's login | `/haslo` redeems `token_hash` via `verifyOtp` and asks for a password | Login is password-first and works in the PWA without e-mail |
| D8 | Roles in the client | Read from `user_roles` on start and on auth change; no JWT custom claims | "Applies at the latest after a refresh" is enough |
| D9 | Main nav | New shell nav: Dashboard, Zapasy, Użytkownicy (by role) + Hasło + Wyloguj; dashboard's internal tabs unchanged | There was no app-level nav; "Wyloguj" moves from Tracker to the shell |
| D10 | Wrong-section URL | Redirect to the first permitted section; no role at all → no-access screen | Simple and matches "direct URL doesn't work" |
| D11 | Module isolation | `src/features/supplies/**` imports only React + `@/lib/supabase`; enforced by ESLint `no-restricted-imports` both ways; own CSS module, own money formatting, own trigger function | Removal = delete folder + route + nav line + rollback |
| D12 | Categories | Free text with `<datalist>` suggestions from the current tab; no table | Brief's default; 14 categories |
| D13 | Checked-by initial | Trigger sets `checked_by`, `checked_at`, `checked_initial` (first letter of the JWT e-mail) | No profile table needed; supplies stay self-contained |
| D14 | Single price | "Do" empty → `price_max = null`, shown as one amount | Matches "range or one amount" with the brief's columns |
| D15 | Summary scope | Summary depends on the sub-tab only, not on search/category/hide-bought filters; Y counts active items incl. those without price | Matches the prototype; filters are for finding, totals for budgeting |
| D16 | Filter state | "Ukryj kupione" and search persist across sub-tabs; category filter resets on sub-tab change | Category sets differ per tab |
| D17 | Concurrency | Per-field last write wins; realtime merge by `updated_at` | Few users, shared list |
| D18 | Reordering | ↑/↓ arrows swapping `sort_order` (items within a category, tabs in TabsSheet); no drag-and-drop | Brief: arrows suffice on phones |
| D19 | Removal | Soft only (`removed`, `archived`); clients get no DELETE grant on supply tables | Brief + MCP "no delete" rule |
| D20 | Seed idempotency | Insert-or-skip by `key` (`on conflict do nothing`), tabs by name | "Upsert by key" without ever overwriting user edits |
| D21 | Seed descriptions | Tab descriptions from the prototype tags ("niezbędne, niedrogie", "droższe, bardzo przydatne"); `details` null | Brief: details empty |
| D22 | Tests | One E2E test (two contexts: admin + `zapasy`-only) in `smoke.spec.ts`; no unit/RLS tests | Owner override |
| D23 | Delivery | One branch, one commit per phase, one PR at the end; both migrations + seed applied before merge | Brief: small commits per phase; both migrations are additive |

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Roles and RLS

#### Automated

- [ ] 1.1 Migration applies cleanly via `apply_migration` and `select role from user_roles` returns exactly `admin`, `dashboard` for the single existing user
- [ ] 1.2 Type checking passes: `npm run typecheck`
- [ ] 1.3 Linting passes: `npm run lint`
- [ ] 1.4 Integration tests pass: `npm run test:int`
- [ ] 1.5 OpenNext build passes: `npm run build`

#### Manual

- [ ] 1.6 Before merge (migration applied, old `main` still live): Rafał's dashboard on the phone loads and saves as before, YouTube sync card shows status
- [ ] 1.7 On the branch preview: the dashboard works as before at 390 px, the nav shows "Dashboard" and "Wyloguj", light and dark mode
- [ ] 1.8 Read-only check via `execute_sql` in a rolled-back transaction: `set local role authenticated` with `request.jwt.claims` of a random uuid returns 0 rows from `tasks` and `false` from `is_owner()` (the last-admin guard is checked through the UI in 2.7, so no removal SQL runs through MCP)

### Phase 2: Admin panel and invites

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Integration tests pass: `npm run test:int`
- [ ] 2.4 OpenNext build passes: `npm run build`
- [ ] 2.5 `SUPABASE_SECRET_KEY` and `serviceDb` are not referenced from any client file: `grep -rl "serviceDb\|SUPABASE_SECRET_KEY" src --include=*.tsx` is empty

#### Manual

- [ ] 2.6 Rafał invites a test account with role `zapasy` on the phone, opens the link in a private window, sets a password, and lands on the no-access screen until phase 3 ships (then on `/zapasy`)
- [ ] 2.7 Unticking his own `admin` role (the only admin) shows "Musi zostać co najmniej jeden administrator." and the checkbox returns
- [ ] 2.8 Granting `dashboard` to the test account shows the dashboard after a reload; "Odbierz dostęp" brings it back to the no-access screen after a reload
- [ ] 2.9 `/admin/uzytkownicy` opened by the non-admin test account redirects away; `GET /api/admin/users` with its token returns 403

### Phase 3: Supplies module

#### Automated

- [ ] 3.1 Migration applies cleanly via `apply_migration`; `select tablename from pg_publication_tables where pubname = 'supabase_realtime'` lists `supply_tabs` and `supply_items`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes, including the import boundary: `npm run lint`
- [ ] 3.4 Integration tests pass: `npm run test:int`
- [ ] 3.5 OpenNext build passes: `npm run build`

#### Manual

- [ ] 3.6 On the phone (390 px), light and dark: the test `zapasy` account adds a sub-tab, adds an item to it, changes its name, details, quantity and price, moves it to another sub-tab; Rafał sees each change live on another device
- [ ] 3.7 Checking an item on one device appears on the other within ~2 s with the right initial
- [ ] 3.8 Archiving a sub-tab with items asks for confirmation and hides its items; restoring brings them back
- [ ] 3.9 Own price: tap, type, Enter → "Twoja cena"; clearing restores the range; summary updates
- [ ] 3.10 The `zapasy`-only account sees only "Zapasy" in the nav; `/` redirects to `/zapasy`; a `dashboard`-only account does not see "Zapasy" and `/zapasy` redirects to `/`

### Phase 4: Seed

#### Automated

- [ ] 4.1 `npm run seed:supplies:sql` regenerates an identical `supabase/seed/supplies_seed.sql` (`git diff --exit-code`)
- [ ] 4.2 After running the SQL: `select count(*) from supply_tabs` = 2, active items = 51, removed = 19; running it a second time inserts 0 rows
- [ ] 4.3 Type checking, lint, test:int and build pass: `npm run typecheck && npm run lint && npm run test:int && npm run build`

#### Manual

- [ ] 4.4 `/zapasy` shows "A: niezbędne" and "B: droższe"; "Wszystko" summary: Kupione 0 / 51, Zostało 10 700–20 120 zł; A: 3 750–4 220 zł; B: 6 950–15 900 zł; "Usunięte z listy" has 19 entries in "Wszystko"

### Phase 5: E2E

#### Automated

- [ ] 5.1 E2E passes: `npx playwright test` (with the four env vars set)
- [ ] 5.2 Type checking, lint, test:int and build pass: `npm run typecheck && npm run lint && npm run test:int && npm run build`

#### Manual

- [ ] 5.3 Rafał runs the full acceptance pass on the phone (Testing Strategy, manual steps) and the existing dashboard tabs work as before
