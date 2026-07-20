// tests/q132-variant-year-family-corroboration.test.js
//
// Q132 dispatch (2026-07-20, GrailKey / ASM #26 "David Nakayama" class) —
// production log (POST /api/enrich, Jul 20 04:35:09) showed a book labeled
// "Amazing Spider-Man #26" (Vision/user identity, confirmedYear resolved to
// 1965 via PriceCharting id=2314995) whose eBay reverse-image-search visual
// pool carried TWO independent signals pointing to a different book — a
// 2026 David Nakayama color variant:
//
//   [cv-pool-year-hint] year=2026 agreement=75% (3/4)
//   [title-family] top family: "amazing spider man david color" (weight 15.5,
//     13/20 members) — dominant signal, discarded
//   [Q84] override-blocked reason=non-creator additions [david,color] —
//     agreed title stands
//   [variant-year-gate] suppressed: poolYearHint=2026 (75%, 4 mentions) vs
//     confirmedYear=1965, drift=61y — variant consensus skipped
//
// Both signals were independently discarded (Q84 blocked the family
// override because "david"/"color" don't classify as creator tokens —
// separate bug, tracked for Fix 2 in this same dispatch; the year-gate
// suppressed the variant computation entirely) and the card fell through to
// LIST_LOW, priced off 25 real 1965 sold comps for the base title — with no
// visibility into either discarded signal.
//
// Fix (this file): detectFamilyOverrideConflict (variantIdentity.js) detects
// when title-family clustering ALSO found a >=3-member consensus family it
// was blocked from adopting (the exact '[Q84-dual-axis]'-tagged
// 'fallback-vision' reason) — a second, independent signal agreeing with
// the year conflict. api/enrich.js wires this as
// out.variantPoolYearConflict.corroboratedByFamily and additionally sets
// listingHardLocked (price/comps stay visible per the Customer-Grade
// Standard XMEN1 ruling — only the List button gates).
// decisionEngine.js pushes a new 'variant-pool-year-conflict' warning
// whenever variantPoolYearConflict fires at all (RESEARCH floor, mirrors
// the Q129 variant-comps-unavailable precedent) — corroboration is what
// escalates further to the hard lock, wired independently in enrich.js.
//
// Regression requirement (session precedent): must NOT change behavior for
// the thin/uncorroborated cases this gate was built around — Batman #608
// (poolYearHint itself never clears its own agreement bar, so
// detectVariantPoolYearConflict is null and this new code never engages —
// confirmed already by tests/q127-variant-pool-year-conflict.test.js Part 3)
// and Catwoman #64 (variantPoolYearConflict DOES fire, but no Q84-blocked
// family exists in that case — corroboratedByFamily must stay absent, no
// hard-lock escalation from this mechanism). Eternus #2/He-Man
// (tests/q131-refused-identity-conflict-provisional.test.js) is a
// 'refused-identity-conflict' decision, not 'fallback-vision' — structurally
// excluded from detectFamilyOverrideConflict by the decision-value check.
//
// Invoke: node tests/q132-variant-year-family-corroboration.test.js

