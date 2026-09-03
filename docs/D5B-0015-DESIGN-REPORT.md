# D5B 0015 — ValuationQuestion + Applicability: Design + Migration Artifact + Scratch Proof

**Terminal status: D5B 0015 DESIGN PASS — LIVE MIGRATION GATE READY.** Every semantic ruling (D1–D14), the migration artifact (D15), and every required proof passed, real, against an isolated scratch schema. **`data1_dev` was never touched.** No live migration, no D5C/D5D, no production capture, no runtime writer. Conceptual authority: `docs/adr/ADR-VALUATION-001-question-applicability.md` (banked `5d667fc`, V1–V4 addendum `30d001d`).

## D0 — Entry census

- HEAD at start of this pass: `30d001d1f677a78614a77b73568b085d7f6b62e7`. `origin/main..HEAD` showed the full D5A/D5B commit chain already banked, nothing unpushed beyond it.
- `git status --short`: quarantined scratch (`scripts/capture-active-cache-entry.mjs` modified, `scripts/ingest-fixture-response.mjs`/`scripts/merge-fixture.mjs` untracked) unchanged from session start — confirmed present, confirmed never staged.
- DATA-0E-FULL: one `node.exe` process live (PID 19220), `acquisition-checkpoint.json` phase `fetching-details` — confirmed running independently, not interacted with.
- Confirmed: D5A `0014` remains live (unaffected by this pass — this pass's scratch schemas are isolated per-run, `data1_dev` never opened for write). D5B semantic closure (R1–R6, V1–V4) remains banked in `ADR-VALUATION-001`. P2a remains PASS (re-confirmed: this pass's own scratch-target guard is a *new instance* of the same pattern, proven again independently — see Required Proof). No `valuation_question`/`applicability` durable substrate existed anywhere before this pass (repo-wide grep before writing any file returned only the unrelated pre-existing `variantApplicability` field). No stash/reset/clean run at any point.

## D1 — Identity-assumption anchor

`asset_identity_assignment` (live, `data1_dev`, 80 rows) already has the right *shape* — append-only, `superseded_by` the sole documented lifecycle mutation — but that contract was enforced by application convention only; no DB trigger protected it (confirmed: no `TRIGGER`/`FUNCTION` referencing this table anywhere in `0004`/`0011`). Freezing a `ValuationQuestion` to one assignment row is not a real guarantee without one. Rather than HOLD, this pass closed the gap in-scope: `db/data0/0015...sql` Part 1 adds `UNIQUE(id, asset_id)` plus an immutability trigger (`asset_identity_assignment_guard`) mirroring D4's `asset_identifier_assertion_guard` (`0013`) exactly, verified compatible with the one live write pattern (`repository.js:158-167`, static read — **not** re-verified against the real 80 live rows, since `data1_dev` is untouched this pass; a future live-apply dispatch must re-run this compatibility check for real). `valuation_question.identity_assignment_id` + a composite FK to `asset_identity_assignment (id, asset_id)` (same technique as D4 Ruling 21) makes cross-asset identity anchoring impossible at the DB level — proven live (Required Proof). T1/T2 non-retroactivity proven live: after a T1 row is superseded, its own `authority`/`source` fields are read back unchanged. No copied comic identity fields, no `catalog_entity` dependency, no external identifier — all confirmed by construction (0015 touches zero D4 tables).

## D2 — ValuationQuestion semantic tuple

R2's field-admission rule re-applied mechanically; D2's re-audit question (does the D1 anchor already establish variant/year, making a duplicate redundant?) answered **NO** — `asset_identity_assignment` carries only `asset_id`/`catalog_entity_id`/`authority`/`source`, no variant or year field at all, so both remain genuinely distinct valuation assumptions. Final tuple: `target_grade`, `grade_basis`, `disposition`, `variant_scope`, `target_year` (5 assumption fields) + `asset_id`/`identity_assignment_id` (2 identity-anchor fields) = 7-field `vq-hash-v1` tuple. The other 18 `fetchComps()` inputs remain excluded, unchanged from R2's original classification.

## D3/V4 — Target grade semantics

