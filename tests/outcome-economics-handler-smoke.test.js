// tests/outcome-economics-handler-smoke.test.js
//
// GK-209 Outcome #1 CLOSER — GK-138 real handler invocation for
// api/outcome-economics.js. Real handler, real Development Postgres.
// Uses a DISPOSABLE test outcome_event fixture (created and deleted by
// this test) rather than Creepy's own real DELISTED row, so no fake
// economics data ever contaminates Creepy's real, permanent history.
//
// Invoke: node tests/outcome-economics-handler-smoke.test.js

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
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');

const handler = (await import(pathToFileURL(path.join(repoRoot, 'api', 'outcome-economics.js')).href)).default;

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

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
const token = mintTestToken(JIMMY);

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log('\n=== api/outcome-economics.js -- real handler smoke (GK-138), disposable fixture ===\n');

// Disposable test outcome_event (a fake SOLD row for Creepy, real
// gk_asset_id so ownership checks are genuine, deleted at the end).
const testOutcomeId = '00000000-0000-4000-8000-000000000abc'.replace(/^0+/, () => randomBytes(1).toString('hex')).slice(0, 36);
async function uuid() { return (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id; }
const disposableOutcomeId = await uuid();
await client.query(
  `INSERT INTO data1_dev.outcome_event (id, gk_asset_id, outcome_type, channel, recorded_by_principal_id, correlation_id)
   VALUES ($1, $2, 'SOLD', 'ebay', $3, gen_random_uuid())`,
  [disposableOutcomeId, CREEPY_ASSET_ID, JIMMY]
);
console.log(`  (disposable test outcome_event created: ${disposableOutcomeId} -- deleted at the end of this test)\n`);

console.log('-- no Authorization header -> 401 --\n');
{
  const req = { method: 'POST', headers: {}, body: { outcomeEventId: disposableOutcomeId, componentType: 'gross', amount: 10, source: 'api-sourced' } };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 401, `no token -> 401 (got ${res.statusCode})`);
}

console.log('\n-- source cannot be forced to api-sourced by the caller -- always recorded as operator-entered --\n');
{
  const idempotencyKey = `outcome-economics-smoke-${Date.now()}-a`;
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: { outcomeEventId: disposableOutcomeId, componentType: 'gross', amount: 80.00, source: 'api-sourced', idempotencyKey },
  };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 200, `real write succeeds -> 200 (got ${res.statusCode})`);
  const row = await client.query(`SELECT source, amount, component_type FROM data1_dev.outcome_economics_component WHERE id = $1`, [res.body.componentId]);
  assertTrue(row.rows[0].source === 'operator-entered', 'the durable row is source=operator-entered REGARDLESS of what the caller\'s body claimed');
  assertTrue(Number(row.rows[0].amount) === 80.00, 'the real gross amount was persisted');
}

console.log('\n-- fees + shipping recorded, GET derives the correct realized net --\n');
{
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { outcomeEventId: disposableOutcomeId, componentType: 'fees', amount: 8.00, source: 'x', idempotencyKey: `outcome-economics-smoke-${Date.now()}-b` } }, mockRes());
  await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { outcomeEventId: disposableOutcomeId, componentType: 'shipping', amount: 5.00, source: 'x', idempotencyKey: `outcome-economics-smoke-${Date.now()}-c` } }, mockRes());

  const getReq = { method: 'GET', headers: { authorization: `Bearer ${token}` }, query: { outcomeEventId: disposableOutcomeId } };
  const getRes = mockRes();
  await handler(getReq, getRes);
  assertTrue(getRes.statusCode === 200, `GET succeeds -> 200 (got ${getRes.statusCode})`);
  assertTrue(getRes.body.gross === 80, `gross = 80 (got ${getRes.body.gross})`);
  assertTrue(getRes.body.fees === 8, `fees = 8 (got ${getRes.body.fees})`);
  assertTrue(getRes.body.shipping === 5, `shipping = 5 (got ${getRes.body.shipping})`);
  assertTrue(getRes.body.realizedNet === 67, `realizedNet = 80 - 8 - 5 = 67 (got ${getRes.body.realizedNet})`);
  assertTrue(getRes.body.components.length === 3, `3 durable components persisted (got ${getRes.body.components.length})`);
}

console.log('\n-- invalid componentType is rejected, no row written --\n');
{
  const before = (await client.query(`SELECT count(*)::int c FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1`, [disposableOutcomeId])).rows[0].c;
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { outcomeEventId: disposableOutcomeId, componentType: 'not-real', amount: 5, source: 'x' } };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 400, `invalid componentType -> 400 (got ${res.statusCode})`);
  const after = (await client.query(`SELECT count(*)::int c FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1`, [disposableOutcomeId])).rows[0].c;
  assertTrue(before === after, 'no row was written for the rejected request');
}

console.log('\n-- nonexistent outcomeEventId -> 404, never confirms/denies existence differently for auth vs not-found --\n');
{
  const req = { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { outcomeEventId: '00000000-0000-0000-0000-000000000000', componentType: 'gross', amount: 5, source: 'x' } };
  const res = mockRes();
  await handler(req, res);
  assertTrue(res.statusCode === 404, `nonexistent outcomeEventId -> 404 (got ${res.statusCode})`);
}

// Cleanup — disposable fixture only, never touches any real Creepy outcome_event/economics row.
await client.query(`DELETE FROM data1_dev.outcome_economics_component WHERE outcome_event_id = $1`, [disposableOutcomeId]);
await client.query(`DELETE FROM data1_dev.idempotency_key WHERE operation IN ('recordEconomicsComponent') AND idempotency_key LIKE 'outcome-economics-smoke-%'`);
await client.query(`DELETE FROM data1_dev.outcome_event WHERE id = $1`, [disposableOutcomeId]);
console.log('\n  (disposable fixture fully cleaned up)');

await client.end();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
