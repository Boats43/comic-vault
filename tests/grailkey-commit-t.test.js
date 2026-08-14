// tests/grailkey-commit-t.test.js
//
// GrailKey Commit T — Marvel Tales #14 class, second layer.
//
// Commit S fixed the title-family override gate (applyDualAxisGate). This
// commit fixes a SEPARATE, LATER corruption: even with the family override
// correctly landing on "marvel tales" at the end of Phase 1
// (source=title-family-weighted-consensus, 17/20 eBay rows), Q141-A's
// canonical-title projection unconditionally overwrote it with a
// PriceCharting anchor's product name 180ms later, because:
//
//   T1 — q141-a (api/enrich.js ~4605) never checked WHERE confirmedTitle
//        came from. It projected from ANY accepted PC anchor, regardless
//        of whether confirmedTitle was a bare Vision guess or a
//        corroborated title-family consensus. Fixed: isCorroboratedIdentitySource
//        (identityCore.js) — reuses FAMILY_OVERRIDE_DECISIONS
//        (compHygiene.js) directly, no invented source enum — gates the
//        overwrite off entirely when identitySource is
//        'title-family-weighted-consensus' or 'title-family-top-rank-protection'.
//
//   T2 — titleOverlapsProduct (identityCore.js), the gate that's supposed
//        to reject a bad PC anchor before it's ever used, ran its OWN,
//        independent tokenizer with a local PC_MATCH_COMMON_TOKENS
//        stoplist that hard-coded "marvel" as always-generic — wrong for
//        "Marvel Tales," where "Marvel" is part of the actual series
//        name. "marvel tales" vs "Tales of Asgard #14" computed 100%
//        overlap (1 matched token / 1 remaining token, "marvel" stripped
//        from both the numerator's own book-keeping and the denominator).
//        Fixed: reuses tokenizeTitle (compHygiene.js) — the SAME
//        tokenizer title-family scoring already uses, Q54-compound-
//        protected ("marvel tales" is a real COMPOUND_WHITELIST entry) —
//        so "marvel" survives as a real token. Threshold raised 0.5 ->
//        0.6, reusing this function's own pre-existing documented
//        reference point ("the stricter 0.6 pool-consensus bar used
//        elsewhere in this file"), not a new number.
//
//   T3 — the PC lookup wrote whatever `result` it got straight to the
//        durable 24h `pc:v1:...` cache with no overlap check at all.
//        Once poisoned (by an EARLIER request whose confirmedTitle was
//        itself wrong), the entry serves the wrong product back to every
//        later request for the same key for up to 24h, including one
//        whose identity has since been correctly resolved. Fixed: the
//        SAME titleOverlapsProduct gate now runs before either durable
//        cache write (full-title key and stripped-title fallback key).
//
// T1/T3's real call sites are embedded inline in api/enrich.js's large
// stateful handler (confirmedTitle mutation, out.* writes, cache I/O) —
// not independently invokable pure functions, same limitation Commit
// P's/Q's own tests document for App.jsx render sites and Q0's write
// site. Asserted here are the REAL exported primitives
// (isCorroboratedIdentitySource, titleOverlapsProduct) the real call
// sites now gate on, plus a static wiring guard confirming the real call
// sites actually invoke them.
//
// Invoke: node tests/grailkey-commit-t.test.js

import { titleOverlapsProduct, isCorroboratedIdentitySource, projectCanonicalTitleFromAnchor } from '../src/lib/identityCore.js';
import { tokenizeTitle, hasSufficientTitleOverlap, FAMILY_OVERRIDE_DECISIONS } from '../src/lib/compHygiene.js';
import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit T — q141-a corroborated-identity guard + PC overlap tightening ===\n');

// Mirrors the REAL q141-a overwrite decision (api/enrich.js ~4605-4645) —
// composes the two REAL exported primitives exactly as the real call site
// does, so tests exercise the identical decision without re-deriving it.
const wouldQ141AOverwrite = (confirmedTitle, identitySource, anchorProductName) => {
  const canonicalTitle = projectCanonicalTitleFromAnchor(anchorProductName);
  if (!canonicalTitle || canonicalTitle === confirmedTitle) return { overwrites: false, canonicalTitle };
  if (isCorroboratedIdentitySource(identitySource)) return { overwrites: false, canonicalTitle, skippedReason: 'corroborated' };
  return { overwrites: true, canonicalTitle };
};

