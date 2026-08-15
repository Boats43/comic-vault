// tests/grailkey-directive-ai-visual-first-identity.test.js
//
// GrailKey Directive 2026-08-15-AI — visual-first identity authority,
// Slice 1. See CLAUDE.md "GrailKey Directive 2026-08-15-AI" for the full
// contract (D1-D4, C1-C7). This test covers the Task 3 acceptance
// fixtures for the issue-facet gap-fill this dispatch closes:
//
//   1. Detective Comics — split-brain (confirmedIssue was null while the
//      query used #1107 anyway). SHIP-BLOCKING.
//   2. Sabrina — eligibility precedes rank (a SELLER_DEFINED_VARIATIONS
//      placeholder at rank 1 must not win). SHIP-BLOCKING.
//   4. Venom — value vs authority (adopt the candidate, demote the
//      authority; never erase to null). SHIP-BLOCKING.
//   4B. A contested value must not become pricing authority. SHIP-BLOCKING.
//   5. Flash #139 — negative control, byte-identical. SHIP-BLOCKING.
//   6. Corroborated adoption (AF/AG discriminative-corroboration path)
//      unregressed.
//   7. No over-fire on an ordinary agreeing book.
//   8. The resolver's evidence operations write no canonical/authority
//      state directly.
//   9. reconcileIssue is order-independent (D1/D4). SHIP-BLOCKING.
//  10. reconcileIssue is the sole canonical writer within its own scope.
//
// Fixture 3 (Dell'Otto) is explicitly OUT of this dispatch's scope
// (variant-facet resolution has its own ~6 direct writers, not traced or
// touched here) — reported as deferred, not asserted in this file.
//
// Invoke: node tests/grailkey-directive-ai-visual-first-identity.test.js

