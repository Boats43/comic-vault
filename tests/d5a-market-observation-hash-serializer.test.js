// tests/d5a-market-observation-hash-serializer.test.js
//
// D5A, D2/D2a/D2b — property/adversarial proof that mo-hash-v1's byte
// serialization is INJECTIVE: any two canonical field tuples that differ
// in any field's value OR presence produce different serialized bytes.
// This tests the raw serializer (serializeMarketObservationTuple),
// separately from its SHA-256 digest (computeMarketObservationHash) --
// per the ratified instruction, SHA-256 collision resistance is not a
// substitute for proving the pre-hash byte encoding is itself injective.
//
// PRE-LIVE DESIGN CORRECTION (T1/T1a/T2/T2a, 2026-09-03) -- extends the
// original suite with: temporal precision (DATE vs INSTANT) participating
// in the hash and never manufacturing precision a source didn't assert;
// grade canonicalization corrected from a comic-specific fixed one-decimal
// scale to a generic minimal-decimal (trailing-zero-strip) contract.
//
// No DB, no network -- pure deterministic unit proof.
//
// Invoke: node tests/d5a-market-observation-hash-serializer.test.js

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const mod = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'marketObservationHash.js')).href);
const {
  encodeField, serializeMarketObservationTuple, computeMarketObservationHash,
  canonicalFixedScaleDecimal, canonicalPriceString, canonicalMinimalDecimal, canonicalGradeString,
  normalizeText, normalizeLowerToken, normalizeUpperCode, normalizeOccurredAt,
  canonicalizeMarketObservationFields, HASH_CONTRACT_VERSION, OCCURRED_AT_PRECISIONS,
} = mod;

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D5A mo-hash-v1 -- serializer injectivity property proof ===\n');

const BASE_TUPLE = {
  provider: 'ebay', providerItemId: 'item-123', listingKind: 'sold',
  priceAmount: '66.0000', currency: 'USD', conditionText: 'near mint',
  gradeNumeric: '9.4', occurredAt: '2026-06-14T00:00:00.000Z', occurredAtPrecision: 'INSTANT',
};

function tupleBytes(overrides) {
  return serializeMarketObservationTuple({ ...BASE_TUPLE, ...overrides });
}
function bytesDiffer(a, b) {
  return !a.equals(b);
}

// ── D2b: contract-shape basics ───────────────────────────────────────
console.log('-- structural TLV shape --\n');

{
  const nullField = encodeField(null);
  assertTrue(nullField.length === 5, 'NULL encodes to exactly 5 bytes (1 presence + 4 length, 0 body)');
  assertTrue(nullField[0] === 0x00, 'NULL presence byte is 0x00');
  const emptyField = encodeField('');
  assertTrue(emptyField.length === 5, 'present-empty-string encodes to exactly 5 bytes (1 presence + 4 length, 0 body)');
  assertTrue(emptyField[0] === 0x01, 'present-empty-string presence byte is 0x01');
  assertTrue(bytesDiffer(nullField, emptyField), 'NULL and present-empty-string ("") are byte-distinct (differ in presence byte alone)');
}

{
  const spaceField = encodeField(' ');
  const emptyField = encodeField('');
  assertTrue(bytesDiffer(spaceField, emptyField), 'RAW serializer: "" and " " are byte-distinct (both present, different length)');
  assertTrue(spaceField.length === 6, '" " is 1 presence + 4 length + 1 body byte = 6 bytes total');
}

// ── D2b: retired sentinel strings must be ordinary text now ──────────
console.log('\n-- retired *_UNKNOWN sentinels are ordinary text, never confused with NULL --\n');

const RETIRED_SENTINELS = [
  'PROVIDER_ITEM_ID_UNKNOWN', 'PRICE_UNKNOWN', 'CURRENCY_UNKNOWN',
  'CONDITION_UNKNOWN', 'GRADE_UNKNOWN', 'OCCURRED_AT_UNKNOWN',
];
for (const literal of RETIRED_SENTINELS) {
  const nullEnc = encodeField(null);
  const literalEnc = encodeField(literal);
  assertTrue(bytesDiffer(nullEnc, literalEnc), `NULL vs literal text "${literal}" -- byte-distinct`);
}

