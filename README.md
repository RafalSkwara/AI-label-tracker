# AI Label Tracker

Tracker of the Wydawnictwo project (AI music YouTube channels): tasks, content pipeline, weekly KPIs, costs, plus XP, levels and badges. Mobile-first PWA.

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

Workers Builds deploys `main`: build command `npx opennextjs-cloudflare build`, deploy command `npx opennextjs-cloudflare deploy`. Manual: `npm run deploy` (needs `wrangler login`).

## Data model

| Table | Notes |
| --- | --- |
| `tasks` | phases F0–F3, `done_at` set by trigger |
| `content_items` | films, EPs, shorts; `live_at` set by trigger, `yt_video_id` for the F2 YouTube sync |
| `weekly_stats` | key `(channel_id, week_start)`, `source` = `manual` or `yt_api` |
| `subscriptions`, `settings` | costs and budget |
| `v_xp_events` | XP per event: task 10, film 50, EP 40, short 15, week 5 |

"Delete" sets `archived_at`; rows are never removed from the app.