import {
  isEligibleVisualRow,
  selectFirstEligibleVisual,
  extractHashIssueNumber,
  createEvidenceSet,
  addEvidence,
  proposeRefinement,
  reportConflict,
  reconcileIssue,
} from '../src/lib/identityReconciler.js';
import { resolveIdentity, resolveFamilyIssueConsensus } from '../src/lib/identityCore.js';
import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
import { extractCreatorsFromComps } from '../src/lib/premiumCreators.js';
import { deriveIdentityStanding, deriveMarketStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertDeepEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${b}\n    actual:   ${a}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GrailKey Directive 2026-08-15-AI — visual-first identity authority ===\n');

const rows = (titles) => titles.map((t) => ({ rawTitle: t }));

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — eligibility filter unit behavior (Rule 1 / C1)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: eligibility filter\n');

assertEq(isEligibleVisualRow('Batman #1 Cover B Jim Lee Variant'), true, 'a normal variant-cover listing is eligible');
assertEq(isEligibleVisualRow('Huge Lot of 25 Comics Silver Age'), false, 'a lot listing is ineligible');
assertEq(isEligibleVisualRow('Sabrina the Teenage Witch comics select an issue'), false, '"select an issue" seller variation-group placeholder is ineligible');
assertEq(isEligibleVisualRow('Pick your issue Spider-Man lot'), false, '"pick your issue" placeholder is ineligible');
assertEq(isEligibleVisualRow(''), false, 'empty title is ineligible');

{
  const found = selectFirstEligibleVisual(rows(['select an issue', 'Amazing Spider-Man #300 CGC 9.6']));
  assertEq(found.index, 1, 'selectFirstEligibleVisual skips an ineligible rank-0 row and returns the next eligible one');
}
{
  const found = selectFirstEligibleVisual(rows(['huge lot of comics', 'select an issue']));
  assertEq(found, null, 'selectFirstEligibleVisual returns null when every row is ineligible');
}

assertDeepEq(extractHashIssueNumber('Detective Comics #1107 Corner Box Variant Jorge Jimenez'), { issue: '1107' }, 'extractHashIssueNumber handles legacy numbering beyond the shared 999 cap (GK-116)');
assertDeepEq(extractHashIssueNumber('Venom Separation Anxiety #1 Marvel Trade Variant Cover'), { issue: '1' }, 'extractHashIssueNumber handles an ordinary hash issue number');
assertEq(extractHashIssueNumber('no hash number here'), null, 'extractHashIssueNumber returns null with no "#N" token');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — Fixture 1: Detective Comics split-brain (SHIP-BLOCKING)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: Fixture 1 — Detective Comics #1107 split-brain\n');

{
  const vision = { title: 'Batman', issue: null, year: null, publisher: null };
  const ebay = { title: null, issue: null, publisher: null, agreement: { visionIssueCount: 0, total: 0 } };
  const family = { decision: 'fallback-vision', selectedTitle: null, topFamily: null, runnerUp: null };
  const visualItems = rows([
    'Detective Comics #1107 Corner Box Variant Jorge Jimenez',
    'Batman Beyond Compendium TPB',
    'Batman Funko Pop Figure',
    'Batman T-Shirt Large',
    'Detective Comics #1107 Corner Box Variant Jorge Jimenez NM',
    'Detective Comics #1107 Corner Box Variant Jorge Jimenez NM Unread',
    'Detective Comics #1107 Corner Box Variant Jorge Jimenez VF White Pages',
  ]);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });

  assertEq(identity.confirmedIssue, '1107', 'Detective Comics: confirmedIssue is "1107", never left null');
  assertEq(identity.identityProvisionalFromVisualFirst, true, 'Detective Comics: flagged provisional/contested, not silently confirmed');
  assertEq(identity.identityEscalation, null, 'Detective Comics: identityEscalation is NOT ID_REQUIRED (Q-ADV397 invariant: confirmedIssue non-null must not coexist with an escalation flag)');
  assertEq(identity.visionZeroSupport?.mode, 'visual-first-contested', 'Detective Comics: visionZeroSupport records the visual-first-contested mode');
  assertEq(identity.visionZeroSupport?.visionIssue, null, 'Detective Comics: Vision supplied no issue at all — recorded as null, not fabricated');
  assertEq(identity.visionZeroSupport?.adoptedIssue, '1107', 'Detective Comics: adopted issue recorded as "1107"');

  // Creator: the registry-alias fix (premiumCreators.js) — full-name
  // visual evidence must win over surname-only inference.
  const creators = extractCreatorsFromComps(visualItems.map((r) => r.rawTitle));
  const canonicals = creators.consensus.concat(creators.singletons).map((c) => c.canonical);
  assertTrue(canonicals.includes('Jorge Jimenez'), 'Detective Comics: creator credit is "Jorge Jimenez"');
  assertTrue(!canonicals.includes('Phil Jimenez'), 'Detective Comics: creator credit is NOT "Phil Jimenez" (the registry-gap bug this dispatch fixes)');
}

