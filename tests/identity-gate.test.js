// Unit tests for src/lib/identityGate.js — Ship #20a.6.4.
//
// Refuse-to-price gate. Sanitizer + assessor coverage.
//
// Invoke: node tests/identity-gate.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  sanitizeIdentityFields,
  assessIdentityConfidence,
} from '../src/lib/identityGate.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
const assertDeep = (actual, expected, label) =>
  assertEq(JSON.stringify(actual), JSON.stringify(expected), label);

console.log('\n=== IDENTITY GATE (Ship #20a.6.4) ===\n');

// ─── Sanitizer: title field ─────────────────────────────────────────────
console.log('— sanitizer: title');
{
  const r1 = sanitizeIdentityFields({ title: 'Amazing Spider-Man' });
  assertEq(r1.title, 'Amazing Spider-Man', 'clean title preserved');

  const r2 = sanitizeIdentityFields({ title: '  Donald Duck  ' });
  assertEq(r2.title, 'Donald Duck', 'title trimmed');

  const r3 = sanitizeIdentityFields({ title: 'Cannot determine from visible cover' });
  assertEq(r3.title, null, 'cannot-determine title nulled');

  const r4 = sanitizeIdentityFields({ title: 'unknown' });
  assertEq(r4.title, null, '"unknown" title nulled');

  const r5 = sanitizeIdentityFields({ title: '' });
  assertEq(r5.title, null, 'empty title nulled');

  const r6 = sanitizeIdentityFields({ title: '   ' });
  assertEq(r6.title, null, 'whitespace-only title nulled');

  const r7 = sanitizeIdentityFields({ title: null });
  assertEq(r7.title, null, 'null title nulled');

  const r8 = sanitizeIdentityFields({ title: 123 });
  assertEq(r8.title, null, 'non-string title (number) nulled');

  const r9 = sanitizeIdentityFields({ title: 'unclear cover image' });
  assertEq(r9.title, null, 'unclear-marker title nulled');

  const r10 = sanitizeIdentityFields({ title: 'N/A' });
  assertEq(r10.title, null, 'N/A title nulled');
}

// ─── Sanitizer: issue field ─────────────────────────────────────────────
console.log('— sanitizer: issue');
{
  assertEq(sanitizeIdentityFields({ issue: '300' }).issue, '300', 'numeric string issue preserved');
  assertEq(sanitizeIdentityFields({ issue: 300 }).issue, '300', 'numeric issue coerced to string');
  assertEq(sanitizeIdentityFields({ issue: '1.5' }).issue, '1.5', 'half-issue 1.5 preserved');
  assertEq(sanitizeIdentityFields({ issue: 'Cannot determine' }).issue, null, 'cannot-determine issue nulled');
  assertEq(sanitizeIdentityFields({ issue: 'Annual 1' }).issue, null, 'non-numeric issue prose nulled');
  assertEq(sanitizeIdentityFields({ issue: '' }).issue, null, 'empty issue nulled');
  assertEq(sanitizeIdentityFields({ issue: null }).issue, null, 'null issue nulled');
  assertEq(sanitizeIdentityFields({ issue: undefined }).issue, null, 'undefined issue nulled');
  assertEq(sanitizeIdentityFields({ issue: '  42  ' }).issue, '42', 'numeric issue trimmed');
  assertEq(sanitizeIdentityFields({ issue: '#5' }).issue, null, '#-prefixed issue nulled (caller strips #)');
  assertEq(sanitizeIdentityFields({}).issue, null, 'missing issue defaults to null');
}

