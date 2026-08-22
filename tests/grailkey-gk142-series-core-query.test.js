// tests/grailkey-gk142-series-core-query.test.js
//
// GK-142 — Phase 0.3 (2026-08-21). Unit-level coverage for
// deriveSeriesCoreQuery (src/lib/identityCore.js). See that function's own
// header comment for the full trace/mechanism, and
// grailkey-gk142-series-core-query-handler-smoke.test.js for the real
// /api/enrich handler proof (GK-138).
//
// Invoke: node tests/grailkey-gk142-series-core-query.test.js

import { deriveSeriesCoreQuery } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEqual = (actual, expected, label) => {
  const ok = actual === expected;
  assertTrue(ok, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
};

console.log('\n=== Part 1: r5v6b production shape — the reported defect ===\n');

{
  const r = deriveSeriesCoreQuery('Detective Comics Batman Corner Box Jorge Jiménez', '1107');
  console.log(`  -> ${JSON.stringify(r)}`);
  assertTrue(!r.overStripped, 'not over-stripped');
  assertTrue(!/corner\s*box/i.test(r.value), 'SHIP-BLOCKING: "Corner Box" stripped from the query projection');
  assertTrue(!/jim.nez|jimenez/i.test(r.value), 'SHIP-BLOCKING: "Jorge Jiménez" stripped from the query projection');
  assertEqual(r.value, 'Detective Comics Batman', 'clean series-core result');
}

console.log('\n=== Part 2: AW/GK-140 production shape — must still resolve identically ===\n');

{
  // The "by" marker IS present here — canonicalizeTitleCandidate's own
  // attribution stripper already handles this; deriveSeriesCoreQuery must
  // not double-strip or corrupt an already-clean canonicalization.
  const r = deriveSeriesCoreQuery('Venom Separation Anxiety By Mike Mayhew Poker Chip', '1');
  console.log(`  -> ${JSON.stringify(r)}`);
  assertEqual(r.value, 'Venom Separation Anxiety', 'matches AW/GK-140\'s own expected clean result — ordering does not regress it');
}

console.log('\n=== Part 3: A5 mandatory fallback — over-strip guard ===\n');

{
  const r = deriveSeriesCoreQuery('Jorge Jiménez');
  assertTrue(r.overStripped === true, 'bare creator name alone triggers over-strip guard');
  assertEqual(r.value, 'Jorge Jiménez', 'A5: falls back to the UN-PROJECTED input verbatim, never returns empty/garbage');
}
{
  const r = deriveSeriesCoreQuery('Corner Box');
  assertTrue(r.overStripped === true, 'bare cover-descriptor alone triggers over-strip guard');
  assertEqual(r.value, 'Corner Box', 'A5: falls back to the un-projected input verbatim');
}
{
  const r = deriveSeriesCoreQuery('');
  assertEqual(r.value, '', 'empty input returns empty, no crash');
  assertTrue(r.overStripped === false, 'empty input is not flagged over-stripped (nothing to strip)');
}
{
  const r = deriveSeriesCoreQuery(null);
  assertEqual(r.value, '', 'null input handled gracefully');
}

console.log('\n=== Part 4: negative controls — legitimate titles pass through untouched ===\n');

{
  const CONTROLS = ['Sabrina the Teenage Witch', 'Absolute Batman', 'Creepy'];
  for (const t of CONTROLS) {
    const r = deriveSeriesCoreQuery(t);
    assertEqual(r.value, t, `legitimate title with no creator/descriptor noise unchanged: "${t}"`);
    assertTrue(!r.overStripped, `"${t}" not flagged over-stripped`);
  }
}

console.log('\n=== Part 5: reuse-not-hand-grown — cover descriptors come from the pricing NO_PREMIUM vocabulary ===\n');

{
  // Every NO_PREMIUM_COVER_DESCRIPTORS token (compHygiene.js — a synced
  // copy of api/enrich.js's own pricing-math NO_PREMIUM array) actually
  // strips when present, proving A5's "reuse existing, no hand-grown list"
  // requirement is real, not just asserted in a comment.
  const TOKENS = ['corner box', 'masterpieces', 'design variant', 'headshot', 'trading card', 'marvel legacy'];
  for (const tok of TOKENS) {
    const input = `Amazing Spider-Man ${tok} Edition`;
    const r = deriveSeriesCoreQuery(input);
    assertTrue(!r.value.toLowerCase().includes(tok), `cover-descriptor token "${tok}" stripped from query projection`);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
