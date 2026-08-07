// GrailKey Dispatch 08 (2026-08-07) — artistWords/ARTIST_PATTERNS sync guard.
//
// Registry consolidation, commit 1 of 2 (Bone #1 / Jeff Smith class, see
// CLAUDE.md Pattern Library "Bone #1 class" entry). compHygiene.js's own
// tokenizeTitle() keeps a hand-maintained artistWords Set that is supposed
// to mirror every single-word ARTIST_PATTERNS entry (its own comment
// claims "Full sync," Q55-C) — confirmed drifted a second time: frison
// (Q84), giang (Q130), eom (Q133), lozano (Q136) were all added to
// ARTIST_PATTERNS after that sync comment was written and never synced
// here. A full mechanical derivation from ARTIST_PATTERNS' regex sources
// was investigated and deliberately rejected (several entries like
// /dell'?otto/i and /windsor.?smith/i don't reduce to clean words, and
// this exact Set already carries a stray, unexplained 'dekal' entry that
// isn't a substring of any pattern — live evidence hand-parsing these
// sources is error-prone). This test is the safer alternative: assert
// every single-word ARTIST_PATTERNS entry is actually stripped by
// tokenizeTitle, so a future addition to ARTIST_PATTERNS that isn't
// mirrored here fails loudly instead of drifting silently a third time.
//
// Commit 2 of 2 (below) — the actual name additions this whole
// consolidation was triggered by: Jeff Smith and Cory Walker (the real
// Bone #1 / Invincible #1 gaps), plus Raymond Gay and Stanley Lau (a
// reverse gap found while investigating imageSearchIdentity.js's
// stripVariantNoise — present there but nowhere in the canonical list it
// was assumed to mirror). All four added as multi-word-only entries
// (collision-swept individually, see compHygiene.js) plus their last
// names in artistWords, so this consolidation's own guard covers them
// from day one instead of needing a second pass.
//
// Invoke: node tests/artist-registry-sync.test.js

import { ARTIST_PATTERNS, ARTIST_SURNAME_WORDS, tokenizeTitle } from '../src/lib/compHygiene.js';
import { LEGACY_CREATOR_NOISE_WORDS } from '../src/lib/identityCore.js';
import { STRIP_VARIANT_NOISE_CREATOR_NAMES_1, STRIP_VARIANT_NOISE_CREATOR_NAMES_2 } from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// Single-word ARTIST_PATTERNS entries have no whitespace in their regex
// source (multi-word entries, e.g. "tyler kirkham", always do) — the same
// distinction the file's own header comment relies on ("multi-word
// entries MUST come before single-word fallbacks"). All single-word
// entries are \b-anchored (Q131) — strip the anchors to recover the bare
// word. Excludes the two compound-but-space-free patterns
// (windsor.?smith, dell'?otto) via the pure-alphabetic check — their
// regex source contains "." / "'" / "?" so they'd never match a real
// tokenizeTitle output token either way; testing them here would be a
// vacuous always-pass, not a real check.
const singleWordEntries = ARTIST_PATTERNS
  .filter((re) => !/\s/.test(re.source))
  .map((re) => re.source.replace(/\\b/g, '').toLowerCase())
  .filter((word) => /^[a-z]+$/.test(word));

check(singleWordEntries.length >= 38, `sanity: found ${singleWordEntries.length} single-word ARTIST_PATTERNS entries (expected 38+)`);

for (const word of singleWordEntries) {
  const tokens = tokenizeTitle(`Some Comic Title Signed ${word} Variant`);
  check(!tokens.includes(word), `artistWords strips ARTIST_PATTERNS single-word entry "${word}"`);
}

// The specific real gap this commit closes — asserted individually so a
// future revert of just these four is caught even if the loop above were
// ever removed or restructured.
for (const word of ['frison', 'giang', 'eom', 'lozano']) {
  const tokens = tokenizeTitle(`Wonder Woman #75 ${word} Virgin Variant`);
  check(!tokens.includes(word), `GrailKey Dispatch 08 gap closed: "${word}" is stripped by tokenizeTitle`);
}