// ══════════════════════════════════════════════════════════════════════════════
// T-1 — Marvel Tales fixture, verbatim: confirmedTitle survives q141-a.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-1 — confirmedTitle survives q141-a as "marvel tales"\n');
{
  const result = wouldQ141AOverwrite('marvel tales', 'title-family-weighted-consensus', 'Tales of Asgard #14');
  assertFalse(result.overwrites, `T-1: q141-a does not overwrite (${result.skippedReason})`);
  assertEq(result.canonicalTitle, 'Tales of Asgard', 'T-1: the anchor WOULD have projected to "Tales of Asgard" — confirms this is a genuine conflict, not a no-op fixture');
}

// ══════════════════════════════════════════════════════════════════════════════
// T-2 — downstream consequence: comps query uses "marvel tales #14 1968"
// (confirmedTitle, unchanged by T-1) -> real Marvel Tales #14 comp titles
// survive title-similarity; against "Tales of Asgard" they would not.
// api/comps.js's actual comp-fetch loop is a large stateful function
// (network calls, multi-attempt query loop) not independently invokable
// here — asserted is the REAL exported title-similarity predicate
// (hasSufficientTitleOverlap, compHygiene.js Filter 0b) it applies,
// against real production comp titles from this exact book's own pool.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-2 — comps survive under the corrected title, not the wrong one\n');
{
  const realCompTitles = [
    'Marvel Tales #14 Marvel 1968 Reprints of early Marvel issues',
    'MARVEL TALES #14 1968 SPIDEY THOR HUMAN TORCH SILVER AGE GIANT 68 PAGES NICE!',
    'Marvel Tales #14 Featuring Spider-Man, Thor & Human Torch, Very Good Condition',
  ];
  const correctTokens = tokenizeTitle('marvel tales');
  const wrongTokens = tokenizeTitle('Tales of Asgard');
  const survivorsUnderCorrectTitle = realCompTitles.filter((t) => hasSufficientTitleOverlap(t, correctTokens));
  const survivorsUnderWrongTitle = realCompTitles.filter((t) => hasSufficientTitleOverlap(t, wrongTokens));
  assertEq(survivorsUnderCorrectTitle.length, 3, 'T-2: all 3 real Marvel Tales #14 comps survive title-similarity under the corrected title');
  assertTrue(survivorsUnderWrongTitle.length < survivorsUnderCorrectTitle.length, 'T-2: fewer (here, zero) survive under "Tales of Asgard" — confirms T-1\'s fix has a real downstream pricing effect, not just a cosmetic title difference');
}

// ══════════════════════════════════════════════════════════════════════════════
// T-3 — PC anchor "Tales of Asgard #14" REJECTED on overlap against
// "marvel tales".
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-3 — PC anchor rejected on overlap\n');
{
  assertFalse(titleOverlapsProduct('marvel tales', 'Tales of Asgard #14'), 'T-3: titleOverlapsProduct now correctly rejects this anchor');
}

// ══════════════════════════════════════════════════════════════════════════════
// T-4 — no durable PC cache write under a contradicting product. The real
// call site (api/enrich.js) gates kvSet on the identical titleOverlapsProduct
// check T-3 just exercised — asserted here is that same real predicate
// against the same real key/product pair, mirroring the write-site's own
// condition exactly.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-4 — durable cache write guard\n');
{
  const confirmedTitleAtWriteTime = 'marvel tales';
  const productReturnedByPC = 'Tales of Asgard #14';
  const wouldWrite = titleOverlapsProduct(confirmedTitleAtWriteTime, productReturnedByPC);
  assertFalse(wouldWrite, 'T-4: the write guard would SKIP caching "Tales of Asgard #14" under the marvel-tales key');
}

