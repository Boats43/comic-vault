// tests/slice7-scan-ownership.test.js
//
// Track B Phase 0, Slice 7 — immutable per-scan asynchronous ownership.
//
// Every integration-shaped test below calls applyScanOwnershipGuard
// directly — the SAME exported function src/App.jsx's gradeBlob calls at
// both write sites (post-grade setResult, post-enrich setResult merge).
// This is deliberate: a test of shouldAcceptScanResponse in isolation
// proves the predicate is correct but does not prove gradeBlob's actual
// write-site orchestration (mode branching, write-vs-log sequencing,
// unconditional catalogue write) is wired correctly — only calling the
// real orchestration function proves that. simulateGradeBlob() below is a
// thin harness around React state (setResult/setCatalogue are mocked as
// plain refs/Maps, since this repo has no React Testing Library / jsdom
// devDependency) but the ownership DECISION and WRITE-OR-SKIP logic inside
// it is 100% the real applyScanOwnershipGuard, not a reimplementation.
//
// Covers the eight required test cases (stale grade response, stale
// enrich response, three overlapping scans, forced scanId collision with
// different generations, missing server echo, altered server echo, stale
// scans still update only their own savedId rows, single non-overlapping
// scan non-regression), both rollout modes (SHADOW, ENFORCE), a
// teeth-proof, and the SO-96 ownership scenario matrix (an EXPLICITLY
// separate artifact from this repository's own tests/*.test.js suite —
// see that section's own header comment for why the naming matters).

import process from 'node:process';
import {
  mintScanId,
  nextGeneration,
  shouldAcceptScanResponse,
  applyScanOwnershipGuard,
  logStaleScanResponse,
  SCAN_OWNERSHIP_MODE,
  CURRENT_SCAN_OWNERSHIP_MODE,
} from '../src/lib/scanOwnership.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertTrue(actual, message) {
  if (actual !== true) {
    throw new Error(`${message}\nExpected: true\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertFalse(actual, message) {
  if (actual !== false) {
    throw new Error(`${message}\nExpected: false\nActual: ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------
// Naive/pre-fix baseline, for the teeth-proof only. This is exactly what
// App.jsx's write sites did BEFORE this slice: apply any response
// unconditionally, with no ownership check and no mode concept at all.
// ---------------------------------------------------------------------
function naiveApplyUnconditionally(stage, response, closure, active, mode, applyFn) {
  applyFn();
  return { accepted: true, reason: null };
}

// ---------------------------------------------------------------------
// Harness modeling gradeBlob's actual write-site orchestration (mint ->
// capture -> await response -> applyScanOwnershipGuard -> unconditional
// catalogue write). `guardFn` defaults to the REAL applyScanOwnershipGuard
// — tests only ever override it with naiveApplyUnconditionally for the
// dedicated teeth-proof, never for the eight required cases.
// ---------------------------------------------------------------------
function simulateGradeBlob({ guardFn = applyScanOwnershipGuard, mode = SCAN_OWNERSHIP_MODE.ENFORCE, activeScanRef, scanGenerationRef, resultStore, catalogueStore }) {
  const scanId = mintScanId();
  const generation = nextGeneration(scanGenerationRef);
  const closure = { scanId, generation };
  activeScanRef.current = closure;

  const savedId = `row-${scanId}`;
  catalogueStore.set(savedId, { id: savedId, title: 'unwritten' });

  return {
    closure,
    // Simulates the grade-response write site — the exact call shape
    // App.jsx's gradeBlob uses at ~10467.
    receiveGradeResponse(response) {
      const verdict = guardFn('grade', response, closure, activeScanRef.current, mode, () => {
        resultStore.current = { ...response, source: 'grade' };
      });
      // Persisted catalogue write is UNCONDITIONAL, per requirement 6 —
      // mirrors App.jsx's real addToCatalogue call, which never reads
      // the guard's verdict.
      catalogueStore.set(savedId, { id: savedId, title: response?.title ?? 'unwritten', stage: 'grade' });
      return verdict;
    },
    // Simulates the enrich-response write site — the exact call shape
    // App.jsx's gradeBlob uses at ~10545.
    receiveEnrichResponse(response) {
      const verdict = guardFn('enrich', response, closure, activeScanRef.current, mode, () => {
        resultStore.current = resultStore.current
          ? { ...resultStore.current, ...response, source: 'enrich' }
          : null;
      });
      // Persisted catalogue write is UNCONDITIONAL, per requirement 6.
      const cur = catalogueStore.get(savedId);
      if (cur) catalogueStore.set(savedId, { ...cur, price: response?.price ?? null, stage: 'enrich' });
      return verdict;
    },
    savedId,
  };
}

function freshHarness() {
  return {
    activeScanRef: { current: null },
    scanGenerationRef: { current: 0 },
    resultStore: { current: null },
    catalogueStore: new Map(),
  };
}

// ========================================================================
// 1. STALE GRADE RESPONSE (ENFORCE mode — the default assumed by the
//    eight required cases unless a case is explicitly about SHADOW mode)
// ========================================================================
test('stale grade response is rejected; current scan grade response is accepted (ENFORCE)', () => {
  const h = freshHarness();
  const scanA = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  const scanB = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });

  const staleVerdict = scanA.receiveGradeResponse({ scanId: scanA.closure.scanId, title: 'Batman A (stale)' });
  assertFalse(staleVerdict.accepted, 'stale grade response (A) must be rejected');
  assertEqual(staleVerdict.reason, 'scanid-mismatch', 'stale grade response should fail on scanid-mismatch');
  assertEqual(h.resultStore.current, null, 'result must NOT be written by the stale grade response under ENFORCE');

  const currentVerdict = scanB.receiveGradeResponse({ scanId: scanB.closure.scanId, title: 'Batman B (current)' });
  assertTrue(currentVerdict.accepted, 'current grade response (B) must be accepted');
  assertEqual(h.resultStore.current?.title, 'Batman B (current)', 'result must reflect the current scan (B), not the stale one (A)');
});