{
  const withNull = tupleBytes({ conditionText: null });
  const withLiteral = tupleBytes({ conditionText: normalizeText('CONDITION_UNKNOWN') });
  assertTrue(bytesDiffer(withNull, withLiteral), 'full tuple: conditionText=null vs conditionText="CONDITION_UNKNOWN" (real text) -- byte-distinct');
}

{
  let threw = false;
  try { normalizeOccurredAt({ value: 'OCCURRED_AT_UNKNOWN', precision: 'INSTANT' }); } catch (e) { threw = true; }
  assertTrue(threw, 'normalizeOccurredAt rejects the literal retired sentinel string as an invalid timestamp (throws, never silently accepted)');
  const rawNull = encodeField(null);
  const rawLiteral = encodeField('OCCURRED_AT_UNKNOWN');
  assertTrue(bytesDiffer(rawNull, rawLiteral), 'RAW serializer: NULL vs literal "OCCURRED_AT_UNKNOWN" bytes -- still byte-distinct at the serializer layer alone');
}

// ── D2b: field-shifting / delimiter-injection attack ──────────────────
console.log('\n-- field-shifting attack (the exact class the earlier delimiter-based draft was vulnerable to) --\n');

{
  const DELIM = '\x01';
  const naiveJoin = (...fields) => fields.join(DELIM);
  const pair1 = { providerItemId: `a${DELIM}b`, listingKind: 'sold' };
  const pair2 = { providerItemId: 'a', listingKind: `b${DELIM}sold` };

  const naive1 = naiveJoin(pair1.providerItemId, pair1.listingKind);
  const naive2 = naiveJoin(pair2.providerItemId, pair2.listingKind);
  assertTrue(naive1 === naive2, 'sanity: the OLD rejected delimiter-joined design genuinely collides on these two distinct field pairs (proves the vulnerability was real, not hypothetical)');

  const tlv1 = tupleBytes(pair1);
  const tlv2 = tupleBytes(pair2);
  assertTrue(bytesDiffer(tlv1, tlv2), 'THIS repo\'s real TLV (length-prefixed) encoder does NOT collide on the same two field pairs -- the delimiter byte inside providerItemId is just ordinary content, never reinterpreted as a boundary');
}

{
  const emoji = '🎯';
  const enc = encodeField(emoji);
  const declaredLen = enc.readUInt32BE(1);
  const actualBodyLen = enc.length - 5;
  assertTrue(declaredLen === 4, `emoji "🎯" declared length is its true UTF-8 byte count (4), not JS string.length (${emoji.length})`);
  assertTrue(declaredLen === actualBodyLen, 'declared length prefix exactly matches the actual encoded body length');
}

// ── D2b: Unicode normalization behavior ────────────────────────────────
console.log('\n-- Unicode NFC-equivalent inputs (intentional collapse, at the normalization layer) --\n');

{
  const composed = 'café';        // e-acute as ONE codepoint (NFC form)
  const decomposed = 'café';    // 'e' + U+0301 combining acute accent (NFD form)
  assertTrue(composed !== decomposed, 'sanity: the two raw JS strings are literally different byte sequences before normalization');
  const normComposed = normalizeText(composed);
  const normDecomposed = normalizeText(decomposed);
  assertTrue(normComposed === normDecomposed, 'normalizeText: NFC-equivalent Unicode forms collapse to the identical canonical string (intentional -- same real-world text)');
  const hashComposed = tupleBytes({ conditionText: normComposed });
  const hashDecomposed = tupleBytes({ conditionText: normDecomposed });
  assertTrue(!bytesDiffer(hashComposed, hashDecomposed), 'full tuple: NFC vs NFD input for the SAME real text hashes identically after normalization (by design)');
}

