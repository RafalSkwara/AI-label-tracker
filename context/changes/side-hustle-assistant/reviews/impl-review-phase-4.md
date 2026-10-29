<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Side Hustle Assistant

- **Plan**: context/changes/side-hustle-assistant/plan.md
- **Scope**: Phase 4 of 7 (rename to Side Hustle Assistant), branch `claude/sha-phase-4`, `git diff origin/main...a538830`
- **Reviewed phases**: 4
- **Date**: 2026-10-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## What was checked

- **Plan vs diff**: all planned files changed as described. They are `manifest.ts`, `layout.tsx` (name "Side Hustle Assistant", short name "Side Hustle", new Polish description), `Tracker.tsx` (header), `package.json` `name`, `README.md`, `wrangler.jsonc` `name: "side-hustle-assistant"`, `redirect-worker/{index.ts,wrangler.jsonc}` (worker `ai-label-tracker`), `tests/e2e/smoke.spec.ts`, `playwright.config.ts`, and the `@playwright/test` dev dependency. Two files changed outside the plan, both benign: `Login.tsx` (the `<h1>` name) and `tsconfig.json` (excludes `redirect-worker`).
- **Redirect worker**: the response is `Response.redirect(NEW_ORIGIN + pathname + search, 301)`. Runtime probe: `/privacy?tab=dzis&yt=ok` returned `301 https://side-hustle-assistant.sidereus.workers.dev/privacy?tab=dzis&yt=ok`, so path and query are kept. `wrangler deploy -c redirect-worker/wrangler.jsonc --dry-run` passed (0.33 KiB, no bindings, no crons). The worker also passed `tsc --strict` run on its own.
- **No redirect in the main worker**: `worker.ts` is unchanged and only calls `openNext.fetch`. Its cron still builds `https://cron.internal/api/cron`. There is no middleware and no host check anywhere in `src/`.
- **Old host in app code**: the only `ai-label-tracker` strings are in `redirect-worker/*` and `README.md`, which is intended. The OAuth callback is built from the request origin (`redirectUri(origin)` in `src/lib/server/google.ts:28`, from `new URL(req.url).origin` in `api/yt/connect` and `api/yt/callback`). The magic link uses `emailRedirectTo: location.origin`. Nothing is hardcoded.
- **Privacy page**: `src/app/privacy/page.tsx` exists. It is static (`○ /privacy` in the build) and has no auth gate. It does not contain the app name, so the rename does not affect it. The old `/privacy` URL 301s to the new one once the mini worker is deployed. The Google consent screen links themselves were not in the plan contract (see F1).
- **Header at 390 px** (static check, no session available): the line lists the names of the `aktywny` projects joined by ` · `, with `Projekty` as the fallback while loading. `header.top` is `flex-wrap` and the text is normal text with spaces, so the first flex item shrinks to the row width and wraps by word. No `nowrap` is involved and there is no overflow.
- **E2E isolation**: `test:int` is `vitest run tests/integration`, so `tests/e2e` is never collected. CI runs typecheck, lint, test:int and build only, with no Playwright step. The E2E files are still type-checked and linted, which is fine. `npx playwright test --list` finds 1 test. Credentials come from env only and the test skips without them. No credentials are in the repo. `@playwright/test` does not download browsers on install.
- **Automated checks re-run** (after the fixes): `npm run typecheck` passed. `npm run lint` showed 0 errors and 1 warning that already existed (`open-next.config.ts`). `npm run test:int` passed 20/20. `npm run build` passed (OpenNext build complete, `/privacy` static).
- **Google OAuth redirect URIs**: the new host needs `https://side-hustle-assistant.sidereus.workers.dev/api/yt/callback`. Keep `https://ai-label-tracker.sidereus.workers.dev/api/yt/callback` until the old host is only a redirect. `context/handoff.md` (Prerequisites item 3) says both were registered as part of Phase 3. Rafał should confirm this in Google Cloud in step 0. Supabase needs `https://side-hustle-assistant.sidereus.workers.dev/**` in Redirect URLs and as Site URL.
- **change.md**: left at `status: implementing`, the same as the earlier phase reviews, because phases 2, 3, 5 and 7 are still open. Only `updated` was refreshed.

## Findings

### F1 — Migration contract misses the OAuth consent screen links

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/side-hustle-assistant/plan.md:257
- **Detail**: Step (0) covers Supabase URLs and the Google redirect URI. It does not cover the consent screen branding, whose Home page and Privacy policy links (`/privacy`, added in Phase 3 for this purpose) point at the old host. Those links break between steps 1 and 3. After that they rely on a 301, which can trip Google's branding check.
- **Fix**: Add "point the consent screen Home page and Privacy policy at the new host" to step (0) in the plan and to the handoff migration order.
- **Decision**: FIXED: plan contract step (0) amended, and a "Phase 4 migration order" section was added to `context/handoff.md`.

### F2 — Old host is dead between the dashboard rename and the redirect deploy

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/changes/side-hustle-assistant/plan.md:257 (steps 1–3)
- **Detail**: After step 1 the name `ai-label-tracker` is free, so the old URL returns nothing until step 3 deploys the mini worker. If Workers Builds builds `main` while the config still says `ai-label-tracker`, the build either fails on the name mismatch or recreates a worker under the old name. Step 3 then overwrites that worker, so nothing is lost. For a single user this does no harm, as long as steps 1–3 run back to back.
- **Fix**: Record in the handoff: do not trigger a `main` build between steps 1 and 2, and run step 3 right after the merge.
- **Decision**: FIXED: written into the handoff migration order.

### F3 — Playwright output directories not ignored

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .gitignore
- **Detail**: `npx playwright test` writes `test-results/`, and could write `playwright-report/`, in the repo root. These are untracked and not ignored. A later run with traces or screenshots turned on would store artifacts of the owner's logged-in session that could be committed by accident.
- **Fix**: Ignore `/test-results/`, `/playwright-report/` and `/blob-report/`.
- **Decision**: FIXED.

### F4 — Smoke E2E (4.1) not run

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/e2e/smoke.spec.ts
- **Detail**: The test needs the owner's credentials and a running `npm run preview`, and neither is available to the agent. Row 4.1 is correctly left `[ ]`. The selectors were checked by hand against the source: the `E-mail`/`Hasło` labels and the `Zaloguj` button (exact match, distinct from "Zaloguj linkiem z maila") in `Login.tsx`, password mode as the default, the h1, the `Dziś` h2, and `aria-label="Alerty"`/`"Bramki"` in `Today.tsx`. Manual rows 4.5 and 4.6 are pending, which is expected.
- **Fix**: Rafał runs `E2E_EMAIL=… E2E_PASSWORD=… npx playwright test` against `npm run preview` before the merge, or against the new URL after the migration.
- **Decision**: PENDING (owner action).

### F5 — Progress rows lacked the commit sha; redirect worker is outside every typecheck

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: plan.md Progress 4.2–4.4; tsconfig.json `exclude`
- **Detail**: The Progress convention asks for ` — <sha>` on landed steps, and 4.2–4.4 had none. Separately, `redirect-worker` is excluded from the app tsconfig, so CI never type-checks it. That is acceptable for 13 lines. It was verified once by hand here (strict `tsc`, wrangler dry-run, runtime probe).
- **Fix**: Append `a538830` to 4.2–4.4. Leave the worker excluded.
- **Decision**: FIXED (sha appended). Worker exclusion accepted.