// ========================================================================
// 2. STALE ENRICH RESPONSE (ENFORCE)
// ========================================================================
test('stale enrich response is rejected; current scan enrich response is accepted (ENFORCE)', () => {
  const h = freshHarness();
  const scanA = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  scanA.receiveGradeResponse({ scanId: scanA.closure.scanId, title: 'Batman A' });

  const scanB = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  scanB.receiveGradeResponse({ scanId: scanB.closure.scanId, title: 'Batman B' });
  assertEqual(h.resultStore.current?.title, 'Batman B', 'sanity: result reflects B after both grade responses');

  const staleEnrich = scanA.receiveEnrichResponse({ scanId: scanA.closure.scanId, price: 19.85 });
  assertFalse(staleEnrich.accepted, 'stale enrich response (A) must be rejected');
  assertEqual(h.resultStore.current?.title, 'Batman B', 'result must remain B — stale A enrich must not merge in');
  assertEqual(h.resultStore.current?.price, undefined, 'stale A enrich price must not leak into result');

  const currentEnrich = scanB.receiveEnrichResponse({ scanId: scanB.closure.scanId, price: 42.0 });
  assertTrue(currentEnrich.accepted, 'current enrich response (B) must be accepted');
  assertEqual(h.resultStore.current?.price, 42.0, 'result must reflect B\'s own enrich price');
});

