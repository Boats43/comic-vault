// tests/grailkey-outcome1-grading-calibration-patch.test.js
//
// GrailKey — Outcome #1 legacy grading calibration patch (Wolverine #67
// forensic audit follow-up, "Close legacy grading calibration patch /
// then move on" dispatch).
//
// Scope, per that dispatch:
//   1. Do NOT use chooseBetterGrade (it compares confidenceLevel — api/
//      enrich.js's comp-pool pricing confidence — not grading-evidence
//      confidence; grade.js never even populates confidenceLevel).
//   2. Wire the EXISTING gradeLocked contract (api/grade.js:657-669,
//      already proven by reIdentifyBook) into addPhotoToComic: an
//      ordinary Add Photo must send existingGrade/gradeConfidence/
//      gradeLocked, and must NOT send forceRegrade — a locked item's
//      grade must be respected, not silently overwritten.
//   3. Preserve the FIRST model grade as a write-once calibration
//      baseline (modelPredictedGrade/modelPredictedGradeReason/
//      modelPredictedGradeConfidence/modelPredictedAt) — independent of
//      whatever item.grade later becomes.
//
// Test approach for the App.jsx-embedded pieces (addPhotoToComic,
// reIdentifyBook): these are inline closures in a React callback, not
// exported functions — there is no unit-test harness for embedded UI
// logic in this repo (see tests/grailkey-dispatch-30-gk41-non-comic-gate
// .test.js for the established precedent). Each relevant block's REAL
// source text is extracted from the live App.jsx via anchored regex and
// compiled as real JavaScript, then run against fixture data — this
// exercises the literal shipped expression, not a paraphrase of it. The
// api/grade.js lock condition (pre-existing, unmodified by this patch,
// but now load-bearing for addPhotoToComic) is verified the same way.
// applyFirstModelPrediction (src/lib/dataQualityGuard.js) is a real
// exported pure function — imported and executed directly, no
// extraction needed.
//
// Invoke: node tests/grailkey-outcome1-grading-calibration-patch.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { readFileSync } from 'node:fs';
import { applyFirstModelPrediction } from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GrailKey Outcome #1 — legacy grading calibration patch ===\n');

