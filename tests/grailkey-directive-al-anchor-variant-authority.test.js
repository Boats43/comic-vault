// tests/grailkey-directive-al-anchor-variant-authority.test.js
//
// GrailKey Directive 2026-08-16-AL — GK-109 (PC anchor custody) + GK-120
// (variant authority). See CLAUDE.md's own entry for this directive for
// the full production trace (Sabrina/Venom/Detective, 2026-08-16 01:59,
// build 2bb1b01).
//
// GOVERNING MODEL: VALUE != AUTHORITY. Vision's own confirmedVariant text
// is evidence, never automatically trusted authority for PC candidate
// matching. PriceCharting is a catalog candidate source, not physical-
// object/price/transaction authority.
//
// This file covers what's independently, pure-function testable:
//   Part 1 (GK-120, C4, B3) — selectBestVariantCandidate's new acceptance
//     floor + hard-negative creator veto, using the EXACT production
//     strings from the Venom and Sabrina fixtures named in the directive.
//   Part 2 (GK-109, C6/C7, B1/B2) — the year-reprojection + era-filter
//     logic the atomic anchor projection (api/enrich.js's N2 block)
//     relies on, proven directly against the real resolveYear/
//     applyEraConsistencyFilter functions with the production pcYear
//     values (1971 -> 2022).
//   Part 3 — source-text assertions that the atomic-projection code
//     itself is wired into api/enrich.js's N2 block (not independently
//     unit-testable as a pure function — same documented limitation as
//     Commit N's own N2, see grailkey-commit-n-variant-anchor-ordering.
//     test.js's header), so a future silent revert of the wiring is
//     still caught even though the glue code isn't a pure function.
//
// Invoke: node tests/grailkey-directive-al-anchor-variant-authority.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import fs from 'fs';
import { selectBestVariantCandidate, variantTokenOverlapScore, resolveYear } from '../src/lib/identityCore.js';
import { applyEraConsistencyFilter } from '../api/comps.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

console.log('\n=== GrailKey Directive AL — PC Anchor Custody + Variant Authority ===\n');

// ─── Part 1: GK-120 / B3 — Venom Kirkham-vs-Mayhew, exact production shape ─
console.log('Part 1a: Venom production shape — confirmedVariant="Tyler Kirkham variant" vs sole candidate "[Mayhew Virgin] #1 (2024)"');
{
  const candidates = [
    { price: 40, productName: 'Venom Separation Anxiety [Mayhew Virgin] #1 (2024)', id: 9001, year: 2024, source: 'pricecharting' },
  ];
  const best = selectBestVariantCandidate(candidates, 'Tyler Kirkham variant');
  check(best === null, 'Kirkham fails the floor — Mayhew candidate is hard-vetoed, NOT installed as a best-of-bad match');
  check(variantTokenOverlapScore('Tyler Kirkham variant', candidates[0].productName) === 0, 'sanity: raw token overlap really is 0 for this pair');
}

console.log('\nPart 1b: Venom shape with MULTIPLE deferred candidates, one genuinely matching creator present');
{
  const candidates = [
    { price: 40, productName: 'Venom Separation Anxiety [Mayhew Virgin] #1 (2024)', id: 9001, year: 2024, source: 'pricecharting' },
    { price: 55, productName: 'Venom Separation Anxiety [Kirkham Virgin] #1 (2024)', id: 9002, year: 2024, source: 'pricecharting' },
  ];
  const best = selectBestVariantCandidate(candidates, 'Tyler Kirkham variant');
  check(best?.id === 9002, 'when a genuine Kirkham candidate DOES exist, it wins — the floor/veto only refuses when nothing genuinely matches');
}

// ─── Part 1c: Sabrina's own confirmedVariant is NOT falsely vetoed ─────────
console.log('\nPart 1c: Sabrina production shape — confirmedVariant genuinely matches a real candidate, must NOT be refused');
{
  const candidates = [
    { price: 45, productName: 'Sabrina Anniversary Spectacular [NYCC Parent] #1 (2022)', id: 5001, year: 2022, source: 'pricecharting' },
    { price: 60, productName: 'Sabrina Anniversary Spectacular [NYCC Pink Foil] #1 (2023)', id: 5002, year: 2023, source: 'pricecharting' },
  ];
  const best = selectBestVariantCandidate(candidates, 'Dan Parent NYCC Foil variant');
  check(best !== null, 'a genuinely corroborated variant (shared "nycc"/"parent"/"foil" tokens) is NOT refused by the new floor');
  check([5001, 5002].includes(best?.id), `winner is one of the two real, token-overlapping candidates, not refused (got id=${best?.id})`);
}

// ─── Part 1d: null confirmedVariant — completely unaffected (R4, no new READY) ─
console.log('\nPart 1d: null confirmedVariant is fully unaffected by the floor/veto (unchanged Q108 behavior)');
{
  const candidates = [
    { price: 6, productName: 'Wonder Woman [Jenny Frison] #75 (2019)', id: 1001, year: 2019, source: 'pricecharting' },
  ];
  check(selectBestVariantCandidate(candidates, null)?.id === 1001, 'no confirmedVariant to score against -> candidates[0], unchanged');
}