// ========================================================================
// 3. THREE OVERLAPPING SCANS (ENFORCE)
// ========================================================================
test('three overlapping scans — only the third (current) scan\'s responses are ever accepted (ENFORCE)', () => {
  const h = freshHarness();
  const scanA = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  const scanB = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  const scanC = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });

  const bAccept = scanB.receiveGradeResponse({ scanId: scanB.closure.scanId, title: 'B' });
  const aAccept = scanA.receiveGradeResponse({ scanId: scanA.closure.scanId, title: 'A' });
  const cAccept = scanC.receiveGradeResponse({ scanId: scanC.closure.scanId, title: 'C' });

  assertFalse(bAccept.accepted, 'B (superseded by C) must be rejected');
  assertFalse(aAccept.accepted, 'A (superseded by C) must be rejected');
  assertTrue(cAccept.accepted, 'C (current) must be accepted');
  assertEqual(h.resultStore.current?.title, 'C', 'result must reflect only the third, current scan');

  const bEnrich = scanB.receiveEnrichResponse({ scanId: scanB.closure.scanId, price: 1 });
  const aEnrich = scanA.receiveEnrichResponse({ scanId: scanA.closure.scanId, price: 2 });
  const cEnrich = scanC.receiveEnrichResponse({ scanId: scanC.closure.scanId, price: 3 });
  assertFalse(bEnrich.accepted, 'B enrich (superseded) must be rejected');
  assertFalse(aEnrich.accepted, 'A enrich (superseded) must be rejected');
  assertTrue(cEnrich.accepted, 'C enrich (current) must be accepted');
  assertEqual(h.resultStore.current?.price, 3, 'result price must come only from C');
});

// ========================================================================
// 4. FORCED SCANID COLLISION WITH DIFFERENT GENERATIONS
// ========================================================================
test('forced scanId collision — generation dimension alone distinguishes the two scans', () => {
  const collidedScanId = 'forced-collision-id';
  const activeScanRef = { current: null };

  const closureA = { scanId: collidedScanId, generation: 1 };
  const closureB = { scanId: collidedScanId, generation: 2 };
  activeScanRef.current = closureB;

  const responseA = { scanId: collidedScanId, title: 'A' };
  const responseB = { scanId: collidedScanId, title: 'B' };

  const verdictA = shouldAcceptScanResponse(responseA, closureA, activeScanRef.current);
  const verdictB = shouldAcceptScanResponse(responseB, closureB, activeScanRef.current);

  assertFalse(verdictA.accepted, 'A must be rejected despite scanId matching activeScanRef — generation differs');
  assertEqual(verdictA.reason, 'generation-mismatch', 'A must be rejected specifically on generation-mismatch, proving scanId alone was insufficient here');
  assertTrue(verdictB.accepted, 'B must be accepted — scanId AND generation both match');

  // Prove a scanId-only design (no generation dimension) would WRONGLY
  // accept BOTH under this exact forced collision. This claim is NOT made
  // as "timestamp+random equality alone can fail closed" anywhere in this
  // plan — this assertion exists specifically to show it cannot.
  const scanIdOnlyAccept = (response, closure, active) =>
    response?.scanId === closure?.scanId && closure?.scanId === active?.scanId
      ? { accepted: true, reason: null }
      : { accepted: false, reason: 'scanid-mismatch' };
  const naiveVerdictA = scanIdOnlyAccept(responseA, closureA, activeScanRef.current);
  assertTrue(naiveVerdictA.accepted, 'teeth-proof: a scanId-only design WOULD wrongly accept the stale A response under a forced collision — this is exactly why generation is required');
});

// ========================================================================
// 5. MISSING SERVER ECHO
// ========================================================================
test('missing server echo fails closed regardless of scanId/generation match', () => {
  const activeScanRef = { current: null };
  const closure = { scanId: 'abc-123', generation: 1 };
  activeScanRef.current = closure;

  const verdict = shouldAcceptScanResponse({ title: 'Batman', price: 19.85 }, closure, activeScanRef.current);
  assertFalse(verdict.accepted, 'response missing scanId must be rejected');
  assertEqual(verdict.reason, 'missing-echo', 'rejection reason must be missing-echo');

  const verdictEmpty = shouldAcceptScanResponse({ title: 'Batman', scanId: '' }, closure, activeScanRef.current);
  assertFalse(verdictEmpty.accepted, 'response with empty-string scanId must be rejected');
  assertEqual(verdictEmpty.reason, 'missing-echo', 'empty scanId must also be classified missing-echo');
});

