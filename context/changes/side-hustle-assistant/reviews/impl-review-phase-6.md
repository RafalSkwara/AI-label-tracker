<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Side Hustle Assistant

- **Plan**: context/changes/side-hustle-assistant/plan.md
- **Scope**: Phase 6 of 7 (DistroKid CSV import), PR #10, `git diff origin/main...origin/claude/sha-phase-6` (de90339, 3cd07fe)
- **Reviewed phases**: 6
- **Date**: 2026-10-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## What was checked

- **Migration vs live schema** (read-only catalog queries on `gigsqrnwyeioqlkngfqe`): `royalties` and `v_royalties_month` do not exist yet, so there is no name clash. `projects.id` is `uuid`, `public.is_owner()` exists, the last applied migration is `traffic_and_snapshots`. The migration only creates objects (table, index, view, policy, grants) and alters nothing that exists. **It is safe to apply before the merge**; the live app does not read the new objects until the Muzyka tab is opened.
- **RLS and grants**: RLS on, `owner_all` with `(select public.is_owner())` in both `using` and `with check`, same as `gates` and `video_daily` in `20261026120000_projects.sql:124-127`. `anon` gets nothing. Granting `delete` to `authenticated` matches those tables and is guarded by `owner_all`. It is also the only way to undo a bad import without the secret key. Fine. The view has `security_invoker = true`, so the table RLS applies, and `authenticated` gets `select` only. Fine.
- **Insert path**: `upsert(..., { onConflict: "import_hash", ignoreDuplicates: true }).select("id")` becomes `INSERT ... ON CONFLICT (import_hash) DO NOTHING RETURNING id`. Postgres returns only the rows it really inserted, so "Zaimportowano N" and "Już w bazie" are correct. There are no same-batch hash collisions, because of the occurrence number. Even if there were, `DO NOTHING`, unlike `DO UPDATE`, would not fail on them.
- **Hash and cumulative exports**: the key holds every content column plus the raw Reporting Date, and an occurrence number counts only among byte-identical keys. Identical lines cannot be told apart, so their order does not matter. A later cumulative export that contains an earlier one gives the same hashes for the old rows and new hashes only for the new rows: no duplicates and no missed rows. Remapping an artist later (Elektronika) imports its rows then, because the hash leaves out `project_id`. The one weak spot is F5.
- **Parser probes** (a temporary vitest file, since removed): `money("0,123") = 123`, `money("1,050") = 1050`, `money("1,234") = 1234`, `money("0,4821") = 0.4821`, `money("1 234,56") = null`. For a semicolon file `Sale Month;Artist;Earnings (USD);Quantity` with a row `2026-09;A;0,482;1`, earnings came out as **482**. See F1.
- **UI**: the tab strip scrolls (`nav.tabs{overflow-x:auto}`), so a 6th tab fits at 390 px. Summary rows use `minmax(0,1fr) auto` and titles wrap with `overflow-wrap:anywhere`. All strings are in Polish. PLN is `usd × settings.usd_pln` (3.7 live). Top 5 tracks per month, ranked by USD. `loadLines` pages with a deterministic order (month, project, title is unique per view row).
- **Automated checks re-run**: `npm run test:int` passed (16/16, 8 of them DistroKid). `npm run typecheck` passed. `npm run lint` showed 0 errors and 1 warning, which already existed in `open-next.config.ts`. `npm run build` was not re-run here; CI covers it.

## Findings

### F1 — A decimal comma with exactly three decimals is read as thousands (×1000)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/distrokid.ts:118-119 (`money`), reused for Quantity at :140
- **Detail**: The plan says amounts accept `0,5` and that the delimiter may be a semicolon, which is how Polish Excel saves a CSV. But the thousands rule `^-?\d{1,3}(,\d{3})+(\.\d+)?$` runs first, so any decimal comma with exactly three digits becomes an integer. Confirmed: `0,123 → 123`, `1,050 → 1050`, and a `;` file with `0,482` stores **$482**. Nothing warns, and dedupe protects the bad rows: re-importing a fixed file adds nothing, so the cleanup is a manual delete. `1 234,56` and `1.234,56` are rejected and counted as invalid, which is acceptable.
- **Fix**: Choose the decimal convention once per file and pass it to `money`. If the delimiter is `;`, treat `,` as the decimal mark and drop spaces and `.` as thousands separators. Otherwise treat `,` as thousands, and only in valid groups (`^-?[1-9]\d{0,2}(,\d{3})+`, so `0,123` is never thousands). Add tests: `0,482` in a `;` file, `0,123`, and `1,234.56` in a `,` file.
  - Strength: Removes the only ambiguity that silently corrupts money. DistroKid's own export, with dot decimals, is unaffected.
  - Tradeoff: A comma-delimited file with decimal commas becomes "invalid" rather than guessed. That is safe, because it is visible.
  - Confidence: HIGH — reproduced with the real function.
  - Blind spot: No real export has been seen yet (manual row 6.6).
- **Decision**: Applied. Decimal mark decided once per file: `;`-delimited files use `,` as decimal (`.` and spaces are thousands only in real groups), other files use `.` and accept `,` only as real thousands groups; a decimal comma in a comma-delimited file is counted invalid. Same for Quantity. Tests added.

