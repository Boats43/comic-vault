// src/modules/assets/repository.js — PRIVATE. Every SQL statement in this
// module lives here and nowhere else. Never imported outside
// src/modules/assets/ — enforced by tests/assets-module-boundary.test.js
// (S3-11, DATA-1B). service.js is the ONLY file permitted to import this
// one.
//
// Every function here takes an already-open `client` (mid-transaction,
// or a bare connection for a read-only call) — this file never opens a
// connection, never manages BEGIN/COMMIT/ROLLBACK. That boundary stays
// entirely in service.js, which is what makes "one mutation, one
// transaction" (docs/adr/DATA-1B-ASSET-SERVICE-DESIGN.md, Section 3)
// checkable by reading one file.
//
// GK-178 (2026-09-03) — every table reference below is schema-qualified
// (`data1_dev.<table>`), never bare. `db.js`'s pooled connection string
// resolves to a Neon PgBouncer transaction-pooling endpoint, which does
// not guarantee that a `SET search_path` issued at connection-acquire
// time survives to any later statement on the "same" client (proven:
// real pg_backend_pid() drift mid-operation, real 42P01 "relation does
// not exist" errors, real concurrent reproduction at N=3 — see
// docs/DATABASE-MIGRATION-STATUS.md, "GK-178 — resolved"). Schema
// qualification eliminates the session-state dependence entirely rather
// than pinning it to a transaction boundary — correct regardless of
// concurrency, pool warmth, or PgBouncer's own backend-assignment
// behavior. `uuidv7()` and `now()` are native `pg_catalog` functions,
// always resolvable regardless of search_path — never qualified.
//
// Column shapes here are verified against the LIVE data1_dev schema
// (queried directly, not assumed from the 0004 design draft, which
// includes 4 tables — gk_organization, gk_membership, custody_event,
// condition_observation — never actually applied). asset_identity_
// assignment.catalog_entity_id is a bare, FK-less UUID in this live
// schema (catalog_entity doesn't exist here at all) — treated as an
// opaque nullable value throughout, never assumed to be a real foreign
// key.
//
// D3.2 (db/data0/0011_d3_2_event_time.sql, APPLIED to data1_dev
// 2026-09-02, verified 78/78 post-migration checks) — ownership_event,
// acquisition_event, valuation_event, decision_event, domain_event,
// media, asset_identity_assignment each now carry recorded_at (the
// renamed historical column — DEFAULT now(), unchanged behavior) AND a
// new nullable occurred_at (no default). occurredAt is caller-supplied
// only; every writer below passes it through as `occurredAt ?? null` —
// never substitutes "now" or infers it from recorded_at.

import { NotFoundError } from './errors.js';

const uuidv7 = async (client) => (await client.query('SELECT uuidv7() as id')).rows[0].id;

export async function assertPrincipalExists(client, principalId) {
  const res = await client.query('SELECT id FROM data1_dev.gk_principal WHERE id = $1', [principalId]);
  return res.rows.length > 0;
}

// Reused verbatim from C:\grailkey-data\data-1\lib.mjs's mintAsset —
// implements 0003's own mint-basis transactional contract (C2-v2):
// UNIQUE (basis_namespace, basis_key) is the sole idempotency gate. Same
// basis, concurrent or repeated, always resolves to exactly one entity.
export async function mintAsset(client, { basisNamespace, basisKey, basisSchemaVersion, mintPolicyVersion, contractVersion, candidateSnapshot }) {
  const candidateId = await uuidv7(client);

  const basisInsert = await client.query(
    `INSERT INTO data1_dev.entity_mint_basis (id, entity_id, basis_namespace, basis_key, basis_schema_version, mint_policy_version)
     VALUES (uuidv7(), $1, $2, $3, $4, $5)
     ON CONFLICT (basis_namespace, basis_key) DO NOTHING
     RETURNING id, entity_id`,
    [candidateId, basisNamespace, basisKey, basisSchemaVersion, mintPolicyVersion]
  );

  let outcome, assetId, basisId;
  if (basisInsert.rows.length > 0) {
    basisId = basisInsert.rows[0].id;
    assetId = candidateId;
    await client.query(`INSERT INTO data1_dev.gk_asset (id, mint_basis_id) VALUES ($1, $2)`, [assetId, basisId]);
    outcome = 'minted-new';
  } else {
    const existing = await client.query(
      `SELECT id, entity_id FROM data1_dev.entity_mint_basis WHERE basis_namespace = $1 AND basis_key = $2`,
      [basisNamespace, basisKey]
    );
    basisId = existing.rows[0].id;
    assetId = existing.rows[0].entity_id;
    outcome = 'resolved-existing';
  }

  await client.query(
    `INSERT INTO data1_dev.mint_event (id, contract_version, candidate_snapshot, mint_basis_id, outcome, entity_id)
     VALUES (uuidv7(), $1, $2, $3, $4, $5)`,
    [contractVersion, JSON.stringify(candidateSnapshot), basisId, outcome, assetId]
  );

  return { assetId, basisId, outcome };
}

