// GK-271 — mandatory real-handler smoke (GK-138 Handler-Wiring Verification).
// Proves api/enrich.js's new edition-authority wiring executes without
// throwing in the REAL handler, and that a Vision-only "Canadian edition"
// variant cannot reach the Canadian price multiplier.
//
// Deterministic: global fetch stub, KV unset. Invoke:
//   node tests/gk271-enrich-handler-smoke.test.js
// Optional negative control (proves the hole was real before the fix):
//   GK271_ENRICH_PATH=../api/enrich-head.js node tests/gk271-enrich-handler-smoke.test.js

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: 'gk271-test-principal' }).token;
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

const POOL = [
  ['Classic Comics #13 Dr Jekyll and Mr Hyde Gilberton 1943 FR', 120],
  ['Classic Comics 13 Jekyll Hyde Gilberton GD', 150],
  ['CLASSIC COMICS #13 DR. JEKYLL & MR. HYDE HRN 20 VG', 175],
  ['Classic Comics No. 13 Jekyll and Hyde Gilberton', 140],
  ['Classic Comics #13 Dr Jekyll Mr Hyde 1943 original', 160],
];
const ebayItem = (title, price, i) => ({
  itemId: `v1|4000000000${i}|0`, title, leafCategoryIds: ['259104'],
  categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
  price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C4000000000${i}%7C0`,
  seller: { username: 's', feedbackPercentage: '99', feedbackScore: 500 },
  condition: 'Used', conditionId: '3000', buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/4000000000${i}`, legacyItemId: `4000000000${i}`,
  itemLocation: { country: 'US' }, listingMarketplaceId: 'EBAY_US',
});
const ITEMS = POOL.map(([t, p], i) => ebayItem(t, p, i));

const PC_HTML = `<html><body>
<select id="completed-auctions-condition"><option value="completed-auctions-cib">Ungraded (2)</option><option value="completed-auctions-grade-seventeen">1.0 (0)</option></select>
<div class="completed-auctions-cib"><table class="hoverable-rows sortable"><tbody>
<tr id="ebay-123456789012"><td class="date">2026-08-02</td><td class="title"><a class="js-ebay-completed-sale" href="https://www.ebay.com/itm/123456789012">Classic Comics #13 Dr Jekyll Mr Hyde Gilberton</a> [eBay]</td><td class="numeric"><span class="js-price">$141.00</span></td></tr>
<tr><td class="date">2026-05-01</td><td class="title"><a class="js-ha-completed-sale" href="https://comics.ha.com/itm/77">Classic Comics #13 Dr Jekyll Mr Hyde HRN 20</a> [HeritageAuctions]</td><td class="numeric"><span class="js-price">$900.00</span></td></tr>
</tbody></table></div>
<div class="completed-auctions-grade-seventeen"><p>No sales data</p></div>
<div id="full-prices"><table><tr><td>Ungraded</td><td class="price js-price">$150.00</td></tr><tr><td>1.0</td><td class="price js-price">$210.00</td></tr></table></div>
</body></html>`;
let PC_PAGE = false;
let EMPTY_EBAY = false;
const jsonResponse = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'fake', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return jsonResponse(EMPTY_EBAY ? { itemSummaries: [], total: 0 } : { itemSummaries: ITEMS, total: ITEMS.length });
  if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com/api/products')) {
    return jsonResponse({ products: [{ id: '999001', 'product-name': 'Classic Comics #13 (1943)', 'loose-price': 15000 }] });
  }
  if (u.includes('pricecharting.com/game/') && PC_PAGE) return { ok: true, status: 200, text: async () => PC_HTML, json: async () => ({}) };
  if (u.includes('pricecharting.com')) return jsonResponse({ error: 'not found' }, 404);
  if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
  return jsonResponse({});
};

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

const logs = [];
const origLog = console.log;
let capturing = false;
console.log = (...a) => { if (capturing) logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origLog(...a); };

const handlerPath = process.env.GK271_ENRICH_PATH || '../api/enrich.js';
const handler = (await import(handlerPath)).default;

const run = async (variant, foreignEdition = false) => {
  logs.length = 0;
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: {
      title: 'Classic Comics', issue: '13', grade: 'FR 1.0', confidence: 'medium',
      isGraded: false, numericGrade: null, year: '1943', publisher: 'Gilberton',
      variant, foreignEdition, keyIssue: null,
      reason: 'Heavy wear and creasing. Canadian edition.',
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    },
  };
  let status = null, body = null, threw = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader: () => {} };
  capturing = true;
  try { await handler(req, res); } catch (e) { threw = e; }
  capturing = false;
  return { status, body, threw, logs: [...logs] };
};

