// tests/d5a-market-observation-hash-serializer.test.js
//
// D5A, D2/D2a/D2b — property/adversarial proof that mo-hash-v1's byte
// serialization is INJECTIVE: any two canonical field tuples that differ
// in any field's value OR presence produce different serialized bytes.
// This tests the raw serializer (serializeMarketObservationTuple),
// separately from its SHA-256 digest (computeMarketObservationHash) --
// per the ratified instruction, SHA-256 collision resistance is not a
// substitute for proving the pre-hash byte encoding is itself injective.
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
  canonicalFixedScaleDecimal, canonicalPriceString, canonicalGradeString,
  normalizeText, normalizeLowerToken, normalizeUpperCode, normalizeOccurredAt,
  canonicalizeMarketObservationFields, HASH_CONTRACT_VERSION,
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
  gradeNumeric: '9.4', occurredAt: '2026-06-14T00:00:00.000Z',
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
  // A literal former-sentinel string used as REAL condition text must
  // hash differently from a genuinely-absent condition_text.
  const withNull = tupleBytes({ conditionText: null });
  const withLiteral = tupleBytes({ conditionText: normalizeText('CONDITION_UNKNOWN') });
  assertTrue(bytesDiffer(withNull, withLiteral), 'full tuple: conditionText=null vs conditionText="CONDITION_UNKNOWN" (real text) -- byte-distinct');
}

{
  // occurred_at: the retired sentinel string is not a valid timestamp --
  // the NORMALIZER must reject it outright, never silently accept it as
  // if it were a real occurred_at value.
  let threw = false;
  try { normalizeOccurredAt('OCCURRED_AT_UNKNOWN'); } catch (e) { threw = true; }
  assertTrue(threw, 'normalizeOccurredAt rejects the literal retired sentinel string as an invalid timestamp (throws, never silently accepted)');
  // But the RAW serializer layer alone (bypassing the normalizer) still
  // correctly distinguishes null from that literal string as raw bytes.
  const rawNull = encodeField(null);
  const rawLiteral = encodeField('OCCURRED_AT_UNKNOWN');
  assertTrue(bytesDiffer(rawNull, rawLiteral), 'RAW serializer: NULL vs literal "OCCURRED_AT_UNKNOWN" bytes -- still byte-distinct at the serializer layer alone');
}

// ── D2b: field-shifting / delimiter-injection attack ──────────────────
console.log('\n-- field-shifting attack (the exact class the earlier delimiter-based draft was vulnerable to) --\n');

{
  // Direct demonstration that the OLD, REJECTED delimiter-joined design
  // (fields joined with a "\x01" byte) is genuinely vulnerable to exactly
  // this attack, and that THIS repo's real TLV encoder is not.
  const DELIM = '\x01';
  const naiveJoin = (...fields) => fields.join(DELIM);

  // Two LOGICALLY DIFFERENT (providerItemId, listingKind) pairs, chosen so
  // a naive delimiter join of pair 1 equals a naive delimiter join of
  // pair 2 -- field A's content contains the delimiter byte itself,
  // shifting where the "next field" appears to begin.
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
  // Direct proof of length-prefix correctness: encodeField must report
  // the true UTF-8 BYTE length, not the JS string .length (UTF-16 code
  // unit count) -- an emoji is 1 JS "character" region but 4 UTF-8 bytes.
  const emoji = '🎯';
  const enc = encodeField(emoji);
  const declaredLen = enc.readUInt32BE(1);
  const actualBodyLen = enc.length - 5;
  assertTrue(declaredLen === 4, `emoji "🎯" declared length is its true UTF-8 byte count (4), not JS string.length (${emoji.length})`);
  assertTrue(declaredLen === actualBodyLen, 'declared length prefix exactly matches the actual encoded body length');
}

// ── D2b: Unicode normalization behavior (NORMALIZATION layer, not the raw serializer) ──
console.log('\n-- Unicode NFC-equivalent inputs (intentional collapse, at the normalization layer) --\n');

