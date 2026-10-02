# Learning Spine — binding design laws (DESIGN ONLY, schema UNAUTHORIZED)

Recorded 2026-10-02 (dispatch "OUTCOME SPINE FIRST"). Nothing here is built. No migration, no table, no column exists for any item below. The schema remains **unauthorized**; this file records the laws any future schema must obey, plus the verified evidence behind the shape.

## Master laws
- **GRAILKEY LEARNS FROM HISTORY WITHOUT REWRITING HISTORY.**
- MODEL PREDICTION ≠ OPERATOR LABEL ≠ ADJUDICATED AUTHORITY ≠ REALIZED OUTCOME. All four are preserved independently.
- An operator correction is a **label**, never automatic universal truth. A realized sale establishes **economic facts only**; it never validates identity or grade automatically.
- Durable asset authority stays where it already lives. New records are provenance/evaluation history, never a parallel truth system.

## Approved shape and binding laws

**A. `model_prediction_event`** — append-only, immutable, **SERVER-WRITTEN ONLY.** Surfaces: IDENTITY, GRADE, CONDITION, RESEARCH. It may be written only from the server's own model result in the same trusted request that received/generated that result. **No client-supplied field may enter it** — not directly, not by fallback, not through object spread, not through collection merge, not from `attributes.modelPredictedGrade`. No page bodies. No fake historical provider/model backfill.

**B. `operator_correction_event`** — append-only. **THE CORRECTION EVENT AND THE AUTHORITY/CURRENT-STATE MUTATION IT RECORDS COMMIT IN THE SAME TRANSACTION.** Either both succeed or both fail; never "correction applied but history event missing" (that recreates the history gap). Records before/after, authority before/after, actor, timestamp, asset/collection anchor.

**C. `decision_event.authority_snapshot`** — approved in shape, not built. When built, snapshot the exact authority used at decision time (governingGrade + source, identityStanding, issueAuthority, editionStanding, marketStanding, price source/authority, actionAuthority, reason codes, model-prediction references). **Never regenerate a historical snapshot from current state.** Becomes meaningful in Production only after GK-180 is legitimately closed.

**D. Outcome anchor** — no schema. Implemented in GK-274: scoring resolves `outcome → decision_event_id → decision_event.valuation_event_id`, never the latest valuation.

**E. PredictionError** — a projection (not stored); pins `scoring_rule_version`.

**F. Research durability — narrowed.** REDIS = ephemeral Research investigation/cache. THE DURABLE SPINE = Research evidence that materially participates in a governed action (operator accepts/rejects evidence, correction, adjudication, decision, allowed manual-price action, marketplace/economic action, committed evaluation fixture). Preserve only a **minimal receipt**: research evidence row id, asset/collection anchor, provider, source URL, source record id if available, claimed price/date, evidence class, identity-match standing, authority status, research version, provider/model version where available, operator action/feedback. **No page bodies. No general web-search archive.** Unacted-on attempts expire from Redis normally.

**G. Research asset link.** Verified defect (GK-273): `attributes.gkAssetId` is not authoritative and is null in Production (0 of 139 items). Durable Research linkage must resolve physical identity from **`collection_item_link`**; if linked use the real `gkAssetId`; if not, `gkAssetId = null` bound to the canonical collection item. **Never mint a physical asset for Research provenance.**

**H. Development / holdout — BANKED ONLY.** No manifest, split or ML dataset system now. Provenance records must be exportable into a corpus that can later be split `DEVELOPMENT` / `HOLDOUT_EVALUATION`. Revisit at roughly 20–50 genuinely labelled/adjudicated examples (a review point, not a product rule). Today's real corpus is 5 captures + 3 labelled pairs + 0 adjudicated + 0 realized outcomes.

**I. No fake historical provenance (absolute).** If `modelPredictedGrade = X` is known but provider/model/model version/prompt version are not, those stay **UNKNOWN**. Never infer Claude/Haiku from what the system uses today. A known fact and a historical unknown must remain distinguishable.

**J. Sequencing law.** The Learning Spine is not Production-ready until: GK-180 is traced (done — `docs/OUTCOME-SPINE-TRACES.md`), its original safety reason understood (done), Production write semantics proven, idempotency proven, partial-failure behavior understood, explicit Production-enable authorization given, and a real Production scan proves valuation_event + decision_event created with correct principal/asset binding and **no duplicate rows on retry**. No schema migration substitutes for closing GK-180.

