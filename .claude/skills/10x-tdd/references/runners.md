# Test Runner Detection

`/10x-tdd` needs three commands for whatever stack it lands in: **run one test**, **run the whole suite**, and (optionally) **run mutation testing**. Detect them from repo markers —
never assume a stack, and never assume a script name exists just because the runner does.

## Detection order

Check markers in this order and stop at the first hit. A monorepo can hit several — in that case detect per package, using the nearest manifest above the file under test.

| Marker                              | Family      | Then read                                                       |
| ----------------------------------- | ----------- | --------------------------------------------------------------- |
| `package.json`                      | JS/TS       | `devDependencies` + `scripts`                                   |
| `pom.xml`                           | Maven/JVM   | `<dependencies>` for the JUnit/TestNG artifact                  |
| `build.gradle` / `build.gradle.kts` | Gradle/JVM  | `dependencies` block, `test` task config                        |
| `pyproject.toml` / `pytest.ini` / `setup.cfg` | Python | `[tool.pytest]` / `[tool.poetry.group.dev]`             |
| `Cargo.toml`                        | Rust        | built-in                                                        |
| `go.mod`                            | Go          | built-in                                                        |
| `*.csproj` / `*.sln`                | .NET        | `PackageReference` for xunit/nunit/mstest                       |

**Always prefer the repo's own script over the raw binary.** If `package.json` has `"test": "vitest run"`, use `npm run test` — it carries flags, env and setup files the raw command
misses. Drop to the raw binary only when no script matches.

## JS/TS

| Dependency         | Single test                                        | Full suite            |
| ------------------ | -------------------------------------------------- | --------------------- |
| `vitest`           | `npx vitest run <file> -t "<name>"`                | `npx vitest run`      |
| `jest`             | `npx jest <file> -t "<name>"`                       | `npx jest`            |
| `@playwright/test` | `npx playwright test <file> -g "<name>"`            | `npx playwright test`  |
| `mocha`            | `npx mocha <file> --grep "<name>"`                  | `npx mocha`           |
| none of the above  | `node --test <file>` (Node ≥18 built-in runner)     | `node --test`          |

Watch mode (`vitest` with no `run`) hangs a non-interactive session — **always pass `run`** for Vitest, and never leave a runner in watch mode.

Vitest is the deck's reference case: fast enough that a red-green cycle stays inside a few seconds, which is what makes test-first tolerable. If a suite takes minutes, scope the
single-test command tightly (`-t`) and only run the full suite at phase end.

## JVM

Maven:

```bash
mvn -q -Dtest='TaskDueDateTest#dueDateSurvivesReload' test   # single
mvn -q test                                                   # suite
```

Gradle:

```bash
./gradlew test --tests 'com.example.TaskDueDateTest.dueDateSurvivesReload'   # single
./gradlew test                                                                # suite
```

Use the wrapper (`./gradlew`, `./mvnw`) when present — it pins the build tool version.

**Acceptance-test (`*-at`) repos** are JUnit + Guice with Playwright/Appium/REST Assured underneath. TDD applies to their *helper and mapping logic*, not to the browser/device tests
themselves — a Playwright test against an unbuilt UI can't go green in a red-green cycle measured in seconds. Gate those to `/10x-implement` and keep the acceptance suite as
phase-end verification. Follow the repo's own naming conventions (`conventions-qa`) for anything you add there.

## Python, Rust, Go, .NET

```bash
pytest 'tests/test_tasks.py::test_due_date_survives_reload'   # single
pytest                                                          # suite

cargo test due_date_survives_reload                             # single
cargo test                                                      # suite

go test ./internal/tasks -run TestDueDateSurvivesReload          # single
go test ./...                                                    # suite

dotnet test --filter 'FullyQualifiedName~DueDateSurvivesReload'   # single
dotnet test                                                       # suite
```

## Mutation testing — a gate you choose, not a gate that runs

Mutation testing asks the one question coverage can't: *would this test have failed if I broke the code?* It is slow and it is **never** wired into per-commit CI in this workflow.
Run it deliberately, on one module, when you want to know whether a suite is real.

| Stack | Tool     | Command                                                                          |
| ----- | -------- | -------------------------------------------------------------------------------- |
| JS/TS | Stryker  | `npx stryker run` (scope with `--mutate 'src/tasks/**/*.ts'`)                     |
| JVM   | PIT      | `mvn org.pitest:pitest-maven:mutationCoverage -DtargetClasses='com.example.tasks.*'` |
| Python| mutmut   | `mutmut run --paths-to-mutate src/tasks/`                                        |

Surviving mutants are the finding: a mutant that lives is a line no test actually constrains. Fix by adding an assertion that *distinguishes* the mutant, not by adding a test that
merely touches the line — that is precisely the "bzdurna asercja" the workflow's testing philosophy rejects.

If the tool isn't installed, don't install it unprompted. Report the gap and let the user decide; adding a dev dependency is their call.

## When detection fails

If no marker is found, or the runner is present but no test directory exists, **ask** rather than guessing — via AskUserQuestion, offering the runners plausible for the detected
language plus "none yet, scaffold it". A wrong guess here produces a failing command that looks like a failing test, which is the most confusing possible outcome in a red-green loop.
