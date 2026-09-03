# D5D — Isolated Writer Bridge, Design + Proof Report

**Scope, per the user's own "D5D SCOPE CORRECTION — MILESTONE TEN PRECEDENCE" ruling:** design + isolated writer proof ONLY. `GK-180 = zero writer call sites` is a hard invariant this dispatch must not open — confirmed unaffected below, proven not merely claimed. Runtime wiring into any live request path (`api/enrich.js`, `api/comps.js`, any production scanner handler) is explicitly **HOLD** until Milestone Ten's independent phone proof closes.

**Module built:** `src/modules/valuation/` (`db.js`, `errors.js`, `idempotency.js`, `repository.js`, `service.js`, `index.js`) — new, isolated, zero imports from any file under `api/`. Plus one minimal, read-only addition to the already-live assets module: `getLiveIdentityAssignment` (`src/modules/assets/service.js`+`index.js`).

## W2 — asset-source route: RULED, PROVEN

`resolveEligibleSubject({ principalId, collectionItemId })` calls only `assets.resolveCollectionItemLink` then `assets.getLiveIdentityAssignment` — both already-live, pure-SELECT public functions of `src/modules/assets/`. Never mints a `gk_asset`, never resolve-or-creates one, never invokes D6/capture behavior. Returns a typed skip result (`SKIP_REASONS.NO_DURABLE_SUBJECT` / `SKIP_REASONS.UNLINKED_SUBJECT`), never throws, for every "not eligible" case — including the ownership-mismatch case, which resolves to the SAME generic `UNLINKED_SUBJECT` reason as a nonexistent link (never leaks link existence to a non-owner).

Proven against REAL `data1_dev` (`tests/d5d-w2-eligibility.test.js`, 5/5) — safe because the underlying calls are pure SELECTs:
- W-F3 (no `collectionItemId`) → `SKIP_NO_DURABLE_SUBJECT`.
- W-F4 (bogus `collectionItemId`) → `SKIP_UNLINKED_SUBJECT`.
- W-F4 variant (real link, wrong owner) → `SKIP_UNLINKED_SUBJECT`.
- Eligible path: real linked `collectionItemId` (`cv_1787381637428_rtw875`) + its real owner → real `gkAssetId` (`01a02c0b-50f1-7490-804f-902cf5805176`) + real `identityAssignmentId` (`01a02c0b-74c7-7bf9-88f2-3774d4af8061`), matching an independent direct query.
- Row-count census before/after, all 7 tables (`collection_item_link`, `gk_asset`, `asset_identity_assignment`, `valuation_question`, `applicability`, `market_population`, `market_population_member`) — **identical**, zero writes.

## Write-payload specification

`evaluateMarketPopulation` accepts exactly one shape — the caller (a future runtime integration, not this dispatch) supplies every input already resolved; the function issues zero HTTP/provider/model calls, only Postgres statements:

```
{
  principalId, gkAssetId, identityAssignmentId,        // W2 output
  targetGrade, gradeBasis, disposition, variantScope, targetYear,  // -> ValuationQuestion
  populationRuleVersion,                                 // -> MarketPopulation
  observations: [{
    marketObservation: { provider, providerItemId, listingKind, priceAmount, currency,
                          conditionText, gradeNumeric, gradeBasis, occurredOn, occurredAt,
                          observedAt },                  // GK-184: real provider-retrieval time, REQUIRED, never defaulted
    applicability: { verdict, confidenceTier, ruleId, ruleVersion, modelVersion, sourceType, reason },
    memberStatus, exclusionReason,
  }, ...],
  idempotencyKey, correlationId,                         // F10 / provenance
}
```

`observedAt` is deliberately excluded from `marketObservationHash.js`'s own canonical hash content (provenance/timing metadata, not semantic fact) but the `market_observation.observed_at` column is `NOT NULL` — the caller must supply it explicitly per observation; the function validates and throws `ValidationFailedError` rather than defaulting it to `now()` (GK-184's own named hazard: defaulting would manufacture false freshness on a cache-hit path).

