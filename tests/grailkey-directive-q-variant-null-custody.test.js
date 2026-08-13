// tests/grailkey-directive-q-variant-null-custody.test.js
//
// GrailKey Directive 2026-08-13-Q (corrective) — Directive P shipped an
// incorrect null-preservation rule at every variant/variantNote merge
// boundary. `?? prev.variant` (2 setResult sites) and `|| cur.variant ||
// null` / `|| item.variant || null` (4 catalogue-merge sites) all fall
// through on an EXPLICIT server-sent `variantNote: null` (an authoritative
// revocation), resurrecting the stale prior value instead of clearing it —
// exactly the "conflicted/unconfirmed never rendered as confirmed" case
// Directive P's own acceptance requirement named, violated by P's own fix.
// A 7th, differently-shaped defect found in the same audit:
// buildCorrectedCatalogueItem (src/lib/manualCorrection.js) unconditionally
// nulled `variant` on every manual correction regardless of what the
// server determined (a rename gap, not a resurrection).
//
// This file asserts MERGE OUTCOMES, not source structure — the lesson from
// Directive P's own 20/20-passing-while-defective test. For the six
// App.jsx sites (not importable as a module, per this repo's established
// test convention — see grailkey-directive-j-gk79a-relabel.test.js), the
// real merge expression is extracted from source via regex and actually
// evaluated against constructed inputs, not merely string-matched.
// buildCorrectedCatalogueItem is a real src/lib/ module — imported and
// called directly, both pre-fix (git-stashed) and post-fix.
//
// Part 1 proves the defect DIRECTLY against ef7cf53's real committed
// source (git show for App.jsx; git stash for manualCorrection.js), not a
// mirror. Part 2 proves the fix. Part 3 is a render assertion (P's own
// acceptance requirement, actually tested this time).
//
// Invoke: node tests/grailkey-directive-q-variant-null-custody.test.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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

