// tests/grailkey-directive-j-gk79a-relabel.test.js
//
// GK-79A (GrailKey Directive J, 2026-08-12) — src/App.jsx:5772 rendered
// "Condition confidence: {value}" from item.confidence, but item.confidence
// is Vision's own self-report scoped by api/grade.js's STANDARD_PROMPT to
// "how legible and complete THIS image is" — image legibility, not
// condition certainty. The value itself was never fabricated (unlike
// GK-39/GK-39A's authenticationScore) — this is a wording-only mislabel,
// display-only fix. Relabeled to "Image legibility confidence".
//
// Part 1 proves the DEFECT against the actual prior committed source (git
// show HEAD:src/App.jsx at c45ab88, the real pre-fix state), not a moved
// module or a retyped reproduction — the standing test-design rule this
// repo uses throughout (see grailkey-dispatch-47's docstring).
// Part 2 proves the FIX against the current working-tree source.
// Part 3 proves nothing outside the single render site changed:
// formatConfidence's logic, api/grade.js's prompt, gradeMultiplier, and the
// identity-axis authority weighting at api/enrich.js:2983 are all untouched.
//
// Invoke: node tests/grailkey-directive-j-gk79a-relabel.test.js

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

console.log('\n=== GK-79A (Directive J) — "Condition confidence" relabel ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the actual pre-fix committed source (HEAD at time of this
// directive, c45ab88) really did carry the mislabel. git show, not a
// retyped copy or a moved-aside module (the specific mistake Directive H
// corrected in Task 2's own test evidence).
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
    const priorLineMatch = priorAppSrc.match(/\{confidenceText && <div>[^<]*<\/div>\}/);
    assertTrue(!!priorLineMatch, 'prior committed source has a confidenceText render line');
    const priorLine = priorLineMatch?.[0] || '';
    assertTrue(priorLine.includes('Condition confidence'), 'FAILING (pre-fix, actual prior committed behavior): render line literally says "Condition confidence"');
    assertTrue(!priorLine.includes('Image legibility confidence'), 'pre-fix line does not yet say "Image legibility confidence" (confirms this is a real prior state, not already fixed)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — current working-tree source: relabeled, still renders.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: current source — relabel applied, value still renders\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');

  const currentLineMatch = appSrc.match(/\{confidenceText && <div>[^<]*<\/div>\}/);
  assertTrue(!!currentLineMatch, 'current source has a confidenceText render line');
  const currentLine = currentLineMatch?.[0] || '';

  assertTrue(!currentLine.includes('Condition confidence'), 'PASSING (post-fix): render line no longer says "Condition confidence"');
  assertTrue(currentLine.includes('Image legibility confidence'), 'PASSING (post-fix): render line says "Image legibility confidence"');
  assertTrue(currentLine.includes('{confidenceText}'), 'the value itself still renders (confidenceText interpolated, not dropped)');

  // Whole-file sweep for RENDERED occurrences only — strip JSX comment
  // blocks first (this fix's own comment legitimately references the old
  // label name in prose, "relabeled from 'Condition confidence' to...", to
  // document what changed; that's documentation, not a second render site).
  // The defect this ticket closes is a string reaching the DOM, not a
  // string reaching a code comment.
  const appSrcNoComments = appSrc.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assertTrue(!appSrcNoComments.includes('Condition confidence'), 'zero RENDERED occurrences of "Condition confidence" anywhere in src/App.jsx (comment blocks excluded — this fix\'s own comment legitimately names the retired label)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — scope check: nothing outside the single render site changed.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: scope check — logic, prompt, pricing, and identity weighting untouched\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const grateSrc = readFileSync(path.join(repoRoot, 'api/grade.js'), 'utf8');
  const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8');
  const priceBandsSrc = readFileSync(path.join(repoRoot, 'src/lib/priceBands.js'), 'utf8');

  // formatConfidence itself: same three-branch logic, untouched.
  assertTrue(appSrc.includes('const formatConfidence = (c) => {'), 'formatConfidence definition still present');
  assertTrue(appSrc.includes('if (s === "high" || s === "excellent") return "high";'), 'formatConfidence high branch unchanged');
  assertTrue(appSrc.includes('if (s === "medium" || s === "mid" || s === "moderate") return "medium";'), 'formatConfidence medium branch unchanged');
  assertTrue(appSrc.includes('const confidenceText = formatConfidence(item.confidence);'), 'confidenceText derivation unchanged (still reads item.confidence via formatConfidence)');

  // api/grade.js prompt text: the "how legible and complete THIS image is"
  // scoping language is exactly what justifies the new label — must still
  // be there, unedited, as the ground truth this rename is honest about.
  assertTrue(grateSrc.includes('confidence describes how legible and complete THIS image is'), 'api/grade.js STANDARD_PROMPT confidence-scoping language unchanged');

  // gradeMultiplier: computed from grade/numericGrade/isGraded only, no new
  // confidence read introduced by this display-only change.
  assertTrue(enrichSrc.includes('if (isGraded === true && numericGrade != null) {'), 'gradeMultiplier branch condition unchanged');
  assertTrue(!/gradeMultiplier[\s\S]{0,200}confidence/i.test(enrichSrc.slice(enrichSrc.indexOf('let gradeMultiplier = 1;'), enrichSrc.indexOf('let gradeMultiplier = 1;') + 2000)), 'gradeMultiplier computation block still has no confidence read');

  // identity-axis authority weighting call site (api/enrich.js:~2983)
  // untouched — this dispatch is display-only, never touches identity
  // resolution.
  assertTrue(enrichSrc.includes('buildStandardVisionAuthorityContext(confidence)'), 'identity-axis authority weighting call site (buildStandardVisionAuthorityContext) unchanged');

  // priceBands.js grade-multiplier application untouched.
  assertTrue(priceBandsSrc.includes('export function applyGradeMultiplierToBands(bands, gradeMultiplier)'), 'applyGradeMultiplierToBands unchanged');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
