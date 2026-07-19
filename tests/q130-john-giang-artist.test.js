// Q130 — John Giang missing from ARTIST_PATTERNS/PREMIUM_CREATORS.
//
// Production case, reconstructed from the real Vercel runtime log
// (2026-07-18 20:20:15, build 7357052, POST /api/enrich):
//
//   Physical book: One World Under Doom #1, John Giang MegaCon Secret
//   Drop, SIGNED, Virgin, LTD 500. Real market $32-$115.
//
//   eBay reverse-image search returned 20 items, 16/20 clustering into
//   the "one world under doom john giang" family (weight 22.0). Vision's
//   own title read ("one world under doom") agreed with eBay's dual-axis
//   consensus title at the bare-series level, activating the Q84 gate.
//   Because "giang" had no ARTIST_PATTERNS entry, extractPoolArtistTokens
//   never classified [john, giang] as creator-class, so the 16-member
//   family override was blocked:
//
//     [Q84] override-blocked reason=non-creator additions [john,giang]
//     [title-family] decision=fallback-vision, selected=null
//     [ship12] fallback-vision — blocking unrelated visual pool from comps
//
//   Comps fell through to the standard-cover PriceCharting product +
//   a bare-title active search that happened to surface 2 Inhyuk-Lee-
//   variant listings (a different, unrelated MegaCon artist for the same
//   book who IS in the registry) → final price $9.68 against a real
//   $32-$115 market, and "Inhyuk Lee" displayed as the card's creator.
//
// Fix (Q130): added /john giang/i (multi-word) + /giang/i (bare,
// unambiguous surname) to ARTIST_PATTERNS (compHygiene.js), and a
// matching entry to PREMIUM_CREATORS (premiumCreators.js) so the Ship #16
// display badge doesn't drift from the now-correct identity gate.
//
// Invoke: node tests/q130-john-giang-artist.test.js

import {
  selectTitleFamilyCandidate,
  applyDualAxisGate,
  extractPoolArtistTokens,
} from '../src/lib/imageSearchIdentity.js';
import { ARTIST_PATTERNS } from '../src/lib/compHygiene.js';
import {
  PREMIUM_CREATORS,
  extractCreatorsFromComps,
} from '../src/lib/premiumCreators.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. Collision sweep sanity — bare /giang/i doesn't false-positive ──
console.log('\n── collision sweep sanity ──');
{
  check(/giang/i.test('John Giang'), 'giang matches the real name');
  check(!/giang/i.test('John Giant Gold Variant'), // real seller typo in the pool
    'giang does NOT match the "Giant" misspelling seen in production');
  check(!/giang/i.test('Giant-Size X-Men #1'), 'giang does NOT match "Giant-Size"');
  check(!/giang/i.test('engaging changing hanging arranging'),
    'giang is not a substring of common -ing/-ang English words');
  check(!/john giang/i.test('John Byrne') && !/john giang/i.test('John Romita'),
    'multi-word pattern does not false-match other John-first-name artists');
}

// ── 2. ARTIST_PATTERNS / extractPoolArtistTokens ────────────────────
console.log('\n── extractPoolArtistTokens on the real pool ──');
{
  const realPool = [
    { rawTitle: 'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM' },
    { rawTitle: 'One World Under Doom #1 John Giant Gold Variant Limited to 500' }, // typo, should NOT count
    { rawTitle: 'One World Under Doom #6 Virgin By John Giang MEGACON Secret Drop LTD 500' },
    { rawTitle: 'ONE WORLD UNDER DOOM #1 Giang MegaCon 2025 Secret Drop Limited To 500' },
    { rawTitle: '\u{1F480}ONE WORLD UNDER DOOM #1 John Giang MegaCon 2025 Secret Drop • ltd 500 NM+\u{1F480}' },
  ];
  const tokens = extractPoolArtistTokens(realPool);
  check(tokens.has('giang'), 'giang extracted from pool (ARTIST_PATTERNS)');
  check(tokens.has('john'), 'john extracted via multi-word pattern');
  check(ARTIST_PATTERNS.some((re) => re.test('John Giang')), 'ARTIST_PATTERNS matches "John Giang"');
}

// ── 3. Q84 gate — override now ALLOWED for the Giang family ─────────
console.log('\n── applyDualAxisGate — Giang family now allowed ──');
{
  const giangTokens = new Set(['john', 'giang']);
  const gate = applyDualAxisGate(
    ['one', 'world', 'under', 'doom', 'john', 'giang'],
    ['one', 'world', 'under', 'doom'],
    giangTokens
  );
  check(gate.allowed === true && /creator-tokens/.test(gate.reason),
    `Giang addition allowed (${gate.reason})`);
}

