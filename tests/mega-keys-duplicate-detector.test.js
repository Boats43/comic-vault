// tests/mega-keys-duplicate-detector.test.js
//
// Pricing Trust — Commit C3 (shipped standalone, 2026-09-23, commit
// 91f0cbb) + Commit C dedupe (2026-09-23). Deterministic source-level
// coverage for api/mega-keys.js's MEGA_KEYS_FLOOR object literal:
// JavaScript object-literal last-write-wins semantics must never again
// silently decide pricing authority.
//
// HISTORY: this file originally locked in the real, disclosed defect
// state (50 source definitions, 43 unique keys, 7 duplicate collisions —
// "brave and the bold|28", "x men|1", "fantastic four|1", "tales of
// suspense|39", "journey into mystery|83", "strange tales|110",
// "avengers|1" — all 7 traced via `git blame` to a single bulk-append
// commit, cb90ae6c, 2026-07-05, silently re-adding titles already present
// from the original curation commits, 34f1cc9a/8393a91e, 2026-04-21/22).
// The dedupe hotfix has now landed: 4 collisions (the Heritage-anchored
// ones) resolved by removing the shadowing unverified duplicate and
// retaining the better-evidenced entry with corrected wording; 3
// collisions (unverified-vs-unverified: x men|1, strange tales|110,
// avengers|1) resolved by retaining the previously-live definition as a
// behavior-preserving dedupe, protected going forward by the separate
// divergence-disclosure mechanism (tests/pricing-trust-commit-c.test.js),
// not by this file. This file now asserts the PERMANENT target state.
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

console.log('\n=== Mega-key registry duplicate detector (permanent protection) ===\n');

const src = readFileSync(new URL('../api/mega-keys.js', import.meta.url), 'utf8');
const definitions = parseMegaKeyDefinitions(src);
const duplicates = findDuplicateMegaKeyDefinitions(src);

console.log(`Total source definitions: ${definitions.length}`);
console.log(`Unique normalized keys: ${new Set(definitions.map(d => d.key)).size}`);
console.log(`Duplicate keys found: ${duplicates.length} -> ${JSON.stringify(duplicates.map(d => d.key))}`);

// ═══════════════════════════════════════════════════════════════════════
// PERMANENT PROTECTION — the assertion that matters going forward.
// Definition count MUST equal unique normalized-key count. Fails hard on
// any future duplicate, by construction (source-level parsing, not the
// already-collapsed live object — see src/lib/megaKeyRegistryAudit.js's
// own header for why that distinction matters).
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Target state (now permanent) ===');
{
  assertEq(duplicates, [], 'zero duplicate normalized keys');
  assertEq(definitions.length, new Set(definitions.map(d => d.key)).size, 'definition count == unique normalized-key count');
  assertEq(definitions.length, 43, 'total definitions = 43 (post-dedupe: was 50, 7 collisions resolved to single definitions each)');

  // The 7 formerly-colliding keys must still exist exactly once each —
  // dedupe must never have accidentally deleted a title entirely.
  const RESOLVED_KEYS = [
    'brave and the bold|28', 'x men|1', 'fantastic four|1',
    'tales of suspense|39', 'journey into mystery|83',
    'strange tales|110', 'avengers|1',
  ];
  const keyCounts = {};
  for (const d of definitions) keyCounts[d.key] = (keyCounts[d.key] || 0) + 1;
  for (const key of RESOLVED_KEYS) {
    assertEq(keyCounts[key], 1, `"${key}" exists exactly once (dedupe resolved the collision, did not delete the title)`);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:\n' + failures.join('\n\n'));
  process.exit(1);
}
