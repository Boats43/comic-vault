// V1 CERTIFICATION / GK-240 — listing authority must fail closed.
// Reproduces the 2026-10-18 finding with the REAL authority functions: forging `decision` and omitting
// `soldCompDiagnostics` returned READY. Asserts (1) the old request-trusting shape still reproduces READY in
// isolation (so the fix is proven necessary), (2) the governed resolver blocks it, (3) durable evidence wins
// over a forged request, (4) honest evidence is not over-blocked.
import { deriveLocks } from '../src/lib/responseContract.js';
import { deriveActionAuthority } from '../src/lib/actionAuthority.js';
import { resolveListingAuthorityEvidence } from '../src/lib/listingAuthorityEvidence.js';
import { issueAuthorityReceipt } from '../src/lib/authorityReceipt.js';
process.env.GRAILKEY_SESSION_SECRET = process.env.GRAILKEY_SESSION_SECRET || 'x'.repeat(40);
const PRINCIPAL = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const forgedDecision = { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] };
const authorityOf = (ev) => {
  const out = {
    decision: ev.decision, pricingSource: ev.pricingSource, matchConfidence: ev.matchConfidence,
    rawComps: ev.rawComps, variantApplicability: ev.variantApplicability || null,
    variantApplicabilitySoldFallback: ev.variantApplicabilitySoldFallback === true,
    soldComps: new Array(ev.soldCompCount || 0).fill({}), soldCompDiagnostics: ev.soldCompDiagnostics,
    identityConfident: ev.identityConfident, refusedToPrice: ev.refusedToPrice === true,
    manualReviewRequired: ev.manualReviewRequired === true, gradeExceedsMap: ev.gradeExceedsMap === true,
    claudeCheckBlocker: ev.claudeCheckBlocker || null, tier0Locked: ev.tier0Locked === true,
  };
  const locks = deriveLocks(out);
  return deriveActionAuthority(out, locks, out.decision);
};

const request = {
  decision: forgedDecision, pricingSource: 'active_ask_derived',
  matchConfidence: { tier: 'HIGH', score: 100 }, rawComps: { count: 29 }, identityConfident: true,
  // soldCompDiagnostics omitted, priorLockCodes empty
};

console.log('\n=== V1 GK-240: listing authority fails closed ===\n');

// (1) the pre-fix behavior: request evidence fed straight in
const legacy = authorityOf({ ...request, soldCompDiagnostics: null });
ok(legacy.state === 'READY', 'PRE-FIX SHAPE reproduces: forged decision + omitted diagnostics => READY (the confirmed fail-open)');

// (2) governed resolver, no durable row at all
let r = resolveListingAuthorityEvidence(request, null, { principalId: PRINCIPAL });
ok(r.sources.soldCompDiagnostics === 'absent-failed-closed', 'missing diagnostics anywhere => failed closed (never skipped)');
let a = authorityOf(r.evidence);
ok(a.state === 'REVIEW', 'forged decision + omitted diagnostics, no stored row => REVIEW (not READY)');

// (3) V1 P0 source authority: the stored row is CLIENT-WRITABLE, so loose stored values are NOT evidence; only a
// server-issued receipt that verifies for this principal is.
const row = { title: 'Street Fighter', issue: '1' };
const forgedRow = { ...row, decision: forgedDecision, pricingSource: 'verified_sold_recency', matchConfidence: { tier: 'HIGH', score: 100 }, rawComps: { count: 29 }, identityConfident: true, soldCompDiagnostics: { rawCount: 12, verifiedCount: 9, newestDaysAgo: 3 }, contract: { locks: [] } };
r = resolveListingAuthorityEvidence(request, forgedRow, { principalId: PRINCIPAL });
a = authorityOf(r.evidence);
ok(r.sources.receipt === 'UNVERIFIED:absent' && a.state !== 'READY', 'a stored row with forged loose authority values and NO receipt is not READY');

