// Unit tests for Ship #15 — FR-LIST-PRICE-WARNING.
//
// Helper: computeListPriceWarning(listPrice, item)
// Triggers: A engine ×1.25, B high ×1.20, C avg ×1.50.
// Skip flags: megaKeyFloorApplied / manualReviewRequired / gradeExceedsMap.
//
// Invoke: node tests/list-price-warning.test.js
// Exit: 0 all-pass, 1 any failure.

import { computeListPriceWarning } from '../api/list-price-warning.js';

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

const assertNull = (actual, label) => assertEq(actual, null, label);

const assertFires = (result, kindsExpected, label) => {
  if (
    result &&
    Array.isArray(result.triggered) &&
    JSON.stringify([...result.triggered].sort()) ===
      JSON.stringify([...kindsExpected].sort())
  ) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected triggered: ${JSON.stringify(kindsExpected)}\n    actual:             ${JSON.stringify(result)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertWorst = (result, kindExpected, label) => {
  if (result && result.worst && result.worst.kind === kindExpected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected worst.kind: ${kindExpected}\n    actual:              ${JSON.stringify(result?.worst)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #15 — LIST PRICE WARNING ===\n');

// ─── Bug fixtures (from Session 2 phone validation) ─────────────────
console.log('Bug fixtures (3 evidence cases):');

// Avengers #221 (1982) VF 8.0 — user $20 vs engine $9.50, high $15, avg $7.50
const avengers221 = {
  price: '$9.50',
  comps: { averageNum: 7.50, highestNum: 15.00, lowestNum: 5.00 },
};
const r1 = computeListPriceWarning(20, avengers221);
assertFires(r1, ['engine', 'high', 'avg'], 'Avengers #221 ($20 list) → all 3 triggers fire');
// pcts: engine 111%, high 33%, avg 167% → worst=avg
assertWorst(r1, 'avg', 'Avengers #221 worst = avg (167% over)');

// Superman #201 (1967) VG- 3.5 — user $17.90 vs engine $14.50, high $11, avg $9
const superman201 = {
  price: '$14.50',
  comps: { averageNum: 9.00, highestNum: 11.00, lowestNum: 6.00 },
};
const r2 = computeListPriceWarning(17.90, superman201);
// engine: 17.90/14.50=1.234 → 23% (under 1.25, no fire)
// high: 17.90/11=1.627 → 63% (over 1.20)
// avg: 17.90/9=1.989 → 99% (over 1.50)
assertFires(r2, ['high', 'avg'], 'Superman #201 ($17.90 list) → high+avg only (engine just under 1.25)');
assertWorst(r2, 'avg', 'Superman #201 worst = avg (99% over)');

// Tales of Teen Titans #43 (1984) VF 8.0 — user $19.11 vs engine $10, high $10, avg $7.50
const ttt43 = {
  price: '$10.00',
  comps: { averageNum: 7.50, highestNum: 10.00, lowestNum: 5.00 },
};
const r3 = computeListPriceWarning(19.11, ttt43);
assertFires(r3, ['engine', 'high', 'avg'], 'Tales of Teen Titans #43 ($19.11 list) → all 3 triggers');
assertWorst(r3, 'avg', 'Tales TT #43 worst = avg (155% over)');

// ─── Trigger boundaries ─────────────────────────────────────────────
console.log('\nTrigger boundaries:');

const itemEngine10 = { price: '$10.00', comps: null };
assertNull(
  computeListPriceWarning(12.50, itemEngine10),
  'engine ×1.25 exactly → null (not strictly greater)'
);
const justOverEngine = computeListPriceWarning(12.51, itemEngine10);
assertFires(justOverEngine, ['engine'], 'engine just over 1.25× → fires A only');

const itemHigh10 = { price: 0, comps: { highestNum: 10, averageNum: 0 } };
assertNull(
  computeListPriceWarning(12.00, itemHigh10),
  'high ×1.20 exactly → null'
);
const justOverHigh = computeListPriceWarning(12.01, itemHigh10);
assertFires(justOverHigh, ['high'], 'high just over 1.20× → fires B only');

const itemAvg10 = { price: 0, comps: { averageNum: 10, highestNum: 0 } };
assertNull(
  computeListPriceWarning(15.00, itemAvg10),
  'avg ×1.50 exactly → null'
);
const justOverAvg = computeListPriceWarning(15.01, itemAvg10);
assertFires(justOverAvg, ['avg'], 'avg just over 1.50× → fires C only');

// ─── Multiple triggers — worst-wins logic ───────────────────────────
console.log('\nMultiple triggers — worst-wins (highest pctOver):');

// Engine $10 (1.30=$13), high $10 (1.20=$12), avg $4 (1.50=$6)
// At list=$13.50 — engine 35%, high 35%, avg 237%
const allFire = computeListPriceWarning(13.50, {
  price: '$10.00',
  comps: { averageNum: 4.00, highestNum: 10.00 },
});
assertFires(allFire, ['engine', 'high', 'avg'], 'three triggers fire');
assertWorst(allFire, 'avg', 'worst = avg (highest pctOver)');

// Engine high but high lower
const engineWorst = computeListPriceWarning(50, {
  price: '$10.00',  // engine 400% over
  comps: { averageNum: 30.00, highestNum: 30.00 },  // high 67%, avg 67%
});
assertWorst(engineWorst, 'engine', 'engine pct dominant → worst = engine');

// Just one trigger — that one wins by default
const oneTrigger = computeListPriceWarning(13, {
  price: '$10.00',  // 30% over (fires A)
  comps: { averageNum: 12.00, highestNum: 14.00 },  // 8% over avg, -7% under high → no fire
});
assertFires(oneTrigger, ['engine'], 'only engine fires when comps comfortably above list');
assertWorst(oneTrigger, 'engine', 'single trigger → worst = engine');

// ─── Skip flags ─────────────────────────────────────────────────────
console.log('\nSkip flags (engine-deliberate high):');

const baseMegaKey = {
  price: '$50000',
  comps: { averageNum: 100, highestNum: 200, lowestNum: 50 },
};
assertNull(
  computeListPriceWarning(60000, { ...baseMegaKey, megaKeyFloorApplied: true }),
  'megaKeyFloorApplied → null'
);
assertNull(
  computeListPriceWarning(60000, { ...baseMegaKey, manualReviewRequired: true }),
  'manualReviewRequired → null'
);
assertNull(
  computeListPriceWarning(60000, { ...baseMegaKey, gradeExceedsMap: true }),
  'gradeExceedsMap → null'
);
// Without skip flags the same numbers SHOULD fire — sanity check that the
// flags are doing the work (not coincidence).
const wouldFire = computeListPriceWarning(60000, baseMegaKey);
assertEq(
  wouldFire !== null,
  true,
  'sanity: without skip flags, same scenario fires (confirms flags are gating)'
);

// thinPoolAnchored is NOT a skip flag — over-reach should still warn.
const thinPool = {
  price: '$7.52',
  comps: { averageNum: 7.16, highestNum: 7.16, lowestNum: 7.16 },
  thinPoolAnchored: true,
};
const thinResult = computeListPriceWarning(15.00, thinPool);
assertEq(
  thinResult !== null,
  true,
  'thinPoolAnchored does NOT skip — user over-reach on thin pool still warns'
);

// compsExhausted is NOT a skip flag.
const exhausted = {
  price: '$10.00',
  comps: { averageNum: 5.00, highestNum: 8.00 },
  compsExhausted: true,
};
const exhaustedResult = computeListPriceWarning(20.00, exhausted);
assertEq(
  exhaustedResult !== null,
  true,
  'compsExhausted does NOT skip — warning still fires'
);

// ─── Partial data ───────────────────────────────────────────────────
console.log('\nPartial data — graceful degradation:');

// Only engine rec (no comps).
const engineOnly = { price: '$10.00', comps: null };
assertFires(
  computeListPriceWarning(13, engineOnly),
  ['engine'],
  'engine only, no comps → fires A when over'
);
assertNull(
  computeListPriceWarning(11, engineOnly),
  'engine only, list within 1.25× → null'
);

// Only comps.average (no item.price, no high).
const avgOnly = { price: '', comps: { averageNum: 10 } };
assertFires(
  computeListPriceWarning(16, avgOnly),
  ['avg'],
  'avg only → fires C when over 1.50×'
);

// Only comps.highest.
const highOnly = { price: '', comps: { highestNum: 10 } };
assertFires(
  computeListPriceWarning(13, highOnly),
  ['high'],
  'high only → fires B when over 1.20×'
);

// Empty item — no price, no comps.
assertNull(
  computeListPriceWarning(100, { price: '', comps: null }),
  'no engine, no comps → null (nothing to compare against)'
);

// item.price as number 0.
assertNull(
  computeListPriceWarning(100, { price: 0, comps: null }),
  'item.price=0, no comps → null'
);

// ─── Edge cases — null / NaN / bogus ────────────────────────────────
console.log('\nEdge cases — null / NaN / unsafe inputs:');

assertNull(computeListPriceWarning(null, engineOnly), 'listPrice=null → null');
assertNull(computeListPriceWarning(undefined, engineOnly), 'listPrice=undefined → null');
assertNull(computeListPriceWarning('', engineOnly), 'listPrice="" → null');
assertNull(computeListPriceWarning(0, engineOnly), 'listPrice=0 → null');
assertNull(computeListPriceWarning(-5, engineOnly), 'listPrice negative → null');
assertNull(computeListPriceWarning(NaN, engineOnly), 'listPrice=NaN → null');
assertNull(computeListPriceWarning('garbage', engineOnly), 'listPrice non-numeric string → null');

assertNull(computeListPriceWarning(20, null), 'item=null → null');
assertNull(computeListPriceWarning(20, undefined), 'item=undefined → null');
assertNull(computeListPriceWarning(20, 'string-not-object'), 'item=string → null');

// String list price ($-formatted) parses correctly.
assertFires(
  computeListPriceWarning('$13.00', engineOnly),
  ['engine'],
  'listPrice "$13.00" string parses and fires'
);
assertFires(
  computeListPriceWarning('13', engineOnly),
  ['engine'],
  'listPrice "13" string parses and fires'
);

// item.price as string with $-prefix.
assertFires(
  computeListPriceWarning(20, { price: '$10.00', comps: null }),
  ['engine'],
  'item.price "$10.00" string parses to engine 10'
);

// ─── Return shape ───────────────────────────────────────────────────
console.log('\nReturn shape:');

const shape = computeListPriceWarning(20, {
  price: '$10.00',
  comps: { averageNum: 5, highestNum: 12 },
});
assertEq(typeof shape, 'object', 'shape: returns object on fire');
assertEq(typeof shape.listPrice, 'number', 'shape: listPrice is number');
assertEq(shape.listPrice, 20, 'shape: listPrice = parsed input');
assertEq(Array.isArray(shape.triggered), true, 'shape: triggered is array');
assertEq(typeof shape.worst, 'object', 'shape: worst is object');
assertEq(typeof shape.worst.kind, 'string', 'shape: worst.kind is string');
assertEq(typeof shape.worst.label, 'string', 'shape: worst.label is string');
assertEq(typeof shape.worst.anchor, 'number', 'shape: worst.anchor is number');
assertEq(typeof shape.worst.pctOver, 'number', 'shape: worst.pctOver is number');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
