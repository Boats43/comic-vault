// Q85 — compactTitleKey equality fallback.
//
// "Funnybook" (Vision) vs "Funny Book" / "Funny-Book" (eBay listings, PC
// products) share ZERO tokens after tokenization yet name the same book.
// Compact-key equality (lowercase, strip non-alphanumerics) rescues the
// compound-spacing class in family overlap and PC matching.
//
// Invoke: node tests/q85-compact-key.test.js

import { compactTitleKey } from '../src/lib/compHygiene.js';
import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. compactTitleKey unit ─────────────────────────────────────────
check(compactTitleKey('Funny Book') === 'funnybook', 'spaces stripped');
check(compactTitleKey('Funny-Book') === 'funnybook', 'hyphens stripped');
check(compactTitleKey('FUNNYBOOK') === 'funnybook', 'case folded');
check(compactTitleKey("D'Orc!") === 'dorc', 'punctuation stripped');
check(compactTitleKey('') === '', 'empty safe');
check(compactTitleKey(null) === '', 'null safe');
check(compactTitleKey('Flash') !== compactTitleKey('Flashpoint'), 'flash ≠ flashpoint (equality never containment)');

// ── 2. FUNNYBOOK GATE — family accepted, no refused-identity-conflict ─
console.log('\n── Funnybook pool ──');
{
  const pool = [
    { rawTitle: 'Funny Book #1 Golden Age 1971' },
    { rawTitle: 'Funny-Book #1 1971 High Grade' },
    { rawTitle: 'Funny Book #1 (1971) Nice Copy' },
    { rawTitle: 'FUNNY BOOK #1 1971' },
    { rawTitle: 'Funny Book #1 1971 Reader' },
  ];
  const r = selectTitleFamilyCandidate(pool, 'Funnybook', '1', 1971, {});
  check(r.decision !== 'refused-identity-conflict',
    `pool not refused (decision=${r.decision})`);
  check(r.decision === 'weighted-consensus' || r.decision === 'top-rank-protection',
    `family accepted via override (decision=${r.decision})`);
  check(/funny/i.test(r.selectedTitle || ''),
    `selected the funny book family (got "${r.selectedTitle}")`);
}

// ── 3. Compact fallback must NOT rescue unrelated pools ─────────────
console.log('\n── unrelated pool still refused ──');
{
  const pool = [
    { rawTitle: 'Sinful Suzi Pin-Up Special #1' },
    { rawTitle: 'Sinful Suzi Pinup #1 Adult' },
    { rawTitle: 'Sinful Suzi #1 Pin Up' },
    { rawTitle: 'SINFUL SUZI #1' },
    { rawTitle: 'Sinful Suzi #1 Rare' },
  ];
  const r = selectTitleFamilyCandidate(pool, 'Funnybook', '1', 1971, {});
  check(r.decision === 'refused-identity-conflict' || r.decision === 'fallback-vision',
    `unrelated pool not adopted (decision=${r.decision})`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
