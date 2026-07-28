// tests/q141-merchandise-classifier.test.js
//
// LAUNCH-PREP TASK 1 (2026-07-28) — categoryClassifier.js MERCHANDISE_PATTERN.
//
// CONFIRMED via real production log (deployment dpl_7i72SJ8ZhRCmph6R5ZwNoiEyKrSK,
// build e22e600, request 02:05:20 / 02:28:20 UTC): a Batman #15 scan's 20-item
// eBay visual pool contained two novelty-magnet listings —
// "Batman Comic Book Vintage Cover No 15 Refrigerator Magnet Free Shipping" and
// "Batman #15 FRIDGE MAGNET comic book" — neither caught by the pre-existing
// PRINT/COLLECTIBLE/CARD/BOOK patterns. Both survived category-gate and reached
// title-family clustering; the magnet listing appears verbatim as the runner-up
// family in the real log ("[title-family] runner-up: '15 batman book vintage
// cover refrigerator magnet free shipping' (weight 3.0, 1 members)").
//
// Root cause for why the first magnet title specifically slipped through:
// "...Vintage Cover No 15..." satisfies the existing COMIC_SIGNALS cover-variant
// regex /\b(cover\s*[a-z]|cvr\s*[a-z])/i as a false positive ("Cover N" from
// "Cover No") — confirmed by direct regex test against the pre-change code.
// Placing the new MERCHANDISE_PATTERN check before the comic-signal fallback
// (per instruction) closes this off without touching that regex.
//
// Correction to the task's stated fixture counts, recorded per this project's
// standing evidence-discipline: the request specified "6 merchandise rows /
// 14 comic rows" for the 20-title Batman #15 pool. The real, independently-
// pulled production pool (verbatim below, same request the certification
// package's Section 14 already cites for other purposes) contains exactly 2
// magnet titles, not 6 — verified by running classifyTitle against the real
// data (12 COMIC / 2 MERCHANDISE / 6 UNKNOWN, the 6 UNKNOWN being a pre-existing,
// unrelated gap: titles with no "#" symbol, "# 115" with a space breaking the
// issue-number regex, or "CGC GRADED 1.8" not matching the cgc\s*\d+\.\d+
// decimal-grade pattern). This test asserts against the real, verified numbers.
//
// A second, independently useful confirmation turned up while building the
// non-regression fixtures from this same certification session's real pools:
// the Wonder Woman #1 (2nd printing) and Flash #139 pools *also* carry genuine
// magnet contamination ("WONDER WOMAN (SWORD & SHIELD) DC FRIDGE MAGNET",
// "Wonder Woman Rebirth Comic Book #4 Art Image Refrigerator Magnet NEW UNUSED",
// "The Flash #135 - March 1963 - Comic Book Cover Magnet") — not a one-book
// anomaly. Flash #139's pool also demonstrates the DIMENSION_PATTERN
// interaction correctly: "FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET*..." (a
// distinct 2x3-inch magnet SKU, appears 4x in that pool) already classified
// PRINT before this change (the "2X3" token trips DIMENSION_PATTERN, which is
// checked before MERCHANDISE) and correctly stays PRINT, unaffected.
//
// Non-regression, verified by a git-stash before/after diff of classifyTitle
// run against all six pools (not hand-derived): Flash #128, Immortal Hulk #44,
// and Adventure Time Summer Special #1 are byte-identical before/after — zero
// classification changes. Wonder Woman and Flash #139 change ONLY on their
// real magnet rows (net effect on every other row: none). Batman #15 changes
// ONLY on its two magnet rows.
//
// Invoke: node tests/q141-merchandise-classifier.test.js

import { classifyTitle } from '../src/lib/categoryClassifier.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const countCategories = (titles) => {
  const counts = {};
  titles.forEach((t) => {
    const c = classifyTitle(t);
    counts[c] = (counts[c] || 0) + 1;
  });
  return counts;
};

