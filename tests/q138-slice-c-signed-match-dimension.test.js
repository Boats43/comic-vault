// tests/q138-slice-c-signed-match-dimension.test.js
//
// Slice C (2026-07-22, Poison Ivy #31 / Giang MegaCon Secret Drop class) —
// signed/autographed promoted from a pure reject filter to a match
// DIMENSION on both the active-comp side (api/comps.js Filter 2b) and the
// sold-comp side (soldVerification.js step 10).
//
// Two real production cases:
//   - Poison Ivy #31: 4 signed Jenny Frison active comps ($29.75-$36) exist
//     in the raw pool, but the pre-Slice-C gate only ever SKIPPED rejecting
//     them when isOurBookSigned — it never ISOLATED to them, so they stayed
//     blended with an unsigned $3.49 sold comp, averaging to $12.25 (below
//     floor, contract-violation lock).
//   - One World Under Doom / Giang MegaCon Secret Drop: log showed
//     "[signed-filter] SS listing rejected: ..." — the signed Giang comps
//     were hard-REJECTED because isOurBookSigned evaluated false. Root
//     cause: Vision's own comic prompt (api/grade.js) is deliberately
//     barred from writing signing status into variant text for a RAW book
//     ("Do NOT include signing or autograph status... must not appear in
//     this field") — so for this exact class of book, the pool-consensus
//     signal (extractConfirmedVariant's new signedConsensus, Slice C) is
//     the ONLY available source. This is the "(Vision or pool)" framing
//     from the design ruling: Vision's own free-text variant covers one
//     case (Poison Ivy #31), pool consensus covers the other (Giang
//     MegaCon), and both need to reach isOurBookSigned.
//
// Invoke: node tests/q138-slice-c-signed-match-dimension.test.js

import { applySignedPreferenceFilter } from '../api/comps.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';
import { extractConfirmedVariant } from '../src/lib/variantIdentity.js';
import { COMP_FILTER_VERSION } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Slice C — signed as a match dimension (active + sold) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — applySignedPreferenceFilter (active side), Poison Ivy #31 real
// pool shape: 4 signed Frison actives + 1 unsigned listing.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: active side — applySignedPreferenceFilter\n');

const poisonIvyActivePool = [
  { title: 'Poison Ivy #31 Variant Signed by Jenny Frison 2025 w/COA..', price: 29.75 },
  { title: 'Poison Ivy #31 Variant Cover B SIGNED by Jenny Frison WITH COA 2025 NM', price: 36.0 },
  { title: 'Poison Ivy #31 Signed By Jennie Frison With Coa', price: 32.5 },
  { title: 'Poison Ivy #31 Signed Jenny Frison Variant COA Authenticated', price: 30.0 },
  { title: 'Poison Ivy #31 Standard Cover NM', price: 3.99 }, // unsigned — should be dropped when our book is signed
];

{
  const result = applySignedPreferenceFilter(poisonIvyActivePool, true);
  assertTrue(result.isolated, 'Poison Ivy #31 (our book signed): isolated=true');
  assertEq(result.pool.length, 4, 'Poison Ivy #31 (our book signed): isolates to exactly the 4 signed Frison comps');
  assertFalse(result.pool.some((it) => it.title.includes('Standard Cover')), 'Poison Ivy #31 (our book signed): unsigned $3.99 standard-cover comp dropped');
}

{
  // Control: our book NOT signed — unchanged reject-only behavior (Ship #13 Bug 3, byte-identical).
  const result = applySignedPreferenceFilter(poisonIvyActivePool, false);
  assertFalse(result.isolated, 'control (our book NOT signed): isolated=false');
  assertEq(result.pool.length, 1, 'control (our book NOT signed): rejects all 4 signed comps, keeps only the unsigned one');
  assertEq(result.signedRejectedCount, 4, 'control (our book NOT signed): signedRejectedCount=4');
}

{
  // Fallback: our book signed, but zero signed comps in the pool — keep all (prefer weak comp over no comp).
  const noSignedPool = [{ title: 'Poison Ivy #31 Standard Cover NM', price: 3.99 }];
  const result = applySignedPreferenceFilter(noSignedPool, true);
  assertFalse(result.isolated, 'fallback (signed book, zero signed comps): isolated=false');
  assertEq(result.pool.length, 1, 'fallback (signed book, zero signed comps): keeps full pool rather than starving to zero');
}

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — extractConfirmedVariant's signedConsensus (pool signal), Giang
// MegaCon Secret Drop real pool shape.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: pool-consensus signal — extractConfirmedVariant signedConsensus\n');

const giangPoolItems = [
  { rawTitle: 'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM' },
  { rawTitle: 'ONE WORLD UNDER DOOM #1 John Giang Signed with COA Megacon 2025 Secret Drop' },
  { rawTitle: 'One World Under Doom #1 John Giang MegaCon Secret Drop Signed Remarked LTD 500' },
  { rawTitle: 'One World Under Doom #1 John Giang MegaCon Exclusive Virgin (unsigned)' },
];

{
  const result = extractConfirmedVariant(giangPoolItems, null, '2025', 'low');
  assertTrue(result?.signedConsensus === true, 'Giang MegaCon pool: signedConsensus=true (3/4 listings mention signed/COA/remarked)');
}

