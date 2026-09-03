// src/lib/marketObservationHash.js — D5A, mo-hash-v1.
//
// NOT wired into any production endpoint, any adapter, or any DB write path
// yet — pure infrastructure, matching the same "designed, unconsumed"
// convention already established by src/lib/evidenceContracts.js (GK-182).
// No provider adapter is authorized to call this (D5D remains gated behind
// D5B/D5C, and behind the rights review named in GK-182/A3, and behind the
// GK-184 provider-retrieval-time-through-cache requirement below).
//
// Two deliberately separate layers, independently testable and
// independently versionable:
//   1. NORMALIZATION — turns a raw field value into its canonical string
//      form (or null). Business logic: decimal scale, text case-folding,
//      timestamp formatting. Each field's own rule is documented at its
//      own function below.
//   2. SERIALIZATION — turns a tuple of already-canonical strings-or-null
//      into one injective byte sequence, and hashes it. Pure structural
//      encoding. Never inspects field MEANING, only presence/absence and
//      exact byte length.
//
// Layer 2 replaces an earlier, REJECTED draft that joined normalized
// strings with a delimiter byte and used reserved *_UNKNOWN sentinel
// strings for "field absent." Both were withdrawn (D5A dispatch,
// 2026-09-03) because a delimiter-joined encoding is not provably
// injective — nothing prevents a field's own normalized content from
// containing the delimiter byte and shifting where the next field appears
// to start, and a sentinel string is not distinguishable from a provider's
// real text that happens to equal it. This file's encoding is
// length-prefixed (TLV-shaped): every field is encoded as
// <presence byte><4-byte big-endian UTF-8 byte length><UTF-8 bytes>. A
// decoder never scans for a delimiter; it always consumes exactly the
// declared byte count before moving to the next field — immune by
// construction to a field's own content containing what would have been a
// delimiter byte. See tests/d5a-market-observation-hash-serializer.test.js
// for the property/adversarial proof.
//
// FINAL PRE-LIVE REPRESENTATION CLOSURE (F1/F1a/F1b/F1c/F2/F2a/F2b,
// 2026-09-03) — supersedes the intermediate T1/T1a/T2/T2a draft (which
// had already fixed hash semantics but still MANUFACTURED a synthetic
// midnight instant for date-only facts, via an occurred_at_precision
// qualifier bolted onto a single TIMESTAMPTZ column):
//
//   F1/F1b — occurred_at_precision is REMOVED. Temporal representation is
//     now structural, two independent nullable columns: occurredOn (a
//     bare calendar date, canonical form "YYYY-MM-DD", NEVER zero-filled
//     into a timestamp — no synthetic instant is ever manufactured for a
//     date-only fact) and occurredAt (a genuine point-in-time instant,
//     full ISO-8601 UTC millisecond precision). Presence alone is the
//     discriminator: both null = unknown; occurredOn only = a DATE fact;
//     occurredAt only = an INSTANT fact; both populated is illegal
//     (rejected by normalizeOccurredOnOrAt below AND by 0014's own CHECK
//     constraint — defense in depth, not a second source of truth, since
//     the illegal state itself is unrepresentable, not merely
//     discouraged).
//   F1c — both occurredOn and occurredAt participate in the hash as two
//     independent TLV fields. A DATE fact and a genuinely-midnight-UTC
//     INSTANT fact for the same calendar date are automatically
//     byte-distinct, because they populate DIFFERENT columns/fields —
//     no synthetic marker or precision tag is needed to distinguish them.
//   F2/F2a/F2b — grade_basis added: a nullable, generic, source-asserted
//     qualifier (never inferred from comic-domain knowledge, never a
//     hardcoded CGC/CBCS vocabulary) that participates in the hash. A
//     grade with no asserted basis (gradeBasis=null) is a genuinely
//     different, distinct fact from the identical numeric grade WITH an
//     asserted basis — presence-tagged serialization makes this
//     automatic, the same mechanism that already distinguishes NULL from
//     "" everywhere else in this file. canonicalMinimalDecimal (grade's
//     own numeric canonicalization) is UNCHANGED by this closure.

