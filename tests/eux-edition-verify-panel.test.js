// tests/eux-edition-verify-panel.test.js
//
// GK-172 E-UX — the reusable operator printing/edition verification chip
// panel (EditionVerifyPanel, src/App.jsx). No jsdom/testing-library exists
// in this repo (package.json has neither) — per the repository's own
// established convention for testing App.jsx UI contracts without a new
// framework (tests/grailkey-directive-p-task3-variant-on-card.test.js,
// tests/grailkey-directive-j-gk79a-relabel.test.js), Part 1 inspects the
// real committed source text directly; Part 2 proves the corrected-item
// round trip using the REAL exported reconcileEditionFacet
// (src/lib/identityCore.js) and buildCorrectedCatalogueItem
// (src/lib/manualCorrection.js) — the actual functions the component's
// onManualCorrect prop (submitManualCorrection, src/App.jsx) calls through
// to, not a reimplementation or a mount.
//
// GK-172 safety correction (this same dispatch) — the panel originally
// called onDismiss() unconditionally after ANY successful manual
// correction, including a submitted UNKNOWN choice (which legitimately
// succeeds server-side, returning authority=NONE, per Control 4b). That
// would have set editionConfirmed=true from "the request succeeded" alone
// — a client-side authority bypass, never a real law. Part 1 asserts the
// fix (the authority-gated dismiss) is the actual shipped source, and that
// the old unconditional-dismiss shape is gone (negative control).
//
// Invoke: node tests/eux-edition-verify-panel.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { reconcileEditionFacet } from '../src/lib/identityCore.js';
import { buildCorrectedCatalogueItem } from '../src/lib/manualCorrection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const appSource = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};

