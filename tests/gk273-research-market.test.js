// GK-273 — Research the Market: bounded fallback capability.
// Real handler invocation with an injected provider stub, in-memory guard
// store and item loader. No network, no database, no real model spend.
// Run: node tests/gk273-research-market.test.js
import fs from 'node:fs';
import crypto from 'node:crypto';

if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = crypto.randomBytes(32).toString('base64url');
delete process.env.RESEARCH_MODEL;
delete process.env.RESEARCH_MAX_WEB_SEARCHES;
delete process.env.RESEARCH_MAX_WEB_FETCHES;
delete process.env.RESEARCH_MAX_RUNS_PER_PRINCIPAL_PER_DAY;

const { issueToken } = await import('../src/modules/auth/token.js');
const R = await import('../src/lib/researchMarket.js');
const S = await import('../src/lib/researchStore.js');
const P = await import('../src/lib/researchPresentation.js');
const ME = await import('../src/lib/marketEvidence.js');
const DA = await import('../src/lib/displayAuthority.js');
const H = await import('../api/research-market.js');

const log = console.log;
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; log(`  ✓ ${l}`); } else { failed++; log(`  ✗ ${l}`); } };

const tokenFor = (id) => issueToken({ principalId: id }).token;
const SENTINEL = 'SENTINEL_FULL_PAGE_BODY_DO_NOT_PERSIST';

const URL_HER = 'https://comics.ha.com/itm/classic-comics-13-hrn-20/1';
const URL_EBAY = 'https://www.ebay.com/itm/227392678399';
const URL_GUIDE = 'https://example-guide.test/classic-comics/13';

const rowsJson = (rows, sufficiency = 'SUFFICIENT', summary = 'Found two sales.') => JSON.stringify({ rows, summary, sufficiency });
const baseRows = () => ([
  { provider: 'Heritage Auctions', sourceUrl: URL_HER, sourceTitle: 'Classic Comics #13 HRN 20', evidenceClass: 'REALIZED_SALE', price: 141, currency: 'USD', saleDate: '2026-05-01', title: 'Classic Comics #13', issue: '13', year: 1943, publisher: 'Gilberton', variant: null, edition: 'Original', printing: null, country: null, hrn: '20', grade: '1.0', gradingCompany: null, rawOrSlabbed: 'RAW', identityMatch: 'EXACT', matchConfidence: 0.8, note: 'HRN 20 sale' },
  { provider: 'eBay', sourceUrl: URL_EBAY, sourceTitle: 'Classic Comics 13 Canadian', evidenceClass: 'ACTIVE_ASK', price: 59.95, currency: 'USD', saleDate: null, title: 'Classic Comics #13 Canadian edition', issue: '13', year: null, publisher: null, variant: null, edition: 'Canadian edition', printing: null, country: 'Canada', hrn: '71', grade: 'GD', gradingCompany: null, rawOrSlabbed: 'RAW', identityMatch: 'SIMILAR', matchConfidence: 0.5, note: 'Canadian ask' },
  { provider: 'Guide', sourceUrl: URL_GUIDE, sourceTitle: 'Guide', evidenceClass: 'REFERENCE', price: null, currency: 'USD', saleDate: null, title: 'Classic Comics #13', issue: '13', year: null, publisher: null, variant: null, edition: null, printing: null, country: null, hrn: null, grade: null, gradingCompany: null, rawOrSlabbed: 'UNKNOWN', identityMatch: 'UNKNOWN', matchConfidence: 0.4, note: 'catalogue entry' },
]);

const makeMessage = ({ rows = baseRows(), stop = 'end_turn', searches = 2, fetches = 1, text = null, sufficiency = 'SUFFICIENT', extraUrls = [] } = {}) => ({
  model: 'claude-haiku-4-5-20251001',
  stop_reason: stop,
  content: [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'classic comics 13 sold' } },
    { type: 'web_search_tool_result', tool_use_id: 's1', content: [URL_HER, URL_EBAY, URL_GUIDE, ...extraUrls].map((u) => ({ type: 'web_search_result', url: u, title: 't', page_age: null, encrypted_content: 'x' })) },
    { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url: URL_HER } },
    { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: URL_HER, retrieved_at: '2026-10-01T00:00:00Z', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: `${SENTINEL} Hammer price $141.00 on 2026-05-01 for Classic Comics #13.` } } } },
    { type: 'text', text: text ?? rowsJson(rows, sufficiency) },
  ],
  usage: { input_tokens: 14000, output_tokens: 750, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: searches, web_fetch_requests: fetches } },
});

