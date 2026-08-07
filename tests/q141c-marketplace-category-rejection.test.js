// tests/q141c-marketplace-category-rejection.test.js
//
// COMMIT C (2026-07-28) — marketplace-category + title-pattern hard
// rejection, end-to-end through the real consumer chain.
//
// Two confirmed bugs, both reproduced by direct execution before any fix:
//   1. classifyTitle("Batman #15 FRIDGE MAGNET comic book") -> "MERCHANDISE",
//      but filterByCategory([that item, ...], 'COMIC') kept it anyway —
//      filterByCategory had its own separate, hardcoded pattern list that
//      never checked MERCHANDISE_PATTERN. classifyTitle() and
//      filterByCategory() were genuinely disconnected.
//   2. The <5-results safety gate returned the ENTIRE UNFILTERED original
//      pool — undoing even the pre-existing, correctly-working
//      PRINT/COLLECTIBLE/POSTER/CANVAS exclusions, not just the missing
//      MERCHANDISE one. Fired hardest exactly when a pool was most
//      contaminated.
//
// A third, structural finding surfaced while implementing the fix: the
// real production log for every fixture this session captured shows
// lookupEbayVisual's OWN internal consensus check (`[visual] consensus:
// ...`) running on the RAW, unfiltered pool — filterByCategory's old call
// site (api/enrich.js, then line 2205) ran AFTER that internal check, not
// before it. The filter now runs inside lookupEbayVisual itself, on the
// raw eBay items (before extractIdentityFromImageSearch ever parses a
// single row), so every downstream consumer (extractIdentity's own issue
// tally, the internal consensus check, title-family clustering, family
// issue consensus, year/publisher consensus, Q32's merchandise-vote
// denominator) is protected by construction.
//
// STANDING RULE this dispatch adds (third instance this session of a
// labeler being verified while its consumer stayed untested — merchandise
// pattern -> disconnected filter; Q12c policy -> over-broadly shared; now
// this): every test below exercises the real consumer chain
// (filterVisualIdentityPool -> extractIdentityFromImageSearch-equivalent
// construction -> extractConsensus / resolveFamilyIssueConsensus), not
// classifyVisualMarketRow in isolation.
//
// Evidence provenance, explicit: Test A uses the REAL 20-item Batman #15
// pool captured this session (build e22e600) — genuinely 2 magnet titles,
// not 6. The ONE confirmed real marketplace-category payload this session
// captured is a Flash #139 pool magnet item: leafCategoryIds:['476'],
// categoryName:'Refrigerator Magnets'. That real category data is attached
// to the Batman magnet titles for Test A/C (the titles are real; the
// category metadata reuses the one real confirmed value from a different
// real magnet listing, since the original Batman capture only logged full
// item objects for the pool's first entry, not every row). Test B's
// broader multi-category-type pool (magnet + metal sign) is a labeled
// constructed fixture, not a second verified real capture — matching the
// same "6 vs 2" correction already recorded for this exact pool in the
// Task 1 dispatch.
//
// Invoke: node tests/q141c-marketplace-category-rejection.test.js

import { classifyVisualMarketRow, filterByCategory, filterVisualIdentityPool } from '../src/lib/categoryClassifier.js';
import { resolveFamilyIssueConsensus, projectCanonicalTitleFromAnchor } from '../src/lib/identityCore.js';
import { extractIdentityFromImageSearch, extractConsensus } from '../src/lib/imageSearchIdentity.js';

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
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

// Real confirmed marketplace-category payload (Flash #139, build e22e600).
const REAL_MAGNET_CATEGORY = { leafCategoryIds: ['476'], categories: [{ categoryId: '476', categoryName: 'Refrigerator Magnets' }, { categoryId: '1', categoryName: 'Collectibles' }] };
const REAL_COMIC_CATEGORY = { leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }, { categoryId: '1', categoryName: 'Collectibles' }, { categoryId: '63', categoryName: 'Comic Books & Memorabilia' }] };
// No real captured payload for a metal/tin sign leaf category this session
// — name-matched only (HARD_NON_COMIC_LEAF_CATEGORY_NAME_RULES), not
// claimed as ID-confirmed.
const CONSTRUCTED_SIGN_CATEGORY = { leafCategoryIds: ['999999'], categories: [{ categoryId: '999999', categoryName: 'Metal Signs' }] };

