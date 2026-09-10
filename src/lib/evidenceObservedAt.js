// src/lib/evidenceObservedAt.js — GK-184, TRUE MARKET-EVIDENCE RETRIEVAL TIME.
//
// Canonical runtime concept: evidenceObservedAt.
//
// Means exactly one thing: the instant this exact provider evidence
// payload/result was obtained from the external source by GrailKey.
//
// It does NOT mean: cache-hit time, request-start time, enrich-handler
// start time, database insertion time (recordedAt), the provider's own
// sale/event time (occurredAt), or cache expiration time. Provider-neutral
// by design (one field name for every source — ComicVine/PriceCharting/
// eBay/future providers — never a per-provider variant like
// ebayObservedAt/priceChartingObservedAt).
//
// This module is pure plumbing. It does NOT touch D5 schema, does NOT
// write to any database, and is NOT wired into any MarketObservation
// persistence path — GK-180 stays at zero writer call sites; D5D runtime
// wiring remains a separate, future, explicitly-gated authorization.
// kv-cache.js's own kvGet/kvSet are UNCHANGED — every existing caller
// (oauth:/scanlog: namespaces) keeps its exact current behavior; those
// are not "provider market evidence" and are deliberately left alone.
//
// Usage at a real provider-evidence call site (cv:/pc:/ph:/ac:/bc:):
//   const result = await lookupSomething(...);
//   if (result) stampEvidenceObservedAt(result, captureEvidenceObservedAt());
//   await kvSet(key, result, ttl);
// On a cache hit, the stamped object is read back with its ORIGINAL
// value already embedded — nothing on the read path ever calls
// captureEvidenceObservedAt again, so a hit can never manufacture a new
// timestamp (GK184-N2).
//
// GK-184 CORRECTION PASS (report-only, 2026-09-03) — two clarifications
// that govern every future consumer of this module, neither changing any
// behavior above:
//
//   1. A legacy/ABSENT evidenceObservedAt means a future D5D persistence
//      path must SKIP writing that observation's MarketObservation.
//      observed_at — never substitute occurredAt, recordedAt, or now()
//      for it. Every touched cache namespace's own TTL bounds how long
//      an ABSENT legacy entry (written before this dispatch) can survive
//      post-deploy before naturally cycling out via ordinary expiry:
//      ac: 1h, bc: 6h, cv:/pc: 24h, ph: 7d (the longest — the true
//      worst-case transition horizon). No deploy-time mass cache
//      invalidation is required as a result, unless future evidence
//      contradicts this.
//   2. Truthful provenance is NOT the same claim as evidence freshness.
//      This module answers only "is evidenceObservedAt a genuine,
//      well-formed instant" (see isEvidenceTimeAdmissible below) — it
//      deliberately contains NO staleness/freshness/expiry policy of any
//      kind. Whether a genuinely-timestamped observation is still fresh
//      enough to trust for a given decision is a distinct, later
//      Applicability/policy-layer question (see D5B's own
//      ValuationQuestion/Applicability boundary), never baked into this
//      provenance-capture primitive.

// Millisecond-precision UTC ISO-8601 only — the exact shape
// `Date.prototype.toISOString()` produces. Anything else (missing 'Z',
// second-precision, a bare date, a non-UTC offset) is rejected rather
// than coerced, per GK-191's own precedent (reject silently-wrong
// timezone/precision instead of normalizing it).
const ISO_UTC_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const EVIDENCE_CLASSIFICATION = Object.freeze({
  PRESENT_VALID: 'present-valid',
  ABSENT: 'absent-unknown',
  MALFORMED: 'malformed-rejected',
});

// Capture the retrieval instant ONCE, at the moment provider evidence was
// actually obtained — call this immediately after a network fetch/parse
// succeeds, never before the fetch and never at cache-read time.
// `nowFn` is injectable for deterministic tests; real call sites never
// pass it (default `() => new Date()`).
export function captureEvidenceObservedAt(nowFn = () => new Date()) {
  return nowFn().toISOString();
}

