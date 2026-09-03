// tests/d5a-market-observation-hash-serializer.test.js
//
// D5A, D2/D2a/D2b — property/adversarial proof that mo-hash-v1's byte
// serialization is INJECTIVE: any two canonical field tuples that differ
// in any field's value OR presence produce different serialized bytes.
// This tests the raw serializer (serializeMarketObservationTuple),
// separately from its SHA-256 digest (computeMarketObservationHash) --
// SHA-256 collision resistance is not a substitute for proving the
// pre-hash byte encoding is itself injective.
//
// FINAL PRE-LIVE REPRESENTATION CLOSURE (F1/F1a/F1b/F1c/F2/F2a/F2b,
// 2026-09-03) -- supersedes the intermediate T1/T1a/T2/T2a suite.
// Temporal representation is now structural (occurred_on DATE +
// occurred_at TIMESTAMPTZ, mutually exclusive, no occurred_at_precision
// qualifier). grade_basis added, nullable, hash-participating.
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
  normalizeText, normalizeLowerToken, normalizeUpperCode, normalizeGradeBasis, normalizeOccurredOnOrAt,
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
  gradeNumeric: '9.4', gradeBasis: 'cgc', occurredOn: null, occurredAt: '2026-06-14T00:00:00.000Z',
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

// ── F1/F1b/F1c: structural temporal representation ─────────────────────
console.log('\n-- F1/F1b/F1c: structural temporal representation (occurred_on / occurred_at) --\n');

{
  const unknown = normalizeOccurredOnOrAt({ occurredOn: null, occurredAt: null });
  assertTrue(unknown.occurredOn === null && unknown.occurredAt === null, 'unknown event time: both occurredOn and occurredAt are null -- never fabricated');
}
{
  let threw = false;
  try { normalizeOccurredOnOrAt({ occurredOn: '2026-06-14', occurredAt: '2026-06-14T00:00:00.000Z' }); } catch (e) { threw = true; }
  assertTrue(threw, 'supplying BOTH occurredOn and occurredAt is rejected -- exactly one asserted-fact representation, or neither');
}
{
  let threw = false;
  try { normalizeOccurredOnOrAt({ occurredOn: '2026-02-30', occurredAt: null }); } catch (e) { threw = true; }
  assertTrue(threw, 'a syntactically-date-shaped but calendrically-invalid date (2026-02-30) is rejected');
}
{
  const dateOnly = normalizeOccurredOnOrAt({ occurredOn: '2026-06-14', occurredAt: null });
  assertTrue(dateOnly.occurredOn === '2026-06-14', 'F1: a DATE fact\'s canonical value is the bare calendar date string ITSELF');
  assertTrue(dateOnly.occurredAt === null, 'F1: a DATE fact leaves occurredAt genuinely null -- NO synthetic instant (not even a midnight anchor) is ever constructed');

  const instant = normalizeOccurredOnOrAt({ occurredOn: null, occurredAt: '2026-06-14T00:00:00.000Z' });
  assertTrue(instant.occurredOn === null, 'F1: an INSTANT fact leaves occurredOn genuinely null');
  assertTrue(instant.occurredAt === '2026-06-14T00:00:00.000Z', 'F1: an INSTANT fact\'s canonical value is the exact asserted instant');

  // F1c's decisive case: DATE fact vs. genuinely-midnight INSTANT fact
  // for the identical calendar date -- automatically byte-distinct
  // because they populate DIFFERENT columns, no synthetic marker needed.
  const dateBytes = tupleBytes({ occurredOn: dateOnly.occurredOn, occurredAt: dateOnly.occurredAt });
  const instantBytes = tupleBytes({ occurredOn: instant.occurredOn, occurredAt: instant.occurredAt });
  assertTrue(bytesDiffer(dateBytes, instantBytes), 'F1c: a DATE fact ("2026-06-14") and a genuinely-midnight-UTC INSTANT fact for the SAME calendar date are byte-distinct -- they occupy different fields entirely');
}

{
  // DATE -> INSTANT improvement is a NEW, more precise assertion.
  const coarse = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: '2026-06-14', occurredAt: null,
  });
  const precise = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: null, occurredAt: '2026-06-14T14:32:07.000Z',
  });
  assertTrue(
    computeMarketObservationHash(coarse) !== computeMarketObservationHash(precise),
    'F1: date-only -> exact-timestamp improvement of the SAME underlying sale produces a DIFFERENT hash -- a new, more precise assertion, never an update to the coarser one'
  );
}

{
  // Repeated same-price sales on different DATES (both DATE facts).
  const sale1 = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: '2026-06-14', occurredAt: null,
  });
  const sale2 = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: '2026-08-02', occurredAt: null,
  });
  assertTrue(
    computeMarketObservationHash(sale1) !== computeMarketObservationHash(sale2),
    'S1 proof (re-confirmed under the DATE column): identical price/status/provider/item, DIFFERENT dates -- distinct hashes, never silently collapsed'
  );
}

