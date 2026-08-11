// tests/grailkey-dispatch-47-gk39a-remove-fabricated-confidence.test.js
//
// GK-39A (Dispatch 47) — remove the hardcoded authenticationScore/
// breakdown/confidence/needsReview constants from identityAlignment, both
// render surfaces, and the listing gate that read them (deleted outright,
// not left inert — see the reasoning in docs/PATTERN-LIBRARY.md
// "Dispatch 47"). confirmedTitle/Issue/Year/Source/overrodeVision/conflicts
// stay real. alignIdentity() stays dead. convergence and its display stay
// untouched. Source-shape checks (extract-and-eval / string-presence
// against the real shipped files, per this repo's standing test-design
// rule), not reproductions.
//
// Invoke: node tests/grailkey-dispatch-47-gk39a-remove-fabricated-confidence.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeConvergenceScore } from '../src/lib/convergenceScore.js';
import { computeDecision } from '../src/lib/decisionEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8');
const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
const convergenceSrc = readFileSync(path.join(repoRoot, 'src/lib/convergenceScore.js'), 'utf8');
const decisionSrc = readFileSync(path.join(repoRoot, 'src/lib/decisionEngine.js'), 'utf8');
const identityAlignmentSrc = readFileSync(path.join(repoRoot, 'src/lib/identityAlignment.js'), 'utf8');

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