// Both source files use CRLF line endings — normalize to LF so every \n
// anchor below matches regardless of the checkout's line-ending config.
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gradeApiSource = readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ═══════════════════════════════════════════════════════════════════════
// Section 1 — api/grade.js's pre-existing gradeLocked contract (NOT
// modified by this patch, but now load-bearing for addPhotoToComic).
// Extract the real shipped condition and prove the truth table.
// ═══════════════════════════════════════════════════════════════════════
console.log('-- Section 1: api/grade.js real gradeLocked short-circuit condition --');
{
  const condMatch = gradeApiSource.match(
    /\/\/ FIX 4: Grade lock - skip Vision on HIGH confidence books\s*\n\s*if \(([\s\S]*?)\)\s*\{\s*\n\s*console\.log\('\[grade-lock\] returning locked grade, skipping Vision'\);/
  );
  assertTrue(!!condMatch, 'gradeLocked short-circuit condition is found and isolated for extraction');
  const cond = condMatch?.[1] || 'false';
  const skipsVision = new Function('body', `return (${cond});`);

  assertEq(
    skipsVision({ existingGrade: { grade: 'VG 4.0' }, gradeConfidence: 'HIGH', gradeLocked: true }),
    true,
    'locked + HIGH + no forceRegrade → Vision IS skipped (locked grade wins)'
  );
  assertEq(
    skipsVision({ existingGrade: { grade: 'VG 4.0' }, gradeConfidence: 'HIGH', gradeLocked: true, forceRegrade: true }),
    false,
    'locked + HIGH + forceRegrade:true → Vision is NOT skipped — the existing explicit override path still works'
  );
  assertEq(
    skipsVision({ existingGrade: { grade: 'VG 4.0' }, gradeConfidence: 'HIGH', gradeLocked: false }),
    false,
    'unlocked (gradeLocked:false) → Vision is NOT skipped, regardless of forceRegrade'
  );
  assertEq(
    skipsVision({ existingGrade: { grade: 'VG 4.0' }, gradeConfidence: 'MEDIUM', gradeLocked: true }),
    false,
    'locked but gradeConfidence not exactly HIGH → Vision is NOT skipped (matches gradeBlob only ever locking on high confidence)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 2 — addPhotoToComic's real request body now threads
// existingGrade/gradeConfidence/gradeLocked, and never sends forceRegrade
// (an ordinary Add Photo is not an explicit override action).
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Section 2: addPhotoToComic real /api/grade request body --');
{
  const bodyMatch = appSource.match(
    /body: JSON\.stringify\(\{\n\s*images: nextPhotos,([\s\S]*?)\}\),\n\s*\}\);\n\s*const data = await res\.json\(\);/
  );
  assertTrue(!!bodyMatch, 'addPhotoToComic /api/grade request body is found and isolated for extraction');
  const bodyFieldsSrc = bodyMatch?.[1] || '';
  const buildBody = new Function(
    'item', 'nextPhotos', 'addPhotoOwnership',
    `return ({ images: nextPhotos, ${bodyFieldsSrc} });`
  );

  const lockedItem = { grade: 'VG 4.0', isGraded: false, numericGrade: null, confidence: 'high', gradeLocked: true };
  const body1 = buildBody(lockedItem, ['p1', 'p2'], { scanId: 'scan-1' });
  assertEq(body1.gradeLocked, true, 'locked item → request body gradeLocked:true');
  assertEq(body1.gradeConfidence, 'HIGH', 'locked item (confidence:"high") → request body gradeConfidence:"HIGH"');
  assertEq(body1.existingGrade.grade, 'VG 4.0', 'request body carries the real existingGrade.grade from item');
  assertEq(body1.forceRegrade, undefined, 'ordinary Add Photo NEVER sends forceRegrade');
  assertEq(body1.scanId, 'scan-1', 'scanId still threaded through unchanged');
  assertEq(body1.images, ['p1', 'p2'], 'images (nextPhotos) still sent — the new photo is still submitted regardless of lock state');

  const unlockedItem = { grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'medium', gradeLocked: false };
  const body2 = buildBody(unlockedItem, ['p1'], { scanId: 'scan-2' });
  assertEq(body2.gradeLocked, false, 'unlocked item → request body gradeLocked:false');
  assertEq(body2.forceRegrade, undefined, 'unlocked ordinary Add Photo also never sends forceRegrade');

  const neverLockedItem = { grade: 'FN 6.0', isGraded: false, numericGrade: null, confidence: 'medium' };
  const body3 = buildBody(neverLockedItem, ['p1'], { scanId: 'scan-3' });
  assertEq(body3.gradeLocked, false, 'item.gradeLocked absent (legacy item saved before this patch) → defaults to false, backward compatible');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 3 — addPhotoToComic's real merge (`updated`): a locked item's
// grade/reason/cgcPenaltyFlags survive an add-photo call unchanged (the
// server echoes existingGrade back with none of those extra fields), the
// new photo is still retained, unlocked behavior is unchanged, and the
// write-once calibration baseline is applied via the REAL
// applyFirstModelPrediction.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Section 3: addPhotoToComic real merge (`updated`) --');
{
  const mergeMatch = appSource.match(
    /const photoIssue = data\.issue[\s\S]*?const updated = \{[\s\S]*?\n {4}\};/
  );
  assertTrue(!!mergeMatch, 'addPhotoToComic merge block (photoIssue + updated) is found and isolated for extraction');
  const mergeSrc = mergeMatch[0];
  const buildUpdated = new Function(
    'item', 'data', 'nextPhotos', 'applyFirstModelPrediction',
    `${mergeSrc}\nreturn updated;`
  );

  // 3a — locked item, server echoes existingGrade back (no reason/cgcPenaltyFlags/title/etc.)
  const lockedItem = {
    id: 'wolverine-67', title: 'Wolverine', issue: '67', grade: 'VG 4.0', isGraded: false,
    numericGrade: null, reason: 'Clean copy, no visible defects.', confidence: 'high',
    gradeLocked: true, cgcPenaltyFlags: null, images: ['front.jpg'],
    modelPredictedGrade: 'VG 4.0', modelPredictedGradeReason: 'Clean copy, no visible defects.',
    modelPredictedGradeConfidence: 'high', modelPredictedAt: 1000,
  };
  const lockedEcho = { grade: 'VG 4.0', isGraded: false, numericGrade: null, conditionSummary: undefined, confidence: 'high', skipReason: 'grade_locked', locked: true, skippedVision: true };
  const nextPhotos = ['front.jpg', 'back.jpg'];
  const updatedLocked = buildUpdated(lockedItem, lockedEcho, nextPhotos, applyFirstModelPrediction);

  assertEq(updatedLocked.grade, 'VG 4.0', 'LOCKED item: grade is UNCHANGED after Add Photo (authoritative grade not silently replaced)');
  assertEq(updatedLocked.reason, 'Clean copy, no visible defects.', 'LOCKED item: reason is preserved (server echo carries no new reason field)');
  assertEq(updatedLocked.cgcPenaltyFlags, null, 'LOCKED item: cgcPenaltyFlags preserved (null → null)');
  assertEq(updatedLocked.images, nextPhotos, 'LOCKED item: the newly added photo IS still retained in images');
  assertEq(updatedLocked.modelPredictedGrade, 'VG 4.0', 'LOCKED item: calibration baseline unchanged (write-once, already set)');
  assertEq(updatedLocked.modelPredictedAt, 1000, 'LOCKED item: modelPredictedAt timestamp unchanged (not re-stamped)');

  // 3b — unlocked item, genuine new Vision response with a real lower grade
  // (a real new defect, not a locked echo) — today's overwrite behavior is
  // UNCHANGED for the unlocked case (explicitly in scope per the dispatch).
  const unlockedItem = {
    id: 'asm-316', title: 'Amazing Spider-Man', issue: '316', grade: 'FN 6.0', isGraded: false,
    numericGrade: null, reason: 'Minor spine stress.', confidence: 'medium',
    gradeLocked: false, cgcPenaltyFlags: null, images: ['front.jpg'],
  };
  const newVisionResult = { title: 'Amazing Spider-Man', issue: '316', grade: 'GD 2.0', reason: 'Detached centerfold visible on interior page.', confidence: 'medium', cgcPenaltyFlags: { staplePopping: { detected: true, severity: 'severe' } } };
  const updatedUnlocked = buildUpdated(unlockedItem, newVisionResult, ['front.jpg', 'interior.jpg'], applyFirstModelPrediction);

  assertEq(updatedUnlocked.grade, 'GD 2.0', 'UNLOCKED item: a genuine new Vision response still updates item.grade — unchanged today-behavior');
  assertEq(updatedUnlocked.reason, 'Detached centerfold visible on interior page.', 'UNLOCKED item: reason still updates — unchanged today-behavior');
  assertEq(updatedUnlocked.modelPredictedGrade, 'FN 6.0', 'UNLOCKED item: calibration baseline captures the FIRST model grade (FN 6.0), NOT the new GD 2.0 — this is the whole point of the baseline');
  assertTrue(typeof updatedUnlocked.modelPredictedAt === 'number', 'UNLOCKED item: modelPredictedAt is stamped on first capture');
  assertTrue(updatedUnlocked.grade !== updatedUnlocked.modelPredictedGrade, 'model prediction and current governing grade are independently readable and can legitimately differ (GD 2.0 vs FN 6.0)');

  // 3c — a SECOND add-photo call on the already-baselined item must not
  // touch the baseline again, even though item.grade keeps changing.
  const secondCallItem = { ...updatedUnlocked };
  const thirdVisionResult = { title: 'Amazing Spider-Man', issue: '316', grade: 'GD- 1.5', reason: 'Additional tear observed.', confidence: 'low' };
  const updatedThird = buildUpdated(secondCallItem, thirdVisionResult, ['front.jpg', 'interior.jpg', 'back.jpg'], applyFirstModelPrediction);
  assertEq(updatedThird.grade, 'GD- 1.5', 'a third grade call still updates item.grade (unlocked, unchanged behavior)');
  assertEq(updatedThird.modelPredictedGrade, 'FN 6.0', 'a THIRD model-grade call does not overwrite modelPredictedGrade — still the very first value');
  assertEq(updatedThird.modelPredictedGradeReason, 'Minor spine stress.', 'a THIRD model-grade call does not overwrite modelPredictedGradeReason');
  assertEq(updatedThird.modelPredictedGradeConfidence, 'medium', 'a THIRD model-grade call does not overwrite modelPredictedGradeConfidence');
  assertEq(updatedThird.modelPredictedAt, updatedUnlocked.modelPredictedAt, 'a THIRD model-grade call does not overwrite modelPredictedAt');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 4 — reIdentifyBook (explicit forceRegrade:true path) also
// applies the write-once baseline, and its existing forceRegrade
// override of item.grade itself is untouched.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Section 4: reIdentifyBook forceRegrade path + write-once baseline --');
{
  assertTrue(
    /forceRegrade: true, \/\/ FIX 2: Bypass grade lock for explicit re-identification/.test(appSource),
    'reIdentifyBook still explicitly sends forceRegrade:true — the one authorized override path is untouched'
  );
  assertTrue(
    /assetTypeConfident: enrichData\?\.assetTypeConfident \?\? gradeData\.assetTypeConfident \?\? true,\s*\n\s*enrichFailed,\s*\n\s*enrichError,\s*\n\s*\/\/ GrailKey Outcome #1 calibration patch[\s\S]*?\.\.\.applyFirstModelPrediction\(item, item\),\s*\n\s*\};/.test(appSource),
    'reIdentifyBook\'s updated object applies applyFirstModelPrediction(item, item) — sourced from the item\'s OWN prior state, never gradeData, so the forced re-grade cannot touch or seed the calibration baseline from its own output'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 5 — addToCatalogue seeds gradeLocked (previously dropped
// entirely — a pre-existing gap this patch had to close for the
// gradeLocked wiring above to ever fire) and the baseline on first save.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Section 5: addToCatalogue persists gradeLocked + seeds the baseline --');
{
  assertTrue(
    /gradeLocked: data\.gradeLocked === true,/.test(appSource),
    'addToCatalogue now persists gradeLocked onto the saved entry (previously always dropped, making item.gradeLocked permanently falsy for every saved item)'
  );
  assertTrue(
    /images: thumb \? \[thumb\] : \[\],\s*\n\s*\/\/ GrailKey Outcome #1 calibration patch[\s\S]*?\.\.\.applyFirstModelPrediction\(null, data\),\s*\n\s*\};/.test(appSource),
    'addToCatalogue seeds the calibration baseline via applyFirstModelPrediction(null, data) on every new item'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 6 — applyFirstModelPrediction itself: real exported function,
// executed directly (no extraction needed).
// ═══════════════════════════════════════════════════════════════════════
console.log('\n-- Section 6: applyFirstModelPrediction (real function, direct execution) --');
{
  const fresh = applyFirstModelPrediction(null, { grade: 'VG 4.0', reason: 'clean', confidence: 'high' });
  assertEq(fresh.modelPredictedGrade, 'VG 4.0', 'brand-new item (current=null) with a real grade → populates modelPredictedGrade');
  assertEq(fresh.modelPredictedGradeReason, 'clean', 'populates modelPredictedGradeReason');
  assertEq(fresh.modelPredictedGradeConfidence, 'high', 'populates modelPredictedGradeConfidence');
  assertTrue(typeof fresh.modelPredictedAt === 'number', 'populates modelPredictedAt as a timestamp');

  const alreadySet = applyFirstModelPrediction(
    { modelPredictedGrade: 'VG 4.0', modelPredictedGradeReason: 'clean', modelPredictedGradeConfidence: 'high', modelPredictedAt: 1000 },
    { grade: 'GD 2.0', reason: 'new defect found', confidence: 'medium' }
  );
  assertEq(alreadySet, {}, 'write-once: already-set baseline → {} (no-op), regardless of what the new data says');

  const noGradeYet = applyFirstModelPrediction(null, { title: 'Something', reason: 'x' });
  assertEq(noGradeYet, {}, 'no data.grade at all → {} (nothing to record yet)');

  const legacyItemMissingField = applyFirstModelPrediction({ modelPredictedGrade: null }, { grade: 'FN 6.0', reason: null, confidence: 'medium' });
  assertEq(legacyItemMissingField.modelPredictedGrade, 'FN 6.0', 'a legacy item saved before this patch (modelPredictedGrade absent/null) gets backfilled on its next real model grade');
  assertEq(legacyItemMissingField.modelPredictedGradeReason, null, 'null reason is preserved as null, not coerced');

  // Real call-site pattern used by addPhotoToComic/reIdentifyBook:
  // applyFirstModelPrediction(item, item) — backfill must come from the
  // item's OWN prior grade, never from a fresh incoming Vision response
  // that happens to be passed around it.
  const legacyLiveItem = { grade: 'FN 6.0', reason: 'Minor spine stress.', confidence: 'medium' };
  const backfillFromSelf = applyFirstModelPrediction(legacyLiveItem, legacyLiveItem);
  assertEq(backfillFromSelf.modelPredictedGrade, 'FN 6.0', 'applyFirstModelPrediction(item, item): backfills from the item\'s own established grade');
  assertEq(backfillFromSelf.modelPredictedGradeReason, 'Minor spine stress.', 'applyFirstModelPrediction(item, item): backfills the item\'s own reason');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:\n' + failures.join('\n\n'));
  process.exit(1);
}
process.exit(0);
