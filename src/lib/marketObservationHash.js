// src/lib/marketObservationHash.js — D5A, mo-hash-v1.
//
// NOT wired into any production endpoint, any adapter, or any DB write path
// yet — pure infrastructure, matching the same "designed, unconsumed"
// convention already established by src/lib/evidenceContracts.js (GK-182).
// No provider adapter is authorized to call this (D5D remains gated behind
// D5B/D5C, and behind the rights review named in GK-182/A3).
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
// decoder (conceptual — nothing in this codebase decodes the hash input,
// but injectivity is what makes the ENCODING side trustworthy) never scans
// for a delimiter; it always consumes exactly the declared byte count
// before moving to the next field. This is immune by construction to a
// field's own content containing what would have been a delimiter byte —
// see tests/d5a-market-observation-hash-serializer.test.js for the
// property/adversarial proof, including the exact field-shifting
// construction this design is meant to defeat.
//
// PRE-LIVE DESIGN CORRECTION (T1/T1a/T2/T2a, 2026-09-03) — two
// corrections to the first draft, both load-bearing:
//   T1/T1a — occurred_at gained a sibling, occurred_at_precision
//     ('DATE'|'INSTANT'), and BOTH now participate in the hash. A
//     date-only source fact ("2026-06-14") is never coerced into
//     asserting a time-of-day the source never supplied — the stored
//     TIMESTAMPTZ uses UTC midnight purely as a storage anchor when
//     precision='DATE', and occurred_at_precision is what actually
//     records what was and wasn't asserted. This means a date-only fact
//     and a genuinely-midnight-UTC exact instant are DIFFERENT hash
//     inputs even though their TIMESTAMPTZ value is textually identical
//     — precision is not decorative, it changes the hash.
//   T2/T2a — grade_numeric's canonicalization is no longer a
//     comic-specific fixed one-decimal scale (that was vertical leakage
//     — CGC/CBCS's own one-decimal convention, encoded into a supposedly
//     provider-neutral, asset-class-neutral table). It now uses MINIMAL
//     exact-decimal normalization (strip insignificant trailing
//     fractional zeros only, no padding to any fixed scale) — see
//     canonicalMinimalDecimal below. price_amount is UNCHANGED (still
//     fixed-scale-4, canonicalFixedScaleDecimal) — money has a real,
//     currency-defined natural precision; grade/condition-index values
//     have no universal natural precision across asset classes, so the
//     two fields deliberately use different canonicalization strategies.

import { createHash } from 'node:crypto';

export const HASH_CONTRACT_VERSION = 'mo-hash-v1';

export const OCCURRED_AT_PRECISIONS = Object.freeze(['DATE', 'INSTANT']);

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
// property-tested for injectivity (D2b — "collision resistance of SHA-256
// is not a substitute for injective canonical serialization").
//
// T1a -- occurredAtPrecision is its OWN tuple field, immediately after
// occurredAt, not folded into the occurredAt string itself -- keeping
// them as two independently-encoded TLV fields (rather than e.g.
// prefixing the precision onto the timestamp string) means the
// injectivity proof for one field never has to reason about the other's
// content, and a future field reordering/addition stays mechanical.
export function serializeMarketObservationTuple({
  provider, providerItemId, listingKind, priceAmount, currency,
  conditionText, gradeNumeric, occurredAt, occurredAtPrecision,
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
    encodeField(occurredAt),
    encodeField(occurredAtPrecision),
  ]);
}

// computeMarketObservationHash -- SHA-256 hex digest of the tuple above.
// occurred_at and occurred_at_precision both participate (S1/T1a) -- an
// asserted fact about the market event itself, and the fidelity of that
// assertion, reversing this dispatch train's own earlier exclusion and
// earlier under-specification. observed_at, recorded_at, id,
// recorded_by_principal_id, correlation_id, raw_payload, and content_hash
// itself are NEVER part of this input -- provenance/timing metadata, not
// observed market fact.
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

// normalizeText -- provider_item_id, condition_text. Trim, collapse
// internal whitespace, Unicode NFC-normalize, lowercase (case/whitespace
// differences must not manufacture a spurious "new" observation for
// trivially-reformatted re-scraped text). A present-but-empty string
// stays present-but-empty (never silently promoted to null) -- only a
// genuinely absent (null/undefined) input yields null.
export function normalizeText(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase();
}

