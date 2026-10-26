<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Side Hustle Assistant Implementation Plan

- **Plan**: context/changes/side-hustle-assistant/plan.md (brief: plan-brief.md)
- **Mode**: Deep (codebase and live schema verified directly by the reviewer: no sub-agent tool was available in this run; API facts checked against Google and Cloudflare docs)
- **Date**: 2026-10-26
- **Verdict**: REVISE → all findings applied to plan.md on 2026-10-26 (see plan § Review decisions)
- **Findings**: 2 critical, 7 warnings, 1 observation

Settled owner decisions were not re-opened: no LLM, gamification unchanged, no unit tests (2 integration + 1 smoke E2E), the Side Hustle Assistant name with a new worker and a 301, PWA push, a shared `projects` table, and release 1 = phases 1–3 before 2026-10-31. The approach is right: phase order, one worker with a `scheduled` handler, tokens readable only by the service role, and the Reporting API for CTR. The problems are in specific contracts. As written, two of them would fail at implementation time (the migration and the Analytics query), and several others would lose data or alerts without any error.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

Grounding: 8/8 existing paths ✓ (`src/components/Tracker.tsx` 384 lines, `src/lib/data.ts`, `src/lib/game.ts`, `src/lib/types.ts`, `src/components/Sheet.tsx`, `src/app/manifest.ts`, `src/app/layout.tsx`, `wrangler.jsonc`; `supabase/` is correctly marked as a new folder). 5/5 symbols ✓ (`loadAll` data.ts:12, `TABS` Tracker.tsx:12, `weeksAgg`/`trend` game.ts:29-47, `main: ".open-next/worker.js"` wrangler.jsonc:3, `public.is_owner()`). Brief↔plan ✓. Progress↔Phase ✓ (6/6 phases; every success bullet has a matching N.M row; no checkboxes in the phase bodies). One stale data claim: content item `i03` (film #3) is **already** `live`, and there is no film #2 row (`i02` is a `pomysł`). See F10.

Live schema checked on `gigsqrnwyeioqlkngfqe` (read-only): `channels(id, slug NOT NULL UNIQUE, name, niche, yt_channel_id UNIQUE, created_at, updated_at)` has no `archived_at`/`note`; FKs `content_items_channel_id_fkey → channels ON DELETE SET NULL` and `weekly_stats_channel_id_fkey → channels ON DELETE CASCADE`; PK `weekly_stats(channel_id, week_start)`; view `v_xp_events` builds a `week` XP event from `weekly_stats.channel_id`; `touch` trigger and `owner_all` policy on `channels`; extensions include `supabase_vault`.

## Findings

### F1 — "projects takes over channels, then channels is dropped" breaks the FKs

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 Schema migration; Critical Implementation Details ("must keep ids"); Migration Notes
- **Detail**: The contract creates `projects`, copies the rows and ids, and drops `channels` "once the code reads projects". The live schema has `content_items.channel_id` and `weekly_stats.channel_id` FKs to `channels(id)` (the second is `ON DELETE CASCADE`). A plain `DROP TABLE channels` fails. `DROP ... CASCADE` silently drops both FKs, so `weekly_stats` and `content_items` lose referential integrity with no error. The contract also leaves out columns that exist and are used: `slug` is `NOT NULL UNIQUE` with no default, so inserting CMV and Elektronika without a slug fails. `niche` is selected by `loadAll` (data.ts:18). `updated_at` and the `touch` trigger are missing as well.
- **Fix**: Replace "takes over the rows and ids … dropped" with an in-place rename: `alter table channels rename to projects;` then `alter table projects add column kind …, status …, distrokid_artist …, note …, archived_at …;` then `alter table content_items rename column channel_id to project_id; alter table weekly_stats rename column channel_id to project_id;`. Postgres carries the PK, both FKs, the unique constraints, the `touch` trigger, the `owner_all` policy and `v_xp_events` (columns are bound by attnum) through the rename. Ids and XP refs stay the same. Give the new rows explicit slugs (`contents-may-vary`, `elektronika`). Delete the sentence "`channels` is dropped in the same phase". Optionally rename the constraints for clarity.
- **Decision**: ACCEPTED — rename `channels` in place, explicit slugs (applied in plan Phase 1)

### F2 — Analytics API query `dimensions=day,video` is not a supported report as written

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 Cron and mapping
- **Detail**: In the channel reports of the YouTube Analytics API, `video` is a **filter**. It can be added to the dimensions only together with `filters=video==id1,id2,…` (multiple values, max 500). Day-by-video data for the whole channel without that filter returns a "query not supported" 400. The plan gives no video list. `content_items.yt_video_id` is incomplete (film #2 has no id, and new uploads appear before Rafał types them in). The fixture in `tests/fixtures/yt-analytics.json` would then encode a response the API never returns.
- **Fix A ⭐ Recommended**: Get the video ids from YouTube: `channels.list(part=contentDetails,mine=true)` → uploads playlist → `playlistItems.list`, which costs 1–2 quota units. Then call `reports.query` with `ids=channel==MINE&dimensions=day,video&filters=video==<ids>&metrics=views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost&startDate=-28d&endDate=today`. Fill the fixture from a real call.
  - Strength: Keeps the fresher Analytics data (lag of about 1 day vs 2 days) and does not depend on Rafał typing ids in. The `youtube.readonly` scope is already requested.
  - Tradeoff: One or two extra calls per channel, and the 500-id cap has to be handled if a channel ever grows past it.
  - Confidence: MED — follows the documented filter→dimension rule; not run against a live channel.
  - Blind spot: Whether Shorts and unlisted videos appear in the uploads playlist the way Studio counts them.
- **Fix B**: Drop the Analytics API and read per-video daily views, watch time, AVD and subs from the Reporting API report `channel_basic_a3` (dimensions `date, channel_id, video_id, live_or_on_demand, subscribed_status, country_code`), created next to `channel_reach_basic_a1`.
  - Strength: One ingestion path (jobs → reports → CSV) for all metrics and one mapper style for the tests.
  - Tradeoff: About 48 h of lag. Rows have to be summed over country, subscribed status and live/on-demand, with AVD weighted by views. "Sync now" then shows nothing on connection day.
  - Confidence: HIGH — dimensions and metrics confirmed in the channel reports reference.
  - Blind spot: CSV size for a channel with many countries.
- **Decision**: ACCEPTED Fix A — uploads playlist → `filters=video==` (applied in Phase 3)

### F3 — Reporting API ingestion has no cursor, no replace rule and no budget for the first-run backfill

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1 `integrations` contract; §3 "download new reach reports"
- **Detail**: Per the Reporting API docs, a new job produces reports for the **30 days before** job creation. Each report covers one Pacific-time day and becomes available within 48 h. Historical reports are deleted after 30 days and normal ones after 60. Backfilled data comes as a **new report id with the same startTime/endTime**, and the newer `createTime` must win. The plan says "download new reports" but `integrations` has nowhere to store which reports were already imported (only `reporting_job_id`, `last_sync_at`). The first run is about 30 CSV downloads per channel, plus token refresh, `jobs`/`reports.list` and the Supabase writes. On Workers **Free** that exceeds the 50-subrequest limit per invocation and probably the 10 ms CPU limit for a cron. On Paid the limits are 10,000 subrequests and 30 s CPU. The plan does not say which plan the account is on.
- **Fix A ⭐ Recommended**: Add `reports_cursor timestamptz` (the max imported `createTime`) to `integrations`. Call `reports.list?createdAfter=<cursor>`, sort by `createTime` ascending, upsert each report into `video_daily` (a later report for the same day overwrites it, which handles backfills), and advance the cursor after each report. Cap each run at ~10 reports per integration and let the next run continue. Add one line under Prerequisites: "Workers plan = Paid (or confirm Free limits: 50 subrequests / 10 ms CPU per cron)".
  - Strength: Resumable, idempotent, and correct for backfill. It stays under limits on either plan.
  - Tradeoff: Full history arrives over 2–3 daily runs (or a few "Sync now" presses).
  - Confidence: HIGH — the replace rule and the `createdAfter` param are documented.
  - Blind spot: Whether the current account is Free; the 10 ms CPU limit may already constrain the Next app itself.
- **Fix B**: Run the sync from a Cloudflare Queue or Workflow, with one message per report.
  - Strength: No per-invocation limits at all.
  - Tradeoff: A new infra primitive for a single-owner app (pattern proliferation); more moving parts in the rename (phase 6).
  - Confidence: MED.
  - Blind spot: Queue availability on the account plan.
- **Decision**: ACCEPTED Fix A — `reports_cursor`, ≤10 reports/run, designed for Workers Free (applied in Phase 3)

### F4 — The scheduled handler cannot reuse the app's runtime as the plan assumes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §3 (`worker.ts`, `ytSync.ts`); Phase 4 §2 ("alerts() … data via service role")
- **Detail**: (a) OpenNext's documented custom-worker pattern imports the generated `./.open-next/worker.js` and re-exports `fetch`. That file exists only after a build. `tsconfig.json` includes `**/*.ts`, so `npm run typecheck` fails on a clean checkout unless the import has `// @ts-ignore`. `ExportedHandler<CloudflareEnv>` also needs `cloudflare-env.d.ts`, which is not in the repo (the `cf-typegen` script exists but has never been run). (b) Inside `scheduled(controller, env, ctx)` there is no request context: `getCloudflareContext()`, and the `process.env` values OpenNext fills in per request, are not set up. Code shared with the route handlers that reads secrets that way breaks only in the cron. (c) `loadAll()` is bound to the browser singleton `supabase()` (`src/lib/supabase.ts`: publishable key, localStorage session), so the cron cannot call it "via service role" as Phase 4 says.
- **Fix A ⭐ Recommended**: Keep all sync and push logic in route handlers. `scheduled` only does `ctx.waitUntil(openNext.fetch(new Request("https://cron.internal/api/cron", { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } }), env, ctx))`, and `/api/cron` runs sync → alerts → push. Add `CRON_SECRET` to the Worker secrets list. Change the data layer to `loadAll(db: SupabaseClient = supabase())` so the server passes a service-role client. Add `// @ts-ignore` on the `.open-next/worker.js` import, and add "run `npm run cf-typegen` and commit `cloudflare-env.d.ts`" to Phase 3.
  - Strength: One runtime path (`getCloudflareContext`) for "Sync now" and the cron. The cron becomes testable with curl. `worker.ts` stays about 10 lines.
  - Tradeoff: One extra internal hop, which is not a network subrequest.
  - Confidence: MED — the self-invoke pattern is standard on Workers, but not verified with OpenNext 1.20 specifically.
  - Blind spot: Whether the OpenNext middleware or routing treats the synthetic host differently.
- **Fix B**: Pass `env` explicitly into `ytSync(env)`/`push(env)` and never read `process.env` in those modules.
  - Strength: No internal HTTP hop.
  - Tradeoff: Two ways of getting secrets in one codebase; easy to regress.
  - Confidence: MED.
  - Blind spot: Transitive imports that touch `process.env`.
- **Decision**: ACCEPTED Fix A — `scheduled` → `/api/cron` via `openNext.fetch`; `loadAll(db)` (applied in Phases 1 and 3)

### F5 — Upserts and the client read can lose data without an error

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 (`mapAnalytics`/`mapReach` → `VideoDay[]`, weekly recompute); Performance Considerations ("last 120 days")
- **Detail**: (a) Two sources write the same `video_daily` row type. If `mapReach` returns full `VideoDay` objects with `views: null`, the upsert sets the Analytics columns to null, and the reverse also happens. (b) "`manual` rows for those weeks are overwritten": an upsert of the whole row would also clear the manual `revenue_pln`, `note` and `uploads`, and would bring back a week Rafał archived (`archived_at` is part of the PK row). (c) PostgREST returns at most 1000 rows per request by default. 120 days × ~20 live videos is already about 2,400 `video_daily` rows, so the client gets a truncated set and the CTR and gate values on Dziś are wrong with no error.
- **Fix**: State that each mapper upserts only the columns it owns (Analytics: `views, watch_minutes, subs_net, avd_sec`; reach: `impressions, ctr_pct`). The weekly recompute upserts only `views, watch_hours, subs_net, ctr_pct, avd_min, impressions, source`, never `revenue_pln/note/uploads/archived_at`, and skips weeks whose row is archived. For the client, read a per-video, per-week aggregate view (`v_video_weekly`, owner RLS through the base table) instead of raw `video_daily`, or restrict to 35 days and page with `.range()`.
- **Decision**: ACCEPTED — disjoint upsert columns, skip archived weeks, `v_video_recent` (applied)

### F6 — Gate and alert rules are undecided at their boundaries

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 `gates.rule`, §2 seed data; Phase 2 §1 thresholds
- **Detail**: (a) Contradiction: "Bramka 1" is `ctr_last3_avg` **and** `impressions_wow_rising`, but `gates.rule` is a single text column and criterion 1.1 expects exactly 2 gates. (b) `ctr_last3_avg` does not define which 3 films (latest by `publish_date` among `live` films with a `yt_video_id`?), over which window (lifetime to date or first 7 days?), or how the 3 are averaged (simple mean, or Σclicks/Σimpressions). These give different results, and the gate result depends on the choice. (c) `impressions_wow_rising` does not say over how many weeks. (d) "Impressions down > 20% week over week": with the current partial week and the ~2-day reach lag, Mon–Wed will always look like a drop, so the alert (and from phase 4 the push) fires falsely every week. (e) `watch_hours_month_vs 2027-01 vs 2026-11` is evaluated at due 2027-01-16, when January is half over. Comparing a full November with half a January is not meaningful.
- **Fix**: Change `rule text` + `params` to `rules jsonb` (an array of `{rule, params}`, all of which must be ok), or seed 3 gate rows and make criterion 1.1 "gates = 3". Define in `rules.ts`: "complete week = the last Mon–Sun week for which `video_daily` has reach data on all 7 days". The w/w rules compare the last two complete weeks only. `ctr_last3_avg` = impression-weighted lifetime CTR (Σ impressions×ctr / Σ impressions) of the 3 most recent `live` films by `publish_date` that each have ≥ 100 impressions, else `null`. `impressions_wow_rising` = the last complete week > the one before. `watch_hours_month_vs` compares the same day range (1st–15th) of both months, or MTD scaled by days. Record the chosen formulas in the plan so the alert matches Studio in 3.8.
- **Decision**: ACCEPTED — `rules jsonb`, complete weeks, impression-weighted CTR, same day range (applied in Phases 1–2)

### F7 — A failing sync is invisible: no alert for an expired token or stale data

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1 `Alert.kind`; Phase 3 §1/§4; Critical Implementation Details (OAuth "sync dies silently")
- **Detail**: The plan names a silently dying sync as the main OAuth risk. It then only writes `last_error`, which is visible only if Rafał opens the integration panel. `alerts()` has no kind for it, so Dziś and the push show "no alerts" exactly when the data stopped. Google returns `invalid_grant` when a token is revoked, the Brand Account's access changes, or the client secret is rotated. Missing reach data looks the same as "no CTR problem".
- **Fix**: Add `Alert.kind 'sync_failed'` (high): integration with `last_error` set, or `last_sync_at` older than 36 h. Add `Data.integrations` from `integration_status()`. On `invalid_grant`, set `last_error = 'reconnect required'` and show "Connect" again. Add a manual check to 3.6: revoke access in the Google account → the next sync shows the alert.
- **Decision**: ACCEPTED — `sync_failed` alert + `Data.integrations` (applied in Phases 2–3)

### F8 — Dziś will not be the default screen for Rafał

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §2 contract ("a remembered choice in localStorage still wins"); manual 2.4
- **Detail**: `Tracker.tsx:75-76` writes `localStorage.tab` on **every** tab switch, and the initializer at :28-30 restores it. Rafał already has a stored tab, so Dziś opens by default only on first use, and 2.4 ("Dziś opens by default") fails on his phone. The brief's goal ("opens on the Dziś screen in the morning") is lost after the first tab change.
- **Fix**: Always start on `dzis` on a cold start: drop the localStorage restore, or move it to `sessionStorage` so it survives reloads but not app launches. Have the push click open `/?tab=dzis`.
- **Decision**: ACCEPTED — always start on Dziś, saved tab → `sessionStorage` (applied in Phase 2)

### F9 — Phase 6 rename misses the Supabase Auth URLs, query-string redirects and origin-bound state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 6 §2 contract (steps 1–5); phase order 4 → 6
- **Detail**: (a) `Login.tsx` sends magic links with `emailRedirectTo: location.origin`. If the new origin is not in the Supabase Auth Redirect URLs (and Site URL), links fall back to the old URL. The PKCE code verifier sits in the new origin's localStorage, so login by link breaks. (b) The 301 must keep the **query string** as well as the path (`?code=` for auth, `?yt=` for OAuth). The plan says only "keeping the path". (c) Step 4 (new Google redirect URI) comes after step 1 (rename), which leaves a window where "Connect YouTube" fails with `redirect_uri_mismatch`. Both URIs can be registered at the same time. (d) localStorage is per origin: session, remembered tab and anything else stored are gone, so a re-login is needed (fine, but write it down). (e) If push (phase 4) ships before the rename, the service worker and push subscriptions belong to the old origin. After the rename the old origin answers 301 for `sw.js`, the old subscription keeps getting pushes (the endpoints are not origin-checked by the sender), and taps open the old URL: duplicate or broken notifications until the endpoints return 410. (f) It does not say how `redirect-worker/` gets deployed (Workers Builds is tied to the main worker; this needs a manual `wrangler deploy` with Rafał's credentials). Note: Workers Builds overrides the name through `WRANGLER_CI_OVERRIDE_NAME`, so step order 1→2 is safe on the Cloudflare side.
- **Fix A ⭐ Recommended**: Swap phases 4 and 6 (rename before push; both are release 2, so the settled release-1 scope does not change). Extend the step list: (0) add the new redirect URI in Google and the new URL in the Supabase Auth Redirect URLs and Site URL, (1) rename in CF, (2) merge, (3) deploy the mini worker with `npx wrangler deploy -c redirect-worker/wrangler.jsonc` (`Response.redirect(new URL(url.pathname + url.search, NEW), 301)`), (4) remove the old URIs after a week, (5) reinstall the PWA and log in again. Add to 6.5: "old URL + `?a=1` keeps the query".
  - Strength: Push subscriptions are born on the final origin. No transition window for OAuth or Auth.
  - Tradeoff: The release-2 order changes.
  - Confidence: HIGH — every item follows from code in the repo (`Login.tsx`, `Tracker.tsx`) and documented platform behaviour.
  - Blind spot: Whether Supabase sends emails only when the redirect is on the allow-list (it falls back to Site URL).
- **Fix B**: Keep the order and, in phase 6, add "delete all `push_subscriptions` and unregister the old SW (the mini worker serves a `sw.js` that calls `self.registration.unregister()` instead of a 301 for that path)", plus the same step-0 and query-string items.
  - Strength: The phase order stays.
  - Tradeoff: More special cases in the mini worker; one more manual step.
  - Confidence: MED.
  - Blind spot: How iOS handles an SW update served from a different script body.
- **Decision**: ACCEPTED Fix A — rename moved to Phase 4 before push; step 0 URL allow-lists; query kept (applied)

### F10 — Smaller corrections (integrations hardening, data facts, XP side effect, release-1 timing)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2; Phase 3 §1–§2; Testing Strategy
- **Detail**:
  1. *RLS on `integrations`*: RLS with no policy is correct. However, Supabase's default privileges still grant `authenticated`/`anon` table rights. Add `revoke all on integrations from anon, authenticated;` and, for `integration_status()`, `security definer set search_path = ''` + `revoke execute … from public, anon; grant execute … to authenticated`. Criterion 3.1 needs a runnable check, for example `set local role authenticated; select refresh_token from public.integrations;` → expects `permission denied`/0 rows. Optional: `supabase_vault` is installed and could hold the refresh token.
  2. *OAuth callback*: compare the `channels.list?mine=true` id with `projects.yt_channel_id` (set it when null). If they differ, reject with `?yt=wrong_channel`. Otherwise picking the wrong Brand Account silently connects the wrong channel to Slowfall.
  3. *Keys*: the project uses the new publishable keys, so the server key is a Supabase **secret key** (`sb_secret_…`). Name the secret accordingly or confirm that the legacy `service_role` JWT is still enabled.
  4. *Data facts*: film #3 (`i03`) is already `live` (only its `yt_video_id` is missing); there is no film #2 row (`i02` is a `pomysł`), so "film #2 id filled in by Rafał" needs a row first. Tasks are addressed by `legacy_id` (`t25`, `t26`, `t07`). Tasks `t23`/`t24` duplicate the two gates, so Dziś will show both a task alert and a gate alert. Decide whether to archive them or link them.
  5. *XP side effect*: `v_xp_events` gives +5 XP for every non-archived `weekly_stats` row, so the first sync creates about 4–5 `yt_api` weeks (an XP toast, possibly the "Kronikarz" badge). Task `t11` ("wpisać tydzień") becomes automatic. This does not change the gamification code. The plan should say whether this is the intended behaviour (see Questions).
  6. *Release-1 timing*: reach reports arrive ≤ 48 h after the job is created, and only then with 30 days of history. For the thumbnail-template choice on 10-31, the job must exist by about 10-29. Put "create the reporting job" first in Phase 3, even as a one-off call right after the OAuth callback works.
- **Fix**: Add the six points to the respective phases (one line each).
- **Decision**: ACCEPTED — all applied; synced weeks keep earning XP; t23/t24 kept with alerts suppressed

## Questions for the owner (recorded; no interactive user in this run)

1. **Which Cloudflare Workers plan is the account on (Free or Paid)?** It decides F3's limits. *Recommended answer*: Paid ($5/month) once the cron ships. If it stays Free, the Fix A cap of 10 reports per run is required.
2. **Should automatically synced weeks earn XP through `v_xp_events`?** *Recommended answer*: yes, leave the view unchanged (consistent with "gamification unchanged"), and document the one-time XP jump after the first sync.
3. **Swap phases 4 and 6 (rename before push)?** *Recommended answer*: yes (F9 Fix A). Both are release 2, so the settled release-1 scope is untouched.
4. **Which formula defines "avg CTR of the last 3 films" for Bramka 1?** *Recommended answer*: impression-weighted lifetime CTR of the 3 most recent live films with ≥ 100 impressions (F6), since it is closest to how Studio reports reach.
5. **Should tasks t23/t24 (the gates written as tasks) be archived once the gates exist?** *Recommended answer*: keep them but have Dziś suppress the task alert when a gate with the same due date exists. Archiving costs their XP once done.

## Sources consulted

- YouTube Reporting API, channel reports (`channel_reach_basic_a1`, `channel_basic_a3`): https://developers.google.com/youtube/reporting/v1/reports/channel_reports
- YouTube Reporting API, reports overview (48 h availability, 30-day history, backfill by newer `createTime`, retention): https://developers.google.com/youtube/reporting/v1/reports
- YouTube Analytics API, channel reports (`video` is a filter; multi-value filter can be a dimension): https://developers.google.com/youtube/analytics/channel_reports
- OpenNext Cloudflare, custom worker: https://opennext.js.org/cloudflare/howtos/custom-worker
- Cloudflare Workers limits (Free 50 subrequests / 10 ms CPU per cron; Paid 10,000 / 30 s): https://developers.cloudflare.com/workers/platform/limits/
- Workers Builds name mismatch and `WRANGLER_CI_OVERRIDE_NAME`: https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/
