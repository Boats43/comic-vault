// tests/pricing-trust-p2-p3.test.js
//
// Pricing Trust dispatch (2026-09-23), Commit A — P2 + P3 only.
// (P1 — the key-issue multiplier trust boundary — is held uncommitted
// pending the Marvel Spotlight #28 provenance follow-up; its own test
// coverage lives separately in tests/pricing-trust-p1.test.js, not
// committed alongside this file.)
//
// P2 — isMegaKeyIdentityCorroborated (api/mega-keys.js) reconciled with
// deriveMarketStanding's (src/lib/actionAuthority.js) own three-way
// variantApplicability disqualification: CONTESTED, UNRESOLVED, and
// UNVERIFIED all now stand the floor down (previously only CONTESTED did).
// Required fixture: Giant-Size X-Men #1 CGC 4.0 + variantApplicability
// UNRESOLVED (the real VARIANT_UNRESOLVED_EDITION production shape) must
// no longer let the $2,500 static floor override stronger verified sold
// evidence.
//
// P3 — the "VERIFIED FLOOR" badge (src/App.jsx) must not claim current
// verification off historical sourcing alone. api/enrich.js now plumbs
// megaKeyFloorVerificationDue/megaKeyFloorLastVerified alongside
// megaKeyFloorVerified; App.jsx's isMegaKeyFloorCurrentlyVerified requires
// verified===true AND verificationDue!==true AND lastVerified!=null.
//
// Invoke: node tests/pricing-trust-p2-p3.test.js

import { readFileSync } from 'node:fs';
import { isMegaKeyIdentityCorroborated, getMegaKeyEntry, getMegaKeyFloor } from '../api/mega-keys.js';
import { isCorroboratedIdentitySource } from '../src/lib/identityCore.js';

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

console.log('\n=== Pricing Trust dispatch — P2/P3 (Commit A) ===\n');

// ═══════════════════════════════════════════════════════════════════════
// P2 — REQUIRED FIXTURE: Giant-Size X-Men #1 CGC 4.0 + UNRESOLVED
// ═══════════════════════════════════════════════════════════════════════
console.log('=== P2: GSX #1 CGC 4.0 + VARIANT_UNRESOLVED_EDITION → floor stands down ===');
{
  const entry = getMegaKeyEntry('Giant-Size X-Men', '1', 'Marvel', 1975);
  assertTrue(!!entry, 'PRE: the real "giant size x men|1" map entry exists');
  const floorAt4 = getMegaKeyFloor('Giant-Size X-Men', '1', 'Marvel', 1975, 'VF 8.0', 4.0);
  assertEq(floorAt4.floor, 2500, 'PRE: grade 4.0 bucket is the real $2,500 floor the production card showed');

  const unresolvedShape = {
    identitySource: 'title-family-weighted-consensus', // title itself corroborated
    yearAuthority: 'CORROBORATED',
    variantApplicability: 'UNRESOLVED', // the real VARIANT_UNRESOLVED_EDITION shape
    isCorroboratedIdentitySourceFn: isCorroboratedIdentitySource,
  };
  assertEq(isMegaKeyIdentityCorroborated(unresolvedShape), false, 'UNRESOLVED alone now stands the floor down (was previously unaffected)');

  // UNVERIFIED must independently also stand it down (same three-way
  // disqualification deriveMarketStanding already applies).
  assertEq(
    isMegaKeyIdentityCorroborated({ ...unresolvedShape, variantApplicability: 'UNVERIFIED' }),
    false,
    'UNVERIFIED alone now stands the floor down'
  );

  // CONTESTED must still stand it down (pre-existing behavior, unchanged).
  assertEq(
    isMegaKeyIdentityCorroborated({ ...unresolvedShape, variantApplicability: 'CONTESTED' }),
    false,
    'CONTESTED still stands the floor down (unchanged)'
  );

  // Negative control: a genuinely corroborated key (no confirmed variant
  // at all, variantApplicability: null) must still floor, full force.
  assertEq(
    isMegaKeyIdentityCorroborated({ ...unresolvedShape, variantApplicability: null }),
    true,
    'CONTROL: variantApplicability=null (no confirmed variant, not a disqualified state) — floor STILL fires'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// P3 — "VERIFIED FLOOR" truthfulness (App.jsx source-text proof — JSX,
// not independently importable; same static-check convention
// tests/u4-generic-asset-safety.test.js already uses for App.jsx-only logic)
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== P3: isMegaKeyFloorCurrentlyVerified gates on verificationDue/lastVerified ===');
{
  const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assertTrue(
    /isMegaKeyFloorCurrentlyVerified\s*=\s*\(item\)\s*=>[\s\S]{0,200}megaKeyFloorVerified === true[\s\S]{0,200}megaKeyFloorVerificationDue !== true[\s\S]{0,200}megaKeyFloorLastVerified != null/.test(src),
    'isMegaKeyFloorCurrentlyVerified requires verified===true AND verificationDue!==true AND lastVerified!=null'
  );
  // The literal "VERIFIED FLOOR" render sites must consult the truthful
  // gate, not the raw megaKeyFloorVerified flag directly.
  const badgeSite = src.match(/🔑 \{[^}]*VERIFIED FLOOR[^}]*\}/);
  assertTrue(!!badgeSite, 'PRE: the VERIFIED FLOOR badge render site exists');
  assertTrue(badgeSite[0].includes('trulyVerified'), 'VERIFIED FLOOR badge reads the gated trulyVerified value, not raw megaKeyFloorVerified');

  // Every entry in the real map has lastVerified:null today — proves the
  // fix is not a no-op: it changes real, current production display
  // behavior for every mega-key floor card, not just a hypothetical future
  // entry.
  const megaKeysSrc = readFileSync(new URL('../api/mega-keys.js', import.meta.url), 'utf8');
  const totalEntries = (megaKeysSrc.match(/lastVerified: null,/g) || []).length;
  assertTrue(totalEntries > 0, `PRE: at least one real map entry has lastVerified:null (found ${totalEntries}) — the truthfulness fix is load-bearing today, not dormant`);
}

console.log('\n=== P2: api/enrich.js plumbs verificationDue/lastVerified alongside megaKeyFloorVerified ===');
{
  const enrichSrc = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  assertTrue(enrichSrc.includes('out.megaKeyFloorVerificationDue = megaKeyEntry.verificationDue === true;'), 'enrich.js sets out.megaKeyFloorVerificationDue from the map entry');
  assertTrue(enrichSrc.includes('out.megaKeyFloorLastVerified = megaKeyEntry.lastVerified ?? null;'), 'enrich.js sets out.megaKeyFloorLastVerified from the map entry');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:\n' + failures.join('\n\n'));
  process.exit(1);
}
