// tests/q-trackB-commit3-manual-correction.test.js
//
// Track B Phase 0, Commit 3 — manual identity correction: server-side
// manual-authority validation (src/lib/manualCorrection.js,
// validateManualAuthority) and the explicit clear-list/preserve-list merge
// (buildCorrectedCatalogueItem) that replaces reIdentifyBook's implicit
// `...item` spread pattern for the correction path specifically.
//
// Scope note: Tests B/C exercise validateManualAuthority directly — the
// exact function api/enrich.js imports and calls at its own early
// validation gate (api/enrich.js, right after the request-body destructure,
// before any external API call). A full HTTP-handler-level test would also
// need to satisfy checkAccessGate/checkRateLimit (api/enrich.js's own
// pre-existing auth/rate-limit gates, unrelated to this commit) purely to
// reach code that runs before any of them matter for what THIS commit
// changed — testing the real exported validation function directly is the
// correct scope boundary, same convention this campaign has used
// throughout (real exported function, not a parallel mirror; not a
// same-file HTTP mock unrelated to the change under test).
//
// Invoke: node tests/q-trackB-commit3-manual-correction.test.js

import {
  MANUAL_CORRECTION_ALLOWED_FIELDS,
  validateManualAuthority,
  normalizeManualIssue,
  normalizeManualYear,
  IDENTITY_DEPENDENT_FIELDS_TO_CLEAR,
  IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE,
  CONDITIONALLY_PRESERVED_ON_SOLD_STATUS,
  buildCorrectedCatalogueItem,
  getCorrectableFields,
  buildManualCorrectionProvenance,
  isValidManualAuthorityRequestContract,
  prepareManualCorrectionRequest,
  buildManualCorrectionPayload,
  replaceCatalogueItemById,
  applyManualCorrectionResult,
} from '../src/lib/manualCorrection.js';
import { resolveFamilyIssueConsensus } from '../src/lib/identityCore.js';
import { buildActiveCompCacheKey } from '../api/enrich.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== Track B Phase 0, Commit 3 — manual identity correction ===\n');