// Commit 2 — the four names this dispatch actually adds. Each checked
// two ways: (a) ARTIST_PATTERNS itself recognizes the full name (the
// mechanism applyDualAxisGate/extractPoolArtistTokens/api/comps.js's
// query builder/variantIdentity.js's extractArtist all consume), and
// (b) tokenizeTitle strips the last name (the artistWords consumer,
// title-family clustering's own tokenizer).
const newCreators = [
  { full: 'Jeff Smith', lastName: 'smith', sample: 'Bone #1 Signed Jeff Smith Nth Print' },
  { full: 'Cory Walker', lastName: 'walker', sample: 'Invincible #1 Cory Walker Cover Art CGC 9.0' },
  { full: 'Raymond Gay', lastName: 'gay', sample: 'Some Comic #1 Raymond Gay Variant' },
  { full: 'Stanley Lau', lastName: 'lau', sample: 'Some Comic #1 Stanley Lau Exclusive' },
  // GrailKey Dispatch 10 (2026-08-07) — real production gaps: Wolverine
  // #37 (confirmedTitle corrupted to "wolverine greg capullo," 25/30
  // sold comps rejected on titleMismatch) and Spider-Gwen ("spider gwen
  // latour rodriguez," both co-creators missing at once).
  { full: 'Greg Capullo', lastName: 'capullo', sample: 'Wolverine #37 Greg Capullo Variant' },
  { full: 'Jason Latour', lastName: 'latour', sample: 'Spider-Gwen #1 Jason Latour Signed' },
  { full: 'Robbi Rodriguez', lastName: 'rodriguez', sample: 'Spider-Gwen #1 Robbi Rodriguez Cover' },
];

for (const { full, lastName, sample } of newCreators) {
  const matched = ARTIST_PATTERNS.some((re) => re.test(full));
  check(matched, `ARTIST_PATTERNS recognizes "${full}"`);

  const tokens = tokenizeTitle(sample);
  check(!tokens.includes(lastName), `tokenizeTitle strips "${lastName}" (from "${full}") via artistWords`);
}

// "Smith" specifically must stay multi-word-only — no bare fallback was
// added (too common a surname), so a title with an UNRELATED "Smith"
// and no "Jeff" nearby must not falsely match ARTIST_PATTERNS' new entry.
check(
  !ARTIST_PATTERNS.some((re) => re.test('Amazing Spider-Man #50 signed by John Smith the seller')),
  'Jeff Smith addition is multi-word-only — an unrelated "Smith" does not false-match'
);

// Same check for Robbi Rodriguez — "Rodriguez" is one of the most common
// surnames in the US; an unrelated seller/reviewer named Rodriguez must
// not false-match the new entry.
check(
  !ARTIST_PATTERNS.some((re) => re.test('Ultimate Spider-Man #1 CGC 9.8 seller: M. Rodriguez')),
  'Robbi Rodriguez addition is multi-word-only — an unrelated "Rodriguez" does not false-match'
);

// ═══════════════════════════════════════════════════════════════════════
// GrailKey Dispatch 09 (2026-08-07) — reverse-direction assertions.
// Everything above checks ARTIST_PATTERNS → artistWords (forward). This
// is the other direction: does every name-shaped entry in the two other
// hand-maintained lists (stripVariantNoise, NOISE_PATTERNS[0]) — plus
// artistWords itself — actually trace back to the canonical
// ARTIST_PATTERNS registry? Raymond Gay and Stanley Lau sat undetected
// in stripVariantNoise until someone went looking by hand; this section
// is what makes the next one automatic instead of accidental.
// ═══════════════════════════════════════════════════════════════════════

// Check 1 — stripVariantNoise's creator names against ARTIST_PATTERNS.
// Direct substring test is valid here (unlike NOISE_PATTERNS below):
// every entry is either a full multi-word name or a name distinctive
// enough to already have a bare ARTIST_PATTERNS fallback, so testing the
// full phrase against each pattern correctly catches both shapes.
for (const name of [...STRIP_VARIANT_NOISE_CREATOR_NAMES_1, ...STRIP_VARIANT_NOISE_CREATOR_NAMES_2]) {
  const recognized = ARTIST_PATTERNS.some((re) => re.test(name));
  check(recognized, `stripVariantNoise's "${name}" is recognized by ARTIST_PATTERNS`);
}