Return shape: `{ outcome: 'evaluated', questionId, populationId, observationIds[], applicabilityIds[], memberCount, insertedMemberCount }` — identical whether freshly evaluated or recovered via idempotency replay (ordinary or race-recovered, see W-F10 below).

## The atomic transaction + M3 reconstruction proof

One `BEGIN`/`COMMIT` per call: idempotency check → resolve-or-create ValuationQuestion → bulk resolve-or-create MarketObservations → bulk resolve-or-create Applicability judgments → resolve-or-create MarketPopulation header → bulk insert Members → claim idempotency key → `COMMIT`. Any error anywhere in that sequence → `ROLLBACK`, zero partial state.

Proven live (`tests/d5d-valuation-writer.test.js`, real isolated `d5d_writer_scratch_<ts>` schema, 0014–0017 applied fresh, `data1_dev` never touched — proven by `current_schema()` guard + before/after drop):
- Evaluation succeeds, 3 members recorded (2 SELECTED, 1 EXCLUDED).
- **M3 reconstruction**: `getEvaluatedPopulation` recovers exact membership, status split, and `exclusion_reason` from durable rows alone, via `repository.js`'s pure-read `getPopulationWithMembers` — no re-execution of any population/dedup/ranking logic.

## Failure matrix

| # | Scenario | Result |
|---|---|---|
| W-F3 | No `collectionItemId` | `SKIP_NO_DURABLE_SUBJECT`, zero DB writes (proven live, real `data1_dev`) |
| W-F4 | `collectionItemId` doesn't resolve / resolves to a non-owner | `SKIP_UNLINKED_SUBJECT`, zero DB writes, no existence leak |
| W-F5 | Forced mid-transaction failure (deliberately invalid `verdict: 'BOGUS_VERDICT'`, trips `normalizeVerdict`) | `attemptDurablePersistence` returns `{ ok:false, error }` — never throws to the caller |
| W-F6 | Full rollback after partial work | Zero orphan rows anywhere, including the FIRST observation that would have succeeded in isolation — `mo`/`ap`/`mp`/`mpm` counts identical before/after the forced failure |
| W-F5 (idempotency side) | Failed attempt's `idempotencyKey` | **Never claimed** — a real retry with the same key can still succeed later (proven: `SELECT ... WHERE idempotency_key = 'eval-forced-failure'` → 0 rows post-failure) |
| W-F7 | GK-192 integration-level negative proof: a member row citing a population from question A but an applicability judgment from question B, constructed via direct `repository.js` white-box misuse (bypassing `service.js`'s own safe construction entirely) | **REJECTED** by the real composite FK (`market_population_member_applicability_id_ob...`) — GK-192 is closed at the DB, not by writer discipline |
| W-F8/W-F10 | Retry with the SAME `idempotencyKey` after a successful commit | Recovers the SAME `populationId`, creates zero new rows |
| W-F9 | Legitimate reevaluation: same subject, DIFFERENT `populationRuleVersion` | Genuinely NEW `MarketPopulation`, not blocked by any uniqueness rule; the SAME `ValuationQuestion` and the SAME `MarketObservation`s are correctly reused (resolve-or-create convergence) — only the population differs |
| W-F10 (concurrency) | Two SIMULTANEOUS `evaluateMarketPopulation` calls under the identical `idempotencyKey` (`Promise.all`) | **A real, previously-undetected bug, found and fixed this dispatch — see GK-193 below.** Both transactions converge on identical MO/VQ/Applicability/Population rows (content-hash dedup, correct); the loser's `claimIdempotencyKey` insert raced into a real `23505` unique violation. Fixed: after `ROLLBACK`, the catch block detects the specific `idempotency_key` constraint violation and re-reads the winner's now-committed `result_snapshot` via `checkIdempotencyReplay`, returning it exactly as an ordinary replay would — the raw Postgres error never reaches the caller. Proven: both calls resolve to the SAME `populationId`; exactly ONE `market_population` row exists for the raced rule version, not two |

**GK-193 (NEW, this dispatch, FIXED):** idempotency-claim concurrency race in `evaluateMarketPopulation`'s catch block. Banked in `docs/TICKET-REGISTRY.md`.

**Test-construction note (not a product defect):** the first W-F7 attempt used `basePayload()`'s shared `'a'/'b'/'c'` observations for both question A and question B — since content-hash resolve-or-create converges those to the SAME `market_observation` rows regardless of which question evaluates them, the malicious `(market_population_id, observation_id)` pair had ALREADY been legitimately inserted, and `bulkInsertMembers`'s own `ON CONFLICT (market_population_id, observation_id) DO NOTHING` silently swallowed the probe row before the composite FK was ever evaluated — the test reported "did NOT reject" even though GK-192's real protection was never actually exercised. Same class of dedup-key/FK-isolation confound already fixed once in `tests/d5c-market-population-migration-contract.test.js`. Fixed by introducing a dedicated `'gk192-probe'` observation, evaluated ONLY under question B, guaranteeing the probed `(population, observation)` pair had never existed as a legitimate member — isolating the FK check cleanly. Re-run: real rejection confirmed (`foreign key constraint "market_population_member_applicability_id_ob..."`).

## Write batching

`bulkInsertMembers`, `bulkResolveOrCreateMarketObservations`, `bulkResolveOrCreateApplicability` each issue exactly 2 round trips per table regardless of batch size (bulk `INSERT ... ON CONFLICT DO NOTHING` + one bulk `SELECT ... WHERE content_hash = ANY($1::text[])`) — never "for each observation: await INSERT." Proven by monkey-patching the pool's own `.connect()`/`.query()` to count real SQL statements issued: **N=20 observations → 15 total statements** (`BEGIN`, idempotency check, VQ resolve+select, MO bulk insert+select, AP bulk insert+select, MP resolve+select, member bulk insert, claim, `COMMIT` — a fixed constant plus O(1) per table, not O(N)). All 20 members recorded correctly.

## Idempotency (F10) design

Deliberate duplication of GK-163's class-wide pattern (`src/modules/valuation/idempotency.js`), NOT a shared import from `src/modules/assets/idempotency.js` — reasoned explicitly in the module's own header: `assets/idempotency.js` is private to a LIVE, production-serving module; duplicating ~50 lines is safer than refactoring a live module during a Milestone-Ten-gated, zero-call-site dispatch. Same underlying `idempotency_key` table (`operation`/`idempotency_key`/`principal_id`/`result_snapshot`/`request_fingerprint`, no schema change needed), namespaced operation name (`d5-evaluation:evaluateMarketPopulation`) so no collision with the assets module's own operation names is possible in the shared table.

`computeRequestFingerprint` hashes the FULL semantic payload (asset, identity assignment, ValuationQuestion content hash, population rule version, sorted observation content hashes) — not just one row — so a same-key-different-payload retry throws `IdempotencyConflictError` rather than silently returning an unrelated prior result. This is EXECUTION-level identity, distinct from and layered atop each table's own ROW-level content-hash dedup (a single content hash proves "this row is the same fact," not "this whole multi-row write attempt is the same execution as an earlier one" — the module's own header names this distinction explicitly).

