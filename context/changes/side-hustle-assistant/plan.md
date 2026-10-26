# Side Hustle Assistant Implementation Plan

## Overview

Turn the `ai-label-tracker` app from a manual task tracker into a personal assistant and dashboard for the Wydawnictwo project: a "Dziś" (Today) screen with rule-based alerts (no LLM), automatic YouTube data sync, push notifications, a DistroKid CSV import, and a rename to **Side Hustle Assistant** (new worker and URL). The strategy (option B, gates on 2026-12-05 and 2027-01-16) must be visible in the app, not only in a document.

## Current State Analysis

- One client screen, `src/components/Tracker.tsx` (384 lines), with 5 tabs: Zadania, Pipeline, Tygodnie, Koszty, Subskrypcje; above them the gamification panel (XP, levels, badges — `src/lib/game.ts`) and the KPI strip (`Strip`).
- Data: Supabase `gigsqrnwyeioqlkngfqe`, read directly from the browser with supabase-js (`src/lib/data.ts:12` `loadAll`), RLS through `public.is_owner()`. No backend: the app renders client-side and the session lives in localStorage, not cookies.
- `channels` has one row, "Sceny sezonowe" (Slowfall is not under its real name, no CMV, no electronic artist). `content_items` has 3 rows; film #3 is not `live`; `yt_video_id` exists but is empty. `weekly_stats` is empty (0 rows). Subscriptions: Midjourney, ElevenLabs, Suno, DistroKid.
- No tests, no CI workflow; deploy is Cloudflare Workers Builds from `main` (`npm run build` = OpenNext build). Worker `ai-label-tracker`, URL `ai-label-tracker.sidereus.workers.dev`.
- No notion of a gate/goal, and tasks/costs are not linked to a channel.

## Desired End State

- The app is called **Side Hustle Assistant** and runs at `side-hustle-assistant.sidereus.workers.dev`; the old URL redirects (301).
- Default screen **Dziś**: an alert list (overdue tasks and tasks due within 3 days, subscription renewals within 7 days, film CTR < 3%, week-over-week drop in thumbnail impressions) plus cards for the 2026-12-05 and 2027-01-16 gates showing current value vs. threshold. Gamification stays unchanged.
- Projects (Slowfall Scenes, Contents May Vary, Elektronika) are the shared dimension for tasks, costs, content and stats.
- A daily cron pulls YouTube data for every connected channel (views, watch hours, subscribers, AVD, thumbnail impressions, CTR) and stores it per video and per week (`source = yt_api`).
- One push notification per day to the phone when there is at least one alert.
- A DistroKid CSV import adds revenue/streams per artist and month.
- Verification: typecheck + lint green, 2 integration tests (YouTube mapping, CSV parser) and 1 smoke E2E green, Rafał confirms on the phone.

### Key Discoveries:

- `src/lib/data.ts:12-32` — the whole data layer is one `loadAll` plus `saveRow`/`archiveRow`; new tables follow the same pattern (soft delete via `archived_at`).
- `src/components/Tracker.tsx:12-18` — tabs are the `TABS` array; Dziś is a new first entry and the new default `tab`.
- `src/lib/game.ts:37-47` — `weeksAgg`/`trend` already compute the week-over-week watch-hours trend; the F1 gate rule reuses that aggregation once it is per project.
- Thumbnail impressions and CTR are **not** available in the YouTube Analytics API. They exist only in the YouTube Reporting API, report `channel_reach_basic_a1` (dimensions `date, channel_id, video_id`, metrics `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr`), generated daily as CSV by a job created once per channel.
- The channels are Brand Accounts under `smartlife.dev.ai@gmail.com`, so an OAuth token is per channel (account picked on the consent screen) and the integration is per project.
- The Supabase session is in localStorage, so API routes see no cookies: the client sends `Authorization: Bearer <access_token>`, and the route verifies it with `auth.getUser(token)` plus `is_owner`.
- `wrangler.jsonc:3` — `main: .open-next/worker.js`; adding `scheduled` needs a custom entry that re-exports the OpenNext handler.