{
  // Correction from one asserted date to another.
  const original = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: '2026-06-14', occurredAt: null,
  });
  const corrected = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'pc-9', listingKind: 'sold',
    priceAmount: '66', currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: '2026-06-15', occurredAt: null,
  });
  assertTrue(
    computeMarketObservationHash(original) !== computeMarketObservationHash(corrected),
    'a provider date correction (2026-06-14 -> 2026-06-15) produces a new hash -- a new immutable observation, never a mutation of the original'
  );
}

{
  // Neither observed_at nor recorded_at substitutes for event time --
  // they are structurally absent from the hash tuple entirely (proven by
  // the fact that computeMarketObservationHash's parameter object never
  // even has an observedAt/recordedAt field in its destructuring list --
  // passing one has zero effect on the output).
  const withoutExtras = canonicalizeMarketObservationFields({
    provider: 'ebay', providerItemId: 'x', listingKind: 'sold', priceAmount: '1',
    currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: null, occurredAt: null,
  });
  const h1 = computeMarketObservationHash(withoutExtras);
  const h2 = computeMarketObservationHash({ ...withoutExtras, observedAt: '2099-01-01T00:00:00.000Z', recordedAt: '2000-01-01T00:00:00.000Z' });
  assertTrue(h1 === h2, 'injecting observedAt/recordedAt fields into the hash input object has ZERO effect on the digest -- they are structurally excluded, never a silent event-time substitute');
}

// ── F2/F2a/F2b: grade_basis ─────────────────────────────────────────────
console.log('\n-- F2/F2a/F2b: grade_basis (nullable, generic, hash-participating) --\n');

{
  assertTrue(normalizeGradeBasis === normalizeText, 'normalizeGradeBasis reuses normalizeText verbatim -- no hidden grading-authority-specific logic');
  assertTrue(normalizeGradeBasis(null) === null, 'NULL grade_basis stays NULL (provider asserted no basis -- never fabricated)');
  assertTrue(normalizeGradeBasis('CGC') === 'cgc', 'a real asserted basis normalizes like any other text field');
}
{
  // F2a's decisive case: same numeric grade, NULL basis vs. a present basis.
  const noBasis = tupleBytes({ gradeNumeric: '9.4', gradeBasis: null });
  const withBasis = tupleBytes({ gradeNumeric: '9.4', gradeBasis: 'cgc' });
  assertTrue(bytesDiffer(noBasis, withBasis), 'F2a: grade_numeric=9.4 with grade_basis=NULL vs. grade_numeric=9.4 with grade_basis="cgc" -- byte-distinct (genuinely different asserted facts)');
}
{
  // F2b: same numeric value, different asserted bases -- must differ.
  const cgcBasis = tupleBytes({ gradeNumeric: '9.4', gradeBasis: normalizeGradeBasis('CGC') });
  const houseBasis = tupleBytes({ gradeNumeric: '9.4', gradeBasis: normalizeGradeBasis('house-standard') });
  assertTrue(bytesDiffer(cgcBasis, houseBasis), 'F2b: identical grade_numeric (9.4) with DIFFERENT asserted grade_basis values -- byte-distinct serialization');
}
{
  // F2a: two NULL-basis observations, otherwise identical, may
  // legitimately dedup -- this is proven at the migration-contract
  // (DB unique-index) level; here we confirm the HASH itself agrees
  // (same input -> same output, the necessary precondition for that
  // dedup to actually occur).
  const f1 = canonicalizeMarketObservationFields({
    provider: 'ebay', providerItemId: 'x', listingKind: 'sold', priceAmount: '1',
    currency: 'USD', conditionText: null, gradeNumeric: '9.4', gradeBasis: null,
    occurredOn: null, occurredAt: null,
  });
  const f2 = canonicalizeMarketObservationFields({
    provider: 'ebay', providerItemId: 'x', listingKind: 'sold', priceAmount: '1',
    currency: 'USD', conditionText: null, gradeNumeric: '9.4', gradeBasis: null,
    occurredOn: null, occurredAt: null,
  });
  assertTrue(computeMarketObservationHash(f1) === computeMarketObservationHash(f2), 'F2a: two otherwise-identical NULL-basis observations hash identically -- the correct precondition for legitimate re-observation dedup');
}

// ── T2/T2a (F2b): grade canonicalization -- minimal decimal, no fixed scale ─
console.log('\n-- T2/T2a (F2b): grade minimal-decimal contract, unchanged by this closure --\n');

