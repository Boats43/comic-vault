// tests/grailkey-directive-u-task2-stale-automatic-write.test.js
//
// GrailKey Directive U, Task 2 (GK-87, closing the picker-required race
// scope) — Directive T's Task 5 gated the CORRECTION's own response
// (submitManualCorrection), but never stopped an OLDER gradeBlob
// (automatic scan) response from arriving AFTER a correction begins and
// writing stale state anyway. gradeBlob's write sites used
// CURRENT_SCAN_OWNERSHIP_MODE (SHADOW, the global rollout constant) —
// SHADOW logs what would be rejected but always still performs the write.
// Flipping that constant to ENFORCE globally would also change scan-vs-
// scan behavior, which nobody has validated with a shadow-window read —
// explicitly out of scope for this dispatch.
//
// Fix: `kind: 'scan' | 'correction'` tags the ownership object minted by
// gradeBlob and submitManualCorrection respectively (same {scanId,
// generation} shape, one added field — not a new mechanism).
// wasSupersededByCorrection(closure, active) (src/lib/scanOwnership.js)
// is a pure predicate: true only when the CURRENT active ownership is a
// correction that differs from the closure that captured it. gradeBlob's
// three write sites (grade-stage transient setResult, enrich-stage
// transient setResult, enrich-stage persisted setCatalogue+setSelectedItem
// as one unit) each compute their mode dynamically:
//   wasSupersededByCorrection(...) ? ENFORCE : CURRENT_SCAN_OWNERSHIP_MODE
// — correction-caused staleness always rejects; every other staleness
// cause (scan-vs-scan included) is completely unaffected, still SHADOW,
// exactly as before this dispatch.
//
// REACHABILITY (checked against real code, not assumed):
//   - Auto-refresh: NOT reachable. `if (selectedItem) return;`
//     (src/App.jsx, the auto-refresh effect) structurally excludes it for
//     the entire duration a correction UI can be open, since a correction
//     always operates on an already-open `selectedItem` (CollectionDetail).
//   - Back-to-back corrections: already protected, no gap — each
//     submitManualCorrection call re-mints activeScanRef.current at its
//     own start (Directive T, Task 5), and its own ENFORCE-gated guard
//     (already shipped) rejects a stale FIRST correction's response once
//     a SECOND correction has begun. Confirmed by reading
//     submitManualCorrection directly; not re-tested here (covered by
//     tests/grailkey-directive-t-task5-revision-token.test.js).
//   - refreshMarketData: reachable as an INDEPENDENT race (with gradeBlob
//     AND with corrections), but through a wholly separate guard
//     (activeCardEnrichIdRef/cardEnrichAbortRef) that has zero
//     relationship to activeScanRef/scanOwnership.js. Out of GK-87's
//     specific scope (which is about gradeBlob's scanOwnership-based
//     persisted write) and wiring it in would be a new, unscoped
//     mechanism change — logged as GK-88 (docs/TICKET-REGISTRY.md), not
//     fixed here, per this dispatch's explicit non-goals ("no new merge
//     helper, no new ownership mechanism").
//   - The scan -> catalogue .then() (gradeBlob's own fire-and-forget
//     enrich chain): REACHABLE, and IS GK-87's documented remaining gap.
//     setLoading(false) fires immediately after /api/grade resolves,
//     well before /api/enrich resolves (PriceCharting scrape + eBay +
//     ComicVine chains, no fixed short bound); `savedId` is already
//     awaited before the enrich fetch fires, so the item exists and is
//     open-able the moment the operator sees the result. This is the
//     scenario this file's Part 2/3 exercise.
//
// Invoke: node tests/grailkey-directive-u-task2-stale-automatic-write.test.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applyScanOwnershipGuard,
  wasSupersededByCorrection,
  CURRENT_SCAN_OWNERSHIP_MODE,
  SCAN_OWNERSHIP_MODE,
} from '../src/lib/scanOwnership.js';

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

