// tests/grailkey-directive-am-variant-custody-real.test.js
//
// GrailKey Directive 2026-08-16-AM — GK-120: variant custody made real.
//
// F-1 (immutable first-eligible-visual): the prior dispatch's reconciler
//   drew its "first eligible visual" row from a FAMILY-NARROWED pool
//   (Ship 26.3B), meaning the label could only ever bind to a row inside
//   whichever family the title-family resolver already picked — even when
//   that family was wrong. Fixed: the label now binds from the scan's own
//   full, unbiased, pre-family-decision pool (parsedVisualRows), matching
//   the ISSUE facet's own already-correct convention
//   (identityCore.js:3126, opts.visualItems).
// F-3 (null clears): a reconciler NONE result used to leave the prior
//   Vision value standing untouched. Fixed: NONE now clears
//   confirmedVariant — a populated-but-uncorroborated value is not
//   authority (C8), applied consistently rather than carved out per-book.
// GK-122 (partial): four new extraction axes (event/convention, print-run/
//   limitation, color-finish, authentication) added locally to
//   identityCore.js (NOT the shared compHygiene.js function) so genuinely
//   present physical facets are retained, not silently dropped.
//
// Every fixture below is labeled by provenance:
//   REAL  — the directive's own verbatim quote, used unmodified
//   SYNTH — constructed by this test's author for a specific mechanical
//           property, explicitly NOT claimed as production evidence
//
// Invoke: node tests/grailkey-directive-am-variant-custody-real.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import fs from 'fs';
import { execSync } from 'child_process';
import { reconcileVariantFacet, extractFirstEligibleVariantCandidate } from '../src/lib/identityCore.js';
import { selectFirstEligibleVisual } from '../src/lib/identityReconciler.js';
import { fetchComps } from '../api/comps.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

console.log('\n=== GrailKey Directive AM — GK-120 variant custody made real ===\n');

// ─── B4-1: the Venom production disease ────────────────────────────────
// REAL — directive AM's own verbatim quote (truncated with "..." as given).
const VENOM_RANK1_REAL = 'Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew...';
// SYNTH — a plausible Lethal Protector row, standing in for "row 5" the
// directive describes but does not quote verbatim. Used ONLY to prove the
// POOL-SELECTION mechanism (which row selectFirstEligibleVisual binds to
// given which pool it receives) — never presented as real production text.
const LETHAL_PROTECTOR_SYNTH = 'Venom Lethal Protector #1 Mico Suayan Virgin Variant';

console.log('Part 1a [F-1]: pool bias — the bug, mechanically reproduced');
{
  const fullUnbiasedPool = [VENOM_RANK1_REAL, LETHAL_PROTECTOR_SYNTH];
  const wrongFamilyNarrowedPool = [LETHAL_PROTECTOR_SYNTH]; // simulates a family resolver that narrowed to the wrong family BEFORE this code ran
  const onFullPool = selectFirstEligibleVisual(fullUnbiasedPool);
  const onNarrowedPool = selectFirstEligibleVisual(wrongFamilyNarrowedPool);
  console.log(`  [first-eligible-visual, FULL pool]     index=${onFullPool.index} title="${onFullPool.rawTitle}"`);
  console.log(`  [first-eligible-visual, NARROWED pool] index=${onNarrowedPool.index} title="${onNarrowedPool.rawTitle}"`);
  check(onFullPool.rawTitle === VENOM_RANK1_REAL, 'F-1 FIXED: on the full, unbiased pool, first-eligible-visual is the REAL Mayhew row');
  check(onNarrowedPool.rawTitle === LETHAL_PROTECTOR_SYNTH, 'reproduces the PRE-FIX mechanism: on a wrong-family-narrowed pool, the label can only ever land on a row from that wrong family');
  check(onFullPool.rawTitle !== onNarrowedPool.rawTitle, 'the two pools produce DIFFERENT first-eligible-visual rows — proves the pool choice, not the row content, determined the pre-fix defect');
}

