# Handoff — Side Hustle Assistant (updated 2026-10-29)

Read this first in a new session. It lets the orchestrator pick up the next phase without asking anything.

## State

- Change: `context/changes/side-hustle-assistant/` — status `implementing`.
  - `plan.md` is canonical (phases, success criteria, Progress table, Review decisions).
  - `plan-brief.md` is the one-page summary; `reviews/plan-review.md` holds the review (all findings accepted and applied).
- Phases 1–3 are merged (PRs #5–#7). The YouTube sync runs daily at 05:00 UTC; Slowfall and Contents May Vary are connected; impressions/CTR arrive since 2026-10-28. The app runs at https://ai-label-tracker.sidereus.workers.dev (deploys from `main` via Workers Builds) until Phase 4 is migrated; after that its host is https://side-hustle-assistant.sidereus.workers.dev (worker `side-hustle-assistant`) and the old host is a 301 mini worker (`redirect-worker/`, deployed by hand).
- Phase 4 (rename) is on `claude/sha-phase-4`, reviewed; migration order is in Prerequisites below.
- Open manual checks: 2.4, 2.5, 3.7, 3.8 (Rafał, on the phone). 3.6 is done (both channels connected).
- Phase 7 (traffic sources, search terms, hourly view counter) was added on 2026-10-28 at Rafał's request.
- Supabase project `gigsqrnwyeioqlkngfqe`. Tasks were updated for the 2026-10-26 strategy (option B) before planning.

## Automation run log (2026-11-09)

- `pipeline_runs` (migration `20261109100000_pipeline_runs.sql`): one row per GitHub Actions run of Slowfall-pipeline (`build`, `approve`, `check`), written by `scripts/runlog.py` in that repo with the service-role key. The app shows the last 8 runs at the top of the Pipeline tab and `automation` alerts on Dziś (failed/skipped/hung build, no build for 4 days, build waiting for `/publish`, failed approve/check). If the table is missing, the app shows nothing and keeps working.

## Personal assistant direction (2026-11-10)

Rafał wants the app to grow into a personal assistant (later possibly with AI via his Claude subscription; not built yet).
- Step 1 (branch `claude/project-thread-e1wzmh`): `/` is now a home page with tiles per feature (`src/features/home/tiles.ts`); the dashboard moved to `/dashboard` (tiles deep-link with `?tab=`); YouTube OAuth callback returns to `/dashboard`. A user without the role for a route is sent to `/`.
- Shopping lists (`/zakupy`, `src/features/shopping/`): separate module, private per user (RLS `owner_id = auth.uid()`), open to every user with any role. Soft removal via `archived_at`, undo for removed items. Migration `20261110100000_shopping_lists.sql` (rollback in `supabase/rollback/`), applied by Rafał.
- Sections with `role: null` in `src/shell/sections.ts` are visible to every user with at least one role.

- Barcodes (2026-11-10): scanner in `/zakupy` (native BarcodeDetector, zxing-wasm ponyfill otherwise; `public/zxing_reader.wasm` is a copy from `node_modules/zxing-wasm/dist/reader/`, update it with the package). Lookup `GET /api/products/[code]`: caller's own items → `product_cache` → Open Food Facts → Open Beauty Facts → Open Products Facts (15 reads/min/IP, User-Agent with the channel e-mail, approved by Rafał). Misses are cached 7 days; 429/5xx are not cached. ODbL attribution is shown under the shopping list and on /privacy.

## UI: Kokpit (2026-11-11)

- Gamification removed (levels, XP, badges, streak, `v_xp_events` no longer read; the view stays in the DB).
- Dark-only "Kokpit" theme: tokens in `src/app/globals.css`. Bottom tab bar (`src/shell/AppNav.tsx`, `sections.ts`): Start, Kanały, Zakupy, Zapasy (by role) + "Więcej" sheet (admin, password, privacy, sign out).
- Dashboard "Przegląd" tab (`src/components/Overview.tsx`) per YT channel: alerts, rule-based conclusions (`src/lib/channel.ts` `insights`), 6 metric panels with sparklines (last 8 weeks), 24 h, cost, traffic sources (Shorts is its own group now), search terms, top videos (42 days), gates, publish plan + automation runs, YPP progress.

## Per-user data and sharing (2026-11-11)

- Migration `20261111120000_per_user_data.sql` (rollback in `supabase/rollback/`): every account sees only its own data. Roles stay as module switches (admin, dashboard, zapasy) and no longer grant access to other people's rows.
  - Kanały: `projects.owner_id`; `tasks`, `subscriptions`, `content_items` have their own `owner_id` (project optional); project-bound tables check `owns_project(project_id)`; `settings` is one row per user (key `owner_id`, saved with upsert). `integration_status()` and `/api/yt/connect|sync` are limited to the caller's projects. The daily cron still syncs every integration (service role).
  - Zakupy: lists keep `owner_id`; `shopping_list_shares (list_id, email)` grants read/edit of the list and its items. Only the owner renames, archives and shares; a recipient can leave (removes their own share row). `owner_email` is stamped on insert so recipients see whose list it is.
  - Zapasy: same model with `supply_tab_shares (tab_id, email)`; the "zapasy" role is still needed to open the module. The migration kept existing tabs shared with every current "zapasy" user.
  - Shares match on the e-mail in the JWT, so sharing with an address that has no account yet works once the admin creates it.
- UI: Start shows one square tile per feature (2 columns on a phone). Koszty and Subskrypcje are one tab (`?tab=subskrypcje` redirects to Koszty). Sharing sheet: `src/features/sharing/`.

## Push: subscription renewal reminders (2026-11-11)

- Scope agreed with Rafał: push only for subscription renewals (calendar and receipt-based expenses come later).
- `push_subscriptions` (migration `20261111140000_push_subscriptions.sql`): Worker-only table (RLS on, no grants). `/api/push/subscribe` (POST/DELETE), `/api/push/test`, `/api/push/key`; `public/sw.js` shows the notification and opens `url` on tap.
- Cron `0 7 * * *` (kind `push`, 8:00 in Poland in winter) -> `sendRenewalReminders`: per user, one notification for active subscriptions whose `renew` is 3 days away, tomorrow or today (`src/lib/reminders.ts`). 404/410 or 10 failures archive a subscription.
- Library: `@block65/webcrypto-web-push` 2.x (WebCrypto, aes128gcm, works on workerd and Apple).
- Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generate with `node scripts/gen-vapid.mjs`), `VAPID_SUBJECT` = the app URL. iOS needs the PWA installed to the home screen.

