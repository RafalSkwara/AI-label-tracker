---
name: 10x
description: >
  Drive a whole change through the 10x delivery loop from a single request — choose the entry point, then run
  /10x-new → [/10x-frame | /10x-research] → /10x-plan → /10x-plan-review → /10x-tdd or /10x-implement →
  /10x-impl-review → [/10x-lesson] → /10x-archive, keeping the plan-review step that /10x-plan routes around,
  and stopping at the three gates that belong to the human. Use whenever the request is tagged "10x", or the
  user says "use the 10x workflow", "10x this", "run the full loop", "the whole 10x chain", "zrób to przez 10x",
  "użyj workflow 10x" — and in any repo whose CLAUDE.md says work runs through the 10x workflow. Not for running
  one step: invoke that skill directly (/10x-plan, /10x-implement, /10x-impl-review, ...). Not for authoring a
  roadmap slice or a test strategy — those are the roadmap prompt and /10x-test-plan.
argument-hint: <what you want built, in your own words>
---

# 10x — the driver

One request in, one archived change out. This skill owns **sequence and gates**. It owns no analysis of its own:
every artifact is written by the step skill that owns it. Your job here is to route, to hold the chain together
where the shipped skills drop it, and to stop where a human decision is required.

## Prime directive

**Never edit product code straight from the request.** A change folder exists before the first line changes. If
the user's request is genuinely a one-line typo fix and they push back on the ceremony, say so in one sentence
and do it — but the default is the loop.

## Step 0 — preflight (silent, no questions)

Run these before routing:

1. **Repo root.** Resolve it; every path below is relative to it.
2. **`context/` exists?** If not, invoke `/10x-init` first. It is idempotent.
3. **Open changes?** `ls context/changes/`. If a change already covers this request, resume it instead of
   opening a second — read its `change.md` `status:` and `plan.md`'s `## Progress`, then re-enter the chain at
   the matching step. Announce that you are resuming, with the slug.
4. **Lessons.** If `context/foundation/lessons.md` exists, it is a prior for every downstream step. Do not
   summarize it at the user — the step skills read it themselves.
5. **Roadmap.** If `context/foundation/roadmap.md` exists, look for a slice matching the request. If one exists,
   its `Change ID` cell must receive the slug in step 2. This is the single most common failure in the loop.

## Step 1 — route

Pick the entry point from the request's *shape*, not from its size. Say which route you picked and why, in one
line, then proceed without asking permission.

| The request looks like | Route |
| --- | --- |
| An observation **plus** a suspected cause ("X is broken, I think it's Y") | `/10x-frame` first — it tests whether the observation and the cause are the same thing |
| A scope or design question ("should we even…", "is this the right…") | `/10x-frame` first |
| A feature in an area you have not read, or with real domain rules | keep `/10x-research` — it builds the oracle from sources, not from the current implementation |
| A feature in familiar code, clear outcome | `/10x-new → /10x-plan` — research optional |
| Small and obvious (a copy change, a flag, a rename) | `/10x-new → /10x-plan → /10x-plan-review → /10x-implement → /10x-archive` |
| "We have no idea what to test here" | `/10x-test-plan` first — its phases then run through the normal chain |
| Several changes' worth of work | Stop. Write the roadmap slice first (that is a plain prompt, not a skill), then open the first change |

## Step 2 — the chain

```
/10x-new <slug>
  → [/10x-frame]            when the framing is in doubt
  → [/10x-research]         when the oracle is not in your head
  → /10x-plan
  → /10x-plan-review        ← the step the shipped chain skips. Never skip it.
  → /10x-tdd per phase      ← falls back to /10x-implement when the TDD gate says no
  → /10x-impl-review
  → [/10x-lesson]           whenever a finding generalizes
  → /10x-archive
```

**Slug**: kebab-case, names the outcome, not the ticket — `due-dates`, `oauth-login`, `fix-overdue-sort`. It
lands in every commit subject. Derive it from the goal; only ask if the request is too vague to name.

