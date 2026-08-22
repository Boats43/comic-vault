# DATA-1 Foundation — The Durable Physical Asset: Design Document

**GrailKey Dispatch 2026-08-22 (DATA-1 Foundation).** MODE: design-then-
bounded-build. This document covers the WHOLE physical-asset graph as one
coherent unit — every table below carries its governing ADR ruling —
even though Task 2 implements only a bounded slice of it against a real
database. No production/scanner wiring, no auth implementation, no
public write path, no object-storage vendor decision, no outbox
dispatcher, no IndexedDB migration, and no 0F (knowledge-lane minting)
happen in this dispatch. The current GrailKey application (`api/`,
`src/App.jsx`, IndexedDB) keeps working untouched alongside everything
below.

**Objective, one sentence:** mint one real physical comic durably —
photo → permanent `gkAssetId` → media → identity → evidence → owner →
cost → valuation → decision → close everything → retrieve it all again.

---

## 1. The whole graph, by governing ADR

```
PRINCIPAL / ORGANIZATION            ADR-AUTH-001 (Rulings 12-13, 36)
  gk_principal . gk_organization . membership/role

OWNERSHIP + CUSTODY                 ADR-AUTH-001 (Rulings 14-15)
  ownership_event (append-only) + materialized current_owner
  custody_event (append-only)

THE ASSET                           ADR-ASSET-001 (Rulings 9-11)
  gk_asset -- UUIDv7, minted at capture, identity-independent

MEDIA                                ADR-MEDIA-001 (Ruling 16)
  media -- metadata + content hashes, object_uri nullable/local-path

IDENTITY ASSIGNMENT                 ADR-EVIDENCE-001 (Rulings 18-19)
  asset_identity_assignment -- append-only

ECONOMICS + HISTORY                 ADR-EVENT-001 (Rulings 20-22)
  acquisition_event . condition_observation . valuation_event .
  decision_event

EVENT ENVELOPE + OUTBOX             ADR-EVENT-001 (Ruling 21) /
                                     ADR-ASYNC-001 (Ruling 23)
  domain_event . outbox
```

Every table below cites the specific Ruling it implements. Where a
table's own DDL comment repeats this citation, that is deliberate —
per this project's own standing "grep the invariant before you touch it"
discipline (CLAUDE.md's `applyDualAxisGate` reason-string coupling
precedent), a future editor should never need to leave the DDL file to
find out WHY a constraint exists.

---

## 2. Principal / Organization — ADR-AUTH-001, Rulings 12-13, 36

**`gk_principal`** — "the authenticated actor making a request" (Ruling
12). One row per real-world actor. This dispatch seeds exactly ONE row —
Jimmy, the sole current operator — via migration/seed, not a signup
flow. No auth implementation of any kind happens here: no password
hashing, no session tokens, no login endpoint. `gk_principal` exists so
every other table (`ownership_event.principal_id`, `domain_event.actor.
principal_id`, etc.) has something real to point at instead of a bare
string or a TODO.

**`gk_organization`** + **`gk_membership`** — designed now, NOT seeded
with any row this dispatch (Jimmy operates as an individual principal,
not inside an organization yet). Included because Ruling 12's
principal/owner/custodian model needs an organizational container ready
for the day a second real user (a consignment partner, a shared family
collection, a future multi-seat account) needs one — building it later
as a bolted-on afterthought is exactly the class of retrofit this
project's ADR process exists to avoid.

**GK-151 stays OPEN, HARD-GATE, exactly as ADR-AUTH-001 already ruled.**
This dispatch's seed principal is a bootstrap row satisfying "something
for other tables to reference," never a claim that Ruling 13's four-step
authorization chain (authenticated principal -> authorized asset ->
authorized marketplace account -> authorized mutation) is implemented or
enforced anywhere. No endpoint in `api/` checks `gk_principal` for
anything — there is no endpoint touched by this dispatch at all.

---

## 3. Ownership + Custody — ADR-AUTH-001, Rulings 14-15

**`ownership_event`** (append-only, Ruling 14) — every row is a NEW
ownership fact, never an edit. Minimal shape: `asset_id`, `principal_id`
(the new owner), `occurred_at`, `reason` (`'initial-mint'` |
`'transfer'` | `'correction'`), `recorded_by_principal_id`. The FIRST
ownership_event for a newly-minted asset (reason='initial-mint') is what
establishes who owns a book the moment it's captured — Ruling 10's
"minted at capture" moment needs an owner from the very first instant,
not a nullable gap waiting for a later assignment step.