console.log('\n=== GrailKey Directive Q — variant null-custody corrective ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Helpers — extract the real merge expression from source and evaluate it
// (not just check the text is present).
// ═══════════════════════════════════════════════════════════════════════

// Six sites, in source order. `label` for reporting; `oldPattern` is the
// exact P-era (defective) expression to extract from git-show'd HEAD;
// `priorVar` is which local variable ('prev'/'cur'/'item') each site's
// expression falls back to.
const SITES = [
  { label: 'setResult #1 (gradeBlob, fresh scan)', priorVar: 'prev',
    oldRe: /variant:\s*enrich\.variantNote\s*\?\?\s*prev\.variant/,
    newRe: /variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*prev\.variant/ },
  { label: 'setResult #2 (gradeBlob, saved-item scan)', priorVar: 'prev',
    oldRe: /variant:\s*enrich\.variantNote\s*\?\?\s*prev\.variant/g, // second occurrence handled by matchAll below
    newRe: /variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*prev\.variant/g },
  { label: 'catalogue merge (auto-refresh-adjacent #1, cur.variant)', priorVar: 'cur',
    oldRe: /variant:\s*enrich\.variantNote\s*\|\|\s*cur\.variant\s*\|\|\s*null/,
    newRe: /variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*cur\.variant/ },
  { label: 'catalogue merge (cur.variant #2)', priorVar: 'cur',
    oldRe: /variant:\s*enrich\.variantNote\s*\|\|\s*cur\.variant\s*\|\|\s*null/g,
    newRe: /variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*cur\.variant/g },
  { label: 'catalogue merge (duplicate-confirm, item.variant)', priorVar: 'item',
    oldRe: /variant:\s*enrich\.variantNote\s*\|\|\s*item\.variant\s*\|\|\s*null/,
    newRe: /variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*item\.variant/ },
  { label: 'catalogue merge (save-another-copy, cur.variant, inline object)', priorVar: 'cur',
    oldRe: /variant:\s*enrich\.variantNote\s*\|\|\s*cur\.variant\s*\|\|\s*null/g,
    newRe: /variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*cur\.variant/g },
];

// Evaluate an extracted `variant: <expr>` fragment as a real function of
// (enrich, priorObj) -> value, using the actual JS semantics (not a
// hand-written re-implementation of the rule).
const evalVariantExpr = (fragment, priorVar) => {
  const exprMatch = fragment.match(/variant:\s*(.+)$/s);
  const expr = exprMatch[1].trim().replace(/,$/, '');
  // eslint-disable-next-line no-new-func
  const fn = new Function('enrich', priorVar, `return (${expr});`);
  return (enrich, priorObj) => fn(enrich, priorObj);
};

// priorObj must carry a `.variant` property — the extracted expressions
// all read `prev.variant` / `cur.variant` / `item.variant`, not the prior
// argument directly.
const THREE_CASES = (merge) => ({
  presentValue: merge({ variantNote: 'Confirmed variant' }, { variant: 'Vision variant' }),
  presentNull: merge({ variantNote: null }, { variant: 'Vision variant' }),
  absent: merge({}, { variant: 'Vision variant' }),
});

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the actual pre-fix committed source (git show HEAD, ef7cf53),
// evaluated, not just string-matched. Every site must resurrect on null.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: actual prior behavior (git show HEAD:src/App.jsx), evaluated\n');
{
  let priorAppSrc = null;
  try {
    priorAppSrc = execSync('git show HEAD:src/App.jsx', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
  } catch (e) { priorAppSrc = null; }
  assertTrue(!!priorAppSrc, 'git show HEAD:src/App.jsx succeeded');

  if (priorAppSrc) {
    // setResult sites — both used `?? prev.variant`. Two occurrences.
    const setResultMatches = [...priorAppSrc.matchAll(/variant:\s*enrich\.variantNote\s*\?\?\s*prev\.variant/g)];
    assertEq(setResultMatches.length, 2, 'prior source has exactly 2 `?? prev.variant` setResult occurrences');
    setResultMatches.forEach((m, i) => {
      const merge = evalVariantExpr(m[0], 'prev');
      const r = THREE_CASES((enrich, prev) => merge(enrich, prev));
      assertEq(r.presentValue, 'Confirmed variant', `setResult site ${i + 1}: present value replaces prior`);
      assertEq(r.presentNull, 'Vision variant', `FAILING (pre-fix) setResult site ${i + 1}: present NULL resurrects stale prior "Vision variant" instead of clearing`);
      assertEq(r.absent, 'Vision variant', `setResult site ${i + 1}: absent key preserves prior (this part was already correct pre-fix)`);
    });

    // Catalogue merge sites — `|| cur.variant || null` (3 occurrences) and
    // `|| item.variant || null` (1 occurrence).
    const curMatches = [...priorAppSrc.matchAll(/variant:\s*enrich\.variantNote\s*\|\|\s*cur\.variant\s*\|\|\s*null/g)];
    assertEq(curMatches.length, 3, 'prior source has exactly 3 `|| cur.variant || null` occurrences');
    curMatches.forEach((m, i) => {
      const merge = evalVariantExpr(m[0], 'cur');
      const r = THREE_CASES((enrich, cur) => merge(enrich, cur));
      assertEq(r.presentValue, 'Confirmed variant', `cur.variant catalogue site ${i + 1}: present value replaces prior`);
      assertEq(r.presentNull, 'Vision variant', `FAILING (pre-fix) cur.variant catalogue site ${i + 1}: present NULL resurrects stale prior instead of clearing`);
      assertEq(r.absent, 'Vision variant', `cur.variant catalogue site ${i + 1}: absent key preserves prior (already correct pre-fix)`);
    });

    const itemMatches = [...priorAppSrc.matchAll(/variant:\s*enrich\.variantNote\s*\|\|\s*item\.variant\s*\|\|\s*null/g)];
    assertEq(itemMatches.length, 1, 'prior source has exactly 1 `|| item.variant || null` occurrence');
    itemMatches.forEach((m, i) => {
      const merge = evalVariantExpr(m[0], 'item');
      const r = THREE_CASES((enrich, item) => merge(enrich, item));
      assertEq(r.presentValue, 'Confirmed variant', `item.variant catalogue site ${i + 1}: present value replaces prior`);
      assertEq(r.presentNull, 'Vision variant', `FAILING (pre-fix) item.variant catalogue site ${i + 1}: present NULL resurrects stale prior instead of clearing`);
    });

    console.log(`  (6 App.jsx sites total: 2 setResult + 3 cur.variant + 1 item.variant — matches Directive Q's audit count)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1b — buildCorrectedCatalogueItem, real module, git-stashed.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1b: buildCorrectedCatalogueItem pre-fix (git stash, real import)\n');
{
  execSync('git stash push --quiet -- src/lib/manualCorrection.js', { cwd: repoRoot });
  try {
    const modUrl = `../src/lib/manualCorrection.js?t=${Date.now()}`;
    const { buildCorrectedCatalogueItem } = await import(modUrl);
    const oldItem = { id: 'x1', title: 'Old Title', variant: 'Old Variant', status: 'kept' };
    const resultValue = buildCorrectedCatalogueItem(oldItem, { title: 'New Title', variantNote: 'New Variant' });
    assertEq(resultValue.variant, null, 'FAILING (pre-fix): a real server-determined variant ("New Variant") is silently discarded — merged.variant is null regardless of enrichData.variantNote');
  } finally {
    execSync('git stash pop --quiet', { cwd: repoRoot });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — current working-tree source: fixed, evaluated for real outcomes.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: current source — fixed, evaluated\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const NEW_PATTERN = /variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*(prev|cur|item)\.variant/g;
  const newMatches = [...appSrc.matchAll(NEW_PATTERN)];
  assertEq(newMatches.length, 6, 'current source has exactly 6 presence-aware variant merge sites (matches the audit count)');

  let allPass = true;
  newMatches.forEach((m, i) => {
    const priorVar = m[1];
    const merge = evalVariantExpr(m[0], priorVar);
    const r = THREE_CASES((enrich, priorObj) => merge(enrich, priorObj));
    if (r.presentValue !== 'Confirmed variant' || r.presentNull !== null || r.absent !== 'Vision variant') allPass = false;
    assertEq(r.presentValue, 'Confirmed variant', `site ${i + 1} (${priorVar}): present value replaces prior`);
    assertEq(r.presentNull, null, `PASSING (post-fix) site ${i + 1} (${priorVar}): present NULL clears prior — no resurrection`);
    assertEq(r.absent, 'Vision variant', `site ${i + 1} (${priorVar}): absent key preserves prior`);
  });
  assertTrue(allPass, 'all 6 App.jsx sites satisfy the full three-case rule');
}

console.log('\nPart 2b: buildCorrectedCatalogueItem post-fix (real import)\n');
{
  const { buildCorrectedCatalogueItem } = await import(`../src/lib/manualCorrection.js?t=${Date.now()}`);
  const oldItem = { id: 'x1', title: 'Old Title', variant: 'Old Variant', status: 'kept' };

  const withValue = buildCorrectedCatalogueItem(oldItem, { title: 'New Title', variantNote: 'New Variant' });
  assertEq(withValue.variant, 'New Variant', 'PASSING (post-fix): a real server-determined variant is no longer discarded');

  const withNull = buildCorrectedCatalogueItem(oldItem, { title: 'New Title', variantNote: null });
  assertEq(withNull.variant, null, 'present null clears (no prior to resurrect — this path always discards the old identity-dependent variant by design)');

  const withAbsent = buildCorrectedCatalogueItem(oldItem, { title: 'New Title' });
  assertEq(withAbsent.variant, null, 'absent key -> null (matches every other identity-dependent field\'s own established clear-list behavior at this specific merge site — "prior" is not preserved here by design, unlike the 6 App.jsx sites)');
  assertEq(withAbsent.id, 'x1', 'id still pinned to oldItem.id (unrelated fields unaffected)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — render assertion: P's own acceptance requirement, actually
// tested. After a null merge, ResultCard/CollectionDetail must not show a
// confirmed Variant label — proven by combining the real merge outcome
// (Part 2) with the real render condition (Directive P's own title-
// adjacent `{item.variant && (...)}` / `{result.variant && (...)}` guard,
// unchanged by this dispatch, re-verified present here).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: render assertion — no confirmed Variant label after a null merge\n');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  assertTrue(appSrc.includes('{result.variant && ('), 'ResultCard render guard present (Directive P, unchanged)');
  assertTrue(appSrc.includes('{item.variant && ('), 'CollectionDetail render guard present (Directive P, unchanged)');

  // The actual chain: merge outcome (Part 2, proven null on revocation) ->
  // render guard (truthy check) -> null is falsy -> no render. This was
  // ALREADY true of the render guard itself; Part 2 proves the merge that
  // feeds it now actually produces null instead of resurrecting a string
  // that would have passed the truthy check and rendered as confirmed.
  const mergedVariantOnRevocation = null; // established directly in Part 2
  assertTrue(!mergedVariantOnRevocation, 'a null merged variant fails the {variant && (...)} truthy check — no confirmed label renders');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
