// tests/grailkey-directive-t-task3-identity-authority.test.js
//
// GrailKey Directive T, Task 3 (GK-85) — the live defect: manual
// correction has never held durably. `mergeConfirmedIdentity` had zero
// awareness of whether the current stored value was ever operator-
// corrected, so the NEXT routine automatic enrich (a plain rescan,
// auto-refresh, bulk re-import) silently overwrote it. `out.manualCorrection`
// (api/enrich.js:10880) is write-only — grep-confirmed zero read sites —
// a historical audit record, never an authority gate.
//
// Fix: `identityAuthority`, a per-field facet -> 'OPERATOR_CONFIRMED' map,
// carried through the same presence-aware merge layer Directive Q already
// established for the identity values themselves (mergeIdentityAuthority,
// src/lib/dataQualityGuard.js). mergeConfirmedIdentity now consults it
// before accepting a fresh automatic value for any locked facet.
// buildCorrectedCatalogueItem (src/lib/manualCorrection.js) merges it the
// same way, since its raw `{...cleared, ...enrichData}` spread would
// otherwise wholesale-replace the whole map with only this correction's
// newly-locked field(s), dropping any earlier correction's locks.
//
// All tests call the real, exported, pure functions directly — DIRECT,
// not mirrored. These are genuinely unit-testable (no network, no DOM).
//
// Invoke: node tests/grailkey-directive-t-task3-identity-authority.test.js

import { mergeConfirmedIdentity, mergeIdentityAuthority } from '../src/lib/dataQualityGuard.js';
import { buildCorrectedCatalogueItem } from '../src/lib/manualCorrection.js';

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

console.log('\n=== GrailKey Directive T, Task 3 (GK-85) — per-field identity authority ===\n');

