<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Side Hustle Assistant

- **Plan**: context/changes/side-hustle-assistant/plan.md
- **Scope**: Phase 2 of 6
- **Reviewed phases**: 2
- **Diff**: `origin/main...origin/claude/sha-phase-2-d709d1` (2440466, 1502827; draft PR #6)
- **Date**: 2026-10-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F1) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1, F2, F3) |
| Architecture | PASS |
| Pattern Consistency | WARNING (F6, F7, minor) |
| Success Criteria | PASS (automated recorded green at 2440466, not re-run here; manual 2.4/2.5 pending) |

## What was checked and holds

- `completeWeeks` (`src/lib/rules.ts:38`) matches the definition: Mondays whose Sunday ≤ today − 3. Worked example: today 2026-10-26 (Mon) → last complete week 2026-10-12; week 2026-10-19 becomes complete on 2026-10-28.
- Week-over-week (`impressionsWow`), `ctr_low` and `ctr_last3_weighted` use only complete weeks, so the newest partial week of `v_video_recent.weeks` (Phase 1 round-2 note) never reaches them. The oldest partial week is excluded by `videoWeekOk` (`ws ≥ today − 35`); since Warsaw is ahead of UTC, the device date is never behind the DB's `current_date`, so the filter is never looser than the view.
- Thresholds and severities match the plan: overdue task high, due 0–3 days med, tasks whose due equals a gate's due skipped (t23/t24 confirmed in the DB with dues 2026-12-05 / 2027-01-16), renewals 0–7 days med for `aktywna` only, CTR < 3 % with ≥ 100 impressions in the last complete week med, impressions drop > 20 % med, gate ≤ 14 days and `ok=false` high (also past due), `sync_failed` high on `last_error` or `last_sync_at` older than 36 h, `invalid_grant` → reconnect text.
- Missing data never produces `false`: each rule returns `ok=null` when inputs are missing (WoW also when the earlier week is 0); `gateStatus` gives false only when a rule is false, true only when every rule is true, otherwise null (also for an empty rule list).
- `ctr_last3_weighted`: Σclicks / Σimpressions per film over the last 4 complete weeks, newest 3 live films with a `yt_video_id` and ≥ 100 impressions, channel-level fallback from `weekly_stats` — as recorded in Review decisions. DB: i01 and i03 are live Slowfall films with video ids; `weekly_stats` and `video_daily` are empty, so both gates show "brak danych" today.
- `watch_hours_month_vs`: same day range in both months, capped by the length of the `vs` month, strict `>`; returns no data before the target month starts (Bramka F1 shows "brak danych" until 2027-01-04).
- Dates: all rule maths is UTC arithmetic on `YYYY-MM-DD` strings; `today()` is the device's local date (Europe/Warsaw on the phone). For the Phase 3/5 cron at 05:00 UTC (06:00/07:00 Warsaw) the UTC date equals the Warsaw date, so the shared functions give the same answer on the server.
- Start tab: `?tab=` → `sessionStorage` → `dzis`; the old `localStorage` key is no longer read; `pickTab` writes `sessionStorage`. Matches the "Phase 2 tabs" decision.
- Layout at 390 px: `nav.tabs` already scrolls horizontally (6 tabs fit by scrolling, Dziś first); alert rows are `auto minmax(0,1fr)` grids with `overflow-wrap:anywhere`; gate card head wraps; tap targets ≥ 48 px. No overflow risks found in the JSX/CSS.
- No DB changes, no new dependencies, no gamification changes. `Item.yt_video_id` matches an existing column; `loadAll` selects `*` from `content_items`.

## Findings

