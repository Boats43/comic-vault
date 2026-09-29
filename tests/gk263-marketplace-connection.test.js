// tests/gk263-marketplace-connection.test.js
//
// GK-263 Phase 1 — the minimum durable, principal-owned marketplace-
// connection foundation (src/modules/marketplace/). Proves: round-trip
// encryption, principal isolation, one-active-connection-per-principal,
// provider-identity collision fail-closed, disconnect makes a credential
// unusable, RECONNECT_REQUIRED refuses resolution, a missing/malformed
// encryption key fails closed, and no secret material is ever logged.
//
// Real Development Postgres (transient rows, all cleaned up). Synthetic
// encryption keys and fake credentials ONLY — no real eBay account, no
// real refresh token, no real eBay call anywhere in this file.
//
// Invoke: node tests/gk263-marketplace-connection.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const TEST_KEY = randomBytes(32).toString('base64url'); // synthetic, test-only
process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = TEST_KEY;

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

const {
  upsertMarketplaceConnection, getMarketplaceConnection, resolveMarketplaceRefreshCredential,
  markMarketplaceReconnectRequired, disconnectMarketplaceConnection,
  ConflictError, ValidationFailedError, ProviderIdentityConflictError, closePool,
} = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';

const dbClient = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await dbClient.connect();

async function getRawRow(principalId, provider = 'EBAY') {
  const r = await dbClient.query(
    `SELECT * FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = $2`,
    [principalId, provider]
  );
  return r.rows[0] || null;
}

// A fresh, real, transient second gk_principal — the same convention
// tests/gk262-public-surface-blockers.test.js already uses for a real
// cross-principal proof, not a forged/nonexistent id.
const idRes = await dbClient.query('SELECT uuidv7() as id');
const PRINCIPAL_B = idRes.rows[0].id;
await dbClient.query(
  `INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`,
  [PRINCIPAL_B, 'gk263-test-principal-b']
);

console.log('\n=== GK-263 PART A: round trip ===\n');
try {
  const conn = await upsertMarketplaceConnection({
    principalId: JIMMY, provider: 'EBAY', providerUserId: 'gk263-ebay-user-A',
    refreshCredential: 'fake-refresh-credential-AAA', grantedScopes: ['sell.fulfillment.readonly'],
  });
  assertTrue(conn.connectionStatus === 'CONNECTED', 'A1: upsert returns CONNECTED metadata');
  assertTrue(conn.encryptedRefreshCredential === undefined, 'A2: returned metadata carries no credential field at all');

  const raw = await getRawRow(JIMMY);
  assertTrue(!!raw && raw.encrypted_refresh_credential, 'A3: a real durable row with a real ciphertext now exists');
  assertTrue(!String(raw.encrypted_refresh_credential).includes('fake-refresh-credential-AAA'), 'A4: plaintext credential is NOT present anywhere in the durable ciphertext column');

  const resolved = await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(resolved.refreshCredential === 'fake-refresh-credential-AAA', 'A5: the owning principal can decrypt back the exact original plaintext');

  const meta = await getMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(meta.providerUserId === 'gk263-ebay-user-A' && meta.connectionStatus === 'CONNECTED', 'A6: getMarketplaceConnection metadata matches');
  assertTrue(!('encryptedRefreshCredential' in meta) && !('credentialKeyVersion' in meta), 'A7: getMarketplaceConnection metadata object has no credential-shaped keys at all');
} catch (e) {
  assertTrue(false, `A: unexpected error — ${e.message}`);
}

console.log('\n=== GK-263 PART B: principal isolation ===\n');
{
  const bMeta = await getMarketplaceConnection({ principalId: PRINCIPAL_B, provider: 'EBAY' });
  assertTrue(bMeta === null, 'B1: Principal B sees no connection at all (never Principal A\'s row)');

  let threw = null;
  try { await resolveMarketplaceRefreshCredential({ principalId: PRINCIPAL_B, provider: 'EBAY' }); } catch (e) { threw = e; }
  assertTrue(threw instanceof Error && threw.code === 'NOT_FOUND', 'B2: Principal B cannot resolve any credential — NotFoundError, never Principal A\'s credential');
}

console.log('\n=== GK-263 PART C: unique connection / reconnect updates in place ===\n');
{
  const before = await getRawRow(JIMMY);
  const conn = await upsertMarketplaceConnection({
    principalId: JIMMY, provider: 'EBAY', providerUserId: 'gk263-ebay-user-A2',
    refreshCredential: 'fake-refresh-credential-BBB', grantedScopes: ['sell.fulfillment.readonly', 'sell.finances'],
  });
  assertTrue(conn.id === before.id, 'C1: reconnecting the SAME principal+provider updates the SAME row (same id), never inserts a second one');
  assertTrue(conn.providerUserId === 'gk263-ebay-user-A2', 'C2: providerUserId updated to the new value');

  const count = await dbClient.query(`SELECT COUNT(*)::int AS n FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = 'EBAY'`, [JIMMY]);
  assertTrue(count.rows[0].n === 1, 'C3: exactly one row exists for this principal+provider, not two');

  const resolved = await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(resolved.refreshCredential === 'fake-refresh-credential-BBB', 'C4: the NEW credential resolves correctly (old one is gone, not merely shadowed)');
}

