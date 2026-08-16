// tests/grailkey-directive-ao-companion-product-eligibility.test.js
//
// GrailKey Directive 2026-08-16-AO — GK-123: companion products are not
// identity evidence. A 3-row "Ariel Diaz Artbook" cluster defeated the
// rank-1 physical comic (single listing) in family election, 5.5 to 5.0,
// once GK-121's fix correctly killed the (worse) Lethal Protector defect
// that had always fired first and masked this one.
//
// Fix: a third eligibility class in isEligibleVisualRow
// (identityReconciler.js) — COMPANION_PRODUCT_RE — same governing rule as
// the two existing classes (lot/bundle, variation-group picker): a listing
// with no single-comic-book identity at all has no authority in rank/
// weight-based selection. Explicit tokens only (art book/artbook, art
// print, portfolio, sketchbook, poster) — bare "art" is deliberately
// excluded to avoid false-positiving on real comic titles ("Art Ops,"
// "The Art of War").
//
// PROVENANCE: wfvvb/dzq9h pools are the complete, verbatim 20-row pools
// from comic-vault-log-export-2026-08-16T19-05-10.csv (confirmed real and
// complete in the prior AN acceptance-correction dispatch, same session).
// Sabrina's rank-1 row is this session's own already-verified real
// production text. B4's "Art Ops"/"Art of War" fixtures are real,
// well-known published comic titles (Vertigo's "Art Ops," multiple
// publishers' "The Art of War" one-shots) used specifically to prove the
// false-positive boundary, not fabricated pool data.
//
// Invoke: node tests/grailkey-directive-ao-companion-product-eligibility.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';
import { isEligibleVisualRow, selectFirstEligibleVisual, COMPANION_PRODUCT_RE } from '../src/lib/identityReconciler.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

console.log('\n=== GrailKey Directive AO — GK-123 companion-product eligibility ===\n');

// REAL — complete, verbatim wfvvb-1786903445323 pool (20 rows).
const wfvvbPool = [
  'Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip',
  'Ariel Diaz Artbook-Venom & Carnage ',
  '🔥🕷 VENOM #9 SABINE RICH Unknown 616 Comics Virgin Variant NM🔥HOT',
  'WEB OF VENOM #1 TYLER KIRKHAM 616 COMICS Virgin Variant C LTD 1000',
  '2024 Marvel Comics VENOMVERSE REBORN #1 2nd Print 1:25 Virgin Incentive – NM',
  'Venom: Lethal Protector (2022) #1 - Mico Suayan - Virgin Color Variant Signed ',
  'Ariel Diaz Art book Venom & Carnage LTD 100 NYCC EXCLUSIVE 🔥🔥NM',
  'VENOM #1 (2021) 616 Comics | Comics Elite Marco Turini VIRGIN Variant Comic Book',
  'Venom #252 Virgin Foil Exclusive - MegaCon 2026 - Signed Mico Suayan Ltd 800 COA',
  'Venom #12 Tyler Kirkham Virgin Variant Unknown Comics 100th Exclusive NM 2022',
  '2021 Marvel Comics Venom #1 Marco Turini Virgin Variant Limited to 1000',
  'EXTREME CARNAGE ALPHA #1 MICO SUAYAN VIRGIN COLOR VARIANT BTC EXCLUSIVE',
  '💥 Tyler Kirkham Regular Indie Signed Comic Pick & Choose Discount Lot 💥',
  'Ariel Diaz Art book Venom & Carnage LTD 100 NYCC EXCLUSIVE 🔥🔥NM',
  'VENOM LETHAL PROTECTOR 1 Marvel Tyler Kirkham Signed Virgin Variant',
  'VENOM #6 MICO SUAYAN CARNAGE/VENOM Unknown Exclusive Virgin 2022 NM/NM+',
  'Venom #252 - Mico Suayan VIRGIN FOIL Megacon Exclusive Ltd 1000 w/COA • NM/M',
  'Venom #1 Marco Turini Virgin Art Variant Marvel Comic Book NM First Print',
  'VENOM #9 UNKNOWN COMICS SABINE RICH EXCLUSIVE VIRGIN VAR. / SHIPS FREE ',
  'Venom #252 Mico Suayan Virgin Singapore Comic Con Secret Drop Exclus LTD 800 NM+',
];

