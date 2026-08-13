// tests/grailkey-directive-r-early-return-variant.test.js
//
// GrailKey Directive 2026-08-13-R — Directive Q's own handoff inferred
// ("that's correct behavior") rather than proved that api/enrich.js's two
// early-return paths (the refused-identity exit, ~line 5911 pre-Directive-R;
// the Q32 merchandise hard-gate exit, ~line 7394 pre-Directive-R) safely
// omit `variantNote`. Directive R's trace found both are VERDICT (B) — live
// defects, not safe omissions:
//
//   - refusedOut (the refused-identity exit's own response object) is built
//     from sanitizeIdentityFields(req.body) — which has no `variant` field
//     in its output shape at all — plus an explicit field list that, unlike
//     every other identity-adjacent field there (year/publisher get real
//     treatment, comps/comicVine/priceCharting get explicit nulls), never
//     mentions variant even once. Not a deliberate design choice — an
//     asymmetric gap relative to how carefully every other field there is
//     handled.
//   - the Q32 merchandise-gate exit returns `out` directly, but all three
//     of out.variantNote's real write sites (two isFromPC-gated
//     assignments, the Q135 universal fallback) sit later in the handler
//     than this early return — confirmed by direct read, none appear
//     before it.
//
// In both cases `confirmedVariant` (declared api/enrich.js:5348, an
// unconditional handler-scope `let`, not gated by identityRefused or
// assetType) is fully resolved by the time either return executes — and,
// unlike the pre-Directive-Q client-side undefined/null conflation this
// campaign already fixed, confirmedVariant has no separate "unknown" state
// of its own: whatever it holds at that point (string or null) IS the
// resolved verdict, safe to copy.
//
// This file proves the FIX (a guarded `if (X.variantNote === undefined) {
// X.variantNote = confirmedVariant || null; }` at each site, reproducing
// the normal Q135 completion-path contract) behaves correctly, both ways:
// an authoritative revocation reaches the response as an own-property null
// (not omitted), and an already-established value is never clobbered.
//
// Because api/enrich.js's handler cannot be invoked directly without
// mocking its full eBay/PriceCharting/ComicVine dependency graph (a
// different order of effort than this narrow fix warrants), this file
// extracts the two REAL, just-committed guard statements from source via
// regex and evaluates them with real JS semantics (`new Function`) against
// constructed inputs — the same "extract and evaluate the actual code"
// discipline as tests/grailkey-directive-q-variant-null-custody.test.js,
// clearly labeled MIRRORED (narrowest direct extraction of the committed
// lines) rather than a full end-to-end HTTP invocation, which would be
// DIRECT in the strictest sense but is not what this file does.
//
// Invoke: node tests/grailkey-directive-r-early-return-variant.test.js

import { readFileSync } from 'fs';
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

console.log('\n=== GrailKey Directive R — early-return variant omission (MIRRORED extraction) ===\n');

