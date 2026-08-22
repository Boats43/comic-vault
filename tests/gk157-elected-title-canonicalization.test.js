// tests/gk157-elected-title-canonicalization.test.js
//
// GK-157 (2026-08-22) — closes GK-153's own "KNOWN, NOT-FIXED RESIDUAL
// GAP" (tests/gk153-gijoe-compound-whitelist.test.js's own header):
// COMPOUND_WHITELIST's protectedHit (src/lib/identityCore.js,
// sanitizeSeriesTitle) was a PREFIX-ONLY match — a compound sitting
// mid-string (e.g. `family.topFamily.title` itself, "616 gi joe cobra
// commander" — as opposed to the buildGatedTitleSource RECONSTRUCTION,
// which happened to lead with Vision's own tokens and therefore prefix-
// matched by coincidence) would still lose "joe" to the bare-word noise
// strip whenever that raw shape reached sanitizeSeriesTitle directly.
//
// TWO fixes, both in src/lib/identityCore.js:
//
// FIX 1 — protectedHit is now a word-boundary match ANYWHERE in the
// string, not just a prefix. Prefix is checked FIRST and always wins
// (byte-identical for every existing fixture); only when no prefix hit
// exists does a leftmost-anywhere word-boundary search run. Extraction
// now drops noise on BOTH sides of the compound (previously only
// trailing noise was dropped, since a prefix match starts at index 0 by
// construction).
//
// FIX 2 — resolveIdentity's FAMILY_OVERRIDE_DECISIONS branch (the
// "elected family key" path — weighted-consensus/top-rank-protection,
// i.e. when title-family election actually WINS) previously wrote
// sanitizeSeriesTitle(family.selectedTitle) directly as confirmedTitle —
// never touching canonicalizeTitleCandidate's richer pipeline
// (attribution clause, merch/W-clause, parenthetical, grade/condition,
// generic finish-descriptor, standalone issue, publisher+year suffix —
// AV/AW, GK-133/GK-140), which was reachable ONLY via reconcileTitleFacet
// on the OPPOSITE branch (family.decision==='fallback-vision', i.e. when
// election REFUSES). An elected family key is now additionally passed
// through canonicalizeTitleCandidate before becoming confirmedTitle — an
// idempotent, over-strip-guarded pass over the ALREADY-GATED
// sanitizedFamilyTitle (never over raw pool/topFamily text, which would
// bypass Q84/Q119/Q142's own non-consensus-token exclusion).
//
// Invoke: node tests/gk157-elected-title-canonicalization.test.js

import { resolveIdentity, sanitizeSeriesTitle, canonicalizeTitleCandidate } from '../src/lib/identityCore.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-157 — elected family title: word-boundary compound + canonicalizer projection ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — the blocking fixture: sanitizeSeriesTitle mid-string.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: blocking fixture — sanitizeSeriesTitle("616 gi joe cobra commander")\n');