// ══════════════════════════════════════════════════════════════════════════════
// T-5 (CRITICAL) — a legitimate q141-a projection must still fire.
// Uncorroborated Vision-only identity ("Spawn Brett Booth" — Vision read
// creator-credit text off the cover into the title field, a real class
// this projection was built for) corrected by a genuinely-matching PC
// anchor -> UNCHANGED, still overwrites to "Spawn".
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-5 (CRITICAL) — legitimate projection unaffected\n');
{
  const result = wouldQ141AOverwrite('Spawn Brett Booth', 'vision', 'Spawn #351 (2024)');
  assertTrue(result.overwrites, `T-5: uncorroborated Vision-sourced title still gets corrected (canonical="${result.canonicalTitle}")`);
  assertEq(result.canonicalTitle, 'Spawn', 'T-5: projects to "Spawn" exactly as before this commit');
  assertFalse(isCorroboratedIdentitySource('vision'), 'T-5: plain "vision" source is correctly NOT treated as corroborated');

  // The Batman #15 "batman machine gun" class this projection was
  // originally built for — same shape, confirms general behavior intact.
  const batman = wouldQ141AOverwrite('batman machine gun', 'title-family-fallback-vision', 'Batman #15 (1943)');
  assertTrue(batman.overwrites, `T-5: Batman #15 class (source not in FAMILY_OVERRIDE_DECISIONS) still corrects (canonical="${batman.canonicalTitle}")`);
}

