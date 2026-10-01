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
import { createHash, createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
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
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';

// ─────────────────────────────────────────────────────────────────────
// Real EC keypair + real eBay-shaped signature fixture. Mirrors eBay's
// own official event-notification-nodejs-sdk exactly (fetched and read
// directly from github.com/eBay/event-notification-nodejs-sdk this
// session): digest name 'ssl3-sha1' (verified accepted by this Node's
// OpenSSL build -- createVerify('ssl3-sha1') does not throw), message =
// JSON.stringify(body), public key returned by eBay's own API glues the
// PEM BEGIN/END markers onto the base64 body with no newline (formatKey
// reinserts it) -- so the TEST's own mocked "eBay API" response
// deliberately strips the real PEM's newlines the same way, to prove the
// handler's own reformatting step is what makes verification succeed,
// not an accidentally-already-valid PEM.
// ─────────────────────────────────────────────────────────────────────
const { publicKey: testPublicKeyObj, privateKey: testPrivateKeyObj } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const testPublicKeyPem = testPublicKeyObj.export({ type: 'spki', format: 'pem' });
// Strip the newline eBay's real API apparently omits, so the handler's
// own formatEbayPublicKeyPem() is the thing proven to restore it.
const testPublicKeyRawNoNewlines = testPublicKeyPem
  .replace('-----BEGIN PUBLIC KEY-----\n', '-----BEGIN PUBLIC KEY-----')
  .replace('\n-----END PUBLIC KEY-----\n', '-----END PUBLIC KEY-----')
  .replace(/\n/g, '');
const TEST_KID = 'test-key-1';

function signNotificationBody(body) {
  const signer = createSign('ssl3-sha1');
  signer.update(JSON.stringify(body));
  const signature = signer.sign(testPrivateKeyObj, 'base64');
  return Buffer.from(JSON.stringify({ kid: TEST_KID, signature })).toString('base64');
}

// Real end-to-end self-check at module load: if this fails, the fixture
// itself (curve/digest/PEM-reconstruction choice) is wrong, independent
// of anything in the handler.
{
  const { createVerify } = await import('node:crypto');
  const probeBody = { probe: true };
  const probeHeader = signNotificationBody(probeBody);
  const decoded = JSON.parse(Buffer.from(probeHeader, 'base64').toString('ascii'));
  const reformatted = testPublicKeyRawNoNewlines
    .replace('-----BEGIN PUBLIC KEY-----', '-----BEGIN PUBLIC KEY-----\n')
    .replace('-----END PUBLIC KEY-----', '\n-----END PUBLIC KEY-----');
  const verifier = createVerify('ssl3-sha1');
  verifier.update(JSON.stringify(probeBody));
  const selfCheckOk = verifier.verify(reformatted, decoded.signature, 'base64');
  if (!selfCheckOk) {
    throw new Error('FIXTURE SELF-CHECK FAILED: the test’s own sign/verify round-trip (prime256v1 + ssl3-sha1) does not pass -- the curve or digest choice needs adjustment before any handler test can be trusted.');
  }
  console.log('[fixture self-check] prime256v1 + ssl3-sha1 real sign/verify round-trip: PASS');
}

// Dispatches global.fetch by URL: eBay's OAuth token endpoint (consumed
// by api/comps.js's own getOAuthToken, reused by the handler) and eBay's
// public-key endpoint (returns the test public key, PEM-markers glued
// with no newline, exactly like the real API apparently does).
function installEbayFetchMock() {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/identity/v1/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'fake-app-token', expires_in: 7200, token_type: 'Application Access Token' }),
      };
    }
    if (u.includes('/commerce/notification/v1/public_key/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: testPublicKeyRawNoNewlines, algorithm: 'ECDSA', digest: 'SHA1' }),
      };
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
}

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

  installEbayFetchMock();

  // ─────────────────────────────────────────────────────────────────
  // POST — missing / malformed signature rejected BEFORE any DB access
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: missing signature header rejected ---');
  {
    const { res, cap } = mockRes();
    const notification = { metadata: {}, notification: { data: { eiasToken: `${TAG}-no-sig` } } };
    await handler({ method: 'POST', headers: {}, body: notification }, res);
    assertEq(cap.status, 400, 'a POST with no x-ebay-signature header at all is rejected (400) before any database access');
  }

  console.log('\n--- POST: malformed signature header rejected ---');
  {
    const { res, cap } = mockRes();
    const notification = { metadata: {}, notification: { data: { eiasToken: `${TAG}-bad-sig` } } };
    await handler({ method: 'POST', headers: { 'x-ebay-signature': 'not-valid-base64-json!!!' }, body: notification }, res);
    assertEq(cap.status, 400, 'a structurally malformed x-ebay-signature header (not valid base64/JSON) is rejected (400) before any database access');
  }
  {
    // Valid base64/JSON shape, but not a real signature -> rejected as a
    // verification failure (401), distinct from "malformed" (400).
    const { res, cap } = mockRes();
    const notification = { metadata: {}, notification: { data: { eiasToken: `${TAG}-fake-sig` } } };
    const fakeHeader = Buffer.from(JSON.stringify({ kid: TEST_KID, signature: Buffer.from('not-a-real-signature').toString('base64') })).toString('base64');
    await handler({ method: 'POST', headers: { 'x-ebay-signature': fakeHeader }, body: notification }, res);
    assertEq(cap.status, 401, 'a well-formed but cryptographically invalid signature is rejected (401) -- distinct status from a structurally malformed header');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — real matching connection gets disconnected (validly signed)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: matching eiasToken disconnects the real connection (validly signed) ---');
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

  const notificationB = { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0' }, notification: { notificationId: randomUUID(), data: { username: 'fake_username', userId: 'fake_user_id', eiasToken: EIAS_TOKEN_B } } };
  const sigHeaderB = signNotificationBody(notificationB);

  {
    const before = await getMarketplaceConnection({ principalId: PRINCIPAL_B, provider: 'EBAY' });
    assertEq(before?.connectionStatus, 'CONNECTED', 'sanity: principal B’s connection starts CONNECTED');

    const { res, cap } = mockRes();
    await handler({ method: 'POST', headers: { 'x-ebay-signature': sigHeaderB }, body: notificationB }, res);
    assertEq(cap.status, 200, 'a validly signed POST with a matching eiasToken returns 200 -- real end-to-end signature verification (real EC keypair, real sign, real verify against the handler’s own formatEbayPublicKeyPem reconstruction) actually passed');

    const after = await getMarketplaceConnection({ principalId: PRINCIPAL_B, provider: 'EBAY' });
    assertEq(after?.connectionStatus, 'DISCONNECTED', 'the matching connection is now DISCONNECTED (independently re-read, not accepted from the handler response alone)');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — payload mutation invalidates the (otherwise valid) signature
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: payload mutation invalidates verification ---');
  {
    const mutatedBody = { ...notificationB, notification: { ...notificationB.notification, data: { ...notificationB.notification.data, eiasToken: `${TAG}-attacker-substituted-eias` } } };
    const { res, cap } = mockRes();
    // Reuse sigHeaderB (signed over the ORIGINAL notificationB), but send
    // the mutated body -- the signature no longer matches.
    await handler({ method: 'POST', headers: { 'x-ebay-signature': sigHeaderB }, body: mutatedBody }, res);
    assertEq(cap.status, 401, 'a signature valid for one payload does not validate a different (mutated) payload -- rejected (401), no disconnect attempted');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — idempotent duplicate notification (already disconnected)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: duplicate notification for the same (now-disconnected) eiasToken is idempotent ---');
  {
    const { res, cap } = mockRes();
    await handler({ method: 'POST', headers: { 'x-ebay-signature': sigHeaderB }, body: notificationB }, res);
    assertEq(cap.status, 200, 'a second, validly-signed notification for the same, already-disconnected eiasToken still returns 200 (idempotent, not an error)');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — unknown eiasToken (no matching connection at all), validly signed
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: unknown eiasToken (never connected), validly signed ---');
  {
    const notification = { metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' }, notification: { notificationId: randomUUID(), data: { eiasToken: `${TAG}-never-existed` } } };
    const sigHeader = signNotificationBody(notification);
    const { res, cap } = mockRes();
    await handler({ method: 'POST', headers: { 'x-ebay-signature': sigHeader }, body: notification }, res);
    assertEq(cap.status, 200, 'a validly-signed notification whose eiasToken matches no connection still returns 200, never an error, and never a database write');
  }

  // ─────────────────────────────────────────────────────────────────
  // POST — missing eiasToken in payload (malformed/partial notification), validly signed
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- POST: malformed notification body (no eiasToken), validly signed ---');
  {
    const body = { metadata: {}, notification: { data: {} } };
    const sigHeader = signNotificationBody(body);
    const { res, cap } = mockRes();
    await handler({ method: 'POST', headers: { 'x-ebay-signature': sigHeader }, body }, res);
    assertEq(cap.status, 200, 'a validly-signed notification body with no eiasToken at all still returns 200 (nothing to disconnect, not an error)');
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

  // ─────────────────────────────────────────────────────────────────
  // No credential disclosure: the signature value, public key material,
  // and app token are never passed to console.log/console.error.
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- scope: signature verification never logs secret/key material ---');
  {
    const src = readFileSync(path.join(repoRoot, 'api', 'ebay-account-deletion.js'), 'utf8');
    const liveSrc = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // Every console.log/console.error call site, checked individually --
    // none may interpolate decoded.signature, rawKey, accessToken, or the
    // raw x-ebay-signature header value itself.
    const logCalls = liveSrc.match(/console\.(log|error)\([^;]*\)/g) || [];
    assertTrue(logCalls.length > 0, 'sanity: the source actually contains console.log/console.error calls to check');
    const leaksSecret = logCalls.some((call) => /decoded\.signature|rawKey|accessToken|headerValue|EBAY_CERT_ID/.test(call));
    assertTrue(!leaksSecret, 'no console.log/console.error call site interpolates the signature value, the raw public key, the app access token, the raw signature header, or EBAY_CERT_ID');
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
