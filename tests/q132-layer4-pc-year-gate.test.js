// tests/q132-layer4-pc-year-gate.test.js
//
// Q132 dispatch (2026-07-20, GrailKey / ASM #26 class), Layer 4 —
// PriceCharting's own title-matcher gap. Traced directly from the real
// production log (build ddd95db, 21:07:21, deployment
// dpl_J1ha5bNJrk1uvrUraHdp7nmdp3i2):
//
//   [pt] matched: "Amazing Spider-Man #26 (2001)" year: 2001 comic year: null
//   [pc-query] initial PC match "Amazing Spider-Man #26 (2001)" already
//     overlaps confirmedTitle "amazing spider man david color" sufficiently
//     — keeping initial result
//   [ship28a] PC anchors: id=2367113 name="Amazing Spider-Man #26 (2001)"
//   [pc-pop-calibrate] id=2367113 total=52 cgc=[...]
//   [pc-sales] id=2367113 grades=4 userGrade=raw soldComps=29 ladder=10 ...
//
// Root cause: lookupPriceCharting's query ran with comicYear=null (Vision
// never read a year off this cover), so its own year-validation block
// (`if (comicYear) {...}`) never executed at all — it accepted the first
// title/issue-token match regardless of year. The one re-validation gate
// that runs afterward (needsRequery / titleOverlapsProduct) is purely
// textual, no year check. Result: floor/ladder/population/chart data all
// anchored to a real but WRONG PriceCharting product (a 2001 vol.2 #26),
// contaminating the card even though the book is a confirmed 2026 variant.
//
// Fix: pcMatchConflictsWithPoolYear (variantIdentity.js) — once a
// confirmed family override has established poolYearHint as trustworthy
// (yearConflictResolvedByFamily, Layers 1+2), re-validate the ALREADY-
// ACCEPTED PC match's own year against poolYearHint. Reject outright
// (priceCharting = null, plus clearing the out.pc* fields Ship #28a
// already populated before this gate had the information to reject them)
// — not a "keep nearest fuzzy hit" demotion. No new fallback needed:
// fetchPricechartingPop/fetchPricechartingSales are already gated on
// priceCharting?.id, and Tier 3 active-comps-only anchoring is already
// proven working in this exact production log once no PC anchor exists.
//
// Deliberately narrow: gated on yearConflictResolvedByFamily alone.
// Batman #608 (no poolYearHint at all), Catwoman #64 (conflict fires, but
// no confirmed family override in that production case), and Eternus #2/
// He-Man ('refused-identity-conflict' decision, not in
// FAMILY_OVERRIDE_DECISIONS) never reach this gate — priceCharting
// acceptance for them is untouched.
//
// Invoke: node tests/q132-layer4-pc-year-gate.test.js

import { pcMatchConflictsWithPoolYear } from '../src/lib/variantIdentity.js';
import { FAMILY_OVERRIDE_DECISIONS } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q132 Layer 4 — PC-matcher year-conflict gate ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — pcMatchConflictsWithPoolYear: pure unit tests
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: pcMatchConflictsWithPoolYear unit behavior\n');

assertFalse(pcMatchConflictsWithPoolYear(null, { year: 2026 }), 'no PC year at all → no conflict (nothing to check)');
assertFalse(pcMatchConflictsWithPoolYear(2001, null), 'no poolYearHint → no conflict (nothing to check against)');
assertFalse(pcMatchConflictsWithPoolYear(2024, { year: 2026 }), 'PC year within tolerance (2y) of poolYearHint → no conflict');
assertFalse(pcMatchConflictsWithPoolYear(2021, { year: 2026 }), 'PC year exactly at tolerance boundary (5y) → no conflict');
assertTrue(pcMatchConflictsWithPoolYear(2001, { year: 2026 }), 'the real GrailKey case: PC year 2001 vs poolYearHint 2026 (25y drift) → conflict');
assertTrue(pcMatchConflictsWithPoolYear('2001', { year: 2026 }), 'string PC year is parsed correctly');
assertFalse(pcMatchConflictsWithPoolYear('not-a-year', { year: 2026 }), 'unparseable PC year → no conflict (fails safe, does not crash)');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — End-to-end reconstruction: the real GrailKey / ASM #26 case
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: GrailKey / ASM #26 — real production values, end-to-end call-site simulation\n');

// Mirrors the exact api/enrich.js call-site logic (Layer 4).
function simulateLayer4({ priceCharting, poolYearHint, familyCandidateDecision }) {
  const out = {
    pcProductId: priceCharting?.id ?? null,
    pcProductName: priceCharting?.productName ?? null,
    pcEbayEpid: null,
    pcLastUpdated: null,
    pcLoosePrice: priceCharting?.price ?? null,
    pcGradedPrice: null,
  };
  const yearConflictResolvedByFamily = !!poolYearHint && FAMILY_OVERRIDE_DECISIONS.includes(familyCandidateDecision);
  let pc = priceCharting;
  if (yearConflictResolvedByFamily && pc) {
    const conflict = pcMatchConflictsWithPoolYear(pc.year, poolYearHint);
    if (conflict) {
      out.pcMatchRejectedForYearConflict = {
        rejectedProductName: pc.productName,
        rejectedProductId: pc.id,
        rejectedYear: pc.year,
        poolYearHint: poolYearHint.year,
      };
      out.pcProductId = null;
      out.pcProductName = null;
      out.pcEbayEpid = null;
      out.pcLastUpdated = null;
      out.pcLoosePrice = null;
      out.pcGradedPrice = null;
      pc = null;
    }
  }
  return { out, priceCharting: pc };
}

