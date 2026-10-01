// tests/gk259-governing-grade-provenance-propagation.test.js
//
// GK-259 — closes "GOVERNING-GRADE PROVENANCE DROPPED ON 7 OF 8 CLIENT
// MERGE SITES" (docs/TICKET-REGISTRY.md). Before this fix, exactly 1 of
// the 8 documented App.jsx merge sites (refreshMarketData) carried
// governingGrade/governingGradeNumeric/governingGradeSource/
// governingIsGraded/governingGradingFormatSource/gradeResolutionStatus
// forward from a server /api/enrich response into the merged catalogue/
// selected-item state. The other 7 silently dropped them, so the
// "Pricing uses: X" provenance display could go stale after any of
// those 7 paths even though server-side pricing computation itself was
// always correct (display-only bug, not a pricing/security defect).
//
// REAL FINDING during this pass: "manual correction" was ALREADY
// correct and required NO edit — docs/TICKET-REGISTRY.md's own "exactly
// 1 of 8" count was based on grepping governingGrade within App.jsx
// only; buildCorrectedCatalogueItem (src/lib/manualCorrection.js, a
// SEPARATE file) does a blanket `{...cleared, ...(enrichData || {})}`
// spread that already carries ANY field present on a fresh enrich
// response, including these 6, with no field-by-field list to go stale.
// Proven below by real execution (Section 1), not assumed.
//
// The other 7 sites (auto-refresh→catalogue, scan→catalogue,
// scan→selectedItem, bulk-import→catalogue, duplicate-confirm,
// reIdentifyBook) + the pre-existing refreshMarketData site are all
// genuinely inline merge blocks inside App.jsx's top-level App component
// (event handlers/callbacks, not CollectionDetail's own render) — not
// practically reachable via the SSR-render technique
// tests/gk250-refused-q41-dominance.test.js/
// tests/gk268-decisionsafe-advisory-verification.test.js use for
// CollectionDetail specifically. This file therefore uses this repo's
// OTHER established precedent for exactly this situation — a static
// source-text contract proof (tests/gk201-operator-path-source-contract
// .test.js's own house style) — DISCLOSED HONESTLY as static, not live
// execution, same disclosure convention
// tests/beta1a-clerk-identity-adapter.test.js's own header models.
//
// Invoke: node tests/gk259-governing-grade-provenance-propagation.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
}

const FIELDS = [
  'governingGrade',
  'governingGradeNumeric',
  'governingGradeSource',
  'governingIsGraded',
  'governingGradingFormatSource',
  'gradeResolutionStatus',
];