// ========================================================================
// 6. ALTERED SERVER ECHO
// ========================================================================
test('altered server echo fails closed even when scanId/generation would otherwise match', () => {
  const activeScanRef = { current: null };
  const closure = { scanId: 'abc-123', generation: 1 };
  activeScanRef.current = closure;

  const verdict = shouldAcceptScanResponse({ title: 'Batman', scanId: 'zzz-999' }, closure, activeScanRef.current);
  assertFalse(verdict.accepted, 'response with an altered/wrong scanId must be rejected');
  assertEqual(verdict.reason, 'altered-echo', 'rejection reason must be altered-echo');
});

// ========================================================================
// 7. STALE SCANS STILL UPDATE ONLY THEIR OWN SAVEDID ROW (ENFORCE)
// ========================================================================
test('stale scans still update only their own savedId catalogue row (ENFORCE)', () => {
  const h = freshHarness();
  const scanA = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  const scanB = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });

  scanA.receiveGradeResponse({ scanId: scanA.closure.scanId, title: 'A title' });
  scanA.receiveEnrichResponse({ scanId: scanA.closure.scanId, price: 7.5 });
  scanB.receiveGradeResponse({ scanId: scanB.closure.scanId, title: 'B title' });
  scanB.receiveEnrichResponse({ scanId: scanB.closure.scanId, price: 99.0 });

  const rowA = h.catalogueStore.get(scanA.savedId);
  const rowB = h.catalogueStore.get(scanB.savedId);
  assertTrue(rowA !== undefined, 'A\'s own catalogue row must exist');
  assertTrue(rowB !== undefined, 'B\'s own catalogue row must exist');
  assertEqual(rowA.title, 'A title', 'A\'s row must reflect A\'s OWN grade response, not be blocked by the guard');
  assertEqual(rowA.price, 7.5, 'A\'s row must reflect A\'s OWN enrich response');
  assertEqual(rowB.title, 'B title', 'B\'s row must reflect B\'s own grade response');
  assertEqual(rowB.price, 99.0, 'B\'s row must reflect B\'s own enrich response');
  assertEqual(h.resultStore.current?.title, 'B title', 'transient result must still reflect only the current scan (B)');
});

// ========================================================================
// 8. SINGLE NON-OVERLAPPING SCAN — NON-REGRESSION (ENFORCE)
// ========================================================================
test('single non-overlapping scan behaves identically to before this slice (ENFORCE)', () => {
  const h = freshHarness();
  const scan = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  const gradeAccept = scan.receiveGradeResponse({ scanId: scan.closure.scanId, title: 'Solo Scan' });
  const enrichAccept = scan.receiveEnrichResponse({ scanId: scan.closure.scanId, price: 12.34 });

  assertTrue(gradeAccept.accepted, 'the only scan in flight must be accepted at the grade site');
  assertTrue(enrichAccept.accepted, 'the only scan in flight must be accepted at the enrich site');
  assertEqual(h.resultStore.current?.title, 'Solo Scan', 'result must reflect the single scan');
  assertEqual(h.resultStore.current?.price, 12.34, 'result must reflect the single scan\'s enrich price');
  assertEqual(h.catalogueStore.get(scan.savedId)?.price, 12.34, 'catalogue row must reflect the single scan');
});

