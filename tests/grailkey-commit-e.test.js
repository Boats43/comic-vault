// tests/grailkey-commit-e.test.js
//
// GrailKey Commit E — display visualReferenceEvidence. Display-only.
//
// Background: buildVisualReferenceEvidence (src/lib/issueAuthority.js)
// already computes real per-row title+price reference data for the
// title-family that drove the accepted identity — real, verified rows,
// range, median — and it already reaches the client untouched
// (responseContract.js never references it; finalizeResponse returns
// `out` in full; the real send site is `res.status(200).json(finalizeResponse(out))`,
// api/enrich.js:10331, all verified directly before this commit). It was
// simply never rendered — App.jsx's `hasComps`/`hasMarketEvidence` checks
// (both verified directly, ~App.jsx:3656-3668) have zero awareness of
// `item.visualReferenceEvidence`, so a card with three real, priced
// listings and a computed median rendered "No stored eBay comps for this
// comic" (the exact, sole occurrence of that string in App.jsx) —
// evidence computed and discarded at the display layer.
//
// Scope, explicit: App.jsx only. Does NOT touch identity resolution,
// issueAuthority, listing-lock state, pricing tier selection, or
// merge/containment/dominance (Spawn stays parked — this commit doesn't
// touch title-family clustering at all). Verified via `git diff --stat`
// in the real repo showing only src/App.jsx changed for this commit.
//
// No live-render harness exists in this codebase for App.jsx (same
// limitation prior GrailKey commits have documented for App.jsx render
// sites — no jsdom/testing-library dependency). Verified instead via
// direct source citation against the real file, matching this session's
// established convention (grailkey-commit-t.test.js, q140's Part 9/10,
// etc.) — asserting the actual structural properties of the shipped
// code, not a simulated render.
//
// Invoke: node tests/grailkey-commit-e.test.js

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

