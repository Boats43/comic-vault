// tests/h8-bootstrap-gate.test.js
//
// GRAILKEY — H8 BOOTSTRAP DEADLOCK RESOLUTION (2026-09-19). Proves
// api/capture-scan.js's new MILESTONE_TEN_H8_BOOTSTRAP gate — a
// SEPARATE, narrower one-shot exception from MILESTONE_TEN_H8_PASS
// (required invariant: bootstrap authorization != H8 proof), reusing
// the existing asset-count read (src/modules/assets/index.js's
// hasAnyPhysicalAsset()) rather than inventing a new counter/table.
//
// Does not touch real Production and does not mint any bootstrap
// capture for real — this suite runs entirely against the real
// Development database (GRAILKEY_CATALOG_ENVIRONMENT=development, per
// this repo's own standing test convention), the SAME technique
// tests/capture-scan-endpoint-h8-gate-proof.test.js already uses to
// simulate a "production" gate check while the real DB connection stays
// Development throughout.
//
// Invoke: node tests/h8-bootstrap-gate.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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
delete process.env.MILESTONE_TEN_H8_PASS;
delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;

const captureScanRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'capture-scan.js')).href)).default;
const { hasAnyPhysicalAsset, closePool } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== H8 bootstrap gate (api/capture-scan.js) ===\n');

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `h8-bootstrap-${Date.now()}`;

function mintTestToken(principalId) {
  const secret = process.env.GRAILKEY_SESSION_SECRET;
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}
const token = mintTestToken(JIMMY);

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

async function countAssets() {
  const r = await client.query('SELECT COUNT(*)::int AS n FROM gk_asset');
  return r.rows[0].n;
}

try {
  console.log('-- unit: hasAnyPhysicalAsset() matches a live COUNT query against real Development data --\n');
  {
    const liveCount = await countAssets();
    const result = await hasAnyPhysicalAsset();
    assertTrue(result === (liveCount > 0), `hasAnyPhysicalAsset() returns ${result}, matching COUNT(*)=${liveCount} > 0`);
  }

  console.log('\n-- no bootstrap flag set: Production + H8 unproven still 403s exactly as before (unchanged behavior) --\n');
  {
    const before = await countAssets();
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'production';
    delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: `${TAG}-noboot`, correlationId: randomUUID() }, idempotencyKey: `${TAG}:noboot` },
    };
    const res = mockRes();
    await captureScanRoute(req, res);
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
    const after = await countAssets();
    assertTrue(res.statusCode === 403, `no bootstrap flag -> 403 (got ${res.statusCode})`);
    assertTrue(res.body?.error === 'PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN', `error is the original H8-not-proven code, not a bootstrap-specific one (got ${res.body?.error})`);
    assertTrue(after === before, `zero gk_asset rows created (before=${before}, after=${after})`);
  }

  console.log('\n-- MILESTONE_TEN_H8_PASS=true makes the bootstrap flag irrelevant (H8_PASS still wins outright) --\n');
  {
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'production';
    process.env.MILESTONE_TEN_H8_PASS = 'true';
    process.env.MILESTONE_TEN_H8_BOOTSTRAP = 'true'; // present but must not matter once H8_PASS is true
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {}, // malformed on purpose — proves the gate didn't block; business validation did
    };
    const res = mockRes();
    await captureScanRoute(req, res);
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
    delete process.env.MILESTONE_TEN_H8_PASS;
    delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;
    assertTrue(res.statusCode === 400, `H8_PASS=true -> gate never fires at all, reaches business validation (got ${res.statusCode})`);
  }

  console.log('\n-- bootstrap flag true, H8_PASS false: a real Production/Development environment-identity MISMATCH makes the eligibility check itself throw -> fails CLOSED, never silently opens --\n');
  {
    // This is the real, meaningful case this suite CAN prove without
    // touching real Production or minting a real bootstrap asset: the
    // simulated "production" env-var value does not match this real
    // Development database's own environment_marker.app_env, so
    // hasAnyPhysicalAsset()'s acquireConnection() -> assertEnvironmentIdentity
    // (GK-179, shared by every real operation in this module) genuinely
    // throws. The gate's own try/catch must treat that identically to
    // "bootstrap already used" -- fail closed, never fail open -- which
    // is exactly the "any failure to determine eligibility blocks" rule
    // this dispatch requires.
    const before = await countAssets();
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'production';
    process.env.MILESTONE_TEN_H8_BOOTSTRAP = 'true';
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { scanPayload: { collectionItemId: `${TAG}-mismatch`, correlationId: randomUUID() }, idempotencyKey: `${TAG}:mismatch` },
    };
    const res = mockRes();
    await captureScanRoute(req, res);
    process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
    delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;
    const after = await countAssets();
    assertTrue(res.statusCode === 403, `eligibility check throws (real env-identity mismatch) -> still 403, never a 200 or 500 leak (got ${res.statusCode})`);
    assertTrue(res.body?.error === 'PRODUCTION_CAPTURE_BOOTSTRAP_EXHAUSTED', `error names the bootstrap gate specifically, not the original H8 gate (got ${res.body?.error})`);
    assertTrue(after === before, `zero gk_asset rows created despite the bootstrap flag being set (before=${before}, after=${after})`);
  }

  console.log('\n-- non-Production (real, consistent Development config): bootstrap flag present is simply irrelevant, unchanged normal behavior --\n');
  {
    process.env.MILESTONE_TEN_H8_BOOTSTRAP = 'true';
    const req = {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: {},
    };
    const res = mockRes();
    await captureScanRoute(req, res);
    delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;
    assertTrue(res.statusCode === 400, `Development + bootstrap flag set -> gate never applies at all (env !== production), reaches business validation (got ${res.statusCode})`);
  }
} finally {
  await client.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
  }
  await closePool();
  process.exit(failed > 0 ? 1 : 0);
}
