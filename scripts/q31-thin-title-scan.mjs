// Q31 Part 1 validation — prove adaptive 75% threshold rejects Groo: The Prophecy

import { tokenizeTitle, hasSufficientTitleOverlap } from '../src/lib/compHygiene.js';

// Test case: "Groo in the Wild" #1 (2023) vs "Groo: The Prophecy" #1 (2026)
const ourTitle = "Groo in the Wild";
const compTitle = "Groo: The Prophecy #1";

const ourTokens = tokenizeTitle(ourTitle);
console.log(`OUR TOKENS: [${ourTokens.join(', ')}]`);
console.log(`TOKEN COUNT: ${ourTokens.length}`);

// CURRENT behavior (50% threshold, always):
const currentPass = hasSufficientTitleOverlap(compTitle, ourTokens, 0.5);
console.log(`\nCURRENT (50% threshold): ${currentPass ? 'PASS ✗' : 'REJECT ✓'}`);

// PROPOSED behavior (75% threshold when ≤2 tokens):
const adaptiveThreshold = ourTokens.length <= 2 ? 0.75 : 0.5;
const proposedPass = hasSufficientTitleOverlap(compTitle, ourTokens, adaptiveThreshold);
console.log(`PROPOSED (${(adaptiveThreshold*100).toFixed(0)}% threshold, ≤2 tokens): ${proposedPass ? 'PASS ✗' : 'REJECT ✓'}`);

// Overlap calculation for clarity
const compTokens = tokenizeTitle(compTitle);
console.log(`\nCOMP TOKENS: [${compTokens.join(', ')}]`);
const matches = ourTokens.filter(t => compTokens.includes(t));
console.log(`OVERLAP: [${matches.join(', ')}] = ${matches.length}/${ourTokens.length} = ${(matches.length/ourTokens.length*100).toFixed(0)}%`);

console.log(`\n${proposedPass ? '❌ PART 1 FAILS — still admits wrong series' : '✅ PART 1 WORKS — rejects Groo: The Prophecy'}`);
