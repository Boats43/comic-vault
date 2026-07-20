// tests/q132-fix3-artist-conflict-surfacing.test.js
//
// Q132 dispatch (2026-07-20, GrailKey / ASM #26 class), Fix 3 — artist-
// conflict surfacing. Two structurally separate artist-identity pipelines
// exist on a card and are never cross-checked: the comp-pool/title-family
// creator consensus (extractCreatorsFromComps, premiumCreators.js —
// derived from eBay listing titles) and whatever artist name Vision's own
// free-text condition report (grade.js STANDARD_PROMPT's "reason" field)
// happens to mention. Traced every consumer of req.body.reason in
// api/enrich.js: only detectEditionWarning + display pass-through — no
// code anywhere extracts or cross-checks an artist name from it.
//
// Real production case (found while reviewing Layer 4/4b verification,
// same physical book, three separate scans): condition-report artist
// drifted three different ways — "Iana Nyx" → "Iana Anikyrie" →
// "Jimenez" — while comp-pool/creator-credits correctly said "David
// Nakayama" all three times. Not a regression from Q132's other fixes —
// Vision's condition-report text was never grounded to the resolved
// artist identity in the first place. Vision's structured JSON response
// has no dedicated artist field (confirmed: grep of grade.js's JSON_SHAPE
// finds none) — an artist name can only appear embedded in free-text
// narration, in unpredictable phrasing, which is why hallucinated
// non-existent names ("Iana Nyx") need a general capitalized-name-near-
// attribution-keyword heuristic rather than a closed ARTIST_PATTERNS
// registry match (which would only catch the real "Jimenez" name, missing
// both hallucinated ones).
//
// Fix: extractConditionReportArtistMention + detectConditionReportArtistConflict
// (compHygiene.js) — surfaces the conflict only, does not attempt to
// resolve which artist is correct. Escalates to RESEARCH (same class as
// Q118's internal-inconsistency), same customer-grade doctrine as every
// other Q132 warning this dispatch — price/comps stay visible.
//
// Invoke: node tests/q132-fix3-artist-conflict-surfacing.test.js

import {
  extractConditionReportArtistMention,
  detectConditionReportArtistConflict,
} from '../src/lib/compHygiene.js';
import { computeDecision, describeWarning } from '../src/lib/decisionEngine.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertNull = (v, label) => assertEq(v, null, label);

console.log('\n=== Q132 Fix 3 — artist-conflict surfacing ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — the 3 real observed mismatches from the same physical book
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: the 3 real observed condition-report drifts, all vs "David Nakayama"\n');

const scan1Reason = 'Raw copy, NM 9.2. This appears to be a variant cover with distinctive Iana Nyx artwork on the front.';
const scan2Reason = 'Raw copy, minor edge wear. Cover features Iana Anikyrie artwork, color block style variant.';
const scan3Reason = 'Signed by Jimenez, near mint condition, virgin variant cover.';
const compPoolConsensus = ['David Nakayama'];

const c1 = detectConditionReportArtistConflict(scan1Reason, compPoolConsensus);
assertTrue(!!c1, 'Scan 1: "Iana Nyx" conflict detected');
assertEq(c1?.conditionReportArtist, 'Iana Nyx', 'Scan 1: extracts "Iana Nyx" exactly');
assertEq(c1?.compPoolArtists[0], 'David Nakayama', 'Scan 1: names the comp-pool consensus');

const c2 = detectConditionReportArtistConflict(scan2Reason, compPoolConsensus);
assertTrue(!!c2, 'Scan 2: "Iana Anikyrie" conflict detected');
assertEq(c2?.conditionReportArtist, 'Iana Anikyrie', 'Scan 2: extracts "Iana Anikyrie" exactly');

const c3 = detectConditionReportArtistConflict(scan3Reason, compPoolConsensus);
assertTrue(!!c3, 'Scan 3: "Jimenez" conflict detected (real ARTIST_PATTERNS name, still a genuine conflict vs Nakayama)');
assertEq(c3?.conditionReportArtist, 'Jimenez', 'Scan 3: extracts "Jimenez" exactly');

// computeDecision escalates to RESEARCH for all three, price/comps stay visible
for (const [label, conflict] of [['Scan 1', c1], ['Scan 2', c2], ['Scan 3', c3]]) {
  const item = {
    title: 'Amazing Spider-Man', issue: '26', publisher: 'Marvel', year: 2026,
    price: 150, pricingSource: 'active_ask_derived',
    rawComps: { count: 4, average: 160, lowest: 120, highest: 200 },
    soldComps: [], soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {} },
    artistIdentityConflict: conflict,
  };
  const decision = computeDecision(item);
  assertEq(decision.action, 'RESEARCH', `${label}: escalates to RESEARCH`);
  assertTrue(decision.warnings.includes('artist-identity-conflict'), `${label}: warning present`);
  assertTrue(item.price != null, `${label}: price stays visible (surfaced, not refused)`);
  const msg = describeWarning('artist-identity-conflict', item);
  assertTrue(msg.includes(conflict.conditionReportArtist) && msg.includes('David Nakayama'), `${label}: message names both artists: "${msg}"`);
}

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — false-positive guards
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: false-positive guards\n');

assertNull(extractConditionReportArtistMention('Standard cover, no signature detected. NM condition overall.'), 'sentence-initial "Standard" not treated as a name (no attribution-adjacent proper-noun evidence)');
assertNull(extractConditionReportArtistMention('Raw NM copy. No artist information visible on this scan.'), 'no genuine mention → null');
assertNull(extractConditionReportArtistMention(null), 'null text → null');
assertNull(extractConditionReportArtistMention(''), 'empty text → null');
assertNull(detectConditionReportArtistConflict(scan1Reason, []), 'empty comp-pool consensus → no conflict (nothing to compare against)');
assertNull(detectConditionReportArtistConflict(scan1Reason, null), 'no comp-pool consensus at all → no conflict');

// Agreement case — same artist, different granularity (bare surname from
// ARTIST_PATTERNS vs full canonical name from premiumCreators.js) must NOT
// conflict.
const agreeReason = 'Cover artwork by David Nakayama, color block virgin variant, 1:50 ratio.';
assertNull(detectConditionReportArtistConflict(agreeReason, ['David Nakayama']), 'condition report correctly naming the same artist as comp-pool → no conflict');
assertEq(extractConditionReportArtistMention(agreeReason), 'David Nakayama', 'agreement case still extracts the full name correctly');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — regression: unrelated books unaffected
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: regression — no artistIdentityConflict field means no warning\n');

const plainItem = {
  title: 'Batman', issue: '608', publisher: 'DC', year: 2002,
  price: 175, pricingSource: 'active_ask_derived',
  rawComps: { count: 8, average: 180, lowest: 100, highest: 260 },
  soldComps: [], soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {} },
};
const plainDecision = computeDecision(plainItem);
assertTrue(!plainDecision.warnings.includes('artist-identity-conflict'), 'Batman #608 (no artistIdentityConflict field): warning absent, byte-identical to before this fix');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