**The handoff you must ignore**: `/10x-plan` ends by chaining to `/10x-implement` and copying
`/10x-implement <change-id> phase 1` to the clipboard. It predates `/10x-plan-review` and `/10x-tdd`. Do not
take that handoff. Go to `/10x-plan-review`.

**After `/10x-new`, before anything else**: if a roadmap slice exists, write the slug into its `Change ID` cell
**and** its `- **Change ID:**` line. `/10x-archive` closes slices by exact-string match — a `—` in that cell
archives cleanly and silently tracks nothing. Verify with:

```bash
grep -n "<slug>" context/foundation/roadmap.md   # expect exactly two hits
```

## Step 3 — the gates

Three places the loop stops and the human decides. Never answer these yourself, never infer the answer from
context, never batch them to "get through the phase".

1. **Planning questions** (`/10x-plan`). Real trade-off questions with your recommendation attached. This is the
   highest-leverage step in the whole loop — the plan is what every downstream review is measured against.
2. **Plan-review verdict** (`/10x-plan-review`). Surface it verbatim and stop:
   - **APPROVED** → build.
   - **NEEDS ATTENTION** → triage findings; fixes land in `plan.md` **before** any code.
   - **REJECTED** → the premise is broken. Re-run `/10x-plan`. Do not push through — that is the entire point of
     the step.
3. **Per phase**: the manual verification checks from the plan, then the commit. List the checks, pause, do not
   self-certify them. One Conventional-Commits message per phase, offered as approve / edit subject / override.

## Step 4 — build, one phase at a time

Default to `/10x-tdd`. Take its gate seriously: it hands the phase back to `/10x-implement` when test-first
would be theatre — scaffolding, config, dependency bumps, pure styling, anything whose test cannot go red in
seconds. A test asserting that the config is the config is worse than no test.

Both skills write `## Progress` identically and produce the same commit shape, so phases interleave freely.

**Context budget.** After each phase, offer to clear and hand over the resume command:

```
/10x-implement <slug> phase 3
```

On a long change, recommend taking it — state lives in files, not in the conversation.

## Step 5 — close

- `/10x-impl-review` → triage each finding: fix / skip / record.
- Anything that generalizes beyond this change → `/10x-lesson`. Use it more than feels necessary; it is the only
  part of the workflow that compounds — every rule recorded shapes every future frame, research, plan, review
  and implementation.
- `/10x-archive`. It refuses on uncommitted files inside the change folder — commit them first. A warning about
  a phase with no SHA is informational: that phase was manual-only or a no-op.

## State — two files, nothing else

- `context/changes/<slug>/change.md` frontmatter `status`:
  `new → preparing → planned → plan_reviewed → implementing → implemented → impl_reviewed → archived`
- `plan.md`'s `## Progress`: execution state. `- [ ]` pending, `- [x] 1.2 title — a1b2c3d` done. **Only**
  `/10x-implement` and `/10x-tdd` write it; everything else reads it.

If the two disagree: `## Progress` is the truth for execution, `change.md` for lifecycle. Fix the status by hand
and say that you did.

## Do not

- Do not skip `/10x-plan-review`, however obvious the plan looks.
- Do not answer the planning questions on the user's behalf, or accept "whatever you think" without offering a
  recommendation to react to.
- Do not mark manual verification checks as passed. You cannot run them; that is why they are manual.
- Do not run several phases without stopping.
- Do not re-derive what a step skill already wrote — read `research.md`, `plan.md`, the reviews.
- Do not touch a folder under `context/archive/`. Archived is read-only by convention; open a new change.
- Do not re-implement any step skill's work inline. If a step is unavailable, say so and stop.

## Reference

- Loop, state model, roadmap prompt: `.claude/10x-workflow/README.md`
- Roadmap contract and its four failure modes: `.claude/10x-workflow/roadmap-format.md`
- Full guide: `~/Desktop/10x-workflow-guide.md`