// ─── Sanitizer: year field ──────────────────────────────────────────────
console.log('— sanitizer: year');
{
  assertEq(sanitizeIdentityFields({ year: '1972' }).year, '1972', 'clean 4-digit year preserved');
  assertEq(sanitizeIdentityFields({ year: 1972 }).year, '1972', 'numeric year coerced');
  assertEq(sanitizeIdentityFields({ year: '2026' }).year, '2026', 'modern year preserved');
  assertEq(sanitizeIdentityFields({ year: '1940s' }).year, null, 'decade "1940s" nulled');
  assertEq(sanitizeIdentityFields({ year: '1940s-1950s' }).year, null, 'range "1940s-1950s" nulled');
  assertEq(sanitizeIdentityFields({ year: '1972?' }).year, null, 'question-marked year nulled');
  assertEq(sanitizeIdentityFields({ year: 'c. 1955' }).year, null, 'circa year nulled');
  assertEq(sanitizeIdentityFields({ year: 'circa 1960' }).year, null, '"circa 1960" nulled');
  assertEq(sanitizeIdentityFields({ year: '1899' }).year, null, 'year < 1900 rejected');
  assertEq(sanitizeIdentityFields({ year: '2101' }).year, null, 'year > 2100 rejected');
  assertEq(sanitizeIdentityFields({ year: '1900' }).year, '1900', 'lower bound 1900 accepted');
  assertEq(sanitizeIdentityFields({ year: '2100' }).year, '2100', 'upper bound 2100 accepted');
  assertEq(sanitizeIdentityFields({ year: 'Cannot determine' }).year, null, 'uncertainty year nulled');
  assertEq(sanitizeIdentityFields({ year: '' }).year, null, 'empty year nulled');
  assertEq(sanitizeIdentityFields({ year: null }).year, null, 'null year nulled');
  assertEq(sanitizeIdentityFields({ year: '19720' }).year, null, '5-digit year rejected');
}

// ─── Sanitizer: publisher field ─────────────────────────────────────────
console.log('— sanitizer: publisher');
{
  assertEq(sanitizeIdentityFields({ publisher: 'Marvel' }).publisher, 'Marvel', 'clean publisher preserved');
  assertEq(sanitizeIdentityFields({ publisher: '  DC Comics  ' }).publisher, 'DC Comics', 'publisher trimmed');
  assertEq(sanitizeIdentityFields({ publisher: 'Cannot determine' }).publisher, null, 'uncertainty publisher nulled');
  assertEq(sanitizeIdentityFields({ publisher: 'unknown' }).publisher, null, '"unknown" publisher nulled');
  assertEq(sanitizeIdentityFields({ publisher: '' }).publisher, null, 'empty publisher nulled');
  assertEq(sanitizeIdentityFields({ publisher: null }).publisher, null, 'null publisher nulled');
  assertEq(sanitizeIdentityFields({ publisher: 'illegible' }).publisher, null, 'illegible publisher nulled');
}

// ─── Sanitizer: visionConfidence field ──────────────────────────────────
console.log('— sanitizer: visionConfidence');
{
  assertEq(sanitizeIdentityFields({ visionConfidence: 'high' }).visionConfidence, 'high', '"high" preserved');
  assertEq(sanitizeIdentityFields({ visionConfidence: 'medium' }).visionConfidence, 'medium', '"medium" preserved');
  assertEq(sanitizeIdentityFields({ visionConfidence: 'low' }).visionConfidence, 'low', '"low" preserved');
  assertEq(sanitizeIdentityFields({ visionConfidence: 'HIGH' }).visionConfidence, 'high', 'uppercase normalized');
  assertEq(sanitizeIdentityFields({ visionConfidence: '  Medium  ' }).visionConfidence, 'medium', 'whitespace + case normalized');
  assertEq(sanitizeIdentityFields({ visionConfidence: 'pretty good' }).visionConfidence, null, 'unrecognized value nulled');
  assertEq(sanitizeIdentityFields({ visionConfidence: null }).visionConfidence, null, 'null confidence nulled');
  assertEq(sanitizeIdentityFields({}).visionConfidence, null, 'missing confidence nulled');
  assertEq(sanitizeIdentityFields({ visionConfidence: 5 }).visionConfidence, null, 'non-string confidence nulled');
}

// ─── Sanitizer: edge inputs ─────────────────────────────────────────────
console.log('— sanitizer: edge inputs');
{
  const r1 = sanitizeIdentityFields(null);
  assertDeep(r1, { title: null, issue: null, year: null, publisher: null, visionConfidence: null }, 'null input → all nulls');

  const r2 = sanitizeIdentityFields(undefined);
  assertDeep(r2, { title: null, issue: null, year: null, publisher: null, visionConfidence: null }, 'undefined input → all nulls');

  const r3 = sanitizeIdentityFields({});
  assertDeep(r3, { title: null, issue: null, year: null, publisher: null, visionConfidence: null }, 'empty object → all nulls');

  const r4 = sanitizeIdentityFields('not an object');
  assertDeep(r4, { title: null, issue: null, year: null, publisher: null, visionConfidence: null }, 'string input → all nulls');
}

