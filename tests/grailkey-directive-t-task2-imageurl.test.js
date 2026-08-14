// tests/grailkey-directive-t-task2-imageurl.test.js
//
// GrailKey Directive T, Task 2 (GK-86) — extractIdentityFromImageSearch's
// parsed row shape never captured a cover-image URL, even though the raw
// eBay Browse API itemSummaries response it parses carries one
// (image.imageUrl, with thumbnailImages as the fallback shape some
// listings use instead). No consumer of this row shape — including a
// future candidate picker, the reason this was found — could render a
// cover thumbnail. One normalized field added: `imageUrl`.
//
// Part 1 proves the defect against the real prior committed source (git
// show HEAD:src/lib/imageSearchIdentity.js, the pre-Directive-T state at
// d58a697), not a retyped reproduction.
// Part 2 proves the fix against the current working-tree source, using
// the real exported function (direct import, not a mirror).
//
// Invoke: node tests/grailkey-directive-t-task2-imageurl.test.js

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractIdentityFromImageSearch } from '../src/lib/imageSearchIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GrailKey Directive T, Task 2 (GK-86) — imageUrl on candidate rows ===\n');

const PRE_DIRECTIVE_T_SHA = 'd58a697';

const REAL_ITEM_WITH_IMAGE = {
  title: 'Sabrina Annual Spectaculer 2024 #1 Dan Parent  NYCC Foil Variant VF',
  price: { value: '50.00', currency: 'USD' },
  itemWebUrl: 'https://www.ebay.com/itm/111',
  itemId: 'v1|111|0',
  image: { imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l500.jpg' },
};
const ITEM_WITH_THUMBNAIL_ONLY = {
  title: 'World\'s Finest Comics #74 (DC Comics January-February 1955)',
  price: { value: '99.00', currency: 'USD' },
  itemId: 'v1|222|0',
  thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/thumbs/g/xyz/s-l140.jpg' }],
};
const ITEM_WITH_NO_IMAGE = {
  title: 'Sabrina the Teenage Witch #1 1997',
  price: { value: '9.99', currency: 'USD' },
  itemId: 'v1|333|0',
};

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the actual pre-fix committed source (git show, not retyped).
// ═══════════════════════════════════════════════════════════════════════
console.log(`Part 1: actual prior behavior (git show ${PRE_DIRECTIVE_T_SHA}:src/lib/imageSearchIdentity.js)\n`);
{
  let priorSrc = null;
  try {
    priorSrc = execSync(`git show ${PRE_DIRECTIVE_T_SHA}:src/lib/imageSearchIdentity.js`, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch (e) { priorSrc = null; }
  assertTrue(!!priorSrc, `git show ${PRE_DIRECTIVE_T_SHA}:src/lib/imageSearchIdentity.js succeeded`);

  if (priorSrc) {
    const parsedBlockMatch = priorSrc.match(/const parsed = \{[\s\S]*?\n    \};/);
    assertTrue(!!parsedBlockMatch, 'prior source has the extractIdentityFromImageSearch parsed-row object literal');
    const block = parsedBlockMatch?.[0] || '';
    assertTrue(
      !/imageUrl/.test(block),
      'FAILING (pre-fix): prior parsed-row shape has no imageUrl field at all'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — current working-tree source, real function, real import.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: current source — imageUrl present, direct import\n');
{
  const rows = extractIdentityFromImageSearch([REAL_ITEM_WITH_IMAGE, ITEM_WITH_THUMBNAIL_ONLY, ITEM_WITH_NO_IMAGE]);

  assertEq(rows.length, 3, 'preserves array length (3 rows in, 3 rows out)');

  assertEq(
    rows[0].imageUrl,
    'https://i.ebayimg.com/images/g/abc/s-l500.jpg',
    'PASSING (post-fix): row with image.imageUrl carries it through'
  );
  assertEq(
    rows[1].imageUrl,
    'https://i.ebayimg.com/thumbs/g/xyz/s-l140.jpg',
    'PASSING (post-fix): row with only thumbnailImages[0].imageUrl falls back to it'
  );
  assertEq(
    rows[2].imageUrl,
    null,
    'PASSING (post-fix): row with neither image field produces null, not a crash'
  );

  // Existing fields untouched — this is additive, not a restructure.
  assertEq(rows[0].price, 50, 'existing price field unaffected');
  assertEq(rows[0].itemId, 'v1|111|0', 'existing itemId field unaffected');
  assertTrue(typeof rows[0].rawTitle === 'string', 'existing rawTitle field unaffected');

  // Empty/null input handling (pre-existing behavior) still holds with
  // the new field present on the array-level early-return path too.
  assertEq(extractIdentityFromImageSearch(null), [], 'null input still returns []');
  assertEq(extractIdentityFromImageSearch([]), [], 'empty array input still returns []');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