## `comp_snapshot` compatibility ruling

**DEFER**, consistent with M1-A's ruling in the D5C design pass (`docs/D5C-MARKET-POPULATION-DESIGN-REPORT.md`, Deliverable A/M1). `recordCompSnapshot` exists in the codebase with zero call sites — confirmed again this pass, unchanged. No FK from `comp_snapshot` to `MarketPopulation`, no writer, no trigger populating it from this module, no assumption that any existing `comp_snapshot` row corresponds to a `MarketPopulation`. This isolated writer module never references `comp_snapshot` at all. Materializing that projection remains explicitly future work behind its own boundary — not scoped into this dispatch's 12 authorized items, and not built here.

## W3 — latency methodology

What is measurable NOW, isolated: `evaluateMarketPopulation`'s own transaction latency — issues only Postgres statements (no HTTP/provider/model calls), so its wall-clock cost is a direct function of round-trip count and row volume, not of anything this dispatch doesn't control. The write-batching proof above establishes the round-trip shape (a fixed constant + O(1) per table, independent of N observations) that any future latency BUDGET must be built on.

What is explicitly NOT measurable yet, and NOT claimed here: end-to-end handler latency (this isolated transaction wired into a real request path, composed with identification/pricing/comps latency) — that requires the runtime wiring this dispatch is explicitly prohibited from building. Any comparison against PERF-1's ~3.5s median handler latency remains **HYPOTHESIS** until Milestone Ten authorizes that wiring and a real handler-level measurement is taken. Recorded here as an open methodology note for the future runtime-wiring dispatch, not answered.

