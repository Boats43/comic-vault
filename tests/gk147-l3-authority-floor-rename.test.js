// tests/gk147-l3-authority-floor-rename.test.js
//
// GK-147 / ADR-ADAPTER-001 Ruling 31 — L3 closure (U5-MINIMAL-B, 2026-09-23).
//
// Renames the `isMegaKey` opts field on two AssetCore pricing helpers
// (computeThinPoolAnchor, computeLowGradeFloor) to the domain-neutral
// `authorityFloorActive` — an interface rename only. The boolean value,
// the Mega Key lookup that feeds it (api/mega-keys.js, api/enrich.js's
// own `isMegaKeyForFloor`), guard ordering, and early-return behavior are
// all byte-identical to before this rename; only the AssetCore-facing
// option NAME changed.
//
// A3/A4/A5 disposition: dozens of established test call sites (tests/
// comp-filter-hygiene.test.js, tests/low-grade-floor.test.js) omit this
// option entirely and rely on undefined -> falsy ("floor inactive")
// behavior. That is a legitimate, pre-existing caller pattern — making
// omission throw/assert would be a real behavior-contract change for
// those callers, not a pure rename. Per A5 (pre-authorized fallback):
// no new runtime strictness was added. Instead this file (1) proves the
// explicit true/false/omission behavior is preserved exactly, and (2) is
// itself the CI contract that fails if a production call site is ever
// added/changed in api/enrich.js without explicitly accounting for
// `authorityFloorActive` — the detectable-by-CI substitute for runtime
// strictness A5 calls for.
//
// Invoke: node tests/gk147-l3-authority-floor-rename.test.js

import { readFileSync } from 'node:fs';
import { computeThinPoolAnchor, computeLowGradeFloor } from '../src/lib/pricingEngine.js';

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
const assertNull = (actual, label) => assertEq(actual, null, label);
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-147 L3 — authorityFloorActive rename ===\n');

// ─── computeThinPoolAnchor: explicit true / false / omission ───
console.log('computeThinPoolAnchor:');
{
  // count must be exactly 2 for the anchor to be eligible to fire at all
  // ("Anchor now fires only at count=2", pricingEngine.js) — otherwise
  // every case below would return null regardless of authorityFloorActive,
  // which would prove nothing about the option itself.
  const thinPoolArgs = [50000, { count: 2, highest: 100 }];

  assertNull(
    computeThinPoolAnchor(...thinPoolArgs, { authorityFloorActive: true }),
    'authorityFloorActive: true — skips (authoritative floor active), matches old isMegaKey:true behavior'
  );

  const explicitFalse = computeThinPoolAnchor(...thinPoolArgs, { authorityFloorActive: false });
  assertTrue(
    explicitFalse && explicitFalse.shouldAnchor === true,
    'authorityFloorActive: false — does NOT skip, anchor computed normally'
  );

  const omitted = computeThinPoolAnchor(...thinPoolArgs, {});
  assertEq(
    JSON.stringify(omitted),
    JSON.stringify(explicitFalse),
    'omission produces the SAME result as explicit false — preserved undefined→falsy behavior (A5)'
  );
}

// ─── computeLowGradeFloor: explicit true / false / omission ───
console.log('\ncomputeLowGradeFloor:');
{
  const lgfArgs = [30, { lowest: 8 }, { total: 65, belowGrade: 0, atGrade: 1, aboveGrade: 64 }];

  assertNull(
    computeLowGradeFloor(...lgfArgs, { pricingSource: 'browse_api', authorityFloorActive: true }),
    'authorityFloorActive: true — skips (authoritative floor active), matches old isMegaKey:true behavior'
  );

  const explicitFalse = computeLowGradeFloor(...lgfArgs, { pricingSource: 'browse_api', authorityFloorActive: false });
  assertTrue(
    explicitFalse && explicitFalse.shouldAnchor === true,
    'authorityFloorActive: false — does NOT skip, floor computed normally'
  );

  const omitted = computeLowGradeFloor(...lgfArgs, { pricingSource: 'browse_api' });
  assertEq(
    JSON.stringify(omitted),
    JSON.stringify(explicitFalse),
    'omission produces the SAME result as explicit false — preserved undefined→falsy behavior (A5)'
  );
}

