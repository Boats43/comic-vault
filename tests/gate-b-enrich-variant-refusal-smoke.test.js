// GATE B (2026-10-20) -- REAL-HANDLER SMOKE for the api/enrich.js wiring added by the exact-variant-evidence repair (GK-138 rule: any dispatch that edits api/enrich.js wiring ships a
// real-handler invocation, otherwise it must be labelled MIRRORED-WIRING-UNVERIFIED). The handler is imported and called with a mock req/res; the ONLY thing stubbed is the network
// (global fetch): eBay Browse returns the pool for each scenario, every other provider returns nothing. No real provider is contacted; fake credentials; KV unset.
//
// The pools are the real Production Old Man Logan #25 evidence: the 16 regular-cover asks stored in `rawComps` (observed before the variant was confirmed) and the 5 stored 1:25 asks.
//   S1  variant 1:25 + the 16 regular covers  -> an explicit, labelled refusal: no price, no bands, a reason that names the variant and counts (never a $4 band)
//   S2  variant 1:25 + the 5 variant asks     -> priced from exactly those 5, and the response carries the proof (priceBands.variantEvidence)
//   S3  variant 1:25 + both pools mixed       -> priced from the 5 variant asks only
//   S4  NO variant   + the 16 regular covers  -> unchanged generic behavior (priced; no variantEvidence anywhere)
// Whatever each scenario returns for refusal/pricing is asserted; the response is also checked against the contract rule that a refused card carries no band and is not listable.
// Invoke: node tests/gate-b-enrich-variant-refusal-smoke.test.js
import './helpers/spendGuardTestSetup.js';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: 'gate-b-smoke-principal' }).token;
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'ANTHROPIC_API_KEY']) delete process.env[k];
process.env.EBAY_APP_ID = 'test-app-id'; process.env.EBAY_CERT_ID = 'test-cert-id'; process.env.PRICECHARTING_TOKEN = 'test-pc-token';

const REGULAR = [
  [5.99, 'Old Man Logan #25 Mike Deodato Jr. (Marvel Comics August 2017)'], [2.5, 'Old Man Logan: Days of Anger #25 - Marvel 2017 Mike Deodato Jr. (Wolverine) VFNM'],
  [10, 'OLD MAN LOGAN #25 1st Print vs MAESTRO Marvel Comics 2017 WOLVERINE'], [4.24, 'Old Man Logan (2nd Series) #25 NM 9.4 2017  Mike Deodato Jr. Cover'],
  [4.24, 'Old Man Logan #25 NM+ 2017 Marvel Comics'], [3.35, 'OLD MAN LOGAN #25 MARVEL COMICS "B3"'], [3.99, 'OLD MAN LOGAN #25'], [9.99, 'Old Man Logan #25 Marvel Comics'],
  [3.3, 'Old Man Logan #25 NM (2017) Marvel Comics'], [3.96, 'OLD MAN LOGAN (2016 MARVEL) #25'], [2.99, 'Old Man Logan #25 (2017) NM Ed Brisson Marvel Comics'],
  [2.99, 'Old Man Logan #25 (2017) Old Man Logan Mint'], [4.63, 'OLD MAN LOGAN #25 (MARVEL 2017) "NEW UNREAD"'], [5, 'Old Man Logan #25 Main Cover 2017, Marvel NM'],
  [6.58, 'Old Man Logan #25 (NM) `17 Brisson/ Deodato  (1st Print)'], [4.92, 'Old Man Logan #25 Marvel Comics'],
];
const VARIANT = [
  [15, 'Marvel Comics OLD MAN LOGAN #25 Mike Deodato 1:25 Variant Cover 2017 NM!'], [14.99, 'OLD MAN LOGAN #25 - Marvel Comics Mike Deodato Jr 1:25 Variant Cover'],
  [19.99, 'Old Man Logan #25 1:25 Mike Deodato Variant Marvel 2016 VF/NM'], [14.99, 'Old Man Logan #25 1:25 Deodato Teaser Variant 2017 NM-/NM'],
  [24.99, 'Old Man Logan #25 - 1:25 Mike Deodato variant Cover - Maestro app - NM- - Marvel'],
];
const ebayItem = ([price, title], i) => ({
  itemId: `v1|4000000000${i}|0`, title, leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' }, price: { value: String(price), currency: 'USD' },
  itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7C4000000000${i}%7C0`, seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
  condition: 'Used', conditionId: '3000', thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }], buyingOptions: ['FIXED_PRICE'],
  itemWebUrl: `https://www.ebay.com/itm/4000000000${i}`, itemLocation: { postalCode: '000**', country: 'US' }, legacyItemId: `4000000000${i}`, adultOnly: false,
  itemOriginDate: '2026-10-10T18:07:04.000Z', itemCreationDate: '2026-10-10T18:07:04.000Z', listingMarketplaceId: 'EBAY_US',
});
let POOL = [];
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
const realFetch = global.fetch;
const urls = [];
global.fetch = async (url) => {
  const u = String(url); urls.push(u.slice(0, 100));
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'fake-token', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('item_summary/search') || u.includes('search_by_image')) return json({ itemSummaries: POOL.map(ebayItem), total: POOL.length });
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ error: 'not found' }, 404);
  return json({});
};

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const realLog = console.log;
const handler = (await import('../api/enrich.js')).default;