## What We're NOT Doing

- No LLM (brief, chat) — rules only (decision 2026-10-26).
- No changes to gamification: XP, levels and badges stay as they are.
- No DistroKid API (none exists) and no scraping — manual CSV import only.
- No Spotify/Apple/TikTok data beyond what the DistroKid CSV contains.
- No unit tests; no CI (tests run manually or by the agent).
- No GitHub repo rename (optional later; GitHub keeps a redirect).
- No multi-user — still one owner (`app_owners`).
- No writes to YouTube (read-only scopes).

## Implementation Approach

Order: data model first (everything depends on it), then the Dziś screen on manual data (visible result right away), then the YouTube integration that feeds the same tables. **Release 1 (target: before 2026-10-31) = phases 1–3**; if phase 3 does not fit by 10-31, release 1 = phases 1–2 and Rafał enters the Studio numbers for the thumbnail-template choice manually. Phases 4–6 are release 2. Each phase is its own PR to `main` (deployed by Workers Builds), opened only after the previous one has merged.

Backend = Next route handlers (`src/app/api/**/route.ts`) plus a `scheduled` handler in the same worker. Secrets live only as Worker secrets; OAuth tokens live in a table with no RLS policy for `authenticated` (service role only).

## Critical Implementation Details

- **The Google OAuth app must be "In production".** In "Testing" refresh tokens expire after 7 days and the sync dies silently. For personal use the app can stay unverified (warning screen at consent). Scopes: `yt-analytics.readonly` + `youtube.readonly`, `access_type=offline`, `prompt=consent`.
- **The Reporting API starts late.** After a job is created the first reports appear after about 1–2 days (with back data), so CTR on the Dziś screen is empty on connection day — the UI shows "waiting for the first report", not zero.
- **The channels → projects migration must keep ids.** `content_items.channel_id` and `weekly_stats.channel_id` (part of the PK) point at `channels.id`; the new table takes over the same uuids and the columns are renamed to `project_id`, so the `weekly_stats` PK is not rewritten.

## Phase 1: Projects and data model

### Overview

Introduce projects as the shared dimension, gates, and per-video data; clean up existing data.

### Changes Required:

#### 1. Schema migration

**File**: `supabase/migrations/<ts>_projects.sql` (new folder; apply with Supabase MCP `apply_migration`)

**Intent**: Replace `channels` with typed `projects` and add the tables the assistant needs.

**Contract**:
- `projects` (takes over the rows and ids of `channels`): `id uuid`, `name`, `kind text check in ('yt_channel','artist','both')`, `status text check in ('aktywny','utrzymanie','planowany','zamknięty')`, `yt_channel_id text null`, `distrokid_artist text null`, `note`, `created_at`, `archived_at`. `channels` is dropped in the same phase once the code reads `projects`.
- `content_items.channel_id` → `project_id`, `weekly_stats.channel_id` → `project_id` (PK `(project_id, week_start)`); `weekly_stats` gains `impressions int null`.
- `tasks.project_id uuid null`, `subscriptions.project_id uuid null` (null = shared).
- `gates`: `id`, `project_id`, `title`, `due date`, `rule text` (`ctr_last3_avg` | `impressions_wow_rising` | `watch_hours_month_vs`), `params jsonb` (e.g. `{"min_pct":3}`, `{"month":"2027-01","vs":"2026-11"}`), `note`, `archived_at`.
- `video_daily`: PK `(yt_video_id, date)`, `project_id`, `views int`, `watch_minutes numeric`, `subs_net int`, `avd_sec numeric`, `impressions int`, `ctr_pct numeric`, `source text default 'yt_api'`.
- RLS + the `owner_all` policy (`is_owner()`) on new tables, as on existing ones.

#### 2. Existing data

**File**: the same migration (data section) or a separate SQL script

**Intent**: Match reality before the first sync.