`target_grade` reuses `canonicalMinimalDecimal` — the exact same function `market_observation.grade_numeric` uses (import equality proven, not just behavioral similarity — see Required Proof). `disposition` (`raw`/`graded`/`NULL`) alone does **not** disambiguate grading *authority* — confirmed directly: the live pricing math's own `CGC_MULTIPLIERS`/`RAW_MULTIPLIERS` split is the identical coarse boolean, no finer distinction exists today. `grade_basis` (nullable, source-asserted, reusing `normalizeText`) closes that gap, mirroring `market_observation.grade_basis` (F2) exactly — never a hardcoded CGC/CBCS vocabulary. `disposition` is nullable, not `NOT NULL`: `api/comps.js`'s own `isGraded` parameter is genuinely tri-state today (`true`/`false`/`undefined` all reachable, `api/comps.js:1051-1052`) — a real "no preference" state already live, not invented for this schema.

## V3/D4 — One canonical framing implementation

`src/lib/canonicalHashFraming.js` (new) extracts Layer 2 (`encodeField`, TLV framing) and the domain-agnostic half of Layer 1 (`normalizeLowerToken`/`normalizeUpperCode`/`normalizeText`/`canonicalFixedScaleDecimal`/`canonicalMinimalDecimal`) verbatim from `marketObservationHash.js`, byte-for-byte unchanged behavior. `marketObservationHash.js` now imports and re-exports these under the exact same names — its public API is unchanged, proven by rerunning `tests/d5a-market-observation-hash-serializer.test.js` unchanged (63/63, zero drift). `valuationQuestionHash.js` (vq-hash-v1) and `applicabilityHash.js` (applicability-hash-v1) both import the identical primitive — proven by **reference equality** (`mo.encodeField === framing.encodeField`, etc.), the strongest available proof that no divergence is possible, not merely "produces the same output today."

## D5 — Question identity

All required fixtures proven live against the real hash functions (unit) and the real DB dedup index (scratch-schema): same-fact → same hash; `"9.4"`/`"9.40"` → same; `9.4`/`9.2` → different; raw/graded → different; identity X/Y → different; Asset A/B → different; filter v12/v13 and model M1/M2 → same (structurally excluded — not parameters of the tuple at all, not merely unused); grade-basis collisions (`NULL` vs `"cgc"` vs `"cbcs"` vs `""`) → all pairwise distinct. `UNIQUE(content_hash)` alone is the dedup key (no raw-column prefix needed — unlike `market_observation`'s provider/provider_item_id prefix, which exists specifically for *that* table's nullable-item-id multiplicity case; `asset_id`/`identity_assignment_id` here are both `NOT NULL` and already inside the hash).

## Applicability — V1/D6, D7, V2/D8, D9, D10, D11, D12, D13, D14

- **V1/D6:** `verdict` and `confidence_tier` are two independent `NOT NULL` columns, never one enum. `confidence_tier` is deliberately **not** named or valued like D4's `resolution_authority` — a review flagged the exact risk (reaching for the nearest precedent re-imports a confidence/support scale meant for identity corroboration, not single-judgment weight); the column uses a disjoint vocabulary (`LOW`/`MEDIUM`/`HIGH`) so a reader cannot assume shared semantics by name or by value set (proven: `normalizeConfidenceTier('CORROBORATED')` throws). The reviewer's separate, valid point ("machine rule vs operator override") is real but is a *provenance* axis, not a *confidence* one — modeled as `source_type` (D10), orthogonal to `confidence_tier` by construction (both `NOT_APPLICABLE+HIGH` and `APPLICABLE+LOW` proven independently representable — the two required cases).
- **D7:** `verdict` CHECK admits only `APPLICABLE`/`NOT_APPLICABLE` — enforced at the DB level (proven: a literal `CONTESTED` INSERT is rejected by the real CHECK constraint, not just by application code). `CONTESTED` is a read-time derived concept, proven structurally representable via `applicability_contested_pairs` (a real `VIEW`, `GROUP BY ... HAVING COUNT(DISTINCT verdict) > 1`) — proven live against two real, un-mutated judgment rows.
- **V2/D8:** Supersession ruled OUT entirely. No concrete scenario surfaced requiring in-place correction under an unchanged rule version; the same philosophy `market_observation`'s own "provider correction = new row" precedent already uses. Consequence: `applicability`'s immutability trigger rejects **all** UPDATE/DELETE unconditionally — no `superseded_by` carve-out exists at all (proven live, both directions).
- **D9:** No `UNIQUE(observation_id, question_id)` — proven live: filter v12 (`NOT_APPLICABLE`) and v13 (`APPLICABLE`) over the identical pair both persist, neither mutated. Idempotency is instead a per-row `applicability-hash-v1` content hash, `UNIQUE`-indexed alone — proven live: an exact semantic replay (even from a *different* principal/correlation_id, both excluded from the hash by design) is rejected as a duplicate; a genuinely different `rule_version`/`model_version`/`source_type` is not.
- **D10:** provenance columns are exactly `observation_id`, `question_id`, `verdict`, `confidence_tier`, `rule_id`, `rule_version`, `model_version`, `source_type`, `reason`, `recorded_by_principal_id`, `correlation_id`, `recorded_at`, `content_hash`, `hash_contract_version` — no comic-specific field, no provider query parameter, no value/result column.
- **D11/GK-186:** banked directly into the migration's own header comments, citing `soldVerification.js:270-278`'s cap by file:line — nothing in this schema places a row-count limit anywhere; a future writer evaluating 83 observations is structurally free to persist up to 83 rows.
- **D12:** see Required Proof — real measured WAL, not estimated.
- **D13:** proven live — `SELECT observation_id FROM applicability WHERE question_id = ? AND verdict = 'APPLICABLE'` is a correct, complete `MarketPopulation`-shape query against 0015 as written.
- **D14:** contract-only, not built. `GK-182`/`GK-184` remain the hard D5D gates, unaffected by this migration.

