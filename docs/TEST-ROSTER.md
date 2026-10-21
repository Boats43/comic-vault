# Test roster: count and stamp

**Why this file exists.** `CLAUDE.md` is near its size limit (about 147k of 150k characters), so the standing rule "re-stamp the current baseline in the same commit as any test-file add/remove" could not be followed there. A standing rule that cannot be followed stops being followed silently. The count and its stamp live HERE; `CLAUDE.md` keeps one pointer line. Re-stamp this file in the same commit as any `tests/*.test.js` add or remove. Historical per-train stamps stay where they are (`CLAUDE.md` "Roster delta" lines, `docs/TEST-BASELINE-HISTORY.md`); they are not rewritten.

**Count = number of `tests/*.test.js` files** (what the sweep runner enumerates; authoritative at any commit: `git ls-tree -r --name-only <sha> tests | grep -c '^tests/[^/]*\.test\.js$'`). It is a file count, not a pass/fail result: pass/fail comes only from a recorded sweep (`docs/certification/runs/`).

## Current stamp
| Count | At | What changed |
|---|---|---|
| **486** | the Gate B pricing-integrity repair commit (the commit after `ba19141`) | +4: `tests/gate-b-variant-evidence.test.js`, `tests/gate-b-pricing-bundle-merge.test.js`, `tests/gate-b-enrich-variant-refusal-smoke.test.js`, `tests/gated-run.test.js` |

## History since the last fully measured sweep (each count measured from the git tree)
| Count | At | What changed | Sweep result |
|---|---|---|---|
| 482 | `ba19141` | +1 `tests/sweep-runner-ledger-guard.test.js` | not swept |
| 481 | `83e95af`, `6822a6e`, `5624e4d`, `18e56eb` | `83e95af` added `tests/d4-race-invariants-negative-controls.test.js` and `tests/sweep-runner-evidence-contract.test.js` (+2); the other commits added no test files | targeted run only (`docs/certification/targeted/83e95af-b7a-2026-10-20/`) |
| 479 | `596f868` | baseline | **428 PASS / 51 FAIL / 0 TIMEOUT / 0 ENV_ERROR / 0 INTERRUPTED / 0 NOT_RUN**, recovered and reconciled (`docs/certification/runs/596f8686c0d6-2026-10-20-full-sweep/`) |