origLog('\n=== GK-271 enrich handler smoke: Vision-only Canadian claim ===\n');
const a = await run('Canadian edition', true);
ok(a.threw === null, `no exception escaped the handler (${a.threw ? a.threw.message : 'none'})`);
ok(!a.logs.some((l) => l.includes('ReferenceError')), 'no ReferenceError anywhere in the run');
ok(a.status === 200, `HTTP 200 (actual ${a.status})`);
const canadianMult = a.logs.filter((l) => /^\[variant\]/.test(l) && /canadian/i.test(l) && /(×|x)\s?\d/.test(l));
ok(canadianMult.length === 0, `no "[variant] canadian × N" multiplier line fired (found ${canadianMult.length})`);
const guarded = a.logs.some((l) => l.startsWith('[edition-authority]'));
ok(process.env.GK271_ENRICH_PATH ? true : guarded, '[edition-authority] guard line emitted in the real handler');
ok(a.body?.editionStanding === 'UNRESOLVED', `response.editionStanding === UNRESOLVED (actual ${a.body?.editionStanding})`);
ok(a.body?.country == null, 'response.country stays unresolved (null)');
origLog(`  pricingSource=${a.body?.pricingSource} price=${a.body?.price} variantNote=${a.body?.variantNote}`);

origLog('\n— control: a non-country variant is untouched —');
const b = await run('Whitman variant', false);
ok(b.threw === null && b.status === 200, 'control run OK');
ok(!b.logs.some((l) => l.startsWith('[edition-authority]')), 'no edition-authority withholding for a non-country variant');
ok(b.body?.editionStanding == null, 'no editionStanding set when no country claim');

origLog('\n— PC-estimate lane (no eBay pool): the lane where the multiplier gate is open —');
EMPTY_EBAY = true;
const c = await run('Canadian edition', true);
EMPTY_EBAY = false;
origLog(`  lane: pricingSource=${c.body?.pricingSource} price=${c.body?.price}`);
ok(c.threw === null && c.status === 200, 'PC-estimate lane runs through the real handler without throwing');
const cMult = c.logs.filter((l) => /^\[variant\]/.test(l) && /canadian/i.test(l));
origLog(`  [variant] canadian lines: ${JSON.stringify(cMult)}`);
ok(cMult.length === 0, 'no Canadian multiplier line in the PC-estimate lane');
ok(c.body?.editionStanding === 'UNRESOLVED', 'edition UNRESOLVED in the PC-estimate lane');

origLog('\n— server-normalized evidence payload (real handler + real PC extractor) —');
PC_PAGE = true;
const d = await run('Whitman variant', false);
PC_PAGE = false;
ok(d.threw === null && d.status === 200, 'PC-HTML scenario runs through the real handler');
const ne = d.body?.normalizedEvidence;
ok(ne && ne.version === 1 && Array.isArray(ne.rows) && ne.inventory, 'response carries normalizedEvidence {version, rows, inventory}');
const rows = ne?.rows || [];
const CLASSES = new Set(['REALIZED_SALE', 'STRUCTURED_HISTORICAL', 'ACTIVE_ASK', 'AUCTION_STATE', 'REFERENCE', 'AI_CONTEXT']);
ok(rows.length > 0 && rows.every((r) => CLASSES.has(r.evidenceClass)), `every server row carries a valid evidenceClass (${rows.length} rows)`);
const asks = rows.filter((r) => r.evidenceClass === 'ACTIVE_ASK');
ok(asks.length > 0 && asks.every((r) => r.saleDate === null), 'eBay Browse pool rows are ACTIVE_ASK with no sale date');
ok(!rows.some((r) => r.evidenceClass === 'REALIZED_SALE' && r.admissionStanding === 'NOT_APPLICABLE'), 'no ask/guide row is classed REALIZED_SALE');
const her = rows.find((r) => r.provider === 'HERITAGE');
origLog(`  Heritage row: ${JSON.stringify(her)}`);
ok(!!her && her.sourceThrough === 'PRICECHARTING' && her.evidenceClass === 'REALIZED_SALE', 'Heritage-through-PriceCharting: provider=HERITAGE, sourceThrough=PRICECHARTING, REALIZED_SALE');
ok(her?.hrn === '20', 'HRN 20 parsed from the Heritage row title (row fact only)');
const ebaySold = rows.find((r) => r.provider === 'EBAY' && r.evidenceClass === 'REALIZED_SALE');
ok(!!ebaySold && ebaySold.sourceThrough === 'PRICECHARTING' && ebaySold.providerRecordId === '123456789012', 'eBay sold row keeps provider EBAY, sourceThrough PRICECHARTING, providerRecordId');
const lad = rows.filter((r) => r.evidenceClass === 'STRUCTURED_HISTORICAL');
ok(lad.length >= 1 && lad.every((r) => r.provider === 'PRICECHARTING' && r.saleDate === null), 'PC ladder rows are STRUCTURED_HISTORICAL, never REALIZED_SALE');
const rt = JSON.parse(JSON.stringify(ne));
const { getMarketEvidence, evidenceIntegrityViolations } = await import('../src/lib/marketEvidence.js');
ok(getMarketEvidence({ normalizedEvidence: rt }) === rt, 'client prefers the server payload (no re-derivation) after a JSON round trip');
ok(rt.rows.find((r) => r.provider === 'HERITAGE')?.sourceThrough === 'PRICECHARTING', 'provider/sourceThrough survive server→client serialization');
ok(evidenceIntegrityViolations(rows).length === 0, 'server payload passes the evidence-integrity invariants');
origLog(`  inventory: ${JSON.stringify(ne?.inventory)}`);
origLog(`  soldCompDiagnostics: ${JSON.stringify(d.body?.soldCompDiagnostics)}`);

global.fetch = originalFetch;
origLog(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