console.log('\n=== GK-39A (Dispatch 47) — fabricated confidence removed ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — api/enrich.js: identityAlignment no longer carries the constants
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: api/enrich.js — identityAlignment construction\n');
{
  // Extract the two real construction sites verbatim (extract-and-eval
  // discipline — checking string ABSENCE/PRESENCE against the actual
  // shipped source, not a retyped copy).
  const alignmentMatch = enrichSrc.match(/const alignment = \{[\s\S]*?\n    \};/);
  assertTrue(!!alignmentMatch, 'const alignment = {...} construction found');
  const alignmentBlock = alignmentMatch?.[0] || '';

  assertTrue(!alignmentBlock.includes('authenticationScore'), 'alignment object: no authenticationScore key');
  assertTrue(!alignmentBlock.includes('breakdown'), 'alignment object: no breakdown key');
  assertTrue(!/confidence:/.test(alignmentBlock), 'alignment object: no confidence key');
  assertTrue(!alignmentBlock.includes('needsReview'), 'alignment object: no needsReview key');
  assertTrue(alignmentBlock.includes('confirmedTitle'), 'alignment object: confirmedTitle still present');
  assertTrue(alignmentBlock.includes('confirmedIssue'), 'alignment object: confirmedIssue still present');
  assertTrue(alignmentBlock.includes('confirmedYear'), 'alignment object: confirmedYear still present');
  assertTrue(alignmentBlock.includes('confirmedSource'), 'alignment object: confirmedSource still present');
  assertTrue(alignmentBlock.includes('overrodeVision'), 'alignment object: overrodeVision still present');
  assertTrue(alignmentBlock.includes('conflicts'), 'alignment object: conflicts still present');

  const outMatch = enrichSrc.match(/out\.identityAlignment = \{[\s\S]*?\n      \};/);
  assertTrue(!!outMatch, 'out.identityAlignment = {...} construction found');
  const outBlock = outMatch?.[0] || '';
  assertTrue(!outBlock.includes('authenticationScore'), 'out.identityAlignment: no authenticationScore key');
  assertTrue(!outBlock.includes('breakdown'), 'out.identityAlignment: no breakdown key');
  assertTrue(!/confidence:/.test(outBlock), 'out.identityAlignment: no confidence key');
  assertTrue(!outBlock.includes('needsReview'), 'out.identityAlignment: no needsReview key');
  assertTrue(outBlock.includes('confirmedTitle') && outBlock.includes('confirmedSource') && outBlock.includes('conflicts'), 'out.identityAlignment: real fields still present');

  // Whole-file check, not just the two construction sites — no lingering
  // reference anywhere (logging, other branches, etc.).
  assertTrue(!enrichSrc.includes('alignment.authenticationScore'), 'no remaining reference to alignment.authenticationScore anywhere in api/enrich.js');
  assertTrue(!enrichSrc.includes('alignment.breakdown'), 'no remaining reference to alignment.breakdown anywhere in api/enrich.js');
  assertTrue(!enrichSrc.includes('alignment.needsReview'), 'no remaining reference to alignment.needsReview anywhere in api/enrich.js');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — src/App.jsx: no fabricated value reaches any UI surface
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: src/App.jsx — render surfaces and the listing gate\n');
{
  assertTrue(!appSrc.includes('identityAlignment?.authenticationScore'), 'no render/gate reads identityAlignment?.authenticationScore');
  assertTrue(!appSrc.includes('identityAlignment.authenticationScore'), 'no render/gate reads identityAlignment.authenticationScore');
  assertTrue(!appSrc.includes('identityAlignment.breakdown'), 'no render reads identityAlignment.breakdown');
  assertTrue(!appSrc.includes('identityAlignment.confidence'), 'no render reads identityAlignment.confidence');
  assertTrue(!appSrc.includes('identityAlignment.needsReview'), 'no render reads identityAlignment.needsReview');

  // The gate itself: deleted outright, not neutered. Both the write site
  // (onUpdateField(item, 'authenticationConfirmed', true)) and the read
  // site (needsAuthAck) must be gone — proves this was a real removal,
  // not a field left dangling on one side.
  assertTrue(!appSrc.includes('needsAuthAck'), 'needsAuthAck gate variable removed entirely');
  assertTrue(!appSrc.includes('authenticationConfirmed'), 'authenticationConfirmed field removed entirely (both read and write sites)');
  assertTrue(!appSrc.includes('LOW AUTHENTICATION'), 'the gate\'s own banner text is gone');

  // conflicts survives, independently re-gated (GK-39A explicitly keeps it).
  assertTrue(appSrc.includes('identityAlignment?.conflicts?.length > 0'), 'conflicts rendering still present, re-gated on its own presence');
  assertTrue(appSrc.includes('identityAlignment.confirmedSource'), 'confirmedSource rendering (ResultCard "ID:" line) still present');

  // The specific record-keeping comment for the removal decision must
  // exist verbatim in source, not just in the ledger doc — a future
  // reader landing in the code sees the same reasoning.
  assertTrue(
    /Deleted outright rather\s*\n\s*\/\/\s*than left inert/.test(appSrc),
    'the deliberate-removal-not-fail-safe reasoning is recorded at the deletion site itself'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — alignIdentity() still dead, convergence untouched (FORBIDDEN list)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: alignIdentity() not resurrected, convergence untouched\n');
{
  const nonTestFiles = [enrichSrc, appSrc];
  assertTrue(
    nonTestFiles.every((src) => !src.includes('alignIdentity(')),
    'alignIdentity( has zero call sites in api/enrich.js or src/App.jsx (still dead)'
  );
  assertTrue(identityAlignmentSrc.includes('export function alignIdentity'), 'alignIdentity() definition itself untouched, still exported');

  assertTrue(convergenceSrc.includes("title: { ebay: 90, vision: 85, pc: 60, cv: 40 }"), 'convergenceScore.js SOURCE_WEIGHTS byte-identical (untouched)');
  assertTrue(convergenceSrc.includes('export function applyIdentityConflictDemotion'), 'convergenceScore.js applyIdentityConflictDemotion untouched');
  assertTrue(enrichSrc.includes("computeConvergenceScore(convergenceIdentity, convergenceSources)"), 'convergence call site in api/enrich.js untouched');
  assertTrue(appSrc.includes('convergenceScore') || appSrc.includes('out.convergence') || appSrc.includes('item.convergence'), 'convergence display reference still present in App.jsx');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — decision.action provably unaffected (source-level, not fixture)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: decisionEngine.js never read these fields — decision.action unaffected by construction\n');
{
  assertTrue(!decisionSrc.includes('identityAlignment'), 'decisionEngine.js has zero references to identityAlignment (before or after this dispatch)');
  assertTrue(!decisionSrc.includes('authenticationScore'), 'decisionEngine.js has zero references to authenticationScore (before or after this dispatch)');

  // Direct behavioral proof, not just absence-of-reference: the same
  // fixture run through computeDecision with and without a fabricated
  // authenticationScore on the item produces byte-identical decisions.
  const baseItem = {
    title: 'Amazing Spider-Man', issue: '300', publisher: 'Marvel', year: '1988',
    price: 45, priceLow: 40, priceHigh: 55,
    rawComps: { count: 5, lowest: 38, highest: 60 },
    matchConfidence: { tier: 'HIGH', score: 92 },
    pricingSource: 'browse_api',
  };
  const withFabricated = { ...baseItem, identityAlignment: { authenticationScore: 90, breakdown: { title: 90, issue: 90, year: 85, publisher: 100 }, confidence: 'VERIFIED', needsReview: false } };
  const withoutFabricated = { ...baseItem, identityAlignment: { confirmedTitle: 'amazing spider-man', confirmedIssue: '300', confirmedSource: 'ebay_comp_consensus', conflicts: [] } };

  const decisionWith = computeDecision(withFabricated);
  const decisionWithout = computeDecision(withoutFabricated);
  assertEq(decisionWith.action, decisionWithout.action, 'decision.action identical with vs without fabricated identityAlignment fields');
  assertEq(JSON.stringify(decisionWith.blockers), JSON.stringify(decisionWithout.blockers), 'decision.blockers identical with vs without fabricated identityAlignment fields');
  assertEq(JSON.stringify(decisionWith.warnings), JSON.stringify(decisionWithout.warnings), 'decision.warnings identical with vs without fabricated identityAlignment fields');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — frozen corpus: no price/route/decision change from the removal
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: frozen corpus — pricing/routing untouched by this dispatch\n');
{
  // Pricing math (pricingEngine.js/priceBands.js/api/enrich.js's pricing
  // stack) has zero references to identityAlignment at all — confirmed by
  // grep before this dispatch touched anything. This is a structural
  // guarantee, not a per-book replay: nothing in the price computation
  // path can read a field this dispatch removed, because nothing in that
  // path ever read it in the first place.
  const priceBandsSrc = readFileSync(path.join(repoRoot, 'src/lib/priceBands.js'), 'utf8');
  const pricingEngineSrc = readFileSync(path.join(repoRoot, 'src/lib/pricingEngine.js'), 'utf8');
  assertTrue(!priceBandsSrc.includes('identityAlignment'), 'priceBands.js has zero references to identityAlignment');
  assertTrue(!pricingEngineSrc.includes('identityAlignment'), 'pricingEngine.js has zero references to identityAlignment');

  // Convergence itself (the real scorer, GK-62's territory) is fed from
  // convergenceSources, which reads confirmedTitle/Issue/Year/Publisher —
  // none of which this dispatch touched. Direct proof the axis inputs are
  // unchanged: same fixture, same result, computed via the real function.
  const confirmed = { title: 'amazing spider-man', issue: '300', era: 'modern', publisher: 'marvel' };
  const sources = {
    title: { ebay: 'Amazing Spider-Man', vision: 'Amazing Spider-Man', cv: null },
    issue: { ebay: '300', vision: '300', pc: null, cv: null },
    era: { histogram: 'modern', vision: 'modern', pc: null, cv: null },
    publisher: { ebay: 'Marvel', vision: 'Marvel', pc: null, cv: null },
  };
  const beforeAndAfter1 = computeConvergenceScore(confirmed, sources);
  const beforeAndAfter2 = computeConvergenceScore(confirmed, sources);
  assertEq(beforeAndAfter1.convergenceScore, beforeAndAfter2.convergenceScore, 'convergence score deterministic/unchanged for an unrelated fixture (sanity — GK-62 machinery untouched by GK-39A)');
  assertEq(beforeAndAfter1.convergenceScore, 100, 'convergence score for this fully-agreeing fixture is 100 (unaffected by identityAlignment field removal)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