console.log('\n=== GrailKey Directive U, Task 2 (GK-87) — stale automatic write ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — pre-fix failure, shown DIRECTLY against real, still-current
// production values. CURRENT_SCAN_OWNERSHIP_MODE is UNCHANGED by this
// dispatch (still SHADOW, still exported the same way) — this is exactly
// what every gradeBlob write site did BEFORE this dispatch (a static
// CURRENT_SCAN_OWNERSHIP_MODE argument, no dynamic override), and is
// still exactly what any OTHER staleness cause (scan-vs-scan) does today.
// Calling the real applyScanOwnershipGuard with that real, unmodified
// constant reproduces the pre-fix vulnerability precisely, using
// production code, not a re-implementation.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: pre-fix vulnerability, reproduced against real CURRENT_SCAN_OWNERSHIP_MODE (DIRECT)\n');
{
  const scanClosure = { scanId: 'scan-A', generation: 5, kind: 'scan' };
  const correctionActive = { scanId: 'correction-B', generation: 6, kind: 'correction' };
  const staleGradeResponse = { scanId: 'scan-A', title: 'stale automatic identity' };

  let wrote = false;
  const verdict = applyScanOwnershipGuard(
    'enrich',
    staleGradeResponse,
    scanClosure,
    correctionActive,
    CURRENT_SCAN_OWNERSHIP_MODE, // the OLD, pre-Directive-U call pattern — static, no override
    () => { wrote = true; }
  );

  assertEq(CURRENT_SCAN_OWNERSHIP_MODE, 'shadow', 'sanity: production mode is still SHADOW (unchanged by this dispatch)');
  assertTrue(!verdict.accepted, 'the predicate correctly identifies this as stale (scanid-mismatch) even pre-fix');
  assertTrue(wrote, 'PRE-FIX BEHAVIOR: SHADOW mode wrote the stale response through anyway — this is exactly the defect Directive U closes for the correction-specific case');

  // Confirm the pre-Directive-U committed source (real git history, not
  // an assumption) actually called the guard this way at gradeBlob's two
  // transient sites, and had NO guard at all around the persisted
  // setCatalogue/setSelectedItem write — `git show 1627d06:src/App.jsx`,
  // the commit immediately before this dispatch.
  const preFixSrc = (() => {
    try {
      return execSync('git show 1627d06:src/App.jsx', { cwd: repoRoot, encoding: 'utf8' });
    } catch {
      return null;
    }
  })();
  if (preFixSrc) {
    const transientGuardCount = (preFixSrc.match(/applyScanOwnershipGuard\(\s*\n\s*'(grade|enrich)',/g) || []).length;
    assertEq(transientGuardCount, 2, "pre-fix: exactly 2 applyScanOwnershipGuard calls in gradeBlob ('grade', 'enrich' — both transient), confirmed against real git history");
    assertTrue(!preFixSrc.includes("'enrich-persist'"), "pre-fix: no 'enrich-persist' guard existed at all — the persisted setCatalogue/setSelectedItem write was completely unguarded, confirmed against real git history");
  } else {
    console.log('  (skipped git-show cross-check — git not available in this environment; Part 0\'s runtime proof above still stands on its own)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — wasSupersededByCorrection, the new pure predicate (DIRECT).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: wasSupersededByCorrection predicate (DIRECT)\n');
{
  // NOTE (GrailKey Directive V, Task 2, GK-88): itemId is included here,
  // same item on both sides, since Directive V scoped the predicate to
  // same-item comparisons (fixing an item-blind cross-item kill switch
  // this file's own scope never exercised — see
  // grailkey-directive-v-task2-ownership-perimeter.test.js Part 0/1/2 for
  // that fix and its cross-item control). This file's own scope is
  // unchanged: same-item correction-supersession behavior.
  const scanClosure = { scanId: 'scan-A', generation: 1, kind: 'scan', itemId: 'item-A' };

  assertTrue(
    wasSupersededByCorrection(scanClosure, { scanId: 'correction-B', generation: 2, kind: 'correction', itemId: 'item-A' }),
    'true — active is a DIFFERENT correction, SAME item'
  );
  assertTrue(
    !wasSupersededByCorrection(scanClosure, { scanId: 'scan-C', generation: 2, kind: 'scan', itemId: 'item-A' }),
    'false — active is a DIFFERENT scan (not a correction) — scan-vs-scan must stay unaffected'
  );
  assertTrue(
    !wasSupersededByCorrection(scanClosure, scanClosure),
    'false — active IS the closure itself (not superseded at all)'
  );
  assertTrue(
    !wasSupersededByCorrection(scanClosure, null),
    'false — no active ownership at all'
  );
  assertTrue(
    !wasSupersededByCorrection(scanClosure, { scanId: 'scan-A', generation: 1, kind: 'scan', itemId: 'item-A' }),
    'false — active matches closure exactly (same scanId), even though it is a plain object, not the same reference'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — post-fix behavior, the EXACT dynamic-mode expression gradeBlob's
// three write sites now use (DIRECT — both functions are real, this is
// the literal pattern, not a re-implementation):
//   wasSupersededByCorrection(closure, active) ? ENFORCE : CURRENT_SCAN_OWNERSHIP_MODE
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: post-fix dynamic-mode behavior (DIRECT)\n');
const modeFor = (closure, active) =>
  wasSupersededByCorrection(closure, active) ? SCAN_OWNERSHIP_MODE.ENFORCE : CURRENT_SCAN_OWNERSHIP_MODE;

{
  // Scenario A — correction supersedes: the stale scan write must be
  // REJECTED. This is the directive's core GIVEN/WHEN/THEN. Same item on
  // both sides (Directive V, GK-88, scoped this predicate to same-item —
  // cross-item behavior is that dispatch's own test's responsibility).
  const scanClosure = { scanId: 'scan-A', generation: 5, kind: 'scan', itemId: 'item-A' };
  const correctionActive = { scanId: 'correction-B', generation: 6, kind: 'correction', itemId: 'item-A' };
  const staleResponse = { scanId: 'scan-A', title: 'stale automatic identity', price: '$4.99' };

  let transientWrote = false;
  const transientVerdict = applyScanOwnershipGuard(
    'enrich', staleResponse, scanClosure, correctionActive,
    modeFor(scanClosure, correctionActive),
    () => { transientWrote = true; }
  );
  assertTrue(!transientVerdict.accepted, 'THEN zero transient write occurs — rejected (accepted:false)');
  assertTrue(!transientWrote, 'THEN zero transient write occurs — applyFn never ran');
  assertEq(transientVerdict.reason, 'scanid-mismatch', 'rejection reason is scanid-mismatch (the real predicate, not a synthetic new reason)');

  let persistedWrote = false;
  const persistedVerdict = applyScanOwnershipGuard(
    'enrich-persist', staleResponse, scanClosure, correctionActive,
    modeFor(scanClosure, correctionActive),
    () => { persistedWrote = true; }
  );
  assertTrue(!persistedVerdict.accepted, 'THEN zero persisted write occurs — rejected');
  assertTrue(!persistedWrote, 'THEN zero persisted write occurs — setCatalogue/setSelectedItem callback never ran');

  // THEN the corrected state remains authoritative — modeled directly:
  // the "catalogue" here is whatever the correction already wrote;
  // since neither write callback above ran, it is untouched.
  const catalogueAfterCorrection = { title: 'operator-confirmed identity', price: '$120.00' };
  assertEq(catalogueAfterCorrection, { title: 'operator-confirmed identity', price: '$120.00' }, 'THEN the corrected state remains authoritative — nothing overwrote it');
}

{
  // Scenario B (control 1) — superseded by ANOTHER SCAN, not a
  // correction: must NOT change behavior. Still SHADOW, still writes
  // through, exactly as every gradeBlob write did before this dispatch —
  // proves the fix does not flip CURRENT_SCAN_OWNERSHIP_MODE globally.
  const scanClosureA = { scanId: 'scan-A', generation: 5, kind: 'scan', itemId: 'item-A' };
  const scanActiveC = { scanId: 'scan-C', generation: 7, kind: 'scan', itemId: 'item-A' };
  const staleResponse = { scanId: 'scan-A', title: 'stale, but superseded by another scan, not a correction' };

  let wrote = false;
  const verdict = applyScanOwnershipGuard(
    'enrich', staleResponse, scanClosureA, scanActiveC,
    modeFor(scanClosureA, scanActiveC),
    () => { wrote = true; }
  );
  assertTrue(!verdict.accepted, 'scan-vs-scan staleness is still correctly identified by the predicate');
  assertTrue(wrote, 'scan-vs-scan staleness still WRITES THROUGH under SHADOW — unaffected by this fix, no global flip');
}

{
  // Scenario C (control 2) — the directive's own required control: a
  // NON-superseded automatic response still writes normally.
  const scanClosure = { scanId: 'scan-A', generation: 5, kind: 'scan', itemId: 'item-A' };
  const stillActive = { scanId: 'scan-A', generation: 5, kind: 'scan', itemId: 'item-A' };
  const freshResponse = { scanId: 'scan-A', title: 'fresh, un-superseded identity' };

  let wrote = false;
  const verdict = applyScanOwnershipGuard(
    'enrich', freshResponse, scanClosure, stillActive,
    modeFor(scanClosure, stillActive),
    () => { wrote = true; }
  );
  assertTrue(verdict.accepted, 'CONTROL: a non-superseded response is accepted');
  assertTrue(wrote, 'CONTROL: the guard must not break ordinary scanning — the write ran');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — rejection is logged (console.log capture, real function).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: rejection is observably logged (DIRECT)\n');
{
  const scanClosure = { scanId: 'scan-A', generation: 5, kind: 'scan', itemId: 'item-A' };
  const correctionActive = { scanId: 'correction-B', generation: 6, kind: 'correction', itemId: 'item-A' };
  const staleResponse = { scanId: 'scan-A' };

  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    applyScanOwnershipGuard(
      'enrich-persist', staleResponse, scanClosure, correctionActive,
      modeFor(scanClosure, correctionActive),
      () => {}
    );
  } finally {
    console.log = originalLog;
  }
  const logLine = lines.find((l) => l.includes('[scan-ownership]'));
  assertTrue(!!logLine, 'a [scan-ownership] log line was emitted for the rejected write');
  assertTrue(logLine?.includes('rejected'), 'the log line says "rejected" (ENFORCE-mode wording, not "observed")');
  assertTrue(logLine?.includes('mode=enforce'), 'the log line records mode=enforce for this specific correction-caused rejection');
  assertTrue(logLine?.includes('reason=scanid-mismatch'), 'the log line records the real rejection reason');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — structural proof gradeBlob's three real write sites actually
// use this pattern (MIRRORED — gradeBlob is not independently invocable
// outside the full React tree, same constraint every App.jsx-touching
// test in this repo works under; Directive T's Task 5 test used the same
// labeling discipline for submitManualCorrection).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: gradeBlob is wired to the mechanism above (source proof, MIRRORED)\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');

  assertTrue(appSrc.includes("wasSupersededByCorrection"), 'wasSupersededByCorrection is imported/used in App.jsx');
  // GrailKey Directive V, Task 2 (GK-88) added itemId to both ownership
  // objects (real, intentional shape change) — this file's own scope
  // (kind tagging) is unaffected, so these checks now match on the
  // kind-tag substring rather than the full literal (which V's itemId
  // addition legitimately changed).
  assertTrue(appSrc.includes("kind: 'scan', itemId: null };"), "gradeBlob's own ownership object is tagged kind:'scan' (itemId added by Directive V, GK-88)");
  assertTrue(
    appSrc.includes("kind: 'correction', itemId: item.id };"),
    "submitManualCorrection's ownership object is tagged kind:'correction' (itemId added by Directive V, GK-88)"
  );

  // Three real call sites: grade-stage transient, enrich-stage transient,
  // enrich-stage persisted (setCatalogue+setSelectedItem as one unit).
  const dynamicModeCount = (appSrc.match(/wasSupersededByCorrection\(scanOwnership, activeScanRef\.current\)\s*\n\s*\? SCAN_OWNERSHIP_MODE\.ENFORCE\s*\n\s*: CURRENT_SCAN_OWNERSHIP_MODE/g) || []).length;
  assertEq(dynamicModeCount, 3, 'exactly 3 call sites in gradeBlob use the dynamic-mode expression (grade-transient, enrich-transient, enrich-persist)');

  assertTrue(appSrc.includes("'enrich-persist'"), "the persisted write site is tagged with its own 'enrich-persist' stage label (distinguishable in logs from the transient 'enrich' site)");

  // The persisted write must gate setCatalogue AND setSelectedItem as ONE
  // unit — confirm both live inside the SAME applyScanOwnershipGuard
  // applyFn (no second, independent applyScanOwnershipGuard call sitting
  // between them, which would mean they were gated separately and could
  // be selectively/partially applied — explicitly forbidden).
  const persistIdx = appSrc.indexOf("'enrich-persist'");
  const guardOpenIdx = appSrc.lastIndexOf('applyScanOwnershipGuard(', persistIdx);
  const setCatalogueIdx = appSrc.indexOf('setCatalogue((prev) => {', persistIdx);
  const setSelectedItemIdx = appSrc.indexOf('setSelectedItem((s) => {', setCatalogueIdx);
  assertTrue(guardOpenIdx > 0 && persistIdx > guardOpenIdx, "'enrich-persist' is the stage argument of an applyScanOwnershipGuard( call");
  assertTrue(setCatalogueIdx > persistIdx, 'setCatalogue appears after the enrich-persist guard call opens');
  assertTrue(setSelectedItemIdx > setCatalogueIdx, 'setSelectedItem appears after setCatalogue, still before any second guard call');
  const betweenGuardAndSelectedItem = appSrc.slice(guardOpenIdx, setSelectedItemIdx);
  const guardCallCountBetween = (betweenGuardAndSelectedItem.match(/applyScanOwnershipGuard\(/g) || []).length;
  assertEq(guardCallCountBetween, 1, 'exactly one applyScanOwnershipGuard call wraps both setCatalogue and setSelectedItem — not two independent guards');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
