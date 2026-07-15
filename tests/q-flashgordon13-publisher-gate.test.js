// Q-FLASHGORDON13 — publisher founding-year plausibility gate
// (api/mega-keys.js: PUBLISHER_FOUNDING_YEARS + isPublisherYearPlausible)
// and its pool-consensus fallback (backfillPublisherFromTitles, already
// exported from src/lib/identityCore.js, unmodified by this fix).
//
// The gate itself and its two-stage fallback wiring live inline in
// api/enrich.js (not exported -- same constraint as the Q-ADV397 visual
// guard), so this tests the underlying primitives directly against real
// data, same approach as that fix.
//
// Regression anchor — Flash Gordon #13 (2026-07-15 production log, pulled
// via `vercel logs`): Vision read publisher="Image" on a book correctly
// identified as year=1969. Image Comics was founded 1992. The real
// eBay-pool titles for this request (below, deduplicated from the actual
// "[22f] metadata-stripped" log lines for this exact request) name
// "Charlton"/"Charlton Comics" in the overwhelming majority -- the pool
// consensus fallback should resolve it correctly once the gate fires.
//
// Invoke: node tests/q-flashgordon13-publisher-gate.test.js

import { isPublisherYearPlausible } from '../api/mega-keys.js';
import { backfillPublisherFromTitles } from '../src/lib/identityCore.js';

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
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q-FLASHGORDON13 — publisher founding-year plausibility gate ===\n');

// ─── isPublisherYearPlausible: the gate itself ─────────────────────────
console.log('isPublisherYearPlausible:');

assertFalse(isPublisherYearPlausible('Image', '1969'), 'Image (founded 1992) rejected for a 1969 book -- the real production case');
assertFalse(isPublisherYearPlausible('Image Comics', '1969'), 'same, full-name form');
assertTrue(isPublisherYearPlausible('Charlton Comics', '1969'), 'Charlton (founded 1944) plausible for 1969');
assertTrue(isPublisherYearPlausible('Marvel', '1963'), 'Marvel (Timely 1939) plausible for 1963 (Amazing Spider-Man #1 era)');
assertTrue(isPublisherYearPlausible('Timely', '1941'), 'Timely alias collapses to marvel (1939) -- plausible for 1941');
assertFalse(isPublisherYearPlausible('Image', '1985'), 'Image still implausible for 1985 (7 years pre-founding)');
assertTrue(isPublisherYearPlausible('Image', '1995'), 'Image plausible for 1995 (post-founding)');
assertTrue(isPublisherYearPlausible('Some Unlisted Micropress', '1969'), 'unlisted publisher fails OPEN -- no false-positive rejection on a guessed date');
assertTrue(isPublisherYearPlausible(null, '1969'), 'null publisher fails open');
assertTrue(isPublisherYearPlausible('Image', null), 'unparseable year fails open');
assertTrue(isPublisherYearPlausible('Image', 'unknown'), 'non-numeric year fails open');

// ─── Pool-consensus fallback: real Flash Gordon #13 titles ─────────────
console.log('\nPool-consensus fallback (real production titles, deduplicated from [22f] log lines):');

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
  'flash gordon #13 cover a', // no publisher mentioned -- real noise in the pool
  'flash gordon #13 vol. 2 1969 charlton comics mid grade comic book a14-263',
  'flash gordon #13 vf 1969 charlton comic book',
  'flash gordon #13 charlton silver age *1969* f/vf',
  'flash gordon#13 charlton comics 1969 "trapped in the cave of the mud men"',
  'flash gordon # 13 - jeff jones art vf/nm cond', // no publisher mentioned -- real noise in the pool
  'flash gordon #13 king comics 1969 silver age comic book b128 1967', // a genuine minority disagreement in the real pool
];

assertEq(FLASHGORDON13_TITLES.length, 20, 'fixture has 20 real titles, matching the request\'s pool size');

const publisherBackfill = backfillPublisherFromTitles(FLASHGORDON13_TITLES);

assertTrue(publisherBackfill !== null, 'pool consensus resolves (>=4 titles, a pattern clears >=50%)');
assertEq(publisherBackfill.publisher, 'Charlton Comics', 'consensus adopts "Charlton Comics", matching the real pool and the visible cover');
assertTrue(publisherBackfill.ratio >= 0.5, 'consensus ratio clears the 50% gate');
assertEq(publisherBackfill.total, 20, 'denominator is the full pool (20), same discipline as Q-ADV397\'s issue-consensus fix');

// ─── End-to-end: gate rejects, fallback recovers -- the actual fix ─────
console.log('\nEnd-to-end (mirrors STAGE A in enrich.js):');

const rejected = !isPublisherYearPlausible('Image', '1969');
assertTrue(rejected, 'gate fires on the real Vision misread');
const recovered = rejected ? backfillPublisherFromTitles(FLASHGORDON13_TITLES) : null;
assertEq(recovered?.publisher, 'Charlton Comics', 'end-to-end: "Image" (wrong, 0/19 pool support) corrected to "Charlton Comics" via pool consensus');

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
