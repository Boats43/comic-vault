# Outcome-spine traces — GK-180 and GK-261 (TRACE / PROPOSAL ONLY)

Dispatch: "OUTCOME SPINE FIRST" (2026-10-02). Nothing in this file is implemented. No gate was removed, no schema was changed. Every claim is tagged **VERIFIED** (personally read in source/schema or executed against the repo / a read-only DB query) or **SUBAGENT-ONLY**.

## GK-180 — why Production scans do not persist valuation → decision

### A. Early-return condition (VERIFIED)
- `src/lib/outcome1RuntimeBridge.js:84` `if (!enabled)` → `declineReason: 'outcome1-disabled'` (`enabled` = `process.env.D5D_RUNTIME_ENABLED === 'true'`).
- `src/lib/outcome1RuntimeBridge.js:87-88` `if (environment !== 'development')` → `declineReason: 'wrong-environment'` (`environment` = `GRAILKEY_CATALOG_ENVIRONMENT`).
- The same two gates guard the D5D chain it is nested in: `src/lib/d5dRuntimeBridge.js:172-176`.
- **Second, structural gate:** the Outcome #1 call at `api/enrich.js:13512` only runs when the D5D chain wrote successfully in the same request (`d5dOutcome.attempted && !dryRun && !declineReason && result.populationId`) **and** the collection item resolves to an already-linked gk_asset with a live identity assignment (`resolveEligibleSubject`, `src/modules/valuation/service.js:64-85`). So even with the flags on, a Production scan of an unlinked item can never write.

### B. Callers (VERIFIED)
`attemptOutcome1` has exactly one runtime caller: `api/enrich.js:13521` (inside the D5D block). Other references are `src/lib/marketplaceOutcomeBridge.js` (mapping helper) and `tests/outcome1-runtime-bridge-unit.test.js`.

### C. Durable writes the bridge performs (VERIFIED)
1. `recordValuation` → one `valuation_event` row (+ one `domain_event`, `valuation.computed`, same transaction, + one `idempotency_key` claim).
2. `recordDecision` → one `decision_event` row (`recommendation`, `reason_codes` = blockers/warnings only, `valuation_event_id`) (+ `domain_event` + idempotency claim).
It never writes an operator action, outcome, or listing. (The D5D chain upstream writes valuation_question / market_population / observations / applicability — heavier, and a separate flag.)

### D. Source of the existing Production rows (VERIFIED — read-only Production query)
3 `valuation_event` + 2 `decision_event` rows. **None came from this bridge.** They came from the capture path, `src/modules/capture/service.js:183-196` (`recordValuation`/`recordDecision` fed by `mapping.mapValuation/mapDecision` from the **client-supplied** scan payload `outcome`): 
- Old Man Logan #25 asset: $0.00 (the GK-226 `"$NaN"` parse defect) and a manual correction row $15.28 (`build_sha = GK-226-manual-valuation-correction-2026-09-20`).
- New Mutants #98 asset: $360.59.
- All `method = engine-computed`, `market_population_id`/`comp_snapshot_id` NULL, `build_sha = 'unknown'` for the two capture rows (`mapping.js:125` falls back to `'unknown'`), decisions `RESEARCH` with `reason_codes = ["active_ask_derived"]` (the pricing-source string, not blockers/warnings).
- Caveat: the value on these rows is a client-asserted number labelled `engine-computed`; the server did not compute it.

### E. Why the Development gate exists (VERIFIED — commits read)
- `53ce539` (2026-09-09) "D5D Chain #1: runtime wiring live in Development, GK-180 narrow-open 0 → 1": "hard `GRAILKEY_CATALOG_ENVIRONMENT==='development'` pin — Production/Preview D5D stay disabled regardless of the flag… This is not production capture." It was deliberately held from Production.
- `aa20b6f` (2026-09-09) "Outcome #1…": "Same environment/flag discipline as D5D (Development-only, fail-safe)."
- Invariants it protected: no durable economic write into a Production kernel that was then unproven (Production physical-asset tables were not yet reconciled — GK-215/216, 2026-09-19); Milestone Ten H8 gating of any Production capture; D5D's WAL/volume unknowns; and the "never mint, existing link only" rule.

### F. Write inventory and semantics (VERIFIED unless tagged)
| Property | Finding |
|---|---|
| Append-only vs mutable | INSERT only. No UPDATE path in `recordValuation`/`recordDecision`. **No DB trigger** enforces it on `valuation_event`/`decision_event` (trigger grep across `db/data0` shows triggers only on the identifier/observation/D5 tables) — immutability is convention. |
| Idempotency | GK-163 class-wide law: `checkIdempotencyReplay` + `computeRequestFingerprint` + `claimIdempotencyKey`, per `operation`. **BUT `if (!idempotencyKey) return null` (`idempotency.js:60`) — and the bridge passes `req.body?.d5dIdempotencyKey || null`; no client code ever sends that field (grep). So in real traffic the key is null and every call would append a NEW valuation and a NEW decision (every refresh/auto-refresh).** |
| Transaction boundary | Each of `recordValuation` and `recordDecision` is its own `BEGIN … COMMIT` (event row + `domain_event` + idempotency claim atomic inside it). The two are **separate transactions**. |
| Partial failure | Valuation commits, decision fails → an orphan valuation with no decision; the bridge returns `decision-write-failed` and does not throw (response unaffected). A retry **with a key** replays the valuation and writes the decision (heals). A retry without a key duplicates the valuation. |
| Retry behavior | Safe only with a stable key (see above). |
| Cross-principal protection | `principalId` comes only from a verified Bearer token (`api/enrich.js` ~13430-13445); both writers run `assertPrincipalActive` + `assertAssetExists` + `assertPrincipalOwnsAsset`; the asset id comes from `resolveCollectionItemLink` (returns null for a non-owner). |