**Contract**: row "Sceny sezonowe" → `Slowfall Scenes` (`kind yt_channel`, `yt_channel_id UCrAjgi48bJBW351SaIqi6Yw`); new projects `Contents May Vary` (`both`, `distrokid_artist 'Contents May Vary'`, `status utrzymanie`) and `Elektronika` (`artist`, `planowany`); film #3 added/set `live` with `yt_video_id Y1zTI-zy9HA`, film #1 `yL4czbAFQ54`, film #2 id filled in by Rafał; gates: "Bramka 1" (Slowfall, 2026-12-05, `ctr_last3_avg` 3% **and** `impressions_wow_rising`) and "Bramka F1" (Slowfall, 2027-01-16, `watch_hours_month_vs` 2027-01 vs 2026-11). Tasks t25/t26/t07 → project Elektronika; Slowfall tasks → Slowfall.

#### 3. Code on projects

**File**: `src/lib/types.ts`, `src/lib/data.ts`, `src/components/Sheet.tsx`, `src/components/Tracker.tsx`

**Intent**: `Channel` → `Project`, the `channel` form field → `project`, new columns in `loadAll`; optional project picker in the task and subscription forms; project chip on rows.

**Contract**: `Data.projects`, `Data.gates`, `Data.videoDaily`; `saveRow("weeks")` keys on `project_id`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly (Supabase `apply_migration`), and `select count(*)` returns 3 for `projects` and 2 for `gates`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- On the phone all 5 existing tabs work as before; XP and badges unchanged
- The task form lets you pick a project and the project chip shows on the list

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 2.

---

## Phase 2: Dziś screen and alert rules

### Overview

A new default "Dziś" tab with alerts and gate cards, computed in code from the database.

### Changes Required:

#### 1. Rules

**File**: `src/lib/rules.ts` (new)

**Intent**: Pure functions computing alerts and gate status from `Data`, shared by the UI and (in phase 4) the cron.

**Contract**: `alerts(d: Data, today: string): Alert[]` where `Alert = { kind: 'task_late'|'task_soon'|'renewal'|'ctr_low'|'impressions_drop'|'gate', severity: 'high'|'med'|'low', title, detail, ref, projectId? }`; `gateStatus(g: Gate, d: Data): { value: number|null, target: number, ok: boolean|null, daysLeft: number, label: string }`. Thresholds: overdue task = high, due ≤ 3 days = med; active subscription renewing ≤ 7 days = med; film CTR < 3% (from `video_daily`, last 7 days, at least 100 thumbnail impressions) = med; thumbnail impressions down > 20% week over week = med; gate ≤ 14 days to due and `ok=false` = high. Missing data → gate `ok=null` ("no data"), never false.

#### 2. View

**File**: `src/components/Today.tsx` (new), `src/components/Tracker.tsx`

**Intent**: "Dziś" is the first and default tab; alerts sorted by severity, gate cards with value, threshold and days left; tapping an alert opens the linked record (task/subscription/film).

**Contract**: `TABS` gets `{ id: "dzis", name: "Dziś" }` at position 0; default `tab = "dzis"` (a remembered choice in localStorage still wins). Mobile-first, 390 px.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- On the phone Dziś opens by default and shows overdue tasks (e.g. t04) and upcoming renewals
- Gate cards for 12-05 and 01-16 show "no data" before any stats, and a value after a week is entered manually

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 3.

---

## Phase 3: YouTube sync

### Overview

Connect channels through OAuth and run a daily cron that stores per-video and per-week data.

### Changes Required:

#### 1. Integration storage

**File**: migration `supabase/migrations/<ts>_integrations.sql`

**Intent**: Store refresh tokens and sync state safely.

**Contract**: `integrations`: PK `(project_id, provider)`, `provider 'youtube'`, `yt_channel_id`, `refresh_token text`, `reporting_job_id text null`, `last_sync_at`, `last_error text null`. RLS enabled with **no** policies for `authenticated` (service role only). A security-definer function `integration_status()` (checks `is_owner()`) returns everything except the token, for the UI.

#### 2. OAuth

**File**: `src/app/api/yt/connect/route.ts`, `src/app/api/yt/callback/route.ts`, `src/lib/server/auth.ts`, `src/lib/server/google.ts` (new)

