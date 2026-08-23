# CAPTURE-INT — A Scan Becomes an Asset (Internal/Staging Only)

**GrailKey Dispatch 2026-08-23, CAPTURE-INT.** The capture-order law's
middle step (`docs/adr/DATA-1C-MEDIA-DESIGN.md`, Addition 3): prove that a
completed scan — identity, authority, price, decision, photos — becomes a
durable asset with evidence, through the domain service, under the
operator principal. **NO production wiring, NO public path, NO
`api/enrich.js` changes.** Production capture waits for DATA-1D's auth
chain, exactly as ratified — `GK-151` stays OPEN/HARD-GATE.

**Predecessors:** DATA-1B service (`f31810f`) · DATA-1C media as corrected
(`8638a92`) · `ADR-ASSET-001` / `ADR-EVIDENCE-001` / `ADR-MEDIA-001` / the
capture-order law.

---

## TASK 1 — THE CAPTURE MAPPING

### 1a. Capture basis + collectionItemId routing

**Requirement, restated exactly as dispatched:** the same physical capture
replayed → the same asset (idempotent). Two different scans of the same
physical book → two capture events but must NOT blindly mint two assets.

**Basis shape.** `namespace: 'asset:capture'`, `key:
"<principalId>/<correlationId>"` (falls back to
`"<principalId>/<scanlogKey>"` when a scan genuinely has no
`correlationId`) — reuses `entity_mint_basis`'s own `UNIQUE
(basis_namespace, basis_key)` constraint (0003/DATA-1A) exactly as
`createPhysicalAsset` already does for every other caller; no new
idempotency mechanism invented. **Proven directly (P2b):** the identical
`correlationId`, submitted a second time with no `collectionItemId` at all
(so it cannot shortcut through the link below), still resolves to the
SAME asset — `mintOutcome: 'resolved-existing'`, not a second mint.

**collectionItemId → gkAssetId linkage.** New table,
`collection_item_link` (`db/data0/0007_capture_integration_linkage.sql`,
applied to `data1_dev` — see Task 2). **The law, restated exactly as
GK-145 first stated it and this dispatch repeats it:**
`collectionItemId != gkAssetId` — this table is a ROUTING lookup only
("which asset does a re-scan of this collection row attach to"), never a
claim about physical identity. Identity itself is established entirely
through `asset_identity_assignment` (Task 1b), completely independent of
this table.

**Routing rule, implemented exactly as specified:**
- A scan carrying a `collectionItemId` that ALREADY resolves to a link →
  attaches to that existing asset (new identity/media/valuation/decision
  evidence on the SAME `gkAssetId`, `mintOutcome:
  'attached-existing-via-link'`, `createPhysicalAsset` is never even
  called). **Proven (P3):** a real second scan of the same physical AWW
  book (same `collectionItemId`) lands on the identical `gkAssetId` as the
  first scan.
- A scan without a `collectionItemId`, or with one never linked before →
  mints fresh via the capture-basis mechanism above, then links the
  `collectionItemId` (if present) to the newly-minted asset for future
  re-scans to find. **Proven (P3):** a real, different AWW scan with a
  DIFFERENT, never-seen `collectionItemId` mints a genuinely new,
  distinct asset.

**Conflict handling (new, this dispatch):** `linkCollectionItem`
(`src/modules/assets/service.js`, extending the Asset Service — the 11th
operation) throws `ConflictError` rather than silently repointing a
`collectionItemId` already linked to a DIFFERENT `gkAssetId`. Relinking
(an operator genuinely needing to redirect a collection row to a
different physical asset — a data-entry correction) has no mechanism in
v1 — named as an open item in the migration file's own trailing comment,
not solved here.

### 1b. Identity translation

`enrich`'s confirmed identity + per-facet authority → `assignIdentity`
evidence. **A disclosed scoping limitation, stated plainly:** the
`scanPayload` shape this dispatch's capture module consumes mirrors the
REAL, already-durable `scanLog` record (`src/lib/scanLog.js`, GK-145/146
fields) — not the full ephemeral `out.*` HTTP response `api/enrich.js`
produces, which is never persisted anywhere at all (confirmed,
`docs/DATA-1-READINESS.md` section A1) and therefore isn't available as
real input to build or test against. `scanLog` tracks per-facet authority
for the ISSUE facet only (`issueAuthority`) — not title/year/variant
authority, which remain ephemeral. `mapIdentityEvidence`
(`src/modules/capture/mapping.js`) is therefore a coarse, disclosed
APPROXIMATION collapsing this into DATA-1B's single whole-asset
`authority` value:
- `issueAuthority.status === 'conflicted'` → `CONTESTED` (an explicit
  contest signal wins outright).
- A complete-looking `book` record (`title`+`issue`+`year` all present)
  with no contest signal → `CORROBORATED`.
- An incomplete `book` record → `NONE`, `source: 'unresolved'` — **Ruling
  10: the asset still mints.** Proven directly (P4) against a REAL scan
  whose `book.issue` is genuinely `null` (an actual production
  hypothetical-reference-issue-unresolved case, not constructed).

**`catalogEntityId` stays `null` on every capture, always — a second,
independent disclosed gap, not this dispatch's to solve:** `DATA-1B`'s own
repository.js already noted `catalog_entity` doesn't exist as a real table
in this schema at all (`DATA-0E-FULL` hasn't populated it yet) — so there
is currently no home for the identity's actual SUBSTANCE (the literal
title/issue/year/publisher/variant text) in the durable
`asset_identity_assignment` row, only its authority/source metadata.
`assignIdentity`'s own contract has no field for this either. **Not
worked around** (e.g. by stuffing text into the UUID column, or inventing
an ad hoc payload field on an operation this dispatch was told to call
as-is) — recorded here as a real, load-bearing limitation: today, the
identity SUBSTANCE a capture produces lives only in the source `scanLog`
record (90-day TTL) and the app's own IndexedDB, never durably in DATA-1.
Closing this is `DATA-0E-FULL`'s job, not a capture-integration patch.

### 1c. Media mapping

Each photo → `attachMedia` (DATA-1C, unmodified) with `captureRole`
defaulting to `'capture-photo'` (the schema's real `media_type` CHECK
vocabulary — `capture-photo | grading-photo | document` — front/back/
spine/pages are not separate schema-level roles; a caller wanting to
distinguish them passes multiple `capture-photo` rows, which is what this
mapping already supports via the `photos[]` array). Service-computed
hashes (C5, DATA-1C, unchanged) — the capture module never computes or
trusts a hash itself, it passes raw bytes straight through.
`idempotencyKey` is mandatory on every photo (D4, DATA-1C) — derived
deterministically as `` `${captureIdempotencyKey}:media:${i}` ``, so
replaying an entire `captureFromScan` call makes every photo attach hit
its own replay path too (proven, P2a).

### 1d. Economics mapping

- `outcome.price` present → `recordValuation` (`method: 'engine-computed'`
  — the REAL enum value `valuation_event.method` actually has;
  the dispatch's own suggested literal `'enrich-pipeline'` does not exist
  in the schema's CHECK constraint and was not invented here —
  `'engine-computed'` is the correct, already-real mapping for "the
  comic-vault pricing pipeline computed this"). `compSnapshotRef:
  "scanlog:<correlationId>"` (a real, resolvable pointer, not the actual
  comp snapshot itself — that remains ephemeral, per
  `docs/DATA-1-READINESS.md`'s own B1 finding, unchanged by this
  dispatch). `buildSha` from `scanPayload.evidence.promptVersion` — a
  real git SHA, confirmed present on every real record inspected.
  `gradeAssumption` stays `null`: `scanLog` carries `gradeMultiplier` (a
  derived ratio), not a numeric grade — mapping one into the other would
  be a real, wrong claim, not attempted.
- `outcome.decisionAction` present → `recordDecision`
  (`recommendation: outcome.decisionAction`, `reasonCodes:
  [outcome.pricingSource]` when present — `scanLog` does not carry
  `decision.blockers`/`.warnings` counts at all; no codes are fabricated
  to fill that gap).
- An explicit `scanPayload.acquisition` block (operator-entered; `scanLog`
  itself never populates one — confirmed, `docs/DATA-1-READINESS.md` A4)
  → `recordAcquisition`. Not exercised in this dispatch's staging proof
  (no real scan carries one) — the mapping exists and is unit-shaped
  correctly, but its real-data proof is still open.

Every sub-operation call is enveloped exactly as its own DATA-1B/1C
contract already requires — the capture module adds no event-writing of
its own (it has no database access at all — see Task 2).

---

## TASK 2 — IMPLEMENTATION

```
src/modules/capture/
  index.js     PUBLIC — captureFromScan, re-exports the Asset Service's
               own error taxonomy verbatim (never wrapped/renamed)
  service.js    PUBLIC surface — orchestrates ONLY via
                ../assets/index.js's public contract; issues ZERO SQL,
                holds NO database connection
  mapping.js     PRIVATE — pure functions only (Task 1a-1d), no I/O
