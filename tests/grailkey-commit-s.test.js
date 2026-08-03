// tests/grailkey-commit-s.test.js
//
// GrailKey Commit S — Marvel Tales #14 class.
//
//   S1 — applyDualAxisGate (imageSearchIdentity.js) blocked a family
//        override whenever ANY Vision-agreed token was absent from the
//        candidate family's own tokens — requiring the family to cover
//        100% of Vision's content. Backwards when Vision's own title is
//        wrong: Vision misread "Marvel Tales #14" as "Tales of Asgard,"
//        and the real, 4-row, 100%-internally-overlapping "Marvel Tales"
//        eBay family was blocked from correcting it because "asgard" (a
//        genuine word, on no stopword list, simply wrong) was absent from
//        the family's own tokens — even though "tales," the one word that
//        genuinely IS shared, never entered the computation. Fixed: block
//        only when the family shares ZERO tokens with Vision's agreed
//        title (complete disagreement), not merely a partial one. Verified
//        via direct execution (not assumed) that this does not admit the
//        one real failure case this branch exists to catch (Flash #75 /
//        "flash year one" story-arc cluster, tests/q84-dual-axis.test.js) —
//        that fixture has ZERO token overlap in either direction and is
//        separately, redundantly caught by the arc-token check a few lines
//        below regardless of this branch.
//
//        Correcting a misattribution in the original dispatch: the console
//        tag surfaced for this exact block is [Q84-dual-axis], not
//        [Q85-B] — verified via direct execution of the real function
//        against the real fixture. The [Q85-B] compact-key/bigram-join
//        check (same file, earlier in selectTitleFamilyCandidate) never
//        fires for this fixture either (no whole-key or bigram match
//        between "marveltales" and "talesofasgard") — control falls
//        through it into the FIX-A2 raw-overlap-ratio check (0.5 >= 0.4,
//        passes) and only then into applyDualAxisGate, which is the
//        actual site fixed here.
//
//   S3 — TRADING_CARD_RE (compHygiene.js) and CARD_PATTERN
//        (categoryClassifier.js) had no non-sport trading-card vocabulary
//        — real 1984 FTCC "Marvel Superheroes First Issue Covers" card
//        listings ("...Thor Tales of Asgard #14 07hl #14") carry a genuine
//        "#14" and none of the pre-existing sports-card terms, so they
//        classified COMIC and entered both the identity pool and the comps
//        chain, pricing a real Marvel Tales #14 comic off two ~$2 card
//        sales. Same new alternation text (ftcc/impel/skybox/"trading
//        card"/non-sport/"first issue covers"/"card set") added to both
//        patterns — same structure as the P3 bullion-pattern precedent
//        (MERCHANDISE_PATTERN/MERCH_RE).
//
// Every function under test is the REAL exported production function at
// its real call site (invariant 10). MUTATION blocks reconstruct the
// PRE-fix behavior verbatim to prove each fix is load-bearing.
//
// Invoke: node tests/grailkey-commit-s.test.js

import { applyDualAxisGate, ARC_RE } from '../src/lib/imageSearchIdentity.js';
import { TRADING_CARD_RE } from '../src/lib/compHygiene.js';
import { classifyTitle } from '../src/lib/categoryClassifier.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Commit S — Q84-dual-axis coverage direction + trading-card filter ===\n');

// Verbatim pre-Commit-S body — used only in MUTATION blocks below. Full
// reimplementation through the branches these fixtures actually exercise
// (added/ARC_RE/plain creator-tokens) — none of S-4/S-5's fixtures reach
// the adjacent-pair-recovery or coherent-content-token lanes, so those
// unexported helpers are not needed for a faithful old-vs-new comparison
// here; S-1/S-3/S-6 only need the "missing" branch this commit changed.
const naiveDualAxisGate = (familyTokens, agreedTokens, poolArtistTokens) => {
  const ARTICLE = new Set(['the', 'a', 'an']);
  const NEUTRAL = new Set(['dc', 'marvel', 'comics', 'comic', 'image', 'idw', 'boom', 'dynamite', 'valiant', 'archie', 'dark', 'horse', 'variant', 'cover', 'edition', 'print', 'first', '1st']);
  const drop = (t) => ARTICLE.has(t) || NEUTRAL.has(t);
  const fam = (familyTokens || []).filter((t) => !drop(t));
  const agreed = (agreedTokens || []).filter((t) => !drop(t));
  if (agreed.length === 0) return { allowed: true, reason: 'no agreed tokens to protect' };
  const missing = agreed.filter((t) => !fam.includes(t));
  if (missing.length > 0) {
    return { allowed: false, reason: `family drops agreed tokens [${missing.join(',')}]` };
  }
  const added = fam.filter((t) => !agreed.includes(t));
  if (added.length === 0) return { allowed: true, reason: 'same title, nothing added' };
  const addedStr = added.join(' ');
  if (ARC_RE.test(addedStr)) {
    return { allowed: false, reason: `arc-token "${addedStr}"` };
  }
  const nonCreator = added.filter((t) => !(poolArtistTokens && poolArtistTokens.has(t)));
  if (nonCreator.length > 0) {
    return { allowed: false, reason: `non-creator additions [${nonCreator.join(',')}]` };
  }
  return { allowed: true, reason: `creator-tokens [${addedStr}]` };
};

