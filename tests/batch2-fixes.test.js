/**
 * BATCH 2 REGRESSION TESTS
 *
 * Q24 — Publisher-name stripped from compound character titles
 * Q26 — Dual-issue-number conflict (foreign/reprint editions)
 */

import { sanitizeSeriesTitle, detectDualIssueConflict, resolveIssue } from '../src/lib/identityCore.js';

const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };

console.log('\n=== Q24 — Publisher-name compound-title whitelist ===');

// Before Q24: "Captain Marvel" → "Captain" (Marvel stripped as publisher noise)
// After Q24: whitelist guard preserves "Marvel" when part of character name

const captainMarvel = sanitizeSeriesTitle("Captain Marvel Classic 1970");
assert(captainMarvel.toLowerCase().includes('captain marvel') || captainMarvel.toLowerCase().includes('captainmarvel'),
  `Q24: Captain Marvel preserved (got: "${captainMarvel}")`);
console.log('✓ Q24: Captain Marvel →', captainMarvel);

const msMarvel = sanitizeSeriesTitle("Ms. Marvel Issue #1 2014");
assert(msMarvel.toLowerCase().includes('ms') && msMarvel.toLowerCase().includes('marvel'),
  `Q24: Ms. Marvel preserved (got: "${msMarvel}")`);
console.log('✓ Q24: Ms. Marvel →', msMarvel);

const marvelTeamUp = sanitizeSeriesTitle("Marvel Team-Up Spider-Man 1972");
assert(marvelTeamUp.toLowerCase().includes('marvel') && marvelTeamUp.toLowerCase().includes('team'),
  `Q24: Marvel Team-Up preserved (got: "${marvelTeamUp}")`);
console.log('✓ Q24: Marvel Team-Up →', marvelTeamUp);

const detectiveComics = sanitizeSeriesTitle("Detective Comics Batman #27 1939");
assert(detectiveComics.toLowerCase().includes('detective') && detectiveComics.toLowerCase().includes('comics'),
  `Q24: Detective Comics preserved (got: "${detectiveComics}")`);
console.log('✓ Q24: Detective Comics →', detectiveComics);

// Non-compound titles should still strip publisher noise
const batman = sanitizeSeriesTitle("Batman DC Comics #222 1970");
assert(!batman.toLowerCase().includes(' dc ') && !batman.toLowerCase().includes('comics'),
  `Q24: Batman strips DC Comics (got: "${batman}")`);
assert(batman.toLowerCase().includes('batman'), 'Q24: Batman title preserved');
console.log('✓ Q24: Batman (non-compound) →', batman);

console.log('\n=== Q26 — Dual-issue-number conflict detection ===');

// Before Q26: "Daredevil #103 #97" silently picks one (wrong choice possible)
// After Q26: flag conflict, return candidates for manual resolution

const conflict1 = detectDualIssueConflict("Daredevil #103 Foreign Edition US #97");
assert(conflict1.hasConflict === true, 'Q26: dual-issue detected');
assert(conflict1.issues.length === 2, 'Q26: 2 distinct issues found');
assert(conflict1.issues.includes('103'), 'Q26: #103 detected');
assert(conflict1.issues.includes('97'), 'Q26: #97 detected');
console.log('✓ Q26: Daredevil #103/#97 →', conflict1);

const conflict2 = detectDualIssueConflict("Absolute Batman #4 + #1 Variant");
assert(conflict2.hasConflict === true, 'Q26: compound variant detected');
assert(conflict2.issues.includes('4'), 'Q26: #4 detected');
assert(conflict2.issues.includes('1'), 'Q26: #1 detected');
console.log('✓ Q26: Absolute Batman #4 + #1 →', conflict2);

// Single issue — no conflict
const noConflict = detectDualIssueConflict("Amazing Spider-Man #129 VF/NM");
assert(noConflict.hasConflict === false, 'Q26: single issue no conflict');
assert(noConflict.issues.length === 1, 'Q26: 1 issue found');
assert(noConflict.issues[0] === '129', 'Q26: #129 detected');
console.log('✓ Q26: single issue #129 →', noConflict);

// resolveIssue with conflict flag
const resolved = resolveIssue('103', null, null, "Daredevil #103 Foreign Edition US #97");
assert(resolved.conflict === true, 'Q26: resolveIssue flags conflict');
assert(Array.isArray(resolved.candidates), 'Q26: returns candidates array');
assert(resolved.candidates.length === 2, 'Q26: 2 candidates returned');
console.log('✓ Q26: resolveIssue conflict →', resolved);

// No conflict — normal resolution
const normalResolve = resolveIssue('181', '181', null, "Hulk #181 VF");
assert(normalResolve === '181', 'Q26: normal resolve returns issue string');
console.log('✓ Q26: normal resolve #181 →', normalResolve);

console.log('\n=== BATCH 2 COMPLETE ===');
console.log('Q24: 5/5 compound-title tests passed');
console.log('Q26: 6/6 dual-issue conflict tests passed');
console.log('Total: 11/11 PASSED ✓');
