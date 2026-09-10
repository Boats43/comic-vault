// tests/gk184-evidence-observed-at-unit.test.js
//
// GK-184 — TRUE MARKET-EVIDENCE RETRIEVAL TIME.
//
// Real, direct imports of src/lib/evidenceObservedAt.js — no mocking, no
// I/O. Covers the pure-logic proofs (P5, P6) and the classification-guard
// negative proofs (N1, N3, N4, N5) that don't require a cache round trip
// (those live in tests/gk184-cache-provenance-integration.test.js
// alongside P1-P4/N2, since they need a real read/write boundary).
//
// Invoke: node tests/gk184-evidence-observed-at-unit.test.js

import {
  captureEvidenceObservedAt,
  stampEvidenceObservedAt,
  classifyEvidenceObservedAt,
  readEvidenceObservedAt,
  isEvidenceTimeAdmissible,
  EVIDENCE_CLASSIFICATION,
} from '../src/lib/evidenceObservedAt.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`; failures.push(m); console.log(m); }
};
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-184 — evidenceObservedAt pure-logic proofs ===\n');

// ═══════════════════════════════════════════════════════════════════════
// P6 — serialization round trip (real JSON.stringify/parse, real Date
// parsing — the actual mechanics a Redis JSON round trip depends on).
// ═══════════════════════════════════════════════════════════════════════
console.log('P6 — serialization round trip\n');

const t1 = captureEvidenceObservedAt(() => new Date('2026-09-03T10:00:00.000Z'));
assertEq(t1, '2026-09-03T10:00:00.000Z', 'captureEvidenceObservedAt produces exact millisecond-precision UTC ISO-8601');

const obj = stampEvidenceObservedAt({ price: 42 }, t1);
const roundTripped = JSON.parse(JSON.stringify(obj));
assertEq(roundTripped.evidenceObservedAt, t1, 'JSON round trip preserves the exact instant byte-for-byte (no timezone shift)');
assertEq(new Date(roundTripped.evidenceObservedAt).getTime(), new Date(t1).getTime(), 'round-tripped instant parses to the identical epoch millisecond');

// ═══════════════════════════════════════════════════════════════════════
// P5 — occurredAt/evidenceObservedAt independence. A sold record's own
// event date must never be touched or read by this module.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nP5 — occurredAt stays independent of evidenceObservedAt\n');

const soldRecord = { occurredAt: '2026-08-14T00:00:00.000Z', price: 250 };
stampEvidenceObservedAt(soldRecord, '2026-09-03T21:14:32.481Z');
assertEq(soldRecord.occurredAt, '2026-08-14T00:00:00.000Z', 'occurredAt (sale date) is completely unchanged after stamping evidenceObservedAt');
assertEq(soldRecord.evidenceObservedAt, '2026-09-03T21:14:32.481Z', 'evidenceObservedAt (retrieval date) holds its own distinct value');
assertTrue(soldRecord.occurredAt !== soldRecord.evidenceObservedAt, 'the two timestamps are provably distinct on the same object');

// ═══════════════════════════════════════════════════════════════════════
// N1 — no request-time fallback for absent metadata. Exact guard:
// classifyEvidenceObservedAt(...).classification === ABSENT, and
// readEvidenceObservedAt returns null, never something close to Date.now().
// ═══════════════════════════════════════════════════════════════════════
console.log('\nN1 — absent metadata is never upgraded to now()\n');

const beforeCall = Date.now();
const absentResult1 = classifyEvidenceObservedAt(undefined);
const absentResult2 = classifyEvidenceObservedAt(null);
assertEq(absentResult1.classification, EVIDENCE_CLASSIFICATION.ABSENT, 'undefined classifies as ABSENT (exact guard identity), not now()');
assertEq(absentResult1.value, null, 'ABSENT value is null, never a timestamp');
assertEq(absentResult2.classification, EVIDENCE_CLASSIFICATION.ABSENT, 'null classifies as ABSENT');

