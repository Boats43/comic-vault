# B1 release sequencing — finalization (2026-10-12) — NOTHING HERE IS AUTHORIZED

Candidate: `f9f159c2f1e685f47e84b3545ed85e8c4152f37f` (branch `b1-first-outcome-authority`, parent = Production `b403f33`). Frozen; not modified.

## 1. Push == deploy (Ruling 1)
Evidence (read-only): Vercel project `prj_2tECtpKowmM7oFT7CYOQFZTssP72` (`comic-vault`). The live Production deployment `dpl_G3EswX5MBKpMSKQrVrC7M11HtYrY` has `source: git`, `target: production`, `githubCommitRef: main`, `githubCommitSha: b403f33`, and carries the alias `comic-vault-git-main-…`. The repo `vercel.json` has no `git.deploymentEnabled`, `ignoreCommand` or branch override. A push to `origin/main` therefore creates a Production deployment. The project settings view did not expose the dashboard-level "Ignored Build Step" or "Production Branch" fields; treat "Production Branch = main" as inferred from deployment metadata, not read from settings.
Combined phrase: **`PUSH AND DEPLOY AUTHORIZED`** — valid only if it names the exact commit (`f9f159c2f1e685f47e84b3545ed85e8c4152f37f`) and only after 0040 is applied and certified.
Future separation options (NOT configured): (a) Ignored Build Step / `ignoreCommand` that exits 0 unless a marker is present; (b) disable Git auto-deploy for Production (`git.deploymentEnabled.main=false`) and deploy by CLI; (c) a protected-branch/PR gate. Each needs its own dispatch.

## 2. Combined non-operator marketplace gate (Ruling 2)
NO NON-OPERATOR MARKETPLACE WRITE until ALL close: **GK-283** seller-location authority · **GK-294** READY-path and identity/approval authority (incl. stale-Q41 binding) · **NEW (unnumbered — ticket id to be assigned)** server-owned durable category certification at listing time (`api/list-ebay.js` blocks only a client-supplied `assetCategory === 'generic'`; a Book is not rejected and the eBay category id is hardcoded to Comic Books). Not implemented here.
First supervised listing preconditions: durable physical asset, canonical identity, category, operator authority, exact price acknowledgment, inventory state AVAILABLE, no existing listing attempt.

