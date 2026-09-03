# ADR-VALUATION-001 — ValuationQuestion + Applicability (D5B Semantic Closure)

**Status:** D5B SEMANTIC CLOSURE PASS — 0015 DESIGN RELEASED (2026-09-03). Docs/rulings only. No SQL. No migration. No runtime wiring. No 0015 schema written by this pass — this ADR is the conceptual boundary 0015 must build against.

## Context

D5A shipped the `MarketObservation` substrate (`db/data0/0014_d5a_market_observation.sql`, live in `data1_dev` as of the D5A LIVE MIGRATION PASS commit). D5B's job is to settle, in docs only, what sits on top of it: the durable representation of *what is being asked* (ValuationQuestion) and *how GrailKey judged whether a given observation answers it* (Applicability). This ADR closes that Phase 0 audit's open contradictions and bans the transient `fetchComps()` parameter bundle from leaking into permanent schema.

Ratifies, verbatim in substance, the six rulings (R1–R6) issued for this pass, plus two banked findings (A, B) and one evidence verification (P2a). Follows D5A's own proof discipline: every claim below that concerns live code is cited to a real file:line, not asserted from memory.

## Decision

### R1 — `ValuationQuestion.asset_id` is `NOT NULL FK → gk_asset(id)`

A plausible future assetless workflow exists (pre-acquisition "what would a 9.4 of this be worth" before GrailKey owns the physical instance), but it does not justify a nullable column in the first D5B schema. `NOT NULL` structurally enforces Q18's current invariant; relaxing it later is additive; tightening it later requires deciding what to do with orphan rows already created. No current D5B writer legitimately creates an assetless question. Ship the stricter invariant now — `DROP NOT NULL` is a deliberate future migration, not a default to design around today.

### R2 — field admission rule: only if it changes the correct answer

A field belongs in durable `ValuationQuestion` only if changing it changes what a correct answer to the valuation question would be. Applied mechanically below to `fetchComps`'s actual live parameter list (`api/comps.js:998-1029`, the transient caller-supplied bundle the Phase 0 audit found — confirmed here field-by-field, not assumed):

| Parameter | Admits? | Reasoning |
|---|---|---|
| `grade`, `numericGrade` | **YES — semantic content** | Target grade assumption; directly selects the multiplier row (`getGradeMultiplier`/`getRawGradeMultiplier`) — changing it changes the correct valuation. |
| `isGraded` | **YES — semantic content** | Raw-vs-slabbed disposition; selects between `CGC_MULTIPLIERS` and `RAW_MULTIPLIERS` — changes the valuation target itself, not just how it's queried. |
| `variant` | **YES — semantic content** | Variant-scope assumption; distinct variants are distinct valuation targets (variant multiplier ladder). |
| `year` (resolved/confirmed value only, never the raw candidate) | **YES — semantic content, conditional** | Selects era band, grade-multiplier era split (vintage/modern), and PC year-threshold eligibility — changes the correct answer. Only the settled year belongs; a candidate year still being reconciled does not. |
| `title`, `issue`, `author`, `publisher`, `assetType` | **NO — identity, not assumption** | Per R6 below, these are superseded by an identity reference (`asset_id` / adopted-identity revision), never copied as raw metadata into ValuationQuestion content. |
| `imageSearchTitle`, `labelType`, `categoryId`, `appId`, `certId` | **NO — query/API plumbing** | Provider query construction and credentials; pure recall/precision machinery, never a valuation assumption. |
| `creator` | **NO — query/recall input** | Drives `ARTIST_PATTERNS` query construction and soft creator-match filtering; not a caller-declared valuation assumption. |
| `cvVolumeStartYear` | **NO — reconciliation input** | Explicitly named in the ruling as non-content; ComicVine volume-launch-year corroboration signal for Filter 0c, not a semantic assumption. |
| `artistOverride` | **NO — reconciliation input** | Explicitly named; resolved-identity artist hint for narrowing, not a caller-asserted valuation assumption. |
| `signedConsensus` | **NO — reconciliation input** | Explicitly named; a pool-corroborated signal feeding Filter 2b, not a declared assumption — do not conflate with a genuine future "signed disposition" valuation field, which would need to be modeled separately if ever admitted. |
| `issueAuthorityPresent`, `issueAuthorityStatus` | **NO — reconciliation/diagnostic input** | Explicitly named; presence/status of upstream issue-authority tracking, routes `classifyEvidenceRow`'s gate — implementation state, not a valuation assumption. |
| `yearIsContested` | **NO — reconciliation/diagnostic input** | Same class as the two above — `yearAuthority==='CONTESTED'` routing signal for Filter 0c, not an assumption about the valuation target. |