const grailKeyPC = { id: 2367113, productName: 'Amazing Spider-Man #26 (2001)', year: 2001, price: 12.5 };
const grailKeyPoolYearHint = { year: 2026, agreement: 0.75, sampleSize: 4 };

const r1 = simulateLayer4({ priceCharting: grailKeyPC, poolYearHint: grailKeyPoolYearHint, familyCandidateDecision: 'weighted-consensus' });
assertNull(r1.priceCharting, 'POST-FIX: priceCharting is null — the wrong 2001 product is rejected');
assertNull(r1.out.pcProductId, 'out.pcProductId cleared (was 2367113, set by Ship #28a before this gate ran)');
assertNull(r1.out.pcProductName, 'out.pcProductName cleared (was "Amazing Spider-Man #26 (2001)")');
assertNull(r1.out.pcLoosePrice, 'out.pcLoosePrice cleared');
assertTrue(!!r1.out.pcMatchRejectedForYearConflict, 'I13 annotation records the rejection, not a silent absence');
assertEq(r1.out.pcMatchRejectedForYearConflict.rejectedProductName, 'Amazing Spider-Man #26 (2001)', 'annotation names the rejected product');
assertEq(r1.out.pcMatchRejectedForYearConflict.rejectedYear, 2001, 'annotation records the rejected year');
assertEq(r1.out.pcMatchRejectedForYearConflict.poolYearHint, 2026, 'annotation records the poolYearHint it conflicted with');

// Confirms the downstream no-op (fetchPricechartingPop/fetchPricechartingSales
// ternary pattern from api/enrich.js ~line 4061/4069) — with priceCharting
// null, both correctly skip without any new fallback logic.
const wouldFetchPop = !!(r1.priceCharting?.id);
const wouldFetchSales = !!(r1.priceCharting?.id);
assertFalse(wouldFetchPop, 'fetchPricechartingPop ternary correctly evaluates to skip (no id to fetch)');
assertFalse(wouldFetchSales, 'fetchPricechartingSales ternary correctly evaluates to skip (no id to fetch)');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — Regression: default/unconflicted path is completely untouched
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: regression — default/unconflicted PC acceptance is byte-identical\n');

// Batman #608: no poolYearHint at all in production for this pool shape.
const batmanPC = { id: 999001, productName: 'Batman #608 (2002)', year: 2002, price: 175 };
const r2 = simulateLayer4({ priceCharting: batmanPC, poolYearHint: null, familyCandidateDecision: null });
assertEq(r2.priceCharting, batmanPC, 'Batman #608: priceCharting completely untouched (no poolYearHint → gate never engages)');
assertEq(r2.out.pcProductId, 999001, 'Batman #608: out.pcProductId unchanged');

// Catwoman #64: poolYearHint fires, but no confirmed family override in
// that production case.
const catwomanPC = { id: 999002, productName: 'Catwoman #64 (2024 Szerdy)', year: 2024, price: 15 };
const r3 = simulateLayer4({ priceCharting: catwomanPC, poolYearHint: { year: 2024, agreement: 1.0, sampleSize: 6 }, familyCandidateDecision: 'fallback-vision' });
assertEq(r3.priceCharting, catwomanPC, 'Catwoman #64: priceCharting completely untouched (fallback-vision is not a confirmed override)');
assertEq(r3.out.pcProductId, 999002, 'Catwoman #64: out.pcProductId unchanged');

// Eternus #2 / He-Man: 'refused-identity-conflict' decision — structurally
// excluded (not in FAMILY_OVERRIDE_DECISIONS), same as Fix 1's
// detectFamilyOverrideConflict exclusion.
const eternusPC = { id: 999003, productName: 'He-Man and the Masters of the Universe #2', year: 2012, price: 150 };
const r4 = simulateLayer4({ priceCharting: eternusPC, poolYearHint: { year: 2024, agreement: 1.0, sampleSize: 2 }, familyCandidateDecision: 'refused-identity-conflict' });
assertEq(r4.priceCharting, eternusPC, 'Eternus #2/He-Man: priceCharting completely untouched (refused-identity-conflict not in FAMILY_OVERRIDE_DECISIONS)');

// A confirmed family override where the PC match's year actually AGREES
// with poolYearHint — must not be rejected just because the branch engaged.
const agreeingPC = { id: 999004, productName: 'Captain America #25 (2019)', year: 2019, price: 45 };
const r5 = simulateLayer4({ priceCharting: agreeingPC, poolYearHint: { year: 2019, agreement: 1.0, sampleSize: 2 }, familyCandidateDecision: 'weighted-consensus' });
assertEq(r5.priceCharting, agreeingPC, 'genuine agreement case: confirmed override + PC year matching poolYearHint → PC match kept, not rejected');
assertEq(r5.out.pcProductId, 999004, 'genuine agreement case: out.pcProductId unchanged');
assertTrue(!r5.out.pcMatchRejectedForYearConflict, 'genuine agreement case: no rejection annotation');

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
