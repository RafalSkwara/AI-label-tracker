# `roadmap.md` Format Contract

`context/foundation/roadmap.md` is the only artifact in the 10x workflow that no skill creates. Deck step 1 ("update the roadmap with a plain prompt") writes it by hand, but
`/10x-archive` **reads** it mechanically to close the slice a finished change belongs to. That makes the shape below a contract, not a suggestion: if the file drifts from it,
archiving still succeeds but silently skips the roadmap close, and the roadmap slowly desynchronises from reality.

This document is reverse-engineered from `/10x-archive`'s matching logic (`plugins/frontend/skills/10x-archive/SKILL.md`, "Move and stamp" step 5). Anything `/10x-archive` does not
read is free-form — noted as such below.

## What `/10x-archive` actually matches

On archiving change `<change-id>`, it looks for **that exact string** used as a `Change ID` in two places:

1. In the `## At a glance` table — the row whose **Change ID** cell equals `<change-id>` exactly.
2. In the `## Foundations` or `## Slices` bodies — the `### <ID>: …` block containing a `- **Change ID:** <change-id>` line.

`<ID>` is the roadmap-local id: `F-NN` for foundations, `S-NN` for slices. `<Outcome>` is the text of that item's `- **Outcome:**` line, keeping a leading `(foundation) ` if present.

Matching is **exact-string only**. A near-miss is deliberately *not* closed, because one roadmap slice can legitimately spawn several changes — a fuzzy match would close the slice
on the first change that landed.

On a match it applies three independent, best-effort edits, then bumps frontmatter `updated`:

| Target                     | Edit                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `## At a glance` table row | **Status** cell → `done`                                                                                 |
| `### <ID>: …` item body    | `- **Status:**` line → `- **Status:** done`                                                              |
| `## Done` section          | append one bullet (format below)                                                                         |
| frontmatter                | `updated:` → today (`YYYY-MM-DD`); every other key untouched                                             |

Each edit is skipped independently if its target isn't found — a hand-edited roadmap degrades gracefully rather than aborting the archive.

## Required shape

### Frontmatter

`/10x-archive` writes only `updated` and requires nothing else, but it explicitly preserves these keys, so they are the expected set:

```yaml
---
created: 2026-08-14
updated: 2026-08-14
version: 1
status: active
prd_version: "—"
main_goal: One sentence naming the outcome this roadmap exists to reach.
top_blocker: "—"
---
```

### `## At a glance`

A table. The **Change ID** and **Status** columns are load-bearing — the header text must match so the cells can be located. Everything else (`Stream`, `Outcome`, dependency
columns) is free-form and never read.

```markdown
## At a glance

| ID   | Stream   | Outcome                                  | Change ID          | Depends on | Status  |
| ---- | -------- | ---------------------------------------- | ------------------ | ---------- | ------- |
| F-01 | platform | (foundation) Context scaffolding in repo | context-scaffold   | —          | done    |
| S-01 | tasks    | Tasks carry a due date                   | task-due-dates     | F-01       | active  |
| S-02 | tasks    | Overdue tasks surface in the list view   | —                  | S-01       | planned |
```

`Status` values in practice: `planned` → `active` → `done` (plus `blocked` when parked). Only `done` is written by tooling; the rest you set by hand.

A row with `Change ID` of `—` is a slice not yet opened with `/10x-new`. Fill the cell in when you open the change — that is the link that lets `/10x-archive` find it later.

### `## Foundations` and `## Slices`

One `### <ID>: <title>` block per item. `- **Change ID:**`, `- **Outcome:**` and `- **Status:**` are read by `/10x-archive`; `Prerequisites`, `Parallel with` and `Risk` are
explicitly left alone, so treat them as yours.

```markdown
## Foundations

### F-01: Context scaffolding

- **Outcome:** (foundation) `context/{changes,archive,foundation}/` exists so every change has a home.
- **Change ID:** context-scaffold
- **Status:** done
- **Prerequisites:** —
- **Parallel with:** —
- **Risk:** low

## Slices

### S-01: Tasks carry a due date

- **Outcome:** A task can be given a due date, and the date round-trips through save and reload.
- **Change ID:** task-due-dates
- **Status:** active
- **Prerequisites:** F-01
- **Parallel with:** S-03
- **Risk:** medium — touches the task schema, needs a migration.
```

Keep `Outcome` phrased as an **observable end state**, not a task list. "Overdue tasks surface in the list view" is checkable; "add overdue logic" is not. This is the same
oracle-from-outcomes discipline `/10x-test-plan` and `/10x-research` rely on, and it is what makes the `## Done` bullet readable a year later.

### `## Done`

`/10x-archive` appends here, in exactly this format:

```markdown
## Done

- **F-01: (foundation) Context scaffolding in repo** — Archived 2026-08-14 → `context/archive/2026-08-12-context-scaffold/`. Lesson: —.
```

`<ID>: <Outcome>` bolded, then the archive date, then the archive folder path — whose date prefix is the change's **created** date from `change.md`, not the archive date. The
`Lesson: —.` tail is a placeholder you can fill in by hand when `/10x-lesson` captured something from that change.

If the `## Done` heading is missing, `/10x-archive` appends both the heading and the bullet at end of file — so omitting it is safe, just untidy.

## Ordering and dependencies

`Depends on` / `Prerequisites` are documentation, not enforcement — nothing validates them. Their value is that deck step 1 asks the agent to insert a new slice *in dependency
order*, so keep the tables and bodies sorted so that an item never appears above something it depends on. That ordering is the whole reason the roadmap exists rather than a flat
backlog.

## Common ways this breaks

- **`Change ID` left as `—`** after opening the change with `/10x-new`. Archive finds no match and leaves the roadmap untouched. This is the single most common failure.
- **Change ID drift** — the roadmap says `task-due-dates`, the folder is `task-due-date`. Exact-string match, so no close.
- **Status renamed** in the table header (`State` instead of `Status`). The cell can't be located; the table edit is skipped while the body edit still lands, leaving the two
  inconsistent.
- **Item body under a heading other than `## Foundations` / `## Slices`.** The body edit is skipped.
- **A heading's literal text repeated elsewhere in the file** — e.g. a header blockquote that mentions `## Slices` inline. A search for the section then matches the prose before the
  real heading, and edits land in the wrong item. Refer to sections by name (`Slices`), never by their literal `##` form, anywhere outside the heading itself. This one bites tooling
  and agents equally, and it fails *silently* — the edit succeeds, just on the wrong block.

To check before archiving: `grep -n "task-due-dates" context/foundation/roadmap.md` should return two hits — one table row, one `- **Change ID:**` line.
