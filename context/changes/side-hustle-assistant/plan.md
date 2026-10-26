# Side Hustle Assistant Implementation Plan

## Overview

Turn the `ai-label-tracker` app from a manual task tracker into a personal assistant and dashboard for the Wydawnictwo project: a "Dziś" (Today) screen with rule-based alerts (no LLM), automatic YouTube data sync, a rename to **Side Hustle Assistant** (new worker and URL), push notifications and a DistroKid CSV import. The strategy (option B, gates on 2026-12-05 and 2027-01-16) must be visible in the app, not only in a document.

Revised 2026-10-26 after `reviews/plan-review.md` (F1–F10 applied; see "Review decisions" at the end).

## Current State Analysis

- One client screen, `src/components/Tracker.tsx` (384 lines), with 5 tabs: Zadania, Pipeline, Tygodnie, Koszty, Subskrypcje; above them the gamification panel (XP, levels, badges — `src/lib/game.ts`) and the KPI strip (`Strip`).
- Data: Supabase `gigsqrnwyeioqlkngfqe`, read directly from the browser with supabase-js (`src/lib/data.ts:12` `loadAll`), RLS through `public.is_owner()`. No backend: the app renders client-side and the session lives in localStorage, not cookies. The project uses the new publishable/secret API keys.
- Live schema: `channels(id, slug NOT NULL UNIQUE, name, niche, yt_channel_id UNIQUE, created_at, updated_at)` with a `touch` trigger and the `owner_all` policy; FKs `content_items.channel_id → channels ON DELETE SET NULL` and `weekly_stats.channel_id → channels ON DELETE CASCADE`; PK `weekly_stats(channel_id, week_start)`; view `v_xp_events` reads `weekly_stats.channel_id`.
- Data: one channel row, "Sceny sezonowe" (Slowfall not under its real name, no CMV, no electronic artist). `content_items`: film #3 (`i03`) is already `live`; there is no film #2 row (`i02` is a `pomysł`); `yt_video_id` is empty. `weekly_stats` has 0 rows. Tasks are addressed by `legacy_id` (t01…t26); t23/t24 are the gates as tasks.
- No tests, no CI; deploy is Cloudflare Workers Builds from `main` (`npm run build` = OpenNext build). Worker `ai-label-tracker`, URL `ai-label-tracker.sidereus.workers.dev`. `cloudflare-env.d.ts` does not exist yet.
- No notion of a gate/goal; tasks/costs are not linked to a channel.

## Desired End State

- The app is called **Side Hustle Assistant** and runs at `side-hustle-assistant.sidereus.workers.dev`; the old URL redirects (301, path and query kept).
- The app always opens on **Dziś**: alerts (overdue tasks and tasks due within 3 days, subscription renewals within 7 days, film CTR < 3%, week-over-week drop in thumbnail impressions, failed or stale sync) plus gate cards for 2026-12-05 and 2027-01-16 with current value vs. threshold. Gamification stays unchanged.
- Projects (Slowfall Scenes, Contents May Vary, Elektronika) are the shared dimension for tasks, costs, content and stats.
- A daily cron pulls YouTube data for every connected channel (views, watch hours, subscribers, AVD, thumbnail impressions, CTR) and stores it per video and per week (`source = yt_api`) without wiping manual fields.
- One push notification per day when there is at least one high/med alert.
- A DistroKid CSV import adds revenue/streams per artist and month.
- Verification: typecheck + lint green, 2 integration tests (YouTube mapping, CSV parser) and 1 smoke E2E green, Rafał confirms on the phone.

### Key Discoveries:

