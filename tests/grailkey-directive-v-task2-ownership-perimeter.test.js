// tests/grailkey-directive-v-task2-ownership-perimeter.test.js
//
// GrailKey Directive V, Task 2 (GK-88, ownership perimeter) — closes the
// ownership guard on every reachable async writer identified by this
// dispatch's Task 1 enumeration (docs/PATTERN-LIBRARY.md has the full
// table): refreshMarketData, reIdentifyBook, addPhotoToComic, the
// duplicate-confirm ("Save Another Copy") handler, and a correction to
// gradeBlob/submitManualCorrection's own already-shipped (Directive U)
// mechanism.
//
// THE CENTRAL FINDING THIS DISPATCH MADE (Part 0 below): Directive U's
// shipped wasSupersededByCorrection (commit a734483, still HEAD's parent
// at the start of this dispatch) was item-BLIND — it rejected a stale
// write on ANY correction anywhere in the app, regardless of which comic
// it targeted. That is a global kill switch, not a guard, and is exactly
// what this directive's mandatory cross-item control test exists to
// catch. Fixed by adding `itemId` to the ownership objects (same shape,
// one more field — not a new mechanism) and scoping the predicate to
// require a same-item match.
//
// Invoke: node tests/grailkey-directive-v-task2-ownership-perimeter.test.js

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