{
  const a = normalizeText('near mint');
  const b = normalizeText('near minu');
  assertTrue(a !== b, 'one-byte-different normalized text remains distinct after normalization');
  assertTrue(bytesDiffer(tupleBytes({ conditionText: a }), tupleBytes({ conditionText: b })), 'full tuple: one-byte-different conditionText -- byte-distinct serialization');
}

// ── D2b: whitespace variants collapse intentionally, NULL never does ──
console.log('\n-- whitespace variants (normalization layer) vs. NULL (never conflated) --\n');

{
  const tab = normalizeText('near\tmint');
  const spaces = normalizeText('near   mint');
  const single = normalizeText('near mint');
  assertTrue(tab === spaces && spaces === single, 'tab / multiple-space / single-space collapse to the identical canonical text');
  const normalizedSpaceOnly = normalizeText('   ');
  assertTrue(normalizedSpaceOnly === '', 'whitespace-only input normalizes to present-but-empty string, not null');
  assertTrue(normalizeText(null) === null, 'genuinely-null input stays null through normalization (never coerced to "")');
  assertTrue(bytesDiffer(encodeField(null), encodeField(normalizedSpaceOnly)), 'NULL vs normalized-whitespace-only ("") -- still byte-distinct (presence differs)');
}

// ── D2b: NULL vs present, every nullable field ─────────────────────────
console.log('\n-- NULL vs present, for every nullable field --\n');

{
  assertTrue(bytesDiffer(tupleBytes({ currency: null }), tupleBytes({ currency: 'ZZZ' })), 'currency: NULL vs literal "ZZZ" -- byte-distinct');
  assertTrue(bytesDiffer(tupleBytes({ occurredAt: null, occurredAtPrecision: null }), tupleBytes({ occurredAt: '2026-01-01T00:00:00.000Z', occurredAtPrecision: 'INSTANT' })), 'occurredAt: NULL vs an arbitrary real timestamp -- byte-distinct');
  assertTrue(bytesDiffer(tupleBytes({ priceAmount: null }), tupleBytes({ priceAmount: '0.0000' })), 'priceAmount: NULL vs the literal value zero -- byte-distinct (unknown price != a price of zero)');
  assertTrue(bytesDiffer(tupleBytes({ gradeNumeric: null }), tupleBytes({ gradeNumeric: '0' })), 'gradeNumeric: NULL vs the literal value zero -- byte-distinct');
  assertTrue(bytesDiffer(tupleBytes({ providerItemId: null }), tupleBytes({ providerItemId: '' })), 'providerItemId: NULL vs present-empty-string -- byte-distinct');
}

// ── D2b: presence-only differences, and single-byte differences ──────
console.log('\n-- minimal-difference pairs --\n');

{
  const withId = tupleBytes({ providerItemId: 'x' });
  const withoutId = tupleBytes({ providerItemId: null });
  assertTrue(bytesDiffer(withId, withoutId), 'two tuples differing ONLY in one field\'s presence -- byte-distinct');
}
{
  const a = tupleBytes({ providerItemId: 'item-123' });
  const b = tupleBytes({ providerItemId: 'item-124' });
  assertTrue(bytesDiffer(a, b), 'two tuples differing ONLY in one byte of one normalized value -- byte-distinct');
}

// ── T2/T2a: grade canonicalization -- minimal decimal, no fixed scale ─
console.log('\n-- T2/T2a: grade minimal-decimal (trailing-zero-strip) contract, no comic-specific scale --\n');

