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
// Invoke: node tests/artist-registry-sync.test.js

import { ARTIST_PATTERNS, tokenizeTitle } from '../src/lib/compHygiene.js';

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

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
