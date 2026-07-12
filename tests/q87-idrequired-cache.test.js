// Q87 — ID_REQUIRED enrich cache keyed to identityRevision.
//
// Weird Tales gate: refresh ×2 → exactly one enrich call, one [Q87] skip.
// The cache lifecycle: enrich returns identityConfident=false → merge
// stamps q87CheckedRevision = identityRevision → identical revision skips
// → a user identity edit bumps identityRevision → re-enrich → identity
// confident → q87CheckedRevision cleared.
//
// Invoke: node tests/q87-idrequired-cache.test.js

import { shouldSkipIdRequiredEnrich } from '../src/lib/identityGate.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// Weird Tales lifecycle replica
let item = { title: 'Weird Tales', identityConfident: false };

// Refresh 1: never enriched under Q87 (no q87CheckedRevision) → runs
check(shouldSkipIdRequiredEnrich(item) === false, 'refresh 1 runs (no checked revision yet)');

// Enrich returned ID_REQUIRED → merge stamps checked revision
item = { ...item, q87CheckedRevision: 0 };

// Refresh 2: same revision → [Q87] skip
check(shouldSkipIdRequiredEnrich(item) === true, 'refresh 2 skips (revision unchanged)');

// User edits the title → updateComicField bumps identityRevision
item = { ...item, title: 'Weird Tales of the Future', identityRevision: 1 };
check(shouldSkipIdRequiredEnrich(item) === false, 'identity edit unblocks (revision bumped)');

// Enrich runs again, still refused → re-stamped at new revision
item = { ...item, q87CheckedRevision: 1 };
check(shouldSkipIdRequiredEnrich(item) === true, 're-refused at new revision → skips again');

// Enrich succeeds → identityConfident true + checked revision cleared
item = { ...item, identityConfident: true, q87CheckedRevision: null };
check(shouldSkipIdRequiredEnrich(item) === false, 'confident identity never skips');

// Confident books never skip regardless of stale fields
check(shouldSkipIdRequiredEnrich({ identityConfident: true, q87CheckedRevision: 0 }) === false,
  'confident + stale stamp → still enriches');

// Legacy items (no Q87 fields at all) never skip
check(shouldSkipIdRequiredEnrich({ title: 'Old Book' }) === false, 'legacy item unaffected');
check(shouldSkipIdRequiredEnrich(null) === false, 'null safe');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
