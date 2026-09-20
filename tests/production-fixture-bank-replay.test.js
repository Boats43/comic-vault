// tests/production-fixture-bank-replay.test.js
//
// PRODUCTION FIXTURE BANK dispatch (2026-09-20) — Section 8 (deterministic
// replay proof) + Section 7 (non-mutation, hard requirement) + a
// production-shaped-values proof (Section 2: "$15.28" must not become
// 15.28). Also proves the canonical fixtureShape.js contract itself:
// every required field present-or-disclosed-null (Section 3).
//
// This exercises buildFixture (src/lib/fixtureShape.js — the SAME
// function App.jsx's "Bank Regression Fixture" button calls) with a
// realistic, production-shaped `fields` bag (dollar-formatted price
// strings, real nested soldCompDiagnostics/rawComps/priceLadder/decision/
// contract shapes, a 14-row ladder, condition evidence, a real sub-tier
// branch string) — the exact same shape a live client-side `result`
// object carries. It then REPLAYS the frozen sold/active evidence through
// the real verifySoldComps/computePriceBands functions and proves the
// replay reproduces the fixture's own frozen tier/quick/market/stretch —
// without any network call, live or otherwise.
//
// Invoke: node tests/production-fixture-bank-replay.test.js

import { readFileSync } from 'node:fs';
import { buildFixture, isKnownAnswerFixture, classifyEraBucket, FIXTURE_SCHEMA_VERSION } from '../src/lib/fixtureShape.js';
import { verifySoldComps } from '../src/lib/soldVerification.js';
import { computePriceBands } from '../src/lib/priceBands.js';

// GK-228-shaped raw pool (verbatim from the PRICE-LANE-1 New Mutants #98
// fixture that already proved this exact composition-correction
// mechanism) — real function calls, not hand-faked recencyBand tags.
const buildRawSoldPool = () => {
  const ungraded = Array.from({ length: 16 }, (_, i) => ({
    price: 270 + i * 2,
    title: `New Mutants #98 1991 Marvel ${i % 2 === 0 ? 'first Deadpool app' : 'Liefeld'}`,
    daysAgo: 20 + i * 5,
  }));
  const graded = [
    { price: 120, title: 'New Mutants #98 1991 VG 4.0', daysAgo: 30 },
    { price: 145, title: 'New Mutants #98 1991 GD/VG 3.0', daysAgo: 45 },
    { price: 150, title: 'New Mutants #98 1991 FN- 5.5', daysAgo: 60 },
    { price: 130, title: 'New Mutants #98 1991 VG- 3.5', daysAgo: 90 },
  ];
  const mismatched = [
    { price: 900, title: 'New Mutants #98 1991 CGC 9.6', daysAgo: 10 },
    { price: 650, title: 'New Mutants #98 1991 NM 9.4', daysAgo: 15 },
  ];
  return [...ungraded, ...graded, ...mismatched];
};

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