export async function getAssetById(client, assetId) {
  const res = await client.query('SELECT * FROM data1_dev.gk_asset WHERE id = $1', [assetId]);
  return res.rows[0] || null;
}

// DATA-1D, T2 — the authorization chain's one real query: who currently
// owns this asset. current_owner is the materialized, rebuild-on-write
// projection of ownership_event (0004) — never an independent write
// path, so this is always reading the SAME truth transferOwnership
// itself writes.
export async function getAssetOwner(client, assetId) {
  const res = await client.query('SELECT owner_principal_id FROM data1_dev.current_owner WHERE asset_id = $1', [assetId]);
  return res.rows[0]?.owner_principal_id || null;
}

// DATA-1D, T3 — cross-device retrieval's "what's mine" entry point.
// Scoped to the principal by construction (WHERE clause, not a filter
// applied after a broader read) — there is no unauthorized branch here
// to guard against.
export async function listAssetsByOwner(client, principalId) {
  const res = await client.query(
    `SELECT ga.* FROM data1_dev.gk_asset ga
     JOIN data1_dev.current_owner co ON co.asset_id = ga.id
     WHERE co.owner_principal_id = $1
     ORDER BY ga.created_at`,
    [principalId]
  );
  return res.rows;
}

// DATA-1D, T3 — one media row by id, asset_id included so the service
// layer can authorize against the OWNING asset (never the media row's
// own recorded_by_principal_id, which is provenance, not authorization).
export async function getMediaById(client, mediaId) {
  const res = await client.query('SELECT * FROM data1_dev.media WHERE id = $1', [mediaId]);
  return res.rows[0] || null;
}

export async function insertOwnershipEvent(client, { assetId, ownerPrincipalId, reason, recordedByPrincipalId, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.ownership_event (id, asset_id, owner_principal_id, reason, recorded_by_principal_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, assetId, ownerPrincipalId, reason, recordedByPrincipalId, occurredAt ?? null]
  );
  // Materialized "who owns this right now" — a cache of ownership_event's
  // own append-only history, rebuilt in the same transaction (never a
  // separately-triggered async job, per DATA-1A's own bounded slice).
  await client.query(
    `INSERT INTO data1_dev.current_owner (asset_id, owner_principal_id, as_of_ownership_event_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (asset_id) DO UPDATE SET owner_principal_id = EXCLUDED.owner_principal_id, as_of_ownership_event_id = EXCLUDED.as_of_ownership_event_id, updated_at = now()`,
    [assetId, ownerPrincipalId, id]
  );
  return id;
}

// Append-only + supersede: the asset's prior LIVE assignment (superseded_by
// IS NULL), if one exists, has its superseded_by set to the new row's id.
// The prior row is never edited otherwise, never deleted (Ruling 19).
export async function insertIdentityAssignment(client, { assetId, catalogEntityId, authority, source, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.asset_identity_assignment (id, asset_id, catalog_entity_id, authority, source, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, assetId, catalogEntityId ?? null, authority, source, occurredAt ?? null]
  );
  await client.query(
    `UPDATE data1_dev.asset_identity_assignment
     SET superseded_by = $1
     WHERE asset_id = $2 AND id != $1 AND superseded_by IS NULL`,
    [id, assetId]
  );
  return id;
}

export async function getLiveIdentityAssignment(client, assetId) {
  const res = await client.query(
    `SELECT * FROM data1_dev.asset_identity_assignment WHERE asset_id = $1 AND superseded_by IS NULL`,
    [assetId]
  );
  return res.rows[0] || null;
}

export async function insertMedia(client, { assetId, mediaType, contentHash, objectUri, contentType, recordedByPrincipalId, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.media (id, asset_id, media_type, content_hash, object_uri, content_type, recorded_by_principal_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, assetId, mediaType, contentHash, objectUri ?? null, contentType ?? null, recordedByPrincipalId, occurredAt ?? null]
  );
  return id;
}

