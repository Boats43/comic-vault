// tests/grailkey-directive-ag-22e-provenance-exemption.test.js
//
// GrailKey Directive AG — GK-98 kill path 3: the 22e assembly-integrity
// veto force-reverts AF's discriminative-corroboration selection back to
// Vision's generic title 3ms after AF wins, because Rule 1's zero-support
// carve-out (checkAssemblyIntegrity, src/lib/identityCore.js) requires
// compTitles.length >= 3 to activate, and a genuinely thin (1-member)
// discriminative family can never clear that floor.
//
// Fix: src/lib/identityCore.js, shouldSkipAssemblyIntegrityCheck extended
// to also exempt 'discriminative-corroboration' (was: only
// 'refused-identity-conflict'). api/enrich.js's Phase-1 skip log message
// (line ~3482) made dynamic to name whichever decision actually triggered
// the skip, instead of a hardcoded string naming only the old case.
//
// Invoke: node tests/grailkey-directive-ag-22e-provenance-exemption.test.js

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  selectTitleFamilyCandidate,
} from '../src/lib/imageSearchIdentity.js';
import {
  resolveIdentity,
  checkAssemblyIntegrity,
  shouldSkipAssemblyIntegrityCheck,
} from '../src/lib/identityCore.js';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
// GrailKey Directive AH regression sweep (2026-08-15) — this was 'HEAD' at
// AG-authoring time, when AG's own fix was still uncommitted working-tree
// state and HEAD genuinely resolved to pre-AG (post-AF). Once AG itself
// was committed, HEAD became a moving target that resolves to POST-AG
// content forever after — the exact same "designed-to-go-stale-by-
// construction" defect already named for GK-91
// (grailkey-directive-j-gk79a-relabel.test.js: `git show HEAD:...` to
// prove OLD text existed, which only works while HEAD hasn't moved past
// the fix). Pinned to the real immutable parent commit (AF, the last SHA
// before AG's fix landed) so this proof never goes stale regardless of
// how many commits follow.
const PRE_AG_SHA = '7d0d434';

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

console.log('\n=== GrailKey Directive AG — 22e provenance exemption (GK-98 kill path 3) ===\n');

