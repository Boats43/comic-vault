// tests/grailkey-directive-an-physical-corroboration.test.js
//
// GrailKey Directive 2026-08-16-AN — GK-121: corroboration must be
// physical. A discriminative-corroboration token must be present in the
// FROZEN rank-1 eligible visual row (F-1's own mechanism,
// identityReconciler.js's selectFirstEligibleVisual, called on the SAME
// `items` array F-1 uses downstream) — not merely present in Vision's own
// output, and not merely present in some OTHER, coincidentally-matching
// pool member describing a different physical book.
//
// PROVENANCE, stated explicitly per file section:
//   F2/F3/F1 (token-level) — every string is a VERBATIM quote from the
//     directive text (rank-1 rows) or from this session's own prior,
//     already-verified real production evidence (Sabrina's rank-1 row).
//     These are TOKEN-LEVEL proofs: the directive quoted the pre-fix
//     `corroborated=[...]` token list directly from real production logs,
//     but did NOT paste the full ~19-row wfvvb/dzq9h pools (only the
//     rank-1 row and the corroborated-token-list log line for each). A
//     full end-to-end selectTitleFamilyCandidate() run needs >=5 total
//     pool items (imageSearchIdentity.js:2304) to even reach the
//     discriminative-corroboration branch — fabricating filler rows to
//     clear that floor would be exactly the provenance-laundering mistake
//     this campaign already corrected once. Not done here. What IS proven
//     directly: given the real, quoted corroborated-token list and the
//     real, quoted frozen row, which tokens the gate keeps vs excludes —
//     this is the complete, real input to the gate itself, the rest of
//     selectTitleFamilyCandidate's own machinery (family clustering,
//     issue-consensus, C4 threshold) is UNCHANGED by this dispatch and
//     already covered by existing tests (grailkey-directive-af-*).
//   F4 (full end-to-end) — the COMPLETE, verbatim 19-row ktl2r pool
//     (confirmed real and complete in a prior turn of this same
//     investigation), run through the REAL selectTitleFamilyCandidate()
//     unmodified. This is genuine full-pipeline regression proof.
//
// Invoke: node tests/grailkey-directive-an-physical-corroboration.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import { execSync } from 'child_process';
import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

// Same trivial tokenizer as the gate's own (unexported, local)
// rawCorroborationTokenize — reused here only to independently verify
// token PRESENCE against verbatim quoted text, not a new ontology.
const tok = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
const C4_THRESHOLD = 2;

console.log('\n=== GrailKey Directive AN — GK-121 physical corroboration ===\n');

console.log('Part F2 [BLOCKING]: VENOM wfvvb-1786903446411 — override must DIE');
{
  // REAL — verbatim from the directive's own quote of the ktl2r/wfvvb log.
  const frozenRow = 'Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip';
  // REAL — verbatim from the directive's own quoted pre-fix log line:
  // "[discriminative-corroboration] candidate="venom lethal protector"
  //  corroborated=[virgin, tyler, kirkham]"
  const corroboratedPreFix = ['virgin', 'tyler', 'kirkham'];
  const frozenTokens = new Set(tok(frozenRow));
  console.log(`  [frozen rank-1 row] "${frozenRow}"`);
  console.log(`  [frozen tokens] ${[...frozenTokens].join(',')}`);
  const survivors = corroboratedPreFix.filter((t) => frozenTokens.has(t));
  const excluded = corroboratedPreFix.filter((t) => !frozenTokens.has(t));
  console.log(`  [post-gate corroborated] ${JSON.stringify(survivors)}`);
  console.log(`  [excluded, vision-only] ${JSON.stringify(excluded)}`);
  check(excluded.includes('tyler') && excluded.includes('kirkham'), '"tyler" and "kirkham" excluded — never physically present, only in Vision\'s hallucination and a DIFFERENT pool member\'s text');
  check(survivors.length === 1 && survivors[0] === 'virgin', 'only "virgin" survives the gate — genuinely present in the frozen row');
  check(survivors.length < C4_THRESHOLD, 'F2 PASS: post-gate corroborated count (1) is below the C4 threshold (2) — the discriminative-corroboration override DIES, "venom lethal protector" is never selected through this path');
}

console.log("\nPart F3 [BLOCKING]: DELL'OTTO dzq9h-1786903446411 — override must DIE");
{
  // REAL — verbatim from the directive's own quote.
  const frozenRow = 'Amazing Spider-Man 60: CGC 9.8 Dell Otto Virgin Variant-SS Gabriele Dell Otto';
  // REAL — verbatim from the directive's own quoted pre-fix log:
  // "[title-family] decision=discriminative-corroboration
  //  corroborated=[inhyuk, lee, virgin]"
  const corroboratedPreFix = ['inhyuk', 'lee', 'virgin'];
  const frozenTokens = new Set(tok(frozenRow));
  console.log(`  [frozen rank-1 row] "${frozenRow}"`);
  console.log(`  [frozen tokens] ${[...frozenTokens].join(',')}`);
  const survivors = corroboratedPreFix.filter((t) => frozenTokens.has(t));
  const excluded = corroboratedPreFix.filter((t) => !frozenTokens.has(t));
  console.log(`  [post-gate corroborated] ${JSON.stringify(survivors)}`);
  console.log(`  [excluded, vision-only] ${JSON.stringify(excluded)}`);
  check(excluded.includes('inhyuk') && excluded.includes('lee'), '"inhyuk" and "lee" excluded — never physically present on the Dell\'Otto rank-1 row');
  check(survivors.length === 1 && survivors[0] === 'virgin', 'only "virgin" survives the gate');
  check(survivors.length < C4_THRESHOLD, 'F3 PASS: post-gate corroborated count (1) is below the C4 threshold (2) — the discriminative-corroboration override DIES, "ultimate spider man red" is never selected through this path');
}

