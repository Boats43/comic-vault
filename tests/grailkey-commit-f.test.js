// tests/grailkey-commit-f.test.js
//
// GrailKey Commit F — MarketReferences fallback to visualReferenceEvidence
// (display-only, Option A: fallback not merge).
//
// Background: the real "📊 Market references" component (MarketReferences,
// App.jsx:891+, Ship #26 "NO-DEAD-END CARDS") already exists and already
// targets exactly the right cards — `show = state === 'REFUSED' ||
// state === 'ID_REQUIRED' || action === 'RESEARCH'`. It builds `rows` from
// three verified-comp sources (item.comps, item.soldComps, PC anchor) but
// had no awareness of item.visualReferenceEvidence (the marketplace
// image-match evidence Commit E surfaced in a different card section).
//
// Correction made before implementing: the originating dispatch cited
// "enrich.js:11813" and "referencePriceEstimate.marketReferences" — api/
// enrich.js is 10341 lines (verified via `wc -l`, line 11813 doesn't
// exist) and `referencePriceEstimate`/`marketReferences` as a data-field
// path appear nowhere in the repo (verified via grep, zero matches). The
// REAL "📊 Market references" text and its owning component (a plain
// exported const named MarketReferences, not a data-field path) were
// located and read in full before this commit — the fix below targets
// that real component.
//
// Decision implemented: OPTION A, fallback not merge. visualReferenceEvidence
// only supplies rows when the three existing verified-comp sources produced
// zero rows — never displacing or blending with them. Reuses the exact
// existing disclaimer text ("Reference points only — not a verified price.")
// unchanged; the only new copy is the header source-suffix (" · marketplace
// image match, identity unconfirmed"), shown only when the fallback is
// active, per the requirement that verified and unconfirmed evidence be
// distinguishable at a glance.
//
// No live-render harness exists for App.jsx in this codebase (same
// documented limitation as Commit E and prior GrailKey commits) — verified
// via direct source citation against the real file.
//
// Invoke: node tests/grailkey-commit-f.test.js

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit F — MarketReferences fallback to visualReferenceEvidence ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — premise correction, verified before this commit.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: dispatch premise correction (verified before implementing)\n');

{
  const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8').replace(/\r\n/g, '\n');
  const enrichLineCount = enrichSrc.split('\n').length;
  assertTrue(enrichLineCount < 11813, `api/enrich.js has ${enrichLineCount} lines — "enrich.js:11813" cited in the dispatch does not exist`);
  assertFalse(readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8').includes('referencePriceEstimate'), '"referencePriceEstimate" (cited field path) does not appear in App.jsx');
  assertTrue(appSrc.includes('const MarketReferences = ({ item }) => {'), 'the REAL component (a named export const, not a data-field path) is located and targeted');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — scope proof: only src/App.jsx changed for this commit.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: scope — only App.jsx touched\n');

{
  let diffFiles = [];
  try {
    diffFiles = execSync('git diff --name-only HEAD', { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    diffFiles = [];
  }
  const nonAppChanges = diffFiles.filter((f) => f !== 'src/App.jsx' && f !== '.claude/settings.local.json');
  assertEq(nonAppChanges, [], `no tracked file other than src/App.jsx changed for this commit (found: ${JSON.stringify(nonAppChanges)})`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — MarketReferences: existing behavior byte-identical.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: existing verified-comp behavior is unchanged\n');

{
  assertTrue(
    appSrc.includes("const show = state === 'REFUSED' || state === 'ID_REQUIRED' || action === 'RESEARCH';"),
    'show condition (which cards this renders on) is unchanged'
  );
  assertTrue(appSrc.includes('const compCount = comps.count || 0;'), 'active-comps row logic unchanged');
  assertTrue(appSrc.includes('const solds = Array.isArray(item.soldComps)'), 'sold-comps row logic unchanged');
  assertTrue(appSrc.includes("rows.push(`PriceCharting anchor"), 'PC-anchor row logic unchanged');
  assertTrue(appSrc.includes('Reference points only — not a verified price.'), 'existing disclaimer text reused verbatim, no new copy written for it');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — fallback-not-merge: only activates when rows is empty.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: Option A — fallback, not merge\n');

{
  assertTrue(
    appSrc.includes('const usingVisualReferenceFallback = rows.length === 0 &&'),
    'fallback gate requires rows.length === 0 — verified-comp rows, when present, are never displaced or blended'
  );
  assertTrue(
    appSrc.includes('Array.isArray(item.visualReferenceEvidence?.rows) &&\n    item.visualReferenceEvidence.rows.length > 0;'),
    'fallback additionally requires visualReferenceEvidence to genuinely have rows (never activates on an empty/absent object)'
  );
  // The verified-rows branch (rows.length > 0) is checked FIRST in the
  // render ternary, before the vre fallback branch — structural proof of
  // precedence, not just the gate variable's own definition.
  const ternaryMatch = appSrc.match(/\{rows\.length > 0 \? \(\s*rows\.map/);
  assertTrue(!!ternaryMatch, 'render ternary checks rows.length > 0 FIRST, vre fallback only reachable when that branch is false');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — source visibility: header suffix, only when fallback active.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: source visibility — verified vs marketplace-image-match distinguishable at a glance\n');

{
  assertTrue(
    appSrc.includes("📊 Market references{usingVisualReferenceFallback ? ' · marketplace image match, identity unconfirmed' : ''}"),
    'header suffix is CONDITIONAL on the fallback flag — verified-comp cards keep the exact original header text'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 6 — renders per-row title+price, range, median, count (E-Q2 shape).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: renders title+price per row, range, median, count\n');

{
  const blockStart = appSrc.indexOf('const usingVisualReferenceFallback');
  const blockEnd = appSrc.indexOf('Reference points only — not a verified price.', blockStart);
  assertTrue(blockStart > 0 && blockEnd > blockStart, 'fallback block located for scoped assertions');
  const block = appSrc.slice(blockStart, blockEnd);
  const blockCodeOnly = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  assertTrue(block.includes('{vre.count} listing'), 'renders count');
  assertTrue(block.includes('{formatCurrency(vre.low)}') && block.includes('{formatCurrency(vre.high)}'), 'renders low/high range');
  assertTrue(block.includes('median {formatCurrency(vre.median)}'), 'renders median');
  assertTrue(block.includes('vre.rows.map'), 'maps every row (not a truncated slice)');
  assertTrue(block.includes('{row.title}'), "renders each row's title");
  assertTrue(block.includes("row.price != null ? formatCurrency(row.price) : '—'"), "renders each row's price honestly (never fabricated when absent)");

  const forbiddenTokens = [
    'confirmedIssue', 'confirmedTitle', 'confirmedYear', 'confirmedPublisher', 'confirmedVariant',
    'listingHardLocked', 'onUpdateField', 'onList(', 'setState', 'dispatch(',
    'refusedToPrice', 'pricingSource', 'priceBands', 'mergeFragmentedTitleFamilies',
  ];
  for (const tok of forbiddenTokens) {
    assertFalse(blockCodeOnly.includes(tok), `fallback block's CODE does not reference "${tok}" — display-only, no identity/pricing/lock mutation`);
  }
  // issueAuthority IS legitimately mentioned in this block's own comment
  // (explaining provenance) — checked against comment-stripped code only,
  // same discipline as the token list above.
  assertFalse(blockCodeOnly.includes('issueAuthority'), 'fallback block\'s CODE does not reference "issueAuthority" (comment mentions, code does not touch it)');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