// Check 2 — NOISE_PATTERNS[0] (LEGACY_CREATOR_NOISE_WORDS) against
// ARTIST_SURNAME_WORDS. These are BARE single words, not full phrases —
// testing e.g. "andrews" against /kaare andrews/i directly would
// (correctly) fail since "andrews" doesn't contain the longer compound
// pattern, so the comparison surface here is ARTIST_SURNAME_WORDS (the
// already-flattened, already-guarded-by-Check-0-above surname set), not
// ARTIST_PATTERNS' raw regexes.
//
// Two documented exception classes, encoded explicitly rather than
// silently — anything NOT in one of these two lists and NOT in
// ARTIST_SURNAME_WORDS is a real, unexplained gap and must fail loudly:
//   - FIRST_NAME_EXCEPTIONS: bare individual first names.
//     ARTIST_PATTERNS deliberately never carries these (collision risk —
//     see the Q131 comment in compHygiene.js); NOISE_PATTERNS' job is
//     "strip name-shaped title noise," a broader scope than "recognize a
//     specific creator." Legitimate, permanent exception.
//   - AMBIGUOUS_EXCEPTIONS: 'windsor' — not a first name and not
//     independently a surname; it's one half of the hyphenated
//     "Windsor-Smith," represented in ARTIST_PATTERNS only as the
//     compound /windsor.?smith/i. Documented here rather than silently
//     passed or silently failed.
const FIRST_NAME_EXCEPTIONS = new Set([
  'neal', 'john', 'jack', 'steve', 'barry', 'jim', 'todd', 'frank',
  'alan', 'chris', 'joe', 'kaare', 'alex',
]);
const AMBIGUOUS_EXCEPTIONS = new Set(['windsor']);

for (const word of LEGACY_CREATOR_NOISE_WORDS) {
  if (FIRST_NAME_EXCEPTIONS.has(word) || AMBIGUOUS_EXCEPTIONS.has(word)) {
    check(true, `NOISE_PATTERNS' "${word}" is a documented exception, not a creator-registry entry`);
    continue;
  }
  check(ARTIST_SURNAME_WORDS.has(word), `NOISE_PATTERNS' "${word}" traces back to ARTIST_SURNAME_WORDS/ARTIST_PATTERNS`);
}

// Check 3 — ARTIST_SURNAME_WORDS itself against ARTIST_PATTERNS' raw
// regex sources: does every hand-added surname actually come FROM some
// pattern in the canonical list? A literal \bword\b substring test
// against each pattern's .source correctly handles compound-derived
// entries (e.g. "smith" is a real \b-bounded substring of the
// /windsor.?smith/i source even though "smith" alone never matches that
// compiled pattern against a bare string).
//
// 'dekal' is deliberately NOT exempted — per the dispatch instruction,
// an unexplained entry that no test can justify should fail loudly
// rather than being silently patched away or silently allowed. If a
// future investigation explains what it's for, add it here with a
// reason; until then, this failure is the point.
// Regex .source strings contain literal "\b" anchor tokens (backslash +
// the letter b) — since 'b' is itself a word character, testing a fresh
// \bword\b pattern directly against the raw source string produces false
// negatives right at the anchor (e.g. source "\bskan\b" has a WORD
// character 'b' immediately before "skan," not a boundary). Clean the
// source first: anchor tokens and regex-only punctuation become spaces
// (not deleted — deleting would merge adjacent words, e.g.
// "windsor.?smith" → "windsorsmith", losing the real word boundary
// between them), leaving plain space-separated text to test against.
const cleanPatternSource = (source) => source
  .replace(/\\b/g, ' ')
  .replace(/[.?'\\]/g, ' ')
  .toLowerCase();

for (const word of ARTIST_SURNAME_WORDS) {
  const tracesToCanonical = ARTIST_PATTERNS.some((re) => new RegExp(`\\b${word}\\b`, 'i').test(cleanPatternSource(re.source)));
  check(tracesToCanonical, `ARTIST_SURNAME_WORDS' "${word}" traces back to some ARTIST_PATTERNS entry`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