console.log('\n=== GK-172 E-UX — EditionVerifyPanel contract ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — real committed source, static contract checks (no mount).
// ═══════════════════════════════════════════════════════════════════════
console.log('--- Part 1: source-text contract (requirements 1-3, 5-7, 10-12) ---\n');

const panelStart = appSource.indexOf('function EditionVerifyPanel(');
assertTrue(panelStart > -1, 'EditionVerifyPanel is defined in src/App.jsx');
const panelEnd = appSource.indexOf('\nfunction CollectionDetail(', panelStart);
const panelSource = panelStart > -1 && panelEnd > -1 ? appSource.slice(panelStart, panelEnd) : '';
assertTrue(panelSource.length > 0, 'EditionVerifyPanel source block extracted (bounded by the next top-level component)');

// Requirement 1/2 — exact choice set + labels.
const choicesMatch = appSource.match(/const PRINTING_CLASS_CHOICES = \[([\s\S]*?)\];/);
const choicesBlock = choicesMatch ? choicesMatch[1] : '';
const choiceValues = [...choicesBlock.matchAll(/value:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
const choiceLabels = [...choicesBlock.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
assertEq(choiceValues, ['ORIGINAL', 'FACSIMILE', 'SECOND_PRINT', 'REPRINT', 'LATER_PRINT', 'UNKNOWN'], 'Req 1: PRINTING_CLASS_CHOICES values are exactly the 6-value printingClass enum, in order');
assertEq(choiceLabels, ['Original', 'Facsimile', 'Second Print', 'Reprint', 'Later Print', 'Unknown / Research'], 'Req 2: labels are exactly Original/Facsimile/Second Print/Reprint/Later Print/Unknown / Research');

// Req 3 — no default selection.
assertTrue(/const \[armedChoice, setArmedChoice\] = useState\(null\);/.test(panelSource), 'Req 3: armedChoice state initializes to null — no default selection');

// Req 4 — selecting a chip only arms, does not submit. The chip button's
// onClick must set armedChoice, and must NOT call onManualCorrect or
// confirm() directly.
const chipOnClickMatch = panelSource.match(/onClick=\{\(\) => \{ setArmedChoice\(choice\.value\); setError\(null\); \}\}/);
assertTrue(!!chipOnClickMatch, 'Req 4: chip onClick only arms the choice (setArmedChoice) and clears error — does not submit');
assertTrue(!/onClick=\{\(\) => \{ setArmedChoice\(choice\.value\)[^}]*onManualCorrect/.test(panelSource), 'Req 4: chip onClick never calls onManualCorrect directly');

// Req 5 — confirm submits through the existing manual-correction path with printingClass.
assertTrue(/onManualCorrect\(item, \{ printingClass: armedChoice \}, \['printingClass'\]\)/.test(panelSource), "Req 5: Confirm calls onManualCorrect(item, { printingClass: armedChoice }, ['printingClass']) — the existing manual-correction contract, not a new one");

// Req 6 — no direct client-side price mutation anywhere in the panel.
assertTrue(!/\bitem\.price\s*=/.test(panelSource), 'Req 6: no direct assignment to item.price anywhere in the panel');
assertTrue(!/onUpdateField\(item,\s*'price'/.test(panelSource), "Req 6: no onUpdateField(item, 'price', ...) call in the panel");

// Req 7 — no parallel authority mechanism: the ONLY network-shaped call in
// the panel is through the onManualCorrect prop; no bare fetch("/api/...").
assertTrue(!/fetch\(/.test(panelSource), 'Req 7: no direct fetch() call in the panel — only the existing onManualCorrect prop reaches the server');

// Req 10 — consequence preview is conceptual only, never a fabricated price.
const consequenceMatch = appSource.match(/const PRINTING_CLASS_CONSEQUENCE = \{([\s\S]*?)\};/);
const consequenceBlock = consequenceMatch ? consequenceMatch[1] : '';
assertTrue(consequenceBlock.length > 0, 'PRINTING_CLASS_CONSEQUENCE block found');
assertTrue(!/\$\d/.test(consequenceBlock), 'Req 10: no fabricated dollar figure anywhere in the consequence-preview text');

// Req 11 — conflict display consumes server-provided editionReconciliation.conflicts, never recomputed.
assertTrue(/const resolved = item\.editionReconciliation;/.test(panelSource), 'Req 11: resolved is read directly from item.editionReconciliation (server-provided)');
assertTrue(/const conflicts = Array\.isArray\(resolved\?\.conflicts\) \? resolved\.conflicts : \[\];/.test(panelSource), 'Req 11: conflicts is read directly from resolved.conflicts, not recomputed');

// Req 12 — client does not recompute edition authority: no local
// reimplementation of reconcileEditionFacet's origin/corroboration logic
// (no local vote-counting/agreement-threshold code in the panel).
assertTrue(!/corroborat/i.test(panelSource), 'Req 12: no local corroboration/vote-counting logic reimplemented in the panel (authority is read, never recomputed)');

// Req 13 (listing state) — the gating condition itself (needsEditionAck)
// is untouched by this dispatch: still server editionWarning.detected AND
// client editionConfirmed, never a hardcoded bypass.
assertTrue(/item\.editionWarning\?\.detected === true && !item\.editionConfirmed;/.test(appSource), 'Req 13: needsEditionAck gate is unchanged — still (editionWarning.detected && !editionConfirmed)');

console.log('\n--- Part 1b: the client-authority-bypass fix itself (this dispatch) ---\n');

// The fix: dismiss is gated on the SERVER-RETURNED authority, read from
// the actual return value of onManualCorrect, not fired unconditionally.
assertTrue(/const corrected = await onManualCorrect\(item, \{ printingClass: armedChoice \}, \['printingClass'\]\);/.test(panelSource), 'Fix: confirm() captures the real return value of onManualCorrect as `corrected`');
assertTrue(/corrected\?\.editionReconciliation\?\.authority === 'OPERATOR_CONFIRMED' && onDismiss/.test(panelSource), "Fix: onDismiss only fires when corrected.editionReconciliation.authority === 'OPERATOR_CONFIRMED'");

// Negative control — the OLD unconditional shape must be gone: an
// unconditional `if (onDismiss) onDismiss();` immediately following the
// bare `await onManualCorrect(...)` call with no authority check between
// them would be the exact regression this fix closes.
const oldBuggyShape = /await onManualCorrect\(item, \{ printingClass: armedChoice \}, \['printingClass'\]\);\s*setArmedChoice\(null\);\s*if \(onDismiss\) onDismiss\(\);/;
assertTrue(!oldBuggyShape.test(panelSource), 'SHIP-BLOCKING: the old unconditional "succeeded => dismiss" shape is gone from source');

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — real corrected-item round trip (req 8, 9, 13's "prove the
// round trip" requirement). Uses the ACTUAL exported functions the
// component's own data path runs through — reconcileEditionFacet computes
// the real authority, buildCorrectedCatalogueItem performs the real
// clear-then-merge onto a fake prior item. The dismiss predicate below is
// copy-identical to the one asserted present in Part 1b, applied to real
// function output, not a fabricated shape.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n--- Part 2: corrected-item round trip, four paths (real reconcileEditionFacet + buildCorrectedCatalogueItem) ---\n');

const dismissesPanel = (correctedItem) => correctedItem?.editionReconciliation?.authority === 'OPERATOR_CONFIRMED';

const oldItem = {
  id: 'test-item-1',
  title: 'Creepy', issue: '1', year: '1964', publisher: 'Warren',
  editionWarning: { detected: true, signals: ['facsimile'] },
  editionConfirmed: false,
  printingClass: undefined,
  editionReconciliation: undefined,
};

// A. FACSIMILE — operator confirms FACSIMILE against a prior Vision claim.
{
  const reconciled = reconcileEditionFacet({ visionPrintingClass: 'FACSIMILE', operatorPrintingClass: 'FACSIMILE' });
  const enrichData = { printingClass: reconciled.printingClass, editionReconciliation: reconciled, price: '$12.33', refusedToPrice: false };
  const corrected = buildCorrectedCatalogueItem(oldItem, enrichData);
  assertEq(corrected.printingClass, 'FACSIMILE', 'A. FACSIMILE: corrected item carries printingClass=FACSIMILE from the real server response');
  assertEq(corrected.editionReconciliation.authority, 'OPERATOR_CONFIRMED', 'A. FACSIMILE: authority is OPERATOR_CONFIRMED');
  assertTrue(dismissesPanel(corrected), 'A. FACSIMILE: the panel dismiss predicate fires — a genuinely resolved operator choice stops re-prompting');
}

// B. ORIGINAL — operator confirms ORIGINAL against a disagreeing Vision claim.
{
  const reconciled = reconcileEditionFacet({ visionPrintingClass: 'FACSIMILE', operatorPrintingClass: 'ORIGINAL' });
  const enrichData = { printingClass: reconciled.printingClass, editionReconciliation: reconciled, price: '$64.00', refusedToPrice: false };
  const corrected = buildCorrectedCatalogueItem(oldItem, enrichData);
  assertEq(corrected.printingClass, 'ORIGINAL', 'B. ORIGINAL: corrected item carries printingClass=ORIGINAL');
  assertEq(corrected.editionReconciliation.authority, 'OPERATOR_CONFIRMED', 'B. ORIGINAL: authority is OPERATOR_CONFIRMED');
  assertTrue(corrected.editionReconciliation.conflicts.some((c) => c.source === 'vision' && c.value === 'FACSIMILE'), "B. ORIGINAL: the disagreeing Vision claim is retained in the corrected item's conflicts, not discarded");
  assertTrue(dismissesPanel(corrected), 'B. ORIGINAL: the panel dismiss predicate fires');
}

// C. UNKNOWN / Research — must NOT dismiss, must NOT read as authority.
{
  const reconciled = reconcileEditionFacet({ visionPrintingClass: 'FACSIMILE', operatorPrintingClass: 'UNKNOWN' });
  const enrichData = { printingClass: reconciled.printingClass, editionReconciliation: reconciled, price: null, refusedToPrice: true };
  const corrected = buildCorrectedCatalogueItem(oldItem, enrichData);
  assertEq(corrected.printingClass, 'UNKNOWN', 'C. UNKNOWN: corrected item carries printingClass=UNKNOWN');
  assertEq(corrected.editionReconciliation.authority, 'NONE', 'C. UNKNOWN: authority is NONE, not OPERATOR_CONFIRMED');
  assertTrue(!dismissesPanel(corrected), 'SHIP-BLOCKING (C. UNKNOWN): the panel dismiss predicate does NOT fire — no local editionConfirmed=true, no listing unlock, the request having "succeeded" is not authority');
  assertEq(corrected.price, null, 'C. UNKNOWN: no committed edition-specific price on the corrected item');
}

// D. CONTESTED — a winner exists by agreement, but something disagrees;
// never dismisses, never unlocks listing (this shape has no operator
// input at all — it proves the general law, not this panel's own submit
// path, per the ruling's own explicit ask).
{
  const reconciled = reconcileEditionFacet({
    visionPrintingClass: 'FACSIMILE',
    corroboratingClaims: [
      { source: 'row-0', printingClass: 'FACSIMILE' },
      { source: 'row-1', printingClass: 'ORIGINAL' },
    ],
  });
  const enrichData = { printingClass: reconciled.printingClass, editionReconciliation: reconciled, price: null, refusedToPrice: true };
  const corrected = buildCorrectedCatalogueItem(oldItem, enrichData);
  assertEq(corrected.editionReconciliation.authority, 'CONTESTED', 'D. CONTESTED: authority is CONTESTED');
  assertTrue(!dismissesPanel(corrected), 'D. CONTESTED: the panel dismiss predicate does NOT fire — contested state never silently unlocks listing');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
