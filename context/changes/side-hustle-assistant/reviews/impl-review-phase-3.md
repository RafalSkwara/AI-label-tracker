<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Side Hustle Assistant Implementation Plan

- **Plan**: context/changes/side-hustle-assistant/plan.md
- **Scope**: Phase 3 of 6 (YouTube sync), draft PR #7, `git diff origin/main...HEAD` at 4aaaf19
- **Reviewed phases**: 3
- **Date**: 2026-10-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

## Summary

The security-critical parts are sound. The tokens table is unreachable for `anon`/`authenticated`.
`integration_status()` returns no token. `state` is HMAC-signed, expires, is checked with a
constant-time compare and is verified before any DB or Google call. The callback can only redirect to
its own origin. `/api/cron` and `/api/yt/sync` are guarded. No secret, token or log statement is in
the repo or the client code. The migration is additive and matches the live schema, so it is safe to
apply before the merge.

The real problems are data correctness in the weekly recompute (F1) and one sync robustness issue (F2).
F1 must be fixed before the merge, because the first sync runs straight from the OAuth callback and the
oldest week it writes is never fetched again.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## What was checked

**Security**
- `POST /api/yt/connect` (`src/app/api/yt/connect/route.ts:6`): `requireOwner` uses `auth.getUser(token)` (server-verified, not just decoded) plus `rpc("is_owner")` under the caller's own JWT. Any error leads to 401.
- `state` (`src/lib/server/auth.ts:35-49`): base64url JSON `{p, e}` + HMAC-SHA256 (`STATE_SECRET`, WebCrypto). The signature is checked with `safeEqual` before parsing; the expiry is 10 min; the projectId is bound by the signature. It is not single-use and not bound to the browser (F7).
- `GET /api/yt/callback` (`src/app/api/yt/callback/route.ts`): order is state → project lookup → code exchange → `channels.list?mine` → `wrong-channel` check → job → upsert. Redirects only go to `${origin}/?tab=dzis&yt=<fixed value>`, so there is no open redirect. `redirect_uri` comes from the request origin, and Google validates it against the registered list.
- Tokens: `integrations` has RLS on and no policies, plus `revoke all … from anon, authenticated`. The live default ACL does grant `arwdDxtm` to anon/authenticated on new tables and `X` on new functions, so both revokes are needed and present. `integration_status()` is `security definer`, `search_path = public`, checks `is_owner()` and is revoked from `public, anon`. The refresh token is only read in `ytSync.syncAll` on the server. Not in `Data`, not in API responses, not logged (no `console.*` in `src/`).
- `/api/cron`: `x-cron-secret` is compared with `safeEqual`, and a missing secret throws (500, not open). `worker.ts` `scheduled` → `openNext.fetch(POST https://cron.internal/api/cron)` inside `ctx.waitUntil`. `wrangler.jsonc` `main: worker.ts`, `crons: ["0 5 * * *"]` (06:00/07:00 Warsaw).
- Repo scan for `sb_secret_`, `GOCSPX`, `ya29.`, refresh-token prefixes: only placeholder mentions in the plan docs. `.dev.vars*` and `.env*` are git-ignored.

**Migration vs live DB** (read-only catalog queries, project `gigsqrnwyeioqlkngfqe`):
- `integrations` and `integration_status` do not exist yet, so the migration is unapplied, as the Progress row says.
- `public.touch_updated_at()` and `public.is_owner()` (security definer) exist.
- Live `v_video_recent` has `security_invoker=true`, columns `project_id uuid, yt_video_id text, views int, watch_minutes numeric, subs_net int, impressions int, clicks numeric, weeks jsonb`, and grants for authenticated/service_role/postgres only. The new definition produces the same names and types in the same order, so `create or replace view` succeeds and keeps the grants. Only the window changes (35 → 42 days). The live `main` code (Phase 2 `videoWeekOk` at 35 days) just ignores the extra week. Safe before the merge.
- `video_daily` (PK `(yt_video_id, date)`) and `weekly_stats` (PK `(project_id, week_start)`, `source in ('manual','yt_api')`, ISO Monday check) have every column the upserts name. `weekly_stats` has 0 rows and `video_daily` has 0 rows today.
- Order constraint: the new `loadAll` calls `rpc("integration_status")` and `check()` throws on error, so **merging before the migration would break the whole app**. Apply first, as planned.

**Sync**: uploads playlist (≤150) → Analytics `day,video` + `filters=video==` in chunks of 7. Analytics upsert names only `views, watch_minutes, subs_net, avd_sec`. Reach upsert names only `impressions, ctr_pct` (supabase-js `on_conflict` merge updates only the payload columns, so the sets stay disjoint). `reports.list?createdAfter=cursor`, sorted ascending, ≤40, with the cursor advanced after each report. `invalid_grant` is normalised in `google.ts:18` and drives the reconnect status and alert. Every failure writes `last_error` and the next integration still runs.

