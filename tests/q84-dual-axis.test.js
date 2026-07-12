// Q84-AMENDED — Dual-axis token-class gate + tiebreak + arc suppression.
//
// Flash #75 (2019): Vision="the flash" AND eBay consensus="the flash" (63%)
// agreed; family override still fired "flash year one" (3-member story-arc
// cluster) → PC + comps queried the arc name → starved → refused a $5 book.
// Wonder Woman #75 counter-case: the SAME override mechanism correctly
// selects the "wonder woman jenny frison" creator family — the fix that
// breaks WW does not ship. Both gates mandatory.
//
// Invoke: node tests/q84-dual-axis.test.js

import {
  selectTitleFamilyCandidate,
  scoreTitleFamilies,
  applyDualAxisGate,
  extractPoolArtistTokens,
  ARC_RE,
} from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. Tiebreak: equal weight → more members wins ──────────────────
console.log('\n── tiebreak ──');
{
  // Arc family ranks 1,2,3 → 4+3+1 = 8. Series family ranks 0,4,5,6 →
  // 5+1+1+1 = 8. Equal weight; series has MORE members (4 vs 3) and must
  // sort first (pre-fix the stable sort kept discovery order).
  const families = [
    { title: 'flash year one', tokens: ['flash', 'year', 'one'], indices: [1, 2, 3], memberTokens: [['flash', 'year', 'one']] },
    { title: 'the flash', tokens: ['the', 'flash'], indices: [0, 4, 5, 6], memberTokens: [['the', 'flash']] },
  ];
  const items = Array.from({ length: 7 }, (_, i) => `item ${i}`);
  const scored = scoreTitleFamilies(families, items);
  check(scored[0].weightSum === scored[1].weightSum, `weights tie (${scored[0].weightSum} == ${scored[1].weightSum})`);
  check(scored[0].count === 4 && scored[0].title === 'the flash',
    `tie → 4-member series family wins (got "${scored[0].title}" count=${scored[0].count})`);
}

// ── 2. Gate unit behavior ───────────────────────────────────────────
console.log('\n── applyDualAxisGate ──');
{
  const noArtists = new Set();
  const arc = applyDualAxisGate(['flash', 'year', 'one'], ['the', 'flash'], noArtists);
  check(arc.allowed === false && /arc-token/.test(arc.reason), `arc addition blocked (${arc.reason})`);

  const frison = applyDualAxisGate(
    ['wonder', 'woman', 'jenny', 'frison'], ['wonder', 'woman'], new Set(['jenny', 'frison'])
  );
  check(frison.allowed === true && /creator-tokens/.test(frison.reason), `creator addition allowed (${frison.reason})`);

  const junk = applyDualAxisGate(['flash', 'gorilla', 'grodd'], ['the', 'flash'], noArtists);
  check(junk.allowed === false && /non-creator/.test(junk.reason), `non-creator addition blocked (${junk.reason})`);

  const drops = applyDualAxisGate(['year', 'one'], ['the', 'flash'], noArtists);
  check(drops.allowed === false && /drops agreed/.test(drops.reason), `dropped agreed tokens blocked (${drops.reason})`);

  check(ARC_RE.test('year of the villain') && ARC_RE.test('knightfall') && ARC_RE.test('part 3') &&
        ARC_RE.test('tie-in') && ARC_RE.test('the offer') && ARC_RE.test('age of') &&
        ARC_RE.test('war of') && ARC_RE.test('rebirth') && ARC_RE.test('finale'),
    'ARC_RE covers the ruled arc vocabulary');
  check(!ARC_RE.test('jenny frison') && !ARC_RE.test('artgerm'), 'ARC_RE does not match creator names');
}

// ── 3. Pool artist consensus ────────────────────────────────────────
console.log('\n── extractPoolArtistTokens ──');
{
  const wwPool = [
    { rawTitle: 'Wonder Woman #75 Jenny Frison Variant DC 2019 NM' },
    { rawTitle: 'Wonder Woman #75 Jenny Frison Cover DC' },
    { rawTitle: 'WONDER WOMAN #75 FRISON VARIANT 2019' },
  ];
  const tokens = extractPoolArtistTokens(wwPool);
  check(tokens.has('frison'), 'frison extracted from pool (ARTIST_PATTERNS)');
  check(tokens.has('jenny'), 'jenny extracted via multi-word pattern');
}

