// tests/grailkey-directive-t-task4-variant-correction.test.js
//
// GrailKey Directive T, Task 4 — `variant` added to
// MANUAL_CORRECTION_ALLOWED_FIELDS. Directive Q already fixed variant
// *repopulation* from the server's own response; this is the separate,
// previously-missing piece: the operator could not *set* variant via a
// correction at all. Threaded through the same client/server contract as
// title/issue/year/publisher: NORMALIZERS, validateManualAuthority,
// prepareManualCorrectionRequest's workingIdentity, buildManualCorrectionPayload,
// and server-side consumption (api/enrich.js's confirmedVariant init).
//
// Invoke: node tests/grailkey-directive-t-task4-variant-correction.test.js

import {
  MANUAL_CORRECTION_ALLOWED_FIELDS,
  validateManualAuthority,
  prepareManualCorrectionRequest,
  buildManualCorrectionPayload,
  getCorrectableFields,
} from '../src/lib/manualCorrection.js';

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

console.log('\n=== GrailKey Directive T, Task 4 — variant in the manual-correction path ===\n');

console.log('MANUAL_CORRECTION_ALLOWED_FIELDS includes variant\n');
{
  assertEq(
    MANUAL_CORRECTION_ALLOWED_FIELDS.slice().sort(),
    ['issue', 'publisher', 'title', 'variant', 'year'],
    'exactly the original four plus variant, alphabetically'
  );
}

console.log('\nvalidateManualAuthority accepts a variant correction\n');
{
  const result = validateManualAuthority(
    { correctedFields: ['variant'] },
    { variant: '  Dan Parent NYCC variant  ' },
    2026
  );
  assertTrue(result.valid, 'validation succeeds for a variant-only correction');
  assertEq(result.acceptedFields, ['variant'], 'variant is in acceptedFields');
  assertEq(result.normalizedValues.variant, 'Dan Parent NYCC variant', 'variant is trimmed by its normalizer');
}

console.log('\nvalidateManualAuthority still rejects an unlisted field\n');
{
  const result = validateManualAuthority(
    { correctedFields: ['price'] }, // never allowed, regardless of this dispatch
    { price: 9999 },
    2026
  );
  assertEq(result.rejectedFields, ['price'], 'price is still rejected — the allow-list widening is exactly one field (variant), not open-ended');
  assertTrue(!result.valid, 'a request correcting only a disallowed field is still invalid overall');
}

console.log('\nprepareManualCorrectionRequest.workingIdentity carries variant\n');
{
  const body = {
    manualIdentity: true,
    skipVision: true,
    skipImageSearch: true,
    identitySource: 'manual',
    title: 'Sabrina Annual Spectacular',
    issue: '1',
    year: '2024',
    publisher: 'Archie Comics',
    variant: 'Dan Parent NYCC variant',
    manualAuthority: { correctedBy: 'user', correctedFields: ['title', 'variant'] },
  };
  const result = prepareManualCorrectionRequest(body, 2026);
  assertTrue(result.valid, 'request is valid');
  assertEq(result.workingIdentity.variant, 'Dan Parent NYCC variant', 'workingIdentity.variant carries the corrected value');
  assertEq(result.workingIdentity.title, 'Sabrina Annual Spectacular', 'workingIdentity.title still works (four-field contract unaffected)');
  assertEq(result.validation.acceptedFields.sort(), ['title', 'variant'], 'acceptedFields reflects exactly what was corrected this request');
}

console.log('\nprepareManualCorrectionRequest.workingIdentity.variant present even when variant was NOT corrected this request (Safeguard 2 parity)\n');
{
  const body = {
    manualIdentity: true,
    skipVision: true,
    skipImageSearch: true,
    identitySource: 'manual',
    title: 'Sabrina Annual Spectacular',
    issue: '1',
    year: '2024',
    publisher: 'Archie Comics',
    variant: 'Dan Parent NYCC variant', // present in body, but not in correctedFields
    manualAuthority: { correctedBy: 'user', correctedFields: ['title'] },
  };
  const result = prepareManualCorrectionRequest(body, 2026);
  assertTrue(result.valid, 'request is valid');
  assertEq(result.workingIdentity.variant, 'Dan Parent NYCC variant', 'variant still normalized into workingIdentity even though only title was the corrected field (same Safeguard 2 treatment as the original four)');
}

console.log('\nbuildManualCorrectionPayload includes variant\n');
{
  const item = { title: 'Old Title', issue: '1', year: '1997', publisher: 'Archie', variant: 'Old Variant', issueAuthority: null };
  const payload = buildManualCorrectionPayload(item, { title: 'New Title', variant: 'New Variant' }, ['title', 'variant']);
  assertEq(payload.variant, 'New Variant', 'corrected variant used when supplied');
  assertEq(payload.priorIdentity.variant, 'Old Variant', 'priorIdentity snapshot carries the pre-correction variant');

  const payloadUncorrected = buildManualCorrectionPayload(item, { title: 'New Title' }, ['title']);
  assertEq(payloadUncorrected.variant, 'Old Variant', 'falls back to item.variant when variant itself was not corrected');
}

console.log('\ngetCorrectableFields already generically includes variant (no code change needed there)\n');
{
  const item = { identityMissingFields: ['variant'], identityProvisionalFields: [] };
  assertTrue(getCorrectableFields(item).includes('variant'), 'variant flows through getCorrectableFields\' allow-list intersection automatically, since it reads MANUAL_CORRECTION_ALLOWED_FIELDS directly');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