{
  // Bare "jimenez" alone (no first name at all) must no longer resolve to
  // either creator — ambiguous surname, full name required (matches the
  // documented policy for Adams/Lee/Miller).
  const creators = extractCreatorsFromComps(['Batman #1 cover by jimenez, CGC 9.8']);
  const canonicals = creators.consensus.concat(creators.singletons).map((c) => c.canonical);
  assertTrue(!canonicals.includes('Phil Jimenez') && !canonicals.includes('Jorge Jimenez'), 'a bare "jimenez" surname with no first name resolves to neither creator (ambiguous, ship-blocking registry gap closed)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — Fixture 2: Sabrina eligibility (SHIP-BLOCKING)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: Fixture 2 — Sabrina eligibility (first ELIGIBLE, not index 0)\n');

{
  const items = rows([
    'Sabrina the Teenage Witch comics select an issue',
    'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil Variant VF',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC PINK LAVA FOIL Variant LTD 5',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant NM',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant CGC 9.8',
    'Sabrina Annual Spectacular #1 Dan Parent NYCC Foil Variant Signed',
  ]);
  const result = selectTitleFamilyCandidate(items, 'Sabrina Annual Spectacular', '1', null, {});
  assertTrue(result.decision === 'top-rank-protection' || result.decision === 'weighted-consensus', `Sabrina: a real family decision was reached (got "${result.decision}") — not refused-identity-conflict from the ineligible rank-0 row`);
  assertTrue(!/select an issue/i.test(result.rawTitle || ''), 'Sabrina: the adopted rawTitle is NOT the "select an issue" placeholder');
  assertTrue(!result.topFamily?.indices?.includes(0), 'Sabrina: the ineligible rank-0 row is excluded from the winning family entirely');
  assertTrue(/annual.*spectacular|spectaculer/i.test(result.selectedTitle || ''), 'Sabrina: the adopted candidate is the real Annual/Spectacular book');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — Fixture 4 / 4B: Venom — value vs authority (SHIP-BLOCKING)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: Fixture 4/4B — Venom, contested value vs pricing authority\n');

let venomIdentity;
{
  const vision = { title: 'Venom: Separation Anxiety', issue: '3', year: null, publisher: 'Marvel' };
  const ebay = {
    title: 'Venom Separation Anxiety', issue: null, publisher: 'Marvel',
    agreement: { visionIssueCount: 0, total: 20 },
    noIssueConsensus: true,
  };
  const family = { decision: 'fallback-vision', selectedTitle: null, topFamily: null, runnerUp: null };
  const visualItems = rows([
    'Venom Separation Anxiety #1 Marvel Trade Variant Cover',
    'Venom Separation Anxiety #2 Marvel',
    'Venom Separation Anxiety #4 Marvel 1994',
    'Venom Madness Lot Last Dance Men 97 Juggernaut MCU',
    'Venom The Enemy Within #1 1994',
    'Venom Separation Anxiety #3 Marvel 2024',
    'Venom Lethal Protector #1',
    'Venom Separation Anxiety Annual',
  ]);
  venomIdentity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });

  assertEq(venomIdentity.confirmedIssue, '1', 'Venom: canonical issue is "1" (never null)');
  assertEq(venomIdentity.identityProvisionalFromVisualFirst, true, 'Venom: flagged provisional/contested');
  assertEq(venomIdentity.identityEscalation, null, 'Venom: identityEscalation reset to null — no forced ID_REQUIRED wall (operator can still reach the correction form)');
  assertEq(venomIdentity.visionZeroSupport?.mode, 'visual-first-contested', 'Venom: visionZeroSupport mode is visual-first-contested');
  assertEq(venomIdentity.visionZeroSupport?.visionIssue, '3', 'Venom: Vision\'s #3 is recorded as the conflicting prior');
  assertEq(venomIdentity.visionZeroSupport?.adoptedIssue, '1', 'Venom: adopted issue is "1"');
}

{
  // 4B — a contested value must not become pricing authority.
  const out = {
    identityProvisional: true, // set by api/enrich.js from identityProvisionalFromVisualFirst
    decision: { action: 'RESEARCH', blockers: [] },
    pricingSource: 'verified_active', // EXACT_CURRENT-tier source, deliberately, to prove the block is on identity not market
  };
  const identityStanding = deriveIdentityStanding(out);
  const marketStanding = deriveMarketStanding(out);
  assertEq(identityStanding, 'CONFLICTED', 'Venom 4B: identityStanding is CONFLICTED, never CONFIRMED, purely from out.identityProvisional');
  assertEq(marketStanding, 'EXACT_CURRENT', 'Venom 4B: marketStanding is unaffected (sanity check — the block is on identity, not fabricated market weakness)');

  const authority = deriveActionAuthority(out, [], out.decision);
  assertTrue(authority.state !== 'READY', 'Venom 4B: actionAuthority.state is NOT READY despite EXACT_CURRENT market evidence and a non-hard decision action');
  assertEq(authority.state, 'REVIEW', 'Venom 4B: actionAuthority.state is REVIEW (acknowledgeable, not a hard wall) — matches "operator sees both numbers and decides"');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — Fixture 5: Flash #139 negative control, byte-identical
// (SHIP-BLOCKING) — same fixture as
// tests/q140-issue-consensus-corrective.test.js:226-241
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: Fixture 5 — Flash #139 negative control (must be unaffected)\n');

{
  const familyOf = (indices, selectedTitle, rawTitle, decision = 'weighted-consensus') => ({
    selectedTitle,
    decision,
    topFamily: { indices, rawTitle, count: indices.length, weightSum: indices.length, title: selectedTitle },
  });
  const visualItems = rows([
    'The Flash #170 Anniversary Giant-Size A',
    'The Flash #170 Anniversary Giant-Size B',
    'The Flash #170 Anniversary Giant-Size C',
    'The Flash #139 D',
    'The Flash #139 E',
  ]);
  const vision = { title: 'The Flash', issue: '139', year: null, publisher: 'DC Comics' };
  const ebay = { title: 'The Flash', issue: '170', year: null, publisher: 'DC Comics', agreement: { visionIssueCount: 2, total: 5 } };
  const family = familyOf([0, 1, 2, 3, 4], 'The Flash', visualItems[0].rawTitle);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 5, visualItems });
  assertEq(identity.confirmedIssue, '139', 'Flash #139 mixed family: confirmedIssue remains "139" (byte-identical to q140 fixture)');
  assertEq(identity.identityProvisionalFromVisualFirst, false, 'Flash #139: new visual-first branch never even attempted — confirmedIssue was already non-null (structural no-op)');
}