{
  // Control: a pool with fewer than 2 authentication mentions must not fire consensus.
  const mostlyUnsignedPool = [
    { rawTitle: 'One World Under Doom #1 John Giang MegaCon Exclusive Virgin' },
    { rawTitle: 'One World Under Doom #1 John Giang MegaCon Exclusive Virgin LTD 500' },
    { rawTitle: 'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED w/COA' },
  ];
  const result = extractConfirmedVariant(mostlyUnsignedPool, null, '2025', 'low');
  assertFalse(result?.signedConsensus === true, 'control: only 1/3 mentions signed — consensus does NOT fire (needs >=2)');
}

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — verifySoldComps (sold side): same isolate-with-fallback
// treatment must apply, or the blend keeps dragging a signed book toward
// an unsigned price (the exact Poison Ivy #31 failure mode: 4 signed
// actives + 1 unsigned SOLD comp averaging below floor).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: sold side — verifySoldComps isolate-with-fallback\n');

const poisonIvySoldRows = [
  { title: 'Poison Ivy #31 Variant Signed by Jenny Frison 2025 w/COA', price: 32.0, daysAgo: 10, grade: 'NM' },
  { title: 'Poison Ivy #31 Standard Cover', price: 3.49, daysAgo: 5, grade: 'NM' }, // unsigned — should be excluded when our book is signed
];

{
  const ctx = {
    title: 'Poison Ivy',
    issue: '31',
    variant: 'Variant Signed by Jenny Frison', // Vision's own free-text call includes "signed" for this scan
    bookYear: '2025',
  };
  const result = verifySoldComps(poisonIvySoldRows, ctx);
  assertEq(result.verified.length, 1, 'Poison Ivy #31 (Vision-signed variant text): isolates to the 1 signed sold comp');
  assertTrue(result.verified.every((r) => /signed/i.test(r.title)), 'Poison Ivy #31: unsigned $3.49 sold comp excluded from the verified pool');
}

{
  // Same pool, but the "our book is signed" signal comes from the POOL
  // (ctx.signedConsensus), not Vision's own variant text — the Giang
  // MegaCon shape, reconstructed against a generic sold pool to prove the
  // ctx.signedConsensus path independently of ctx.labelType/variant regex.
  const ctx = {
    title: 'Poison Ivy',
    issue: '31',
    variant: null, // Vision wrote nothing — pool consensus is the only source
    bookYear: '2025',
    signedConsensus: true,
  };
  const result = verifySoldComps(poisonIvySoldRows, ctx);
  assertEq(result.verified.length, 1, 'ctx.signedConsensus path: isolates to the 1 signed sold comp with no Vision variant text at all');
}

{
  // Control: our book NOT signed — unchanged reject-only behavior.
  const ctx = {
    title: 'Poison Ivy',
    issue: '31',
    variant: null,
    bookYear: '2025',
  };
  const result = verifySoldComps(poisonIvySoldRows, ctx);
  assertEq(result.verified.length, 1, 'control (not signed): rejects the signed comp, keeps only the unsigned one');
  assertFalse(result.verified.some((r) => /signed/i.test(r.title)), 'control (not signed): signed comp excluded, byte-identical to pre-Slice-C behavior');
}

{
  // Fallback: our book signed, but zero signed sold comps — keep the full working set.
  const onlyUnsignedRows = [
    { title: 'Poison Ivy #31 Standard Cover', price: 3.49, daysAgo: 5, grade: 'NM' },
  ];
  const ctx = {
    title: 'Poison Ivy',
    issue: '31',
    variant: 'Variant Signed by Jenny Frison',
    bookYear: '2025',
  };
  const result = verifySoldComps(onlyUnsignedRows, ctx);
  assertEq(result.verified.length, 1, 'fallback (signed book, zero signed sold comps): keeps the unsigned comp rather than starving to zero');
}

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — comp-filter cache version bump closes the stale-cache-replay
// gap (same class as Q129/Q131's precedent, same exact book: One World
// Under Doom #1 rescanned on the Slice-C build still replayed the pre-fix
// `ac:v5:one world under doom|1` entry — the real signed Giang pool never
// got a chance to run through applySignedPreferenceFilter).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: comp-filter cache version bump closes the stale-cache-replay gap\n');

{
  // >= rather than === so a later dispatch bumping this same shared
  // constant again doesn't need to come back and edit this assertion too.
  assertTrue(COMP_FILTER_VERSION >= 6, `COMP_FILTER_VERSION is >= 6 (got ${COMP_FILTER_VERSION}) — Slice C's signed-match-dimension change alters which comps Filter 2b admits, same class as Q129/Q131's cache-busting bumps`);
  const oldKey = `v5:one world under doom|1`;
  const newKey = `v${COMP_FILTER_VERSION}:one world under doom|1`;
  assertTrue(oldKey !== newKey, 'the active-comp cache key changes with the version bump — the real pre-Slice-C v5: entry that masked this fix live is unreachable under the new key, forcing a fresh fetchComps pass');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
}
console.log('━'.repeat(59));
// api/comps.js leaves an open handle at module load (confirmed independent
// of this test — importing it alone hangs the process too); force exit
// rather than waiting on an event loop that never drains, matching the
// convention every other test file that imports api/comps.js already uses
// (e.g. tests/comp-filter-hygiene.test.js).
process.exit(failed === 0 ? 0 : 1);