// REMOVED (DATA-1C review, D3): this dispatch originally shipped
// findMediaByAssetRoleHash as an automatic evidence-row dedupe keyed on
// (asset, role, content_hash) alone. That was wrong — SHA256 dedupes the
// STORED OBJECT (src/modules/media/'s content addressing), never the
// EVIDENCE of a capture event. Two distinct attachMedia calls for the
// identical (asset, role, bytes) are two legitimate, separate evidence
// rows (e.g. two grading sessions that happen to photograph the
// identical page) — collapsing them automatically would have discarded
// real evidence. Row-level collapsing now happens ONLY for a genuine
// idempotencyKey replay (service.js's own requestFingerprint check),
// never as a side effect of matching content. See docs/adr/
// DATA-1C-MEDIA-DESIGN.md, Task 3 (D3), for the full correction.

export async function insertAcquisitionEvent(client, { assetId, costAmount, costCurrency, source, lotReference, recordedByPrincipalId, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.acquisition_event (id, asset_id, cost_amount, cost_currency, source, lot_reference, recorded_by_principal_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, assetId, costAmount, costCurrency, source, lotReference ?? null, recordedByPrincipalId, occurredAt ?? null]
  );
  return id;
}

// D3.3 Phase B -- insertCompSnapshot. comp_snapshot_immutable() (the
// live trigger, 0012) makes this table impossible to UPDATE/DELETE at
// the DB level -- this function only ever INSERTs, never anything else.
export async function insertCompSnapshot(client, { assetId, source, payload, contentHash, recordedByPrincipalId }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.comp_snapshot (id, asset_id, source, payload, content_hash, recorded_by_principal_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, assetId, source, JSON.stringify(payload), contentHash, recordedByPrincipalId]
  );
  return id;
}

// D3.3 Phase B -- compSnapshotId is the NEW, durable, FK-enforced
// reference (valuation_event.comp_snapshot_id -> comp_snapshot.id,
// 0012). compSnapshotRef (the pre-existing free-text column) is
// completely untouched by this change -- still accepted, still written
// exactly as before, never reinterpreted, never repurposed, never used
// to infer compSnapshotId. Both columns are independent and optional.
export async function insertValuationEvent(client, { assetId, valueAmount, valueCurrency, method, compSnapshotRef, compSnapshotId, gradeAssumption, buildSha, recordedByPrincipalId, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.valuation_event (id, asset_id, value_amount, value_currency, method, comp_snapshot_ref, comp_snapshot_id, grade_assumption, build_sha, recorded_by_principal_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, assetId, valueAmount, valueCurrency, method, compSnapshotRef ?? null, compSnapshotId ?? null, gradeAssumption ?? null, buildSha, recordedByPrincipalId, occurredAt ?? null]
  );
  return id;
}

export async function insertDecisionEvent(client, { assetId, recommendation, reasonCodes, valuationEventId, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.decision_event (id, asset_id, recommendation, reason_codes, valuation_event_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, assetId, recommendation, JSON.stringify(reasonCodes ?? []), valuationEventId ?? null, occurredAt ?? null]
  );
  return id;
}

// CAPTURE-INT (db/data0/0007_capture_integration_linkage.sql) — a routing
// lookup only ("which asset does a re-scan of this collection row attach
// to"), never a claim about physical identity. collectionItemId !=
// gkAssetId, per GK-145's own law, formalized here into a durable table.
export async function insertCollectionItemLink(client, { collectionItemId, gkAssetId, principalId }) {
  await client.query(
    `INSERT INTO data1_dev.collection_item_link (collection_item_id, gk_asset_id, linked_by_principal_id)
     VALUES ($1, $2, $3)`,
    [collectionItemId, gkAssetId, principalId]
  );
}

export async function getCollectionItemLink(client, { collectionItemId }) {
  const res = await client.query(
    `SELECT collection_item_id, gk_asset_id FROM data1_dev.collection_item_link WHERE collection_item_id = $1`,
    [collectionItemId]
  );
  return res.rows[0] || null;
}

