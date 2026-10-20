# Targeted B7a certification run (tested source SHA `83e95af2e623251936a2b693401a69d387a1b377`)

- Tested source SHA: **83e95af2e623251936a2b693401a69d387a1b377** (clean worktree, `v1-source-authority`); this evidence directory is committed AFTER it and was not itself independently tested.
- Runner: `scripts/sweep-runner.mjs run` with `--files`, 150 s ceiling, 1024 MB heap, sequential, full per-file logs in `logs/` (Neon host name redacted). Raw ledger: `results.raw.jsonl`.
- "Before" = the recovered 596f868 full-sweep ledger (`docs/certification/runs/596f8686c0d6-2026-10-20-full-sweep/`). It is NOT the 17a5736 sweep.
- Gate before every launch: free memory >= 3000 MB (observed 3366-3452 MB at file start), commit charge < 70%, no runner alive.

| File | Before (596f868 sweep) | After (83e95af) | Assertions after | Free MB at start |
|---|---|---|---|---|
| `d4-identifier-fabric-live-retry-deterministic.test.js` | FAIL (exit 1, 851 ms) | PASS (exit 0, 8296 ms, ok) | 19 pass / 0 fail | 3452 |
| `d4-identifier-fabric-live-concurrency.test.js` | FAIL (exit 1, 49788 ms) | FAIL (exit 1, 50551 ms, nonzero-exit) | 13 pass / 1 fail | 3426 |
| `d4-identifier-fabric-concurrency.test.js` | PASS (exit 0, 11074 ms) | PASS (exit 0, 11170 ms, ok) | 8 pass / 0 fail | 3370 |
| `d4-identifier-fabric-retry-unit.test.js` | PASS (exit 0, 77 ms) | PASS (exit 0, 85 ms, ok) | 13 pass / 0 fail | 3366 |
| `d5b-live-apply-gate-a2-concurrency.test.js` | PASS (exit 0, 19941 ms) | PASS (exit 0, 19953 ms, ok) | 8 pass / 0 fail | 3377 |
| `lock-race-teardown-harness.test.js` | PASS (exit 0, 21890 ms) | PASS (exit 0, 21654 ms, ok) | 21 pass / 0 fail | 3405 |
| `sweep-runner-instrumentation.test.js` | PASS (exit 0, 3052 ms) | PASS (exit 0, 3013 ms, ok) | 13 pass / 0 fail | 3451 |
| `d4-race-invariants-negative-controls.test.js` | new file | PASS (exit 0, 11393 ms, ok) | 27 pass / 0 fail | 3440 |
| `sweep-runner-evidence-contract.test.js` | new file | PASS (exit 0, 1473 ms, ok) | 13 pass / 0 fail | 3423 |

## Skipped invariants
- `d4-identifier-fabric-live-concurrency`: before, all five state invariants were SKIPPED whenever no deadlock was observed; after, all five execute for every completed race (10/10 races evaluated, none skipped). Invariant 2 prints, per race: "0 deadlocks observed; 0 unconverted raw 40P01 errors escaped. Invariant vacuously satisfied." This does not certify deadlock conversion.
- No other skipped assertions: no file reported SKIP.

## The one remaining FAIL (expected, deliberately retained)
`d4-identifier-fabric-live-concurrency` still fails exactly one assertion: "B7a: a REAL SQLSTATE 40P01 was observed within 10 race attempt(s) x 3 concurrent pairs". The probabilistic deadlock observation stays a failure until a separately authorized split. 13 pass / 1 fail.

## Repeatability of the deterministic test
`repeat-runs/`: five further independent processes, each 19/19, each minted a distinct fresh pair (no pair id repeated: `fresh-pairs.txt`), each with a real 40P01 at the retry layer on attempt 1 (about 1.97-2.02 s) and a successful commit on attempt 2. Together with the runner run that is 6 consecutive PASS (plus the first manual run).
