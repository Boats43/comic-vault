# DATA-1B — The Durable Asset Service (Design)

**GrailKey Dispatch 2026-08-22 (DATA-1B).** DATA-1A (`3f2bdad`, deployed) proved the
database: 13 tables live in `data1_dev`, 8/8 invariants proven at schema level via
raw SQL scripts, operator principal seeded. This dispatch proves the application can
use that database correctly — through one owned module, never around it.

**Mode: bounded build.** No production/scanner wiring, no public endpoint (GK-151
stays OPEN/HARD-GATE), no object storage, no outbox dispatcher, no IndexedDB
migration. The crawl (PID 21428) and `data1_dev`'s existing tables are untouched
except through the service's own operations described here.

## 0. Preflight correction — two citations in the dispatch do not trace to a real ruling

Per this repo's own standing Directive Preflight Requirement (CLAUDE.md), both
citations were checked against the actual ADR text before any code was written.

- **"Ruling 27 (modular monolith, hard module boundaries)"** — checked against
  `docs/adr/ADR-API-001-api-contract-discipline.md`, the actual owner of Ruling 27:
  its real content is **"structured errors, always correlation-traceable, never
  genericized away"** — a response-shape rule, not a module-placement rule. Grepped
  every ADR and every `docs/*.md` file for "modular monolith" / "hard module
  boundaries" — zero hits anywhere in this repository. No ratified Summit ruling
  establishes a module-boundary mandate under any number.
- **"the full envelope (correlation/causation/principal populated)"** (Task 1c,
  events) — Ruling 21's ratified envelope (`docs/adr/ADR-EVENT-001-event-model.md`)
  and the live `domain_event` table both carry `correlation_id` only. There is no
  `causation_id` field in either the ratified envelope or the schema.

