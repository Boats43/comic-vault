// tests/gk213a-identity-authority.test.js
//
// GK-213A (Operator Authority — Product Refinement/Grading Program, GK-213
// item #1) — OPERATOR-ESTABLISHED FACTS OUTRANK FRESH MODEL OUTPUT.
//
// Confirmed defect (this dispatch chain, "GK-257" finding, implemented here
// under GK-213's own doctrine rather than as a separate ticket):
// applyProvisionalIdentity() returned title/issue/year/publisher/variant from
// a fresh identityProvisional response with NO identityAuthority check at
// all — unlike mergeConfirmedIdentity, which DOES check it — and its output
// wins the key collision at every call site (spread last). Two merge sites
// (reIdentifyBook, duplicate-confirm) used neither shared helper at all,
// unconditionally overwriting title/issue/year/publisher on every call.
//
// Section 1-3: direct tests of the three real exported pure functions
// (dataQualityGuard.js) — these are the actual functions every one of the
// 6 (now 7) merge sites in App.jsx delegates to; fixing them fixes every
// site that calls them unmodified.
// Section 4-5: real-source-extraction tests of the two NEWLY wired call
// sites (reIdentifyBook, duplicate-confirm) — same technique this repo
// already established (tests/grailkey-outcome1-grading-calibration-patch
// .test.js): the literal shipped block is extracted from the live App.jsx
// via anchored regex and executed as real JavaScript, not paraphrased.
// Section 6: structural wiring spot-check for the 5 already-centralized
// sites — confirms mergeConfirmedIdentity/applyProvisionalIdentity are
// still present, in the correct (later-wins) order, at each one.
//
// Invoke: node tests/gk213a-identity-authority.test.js