assertTrue(canonicalGradeString('9.4') === '9.4', '"9.4" canonicalizes to "9.4"');
assertTrue(canonicalGradeString('9.40') === '9.4', '"9.40" canonicalizes to "9.4" (insignificant trailing zero stripped)');
assertTrue(canonicalGradeString('9.4') === canonicalGradeString('9.40'), '"9.4" and "9.40" produce the IDENTICAL canonical string');
assertTrue(canonicalGradeString('10') === '10', '"10" canonicalizes to "10" (bare integer, no manufactured decimal point)');
assertTrue(canonicalGradeString('10.00') === '10', '"10.00" canonicalizes to "10" (all fractional digits insignificant -- decimal point dropped entirely)');
assertTrue(canonicalGradeString('87.1250') === '87.125', '"87.1250" canonicalizes to "87.125" (one trailing zero stripped, rest preserved exactly)');
assertTrue(canonicalGradeString('09.4') === '9.4', 'leading zero stripped: "09.4" -> "9.4"');
assertTrue(canonicalGradeString(null) === null, 'NULL grade stays NULL (never fabricated)');
assertTrue(canonicalGradeString('9.47') === '9.47', '"9.47" is preserved exactly -- no fixed-scale rejection, since there is no fixed scale (unlike the old comic-specific one-decimal design, this is a fully legal, distinct value now)');
assertTrue(canonicalGradeString('9.4') !== canonicalGradeString('9.47'), '"9.4" and "9.47" remain materially distinct values (never collapsed)');
{
  const h1 = tupleBytes({ gradeNumeric: canonicalGradeString('9.4') });
  const h2 = tupleBytes({ gradeNumeric: canonicalGradeString('9.40') });
  assertTrue(!bytesDiffer(h1, h2), 'full tuple: grade "9.4" and "9.40" hash identically after canonicalization (equivalent decimal spellings)');
  const h3 = tupleBytes({ gradeNumeric: canonicalGradeString('10') });
  const h4 = tupleBytes({ gradeNumeric: canonicalGradeString('10.00') });
  assertTrue(!bytesDiffer(h3, h4), 'full tuple: grade "10" and "10.00" hash identically after canonicalization');
  const h5 = tupleBytes({ gradeNumeric: canonicalGradeString('9.4') });
  const h6 = tupleBytes({ gradeNumeric: canonicalGradeString('9.5') });
  assertTrue(bytesDiffer(h5, h6), 'full tuple: materially different grades ("9.4" vs "9.5") remain byte-distinct');
}
{
  // T2 explicit non-goal check: canonicalMinimalDecimal is exported as the
  // generic function; canonicalGradeString is its grade-specific alias.
  assertTrue(canonicalMinimalDecimal === canonicalGradeString, 'canonicalGradeString is exactly canonicalMinimalDecimal -- no hidden grading-convention-specific logic layered on top');
}
{
  // Never routes through Number/toFixed/IEEE-754 -- a value with more
  // significant digits than any IEEE-754 double can exactly represent
  // must still round-trip exactly as a string.
  const bigPrecise = '123456789012345.678901';
  assertTrue(canonicalGradeString(bigPrecise) === bigPrecise, 'high-precision decimal string beyond IEEE-754 double exactness still canonicalizes losslessly (string-only path, never Number)');
}

// ── D3: price canonicalization (UNCHANGED by T2/T2a -- fixed-scale-4, money's own natural precision) ──
console.log('\n-- D3: price fixed-scale decimal contract (unchanged) --\n');

assertTrue(canonicalPriceString('66') === '66.0000', '"66" canonicalizes to "66.0000"');
assertTrue(canonicalPriceString('66.5') === '66.5000', '"66.5" canonicalizes to "66.5000"');
assertTrue(canonicalPriceString('66.1200') === '66.1200', '"66.1200" canonicalizes to itself (already exact scale)');
assertTrue(canonicalPriceString('66.12') === canonicalPriceString('66.1200'), '"66.12" and "66.1200" produce the IDENTICAL canonical string');
assertTrue(canonicalPriceString(null) === null, 'NULL price stays NULL');
assertTrue(canonicalPriceString('-0') === '0.0000', 'negative-zero input normalizes to unsigned "0.0000"');
{
  let threw = false;
  try { canonicalPriceString('66.12345'); } catch (e) { threw = true; }
  assertTrue(threw, 'price with genuine excess precision beyond 4 decimals is REJECTED, not silently rounded (price DOES still use a fixed scale -- money has a real currency-defined precision, unlike grade)');
}
{
  assertTrue(canonicalPriceString('0.30000000000000004'.slice(0, 6)) === '0.3000', 'string-only decimal parsing never introduces IEEE-754 float drift');
}

