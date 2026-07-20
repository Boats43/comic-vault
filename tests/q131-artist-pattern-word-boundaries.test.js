// Q131 systemic-audit follow-up — ARTIST_PATTERNS word-boundary fix.
//
// Real production bug (One World Under Doom #1 / John Giang, build
// c3c8353, 2026-07-19 00:40 UTC): bare /lim/i (Kendrick Lim) matched as a
// substring inside the ordinary word "limited" — present in
// confirmedVariant's own classified-token text ("megacon secret drop
// limited signed virgin") — and because every consumer of ARTIST_PATTERNS
// (api/comps.js's artist-specific query builder, variantIdentity.js's
// extractArtist, imageSearchIdentity.js's extractPoolArtistTokens) loops
// with first-match-wins-then-break, that false match short-circuited
// before /giang/i (or chew/ngu/sanders/frison — everything positioned
// after /lim/i) ever got a chance, regardless of whether the real name was
// ALSO present in the same string. Real symptom: query became
// "one world under doom #1 lim virgin 2025" instead of naming Giang,
// isolating to 1 wrong comp, pricing at $8.63 against a real $30-115 market.
//
// Fix: every single-word ARTIST_PATTERNS entry is now \b-anchored.
//
// Invoke: node tests/q131-artist-pattern-word-boundaries.test.js

import { ARTIST_PATTERNS, COMP_FILTER_VERSION } from '../src/lib/compHygiene.js';
import { extractPoolArtistTokens } from '../src/lib/imageSearchIdentity.js';
import { extractConfirmedVariant } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// First-match-wins helper, mirroring the exact loop shape used by all
// three real consumers (api/comps.js, variantIdentity.js, imageSearchIdentity.js).
const firstMatch = (text) => {
  for (const pattern of ARTIST_PATTERNS) {
    const m = String(text).match(pattern);
    if (m) return m[0];
  }
  return null;
};

// ── 1. Direct regex fix — the exact reported collision ──────────────
console.log('\n── /\\blim\\b/i no longer matches inside "limited" ──');
{
  const limPattern = ARTIST_PATTERNS.find((p) => p.source.toLowerCase().includes('lim') && !p.source.toLowerCase().includes('kendrick'));
  check(!!limPattern, 'the bare lim pattern exists in ARTIST_PATTERNS');
  check(limPattern.source === '\\blim\\b', `pattern source is anchored (got "${limPattern.source}")`);
  check(!limPattern.test('Limited to 500'), 'does NOT match inside "Limited"');
  check(!limPattern.test('One World Under Doom #1 - Signed By John Giang, Limited To 500 MEGACON Exclusive'),
    'does NOT match the exact real production title containing "Limited"');
  check(limPattern.test('Kendrick Lim Variant'), 'STILL matches genuine standalone "Lim" (no false negative)');
  limPattern.lastIndex = 0; // reset — .test() on a global-less /i regex doesn't need this, but stay defensive
}

// ── 2. The real production title: first-match-wins now finds Giang ──
console.log('\n── first-match-wins loop: "Limited" + "Giang" in the same string ──');
{
  const realTitle = 'ONE WORLD UNDER DOOM #1 - Signed By John Giang, Limited To 500 MEGACON Exclusive';
  const match = firstMatch(realTitle);
  check(match !== null && /giang/i.test(match), `first-match-wins now finds "Giang", not "lim" (got "${match}")`);
}

// ── 3. Q130 fixture re-run: genuine non-collision, not luck ─────────
console.log('\n── extractPoolArtistTokens: Q130 fixture, now via genuine per-item correctness ──');
{
  // Same 5-item fixture as Q130's own test — but this time asserting
  // EVERY individual item correctly extracts "giang" (not just that the
  // aggregate count clears the >=2 threshold, which is what let the
  // pre-fix bug hide: 3/5 items happened to use "LTD" instead of
  // "Limited," so the threshold cleared anyway despite item 4 silently
  // mismatching to "lim" under the real per-title loop).
  const q130Pool = [
    'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM',
    'One World Under Doom #1 John Giant Gold Variant Limited to 500', // typo "Giant" — genuinely no giang match expected
    'One World Under Doom #6 Virgin By John Giang MEGACON Secret Drop LTD 500',
    'ONE WORLD UNDER DOOM #1 Giang MegaCon 2025 Secret Drop Limited To 500', // the one that silently mismatched pre-fix
    '\u{1F480}ONE WORLD UNDER DOOM #1 John Giang MegaCon 2025 Secret Drop • ltd 500 NM+\u{1F480}',
  ];
  const results = q130Pool.map((t) => ({ title: t, match: firstMatch(t) }));
  check(/giang/i.test(results[0].match || ''), `item 0 (LTD, no collision) → "${results[0].match}"`);
  check(/giang/i.test(results[2].match || ''), `item 2 (LTD, no collision) → "${results[2].match}"`);
  check(/giang/i.test(results[3].match || ''),
    `item 3 — "Limited" + "Giang" together, the exact real collision case — now genuinely extracts Giang, not "lim" (got "${results[3].match}")`);
  check(/giang/i.test(results[4].match || ''), `item 4 (ltd lowercase, no collision) → "${results[4].match}"`);

  const tokens = extractPoolArtistTokens(q130Pool.map((rawTitle) => ({ rawTitle })));
  check(tokens.has('giang'), 'extractPoolArtistTokens still reaches consensus (>=2) for giang');
}

