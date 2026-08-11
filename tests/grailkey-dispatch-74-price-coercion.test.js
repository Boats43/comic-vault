// tests/grailkey-dispatch-74-price-coercion.test.js
//
// GrailKey Directive 2026-08-11-D found GK-74: item.price is a currency
// STRING ("$800.00", via fmtUsd()) on nearly every real pricing path by
// the time computeDecision() runs, but decisionEngine.js's magnitude-based
// safety checks (catastrophic-system-overprice, active-floor-far-below,
// recommended-below-floor, active-avg-far-below) compare it with >/< against
// raw numeric comps values. JS coerces "$800.00" via ToNumber -> NaN (the
// $ prefix breaks the numeric grammar), so every comparison silently
// evaluates false regardless of override magnitude. The existing test
// suite (tests/decision-engine.test.js) never caught this because every
// fixture uses a raw number (price: 42.53), never the real fmtUsd() string
// shape production actually produces.
//
// Directive 2026-08-11-E, Task 1 fixes this by parsing item.price to a
// local numeric (systemPrice) once, early in computeDecision(), reusing
// src/lib/responseContract.js's existing parsePriceNumber(). Scope is
// deliberately narrow: only the blocker/warning CHECK sites are fixed.
// Every `decision.price =` computation site, and computeBestChannel's own
// separate item.price read, are left untouched on purpose (see the Task 1
// scope note in decisionEngine.js) -- this suite proves that boundary too.

import { computeDecision, describeBlocker, describeWarning } from '../src/lib/decisionEngine.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertIncludes(array, value, message) {
  if (!array || !array.includes(value)) {
    throw new Error(`${message}\nExpected array to include: ${value}\nArray: ${JSON.stringify(array)}`);
  }
}