const legacyEntry = { productName: 'Amazing Spider-Man #1' }; // no evidenceObservedAt at all
const readBack = readEvidenceObservedAt(legacyEntry);
assertEq(readBack, null, 'readEvidenceObservedAt on a legacy/unstamped object returns null');
// Prove it structurally cannot be "close to now" — null !== any numeric
// timestamp, so this also rules out any hidden Date.now() coercion.
assertTrue(readBack !== beforeCall && typeof readBack !== 'number', 'the null return cannot be mistaken for a request-time fallback (not a number, not close to Date.now())');

// ═══════════════════════════════════════════════════════════════════════
// N3 — no occurredAt substitution. An object with occurredAt present but
// evidenceObservedAt absent must NOT have occurredAt's value returned by
// readEvidenceObservedAt.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nN3 — occurredAt is never substituted for a missing evidenceObservedAt\n');

const occurredOnly = { occurredAt: '2026-08-14T00:00:00.000Z', occurredOn: '2026-08-14' };
assertEq(readEvidenceObservedAt(occurredOnly), null, 'occurredAt present, evidenceObservedAt absent -> null (not occurredAt\'s value)');
assertTrue(readEvidenceObservedAt(occurredOnly) !== occurredOnly.occurredAt, 'explicit inequality: the returned value is not occurredAt');

// ═══════════════════════════════════════════════════════════════════════
// N4 — a future D5 payload-building helper must not fall back to
// `observedAt ?? new Date()`. Static source-text guard: this module's own
// source contains exactly one `new Date()` construction (inside
// captureEvidenceObservedAt's default nowFn parameter), and it is never
// used as a `??`/`||` fallback anywhere else in the file.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nN4 — no now()-fallback pattern exists anywhere in the module source\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleSource = readFileSync(path.join(__dirname, '../src/lib/evidenceObservedAt.js'), 'utf8');
// Strip `//` line comments before scanning for CODE patterns — the file's
// own doc comments legitimately name "new Date()"/"occurredAt"/"recordedAt"
// to explain what the field does NOT mean; that prose is not a fallback.
const codeOnly = moduleSource.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');

