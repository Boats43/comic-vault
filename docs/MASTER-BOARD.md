# GrailKey Master Board

First publication: 2026-09-01 (Pre-Volume Train A, D1.1). Seeded from verified repo state — commit history, `docs/LAUNCH-AUDIT.md`, `docs/TICKET-REGISTRY.md`, CLAUDE.md's own Current State block — not from strategy prose. Re-stamp any row the moment the code or a later dispatch changes what it describes; do not let this board drift the way CLAUDE.md itself had to be compacted three times for exactly that reason.

Proof levels: **P1** architecture/design only · **P2** implementation exists, not yet production-verified · **P3** production, live-verified · **P4-I** internal economic proof · **P4-E** external/customer-facing economic proof.

HEAD at this publication: `6b800f4`.

---

## 1. Runtime (comic-pricing pipeline)

| Field | Value |
|---|---|
| Status | Prior launch GO **void**. Pipeline itself (enrich → grade multiplier → sanity → floor guard → decision engine) is live in production and serving real scans; launch certification is not closed. |
| Proof level | P2 |
| Owner | Engineering |
| Dependency | None internal to this train |
| Exit gate | Full re-certification against `docs/LAUNCH-AUDIT.md` Section 10's blockers (Steps 2A/2B/2C) |
| Evidence | `docs/LAUNCH-AUDIT.md:336` — "prior GO is void... `launch-candidate` is withdrawn"; CLAUDE.md Current State: "⛔ Prior GO void, `launch-candidate` tag deleted." |
| Next action | Not scoped to this train — tracked separately on the comic-pricing roadmap |

## 2. Canonical Knowledge (DATA-0 / DATA-0E-FULL)

