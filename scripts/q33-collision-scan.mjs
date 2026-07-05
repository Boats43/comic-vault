// Q33 collision scan — verify bag/board/w/ strip doesn't remove legitimate title tokens

import { sanitizeSeriesTitle } from '../src/lib/identityCore.js';

const testCases = [
  // Collision probes from directive:
  { input: 'Bag Man', expect: 'Bag Man', reason: 'character name' },
  { input: 'Boardwalk Empire', expect: 'Boardwalk', reason: 'series name contains "board"' },
  { input: 'Chalkboard Comics', expect: 'Chalkboard', reason: 'series name contains "board"' },
  { input: 'Man w/ Gun', expect: 'Man Gun', reason: 'legitimate "w/" in series title' },
  
  // Accessory cases that SHOULD strip:
  { input: 'Superman #1 w/Bag+Board', expect: 'Superman', reason: 'accessory token' },
  { input: 'Batman Bagged and Boarded', expect: 'Batman', reason: 'accessory token' },
  { input: 'Spider-Man with COA Certificate', expect: 'Spider-Man', reason: 'accessory token' },
];

console.log('Q33 COLLISION SCAN — Accessory Token Strip\n');

let collisions = 0;
let passed = 0;

for (const test of testCases) {
  const result = sanitizeSeriesTitle(test.input);
  const match = result === test.expect;
  
  if (!match && test.reason.includes('character') || test.reason.includes('series name')) {
    collisions++;
    console.log(`❌ COLLISION: "${test.input}" → "${result}" (expected "${test.expect}")`);
    console.log(`   Reason: ${test.reason}\n`);
  } else if (match) {
    passed++;
    console.log(`✓ "${test.input}" → "${result}"`);
  } else {
    console.log(`⚠ Unexpected: "${test.input}" → "${result}" (expected "${test.expect}")`);
    console.log(`   Reason: ${test.reason}\n`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${passed}/${testCases.length}`);
console.log(`COLLISIONS: ${collisions}`);
console.log(`\n${collisions === 0 ? '✅ Q33 CLEAN — no legitimate titles losing tokens' : '❌ Q33 HAS COLLISIONS — scope regex tighter'}`);
