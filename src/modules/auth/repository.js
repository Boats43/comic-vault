// src/modules/auth/repository.js — PRIVATE. Every SQL statement in this
// module lives here and nowhere else — enforced by
// tests/auth-module-boundary.test.js. Only service.js may import this
// file (mirrors the Asset Service's own S3-11 discipline).
//
// GK-178 (2026-09-03) — every table reference below is schema-qualified
// (data1_dev.<table>), never bare — same fix, same rationale, as
// src/modules/assets/repository.js's own header (pooled-connection
// session-state hazard; db.js's SET search_path does not reliably
// survive to later statements against a Neon PgBouncer transaction-
// pooling endpoint).

export async function getOperatorPrincipal(client) {
  // Single-operator era: exactly one 'operator'-kind principal is
  // expected to exist (seeded by DATA-1A's seed-principal.mjs). Ordered
  // + LIMIT 1 rather than asserting exactly-one, so this doesn't throw
  // if a future dispatch seeds a second one before this module is
  // updated to handle it — a real, disclosed simplification for the
  // single-operator era, not a silent assumption.
  const res = await client.query(
    "SELECT id, display_name FROM data1_dev.gk_principal WHERE kind = 'operator' ORDER BY created_at ASC LIMIT 1"
  );
  return res.rows[0] || null;
}

export async function getCredential(client, principalId) {
  const res = await client.query(
    'SELECT credential_hash, credential_salt FROM data1_dev.principal_credential WHERE principal_id = $1',
    [principalId]
  );
  return res.rows[0] || null;
}

// Used only by the local seed script (C:\grailkey-data\data-1\
// set-operator-credential.mjs) — never called from any public endpoint.
// Registration (self-serve credential creation) is explicitly not built.
export async function upsertCredential(client, { principalId, hash, salt }) {
  await client.query(
    `INSERT INTO data1_dev.principal_credential (principal_id, credential_hash, credential_salt)
     VALUES ($1, $2, $3)
     ON CONFLICT (principal_id) DO UPDATE SET
       credential_hash = EXCLUDED.credential_hash,
       credential_salt = EXCLUDED.credential_salt,
       created_at = now()`,
    [principalId, hash, salt]
  );
}

// BETA-1A — resolves a verified external-identity-provider subject (e.g.
// Clerk's own user ID) to the ONE gk_principal it was explicitly mapped
// to. Returns null on no match — the caller (service.js) turns that into
// the SAME NotProvisionedError the passphrase path already uses for an
// unrecognized credential; there is no fallback to any other principal.
// db/data0/0022_beta1a_clerk_identity_mapping.sql (PROPOSED, not yet
// applied to data1_dev) is the table this reads.
export async function getPrincipalByExternalIdentity(client, { provider, externalSubject }) {
  const res = await client.query(
    `SELECT p.id, p.display_name
     FROM data1_dev.principal_external_identity pei
     JOIN data1_dev.gk_principal p ON p.id = pei.principal_id
     WHERE pei.provider = $1 AND pei.external_subject = $2`,
    [provider, externalSubject]
  );
  return res.rows[0] || null;
}

// Used only by the local seed script that provisions a Clerk mapping for
// the existing operator principal — same pattern/precedent as
// upsertCredential above, never called from any public endpoint.
export async function upsertExternalIdentity(client, { id, principalId, provider, externalSubject }) {
  await client.query(
    `INSERT INTO data1_dev.principal_external_identity (id, principal_id, provider, external_subject)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, external_subject) DO UPDATE SET
       principal_id = EXCLUDED.principal_id`,
    [id, principalId, provider, externalSubject]
  );
}