```

Also extends the Asset Service (`src/modules/assets/`, same boundary
discipline, same pattern DATA-1C already used to add `attachMedia`):
`linkCollectionItem` / `resolveCollectionItemLink` (service.js), backed by
two new `repository.js` queries against the new `collection_item_link`
table. `index.js` re-exports both. `tests/assets-module-boundary.test.js`
extended to require both new names — **20/20 passing** (was 17/17).

**The boundary proof (P6), including the planted-violator check the
dispatch specifically asked for:** `tests/capture-module-boundary.test.js`
proves two things by static analysis, no DB needed:
1. `mapping.js` is never imported outside `src/modules/capture/`.
2. **Nothing in `src/modules/capture/` imports a PRIVATE file of EITHER
   module it depends on** — `assets/{repository,db,idempotency}.js` or
   `media/{driver-localfs,driver-vercel-blob,contentAddress}.js`. Capture
   can only reach either module through its public `index.js`.

**Verified non-vacuous, not just written and trusted:** a `PLANTED_VIOLATOR`
import of `../assets/repository.js` was temporarily added to
`capture/service.js`, confirmed to fail the test (`1 failed`, the exact
violation named in the output), then removed — same discipline DATA-1B's
own `S3-11` established for this exact class of test.

**Result: 7/7 passing.** (`tests/media-module-boundary.test.js`: 11/11,
unaffected. `tests/assets-module-boundary.test.js`: 20/20.)

---

## TASK 3 — THE STAGING PROOF

Run for real against `data1_dev`, the real `localfs` media driver, and
**three genuinely real `scanLog` records** (pulled live from Upstash via
`find-aww-scan.mjs`, not constructed) — `C:\grailkey-data\data-1\
p1-p6-capture-integration-proof.mjs` (local scratch, not committed, same
precedent as every prior DATA-1 proof script). **31/31 assertions
passing.**

**C6 disclosure:** photo bytes are the same honestly-labeled substitute
image used by DATA-1C's own M4 proof — real historical Absolute Wonder
Woman #16 photos are browser-IndexedDB-only and unreachable from this
environment, unchanged from DATA-1C's own finding.

**A genuinely useful real-data coincidence, not engineered:** the same
real scan (`correlationId f2b89bbf...`, `book.issue: null`) legitimately
satisfies BOTH P3's "a scan without linkage mints fresh" requirement
(a `collectionItemId` never seen before) AND P4's "unknown identity still
mints" requirement (a genuinely incomplete `book` record) — used under
both headings below, not duplicated as if two different fixtures.

```
P1  FULL LOOP — PASS (7/7)
    Real AWW scan (correlationId ff4eb86c..., $6.91, verified_sold_recency).
    gkAssetId: 01a02c0b-50f1-7490-804f-902cf5805176
    mintOutcome: minted-new · collectionItemId linked
    media[0]: localfs://sha256/93/938ea622da182b1cae8f50de8e51c4bb4e04409ddc286455d1fb1e28bb706d0c
    identity CORROBORATED (real complete book record) · valuation $6.91
    (engine-computed) · decision RESEARCH.

