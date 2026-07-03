/**
 * Q21 — Digit-Transposition Detection
 * House of Secrets #120 vs #112 class
 */

import { detectDualIssueConflict, resolveIssue } from '../src/lib/identityCore.js';

const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };

console.log('\n=== Q21 — Digit-Transposition Conflict ===');

// 120 ↔ 112 (House of Secrets case)
// NOTE: 120 vs 112 is NOT a transposition (different digit sets: {0,1,2} vs {1,1,2})
// This is a dual-issue conflict, but not digit-swap. Likely marketing-copy or foreign edition.
const hos = detectDualIssueConflict("House of Secrets #120 VF #112");
assert(hos.hasConflict === true, 'Q21: 120/112 conflict detected');
assert(hos.transposition === false, 'Q21: 120/112 NOT transposition (different digits)');
assert(hos.issues.includes('120'), 'Q21: #120 detected');
assert(hos.issues.includes('112'), 'Q21: #112 detected');
console.log('✓ Q21: House of Secrets #120/#112 (NOT transposition) →', hos);

// 120 ↔ 102 (TRUE transposition: digits {0,1,2} in different order)
const t2 = detectDualIssueConflict("Comic #120 #102");
assert(t2.hasConflict === true, 'Q21: 120/102 conflict detected');
assert(t2.transposition === true, 'Q21: 120/102 flagged as transposition');
console.log('✓ Q21: #120/#102 transposition →', t2);

// 201 ↔ 102 (3-digit transposition)
const t3 = detectDualIssueConflict("Amazing Spider-Man #201 #102");
assert(t3.hasConflict === true, 'Q21: 201/102 conflict detected');
assert(t3.transposition === true, 'Q21: 201/102 flagged as transposition');
console.log('✓ Q21: #201/#102 transposition →', t3);

// NOT transposition — foreign/reprint (103 vs 97, different digits)
const notTrans = detectDualIssueConflict("Daredevil #103 Foreign Edition US #97");
assert(notTrans.hasConflict === true, 'Q21: 103/97 conflict detected');
assert(notTrans.transposition === false, 'Q21: 103/97 NOT transposition');
console.log('✓ Q21: #103/#97 NOT transposition →', notTrans);

// resolveIssue integration (TRUE transposition)
const resolved = resolveIssue('120', null, null, "Comic #120 #102");
assert(resolved.conflict === true, 'Q21: resolveIssue flags conflict');
assert(resolved.transposition === true, 'Q21: resolveIssue passes transposition flag');
assert(resolved.candidates.length === 2, 'Q21: both candidates returned');
console.log('✓ Q21: resolveIssue transposition →', resolved);

// House of Secrets case (NOT transposition, but still dual-issue conflict)
const hosResolved = resolveIssue('120', null, null, "House of Secrets #120 VF #112");
assert(hosResolved.conflict === true, 'Q21: HoS conflict detected');
assert(hosResolved.transposition === false, 'Q21: HoS NOT transposition');
console.log('✓ Q21: House of Secrets dual-issue (not transposition) →', hosResolved);

console.log('\n=== Q21 COMPLETE ===');
console.log('5/5 digit-transposition tests passed ✓');
