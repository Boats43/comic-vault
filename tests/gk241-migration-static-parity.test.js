// tests/gk241-migration-static-parity.test.js
//
// GK-241, R3b — a real parser reading the real migration file's own CHECK
// constraint text, compared as a set against src/lib/actionAuthority.js's
// MARKET_STANDING_VALUES export. No database connection of any kind —
// pure text/source parsing, runs like any other non-DB test in this repo
// (node tests/X.test.js). Deliberately does NOT hardcode a second copy
// of the expected value list to compare the migration against — the only
// "expected" side is the real, imported MARKET_STANDING_VALUES constant;
// the "actual" side is parsed fresh from the real migration file's own
// text on every run, so this test breaks the instant either one drifts
// from the other, exactly the class of bug GK-241 itself was.
//
// Invoke: node tests/gk241-migration-static-parity.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertEq = (actual, expected, label) => assertTrue(
  JSON.stringify(actual) === JSON.stringify(expected),
  `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
);

console.log('\n=== GK-241 R3b — migration/application vocabulary parity (static, no DB) ===\n');

const { MARKET_STANDING_VALUES } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'actionAuthority.js')).href);

const MIGRATION_PATH = path.join(repoRoot, 'db', 'data0', '0030_gk241_buyer_market_standing_check_widen.sql');
const migrationText = readFileSync(MIGRATION_PATH, 'utf8');

// Real parse of the real CHECK constraint's value list — not a second
// hand-maintained array. Matches the constraint's own
// `market_standing IN (\n    'A',\n    'B',\n    ...\n  )` block,
// tolerant of the actual multi-line/indented formatting the migration
// file uses, then extracts every single-quoted literal inside it.
const constraintBlockMatch = migrationText.match(
  /market_standing\s+IS\s+NULL\s+OR\s+market_standing\s+IN\s*\(([\s\S]*?)\)\s*\)\s*;/i
);
assertTrue(!!constraintBlockMatch, 'migration file contains a parseable "market_standing IS NULL OR market_standing IN (...)" CHECK clause');

const parsedValues = constraintBlockMatch
  ? Array.from(constraintBlockMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
  : [];

console.log(`  parsed from migration file: ${JSON.stringify(parsedValues)}`);
console.log(`  MARKET_STANDING_VALUES:     ${JSON.stringify(MARKET_STANDING_VALUES)}`);

assertTrue(parsedValues.length > 0, 'at least one value was actually parsed out of the migration file (parser sanity check)');

const parsedSet = new Set(parsedValues);
const constantSet = new Set(MARKET_STANDING_VALUES);

const missingFromMigration = MARKET_STANDING_VALUES.filter((v) => !parsedSet.has(v));
const extraInMigration = parsedValues.filter((v) => !constantSet.has(v));

assertEq(missingFromMigration, [], 'every value in MARKET_STANDING_VALUES is present in the migration\'s CHECK constraint');
assertEq(extraInMigration, [], 'the migration\'s CHECK constraint contains no value outside MARKET_STANDING_VALUES');
assertEq(parsedSet.size, constantSet.size, 'no duplicate values in the migration\'s own value list (set size matches array-turned-set size)');

// Same parity check against the rollback file's OLD (pre-widen) list,
// as a sanity/documentation cross-check — the rollback must target
// exactly the original 3-value set, not something that drifted since.
const ROLLBACK_PATH = path.join(repoRoot, 'db', 'data0', '0030_gk241_buyer_market_standing_check_widen_rollback.sql');
const rollbackText = readFileSync(ROLLBACK_PATH, 'utf8');
const rollbackBlockMatch = rollbackText.match(
  /market_standing\s+IS\s+NULL\s+OR\s+market_standing\s+IN\s*\(([\s\S]*?)\)\s*\)\s*;/i
);
const rollbackValues = rollbackBlockMatch
  ? Array.from(rollbackBlockMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
  : [];
assertEq(rollbackValues.sort(), ['EXACT_CURRENT', 'EXACT_STALE', 'SIMILAR_ONLY'].sort(), 'rollback file targets exactly the original pre-GK-241 3-value set');

console.log(`\n${'='.repeat(60)}`);
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