- `src/lib/data.ts:12-32` — the data layer is one `loadAll` plus `saveRow`/`archiveRow`, bound to the browser client; the server needs the same reads with a service-role client.
- `src/components/Tracker.tsx:12-18,75-76` — tabs are the `TABS` array, and the chosen tab is saved to localStorage on every switch and restored on start.
- `src/lib/game.ts:29-47` — `weeksAgg`/`trend` compute the week-over-week watch-hours trend.
- YouTube Analytics API: `video` is usable as a dimension only together with `filters=video==id1,…` (≤ 500 ids). Thumbnail impressions and CTR exist only in the YouTube Reporting API, report `channel_reach_basic_a1` (`date, channel_id, video_id` × `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr`).
- Reporting API: a new job produces reports for the 30 days before creation, one per Pacific-time day, available within ~48 h; corrected data arrives as a new report id for the same day and the newer `createTime` wins; `reports.list` supports `createdAfter`.
- Workers Free limits per cron invocation: 50 subrequests, 10 ms CPU (Paid: 10,000 / 30 s). The account plan is unconfirmed, so the sync is designed to fit Free.
- In a `scheduled` handler there is no request context, so `getCloudflareContext()` and per-request env are unavailable to app code; routing the cron through `openNext.fetch` keeps all logic in route handlers.
- Channels are Brand Accounts under `smartlife.dev.ai@gmail.com`; the OAuth token is per channel, so the integration is per project.
- `v_xp_events` gives +5 XP per `weekly_stats` row, so synced weeks earn XP (accepted; one-time jump on first sync).

## What We're NOT Doing

- No LLM (brief, chat) — rules only (decision 2026-10-26).
- No changes to gamification: XP, levels and badges stay as they are.
- No DistroKid API (none exists) and no scraping — manual CSV import only.
- No Spotify/Apple/TikTok data beyond what the DistroKid CSV contains.
- No unit tests; no CI (tests run manually or by the agent).
- No Cloudflare Queues/Workflows; the sync fits one cron invocation with a per-run cap.
- No GitHub repo rename (optional later; GitHub keeps a redirect).
- No multi-user — still one owner (`app_owners`).
- No writes to YouTube (read-only scopes).

## Implementation Approach

Order: data model first, then the Dziś screen on manual data, then the YouTube integration feeding the same tables. **Release 1 (target: before 2026-10-31) = phases 1–3**; if phase 3 does not fit, release 1 = phases 1–2 and Rafał enters the Studio numbers for the thumbnail-template choice manually. Phases 4–6 are release 2; the rename (phase 4) comes before push (phase 5) so push subscriptions and the service worker are created on the final origin. Each phase is its own PR to `main`, opened only after the previous one has merged; merges are Rafał's.

Backend = Next route handlers (`src/app/api/**/route.ts`); the worker's `scheduled` handler only calls `/api/cron` through `openNext.fetch` with a secret header. Server code uses a service-role (Supabase secret key) client passed into the same data functions the browser uses. Secrets live only as Worker secrets; OAuth tokens live in a table revoked from `anon`/`authenticated`.

## Critical Implementation Details

- **The Google OAuth app must be "In production".** In "Testing" refresh tokens expire after 7 days. For personal use the app can stay unverified (warning screen at consent). Scopes: `yt-analytics.readonly` + `youtube.readonly`, `access_type=offline`, `prompt=consent`. Add both redirect URIs (old and new host) up front, so the rename does not break connecting.
- **Create the Reporting job early.** CTR data appears ~1–2 days after the job exists, so Slowfall must be connected by ~2026-10-29 for the 10-31 thumbnail choice; the UI shows "waiting for the first report", not zero.
- **Rename `channels` in place.** `alter table … rename` keeps the PK, both FKs, the unique constraints, the `touch` trigger, the `owner_all` policy and `v_xp_events` (bound by attnum); never drop `channels`.
- **Upserts name their columns.** Analytics and Reach rows write disjoint columns of `video_daily`; the weekly recompute writes only metric columns and never touches `uploads`, `revenue_pln`, `note` or archived weeks.

## Phase 1: Projects and data model

### Overview

Introduce projects as the shared dimension, gates and per-video data; clean up existing data.

### Changes Required:

#### 1. Schema migration

