// tests/grailkey-dispatch-20-fix5-decline-logging.test.js
//
// GrailKey Dispatch 20 (2026-08-07) — Fix 5 decline-path logging.
//
// Dispatch 19 shipped shouldLiftAssetTypeAdvisoryLock with a disclosed,
// honest gap: its own motivating scan (Spawn #351) wouldn't have
// qualified under its own bar, so the fix landed production-unvalidated.
// The call site already logged both the fire path AND the decline path
// (verified here, not assumed) — this dispatch's job was to make the
// decline log diagnostically useful for a future batch sweep ("does this
// ever actually fire"), not to add logging that was missing. Adds a
// `blockedBy` reason breakdown so a log sweep doesn't need to
// hand-recompute which specific sub-condition failed from raw ratios
// alone, and surfaces merchandiseRatio explicitly (previously only
// comicVotes/comicRatio/coherent were shown).

import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== GrailKey Dispatch 20 — Fix 5 decline-path logging ===\n');

const enrichSource = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
// Isolate the fire-path and decline-path console.log calls specifically
// (not the whole file) so a match proves these strings sit together in
// the actual log statements, not scattered coincidentally elsewhere.
const fireLogMatch = enrichSource.match(/console\.log\(\s*\n\s*`\[Q32-asset-type-override\] lifting advisory lock:[\s\S]*?\);/);
const declineLogMatch = enrichSource.match(/console\.log\(\s*\n\s*`\[Q32-asset-type-override\] declined:[\s\S]*?\);/);
const declineLog = declineLogMatch?.[0] || '';
const blockedByComputation = enrichSource.match(/const blockedBy = \[\];[\s\S]*?blockedBy\.push\('pool-incoherent'\);/)?.[0] || '';

console.log('-- Both branches log, not just the fire path --');
{
  assertTrue(!!fireLogMatch, 'the fire-path console.log is found in source');
  assertTrue(!!declineLogMatch, 'the decline-path console.log ALSO exists — not just the fire path');
}

console.log('\n-- Decline log carries a reason breakdown, not just raw numbers --');
{
  assertTrue(/blockedBy/.test(declineLog), 'decline log includes a blockedBy breakdown');
  assertTrue(/blockedBy\.push\('merchandise-hard-block-region'\)/.test(blockedByComputation), 'breakdown distinguishes the merchandise-hard-block-region case');
  assertTrue(/blockedBy\.push\('comicVotes<5'\)/.test(blockedByComputation), 'breakdown distinguishes the comicVotes<5 case');
  assertTrue(/blockedBy\.push\('comicRatio<60%'\)/.test(blockedByComputation), 'breakdown distinguishes the comicRatio<60% case');
  assertTrue(/blockedBy\.push\('pool-incoherent'\)/.test(blockedByComputation), 'breakdown distinguishes the pool-incoherent case');
}

console.log('\n-- Decline log surfaces merchandiseRatio explicitly (not just comic-side ratios) --');
{
  assertTrue(/merchandiseRatio=/.test(declineLog), 'merchandiseRatio is printed in the decline log line, for full diagnostic context alongside comicVotes/comicRatio');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
