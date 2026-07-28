// tests/q141b-shared-issue-extractor.test.js
//
// COMMIT B (2026-07-28) — shared issue-number extractor, closes the
// long-queued "Defect B: parser unification" item from the Adventure Time
// investigation.
//
// Real production defect (Batman #15, build e22e600): the winning family
// "15 batman machine gun cover dc ww2" had 3 members, all genuinely about
// issue #15 — but only 1 of the 3 writes it as "#15" (with the hash); the
// other 2 write it bare ("1943 D.C. Comics Batman 15 CGC 4.5..."). The
// pre-Commit-B extractor (resolveFamilyIssueConsensus's own inline regex,
// #-only) only ever counted 1/3, landing exactly at the real logged
// `[q140] ... ratio=0.33 ... mode=no-consensus` — below the 0.6 adoption
// bar despite unanimous real agreement.
//
// Before landing this, extractIssueFromTitle (imageSearchIdentity.js) and
// resolveFamilyIssueConsensus's own regex (identityCore.js) were two
// independently-evolved implementations that had already drifted: only
// imageSearchIdentity's old regex correctly handled a lettered sub-issue
// ("#5C" -> "5") via a (?!\d) trailing check; identityCore's own \b-anchored
// regex silently failed to match "#5C" at all. Patching Q140's regex alone
// would have re-created this exact divergence in a new shape. One shared
// extractor (extractIssueCandidate, identityCore.js) now backs both.
//
// Two real bugs were found and fixed DURING this dispatch by replaying
// extractIssueCandidate/extractConsensus against this session's own real
// captured pools (all 5 certified fixtures + Batman #15), not assumed
// correct from the spec alone:
//   1. An unanchored "before"-window lot/quantity check falsely rejected
//      "D.C. Comics Batman 15" — "Comics" (the publisher name, sitting
//      anywhere in a wide window) matched the "comics?" quantity-word
//      guard even though it has nothing to do with a "15 comics" phrase.
//      Fixed by anchoring the lot/quantity guard directionally
//      (immediately-before for "lot of"/"vol", immediately-after for
//      "comics"/"books"/"pages").
//   2. Switching the hash-path boundary from the OLD imageSearchIdentity
//      (?!\d) to \b (matching identityCore's OLD, less-complete regex)
//      broke lettered sub-issues ("#5C" -> null instead of "5"). Fixed by
//      keeping (?!\d) throughout (both hash and bare paths) — the correct
//      behavior of the two pre-existing implementations, not a new one.
//   3. Dimension syntax ("2X3" from a "*2X3 FRIDGE MAGNET*" listing, "11x17"
//      from a poster listing) had its leading number wrongly adopted as a
//      bare issue candidate — found via the real Flash #139 pool. Fixed
//      with an explicit WxH guard.
//
// Regression evidence: extractConsensus (the function that produces the
// real `[phase1] eBay consensus: ...` log line) run against all 5 real
// certified-fixture pools AND Batman #15, through categoryClassifier.js's
// real filterByCategory first (matching production's actual pipeline
// order) — not just extractIssueCandidate in isolation.
//
// Invoke: node tests/q141b-shared-issue-extractor.test.js

import { extractIssueCandidate, resolveFamilyIssueConsensus } from '../src/lib/identityCore.js';
import { extractIssueFromTitle, extractConsensus } from '../src/lib/imageSearchIdentity.js';
import { filterByCategory } from '../src/lib/categoryClassifier.js';

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

const buildPool = (titles) => {
  const filtered = filterByCategory(titles.map((t) => ({ title: t, rawTitle: t })), 'COMIC');
  return filtered.map((it) => ({ rawTitle: it.rawTitle, title: it.title, issue: extractIssueFromTitle(it.rawTitle) }));
};

