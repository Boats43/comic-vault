// tests/grailkey-directive-p-task3-variant-on-card.test.js
//
// GrailKey Directive 2026-08-13-P, Task 3 — variant identity must surface
// on the operator card. Display and custody only, zero pricing math,
// independent of Tasks 1-2.
//
// Custody trace (Directive P report): confirmedVariant is correctly
// resolved server-side and correctly surfaces on the HTTP response as
// out.variantNote (Q135 dispatch's universal fallback, api/enrich.js:
// ~10862-10863). Four catalogue-merge sites already correctly rename it
// (enrich.variantNote -> item.variant); the PRIMARY scan-save merge does
// too, via the shared mergeConfirmedIdentity helper (src/lib/
// dataQualityGuard.js). The gap found: the LIVE, fresh-scan `result` state
// (what ResultCard renders immediately after a scan, before the user ever
// saves) is built via a bare `{ ...prev, ...enrich }` spread at two
// setResult call sites (src/App.jsx, gradeBlob) — a plain spread never
// renames enrich.variantNote to result.variant, so ResultCard stayed
// frozen on Vision's pre-enrich guess and never picked up enrich.js's own
// confirmation/correction of the variant. A second, independent gap: even
// where item.variant WAS correctly populated (CollectionDetail), it
// rendered ~1400 lines below the title block instead of adjacent to it.
//
// Part 1 proves both defects against the actual prior committed source
// (git show HEAD:src/App.jsx, the real pre-Directive-P state at e95b9a9),
// not a moved module or a retyped reproduction.
// Part 2 proves the fix against the current working-tree source: both
// setResult spreads rename the field, both cards render "Variant: X"
// immediately under the title/publisher/year block, and the old buried
// CollectionDetail duplicate is gone (not shown twice).
// Part 3 is a scope check: no pricing math, no new authority field, no
// change to the server-side custody chain this test relies on.
//
// Invoke: node tests/grailkey-directive-p-task3-variant-on-card.test.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GrailKey Directive P, Task 3 — variant identity on the operator card ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — actual pre-fix committed source (git show, not retyped).
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: actual prior behavior (git show HEAD:src/App.jsx)\n');
{
  let priorAppSrc = null;
  try {
    priorAppSrc = execSync('git show HEAD:src/App.jsx', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
  } catch (e) {
    priorAppSrc = null;
  }
  assertTrue(!!priorAppSrc, 'git show HEAD:src/App.jsx succeeded (repo has a committed prior version)');

  if (priorAppSrc) {
    // Defect 1: the fresh-scan `result` state spreads never renamed the field.
    assertTrue(
      priorAppSrc.includes('setResult((prev) => prev ? { ...prev, ...enrich, image: prev.image, _enriching: false } : prev);'),
      'FAILING (pre-fix): first setResult merge is a bare spread — no variant: enrich.variantNote rename'
    );
    assertTrue(
      !priorAppSrc.includes('variant: enrich.variantNote ?? prev.variant, image: prev.image, _enriching: false'),
      'pre-fix: first setResult merge does not yet carry the rename (confirms real prior state, not already fixed)'
    );

    // Defect 2: CollectionDetail's title block had no adjacent variant line,
    // and the actual variant render sat far below (Restoration Warning
    // neighbor), not next to publisher/year.
    const titleBlockIdx = priorAppSrc.indexOf('{/* 2. TITLE BLOCK */}');
    assertTrue(titleBlockIdx !== -1, 'prior source has the "2. TITLE BLOCK" comment marker');
    const titleBlockRegion = priorAppSrc.slice(titleBlockIdx, titleBlockIdx + 500);
    assertTrue(
      !titleBlockRegion.includes('Variant:'),
      'FAILING (pre-fix): no "Variant:" render within 500 chars of the title block — variant was not title-adjacent'
    );
    assertTrue(
      priorAppSrc.includes('⚡ {item.variant}\n        </div>\n      )}\n\n      {/* 3b. RESTORATION WARNING */}'),
      'pre-fix: the actual CollectionDetail variant render sat immediately before the Restoration Warning section — confirms it was buried well past the title block, not the retained list-tile badge at a different location'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — current working-tree source: fixed.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: current source — custody fixed, title-adjacent render\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');

  // Custody: both setResult merge sites now rename the field, using `??`
  // (not `||`) so an honest server null still overrides a stale guess.
  assertTrue(
    appSrc.includes("setResult((prev) => prev ? { ...prev, ...enrich, variant: enrich.variantNote ?? prev.variant, image: prev.image, _enriching: false } : prev);"),
    'PASSING (post-fix): gradeBlob\'s first setResult merge renames enrich.variantNote -> variant'
  );
  assertTrue(
    appSrc.includes('prev ? { ...prev, ...enrich, variant: enrich.variantNote ?? prev.variant, image: prev.image } : prev'),
    'PASSING (post-fix): gradeBlob\'s second setResult merge renames enrich.variantNote -> variant'
  );

  // ResultCard: title-adjacent variant, positioned before the grade badge
  // (i.e. immediately under the muted publisher/year line), value still
  // sourced from result.variant (the same field, not a new one).
  const resultTitleIdx = appSrc.indexOf('<div className="title">{result.title}');
  assertTrue(resultTitleIdx !== -1, 'ResultCard title element found');
  const resultCardRegion = appSrc.slice(resultTitleIdx, resultTitleIdx + 1200);
  assertTrue(resultCardRegion.includes('Variant: {result.variant}'), 'PASSING (post-fix): ResultCard renders "Variant: {result.variant}" close to the title');
  const gradeBadgeIdxInRegion = resultCardRegion.indexOf('grade-badge cgc');
  const variantIdxInRegion = resultCardRegion.indexOf('Variant: {result.variant}');
  assertTrue(
    gradeBadgeIdxInRegion === -1 || variantIdxInRegion < gradeBadgeIdxInRegion,
    'ResultCard variant line renders BEFORE the grade badge (title-adjacent, not appended after other card sections)'
  );

  // CollectionDetail: title-adjacent variant.
  const titleBlockIdx = appSrc.indexOf('{/* 2. TITLE BLOCK */}');
  assertTrue(titleBlockIdx !== -1, 'current source has the "2. TITLE BLOCK" comment marker');
  const titleBlockRegion = appSrc.slice(titleBlockIdx, titleBlockIdx + 1200);
  assertTrue(
    titleBlockRegion.includes('Variant: {item.variant}'),
    'PASSING (post-fix): CollectionDetail renders "Variant: {item.variant}" within 1200 chars of the title block'
  );

  // Old buried duplicate removed — the value is not shown twice on the
  // same card. The list-tile's own compact badge (a different, earlier
  // component, before CollectionDetail begins) is deliberately untouched
  // and still present.
  assertTrue(
    !appSrc.includes('⚡ {item.variant}\n        </div>\n      )}\n\n      {/* 3b. RESTORATION WARNING */}'),
    'the old buried CollectionDetail variant render (immediately before Restoration Warning) is gone, not duplicated'
  );
  assertTrue(
    appSrc.includes("!['cover a','corner box','masterpieces'].some(v => item.variant.toLowerCase().includes(v))"),
    'the separate, compact collection list-tile badge is untouched (not the surface this dispatch targets)'
  );

  // One authority, two surfaces: both cards read the exact same underlying
  // field name (result.variant / item.variant), both ultimately sourced
  // from enrich.variantNote server-side — no UI-only variant string
  // introduced that could disagree with what pricing/listing used.
  assertTrue(
    !appSrc.match(/const\s+\w*[Vv]ariant(Label|Display|Badge)\w*\s*=/),
    'no new UI-only variant string/derivation introduced — display reads the same authoritative field pricing and listing already use'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — scope check: display only, custody chain otherwise untouched.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: scope check — no pricing math, no new authority field\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8');
  const dqgSrc = readFileSync(path.join(repoRoot, 'src/lib/dataQualityGuard.js'), 'utf8');

  // Server-side custody this fix depends on is unchanged by this dispatch.
  assertTrue(
    /if \(out\.variantNote === undefined\) \{\s*out\.variantNote = confirmedVariant \|\| null;\s*\}/.test(enrichSrc),
    'api/enrich.js Q135 universal variantNote fallback unchanged (this dispatch did not touch api/*.js)'
  );
  assertTrue(
    dqgSrc.includes("variant: hasKey(enrich, 'variantNote') ? enrich.variantNote : prior?.variant,"),
    'src/lib/dataQualityGuard.js mergeConfirmedIdentity variant merge unchanged'
  );

  // No new field invented to carry an "unconfirmed" state that doesn't
  // already reach the client — per the directive's explicit instruction,
  // that gap is reported (docs/PATTERN-LIBRARY.md), not built around here.
  assertTrue(
    !appSrc.includes('variantConfidence') && !appSrc.includes('variantUnconfirmed'),
    'no new unconfirmed/conflicted-variant authority field invented in src/App.jsx'
  );

  // Every pre-existing four merge-site renames (duplicate-confirm,
  // reIdentifyBook-shaped paths, add-photo, save-another-copy) still
  // present and unmodified in count.
  const renameCount = (appSrc.match(/variant: enrich\.variantNote \|\| cur\.variant \|\| null,/g) || []).length
    + (appSrc.match(/variant: enrich\.variantNote \|\| item\.variant \|\| null,/g) || []).length;
  assertTrue(renameCount === 4, `all 4 pre-existing enrich.variantNote merge-site renames still present, unmodified (found ${renameCount})`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
