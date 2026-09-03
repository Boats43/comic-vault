// src/lib/canonicalHashFraming.js — D5B 0015, V3/D4.
//
// Shared canonical framing primitive, extracted verbatim (byte-for-byte
// identical behavior, zero logic change) from D5A's src/lib/
// marketObservationHash.js so mo-hash-v1 and vq-hash-v1 (and any future
// *-hash-v1 domain contract) share ONE serializer implementation rather
// than each reimplementing presence tagging, length framing, UTF-8
// handling, or decimal canonicalization independently — the exact
// divergence risk named in ADR-VALUATION-001's V3 ruling.
//
//   src/lib/canonicalHashFraming.js  (this file — domain-agnostic, Layer 1+2)
//     ├── src/lib/marketObservationHash.js   (mo-hash-v1 — MarketObservation tuple)
//     └── src/lib/valuationQuestionHash.js   (vq-hash-v1 — ValuationQuestion tuple)
//     └── src/lib/applicabilityHash.js       (applicability-hash-v1 — Applicability tuple)
//
// Each domain module owns ONLY its own tuple shape, its own version
// prefix, and any normalization rule genuinely specific to its own
// fields (e.g. mo-hash-v1's normalizeOccurredOnOrAt stays in
// marketObservationHash.js — it is not a generic primitive, it encodes
// MarketObservation's own dual-representation temporal invariant).
//
// Extraction discipline: every function below is copied unmodified from
// marketObservationHash.js (pre-extraction commit 5d667fc and earlier).
// marketObservationHash.js re-exports these under the SAME names it
// always has, so tests/d5a-market-observation-hash-serializer.test.js
// requires zero changes and is the regression proof that this
// extraction introduced no behavior drift (see that test file, rerun
// unchanged, in the D5B 0015 scratch-proof pass).

import { createHash } from 'node:crypto';

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

// serializeCanonicalTuple(fields) -- fields is an ordered array of
// already-normalized strings-or-null. Returns the full injective Buffer
// (before hashing). Domain modules call this with their own tuple, in
// their own ratified field order, version prefix first.
export function serializeCanonicalTuple(fields) {
  return Buffer.concat(fields.map(encodeField));
}

// hashCanonicalBuffer -- SHA-256 hex digest of an already-serialized
// buffer. Deliberately takes a Buffer, not a fields array: every domain
// module's own computeXHash function calls its OWN serializeXTuple
// first and pipes the result here, so the field order is declared in
// exactly ONE place (that module's serializer) rather than duplicated
// between a serialize function and a separate compute function that
// could silently drift apart from it.
export function hashCanonicalBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// computeCanonicalHash -- convenience one-shot (fields array straight to
// hex digest) for a caller with no separate serialize step of its own.
export function computeCanonicalHash(fields) {
  return hashCanonicalBuffer(serializeCanonicalTuple(fields));
}

// ─────────────────────────────────────────────────────────────────────
// Layer 1 — generic normalization. Domain-agnostic rules only. A rule
// that encodes one domain's own semantics (e.g. mo-hash-v1's temporal
// dual-representation) does NOT belong here — it stays in that domain's
// own hash module.
// ─────────────────────────────────────────────────────────────────────

// normalizeLowerToken -- fixed, generic vocabulary strings (e.g.
// provider, listing_kind, disposition). Never vertical-specific.
export function normalizeLowerToken(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toLowerCase();
}

// normalizeUpperCode -- ISO-style alpha codes (e.g. currency). Never
// defaulted when genuinely unknown (stays null).
export function normalizeUpperCode(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toUpperCase();
}

// normalizeText -- free text needing trim/whitespace-collapse/NFC/
// lowercase so trivially-reformatted re-scraped or re-typed text does
// not manufacture a spurious "new" fact. A present-but-empty string
// stays present-but-empty (never silently promoted to null) -- only a
// genuinely absent (null/undefined) input yields null.
export function normalizeText(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase();
}

// canonicalFixedScaleDecimal -- exact base-10 STRING normalization to a
// fixed decimal scale -- never routes through Number/toFixed/IEEE-754
// float rounding, so the hash input can never silently diverge from a
// persisted exact NUMERIC value on a floating-point edge case.
//
// Rules:
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

// canonicalMinimalDecimal -- for any numeric field where NO fixed scale
// is appropriate (grade/condition-index, plain integer year, etc.) --
// makes no assumption about what scale the value is expressed in; only
// guarantees two different EXACT DECIMAL SPELLINGS of the same value
// canonicalize identically, and different values never do. Pure base-10
// string manipulation -- never Number/parseFloat/toFixed/IEEE-754.
//
// Rule: strip INSIGNIFICANT trailing fractional zeros only (never pad to
// any fixed scale); if every fractional digit strips away, drop the
// decimal point entirely (bare integer form). Examples:
//   "9.4"      -> "9.4"
//   "9.40"     -> "9.4"
//   "10"       -> "10"
//   "10.00"    -> "10"
//   "87.1250"  -> "87.125"
//   "2026"     -> "2026"   (a bare integer, e.g. a target year, is a
//                           zero-fractional-digit case of this same rule
//                           -- no separate integer-canonicalization
//                           function needed)
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

// normalizeUuid -- lowercase, trimmed canonical form of a UUID string.
// Postgres already returns UUIDs in canonical lowercase-hyphenated form,
// but a caller-supplied UUID (before it round-trips through the DB)
// might not be -- normalized here so hash identity never depends on
// which case a UUID literal happened to be typed in.
export function normalizeUuid(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toLowerCase();
}