### F1 — Month comparison counts the partial newest week as a full week

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: src/lib/rules.ts:131 (with `projectWeeks` at src/lib/rules.ts:51-69 and `hoursInRange` at src/lib/rules.ts:107)
- **Detail**: `lastDay = min(today − 3, monthEnd)` is a day, not the end of a complete week, so the range almost always ends inside an incomplete week. That week's total comes from `v_video_recent.weeks` (whose newest week is partial and is not filtered at the newer end) or, from Phase 3 on, from a synced `weekly_stats` row for the running week. `hoursInRange` spreads that partial total over 7 days, so the target month is undercounted while the `vs` month uses complete weeks. Example: on the due date 2027-01-16, `lastDay` = 01-13 (Wed); week 01-11 holds only ~2–3 days of data but counts as 3/7 of a "full" week, so January loses roughly half of that week's hours. This biases Bramka F1 towards `ok=false`, and within 14 days of its due date that becomes a high `gate` alert — exactly when the decision is made. The plan says "up to the last complete day"; the data granularity is weekly, so a complete day only exists inside a complete week.
- **Fix**: Cap `lastDay` at the Sunday of the last complete week (`addDays(completeWeeks(today, 1)[0], 6)`) instead of `today − 3`, so both ranges are built only from complete weeks; record it in Review decisions.
- **Decision**: PENDING

### F2 — Manually entered weeks are invisible to the rules for two days

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (plan rule applied to data it was not meant for)
- **Location**: src/lib/rules.ts:38-43; src/components/Sheet.tsx:60
- **Detail**: The 3-day lag exists for the YouTube report delay, but it applies to manual `weekly_stats` rows too. The week form defaults to last week (`monday(today − 7)`); that week only counts from Wednesday. Today (Mon 2026-10-26) the default week is 2026-10-19 — the first week with both films live — and it stays out of every rule until 2026-10-28. Manual check 2.5 ("a value after a week is entered manually") will show "brak danych" if Rafał tests it on Monday or Tuesday, which will look like a bug. Separately, 2.5 cannot pass for Bramka F1 before 2027-01-04, because its rule compares January with November.
- **Fix A ⭐ Recommended**: Treat a `weekly_stats` row with `source = 'manual'` as complete once its Sunday is before today; keep the 3-day lag for `yt_api` rows and `v_video_recent`.
  - Strength: Manual numbers are copied from Studio after the week ends, so they have no report lag; check 2.5 works on any day.
  - Tradeoff: Two definitions of "complete" in `rules.ts`; the series passed to `impressionsWow` / `ctrLast3` needs the source per week.
  - Confidence: MED — straightforward, but touches all three week-based rules.
  - Blind spot: Phase 3 recompute overwrites manual rows with `source = yt_api`; then the lag returns for that week, which is intended.
- **Fix B**: Keep the rule; add to the 2.4/2.5 manual-check notes that a week counts from the Wednesday after it and that Bramka F1 shows no data until 2027-01-04.
  - Strength: No code change; matches the plan text literally.
  - Tradeoff: The confusing behaviour stays, every week.
  - Confidence: HIGH — documentation only.
  - Blind spot: None significant.
- **Decision**: PENDING

### F3 — `?tab=` stays in the URL and wins over the session tab on reload

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (UX correctness)
- **Location**: src/components/Tracker.tsx:34, src/components/Tracker.tsx:80
- **Detail**: The query parameter is read on mount but never removed, and `pickTab` does not update it. After arriving via `/?tab=dzis&yt=ok` (Phase 3 OAuth callback) or `/?tab=dzis` (Phase 5 push tap), switching to Zadania and reloading lands on Dziś again, so "survives reloads within a session" breaks for those entry points. Harmless in Phase 2 alone (`start_url` is `/`), but both later phases rely on these URLs.
- **Fix**: After reading `tab`, remove it with `history.replaceState` (keeping other params such as `yt`), or write the current tab into the URL in `pickTab`.
- **Decision**: PENDING

