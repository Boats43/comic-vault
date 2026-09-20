// tests/gk237-active-diagnostics-retention.test.js
//
// GK-237 (2026-09-20) — CORPUS EVIDENCE RETENTION dispatch. Preserves
// active-side diagnostic evidence (activePoolSuspect, activePoolSuspectReason,
// activeCompDiagnostics) through the full chain:
//   enrich/comps -> scan result -> catalogue persistence -> CollectionDetail
//   -> fixtureShape -> exported fixture
// without adding a duplicate activeComps representation and without any
// pricing behavior change.
//
// TRACE FINDINGS (see dispatch response for the full field computation/
// source map):
//   - activePoolSuspect/activePoolSuspectReason ARE computed and DO reach
//     the /api/enrich response (api/enrich.js, gated on
//     `priceBandsRaw && !out.refusedToPrice`) — but only Tier 2 of
//     computePriceBands (src/lib/priceBands.js) ever sets this key at all;
//     Tier 1/2.5/3/4 result objects never include it. The prior
//     `priceBandsRaw.activePoolSuspect || false` in api/enrich.js, and the
//     prior `activePoolSuspect ?? false` in src/lib/fixtureShape.js, both
//     silently converted "never evaluated for this tier" into an
//     affirmative "checked, pool is clean" — a fabricated negative. Fixed
//     in both places to a null-preserving trichotomy (observed true ->
//     true, observed false -> false, unavailable -> null + explicit
//     reason).
//   - Separately, activePoolSuspect/activePoolSuspectReason were NEVER
//     merged onto the persisted catalogue record at any of the 5 scan-
//     result merge sites that already merge pipelineAudit (App.jsx) — a
//     real Tier-2 `true` computed by enrich.js was silently dropped before
//     ever reaching CollectionDetail's `item` prop. Fixed via a new
//     `mergeActivePoolSuspect(enrich, prior)` (src/lib/dataQualityGuard.js),
//     applied at all 5 sites.
//   - activeCompDiagnostics: CONFIRMED, by direct inspection of
//     api/comps.js, that no active-side rejection-reason breakdown object
//     exists upstream anywhere in this codebase (unlike the sold side's
//     verifySoldComps `reasons` counters) — grepped for
//     soldCompDiagnostics/activeCompDiagnostics/activeDiagnostics/
//     activeRejected/rejectedSamples/rejected++/rejectionReasons in
//     api/comps.js: zero matches. Per the dispatch's own explicit
//     instruction, no such object is synthesized in this dispatch —
//     activeCompDiagnostics continues to serialize as null + its existing
//     disclosed reason (fixtureShape.js's own pre-existing text, unchanged).
//   - pricingEvidence.rawComps.prices (individual active listings with
//     title/price/url/date/condition) was ALREADY surviving the full chain
//     correctly (api/enrich.js's single out.rawComps construction site,
//     merged verbatim at every merge site via `enrich.rawComps || cur.rawComps
//     || null`) — this file proves that continues to hold, unchanged, not
//     regressed by anything in this dispatch.
//
// Invoke: node tests/gk237-active-diagnostics-retention.test.js

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { buildFixture } from '../src/lib/fixtureShape.js';
import { mergeActivePoolSuspect } from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};

console.log('\n=== GK-237 — Active-side diagnostic evidence retention ===\n');

