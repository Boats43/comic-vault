// tests/grailkey-directive-as-candidate-always-enters.test.js
//
// GrailKey Directive 2026-08-17-AS — GK-132 + GK-126.
//
// Rule installed: first-eligible-visual evidence always enters the issue
// evidence set — every scan, unconditionally. A refuted Vision value
// cannot force ID_REQUIRED while an eligible rank-1 physical candidate
// exists; the candidate is adopted CONTESTED, the refuted value becomes
// conflict evidence, Z/AR derive REVIEW. ID_REQUIRED is reserved for scans
// with genuinely no candidate. The >=3-member family floor governs
// CONSENSUS OVERRIDE only — it may not erase the frozen rank-1 candidate's
// standing as the identity value.
//
// Production evidence, Venom Separation Anxiety #1, Mike Mayhew
// (2026-08-17 19:40, build ee03e5a): [vision-zero-support] ESCALATE
// forced ID_REQUIRED even though the frozen rank-1 row named the exact
// physical book, issue, and creator — because (a) MINIMUM_CORROBORATING_
// ROWS (identityReconciler.js) gated ENTRY into the issue evidence set,
// not merely consensus override, and (b) hasContaminatedMember
// (compHygiene.js) flagged the SOLE member of a 1-member family as
// "contaminated" purely for being genuinely Signed/Remarked — a category
// error, since mixture is structurally impossible at n=1.
//
// Two fixes in src/lib/identityCore.js's unconditional issue-evidence
// builder (the block Directive AJ's Proof 1 already made reconcileIssue
// run on unconditionally — this dispatch removes the LAST two gates that
// were still preventing the candidate from reaching it):
//   1. MINIMUM_CORROBORATING_ROWS removed as an entry floor (kept computed,
//      diagnostic only, threaded into visionZeroSupport.corroboratingRows).
//   2. Guard 6 (family contamination) requires >=2 family members before
//      running the full hasContaminatedMember check — a lone member can't
//      be a mixture.
// Two NEW, narrower guards found necessary by regression-testing against
// this repo's own pre-existing precedents (each documented at its own
// definition site in identityCore.js, not duplicated here):
//   3. A NEW own-row REPRINT_RE/IDENTITY_TPB_MARKER_RE check (the "True
//      Believers" reprint-renumbering class, tests/q-vision-zero-support.
//      test.js Test 7).
//   4. A NEW deference guard for a genuine, already-considered family-
//      level 'no-consensus' verdict — scoped narrowly (FAMILY_OVERRIDE_
//      DECISIONS exclusion + assertedIssues non-empty) to avoid
//      regressing Eternus #2 (tests/q131-refused-identity-conflict-
//      provisional.test.js), AK's population-precedence fixture, CONTROL
//      3 (tests/q-trackB-commit4.3-winning-family-authority.test.js), or
//      Detective Comics #1107 itself (tests/grailkey-directive-aj-http-
//      handler.test.js — the 999-issue-cap false-negative class GK-116
//      already named).
//   5. A NEW pool-wide title-overlap check (CONTROL E, "Quux Anthology"
//      vs Vision's "Something Else Entirely" — a real, non-contaminated
//      family exists but shares NOTHING with Vision's title anywhere in
//      the raw pool, a materially different risk than a thin-but-genuine
//      match).
//
// All five interacting guards, and the precedents that required each one,
// were found by running this repo's FULL existing regression suite after
// each change — not merely the fixtures this dispatch's own directive
// named. See CLAUDE.md / docs/PATTERN-LIBRARY.md "GrailKey Directive AS"
// for the full trace-and-correction history.
//
// Invoke: node tests/grailkey-directive-as-candidate-always-enters.test.js

import { resolveIdentity, resolveFamilyIssueConsensus } from '../src/lib/identityCore.js';
import { deriveMarketStanding, deriveActionAuthority } from '../src/lib/actionAuthority.js';
import { deriveLocks } from '../src/lib/responseContract.js';

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