// confirm=true sends the variant the way a real operator correction does (manualAuthority + the full manual-request contract). A bare variant string is a Vision claim, which the
// identity reconciler correctly CLEARS (authority NONE, C8), so it never reaches pricing as a confirmed variant -- see S0 below.
async function call(label, rows, variant, confirm = false) {
  POOL = rows; urls.length = 0;
  const logs = [];
  console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  let status = null, body = null, threw = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader: () => {} };
  try {
    await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: {
      assetType: 'comic', title: 'Old Man Logan', issue: '25', year: '2017', publisher: 'Marvel', variant, grade: 'NM-', numericGrade: null, isGraded: false,
      confidence: 'high', reason: 'smoke', skipImageSearch: true, images: [],
      ...(confirm ? { manualAuthority: { correctedBy: 'user', correctedFields: ['variant'] }, manualIdentity: true, skipVision: true, identitySource: 'manual' } : {}),
    } }, res);
  } catch (e) { threw = e; }
  console.log = realLog;
  realLog(`  [${label}] status=${status} price=${body && body.price} source=${body && body.pricingSource} refused=${body && body.refusedToPrice} bands=${body && body.priceBands ? JSON.stringify({ m: body.priceBands.market, c: body.priceBands.count }) : body && body.priceBands} ebayCalls=${urls.filter((u) => u.includes('search')).length}`);
  return { status, body, threw, logs };
}

realLog('\n=== GATE B real-handler smoke: variant-evidence wiring in api/enrich.js ===\n');
let r = await call('S1 CONFIRMED variant 1:25 + 16 regular covers', REGULAR.map((x) => x), '1:25', true);
ok(r.threw === null && r.status === 200, `S1: the handler ran without throwing (status ${r.status}${r.threw ? ', ' + r.threw.message : ''})`);
ok(!r.logs.some((l) => l.includes('ReferenceError')), 'S1: no ReferenceError anywhere in the run (wiring-scope check)');
ok(r.body && r.body.price == null && r.body.refusedToPrice === true, `S1: no price, refused (price ${r.body && r.body.price}, refused ${r.body && r.body.refusedToPrice})`);
ok(r.body && !r.body.priceBands, 'S1: no band is emitted for the regular covers (the old behavior emitted a $4.18 band)');
ok(r.body && r.body.pricingSource === 'refused-variant-evidence-insufficient', `S1: the refusal is the explicit labelled state (got ${r.body && r.body.pricingSource})`);
ok(r.body && r.body.variantEvidence && r.body.variantEvidence.insufficient === true && r.body.variantEvidence.applicable === 0 && r.body.variantEvidence.nonVariant > 0, `S1: the reason carries the counts (${r.body && JSON.stringify(r.body.variantEvidence)})`);
ok(r.body && /1:25/.test(String(r.body.priceNote || '')), 'S1: the operator-facing note names the variant');
ok(r.body && r.body.contract && r.body.contract.listable !== true && r.body.contract.state === 'REFUSED', `S1: the contract is REFUSED and not listable (state ${r.body && r.body.contract && r.body.contract.state}, listable ${r.body && r.body.contract && r.body.contract.listable})`);

