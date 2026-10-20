// GOVERNING-GRADE COMPARABLE QUERY -- the comps query must target the same governing grade that pricing and the listing title use.
// Before: an owned refresh sent the stored/request model grade (OML: 'VF 8.0') to the +/-1.5 comp window although the operator confirmed 9.2.
// Proves, with the REAL api/enrich.js handler and real Development Postgres (network mocked; the pool is a DESIGNED FIXTURE, not real marketplace data):
//   * operator-confirmed 9.2 governs the refreshed comparable query (numericTarget 9.2, window 7.7-10.7);
//   * the stored 8.0 cannot silently override it;
//   * an asset WITHOUT operator authority keeps the established behaviour (request grade, window 6.5-9.5);
//   * a client-claimed operator grade in the request body of a non-owned request is ignored (server-resolved authority only);
//   * a certified/graded format and an authority flag with no grade value fail closed to the established path;
//   * the comparable query, the pricing block's governing grade and the server-generated listing title resolve the SAME grade.
// Tier 3 / Tier 4 arithmetic is untouched. Invoke: node tests/governing-grade-comps-query.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.EBAY_APP_ID = 'x'; process.env.EBAY_CERT_ID = 'x'; process.env.PRICECHARTING_TOKEN = 'x';
await import('./helpers/spendGuardTestSetup.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const imp = (...p) => import(pathToFileURL(path.join(repoRoot, ...p)).href);
const { resolveGoverningGradeForComps, resolveGoverningGrade } = await imp('src', 'lib', 'gradeAuthority.js');

console.log('\n=== governing-grade resolver for the comparable query (pure) ===\n');
const base = { grade: 'VF 8.0', numericGrade: null, isGraded: false };
const op = { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2 };
let r = resolveGoverningGradeForComps({ ...base, ...op });
ok(r.grade === '9.2' && r.numericGrade === 9.2 && r.source === 'operator', 'operator-confirmed 9.2 governs over the stored VF 8.0');
ok(JSON.stringify(r) === JSON.stringify({ ...resolveGoverningGrade({ ...base, ...op }), governingIsGraded: false }), 'it is the existing resolver\'s answer, not a second algorithm');
r = resolveGoverningGradeForComps({ ...base });
ok(r.grade === 'VF 8.0' && r.numericGrade === null && r.source === 'model', 'no operator authority: the request grade/numericGrade pass through byte-identically (established behaviour)');
r = resolveGoverningGradeForComps({ ...base, gradeAuthority: 'MODEL', operatorGrade: '9.2', operatorGradeNumeric: 9.2 });
ok(r.grade === 'VF 8.0' && r.source === 'model', 'an operatorGrade value without OPERATOR_CONFIRMED authority is ignored');
r = resolveGoverningGradeForComps({ ...base, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: null, operatorGradeNumeric: null });
ok(r.grade === 'VF 8.0' && r.source === 'model', 'OPERATOR_CONFIRMED with no grade value fails closed to the established model grade (never a null/NaN target)');
r = resolveGoverningGradeForComps({ grade: 'CGC 9.4', numericGrade: 9.4, isGraded: true, ...op });
ok(r.grade === 'CGC 9.4' && r.numericGrade === 9.4 && r.governingIsGraded === true, 'a graded/certified format never consults operator raw-grade authority (Section C)');
r = resolveGoverningGradeForComps({ ...base, ...op, gradingFormatAuthority: 'OPERATOR_CONFIRMED', operatorIsGraded: true });
ok(r.governingIsGraded === true && r.grade === 'VF 8.0', 'an operator-declared graded format keeps the request path (no raw-grade override)');

// ── real handler ──
const POOL = [
  ['Old Man Logan #25 Deodato GD 2.0', 9], ['Old Man Logan #25 Deodato VG 4.0', 11], ['Old Man Logan #25 Deodato FN 6.0', 13], ['Old Man Logan #25 Deodato VF 8.0', 16], ['Old Man Logan #25 Deodato VF 8.0 Marvel', 17],
  ['Old Man Logan #25 Deodato VF/NM 9.0', 21], ['Old Man Logan #25 Deodato NM- 9.2', 26], ['Old Man Logan #25 Deodato NM- 9.2 Marvel', 28], ['Old Man Logan #25 Deodato NM 9.4', 34], ['Old Man Logan #25 Deodato NM 9.4 Marvel', 36], ['Old Man Logan #25 Deodato NM+ 9.6', 48],
].map(([t, p]) => [t.includes('2017') ? t : `${t} 2017`, p]);
const ebayItem = ([t, p], i) => ({ itemId: `v1|70000000000${i}|0`, title: t, leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }], image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: String(p), currency: 'USD' }, itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C70000000000${i}%7C0`, seller: { username: 's', feedbackPercentage: '99.9', feedbackScore: 1000 }, condition: 'Used', conditionId: '3000', thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }], buyingOptions: ['FIXED_PRICE'], itemWebUrl: `https://www.ebay.com/itm/70000000000${i}`, itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `70000000000${i}`, adultOnly: false, itemOriginDate: '2026-10-01T18:07:04.000Z', itemCreationDate: '2026-10-01T18:07:04.000Z', listingMarketplaceId: 'EBAY_US' });
const ITEMS = POOL.map(ebayItem);
const json = (b, st = 200) => ({ ok: st < 300, status: st, json: async () => b, text: async () => JSON.stringify(b) });
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth')) return json({ access_token: 't', expires_in: 7200 });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return json({ itemSummaries: ITEMS, total: ITEMS.length });
  if (u.includes('comicvine')) return json({ results: [], status_code: 1 });
  if (u.includes('pricecharting')) return json({ error: 'nf' }, 404);
  if (u.includes('api.anthropic.com')) throw new Error('NO MODEL CALL EXPECTED');
  return json({});
};