// Attach evidenceObservedAt directly onto a normalized provider result
// object, in place, and return it. No-ops (returns the input unchanged)
// when resultObj isn't a real object — e.g. a lookup that legitimately
// found nothing (null) never gets a fabricated observation time.
export function stampEvidenceObservedAt(resultObj, observedAtIso) {
  if (resultObj == null || typeof resultObj !== 'object') return resultObj;
  resultObj.evidenceObservedAt = observedAtIso;
  return resultObj;
}

// classifyEvidenceObservedAt — the ONE guard every negative proof (N1,
// N5) anchors to. Exactly three outcomes:
//   ABSENT    — no field at all (legacy cache entry predating this
//               dispatch, or a value that was never stamped because no
//               real evidence was obtained). Must NEVER be silently
//               upgraded to "now" by any caller (GK184-N1).
//   MALFORMED — a field is present but is not an exact millisecond-
//               precision UTC ISO-8601 instant. Rejected, not
//               normalized (GK184-N5).
//   PRESENT_VALID — a genuine, round-trippable UTC instant.
export function classifyEvidenceObservedAt(rawValue) {
  if (rawValue == null) {
    return { classification: EVIDENCE_CLASSIFICATION.ABSENT, value: null };
  }
  if (typeof rawValue !== 'string' || !ISO_UTC_MS_RE.test(rawValue)) {
    return { classification: EVIDENCE_CLASSIFICATION.MALFORMED, value: null };
  }
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== rawValue) {
    return { classification: EVIDENCE_CLASSIFICATION.MALFORMED, value: null };
  }
  return { classification: EVIDENCE_CLASSIFICATION.PRESENT_VALID, value: rawValue };
}

// readEvidenceObservedAt — the ONLY sanctioned accessor. Never falls
// back to now()/occurredAt/recordedAt (GK184-N1/N3/N4) — absent or
// malformed both resolve to null, explicitly, via
// classifyEvidenceObservedAt above. Deliberately reads ONLY the
// `evidenceObservedAt` property — never `occurredAt`/`occurredOn`/
// `recordedAt`/`observedAt` as a fallback source, so a caller can never
// accidentally launder a different timestamp through this accessor.
export function readEvidenceObservedAt(resultObj) {
  return classifyEvidenceObservedAt(resultObj?.evidenceObservedAt).value;
}

// isEvidenceTimeAdmissible — GK-184 CORRECTION PASS, the explicit
// switch-style TIME-AXIS admission test. Answers exactly one question:
// "does this classification correspond to a genuine, usable
// evidenceObservedAt value at all?" It says NOTHING about whether that
// value is fresh/recent enough to be trusted for any particular
// decision — that is a distinct freshness/staleness policy question
// (see the module header's "Provenance Truth != Evidence Freshness"
// note) that belongs to a future Applicability/policy layer, never to
// this file. PRESENT_VALID is the only admissible classification;
// ABSENT and MALFORMED are both explicitly non-admissible (a future
// D5D persistence path must SKIP both, never substitute a fallback
// timestamp for either). The `default` throws rather than silently
// defaulting true/false, so adding a fourth EVIDENCE_CLASSIFICATION
// member without updating this switch fails loudly instead of silently
// mis-admitting or mis-rejecting evidence.
export function isEvidenceTimeAdmissible(classification) {
  switch (classification) {
    case EVIDENCE_CLASSIFICATION.PRESENT_VALID:
      return true;
    case EVIDENCE_CLASSIFICATION.ABSENT:
    case EVIDENCE_CLASSIFICATION.MALFORMED:
      return false;
    default:
      throw new Error(
        `isEvidenceTimeAdmissible: unrecognized classification ${JSON.stringify(classification)} — ` +
        `every EVIDENCE_CLASSIFICATION member must be handled explicitly, no silent default`
      );
  }
}
