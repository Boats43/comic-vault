// tests/gk179-environment-guard-latency.test.js
//
// GK-179 — measures the real added latency of the environment-identity
// guard on acquireConnection(), guard enabled vs disabled, against
// identical fixtures (the same real Development pool, same network
// path, same PgBouncer endpoint — only the guard's own extra SELECT is
// isolated as the difference).
//
// NO CACHING is used anywhere in the guard (src/lib/environmentGuard.js's
// own header explains why — GK-178's proven backend-swap hazard). This
// measurement exists precisely because that design choice has a real,
// non-zero cost on every single connection acquisition on a serverless
// path through PgBouncer, and that cost needs a number, not an assumption.
//
// Invoke: node --env-file=.env.development.local tests/gk179-environment-guard-latency.test.js

import { Client } from 'pg';
import { assertEnvironmentIdentity } from '../src/lib/environmentGuard.js';

const connStr = process.env.GRAILKEY_CATALOG_DATABASE_URL;
if (!connStr) { console.log('BLOCKED — VARIABLE NOT SET (GRAILKEY_CATALOG_DATABASE_URL)'); process.exit(2); }
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const N = 30;

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

console.log(`\n=== GK-179 — connection-guard overhead, N=${N} acquisitions each, real pooled Development connection ===\n`);

// Guard DISABLED (baseline): acquire + release, no guard call.
const baselineTimes = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.end();
  baselineTimes.push(performance.now() - t0);
}

// Guard ENABLED: acquire + guard check + release.
const guardedTimes = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await assertEnvironmentIdentity(client);
  await client.end();
  guardedTimes.push(performance.now() - t0);
}

// Also isolate JUST the guard's own query cost on an already-open connection
// (closer to the real acquireConnection() shape, where the pool connection
// is already established and only the guard's extra round trip is new).
const guardOnlyTimes = [];
{
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await assertEnvironmentIdentity(client);
    guardOnlyTimes.push(performance.now() - t0);
  }
  await client.end();
}

function report(label, arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  console.log(`${label}: p50=${percentile(sorted, 50).toFixed(1)}ms  p95=${percentile(sorted, 95).toFixed(1)}ms  min=${sorted[0].toFixed(1)}ms  max=${sorted[sorted.length - 1].toFixed(1)}ms`);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

const baseline = report('Full connect+release, guard DISABLED (baseline)', baselineTimes);
const guarded = report('Full connect+release, guard ENABLED', guardedTimes);
report('Guard-only extra round trip (already-open connection)', guardOnlyTimes);

console.log('\n=== Guard overhead (full acquisition path) ===');
console.log(`  added p50: ${(guarded.p50 - baseline.p50).toFixed(1)}ms`);
console.log(`  added p95: ${(guarded.p95 - baseline.p95).toFixed(1)}ms`);

console.log('\n=== Caching ===');
console.log('  NO per-process or per-target cache is used. Every acquireConnection() call runs a fresh');
console.log('  SELECT against environment_marker. This is deliberate (src/lib/environmentGuard.js header):');
console.log('  GK-178 proved a pooled PgBouncer connection can be silently routed to a different physical');
console.log('  backend between calls on what looks like "the same" pool/session — a cached-by-process');
console.log('  identity result could assert PASS for a connection that is no longer the one it verified.');
console.log('  There is therefore no cache key to state and no cache to prove cannot survive a target');
console.log('  change: the guard has no memory across calls by construction, so a target change is');
console.log('  detected on the very next acquisition, always, with no staleness window.');