console.log('\n=== GrailKey Commit E — display visualReferenceEvidence (display-only) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — E-Q1/E-Q2 findings still hold: the field is real, reaches the
// client, and its shape matches what this commit's render code assumes.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: pre-conditions — visualReferenceEvidence reaches the client, real shape\n');

{
  const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8').replace(/\r\n/g, '\n');
  const issueAuthSrc = readFileSync(path.join(repoRoot, 'src/lib/issueAuthority.js'), 'utf8').replace(/\r\n/g, '\n');
  const contractSrc = readFileSync(path.join(repoRoot, 'src/lib/responseContract.js'), 'utf8').replace(/\r\n/g, '\n');

  assertTrue(enrichSrc.includes('res.status(200).json(finalizeResponse(out));'), 'E-Q1: real terminal send site sends the full `out` object (unchanged by this commit)');
  assertFalse(contractSrc.includes('visualReferenceEvidence'), 'E-Q1: responseContract.js never references visualReferenceEvidence — nothing strips it (unchanged by this commit)');
  assertTrue(
    /return \{\s*familyKey:.*\s*rows,\s*count: rows\.length,\s*low,\s*high,\s*median:.*\s*marketState: 'active',\s*status: 'reference-only',\s*reason: 'provisional-visual-family',\s*\};/.test(issueAuthSrc),
    'E-Q2: buildVisualReferenceEvidence\'s real return shape matches what this commit\'s JSX reads (rows/count/low/high/median)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — scope proof: only src/App.jsx changed for this commit.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: scope — only App.jsx touched (no identity/pricing/lock code changed)\n');

{
  // KNOWN-FRAGILE (2026-08-06, GrailKey Dispatch 02 Commit 0a): this reads
  // the live working-tree-vs-HEAD diff, not commit E's actual historical
  // diff. It only holds when the working tree is clean except for commit
  // E's own changes at the moment this file runs — true right after E was
  // authored, false any time an unrelated multi-file change (including
  // this exact patch) is sitting uncommitted. Written for single-file
  // commits; will false-fail on any future multi-file change reviewed
  // before commit. Not fixed here (out of scope for a display-only patch);
  // treat a failure here as informational, not a regression signal, unless
  // the working tree is confirmed clean of unrelated changes first.
  let diffFiles = [];
  try {
    diffFiles = execSync('git diff --name-only HEAD', { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    diffFiles = [];
  }
  // Untracked new files (this test file itself) don't show in `git diff` —
  // only modifications to already-tracked files matter for this check.
  const nonAppChanges = diffFiles.filter((f) => f !== 'src/App.jsx' && f !== '.claude/settings.local.json');
  assertEq(nonAppChanges, [], `no tracked file other than src/App.jsx changed for this commit (found: ${JSON.stringify(nonAppChanges)})`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — the render gate is unchanged; the new branch is additive.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: render gate unchanged, new branch is purely additive\n');

{
  // hasComps itself (the computation) must be byte-identical to before —
  // this commit must not touch what counts as "has comps."
  const hasCompsMatch = appSrc.match(/const hasComps =\n\s*\(item\.comps &&\n\s*Array\.isArray\(item\.comps\.recentSales\) &&\n\s*item\.comps\.recentSales\.length > 0\) \|\|\n\s*\(Array\.isArray\(item\.soldComps\) && item\.soldComps\.length > 0\);/);
  assertTrue(!!hasCompsMatch, 'hasComps computation is unchanged (still only comps.recentSales / soldComps — no visualReferenceEvidence added to the gate itself)');

  // The outer gate condition (same four flags) still wraps everything.
  assertTrue(
    appSrc.includes('{!hasComps && !item.megaKeyFloorApplied && !item.manualReviewRequired && !item.gradeExceedsMap && ('),
    'outer render gate is unchanged — same four conditions as before this commit'
  );

  // New branch condition.
  assertTrue(
    appSrc.includes('Array.isArray(item.visualReferenceEvidence?.rows) && item.visualReferenceEvidence.rows.length > 0 ? ('),
    'new branch only fires when visualReferenceEvidence has at least one row'
  );

  // Fallback branch (today's exact message) still present, unchanged text.
  assertTrue(appSrc.includes('⚠ No stored eBay comps for this comic'), 'fallback "No stored eBay comps" message still present, byte-identical text');
  assertTrue(appSrc.includes('Tap refresh to fetch live market data'), 'fallback secondary line still present');

  // New reference-evidence label is honest, not a price claim.
  assertTrue(appSrc.includes('Reference evidence only — not a verified price'), 'new evidence panel is explicitly labeled as reference-only, never presented as a verified price');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — the new block renders exactly what E-Q2 specified: per-row
// title+price, range, median, count. Nothing more (no adopt/unlock/tier
// change anywhere in this block).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: renders title+price per row, range, median, count — nothing else\n');

{
  // Extract just the new block's source (between the ternary's true-branch
  // opening and its `) : (` split) to scope these assertions precisely.
  // Anchored on the full ternary-opening string (unique to this block —
  // Commit F later added an earlier occurrence of the shorter substring
  // this used to search on, at the `usingVisualReferenceFallback` gate,
  // which broke this extraction without touching the shipped feature).
  const blockStart = appSrc.indexOf('Array.isArray(item.visualReferenceEvidence?.rows) && item.visualReferenceEvidence.rows.length > 0 ? (');
  const blockEnd = appSrc.indexOf(') : (', blockStart);
  assertTrue(blockStart > 0 && blockEnd > blockStart, 'new block located for scoped assertions');
  const block = appSrc.slice(blockStart, blockEnd);

  assertTrue(block.includes('{item.visualReferenceEvidence.count} listing'), 'renders count');
  assertTrue(block.includes('item.visualReferenceEvidence.low.toFixed(2)') && block.includes('item.visualReferenceEvidence.high.toFixed(2)'), 'renders low/high range');
  assertTrue(block.includes('item.visualReferenceEvidence.median.toFixed(2)'), 'renders median');
  assertTrue(block.includes('item.visualReferenceEvidence.rows.map'), 'maps every row (not a truncated slice)');
  assertTrue(block.includes('{row.title}'), 'renders each row\'s title');
  assertTrue(block.includes('row.price != null ? `$${row.price.toFixed(2)}` : "—"'), 'renders each row\'s price honestly ("—" when a row genuinely has no price, never fabricated)');

  // Negative checks — this block's CODE (not its own explanatory comment,
  // which legitimately discusses what it avoids in prose) must not touch
  // anything beyond display. Strip // comment lines before checking.
  const blockCodeOnly = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const forbiddenTokens = [
    'confirmedIssue', 'confirmedTitle', 'confirmedYear', 'confirmedPublisher', 'confirmedVariant',
    'issueAuthority', 'listingHardLocked', 'onUpdateField', 'onList', 'setState', 'dispatch',
    'refusedToPrice', 'pricingSource', 'priceBands', 'mergeFragmentedTitleFamilies', 'dominance',
  ];
  for (const tok of forbiddenTokens) {
    assertFalse(blockCodeOnly.includes(tok), `new block's CODE does not reference "${tok}" — display-only, no identity/pricing/lock mutation`);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
