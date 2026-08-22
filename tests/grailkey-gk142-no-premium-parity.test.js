// tests/grailkey-gk142-no-premium-parity.test.js
//
// GK-142, Phase 0.3 push-gate item 2 — vocabulary-drift correction.
//
// deriveSeriesCoreQuery (src/lib/identityCore.js) needs the SAME cover-
// descriptor token list api/enrich.js's own pricing gate already uses
// (NO_PREMIUM, ~api/enrich.js:9136 — the "Variant multipliers" / "NO_PREMIUM
// list" CLAUDE.md documents as pricing math). Centralizing into ONE
// constant both sites import would require editing enrich.js's own
// declaration site inside that protected block — even a byte-identical-
// behavior hoist (same values, same usage) still touches the file the
// standing pricing-math-greenlight protocol names explicitly, and that
// greenlight was never given for this dispatch. So the two vocabularies
// deliberately stay as two separate literals — NO_PREMIUM_COVER_DESCRIPTORS
// (compHygiene.js, query-projection use only) and enrich.js's own
// NO_PREMIUM (pricing gate, untouched) — and THIS test is the parity
// enforcement that makes silent drift between them impossible: it reads
// enrich.js's actual source text, extracts the real NO_PREMIUM array
// literal (not a copy of it — the actual bytes shipping in that file right
// now), and fails the moment the two lists diverge in either direction.
//
// If this test ever fails, the fix is NOT to edit this test — it's to
// update src/lib/compHygiene.js's NO_PREMIUM_COVER_DESCRIPTORS to match
// whatever api/enrich.js's NO_PREMIUM now reads (that edit touches
// compHygiene.js only, never api/enrich.js's pricing block).
//
// Invoke: node tests/grailkey-gk142-no-premium-parity.test.js

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { NO_PREMIUM_COVER_DESCRIPTORS } from '../src/lib/compHygiene.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GK-142 parity: NO_PREMIUM (pricing) vs NO_PREMIUM_COVER_DESCRIPTORS (query projection) ===\n');

const enrichSource = readFileSync(path.join(__dirname, '../api/enrich.js'), 'utf8');

// Extract the REAL, currently-shipping NO_PREMIUM array literal from
// enrich.js's own source text — not a hand-copied guess at it.
const match = enrichSource.match(/const NO_PREMIUM = \[([\s\S]*?)\];/);
assertTrue(!!match, 'NO_PREMIUM array literal found in api/enrich.js source (extraction regex still matches the live declaration)');

if (match) {
  // The captured group is JS array-literal body text ('a', 'b', ... on
  // possibly-multiple lines) — parse it as JSON after normalizing quotes,
  // rather than eval'ing arbitrary source text.
  const bodyText = match[1];
  const tokens = bodyText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'));

  console.log(`  enrich.js NO_PREMIUM (extracted, ${tokens.length} tokens): ${JSON.stringify(tokens)}`);
  console.log(`  compHygiene.js NO_PREMIUM_COVER_DESCRIPTORS (${NO_PREMIUM_COVER_DESCRIPTORS.length} tokens): ${JSON.stringify(NO_PREMIUM_COVER_DESCRIPTORS)}`);

  assertTrue(
    tokens.length === NO_PREMIUM_COVER_DESCRIPTORS.length,
    `SHIP-BLOCKING: same token count (pricing=${tokens.length}, query-projection=${NO_PREMIUM_COVER_DESCRIPTORS.length})`
  );

  const pricingSet = new Set(tokens);
  const projectionSet = new Set(NO_PREMIUM_COVER_DESCRIPTORS);
  const missingFromProjection = tokens.filter((t) => !projectionSet.has(t));
  const missingFromPricing = NO_PREMIUM_COVER_DESCRIPTORS.filter((t) => !pricingSet.has(t));

  assertTrue(
    missingFromProjection.length === 0,
    `SHIP-BLOCKING: every pricing NO_PREMIUM token is present in the query-projection vocabulary (missing: ${JSON.stringify(missingFromProjection)})`
  );
  assertTrue(
    missingFromPricing.length === 0,
    `SHIP-BLOCKING: every query-projection token is present in the pricing NO_PREMIUM vocabulary (extra: ${JSON.stringify(missingFromPricing)})`
  );
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