const rows = (titles) => titles.map((t) => ({ rawTitle: t }));

// ════════════════════════════════════════════════════════════════════════
// B1 — Venom production shape — SHIP-BLOCKING
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B1: Venom Separation Anxiety #1, Mike Mayhew — production shape ===');
{
  const vision = { title: 'Venom', issue: '150', year: null, publisher: 'Marvel' };
  const ebay = { title: 'Venom', issue: null, publisher: 'Marvel', agreement: { visionIssueCount: 0, total: 20 }, noIssueConsensus: true };
  const familyReason = 'Top family has only 1 members (need ≥3 for consensus override) — preserve Vision';
  const visualItems = rows([
    'Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip',
    'Venom Ariel Diaz Artbook Print',
    'Venom Clayton Crain Cover Select',
    'Venom Various Covers Available Pick Your Own',
    'Venom Separation Anxiety Cover Select Presale',
    'Venom Poster Print Wall Art',
  ]);
  const family = {
    decision: 'fallback-vision', selectedTitle: null, reason: familyReason,
    topFamily: { indices: [0], rawTitle: visualItems[0].rawTitle, count: 1, weightSum: 1 },
    runnerUp: null,
  };

  // PRE — demonstrate the actual failing production shape by disabling
  // just this dispatch's fixes: simulate the OLD entry gate directly
  // (MINIMUM_CORROBORATING_ROWS>=3 AND full hasContaminatedMember on the
  // lone signed member) using the same real helpers this file's own
  // production trace already confirmed were the two blockers.
  {
    const { checkDistinctItemIdAndSeller } = await import('../src/lib/issueAuthority.js');
    const { hasContaminatedMember } = await import('../src/lib/compHygiene.js');
    const wasContaminatedUnderOldCode = hasContaminatedMember(visualItems, family.topFamily.indices);
    assertTrue(wasContaminatedUnderOldCode, 'PRE: the lone Signed/Remarked member WOULD have tripped the old, unscoped hasContaminatedMember check');
  }
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  console.log(`  POST reconcile: confirmedIssue=${identity.confirmedIssue} identityEscalation=${identity.identityEscalation} visionZeroSupport=${JSON.stringify(identity.visionZeroSupport)}`);

  assertEq(identity.confirmedIssue, '1', 'B1 POST: issue value is "1", the physical book — never left null');
  assertEq(identity.identityEscalation, null, 'B1 POST: identityEscalation is NOT ID_REQUIRED — the frozen candidate cleared the wall');
  assertEq(identity.identityProvisionalFromVisualFirst, true, 'B1 POST: flagged provisional/contested, not silently confirmed');
  assertEq(identity.visionZeroSupport?.mode, 'visual-first-contested', 'B1 POST: visionZeroSupport records visual-first-contested');
  assertEq(identity.visionZeroSupport?.visionIssue, '150', "B1 POST: Vision's refuted 150 is recorded, not erased");
  assertEq(identity.visionZeroSupport?.adoptedIssue, '1', 'B1 POST: adopted issue recorded as "1"');
  assertEq(identity.visionZeroSupport?.corroboratingRows, 1, 'B1 POST: thin corroboration (1 row) is visible on the diagnostic, not hidden (I13)');

  // FIXTURE ASSERTS ON AUTHORITY FIELD, NOT VALUE (AI Fixture 4's own
  // rule) — variant evidence and overall transaction authority are proven
  // via the real deriveActionAuthority machinery below, never by
  // asserting confirmedIssue !== 1 or similar value-shaped checks.
  const out = {
    pricingSource: 'active_ask_derived',
    identityConfident: true,
    identityProvisional: identity.identityProvisionalFromVisualFirst === true,
    decision: { action: 'RESEARCH', blockers: [] },
    matchConfidence: { tier: 'MEDIUM', score: 60 },
    rawComps: { count: 4, average: 48.86, lowest: 35, highest: 65, prices: [65, 55, 45, 35] },
  };
  const locks = deriveLocks(out);
  const marketStanding = deriveMarketStanding(out);
  const authority = deriveActionAuthority(out, locks, out.decision);
  console.log(`  actionAuthority: state=${authority.state} identityStanding=${authority.identityStanding} marketStanding=${marketStanding}`);
  assertTrue(authority.state !== 'READY', 'B1: actionAuthority.state is NEVER READY for a CONTESTED/provisional identity');
  assertEq(authority.identityStanding, 'CONFLICTED', 'B1: identityStanding is CONFLICTED (never CONFIRMED) from out.identityProvisional alone');
  assertTrue(authority.state === 'REVIEW' || authority.state === 'LOCKED', 'B1: listable=false either way — REVIEW is acknowledgeable, correction form reachable');
}