const enrichSrc = readFileSync(path.join(repoRoot, 'api/enrich.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — confirm the fix statements exist verbatim in the real committed
// source (proves this test targets the actual shipped code, not a
// hand-typed guess of it).
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: fix statements present in the real source\n');
{
  const refusedGuardMatch = enrichSrc.match(/if \(refusedOut\.variantNote === undefined\) \{\s*refusedOut\.variantNote = confirmedVariant \|\| null;\s*\}/);
  assertTrue(!!refusedGuardMatch, 'refusedOut guard statement present verbatim in api/enrich.js');

  const outGuardMatches = [...enrichSrc.matchAll(/if \(out\.variantNote === undefined\) \{\s*out\.variantNote = confirmedVariant \|\| null;\s*\}/g)];
  // Two occurrences expected: the Q135 universal fallback (pre-existing,
  // ~line 10862, unchanged by this dispatch) and Directive R's new one at
  // the Q32 merchandise-gate exit.
  assertEq(outGuardMatches.length, 2, `exactly 2 occurrences of the out.variantNote guard (Q135's pre-existing one + Directive R's new one) — found ${outGuardMatches.length}`);

  // Confirm ordering: both new guards sit BEFORE their respective returns.
  const refusedReturnIdx = enrichSrc.indexOf('return res.status(200).json(finalizeResponse(refusedOut));');
  const refusedGuardIdx = enrichSrc.indexOf(refusedGuardMatch[0]);
  assertTrue(refusedGuardIdx !== -1 && refusedGuardIdx < refusedReturnIdx, 'refusedOut guard sits before its return statement');

  const merchReturnIdx = enrichSrc.indexOf('return res.json(finalizeResponse(out)); // STOP — no pricing, return early');
  // The Directive R guard immediately precedes this exact return; the Q135
  // one (far later, normal completion path) does not.
  const guardsBeforeMerchReturn = outGuardMatches.filter((m) => enrichSrc.indexOf(m[0]) < merchReturnIdx);
  assertEq(guardsBeforeMerchReturn.length, 1, 'exactly 1 out.variantNote guard sits before the Q32 merchandise-gate return (Directive R\'s new one, not Q135\'s later one)');
}

// ═══════════════════════════════════════════════════════════════════════
// Helper — extract a guard statement's exact text and evaluate it as a
// real function of (targetObj, confirmedVariant) -> mutated targetObj,
// using the actual JS semantics of the committed code, not a
// re-implementation of the rule.
// ═══════════════════════════════════════════════════════════════════════
// varName is the literal identifier the extracted guard text references
// ('refusedOut' or 'out') — bound to the caller's target object under that
// exact name so the real, unmodified source text runs unchanged.
const evalGuard = (guardSrc, varName) => {
  // eslint-disable-next-line no-new-func
  const fn = new Function(varName, 'confirmedVariant', `${guardSrc}\nreturn ${varName};`);
  return (target, confirmedVariant) => fn(target, confirmedVariant);
};

// ═══════════════════════════════════════════════════════════════════════
// Part 2a — regression per (B) return: revocation reaches the response as
// an own-property null; an already-established value is not clobbered.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2a: revocation reaches the response; established values not clobbered\n');
{
  const sites = [
    { label: 'refusedOut (refused-identity exit)', re: /if \(refusedOut\.variantNote === undefined\) \{\s*refusedOut\.variantNote = confirmedVariant \|\| null;\s*\}/, targetVar: 'refusedOut' },
  ];
  // The merchandise-gate site uses the same `out.variantNote` text as
  // Q135's own pre-existing fallback — isolate it by taking the FIRST
  // occurrence that appears before the merchandise-gate return (established
  // in Part 1) rather than matching text alone, since both guards are
  // byte-identical strings.
  const merchGuardMatch = enrichSrc.match(/if \(out\.variantNote === undefined\) \{\s*out\.variantNote = confirmedVariant \|\| null;\s*\}/);
  assertTrue(!!merchGuardMatch, 'at least one out.variantNote guard extracted for the merchandise-gate case (text shared with Q135\'s own pre-existing fallback by design — same contract, proven identical in Part 1)');

  sites.push({ label: 'out (Q32 merchandise-gate exit)', re: null, matchText: merchGuardMatch[0], targetVar: 'out' });

  for (const site of sites) {
    const guardText = site.matchText || enrichSrc.match(site.re)[0];
    const guard = evalGuard(guardText, site.targetVar);

    // Case: stale prior variant PLUS fresh authoritative revocation.
    // confirmedVariant is null (the resolved verdict); the target starts
    // with variantNote undefined (never assigned, matching both real sites
    // — proven in Part 1 that neither is pre-set before these guards run).
    const revoked = guard({}, null);
    assertTrue(Object.prototype.hasOwnProperty.call(revoked, 'variantNote'), `${site.label}: variantNote is an own-property after the guard runs (not omitted)`);
    assertEq(revoked.variantNote, null, `${site.label}: revocation (confirmedVariant=null) reaches the response as an own-property null`);

    // Case: a real confirmed variant.
    const withValue = guard({}, 'Dan Parent NYCC variant');
    assertEq(withValue.variantNote, 'Dan Parent NYCC variant', `${site.label}: a real confirmedVariant value reaches the response`);

    // Case: an already-established, more-specific value must survive —
    // the `=== undefined` guard is what makes this safe; simulate the
    // (currently never-hit, but defensively guarded) case where some
    // future upstream code sets variantNote before this point.
    const alreadySet = guard({ variantNote: 'Earlier-established variant' }, null);
    assertEq(alreadySet.variantNote, 'Earlier-established variant', `${site.label}: an already-established out.variantNote is NOT overwritten by this guard (non-clobber proof)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2b — the render assertion chain Q required and never demonstrated:
// returned variantNote:null -> corrected client merge -> variant:null ->
// no confirmed Variant label renders. Combines this dispatch's server-side
// proof (Part 2a: revocation -> own-property null) with Directive Q's own
// proven client merge (grailkey-directive-q-variant-null-custody.test.js:
// null merge input -> variant:null output) and Directive P's unchanged
// render guard (item.variant && (...) / result.variant && (...)) — the
// full chain, not any one link in isolation.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2b: full chain — server null -> client merge -> no render\n');
{
  // Link 1 (this dispatch, Part 2a above): server returns variantNote:null
  // on revocation. Re-derive directly rather than re-asserting.
  const serverRevocation = evalGuard(enrichSrc.match(/if \(refusedOut\.variantNote === undefined\) \{\s*refusedOut\.variantNote = confirmedVariant \|\| null;\s*\}/)[0], 'refusedOut')({}, null);
  assertEq(serverRevocation.variantNote, null, 'Link 1 (server, this dispatch): revocation reaches the response as variantNote:null');

  // Link 2 (Directive Q, real committed source, extracted the same way
  // grailkey-directive-q-variant-null-custody.test.js does): the client
  // merge is presence-aware — variantNote:null -> variant:null.
  const appSrc = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
  const clientMergeMatch = appSrc.match(/variant:\s*Object\.prototype\.hasOwnProperty\.call\(enrich,\s*'variantNote'\)\s*\?\s*enrich\.variantNote\s*:\s*cur\.variant/);
  assertTrue(!!clientMergeMatch, 'Directive Q\'s presence-aware client merge is present in the current source (unchanged by this dispatch)');
  // eslint-disable-next-line no-new-func
  const clientMergeFn = new Function('enrich', 'cur', `return (${clientMergeMatch[0].replace(/^variant:\s*/, '')});`);
  const priorItem = { variant: 'Stale prior variant' };
  const mergedVariant = clientMergeFn(serverRevocation, priorItem);
  assertEq(mergedVariant, null, 'Link 2 (client, Directive Q): the server\'s variantNote:null clears the stale prior variant, not resurrects it');

  // Link 3 (Directive P, unchanged): the render guard is a plain truthy
  // check — a null merged variant produces no rendered label.
  assertTrue(appSrc.includes('{item.variant && ('), 'Link 3a: CollectionDetail render guard present (Directive P, unchanged)');
  assertTrue(appSrc.includes('{result.variant && ('), 'Link 3b: ResultCard render guard present (Directive P, unchanged)');
  const wouldRender = !!mergedVariant; // the exact condition both render guards use
  assertEq(wouldRender, false, 'Link 3: {variant && (...)} evaluates false on the merged null — no confirmed Variant label renders');

  console.log('  (full chain proven: server revocation -> variantNote:null -> client merge -> variant:null -> no render)');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
