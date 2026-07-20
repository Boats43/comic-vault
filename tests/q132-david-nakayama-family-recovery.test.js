// tests/q132-david-nakayama-family-recovery.test.js
//
// Q132 dispatch (2026-07-20, GrailKey / ASM #26 "David Nakayama" class),
// Fix 2 — bounded creator-pair recovery in the Q84 dual-axis gate.
//
// Production case: a book labeled "Amazing Spider-Man #26" (Vision/user
// identity) had an eBay reverse-image-search pool where 13/20 listings
// explicitly named a 2026 David Nakayama color variant (real prices, a
// stated 1:50 ratio, 2026 print dates) — a real, corroborated, dominant
// signal (weight 15.5) that the title-family clustering correctly found,
// but the Q84 dual-axis gate blocked:
//
//   [title-family] top family: "amazing spider man david color" (weight
//     15.5, 13/20 members) — dominant signal, discarded
//   [Q84] override-blocked reason=non-creator additions [david,color] —
//     agreed title stands
//
// Root cause: tokenizeTitleFamily strips every ARTIST_PATTERNS match out of
// the token stream BEFORE the family-consensus vote runs (the Black Cat /
// Skottie Young "variant-artist token fusion" fix) — so "nakayama" (a
// bare, surname-only ARTIST_PATTERNS entry, no paired "david nakayama"
// multi-word pattern) never survives into familyTokens at all, even though
// the adjacent first name "david" does survive as an unrecognized stray
// token. extractPoolArtistTokens (which builds the Q84 gate's
// creator-class whitelist) only ever sees the same stripped/matched text,
// so it can never learn "david" belongs with "nakayama" either — a
// structural gap in the classifier, not a missing ARTIST_PATTERNS entry
// ("nakayama" was already present, compHygiene.js line 216).
//
// Fix: applyDualAxisGate now accepts the family's representative raw
// (unstripped) listing title and recovers a non-creator token that
// immediately PRECEDES an already-recognized surname in that raw text —
// i.e. "<candidate> <surname>" word order specifically (every multi-word
// ARTIST_PATTERNS entry in this codebase is first-name-then-surname, and
// real sellers follow the same convention). Once a genuine pair is
// confirmed, the rest of the family's added tokens (here: "color") are
// treated as that same confirmed variant's own descriptors rather than
// gated token-by-token — ARC_RE has already ruled out story/arc-content
// by that point in the gate. No bare first-name pattern is added to any
// registry (Q130 policy stands): a first name with no adjacent recognized
// surname in the raw text is never recovered.
//
// Invoke: node tests/q132-david-nakayama-family-recovery.test.js

import {
  selectTitleFamilyCandidate,
  applyDualAxisGate,
  extractPoolArtistTokens,
} from '../src/lib/imageSearchIdentity.js';
import { detectFamilyOverrideConflict } from '../src/lib/variantIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

console.log('\n=== Q132 Fix 2 — David Nakayama bounded creator-pair recovery ===\n');

// ── 1. extractPoolArtistTokens — only the surname is ever extracted ────
console.log('── extractPoolArtistTokens: confirms the structural gap ──');
{
  const pool13 = Array.from({ length: 13 }, (_, i) => ({
    rawTitle: `Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026 CGC ${9 - (i % 3)}.${i % 10}`,
  }));
  const tokens = extractPoolArtistTokens(pool13);
  check(tokens.has('nakayama'), 'nakayama extracted (surname-only ARTIST_PATTERNS entry)');
  check(!tokens.has('david'), 'david is NOT extracted by extractPoolArtistTokens — confirms the structural gap this fix targets');
}

// ── 2. applyDualAxisGate — blocked pre-recovery, allowed post-recovery ──
console.log('\n── applyDualAxisGate: David Nakayama family ──');
{
  const familyTokens = ['amazing', 'spider', 'man', 'david', 'color']; // post-tokenizeTitleFamily (nakayama already stripped)
  const visionTokens = ['amazing', 'spider', 'man']; // Vision's bare base title
  const poolArtistTokens = new Set(['nakayama']);
  const familyRawText = 'Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026';

  const preFix = applyDualAxisGate(familyTokens, visionTokens, poolArtistTokens /* no familyRawText */);
  check(preFix.allowed === false && /non-creator additions \[david,color\]/.test(preFix.reason),
    `PRE-FIX (no rawText passed): reproduces the real block (${preFix.reason})`);

  const postFix = applyDualAxisGate(familyTokens, visionTokens, poolArtistTokens, familyRawText);
  check(postFix.allowed === true, `POST-FIX: family override allowed (${postFix.reason})`);
  check(/adjacent-pair recovered: \[david\]/.test(postFix.reason), `POST-FIX: reason names the recovered pair (${postFix.reason})`);
}

// ── 3. Direction-bounded: "color" alone (no adjacent surname) still blocks ──
console.log('\n── bounded: a non-creator token with no adjacent surname still blocks ──');
{
  // "color" trails "nakayama" (does not precede it) and there is no other
  // recognized surname anywhere nearby — confirms recovery isn't a blanket
  // "any word near an artist name" allowance.
  const familyTokens = ['amazing', 'spider', 'man', 'unrelated', 'saga']; // no real creator token present at all
  const visionTokens = ['amazing', 'spider', 'man'];
  const poolArtistTokens = new Set(['nakayama']);
  const familyRawText = 'Amazing Spider-Man #26 Nakayama Unrelated Saga Exclusive'; // "unrelated"/"saga" do not precede "nakayama"
  const gate = applyDualAxisGate(familyTokens, visionTokens, poolArtistTokens, familyRawText);
  check(gate.allowed === false && /non-creator additions/.test(gate.reason),
    `tokens with no PRECEDING recognized surname still blocked (${gate.reason})`);
}

// ── 4. Full production pool reconstruction — end-to-end via selectTitleFamilyCandidate ──
console.log('\n── Amazing Spider-Man #26 — real pool shape reconstruction ──');
{
  const nakayamaPool = Array.from({ length: 13 }, (_, i) => ({
    rawTitle: `Amazing Spider-Man #26 David Nakayama Color Variant 1:50 2026 ${['NM', 'VF/NM', 'NM+'][i % 3]}`,
  }));
  const plainPool = Array.from({ length: 7 }, (_, i) => ({
    rawTitle: `Amazing Spider-Man #26 ${['Ditko', 'Marvel Silver Age', '1965 Key', 'GD', 'VG', 'FN', 'raw'][i]}`,
  }));
  const pool = [...nakayamaPool, ...plainPool];

  const r = selectTitleFamilyCandidate(pool, 'Amazing Spider-Man', '26', 1965, {
    ebayConsensusTitle: 'amazing spider man',
  });

  check(r.decision === 'top-rank-protection' || r.decision === 'weighted-consensus',
    `Nakayama family override now fires (decision=${r.decision}, was fallback-vision pre-fix)`);
  check(/nakayama/i.test(r.rawTitle || ''), `rawTitle (fed to comps query) carries "nakayama" (got "${r.rawTitle}")`);
  check(!/\[Q84-dual-axis\]/.test(r.reason || ''), `not blocked by Q84 gate (reason: ${r.reason})`);

  // Fix 1's corroboration detector must NOT fire once the family override
  // succeeds — detectFamilyOverrideConflict only matches a BLOCKED
  // ('fallback-vision' + '[Q84-dual-axis]') result. A successful override
  // is a resolved identity, not a corroborated conflict to escalate.
  const corroboration = detectFamilyOverrideConflict(r);
  check(corroboration === null, 'detectFamilyOverrideConflict returns null once the family override succeeds (no longer fallback-vision)');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