import { detectVariantPoolYearConflict, detectFamilyOverrideConflict } from '../src/lib/variantIdentity.js';
import { computeDecision, describeWarning } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q132 — VARIANT-YEAR-GATE / TITLE-FAMILY CORROBORATION (GrailKey / ASM #26 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — detectFamilyOverrideConflict: pure unit tests
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: detectFamilyOverrideConflict unit behavior\n');

assertNull(detectFamilyOverrideConflict(null), 'no familyCandidate at all → no corroboration');
assertNull(
  detectFamilyOverrideConflict({ decision: 'weighted-consensus', reason: 'Weighted consensus (5 members)', topFamily: { count: 5 } }),
  'decision is a normal accepted override, not fallback-vision → no corroboration'
);
assertNull(
  detectFamilyOverrideConflict({ decision: 'fallback-vision', reason: 'Only 4 visual results (minimum 5 required)', topFamily: null }),
  'genuinely-thin-pool fallback-vision (no Q84 tag) → no corroboration (must not fire for this shape)'
);
assertNull(
  detectFamilyOverrideConflict({ decision: 'fallback-vision', reason: 'Top family has only 2 members (need ≥3 for consensus override) — preserve Vision', topFamily: { count: 2 } }),
  'weak/insufficient-consensus fallback-vision (no Q84 tag) → no corroboration'
);
assertNull(
  detectFamilyOverrideConflict({ decision: 'refused-identity-conflict', reason: '[Q84-dual-axis] whatever', topFamily: { count: 5 } }),
  'refused-identity-conflict decision (Eternus #2/He-Man shape) → structurally excluded, no corroboration'
);

const grailKeyFamily = {
  decision: 'fallback-vision',
  selectedTitle: null,
  rawTitle: null,
  reason: '[Q84-dual-axis] non-creator additions [david,color] — Vision+eBay agree, family override blocked',
  topFamily: { title: 'amazing spider man david color', rawTitle: 'Amazing Spider-Man #26 David Nakayama Color Variant', count: 13, weightSum: 15.5 },
  runnerUp: null,
  families: [],
};
const corroboration = detectFamilyOverrideConflict(grailKeyFamily);
assertTrue(!!corroboration, 'Q84-dual-axis-tagged fallback-vision with a real topFamily → corroboration detected');
assertEq(corroboration?.topFamilyTitle, 'amazing spider man david color', 'corroboration carries the blocked family title');
assertEq(corroboration?.count, 13, 'corroboration carries the blocked family member count');
assertEq(corroboration?.weightSum, 15.5, 'corroboration carries the blocked family weight');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — End-to-end reconstruction: the real GrailKey / ASM #26 case
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: GrailKey / ASM #26 — real production log values, end-to-end call-site simulation\n');

const poolYearHint = { year: 2026, agreement: 0.75, sampleSize: 4 };
const confirmedYear = 1965;

const yearConflict = detectVariantPoolYearConflict(poolYearHint, confirmedYear);
assertTrue(!!yearConflict, 'detectVariantPoolYearConflict fires on the real pool/confirmedYear pair (61y drift)');
assertEq(yearConflict?.drift, 61, 'conflict object carries the correct 61y drift');

// Simulates the exact api/enrich.js call-site logic post-fix.
const out = {};
if (yearConflict) {
  out.variantPoolYearConflict = yearConflict;
  const familyOverrideConflict = detectFamilyOverrideConflict(grailKeyFamily);
  if (familyOverrideConflict) {
    out.variantPoolYearConflict.corroboratedByFamily = familyOverrideConflict;
    if (!out.listingHardLocked) {
      out.listingHardLocked = true;
      out.listingHardLockReason = 'variant-pool-year-conflict-corroborated';
      out.listingHardLockBanner = `Comp pool suggests a different edition (${yearConflict.poolYear} vs confirmed ${yearConflict.confirmedYear}), corroborated by an independently-blocked title match ("${familyOverrideConflict.topFamilyTitle}") — verify before listing`;
    }
  }
}

assertTrue(!!out.variantPoolYearConflict, 'POST-FIX: out.variantPoolYearConflict is set (I13 annotation)');
assertTrue(!!out.variantPoolYearConflict.corroboratedByFamily, 'POST-FIX: corroboratedByFamily is attached — two independent signals agree');
assertTrue(out.listingHardLocked === true, 'POST-FIX: listingHardLocked is set — price/comps stay visible, List button gates');
assertEq(out.listingHardLockReason, 'variant-pool-year-conflict-corroborated', 'listingHardLockReason set to the new corroborated reason');
assertTrue(/David Nakayama Color Variant|amazing spider man david color/i.test(out.listingHardLockBanner), `banner names the blocked family: "${out.listingHardLockBanner}"`);

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — decisionEngine.js: must produce RESEARCH (or a hard-locked
// state), NOT LIST_LOW/LIST_NOW, for this exact combination.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: computeDecision — GrailKey case must not ship LIST_LOW\n');

const grailKeyItem = {
  title: 'Amazing Spider-Man',
  issue: '26',
  publisher: 'Marvel',
  year: 1965,
  price: 84.41,
  pricingSource: 'verified_sold',
  rawComps: { count: 12, average: 90, lowest: 40, highest: 150 },
  soldComps: Array.from({ length: 25 }, (_, i) => ({ price: 84 + i, daysAgo: 10 + i })),
  soldCompDiagnostics: { rawCount: 25, verifiedCount: 25, rejectedCount: 0, reasons: {} },
  variantPoolYearConflict: out.variantPoolYearConflict,
  listingHardLocked: out.listingHardLocked,
  listingHardLockReason: out.listingHardLockReason,
  listingHardLockBanner: out.listingHardLockBanner,
};

const grailKeyDecision = computeDecision(grailKeyItem);
assertTrue(grailKeyDecision.action !== 'LIST_LOW', `GrailKey case does not ship LIST_LOW (got ${grailKeyDecision.action})`);
assertTrue(grailKeyDecision.action !== 'LIST_NOW', `GrailKey case does not ship LIST_NOW (got ${grailKeyDecision.action})`);
assertEq(grailKeyDecision.action, 'RESEARCH', 'GrailKey case escalates to RESEARCH');
assertTrue(grailKeyDecision.warnings.includes('variant-pool-year-conflict'), 'decision.warnings includes variant-pool-year-conflict');

const grailKeyMsg = describeWarning('variant-pool-year-conflict', grailKeyItem);
assertTrue(/2026/.test(grailKeyMsg) && /1965/.test(grailKeyMsg), `describeWarning names both years: "${grailKeyMsg}"`);
assertTrue(/amazing spider man david color/i.test(grailKeyMsg), `describeWarning names the corroborating blocked family: "${grailKeyMsg}"`);
assertTrue(grailKeyMsg !== 'variant-pool-year-conflict', 'not the raw slug');

// A price is still present — this is a LOCKED/RESEARCH caution, not a
// REFUSED wall (Customer-Grade Standard / XMEN1 ruling).
assertTrue(grailKeyItem.price != null, 'price remains visible (LOCKED, not REFUSED)');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — Regression: lone/thin conflict (no family corroboration) still
// escalates to RESEARCH via the new warning, but must NOT hard-lock.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: regression — lone/thin poolYearHint conflict (Catwoman #64 shape) escalates to RESEARCH but does not hard-lock via this mechanism\n');

// Catwoman #64 real values (tests/q127-variant-pool-year-conflict.test.js):
// poolYearHint 2024 @ 100% (6/6) vs confirmedYear 2007 — conflict fires,
// but no title-family override was ever blocked in that production case.
const catwomanYearConflict = detectVariantPoolYearConflict({ year: 2024, agreement: 1.0, sampleSize: 6 }, 2007);
assertTrue(!!catwomanYearConflict, 'Catwoman #64: year conflict still fires (unchanged from Q127)');

const catwomanFamilyConflict = detectFamilyOverrideConflict(null); // no Q84-blocked family in this production case
assertNull(catwomanFamilyConflict, 'Catwoman #64: no corroborating family override was blocked → no corroboration');

const catwomanOut = { variantPoolYearConflict: catwomanYearConflict };
if (catwomanFamilyConflict) {
  catwomanOut.variantPoolYearConflict.corroboratedByFamily = catwomanFamilyConflict;
  catwomanOut.listingHardLocked = true;
}
assertTrue(!catwomanOut.listingHardLocked, 'Catwoman #64: listingHardLocked NOT set by this mechanism (uncorroborated)');

const catwomanItem = {
  title: 'Catwoman',
  issue: '64',
  publisher: 'DC',
  year: 2007,
  price: 45,
  pricingSource: 'verified_sold',
  rawComps: { count: 5, average: 40, lowest: 20, highest: 60 },
  soldComps: Array.from({ length: 10 }, (_, i) => ({ price: 40 + i, daysAgo: 20 + i })),
  soldCompDiagnostics: { rawCount: 10, verifiedCount: 10, rejectedCount: 0, reasons: {} },
  variantPoolYearConflict: catwomanOut.variantPoolYearConflict,
};
const catwomanDecision = computeDecision(catwomanItem);
assertEq(catwomanDecision.action, 'RESEARCH', 'Catwoman #64: still escalates to RESEARCH (new, intentional — RESEARCH minimum per Q132 spec) via variant-pool-year-conflict alone');
assertTrue(!catwomanItem.listingHardLocked, 'Catwoman #64: not hard-locked — price/comps/behavior otherwise unchanged from Q127');

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — Regression: Batman #608 shape never engages this gate at all
// (poolYearHint itself is null in production for that pool shape — see
// tests/q127-variant-pool-year-conflict.test.js Part 3).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: regression — Batman #608 shape (no poolYearHint) never engages this gate\n');

assertNull(detectVariantPoolYearConflict(null, 2002), 'Batman #608: no poolYearHint → detectVariantPoolYearConflict inert, exactly as Q127 left it');
const batmanItem = {
  title: 'Batman',
  issue: '608',
  publisher: 'DC',
  year: 2002,
  price: 175,
  pricingSource: 'verified_sold',
  rawComps: { count: 8, average: 180, lowest: 100, highest: 260 },
  soldComps: Array.from({ length: 15 }, (_, i) => ({ price: 170 + i, daysAgo: 5 + i })),
  soldCompDiagnostics: { rawCount: 15, verifiedCount: 15, rejectedCount: 0, reasons: {} },
  // variantPoolYearConflict intentionally absent — matches production
};
const batmanDecision = computeDecision(batmanItem);
assertTrue(!batmanDecision.warnings.includes('variant-pool-year-conflict'), 'Batman #608: no variant-pool-year-conflict warning (field absent, as in production)');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