// ══════════════════════════════════════════════════════════════════════════════
// Sanity — no overlap between the two lists, allow-list is exactly 5 fields
// (GrailKey Directive T, Task 4 — added 'variant' to the original four;
// see tests/grailkey-directive-t-task4-variant-correction.test.js for the
// dedicated coverage of that addition)
// ══════════════════════════════════════════════════════════════════════════════
console.log('Sanity: list invariants\n');
{
  assertEq(MANUAL_CORRECTION_ALLOWED_FIELDS.slice().sort(), ['issue', 'publisher', 'title', 'variant', 'year'], 'MANUAL_CORRECTION_ALLOWED_FIELDS is exactly title/issue/year/publisher/variant');
  const overlap = IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.filter((f) => IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE.includes(f));
  assertEq(overlap, [], 'zero overlap between the clear-list and the preserve-list');
  assertTrue(IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.includes('decision'), 'clear-list includes decision (never inherit stale routing state)');
  assertTrue(IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.includes('contract'), 'clear-list includes contract (never inherit stale READY/REFUSED/LOCKED state)');
  assertTrue(IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.includes('price'), 'clear-list includes price');
  assertTrue(IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.includes('soldComps'), 'clear-list includes soldComps');
  assertTrue(IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.includes('rawComps'), 'clear-list includes rawComps');
  assertTrue(IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE.includes('id'), 'preserve-list includes id');
  assertTrue(IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE.includes('images'), 'preserve-list includes images');
  assertTrue(IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE.includes('purchasePrice'), 'preserve-list includes purchasePrice (acquisition cost)');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST A — wrong-#9 card, populated #9 economics, corrected to #3.
// Same collection ID, zero #9 fields survive (iterates the clear-list
// programmatically — every field, not a hand-picked few), everything
// recomputed from the corrected response.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTest A: wrong-#9 card corrected to #3 — clear-list iterated programmatically\n');
{
  const STALE = 'STALE_#9_VALUE';
  const oldItem = { id: 'card-123' };
  // Populate EVERY clear-list field with the same recognizable stale
  // sentinel — proves the merge doesn't miss any of them, not just the
  // ones a hand-written fixture happened to think of.
  for (const field of IDENTITY_DEPENDENT_FIELDS_TO_CLEAR) {
    oldItem[field] = STALE;
  }
  oldItem.title = 'Strange Tales';
  oldItem.issue = '9';
  oldItem.year = '1952';
  oldItem.publisher = 'Marvel';
  // Populate every preserve-list field with a real, distinguishable
  // user-owned value.
  const preserveFixtureValues = {
    id: 'card-123',
    timestamp: 1712345678,
    status: 'unlisted',
    ebayUrl: null,
    ebayItemId: null,
    bundleId: null,
    soldPrice: null,
    purchasePrice: 5.0,
    listPrice: 40,
    listPriceManual: true,
    userFmv98: null,
    images: ['data:image/jpeg;base64,FAKEIMAGEDATA=='],
    grade: 'VG 4.0',
    isGraded: false,
    numericGrade: 4.0,
    confidence: 'HIGH',
    variant: null,
    certNumber: null,
    cgcLabel: null,
    cgcVerified: false,
    labelType: null,
    labelNotes: null,
    defectPenalty: null,
    cgcPenaltyFlags: null,
    restoration: null,
    isReprint: false,
    editionType: null,
    assetType: 'comic',
    assetTypeConfident: true,
    gradeLocked: false,
  };
  for (const field of IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE) {
    oldItem[field] = preserveFixtureValues[field] !== undefined ? preserveFixtureValues[field] : `preserve-fixture-${field}`;
  }

  // The corrected #3 enrich response — a fresh, plausible re-identification.
  const enrichData = {
    title: 'Strange Tales', issue: '3', year: '1951', publisher: 'Marvel',
    price: '$120.00', priceLow: '$95.00', priceHigh: '$145.00',
    rawComps: { count: 4, average: 118, lowest: 95, highest: 145, prices: [95, 110, 125, 145] },
    soldComps: [{ price: 120, title: 'Strange Tales #3 1951' }],
    pricingSource: 'verified_sold',
    decision: { action: 'LIST_NOW', confidence: 'HIGH', blockers: [], warnings: [] },
    contract: { state: 'READY', listable: true, price: '$120.00' },
    manualCorrection: {
      correctedBy: 'user', correctedFields: ['issue'],
      corrections: { issue: { newValue: '3', newSource: 'user', priorValue: '9', priorSource: null } },
    },
    issueAuthority: { source: 'user', status: 'confirmed', confidence: 'high', reasons: ['user-correction'], priorObservations: [] },
  };

  const result = buildCorrectedCatalogueItem(oldItem, enrichData);

  assertEq(result.id, 'card-123', 'same collection ID survives the correction');
  assertEq(result.title, 'Strange Tales', 'title reflects the corrected response');
  assertEq(result.issue, '3', 'issue is corrected to #3, not the stale #9');
  assertEq(result.year, '1951', 'year reflects the corrected response');
  assertEq(result.decision, enrichData.decision, 'decision is the FRESH recomputed decision, not the old stale one');
  assertEq(result.contract, enrichData.contract, 'contract is the FRESH recomputed contract, not the old stale one');

  // The exhaustive, programmatic sweep the dispatch specifically asked for:
  // every single clear-list field, not a hand-picked subset.
  let staleValueSurvivorCount = 0;
  for (const field of IDENTITY_DEPENDENT_FIELDS_TO_CLEAR) {
    if (result[field] === STALE) staleValueSurvivorCount++;
    const expected = Object.prototype.hasOwnProperty.call(enrichData, field) ? enrichData[field] : null;
    assertEq(result[field], expected, `clear-list field "${field}": reflects the corrected response (or null if the response didn't set it) — never the stale #9 value`);
  }
  assertEq(staleValueSurvivorCount, 0, `zero of ${IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.length} clear-list fields retain the stale #9 sentinel value`);

  // Preserve-list: every field survives from the OLD item, untouched.
  for (const field of IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE) {
    assertEq(result[field], oldItem[field], `preserve-list field "${field}": survives unchanged from the old item`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST B — correctedFields:['issue','price','contract'] → only issue is
// accepted. price/contract can never become user-authoritative, regardless
// of what a client requests or how it's combined with a legitimately
// allow-listed field.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTest B: only allow-listed fields are ever accepted, regardless of client claim\n');
{
  const result = validateManualAuthority(
    { correctedBy: 'user', correctedFields: ['issue', 'price', 'contract'] },
    { issue: '3' },
    2026
  );
  assertEq(result.acceptedFields, ['issue'], 'only issue is accepted');
  assertEq(result.rejectedFields.slice().sort(), ['contract', 'price'], 'price AND contract are both rejected outright');
  assertTrue(result.valid, 'still valid overall — one legitimate correction is enough');
  assertEq(result.normalizedValues, { issue: '3' }, 'normalizedValues contains ONLY the accepted field');
  assertFalse(Object.prototype.hasOwnProperty.call(result.normalizedValues, 'price'), 'price value never appears in normalizedValues, even though it was supplied in fieldValues alongside issue... ');
}
{
  // price/contract ALONE, no legitimate field at all — must be rejected
  // wholesale, not partially accepted.
  const result = validateManualAuthority(
    { correctedBy: 'user', correctedFields: ['price', 'contract'] },
    { price: 999, contract: 'READY' },
    2026
  );
  assertEq(result.acceptedFields, [], 'price/contract alone: nothing accepted');
  assertEq(result.rejectedFields.slice().sort(), ['contract', 'price'], 'both rejected');
  assertFalse(result.valid, 'invalid overall — no legitimate correction present');
  assertEq(result.error, 'no-valid-corrections', 'explicit error code, not a silent pass-through');
}
{
  // Every single field NOT on the allow-list, individually, is rejected —
  // not just the two named in the dispatch.
  const nonAllowedProbe = ['price', 'contract', 'decision', 'rawComps', 'soldComps', 'pricingSource', 'id', 'images'];
  for (const field of nonAllowedProbe) {
    const result = validateManualAuthority({ correctedBy: 'user', correctedFields: [field] }, { [field]: 'anything' }, 2026);
    assertEq(result.acceptedFields, [], `"${field}" alone is never accepted (not on the allow-list)`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST C — empty correction: rejected with an explicit error, no mutation.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTest C: empty correction is rejected with an explicit error, never silently accepted\n');
{
  const result = validateManualAuthority({ correctedBy: 'user', correctedFields: ['issue'] }, { issue: '   ' }, 2026);
  assertFalse(result.valid, 'whitespace-only issue value: invalid');
  assertEq(result.error, 'no-valid-corrections', 'explicit error code');
  assertEq(result.emptyFields, ['issue'], 'issue is reported in emptyFields, not silently dropped');
  assertEq(result.acceptedFields, [], 'nothing accepted');
}
{
  const result = validateManualAuthority({ correctedBy: 'user', correctedFields: [] }, {}, 2026);
  assertFalse(result.valid, 'no correctedFields at all: invalid');
  assertEq(result.error, 'no-valid-corrections', 'explicit error code');
}
{
  const result = validateManualAuthority(null, { issue: '3' }, 2026);
  assertFalse(result.valid, 'manualAuthority itself null/absent: invalid, no crash');
  assertEq(result.error, 'no-valid-corrections', 'explicit error code');
}
{
  // "No mutation" — buildCorrectedCatalogueItem itself never mutates its
  // inputs (a rejected correction, per api/enrich.js's early-return gate,
  // never even reaches this function at all — but confirming the merge
  // function's own purity is a real, independent guarantee worth locking
  // in regardless of caller discipline).
  const oldItem = Object.freeze({ id: 'x', title: 'Foo', price: 10, decision: { action: 'LIST_NOW' } });
  const enrichData = Object.freeze({ title: 'Foo', price: 12 });
  let threw = false;
  try {
    buildCorrectedCatalogueItem(oldItem, enrichData);
  } catch (e) {
    threw = true;
  }
  assertFalse(threw, 'buildCorrectedCatalogueItem never mutates its inputs (frozen objects survive the call without a TypeError)');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST D — both panel cases render an issue input AND update the same
// collection ID: ID_REQUIRED (identityMissingFields=['issue']) and
// provisional pool-adopted (identityMissingFields=[],
// identityProvisionalFields=['issue']). getCorrectableFields is the exact
// function the CollectionDetail render site calls (src/App.jsx) — this is
// not a mirror of that logic, it's the same function.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTest D: both panel cases render an issue input and update the same collection ID\n');
{
  const idRequiredItem = { id: 'card-456', identityMissingFields: ['issue'], identityProvisionalFields: [] };
  const provisionalAdoptedItem = { id: 'card-456', identityMissingFields: [], identityProvisionalFields: ['issue'] };

  const idRequiredFields = getCorrectableFields(idRequiredItem);
  const provisionalFields = getCorrectableFields(provisionalAdoptedItem);

  assertTrue(idRequiredFields.includes('issue'), 'ID_REQUIRED case (missingFields=["issue"]): an issue input renders');
  assertTrue(provisionalFields.includes('issue'), 'provisional-adopted case (missingFields=[], provisionalFields=["issue"]): an issue input STILL renders — the mandatory union rule');
  assertEq(idRequiredFields, ['issue'], 'ID_REQUIRED case: exactly one correctable field, no extras');
  assertEq(provisionalFields, ['issue'], 'provisional-adopted case: exactly one correctable field, no extras');

  // Both cases funnel into the identical update-in-place merge, preserving
  // the same collection ID — the same real exported function Test A
  // exercises, not a separate code path per panel case.
  const enrichData = { title: 'Strange Tales', issue: '3', year: '1951', publisher: 'Marvel' };
  const resultFromIdRequired = buildCorrectedCatalogueItem(idRequiredItem, enrichData);
  const resultFromProvisional = buildCorrectedCatalogueItem(provisionalAdoptedItem, enrichData);
  assertEq(resultFromIdRequired.id, 'card-456', 'ID_REQUIRED case: same collection ID after correction');
  assertEq(resultFromProvisional.id, 'card-456', 'provisional-adopted case: same collection ID after correction');
  assertEq(resultFromIdRequired.issue, '3', 'ID_REQUIRED case: issue corrected to #3');
  assertEq(resultFromProvisional.issue, '3', 'provisional-adopted case: issue corrected to #3');

  // Control: a card with no missing AND no provisional fields renders no
  // correction input at all (not every card gets one).
  const cleanItem = { id: 'card-789', identityMissingFields: [], identityProvisionalFields: [] };
  assertEq(getCorrectableFields(cleanItem), [], 'a fully-resolved card offers no correction fields');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST E — same-request lock: a corrected issue survives a simulated
// same-request pool consensus that disagrees. Exercises the REAL
// resolveFamilyIssueConsensus (src/lib/identityCore.js) — the actual
// mechanism that would govern this if automatic evidence resolution were
// ever in the loop alongside a manual correction. Defense-in-depth,
// independent of (not a substitute for) the structural fact that
// manualIdentity:true bypasses this function entirely today (see this
// file's header comment and docs/LAUNCH-AUDIT.md Section 16's design
// finding) — even if a future refactor ever routed a correction through
// consensus resolution, this function's own, already-shipped logic
// refuses to silently overwrite a non-null prior issue with a disagreeing
// pool winner.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTest E: same-request lock — resolveFamilyIssueConsensus never overwrites a corrected prior issue\n');
{
  const correctedIssue = '3';
  // A disagreeing "same-request pool consensus" — 4 unique rows, all
  // clearly voting for #9, easily clearing the adoption bar (uniqueRows>=3,
  // ratio>=0.6, clear lead) that would otherwise let a pool opinion win.
  const disagreeingPool = [
    { rawTitle: 'Strange Tales #9 Marvel 1952' },
    { rawTitle: 'Strange Tales #9 Marvel VG' },
    { rawTitle: 'Strange Tales #9 Marvel FN' },
    { rawTitle: 'Strange Tales #9 Marvel GD' },
  ];
  const indices = [0, 1, 2, 3];
  const result = resolveFamilyIssueConsensus(correctedIssue, disagreeingPool, indices);
  assertEq(result.issue, correctedIssue, 'corrected issue #3 survives — never overwritten by the disagreeing #9 pool');
  assertEq(result.mode, 'conflict-locked', 'mode is conflict-locked, not adopted — the disagreement is flagged, never silently applied');
  assertEq(result.winner, '9', 'the competing pool winner (#9) is reported as raw vote data, not hidden');
  assertTrue(result.ratio >= 0.6, 'sanity: the disagreeing pool genuinely clears the adoption bar (this is a real conflict, not a weak one that would no-op anyway)');

  // Corroborating pool: agrees with the correction — issue still survives
  // (obviously), reported honestly as corroborated rather than adopted
  // (the value was never in question either way).
  const agreeingPool = [
    { rawTitle: 'Strange Tales #3 Marvel 1951' },
    { rawTitle: 'Strange Tales #3 Marvel VG' },
    { rawTitle: 'Strange Tales #3 Marvel FN' },
  ];
  const agreeingResult = resolveFamilyIssueConsensus(correctedIssue, agreeingPool, [0, 1, 2]);
  assertEq(agreeingResult.issue, correctedIssue, 'corrected issue #3 survives when the pool agrees too');
  assertEq(agreeingResult.mode, 'corroborated', 'mode is corroborated, not adopted — a corrected value is never "adopted" from a pool, only corroborated or flagged');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST F — manualAuthority/issueAuthority shape present on the constructed
// provenance; both old and new value/source are carried. Exercises the
// REAL buildManualCorrectionProvenance (src/lib/manualCorrection.js) — the
// exact function api/enrich.js calls after a validated correction.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nTest F: manualCorrection/issueAuthority provenance carries both old and new value/source\n');
{
  const validation = validateManualAuthority({ correctedBy: 'user', correctedFields: ['issue'] }, { issue: '3' }, 2026);
  const priorIdentity = {
    title: 'Strange Tales', issue: '9', year: '1952', publisher: 'Marvel',
    issueAuthority: { source: 'marketplace', status: 'provisional', confidence: 'medium', reasons: ['marketplace-only-adoption'], priorObservations: [] },
  };
  const provenance = buildManualCorrectionProvenance(validation, priorIdentity);

  assertTrue(!!provenance.manualCorrection, 'manualCorrection is present on the result');
  assertEq(provenance.manualCorrection.correctedBy, 'user', 'correctedBy is user');
  assertEq(provenance.manualCorrection.correctedFields, ['issue'], 'correctedFields matches the accepted fields');
  assertEq(
    provenance.manualCorrection.corrections.issue,
    { newValue: '3', newSource: 'user', priorValue: '9', priorSource: 'marketplace', provenanceTrust: 'client-reported' },
    'per-field provenance carries BOTH the new value/source AND the prior value/source, tagged client-reported (Safeguard 3)'
  );

  assertTrue(!!provenance.issueAuthority, 'issueAuthority is present (issue was one of the corrected fields)');
  assertEq(provenance.issueAuthority.source, 'user', 'issueAuthority.source is user');
  assertEq(provenance.issueAuthority.status, 'confirmed', 'issueAuthority.status is confirmed');
  assertEq(provenance.issueAuthority.reasons, ['user-correction'], 'issueAuthority.reasons names the correction');
  assertEq(
    provenance.issueAuthority.priorObservations,
    [{ value: '9', source: 'marketplace', status: 'provisional', provenanceTrust: 'client-reported' }],
    'priorObservations preserves the prior Vision/marketplace observation, not discarded, tagged client-reported'
  );
}
{
  // Honest-null: an older cached card with no issueAuthority at all must
  // never have 'vision' (or anything else) fabricated as its prior source.
  const validation = validateManualAuthority({ correctedBy: 'user', correctedFields: ['issue'] }, { issue: '3' }, 2026);
  const priorIdentity = { title: 'Strange Tales', issue: '9', year: '1952', publisher: 'Marvel' }; // no issueAuthority field at all
  const provenance = buildManualCorrectionProvenance(validation, priorIdentity);
  assertEq(provenance.manualCorrection.corrections.issue.priorSource, null, 'no prior issueAuthority at all -> priorSource is honest null, never a fabricated "vision"');
  assertEq(provenance.issueAuthority.priorObservations, [{ value: '9', source: null, status: null, provenanceTrust: 'client-reported' }], 'priorObservations records the prior value with honest-null source/status, not fabricated — still correctly tagged client-reported regardless');
}
{
  // A correction that only touches title/year/publisher makes no issue
  // claim at all — issueAuthority must be entirely absent, not a
  // fabricated no-op object.
  const validation = validateManualAuthority({ correctedBy: 'user', correctedFields: ['year'] }, { year: '1951' }, 2026);
  const provenance = buildManualCorrectionProvenance(validation, { title: 'Strange Tales', issue: '9', year: '1952', publisher: 'Marvel' });
  assertEq(provenance.issueAuthority, undefined, 'a year-only correction never fabricates an issueAuthority claim');
  assertEq(provenance.manualCorrection.correctedFields, ['year'], 'correctedFields correctly reflects only year');
}

// ══════════════════════════════════════════════════════════════════════════════
// SAFEGUARD 1 — the exact four-condition manual-authority request contract.
// Checking manualIdentity alone is NOT sufficient — all four conditions
// (manualIdentity===true, skipVision===true, skipImageSearch===true,
// identitySource==='manual') are required together, via the real exported
// prepareManualCorrectionRequest/isValidManualAuthorityRequestContract.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nSafeguard 1: exact four-condition manual-authority request contract\n');
{
  const VALID_BODY = {
    manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual',
    manualAuthority: { correctedBy: 'user', correctedFields: ['issue'] },
    title: 'Strange Tales', issue: '3', year: '1951', publisher: 'Marvel',
  };
  assertTrue(isValidManualAuthorityRequestContract(VALID_BODY), 'all four conditions present -> contract valid');
  const result = prepareManualCorrectionRequest(VALID_BODY, 2026);
  assertTrue(result.valid, 'all four conditions present -> prepareManualCorrectionRequest succeeds');
  assertTrue(result.contractOk, 'contractOk true');

  // Four INDEPENDENT broken-condition cases — each breaks EXACTLY ONE of
  // the four conditions, proving all four are actually checked (not just
  // manualIdentity, which the dispatch specifically warned against).
  const BROKEN_CASES = [
    ['manualIdentity', { ...VALID_BODY, manualIdentity: false }],
    ['manualIdentity (missing entirely)', (() => { const b = { ...VALID_BODY }; delete b.manualIdentity; return b; })()],
    ['skipVision', { ...VALID_BODY, skipVision: false }],
    ['skipImageSearch', { ...VALID_BODY, skipImageSearch: false }],
    ['identitySource', { ...VALID_BODY, identitySource: 'vision' }],
  ];
  for (const [label, brokenBody] of BROKEN_CASES) {
    assertFalse(isValidManualAuthorityRequestContract(brokenBody), `broken condition (${label}): contract check fails`);
    const brokenResult = prepareManualCorrectionRequest(brokenBody, 2026);
    assertFalse(brokenResult.valid, `broken condition (${label}): prepareManualCorrectionRequest rejects`);
    assertFalse(brokenResult.contractOk, `broken condition (${label}): contractOk is false (distinguishes this from a field-validation failure)`);
    assertEq(brokenResult.workingIdentity, null, `broken condition (${label}): no workingIdentity produced — no identity resolution possible from this result`);
  }

  // THE SPOOF CASE — manualAuthority attached to what is otherwise a
  // normal AUTOMATIC enrich request (manualIdentity absent/false, as a
  // real Vision-driven scan would send). Must never mint a user-confirmed
  // issueAuthority. This is the case "checking only manualIdentity does
  // not satisfy" — proven here by confirming the full chain: contract
  // rejects -> prepareManualCorrectionRequest invalid -> the server's own
  // wiring (api/enrich.js) never reaches buildManualCorrectionProvenance
  // at all for this request (verified by the diff: manualCorrection/
  // issueAuthority construction is gated on `manualCorrectionRequest?.valid`,
  // which is false here).
  const spoofBody = {
    // A normal automatic scan: no manualIdentity, no skip flags, Vision's
    // own identitySource — but a manualAuthority block smuggled in anyway.
    title: 'Amazing Spider-Man', issue: '1', year: '1963', publisher: 'Marvel',
    manualAuthority: { correctedBy: 'user', correctedFields: ['issue'] },
  };
  assertFalse(isValidManualAuthorityRequestContract(spoofBody), 'SPOOF: manualAuthority on a normal automatic request -> contract check fails');
  const spoofResult = prepareManualCorrectionRequest(spoofBody, 2026);
  assertFalse(spoofResult.valid, 'SPOOF: prepareManualCorrectionRequest rejects outright');
  assertFalse(spoofResult.contractOk, 'SPOOF: contractOk is false');
  assertEq(spoofResult.validation, null, 'SPOOF: validation never even runs — rejected at the contract gate, before field-level validation');

  // TEETH-PROOF: demonstrate isValidManualAuthorityRequestContract can
  // actually fail to catch a violation if written carelessly — temporarily
  // swap in a naive "manualIdentity-only" check (the exact anti-pattern
  // the dispatch warned against) and confirm it WRONGLY passes the spoof
  // case, then discard it. Proves this test suite's real assertions above
  // are exercising a check that actually matters, not a vacuous one.
  {
    const naiveManualIdentityOnlyCheck = (body) => body?.manualIdentity === true;
    const naiveResultOnValidBody = naiveManualIdentityOnlyCheck(VALID_BODY);
    // A version of the spoof body that WOULD fool a naive manualIdentity-
    // only check (attacker sets manualIdentity:true but skips the other
    // three) — this is precisely the gap Safeguard 1 exists to close.
    const spoofThatFoolsNaiveCheck = { ...spoofBody, manualIdentity: true };
    const naiveResultOnSpoof = naiveManualIdentityOnlyCheck(spoofThatFoolsNaiveCheck);
    assertTrue(naiveResultOnSpoof, 'TEETH-PROOF: a naive manualIdentity-only check WRONGLY accepts a spoof missing the other three conditions');
    assertFalse(isValidManualAuthorityRequestContract(spoofThatFoolsNaiveCheck), 'TEETH-PROOF: the REAL four-condition check correctly rejects the same spoof the naive check missed');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SAFEGUARD 2 — normalizedValues become the working pipeline identity.
// Raw issue " #3 " must resolve to "3" everywhere downstream: workingIdentity,
// and (chained) the provenance newValue.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nSafeguard 2: normalized values are the working pipeline identity, not the raw request fields\n');
{
  const body = {
    manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual',
    manualAuthority: { correctedBy: 'user', correctedFields: ['issue'] },
    title: 'Strange Tales', issue: ' #3 ', year: '1951', publisher: 'Marvel',
  };
  const result = prepareManualCorrectionRequest(body, 2026);
  assertTrue(result.valid, 'sanity: request is valid');
  assertEq(result.workingIdentity.issue, '3', 'raw " #3 " normalizes to bare "3" in the working identity — no downstream value carries the raw form');
  assertFalse(String(result.workingIdentity.issue).includes('#'), 'working identity issue never carries a literal "#"');
  assertFalse(String(result.workingIdentity.issue).includes(' '), 'working identity issue never carries whitespace');
  // Every field in workingIdentity is normalized, not just the corrected one.
  assertEq(result.workingIdentity.title, 'Strange Tales', 'title normalized (trimmed) even though it was not the corrected field');
  assertEq(result.workingIdentity.year, '1951', 'year normalized even though it was not the corrected field');
  assertEq(result.workingIdentity.publisher, 'Marvel', 'publisher normalized even though it was not the corrected field');

  // Chained into provenance: newValue must be the NORMALIZED "3", not " #3 ".
  const provenance = buildManualCorrectionProvenance(result.validation, { title: 'Strange Tales', issue: '9', year: '1951', publisher: 'Marvel' });
  assertEq(provenance.manualCorrection.corrections.issue.newValue, '3', 'provenance newValue is the normalized "3", never the raw " #3 "');

  // A messier raw form: "# 3" (hash + space + digit) must ALSO normalize
  // to bare "3" — not just the simple " #3 " case.
  const messyBody = { ...body, issue: '# 3' };
  const messyResult = prepareManualCorrectionRequest(messyBody, 2026);
  assertEq(messyResult.workingIdentity.issue, '3', '"# 3" (hash, space, digit) also normalizes to bare "3"');

  // TEETH-PROOF: temporarily substitute a "normalizer" that does nothing
  // (identity function) in place of the real one, proving the assertion
  // above WOULD catch a regression that stopped normalizing.
  {
    const brokenWorkingIdentity = { ...result.workingIdentity, issue: body.issue }; // simulate "normalization never happened"
    assertFalse(brokenWorkingIdentity.issue === '3', 'TEETH-PROOF: a deliberately un-normalized workingIdentity.issue (" #3 ") does NOT equal "3" — confirms the real assertion above is not vacuous');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SAFEGUARD 2 (AMENDMENT) — the real active-comp cache key is constructed
// from the normalized corrected identity. The prior packet documented the
// chain (workingIdentity -> effectiveTitle/effectiveIssue ->
// confirmedTitle/confirmedIssue -> activeKey) but stopped short of
// exercising the actual cache-key composition — this section closes that
// gap through the REAL exported buildActiveCompCacheKey (api/enrich.js),
// the exact function the live `ac:` cache read/write call site now calls
// (replacing what was an inline template string), per invariant 10.
// `title|null` was a confirmed live failure class (Commit B.1, Strange
// Tales dispatch) — this needs executable regression coverage, not a
// documentation comment.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nSafeguard 2 (amendment): the real active-comp cache key uses the normalized corrected identity\n');
{
  const body = {
    manualIdentity: true, skipVision: true, skipImageSearch: true, identitySource: 'manual',
    manualAuthority: { correctedBy: 'user', correctedFields: ['issue'] },
    title: 'Strange Tales', issue: ' #3 ', year: '1951', publisher: 'Marvel',
  };
  const prepared = prepareManualCorrectionRequest(body, 2026);
  assertTrue(prepared.valid, 'sanity: correction request is valid');

  // The exact real production composition: filterVersion + workingIdentity
  // fields straight into the real exported buildActiveCompCacheKey — not a
  // test-local template-string mirror.
  //
  // GrailKey Dispatch 36 — buildActiveCompCacheKey now requires a fourth
  // filterContextFingerprint segment (Hero for Hire class fix). This
  // section is about title/issue normalization, not fingerprint
  // correctness (that's covered in tests/cacheKeys-fingerprint.test.js),
  // so every call below passes the same fixed sentinel string —
  // deliberately NOT a real buildFilterContextFingerprint() output, so a
  // reader immediately sees this dimension isn't under test here.
  const FILTER_VERSION = 9; // matches COMP_FILTER_VERSION (src/lib/compHygiene.js) at time of writing; the real value is read via the export in production, this is just the literal used to construct an equivalent key here
  // GrailKey Dispatch 36 (correction round) — must be valid 64-char hex,
  // buildActiveCompCacheKey now throws on anything else (fail-closed).
  const FP_NOT_UNDER_TEST = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const key = buildActiveCompCacheKey(FILTER_VERSION, prepared.workingIdentity.title, prepared.workingIdentity.issue, FP_NOT_UNDER_TEST);

  assertTrue(key.includes('Strange Tales|3'), 'the real cache key contains the normalized "Strange Tales|3" segment');
  assertFalse(key.includes('Strange Tales|#3'), 'the real cache key does NOT contain the raw hash form "Strange Tales|#3"');
  assertFalse(key.includes('Strange Tales|9'), 'the real cache key does NOT contain the prior issue "Strange Tales|9"');
  assertFalse(key.includes('Strange Tales|null'), 'the real cache key does NOT contain a "title|null" key — the confirmed historical failure class (Commit B.1)');
  assertFalse(key.includes(' #3 '), 'the real cache key does not carry the raw whitespace form anywhere');
  assertFalse(key.includes('#'), 'the real cache key carries no literal "#" at all');

  // TEETH-PROOF — construct the historical bad key shapes directly
  // (prior issue "9", and a null confirmedIssue) using the SAME real
  // buildActiveCompCacheKey export, and confirm the assertion patterns
  // above correctly reject both. This proves the check actually catches
  // the confirmed historical failure class, not a hypothetical one.
  const staleIssueKey = buildActiveCompCacheKey(FILTER_VERSION, prepared.workingIdentity.title, '9', FP_NOT_UNDER_TEST); // the OLD, uncorrected issue
  assertEq(staleIssueKey, 'v9:Strange Tales|9|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'TEETH-PROOF: reconstructing the stale-issue key shape produces exactly "v9:Strange Tales|9|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
  assertFalse(staleIssueKey.includes('Strange Tales|3'), 'TEETH-PROOF: the stale-issue key does NOT contain "Strange Tales|3" — confirms the real assertion above (which the corrected key DID pass) is not vacuous');
  assertTrue(staleIssueKey.includes('Strange Tales|9'), 'TEETH-PROOF: the stale-issue key DOES contain "Strange Tales|9" — exactly the shape the real corrected-key assertion above correctly rejects');

  const nullIssueKey = buildActiveCompCacheKey(FILTER_VERSION, prepared.workingIdentity.title, null, FP_NOT_UNDER_TEST);
  assertEq(nullIssueKey, 'v9:Strange Tales|null|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'TEETH-PROOF: reconstructing the historical "title|null" key shape (Commit B.1) produces exactly "v9:Strange Tales|null|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
  assertTrue(nullIssueKey.includes('Strange Tales|null'), 'TEETH-PROOF: the null-issue key DOES contain "Strange Tales|null" — exactly the confirmed historical failure shape the real corrected-key assertion above correctly rejects');

  // Confirm the extracted export reproduces the EXACT real inline template
  // it replaced (now with its required fingerprint segment), so this is
  // genuinely the same composition production uses, not an approximation.
  assertEq(buildActiveCompCacheKey(9, 'Strange Tales', '3', FP_NOT_UNDER_TEST), 'v9:Strange Tales|3|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'buildActiveCompCacheKey output matches the real production template exactly: `v${filterVersion}:${confirmedTitle}|${confirmedIssue}|${filterContextFingerprint}`');
}

// ══════════════════════════════════════════════════════════════════════════════
// SAFEGUARD 3 — client-supplied prior history is marked honestly.
// Every prior-value/prior-source record buildManualCorrectionProvenance
// produces must carry provenanceTrust: 'client-reported' — never presented
// as server-verified. (Test F above already covers the concrete shapes;
// this section asserts the invariant exhaustively and with a teeth-proof.)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nSafeguard 3: client-supplied prior history is marked client-reported, never server-verified\n');
{
  const validation = validateManualAuthority({ correctedBy: 'user', correctedFields: ['issue', 'year'] }, { issue: '3', year: '1951' }, 2026);
  const priorIdentity = {
    title: 'Strange Tales', issue: '9', year: '1952', publisher: 'Marvel',
    issueAuthority: { source: 'marketplace', status: 'provisional' },
  };
  const provenance = buildManualCorrectionProvenance(validation, priorIdentity);

  for (const field of validation.acceptedFields) {
    assertEq(provenance.manualCorrection.corrections[field].provenanceTrust, 'client-reported', `corrections.${field}.provenanceTrust is exactly 'client-reported'`);
    assertFalse(provenance.manualCorrection.corrections[field].provenanceTrust === 'server-verified', `corrections.${field}.provenanceTrust is never 'server-verified'`);
  }
  assertEq(provenance.issueAuthority.priorObservations[0].provenanceTrust, 'client-reported', 'issueAuthority.priorObservations entry carries provenanceTrust: client-reported');

  // TEETH-PROOF: a provenance object missing the marker entirely (simulating
  // a regression that dropped it) fails the exact assertion pattern above.
  {
    const strippedCorrections = { ...provenance.manualCorrection.corrections.issue };
    delete strippedCorrections.provenanceTrust;
    assertFalse(strippedCorrections.provenanceTrust === 'client-reported', 'TEETH-PROOF: a provenance record with the marker stripped fails the same check the real assertions above use');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SAFEGUARD 4 — the preserve-list disputes, resolved explicitly per field.
// variant/isReprint/editionType/ebayUrl/ebayItemId/listPrice/listPriceManual
// moved to the clear-list (already covered automatically by Test A's
// programmatic sweep, since they're now IN that exported list — this
// section additionally asserts list MEMBERSHIP directly, so a future
// accidental re-addition to the preserve-list is caught even before a
// merge runs). status/soldPrice/bundleId get their own conditional-on-sold
// group, tested explicitly (not covered by Test A's two-list sweep).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nSafeguard 4: preserve-list disputes resolved explicitly per field\n');
{
  const MOVED_TO_CLEAR = ['variant', 'isReprint', 'editionType', 'ebayUrl', 'ebayItemId', 'listPrice', 'listPriceManual'];
  for (const field of MOVED_TO_CLEAR) {
    assertTrue(IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.includes(field), `"${field}" is in the clear-list (printing/cover identity or active-listing/system-price state tied to the old identity)`);
    assertFalse(IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE.includes(field), `"${field}" is NOT in the preserve-list anymore`);
  }
  assertEq(CONDITIONALLY_PRESERVED_ON_SOLD_STATUS.slice().sort(), ['bundleId', 'soldPrice', 'status'].sort(), 'the conditional-on-sold-status group is exactly status/soldPrice/bundleId');
  for (const field of CONDITIONALLY_PRESERVED_ON_SOLD_STATUS) {
    assertFalse(IDENTITY_DEPENDENT_FIELDS_TO_CLEAR.includes(field), `"${field}" is not a blanket clear`);
    assertFalse(IDENTITY_INDEPENDENT_FIELDS_TO_PRESERVE.includes(field), `"${field}" is not a blanket preserve`);
  }
}
console.log('\nSafeguard 4: conditional-on-sold-status group behavior (buildCorrectedCatalogueItem)\n');
{
  const enrichData = { title: 'Strange Tales', issue: '3', year: '1951', publisher: 'Marvel' };

  // Completed, historical sale — status/soldPrice/bundleId all preserve.
  const soldOldItem = { id: 'card-sold', status: 'sold', soldPrice: 85, bundleId: 'bundle-42', title: 'Strange Tales', issue: '9' };
  const soldResult = buildCorrectedCatalogueItem(soldOldItem, enrichData);
  assertEq(soldResult.status, 'sold', 'completed sale: status preserved');
  assertEq(soldResult.soldPrice, 85, 'completed sale: soldPrice preserved (a real historical fact)');
  assertEq(soldResult.bundleId, 'bundle-42', 'completed sale: bundleId preserved');

  // Active listing tied to the OLD (wrong) identity — must NOT auto-survive.
  const listedOldItem = { id: 'card-listed', status: 'listed', soldPrice: null, bundleId: 'bundle-99', title: 'Strange Tales', issue: '9' };
  const listedResult = buildCorrectedCatalogueItem(listedOldItem, enrichData);
  assertEq(listedResult.status, null, 'active listing: status reset to null — not silently carried forward as still "listed" under the wrong identity');
  assertEq(listedResult.soldPrice, null, 'active listing: soldPrice null (never was sold)');
  assertEq(listedResult.bundleId, null, 'active listing: bundleId cleared — an active bundle grouping tied to the old identity must not survive');

  // Never-listed item — same clearing behavior as "listed" (neither is "sold").
  const unlistedOldItem = { id: 'card-unlisted', status: undefined, soldPrice: null, bundleId: null, title: 'Strange Tales', issue: '9' };
  const unlistedResult = buildCorrectedCatalogueItem(unlistedOldItem, enrichData);
  assertEq(unlistedResult.status, null, 'never-listed item: status stays null (not "sold", so cleared like any other non-sold state)');

  // TEETH-PROOF: a naive "always preserve status" implementation (the bug
  // this conditional group specifically replaces) would wrongly carry the
  // active "listed" status forward — demonstrate the naive behavior fails
  // where the real conditional logic passes.
  {
    const naiveAlwaysPreserve = { ...listedOldItem, ...enrichData, status: listedOldItem.status };
    assertTrue(naiveAlwaysPreserve.status === 'listed', 'TEETH-PROOF: a naive always-preserve merge WOULD carry the stale "listed" status forward under the corrected identity');
    assertFalse(listedResult.status === 'listed', 'TEETH-PROOF: the REAL conditional merge does not — confirms the assertion above is not vacuous');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SAFEGUARD 5 — the real client payload shape + collection-replacement
// integrity, for BOTH panel cases (ID_REQUIRED and provisional-adopted).
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nSafeguard 5: real client payload construction + collection-replacement integrity\n');
{
  const idRequiredItem = { id: 'card-999', title: 'Strange Tales', issue: '9', year: '1952', publisher: 'Marvel', identityMissingFields: ['issue'], identityProvisionalFields: [] };
  const provisionalItem = { id: 'card-888', title: 'Strange Tales', issue: '9', year: '1952', publisher: 'Marvel', identityMissingFields: [], identityProvisionalFields: ['issue'] };

  for (const item of [idRequiredItem, provisionalItem]) {
    const correctableFields = getCorrectableFields(item);
    assertTrue(correctableFields.includes('issue'), `panel case (id=${item.id}): issue correction field is offered`);

    const payload = buildManualCorrectionPayload(item, { issue: '3' }, ['issue']);
    assertEq(payload.manualIdentity, true, `panel case (id=${item.id}): payload.manualIdentity is true`);
    assertEq(payload.skipVision, true, `panel case (id=${item.id}): payload.skipVision is true`);
    assertEq(payload.skipImageSearch, true, `panel case (id=${item.id}): payload.skipImageSearch is true`);
    assertEq(payload.identitySource, 'manual', `panel case (id=${item.id}): payload.identitySource is 'manual'`);
    assertTrue(isValidManualAuthorityRequestContract(payload), `panel case (id=${item.id}): the constructed payload satisfies the real Safeguard 1 contract check`);
    assertEq(payload.manualAuthority.correctedFields, ['issue'], `panel case (id=${item.id}): manualAuthority.correctedFields is exactly ['issue']`);
    assertEq(payload.priorIdentity.issue, '9', `panel case (id=${item.id}): priorIdentity carries the item's CURRENT (pre-correction) issue`);
    assertEq(payload.issue, '3', `panel case (id=${item.id}): payload carries the corrected value`);

    // Chain the payload's own priorIdentity through prepareManualCorrectionRequest
    // + buildManualCorrectionProvenance — proves normalization (Safeguard 2)
    // and the client-reported marker (Safeguard 3) both hold for the REAL
    // payload shape this client constructs, not a hand-built approximation.
    const prepared = prepareManualCorrectionRequest(payload, 2026);
    assertTrue(prepared.valid, `panel case (id=${item.id}): the real payload passes server-side preparation`);
    assertEq(prepared.workingIdentity.issue, '3', `panel case (id=${item.id}): normalized correction value ('3') used`);
    const provenance = buildManualCorrectionProvenance(prepared.validation, payload.priorIdentity);
    assertEq(provenance.manualCorrection.corrections.issue.provenanceTrust, 'client-reported', `panel case (id=${item.id}): priorIdentity correctly marked client-reported`);

    // Collection-replacement integrity.
    const catalogueBefore = [
      { id: 'other-1', title: 'Other Book', issue: '1' },
      item,
      { id: 'other-2', title: 'Another Book', issue: '2' },
    ];
    const enrichData = { title: 'Strange Tales', issue: '3', year: '1951', publisher: 'Marvel' };
    const { correctedItem, updatedCatalogue } = applyManualCorrectionResult(catalogueBefore, item, enrichData);
    assertEq(updatedCatalogue.length, catalogueBefore.length, `panel case (id=${item.id}): collection length unchanged (before.length === after.length)`);
    assertEq(updatedCatalogue.filter((x) => x.id === item.id).length, 1, `panel case (id=${item.id}): exactly one item with this ID — no duplicate appended`);
    const replacedItem = updatedCatalogue.find((x) => x.id === item.id);
    assertEq(replacedItem.issue, '3', `panel case (id=${item.id}): corrected issue (#3) replaces the old issue (#9) on that exact item`);
    assertEq(replacedItem, correctedItem, `panel case (id=${item.id}): the item in the replaced collection is the same object applyManualCorrectionResult returned`);
    // Other items untouched.
    assertEq(updatedCatalogue.find((x) => x.id === 'other-1'), catalogueBefore[0], `panel case (id=${item.id}): unrelated collection item 'other-1' is untouched`);
    assertEq(updatedCatalogue.find((x) => x.id === 'other-2'), catalogueBefore[2], `panel case (id=${item.id}): unrelated collection item 'other-2' is untouched`);
  }

  // TEETH-PROOF: a naive "append instead of replace" bug (a real historical
  // bug class in merge/persistence code) would grow the collection length
  // and produce two rows sharing the item's identity — demonstrate this
  // fails where the real replaceCatalogueItemById passes.
  {
    const catalogueBefore = [idRequiredItem];
    const enrichData = { title: 'Strange Tales', issue: '3', year: '1951', publisher: 'Marvel' };
    const correctedItem = buildCorrectedCatalogueItem(idRequiredItem, enrichData);
    const naiveAppendResult = [...catalogueBefore, correctedItem]; // the bug: append, don't replace
    assertFalse(naiveAppendResult.length === catalogueBefore.length, 'TEETH-PROOF: a naive append-instead-of-replace merge WRONGLY grows the collection length');
    const realResult = replaceCatalogueItemById(catalogueBefore, correctedItem);
    assertTrue(realResult.length === catalogueBefore.length, 'TEETH-PROOF: the REAL replaceCatalogueItemById keeps the length unchanged — confirms the assertion above is not vacuous');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Normalizer edge cases (normalizeManualIssue / normalizeManualYear)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\nNormalizer edge cases\n');
{
  assertEq(normalizeManualIssue('3'), '3', 'plain numeric issue passes through');
  assertEq(normalizeManualIssue('  3  '), '3', 'whitespace trimmed');
  assertEq(normalizeManualIssue(''), null, 'empty string -> null');
  assertEq(normalizeManualIssue('   '), null, 'whitespace-only -> null');
  assertEq(normalizeManualIssue(null), null, 'null -> null, no throw');
  assertEq(normalizeManualIssue('Annual #14'), '14', 'reuses normalizeIssueFormat (compHygiene.js) for format markers, not a second parser');

  assertEq(normalizeManualYear('1951', 2026), '1951', 'plain valid year passes through');
  assertEq(normalizeManualYear('abcd', 2026), null, 'non-numeric -> null');
  assertEq(normalizeManualYear('1899', 2026), null, 'below YEAR_MIN (1930) -> null');
  assertEq(normalizeManualYear('2027', 2026), '2027', 'currentYear+1 (solicitation lead) is allowed');
  assertEq(normalizeManualYear('2028', 2026), null, 'currentYear+2 -> null (too far in the future)');
  assertEq(normalizeManualYear('', 2026), null, 'empty -> null');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