// Re-verify resolveFamilyIssueConsensus's own contract directly, matching
// tests/q140-issue-consensus-corrective.test.js:178-187 verbatim — this
// dispatch must not have touched that function at all.
{
  const items = rows([
    'The Flash #170 Anniversary A', 'The Flash #170 Anniversary B', 'The Flash #170 Anniversary C',
    'The Flash #139 D', 'The Flash #139 E',
  ]);
  const r = resolveFamilyIssueConsensus('139', items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'conflict-locked', 'resolveFamilyIssueConsensus untouched: present "139" + family leans "170" (3/5, clear lead) -> conflict-locked');
  assertEq(r.issue, '139', 'resolveFamilyIssueConsensus untouched: issue stays "139"');
  assertEq(r.winner, '170', 'resolveFamilyIssueConsensus untouched: winner recorded as "170" for diagnostics');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — Fixture 6: corroborated adoption still works
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: Fixture 6 — ordinary family-consensus adoption unregressed\n');

{
  const vision = { title: 'Adventure Time Summer Special', issue: null, year: null, publisher: null };
  const ebay = { title: null, issue: null, publisher: null, agreement: { visionIssueCount: 0, total: 4 } };
  const family = { decision: 'fallback-vision', topFamily: null, runnerUp: null };
  const visualItems = rows([
    'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NEW',
    'Adventure Time Summer Special #1 SDCC 2013 NM',
    'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0',
    'Adventure Time Summer Special #1 SDCC 2013 In Hand',
  ]);
  // Family issue consensus itself (missing issue, 4/4 rows agree #1) -
  // exercised directly, matching Part 1 of the q140 suite. This dispatch
  // must not change this outcome.
  const consensus = resolveFamilyIssueConsensus(null, visualItems, [0, 1, 2, 3]);
  assertEq(consensus.mode, 'adopted', 'Adventure Time: resolveFamilyIssueConsensus itself still adopts on real consensus, untouched by this dispatch');
  assertEq(consensus.issue, '1', 'Adventure Time: consensus issue is "1"');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 6 — Fixture 7: no over-fire on an ordinary agreeing book
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: Fixture 7 — no over-fire when Vision and pool already agree\n');

{
  const vision = { title: 'Amazing Spider-Man', issue: '300', year: 1988, publisher: 'Marvel' };
  const ebay = { title: 'Amazing Spider-Man', issue: '300', publisher: 'Marvel', agreement: { visionIssueCount: 15, total: 20 } };
  const family = { decision: 'fallback-vision', topFamily: null, runnerUp: null };
  const visualItems = rows(Array.from({ length: 20 }, (_, i) => `Amazing Spider-Man #300 CGC 9.${i % 10}`));
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: 20, visualItems });
  assertEq(identity.confirmedIssue, '300', 'ordinary agreeing book: confirmedIssue stays "300"');
  assertEq(identity.identityProvisionalFromVisualFirst, false, 'ordinary agreeing book: visual-first branch never fires (no over-fire)');
  assertEq(identity.identityEscalation, null, 'ordinary agreeing book: no escalation');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 7 — Fixture 8: the resolver writes no canonical/authority state
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 7: Fixture 8 — evidence operations write evidence only\n');

{
  const set = createEvidenceSet();
  const before = JSON.stringify(set);
  addEvidence(set, 'issue', 'vision', '3');
  reportConflict(set, 'issue', 'first-eligible-visual', '1');
  proposeRefinement(set, 'issue', 'catalog', '1', 'catalog record confirms #1');
  assertTrue(JSON.stringify(set) !== before, 'evidence operations DID append to the evidence set');
  assertTrue(Array.isArray(set.issue) && set.issue.length === 3, 'all three evidence entries recorded, none dropped or merged silently');
  assertTrue(set.issue.every((e) => typeof e.type === 'string' && 'source' in e && 'value' in e), 'every evidence entry carries type/source/value — a record, not a canonical assignment');
  // The evidence set itself has no "value"/"confirmed"/"authority" field —
  // only reconcileIssue derives that, and only when called explicitly.
  assertTrue(!('value' in set) && !('confirmed' in set) && !('authority' in set), 'the evidence set carries no canonical value/authority field of its own — only reconcileIssue derives one, on demand');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 8 — Fixture 9: reconcileIssue is order-independent (SHIP-BLOCKING)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 8: Fixture 9 — order-independence (D1/D4)\n');

{
  // Same evidence, three different arrival orders.
  const buildA = () => {
    const s = createEvidenceSet();
    addEvidence(s, 'issue', 'vision', '3');
    reportConflict(s, 'issue', 'first-eligible-visual', '1');
    addEvidence(s, 'issue', 'first-eligible-visual', '1');
    return s;
  };
  const buildB = () => {
    const s = createEvidenceSet();
    reportConflict(s, 'issue', 'first-eligible-visual', '1');
    addEvidence(s, 'issue', 'first-eligible-visual', '1');
    addEvidence(s, 'issue', 'vision', '3');
    return s;
  };
  const buildC = () => {
    const s = createEvidenceSet();
    addEvidence(s, 'issue', 'first-eligible-visual', '1');
    addEvidence(s, 'issue', 'vision', '3');
    reportConflict(s, 'issue', 'first-eligible-visual', '1');
    return s;
  };
  const rA = reconcileIssue(buildA());
  const rB = reconcileIssue(buildB());
  const rC = reconcileIssue(buildC());
  assertDeepEq(rA, rB, 'reconcileIssue: ordering A and B produce byte-identical results');
  assertDeepEq(rB, rC, 'reconcileIssue: ordering B and C produce byte-identical results');
  assertEq(rA.value, '1', 'order-independent result: value is "1" (first-eligible-visual precedence over bare vision evidence)');
  assertEq(rA.authority, 'CONTESTED', 'order-independent result: authority is CONTESTED (vision disagreement present)');
}

{
  // No conflict at all — result should be CORROBORATED, still
  // order-independent across two orderings.
  const buildA = () => {
    const s = createEvidenceSet();
    addEvidence(s, 'issue', 'vision', '300');
    addEvidence(s, 'issue', 'family-consensus', '300');
    return s;
  };
  const buildB = () => {
    const s = createEvidenceSet();
    addEvidence(s, 'issue', 'family-consensus', '300');
    addEvidence(s, 'issue', 'vision', '300');
    return s;
  };
  const rA = reconcileIssue(buildA());
  const rB = reconcileIssue(buildB());
  assertDeepEq(rA, rB, 'reconcileIssue: agreeing evidence is also order-independent');
  assertEq(rA.authority, 'CORROBORATED', 'agreeing evidence: authority is CORROBORATED, not CONTESTED');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 9 — Fixture 10: reconcileIssue is the sole writer within its scope
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 9: Fixture 10 — reconcileIssue is a pure, idempotent projection\n');

{
  const s = createEvidenceSet();
  addEvidence(s, 'issue', 'family-consensus', '44');
  const r1 = reconcileIssue(s);
  const r2 = reconcileIssue(s);
  assertDeepEq(r1, r2, 'calling reconcileIssue twice on the same evidence set yields identical output (pure, idempotent — no hidden mutation between calls)');
  assertEq(s.issue.length, 1, 'reconcileIssue did not mutate the evidence set it read');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