P2  IDEMPOTENT SCAN — PASS (8/8)
    (a) The identical captureFromScan call replayed verbatim: same
    gkAssetId, zero new media/valuation/decision/identity-assignment
    rows, routed via the link (mintOutcome attached-existing-via-link).
    (b) Mint-basis idempotency specifically, bypassing the link (same
    correlationId, no collectionItemId): same asset, mintOutcome
    resolved-existing — proves 1a's basis mechanism directly, not just
    the link-routing shortcut.

P3  RE-SCAN ATTACH — PASS (7/7)
    A REAL second scan of the SAME physical book (same collectionItemId,
    correlationId 229ea5a8..., issueAuthority now conflicted, price now
    null) attaches to the SAME gkAssetId — a NEW identity assignment
    superseding P1's, a NEW decision, correctly NO new valuation (real
    price was null this time). A REAL third scan with a DIFFERENT,
    never-seen collectionItemId mints a genuinely separate asset.

P4  UNKNOWN IDENTITY — PASS (4/4)
    The same real, issue:null scan from P3's "fresh mint" case: the
    asset exists, is retrievable, currentIdentityAssignment.authority ==
    'NONE', source == 'unresolved' — Ruling 10 proven against real data,
    not a constructed edge case.

P5  COLD RETRIEVAL — PASS (5/5)
    getPhysicalAsset on the P1/P3 asset, fresh read: currentIdentity
    Assignment correctly reflects the LATEST (P3, CONTESTED) assignment,
    not P1's stale CORROBORATED one (the supersession chain proven live
    across separate captureFromScan calls, not just within one). media
    graph includes P1's photo. valuations graph includes P1's valuation.
    decisions graph includes BOTH P1's and P3's decisions.

