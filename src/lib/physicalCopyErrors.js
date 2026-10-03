// src/lib/physicalCopyErrors.js — GK-279. ONE place that turns the two
// physical-copy standing errors into HTTP responses, so every protected path
// answers identically:
//   PHYSICAL_COPY_DECISION_REQUIRED          409  candidates exist, operator must choose
//   PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE 503  standing could not be determined
// FAIL-CLOSED: "check failed" is never treated as "zero candidates". The 503 is
// deliberately distinct from generic 409/500 handling and always logs one
// greppable line (no secrets, no tokens, no payload).
//
//   [physical-copy] CANDIDATE_CHECK_UNAVAILABLE principal=<uuid> handler=<name> requestId=<id|none> category=<code|name> build=<sha7|unknown>
import { PhysicalCopyDecisionRequiredError, PhysicalCopyCandidateCheckUnavailableError } from '../modules/assets/index.js';

export const PHYSICAL_COPY_CHECK_UNAVAILABLE_CODE = 'PHYSICAL_COPY_CANDIDATE_CHECK_UNAVAILABLE';

export function physicalCopyCheckLogLine({ principalId, handler, req, category }) {
  const rid = req?.headers?.['x-vercel-id'] || req?.headers?.['x-request-id'] || 'none';
  const build = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'unknown';
  const safe = (v) => String(v ?? 'unknown').replace(/[^A-Za-z0-9_.:\-]/g, '_').slice(0, 80);
  return `[physical-copy] CANDIDATE_CHECK_UNAVAILABLE principal=${safe(principalId)} handler=${safe(handler)} requestId=${safe(rid)} category=${safe(category)} build=${safe(build)}`;
}

// Returns true when it handled (sent) the response.
export function respondPhysicalCopyError(res, e, { principalId, handler, req } = {}) {
  if (e instanceof PhysicalCopyDecisionRequiredError) {
    res.status(409).json({ error: 'PHYSICAL_COPY_DECISION_REQUIRED', detail: e.message, candidates: e.candidates });
    return true;
  }
  if (e instanceof PhysicalCopyCandidateCheckUnavailableError) {
    console.error(physicalCopyCheckLogLine({ principalId, handler, req, category: e.category }));
    res.status(503).json({
      error: PHYSICAL_COPY_CHECK_UNAVAILABLE_CODE, retryable: true,
      detail: 'The ownership check could not complete, so nothing was saved. Please retry.',
    });
    return true;
  }
  return false;
}
