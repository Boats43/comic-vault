// tests/q133-slice1b-eom-registry.test.js
//
// Q133 Slice 1b (2026-07-21) — add Kyuyong Eom to ARTIST_PATTERNS (multi-word
// /kyuyong eom/i + bare surname /\beom\b/i, matching the John Giang/Q130
// precedent exactly) and PREMIUM_CREATORS. Drifted-registry class already
// documented in this codebase (Q119, Q128, Q130) — "eom" was simply never
// registered anywhere.
//
// IMPORTANT — traced applyDualAxisGate (imageSearchIdentity.js) line by line
// before assuming an outcome, per standing investigation-first protocol.
// Registering "Kyuyong Eom" makes tokenizeTitleFamily strip it from family
// tokens BEFORE the gate ever runs, and extractPoolArtistTokens (which reads
// the ORIGINAL unstripped titles) now populates poolArtistTokens with
// "kyuyong"/"eom". Net effect on the REAL Invincible pool:
//   - added = fam - agreed narrows from ["eom","atom","eve"] to ["atom","eve"]
//     (eom no longer even reaches the "added" computation — it's gone from
//     fam entirely)
//   - nonCreator stays ["atom","eve"] — neither is a recognized surname
//   - recoverAdjacentCreatorTokens checks whether "atom"/"eve" immediately
//     PRECEDE a recognized surname in the raw text — the real raw title is
//     "...EOM MEGACON EXCLUSIVE ATOM EVE VIRGIN..." — eom is nowhere near
//     adjacent to atom/eve (megacon exclusive sits between them) — recovery
//     does NOT fire
//   - gate reason narrows from "non-creator additions [eom,atom,eve]" to
//     "non-creator additions [atom,eve]" but STILL BLOCKS
// This is the honest, correct, already-anticipated boundary — "Atom Eve" is
// a character name and Q84 has no legitimate-content lane for character
// names (explicitly queued, not this slice). The registry fix is still
// real and valuable: it correctly narrows the block reason (no longer
// blaming the artist's own name), and fully unblocks the case it's actually
// built for — a Kyuyong Eom variant with no trailing character-name suffix.
//
// RESTORED (GrailKey Dispatch 32, 2026-08-08) — the Q140 coherent-content-
// token lane that briefly flipped Part 2's outcome (2026-07-22 through
// 2026-08-08) is deleted. Real-corpus audit (47 scans) found that lane
// produced a beneficial title correction in zero of 15 real firings — every
// firing was marketplace SEO copy, seller-listing boilerplate, or story/
// character content, never the product-identifying-edition-word shape it
// was built for. This file's own header note above ("Atom Eve is a
// character name... explicitly queued, not this slice") turned out to be
// the correct, durable boundary — restored here verbatim as the
// reintroduction guard for exactly this class of regression. See
// docs/PATTERN-LIBRARY.md, "coherent-content lane deletion."
//
// Invoke: node tests/q133-slice1b-eom-registry.test.js

import {
  buildTitleFamilies, scoreTitleFamilies, selectTitleFamilyCandidate,
  tokenizeTitleFamily, extractPoolArtistTokens, applyDualAxisGate,
} from '../src/lib/imageSearchIdentity.js';
import { ARTIST_PATTERNS } from '../src/lib/compHygiene.js';
import { PREMIUM_CREATORS } from '../src/lib/premiumCreators.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q133 Slice 1b — Kyuyong Eom registry addition ===\n');

// Real pool, verbatim, from the live rescan (03:27 UTC 2026-07-21).
const INVINCIBLE_POOL = [
  'INVINCIBLE RETURNS #1 EOM MEGACON EXCLUSIVE ATOM EVE VIRGIN VARIANT LTD 1500',
  'INVINCIBLE #1  KYUYONG EOM SIGNED W/COA!',
  'Invincible #1 Kyuyong EOM MegaCon Exclusive (LTD 1500 with COA) Signed/Remarked',
  'Invincible Returns #1 - Kyuyong Eom VIRGIN 2026 MEGACON Atom Eve Ltd 1500  NM',
  'INVINCIBLE #1 VIRGIN SIGNED TWICE & REMARK KYUYONG EOM ATOM EVE NM',
  'INVINCIBLE #1 ATOM EVE VIRGIN COVER BY EOM MEGACON',
  'Invincible Returns #1 KyuYong Eom C2E2 Exclusive Virgin Variant',
  'Invincible 1 Kyu Yong Eom Megacon 2026 NM IN HAND',
  'INVINCIBLE RETURNS #1 EOM MEGACON ATOM EVE VIRGIN VARIANT LTD 1500 In Hand',
  'INVINCIBLE RETURNS #1 EOM MEGACON ATOM EVE VIRGIN VARIANT LTD 1500 In Hand',
  'Invincible #1 Kyuyong Eom ATOM EVE Megacon 2026 Limited To 1500',
  'Invincible #1 Kyuyong Eom ATOM EVE  Megacon 2026 Limited To 1500',
  'INVINCIBLE #1 VIRGIN KYUYONG EOM EXCL SIGNED RYAN OTTLEY COA ATOM EVE-NM/M',
  'INVINCIBLE RETURNS #1 EOM MEGACON ATOM EVE VIRGIN VARIANT LTD 1500 ',
  'Invincible #1 Kyuyong Eom Megacon 2026 Atom Eve! Ltd Only 1500!',
  'INVINCIBLE #1 ATOM EVE EOM -  LTD 1500.  MEGACON 2026',
  'Invincible #1 Kyuyong Eom Atom Eve MegaCon Exclusive Signed w/ COA LTD 1500',
  'Megacon 2026 Invincible #1 Kyuyong Eom ATOM EVE Exclusive LTD 1500.',
  'Invincible #1 NM Kyuyong Eom MegaCon Exclusive (Limited 1500 with COA)  Signed',
  'INVINCIBLE RETURNS #1 EOM MEGACON ATOM EVE VIRGIN VARIANT LTD 1500 In Hand NM',
];

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — registry recognition
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: registry recognition\n');