**`current_owner`** (materialized) — one row per `asset_id`, the
denormalized "who owns this right now" answer, rebuilt from
`ownership_event`'s own append-only history (THE REBUILD RULE, applied
here exactly as `0002_comic_projection.sql`'s own header already applies
it to the catalog layer: a materialized view is only ever a cache of
what the append-only log already proves, never a second independent
truth). T3-5 (Task 3) proves this materialization stays correct across a
transfer.

**`custody_event`** (append-only, Ruling 14) — same shape, describing
physical possession/control rather than legal ownership (Ruling 12's
owner/custodian distinction). Designed, not seeded or exercised by any
Task 3 proof this dispatch — the foundation slice's T3-5 proof exercises
ownership transfer specifically; a dedicated custody-transfer proof is
this table's own future work, named here as an open item so it isn't
silently assumed proven by the ownership proof alone.

**Delegation (Ruling 15)** — designed in this document only, NOT built
this dispatch. A `delegation_event` table (owner authorizes a custodian
to act on their behalf, scoped and revocable) is named as a future
table, not drafted in the DDL below — it depends on Ruling 13's full
authorization chain existing first (GK-151, still OPEN), and building
its schema ahead of that chain risks guessing at a shape the real
authorization implementation will want to change anyway.

---

## 4. The Asset — ADR-ASSET-001, Rulings 9-11

**`gk_asset`** — the one physical object, full stop (Ruling 9). Minted
at capture (Ruling 10): the moment a scan/photo capture flow begins
recording a new physical item, before Vision has run, before any
identity claim exists. `id` is a UUIDv7 (ADR-ID-001), minted via the SAME
mint-ledger machinery `entity_mint_basis`/`mint_event`
(`db/data0/0003_uuidv7_identity_and_mint_ledger.sql`) already proves for
catalog entities — reused here, not reinvented, per this project's own
"never a second independently-derived mechanism for the same job"
discipline (the exact failure class ADR-EVIDENCE-001 Ruling 18 names for
identity reconciliation, generalized here to identity MINTING).

**Mint-basis namespace for assets: `asset:capture-event`.** The basis
KEY is a stable identifier for the capture invocation itself — for this
dispatch's real proof (Task 3), a deterministic composite of
`{principal_id}:{capture_timestamp_iso}:{content_hash_of_first_photo}`
is used as the basis key content, satisfying `0003`'s own basis-key
stability clause (never recomputed from mutable attributes like
identity, grade, or price — a capture EVENT's own identity is durable by
construction: the same physical button-press/API-call is never repeated,
so re-running the SAME capture basis is specifically the mint-idempotency
proof case, T3-4, not an ordinary occurrence). `asset_class` is tagged at
mint time (`'comic'` for every case this dispatch touches — the
AssetCore/BookAdapter/CardAdapter roadmap CLAUDE.md already documents is
what a future `'book'`/`'card'` value would serve).

