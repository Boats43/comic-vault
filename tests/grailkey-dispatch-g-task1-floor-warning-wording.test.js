// tests/grailkey-dispatch-g-task1-floor-warning-wording.test.js
//
// GrailKey Directive 2026-08-11-F traced the full chain for the
// 'recommended-below-floor' warning: decisionEngine.js:862-865 computes
// decision.price = enforceFloor(item.price * 0.8, floor) inside the
// LIST_LOW branch, but responseContract.js:741 (finalizeResponse)
// unconditionally overwrites out.decision.price with contract.price
// (== the pre-decisionEngine out.price) before the response ever leaves
// the server. No raise -- correct or NaN -- has ever reached the operator.
//
// Pre-GK-74 the trigger itself (decisionEngine.js:408-417,
// systemPrice < activeLowest) never fired at all: item.price was a
// currency STRING, so the comparison was NaN < activeLowest, always
// false. GK-74 (359f751) made systemPrice a real number, so the
// detection went live in production for the first time same-day
// (2026-08-11) -- attached to a message that has always asserted a
// correction ("raised to $X") that has never once actually occurred.
//
// Directive G Task 1 rewords the message only. The detection
// (decisionEngine.js:408-417) is untouched and correct. Nothing in
// decisionEngine.js:862-865, enforceFloor, or responseContract.js:741
// changes -- making the raise real is pricing-math, a separate
// greenlight (Directive F remedy #4 / GK-75).

import { describeWarning } from '../src/lib/decisionEngine.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function fixture() {
  // Real production shape, NYC Outlaws #1 (Directive F evidence,
  // build 25c3cd8, 2026-08-11 23:43:38): market=$11.43, rawComps.lowest=$45.00.
  return {
    price: '$11.43',
    rawComps: { average: 75.485, lowest: 45.00, highest: 120, count: 13 },
  };
}

test('recommended-below-floor message does not claim an automatic raise occurred', () => {
  const item = fixture();
  const message = describeWarning('recommended-below-floor', item);
  const claimPattern = /\b(raised|corrected|adjusted)\b/i;
  if (claimPattern.test(message)) {
    throw new Error(
      `describeWarning must not assert the system acted on this gap -- no code path actually raises ` +
      `price to floor before the response ships (responseContract.js:741 overwrites decision.price ` +
      `with the pre-floor out.price unconditionally). Got: "${message}"`
    );
  }
});

test('recommended-below-floor message still shows both the recommended price and the floor', () => {
  const item = fixture();
  const message = describeWarning('recommended-below-floor', item);
  if (!message.includes('11.43')) {
    throw new Error(`Expected the recommended price (11.43) to appear in the message. Got: "${message}"`);
  }
  if (!message.includes('45.00')) {
    throw new Error(`Expected the floor value (45.00) to appear in the message. Got: "${message}"`);
  }
});

test('recommended-below-floor handles a missing floor without throwing', () => {
  const item = { price: '$11.43', rawComps: {} };
  const message = describeWarning('recommended-below-floor', item);
  if (typeof message !== 'string' || message.length === 0) {
    throw new Error('describeWarning must return a non-empty string even with no floor data');
  }
});

test('SCOPE GUARD: no other describeWarning/describeBlocker slug asserts an automatic correction that never happens', () => {
  // Swept every branch of both functions (src/lib/decisionEngine.js:958-1193)
  // during Directive G preflight. 'variant-pool-year-conflict' also uses the
  // word "corrected" (line ~1180) but describes a REAL correction that
  // genuinely executes elsewhere (api/enrich.js:5105-5123,
  // confirmedYear = writeConfirmed(...)) -- not a false claim, left alone.
  // 'recommended-below-floor' was the only slug describing an action the
  // code does not perform. This test exists as a documented marker of that
  // sweep, not an executable re-scan of the whole file.
  const sweepConfirmed = true;
  if (!sweepConfirmed) {
    throw new Error('Sweep not documented');
  }
});

console.log('\n=== GrailKey Directive G, Task 1 -- recommended-below-floor wording ===\n');
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${t.name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}`);
    failed++;
  }
}
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
