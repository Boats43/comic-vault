// Q136 Slice A (2026-07-22, Variant-precision pricing dispatch) — artist-axis
// tier. Real production case: Pop Kill #1 (Alexander Lozano MegaCon "Naughty"
// Metal LTD 100) priced off a Warren Louw virgin sold comp — a real,
// different variant by a different artist — because nothing in either
// pipeline ever isolated on artist once a variant string was present.
//
// Stability requirements for this slice (explicit, from the dispatch):
//   1. Strictly additive — new tier sits ABOVE Filter 1c's existing result,
//      never replaces it. Empty new tier = byte-identical current behavior.
//   2. Engagement gate — only when an artist is actually recognized. Base
//      books / no-artist-signal variants never enter the new code.
//   3. No invented thresholds — ARTIST_NARROWING_FLOOR=1 reuses Filter 1c's
//      own existing premium-variant-isolation floor (flagged for sign-off
//      in the dispatch report, not a new number).
//   4/5. (signed-conditional, limitation-axis) — separate slices, not here.
//
// Byte-identical proof for the 4 required control books (Poison Ivy #31,
// Catwoman #64, Batman #608, a Silver Age book) was ALSO independently
// verified via git-stash diff on applyVariantPreferenceFilter itself
// (compHygiene.js stashed/restored, JSON output byte-diffed — zero delta).
// This file additionally proves the composed no-op at the unit level.
//
// Invoke: node tests/q136-slice-a-artist-axis.test.js

import { applyVariantPreferenceFilter, applyArtistPreferenceNarrowing } from '../api/comps.js';
import { extractArtist, classifyArtistMatch } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── Requirement 2: engagement gate — no-op for the 4 control books ──────
console.log('\n── Control fixtures: no recognized artist → complete no-op ──');
{
  const controls = {
    'Poison Ivy #31 (signed, Jenny Frison — not in ARTIST_PATTERNS as a bare match here)': {
      variant: 'signed',
      pool: [
        { title: 'Poison Ivy #31 Variant Signed by Jenny Frison 2025 w/COA' },
        { title: 'Poison Ivy #31 Variant Cover B SIGNED by Jenny Frison WITH COA 2025 NM' },
      ],
    },
    'Catwoman #64 (Szerdy exclusive)': {
      variant: 'exclusive limited',
      pool: [
        { title: 'Catwoman #64 Nathan Szerdy Trade Dress Exclusive Variant /3000' },
        { title: 'Catwoman #64 Regular Cover DC Comics 2007' },
      ],
    },
    'Batman #608 (no variant at all)': {
      variant: null,
      pool: [
        { title: 'Batman #608 Jim Lee Hush DC Comics 2002 CGC 9.6' },
        { title: 'Batman #608 Hush Part 1 Jim Lee NM' },
      ],
    },
    'Silver Age book (Fantastic Four #4, no variant)': {
      variant: null,
      pool: [
        { title: 'Fantastic Four #4 1962 Marvel Comics First Sub-Mariner Silver Age' },
        { title: 'Fantastic Four #4 Marvel 1962 GD/VG' },
      ],
    },
  };

  for (const [label, { variant, pool }] of Object.entries(controls)) {
    const filterResult = applyVariantPreferenceFilter(pool, variant);
    const narrowed = applyArtistPreferenceNarrowing(filterResult, variant);
    check(narrowed === filterResult,
      `${label}: applyArtistPreferenceNarrowing returns the EXACT SAME object reference (true no-op, not just equal contents)`);
  }
}

// Jim Lee IS in ARTIST_PATTERNS (bare /\bkirkham\b/, not lee — wait, check:
// "jim lee" IS a multi-word pattern). Batman #608's pool above literally
// says "Jim Lee" — worth an explicit control proving that even when an
// ARTIST_PATTERNS name IS present in the POOL, narrowing only engages when
// OUR confirmed variant/title actually names that artist (engagement gate
// is on OUR signal, not on whatever the pool happens to mention).
console.log('\n── Control: pool mentions a registered artist, but OUR variant/title does not ──');
{
  const pool = [
    { title: 'Batman #608 Jim Lee Hush DC Comics 2002 CGC 9.6' },
    { title: 'Batman #608 Hush Part 1 Jim Lee NM' },
  ];
  const filterResult = applyVariantPreferenceFilter(pool, null);
  const narrowed = applyArtistPreferenceNarrowing(filterResult, null, null);
  check(narrowed === filterResult,
    'no artistOverride, no variant naming an artist → no-op even though the pool itself mentions "Jim Lee"');
}

