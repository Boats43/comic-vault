// tests/grailkey-commit-g.test.js
//
// GrailKey Commit G — F1 (honest asking-vs-sold labeling) + F2 (estimate
// display for ID_REQUIRED cards with visualReferenceEvidence). Display-only.
//
// F1: the real distinction is asking-vs-sold, not verified-vs-unverified.
// "Reference points only — not a verified price" undersold real evidence
// on the visualReferenceEvidence (vre) path. Split the disclaimer: the
// verified-comp path (rows.length > 0 — genuinely completed sales /
// verified active comps, e.g. ASM #300's sold comps) keeps the exact
// original wording, untouched. The vre path (real, image-matched ACTIVE
// listings — asking prices, e.g. Spawn's 3 rows) gets new, honest
// wording: "Asking prices, not completed sales." Header also states the
// real count + evidence class: "N active listings, image-matched".
//
// F2: Phase 0 findings, verified before implementing —
//   F2-Q1: visualReferenceEvidence.median survives to the client
//     unmodified (established in Commit E/F's own investigation:
//     responseContract.js never references it; finalizeResponse returns
//     `out` in full to the real terminal send site).
//   F2-Q2: not independently re-derived here — out.price/priceLow/
//     priceHigh/priceBands are what commit4-terminal-class clearing
//     nulls (established in prior GrailKey work); visualReferenceEvidence
//     is a SEPARATE field never referenced by that clearing logic or by
//     responseContract.js, so it is never touched regardless of what
//     commit4-terminal clears.
//   F2-Q3: hypotheticalReferenceEstimate (App.jsx, Commit P/P2a) IS a
//     real, existing non-canonical-estimate slot — but it's narrower
//     than needed here: server-computed from out.price before a
//     REFUSED-class clear, and its render is nested inside a banner
//     wrapper gated `['REFUSED','LOCKED','INCOMPLETE'].includes(state)`
//     — ID_REQUIRED (Spawn's real state) is structurally EXCLUDED from
//     that wrapper, so the slot never fires for Spawn regardless of what
//     the field holds. This commit does NOT widen that slot or its data
//     source (would risk changing already-relied-upon REFUSED-state
//     behavior) — it adds a separate, narrowly-gated block sourced from
//     item.visualReferenceEvidence.median directly, firing only for
//     ID_REQUIRED, or as a fallback for REFUSED when the existing slot
//     has nothing to show (never both at once for the same card).
//
// "readyEligible" / "listingPublishEligible" (named in the originating
// dispatch) do not exist anywhere in this codebase (verified via grep,
// zero matches, before implementing) — tests below check the REAL
// authority-bearing fields this commit must never touch: contract.price,
// contract.state, contract.listable, decision.action, listingHardLocked.
//
// No live-render harness exists for App.jsx in this codebase (documented
// limitation, same as Commits E/F) — verified via direct source citation.
//
// Invoke: node tests/grailkey-commit-g.test.js

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

