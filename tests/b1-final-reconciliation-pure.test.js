// tests/b1-final-reconciliation-pure.test.js
//
// B1-FINAL A1/A2/A3 -- deterministic, DB-free proofs: the snapshot-verification function, the operator reconciliation
// policy, provider correlation ids, the bounded-review helper, and the seller-scoped lookup contract (mocked fetch only:
// NO live eBay call, NO write call is even constructible by this module).
//   node tests/b1-final-reconciliation-pure.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OA = await import('../src/lib/operatorAuthority.js');
const LK = await import('../src/lib/ebayAttemptLookup.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
console.log('\n=== B1-FINAL pure: snapshot verification, reconciliation policy, correlation, seller-scoped lookup ===\n');

console.log('-- A3: provider correlation --');
{
  const id = '01a13144-dea7-7fa5-8224-566a1ae53fba';
  const c = OA.attemptCorrelation(id);
  ok(/^[0-9a-f]{32}$/.test(c.uuid) && c.uuid === id.replace(/-/g, ''), 'Item.UUID is the attempt id as 32 hex characters (eBay GUID-without-dashes format)');
  ok(c.sku === `GK-${c.uuid}` && c.sku.length === 35 && c.sku.length <= 50, 'Item.SKU label is attempt-linked and within eBay\'s 50-character limit');
  ok(JSON.stringify(OA.attemptCorrelation(id)) === JSON.stringify(c), 'deterministic: the same attempt always yields the same identifiers (a resend carries the same UUID)');
  ok(OA.attemptCorrelation('01a13144-dea7-7fa5-8224-566a1ae53fbb').uuid !== c.uuid, 'distinct attempts yield distinct identifiers');
  let threw = false; try { OA.attemptCorrelation('not-a-uuid'); } catch { threw = true; } ok(threw, 'a non-UUID attempt id is rejected');
}

console.log('\n-- A1: governing-grade reference or explicit uncertainty --');
{
  const m = OA.buildGoverningGradeSnapshot({ grade: 'NM 9.2', gradeAuthority: null });
  ok(m.source === 'MODEL_PREDICTED' && m.uncertainty === 'MODEL_PREDICTED_NOT_OPERATOR_CONFIRMED' && m.grade === 'NM 9.2', 'a model-only grade is recorded as MODEL_PREDICTED with an explicit uncertainty');
  const o = OA.buildGoverningGradeSnapshot({ grade: 'VG 4.0', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'FN 6.0', operatorGradeNumeric: 6, currentGradePrediction: { predictionEventId: 'evt-1' } });
  ok(o.source === 'OPERATOR_CONFIRMED' && o.grade === 'FN 6.0' && o.numericGrade === 6 && o.uncertainty === null && o.predictionEventId === 'evt-1', 'an operator-confirmed grade is recorded as such, with the server-owned prediction reference');
  const n = OA.buildGoverningGradeSnapshot({});
  ok(n.source === 'NONE' && n.uncertainty === 'NO_GOVERNING_GRADE' && n.grade === null, 'no grade at all is recorded as NO_GOVERNING_GRADE, never invented');
  ok(typeof OA.buildGoverningGradeSnapshot(null) === 'object', 'null attributes still yield an explicit snapshot object');
}

console.log('\n-- A1: verifyAuthoritySnapshot detects divergence from the referenced rows --');
{
  const snap = { approved_amount_cents: 26380, approved_currency: 'USD', gk_asset_id: 'A', principal_id: 'P', decision_event_id: 'D', engine_recommendation: 'RESEARCH', approved_at: '2026-10-12T10:00:00.000Z' };
  const action = { action_value_amount: '263.80', action_value_currency: 'USD', gk_asset_id: 'A', principal_id: 'P', action_code: 'LIST', decision_event_id: 'D', occurred_at: '2026-10-12T10:00:00.000Z' };
  const decision = { recommendation: 'RESEARCH', asset_id: 'A' };
  ok(OA.verifyAuthoritySnapshot(snap, { operatorAction: action, decision }).consistent === true, 'consistent references verify');
  const r = OA.verifyAuthoritySnapshot(snap, { operatorAction: { ...action, action_value_amount: '1.00' }, decision });
  ok(!r.consistent && r.discrepancies.some((d) => d.field === 'approved_amount_cents' && d.snapshot === 26380 && d.current === 100), 'a changed referenced price is DETECTED, and the snapshot value (26380) is reported as the approved one');
  ok(!OA.verifyAuthoritySnapshot(snap, { operatorAction: { ...action, action_code: 'HOLD' }, decision }).consistent, 'a referenced action that is no longer LIST is detected');
  ok(!OA.verifyAuthoritySnapshot(snap, { operatorAction: { ...action, principal_id: 'X' }, decision }).consistent, 'a changed principal is detected');
  ok(!OA.verifyAuthoritySnapshot(snap, { operatorAction: action, decision: { ...decision, recommendation: 'LIST_NOW' } }).consistent, 'a changed engine recommendation is detected');
  ok(!OA.verifyAuthoritySnapshot(snap, { operatorAction: null, decision }).consistent, 'a missing referenced action is detected');
}

console.log('\n-- A2: operator reconciliation policy (a human observation is not automatically proof) --');
{
  const submittedAt = '2026-10-12T10:00:00.000Z';
  const now = '2026-10-12T14:00:00.000Z';
  const good = { verdict: 'NOT_FOUND', checkedSources: [...OA.REQUIRED_ABSENCE_SOURCES], checkedAt: '2026-10-12T13:00:00.000Z', evidenceRef: 'seller-hub-screenshot-2026-10-12', requestNewPublish: true, submittedAt, now };
  const e = (o) => OA.evaluateOperatorReconciliation({ ...good, ...o });
  let r = e({});
  ok(r.recordedVerdict === 'NOT_FOUND' && r.newPublishAuthorized === true && r.downgradeReasons.length === 0, 'a complete, timely, evidenced NOT_FOUND with a publish request authorizes a new publish');
  ok(e({ requestNewPublish: false }).newPublishAuthorized === false, 'even a convincing NOT_FOUND does not authorize a publish unless one is requested');
  r = e({ checkedSources: ['SELLER_HUB_ACTIVE'] });
  ok(r.recordedVerdict === 'UNRESOLVED' && r.newPublishAuthorized === false && r.downgradeReasons[0].startsWith('ABSENCE_SOURCES_INCOMPLETE'), 'checking only the Active view is NOT enough: downgraded to UNRESOLVED, publish stays blocked');
  ok(e({ evidenceRef: '' }).recordedVerdict === 'UNRESOLVED' && e({ evidenceRef: undefined }).downgradeReasons.includes('NO_EVIDENCE_REFERENCE'), 'no evidence reference -> downgraded');
  ok(e({ checkedAt: '2026-10-12T10:20:00.000Z' }).downgradeReasons.includes('CHECKED_TOO_SOON_AFTER_SUBMISSION'), 'an observation made within the policy delay of the submission is not accepted as absence');
  ok(e({ checkedAt: '2026-10-12T16:00:00.000Z' }).downgradeReasons.includes('CHECKED_AT_IN_FUTURE'), 'a checked-at in the future is rejected');
  ok(e({ checkedAt: undefined }).downgradeReasons.includes('CHECKED_AT_MISSING'), 'a missing checked-at is rejected');
  ok(e({ submittedAt: null }).downgradeReasons.includes('SUBMISSION_TIME_UNKNOWN'), 'an unknown submission time can never be treated as old enough');
  r = e({ automatedLookup: { matches: [{ itemId: '123', list: 'ActiveList' }] } });
  ok(r.recordedVerdict === 'UNRESOLVED' && r.downgradeReasons.includes('CONTRADICTED_BY_SELLER_SCOPED_LOOKUP'), 'a seller-scoped lookup that FOUND a match overrides the operator\'s NOT_FOUND claim');
  ok(e({ automatedLookup: { matches: [], absenceProven: false } }).recordedVerdict === 'NOT_FOUND', 'an empty lookup does not by itself change the operator verdict (and is never counted as proof)');
  ok(r.claimedVerdict === 'NOT_FOUND', 'the operator\'s original claim is preserved alongside the recorded verdict');
  r = OA.evaluateOperatorReconciliation({ verdict: 'LISTING_FOUND', externalListingId: '110040602158' });
  ok(r.recordedVerdict === 'LISTING_FOUND' && r.newPublishAuthorized === false, 'LISTING_FOUND reconciles to the existing listing and NEVER authorizes a publish');
  let threw = false; try { OA.evaluateOperatorReconciliation({ verdict: 'LISTING_FOUND' }); } catch { threw = true; } ok(threw, 'LISTING_FOUND without a listing id is rejected');
  r = OA.evaluateOperatorReconciliation({ verdict: 'UNRESOLVED' });
  ok(r.recordedVerdict === 'UNRESOLVED' && r.newPublishAuthorized === false, 'UNRESOLVED is a closed-but-blocked disposition');
  threw = false; try { OA.evaluateOperatorReconciliation({ verdict: 'MAYBE' }); } catch { threw = true; } ok(threw, 'an unknown verdict is rejected');
  const rows = (...p) => p.map((x) => (typeof x === 'string' ? { attempt_id: 'A', phase: x } : { attempt_id: 'A', ...x }));
  ok(OA.reduceAttemptState(rows('AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS', { phase: 'OPERATOR_RECONCILED', recon_verdict: 'UNRESOLVED', new_publish_authorized: false })) === 'CLOSED_BLOCKED', 'an UNRESOLVED reconciliation yields CLOSED_BLOCKED');
  ok(OA.assessListingAttemptGuard(rows('AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS', { phase: 'OPERATOR_RECONCILED', recon_verdict: 'UNRESOLVED', new_publish_authorized: false })).code === 'LISTING_ATTEMPT_CLOSED_BLOCKED', 'CLOSED_BLOCKED still BLOCKS a new publish');
  ok(OA.reduceAttemptState(rows('AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS', { phase: 'OPERATOR_RECONCILED', recon_verdict: 'UNRESOLVED', new_publish_authorized: false }, { phase: 'OPERATOR_RECONCILED', recon_verdict: 'NOT_FOUND', new_publish_authorized: true })) === 'RECONCILED_NOT_LISTED', 'a LATER policy-passing reconciliation governs over an earlier closed-but-blocked one');
  ok(OA.reduceAttemptState(rows('AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS', { phase: 'OPERATOR_RECONCILED', recon_verdict: 'NOT_FOUND', new_publish_authorized: true }, { phase: 'OPERATOR_RECONCILED', recon_verdict: 'LISTING_FOUND', new_publish_authorized: false })) === 'LISTED', 'and a later FOUND governs over an earlier not-found (the listing appeared in the views)');
}

console.log('\n-- A2: bounded review --');
{
  ok(OA.AMBIGUOUS_REVIEW_WINDOW_HOURS === 48, 'review window is a named, documented constant (48 h)');
  ok(OA.reviewStatus({ reviewDueAt: '2026-10-12T10:00:00Z', now: '2026-10-12T09:00:00Z' }) === 'WITHIN_WINDOW', 'before the deadline: WITHIN_WINDOW');
  ok(OA.reviewStatus({ reviewDueAt: '2026-10-12T10:00:00Z', now: '2026-10-12T11:00:00Z' }) === 'OVERDUE', 'after the deadline: OVERDUE');
  ok(OA.reviewStatus({ reviewDueAt: null }) === 'NO_DEADLINE', 'no deadline is reported, not assumed');
}

console.log('\n-- A3: seller-scoped lookup contract (mocked transport) --');
{
  const corr = OA.attemptCorrelation('01a13144-dea7-7fa5-8224-566a1ae53fba');
  const calls = [];
  const xmlFor = (list, items, total = 1) => `<GetMyeBaySellingResponse><Ack>Success</Ack><${list}><PaginationResult><TotalNumberOfPages>${total}</TotalNumberOfPages></PaginationResult><ItemArray>${items.map((i) => `<Item><ItemID>${i.id}</ItemID><SKU>${i.sku}</SKU><Title>t</Title></Item>`).join('')}</ItemArray></${list}></GetMyeBaySellingResponse>`;
  const mk = (byList, opts = {}) => async (url, o) => {
    const body = String(o.body); calls.push({ call: o.headers['X-EBAY-API-CALL-NAME'], url: String(url) });
    if (opts.throwOn && body.includes(`<${opts.throwOn}><Include>true`)) throw new Error('socket hang up');
    const list = ['ActiveList', 'ScheduledList', 'UnsoldList', 'SoldList'].find((l) => body.includes(`<${l}><Include>true`));
    if (opts.failOn === list) return { text: async () => '<R><Ack>Failure</Ack></R>' };
    return { text: async () => xmlFor(list, byList[list] || []) };
  };
  const common = { correlation: corr, endpoint: 'https://api.ebay.com/ws/api.dll', headers: { 'X-EBAY-API-IAF-TOKEN': 'redacted-test' } };

  let r = await LK.findListingByAttempt({ ...common, fetchImpl: mk({ ActiveList: [{ id: '9001', sku: corr.sku }, { id: '9002', sku: 'OTHER' }] }) });
  ok(r.matches.length === 1 && r.matches[0].itemId === '9001' && r.matches[0].list === 'ActiveList', 'a listing carrying the attempt\'s SKU label is found in the seller\'s Active list');
  ok(r.absenceProven === false, 'absenceProven is false even when a match exists (the field is a constant, not an inference)');
  ok(calls.every((c) => c.call === 'GetMyeBaySelling'), 'only the read-only GetMyeBaySelling call is ever made (no write call is constructible)');

  calls.length = 0;
  r = await LK.findListingByAttempt({ ...common, fetchImpl: mk({}) });
  ok(r.matches.length === 0 && r.scannedAllListsCompletely === true && r.absenceProven === false, 'an EMPTY complete scan still reports absenceProven:false (the provider guarantees neither completeness nor freshness)');
  ok(r.caveats.includes('NO_PROVIDER_COMPLETENESS_GUARANTEE') && r.caveats.includes('NO_PROVIDER_INDEXING_LATENCY_GUARANTEE') && r.caveats.includes('SOLD_AND_UNSOLD_LIMITED_TO_60_DAYS') && r.caveats.includes('SKU_NOT_CONFIRMED_ON_SOLD_OR_UNSOLD_ITEMS'), 'documented provider caveats travel with every result');
  ok(r.coverage.length === 4 && r.coverage.map((c) => c.list).join() === 'ActiveList,ScheduledList,UnsoldList,SoldList', 'all four seller lists are scanned and their coverage reported');

  r = await LK.findListingByAttempt({ ...common, fetchImpl: mk({}, { throwOn: 'SoldList' }) });
  ok(r.scannedAllListsCompletely === false && r.coverage.find((c) => c.list === 'SoldList').error.startsWith('network:'), 'a transport failure on any list marks the scan INCOMPLETE and is reported');
  r = await LK.findListingByAttempt({ ...common, fetchImpl: mk({}, { failOn: 'UnsoldList' }) });
  ok(r.scannedAllListsCompletely === false && r.coverage.find((c) => c.list === 'UnsoldList').error === 'ack:Failure', 'a provider Failure on any list marks the scan INCOMPLETE');

  const xml = LK.buildGetMyeBaySellingXml({ list: 'SoldList', pageNumber: 2 });
  ok(/<SoldList><Include>true<\/Include><DurationInDays>60<\/DurationInDays>/.test(xml) && /<ActiveList><Include>false<\/Include>/.test(xml), 'Sold/Unsold requests use the provider\'s 60-day maximum window; other lists are excluded');

  const v = await LK.verifyListingById({ itemId: '9001', endpoint: common.endpoint, headers: common.headers, fetchImpl: async () => ({ text: async () => '<GetItemResponse><Ack>Success</Ack><Item><SKU>x</SKU><ListingStatus>Active</ListingStatus></Item></GetItemResponse>' }) });
  ok(v.exists === true && v.status === 'Active', 'GetItem by a KNOWN item id confirms an existing listing');
  const v2 = await LK.verifyListingById({ itemId: '1', endpoint: common.endpoint, headers: common.headers, fetchImpl: async () => { throw new Error('x'); } });
  ok(v2.checked === false && v2.exists === null, 'a transport failure in GetItem is "unchecked", never "does not exist"');

  const src = readFileSync(path.join(root, 'src', 'lib', 'ebayAttemptLookup.js'), 'utf8');
  ok(!/AddFixedPriceItem|AddItem|ReviseFixedPriceItem|EndItem|ReviseItem/.test(src.replace(/\/\/.*$/gm, '')), 'the lookup module contains no write-call name outside comments');
  ok(/KB 1462|knowledge-base\/1462/.test(src) && /GetMyeBaySelling\.html/.test(src), 'the official documentation URLs are cited in the module');
}

console.log(`\n${'='.repeat(60)}\nB1-FINAL PURE: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