// ─── Part 2: GK-109 / B1+B2 — year reprojection + era-filter survival ──────
console.log('\nPart 2a: resolveYear with the STALE base-entry pcYear (1971) — reproduces the pre-fix Sabrina defect in isolation');
{
  // No user/vision year at all (the documented real-production shape —
  // CLAUDE.md's own "Year override guard" section: branches (c)/(d)
  // accept PC's year unconditionally with zero plausibility check when
  // userYear is absent).
  const staleResolution = resolveYear(null, 1971, null, null, {});
  check(staleResolution.confirmedYear === '1971', 'sanity: reproduces the exact pre-fix defect — confirmedYear=1971 from the stale base-entry anchor');
}

console.log('\nPart 2b: resolveYear re-run with the REANCHORED candidate\'s pcYear (2022) — 1971 is eliminated');
{
  const reanchoredResolution = resolveYear(null, 2022, null, null, {});
  check(reanchoredResolution.confirmedYear === '2022', 'confirmedYear is now 2022 (from the NYCC Parent candidate\'s own PC year), not 1971');
  check(reanchoredResolution.confirmedYear !== '1971', 'B1: 1971 is not the resolved year after reprojection');
}

console.log('\nPart 2c: era filter with confirmedYear=2022 — the operator\'s own 2024 LTD-50 row SURVIVES (B2)');
{
  const pool = [
    { title: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50', price: 65 },
  ];
  const result = applyEraConsistencyFilter(pool, 2022, 'comic', null);
  check(result.pool.length === 1, 'B2: the operator\'s own book (2024) survives era-filtering against confirmedYear=2022 (tolerance ±3 for modern era)');
}

console.log('\nPart 2d: control — era filter with the STALE confirmedYear=1971 rejects the same row (proves the defect this fix closes)');
{
  const pool = [
    { title: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50', price: 65 },
  ];
  const result = applyEraConsistencyFilter(pool, 1971, 'comic', null);
  check(result.pool.length === 0, 'control: with the pre-fix stale year (1971), the operator\'s own book WAS rejected (2024 vs 1971, gap 53y > tolerance) — this is the exact defect B1/B2 close');
}

console.log('\nPart 2e: null/unresolved year — era filter passes everything through (C7 "unresolved beats confidently wrong" is SAFE, not a new failure mode)');
{
  const pool = [
    { title: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50', price: 65 },
    { title: 'Some Completely Unrelated Book #1 1950', price: 5 },
  ];
  const result = applyEraConsistencyFilter(pool, null, 'comic', null);
  check(result.pool.length === 2, 'null confirmedYear skips the era axis entirely (no hard-reject, no false pass of a DIFFERENT era-check) — confirms Task 3-J\'s trace finding directly');
}

// ─── Part 3: source-text wiring proof (N2 atomic projection is inline handler code, not a pure function — same documented limitation as Commit N) ─
console.log('\nPart 3: atomic anchor projection is wired into api/enrich.js\'s N2 block');
{
  const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const n2BlockStart = enrichSrc.indexOf('GrailKey Directive 2026-08-16-AL (GK-109, C6) — atomic anchor');
  const n2Block = n2BlockStart >= 0 ? enrichSrc.slice(n2BlockStart, n2BlockStart + 3000) : '';
  check(
    n2Block.includes('out.pcProductId = priceCharting.id || null;')
      && n2Block.includes('out.pcProductName = priceCharting.productName || null;')
      && n2Block.includes('out.pcEbayEpid = null;')
      && n2Block.includes('out.pcLastUpdated = null;'),
    'N2 re-projects out.pcProductId/pcProductName/pcEbayEpid/pcLastUpdated from the NEW anchor (GK-109 stale-out-fields fix)'
  );
  check(
    enrichSrc.includes("'n2-reanchor-year-reproject'"),
    'N2 re-derives confirmedYear via resolveYear, tagged with the n2-reanchor-year-reproject site name (GK-109 stale-year fix)'
  );
  check(
    enrichSrc.includes('String(confirmedYear ?? \'\') === String(pcYear ?? \'\')'),
    'year reprojection is guarded on confirmedYear still equalling the OLD anchor\'s pcYear — does not stomp an intervening, more-specific year correction (Q58-TITLE/Q86/q99-b/pc-anchor-rejected-corrected)'
  );
  const identityCoreSrc = fs.readFileSync(new URL('../src/lib/identityCore.js', import.meta.url), 'utf8');
  check(
    identityCoreSrc.includes('bestScore > 0 ? best : null'),
    'selectBestVariantCandidate enforces the score floor at its single source of truth (identityCore.js)'
  );
  check(
    identityCoreSrc.includes('hasCreatorConflict'),
    'selectBestVariantCandidate calls the hard-negative creator-conflict veto'
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
}
// api/comps.js's kv-cache layer initializes an Upstash Redis client with a
// keep-alive HTTP agent even when unconfigured — explicit exit so this
// script terminates instead of hanging on a dangling handle (same pattern
// as tests/q141-v0i-slab-exclusion.test.js).
process.exit(failed > 0 ? 1 : 0);