// ── Requirement 1: strictly additive — empty new tier for a real variant
//    book with premium tokens but no artist signal ──────────────────────
console.log('\n── Additive proof: premium-variant book, zero artist signal ──');
{
  // A genuine SDCC exclusive with no named artist at all.
  const pool = [
    { title: 'Some Comic #1 SDCC Exclusive Variant 2024' },
    { title: 'Some Comic #1 SDCC Exclusive Foil Variant 2024' },
    { title: 'Some Comic #1 Regular Cover 2024' },
  ];
  const variant = 'sdcc exclusive';
  const before = applyVariantPreferenceFilter(pool, variant);
  const after = applyArtistPreferenceNarrowing(before, variant);
  check(after === before, 'no artist named anywhere → Filter 1c\'s own isolation result passes through completely unchanged');
  check(before.isolated === true && before.pool.length === 2,
    `sanity: Filter 1c itself still isolates to the 2 SDCC-exclusive comps as before this dispatch (got isolated=${before.isolated}, count=${before.pool.length})`);
}

// ── Lead fixture: Lozano metal LTD 100 vs Warren Louw virgin ────────────
console.log('\n── Lozano metal LTD 100: must anchor to Lozano comps, not Warren Louw ──');
{
  // Reconstructed from the real production pool (Vercel runtime logs,
  // 2026-07-22 rescan) — genuine Lozano MegaCon exclusive listings plus
  // the real wrong-sibling Warren Louw virgin that won the price before
  // this fix.
  const pool = [
    { title: 'Alexander Lozano Signed Pop Kill #1 Metal Megacon Exclusive (Naughty) LTD 100', price: 250 },
    { title: 'Pop Kill #1 Alexander Lozano SIGNED MegaCon METAL Exclusive Variant Set Ltd.100', price: 220 },
    { title: 'SIGNED Pop Kill #1 Lozano METAL Naughty Variant LTD 100', price: 199 }, // real title (production log line 83) — has none of megacon/exclusive/limited, so Filter 1c's OWN pre-existing OR-match drops it before artist-narrowing ever runs, same as in real production (before=8 after=6 there too)
    { title: 'Pop Kill #1 MegaCon Ex. Alexander Lozano Naughty Metal Variant LTD 100 - SIGNED', price: 210 },
    { title: 'Pop Kill [NYCC Louw Virgin] #1 (2025)', price: 30 }, // the real wrong-sibling comp
  ];
  const confirmedTitle = 'Alexander Lozano Signed Pop Kill #1 Metal Megacon Exclusive (Naughty) LTD 100';
  const variant = 'megacon exclusive limited'; // matches the real confirmedVariant (no "lozano" — the ratio-ceiling gap, untouched by this slice)
  const artistOverride = extractArtist(confirmedTitle);

  check(artistOverride === 'alexander lozano', `extractArtist(confirmedTitle) recognizes Lozano (got "${artistOverride}")`);

  const filterResult = applyVariantPreferenceFilter(pool, variant);
  check(filterResult.pool.length === 3,
    `sanity: Filter 1c's OWN pre-existing matching (unchanged by this slice) drops the "SIGNED...METAL Naughty..." title for lacking megacon/exclusive/limited text — 3 of 5 survive, not this slice's concern (got ${filterResult.pool.length})`);
  const narrowed = applyArtistPreferenceNarrowing(filterResult, variant, artistOverride);

  check(narrowed.isolated === true, 'artist-preference narrowing engaged');
  check(!narrowed.pool.some((it) => it.title.includes('Louw')),
    'Warren Louw virgin comp EXCLUDED from the priced pool');
  check(narrowed.pool.length === 3 && narrowed.pool.every((it) => it.title.toLowerCase().includes('lozano')),
    `the 3 Lozano comps that survived Filter 1c all remain, Louw excluded (got ${narrowed.pool.length})`);
}

// ── Fixture: artistOverride recovers the signal even when confirmedVariant
//    itself doesn't carry the artist name (the real production shape —
//    extractConfirmedVariant's own ratio-ceiling excludes majority-artist
//    consensus, untouched by this slice; artistOverride is independent) ──
console.log('\n── artistOverride independent of confirmedVariant (real production shape) ──');
{
  const pool = [
    { title: 'Alexander Lozano Signed Pop Kill #1 Metal Megacon Exclusive LTD 100' },
    { title: 'Pop Kill [NYCC Louw Virgin] #1 (2025)' },
  ];
  // confirmedVariant carries NO artist token at all (matches the real log:
  // "[variant-identity] consensus: {"convention":"megacon","exclusive":"exclusive","limitation":"limited"}")
  const variant = 'megacon exclusive limited';
  check(extractArtist(variant) === null, 'sanity: extractArtist(variant) alone finds nothing, matching the real gap');
  const artistOverride = extractArtist('Alexander Lozano Signed Pop Kill #1 Metal Megacon Exclusive LTD 100');
  const filterResult = applyVariantPreferenceFilter(pool, variant);
  const narrowed = applyArtistPreferenceNarrowing(filterResult, variant, artistOverride);
  check(narrowed.pool.length === 1 && !narrowed.pool[0].title.includes('Louw'),
    'artistOverride alone recovers the signal and excludes Louw even when confirmedVariant carries nothing');
}