function assertNotIncludes(array, value, message) {
  if (array && array.includes(value)) {
    throw new Error(`${message}\nExpected array NOT to include: ${value}\nArray: ${JSON.stringify(array)}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// The real Bone #1 production shape: a mega-key-floor override has
// already run and stamped out.price = "$800.00" (fmtUsd string) before
// computeDecision() ever sees it. rawComps reflects the real, thin,
// pre-floor pool the engine actually priced from ($44.05-ish average).
// ─────────────────────────────────────────────────────────────────
function boneFixture() {
  return {
    title: "Bone",
    issue: "1",
    publisher: "Image",
    year: 1991,
    variant: "signed nth print",
    price: "$800.00",               // <-- currency STRING, the real production shape
    megaKeyFloorApplied: true,
    rawComps: {
      average: 40,                  // engine's own comp pool average
      lowest: 10,
      highest: 60,
      count: 4
    },
    soldComps: [],
    pricingSource: "mega-key-floor",
    identityConfident: true
  };
}

test('GK-74: string price ("$800.00") trips catastrophic-system-overprice at 20x avg comps', () => {
  const item = boneFixture(); // 800 / 40 = 20x, over the 10x threshold
  const decision = computeDecision(item);
  assertIncludes(decision.blockers, 'catastrophic-system-overprice',
    'A string price 20x the active comp average must trip the blocker, same as a raw-number price would');
  assertNotIncludes(['LIST_LOW', 'LIST_NOW'], decision.action,
    'An 18-20x override must never reach a LIST action');
});

test('GK-74: decision.price stays null (not NaN) when the blocker fires', () => {
  const item = boneFixture();
  const decision = computeDecision(item);
  // Blockers short-circuit BEFORE any decision.price computation runs
  // (early return at the "PHASE 1: HARD BLOCKERS" gate) -- price stays at
  // its safe initial default. This is what keeps the fix's scope narrow:
  // reactivating the check does not newly unmask a NaN into the UI.
  assertEqual(decision.price, null, 'decision.price must stay at its safe null default, never NaN, when a blocker fires');
});

test('GK-74: a HEALTHY string price does not falsely trip the blocker', () => {
  const item = boneFixture();
  item.price = "$44.00";            // in-line with the comp average, no override
  const decision = computeDecision(item);
  assertNotIncludes(decision.blockers, 'catastrophic-system-overprice',
    'A healthy price near the comp average must not trip the overprice blocker just because it is a string');
});

test('GK-74: null price does not trip any magnitude check (no false-becomes-zero)', () => {
  const item = boneFixture();
  item.price = null;
  const decision = computeDecision(item);
  assertNotIncludes(decision.blockers, 'catastrophic-system-overprice',
    'A genuinely absent price must not be coerced to 0 and treated as a below-floor/overprice violation');
  assertNotIncludes(decision.warnings, 'active-floor-far-below',
    'A genuinely absent price must not trip active-floor-far-below either');
});

test('GK-74: undefined price does not trip any magnitude check', () => {
  const item = boneFixture();
  delete item.price;
  const decision = computeDecision(item);
  assertNotIncludes(decision.blockers, 'catastrophic-system-overprice',
    'An undefined price must behave identically to a null price');
});

test('GK-74: unparseable garbage price string does not silently become 0', () => {
  const item = boneFixture();
  item.price = "unavailable";
  const decision = computeDecision(item);
  assertNotIncludes(decision.blockers, 'catastrophic-system-overprice',
    'A non-numeric garbage string must not parse to 0 and falsely violate a below-floor check');
});

test('GK-74: an already-numeric price (legacy/test shape) behaves identically to before', () => {
  const item = boneFixture();
  item.price = 800; // raw number, the shape every pre-existing test fixture uses
  const decision = computeDecision(item);
  assertIncludes(decision.blockers, 'catastrophic-system-overprice',
    'A raw numeric price must trip the same checks a currency-string price now does -- no regression for the existing test shape');
});

test('GK-74: string price correctly trips active-avg-far-below (2x threshold) when below the 10x catastrophic bar', () => {
  const item = boneFixture();
  item.price = "$90.00"; // 90 / 40 = 2.25x -- over the 2x active-avg-far-below bar, under the 10x catastrophic bar
  const decision = computeDecision(item);
  assertIncludes(decision.warnings, 'active-avg-far-below',
    'A string price 2.25x the active average must trip active-avg-far-below, same as a raw-number price would');
  assertEqual(decision.action, 'RESEARCH', 'active-avg-far-below is a critical warning and must escalate to RESEARCH');
});

test('GK-74: string price correctly trips active-floor-far-below (3x lowest-ask threshold)', () => {
  const item = boneFixture();
  item.rawComps = { average: 200, lowest: 10, highest: 400, count: 4 }; // avg high enough to stay under the 2x/10x avg gates
  item.price = "$35.00"; // 35 / 10 = 3.5x the lowest ask
  const decision = computeDecision(item);
  assertIncludes(decision.warnings, 'active-floor-far-below',
    'A string price 3.5x the active floor must trip active-floor-far-below');
});

test('GK-74: describeBlocker renders a real number, not "$NaN", for catastrophic-system-overprice', () => {
  const item = boneFixture();
  const message = describeBlocker('catastrophic-system-overprice', item);
  if (message.includes('NaN')) {
    throw new Error(`describeBlocker must not render NaN once this blocker is reachable on real data. Got: "${message}"`);
  }
  if (!message.includes('$800.00')) {
    throw new Error(`Expected the real numeric price to appear in the message. Got: "${message}"`);
  }
});

test('GK-74: describeWarning renders a real number, not NaN, for active-floor-far-below', () => {
  const item = boneFixture();
  item.rawComps = { average: 200, lowest: 10, highest: 400, count: 4 };
  item.price = "$35.00";
  const message = describeWarning('active-floor-far-below', item);
  if (message.includes('NaN')) {
    throw new Error(`describeWarning must not render NaN once this warning is reachable on real data. Got: "${message}"`);
  }
});

test('GK-74 SCOPE GUARD: computeBestChannel is deliberately NOT fixed -- a DO_NOT_LIST/blocked book still routes to "blocked" regardless (unaffected either way)', () => {
  const item = boneFixture();
  const decision = computeDecision(item);
  // For a blocked book this is a no-op check either way (bestChannel's own
  // first branch short-circuits on decision.action alone) -- this test
  // exists to document the scope boundary, not to exercise the untouched
  // bug itself (that would require a non-blocked, non-critical-warning
  // book, which is Directive E's own explicitly-deferred follow-up).
  assertEqual(decision.bestChannel, 'blocked', 'A DO_NOT_LIST decision must still route bestChannel to blocked');
});

// ─────────────────────────────────────────────────────────────────

console.log('\n=== GrailKey Directive E, Task 1 (GK-74) — price coercion ===\n');
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