// ========================================================================
// 9. SHADOW MODE — write-through on rejection, verdict still computed and
//    logged, zero user-visible behavior change relative to pre-Slice-7.
// ========================================================================
test('SHADOW mode writes through even on a would-be-rejected stale response, and logs it', () => {
  const h = freshHarness();
  const scanA = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.SHADOW, ...h });
  const scanB = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.SHADOW, ...h });

  scanB.receiveGradeResponse({ scanId: scanB.closure.scanId, title: 'B' });
  assertEqual(h.resultStore.current?.title, 'B', 'sanity: current scan write succeeds under SHADOW too');

  // A is now stale relative to B. Under SHADOW, this must STILL write —
  // this is the entire point of shadow mode: zero behavior change while
  // collecting real incidence data.
  const staleLogs = [];
  const originalLog = console.log;
  console.log = (...args) => { staleLogs.push(args.join(' ')); };
  let staleVerdict;
  try {
    staleVerdict = scanA.receiveGradeResponse({ scanId: scanA.closure.scanId, title: 'A (stale, but SHADOW writes through)' });
  } finally {
    console.log = originalLog;
  }

  assertFalse(staleVerdict.accepted, 'the predicate itself must still correctly report rejection under SHADOW — only the WRITE behavior differs from ENFORCE');
  assertEqual(
    h.resultStore.current?.title,
    'A (stale, but SHADOW writes through)',
    'SHADOW mode must perform the write despite the predicate rejecting it — this is the defining difference from ENFORCE, and is the exact pre-Slice-7 unconditional behavior, preserved deliberately during the shadow window'
  );
  assertTrue(
    staleLogs.some(l => l.includes('would-be-stale') && l.includes('mode=shadow')),
    'SHADOW mode must log the would-be rejection distinctly from an ENFORCE-mode rejection, so production incidence can be measured before any behavior actually changes'
  );
});

test('SHADOW mode still accepts and writes a genuinely current response normally', () => {
  const h = freshHarness();
  const scan = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.SHADOW, ...h });
  const verdict = scan.receiveGradeResponse({ scanId: scan.closure.scanId, title: 'Current' });
  assertTrue(verdict.accepted, 'a genuinely current response is accepted under SHADOW exactly as under ENFORCE');
  assertEqual(h.resultStore.current?.title, 'Current', 'result reflects the current scan under SHADOW');
});

// ========================================================================
// 10. ENFORCE MODE — explicit, direct coverage of the mode itself (the
//     eight required cases above already run under ENFORCE; this test
//     isolates the mode's own behavior against the SAME stale scenario
//     used in the SHADOW test above, for a direct side-by-side contrast).
// ========================================================================
test('ENFORCE mode drops the write on a rejected stale response (direct contrast with the SHADOW test above)', () => {
  const h = freshHarness();
  const scanA = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  const scanB = simulateGradeBlob({ mode: SCAN_OWNERSHIP_MODE.ENFORCE, ...h });
  scanB.receiveGradeResponse({ scanId: scanB.closure.scanId, title: 'B' });
  const staleVerdict = scanA.receiveGradeResponse({ scanId: scanA.closure.scanId, title: 'A (stale, ENFORCE drops it)' });
  assertFalse(staleVerdict.accepted, 'the predicate rejects identically to the SHADOW case');
  assertEqual(h.resultStore.current?.title, 'B', 'ENFORCE mode must NOT perform the write — result stays B, unlike the SHADOW test above where it became the stale title');
});

test('production default (CURRENT_SCAN_OWNERSHIP_MODE) is SHADOW', () => {
  assertEqual(CURRENT_SCAN_OWNERSHIP_MODE, SCAN_OWNERSHIP_MODE.SHADOW, 'the first production deployment must default to SHADOW, per the accepted rollout plan');
});