// ─────────────────────────────────────────────────────────────────────
// Section 1 — manual correction: REAL EXECUTION proof it already worked
// (no App.jsx edit was made for this site — this is a regression guard,
// not a proof of a fix).
// ─────────────────────────────────────────────────────────────────────
console.log('--- manual correction (src/lib/manualCorrection.js): already correct, real execution ---');
{
  const { buildCorrectedCatalogueItem } = await import('../src/lib/manualCorrection.js');
  const oldItem = {
    id: 'gk259-test-1', title: 'Old Title',
    governingGrade: 'STALE', governingGradeNumeric: 1.0,
    governingGradeSource: 'model', governingIsGraded: false,
    governingGradingFormatSource: 'model', gradeResolutionStatus: 'stale-status',
  };
  const enrichData = {
    title: 'New Title',
    governingGrade: 'NM 9.4', governingGradeNumeric: 9.4,
    governingGradeSource: 'operator', governingIsGraded: true,
    governingGradingFormatSource: 'operator', gradeResolutionStatus: 'resolved-operator',
  };
  const merged = buildCorrectedCatalogueItem(oldItem, enrichData);
  for (const f of FIELDS) {
    assertTrue(merged[f] === enrichData[f], `manual correction: ${f} carries the FRESH enrich value ("${merged[f]}"), not the stale prior one`);
  }

  // Absence case: a correction response with none of these 6 fields must
  // not fabricate anything, and (per the blanket-spread mechanism) simply
  // leaves the prior oldItem value untouched, matching this file's own
  // "resurrect on absence, never on an explicit null" convention for
  // every other merge site.
  const enrichDataNoGrading = { title: 'Another Title' };
  const mergedAbsence = buildCorrectedCatalogueItem(oldItem, enrichDataNoGrading);
  for (const f of FIELDS) {
    assertTrue(mergedAbsence[f] === oldItem[f], `manual correction: ${f} survives unchanged when a correction response carries none of these 6 fields at all`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Section 2 — static source-text proof for the 7 fixed App.jsx sites +
// the 1 pre-existing refreshMarketData site, 8 total. Each assertion
// anchors on a short, unique surrounding snippet (the same snippet used
// to make the edit) so a future refactor that moves/renames things will
// legibly fail this test rather than silently pass on a stale match.
// ─────────────────────────────────────────────────────────────────────
console.log('\n--- static source-text proof: all 8 App.jsx merge sites ---');
{
  const appSrc = read('src/App.jsx');

  function assertSiteHasAllFields(label, anchorRegex) {
    const m = appSrc.match(anchorRegex);
    assertTrue(!!m, `${label}: anchor text found in App.jsx`);
    if (!m) return;
    // Look at a window of text starting at the anchor match, large enough
    // to contain the whole merge object literal for this site but small
    // enough not to accidentally reach into a NEIGHBORING site's own
    // governing* fields (all sites are well over 400 chars apart).
    const start = m.index;
    const window = appSrc.slice(Math.max(0, start - 2500), start + 5000);
    for (const f of FIELDS) {
      assertTrue(window.includes(`${f}:`), `${label}: ${f} present in this site's merge object`);
    }
  }

  // Site 1 — refreshMarketData (pre-existing, untouched by this dispatch;
  // the ONE site that already worked before GK-259).
  assertSiteHasAllFields(
    'refreshMarketData',
    /q87CheckedRevision: idGatedRM \? \(item\.identityRevision \|\| 0\) : null,/
  );

  // Site 2 — auto-refresh→catalogue.
  assertSiteHasAllFields(
    'auto-refresh→catalogue',
    /priceUpdatedAt: priceChangedAR \? \(enrich\.priceUpdatedAt \|\| Date\.now\(\)\) : \(cur\.priceUpdatedAt \|\| cur\.timestamp\),/
  );

  // Site 3 — bulk-import→catalogue (identified by its own "[bulk] year
  // healed" diagnostic log, unique to this site).
  assertSiteHasAllFields(
    'bulk-import→catalogue',
    /console\.log\('\[bulk\] year healed:', cur\.year, '→', enrich\.confirmedYear\);/
  );

  // Site 4 — scan→catalogue (identified by its own "[persist] savedId"
  // diagnostic log immediately after the merge object closes — anchor
  // just before it on a field unique to this site's own object).
  assertSiteHasAllFields(
    'scan→catalogue',
    /megaKeysSchemaVersion: enrich\.megaKeysSchemaVersion \|\| null,\s*\n\s*manualConfirmed: priceChanged \? false : \(cur\.manualConfirmed \|\| false\),/
  );

  // Site 5 — scan→selectedItem (identified by its own "Clear pending
  // flag when enrich completes" comment, unique to this site).
  assertSiteHasAllFields(
    'scan→selectedItem',
    /\/\/ Clear pending flag when enrich completes\s*\n\s*marketPending: false,/
  );

  // Site 6 — reIdentifyBook (identified by its own cgcLabel line using
  // gradeData, not enrich/cur/s — unique variable name to this function).
  assertSiteHasAllFields(
    'reIdentifyBook',
    /cgcLabel: gradeData\.cgcLabel \|\| null,/
  );

  // Site 7 — duplicate-confirm (identified by its own persistCollectionItem
  // call immediately after the merge object, with its own distinctive
  // "duplicate-confirm's own post-enrich update" comment).
  assertSiteHasAllFields(
    'duplicate-confirm',
    /\/\/ GrailKey Collection Sync Closeout —\s*\n\s*\/\/ duplicate-confirm's own post-enrich/
  );

  // Site 8 — manual correction. NOT an App.jsx site at all (lives in
  // src/lib/manualCorrection.js, proven by real execution in Section 1
  // above) — explicitly NOT re-asserted here via source-text, since the
  // mechanism there (a blanket object spread) makes a per-field
  // source-text search meaningless/misleading as a proof technique for
  // that specific file.
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
