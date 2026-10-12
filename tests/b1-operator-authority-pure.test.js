// tests/b1-operator-authority-pure.test.js
//
// Dispatch B1 -- deterministic, DB-free proofs: GK-284 pure helpers, GK-288 legacy-decision guard (with the
// real New Mutants #98 row shape as the canonical regression fixture), and the B5 model-pin assertion.
// No network, no database, no paid call.
//   node tests/b1-operator-authority-pure.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sanitizeQ41Ack, buildAckWarnings, classifyEvidence, buildApprovalEvidence, classifyAddItemResponse, reduceAttemptState, assessListingAttemptGuard, sameCents, OPERATOR_AUTHORITY_TYPE } =
  await import('../src/lib/operatorAuthority.js');
const { decisionGovernance, decisionTrustStanding, DECISION_GOVERNANCE } = await import('../src/lib/decisionTrust.js');
const { PRICING_USD_PER_MTOK } = await import('../src/lib/anthropicPricing.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
console.log('\n=== B1 pure: GK-284 helpers, GK-288 legacy guard, B5 model pin ===\n');

console.log('-- acknowledgment whitelist --');
{
  const a = sanitizeQ41Ack({ priceOverridden: true, manualPrice: 263.8, listedPrice: 263.8, lockClassAcknowledged: 'insufficiency', locks: ['no-sold-evidence'], state: 'REVIEW', decision: 'RESEARCH',
    title: 'x', evil: 'DROP TABLE', actionAuthority: { state: 'READY' }, token: 'secret-token-value', nested: { a: 1 } });
  ok(OPERATOR_AUTHORITY_TYPE === 'OPERATOR_MANUAL', 'authority type constant is OPERATOR_MANUAL');
  ok(a.manualPrice === 263.8 && a.priceOverridden === true && a.engineDecision === 'RESEARCH' && a.engineState === 'REVIEW', 'known acknowledgment fields survive');
  ok(!('evil' in a) && !('actionAuthority' in a) && !('token' in a) && !('nested' in a), 'unknown / forged / secret-looking client fields are dropped');
  ok(JSON.stringify(a).indexOf('secret-token-value') === -1, 'a token-like value never appears in the persisted payload');
  ok(sanitizeQ41Ack(null) === null && sanitizeQ41Ack([1]) === null && sanitizeQ41Ack('x') === null, 'no / non-object acknowledgment -> null');
  const w = buildAckWarnings({ authority: { state: 'REVIEW', reasonCodes: ['NO_SOLD_EVIDENCE'], marketStanding: 'NO_SOLD_EVIDENCE' }, priorLockCodes: ['a'], freshLockCodes: ['b'] });
  ok(w.authorityState === 'REVIEW' && w.authorityReasonCodes[0] === 'NO_SOLD_EVIDENCE' && w.priorLockCodes[0] === 'a', 'warnings are server-derived and bounded');
}

console.log('\n-- exact-cent price comparison --');
ok(sameCents('$263.80', 263.8) && sameCents('263.8', '263.80') && !sameCents(263.8, 263.81) && !sameCents(263.8, 'abc') && !sameCents(null, 1), 'cents equality (no float equality; invalid -> false)');

console.log('\n-- evidence classification --');
{
  ok(classifyEvidence({ pricingSource: 'active_ask_derived', soldCompDiagnostics: { rawCount: 30, verifiedCount: 0 } }).evidenceClass === 'SOLD_CANDIDATES_UNVERIFIED', 'raw>0, verified=0 -> SOLD_CANDIDATES_UNVERIFIED');
  ok(classifyEvidence({ pricingSource: 'x', soldCompDiagnostics: { rawCount: 0, verifiedCount: 0 } }).evidenceClass === 'NO_SOLD_EVIDENCE', 'raw=0 -> NO_SOLD_EVIDENCE');
  ok(classifyEvidence({ soldCompDiagnostics: { rawCount: 9, verifiedCount: 4, newestDaysAgo: 203 } }).evidenceClass === 'VERIFIED_SOLD_STALE', 'verified>0 but >180 days -> VERIFIED_SOLD_STALE');
  ok(classifyEvidence({ soldCompDiagnostics: { rawCount: 9, verifiedCount: 4, newestDaysAgo: 14 } }).evidenceClass === 'VERIFIED_SOLD_CURRENT', 'verified>0 and fresh -> VERIFIED_SOLD_CURRENT');
  ok(classifyEvidence({}).evidenceClass === 'UNKNOWN' && classifyEvidence(null) === null, 'no diagnostics -> UNKNOWN; no attrs -> null');
  ok(classifyEvidence({ pricingSource: 'active_ask_derived' }).priceBasis === 'ACTIVE_ASK_DERIVED', 'active-ask pricing source is labelled as such');
  const ev = buildApprovalEvidence({
    durableAttrs: { pricingSource: 'active_ask_derived', soldCompDiagnostics: { rawCount: 30, verifiedCount: 0 } },
    presentedAttrs: { pricingSource: 'active_ask_derived', soldCompDiagnostics: { rawCount: 30, verifiedCount: 12 } },
    decisionSnapshot: null, decisionGovernance: { standing: 'LEGACY_UNSNAPSHOTTED', governed: false, flags: ['NO_AUTHORITY_SNAPSHOT'] },
  });
  ok(ev.primary === 'DURABLE_CATALOGUE' && ev.durableCatalogue.provenance === 'SERVER_HELD_CATALOGUE', 'the server-held catalogue view is the primary evidence');
  ok(ev.clientPresented.provenance === 'CLIENT_PRESENTED_UNVERIFIED', 'the client-presented view is stored but labelled unverified');
  ok(ev.discrepancy.includes('VERIFIED_SOLD_COUNT_DIFFERS'), 'a client/server evidence disagreement is named, not hidden');
  ok(ev.decisionSnapshot.provenance === 'LEGACY_NO_SNAPSHOT', 'a missing decision snapshot is recorded as LEGACY_NO_SNAPSHOT, never invented');
}

console.log('\n-- provider response classification (B6 #12) --');
{
  const f = (xml, extra = {}) => classifyAddItemResponse({ httpStatus: 200, responseXml: xml, ...extra });
  ok(f('<AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>123</ItemID></AddFixedPriceItemResponse>').kind === 'LISTED', 'ItemID present -> LISTED');
  ok(f('<R><Ack>Warning</Ack><ItemID>123</ItemID></R>').kind === 'LISTED', 'ItemID present with warnings -> LISTED');
  ok(f('<R><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21919136</ErrorCode></Errors></R>').kind === 'FAILED_DEFINITIVE', 'explicit validation Failure -> FAILED_DEFINITIVE');
  ok(f('<R><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>10007</ErrorCode></Errors></R>').kind === 'AMBIGUOUS', 'system error 10007 -> AMBIGUOUS (the live eBay incident class)');
  ok(f('<R><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21919136</ErrorCode></Errors><Errors><SeverityCode>Error</SeverityCode><ErrorCode>10007</ErrorCode></Errors></R>').kind === 'AMBIGUOUS', 'a definitive code mixed with a system error is still AMBIGUOUS');
  ok(f('<html>bad gateway</html>', { httpStatus: 502 }).kind === 'AMBIGUOUS' && f('', { httpStatus: 500 }).kind === 'AMBIGUOUS', 'HTTP 5xx -> AMBIGUOUS');
  ok(f('', { httpStatus: 408 }).kind === 'AMBIGUOUS', 'HTTP 408 -> AMBIGUOUS');
  ok(f('<garbage/>').kind === 'AMBIGUOUS' && f('').kind === 'AMBIGUOUS', 'unparseable / empty 200 body -> AMBIGUOUS (no Ack is never read as "nothing listed")');
  ok(f('<R><Ack>Success</Ack></R>').kind === 'AMBIGUOUS', 'Success without an ItemID -> AMBIGUOUS');
  ok(f('<R><Ack>PartialFailure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>1</ErrorCode></Errors></R>').kind === 'AMBIGUOUS', 'PartialFailure without an ItemID -> AMBIGUOUS');
  ok(f('<R><Ack>Failure</Ack></R>').kind === 'AMBIGUOUS', 'Failure with no Error entry -> AMBIGUOUS');
  ok(classifyAddItemResponse({ networkError: new Error('socket hang up') }).kind === 'AMBIGUOUS', 'a transport exception -> AMBIGUOUS');
}

console.log('\n-- attempt state + retry guard (B6 #11-#13) --');
{
  const rows = (...phases) => phases.map((phase) => ({ attempt_id: 'A1', phase }));
  ok(reduceAttemptState(rows('AUTHORIZED')) === 'AUTHORIZED_NOT_EXECUTED', 'AUTHORIZED only -> AUTHORIZED_NOT_EXECUTED');
  ok(reduceAttemptState(rows('AUTHORIZED', 'SUBMITTED')) === 'IN_FLIGHT_OR_UNRESOLVED', 'SUBMITTED, no result -> IN_FLIGHT_OR_UNRESOLVED');
  ok(reduceAttemptState(rows('AUTHORIZED', 'SUBMITTED', 'LISTED_CONFIRMED')) === 'LISTED', 'LISTED_CONFIRMED -> LISTED');
  ok(reduceAttemptState(rows('AUTHORIZED', 'SUBMITTED', 'FAILED_DEFINITIVE')) === 'FAILED', 'FAILED_DEFINITIVE -> FAILED');
  ok(reduceAttemptState(rows('AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS')) === 'AMBIGUOUS', 'AMBIGUOUS -> AMBIGUOUS');
  ok(reduceAttemptState([...rows('AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS'), { attempt_id: 'A1', phase: 'OPERATOR_RECONCILED', recon_verdict: 'NOT_FOUND', new_publish_authorized: true }]) === 'RECONCILED_NOT_LISTED', 'an operator reconciliation that PASSED the absence policy supersedes ambiguous');
  ok(reduceAttemptState([...rows('AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS'), { attempt_id: 'A1', phase: 'OPERATOR_RECONCILED', recon_verdict: 'LISTING_FOUND', new_publish_authorized: false }]) === 'LISTED', 'an operator reconciliation that FOUND the listing -> LISTED');
  const g = (...r) => assessListingAttemptGuard(r.flat());
  const att = (id, ...phases) => phases.map((phase) => ({ attempt_id: id, phase }));
  ok(g(att('A', 'AUTHORIZED')).allowed === true, 'an authorized-but-never-sent attempt does not block a retry');
  ok(g(att('A', 'AUTHORIZED', 'SUBMITTED', 'FAILED_DEFINITIVE')).allowed === true, 'a definitive failure does not block a retry');
  ok(g([...att('A', 'AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS'), { attempt_id: 'A', phase: 'OPERATOR_RECONCILED', recon_verdict: 'NOT_FOUND', new_publish_authorized: true }]).allowed === true, 'a policy-passing reconciled-not-found attempt does not block a retry');
  ok(g(att('A', 'AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS')).code === 'LISTING_ATTEMPT_AMBIGUOUS', 'an ambiguous attempt BLOCKS a retry');
  ok(g(att('A', 'AUTHORIZED', 'SUBMITTED')).code === 'LISTING_ATTEMPT_UNRESOLVED', 'a submitted attempt with no result BLOCKS a retry');
  ok(g(att('A', 'AUTHORIZED', 'SUBMITTED', 'LISTED_CONFIRMED')).code === 'LISTING_ALREADY_LISTED_BY_ATTEMPT', 'a live listing BLOCKS a second one');
  ok(g([{ attempt_id: 'A', phase: 'LISTED_CONFIRMED', listing_ended: true }, { attempt_id: 'A', phase: 'SUBMITTED' }, { attempt_id: 'A', phase: 'AUTHORIZED' }]).allowed === true, 'a listing the outcome ledger shows ENDED no longer blocks');
  ok(assessListingAttemptGuard(att('A', 'AUTHORIZED', 'SUBMITTED', 'AMBIGUOUS'), 'A').allowed === true, 'the caller\'s own attempt is excluded from its own guard');
}

console.log('\n-- GK-288: the real New Mutants #98 legacy decision shape (B6 #9) --');
{
  const fx = JSON.parse(readFileSync(path.join(root, 'tests', 'fixtures', 'b1', 'nm98-legacy-decision-shape.json'), 'utf8'));
  // The defect, reproduced: the pre-existing standing function calls this decision fully trusted.
  ok(decisionTrustStanding(fx.decision, fx.valuations) === 'SERVER_DERIVED', 'REPRODUCTION: decisionTrustStanding alone calls the legacy LIST_NOW decision SERVER_DERIVED (no label would be shown)');
  const g = decisionGovernance(fx.decision, fx.valuations, fx.catalogue);
  ok(g.governed === false, 'the legacy decision is NOT a governed authorization');
  ok(g.standing === DECISION_GOVERNANCE.LEGACY_UNSNAPSHOTTED, 'standing = LEGACY_UNSNAPSHOTTED (no authority_snapshot was ever recorded)');
  for (const flag of ['NO_AUTHORITY_SNAPSHOT', 'CATALOGUE_DECISION_DISAGREES', 'NO_VERIFIED_SOLD_EVIDENCE', 'PRICE_DISAGREES_WITH_VALUATION', 'STALE_CATALOGUE_STANDING']) {
    ok(g.flags.includes(flag), `names the contradiction ${flag}`);
  }
  ok(typeof g.label === 'string' && /not a current authorization/.test(g.label), 'carries an operator-facing label saying it is not a current authorization');
  ok(fx.decision.recommendation === 'LIST_NOW' && fx.decision.authority_snapshot === null && fx.valuations.length === 2, 'the historical rows themselves are untouched by evaluation (pure function, input unchanged)');

  // Governed control: a decision WITH a recognised snapshot and verified sold evidence, and no contradiction.
  const governed = decisionGovernance(
    { recommendation: 'LIST_NOW', reason_codes: [], valuation_event_id: 'V', authority_snapshot: { snapshotVersion: 'das-v1', market: { soldEvidence: { verifiedCount: 7, rawCount: 9 } } } },
    [{ id: 'V', value_amount: '100.00', provenance: 'SERVER_DERIVED' }], null);
  ok(governed.governed === true && governed.standing === 'GOVERNED' && governed.label === null, 'CONTROL: a snapshotted, evidence-supported, server-derived decision IS governed');
  const noEvidence = decisionGovernance(
    { recommendation: 'LIST_NOW', valuation_event_id: 'V', authority_snapshot: { snapshotVersion: 'das-v1', market: { soldEvidence: { verifiedCount: 0, rawCount: 9 } } } },
    [{ id: 'V', value_amount: '1', provenance: 'SERVER_DERIVED' }], null);
  ok(noEvidence.governed === false && noEvidence.standing === 'EVIDENCE_NOT_SUPPORTING', 'a snapshotted LIST_NOW with zero verified sold evidence is not governed either');
  ok(decisionGovernance({ recommendation: 'RESEARCH', valuation_event_id: 'V', authority_snapshot: { snapshotVersion: 'das-v1', market: {} } }, [{ id: 'V', provenance: 'SERVER_DERIVED' }], null).governed === true, 'a snapshotted RESEARCH decision is not penalised for having no sold evidence');
  ok(decisionGovernance({ recommendation: 'LIST_NOW', valuation_event_id: 'V' }, [{ id: 'V', provenance: 'CLIENT_ASSERTED' }], null).standing === 'NOT_ENGINE_ANCHORED', 'a client-asserted anchor is NOT_ENGINE_ANCHORED');
  ok(decisionGovernance(null, [], null).governed === false, 'no decision -> not governed');
  // contradictions can only demote, never promote
  const promote = decisionGovernance(fx.decision, fx.valuations, { ...fx.catalogue, soldCompDiagnostics: { rawCount: 9, verifiedCount: 9 }, decision: { action: 'LIST_NOW' }, price: '$263.80', contract: {} });
  ok(promote.governed === false && promote.standing === 'LEGACY_UNSNAPSHOTTED', 'a clean catalogue never PROMOTES a snapshot-less legacy decision');
}

console.log('\n-- operator panel wiring (static) --');
{
  const panel = readFileSync(path.join(root, 'src', 'components', 'GrailKeyOperatorPanel.jsx'), 'utf8');
  ok(/decisionGovernance\(latestDecision, valuations, item\)/.test(panel) && /decisionGovernance \}/.test(panel), 'the operator panel evaluates decisionGovernance against the durable item and imports it');
}