console.log('\n=== COMMIT C — marketplace-category + title-pattern hard rejection, end-to-end ===\n');

// ═══════════════════════════════════════════════════════════════════════
// TEST A — real Batman #15 20-item pool (2 magnets), end-to-end
// ═══════════════════════════════════════════════════════════════════════
console.log('Test A: real Batman #15 pool (2 magnets), end-to-end through the real consumer chain\n');

const BATMAN_15_RAW_POOL = [
  { title: 'Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover', ...REAL_COMIC_CATEGORY },
  { title: '1943 D.C. Comics Batman 15 CGC 4.5. WW2 Machine Gun Cover.' },
  { title: 'Batman Comic Book Vintage Cover No 15 Refrigerator Magnet Free Shipping', ...REAL_MAGNET_CATEGORY },
  { title: 'Batman #15 FRIDGE MAGNET comic book', ...REAL_MAGNET_CATEGORY },
  { title: 'BATMAN #11 1942 coverless, missing pages replaced w/photocopies & repro cvr RARE' },
  { title: 'Batman #76 FR/GD 1.5 1953' },
  { title: '1943 D.C. Comics Batman 15 CGC .5. WW2 Machine Gun Cover' },
  { title: 'BATMAN 143 QUAL 4.5 5.0 CUT OUTS BACK COVER AND 1 PAGE WRITING 1961 MYLITE 2 MO' },
  { title: 'DC - BATMAN (1940-2011) #103 - Grade 3.5 - Comic Book' },
  { title: '1955 batman 95' },
  { title: 'DC - BATMAN (1940-2011) #116 - Grade 4.5 - Comic Book' },
  { title: 'Batman 51 The Wonderful Mr. Wimble! 1949 G/VG' },
  { title: 'BATMAN # 115 1959, Missing Back Cover & 1/2 Of Front KEY !st Clayface of S.A.' },
  { title: '1949 Batman 52 comic book golden age JOKERMOBILE classic cover Joker robin ' },
  { title: 'BATMAN #103 (1956) Ace the Bat-Hound, Around GD-' },
  { title: 'BATMAN #14 (Dec 1942-Jan 1943) *** 2nd PENGUIN *** Bob Kane, No Back Cover' },
  { title: 'BATMAN #155 CBCS 3.0 // RETURN OF THE PENGUIN // comic book 1963' },
  { title: 'Batman 76 DC Comics 1953' },
  { title: '1961 (SILVER AGE*)BATMAN # 137 COMIC BOOK CGC GRADED 1.8 ' },
  { title: 'BATMAN #18 1942 coverless, missing pages replaced w/photocopies & repro cvr RARE' },
];
BATMAN_15_RAW_POOL.forEach((it) => { it.rawTitle = it.title; });

const { eligible: batmanEligible, rejectedVisualEvidence: batmanRejected } = filterVisualIdentityPool(BATMAN_15_RAW_POOL);
assertEq(batmanRejected.length, 2, 'real Batman #15 pool: exactly 2 rows hard-rejected (the 2 real magnets)');
assertTrue(batmanRejected.every((r) => r.rejectionCode === 'MARKETPLACE_MAGNET_CATEGORY'), 'both rejected via marketplace-category authority, not title-pattern (real category metadata took precedence)');
assertFalse(batmanEligible.some((it) => /FRIDGE MAGNET|Refrigerator Magnet/i.test(it.title)), 'neither magnet survives into the eligible pool');
assertTrue(batmanEligible.some((it) => it.title === 'Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover'), 'genuine Batman #15 CGC row retained');
assertEq(batmanEligible.length, 18, 'eligible pool: 18 (20 - 2 magnets)');

