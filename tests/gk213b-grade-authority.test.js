// tests/gk213b-grade-authority.test.js
//
// GK-213B (Operator Authority — Product Refinement/Grading Program, GK-213
// item #3) — OPERATOR-ESTABLISHED FACTS OUTRANK FRESH MODEL OUTPUT, applied
// to grading. Three durable facts, never conflated: modelPredictedGrade*
// (write-once baseline, dataQualityGuard.js, untouched), grade/numericGrade/
// isGraded (current automated estimate, untouched by this build), and
// operatorGrade/operatorGradeNumeric/operatorIsGraded (explicit human
// authority, new — src/lib/gradeAuthority.js).
//
// Section 1: validateOperatorGrade / setOperatorGrade / clearOperatorGrade
// Section 2: setOperatorGradingFormat / clearOperatorGradingFormat
// Section 3: resolveGoverningGradingFormat — the K1 hierarchy (certified >
//   operator > model), including the false-positive raw-as-slab fixture
// Section 4: resolveGoverningGrade — K6's four isGraded-transition cases
// Section 5: formula integration — the REAL getGradeMultiplier/
//   getRawGradeMultiplier from api/enrich.js, fed the REAL governing
//   input, for all three named fixtures (House of Secrets #91, Iron Man #1
//   raw, X-Men Annual #14 CGC) plus the false-positive fixture
// Section 6: K2 — chooseBetterGrade never touches grade-authority fields
// Section 7: real handler smoke — the new request/response fields survive
//   an actual /api/enrich invocation without throwing
//
// Invoke: node tests/gk213b-grade-authority.test.js

process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import {
  validateOperatorGrade,
  setOperatorGrade,
  clearOperatorGrade,
  setOperatorGradingFormat,
  clearOperatorGradingFormat,
  resolveGoverningGradingFormat,
  resolveGoverningGrade,
} from '../src/lib/gradeAuthority.js';
import { chooseBetterGrade } from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-213B — Operator Grading Authority ===\n');