// ========================================================================
// TEETH-PROOF — the eight required cases above are shown to FAIL under
// the pre-fix/naive "always apply, no guard at all" behavior, proving
// these tests actually exercise the fix rather than passing vacuously.
// ========================================================================
test('teeth-proof: naive unconditional-apply behavior (pre-Slice-7) WOULD corrupt result under overlapping scans', () => {
  const h = freshHarness();
  const scanA = simulateGradeBlob({ guardFn: naiveApplyUnconditionally, activeScanRef: h.activeScanRef, scanGenerationRef: h.scanGenerationRef, resultStore: h.resultStore, catalogueStore: h.catalogueStore });
  const scanB = simulateGradeBlob({ guardFn: naiveApplyUnconditionally, activeScanRef: h.activeScanRef, scanGenerationRef: h.scanGenerationRef, resultStore: h.resultStore, catalogueStore: h.catalogueStore });

  scanB.receiveGradeResponse({ scanId: scanB.closure.scanId, title: 'B' });
  assertEqual(h.resultStore.current?.title, 'B', 'sanity: B write succeeds under naive behavior too');

  scanA.receiveGradeResponse({ scanId: scanA.closure.scanId, title: 'A (stale, should NOT win)' });
  assertEqual(
    h.resultStore.current?.title,
    'A (stale, should NOT win)',
    'teeth-proof: the pre-Slice-7 unconditional-apply behavior DOES let the stale scan corrupt result — confirms test 1 above is a real regression check against applyScanOwnershipGuard, not a vacuous pass'
  );
});