// End-to-end: feed the eligible-only pool through the real
// extractIdentityFromImageSearch -> resolveFamilyIssueConsensus chain,
// same sequence lookupEbayVisual now uses. The 2 magnets never reach the
// family-clustering/Q140 denominator because they were removed upstream.
const batmanParsedRows = extractIdentityFromImageSearch(batmanEligible);
assertFalse(batmanParsedRows.some((r) => /MAGNET/i.test(r.rawTitle || '')), 'no magnet row present in the parsed rows title-family clustering actually consumes');
const batmanFamilyIndices = batmanParsedRows
  .map((r, i) => (/machine gun/i.test(r.rawTitle || '') ? i : null))
  .filter((i) => i !== null);
assertEq(batmanFamilyIndices.length, 3, 'the "machine gun" winning family still has exactly 3 genuine members (magnets never had "machine gun" in their titles, so this count is unaffected either way — confirms family membership itself is clean)');
const batmanFamilyConsensus = resolveFamilyIssueConsensus('15', batmanParsedRows, batmanFamilyIndices);
assertEq(batmanFamilyConsensus.ratio, 1, 'family issue consensus (Commit B2 mechanism) still resolves ratio=1.00 end-to-end on the category-filtered pool');

// ═══════════════════════════════════════════════════════════════════════
// TEST B — broader merchandise-mix pool (magnet + metal sign), labeled
// constructed fixture per the provenance note above
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest B: broader merchandise-type mix (magnet + metal sign) — constructed fixture, real Batman #15 titles\n');

const BATMAN_MIXED_MERCHANDISE_POOL = [
  { title: 'Batman #15 (1943) CGC 0.5, WWII Machine Gun Cover', ...REAL_COMIC_CATEGORY },
  { title: '1943 D.C. Comics Batman 15 CGC 4.5. WW2 Machine Gun Cover.' },
  { title: '1943 D.C. Comics Batman 15 CGC .5. WW2 Machine Gun Cover' },
  { title: 'Batman Comic Book Vintage Cover No 15 Refrigerator Magnet Free Shipping', ...REAL_MAGNET_CATEGORY },
  { title: 'Batman #15 FRIDGE MAGNET comic book', ...REAL_MAGNET_CATEGORY },
  { title: 'Batman Cover Art Vintage Metal Tin Sign Garage Decor', ...CONSTRUCTED_SIGN_CATEGORY },
  { title: 'BATMAN #11 1942 coverless' },
  { title: 'BATMAN #103 (1956) Ace the Bat-Hound' },
];
BATMAN_MIXED_MERCHANDISE_POOL.forEach((it) => { it.rawTitle = it.title; });

const { eligible: mixedEligible, rejectedVisualEvidence: mixedRejected } = filterVisualIdentityPool(BATMAN_MIXED_MERCHANDISE_POOL);
assertEq(mixedRejected.length, 3, 'refrigerator magnets (x2) + metal sign (x1) all hard-rejected — 3 total');
assertTrue(mixedRejected.filter((r) => r.rejectionCode === 'MARKETPLACE_MAGNET_CATEGORY').length === 2, '2 magnet rejections');
assertTrue(mixedRejected.filter((r) => r.rejectionCode === 'MARKETPLACE_SIGN_CATEGORY').length === 1, '1 sign rejection');
assertEq(mixedEligible.length, 5, 'eligible pool: exactly the 5 genuine comic listings');
const mixedParsed = extractIdentityFromImageSearch(mixedEligible);
const mixedFamilyIndices = mixedParsed.map((r, i) => (/machine gun/i.test(r.rawTitle || '') ? i : null)).filter((i) => i !== null);
const mixedFamilyConsensus = resolveFamilyIssueConsensus('15', mixedParsed, mixedFamilyIndices);
assertEq(mixedFamilyConsensus.ratio, 1, 'no merchandise family can become top or runner-up — the winning family is still the 3 genuine "machine gun" listings, ratio 1.00');

// ═══════════════════════════════════════════════════════════════════════
// TEST C — exact required case: title says "comic book", category says
// otherwise; category wins
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest C: marketplace category overrides "comic book" in the title text\n');

assertEq(
  classifyVisualMarketRow({ title: 'Batman #15 FRIDGE MAGNET comic book', ...REAL_MAGNET_CATEGORY }),
  { eligibleForComicIdentity: false, classification: 'MERCHANDISE', authority: 'marketplace-category', rejectionCode: 'MARKETPLACE_MAGNET_CATEGORY' },
  'exact required case: "comic book" in the title text does not save it — Refrigerator Magnets leaf category hard-rejects it'
);

