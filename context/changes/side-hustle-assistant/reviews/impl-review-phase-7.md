<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Side Hustle Assistant — Phase 7 (traffic sources, search terms, hourly views)

- **Plan**: context/changes/side-hustle-assistant/plan.md
- **Scope**: Phase 7 of 7
- **Reviewed phases**: 7
- **Date**: 2026-10-28
- **Commits**: `f199017` (code), `f60adc3` (plan decisions/progress); diff `origin/main...origin/claude/sha-phase-7` (draft PR #8)
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Gate summary

- **Before the migration is applied**: nothing blocks. The migration is strictly additive and safe to apply to the live DB while `main` keeps running (see "Migration readiness").
- **Before merge**: the migration **must** be applied first (`loadAll` reads the three tables and `v_views_24h` in one `Promise.all` with `check()`; without them Dziś shows a load error). Fix F1, F2 and F3 before merge; F4–F9 can follow.

## Migration readiness (read-only checks on `gigsqrnwyeioqlkngfqe`)

- Live migrations end at `20261026124310 integrations`; none of `video_traffic`, `video_search_terms`, `video_stats_hourly`, `v_views_24h` exists, and no `video_*` index other than `video_daily_*` — no name collisions.
- `public.is_owner()`, `public.touch_updated_at()` and `public.projects` exist, so the FKs, trigger and policies resolve.
- Default ACLs in `public` grant `anon` and `authenticated` `arwdDxtm` on new relations (tables and views). The migration revokes all from both on the three tables **and** the view, then grants `select` to `authenticated` only; `service_role` keeps full rights through the default ACL. Result: owner-read via `(select public.is_owner())`, no insert/update for `authenticated`/`anon` — matches the plan and the `video_daily`/`gates` policy shape.
- `v_views_24h` is `security_invoker = true`, so the base-table RLS applies to it.
- Nothing existing is altered; `main` does not read the new objects. Applying ahead of the merge is safe.

## Verification run

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (1 pre-existing warning in `open-next.config.ts`) |
| `npm run test:int` | pass, 7/7 (3 new: traffic + grouping, search terms, stats) |
| `npm run build` | pass (OpenNext build complete) |

Focus points confirmed without findings: both triggers in `wrangler.jsonc:11`; secret check unchanged and still first (`route.ts:8`); daily work only on the non-hourly path, snapshots only on `hourly`; traffic window `period_end − 27 d … period_end` (`ytSync.ts:76-77`) with upsert-then-remove-older so a same-day re-run overwrites; `maxResults=25` on search terms; `videos.list` chunks of 50 (`ytSync.ts:164`); one token refresh per integration per hourly run; 14-day cleanup per project; Google calls go through `tfetch` (20 s timeout, Phase 3 F4); traffic failure sets `last_error = "Traffic: …"` after the core `last_error: null`, so `sync_failed` still fires; the Phase 3 disjoint-column upserts and `reports_cursor` are untouched. 24 h math: one snapshot only → `base_*` null → no number ("Czekam na pierwsze dwie godzinne migawki."), never zero. Polish labels match the plan (Sugerowane, Wyszukiwarka, Przeglądanie, Zewnętrzne, Playlisty, Inne; "licznik publiczny, ~1 h"). The `.share` grid (7.5rem + bar + 3rem) and 44 px `<summary>` fit 390 px.

## Findings

### F1 — Hourly failures are invisible and stale counters look current

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/api/cron/route.ts:9, src/lib/server/ytSync.ts:176, src/components/Fresh.tsx:40
- **Detail**: `snapshotAll` catches every error into `{ ok: false }`, the route always answers 200, and `worker.ts` logs only non-ok statuses — so a failing hourly run (revoked token, quota, Data API change) leaves no trace in Workers logs, and by design it never touches `last_error`. Meanwhile `v_views_24h` keeps comparing the last two snapshots it has, and the cleanup also lives in the hourly run, so Dziś keeps showing the same "+N" under "Ostatnie 24 h" indefinitely with no hint that it is days old.
- **Fix**: Log failed results (`console.error("hourly", projectId, error)`) in the route or `snapshotAll`, and in `Fresh` show "stan z <localDateTime(taken_at)>" (or hide the number) when the newest snapshot is older than ~3 h.
  - Strength: Uses the existing observability (Workers logs) and the existing `localDateTime`; no schema change; keeps `last_error` reserved for the daily sync as decided.
  - Tradeoff: A few lines in two files; staleness threshold is a judgement call.
  - Confidence: HIGH — the silent path is visible in the code (`ytSync.ts:171`, `worker.ts:16`).
  - Blind spot: Whether Rafał wants an alert for a stopped counter (out of scope for this phase; no new alerts planned).
- **Decision**: Fixed: failed hourly results are logged (`console.error`) in `snapshotAll`; `Fresh` shows "stan z <date-time>" when the newest snapshot is older than 3 h

### F2 — Cron routing fails open to the daily sync

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: worker.ts:13, src/app/api/cron/route.ts:9
- **Detail**: `worker.ts` maps only `"30 * * * *"` to `hourly`; any other `controller.cron` becomes `daily`, and the route treats any header other than `hourly` (including missing or misspelled) as daily. If the hourly expression in `wrangler.jsonc` is ever changed without the constant in `worker.ts` (they are only linked by a comment), every hourly trigger runs the full daily sync — 24 runs a day of Analytics, Reporting downloads and up to 80 traffic calls per integration. An unknown kind should not be able to run the daily sync more than once a day.
- **Fix**: In `worker.ts` match both expressions explicitly (`"0 5 * * *"` → daily, `"30 * * * *"` → hourly) and `console.error` + return on anything else; in the route run the daily sync only for `x-cron-kind === "daily"` and return 400 for an unknown kind (worker and route deploy together, so no back-compat for a missing header is needed).
- **Decision**: Fixed: `worker.ts` maps both cron expressions explicitly and logs/returns on any other; the route runs daily only for `daily`, hourly only for `hourly`, 400 otherwise

### F3 — Trimmed search terms can collide and abort the traffic step

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/ytMap.ts:152, src/lib/server/ytSync.ts:85
- **Detail**: `mapSearchTerms` trims each term but does not merge duplicates. Two Analytics rows that differ only in surrounding whitespace become the same `(yt_video_id, period_end, term)` in one upsert batch, which Postgres rejects ("ON CONFLICT DO UPDATE command cannot affect row a second time"). The terms of that video were already removed on line 85, the loop aborts for all remaining videos, and `last_error = "Traffic: …"` raises `sync_failed` every day until the term ages out of the window.
- **Fix**: Aggregate by trimmed term in `mapSearchTerms` (sum views, keep descending order) and add a duplicate-after-trim row to `yt-search-terms.json`.
- **Decision**: Fixed: `mapSearchTerms` sums views per trimmed term, sorted descending; fixture has a duplicate-after-trim row

### F4 — One traffic failure stops the remaining videos and reads as a broken sync

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/server/ytSync.ts:78-87, src/lib/format.ts:23
- **Detail**: `syncTraffic` throws on the first failing video, so videos after it in the newest-first list get no update that day. The resulting `last_error` ("Traffic: …") goes through `syncErrorPl`, which falls back to "Synchronizacja nie powiodła się", and the Integrations card turns into a primary "Połącz ponownie" button — although the core data synced and reconnecting would not help. This matches the recorded decision (failures must keep `sync_failed` working), but the copy points to the wrong action.
- **Fix**: Add a `/^Traffic:/` branch to `syncErrorPl` ("Źródła ruchu nie zostały pobrane, dane dzienne są aktualne") and keep the primary reconnect style for non-traffic errors; optionally continue with the next video and report the first error.
  - Strength: Keeps `sync_failed` firing as decided while giving an accurate Polish message.
  - Tradeoff: Small UI/format change; continuing after an error adds a little control flow.
  - Confidence: MED — real-call behaviour of the traffic queries is still unverified (fixtures are hand-written).
  - Blind spot: Which Analytics errors actually occur per video.
- **Decision**: Fixed: `syncTraffic` continues with the next video and rethrows the first error; `syncErrorPl` has a `/^Traffic:/` branch ("Źródła ruchu nie zostały pobrane, dane dzienne są aktualne") and the reconnect button stays non-primary for it

### F5 — "Ostatnie 24 h" span label covers only the < 24 h case

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/Fresh.tsx:40, supabase/migrations/20261028100000_traffic_and_snapshots.sql:41-58
- **Detail**: The plan says latest minus the snapshot ≥ 24 h older; the implementation falls back to the oldest snapshot while history is shorter and labels it "dane z ostatnich N h" (recorded in the Phase 7 decisions, accepted). When hourly runs were missed, the base can be 25–48 h back and the number is shown with no span hint because the label only appears for `hours < 24`. `hours` is also the minimum across videos while the sum mixes spans.
- **Fix**: Show "dane z ostatnich N h" whenever the span is not 24 h (use the max span across videos when they differ).
- **Decision**: Fixed: "dane z ostatnich N h" whenever the span is not 24 h, using the largest span

### F6 — Project total keeps counting videos that left the 90-day window

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/Fresh.tsx:21-22
- **Detail**: A video that ages past `RECENT_DAYS` stops getting snapshots but its rows stay for 14 days; `v_views_24h` still returns its last pair, so its last-known 24 h gain keeps being added to the project total.
- **Fix**: Only sum videos whose `taken_at` equals the project's newest `taken_at`.
- **Decision**: Fixed: only videos at the project's newest `taken_at` are summed

### F7 — Per-video panel on Dziś can grow to 40 rows

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/Fresh.tsx:28, src/components/Fresh.tsx:50
- **Detail**: The plan placed the traffic/search-terms panel in the project view or Tygodnie; the decision moved it onto Dziś as one `<details>` per video with traffic data, i.e. up to `MAX_TRAFFIC_VIDEOS = 40` per project. Fine for today's handful of films, but it will push Bramki down on a phone as channels grow.
- **Fix**: Limit Dziś to videos published in the last 7 days (the same set as the 24 h list) or the top 5 by views, and leave the full list for the project view.
- **Decision**: Fixed: the per-video breakdown on Dziś covers only films published in the last 7 days

### F8 — Hourly run pages the whole uploads playlist and tests skip header reordering

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/server/google.ts:77, tests/integration/ytMap.test.ts:53
- **Detail**: The plan budgeted ≤ 3 calls per integration per hour; the run does token + up to 3 `playlistItems` pages + `videos.list` chunks + 2 Supabase calls, and keeps paging even after items older than 90 days appear (harmless on Workers Paid, 3 quota units/h). Separately, the test title says "by header name" but the fixture uses the default column order, and the "missing dimension column" throw in `table()` is untested.
- **Fix**: Stop paging once an item is older than `RECENT_DAYS`; add one reordered-header fixture case and one missing-column `toThrow` case.
- **Decision**: Fixed: `uploads()` stops paging once an item is older than the 90-day cutoff (hourly run); added reordered-header and missing-column tests

### F9 — 7.1 ticked although the migration is not applied

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/side-hustle-assistant/plan.md (Progress 7.1)
- **Detail**: The criterion is "applies cleanly; `authenticated` can select but not insert"; the row is `[x]` with "written, not applied". The SQL and the live catalog (see Migration readiness) support it applying cleanly, but neither part has been observed.
- **Fix**: Keep 7.1 open (or re-tick it) only after the migration is applied and an `authenticated` insert is confirmed to fail.
- **Decision**: Fixed: 7.1 un-ticked; the orchestrator ticks it after applying the migration and confirming an authenticated insert fails

## Not findings (checked)

- Hand-written fixtures and the per-video traffic query (no `video==a,b`) are recorded decisions; real-call checks stay with manual rows 7.6/7.7.
- `MAX_TRAFFIC_VIDEOS = 40` on Workers Paid: ~80 Analytics calls + writes per integration is far below 10,000 subrequests; time is spent waiting on Google, not CPU.
- Search terms are queried only when `YT_SEARCH` has views — saves calls, consistent with the plan's intent.
