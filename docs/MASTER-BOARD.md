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
| Next action | D1 (this document), then D2, then D3, per the ratified sequencing |

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

**Gate: Production capture must not be enabled at D6 while it is undetermined whether Production shares the same writable database failure domain as Development/test activity.** Resolving this (Neon branch-per-environment vs. confirmed-separate topology) is now a pre-D6 gate, not a preference — see `docs/DATABASE-MIGRATION-STATUS.md` and the D2 checkpoint report (2026-09-01) for the two topology options under review. No branch was created, no schema was migrated, and Production was not repointed as part of establishing this row.

---

## Governance / registry notes

- **GK-173, GK-174 — do not exist.** Grepped globally across the repo for both identifiers — zero hits in any file. The 2026-09-01 dispatch's "delete GK-173/GK-174 as strategy-only labels never registered" instruction is therefore a **no-op**: there is nothing in `docs/TICKET-REGISTRY.md` to delete. Recorded as a contradiction between the dispatch's framing (which implies these were registered entries) and the actual registry state, not silently skipped.
- **GK-171 — open creator→variant root class.** Status REPORT-ONLY (`docs/TICKET-REGISTRY.md:157`): `extractFirstEligibleVariantCandidate` may yield a wrong creator on the Absolute Batman #19 artist-recognition fixture; logged verbatim per operator ruling, not investigated or fixed, explicitly not folded into the GK-168/169/172 train. This is the **root class**; GK-148 (`docs/TICKET-REGISTRY.md:132`, CLOSED, build `38ee71d`) was a **point fix** — the `PUBLISHER_STOP_LIST` addition to `fuzzyAliasMatches` that closed one specific creator/publisher-name collision (and two more found during that same pass: Boom Studios↔Broome, Disney↔Eisner/Bisley). GK-171 remains open and distinct.
- **Edition-grounding — CONTAINED at HEAD.** The GK-168/169/172 edition-facet work is grounded through three real mechanisms: the grading prompt, regex classification, and `reconcileEditionFacet` (`src/lib/identityCore.js:1702`). Structural separation of raw observation from interpretation is flagged as future hardening — not built, not scoped to this train.