const { issueToken } = await imp('src', 'modules', 'auth', 'token.js');
const { createCollectionItem } = await imp('src', 'modules', 'collection', 'index.js');
const { toBuyerSafeListingFacts, buildGovernedListingTitle, rawConditionLabel } = await imp('src', 'lib', 'buyerSafeListingCopy.js');
const enrichHandler = (await imp('api', 'enrich.js')).default;
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const principalId = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, 'gg-comps-query', 'operator')`, [principalId]);
const token = issueToken({ principalId }).token;
const uniq = `Gg${randomBytes(4).toString('hex')}`;

async function ownedRow(label, extra) {
  const id = `cv_gg_${label}_${randomBytes(4).toString('hex')}`;
  await createCollectionItem({ principalId, id, assetCategory: 'comic', attributes: { title: 'old man logan deodato', issue: '25', year: '2017', publisher: 'Marvel', grade: 'VF 8.0', assetType: 'comic', assetCategory: 'comic', remoteImages: [] } });
  if (extra) await db.query(`UPDATE data1_dev.collection_item SET attributes = attributes || $1::jsonb WHERE id = $2 AND principal_id = $3`, [JSON.stringify(extra), id, principalId]);
  return id;
}
const OP_ATTRS = { identityAuthority: { title: 'OPERATOR_CONFIRMED' }, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false };
async function refresh(body) {
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  let out = null;
  try {
    await enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { assetType: 'comic', title: 'old man logan deodato', issue: '25', year: '2017', publisher: 'Marvel', variant: null, grade: 'VF 8.0', numericGrade: null, isGraded: false, images: [], skipClaudeCheck: true, skipImageSearch: true, ...body } },
      { status: () => ({ json: (d) => { out = d; } }), setHeader() {}, json: (d) => { out = d; } });
  } finally { console.log = orig; }
  const num = (logs.find((l) => l.startsWith('[grade-numeric]')) || '').match(/numericTarget= ([0-9.]+)/);
  const cg = logs.find((l) => l.startsWith('[comps-grade]')) || '';
  return { out, logs, target: num ? Number(num[1]) : null, cg, poolPrices: (out?.rawComps?.prices || []).map((x) => x.price) };
}

try {
  console.log('\n=== real handler: owned refresh WITH operator-confirmed 9.2 (stored grade VF 8.0) ===\n');
  const opRow = await ownedRow('op', OP_ATTRS);
  const A = await refresh({ collectionItemId: opRow, ownedRefresh: true });
  console.log(`  (log) ${A.cg}`);
  ok(A.out && A.out.governingGradeNumeric === 9.2 && A.out.governingGradeSource === 'operator', `pricing block resolved the operator grade (governingGradeNumeric=${A.out?.governingGradeNumeric}, source=${A.out?.governingGradeSource})`);
  ok(/source=operator/.test(A.cg) && /queryGrade="9.2"/.test(A.cg) && /requestGrade="VF 8.0"/.test(A.cg), 'the comparable query was handed the OPERATOR grade, not the stored request grade');
  ok(A.target === 9.2, `comps numericTarget is 9.2 (got ${A.target})`);
  ok(A.poolPrices.includes(48) && A.poolPrices.length === 8, `the 7.7-10.7 window admits the NM+ 9.6 ask (pool ${JSON.stringify(A.poolPrices)})`);
  ok(A.target !== 8, 'the stored 8.0 did NOT silently override the governing grade');

  console.log('\n=== control: owned refresh WITHOUT operator authority ===\n');
  const plainRow = await ownedRow('plain', null);
  const B = await refresh({ collectionItemId: plainRow, ownedRefresh: true });
  console.log(`  (log) ${B.cg}`);
  ok(/source=model/.test(B.cg) && B.target === 8, `no operator authority: established behaviour, target 8.0 (got ${B.target})`);
  ok(B.poolPrices.length === 7 && !B.poolPrices.includes(48), `window 6.5-9.5 (pool ${JSON.stringify(B.poolPrices)})`);

  console.log('\n=== negative: a CLIENT-claimed operator grade cannot govern ===\n');
  const C = await refresh({ gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2, operatorIsGraded: false });
  console.log(`  (log) ${C.cg}`);
  ok(/source=model/.test(C.cg) && C.target === 8, `non-owned request asserting operator authority in the body: ignored, target stays 8.0 (got ${C.target})`);
  const D = await refresh({ collectionItemId: plainRow, ownedRefresh: true, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorGradeNumeric: 9.2 });
  ok(/source=model/.test(D.cg) && D.target === 8, `owned row WITHOUT durable authority, body claims operator 9.2: ignored (got ${D.target})`);

  console.log('\n=== fail-closed: authority marker without a grade value ===\n');
  const hollowRow = await ownedRow('hollow', { gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: null, operatorGradeNumeric: null });
  const E = await refresh({ collectionItemId: hollowRow, ownedRefresh: true });
  ok(/source=model/.test(E.cg) && E.target === 8, `OPERATOR_CONFIRMED with no value falls back to the established grade (target ${E.target}), never null/NaN`);

  console.log('\n=== one governing grade across query, pricing and listing title ===\n');
  const persisted = (await db.query(`SELECT attributes FROM data1_dev.collection_item WHERE id = $1`, [opRow])).rows[0].attributes;
  const facts = toBuyerSafeListingFacts({ ...persisted, title: persisted.title });
  const title = buildGovernedListingTitle(facts);
  console.log(`  (listing title from the persisted row) ${JSON.stringify(title)}`);
  ok(A.target === Number(A.out.governingGradeNumeric) && A.target === Number(persisted.operatorGradeNumeric), `query target ${A.target} = pricing governingGradeNumeric ${A.out.governingGradeNumeric} = durable operator grade ${persisted.operatorGradeNumeric}`);
  ok(rawConditionLabel(A.target) === 'NM-' && /Raw NM-$/.test(title), `the listing title carries the label of that same grade (${rawConditionLabel(A.target)}): ${JSON.stringify(title)}`);
  ok(A.out.gradeMultiplier === 1.2 && A.out.priceBands?.source === 'tier3_active_discounted', 'Tier 3 arithmetic unchanged: the 1.2 multiplier is still diagnostic-only at Tier 3 (priceBands source tier3_active_discounted)');
  const avg = A.out.rawComps.average;
  ok(Math.abs(Number(String(A.out.price).replace(/[^0-9.]/g, '')) - Math.round(avg * 0.85 * 100) / 100) < 0.011, `price is still activeAvg x 0.85 over the (now 9.2-targeted) pool: ${A.out.price} from avg ${avg}`);
} finally {
  await db.end();
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
