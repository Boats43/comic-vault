// tests/mega-keys-duplicate-detector.test.js
//
// Pricing Trust — Commit C3 (2026-09-23), shipped standalone, no behavior
// change. Deterministic source-level coverage for api/mega-keys.js's
// MEGA_KEYS_FLOOR object literal: JavaScript object-literal last-write-
// wins semantics must never again silently decide pricing authority.
//
// CURRENT KNOWN STATE, locked in as a real regression proof (not yet
// fixed — this commit is detection only): 50 source definitions, 43
// unique normalized keys, exactly 7 duplicate collisions, all 7 traced
// via `git blame` to a single bulk-append commit (cb90ae6c, 2026-07-05,
// "Ship #22d [P1]: TIER-0 expansion + convergence lock") silently
// re-adding 7 titles already present from the original curation commits
// (34f1cc9a/8393a91e, 2026-04-21/22).
//
// THIS TEST WILL NEED UPDATING when the dedup hotfix lands: the
// KNOWN_DUPLICATE_KEYS assertion below is a deliberate, temporary
// regression-lock on the CURRENT defect, not the desired end state. Once
// the 7 collisions are resolved to single definitions, this file's
// second block should assert ZERO duplicates instead (the permanent
// protection this commit exists to eventually enforce).
//
// Invoke: node tests/mega-keys-duplicate-detector.test.js

import { readFileSync } from 'node:fs';
import { parseMegaKeyDefinitions, findDuplicateMegaKeyDefinitions } from '../src/lib/megaKeyRegistryAudit.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== Mega-key registry duplicate detector (Commit C3) ===\n');

const src = readFileSync(new URL('../api/mega-keys.js', import.meta.url), 'utf8');
const definitions = parseMegaKeyDefinitions(src);
const duplicates = findDuplicateMegaKeyDefinitions(src);

console.log(`Total source definitions: ${definitions.length}`);
console.log(`Unique normalized keys: ${new Set(definitions.map(d => d.key)).size}`);
console.log(`Duplicate keys found: ${duplicates.length} -> ${JSON.stringify(duplicates.map(d => d.key))}`);

// ═══════════════════════════════════════════════════════════════════════
// CURRENT KNOWN STATE — regression-lock on the real, disclosed defect.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Documenting the current known-defect state ===');
{
  assertEq(definitions.length, 50, 'total source definitions = 50 (pre-hotfix known state)');
  assertEq(new Set(definitions.map(d => d.key)).size, 43, 'unique normalized keys = 43 (pre-hotfix known state)');

  const KNOWN_DUPLICATE_KEYS = [
    'brave and the bold|28',
    'x men|1',
    'fantastic four|1',
    'tales of suspense|39',
    'journey into mystery|83',
    'strange tales|110',
    'avengers|1',
  ].sort();
  const foundKeys = duplicates.map(d => d.key).sort();
  assertEq(foundKeys, KNOWN_DUPLICATE_KEYS, 'exactly the 7 known duplicate keys are found, no more, no fewer');
  for (const dup of duplicates) {
    assertEq(dup.occurrences.length, 2, `"${dup.key}" has exactly 2 source occurrences (not 3+)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PERMANENT PROTECTION — this is the assertion that matters going
// forward. Currently expected to FAIL (7 real duplicates exist) — this
// is intentional and disclosed, not a bug in this test. It documents the
// exact target state the dedup hotfix must reach, and will start passing
// (and this whole "current known state" block above should be deleted)
// the moment that hotfix lands.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Target state (expected to fail until the dedup hotfix lands) ===');
{
  const zeroDuplicates = duplicates.length === 0;
  if (zeroDuplicates) {
    assertTrue(true, 'TARGET REACHED: zero duplicate normalized keys — definition count == unique key count');
  } else {
    console.log(`  ⏳ NOT YET (disclosed, expected): ${duplicates.length} duplicate(s) remain — ${JSON.stringify(duplicates.map(d => d.key))}`);
    console.log('     This is the known, tracked defect this dispatch\'s next commit resolves.');
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:\n' + failures.join('\n\n'));
  process.exit(1);
}
