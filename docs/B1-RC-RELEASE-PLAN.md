# B1-RC release plan — GK-284 durable OPERATOR_MANUAL authority (LOCAL; NOTHING HERE IS AUTHORIZED)

> **STATUS 2026-10-13 (history below preserved):** Step 2 (migration 0040) is APPLIED and CERTIFIED and Step 3 (push + deploy) is DONE — Production is `f9f159c2f1e685f47e84b3545ed85e8c4152f37f`, `dpl_GT3VQvXWvUf4BjwH2b9oA2rnpYRM`. Steps 4-7 (authenticated smoke, iPhone acceptance, the single supervised listing) are PENDING and must be repeated against the post-gate SHA. The index count of the new table is **6** (primary key + `chain_uniq` + four named indexes), not 4. §2 rollback: once the GK-P0 gate ships, re-promoting `f9f159c` is NOT security-preserving — see `docs/B1-RELEASE-SEQUENCING-FINAL.md` GK-P0.

Branch `b1-first-outcome-authority`, parent = Production `b403f33`. The release candidate is the final commit on this branch (its SHA and the file checksums are recorded in the registry entry "B1-RC" and in the return packet, because a document cannot contain its own commit id). **No migration, push, deployment, paid scan or marketplace write is authorized by this document.** Each step below needs its own explicit words from the operator.

## 1. What the candidate changes in Production behavior
* **New table** `operator_authority_event` (migration `0040`, additive; no existing table altered).
* **OPERATOR_MANUAL listings** (engine authority not READY, operator-acknowledged exact price): the approval is recorded durably before any eBay call; the attempt is tracked `AUTHORIZED → SUBMITTED → LISTED_CONFIRMED | FAILED_DEFINITIVE | AMBIGUOUS`; `Item.UUID` + `Item.SKU` are sent; an ambiguous outcome blocks retries until an operator closes it (`api/operator-reconcile.js`).
* **Engine-READY listings:** the packet is **byte-identical** to the Production builder's (golden test). The only behavior change: the new preflight also reads the attempt table (so a READY publish is refused if the same asset has an unresolved manual attempt).
* **GK-288:** the operator panel labels a legacy decision with no recorded evidence "historical decision — evidence not recorded; not a current authorization".
* **Verification lane model:** `claude-haiku-4-5` → `claude-haiku-4-5-20251001` (same family and price row).
* **No pricing, grading, comp-selection or decision-engine change.**

## 2. Migration 0040 reversibility (A6)
* **Before the first authority record exists:** `0040` can be rolled back by dropping its new table (`0040_operator_manual_authority_rollback.sql`). The table has no dependents; nothing else references it.
* **After the first authority event exists: preserve the table.** It is an append-only legal/audit record of what an operator approved; dropping it destroys that. Recover by a **forward fix** or a **compatible application rollback** (below), never by dropping.
* **Rolling back the application after authority rows exist** is schema-compatible (the old application never references the table) but **removes the ambiguity/duplicate guard**: an attempt left `AMBIGUOUS`, `CLOSED_BLOCKED` or `IN_FLIGHT_OR_UNRESOLVED` would stop blocking new publishes. Before any application rollback, run the read-only query "attempts whose latest state is not terminal-safe" and resolve or accept each; otherwise prefer a forward fix.
* **Order for a rollback with NO authority rows:** redeploy the previous application first, then drop the table (never the reverse, or the new application would fail closed in between).

## 3. Compatibility matrix (measured)
| Application | Schema | Result | Evidence |
|---|---|---|---|
| OLD (`b403f33`) | MIGRATED | **Fully compatible.** The old code never references the table. | `gk265-phase3` 44/44 run from the unmodified `b403f33` worktree against the migrated Development schema; `grep` finds 0 references in the old `list-ebay.js` / assets service |
| NEW | UNMIGRATED | **Every single-item publish fails closed** (HTTP 500, zero eBay calls): engine-READY, OPERATOR_MANUAL, and even requests that would otherwise be refused 403. An availability loss, not a safety loss. | `tests/b1rc-schema-compat.test.js` (table renamed away in Development, always restored) |
| NEW | MIGRATED | Normal. | all `b1-*` suites |
| OLD | UNMIGRATED | Today's Production. | — |

## 4. Exposure windows
* **W-safe — migration applied, application not yet deployed:** old application + migrated schema. No behavior change. This is the intended intermediate state.
* **W-unsafe-order — application deployed BEFORE the migration:** all single-item publishes return 500 until the migration lands. **Never deploy first.** Bundle listings (disabled in Production) and all non-listing endpoints are unaffected, except `api/operator-reconcile.js`, which returns 500 without the table.
* **Deployment switch:** Vercel promotes a deployment atomically; requests in flight during the switch finish on the old deployment. There is no state in which half of a listing request runs on each version.
* **READY-path impact, stated explicitly:** (a) in W-unsafe-order a READY publish fails closed; (b) otherwise a READY publish behaves as today, **including the same gap it has today**: it has **no attempt ledger**. `b1rc-schema-compat` demonstrates it: after an ambiguous provider response on the READY path an identical retry is **not** blocked and calls `AddFixedPriceItem` again. This candidate does not introduce that gap and does not close it. **The READY path is NOT certified.** The first supervised listing must use the OPERATOR_MANUAL path.

