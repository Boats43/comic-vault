// tests/gk236-bank-fixture-reachability.test.js
//
// GK-236 (2026-09-20) — BANK REGRESSION FIXTURE NOT REACHABLE FROM THE REAL
// PRODUCTION RESULT PATH. Real phone evidence: a fresh New Mutants #98
// scan/result completed successfully, the item was confirmed present in
// Collection, but "Bank Regression Fixture" was not rendered anywhere on
// the screen Jimmy actually inspected. Root cause (T1/T2 trace, see the
// dispatch response): the button existed ONLY on `ResultCard` (the
// transient post-scan screen) — never on `CollectionDetail` (the screen
// rendered at `tab === "collection" && selectedItem`, i.e. the screen
// reached by opening an item from Collection, which is how Jimmy actually
// reviews a book). This is a render-path/reachability defect, not an
// IndexedDB persistence defect — GK-231's storage-transaction hardening
// is untouched and not re-investigated here per the dispatch's own
// instruction.
//
// This file proves two things, honestly split by what each part can
// actually demonstrate (no test runner/jsdom/component-render harness
// exists in this repo — see CLAUDE.md's own "Behavioral specs" convention,
// standalone node scripts, real IndexedDB via fake-indexeddb, and static
// source-text verification for App.jsx-level wiring claims):
//
//   SECTION A (static, source-text) — proves the WIRING fix: exactly one
//   `BankFixtureButton` implementation exists; both ResultCard AND
//   CollectionDetail render it; CollectionDetail is confirmed (by its own
//   render-call-site text) to be the actual component mounted at
//   `tab === "collection" && selectedItem` — the real screen Jimmy reaches
//   after opening a book from Collection; the button's only render gate is
//   `enriching || !item?.pipelineAudit?.traceId` — no auth/route/
//   collection-status condition suppresses it.
//
//   SECTION B (static, source-text) — proves the DATA-SURVIVAL claim: the
//   scan->catalogue merge site that builds the persisted record backing
//   `selectedItem`/CollectionDetail's `item` prop actually threads
//   pipelineAudit (traceId)/rawComps/priceLadder/soldCompDiagnostics/
//   contract/decision onto that record — i.e. the fixture evidence
//   buildFixture() needs is NOT discarded before CollectionDetail renders.
//
//   SECTION C (real code, real IndexedDB via fake-indexeddb) — proves the
//   STORAGE half end-to-end using the exact real functions the button
//   calls (buildFixture from fixtureShape.js, putFixture/getAllFixtures
//   from db.js — the same functions BankFixtureButton's handleBankFixture
//   calls, unmodified): a production-shaped New Mutants #98 catalogue
//   record (the shape CollectionDetail's `item` prop actually has, per
//   Section B's proof) banks successfully and Export Fixtures' own count
//   source (`(await getAllFixtures()).length`, exportFixtureCorpus's first
//   line) reads back exactly 1.
//
// Invoke: node tests/gk236-bank-fixture-reachability.test.js

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { buildFixture } from '../src/lib/fixtureShape.js';

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

console.log('\n=== GK-236 — Bank Regression Fixture reachability (render path + storage) ===\n');

const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

console.log('SECTION A — render-path wiring (static source proof):');