## D15 — Migration + rollback

`db/data0/0015_d5b_valuation_question_applicability.sql` (forward) and its `_rollback.sql` — both real, both proven against a real isolated Postgres scratch schema: positive scratch-target guard → 0014 applied fresh → 0015 applied → full semantic-invariant proof → rollback → exact object census (view, both tables, and the `asset_identity_assignment` constraint/trigger all confirmed gone; `asset_identity_assignment`'s own 80-row-shaped pre-existing data proven untouched) → reapply → re-verified. `data1_dev` was never opened for a write statement at any point in this pass.

## Required proof — results

| Suite | Result | Real DB? |
|---|---|---|
| `tests/d5a-market-observation-hash-serializer.test.js` (regression, rerun unchanged) | 63/63 | No |
| `tests/d5b-0015-hash-serializer.test.js` (new — vq-hash-v1/applicability-hash-v1 property/adversarial + shared-primitive reference-equality) | 36/36 | No |
| `tests/d5a-market-observation-migration-contract.test.js` (regression, rerun unchanged) | 67/67 | Yes — scratch only |
| `tests/d5b-0015-migration-contract.test.js` (new — full D1–D15 live proof, real WAL) | 42/42 | Yes — scratch only |
| `tests/assets-module-boundary.test.js` | 23/23 | No |
| `tests/auth-module-boundary.test.js` | 8/8 | No |
| `tests/capture-module-boundary.test.js` | 7/7 | No |
| `tests/media-module-boundary.test.js` | 11/11 | No |
| `npm run build` (ESM-mode checks + `vite build`) | Clean | — |

**historical-roster status changes: NOT FRESHLY MEASURED** — the full 258-file baseline roster was not rerun this pass; only the suites above (all newly added or directly touched by this pass's refactor) were run.

Two real bugs were caught and fixed by the negative proofs during this pass, not by inspection:
1. `computeMarketObservationHash`'s initial refactor duplicated the field-order list separately from `serializeMarketObservationTuple` — a drift risk the dispatch's own V3 mandate exists to prevent. Fixed before any test ran, by piping through the serializer instead of re-listing fields (`hashCanonicalBuffer(serializeMarketObservationTuple(...))`).
2. The migration-contract test's own D1 trigger assertion targeted the wrong exception branch (`"UPDATE must set superseded_by"` fired before `"only superseded_by may be set"` could, because the test's UPDATE never set `superseded_by` at all) — fixed by constructing an UPDATE that sets `superseded_by` *and* another field together, which correctly reaches the intended guard branch. The D12 row-count assertion undercounted by 3× (`measureBatch(n, ...)` takes 3 replicate samples of `n` rows each, not one) — fixed to expect `+300`, not `+100`.

## FACT / HYPOTHESIS / RECOMMENDATION

**FACT** (measured/proven, this pass): all suite results above; D1's composite-FK cross-asset rejection; D1's T1/T2 non-retroactivity; D7's `CONTESTED` DB-level rejection and the contested-pairs view's live correctness; D8's unconditional immutability (both directions); D9's dedup-vs-multiplicity behavior; D12's WAL medians (`pg_current_wal_lsn`/`pg_wal_lsn_diff`, steady-state median of 3 samples per N, after 20-row priming, no-write control sampled — one of three control samples read 104 bytes rather than 0, disclosed exactly as the D3.3 Amendment methodology itself discloses: this LSN is database-wide, not per-transaction, and any concurrent write during the sampling window contaminates the result; not evidence this run's own steady-state medians are wrong, since those are themselves 3-sample medians, not single readings): N=20 → 990.4 B/row, N=60 → 1087.5 B/row, N=100 → 1073.7 B/row, second N=100 under changed logic → 1139.0 B/row (numbers will vary run-to-run within this range; order-of-magnitude ~1KB/row is the load-bearing fact, not the exact figure).

