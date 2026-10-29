# Side Hustle Assistant

Personal assistant and dashboard for side-hustle projects (AI music YouTube channels and artists): rule-based alerts, YouTube sync, tasks, content pipeline, weekly KPIs, costs, plus XP, levels and badges. Mobile-first PWA, served at `https://side-hustle-assistant.sidereus.workers.dev`.

- Next.js 16 (App Router, client-rendered) on Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare)
- Supabase (project `gigsqrnwyeioqlkngfqe`): Postgres + Auth. Every table has RLS; only emails listed in `public.app_owners` can read or write.
- Login: email + password (works without SMTP and inside the installed PWA); magic link as a fallback. Create the user in Supabase → Authentication → Users → Add user, with Auto Confirm.

## Develop

```bash
npm install
npm run dev        # Next dev server
npm run preview    # build for Workers and run locally in workerd
```

`NEXT_PUBLIC_SUPABASE_*` live in `.env.production` / `.env.development`. They are public by design; access is enforced by RLS.

## Deploy

`npm run build` produces the Workers bundle (`.open-next/`), so Workers Builds works with its defaults (`npm run build`, then `npx wrangler deploy` / `npx wrangler versions upload`). `npm run build:next` is the plain Next build. Manual deploy: `npm run deploy` (needs `wrangler login`).

## Old URL redirect

`redirect-worker/` is a separate mini worker named `ai-label-tracker` that answers 301 to the new host, keeping path and query. It is deployed by hand, not by Workers Builds: `npx wrangler deploy -c redirect-worker/wrangler.jsonc`. It is excluded from the app tsconfig; the main worker has no redirect logic (its cron calls itself on the fake host `cron.internal`).

## E2E smoke test

One Playwright test (`tests/e2e/smoke.spec.ts`), run manually and not in CI. It needs the owner's credentials in the environment and a running app:

```bash
E2E_EMAIL=... E2E_PASSWORD=... npx playwright test   # E2E_BASE_URL defaults to http://localhost:8787 (npm run preview)
```

It uses an already installed Chrome/Chromium (`E2E_CHROMIUM` overrides the path); do not run `playwright install`.

## Data model

| Table | Notes |
| --- | --- |
| `tasks` | phases F0–F3, `done_at` set by trigger |
| `content_items` | films, EPs, shorts; `live_at` set by trigger, `yt_video_id` for the F2 YouTube sync |
| `weekly_stats` | key `(channel_id, week_start)`, `source` = `manual` or `yt_api` |
| `subscriptions`, `settings` | costs and budget |
| `v_xp_events` | XP per event: task 10, film 50, EP 40, short 15, week 5 |

"Delete" sets `archived_at`; rows are never removed from the app.
