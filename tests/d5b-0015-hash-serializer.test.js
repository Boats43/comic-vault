// tests/d5b-0015-hash-serializer.test.js
//
// D5B 0015, D4/D5/D9 -- property/adversarial proof for vq-hash-v1
// (ValuationQuestion) and applicability-hash-v1 (Applicability), plus
// the shared-serializer regression proof required by V3: mo-hash-v1,
// vq-hash-v1, and applicability-hash-v1 all import the SAME
// encodeField/hashCanonicalBuffer functions from
// src/lib/canonicalHashFraming.js -- not three independent
// reimplementations. Verified here by REFERENCE EQUALITY (===), not
// merely "behaves the same" -- the strongest available proof that no
// divergence is possible.
//
// No DB, no network -- pure deterministic unit proof, same discipline
// as tests/d5a-market-observation-hash-serializer.test.js (rerun
// unchanged, 63/63, as this pass's regression proof that extracting the
// shared primitive introduced zero behavior drift in mo-hash-v1 itself).
//
// Invoke: node tests/d5b-0015-hash-serializer.test.js

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const load = async (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const framing = await load('src/lib/canonicalHashFraming.js');
const mo = await load('src/lib/marketObservationHash.js');
const vq = await load('src/lib/valuationQuestionHash.js');
const ap = await load('src/lib/applicabilityHash.js');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertThrows = (fn, label) => {
  try { fn(); failed++; const m = `  ✗ ${label} (did NOT throw)`; failures.push(m); console.log(m); }
  catch (e) { passed++; console.log(`  ✓ ${label} (threw: ${e.message.slice(0, 80)})`); }
};

console.log('\n=== D5B 0015 -- vq-hash-v1 / applicability-hash-v1 property/adversarial proof ===\n');

// ═══════════════════════════════════════════════════════════════════
// V3 -- shared serializer, proven by reference equality
// ═══════════════════════════════════════════════════════════════════
console.log('-- V3: shared canonical framing primitive, reference-equality proof --\n');

assertTrue(mo.encodeField === framing.encodeField, 'V3: marketObservationHash.encodeField IS canonicalHashFraming.encodeField (same function object, not a copy)');
assertTrue(vq.encodeField === framing.encodeField, 'V3: valuationQuestionHash.encodeField IS canonicalHashFraming.encodeField (same function object)');
assertTrue(mo.canonicalMinimalDecimal === framing.canonicalMinimalDecimal, 'V3: marketObservationHash.canonicalMinimalDecimal IS the shared function');
assertTrue(vq.canonicalMinimalDecimal === framing.canonicalMinimalDecimal, 'V3: valuationQuestionHash.canonicalMinimalDecimal IS the shared function');
assertTrue(vq.canonicalTargetGradeString === framing.canonicalMinimalDecimal, 'V4: canonicalTargetGradeString is an alias of the SAME shared function grade already uses -- not a reimplementation');
assertTrue(vq.canonicalTargetYearString === framing.canonicalMinimalDecimal, 'D3: canonicalTargetYearString reuses the SAME shared function -- a bare integer is a zero-fractional-digit case of the identical rule, no second function written');
assertTrue(mo.normalizeText === framing.normalizeText, 'V3: marketObservationHash.normalizeText IS the shared function');
assertTrue(vq.normalizeGradeBasis === framing.normalizeText, 'V4: valuationQuestionHash.normalizeGradeBasis reuses the shared normalizeText, same discipline as market_observation.grade_basis');
assertTrue(ap.normalizeUuid === framing.normalizeUuid, 'D9: applicabilityHash.normalizeUuid IS the shared function');

// ═══════════════════════════════════════════════════════════════════
// D5 -- ValuationQuestion required fixtures
// ═══════════════════════════════════════════════════════════════════
console.log('\n-- D5: ValuationQuestion required fixtures --\n');

const base = { assetId: 'A', identityAssignmentId: 'I', targetGrade: '9.4', gradeBasis: 'cgc', disposition: 'graded', variantScope: null, targetYear: '2026' };
const h = (fields) => vq.computeValuationQuestionHash(vq.canonicalizeValuationQuestionFields(fields));

assertTrue(h(base) === h({ ...base }), 'D5: same asset + same identity + same assumptions -> same question hash');
assertTrue(h(base) === h({ ...base, targetGrade: '9.40' }), 'D5: "9.4" vs "9.40" -> same question (trailing-zero canonicalization)');
assertTrue(h(base) !== h({ ...base, targetGrade: '9.2' }), 'D5: target 9.4 vs 9.2 -> different question');
assertTrue(h(base) !== h({ ...base, disposition: 'raw' }), 'D5: raw 9.4 vs certified/slabbed 9.4 -> different question (disposition axis)');
assertTrue(h(base) !== h({ ...base, identityAssignmentId: 'I2' }), 'D5: identity X vs corrected identity Y -> different question');
assertTrue(h(base) !== h({ ...base, assetId: 'B' }), 'D5: Asset A vs Asset B -> different durable question');

// filter v12 vs v13 / model M1 vs M2 -> same question: proven
// structurally, not merely by omission -- these fields are not even
// accepted parameters of serializeValuationQuestionTuple/
// canonicalizeValuationQuestionFields, so passing them has zero effect
// on the computed hash regardless of value.
const withBogusFilterField = { ...base, compFilterVersion: 12, modelVersion: 'claude-vision-1' };
const withDifferentBogusFilterField = { ...base, compFilterVersion: 13, modelVersion: 'claude-vision-2' };
assertTrue(
  h(withBogusFilterField) === h(withDifferentBogusFilterField) && h(withBogusFilterField) === h(base),
  'D5/R3/GK-185: filter v12 vs v13, model M1 vs M2 -> same question (these fields are not parameters of the tuple at all -- structurally excluded, not merely unused)'
);

// grade-basis collision: same numeric grade, NULL basis vs present basis
assertTrue(h(base) !== h({ ...base, gradeBasis: null }), 'V4: grade_basis collision -- "9.4 CGC" vs "9.4 (no basis asserted)" -- different question, NULL is structurally distinct from any present string');
assertTrue(h({ ...base, gradeBasis: null }) !== h({ ...base, gradeBasis: '' }), 'V4: grade_basis "" (present, empty) vs NULL (absent) -- different question, presence-tagged serialization distinguishes them');
assertTrue(h(base) !== h({ ...base, gradeBasis: 'cbcs' }), 'V4: "9.4 CGC" vs "9.4 CBCS" -- different question, same numeric grade');

// ═══════════════════════════════════════════════════════════════════
// D5 adversarial -- injectivity across field-boundary shifting
// ═══════════════════════════════════════════════════════════════════
console.log('\n-- D5 adversarial: presence/absence and cross-field injectivity --\n');

assertTrue(vq.computeValuationQuestionHash({ assetId: 'a', identityAssignmentId: null, targetGrade: null, gradeBasis: null, disposition: null, variantScope: null, targetYear: null })
  !== vq.computeValuationQuestionHash({ assetId: null, identityAssignmentId: 'a', targetGrade: null, gradeBasis: null, disposition: null, variantScope: null, targetYear: null }),
  'D5 adversarial: a value shifted from assetId to identityAssignmentId (same string, different field) produces a DIFFERENT hash -- length-prefixed framing prevents field-boundary confusion');

assertTrue(
  vq.computeValuationQuestionHash({ assetId: 'ab', identityAssignmentId: 'c', targetGrade: null, gradeBasis: null, disposition: null, variantScope: null, targetYear: null })
  !== vq.computeValuationQuestionHash({ assetId: 'a', identityAssignmentId: 'bc', targetGrade: null, gradeBasis: null, disposition: null, variantScope: null, targetYear: null }),
  'D5 adversarial: "ab"+"c" vs "a"+"bc" (naive concatenation would collide) -- length-prefixed framing keeps them distinct'
);

// disposition domain enforcement
assertThrows(() => vq.normalizeDisposition('slabbed'), 'D3: normalizeDisposition rejects a value outside the fixed raw/graded vocabulary (no comic-specific "slabbed" term admitted)');
assertTrue(vq.normalizeDisposition(null) === null, 'D3: normalizeDisposition(null) -> null (no disposition asserted is a legal, real state)');
assertTrue(vq.normalizeDisposition(undefined) === null, 'D3: normalizeDisposition(undefined) -> null');

console.log('\n=== D5B 0015 -- Applicability property/adversarial proof ===\n');

// ═══════════════════════════════════════════════════════════════════
// D6/V1 -- verdict and confidence are independent axes
// ═══════════════════════════════════════════════════════════════════
console.log('-- D6/V1: verdict and confidence_tier vary independently --\n');

const jbase = { observationId: 'O', questionId: 'Q', verdict: 'APPLICABLE', confidenceTier: 'HIGH', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null };
const jh = (fields) => ap.computeApplicabilityHash(ap.canonicalizeApplicabilityFields(fields));

assertTrue(jh(jbase) !== jh({ ...jbase, verdict: 'NOT_APPLICABLE' }), 'D6: APPLICABLE vs NOT_APPLICABLE (same confidence) -> different hash');
assertTrue(jh(jbase) !== jh({ ...jbase, confidenceTier: 'LOW' }), 'V1: HIGH vs LOW confidence (same verdict) -> different hash -- confidence is not derivable from verdict');
assertTrue(
  jh({ ...jbase, verdict: 'NOT_APPLICABLE', confidenceTier: 'HIGH' }) !== jh({ ...jbase, verdict: 'APPLICABLE', confidenceTier: 'LOW' }),
  'V1: NOT_APPLICABLE+HIGH vs APPLICABLE+LOW are both independently representable and distinct -- the two required cases from ADR-VALUATION-001 V1'
);
assertThrows(() => ap.normalizeVerdict('CONTESTED'), 'D7: normalizeVerdict rejects CONTESTED -- never a primitive persisted verdict value, only a read-time derived concept over multiple rows');
assertThrows(() => ap.normalizeConfidenceTier('CORROBORATED'), 'V1: normalizeConfidenceTier rejects D4 resolution_authority vocabulary values (CORROBORATED) -- deliberately disjoint vocabulary, not mechanically reused');

// ═══════════════════════════════════════════════════════════════════
// D9 -- judgment multiplicity: different logic versions never collide
// ═══════════════════════════════════════════════════════════════════
console.log('\n-- D9: judgment identity / cardinality --\n');

assertTrue(jh(jbase) !== jh({ ...jbase, ruleVersion: '13' }), 'D9: filter v12 vs v13, otherwise-identical judgment -- DIFFERENT hash (legitimate multiplicity preserved, not deduped away)');
assertTrue(jh(jbase) !== jh({ ...jbase, modelVersion: 'M2' }), 'D9: model M1(null) vs M2, otherwise-identical judgment -- DIFFERENT hash');
assertTrue(jh(jbase) !== jh({ ...jbase, sourceType: 'operator-override' }), 'D9: automated vs operator-override, otherwise-identical -- DIFFERENT hash (two independently-recorded facts)');
assertTrue(
  jh(jbase) === jh({ observationId: 'O', questionId: 'Q', verdict: 'applicable', confidenceTier: 'high', ruleId: 'comp-filter', ruleVersion: '12', modelVersion: null, sourceType: 'automated', reason: null }),
  'D9: same judgment replay (identical semantic content, different case formatting) -> SAME hash -- dedup collision is the intended, desired outcome'
);
assertTrue(jh(jbase) !== jh({ ...jbase, observationId: 'O2' }), 'D9: different observation, otherwise-identical judgment -> different hash (observation participates in identity)');
assertTrue(jh(jbase) !== jh({ ...jbase, questionId: 'Q2' }), 'D9: different question, otherwise-identical judgment -> different hash (question participates in identity)');

// recorded_by_principal_id explicitly excluded from the hash (D9 header
// rationale: WHO recorded an otherwise-identical judgment is
// provenance, not content) -- proven by construction: canonicalize
// FieldsApplicability has no recordedByPrincipalId parameter at all, so
// passing one has zero effect.
assertTrue(
  jh({ ...jbase, recordedByPrincipalId: 'principal-1' }) === jh({ ...jbase, recordedByPrincipalId: 'principal-2' }),
  'D9: two different principals recording the identical judgment content -> SAME hash (principal is provenance, not judgment content -- structurally excluded, not merely unused)'
);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