## Calendar (2026-11-11)

- `/kalendarz` (`src/features/calendar/`, date math in `src/lib/calendar.ts`): month grid, the chosen day's events, "Wkrótce" (next 30 days). Every user gets "Mój kalendarz" on the first visit. Calendars are shared by e-mail like shopping lists (`calendar_shares`); only the owner renames, recolours, archives and shares.
- Events: local Polish date/time, all-day when `start_time` is null, repeat none/weekly/monthly/yearly (+ optional end), optional push reminder (`remind_minutes`). Editing or removing a repeating event changes the whole series.
- Dashboard users also see active subscription payments (`renew`) as read-only items.
- Reminders: cron `*/10 * * * *` (kind `reminders`) → `sendCalendarReminders` sends reminders due in the last 30 min to the owner and every account the calendar is shared with (`calendar_recipients`, service role only); `calendar_reminders_sent` prevents duplicates. All-day events are reminded as if they started at 08:00.
- Migration `20261111160000_calendar.sql` (rollback in `supabase/rollback/`).

## Expenses from receipts (2026-11-11)

- `/wydatki` (`src/features/expenses/`), switched with `/zakupy` by the "Listy / Wydatki" control (the Zakupy tab lights up for both). Budgets (`expense_books`) are shared by e-mail like calendars (`expense_book_shares`); every user gets "Domowe" on the first visit.
- New expense: photo → the app shrinks it to a JPEG ≤ 1600 px / 900 KB → `POST /api/receipts/read` → Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`, binding `AI` in `wrangler.jsonc`, JSON schema output with a plain-text fallback) → the user checks shop, date, total, category and lines → save. Or "+ Ręcznie" without a photo. Output validation and list matching: `src/lib/receipt.ts`.
- Link to a shopping list: the list with the most matching unchecked items is suggested; matched items are ticked off and get the receipt price.
- Photos: private Storage bucket `receipts`, path `<book id>/<expense id>.jpg`, access through `receipt_access(name)` (same people as the budget). No delete policy: a photo stays with its soft-removed expense.
- Monthly summary: total, change vs the previous month, categories, top shops.
- `next.config.ts` calls `initOpenNextCloudflareForDev({ remoteBindings: false })`, so `next dev`/`next build` need no Cloudflare login; receipt reading works only on the deployed Worker.
- Migration `20261111180000_expenses.sql` (rollback in `supabase/rollback/`).

## Next step

```
/10x-implement side-hustle-assistant phase 7
```

Order: 7 → 4 (rename) → 5 (push) → 6 (DistroKid CSV). Phase 7 goes first because hourly snapshots only exist from the day they start; push stays after the rename because subscriptions are bound to the origin. One PR per phase into `main`. Start each phase from a fresh `origin/main` after the previous PR is merged.

## Working rules (from Rafał)

- Merges are human-only. Never push to `main`; open a PR and stop.
- Orchestrator plans and delegates; coders implement (Sonnet is fine); reviewers run `/10x-impl-review` (Opus).
- Questions: one decision at a time, options A/B/C, recommended option first with its tradeoff. Non-UI technical choices are the agent's call — record them in `plan.md`, do not ask.
- Chat in Polish, concise. Repo files (code, comments, docs, commits) in English.
- Tests: very sparing. No unit tests. Only the 2 integration tests (`tests/integration/ytMap.test.ts`, the CSV import) and 1 smoke E2E named in the plan. Rafał finds bugs in daily use and asks for fixes.
- No personal data (e-mail addresses) in requests to external services. No secrets in the repo or in memory.
- Supabase via MCP: avoid the word "delete" in `execute_sql` (use `archived_at` soft delete); verify every write with a `SELECT`.
- Rafał tests on a phone only — check the mobile layout.

## Prerequisites for Rafał (blocking Phase 3, not Phase 1)

1. Install the 10x skills at user level (not in the repo):
   `powershell -ExecutionPolicy Bypass -File "$HOME\Desktop\Archive\claude-setup\install.ps1"` → copies to `~\.claude\skills` and `~\.claude\10x-workflow`.
2. Merge PR #4 (this plan).
3. Google Cloud project on smartlife.dev.ai: enable YouTube Data API v3, YouTube Analytics API, YouTube Reporting API; OAuth client (Web) with publishing status **In production** (Testing = 7-day refresh tokens). Redirect URIs: `https://ai-label-tracker.sidereus.workers.dev/api/yt/callback` and `https://side-hustle-assistant.sidereus.workers.dev/api/yt/callback`.
4. Cloudflare Worker secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SECRET_KEY`, `STATE_SECRET`, `CRON_SECRET` (VAPID keys later, Phase 5).
5. Confirm the Workers plan (Free or Paid). Free works: the sync caps at 10 reports per run.
6. Connect Slowfall right after Phase 3 ships (~10-29): the Reporting API backfills only ~30 days.

## Phase 4 migration order (Rafał, in this order)

0. Supabase Auth: add `https://side-hustle-assistant.sidereus.workers.dev/**` to Redirect URLs and set it as Site URL. Google OAuth client: the new callback URI from item 3 above must exist (already listed there). Consent screen: Home page `https://side-hustle-assistant.sidereus.workers.dev/`, Privacy policy `https://side-hustle-assistant.sidereus.workers.dev/privacy`.
1. Cloudflare dashboard: rename worker `ai-label-tracker` → `side-hustle-assistant` (secrets and crons move with it); point Workers Builds at the new name. Do not trigger a build of `main` until step 2.
2. Merge the Phase 4 PR (new `name` in `wrangler.jsonc`).
3. Deploy the redirect worker: `npx wrangler deploy -c redirect-worker/wrangler.jsonc` (old host → 301, path and query kept). Until then the old URL is dead.
4. On the phone: remove the old PWA, install from the new URL, log in again (session and storage are per origin). Existing YouTube connections keep working (tokens are server-side).
