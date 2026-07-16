// Q-FIX-B — publisher gets the same zero-support treatment as issue,
// inside resolveIdentity() itself, plus a >=50% adoption gate on
// extractConsensus's publisher extraction (previously ungated — a single
// coincidental match could win outright).
//
// Three pieces under test, matching the greenlit scope exactly:
//   1. extractConsensus (src/lib/imageSearchIdentity.js) — publisher
//      threshold + visionPublisherCount tally + the added Charlton pattern.
//   2. resolveIdentity (src/lib/identityCore.js) — new publisher
//      zero-support override/escalate block.
//   3. Composition with cde6935's founding-year plausibility gate
//      (api/mega-keys.js's isPublisherYearPlausible + identityCore.js's
//      backfillPublisherFromTitles) — proving the two layers cover
//      different failure shapes rather than one becoming dead code.
//
// Regression anchor — Flash Gordon #13 (2026-07-15 production log, pulled
// via `vercel logs`): Vision read publisher="Image" (founded 1992) on a
// book correctly identified as year=1969, published by Charlton. Prior
// investigation (this session) traced the root cause to imageSearchIdentity
// .js's publisherPatterns table having NO Charlton entry at all — every
// "Charlton" mention in the real 20-title eBay pool produced zero pattern
// hits, leaving a single "Stock Image" boilerplate false-positive (bare
// \bimage\b pattern) as the SOLE entry in publisherCounts, trivially
// winning with count=1/20 and zero competitors.
//
// Invoke: node tests/q-fixb-publisher-zero-support.test.js

import { extractIdentityFromImageSearch, extractConsensus } from '../src/lib/imageSearchIdentity.js';
import { resolveIdentity, backfillPublisherFromTitles } from '../src/lib/identityCore.js';
import { isPublisherYearPlausible } from '../api/mega-keys.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`;
    failures.push(msg);
    console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== Q-FIX-B — publisher zero-support treatment in resolveIdentity ===\n');

// ─── Real Flash Gordon #13 pool (20 titles, deduplicated from the real
// [22f] metadata-stripped log lines for this exact request) ────────────
const FLASHGORDON13_TITLES = [
  'flash gordon comic book #13 charlton 1969 grade vg+ 4.5',
  'flash gordon #13 -pat boyette cover art! (4.0) 1969',
  'flash gordon #13 (charlton april 1969)',
  'flash gordon #13 vg/f, pat boyette art, charlton comics 1969 stock image',
  'flash gordon comic book #13 charlton comics 1969 fine',
  'flash gordon #13 in fn/vf condition a 1969 silver age charlton comic',
  'flash gordon #13 1969 charlton comics trapped in the cave of the mud men',
  'flash gordon volume 2 # 13 charlton 1969; art: jeff jones comic book',
  'flash gordon #13 vg+ (4.5) charlton 4/69',
  'flash gordon #13 (1969) charlton comics',
  'charlton comics flash gordon #13 (1969) - very good',
  'charlton comics flash gordon no. 13 (1969) mud men! fine',
  'flash gordon #13 fn 6.0 charlton comics 1969',
  'flash gordon #13 cover a',
  'flash gordon #13 vol. 2 1969 charlton comics mid grade comic book a14-263',
  'flash gordon #13 vf 1969 charlton comic book',
  'flash gordon #13 charlton silver age *1969* f/vf',
  'flash gordon#13 charlton comics 1969 "trapped in the cave of the mud men"',
  'flash gordon # 13 - jeff jones art vf/nm cond',
  'flash gordon #13 king comics 1969 silver age comic book b128 1967',
];

console.log('Part 1 — extractConsensus: Charlton now recognized, clears the 50% bar:');

const fgRows = extractIdentityFromImageSearch(FLASHGORDON13_TITLES.map((title) => ({ title })));
const fgConsensus = extractConsensus(fgRows, '13', 'Image');

assertTrue(fgConsensus !== null, 'consensus returned for the real 20-title pool');
assertEq(fgConsensus.publisher, 'Charlton Comics', 'consensus publisher resolves to "Charlton Comics", not "Image" — the actual bug fix');
assertTrue(fgConsensus.agreement.publisher >= 15, `Charlton wins by a wide majority (got ${fgConsensus.agreement.publisher}/20)`);
// Honest residual: the "stock image" title (row 4) still votes for Image,
// not Charlton, because \bimage\b is earlier in publisherPatterns and
// matching breaks on first hit (flagged as a known follow-up where the
// pattern was added). So Vision's zero-support count is 1, not a clean 0
// — this is exactly the ambiguous middle ground Part 3 below exercises.
assertEq(fgConsensus.agreement.visionPublisherCount, 1, 'visionPublisherCount is 1, not 0 — the residual "Stock Image" collision, not a clean zero');

console.log('\nPart 2a — resolveIdentity: real production path (title-family override fired) resolves correctly via the corrected consensus alone:');

const fgIdentityWithFamily = resolveIdentity(
  { title: 'flash gordon', issue: '13', year: '1969', publisher: 'Image' },
  fgConsensus,
  { selectedTitle: 'Flash Gordon', decision: 'weighted-consensus' },
  { ebayResultCount: 20, isGraded: false }
);
assertEq(fgIdentityWithFamily.confirmedPublisher, 'Charlton Comics', 'title-family branch: confirmedPublisher="Charlton Comics" via ebay.publisher, matching the real [title-family] decision=weighted-consensus trace from tonight');