**Live-schema / UI / strings**: the UI strings are Polish. The 390 px check is static: the card reuses `.gate` (grid, `.head` wraps), and `.actions` is `flex-wrap`. The logged-in Dziś view was not rendered (it needs the owner's session); `/privacy` is a plain server page with no auth gate.

## Automated checks

| Command | Result |
|---|---|
| `npm run test:int` | PASS, 3 tests (`tests/integration/ytMap.test.ts`) |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 errors, 1 pre-existing warning in `open-next.config.ts`) |
| `npm run build` | PASS (OpenNext build complete; no secret names in `.next/static`) |
| `wrangler deploy --dry-run` (bundles `worker.ts` + `.open-next/worker.js`) | PASS (bundle 5.47 MiB, exit 0) |
| 3.1 `set local role authenticated; select refresh_token from integrations` → permission error | NOT RUN: migration not applied (no writes allowed in this review). Run it right after applying. |

Manual 3.6–3.8 are open (`[ ]`), which is expected before deploy. Row 3.1 is ticked although the migration is "written, not applied"; its stated check has not happened yet.

## Findings

### F1 — Weekly recompute writes metrics it has no data for (partial oldest week, zero views, nulled manual CTR)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data correctness)
- **Location**: src/lib/server/ytSync.ts:31-50 (recomputeWeeks), src/lib/ytMap.ts:106-114 (toWeeks)
- **Detail**: `recomputeWeeks` starts at `mondayOf(minDate)`, where `minDate` = `now − 28 d` or the oldest Reach date (up to 30 days back). Three bad writes follow:
  (a) **Partial oldest week.** Unless the sync runs on a Monday, that first week has Analytics data only from `start` to Sunday. It is still written as a complete `yt_api` week with understated views and hours. Its missing days are older than 28 days and are never fetched later, so the row stays wrong. On the first sync, which runs from the callback, this is guaranteed. Example: a Thursday connect loses Mon–Wed of the oldest week.
  (b) **Reach-only week.** If the Reach backfill reaches a week with no Analytics rows, `toWeeks` returns `views: 0, watch_hours: 0, subs_net: 0`. These zeros are upserted.
  (c) **Nulled manual values.** Every batch row carries all metric keys, so a week with Analytics but no Reach yet (the first 1–2 days after connecting) upserts `impressions: null, ctr_pct: null`. That erases CTR or impressions entered manually from Studio, which is the fallback plan for the 10-31 thumbnail choice.
  The plan allows overwriting manual metric columns with API values, not with absent values. These rows feed the gate rules and the Tygodnie tab. Manual check 3.7 (±5% vs Studio) would fail on the oldest week.
- **Fix**: Write only weeks fully covered by Analytics: `week_start >= start` (the first Monday on or after the 28-day window start), as `analytics` is what `start` bounds. Split the upsert so null Reach metrics are not sent: one batch with `impressions, ctr_pct` for weeks that have Reach data, one without those keys for weeks that do not. Extend `ytMap.test.ts` with a partial-week case.
  - Strength: Keeps the "named columns, never overwrite what we don't have" contract (plan F5) at week level too; no schema change.
  - Tradeoff: The oldest ~1 week of the backfill is not written; with a 28-day window there are still 3 complete weeks, which is what the rules use.
  - Confidence: HIGH — follows directly from `start = now − 28 d` and `first = mondayOf(fromDate)`; `weekly_stats` is empty today so nothing to repair yet.
  - Blind spot: Whether Studio's week totals use Pacific days (Analytics `day` is Pacific); unrelated to this fix.
- **Decision**: Fixed: weeks only fully inside the Analytics window; no Reach-only weeks; absent Reach metrics never sent; partial-week test added.

### F2 — Reach rows are not de-duplicated per (video, date); one duplicate blocks the cursor forever

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/ytMap.ts:64-82, src/lib/server/ytSync.ts:79-83
- **Detail**: `mapReach` emits one row per CSV line, and the whole report goes into one upsert on `(yt_video_id, date)`. If a report ever has two lines for the same video and day, Postgres rejects the batch with "ON CONFLICT DO UPDATE command cannot affect row a second time". That could come from an extra dimension column (e.g. `live_or_on_demand`/`subscribed_status` if present in this report type) or from a channel and video split. The cursor is not advanced, so every later run fails on the same report: `sync_failed` every day and no more CTR. The fixtures are hand-written to the assumed format (plan "Phase 3 fixtures"), so the test cannot rule this out.
- **Fix**: In `mapReach`, sum impressions and impression-weighted clicks per `(video_id, date)` before returning (CTR = Σclicks/Σimpressions); add a fixture line that splits one video-day.
- **Decision**: Fixed: Reach lines summed per (video, date), impression-weighted CTR; fixture line splits a video-day.

