// src/lib/pipelineAudit.js
//
// A6 dispatch (2026-07-26) — Flash #128/#139's [q140-terminal]/[decision]
// console lines were cut off before capture on two of five certification
// fixtures (confirmed: highest total log volume and [22f] duplicate-line
// density of the five, and a single-request-scoped re-fetch reproduced the
// identical cutoff twice, ruling out a query-side artifact). Console
// output was the SOLE certification authority for the terminal invariant —
// this closes that single point of failure by embedding the same snapshot
// directly on the response itself.
//
// pipelineAudit is RESPONSE-EMBEDDED STRUCTURED EVIDENCE, not a
// tamper-proof custody record — it travels with one HTTP response, is
// visible to and reproducible by the client that received it, and proves
// nothing about server-side log integrity. A server-owned audit sink
// (durable, independent of any single response) is queued, not built here.
//
// LIFECYCLE: pipelineAudit is a historical, immutable snapshot of one
// enrich response. It is NOT the same thing as the future Step 2A
// reviewContract ({reviewState, lockCodes, allowedActions, overridePolicy,
// automatedListingAllowed}) — that will be a SEPARATE, live, top-level
// object representing CURRENT operational authority (what the UI may do
// right now). Step 2A may later embed an immutable contractSnapshot
// inside a pipelineAudit for evidentiary purposes, but a historical trace
// must never be read as, or promoted into, the current contract.
//
// Built from the EXACT variables the terminal invariant reads at the
// point it reads them — no recomputation, no reparsing, no re-fetching.
// Every enrich.js call site passes in its own already-computed values;
// this function only assembles and normalizes, never derives.

const normalizeCode = (s) => {
  const str = String(s ?? '').trim();
  if (!str) return null;
  return str
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

/**
 * @param {object} ctx
 * @param {string} ctx.traceId - public-safe identifier for this response
 *   (never an internal provider/eBay/PriceCharting request ID).
 * @param {string|null} ctx.buildSha - the exact value already computed for
 *   the [boot] log line (VERCEL_GIT_COMMIT_SHA slice or CV_BUILD_ID).
 * @param {number} ctx.identityRevision - monotonic per-request value
 *   (server request timestamp); client-side merge uses this to reject an
 *   older async response overwriting a newer one for the same item.
 * @param {object|null} ctx.familyIssueConsensus - the raw object returned
 *   by resolveFamilyIssueConsensus (identityCore.js), or null/undefined
 *   when no family-scoped consensus ran at all for this response (e.g. an
 *   early-refused or hard-blocked path) — never fabricated.
 * @param {string|null} ctx.familyKey - the resolved identity title string
 *   this family-issue-authority (if any) was computed against.
 * @param {*} ctx.pricingIssue - the exact pre-pricing issue value.
 * @param {*} ctx.confirmedIssue - the exact confirmedIssue value at the
 *   point of the terminal check.
 * @param {*} ctx.outIssue - the exact out.issue value at the point of the
 *   terminal check.
 * @param {boolean} ctx.prePricingOk - caller-supplied boundary result
 *   (reuses the already-computed pricingBoundaryOk at the main terminal
 *   site; computed fresh only at early-return sites that never ran the
 *   main check).
 * @param {boolean} ctx.preResponseOk - same, for the pre-response boundary.
 * @param {object|null} ctx.decision - { action, confidence, blockers,
 *   warnings } — whatever shape out.decision holds at the call site,
 *   already computed by computeDecision or set directly by a hard-gate
 *   branch. Never recomputed here.
 */
export function buildPipelineAudit(ctx) {
  const fic = ctx.familyIssueConsensus || null;
  const decision = ctx.decision || null;

  return {
    v: 1,
    traceId: ctx.traceId,
    buildSha: ctx.buildSha || null,
    generatedAt: new Date().toISOString(),
    identityRevision: ctx.identityRevision,
    familyIssueAuthority: {
      mode: fic?.mode || 'none',
      winner: fic?.winner ?? null,
      support: fic?.support ?? null,
      ratio: typeof fic?.ratio === 'number' ? Number(fic.ratio.toFixed(2)) : null,
      uniqueRows: fic?.uniqueRows ?? null,
      familyKey: fic ? (ctx.familyKey ?? null) : null,
    },
    terminalInvariant: {
      prePricing: {
        pricingIssue: ctx.pricingIssue != null ? String(ctx.pricingIssue) : null,
        confirmedIssue: ctx.confirmedIssue != null ? String(ctx.confirmedIssue) : null,
        ok: ctx.prePricingOk === true,
      },
      preResponse: {
        outIssue: ctx.outIssue != null ? String(ctx.outIssue) : null,
        confirmedIssue: ctx.confirmedIssue != null ? String(ctx.confirmedIssue) : null,
        ok: ctx.preResponseOk === true,
      },
    },
    decision: {
      action: decision?.action || null,
      confidence: decision?.confidence || null,
      blockerCodes: Array.isArray(decision?.blockers) ? decision.blockers.map(normalizeCode).filter(Boolean) : [],
      warningCodes: Array.isArray(decision?.warnings) ? decision.warnings.map(normalizeCode).filter(Boolean) : [],
    },
  };
}