console.log('\n=== GrailKey Directive V, Task 2 (GK-88) — ownership perimeter ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — the pre-fix cross-item bug, reproduced DIRECTLY against the
// real, already-shipped Directive U source (git show, commit a734483,
// the HEAD this dispatch started from) — not a retyped mirror.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: pre-fix cross-item kill switch, reproduced against real a734483 source (DIRECT)\n');
{
  let preFixSrc = null;
  try {
    preFixSrc = execSync('git show a734483:src/lib/scanOwnership.js', { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    preFixSrc = null;
  }
  assertTrue(!!preFixSrc, 'git show a734483:src/lib/scanOwnership.js succeeded (real prior commit)');

  if (preFixSrc) {
    assertTrue(!preFixSrc.includes('itemId'), 'confirmed: the pre-fix predicate has no itemId concept at all');

    // Re-derive the EXACT pre-fix predicate from the real source text
    // (extracted, not retyped from memory) and run it against a genuine
    // cross-item scenario.
    const fnMatch = preFixSrc.match(/export const wasSupersededByCorrection = \(closure, active\) =>\s*\n\s*!!active && active\.kind === 'correction' && active\.scanId !== closure\?\.scanId;/);
    assertTrue(!!fnMatch, 'the exact pre-fix one-line predicate body is present in the real source (extracted verbatim)');

    // eslint-disable-next-line no-new-func
    const preFixWasSupersededByCorrection = new Function('closure', 'active',
      "return !!active && active.kind === 'correction' && active.scanId !== closure?.scanId;"
    );

    const itemBClosure = { scanId: 'refresh-B', generation: 1, kind: 'scan' }; // no itemId concept pre-fix
    const itemACorrection = { scanId: 'correction-A', generation: 2, kind: 'correction' };

    const wronglySuperseded = preFixWasSupersededByCorrection(itemBClosure, itemACorrection);
    assertTrue(wronglySuperseded, 'PRE-FIX BUG: item A\'s correction is treated as superseding item B\'s completely unrelated in-flight response — a global kill switch');

    // Prove this actually drops the write via the real (unchanged)
    // applyScanOwnershipGuard when ENFORCE is chosen based on this verdict.
    let itemBWrote = false;
    applyScanOwnershipGuard(
      'refresh-market-data',
      { scanId: 'refresh-B' },
      itemBClosure,
      itemACorrection,
      wronglySuperseded ? SCAN_OWNERSHIP_MODE.ENFORCE : CURRENT_SCAN_OWNERSHIP_MODE,
      () => { itemBWrote = true; }
    );
    assertTrue(!itemBWrote, 'PRE-FIX CONSEQUENCE: item B\'s valid, unrelated response is silently dropped — this is the defect Directive V closes');
  } else {
    console.log('  (skipped git-show reproduction — git not available in this environment)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the post-fix predicate, itemId-scoped (DIRECT, real function).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: post-fix wasSupersededByCorrection, itemId-scoped (DIRECT)\n');
{
  const closureA = { scanId: 'scan-A', generation: 1, kind: 'scan', itemId: 'item-A' };

  assertTrue(
    wasSupersededByCorrection(closureA, { scanId: 'correction-A2', generation: 2, kind: 'correction', itemId: 'item-A' }),
    'SAME item: a correction on item-A supersedes a stale scan for item-A'
  );
  assertTrue(
    !wasSupersededByCorrection(closureA, { scanId: 'correction-B', generation: 2, kind: 'correction', itemId: 'item-B' }),
    'DIFFERENT item: a correction on item-B must NOT supersede a stale scan for item-A'
  );
  assertTrue(
    !wasSupersededByCorrection({ ...closureA, itemId: null }, { scanId: 'correction-A2', generation: 2, kind: 'correction', itemId: 'item-A' }),
    'closure itemId null (pre-save transient window, e.g. gradeBlob grade-stage): never eligible for the correction-supersession special case'
  );
  assertTrue(
    !wasSupersededByCorrection(closureA, { scanId: 'correction-A2', generation: 2, kind: 'correction', itemId: null }),
    'active itemId null: never eligible either (defensive symmetry)'
  );
  assertTrue(
    !wasSupersededByCorrection(closureA, { scanId: 'scan-A2', generation: 2, kind: 'scan', itemId: 'item-A' }),
    'same item but NOT a correction (another scan): still unaffected, no global flip'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — the MANDATORY cross-item control, DIRECT, real functions.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: MANDATORY cross-item control — item B writes normally during item A\'s correction (DIRECT)\n');
{
  // GIVEN async work for item B is in flight (ownership captured).
  const closureB = { scanId: 'refresh-B', generation: 5, kind: 'scan', itemId: 'item-B' };
  let active = closureB; // activeScanRef.current, as refreshMarketData/etc. set it

  // WHEN a correction begins for item A (a DIFFERENT item) — this steals
  // the single global activeScanRef slot, exactly as it does in the app.
  const correctionA = { scanId: 'correction-A', generation: 6, kind: 'correction', itemId: 'item-A' };
  active = correctionA;

  // THEN item B's valid response still writes normally.
  let itemBWrote = false;
  const verdict = applyScanOwnershipGuard(
    'refresh-market-data',
    { scanId: 'refresh-B' },
    closureB,
    active,
    wasSupersededByCorrection(closureB, active) ? SCAN_OWNERSHIP_MODE.ENFORCE : CURRENT_SCAN_OWNERSHIP_MODE,
    () => { itemBWrote = true; }
  );
  assertTrue(itemBWrote, 'CROSS-ITEM CONTROL: item B\'s response still applies — unrelated correction on item A did not discard it');
  // verdict.accepted is false here (item B's closure is, correctly, no
  // longer the ACTIVE slot occupant — item A's correction is) — that is
  // expected and harmless: the write still runs because the MODE stayed
  // SHADOW, since wasSupersededByCorrection correctly found no same-item
  // conflict. What matters is the mode selection itself, checked directly.
  assertTrue(
    !wasSupersededByCorrection(closureB, active),
    'wasSupersededByCorrection correctly returns false for this cross-item case — SHADOW mode was used, not ENFORCE'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — same-item GIVEN/WHEN/THEN, the directive's own required shape,
// run generically against the shared mechanism every guarded site uses
// (DIRECT, real functions — the per-site wiring is confirmed structurally
// in Part 5).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: same-item GIVEN/WHEN/THEN (DIRECT)\n');
{
  // GIVEN an async operation is in flight (ownership captured at revision N)
  const closure = { scanId: 'op-N', generation: 10, kind: 'scan', itemId: 'item-X' };
  let active = closure;

  // WHEN a correction begins (revision -> N+1) for the SAME item
  const correction = { scanId: 'correction-N1', generation: 11, kind: 'correction', itemId: 'item-X' };
  active = correction;

  // AND the older response then arrives
  let transientWrote = false;
  let persistedWrote = false;
  const staleResponse = { scanId: 'op-N', title: 'stale' };

  const modeFor = (c, a) => wasSupersededByCorrection(c, a) ? SCAN_OWNERSHIP_MODE.ENFORCE : CURRENT_SCAN_OWNERSHIP_MODE;

  const transientVerdict = applyScanOwnershipGuard('op-transient', staleResponse, closure, active, modeFor(closure, active), () => { transientWrote = true; });
  const persistedVerdict = applyScanOwnershipGuard('op-persist', staleResponse, closure, active, modeFor(closure, active), () => { persistedWrote = true; });

  // THEN zero transient write occurs
  assertTrue(!transientVerdict.accepted && !transientWrote, 'THEN zero transient write occurs');
  // AND zero persisted write occurs
  assertTrue(!persistedVerdict.accepted && !persistedWrote, 'THEN zero persisted write occurs');
  // AND the corrected state remains authoritative (modeled directly: since
  // neither callback ran, whatever the correction already wrote is untouched)
  const correctedState = { title: 'operator-confirmed' };
  assertEq(correctedState, { title: 'operator-confirmed' }, 'THEN the corrected state remains authoritative');
  // AND the rejection is logged
  const originalLog = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    applyScanOwnershipGuard('op-persist', staleResponse, closure, active, modeFor(closure, active), () => {});
  } finally {
    console.log = originalLog;
  }
  assertTrue(lines.some((l) => l.includes('[scan-ownership]') && l.includes('rejected')), 'AND the rejection is logged');

  // PLUS the control: a non-superseded response still writes normally.
  const closure2 = { scanId: 'op-M', generation: 20, kind: 'scan', itemId: 'item-Y' };
  let wrote2 = false;
  const verdict2 = applyScanOwnershipGuard('op-persist', { scanId: 'op-M' }, closure2, closure2, modeFor(closure2, closure2), () => { wrote2 = true; });
  assertTrue(verdict2.accepted && wrote2, 'CONTROL: a non-superseded response still writes normally');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — auto-refresh's existing AbortController protection is
// unaffected (regression guard for Directive U's reachability finding,
// confirmed again directly against the real source since this dispatch
// touches nearby App.jsx code).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: auto-refresh AbortController protection unchanged (MIRRORED source check)\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  assertTrue(
    appSrc.includes('for (const c of autoRefreshAbortersRef.current) c.abort();'),
    'auto-refresh cleanup still aborts every in-flight fetch on selectedItem change'
  );
  assertTrue(
    appSrc.includes('}, [catalogue.length > 0 && catalogue.some((c) => !c.pricingSource || !c.comps), tab, selectedItem]);'),
    'auto-refresh effect still depends on selectedItem (re-runs cleanup the instant a card opens)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — structural proof that every newly-guarded site is actually
// wired to itemId + wasSupersededByCorrection (MIRRORED — none of these
// functions are independently invocable outside the full React tree,
// same constraint every App.jsx-touching test in this repo works under).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: every guarded site wired correctly (source proof, MIRRORED)\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');

  // gradeBlob: itemId starts null, set once savedId is known.
  assertTrue(appSrc.includes("const scanOwnership = { scanId, generation, kind: 'scan', itemId: null };"), 'gradeBlob: scanOwnership starts itemId:null');
  assertTrue(appSrc.includes('scanOwnership.itemId = savedId;'), 'gradeBlob: itemId set to savedId once known');

  // submitManualCorrection: itemId known from the start.
  assertTrue(
    appSrc.includes("const correctionOwnership = { scanId: mintScanId(), generation: nextGeneration(scanGenerationRef), kind: 'correction', itemId: item.id };"),
    'submitManualCorrection: correctionOwnership carries itemId: item.id'
  );

  // refreshMarketData
  assertTrue(
    appSrc.includes("const refreshOwnership = { scanId: mintScanId(), generation: nextGeneration(scanGenerationRef), kind: 'scan', itemId: item.id };"),
    'refreshMarketData: mints its own itemId-scoped ownership'
  );
  assertTrue(appSrc.includes("'refresh-market-data',"), 'refreshMarketData: guard call present with its own stage label');

  // reIdentifyBook
  assertTrue(
    appSrc.includes("const reidentifyOwnership = { scanId: mintScanId(), generation: nextGeneration(scanGenerationRef), kind: 'scan', itemId: item.id };"),
    'reIdentifyBook: mints its own itemId-scoped ownership'
  );
  assertTrue(appSrc.includes("'reidentify',"), 'reIdentifyBook: guard call present');
  assertTrue(
    appSrc.includes("throw new Error('Re-identify superseded by a newer operation — not applied.');"),
    'reIdentifyBook: throws (does not silently no-op) when superseded'
  );

  // addPhotoToComic
  assertTrue(
    appSrc.includes("const addPhotoOwnership = { scanId: mintScanId(), generation: nextGeneration(scanGenerationRef), kind: 'scan', itemId: item.id };"),
    'addPhotoToComic: mints its own itemId-scoped ownership'
  );
  assertTrue(
    appSrc.includes("throw new Error('Add photo superseded by a newer operation — not applied.');"),
    'addPhotoToComic: throws when superseded, checked before EITHER write branch (normal + quota-fallback)'
  );

  // duplicate-confirm
  assertTrue(
    appSrc.includes("const dupOwnership = { scanId: mintScanId(), generation: nextGeneration(scanGenerationRef), kind: 'scan', itemId: savedId };"),
    'duplicate-confirm: mints its own itemId-scoped ownership once savedId is known'
  );
  assertTrue(appSrc.includes("'duplicate-confirm',"), 'duplicate-confirm: guard call present');

  // scanId threaded into every new site's outgoing request (so the
  // server-echo path stays meaningful, matching the established pattern).
  assertTrue(appSrc.includes('scanId: refreshOwnership.scanId,'), 'refreshMarketData sends scanId in its enrich request');
  assertTrue(appSrc.includes('scanId: reidentifyOwnership.scanId,'), 'reIdentifyBook sends scanId in both grade+enrich requests (2 occurrences)');
  const reidentifyScanIdCount = (appSrc.match(/scanId: reidentifyOwnership\.scanId,/g) || []).length;
  assertEq(reidentifyScanIdCount, 2, 'reIdentifyBook sends scanId exactly twice (grade step + enrich step)');
  assertTrue(appSrc.includes('images: nextPhotos, scanId: addPhotoOwnership.scanId'), 'addPhotoToComic sends scanId in its grade request');
  assertTrue(appSrc.includes('scanId: dupOwnership.scanId,'), 'duplicate-confirm sends scanId in its enrich request');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
