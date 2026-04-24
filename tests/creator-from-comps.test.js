// Unit tests for Ship #16 — FR-CREATOR-CREDITS.
//
// Helper: extractCreatorsFromComps(titles)
//   Input: array of comp listing title strings
//   Output: { consensus: hits>=2, singletons: hits===1 }
//
// Mirrors the Ship #12a extractKeyFromComps shape. Same dedup-by-canonical
// + sources-cap-at-3 + sort-hits-desc semantics.
//
// Invoke: node tests/creator-from-comps.test.js
// Exit: 0 all-pass, 1 any failure.

import {
  PREMIUM_CREATORS,
  extractCreatorsFromComps,
} from '../src/lib/premiumCreators.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertHas = (arr, predicate, label) => {
  if (Array.isArray(arr) && arr.some(predicate)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    actual: ${JSON.stringify(arr)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertMissing = (arr, predicate, label) => {
  if (!Array.isArray(arr) || !arr.some(predicate)) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    actual: ${JSON.stringify(arr)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #16 — CREATOR FROM COMPS ===\n');

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof extractCreatorsFromComps, 'function', 'extractCreatorsFromComps exported');
assertEq(Array.isArray(PREMIUM_CREATORS), true, 'PREMIUM_CREATORS is array');
assertEq(PREMIUM_CREATORS.length >= 70, true, `PREMIUM_CREATORS has at least 70 entries (got ${PREMIUM_CREATORS.length})`);
const sample = PREMIUM_CREATORS[0];
assertEq(typeof sample.canonical, 'string', 'entry: canonical is string');
assertEq(Array.isArray(sample.aliases), true, 'entry: aliases is array');
assertEq(typeof sample.tier, 'string', 'entry: tier is string');

// All tiers present.
const tiers = new Set(PREMIUM_CREATORS.map((c) => c.tier));
assertEq(tiers.has('legend'), true, 'tier: legend present');
assertEq(tiers.has('premium'), true, 'tier: premium present');
assertEq(tiers.has('modern-premium'), true, 'tier: modern-premium present');
assertEq(tiers.has('current'), true, 'tier: current present');

// ─── Bug fixtures (4 evidence cases) ────────────────────────────────
console.log('\nBug fixtures (4 evidence cases):');

// 1. House of Secrets #106 (1973) — 3 Wrightson titles → consensus
const hos106 = extractCreatorsFromComps([
  'House of Secrets #106 Bernie Wrightson cover CGC 9.0',
  'HOS 106 Wrightson art 1973 DC',
  'House of Secrets 106 Wrightson cover Bronze Age',
  'House of Secrets #106 1973 unrelated',
  'HOS #106 fine condition',
]);
assertHas(hos106.consensus,
  (e) => e.canonical === 'Bernie Wrightson' && e.hits === 3,
  'House of Secrets #106 → Bernie Wrightson consensus, hits=3');

// 2. Flash #156 (1965) — 2 Infantino + 1 Broome
const flash156 = extractCreatorsFromComps([
  'Flash #156 Carmine Infantino cover 1965',
  'Flash 156 Infantino art Silver Age',
  'Flash #156 John Broome story Gardner Fox',
  'Flash 156 1965 unrelated listing',
]);
assertHas(flash156.consensus,
  (e) => e.canonical === 'Carmine Infantino' && e.hits === 2,
  'Flash #156 → Infantino consensus, hits=2');
assertHas(flash156.singletons,
  (e) => e.canonical === 'John Broome' && e.hits === 1,
  'Flash #156 → John Broome singleton');

// 3. Batman C-25 Treasury (1974) — 2 Neal Adams (full name required)
const batmanC25 = extractCreatorsFromComps([
  'Batman C-25 Treasury Neal Adams cover 1974',
  'Limited Collectors Edition C-25 Neal Adams art',
  'Batman C-25 Bronze Age',
]);
assertHas(batmanC25.consensus,
  (e) => e.canonical === 'Neal Adams' && e.hits === 2,
  'Batman C-25 → Neal Adams consensus, hits=2');

// 4. Ghosts #21 (1973) — 2 Cardy + 1 Aparo
const ghosts21 = extractCreatorsFromComps([
  'Ghosts #21 Cardy cover DC 1973',
  'Ghosts 21 Nick Cardy art',
  'Ghosts #21 Aparo art DC Bronze Age',
]);
assertHas(ghosts21.consensus,
  (e) => e.canonical === 'Nick Cardy' && e.hits === 2,
  'Ghosts #21 → Nick Cardy consensus, hits=2');
assertHas(ghosts21.singletons,
  (e) => e.canonical === 'Jim Aparo' && e.hits === 1,
  'Ghosts #21 → Jim Aparo singleton');

// ─── Pattern matching — last-name aliases ───────────────────────────
console.log('\nPattern matching — last-name aliases:');

assertHas(
  extractCreatorsFromComps(['Wrightson cover only', 'WRIGHTSON HOS NM']).consensus,
  (e) => e.canonical === 'Bernie Wrightson' && e.hits === 2,
  'Wrightson alone (uppercase + lowercase) → matches Bernie Wrightson'
);
assertHas(
  extractCreatorsFromComps(['Kirby cover Marvel', 'kirby art mid-grade']).consensus,
  (e) => e.canonical === 'Jack Kirby' && e.hits === 2,
  'Kirby alone → matches Jack Kirby'
);
assertHas(
  extractCreatorsFromComps(['Ditko Spider-Man art', 'DITKO COVER']).consensus,
  (e) => e.canonical === 'Steve Ditko' && e.hits === 2,
  'Ditko alone → matches Steve Ditko'
);

// ─── Multi-word required for ambiguous canonicals ───────────────────
console.log('\nMulti-word required for ambiguous canonicals:');

// "Adams" alone should NOT match Neal Adams (Arthur Adams exists).
const adamsBare = extractCreatorsFromComps([
  'Adams cover DC 1973',
  'Adams art classic',
]);
assertMissing(adamsBare.consensus.concat(adamsBare.singletons),
  (e) => e.canonical === 'Neal Adams',
  'bare "Adams" → does NOT match Neal Adams (full name required)');

// "Lee" alone should NOT match Jim Lee.
const leeBare = extractCreatorsFromComps(['Lee art X-Men 1991', 'lee cover']);
assertMissing(leeBare.consensus.concat(leeBare.singletons),
  (e) => e.canonical === 'Jim Lee',
  'bare "Lee" → does NOT match Jim Lee');

// "Miller" alone should NOT match Frank Miller.
const millerBare = extractCreatorsFromComps(['Miller art Daredevil 1981']);
assertMissing(millerBare.consensus.concat(millerBare.singletons),
  (e) => e.canonical === 'Frank Miller',
  'bare "Miller" → does NOT match Frank Miller');

// But "Frank Miller" full name → matches.
assertHas(
  extractCreatorsFromComps([
    'Daredevil #168 Frank Miller cover',
    'DD 168 frank miller key',
  ]).consensus,
  (e) => e.canonical === 'Frank Miller',
  'full name "Frank Miller" → matches'
);

// "Jim Lee" full name → matches.
assertHas(
  extractCreatorsFromComps([
    'X-Men #1 Jim Lee cover Marvel',
    'X-Men 1 Jim Lee variant',
  ]).consensus,
  (e) => e.canonical === 'Jim Lee',
  'full name "Jim Lee" → matches'
);

// "Neal Adams" full name → matches even though Arthur Adams shares last name.
assertHas(
  extractCreatorsFromComps(['Batman 251 Neal Adams Joker cover']).singletons,
  (e) => e.canonical === 'Neal Adams',
  'full name "Neal Adams" → matches'
);

// ─── Word boundary enforcement ──────────────────────────────────────
console.log('\nWord boundary enforcement:');

assertEq(
  extractCreatorsFromComps(['wrightsoncover']).consensus.length +
    extractCreatorsFromComps(['wrightsoncover']).singletons.length,
  0,
  '"wrightsoncover" (no boundary) → no match'
);
assertEq(
  extractCreatorsFromComps(['Mrwrightson']).consensus.length +
    extractCreatorsFromComps(['Mrwrightson']).singletons.length,
  0,
  '"Mrwrightson" (no boundary) → no match'
);
assertHas(
  extractCreatorsFromComps(['Wrightson, cover']).singletons,
  (e) => e.canonical === 'Bernie Wrightson',
  'punctuation boundary — "Wrightson, cover" → matches'
);
assertHas(
  extractCreatorsFromComps(['cover/Wrightson art']).singletons,
  (e) => e.canonical === 'Bernie Wrightson',
  'slash boundary — "cover/Wrightson" → matches'
);

// Apostrophe handling — Dell'Otto.
assertHas(
  extractCreatorsFromComps([
    "Dell'Otto cover Marvel variant",
    "dellotto exclusive art",
  ]).consensus,
  (e) => e.canonical === "Gabriele Dell'Otto",
  "Dell'Otto + dellotto (alias variant) → consensus hits=2"
);

// ─── Alias dedup — same canonical via different aliases counts once per title ──
console.log('\nAlias dedup:');

// Title contains both "Bernie Wrightson" AND "Wrightson" — should count
// as ONE hit (within-title dedup).
const aliasDedup = extractCreatorsFromComps([
  'Bernie Wrightson cover by Wrightson 1973',  // 2 names, same person → 1 hit
  'Wrightson art HOS',                          // 1 hit
]);
assertHas(aliasDedup.consensus,
  (e) => e.canonical === 'Bernie Wrightson' && e.hits === 2,
  'within-title dedup: "Bernie Wrightson by Wrightson" + "Wrightson" → hits=2 not 3'
);

// Different titles each contributing one hit via different aliases sum.
const crossTitleDedup = extractCreatorsFromComps([
  'Bernie Wrightson cover',  // canonical hit
  'Wrightson art',           // alias hit (same canonical)
  'berni wrightson cover',   // alias variant
]);
assertHas(crossTitleDedup.consensus,
  (e) => e.canonical === 'Bernie Wrightson' && e.hits === 3,
  'cross-title alias dedup: 3 different aliases → 1 entry, hits=3'
);

// ─── Consensus threshold ────────────────────────────────────────────
console.log('\nConsensus threshold:');

// 1 hit = singleton.
const oneHit = extractCreatorsFromComps(['Kirby cover']);
assertEq(oneHit.consensus.length, 0, '1 hit → no consensus');
assertHas(oneHit.singletons, (e) => e.canonical === 'Jack Kirby' && e.hits === 1,
  '1 hit → singleton');

// 2 hits = consensus.
const twoHits = extractCreatorsFromComps(['Kirby cover', 'kirby art']);
assertHas(twoHits.consensus, (e) => e.canonical === 'Jack Kirby' && e.hits === 2,
  '2 hits → consensus');

// Sources capped at 3.
const fiveHits = extractCreatorsFromComps([
  'Kirby cover one',
  'Kirby cover two',
  'Kirby cover three',
  'Kirby cover four',
  'Kirby cover five',
]);
const kirbyEntry = fiveHits.consensus.find((e) => e.canonical === 'Jack Kirby');
assertEq(kirbyEntry?.hits, 5, '5 hits tracked correctly');
assertEq(kirbyEntry?.sources?.length, 3, 'sources capped at 3 even with 5 hits');

// ─── Sort by hits desc ──────────────────────────────────────────────
console.log('\nSort by hits desc:');

const multipleCreators = extractCreatorsFromComps([
  'Kirby cover',
  'Kirby art',
  'Kirby pencils',
  'Ditko cover',
  'Ditko art',
  'Wrightson cover',
]);
assertEq(multipleCreators.consensus[0].canonical, 'Jack Kirby',
  'highest hits first (Kirby with 3)');
assertEq(multipleCreators.consensus[1].canonical, 'Steve Ditko',
  'second-highest second (Ditko with 2)');
assertEq(multipleCreators.singletons[0].canonical, 'Bernie Wrightson',
  'singletons separated (Wrightson with 1)');

// ─── Edge cases ─────────────────────────────────────────────────────
console.log('\nEdge cases — empty / null / unsafe inputs:');

const emptyResult = extractCreatorsFromComps([]);
assertEq(emptyResult.consensus.length, 0, 'empty array → empty consensus');
assertEq(emptyResult.singletons.length, 0, 'empty array → empty singletons');

assertEq(extractCreatorsFromComps(null).consensus.length, 0, 'null → empty');
assertEq(extractCreatorsFromComps(undefined).consensus.length, 0, 'undefined → empty');
assertEq(extractCreatorsFromComps('not-an-array').consensus.length, 0, 'string → empty');
assertEq(extractCreatorsFromComps({}).consensus.length, 0, 'object → empty');

// Mixed-type array — non-strings filtered.
const mixed = extractCreatorsFromComps([
  'Kirby cover',
  null,
  undefined,
  42,
  { title: 'Ditko' },
  'Kirby art',
]);
assertHas(mixed.consensus, (e) => e.canonical === 'Jack Kirby' && e.hits === 2,
  'mixed-type array — only strings counted');

// Title with no creators.
const noCreators = extractCreatorsFromComps([
  'Random comic 1973 Marvel CGC 9.0',
  'Another listing 1980 high grade',
]);
assertEq(noCreators.consensus.length, 0, 'titles with no creators → empty consensus');
assertEq(noCreators.singletons.length, 0, 'titles with no creators → empty singletons');

// ─── Multiple creators in one title ─────────────────────────────────
console.log('\nMultiple creators in one title:');

const multipleInOne = extractCreatorsFromComps([
  'Cardy & Aparo art Ghosts #21 1973',
  'Cardy art Ghosts',
  'Aparo cover Ghosts',
]);
assertHas(multipleInOne.consensus,
  (e) => e.canonical === 'Nick Cardy' && e.hits === 2,
  'Cardy detected when shared title (×2 across titles)');
assertHas(multipleInOne.consensus,
  (e) => e.canonical === 'Jim Aparo' && e.hits === 2,
  'Aparo detected when shared title (×2 across titles)');

// ─── Tier and role surfaced ─────────────────────────────────────────
console.log('\nTier / role surfaced:');

const tieredResult = extractCreatorsFromComps([
  'Kirby cover',
  'Kirby art',
  'Alan Moore Watchmen',
  'Alan Moore writer',
  'Artgerm variant cover',
  'artgerm exclusive cover',
]);
assertHas(tieredResult.consensus,
  (e) => e.canonical === 'Jack Kirby' && e.tier === 'legend' && e.role === 'artist',
  'Kirby surfaces tier=legend, role=artist'
);
assertHas(tieredResult.consensus,
  (e) => e.canonical === 'Alan Moore' && e.tier === 'premium' && e.role === 'writer',
  'Alan Moore surfaces tier=premium, role=writer'
);
assertHas(tieredResult.consensus,
  (e) => e.canonical === 'Artgerm' && e.tier === 'current' && e.role === 'cover',
  'Artgerm surfaces tier=current, role=cover'
);

// ─── Return shape ───────────────────────────────────────────────────
console.log('\nReturn shape:');

const shape = extractCreatorsFromComps(['Kirby cover', 'Kirby art']);
assertEq(typeof shape, 'object', 'returns object');
assertEq(Array.isArray(shape.consensus), true, 'consensus is array');
assertEq(Array.isArray(shape.singletons), true, 'singletons is array');
const e0 = shape.consensus[0];
assertEq(typeof e0.canonical, 'string', 'entry.canonical is string');
assertEq(typeof e0.tier, 'string', 'entry.tier is string');
assertEq(typeof e0.hits, 'number', 'entry.hits is number');
assertEq(Array.isArray(e0.sources), true, 'entry.sources is array');

// ─── Negative cases — substring confusion ───────────────────────────
console.log('\nNegative cases — substring confusion:');

// "Adams" inside another word.
assertEq(
  extractCreatorsFromComps(['Mradams comics']).consensus.length +
    extractCreatorsFromComps(['Mradams comics']).singletons.length,
  0,
  '"Mradams" → no Adams match (fused)'
);

// Character names that resemble creator names — these are in eBay COMIC
// listings so context already filters most. But verify "Jimmy Olsen" doesn't
// match "Jim Lee" or "Jim Aparo" via word boundary on "Jim".
const jimmyOlsen = extractCreatorsFromComps(['Jimmy Olsen 105 Kirby']);
assertHas(jimmyOlsen.singletons,
  (e) => e.canonical === 'Jack Kirby',
  'Jimmy Olsen + Kirby — Kirby still detected'
);
assertMissing(jimmyOlsen.consensus.concat(jimmyOlsen.singletons),
  (e) => e.canonical === 'Jim Lee',
  '"Jimmy" does NOT trigger "Jim Lee" match (word boundary)'
);
assertMissing(jimmyOlsen.consensus.concat(jimmyOlsen.singletons),
  (e) => e.canonical === 'Jim Aparo',
  '"Jimmy" does NOT trigger "Jim Aparo" match'
);

// ─── Summary ────────────────────────────────────────────────────────
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
