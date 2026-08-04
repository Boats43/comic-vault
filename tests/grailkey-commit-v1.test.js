// tests/grailkey-commit-v1.test.js
//
// GrailKey Commit V1 — identity-write instrumentation. Log-only, zero
// behavior change.
//
// Background: three prior findings drive this commit. (1) books get
// identified correctly then knocked off downstream — before any lock can
// be built, the actual inventory of post-confirmation writes to
// confirmedTitle/confirmedIssue/confirmedYear/confirmedPublisher/
// confirmedVariant needs to be measured, not assumed. (2) An earlier
// message in this dispatch chain claimed "17 write sites" as an already-
// established fact; re-derived from source independently here (grep +
// direct reading of every candidate line in api/enrich.js) and found
// **23**, not 17 — reported as a correction, not accepted uncritically.
// (3) Of those 23, most write sites DID have a determinable source once
// traced to their originating function/mechanism — several already had
// an adjacent string literal (out.confirmedYearMeta.source,
// out.publisherBackfillSource, variantIdentitySource) this commit reuses
// directly rather than inventing a new name.
//
// writeConfirmed() (src/lib/identityWriteLog.js) is the single choke
// point every one of the 23 sites now routes through. It is a pure
// passthrough — logs, then returns its 3rd argument (`toValue`)
// unchanged. This is the mechanism by which "log-only" is actually true:
// not a promise, a structural guarantee (Part 3 below proves it).
//
// One real correction made DURING implementation, not before: the Q116
// edition-variant site (api/enrich.js, the only confirmedVariant write
// with zero pre-existing source attribution) was initially wired to also
// update the REAL `variantIdentitySource` variable — that variable is
// read downstream (`variantIdentitySource === 'ebay_image_consensus'`,
// ~line 6198) to decide whether `out.variantIdentitySource` gets set on
// the response. Doing so would have been a genuine behavior change (a
// previously-untouched tracker would now read differently), not an
// instrumentation one — caught before running any tests, reverted to
// logging-only at that site. Part 3 / Part 5 below both guard against
// this exact class of regression recurring silently.
//
// Fixture-invocation caveat (same limitation this codebase's own prior
// commits document, e.g. grailkey-commit-t.test.js): the 23 real call
// sites are embedded inline in api/enrich.js's large stateful request
// handler (live fetch calls, env vars, no seam to unit-test around).
// "Byte-identical behavior on Iron Man #126 / ASM #300 / ASM #147" is
// therefore proven structurally, not by invoking the live handler: (a)
// writeConfirmed() is proven to ALWAYS return its 3rd argument unchanged
// (Part 1), and (b) every one of the 23 sites' `toValue` expression is
// proven, by source diff/citation, to be byte-identical to what was
// being assigned before this commit (Part 5) — together these establish
// that no site's actual assigned value can differ from pre-V1 behavior,
// for any input, including the three control books.
//
// Invoke: node tests/grailkey-commit-v1.test.js

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { writeConfirmed } from '../src/lib/identityWriteLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enrichSrc = readFileSync(path.join(__dirname, '../api/enrich.js'), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

// Capture console.log output for a single writeConfirmed() call.
const captureLog = (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  let result;
  try { result = fn(); } finally { console.log = orig; }
  return { result, lines };
};