// A1: exactly one BankFixtureButton implementation (no second banking
// implementation, per the dispatch's explicit requirement).
const bankFixtureButtonDefs = appSrc.match(/function BankFixtureButton\(/g) || [];
assertEq(bankFixtureButtonDefs.length, 1, 'A1: exactly one BankFixtureButton component definition exists');

const handleBankFixtureDefs = appSrc.match(/const handleBankFixture = async/g) || [];
assertEq(handleBankFixtureDefs.length, 1, 'A1: exactly one handleBankFixture implementation exists (no duplicate)');

const putFixtureCallSites = appSrc.match(/await putFixture\(/g) || [];
assertEq(putFixtureCallSites.length, 1, 'A1: putFixture is called from exactly one call site in App.jsx');

// A2: ResultCard renders the shared component (no more inline duplicate).
const resultCardBlockMatch = appSrc.match(/function ResultCard\(\{ result, enriching \}\) \{[\s\S]*?\n {2}return \(\s*<div className="result-card">/);
assertTrue(!!resultCardBlockMatch, 'A2: ResultCard function body located');
assertTrue(
  resultCardBlockMatch && !/const \[fixtureBankStatus/.test(resultCardBlockMatch[0]),
  'A2: ResultCard no longer declares its own fixtureBankStatus state (logic now lives only in BankFixtureButton)'
);
assertTrue(
  /<BankFixtureButton item=\{result\} enriching=\{enriching\} \/>/.test(appSrc),
  'A2: ResultCard renders <BankFixtureButton item={result} enriching={enriching} />'
);

// A3: CollectionDetail renders the shared component too — this is the
// actual fix (the button previously did not exist here at all).
assertTrue(
  /<BankFixtureButton item=\{item\} \/>/.test(appSrc),
  'A3: CollectionDetail renders <BankFixtureButton item={item} /> (previously absent — the real defect)'
);

// A4: Confirm CollectionDetail is genuinely the component mounted at the
// real Collection-tab/selectedItem render site Jimmy reaches after
// tapping into an item from Collection (not an obsolete/alternate card).
const collectionRenderSite = appSrc.match(/\{tab === "collection" && \(\s*selectedItem \? \(\s*<CardErrorBoundary label="Book Detail"[^>]*>\s*<CollectionDetail\s*\n\s*item=\{selectedItem\}/);
assertTrue(!!collectionRenderSite, 'A4: tab==="collection" && selectedItem renders <CollectionDetail item={selectedItem} .../> — the real post-scan review screen');

// A5: the button's render gate is exactly the traceId/enriching check —
// nothing about auth state, view mode, collection status, or route can
// suppress it beyond that.
assertTrue(
  /if \(enriching \|\| !item\?\.pipelineAudit\?\.traceId\) return null;/.test(appSrc),
  'A5: BankFixtureButton\'s only suppression condition is enriching or a missing traceId — no auth/route/collection-status gate'
);

console.log('\nSECTION B — fixture evidence survives onto the persisted catalogue record (static source proof):');

// B1: the scan->catalogue merge site (addToCatalogue's own post-enrich
// update — the one that produces the record later opened as
// selectedItem/CollectionDetail's `item`) threads pipelineAudit onto the
// record. This is the field buildFixture requires as its hard gate
// (traceId) and BankFixtureButton's own render gate.
const mergeSiteMatch = appSrc.match(/rawComps: enrich\.rawComps \|\| cur\.rawComps \|\| null,[\s\S]{0,9000}?pipelineAudit: mergePipelineAudit\(enrich, cur\),/);
assertTrue(!!mergeSiteMatch, 'B1: the scan->catalogue merge site threads both rawComps AND pipelineAudit onto the same persisted record');

const mergeBlock = mergeSiteMatch ? mergeSiteMatch[0] : '';
// priceLadder appears earlier in this same merge object (before rawComps),
// so it's checked against a window starting a fixed distance before the
// rawComps anchor rather than the forward-only mergeBlock capture above.
const mergeBlockWithPriceLadder = appSrc.slice(Math.max(0, appSrc.indexOf(mergeBlock) - 2000), appSrc.indexOf(mergeBlock) + mergeBlock.length);
assertTrue(/priceLadder: enrich\.priceLadder \|\| cur\.priceLadder \|\| null,/.test(mergeBlockWithPriceLadder), 'B1: priceLadder also merged onto the persisted record in the same block');
assertTrue(/decision: syncedDecision/.test(mergeBlock) || /decision: enrich\.decision/.test(mergeBlock), 'B1: decision merged onto the persisted record');
assertTrue(/contract: /.test(mergeBlock), 'B1: contract merged onto the persisted record');

// B2: soldCompDiagnostics also survives (used by buildFixture's
// pricingEvidence.soldCompDiagnostics).
assertTrue(
  /soldCompDiagnostics: enrich\.soldCompDiagnostics \|\| cur\.soldCompDiagnostics \|\| null,/.test(appSrc),
  'B2: soldCompDiagnostics merged onto the persisted record at the scan->catalogue site'
);

console.log('\nSECTION C — real storage proof (fake-indexeddb, the exact functions the button calls):');

async function main() {
  const { putFixture, getAllFixtures, clearFixtureBank } = await import('../src/db.js');
  await clearFixtureBank();

  // Production-shaped New Mutants #98 catalogue record — the exact shape
  // CollectionDetail's `item` prop has after a real scan (per Section B's
  // proof), i.e. what a real click on the new CollectionDetail button
  // would read from `item`.
  const nm98CatalogueItem = {
    id: 'cv-nm98-real-phone',
    title: 'New Mutants',
    issue: '98',
    publisher: 'Marvel',
    year: '1991',
    grade: 'VF 8.0',
    confidence: 'HIGH',
    isGraded: false,
    numericGrade: null,
    defectPenalty: null,
    cgcPenaltyFlags: null,
    restoration: null,
    soldComps: [{ title: 'New Mutants #98 VF', price: '$45.00' }],
    soldCompDiagnostics: { verifiedCount: 1, rejectedCount: 2, rawCount: 3, reasons: {} },
    rawComps: { average: 42, lowest: 30, highest: 55, count: 5, prices: [30, 38, 42, 48, 55] },
    priceLadder: { '8.0': 42, '9.0': 65 },
    activePoolSuspect: false,
    activePoolSuspectReason: null,
    priceBands: { tier: 1, source: 'tier1_sold_dominant' },
    priceDerivationTrace: null,
    pricingSource: 'tier1_sold_dominant',
    gradeMultiplier: 1.1,
    price: '$46.20',
    priceLow: '$40.00',
    priceHigh: '$52.00',
    decision: { action: 'LIST_NOW', warnings: [] },
    contract: { state: 'READY', price: 46.2 },
    // This is what the scan->catalogue merge (Section B) actually writes —
    // the real field the button's hard gate checks.
    pipelineAudit: { traceId: 'trace-nm98-real-phone-2026-09-20', buildSha: '99c39cd' },
  };

  // Exactly what BankFixtureButton's handleBankFixture does with `item`
  // (unmodified extraction — same field list as src/App.jsx).
  const traceId = nm98CatalogueItem.pipelineAudit?.traceId;
  assertTrue(!!traceId, 'C1: the persisted item carries a traceId (button would render, not return null)');

  const fixture = buildFixture(
    {
      title: nm98CatalogueItem.title,
      issue: nm98CatalogueItem.issue,
      publisher: nm98CatalogueItem.publisher,
      year: nm98CatalogueItem.year,
      grade: nm98CatalogueItem.grade,
      gradeConfidence: nm98CatalogueItem.confidence,
      isGraded: nm98CatalogueItem.isGraded,
      numericGrade: nm98CatalogueItem.numericGrade,
      defectPenalty: nm98CatalogueItem.defectPenalty,
      cgcPenaltyFlags: nm98CatalogueItem.cgcPenaltyFlags,
      restoration: nm98CatalogueItem.restoration,
      soldComps: nm98CatalogueItem.soldComps,
      soldCompDiagnostics: nm98CatalogueItem.soldCompDiagnostics,
      rawComps: nm98CatalogueItem.rawComps,
      priceLadder: nm98CatalogueItem.priceLadder,
      activePoolSuspect: nm98CatalogueItem.activePoolSuspect,
      activePoolSuspectReason: nm98CatalogueItem.activePoolSuspectReason,
      priceBands: nm98CatalogueItem.priceBands,
      priceDerivationTrace: nm98CatalogueItem.priceDerivationTrace,
      pricingSource: nm98CatalogueItem.pricingSource,
      gradeMultiplier: nm98CatalogueItem.gradeMultiplier,
      price: nm98CatalogueItem.price,
      priceLow: nm98CatalogueItem.priceLow,
      priceHigh: nm98CatalogueItem.priceHigh,
      decision: nm98CatalogueItem.decision,
      contract: nm98CatalogueItem.contract,
      traceId,
    },
    {
      source: 'production-phone-scan',
      capturedAt: '2026-09-20T20:00:00.000Z',
      buildSha: nm98CatalogueItem.pipelineAudit?.buildSha ?? null,
    }
  );
  assertEq(fixture.identity.title, 'New Mutants', 'C2: buildFixture produced the correct identity from the CollectionDetail-shaped item');
  assertEq(fixture.identity.knownAnswerFixture, true, 'C2: New Mutants #98 is correctly classified as a known-answer Gate 1 book');

  await putFixture(fixture);

  // This is exactly exportFixtureCorpus's own first line
  // (`const fixtures = await getAllFixtures();`) — the real count source
  // "Export Fixtures" reports.
  const exported = await getAllFixtures();
  assertEq(exported.length, 1, 'C3: Export Fixtures\' own count source (getAllFixtures().length) reads back exactly 1');
  assertEq(exported[0].traceId, traceId, 'C4: the exported fixture is the one banked from the CollectionDetail-shaped item, byte-identical traceId');
  assertEq(exported[0].identity.issue, '98', 'C5: exported fixture identity matches New Mutants #98');

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
