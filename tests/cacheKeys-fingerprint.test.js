// tests/cacheKeys-fingerprint.test.js
//
// GrailKey Dispatch 36 (P0) — regression tests for buildFilterContextFingerprint
// and the four-segment buildActiveCompCacheKey, closing the Hero for Hire
// class of bug: two scans of the same title/issue at different grades
// (or year/variant/isGraded/labelType/signedConsensus/assetType) silently
// shared one cached, already-filtered comp pool.
//
// Standing invariant this guards: "Cache identity is an authority
// boundary. A cache key must encode every input capable of changing the
// cached result, unless the cached object is intentionally
// input-independent raw evidence." (docs/PATTERN-LIBRARY.md "GrailKey
// Dispatch 35/36")
//
// Invoke: node tests/cacheKeys-fingerprint.test.js

import { buildFilterContextFingerprint, buildActiveCompCacheKey } from '../src/lib/cacheKeys.js';

let passed = 0;
let failed = 0;
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
const assertNotEq = (actual, notExpected, label) => {
  if (actual !== notExpected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n    both sides equal (should differ): ${JSON.stringify(actual)}`); }
};

console.log('\n=== GrailKey Dispatch 36 — filterContextFingerprint regression ===\n');

// ═══════════════════════════════════════════════════════════════════════
// 1. Identical semantic context hits — two request bodies that normalize
// to the SAME filter-chain-consumed values must share a cache entry,
// even when the RAW inputs differ syntactically.
// ═══════════════════════════════════════════════════════════════════════
console.log('1. identical semantic context → identical fingerprint (cache HIT)\n');
{
  // grade="VG 4.0" (string, parsed) vs numericGrade=4 (explicit) — both
  // normalize to numericTarget=4 per fetchComps's own preference order
  // (explicit numericGrade wins, but when only `grade` is given it must
  // parse to the identical number for these two to legitimately share).
  const a = buildFilterContextFingerprint({ grade: null, numericGrade: 4, year: '1991', variant: 'signed', isGraded: false, labelType: null, signedConsensus: true, assetType: 'comic' });
  const b = buildFilterContextFingerprint({ grade: 'VG 4.0', numericGrade: null, year: '1991', variant: 'signed', isGraded: false, labelType: null, signedConsensus: true, assetType: 'comic' });
  assertEq(a, b, 'numericGrade=4 (explicit) and grade="VG 4.0" (parsed) normalize to the same fingerprint');

  // year as number vs string, same normalized value.
  const c = buildFilterContextFingerprint({ year: 1991, isGraded: false, assetType: 'comic' });
  const d = buildFilterContextFingerprint({ year: '1991', isGraded: false, assetType: 'comic' });
  assertEq(c, d, 'year=1991 (number) and year="1991" (string) normalize to the same fingerprint');

  // year with incidental whitespace normalizes identically.
  const e = buildFilterContextFingerprint({ year: '  1991  ', isGraded: true, assetType: 'book' });
  const f = buildFilterContextFingerprint({ year: '1991', isGraded: true, assetType: 'book' });
  assertEq(e, f, 'year with surrounding whitespace normalizes to the same fingerprint as the trimmed form');

  // End-to-end: two full cache keys built from semantically-identical
  // contexts are byte-identical, so a real kvGet would HIT.
  const fp1 = buildFilterContextFingerprint({ numericGrade: 8, year: '2016', variant: null, isGraded: true, labelType: 'Universal', signedConsensus: false, assetType: 'comic' });
  const fp2 = buildFilterContextFingerprint({ grade: 'VF 8.0', year: 2016, variant: null, isGraded: true, labelType: 'Universal', signedConsensus: false, assetType: 'comic' });
  const key1 = buildActiveCompCacheKey(10, 'Amazing Spider-Man', '1', fp1);
  const key2 = buildActiveCompCacheKey(10, 'Amazing Spider-Man', '1', fp2);
  assertEq(key1, key2, 'two semantically-identical request contexts produce a byte-identical ac: cache key (real cache HIT)');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Each material dimension independently changes the key — the exact
// Hero for Hire class: changing ONLY grade (or ONLY any of the other
// five dimensions), with title/issue held fixed, must produce a
// different key so the cached pool can never be silently reused.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n2. each material dimension independently changes the fingerprint\n');
{
  const base = { grade: 'VG 4.0', numericGrade: null, year: '1972', variant: null, isGraded: false, labelType: null, signedConsensus: false, assetType: 'comic' };
  const baseFp = buildFilterContextFingerprint(base);

  // The exact real production case: Hero for Hire VG 4.0 vs GD 2.0.
  assertNotEq(buildFilterContextFingerprint({ ...base, grade: 'GD 2.0' }), baseFp, 'changing ONLY grade (VG 4.0 → GD 2.0, the real Hero for Hire case) changes the fingerprint');
  assertNotEq(buildFilterContextFingerprint({ ...base, numericGrade: 2 }), baseFp, 'changing ONLY numericGrade changes the fingerprint');
  assertNotEq(buildFilterContextFingerprint({ ...base, year: '1996' }), baseFp, 'changing ONLY year changes the fingerprint');
  assertNotEq(buildFilterContextFingerprint({ ...base, variant: '1st print' }), baseFp, 'changing ONLY variant changes the fingerprint');
  assertNotEq(buildFilterContextFingerprint({ ...base, isGraded: true }), baseFp, 'changing ONLY isGraded changes the fingerprint');
  assertNotEq(buildFilterContextFingerprint({ ...base, labelType: 'Restored' }), baseFp, 'changing ONLY labelType changes the fingerprint');
  assertNotEq(buildFilterContextFingerprint({ ...base, signedConsensus: true }), baseFp, 'changing ONLY signedConsensus changes the fingerprint (kept independent of labelType per explicit instruction)');
  assertNotEq(buildFilterContextFingerprint({ ...base, assetType: 'book' }), baseFp, 'changing ONLY assetType changes the fingerprint');

  // labelType and signedConsensus must vary independently of each other
  // — confirm one can change without the other producing the same delta.
  const fpLabelOnly = buildFilterContextFingerprint({ ...base, labelType: 'Restored' });
  const fpSignedOnly = buildFilterContextFingerprint({ ...base, signedConsensus: true });
  assertNotEq(fpLabelOnly, fpSignedOnly, 'labelType-only change and signedConsensus-only change produce DIFFERENT fingerprints from each other, not just both differing from base');

  // End-to-end key-level proof for the actual regression: same
  // title/issue, only grade differs → different ac: keys → no cache HIT.
  const fpVg = buildFilterContextFingerprint({ grade: 'VG 4.0', year: '1972', isGraded: false, assetType: 'comic' });
  const fpGd = buildFilterContextFingerprint({ grade: 'GD 2.0', year: '1972', isGraded: false, assetType: 'comic' });
  const keyVg = buildActiveCompCacheKey(10, 'hero for hire luke cage', '1', fpVg);
  const keyGd = buildActiveCompCacheKey(10, 'hero for hire luke cage', '1', fpGd);
  assertNotEq(keyVg, keyGd, 'REGRESSION GUARD: Hero for Hire VG 4.0 vs GD 2.0 now produce different ac: keys — the real bug can no longer reproduce');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. null/empty/unknown semantics preserved — a genuinely-absent value
// must never collide with an empty string, a literal "unknown", or a
// real boolean false.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n3. null/empty/unknown semantics preserved (never collapsed together)\n');
{
  const fpNullVariant = buildFilterContextFingerprint({ variant: null, isGraded: false, assetType: 'comic' });
  const fpEmptyVariant = buildFilterContextFingerprint({ variant: '', isGraded: false, assetType: 'comic' });
  const fpUnknownVariant = buildFilterContextFingerprint({ variant: 'unknown', isGraded: false, assetType: 'comic' });
  assertNotEq(fpNullVariant, fpEmptyVariant, 'variant=null and variant="" (empty string) produce different fingerprints');
  assertNotEq(fpEmptyVariant, fpUnknownVariant, 'variant="" and variant="unknown" (literal string) produce different fingerprints');
  assertNotEq(fpNullVariant, fpUnknownVariant, 'variant=null and variant="unknown" produce different fingerprints');

  // isGraded tri-state: true / false / undefined(unknown) must all be distinct.
  const fpGradedTrue = buildFilterContextFingerprint({ isGraded: true, assetType: 'comic' });
  const fpGradedFalse = buildFilterContextFingerprint({ isGraded: false, assetType: 'comic' });
  const fpGradedUnknown = buildFilterContextFingerprint({ isGraded: undefined, assetType: 'comic' });
  assertNotEq(fpGradedTrue, fpGradedFalse, 'isGraded=true and isGraded=false produce different fingerprints');
  assertNotEq(fpGradedTrue, fpGradedUnknown, 'isGraded=true and isGraded=undefined (unknown) produce different fingerprints');
  assertNotEq(fpGradedFalse, fpGradedUnknown, 'isGraded=false and isGraded=undefined (unknown) produce different fingerprints — false is a real signal, not an absence');

  // Same tri-state guarantee for signedConsensus, independently.
  const fpSignedTrue = buildFilterContextFingerprint({ signedConsensus: true, assetType: 'comic' });
  const fpSignedFalse = buildFilterContextFingerprint({ signedConsensus: false, assetType: 'comic' });
  const fpSignedUnknown = buildFilterContextFingerprint({ signedConsensus: undefined, assetType: 'comic' });
  assertNotEq(fpSignedTrue, fpSignedFalse, 'signedConsensus=true and signedConsensus=false produce different fingerprints');
  assertNotEq(fpSignedFalse, fpSignedUnknown, 'signedConsensus=false and signedConsensus=undefined produce different fingerprints');

  // No inputs at all (fully absent context) is still deterministic and
  // distinct from every populated case above.
  const fpAllAbsent1 = buildFilterContextFingerprint({});
  const fpAllAbsent2 = buildFilterContextFingerprint(undefined);
  assertEq(fpAllAbsent1, fpAllAbsent2, 'calling with {} and with no argument at all produce the identical (fully-absent) fingerprint');
  assertNotEq(fpAllAbsent1, fpGradedTrue, 'the fully-absent fingerprint differs from every populated case checked above');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Strong hash, deterministic, canonical — not a convenience hash.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n4. strong hash / determinism sanity\n');
{
  const fp = buildFilterContextFingerprint({ grade: 'NM 9.4', year: '2023', variant: 'Stegman', isGraded: false, labelType: null, signedConsensus: false, assetType: 'comic' });
  assertEq(fp.length, 64, 'fingerprint is a 64-character hex string (SHA-256 digest length)');
  assertTrue(/^[0-9a-f]{64}$/.test(fp), 'fingerprint is lowercase hex only');
  const fpAgain = buildFilterContextFingerprint({ grade: 'NM 9.4', year: '2023', variant: 'Stegman', isGraded: false, labelType: null, signedConsensus: false, assetType: 'comic' });
  assertEq(fp, fpAgain, 'identical inputs produce a byte-identical fingerprint on repeated calls (deterministic, no randomness/time dependency)');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. buildActiveCompCacheKey is FAIL-CLOSED — a missing or malformed
// fingerprint must throw, never silently build a key with "|undefined"
// or any other unvalidated segment. Confirmed live during this
// dispatch's own test authoring that an unvalidated "required" parameter
// has no real teeth in JavaScript — a 3-arg call still executes.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n5. buildActiveCompCacheKey fails closed on a missing/malformed fingerprint\n');
{
  const assertThrows = (fn, label) => {
    try {
      fn();
      failed++; console.log(`  ✗ ${label}\n    expected a throw, but the call succeeded`);
    } catch (err) {
      passed++; console.log(`  ✓ ${label}`);
    }
  };

  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1'), 'omitted fingerprint (3-arg call) throws — the exact live gap this dispatch found');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', undefined), 'explicit undefined fingerprint throws');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', null), 'null fingerprint throws');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', ''), 'empty-string fingerprint throws');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', 'not-a-hash'), 'non-hex, wrong-length fingerprint throws');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', 'a'.repeat(63)), '63-character hex (one short of a real SHA-256 digest) throws');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', 'a'.repeat(65)), '65-character hex (one too many) throws');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', 'g'.repeat(64)), '64 characters but non-hex ("g" is not a hex digit) throws');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', 'A'.repeat(64)), '64 uppercase hex characters throws — real digests from crypto.createHash(...).digest("hex") are always lowercase');
  assertThrows(() => buildActiveCompCacheKey(10, 'Bone', '1', 12345), 'a number (not a string at all) throws');

  // Positive control — a REAL buildFilterContextFingerprint() output
  // (not a hand-rolled hex string) is accepted and produces the correct
  // key shape, proving the validation isn't so strict it rejects valid
  // real-world input.
  const realFingerprint = buildFilterContextFingerprint({ grade: 'VG 4.0', year: '1972', isGraded: false, assetType: 'comic' });
  let acceptedKey = null;
  try {
    acceptedKey = buildActiveCompCacheKey(10, 'Bone', '1', realFingerprint);
    passed++; console.log('  ✓ a real buildFilterContextFingerprint() output is accepted without throwing');
  } catch (err) {
    failed++; console.log(`  ✗ a real buildFilterContextFingerprint() output is accepted without throwing\n    threw: ${err.message}`);
  }
  assertEq(acceptedKey, `v10:Bone|1|${realFingerprint}`, 'the accepted key has the correct v10:title|issue|fingerprint shape');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
