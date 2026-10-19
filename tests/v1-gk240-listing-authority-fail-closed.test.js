// V1 CERTIFICATION / GK-240 — listing authority must fail closed.
// Reproduces the 2026-10-18 finding with the REAL authority functions: forging `decision` and omitting
// `soldCompDiagnostics` returned READY. Asserts (1) the old request-trusting shape still reproduces READY in
// isolation (so the fix is proven necessary), (2) the governed resolver blocks it, (3) durable evidence wins
// over a forged request, (4) honest evidence is not over-blocked.
import { deriveLocks } from '../src/lib/responseContract.js';
import { deriveActionAuthority } from '../src/lib/actionAuthority.js';
import { resolveListingAuthorityEvidence } from '../src/lib/listingAuthorityEvidence.js';

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
let r = resolveListingAuthorityEvidence(request, null);
ok(r.sources.soldCompDiagnostics === 'absent-failed-closed', 'missing diagnostics anywhere => failed closed (never skipped)');
let a = authorityOf(r.evidence);
ok(a.state === 'REVIEW' && a.reasonCodes.includes('NO_SOLD_EVIDENCE'), 'forged decision + omitted diagnostics => REVIEW / NO_SOLD_EVIDENCE');

// (3) durable evidence wins over a forged request
const durable = {
  decision: { action: 'RESEARCH', confidence: 'low', blockers: [], warnings: ['no-sold-candidates'] },
  pricingSource: 'active_ask_derived',
  soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, newestDaysAgo: null },
  contract: { locks: [{ code: 'market-standing-no-sold-evidence' }] },
};
r = resolveListingAuthorityEvidence({ ...request, soldCompDiagnostics: { rawCount: 12, verifiedCount: 9, newestDaysAgo: 3 }, priorLockCodes: [] }, durable);
ok(r.sources.decision === 'durable' && r.evidence.decision.action === 'RESEARCH', 'durable decision overrides a forged request decision');
ok(r.sources.soldCompDiagnostics === 'durable' && r.evidence.soldCompDiagnostics.rawCount === 0, 'durable sold diagnostics override forged request diagnostics');
ok(r.priorLockCodes.includes('market-standing-no-sold-evidence'), "durable contract lock codes are folded into priorLockCodes (a client cannot drop them)");
a = authorityOf(r.evidence);
ok(a.state !== 'READY', 'durable-governed evidence is not READY');

// (4) honest, fully-evidenced book is not over-blocked
const honest = {
  decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [] },
  pricingSource: 'verified_sold_recency', matchConfidence: { tier: 'HIGH', score: 100 },
  rawComps: { count: 12 }, identityConfident: true,
  soldCompDiagnostics: { rawCount: 8, verifiedCount: 6, newestDaysAgo: 9 },
};
r = resolveListingAuthorityEvidence(honest, { ...honest, contract: { locks: [] } });
a = authorityOf(r.evidence);
ok(a.state === 'READY' && r.priorLockCodes.length === 0, 'a genuinely evidenced sold-verified book still reaches READY (no over-blocking)');

// restrictive flags: a client can add a restriction, never remove a durable one
r = resolveListingAuthorityEvidence({ manualReviewRequired: false, refusedToPrice: false }, { manualReviewRequired: true, soldCompDiagnostics: honest.soldCompDiagnostics });
ok(r.evidence.manualReviewRequired === true, 'a durable manual-review restriction cannot be cleared by the request');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
