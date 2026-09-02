// tests/d3-1-candidate-safe-mint-basis.test.js
//
// D3.1 — candidate-safe mint basis. Pure-function proof (no DB) for
// src/modules/capture/mapping.js's buildCaptureBasis(). See
// tests/d3-1-mint-basis-live-roundtrip.test.js for the real-DB proof
// that this actually prevents/allows collision through the live mint
// mechanism (repository.js's mintAsset + entity_mint_basis).
//
// D3 AMENDMENT A1 DISCLOSURE — read before trusting this file's claim of
// "byte-compatibility": the amendment's own premise ("Existing
// entity_mint_basis rows in live data1_dev were created under the
// current single-object key format based on principalId/correlationId")
// was checked directly against live data1_dev as part of this dispatch
// and does NOT hold. FACT, confirmed live: `git log` shows
// src/modules/capture/mapping.js has exactly one commit ever (083c8ff,
// "CAPTURE-INT: a scan becomes an asset (internal/staging only)") and
// `grep -rn captureFromScan api/` returns zero matches — buildCaptureBasis
// has NEVER been called by any live-wired code path. A live query of all
// 110 real entity_mint_basis rows under basis_namespace='asset:capture-event'
// found three distinct shapes, none matching buildCaptureBasis's own
// output: 9 rows shaped "<principalId>:<ISO-timestamp>:<64-hex-hash>"
// (mint_policy_version='data1-foundation-slice-v1', the earliest DATA-1B
// proof-harness fixtures) and 101 rows shaped as hand-built JSON objects
// with fields like {title,issue,variant,correlationId,scanlogKey,basisKey}
// or {test,ts} (mint_policy_version='data1b-asset-service-v1', later S3-x/
// T3-x fixture scripts) — all written by ad-hoc proof scripts that called
// createPhysicalAsset directly with a hand-built captureBasis string/
// object, bypassing this module entirely. Because of this, the byte-
// compatibility proof this file actually performs is: buildCaptureBasis's
// OWN before/after behavior for the legacy (no-discriminator) call shape,
// captured as fixed expected-output vectors BEFORE the D3.1 edit and
// re-asserted here — not a comparison against a live database row, since
// no live row was ever produced by this function to compare against. The
// live mint mechanism itself (service.js's createPhysicalAsset,
// repository.js's mintAsset) is untouched by D3.1 — see
// tests/d3-1-mint-basis-live-roundtrip.test.js for the live proof that
// the 110 existing rows (regardless of which of the 3 shapes above) are
// unaffected, because nothing in the write path that produced them was
// changed.
//
// Invoke: node tests/d3-1-candidate-safe-mint-basis.test.js

