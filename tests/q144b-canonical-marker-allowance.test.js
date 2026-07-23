// tests/q144b-canonical-marker-allowance.test.js
//
// Q144B dispatch (2026-07-22, Adventure Time Summer Special #1 SDCC class)
// — confirmed exact kill via Jimmy's browse trace: raw=17 -> the sequel/
// marker-asymmetry filter (Ship #13 Bug 2, api/comps.js ~1174-1210) removes
// 9 CORRECT "Adventure Time Summer Special #1 SDCC..." listings under
// marker `special-1` -> 2 wrong-sibling "2012 Ward SDCC variant of
// Adventure Time #1" listings survive (they carry no series marker at all,
// so the filter never touched them either way) -> Q75 correctly zeroes the
// Ward siblings from pricing anyway, leaving nothing.
//
// Root cause: `ourMarkers = detectSeriesMarkers(title)` is computed from
// the bare confirmed-title string ("Adventure Time Summer Special", no
// issue number embedded) -> resolves to `special-?`, never `special-1`.
// The real comps' own titles embed "Special #1" -> `theirMarkers =
// ['special-1']`. `special-1` is not `special-?` as a string, so every
// real comp was rejected as "series asymmetry" against a book that
// genuinely IS a Special -- an artifact of how ourMarkers was computed,
// not a real mismatch.
//
// Fix: `canonicalMarkers = detectSeriesMarkers(`${title} #${iss}`)` when an
// issue is available (falls back to ourMarkers itself otherwise, so a book
// with no resolved issue is byte-identical to pre-fix behavior). A
// listing's marker that agrees with the CANONICAL target (title + issue
// together, the confirmed identity's own full designation) is the match,
// not an asymmetric sequel/spinoff. Deliberately marker-TYPE-scoped, not a
// blanket "any special matches any special" -- a book whose own canonical
// target does NOT carry a given marker still rejects candidates carrying
// it, byte-identical to pre-fix.
//
// Invoke: node tests/q144b-canonical-marker-allowance.test.js

import { detectSeriesMarkers, hasSufficientTitleOverlap } from '../src/lib/compHygiene.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Q144B — canonical-target-aware marker allowance ===\n');

