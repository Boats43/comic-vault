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

import { createHash } from 'node:crypto';

export const HASH_CONTRACT_VERSION = 'mo-hash-v1';

// ─────────────────────────────────────────────────────────────────────
// Layer 2 — structural (TLV) serialization. No business meaning here.
// ─────────────────────────────────────────────────────────────────────

const PRESENT = 0x01;
const ABSENT = 0x00;

// encodeField(str) -- str is null (absent) or an already-canonical string
// (present, possibly empty). Returns a Buffer: 1 presence byte + 4-byte
// big-endian UTF-8 byte length + the UTF-8 bytes themselves (zero bytes
// if str === ''). NULL and '' are always distinguishable (different
// presence byte) even though both have a zero-length body.
export function encodeField(str) {
  if (str !== null && typeof str !== 'string') {
    throw new TypeError(`encodeField expects a string or null, got ${typeof str}`);
  }
  const presence = str === null ? ABSENT : PRESENT;
  const bytes = str === null ? Buffer.alloc(0) : Buffer.from(str, 'utf8');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([Buffer.from([presence]), lengthBuf, bytes]);
}

// serializeMarketObservationTuple(canonicalFields) -- canonicalFields is
// an object of already-normalized strings-or-null, in the exact ratified
// field order. Returns the full injective Buffer (before hashing) --
// exposed separately from computeMarketObservationHash so the byte
// serialization itself (not just its SHA-256 digest) is what gets
// property-tested for injectivity.
export function serializeMarketObservationTuple({
  provider, providerItemId, listingKind, priceAmount, currency,
  conditionText, gradeNumeric, gradeBasis, occurredOn, occurredAt,
}) {
  return Buffer.concat([
    encodeField(HASH_CONTRACT_VERSION),
    encodeField(provider),
    encodeField(providerItemId),
    encodeField(listingKind),
    encodeField(priceAmount),
    encodeField(currency),
    encodeField(conditionText),
    encodeField(gradeNumeric),
    encodeField(gradeBasis),
    encodeField(occurredOn),
    encodeField(occurredAt),
  ]);
}

// computeMarketObservationHash -- SHA-256 hex digest of the tuple above.
// observed_at, recorded_at, id, recorded_by_principal_id, correlation_id,
// raw_payload, and content_hash itself are NEVER part of this input --
// provenance/timing metadata, not observed market fact.
export function computeMarketObservationHash(canonicalFields) {
  return createHash('sha256').update(serializeMarketObservationTuple(canonicalFields)).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────
// Layer 1 — normalization. Business meaning lives here, per field.
// Every function: null/undefined in -> null out (never fabricated).
// ─────────────────────────────────────────────────────────────────────

// normalizeLowerToken -- provider, listing_kind. Fixed, generic
// vocabulary strings, never comic-specific.
export function normalizeLowerToken(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toLowerCase();
}

// normalizeUpperCode -- currency (ISO 4217 alpha code). Never defaulted
// to USD or any other currency when genuinely unknown (stays null).
export function normalizeUpperCode(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toUpperCase();
}

// normalizeText -- provider_item_id, condition_text, grade_basis. Trim,
// collapse internal whitespace, Unicode NFC-normalize, lowercase
// (case/whitespace differences must not manufacture a spurious "new"
// observation for trivially-reformatted re-scraped text). A
// present-but-empty string stays present-but-empty (never silently
// promoted to null) -- only a genuinely absent (null/undefined) input
// yields null.
export function normalizeText(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase();
}

// canonicalFixedScaleDecimal -- price_amount ONLY (scale=4). Exact base-10
// STRING normalization -- never routes through Number/toFixed/IEEE-754
// float rounding, so the hash input can never silently diverge from the
// persisted exact NUMERIC value on a floating-point edge case.
//
// Rules (D3, unchanged by this closure -- money has a real,
// currency-defined natural precision; a fixed scale is the right choice
// HERE specifically, unlike grade -- see canonicalMinimalDecimal below):
//   - leading zeros stripped ("007" -> "7")
//   - fractional part padded with trailing zeros up to `scale` digits
//     ("66" -> "66.0000" at scale=4)
//   - fractional precision BEYOND `scale` is REJECTED (thrown), UNLESS
//     every excess digit is itself '0' -- silent rounding is never
//     performed.
//   - "-0"/"-0.00" normalizes to unsigned zero (no negative-zero string)
export function canonicalFixedScaleDecimal(value, scale) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`scale must be a non-negative integer, got ${scale}`);
  }
  const str = String(value).trim();
  const m = str.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) {
    throw new Error(`canonicalFixedScaleDecimal: not a valid decimal string: ${JSON.stringify(value)}`);
  }
  const [, sign, rawInt, rawFrac = ''] = m;
  if (rawFrac.length > scale) {
    const excess = rawFrac.slice(scale);
    if (/[^0]/.test(excess)) {
      throw new Error(
        `canonicalFixedScaleDecimal: excess fractional precision beyond ${scale} digit(s) -- ` +
        `refusing to silently round ${JSON.stringify(value)}`
      );
    }
  }
  const normalizedInt = rawInt.replace(/^0+(?=\d)/, '');
  const paddedFrac = (rawFrac + '0'.repeat(scale)).slice(0, scale);
  const isZero = normalizedInt === '0' && /^0*$/.test(paddedFrac);
  const finalSign = sign === '-' && !isZero ? '-' : '';
  return scale > 0 ? `${finalSign}${normalizedInt}.${paddedFrac}` : `${finalSign}${normalizedInt}`;
}

export const canonicalPriceString = (value) => canonicalFixedScaleDecimal(value, 4);

// canonicalMinimalDecimal -- grade_numeric ONLY. Deliberately NOT a
// fixed-scale function -- MarketObservation is provider-neutral AND
// asset-class-neutral; a hard-coded fixed scale would be one grading
// convention's own precision leaking into a permanent-domain table that
// must not assume any vertical's grading system. This function makes no
// assumption about what scale a numeric grade/condition-index is
// expressed in -- it only guarantees that two different EXACT DECIMAL
// SPELLINGS of the same value canonicalize identically, and different
// values never do. Pure base-10 string manipulation -- never
// Number/parseFloat/toFixed/IEEE-754. (F2b: unchanged by this closure.)
//
// Rule: strip INSIGNIFICANT trailing fractional zeros only (never pad to
// any fixed scale); if every fractional digit strips away, drop the
// decimal point entirely (bare integer form). Examples:
//   "9.4"      -> "9.4"
//   "9.40"     -> "9.4"
//   "10"       -> "10"
//   "10.00"    -> "10"
//   "87.1250"  -> "87.125"
export function canonicalMinimalDecimal(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  const m = str.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) {
    throw new Error(`canonicalMinimalDecimal: not a valid decimal string: ${JSON.stringify(value)}`);
  }
  const [, sign, rawInt, rawFrac = ''] = m;
  const normalizedInt = rawInt.replace(/^0+(?=\d)/, '');
  const trimmedFrac = rawFrac.replace(/0+$/, '');
  const isZero = normalizedInt === '0' && trimmedFrac === '';
  const finalSign = sign === '-' && !isZero ? '-' : '';
  return trimmedFrac === '' ? `${finalSign}${normalizedInt}` : `${finalSign}${normalizedInt}.${trimmedFrac}`;
}

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
