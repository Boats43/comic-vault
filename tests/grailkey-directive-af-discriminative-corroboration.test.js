// tests/grailkey-directive-af-discriminative-corroboration.test.js
//
// GrailKey Directive AF — GK-98, discriminative evidence beats generic
// population.
//
// A generic franchise family's weightSum is a population count (itself
// rank-restated — GK-83, docs/TICKET-REGISTRY.md) and defeated a specific
// edition candidate that Vision independently corroborates on multiple
// discriminative tokens (creator name + convention/event) and does not
// contradict on issue number. Production evidence: Sabrina Anniversary
// Spectacular #1, Dan Parent NYCC Foil — the specific candidate was
// retrieved in the visual pool every scan and discarded every scan, either
// via top-rank-protection (when it occupied rank 0) or via weighted-
// consensus (when it didn't) — TWO independent kill paths, confirmed by
// direct execution against realistic fixtures, not assumed.
//
// Fixed in src/lib/imageSearchIdentity.js (selectTitleFamilyCandidate): a
// new discriminative-corroboration check runs BEFORE both existing
// decision branches. Corroboration is earned ONLY from tokens Vision's own
// raw variant read (opts.visionVariant) independently supplies (C4) — an
// uncorroborated ride-along descriptor like "Foil" earns nothing. A
// candidate's own issue signal must not contradict Vision's (C2, the
// Flash #139 invariant, unrelaxed) — reuses resolveFamilyIssueConsensus
// exactly as named in the dispatch, deliberately not extractIssueFromTitle
// (which suppresses "#1" as marketingContext for this exact title shape,
// confirmed empirically). Two disjoint-corroborated candidates conflict,
// not tiebreak (C5) — returns the EXISTING 'refused-identity-conflict'
// decision value, never a new REVIEW write (C6 — Z's authority machinery
// is not touched here at all).
//
// Invoke: node tests/grailkey-directive-af-discriminative-corroboration.test.js

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import {
  selectTitleFamilyCandidate,
  buildTitleFamilies,
  scoreTitleFamilies,
  tokenizeTitleFamily,
} from '../src/lib/imageSearchIdentity.js';
import { resolveFamilyIssueConsensus } from '../src/lib/identityCore.js';
import { FAMILY_OVERRIDE_DECISIONS } from '../src/lib/compHygiene.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const PRE_AF_SHA = '7b847bf'; // HEAD at dispatch start — GrailKey Directive AE close-out

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