// D5B 0015 (V3/D4) — Layer 2 (TLV framing) and the domain-agnostic half
// of Layer 1 (normalizeLowerToken/normalizeUpperCode/normalizeText/
// canonicalFixedScaleDecimal/canonicalMinimalDecimal) moved to
// src/lib/canonicalHashFraming.js, shared verbatim with vq-hash-v1
// (ValuationQuestion) and applicability-hash-v1 (Applicability) so the
// three domain hash contracts share ONE serializer implementation
// rather than three independent ones. Every name below is re-exported
// under the exact same name it always had — this file's public API is
// byte-for-byte unchanged; tests/d5a-market-observation-hash-serializer
// .test.js requires zero changes and is the regression proof.
import {
  encodeField,
  serializeCanonicalTuple,
  hashCanonicalBuffer,
  normalizeLowerToken,
  normalizeUpperCode,
  normalizeText,
  canonicalFixedScaleDecimal,
  canonicalMinimalDecimal,
} from './canonicalHashFraming.js';

export {
  encodeField,
  normalizeLowerToken,
  normalizeUpperCode,
  normalizeText,
  canonicalFixedScaleDecimal,
  canonicalMinimalDecimal,
} from './canonicalHashFraming.js';

export const HASH_CONTRACT_VERSION = 'mo-hash-v1';

// serializeMarketObservationTuple(canonicalFields) -- canonicalFields is
// an object of already-normalized strings-or-null, in the exact ratified
// field order. Returns the full injective Buffer (before hashing) --
// exposed separately from computeMarketObservationHash so the byte
// serialization itself (not just its SHA-256 digest) is what gets
// property-tested for injectivity. Delegates to the shared framing
// primitive (serializeCanonicalTuple) -- this function now owns only
// the tuple SHAPE (field set + order), not the byte-encoding mechanics.
export function serializeMarketObservationTuple({
  provider, providerItemId, listingKind, priceAmount, currency,
  conditionText, gradeNumeric, gradeBasis, occurredOn, occurredAt,
}) {
  return serializeCanonicalTuple([
    HASH_CONTRACT_VERSION,
    provider, providerItemId, listingKind, priceAmount, currency,
    conditionText, gradeNumeric, gradeBasis, occurredOn, occurredAt,
  ]);
}

// computeMarketObservationHash -- SHA-256 hex digest of the tuple above.
// observed_at, recorded_at, id, recorded_by_principal_id, correlation_id,
// raw_payload, and content_hash itself are NEVER part of this input --
// provenance/timing metadata, not observed market fact. Field order is
// declared exactly once, in serializeMarketObservationTuple above --
// this function pipes its output through the shared hasher rather than
// re-listing the fields, so the two can never silently drift apart.
export function computeMarketObservationHash(canonicalFields) {
  return hashCanonicalBuffer(serializeMarketObservationTuple(canonicalFields));
}

// ─────────────────────────────────────────────────────────────────────
// Layer 1 — MarketObservation-specific normalization only. The generic
// half (normalizeLowerToken/normalizeUpperCode/normalizeText/
// canonicalFixedScaleDecimal/canonicalMinimalDecimal) is imported above
// from canonicalHashFraming.js -- only field-specific aliases and the
// genuinely domain-specific temporal function remain here.
// ─────────────────────────────────────────────────────────────────────

export const canonicalPriceString = (value) => canonicalFixedScaleDecimal(value, 4);

export const canonicalGradeString = canonicalMinimalDecimal;

// normalizeGradeBasis -- grade_basis (F2). A source-asserted qualifier
// (e.g. whatever string a provider's own page/API names its scale as) --
// GrailKey never invents, infers, or defaults one. Uses the same
// normalizeText discipline as condition_text -- trivial formatting
// differences in a provider's re-rendered page must not manufacture a
// spurious "new" observation, but a genuinely-absent basis (null) always
// stays structurally distinct from any present string, including an
// empty one (F2a).
export const normalizeGradeBasis = normalizeText;

