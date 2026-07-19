// tests/q119-compound-title-consolidation.test.js
//
// Q119 dispatch (2026-07-18) — Captain Marvel #17 class. Real production
// case: Vision's own title field came back "captain" (missing "Marvel");
// the eBay visual pool's title-family consensus correctly found "captain
// marvel 1st kamala khan" (13/20 members) but the override was blocked —
// "marvel" was silently treated as content-free noise by the Q84/Q85-B
// family-override gate, leaving only "kamala"/"khan" visible to the
// override-blocking token-class gate, which correctly rejected THOSE as
// genuine non-creator additions but had no way to separately recover the
// one legitimate missing word.
//
// Investigation found this was not one bug but FOUR independently-
// drifted copies of the same "publisher name may legitimately be part of
// a series title" fact, all guarding it differently (and differently
// incompletely):
//   1. ComicAdapter.js PUBLISHER_IN_TITLE_SERIES — missing Captain
//      Marvel/Ms. Marvel entirely.
//   2. identityCore.js's function-scoped COMPOUND_TITLE_WHITELIST (Q24
//      fix, inside sanitizeSeriesTitle) — most complete, promoted to
//      module scope as the canonical source.
//   3. identityCore.js's OWN extractSeriesName (inside backfillFromComps,
//      same file as #2) — no guard at all, naked regex strip.
//   4. imageSearchIdentity.js's NEUTRAL_ADDITION_TOKENS (Q84/Q85-B
//      family-override gate) — no guard at all; recovering the neutral-
//      dropped word needed new completion logic, not just a list swap.
//   5. imageSearchIdentity.js's OWN separate PUBLISHER_IN_TITLE_SERIES
//      (inside extractMainTitle, found mid-investigation) — near-verbatim
//      copy of #1's gaps.
//
// Fix: identityCore.js's COMPOUND_TITLE_WHITELIST promoted to module
// scope, exported, merged with the other lists' unique entries. Sites #1
// and #5 now import and alias to it. Site #3 masks a matched compound
// phrase before stripping (not a blanket skip — a comp title carries
// other genuine noise, like a trailing "Comics" suffix, that still needs
// cleaning even when "Captain Marvel" itself must survive). Site #4 gets
// new completeCompoundTitle() logic: on a blocked override, checks
// whether Vision's title + one family-confirmed neutral word completes a
// known real title — recovers "marvel" without adopting "kamala"/"khan".
//
// Invoke: node tests/q119-compound-title-consolidation.test.js

import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
import { backfillFromComps, sanitizeSeriesTitle, COMPOUND_TITLE_WHITELIST } from '../src/lib/identityCore.js';
import { sanitizeComicTitle, cleanTitleForComicVine, PUBLISHER_IN_TITLE_SERIES } from '../src/adapters/ComicAdapter.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertEq = (actual, expected, label) => {
  const ok = actual === expected;
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(m); console.log(m); }
};

