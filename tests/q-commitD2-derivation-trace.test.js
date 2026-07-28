// tests/q-commitD2-derivation-trace.test.js
//
// Commit D2 — shared structured derivation trace. Tests computePriceBands'
// (src/lib/priceBands.js) derivationTrace output directly against the 5
// mandatory regression cases named in the D2 dispatch: Flash #139 (tier 1),
// Superboy #89 (tier 3), Adventure Time (tier 3), Batman #15 (tier 2.5),
// Batman #15 (tier 4). For every case: finalOperation.outputValue must
// equal finalPrice; every multiply operation must satisfy
// roundCurrency(inputValue*factor) === outputValue; no impossible
// pcBase/multiplier/afterMult combination may serialize (pcBase/
// gradeMultiplier must never appear inside `operations` unless the tier
// actually multiplied by them).
//
// Invoke: node tests/q-commitD2-derivation-trace.test.js

import { computePriceBands } from '../src/lib/priceBands.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
const roundCurrency = (n) => Math.round(n * 100) / 100;

console.log('\n=== Commit D2 — shared derivation trace ===\n');

// Shared structural assertions run against every fixture below.
function assertTraceIntegrity(trace, expectedFinalPrice, label) {
  assertTrue(!!trace, `${label}: derivationTrace present`);
  if (!trace) return;
  const ops = trace.operations || [];
  assertTrue(ops.length > 0, `${label}: at least one operation recorded`);
  const finalOp = ops[ops.length - 1];
  assertEq(roundCurrency(finalOp.outputValue), roundCurrency(expectedFinalPrice), `${label}: finalOperation.outputValue === finalPrice`);
  assertEq(roundCurrency(trace.finalPrice), roundCurrency(expectedFinalPrice), `${label}: trace.finalPrice === finalPrice`);

  // Chain check: for consecutive APPLIED steps that are part of one linear
  // calculation (not a parallel "average" feeding a separate blend), each
  // step's outputValue should feed the next.
  for (let i = 0; i < ops.length - 1; i++) {
    const cur = ops[i];
    const next = ops[i + 1];
    if (cur.applied && next.applied && next.operation !== 'weighted_blend' && next.operation !== 'identity') {
      // next.inputValue should derive from cur.outputValue (exact match for
      // scalar chains; the multiply/cap steps in this suite are all scalar).
      if (typeof next.inputValue === 'number' && typeof cur.outputValue === 'number') {
        assertEq(next.inputValue, cur.outputValue, `${label}: step "${next.step}".inputValue === step "${cur.step}".outputValue`);
      }
    }
  }

  // Multiply-operation correctness.
  for (const op of ops) {
    if (op.operation === 'multiply' && op.applied) {
      assertEq(roundCurrency(op.inputValue * op.factor), roundCurrency(op.outputValue), `${label}: multiply step "${op.step}" — roundCurrency(inputValue*factor) === outputValue`);
    }
  }

  // Reference values never mislabeled as the calculation base: pcBase/
  // gradeMultiplier may appear in operations ONLY if this tier actually
  // used them (Tier 4 only, in this suite).
  const usesPcBaseInOps = ops.some((o) => o.step === 'pricecharting_raw' || o.step === 'grade_multiplier');
  if (usesPcBaseInOps) {
    assertEq(trace.pricingSource, 'tier4_pc_estimate', `${label}: pcBase/gradeMultiplier only enter operations for tier4_pc_estimate (got "${trace.pricingSource}")`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Flash #139 — Tier 1 (verified_sold_recency). Real production values:
// pcBase=150, gradeMultiplier=0.65, compsAvg(active)=311.17, real
// finalPrice=205.04. Reconstructs a 23-row sold pool with a recency-band
// mix producing a comparable recency-weighted result — exact per-row
// prices/dates were not individually captured in the production log
// (only the aggregate), so this validates STRUCTURAL trace correctness
// (the actual anti-regression property), not a byte-identical replay.
// ══════════════════════════════════════════════════════════════════════════════
console.log('Fixture: Flash #139 (tier 1) — pcBase never enters the calculation\n');
{
  const soldRows = [
    ...Array.from({ length: 5 }, (_, i) => ({ title: `The Flash #139 fresh ${i}`, price: 210 + i, recencyBand: 'fresh', variantVerified: true })),
    ...Array.from({ length: 3 }, (_, i) => ({ title: `The Flash #139 recent ${i}`, price: 195 + i, recencyBand: 'recent', variantVerified: true })),
    ...Array.from({ length: 15 }, (_, i) => ({ title: `The Flash #139 stale ${i}`, price: 200 + (i % 5), recencyBand: 'stale', variantVerified: true })),
  ];
  const soldComps = soldRows.map((r) => ({ title: r.title, price: r.price }));
  const result = computePriceBands({
    soldComps,
    activeComps: { prices: [] },
    pcBase: 150,
    gradeMultiplier: 0.65,
    title: 'The Flash', issue: '139', year: 1963, variant: null,
    soldVerifyResult: { verified: soldRows },
  });
  assertEq(result.tier, 1, 'Flash #139: resolves to tier 1');
  assertEq(result.source, 'tier1_recency_weighted', 'Flash #139: source is tier1_recency_weighted');
  assertTraceIntegrity(result.derivationTrace, result.market, 'Flash #139');
  assertEq(result.derivationTrace.pricingSource, 'verified_sold_recency', 'Flash #139: trace.pricingSource is verified_sold_recency');
  assertEq(result.derivationTrace.referenceValues.priceChartingRaw, 150, 'Flash #139: pcBase recorded as reference only');
  assertEq(result.derivationTrace.referenceValues.gradeMultiplier, 0.65, 'Flash #139: gradeMultiplier recorded as reference only');
  assertFalse(result.derivationTrace.operations.some((o) => o.step.includes('pricecharting') || o.step.includes('grade_multiplier')), 'Flash #139: pcBase/gradeMultiplier never appear as an applied operation (they did not control the price)');
  assertEq(result.derivationTrace.operations.length, 1, 'Flash #139: single operation (recency_weighted_sold) — matches the expected shape from the D2 dispatch exactly');
  assertEq(result.derivationTrace.operations[0].step, 'recency_weighted_sold', 'Flash #139: operation step is recency_weighted_sold');
  assertEq(result.derivationTrace.operations[0].operation, 'weighted_average', 'Flash #139: operation type is weighted_average');
  assertEq(result.derivationTrace.operations[0].factor, null, 'Flash #139: factor is null (not a multiply)');
  assertEq(result.derivationTrace.operations[0].source, 'eligible_verified_sold', 'Flash #139: source is eligible_verified_sold');
}

// ══════════════════════════════════════════════════════════════════════════════
// Superboy #89 — Tier 3 (active-only × 0.85 discount). No sold data,
// active-only. Constructed to demonstrate the exact D2 dispatch example
// math: active average $74.243333 × 0.85 = $63.11.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture: Superboy #89 (tier 3) — active-ask discount, no unrelated grade multiplier displayed\n');
{
  const activePrices = [70.23, 74.50, 78.00]; // avg = 74.243333...
  const result = computePriceBands({
    soldComps: [],
    activeComps: { prices: activePrices.map((p) => ({ price: p, title: `Superboy #89 ${p}` })) },
    pcBase: 90, // deliberately present but must not enter tier 3's operations
    gradeMultiplier: 1.20, // deliberately present — must NOT appear as "×1.20" per the D2 dispatch's own explicit instruction
    title: 'Superboy', issue: '89', year: 1961, variant: null,
    soldVerifyResult: { verified: [] },
  });
  assertEq(result.tier, 3, 'Superboy #89: resolves to tier 3');
  const activeAvg = activePrices.reduce((a, b) => a + b, 0) / activePrices.length;
  assertEq(roundCurrency(activeAvg), 74.24, 'Superboy #89: active average is $74.24 (matches D2 dispatch example)');
  assertEq(result.market, 63.11, 'Superboy #89: final price is $63.11 (matches D2 dispatch example)');
  assertTraceIntegrity(result.derivationTrace, result.market, 'Superboy #89');
  assertEq(result.derivationTrace.operations[0].step, 'active_average', 'Superboy #89: first step is active_average');
  assertEq(result.derivationTrace.operations[1].step, 'active_ask_discount', 'Superboy #89: second step is active_ask_discount');
  assertEq(result.derivationTrace.operations[1].factor, 0.85, 'Superboy #89: discount factor is 0.85');
  assertFalse(result.derivationTrace.operations.some((o) => o.factor === 1.20), 'Superboy #89: the unrelated ×1.20 grade multiplier never appears in the trace');
  assertEq(result.derivationTrace.referenceValues.gradeMultiplier, 1.20, 'Superboy #89: gradeMultiplier still recorded as reference-only (not hidden, just not mislabeled as the calc base)');
}

// ══════════════════════════════════════════════════════════════════════════════
// Adventure Time — Tier 3, second independent instance of the same tier
// (D2 requires validating the shared trace mechanism, not just one tier-3
// book), reconstructed from the Adventure Time Summer Special #1 fixture
// shape used elsewhere in this suite (4-member SDCC family).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture: Adventure Time Summer Special #1 (tier 3)\n');
{
  const activePrices = [18.00, 22.50, 15.99, 24.00];
  const result = computePriceBands({
    soldComps: [],
    activeComps: { prices: activePrices.map((p) => ({ price: p, title: `Adventure Time Summer Special #1 SDCC ${p}` })) },
    pcBase: 12,
    gradeMultiplier: 1.0,
    title: 'Adventure Time Summer Special', issue: '1', year: 2013, variant: 'SDCC Convention Exclusive',
    soldVerifyResult: { verified: [] },
  });
  assertEq(result.tier, 3, 'Adventure Time: resolves to tier 3');
  assertTraceIntegrity(result.derivationTrace, result.market, 'Adventure Time');
  assertEq(result.derivationTrace.pricingSource, 'tier3_active_discounted', 'Adventure Time: pricingSource is tier3_active_discounted');
}

// ══════════════════════════════════════════════════════════════════════════════
// Batman #15 — Tier 2.5 (verified_sold_stale). Real production values:
// pcBase=780.28, gradeMultiplier=0.45, real finalPrice=558.25
// (staleAvg=656.77 × 0.85 = 558.25 — confirmed arithmetically correct in
// the real production log, unlike Flash #139's afterMult defect).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture: Batman #15 (tier 2.5) — real production values\n');
{
  // 17 verified stale sold rows averaging exactly 656.77 (matches the real
  // production [tier-2.5] staleAvg=$656.77 line).
  const target = 656.77;
  const n = 17;
  const base = Math.floor((target * n) / n * 100) / 100;
  const prices = Array.from({ length: n }, () => base);
  // Adjust the last price so the mean lands exactly on 656.77.
  const currentSum = prices.reduce((a, b) => a + b, 0);
  const desiredSum = target * n;
  prices[n - 1] = roundCurrency(prices[n - 1] + (desiredSum - currentSum));
  const soldRows = prices.map((p, i) => ({ title: `Batman #15 (DC, 1943) stale ${i}`, price: p, recencyBand: 'stale', variantVerified: true }));
  const result = computePriceBands({
    soldComps: soldRows.map((r) => ({ title: r.title, price: r.price })),
    activeComps: { prices: [] },
    pcBase: 780.28,
    gradeMultiplier: 0.45,
    title: 'Batman', issue: '15', year: 1943, variant: null,
    soldVerifyResult: { verified: soldRows },
  });
  assertEq(result.tier, 2.5, 'Batman #15 (2.5): resolves to tier 2.5');
  assertEq(result.source, 'verified_sold_stale', 'Batman #15 (2.5): source is verified_sold_stale');
  assertEq(result.market, 558.25, 'Batman #15 (2.5): final price is $558.25 (matches real production)');
  assertTraceIntegrity(result.derivationTrace, result.market, 'Batman #15 (tier 2.5)');
  assertEq(result.derivationTrace.referenceValues.priceChartingRaw, 780.28, 'Batman #15 (2.5): pcBase=780.28 recorded as reference only, never the calc base');
  assertFalse(result.derivationTrace.operations.some((o) => o.step.includes('pricecharting') || o.step.includes('grade_multiplier')), 'Batman #15 (2.5): pcBase/gradeMultiplier never appear as an applied operation');
}

// ══════════════════════════════════════════════════════════════════════════════
// Batman #15 — Tier 4 (tier4_pc_estimate). Here pcBase/gradeMultiplier DO
// control the price — the one tier where they legitimately belong inside
// `operations`, not just referenceValues.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nFixture: Batman #15 (tier 4) — pcBase legitimately IS the calculation base here\n');
{
  const result = computePriceBands({
    soldComps: [],
    activeComps: { prices: [] },
    pcBase: 780.28,
    gradeMultiplier: 0.45,
    title: 'Batman', issue: '15', year: 1943, variant: null,
    soldVerifyResult: { verified: [] },
  });
  assertEq(result.tier, 4, 'Batman #15 (4): resolves to tier 4');
  assertEq(result.source, 'tier4_pc_estimate', 'Batman #15 (4): source is tier4_pc_estimate');
  const expected = roundCurrency(780.28 * 0.45);
  assertEq(result.market, expected, `Batman #15 (4): final price is pcBase×gradeMultiplier = $${expected}`);
  assertTraceIntegrity(result.derivationTrace, result.market, 'Batman #15 (tier 4)');
  assertEq(result.derivationTrace.operations[0].step, 'pricecharting_raw', 'Batman #15 (4): first step is pricecharting_raw');
  assertEq(result.derivationTrace.operations[1].step, 'grade_multiplier', 'Batman #15 (4): second step is grade_multiplier');
  assertEq(result.derivationTrace.operations[1].factor, 0.45, 'Batman #15 (4): grade_multiplier factor is 0.45');
  assertEq(roundCurrency(result.derivationTrace.operations[1].inputValue * result.derivationTrace.operations[1].factor), result.derivationTrace.operations[1].outputValue, 'Batman #15 (4): 780.28 × 0.45 arithmetic is genuinely correct (unlike the old afterMult defect)');
}

// Tier 4 with sanity cap — a third operation gets appended, and the trace
// still resolves correctly to the CAPPED price, not the pre-cap one.
{
  const result = computePriceBands({
    soldComps: [],
    activeComps: { prices: [{ price: 10, title: 'Some Comic #1' }, { price: 12, title: 'Some Comic #1' }] },
    pcBase: 100,
    gradeMultiplier: 1.0, // basePrice=100 > compsAvg(11)×1.5=16.5 -> capped
    title: 'Some Comic', issue: '1', year: 2020, variant: null,
    soldVerifyResult: { verified: [] },
  });
  assertEq(result.tier, 4, 'sanity-capped tier 4: still tier 4');
  assertTrue(result.sanityCapped, 'sanity-capped tier 4: sanityCapped flag true');
  assertTraceIntegrity(result.derivationTrace, result.market, 'sanity-capped tier 4');
  assertEq(result.derivationTrace.operations.length, 3, 'sanity-capped tier 4: 3 operations recorded (raw, multiply, cap)');
  assertEq(result.derivationTrace.operations[2].step, 'active_sanity_cap', 'sanity-capped tier 4: third step is active_sanity_cap');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