const newDateOccurrencesInCode = (codeOnly.match(/new Date\(/g) || []).length;
// captureEvidenceObservedAt's default nowFn (`() => new Date()`), plus
// classifyEvidenceObservedAt's validation-only `new Date(rawValue)` — both
// legitimate, neither is a fallback. No THIRD occurrence is permitted.
assertEq(newDateOccurrencesInCode, 2, `exactly 2 legitimate "new Date(" call sites in the module's CODE (found ${newDateOccurrencesInCode}) — capture's default nowFn + classify's validation parse, no fallback usage`);
assertTrue(!/\?\?\s*new Date\(\)/.test(codeOnly), 'code contains no "?? new Date()" fallback pattern');
assertTrue(!/\|\|\s*new Date\(\)/.test(codeOnly), 'code contains no "|| new Date()" fallback pattern');
assertTrue(!/\?\?\s*Date\.now\(\)/.test(codeOnly), 'code contains no "?? Date.now()" fallback pattern');
assertTrue(!codeOnly.includes('recordedAt'), 'CODE never references recordedAt (persistence time) as a substitution source (doc comments may explain the concept — code must not act on it)');
assertTrue(!codeOnly.includes('occurredAt') && !codeOnly.includes('occurredOn'), 'CODE never references occurredAt/occurredOn as a substitution source for evidenceObservedAt (doc comments may explain the concept — code must not act on it)');

// ═══════════════════════════════════════════════════════════════════════
// N5 — malformed cache metadata is explicitly rejected/classified, never
// silently normalized to the current time.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nN5 — malformed evidenceObservedAt is rejected, not normalized\n');

const malformedCases = [
  ['2026-09-03', 'bare calendar date (occurredOn shape, not an instant)'],
  ['2026-09-03T10:00:00Z', 'second-precision, missing milliseconds'],
  ['2026-09-03T10:00:00.000+05:00', 'non-UTC offset instead of Z'],
  ['not-a-date-at-all', 'garbage string'],
  ['2026-13-45T99:99:99.999Z', 'syntactically ISO-shaped but calendrically impossible'],
  [12345, 'a raw number, not a string'],
  [{}, 'an object, not a string'],
];
for (const [bad, label] of malformedCases) {
  const result = classifyEvidenceObservedAt(bad);
  assertEq(result.classification, EVIDENCE_CLASSIFICATION.MALFORMED, `${label} -> classified MALFORMED (guard identity), not silently accepted`);
  assertEq(result.value, null, `${label} -> value is null, never coerced into a usable timestamp`);
}

const validCase = classifyEvidenceObservedAt('2026-09-03T21:14:32.481Z');
assertEq(validCase.classification, EVIDENCE_CLASSIFICATION.PRESENT_VALID, 'a genuine millisecond-UTC instant classifies PRESENT_VALID');
assertEq(validCase.value, '2026-09-03T21:14:32.481Z', 'PRESENT_VALID returns the exact value unchanged');

// stampEvidenceObservedAt no-op safety
assertEq(stampEvidenceObservedAt(null, t1), null, 'stampEvidenceObservedAt on null returns null unchanged (no fabricated object)');
assertEq(stampEvidenceObservedAt(undefined, t1), undefined, 'stampEvidenceObservedAt on undefined returns undefined unchanged');
assertEq(stampEvidenceObservedAt('a string', t1), 'a string', 'stampEvidenceObservedAt on a non-object primitive returns it unchanged (cannot attach a field)');

// ═══════════════════════════════════════════════════════════════════════
// GK-184 CORRECTION PASS, item 3 — isEvidenceTimeAdmissible, the explicit
// switch-style TIME-AXIS admission test. Answers "is there a genuine
// timestamp at all" ONLY — never a freshness/staleness judgment (see
// "Provenance Truth != Evidence Freshness" in docs/PATTERN-LIBRARY.md).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nCorrection pass — isEvidenceTimeAdmissible (explicit admission switch)\n');

assertEq(isEvidenceTimeAdmissible(EVIDENCE_CLASSIFICATION.PRESENT_VALID), true, 'PRESENT_VALID is admissible on the time axis');
assertEq(isEvidenceTimeAdmissible(EVIDENCE_CLASSIFICATION.ABSENT), false, 'ABSENT is NOT admissible — a future D5D path must SKIP it, never substitute');
assertEq(isEvidenceTimeAdmissible(EVIDENCE_CLASSIFICATION.MALFORMED), false, 'MALFORMED is NOT admissible — rejected, never coerced into a usable value');

let threwOnUnknown = false;
try {
  isEvidenceTimeAdmissible('some-future-fourth-classification');
} catch (e) {
  threwOnUnknown = true;
}
assertTrue(threwOnUnknown, 'an unrecognized classification throws (fail-loud, not a silent true/false default) — the switch is exhaustive by construction');

// End-to-end: real classify() output piped directly into the admission
// switch, for each of the three real classifications this module ever
// produces (never a hand-typed enum string).
assertEq(isEvidenceTimeAdmissible(classifyEvidenceObservedAt('2026-09-03T21:14:32.481Z').classification), true, 'real PRESENT_VALID classify() output is admissible');
assertEq(isEvidenceTimeAdmissible(classifyEvidenceObservedAt(undefined).classification), false, 'real ABSENT classify() output (undefined input) is not admissible');
assertEq(isEvidenceTimeAdmissible(classifyEvidenceObservedAt('2026-09-03').classification), false, 'real MALFORMED classify() output (bare date) is not admissible');

// Confirm EVIDENCE_CLASSIFICATION was never extended with a NOT_CACHED
// (or any other) fourth member — the correction pass explicitly forbids
// this; "no evidence fetched at all" and "fetched but absent/malformed"
// both correctly collapse to the same ABSENT/MALFORMED non-admissible
// outcome, with no need for a distinct enum value.
assertEq(Object.keys(EVIDENCE_CLASSIFICATION).sort(), ['ABSENT', 'MALFORMED', 'PRESENT_VALID'], 'EVIDENCE_CLASSIFICATION has exactly 3 members — no NOT_CACHED or other 4th value was added');

console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