assertEq(
  sanitizeSeriesTitle('616 gi joe cobra commander'),
  'gi joe',
  'FIXED (word-boundary, not prefix-only): mid-string compound now protects, extracting ONLY "gi joe" — drops the leading "616" AND the trailing "cobra commander"'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — the GI Joe shape, end to end through resolveIdentity itself
// (the real production call site — api/enrich.js — not a hand-rolled
// re-derivation): a family that WON with the exact corrupted raw key
// the real 2026-08-22 scan produced.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: GI Joe shape — resolveIdentity end to end\n');

const gijoeCapturedLogs = [];
const originalLog = console.log;
console.log = (...args) => { gijoeCapturedLogs.push(args.join(' ')); };
let gijoeResult;
try {
  gijoeResult = resolveIdentity(
    { title: 'g i joe', issue: '5', year: null, publisher: null },
    null,
    {
      decision: 'weighted-consensus',
      selectedTitle: '616 gi joe cobra commander',
      topFamily: { title: '616 gi joe cobra commander', rawTitle: 'GI JOE #5 TYLER KIRKHAM 616 Cobra Commander Virgin FOIL Variant B LTD to 750', count: 12, indices: [] },
      runnerUp: null,
    },
    { visualItems: [] }
  );
} finally {
  console.log = originalLog;
}
console.log(`  (confirmedTitle: ${JSON.stringify(gijoeResult.confirmedTitle)})`);
assertEq(gijoeResult.confirmedTitle, 'gi joe', 'card/query title carries "gi joe" — "joe" survives, "cobra commander" is gone (excluded from any downstream comps query built from this title)');
assertTrue(!/cobra|commander|616/i.test(gijoeResult.confirmedTitle), 'no Cobra Commander / "616" pollution anywhere in the elected title');
assertTrue(!gijoeCapturedLogs.some((l) => l.includes('22e-LOSS')), 'no 22e-LOSS force-back needed — the election itself is now correct at the source, not merely rescued downstream');

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — canonicalizer contributes independently: an elected title
// carrying a real attribution clause (a shape sanitizeSeriesTitle's own
// noise-word list has no way to catch — "mike"/"mayhew" are not in
// LEGACY_CREATOR_NOISE_WORDS) is now cleaned too.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: canonicalizer contributes independently (attribution-clause shape)\n');

const venomLogs = [];
console.log = (...args) => { venomLogs.push(args.join(' ')); };
let venomResult;
try {
  venomResult = resolveIdentity(
    { title: 'venom separation anxiety', issue: '1', year: null, publisher: null },
    null,
    {
      decision: 'weighted-consensus',
      selectedTitle: 'venom separation anxiety by mike mayhew',
      topFamily: { title: 'venom separation anxiety by mike mayhew', rawTitle: 'Venom Separation Anxiety by Mike Mayhew Virgin', count: 5, indices: [] },
      runnerUp: null,
    },
    { visualItems: [] }
  );
} finally {
  console.log = originalLog;
}
assertEq(venomResult.confirmedTitle, 'venom separation anxiety', 'the attribution clause ("by mike mayhew") is stripped from the elected title');
assertTrue(venomLogs.some((l) => l.includes('[title-canon] elected family title canonicalized')), '[title-canon] log fires for the elected-title canonicalization pass, proving it actually ran (not vacuously identical input/output)');

// ═══════════════════════════════════════════════════════════════════════
// PART 4 — negative controls: pre-existing compound-whitelist fixtures
// stay byte-identical; Joe Jusko/Casey creator-noise stripping intact.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: negative controls — existing fixtures byte-identical\n');

assertEq(sanitizeSeriesTitle('The X-Men Angel Red Raven #44'), 'X-Men', 'X-Men prefix-match fixture unchanged');
assertEq(sanitizeSeriesTitle('Captain Marvel Neal Adams Beatles Cover 1970'), 'Captain Marvel', 'Captain Marvel prefix-match fixture unchanged');
assertEq(sanitizeSeriesTitle('Ms Marvel Team-Up Captain Marvel Special'), 'Ms Marvel', 'a title containing TWO different whitelisted compounds still resolves to the PREFIX match ("Ms Marvel"), not whichever compound happens to appear first in Set-iteration order ("Marvel Team-Up") — prefix always wins over anywhere-match');
assertEq(sanitizeSeriesTitle('House of Secrets #92 Joe Jusko cover'), 'House of Secrets #92', 'Joe Jusko creator-noise stripping still works (no G.I. Joe collision)');
assertEq(sanitizeSeriesTitle('G.I. Joe Comic Book #5 - SIGNED BY JOE CASEY!'), 'G.I. Joe', 'a title naming both "G.I. Joe" and creator "Joe Casey" still resolves to clean "G.I. Joe"');

// Canonicalizer itself: confirm it's a genuine no-op on already-clean
// elected titles (doesn't fire, doesn't log, doesn't change the value) —
// guards against this fix silently over-stripping something real.
const noopCheck = canonicalizeTitleCandidate('gi joe', { issueValue: '5' });
assertEq(noopCheck.value, 'gi joe', 'canonicalizeTitleCandidate is a true no-op on an already-clean elected title');
assertEq(noopCheck.strippedLog, [], 'no strip categories fire on already-clean input');

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
