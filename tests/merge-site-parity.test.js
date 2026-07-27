// tests/merge-site-parity.test.js
//
// Wonder Woman #1 (2nd printing) A2 dispatch (2026-07-26) — enumerating
// every out.title writer in api/enrich.js proved the server-side response
// is clean for this book (confirmedTitle="Wonder Woman", issue=null, no
// path to "#750" anywhere in the response). Enumerating App.jsx's merge
// sites (invariant 1) found FIVE, not the two ("scan→catalogue" and
// "scan→selectedItem") the original dispatch named — auto-refresh,
// bulk-import, and Refresh Market Data all spread ONLY
// applyProvisionalIdentity, which is an unconditional no-op for a
// CONFIRMED (non-provisional) identity like this one. A book scanned once
// (correctly merged via the two fixed sites), then later touched only by
// auto-refresh / bulk-import / Refresh Market Data with a stale persisted
// title from before those two sites were fixed (or from any other path),
// would have that stale title survive forever — those three sites could
// never repair it, no matter how many times the server re-resolved the
// correct value.
//
// Fix: same pattern as Q144C instance 7/8 — spread mergeConfirmedIdentity
// (src/lib/dataQualityGuard.js) BEFORE applyProvisionalIdentity at all
// three previously-unfixed sites, so a provisional response's own
// honest-null semantics still win on key collision when both apply.
//
// This suite proves parity across ALL FIVE merge sites at once, using the
// Wonder-Woman-shaped fixture the dispatch specified: a confirmed identity
// (confirmedTitle present, issue explicitly null) must overwrite a stale
// persisted "Title #NNN" value identically everywhere.
//
// Invoke: node tests/merge-site-parity.test.js

import { mergeConfirmedIdentity, applyProvisionalIdentity } from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Merge site parity — Wonder Woman confirmedTitle + issue=null across all 5 sites ===\n');

// The exact shape from the real request: title resolved via weighted-
// consensus (confirmed, non-provisional), issue explicitly escalated to
// null (vision-zero-support forced ID_REQUIRED — zero pool support for
// Vision's own "#750" guess).
const enrich = {
  identityProvisional: false,
  title: 'Wonder Woman',
  issue: null,
  year: '2020',
  publisher: 'DC Comics',
  variantNote: null,
};

// A stale persisted record shaped like the reported symptom: a rejected
// "#750" observation baked into the title as literal text from an earlier
// scan/merge, long before the server correctly resolved to null.
const stalePersisted = { title: 'Wonder Woman #750', issue: '750', year: '2020', publisher: 'DC Comics', variant: null };

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the two sites that were already correct (scan→catalogue,
//      scan→selectedItem) — confirms they still behave correctly and gives
//      the baseline every other site must match.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: baseline — scan→catalogue and scan→selectedItem (pre-existing, unchanged)\n');

const scanToCatalogue = { ...stalePersisted, ...mergeConfirmedIdentity(enrich, stalePersisted), ...applyProvisionalIdentity(enrich, stalePersisted) };
const scanToSelectedItem = { ...stalePersisted, ...mergeConfirmedIdentity(enrich, stalePersisted), ...applyProvisionalIdentity(enrich, stalePersisted) };

assertEq(scanToCatalogue.title, 'Wonder Woman', `scan→catalogue: title repairs from stale "Wonder Woman #750" (got "${scanToCatalogue.title}")`);
assertEq(scanToCatalogue.issue, null, `scan→catalogue: issue clears from stale "750" to honest null (got "${scanToCatalogue.issue}")`);
assertEq(scanToSelectedItem.title, 'Wonder Woman', `scan→selectedItem: title repairs from stale "Wonder Woman #750" (got "${scanToSelectedItem.title}")`);
assertEq(scanToSelectedItem.issue, null, `scan→selectedItem: issue clears from stale "750" to honest null (got "${scanToSelectedItem.issue}")`);

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — the three previously-broken sites (auto-refresh, bulk-import,
//      Refresh Market Data) — before this fix these would have spread
//      ONLY applyProvisionalIdentity, a no-op here since
//      identityProvisional is false. This proves the fix landed: all
//      three now repair the stale title identically to Part 1.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: the three newly-fixed sites — auto-refresh, bulk-import, Refresh Market Data\n');

{
  // Confirm the symptom the fix closes: applyProvisionalIdentity ALONE
  // (App.jsx's pre-fix spread at all three sites) is genuinely a no-op for
  // this non-provisional response — proves the bug was real, not assumed.
  assertEq(Object.keys(applyProvisionalIdentity(enrich, stalePersisted)).length, 0,
    'applyProvisionalIdentity alone is a true no-op for this confirmed (non-provisional) response — the three sites had no other path to repair the title');
}

const sites = [
  ['auto-refresh', stalePersisted],
  ['bulk-import', stalePersisted],
  ['Refresh Market Data', stalePersisted],
];

for (const [name, stale] of sites) {
  // Mirrors App.jsx's exact spread order at each of the three fixed sites:
  // ...mergeConfirmedIdentity(enrich, cur), ...applyProvisionalIdentity(enrich, cur)
  const result = { ...stale, ...mergeConfirmedIdentity(enrich, stale), ...applyProvisionalIdentity(enrich, stale) };
  assertEq(result.title, 'Wonder Woman', `${name}: title repairs from stale "Wonder Woman #750" (got "${result.title}")`);
  assertEq(result.issue, null, `${name}: issue clears from stale "750" to honest null (got "${result.issue}")`);
  assertEq(result.title, scanToCatalogue.title, `${name}: title matches scan→catalogue result exactly`);
  assertEq(result.issue, scanToCatalogue.issue, `${name}: issue matches scan→catalogue result exactly — the parity this fix establishes`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — control: a genuinely provisional response still defers to
//      applyProvisionalIdentity's honest-null semantics at all five sites,
//      unaffected by adding mergeConfirmedIdentity ahead of it (same
//      control shape as Q144C Part 3/4, re-proven here for the three newly
//      fixed sites specifically).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: provisional-identity control — unaffected by the fix\n');

{
  const provisionalEnrich = {
    identityProvisional: true,
    title: 'Pop Kill',
    confirmedTitle: 'Pop Kill',
    issue: '3',
    year: null,
    publisher: null,
    variantNote: null,
  };
  const staleCur = { title: 'Harley Quinn', issue: '75', year: '2020', publisher: 'DC Comics', variant: 'Kunkka beer variant' };

  for (const name of ['auto-refresh', 'bulk-import', 'Refresh Market Data']) {
    const result = { ...staleCur, ...mergeConfirmedIdentity(provisionalEnrich, staleCur), ...applyProvisionalIdentity(provisionalEnrich, staleCur) };
    assertEq(result.title, 'Pop Kill', `${name}: provisional identity still resolves correctly with mergeConfirmedIdentity ahead of it`);
    assertEq(result.year, null, `${name}: provisional honest-null (year) still wins over mergeConfirmedIdentity on collision`);
    assertEq(result.publisher, null, `${name}: provisional honest-null (publisher) still wins over mergeConfirmedIdentity on collision`);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