// ── Regression: Invincible #1 MegaCon (Kyuyong Eom) — prefers Eom comps
//    over an other-artist exclusive sibling ─────────────────────────────
console.log('\n── Invincible #1 MegaCon: prefers Eom comps over a different artist\'s exclusive ──');
{
  const pool = [
    { title: 'Invincible #1 MegaCon Exclusive Kyuyong Eom Variant 2026' },
    { title: 'Invincible #1 MegaCon Exclusive Kyuyong Eom Signed 2026' },
    { title: 'Invincible #1 MegaCon Exclusive John Giang Variant 2026' }, // a different artist's own exclusive for the same con/book
  ];
  const variant = 'megacon exclusive';
  const artistOverride = extractArtist('Invincible #1 MegaCon Exclusive Kyuyong Eom Variant');
  check(artistOverride === 'kyuyong eom', `extractArtist recognizes Eom (got "${artistOverride}")`);
  const filterResult = applyVariantPreferenceFilter(pool, variant);
  const narrowed = applyArtistPreferenceNarrowing(filterResult, variant, artistOverride);
  check(narrowed.pool.length === 2 && !narrowed.pool.some((it) => it.title.includes('Giang')),
    `Giang's exclusive excluded, only the 2 genuine Eom comps survive (got ${narrowed.pool.length})`);
}

// ── Observed during testing, NOT part of this slice's fix (flagged, not
//    silently worked around): classifyArtistMatch does EXACT string
//    equality between extractArtist(ourArtist-source) and
//    extractArtist(comp title) — "kyuyong eom" (full, from a title
//    naming both names) vs bare "eom" (from a title naming only the
//    surname) are different STRINGS even though they're the same artist,
//    so a comp with only the bare surname would classify as 'mismatch'
//    rather than 'match' against a full-name ourArtist. This is a
//    PRE-EXISTING characteristic of classifyArtistMatch (unchanged by
//    this slice, just promoted/relocated) — not something Slice A
//    introduces or should fix under "one slice, one concern." Documented
//    here so it isn't silently lost; a future slice could compare
//    surnames-only or consult premiumCreators.js aliases both directions.
console.log('\n── Observed (not fixed here): full-name vs bare-surname exact-match gap ──');
{
  const outcome = classifyArtistMatch('Invincible #1 MegaCon Exclusive Eom Signed 2026', 'kyuyong eom');
  check(outcome === 'mismatch',
    `documents the gap: bare "Eom" classifies as '${outcome}' against ourArtist="kyuyong eom", not 'match' — flagged for a future slice, not fixed here`);
}

// ── Regression control: ASM #26 Nakayama 1:50 must keep working ────────
console.log('\n── Regression: ASM #26 Nakayama 1:50 ratio still isolates correctly ──');
{
  const pool = [
    { title: 'Amazing Spider-Man #26 David Nakayama 1:50 Variant 2018' },
    { title: 'Amazing Spider-Man #26 David Nakayama 1:50 Ratio Variant Signed 2018' },
    { title: 'Amazing Spider-Man #26 Regular Cover 2018' },
    { title: 'Amazing Spider-Man #26 InHyuk Lee Variant 2018' }, // different artist, different variant — must not blend
  ];
  const variant = 'david nakayama 1:50';
  const artistOverride = extractArtist(variant);
  // ARTIST_PATTERNS has no multi-word "david nakayama" entry, only bare
  // /\bnakayama\b/i — extractArtist correctly returns the bare surname.
  check(artistOverride === 'nakayama', `extractArtist recognizes the bare surname (got "${artistOverride}")`);
  const filterResult = applyVariantPreferenceFilter(pool, variant);
  // classifyVariantTokens has no "artist" category at all (this dispatch's
  // own investigation finding) — "david"/"nakayama" classify as nothing,
  // only "1:50" (ratio) does, so specificWords.length===1 → mode='any',
  // NOT 'all-specific'. Filter 1c's pre-existing ratio-token OR-match is
  // what isolates this pool today (unchanged); the NEW artist-narrowing
  // layer below is what adds the artist axis on top.
  check(filterResult.matchMode === 'any', `Filter 1c's pre-existing ratio-only match (mode=${filterResult.matchMode}) — unchanged by this slice`);
  const narrowed = applyArtistPreferenceNarrowing(filterResult, variant, artistOverride);
  check(narrowed.pool.length === 2 && narrowed.pool.every((it) => it.title.includes('Nakayama')),
    `both genuine Nakayama 1:50 comps survive, InHyuk Lee excluded (got ${narrowed.pool.length})`);
}

// ── Unit coverage: classifyArtistMatch outcomes (promoted function) ─────
console.log('\n── Unit: classifyArtistMatch (promoted to compHygiene.js) ──');
{
  check(classifyArtistMatch('Pop Kill #1 Alexander Lozano Signed', 'alexander lozano') === 'match', 'full curated match');
  check(classifyArtistMatch('Pop Kill [NYCC Louw Virgin] #1', 'alexander lozano') === 'no-signal', 'no-signal: comp corroborates nothing');
  check(classifyArtistMatch('Invincible #1 John Giang Variant', 'kyuyong eom') === 'mismatch', 'mismatch: comp names a DIFFERENT known artist');
  check(classifyArtistMatch('Anything', null) === 'match', 'null ourArtist → unconditional match (nothing to check)');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