**File**: `supabase/migrations/<ts>_projects.sql` (new folder; apply with Supabase MCP `apply_migration`)

**Intent**: Turn `channels` into typed `projects` in place and add the tables the assistant needs.

**Contract**:
- `alter table channels rename to projects`; add `kind text not null default 'yt_channel' check in ('yt_channel','artist','both')`, `status text not null default 'aktywny' check in ('aktywny','utrzymanie','planowany','zamknięty')`, `distrokid_artist text null`, `note text null`, `archived_at timestamptz null`. Keep `slug`, `niche`, `yt_channel_id`, `updated_at`. Optionally rename constraints/indexes to `projects_*`.
- `alter table content_items rename column channel_id to project_id`; same for `weekly_stats` (PK becomes `(project_id, week_start)` automatically); `weekly_stats` gains `impressions int null`. Recreate `v_xp_events` only if its column alias changes; it keeps working as is.
- `tasks.project_id uuid null references projects on delete set null`, `subscriptions.project_id` likewise (null = shared).
- `gates`: `id`, `project_id`, `title`, `due date`, `rules jsonb not null` (array; the gate passes when **all** rules pass), `note`, `archived_at`. Rule shapes: `{"rule":"ctr_last3_weighted","min_pct":3}`, `{"rule":"impressions_wow_rising"}`, `{"rule":"watch_hours_month_vs","month":"2027-01","vs":"2026-11"}`.
- `video_daily`: PK `(yt_video_id, date)`, `project_id`, Analytics columns `views int, watch_minutes numeric, subs_net int, avd_sec numeric`, Reach columns `impressions int, ctr_pct numeric`, `updated_at`.
- View `v_video_recent`: per `(project_id, yt_video_id)` sums over the last 35 days plus per-week totals (keeps the client read far below the 1000-row limit).
- RLS + `owner_all` (`is_owner()`) on the new tables and the view (`security_invoker`).

#### 2. Existing data

**File**: the same migration (data section)

**Intent**: Match reality before the first sync.

**Contract**: rename the row to `Slowfall Scenes` (`kind yt_channel`, `yt_channel_id UCrAjgi48bJBW351SaIqi6Yw`); insert `Contents May Vary` (`slug contents-may-vary`, `kind both`, `distrokid_artist 'Contents May Vary'`, `status utrzymanie`) and `Elektronika` (`slug elektronika`, `kind artist`, `status planowany`); set `yt_video_id` on `i03` (`Y1zTI-zy9HA`) and on film #1 (`yL4czbAFQ54`); film #2 has no row — leave it (the sync fills `video_daily` from the uploads playlist anyway). Gates: "Bramka 1" (Slowfall, 2026-12-05, rules `ctr_last3_weighted` 3% + `impressions_wow_rising`) and "Bramka F1" (Slowfall, 2027-01-16, `watch_hours_month_vs` 2027-01 vs 2026-11). Tasks by `legacy_id`: t07/t25/t26 → Elektronika; Slowfall tasks → Slowfall; t23/t24 stay (their task alerts are suppressed while a gate with the same due date exists).

#### 3. Code on projects

**File**: `src/lib/types.ts`, `src/lib/data.ts`, `src/components/Sheet.tsx`, `src/components/Tracker.tsx`

**Intent**: `Channel` → `Project`, the `channel` form field → `project`, new data in `loadAll`; optional project picker in the task and subscription forms; project chip on rows.

**Contract**: `loadAll(db = supabase())` (server passes a service-role client); `Data.projects`, `Data.gates`, `Data.videos` (from `v_video_recent`); `saveRow("weeks")` keys on `project_id`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly, and `select count(*)` returns 3 for `projects` and 2 for `gates`
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

A new "Dziś" tab that the app always opens on, with alerts and gate cards computed in code.

### Changes Required:

#### 1. Rules

**File**: `src/lib/rules.ts` (new)