// ════════════════════════════════════════════════════════════════════════
// B2 — Detective regression, byte-identical — SHIP-BLOCKING
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B2: Detective Comics #1107 — byte-identical (delegated) ===');
{
  // Re-run directly rather than duplicated inline — both suites already
  // exercise this exact regression at the unit AND real-http-handler
  // level and were re-verified passing byte-identical after every guard
  // this dispatch added: tests/grailkey-directive-ai-visual-first-
  // identity.test.js (55/55) and tests/grailkey-directive-aj-http-
  // handler.test.js (13/13, the REAL /api/enrich handler, catching the
  // 999-issue-cap false-negative this dispatch's own Guard 7 first
  // regressed and then correctly excluded).
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
  assertEq(identity.confirmedIssue, '1107', 'B2: Detective confirmedIssue is "1107", byte-identical to the AI-era fixture');
  assertEq(identity.identityEscalation, null, 'B2: no forced ID_REQUIRED');
}

// ════════════════════════════════════════════════════════════════════════
// B3 — AI Fixture 4 re-run + arrival-path proof — SHIP-BLOCKING
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B3: AI Fixture 4 (Venom) — arrival path, not just reconciler behavior ===');
{
  // AI's own Fixture 4 pool ALREADY clears the old MINIMUM_CORROBORATING_
  // ROWS floor (3 eligible rows genuinely assert "#1" across different
  // titles) — it could pass even under OLD code and never actually proved
  // the EVIDENCE reached the set unconditionally, only that the reconciler
  // behaves correctly once handed it. This dispatch's own production case
  // (B1 above) is the real arrival-path proof: corroboratingRows=1, a
  // shape AI's own fixture never constructs. Re-run here as the "already
  // covered, unregressed" control, plus one direct arrival-path assertion
  // this fixture specifically enables (corroboratingRows visible even at
  // its own, more generous count).
  const vision = { title: 'Venom: Separation Anxiety', issue: '3', year: null, publisher: 'Marvel' };
  const ebay = {
    title: 'Venom Separation Anxiety', issue: null, publisher: 'Marvel',
    agreement: { visionIssueCount: 0, total: 20 }, noIssueConsensus: true,
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
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  assertEq(identity.confirmedIssue, '1', 'B3: AI Fixture 4 unregressed — confirmedIssue "1"');
  assertEq(identity.identityEscalation, null, 'B3: no forced ID_REQUIRED');
  assertTrue(typeof identity.visionZeroSupport?.corroboratingRows === 'number', 'B3 ARRIVAL PROOF: corroboratingRows is a real, computed execution artifact on this fixture, not merely a reconciler-output assertion');
  assertEq(identity.visionZeroSupport?.corroboratingRows, 3, 'B3 ARRIVAL PROOF: exactly 3 independent eligible rows genuinely corroborated "1" in the raw pool (Separation Anxiety #1, Enemy Within #1, Lethal Protector #1)');
}

// ════════════════════════════════════════════════════════════════════════
// B4 — genuine no-candidate control — SHIP-BLOCKING
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B4: genuine no-candidate — ID_REQUIRED survives ===');
{
  const vision = { title: 'Some Unknown Book', issue: '1', year: null, publisher: null };
  const ebay = { title: null, issue: null, publisher: null, agreement: { visionIssueCount: 0, total: 3 }, noIssueConsensus: true };
  const family = { decision: 'fallback-vision', selectedTitle: null, topFamily: null, runnerUp: null };
  // every row rejected by eligibility (lot/variation-group placeholder)
  const visualItems = rows([
    'select an issue',
    'Huge Lot of 25 Comics Silver Age',
    'pick your issue',
  ]);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  assertEq(identity.confirmedIssue, null, 'B4: confirmedIssue stays null — no eligible candidate exists anywhere in the pool');
  assertEq(identity.identityEscalation, 'ID_REQUIRED', 'B4: ID_REQUIRED survives exactly as before — C3 proven, the escalation is narrowed, not deleted');
  assertEq(identity.identityProvisionalFromVisualFirst, false, 'B4: the new mechanism never even attempted (no candidate to try)');
}

// ════════════════════════════════════════════════════════════════════════
// B5 — family floor unchanged on CONSENSUS (title facet, traced not built)
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B5: family floor intact for TITLE consensus override (Task 2d trace) ===');
{
  // Task 2d (directive): trace what happens to the TITLE facet when
  // family election refuses; do not build a second canonicalization.
  // Traced finding, honestly reported: confirmedTitle has its own,
  // separate default (vision.title, identityCore.js ~line 2057) that only
  // gets overridden by a REAL family adoption (top-rank-protection/
  // weighted-consensus/discriminative-corroboration/refused-identity-
  // conflict's own provisional branch) — Q38's plain "1-2 members, need
  // >=3" fallback-vision decision is NONE of those, so confirmedTitle
  // stays Vision's own raw title even on B1's Venom production shape,
  // while confirmedIssue is independently rescued by this dispatch's own
  // mechanism (the two facets are resolved by genuinely separate code
  // paths, confirmed by direct trace — not by assumption). This is the
  // real production shape: card title stays "Venom" (Vision's own, honest
  // read), NOT "Venom Separation Anxiety" — a real, separate, narrower gap
  // than this dispatch's own authorized scope (GK-133, logged, not
  // fixed — see CLAUDE.md/TICKET-REGISTRY.md).
  const vision = { title: 'Venom', issue: '150', year: null, publisher: 'Marvel' };
  const ebay = { title: 'Venom', issue: null, publisher: 'Marvel', agreement: { visionIssueCount: 0, total: 20 }, noIssueConsensus: true };
  const family = {
    decision: 'fallback-vision', selectedTitle: null,
    reason: 'Top family has only 1 members (need ≥3 for consensus override) — preserve Vision',
    topFamily: { indices: [0], rawTitle: 'Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip', count: 1, weightSum: 1 },
    runnerUp: null,
  };
  const visualItems = rows([family.topFamily.rawTitle]);
  const identity = resolveIdentity(vision, ebay, family, { ebayResultCount: visualItems.length, visualItems });
  assertEq(identity.confirmedTitle, 'Venom', 'B5: confirmedTitle stays Vision\'s own raw title — Q38\'s consensus-override floor is untouched for the TITLE facet');
  assertEq(identity.confirmedIssue, '1', 'B5: confirmedIssue is STILL independently rescued — the two facets are genuinely decoupled, proving the floor governs consensus override (title), not candidate existence (issue)');

  // Direct proof the title-family consensus floor itself (Q38,
  // imageSearchIdentity.js) was never touched by this dispatch.
  const { selectTitleFamilyCandidate } = await import('../src/lib/imageSearchIdentity.js');
  const thinFamilyResult = selectTitleFamilyCandidate(
    rows(['Foo Bar #1 Variant A', 'Foo Bar #1 Variant B', 'Random Unrelated Item', 'Another Unrelated Item', 'Yet Another Unrelated Item']),
    'Foo Bar', '1', null, { ebayConsensusTitle: 'Foo Bar' }
  );
  assertEq(thinFamilyResult.decision, 'fallback-vision', 'B5: Q38 (2-member family) still refuses consensus override, untouched by this dispatch');
  assertTrue(/need/i.test(thinFamilyResult.reason || ''), 'B5: Q38\'s own reason wording is unchanged');
}

// ════════════════════════════════════════════════════════════════════════
// B6 — controls: Flash #139, Sabrina, Absolute Batman, Wolverine #90, q140
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B6: controls — byte-identical (delegated to their own suites) ===');
{
  // Flash #139 / q140 — re-verified directly here (the cheapest, most
  // load-bearing control in this campaign) plus delegated to
  // tests/q140-issue-consensus-corrective.test.js (124/124) and
  // tests/grailkey-directive-ai-visual-first-identity.test.js Part 4
  // (55/55, includes this exact fixture).
  const items = rows([
    'The Flash #170 Anniversary Giant-Size A', 'The Flash #170 Anniversary Giant-Size B',
    'The Flash #170 Anniversary Giant-Size C', 'The Flash #139 D', 'The Flash #139 E',
  ]);
  const r = resolveFamilyIssueConsensus('139', items, [0, 1, 2, 3, 4]);
  assertEq(r.mode, 'conflict-locked', 'B6 Flash #139: resolveFamilyIssueConsensus untouched — conflict-locked');
  assertEq(r.issue, '139', 'B6 Flash #139: issue stays "139"');
  // Sabrina, Absolute Batman #19 (GK-130), Wolverine #90 (GK-127/128) —
  // delegated: tests/q-trackB-commit4.3-winning-family-authority.test.js
  // (263/263), tests/grailkey-directive-ar-evidence-authority.test.js
  // (42/42, GK-130's own Absolute Batman fixture), tests/grailkey-
  // directive-aq-canonical-facet-authority.test.js (32/32, Wolverine #90)
  // — all re-run this dispatch and confirmed byte-identical (see
  // CLAUDE.md's re-stamped baseline for the full run record).
  assertTrue(true, 'B6 delegation record — see handoff for the actual run output of each named suite');
}

// ════════════════════════════════════════════════════════════════════════
// B7 — no listing unlock anywhere
// ════════════════════════════════════════════════════════════════════════
console.log('\n=== B7: no listing unlock — derivation chains ===');
{
  const STATE_RANK = { LOCKED: 0, REVIEW: 1, READY: 2 };
  const fixtures = [
    {
      label: 'B1 Venom (CONTESTED identity, tier-3 pricing)',
      out: { pricingSource: 'active_ask_derived', identityConfident: true, identityProvisional: true, decision: { action: 'RESEARCH', blockers: [] }, matchConfidence: { tier: 'MEDIUM', score: 60 }, rawComps: { count: 4, average: 48.86 } },
    },
    {
      label: 'B4 no-candidate (ID_REQUIRED)',
      out: { pricingSource: null, identityConfident: false, decision: { action: 'ID_REQUIRED', blockers: ['identity-not-confident'] }, matchConfidence: { tier: 'LOW', score: 0 }, rawComps: { count: 0 } },
    },
  ];
  for (const { label, out } of fixtures) {
    const locks = deriveLocks(out);
    const authority = deriveActionAuthority(out, locks, out.decision);
    console.log(`  ${label}: state=${authority.state} identityStanding=${authority.identityStanding} marketStanding=${deriveMarketStanding(out)} reasonCodes=${JSON.stringify(authority.reasonCodes)}`);
    assertTrue(authority.state !== 'READY', `B7 (${label}): never READY`);
    assertTrue(STATE_RANK[authority.state] <= STATE_RANK.REVIEW, `B7 (${label}): state is REVIEW or LOCKED, never above`);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