**Intent**: A "Connect YouTube" button on a project → Google consent on the chosen Brand Account → store the token and channel id (from `channels.list?mine=true`) and create the Reporting API job for `channel_reach_basic_a1`.

**Contract**: `POST /api/yt/connect` with `Authorization: Bearer <supabase access token>` and `{ projectId }` → `{ url }` (Google auth URL with an HMAC-signed `state`: projectId + expiry). `GET /api/yt/callback?code&state` → exchange the code, write with the service-role client, redirect to `/?yt=ok|err`. Worker secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `STATE_SECRET`.

#### 3. Cron and mapping

**File**: `worker.ts` (new entry), `wrangler.jsonc`, `src/lib/server/ytSync.ts`, `src/lib/ytMap.ts` (new)

**Intent**: Once a day, per integration: refresh the access token; pull daily per-video data from the Analytics API (last 28 days: `views, estimatedMinutesWatched, averageViewDuration, subscribersGained, subscribersLost`, dimensions `day,video`); download new reach reports from the Reporting API (CSV); map into `video_daily` (upsert) and recompute `weekly_stats` (`source yt_api`, upsert on `(project_id, week_start)`; `manual` rows for those weeks are overwritten). An error writes `last_error` and does not stop other integrations.

**Contract**: `wrangler.jsonc`: `main: "worker.ts"`, `triggers.crons: ["0 5 * * *"]` (06:00/07:00 Poland). `worker.ts` exports `{ fetch: openNext.fetch, scheduled }`. `ytMap.ts`: `mapAnalytics(json) → VideoDay[]`, `mapReach(csv) → VideoDay[]`, `toWeeks(rows) → Week[]` — pure functions covered by an integration test on fixtures. Manual trigger: `POST /api/yt/sync` (owner) to test without waiting for the cron.

#### 4. Integration UI

**File**: `src/components/Today.tsx` or a project panel

**Intent**: Status per project: "not connected / connected, last sync <date> / error <text> / waiting for the first CTR report" plus "Connect" and "Sync now" buttons.

#### 5. Integration test

**File**: `tests/integration/ytMap.test.ts`, `tests/fixtures/yt-analytics.json`, `tests/fixtures/reach.csv`; dev dependency `vitest`; script `npm run test:int`

**Intent**: The phase's only test: a realistic Analytics API response + reach CSV → correct `video_daily` rows and weekly totals (weeks start Monday, CTR as %, minutes → hours).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly and `refresh_token` is not readable by the `authenticated` role
- YouTube mapping integration test passes: `npm run test:int`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- Rafał creates the OAuth client in Google Cloud ("In production"), adds the secrets in Cloudflare and connects Slowfall from the phone
- After "Sync now" the Tygodnie tab shows `[API]` rows whose views and hours match Studio (±5%)
- After 1–2 days per-video CTR appears, and the "CTR < 3%" alert matches Studio

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 4. End of release 1.

---

## Phase 4: PWA push notifications

### Overview

One daily notification when `alerts()` returns something with severity high or med.

### Changes Required:

#### 1. Push subscription

**File**: `public/sw.js`, `src/components/PushToggle.tsx`, `src/app/api/push/subscribe/route.ts`, migration `push_subscriptions`

**Intent**: A "Notifications" toggle registers the service worker, asks for permission and stores the subscription (endpoint + keys) in an owner-RLS table.

**Contract**: `push_subscriptions(endpoint PK, p256dh, auth, created_at, last_ok_at, failed_count)`; secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

#### 2. Sending from the cron

**File**: `src/lib/server/push.ts`, `worker.ts`

**Intent**: After the YouTube sync the cron computes `alerts()` (same function as the UI, data via service role) and sends one notification with the count and the top alert; tapping it opens Dziś. Subscriptions answering 404/410 are archived.

**Contract**: a Web Push library that runs on WebCrypto in workerd (e.g. `@block65/webcrypto-web-push`; npm `web-push` depends on node `https`/`crypto` — verify during implementation). iOS: push only for a PWA added to the home screen (iOS ≥ 16.4).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- Rafał enables notifications on the phone and receives a test notification (`POST /api/push/test`)
- The next morning one notification with alerts arrives, and nothing arrives on a day without alerts

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 5.