// REAL — complete, verbatim dzq9h-1786903446411 pool (20 rows).
const dzq9hPool = [
  'Amazing Spider-Man 60: CGC 9.8 Dell Otto Virgin Variant- SS Gabriele Dell Otto',
  'Amazing Spiderman 1 Lgy 802 Dell Otto Virgin Cover B cgc 9.8',
  'SDCC Amazing Spider-Man #1 CGC 9.8 Alex Ross Virgin, SIGNED KELLY, PEPE, MARVEL',
  "🕸Amazing Spider-Man🕸#1 Virgin Dell'Otto CGC 9.8 2018",
  'ULTIMATE SPIDER-MAN #1 CGC SS 9.8 INHYUK LEE SIGNED RED VIRGIN VARIANT 4th PRINT',
  'Amazing Spider-Man 1 (895) CBCS 8.5 Parillo Invaders Virgin 3x Signed Sketch',
  "AMAZING SPIDER-MAN #1 VIRGIN VARIANT CBCS 9.8 SS BY DELL'OTTO HANNA ROMITA JR 3X",
  "Spider-Man #5 CGC 9.8 (2023) - Dell'Otto Virgin Edition - Make Offer",
  'Amazing Spider-Man 58: CGC 9.6 Dell Otto Virgin - SS Gabriele Dell Otto - 2024',
  'Amazing Spider-Man #1 White Pages Dell Otto Variant D CGC 9.8',
  'Amazing Spider-Man #1 CGC 9.6 Virgin Variant Exclusive Signed CLAYTON CRAIN',
  'Amazing Spiderman 800 Dell Otto Variant Cover C Comic Xposure CGC 9.8',
  "Non-Stop Spider-Man # 1 Virgin Gabrielle Dell'Otto Variant CGC 9.6",
  "Amazing Spider-Man 1 (802) CGC 9.8 Dell'Otto Variant ComicXposure",
  "Amazing Spider-Man # 56 CGC SS 9.8 Virgin Cover Signed by Gabriele Dell'Otto",
  "Amazing Spider-Man #66 CGC SS 9.8 Virgin Variant Signed by Gabriele Dell'Otto",
  "Amazing Spider-Man #1 CGC 9.8 SS Dell'Otto Virgin Variant Cover B - 1st Kindred",
  "Amazing Spider-Man #1: Gabriele Dell' Otto Virgin CGC 9.8 - Facsimile Ltd to 963",
  'Amazing Spider-Man #797 CGC 9.4 Signed Gabriele Dell Otto Convention Edition',
  "SPIDER-MAN #5 CGC 9.8 THE SYNDICATE EXCLUSIVE GABRIELE DELL'OTTO  VARIANT 🔥🔥🔥",
];

