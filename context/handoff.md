# Handoff — Side Hustle Assistant (updated 2026-10-29)

Read this first in a new session. It lets the orchestrator pick up the next phase without asking anything.

## State

- Change: `context/changes/side-hustle-assistant/` — status `implementing`.
  - `plan.md` is canonical (phases, success criteria, Progress table, Review decisions).
  - `plan-brief.md` is the one-page summary; `reviews/plan-review.md` holds the review (all findings accepted and applied).
- Phases 1–3 are merged (PRs #5–#7). The YouTube sync runs daily at 05:00 UTC; Slowfall and Contents May Vary are connected; impressions/CTR arrive since 2026-10-28. The app runs at https://ai-label-tracker.sidereus.workers.dev (deploys from `main` via Workers Builds) until Phase 4 is migrated; after that its host is https://side-hustle-assistant.sidereus.workers.dev (worker `side-hustle-assistant`) and the old host is a 301 mini worker (`redirect-worker/`, deployed by hand).
- Phase 4 (rename) is live at `https://side-hustle-assistant.sidereus.workers.dev` (PR #11); the old host is the `ai-label-tracker` redirect worker. Open: 4.1 smoke E2E (manual).
- Open manual checks: 2.4, 2.5, 3.7, 3.8 (Rafał, on the phone). 3.6 is done (both channels connected).
- Phase 7 (traffic sources, search terms, hourly view counter) was added on 2026-10-28 at Rafał's request.
- Supabase project `gigsqrnwyeioqlkngfqe`. Tasks were updated for the 2026-10-26 strategy (option B) before planning.

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

**What actually happened (2026-10-29):** renaming a worker that has static assets in the Cloudflare dashboard broke every later deploy (`assets-upload-session` returns 500, code 10013, in Workers Builds and local wrangler). Fix: remove the renamed worker, run `npx opennextjs-cloudflare deploy` to create it fresh (crons come from `wrangler.jsonc`), re-add the 5 runtime secrets (Production, Type Secret), reconnect Workers Builds. Never rename a worker with assets; create a new one instead.