**Intent**: Pure functions computing alerts and gate status from `Data`, shared by the UI and the cron.

**Contract**: `alerts(d: Data, today: string): Alert[]` with `Alert = { kind: 'task_late'|'task_soon'|'renewal'|'ctr_low'|'impressions_drop'|'gate'|'sync_failed', severity: 'high'|'med'|'low', title, detail, ref, projectId? }`; `gateStatus(g: Gate, d: Data, today: string): { value: number|null, target: number|null, ok: boolean|null, daysLeft: number, label: string }`.
- Definitions: a **complete week** is Mon–Sun whose Sunday is ≥ 3 days before `today` (covers the ~2-day report lag); week-over-week comparisons use the last two complete weeks only.
- `ctr_last3_weighted`: impression-weighted CTR (Σ clicks / Σ impressions, clicks = impressions × ctr) of the 3 most recent live films with ≥ 100 thumbnail impressions, over the last 28 days.
- `watch_hours_month_vs`: compare the same day range of both months (1st up to the last complete day of the target month).
- Thresholds: overdue task = high, due ≤ 3 days = med (skip tasks whose due date matches a gate's); active subscription renewing ≤ 7 days = med; film CTR < 3% with ≥ 100 impressions in the last complete week = med; thumbnail impressions down > 20% between the last two complete weeks = med; gate ≤ 14 days to due and `ok=false` = high; `sync_failed` = high when an integration has `last_error` or `last_sync_at` older than 36 h (`invalid_grant` → "reconnect required"). Missing data → gate `ok=null` ("no data"), never false.

#### 2. View

**File**: `src/components/Today.tsx` (new), `src/components/Tracker.tsx`

**Intent**: "Dziś" is the first tab and the start screen on every launch; alerts sorted by severity, gate cards with value, threshold and days left; tapping an alert opens the linked record.

**Contract**: `TABS` gets `{ id: "dzis", name: "Dziś" }` at position 0; the start tab is always `dzis` (or `?tab=` from the URL); the remembered tab moves to `sessionStorage` (survives reloads within a session, not relaunches). Mobile-first, 390 px.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- On the phone Dziś opens on every launch and shows overdue tasks (e.g. t04) and upcoming renewals
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

**Contract**: `integrations`: PK `(project_id, provider)`, `provider 'youtube'`, `yt_channel_id`, `refresh_token text`, `reporting_job_id text null`, `reports_cursor timestamptz null` (max imported report `createTime`), `last_sync_at`, `last_error text null`. RLS on with no policies, plus `revoke all on integrations from anon, authenticated`. `integration_status()` is `security definer`, `set search_path = public`, checks `is_owner()`, returns everything except the token, and is granted only to `authenticated`. `Data.integrations` comes from it.

#### 2. OAuth

**File**: `src/app/api/yt/connect/route.ts`, `src/app/api/yt/callback/route.ts`, `src/lib/server/auth.ts`, `src/lib/server/google.ts`, `src/lib/server/db.ts` (new)

**Intent**: A "Connect YouTube" button on a project → Google consent on the chosen Brand Account → store the token, check the channel, create the Reporting job.

**Contract**: `POST /api/yt/connect` with `Authorization: Bearer <supabase access token>` (verified with `auth.getUser` + `is_owner`) and `{ projectId }` → `{ url }` with an HMAC-signed `state` (projectId + expiry). `GET /api/yt/callback?code&state` → exchange the code, read `channels.list?mine=true`; if the project already has a `yt_channel_id` and it differs, reject with `/?yt=wrong-channel`; otherwise store via the service-role client, create the `channel_reach_basic_a1` job, redirect to `/?tab=dzis&yt=ok`. Worker secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SECRET_KEY` (`sb_secret_…`), `STATE_SECRET`, `CRON_SECRET`.

#### 3. Cron and mapping

**File**: `worker.ts` (new entry), `wrangler.jsonc`, `src/app/api/cron/route.ts`, `src/app/api/yt/sync/route.ts`, `src/lib/server/ytSync.ts`, `src/lib/ytMap.ts` (new)

**Intent**: Once a day per integration: refresh the access token; list uploads (`channels.list(part=contentDetails)` → uploads playlist → `playlistItems.list`); query Analytics `reports.query` with `dimensions=day,video`, `filters=video==<ids>` (chunks of ≤ 500), metrics `views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost`, last 28 days; then `reports.list?createdAfter=<reports_cursor>` sorted by `createTime`, download at most 10 reports per run, upsert each, advance the cursor after each one; finally recompute the touched weeks. Errors write `last_error` and do not stop other integrations.

**Contract**:
- `wrangler.jsonc`: `main: "worker.ts"`, `triggers.crons: ["0 5 * * *"]`. `worker.ts` imports `.open-next/worker.js` (`// @ts-ignore` build output) and exports `{ fetch, scheduled }`, where `scheduled` calls `openNext.fetch(new Request("https://cron.internal/api/cron", { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } }), env, ctx)`. Run `npm run cf-typegen` for `cloudflare-env.d.ts`; exclude `worker.ts` from `tsconfig` if it trips the typecheck.
- `/api/cron` checks the header, runs the sync (and in phase 5 the push). `/api/yt/sync` is the owner-authenticated manual trigger.
- Upserts: Analytics writes only `views, watch_minutes, subs_net, avd_sec`; Reach writes only `impressions, ctr_pct`; `weekly_stats` recompute writes only `views, watch_hours, subs_net, avd_min, impressions, ctr_pct, source` and skips rows with `archived_at`.
- `ytMap.ts`: `mapAnalytics(json) → VideoDay[]`, `mapReach(csv) → VideoDay[]`, `toWeeks(rows) → Week[]` — pure functions under the integration test.

#### 4. Integration UI

**File**: `src/components/Today.tsx` or a project panel

**Intent**: Status per project: "not connected / connected, last sync <date> / error <text> / reconnect required / waiting for the first CTR report" plus "Connect" and "Sync now".

#### 5. Integration test

**File**: `tests/integration/ytMap.test.ts`, `tests/fixtures/yt-analytics.json` (captured from a real call), `tests/fixtures/reach.csv`; dev dependency `vitest`; script `npm run test:int`

**Intent**: The phase's only test: a real Analytics response + reach CSV → correct `video_daily` rows (disjoint columns) and weekly totals (weeks start Monday, CTR as %, minutes → hours).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly and `set local role authenticated; select refresh_token from integrations` fails with a permission error
- YouTube mapping integration test passes: `npm run test:int`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- Rafał creates the OAuth client in Google Cloud ("In production", both redirect URIs), adds the secrets in Cloudflare and connects Slowfall from the phone by ~10-29
- After "Sync now" the Tygodnie tab shows `[API]` rows whose views and hours match Studio (±5%)
- After 1–2 days per-video CTR appears, and the "CTR < 3%" alert matches Studio

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 4. End of release 1.

---

## Phase 4: Rename to Side Hustle Assistant

### Overview

New name in the app, the PWA and the infrastructure; the old URL redirects. Done before push so push subscriptions live on the final origin.

### Changes Required:

#### 1. Name in the app

**File**: `src/app/manifest.ts`, `src/app/layout.tsx`, `src/components/Tracker.tsx` (header), `package.json` (`name`), `README.md`

**Intent**: "Side Hustle Assistant" (short name "Side Hustle"), new description; the header drops "Faza F1 · walidacja…" in favour of the active projects.

#### 2. Worker and redirect

**File**: `wrangler.jsonc` (`name: "side-hustle-assistant"`), `redirect-worker/index.ts` + `redirect-worker/wrangler.jsonc` (new mini worker named `ai-label-tracker`)

**Intent**: Move to the new host without losing access, sessions or OAuth.

**Contract**: order: (0) add `https://side-hustle-assistant.sidereus.workers.dev/**` to Supabase Auth Redirect URLs, set it as Site URL, and confirm the new Google redirect URI exists; (1) Rafał renames the worker in the Cloudflare dashboard (secrets and cron move with it) and points Workers Builds at the new name; (2) merge the PR with the new `name`; (3) deploy the mini worker: `npx wrangler deploy -c redirect-worker/wrangler.jsonc` — it answers 301 to the new host with path **and query** kept; (4) reinstall the PWA and log in again (session and storage are per origin).

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

- The new URL works, and the old URL redirects keeping path and query (e.g. `/?tab=dzis&yt=ok`)
- After reinstalling, the PWA shows the new name; login, magic link and YouTube sync work

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 5.

---

## Phase 5: PWA push notifications

### Overview

One daily notification when `alerts()` returns something with severity high or med.

### Changes Required:

#### 1. Push subscription

**File**: `public/sw.js`, `src/components/PushToggle.tsx`, `src/app/api/push/subscribe/route.ts`, `src/app/api/push/test/route.ts`, migration `push_subscriptions`

**Intent**: A "Notifications" toggle registers the service worker, asks for permission and stores the subscription in an owner-RLS table.

**Contract**: `push_subscriptions(endpoint PK, p256dh, auth, created_at, last_ok_at, failed_count, archived_at)`; secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a project URL, no personal email).