**Resolution, not a blocker:** Section 1's module boundary is built anyway — it is
good architecture on its own merits (this repo already separates `src/lib/` pure
helpers from `api/*.js` handlers; a hard-boundaried module for a second, unrelated
persistence layer is the same discipline applied consistently) — but it is
justified here as an engineering default, not attributed to a nonexistent ruling.
Section 3's event emission populates `correlation_id` only, per the envelope that
actually exists; "causation" is not implemented and not silently invented as an
extra column (schema changes are scoped explicitly in Section 6, and inventing a
column to match an unratified citation would be the exact kind of undocumented
schema drift DATA-1A's own "never an inline alteration" rule exists to prevent).

## 1. Module boundary

**Placement:** `src/modules/assets/` — a new top-level module directory, sibling to
`src/lib/` and `src/adapters/`, not nested inside either (this is a second
persistence-backed domain, not a pure helper and not a format adapter).

```
src/modules/assets/
  index.js         PUBLIC — the only file anything outside this module may import
  service.js       PUBLIC surface implementation — orchestrates transactions,
                   calls repository.js, never issues SQL directly
  repository.js     PRIVATE — every SQL statement in the module lives here and
                    nowhere else; never imported outside this directory
  db.js              PRIVATE — lazy pg.Pool singleton, env-var sourced
  errors.js           PUBLIC — typed error classes (re-exported from index.js)
  idempotency.js       PRIVATE — idempotency-key check/write, used by service.js
```

**What's public:** the nine service functions (Section 2) and the five error
classes (Section 4) — both re-exported from `index.js`. Nothing else. A caller
imports `from '../../src/modules/assets/index.js'` (or the package-relative
equivalent) and gets exactly that surface.

**What's private:** `repository.js`, `db.js`, `idempotency.js` — raw SQL, the pool,
and the idempotency-key mechanics never appear outside this directory. `service.js`
is the only file permitted to import `repository.js`.

**Enforcement (S3-11):** a lint-able boundary chosen for being cheap and
unambiguous rather than requiring a new tool dependency — a proof script (not a
build-time lint rule, since this repo has no module-boundary lint config and
adding one is out of this dispatch's bounded scope) that `grep -rl` the entire
tracked source tree (`api/`, `src/`, excluding `src/modules/assets/` itself) for
any import path containing `modules/assets/repository` or `modules/assets/db`, and
fails if it finds one. Directory convention is the mechanism; the test is what
makes the convention verifiable rather than aspirational.

## 2. The service contract, v1

Nine operations, every one requiring `principalId` as its first authorization
input (Section 4):

```
createPhysicalAsset({ principalId, captureBasis, assetClass, source, idempotencyKey? })
  -> { assetId, basisId, outcome: 'minted-new' | 'resolved-existing' }
  Mints via entity_mint_basis (Ruling 10/11) — same captureBasis always resolves to
  the same asset, whether via the basis-table's own UNIQUE constraint (mint
  idempotency, proven again in S3-4) or an explicit idempotencyKey replay (S3-9).
  `source` seeds the FIRST ownership_event (reason='initial-mint') with
  owner_principal_id = principalId — the minting principal is the initial owner
  in this v1 (no delegated/third-party minting flow exists yet).

getPhysicalAsset({ principalId, gkAssetId })
  -> { asset, currentIdentityAssignment, media: [...], currentOwner,
       ownershipHistory: [...], acquisitions: [...], valuations: [...],
       decisions: [...] }
  One call, full graph, read-only (no transaction needed — a snapshot read is
  acceptable for v1; see Section 5 for the one open consistency question this
  leaves).

assignIdentity({ principalId, gkAssetId, catalogEntityId, evidence })
  -> { assignmentId }
  catalogEntityId may be null (identity=UNKNOWN is valid, ADR-ASSET-001 Invariant
  4). `evidence` maps to authority ('NONE'|'CONTESTED'|'CORROBORATED') and source
  ('vision'|'unresolved') — never 'operator-correction' from this entry point (see
  correctIdentity). Supersedes the asset's prior live assignment (superseded_by),
  if one exists — new row, prior row never edited (Ruling 19).

correctIdentity({ principalId, gkAssetId, newCatalogEntityId, reason })
  -> { assignmentId }
  Same append-only mechanic as assignIdentity, source is always fixed to
  'operator-correction', authority is always fixed to 'CORROBORATED' (a human
  correction is definitionally the strongest authority this vocabulary has).
  gkAssetId itself is never touched — no code path in this service ever issues an
  UPDATE against gk_asset.id, by construction (Ruling 11).

attachMediaMetadata({ principalId, gkAssetId, mediaFields })
  -> { mediaId }
  mediaFields: { mediaType, contentHash, objectUri? } — object_uri stays nullable
  (ADR-MEDIA-001, vendor not chosen). No blob bytes ever pass through this
  service — a caller that already has bytes stores them elsewhere and passes the
  resulting URI/hash here.

transferOwnership({ principalId, gkAssetId, toPrincipalId, type, reason, idempotencyKey? })
  -> { ownershipEventId }
  `type` is reserved for a future ownership-vs-custody split (ADR-AUTH-001 Ruling
  12 names both), but this dispatch's live schema (Section 6) has no
  custody_event table at all — rather than silently accepting `type: 'custody'`
  and writing an ownership_event anyway (a real behavior/label mismatch), v1
  requires `type === 'ownership'` and throws `ValidationFailedError` for anything
  else, naming the missing table in the message. Appends history AND rewrites the
  current_owner materialization in the same transaction (Ruling 14 history + the
  existing rebuild-on-write convention `lib.mjs`'s `recordOwnershipEvent` already
  established). `toPrincipalId` is validated to be a real `gk_principal` row
  (`NotFoundError` if not) — distinct from the acting `principalId`'s own
  authorization check.

recordAcquisition({ principalId, gkAssetId, costAmount, costCurrency?, source, lotReference?, idempotencyKey? })
  -> { acquisitionEventId }

recordValuation({ principalId, gkAssetId, valueAmount, valueCurrency?, method, compSnapshotRef?, gradeAssumption?, buildSha, idempotencyKey? })
  -> { valuationEventId }

recordDecision({ principalId, gkAssetId, recommendation, reasonCodes?, valuationEventId?, idempotencyKey? })
  -> { decisionEventId }
```

Every operation that writes state also emits a `domain_event` (Section 3) inside
the same transaction. `getPhysicalAsset` is the only read-only operation and emits
nothing.

## 3. Cross-cutting laws

**Transactions.** Every service function that mutates state opens exactly one
`BEGIN…COMMIT` (or `ROLLBACK` on any thrown error) spanning every write the
operation makes — the mint-basis claim (where applicable), the state-table
INSERT/UPDATE, the idempotency-key claim (if a key was supplied), and the
`domain_event`+`outbox` pair. `createPhysicalAsset`'s transaction is exactly
DATA-1A's own `mintAsset` proof (`lib.mjs`), reused verbatim inside the service —
the same race proof, now behind the public contract instead of a scratch script.

**Idempotency.** `createPhysicalAsset`'s own idempotency is already structurally
guaranteed by `entity_mint_basis`'s `UNIQUE (basis_namespace, basis_key)` — no new
mechanism needed for minting specifically (S3-4 re-proves this fact, through the
service, unchanged from DATA-1A). The other six mutating operations have no
equivalent natural key — calling `recordValuation` twice with "the same" logical
request currently has no way to detect that sameness. **This required one new
piece of schema** (Section 6) — a generalized `idempotency_key` table, the same
UNIQUE-constraint-as-idempotency-gate shape `entity_mint_basis` already
established, applied to every operation name instead of just minting. Every
mutating service function accepts an optional `idempotencyKey`; when present, the
transaction's first statement is a claim attempt against `(operation,
idempotency_key)` — a claim miss (the key was already used) returns the ORIGINAL
result verbatim with zero new writes (S3-9), never re-executes the mutation.
Omitting `idempotencyKey` is legal (not every caller has a natural replay key yet
— e.g. a human operator clicking a button once) and simply skips the check;
idempotency is opt-in per call, not force-required, matching how `entity_mint_basis`
itself is unconditional (structural) while this new mechanism is deliberately a
parameter contract, not a global at-most-once guarantee for every write in the
system.

**Events (Ruling 21).** Every mutation emits one `domain_event` row (plus its
`outbox` row) with `event_id` (`uuidv7()`), `event_type`, `occurred_at`, `actor:
{principal_id, kind}`, `subject: {entity_type: 'gk_asset', entity_id}`, `payload`
(operation-specific), `correlation_id`. No dispatcher, no worker — rows
accumulate in `outbox` with `status='pending'`, exactly as DATA-1A left them.
`correlation_id` is caller-supplied when available (e.g. a real scan's
`correlationId`, threading the asset's whole lifecycle back to the scan that
created it) and freshly minted (`uuidv7()`) when the caller has none to offer.

**Authorization parameter (ADR-AUTH-001).** Every operation's FIRST action, before
any other work, is `assertPrincipalActive(principalId)` — a lookup against
`gk_principal WHERE id = $1`. **This is a parameter contract, not an auth system:**
it proves the caller supplied a real, existing principal id; it proves nothing
about whether THIS principal is allowed to touch THIS asset (Ruling 13 steps 2–4 —
asset authorization, marketplace-account authorization, mutation authorization —
are explicitly out of scope, reserved for DATA-1D). **"Active," honestly stated:**
the live `gk_principal` schema (Section 6) has no status/deactivation column at
all — Rulings 12–15/36 describe a durable owner/custodian model, not a
principal-lifecycle state machine, and none of DATA-1A's tables added one. "Verify
the principal exists and is active" is therefore currently equivalent to "exists"
— a real, disclosed gap, not silently patched by adding a column to `gk_principal`
(that would be exactly the in-place alteration this dispatch's own constraint
forbids). A missing or unknown `principalId` throws `AuthorizationFailed` before
any other statement runs (S3-10) — zero writes, not even the idempotency-key
claim.

**Error taxonomy** (`errors.js`, all extend a common `AssetServiceError` base with
a stable `.code`):
- `NotFoundError` — `gkAssetId` (or a referenced sub-record) doesn't exist.
- `ConflictError` — a state precondition failed (e.g. `correctIdentity` against an
  asset with no live assignment to supersede).
- `IdempotentReplayError` — never actually thrown; named here for symmetry but the
  real behavior (Section on idempotency, above) is a SUCCESSFUL return of the
  original result, not an error. Kept in the taxonomy because a future HTTP layer
  may want to render a replay distinguishably (e.g. a `200` with a
  `X-Idempotent-Replay: true` header) without the service itself deciding that's
  an error condition.
- `ValidationFailedError` — a required field missing/malformed, or an enum value
  outside the CHECK-constraint vocabulary the schema already enforces (checked in
  the service BEFORE the query, so the caller gets a typed error instead of a raw
  Postgres CHECK-violation).
- `AuthorizationFailedError` — `principalId` missing or doesn't resolve to a real
  `gk_principal` row.

## 4. Connection management — evidence-chosen

**Driver: `pg` (node-postgres), not `@neondatabase/serverless`, for this
dispatch.** Reasoning, not a default:
- Every mutating operation requires a real, interactive, multi-statement
  transaction where a later statement's shape depends on an EARLIER statement's
  result within the same transaction (`createPhysicalAsset`'s conditional
  INSERT-then-maybe-SELECT-existing is the clearest case, reused verbatim from
  `lib.mjs`). `pg.Client`'s session-based `BEGIN`/query/query/`COMMIT` model
  expresses this directly. Neon's plain HTTP tagged-template mode (`neon(...)`)
  batches a fixed array of pre-built queries per `sql.transaction()` call and
  cannot branch mid-transaction on an intermediate result — a real mismatch for
  this service's actual write shape, not a stylistic preference.
- DATA-1A's own proof scripts (`C:\grailkey-data\data-1\lib.mjs`) already validated
  `pg` against this exact database, with real transactions, real rollback-on-error
  behavior. Reusing a proven driver over introducing a second one for the same
  database is the lower-risk choice.
- This module is not yet called from any `api/*.js` file (explicit constraint,
  this dispatch) — so Vercel serverless cold-start/connection-count concerns that
  motivate Neon's HTTP driver in an edge/serverless context don't yet apply. When a
  future dispatch (DATA-1D or later) wires this service into a Vercel Function,
  THAT is the point to re-evaluate: either Neon's WebSocket-mode `Pool`/`Client`
  (API-compatible with `pg` for this exact transactional shape, but transport-
  appropriate for the function runtime) or `pg` over the pooled connection string
  with a small `max` on the pool, sized for Fluid Compute's instance-reuse model
  (this project already runs Node.js runtime everywhere, not Edge — see
  `vercel:knowledge-update`'s "Fluid Compute reuses function instances" note — so
  a persistent `pg.Pool` surviving across warm invocations is a real option, not
  the antipattern it would be under one-request-per-instance serverless).

**Connection string: `GRAILKEY_CATALOG_DATABASE_URL`** (the pooled variant, via
Neon's own PgBouncer) — the same env var `lib.mjs` already used, not the `
_UNPOOLED`/`_NON_POOLING` sibling. `db.js` reads it directly from
`process.env` and throws a clear `ValidationFailedError`-shaped startup error if
unset; it does **not** read `.env.development.local` itself (that file-reading
convention is a LOCAL-SCRIPT concern, matching `scripts/query-scanlog.mjs`'s own
documented pattern — "this repo has no dotenv dependency" — pushed to the callers
that need it, not baked into the service so that a real Vercel deployment's
env-injected `process.env` works unmodified). Local proof scripts under
`C:\grailkey-data\data-1\` load the env file themselves before importing the
service, exactly as `lib.mjs` already does.

**Pooling:** a single lazily-created `pg.Pool` (not a bare `Client`) with a small
`max` (default 5) — module-scoped singleton in `db.js`, created on first use, never
recreated per call. A `Pool` (vs. `lib.mjs`'s bare per-script `Client`) is the
right choice for a long-lived module that may serve many operations across a
process lifetime, vs. a short proof script that opens one connection and exits.

## 5. Open item, named not solved

`getPhysicalAsset`'s eight sequential `SELECT`s (asset, identity, media, current
owner, ownership history, acquisitions, valuations, decisions) are not wrapped in
a shared transaction/snapshot in this v1 — under real concurrent writes, a caller
could theoretically observe a graph that's each individually consistent but not
a single point-in-time snapshot (e.g. a valuation committed between the
`current_owner` read and the `valuations` read). Not fixed here: this is a genuine
consistency-vs-simplicity tradeoff (a `REPEATABLE READ` transaction wrapping all
eight reads is a small, contained future change, not attempted this dispatch since
no proof case in Section 6/S3 exercises concurrent writes during a read) — flagged
so a future dispatch doesn't have to rediscover it.

## 6. Schema: no changes to 0001–0004, one new additive file

Per this dispatch's own constraint ("no schema changes expected; if one proves
necessary, it is a NEW draft migration reported for ruling, never an inline
alteration") — idempotency-key support (Section 3) has no equivalent in
`0001`–`0004`. `db/data0/0005_data1b_idempotency.sql` adds exactly one new table,
touches nothing else:

```sql
CREATE TABLE idempotency_key (
  id                UUID PRIMARY KEY,
  operation         TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  principal_id      UUID NOT NULL REFERENCES gk_principal(id),
  result_snapshot   JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation, idempotency_key)
);
```

Same shape as `entity_mint_basis`'s own idempotency gate (a UNIQUE constraint is
the mechanism, not an application-level check-then-insert race), generalized from
"one operation (mint)" to "any operation this service names." Reported here for
ruling, applied to `data1_dev` as part of Task 2 (additive only — zero lines
touched in any of `0001`–`0004`, zero existing tables altered). If this table's
shape is rejected on review, every service function's idempotency check is
isolated to `idempotency.js` and can be swapped for a different mechanism without
touching `service.js`'s transaction logic.

**Verified against the LIVE schema, not the 0004 draft file** (the two differ —
DATA-1A's own "bounded slice" applied 13 of the design draft's 17 tables):
`gk_organization`, `gk_membership`, `custody_event`, `condition_observation` exist
in `0004`'s draft SQL but were never applied to `data1_dev` — this service does not
reference any of them (none are needed by the Section 2 contract). Also verified:
`asset_identity_assignment.catalog_entity_id` is a bare, FK-less `UUID` in the live
schema (`catalog_entity` doesn't exist in this database at all) — the service
treats it as an opaque nullable UUID, never assumes a foreign-key relationship the
live schema doesn't actually have.
