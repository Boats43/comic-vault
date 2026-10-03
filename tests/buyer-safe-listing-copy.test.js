// tests/buyer-safe-listing-copy.test.js
//
// INTERNAL DECISION REASONING != BUYER-FACING MARKETPLACE COPY (Outcome #1 V1 policy).
// Unit layer for the explicit buyer-safe projection, the deterministic governed title,
// the governed public-grade rule, and the OTHER-platform packet generators. The real
// eBay packet-construction proof (single + bundle + fail-closed hydration, real
// handler) lives in tests/list-ebay-outcome1-handler-smoke.test.js.
//
// Invoke: node tests/buyer-safe-listing-copy.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const U = (rel) => pathToFileURL(path.join(repoRoot, rel)).href;

const { toBuyerSafeListingFacts, buildGovernedListingTitle, governedPublicGrade, formatPublicTitle } = await import(U('src/lib/buyerSafeListingCopy.js'));
const packets = await import(U('src/lib/marketplacePackets.js'));

const INJECTIONS = [
  'INTERNAL_TEST_DO_NOT_SHOW_TO_BUYER', 'REFUSED because price authority missing', 'gkAssetId=SECRET_TEST_ID',
  'Model said user should list because the comps looked strong', '<script>alert(1)</script>',
  'line one\nline two\r\n\tSECRET_CTRL_LINE\u0007', '{"trace":"SECRET_JSON_TRACE","blockers":["x"]}',
];
const item = (reason) => ({
  id: 'cv_test', title: 'the new mutants', issue: '98', year: '1991', publisher: 'Marvel', grade: 'VG 4.0', isGraded: false,
  keyIssue: 'First appearance of Deadpool', price: '$40.00', modelPredictedGrade: 'VG 4.0',
  reason, claudeCheck: { flags: ['INTERNAL_FLAG_DIAG'], confidence: 'HIGH', suggestedListingTitle: 'AI_SUGGESTED_TITLE' }, decision: { reason: 'INTERNAL_DECISION_REASON' },
  contract: { reason: 'INTERNAL_CONTRACT_REASON' }, gkAssetId: 'SECRET_ASSET', decisionEventId: 'SECRET_DECISION',
  priceBands: { quick: 30, stretch: 50, market: 40, count: 3, source: 'INTERNAL_SOURCE_TOKEN' },
  comicVine: { description: 'story', personCredits: [{ name: 'Jane', role: 'writer' }] }, demandSignals: { demandLevel: 'HIGH' },
});