## 5. Sequence (each step separately authorized; stop on any failed check)
**Step 1 — Production preflight and restore readiness (read-only).** Confirm `origin/main` and the live Production deployment are still `b403f33`; clean worktree at the RC commit; rerun the RC suites. In Production confirm `environment_marker = production`; that `economic_ledger_immutable()`, the three `decision_event` immutability triggers, `operator_action_event`, `outcome_event`, `gk_principal` and `uuidv7()` exist (verified 2026-10-12) and that `operator_authority_event` does not; snapshot every row count. **Restore readiness:** the recorded Neon restore capability is a 6-hour window on the Free tier (drill PASS 2026-09-01, `docs/MASTER-BOARD.md` D2.4); the operator confirms the current plan and window in the Neon Console and records a UTC timestamp before the migration. 0040 is additive, so a restore should not be needed; it is readiness, not expectation.
**Step 2 — Migration 0040** (`PRODUCTION MIGRATION 0040 AUTHORIZED`). One transaction. Verify: table present with 30 columns, the named constraints, 4 indexes + 3 append-only triggers; **every other table's row count byte-identical**; zero rows in the new table. Abort and `ROLLBACK` on any difference. Record before/after.
**Step 3 — Application release** (`PUSH AUTHORIZED`, `DEPLOY AUTHORIZED`). Fast-forward `origin/main` from `b403f33` to the RC commit (no merge, no force); confirm the deployment is READY and built from that commit.
**Step 4 — Read-only Production certification.** Unauthenticated `GET /api/operator-reconcile` → 401; the new table exists and is empty; no application error spike in runtime logs; a READY-eligible read path unaffected (no publish is made); build marker equals the RC commit.
**Step 5 — Operator reconciliation smoke test (non-mutating).** As the operator: `GET /api/operator-reconcile` → 200 with an empty queue; `GET …?attemptId=<random uuid>` → 404; `POST` with an invalid verdict → 400. No synthetic Production attempt may be created, so the **append-write path is certified in Development only** (`b1rc-operator-reconcile-endpoint`, 57 assertions) and first exercised in Production only if a real ambiguous attempt ever occurs.
**Step 6 — Real-device PWA acceptance** (the operator, on the installed iPhone PWA): current build marker; sign-in; Collection and scan unaffected; the New Mutants #98 operator panel shows the "not a current authorization" standing label.
**Step 7 — Separate approval for ONE founder-supervised listing.** Preconditions: physical possession confirmed; the asset chosen by the operator (New Mutants #98 and Old Man Logan #25 each have zero verified sold evidence and can only go out as OPERATOR_MANUAL); the price set and acknowledged by the operator; Seller Hub open; the ambiguous-outcome procedure (`docs/OPERATOR-RECONCILIATION-PROCEDURE.md`) understood. Because **no eBay sandbox verification of the `Item.UUID`/`Item.SKU` placement was possible** (no verified sandbox seller credential; eBay's published schema is `xs:sequence`-ordered and the existing packet is already out of that order yet accepted by eBay), the first Production listing is also the first live acceptance of those two elements — a risk the operator must accept explicitly, or close first with a `VerifyAddFixedPriceItem` call in a sandbox.

## 6. Required post-deployment checks (read-only)
1. Runtime logs: no `[ebay] attempt ledger write failed`, no `OPERATOR_AUTHORITY_UNAVAILABLE`, no 500 spike on `/api/list-ebay` or `/api/operator-reconcile`.
2. `operator_authority_event` row count and the review queue (`GET /api/operator-reconcile`).
3. For the first listing: the ledger shows `AUTHORIZED → SUBMITTED → LISTED_CONFIRMED` with the eBay item id, the approved cents equal the price on eBay, `verifyOperatorAuthorityConsistency` is `consistent:true`, the LISTED `outcome_event` exists, and the listing carries the `GK-…` label in Seller Hub.
4. If the outcome was ambiguous: the attempt appears in the queue with a 48-hour deadline and the asset is blocked until reconciled.

## 7. Recommendation
**Code and tests: ready. Production release: HOLD** pending (1) the operator's separate authorizations for steps 2, 3 and 7; (2) the operator's decision on the unverified `Item.UUID`/`SKU` placement (sandbox check, or accept the first live listing as the canary); (3) the operator's confirmation of the Neon restore window; (4) acknowledgement that the READY path remains uncertified.


## 8. Preflight addendum (2026-10-12; records only — the release candidate is unchanged)
* **Step 1 evidence now exists** for backup and restore: see `docs/PRODUCTION-BACKUP-RESTORE-PROCEDURE.md` (backup SHA-256 `535de99c…b03b54`, real restore verified table-by-table). **Still open for Step 1:** the operator must confirm the current Neon plan and restore window in the Console (last recorded: Free tier, 6-hour window, drill 2026-09-01) and record a UTC timestamp immediately before the migration; the backup should be re-taken at that moment if any Production write has happened since 2026-10-12T20:48Z.
* **Step 7 prerequisite status:** the non-publishing `VerifyAddFixedPriceItem` was **not executed** (no usable credential; photo hosting not authorized); the placement of `Item.UUID`/`Item.SKU` is therefore still unverified by eBay, and the first live OPERATOR_MANUAL listing remains its canary unless a Verify is run first. See the registry entry "B1 PRODUCTION PREFLIGHT".
* **Standing gate (GK-294):** no non-operator marketplace listing until the READY path has equivalent durable attempt recording, ambiguous-outcome handling, reconciliation and duplicate prevention. The first economic outcome is one separately authorized, founder-supervised OPERATOR_MANUAL listing.
* **Not part of this release:** GK-292 (issue-token parser), GK-293 (Trading API schema hardening), and any change to GK-228's unknown-grade rule (GK-291 closed).