// canonicalFixedScaleDecimal -- price_amount ONLY (scale=4). Exact base-10
// STRING normalization -- never routes through Number/toFixed/IEEE-754
// float rounding, so the hash input can never silently diverge from the
// persisted exact NUMERIC value on a floating-point edge case.
//
// Rules (D3, ratified 2026-09-03, unchanged by the T2/T2a correction --
// money has a real, currency-defined natural precision; a fixed scale is
// the right choice HERE specifically, unlike grade -- see
// canonicalMinimalDecimal below for why grade differs):
//   - leading zeros stripped ("007" -> "7")
//   - fractional part padded with trailing zeros up to `scale` digits
//     ("66" -> "66.0000" at scale=4)
//   - fractional precision BEYOND `scale` is REJECTED (thrown), UNLESS
//     every excess digit is itself '0' -- silent rounding is never
//     performed; a genuinely over-precise input is a data-quality bug at
//     the adapter layer, not something to coerce quietly.
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

// canonicalMinimalDecimal -- grade_numeric ONLY (T2/T2a, 2026-09-03
// correction). Deliberately NOT a fixed-scale function -- MarketObservation
// is provider-neutral AND asset-class-neutral; a hard-coded one-decimal
// scale was CGC/CBCS's own comic-grading convention leaking into a
// permanent-domain table that must not assume any vertical's grading
// system. This function makes no assumption about what scale a numeric
// grade/condition-index is expressed in -- it only guarantees that two
// different EXACT DECIMAL SPELLINGS of the same value canonicalize
// identically, and different values never do. Pure base-10 string
// manipulation -- never Number/parseFloat/toFixed/IEEE-754.
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

// normalizeOccurredAt -- occurred_at + occurred_at_precision together
// (T1/T1a, 2026-09-03 correction). observed_at/recorded_at never pass
// through this (they never enter the hash at all -- see the header).
//
// Precision is REQUIRED input, never inferred from the shape of `value`
// -- guessing "this string looks like a bare date, so it must be
// DATE-precision" would be exactly the kind of silent inference this
// correction exists to eliminate. The CALLER (a future adapter) is the
// only party that actually knows whether its source asserted a full
// instant or only a calendar date, so the caller must say so explicitly.
//
//   value === null  -> event time genuinely unknown. precision MUST also
//     be null/undefined in this case (there is nothing to qualify).
//   precision === 'DATE'  -> the source asserted a calendar date only,
//     no time-of-day. `value` is normalized to UTC midnight as a STORAGE
//     ANCHOR ONLY -- this is never to be read as "the event happened at
//     midnight." Readers must check occurred_at_precision before
//     interpreting occurred_at's apparent precision.
//   precision === 'INSTANT'  -> the source asserted a specific point in
//     time. `value` is normalized to its exact ISO-8601 UTC
//     millisecond-precision instant, unmodified.
//
// Never infers a missing event time from anything, never defaults
// precision, never silently promotes DATE to INSTANT or vice versa.
export function normalizeOccurredAt({ value, precision } = {}) {
  if (value === null || value === undefined) {
    if (precision !== null && precision !== undefined) {
      throw new Error('normalizeOccurredAt: precision must be null/undefined when value is null -- unknown event time has no precision to qualify');
    }
    return { occurredAt: null, occurredAtPrecision: null };
  }
  if (!OCCURRED_AT_PRECISIONS.includes(precision)) {
    throw new Error(`normalizeOccurredAt: precision must be exactly 'DATE' or 'INSTANT' when value is present, got ${JSON.stringify(precision)}`);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`normalizeOccurredAt: not a valid date/timestamp: ${JSON.stringify(value)}`);
  }
  return { occurredAt: d.toISOString(), occurredAtPrecision: precision };
}

// canonicalizeMarketObservationFields -- convenience: raw field values in,
// the exact canonical tuple computeMarketObservationHash/
// serializeMarketObservationTuple expect, out. Kept separate from those
// two functions so normalization rules and byte-serialization rules stay
// independently testable (D2b).
export function canonicalizeMarketObservationFields({
  provider, providerItemId, listingKind, priceAmount, currency,
  conditionText, gradeNumeric, occurredAt, occurredAtPrecision,
}) {
  const occ = normalizeOccurredAt({ value: occurredAt, precision: occurredAtPrecision });
  return {
    provider: normalizeLowerToken(provider),
    providerItemId: normalizeText(providerItemId),
    listingKind: normalizeLowerToken(listingKind),
    priceAmount: canonicalPriceString(priceAmount),
    currency: normalizeUpperCode(currency),
    conditionText: normalizeText(conditionText),
    gradeNumeric: canonicalGradeString(gradeNumeric),
    occurredAt: occ.occurredAt,
    occurredAtPrecision: occ.occurredAtPrecision,
  };
}