console.log('\n=== buyer-safe projection (explicit field selection, V1 policy) ===');
for (const inj of INJECTIONS) {
  const f = toBuyerSafeListingFacts(item(inj));
  const dump = JSON.stringify(f);
  ok(!dump.includes('INTERNAL_') && !dump.includes('SECRET_') && !dump.includes('AI_SUGGESTED') && !dump.includes('Deadpool') && !('reason' in f) && !('claudeCheck' in f) && !('market' in f) && !('demand' in f) && !('keyIssue' in f),
     `projection carries no reason/claudeCheck/ids/pricing/demand/key-claim for injection ${JSON.stringify(inj).slice(0, 30)}…`);
}
const f0 = toBuyerSafeListingFacts(item('x'));
ok(f0.title === 'The New Mutants' && f0.issue === '98' && f0.year === '1991' && f0.publisher === 'Marvel', 'governed identity facts preserved (lowercase OCR title Title-Cased deterministically)');
ok(f0.publicGrade === '' && f0.isSlab === false, 'a legacy/model grade ("VG 4.0", no operator authority) is NOT projected as a public grade');
ok(governedPublicGrade({ gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VF 8.0' }) === 'VF 8.0', 'an OPERATOR_CONFIRMED grade IS projected');
ok(governedPublicGrade({ gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.8', operatorIsGraded: true, operatorGradeNumeric: 9.8 }) === 'CGC 9.8', 'an operator-confirmed slab projects as CGC <n>');
ok(governedPublicGrade({ operatorGrade: 'VF 8.0' }) === '' && governedPublicGrade({ gradeAuthority: 'MODEL', operatorGrade: 'VF' }) === '', 'an operator grade value without OPERATOR_CONFIRMED authority is never public');
ok(formatPublicTitle('X-Men') === 'X-Men' && formatPublicTitle('the amazing spider-man') === 'The Amazing Spider-man', 'title formatting: mixed-case preserved verbatim; all-lowercase Title-Cased');
ok(Object.isFrozen(f0), 'projection is frozen');
ok(toBuyerSafeListingFacts(null).title === '' && toBuyerSafeListingFacts(undefined).publicGrade === '', 'null/undefined input is safe');

console.log('\n=== deterministic governed title ===');
const t = buildGovernedListingTitle(f0);
ok(t === 'The New Mutants #98 Marvel 1991' && t.length === 31, `title = "${t}" (31 chars)`);
ok(!/KEY|AI_SUGGESTED|Deadpool|VG/.test(t), 'no key-issue marketing token, no AI-suggested title, no unverified grade');
const longT = buildGovernedListingTitle(toBuyerSafeListingFacts({ title: 'A'.repeat(90), issue: '1', year: '1999', publisher: 'P' }));
ok(longT.length <= 80, 'title never exceeds the 80-char eBay limit');
ok(buildGovernedListingTitle(toBuyerSafeListingFacts({ title: 'Batman', issue: '1', year: '1940', publisher: 'DC', gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'CGC', operatorIsGraded: true, operatorGradeNumeric: 7.5 })) === 'Batman #1 CGC 7.5 DC 1940', 'a governed slab grade may appear in the title');

console.log('\n=== other-platform packets (marketplacePackets.js) never project item.reason ===');
for (const inj of INJECTIONS) {
  const it = item(inj);
  for (const [name, fn] of [['mercari', packets.getMercariDescription], ['facebook', packets.getFacebookDescription], ['whatnot', packets.getWhatnotDescription], ['craigslist', packets.getCraigslistDescription]]) {
    const out = fn(it);
    const bad = ['INTERNAL_', 'SECRET_', 'REFUSED because', 'Model said', '<script>', 'line one', 'trace'].filter((n) => out.includes(n));
    ok(bad.length === 0, `${name}: no injected internal text (${JSON.stringify(inj).slice(0, 26)}…)${bad.length ? ' LEAKED ' + bad : ''}`);
  }
}
const m = packets.getMercariDescription(item('x'));
ok(m.includes('Publisher: Marvel') && m.includes('Condition: See photos for condition details.'), 'mercari ordinary fields intact + fixed public condition sentence');

console.log('\n=== structural: the eBay builders cannot see the raw item ===');
const src = readFileSync(path.join(repoRoot, 'api', 'list-ebay.js'), 'utf8');
const strip = (x) => x.replace(/\/\/.*$/gm, '');
const descBody = strip(src.slice(src.indexOf('const buildDescription = (rawItem'), src.indexOf('// Extract the first occurrence of a simple')));
ok(/toBuyerSafeListingFacts\(rawItem\)/.test(descBody) && !/\brawItem\.\w+/.test(descBody.replace(/toBuyerSafeListingFacts\(rawItem\)/, '')), 'buildDescription reads ONLY the projection');
ok(!/Recent verified|Market value|MARKET DATA|DEMAND|census|CGC census|priceBands|demandSignals|comicVine|keyIssue|\.reason/.test(descBody), 'buildDescription contains no market/sold/demand/census/key-claim/reason code path');
const titleDef = strip(src.slice(src.indexOf('const buildTitle ='), src.indexOf('const eraFromYear')));
ok(/buildGovernedListingTitle\(toBuyerSafeListingFacts\(rawItem\)\)/.test(titleDef) && !/claudeCheck|suggestedListingTitle/.test(titleDef), 'buildTitle is deterministic over the projection and never reads claudeCheck/suggestedListingTitle');
const bundleBody = strip(src.slice(src.indexOf('const buildBundleDescription'), src.indexOf('const buildBundleXml')));
ok(/toBuyerSafeListingFacts\(rawIt\)/.test(bundleBody) && !/\.reason\b|keyIssue|market value|18% off/.test(bundleBody), 'bundle description uses the same projection; no reason/key/market claim');
ok(strip(src).split('\n').filter((l) => /\b(item|it)\.reason\b/.test(l)).length === 0, 'api/list-ebay.js contains NO executable item.reason / it.reason reference');
ok(/getCanonicalCollectionItemIdForAsset/.test(src) && /LISTING_FACTS_UNAVAILABLE/.test(src) && src.indexOf('LISTING_FACTS_UNAVAILABLE') < src.indexOf('const xml = buildXml(item, pictureUrls, listingPlan);'), 'governed durable facts are resolved (fail-closed) BEFORE the real packet is built');
ok(!/\.\.\.(item|decision|contract)\b/.test(strip(readFileSync(path.join(repoRoot, 'src', 'lib', 'buyerSafeListingCopy.js'), 'utf8'))), 'projection module never spreads item/decision/contract');
const pk = readFileSync(path.join(repoRoot, 'src', 'lib', 'marketplacePackets.js'), 'utf8');
ok(pk.split('\n').filter((l) => /item\.reason/.test(l) && !l.trim().startsWith('//')).length === 0, 'marketplacePackets.js contains NO executable item.reason reference');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
