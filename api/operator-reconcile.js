// api/operator-reconcile.js -- B1-RC RC2. The SMALLEST safe operator-only interface for closing an ambiguous marketplace attempt.
//
//   GET  /api/operator-reconcile                      -> the caller's review queue (ambiguous attempts, with deadlines)
//   GET  /api/operator-reconcile?attemptId=<uuid>     -> the exact attempt: asset, submission time, correlation ids, state, history
//   POST /api/operator-reconcile { attemptId, verdict, externalListingId?, observations?, evidenceRef?, checkedSources?, checkedAt?,
//                                  requestNewPublish? }  -> appends ONE append-only OPERATOR_RECONCILED event
//
// WHAT THIS ENDPOINT NEVER DOES: call eBay (read or write), publish or authorize a publish, reserve inventory, write a valuation,
// decision, operator action or price. A recorded `newPublishAuthorized:true` only REMOVES THE BLOCK for this attempt; any new listing
// still goes through the normal publish path and needs its own separate explicit authorization.
//
// AUTHORIZATION (all required, all server-side):
//   1. a valid Bearer session -> principalId comes ONLY from the verified token (never the body, query or a header)
//   2. that principal is an operator-kind principal (isOperatorPrincipal) -- ordinary accounts are refused
//   3. the attempt belongs to that principal and the asset is owned by it (re-checked inside the Asset Service)
// The server's own clock is used for every time comparison: a client cannot supply `now`, and cannot supply an automated-lookup
// result (a forgeable input could unlock a publish), so neither is read from the request.

import { verifyToken, InvalidTokenError, isOperatorPrincipal } from '../src/modules/auth/index.js';
import {
  operatorReconcileAttempt, listAttemptsNeedingReview, getOperatorAuthorityAttempt,
  ValidationFailedError, NotFoundError, ConflictError, AuthorizationFailedError,
} from '../src/modules/assets/index.js';
import { REQUIRED_ABSENCE_SOURCES, MIN_ABSENCE_OBSERVATION_DELAY_MINUTES, AMBIGUOUS_REVIEW_WINDOW_HOURS, RECONCILIATION_POLICY_VERSION, reviewStatus } from '../src/lib/operatorAuthority.js';
import { checkRateLimit } from './rate-limit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICTS = ['LISTING_FOUND', 'NOT_FOUND', 'UNRESOLVED'];

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

// The exact attempt, as the operator needs to see it. No acknowledgment payloads, no evidence blobs, no credentials.
function toAttemptView({ state, phases }) {
  const auth = phases.find((p) => p.phase === 'AUTHORIZED');
  const submitted = phases.find((p) => p.phase === 'SUBMITTED');
  const ambiguous = phases.find((p) => p.phase === 'AMBIGUOUS');
  return {
    attemptId: auth.attempt_id,
    assetId: auth.gk_asset_id,
    channel: auth.channel,
    authorityType: auth.authority_type,
    approvedAmountCents: auth.approved_amount_cents === null ? null : Number(auth.approved_amount_cents),
    approvedCurrency: auth.approved_currency,
    engineRecommendation: auth.engine_recommendation,
    authorizedAt: auth.recorded_at,
    submittedAt: submitted ? submitted.recorded_at : null,
    correlation: auth.provider_correlation ? { sku: auth.provider_correlation.sku, uuid: auth.provider_correlation.uuid } : null,
    state,
    blocksNewPublish: ['AMBIGUOUS', 'CLOSED_BLOCKED', 'IN_FLIGHT_OR_UNRESOLVED', 'LISTED'].includes(state),
    review: ambiguous ? { dueAt: ambiguous.review_due_at, status: reviewStatus({ reviewDueAt: ambiguous.review_due_at }) } : null,
    history: phases.map((p) => ({
      phase: p.phase, recordedAt: p.recorded_at,
      verdict: p.recon_verdict || undefined, newPublishAuthorized: p.new_publish_authorized === null ? undefined : p.new_publish_authorized,
      externalListingId: p.external_listing_id || undefined,
    })),
    policy: { version: RECONCILIATION_POLICY_VERSION, requiredSources: REQUIRED_ABSENCE_SOURCES, minimumDelayMinutes: MIN_ABSENCE_OBSERVATION_DELAY_MINUTES, reviewWindowHours: AMBIGUOUS_REVIEW_WINDOW_HOURS },
  };
}