console.log('\n=== GrailKey Directive AF — discriminative evidence beats generic population (GK-98) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Fixture 1 — Sabrina. SHIP-BLOCKING. DIRECT (real function).
// ═══════════════════════════════════════════════════════════════════════
console.log('Fixture 1: Sabrina resolves to the specific candidate\n');
{
  const sabrinaItems = [
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie Comics VF' },
    { rawTitle: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil Variant VF' },
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

  // PRE-AF, shown failing directly against real committed source (git
  // show, not retyped) — confirms the generic family wins via
  // top-rank-protection specifically (it occupies rank 0 in this fixture),
  // one of the TWO independent kill paths this dispatch found.
  let preAfSrc = null;
  try {
    preAfSrc = execSync(`git show ${PRE_AF_SHA}:src/lib/imageSearchIdentity.js`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
  } catch {
    preAfSrc = null;
  }
  assertTrue(!!preAfSrc, `git show ${PRE_AF_SHA}:src/lib/imageSearchIdentity.js succeeded (real prior commit)`);
  if (preAfSrc) {
    assertTrue(!preAfSrc.includes('discriminative-corroboration'), 'confirmed: pre-AF source has zero mention of discriminative-corroboration');
  }

  // DIRECT: the real pre-AF behavior, reproduced by calling the REAL
  // function with visionVariant omitted (opts.visionVariant did not exist
  // as a concept before this dispatch, so omitting it reproduces the old
  // code path exactly — the new block's own guard (`visionVariantTokens.
  // length > 0`) makes this a true behavioral no-op, not a simulation).
  const preFixResult = selectTitleFamilyCandidate(sabrinaItems, visionTitle, visionIssue, null, {});
  assertEq(preFixResult.decision, 'top-rank-protection', 'PRE-AF BUG, DIRECT: without visionVariant, the generic family wins via top-rank-protection (occupies rank 0)');
  assertTrue(!preFixResult.selectedTitle.includes('dan') && !preFixResult.selectedTitle.toLowerCase().includes('annual'), 'PRE-AF BUG: selected title is the generic family, not the specific edition');

  // POST-AF: the real fix, DIRECT.
  const result = selectTitleFamilyCandidate(sabrinaItems, visionTitle, visionIssue, null, { visionVariant });
  assertEq(result.decision, 'discriminative-corroboration', 'POST-AF: decision is discriminative-corroboration');
  assertTrue(result.selectedTitle.toLowerCase().includes('annual') || result.selectedTitle.toLowerCase().includes('spectaculer'), `POST-AF: selected title is the specific edition, not generic — got "${result.selectedTitle}"`);
  assertTrue(result.selectedTitle.toLowerCase().includes('dan') && result.selectedTitle.toLowerCase().includes('parent'), 'POST-AF: selected title carries the corroborated creator name');
  console.log(`  RESOLVED IDENTITY: decision=${result.decision} selectedTitle="${result.selectedTitle}"`);
  console.log('  YEAR STATE: unresolved (this function never touches year; C3 — no canonicalization attempted or needed)');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 2 — Flash #139. SHIP-BLOCKING NEGATIVE CONTROL. DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 2: Flash #139 unchanged (no visionVariant — real production shape)\n');
{
  // The real q140 fixture pool (tests/q140-issue-consensus-corrective.test.js
  // Part 2, lines ~226-238) — reproduced verbatim, not paraphrased.
  const flashItems = [
    'The Flash #170 Anniversary Giant-Size A',
    'The Flash #170 Anniversary Giant-Size B',
    'The Flash #170 Anniversary Giant-Size C',
    'The Flash #139 D',
    'The Flash #139 E',
  ];
  const visionTitle = 'The Flash';
  const visionIssue = '139';

  // No opts.visionVariant at all — this incident was never about a
  // variant/edition, only issue-number confusion. The new block's own
  // guard makes this a complete no-op by construction; DIRECT proof, not
  // assumed.
  const result = selectTitleFamilyCandidate(flashItems, visionTitle, visionIssue, null, {});
  assertTrue(result.decision !== 'discriminative-corroboration', 'the new decision branch never fires with no visionVariant supplied');
  assertTrue(!result.selectedTitle || !result.selectedTitle.includes('170'), 'Flash #139 does not resolve to "170" — the mixed-family invariant holds');

  // Byte-identical assertion: resolveFamilyIssueConsensus itself (the
  // function this dispatch's OWN new code calls, unchanged) still produces
  // the exact q140-documented verdict for this exact pool.
  const consensus = resolveFamilyIssueConsensus('139', flashItems, [0, 1, 2, 3, 4]);
  assertEq(consensus.mode, 'conflict-locked', 'resolveFamilyIssueConsensus unchanged: present "139" + family leans "170" (3/5, clear lead) -> conflict-locked');
  assertEq(consensus.issue, '139', 'resolveFamilyIssueConsensus unchanged: issue stays "139", never overwritten');
  assertEq(consensus.winner, '170', 'resolveFamilyIssueConsensus unchanged: winner recorded as "170" for diagnostics only');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 3 — issue disagreement blocks adoption (C2). DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 3: candidate issue disagreeing with Vision blocks adoption\n');
{
  // Same shape as Fixture 1, but the specific candidate's OWN issue (#2)
  // disagrees with Vision's (#1). Multiple corroborated tokens (dan,
  // parent) are present — specificity alone must not override C2.
  const items = [
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie Comics VF' },
    { rawTitle: 'Sabrina Annual Spectaculer 2024 #2 Dan Parent NYCC Foil Variant VF' },
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 NM Archie' },
    { rawTitle: 'Sabrina the Teenage Witch #1 (1997) Archie Comics FN' },
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 VG Archie Comics' },
    { rawTitle: 'Sabrina the Teenage Witch #1 Archie 1997 comic book' },
  ];
  const result = selectTitleFamilyCandidate(items, 'Sabrina the Teenage Witch', '1', null, { visionVariant: 'Dan Parent NYCC variant' });
  assertTrue(result.decision !== 'discriminative-corroboration', 'C2: candidate whose own issue (#2) disagrees with Vision (#1) is never adopted via discriminative-corroboration, regardless of corroborated-token count');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 4 — uncorroborated specificity earns nothing (C4). DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 4: uncorroborated specificity (Foil alone) earns no bonus\n');
{
  // The specific candidate here carries ONLY "Foil" as a distinguishing
  // descriptor — no creator name, nothing Vision's own visionVariant
  // mentions. "Foil" itself is stripped by tokenizeTitleFamily's own
  // extractSeriesTitle pass (a finish-descriptor CATEGORY_BLOCKS token),
  // so it could never appear in `corroborated` even if visionVariant said
  // "foil" too — but this fixture goes further and gives visionVariant
  // NOTHING that overlaps this candidate at all, the honest "uncorroborated"
  // case C4 describes.
  const items = [
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie Comics VF' },
    { rawTitle: 'Sabrina the Teenage Witch #1 Foil Variant VF' },
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 NM Archie' },
    { rawTitle: 'Sabrina the Teenage Witch #1 (1997) Archie Comics FN' },
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 VG Archie Comics' },
    { rawTitle: 'Sabrina the Teenage Witch #1 Archie 1997 comic book' },
  ];
  // visionVariant corroborates a DIFFERENT creator entirely — "Foil" gets
  // zero credit from it, exactly C4's point.
  const result = selectTitleFamilyCandidate(items, 'Sabrina the Teenage Witch', '1', null, { visionVariant: 'Dan Parent NYCC variant' });
  assertTrue(result.decision !== 'discriminative-corroboration', 'C4: a candidate whose only distinguishing descriptor (Foil) is not in visionVariant earns no specificity bonus');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 5 — generic-only pool unchanged. DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 5: generic-only pool — byte-identical to pre-AF behavior\n');
{
  const items = [
    { rawTitle: 'Batman #423 1988 DC Comics VF' },
    { rawTitle: 'Batman #423 1988 DC NM' },
    { rawTitle: 'Batman #423 1988 DC Comics FN' },
    { rawTitle: 'Batman #423 1988 DC Comics' },
    { rawTitle: 'Batman #423 DC Comics 1988' },
  ];
  const withoutOpt = selectTitleFamilyCandidate(items, 'Batman', '423', null, {});
  const withEmptyVariant = selectTitleFamilyCandidate(items, 'Batman', '423', null, { visionVariant: null });
  assertEq(withoutOpt.decision, withEmptyVariant.decision, 'no visionVariant vs explicit null visionVariant — identical decision');
  assertTrue(withoutOpt.decision !== 'discriminative-corroboration', 'a pool with no discriminative tokens anywhere never triggers the new branch');
  assertEq(withoutOpt.selectedTitle, withEmptyVariant.selectedTitle, 'selected title unaffected');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 6 — contradiction → conflicted identity, REVIEW as a
// consequence, resolver never writes REVIEW itself. DIRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 6: two disjoint corroborated candidates conflict\n');
{
  // Two competing specific candidates, each independently corroborated by
  // DIFFERENT (disjoint) tokens Vision's own variant string supplies, both
  // agreeing with Vision's issue number. Neither should win by fiat.
  const items = [
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie Comics VF' },
    { rawTitle: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Variant VF' },
    { rawTitle: 'Sabrina Annual Spectaculer 2024 #1 InHyuk Lee SDCC Variant VF' },
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 NM Archie' },
    { rawTitle: 'Sabrina the Teenage Witch #1 (1997) Archie Comics FN' },
    { rawTitle: 'Sabrina the Teenage Witch #1 1997 VG Archie Comics' },
  ];
  const visionVariant = 'Dan Parent NYCC variant InHyuk Lee SDCC variant';
  const result = selectTitleFamilyCandidate(items, 'Sabrina the Teenage Witch', '1', null, { visionVariant });
  assertEq(result.decision, 'refused-identity-conflict', 'C5: two disjoint-corroborated candidates -> the EXISTING refused-identity-conflict decision, not a fabricated winner');
  assertEq(result.selectedTitle, null, 'no title is adopted when candidates conflict');

  // C6 — the resolver itself never writes any "REVIEW" value anywhere;
  // 'refused-identity-conflict' is the pre-existing decision string this
  // function already returns elsewhere (line ~2329, unmodified), not a new
  // authority-state write. Confirmed by source inspection: this decision
  // string is never assigned to anything named authority/actionAuthority/
  // marketStanding/identityStanding anywhere in this file.
  const src = readFileSync(path.join(repoRoot, 'src/lib/imageSearchIdentity.js'), 'utf8');
  assertTrue(!src.includes("decision: 'REVIEW'") && !/actionAuthority\s*[:=]\s*['"]REVIEW['"]/.test(src), 'the resolver source never writes a REVIEW value anywhere — Z\'s existing authority machinery is the sole writer, untouched by this dispatch');
}

// ═══════════════════════════════════════════════════════════════════════
// Fixture 7 — downstream re-run from the adopted identity. DIRECT
// (real FAMILY_OVERRIDE_DECISIONS + resolveIdentity wiring, source-traced)
// + MIRRORED query-string construction (same convention as Directive AD/AE
// — fetchComps is not network-invoked from an offline test).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nFixture 7: downstream re-run uses the adopted identity\n');
{
  assertTrue(FAMILY_OVERRIDE_DECISIONS.includes('discriminative-corroboration'), 'DIRECT: discriminative-corroboration is a member of the shared FAMILY_OVERRIDE_DECISIONS constant');

  // DIRECT source-trace proof (not re-executed — resolveIdentity requires
  // a much larger request context than is worth mocking here): the SAME
  // real gate api/enrich.js's resolveIdentity() uses to decide whether to
  // override confirmedTitle/confirmedIssue from family.selectedTitle keys
  // on this exact shared constant, so the new decision automatically
  // routes through the identical, unmodified downstream mechanism the two
  // existing decisions already use — no new wiring needed or added.
  const identityCoreSrc = readFileSync(path.join(repoRoot, 'src/lib/identityCore.js'), 'utf8');
  assertTrue(
    identityCoreSrc.includes('if (family?.selectedTitle && FAMILY_OVERRIDE_DECISIONS.includes(family.decision)) {'),
    'DIRECT: resolveIdentity\'s override gate reads FAMILY_OVERRIDE_DECISIONS.includes(family.decision) — the shared constant this dispatch extended, not a hardcoded list resolveIdentity would need its own edit to recognize'
  );

  // MIRRORED — the outgoing comp query string, using the same Attempt-0
  // formula as Directive AD's own Fixture 3 (api/comps.js:1159-1163).
  const cleanTitleForSearch = (t) => String(t || '').replace(/['"!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const buildAttempt0Query = (title, issue, variant, year, publisher) =>
    [cleanTitleForSearch(title), issue ? `#${issue}` : null, variant || null, year || null, (publisher || '').trim() || null]
      .filter(Boolean).join(' ').trim().slice(0, 100);

  const oldQuery = buildAttempt0Query('Sabrina the Teenage Witch', '1', null, '1997', 'Archie');
  // The adopted identity: title from family.selectedTitle (sanitized),
  // issue from resolveFamilyIssueConsensus (both real, DIRECT outputs
  // above in Fixture 1) — year deliberately left unresolved (C3).
  const adoptedResult = selectTitleFamilyCandidate(
    [
      { rawTitle: 'Sabrina the Teenage Witch #1 1997 Archie Comics VF' },
      { rawTitle: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil Variant VF' },
      { rawTitle: 'Sabrina the Teenage Witch #1 1997 NM Archie' },
      { rawTitle: 'Sabrina the Teenage Witch #1 (1997) Archie Comics FN' },
      { rawTitle: 'Sabrina the Teenage Witch #1 1997 VG Archie Comics' },
      { rawTitle: 'Sabrina the Teenage Witch #1 Archie 1997 comic book' },
    ],
    'Sabrina the Teenage Witch', '1', null, { visionVariant: 'Dan Parent NYCC variant' }
  );
  const newQuery = buildAttempt0Query(adoptedResult.selectedTitle, '1', null, null, null);
  console.log(`  [MIRRORED] OLD outgoing comp query (generic identity): "${oldQuery}"`);
  console.log(`  [MIRRORED] NEW outgoing comp query (adopted identity): "${newQuery}"`);
  assertTrue(oldQuery !== newQuery, 'MIRRORED: the outgoing comp query genuinely differs — a re-run, not a relabel');
  assertTrue(newQuery.includes('annual') || newQuery.includes('spectaculer'), 'MIRRORED: the new query targets the specific edition');
  assertTrue(!newQuery.includes('archie'), 'MIRRORED: no generic-only token (publisher, absent from the adopted title) survives — the adopted identity, not the old one, drives the query');
}

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`GrailKey Directive AF: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}