console.log('\nPart 2b — resolveIdentity: a DIFFERENT code path (no family override, "eBay agrees with Vision" branch) — zero-support check correctly abstains on the residual 1/20 count, composes with cde6935 as the backstop:');

const fgIdentityNoFamily = resolveIdentity(
  { title: 'flash gordon', issue: '13', year: '1969', publisher: 'Image' },
  fgConsensus,
  null, // no family candidate — falls into the title-overlap branch instead
  { ebayResultCount: 20, isGraded: false }
);
// visionPublisherCount=1 (not 0) means the new zero-support check
// correctly does NOT auto-override here — same conservative posture the
// issue check already has. confirmedPublisher is left at Vision's raw
// "Image" by this branch, same as before this fix existed.
assertEq(fgIdentityNoFamily.confirmedPublisher, 'Image', 'zero-support check abstains (count=1, not 0) — does not silently invent confidence it doesn\'t have');
assertEq(fgIdentityNoFamily.visionPublisherZeroSupport, null, 'no zero-support flag set — this path is left for cde6935\'s gate to judge');

// cde6935 (founding-year plausibility) picks up exactly here:
const stillWrong = fgIdentityNoFamily.confirmedPublisher;
const rejected = !isPublisherYearPlausible(stillWrong, '1969');
assertTrue(rejected, 'cde6935: isPublisherYearPlausible correctly rejects "Image" for a 1969 book — still live, not dead code');
const poolBackfill = rejected ? backfillPublisherFromTitles(FLASHGORDON13_TITLES) : null;
assertEq(poolBackfill?.publisher, 'Charlton Comics', 'cde6935\'s pool-consensus fallback (identityCore.js\'s own Charlton-inclusive table, Q96) independently recovers "Charlton Comics" from the same real pool — the two layers compose instead of overlapping');

console.log('\nPart 3 — a case cde6935 CANNOT catch (chronologically-plausible-but-wrong) — proves Fix-B closes a real gap, not just re-covers cde6935\'s ground:');

// Vision misreads "IDW" (founded 1999) for a 2015 book actually published
// by Dark Horse (founded 1986) — BOTH plausible for 2015, so
// isPublisherYearPlausible('IDW', 2015) would never fire. Pool has clean,
// unambiguous Dark Horse support and genuinely zero IDW mentions (no
// coincidental collision this time).
const plausibleButWrongTitles = [
  'Some Series #4 (2015) Dark Horse Comics NM',
  'Some Series #4 2015 Dark Horse VF/NM',
  'Some Series #4 (2015) Dark Horse',
  'Some Series #4 Dark Horse Comics 2015',
  'Some Series #4 (2015) Dark Horse NM+',
  'Some Series #4 2015 Dark Horse Comics FN',
];
const plausibleRows = extractIdentityFromImageSearch(plausibleButWrongTitles.map((title) => ({ title })));
const plausibleConsensus = extractConsensus(plausibleRows, '4', 'IDW');
assertEq(plausibleConsensus?.publisher, 'Dark Horse', 'pool cleanly resolves to Dark Horse');
assertEq(plausibleConsensus?.agreement?.visionPublisherCount, 0, 'Vision\'s "IDW" read has a genuine, uncontaminated zero pool support');

assertTrue(isPublisherYearPlausible('IDW', '2015'), 'sanity: cde6935 alone would NOT have rejected "IDW" for 2015 — chronologically plausible, structurally invisible to that gate');

const plausibleIdentity = resolveIdentity(
  { title: 'Some Series', issue: '4', year: '2015', publisher: 'IDW' },
  plausibleConsensus,
  null,
  { ebayResultCount: 6, isGraded: false }
);
assertEq(plausibleIdentity.confirmedPublisher, 'Dark Horse', 'Fix-B\'s zero-support override catches this on its own — cde6935 structurally cannot');
assertEq(plausibleIdentity.visionPublisherZeroSupport?.mode, 'override', 'zero-support flag records mode=override for this case');

console.log('\nPart 4 — normal, already-correctly-resolving case is completely unaffected:');

// Punisher #1 (1986), Vision correctly reads "Marvel", pool overwhelmingly
// agrees — nothing here should trip the new gate or the zero-support check.
const normalTitles = [
  'Punisher #1 (1986) Marvel Comics VF/NM',
  'The Punisher #1 1986 Marvel VF',
  'Punisher #1 (1986) Marvel NM-',
  'Punisher #1 Marvel Comics 1986 FN',
  'Punisher #1 (1986) Marvel',
  'The Punisher #1 1986 Marvel Comics VF+',
];
const normalRows = extractIdentityFromImageSearch(normalTitles.map((title) => ({ title })));
const normalConsensus = extractConsensus(normalRows, '1', 'Marvel');
assertEq(normalConsensus?.publisher, 'Marvel', 'consensus still correctly resolves Marvel');
assertTrue(normalConsensus?.agreement?.visionPublisherCount > 0, 'visionPublisherCount is nonzero — Vision and pool agree');

const normalIdentity = resolveIdentity(
  { title: 'Punisher', issue: '1', year: '1986', publisher: 'Marvel' },
  normalConsensus,
  null,
  { ebayResultCount: 6, isGraded: false }
);
assertEq(normalIdentity.confirmedPublisher, 'Marvel', 'confirmedPublisher unchanged — correct case, nothing to fix');
assertEq(normalIdentity.visionPublisherZeroSupport, null, 'no zero-support flag — this book was never touched by the new logic');

console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
