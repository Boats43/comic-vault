// tests/d5c-market-population-hash-serializer.test.js
//
// D5C -- property proof for market-population-hash-v1
// (src/lib/marketPopulationHash.js). Covers MP-NP8 (digest stability),
// MP-NP9 (digest changes with membership), MP-NP10 (cross-domain
// separation from mo-hash-v1/vq-hash-v1/applicability-hash-v1), and
// MP-NP11 (member order is non-semantic in this design -- Section 9 --
// so reordering members must NOT change the digest; proven, not
// assumed).
//
// No DB, no network -- pure deterministic unit proof.
//
// Invoke: node tests/d5c-market-population-hash-serializer.test.js

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const load = async (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const framing = await load('src/lib/canonicalHashFraming.js');
const mo = await load('src/lib/marketObservationHash.js');
const vq = await load('src/lib/valuationQuestionHash.js');
const ap = await load('src/lib/applicabilityHash.js');
const mp = await load('src/lib/marketPopulationHash.js');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertThrows = (fn, label) => {
  try { fn(); failed++; const m = `  ✗ ${label} (did NOT throw)`; failures.push(m); console.log(m); }
  catch (e) { passed++; console.log(`  ✓ ${label} (threw: ${e.message.slice(0, 90)})`); }
};

console.log('\n=== D5C -- market-population-hash-v1 property proof ===\n');

console.log('-- V3-precedent: shared canonical framing primitive, reference-equality proof --\n');
assertTrue(mp.encodeField === framing.encodeField, 'market-population-hash-v1 reuses the SAME shared encodeField (not a fourth independent implementation)');
assertTrue(mp.normalizeUuid === framing.normalizeUuid, 'reuses the shared normalizeUuid');

console.log('\n-- MP-NP10: cross-domain hash separation --\n');
assertTrue(mp.HASH_CONTRACT_VERSION === 'market-population-hash-v1', 'own distinct version prefix');
assertTrue(mp.HASH_CONTRACT_VERSION !== mo.HASH_CONTRACT_VERSION && mp.HASH_CONTRACT_VERSION !== vq.HASH_CONTRACT_VERSION && mp.HASH_CONTRACT_VERSION !== ap.HASH_CONTRACT_VERSION, 'prefix is disjoint from mo-hash-v1/vq-hash-v1/applicability-hash-v1');
// Identical raw byte content, differing ONLY in which module's version
// prefix is prepended, must never collide.
const sameContentDifferentDomain = () => {
  const rawFields = ['same-id', 'same-id-2'];
  const moLike = framing.hashCanonicalBuffer(framing.serializeCanonicalTuple([mo.HASH_CONTRACT_VERSION, ...rawFields]));
  const vqLike = framing.hashCanonicalBuffer(framing.serializeCanonicalTuple([vq.HASH_CONTRACT_VERSION, ...rawFields]));
  const apLike = framing.hashCanonicalBuffer(framing.serializeCanonicalTuple([ap.HASH_CONTRACT_VERSION, ...rawFields]));
  const mpLike = framing.hashCanonicalBuffer(framing.serializeCanonicalTuple([mp.HASH_CONTRACT_VERSION, ...rawFields]));
  return new Set([moLike, vqLike, apLike, mpLike]).size === 4;
};
assertTrue(sameContentDifferentDomain(), 'MP-NP10: identical raw field content under 4 different domain prefixes produces 4 DISTINCT hashes -- no cross-domain collision');

console.log('\n-- MP-NP8/MP-NP9/MP-NP11: member set digest --\n');
const membersA = [{ observationId: 'o1', memberStatus: 'SELECTED' }, { observationId: 'o2', memberStatus: 'EXCLUDED' }];
const membersAReordered = [{ observationId: 'o2', memberStatus: 'EXCLUDED' }, { observationId: 'o1', memberStatus: 'SELECTED' }];
const membersB = [{ observationId: 'o1', memberStatus: 'SELECTED' }, { observationId: 'o2', memberStatus: 'SELECTED' }];
const membersC = [{ observationId: 'o1', memberStatus: 'SELECTED' }, { observationId: 'o2', memberStatus: 'EXCLUDED' }, { observationId: 'o3', memberStatus: 'SELECTED' }];

assertTrue(mp.computeMemberSetDigest(membersA) === mp.computeMemberSetDigest(membersA), 'MP-NP8: identical member set digests identically on repeat computation');
assertTrue(mp.computeMemberSetDigest(membersA) === mp.computeMemberSetDigest(membersAReordered), 'MP-NP11: reordering the SAME members does NOT change the digest (Section 9 ruling: order non-semantic, proven)');
assertTrue(mp.computeMemberSetDigest(membersA) !== mp.computeMemberSetDigest(membersB), 'MP-NP9: changing one member\'s status (EXCLUDED -> SELECTED) DOES change the digest');
assertTrue(mp.computeMemberSetDigest(membersA) !== mp.computeMemberSetDigest(membersC), 'MP-NP9: adding a member DOES change the digest');
assertTrue(mp.computeMemberSetDigest([]) !== mp.computeMemberSetDigest(membersA), 'MP-NP9: empty population differs from a non-empty one');
assertTrue(mp.computeMemberSetDigest([]) === mp.computeMemberSetDigest([]), 'MP-NP8: two independently-computed empty-population digests are identical');

console.log('\n-- Header hash: MP-NP4/MP-NP6/MP-NP7 (unit-level) --\n');
const h = (qId, ruleVersion, members) => mp.computeMarketPopulationHash(mp.canonicalizeMarketPopulationFields({ valuationQuestionId: qId, populationRuleVersion: ruleVersion, members }));
assertTrue(h('Q1', 'comp-population-v1', membersA) === h('Q1', 'comp-population-v1', membersA), 'MP-NP6: identical (question, rule version, member set) -> identical header hash (duplicate execution dedups)');
assertTrue(h('Q1', 'comp-population-v1', membersA) !== h('Q1', 'comp-population-v2', membersA), 'MP-NP4/MP-NP7: changed population-rule version, same members -> DIFFERENT hash (new historical population, not blocked)');
assertTrue(h('Q1', 'comp-population-v1', membersA) !== h('Q1', 'comp-population-v1', membersB), 'MP-NP7: same question/rule version, DIFFERENT resulting membership (new observation applicable, or dedup outcome changed) -> DIFFERENT hash (legitimate reevaluation not blocked)');
assertTrue(h('Q1', 'comp-population-v1', membersA) !== h('Q2', 'comp-population-v1', membersA), 'different ValuationQuestion, identical everything else -> different hash');

assertThrows(() => mp.normalizeMemberStatus('CONTESTED'), 'member_status rejects a value outside SELECTED/EXCLUDED');
assertThrows(() => mp.normalizeMemberStatus(null), 'member_status is required, never null');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