let calls = [];
let nextMessage = () => makeMessage();
let failNext = false;
H.__setResearchClientForTests({ beta: { messages: { create: async (params) => { calls.push(params); if (failNext) { failNext = false; const e = new Error('boom'); e.status = 500; throw e; } return nextMessage(); } } } });

const ITEMS = {
  gated: { id: 'cc13', assetCategory: 'comic', attributes: { title: 'Classic Comics', issue: '13', year: 1949, publisher: 'Gilberton', grade: 'FR 1.0', isGraded: false, identityConfident: false, variant: 'Canadian edition', foreignEdition: true, contract: { actionAuthority: { identityStanding: 'CONFLICTED', marketStanding: 'FALLBACK_ONLY', state: 'LOCKED' }, price: null }, decision: { action: 'RESEARCH' }, price: '$59.95' } },
};
H.__setResearchItemLoaderForTests(async ({ principalId, id }) => {
  // Mirrors the collection module's ownership law: a principal only ever sees its own rows.
  if (!principalId.startsWith('p-') || id !== 'cc13') { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
  return JSON.parse(JSON.stringify(ITEMS.gated));
});

const mkRes = () => { const r = { code: null, body: null, headers: {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; } }; return r; };
let ipN = 0;
const call = async (principal, method = 'POST', body = { collectionItemId: 'cc13' }, ip = null) => {
  ip = ip || `10.${Math.floor(++ipN / 250)}.${ipN % 250}.1`;
  const res = mkRes();
  await H.default({ method, headers: { authorization: `Bearer ${tokenFor(principal)}`, 'x-forwarded-for': ip }, body: method === 'POST' ? body : undefined, query: method === 'GET' ? body : {} }, res);
  return res;
};
const fresh = () => { S.setResearchStoreForTests(S.createMemoryResearchStore()); calls = []; nextMessage = () => makeMessage(); };

console.log = () => {}; // silence handler logs
const out = (...a) => log(...a);

out('\n=== GK-273 Research the Market ===\n');

out('— WEB_RESEARCH is provenance, not an evidence class —');
ok(!R.RESEARCH_EVIDENCE_CLASSES.includes('WEB_RESEARCH') && !Object.keys(ME.EVIDENCE_CLASS).includes('WEB_RESEARCH'), 'WEB_RESEARCH is not in any evidence-class taxonomy');
fresh();
let r1 = await call('p-A');
ok(r1.code === 200, `POST ok (${r1.code} ${r1.body?.error || ''})`);
const rec = r1.body.record;
ok(rec.rows.length === 3 && rec.rows.every((x) => x.sourceMode === 'WEB_RESEARCH' && R.RESEARCH_EVIDENCE_CLASSES.includes(x.evidenceClass)), 'every row: sourceMode=WEB_RESEARCH + a normal evidenceClass');
ok(rec.rows.find((x) => x.provider === 'Heritage Auctions').evidenceClass === 'REALIZED_SALE', 'Heritage result: provider=HERITAGE-ish, REALIZED_SALE, via WEB_RESEARCH');

out('\n— authority: AI cannot confirm —');
ok(rec.rows.every((x) => x.authorityStatus !== 'CONFIRMED'), 'no row is CONFIRMED');
ok(rec.rows.find((x) => x.provider === 'Heritage Auctions').authorityStatus === 'CANDIDATE', 'new realized sale starts CANDIDATE');
ok(R.CONFIRMATION_RULES.length === 0, 'no promotion rule exists (empty by design)');
const forged = R.normalizeResearchRows({ rows: [{ ...baseRows()[0], authorityStatus: 'CONFIRMED', confirmed: true }] }, R.extractToolEvidence(makeMessage()), { principalId: 'p-A', retrievedAt: 'x' });
ok(forged.rows[0].authorityStatus === 'CANDIDATE', 'a model-supplied CONFIRMED is ignored');
ok(rec.summary && rec.counts.candidateRealized === 1 && rec.counts.confirmedRealized === 0, 'counts: 1 candidate realized, 0 confirmed');

out('\n— pricing boundary —');
const itemBefore = JSON.stringify(ITEMS.gated);
ok(!('price' in rec) && !('recommendedPrice' in rec) && !('contract' in rec), 'record has no price/contract fields');
ok(rec.researchRange && rec.researchRange.low === 141 && rec.researchRange.n === 1, 'RESEARCH RANGE is derived from candidate exact realized rows only');
ok(JSON.stringify(ITEMS.gated) === itemBefore, 'the collection item is not mutated');
const src = fs.readFileSync(new URL('../api/research-market.js', import.meta.url), 'utf8');
ok(!/enrich|decisionEngine|pricingEngine|responseContract|list-ebay|updateCollectionItem|createCollectionItem|pg\b/.test(src.replace(/\/\/.*$/gm, '')), 'static: handler imports no pricing/contract/decision/listing/DB-write code');
const gatedItem = { ...ITEMS.gated.attributes, id: 'cc13' };
ok(DA.getDisplayPrice(gatedItem) === 0 && DA.getDisplayPrice({ ...gatedItem, researchRecord: rec }) === 0, 'display price authority is unchanged by the presence of research (still no price)');
ok(P.describePricingAuthority(gatedItem).recommended === '—' && P.describePricingAuthority(gatedItem).state === 'LOCKED', 'UI echoes existing authority read-only; recommended stays —');
const confidentItem = { ...gatedItem, identityConfident: true, contract: { price: 59.95, state: 'PRICED', actionAuthority: { state: 'READY' } } };
ok(DA.getDisplayPrice(confidentItem) === 59.95, 'Q41/operator and engine price law is untouched (research is context only)');

out('\n— classification stays honest —');
ok(rec.rows.find((x) => x.provider === 'eBay').evidenceClass === 'ACTIVE_ASK' && rec.rows.find((x) => x.provider === 'eBay').saleDate === null, 'active ask stays ACTIVE_ASK (no sale date)');
ok(rec.rows.find((x) => x.provider === 'eBay').authorityStatus === 'SIMILAR', 'a different-edition row stays SIMILAR, not exact');
ok(rec.similarRange == null && rec.counts.similarRealized === 0 && rec.counts.activeAsks === 1, 'similar active ask is not counted as similar-realized');
const grouped = P.groupResearchRows(rec);
ok(grouped.candidateRealized.length === 1 && grouped.activeAsks.length === 1 && grouped.references.length === 1 && grouped.confirmedRealized.length === 0, 'UI sections: confirmed/candidate/similar/asks/references grouped separately');
const simRealized = R.normalizeResearchRows({ rows: [{ ...baseRows()[0], identityMatch: 'SIMILAR' }] }, R.extractToolEvidence(makeMessage()), { principalId: 'p-A', retrievedAt: 'x' });
ok(simRealized.rows[0].authorityStatus === 'SIMILAR' && R.summarizeResearchRows(simRealized.rows).researchRange === null, 'similar realized sale stays SIMILAR and never enters the research range');

out('\n— edition / country authority —');
ok(rec.asset.editionStanding === 'UNRESOLVED' && rec.asset.country.value === null && rec.asset.hrn.value === null, 'asset edition stays UNRESOLVED; country/HRN stay UNKNOWN despite "Canadian"/HRN rows');
const sentFacts = JSON.parse(calls[0].messages[0].content.find((c) => c.type === 'text').text.split('\n')[1]);
ok(sentFacts.variant.value === null && sentFacts.country.value === null && sentFacts.hrn.value === null && sentFacts.editionStanding === 'UNRESOLVED', 'the request never asserts Canadian/variant/HRN as fact (raw Vision variant not sent)');
ok(!JSON.stringify(sentFacts).toLowerCase().includes('canadian'), 'no "Canadian" token anywhere in the facts sent to the model');
ok(sentFacts.title.status === 'PROVISIONAL' && sentFacts.year.status === 'PROVISIONAL' && sentFacts.identityStanding === 'CONFLICTED', 'conflicted identity is sent as PROVISIONAL hints, flagged CONFLICTED');
const confFacts = R.buildResearchFacts({ ...ITEMS.gated.attributes, identityConfident: true, contract: { actionAuthority: { identityStanding: 'CONFIRMED' } }, confirmedVariant: 'Newsstand' });
ok(confFacts.title.status === 'ESTABLISHED' && confFacts.variant.value === 'Newsstand' && confFacts.variant.status === 'ESTABLISHED', 'confirmed identity/variant are ESTABLISHED');
ok(!rec.rows.some((x) => x.authorityStatus === 'CONFIRMED' && /canad/i.test(`${x.country} ${x.edition}`)), 'no Canadian claim reaches CONFIRMED from web inference');

out('\n— provenance / no fabrication / no page bodies —');
ok(rec.rows.every((x) => /^https?:\/\//.test(x.sourceUrl)), 'source URL preserved on every row');
const fab = R.normalizeResearchRows({ rows: [{ ...baseRows()[0], sourceUrl: 'https://invented.example/never-returned' }] }, R.extractToolEvidence(makeMessage()), { principalId: 'p-A', retrievedAt: 'x' });
ok(fab.rows.length === 0 && fab.rejected[0].reason === 'source-url-not-returned-by-tools', 'a URL the tools never returned is rejected (AI cannot create facts)');
ok(rec.rows.find((x) => x.provider === 'Heritage Auctions').priceSupport === 'IN_SOURCE_TEXT', 'price verified against fetched text when available');
ok(rec.rows.find((x) => x.provider === 'eBay').priceSupport === 'SEARCH_RESULT_ONLY', 'unverifiable price is labelled SEARCH_RESULT_ONLY');
const badPrice = R.normalizeResearchRows({ rows: [{ ...baseRows()[0], price: 999 }] }, R.extractToolEvidence(makeMessage()), { principalId: 'p-A', retrievedAt: 'x' });
ok(badPrice.rows[0].flags.includes('price-not-found-in-fetched-text'), 'a price the fetched page does not contain is flagged');
const dump = JSON.stringify((await S.researchStore()._dump?.()) || {});
ok(!dump.includes(SENTINEL) && !JSON.stringify(rec).includes(SENTINEL), 'no fetched page body is persisted or returned');
ok(JSON.stringify(rec).length < 12000, 'persisted record is a bounded receipt');

out('\n— cache —');
fresh();
await call('p-A'); const c2 = await call('p-A');
ok(calls.length === 1 && c2.body.cache === 'HIT', 'second identical request is served from the result cache (1 provider call)');
const c3 = await call('p-A', 'POST', { collectionItemId: 'cc13', refresh: true });
ok(calls.length === 2 && c3.body.cache === 'MISS', 'explicit refresh bypasses the cache');
const g = await call('p-A', 'GET', { collectionItemId: 'cc13' });
ok(g.code === 200 && g.body.record?.rows?.length === 3 && calls.length === 2, 'GET returns the saved research without any provider call');

out('\n— tenant isolation —');
fresh();
await call('p-A');
const gB = await call('p-B', 'GET', { collectionItemId: 'cc13' });
ok(gB.code === 200 && gB.body.record === null, "principal B cannot read principal A's saved research");
const pB = await call('p-B');
ok(pB.code === 200 && pB.body.cache === 'MISS' && calls.length === 2, "principal B's identical request is NOT served from A's cache (own run, own counter)");
const unauth = mkRes();
await H.default({ method: 'POST', headers: {}, body: { collectionItemId: 'cc13' } }, unauth);
ok(unauth.code === 401 && calls.length === 2, 'no token → 401, no provider call');
const foreign = await call('x-not-owner');
ok(foreign.code === 404 && calls.length === 2, 'a non-owner gets 404 (existence not revealed), no provider call');

out('\n— hard cost controls —');
fresh();
await call('p-A');
const p = calls[0];
const search = p.tools.find((t) => t.name === 'web_search'); const fetchT = p.tools.find((t) => t.name === 'web_fetch');
ok(search.max_uses === 3 && fetchT.max_uses === 3, 'server-enforced max_uses: 3 searches, 3 fetches');
ok(fetchT.max_content_tokens === 2000, 'fetch content capped at 2000 tokens');
ok(p.max_tokens <= 1200, `output ceiling enforced (max_tokens=${p.max_tokens})`);
ok(p.model === 'claude-haiku-4-5-20251001' && !/sonnet|opus/i.test(p.model), 'default model is Haiku 4.5; no Sonnet/Opus');
ok(calls.length === 1, 'exactly one provider request (no agent loop on our side)');
process.env.RESEARCH_MAX_WEB_SEARCHES = '99'; process.env.RESEARCH_MAX_WEB_FETCHES = '99'; process.env.RESEARCH_MAX_OUTPUT_TOKENS = '99999'; process.env.RESEARCH_MAX_CONTENT_TOKENS_PER_FETCH = '99999';
const clamped = R.resolveResearchConfig();
ok(clamped.maxWebSearches === 3 && clamped.maxWebFetches === 3 && clamped.maxOutputTokens === 1200 && clamped.maxContentTokensPerFetch === 2000, 'env can only LOWER the caps, never raise them');
process.env.RESEARCH_MAX_WEB_SEARCHES = '1';
ok(R.resolveResearchConfig().maxWebSearches === 1, 'env can lower a cap');
for (const k of ['RESEARCH_MAX_WEB_SEARCHES', 'RESEARCH_MAX_WEB_FETCHES', 'RESEARCH_MAX_OUTPUT_TOKENS', 'RESEARCH_MAX_CONTENT_TOKENS_PER_FETCH']) delete process.env[k];
ok(R.resolveResearchConfig({ RESEARCH_CACHE_TTL_SECONDS: '60' }).cacheTtlSeconds === 86400, 'cache TTL cannot go below 24h');
ok(R.resolveResearchConfig().cacheTtlSeconds === 72 * 3600, 'default cache TTL is 72h');
fresh();
nextMessage = () => makeMessage({ stop: 'pause_turn', text: rowsJson(baseRows()) });
const pz = await call('p-A');
ok(calls.length === 1 && pz.body.record.status === 'PAUSED_NOT_RESUMED' && pz.body.record.sufficiency === 'INSUFFICIENT', 'pause_turn is NOT resumed; result is INSUFFICIENT');
fresh();
nextMessage = () => makeMessage({ searches: 5, fetches: 4 });
const cv = await call('p-A');
ok(cv.body.record.capViolations.includes('web-searches') && cv.body.record.capViolations.includes('web-fetches'), 'provider usage above the caps is audited and recorded');
fresh();
nextMessage = () => makeMessage({ rows: [], text: 'I could not find anything useful.', sufficiency: 'INSUFFICIENT' });
const ins = await call('p-A');
ok(ins.code === 200 && ins.body.record.status === 'UNPARSEABLE' && ins.body.record.rows.length === 0 && ins.body.record.sufficiency === 'INSUFFICIENT', 'unparseable/empty result → INSUFFICIENT, no manufactured evidence');
fresh();
nextMessage = () => makeMessage({ rows: [baseRows()[1]], sufficiency: 'SUFFICIENT' });
const askOnly = await call('p-A');
ok(askOnly.body.record.sufficiency === 'INSUFFICIENT' && askOnly.body.record.researchRange === null, 'asks alone are never "sufficient" and produce no research range');

out('\n— daily limit (per principal, configurable, fail-closed) —');
fresh();
const results = [];
for (let i = 0; i < 4; i++) results.push((await call('p-A', 'POST', { collectionItemId: 'cc13', refresh: true })).code);
ok(results.join(',') === '200,200,200,429' && calls.length === 3, `4th run in a day is refused (${results.join(',')}), provider called 3 times`);
const lim = await call('p-A', 'POST', { collectionItemId: 'cc13', refresh: true });
ok(lim.body.error === 'Research limit reached for today.' && lim.body.code === 'RESEARCH_LIMIT_REACHED', 'clean bounded limit message');
const otherP = await call('p-B', 'POST', { collectionItemId: 'cc13', refresh: true });
ok(otherP.code === 200, 'the limit is per principal (B unaffected)');
const cachedAtLimit = await call('p-A');
ok(cachedAtLimit.code === 200 && cachedAtLimit.body.cache === 'HIT', 'a cache hit is free and still served at the limit');
process.env.RESEARCH_MAX_RUNS_PER_PRINCIPAL_PER_DAY = '1';
fresh();
await call('p-A', 'POST', { collectionItemId: 'cc13', refresh: true });
ok((await call('p-A', 'POST', { collectionItemId: 'cc13', refresh: true })).code === 429, 'the daily limit is configurable');
delete process.env.RESEARCH_MAX_RUNS_PER_PRINCIPAL_PER_DAY;
fresh();
failNext = true;
const pf = await call('p-A');
const afterFail = await call('p-A', 'POST', { collectionItemId: 'cc13', refresh: true });
ok(pf.code === 502 && afterFail.code === 200, 'a failed provider call does not consume a daily run');
S.setResearchStoreForTests({ get: async () => { throw new S.ResearchStoreUnavailableError(); }, set: async () => { throw new S.ResearchStoreUnavailableError(); }, setNx: async () => { throw new S.ResearchStoreUnavailableError(); }, incr: async () => { throw new S.ResearchStoreUnavailableError(); }, decr: async () => {}, del: async () => {} });
calls = [];
const dead = await call('p-A');
ok(dead.code === 503 && calls.length === 0, 'guard store unavailable → fail CLOSED, no provider call');
fresh();
const lockStore = S.createMemoryResearchStore(); S.setResearchStoreForTests(lockStore);
const fp = R.researchFingerprint(R.buildResearchFacts({ ...ITEMS.gated.attributes, assetCategory: 'comic' }));
await lockStore.setNx(S.lockKey('p-A', 'c:cc13', fp), '1', 100);
const busy = await call('p-A');
ok(busy.code === 409 && calls.length === 0, 'an in-flight run for the same item is not duplicated (409)');

out('\n— usage receipt (operational metadata) —');
fresh();
const ur = (await call('p-A')).body.record.usage;
ok(ur.model === 'claude-haiku-4-5-20251001' && ur.webSearchCount === 2 && ur.webFetchCount === 1 && ur.inputTokens === 14000 && ur.outputTokens === 750 && ur.cacheReadTokens === 0 && ur.cacheWriteTokens === 0, 'receipt carries model, search/fetch counts and token usage');
ok(ur.startedAt && ur.completedAt && ur.stopReason === 'end_turn', 'receipt carries start/complete timestamps');
const expected = Math.round(((14000 / 1e6) * 1 + (750 / 1e6) * 5 + 2 * 0.01) * 1e5) / 1e5;
ok(ur.estimatedCostUsd === expected && ur.priceTableVersion === R.RESEARCH_PRICE_TABLE.version, `estimatedCostUsd derived from the versioned price table (${ur.estimatedCostUsd})`);
ok(ur.estimatedCostUsd <= 0.05, 'a normal run lands at or under the ~$0.05 design target');
ok(R.estimateResearchCostUsd({ model: 'some-unknown-model', inputTokens: 1 }) === null, 'unknown model → null cost, never an invented number');
ok(!('estimatedCostUsd' in (await call('p-A')).body.record.rows[0]), 'telemetry is not mixed into evidence rows');

out('\n— image cost control —');
fresh();
const png = 'data:image/png;base64,' + Buffer.alloc(64, 1).toString('base64');
await call('p-A', 'POST', { collectionItemId: 'cc13', frontImage: png });
const imgs = calls[0].messages[0].content.filter((c) => c.type === 'image');
ok(imgs.length === 1, 'at most one canonical front image is sent');
ok(calls[0].messages.length === 1, 'the image is not re-sent across iterations (single request)');
fresh();
await call('p-A', 'POST', { collectionItemId: 'cc13', frontImage: 'data:text/html;base64,AAAA' });
ok(calls[0].messages[0].content.filter((c) => c.type === 'image').length === 0, 'a non-image/invalid frontImage is ignored');

out('\n— universal contract —');
const watch = R.buildResearchFacts({ title: 'Rolex Submariner', assetType: 'watch', identityConfident: true, isGraded: false });
ok(watch.assetCategory === 'watch' && watch.title.value === 'Rolex Submariner', 'facts contract is category-neutral (watch)');
ok(R.buildResearchTools(R.resolveResearchConfig()).length === 2 && !/comic/i.test(R.RESEARCH_SYSTEM_PROMPT), 'tool set and system prompt are not comic-specific');

out('\n— UI contract —');
ok(P.shouldOfferResearch({ contract: { actionAuthority: { marketStanding: 'NO_SOLD_EVIDENCE' } } }) && P.shouldOfferResearch({ decision: { action: 'RESEARCH' } }) && !P.shouldOfferResearch({ contract: { actionAuthority: { marketStanding: 'EXACT_CURRENT' } }, decision: { action: 'LIST_NOW' }, comps: { count: 9 }, soldComps: [1, 2, 3] }), 'offered only when structured evidence is insufficient');
const panelSrc = fs.readFileSync(new URL('../src/components/ResearchMarketPanel.jsx', import.meta.url), 'utf8');
ok(/VIEW SOURCE/.test(panelSrc) && /AUTOMATED PRICING AUTHORITY/.test(panelSrc) && /RESEARCH CONCLUSION/.test(panelSrc) && /REFRESH RESEARCH/.test(panelSrc) && /RESEARCH THE MARKET/.test(panelSrc), 'panel has VIEW SOURCE, conclusion, pricing-authority echo, refresh, and the primary action');
ok(!/AUTO|useEffect\(\(\) => \{ run/.test(panelSrc.replace(/AUTOMATED/g, '')), 'research is never auto-run (operator click only)');
ok(/researchConclusion/.test(panelSrc) && P.researchConclusion(rec).includes('unverified web research'), 'conclusion labels evidence as unverified web research');

out('\n— real render of the results view —');
{
  const { createServer } = await import('vite');
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', root: process.cwd(), optimizeDeps: { noDiscovery: true } });
  try {
    const { ResearchResults } = await server.ssrLoadModule('/src/components/ResearchMarketPanel.jsx');
    const html = renderToStaticMarkup(React.createElement(ResearchResults, { record: rec, item: { ...ITEMS.gated.attributes, id: 'cc13' } }));
    const t = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    ok(['CONFIRMED REALIZED', 'CANDIDATE REALIZED', 'SIMILAR REALIZED', 'ACTIVE ASKS', 'REFERENCES'].every((s) => t.includes(s)), 'all five required sections render');
    ok((html.match(/VIEW SOURCE/g) || []).length === 3 && html.includes(`href="${URL_HER}"`) && html.includes('rel="noopener noreferrer"'), 'every item has a VIEW SOURCE link to its real source URL');
    ok(/Candidate — unverified web research/.test(t) && /web research/.test(t), 'candidate rows are labelled as unverified web research (not provider-certified)');
    ok(/RESEARCH CONCLUSION/.test(t) && /RESEARCH RANGE \(candidate evidence — not a recommended price\)/.test(t), 'conclusion + research range are labelled as non-recommendation');
    ok(/AUTOMATED PRICING AUTHORITY: LOCKED/.test(t) && /Recommended price: —/.test(t), 'existing pricing authority is echoed read-only: LOCKED, recommended —');
    ok(/Canadian edition/.test(t) && /match: similar/.test(t) && !/authority: Confirmed/.test(t), 'the Canadian row is shown as SIMILAR, never confirmed');
    ok(!/CONFIRMED REALIZED \(1\)/.test(t) && /CONFIRMED REALIZED \(0\)/.test(t), 'CONFIRMED REALIZED is empty');
  } finally { await server.close(); }
}

console.log = log;
log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