// ═══════════════════════════════════════════════════════════════════════
// THE ACCEPTANCE CASE — the reason per-field, not per-item, was chosen.
// ═══════════════════════════════════════════════════════════════════════
console.log('The acceptance case: locked facets hold, unlocked facets still fill\n');
{
  const prior = {
    title: 'Sabrina Annual Spectacular #1',
    issue: '1',
    year: null, // unresolved — no lock
    publisher: 'Archie Comics',
    variant: 'Dan Parent NYCC variant',
    identityAuthority: { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED' },
  };
  // A fresh, ordinary automatic enrich response — conflicting title/issue,
  // AND a genuinely new year from catalog corroboration.
  const freshEnrich = {
    title: 'Sabrina the Teenage Witch #1', // conflicts with locked title
    issue: '1', // agrees, but would still be "accepted" under the old rule
    year: 2024, // year carries no lock — must still be accepted
    publisher: 'Archie Comics',
    variantNote: 'some different automatic guess',
  };

  const merged = mergeConfirmedIdentity(freshEnrich, prior);

  assertEq(merged.title, 'Sabrina Annual Spectacular #1', 'title: OPERATOR_CONFIRMED lock holds against a conflicting automatic value');
  assertEq(merged.issue, '1', 'issue: OPERATOR_CONFIRMED lock holds (still correct value, but held BY the lock, not by coincidence)');
  assertEq(merged.year, 2024, 'year: NO lock -> fresh automatic value (2024) is accepted, exactly as today');
  assertEq(merged.identityAuthority, { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED' }, 'authority map itself survives the merge unchanged (no identityAuthority on this response)');

  console.log('  (per-field confirmed: a whole-item lock would have made this partial-correction case WORSE than today\'s behavior — this is why Directive T chose per-field)');
}

// ═══════════════════════════════════════════════════════════════════════
// Test 1 — manual correction survives a later automatic enrich (the live
// defect, proven both broken pre-fix in spirit and fixed post-fix).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 1: manual correction survives a later, unrelated automatic enrich\n');
{
  // Step 1: a manual correction happens (mirrors what api/enrich.js now
  // does — out.identityAuthority set from validation.acceptedFields).
  const afterCorrection = {
    title: 'Sabrina Annual Spectacular #1',
    issue: '1',
    year: 2024,
    publisher: 'Archie Comics',
    variant: 'Dan Parent NYCC variant',
    identityAuthority: { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED', year: 'OPERATOR_CONFIRMED', publisher: 'OPERATOR_CONFIRMED' },
  };

  // Step 2: a LATER, ordinary rescan (no manualAuthority at all) returns a
  // completely different automatic guess for every field.
  const laterAutomaticEnrich = {
    title: 'Sabrina the Teenage Witch',
    issue: '1',
    year: 1997,
    publisher: 'Archie Comics',
    variantNote: null,
    // No identityAuthority key at all — an ordinary automatic response
    // never sets one.
  };

  const merged = mergeConfirmedIdentity(laterAutomaticEnrich, afterCorrection);

  assertEq(merged.title, 'Sabrina Annual Spectacular #1', 'title survives the later automatic rescan');
  assertEq(merged.issue, '1', 'issue survives (locked, though this response agreed anyway)');
  assertEq(merged.year, 2024, 'year survives (locked) -- NOT overwritten by the later automatic 1997 guess');
  assertEq(merged.publisher, 'Archie Comics', 'publisher survives (locked)');
  assertEq(merged.identityAuthority, afterCorrection.identityAuthority, 'the authority map itself survives unchanged (later response never mentioned identityAuthority)');
}

// ═══════════════════════════════════════════════════════════════════════
// Test 2 — authority carrier: absent preserves.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 2: authority carrier -- absent key preserves prior authority\n');
{
  const prior = { identityAuthority: { title: 'OPERATOR_CONFIRMED' } };
  const enrichWithoutKey = { title: 'whatever' }; // no identityAuthority key
  const result = mergeIdentityAuthority(enrichWithoutKey, prior);
  assertEq(result, { title: 'OPERATOR_CONFIRMED' }, 'authority map unchanged when the response never mentions identityAuthority');
}

// ═══════════════════════════════════════════════════════════════════════
// Test 3 — authority carrier: explicit null clears.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 3: authority carrier -- explicit null clears that facet\'s lock\n');
{
  const prior = { identityAuthority: { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED' } };
  const enrichRevoking = { identityAuthority: { title: null } }; // explicit revocation of title only
  const result = mergeIdentityAuthority(enrichRevoking, prior);
  assertEq(result, { issue: 'OPERATOR_CONFIRMED' }, 'title\'s lock is cleared (key removed), issue\'s lock untouched -- per-field, not whole-map clearing');
  assertTrue(!Object.prototype.hasOwnProperty.call(result, 'title'), 'title is genuinely absent from the result, not merely null (own-property check)');
}

// ═══════════════════════════════════════════════════════════════════════
// Test 8 (shared with Task 5's numbering) — reload durability: authority
// and corrected facets both reconstruct unchanged through
// buildCorrectedCatalogueItem, the actual persistence-boundary function.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest 8: reload durability -- buildCorrectedCatalogueItem persists identityAuthority correctly\n');
{
  // oldItem already carries a lock from an EARLIER correction (issue).
  const oldItem = {
    id: 'x1',
    title: 'Some Title',
    issue: '1',
    year: null,
    publisher: null,
    variant: null,
    identityAuthority: { issue: 'OPERATOR_CONFIRMED' },
    status: 'kept',
  };
  // This correction sets title only (matches Task 3's server-side
  // contract: out.identityAuthority = only the fields in acceptedFields).
  const enrichData = {
    title: 'Sabrina Annual Spectacular #1',
    issue: '1',
    variantNote: 'Dan Parent NYCC variant',
    identityAuthority: { title: 'OPERATOR_CONFIRMED' },
  };

  const persisted = buildCorrectedCatalogueItem(oldItem, enrichData);

  assertEq(
    persisted.identityAuthority,
    { issue: 'OPERATOR_CONFIRMED', title: 'OPERATOR_CONFIRMED' },
    'both the earlier correction\'s lock (issue) AND this correction\'s new lock (title) survive together -- the raw spread would have dropped issue'
  );
  assertEq(persisted.title, 'Sabrina Annual Spectacular #1', 'the corrected title itself is present');
  assertEq(persisted.variant, 'Dan Parent NYCC variant', 'variant repopulated from enrichData.variantNote (Directive Q\'s fix, unaffected by this dispatch)');
  assertEq(persisted.id, 'x1', 'id still pinned to oldItem.id');

  // Simulate the actual "reload, then a later automatic rescan" sequence
  // end to end: the persisted item (as if freshly loaded from IndexedDB)
  // feeds a subsequent mergeConfirmedIdentity call for an ordinary rescan.
  const subsequentAutomaticEnrich = { title: 'A Completely Different Guess', issue: '99' };
  const afterReload = mergeConfirmedIdentity(subsequentAutomaticEnrich, persisted);
  assertEq(afterReload.title, 'Sabrina Annual Spectacular #1', 'after reload, a later automatic rescan still cannot override the persisted title lock');
  assertEq(afterReload.issue, '1', 'after reload, a later automatic rescan still cannot override the persisted issue lock');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