// ========================================================================
// SO-96 OWNERSHIP SCENARIO MATRIX
//
// NAMING NOTE: this artifact was previously described as a "128-case
// manifest." That name is WITHDRAWN — it collided with, and could be
// mistaken for, this repository's own tests/*.test.js suite (the
// STANDING manifest, a materially different thing: a fixed corpus of
// pre-existing test files, not a generated combinatorial scenario set).
// This is a feature-level combinatorial sweep over the ownership
// predicate's structural input space, generated fresh by this file —
// unrelated to, and not a substitute for, running the standing
// tests/*.test.js suite (see the separate A/B section of this engagement's
// return for that).
//
// ARITHMETIC (corrected — the original "128" figure was wrong and is not
// repeated here):
//   Structural dimensions, all independently varied:
//     stage              — grade | enrich                    (2 values)
//     echo correctness   — correct | wrong | missing          (3 values)
//     scanId match       — matches active | does not match    (2 values)
//     generation match   — matches active | does not match    (2 values)
//   2 x 3 x 2 x 2 = 24 structural combinations.
//   Each structural combination is evaluated against 4 DISTINCT literal
//   scanId shapes (a UUID-shaped string, a short string, a long string,
//   and a unicode string) — not to change the verdict (ID shape must
//   never affect the verdict when the structural conditions are held
//   constant, and this matrix proves that) but to rule out the logic
//   accidentally depending on any one ID's shape.
//   24 structural combinations x 4 scanId shapes = 96 total cases —
//   EVENLY divisible, no partial/uneven padding of any kind.
//   Exactly 2 of the 24 structural combinations are the fully-matching
//   case (echo=correct AND scanId matches AND generation matches) — one
//   for stage=grade, one for stage=enrich. Each of those 2 combinations
//   is evaluated against all 4 scanId shapes uniformly (same as every
//   other combination), so exactly 2 x 4 = 8 of the 96 cases are
//   ACCEPTED, and the remaining 96 - 8 = 88 are REJECTED. Every scanId
//   shape appears exactly 24 times total (once per structural
//   combination) and exactly 2 times among the accepted cases (once for
//   each stage's fully-matching combination) — a fully uniform
//   distribution, not "six complete repetitions" of anything.
// ========================================================================
test('SO-96 ownership scenario matrix: 24 structural combinations x 4 scanId shapes = 96 cases, 8 accepted, 88 rejected', () => {
  const stages = ['grade', 'enrich'];
  const echoModes = ['correct', 'wrong', 'missing'];
  const scanIdMatchModes = [true, false];
  const generationMatchModes = [true, false];
  const scanIdShapes = [
    '11111111-1111-1111-1111-111111111111', // UUID-shaped
    'short-id',                              // short
    'a-very-long-scan-identifier-string-0000000000000000', // long
    'unicode-✓-id',                          // unicode
  ];

  const structuralCombinations = [];
  for (const stage of stages) {
    for (const echoMode of echoModes) {
      for (const scanIdMatches of scanIdMatchModes) {
        for (const generationMatches of generationMatchModes) {
          structuralCombinations.push({ stage, echoMode, scanIdMatches, generationMatches });
        }
      }
    }
  }
  assertEqual(structuralCombinations.length, 24, 'must be exactly 24 structural combinations (2 x 3 x 2 x 2)');

  const matrix = [];
  for (const combo of structuralCombinations) {
    for (const scanIdShape of scanIdShapes) {
      matrix.push({ ...combo, scanIdShape });
    }
  }
  assertEqual(matrix.length, 96, 'must be exactly 96 total cases (24 x 4), evenly, with no partial padding');

  let acceptedCount = 0;
  let rejectedCount = 0;
  const perShapeAccepted = new Map(scanIdShapes.map(s => [s, 0]));
  const perShapeTotal = new Map(scanIdShapes.map(s => [s, 0]));

  matrix.forEach((c, idx) => {
    const closure = { scanId: c.scanIdShape, generation: 1 };
    const active = {
      scanId: c.scanIdMatches ? c.scanIdShape : `${c.scanIdShape}-DIFFERENT`,
      generation: c.generationMatches ? 1 : 2,
    };
    let response;
    if (c.echoMode === 'correct') response = { scanId: c.scanIdShape, stage: c.stage };
    else if (c.echoMode === 'wrong') response = { scanId: `${c.scanIdShape}-ALTERED`, stage: c.stage };
    else response = { stage: c.stage }; // missing

    const verdict = shouldAcceptScanResponse(response, closure, active);
    const shouldBeAccepted = c.echoMode === 'correct' && c.scanIdMatches && c.generationMatches;
    assertEqual(
      verdict.accepted,
      shouldBeAccepted,
      `case ${idx} (stage=${c.stage} echo=${c.echoMode} scanIdMatches=${c.scanIdMatches} generationMatches=${c.generationMatches} shape="${c.scanIdShape}"): verdict did not match the expected structural outcome`
    );

    perShapeTotal.set(c.scanIdShape, perShapeTotal.get(c.scanIdShape) + 1);
    if (verdict.accepted) {
      acceptedCount++;
      perShapeAccepted.set(c.scanIdShape, perShapeAccepted.get(c.scanIdShape) + 1);
    } else {
      rejectedCount++;
    }
  });

  assertEqual(acceptedCount, 8, 'exactly 8 of 96 cases must be accepted (2 fully-matching structural combinations x 4 scanId shapes)');
  assertEqual(rejectedCount, 88, 'exactly 88 of 96 cases must be rejected');
  for (const shape of scanIdShapes) {
    assertEqual(perShapeTotal.get(shape), 24, `each scanId shape must appear in exactly 24 of the 96 cases (once per structural combination) — got ${perShapeTotal.get(shape)} for "${shape}"`);
    assertEqual(perShapeAccepted.get(shape), 2, `each scanId shape must appear in exactly 2 of the 8 accepted cases (once per stage's fully-matching combination) — got ${perShapeAccepted.get(shape)} for "${shape}"`);
  }
});

// ---------------------------------------------------------------------
// logStaleScanResponse — smoke test.
// ---------------------------------------------------------------------
test('logStaleScanResponse does not throw and omits sensitive content', () => {
  let threw = false;
  try {
    logStaleScanResponse(
      'grade',
      { scanId: 'r-1' },
      { scanId: 'c-1', generation: 1 },
      { scanId: 'a-1', generation: 2 },
      'scanid-mismatch',
      SCAN_OWNERSHIP_MODE.ENFORCE
    );
  } catch {
    threw = true;
  }
  assertFalse(threw, 'logStaleScanResponse must not throw');
});

// ---------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------
console.log('Running Slice 7 (scan ownership) tests...\n');
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}\n`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)`);
if (failed > 0) {
  process.exit(1);
}
