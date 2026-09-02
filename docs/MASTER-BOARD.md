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
| Status | Pricing engine live and gated behind the same void launch GO as Runtime. Durable valuation evidence (Foundation Law 5) is PARTIAL — `comp_snapshot_ref` column exists, nothing populates it yet. |
| Proof level | P2 |
| Owner | Engineering |
| Dependency | This train's D3.3 (pulled-forward durable comp-snapshot slice, the audit's worst realized-loss risk per the dispatch) |
| Exit gate | D3.3 EXIT proof: one real scan's comp pool persisted and re-read after the KV key is manually expired |
| Evidence | `docs/architecture/GRAILKEY-PHYSICAL-ASSET-PROTOCOL-v1.md`, Law 5; `db/data0/0004_data1_foundation.sql:178,184` |
| Next action | D3.3 (not this pass — D1 only) |

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

## Governance / registry notes

- **GK-173, GK-174 — do not exist.** Grepped globally across the repo for both identifiers — zero hits in any file. The 2026-09-01 dispatch's "delete GK-173/GK-174 as strategy-only labels never registered" instruction is therefore a **no-op**: there is nothing in `docs/TICKET-REGISTRY.md` to delete. Recorded as a contradiction between the dispatch's framing (which implies these were registered entries) and the actual registry state, not silently skipped.
- **GK-171 — open creator→variant root class.** Status REPORT-ONLY (`docs/TICKET-REGISTRY.md:157`): `extractFirstEligibleVariantCandidate` may yield a wrong creator on the Absolute Batman #19 artist-recognition fixture; logged verbatim per operator ruling, not investigated or fixed, explicitly not folded into the GK-168/169/172 train. This is the **root class**; GK-148 (`docs/TICKET-REGISTRY.md:132`, CLOSED, build `38ee71d`) was a **point fix** — the `PUBLISHER_STOP_LIST` addition to `fuzzyAliasMatches` that closed one specific creator/publisher-name collision (and two more found during that same pass: Boom Studios↔Broome, Disney↔Eisner/Bisley). GK-171 remains open and distinct.
- **Edition-grounding — CONTAINED at HEAD.** The GK-168/169/172 edition-facet work is grounded through three real mechanisms: the grading prompt, regex classification, and `reconcileEditionFacet` (`src/lib/identityCore.js:1702`). Structural separation of raw observation from interpretation is flagged as future hardening — not built, not scoped to this train.