// ─── Source-contract: zero stale AssetCore interface references ───
console.log('\nSource-contract — stale interface-name guard:');
{
  const pricingSrc = readFileSync(new URL('../src/lib/pricingEngine.js', import.meta.url), 'utf8');
  const enrichSrc = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');

  // Old opts-key usage (`isMegaKey:` / `{ isMegaKey`) must be completely
  // gone from both files that implement/call the AssetCore interface.
  // Legitimate domain symbols (isMegaKeyForFloor, isMegaKeyIdentityCorroborated,
  // isMegaKeyEntryCurrentlyVerified, api/mega-keys.js's own isMegaKey()) do
  // NOT match this pattern — it is scoped to the opts-key/destructure shape only.
  const staleOptsKeyRe = /\bisMegaKey\s*[,:]/;
  assertTrue(!staleOptsKeyRe.test(pricingSrc), 'src/lib/pricingEngine.js contains zero stale `isMegaKey:`/`isMegaKey,` opts-interface references');
  // enrichSrc legitimately contains `isMegaKeyForFloor` (a real domain
  // variable, not the interface option) — scope the check to the
  // opts-construction shape only, not the whole file.
  const enrichOptsKeyStale = /authorityFloorActive:\s*undefined|\{\s*isMegaKey\s*:/;
  assertTrue(!enrichOptsKeyStale.test(enrichSrc), 'api/enrich.js contains zero stale bare `{ isMegaKey:` opts-construction sites');

  assertTrue(pricingSrc.includes('authorityFloorActive'), 'src/lib/pricingEngine.js defines the new authorityFloorActive interface');

  // Production call-site completeness (the CI substitute for runtime
  // strictness, per A5 point 4): every computeThinPoolAnchor(/
  // computeLowGradeFloor( call in api/enrich.js must pass
  // authorityFloorActive explicitly in its opts block. Generic to future
  // call sites — does not hardcode today's line numbers.
  const checkAllCallSitesPassOption = (fnName) => {
    const callRe = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
    let match;
    let siteCount = 0;
    let compliantCount = 0;
    while ((match = callRe.exec(enrichSrc)) !== null) {
      siteCount++;
      const start = match.index;
      const closeIdx = enrichSrc.indexOf('});', start);
      const block = closeIdx > start ? enrichSrc.slice(start, closeIdx + 3) : enrichSrc.slice(start, start + 400);
      if (block.includes('authorityFloorActive')) compliantCount++;
    }
    return { siteCount, compliantCount };
  };

  const thinPool = checkAllCallSitesPassOption('computeThinPoolAnchor');
  assertTrue(thinPool.siteCount >= 1, `computeThinPoolAnchor has at least one production call site (found ${thinPool.siteCount})`);
  assertEq(thinPool.compliantCount, thinPool.siteCount, `every computeThinPoolAnchor( call site in api/enrich.js passes authorityFloorActive explicitly (${thinPool.compliantCount}/${thinPool.siteCount})`);

  const lowGradeFloor = checkAllCallSitesPassOption('computeLowGradeFloor');
  assertTrue(lowGradeFloor.siteCount >= 1, `computeLowGradeFloor has at least one production call site (found ${lowGradeFloor.siteCount})`);
  assertEq(lowGradeFloor.compliantCount, lowGradeFloor.siteCount, `every computeLowGradeFloor( call site in api/enrich.js passes authorityFloorActive explicitly (${lowGradeFloor.compliantCount}/${lowGradeFloor.siteCount})`);
}

// ─── Summary ───
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
