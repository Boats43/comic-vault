// tests/grailkey-dispatch-46-gk62-vision-provenance.test.js
//
// GK-62 (Dispatch 46) — convergenceSources' 'vision' slot must carry only a
// genuine Vision observation, never a manual/manual-correction value. Prior
// to this fix, api/enrich.js fed effectiveTitle/Issue/Year/Publisher (which
// blend barcode/manual values) directly into the vision slot; a manual scan
// then had its own typed value vote for itself under a false 'vision' label
// in the real, unmodified computeAxisScore/computeConvergenceScore
// (src/lib/convergenceScore.js — NOT touched by this fix, per Dispatch 46
// constraints, and re-verified below to still be the untouched Q131 version).
//
// Part 1 extracts the actual shipped `visionWasSkipped`/`rawVisionX`
// construction out of api/enrich.js via anchored regex and evals it — per
// this repo's standing test-design rule (docs/PATTERN-LIBRARY.md,
// "assert against the shipped expression, never a copy of it") — so this
// test cannot silently drift from the real code the moment either changes.
// Part 2 feeds BOTH the extracted (post-fix) logic and a hand-frozen copy
// of the OLD (pre-fix) logic through the real, unmodified computeAxisScore/
// computeConvergenceScore to produce genuine before/after convergence
// deltas across a small frozen corpus of realistic scan shapes.
//
// Invoke: node tests/grailkey-dispatch-46-gk62-vision-provenance.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeAxisScore, computeConvergenceScore } from '../src/lib/convergenceScore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GK-62 (Dispatch 46) — convergence vision-provenance fix ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — convergenceScore.js untouched (constraint compliance)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: src/lib/convergenceScore.js untouched\n');
{
  const scoreSrc = readFileSync(path.join(repoRoot, 'src/lib/convergenceScore.js'), 'utf8');
  assertTrue(
    scoreSrc.includes("title: { ebay: 90, vision: 85, pc: 60, cv: 40 }"),
    'SOURCE_WEIGHTS.title unchanged (no new manual weight added — GK-62 excludes manual, does not relabel it)'
  );
  assertTrue(
    scoreSrc.includes('export function applyIdentityConflictDemotion'),
    'Q131 applyIdentityConflictDemotion still present, untouched'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — extract the real shipped fix out of api/enrich.js
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: extract-and-eval the real shipped rawVisionX construction\n');

let visionWasSkippedSrc, rawVisionSrc;
{
  const skipMatch = enrichSrc.match(
    /const visionWasSkipped = manualIdentity === true \|\| manualCorrectionRequest\?\.valid === true;/
  );
  assertTrue(!!skipMatch, 'visionWasSkipped predicate found verbatim in api/enrich.js');
  visionWasSkippedSrc = skipMatch?.[0];

  const rawMatch = enrichSrc.match(
    /const rawVisionTitle = visionWasSkipped \? null : \(title \?\? null\);\s*\n\s*const rawVisionIssue = visionWasSkipped \? null : \(issue \?\? null\);\s*\n\s*const rawVisionYear = visionWasSkipped \? null : \(year \?\? null\);\s*\n\s*const rawVisionPublisher = visionWasSkipped \? null : \(rawPublisher \?\? null\);/
  );
  assertTrue(!!rawMatch, 'rawVisionTitle/Issue/Year/Publisher construction found verbatim in api/enrich.js');
  rawVisionSrc = rawMatch?.[0];

  assertTrue(
    enrichSrc.includes('vision: rawVisionTitle,') &&
    enrichSrc.includes('vision: rawVisionIssue,') &&
    enrichSrc.includes("vision: rawVisionYear ? (parseInt(rawVisionYear) >= 1985 ? 'modern' : 'vintage') : null,") &&
    enrichSrc.includes('vision: rawVisionPublisher,'),
    'all four convergenceSources axes (title/issue/era/publisher) read from rawVisionX, not effectiveX'
  );
  assertTrue(
    !/vision: effectiveTitle,|vision: effectiveIssue,|vision: effectivePublisher,/.test(enrichSrc) &&
    !enrichSrc.includes("vision: effectiveYear ? (parseInt(effectiveYear)"),
    'no convergenceSources axis reads effectiveX anymore (old vulnerable pattern fully gone)'
  );
  assertTrue(
    !enrichSrc.match(/vision:\s*(effectiveTitle|effectiveIssue|effectivePublisher)/) &&
    (enrichSrc.match(/effectiveTitle/g) || []).length > 0,
    'effectiveTitle itself still exists elsewhere (identity resolution untouched) — just no longer feeds convergenceSources'
  );
}

// Build a real, callable function out of the extracted source (real eval,
// not a retyped copy) — exercised against fixture manualIdentity/
// manualCorrectionRequest/title/issue/year/rawPublisher inputs below.
function buildRawVisionFn() {
  const body = `
    ${visionWasSkippedSrc}
    ${rawVisionSrc}
    return { rawVisionTitle, rawVisionIssue, rawVisionYear, rawVisionPublisher };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('manualIdentity', 'manualCorrectionRequest', 'title', 'issue', 'year', 'rawPublisher', body);
}
const computeRawVision = buildRawVisionFn();

console.log('\nPart 1b: extracted logic behaves correctly on each scan shape\n');
{
  const manualEntry = computeRawVision(true, null, 'The Witching Hour', '66', '1976', 'DC');
  assertEq(manualEntry.rawVisionTitle, null, 'manual-entry scan: rawVisionTitle is null');
  assertEq(manualEntry.rawVisionIssue, null, 'manual-entry scan: rawVisionIssue is null');
  assertEq(manualEntry.rawVisionYear, null, 'manual-entry scan: rawVisionYear is null');
  assertEq(manualEntry.rawVisionPublisher, null, 'manual-entry scan: rawVisionPublisher is null');

  const manualCorrection = computeRawVision(false, { valid: true }, 'Harley Quinn', '62', null, 'DC');
  assertEq(manualCorrection.rawVisionTitle, null, 'manual-correction scan: rawVisionTitle is null');
  assertEq(manualCorrection.rawVisionIssue, null, 'manual-correction scan: rawVisionIssue is null');

  const cameraScan = computeRawVision(false, null, 'Amazing Spider-Man', '300', '1988', 'Marvel');
  assertEq(cameraScan.rawVisionTitle, 'Amazing Spider-Man', 'camera scan: rawVisionTitle is Vision\'s real title');
  assertEq(cameraScan.rawVisionIssue, '300', 'camera scan: rawVisionIssue is Vision\'s real issue');
  assertEq(cameraScan.rawVisionYear, '1988', 'camera scan: rawVisionYear is Vision\'s real year');
  assertEq(cameraScan.rawVisionPublisher, 'Marvel', 'camera scan: rawVisionPublisher is Vision\'s real publisher');

  // Barcode scan: manualIdentity=false, manualCorrectionRequest=null, but a
  // barcodeIdentity resolved upstream (not modeled here — the fix simply
  // never consults barcodeIdentity when building rawVisionX, so Vision's
  // own title/issue/year — if Vision ran on the same image — still counts;
  // barcodeIdentity's OWN resolved fields, separately, never enter this
  // path at all, which is what "same treatment" requires).
  const barcodeScanWithVision = computeRawVision(false, null, 'Fantastic Four', '5', '1962', 'Marvel');
  assertEq(barcodeScanWithVision.rawVisionIssue, '5', 'barcode+camera scan: Vision\'s own issue still counts (not nulled just because barcode also resolved)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — frozen corpus: real computeAxisScore/computeConvergenceScore
// deltas, OLD (pre-fix) vs NEW (post-fix, extracted above)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: frozen corpus — convergence deltas via the real, unmodified scorer\n');

// OLD behavior, frozen exactly as api/enrich.js read before this fix
// (git show b79e4d1:api/enrich.js — vision: effectiveTitle/effectiveIssue/
// effectiveYear-derived/effectivePublisher). Kept here ONLY as a frozen
// comparison baseline, never as the shipped behavior.
function oldVisionSlot(effectiveTitle, effectiveIssue, effectiveYear, effectivePublisher) {
  return {
    title: effectiveTitle,
    issue: effectiveIssue,
    era: effectiveYear ? (parseInt(effectiveYear) >= 1985 ? 'modern' : 'vintage') : null,
    publisher: effectivePublisher,
  };
}

const CORPUS = [
  {
    name: 'Witching Hour #66 class — manual entry, no eBay/PC/CV corroboration',
    manualIdentity: true, manualCorrectionRequest: null,
    title: 'The Witching Hour', issue: '66', year: '1976', rawPublisher: 'DC',
    confirmed: { title: 'the witching hour', issue: '66', era: 'vintage', publisher: 'dc' },
    ebay: {}, pc: {}, cv: {}, // zero corroboration — the realistic thin-evidence case
  },
  {
    name: 'Manual correction — operator fixes issue #, no other sources',
    manualIdentity: false, manualCorrectionRequest: { valid: true },
    title: undefined, issue: '62', year: undefined, rawPublisher: undefined,
    confirmed: { title: 'harley quinn', issue: '62', era: null, publisher: 'dc' },
    ebay: {}, pc: {}, cv: {},
  },
  {
    name: 'Ordinary camera scan — Vision genuinely agrees with eBay',
    manualIdentity: false, manualCorrectionRequest: null,
    title: 'Amazing Spider-Man', issue: '300', year: '1988', rawPublisher: 'Marvel',
    confirmed: { title: 'amazing spider-man', issue: '300', era: 'modern', publisher: 'marvel' },
    ebay: { title: 'Amazing Spider-Man', issue: '300', publisher: 'Marvel' },
    pc: {}, cv: {},
  },
  {
    name: 'Manual entry WITH real eBay corroboration (manual value happens to be right)',
    manualIdentity: true, manualCorrectionRequest: null,
    title: 'Fantastic Four', issue: '5', year: '1962', rawPublisher: 'Marvel',
    confirmed: { title: 'fantastic four', issue: '5', era: 'vintage', publisher: 'marvel' },
    ebay: { title: 'Fantastic Four', issue: '5', publisher: 'Marvel' },
    pc: {}, cv: {},
  },
];

console.log('  scan                                                | OLD score | NEW score | delta');
console.log('  -----------------------------------------------------|-----------|-----------|------');
for (const c of CORPUS) {
  const raw = computeRawVision(c.manualIdentity, c.manualCorrectionRequest, c.title, c.issue, c.year, c.rawPublisher);
  const oldSlot = oldVisionSlot(
    c.manualCorrectionRequest?.valid ? c.confirmed.title : c.title,
    c.manualCorrectionRequest?.valid ? c.confirmed.issue : c.issue,
    c.year, c.rawPublisher
  );

  const sourcesOld = {
    title: { ebay: c.ebay.title || null, vision: oldSlot.title, cv: c.cv.title || null },
    issue: { ebay: c.ebay.issue || null, vision: oldSlot.issue, pc: c.pc.issue || null, cv: c.cv.issue || null },
    era: { histogram: null, vision: oldSlot.era, pc: null, cv: null },
    publisher: { ebay: c.ebay.publisher || null, vision: oldSlot.publisher, pc: null, cv: null },
  };
  const sourcesNew = {
    title: { ebay: c.ebay.title || null, vision: raw.rawVisionTitle, cv: c.cv.title || null },
    issue: { ebay: c.ebay.issue || null, vision: raw.rawVisionIssue, pc: c.pc.issue || null, cv: c.cv.issue || null },
    era: { histogram: null, vision: raw.rawVisionYear ? (parseInt(raw.rawVisionYear) >= 1985 ? 'modern' : 'vintage') : null, pc: null, cv: null },
    publisher: { ebay: c.ebay.publisher || null, vision: raw.rawVisionPublisher, pc: null, cv: null },
  };

  const oldResult = computeConvergenceScore(c.confirmed, sourcesOld);
  const newResult = computeConvergenceScore(c.confirmed, sourcesNew);
  const delta = newResult.convergenceScore - oldResult.convergenceScore;
  console.log(
    `  ${c.name.padEnd(53)}| ${String(oldResult.convergenceScore).padStart(9)} | ${String(newResult.convergenceScore).padStart(9)} | ${delta >= 0 ? '+' : ''}${delta}`
  );

  if (c.manualIdentity || c.manualCorrectionRequest?.valid) {
    if ((c.ebay.title || c.ebay.issue || c.ebay.publisher)) {
      // Manual scan WITH real corroborating eBay evidence: NEW score should
      // still reflect that real evidence — not zero — just without the
      // manual self-vote inflating it further.
      assertTrue(newResult.convergenceScore <= oldResult.convergenceScore, `${c.name}: NEW score does not exceed OLD (no upward tuning)`);
      assertTrue(newResult.axes.issue.votes.every(v => v.source !== 'vision'), `${c.name}: no 'vision' vote present in issue axis (no corroboration to fabricate one from)`);
    } else {
      // Manual scan with ZERO other corroboration: OLD inflated to 100 via
      // pure self-agreement; NEW must drop, proving the defect is gone.
      assertTrue(newResult.convergenceScore < oldResult.convergenceScore, `${c.name}: NEW convergence DROPS vs OLD (defect removed, not a regression)`);
      assertTrue(oldResult.axes.issue?.votes.some(v => v.source === 'vision' && v.agrees === true), `${c.name}: OLD issue axis had a self-agreeing 'vision' vote (confirms the defect existed)`);
      assertTrue(!(newResult.axes.issue?.votes || []).some(v => v.source === 'vision'), `${c.name}: NEW issue axis has zero 'vision' votes (excluded, not relabeled)`);
    }
  } else {
    assertEq(newResult.convergenceScore, oldResult.convergenceScore, `${c.name}: camera scan unchanged, vision vote legitimate both ways`);
    assertTrue(newResult.axes.issue.votes.some(v => v.source === 'vision' && v.agrees === true), `${c.name}: NEW issue axis still has a legitimate self-consistent 'vision' vote (real Vision data, not excluded)`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
