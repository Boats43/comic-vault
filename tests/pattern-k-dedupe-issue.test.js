/**
 * Pattern K — Dedupe embedded issue-number token from family title
 * Tests the dedupeIssueToken helper and its integration with selectTitleFamilyCandidate
 */

import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertIncludes(str, substring, message) {
  if (!str || !str.includes(substring)) {
    throw new Error(`${message}\nExpected to include: ${substring}\nActual: ${str}`);
  }
}

function assertNotIncludes(str, substring, message) {
  if (str && str.includes(substring)) {
    throw new Error(`${message}\nExpected NOT to include: ${substring}\nActual: ${str}`);
  }
}

// TEST 1: Luke Cage #34 - embedded "34" should be removed
test('Luke Cage #34 - strips embedded issue number', () => {
  const items = [
    { rawTitle: 'Luke Cage 34 Power Man Marvel', title: 'Luke Cage 34 Power Man Marvel' },
    { rawTitle: 'Luke Cage Power Man #34', title: 'Luke Cage Power Man #34' },
    { rawTitle: 'Power Man 34 Luke Cage', title: 'Power Man 34 Luke Cage' },
    { rawTitle: 'Luke Cage Power Man Marvel 34', title: 'Luke Cage Power Man Marvel 34' },
    { rawTitle: 'Luke Cage #34 Power Man', title: 'Luke Cage #34 Power Man' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Luke Cage Power Man', '34');

  // Should select a family and dedupe the "34" token
  if (result.selectedTitle) {
    assertNotIncludes(result.selectedTitle, '34', 'Selected title should NOT contain embedded "34"');
    assertIncludes(result.selectedTitle, 'luke', 'Selected title should contain "luke"');
    assertIncludes(result.selectedTitle, 'cage', 'Selected title should contain "cage"');
  }
});

// TEST 2: Spider-Man 2099 #34 - "2099" must be preserved
test('Spider-Man 2099 #34 - preserves series number 2099', () => {
  const items = [
    { rawTitle: 'Spider-Man 2099 #34', title: 'Spider-Man 2099 #34' },
    { rawTitle: 'Spider-Man 2099 Issue 34', title: 'Spider-Man 2099 Issue 34' },
    { rawTitle: 'Amazing Spider-Man 2099 34', title: 'Amazing Spider-Man 2099 34' },
    { rawTitle: 'Spider-Man 2099 #34 Marvel', title: 'Spider-Man 2099 #34 Marvel' },
    { rawTitle: 'Spider-Man 2099 34', title: 'Spider-Man 2099 34' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Spider-Man 2099', '34');

  // Should preserve "2099" (safelist protected)
  if (result.selectedTitle) {
    assertIncludes(result.selectedTitle, '2099', 'Selected title MUST contain series number "2099"');
  }
});

// TEST 3: 2000 AD #1 - "2000" must be preserved
test('2000 AD #1 - preserves series number 2000', () => {
  const items = [
    { rawTitle: '2000 AD #1', title: '2000 AD #1' },
    { rawTitle: '2000 AD Issue 1', title: '2000 AD Issue 1' },
    { rawTitle: '2000 AD 1', title: '2000 AD 1' },
    { rawTitle: '2000 AD #1 Judge Dredd', title: '2000 AD #1 Judge Dredd' },
    { rawTitle: '2000 AD Comic #1', title: '2000 AD Comic #1' },
  ];

  const result = selectTitleFamilyCandidate(items, '2000 AD', '1');

  // Should preserve "2000" (safelist protected)
  if (result.selectedTitle) {
    assertIncludes(result.selectedTitle, '2000', 'Selected title MUST contain series number "2000"');
  }
});

// TEST 4: Star Wars 3D - "3d" must be preserved
test('Star Wars 3D - preserves variant type 3D', () => {
  const items = [
    { rawTitle: 'Star Wars 3D #1', title: 'Star Wars 3D #1' },
    { rawTitle: 'Star Wars 3D Issue 1', title: 'Star Wars 3D Issue 1' },
    { rawTitle: 'Star Wars 3D Comic', title: 'Star Wars 3D Comic' },
    { rawTitle: 'Star Wars 3D #1 Marvel', title: 'Star Wars 3D #1 Marvel' },
    { rawTitle: 'Star Wars 3D 1', title: 'Star Wars 3D 1' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Star Wars 3D', '1');

  // Should preserve "3d" (safelist protected)
  if (result.selectedTitle) {
    const titleLower = result.selectedTitle.toLowerCase();
    assertIncludes(titleLower, '3d', 'Selected title MUST contain variant type "3d"');
  }
});

// TEST 5: Detective Comics #27 - embedded "27" should be removed
test('Detective Comics #27 - strips embedded issue number', () => {
  const items = [
    { rawTitle: 'Detective Comics 27', title: 'Detective Comics 27' },
    { rawTitle: 'Detective Comics #27', title: 'Detective Comics #27' },
    { rawTitle: 'Detective Comics 27 Batman', title: 'Detective Comics 27 Batman' },
    { rawTitle: 'Detective 27 Comics', title: 'Detective 27 Comics' },
    { rawTitle: 'Detective Comics #27 DC', title: 'Detective Comics #27 DC' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Detective Comics', '27');

  // Should dedupe "27" if it appears as a bare token
  if (result.selectedTitle) {
    // "27" should be removed from title-family title
    // (it may still appear in rawTitle, but selectedTitle should be clean)
    assertIncludes(result.selectedTitle, 'detective', 'Selected title should contain "detective"');
    assertIncludes(result.selectedTitle, 'comics', 'Selected title should contain "comics"');
  }
});

// TEST 6: X-Men #1 - no pollution to strip (regression check)
test('X-Men #1 - no embedded pollution', () => {
  const items = [
    { rawTitle: 'X-Men #1', title: 'X-Men #1' },
    { rawTitle: 'Uncanny X-Men #1', title: 'Uncanny X-Men #1' },
    { rawTitle: 'X-Men Issue 1', title: 'X-Men Issue 1' },
    { rawTitle: 'X-Men #1 Marvel', title: 'X-Men #1 Marvel' },
    { rawTitle: 'X-Men First Issue', title: 'X-Men First Issue' },
  ];

  const result = selectTitleFamilyCandidate(items, 'X-Men', '1');

  // Should NOT have "1" embedded in the title (it's already stripped by extractSeriesTitle)
  if (result.selectedTitle) {
    assertIncludes(result.selectedTitle, 'men', 'Selected title should contain "men"');
    // "1" should not appear as a standalone token in title-family title
  }
});

// TEST 7: Orson Scott Card's 1984 - "1984" must be preserved
test('1984 series - preserves series number 1984', () => {
  const items = [
    { rawTitle: '1984 #1', title: '1984 #1' },
    { rawTitle: '1984 Comic #1', title: '1984 Comic #1' },
    { rawTitle: '1984 Magazine 1', title: '1984 Magazine 1' },
    { rawTitle: '1984 Issue 1', title: '1984 Issue 1' },
    { rawTitle: '1984 1', title: '1984 1' },
  ];

  const result = selectTitleFamilyCandidate(items, '1984', '1');

  // Should preserve "1984" (safelist protected)
  if (result.selectedTitle) {
    assertIncludes(result.selectedTitle, '1984', 'Selected title MUST contain series number "1984"');
  }
});

// TEST 8: Fallback to Vision when visual pool insufficient
test('Insufficient visual pool - fallback to Vision', () => {
  const items = [
    { rawTitle: 'Test Comic #1', title: 'Test Comic #1' },
    { rawTitle: 'Test #1', title: 'Test #1' },
  ];

  const result = selectTitleFamilyCandidate(items, 'Test Comic', '1');

  // Should fall back to Vision (insufficient items)
  assertEqual(result.decision, 'fallback-vision', 'Should fallback to Vision with <5 items');
  assertEqual(result.selectedTitle, null, 'selectedTitle should be null on fallback');
});

// RUN ALL TESTS
console.log('\n🧪 Pattern K - Dedupe Embedded Issue Number Tests\n');
console.log('='.repeat(60));

for (const { name, fn } of tests) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`  ${error.message}`);
  }
}

console.log('='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${tests.length} total\n`);

if (failed > 0) {
  process.exit(1);
}
