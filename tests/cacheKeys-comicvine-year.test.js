// tests/cacheKeys-comicvine-year.test.js
//
// GrailKey Dispatch 36 (P1) — buildComicVineCacheKey: dead `variant`
// segment removed (never reached lookupComicVine at all — confirmed by
// direct audit), replaced with two real gaps: normalized `year` (drives
// cv-year-strict and the volume-selection score) and `poolYearHint`
// (keyed only when behaviorally active per lookupComicVine's own
// !hasYearComparison gate — i.e. only when `year` is absent). Full audit:
// docs/PATTERN-LIBRARY.md "GrailKey Dispatch 35/36".
//
// Invoke: node tests/cacheKeys-comicvine-year.test.js

import { buildComicVineCacheKey, parseCacheKeyIssueSegment } from '../src/lib/cacheKeys.js';

let passed = 0;
let failed = 0;
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`); }
};
const assertNotEq = (actual, notExpected, label) => {
  if (actual !== notExpected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n    both sides equal (should differ): ${JSON.stringify(actual)}`); }
};

console.log('\n=== GrailKey Dispatch 36 — ComicVine cache-key year regression ===\n');

{
  // Same title/issue/publisher, different year -> different key (the real gap).
  const key1972 = buildComicVineCacheKey('hero for hire luke cage', '1', 'Marvel', '1972', 2);
  const key1996 = buildComicVineCacheKey('hero for hire luke cage', '1', 'Marvel', '1996', 2);
  assertNotEq(key1972, key1996, 'same title/issue/publisher, different year -> different cv: key');

  // Year normalizes identically regardless of surrounding whitespace / numeric-vs-string.
  const keyStr = buildComicVineCacheKey('Bone', '1', 'Image', '1991', 2);
  const keyNum = buildComicVineCacheKey('Bone', '1', 'Image', 1991, 2);
  const keyWs = buildComicVineCacheKey('Bone', '1', 'Image', '  1991  ', 2);
  assertEq(keyStr, keyNum, 'year as string "1991" and number 1991 normalize to the same key');
  assertEq(keyStr, keyWs, 'year with surrounding whitespace normalizes to the same key as the trimmed form');

  // null must stay distinguishable from any real year.
  const keyNullYear = buildComicVineCacheKey('Bone', '1', 'Image', null, 2);
  assertNotEq(keyNullYear, keyStr, 'year=null produces a different key than a real year (1991) — never collapsed together');
  assertEq(keyNullYear.endsWith('|null'), true, 'a genuinely absent year serializes to the literal "null" token, not an empty string or a fabricated year');

  // Dead variant segment is gone — passing what used to be the 4th
  // (variant) argument position now means year, so a real production
  // variant string in that position no longer silently becomes a no-op
  // cache-key segment; confirm the key shape is exactly 5 pipe-delimited
  // segments after the version prefix (title|issue|publisher|year|
  // poolYearHint), not 4 with variant tacked on separately.
  const key = buildComicVineCacheKey('Bone', '1', 'Image', '1991', 2);
  const afterPrefix = key.replace(/^cv:v\d+:/, '');
  const segments = afterPrefix.split('|');
  assertEq(segments.length, 5, 'cv: key has exactly 5 segments (title|issue|publisher|year|poolYearHint) — no separate variant segment survives');
  assertEq(segments[3], '1991', 'the 4th segment is the normalized year, not a variant string');

  // parseCacheKeyIssueSegment still correctly extracts the issue
  // regardless of the key-shape change (existing consumer unaffected).
  assertEq(parseCacheKeyIssueSegment(key).issue, '1', 'parseCacheKeyIssueSegment still correctly extracts the issue segment after the key-shape change');

  // Version bump: CV_FILTER_VERSION is passed explicitly by callers, so
  // this just confirms the version segment renders as given (2, per the
  // Dispatch 36 bump in api/kv-cache.js) rather than silently reverting.
  assertEq(key.startsWith('cv:v2:'), true, 'key carries the bumped v2 prefix when the caller passes CV_FILTER_VERSION=2');
}