P6  BOUNDARY — PASS (7/7, tests/capture-module-boundary.test.js, run
    separately, repo-tracked, no DB needed) — see Task 2.
```

**GK-138 (handler-wiring verification): explicitly not applicable this
dispatch, stated per the dispatch's own instruction.** `GK-138`'s standing
protocol requires a real-`api/*.js`-handler smoke test whenever a dispatch
edits `api/enrich.js` wiring. This dispatch touches ZERO files under
`api/` — there is no handler wiring to prove; `captureFromScan` is called
directly by the P1-P6 proof script, which IS the equivalent real-call
proof for this module (matching GK-138's underlying principle — a real
invocation, not just unit-level library coverage — even though the
specific `api/enrich.js` trigger condition doesn't apply here).

---

## CRAWL — liveness check (read-only, per the "crawl untouched" constraint)

PID **16696** confirmed alive (`node`, started 2026-08-22 16:21:08 local).
Checkpoint still in **fetching-details** phase. Rate limit tightened since
DATA-1C's own check (`sustainedRemaining` 729 → **99** of the sustained
budget, `burstRemaining` 3, observed 2026-08-23T00:13:39.964Z) — not
rate-limited outright, but materially closer to its own gate than before.
No action taken — the crawl's own two-layer rate-limit gate
(`docs/DATA-1-ACQUISITION-QUOTA-WINDOW.md`) is its own established
safeguard; this is a read-only observation, not a finding requiring
intervention this dispatch.

---

## COMMITS

**Census, this dispatch's own changes only:**

```
new:      db/data0/0007_capture_integration_linkage.sql
new:      docs/adr/DATA-1-CAPTURE-INTEGRATION.md
new:      src/modules/capture/index.js
new:      src/modules/capture/service.js
new:      src/modules/capture/mapping.js
new:      tests/capture-module-boundary.test.js
modified: src/modules/assets/service.js       (+linkCollectionItem,
                                               +resolveCollectionItemLink)
modified: src/modules/assets/repository.js    (+insertCollectionItemLink,
                                               +getCollectionItemLink)
modified: src/modules/assets/index.js         (+2 new exports)
modified: tests/assets-module-boundary.test.js (+2 required exports)
```

(`C:\grailkey-data\data-1\p1-p6-capture-integration-proof.mjs` and
`find-aww-scan.mjs`, local scratch, not committed — same precedent as
every prior DATA-1 proof script.)

**Pre-existing quarantined scratch files**
(`scripts/capture-active-cache-entry.mjs` modified,
`scripts/ingest-fixture-response.mjs`/`scripts/merge-fixture.mjs`
untracked) remain exactly as found across every DATA-1 dispatch in this
session — not part of this commit.

**Local only. Ask before push.** Zero `api/` files touched. No UI change.
No public endpoint. `GK-151` untouched.