| Field | Value |
|---|---|
| Status | DATA-0E-FULL acquisition **running independently**, watchdog-armed, resume-checkpoint-based |
| Proof level | P1/P2 (acquisition in progress, canonical minting not yet run at full volume) |
| Owner | Acquisition lane (isolated — see CLAUDE.md's "DATA-0E-FULL Crawl Isolation — Standing Law") |
| Dependency | None — explicitly never blocks and is never blocked by this train |
| Exit gate | 0E-FULL mint → 0F shadow → 0G cutover |
| Evidence | CLAUDE.md, DATA-0E-FULL block; `docs/adr/DATA-0E-FULL-DESIGN-DRAFT.md`; runbook root `C:\grailkey-data\data-0e-full\` |
| Next action | None from this train — parallel lane, untouched |

## 3. Permanent Asset (DATA-1D auth + capture + media)

| Field | Value |
|---|---|
| Status | **PRODUCTION LIVE / PHYSICAL-CROSS-DEVICE-PENDING.** Auth chain, capture pipeline, and Blob-backed media are deployed and serving real traffic; one real physical book has been captured and is retrievable today. |
| Proof level | P3 (with the one open exit gate below still blocking Milestone Ten's own closure) |
| Owner | Engineering + Jimmy (physical proof) |
| Dependency | Milestone Ten phone proof |
| Exit gate | Independently-authenticated retrieval from a genuinely separate physical device |
| Evidence | CLAUDE.md, DATA-1D block: `gkAssetId 01a02d23-1acb-72e8-aae3-8f851308e9cf`, `mediaId 01a02d23-2809-7024-9312-d45bb5003014`; production smoke test (login-fail 401, login-success 200, authenticated asset 200, authenticated media 200 SHA-256 byte-identical, unauthenticated media 401) |
| Next action | Phone proof (`docs/adr/DATA-1D-CORRECTION-PASS.md`, H8) |

## 4. Economics / Outcome

| Field | Value |
|---|---|
| Status | **Design draft only, not applied to any database.** |
| Proof level | P1 |
| Owner | Engineering |
| Dependency | D3.3 (durable comp-snapshot slice) lands first — an outcome ledger without durable valuation evidence underneath it has nothing real to learn from |
| Exit gate | `0006_outcome_ledger.sql` applied to `data1_dev`; outcome ledger live |
| Evidence | `db/data0/0006_outcome_ledger.sql:1-8` — "DESIGN DRAFT, NOT APPLIED... Not applied to `data1_dev` or any database as part of this dispatch" |
| Next action | D9 (per the dispatch train's own stated sequence: D4 → D5 → D6 (gated on Milestone Ten) → D7 → D8 → D9) |

## 5. Operator Product (frontend / decision UI)

| Field | Value |
|---|---|
| Status | Live production. Grading flow, catalogue, decision-engine panel, Watch Mode, bundle listing, Post All HOT, editable list price, CGC submission scenarios all shipped and in use. |
| Proof level | P3 |
| Owner | Engineering |
| Dependency | None from this train |
| Exit gate | N/A — ongoing product surface, not a binary gate |
| Evidence | CLAUDE.md, "Features" section; `src/App.jsx` (~11,100 lines as of the 2026-07-11 measurement on file, not re-measured this pass) |
| Next action | Not scoped to this train |

## 6. Distribution (eBay listing)

| Field | Value |
|---|---|
| Status | Listing/delisting live (`api/list-ebay.js`, `api/delist-ebay.js`). Commerce authorization is **partially satisfied** — steps 1-2 of 4 built. |
| Proof level | P2 |
| Owner | Engineering |
| Dependency | None internal to this train |
| Exit gate | GK-151 steps 3-4 (marketplace-account + mutation authorization) |
| Evidence | CLAUDE.md, DATA-1D block: "GK-151 (full four-step commerce authorization chain — only steps 1-2 built; steps 3-4, marketplace-account + mutation authorization, remain)" |
| Next action | Not scoped to this train |

## 7. Market / Revenue (pricing & valuation evidence)

| Field | Value |
|---|---|
| Status | Pricing engine live and gated behind the same void launch GO as Runtime. Durable valuation evidence (Foundation Law 5) is PARTIAL but materially advanced since D1: `comp_snapshot`/`valuation_event` are live (D3.3), `market_observation` (D5A, `0014`) is LIVE in `data1_dev`, and the ValuationQuestion/Applicability semantic boundary sitting on top of it is ratified docs-only (D5B, `docs/adr/ADR-VALUATION-001-question-applicability.md`). GK-180 remains the load-bearing gap: zero call sites from `api/comps.js`/`api/enrich.js` into any of this durable substrate — production scan traffic still writes nothing durable. |
| Proof level | P2 |
| Owner | Engineering |
| Dependency | 0015 (ValuationQuestion + Applicability schema, scoped by the D5B ADR and gated on GK-187's V1-V4) is the next dependency; GK-180 (writer bridge from `api/comps.js`) remains open regardless of 0015's timing |
| Exit gate | 0015 scratch-schema proof → live apply → D5C `MarketPopulation` + D3.3 bridge → D5D controlled provider-capture writer, per the A4 sequencing ratified in Phase A (this file, "Phase A — PASS") |
| Evidence | `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`, Law 5; `db/data0/0004_data1_foundation.sql:178,184`; `db/data0/0014_d5a_market_observation.sql` (LIVE); `docs/adr/ADR-VALUATION-001-question-applicability.md` |
| Next action | 0015 design/schema-ruling pass (not started) |

## 8. Governance / Sec / Ops

| Field | Value |
|---|---|
| Status | Active standing. Secret Hygiene protocol enforced (GK-164 CLOSED — credential rotated, session-epoch revocation live). Quarantined-scratch standing law in force. This D-train itself is the current governance work. |
| Proof level | P2/P3 mixed (the protocols are P3-enforced by standing rule; this specific train's own governance docs are P1, being published now) |
| Owner | Engineering + Jimmy (rulings) |
| Dependency | None |
| Exit gate | N/A — standing, not a one-time gate |
| Evidence | CLAUDE.md, "Secret Hygiene" and "Quarantined Scratch" sections; `src/modules/auth/token.js` (`GRAILKEY_SESSION_EPOCH`) |
| Next action | D1 CLOSED, D2 EXIT PASS (2026-09-01 — see `docs/DATABASE-MIGRATION-STATUS.md` for D2.1/D2.4 evidence), D3 released |

---

## Physical gates (owner: Jimmy)

| Gate | Status | Evidence |
|---|---|---|
| Creepy #1 real-photo capture proof | **CLOSED** (GK-166) | CLAUDE.md DATA-1D block; `gkAssetId 01a02d23-1acb-72e8-aae3-8f851308e9cf` |
| Milestone Ten phone proof | **OPEN** | `docs/adr/DATA-1D-CORRECTION-PASS.md`, H8 |
| AWW #16 rescan | **OPEN** | Closes GK-158/159's comic-runtime closeout gate; CLAUDE.md, "WHAT IS NEXT" |

---

## Migration truth (data1_dev live schema)

**VERIFIED — D2.1, 2026-09-01.** Live `information_schema` query (not file inference) against both existing user schemas: `public` (0 tables) and `data1_dev` (16 tables). Table-by-table APPLIED/NOT APPLIED/PARTIAL status, full reconciliation of the prior "13-of-17-vs-11-of-15" claim (found to have no citation anywhere else in the repo — recorded as an open contradiction, not resolved either way), and the design-snapshot's "0001-0003 target public" claim (only partially true — `entity_mint_basis`/`mint_event` actually live in `data1_dev`): `docs/DATABASE-MIGRATION-STATUS.md`. Two real production rows (`gk_asset`, `media`) re-confirmed live and byte-consistent with the values already cited in CLAUDE.md's DATA-1D block.

## Production/Development isolation risk

**PRODUCTION ENVIRONMENT ISOLATION — OPEN / PRE-D6 GATE.**

D2.1's live query and `vercel env ls` (list-only, no secret values pulled) together establish: Development, Preview, and Production each carry their own `GRAILKEY_CATALOG_DATABASE_URL`, but only Development's environment carries the full Neon-integration-generated variable family (`PGHOST`/`PGUSER`/`NEON_PROJECT_ID`/etc.) — Production and Preview each have only a bare `DATABASE_URL`. **Whether Production/Preview's connection strings point at the same Neon branch/schema as the `data1_dev` this pass queried, or at a genuinely separate one, was not determined — doing so would require decrypting environment-variable values, which was not done (Secret Hygiene).** This is stated as an open question, not resolved as fact in either direction.

Real, proven contamination-risk evidence from this same pass, offered as supporting signal for the gate — not as proof of the topology question itself: the D2.3 orphan reconciler found 4 `data1_dev.media` rows carrying non-hash fixture-style `object_uri` values (`localfs://sha256/aa/gk163-A`, duplicated across 2 asset rows each), consistent in shape with leftover GK-163 idempotency-test fixture data. **Provenance is not established beyond that shape-based observation — no commit, test run, or log line confirming which dispatch wrote them was checked this pass.** Recorded as evidence of what test/dev activity can leave behind in this schema, not as confirmation that Production shares that same schema.

**Gate: Production capture must not be enabled at D6 while it is undetermined whether Production shares the same writable database failure domain as Development/test activity.** Resolving this (Neon branch-per-environment vs. confirmed-separate topology) is now a pre-D6 gate, not a preference — see `docs/DATABASE-MIGRATION-STATUS.md` and the D2 checkpoint report (2026-09-01) for the two topology options under review. No branch was created, no schema was migrated, and Production was not repointed as part of establishing this row. **Preserved as-is at D2 EXIT — not touched, resolved, or downgraded by the D2.4 restore drill below.**

**GK-179 dependency (added 2026-09-03, report-only, no fix authorized) — cannot be sequenced apart from this gate.** The GK-178 fix (schema-qualifying every table reference `data1_dev.<table>`) hardcodes the schema name literal in both `src/modules/assets/db.js` and `src/modules/auth/db.js`'s repository/idempotency/service files. This is correct today, while Dev/Preview/Production all resolve to `data1_dev` (or the topology question above remains genuinely unresolved) — but it directly collides with this gate: under a real branch-per-environment or promoted-production-schema topology, a hardcoded `data1_dev.` literal would read the wrong environment's data, or fail outright, regardless of which physical Neon branch the connection string points at. **Ruling: the schema name must become environment-derived (an env var, never a hardcoded literal) as part of whichever dispatch resolves this topology gate — not before, and not as a separate, later cleanup.** The two fixes (topology resolution + schema-name env-derivation) are one dependency chain, not two independent tickets that could land in either order. Full detail: `docs/TICKET-REGISTRY.md`, "GK-179." **Acceptance dependency, stated by the ruling that opened GK-179:** before any Production/Development database isolation or branch-per-environment cutover is declared PASS, the deployed Production runtime must be proven to resolve its schema from explicit environment configuration and be proven unable to resolve to the Development schema — and symmetrically, Development must be proven unable to resolve to Production. No silent fallback to `data1_dev` is permitted in Production once this topology gate begins being worked.

## D2.4 — Restore/PITR capability

**PASS — 2026-09-01.** Real, operator-executed Neon Console drill: new branch (`d2-4-scratch-restore-proof`) created non-destructively from `main` at a past point in time (2026-09-01 7:04 PM America/Phoenix), the known `gk_asset`/`media` rows and the media row's `object_uri` confirmed present and byte-identical on the recovered branch, scratch branch deleted after verification. `main`/`data1_dev` independently re-confirmed unchanged by this session immediately after (same 2 rows, same 16-table count). Full record: `docs/DATABASE-MIGRATION-STATUS.md`, "D2.4 — Real Neon restore/PITR drill." No new Neon credential was created. Production was not touched.

**Actual current tier, as shown in Console:** **Free** — 6-hour/1GB restore window, 10-branch/project cap. Not inferred; this is what Console displayed during the drill.

## Durability risk — 6-hour restore window

**6-HOUR RESTORE WINDOW — OPEN / PRE-D6 GATE.** The D2.4 drill proves the restore *mechanism* works on the current (Free) plan; it does not establish that a 6-hour history window is *adequate* for permanent physical-asset custody — a capture written more than 6 hours before an incident is discovered would fall outside Free's restore window entirely. Recorded as an **operational durability threshold for a later ruling**, not a mandate to upgrade — no plan change is recommended or implied here. **Gate: before D6, this retention requirement must be explicitly ratified** (accept the 6-hour exposure window on Free, or move to a paid tier with a longer one) — alongside, and independent of, the Production/Development isolation gate above.

**Comp-snapshot write-volume interaction (D3.3 Phase A / Amendment A3-E3, 2026-09-02, real measured evidence, not estimated):** high-volume durable `comp_snapshot` writes could, in principle, reduce the effective recovery window below the nominal 6-hour time limit if the 1 GB change-history budget is consumed first (WAL bytes, not logical row bytes, are what actually count against that budget — logical and WAL bytes were confirmed NOT proportional by direct measurement: SMALL/NORMAL/LARGE median WAL bytes measured at 1616/1480/3504 respectively). At measured steady-state WAL cost, even the LARGE (100-comp) snapshot size would need on the order of hundreds of thousands of writes (~306,000) to exhaust 1 GB from `comp_snapshot` writes alone. **Stated precisely: currently not a near-term dominant threat to the pre-D6 restore window, on this measured `comp_snapshot`-write evidence — this is not a global database guarantee.** Other write classes and total system activity still count against the same 1 GB budget; this measurement bounds one table's contribution, not the whole database's. Full figures: `docs/DATABASE-MIGRATION-STATUS.md`, "Amendment A3/E3."

**Applicability write-volume interaction (D5B Semantic Closure, Finding B, 2026-09-03, banked topology signal — second D5-phase pass producing this class of finding, not a fresh one).** `docs/adr/ADR-VALUATION-001-question-applicability.md` ratifies that a future Applicability layer is NOT 1:1 with `MarketObservation` — every observation may be re-evaluated against changing valuation assumptions (a new `ValuationQuestion`, or a filter/model-version bump per that ADR's R3), each producing its own durable judgment row. Durable note: `MarketObservation` sizes at ~20-100 observations/retrieval batch (D5A's own basis); `Applicability` can produce potentially one judgment per observation per `ValuationQuestion` — repeated grade/identity/variant assumptions multiply judgment history beyond the observation count, so a high-volume Applicability WAL may equal or exceed `MarketObservation` WAL. **Therefore retention/recovery sizing for this same pre-D6 gate must account for BOTH layers, not `MarketObservation` alone, before D6/prod-volume release.** No infrastructure fix in this pass — docs-only, banked alongside the comp-snapshot finding above as the second data point against this gate.

## D3.1 / D3.2 — information contracts (candidate-safe mint basis; true event time)

**D3.1 PASS** (`2dce8bd`, KEPT). `buildCaptureBasis` gains an optional candidate discriminator, additive-only, byte-compatible with its own pre-change legacy call shape. **D3.2 PASS (2026-09-02, Phase B) — migration `0011_d3_2_event_time.sql` APPLIED to `data1_dev`** (recovery anchor `2026-09-02T03:29:11Z` UTC; rollback written+validated before the forward migration ran; 78/78 post-migration schema checks; application wiring shipped and live-proven 10/10 against real `data1_dev`). Full detail: `docs/DATABASE-MIGRATION-STATUS.md`, "D3.2 Phase B."

**`entity_mint_basis` row-provenance — MIXED, not assumed production.** Of the 110 live rows: 97 are explicitly-marked proof/test artifacts, 1 is confirmed production (Creepy #1), 12 are UNKNOWN (realistic, uncorroborated). **The known row count is explicitly not itself proof of production provenance** — recorded per Amendment A4's own instruction that this distinction must stay visible for any future migration whose interpretation depends on these rows. Full classification and evidence: `docs/DATABASE-MIGRATION-STATUS.md`. **D3.1's own commit message/test-file claim that `buildCaptureBasis` "has never been the writer of any of the 110 rows" is corrected here as FALSE** — 3 of 110 (including Creepy #1) do match its output shape; the commit itself is KEPT unamended per ruling, this is a recorded correction, not a history rewrite.

No destructive cleanup of any row was performed while establishing this classification — per Amendment A4, discovering provenance is not itself grounds for cleanup.

## D3.3 Phase A — durable comp snapshots (PROPOSED, NOT applied to `data1_dev`)

Migration `db/data0/0012_d3_3_comp_snapshot.sql` — one new additive table, `comp_snapshot`, with **real DB-enforced immutability** (trigger-rejected `UPDATE`/`DELETE`, not merely a convention), plus a new FK column on `valuation_event` (`comp_snapshot_id`, added by the R1 review round before any live application). Rollback written, amended in step with the R1 fix, and validated (forward+rollback rehearsed against an isolated scratch schema) before this dispatch used the forward migration for its own proof. Real proof, **23/23** (`tests/d3-3-comp-snapshot-immutability.test.js`, up from 16/16 after the R1/R2 review round): persist/read-back, trigger-rejected mutation, repricing creates a new snapshot rather than mutating the old one, old snapshot stays readable, `gkAssetId` unchanged throughout, **R1** (a valuation→snapshot reference cannot dangle — FK-enforced, live-proven against a real rejected insert and a real rejected delete), **R2** (multi-timestamp source evidence survives verbatim inside the immutable payload; `recorded_at` is persistence-time only; no manufactured snapshot-level `occurred_at`). Full record: `docs/DATABASE-MIGRATION-STATUS.md`, "D3.3 Phase A," "R1," "R2."

**Foundation Law 3 ("Time is first-class") status corrected: PARTIAL → IMPLEMENTED** (D3.3 Phase A / E2, citing the D3.2 evidence — 78/78 schema verification, 10/10 application live proof). Full detail: `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`, Law 3.

**New standing invariant: Schema/Application Sequencing** (D3.3 Phase A / E1) — added to `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`, "Supporting invariants," citing the D3.2 premature-wiring incident as its empirical basis.

**New standing rule: Historical Regression Freshness** (Phase A review, R5) — added to `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`: a dispatch that does not freshly re-run the byte-exact historical test roster must report `historical-roster status changes: NOT FRESHLY MEASURED`, never "0 status-changed" from untouched-source reasoning alone.

**GK-167 constitutional-text correction** (Phase A review, R4) — `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`'s Media durability subsection previously stated "Currently violated at HEAD," stale since D2.2 actually closed it; corrected, chronology preserved. **GK-167 registry-status follow-up CLOSED this pass (Phase B, R4 follow-up):** `docs/TICKET-REGISTRY.md:152` corrected from `OPEN` to `CLOSED` (`77f48f5`, 2026-09-01), original problem description preserved verbatim, closure narrative appended — narrow, single-line correction only, not a general registry cleanup.

## D3.3 Phase B — APPLIED to `data1_dev` (2026-09-02)

**PASS.** Migration `0012_d3_3_comp_snapshot.sql` (R1/R2-amended) applied to `data1_dev` — recovery anchor `2026-09-02T04:18:26Z` UTC; committed-vs-executed SHA-256 verified byte-identical before running; 14/14 post-migration schema proof; all 78 pre-existing `valuation_event` rows confirmed `comp_snapshot_id IS NULL`; `comp_snapshot_ref` confirmed byte-identical to pre-migration (untouched). Application wiring shipped (`recordCompSnapshot`, `recordValuation`'s new explicit `compSnapshotId` param — never inferred from `comp_snapshot_ref` or any other value; `capture/mapping.js` untouched). **Live contract proof: 31/31**, real functions, real `data1_dev` — full A–K, including real FK rejection of a dangling reference and real trigger rejection of both UPDATE and DELETE on a referenced snapshot.

**Retained controlled test artifacts (structurally forced — `comp_snapshot` is genuinely DELETE-protected):** `gk_asset` +1, `entity_mint_basis` +1, `comp_snapshot` +2 — all other touched tables returned to exact baseline. Reported honestly as a non-zero, explained delta, never claimed byte-identical. Full IDs and disposition table: `docs/DATABASE-MIGRATION-STATUS.md`, "D3.3 Phase B."

**Foundation Law 5 ("Market = observations → valuation") — durable evidence linkage now real and enforced**, not merely designed: `valuation_event.comp_snapshot_id → comp_snapshot.id`, FK + immutability trigger together, live-proven non-dangling.

**D3.3 CLOSED — Phase A + Phase B both complete.** No D4, D5, D6 this pass.

## D4 Phase 0 + Schema Ruling — Identifier Fabric (2026-09-02)

**Phase 0 audit-only pass: PASS.** Complete census of every existing identifier-shaped mechanism (`entity_mint_basis`, `external_map`, `collection_item_link`, plus `asset_identity_assignment` as an assertion-pattern precedent, and the transient `certNumber`/UPC/`ebayItemId` fields) before any new design was proposed. Zero code/schema/migration surface touched.

**Schema concept: PASS WITH AMENDMENTS**, ratified this same dispatch — full ruling: `docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md`. Headline rulings: `entity_mint_basis` stays SIBLING (mint-idempotency only — no external identifier may ever participate in a mint-basis key, closing a contradiction the Phase 0 audit itself left open); `external_map` is DESIGN-SUPERSEDED (never applied, not resurrected, `catalog_entity` not activated as a side effect); `collection_item_link` stays SIBLING (routing only); Model C ratified (identifier existence / subject assertion / resolved identity kept structurally distinct); scope belongs to the identifier definition, not the assertion; **Phase 0's own proposed polymorphic `subject_type`+`subject_id` persistence model was rejected** in favor of typed, genuinely-FK-enforced attachment tables, specifically to avoid manufacturing a second `asset_identity_assignment.catalog_entity_id`-class opaque-UUID hazard (now tracked as GK-176); `issuing_authority` (external scheme governor) and `resolution_authority` (GrailKey's own NONE/CONTESTED/CORROBORATED state) are mandatory, distinct names — no future D4 table may carry a bare `authority` column; Phase A's minimum live slice is a generic identifier-definition domain plus a physical-asset (`gk_asset`)-only assertion table, with no requirement that `catalog_entity` exist.

**Live-vs-design contradiction found and recorded** (not fixed): `entity_mint_basis.entity_id` resolves to `gk_asset.id` in live use, contradicting `0003`'s own design-time text that the table was catalog-identity-scoped only — full detail `docs/DATABASE-MIGRATION-STATUS.md`.

**Greenfield fact, recorded:** `certNumber`, UPC/barcode, and `ebayItemId` are all transient today — none persisted, none reaching `src/modules/assets/`. D4 has zero historical identifier rows to migrate or backfill.

**Three incidental findings logged as tickets, not fixed:** GK-175 (`assetClass='comic'` default in `createPhysicalAsset`, permanent-kernel vertical leakage), GK-176 (`asset_identity_assignment.catalog_entity_id` FK-less opaque-UUID sequencing hazard — the same hazard Ruling 6 above exists to not repeat), GK-177 (`asset_identity_assignment` stores a resolved verdict but no durable link to the evidence that produced it — the same gap D4's own evidence-linking ruling below closes for identifiers).

**A6/A7 refinement pass — RATIFIED, same dispatch train, `docs/adr/ADR-IDENTIFIER-001-identifier-fabric.md`, Rulings 12-20.** Four-table minimum model, not two: `asset_identifier` (canonical definition, `UNIQUE(scheme, issuing_authority, normalized_value)`, sentinel `'UNKNOWN'` never `NULL`), `asset_raw_observation` (unresolved-legal raw evidence), `asset_identifier_assertion` (`identifier_id NOT NULL` — corrects the earlier nullable sketch), `asset_identifier_assertion_evidence` (typed many-to-many provenance link, required by repo evidence that CORROBORATED means multiple independent sources). Cross-encoding canonicalization ratified (GTIN→GTIN-14, ISBN-10→ISBN-13). Supersession graph corrected: a forest of in-trees rooted at live assertions (convergence legal, in-degree unbounded), not chains — proven acyclic under real two-connection concurrency, including a genuine PostgreSQL deadlock (`40P01`) under a forced adversarial lock schedule, with correctness (at most one commit) holding in every tested case. Definition-level `UNKNOWN`→known issuer reconciliation explicitly deferred from the minimum slice, ruled structurally independent of `entity_mint_basis`/`basis_supersession`/catalog substrate. Proof: 21/21 + 17/17 deterministic assertions, plus 3 + 1 confirmed real-concurrency scenario outcomes (kept as distinct figures, never combined).

**Phase A — PROOF COMPLETE, including a same-asset integrity correction (2026-09-02).** Migration `0013_d4_identifier_fabric.sql` + exact rollback proposed; an adversarial attack against the first committed bytes found a real hole (evidence links and supersession could both cross physical assets) — fixed declaratively via composite FKs (ADR Ruling 21), not a trigger. Real isolated-scratch-schema proof against the final bytes: 77/77 + 7/7 concurrency (real PostgreSQL deadlock observed).

**Phase B — PASS, LIVE, B7a CLOSED (2026-09-03).** `0013` applied to real `data1_dev` (recovery anchor `2026-09-03T03:35:06.594Z` UTC, ~352ms, all D1-D3 prerequisite counts confirmed undisturbed). Minimum vertical-neutral repository/service wiring shipped (5 new public operations + a narrowly-scoped `40P01`-only bounded retry, `src/modules/assets/retry.js`). Full live proof: 21/21 round-trip through the real service, 6/7 baseline concurrency (required invariants held in every race). **B7a gap CLOSED (`tests/d4-identifier-fabric-live-retry-deterministic.test.js`, 13/13):** after 92 real probabilistic trials never landed a genuine service-layer `40P01`, a deterministically constructed two-connection PostgreSQL lock cycle (helper connection explicitly locks target then source, observed via `pg_locks`, never inferred) produced a real SQLSTATE `40P01` through the actual `supersedeIdentifierAssertion` service call, and the real `retry.js` helper automatically retried and committed correctly — durable state verified clean (no cycle, no duplicate rows). Full detail `docs/DATABASE-MIGRATION-STATUS.md`, "Gap CLOSED." **Terminal verdict: D4 PHASE B PASS — IDENTIFIER FABRIC LIVE.** Incidental finding GK-178 (pre-existing `db.js` pooled-connection hazard) **escalated during B7a closure** — reproducible at just 3 concurrent connections, not fixed, now a standing infrastructure gate: **D5 is not authorized until GK-178 is resolved.** 17 real `gk_asset` rows + full evidence/assertion graph retained, all attributable, zero accidental debris. Milestone Ten unaffected, remains OPEN / PHYSICAL-CROSS-DEVICE-PENDING.

---

**GK-178 — RESOLVED, D5 gate lifted (2026-09-03).** Root cause refined: PgBouncer transaction-pooling guarantees backend affinity for one continuously-open transaction, never across a prior autocommit statement and a later `BEGIN` — proven both ways (200/0 mismatches state-inside-tx; 3/3 real failures with `pg_backend_pid()` drift state-outside-tx). Reachable from all three deployed endpoints (`api/assets.js`, `api/asset-media.js`, `api/auth-login.js`); a byte-identical duplicate defect also existed in `src/modules/auth/db.js` (login path), fixed alongside assets. Fix: every bare table reference in both modules' repository/idempotency/service files is now schema-qualified (`data1_dev.<table>`); both `acquireConnection()`s no longer issue `SET search_path` at all — session-state dependence eliminated, not pinned. Post-fix proof: 10/10 + 5/5 fresh-pool trials at the original failure concurrencies, 360/360 at N=12×30 warm-pool sweep, 180/180 contamination proof (backend still swaps, correctness no longer cares), D4 regression boundary clean, new committed regression `tests/gk178-pooled-session-state.test.js` (8/8). Compatibility Matrix: zero NO. Full detail `docs/DATABASE-MIGRATION-STATUS.md`, "GK-178 — pooled-connection session-state hazard, RESOLVED." **D5 is now authorized to begin.**

## D5 Phase 0 + Phase A — MarketObservation architecture (2026-09-03, ruling-only, no schema written)

**Phase 0 — PASS.** Audit-only. D3.3 collision ruling: **A — UNDER** (`comp_snapshot`'s own committed migration header already anticipates this: "D5 can later formalize MarketObservation/MarketPopulation on top of this without losing any historical information already captured here," `db/data0/0012_d3_3_comp_snapshot.sql`). Central finding: `api/enrich.js`/`api/comps.js` have zero call sites into `src/modules/assets/`'s durable economic path — production comic-pricing traffic has never written a `comp_snapshot` or `valuation_event` row (now GK-180). The live `comp_snapshot` population (4 rows) is D3.3's own retained test fixtures; all 78 `valuation_event` rows carry `comp_snapshot_id IS NULL`. Zero Foundation Law contradictions found that would block Phase A. Full detail: this conversation's own report (not separately filed — see `docs/TICKET-REGISTRY.md` GK-180/181/182 for the durable findings).

**Phase A — PASS, semantic rulings closed.** Four bindings ratified: **A1** — `asset_id` removed from `market_observation` entirely (not merely nullable); asset/catalog linkage belongs exclusively to the later Applicability layer, contrasted directly against `asset_raw_observation.asset_id NOT NULL` (`db/data0/0013:197-199`), whose binding is genuinely intrinsic (evidence physically gathered from the asset in hand) in a way market evidence never is. **A2** — MarketObservation gets its own canonical content-hash contract, diverging deliberately from `comp_snapshot.content_hash`'s reused-but-fragile plain-`JSON.stringify` approach (verified: not actually canonical — caller object key order, unversioned); `provider_item_id` stays plain nullable (no D4-style `UNKNOWN` sentinel — diverges deliberately from Ruling 13, since a NULL item ID never causes false-merging here, only "no correlation applied," which is safe). **S1 correction (this pass):** `occurred_at` is now RULED INCLUDED in the hash tuple (reversing Phase A's own initial exclusion) — two real market events (e.g. two distinct PriceCharting sales at the identical price on different dates) must never silently collapse into one row; `observed_at`/`recorded_at` remain excluded (pure retrieval/persistence metadata, not asserted facts). **S2** — monetary representation ruled **canonical decimal `NUMERIC(14,4)` + ISO 4217 currency code**, not integer minor-units — the kernel must not need per-currency exponent knowledge (JPY=0, USD=2, BHD=3, ...) merely to preserve an observed price; exact hash-string derivation specified via string-based decimal normalization, never IEEE-754 float rounding. **S3** — `mo-hash-v1` version tag is embedded in the hash input itself; version-bump consequence explicitly ratified: dedup never crosses a hash-contract-version boundary, existing hashes are never recomputed, a one-time re-observation duplication wave after any future v2 upgrade is expected and accepted, not a defect. **A3** — no eBay/PriceCharting production persistence (raw OR derived) authorized until `src/lib/evidenceContracts.js`'s existing (currently dormant, zero-importer) `SOURCE_POLICIES` mechanism is extended and reviewed; the rights gate lives at the service-call layer, never as a schema column. **A4** — sequencing ratified: D5A substrate → D5B Applicability → D5C MarketPopulation + D3.3 bridge → D5D controlled provider capture, no direct MarketObservation→ValuationEvent shortcut; write ceremony ruled structural (A4a): one retrieval batch = one transaction, one `domain_event`/`outbox` pair (not per-row), one batch-level idempotency key, individual observation provenance recoverable via a shared `correlation_id` column — cutting the projected 10,000-scans/day 6-hour WAL exposure from ~700-800 MB (naive per-row ceremony) to ~225 MB (batched), still material evidence for the standing pre-D6 topology/retention gate below, not disqualifying.

**Three findings banked as real tickets this pass:** GK-180 (durable economic pipeline disconnected), GK-181 (mutable client-side IndexedDB price is the D5 transition target, explicitly not a kernel Foundation-Law violation), GK-182 (`evidenceContracts.js`'s PriceCharting `retentionDays: 1` vs. the actual production `KV_TTL.PC_HTML = 604800`/7-day scrape cache — a rights-policy documentation inconsistency that must be resolved before `evidenceContracts.js` becomes an enforcement dependency for GK-178's-successor A3 gate). Full detail: `docs/TICKET-REGISTRY.md`.

**0014 design, static proof, and two pre-live corrections — PASS (2026-09-03).** Two real fidelity gaps found and closed before any live application: F1/F1a/F1b/F1c removed a synthetic-midnight temporal representation (`occurred_at_precision`) entirely in favor of a structural two-column model (`occurred_on DATE` + `occurred_at TIMESTAMPTZ`, mutually exclusive); F2/F2a/F2b closed the T2b-disclosed grade-scale ambiguity directly by adding `grade_basis` (nullable, generic, hash-participating) rather than deferring it. Both proven via full scratch-schema static suites (63/63 + 66/66) before any live authorization was sought.

**0014 — LIVE, APPLIED to `data1_dev` (2026-09-03).** Design HEAD `136e2fa`, forward SHA-256 `c5a5e69b...483f0`, rollback SHA-256 `10f613e2...774eb` — all confirmed matching the approved values immediately before application. H1's fresh object-census proof (byte-for-byte parity across every object category between pre-forward-apply and post-rollback states) re-run against the exact current committed blobs, not an inherited proof. Applied verbatim in 186ms. Live catalog verification 23/23. Live contract proof: 21/22 real-hash-computed assertions pass (the 1 "failure" was the harness's own incorrect prediction that two different `provider` markers would hash identically — they don't, since `provider` is hash-participating by design, a *stronger* non-collision guarantee than predicted; not a live-behavior defect). 23 permanent, immutable, fully-attributable proof rows retained (`provider IN ('d5a-0014-live-proof','d5a-0014-live-proof-alt')`, one shared `correlation_id`). All 20 pre-existing D1-D4/D3.3 tables re-confirmed byte-for-byte unchanged. GK-183/GK-184 both remain OPEN, unchanged — GK-184 restated as a hard D5D prerequisite (H4): the future writer must decline persistence rather than ever substitute `observed_at=now()` for a genuinely-unknown provider-retrieval time. Full detail: `docs/DATABASE-MIGRATION-STATUS.md`, "D5A — MarketObservation substrate, APPLIED to data1_dev."

**Terminal: `D5A 0014 LIVE MIGRATION PASS — MARKETOBSERVATION SUBSTRATE LIVE — D5B RELEASED.`** D5B (Applicability) is the next authorized D5 phase — not started this pass.

## Governance / registry notes

- **GK-173, GK-174 — do not exist.** Grepped globally across the repo for both identifiers — zero hits in any file. The 2026-09-01 dispatch's "delete GK-173/GK-174 as strategy-only labels never registered" instruction is therefore a **no-op**: there is nothing in `docs/TICKET-REGISTRY.md` to delete. Recorded as a contradiction between the dispatch's framing (which implies these were registered entries) and the actual registry state, not silently skipped.
- **GK-171 — open creator→variant root class.** Status REPORT-ONLY (`docs/TICKET-REGISTRY.md:157`): `extractFirstEligibleVariantCandidate` may yield a wrong creator on the Absolute Batman #19 artist-recognition fixture; logged verbatim per operator ruling, not investigated or fixed, explicitly not folded into the GK-168/169/172 train. This is the **root class**; GK-148 (`docs/TICKET-REGISTRY.md:132`, CLOSED, build `38ee71d`) was a **point fix** — the `PUBLISHER_STOP_LIST` addition to `fuzzyAliasMatches` that closed one specific creator/publisher-name collision (and two more found during that same pass: Boom Studios↔Broome, Disney↔Eisner/Bisley). GK-171 remains open and distinct.
- **Edition-grounding — CONTAINED at HEAD.** The GK-168/169/172 edition-facet work is grounded through three real mechanisms: the grading prompt, regex classification, and `reconcileEditionFacet` (`src/lib/identityCore.js:1702`). Structural separation of raw observation from interpretation is flagged as future hardening — not built, not scoped to this train.
