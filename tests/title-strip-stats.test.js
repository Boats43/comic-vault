// tests/title-strip-stats.test.js
//
// A6 dispatch (2026-07-26), Scope 2 Option 2 — diagnostic aggregation for
// the [22f] metadata-strip step. compHygiene.js's tokenizeTitle now calls
// recordTitleStrip() unconditionally and only console.logs the per-row
// line when CV_DEBUG_TITLE_STRIP=1 (a server env var, never
// request-controlled). This suite tests titleStripStats.js directly and
// confirms tokenizeTitle actually wires it in end-to-end.
//
// Invoke: node tests/title-strip-stats.test.js

import { resetTitleStripStats, recordTitleStrip, getTitleStripStats } from '../src/lib/titleStripStats.js';
import { tokenizeTitle } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== titleStripStats — [22f-summary] aggregation ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — resetTitleStripStats / recordTitleStrip / getTitleStripStats
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: counter mechanics\n');

{
  resetTitleStripStats();
  assertEq(JSON.stringify(getTitleStripStats()), JSON.stringify({ rows: 0, changed: 0, unchanged: 0, duplicates: 0 }), 'reset: all counters zeroed');

  recordTitleStrip('flash #128 dc comics 1962', 'flash #128 1962');
  let stats = getTitleStripStats();
  assertEq(stats.rows, 1, 'rows increments on each call');
  assertEq(stats.changed, 1, 'changed increments when before !== after');
  assertEq(stats.unchanged, 0, 'unchanged stays 0 for a genuinely-changed row');
  assertEq(stats.duplicates, 0, 'duplicates stays 0 for a first-seen title');

  recordTitleStrip('the flash', 'the flash'); // unchanged
  stats = getTitleStripStats();
  assertEq(stats.rows, 2, 'rows increments again');
  assertEq(stats.unchanged, 1, 'unchanged increments when before === after');

  recordTitleStrip('flash #128 dc comics 1962', 'flash #128 1962'); // exact repeat
  stats = getTitleStripStats();
  assertEq(stats.rows, 3, 'rows increments on a duplicate call too');
  assertEq(stats.duplicates, 1, 'duplicates increments on a repeat of an already-seen input');
  assertEq(stats.changed, 2, 'changed still tallies the duplicate row too (rows = changed + unchanged always)');
}

{
  resetTitleStripStats();
  const stats = getTitleStripStats();
  assertEq(stats.rows, 0, 'reset again: counters genuinely zero, no leakage from Part 1');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — tokenizeTitle actually wires recordTitleStrip in (not just a
//      parallel, disconnected counter)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: tokenizeTitle end-to-end wiring\n');

{
  resetTitleStripStats();
  tokenizeTitle('Flash #128 DC Comics 1962');
  tokenizeTitle('Flash #128 DC Comics 1962'); // same input again — duplicate
  tokenizeTitle('Bone #1 Cartoon Books');
  const stats = getTitleStripStats();
  assertEq(stats.rows, 3, 'tokenizeTitle: 3 calls recorded 3 rows');
  assertEq(stats.duplicates, 1, 'tokenizeTitle: the repeated input counted as a duplicate');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