import { buildCaptureBasis } from '../src/modules/capture/mapping.js';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertEqual = (actual, expected, label) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assertTrue(ok, ok ? label : `${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

console.log('\n=== D3.1 — candidate-safe mint basis (pure-function proof) ===\n');

// ---------------------------------------------------------------------
// Amendment A1 — legacy (no discriminator) call shape, byte-identical to
// this function's own pre-D3.1 behavior. Two representative scanPayload
// shapes: correlationId present, and correlationId absent (scanlogKey
// fallback) — both real branches the ORIGINAL (pre-D3.1) expression had.
// ---------------------------------------------------------------------
{
  const principalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba'; // real principal (Jimmy), for realism only
  const scanPayload = {
    correlationId: '5cdmw-1787382486651-206fb6db836b',
    scanlogKey: 'scanlog:v1:1787382488397:sfo1::5cdmw-1787382486651-206fb6db836b',
    book: { title: 'g i joe', issue: '5', year: '1987' },
  };
  const result = buildCaptureBasis(principalId, scanPayload);
  // This exact object shape/order/values is what the PRE-D3.1 function
  // body (`key = correlationId ? principalId/correlationId : principalId/scanlogKey`,
  // returning exactly {namespace,key,book,correlationId,scanlogKey}) would
  // have produced — captured here as the frozen legacy-compatibility vector.
  assertEqual(
    result,
    {
      namespace: 'asset:capture',
      key: `${principalId}/${scanPayload.correlationId}`,
      book: scanPayload.book,
      correlationId: scanPayload.correlationId,
      scanlogKey: scanPayload.scanlogKey,
    },
    'legacy call (correlationId present, no discriminator) matches the pre-D3.1 object shape exactly'
  );
  assertTrue(
    !('candidateDiscriminator' in result),
    'legacy call result has no candidateDiscriminator key at all (not even null) — JSON.stringify would differ if it did'
  );
  const json = JSON.stringify(result);
  assertEqual(
    JSON.parse(json),
    result,
    'JSON.stringify round-trips losslessly (sanity check for the live-comparison reasoning above)'
  );
}
{
  const principalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
  const scanPayload = {
    correlationId: null, // falsy — must take the scanlogKey branch, exactly like the original `?:`
    scanlogKey: 'scanlog:v1:1787382488397:sfo1::no-correlation-case',
    book: null,
  };
  const result = buildCaptureBasis(principalId, scanPayload);
  assertEqual(
    result,
    {
      namespace: 'asset:capture',
      key: `${principalId}/${scanPayload.scanlogKey}`,
      book: null,
      correlationId: null,
      scanlogKey: scanPayload.scanlogKey,
    },
    'legacy call (correlationId absent, scanlogKey fallback, no discriminator) matches the pre-D3.1 branch exactly'
  );
}

// ---------------------------------------------------------------------
// Requirement A — same observation basis + same discriminator ->
// deterministic replay (identical object on repeated calls).
// ---------------------------------------------------------------------
{
  const principalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
  const scanPayload = { correlationId: 'multi-object-session-1', scanlogKey: 'sl-1', book: { title: 'x' } };
  const first = buildCaptureBasis(principalId, scanPayload, 0);
  const second = buildCaptureBasis(principalId, scanPayload, 0);
  assertEqual(first, second, 'A: same observation + same discriminator (0) -> identical basis object across repeated calls');
  assertTrue(first.key.endsWith('/candidate:0'), 'A: discriminator is namespaced into key as a distinct suffix, not silently dropped');
}

// ---------------------------------------------------------------------
// Requirement B — same observation basis + different discriminator ->
// distinct candidate-safe basis (different key/full object).
// ---------------------------------------------------------------------
{
  const principalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
  const scanPayload = { correlationId: 'multi-object-session-1', scanlogKey: 'sl-1', book: { title: 'x' } };
  const candidate0 = buildCaptureBasis(principalId, scanPayload, 0);
  const candidate1 = buildCaptureBasis(principalId, scanPayload, 1);
  assertTrue(candidate0.key !== candidate1.key, 'B: discriminator 0 vs 1 under the SAME observation produce different key strings');
  assertTrue(JSON.stringify(candidate0) !== JSON.stringify(candidate1), 'B: full basis objects differ (would drive different entity_mint_basis rows)');
  // Different observation entirely (different correlationId) + no
  // discriminator at all must ALSO differ from a discriminated basis under
  // a different session — no accidental cross-session collision.
  const otherSession = buildCaptureBasis(principalId, { correlationId: 'other-session', scanlogKey: 'sl-2' });
  assertTrue(otherSession.key !== candidate0.key && otherSession.key !== candidate1.key, 'B: a genuinely different observation never collides with either candidate key');
}

// ---------------------------------------------------------------------
// Requirement D — candidate discriminator is absent from permanent
// physical-asset semantic fields. Structural proof: `book` (the one
// field this object carries that could plausibly leak into catalog/
// variant identity) never contains or is derived from the discriminator,
// for any discriminator value, including ones shaped like real identity
// content (an adversarial check, not just a happy-path one).
// ---------------------------------------------------------------------
{
  const principalId = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
  const scanPayload = { correlationId: 'd-session', scanlogKey: 'sl-3', book: { title: 'Amazing Spider-Man', issue: '300' } };
  for (const discriminator of [0, 1, 'variant-b', 'cover-a', 'issue-300-fake']) {
    const result = buildCaptureBasis(principalId, scanPayload, discriminator);
    assertTrue(
      JSON.stringify(result.book) === JSON.stringify(scanPayload.book),
      `D: book is untouched by discriminator=${JSON.stringify(discriminator)} (identity fields never absorb the discriminator)`
    );
  }
  // gk_asset's own live column set (structural, not a live query here —
  // see tests/d3-1-mint-basis-live-roundtrip.test.js for the live check)
  // never named a discriminator-shaped column in 0004_data1_foundation.sql:
  // id, asset_class, status, mint_basis_id, created_at only.
}

// ---------------------------------------------------------------------
// Requirement E — no comic-specific permanent-domain field introduced.
// Structural: the function's own module stays capture-integration-only,
// never reaches into ComicAdapter/comic-specific fields for the
// discriminator itself (only `book`, already comic-shaped input this
// function never invents new comic fields from).
// ---------------------------------------------------------------------
{
  const principalId = 'p';
  const scanPayload = { correlationId: 'c', scanlogKey: 's' };
  const result = buildCaptureBasis(principalId, scanPayload, 'x');
  const allowedKeys = new Set(['namespace', 'key', 'book', 'correlationId', 'scanlogKey', 'candidateDiscriminator']);
  const extraKeys = Object.keys(result).filter((k) => !allowedKeys.has(k));
  assertTrue(extraKeys.length === 0, `E: no unexpected field introduced (found: ${JSON.stringify(extraKeys)})`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