import { readFileSync } from 'node:fs';
import {
  mergeConfirmedIdentity,
  applyProvisionalIdentity,
  detectIdentityConflict,
  mergeIdentityAuthority,
} from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-213A — Operator Authority: identity-field enforcement ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Section 1 — mergeConfirmedIdentity: already-correct baseline (confirms
// the non-provisional path was never broken)
// ═══════════════════════════════════════════════════════════════════════
console.log('Section 1: mergeConfirmedIdentity respects OPERATOR_CONFIRMED (baseline)');

{
  const prior = { title: 'Amazing Spider-Man', issue: '300', identityAuthority: { title: 'OPERATOR_CONFIRMED' } };
  const enrich = { title: 'Amazing Spider-Man Annual', issue: '300' }; // no identityAuthority key -> preserves prior's
  const result = mergeConfirmedIdentity(enrich, prior);
  assertEq(result.title, 'Amazing Spider-Man', 'locked title survives a disagreeing non-provisional response');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 2 — applyProvisionalIdentity: THE FIX ITSELF
// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 2: applyProvisionalIdentity now respects OPERATOR_CONFIRMED (the fix)');

{
  const prior = {
    title: 'The Rationalists', issue: null, year: '2020', publisher: 'Test Press', variant: null,
    identityAuthority: { title: 'OPERATOR_CONFIRMED', publisher: 'OPERATOR_CONFIRMED' },
  };
  const provisionalConflict = {
    identityProvisional: true,
    title: 'INDIA - PERSONALITY LECTURES DELIVERED IN AMERICA BY RABINDRANATH TAGORE',
    issue: null,
    year: null,
    publisher: 'Some Other Press',
    variantNote: null,
  };
  const result = applyProvisionalIdentity(provisionalConflict, prior);
  assertEq(result.title, 'The Rationalists', 'locked title survives a provisional pool-family adoption (was the live defect)');
  assertEq(result.publisher, 'Test Press', 'locked publisher survives too (independently locked field)');
  assertEq(result.year, null, 'unlocked field (year) still takes the honest provisional null');

  // Unlocked case — provisional override still works exactly as before for a field with no lock.
  const priorUnlocked = { title: 'Old Title', identityAuthority: {} };
  const resultUnlocked = applyProvisionalIdentity(provisionalConflict, priorUnlocked);
  assertEq(resultUnlocked.title, provisionalConflict.title, 'unlocked title still adopts the provisional value (no regression to Comic/general behavior)');

  // Non-provisional response — function is still a pure no-op, byte-identical to before this fix.
  assertEq(applyProvisionalIdentity({ identityProvisional: false, title: 'X' }, prior), {}, 'non-provisional response is still a no-op ({})');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 3 — detectIdentityConflict: the surfacing mechanism
// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 3: detectIdentityConflict surfaces real disagreements, not noise');

{
  const prior = { title: 'The Rationalists', publisher: 'Test Press', identityAuthority: { title: 'OPERATOR_CONFIRMED' } };

  assertEq(
    detectIdentityConflict({ title: 'A Totally Different Book' }, prior),
    [{ field: 'title', operatorConfirmedValue: 'The Rationalists', freshValue: 'A Totally Different Book' }],
    'genuine disagreement on a locked field is reported'
  );
  assertEq(detectIdentityConflict({ title: 'the rationalists' }, prior), null, 'case/whitespace-only agreement is NOT a conflict');
  assertEq(detectIdentityConflict({ title: null }, prior), null, 'an honest fresh null is "no new evidence," not a conflict');
  assertEq(detectIdentityConflict({}, prior), null, 'key absent entirely is not a conflict');
  assertEq(detectIdentityConflict({ publisher: 'Someone Else' }, prior), null, 'disagreement on an UNLOCKED field is not reported');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 4 — reIdentifyBook: real source-extraction proof
// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 4: reIdentifyBook — real shipped source, executed as real code');

{
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const anchorStart = 'const reIdentifyFreshIdentity = {';
  const anchorEndMarker = 'applyProvisionalIdentity(reIdentifyFreshIdentity, item),';
  const startIdx = appSource.indexOf(anchorStart);
  const markerIdx = appSource.indexOf(anchorEndMarker);
  const endIdx = markerIdx === -1 ? -1 : appSource.indexOf('};', markerIdx) + 2;
  assertTrue(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'reIdentifyBook GK-213A block found in live App.jsx (source anchors intact)');

  const block = appSource.slice(startIdx, endIdx);
  // Compile the extracted block as a real function body against fixture
  // inputs shaped exactly like reIdentifyBook's real closure variables.
  const fn = new Function(
    'gradeData', 'issueNum', 'enrichData', 'item',
    'mergeConfirmedIdentity', 'applyProvisionalIdentity', 'detectIdentityConflict',
    `${block}\nreturn { protectedIdentity, identityAuthorityConflict };`
  );

  const item = {
    title: 'The Rationalists', issue: null, year: '2020', publisher: 'Test Press',
    identityAuthority: { title: 'OPERATOR_CONFIRMED', publisher: 'OPERATOR_CONFIRMED' },
  };
  const gradeData = { title: 'INDIA - PERSONALITY LECTURES...TAGORE', variant: null, publisher: 'A Different Press' };
  const enrichData = { confirmedYear: '2020', identityProvisional: false };

  const { protectedIdentity, identityAuthorityConflict } = fn(
    gradeData, null, enrichData, item,
    mergeConfirmedIdentity, applyProvisionalIdentity, detectIdentityConflict
  );

  assertEq(protectedIdentity.title, 'The Rationalists', 'reIdentifyBook (real shipped code): OPERATOR_CONFIRMED title survives a conflicting fresh re-identification');
  assertEq(protectedIdentity.publisher, 'Test Press', 'reIdentifyBook (real shipped code): OPERATOR_CONFIRMED publisher survives too');
  assertTrue(Array.isArray(identityAuthorityConflict) && identityAuthorityConflict.length === 2, 'reIdentifyBook (real shipped code): the conflict is surfaced (both locked fields), not silently dropped');

  // Deliberate re-identification on an UNLOCKED item still works normally.
  const unlockedItem = { title: 'Old Title', publisher: 'Old Press', identityAuthority: {} };
  const { protectedIdentity: unlockedResult, identityAuthorityConflict: noConflict } = fn(
    gradeData, null, enrichData, unlockedItem,
    mergeConfirmedIdentity, applyProvisionalIdentity, detectIdentityConflict
  );
  assertEq(unlockedResult.title, gradeData.title, 'reIdentifyBook (real shipped code): unlocked item still adopts fresh re-identification normally');
  assertEq(noConflict, null, 'reIdentifyBook (real shipped code): no conflict reported when nothing is locked');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 5 — duplicate-confirm: real source-extraction proof
// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 5: duplicate-confirm — real shipped source, executed as real code');

{
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const anchorMarker = 'const idGatedDup = enrich.identityConfident === false || enrich.assetTypeConfident === false;';
  const idx = appSource.indexOf(anchorMarker);
  assertTrue(idx !== -1, 'duplicate-confirm merge block found in live App.jsx (source anchor intact)');

  // Grab from the anchor through the closing `};` of the `updated` object
  // literal — a fixed-size slice is fragile against unrelated edits
  // elsewhere in the file, so anchor on the literal's own start/end tokens.
  const objStart = appSource.indexOf('const updated = { ...cur,', idx);
  const objEnd = appSource.indexOf('};', appSource.indexOf('applyProvisionalIdentity(enrich, cur),', objStart)) + 2;
  assertTrue(objStart !== -1 && objEnd > objStart, 'duplicate-confirm updated-object literal bounds located');

  const block = appSource.slice(idx, objEnd);
  const fn = new Function(
    'enrich', 'cur', 'mergeConfirmedIdentity', 'applyProvisionalIdentity',
    `${block}\nreturn updated;`
  );

  const cur = {
    title: 'The Rationalists', identityAuthority: { title: 'OPERATOR_CONFIRMED' },
  };
  const conflictingEnrich = {
    title: 'A Totally Different Book', identityConfident: true, assetTypeConfident: true,
  };
  const updated = fn(conflictingEnrich, cur, mergeConfirmedIdentity, applyProvisionalIdentity);
  assertEq(updated.title, 'The Rationalists', 'duplicate-confirm (real shipped code): OPERATOR_CONFIRMED title survives a conflicting enrich response');

  const unlockedCur = { title: 'Old Title', identityAuthority: {} };
  const updatedUnlocked = fn(conflictingEnrich, unlockedCur, mergeConfirmedIdentity, applyProvisionalIdentity);
  assertEq(updatedUnlocked.title, conflictingEnrich.title, 'duplicate-confirm (real shipped code): unlocked item now DOES adopt a corrected title (closes the pre-existing site-parity gap — title was previously frozen forever on this path)');
}

// ═══════════════════════════════════════════════════════════════════════
// Section 6 — the 5 already-centralized sites: wiring spot-check
// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 6: already-centralized sites — wiring topology intact');

{
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const sites = [
    { name: 'auto-refresh', priceVar: 'priceChangedAR' },
    { name: 'initial-scan → catalogue', priceVar: 'priceChanged =' },
    { name: 'initial-scan → selectedItem', priceVar: 'priceChangedSel' },
    { name: 'bulk-import → catalogue', priceVar: 'priceChangedBulk' },
    { name: 'refreshMarketData → catalogue', priceVar: 'priceChangedRM' },
  ];
  for (const site of sites) {
    const anchorIdx = appSource.indexOf(site.priceVar);
    assertTrue(anchorIdx !== -1, `${site.name}: closure anchor (${site.priceVar}) found`);
    const nextMergeConfirmed = appSource.indexOf('...mergeConfirmedIdentity(', anchorIdx);
    const nextApplyProvisional = appSource.indexOf('...applyProvisionalIdentity(', anchorIdx);
    assertTrue(
      nextMergeConfirmed !== -1 && nextApplyProvisional !== -1 && nextApplyProvisional > nextMergeConfirmed && (nextMergeConfirmed - anchorIdx) < 20000,
      `${site.name}: mergeConfirmedIdentity then applyProvisionalIdentity both present, in that order, within the same closure (applyProvisionalIdentity wins the collision — this is what the Section 2 fix protects)`
    );
  }
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
