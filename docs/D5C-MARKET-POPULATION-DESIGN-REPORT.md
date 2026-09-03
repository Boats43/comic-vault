# D5C — MarketPopulation Design Report

**Terminal: D5C DESIGN READY FOR SCRATCH PROOF.** Design + physical schema proposal + real scratch proof, all four M1–M4 gates resolved. **No live migration. No writer. No `api/comps.js`/`api/enrich.js` wiring. No D5D bridge. `data1_dev` untouched.** Starting state: D1 + D5A + D5B live (`97338b7`).

## Deliverable A — current pipeline classification

`api/comps.js`'s real filter chain (verified by reading the actual filter implementations, not inferred from names):

| Filter | Classification | Why |
|---|---|---|
| 0a issue-number, 0b title similarity, 0c era consistency, 1 reprint, 1b variant contamination (hard), 1d cover-letter, 1e lot/bundle, 1e2 merchandise, 1f half-issue/ashcan, 1g TPB format, 1h trading card, 2 raw-vs-graded, 2b signed, 2c coverless, 3 grade proximity ±1.5 | **Applicability judgment** | per-observation relevance verdict against the question, independently evaluable |
| 4 price sanity (`applyPriceSanity`, `src/lib/compHygiene.js:1130`) | **Applicability judgment** | rejects an observation as untrustworthy (price outlier vs. the pool's own median) — a relevance/trust verdict, not a selection-among-equals decision. Computed with pool context, but the OUTCOME is still a per-observation reject/keep verdict, same class as the others |
| 1c variant preference — core match/mismatch | **Applicability judgment** | does this listing represent the variant asked about |
| 1c variant preference — thin-pool isolation fallback | **Population-construction rule** | a sample-size-driven decision about which candidate set to draw from |
| 3b creator-aware soft preference | **Population-construction rule** | never rejects, only reorders/prefers among already-applicable candidates |
| 5 dedup near-identical listings (`api/comps.js:2039-2057`) | **Population-construction rule** | explicitly selects a WINNER among applicable near-duplicates (keeps first-seen `price+title-prefix` key, drops the rest) — a selection decision among equally-valid candidates, not a trust judgment |
| `imageSearchTitle`, `labelType`, `categoryId`, `appId`, `certId`, creator-for-query-building | **Query plumbing** | |
| `cvVolumeStartYear`, `artistOverride`, `signedConsensus`, `issueAuthorityPresent/Status`, `yearIsContested` | **Reconciliation state** | already excluded from `ValuationQuestion`, R2/R3 |
| `COMP_FILTER_VERSION`, `modelVersion` | **Forbidden duplicate state** | already ruled to live only in Applicability provenance, R3/GK-185/GK-189 |

**No forbidden duplicate state was newly introduced.** The population-construction rules (1c isolation, 3b soft preference, 5 dedup) are exactly what `MarketPopulation` exists to durably record — see Deliverable C.

## Deliverable B — D3.3 dependency report

`comp_snapshot` (`db/data0/0012_d3_3_comp_snapshot.sql`) is **live** in `data1_dev` (D3.3 Phase B, 2026-09-02, `docs/DATABASE-MIGRATION-STATUS.md:131-139`) but carries **zero production writer traffic**: only 4 rows exist, all D3.3's own test-proof fixtures; all 78 `valuation_event` rows still have `comp_snapshot_id IS NULL`. `comp_snapshot.payload` is a single opaque, undecomposed `JSONB` blob (`0012:70-76`) — architecturally incapable of serving as a typed, individually-queryable membership relation.

| Dependency type | D5C needs it? |
|---|---|
| READ | No — D5C's schema reads nothing from `comp_snapshot`/`valuation_event` |
| IDENTITY | No — `market_population`/`market_population_member` mint their own ids |
| ORDERING | No |
| PROVENANCE | No |
| WRITE | **No** — this migration issues zero `INSERT`/`UPDATE` against `comp_snapshot` or `valuation_event`, and adds no column to either |

**D3.3 provides durable identity/context D5C could later bridge to (M1); D5C's own schema is defined completely independently of it this pass** — the hoped-for outcome, proven rather than assumed.

## Deliverable C — MarketPopulation semantic model

**Candidate C — header + membership rows**, chosen and justified against the historical question ("what evidence set did GrailKey actually use when it reached a valuation decision"):

- Candidate A (pure digest-only event) fails M3's zero-code reproducibility test — a hash proves integrity, never enumerates membership without re-deriving it.
- Candidate B (bare membership relation, no header) has no single place to hold population-level identity (rule version) or provenance (principal, correlation_id, recorded_at) without duplicating it onto every member row.
- Candidate C satisfies M3 directly: every member is a real, individually queryable, permanently joinable row.

## Deliverable D — identity specification

**Header (`market_population`) identity** — content-hash only (`market-population-hash-v1`), tuple: version tag, `valuation_question_id`, `population_rule_version`, `memberSetDigest` (itself a fold of the sorted `(observation_id, member_status)` set). Classification of every field:

| Field | Class |
|---|---|
| `valuation_question_id` | population identity |
| `population_rule_version` | population identity |
| member set (via digest) | membership identity, folded into population identity |
| `recorded_by_principal_id`, `correlation_id`, `recorded_at` | provenance/lifecycle metadata — excluded from the hash |
| — | no valuation result field exists on either table |
| `COMP_FILTER_VERSION`/`modelVersion`/query plumbing | forbidden — excluded, live only on `applicability` |

**Membership (`market_population_member`) identity** — no independent content hash; identity is `(market_population_id, observation_id)`, `UNIQUE`-indexed as the dedup key (a population can never list the same observation twice).

## Deliverable E — historical reproducibility proof

`SELECT observation_id, member_status, exclusion_reason FROM market_population_member WHERE market_population_id = ?` returns the exact, complete, individually-typed membership set — real FK-joinable rows, not a re-derivation. Proven live in scratch (`tests/d5c-market-population-migration-contract.test.js`, MP-NP1–MP-NP5): population rows persist independently of later populations, later rule-version changes, and later reevaluations; no historical row is ever mutated (immutability trigger, both tables) or silently superseded. **Passes M3.**

## Deliverable F — supersession ruling

**NO supersession** — same binary D5B's Applicability was ruled under (D8), same burden of proof applied. A changed population (new rule version, new Applicability judgments, newly arrived observations) is a **new** `market_population` header row (and its own new member rows) referencing the same `valuation_question_id` — never an in-place correction. No concrete scenario surfaced requiring one. Both tables are therefore fully immutable, no carve-out (proven live: 4 UPDATE/DELETE rejections in the migration-contract test).

## Deliverable G — dedupe ruling

Content-hash-only dedup (`market_population_dedup_key UNIQUE(content_hash)`), same precedent as `market_observation`/`valuation_question`/`applicability`. A genuine duplicate execution (identical question, rule version, and resulting member set) collides and is rejected (app-layer resolve-or-create); a legitimate reevaluation (anything differs) produces a different `memberSetDigest` and therefore a new row. Proven live: MP-NP6 (duplicate rejected), MP-NP4/MP-NP7 (rule-version change and membership change both succeed as new rows).

## Deliverable H — volume model

**FACT, real measured** (`tests/d5c-market-population-migration-contract.test.js`, same `pg_current_wal_lsn`/`pg_wal_lsn_diff` method as A3, steady-state median of 3×20-row samples after priming, real isolated scratch schema):

| Row type | Measured WAL bytes/row |
|---|---|
| `market_population` header | ~757–1168 (run-to-run variance, same order of magnitude as D5A/D5B's own ~1000 B/row) |
| `market_population_member` | ~768–830 (**upper bound** — this measurement window includes each sample's own freshly-created `market_observation`+`applicability` FK-target rows; the member row's own isolated marginal cost is smaller but not separately isolated this pass, disclosed rather than overclaimed) |

**HYPOTHESIS** (not measured, projected from current pipeline shape): observations considered per question ~20–100 (D5A's own basis); Applicability rows per question ≈ observations considered (D5B: near 1:1 today, no reevaluation yet in production); applicable observations per question — no real corpus available to query (production traffic writes nothing durable yet, GK-180) so this cannot be measured, only estimated from filter-chain shape (typically a small fraction of the initial pool survives the full chain, per CLAUDE.md's own documented "too-specific attempts fall through to broader queries" ladder behavior — no hard percentage is claimed); selected population members per population ≈ applicable observations minus dedup/isolation exclusions; populations per question over reevaluation — modeled at 1/2/5 per the dispatch's own request:

| Reevaluations/question | Header rows | Member rows (at ~50 applicable observations/question, illustrative) |
|---|---|---|
| 1 | 1 | ~50 |
| 2 | 2 | ~100 |
| 5 | 5 | ~250 |

Per 1K/10K/100K scans (1 question/scan, 1 evaluation/question, ~50 members/population, illustrative): ~50K/500K/5M member rows. **These per-scan multipliers are HYPOTHESIS** — no real scan corpus exists to measure against (GK-180 confirms zero production writes anywhere in this substrate); labeled as such, not presented as fact.

**M2 storage discipline honored:** Applicability's own measured ~990–1140 B/row was NOT reused as MarketPopulation's figure — a fresh, independent measurement was taken this pass (see FACT table above).

## Deliverable I — proposed physical schema (NOT live-applied)

`db/data0/0017_d5c_market_population.sql` + `_rollback.sql`. Two tables:

- **`market_population`** — `id`, `valuation_question_id` (NOT NULL FK), `population_rule_version` (generic string), `recorded_by_principal_id`, `correlation_id`, `recorded_at`, `content_hash`, `hash_contract_version`. **No `asset_id`** (M4). Fully immutable.
- **`market_population_member`** — `id`, `market_population_id` (FK), `observation_id` (FK), `applicability_id` (FK, composite-FK'd against `(applicability.id, applicability.observation_id)` so a member row can never cite a judgment for a different observation than the one it names — MP-NP3), `member_status` (`SELECTED`/`EXCLUDED`), `exclusion_reason` (nullable, CHECK-paired to `member_status`), `recorded_at`. Dedup key `(market_population_id, observation_id)`. Fully immutable.

One additive change to a pre-existing table: `ALTER TABLE applicability ADD CONSTRAINT applicability_id_observation_uk UNIQUE (id, observation_id)` — same composite-FK-target technique used twice already (D4 Ruling 21; 0016's own `asset_identity_assignment` composite FK). Zero columns added to `applicability`, zero rows touched. `comp_snapshot`/`valuation_event` are completely untouched — zero `ALTER`, zero write, per M1's historical safety rule.

**Disclosed limit (not silently assumed solved):** a full 3-way composite FK enforcing "the cited `applicability_id` also belongs to the SAME `valuation_question_id` this population answers" (population → question → judgment → question) is not expressible as a single Postgres constraint without a generated/duplicated column. The 2-way composite FK (judgment must match the SAME observation) is DB-enforced and proven (MP-NP3); the question-level transitive match is left to the future writer/service layer, named explicitly here as a gap, not hidden.

## Deliverable J — scratch-proof plan (executed, not merely planned)

`tests/d5c-market-population-hash-serializer.test.js` (17/17, pure) + `tests/d5c-market-population-migration-contract.test.js` (34/34, real isolated scratch schema). All twelve MP-NP items proven:

| # | Result |
|---|---|
| MP-NP1 | PASS — population → nonexistent ValuationQuestion rejected (FK) |
| MP-NP2 | PASS — membership → nonexistent MarketObservation rejected (FK) |
| MP-NP3 | PASS — membership citing a mismatched Applicability judgment rejected (composite FK), isolated from the dedup-key confound |
| MP-NP4 | PASS — changed population-rule version produces a new historical population |
| MP-NP5 | PASS — a later population never overwrites an earlier one (5 header rows coexist; immutability triggers proven both tables) |
| MP-NP6 | PASS — duplicate execution rejected by the dedup unique index |
| MP-NP7 | PASS — legitimate reevaluation (different resulting membership) not blocked |
| MP-NP8 | PASS — identical member set digests identically (repeat + empty-set cases) |
| MP-NP9 | PASS — digest changes when status changes or membership changes |
| MP-NP10 | PASS — cross-domain separation from `mo-hash-v1`/`vq-hash-v1`/`applicability-hash-v1` proven by reference-equality AND a same-content-different-prefix collision test |
| MP-NP11 | PASS — order chosen non-semantic (Section 9); reordering members proven NOT to change the digest |
| MP-NP12 | PASS — `market_observation`/`valuation_question`/`applicability` immutability triggers all still reject mutation after population operations |

Two real test-construction bugs were caught and fixed during this pass (not schema defects): a migration-ordering bug (the `applicability_id_observation_uk` constraint was declared after the table whose composite FK needed it — same class of bug already learned from in 0015/0016, now fixed before this file was ever tested) and two dedup-key confounds in the negative-proof tests themselves (reusing a population that already had a member row for the observation under test, so the dedup unique index fired before the constraint actually being tested could).

## Deliverable K — boundary audit (GK-180)

Repo-wide grep for any INSERT-shaped call into `market_population`/`market_population_member` outside `db/data0/`/`tests/`: **zero hits**. No file under `api/` imports `marketPopulationHash.js`. **GK-180 remains zero writer call sites**, confirmed directly, not assumed.

## M1–M4 gate matrix

```
M1  PASS — M1-A, comp_snapshot as a FUTURE materialized projection of MarketPopulation.
    Zero schema change to comp_snapshot this pass; a future comp_snapshot.market_population_id
    FK is explicitly named as a LATER (D5D writer-layer) decision, not built or implied here.

M2  PASS — every market_population_member field classified; member_status/exclusion_reason
    are NEW durable information Applicability alone cannot express (population-level selection
    outcome, not relevance). Not redundant re-encoding.

M3  PASS — zero-code historical reproducibility test passed: exact membership is a plain SELECT
    over real, individually typed, permanently joinable rows. Membership IS durably persisted
    (Candidate C), not derived from re-executed logic.

M4  PASS — market_population carries no asset_id. Canonical path:
    market_population -> valuation_question -> gk_asset. Verified directly in the committed schema.
```

## Section 3 — Applicability not duplicated

Confirmed by Deliverable A's own classification: every filter that judges "does this observation apply to this question" stays exactly where D5B already put it (Applicability). `MarketPopulation` only records the population-CONSTRUCTION layer (1c isolation, 3b soft preference, 5 dedup) that Applicability structurally cannot express (an Applicability judgment is defined as one observation × one question, independent of sibling observations — D5B's own ratified model; a "was this excluded despite being applicable" fact requires seeing the whole candidate set, which is exactly `market_population_member`'s job).

## Section 15 — GK-180 boundary, explicit

This dispatch authorized: repository inspection, semantic design, schema proposal, scratch-only proof design (and execution — explicitly permitted by Section 15's own text, exercised in this pass), documentation. **Not authorized, and not done:** runtime `MarketPopulation` writer, `api/comps.js`/`api/enrich.js` wiring, D5D bridge, production capture, historical backfill, live migration. `0017` exists only as a proposed file; it was never applied to any database — its own scratch-schema test creates and drops a disposable schema per run, `data1_dev` never opened for a write statement.

## What was NOT done

`0017` not applied to `data1_dev`. No `comp_snapshot.market_population_id` column added (M1's own explicit deferral). No 3-way transitive composite FK (disclosed limit, Deliverable I). No writer, no D5D, no production capture, no historical backfill. Member-row WAL figure is an upper bound, not an isolated marginal cost (disclosed). Per-scan volume multipliers are HYPOTHESIS, not measured (no real corpus exists to query, GK-180).

## Terminal

**D5C DESIGN READY FOR SCRATCH PROOF.**

```
LIVE    D5A MarketObservation · D1 assignment immutability repair · D5B ValuationQuestion + Applicability
NOW     D5C MarketPopulation -- design + scratch proof complete, NOT live-applied
NEXT    D5C live-migration ruling (separate dispatch) -> D5D writer bridge
STAYS   GK-180 = zero writer call sites
BANKED  M1 (comp_snapshot = future projection) · M2/M3/M4 gates · MP-NP1-12 · Section 13 real WAL
HOLD    production capture · D6-D9
```
