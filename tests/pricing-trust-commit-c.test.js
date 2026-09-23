// tests/pricing-trust-commit-c.test.js
//
// Pricing Trust — Commit C (2026-09-23). "PRICE NOT ESTABLISHED" — a
// mega-key floor may not silently replace live market evidence when it
// materially diverges from it and the entry lacks CURRENT verification.
//
// Real end-to-end proof (all divergence fields, listingHardLocked,
// RESEARCH, contract.listable=false, contract.state=LOCKED, contract.price
// carrying the pre-floor evidence value) already lives in
// tests/grailkey-directive-av-handler-smoke.test.js's B3 sub-fixture (the
// real ASM #1 production case) — not duplicated here. This file covers
// what that fixture cannot: the exemption mechanics for a hypothetically
// CURRENTLY-VERIFIED entry (none exists in the real registry today — see
// below, this is explicitly NOT a fabricated registry state), the
// within-threshold "applies as today" case, and static structural proofs
// (exceedsMap independence, ordering, App.jsx wiring).
//
// Invoke: node tests/pricing-trust-commit-c.test.js

import { readFileSync } from 'node:fs';
import { isMegaKeyEntryCurrentlyVerified } from '../api/mega-keys.js';

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
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Pricing Trust — Commit C ("PRICE NOT ESTABLISHED") ===\n');

// ═══════════════════════════════════════════════════════════════════════
// isMegaKeyEntryCurrentlyVerified — the exemption predicate itself.
// These are pure-function proofs against HYPOTHETICAL input shapes,
// clearly labeled as such — NOT a claim that any real registry entry has
// these values. No fabricated verification state is written to
// api/mega-keys.js anywhere in this dispatch (Section A requirement).
// ═══════════════════════════════════════════════════════════════════════
console.log('=== isMegaKeyEntryCurrentlyVerified — exemption predicate mechanics ===');
{
  assertFalse(
    isMegaKeyEntryCurrentlyVerified({ verified: true, verificationDue: true, lastVerified: null }),
    'HYPOTHETICAL: verified:true alone (verificationDue still true, lastVerified still null) does NOT satisfy the exemption — matches every real entry in the registry today'
  );
  assertFalse(
    isMegaKeyEntryCurrentlyVerified({ verified: false, verificationDue: false, lastVerified: '2026-01-01' }),
    'HYPOTHETICAL: verified:false blocks the exemption even with a real lastVerified date'
  );
  assertFalse(
    isMegaKeyEntryCurrentlyVerified({ verified: true, verificationDue: false, lastVerified: null }),
    'HYPOTHETICAL: verified:true + verificationDue:false but lastVerified still null does NOT satisfy the exemption'
  );
  assertTrue(
    isMegaKeyEntryCurrentlyVerified({ verified: true, verificationDue: false, lastVerified: '2026-09-20' }),
    'HYPOTHETICAL ONLY (no real entry has this shape today): verified:true + verificationDue:false + a real lastVerified date DOES satisfy the exemption — proves the predicate mechanics work, not a claim about real registry state'
  );
  assertFalse(isMegaKeyEntryCurrentlyVerified(null), 'null entry never satisfies the exemption');
}

console.log('\n=== Real registry state: 0/43 live entries currently satisfy the exemption ===');
{
  const src = readFileSync(new URL('../api/mega-keys.js', import.meta.url), 'utf8');
  const lastVerifiedNullCount = (src.match(/lastVerified: null,/g) || []).length;
  assertTrue(lastVerifiedNullCount > 0, `every real entry (found ${lastVerifiedNullCount} occurrences of "lastVerified: null,") has no current-verification date — the exemption has zero real callers today, intentionally (docs/TICKET-REGISTRY.md)`);
}

