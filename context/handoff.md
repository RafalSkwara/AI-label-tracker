# Handoff — Side Hustle Assistant (updated 2026-10-28)

Read this first in a new session. It lets the orchestrator pick up the next phase without asking anything.

## State

- Change: `context/changes/side-hustle-assistant/` — status `implementing`.
  - `plan.md` is canonical (phases, success criteria, Progress table, Review decisions).
  - `plan-brief.md` is the one-page summary; `reviews/plan-review.md` holds the review (all findings accepted and applied).
- Phases 1–3 are merged (PRs #5–#7). The YouTube sync runs daily at 05:00 UTC; Slowfall and Contents May Vary are connected; impressions/CTR arrive since 2026-10-28. The app runs at https://ai-label-tracker.sidereus.workers.dev (deploys from `main` via Workers Builds).
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