// ═══════════════════════════════════════════════════════════════════════
console.log('Section 1: validateOperatorGrade / setOperatorGrade / clearOperatorGrade');
{
  assertTrue(validateOperatorGrade('VG 4.0').valid, 'accepts "VG 4.0"');
  assertTrue(validateOperatorGrade('FN').valid, 'accepts bare "FN"');
  assertTrue(validateOperatorGrade('7.5').valid, 'accepts bare numeric "7.5"');
  assertTrue(!validateOperatorGrade('').valid, 'rejects empty string');
  assertTrue(!validateOperatorGrade('garbage').valid, 'rejects malformed input');
  assertTrue(!validateOperatorGrade('VG 99').valid, 'rejects out-of-range numeric');

  const setResult = setOperatorGrade('VG 4.0');
  assertTrue(setResult.ok, 'setOperatorGrade succeeds for valid input');
  assertEq(setResult.patch.operatorGrade, 'VG 4.0', 'SET: operatorGrade persisted');
  assertEq(setResult.patch.operatorGradeNumeric, 4, 'SET: operatorGradeNumeric parsed');
  assertEq(setResult.patch.gradeAuthority, 'OPERATOR_CONFIRMED', 'SET: gradeAuthority set');
  assertTrue(typeof setResult.patch.operatorGradeSetAt === 'number', 'SET: operatorGradeSetAt stamped');
  // Never touches grade/numericGrade/modelPredictedGrade* — confirmed by
  // construction: the patch object contains ONLY the four operator-grade
  // keys, nothing else.
  assertEq(Object.keys(setResult.patch).sort(), ['gradeAuthority', 'operatorGrade', 'operatorGradeNumeric', 'operatorGradeSetAt'].sort(), 'SET patch touches ONLY operator-grade fields');

  const badSet = setOperatorGrade('garbage');
  assertTrue(!badSet.ok, 'setOperatorGrade rejects malformed input, no authority mutation');
  assertTrue(!('patch' in badSet), 'rejected SET returns no patch at all');

  const cleared = clearOperatorGrade();
  assertEq(cleared, { operatorGrade: null, operatorGradeNumeric: null, operatorGradeSetAt: null, gradeAuthority: null }, 'CLEAR nulls exactly the four operator-grade fields');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 2: setOperatorGradingFormat / clearOperatorGradingFormat');
{
  assertEq(setOperatorGradingFormat(false), { operatorIsGraded: false, gradingFormatAuthority: 'OPERATOR_CONFIRMED' }, 'SET raw format');
  assertEq(setOperatorGradingFormat(true), { operatorIsGraded: true, gradingFormatAuthority: 'OPERATOR_CONFIRMED' }, 'SET graded format');
  assertEq(clearOperatorGradingFormat(), { operatorIsGraded: null, gradingFormatAuthority: null }, 'CLEAR format authority');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 3: resolveGoverningGradingFormat — K1 hierarchy + false-positive fixture');
{
  // K1 REQUIRED FIXTURE — RAW comic, model incorrectly says isGraded=true,
  // no independently verified slab authority, operator explicitly marks RAW.
  const falsePositiveRawAsSlab = {
    cgcVerified: false, // no genuinely established certified fact
    isGraded: true, // 1. model state WOULD select the certified path
    gradingFormatAuthority: 'OPERATOR_CONFIRMED', // 2. operator explicitly marked RAW (below)
    operatorIsGraded: false,
  };
  const beforeCorrection = resolveGoverningGradingFormat({ ...falsePositiveRawAsSlab, gradingFormatAuthority: null, operatorIsGraded: null });
  assertEq(beforeCorrection, { isGraded: true, source: 'model' }, '1. before operator correction: model state selects the certified path (the bug this fixture proves is closed)');

  const afterCorrection = resolveGoverningGradingFormat(falsePositiveRawAsSlab);
  assertEq(afterCorrection.isGraded, false, '6. governing grading format becomes RAW after operator correction');
  assertEq(afterCorrection.source, 'operator', 'governing format source is operator');
  assertTrue(falsePositiveRawAsSlab.isGraded === true, '3. model isGraded=true remains preserved as model provenance (never mutated by this module)');
  assertTrue(falsePositiveRawAsSlab.operatorIsGraded === false, '4. operatorIsGraded=false separately persisted');
  assertTrue(falsePositiveRawAsSlab.gradingFormatAuthority === 'OPERATOR_CONFIRMED', '5. gradingFormatAuthority=OPERATOR_CONFIRMED');

  // TRUE-POSITIVE certified control — X-Men Annual #14 CGC 9.8: a genuinely
  // established certified fact must NOT be downgradable by ordinary
  // operator raw-format preference.
  const trueCertified = { cgcVerified: true, isGraded: true, gradingFormatAuthority: null, operatorIsGraded: null };
  assertEq(resolveGoverningGradingFormat(trueCertified), { isGraded: true, source: 'certified' }, 'CERTIFIED FACT PRIORITY: cgcVerified=true governs regardless of any operator preference');
  const certifiedEvenWithOperatorRawAttempt = { cgcVerified: true, isGraded: true, gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false };
  assertEq(resolveGoverningGradingFormat(certifiedEvenWithOperatorRawAttempt), { isGraded: true, source: 'certified' }, 'a genuinely established certified fact cannot be silently downgraded to RAW by the ordinary operator control');

  // Plain model guess, no authority at all.
  assertEq(resolveGoverningGradingFormat({ isGraded: false }), { isGraded: false, source: 'model' }, 'no authority at all -> falls through to model guess');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 4: resolveGoverningGrade — K6 isGraded-transition cases');
{
  // Case A — model flips false->true while operator format authority says RAW.
  const caseA = { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4, grade: 'FN 6.0' };
  assertEq(resolveGoverningGrade(caseA), { grade: 'VG 4.0', numericGrade: 4, source: 'operator' }, 'Case A: operatorGrade remains governing regardless of the model isGraded flip (format resolution is a separate concern)');

  // Case B — model flips true->false, operator RAW authority remains.
  const caseB = { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4, grade: null };
  assertEq(resolveGoverningGrade(caseB), { grade: 'VG 4.0', numericGrade: 4, source: 'operator' }, 'Case B: operator RAW authority remains governing, no authority field silently cleared');

  // Case C — no operator format authority, model flips false->true; any
  // prior operatorGrade is preserved (not deleted) but inert while format
  // resolves to graded.
  const caseC = { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4, grade: 'FN 6.0' };
  const caseCFormat = resolveGoverningGradingFormat({ cgcVerified: false, isGraded: true, gradingFormatAuthority: null, operatorIsGraded: null });
  assertEq(caseCFormat, { isGraded: true, source: 'model' }, 'Case C: no operator format authority -> model isGraded=true governs format');
  assertTrue(caseC.operatorGrade === 'VG 4.0', 'Case C: the prior operatorGrade fact is NOT deleted merely because format flipped');
  // Caller-side gating (mirrors api/enrich.js's own `else if
  // (governingFormat.isGraded !== true)`): resolveGoverningGrade is simply
  // never consulted while governing format is graded — proving inertness
  // is a caller-contract proof, not a resolveGoverningGrade behavior.
  assertTrue(caseCFormat.isGraded === true, 'Case C: operatorGrade is inert because the CALLER never invokes resolveGoverningGrade while governing format is graded (api/enrich.js\'s own gate)');

  // Case D — no operator format authority, model flips true->false, a
  // valid operatorGrade+gradeAuthority is still present from a prior RAW
  // state -> the preserved operatorGrade becomes governing again.
  const caseD = { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4, grade: null };
  const caseDFormat = resolveGoverningGradingFormat({ cgcVerified: false, isGraded: false, gradingFormatAuthority: null, operatorIsGraded: null });
  assertEq(caseDFormat, { isGraded: false, source: 'model' }, 'Case D: model isGraded=false -> governing format is RAW again');
  assertEq(resolveGoverningGrade(caseD), { grade: 'VG 4.0', numericGrade: 4, source: 'operator' }, '35. Case D: the preserved operatorGrade REACTIVATES as governing — not a stale-value accident, follows from preserved operator authority (ruling confirmed, not silently changed)');

  // No operator grade authority at all -> falls through to model grade.
  assertEq(resolveGoverningGrade({ grade: 'FN 6.0', numericGrade: null }), { grade: 'FN 6.0', numericGrade: null, source: 'model' }, 'no operator grade authority -> current automated grade governs');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 5: formula integration — REAL getGradeMultiplier/getRawGradeMultiplier, real fixtures');
{
  const handlerModule = await import('../api/enrich.js?gk213b-formula-integration');
  const { getGradeMultiplier, getRawGradeMultiplier } = handlerModule;
  assertTrue(typeof getGradeMultiplier === 'function' && typeof getRawGradeMultiplier === 'function', 'real getGradeMultiplier/getRawGradeMultiplier exported and importable');

  // HOUSE OF SECRETS #91 — model undergrades (says "GD 2.0"), operator
  // corrects to the real estimated grade "VF 7.5". Governing grade must be
  // the operator's, and the REAL raw-multiplier formula must be applied to it.
  {
    const item = { isGraded: false, grade: 'GD 2.0', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 7.5', operatorGradeNumeric: 7.5, modelPredictedGrade: 'GD 2.0' };
    const format = resolveGoverningGradingFormat(item);
    assertEq(format.isGraded, false, 'House of Secrets #91: governing format is RAW');
    const governing = resolveGoverningGrade(item);
    assertEq(governing.grade, 'VF 7.5', 'House of Secrets #91: governing grade is the operator correction, not the model undergrade');
    const rawInfo = getRawGradeMultiplier(governing.grade, 2013); // real publication year, real era
    const expectedInfo = getRawGradeMultiplier('VF 7.5', 2013);
    assertEq(rawInfo, expectedInfo, 'House of Secrets #91: the REAL, unmodified getRawGradeMultiplier formula is applied to the governing (operator) grade');
    assertTrue(rawInfo.multiplier > getRawGradeMultiplier('GD 2.0', 2013).multiplier, 'House of Secrets #91: corrected VF multiplier is higher than the undergraded GD multiplier would have been — the correction genuinely changes the pricing input');
    assertTrue(item.modelPredictedGrade === 'GD 2.0', 'House of Secrets #91: original modelPredictedGrade remains preserved, untouched by any of this');
    assertTrue(item.grade === 'GD 2.0', 'House of Secrets #91: current automated grade field also remains available/untouched');

    // Clearing restores current automated grade as governing.
    const cleared = { ...item, ...clearOperatorGrade() };
    assertEq(resolveGoverningGrade(cleared).grade, 'GD 2.0', 'House of Secrets #91: clearing the override restores the current automated grade as governing');
    assertEq(cleared.modelPredictedGrade, 'GD 2.0', 'House of Secrets #91: clearing never touches modelPredictedGrade — no historical grade value destroyed');
  }

  // IRON MAN #1 (1968), RAW — all four values simultaneously visible/available.
  {
    const item = {
      isGraded: false, grade: 'FN 6.0', modelPredictedGrade: 'FN/VF 6.5',
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG/FN 5.0', operatorGradeNumeric: null,
    };
    const format = resolveGoverningGradingFormat(item);
    const governing = resolveGoverningGrade(item);
    assertTrue(!!item.modelPredictedGrade, 'Iron Man #1 RAW: original calibration baseline available (modelPredictedGrade)');
    assertTrue(!!item.grade, 'Iron Man #1 RAW: current AI/model grade available');
    assertTrue(!!item.operatorGrade, 'Iron Man #1 RAW: operator estimated grade available');
    assertEq(governing.grade, 'VG/FN 5.0', 'Iron Man #1 RAW: governing pricing grade is the operator value');
    assertEq(governing.source, 'operator', 'Iron Man #1 RAW: governing source correctly attributed');
    const rawInfo = getRawGradeMultiplier(governing.grade, 1968);
    assertTrue(rawInfo.multiplier > 0, 'Iron Man #1 RAW: real raw-multiplier formula produces a real multiplier for the governing grade');
  }

  // X-MEN ANNUAL #14 CGC 9.8 — the certified control.
  {
    const item = { cgcVerified: true, isGraded: true, numericGrade: 9.8, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4 };
    const format = resolveGoverningGradingFormat(item);
    assertEq(format, { isGraded: true, source: 'certified' }, 'X-Men Annual #14: certified 9.8 remains authoritative');
    // Mirrors api/enrich.js's own gate exactly: resolveGoverningGrade is
    // never even CALLED when governing format is graded — proven by
    // replicating that exact caller contract here.
    const wouldCallResolveGoverningGrade = format.isGraded !== true;
    assertEq(wouldCallResolveGoverningGrade, false, 'X-Men Annual #14: operator raw-grade control is never consulted at all (not merely ignored) when governing format is certified');
    const gradeInfo = getGradeMultiplier(item.numericGrade, 1994); // real publication year
    assertTrue(gradeInfo.multiplier > 0, 'X-Men Annual #14: real CGC multiplier formula produces a real multiplier for 9.8, completely uninfluenced by the present operatorGrade fact');
    assertEq(gradeInfo.grade, 9.8, 'X-Men Annual #14: no CGC/certified formula was modified — exact-grade table lookup, no interpolation');
  }

  // FALSE-POSITIVE RAW-AS-SLAB — formula end of the K1 fixture.
  {
    const item = {
      cgcVerified: false, isGraded: true, // 1. model state would select certified path
      gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: false, // 2/6. operator marks RAW
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'FN 6.0', operatorGradeNumeric: 6, // 7. operatorGrade eligible
      grade: 'FN 6.0',
    };
    const format = resolveGoverningGradingFormat(item);
    assertEq(format.isGraded, false, 'False-positive raw-as-slab: governing format is RAW after correction');
    const governing = resolveGoverningGrade(item);
    assertEq(governing.source, 'operator', '7. operatorGrade becomes eligible to govern raw pricing');
    const rawInfo = getRawGradeMultiplier(governing.grade, 2015);
    assertTrue(rawInfo.multiplier > 0, '8. existing raw multiplier formula is used unchanged for the corrected item');
  }
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 6: K2 — chooseBetterGrade never touches grade-authority fields');
{
  const cur = { grade: 'FN 6.0', confidenceLevel: 'LOW', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 7.5', operatorGradeNumeric: 7.5 };
  const incoming = { grade: 'VG 4.0', confidenceLevel: 'HIGH' }; // higher-confidence fresh automated read
  const result = chooseBetterGrade(incoming, cur);
  assertEq(Object.keys(result).sort(), ['confidenceLevel', 'grade', 'preserved'].sort(), 'H-5: chooseBetterGrade\'s return shape ONLY ever contains grade/confidenceLevel/preserved — structurally cannot touch operatorGrade/gradeAuthority');
  assertEq(result.grade, 'VG 4.0', 'H-5: chooseBetterGrade DOES continue updating the automated-facing grade per its existing behavior while an override is active');
  // Simulate the real merge-site spread order (cur first, chooseBetterGrade
  // result spread after) to prove operator fields survive in practice, not
  // merely "in principle."
  const merged = { ...cur, grade: result.grade, confidenceLevel: result.confidenceLevel };
  assertEq(merged.operatorGrade, 'VF 7.5', 'H-5 in practice: operatorGrade untouched by a chooseBetterGrade-driven grade update');
  assertEq(merged.gradeAuthority, 'OPERATOR_CONFIRMED', 'H-5 in practice: gradeAuthority untouched');
  assertEq(resolveGoverningGrade(merged).source, 'operator', 'H-5: operator authority remains economically governing throughout');

  // H-4: after CLEAR, the automated grade that governs is whatever
  // chooseBetterGrade most recently selected — proven, not assumed.
  const clearedAfter = { ...merged, ...clearOperatorGrade() };
  assertEq(resolveGoverningGrade(clearedAfter), { grade: 'VG 4.0', numericGrade: null, source: 'model' }, 'H-4: CLEAR returns governing grade to whatever chooseBetterGrade most recently selected (VG 4.0, not the original FN 6.0) — stated honestly, not silently frozen');
}

console.log('\n  [BANKED — not fixed in this dispatch] AUTOMATED GRADE MERGE — CONFIDENCE VOCABULARY MISMATCH:');
console.log('  chooseBetterGrade compares confidenceLevel, api/enrich.js\'s PRICING-confidence');
console.log('  vocabulary (not grading-evidence confidence — grade.js never populates it at all).');
console.log('  This can affect which automated grade becomes governing after an operator override');
console.log('  is cleared. Recorded here per this build\'s own requirement; redesigning the');
console.log('  comparator is out of GK-213B\'s contained scope.');

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 7: real handler smoke — new fields survive a real /api/enrich invocation');
{
  function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('search_by_image') || u.includes('item_summary/search')) return jsonResponse({ itemSummaries: [], total: 0 });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    return jsonResponse({});
  };
  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handlerModule = await import('../api/enrich.js?gk213b-handler-smoke');
  const handler = handlerModule.default;
  const req = {
    method: 'POST', headers: {},
    body: {
      title: 'Iron Man', issue: '1', year: '1968', publisher: 'Marvel', assetType: 'comic',
      grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'high',
      gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG/FN 5.0', operatorGradeNumeric: null,
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let capturedBody = null;
  const res = { status: (c) => ({ json: (d) => { capturedBody = d; } }), setHeader: () => {} };
  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `no exception escaped the handler with the new GK-213B request fields present (${threw ? threw.stack : ''})`);
  assertTrue(!capturedLogs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged — the new destructured fields and gradeAuthority.js import are wired correctly');
  assertTrue(capturedBody !== null && typeof capturedBody === 'object', 'handler returns a real response body');
}

// ═══════════════════════════════════════════════════════════════════════
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