#### 2. Sending from the cron

**File**: `src/lib/server/push.ts`, `src/app/api/cron/route.ts`

**Intent**: After the sync, `/api/cron` loads data with the service-role client, computes `alerts()` and sends one notification with the count and the top alert; tapping it opens `/?tab=dzis`. Subscriptions answering 404/410 are archived.

**Contract**: a Web Push library that runs on WebCrypto in workerd (e.g. `@block65/webcrypto-web-push`; npm `web-push` depends on node `https`/`crypto` — verify during implementation). iOS: push only for a PWA added to the home screen (iOS ≥ 16.4).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- OpenNext build passes: `npm run build`

#### Manual Verification:

- Rafał enables notifications on the phone and receives a test notification (`POST /api/push/test`)
- The next morning one notification with alerts arrives, and nothing arrives on a day without alerts

**Implementation Note**: After automated verification passes, pause for Rafał's confirmation before phase 6.

---

## Phase 6: DistroKid CSV import

### Overview

Manual import of the monthly DistroKid Bank export, mapped to artist projects.

### Changes Required:

#### 1. Model and parser

**File**: migration `royalties`, `src/lib/distrokid.ts`

**Intent**: Parse the DistroKid CSV export (columns include Reporting Date, Sale Month, Store, Artist, Title, ISRC, Quantity, Country of Sale, Earnings (USD)) and map `Artist` to a project via `distrokid_artist`.