// Ruling 21's ratified envelope — event_id, event_type, occurred_at,
// actor, subject, payload, correlation_id, schema_version. No
// causation_id: that field is not part of the ratified envelope or the
// live domain_event table (see the design doc's Section 0 preflight
// note) — not silently added here.
export async function writeDomainEvent(client, { eventType, actorPrincipalId, actorKind = 'user', subjectType, subjectId, payload, correlationId, occurredAt }) {
  const eventId = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.domain_event (event_id, event_type, actor, subject, payload, correlation_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      eventId,
      eventType,
      JSON.stringify({ principal_id: actorPrincipalId, kind: actorKind }),
      JSON.stringify({ entity_type: subjectType, entity_id: subjectId }),
      JSON.stringify(payload),
      correlationId,
      occurredAt ?? null,
    ]
  );
  const outboxId = await uuidv7(client);
  await client.query(`INSERT INTO data1_dev.outbox (id, domain_event_id) VALUES ($1, $2)`, [outboxId, eventId]);
  return eventId;
}

// getPhysicalAsset's full graph — one call, several SELECTs. See the
// design doc, Section 5, for the one open consistency question this
// leaves (not wrapped in a shared snapshot transaction in v1).
//
// Sequential, not Promise.all: a single pg.Client/pooled connection
// serves ONE query at a time — pg 8.23 warns (and a future major version
// will remove) support for issuing concurrent .query() calls on the same
// client. Correctness never depended on the concurrency (these are
// independent reads either way); this removes reliance on
// soon-to-be-unsupported behavior rather than papering over the warning.
export async function getAssetGraph(client, assetId) {
  const asset = await getAssetById(client, assetId);
  if (!asset) throw new NotFoundError(`gk_asset ${assetId} does not exist`);

  // D3.2 -- ORDER BY recorded_at, not occurred_at: recorded_at is NEVER
  // NULL (DEFAULT now(), always populated), so it remains a total,
  // stable chronological order for display even when occurred_at is
  // UNKNOWN (NULL) for a given row. occurred_at is available on every
  // returned row for callers that want asserted-occurrence ordering
  // instead, but this function does not silently prefer one over the
  // other by re-deriving anything.
  const identity = await client.query(`SELECT * FROM data1_dev.asset_identity_assignment WHERE asset_id = $1 AND superseded_by IS NULL`, [assetId]);
  const media = await client.query(`SELECT * FROM data1_dev.media WHERE asset_id = $1 ORDER BY recorded_at`, [assetId]);
  const ownershipHistory = await client.query(`SELECT * FROM data1_dev.ownership_event WHERE asset_id = $1 ORDER BY recorded_at`, [assetId]);
  const currentOwner = await client.query(`SELECT * FROM data1_dev.current_owner WHERE asset_id = $1`, [assetId]);
  const acquisitions = await client.query(`SELECT * FROM data1_dev.acquisition_event WHERE asset_id = $1 ORDER BY recorded_at`, [assetId]);
  const valuations = await client.query(`SELECT * FROM data1_dev.valuation_event WHERE asset_id = $1 ORDER BY recorded_at`, [assetId]);
  const decisions = await client.query(`SELECT * FROM data1_dev.decision_event WHERE asset_id = $1 ORDER BY recorded_at`, [assetId]);

  return {
    asset,
    currentIdentityAssignment: identity.rows[0] || null,
    media: media.rows,
    ownershipHistory: ownershipHistory.rows,
    currentOwner: currentOwner.rows[0] || null,
    acquisitions: acquisitions.rows,
    valuations: valuations.rows,
    decisions: decisions.rows,
  };
}

// ─────────────────────────────────────────────────────────────────────
// D4 Phase B -- Identifier Fabric (docs/adr/ADR-IDENTIFIER-001-
// identifier-fabric.md). Four tables, migration 0013. Vertical-neutral:
// no scheme-specific (comic/UPC/ISBN/cert-number) branching anywhere in
// this file -- scheme/issuingAuthority/normalizedValue are opaque
// caller-supplied strings throughout.
// ─────────────────────────────────────────────────────────────────────

// insertOrResolveAssetIdentifier -- mirrors mintAsset's own resolve-or-
// create pattern exactly (ON CONFLICT DO NOTHING + fallback SELECT):
// UNIQUE(scheme, issuing_authority, normalized_value) is the sole
// idempotency gate (Ruling 12). Same canonical identifier, repeated,
// always resolves to exactly one row -- never a second definition for
// the same real-world identifier. asset_identifier_immutable() (the live
// trigger) makes this table impossible to UPDATE/DELETE at the DB level
// regardless -- this function never attempts either.
export async function insertOrResolveAssetIdentifier(client, { scheme, issuingAuthority, normalizedValue, scope }) {
  const candidateId = await uuidv7(client);
  const insert = await client.query(
    `INSERT INTO data1_dev.asset_identifier (id, scheme, issuing_authority, normalized_value, scope)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (scheme, issuing_authority, normalized_value) DO NOTHING
     RETURNING id`,
    [candidateId, scheme, issuingAuthority, normalizedValue, scope]
  );
  if (insert.rows.length > 0) {
    return { identifierId: insert.rows[0].id, outcome: 'minted-new' };
  }
  const existing = await client.query(
    `SELECT id FROM data1_dev.asset_identifier WHERE scheme = $1 AND issuing_authority = $2 AND normalized_value = $3`,
    [scheme, issuingAuthority, normalizedValue]
  );
  return { identifierId: existing.rows[0].id, outcome: 'resolved-existing' };
}