## 3. Preflight checklist before 0040 writes anything (Ruling 3) — status 2026-10-12
| # | Item | Status |
|---|---|---|
| 1 | Production DB state + 0040 absence confirmed (fresh, direct) | NOT DONE — pulled credential is `[SENSITIVE]`; no access |
| 2 | Backup covers latest Production writes (max `updated_at`/ledger times vs 2026-10-12T20:48Z) | NOT DONE (needs #1) |
| 3 | If Production changed → STOP, fresh verified backup | pending #2 |
| 4 | Neon plan, restore window, UTC observation time | OPERATOR |
| 5 | Independently retrieved encrypted files + manifest, ciphertext hashes verified | OPERATOR (local hashes match: dump `8a33472f…`, schema `ed2cb4a4…`) |
| 6 | Passphrase held separately | OPERATOR |
| 7 | Cold-start decrypt + restore verification (57 tables / 593 rows historical) | OPERATOR |
| 8 | Separate explicit authorization `PRODUCTION MIGRATION 0040 AUTHORIZED` | NOT REQUESTED |

## 4. First-sale session (Ruling 4)
Operator signs out and back in immediately before the workflow (session TTL is a fixed 12 h, no refresh). Verify an authenticated write persists server-side. A timeout or ambiguous eBay submission is reconciled via `docs/OPERATOR-RECONCILIATION-PROCEDURE.md` before ANY retry.

## 5. eBay canary (Ruling 6)
First listing = OPERATOR_MANUAL. `Item.UUID`/`Item.SKU` placement is unverified against a live eBay submission (schema-valid per the offline contract test, no sandbox). Accepted canary risk — requires the operator's explicit later approval. `VerifyAddFixedPriceItem` / `AddFixedPriceItem` NOT run.

## 6. Sequence and authorization boundaries
1. Operator recovery prerequisites (items 4–7) → 2. read-only Production state + backup-coverage check (items 1–3) → **`PRODUCTION MIGRATION 0040 AUTHORIZED`** → 3. 0040 applied in one transaction and certified read-only → **`PUSH AND DEPLOY AUTHORIZED` (exact commit)** → 4. read-only Production acceptance + iPhone PWA acceptance → 5. operator sign-out/sign-in, physical evidence uploads (separately authorized), grade/identity/price/Q41 → 6. separate approval for ONE OPERATOR_MANUAL listing (canary risk accepted) → 7. reconcile sale, fees, shipping, payout, realized net.

---
# Addendum 2026-10-13 — read-only preflight closure (NOTHING HERE IS AUTHORIZED)

## Standing release decisions (B5, confirmed by operator)
0040 applied and certified BEFORE any push · `PUSH AND DEPLOY AUTHORIZED` = one combined approval naming the exact commit `f9f159c2f1e685f47e84b3545ed85e8c4152f37f` · no non-operator marketplace write until GK-283, GK-294 and **GK-295** close · first supervised OPERATOR_MANUAL listing = the accepted eBay UUID/SKU canary, subject to separate listing approval · fresh login precedes the economic workflow · `marketplace-module-boundary` 20/21 is the accepted baseline failure (identical on unmodified `b403f33`).

## New tickets (banked, NOT implemented)
* **GK-295 — server-owned durable category certification at listing time.** `api/list-ebay.js` rejects only a client-supplied `assetCategory === 'generic'`; the durable server-side category is not consulted, a Book is not rejected, and the eBay category id is hardcoded to Comic Books (`259104`). Required: resolve the item's durable `collection_item.asset_category` server-side, refuse any category not certified for marketplace listing. Part of the combined non-operator gate.
* **GK-296 — `tests/b1rc-ebay-xml-contract.test.js` depends on Windows line endings.** The committed fixture `tests/fixtures/ebay/addfixedpriceitem-ready-baseline-b403f33.xml` has 0 CR bytes; with `core.autocrlf=true` a Windows checkout rewrites it to CRLF and the "READY-path packet is BYTE-IDENTICAL" assertion fails (17/18) although the packet is unchanged (18/18 with `core.autocrlf=false`). Fix later (e.g. `.gitattributes` `-text`/`eol=lf` for the fixture, or normalise in the test). Frozen candidate not modified.

## Historical RC test evidence (B1)
Committed record at `f9f159c` (`docs/TICKET-REGISTRY.md`, "B1-RC" RC4): final fresh-process run, two passes, 26 suites, 25 PASS in both, identical; only failure `marketplace-module-boundary` (also on `b403f33`). Per-suite counts present in that committed text: smoke 146/146, photo-handoff 57/57, gk265 44/44, schema-compat 12/12, reconcile-endpoint 57/57. NOT present in the committed text: 0040 contract 55/55 and operator-authority-live 145/145 (the registry carries earlier stamps 34/34 and 99/99, before the B1-FINAL amendment). The record is committed in `f9f159c` itself, so it cannot prove the run tree was byte-identical to `f9f159c`.

## Production read-only preflight (2026-10-13T02:49Z server time; documented `assertAdminDbTarget` method, in-process, `BEGIN READ ONLY`, nothing printed)
* marker `production`; `operator_authority_event` ABSENT (to_regclass NULL); 57 tables / 593 rows — identical to the backup.
* Newest durable write evidence: collection_item max updated_at 2026-10-12T17:56:29Z; valuation_event 2026-10-02T04:18:43Z; decision_event 2026-10-02T04:18:43Z; gk_asset 2026-09-24T00:51:41Z; operator_action_event and outcome_event 0 rows. Across all 49 tables having a timestamp column (72 columns): zero values after the backup time 2026-10-12T20:48:46Z; newest anywhere 17:56:29Z (2 h 52 m BEFORE the backup).
* Limits: 8 tables have no timestamp column; updates that do not bump a timestamp, deletes, and offsetting insert/delete pairs are invisible; `track_commit_timestamp` is off; equal row totals are not proof. Coverage is consistent with the evidence but NOT established → **FRESH BACKUP REQUIRED** per Ruling 3 (take it immediately before the migration; ≥6 h have also elapsed since the backup).

## Shell disposition (B3)
The "running shell" was the 2026-10-12 background command `b5uwoutqp` (PID tree bash 21960 → 3508 → find 11460): my own overbroad read-only `find / -iname "*backup*" …` filesystem search plus `git grep` and an `ls` of `C:\grailkey-data`. It could not modify files, databases, deployments or environments. Terminated (bash tree killed; `find` then exited); no process remains.

---
# Addendum 2026-10-13 (later) — record protection and push verification for `b1-preflight-records` (NOTHING HERE IS AUTHORIZED)

## Operator-reported status (not independently re-verified by this record)
Independent cold-start Production database recovery: **PASS** (operator-certified). Local recovery database absence: verified. Checklist items 5-7 above are therefore reported done by the operator; item 4 (Neon plan and restore window, UTC-stamped) is still UNCONFIRMED in this repo. Checklist items 1-3 (fresh Production state and backup coverage) must still be re-run immediately before 0040.

## Record preserved together on `b1-preflight-records`
Sequencing record (this file) · `docs/B1-MIGRATION-0040-CHECKLIST.md` · `docs/PRODUCTION-BACKUP-RESTORE-PROCEDURE.md` · `docs/EBAY-VERIFY-ROUTE-DESIGN.md` · `docs/B1-RC-RELEASE-PLAN.md` (§2 is the rollback procedure) · `db/data0/0040_operator_manual_authority_rollback.sql` · `docs/OPERATOR-RECONCILIATION-PROCEDURE.md` · `docs/TICKET-REGISTRY.md` (B1-RC, B1 PREFLIGHT, B1 RELEASE GATE v2, and the 2026-10-13 reconciliation entry).

## Push verification for this documentation branch (read-only evidence, 2026-10-13)
* Project `prj_2tECtpKowmM7oFT7CYOQFZTssP72`, team plan `pro`, linked to GitHub `Boats43/comic-vault`. `vercel.json` has no `git`, `ignoreCommand` or branch override.
* **Not readable with the available tools:** the project-level "Production Branch" and "Ignored Build Step" settings (`get_project` does not return them).
* Indirect evidence: all 20 most recent Production deployments have `githubCommitRef: main`; the two non-`main` refs ever seen on this project (`test/no-polybag`, `ebay-first-id`, both months old) produced deployments with `target: null` (preview). Both Production domains and `app.grailkey.com` have `gitBranch: null` and `customEnvironmentId: null` (bound to Production, not to a branch).
* Risk if the inference were wrong: this branch contains the full B1 candidate code (`f9f159c`) on top of Production `b403f33`; a mistaken Production build would ship code that expects `operator_authority_event` before migration 0040 exists. That is the exact ordering the release plan forbids.
* **Disposition: the push of `b1-preflight-records` was HELD by the executor** because the setting itself could not be read. The branch is committed locally. To release the hold the operator can confirm "Production Branch = main" (Vercel dashboard, Project Settings, Git) or state that the indirect evidence is sufficient.

---
# Addendum 2026-10-13 (Neon gate) — operator-verified recovery facts (NOTHING HERE IS AUTHORIZED)

Checklist item 4 is CLOSED by operator observation of the Neon Console on 2026-10-13: project `grailkey-catalog`, branch `main`, plan **Free**, history retention **6 hours**, PostgreSQL 18, compute 0.25 CU, monthly network transfer **81.4% used** at observation. **No waiver is issued; the six-hour PITR window is confirmed.** Class: OPERATOR-VERIFIED (reported to this record; the executor cannot read the Console). Consequence recorded: the 2026-10-12 backup is outside the window and does not stand as the migration-time backup; a fresh encrypted backup is required. Final authorization text and execution sequence: `docs/B1-MIGRATION-0040-AUTHORIZATION-CHECKPOINT.md`. Network transfer at 81.4% is a watch item.