### F3 — Cron and callback failures are invisible to logs

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (observability)
- **Location**: worker.ts:11, src/app/api/yt/callback/route.ts:30
- **Detail**: `scheduled` discards the `/api/cron` response, so a 401 (e.g. a `CRON_SECRET` mismatch) or 500 logs nothing. The callback `catch {}` turns every failure into `?yt=error` with no cause recorded anywhere: the token exchange, the `channels.list` "no channel" case, the upsert error. At that point there is no `integrations` row to hold `last_error`. The 36-hour staleness alert eventually covers the cron, but nothing covers the callback.
- **Fix**: In `scheduled`, `console.error` the status when the response is not ok. In the callback, `console.error` the error message (never the code or tokens), and map known causes to distinct `yt=` values (`no-channel`, `no-refresh-token`).
- **Decision**: Fixed: cron status and callback error messages logged (no codes/tokens); yt=no-channel and no-refresh-token with Polish toasts.

### F4 — No timeouts on Google calls; one hung request stalls the whole run

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/server/google.ts:35-39, 53, 116-119
- **Detail**: None of the `fetch` calls has a timeout, and integrations sync one after another. A stalled Google request keeps the cron invocation alive until the platform kills it. Then no `last_error` is written for that integration or any later one. The same applies to the callback, where the owner waits on a blank page on the phone.
- **Fix**: Pass `signal: AbortSignal.timeout(20_000)` (reports: 60 s) to the fetches in `google.ts`.
- **Decision**: Fixed: 20 s timeout on Google calls, 60 s on report downloads.

### F5 — Integration test fixtures are hand-written, not captured

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/fixtures/yt-analytics.json, tests/fixtures/reach.csv
- **Detail**: The plan asked for a fixture "captured from a real call". The coder documented why that was impossible and listed the unverified assumptions: CTR as a fraction ×100, and no Analytics paging. The test is meaningful for what it covers: disjoint columns, Monday weeks, minutes → hours, weighted AVD/CTR, null when there is no Reach data. But it pins the assumed API shape, not the real one. If CTR is already a percent, every stored CTR is 100× too high and the `ctr_low` alert never fires.
- **Fix**: After the first real sync, replace both fixtures with captured, trimmed payloads, and keep 3.8 open until CTR matches Studio.
- **Decision**: Deferred: replace fixtures after the first real sync; 3.8 stays open.

### F6 — Callback runs a full sync before redirecting

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/app/api/yt/callback/route.ts:28
- **Detail**: `await syncAll(db, projectId)` happens inside the redirect response: token refresh, `channels.list`, up to 3 playlist pages and up to 22 Analytics queries. That is several seconds of blank page on the phone. The result is also "Połączono" even if the sync failed (only the card shows the error). It works, and it was planned ("pulls once right away").
- **Fix**: Wrap it in `getCloudflareContext().ctx.waitUntil(...)` and redirect immediately; the Dziś reload shows the result.
- **Decision**: Fixed: first sync via ctx.waitUntil, immediate redirect.

### F7 — OAuth `state` is replayable and not bound to the browser

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (security)
- **Location**: src/lib/server/auth.ts:35-49
- **Detail**: Within its 10 minutes, a valid `state` works with any authorization code, and there is no nonce cookie or PKCE. Someone who sees the owner's consent URL could finish the flow with their own Google account. For a project with no `yt_channel_id` (Contents May Vary today), that attaches their channel. Risk is low: the state appears only in the owner's own browser, and getting one requires the owner's Supabase session.
- **Fix**: Set an `HttpOnly; Secure; SameSite=Lax` cookie with a random nonce in `/api/yt/connect`, put the nonce in the signed state, and compare it in the callback. Optionally add PKCE.
- **Decision**: Fixed: nonce cookie (HttpOnly; Secure; SameSite=Lax) plus nonce in the signed state, compared in the callback.

### F8 — Small UI items: tap target, raw English errors, cron host for phase 4

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Integrations.tsx:13, 66; worker.ts:10
- **Detail**: (a) "Połącz ponownie" renders as `.linkbtn` (0.8 rem, padding 0), a tap target well under 44 px on the phone. (b) `Błąd synchronizacji: ` + `last_error` shows raw English Google/Supabase text up to 300 characters inside a Polish UI and the `sync_failed` alert. (c) Phase 4 note: the cron request uses host `cron.internal`; any old-host → new-host redirect added in phase 4 must not catch it, or the cron silently gets a 301.
- **Fix**: Give the reconnect action `.btn` styling. Map the common errors (`invalid_grant`, quota, network, `different channel`) to Polish text and show the raw text only in detail. Add the `cron.internal` exemption to the phase 4 plan.
- **Decision**: Fixed: reconnect uses .btn (44 px); Polish error mapping with raw text as detail; cron.internal note added to Phase 4 in plan.md.

## Gating

- **Before the migration is applied**: nothing blocks it. The migration is additive and the view shape is identical to live. Right after applying, run the 3.1 check (`set local role authenticated; select refresh_token from integrations` must fail with 42501) and `select * from integration_status()` as the owner.
- **Before the merge**: F1 (data written by the very first sync cannot be repaired later) and F2 (one duplicate line would block CTR permanently). The migration must already be applied (the new `loadAll` hard-depends on `integration_status()`).
- **Can follow later**: F3–F8. F5 is closed by the first real sync (manual 3.7/3.8).

Plan bookkeeping: `change.md` was not stamped `impl_reviewed`, because this review session was asked to commit only this file.