Net: of `fetchComps`'s 22 live parameters, exactly **4 semantic classes** (target grade, raw/slabbed disposition, variant scope, resolved year) survive R2's test. The other 18 are query construction, credentials, or reconciliation/diagnostic routing — none belong in durable `ValuationQuestion` content. Do not fossilize the rest of this parameter list into schema.

**No live field currently maps to "edition/printing scope"** (an R2-named valid category) — `fetchComps` has no dedicated printing/edition parameter today; printing distinctions currently live inside free-text `variant`. Flagged for explicit resolution at 0015 design time, not force-fit here.

### R3 — question identity vs. judgment logic (Q19 three-way separation, ratified)

`ValuationQuestion` = what is being asked. Applicability provenance = how GrailKey judged whether an observation applies. Filter/model/provider implementation state belongs on the Applicability side, never in `ValuationQuestion` identity.

**Verified live instances that must never enter `ValuationQuestion` identity:**
- `COMP_FILTER_VERSION` (`src/lib/compHygiene.js:666`, currently `12`) — a filter-implementation version, already used today to key the active-comps cache and gate cache validity (`api/enrich.js:6601`, `6652`, `10540`). A filter-logic bump must produce a new Applicability judgment over the *same* `ValuationQuestion`, never a new question.
- `modelVersion` (`src/lib/evidenceContracts.js:53`, `src/lib/scanLog.js:70,190`) — describes the Vision/model call, same class as filter version.

Required invariant, restated: filter/model logic changes → same `MarketObservation`, same `ValuationQuestion`, new Applicability judgment — never a new `ValuationQuestion`.

### R4 — no `ValuationAttempt` table

Two abstractions only, not three. `ValuationQuestion` is immutable semantic content, canonically deduped by content hash — asking the identical semantic question again does not mint a new row. The repeated-occurrence/result abstraction already exists downstream: `ValuationEvent`. Pipeline:

```
PhysicalAsset
     |
ValuationQuestion
     |
Applicability judgments
     |
MarketPopulation
     |
comp_snapshot
     |
ValuationEvent
```

Two runs a month apart may reuse the same `ValuationQuestion`, produce new Applicability judgments if judgment logic changed, produce distinct `MarketPopulation`s/snapshots, and produce distinct `ValuationEvent`s. No `ValuationAttempt` table in D5B.

### R5 — question hash

`ValuationQuestion` gets its own versioned content-hash contract, reusing the D5A `mo-hash-v1` discipline: framed serialization, explicit NULL/presence semantics, no delimiter ambiguity, canonical decimal (never IEEE-754) representation for any numeric grade component, old hashes never recomputed after a contract-version bump. `asset_id` participates in the hash tuple — the same assumptions applied to a different physical asset are not the same durable question. Identifier/model/filter implementation versions never participate (R3). Exact tuple is 0015 design work, scoped by R2's field classification above.

### R6 — Applicability verdict model

D4's `NONE` / `CONTESTED` / `CORROBORATED` vocabulary is not reused mechanically — Applicability is a distinct domain concept from identifier-assertion resolution. Minimum semantics: no row = no judgment; `APPLICABLE`; `NOT_APPLICABLE`; `CONTESTED` only if contradictory judgments genuinely need durable representation. `CORROBORATED` is not imported merely because D4 uses the word. Every judgment retains: observation, `ValuationQuestion`, verdict, rule/reason, judgment provenance/version (this is where `COMP_FILTER_VERSION`/`modelVersion` actually live, per R3), recorded time, principal/model where applicable, and append-only/supersession history. Exact enum/string design is 0015 work.

### V1–V4 — required rulings for the 0015 design dispatch (banked ahead of schema work)

Raised in review of this ADR; verified against repo evidence below, not taken on faith. These bind whichever future dispatch writes 0015's schema — no schema is written by this pass.