## Minimum-design proposal (unchanged from the verified-gap proof; UNAUTHORIZED)
Two new append-only tables (`model_prediction_event`, `operator_correction_event`) + one additive nullable column (`decision_event.authority_snapshot`). Research feedback = `operator_correction_event` with `kind = evidence` (no sixth table). Immutability via BEFORE UPDATE/DELETE triggers (the `0014`–`0017` pattern); idempotency via `UNIQUE(principal_id, idempotency_key)`; rollback = `DROP TABLE` / `DROP COLUMN`.

## Verification status of each future-schema claim
| Claim | Status |
|---|---|
| No per-scan model provenance is persisted durably (`/api/grade` returns no model/usage/trace; scan log writes `model:null`, `modelVersion:null`; `valuation_event` has only `build_sha`) | **VERIFIED** (source read; `valuation_event`/`decision_event` columns read from the live schema) |
| Operator grade history is not preserved (SET → SET → CLEAR leaves no trace; later regrade overwrites `grade`, baseline stays first) | **VERIFIED** (real functions executed) |
| Identity correction keeps only the last correction's prior values; timestamp/operator/asset link absent | **VERIFIED** (real `buildManualCorrectionProvenance`/`buildCorrectedCatalogueItem` executed) |
| `foreignEdition`/`editionType`/`variant` cleared on manual correction and absent from `priorIdentity`; no merge site writes `foreignEdition` back from enrich | **VERIFIED** (source + executed) |
| `decision_event` snapshots only recommendation + blockers/warnings; no authority snapshot exists | **VERIFIED** (bridge code + live column list) |
| PredictionError used the latest valuation | **VERIFIED and FIXED** (GK-274, with a HEAD negative control: old scorer returned the later $999.99) |
| `valuation_event`/`decision_event`/`outcome_event` have no DB immutability triggers | **VERIFIED** (grep of every `CREATE TRIGGER` in `db/data0`) |
| `operator_action_event` requires `decision_event_id`; `outcome_event` carries `decision_event_id` | **VERIFIED** (`0021` read; real inserts in the live proof) |
| Collection write semantics: protected keys = base `||` incoming (overwrite), strip only the six grading keys on INSERT | **VERIFIED** (`repository.js` read) |
| Production counts (139 items, 131 model-predicted, 3 operator-labelled, 3 valuations, 2 decisions, 0 operator actions, 0 outcomes; 0 items with `attributes.gkAssetId`) | **VERIFIED** (read-only queries) |
| Research record lacks durable gkAssetId and never reads `collection_item_link` | **VERIFIED** (own code + 0/139 count) |
| Real corpus counts (0 committed real captures before this dispatch; 5 local; 3 labelled pairs) | **VERIFIED** (files parsed, DB queried) |
| Collection `attributes` has no history/version table | **VERIFIED** (schema + SQL) |
| `domain_event` is a documented derivative envelope, not a primary store | **VERIFIED** (project doctrine text read; not re-derived from schema) |
| Phone-only fixtures (ASM #11, Hulk #180) exist | **UNVERIFIED** (reported by the operator; not on this machine) |
| Fixture-bank "known corrupt export" cause | **UNVERIFIED** beyond the empty file observed |
| Any remaining subagent census statement not re-checked above | **SUBAGENT-ONLY** — must be personally verified before any schema authorization |

## Economic provenance laws (added 2026-10-01, dispatch "ECONOMIC PROVENANCE BEFORE GK-180")
- **DURABLE ECONOMIC PROVENANCE IS PART OF ECONOMIC AUTHORITY. A valuation whose origin cannot be established is not authority — it is a record that something was once asserted.**
- Unknown provenance remains unknown. It is never promoted, inferred or backfilled from plausibility (`method='engine-computed'` on a row is a label, not proof).
- A scorer (PredictionError, any future learning consumer) that cannot establish trusted valuation provenance REFUSES. It never scores "best effort".
- Provenance enum (design only, no migration): `SERVER_DERIVED` | `OPERATOR_OVERRIDE` | `CLIENT_ASSERTED` | `LEGACY_UNKNOWN`. Rows that cannot be proven stay `LEGACY_UNKNOWN`; no blind backfill.
- Scoring trust rule: SERVER_DERIVED → scoreable. CLIENT_ASSERTED and LEGACY_UNKNOWN → REFUSED (new refusal code, `pe-historical-anchor-v2` when built). OPERATOR_OVERRIDE → scoreable ONLY as an operator-judgment score, reported under a separate label and never aggregated with engine accuracy (it measures the operator, not the engine).
- A prediction stored in a collection item is a **historical claim** (`CLIENT_REPORTED_UNCORROBORATED`) until a server-owned receipt exists (GK-261 design in OUTCOME-SPINE-TRACES.md).