const honestResponse = { title: 'Street Fighter', issue: '1', year: '1993', decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] },
  pricingSource: 'verified_sold_recency', matchConfidence: { tier: 'HIGH', score: 100 }, rawComps: { count: 12 }, identityConfident: true,
  soldCompDiagnostics: { rawCount: 8, verifiedCount: 6, newestDaysAgo: 9 }, contract: { locks: [] } };
const goodReceipt = issueAuthorityReceipt({ principalId: PRINCIPAL, response: honestResponse });
r = resolveListingAuthorityEvidence({ ...request, soldCompDiagnostics: { rawCount: 99, verifiedCount: 99, newestDaysAgo: 0 } }, { ...row, authorityReceipt: goodReceipt }, { principalId: PRINCIPAL });
ok(r.sources.receipt === 'VERIFIED' && r.sources.soldCompDiagnostics === 'server-receipt' && r.evidence.soldCompDiagnostics.rawCount === 8, 'a verifying receipt supplies the evidence; a forged request value cannot override it');

const lockedResponse = { ...honestResponse, decision: { action: 'RESEARCH', confidence: 'low', blockers: [], warnings: ['no-sold-candidates'] }, soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, newestDaysAgo: null }, contract: { locks: [{ code: 'market-standing-no-sold-evidence' }] } };
r = resolveListingAuthorityEvidence({ ...request, priorLockCodes: [] }, { ...row, authorityReceipt: issueAuthorityReceipt({ principalId: PRINCIPAL, response: lockedResponse }) }, { principalId: PRINCIPAL });
ok(r.priorLockCodes.includes('market-standing-no-sold-evidence'), "the receipt's contract lock codes are folded into priorLockCodes (a client cannot drop them)");
a = authorityOf(r.evidence);
ok(a.state !== 'READY', 'receipt-backed RESEARCH evidence is not READY');

// (4) honest, fully-evidenced book is not over-blocked
r = resolveListingAuthorityEvidence(honestResponse, { ...row, authorityReceipt: goodReceipt }, { principalId: PRINCIPAL });
a = authorityOf(r.evidence);
ok(a.state === 'READY' && r.priorLockCodes.length === 0, 'a genuinely evidenced, receipt-backed sold-verified book still reaches READY (no over-blocking)');

// receipt bound to the principal and to the book
r = resolveListingAuthorityEvidence(honestResponse, { ...row, authorityReceipt: goodReceipt }, { principalId: '00000000-0000-4000-8000-000000000009' });
ok(r.sources.receipt === 'UNVERIFIED:principal-mismatch' && authorityOf(r.evidence).state !== 'READY', "another principal cannot use this receipt");
r = resolveListingAuthorityEvidence(honestResponse, { title: 'Amazing Spider-Man', issue: '300', authorityReceipt: goodReceipt }, { principalId: PRINCIPAL });
ok(r.sources.receipt === 'IDENTITY_MISMATCH' && authorityOf(r.evidence).state !== 'READY', 'a receipt for a different book cannot authorize this one');

// restrictive flags: a client can add a restriction, never remove one
r = resolveListingAuthorityEvidence({ manualReviewRequired: true }, { ...row, authorityReceipt: goodReceipt }, { principalId: PRINCIPAL });
ok(r.evidence.manualReviewRequired === true, 'a request-added manual-review restriction is honored');
const mrReceipt = issueAuthorityReceipt({ principalId: PRINCIPAL, response: { ...honestResponse, manualReviewRequired: true } });
r = resolveListingAuthorityEvidence({ manualReviewRequired: false }, { ...row, authorityReceipt: mrReceipt }, { principalId: PRINCIPAL });
ok(r.evidence.manualReviewRequired === true, 'a manual-review restriction in the signed receipt cannot be cleared by the request');

console.log(`
${pass} passed, ${fail} failed
`);
process.exit(fail ? 1 : 0);
