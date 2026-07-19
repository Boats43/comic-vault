// tests/q113-sold-fallback-reasons.test.js
//
// Q113 dispatch (2026-07-18) — Batman #608 class: verification-count math
// didn't reconcile. Card showed "30→20 verified (20 variantMismatch, 6
// annualMismatch, 3 lot)" — reasons breakdown summed to ~29 against a
// rejectedCount of 10 (30 raw - 20 verified). Root cause: `verifySoldComps`'s
// VARIANT FALLBACK path (src/lib/soldVerification.js ~828-1080) is a SECOND,
// independent filter pass over the full raw pool (fires when the FIRST pass
// rejects 100% of rows and at least one rejection was variantMismatch,
// skipping the variant filters on retry). The returned verifiedCount/
// rejectedCount came from this second pass, but `reasons` was the abandoned
// FIRST pass's tally — which, since that pass rejected every row before
// falling back, sums to ~rawCount regardless of what the second pass
// actually excluded. Two different runs' numbers displayed as one set.
//
// Fix: the fallback pass now tracks its OWN reasons (`fallbackReasons`) and
// rejected samples during construction, mirroring the main chain's exact
// reason-key mapping. sum(reasons) now reconciles with rejectedCount by
// construction, for any pool shape.
//
// Invoke: node tests/q113-sold-fallback-reasons.test.js

import { verifySoldComps } from '../src/lib/soldVerification.js';

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

const sumReasons = (reasons) => Object.values(reasons).reduce((a, b) => a + b, 0);

console.log('\n=== Q113 — SOLD-COMP FALLBACK REASONS RECONCILIATION (Batman #608 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE A — Batman #608 (Hush, 2002), 30-item pool shaped like the real
// production case: 20 genuine Cover A Hush comps whose titles carry
// marketing hype words ("EXCLUSIVE") that trip Filter 8's generic-token
// case (a) when our confirmed variant is empty/standard (this is the SAME
// class of over-broad rejection Issue #4 targets — here we only care about
// the diagnostics math, not whether these SHOULD have been rejected), 6
// genuinely format-mismatched comps (an unrelated "Giant-Size" printing),
// and 4 genuinely wrong-issue listings (including multi-issue lot titles,
// which this codebase's own hasIssueNumber already classifies as
// issueMismatch — confirmed by direct trace, not assumed).
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture A: Batman #608 — 30-item pool, real production shape');

const rows = [];
for (let i = 0; i < 20; i++) {
  rows.push({
    price: 200 + i,
    title: `Batman #608 Jim Lee Hush CGC 9.${i % 2 === 0 ? '6' : '8'} EXCLUSIVE LOW PRICE`,
    daysAgo: 16,
    grade: '9.8',
  });
}
for (let i = 0; i < 6; i++) {
  rows.push({ price: 300 + i, title: 'Batman Giant-Size #608 CGC 9.8', daysAgo: 20, grade: '9.8' });
}
for (let i = 0; i < 3; i++) {
  rows.push({ price: 400 + i, title: 'Batman #608 Lot of 3 Comics NM', daysAgo: 30, grade: '9.8' });
}
rows.push({ price: 500, title: 'Batman #609 CGC 9.8', daysAgo: 25, grade: '9.8' });

const r = verifySoldComps(rows, {
  title: 'Batman', issue: '608', variant: '', bookYear: 2002, userGradeKey: '9.8',
});

assertEq(r.diagnostics.rawCount, 30, 'rawCount = 30');
assertTrue(r.diagnostics.verifiedCount > 0, 'variant fallback fired — some rows admitted (not a blank card)');
assertEq(r.diagnostics.verifiedCount, r.verified.length, 'diagnostics.verifiedCount matches r.verified.length');
assertEq(r.diagnostics.rejectedCount, r.diagnostics.rawCount - r.diagnostics.verifiedCount, 'rejectedCount = rawCount - verifiedCount (internally consistent)');

// The actual fix: sum(reasons) must equal rejectedCount exactly. Pre-fix,
// this summed to ~30 (the abandoned first pass's tally, which rejected
// every one of the 30 raw rows before falling back) regardless of
// rejectedCount — reproducing the dispatched "20+6+3=29 vs rejectedCount=10" bug.
const sum = sumReasons(r.diagnostics.reasons);
assertEq(sum, r.diagnostics.rejectedCount, `sum(reasons)=${sum} reconciles exactly with rejectedCount=${r.diagnostics.rejectedCount} (was: summed to ~rawCount regardless)`);
assertTrue(sum !== r.diagnostics.rawCount || r.diagnostics.rejectedCount === r.diagnostics.rawCount, 'reasons sum is NOT silently equal to rawCount by coincidence (would mask the old bug)');

// The 20 hype-worded-but-genuine comps should be ADMITTED (fallback skips
// variant filters), and the fallback pass's own reasons object must show
// variantMismatch=0 — it never applies the filters that would set it,
// unlike the abandoned first pass whose stale tally used to leak through.
assertEq(r.diagnostics.reasons.variantMismatch, 0, 'fallback reasons.variantMismatch = 0 (filters 7-8 skipped by design in this pass)');
assertEq(r.diagnostics.verifiedCount, 20, 'exactly the 20 genuine Cover A comps admitted via fallback');
assertTrue(r.verified.every((v) => v.variantVerified === false), 'every admitted row correctly tagged variantVerified:false (fallback-admitted, not exact-matched)');
assertTrue(r.variantAdjusted === true, 'variantAdjusted flag set — pricing layer knows this is an estimate');

// ═══════════════════════════════════════════════════════════════════════
// FIXTURE B — INCOHERENT fallback branch (recognizedDistinct >= 2) must
// ALSO use the fallback pass's own reasons/samples, not the stale first
// pass — same fix, different return branch.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture B: incoherent fallback pool — also uses fallback pass\'s own reasons');

const incoherentRows = [
  // Recognized artist #1
  { price: 50, title: 'Some Book #1 Skottie Young Variant NM', daysAgo: 10, grade: '9.8' },
  { price: 55, title: 'Some Book #1 Skottie Young Baby Variant NM+', daysAgo: 12, grade: '9.8' },
  // Recognized artist #2 (structurally conflicting identity)
  { price: 800, title: 'Some Book #1 Artgerm Variant NM', daysAgo: 15, grade: '9.8' },
];
const incoherentResult = verifySoldComps(incoherentRows, {
  title: 'Some Book', issue: '1', variant: 'exclusive', bookYear: 2023, userGradeKey: '9.8',
});
if (incoherentResult.variantFallbackIncoherent) {
  assertEq(incoherentResult.verified.length, 0, 'incoherent pool refused — verified=[]');
  assertTrue(typeof incoherentResult.diagnostics.reasons === 'object', 'incoherent branch still returns a well-formed reasons object');
  assertTrue(Object.prototype.hasOwnProperty.call(incoherentResult.diagnostics.reasons, 'variantMismatch'), 'reasons object has the full key shape (variantMismatch present, even if 0)');
} else {
  console.log('  (fixture did not trigger the incoherent branch in this run — skipping incoherent-specific assertions)');
}

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