console.log('\n=== Q141 — MERCHANDISE_PATTERN (Batman #15 magnet-contamination class) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — Batman #15, real 20-item production pool
// (deployment dpl_7i72SJ8ZhRCmph6R5ZwNoiEyKrSK, build e22e600, verbatim)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: Batman #15 — real 20-item pool\n');

const BATMAN_15_POOL = [
  'Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover',
  '1943 D.C. Comics Batman 15 CGC 4.5. WW2 Machine Gun Cover.',
  'Batman Comic Book Vintage Cover No 15 Refrigerator Magnet Free Shipping',
  'Batman #15 FRIDGE MAGNET comic book',
  'BATMAN #11 1942 coverless, missing pages replaced w/photocopies & repro cvr RARE',
  'Batman #76 FR/GD 1.5 1953',
  '1943 D.C. Comics Batman 15 CGC .5. WW2 Machine Gun Cover',
  'BATMAN 143 QUAL 4.5 5.0 CUT OUTS BACK COVER AND 1 PAGE WRITING 1961 MYLITE 2 MO',
  'DC - BATMAN (1940-2011) #103 - Grade 3.5 - Comic Book',
  '1955 batman 95',
  'DC - BATMAN (1940-2011) #116 - Grade 4.5 - Comic Book',
  'Batman 51 The Wonderful Mr. Wimble! 1949 G/VG',
  'BATMAN # 115 1959, Missing Back Cover & 1/2 Of Front KEY !st Clayface of S.A.',
  '1949 Batman 52 comic book golden age JOKERMOBILE classic cover Joker robin ',
  'BATMAN #103 (1956) Ace the Bat-Hound, Around GD-',
  'BATMAN #14 (Dec 1942-Jan 1943) *** 2nd PENGUIN *** Bob Kane, No Back Cover',
  'BATMAN #155 CBCS 3.0 // RETURN OF THE PENGUIN // comic book 1963',
  'Batman 76 DC Comics 1953',
  '1961 (SILVER AGE*)BATMAN # 137 COMIC BOOK CGC GRADED 1.8 ',
  'BATMAN #18 1942 coverless, missing pages replaced w/photocopies & repro cvr RARE',
];

assertEq(BATMAN_15_POOL.length, 20, 'fixture has all 20 real pool rows');

const batmanCounts = countCategories(BATMAN_15_POOL);
assertEq(batmanCounts.MERCHANDISE, 2, 'real pool: exactly 2 merchandise (magnet) rows classify MERCHANDISE');
assertEq(batmanCounts.COMIC, 12, 'real pool: 12 comic rows classify COMIC (unaffected by this change)');
assertEq(batmanCounts.UNKNOWN, 6, 'real pool: 6 rows classify UNKNOWN — pre-existing, unrelated gap, unaffected by this change');
assertEq((batmanCounts.MERCHANDISE || 0) + (batmanCounts.COMIC || 0) + (batmanCounts.UNKNOWN || 0), 20, 'every row accounted for, no silent drop');

assertEq(
  classifyTitle('Batman Comic Book Vintage Cover No 15 Refrigerator Magnet Free Shipping'),
  'MERCHANDISE',
  '"...Refrigerator Magnet..." — was misclassified COMIC pre-fix (false-positive "Cover No" cover-letter match), now MERCHANDISE'
);
assertEq(
  classifyTitle('Batman #15 FRIDGE MAGNET comic book'),
  'MERCHANDISE',
  '"...FRIDGE MAGNET..." — was misclassified COMIC pre-fix (genuine #15 match), now MERCHANDISE (checked before comic-signal fallback)'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — pattern coverage (magnet / metal sign / tin sign / wall sign)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: pattern coverage\n');

assertEq(classifyTitle('Batman metal sign vintage garage decor'), 'MERCHANDISE', 'bare "metal sign" detected');
assertEq(classifyTitle('Spider-Man tin sign wall decor garage art'), 'MERCHANDISE', '"tin sign" detected');
assertEq(classifyTitle('Spider-Man tin sign wall decor 12x8'), 'PRINT', 'same "tin sign" title WITH a dimension token ("12x8") — DIMENSION_PATTERN is checked first, correctly stays PRINT, not a MERCHANDISE contradiction');
assertEq(classifyTitle('Batman wall sign retro bar decor'), 'MERCHANDISE', '"wall sign" detected');
assertEq(classifyTitle('Justice League fridge magnet set of 6'), 'MERCHANDISE', '"fridge magnet" detected');
assertEq(
  classifyTitle('V3319 Adventure Time Marceline and The Scream Queens Decor WALL POSTER PRINT'),
  'PRINT',
  '"WALL POSTER" is not "wall sign" — correctly stays PRINT (POSTER_PATTERN), not a MERCHANDISE false positive'
);
assertEq(classifyTitle('Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover'), 'COMIC', 'genuine comic listing with no merchandise keyword — unaffected');
assertEq(classifyTitle(''), 'UNKNOWN', 'empty string — no crash, UNKNOWN');
assertEq(classifyTitle(null), 'UNKNOWN', 'null — no crash, UNKNOWN');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — non-regression, real pools from the same certification session
// (Section 14 of docs/LAUNCH-AUDIT.md; verbatim titles from that log pull)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: non-regression — real pools\n');

const FLASH_128_POOL = [
  'Flash #159 VG/FN Dr Mid-Nite',
  'Flash 159 FN 6.5  Kid Flash app. Vintage DC Comics  1966',
  'Flash   # 159    VERY FINE NEAR MINT    March 1966   Dr. Mid-Nite cameo  See pho',
  'Flash #128 GD 2.0 1962 1st app. and origin Abra Kadabra',
  'Flash 159 VF+ 8.5 High Res Scans *b6',
  'Flash 159 Fine 1966 DC Comics Final Fling',
  'Flash #159 March 1966 VG Dr Midnight Cameo!',
  'Flash #128 VG 4.0 1st Appearance of Abra Kadabra!! DC Comics 1962',
  'Flash #159 VG/FN 5.0 1966',
  'FLASH #159 1966-FLASHES FINAL FLING-DC COMICS -- ROCKET VF',
  'Flash 132 FN/VF 1962 DC Heaviest Man Alive Carmine Infantino',
  'FLASH #137 [1963 VG/FN] "VENGEANCE OF THE IMMORTAL VILLAIN!"',
  "Flash #128 DC 1962 '' The Case of the Real-Gone Flash !  ''",
  'FLASH #128 1962 DC COMICS-WILD COVER-First Abra Kadabra',
  'Flash #186 1969 VF+ 8.5 High Definition Scans**',
  'THE FLASH (7.0) DR MIDNIGHT CAMEO!! 1966',
  'Flash 128 1962 DC Comics VG+ 4.5 1st App Abra Kadabra',
  'The Flash #128 May 1962, 1st Abra Kadabra, DC Vintage Silver Age G 5.3',
  'FLASH #165 5.0 FLASH MARRIES IRIS WEST PROFESSOR ZOOM APP OW PAGES 1966',
  'THE FLASH #159 FN/VF 7.0 DC 3/1966',
];
const flash128Counts = countCategories(FLASH_128_POOL);
assertEq(flash128Counts.MERCHANDISE, undefined, 'Flash #128 real pool: zero merchandise rows (no magnet/sign titles present) — true non-regression');
assertEq(flash128Counts.COMIC, 13, 'Flash #128 real pool: COMIC count unchanged from pre-fix (13)');

const IMMORTAL_HULK_44_POOL = [
  'Immortal Hulk #44 (Marvel) Cho Variant',
  'Marvel Comics THE IMMORTAL HULK #44 Michael Cho Variant - 2021',
  'The Immortal Hulk #44 (2021) Michael Cho Variant Cover',
  'The Immortal Hulk #44 (2021, Marvel) NM Michael Cho Variant',
  'Immortal Hulk #44- CVR C Michael Cho Variant, Al Ewing, 2021, VF/NM!',
  'IMMORTAL HULK #44 MICHAEL CHO HULK TWO-TONE VAR (MARVEL 2021)',
  'Immortal Hulk #44 Two-Tone Variant (2021) NM Marvel Comics 1st Print!',
  'The Immortal Hulk #44 LGY761 Variant Cover',
  'Immortal Hulk #44: Cho 2-Tone Variant NM  Marvel Comics (2021)',
  'Immortal Hulk #44 (2021) Michael Cho Two-Toned Variant NM 🔥',
  'IMMORTAL HULK #44 NEAR MINT 2021 MICHALE CHO TWO-TONE VARIANT 1st PRINT b-304',
  'The Immortal Hulk 44 LGY 761 Michael Cho Variant',
  'Immortal Hulk 44 Marvel Comics LGY 761 Variant Edition Joe Bennett Cover 2021',
  'IMMORTAL HULK #44 MICHAEL CHO VARIANT MARVEL COMICS 2021 BAGGED AND BOARDED',
  'Immortal Hulk #44 MICHAEL CHO TWO-TONE TRADE DRESS VARIANT MARVEL NM.',
  'Immortal Hulk #44 Variant NM- Signed w/COA Michael Cho 2021 Marvel Comics',
  'Immortal Hulk #44 ~ MARVEL 2021 ~ Michael Cho variant cover NM',
  'Immortal Hulk #44 Cho 2 Tone Variant | Marvel 2021 | 1st Print NM',
  'Immortal Hulk #44 Cho 2-Tone Variant NM Gem Wow -C5',
  'The Immortal Hulk #44 Marvel Variant Edition Modern Age',
];
const hulkCounts = countCategories(IMMORTAL_HULK_44_POOL);
assertEq(hulkCounts.MERCHANDISE, undefined, 'Immortal Hulk #44 real pool: zero merchandise rows — true non-regression');
assertEq(hulkCounts.COMIC, 18, 'Immortal Hulk #44 real pool: COMIC count unchanged from pre-fix (18)');

const ADVENTURE_TIME_POOL = [
  'ADVENTURE TIME SUMMER Special #1, NM, Con edition, SDCC, Variant, 2013',
  'ADVENTURE TIME SUMMER Special #1 NM SDCC Convention Exclusive Variant 2013 NEW',
  'Adventure Time Comics 4 by Nitz, Jai Paperback / softback Book The Fast Free',
  'Adventure Time 2013 Summer Special #1 Boom! PX SDCC Exclusive Variant *',
  'Adventure Time #5C VF/NM; Boom! | Limited Edition Virgin Variant - we combine sh',
  'V3319 Adventure Time Marceline and The Scream Queens Decor WALL POSTER PRINT',
  'Adventure Time: Marceline and the Scream Queens #4C VF/NM; Boom! | Limited Editi',
  'ADVENTURE TIME #6 COVER C DAN HIPP VIRGIN VARIANT BAGGED/BOARDED NM KABOOM.',
  'Adventure Time Finn and Jake Princess Bubblegum Ice King art print poster Lumpy ',
  'ADVENTURE TIME SUMMER Special #1 NM SDCC Convention Exclusive Variant 2013 NEW',
  'Adventure Time: Spooktacular, Phoenix Comic Con, DF Exclusive, Casablanca Comics',
  'Adventure Time Marceline and the Scream Queens variant cover #3D BAGGED/BOARDED',
  'Adventure Time Marceline and the Scream Queens variant cover #4D BAGGED/BOARDED',
  'Adventure Time Marceline and the Scream Queens variant cover #4C BAGGED/BOARDED',
  'Adventure Time by McCreery, Conor; Hastings, Christopher',
  'Adventure Time Finn and Jake Princess Bubblegum Ice King art print poster Lumpy ',
  'ADVENTURE TIME #5 COVER D BAGGED/BOARDED NM KABOOM.',
  'ADVENTURE TIME ~ ORANGE CAST COLLAGE ~ 24x36 POSTER ~ GAMES 24x36',
  'Adventure Time Original Graphic Novel Vo..., Leth, Kate',
  'Adventure Time  Poster 24x36 Inch',
];
const adventureCounts = countCategories(ADVENTURE_TIME_POOL);
assertEq(adventureCounts.MERCHANDISE, undefined, 'Adventure Time SS #1 real pool: zero merchandise rows — true non-regression');
assertEq(adventureCounts.COMIC, 6, 'Adventure Time SS #1 real pool: COMIC count unchanged from pre-fix (6)');

// Wonder Woman and Flash #139 are NOT pure non-regression cases — both real
// pools carry genuine magnet contamination, confirmed via git-stash before/
// after diff. Asserted as positive fixes here, not "unaffected".
const WONDER_WOMAN_POOL = [
  'Wonder Woman #1 2nd Printing Jim Lee Foil Variant NM Dc  Comics',
  'Wonder Woman #1 DC Virgin Variant Artwork Jim Lee Embossed Foil Italian Edition',
  'Wonder Woman #11 DC Comics Comic Book',
  'Comics Wonder Woman dc lasso of truth CCG Playmat Custom Playmat Mat Pad Game',
  'Wonder Woman Vol. 4: Godwatch Rebirth Paperback G. Rucka',
  'Wonder Woman Vol. 4: Godwatch Rebirth Paperback G. Rucka',
  'WONDER WOMAN #797 1:50 YANICK PAQUETTE FOIL VARIANT 032223',
  'JIM LEE rare WONDER WOMAN: Goddess of Truth CANVAS giclee SIGNED WB art COA!! ',
  'Jim Lee Wonder Woman: Goddess of Truth Giclee On Canvas Signed',
  'Wonder Woman Rebirth Comic Book #4 Art Image Refrigerator Magnet NEW UNUSED',
  'WONDER WOMAN #25',
  'WONDER WOMAN #797 YANICK PAQUETTE 1:50 FOIL VARIANT E DC 2023 FIRST PRINT',
  'Wonder Woman #10 DC Comics Comic Book',
  'WONDER WOMAN #22 1:25 SERG ACUNA CARD STOCK VAR',
  '9.9 MT JUSTICE LEAGUE # 4 WONDER WOMAN GERMAN EURO VARIANT JIM LEE 2019 WP LIM',
  'Wonder Woman #12 DC Comics Comic Book',
  'WONDER WOMAN #797 PAQUETTE 1:50 FOIL NM+',
  'WONDER WOMAN (SWORD & SHIELD) DC FRIDGE MAGNET',
  'JIM LEE rare WONDER WOMAN fine art print COVER Portfolio Plate 12 x 16 LAST ONE',
  'WONDER WOMAN #11',
];
const wwCounts = countCategories(WONDER_WOMAN_POOL);
assertEq(wwCounts.MERCHANDISE, 2, 'Wonder Woman real pool: 2 genuine magnet rows correctly move to MERCHANDISE (real contamination, not hypothetical)');
assertEq(wwCounts.COMIC, 11, 'Wonder Woman real pool: COMIC drops by exactly 1 (the #4 magnet row that was previously misclassified COMIC)');

const FLASH_139_POOL = [
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO',
  'THE FLASH #139 COMIC BOOK COVER poster print 11"x17" home decor',
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO',
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO',
  'THE FLASH #139 COMIC BOOK COVER GLOSSY Poster print 16"x24" HOME DECOR',
  'THE FLASH ARCHIVES VOL. 6 (ARCHIVE EDITIONS) By Various & Various - Hardcover',
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO',
  'FLASH meets Reverse Flash 11x17 POSTER DCU DC Comics Superman Art Barry Allen',
  'FLASH Meets Reverse Flash Barry Allen Comic Book Wall Art Canvas Poster',
  'THE FLASH #139 COMIC BOOK COVER 11"x17" POSTER PRINT',
  'Flash #105 Facsimile J. Giella & C. Infantino 2023 🔑 Key Issue VF+',
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO',
  'FLASH #105 FACSIMILE EDITION',
  'THE FLASH: THE SILVER AGE VOL. 3 By Various',
  'FLASH #123 FACSIMILE EDITION CVR A CARMINE INFANTINO & MURPHY ANDERSON DC COMICS',
  'Flash #123 Foil Facsimile Edition',
  'The Flash #135 - March 1963 - Comic Book Cover Magnet',
  'Flash #123 facsimile edition cover C foil Infantino Jay Garrick Barry Allen DC',
  'Flash #123 Facsimile Foil C. Infantino & M. Anderson Var. 2024 🔑 Key Issue VF+',
  'Flash #123 Facsimile Edition Cover C Carmine Infantino & Murphy Anderson Foil Va',
];
const flash139Counts = countCategories(FLASH_139_POOL);
assertEq(flash139Counts.MERCHANDISE, 1, 'Flash #139 real pool: 1 genuine magnet row ("...Cover Magnet") correctly moves to MERCHANDISE');
assertEq(flash139Counts.PRINT, 10, 'Flash #139 real pool: the 4x "*2X3 FRIDGE MAGNET*" rows stay PRINT — DIMENSION_PATTERN ("2X3") is checked before MERCHANDISE, so this is correct, not a miss');
assertEq(flash139Counts.COMIC, 7, 'Flash #139 real pool: COMIC drops by exactly 1 (the Magnet row that was previously misclassified COMIC via its own #135 match)');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