### F2 — 6.1 is ticked although the migration is not applied

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/side-hustle-assistant/plan.md:626
- **Detail**: `- [x] 6.1 Royalties migration applies cleanly — de90339 — written, not applied`. The Phase 7 review (F9) settled that the migration row stays open until it is applied, and the live catalog confirms `royalties` does not exist. As ticked, `/10x-status` reports Phase 6 automated as complete.
- **Fix**: Untick 6.1 and tick it with the migration version once it has been applied.
- **Decision**: Applied. 6.1 was unticked until the migration was applied; ticked after the orchestrator applied it on 2026-10-28.

### F3 — The file picker's `accept` may grey out the export on a phone

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/RoyaltiesPanel.tsx:83
- **Detail**: `accept=".csv,.tsv,text/csv"`. Mobile pickers filter by MIME type. Android Chrome maps `.tsv` to `text/tab-separated-values`, and both Android and iOS may report a downloaded export as `text/plain` or `application/octet-stream`. In those cases the file shows up greyed out and Rafał cannot pick it. This app is tested only on a phone, and manual row 6.6 depends on this picker.
- **Fix**: Use `accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"`, or drop `accept`: the parser already rejects wrong files with "Brakuje kolumn".
- **Decision**: Applied. accept is now .csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain.

### F4 — A partial failure reports "Nie zaimportowano" after earlier batches were stored

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/RoyaltiesPanel.tsx:24-33, 68
- **Detail**: Each batch of 500 commits on its own. If batch 3 fails, batches 1-2 are already stored, but the message says nothing was imported, the summary is discarded and `refresh()` is skipped, so the totals on screen are stale. Re-importing is idempotent, so no data is lost.
- **Fix**: Return or keep the running `added` when an error happens. Flash "Zaimportowano X, potem błąd: … Wczytaj plik ponownie" and call `refresh()` in a `finally`.
- **Decision**: Applied. Rows stored before a failing batch are reported ("Zaimportowano X, potem błąd"), the view is refreshed in finally.

### F5 — The hash uses the raw Reporting Date text, so a re-saved file imports everything again

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/distrokid.ts:145
- **Detail**: The key holds `get(r, "reporting")` unparsed, while the month, amounts and quantity are normalised. If the export passes through Excel or Numbers on the phone, `2026-10-14` can become `14.10.2026`, every hash changes, and the whole history is inserted a second time, doubling all totals.
- **Fix**: Normalise Reporting Date to `YYYY-MM-DD` before building the key, and keep the raw text only if the date cannot be parsed. Do it before the first real import, because changing the key afterwards changes every hash.
- **Decision**: Applied. Reporting Date normalised to YYYY-MM-DD in the hash key; unparseable text kept as is. No real rows exist yet, so no hash migration.

### F6 — A space before an opening quote breaks the row

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/distrokid.ts:88
- **Detail**: Quoting starts only when `field === ""`, so `A, "x, y",0.1` splits the title and shifts the columns. Probe result: `{"rows":[],"invalid":1}`. The row is counted as unreadable rather than stored wrong, so this is low risk.
- **Fix**: Start quoting when `field.trim() === ""`, and reset `field` at that point.
- **Decision**: Applied. A quote opens a field when the text before it is blank.

### F7 — "streamów" for every number, and Quantity includes downloads

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/RoyaltiesPanel.tsx:121, 128
- **Detail**: The labels read "1 streamów" and "2 streamów", which is wrong Polish (the forms are stream, streamy, streamów). DistroKid's Quantity also counts downloads. Separately, when `usd_pln` is unset (`rate` at :48), PLN silently shows 0,00 zł; the live value is 3.7.
- **Fix**: Use a plural helper (`stream/streamy/streamów`) or the neutral "odtw." label.
- **Decision**: Applied. Plural helper (odtworzenie/odtworzenia/odtworzeń); PLN shows a dash and the header says the rate is missing when usd_pln is not set.

### F8 — The tests do not cover the risky cases

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/integration/distrokid.test.ts
- **Detail**: The suite is meaningful: real-shape fixture, quotes and commas, a repeated line, unknown artist, TSV/BOM/CRLF, totals, idempotent re-import. It misses three cases that decide correctness in practice: (a) a cumulative export, where an older file is a subset of a newer one and only the new rows' hashes differ; (b) decimal commas with three digits and `;` files (F1); (c) occurrence numbering when the identical lines are not adjacent.
- **Fix**: Add these three cases, for example by appending new lines to the fixture and asserting that only those lines get new hashes.
- **Decision**: Applied. Added tests: cumulative export, semicolon file with three-decimal commas, identical non-adjacent lines, re-saved date format with a space before a quote.

## Ordering

- **Before the migration is applied**: nothing. The migration is strictly additive and matches the live schema and the existing RLS and grant pattern. It can be applied now.
- **Before merge**: F1 and F2. F3 and F5 are strongly recommended before the first real import (manual row 6.6), because F5 cannot be fixed cheaply once real rows are stored.
- **Can follow**: F4, F6, F7, F8.