// ═══════════════════════════════════════════════════════════════════════
// poolYearHint — keyed ONLY when behaviorally active (year absent),
// per lookupComicVine's own !hasYearComparison gate. Normalized to null
// otherwise, matching the lookup's own behavior of ignoring it whenever
// a real year exists — this is a correctness constraint, not just a
// completeness one: over-keying poolYearHint when year is present would
// fragment cache hits for a value the lookup never actually consults in
// that case.
// ═══════════════════════════════════════════════════════════════════════
console.log('\npoolYearHint — keyed only when behaviorally active\n');
{
  // year ABSENT: poolYearHint is behaviorally active (the exact gate
  // lookupComicVine itself uses) — two different poolYearHint values
  // must produce two different keys.
  const keyHint2020 = buildComicVineCacheKey('Spawn', '351', 'Image', null, 2, { year: 2020, agreement: 0.6, sampleSize: 10 });
  const keyHint2024 = buildComicVineCacheKey('Spawn', '351', 'Image', null, 2, { year: 2024, agreement: 0.6, sampleSize: 10 });
  assertNotEq(keyHint2020, keyHint2024, 'year absent: different poolYearHint.year values produce different keys (behaviorally active)');

  // year ABSENT, no poolYearHint at all vs. year ABSENT with a real
  // poolYearHint — must also differ (an active hint really is present).
  const keyNoHint = buildComicVineCacheKey('Spawn', '351', 'Image', null, 2, null);
  assertNotEq(keyNoHint, keyHint2020, 'year absent: no poolYearHint at all differs from a real poolYearHint value');

  // year PRESENT: poolYearHint must be IGNORED (normalized to null)
  // regardless of its value — lookupComicVine itself never consults it
  // when a real year comparison is possible, so two requests differing
  // ONLY in poolYearHint while both carrying the same real year must
  // share the identical key (correct cache HIT, not a false miss).
  const keyYearPresentHint2020 = buildComicVineCacheKey('Spawn', '351', 'Image', '2024', 2, { year: 2020, agreement: 0.6, sampleSize: 10 });
  const keyYearPresentHint2099 = buildComicVineCacheKey('Spawn', '351', 'Image', '2024', 2, { year: 2099, agreement: 0.9, sampleSize: 20 });
  const keyYearPresentNoHint = buildComicVineCacheKey('Spawn', '351', 'Image', '2024', 2, null);
  assertEq(keyYearPresentHint2020, keyYearPresentHint2099, 'year present: two DIFFERENT poolYearHint values produce the SAME key — the hint is correctly ignored, matching lookupComicVine\'s own behavior');
  assertEq(keyYearPresentHint2020, keyYearPresentNoHint, 'year present: a real poolYearHint and no poolYearHint at all produce the SAME key — both correctly normalize to "hint not consulted"');

  // The ignored-poolYearHint segment must render as the same literal
  // 'null' token used for a genuinely absent year — not a different
  // sentinel, so parsing/tooling has exactly one "absent" representation.
  assertEq(keyYearPresentHint2020.endsWith('|null'), true, 'when poolYearHint is ignored (year present), the trailing segment is the literal "null" token');
}

