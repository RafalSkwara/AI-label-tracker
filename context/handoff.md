# Handoff — Side Hustle Assistant (2026-10-26)

Read this first in a new session. It lets the orchestrator start Phase 1 without asking anything.

## State

- Change: `context/changes/side-hustle-assistant/` — status `plan_reviewed`.
  - `plan.md` is canonical (phases, success criteria, Progress table, Review decisions).
  - `plan-brief.md` is the one-page summary; `reviews/plan-review.md` holds the review (all findings accepted and applied).
- Nothing is implemented yet. The live app is still "Tracker Wydawnictwa" at https://ai-label-tracker.sidereus.workers.dev (deploys from `main` via Workers Builds).
- Supabase project `gigsqrnwyeioqlkngfqe`. Tasks were updated for the 2026-10-26 strategy (option B) before planning.

## Next step

```
git fetch origin main && git checkout -B feat/sha-phase-1 origin/main
/10x-implement side-hustle-assistant phase 1
```

One PR per phase into `main`. Start each phase from a fresh `origin/main` after the previous PR is merged. Release 1 = phases 1–3, target 2026-10-31.

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