`gk_asset.status` — lifecycle flag (`'active'` | `'archived'` |
`'merged-into-other-asset'`, the last reserved for ADR-ASSET-001's own
explicit-user-merge action, out of scope for this dispatch per that
ADR's own Implementation Gates).

**Duplicate-copy law (ADR-ASSET-001's own un-numbered but binding rule):**
`gk_asset` carries NO uniqueness constraint tied to catalog identity —
two assets resolving to the same `gkIssueId` are ordinary and expected
(T3-3 proves this directly). The ONLY uniqueness this table enforces is
the mint-basis one, inherited from `entity_mint_basis`'s own `UNIQUE
(basis_namespace, basis_key)` invariant (C2-v2, `0003`'s current design)
— re-running the exact same capture-event basis resolves to the same
asset; a genuinely new capture (different timestamp, different content
hash) always mints a new one, even for the identical physical book
re-scanned five minutes later. That is a deliberate, correct default per
Ruling 11's own duplicate-copy law: the system cannot tell "re-scan of
the same book" from "bought a second copy" apart, so it doesn't try —
merging two assets into "actually the same physical object" is an
explicit, out-of-scope-for-this-dispatch user action.

---

## 5. Media — ADR-MEDIA-001, Ruling 16

**`media`** — one row per photo/document. NEVER a `bytea`/blob column
(Invariant 1). Fields: `id` (UUIDv7), `asset_id`, `media_type`
(`'capture-photo'` | `'grading-photo'` | `'document'`), `content_hash`
(SHA-256 of the actual bytes — this is what makes T3-4's mint-basis key
content, above, genuinely tied to the real photo rather than an
arbitrary label), `object_uri` (**nullable** this dispatch — object-
storage vendor selection is explicitly out of scope, per the dispatch's
own constraints; a real photo's bytes are NOT durably stored by the
Task-2 implementation), `local_path_placeholder` (a plain local
filesystem path, used ONLY by Task 3's own proof scripts to demonstrate
the shape works end-to-end — explicitly a placeholder, never a real
storage mechanism, and never read by anything outside this dispatch's
own test harness), `captured_at`, `recorded_by_principal_id`.

**Object-storage vendor selection is a NAMED OPEN ITEM, not decided
here.** `DATA-1-READINESS.md`'s own C-section inventory already named
the realistic candidates (Vercel Blob — same project, `@vercel/blob` not
installed; an external S3-compatible store) without choosing between
them; this document does not resolve that question either. `media.
object_uri` is designed to receive whichever URI scheme the eventual
choice produces, unmodified.

Per Invariant 3, a corrected/replaced photo is a NEW `media` row, never
an overwrite — same append-only discipline as every other evidence
record in this graph.

---

## 6. Identity Assignment — ADR-EVIDENCE-001, Rulings 18-19

**`asset_identity_assignment`** (append-only, Ruling 19) — every
reconciliation result for a given asset is a NEW row. Fields: `id`
(UUIDv7), `asset_id`, `catalog_entity_id` (**nullable** — Ruling 10's own
"identity=UNKNOWN is fully valid" state, and, independently, nullable
until DATA-0E-FULL actually populates `catalog_entity` rows to reference
— today, `catalog_entity_id` has nothing real to point at yet regardless
of an asset's own identity-resolution state), `authority`
(`'NONE'`/`'CONTESTED'`/`'CORROBORATED'`, Ruling 18's reconciliation
output — the SAME three-value vocabulary `resolveTitle`/`resolveIssue`/
`resolveYear`/`reconcileVariantFacet` already use for the catalog layer,
reused rather than reinvented), `assigned_at`, `source`
(`'vision'`|`'operator-correction'`|`'unresolved'`), `superseded_by`
(nullable self-reference — the prior assignment a later one replaces;
never deleted, matches T3-2's own proof requirement).

**AI never writes truth directly (Ruling 18's own binding line).** No
`asset_identity_assignment` row is ever written straight from a raw
Vision output — Task 2's implementation writes assignment rows only
AFTER Task 3's own harness simulates the claim -> evidence ->
reconciliation pipeline (reusing `identityReconciler.js`'s own exported
functions where the harness's synthetic evidence shape allows, rather
than hand-rolling a parallel authority derivation — the exact Q54/Q84/
AK/AQ failure class Ruling 18 exists to close off a fifth time).

---

## 7. Economics + History — ADR-EVENT-001, Rulings 20-22

**`acquisition_event`** — cost basis. `asset_id`, `cost_amount`,
`cost_currency`, `source` (`'purchase'`|`'gift'`|`'inherited'`|...),
`lot_reference` (nullable — free text or a future `lot` table FK, for
"bought as part of a bulk lot" provenance), `occurred_at`,
`recorded_by_principal_id`. One or more per asset over its lifetime (a
book can be re-acquired after a sale-and-buyback, rare but real).

**`condition_observation`** — a point-in-time grade/condition READING,
distinct from `valuation_event` below (a condition observation feeds a
valuation but is not itself a price). `asset_id`, `grade_scale`
(`'CGC'`|`'raw-estimate'`|...), `grade_value`, `defect_flags` (JSONB,
matching the shape `cgcPenaltyFlags` already uses in the current
runtime — CLAUDE.md's "CGC penalty-aware Vision" section), `observed_at`,
`media_id` (nullable FK — the photo this observation was made from, if
any), `recorded_by_principal_id`.

**`valuation_event`** (Ruling 20's own example event type, `'valuation.
computed'`) — `asset_id`, `value_amount`, `value_currency`, `method`
(`'engine-computed'`|`'operator-override'`|`'gocollect'`|...),
`comp_snapshot_ref` (nullable — a pointer to a comp-pool snapshot,
matching the existing `priceDerivationTrace` shape CLAUDE.md's GK-42
finding already names as "the richest diagnostic field, never
persisted" — this table is where that gap eventually gets closed, though
closing it for real is not this dispatch's scope), `grade_assumption`
(the grade this valuation was computed AGAINST — may differ from
`condition_observation`'s own latest reading if a valuation models a
hypothetical grading outcome, matching the existing CGC-submission-
scenario feature), `build_sha` (which deployed commit produced this
number — direct traceability to the exact pricing-math version, per
CLAUDE.md's own pricing-stack discipline), `occurred_at`,
`recorded_by_principal_id`. Many per asset over its lifetime — T3-6
proves two coexist, ordered, with distinct method provenance.

**`decision_event`** — `asset_id`, `recommendation`
(`'LIST_NOW'`|`'RESEARCH'`|`'GRADE_CANDIDATE'`|... — the SAME vocabulary
`decisionEngine.js` already emits), `reason_codes` (JSONB array — the
same blocker/warning slugs `describeBlocker`/`describeWarning` already
produce), `valuation_event_id` (FK — which valuation this decision was
computed from), `occurred_at`. Advisory, non-authoritative, exactly as
`docs/DATA-0-ARCHITECTURE.md` §10's five-way split already classifies
this record class (below).

---

## 8. Event Envelope + Outbox — ADR-EVENT-001 Ruling 21 / ADR-ASYNC-001 Ruling 23

**`domain_event`** — the standard envelope, verbatim from ADR-EVENT-001
Ruling 21: `event_id` (UUIDv7), `event_type`, `occurred_at`, `actor`
(JSONB: `{principal_id, kind}`), `subject` (JSONB: `{entity_type,
entity_id}`), `payload` (JSONB), `correlation_id`, `schema_version`.
Every mutation in Task 2's implementation (asset mint, identity
assignment, acquisition, valuation, decision, ownership transfer) writes
a `domain_event` row in the SAME transaction as its own state-holding
write (Ruling 20's hybrid model — events are a SECONDARY, derived
stream, never the sole record).

**`outbox`** — Ruling 23's durability anchor: `id`, `domain_event_id`
(FK), `status` (`'pending'`|`'processed'`|`'dead-letter'`), `attempts`,
`created_at`, `processed_at` (nullable). **Table DDL only, this
dispatch.** No dispatcher, no worker, no queue consumer is built —
`outbox` rows accumulate `status='pending'` and stay that way; a future,
separately-scoped dispatch builds the queue/worker/DLQ machinery Ruling
23 describes. This is explicitly named in the dispatch's own
constraints ("no outbox dispatcher") and repeated here so a future
reader of this schema doesn't mistake an empty pending queue for a bug.

**Audit vs. trace (Ruling 35)** — every `domain_event` this schema
produces is AUDIT class (who did what, when, to what, tied to a real
`gk_principal` and a real subject entity) — never a trace/debugging
stream. `console.log` phase-timing instrumentation elsewhere in this
codebase (`api/enrich.js`'s `[perf]` lines) remains trace class,
untouched, unaffected by this schema.

---

## 9. The five-way record-class mapping, restated

Per `docs/DATA-1-READINESS.md`'s D1 finding and
`docs/DATA-0-ARCHITECTURE.md` §10's own binding law ("a physical copy
REFERENCES canonical identity — it is never a second copy of it"),
restated here against THIS dispatch's actual tables:

| # | Record class | Today's flat field examples | DATA-1 table |
|---|---|---|---|
| 1 | Catalog identity | `title`, `issue`, `year`, `publisher`, `variant` | `comic_series`/`comic_issue`/`comic_publisher`/`comic_variant`/`comic_printing` (`0002`, referenced via `asset_identity_assignment.catalog_entity_id`, never restated on the asset) |
| 2 | Physical-copy state | `grade`, `isGraded`, `numericGrade`, `cgcPenaltyFlags`, `pop`, `images` | `gk_asset` + `condition_observation` + `media` |
| 3 | Valuation event | `price`, `pricingSource`, `comps`, `rawComps`, `soldComps`, `priceChart`, `priceBands` | `valuation_event` |
| 4 | Decision (advisory) | `decision`, `claudeCheck`, `demandSignals`, `actionAuthority`, `contract` | `decision_event` |
| 5 | Ownership economics | `purchasePrice`, `userFmv98` | `acquisition_event` + `ownership_event`/`current_owner` |

(A sixth/seventh item in `DATA-1-READINESS.md`'s own fuller enumeration —
`identityAuthority`'s operator-lock/authority naming collision, and raw
external payload dumps like `comicVine`/`goCollect` — are addressed
separately below and are not additional record-CLASSES in the same
five-way sense; the readiness doc's own numbering already flags this.)

## 10. The `operator_lock` vs. `authority` naming law

Per `docs/DATA-0-ARCHITECTURE.md` §10's own explicit ruling: today's
runtime field `item.identityAuthority` (GK-85's per-field
`OPERATOR_CONFIRMED` lock map, `src/lib/dataQualityGuard.js`) collides in
NAME with `0002_comic_projection.sql`'s own per-facet `*_authority`
columns while answering a DIFFERENT question:

- **`operator_lock`** — "has a human told the system not to overwrite
  this field automatically." A permission/lock state.
- **`authority`** — "does the evidence corroborate this value" (`NONE`/
  `CONTESTED`/`CORROBORATED`).

`asset_identity_assignment.authority` (Section 6, above) is the SECOND
of these two axes — evidence corroboration, exactly matching `0002`'s
own vocabulary. This dispatch's schema does NOT yet add an explicit
`operator_lock` column anywhere, because no capture/correction FLOW is
being wired this dispatch (no scanner/production wiring, per the
dispatch's own constraints) — there is no live process yet that would
SET an operator lock. Naming the gap here, rather than silently
collapsing the two axes into one column the moment a future dispatch
adds a correction flow, is the entire point of restating this law: the
day `asset_identity_assignment` (or a sibling table) gains operator-
correction support, it must carry `operator_lock` as an INDEPENDENT
column from `authority`, never reuse or overload the same field.

## 11. IndexedDB migration posture — named open item, not built

Today's client-side collection record (`src/App.jsx`, IndexedDB) is the
ONLY place a user's actual comic collection lives right now. This
dispatch does not touch it, read from it, or write to it. A future
import path — reading an existing IndexedDB collection and minting a
real `gk_asset` + full graph for each existing item — is named here as
the eventual bridge between "the prototype's data" and "the durable
foundation this dispatch builds," but is explicitly NOT designed in
detail and NOT built this dispatch. Candidate shape for that future
work (recorded for the next dispatch to pick up, not binding): a
one-time, user-triggered export/import flow, asset-by-asset, using the
SAME `asset:capture-event` mint-basis namespace with the IndexedDB
record's own `timestamp`+image-hash as the basis key content, so a
double-run of the import is naturally idempotent via the same mechanism
T3-4 proves for live captures.

## 12. UUIDv7 generation — database-native, per Phase-1 evidence

Per ADR-ID-001's own ratified decision (native `uuidv7()`, invoked
explicitly by the minting code at the moment a mint is confirmed, never
a passive column default) — every table's `id` column in this schema
follows the identical pattern already used by `0003`'s
`entity_mint_basis`/`catalog_entity`. **Open item, noted not
implemented:** device/offline asset minting (a future mobile/PWA capture
flow that mints a `gkAssetId` before ever reaching a server connection)
cannot call a database function it has no connection to — that future
capability will require app-side UUIDv7 generation, which ADR-ID-001's
own Rejected Alternatives section declined for the CURRENT server-side-
only use case specifically because of the hand-implementation-risk/
new-dependency tradeoff. A future offline-mint capability is therefore a
named ADR-ID-001 SUPERSESSION CANDIDATE, not a silent exception to it —
recorded here so it is proposed as a formal amendment when that need is
real, not worked around ad hoc in application code.

---

## 13. What this document does not do

- Does not execute any DDL against any database (see the separate `db/data0/0004_data1_foundation.sql` draft, same non-runnable convention as `0003`).
- Does not implement `delegation_event`, object storage, the outbox dispatcher, or the IndexedDB import path — all named above as open items.
- Does not wire any `api/` endpoint, scanner flow, or public write path to any table described here.
- Does not decide the object-storage vendor.
- Does not claim GK-151 is closed, partially closed, or on a timeline to close — the seeded `gk_principal` row is a bootstrap fixture, not a step toward auth implementation on its own.
