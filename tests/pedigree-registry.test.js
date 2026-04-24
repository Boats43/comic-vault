// Unit tests for Ship #18 — pedigree registry helper.
//
// Covers PEDIGREE_REGISTRY shape integrity + lookupPedigree() behavior.
// Strict match policy (Q3 Option A): exact canonical OR exact alias
// (case-insensitive after trim). No fuzzy matching.
//
// Invoke: node tests/pedigree-registry.test.js
// Exit: 0 all-pass, 1 any failure.

import {
  PEDIGREE_REGISTRY,
  lookupPedigree,
} from '../src/lib/pedigreeRegistry.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertRecognized = (result, expectedCanonical, label) => {
  if (
    result &&
    result.recognized === true &&
    result.canonical === expectedCanonical
  ) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected canonical: ${expectedCanonical}\n    actual: ${JSON.stringify(result)}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertUnrecognized = (result, label) => {
  if (
    result &&
    result.recognized === false &&
    result.canonical === null &&
    result.era === null
  ) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: { recognized:false, canonical:null, era:null }\n    actual: ${JSON.stringify(result)}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #18 — PEDIGREE REGISTRY ===\n');

// ─── Schema sanity ──────────────────────────────────────────────────
console.log('Schema sanity:');
assertEq(typeof lookupPedigree, 'function', 'lookupPedigree exported');
assertEq(Array.isArray(PEDIGREE_REGISTRY), true, 'PEDIGREE_REGISTRY is array');
assertEq(
  PEDIGREE_REGISTRY.length >= 22,
  true,
  `PEDIGREE_REGISTRY has ≥22 entries (got ${PEDIGREE_REGISTRY.length})`
);

// All entries have required fields.
const allHaveCanonical = PEDIGREE_REGISTRY.every((e) => typeof e.canonical === 'string' && e.canonical.length > 0);
const allHaveAliases = PEDIGREE_REGISTRY.every((e) => Array.isArray(e.aliases));
const allHaveEra = PEDIGREE_REGISTRY.every((e) => e.era === 'golden' || e.era === 'silver');
assertEq(allHaveCanonical, true, 'every entry has non-empty canonical string');
assertEq(allHaveAliases, true, 'every entry has aliases array');
assertEq(allHaveEra, true, 'every entry has era ∈ {golden, silver}');

// Canonicals must be unique (registry integrity — duplicate canonicals
// would cause lookup ambiguity).
const canonicalSet = new Set(PEDIGREE_REGISTRY.map((e) => e.canonical.toLowerCase()));
assertEq(
  canonicalSet.size,
  PEDIGREE_REGISTRY.length,
  'all canonicals are unique (case-insensitive)'
);

// ─── Canonical exact match ──────────────────────────────────────────
console.log('\nCanonical exact match:');
assertRecognized(
  lookupPedigree('Mile High Collection'),
  'Mile High Collection',
  '"Mile High Collection" → recognized'
);
assertRecognized(
  lookupPedigree('Pacific Coast'),
  'Pacific Coast',
  '"Pacific Coast" → recognized'
);
assertRecognized(
  lookupPedigree('Promise Collection'),
  'Promise Collection',
  '"Promise Collection" → recognized'
);

// ─── Alias matches ──────────────────────────────────────────────────
console.log('\nAlias matches:');
assertRecognized(
  lookupPedigree('Edgar Church'),
  'Mile High Collection',
  '"Edgar Church" alias → Mile High Collection'
);
assertRecognized(
  lookupPedigree('mile high'),
  'Mile High Collection',
  '"mile high" alias (lowercase) → Mile High Collection'
);
assertRecognized(
  lookupPedigree('church'),
  'Mile High Collection',
  '"church" short alias → Mile High Collection'
);
assertRecognized(
  lookupPedigree('promise'),
  'Promise Collection',
  '"promise" short alias → Promise Collection'
);

// ─── Special characters in alias ────────────────────────────────────
console.log('\nSpecial characters:');
assertRecognized(
  lookupPedigree('D Copy'),
  'Davis Crippen',
  '"D Copy" → Davis Crippen'
);
assertRecognized(
  lookupPedigree('"D" Copy'),
  'Davis Crippen',
  '\'"D" Copy\' (with quotes) → Davis Crippen'
);
assertRecognized(
  lookupPedigree('Davis Crippen'),
  'Davis Crippen',
  'canonical "Davis Crippen" → recognized'
);

// ─── Case-insensitivity ─────────────────────────────────────────────
console.log('\nCase-insensitivity:');
assertRecognized(
  lookupPedigree('MILE HIGH COLLECTION'),
  'Mile High Collection',
  'all-uppercase canonical → recognized'
);
assertRecognized(
  lookupPedigree('mile high collection'),
  'Mile High Collection',
  'all-lowercase canonical → recognized'
);
assertRecognized(
  lookupPedigree('PaCiFiC CoAsT'),
  'Pacific Coast',
  'mixed-case canonical → recognized'
);
assertRecognized(
  lookupPedigree('EDGAR CHURCH'),
  'Mile High Collection',
  'all-uppercase alias → recognized canonical'
);

// ─── Whitespace tolerance ───────────────────────────────────────────
console.log('\nWhitespace tolerance:');
assertRecognized(
  lookupPedigree('  Mile High  '),
  'Mile High Collection',
  'leading/trailing whitespace trimmed'
);
assertRecognized(
  lookupPedigree('\tedgar church\n'),
  'Mile High Collection',
  'tab/newline whitespace trimmed'
);

// ─── Unrecognized inputs ────────────────────────────────────────────
console.log('\nUnrecognized inputs:');
assertUnrecognized(
  lookupPedigree("Bob's Comic Shop"),
  'random retailer name → unrecognized'
);
assertUnrecognized(
  lookupPedigree('Mohawk Collection'),
  'real-but-not-listed pedigree → unrecognized'
);
assertUnrecognized(
  lookupPedigree('Mile Hi'),
  'partial / mistyped (Mile Hi vs Mile High) → unrecognized (strict, no fuzzy)'
);

// ─── Null/undefined/empty handling ──────────────────────────────────
console.log('\nNull/undefined/empty handling:');
assertUnrecognized(lookupPedigree(null), 'null → unrecognized');
assertUnrecognized(lookupPedigree(undefined), 'undefined → unrecognized');
assertUnrecognized(lookupPedigree(''), 'empty string → unrecognized');
assertUnrecognized(lookupPedigree('   '), 'whitespace-only string → unrecognized');

// Non-string types — never throw, always return graceful unrecognized.
assertUnrecognized(lookupPedigree(42), 'number → unrecognized');
assertUnrecognized(lookupPedigree({}), 'object → unrecognized');
assertUnrecognized(lookupPedigree([]), 'array → unrecognized');

// ─── Era field present on returns ───────────────────────────────────
console.log('\nEra field on recognized returns:');
const mh = lookupPedigree('Mile High');
assertEq(mh.era, 'golden', 'Mile High → era=golden');
const wm = lookupPedigree('White Mountain');
assertEq(wm.era, 'silver', 'White Mountain → era=silver');
const al = lookupPedigree('Allentown');
assertEq(al.era, 'golden', 'Allentown → era=golden');

// ─── Sample of all 22 entries — round-trip canonical → recognized ───
console.log('\nAll registry entries roundtrip canonical:');
for (const entry of PEDIGREE_REGISTRY) {
  const result = lookupPedigree(entry.canonical);
  if (result.recognized && result.canonical === entry.canonical) {
    passed++;
  } else {
    failed++;
    const msg = `  ✗ canonical "${entry.canonical}" not roundtripping`;
    failures.push(msg);
    console.log(msg);
  }
}
console.log(`  ✓ all ${PEDIGREE_REGISTRY.length} canonicals roundtrip correctly`);

// ─── Return shape consistency ───────────────────────────────────────
console.log('\nReturn shape:');
const recShape = lookupPedigree('Mile High');
assertEq(typeof recShape, 'object', 'recognized return is object');
assertEq(typeof recShape.recognized, 'boolean', 'has recognized:bool');
assertEq(typeof recShape.canonical, 'string', 'recognized: canonical is string');
assertEq(typeof recShape.era, 'string', 'recognized: era is string');

const unrecShape = lookupPedigree('not a pedigree');
assertEq(typeof unrecShape, 'object', 'unrecognized return is object (never null)');
assertEq(unrecShape.recognized, false, 'unrecognized.recognized=false');
assertEq(unrecShape.canonical, null, 'unrecognized.canonical=null');
assertEq(unrecShape.era, null, 'unrecognized.era=null');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