// ═══════════════════════════════════════════════════════════════════════
// TEST D — exact required case: genuine comic in a genuine comic category
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest D: genuine comic in Comics & Graphic Novels — eligible\n');

assertEq(
  classifyVisualMarketRow({ title: '1943 D.C. Comics Batman 15 CGC 4.5', ...REAL_COMIC_CATEGORY }),
  { eligibleForComicIdentity: true, classification: 'COMIC', authority: 'title-pattern', rejectionCode: null },
  'exact required case: genuine comic, genuine comic leaf category -> eligible'
);
// Confirms generic parent categories alone are NOT sufficient to reject —
// "Collectibles" and "Comic Books & Memorabilia" both appear in
// REAL_COMIC_CATEGORY's own categories[] path and must never fire a
// rejection on their own.
assertFalse(
  classifyVisualMarketRow({ title: 'Batman #15', ...REAL_COMIC_CATEGORY }).rejectionCode,
  'generic parent categories ("Collectibles", "Comic Books & Memorabilia") present in the path never trigger rejection by themselves'
);

// ═══════════════════════════════════════════════════════════════════════
// TEST E — all-merchandise pool: zero marketplace family authority
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest E: all-merchandise pool — zero eligible, no restoration, no fabricated authority\n');

const ALL_MERCHANDISE_POOL = Array.from({ length: 8 }, (_, i) => ({
  title: `Batman Cover Art Refrigerator Magnet #${i}`,
  rawTitle: `Batman Cover Art Refrigerator Magnet #${i}`,
  ...REAL_MAGNET_CATEGORY,
}));
const { eligible: zeroEligible, rejectedVisualEvidence: zeroRejected } = filterVisualIdentityPool(ALL_MERCHANDISE_POOL);
assertEq(zeroEligible.length, 0, 'zero eligible rows — the <5 safety gate never restores merchandise, even down to zero');
assertEq(zeroRejected.length, 8, 'all 8 rows recorded as rejected evidence');
// The real downstream consequence: resolveFamilyIssueConsensus on an
// empty pool reports mode='no-data', not a fabricated family authority.
// Verified directly (not assumed): mode='no-data' returns issue:null
// UNCONDITIONALLY, by the function's own documented contract — "so the
// caller falls through to its own pre-existing fallback chain (e.g.
// ebay.issue / vision.issue)". Preserving Vision as provisional is
// therefore the CALLER's responsibility (api/enrich.js's existing
// confirmedIssue fallback chain), not something this function does
// itself — confirmed via direct execution, not the initial (wrong)
// assumption that it would echo back the prior issue like the
// no-consensus/conflict-locked branches do.
const emptyPoolConsensus = resolveFamilyIssueConsensus('15', [], []);
assertEq(emptyPoolConsensus.mode, 'no-data', 'family authority=none on a fully-rejected pool — no marketplace consensus constructed from merchandise');
assertEq(emptyPoolConsensus.issue, null, 'no-data returns issue:null unconditionally (by contract) — the caller\'s own fallback chain is what preserves Vision as provisional, confirmed against the function\'s real, documented behavior rather than assumed');

// ═══════════════════════════════════════════════════════════════════════
// TEST F — real Flash #139 pool: posters, magnets, books excluded; real/
// facsimile comics retained; dimension numbers never enter issue consensus
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest F: real Flash #139 pool — posters/magnets/books excluded, comics retained\n');