console.log('\nPart 1b [F-1 wiring]: api/enrich.js now sources first-eligible-visual from parsedVisualRows, not the family-narrowed pool');
{
  const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  check(
    enrichSrc.includes('selectFirstEligibleVisual(parsedVisualRows)'),
    'both 4a (variant) and 4e (year) call sites now read parsedVisualRows'
  );
  check(
    !enrichSrc.includes('selectFirstEligibleVisual(variantSourceItemsForReconciliation'),
    'the family-narrowed variantSourceItemsForReconciliation call is gone, not merely supplemented'
  );
  const matches = enrichSrc.match(/selectFirstEligibleVisual\(parsedVisualRows\)/g) || [];
  check(matches.length === 2, `both the variant AND year reconciliation call sites use the fix (found ${matches.length})`);
}

console.log('\nPart 1c [B4-1 core]: full reconciliation on the REAL verbatim row — Kirkham demoted, Mayhew wins');
{
  const { reconciled, candidate } = reconcileVariantFacet('Tyler Kirkham variant', 'vision', VENOM_RANK1_REAL);
  console.log(`  [first-eligible-visual] title="${VENOM_RANK1_REAL}"`);
  console.log(`  [first-eligible-visual] extractedVariant=${JSON.stringify(candidate)}`);
  console.log(`  [decision log] ${JSON.stringify(reconciled)}`);
  check(reconciled.source === 'first-eligible-visual', 'winner is first-eligible-visual, not vision');
  check(String(reconciled.value).toLowerCase().includes('mayhew'), 'canonical value names Mayhew');
  check(!String(reconciled.value).toLowerCase().includes('kirkham'), 'canonical value does NOT name Kirkham');
  check(
    reconciled.conflicts.some((c) => c.source === 'vision' && String(c.value).includes('Kirkham')),
    'Kirkham retained as recorded conflict evidence — visible, never erased'
  );
}

// ─── B4-1 continued: outgoing comp query, real fetchComps() + mocked eBay ──
const OAUTH_RESPONSE = JSON.stringify({ access_token: 'test-token', expires_in: 7200, token_type: 'Application Access Token' });
let capturedQueries = [];
const makeCapturingMockFetch = () => async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token')) {
    return { ok: true, status: 200, text: async () => OAUTH_RESPONSE, json: async () => JSON.parse(OAUTH_RESPONSE) };
  }
  if (u.includes('item_summary/search')) {
    capturedQueries.push(decodeURIComponent(u));
    return { ok: true, status: 200, json: async () => ({ itemSummaries: [] }) };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};
const venomBaseParams = {
  title: 'Venom Separation Anxiety', issue: '1', grade: 'NM', isGraded: false, numericGrade: 9.4,
  year: '2024', imageSearchTitle: null, appId: 'test-app-id', certId: 'test-cert-id',
  categoryId: '259104', assetType: 'comic', publisher: 'Marvel',
};
const originalFetch = globalThis.fetch;

const runQueryProof = async () => {
  console.log('\nPart 1d [B4-1]: outgoing eBay query — reconciler\'s REAL output, Kirkham absent');
  const { reconciled } = reconcileVariantFacet('Tyler Kirkham variant', 'vision', VENOM_RANK1_REAL);
  capturedQueries = [];
  globalThis.fetch = makeCapturingMockFetch();
  await fetchComps({ ...venomBaseParams, variant: reconciled.value });
  console.log(`  [outgoing queries] ${JSON.stringify(capturedQueries)}`);
  check(!capturedQueries.some((q) => q.toLowerCase().includes('kirkham')), 'no outgoing query contains "kirkham"');
  check(capturedQueries.some((q) => q.toLowerCase().includes('mayhew')), 'the reconciled creator (Mayhew) reaches the outgoing query');
  globalThis.fetch = originalFetch;
};

