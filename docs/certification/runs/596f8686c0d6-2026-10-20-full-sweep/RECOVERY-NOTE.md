# Recovery note (added by hand after `finalize`; the generated files are untouched)

The 596f868 sweep ledger was recovered on 2026-10-20 from the scratchpad of an earlier Claude Code session (volatile Temp storage, now copied here):
`%LOCALAPPDATA%\Temp\claude\C--Users-matam-OneDrive-Desktop-comic-vault\a3ec5738-33b8-446b-baac-a9ab1180cb63\scratchpad\full2.jsonl` (467,963 bytes, last write 2026-10-19 22:05 local) and `PREDICTION-596f868.txt` there.
Raw bytes are in `results.raw.jsonl` / `prediction.txt`. The committed runner takes the ledger path as an argument, so no default location existed; `finalize` now fixes that.

- Ledger: 479 files, 428 PASS / 51 FAIL / 0 TIMEOUT / 0 ENV_ERROR / 0 INTERRUPTED / 0 NOT_RUN, 0 rerun records, 14 resumed runner invocations (timeouts 240000/150000/90000 ms), free memory at each invocation 4.7-5.2 GB. Totals reproduced with the runner's own `summary` mode.
- Prediction `PREDICTION-596f868.txt` (2,258 bytes): its SHA-256 is `cbe196b1154d0fbd00a17981da4c8775da60fedd8210bcbee631b31c3654c7a3`; the reported "cbe196b1" is the first 8 hex characters of that SHA-256 (an abbreviation, not a full digest). Its EXPECTED TOTALS (428/51/0/0/0/0 = 479) equal the actual totals; the file is a prediction, not a result.
- Ordering evidence: commit 596f868 `2026-10-19T21:11:23-07:00` (04:11:23Z) < prediction file mtime 04:11:41Z < first sweep invocation 04:24:27Z.
- Predicted deltas confirmed by the ledger: `lock-race-teardown-harness` PASS, `d5b-live-apply-gate-a2-concurrency` PASS, `d4-identifier-fabric-concurrency` PASS, `d4-identifier-fabric-live-concurrency` FAIL (the B7a observation).
- Not provable from the ledger itself: the ledger records the tree path, not a SHA. The tested SHA is inferred from the tree being clean at 596f868 (commit time precedes the prediction and the sweep). Per-assertion counts are not in the ledger (output tails only).
- Surprise found on reconciliation: `d4-identifier-fabric-live-retry-deterministic` FAILED in this sweep (exit 1, 851 ms) because its single retained fixture pair had already been consumed. It is one of the 51 FAILs; repaired in `83e95af`.
- Status: **RECOVERED AND RECONCILED**. Nothing was reconstructed from the prediction. No repository document before this directory presented 428/51 as verified (searched both checkouts for "428", "596f868", "cbe196b1"); the claim existed only in the prior session and an external scorecard, which should cite this directory.