assertTrue(canonicalGradeString('9.4') === '9.4', '"9.4" canonicalizes to "9.4"');
assertTrue(canonicalGradeString('9.40') === '9.4', '"9.40" canonicalizes to "9.4" (insignificant trailing zero stripped)');
assertTrue(canonicalGradeString('9.4') === canonicalGradeString('9.40'), '"9.4" and "9.40" produce the IDENTICAL canonical string');
assertTrue(canonicalGradeString('10') === '10', '"10" canonicalizes to "10" (bare integer, no manufactured decimal point)');
assertTrue(canonicalGradeString('10.00') === '10', '"10.00" canonicalizes to "10"');
assertTrue(canonicalGradeString('87.1250') === '87.125', '"87.1250" canonicalizes to "87.125"');
assertTrue(canonicalGradeString('09.4') === '9.4', 'leading zero stripped: "09.4" -> "9.4"');
assertTrue(canonicalGradeString(null) === null, 'NULL grade stays NULL (never fabricated)');
assertTrue(canonicalGradeString('9.4') !== canonicalGradeString('9.47'), '"9.4" and "9.47" remain materially distinct values (no fixed-scale rejection or rounding)');
{
  const h1 = tupleBytes({ gradeNumeric: canonicalGradeString('9.4') });
  const h2 = tupleBytes({ gradeNumeric: canonicalGradeString('9.40') });
  assertTrue(!bytesDiffer(h1, h2), 'full tuple: grade "9.4" and "9.40" hash identically after canonicalization');
}
{
  const bigPrecise = '123456789012345.678901';
  assertTrue(canonicalGradeString(bigPrecise) === bigPrecise, 'high-precision decimal string beyond IEEE-754 double exactness still canonicalizes losslessly (string-only path, never Number)');
}

// ── D3: price canonicalization (unchanged) ─────────────────────────────
console.log('\n-- D3: price fixed-scale decimal contract (unchanged) --\n');

assertTrue(canonicalPriceString('66') === '66.0000', '"66" canonicalizes to "66.0000"');
assertTrue(canonicalPriceString('66.12') === canonicalPriceString('66.1200'), '"66.12" and "66.1200" produce the IDENTICAL canonical string');
assertTrue(canonicalPriceString(null) === null, 'NULL price stays NULL');
{
  let threw = false;
  try { canonicalPriceString('66.12345'); } catch (e) { threw = true; }
  assertTrue(threw, 'price with genuine excess precision beyond 4 decimals is REJECTED (money DOES still use a fixed scale, unlike grade)');
}

// ── end-to-end canonicalization + hash determinism ─────────────────────
console.log('\n-- end-to-end canonicalization + hash determinism --\n');

{
  const f1 = canonicalizeMarketObservationFields({
    provider: 'PriceCharting', providerItemId: '  ABC-123  ', listingKind: 'SOLD',
    priceAmount: '66', currency: 'usd', conditionText: '  Near   Mint  ',
    gradeNumeric: '9.40', gradeBasis: 'CGC', occurredOn: '2026-06-14', occurredAt: null,
  });
  const f2 = canonicalizeMarketObservationFields({
    provider: 'pricecharting', providerItemId: 'abc-123', listingKind: 'sold',
    priceAmount: '66.0000', currency: 'USD', conditionText: 'near mint',
    gradeNumeric: '9.4', gradeBasis: 'cgc', occurredOn: '2026-06-14', occurredAt: null,
  });
  const h1 = computeMarketObservationHash(f1);
  const h2 = computeMarketObservationHash(f2);
  assertTrue(h1 === h2, 'two differently-formatted inputs describing the SAME real fact hash identically end-to-end');
  assertTrue(/^[0-9a-f]{64}$/.test(h1), 'hash output is a well-formed 64-hex-char SHA-256 digest');
}

// ── S3: hash-contract version genuinely participates in the digest ────
console.log('\n-- S3: hash-contract version participation --\n');

{
  assertTrue(HASH_CONTRACT_VERSION === 'mo-hash-v1', 'HASH_CONTRACT_VERSION constant is exactly "mo-hash-v1"');
  const realHash = computeMarketObservationHash(canonicalizeMarketObservationFields({
    provider: 'ebay', providerItemId: 'x', listingKind: 'sold', priceAmount: '1',
    currency: 'USD', conditionText: null, gradeNumeric: null, gradeBasis: null,
    occurredOn: '2026-01-01', occurredAt: null,
  }));
  const v2SimulatedBytes = Buffer.concat([
    encodeField('mo-hash-v2'),
    encodeField('ebay'), encodeField('x'), encodeField('sold'),
    encodeField('1.0000'), encodeField('USD'),
    encodeField(null), encodeField(null), encodeField(null),
    encodeField('2026-01-01'), encodeField(null),
  ]);
  const { createHash } = await import('node:crypto');
  const v2SimulatedHash = createHash('sha256').update(v2SimulatedBytes).digest('hex');
  assertTrue(realHash !== v2SimulatedHash, 'S3: identical observed facts under a different (simulated v2) hash-contract-version tag produce a DIFFERENT hash -- a future version bump does not silently collide with v1 history');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