// ─── Sanitizer: full clean input ────────────────────────────────────────
console.log('— sanitizer: full input');
{
  const clean = sanitizeIdentityFields({
    title: 'Amazing Spider-Man',
    issue: '300',
    year: '1988',
    publisher: 'Marvel',
    visionConfidence: 'high',
  });
  assertDeep(clean, {
    title: 'Amazing Spider-Man',
    issue: '300',
    year: '1988',
    publisher: 'Marvel',
    visionConfidence: 'high',
  }, 'full clean input preserved');

  const dirty = sanitizeIdentityFields({
    title: 'Cannot determine',
    issue: 'unclear',
    year: '1940s-1950s',
    publisher: 'unknown',
    visionConfidence: 'low',
  });
  assertDeep(dirty, {
    title: null,
    issue: null,
    year: null,
    publisher: null,
    visionConfidence: 'low',
  }, 'full dirty input → identity fields nulled, low confidence preserved');
}

// ─── Assessor: clean inputs → confident ─────────────────────────────────
console.log('— assessor: clean inputs');
{
  const r1 = assessIdentityConfidence({
    title: 'Amazing Spider-Man',
    issue: '300',
    year: '1988',
    publisher: 'Marvel',
    visionConfidence: 'high',
  });
  assertTrue(r1.confident, 'all clean + high → confident');
  assertEq(r1.missingFields.length, 0, 'all clean → 0 missing');
  assertEq(r1.reasons.length, 0, 'all clean → 0 reasons');

  const r2 = assessIdentityConfidence({
    title: 'X-Men',
    issue: '1',
    year: '1991',
    publisher: 'Marvel',
    visionConfidence: 'medium',
  });
  assertTrue(r2.confident, 'all clean + medium → confident');

  const r3 = assessIdentityConfidence({
    title: 'Daredevil',
    issue: '1',
    year: '1964',
    publisher: 'Marvel',
    visionConfidence: null,
  });
  assertTrue(r3.confident, 'all clean + null confidence → confident (default OK)');
}

// ─── Assessor: missing fields → not confident ───────────────────────────
console.log('— assessor: missing fields');
{
  const r1 = assessIdentityConfidence({
    title: null, issue: '300', year: '1988', publisher: 'Marvel', visionConfidence: 'high',
  });
  assertFalse(r1.confident, 'title null → not confident');
  assertEq(r1.missingFields[0], 'title', 'title flagged');

  const r2 = assessIdentityConfidence({
    title: 'ASM', issue: null, year: '1988', publisher: 'Marvel', visionConfidence: 'high',
  });
  assertFalse(r2.confident, 'issue null → not confident');
  assertEq(r2.missingFields[0], 'issue', 'issue flagged');

  const r3 = assessIdentityConfidence({
    title: 'ASM', issue: '300', year: null, publisher: 'Marvel', visionConfidence: 'high',
  });
  assertFalse(r3.confident, 'year null → not confident');
  assertEq(r3.missingFields[0], 'year', 'year flagged');

  const r4 = assessIdentityConfidence({
    title: 'ASM', issue: '300', year: '1988', publisher: null, visionConfidence: 'high',
  });
  assertFalse(r4.confident, 'publisher null → not confident');
  assertEq(r4.missingFields[0], 'publisher', 'publisher flagged');

  const r5 = assessIdentityConfidence({
    title: null, issue: null, year: null, publisher: null, visionConfidence: null,
  });
  assertFalse(r5.confident, 'all nulls → not confident');
  assertEq(r5.missingFields.length, 4, 'all 4 fields missing');
  assertDeep(r5.missingFields, ['title', 'issue', 'year', 'publisher'], 'missing fields ordered');
}

// ─── Assessor: vision confidence low ────────────────────────────────────
console.log('— assessor: vision confidence low');
{
  const r1 = assessIdentityConfidence({
    title: 'ASM', issue: '300', year: '1988', publisher: 'Marvel', visionConfidence: 'low',
  });
  assertFalse(r1.confident, 'all clean fields + vision LOW → not confident');
  assertEq(r1.missingFields.length, 0, 'no missing fields');
  assertTrue(
    r1.reasons.some((r) => /low confidence/i.test(r)),
    'reason includes vision-low marker'
  );

  const r2 = assessIdentityConfidence({
    title: null, issue: null, year: null, publisher: null, visionConfidence: 'low',
  });
  assertFalse(r2.confident, 'all nulls + low → not confident');
  assertEq(r2.reasons.length, 5, '4 missing + 1 vision-low → 5 reasons');
}