**HYPOTHESIS** (judgment calls, not empirically provable from existing evidence): `confidence_tier`'s 3-value vocabulary is sufficient for every future judgment mechanism — untested against any real rule engine, since none exists yet. D8's "no supersession is ever needed" ruling is well-argued from precedent but not proven impossible to need — the dispatch's own instruction anticipated this ("if yes: provide a concrete scenario... complexity must be earned"); no such scenario surfaced, but this is an absence of a counterexample, not a proof of nonexistence. The measured WAL figures are representative of *this pass's own* row shapes (short `rule_id`/`reason` strings) — a real future writer's actual content lengths may differ materially, especially `reason`, which is unbounded free text and hash-participating.

**RECOMMENDATION:** a future live-apply dispatch must independently re-verify `asset_identity_assignment_guard`'s compatibility against the real, current `data1_dev` row count (80 as of this pass's cited evidence, certainly more by live-apply time) before applying — this pass's compatibility check is static-code-only. Before any D5D writer design begins, ratify a length/shape convention for `reason` (unbounded today), since it is both hash-participating and the single most WAL-variable field measured. When GK-179 (schema-name env-derivation) is eventually resolved, 0015's own two `SET search_path TO data1_dev;` lines need the identical treatment 0014 already needs — not a new gap, already covered by GK-179's existing scope.

## Compatibility Matrix (all 16 — this is a real migration/schema artifact, the single-line N/A form does not apply)