// ── 4. Full production pool reconstruction — end-to-end ─────────────
console.log('\n── One World Under Doom #1 — real 20-item pool reconstruction ──');
{
  // Reconstructed verbatim from the production log (visual titles list),
  // 16 Giang-family members + junk (Doctor Doom remarque, Mortal Kombat,
  // Absolute Batman, Dr. Doom tribute — the real non-matching noise).
  const pool = [
    'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM',
    'One World Under Doom #1 John Giant Gold Variant Limited to 500',
    'One World Under Doom #6 Virgin By John Giang MEGACON Secret Drop LTD 500',
    'ONE WORLD UNDER DOOM #1 Giang MegaCon 2025 Secret Drop Limited To 500',
    '\u{1F480}ONE WORLD UNDER DOOM #1 John Giang MegaCon 2025 Secret Drop • ltd 500 NM+\u{1F480}',
    'ONE WORLD UNDER DOOM #1 Giang MegaCon 2025 Secret Drop ltd 500',
    'ONE WORLD UNDER DOOM #1 JOHN GIANG MEGACON SECRET',
    'ONE WORLD UNDER DOOM #1 JOHN GIANG MEGACON 2025 VIRGIN SECRET DROP LTD 500',
    'ONE WORLD UNDER DOOM #1 - Signed By John Giang, Limited To 500 MEGACON Exclusive',
    'One World Under Doom 1 John Giang Big Time Collectibles MegaCon Variant Ltd 500',
    'DOCTOR DOOM #1 John Giang SIGNED & REMARQUED "Negative" Virgin Variant CGC  COA',
    'Marvel One World Under Doom #1 John Giang Limited Edition Exclusive Variant',
    'ONE WORLD UNDER DOOM #1 John Giang Signed with COA Megacon 2025 Secret Drop',
    'ONE WORLD UNDER DOOM #1 John Giang Signed w/COA Megacon 2025 Secret Drop',
    'ONE WORLD UNDER DOOM #1 - Signed By John Giang, Limited To 500 MEGACON Exclusive',
    'ONE WORLD UNDER DOOM #1 JOHN GIANG MEGACON SECRET DROP LTD 500',
    'ONE WORLD UNDER DOOM #1 John Giang Signed with COA Megacon 2025 Secret Drop',
    'MORTAL KOMBAT LAST STAND EMBOSSED SPOT FOIL BY DARIO ARTE NYCC EXCL LIMITED 25',
    'Absolute Batman #19 - John Giang VIRGIN FOIL Ltd 1000 w/COA 1st Scarecrow UNREAD',
    'Dr. Doom Ultra Foil  "Jack Kirby tribute" By Rudy AO. Lmt. 200 Copies W/COA',
  ].map((rawTitle) => ({ rawTitle }));

  const r = selectTitleFamilyCandidate(pool, 'one world under doom', '1', 2025, {
    ebayConsensusTitle: 'one world under doom',
  });

  check(r.decision === 'top-rank-protection' || r.decision === 'weighted-consensus',
    `Giang family override now fires (decision=${r.decision}, was fallback-vision pre-fix)`);
  // selectedTitle is deliberately sanitized (sanitizeSeriesTitle strips
  // creator names) — the artist signal that actually reaches api/enrich.js
  // (line ~3309, imageSearchTitle = familyCandidate.rawTitle) is rawTitle.
  check(/giang/i.test(r.rawTitle || ''),
    `rawTitle (fed to comps query) carries "giang" (got "${r.rawTitle}")`);
  check(!/\[Q84-dual-axis\]/.test(r.reason || ''),
    `not blocked by Q84 gate (reason: ${r.reason})`);
}

// ── 5. Display badge — extractCreatorsFromComps / PREMIUM_CREATORS ──
console.log('\n── creator display badge ──');
{
  check(PREMIUM_CREATORS.some((c) => c.canonical === 'John Giang'),
    'John Giang present in PREMIUM_CREATORS');

  const giangCompTitles = [
    'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM',
    'ONE WORLD UNDER DOOM #1 Giang MegaCon 2025 Secret Drop Limited To 500',
    'ONE WORLD UNDER DOOM #1 JOHN GIANG MEGACON SECRET',
  ];
  const result = extractCreatorsFromComps(giangCompTitles);
  check(result.consensus.some((e) => e.canonical === 'John Giang' && e.hits >= 2),
    `John Giang reaches display consensus (${JSON.stringify(result.consensus)})`);
}

// ── 6. Regression — Inhyuk Lee's OWN separate variant unaffected ────
console.log('\n── Inhyuk Lee variant (same book, different product) — no regression ──');
{
  // Real comp titles from the same production log's sold-comp pool —
  // a genuinely different MegaCon-exclusive variant of the same book.
  const inhyukTitles = [
    'one world under doom #1 brys comics version nm / inhyuk lee limited 1500 w/coa',
    'one world under doom #1 inhyuk lee, virgin variant nm, w/coa  ltd 898/1000',
    'one world under doom #1 inhyuk lee 1261/1500',
    'one world under doom #1 high grade nm brys comics inhyuk lee virgin limited 1000',
  ];
  const result = extractCreatorsFromComps(inhyukTitles);
  check(result.consensus.some((e) => e.canonical === 'Inhyuk Lee' && e.hits >= 2),
    `Inhyuk Lee still reaches display consensus unaffected by the Giang addition (${JSON.stringify(result.consensus)})`);
  check(!result.consensus.some((e) => e.canonical === 'John Giang'),
    'Giang does not falsely appear in a pool that never mentions him');

  // Confirm the two artists' pools stay distinct products under the Q84
  // gate too — an Inhyuk-Lee-only pool should independently drive its own
  // family override, unaffected by the Giang pattern now also existing.
  const inhyukPool = [
    'One World Under Doom #1 Inhyuk Lee Virgin Variant NM w/COA Ltd 1000',
    'One World Under Doom #1 Inhyuk Lee Brys Comics Version NM Limited 1500 w/COA',
    'ONE WORLD UNDER DOOM #1 INHYUK LEE VIRGIN LTD 898/1000',
    'One World Under Doom #1 Inhyuk Lee 1261/1500',
    'One World Under Doom #1 High Grade NM Brys Comics Inhyuk Lee Virgin Limited 1000',
  ].map((rawTitle) => ({ rawTitle }));
  const r2 = selectTitleFamilyCandidate(inhyukPool, 'one world under doom', '1', 2025, {
    ebayConsensusTitle: 'one world under doom',
  });
  check(r2.decision === 'top-rank-protection' || r2.decision === 'weighted-consensus',
    `Inhyuk Lee family override still fires on its own pool (decision=${r2.decision})`);
  check(/inhyuk/i.test(r2.rawTitle || ''),
    `Inhyuk Lee pool's rawTitle carries "inhyuk", not Giang (got "${r2.rawTitle}")`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