r = await call('S2 CONFIRMED variant 1:25 + 5 variant asks', VARIANT, '1:25', true);
ok(r.threw === null && r.status === 200 && !r.logs.some((l) => l.includes('ReferenceError')), 'S2: ran cleanly');
ok(r.body && r.body.priceBands && r.body.priceBands.count === 5 && r.body.priceBands.variantEvidence && r.body.priceBands.variantEvidence.applicable === 5 && r.body.priceBands.variantEvidence.nonVariant === 0, `S2: priced from exactly the 5 variant asks, band carries the proof (${r.body && r.body.priceBands && JSON.stringify(r.body.priceBands.variantEvidence)})`);
ok(r.body && r.body.refusedToPrice !== true && r.body.pricingSource === 'active_ask_derived', `S2: not refused; honest source label (got ${r.body && r.body.pricingSource})`);
ok(r.body && r.body.contract && r.body.contract.listable !== true, `S2: still NOT listable (asks only, no sold evidence; consistency is not sufficiency) -- state ${r.body && r.body.contract && r.body.contract.state}, listable ${r.body && r.body.contract && r.body.contract.listable}`);

r = await call('S3 CONFIRMED variant 1:25 + mixed pool', [...REGULAR, ...VARIANT], '1:25', true);
ok(r.body && r.body.priceBands && r.body.priceBands.count === 5 && r.body.priceBands.variantEvidence && r.body.priceBands.variantEvidence.applicable === 5, `S3: only the 5 variant asks price it (${r.body && r.body.priceBands && JSON.stringify(r.body.priceBands.variantEvidence)})`);
ok(r.body && r.body.rawComps && r.body.rawComps.count === 5 && r.logs.some((l) => /variant preference filter: before=21 after=5/.test(l)), 'S3: the upstream comps variant preference already removed the 16 regular covers (21 -> 5), so none reach the band engine');
ok(r.body && r.body.price !== '$4.18' && r.body.pricingSource === 'active_ask_derived', `S3: price is not the regular-cover $4.18 and is labelled an ask-derived price, not a sale (${r.body && r.body.price}, ${r.body && r.body.pricingSource})`);

// S5: notation mismatch. The operator confirmed "1/25"; listings say "1:25". comps.js variant preference previously matched on the stored string, kept all 21 (0 match), and the price-sanity filter then dropped the 5 genuine asks as outliers; the band-level evidence
// is now notation-insensitive too (canonicalizeRatioVariant), so both layers agree: 21 -> 5, priced from the 5 variant asks only.
r = await call('S5 CONFIRMED variant 1/25 + mixed pool (notation mismatch)', [...REGULAR, ...VARIANT], '1/25', true);
ok(r.body && r.body.priceBands && r.body.priceBands.count === 5 && r.body.priceBands.variantEvidence && r.body.priceBands.variantEvidence.applicable === 5 && r.body.rawComps && r.body.rawComps.count === 5 && r.logs.some((l) => /variant preference filter: before=21 after=5/.test(l)), `S5: 1/25 and 1:25 normalize end to end -- the upstream variant preference narrows 21 -> 5 and the band is built from the 5 (${r.body && r.body.priceBands && JSON.stringify(r.body.priceBands.variantEvidence)})`);
ok(r.body && r.body.pricingSource === 'active_ask_derived' && r.body.price !== '$4.18', `S5: not the regular-cover price (${r.body && r.body.price})`);

// S0: a bare Vision claim of 1:25 is NOT variant authority (Directive AM F-3 / C8): the reconciler clears it before pricing. The book is then priced as the regular edition and the
// response carries no variant claim at all. This pins that boundary: an unconfirmed variant never produces variant-exact pricing, and never silently prices the regular covers AS the variant.
r = await call('S0 UNCONFIRMED (bare Vision) variant 1:25 + 16 regular covers', REGULAR, '1:25', false);
ok(r.body && !r.body.variantNote && r.logs.some((l) => /CLEARING confirmedVariant "1:25" -> null/.test(l)), 'S0: the uncorroborated Vision variant is cleared; no variant claim is carried');
ok(r.body && (!r.body.priceBands || !r.body.priceBands.variantEvidence), 'S0: no variant-exact evidence is claimed for the regular-edition price');

r = await call('S4 NO variant + 16 regular covers', REGULAR, '');
ok(r.threw === null && r.status === 200, 'S4: ran cleanly');
ok(r.body && !('variantEvidence' in (r.body.priceBands || {})) || (r.body && r.body.priceBands && r.body.priceBands.variantEvidence == null), 'S4: no variantEvidence on a non-variant book (generic behavior unchanged)');
ok(r.body && r.body.pricingSource !== 'refused-variant-evidence-insufficient', `S4: never refused for variant evidence (got ${r.body && r.body.pricingSource})`);

global.fetch = realFetch;
realLog(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