---

## Phase 5: DistroKid CSV import

### Overview

Manual import of the monthly DistroKid Bank export, mapped to artist projects.

### Changes Required:

#### 1. Model and parser

**File**: migration `royalties`, `src/lib/distrokid.ts`

**Intent**: Parse the DistroKid CSV export (columns include Reporting Date, Sale Month, Store, Artist, Title, ISRC, Quantity, Country of Sale, Earnings (USD)) and map `Artist` to a project via `distrokid_artist`.

**Contract**: `royalties(id, project_id, sale_month date, store, title, isrc, country, quantity int, earnings_usd numeric, import_hash text unique, imported_at)`; `import_hash` = row hash, so re-importing the same file adds nothing. Unknown artist → row skipped and reported in the import summary.

#### 2. UI

**File**: `src/components/RoyaltiesPanel.tsx`, `src/components/Tracker.tsx`

**Intent**: A "Muzyka" tab: file picker, summary (imported N, skipped M), table per project and month: streams, revenue in USD and PLN (rate from `settings`), top tracks.

#### 3. Integration test

**File**: `tests/integration/distrokid.test.ts`, `tests/fixtures/distrokid.csv`

**Intent**: A file in the real format (commas and quotes in titles) → correct rows and monthly totals; re-import = 0 new rows.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly
- CSV parser integration test passes: `npm run test:int`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- Rafał imports a real DistroKid export from the phone and totals match DistroKid Bank
- Re-importing the same file does not change totals

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 6.

---

## Phase 6: Rename to Side Hustle Assistant

### Overview

New name in the app, the PWA and the infrastructure; the old URL redirects.

### Changes Required:

#### 1. Name in the app

**File**: `src/app/manifest.ts`, `src/app/layout.tsx`, `src/components/Tracker.tsx` (header), `package.json` (`name`), `README.md`

**Intent**: "Side Hustle Assistant" (short name "Side Hustle"), new description; the header drops "Faza F1 · walidacja…" in favour of the active projects.

#### 2. Worker and redirect

**File**: `wrangler.jsonc` (`name: "side-hustle-assistant"`), `redirect-worker/` (new mini worker named `ai-label-tracker`)

**Intent**: Rafał renames the worker in the Cloudflare dashboard (secrets and cron move with it) and points Workers Builds at the new name; `name` in the repo matches. A mini worker under the old name answers 301 to `side-hustle-assistant.sidereus.workers.dev`, keeping the path. The Google OAuth redirect URI is updated to the new URL.

**Contract**: order: (1) rename in the CF dashboard, (2) merge the PR with the new `name`, (3) deploy the `ai-label-tracker` mini worker, (4) new redirect URI in Google, (5) reinstall the PWA on the phone.

#### 3. Smoke E2E

**File**: `tests/e2e/smoke.spec.ts`, `playwright.config.ts`; dev dependency `@playwright/test` (use the preinstalled browser, no `playwright install`)

**Intent**: The only E2E test: password login → Dziś renders at 390 px (header "Side Hustle Assistant", alerts and gates sections). Credentials from env `E2E_EMAIL`/`E2E_PASSWORD`, run manually against `npm run preview`.

### Success Criteria:

#### Automated Verification:

- Smoke E2E passes: `npx playwright test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- `side-hustle-assistant.sidereus.workers.dev` works and the old URL redirects keeping the path
- After reinstalling, the PWA shows the new name and icon; push and YouTube sync still work

**Implementation Note**: After automated verification passes, ask Rafał to confirm; then `/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

Rafał's decision (2026-10-26): no unit tests, only the key contact points.

### Unit Tests:

- None (deliberate).

### Integration Tests:

- YouTube data mapping (Analytics JSON + reach CSV → `video_daily` and weeks) — phase 3.
- DistroKid CSV parser and dedupe — phase 5.
- Smoke E2E: login → Dziś — phase 6.