**Contract**: `royalties(id, project_id, sale_month date, store, title, isrc, country, quantity int, earnings_usd numeric, import_hash text unique, imported_at)`; `import_hash` = row hash, so re-importing adds nothing. Unknown artist → row skipped and reported in the summary.

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

**Implementation Note**: After automated verification passes, ask Rafał to confirm; then `/10x-impl-review` and `/10x-archive`.

---

## Testing Strategy

Rafał's decision (2026-10-26): no unit tests, only the key contact points.

### Unit Tests:

- None (deliberate).

### Integration Tests:

- YouTube data mapping (Analytics JSON + reach CSV → `video_daily` and weeks) — phase 3.
- DistroKid CSV parser and dedupe — phase 6.
- Smoke E2E: login → Dziś — phase 4.

### Manual Testing Steps:

1. After every phase: open the app on the phone (390 px) and go through all tabs.
2. Phase 3: compare an `[API]` week with YouTube Studio.
3. Phase 4: open an old link with a query string and check the redirect.
4. Phase 5: check the morning notification on 2 days.
5. Phase 6: compare totals with DistroKid Bank.

## Performance Considerations

- The sync must fit Workers Free per cron run (50 subrequests, 10 ms CPU): ≤ 10 report downloads per integration per run; the 30-day backfill completes over ~3 runs (or "Sync now" presses).
- The client reads `v_video_recent` (aggregated), never raw `video_daily`, so responses stay under the 1000-row default.
- YouTube API quota (10,000 units/day) is irrelevant at this volume.