// ══════════════════════════════════════════════════════════════════════════════
// S-1 — Marvel Tales fixture, verbatim: Vision "Tales of Asgard", eBay
// family "marvel tales" -> override allowed (title corrects to Marvel Tales).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nS-1 — Marvel Tales #14 override allowed\n');
{
  const result = applyDualAxisGate(['marvel', 'tales'], ['tales', 'of', 'asgard'], new Set());
  assertTrue(result.allowed, `S-1: override allowed (${result.reason})`);
  assertEq(result.reason, 'same title, nothing added', 'S-1: family is a clean subset once neutral tokens drop — nothing left to gate');
}

// ══════════════════════════════════════════════════════════════════════════════
// S-2 — end-to-end: FTCC card rows never enter the comp pool a Marvel
// Tales #14 price could derive from. Not asserting a specific number —
// asserting the rows that produced $2.47 are structurally excluded.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nS-2 — FTCC rows excluded from the pricing-eligible pool\n');
{
  const ftccRows = [
    { title: '1984 Marvel Superheroes First Issue Covers TALES OF ASGARD #14', price: 2.67 },
    { title: '1984 FTCC Marvel Superheroes First Issue Covers Thor Tales of Asgard #14 07hl #14', price: 2.27 },
  ];
  const genuineComicRow = { title: 'Marvel Tales #14 Marvel 1968 Reprints of early Marvel issues', price: 25 };
  const pool = [...ftccRows, genuineComicRow];
  const priceable = pool.filter((r) => !TRADING_CARD_RE.test(r.title));
  assertEq(priceable.length, 1, 'S-2: both FTCC card rows excluded, only the genuine comic row remains priceable');
  assertTrue(priceable[0].price > 2.47, 'S-2: the surviving price is not the $2.47 FTCC-derived figure');
  assertFalse(priceable.some((r) => /ftcc|first issue covers/i.test(r.title)), 'S-2: no surviving row is FTCC-derived');
}

// ══════════════════════════════════════════════════════════════════════════════
// S-3 (CRITICAL) — the S1-Q3 failure case must still be blocked: Flash #75,
// Vision+eBay agreed "the flash," a story-arc "flash year one" cluster
// tried to override with zero real relation to "flash."
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nS-3 (CRITICAL) — Flash Year One still blocked\n');
{
  const result = applyDualAxisGate(['year', 'one'], ['the', 'flash'], new Set());
  assertFalse(result.allowed, `S-3: Flash Year One override still blocked (${result.reason})`);
  assertTrue(/drops agreed/.test(result.reason), 'S-3: reason string unchanged — "family drops agreed tokens [flash]"');
  assertEq(result.reason, 'family drops agreed tokens [flash]', 'S-3: exact reason string byte-identical to pre-fix (tests/q84-dual-axis.test.js\'s own assertion still holds)');

  // Independent, redundant protection: even with this branch bypassed
  // entirely, the arc-token check on the very next lines of the same
  // function also catches this exact fixture.
  assertTrue(ARC_RE.test('year one'), 'S-3: ARC_RE independently flags "year one" — a second, unaffected layer of protection for this same case');
}

// ══════════════════════════════════════════════════════════════════════════════
// S-4 — Spawn: "spawn brett booth" vs family "spawn" -> unchanged.
// Family already CONTAINS the sole agreed token ("spawn"), so missing=[]
// in both the old and new code — this case never touches the changed
// condition at all.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nS-4 — Spawn Q84/Q85-B interaction unaffected\n');
{
  const poolArtists = new Set(['brett', 'booth']);
  const real = applyDualAxisGate(['spawn', 'brett', 'booth'], ['spawn'], poolArtists);
  const naive = naiveDualAxisGate(['spawn', 'brett', 'booth'], ['spawn'], poolArtists);
  assertEq(real, naive, 'S-4: real (post-fix) and naive (pre-fix) results are identical for the Spawn shape');
  assertTrue(real.allowed && /creator-tokens/.test(real.reason), `S-4: creator-token override still allowed (${real.reason})`);
}