export default async function handler(req, res) {
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let principalId;
  try {
    ({ principalId } = verifyToken(extractBearerToken(req)));
  } catch (e) {
    if (e instanceof InvalidTokenError) return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    console.error('[operator-reconcile] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  // Operator-only. Fail CLOSED: any error determining operator status is a refusal, never a pass.
  try {
    if (!(await isOperatorPrincipal({ principalId }))) {
      return res.status(403).json({ error: 'OPERATOR_ONLY', message: 'Only an operator account can reconcile a marketplace attempt.' });
    }
  } catch (e) {
    console.error('[operator-reconcile] operator check failed — refusing:', e?.message || e);
    return res.status(503).json({ error: 'OPERATOR_CHECK_UNAVAILABLE', message: 'Operator status could not be verified, so nothing was recorded.' });
  }

  try {
    if (req.method === 'GET') {
      const attemptId = req.query?.attemptId;
      if (!attemptId) {
        const queue = await listAttemptsNeedingReview({ principalId });
        return res.status(200).json({ queue });
      }
      if (!UUID_RE.test(String(attemptId))) return res.status(400).json({ error: 'attemptId must be a UUID' });
      return res.status(200).json({ attempt: toAttemptView(await getOperatorAuthorityAttempt({ principalId, attemptId })) });
    }

    const b = req.body || {};
    if (!b.attemptId || !UUID_RE.test(String(b.attemptId))) return res.status(400).json({ error: 'attemptId (UUID) is required' });
    if (!VERDICTS.includes(b.verdict)) return res.status(400).json({ error: `verdict must be one of ${VERDICTS.join(', ')}` });
    const result = await operatorReconcileAttempt({
      principalId,
      attemptId: b.attemptId,
      verdict: b.verdict,
      externalListingId: typeof b.externalListingId === 'string' ? b.externalListingId.slice(0, 40) : undefined,
      observations: typeof b.observations === 'string' ? b.observations : undefined,
      evidenceRef: typeof b.evidenceRef === 'string' ? b.evidenceRef : undefined,
      checkedSources: Array.isArray(b.checkedSources) ? b.checkedSources : [],
      checkedAt: typeof b.checkedAt === 'string' ? b.checkedAt : undefined,
      requestNewPublish: b.requestNewPublish === true,
      // deliberately NOT passed: now, automatedLookup (server clock only; no client-supplied lookup evidence)
    });
    return res.status(200).json({
      ok: true,
      attemptId: result.attemptId,
      recordedVerdict: result.recordedVerdict,
      claimedVerdict: result.claimedVerdict,
      newPublishAuthorized: result.newPublishAuthorized,
      downgradeReasons: result.downgradeReasons,
      resultingState: result.resultingState,
      outcomeRecorded: result.outcomeRecorded,
      publishPerformed: false,
      notice: result.newPublishAuthorized
        ? 'The block for this attempt is lifted. Nothing was published; any new listing needs its own separate explicit authorization.'
        : 'The block remains in place. Nothing was published.',
    });
  } catch (e) {
    if (e instanceof AuthorizationFailedError) return res.status(403).json({ error: 'FORBIDDEN', message: 'This attempt does not belong to this principal.' });
    if (e instanceof NotFoundError) return res.status(404).json({ error: 'NOT_FOUND', message: e.message });
    if (e instanceof ConflictError) return res.status(409).json({ error: 'CONFLICT', message: e.message });
    if (e instanceof ValidationFailedError) return res.status(400).json({ error: 'VALIDATION_FAILED', message: e.message });
    console.error('[operator-reconcile] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