const enrichSrc = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
const fixtureShapeSrc = readFileSync(new URL('../src/lib/fixtureShape.js', import.meta.url), 'utf8');
const compsSrc = readFileSync(new URL('../api/comps.js', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

console.log('SECTION A — static source proofs:');

// A1: api/enrich.js is presence-aware, not `|| false`.
assertTrue(!/out\.activePoolSuspect = priceBandsRaw\.activePoolSuspect \|\| false;/.test(enrichSrc), 'A1: api/enrich.js no longer coerces activePoolSuspect with `|| false`');
assertTrue(/hasOwnProperty\.call\(priceBandsRaw, 'activePoolSuspect'\)/.test(enrichSrc), 'A1: api/enrich.js checks key-presence before trusting activePoolSuspect');

// A2: fixtureShape.js no longer coerces with `?? false`.
assertTrue(!/activePoolSuspect: activePoolSuspect \?\? false,/.test(fixtureShapeSrc), 'A2: fixtureShape.js no longer coerces activePoolSuspect with `?? false`');
assertTrue(/activePoolSuspectValue = activePoolSuspect === true \? true : \(activePoolSuspect === false \? false : null\)/.test(fixtureShapeSrc), 'A2: fixtureShape.js preserves the true/false/null trichotomy exactly');

// A3: activeCompDiagnostics genuinely does not exist upstream — confirmed
// by absence in api/comps.js, and fixtureShape.js's disclose() still the
// only source of its null+reason (no fabricated object introduced).
const activeDiagPatterns = ['soldCompDiagnostics', 'activeCompDiagnostics', 'activeDiagnostics', 'activeRejected', 'rejectedSamples', 'rejected++', 'rejectionReasons'];
const foundInComps = activeDiagPatterns.filter((p) => compsSrc.includes(p));
assertEq(foundInComps, [], 'A3: api/comps.js still has zero active-side rejection-reason breakdown object (confirmed absent, not synthesized this dispatch)');
assertTrue(/activeCompDiagnostics = null, activeCompDiagnosticsReason = null/.test(fixtureShapeSrc) || /activeCompDiagnostics = null,/.test(fixtureShapeSrc), 'A3: fixtureShape.js still defaults activeCompDiagnostics to null (no fabricated upstream object)');

// A4: all 5 scan-result merge sites (the same 5 that merge pipelineAudit)
// now also merge activePoolSuspect via the shared helper.
const pipelineAuditSites = (appSrc.match(/pipelineAudit: mergePipelineAudit\(enrich, \w+\),/g) || []).length;
const activeSuspectSites = (appSrc.match(/\.\.\.mergeActivePoolSuspect\(enrich, \w+\),/g) || []).length;
assertTrue(pipelineAuditSites >= 5, 'A4: sanity — at least 5 pipelineAudit merge sites exist');
assertEq(activeSuspectSites, pipelineAuditSites, 'A4: mergeActivePoolSuspect is applied at exactly as many sites as pipelineAudit (no path drops it)');

// A5: rawComps.prices construction (the individual active listings with
// title/price/url) is untouched — still the single, real object-shaped
// construction site, not a second/duplicate activeComps array.
assertTrue(/out\.rawComps = rawComps \? \{/.test(enrichSrc), 'A5: out.rawComps single construction site unchanged');
assertTrue(/prices: Array\.isArray\(rawComps\.prices\)/.test(enrichSrc), 'A5: rawComps.prices array-mapping logic unchanged');
assertTrue(/title: p\?\.title \|\| null,/.test(enrichSrc) && /url: p\?\.url \|\| null,/.test(enrichSrc), 'A5: title/url fields still mapped onto each active listing entry');
assertEq((appSrc.match(/const \[.*activeComps.*\] = useState/g) || []).length, 0, 'A5: no second/duplicate activeComps array introduced in App.jsx');

console.log('\nSECTION B — mergeActivePoolSuspect (real function, all real cases):');

// B1: TRUE — enrich carries an observed true; merges onto a fresh (no
// prior) record.
const mergedTrue = mergeActivePoolSuspect(
  { activePoolSuspect: true, activePoolSuspectReason: 'active avg $4.20 / low $3.95 < 25% of sold avg $61.00 / low $58.00' },
  {}
);
assertEq(mergedTrue, { activePoolSuspect: true, activePoolSuspectReason: 'active avg $4.20 / low $3.95 < 25% of sold avg $61.00 / low $58.00' }, 'B1: observed true merges as true, with its real reason, onto a fresh record');

// B2: FALSE — Tier 2 ran and found the pool clean; false must survive as
// false, not collapse to null or be treated as "no data."
const mergedFalse = mergeActivePoolSuspect({ activePoolSuspect: false, activePoolSuspectReason: null }, {});
assertEq(mergedFalse, { activePoolSuspect: false, activePoolSuspectReason: null }, 'B2: observed false merges as false (never coerced to null or true)');

// B3: NULL, key PRESENT — a Tier 3 book; enrich explicitly sends
// activePoolSuspect: null with its own "not evaluated" reason. Must be
// trusted verbatim, including overwriting a stale prior TRUE from an
// earlier scan (Stale Authority Inheritance — a null must overwrite,
// never be treated as "no new data" just because it's falsy).
const staleTruePrior = { activePoolSuspect: true, activePoolSuspectReason: 'stale reason from a prior Tier 2 scan' };
const mergedNullOverwritesStaleTrue = mergeActivePoolSuspect(
  { activePoolSuspect: null, activePoolSuspectReason: 'not evaluated — active-pool-suspect check only runs inside Tier 2 pricing (this book priced via tier3_active_discounted)' },
  staleTruePrior
);
assertEq(
  mergedNullOverwritesStaleTrue,
  { activePoolSuspect: null, activePoolSuspectReason: 'not evaluated — active-pool-suspect check only runs inside Tier 2 pricing (this book priced via tier3_active_discounted)' },
  'B3: a present-but-null activePoolSuspect from a NEW scan overwrites a stale prior true (never silently preserved as "no new data")'
);

// B4: key ABSENT entirely (e.g. a refused-to-price response, where the
// whole priceBandsRaw block in api/enrich.js never runs at all) — the
// prior scan's own value must be preserved, not wiped to null.
const mergedPreservesPriorOnAbsence = mergeActivePoolSuspect({ /* no activePoolSuspect key at all */ }, staleTruePrior);
assertEq(mergedPreservesPriorOnAbsence, { activePoolSuspect: true, activePoolSuspectReason: 'stale reason from a prior Tier 2 scan' }, 'B4: activePoolSuspect key truly absent from enrich -> prior value preserved (a refused-to-price response must not wipe existing evidence)');

console.log('\nSECTION C — buildFixture trichotomy (real function):');

const baseFields = {
  title: 'Amazing Spider-Man', issue: '17', publisher: 'Marvel', year: '2015',
  rawComps: { average: 4.2, lowest: 3.95, highest: 4.99, count: 3, prices: [
    { price: 3.95, title: 'ASM #17 (2015) NM', url: 'https://ebay.example/1', date: '2026-09-01', condition: 'New' },
    { price: 4.20, title: 'ASM #17 (2015) VF', url: 'https://ebay.example/2', date: '2026-09-02', condition: 'Used' },
    { price: 4.99, title: 'ASM #17 (2015) NM', url: 'https://ebay.example/3', date: '2026-09-03', condition: 'New' },
  ] },
  traceId: 'trace-gk237-case',
};

// C1: observed true survives all the way into the exported fixture.
const fixtureTrue = buildFixture({ ...baseFields, activePoolSuspect: true, activePoolSuspectReason: 'active avg $4.20 / low $3.95 < 25% of sold avg $61.00 / low $58.00' }, {});
assertEq(fixtureTrue.pricingEvidence.activePoolSuspect, true, 'C1: buildFixture preserves an observed TRUE exactly');
assertEq(fixtureTrue.pricingEvidence.activePoolSuspectReason, 'active avg $4.20 / low $3.95 < 25% of sold avg $61.00 / low $58.00', 'C1: buildFixture preserves the real contamination-detection reason text for TRUE');

// C2: observed false survives as false, not null, not fabricated true.
const fixtureFalse = buildFixture({ ...baseFields, activePoolSuspect: false, activePoolSuspectReason: null }, {});
assertEq(fixtureFalse.pricingEvidence.activePoolSuspect, false, 'C2: buildFixture preserves an observed FALSE exactly (engine checked, pool was clean)');
assertEq(fixtureFalse.pricingEvidence.activePoolSuspectReason, null, 'C2: no reason needed/fabricated for an observed false');

// C3: THE CORE FIX — unavailable (null, e.g. this book's Tier 3 real
// Production case) must become null + an honest reason, never a
// fabricated false pretending the engine checked and found no problem.
const fixtureUnavailable = buildFixture({ ...baseFields, activePoolSuspect: null, activePoolSuspectReason: 'not evaluated — active-pool-suspect check only runs inside Tier 2 pricing (this book priced via tier3_active_discounted)' }, {});
assertEq(fixtureUnavailable.pricingEvidence.activePoolSuspect, null, 'C3: THE FIX — unavailable activePoolSuspect stays null in the exported fixture, never coerced to false');
assertTrue(
  typeof fixtureUnavailable.pricingEvidence.activePoolSuspectReason === 'string' && fixtureUnavailable.pricingEvidence.activePoolSuspectReason.length > 0,
  'C3: an unavailable activePoolSuspect always carries a real, non-empty disclosed reason'
);

// C3b: same proof even with NO reason supplied at all (upstream omission) —
// fixtureShape.js's own generic fallback reason must fire, never a silent
// null-with-no-explanation.
const fixtureUnavailableNoReason = buildFixture({ ...baseFields, activePoolSuspect: null }, {});
assertEq(fixtureUnavailableNoReason.pricingEvidence.activePoolSuspect, null, 'C3b: unavailable with no upstream reason still stays null (not false)');
assertTrue(
  fixtureUnavailableNoReason.pricingEvidence.activePoolSuspectReason.includes('Tier 2'),
  'C3b: fixtureShape.js supplies its own generic "not evaluated" reason when the caller passed none'
);

// C4: activeCompDiagnostics — genuinely unavailable (no such object exists
// upstream, per Section A's confirmation) — must stay null + the existing
// disclosed reason, not a fabricated empty-but-affirmative object.
assertEq(fixtureTrue.pricingEvidence.activeCompDiagnostics, null, 'C4: activeCompDiagnostics stays null (no upstream object exists — not synthesized)');
assertTrue(
  typeof fixtureTrue.pricingEvidence.activeCompDiagnosticsReason === 'string' && fixtureTrue.pricingEvidence.activeCompDiagnosticsReason.length > 0,
  'C4: activeCompDiagnostics carries its pre-existing disclosed reason, unchanged'
);

console.log('\nSECTION D — rawComps.prices (individual active listings) survives unchanged:');

assertEq(fixtureTrue.pricingEvidence.rawComps.prices.length, 3, 'D1: all 3 active listing rows survive into the exported fixture');
assertEq(fixtureTrue.pricingEvidence.rawComps.prices, baseFields.rawComps.prices, 'D2: rawComps.prices is byte-for-byte identical to the source (title/price/url/date/condition all preserved, no second activeComps array)');
assertEq(fixtureTrue.pricingEvidence.rawComps.average, 4.2, 'D3: rawComps.average preserved alongside the individual listings');

console.log('\nSECTION E — no pricing output changes:');

const fixtureWithPricing = buildFixture({
  ...baseFields,
  activePoolSuspect: null,
  activePoolSuspectReason: 'not evaluated — active-pool-suspect check only runs inside Tier 2 pricing (this book priced via tier3_active_discounted)',
  priceBands: { tier: 3, source: 'tier3_active_discounted', quick: 3.36, market: 3.57, stretch: 4.11 },
  gradeMultiplier: 0.55,
  price: '$360.59',
  decision: { action: 'RESEARCH', price: 360.59 },
}, {});
assertEq(fixtureWithPricing.pricingResult.tier, 3, 'E1: pricingResult.tier passes through unchanged');
assertEq(fixtureWithPricing.pricingResult.branch, 'tier3_active_discounted', 'E2: pricingResult.branch (exact sub-tier) passes through unchanged');
assertEq(fixtureWithPricing.pricingResult.gradeMultiplier, 0.55, 'E3: gradeMultiplier passes through unchanged (display/math divergence banked as a finding, not touched here)');
assertEq(fixtureWithPricing.pricingResult.price, '$360.59', 'E4: price passes through unchanged, production-shaped string preserved verbatim');
assertEq(fixtureWithPricing.pricingResult.decisionAction, 'RESEARCH', 'E5: decision.action passes through unchanged — no pricing/decision logic touched by this dispatch');

console.log('\nSECTION F — real IndexedDB round trip (fake-indexeddb), all three cases banked and read back distinctly:');

async function main() {
  const { putFixture, getAllFixtures, clearFixtureBank } = await import('../src/db.js');
  await clearFixtureBank();

  await putFixture({ ...fixtureTrue, traceId: 'trace-gk237-true' });
  await putFixture({ ...fixtureFalse, traceId: 'trace-gk237-false' });
  await putFixture({ ...fixtureUnavailable, traceId: 'trace-gk237-null' });

  const all = await getAllFixtures();
  assertEq(all.length, 3, 'F1: all 3 distinct-diagnostic fixtures banked (Export Fixtures count source)');

  const byTrace = Object.fromEntries(all.map((f) => [f.traceId, f]));
  assertEq(byTrace['trace-gk237-true'].pricingEvidence.activePoolSuspect, true, 'F2: TRUE case survives a real IndexedDB round trip unchanged');
  assertEq(byTrace['trace-gk237-false'].pricingEvidence.activePoolSuspect, false, 'F3: FALSE case survives a real IndexedDB round trip unchanged (not coerced to true or null)');
  assertEq(byTrace['trace-gk237-null'].pricingEvidence.activePoolSuspect, null, 'F4: unavailable/NULL case survives a real IndexedDB round trip as null (never fabricated false — the core bug this dispatch fixes)');
  assertTrue(
    byTrace['trace-gk237-null'].pricingEvidence.activePoolSuspectReason.includes('Tier 2'),
    'F5: the disclosed unavailability reason survives the round trip too'
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