console.log('\n=== COMMIT B — shared issue-number extractor ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — exact spec test case
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: exact spec test case\n');

assertEq(extractIssueCandidate('Batman #15'), { issue: '15', matchType: 'hash' }, '"Batman #15" -> issue 15 (hash)');
assertEq(extractIssueCandidate('D.C. Comics Batman 15'), { issue: '15', matchType: 'bare' }, '"D.C. Comics Batman 15" -> issue 15 (bare, adopted)');
assertEq(extractIssueCandidate('1943 D.C. Comics Batman 15'), { issue: '15', matchType: 'bare' }, '"1943 D.C. Comics Batman 15" -> issue 15 (bare, year correctly excluded, adopted)');

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — negative cases (spec: years, grades, lots, volumes must NOT adopt)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: negative cases\n');

assertEq(extractIssueCandidate('Batman 1943 DC Comics VF'), null, 'bare 4-digit year alone -> not adopted');
assertEq(extractIssueCandidate('Flash 1966 DC Comics'), null, 'another bare year -> not adopted');
assertEq(extractIssueCandidate('Batman CGC 4.5'), null, 'decimal-grade syntax after CGC -> not adopted');
assertEq(extractIssueCandidate('1943 D.C. Comics Batman 15 CGC 4.5. WW2 Machine Gun Cover.'), { issue: '15', matchType: 'bare' }, 'real title with year + decimal grade both present -> only the genuine bare issue 15 survives, year and grade both correctly excluded');
assertEq(extractIssueCandidate('Batman Lot of 15 comics'), null, '"Lot of N comics" -> not adopted');
assertEq(extractIssueCandidate('Batman Vol 15'), null, '"Vol N" -> not adopted');
assertEq(extractIssueCandidate('Batman pg 15'), null, '"pg N" -> not adopted');
assertEq(extractIssueCandidate('Batman 15 books lot'), null, '"N books" -> not adopted');
assertEq(extractIssueCandidate('FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET*'), null, 'real Flash #139 pool title — dimension syntax "2X3" -> leading number NOT adopted as issue (bug found and fixed this dispatch)');
assertEq(extractIssueCandidate('FLASH meets Reverse Flash 11x17 POSTER'), null, 'real Flash #139 pool title — "11x17" poster dimension -> not adopted');
assertEq(extractIssueCandidate('1943'), null, 'bare year with no title text at all -> fails title-adjacency, not adopted');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — lettered sub-issue regression (found + fixed this dispatch)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: lettered sub-issue (regression found + fixed this dispatch)\n');

assertEq(extractIssueCandidate('Adventure Time #5C VF/NM; Boom!'), { issue: '5', matchType: 'hash' }, 'real Adventure Time pool title — "#5C" lettered sub-issue -> "5" (an intermediate \\b-anchored version of this fix briefly broke this; (?!\\d) restores it)');
assertEq(extractIssueCandidate('Batman #15A (1943)'), { issue: '15', matchType: 'hash' }, '"#15A" lettered sub-issue -> "15"');
assertEq(extractIssueCandidate('Wonder Woman #1B'), { issue: '1', matchType: 'hash' }, '"#1B" lettered sub-issue, issue "1" specifically -> Q12c marketing-keyword guard still correctly does not fire (no marketing keyword nearby)');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — Q12c marketing-keyword guard preserved (pre-existing behavior)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: Q12c marketing-keyword guard, preserved verbatim\n');

assertEq(extractIssueCandidate('X-Men Anniversary Special #1'), null, 'suspect "#1" near "Anniversary"/"Special" -> still excluded (Q12c, unchanged)');
assertEq(extractIssueCandidate('Amazing Spider-Man #1'), { issue: '1', matchType: 'hash' }, 'genuine standalone "#1", no marketing keyword nearby -> still recovered');

// ═══════════════════════════════════════════════════════════════════════
// PART 5 — resolveFamilyIssueConsensus: the real Batman #15 defect, fixed
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: resolveFamilyIssueConsensus — real Batman #15 family\n');

const batmanFamily = [
  { itemId: '1', rawTitle: 'Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover' },
  { itemId: '2', rawTitle: '1943 D.C. Comics Batman 15 CGC 4.5. WW2 Machine Gun Cover.' },
  { itemId: '3', rawTitle: '1943 D.C. Comics Batman 15 CGC .5. WW2 Machine Gun Cover' },
];
const batmanCorroboration = resolveFamilyIssueConsensus('15', batmanFamily, [0, 1, 2]);
assertEq(batmanCorroboration.ratio, 1, 'real Batman family: ratio 0.33 (pre-fix, matches real production log) -> 1.00 (post-fix, all 3 genuinely agree)');
assertEq(batmanCorroboration.mode, 'corroborated', 'mode: no-consensus (pre-fix) -> corroborated (post-fix)');
assertEq(batmanCorroboration.support, 3, 'support: 1/3 (pre-fix) -> 3/3 (post-fix)');

const batmanAdoption = resolveFamilyIssueConsensus(null, batmanFamily, [0, 1, 2]);
assertEq(batmanAdoption.issue, '15', 'adoption path (no prior issue): correctly adopts 15 from the same real family data');
assertEq(batmanAdoption.mode, 'adopted', 'adoption mode confirmed');

// ═══════════════════════════════════════════════════════════════════════
// PART 6 — extractConsensus regression, all 5 certified fixtures + Batman
// Each pool run through the REAL filterByCategory first (matching
// production's actual pipeline order), then extractConsensus (the exact
// function behind the real `[phase1] eBay consensus: ...` log line).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: extractConsensus — full-pool regression, real production comparison\n');

const FLASH_128_POOL = [
  'Flash #159 VG/FN Dr Mid-Nite','Flash 159 FN 6.5  Kid Flash app. Vintage DC Comics  1966',
  'Flash   # 159    VERY FINE NEAR MINT    March 1966   Dr. Mid-Nite cameo  See pho',
  'Flash #128 GD 2.0 1962 1st app. and origin Abra Kadabra','Flash 159 VF+ 8.5 High Res Scans *b6',
  'Flash 159 Fine 1966 DC Comics Final Fling','Flash #159 March 1966 VG Dr Midnight Cameo!',
  'Flash #128 VG 4.0 1st Appearance of Abra Kadabra!! DC Comics 1962','Flash #159 VG/FN 5.0 1966',
  'FLASH #159 1966-FLASHES FINAL FLING-DC COMICS -- ROCKET VF','Flash 132 FN/VF 1962 DC Heaviest Man Alive Carmine Infantino',
  'FLASH #137 [1963 VG/FN] "VENGEANCE OF THE IMMORTAL VILLAIN!"',"Flash #128 DC 1962 '' The Case of the Real-Gone Flash !  ''",
  'FLASH #128 1962 DC COMICS-WILD COVER-First Abra Kadabra','Flash #186 1969 VF+ 8.5 High Definition Scans**',
  'THE FLASH (7.0) DR MIDNIGHT CAMEO!! 1966','Flash 128 1962 DC Comics VG+ 4.5 1st App Abra Kadabra',
  'The Flash #128 May 1962, 1st Abra Kadabra, DC Vintage Silver Age G 5.3','FLASH #165 5.0 FLASH MARRIES IRIS WEST PROFESSOR ZOOM APP OW PAGES 1966',
  'THE FLASH #159 FN/VF 7.0 DC 3/1966',
];
assertEq(extractConsensus(buildPool(FLASH_128_POOL), '128'), null, 'Flash #128: consensus stays null (title consensus <30%, matches real `consensus=NO` — no change, this fixture never reaches the issue-extraction stage at all)');

const FLASH_139_POOL = [
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO','THE FLASH #139 COMIC BOOK COVER poster print 11"x17" home decor',
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO','FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO',
  'THE FLASH #139 COMIC BOOK COVER GLOSSY Poster print 16"x24" HOME DECOR','THE FLASH ARCHIVES VOL. 6 (ARCHIVE EDITIONS) By Various & Various - Hardcover',
  'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO','FLASH meets Reverse Flash 11x17 POSTER DCU DC Comics Superman Art Barry Allen',
  'FLASH Meets Reverse Flash Barry Allen Comic Book Wall Art Canvas Poster','THE FLASH #139 COMIC BOOK COVER 11"x17" POSTER PRINT',
  'Flash #105 Facsimile J. Giella & C. Infantino 2023 🔑 Key Issue VF+','FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO',
  'FLASH #105 FACSIMILE EDITION','THE FLASH: THE SILVER AGE VOL. 3 By Various',
  'FLASH #123 FACSIMILE EDITION CVR A CARMINE INFANTINO & MURPHY ANDERSON DC COMICS','Flash #123 Foil Facsimile Edition',
  'The Flash #135 - March 1963 - Comic Book Cover Magnet','Flash #123 facsimile edition cover C foil Infantino Jay Garrick Barry Allen DC',
  'Flash #123 Facsimile Foil C. Infantino & M. Anderson Var. 2024 🔑 Key Issue VF+','Flash #123 Facsimile Edition Cover C Carmine Infantino & Murphy Anderson Foil Va',
];
const flash139Result = extractConsensus(buildPool(FLASH_139_POOL), '139');
assertEq(flash139Result.issue, '123', 'Flash #139: issue "123" — byte-identical to the real production log (`[phase1] eBay consensus: "flash" #123 (confidence 67%)`)');
assertEq(flash139Result.confidence, 0.67, 'Flash #139: confidence 0.67 (67%) — exact match to real production, confirms the "2X3"/dimension-guard fix (part 2) did not leave a residual false-positive in this pool');

const IMMORTAL_HULK_44_POOL = [
  'Immortal Hulk #44 (Marvel) Cho Variant','Marvel Comics THE IMMORTAL HULK #44 Michael Cho Variant - 2021',
  'The Immortal Hulk #44 (2021) Michael Cho Variant Cover','The Immortal Hulk #44 (2021, Marvel) NM Michael Cho Variant',
  'Immortal Hulk #44- CVR C Michael Cho Variant, Al Ewing, 2021, VF/NM!','IMMORTAL HULK #44 MICHAEL CHO HULK TWO-TONE VAR (MARVEL 2021)',
  'Immortal Hulk #44 Two-Tone Variant (2021) NM Marvel Comics 1st Print!','The Immortal Hulk #44 LGY761 Variant Cover',
  'Immortal Hulk #44: Cho 2-Tone Variant NM  Marvel Comics (2021)','Immortal Hulk #44 (2021) Michael Cho Two-Toned Variant NM 🔥',
  'IMMORTAL HULK #44 NEAR MINT 2021 MICHALE CHO TWO-TONE VARIANT 1st PRINT b-304','The Immortal Hulk 44 LGY 761 Michael Cho Variant',
  'Immortal Hulk 44 Marvel Comics LGY 761 Variant Edition Joe Bennett Cover 2021','IMMORTAL HULK #44 MICHAEL CHO VARIANT MARVEL COMICS 2021 BAGGED AND BOARDED',
  'Immortal Hulk #44 MICHAEL CHO TWO-TONE TRADE DRESS VARIANT MARVEL NM.','Immortal Hulk #44 Variant NM- Signed w/COA Michael Cho 2021 Marvel Comics',
  'Immortal Hulk #44 ~ MARVEL 2021 ~ Michael Cho variant cover NM','Immortal Hulk #44 Cho 2 Tone Variant | Marvel 2021 | 1st Print NM',
  'Immortal Hulk #44 Cho 2-Tone Variant NM Gem Wow -C5','The Immortal Hulk #44 Marvel Variant Edition Modern Age',
];
const hulkResult = extractConsensus(buildPool(IMMORTAL_HULK_44_POOL), '44');
assertEq(hulkResult.issue, '44', 'Immortal Hulk #44: issue "44" — same conclusion as real production (both live pulls: 17/20 and 18/20 support)');
assertEq(hulkResult.agreement.visionIssueCount, 20, 'Immortal Hulk #44: support now 20/20 (was 17-18/20 in production) — a real improvement, not a regression: the 2 bare "Immortal Hulk 44 LGY 761..." rows (no "#") are now correctly counted; the conclusion (issue 44) is unchanged, evidence completeness improved');

const ADVENTURE_TIME_POOL = [
  'ADVENTURE TIME SUMMER Special #1, NM, Con edition, SDCC, Variant, 2013','ADVENTURE TIME SUMMER Special #1 NM SDCC Convention Exclusive Variant 2013 NEW',
  'Adventure Time Comics 4 by Nitz, Jai Paperback / softback Book The Fast Free','Adventure Time 2013 Summer Special #1 Boom! PX SDCC Exclusive Variant *',
  'Adventure Time #5C VF/NM; Boom! | Limited Edition Virgin Variant - we combine sh','V3319 Adventure Time Marceline and The Scream Queens Decor WALL POSTER PRINT',
  'Adventure Time: Marceline and the Scream Queens #4C VF/NM; Boom! | Limited Editi','ADVENTURE TIME #6 COVER C DAN HIPP VIRGIN VARIANT BAGGED/BOARDED NM KABOOM.',
  'Adventure Time Finn and Jake Princess Bubblegum Ice King art print poster Lumpy ','ADVENTURE TIME SUMMER Special #1 NM SDCC Convention Exclusive Variant 2013 NEW',
  'Adventure Time: Spooktacular, Phoenix Comic Con, DF Exclusive, Casablanca Comics','Adventure Time Marceline and the Scream Queens variant cover #3D BAGGED/BOARDED',
  'Adventure Time Marceline and the Scream Queens variant cover #4D BAGGED/BOARDED','Adventure Time Marceline and the Scream Queens variant cover #4C BAGGED/BOARDED',
  'Adventure Time by McCreery, Conor; Hastings, Christopher','Adventure Time Finn and Jake Princess Bubblegum Ice King art print poster Lumpy ',
  'ADVENTURE TIME #5 COVER D BAGGED/BOARDED NM KABOOM.','ADVENTURE TIME ~ ORANGE CAST COLLAGE ~ 24x36 POSTER ~ GAMES 24x36',
  'Adventure Time Original Graphic Novel Vo..., Leth, Kate','Adventure Time  Poster 24x36 Inch',
];
assertEq(extractConsensus(buildPool(ADVENTURE_TIME_POOL), '1'), null, 'Adventure Time SS #1: extractConsensus stays null, matching real production `[visual] consensus: none`. The real fix for this fixture (family-scoped resolveFamilyIssueConsensus, a separate, already-shipped mechanism from 69a1d769) is untouched by Commit B.');

const WONDER_WOMAN_POOL = [
  'Wonder Woman #1 2nd Printing Jim Lee Foil Variant NM Dc  Comics','Wonder Woman #1 DC Virgin Variant Artwork Jim Lee Embossed Foil Italian Edition',
  'Wonder Woman #11 DC Comics Comic Book','Comics Wonder Woman dc lasso of truth CCG Playmat Custom Playmat Mat Pad Game',
  'Wonder Woman Vol. 4: Godwatch Rebirth Paperback G. Rucka','Wonder Woman Vol. 4: Godwatch Rebirth Paperback G. Rucka',
  'WONDER WOMAN #797 1:50 YANICK PAQUETTE FOIL VARIANT 032223','JIM LEE rare WONDER WOMAN: Goddess of Truth CANVAS giclee SIGNED WB art COA!! ',
  'Jim Lee Wonder Woman: Goddess of Truth Giclee On Canvas Signed','Wonder Woman Rebirth Comic Book #4 Art Image Refrigerator Magnet NEW UNUSED',
  'WONDER WOMAN #25','WONDER WOMAN #797 YANICK PAQUETTE 1:50 FOIL VARIANT E DC 2023 FIRST PRINT',
  'Wonder Woman #10 DC Comics Comic Book','WONDER WOMAN #22 1:25 SERG ACUNA CARD STOCK VAR',
  '9.9 MT JUSTICE LEAGUE # 4 WONDER WOMAN GERMAN EURO VARIANT JIM LEE 2019 WP LIM','Wonder Woman #12 DC Comics Comic Book',
  'WONDER WOMAN #797 PAQUETTE 1:50 FOIL NM+','WONDER WOMAN (SWORD & SHIELD) DC FRIDGE MAGNET',
  'JIM LEE rare WONDER WOMAN fine art print COVER Portfolio Plate 12 x 16 LAST ONE','WONDER WOMAN #11',
];
const wwResult = extractConsensus(buildPool(WONDER_WOMAN_POOL), '750');
assertEq(wwResult.issue, null, 'Wonder Woman #1 2nd print: issue stays null');
assertEq(wwResult.confidence, 0.41, 'Wonder Woman: confidence 0.41 (41%) — byte-identical to real production (`[phase1] eBay consensus: "wonder woman" #null (confidence 41%)`), zero drift from the bare-number widening (797/11/4/25/10/22/12 never reach the 50% adoption bar either way)');
assertEq(wwResult.noIssueConsensus, true, 'Wonder Woman: noIssueConsensus still true — the real vision-zero-support ESCALATE path this fixture is certified for is unaffected');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
