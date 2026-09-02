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