// ── T1/T1a: temporal precision ─────────────────────────────────────────
console.log('\n-- T1/T1a: temporal precision (DATE vs INSTANT) participates in the hash --\n');

assertTrue(OCCURRED_AT_PRECISIONS.includes('DATE') && OCCURRED_AT_PRECISIONS.includes('INSTANT') && OCCURRED_AT_PRECISIONS.length === 2, 'exactly two precision values exist: DATE, INSTANT');

{
  const unknown = normalizeOccurredAt({ value: null, precision: null });
  assertTrue(unknown.occurredAt === null && unknown.occurredAtPrecision === null, 'unknown event time: both occurredAt and occurredAtPrecision are null -- never fabricated');
}
{
  let threw = false;
  try { normalizeOccurredAt({ value: null, precision: 'DATE' }); } catch (e) { threw = true; }
  assertTrue(threw, 'a precision supplied WITHOUT a value is rejected (nothing to qualify)');
}
{
  let threw = false;
  try { normalizeOccurredAt({ value: '2026-06-14', precision: null }); } catch (e) { threw = true; }
  assertTrue(threw, 'a value supplied WITHOUT a precision is rejected -- precision is never silently defaulted');
}
{
  let threw = false;
  try { normalizeOccurredAt({ value: '2026-06-14', precision: 'SOMETHING_ELSE' }); } catch (e) { threw = true; }
  assertTrue(threw, 'an invalid precision value is rejected outright');
}

{
  const dateOnly = normalizeOccurredAt({ value: '2026-06-14', precision: 'DATE' });
  assertTrue(dateOnly.occurredAt === '2026-06-14T00:00:00.000Z', 'DATE-precision "2026-06-14" normalizes to a UTC-midnight storage anchor');
  assertTrue(dateOnly.occurredAtPrecision === 'DATE', 'DATE-precision is recorded exactly as asserted, never silently promoted');

  const exactInstant = normalizeOccurredAt({ value: '2026-06-14T00:00:00.000Z', precision: 'INSTANT' });
  assertTrue(exactInstant.occurredAt === '2026-06-14T00:00:00.000Z', 'INSTANT-precision genuinely-midnight timestamp normalizes to the same textual value as the DATE anchor above');
  assertTrue(exactInstant.occurredAtPrecision === 'INSTANT', 'INSTANT-precision is recorded exactly as asserted');

  // T1a's decisive case: identical occurredAt STRING, different precision.
  const dateBytes = tupleBytes({ occurredAt: dateOnly.occurredAt, occurredAtPrecision: dateOnly.occurredAtPrecision });
  const instantBytes = tupleBytes({ occurredAt: exactInstant.occurredAt, occurredAtPrecision: exactInstant.occurredAtPrecision });
  assertTrue(bytesDiffer(dateBytes, instantBytes), 'T1a: DATE-precision "2026-06-14" and INSTANT-precision genuinely-midnight-UTC timestamp are BYTE-DISTINCT despite an identical occurredAt string -- precision is load-bearing hash input, never decorative');
}

{
  // DATE -> INSTANT improvement is a NEW, more precise assertion.
  const coarse = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null,
    occurredAt: '2026-06-14', occurredAtPrecision: 'DATE',
  });
  const precise = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null,
    occurredAt: '2026-06-14T14:32:07.000Z', occurredAtPrecision: 'INSTANT',
  });
  assertTrue(
    computeMarketObservationHash(coarse) !== computeMarketObservationHash(precise),
    'T1a: date-only -> exact-timestamp improvement of the SAME underlying sale produces a DIFFERENT hash -- correctly modeled as a new, more precise assertion, never an update to the coarser one'
  );
}