1. Does permanent `gkAssetId` remain unchanged? **YES** — no `gkAssetId` mint/mutation logic touched; `valuation_question.asset_id` only FKs to the existing `gk_asset(id)`.
2. Is physical instance kept separate from catalog class, with no domain field added to `gk_asset`? **YES** — `gk_asset` itself has zero columns added.
3. Are external IDs linked through the Identifier Fabric, never adopted as `gkAssetId`? **N/A** — this migration touches no external identifier and zero D4 tables.
4. Are model outputs represented as claims with source/authority, never unsupported bare truth? **YES** — every Applicability judgment carries `rule_id`/`rule_version`/`model_version`/`source_type`/`confidence_tier`; `ValuationQuestion` carries no model output at all (pure caller-asserted assumptions).
5. Is evidence and provenance preserved through additive records rather than overwritten? **YES** — both new tables are INSERT-only, proven live.
6. Is event history preserved as append-only, with no mutation of prior event truth? **YES** — same proof; `asset_identity_assignment`'s own append-only contract is now DB-enforced for the first time (strengthened).
7. Is the capability many-to-many-capable at the capture layer, or explicitly N/A? **N/A** — valuation-domain, not capture-domain.
8. Does it use generic identifiers rather than a vertical-specific identity mechanism, or explicitly N/A? **YES** — `disposition`/`confidence_tier`/`verdict`/`grade_basis` are all generic, no comic-specific vocabulary anywhere.
9. Are market observations / valuation evidence preserved durably, or explicitly N/A? **YES** — this migration *is* that durable layer.
10. Are predictions and decisions immutable once written, or explicitly N/A? **YES** — proven live, both tables, unconditionally.
11. Can the provider/model/external service be swapped without changing the permanent domain schema? **YES** — `rule_id`/`rule_version`/`model_version` are free-text/generic; no provider-specific branching in the schema.
12. Is marketplace integration projection-only rather than becoming asset identity? **N/A** — no marketplace integration touched.
13. Does the kernel remain vertical-neutral, including no comic-specific field in `src/modules/assets/`? **YES** — `src/modules/assets/` has zero files touched; 0015's own fields are vertical-neutral by construction (D2/D3 admission explicitly excludes comic-specific terms).
14. Is unknown-asset state legal, including `authority:NONE` or equivalent being reachable and testable? **YES** — `asset_identity_assignment.authority` vocabulary untouched and reachable; every `ValuationQuestion` assumption field is independently nullable (a fully unassumed question is legal).
15. Does the design preserve eventual outcome learning, including nothing that prevents later `OutcomeEvent`/transaction linkage? **YES** — `valuation_event`/`comp_snapshot` proven untouched, live, at both apply and rollback.
16. Wherever an event may be backdated or imported, does the system preserve a true `occurred_at` distinct from `recorded_at`? **N/A** — neither table represents a backdatable/importable real-world event with its own asserted occurrence time distinct from persistence time (a `ValuationQuestion` is an assumption set; an Applicability judgment's `recorded_at` *is* its own genuine computation time — no separate "when did this really happen" fact exists to preserve, unlike `market_observation.occurred_on`/`occurred_at`). Same reasoning D3.2's own F1d precedent already established for the seven operator/system-asserted event tables (`db/data0/0011`).

**Zero NO.**

## Census

Files read for this pass (beyond D5B's own prior census): `db/data0/0004_data1_foundation.sql:130-148` (`asset_identity_assignment` design-doc shape), `src/modules/assets/repository.js` in full (live column shapes, the one live write pattern, `getLiveIdentityAssignment`), `db/data0/0011_d3_2_event_time.sql` (the `assigned_at`→`recorded_at` rename + `occurred_at` addition), `db/data0/0013_d4_identifier_fabric.sql:255-332` (the composite-FK and immutability-trigger patterns reused verbatim), `docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md` (Ruling 8/9/20 precedent), `docs/DATABASE-MIGRATION-STATUS.md` (live table confirmation, the WAL-measurement methodology reused for D12), `src/lib/marketObservationHash.js` in full (pre- and post-refactor), `db/data0/0014_d5a_market_observation.sql`/`_rollback.sql` in full, `api/comps.js:998-1029` (re-confirmed field surface), `tests/assets-module-boundary.test.js` (regression target, not modified).

Files written: `src/lib/canonicalHashFraming.js` (new), `src/lib/marketObservationHash.js` (refactored, zero behavior change), `src/lib/valuationQuestionHash.js` (new), `src/lib/applicabilityHash.js` (new), `db/data0/0015_d5b_valuation_question_applicability.sql` (new), `db/data0/0015_d5b_valuation_question_applicability_rollback.sql` (new), `tests/d5b-0015-hash-serializer.test.js` (new), `tests/d5b-0015-migration-contract.test.js` (new), this report, plus `docs/TICKET-REGISTRY.md`/`docs/MASTER-BOARD.md`/`CLAUDE.md` banking updates (see commit).

## WHAT WAS NOT DONE

`0015` was NOT applied to `data1_dev` — every proof ran against a disposable, isolated scratch schema, dropped at the end of each test run. No D5C (`MarketPopulation`). No D5D (writer). No production capture. No provider wiring. GK-179 (schema-name env-derivation) not implemented — 0015 hardcodes `data1_dev` in its `SET search_path` lines exactly as 0014 already does, an existing, already-tracked gap, not a new one. GK-182/GK-184 not implemented — both remain hard D5D gates, untouched. DATA-0E-FULL not interacted with. No stash/reset/clean. Quarantined scratch untouched, never staged. The full 258-file historical test roster was not rerun (see the required phrase above) — only the suites this pass's own changes could plausibly affect were run, all of them real, all of them green.

## New/updated tickets

- **GK-188** (opened by this pass) — `asset_identity_assignment` lacked a DB-enforced immutability trigger before 0015; closed by 0015's own Part 1 (additive, reversible), verified compatible with the one live write pattern by static analysis only — **not** verified against the real live 80 `data1_dev` rows this pass (0015 is not applied there). Gate for the future live-apply dispatch: re-run this compatibility check for real before applying.
- **GK-189** (opened by this pass) — banks the corrected Applicability confidence-axis naming: `confidence_tier`, not `authority`, and a disjoint `LOW`/`MEDIUM`/`HIGH` vocabulary, not D4's `resolution_authority` values — the exact collision a review flagged before this pass wrote any schema. Recorded so a future dispatch does not silently reach for the D4 enum by habit.
- **GK-187** — the four V1–V4 gate conditions are now satisfied by *design and scratch proof* (this pass) — status updated from "gate, unimplemented" to "SHIPPED-PENDING" (implemented in the proposed migration, not yet live).

Full one-line entries: `docs/TICKET-REGISTRY.md`.