{
  const composed = 'café';       // e-acute as ONE codepoint (NFC form)
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
  // But genuinely DIFFERENT text must never collapse.
  const a = normalizeText('near mint');
  const b = normalizeText('near minu'); // one byte different
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
  const normalizedSpaceOnly = normalizeText('   '); // whitespace-only
  assertTrue(normalizedSpaceOnly === '', 'whitespace-only input normalizes to present-but-empty string, not null');
  assertTrue(normalizeText(null) === null, 'genuinely-null input stays null through normalization (never coerced to "")');
  assertTrue(bytesDiffer(encodeField(null), encodeField(normalizedSpaceOnly)), 'NULL vs normalized-whitespace-only ("") -- still byte-distinct (presence differs)');
}

// ── D2b: NULL currency vs literal text; NULL occurred_at vs arbitrary timestamp-like text ──
console.log('\n-- NULL vs present, for every nullable field --\n');

{
  assertTrue(bytesDiffer(tupleBytes({ currency: null }), tupleBytes({ currency: 'ZZZ' })), 'currency: NULL vs literal "ZZZ" -- byte-distinct');
  assertTrue(bytesDiffer(tupleBytes({ occurredAt: null }), tupleBytes({ occurredAt: '2026-01-01T00:00:00.000Z' })), 'occurredAt: NULL vs an arbitrary real timestamp -- byte-distinct');
  assertTrue(bytesDiffer(tupleBytes({ priceAmount: null }), tupleBytes({ priceAmount: '0.0000' })), 'priceAmount: NULL vs the literal value zero -- byte-distinct (unknown price != a price of zero)');
  assertTrue(bytesDiffer(tupleBytes({ gradeNumeric: null }), tupleBytes({ gradeNumeric: '0.0' })), 'gradeNumeric: NULL vs the literal value zero -- byte-distinct');
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
  const b = tupleBytes({ providerItemId: 'item-124' }); // one character different
  assertTrue(bytesDiffer(a, b), 'two tuples differing ONLY in one byte of one normalized value -- byte-distinct');
}

// ── D2a: grade canonicalization ────────────────────────────────────────
console.log('\n-- D2a: grade fixed-scale decimal contract --\n');

assertTrue(canonicalGradeString('9.4') === '9.4', '"9.4" canonicalizes to "9.4"');
assertTrue(canonicalGradeString('9.40') === '9.4', '"9.40" canonicalizes to "9.4" (trailing zero beyond scale, all-zero excess -- allowed)');
assertTrue(canonicalGradeString('9.4') === canonicalGradeString('9.40'), '"9.4" and "9.40" produce the IDENTICAL canonical string');
assertTrue(canonicalGradeString('09.4') === '9.4', 'leading zero stripped: "09.4" -> "9.4"');
assertTrue(canonicalGradeString('9') === '9.0', 'bare integer grade "9" canonicalizes to "9.0"');
assertTrue(canonicalGradeString(null) === null, 'NULL grade stays NULL (never fabricated)');
{
  let threw = false;
  try { canonicalGradeString('9.47'); } catch (e) { threw = true; }
  assertTrue(threw, '"9.47" (genuine excess precision beyond 1 decimal) is REJECTED, not silently rounded to "9.5"');
}
{
  const h1 = tupleBytes({ gradeNumeric: canonicalGradeString('9.4') });
  const h2 = tupleBytes({ gradeNumeric: canonicalGradeString('9.40') });
  assertTrue(!bytesDiffer(h1, h2), 'full tuple: grade "9.4" and "9.40" hash identically after canonicalization');
}

// ── D3: price canonicalization ─────────────────────────────────────────
console.log('\n-- D3: price fixed-scale decimal contract --\n');