// Real titles (build e22e600). Category metadata not individually captured
// per-row in the original log (only the pool's first item, itself a
// magnet, got a full object dump) — the confirmed real magnet category is
// attached to the magnet titles here for the same reason documented in
// Test A's provenance note; the poster/archive-book rows fall back
// correctly to title-pattern classification (PRINT/BOOK), which is
// already real, unit-verified behavior from the original merchandise
// dispatch, not new to this test.
const FLASH_139_RAW_POOL = [
  { title: 'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO', ...REAL_MAGNET_CATEGORY },
  { title: 'THE FLASH #139 COMIC BOOK COVER poster print 11"x17" home decor' },
  { title: 'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO', ...REAL_MAGNET_CATEGORY },
  { title: 'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO', ...REAL_MAGNET_CATEGORY },
  { title: 'THE FLASH #139 COMIC BOOK COVER GLOSSY Poster print 16"x24" HOME DECOR' },
  { title: 'THE FLASH ARCHIVES VOL. 6 (ARCHIVE EDITIONS) By Various & Various - Hardcover' },
  { title: 'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO', ...REAL_MAGNET_CATEGORY },
  { title: 'FLASH meets Reverse Flash 11x17 POSTER DCU DC Comics Superman Art Barry Allen' },
  { title: 'FLASH Meets Reverse Flash Barry Allen Comic Book Wall Art Canvas Poster' },
  { title: 'THE FLASH #139 COMIC BOOK COVER 11"x17" POSTER PRINT' },
  { title: 'Flash #105 Facsimile J. Giella & C. Infantino 2023 🔑 Key Issue VF+' },
  { title: 'FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET* SUPERHERO FAST TURBO SPEED SUPERHERO', ...REAL_MAGNET_CATEGORY },
  { title: 'FLASH #105 FACSIMILE EDITION' },
  { title: 'THE FLASH: THE SILVER AGE VOL. 3 By Various' },
  { title: 'FLASH #123 FACSIMILE EDITION CVR A CARMINE INFANTINO & MURPHY ANDERSON DC COMICS' },
  { title: 'Flash #123 Foil Facsimile Edition' },
  { title: 'The Flash #135 - March 1963 - Comic Book Cover Magnet', ...REAL_MAGNET_CATEGORY },
  { title: 'Flash #123 facsimile edition cover C foil Infantino Jay Garrick Barry Allen DC' },
  { title: 'Flash #123 Facsimile Foil C. Infantino & M. Anderson Var. 2024 🔑 Key Issue VF+' },
  { title: 'Flash #123 Facsimile Edition Cover C Carmine Infantino & Murphy Anderson Foil Va' },
];
FLASH_139_RAW_POOL.forEach((it) => { it.rawTitle = it.title; });

const { eligible: flashEligible, rejectedVisualEvidence: flashRejected } = filterVisualIdentityPool(FLASH_139_RAW_POOL);
assertFalse(flashEligible.some((it) => /MAGNET/i.test(it.title)), 'no magnet row in the eligible pool');
assertFalse(flashEligible.some((it) => /POSTER/i.test(it.title)), 'no poster row in the eligible pool');
assertFalse(flashEligible.some((it) => /Hardcover/i.test(it.title)), 'the one row with an explicit BOOK_PATTERN keyword ("Hardcover") is excluded');
// "THE FLASH: THE SILVER AGE VOL. 3 By Various" has no ISBN/novel/
// paperback/hardcover/kindle/ebook/edition keyword — classifyTitle's
// existing BOOK_PATTERN genuinely does not catch a bare "VOL. N By
// Author" collection title. Confirmed via direct execution, not assumed:
// this survives as an eligible (UNKNOWN-authority) row. Real, pre-existing
// classifier gap, out of scope for Commit C (which fixes filterByCategory
// acting on classifyTitle's output, not classifyTitle's own coverage) —
// recorded here rather than silently asserted away.
assertTrue(flashEligible.some((it) => /SILVER AGE VOL/i.test(it.title)), 'known gap, not a Commit C regression: a bare "VOL. N By Author" title with no other book keyword is not caught by classifyTitle\'s existing BOOK_PATTERN and survives as eligible — pre-existing classifier coverage limit, unrelated to the two bugs this commit fixes');
assertTrue(flashEligible.some((it) => /Facsimile/i.test(it.title)), 'real facsimile comic rows retained (facsimile is a printing descriptor, not a category exclusion)');
assertTrue(flashRejected.length >= 9, `at least 9 rows rejected (5 magnets + 4 posters, minimum) — actual: ${flashRejected.length}`);