// normalizeOccurredOnOrAt -- F1/F1b/F1c. Replaces the earlier
// normalizeOccurredAt + occurred_at_precision draft entirely. Takes BOTH
// raw inputs; returns the canonical { occurredOn, occurredAt } pair.
// Exactly one of the three legal states results:
//   both null/undefined in  -> { occurredOn: null, occurredAt: null }
//     (event time genuinely unknown -- never fabricated)
//   occurredOn given, occurredAt absent -> { occurredOn: "YYYY-MM-DD",
//     occurredAt: null } (a DATE fact -- canonical form is the bare
//     calendar date string ITSELF, never zero-filled into a timestamp;
//     no synthetic instant is manufactured anywhere in this path)
//   occurredAt given, occurredOn absent -> { occurredOn: null,
//     occurredAt: "<full ISO-8601 UTC ms instant>" } (an INSTANT fact)
//   both given -> THROWS. This is not a legal state -- exactly one
//     asserted-fact representation, or neither. 0014's own CHECK
//     constraint enforces the identical rule at the DB layer (defense in
//     depth against the same invariant, not a second, independently
//     mutable source of truth for it).
// Never infers a missing event time from anything, never defaults which
// representation is used -- the caller (a future adapter) supplies
// whichever ONE the source actually asserted.
export function normalizeOccurredOnOrAt({ occurredOn, occurredAt } = {}) {
  const onGiven = occurredOn !== null && occurredOn !== undefined;
  const atGiven = occurredAt !== null && occurredAt !== undefined;

  if (onGiven && atGiven) {
    throw new Error('normalizeOccurredOnOrAt: occurredOn and occurredAt cannot both be supplied -- exactly one asserted temporal fact, or neither (unknown)');
  }
  if (!onGiven && !atGiven) {
    return { occurredOn: null, occurredAt: null };
  }
  if (onGiven) {
    const str = String(occurredOn).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      throw new Error(`normalizeOccurredOnOrAt: occurredOn must be an exact YYYY-MM-DD calendar date, got ${JSON.stringify(occurredOn)}`);
    }
    // Reject a syntactically-shaped but calendrically-invalid date (e.g.
    // 2026-02-30) without ever constructing a TIMESTAMPTZ-shaped instant
    // for a DATE fact -- the round-trip through Date here is validation
    // only, its own instant value is discarded, never returned.
    const validated = new Date(`${str}T00:00:00.000Z`);
    if (Number.isNaN(validated.getTime()) || validated.toISOString().slice(0, 10) !== str) {
      throw new Error(`normalizeOccurredOnOrAt: not a real calendar date: ${JSON.stringify(occurredOn)}`);
    }
    return { occurredOn: str, occurredAt: null };
  }
  const d = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`normalizeOccurredOnOrAt: not a valid date/timestamp: ${JSON.stringify(occurredAt)}`);
  }
  return { occurredOn: null, occurredAt: d.toISOString() };
}

// canonicalizeMarketObservationFields -- convenience: raw field values in,
// the exact canonical tuple computeMarketObservationHash/
// serializeMarketObservationTuple expect, out. Kept separate from those
// two functions so normalization rules and byte-serialization rules stay
// independently testable.
export function canonicalizeMarketObservationFields({
  provider, providerItemId, listingKind, priceAmount, currency,
  conditionText, gradeNumeric, gradeBasis, occurredOn, occurredAt,
}) {
  const occ = normalizeOccurredOnOrAt({ occurredOn, occurredAt });
  return {
    provider: normalizeLowerToken(provider),
    providerItemId: normalizeText(providerItemId),
    listingKind: normalizeLowerToken(listingKind),
    priceAmount: canonicalPriceString(priceAmount),
    currency: normalizeUpperCode(currency),
    conditionText: normalizeText(conditionText),
    gradeNumeric: canonicalGradeString(gradeNumeric),
    gradeBasis: normalizeGradeBasis(gradeBasis),
    occurredOn: occ.occurredOn,
    occurredAt: occ.occurredAt,
  };
}