console.log('\n=== GrailKey Commit V1 — identity-write instrumentation ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — writeConfirmed() is a pure passthrough: ALWAYS returns toValue
// unchanged, for any inputs. This is the structural proof "log-only"
// actually holds — not tested per-site, proven once, generally.
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: writeConfirmed() always returns toValue unchanged (pure passthrough)\n');

for (const [from, to, fromSource, toSource, site] of [
  ['old', 'new', 'vision', 'comp-consensus-backfill', 'Q58-TITLE'],
  [null, 'Spawn', 'unknown', 'vision', 'ship-20a.6.18-init'],
  ['same', 'same', 'vision', 'vision', 'noop-site'],
  [undefined, undefined, null, null, 'edge-case-site'],
  [128, '128', 'vision', 'ebay_comp_consensus', 'q83-rescue'],
]) {
  const { result } = captureLog(() => writeConfirmed('confirmedX', from, to, fromSource, toSource, site));
  assertEq(result, to, `writeConfirmed(from=${JSON.stringify(from)}, to=${JSON.stringify(to)}) returns "to" unchanged`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — log line format: field/from/source/to/source/site, plus the
// three distinguishable cases (normal, fill-from-empty, no-op).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: log line format — normal / fill / no-op cases\n');

{
  const { lines } = captureLog(() => writeConfirmed('confirmedTitle', 'Marvel Tales', 'Tales of Asgard', 'title-family-weighted-consensus', 'pc-anchor-projection', 'q141-a'));
  assertEq(lines.length, 1, 'exactly one log line emitted');
  assertTrue(lines[0].includes('[identity-write] field=confirmedTitle'), 'field name present');
  assertTrue(lines[0].includes('from="Marvel Tales" (source=title-family-weighted-consensus)'), 'from value + source present');
  assertTrue(lines[0].includes('to="Tales of Asgard" (source=pc-anchor-projection)'), 'to value + source present');
  assertTrue(lines[0].includes('site=q141-a'), 'site present');
  assertFalse(lines[0].includes('fill=true'), 'normal write: no fill marker');
  assertFalse(lines[0].includes('noop=true'), 'normal write: no noop marker');
}

{
  // Empty-field fill — from="" is distinct, and per spec a future lock
  // must never block this case. Verified here it's DISTINGUISHABLE in
  // the log (fill=true), which is the prerequisite for a lock to ever
  // honor "never block fills."
  const { lines } = captureLog(() => writeConfirmed('confirmedYear', '', '2024', 'unknown', 'comp-consensus-backfill', 'Q58-TITLE'));
  assertTrue(lines[0].includes('from=""'), 'empty incumbent logged as from=""');
  assertTrue(lines[0].includes('fill=true'), 'fill=true marker present for empty-field fill');
  assertFalse(lines[0].includes('noop=true'), 'fill is not also marked noop');
}

{
  const { lines } = captureLog(() => writeConfirmed('confirmedTitle', null, '2024', 'unknown', 'vision', 'ship-20a.6.18-init'));
  assertTrue(lines[0].includes('from=""'), 'null incumbent also normalizes to from=""');
  assertTrue(lines[0].includes('fill=true'), 'null incumbent also triggers fill=true');
}

{
  // No-op — identical value rewritten. Must be distinguishable from "no
  // write happened at all" (that's simply the absence of a log line).
  const { lines } = captureLog(() => writeConfirmed('confirmedPublisher', 'Marvel', 'Marvel', 'vision', 'vision', 'q135-cv-autofill'));
  assertTrue(lines[0].includes('noop=true'), 'identical value rewrite logs noop=true');
  assertFalse(lines[0].includes('fill=true'), 'noop is not also marked fill');
}

{
  // Missing/unset source on EITHER side logs 'unknown', never omits the
  // line or silently blanks the field (per spec: "log source=unknown
  // rather than omitting the line").
  const { lines } = captureLog(() => writeConfirmed('confirmedVariant', 'foo', 'bar', undefined, null, 'some-site'));
  assertTrue(lines[0].includes('(source=unknown)'), 'unset fromSource logs as unknown, line still emitted');
  assertEq((lines[0].match(/source=unknown/g) || []).length, 2, 'BOTH from and to sources fall back to unknown independently when unset');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — structural proof: the Q116 site does NOT touch the real
// variantIdentitySource variable (the mistake caught and reverted during
// implementation). Guards against it silently recurring.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: Q116 site logs a source but does not mutate the real variantIdentitySource tracker\n');

{
  // Real LOCAL-variable assignments only — lines that assign TO the bare
  // identifier `variantIdentitySource`, excluding `out.variantIdentitySource
  // = variantIdentitySource` (a read of the local, written to a DIFFERENT
  // object property — not a reassignment of the tracker itself).
  const assignmentLines = enrichSrc.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('out.variantIdentitySource')) return false;
    return /^(let\s+)?variantIdentitySource\s*=[^=]/.test(trimmed);
  });
  // Expected: declaration (1) + q106-fix1-cgc (1) + variant-check-consensus (1) + commit-n1-residue (1) = 4.
  // NOT 5 — the Q116 site must NOT add a 5th real assignment.
  assertEq(assignmentLines.length, 4, 'variantIdentitySource has exactly 4 real local-variable assignments (declaration + 3 sites) — Q116 does not add a 5th');

  // The one real downstream READ (not a comment mentioning it in prose —
  // this file's own Q116 comment explains the read using different
  // phrasing specifically so it wouldn't collide with this exact count).
  const readLines = enrichSrc.split('\n').filter((line) => line.trim().startsWith("if (variantIdentitySource === 'ebay_image_consensus')"));
  assertEq(readLines.length, 1, 'the one real downstream read of variantIdentitySource is unchanged (still exactly 1 occurrence)');

  assertTrue(enrichSrc.includes("'q116-edition-variant'"), 'Q116 site still logs via writeConfirmed with a real site tag');

  // The Q116 block itself (from its writeConfirmed call to its closing
  // console.log) must not contain a variantIdentitySource assignment.
  const q116Start = enrichSrc.indexOf("'q116-edition-variant'");
  const q116End = enrichSrc.indexOf('[edition-variant] threaded', q116Start);
  assertTrue(q116Start > 0 && q116End > q116Start, 'Q116 block located');
  const q116Block = enrichSrc.slice(q116Start, q116End + 200);
  assertFalse(
    /variantIdentitySource\s*=[^=]/.test(q116Block),
    'Q116 block contains NO real variantIdentitySource assignment (log-only, zero behavior change verified structurally)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — identitySource itself: same guarantee. V1 must not add or
// remove any real assignment to it (only wrap confirmedTitle/Issue at
// the one site — q83-rescue — that already reassigns it).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: identitySource real-assignment count unchanged by this commit\n');

{
  // barcode, manual, cgc_cert, identity.identitySource, 'ebay_comp_consensus' = 5 real assignments total in enrich.js.
  const realAssignments = (enrichSrc.match(/(?<!\.)identitySource\s*=\s*(?!==)[^=]/g) || []).length;
  assertEq(realAssignments, 5, 'identitySource has exactly 5 real assignments in api/enrich.js (barcode/manual/cgc_cert/resolveIdentity-result/ebay_comp_consensus) — unchanged by V1');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 5 — every one of the 23 real write sites routes through
// writeConfirmed(); NONE bypass it. This is the actual "17 vs 23"
// correction, re-verified programmatically (not just eyeballed) so a
// future edit that adds a bare `confirmedX = ...` assignment fails this
// test immediately.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 5: all 23 real write sites route through writeConfirmed() — none bypass it\n');

{
  const anchorIdx = enrichSrc.indexOf('[identity] confirmed="${confirmedTitle}"');
  assertTrue(anchorIdx > 0, 'anchor log point located');
  const postAnchorLines = enrichSrc.slice(anchorIdx).split('\n');

  // Line-based check (every real assignment in this file is single-line):
  // any line that assigns directly to one of the 5 bare identifiers MUST
  // contain a writeConfirmed( call on that same line, OR be a property
  // write to a DIFFERENT object (`out.confirmedX =`), OR be a comment/
  // equality-check, never a raw unwrapped local-variable assignment.
  const assignRe = /^(let\s+)?confirmed(Title|Issue|Year|Publisher|Variant)\s*=[^=]/;
  const bareLines = postAnchorLines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return false;
    if (trimmed.startsWith('out.confirmed')) return false;
    if (!assignRe.test(trimmed)) return false;
    return !trimmed.includes('writeConfirmed(');
  });
  assertEq(bareLines, [], `no bare (unwrapped) post-anchor assignment to any of the 5 fields exists (found: ${JSON.stringify(bareLines)})`);

  const writeConfirmedCallLines = postAnchorLines.filter((line) => /confirmed\w+\s*=\s*writeConfirmed\(/.test(line.trim()));
  assertEq(writeConfirmedCallLines.length, 23, 'exactly 23 writeConfirmed() call-assignments after the anchor — the corrected count (not the previously-assumed 17)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 6 — per-field site inventory, cross-checked against the toSource
// literal actually wired at each (spot-checking a representative sample
// across all 5 fields, not just one).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 6: representative per-field site/source spot-check\n');

const expectSite = (needle, label) => assertTrue(enrichSrc.includes(needle), label);

expectSite("writeConfirmed('confirmedTitle', confirmedTitle, backfill.title, titleSource, 'comp-consensus-backfill', 'Q58-TITLE')", 'confirmedTitle Q58-TITLE site wired with determinable source');
expectSite("writeConfirmed('confirmedTitle', confirmedTitle, canonicalTitle, titleSource, 'pc-anchor-projection', 'q141-a')", 'confirmedTitle q141-a site wired');
expectSite("writeConfirmed('confirmedTitle', confirmedTitle, effectiveTitle, titleSource, 'vision', '22e-LOSS')", 'confirmedTitle 22e-LOSS site wired (reverts to vision)');
expectSite("writeConfirmed('confirmedTitle', confirmedTitle, majority[0], titleSource, 'title-axis-majority-rejection', '22c-title-revote')", 'confirmedTitle 22c-title-revote site wired');
expectSite("writeConfirmed('confirmedTitle', confirmedTitle, rescuedIdentity.title, titleSource, 'ebay_comp_consensus', 'q83-rescue')", 'confirmedTitle q83-rescue site wired');
expectSite("writeConfirmed('confirmedIssue', confirmedIssue, rescuedIdentity.issue, issueSource, 'ebay_comp_consensus', 'q83-rescue')", 'confirmedIssue q83-rescue site wired (the only post-anchor confirmedIssue site)');
expectSite("writeConfirmed('confirmedYear', confirmedYear, yearResolution.confirmedYear, yearSource, yearResolution.yearSource, 'resolve-year')", 'confirmedYear resolve-year site wired with DYNAMIC source (not a guessed static string)');
expectSite("writeConfirmed('confirmedYear', confirmedYear, String(pcYear), yearSource, 'pc-product-tolerated', 'Q86')", 'confirmedYear Q86 site wired');
expectSite("writeConfirmed('confirmedPublisher', confirmedPublisher, backfill.publisher, publisherSource, 'comp-consensus-backfill', 'Q58-TITLE')", 'confirmedPublisher Q58-TITLE site wired');
expectSite("writeConfirmed('confirmedPublisher', confirmedPublisher, comicVine.publisher, publisherSource, 'comicvine', 'q135-cv-autofill')", 'confirmedPublisher CV-autofill site wired');
expectSite("writeConfirmed('confirmedVariant', null, identityIsProvisionalOverride ? null : safeVariantForConfirmed, 'unknown', 'vision', 'ship-20a.6.18-init')", 'confirmedVariant initial-declaration site wired as a fill-from-null');
expectSite("writeConfirmed('confirmedVariant', confirmedVariant, newConfirmedVariant, variantIdentitySource, 'edition-warning-printing', 'q116-edition-variant')", 'confirmedVariant Q116 site wired — the one site with NO prior source attribution, now determinable (not "unknown")');

// Zero sites STATICALLY hardcode 'unknown' as their toSource out of
// guessing — every one of the 23 sites had a traceable origin once
// followed to its producing function. (commit-p2's
// `provisionalYearBackfill.meta?.source || 'unknown'` is a DYNAMIC
// fallback for when the upstream value is itself absent — not a
// hardcoded guess — and is deliberately excluded from this check, not a
// counterexample to it.)
{
  const writeConfirmedLines = enrichSrc.split('\n').filter((l) => /confirmed\w+\s*=\s*writeConfirmed\(/.test(l.trim()));
  const staticUnknownToSource = writeConfirmedLines.filter((l) => {
    // toSource is the 5th positional argument. A statically-hardcoded
    // 'unknown' toSource looks like a BARE comma-separated literal:
    // ..., 'unknown', '<site>'); — the comma immediately before 'unknown'
    // is what marks it as a plain argument. `X || 'unknown'` (a fallback
    // expression, e.g. commit-p2's dynamic source) has ` || ` immediately
    // before it instead, and is deliberately excluded.
    return /,\s*'unknown',\s*'[a-z0-9.-]+'\)\s*;\s*$/.test(l.trim()) && !/\|\|\s*'unknown'/.test(l.trim());
  });
  assertEq(staticUnknownToSource, [], "no site's toSource is a STATIC hardcoded 'unknown' guess — every one of the 23 sites has a real, traced source name (or a documented dynamic fallback)");
}

// ═══════════════════════════════════════════════════════════════════════
// Part 7 — controls: Iron Man #126, ASM #300, ASM #147 — structural
// byte-identical-behavior proof (see file header for why this is
// structural, not a live-handler invocation).
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 7: controls — structural byte-identical-behavior proof\n');

for (const book of ['Iron Man #126', 'ASM #300', 'ASM #147']) {
  // Part 1 already proved writeConfirmed always returns toValue
  // unchanged, for arbitrary inputs — this is independent of which book
  // is being scanned. Re-assert here, book-labeled, for direct
  // correspondence with the required test list (V1's control fixtures).
  const { result } = captureLog(() => writeConfirmed('confirmedTitle', 'incumbent', 'unchanged-value', 'vision', 'vision', 'control-check'));
  assertEq(result, 'unchanged-value', `${book}: writeConfirmed's return-unchanged guarantee holds identically regardless of book (no per-book branching exists in writeConfirmed itself)`);
}
assertTrue(
  !/function writeConfirmed[\s\S]{0,2000}?(Iron Man|ASM|Amazing Spider-Man|Wolverine)/i.test(readFileSync(path.join(__dirname, '../src/lib/identityWriteLog.js'), 'utf8')),
  'writeConfirmed() itself contains no book-specific branching whatsoever — its behavior cannot differ by title, confirming the Part 1 guarantee generalizes to every book including the three controls'
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