assertTrue(ARTIST_PATTERNS.some((p) => p.source === 'kyuyong eom'), 'ARTIST_PATTERNS has the multi-word /kyuyong eom/i entry');
assertTrue(ARTIST_PATTERNS.some((p) => p.source === '\\beom\\b'), 'ARTIST_PATTERNS has the bare-surname /\\beom\\b/i entry');
assertTrue(PREMIUM_CREATORS.some((c) => c.canonical === 'Kyuyong Eom'), 'PREMIUM_CREATORS has Kyuyong Eom');

const poolArtistTokens = extractPoolArtistTokens(INVINCIBLE_POOL);
assertTrue(poolArtistTokens.has('eom'), 'extractPoolArtistTokens recognizes "eom" from the real pool');
assertTrue(poolArtistTokens.has('kyuyong'), 'extractPoolArtistTokens recognizes "kyuyong" from the real pool (multi-word split)');

const familyTokensForItem0 = tokenizeTitleFamily(INVINCIBLE_POOL[0]);
assertFalse(familyTokensForItem0.includes('eom'), 'tokenizeTitleFamily strips "eom" from item[0] tokens (was present pre-fix)');
assertTrue(familyTokensForItem0.includes('atom') && familyTokensForItem0.includes('eve'), 'tokenizeTitleFamily leaves "atom"/"eve" untouched (character name, not a creator pattern)');

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — real Invincible case: gate reason narrows, override still blocks
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: real Invincible pool — honest outcome (narrowed, not flipped)\n');

const families = scoreTitleFamilies(buildTitleFamilies(INVINCIBLE_POOL), INVINCIBLE_POOL);
const topFamily = families[0];
assertEq(topFamily.tokens.join(' '), 'invincible atom eve', 'top family consensus tokens no longer include "eom" (stripped at tokenization)');

const gateResult = applyDualAxisGate(topFamily.tokens, ['invincible'], poolArtistTokens, topFamily.rawTitle);
assertFalse(gateResult.allowed, 'HONEST RESULT: override still blocked — "atom eve" is a character name, no legitimate-content lane (explicitly queued, not this slice)');
assertEq(gateResult.reason, 'non-creator additions [atom,eve]', 'block reason correctly narrows from [eom,atom,eve] to [atom,eve] — eom no longer blamed');

// End-to-end through the real selectTitleFamilyCandidate — confirms the
// full pipeline (not just the gate in isolation) still lands on
// fallback-vision for this exact pool, i.e. Slice 1b does NOT regress
// today's actual (already-priced-correctly-via-Slice-1) Invincible card.
// ebayConsensusTitle mirrors the real api/enrich.js call site
// (visualConsensus?.title, "invincible" per the real production log) —
// dualAxisAgreed (and therefore whether Q84 engages at all) depends on it.
const fullResult = selectTitleFamilyCandidate(INVINCIBLE_POOL, 'invincible', '1', null, {
  ebayConsensusTitle: 'invincible',
});
assertEq(fullResult.decision, 'fallback-vision', 'selectTitleFamilyCandidate: still fallback-vision end-to-end (Slice 1/1c pricing path is untouched by this fix)');

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — the case Slice 1b DOES fully unblock: no trailing character name
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: isolated case — Kyuyong Eom variant with NO character-name suffix\n');

// Same artist, same pool shape, but the variant descriptor is purely
// creator + convention content (no character name attached) — proves the
// registry fix is real and functional, not a no-op in every case.
const CLEAN_POOL = [
  'INVINCIBLE #5 KYUYONG EOM MEGACON EXCLUSIVE VIRGIN VARIANT LTD 800',
  'Invincible #5 Kyuyong Eom MegaCon Exclusive (LTD 800 with COA) Signed',
  'INVINCIBLE #5 EOM SIGNED W/COA MEGACON EXCLUSIVE',
  'Invincible #5 Kyuyong Eom Megacon 2026 Virgin Variant Ltd 800',
  'INVINCIBLE #5 KYUYONG EOM MEGACON EXCLUSIVE VIRGIN VARIANT LTD 800 In Hand',
  'Invincible #5 Kyuyong Eom Megacon Exclusive Virgin',
];
const cleanFamilies = scoreTitleFamilies(buildTitleFamilies(CLEAN_POOL), CLEAN_POOL);
const cleanTop = cleanFamilies[0];
const cleanPoolArtistTokens = extractPoolArtistTokens(CLEAN_POOL);
const cleanGate = applyDualAxisGate(cleanTop.tokens, ['invincible'], cleanPoolArtistTokens, cleanTop.rawTitle);
// Note on the actual mechanism: tokenizeTitleFamily strips "kyuyong eom"
// from EVERY member's tokens before family consensus is even computed, so
// eom/kyuyong can never appear in `added` at all post-fix — the fix doesn't
// make them pass AS creator tokens, it removes them from the token stream
// entirely. With no other variant-descriptor word consistent enough across
// this pool to clear the 60% consensus threshold, the family reduces to
// just "invincible" — added=[] — "same title, nothing added". That's still
// a genuine, verified win: pre-fix, "eom"/"kyuyong" would have survived as
// unrecognized tokens and blocked this exact override.
assertTrue(cleanGate.allowed, 'clean case (no character name): override ALLOWED — the registry fix genuinely works when nothing else is blocking');
assertEq(cleanGate.reason, 'same title, nothing added', 'clean case: eom/kyuyong stripped before the added-token check ever runs, not "passed" as creator content');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