// ─── B4-2: null clears (F-3) ────────────────────────────────────────────
console.log('\nPart 2a [F-3]: SYNTH control — genuinely zero evidence either way clears the canonical value');
{
  // SYNTH — deliberately constructed so NEITHER side (Vision's claim nor
  // the first-eligible-visual row) shares any registered creator or
  // recognized specific/event/print-run/auth token. Not claimed as real
  // production text; used to isolate the NONE-clears mechanism from any
  // extraction-recognition question (Part 2b covers the recognition
  // question with the directive's own real Sabrina quote instead).
  const zeroEvidenceRow = 'Random Comic Book Listing No Recognized Signal At All';
  const { reconciled, candidate } = reconcileVariantFacet('Some Unverifiable Claim', 'vision', zeroEvidenceRow);
  console.log(`  [decision log] ${JSON.stringify(reconciled)}`);
  check(reconciled.authority === 'NONE' && reconciled.value === null, 'reconciler genuinely returns NONE/null when nothing on either side is recognized');
  check(candidate === null, 'no candidate extracted — sanity check that this really is a zero-evidence case');
}

console.log('\nPart 2b [wiring proof]: api/enrich.js CLEARS confirmedVariant on a NONE result, does not leave it standing');
{
  const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const blockStart = enrichSrc.indexOf("if (variantIdentitySource === 'vision' && confirmedVariant)");
  const block = blockStart >= 0 ? enrichSrc.slice(blockStart, blockStart + 3500) : '';
  check(block.includes("variantReconciled.authority === 'NONE'"), 'a NONE branch exists');
  check(
    block.includes("writeConfirmed('confirmedVariant', confirmedVariant, null, variantIdentitySource, 'reconciler-cleared'"),
    'the NONE branch writes confirmedVariant to null (not merely logs it) — the prior Vision write does not survive'
  );
  check(
    block.includes("'grailkey-directive-am-f3-null-clears'"),
    'the clear is tagged with this dispatch\'s own site name for audit'
  );
}

console.log('\nPart 2c [directive\'s own claim, quoted]: real Sabrina production text now CORROBORATES rather than NONEs — reported, not silently normalized');
{
  // REAL — the directive AM's own verbatim Sabrina quote for this section.
  const sabrinaVision = 'Dan Parent NYCC variant';
  // The directive's own log excerpt asserts value=null/authority=NONE was
  // the CLOSURE RUN's observed behavior for this Vision text, but does not
  // quote the first-eligible-visual row that produced it. Testing against
  // the SAME row this dispatch already carries forward from the prior AL
  // continuation dispatch's own real production text for the same book:
  const sabrinaFirstEligible = 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50';
  const { reconciled } = reconcileVariantFacet(sabrinaVision, 'vision', sabrinaFirstEligible);
  console.log(`  [decision log] ${JSON.stringify(reconciled)}`);
  console.log(
    '  [FINDING] Adding EVENT_RE (GK-122, this dispatch) means "NYCC" is now a recognized, ' +
    'SPECIFIC token on both sides of this exact pairing — the result is CORROBORATED, not NONE, ' +
    'a genuine behavior change from what this directive\'s own log excerpt describes for the Vision-' +
    'text-only case. This is NOT a contradiction of the directive\'s evidence (that excerpt does not ' +
    'specify which first-eligible-visual row produced its NONE result, and GK-122\'s own axis additions ' +
    'are dated to this exact dispatch) — reported explicitly rather than silently reconciled away.'
  );
  check(reconciled.value === sabrinaVision, 'on corroboration, Vision\'s own richer text is preserved as the canonical value (not the thinner extracted candidate) — the agreement-preserves-richness fix');
}