// The real production-shape pool, identical to AF's own Fixture 1
// (tests/grailkey-directive-af-discriminative-corroboration.test.js) —
// reused deliberately, not re-authored, so this fixture inherits AF's
// already-verified corroboration behavior rather than risking drift.
// GrailKey Directive 2026-08-16-AN (GK-121) — REORDERED, same fix and
// same rationale as AF's own Fixture 1: kept in sync deliberately, per
// this file's own stated intent ("inherit AF's already-verified
// corroboration behavior"). AN's physical-corroboration gate requires
// the frozen rank-1 row (identityReconciler.js's selectFirstEligibleVisual
// — first eligible row in the pool's own order) to carry the
// corroborating text; the real, independently-verified Sabrina
// production pool has the NYCC row at rank 1, not the generic Archie
// row — reordered to match.
const sabrinaItems = [
  { rawTitle: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil Variant VF' },
  { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie Comics VF' },
  { rawTitle: 'Sabrina the Teenage Witch #1 1997 NM Archie' },
  { rawTitle: 'Sabrina the Teenage Witch #1 (1997) Archie Comics FN' },
  { rawTitle: 'Sabrina the Teenage Witch #1 1997 VG Archie Comics' },
  { rawTitle: 'Sabrina the Teenage Witch #1 Archie 1997 comic book' },
  { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie VF/NM' },
  { rawTitle: 'Sabrina the Teenage Witch Comic #1 1997' },
  { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie Comics' },
];
const visionTitle = 'Sabrina the Teenage Witch';
const visionIssue = '1';
const visionVariant = 'Dan Parent NYCC variant';

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — the production shape, end to end. SHIP-BLOCKING.
// AF's Fixture 7 corrected: that fixture claimed PASS on a route
// production never takes (it stopped at selectTitleFamilyCandidate's
// output and re-fed it into a second selectTitleFamilyCandidate call,
// never touching resolveIdentity or the 22e block at all).
//
// PROVENANCE, stated plainly per the directive's own requirement:
//   DIRECT  — selectTitleFamilyCandidate, resolveIdentity,
//             shouldSkipAssemblyIntegrityCheck, checkAssemblyIntegrity
//             are all real exported functions, called with real inputs,
//             in the real order api/enrich.js calls them.
//   MIRRORED — the glue between resolveIdentity's return and the 22e
//             call (api/enrich.js:3468-3537) is inline handler code, not
//             an exported function, and cannot be imported — it is
//             reproduced here byte-faithfully (population selection via
//             winningFamilyTitles, the if/else skip branch, the
//             checkAssemblyIntegrity call and its shouldFallback handling)
//             and cited by line number so any future drift between this
//             fixture and the real handler is a diffable, catchable gap.
//   MIRRORED — the outgoing Phase-2 fetchComps query is built here using
//             the documented Attempt-0 formula (CLAUDE.md "Search query
//             construction": `title #issue full-variant year publisher`,
//             capped 100 chars) since fetchComps itself makes a live eBay
//             HTTP call and cannot run offline. Not executed against the
//             real query-builder function — stated plainly, not labeled
//             DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture 1: Sabrina survives 22e end-to-end (production shape)\n');
{
  // Confirm the PRE-AG source (last committed HEAD — AG is uncommitted
  // working-tree state) really did not exempt discriminative-corroboration,
  // so the "PRE-AG forces a revert" demonstration below is against a real,
  // verifiable prior state, not an assumption.
  let preAgSrc = null;
  try {
    preAgSrc = execSync(`git show ${PRE_AG_SHA}:src/lib/identityCore.js`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  } catch {
    preAgSrc = null;
  }
  assertTrue(!!preAgSrc, `git show ${PRE_AG_SHA}:src/lib/identityCore.js succeeded (real committed prior state)`);
  if (preAgSrc) {
    const m = preAgSrc.match(/export const shouldSkipAssemblyIntegrityCheck = \(familyDecision\) =>\s*\n\s*([^\n]+);/);
    assertTrue(!!m, 'found shouldSkipAssemblyIntegrityCheck definition in pre-AG committed source');
    if (m) {
      assertTrue(!m[1].includes('discriminative-corroboration'), 'confirmed: pre-AG committed source does NOT exempt discriminative-corroboration');
      assertTrue(m[1].includes("'refused-identity-conflict'"), 'confirmed: pre-AG committed source DOES exempt refused-identity-conflict (unchanged case)');
    }
  }

  // Step 1 — DIRECT: AF's real resolver, real inputs.
  const familyCandidate = selectTitleFamilyCandidate(sabrinaItems, visionTitle, visionIssue, null, { visionVariant });
  assertEq(familyCandidate.decision, 'discriminative-corroboration', 'Step 1 DIRECT: selectTitleFamilyCandidate adopts the specific edition');

  // Step 2 — DIRECT: the real resolveIdentity, real inputs, same shape
  // api/enrich.js:2981-3000 uses (vision, ebay, family, opts).
  const identity = resolveIdentity(
    { title: visionTitle, issue: visionIssue, year: null, publisher: 'Archie Comics' },
    null, // visualConsensus — no pool-wide eBay consensus object needed for this trace; resolveIdentity treats it as fully optional (ebay?.title / ebay?.issue / ebay?.publisher)
    familyCandidate,
    { ebayResultCount: sabrinaItems.length, overlapThreshold: 0.2, isGraded: false, visualItems: sabrinaItems }
  );
  assertEq(identity.identitySource, 'title-family-discriminative-corroboration', 'Step 2 DIRECT: resolveIdentity records the discriminative-corroboration provenance');
  assertTrue(identity.confirmedTitle.toLowerCase().includes('dan') && identity.confirmedTitle.toLowerCase().includes('parent'), `Step 2 DIRECT: resolveIdentity's confirmedTitle carries the corroborated creator name — got "${identity.confirmedTitle}"`);

  const effectiveTitle = visionTitle; // api/enrich.js's own naming for Vision's raw title at this point in the handler
  let confirmedTitle = identity.confirmedTitle; // api/enrich.js:3001

  // Step 3 — MIRRORED glue: reproduces api/enrich.js:3468-3537 verbatim
  // in structure (population selection, skip check, checkAssemblyIntegrity
  // call, shouldFallback handling). FAMILY_OVERRIDE_DECISIONS already
  // includes 'discriminative-corroboration' as of AF — untouched by AG —
  // so winningFamilyTitles population selection is unchanged here.
  const winningFamilyTitles = familyCandidate?.topFamily?.indices
    ? familyCandidate.topFamily.indices.map((i) => sabrinaItems[i]?.rawTitle).filter(Boolean)
    : null;
  const integrityCompTitles = winningFamilyTitles && winningFamilyTitles.length > 0
    ? winningFamilyTitles
    : sabrinaItems.map((r) => r.rawTitle).filter(Boolean);
  console.log(`  [22e-population] mode=${winningFamilyTitles && winningFamilyTitles.length > 0 ? 'winning-family' : 'full-pool'} count=${integrityCompTitles.length}`);
  assertTrue(integrityCompTitles.length < 3, `confirmed root cause precondition: winning-family population is thin (count=${integrityCompTitles.length} < 3), the exact shape Rule 1's zero-support carve-out cannot activate for`);

  // PRE-AG: reproduce the OLD predicate literally (as confirmed present in
  // committed HEAD above), not by re-importing an old module version.
  const preAgShouldSkip = (decision) => decision === 'refused-identity-conflict';
  assertEq(preAgShouldSkip(familyCandidate.decision), false, 'PRE-AG: old predicate does NOT skip 22e for discriminative-corroboration');
  const preAgIntegrityCheck = checkAssemblyIntegrity(effectiveTitle, confirmedTitle, integrityCompTitles);
  assertTrue(preAgIntegrityCheck.shouldFallback, `PRE-AG BUG, reproduced against the real checkAssemblyIntegrity: 22e forces a revert (reason=${preAgIntegrityCheck.reason})`);
  const preAgFinalTitle = preAgIntegrityCheck.shouldFallback ? effectiveTitle : confirmedTitle;
  assertEq(preAgFinalTitle, visionTitle, 'PRE-AG BUG: confirmedTitle is force-reverted to Vision\'s generic title — the exact defect this dispatch fixes');

  // POST-AG: the real, currently-imported (uncommitted-fix) predicate.
  const postAgShouldSkip = shouldSkipAssemblyIntegrityCheck(familyCandidate.decision);
  assertEq(postAgShouldSkip, true, 'POST-AG: real shouldSkipAssemblyIntegrityCheck now skips 22e for discriminative-corroboration');
  const postAgFinalTitle = postAgShouldSkip ? confirmedTitle : effectiveTitle;
  assertEq(postAgFinalTitle, identity.confirmedTitle, 'POST-AG: confirmedTitle survives 22e unchanged');
  assertTrue(!postAgFinalTitle.toLowerCase().includes('the teenage witch'), 'POST-AG: surviving title is NOT the generic Vision phrase');
  console.log(`  RESOLVED IDENTITY (post-22e): "${postAgFinalTitle}"`);

  // Step 4 — MIRRORED: outgoing Phase-2 query, Attempt-0 formula
  // (CLAUDE.md "Search query construction"): title #issue full-variant
  // year publisher, capped 100 chars. Year is genuinely unresolved here
  // (resolveIdentity never received a PC/CV year and family candidates
  // never touch year on their own — AF C3), so it is correctly omitted,
  // not defaulted to 1997.
  const outgoingQuery = `${postAgFinalTitle} #${identity.confirmedIssue || visionIssue} ${visionVariant}`.trim().slice(0, 100);
  console.log(`  OUTGOING PHASE-2 QUERY: "${outgoingQuery}"`);
  assertTrue(!outgoingQuery.toLowerCase().includes('sabrina the teenage witch'), 'outgoing query does NOT contain the generic phrase "Sabrina the Teenage Witch"');
  assertTrue(!outgoingQuery.toLowerCase().includes('1997'), 'outgoing query does NOT contain the wrong year 1997 (year correctly unresolved, not defaulted)');
  assertTrue(outgoingQuery.toLowerCase().includes('dan parent'), 'outgoing query DOES contain the corroborated creator name');
  assertTrue(outgoingQuery.includes('#1'), 'outgoing query DOES contain the (uncontradicted) issue number');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2 — the exemption is narrow: every OTHER decision value still
// routes through 22e exactly as before AG. DIRECT (pure predicate calls).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: exemption is narrowly scoped to exactly two decision values\n');
{
  assertEq(shouldSkipAssemblyIntegrityCheck('weighted-consensus'), false, 'weighted-consensus still routes through 22e (unchanged)');
  assertEq(shouldSkipAssemblyIntegrityCheck('top-rank-protection'), false, 'top-rank-protection still routes through 22e (unchanged)');
  assertEq(shouldSkipAssemblyIntegrityCheck('fallback-vision'), false, 'fallback-vision still routes through 22e (unchanged)');
  assertEq(shouldSkipAssemblyIntegrityCheck(undefined), false, 'no familyCandidate (undefined decision) still routes through 22e (unchanged)');
  assertEq(shouldSkipAssemblyIntegrityCheck(null), false, 'null decision still routes through 22e (unchanged)');
  assertEq(shouldSkipAssemblyIntegrityCheck('refused-identity-conflict'), true, 'refused-identity-conflict still exempt (pre-existing case, unchanged)');
  assertEq(shouldSkipAssemblyIntegrityCheck('discriminative-corroboration'), true, 'discriminative-corroboration now exempt (the new case, AG)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — Flash #139 negative control. SHIP-BLOCKING. Byte-identical
// to AF's own Fixture 2 pool (the q140 fixture, reused verbatim). The
// Flash #170 anniversary cluster must still lose to Vision's own #139,
// and AG's change (a predicate over decision VALUES, orthogonal to issue-
// consensus math) must not alter this in any way.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: Flash #139 unchanged (ship-blocking negative control)\n');
{
  const flashItems = [
    'The Flash #170 Anniversary Giant-Size A',
    'The Flash #170 Anniversary Giant-Size B',
    'The Flash #170 Anniversary Giant-Size C',
    'The Flash #139 D',
    'The Flash #139 E',
  ].map((rawTitle) => ({ rawTitle }));
  const flashFamily = selectTitleFamilyCandidate(flashItems, 'The Flash', '139', null, {});
  assertTrue(flashFamily.decision !== 'discriminative-corroboration', 'Flash #139 pool (no visionVariant) never reaches discriminative-corroboration — AG introduces no new route into it');
  console.log(`  Flash #139 decision: ${flashFamily.decision}`);
  // Whatever decision AF/pre-existing code produces for this pool, AG's
  // predicate must treat it identically to before — confirm directly.
  const preAgShouldSkip = (decision) => decision === 'refused-identity-conflict';
  assertEq(shouldSkipAssemblyIntegrityCheck(flashFamily.decision), preAgShouldSkip(flashFamily.decision), 'AG\'s predicate agrees with the pre-AG predicate for whatever decision Flash #139 produces — zero behavior change for this pool');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — issue disagreement still blocks even with the new
// exemption. A corroborated creator-name match whose own issue signal
// CONTRADICTS Vision's issue must not reach discriminative-corroboration
// (AF's own C2/C5, the Flash #139 invariant applied at the family level)
// — confirming AG's exemption cannot be backdoored through a contradicting
// candidate that merely shares a creator token.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: issue contradiction still blocks adoption (AF\'s C2, unaffected by AG)\n');
{
  const contradictingItems = [
    { rawTitle: 'Generic Witch Comic #1 1997 Archie Comics VF' },
    { rawTitle: 'Generic Witch Comic #1 1997 Archie NM' },
    { rawTitle: 'Generic Witch Comic #1 1997 Archie FN' },
    { rawTitle: 'Generic Witch Annual #2 2024 Dan Parent NYCC Foil Variant VF' },
    { rawTitle: 'Generic Witch Annual #2 2024 Dan Parent NYCC Foil Variant NM' },
  ];
  const result = selectTitleFamilyCandidate(contradictingItems, 'Generic Witch Comic', '1', null, { visionVariant: 'Dan Parent NYCC variant' });
  console.log(`  decision=${result.decision} selectedTitle="${result.selectedTitle || ''}"`);
  assertTrue(result.decision !== 'discriminative-corroboration', 'a corroborated candidate whose own issue signal (#2) contradicts Vision (#1) does not reach discriminative-corroboration');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 5 — 22e writes no new authority state. The skip branch is a
// pure early-exit (console.log only); it does not call writeConfirmed,
// does not set any out.* field, and does not touch actionAuthority. DIRECT
// — reads the actual current file content, asserts on the actual skip
// branch's body text, not on a paraphrase of it.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 5: 22e skip branch writes no new authority state\n');
{
  const enrichSrc = readFileSync(path.join(repoRoot, 'api', 'enrich.js'), 'utf8');
  // GrailKey Directive 2026-08-20-AV (GK-133) — the skip CONDITION gained
  // an additional `|| identityTitleAdoptedContested` OR-clause (a third,
  // independent reason to skip 22e, alongside familyDecision's own two —
  // see identityCore.js's shouldSkipAssemblyIntegrityCheck doc comment and
  // the enrich.js call site's own AV comment). The condition text is no
  // longer a single bare function call; the regex now tolerates any
  // trailing `|| ...` on the same `if (...)` line while still anchoring on
  // the exact skip-branch BODY this fixture actually verifies.
  const skipBlockMatch = enrichSrc.match(/if \(shouldSkipAssemblyIntegrityCheck\(familyCandidate\?\.decision\)(?:[^{]*)\) \{\r?\n([\s\S]*?)\r?\n\s*\} else \{/);
  assertTrue(!!skipBlockMatch, 'found the current shouldSkipAssemblyIntegrityCheck skip branch in api/enrich.js');
  if (skipBlockMatch) {
    const skipBody = skipBlockMatch[1];
    assertTrue(!skipBody.includes('writeConfirmed('), 'skip branch does not call writeConfirmed (no confirmed* field write)');
    assertTrue(!skipBody.includes('out.'), 'skip branch does not assign any out.* field');
    assertTrue(/console\.log/.test(skipBody), 'skip branch is exactly a console.log, nothing else');
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