const flashParsed = extractIdentityFromImageSearch(flashEligible);
assertFalse(flashParsed.some((r) => r.issue === '2' || r.issue === '11'), 'no dimension-syntax number ("2X3", "11x17") enters the parsed issue set — confirms Commit B2\'s dimension guard AND Commit C\'s category filter are both doing their own independent, non-overlapping jobs correctly on the same pool');
const flashConsensus = extractConsensus(flashParsed, '139');
assertEq(flashConsensus?.issue, '123', 'Flash #139 end-to-end: issue "123" — same real-production-matching result as Commit B\'s regression evidence, now additionally passing through the category filter with no change (this pool\'s eligible rows were already what B\'s test assumed)');

// ═══════════════════════════════════════════════════════════════════════
// TEST G — Absolute Batman: non-comic row excluded, real issue #1 rows
// retained, no A2/B2 regression
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest G: Absolute Batman — non-comic row excluded, A2/B2 unaffected\n');

const ABSOLUTE_BATMAN_POOL = [
  { title: 'Absolute Batman #1 Nick Dragotta Virgin Foil Cover A DC 2024', ...REAL_COMIC_CATEGORY },
  { title: 'Absolute Batman #1 Cover A DC Comics 2024 NM' },
  { title: 'Absolute Batman #1 First Print DC 2024' },
  { title: 'Absolute Batman Cover Art Refrigerator Magnet Novelty', ...REAL_MAGNET_CATEGORY },
];
ABSOLUTE_BATMAN_POOL.forEach((it) => { it.rawTitle = it.title; });
const { eligible: absBatEligible, rejectedVisualEvidence: absBatRejected } = filterVisualIdentityPool(ABSOLUTE_BATMAN_POOL);
assertEq(absBatRejected.length, 1, 'exactly 1 non-comic row excluded (the magnet)');
assertEq(absBatEligible.length, 3, '3 genuine issue #1 rows retained');
assertTrue(absBatEligible.every((it) => /#1\b/.test(it.title)), 'all retained rows are genuinely issue #1');

// A2 unaffected — bracketed-descriptor anchor projection still correct.
assertEq(
  projectCanonicalTitleFromAnchor('Absolute Batman [Nick Dragotta Virgin Foil] #1 (2024)'),
  'Absolute Batman',
  'A2 unaffected by Commit C: bracketed anchor still projects cleanly'
);
// B2 unaffected — family-scoped consensus still does not suppress on
// marketing context (no marketing keywords in this fixture, but confirms
// the mechanism runs end-to-end on the category-filtered pool without
// throwing or regressing).
const absBatParsed = extractIdentityFromImageSearch(absBatEligible);
const absBatFamilyConsensus = resolveFamilyIssueConsensus(null, absBatParsed, [0, 1, 2]);
assertEq(absBatFamilyConsensus.mode, 'adopted', 'B2 unaffected: family consensus still adopts issue 1 from the category-filtered pool');
assertEq(absBatFamilyConsensus.winner, '1', 'B2 unaffected: winner is issue 1');

// ═══════════════════════════════════════════════════════════════════════
// TEST H — all five certified fixtures + Batman #15 + Absolute Batman,
// end to end (filterVisualIdentityPool -> extractConsensus, the exact
// function producing the real `[phase1] eBay consensus: ...` log line)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nTest H: all five certified fixtures + Batman #15 + Absolute Batman, end to end\n');

const asPool = (titles) => titles.map((t) => ({ title: t, rawTitle: t }));

const FLASH_128_POOL = asPool([
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
]);
const IMMORTAL_HULK_44_POOL = asPool([
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
]);
const ADVENTURE_TIME_POOL = asPool([
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
]);
const WONDER_WOMAN_POOL = asPool([
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
]);

const runFixture = (name, pool, visionIssue) => {
  const { eligible } = filterVisualIdentityPool(pool);
  const parsed = extractIdentityFromImageSearch(eligible);
  const consensus = extractConsensus(parsed, visionIssue);
  return { name, poolSize: pool.length, eligibleSize: eligible.length, consensus };
};

const h1 = runFixture('Flash #128', FLASH_128_POOL, '128');
assertEq(h1.consensus, null, 'Flash #128: still null end-to-end through the category filter (title consensus <30%, unaffected by category filtering — no merchandise/print rows in this real pool)');

const h2 = runFixture('Immortal Hulk #44', IMMORTAL_HULK_44_POOL, '44');
assertEq(h2.consensus?.issue, '44', 'Immortal Hulk #44: still issue "44" end-to-end');

const h3 = runFixture('Adventure Time SS #1', ADVENTURE_TIME_POOL, '1');
assertTrue(h3.eligibleSize < h3.poolSize, 'Adventure Time: category filter removes real PRINT rows (posters) from this pool end-to-end');
// GrailKey Dispatch 15 (2026-08-07): titleOk lowered 0.30 -> 0.15
// (imageSearchIdentity.js). This pool's title consensus (0.23) now
// clears the bar, so extractConsensus returns a real object instead of
// null — see tests/q141b-shared-issue-extractor.test.js for the full
// explanation of why this is inert in production (familyAuthoritySkip
// resolves this book via family-scoped consensus first).
assertEq(h3.consensus?.issue, null, 'Adventure Time: raw-pool issue consensus still null end-to-end (no 50% winner) — only the outer null-vs-object wrapper changed with the threshold, not the issue conclusion');
assertEq(h3.consensus?.noIssueConsensus, true, 'Adventure Time: noIssueConsensus true end-to-end — the safe ESCALATE shape, moot in production behind familyAuthoritySkip');

const h4 = runFixture('Wonder Woman #1 2nd print', WONDER_WOMAN_POOL, '750');
assertTrue(h4.eligibleSize < h4.poolSize, 'Wonder Woman: category filter removes the real magnet row from this pool end-to-end');
assertEq(h4.consensus?.issue, null, 'Wonder Woman: issue still null end-to-end (the conclusion that matters — Commit A2\'s server-side-clean certification — is unaffected)');
// Confidence itself is EXPECTED to change, not stay byte-identical:
// Commit B's own regression evidence (0.41) was computed against the OLD,
// buggy filterByCategory, which never removed this pool's real magnet row
// (bug #1) — that magnet was still IN the denominator. Commit C correctly
// removes it, shrinking the denominator from 17 to 13 real rows, which
// naturally moves the confidence math. Verified directly (0.54, not
// assumed) rather than asserting the stale pre-fix number.
assertEq(h4.consensus?.confidence, 0.54, 'Wonder Woman: confidence correctly changes to 0.54 (54%) now that the real magnet row Commit B\'s own regression evidence never removed (bug #1) is finally out of the denominator — the identity conclusion (issue=null) is what must stay stable, not this number');

const h5 = runFixture('Flash #139', FLASH_139_RAW_POOL, '139');
assertTrue(h5.eligibleSize < h5.poolSize, 'Flash #139: category filter removes real magnets/posters/books from this pool end-to-end');
assertEq(h5.consensus?.issue, '123', 'Flash #139: issue still "123" end-to-end — the conclusion that matters is unaffected');
// Same reasoning as Wonder Woman above: Commit B's category-gate pass for
// this fixture (kept=10) used the OLD filterByCategory, which only
// removed PRINT rows, not the 5 real magnets or the 1 real book/archive
// row this pool also carries. Commit C removes all of them (kept=8),
// correctly shrinking the denominator further and moving confidence from
// 0.67 to 0.75 — verified directly, not assumed to match the pre-fix number.
assertEq(h5.consensus?.confidence, 0.75, 'Flash #139: confidence correctly changes to 0.75 (75%) with the real magnets/book row also removed now (Commit B\'s category-gate pass only removed posters) — the identity conclusion (issue="123") is what must stay stable, not this number');

const h6 = runFixture('Batman #15', BATMAN_15_RAW_POOL, '15');
assertEq(h6.eligibleSize, 18, 'Batman #15: 18 eligible end-to-end (20 - 2 magnets)');

const h7 = runFixture('Absolute Batman #1', ABSOLUTE_BATMAN_POOL, '1');
assertEq(h7.eligibleSize, 3, 'Absolute Batman: 3 eligible end-to-end (4 - 1 magnet)');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