console.log('\n=== Q119 — COMPOUND TITLE CONSOLIDATION (Captain Marvel #17 class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// REQUIREMENT 1 — this exact scan, reconstructed from the real 20-item
// production pool (Vercel runtime log, build 70af8b3). Confirm the
// Q84/Q85-B gate (the site that actually fired) now correctly recovers
// "Marvel" without adopting the blocked "kamala"/"khan" additions.
// ═══════════════════════════════════════════════════════════════════════
console.log('Requirement 1: real Captain Marvel #17 scan — gate recovers "Marvel", excludes "kamala"/"khan"\n');

const realPoolTitles = [
  'Captain Marvel #17C Alphona Variant 2nd Printing CGC 9.6 2014 4550604005',
  'Captain Marvel #17 1st Kamala Khan (in costume) Cover 2ND PRINT VF+',
  'Captain Marvel #17 1st Appearance of Kamala Khan!! Cover 2ND PRINT VF+',
  'Captain Marvel #17 2nd print CBCS 9.8, Kamala Khan, not CGC',
  'Captain Marvel #17 Second Printing CGC 9.8 Pre-Dates All-New Marvel Now!',
  'CAPTAIN MARVEL #17 CGC 9.4 2ND PRINT VARIANT 1st Kamala Khan Cover! 2014',
  'Captain Marvel #17 Second Printing Variant Comic Book 1st Kamala Khan 2nd Print',
  'Captain Marvel #17 2nd Print (Marvel, 2014)  1st App of Kamala Khan Ms Marvel D+',
  'Captain Marvel 17 CGC 9.6 2ND PRINT 1st Kamala Khan',
  'Captain Marvel #17 - Second Print - 1st Kamala Khan - Marvel Comics',
  'Captain Marvel 17 2nd Print 9.8 1st App of Kamala Khan As Ms Marvel Low Prints',
  'CAPTAIN MARVEL #17 2ND KAMALA KHAN APPEARANCE MARVEL 2014',
  'Captain Marvel #17 2nd Print CGC 9.6 1st App Of Kamala Khan',
  'Captain Marvel $17 (8th Series) 01/13 CGC 8.0',
  'Captain Marvel #17 2nd Print CBCS 9.8 White Pages 1st Kamala Khan Ms Marvel 2014',
  'Captain Marvel #17 Marvel Comics 2014 2nd Appearance Kamala Khan CGC 9.6',
  'Captain Marvel #17 2nd Print CGC 9.6 1st Cover Appearance Kamala Khan Ms. Marvel',
  'Captain Marvel 17 NM 2nd Appearance of Kamala Khan Ms. Marvel',
  'Captain Marvel #17 CBC 9.8 2nd Appearance Kamala Khan Ms Marvel Disney+',
  'Captain Marvel #17A Quinones VG 4.0 2014 1st full app. Kamala Khan/Ms. Marvel',
];

// ebayConsensusTitle="captain" mirrors the real request exactly — the
// real log showed `[phase1] eBay consensus: "captain" #17 (confidence
// 75%)`, matching Vision's own (wrong) title, which is what activates
// the dual-axis gate in the first place (dualAxisAgreed=true).
const realResult = selectTitleFamilyCandidate(realPoolTitles, 'captain', '17', null, { ebayConsensusTitle: 'captain' });
assertEq(realResult.decision, 'weighted-consensus', 'real scan: decision is weighted-consensus (recovered, not fallback-vision)');
assertEq(realResult.selectedTitle, 'Captain Marvel', 'real scan: selectedTitle recovers "Captain Marvel"');
assertTrue(!/kamala/i.test(realResult.selectedTitle), 'real scan: "kamala" NOT adopted into the title');
assertTrue(!/khan/i.test(realResult.selectedTitle), 'real scan: "khan" NOT adopted into the title');
assertTrue(/\[Q119\]/.test(realResult.reason), `real scan: reason documents the Q119 completion path: "${realResult.reason}"`);

// ═══════════════════════════════════════════════════════════════════════
// REQUIREMENT 2 — site #3 (extractSeriesName / backfillFromComps).
// Vision returns null/empty title; comp pool consensus should backfill
// "Captain Marvel", not "Captain".
// ═══════════════════════════════════════════════════════════════════════
console.log('\nRequirement 2: site #3 — backfillFromComps preserves "Marvel" when Vision title is null/empty\n');

// Note: all 4 titles deliberately use CGC-prefixed grades (not bare VF/FN/
// GD + decimal) — extractSeriesName only strips a decimal grade number
// when it's prefixed by cgc/cbcs/pgx/graded (a pre-existing behavior,
// unrelated to this fix); mixing grade formats would fragment the 4
// titles into non-matching series-name candidates and fail the ≥80%
// consensus threshold for a reason that has nothing to do with what this
// test is actually checking.
const compItemsCM17 = [
  { rawTitle: 'Captain Marvel Comics #17 CGC 9.6 1977' },
  { rawTitle: 'Captain Marvel Comics #17 CGC 9.8 1977' },
  { rawTitle: 'Captain Marvel Comics #17 CGC 9.0 1977' },
  { rawTitle: 'Captain Marvel Comics #17 CGC 8.0 1977' },
];
const backfillResult = backfillFromComps(null, null, null, compItemsCM17);
assertTrue(backfillResult.titleBackfilled, 'site #3: title was backfilled from comp consensus');
assertEq(backfillResult.title, 'captain marvel', 'site #3: backfilled title is "captain marvel", not truncated "captain"');

// ═══════════════════════════════════════════════════════════════════════
// REQUIREMENT 3 — site #1 (ComicAdapter.js display-cleanup path).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nRequirement 3: site #1 — ComicAdapter.js preserves Captain Marvel / Ms. Marvel\n');

assertTrue(
  PUBLISHER_IN_TITLE_SERIES.includes('captain marvel'),
  'site #1: PUBLISHER_IN_TITLE_SERIES (now aliased to canonical list) includes "captain marvel"'
);
assertTrue(
  PUBLISHER_IN_TITLE_SERIES.includes('ms. marvel') || PUBLISHER_IN_TITLE_SERIES.includes('ms marvel'),
  'site #1: PUBLISHER_IN_TITLE_SERIES includes "ms marvel"/"ms. marvel"'
);
const cvTitle = cleanTitleForComicVine('Captain Marvel #17 CGC 9.6', null);
assertTrue(/captain marvel/i.test(cvTitle), `site #1: cleanTitleForComicVine preserves "Captain Marvel" (got "${cvTitle}")`);
const sanitized = sanitizeComicTitle('captain marvel #17', { year: 2014, isGraded: false });
assertTrue(/captain marvel/i.test(sanitized), `site #1: sanitizeComicTitle preserves "captain marvel" (got "${sanitized}")`);

// ═══════════════════════════════════════════════════════════════════════
// REQUIREMENT 4 — site #2 (sanitizeSeriesTitle) unaffected — it's the
// promoted source, not a changed consumer.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nRequirement 4: site #2 — sanitizeSeriesTitle still correctly guards compound titles\n');

assertTrue(
  /captain marvel/i.test(sanitizeSeriesTitle('Captain Marvel #17 CGC 9.6 2014')),
  'site #2: sanitizeSeriesTitle preserves "Captain Marvel"'
);
assertTrue(
  /marvel team-up|marvel team up/i.test(sanitizeSeriesTitle('Marvel Team-Up #74 Spider-Man')),
  'site #2: sanitizeSeriesTitle preserves "Marvel Team-Up"'
);

// ═══════════════════════════════════════════════════════════════════════
// REQUIREMENT 5 — genuine publisher-strip case (title does NOT
// legitimately contain "Marvel"/"DC"/etc.) still strips correctly. The
// whitelist must not become so permissive it stops doing its actual job.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nRequirement 5: genuine publisher-strip control — non-compound titles still stripped correctly\n');

// site #2 control
const strippedFF = sanitizeSeriesTitle('Fantastic Four Marvel CGC 9.8 1975');
assertTrue(!/\bmarvel\b/i.test(strippedFF), `site #2 control: "Fantastic Four" — "Marvel" correctly stripped (got "${strippedFF}")`);
assertTrue(/fantastic four/i.test(strippedFF), `site #2 control: "Fantastic Four" core title preserved (got "${strippedFF}")`);

// site #3 control — comp-pool backfill for a non-compound title (same
// consistent-CGC-grade-format note as the compound case above).
const compItemsFF = [
  { rawTitle: 'Fantastic Four Marvel Comics #1 CGC 9.8 1961' },
  { rawTitle: 'Fantastic Four Marvel Comics #1 CGC 9.6 1961' },
  { rawTitle: 'Fantastic Four Marvel Comics #1 CGC 9.0 1961' },
  { rawTitle: 'Fantastic Four Marvel Comics #1 CGC 8.0 1961' },
];
const backfillFF = backfillFromComps(null, null, null, compItemsFF);
assertTrue(backfillFF.titleBackfilled, 'site #3 control: title backfilled');
assertTrue(!/\bmarvel\b/i.test(backfillFF.title), `site #3 control: "Marvel" correctly stripped from non-compound title (got "${backfillFF.title}")`);
assertTrue(/fantastic/i.test(backfillFF.title), `site #3 control: core title preserved (got "${backfillFF.title}")`);

// site #1 control — ComicAdapter.js's functions never stripped bare
// "Marvel"/"DC" themselves outside the compound-title early-return path
// (that's ARTIST_NOISE/VARIANT_NOISE/CHARACTER_NOISE_PATTERNS' job, a
// separate concern from the publisher-in-title question this dispatch is
// about) — the real regression surface here is that isProtected must NOT
// fire for a genuinely non-compound title, letting normal artist-noise
// stripping proceed untouched by this change.
const cvTitleFF = cleanTitleForComicVine('Fantastic Four Jim Lee CGC 9.8', null);
assertTrue(!/jim lee/i.test(cvTitleFF), `site #1 control: non-compound title still gets normal artist-noise stripping, unaffected by the compound-title guard (got "${cvTitleFF}")`);
assertTrue(/fantastic four/i.test(cvTitleFF), `site #1 control: core title preserved (got "${cvTitleFF}")`);

// site #4 control — a family override with NO recoverable compound
// completion available must still correctly fall back to Vision (not
// invent a completion out of nothing).
const unrelatedPool = [
  'Some Random Comic #5 Marvel Guest Star Cameo NM',
  'Some Random Comic #5 Marvel Guest Star Cameo VF',
  'Some Random Comic #5 Marvel Guest Star Cameo FN',
  'Some Random Comic #5 Marvel Guest Star Cameo GD',
];
const controlResult = selectTitleFamilyCandidate(unrelatedPool, 'some random', '5', null, { ebayConsensusTitle: 'some random' });
assertTrue(
  controlResult.selectedTitle !== 'Some Random Marvel',
  `site #4 control: no fabricated completion when none is whitelisted (got "${controlResult.selectedTitle}")`
);

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
