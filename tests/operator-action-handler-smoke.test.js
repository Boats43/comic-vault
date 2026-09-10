// tests/operator-action-handler-smoke.test.js
//
// GK-138 Handler-Wiring Verification — api/operator-action.js is a
// brand-new handler; a real invocation is required, not just unit
// tests of the service functions it calls (tests/operator-action-live-
// proof.test.js already covers those directly).
//
// IMPORTANT: the one real-success case below uses a process-local
// minted token purely to prove the HTTP/auth/error-mapping WIRING
// executes correctly end-to-end — exactly GK-138's own established
// convention (tests/gk184-handler-smoke.test.js, the D5D/Outcome#1
// dispatches' own harnesses). The resulting row is immediately deleted
// as test cleanup. This is NOT, and must never be reported as, a
// genuine human-originated OperatorAction (GK-199 OperatorAction
// dispatch, §8's own explicit prohibition) — it proves the CODE PATH
// works, nothing about who a real browser session belongs to.
//
// Invoke: node tests/operator-action-handler-smoke.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
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
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}

const handler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'operator-action.js')).href)).default;

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

console.log('\n=== api/operator-action.js -- real handler smoke invocation (GK-138) ===\n');

console.log('-- no token -> 401 --\n');
{
  const req = { method: 'POST', headers: {}, body: {} };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 401, `missing token -> 401 (got ${res.statusCode})`);
}

console.log('\n-- wrong method -> 405 --\n');
{
  const req = { method: 'GET', headers: {}, body: {} };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 405, `GET -> 405 (got ${res.statusCode})`);
}

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CHAIN2_DECISION_EVENT_ID = '01a0895e-f93b-708d-9530-3a58555bf75c';

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
const token = mintTestToken(JIMMY);

console.log('\n-- valid token, nonexistent decisionEventId -> 404 --\n');
{
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { gkAssetId: CREEPY_ASSET_ID, decisionEventId: '00000000-0000-7000-8000-000000000000', actionCode: 'LIST' } };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 404, `nonexistent decisionEventId -> 404 (got ${res.statusCode})`);
}

console.log('\n-- valid token, invalid actionCode -> 400 --\n');
{
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, actionCode: 'BUY_IT_NOW' } };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 400, `invalid actionCode -> 400 (got ${res.statusCode})`);
}

console.log('\n-- real success through the actual handler (test wiring proof only, cleaned up immediately) --\n');
{
  const idempotencyKey = `opact-handler-smoke-${Date.now()}`;
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { gkAssetId: CREEPY_ASSET_ID, decisionEventId: CHAIN2_DECISION_EVENT_ID, actionCode: 'HOLD', idempotencyKey } };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 200, `real handler invocation -> 200 (got ${res.statusCode})`);
  assertTrue(!!res.body?.operatorActionEventId, 'response carries a real operatorActionEventId');

  const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const row = await client.query('SELECT source, action_code FROM data1_dev.operator_action_event WHERE id = $1', [res.body.operatorActionEventId]);
  assertTrue(row.rows[0]?.source === 'operator-api', 'the endpoint itself stamped source=operator-api server-side (never caller-suppliable)');
  // Cleanup -- this row is a wiring-verification artifact, not a real
  // human decision, and must not linger as if it were.
  await client.query('DELETE FROM data1_dev.operator_action_event WHERE id = $1', [res.body.operatorActionEventId]);
  await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation = 'recordOperatorAction' AND idempotency_key = $1`, [idempotencyKey]);
  await client.end();
  console.log('  (test-artifact row deleted -- this smoke test proves the CODE PATH works, it is not a genuine operator action)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