console.log('\n-- B5: verification lane model pin --');
{
  const enrich = readFileSync(path.join(root, 'api', 'enrich.js'), 'utf8');
  const m = enrich.match(/const VERIFY_MODEL = "([^"]+)";/);
  ok(m && m[1] === 'claude-haiku-4-5-20251001', `VERIFY_MODEL is the dated snapshot (found ${m ? m[1] : 'none'})`);
  ok(/model: VERIFY_MODEL,/.test(enrich), 'the verification request reads VERIFY_MODEL');
  ok(/resolveCallCost\(VERIFY_MODEL,/.test(enrich), 'the verification cost lookup reads VERIFY_MODEL');
  ok(!/model:\s*"claude-haiku-4-5"/.test(enrich) && !/VERIFY_MODEL\s*=\s*"claude-haiku-4-5"/.test(enrich), 'no undated alias remains as a literal model id in the verification lane');
  ok(!!PRICING_USD_PER_MTOK['claude-haiku-4-5-20251001'], 'the pinned id has a pricing row (cost stays observable, never unknown_model)');
  ok(PRICING_USD_PER_MTOK['claude-haiku-4-5-20251001'].input === PRICING_USD_PER_MTOK['claude-haiku-4-5'].input && PRICING_USD_PER_MTOK['claude-haiku-4-5-20251001'].output === PRICING_USD_PER_MTOK['claude-haiku-4-5'].output, 'the pinned id prices identically to the alias (no cost behavior change)');
}

console.log(`\n${'='.repeat(60)}\nB1 PURE: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