## Migration Notes

- `channels` is renamed in place (no copy, no drop); apply the phase 1 migration right before merging its PR (a short gap is acceptable for a private app).
- Backup before migrating: dump all tables as JSON to `/mnt/project-files/backup/` (or the local equivalent).
- Existing manual `weekly_stats` fields (`uploads`, `revenue_pln`, `note`) are never overwritten by the sync.

## References

- Plan review: `context/changes/side-hustle-assistant/reviews/plan-review.md`
- Strategy: Doc "Strategia wydawnictwa i kanałów" https://claude.ai/artifact/VvLH85mwG4Tv8kaLvL89bC
- YouTube Reporting API, channel reports (reach): https://developers.google.com/youtube/reporting/v1/reports/channel_reports
- YouTube Analytics API, metrics: https://developers.google.com/youtube/analytics/metrics
- Data layer: `src/lib/data.ts:12`
- Tabs and saved tab: `src/components/Tracker.tsx:12`, `src/components/Tracker.tsx:75`
- Week aggregation and trend: `src/lib/game.ts:29`
- Forms: `src/components/Sheet.tsx:9`

## Review decisions

Delegated to the agent per Rafał's working rules (non-UI decisions are the agent's call, recorded here):

| Finding | Decision |
| --- | --- |
| F1 migration | Rename `channels` in place; explicit slugs |
| F2 Analytics query | Fix A: uploads playlist → `filters=video==` |
| F3 report ingestion | Fix A: `reports_cursor`, ≤ 10 reports/run, designed for Workers Free |
| F4 cron runtime | `scheduled` → `/api/cron` via `openNext.fetch`; `loadAll(db)` |
| F5 silent data loss | Disjoint upsert columns, skip archived weeks, `v_video_recent` |
| F6 rule edges | `rules jsonb`; complete weeks; impression-weighted CTR; same day range |
| F7 invisible failure | `sync_failed` alert + `Data.integrations` |
| F8 default tab | Always start on Dziś; saved tab → `sessionStorage` |
| F9 rename | Fix A: rename becomes phase 4 (before push); step 0 URL allow-lists; query kept |
| F10 small fixes | All applied; synced weeks keep earning XP; t23/t24 kept, alerts suppressed |

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

- [ ] 2.4 Dziś opens on every launch and shows overdue tasks and renewals
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

### Phase 4: Rename to Side Hustle Assistant

#### Automated

- [ ] 4.1 Smoke E2E passes
- [ ] 4.2 Type checking passes
- [ ] 4.3 Linting passes
- [ ] 4.4 OpenNext build passes

#### Manual

- [ ] 4.5 New URL works, old URL redirects keeping path and query
- [ ] 4.6 Reinstalled PWA: new name, login and sync work

### Phase 5: PWA push notifications

#### Automated

- [ ] 5.1 Type checking passes
- [ ] 5.2 Linting passes
- [ ] 5.3 OpenNext build passes

#### Manual

- [ ] 5.4 Test notification reaches the phone
- [ ] 5.5 Morning notification only on days with alerts

### Phase 6: DistroKid CSV import

#### Automated

- [ ] 6.1 Royalties migration applies cleanly
- [ ] 6.2 CSV parser integration test passes
- [ ] 6.3 Type checking passes
- [ ] 6.4 Linting passes
- [ ] 6.5 OpenNext build passes

#### Manual

- [ ] 6.6 Real CSV imported, totals match DistroKid Bank
- [ ] 6.7 Re-import does not change totals