// ══════════════════════════════════════════════════════════════════════════════
// S-5 — Iron Man #126, ASM #300, ASM #147 -> byte-identical. General
// invariant: this fix changes behavior in EXACTLY one case (partial but
// nonzero overlap where the old code found "missing" tokens) — any case
// where missing.length === 0 (family already contains every agreed token,
// the normal shape for a working, non-edge-case book) is completely
// untouched by construction, since the added `overlapping.length === 0`
// clause is irrelevant when the first clause (`missing.length > 0`) is
// already false.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nS-5 — unaffected books byte-identical\n');
{
  const fixtures = [
    { label: 'Iron Man #126', family: ['iron', 'man'], agreed: ['iron', 'man'], artists: new Set() },
    { label: 'ASM #300', family: ['amazing', 'spider', 'man'], agreed: ['amazing', 'spider', 'man'], artists: new Set() },
    { label: 'ASM #147', family: ['amazing', 'spider', 'man'], agreed: ['amazing', 'spider', 'man'], artists: new Set() },
  ];
  for (const { label, family, agreed, artists } of fixtures) {
    const real = applyDualAxisGate(family, agreed, artists);
    const naive = naiveDualAxisGate(family, agreed, artists);
    assertEq(real.allowed, naive.allowed, `S-5: ${label} — allowed flag byte-identical (real=${real.allowed}, naive=${naive.allowed})`);
    // Both are the same clean-match shape (nothing added, nothing missing)
    // for these three real books' own identity — confirms neither hits
    // the changed branch at all.
    assertTrue(real.allowed, `S-5: ${label} — clean match, override allowed`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// S-6 — MUTATION: restore the wrong-direction coverage -> S-1 FAILS.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nS-6 — mutation: pre-Commit-S coverage direction\n');
{
  const naiveResult = naiveDualAxisGate(['marvel', 'tales'], ['tales', 'of', 'asgard'], new Set());
  assertFalse(naiveResult.allowed, `MUTATION: the naive pre-fix predicate blocks the Marvel Tales override (${naiveResult.reason}) — reproduces the live "Tales of Asgard" bug`);
  const realResult = applyDualAxisGate(['marvel', 'tales'], ['tales', 'of', 'asgard'], new Set());
  assertTrue(realResult.allowed, 'MUTATION CONTRAST: the REAL post-fix function allows the identical fixture — S-1 genuinely depends on this commit\'s code, not the fixture alone');
}

// ══════════════════════════════════════════════════════════════════════════════
// S-7 — FTCC rows excluded from both pools (identity pool via
// categoryClassifier.js, comps chain via compHygiene.js).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nS-7 — FTCC excluded from both pools\n');
{
  const ftccTitles = [
    '1984 Marvel Superheroes First Issue Covers TALES OF ASGARD #14',
    '1984 FTCC Marvel Superheroes First Issue Covers Thor Tales of Asgard #14 07hl #14',
  ];
  const genuine = 'Marvel Tales #14 Marvel 1968 Reprints of early Marvel issues';

  for (const t of ftccTitles) {
    assertEq(classifyTitle(t), 'CARD', `S-7: identity-pool side — "${t.slice(0, 40)}..." classifies CARD, not COMIC`);
    assertTrue(TRADING_CARD_RE.test(t), `S-7: comps-chain side — "${t.slice(0, 40)}..." matches TRADING_CARD_RE`);
  }
  assertEq(classifyTitle(genuine), 'COMIC', 'S-7: genuine Marvel Tales #14 comic listing still classifies COMIC');
  assertFalse(TRADING_CARD_RE.test(genuine), 'S-7: genuine Marvel Tales #14 comic listing does NOT match TRADING_CARD_RE');

  // MUTATION — verbatim pre-Commit-S patterns.
  const naiveTradingCardRe = /\b(?:fleer|upper\s*deck|topps|panini|skybox|impel|score|leaf|pro\s*set|press\s*pass|stadium\s*club|finest|chrome|marvel\s*universe|base\s*card|trading\s*card|insert\s*card|parallel|chase\s*card|series\s*[ivx]+|card\s*#\d+)\b/i;
  assertFalse(naiveTradingCardRe.test(ftccTitles[0]), 'MUTATION: pre-fix TRADING_CARD_RE does NOT catch the first FTCC title — reproduces the live comp-pool contamination');
  assertFalse(naiveTradingCardRe.test(ftccTitles[1]), 'MUTATION: pre-fix TRADING_CARD_RE does NOT catch the second FTCC title either');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n\n'));
}
process.exit(failed > 0 ? 1 : 0);