// insertRawObservation -- asset_raw_observation_immutable() (live
// trigger) rejects UPDATE/DELETE unconditionally; this function only
// ever INSERTs. No identifier_id column exists on this table at all
// (Ruling 15) -- a malformed/unresolved raw value is fully legal here.
export async function insertRawObservation(client, { assetId, observedRawValue, source, recordedByPrincipalId, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.asset_raw_observation (id, asset_id, observed_raw_value, source, recorded_by_principal_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, assetId, observedRawValue, source, recordedByPrincipalId, occurredAt ?? null]
  );
  return id;
}

// insertIdentifierAssertion -- identifier_id is NOT NULL, DB-enforced
// (Ruling 15). Evidence fields become immutable the moment
// asset_identifier_assertion_guard() sees this row for the first time
// via an UPDATE attempt -- this function's own INSERT is the one and
// only time these fields are ever written.
export async function insertIdentifierAssertion(client, { identifierId, assetId, source, recordedByPrincipalId, resolutionAuthority, occurredAt }) {
  const id = await uuidv7(client);
  await client.query(
    `INSERT INTO data1_dev.asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, identifierId, assetId, source, recordedByPrincipalId, resolutionAuthority, occurredAt ?? null]
  );
  return id;
}

// insertAssertionEvidence -- assetId is caller-supplied (the SAME
// gkAssetId the calling service function already authorized via
// assertAssetExists/assertPrincipalOwnsAsset), never independently
// derived from assertionId or observationId. The database itself is the
// actual enforcement mechanism (Ruling 21's composite FKs): if assetId
// does not genuinely match both the assertion's and the observation's
// own asset_id, this INSERT is rejected by Postgres, not by application
// logic -- this function does not re-check that here, by design.
// Duplicate (assertionId, observationId) links are rejected by the
// table's own PRIMARY KEY, not application logic either.
export async function insertAssertionEvidence(client, { assertionId, observationId, assetId }) {
  await client.query(
    `INSERT INTO data1_dev.asset_identifier_assertion_evidence (assertion_id, observation_id, asset_id)
     VALUES ($1, $2, $3)`,
    [assertionId, observationId, assetId]
  );
}

// supersedeIdentifierAssertion -- the ONE permitted lifecycle mutation
// on asset_identifier_assertion (Ruling 17). asset_identifier_assertion_
// guard() (the live trigger) is the actual enforcement: rejects DELETE
// unconditionally, rejects mutating any field but superseded_by, rejects
// re-superseding an already-superseded row, and rejects targeting a
// non-live (already-superseded) or cross-asset target via the
// concurrency-safe FOR UPDATE lock (Ruling 19) and the composite
// same-asset FK (Ruling 21) respectively. This function performs
// exactly the one UPDATE the trigger permits -- it implements none of
// that enforcement itself.
export async function supersedeIdentifierAssertion(client, { oldAssertionId, newAssertionId }) {
  await client.query(
    `UPDATE data1_dev.asset_identifier_assertion SET superseded_by = $1 WHERE id = $2`,
    [newAssertionId, oldAssertionId]
  );
}

// Read helpers -- no transaction required by the caller for these.
export async function getIdentifierAssertion(client, assertionId) {
  const r = await client.query(`SELECT * FROM data1_dev.asset_identifier_assertion WHERE id = $1`, [assertionId]);
  return r.rows[0] || null;
}

export async function getRawObservation(client, observationId) {
  const r = await client.query(`SELECT * FROM data1_dev.asset_raw_observation WHERE id = $1`, [observationId]);
  return r.rows[0] || null;
}

export async function listLiveIdentifierAssertions(client, assetId) {
  const r = await client.query(
    `SELECT * FROM data1_dev.asset_identifier_assertion WHERE asset_id = $1 AND superseded_by IS NULL ORDER BY recorded_at`,
    [assetId]
  );
  return r.rows;
}
