# Side Hustle Assistant — Plan Brief

> Full plan: `context/changes/side-hustle-assistant/plan.md`

## What & Why

The task tracker becomes an assistant and dashboard for the Wydawnictwo project. The 2026-10-26 strategy (option B, gates on 12-05 and 01-16) measures success by CTR, thumbnail impressions and watch hours; the app has none of that today and everything is typed in by hand. The app should collect the data itself, evaluate the gates and say what needs attention.

## Starting Point

A client-rendered Next.js app on Cloudflare Workers with 5 tabs and gamification, manual data in Supabase. One "channel" (Slowfall not under its real name, no CMV), empty weekly stats, no notion of a gate, no backend, no tests.

## Desired End State

"Side Hustle Assistant" at a new URL opens on the "Dziś" screen: alerts (deadlines, renewals, CTR < 3%, falling thumbnail impressions) and gate cards with the current value. YouTube data arrives every morning, a push notification reports alerts, DistroKid revenue comes in through a CSV import. Everything is grouped by project: Slowfall, CMV, Elektronika.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Assistant role | Rules only, no LLM | No API cost; rules cover gates, deadlines and renewals |
| Data source | YouTube Analytics + Reporting API; DistroKid via CSV | CTR and thumbnail impressions decide the 12-05 gate; DistroKid has no API |
| Gamification | Unchanged | Rafał's decision |
| Name | Side Hustle Assistant (no "AI", since no LLM) | Neutral across projects |
| URL | New worker `side-hustle-assistant` + 301 from the old one | Consistent name; cost is one PWA reinstall |
| First release | Phases 1–3 before 10-31 | 10-31 is the thumbnail-template choice based on Studio data |
| Data model | Shared `projects` table (YT channel / artist / both) | CMV is both an artist and a channel |
| Notifications | PWA push once a day, only when there are alerts | The assistant should speak up; works without SMTP |
| Alerts v1 | Deadlines, gates, renewals ≤ 7 days, CTR < 3%, impressions drop w/w | The thresholds are the 12-05 gate criteria |
| Tests | No unit tests; 2 integration (YouTube, CSV) + 1 smoke E2E | Private tool; bugs surface in daily use |
| Sync | Cron in the same worker, tokens in Supabase for the service role only | One deployment, secrets kept out of the browser (agent's call) |

## Scope

**In scope:** projects and gates in the database, Dziś screen, per-channel YouTube OAuth, daily sync, PWA push, DistroKid CSV import, rename and new URL, 3 tests.

**Out of scope:** LLM, gamification changes, DistroKid API/scraping, Spotify/TikTok beyond the CSV, unit tests, CI, GitHub repo rename, multi-user, writes to YouTube.

## Architecture / Approach

The browser keeps reading Supabase through RLS. New Next API routes (`/api/yt/*`, `/api/push/*`) verify the Supabase token from the header and use the service-role key. A custom worker entry adds a `scheduled` handler (cron 05:00 UTC): YouTube sync → `video_daily` + `weekly_stats` → `alerts()` → push. The rules in `src/lib/rules.ts` are shared by the UI and the cron.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Projects and data model | `projects`, `gates`, `video_daily`, cleaned data | Migrating the `weekly_stats` key |
| 2. Dziś screen | Default screen with alerts and gates | Thresholds need tuning after first data |
| 3. YouTube sync | Per-channel OAuth, daily cron | OAuth in Testing = 7-day tokens; CTR lags 1–2 days |
| 4. PWA push | Morning notification | Web Push library on workerd; iOS only as PWA |
| 5. DistroKid CSV | "Muzyka" tab with revenue | Export format may change |
| 6. Rename | New URL, 301, smoke E2E | Order of steps in the CF and Google dashboards |

**Prerequisites:** a Google Cloud project with an OAuth client ("In production") on smartlife.dev.ai; secrets in Cloudflare (Google, service role, state, VAPID); the branch with the 10x skills merged.
**Estimated effort:** ~6 sessions (one per phase); release 1 (phases 1–3) ~3 sessions.

## Open Risks & Assumptions

- Release 1 by 10-31 is tight; fallback: phases 1–2, and Rafał enters the Studio numbers for the thumbnail template manually.
- The CMV YouTube channel may not exist yet; then CMV gets connected after the channel is created.
- The video id of film #2 has to be filled in manually.
- Alert thresholds (CTR 3%, 20% drop, min. 100 thumbnail impressions) are a proposal to tune.

## Success Criteria (Summary)

- Rafał opens the app in the morning and, without copying from Studio, sees whether Slowfall is heading for the 12-05 gate.
- No task deadline or subscription renewal passes without a notification.
- Music revenue and costs are in one place, per project.