**V1 — verdict and resolution-authority are two axes on Applicability, never one collapsed enum.** R6 above named the verdict states (`APPLICABLE`/`NOT_APPLICABLE`/`CONTESTED`) but did not separately name a confidence/support scale. Precedent for the split: ADR-IDENTIFIER-001 Ruling 8 (`docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md:68-73`) already ruled `issuing_authority` (external scheme governor) structurally distinct from `resolution_authority` (GrailKey's own confidence state) rather than collapsing them — "rejected with high confidence" and "applicable but contested" are both real and unrepresentable in a single enum, the identical collision class. **Ruling: R6's `Applicability` gets two columns, not one — `verdict` (what the judgment concluded) and a separate resolution-confidence scale (how well-supported the judgment is).** Exact scale is 0015 work; the two-axis requirement is ratified here.

**V2 — supersession is not inherited by default; prove the need before importing D4's machinery.** D4's `superseded_by` pattern (`db/data0/0013_d4_identifier_fabric.sql:75-77,290,302-325`; `docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md` Rulings 9/20) brought a trigger, a `SELECT ... FOR UPDATE` row lock held through transaction completion, a proven acyclic-graph argument, and an application-level `40P01`-retry requirement — justified there because an identifier *assertion* is a standing claim that must be correctable in place. An Applicability judgment is different in kind: a new judgment under a new rule/model version (R3) is naturally a **new row** over the same `(observation_id, question_id)` pair, and "current" is a query ordered by rule/model version or `recorded_at`, not a mutation. **Ruling: default 0015 to append-only-without-supersession for Applicability.** If a future concrete need surfaces to correct a judgment *under an unchanged rule version* (a data-correction case, not routine rule evolution), that is a deliberate, separately-scoped addition of D4-style supersession — never a default import of the lock/retry surface.

**V3 — reuse D5A's serializer verbatim; do not author a second content-hash contract.** `src/lib/marketObservationHash.js` already implements exactly the shape R5 calls for: `encodeField` (`marketObservationHash.js:86-95`) is a presence byte (`PRESENT`/`ABSENT`, lines 78-79) + 4-byte big-endian length prefix + UTF-8 body, `serializeMarketObservationTuple` (lines 103-120) prepends `HASH_CONTRACT_VERSION` as the first framed field, and `computeMarketObservationHash` (lines 126-128) is the SHA-256 wrapper — all fully generic, zero comic-specific logic in this layer. **Ruling: 0015's `vq-hash-v1` serializer reuses `encodeField` directly (import, not reimplementation) and follows the identical version-prefix-first framing.** Two independently-written hash contracts in one system is a guaranteed future divergence; this is shared code, not a parallel implementation.

**V4 — target grade needs `market_observation.grade_numeric`'s own treatment: canonicalization, and confirm the basis question directly.** `canonicalMinimalDecimal` (aliased `canonicalGradeString`, `marketObservationHash.js:224-239`) already canonicalizes trailing zeros (`"9.40"→"9.4"`, `"10.00"→"10"`) — 0015's target-grade field must reuse this function, not re-derive it. On the basis qualifier: checked directly, R2's admitted `isGraded` field is a coarse raw-vs-slabbed boolean and does **not** disambiguate *which* grading authority's scale is meant — the live pricing math itself only splits `CGC_MULTIPLIERS`/`RAW_MULTIPLIERS` by that same boolean (CLAUDE.md, "Grade multipliers (era-aware)"), so `isGraded` alone is not yet the same granularity as `market_observation.grade_basis`. GK-183 already named the identical ambiguity one layer down (a single provider reporting on two undisclosed sub-scales). **Ruling: 0015 must add a nullable `grade_basis`-style qualifier to `ValuationQuestion`, using the same source-asserted (never inferred) semantics and reusing `normalizeGradeBasis` (`marketObservationHash.js:249`) — `isGraded` does not already cover it.**

### A — `rejectedSamples` cap is not evidence policy

`soldVerification.js:270-278` caps `rejectedSamples` at **3** (`if (rejectedSamples.length < 3)`) for transient response/debug purposes; confirmed the same shape recurs at the two fallback sites (`rejectedSamples: fallbackRejectedSamples` — `src/lib/soldVerification.js:1171`, `1204`). Everything past the third rejected row is currently discarded, not durably recorded anywhere.

**Banked ruling:** this limit must never become the durable Applicability retention model. A future D5D writer must persist every applicability judgment generated for a retrieval/question batch, subject to rights and writer gates — if the engine evaluates 83 observations, the durable writer accounts for all 83 judgments, not the first 3 rejected samples. UI sample caps, debug sample caps, response truncation, and logging caps are explicitly excluded from durable evidence persistence design.

### B — Q16 topology/retention finding, banked against the pre-D6 gate

Second D5-phase pass producing the same infrastructure signal (first: D5A's own comp-snapshot WAL-sizing finding, `docs/MASTER-BOARD.md` Phase A ruling A4a). Applicability volume can equal or exceed `MarketObservation` volume, because every observation may be re-evaluated against changing valuation assumptions (a re-run under a new `ValuationQuestion`, or a filter/model version bump per R3, both mint new Applicability rows over the *same* observation). Durable note, banked into `docs/MASTER-BOARD.md`'s "Production/Development isolation risk" pre-D6 gate section (see that file for the full topology context this attaches to):

- `MarketObservation`: ~20–100 observations per retrieval batch (D5A's own sizing basis).
- `Applicability`: potentially one judgment per observation per `ValuationQuestion` — not 1:1 with `MarketObservation`.
- Repeated grade/identity/variant assumptions can multiply judgment history beyond the observation count.
- High-volume Applicability WAL may equal or exceed `MarketObservation` WAL.
- Therefore retention/recovery sizing must account for **both** layers before D6/prod-volume release — not `MarketObservation` alone.

No infrastructure fix in this dispatch.

### P2a — RESOLVED, positively proven (not inferred)

Verified directly against the D5A migration-contract suite, not inferred from this audit. `tests/d5a-market-observation-migration-contract.test.js`:

- **Targets its designated scratch schema:** `assertScratchTarget()` (lines 99-112) checks `current_schema()` against the expected scratch name on every call; the schema itself is generated per-run (`const SCHEMA = \`d5a_0014_scratch_${Date.now()}\`;`, line 129).
- **Explicitly refuses `data1_dev`:** line 105-107, `if (actualSchema === 'data1_dev') throw ... 'refusing unconditionally, regardless of any expected value'` — checked before the expected-schema comparison, so it cannot be bypassed by a mismatched `expectedSchema` argument. Proven, not merely asserted: lines 118-127 deliberately point the real client at `data1_dev` (`SET search_path TO data1_dev`) and assert the guard actually refuses, using the real function.
- **Refusal occurs before any DDL:** `assertScratchTarget` is called immediately before every DDL-mutating statement on the 0014 forward/rollback text — pre-forward-apply (line 164, before the apply at line 165), pre-rollback (line 521, before line 522), pre-reapply (line 531, before line 532) — not merely once at the top of the script.
- **Protection does not depend on unsafe pooled session-scoped `search_path`:** a single dedicated `pg.Client` against `GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED` is held open for the script's entire lifetime (line 94), never a pooled `pg.Pool` — the exact hazard class GK-178 proved live. Verified, not merely asserted: `pg_backend_pid()` is captured once after connecting (line 96) and re-checked inside `assertScratchTarget` itself (lines 100-104) on every call; a mid-script backend change throws a `SAFETY ABORT` before the schema check even runs.

This guard is already live in the repository (commit `6371acb`, "D5A 0014 post-live banking closure: harness fix + positive scratch-schema containment") — no code change required by this pass. **P2a: CLOSED, proven from repository/test evidence, per the citations above.**

## Final D5B domain shape (0015 conceptual boundary)

Still no SQL. Semantic boundary for 0015 design to build against:

**ValuationQuestion** — immutable; `asset_id NOT NULL FK → gk_asset(id)` (R1); vertical-neutral semantic valuation assumptions only, admitted per R2's table above (target grade — canonicalized via `canonicalGradeString`, V4 — raw/slabbed disposition, variant scope, resolved year); nullable source-asserted `grade_basis`-style qualifier, reusing `normalizeGradeBasis` (V4); identity reference where necessary rather than copied comic metadata; deterministic/versioned `vq-hash-v1` content hash, built on the reused `encodeField` framing (R5, V3); no valuation result; no provider/filter/model implementation state (R3).

**Applicability** — one `MarketObservation`; one `ValuationQuestion`; two-axis judgment — `verdict` and a separate resolution-confidence scale, never collapsed (R6, V1); generic reason/rule identifier; judgment/filter/model provenance (where `COMP_FILTER_VERSION`/`modelVersion` live, R3); own recorded time; append-only, **no supersession by default** (V2) — a rule/model-version bump mints a new row over the same `(observation, question)` pair rather than mutating one, "current" derived by query, not by trigger/lock machinery; a future need to correct a judgment under an *unchanged* rule version is a separately-scoped addition, never a default import of D4's lock/retry surface; no durable rejection sampling cap (A).

**Not in D5B:** `MarketPopulation`; `ValuationEvent` changes; a writer from `api/comps.js`; provider capture; backfill of discarded historical judgments; 0015 schema text itself; runtime wiring; D4-style supersession machinery unless a concrete need is separately demonstrated (V2).

## New/updated tickets

- **GK-185** (opened by this ADR) — `COMP_FILTER_VERSION`/`modelVersion` forward-constraint: neither may ever be admitted into `ValuationQuestion` identity when 0015 is designed; both belong on the Applicability judgment/provenance side (R3). Docs-only constraint, no code changed — no current schema exists yet to violate it.
- **GK-186** (opened by this ADR) — `rejectedSamples` cap=3 (`src/lib/soldVerification.js:270-278`, `1171`, `1204`) banked as a transient debug/UI limit, explicitly NOT the durable Applicability retention policy for the future D5D writer (Finding A).
- **GK-187** (opened by this ADR) — 0015's own schema-ruling pass must satisfy V1 (two-axis Applicability verdict/authority), V2 (no default supersession), V3 (reuse `marketObservationHash.js`'s `encodeField`, not a second hash contract), and V4 (`canonicalGradeString` reuse + `grade_basis`-style qualifier on `ValuationQuestion`) — gate ticket, not a defect; no code changed by this ADR.
- **GK-183** — unchanged by this ADR; grade_basis ambiguity is a `MarketObservation`-layer finding, not an Applicability/ValuationQuestion one, though V4 draws the direct parallel.
- **P2a** — resolved this pass; see above. No new ticket needed — already covered by the D5A banking-closure commit; recorded here for the registry's own grep-ability.

Full one-line entries added to `docs/TICKET-REGISTRY.md`.

## Census

Reviewed for this pass: `api/comps.js:998-1029` (`fetchComps` full parameter destructure, live), `src/lib/compHygiene.js:639-666` (`COMP_FILTER_VERSION`), `api/enrich.js:6601,6652,10540,12416` (filter/model version call sites), `src/lib/evidenceContracts.js:53`, `src/lib/scanLog.js:70,190` (`modelVersion`), `src/lib/soldVerification.js:255-304,1171,1204,1248` (`rejectedSamples`), `tests/d5a-market-observation-migration-contract.test.js` (full file, P2a proof), `db/data0/0014_d5a_market_observation.sql` + rollback (unmodified, referenced only), `docs/MASTER-BOARD.md` (Production/Development isolation risk section and Section 7, banking targets), `docs/TICKET-REGISTRY.md` (GK-178 through GK-184, next-ticket-number confirmation), `CLAUDE.md` (size check, current D5 state block). V1-V4 pass additionally reviewed: `docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md` Rulings 8/9/20 (`issuing_authority`/`resolution_authority` split, `superseded_by` trigger/lock/retry mechanism, precedent for V1/V2), `db/data0/0013_d4_identifier_fabric.sql:75-77,290,302-325` (the real supersession trigger, live SQL, cited not retyped), `src/lib/marketObservationHash.js` in full (`encodeField`, `serializeMarketObservationTuple`, `computeMarketObservationHash`, `canonicalMinimalDecimal`/`canonicalGradeString`, `normalizeGradeBasis` — confirmed reusable and generic, V3/V4).

## Compatibility Matrix

`N/A — documentation-only; no governed executable/domain/schema/migration surface changed.` (per the Reporting procedure, `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`, "Compatibility Matrix")

## What was NOT done

No SQL written or modified. No migration proposed. `db/data0/0014_d5a_market_observation.sql` and its rollback are unmodified. No runtime wiring in `api/comps.js`, `api/enrich.js`, or `src/lib/soldVerification.js` — all citations above are read-only evidence gathering, zero lines changed in any of those files. No `ValuationQuestion`/`Applicability` table designed at the column level — that is 0015's job, scoped by this ADR, not started here. No `MarketPopulation` or `ValuationEvent` change. No provider wiring. No GK-179 implementation (schema-name env-derivation remains blocked on the Production/Development topology gate, untouched by this pass). No DATA-0E-FULL modification. No stash/reset/clean. No production capture.

## Terminal

R1–R6 are internally consistent with each other and with D5A's prior rulings (Q18, Q19, `mo-hash-v1`). Findings A and B are banked in this document and in `docs/MASTER-BOARD.md`. P2a is positively resolved from repository/test evidence, cited above. V1–V4 are verified against real, cited D4/D5A code and ratified as binding inputs to the 0015 dispatch (gate: GK-187), not yet implemented — no schema exists to implement them into.

**D5B SEMANTIC CLOSURE PASS — 0015 DESIGN RELEASED, WITH V1–V4 BOUND AS REQUIRED INPUTS.**
