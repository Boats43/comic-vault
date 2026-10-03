// tests/buyer-safe-listing-copy.test.js
//
// INTERNAL DECISION REASONING != BUYER-FACING MARKETPLACE COPY.
// Pure/unit layer for the explicit buyer-safe projection and the OTHER-platform
// packet generators (Mercari/Facebook/Whatnot/Craigslist). The real eBay
// packet-construction proof (single + bundle, real handler) lives in
// tests/list-ebay-outcome1-handler-smoke.test.js.
//
// Invoke: node tests/buyer-safe-listing-copy.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const U = (rel) => pathToFileURL(path.join(repoRoot, rel)).href;

const { toBuyerSafeListingFacts, isShowableKeyIssue } = await import(U('src/lib/buyerSafeListingCopy.js'));
const packets = await import(U('src/lib/marketplacePackets.js'));

const INJECTIONS = [
  'INTERNAL_TEST_DO_NOT_SHOW_TO_BUYER',
  'REFUSED because price authority missing',
  'gkAssetId=SECRET_TEST_ID',
  'Model said user should list because the comps looked strong',
  '<script>alert(1)</script>',
  'line one\nline two\r\n\tSECRET_CTRL_LINE\u0007',
  '{"trace":"SECRET_JSON_TRACE","blockers":["x"]}',
];
const item = (reason) => ({
  id: 'cv_test', title: 'Test Series', issue: '12', year: '1975', publisher: 'Test Pub', grade: 'VF', isGraded: false,
  keyIssue: 'First appearance of Hero', price: '$40.00',
  reason, claudeCheck: { flags: ['INTERNAL_FLAG_DIAG'] }, decision: { reason: 'INTERNAL_DECISION_REASON' },
  contract: { reason: 'INTERNAL_CONTRACT_REASON' }, gkAssetId: 'SECRET_ASSET', decisionEventId: 'SECRET_DECISION',
  priceBands: { quick: 30, stretch: 50, market: 40, count: 3, source: 'INTERNAL_SOURCE_TOKEN' },
  comicVine: { description: 'A public story summary.', personCredits: [{ name: 'Jane Doe', role: 'writer' }], characterCredits: [{ name: 'Hero' }] },
  demandSignals: { demandLevel: 'HIGH', trend: 'RISING', liquidity: 'FAST' },
});

console.log('\n=== buyer-safe projection (explicit field selection) ===');
for (const inj of INJECTIONS) {
  const f = toBuyerSafeListingFacts(item(inj));
  const dump = JSON.stringify(f);
  ok(!dump.includes('INTERNAL_') && !dump.includes('SECRET_') && !dump.includes(JSON.stringify(inj).slice(1, -1)) && !('reason' in f) && !('claudeCheck' in f) && !('decision' in f) && !('contract' in f) && !('gkAssetId' in f),
     `projection carries none of reason/claudeCheck/decision/contract/ids/source for injection ${JSON.stringify(inj).slice(0, 36)}…`);
}
const fp = toBuyerSafeListingFacts(item('x'));
ok(fp.title === 'Test Series' && fp.issue === '12' && fp.year === '1975' && fp.publisher === 'Test Pub' && fp.grade === 'VF' && fp.keyIssue === 'First appearance of Hero', 'safe catalogue facts preserved');
ok(fp.market?.market === 40 && !('source' in fp.market) && fp.creators[0].name === 'Jane Doe' && fp.demand.demandLevel === 'HIGH', 'public market/credits/demand figures preserved; pipeline source label not projected');
ok(Object.isFrozen(fp), 'projection is frozen');
ok(isShowableKeyIssue('No') === false && isShowableKeyIssue('1st app') === true, 'key-issue display rule unchanged');
ok(JSON.stringify(toBuyerSafeListingFacts(null)).length > 0 && toBuyerSafeListingFacts(undefined).title === '', 'null/undefined input is safe');

console.log('\n=== other-platform packets (marketplacePackets.js) never project item.reason ===');
for (const inj of INJECTIONS) {
  const it = item(inj);
  for (const [name, fn] of [['mercari', packets.getMercariDescription], ['facebook', packets.getFacebookDescription], ['whatnot', packets.getWhatnotDescription], ['craigslist', packets.getCraigslistDescription]]) {
    const out = fn(it);
    const bad = ['INTERNAL_', 'SECRET_', 'REFUSED because', 'Model said', '<script>', 'line one', 'trace'].filter((n) => out.includes(n));
    ok(bad.length === 0, `${name}: no injected internal text (${JSON.stringify(inj).slice(0, 28)}…)${bad.length ? ' LEAKED ' + bad : ''}`);
  }
}
const m = packets.getMercariDescription(item('x'));
ok(m.includes('Test Series #12 (1975)') && m.includes('Publisher: Test Pub') && m.includes('Grade: ') && m.includes('Condition: See photos for condition details.'), 'mercari ordinary fields intact + fixed public condition sentence');
ok(packets.getFacebookDescription(item('x')).includes('See photos for condition.') && packets.getWhatnotDescription(item('x')).includes('See photos.'), 'facebook/whatnot fixed public condition text');

console.log('\n=== structural: the eBay builders cannot see the raw item ===');
const src = readFileSync(path.join(repoRoot, 'api', 'list-ebay.js'), 'utf8');
const fnBody = src.slice(src.indexOf('const buildDescription = (rawItem)'), src.indexOf('// Extract the first occurrence of a simple'));
ok(/toBuyerSafeListingFacts\(rawItem\)/.test(fnBody) && !/\brawItem\.(reason|claudeCheck|decision|contract)/.test(fnBody) && !/\bitem\.reason\b/.test(fnBody), 'buildDescription reads ONLY the projection (rawItem touched once, by the projector)');
const bundleBody = src.slice(src.indexOf('const buildBundleDescription'), src.indexOf('const buildBundleXml')).replace(/\/\/.*$/gm, '');
ok(/toBuyerSafeListingFacts\(rawIt\)/.test(bundleBody) && !/\.reason\b/.test(bundleBody), 'buildBundleDescription uses the same projection; no .reason reference');
const noReasonRefs = src.split('\n').filter((l) => /\b(item|it)\.reason\b/.test(l) && !l.trim().startsWith('//'));
ok(noReasonRefs.length === 0, 'api/list-ebay.js contains NO executable item.reason / it.reason reference');
const pk = readFileSync(path.join(repoRoot, 'src', 'lib', 'marketplacePackets.js'), 'utf8');
ok(pk.split('\n').filter((l) => /item\.reason/.test(l) && !l.trim().startsWith('//')).length === 0, 'marketplacePackets.js contains NO executable item.reason reference');
ok(!/\.\.\.(item|decision|contract)\b/.test(readFileSync(path.join(repoRoot, 'src', 'lib', 'buyerSafeListingCopy.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'projection module never spreads item/decision/contract');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
