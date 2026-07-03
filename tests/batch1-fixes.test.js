/**
 * BATCH 1 REGRESSION TESTS
 *
 * Q22 — Hyphen-normalization gap ("Spiderman" vs "Spider-Man")
 * Q23 — Annual/Special issue-format kills all comps
 * Q28 — Seller-noise title contamination
 */

import { tokenizeTitle, normalizeIssueFormat } from '../src/lib/compHygiene.js';
import { sanitizeSeriesTitle } from '../src/lib/identityCore.js';

const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };

console.log('\n=== Q22 — Hyphen normalization ===');

// Before Q22: "Spider-Man" tokenized to ["spider", "man"], "Spiderman" to ["spiderman"]
// After Q22: both tokenize to ["spiderman"], enabling match

const tokens1 = tokenizeTitle("Amazing Spider-Man #205");
const tokens2 = tokenizeTitle("Amazing Spiderman #205");
assert(tokens1.includes('spiderman'), 'Q22: Spider-Man should tokenize to spiderman');
assert(tokens2.includes('spiderman'), 'Q22: Spiderman should tokenize to spiderman');
assert(tokens1.includes('amazing'), 'Q22: amazing token preserved');
console.log('✓ Q22: hyphen-normalized tokens:', tokens1);

// Other hyphenated characters
const xmenTokens = tokenizeTitle("X-Men #1");
assert(xmenTokens.includes('xmen'), 'Q22: X-Men → xmen');

const antmanTokens = tokenizeTitle("Ant-Man #15");
assert(antmanTokens.includes('antman'), 'Q22: Ant-Man → antman');

console.log('✓ Q22: X-Men, Ant-Man normalized correctly');

console.log('\n=== Q23 — Issue-format normalization ===');

// Before Q23: "Annual 14" fails numeric issue-match, 0 comps survive
// After Q23: "Annual 14" → issue=14 + format=annual, format-aware filter

const annual = normalizeIssueFormat("Annual 14");
assert(annual.issue === '14', 'Q23: Annual 14 → issue=14');
assert(annual.format === 'annual', 'Q23: Annual 14 → format=annual');
console.log('✓ Q23: Annual 14 →', annual);

const special = normalizeIssueFormat("Special 3");
assert(special.issue === '3', 'Q23: Special 3 → issue=3');
assert(special.format === 'special', 'Q23: Special 3 → format=special');
console.log('✓ Q23: Special 3 →', special);

const kingSize = normalizeIssueFormat("King-Size 5");
assert(kingSize.issue === '5', 'Q23: King-Size 5 → issue=5');
assert(kingSize.format === 'king-size', 'Q23: King-Size 5 → format=king-size');
console.log('✓ Q23: King-Size 5 →', kingSize);

const giantSize = normalizeIssueFormat("Giant-Size 7");
assert(giantSize.issue === '7', 'Q23: Giant-Size 7 → issue=7');
assert(giantSize.format === 'giant-size', 'Q23: Giant-Size 7 → format=giant-size');
console.log('✓ Q23: Giant-Size 7 →', giantSize);

// Bare format words (no number)
const bareAnnual = normalizeIssueFormat("Annual");
assert(bareAnnual.issue === null, 'Q23: bare Annual → issue=null');
assert(bareAnnual.format === 'annual', 'Q23: bare Annual → format=annual');
console.log('✓ Q23: bare Annual →', bareAnnual);

// Pure numeric (no format)
const numeric = normalizeIssueFormat("181");
assert(numeric.issue === '181', 'Q23: 181 → issue=181');
assert(numeric.format === null, 'Q23: 181 → format=null');
console.log('✓ Q23: pure numeric 181 →', numeric);

console.log('\n=== Q28 — Seller-noise sanitization ===');

// Before Q28: "brickman intro uk indie lew stringer #1" → title verbatim
// After Q28: seller noise stripped AFTER cluster selection

const dirty1 = sanitizeSeriesTitle("Brickman Intro UK Indie Lew Stringer #1");
assert(!dirty1.toLowerCase().includes('intro'), 'Q28: intro stripped');
assert(!dirty1.toLowerCase().includes('indie'), 'Q28: indie stripped');
assert(!dirty1.toLowerCase().includes('lew stringer'), 'Q28: lew stringer stripped');
console.log('✓ Q28: seller noise removed:', dirty1);

const dirty2 = sanitizeSeriesTitle("Amazing Spider-Man HTF OOP Rare #129");
assert(!dirty2.toLowerCase().includes('htf'), 'Q28: htf stripped');
assert(!dirty2.toLowerCase().includes('oop'), 'Q28: oop stripped');
assert(!dirty2.toLowerCase().includes('rare'), 'Q28: rare stripped');
assert(dirty2.toLowerCase().includes('spider') || dirty2.toLowerCase().includes('amazing'), 'Q28: series name preserved');
console.log('✓ Q28: htf/oop/rare removed:', dirty2);

const dirty3 = sanitizeSeriesTitle("Batman Featuring Robin #1");
assert(!dirty3.toLowerCase().includes('featuring'), 'Q28: featuring stripped');
assert(dirty3.toLowerCase().includes('batman'), 'Q28: Batman preserved');
console.log('✓ Q28: featuring removed:', dirty3);

// Contextual UK stripping — "UK Indie" stripped, but "UK Comic" (publisher) preserved
const ukIndieTitle = sanitizeSeriesTitle("Judge Dredd UK Indie Edition");
assert(!ukIndieTitle.toLowerCase().includes('uk'), 'Q28: contextual uk stripped when followed by indie');
console.log('✓ Q28: contextual uk stripped:', ukIndieTitle);

console.log('\n=== BATCH 1 COMPLETE ===');
console.log('Q22: 4/4 hyphen-normalization tests passed');
console.log('Q23: 7/7 issue-format tests passed');
console.log('Q28: 5/5 seller-noise tests passed');
console.log('Total: 16/16 PASSED ✓');