// ─── Real production fixtures ───────────────────────────────────────────
console.log('— real production fixtures');
{
  // Donald Duck Whitman #978 — the trigger case from 2026-04-27 phone validation.
  // Vision returned: title="Donald Duck", issue="Cannot determine from visible cover",
  // year="1940s-1950s", publisher="Walt Disney" (actual was Whitman).
  const donaldDuck = sanitizeIdentityFields({
    title: 'Donald Duck',
    issue: 'Cannot determine from visible cover',
    year: '1940s-1950s',
    publisher: 'Walt Disney',
    visionConfidence: 'low',
  });
  assertEq(donaldDuck.title, 'Donald Duck', 'donald duck: title preserved (clean string)');
  assertEq(donaldDuck.issue, null, 'donald duck: issue rejected');
  assertEq(donaldDuck.year, null, 'donald duck: year range rejected');
  assertEq(donaldDuck.publisher, 'Walt Disney', 'donald duck: publisher preserved (clean string)');
  assertEq(donaldDuck.visionConfidence, 'low', 'donald duck: low confidence preserved');

  const ddCheck = assessIdentityConfidence(donaldDuck);
  assertFalse(ddCheck.confident, 'donald duck: REFUSED to price');
  assertTrue(ddCheck.missingFields.includes('issue'), 'donald duck: issue in missing');
  assertTrue(ddCheck.missingFields.includes('year'), 'donald duck: year in missing');
  assertEq(ddCheck.missingFields.length, 2, 'donald duck: exactly 2 missing fields');

  // ASM #300 — clean baseline, should never gate.
  const asm300 = sanitizeIdentityFields({
    title: 'Amazing Spider-Man',
    issue: '300',
    year: '1988',
    publisher: 'Marvel',
    visionConfidence: 'high',
  });
  const asmCheck = assessIdentityConfidence(asm300);
  assertTrue(asmCheck.confident, 'ASM #300: passes (clean baseline)');

  // Biker Mice from Mars #1 (2024) — modern indie. No PC/CV match in original
  // case but Vision identified cleanly. Per refinement A, must NOT gate.
  const bikerMice = sanitizeIdentityFields({
    title: 'Biker Mice from Mars',
    issue: '1',
    year: '2024',
    publisher: 'Mad Cave',
    visionConfidence: 'high',
  });
  const bmCheck = assessIdentityConfidence(bikerMice);
  assertTrue(bmCheck.confident, 'Biker Mice #1: passes (no external lookup required)');

  // Tip Top Comics #219 — Golden Age non-mega, niche publisher. Same shape.
  const tipTop = sanitizeIdentityFields({
    title: 'Tip Top Comics',
    issue: '219',
    year: '1959',
    publisher: 'Standard Comics',
    visionConfidence: 'high',
  });
  const tipCheck = assessIdentityConfidence(tipTop);
  assertTrue(tipCheck.confident, 'Tip Top #219: passes (niche but clean ID)');

  // Star Wars #1 (1977) — Ship #19 reprint case. Vision identified cleanly,
  // edition warning is a SEPARATE gate (Ship #19), not this gate's concern.
  const starWars = sanitizeIdentityFields({
    title: 'Star Wars',
    issue: '1',
    year: '1977',
    publisher: 'Marvel',
    visionConfidence: 'high',
  });
  const swCheck = assessIdentityConfidence(starWars);
  assertTrue(swCheck.confident, 'Star Wars #1: passes (edition warning is separate gate)');
}

// ─── Backward-compat sketch: pre-existing catalog entries ───────────────
console.log('— backward-compat sketch');
{
  // Existing catalog entries do not have identityConfident on them. The
  // client merge default ("?? cur.identityConfident ?? true") protects
  // them. This test simulates the merge default at the unit level.
  const merge = (enrichVal, curVal) =>
    enrichVal != null ? enrichVal : (curVal != null ? curVal : true);

  assertEq(merge(undefined, undefined), true, 'no enrich + no cur → default true');
  assertEq(merge(undefined, true), true, 'no enrich + cur=true → true');
  assertEq(merge(undefined, false), false, 'no enrich + cur=false → false (preserved)');
  assertEq(merge(false, undefined), false, 'enrich=false + no cur → false');
  assertEq(merge(true, false), true, 'enrich=true overrides cur=false');
  assertEq(merge(false, true), false, 'enrich=false overrides cur=true (gate fires)');
}

// ─── Final report ───────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed / ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:\n');
  failures.forEach((f) => console.log(f + '\n'));
  process.exit(1);
}
process.exit(0);