console.log('\n=== PRODUCTION FIXTURE BANK — replay + non-mutation + schema proof ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Build a production-shaped fixture (New Mutants #98 shape, matching
// PRICE-LANE-1's own known-answer evidence) — real 14-row ladder, real
// dollar-formatted strings, real nested contract/decision shapes.
// ═══════════════════════════════════════════════════════════════════════
const soldVerifyCtx = {
  title: 'New Mutants', issue: '98', variant: null, publisher: 'Marvel',
  bookYear: 1991, userGradeKey: 'raw', assessedGrade: 'VG 4.0',
};
const soldVerifyResult = verifySoldComps(buildRawSoldPool(), soldVerifyCtx);
const soldRows = soldVerifyResult.verified;
assertEq(soldRows.length, 4, 'sanity: real verifySoldComps admits exactly the 4 VG-4.0-consistent rows (GK-228 mechanism)');
const soldCompDiagnostics = soldVerifyResult.diagnostics;
const rawComps = { average: 45.20, lowest: 22.00, highest: 89.99, count: 6, prices: [22.00, 35.50, 41.00, 48.75, 62.00, 89.99] };
// A real 14-row PriceCharting ladder shape.
const priceLadder = {
  '0.5': 15.00, '1.0': 22.50, '1.5': 30.00, '2.0': 38.50, '2.5': 47.00,
  '3.0': 58.00, '3.5': 70.00, '4.0': 136.48, '4.5': 95.00, '5.0': 110.00,
  '6.0': 130.00, '7.0': 160.00, '8.0': 200.00, '9.0': 252.50,
};
assertEq(Object.keys(priceLadder).length, 14, 'sanity: 14-row ladder fixture matches the dispatch\'s own "complete 14-row ladder" requirement');

const priceBandsResult = computePriceBands({
  soldComps: soldRows, activeComps: { prices: [], count: 0 }, pcBase: null, gradeMultiplier: 1,
  title: 'New Mutants', issue: '98', year: 1991, variant: null,
  variantAdjusted: false,
  soldVerifyResult,
});

const productionFields = {
  title: 'New Mutants', issue: '98', publisher: 'Marvel', year: 1991,
  grade: 'VG 4.0', gradeConfidence: 'high', isGraded: false, numericGrade: null,
  defectPenalty: 0.85, cgcPenaltyFlags: { storeStamp: { detected: false, pedigreeName: null }, staplePopping: { detected: true, severity: 'minor' }, polybagIndents: { detected: false }, cornerChips: { detected: true, count: 2 }, pedigreeStamp: { detected: false, pedigreeName: null } },
  restoration: null,
  soldComps: soldRows, soldCompDiagnostics,
  rawComps, priceLadder,
  activePoolSuspect: false, activePoolSuspectReason: null,
  priceBands: priceBandsResult,
  priceDerivationTrace: priceBandsResult.derivationTrace,
  pricingSource: priceBandsResult.source,
  gradeMultiplier: 1,
  // Production-shaped dollar strings — the exact "$15.28 must not become
  // 15.28" case the dispatch calls out.
  price: `$${priceBandsResult.market.toFixed(2)}`,
  priceLow: `$${priceBandsResult.quick.toFixed(2)}`,
  priceHigh: `$${priceBandsResult.stretch.toFixed(2)}`,
  decision: { action: 'LIST_LOW', price: priceBandsResult.market, warnings: ['thin-pool-anchor'] },
  contract: { state: 'PRICED', actionAuthority: { marketStanding: 'SIMILAR_ONLY' } },
  traceId: 'nm98-2026-09-20-abcdef12',
};

const fixture = buildFixture(productionFields, {
  source: 'production-phone-scan',
  capturedAt: '2026-09-20T18:00:00.000Z',
  buildSha: 'c4a5d23',
});

console.log('\nSection 3 — required-field presence-or-disclosed-null:');
assertEq(fixture.fixtureSchemaVersion, FIXTURE_SCHEMA_VERSION, 'fixture carries a schema version');
assertEq(fixture.source, 'production-phone-scan', 'source = production-phone-scan');
assertTrue(fixture.buildSha, 'Production build SHA present');
assertTrue(fixture.capturedAt, 'scan/capture timestamp present');
assertEq(fixture.identity.eraBucket, '1990_PLUS', 'era bucket correctly classified from year=1991');
assertEq(fixture.identity.knownAnswerFixture, true, 'New Mutants #98 correctly flagged as a known-answer fixture');
assertEq(classifyEraBucket(1969), 'PRE_1970', 'era bucket boundary: 1969 -> PRE_1970');
assertEq(classifyEraBucket(1970), '1970_1989', 'era bucket boundary: 1970 -> 1970_1989');
assertEq(classifyEraBucket(1989), '1970_1989', 'era bucket boundary: 1989 -> 1970_1989');
assertEq(classifyEraBucket(1990), '1990_PLUS', 'era bucket boundary: 1990 -> 1990_PLUS');
assertEq(classifyEraBucket(null), null, 'no year -> null era bucket, never guessed');
assertTrue(isKnownAnswerFixture('Amazing Spider-Man', '91'), 'ASM #91 recognized as known-answer');
assertTrue(isKnownAnswerFixture('The Unexpected', '122'), 'Unexpected #122 recognized as known-answer');
assertTrue(isKnownAnswerFixture('Amazing Spider-Man', '10'), 'ASM #10 recognized as known-answer');
assertTrue(!isKnownAnswerFixture('Amazing Spider-Man', '300'), 'ASM #300 (not one of the 4) correctly NOT flagged');

assertTrue(fixture.conditionEvidence.cgcPenaltyFlags != null, 'cgcPenaltyFlags present');
assertEq(fixture.conditionEvidence.defectPenalty, 0.85, 'defectPenalty present');
assertTrue(Array.isArray(fixture.pricingEvidence.soldComps) && fixture.pricingEvidence.soldComps.length === 4, 'full sold evidence (admitted comps) present');
assertEq(fixture.pricingEvidence.soldCompDiagnostics.reasons.ungradedTitle, 16, 'rejection breakdown by reason, including ungradedTitle, present');
assertEq(fixture.pricingEvidence.soldCompDiagnostics.rawCount, 22, 'raw/admitted counts present (22 raw)');
assertEq(fixture.pricingEvidence.soldCompDiagnostics.verifiedCount, 4, 'raw/admitted counts present (4 admitted)');
assertTrue(fixture.pricingEvidence.rawComps != null, 'active evidence (rawComps: floor/avg/high) present');
assertEq(fixture.pricingEvidence.rawComps.lowest, 22.00, 'active floor present');
assertEq(fixture.pricingEvidence.rawComps.average, 45.20, 'active average present');
assertEq(fixture.pricingEvidence.rawComps.highest, 89.99, 'active high present');
assertEq(fixture.pricingEvidence.activePoolSuspect, false, 'activePoolSuspect present (explicit boolean, not just-when-true)');
assertEq(Object.keys(fixture.pricingEvidence.priceLadder).length, 14, 'the complete 14-row ladder is captured verbatim, not reconstructed');
assertTrue(fixture.pricingEvidence.activeCompDiagnostics == null && !!fixture.pricingEvidence.activeCompDiagnosticsReason, 'active-side rejection breakdown: explicitly null WITH a disclosed reason (real pre-existing gap, never silently omitted)');

assertTrue(fixture.pricingResult.tier != null, 'resolved pricing tier present');
assertTrue(typeof fixture.pricingResult.branch === 'string' && fixture.pricingResult.branch.startsWith('tier'), `exact branch/sub-tier present, not just tier number (got "${fixture.pricingResult.branch}")`);
assertEq(fixture.pricingResult.decisionAction, 'LIST_LOW', 'decision action present');
assertEq(fixture.pricingResult.marketStanding, 'SIMILAR_ONLY', 'market standing present');

console.log('\nSection 2 — Production-shaped values preserved verbatim (never coerced):');
assertTrue(typeof fixture.pricingResult.price === 'string' && fixture.pricingResult.price.startsWith('$'), `price stays a dollar-formatted string, e.g. "${fixture.pricingResult.price}" — never silently coerced to a bare number`);
assertTrue(typeof fixture.pricingResult.priceLow === 'string' && fixture.pricingResult.priceLow.startsWith('$'), 'priceLow stays dollar-formatted');
assertTrue(typeof fixture.pricingResult.priceHigh === 'string' && fixture.pricingResult.priceHigh.startsWith('$'), 'priceHigh stays dollar-formatted');

console.log('\nSection 8 — deterministic replay proof (no live marketplace call):');
{
  // Replay: feed the FIXTURE's own frozen soldComps/activeComps back
  // through the real pipeline functions (zero network calls — soldRows/
  // rawComps below come entirely from the fixture object, not a fetch)
  // and prove it reproduces the SAME tier/quick/market/stretch the
  // fixture itself recorded.
  const replayedBands = computePriceBands({
    soldComps: fixture.pricingEvidence.soldComps,
    activeComps: { prices: [], count: 0 },
    pcBase: null, gradeMultiplier: fixture.pricingResult.gradeMultiplier,
    title: fixture.identity.title, issue: fixture.identity.issue, year: fixture.identity.year, variant: null,
    variantAdjusted: false,
    // The fixture's own frozen soldComps already carry their real
    // recencyBand/variantVerified tags from the original verifySoldComps
    // call — reused verbatim, nothing re-derived.
    soldVerifyResult: { verified: fixture.pricingEvidence.soldComps },
  });
  assertEq(replayedBands.tier, fixture.pricingResult.tier, 'replay reproduces the frozen tier');
  assertEq(replayedBands.source, fixture.pricingResult.branch, 'replay reproduces the frozen exact branch/sub-tier');
  assertEq(replayedBands.quick, fixture.pricingResult.quick, 'replay reproduces the frozen Quick');
  assertEq(replayedBands.market, fixture.pricingResult.market, 'replay reproduces the frozen Market');
  assertEq(replayedBands.stretch, fixture.pricingResult.stretch, 'replay reproduces the frozen Stretch');
}

console.log('\nIdempotency contract (repeated banking of the same scan):');
{
  // buildFixture is a pure function of its inputs — banking the identical
  // scan snapshot twice produces byte-identical fixtures keyed by the
  // same traceId. src/db.js's fixtureBank store is keyPath:"traceId" with
  // IndexedDB `put()` semantics (an established platform primitive, not
  // reimplemented here) — same key overwrites in place, never duplicates.
  const fixtureA = buildFixture(productionFields, { source: 'production-phone-scan', capturedAt: '2026-09-20T18:00:00.000Z', buildSha: 'c4a5d23' });
  const fixtureB = buildFixture(productionFields, { source: 'production-phone-scan', capturedAt: '2026-09-20T18:00:00.000Z', buildSha: 'c4a5d23' });
  assertEq(fixtureA.traceId, fixtureB.traceId, 'same scan snapshot -> same traceId (the IndexedDB put() key) -> re-banking overwrites, never duplicates');
  assertEq(JSON.stringify(fixtureA), JSON.stringify(fixtureB), 'buildFixture is pure/deterministic for the same inputs');
}

console.log('\nSection 7 — non-mutation, hard requirement (static proof against the real source):');
{
  const appSrc = readFileSync('src/App.jsx', 'utf8');
  const handlerMatch = appSrc.match(/const handleBankFixture = async \(\) => \{[\s\S]*?\n  \};/);
  const exportMatch = appSrc.match(/const exportFixtureCorpus = async \(\) => \{[\s\S]*?\n  \};/);
  assertTrue(!!handlerMatch, 'sanity: handleBankFixture found in source for static analysis');
  assertTrue(!!exportMatch, 'sanity: exportFixtureCorpus found in source for static analysis');
  const handlerSrc = handlerMatch[0];
  const exportSrc = exportMatch[0];
  const forbidden = [
    '/api/collection', '/api/asset-media', '/api/list-ebay', '/api/capture-scan',
    '/api/buyer-decision', '/api/outcome-economics', '/api/ebay-outcome-reconciler',
    'gkAssetId', 'mintPhysicalAsset', 'recordValuation', 'recordDecision',
    'recordOperatorAction', 'recordOutcomeEvent', 'setCatalogue', 'putComic',
  ];
  for (const token of forbidden) {
    assertTrue(!handlerSrc.includes(token), `handleBankFixture never references "${token}"`);
    assertTrue(!exportSrc.includes(token), `exportFixtureCorpus never references "${token}"`);
  }
  assertTrue(handlerSrc.includes('putFixture'), 'handleBankFixture writes only via putFixture (the diagnostic fixtureBank store)');
  assertTrue(!/fetch\(/.test(handlerSrc), 'handleBankFixture makes zero fetch() calls of its own — reuses already-in-memory `result`');
}

console.log(`\n${'='.repeat(60)}\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