// ── 4. Spot-check other now-anchored patterns: no false positives ───
console.log('\n── spot-check: "ngu" no longer matches inside "penguin" ──');
{
  const nguPattern = ARTIST_PATTERNS.find((p) => p.source === '\\bngu\\b');
  check(!!nguPattern, 'the bare ngu pattern exists');
  check(!nguPattern.test('Penguin #1 Variant Cover NM'), 'does NOT match inside "Penguin" (real DC character/title)');
  check(!nguPattern.test('Batman Penguin Triumphant Variant'), 'does NOT match inside "Penguin" mid-title either');
  check(nguPattern.test('Kael Ngu Virgin Variant'), 'STILL matches genuine standalone "Ngu" (no false negative)');
}

console.log('\n── spot-check: "ross" no longer matches inside "crossover"/"embossed" ──');
{
  const rossPattern = ARTIST_PATTERNS.find((p) => p.source === '\\bross\\b');
  check(!!rossPattern, 'the bare ross pattern exists');
  check(!rossPattern.test('Spider-Man Crossover Event #1'), 'does NOT match inside "Crossover"');
  check(!rossPattern.test('Embossed Foil Variant Cover'), 'does NOT match inside "Embossed"');
  check(rossPattern.test('Alex Ross Variant Cover'), 'STILL matches genuine standalone "Ross" (no false negative)');
}

console.log('\n── spot-check: "chew" no longer matches inside "chewed"/"chewing" ──');
{
  const chewPattern = ARTIST_PATTERNS.find((p) => p.source === '\\bchew\\b');
  check(!!chewPattern, 'the bare chew pattern exists');
  check(!chewPattern.test('Well-Chewed Corner Copy VG'), 'does NOT match inside "Chewed"');
  check(chewPattern.test('Chew Variant Signed'), 'STILL matches genuine standalone "Chew" (no false negative)');
}

// ── 5. extractConfirmedVariant end-to-end: real per-listing consensus ─
console.log('\n── extractConfirmedVariant: real pool, backfill mode, post-1990 ──');
{
  const pool = [
    { rawTitle: 'ONE WORLD UNDER DOOM #1 - Signed By John Giang, Limited To 500 MEGACON Exclusive' },
    { rawTitle: 'One World Under Doom #1 John Giang MegaCon Secret Drop SIGNED Virgin LTD 500 NM' },
    { rawTitle: 'One World Under Doom #6 Virgin By John Giang MEGACON Secret Drop LTD 500' },
  ];
  // visionVariant=null → backfill mode; year=2025 clears BACKFILL_MIN_YEAR.
  const result = extractConfirmedVariant(pool, null, '2025', 'medium');
  if (result?.consensus?.artist) {
    check(/giang/i.test(result.consensus.artist),
      `extractConfirmedVariant's own artist consensus is "Giang", not "Lim" (got "${result.consensus.artist}")`);
  } else {
    check(false, `extractConfirmedVariant returned no artist consensus at all (result=${JSON.stringify(result)})`);
  }
}

// ── 6. skipCache live verification + cache-versioning follow-up ─────
//
// Real production log (2026-07-19, 01:39:06, build 5506d87 — the
// word-boundary fix's own first live deploy): the One World Under Doom
// #1 / John Giang rescan hit `[active-cache] HIT: v3:one world under
// doom|1` and returned WITHOUT ever calling fetchComps — it replayed the
// exact pool a PRIOR request (00:40:19, build c3c8353, pre-fix) had
// fetched and cached under the old, collision-bugged "lim virgin 2025"
// query ([creator-from-comps] consensus: current/Inhyuk Lee×2, $8.63).
// The fix was correct but the cache never gave it a chance to run.
//
// Verification: replayed the real 20-item eBay pool from that log
// through extractConfirmedVariant + fetchComps directly (bypassing
// every cache layer, exactly as req.body.skipCache===true does in
// api/enrich.js), using live eBay credentials. Result: 18 genuine John
// Giang comps, $12.99-$150, average $63.85 — confirming the underlying
// fix chain is genuinely correct once it executes. (Mechanism note: the
// deciding attempt this run was the Q130 `imageSearchTitle` attempt —
// which already carries "Giang" as literal text from the title-family
// rawTitle — not the artist-specific/confirmedVariant path; consensus
// .artist was excluded this run too, "John Giang" appearing in 15/20
// pool items = 75%, over the Q109-FIX-A 70% not-distinguishing
// threshold. The word-boundary fix still closes a real, general
// collision class — this run just didn't happen to need it as the
// deciding mechanism.)
//
// Same-dispatch systemic fix, matching the exact Q129 precedent
// (COMP_FILTER_VERSION 2->3 for the variantCompsExcludedByEra field):
// ARTIST_PATTERNS word-boundary anchoring changes which comps a
// query/AND-match can admit, so it belongs under the same cache-busting
// mechanism — bumped 3->4 so no future ARTIST_PATTERNS/variant-matching
// deploy silently replays a pre-fix pool for up to KV_TTL.ACTIVE (1h).
console.log('\n── Part 6: comp-filter cache version bump closes the stale-cache-replay gap ──');
{
  // >= rather than === so a later dispatch bumping this same shared
  // constant again doesn't need to come back and edit this assertion too
  // (the exact friction fixed in tests/q129-...test.js's own Part 5 here).
  check(COMP_FILTER_VERSION >= 4, `COMP_FILTER_VERSION is >= 4 (got ${COMP_FILTER_VERSION}) — Q131's ARTIST_PATTERNS word-boundary fix changes query/AND-match admission, same class as Q129's MERCH_RE/field-shape bumps`);
  const oldKey = `v3:one world under doom|1`;
  const newKey = `v${COMP_FILTER_VERSION}:one world under doom|1`;
  check(oldKey !== newKey, 'the active-comp cache key changes with the version bump — the real pre-fix v3: entry that masked this fix live is unreachable under the new key, forcing a fresh fetchComps pass');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