// ══════════════════════════════════════════════════════════════════════════════
// T-6 — Iron Man #126, ASM #300, ASM #147 byte-identical. All three are
// clean matches (confirmedTitle already equals or is a genuine subset of
// a correctly-matching PC anchor) — titleOverlapsProduct passes at the
// NEW 0.6 threshold exactly as it did at the old 0.5 threshold (100%
// overlap either way), so neither T1 nor T2 changes their outcome.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-6 — unaffected books byte-identical\n');
{
  const fixtures = [
    { label: 'Iron Man #126', confirmedTitle: 'Iron Man', productName: 'Iron Man #126 (1979)' },
    { label: 'ASM #300', confirmedTitle: 'Amazing Spider-Man', productName: 'Amazing Spider-Man #300 (1988)' },
    { label: 'ASM #147', confirmedTitle: 'Amazing Spider-Man', productName: 'Amazing Spider-Man #147 (1975)' },
  ];
  for (const { label, confirmedTitle, productName } of fixtures) {
    assertTrue(titleOverlapsProduct(confirmedTitle, productName), `T-6: ${label} — titleOverlapsProduct still true at the 0.6 threshold`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// T-7 — MUTATION: restore unconditional q141-a overwrite -> T-1 FAILS.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-7 — mutation: unconditional overwrite\n');
{
  const naiveWouldOverwrite = (confirmedTitle, identitySource, anchorProductName) => {
    const canonicalTitle = projectCanonicalTitleFromAnchor(anchorProductName);
    if (!canonicalTitle || canonicalTitle === confirmedTitle) return { overwrites: false, canonicalTitle };
    return { overwrites: true, canonicalTitle }; // no corroboration check at all — pre-Commit-T
  };
  const naive = naiveWouldOverwrite('marvel tales', 'title-family-weighted-consensus', 'Tales of Asgard #14');
  assertTrue(naive.overwrites, 'MUTATION: the naive pre-fix logic overwrites "marvel tales" -> "Tales of Asgard" — reproduces the live bug');
  const real = wouldQ141AOverwrite('marvel tales', 'title-family-weighted-consensus', 'Tales of Asgard #14');
  assertFalse(real.overwrites, 'MUTATION CONTRAST: the REAL post-fix logic does not — T-1 genuinely depends on this commit\'s code, not the fixture alone');
}

// ══════════════════════════════════════════════════════════════════════════════
// T-8 — MUTATION: restore the loose overlap check -> T-3 FAILS.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nT-8 — mutation: loose PC_MATCH_COMMON_TOKENS overlap check\n');
{
  const PC_MATCH_COMMON_TOKENS = new Set(['marvel', 'dc', 'image', 'idw', 'comics', 'comic', 'book', 'the', 'a', 'an', 'of', 'and', 'in', 'for', 'dark', 'horse', 'boom', 'archie', 'dynamite']);
  const naiveOverlaps = (confirmedTitle, productName, threshold = 0.5) => {
    const tokenize = (s) => String(s || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((t) => t.length > 1 && !PC_MATCH_COMMON_TOKENS.has(t));
    const confirmedTokens = tokenize(confirmedTitle);
    if (confirmedTokens.length === 0) return true;
    const productTokens = tokenize(productName);
    const overlapCount = confirmedTokens.filter((t) => productTokens.includes(t)).length;
    return (overlapCount / confirmedTokens.length) >= threshold;
  };
  assertTrue(naiveOverlaps('marvel tales', 'Tales of Asgard #14'), 'MUTATION: the naive pre-fix overlap check accepts this anchor (100% — "marvel" stripped from both sides) — reproduces the live bug');
  assertFalse(titleOverlapsProduct('marvel tales', 'Tales of Asgard #14'), 'MUTATION CONTRAST: the REAL post-fix titleOverlapsProduct rejects it — T-3 genuinely depends on this commit\'s code, not the fixture alone');
}

// ══════════════════════════════════════════════════════════════════════════════
// Regression — pre-existing q-pc-requery-gate.test.js fixtures, re-verified
// against the new tokenizer + threshold directly (that suite is also run
// standalone as part of this commit's regression sweep).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nRegression — pre-existing titleOverlapsProduct fixtures\n');
{
  assertTrue(titleOverlapsProduct('Amazing Spider-Man', 'Amazing Spider-Man #300 (1988)'), 'ASM #300 regression anchor unaffected');
  assertFalse(titleOverlapsProduct('Amazing Spider Versity', 'Spider-Verse (2014) #1 Camuncoli Variant'), 'Spider-Versity still rejected');
  assertTrue(titleOverlapsProduct('The Comics', 'Amazing Spider-Man #300 (1988)'), 'degenerate confirmedTitle still short-circuits true');
}

// ══════════════════════════════════════════════════════════════════════════════
// Static wiring guard — api/enrich.js's real call sites actually import
// and invoke isCorroboratedIdentitySource (T1) and gate both durable PC
// cache writes on titleOverlapsProduct (T3) — mirrors the T6(c)/Commit-P2
// wiring-guard pattern already established in this codebase.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nStatic wiring guard\n');
{
  const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  assertTrue(enrichSource.includes('isCorroboratedIdentitySource') && enrichSource.includes('from "../src/lib/identityCore.js"'), 'WIRING: isCorroboratedIdentitySource is imported from identityCore.js');
  const t1CallIdx = enrichSource.indexOf('if (isCorroboratedIdentitySource(identitySource)) {');
  const q141aWriteIdx = enrichSource.indexOf('confirmedTitle = canonicalTitle;');
  assertTrue(t1CallIdx !== -1, 'WIRING: the real T1 call site exists');
  assertTrue(t1CallIdx < q141aWriteIdx, 'WIRING: the corroboration check precedes the confirmedTitle overwrite it guards');

  const fullWriteGuardIdx = enrichSource.indexOf('if (titleOverlapsProduct(confirmedTitle, result.productName)) {');
  const strippedWriteGuardIdx = enrichSource.indexOf('if (titleOverlapsProduct(subtitleStripped, result.productName)) {');
  assertTrue(fullWriteGuardIdx !== -1, 'WIRING: the full-title durable cache write is gated on titleOverlapsProduct');
  assertTrue(strippedWriteGuardIdx !== -1, 'WIRING: the stripped-title durable cache write is gated on titleOverlapsProduct');

  // FAMILY_OVERRIDE_DECISIONS reuse confirmation (T1's own instruction:
  // "Do not invent a source enum — use what identityCore.js already sets").
  // GrailKey Directive AF (GK-98) added a third member,
  // 'discriminative-corroboration' — updated forward, not amended, matching
  // this project's own "correcting forward" convention (see e.g. dispatch-42-
  // comicvine-kill.test.js's COMP_FILTER_VERSION assertion, Directive AE).
  // isCorroboratedIdentitySource derives from this constant directly (no
  // second, independently-maintained list), so the new source is correctly,
  // automatically treated as equally corroborated.
  assertEq(FAMILY_OVERRIDE_DECISIONS, ['top-rank-protection', 'weighted-consensus', 'discriminative-corroboration'], 'WIRING: isCorroboratedIdentitySource\'s corroborated set is derived from the real, existing FAMILY_OVERRIDE_DECISIONS, not a new list');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n\n'));
}
process.exit(failed > 0 ? 1 : 0);