// ═══════════════════════════════════════════════════════════════════════
// hasYearComparison truthiness match — the second-round correction.
// hasYearComparison (api/enrich.js:963) is `Boolean(comicYear &&
// startYear)`, a TRUTHINESS test, not `comicYear != null`. A malformed/
// non-numeric year ("Unknown", etc.) parses via parseInt to NaN — which
// is `!= null` (true) but falsy (Boolean(NaN) === false). Gating on
// `== null` alone would treat NaN as "year present" and wrongly suppress
// poolYearHint, while the real lookup treats NaN as "no year" and DOES
// consult it — a confirmed false-HIT class this section guards against.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nhasYearComparison truthiness match (null vs NaN vs valid numeric year)\n');
{
  // null year (genuinely absent) — poolYearHint behaviorally active,
  // exactly as already covered above; restated here for direct
  // comparison against the NaN case immediately below.
  const keyNullYear = buildComicVineCacheKey('Spawn', '351', 'Image', null, 2, { year: 2020, agreement: 0.6, sampleSize: 10 });
  const keyNullYearOtherHint = buildComicVineCacheKey('Spawn', '351', 'Image', null, 2, { year: 2024, agreement: 0.6, sampleSize: 10 });
  assertNotEq(keyNullYear, keyNullYearOtherHint, 'null year: different poolYearHint values still produce different keys');

  // "Unknown" / non-numeric year -> parseInt produces NaN. THE
  // REGRESSION GUARD: this must behave IDENTICALLY to a null year for
  // poolYearHint-gating purposes (both are non-authoritative per
  // hasYearComparison's own truthiness test), not identically to a real
  // numeric year.
  const keyUnknownYear = buildComicVineCacheKey('Spawn', '351', 'Image', 'Unknown', 2, { year: 2020, agreement: 0.6, sampleSize: 10 });
  const keyUnknownYearOtherHint = buildComicVineCacheKey('Spawn', '351', 'Image', 'Unknown', 2, { year: 2024, agreement: 0.6, sampleSize: 10 });
  assertNotEq(keyUnknownYear, keyUnknownYearOtherHint, 'REGRESSION GUARD: year="Unknown" (parses to NaN) — different poolYearHint values still produce different keys, matching hasYearComparison treating NaN as falsy/no-year, NOT `comicYear == null`\'s wrong answer');

  const keyUnknownYearNoHint = buildComicVineCacheKey('Spawn', '351', 'Image', 'Unknown', 2, null);
  assertNotEq(keyUnknownYear, keyUnknownYearNoHint, 'year="Unknown": a real poolYearHint differs from no poolYearHint at all — the hint is genuinely active, not silently suppressed');

  // Valid numeric year — poolYearHint correctly SUPPRESSED (matches the
  // "year PRESENT" behavior already covered above; restated for direct
  // three-way contrast against null and NaN in this section).
  const keyValidYearHint2020 = buildComicVineCacheKey('Spawn', '351', 'Image', '2024', 2, { year: 2020, agreement: 0.6, sampleSize: 10 });
  const keyValidYearHint2099 = buildComicVineCacheKey('Spawn', '351', 'Image', '2024', 2, { year: 2099, agreement: 0.9, sampleSize: 20 });
  assertEq(keyValidYearHint2020, keyValidYearHint2099, 'valid numeric year: poolYearHint correctly suppressed regardless of its value');

  // Direct three-way proof: null-year and NaN-year ("Unknown") gate
  // poolYearHint the SAME way (both active); a valid numeric year gates
  // it the OPPOSITE way (suppressed). If the fix regressed to
  // `comicYear == null`, this specific comparison would fail: NaN would
  // wrongly land in the "suppressed" bucket alongside the valid year.
  const nullGateActive = buildComicVineCacheKey('X', '1', 'Y', null, 2, { year: 1 }) !== buildComicVineCacheKey('X', '1', 'Y', null, 2, { year: 2 });
  const nanGateActive = buildComicVineCacheKey('X', '1', 'Y', 'Unknown', 2, { year: 1 }) !== buildComicVineCacheKey('X', '1', 'Y', 'Unknown', 2, { year: 2 });
  const validYearGateActive = buildComicVineCacheKey('X', '1', 'Y', '1999', 2, { year: 1 }) !== buildComicVineCacheKey('X', '1', 'Y', '1999', 2, { year: 2 });
  assertEq(nullGateActive, true, 'null year: poolYearHint gate is ACTIVE');
  assertEq(nanGateActive, true, 'NaN year ("Unknown"): poolYearHint gate is ACTIVE — same bucket as null, per hasYearComparison\'s own truthiness test');
  assertEq(validYearGateActive, false, 'valid numeric year: poolYearHint gate is SUPPRESSED — the opposite bucket from null/NaN');
}

// ═══════════════════════════════════════════════════════════════════════
// Only `.year` is proven to matter — `.agreement`/`.sampleSize` have no
// representation in the key because scoreWithDetails (the only consumer
// of poolYearHint inside lookupComicVine) never reads them.
// ═══════════════════════════════════════════════════════════════════════
console.log('\npoolYearHint.agreement / .sampleSize — proven irrelevant to this key\n');
{
  const keyLowConfidence = buildComicVineCacheKey('Spawn', '351', 'Image', null, 2, { year: 2020, agreement: 0.05, sampleSize: 1 });
  const keyHighConfidence = buildComicVineCacheKey('Spawn', '351', 'Image', null, 2, { year: 2020, agreement: 0.95, sampleSize: 40 });
  assertEq(keyLowConfidence, keyHighConfidence, 'same poolYearHint.year, wildly different agreement/sampleSize -> identical key (only .year affects lookupComicVine\'s scoring, per direct source read of scoreWithDetails)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