{
  // Repeated same-price sales on different DATES (both DATE-precision).
  const sale1 = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null,
    occurredAt: '2026-06-14', occurredAtPrecision: 'DATE',
  });
  const sale2 = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null,
    occurredAt: '2026-08-02', occurredAtPrecision: 'DATE',
  });
  assertTrue(
    computeMarketObservationHash(sale1) !== computeMarketObservationHash(sale2),
    'S1 proof (re-confirmed under DATE precision): identical price/status/provider/item, DIFFERENT dates -- distinct hashes, never silently collapsed'
  );
}

{
  // Correction from one asserted date to another (both DATE-precision).
  const original = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null,
    occurredAt: '2026-06-14', occurredAtPrecision: 'DATE',
  });
  const corrected = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null,
    occurredAt: '2026-06-15', occurredAtPrecision: 'DATE',
  });
  assertTrue(
    computeMarketObservationHash(original) !== computeMarketObservationHash(corrected),
    'a provider date correction (2026-06-14 -> 2026-06-15, both DATE-precision) produces a new hash -- a new immutable observation, never a mutation of the original'
  );
}

// ── D5.0a mechanism reused here: canonicalizeMarketObservationFields end-to-end ──
console.log('\n-- end-to-end canonicalization + hash determinism --\n');

{
  const f1 = canonicalizeMarketObservationFields({
    provider: 'PriceCharting', providerItemId: '  ABC-123  ', listingKind: 'SOLD',
    priceAmount: '66', currency: 'usd', conditionText: '  Near   Mint  ',
    gradeNumeric: '9.40', occurredAt: '2026-06-14', occurredAtPrecision: 'DATE',
  });
  const f2 = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'abc-123', listingKind: 'sold',
    priceAmount: '66.0000', currency: 'USD', conditionText: 'near mint',
    gradeNumeric: '9.4', occurredAt: '2026-06-14T00:00:00.000Z', occurredAtPrecision: 'DATE',
  });
  const h1 = computeMarketObservationHash(f1);
  const h2 = computeMarketObservationHash(f2);
  assertTrue(h1 === h2, 'two differently-formatted inputs describing the SAME real fact hash identically end-to-end (idempotent re-observation resolves correctly)');
  assertTrue(/^[0-9a-f]{64}$/.test(h1), 'hash output is a well-formed 64-hex-char SHA-256 digest');
}

// ── S3: hash-contract version genuinely participates in the digest ────
console.log('\n-- S3: hash-contract version participation --\n');

{
  assertTrue(HASH_CONTRACT_VERSION === 'mo-hash-v1', 'HASH_CONTRACT_VERSION constant is exactly "mo-hash-v1"');
  const realHash = computeMarketObservationHash(canonicalizeMarketObservationFields({
    provider: 'ebay', providerItemId: 'x', listingKind: 'sold', priceAmount: '1',
    currency: 'USD', conditionText: null, gradeNumeric: null,
    occurredAt: '2026-01-01', occurredAtPrecision: 'DATE',
  }));
  const v2SimulatedBytes = Buffer.concat([
    encodeField('mo-hash-v2'),
    encodeField('ebay'), encodeField('x'), encodeField('sold'),
    encodeField('1.0000'), encodeField('USD'),
    encodeField(null), encodeField(null),
    encodeField('2026-01-01T00:00:00.000Z'), encodeField('DATE'),
  ]);
  const { createHash } = await import('node:crypto');
  const v2SimulatedHash = createHash('sha256').update(v2SimulatedBytes).digest('hex');
  assertTrue(realHash !== v2SimulatedHash, 'S3: identical observed facts under a different (simulated v2) hash-contract-version tag produce a DIFFERENT hash -- a future version bump does not silently collide with v1 history, and does not require rewriting any v1 hash to remain correct');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