console.log('\n=== GK-263 PART D: provider-identity collision ===\n');
{
  let threw = null;
  try {
    await upsertMarketplaceConnection({
      principalId: PRINCIPAL_B, provider: 'EBAY', providerUserId: 'gk263-ebay-user-A2', // JIMMY's CURRENT active identity
      refreshCredential: 'fake-refresh-credential-STOLEN',
    });
  } catch (e) { threw = e; }
  assertTrue(threw instanceof ProviderIdentityConflictError, 'D1: Principal B connecting JIMMY\'s already-active eBay account is refused with a specific conflict error');

  const bRow = await getRawRow(PRINCIPAL_B);
  assertTrue(bRow === null, 'D2: no row was created for Principal B as a side effect of the rejected attempt');

  const jimmyResolved = await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(jimmyResolved.refreshCredential === 'fake-refresh-credential-BBB', 'D3: JIMMY\'s own connection/credential is completely unchanged by the rejected collision attempt');
}

console.log('\n=== GK-263 PART E: disconnect ===\n');
{
  const disc = await disconnectMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(disc.connectionStatus === 'DISCONNECTED', 'E1: disconnect transitions to DISCONNECTED');

  const raw = await getRawRow(JIMMY);
  assertTrue(raw.encrypted_refresh_credential === null && raw.credential_key_version === null, 'E2: the durable ciphertext is actually cleared, not merely marked unusable');

  let threw = null;
  try { await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' }); } catch (e) { threw = e; }
  assertTrue(threw instanceof ConflictError, 'E3: a disconnected connection cannot be resolved as usable');
}

console.log('\n=== GK-263 PART F: reconnect-required refuses resolution ===\n');
{
  await upsertMarketplaceConnection({
    principalId: JIMMY, provider: 'EBAY', providerUserId: 'gk263-ebay-user-A3',
    refreshCredential: 'fake-refresh-credential-CCC',
  });
  const marked = await markMarketplaceReconnectRequired({ principalId: JIMMY, provider: 'EBAY', reason: 'refresh token revoked (test)' });
  assertTrue(marked.connectionStatus === 'RECONNECT_REQUIRED' && marked.lastError === 'refresh token revoked (test)', 'F1: state transitions to RECONNECT_REQUIRED with the reason recorded');

  let threw = null;
  try { await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' }); } catch (e) { threw = e; }
  assertTrue(threw instanceof ConflictError, 'F2: RECONNECT_REQUIRED refuses credential resolution — never treated as usable');

  // Recover JIMMY to a clean CONNECTED state for the remaining scenarios.
  await upsertMarketplaceConnection({
    principalId: JIMMY, provider: 'EBAY', providerUserId: 'gk263-ebay-user-A4',
    refreshCredential: 'fake-refresh-credential-DDD',
  });
}

console.log('\n=== GK-263 PART G: bad encryption key fails closed ===\n');
{
  const savedKey = process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY;

  delete process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY;
  let threwMissing = null;
  try {
    await upsertMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY', providerUserId: 'gk263-ebay-user-A5', refreshCredential: 'fake-refresh-credential-EEE' });
  } catch (e) { threwMissing = e; }
  assertTrue(threwMissing !== null && /GRAILKEY_MARKETPLACE_CREDENTIAL_KEY/.test(threwMissing.message), 'G1: missing encryption key fails closed before any row is written');

  process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = 'too-short-not-32-bytes';
  let threwMalformed = null;
  try {
    await upsertMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY', providerUserId: 'gk263-ebay-user-A6', refreshCredential: 'fake-refresh-credential-FFF' });
  } catch (e) { threwMalformed = e; }
  assertTrue(threwMalformed !== null && /32 bytes/.test(threwMalformed.message), 'G2: malformed/wrong-length encryption key fails closed');

  process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = savedKey;
  const wrongKey = randomBytes(32).toString('base64url'); // a DIFFERENT, validly-shaped key
  process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = wrongKey;
  let threwWrongKey = null;
  try {
    await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' }); // encrypted under savedKey, now decrypting under wrongKey
  } catch (e) { threwWrongKey = e; }
  assertTrue(threwWrongKey !== null, 'G3: decrypting under the WRONG (but well-formed) key fails — authenticated encryption catches key substitution, never returns garbage plaintext');

  process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = savedKey;
  const recovered = await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(recovered.refreshCredential === 'fake-refresh-credential-DDD', 'G4: the SAME connection resolves correctly again once the correct key is restored');
}

console.log('\n=== GK-263 PART H: secret hygiene ===\n');
{
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const captured = [];
  const capture = (...args) => captured.push(args.map(String).join(' '));
  console.log = capture; console.error = capture; console.warn = capture;

  try {
    await upsertMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY', providerUserId: 'gk263-ebay-user-HYGIENE', refreshCredential: 'fake-SECRET-credential-HYGIENE-XYZ' });
    await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' });
    try { await upsertMarketplaceConnection({ principalId: PRINCIPAL_B, provider: 'EBAY', providerUserId: 'gk263-ebay-user-HYGIENE', refreshCredential: 'fake-SECRET-should-never-log' }); } catch { /* expected collision */ }
  } finally {
    console.log = originalLog; console.error = originalError; console.warn = originalWarn;
  }

  const allLogText = captured.join('\n');
  assertTrue(!allLogText.includes('fake-SECRET-credential-HYGIENE-XYZ'), 'H1: the plaintext credential never appears in any emitted log line');
  assertTrue(!allLogText.includes('fake-SECRET-should-never-log'), 'H2: a plaintext credential from a REJECTED (collision) attempt never appears in any emitted log line either');
  assertTrue(!allLogText.includes(TEST_KEY), 'H3: the encryption key itself never appears in any emitted log line');
}

console.log('\n=== GK-263 PART I: provider-identity invariants across disconnect ===\n');
{
  // A fresh, dedicated provider_user_id — never reused by any earlier
  // part of this file — so no other scenario's state can leak in.
  const PROVIDER_USER_ID = 'gk263-ebay-user-INVARIANT-X';

  const connA = await upsertMarketplaceConnection({
    principalId: JIMMY, provider: 'EBAY', providerUserId: PROVIDER_USER_ID,
    refreshCredential: 'fake-refresh-credential-INVARIANT-1',
  });
  assertTrue(connA.connectionStatus === 'CONNECTED', 'I-setup: Principal A connects X');
  const rowIdAfterConnect = connA.id;

  const discA = await disconnectMarketplaceConnection({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(discA.connectionStatus === 'DISCONNECTED', 'I-setup: Principal A disconnects');

  // SCENARIO 1 — cross-principal reuse after disconnect. REQUIRED: fail
  // closed. A disconnect must not silently release provider identity X
  // for a DIFFERENT GrailKey principal to claim.
  let scenario1Threw = null;
  try {
    await upsertMarketplaceConnection({
      principalId: PRINCIPAL_B, provider: 'EBAY', providerUserId: PROVIDER_USER_ID,
      refreshCredential: 'fake-refresh-credential-INVARIANT-STOLEN',
    });
  } catch (e) { scenario1Threw = e; }
  assertTrue(scenario1Threw instanceof ProviderIdentityConflictError, 'SCENARIO 1: Principal B connecting a DISCONNECTED-but-previously-claimed provider identity X is refused with a specific conflict error');

  const bRowAfterScenario1 = await getRawRow(PRINCIPAL_B);
  assertTrue(bRowAfterScenario1 === null, 'SCENARIO 1: no row was created for Principal B as a side effect of the rejected attempt');

  const aRowAfterScenario1 = await getRawRow(JIMMY);
  assertTrue(aRowAfterScenario1.connection_status === 'DISCONNECTED' && aRowAfterScenario1.provider_user_id === PROVIDER_USER_ID, "SCENARIO 1: Principal A's own (disconnected) row is completely unchanged by the rejected attempt");

  // SCENARIO 2 — same-principal reconnect after disconnect. REQUIRED:
  // succeeds, reuses/reactivates the SAME durable row (never a second
  // row) — disconnect must not permanently lock a principal out of
  // their own account.
  const reconnA = await upsertMarketplaceConnection({
    principalId: JIMMY, provider: 'EBAY', providerUserId: PROVIDER_USER_ID,
    refreshCredential: 'fake-refresh-credential-INVARIANT-2',
  });
  assertTrue(reconnA.connectionStatus === 'CONNECTED', "SCENARIO 2: Principal A successfully reconnects their OWN previously-disconnected provider identity X");
  assertTrue(reconnA.id === rowIdAfterConnect, 'SCENARIO 2: reconnect reuses/reactivates the SAME durable row (same id), never creates a second row');

  const rowCountForA = await dbClient.query(
    `SELECT COUNT(*)::int AS n FROM data1_dev.marketplace_connection WHERE principal_id = $1 AND provider = 'EBAY'`,
    [JIMMY]
  );
  assertTrue(rowCountForA.rows[0].n === 1, 'SCENARIO 2 durable-row check: exactly one marketplace_connection row exists for Principal A + EBAY, not two');

  const resolvedAfterReconnect = await resolveMarketplaceRefreshCredential({ principalId: JIMMY, provider: 'EBAY' });
  assertTrue(resolvedAfterReconnect.refreshCredential === 'fake-refresh-credential-INVARIANT-2', 'SCENARIO 2: the reconnected credential resolves correctly');
}

// ── Cleanup — real transient rows only, nothing pre-existing touched. ──
await dbClient.query(`DELETE FROM data1_dev.marketplace_connection WHERE principal_id IN ($1, $2)`, [JIMMY, PRINCIPAL_B]);
await dbClient.query(`DELETE FROM data1_dev.gk_principal WHERE id = $1`, [PRINCIPAL_B]);
console.log('\n  (test cleanup) all transient marketplace_connection rows and Principal B deleted\n');

await dbClient.end();
await closePool();

console.log(`${'='.repeat(60)}`);
console.log(`GK-263 RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