### G. Smallest Production-safe change — PROPOSAL (do not enable without explicit authorization)
1. **Decouple Outcome #1 from D5D** for Production: a new narrow flag `OUTCOME1_PRODUCTION_ENABLED` (default off) permitting `environment === 'production'` for the valuation→decision write only; `marketPopulationId` stays NULL (a legal state per `recordValuation`).
2. **Server-derived idempotency key** (never client-supplied): `sha256(principalId | gkAssetId | valueAmount | currency | numericGrade | decision.action | reasonCodes | buildSha)`. An unchanged recomputation replays; a genuinely different valuation appends.
3. **Real build identity:** decline if `buildSha` is not a resolvable git sha (never write `'unknown'`).
4. **Existing link only:** reuse `resolveEligibleSubject`; never mint; unlinked item → no write.
5. **Write at decision points**, not on every automatic refresh: only when the request carries explicit operator/scan-save intent (volume + meaning: a durable decision is something an operator can act on).
6. **Optional hardening:** one combined transaction for valuation+decision to remove the orphan-valuation window (the keyed retry already heals it, so this is not a blocker).
7. **Real Production proof before declaring ready:** one real Production scan of Jimmy's linked asset creates exactly one valuation + one decision, correct principal/asset, and a retry creates zero duplicates.
This closes the original Development-only invariants only if each is re-proven for Production; none is assumed.

## GK-261 — write-path census for `modelPredictedGrade*` and `identityAuthority`

### Findings (VERIFIED — `src/modules/collection/repository.js`, `api/collection.js`, `api/enrich.js`, `src/App.jsx`, `src/lib/dataQualityGuard.js`)
| Key | Source / minted by | INSERT path | UPDATE / ON CONFLICT path | Client material can reach it? | Server recomputes / owns? |
|---|---|---|---|---|---|
| `modelPredictedGrade`, `…Reason`, `…Confidence`, `…At` | **Client only**: `applyFirstModelPrediction` (`dataQualityGuard.js:150-158`) called from `App.jsx` (new item ~12237; backfill from the item itself ~14590, ~14882). The server never computes them (no reference in `api/`). | `upsertItem` `INSERT … VALUES`, which strips **only the six grading keys** (`stripFullyProtectedGradingKeysSql`) → these four are inserted verbatim from the client blob | `protectedAttributesMergeSql`: existing value is the base, then `|| incoming`; **an incoming present value (including explicit `null`) overwrites; only an *omitted* key is preserved** | **Yes** — forge, overwrite or clear through `/api/collection` | **No** |
| `identityAuthority` | Server mints per request in `api/enrich.js:12938` from a validated manual correction, **returns it in the response only; no durable write**. The client merges it (`mergeIdentityAuthority`) and persists via `/api/collection`. | verbatim from the client blob | same overwrite semantics as above | **Yes** | **No durable read anywhere on the server** (the only server read of durable attributes is the grading/category fallback at `api/enrich.js:2668-2680`). Its consumers are client-side (identity-lock merging). |
Additionally (VERIFIED, from the Production census): 131 of 139 Production collection items carry `modelPredictedGrade`; **none of that was server-minted**.

### Proposal — smallest closure, GK-260 pattern (do not implement)
1. Move the five keys (`modelPredictedGrade`, `…Reason`, `…Confidence`, `…At`, `identityAuthority`) into the **fully-protected** set: existing row always wins; stripped from the INSERT `VALUES` list; an ordinary `/api/collection` write can never set, change or clear them.
2. **`identityAuthority`:** written only by an internal patch path (like `applyGradingAuthorityPatch`) called from `api/enrich.js` after a validated manual-correction request in an authenticated `ownedRefresh`/`ownedReidentify` flow; the client reads it back from the collection GET instead of persisting its own copy.
3. **`modelPredictedGrade*`:** must be minted from the **server's own model result**. `/api/grade` already runs under a verified principal; have it keep a short-TTL, principal-scoped record keyed by `scanId` (server-side only). The collection create call sends only the `scanId` — **never values** — and the server claims that record to write the baseline through an internal patch. No record / unclaimable → the baseline stays absent (UNKNOWN), never client-supplied. This record is the direct precursor of `model_prediction_event` and obeys the same law.
4. Adversarial tests (GK-260 style): forged insert / overwrite / null-clear via `/api/collection` rejected for all five keys; internal patch SET/CHANGE/CLEAR; legacy rows keep their existing (client-written, unverifiable) values — they are labelled as such, not retro-certified.
5. No schema change required for this closure.