// ── 4. FLASH #75 FIXTURE (mandatory gate) ───────────────────────────
console.log('\n── Flash #75 — arc family blocked, agreed title stands ──');
{
  // Arc listings share no year/publisher noise with the series listings so
  // Jaccard splits them into separate families (prod shape: 3-member arc
  // cluster vs 7-member series family). Arc holds ranks 0-2 (weight 12)
  // and outranks the series (weight 7) — pre-gate it won the override.
  const flashPool = [
    { rawTitle: 'Flash Year One #75 NM' },
    { rawTitle: 'FLASH YEAR ONE #75 High Grade' },
    { rawTitle: 'Flash Year One #75' },
    // Series family, 7 members at ranks 3-9 (weight 7)
    { rawTitle: 'The Flash #75 DC Comics 2019 VF' },
    { rawTitle: 'The Flash #75 2019 DC NM' },
    { rawTitle: 'The Flash #75 DC 2019' },
    { rawTitle: 'The Flash #75 DC Comics 2019 9.4' },
    { rawTitle: 'The Flash #75 (2019) DC' },
    { rawTitle: 'The Flash #75 DC 2019 High Grade' },
    { rawTitle: 'The Flash #75 DC Comics NM 2019' },
  ];
  const r = selectTitleFamilyCandidate(flashPool, 'The Flash', '75', 2019, {
    ebayConsensusTitle: 'The Flash',
  });
  check(r.decision === 'fallback-vision' || /the flash/i.test(r.selectedTitle || ''),
    `arc override does NOT win (decision=${r.decision}, selected=${r.selectedTitle})`);
  check(!/year\s*one/i.test(r.selectedTitle || ''),
    `selected title carries no arc tokens (got "${r.selectedTitle}")`);
  check(/\[Q84-dual-axis\]|fallback|the flash/i.test(r.reason + ' ' + (r.selectedTitle || '')),
    `gate visible in reason (${r.reason})`);
}

// ── 5. WONDER WOMAN #75 COUNTER-FIXTURE (mandatory gate) ────────────
console.log('\n── Wonder Woman #75 — creator family override UNCHANGED ──');
{
  const wwPool = [
    { rawTitle: 'Wonder Woman #75 Jenny Frison Variant DC 2019 NM' },
    { rawTitle: 'Wonder Woman #75 Jenny Frison Variant Cover DC' },
    { rawTitle: 'WONDER WOMAN #75 JENNY FRISON VARIANT 2019 DC' },
    { rawTitle: 'Wonder Woman #75 Jenny Frison Cover B DC 2019' },
    { rawTitle: 'Wonder Woman #75 Frison Variant DC Comics' },
    { rawTitle: 'Wonder Woman #75 Jenny Frison Variant NM DC' },
  ];
  const r = selectTitleFamilyCandidate(wwPool, 'Wonder Woman', '75', 2019, {
    ebayConsensusTitle: 'Wonder Woman',
  });
  check(r.decision === 'top-rank-protection' || r.decision === 'weighted-consensus',
    `creator-family override still fires (decision=${r.decision})`);
  check(/wonder woman/i.test(r.selectedTitle || ''),
    `selected title is the WW family (got "${r.selectedTitle}")`);
  check(!/\[Q84-dual-axis\]/.test(r.reason || ''),
    'WW path not blocked by the gate — $10.39 path unchanged');
}

// ── 6. No dual-axis agreement → gate inert (regression guard) ───────
console.log('\n── gate inert without agreement ──');
{
  const pool = [
    { rawTitle: 'Catwoman Gotham War #5 DC 2023' },
    { rawTitle: 'Catwoman Gotham War #5 DC' },
    { rawTitle: 'Catwoman Gotham War #5 2023 DC' },
    { rawTitle: 'Catwoman Gotham War #5 NM' },
    { rawTitle: 'Catwoman Gotham War #5 DC Comics' },
  ];
  // Vision and eBay consensus DISAGREE → dual-axis gate must not apply,
  // existing override behavior preserved.
  const r = selectTitleFamilyCandidate(pool, 'Catwoman', '5', 2023, {
    ebayConsensusTitle: 'Catwoman Uncovered',
  });
  check(!/\[Q84-dual-axis\]/.test(r.reason || ''),
    `no agreement → gate silent (decision=${r.decision})`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