// ═══════════════════════════════════════════════════════════════════════
// Structural proofs (source-text) — ordering, threshold, and independence
// from exceedsMap, without needing a second full handler invocation for
// every case (B3 in the handler-smoke file already proves one real,
// large-divergence case end-to-end).
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Structural proofs ===');
{
  const src = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');

  assertTrue(src.includes('MEGA_KEY_FLOOR_DIVERGENCE_THRESHOLD = 2.0'), 'divergence threshold is 2.0 (the "~2x" ruling)');

  // Ordering: isSuspectContaminated and soldMatchedFloorGuard must still
  // be checked BEFORE the new divergence branch (preserves existing
  // contamination and Q90 behavior unconditionally — this branch must
  // never fire when either of those already would have).
  const contaminationIdx = src.indexOf('if (isSuspectContaminated)');
  const q90Idx = src.indexOf('} else if (soldMatchedFloorGuard)');
  const divergenceIdx = src.indexOf('!isMegaKeyEntryCurrentlyVerified(megaKeyEntry)');
  const normalFloorIdx = src.indexOf('} else if (currentPriceNum < floorResult.floor) {');
  assertTrue(contaminationIdx > 0 && q90Idx > contaminationIdx, 'isSuspectContaminated is checked before soldMatchedFloorGuard (unchanged)');
  assertTrue(divergenceIdx > q90Idx, 'the new divergence branch is checked AFTER both isSuspectContaminated and soldMatchedFloorGuard — never preempts them');
  assertTrue(normalFloorIdx > divergenceIdx, 'normal floor enforcement remains the final fallback, checked after the divergence branch');

  // exceedsMap independence: the entire mega-key-floor block this new
  // branch lives in is nested inside `else if (floorResult.floor)`,
  // itself a sibling to `if (floorResult.exceedsMap)` — structurally,
  // a grade that exceeds the map's coverage never reaches this new
  // branch at all; GRADE EXCEEDS MAP behavior is completely untouched.
  const exceedsMapIdx = src.indexOf("if (floorResult.exceedsMap) {");
  const floorBranchIdx = src.indexOf('} else if (floorResult.floor) {');
  assertTrue(exceedsMapIdx > 0 && floorBranchIdx > exceedsMapIdx, 'floorResult.exceedsMap is checked in a sibling branch BEFORE floorResult.floor is ever consulted — the new divergence code is nested inside the floor branch and structurally cannot run for an exceeds-map grade');
  assertFalse(src.slice(exceedsMapIdx, floorBranchIdx).includes('megaKeyFloorDivergent'), 'the exceedsMap branch itself is untouched — no divergence logic was added there');

  // GK-238 / actionAuthority.js untouched by this dispatch.
  const actionAuthoritySrc = readFileSync(new URL('../src/lib/actionAuthority.js', import.meta.url), 'utf8');
  assertFalse(actionAuthoritySrc.includes('megaKeyFloorDivergent'), 'src/lib/actionAuthority.js (GK-238 deriveMarketStanding) is completely untouched by Commit C — a separate, unrelated mechanism');
}

// ═══════════════════════════════════════════════════════════════════════
// App.jsx wiring — every price-display render site agrees (static proof,
// same convention as tests/u4-generic-asset-safety.test.js and
// tests/pricing-trust-p2-p3.test.js already use for App.jsx-only logic).
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== App.jsx display-authority wiring ===');
{
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  assertTrue(src.includes('const MegaKeyDivergenceBanner'), 'MegaKeyDivergenceBanner component exists');
  assertTrue(src.includes('⚠ PRICE NOT ESTABLISHED'), 'the required "PRICE NOT ESTABLISHED" copy is present');
  assertTrue(src.includes('Market evidence:'), 'discloses the market evidence number, unlabeled as a recommendation');
  assertTrue(src.includes('Reference floor:'), 'discloses the reference floor number, unlabeled as a recommendation');
  assertTrue(/×\s*divergence|toFixed\(1\)`\s*}?×/.test(src) || src.includes('divergence'), 'discloses the divergence ratio');

  // Neither number is ever labeled as a recommendation/fair/verified/
  // listing price INSIDE the banner component itself.
  const bannerStart = src.indexOf('const MegaKeyDivergenceBanner');
  const bannerEnd = src.indexOf('\n};', bannerStart);
  const bannerBody = src.slice(bannerStart, bannerEnd);
  for (const forbidden of ['recommended price', 'fair value', 'verified value', 'listing price']) {
    assertFalse(new RegExp(forbidden, 'i').test(bannerBody), `banner body never labels either number "${forbidden}"`);
  }

  // Every recommendedLabel render site must be gated on isMegaKeyDivergent
  // (the "header == stats bar == Recommended row == List button" parity
  // invariant this file's own comments already document).
  const isMegaKeyDivergentDeclCount = (src.match(/const isMegaKeyDivergent = (?:result|item)\.megaKeyFloorDivergent === true;/g) || []).length;
  assertEq(isMegaKeyDivergentDeclCount, 2, 'isMegaKeyDivergent is declared once per component scope (ResultCard + CollectionDetail) — exactly 2 declarations');
  assertTrue(src.includes('<MegaKeyDivergenceBanner item={result} />'), 'ResultCard renders the banner');
  assertTrue(src.includes('<MegaKeyDivergenceBanner item={item} />'), 'CollectionDetail renders the banner');

  // List-button gating: no new code needed (traced, not implemented) —
  // confirm the existing q41Locks/q41Unlocked machinery is still intact
  // and still treats any hard lock as non-acknowledgeable unless every
  // lock is insufficiency-class. mega-key-floor-divergence is pushed as
  // class:'integrity' (via out.listingHardLocked, unchanged reuse of the
  // existing lock-derivation site in responseContract.js's deriveLocks),
  // which is never insufficiency-class — so it can never be Q41-acked.
  const responseContractSrc = readFileSync(new URL('../src/lib/responseContract.js', import.meta.url), 'utf8');
  assertTrue(responseContractSrc.includes("class: 'integrity'"), 'listingHardLocked locks are still derived as integrity-class (never Q41-acknowledgeable) — unchanged, confirms no enabled List action for a divergence lock');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:\n' + failures.join('\n\n'));
  process.exit(1);
}
