// tests/operator-action-alignment-unit.test.js
//
// OperatorAction — pure-logic proof of src/lib/operatorActionAlignment.js.
// No database. Every (recommendation, actionCode) combination the real
// system can produce is exercised explicitly — this IS the documented
// FOLLOWED/OVERRIDDEN/NOT_COMPARABLE mapping rule, made executable.
//
// Invoke: node tests/operator-action-alignment-unit.test.js

import { deriveActionAlignment, ALIGNMENT } from '../src/lib/operatorActionAlignment.js';

let passed = 0, failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label} (expected ${expected}, got ${actual})`; failures.push(m); console.log(m); }
};

console.log('\n=== OperatorAction alignment (FOLLOWED/OVERRIDDEN/NOT_COMPARABLE) — deterministic proof ===\n');

console.log('-- FOLLOWED: the one correct action per recommendation --\n');
assertEq(deriveActionAlignment('LIST_NOW', 'LIST'), ALIGNMENT.FOLLOWED, 'LIST_NOW + LIST -> FOLLOWED');
assertEq(deriveActionAlignment('LIST_LOW', 'LIST'), ALIGNMENT.FOLLOWED, 'LIST_LOW + LIST -> FOLLOWED (Chain #2\'s own recommendation)');
assertEq(deriveActionAlignment('RESEARCH', 'HOLD'), ALIGNMENT.FOLLOWED, 'RESEARCH + HOLD -> FOLLOWED');
assertEq(deriveActionAlignment('GRADE_CANDIDATE', 'HOLD'), ALIGNMENT.FOLLOWED, 'GRADE_CANDIDATE + HOLD -> FOLLOWED');
assertEq(deriveActionAlignment('DO_NOT_LIST', 'PASS'), ALIGNMENT.FOLLOWED, 'DO_NOT_LIST + PASS -> FOLLOWED');

console.log('\n-- OVERRIDDEN: every other real action for a comparable recommendation --\n');
assertEq(deriveActionAlignment('LIST_LOW', 'HOLD'), ALIGNMENT.OVERRIDDEN, 'LIST_LOW + HOLD -> OVERRIDDEN');
assertEq(deriveActionAlignment('LIST_LOW', 'PASS'), ALIGNMENT.OVERRIDDEN, 'LIST_LOW + PASS -> OVERRIDDEN');
assertEq(deriveActionAlignment('LIST_NOW', 'PASS'), ALIGNMENT.OVERRIDDEN, 'LIST_NOW + PASS -> OVERRIDDEN');
assertEq(deriveActionAlignment('RESEARCH', 'LIST'), ALIGNMENT.OVERRIDDEN, 'RESEARCH + LIST -> OVERRIDDEN');
assertEq(deriveActionAlignment('RESEARCH', 'PASS'), ALIGNMENT.OVERRIDDEN, 'RESEARCH + PASS -> OVERRIDDEN');
assertEq(deriveActionAlignment('GRADE_CANDIDATE', 'LIST'), ALIGNMENT.OVERRIDDEN, 'GRADE_CANDIDATE + LIST -> OVERRIDDEN');
assertEq(deriveActionAlignment('DO_NOT_LIST', 'LIST'), ALIGNMENT.OVERRIDDEN, 'DO_NOT_LIST + LIST -> OVERRIDDEN');
assertEq(deriveActionAlignment('DO_NOT_LIST', 'HOLD'), ALIGNMENT.OVERRIDDEN, 'DO_NOT_LIST + HOLD -> OVERRIDDEN');

console.log('\n-- NOT_COMPARABLE: no actionable recommendation was ever given, fail-safe on unknowns --\n');
assertEq(deriveActionAlignment('ID_REQUIRED', 'LIST'), ALIGNMENT.NOT_COMPARABLE, 'ID_REQUIRED + LIST -> NOT_COMPARABLE (regardless of action)');
assertEq(deriveActionAlignment('ID_REQUIRED', 'HOLD'), ALIGNMENT.NOT_COMPARABLE, 'ID_REQUIRED + HOLD -> NOT_COMPARABLE');
assertEq(deriveActionAlignment('ID_REQUIRED', 'PASS'), ALIGNMENT.NOT_COMPARABLE, 'ID_REQUIRED + PASS -> NOT_COMPARABLE');
assertEq(deriveActionAlignment('SOME_FUTURE_RECOMMENDATION', 'LIST'), ALIGNMENT.NOT_COMPARABLE, 'an unrecognized recommendation value -> NOT_COMPARABLE, never a guessed alignment');
assertEq(deriveActionAlignment(null, 'LIST'), ALIGNMENT.NOT_COMPARABLE, 'null recommendation -> NOT_COMPARABLE, never throws');
assertEq(deriveActionAlignment('LIST_LOW', 'SOME_FUTURE_ACTION'), ALIGNMENT.OVERRIDDEN, 'an unrecognized action against a comparable recommendation is OVERRIDDEN, not a crash');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