// Mirrors api/comps.js's sequel-filter block exactly (lines ~1182-1211
// post-fix) — inline, non-exported logic, same "Filter 1g mirror" pattern
// tests/q135-p1-p2-p3-fixes.test.js already established for this file.
function applySequelFilter(pool, title, iss) {
  const ourMarkers = detectSeriesMarkers(title);
  const canonicalMarkers = iss ? detectSeriesMarkers(`${title} #${iss}`) : ourMarkers;
  const log = [];
  let rejected = 0;
  const filtered = pool.filter((t) => {
    const theirMarkers = detectSeriesMarkers(t);
    for (const m of theirMarkers) {
      if (ourMarkers.includes(m)) continue;
      if (canonicalMarkers.includes(m)) {
        log.push(`canonical-marker-allowed marker=${m}: ${t}`);
        continue;
      }
      rejected++;
      log.push(`series asymmetry detected: ${t} (marker: ${m})`);
      return false;
    }
    return true;
  });
  // Graceful wipe-out fallback, same as production.
  if (filtered.length === 0 && pool.length > 0) {
    return { survivors: pool, rejected: 0, log: ['bypassed — all had sequel markers, keeping all'] };
  }
  return { survivors: filtered, rejected, log };
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the real Adventure Time Summer Special #1 SDCC case
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: Adventure Time Summer Special #1 SDCC — the real case\n');

const REAL_POOL = [
  'Adventure Time Summer Special #1 SDCC Convention Exclusive Variant 2013 NEW',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 NM',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 VF',
  'Adventure Time Summer Special #1 SDCC 2013 CGC 7.0',
  'Adventure Time Summer Special #1 SDCC 2013 CGC 9.0',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 signed',
  'Adventure Time Summer Special #1 SDCC Convention Exclusive 2013 raw',
  'Adventure Time Summer Special #1 SDCC Exclusive 2013 High Grade',
  'Adventure Time Summer Special #1 SDCC 2013 In Hand Ships Fast',
  // The wrong sibling — no series marker at all, was never touched by this
  // filter either before or after the fix (Q75 handles it downstream).
  'Adventure Time #1 Ward SDCC Convention Exclusive Variant 2012',
  'Adventure Time #1 Ward SDCC Exclusive 2012 NM',
];

{
  const beforeFix = REAL_POOL.filter((t) => {
    // Reproduce the PRE-FIX behavior exactly: ourMarkers only, no canonical.
    const ourMarkers = detectSeriesMarkers('Adventure Time Summer Special');
    const theirMarkers = detectSeriesMarkers(t);
    return theirMarkers.every((m) => ourMarkers.includes(m));
  });
  assertEq(beforeFix.length, 2, `pre-fix reproduction: only the 2 marker-less Ward siblings survive, all 9 real listings wrongly killed (got ${beforeFix.length}/${REAL_POOL.length})`);
}

{
  const result = applySequelFilter(REAL_POOL, 'Adventure Time Summer Special', '1');
  assertEq(result.survivors.length, 11, `post-fix: all 11 listings survive this filter (9 real + 2 Ward — got ${result.survivors.length})`);
  assertEq(result.rejected, 0, 'post-fix: zero rejections (was 9 pre-fix)');
  const realSurvived = result.survivors.filter((t) => /summer special/i.test(t));
  assertEq(realSurvived.length, 9, `all 9 real "Summer Special" listings survive (got ${realSurvived.length})`);
  assertTrue(
    result.log.some((l) => l.includes('canonical-marker-allowed marker=special-1')),
    'required log line present: canonical-marker-allowed marker=special-1'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — filter NOT weakened generally: no canonical marker → still rejects
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: filter not weakened generally — no canonical marker present\n');

{
  // Confirmed book carries NO marker at all in title or title+issue.
  const pool = ['Batman Vol 2 #423 DC Comics', 'Batman #423 DC 1988 NM'];
  const result = applySequelFilter(pool, 'Batman', '423');
  assertEq(result.survivors.length, 1, 'Vol-2 listing still rejected against a plain non-marked book (byte-identical to pre-fix)');
  assertFalse(result.survivors.some((t) => /vol 2/i.test(t)), 'the Vol 2 listing specifically did not survive');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — exemption is marker-TYPE-scoped, not blanket-allow
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: exemption is marker-type-scoped, not a blanket allowance\n');

{
  // Our confirmed canonical target carries 'annual-3', NOT 'special-*'.
  // A candidate carrying an UNRELATED marker type ('special-1') must still
  // be rejected — the fix must not become "any marker matches any marker."
  const pool = [
    'X-Men Annual #3 Marvel 1994 NM',
    'X-Men Special #1 Marvel 1993', // unrelated marker type, must reject
  ];
  const result = applySequelFilter(pool, 'X-Men Annual', '3');
  assertEq(result.survivors.length, 1, 'only the genuine Annual #3 survives — the unrelated Special #1 is still rejected');
  assertTrue(result.survivors[0].includes('Annual'), 'survivor is the Annual, not the Special');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — graceful fallback when no issue is resolved
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: no issue resolved — falls back to ourMarkers, byte-identical to pre-fix\n');

{
  const pool = ['Adventure Time Summer Special #1 SDCC 2013 NM', 'Adventure Time #1 Ward SDCC 2012'];
  const result = applySequelFilter(pool, 'Adventure Time Summer Special', null);
  // With no iss, canonicalMarkers === ourMarkers === ['special-?'] — the
  // real listing's 'special-1' still doesn't match, same as pre-fix.
  assertEq(result.survivors.length, 1, 'without a resolved issue, behavior is byte-identical to pre-fix (real listing still rejected)');
  assertFalse(result.survivors.some((t) => /summer special/i.test(t)), 'the real Summer Special listing does not survive without an issue to anchor the canonical target');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4b — NEW FINDING (surfaced while building this fixture, not part
//      of the original ask): lettered cover-variant suffixes (1B/1C, per
//      Jimmy's CGC census labels "Summer Special 1B/1C/1SDCC" — the exact
//      edition-fingerprint backlog item logged in the prior trace) break
//      detectSeriesMarkers' own digit capture. `/\bSpecial\s*#?\s*(\d+)?\b/i`
//      requires a WORD BOUNDARY immediately after the digit group — "1B"
//      has no boundary between "1" and "B" (both \w), so the regex engine
//      backtracks to the EMPTY digit match, producing `special-?` instead
//      of `special-1`. This means a lettered-variant listing coincidentally
//      already matched bare `ourMarkers` (also `special-?`) even BEFORE
//      this dispatch's fix — it was never part of THIS bug, but it is a
//      real gap in detectSeriesMarkers' own number extraction for the
//      lettered-cover-variant class. Flagged for the edition-fingerprint
//      backlog, not fixed here (out of this dispatch's scope — Q144B is
//      the canonical-marker exemption, not a detectSeriesMarkers rewrite).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4b: NEW FINDING — lettered cover variants (1B/1C) break detectSeriesMarkers\' digit capture\n');

{
  assertEq(JSON.stringify(detectSeriesMarkers('Adventure Time Summer Special #1B SDCC 2013')), JSON.stringify(['special-?']),
    'lettered variant "#1B" produces special-? (no digit captured), NOT special-1 — a real gap, logged for the edition-fingerprint backlog, not fixed by this dispatch');
  assertEq(JSON.stringify(detectSeriesMarkers('Adventure Time Summer Special #1 SDCC 2013')), JSON.stringify(['special-1']),
    'control: plain "#1" (no letter suffix) correctly captures special-1');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — layered protection boundary: cross-title spinoffs sharing a
//      marker word (Marceline / Candy Capers / graphic-novel class).
//      This filter is marker-TYPE-scoped only — it has no concept of
//      WHICH title a marker belongs to. Cross-title rejection is Filter
//      0b's job (title-similarity, upstream, unaffected by this fix).
//      Documented explicitly rather than silently assumed.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: layered protection — title-similarity is the actual cross-title gate\n');

{
  // A representative different-title Adventure-Time-adjacent one-shot
  // (stand-in for the Marceline/Candy Capers class) that happens to also
  // carry a "Special #1" marker. This filter ALONE cannot distinguish it
  // from our own book by marker type — that is title-similarity's job,
  // running earlier in the chain (Filter 0b, before this filter ever
  // sees the pool).
  const spinoffTitle = 'Adventure Time Candy Capers Special #1 BOOM Studios 2013';
  const ourTokens = ['adventure', 'time', 'summer', 'special'];
  const overlapsEnoughToReachThisFilter = hasSufficientTitleOverlap(spinoffTitle, ourTokens, 0.5);
  console.log(
    `  (documentation) "${spinoffTitle}" reaches Filter 0b's ${overlapsEnoughToReachThisFilter ? 'PASS' : 'REJECT'} ` +
    `threshold against our tokens — cross-title rejection is that filter's responsibility, not this one's`
  );
  // Whatever Filter 0b decides, THIS filter's own contract stands: a
  // marker-type match against the canonical target is allowed, by design,
  // regardless of title. Confirms the fix does exactly what it says and
  // no more — it is not a substitute for title-similarity.
  const result = applySequelFilter([spinoffTitle], 'Adventure Time Summer Special', '1');
  assertEq(result.survivors.length, 1, 'this filter alone allows a same-marker-type candidate through regardless of sub-title — by design, not a regression in THIS filter\'s own scope');
}

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