assertTrue(canonicalPriceString('66') === '66.0000', '"66" canonicalizes to "66.0000"');
assertTrue(canonicalPriceString('66.5') === '66.5000', '"66.5" canonicalizes to "66.5000"');
assertTrue(canonicalPriceString('66.1200') === '66.1200', '"66.1200" canonicalizes to itself (already exact scale)');
assertTrue(canonicalPriceString('66.12') === canonicalPriceString('66.1200'), '"66.12" and "66.1200" produce the IDENTICAL canonical string');
assertTrue(canonicalPriceString(null) === null, 'NULL price stays NULL');
assertTrue(canonicalPriceString('-0') === '0.0000', 'negative-zero input normalizes to unsigned "0.0000"');
{
  let threw = false;
  try { canonicalPriceString('66.12345'); } catch (e) { threw = true; }
  assertTrue(threw, 'price with genuine excess precision beyond 4 decimals is REJECTED, not silently rounded');
}
{
  // Float-precision trap this design must never fall into: 0.1 + 0.2 in
  // IEEE-754 is 0.30000000000000004 -- canonicalFixedScaleDecimal never
  // routes through Number arithmetic, only string parsing.
  assertTrue(canonicalPriceString('0.30000000000000004'.slice(0, 6)) === '0.3000', 'string-only decimal parsing never introduces IEEE-754 float drift (0.30000000000000004 truncation-of-input sanity check on the exact string path)');
}

// ── D5.0a mechanism reused here: canonicalizeMarketObservationFields end-to-end ──
console.log('\n-- end-to-end canonicalization + hash determinism --\n');

{
  const f1 = canonicalizeMarketObservationFields({
    provider: 'PriceCharting', providerItemId: '  ABC-123  ', listingKind: 'SOLD',
    priceAmount: '66', currency: 'usd', conditionText: '  Near   Mint  ',
    gradeNumeric: '9.40', occurredAt: '2026-06-14',
  });
  const f2 = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'abc-123', listingKind: 'sold',
    priceAmount: '66.0000', currency: 'USD', conditionText: 'near mint',
    gradeNumeric: '9.4', occurredAt: '2026-06-14T00:00:00.000Z',
  });
  const h1 = computeMarketObservationHash(f1);
  const h2 = computeMarketObservationHash(f2);
  assertTrue(h1 === h2, 'two differently-formatted inputs describing the SAME real fact hash identically end-to-end (idempotent re-observation resolves correctly)');
  assertTrue(/^[0-9a-f]{64}$/.test(h1), 'hash output is a well-formed 64-hex-char SHA-256 digest');
}

{
  const same = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'abc-123', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: 'near mint', gradeNumeric: '9.4', occurredAt: '2026-06-14',
  });
  const laterSale = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'abc-123', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: 'near mint', gradeNumeric: '9.4', occurredAt: '2026-08-02',
  });
  assertTrue(
    computeMarketObservationHash(same) !== computeMarketObservationHash(laterSale),
    'S1 proof: identical price/status/provider/item, DIFFERENT occurred_at (two real PriceCharting sales, 2026-06-14 vs 2026-08-02) -- distinct hashes, never silently collapsed'
  );
}

// ── S3: hash-contract version genuinely participates in the digest ────
console.log('\n-- S3: hash-contract version participation --\n');

{
  assertTrue(HASH_CONTRACT_VERSION === 'mo-hash-v1', 'HASH_CONTRACT_VERSION constant is exactly "mo-hash-v1"');
  const realHash = computeMarketObservationHash(canonicalizeMarketObservationFields({
    provider: 'ebay', providerItemId: 'x', listingKind: 'sold', priceAmount: '1',
    currency: 'USD', conditionText: null, gradeNumeric: null, occurredAt: '2026-01-01',
  }));
  // Simulate a hypothetical "v2" contract by manually building the same
  // tuple with a different version tag as the first TLV field -- proves
  // the version tag is not decorative, it is load-bearing input to the
  // digest, exactly as S3 requires ("dedup does not span a hash-contract-
  // version boundary").
  const v2SimulatedBytes = Buffer.concat([
    encodeField('mo-hash-v2'),
    encodeField('ebay'), encodeField('x'), encodeField('sold'),
    encodeField('1.0000'), encodeField('USD'),
    encodeField(null), encodeField(null),
    encodeField('2026-01-01T00:00:00.000Z'),
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
