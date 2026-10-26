# 10x workflow — local layer

The 10x delivery workflow ships as `frontend-skills@skills-library` (11 skills). This folder holds the pieces that live outside it: the `roadmap.md` format contract that no skill
owns, and the ready-to-paste prompt for the one workflow step that is deliberately *not* a skill.

Three skills were authored locally to close gaps in the shipped set — `/10x-plan-review`, `/10x-test-plan`, `/10x-tdd` — and live in `.claude/skills/`.

## The loop

```
                     ┌─ /10x-research ──┐        ┌─ /10x-plan-review ─┐
                     │  (build oracle)  │        │  (will it work?)   │
                     ▼                  ▼        ▼                    ▼
roadmap prompt → /10x-new → … → /10x-plan → … → /10x-implement → /10x-impl-review → /10x-archive
                                                      ▲                    │
                                                 /10x-tdd            /10x-lesson
                                              (test-first phases)   (recurring rule)
```

| Step                | Skill                | Writes                                       |
| ------------------- | -------------------- | -------------------------------------------- |
| 0. scaffold (once)  | `/10x-init`          | `context/{changes,archive,foundation}/`      |
| 1. roadmap          | *plain prompt*       | `context/foundation/roadmap.md`              |
| 2. open the change  | `/10x-new`           | `context/changes/<id>/change.md`             |
| 2b. oracle          | `/10x-research`      | `research.md`                                |
| 2c. challenge framing | `/10x-frame`       | `frame.md`                                   |
| 3. plan             | `/10x-plan`          | `plan.md` (+ `## Progress`), `plan-brief.md` |
| 3b. vet the plan    | `/10x-plan-review`   | `reviews/plan-review.md`                     |
| 4. build            | `/10x-implement`     | code, `## Progress`, one commit per phase    |
| 4-alt. build test-first | `/10x-tdd`       | tests + code, same `## Progress`             |
| 5. review           | `/10x-impl-review`   | `reviews/impl-review.md`                     |
| 5b. capture a rule  | `/10x-lesson`        | `context/foundation/lessons.md`              |
| 6. close            | `/10x-archive`       | `context/archive/<created>-<id>/`            |

Test strategy is a side track: `/10x-test-plan` writes `context/foundation/test-plan.md` once per project, then its phases run through the normal `new → research → plan →
tdd/implement` chain.

## Step 1: the roadmap prompt

Deck step 1 is the only step with no skill, by design — vague ideas need a conversation, not a form. Paste something like this, with as much detail as you have:

> Add a slice to `context/foundation/roadmap.md`: I want tasks to carry a due date, so overdue work surfaces instead of rotting in the list. It touches the task schema and the list
> view, and it should land before any notification work. Respect the file's existing rules and semantics — At a glance, Streams, dependency ordering, Status values — and insert it in
> dependency order. Follow the format contract in @.claude/10x-workflow/roadmap-format.md.

The `@`-reference matters: `/10x-archive` closes roadmap slices by exact-string matching on `Change ID`, so a roadmap that drifts from the contract archives cleanly but silently
stops tracking. See [roadmap-format.md](roadmap-format.md) for the mechanics and the four common ways it breaks.

No roadmap yet? Copy [roadmap-template.md](roadmap-template.md) to `context/foundation/roadmap.md` and fill it in.

**The one thing to remember:** when you open a change with `/10x-new`, go back and put the change-id into the slice's `Change ID` cell and `- **Change ID:**` line. That link is what
lets step 6 close the loop.

## State lives in two files, nowhere else

- `context/changes/<id>/change.md` frontmatter `status` — the lifecycle: `new → preparing → planned → plan_reviewed → implementing → implemented → impl_reviewed → archived`.
- `plan.md`'s `## Progress` section — execution state. Only `/10x-implement` and `/10x-tdd` write it; everything else reads it.

No sidecar, no JSON, no HTML markers. If you want to know where a change stands, read those two.