## GK-138 test plan (for the future runtime-wiring dispatch)

Handler-Wiring Verification (CLAUDE.md, GK-138) requires a real-handler smoke invocation for any dispatch that adds/moves a call site or threads a new parameter through a live handler. When D5D's writer is eventually wired into a real request path (post-Milestone-Ten, separately authorized), that dispatch must include:
1. A real invocation of the wired handler (`import handler` + mock `req`/`res` + stubbed `fetch`) proving the new D5 write call site executes without throwing and produces the expected response shape — not just a unit test of `evaluateMarketPopulation` in isolation (this dispatch's own proofs are exactly that isolation, and are explicitly insufficient for GK-138 compliance on their own, per its own precedent).
2. Confirmation that `attemptDurablePersistence`'s fail-safe contract (never throws) holds when invoked from the real handler under a real forced-failure condition, not just the isolated harness used here.
3. A regression run of the existing handler test suite, to catch the exact class of out-of-scope variable reference GK-138 was opened to name.
4. Re-verification, at that time, that GK-180 is being opened deliberately and explicitly (not silently) — the runtime-wiring dispatch's own report must say so in its terminal block, the way this report says the opposite below.

## GK-180 — confirmed UNAFFECTED (proven, not claimed)

Real `data1_dev` census, this session, before and after every proof in this dispatch: `valuation_question` 0, `applicability` 0, `market_population` 0, `market_population_member` 0 — unchanged throughout. `tests/valuation-module-boundary.test.js`'s zero-production-call-sites check (13/13, including the standard module-boundary checks) confirms statically: no file under `api/` imports anything from `src/modules/valuation/`, not even the public `index.js`. **GK-180 = zero writer call sites remains literally true.**

## What was NOT done (explicitly prohibited, per the scope-correction ruling)

No `api/enrich.js` D5 call site. No `api/comps.js` D5 call site. No feature flag added to any live handler. No production operator writer path. No live production D5 rows. No deployment. No push. No D6/asset-minting functionality. No production capture.

## Terminal

```
1 IDENTITY      LIVE -- D1 . D4 (schema, Phase A)
2 EPISTEMOLOGY  LIVE -- D5A . D5B
3 ECONOMIC      LIVE SCHEMA -- D5C
                ISOLATED WRITER PROVEN -- D5D (this report)
4 ACTION        ABSENT -- D6 . D7 . D8
5 OUTCOME       ABSENT -- D9

TRUSTWORTHY CLOSED-LOOP OUTCOMES: 0

NEW, FIXED THIS DISPATCH
GK-193 -- idempotency-claim concurrency race (isolated module only,
          zero production exposure -- caught by this dispatch's own
          negative-proof test suite before any runtime wiring existed)

STAYS
GK-180 = zero writer call sites (0 rows in every D5B/D5C/D5D table,
         confirmed live, proven not merely claimed)

HOLD (Milestone Ten precedence, per the user's own scope-correction ruling)
D5D runtime wiring
production capture
D6-D9
```

**D5D ISOLATED WRITER BRIDGE — DESIGN + PROOF PASS**
**21/21 `tests/d5d-valuation-writer.test.js`, 5/5 `tests/d5d-w2-eligibility.test.js`, 13/13 `tests/valuation-module-boundary.test.js`**
**GK-180 unaffected. Runtime wiring remains a separate, future, explicitly-gated authorization — NOT granted by this pass.**