console.log('Part B1 [BLOCKING]: wfvvb full pool — companion artbook excluded, "ariel diaz" never in the election');
{
  [1, 6, 13].forEach((i) => {
    check(isEligibleVisualRow(wfvvbPool[i]) === false, `idx ${i} ("${wfvvbPool[i].trim()}") excluded as COMPANION_PRODUCT`);
  });
  const frozen = selectFirstEligibleVisual(wfvvbPool);
  check(frozen.index === 0, 'frozen first-eligible-visual is index 0 (the real Mayhew row), not the artbook');

  const result = selectTitleFamilyCandidate(wfvvbPool, 'Venom', '1', null, { visionVariant: 'Tyler Kirkham virgin variant' });
  console.log(`  [decision] ${result.decision}  [selectedTitle] ${JSON.stringify(result.selectedTitle)}`);
  const familyTitles = (result.families || []).map((f) => f.title);
  check(!familyTitles.some((t) => t.includes('ariel') || t.includes('diaz')), 'FORBIDDEN check: "ariel diaz" family does not appear in the election at all');
  check(!familyTitles.some((t) => t.includes('lethal') && t.includes('protector') && result.selectedTitle?.includes('lethal')), 'FORBIDDEN check: Lethal Protector is not the selected identity');
  check(
    (result.selectedTitle && result.selectedTitle.toLowerCase().includes('mayhew')) || (result.decision === 'fallback-vision' && result.selectedTitle === null),
    'REQUIRED: final identity is a Mayhew/Separation-Anxiety family OR an honest contested/refused state (fallback-vision, selectedTitle=null) — never a wrong confident winner'
  );
}

console.log('\nPart B2 [BLOCKING]: dzq9h full pool — zero companion-product exclusions, Dell\'Otto family unchanged');
{
  const exclusions = dzq9hPool.filter((row) => !isEligibleVisualRow(row) && COMPANION_PRODUCT_RE.test(row));
  check(exclusions.length === 0, `zero rows excluded on the new COMPANION_PRODUCT class (got ${exclusions.length})`);
  const result = selectTitleFamilyCandidate(dzq9hPool, 'Amazing Spider-Man', '1', null, { visionVariant: 'Inhyuk Lee virgin variant' });
  check(result.decision === 'weighted-consensus' && result.selectedTitle === 'amazing spider man dell otto gabriele', 'Dell\'Otto family still wins, byte-identical decision path');
}

console.log('\nPart B3 [BLOCKING]: Sabrina negative control — real rank-1 row unaffected, NYCC/LTD/EXCLUSIVE alone does not trip the new pattern');
{
  const sabrinaRow = 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50';
  check(isEligibleVisualRow(sabrinaRow) === true, 'Sabrina\'s real rank-1 row remains eligible');
  const artbookWithNycc = 'Ariel Diaz Art book Venom & Carnage LTD 100 NYCC EXCLUSIVE';
  check(isEligibleVisualRow(artbookWithNycc) === false, 'a row combining "art book" WITH NYCC/LTD/EXCLUSIVE is still excluded — matches on "art book" specifically');
  const nyccWithoutArtbook = 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC LTD 100 EXCLUSIVE';
  check(isEligibleVisualRow(nyccWithoutArtbook) === true, 'C4: NYCC/LTD/EXCLUSIVE tokens ALONE (no artbook/print/portfolio/sketchbook/poster) do not trip the new pattern');
}

console.log('\nPart B4 [reporting]: no false exclusions — real comic titles with near-miss "art" tokens');
{
  check(isEligibleVisualRow('Art Ops #1 Vertigo Comics Shawn McManus') === true, '"Art Ops" (real Vertigo series) remains eligible — bare "art" does not trigger the pattern');
  check(isEligibleVisualRow('The Art of War #1 Comic Book') === true, '"The Art of War" remains eligible');
}

console.log('\nPart B5 [BLOCKING]: AI Rule-1 fixtures unchanged (lot/variation-group classes untouched)');
{
  check(isEligibleVisualRow('Batman #1 Cover B Jim Lee Variant') === true, 'a normal variant-cover listing is still eligible');
  check(isEligibleVisualRow('Huge Lot of 25 Comics Silver Age') === false, 'a lot listing is still ineligible');
  check(isEligibleVisualRow('Sabrina the Teenage Witch comics select an issue') === false, '"select an issue" placeholder is still ineligible');
  check(isEligibleVisualRow('Pick your issue Spider-Man lot') === false, '"pick your issue" placeholder is still ineligible');
  check(isEligibleVisualRow('') === false, 'empty title is still ineligible');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
}
process.exit(failed > 0 ? 1 : 0);