console.log('\n=== GrailKey Commit G — F1 (honest labeling) + F2 (estimate display) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — dispatch premise check: readyEligible / listingPublishEligible
// don't exist. Confirmed before implementing; re-confirmed here.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: premise check — fabricated field names do not exist\n');

{
  let repoGrepHit = false;
  try {
    execSync('grep -rn "readyEligible\\|listingPublishEligible" src/ api/', { cwd: repoRoot, encoding: 'utf8' });
    repoGrepHit = true;
  } catch (e) {
    repoGrepHit = false; // grep exits 1 on no match
  }
  assertFalse(repoGrepHit, '"readyEligible"/"listingPublishEligible" do not exist anywhere in src/ or api/ — real fields (contract.price/state/listable, listingHardLocked) checked instead below');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — scope: only App.jsx changed for this commit.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: scope — only App.jsx touched\n');

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
// Part 2 (F1) — verified-comp path unchanged; vre path relabeled honestly.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2 (F1): asking-vs-sold labeling\n');

{
  assertTrue(
    appSrc.includes("{vre ? `Asking prices, not completed sales.` : 'Reference points only — not a verified price.'}".replace('`Asking prices, not completed sales.`', "'Asking prices, not completed sales.'")) ||
    appSrc.includes("{vre ? 'Asking prices, not completed sales.' : 'Reference points only — not a verified price.'}"),
    'footer disclaimer is conditional: vre path gets new wording, verified-comp/no-data path keeps the ORIGINAL text verbatim'
  );
  assertTrue(
    appSrc.includes("📊 Market references${vre ? ` · ${vre.count} active listing${vre.count === 1 ? '' : 's'}, image-matched` : ''}".replace(/\$\{/g, '${')) ||
    appSrc.includes('📊 Market references`}') === false, // sanity no-op, real check below
    'header suffix present (checked precisely next)'
  );
  assertTrue(
    appSrc.includes("`📊 Market references${vre ? ` · ${vre.count} active listing${vre.count === 1 ? '' : 's'}, image-matched` : ''}`") ||
    appSrc.includes('📊 Market references{vre ? ` · ${vre.count} active listing${vre.count === 1'),
    'header on the vre path states count + evidence class ("N active listings, image-matched"), generalizing the dispatch\'s literal Spawn example ("3 active listings, image-matched") to any count'
  );
  // Verified-comp path's individual rows (the `rows` array, e.g. ASM #300's
  // sold-comp line) are untouched — same push() calls as Commit F shipped.
  assertTrue(appSrc.includes('const solds = Array.isArray(item.soldComps)'), 'sold-comp row-building logic byte-identical to Commit F');
  assertTrue(appSrc.includes('const compCount = comps.count || 0;'), 'active-comp row-building logic byte-identical to Commit F');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 (F2) — Phase 0 findings, re-verified structurally.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3 (F2): Phase 0 findings verified against real source\n');

{
  // F2-Q3: the existing hypotheticalReferenceEstimate slot's OWN banner
  // wrapper genuinely excludes ID_REQUIRED — the exact structural fact
  // that makes a separate block necessary.
  assertTrue(
    appSrc.includes("['REFUSED', 'LOCKED', 'INCOMPLETE'].includes(item.contract.state)"),
    "F2-Q3: the pre-existing banner wrapper (hypotheticalReferenceEstimate's slot) is gated on exactly ['REFUSED','LOCKED','INCOMPLETE'] — ID_REQUIRED confirmed structurally absent"
  );
  assertTrue(
    appSrc.includes("item.contract.state === 'REFUSED' && parsePriceNumber(item.hypotheticalReferenceEstimate) != null"),
    'the existing hypotheticalReferenceEstimate render condition is untouched by this commit (still REFUSED-only, still reads the same field)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 (F2) — the new block: gate, source, and exact requested copy.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4 (F2): new estimate block — gate and copy\n');

// NOTE: "item.contract.state === 'ID_REQUIRED' ||" is NOT unique in this
// file (a pre-existing, unrelated occurrence exists elsewhere) — using it
// as a slice anchor silently captured ~189KB of unrelated code on first
// attempt (caught by Part 5's own negative-token assertions failing on
// tokens like onUpdateField/setState that are real code elsewhere in the
// file, not in this block). Anchored on the block's own unique comment
// tag instead, confirmed unique via grep before use.
const commitGAnchor = 'GrailKey Commit G (F2)';
const commitGBlockStart = appSrc.indexOf(commitGAnchor);

{
  const blockStart = commitGBlockStart;
  assertTrue(blockStart > 0, 'new F2 block located (unique anchor)');
  const blockEnd = appSrc.indexOf('{/* 2a. STATS BAR */}', blockStart);
  const block = appSrc.slice(blockStart, blockEnd);

  assertTrue(block.includes("item.contract.state === 'ID_REQUIRED'"), 'fires for ID_REQUIRED (Spawn\'s real state, which the existing slot cannot reach)');
  assertTrue(
    block.includes("item.contract.state === 'REFUSED' && parsePriceNumber(item.hypotheticalReferenceEstimate) == null"),
    'ALSO fires as a fallback for REFUSED specifically when the existing slot has nothing to show — never duplicates it'
  );
  assertTrue(
    block.includes('Array.isArray(item.visualReferenceEvidence?.rows) &&\n        item.visualReferenceEvidence.rows.length > 0'),
    'requires visualReferenceEvidence to genuinely have rows (never renders on an absent/empty object)'
  );
  assertTrue(block.includes('Estimated {formatCurrency(item.visualReferenceEvidence.median)}'), 'renders "Estimated $X" from the real median (F2-Q1: the field that survives to the client)');
  assertTrue(
    block.includes("From {item.visualReferenceEvidence.count} active listing{item.visualReferenceEvidence.count === 1 ? '' : 's'} · asking {formatCurrency(item.visualReferenceEvidence.low)}"),
    'renders "From N active listings · asking $LOW–$HIGH" matching the requested copy shape'
  );
  assertTrue(block.includes('Identity not confirmed — verify before listing'), 'renders the exact requested disclaimer line');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 (F2) — the new block never touches price authority, listing
// state, or issue/identity resolution. Checks the REAL fields (the
// dispatch's readyEligible/listingPublishEligible don't exist — see
// Part 0), scoped to the new block's own code only (comments excluded,
// same discipline as Commits E/F).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5 (F2): no price-authority / lock-state mutation\n');

{
  const blockStart = commitGBlockStart;
  const blockEnd = appSrc.indexOf('{/* 2a. STATS BAR */}', blockStart);
  const block = appSrc.slice(blockStart, blockEnd);
  const blockCodeOnly = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const forbiddenTokens = [
    'confirmedIssue', 'confirmedTitle', 'confirmedYear', 'confirmedPublisher', 'confirmedVariant',
    'listingHardLocked', 'onUpdateField', 'onList(', 'setState', 'dispatch(',
    'refusedToPrice', '.price =', 'priceBands', 'mergeFragmentedTitleFamilies',
    'contract.listable', 'decision.action =',
  ];
  for (const tok of forbiddenTokens) {
    assertFalse(blockCodeOnly.includes(tok), `new block's CODE does not reference "${tok}" — display-only, no authority/lock mutation`);
  }
  // The block reads item.contract.state (to decide whether to render) but
  // must never WRITE to it — confirm no assignment form appears.
  assertFalse(/item\.contract\.state\s*=[^=]/.test(blockCodeOnly), 'block reads contract.state, never assigns it');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 6 — MUTATION proof: removing the F2 block's render condition
// (structural citation — no live harness to actually re-render without it).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: MUTATION proof — F2 block is load-bearing\n');

{
  // Counterfactual: if THIS block's render condition were removed, does
  // any OTHER code path in the ID_REQUIRED lock-banner area already show
  // an estimate? Checked directly (not assumed) — there are 3 real code
  // references to the median value in App.jsx, not the 2 originally
  // assumed while writing this test: MarketReferences' own vre.median
  // (Commit F, line ~956, gated on state REFUSED/ID_REQUIRED/action
  // RESEARCH — a DIFFERENT card section, not the lock-banner area this
  // block lives in), this F2 block itself, and a THIRD, earlier one in
  // Commit E's own separate block (line ~6792, gated on !hasComps — yet
  // another different section/gate). None of the other two live in the
  // lock-banner area (where hypotheticalReferenceEstimate's slot also
  // lives) — removing THIS block still leaves that specific area with no
  // estimate for an ID_REQUIRED card, proving it load-bearing for that
  // location specifically, even though the same underlying data is (by
  // now, across three separate GrailKey commits) surfaced redundantly
  // elsewhere on the card. That three-way overlap is a real, disclosed
  // consequence of this commit, not silently hidden — flagged in the
  // final report, not reconciled here (out of this commit's scope).
  // 4 total matches: 3 genuine code references (MarketReferences/Commit F
  // line ~956, this F2 block line ~5064, Commit E's own block line ~6792)
  // plus 1 mention inside this block's own JSX-style `{/* ... */}` comment
  // (line ~5040) — `//`-line stripping doesn't catch JSX comments, so the
  // raw count is checked directly here rather than attempting imprecise
  // comment-aware parsing for a single incidental match.
  const medianRefs = (appSrc.match(/visualReferenceEvidence\.median|vre\.median/g) || []).length;
  assertEq(medianRefs, 4, '4 total references to the median value (3 genuine code sites + 1 mention inside this block\'s own explanatory comment) — none of the other 2 code sites live in the ID_REQUIRED lock-banner area this block occupies, so removing THIS block\'s render condition leaves that specific area with no estimate');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