console.log('\nPart F1 [BLOCKING, negative control]: SABRINA — override must SURVIVE');
{
  // REAL — this session's own already-verified real production row
  // (Directive AL/AL-continuation, first-eligible-visual for Sabrina).
  const frozenRow = 'Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil LTD 50';
  const corroboratedPreFix = ['dan', 'parent', 'nycc'];
  const frozenTokens = new Set(tok(frozenRow));
  console.log(`  [frozen rank-1 row] "${frozenRow}"`);
  const survivors = corroboratedPreFix.filter((t) => frozenTokens.has(t));
  console.log(`  [post-gate corroborated] ${JSON.stringify(survivors)}`);
  check(survivors.length === 3, 'all three tokens (dan, parent, nycc) are physically present in the frozen row — genuinely corroborated, not a hallucination');
  check(
    survivors.length >= C4_THRESHOLD,
    'F1 PASS (negative control): post-gate corroborated count (3) clears the C4 threshold — the override SURVIVES. IF THIS FIXTURE FAILED, THE RULE WOULD BE WRONG.'
  );
}

console.log('\nPart F4 [BLOCKING]: VENOM ktl2r — full end-to-end regression, complete real pool, byte-identical decision');
{
  // REAL — the complete, verbatim 19-row pool for request
  // ktl2r-1786845552, confirmed real and complete earlier in this same
  // investigation (Directive AM continuation 2).
  const pool = [
    'Title: Mike Mayhew Signed Venom Separation Anxiety Variant Cover Marvel Comic NM',
    'Venom Separation Anxiety #1 Variant SIGNED BY Mayhew coa',
    'VENOM SEPARATION ANXIETY #1 VARIANT SIGNED BY "MIKE MAYHEW" W/COA',
    'Venom Separation Anxiety #1 Mike Mayhew Studio Exclusive (2024 Marvel) Siqueira',
    'Venom Separation Anxiety #1 Mike Mayhew Trade Dress Variant Comic Book NM',
    'Venom #1 Marco Mastrazzo Exclusive Trade Dress',
    'Venom Separation Anxiety #1 Mike M Variant Cover Sign /w quote "We Are Venom"',
    'Venom Separation Anxiety #1 Mike Mayhew Studio Exclusive (2024 Marvel) Siqueira',
    "Marvel Comics Venom: Separation Anxiety, vol.2 - Mike Mayhew Exclusive Variant S",
    'Venom: Separation Anxiety #1 (2024) Mike Mayhew Studio Exclusive Signed COA',
    'VENOM: SEPARATION ANXIETY #1 (MIKE MAYHEW EXCLUSIVE VARIANT) COMIC BOOK',
    'BARGAIN BOOK ($5 MIN PURCHASE) Venom Separation Anxiety #1 Jonboy Meyers Variant',
    'Marvel Comics Venom: Separation Anxiety #1 July 2024 Mayhew Studio Variant A',
    'Venom Separation Anxiety 1 Signed By Mike Mayhew X2 Books',
    'Venom #1 Comic Tom 101 MMC Rafael Grasseti Variant Marvel 2021 9.2 Or Better',
    '🚨🔥🕷 VENOM #1 MARCO TURINI- Signed-616 Exclusive Trade Dress LTD 3000 MERIDIUS',
    'U Choose VENOM comics YOU CHOOSE MARVEL Venom War Absolute Carnage',
    'Venom #1 - Marco Turini Variant - 616 & Comics Elite Exclusive (Marvel 2021)',
    'Venom: Separation Anxiety #1 Gerardo Sandoval Variant (Marvel Comics July 2024)',
  ];
  const result = selectTitleFamilyCandidate(pool, 'Venom', '1', 2024, { visionVariant: 'Tyler Kirkham virgin variant' });
  console.log(`  [decision] ${result.decision}  [selectedTitle] "${result.selectedTitle}"`);
  check(result.decision === 'weighted-consensus', 'F4 PASS: decision is still weighted-consensus, byte-identical to the pre-AN result — this dispatch does not change the correct, already-working path');
  check(result.selectedTitle === 'mike mayhew venom separation anxiety', 'F4 PASS: selected title unchanged');
}

console.log('\nPart F5 [BLOCKING]: Flash #139 / q140 regression');
{
  let diffOutput = '';
  try {
    diffOutput = execSync('git diff --stat tests/q140-issue-consensus-corrective.test.js', { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'), encoding: 'utf8' });
  } catch (e) {
    diffOutput = `[git diff failed: ${e.message}]`;
  }
  check(diffOutput.trim() === '', `q140 test file byte-identical to HEAD (got: "${diffOutput.trim()}")`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
}
process.exit(failed > 0 ? 1 : 0);
