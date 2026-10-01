// tests/gk269-ebay-account-deletion.test.js
//
// GK-269 Lane B — eBay Marketplace Account Deletion/Closure Notification
// compliance (api/ebay-account-deletion.js). Real handler invocation, no
// real eBay network call (this endpoint never calls out to eBay at all —
// it only reads/writes GrailKey's own marketplace_connection table).
// Real transient gk_principal + marketplace_connection rows against real
// Development Postgres, created and cleaned up here — Jimmy's real
// principal/connection is never touched.
//
// Invoke: node tests/gk269-ebay-account-deletion.test.js

import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
if (!process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY) {
  process.env.GRAILKEY_MARKETPLACE_CREDENTIAL_KEY = randomBytes(32).toString('base64url');
}
process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN || `test-verification-token-${randomBytes(16).toString('hex')}`;
process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL || 'https://app.grailkey.com/api/ebay-account-deletion';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertEq = (actual, expected, label) => assertTrue(actual === expected, `${label} (expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)})`);

const TAG = `gk269-eadel-${Date.now()}`;
console.log(`\n=== GK-269 Lane B — eBay Account Deletion compliance (real Development DB, tag=${TAG}) ===\n`);

const { upsertMarketplaceConnection, getMarketplaceConnection, closePool: closeMarketplacePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'marketplace', 'index.js')).href);

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

function mockRes() {
  const cap = { status: null, body: null };
  const res = { status: (c) => ({ json: (d) => { cap.status = c; cap.body = d; return { statusCode: c, body: d }; } }) };
  return { res, cap };
}

const createdPrincipalIds = [];

try {
  // ─────────────────────────────────────────────────────────────────
  // GET challenge-response
  // ─────────────────────────────────────────────────────────────────
  console.log('--- GET challenge-response ---');
  const handlerMod = await import(pathToFileURL(path.join(repoRoot, 'api', 'ebay-account-deletion.js')).href);
  const handler = handlerMod.default;

  {
    const challengeCode = `challenge-${randomUUID()}`;
    const expected = createHash('sha256')
      .update(challengeCode + process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN + process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL)
      .digest('hex');
    const { res, cap } = mockRes();
    await handler({ method: 'GET', query: { challenge_code: challengeCode } }, res);
    assertEq(cap.status, 200, 'GET with a valid challenge_code returns 200');
    assertEq(cap.body?.challengeResponse, expected, 'challengeResponse matches the independently-computed SHA-256(challengeCode+token+endpointURL)');
  }

  {
    const { res, cap } = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    assertEq(cap.status, 400, 'GET with no challenge_code is rejected (400)');
  }

  {
    const saved = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;
    delete process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;
    const { res, cap } = mockRes();
    await handler({ method: 'GET', query: { challenge_code: 'abc' } }, res);
    assertEq(cap.status, 500, 'GET fails closed (500) when EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN is unset — never computes a response with a missing token');
    process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN = saved;
  }

  {
    const saved = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL;
    delete process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL;
    const { res, cap } = mockRes();
    await handler({ method: 'GET', query: { challenge_code: 'abc' } }, res);
    assertEq(cap.status, 500, 'GET fails closed (500) when EBAY_ACCOUNT_DELETION_ENDPOINT_URL is unset');
    process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL = saved;
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — real matching connection gets disconnected
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: matching eiasToken disconnects the real connection ---');
  const PRINCIPAL_B = randomUUID();
  createdPrincipalIds.push(PRINCIPAL_B);
  await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [PRINCIPAL_B, `${TAG}-principal-b`]);
  const EIAS_TOKEN_B = `${TAG}-eias-b`;
  await upsertMarketplaceConnection({
    principalId: PRINCIPAL_B,
    provider: 'EBAY',
    providerUserId: EIAS_TOKEN_B,
    refreshCredential: `fake-refresh-${TAG}-b`,
  });

  {
    const before = await getMarketplaceConnection({ principalId: PRINCIPAL_B, provider: 'EBAY' });
    assertEq(before?.connectionStatus, 'CONNECTED', 'sanity: principal B’s connection starts CONNECTED');

    const { res, cap } = mockRes();
    const notification = { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0' }, notification: { notificationId: randomUUID(), data: { username: 'fake_username', userId: 'fake_user_id', eiasToken: EIAS_TOKEN_B } } };
    await handler({ method: 'POST', body: notification }, res);
    assertEq(cap.status, 200, 'POST with a matching eiasToken returns 200');

    const after = await getMarketplaceConnection({ principalId: PRINCIPAL_B, provider: 'EBAY' });
    assertEq(after?.connectionStatus, 'DISCONNECTED', 'the matching connection is now DISCONNECTED (independently re-read, not accepted from the handler response alone)');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — idempotent duplicate notification (already disconnected)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: duplicate notification for the same (now-disconnected) eiasToken is idempotent ---');
  {
    const { res, cap } = mockRes();
    const notification = { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { notificationId: randomUUID(), data: { eiasToken: EIAS_TOKEN_B } } };
    await handler({ method: 'POST', body: notification }, res);
    assertEq(cap.status, 200, 'a second notification for the same, already-disconnected eiasToken still returns 200 (idempotent, not an error)');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — unknown eiasToken (no matching connection at all)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: unknown eiasToken (never connected) ---');
  {
    const { res, cap } = mockRes();
    const notification = { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { notificationId: randomUUID(), data: { eiasToken: `${TAG}-never-existed` } } };
    await handler({ method: 'POST', body: notification }, res);
    assertEq(cap.status, 200, 'an eiasToken matching no connection still returns 200, never an error');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — missing eiasToken in payload (malformed/partial notification)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: malformed notification body (no eiasToken) ---');
  {
    const { res, cap } = mockRes();
    await handler({ method: 'POST', body: { metadata: {}, notification: { data: {} } } }, res);
    assertEq(cap.status, 200, 'a notification body with no eiasToken at all still returns 200 (nothing to disconnect, not an error)');
  }

  // ─────────────────────────────────────────────────────────────────
  // Method not allowed
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- unsupported method ---');
  {
    const { res, cap } = mockRes();
    await handler({ method: 'DELETE', query: {}, body: {} }, res);
    assertEq(cap.status, 405, 'an unsupported HTTP method is rejected (405)');
  }

  // ─────────────────────────────────────────────────────────────────
  // Scope check: this endpoint never touches any other GrailKey table.
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- scope: disconnection never touches other GrailKey tables ---');
  {
    const src = readFileSync(path.join(repoRoot, 'api', 'ebay-account-deletion.js'), 'utf8');
    const liveSrc = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assertTrue(!/requireAuthenticatedPrincipal/.test(liveSrc), 'this endpoint does NOT require a GrailKey session in live code (eBay itself calls it directly, never carries a Bearer token) — comments excluded, the deliberate non-use is documented in one');
    assertTrue(!/gk_asset|collection_item|outcome_event|operator_action_event/.test(liveSrc), 'the handler source never references any physical-asset/collection/outcome table (comments excluded) — scope is strictly the marketplace_connection row');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
} finally {
  if (createdPrincipalIds.length > 0) {
    await client.query('DELETE FROM marketplace_connection WHERE principal_id = ANY($1::uuid[])', [createdPrincipalIds]);
    await client.query('DELETE FROM gk_principal WHERE id = ANY($1::uuid[])', [createdPrincipalIds]);
  }
  await client.end();
  await closeMarketplacePool();
}

if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
