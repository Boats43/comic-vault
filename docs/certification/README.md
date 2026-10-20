# Certification evidence

Durable, never-overwritten evidence for full certification sweeps. Written by `node scripts/sweep-runner.mjs finalize` (see the header of `scripts/sweep-runner.mjs`; proven by `tests/sweep-runner-evidence-contract.test.js`, which does not run a sweep).

## Contract (every full certification run)
`docs/certification/runs/<sha12>-<UTC date>[-label]/` contains: `source-sha.txt` (tested sha and HEAD at finalize, stated separately), `manifest.json` (frozen test list, git blob id per file at the tested sha),
`prediction.txt` + `prediction.sha256` (full SHA-256 of the pre-execution prediction), `results.raw.jsonl` (byte copy of the raw ledger), `results.json` (per-file status/exit class/wall time/free memory/output tail),
`resources.json`, `reconciliation.json` (prediction vs actual), `SUMMARY.md` (unresolved failures; blocker classification is human). Finalize refuses (exit 3) if the directory exists and never overwrites a file.
Known gap, stated in each SUMMARY: the runner does not record per-assertion counts or skipped-assertion coverage; use `--logdir` to keep full output. Commit the evidence AFTER the tested source commit and never claim the evidence commit was tested.

## Runs
| Run | Tested SHA | Result | Notes |
|---|---|---|---|
| `runs/596f8686c0d6-2026-10-20-full-sweep` | `596f8686c0d6fe985246657b94e3019107128204` | 479 files: 428 PASS / 51 FAIL / 0 TIMEOUT / 0 ENV_ERROR / 0 INTERRUPTED / 0 NOT_RUN | RECOVERED AND RECONCILED. See its `RECOVERY-NOTE.md` for provenance and limits. |
| `targeted/83e95af-b7a-2026-10-20` | `83e95af2e623251936a2b693401a69d387a1b377` | 9 targeted files: 8 PASS / 1 FAIL (the retained probabilistic B7a observation) | B7a repair; not a full sweep. |
