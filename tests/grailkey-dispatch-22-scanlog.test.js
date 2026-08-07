// tests/grailkey-dispatch-22-scanlog.test.js
//
// GrailKey Dispatch 22 (2026-08-07) — structured per-scan KV logging,
// shipped per the Dispatch 21 plan plus two decisions made without
// waiting on data: log every scan (a narrow log recreates the exact
// problem this exists to fix — the deciding argument was the plan's
// own), and use a sorted-set index rather than Redis Streams (uses only
// primitives api/kv-cache.js already proves work against this project's
// real Upstash instance; two writes per scan is irrelevant at current
// volume, ~60 scans/week).
//
// Tests the pure record/key builders (src/lib/scanLog.js) directly, and
// confirms kvZAdd (api/kv-cache.js) follows the SAME graceful-
// degradation contract kvGet/kvSet already have — a logging write must
// never be able to throw into a real scan response, verified here by
// calling it with no KV configured (this test's own environment) and
// confirming it resolves without throwing, exactly the shape a
// production Redis outage would produce.

import { buildScanLogRecord, buildScanLogKey, SCAN_LOG_VERSION, SCAN_LOG_TTL_SECONDS, SCAN_LOG_INDEX_KEY } from '../src/lib/scanLog.js';
import { kvZAdd } from '../api/kv-cache.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GrailKey Dispatch 22 — scanlog (buildScanLogRecord/buildScanLogKey/kvZAdd) ===\n');

console.log('-- Section 1: versioning and constants, matching the established PC_FILTER_VERSION/CV_FILTER_VERSION convention --');
{
  assertEq(SCAN_LOG_VERSION, 1, 'SCAN_LOG_VERSION starts at 1');
  assertEq(SCAN_LOG_TTL_SECONDS, 90 * 24 * 60 * 60, 'TTL is exactly 90 days in seconds');
  assertEq(SCAN_LOG_INDEX_KEY, 'scanlog:index:v1', 'index key is versioned, distinct from every other kv-cache.js prefix');
}

console.log('\n-- Section 2: buildScanLogKey --');
{
  assertEq(buildScanLogKey(1786000000000, 'abc123'), 'scanlog:v1:1786000000000:abc123', 'key shape: scanlog:v<version>:<ts>:<id>');
}

console.log('\n-- Section 3: buildScanLogRecord — full input, every field populated --');
{
  const record = buildScanLogRecord({
    ts: 1786000000000,
    id: 'req-abc',
    book: { title: 'Spawn', issue: '351', year: '2024' },
    issueAuthority: { status: 'provisional', reasons: ['marketplace-only-adoption'], highConfidenceMarketplaceConsensus: false, supportRatio: 0.53 },
    familyWeight: { weightSum: 11, count: 4, overlapRatio: 1, decision: 'weighted-consensus' },
    terminalReason: 'commit4-terminal',
    poolSizes: { raw: 20, eligible: 20, familyMembers: 4 },
    assetTypeOverride: { evaluated: true, fired: false, blockedBy: ['pool-incoherent'] },
  });
  assertEq(record.v, 1, 'v field present and correct');
  assertEq(record.ts, 1786000000000, 'ts passed through');
  assertEq(record.id, 'req-abc', 'id passed through');
  assertEq(record.book, { title: 'Spawn', issue: '351', year: '2024' }, 'book fully populated');
  assertEq(record.issueAuthority.status, 'provisional', 'issueAuthority.status');
  assertEq(record.issueAuthority.supportRatio, 0.53, 'issueAuthority.supportRatio');
  assertEq(record.familyWeight.weightSum, 11, 'familyWeight.weightSum — the exact field the commit-p rank-slot investigation needed');
  assertEq(record.terminalReason, 'commit4-terminal', 'terminalReason');
  assertEq(record.poolSizes.raw, 20, 'poolSizes.raw');
  assertEq(record.assetTypeOverride.blockedBy, ['pool-incoherent'], 'assetTypeOverride.blockedBy');
}

console.log('\n-- Section 4: buildScanLogRecord — minimal input, every optional field defaults to null, not omitted --');
{
  const record = buildScanLogRecord({ ts: 1786000000000, id: 'req-minimal' });
  assertEq(record.book, null, 'book defaults to null');
  assertEq(record.issueAuthority, null, 'issueAuthority defaults to null');
  assertEq(record.familyWeight, null, 'familyWeight defaults to null');
  assertEq(record.terminalReason, null, 'terminalReason defaults to null — a normal confident scan, not synthesized to "clean" at build time');
  assertEq(record.poolSizes, null, 'poolSizes defaults to null');
  assertEq(record.assetTypeOverride, null, 'assetTypeOverride defaults to null');
  // Stable key set regardless of input completeness — a consumer querying
  // many records can rely on every key existing without presence checks.
  assertTrue('book' in record && 'issueAuthority' in record && 'familyWeight' in record && 'terminalReason' in record && 'poolSizes' in record && 'assetTypeOverride' in record, 'every field key present even when null — stable shape for consumers');
}

console.log('\n-- Section 5: buildScanLogRecord — partial nested objects fill missing sub-fields with null --');
{
  const record = buildScanLogRecord({
    ts: 1786000000000,
    id: 'req-partial',
    issueAuthority: { status: 'provisional' }, // reasons/highConfidenceMarketplaceConsensus/supportRatio all omitted
  });
  assertEq(record.issueAuthority.status, 'provisional', 'provided sub-field preserved');
  assertEq(record.issueAuthority.reasons, [], 'missing reasons defaults to empty array, not undefined');
  assertEq(record.issueAuthority.highConfidenceMarketplaceConsensus, null, 'missing highConfidenceMarketplaceConsensus defaults to null');
  assertEq(record.issueAuthority.supportRatio, null, 'missing supportRatio defaults to null');
}

console.log('\n-- Section 6: kvZAdd follows the same graceful-degradation contract as kvGet/kvSet --');
{
  // No KV_REST_API_URL/TOKEN configured in this test environment — the
  // real shape a production Redis outage would produce. Must resolve
  // without throwing; a logging write can never be allowed to break a
  // real scan response.
  let threw = false;
  try {
    await kvZAdd('scanlog:index:v1', Date.now(), 'scanlog:v1:test:test');
  } catch {
    threw = true;
  }
  assertTrue(!threw, 'kvZAdd never throws, even with no KV configured — matches kvGet/kvSet\'s existing contract');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