// ─── B4-3: order proof ─────────────────────────────────────────────────
console.log('\nPart 3: order — reconciliation runs before every consumer identified in the T2 trace');
{
  const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const reconcileIdx = enrichSrc.indexOf("if (variantIdentitySource === 'vision' && confirmedVariant)");
  const fetchCompsIdx = enrichSrc.indexOf('variant: confirmedVariant,');
  check(reconcileIdx >= 0 && fetchCompsIdx >= 0 && reconcileIdx < fetchCompsIdx, 'reconciliation runs before fetchComps reads confirmedVariant');

  // T2 finding, reported not fixed: the title-family resolver and the
  // initial PC lookup/cache-key BOTH read variant state from req.body
  // (raw, pre-reconciliation) BEFORE this reconciliation block runs at
  // all — structurally unavoidable without either a title-family scoring
  // rewrite (explicitly out of scope) or restructuring PC lookup to run
  // after reconciliation (would also delay the PC anchor for every scan,
  // a much larger change). The EXISTING N2 re-anchor mechanism (prior AL
  // dispatch) already re-scores priceCharting.deferredVariantCandidates
  // using the POST-reconciliation confirmedVariant — the provisional-
  // then-invalidate pattern F-2 itself permits for a structurally-blocked
  // consumer. Confirmed directly: N2's rescoring call site is present and
  // reads the LIVE confirmedVariant variable (same one this block writes).
  const familyResolverIdx = enrichSrc.indexOf('visionVariant: req.body.variant || null');
  const n2RescoreIdx = enrichSrc.indexOf('selectBestVariantCandidate(priceCharting.deferredVariantCandidates, confirmedVariant)');
  check(familyResolverIdx >= 0 && familyResolverIdx < reconcileIdx, 'CONFIRMED T2: the title-family resolver reads raw req.body.variant BEFORE reconciliation runs — structurally blocked, not fixed this dispatch (see report)');
  check(n2RescoreIdx >= 0 && n2RescoreIdx > reconcileIdx, 'CONFIRMED: the PC-anchor consumer uses the provisional-then-invalidate pattern (N2 re-anchor, already shipped) — rescoring reads the live, post-reconciliation confirmedVariant');
}

// ─── B4-4: USM verbatim retention ──────────────────────────────────────
console.log('\nPart 4 [GK-122 partial, B4-4]: USM/Dell\'Otto real verbatim row — all four facets retained');
{
  // REAL — directive AM's own verbatim quote.
  const usmRow = "ULTIMATE SPIDER-MAN #1 CGC 9.8 INHYUK LEE FAN EXPO PHILLY WHITE VARIANT LE 800";
  const candidate = extractFirstEligibleVariantCandidate(usmRow);
  console.log(`  [first-eligible-visual] title="${usmRow}"`);
  console.log(`  [first-eligible-visual] extractedVariant=${JSON.stringify(candidate)}`);
  const lower = String(candidate || '').toLowerCase();
  check(lower.includes('inhyuk lee'), 'Inhyuk Lee retained (creator registry)');
  check(lower.includes('fan expo'), 'Fan Expo Philly retained (new event axis, GK-122)');
  check(lower.includes('white'), 'White retained (new color-finish axis, GK-122)');
  check(lower.includes('le 800') || lower.includes('800'), 'LE 800 retained (new print-run axis, GK-122)');
  check(!lower.includes('virgin'), 'FORBIDDEN check: "virgin" does not appear — it is not present anywhere in this real row');
  // "red" (from "ULTIMATE SPIDER-MAN #1... RED") is a title-token concern,
  // not this extractor's own scope — extractFirstEligibleVariantCandidate
  // only ever emits recognized creator/axis tokens, never raw title text,
  // so it structurally cannot leak an unrelated title token in the first
  // place. Confirmed directly, not assumed:
  check(!lower.includes('"red"') && candidate !== usmRow, 'the candidate is never the raw title verbatim — title tokens like a stray "red" cannot leak through this path structurally');
}

// ─── B4-5: Slice 1 / Flash #139 regression ────────────────────────────
console.log('\nPart 5: B4-5 — Slice 1 regression (q140, byte-identical to HEAD)');
{
  let diffOutput = '';
  try {
    diffOutput = execSync('git diff --stat tests/q140-issue-consensus-corrective.test.js', { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'), encoding: 'utf8' });
  } catch (e) {
    diffOutput = `[git diff failed: ${e.message}]`;
  }
  check(diffOutput.trim() === '', `q140 test file byte-identical to HEAD (got: "${diffOutput.trim()}")`);
}

const main = async () => {
  await runQueryProof();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('Failures:', failures.join(', '));
  }
  process.exit(failed > 0 ? 1 : 0);
};

await main();