### Manual Testing Steps:

1. After every phase: open the app on the phone (390 px) and go through all tabs.
2. Phase 3: compare an `[API]` week with YouTube Studio.
3. Phase 4: check the morning notification on 2 days.
4. Phase 5: compare totals with DistroKid Bank.

## Performance Considerations

- Data is small (a few channels, hundreds of rows a day), so `loadAll` can keep loading everything; limit `video_daily` to the last 120 days in the client query.
- YouTube API quota (10,000 units/day) is irrelevant at one call per channel per day.

## Migration Notes

- `channels` → `projects` keeping uuids; column renames in one migration together with the phase 1 code deploy (a short gap between migration and deploy is acceptable for a private app; apply the migration right before merging the PR).
- Existing manual `weekly_stats` rows (currently 0) stay; the sync overwrites only weeks it has data for.
- Backup before migrating: dump all tables as JSON to `/mnt/project-files/backup/`.

## References

- Strategy: Doc "Strategia wydawnictwa i kanałów" https://claude.ai/artifact/VvLH85mwG4Tv8kaLvL89bC
- YouTube Reporting API, channel reports (reach): https://developers.google.com/youtube/reporting/v1/reports/channel_reports
- YouTube Analytics API, metrics: https://developers.google.com/youtube/analytics/metrics
- Data layer: `src/lib/data.ts:12`
- Tabs: `src/components/Tracker.tsx:12`
- Week aggregation and trend: `src/lib/game.ts:37`
- Forms: `src/components/Sheet.tsx:9`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Projects and data model

#### Automated

- [ ] 1.1 Migration applies cleanly, projects = 3, gates = 2
- [ ] 1.2 Type checking passes
- [ ] 1.3 Linting passes
- [ ] 1.4 OpenNext build passes

#### Manual

- [ ] 1.5 Existing tabs, XP and badges work on the phone
- [ ] 1.6 Project picker in the task form and chip on the list

### Phase 2: Dziś screen and alert rules

#### Automated

- [ ] 2.1 Type checking passes
- [ ] 2.2 Linting passes
- [ ] 2.3 OpenNext build passes

#### Manual

- [ ] 2.4 Dziś is default and shows overdue tasks and renewals
- [ ] 2.5 Gate cards: no data, then a value after a manual week

### Phase 3: YouTube sync

#### Automated

- [ ] 3.1 Integrations migration, token unreadable for authenticated
- [ ] 3.2 YouTube mapping integration test passes
- [ ] 3.3 Type checking passes
- [ ] 3.4 Linting passes
- [ ] 3.5 OpenNext build passes

#### Manual

- [ ] 3.6 OAuth client in Google Cloud, secrets in CF, Slowfall connected
- [ ] 3.7 [API] weeks match Studio (±5%)
- [ ] 3.8 Per-video CTR and the CTR < 3% alert match Studio

### Phase 4: PWA push notifications

#### Automated

- [ ] 4.1 Type checking passes
- [ ] 4.2 Linting passes
- [ ] 4.3 OpenNext build passes

#### Manual

- [ ] 4.4 Test notification reaches the phone
- [ ] 4.5 Morning notification only on days with alerts

### Phase 5: DistroKid CSV import

#### Automated

- [ ] 5.1 Royalties migration applies cleanly
- [ ] 5.2 CSV parser integration test passes
- [ ] 5.3 Type checking passes
- [ ] 5.4 Linting passes
- [ ] 5.5 OpenNext build passes

#### Manual

- [ ] 5.6 Real CSV imported, totals match DistroKid Bank
- [ ] 5.7 Re-import does not change totals

### Phase 6: Rename to Side Hustle Assistant

#### Automated

- [ ] 6.1 Smoke E2E passes
- [ ] 6.2 Type checking passes
- [ ] 6.3 Linting passes
- [ ] 6.4 OpenNext build passes

#### Manual

- [ ] 6.5 New URL works, old URL redirects keeping the path
- [ ] 6.6 Reinstalled PWA: new name, push and sync work
