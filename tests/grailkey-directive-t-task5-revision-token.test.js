// tests/grailkey-directive-t-task5-revision-token.test.js
//
// GrailKey Directive T, Task 5 (GK-87, correction-flow scope) — S proved
// the persisted catalogue write has no ownership protection at all (it is
// explicitly unconditional, src/App.jsx's own comment), and even where
// the existing scanOwnership guard IS wired (gradeBlob's transient
// setResult sites), CURRENT_SCAN_OWNERSHIP_MODE = SHADOW means it never
// actually blocks a write in production. This dispatch does not flip that
// global constant (explicit non-goal) — it wires the CORRECTION flow
// (submitManualCorrection) into the SAME existing primitives
// (src/lib/scanOwnership.js — no new plumbing), narrowly ENFORCE-gated at
// this one new call site, reusing the SAME shared activeScanRef/
// scanGenerationRef refs gradeBlob already uses (both are useCallbacks in
// the same component, closing over the same component-level refs).
//
// Starting a correction mints a fresh ownership identity and immediately
// supersedes any older in-flight automatic response's own closure. The
// correction's own response is then gated: applied only if nothing newer
// has started since.
//
// Scope, stated plainly: this covers the correction flow's own single
// write moment (which serves both the persisted catalogue and the open
// detail view together, atomically). It does NOT add a symmetric
// generation check into gradeBlob's own PRE-EXISTING automatic-scan
// persisted-write path — a separate, larger, riskier change to a
// different already-live code path, deliberately deferred and logged
// (see the registry) rather than rushed into this dispatch. Task 3's
// per-field identityAuthority check (GK-85) already protects operator-
// locked identity FACETS specifically against a stale automatic
// overwrite, independent of race timing — this dispatch's revision token
// is a complementary, not a substitute, protection for the correction
// flow's OWN write.
//
// The scanOwnership primitives themselves (shouldAcceptScanResponse,
// applyScanOwnershipGuard) are already covered by
// tests/slice7-scan-ownership.test.js — not re-tested here. This file
// proves (a) the pure payload-building change (buildManualCorrectionPayload
// now threads scanId), DIRECT, and (b) that submitManualCorrection is
// actually wired to mint/check ownership, via a structural proof against
// the real committed source — labeled MIRRORED where it is, since
// submitManualCorrection itself is not independently invocable outside
// the full React component (same constraint every App.jsx-touching test
// in this repo works under).
//
// Invoke: node tests/grailkey-directive-t-task5-revision-token.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildManualCorrectionPayload } from '../src/lib/manualCorrection.js';
import { shouldAcceptScanResponse, SCAN_OWNERSHIP_MODE, applyScanOwnershipGuard } from '../src/lib/scanOwnership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GrailKey Directive T, Task 5 (GK-87, correction-flow scope) — revision token ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — buildManualCorrectionPayload threads scanId (DIRECT, real
// function, real call).
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: buildManualCorrectionPayload carries scanId when supplied\n');
{
  const item = { title: 'X', issue: '1', year: '2024', publisher: 'P', variant: null };
  const withScanId = buildManualCorrectionPayload(item, { title: 'Y' }, ['title'], 'scan-abc-123');
  assertEq(withScanId.scanId, 'scan-abc-123', 'scanId present in the payload when supplied');

  const withoutScanId = buildManualCorrectionPayload(item, { title: 'Y' }, ['title']);
  assertTrue(!Object.prototype.hasOwnProperty.call(withoutScanId, 'scanId'), 'scanId genuinely absent (not undefined-valued) when not supplied — existing callers/tests unaffected');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — end-to-end proof using the REAL scanOwnership primitives
// (already unit-tested by slice7-scan-ownership.test.js): a correction
// that starts, then gets superseded by a NEWER operation before its own
// response returns, is correctly rejected under ENFORCE mode -- proving
// the exact mechanism submitManualCorrection now calls.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: the real ownership mechanism, ENFORCE mode, correction-shaped scenario\n');
{
  // Correction A begins.
  const correctionA = { scanId: 'correction-A', generation: 5 };
  let active = correctionA; // activeScanRef.current, as submitManualCorrection sets it

  // Before A's response returns, a NEWER operation begins (another
  // correction, or a fresh gradeBlob scan) and supersedes it.
  const newerOperation = { scanId: 'newer-op', generation: 6 };
  active = newerOperation; // activeScanRef.current updated by the newer operation

  // Correction A's response now arrives, echoing its OWN scanId (A never
  // knows about the newer operation).
  const staleResponseA = { scanId: 'correction-A', title: 'stale value' };

  let applied = false;
  const verdict = applyScanOwnershipGuard(
    'correction',
    staleResponseA,
    correctionA,
    active,
    SCAN_OWNERSHIP_MODE.ENFORCE,
    () => { applied = true; }
  );

  assertTrue(!verdict.accepted, 'stale correction response is NOT accepted once a newer operation has begun');
  // shouldAcceptScanResponse checks scanId before generation (src/lib/
  // scanOwnership.js's own documented order) — active.scanId already
  // differs here, so it never reaches the generation check at all.
  assertEq(verdict.reason, 'scanid-mismatch', 'rejected for scanid-mismatch (the active ownership identity itself changed, checked before generation)');
  assertTrue(!applied, 'the write callback never ran for the superseded correction — this is the actual mechanism submitManualCorrection relies on to throw and not persist');
}

console.log('\nPart 3: the real ownership mechanism -- a correction with nothing newer IS applied\n');
{
  const correctionB = { scanId: 'correction-B', generation: 7 };
  const active = correctionB; // nothing superseded it
  const responseB = { scanId: 'correction-B', title: 'fresh value' };

  let applied = false;
  const verdict = applyScanOwnershipGuard('correction', responseB, correctionB, active, SCAN_OWNERSHIP_MODE.ENFORCE, () => { applied = true; });

  assertTrue(verdict.accepted, 'an un-superseded correction response is accepted');
  assertTrue(applied, 'the write callback ran -- this is what allows submitManualCorrection to actually persist');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — structural proof that submitManualCorrection is actually
// wired this way (the real committed source, not a retyped guess).
// Labeled MIRRORED for the wiring check specifically: the function itself
// isn't independently invocable outside the full React tree, so this
// proves the SOURCE calls the (already directly-tested, Part 2/3) real
// mechanism correctly, not a re-implementation of the mechanism itself.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: submitManualCorrection is wired to the mechanism above (source proof, MIRRORED)\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const fnMatch = appSrc.match(/const submitManualCorrection = useCallback\(async \(item, correctedValues, correctedFields\) => \{[\s\S]*?\n  \}, \[\]\);/);
  assertTrue(!!fnMatch, 'submitManualCorrection function body found in current source');
  const body = fnMatch?.[0] || '';

  assertTrue(body.includes('nextGeneration(scanGenerationRef)'), 'mints a new generation using the shared scanGenerationRef (same ref gradeBlob uses)');
  assertTrue(body.includes('activeScanRef.current = correctionOwnership'), 'immediately updates the shared activeScanRef -- this is what supersedes an older in-flight response');
  assertTrue(body.includes("SCAN_OWNERSHIP_MODE.ENFORCE"), 'gated ENFORCE, not the global (SHADOW) CURRENT_SCAN_OWNERSHIP_MODE constant');
  // Checks the constant is never passed as an actual mode ARGUMENT (a
  // call-site usage), not merely absent from prose -- this function's own
  // comments legitimately name CURRENT_SCAN_OWNERSHIP_MODE to explain why
  // it's deliberately NOT used here.
  assertTrue(!/applyScanOwnershipGuard\([^)]*CURRENT_SCAN_OWNERSHIP_MODE/.test(body), 'CURRENT_SCAN_OWNERSHIP_MODE is never passed as the mode argument to applyScanOwnershipGuard in this function');
  assertTrue(body.includes('applyScanOwnershipGuard('), 'calls the real, shared orchestration function -- not a parallel reimplementation');
  assertTrue(body.includes("throw new Error('Correction superseded by a newer operation — not applied.')"), 'throws (does not silently no-op) when the correction was superseded');
  assertTrue(body.includes('correctionOwnership.scanId'), 'the minted scanId is threaded into the outgoing payload');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
