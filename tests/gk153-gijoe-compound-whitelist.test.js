// tests/gk153-gijoe-compound-whitelist.test.js
//
// GK-153 (2026-08-22) — real production case: G.I. Joe #5 Tyler Kirkham
// 616 virgin. 'joe' is a bare first name in LEGACY_CREATOR_NOISE_WORDS
// (identityCore.js, added for creator credits like "Joe Jusko"/"Joe
// Casey"/"Joe Quesada"), and sanitizeSeriesTitle strips it as a
// standalone word wherever it appears — including inside "G.I. Joe"
// itself. Same bug CLASS as GK-143 ("jim" inside "Jiménez") but a plain
// bare-word match, not a Unicode-boundary edge case, and it hits a real
// franchise title, not a coincidental substring.
//
// Confirmed via direct execution BEFORE this fix:
//   sanitizeSeriesTitle("g i joe") === "g i"
//   sanitizeSeriesTitle("616 gi joe cobra commander") === "616 gi cobra commander"
//
// The corrupted family-election reconstruction
// ("g i joe 616 gi cobra commander," built by buildGatedTitleSource,
// src/lib/imageSearchIdentity.js, when applyDualAxisGate allows via a
// 'creator-lane' provenance) lost "joe" the same way — 22e then correctly
// caught the missing Vision token and forced Vision's raw title back.
// 22e is NOT the defect here; it is the safety net that worked. This
// ticket's registry entry explicitly exonerates it.
//
// FIX: 'g i joe' / 'g.i. joe' / 'gi joe' added to COMPOUND_WHITELIST
// (src/lib/compHygiene.js) so sanitizeSeriesTitle's protectedHit check
// (identityCore.js) returns before the noise-word regex ever runs — the
// same mechanism already protecting "X-Men," "Captain Marvel," etc. Does
// NOT remove 'joe' from LEGACY_CREATOR_NOISE_WORDS — the negative
// controls below prove creator-noise stripping for unrelated "Joe"
// people is untouched.
//
// KNOWN, NOT-FIXED RESIDUAL GAP (documented, out of this narrow fix's
// scope): COMPOUND_WHITELIST's protectedHit only matches when the
// compound is an EXACT match or a PREFIX of the input string
// (bareTitle === entry || bareTitle.startsWith(entry + ' ')). A string
// like "616 gi joe cobra commander" (topFamily.title itself, prefixed by
// "616") does NOT match on this prefix-only rule and would still lose
// "joe" if it ever reached sanitizeSeriesTitle directly (it does not in
// the real production path traced for this ticket — buildGatedTitleSource
// intercepts first whenever a 'creator-lane' provenance fires, and ITS
// reconstruction happens to lead with Vision's own tokens, which DOES
// prefix-match). Flagged for a future pass on protectedHit's matching
// algorithm generally, not attempted here.
//
// Invoke: node tests/gk153-gijoe-compound-whitelist.test.js

import { sanitizeSeriesTitle, LEGACY_CREATOR_NOISE_WORDS } from '../src/lib/identityCore.js';
import { COMPOUND_WHITELIST } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-153 — G.I. Joe compound-whitelist protection ===\n');

// ═══════════════════════════════════════════════════════════════════════
// PART 0 — preconditions: 'joe' really is a noise word, and the whitelist
// really does carry the new entries (fails loud if either drifts away).
// ═══════════════════════════════════════════════════════════════════════
assertTrue(LEGACY_CREATOR_NOISE_WORDS.includes('joe'), 'precondition: "joe" is still in LEGACY_CREATOR_NOISE_WORDS (this fix does not remove it)');
assertTrue(COMPOUND_WHITELIST.has('g i joe'), 'precondition: COMPOUND_WHITELIST contains "g i joe"');
assertTrue(COMPOUND_WHITELIST.has('g.i. joe'), 'precondition: COMPOUND_WHITELIST contains "g.i. joe"');
assertTrue(COMPOUND_WHITELIST.has('gi joe'), 'precondition: COMPOUND_WHITELIST contains "gi joe"');

// ═══════════════════════════════════════════════════════════════════════
// PART 1 — blocking fixtures: the exact real-production shapes.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: blocking fixtures — the real production strings\n');

assertEq(sanitizeSeriesTitle('g i joe'), 'g i joe', 'FIXED: sanitizeSeriesTitle("g i joe") === "g i joe" (was "g i" pre-fix)');
assertEq(
  sanitizeSeriesTitle('g i joe 616 gi cobra commander'),
  'g i joe',
  'FIXED: the real buildGatedTitleSource reconstruction ("g i joe 616 gi cobra commander") protects to "g i joe" — the family-election path no longer needs 22e to force-back Vision\'s title for THIS reason'
);
assertEq(
  sanitizeSeriesTitle('G.I. Joe #5 Tyler Kirkham Virgin Variant'),
  'G.I. Joe',
  'a properly-cased raw Vision title also protects correctly ("G.I. Joe", case preserved)'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 2 — negative controls: unrelated "Joe" creator credits still strip.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: negative controls — Joe Jusko creator-noise stripping is UNCHANGED\n');

assertEq(
  sanitizeSeriesTitle('House of Secrets #92 Joe Jusko cover'),
  'House of Secrets #92',
  'Joe Jusko cover credit still strips cleanly (no G.I. Joe collision, no regression)'
);
assertEq(
  sanitizeSeriesTitle('Vampirella Joe Jusko Homage Cover'),
  'Vampirella',
  'Joe Jusko credit still strips cleanly on a second, unrelated title'
);
// A book that GENUINELY has both "G.I. Joe" AND an unrelated "Joe" creator
// credit in the same string — the compound match takes priority and
// drops the trailing creator text entirely (protectedHit's own designed
// behavior: extract ONLY the protected compound, discard trailing noise)
// — arguably a BETTER outcome than before (previously both "joe"s were at
// risk of being stripped, producing worse garbage).
assertEq(
  sanitizeSeriesTitle('G.I. Joe Comic Book #5 - SIGNED BY JOE CASEY!'),
  'G.I. Joe',
  'a title naming BOTH "G.I. Joe" and creator "Joe Casey" resolves to clean "G.I. Joe" (compound match wins, trailing creator-credit noise dropped, same as any other compound-whitelist hit)'
);

// ═══════════════════════════════════════════════════════════════════════
// PART 3 — pre-existing compound entries unaffected (no regression to
// the mechanism itself from adding new entries to the same Set).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: pre-existing compound-whitelist entries unaffected\n');

assertEq(sanitizeSeriesTitle('The X-Men Angel Red Raven #44'), 'X-Men', 'X-Men compound protection still works (Q70 precedent, unaffected by new G.I. Joe entries)');
assertEq(sanitizeSeriesTitle('Captain Marvel Neal Adams Beatles Cover 1970'), 'Captain Marvel', 'Captain Marvel compound protection still works');

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
