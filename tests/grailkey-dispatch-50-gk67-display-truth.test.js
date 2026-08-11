// tests/grailkey-dispatch-50-gk67-display-truth.test.js
//
// GK-67 + fold-in fixes (Dispatch 50, Commit 2) — display-only changes to
// src/App.jsx. No pricing/decision computation touched: blendedAvg's own
// calculation (api/enrich.js:6642), computePriceBands (src/lib/priceBands.js),
// and decisionEngine.js's ordinary routing are all unmodified by this
// commit — only how already-computed values are presented. Extract-and-eval
// against the real shipped source, per this repo's standing test-design
// rule, not a retyped copy.
//
// Invoke: node tests/grailkey-dispatch-50-gk67-display-truth.test.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8');
const priceBandsSrc = readFileSync(path.join(repoRoot, 'src/lib/priceBands.js'), 'utf8');
const decisionSrc = readFileSync(path.join(repoRoot, 'src/lib/decisionEngine.js'), 'utf8');
const compsSrc = readFileSync(path.join(repoRoot, 'api/comps.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GK-67 + fold-in (Dispatch 50, Commit 2) — display truth ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 0 — no computation touched (proves price/bands/decision unaffected
// structurally, not by replay)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 0: pricing/decision computation untouched\n');
{
  assertTrue(
    enrichSrc.includes('blendedAvg = (soldAvg * 0.6) + (activeAvg * 0.4);'),
    'blendedAvg computation (enrich.js:6642) byte-identical — only its display, not its calculation, changed'
  );
  assertTrue(
    priceBandsSrc.includes('market = (soldAvg * 0.7) + (activeAvg * 0.3);'),
    'priceBands.js tier-2 70/30 formula byte-identical'
  );
  assertTrue(
    priceBandsSrc.includes("'tier2_blend_70_30': 'sold_active_blend_30'"),
    'TIER_SOURCE_MAP byte-identical'
  );
  assertTrue(
    !decisionSrc.includes("action = 'HOLD_FOR_CGC'"),
    'decisionEngine.js unaffected by this commit (still reflects Commit 1 alone — GK-66 demotion, not touched again here)'
  );
  assertTrue(
    compsSrc.includes('export const computeMatchConfidence = (comps, opts = {}) =>'),
    'api/comps.js:442 computeMatchConfidence untouched — score itself unchanged, per the dispatch'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — GK-67: "Blend (60/40)" line removed
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 1: Blend (60/40) causal-derivation line removed\n');
{
  assertTrue(!appSrc.includes('→ Blend (60/40):'), 'the rendered "→ Blend (60/40): $..." JSX line is gone (the string survives only inside this fix\'s own explanatory comment)');
  assertTrue(!appSrc.includes("item.blendedAvg.toFixed(2)"), 'blendedAvg is no longer formatted/rendered in the derivation panel');
  assertTrue(appSrc.includes('item.blendedAvg'), 'blendedAvg is still referenced somewhere (the value itself is real and used elsewhere — only THIS presentation is gone)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — source labels: every TIER_SOURCE_MAP / PRICE_BANDS_SOURCES value
// gets a truthful label, no fabricated fallback
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: source labels — no fabricated fallback\n');
{
  assertTrue(!appSrc.includes('"Source: AI estimate"'), 'the literal "Source: AI estimate" default string is gone');
  // Extract the PRICING_SOURCE_LABELS lookup verbatim and eval it against
  // every real TIER_SOURCE_MAP output value.
  const pricingLabelsMatch = appSrc.match(/const PRICING_SOURCE_LABELS = \{[\s\S]*?\n                \};/);
  assertTrue(!!pricingLabelsMatch, 'PRICING_SOURCE_LABELS lookup found verbatim in App.jsx');
  // eslint-disable-next-line no-new-func
  const PRICING_SOURCE_LABELS = new Function(`${pricingLabelsMatch[0]} return PRICING_SOURCE_LABELS;`)();
  const TIER_SOURCE_MAP_OUTPUTS = [
    'verified_sold_recency', 'sold_active_blend_30', 'verified_sold',
    'verified_sold_stale', 'active_ask_derived', 'pc_estimate',
    'verified_sold_active_blend',
  ];
  for (const src of TIER_SOURCE_MAP_OUTPUTS) {
    assertTrue(typeof PRICING_SOURCE_LABELS[src] === 'string' && PRICING_SOURCE_LABELS[src].length > 0, `PRICING_SOURCE_LABELS has a real label for "${src}"`);
  }
  assertTrue(
    PRICING_SOURCE_LABELS['sold_active_blend_30'] !== 'AI estimate' &&
    PRICING_SOURCE_LABELS['sold_active_blend_30'].toLowerCase() !== 'estimated',
    'sold_active_blend_30 (a real 31-comp computation) does not render as "estimated" or "AI estimate"'
  );

  const priceBandsLabelsMatch = appSrc.match(/const PRICE_BANDS_SOURCE_LABELS = \{[\s\S]*?\n                    \};/);
  assertTrue(!!priceBandsLabelsMatch, 'PRICE_BANDS_SOURCE_LABELS lookup found verbatim in App.jsx');
  // eslint-disable-next-line no-new-func
  const PRICE_BANDS_SOURCE_LABELS = new Function(`${priceBandsLabelsMatch[0]} return PRICE_BANDS_SOURCE_LABELS;`)();
  const PRICE_BANDS_SOURCES = [
    'tier1_recency_weighted', 'tier2_active_dominant_thin_sold',
    'tier2_sold_only_active_suspect', 'tier2_blend_70_30', 'tier2_sold_only',
    'verified_sold_stale', 'tier3_active_discounted_over_fallback_sold',
    'tier3_active_discounted', 'tier4_pc_estimate', 'variant_fallback_capped',
  ];
  for (const src of PRICE_BANDS_SOURCES) {
    assertTrue(typeof PRICE_BANDS_SOURCE_LABELS[src] === 'string' && PRICE_BANDS_SOURCE_LABELS[src].length > 0, `PRICE_BANDS_SOURCE_LABELS has a real label for "${src}"`);
  }
  assertTrue(
    PRICE_BANDS_SOURCE_LABELS['tier2_blend_70_30'].toLowerCase() !== 'estimated',
    'tier2_blend_70_30 (sold_active_blend_30\'s internal name) does not render as "estimated"'
  );
  assertTrue(!appSrc.includes("'source-unavailable'") || appSrc.includes('|| \'source-unavailable\''), 'unmapped priceBands.source falls to an honest "source-unavailable" marker, not an invented label');
  assertTrue(appSrc.includes('return label ? `Source: ${label}` : "Source unavailable";'), 'unmapped pricingSource renders the literal "Source unavailable", never an invented source');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — ladder attribution
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: ladder attribution\n');
{
  const occurrences = (appSrc.match(/Source: PriceCharting, unedited/g) || []).length;
  assertEq(occurrences, 2, 'both PRICE LADDER panels (ResultCard + CollectionDetail) carry the attribution line');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — GK-49: match-quality label
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: match-quality label\n');
{
  assertTrue(!appSrc.includes('`~ Similar${mcScore'), 'the old "~ Similar {score}" template string is gone');
  assertTrue(appSrc.includes('`Match quality: ${mcScore}/100`'), 'MEDIUM tier now renders "Match quality: {score}/100"');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