### F4 — The 28-day CTR window shrinks to 21 days every Tuesday

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/rules.ts:82, src/lib/rules.ts:100
- **Detail**: The oldest of the 4 complete weeks starts between today − 36 and today − 30. On Tuesdays it starts at today − 36, `videoWeekOk` drops it, and `ctr_last3_weighted` uses 3 weeks. The same filtered set is also applied to the channel-level `weekly_stats` fallback, which the 35-day view does not limit at all. Accepted in spirit by the "complete weeks" decision, but the result moves from day to day.
- **Fix**: Apply `videoWeekOk` only to per-video weeks (not to the `weekly_stats` fallback); in the Phase 3 migration consider widening `v_video_recent` to 42 days so 4 complete weeks always fit.
- **Decision**: PENDING

### F5 — `sync_failed` and tab state: details to settle in Phase 3/manual checks

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/rules.ts:202; src/components/Tracker.tsx:32-37
- **Detail**: (a) The staleness text shows `dmy(last_sync_at)`, the UTC date of a `timestamptz`; a sync just after midnight in Warsaw shows the previous day. (b) A PWA resumed from the background is not relaunched, so it keeps the last tab; "Dziś on every launch" holds for cold starts only. Manual check 2.4 should be done after closing the app from the app switcher.
- **Fix**: (a) Format `last_sync_at` in local time in Phase 3 when `Data.integrations` gets typed; (b) note the cold-start condition in check 2.4 (optionally reset to Dziś on `visibilitychange` after a few hours, if Rafał wants that).
- **Decision**: PENDING

### F6 — Polish wording in alert texts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/rules.ts:182, src/lib/rules.ts:32, src/components/Today.tsx:7-8
- **Detail**: `ctr_low` says "przy 1 234 wyświetleń" — wrong case after "przy" and ambiguous with views ("wyświetlenia" is also Studio's word for views); the gate rule label correctly says "Wyświetlenia miniatur". The `med` badge "Wkrótce" fits due tasks and renewals but not a CTR or impressions drop. `when()` in rules says "jutro" while the gate card's `days()` says "za 1 dzień", and the two helpers duplicate day phrasing. All other strings are Polish and consistent with existing UI ("Następna płatność", "t/t", "brak danych").
- **Fix**: "przy N wyświetleniach miniatur"; rename the `med` badge to e.g. "Ważne"; use one day-phrase helper for both files.
- **Decision**: PENDING

### F7 — Block elements inside a `<button>`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Today.tsx:29-31
- **Detail**: Tappable alerts render `<div className="t">` / `<div className="d">` inside `<button>`; buttons allow only phrasing content. Browsers render it, but it is invalid HTML and some screen readers flatten it oddly.
- **Fix**: Use `<span>` with `display:block` for `.t` and `.d`.
- **Decision**: PENDING

### F8 — `alerts()` runs twice per render

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/Tracker.tsx:158, src/components/Today.tsx:14
- **Detail**: The tab count and the Dziś panel each call `alerts()` (which calls `gateStatus` per gate) on every render of `Tracker`. Negligible at current data sizes; noted only so Phase 3 (more videos) does not multiply it.
- **Fix**: Compute the list once in `Tracker` (`useMemo` on `data`) and pass it to `Today`.
- **Decision**: PENDING

## Before merge

- **Fix before merge**: F1 (wrong answer for Bramka F1 in its decision window; one-line cap) and F2 (pick A or B — otherwise manual check 2.5 fails on the day it is likely to be run).
- **Fix before Phase 3/5 ships**: F3.
- **Optional**: F4–F8.

## Notes

- Automated criteria 2.1–2.3 were not re-run: this worktree has no `node_modules`. They are recorded green at 2440466.
- `change.md` was not stamped `impl_reviewed`: this review session was limited to committing this file only.
- Read-only `SELECT` against `gigsqrnwyeioqlkngfqe` confirmed: films i01/i03 live with video ids, i02 `pomysł`; 2 gates with the planned rules; t23/t24 dues equal the gate dues; `weekly_stats` = 0 and `video_daily` = 0 rows.
