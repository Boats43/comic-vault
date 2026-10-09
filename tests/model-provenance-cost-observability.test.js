// Model provenance (WATCH + standard paths) and unknown-model cost observability.
// TICKET: UNASSIGNED. Mocked provider only (global fetch stub installed BEFORE api/grade.js is imported so the
// Anthropic SDK client binds to it). No network, no database, no paid call.
//   node tests/model-provenance-cost-observability.test.js
//
// Observable for "what provenance was recorded": the grade receipt. attachGradeReceipt builds ONE `provenance`
// object and spreads it into BOTH the model_prediction_event rows (`...base`) and issueGradeReceipt, so the
// receipt's provider/model/modelVersion are the same values the prediction event receives (asserted statically below).

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const fs = await import('node:fs');
const { issueToken } = await import('../src/modules/auth/token.js');
const PRINCIPAL = 'model-provenance-test-principal';
const TOKEN = issueToken({ principalId: PRINCIPAL }).token;

// ── scripted provider ────────────────────────────────────────────────────────────────────────────────────
const base = (o) => ({
  title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false,
  isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null,
  labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10',
  priceHigh: '$30', reason: 'Moderate wear.', confidence: 'high', detectedPrice: null, restoration: null,
  defectPenalty: null, cgcPenaltyFlags: null, ...o,
});
const calls = []; // { n, requested }
let script = []; // parsed JSON per Anthropic call, in order
let omitReportedModel = false;
let ebayItems = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'fake', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image')) return json({ itemSummaries: ebayItems, total: ebayItems.length });
  if (u.includes('count_tokens')) return json({ input_tokens: 100 });
  if (u.includes('api.anthropic.com')) {
    const requested = JSON.parse(init.body).model;
    const n = calls.length + 1;
    calls.push({ n, requested });
    const body = {
      id: 'msg_' + n, type: 'message', role: 'assistant',
      model: `reported::${requested}::call${n}`, // distinct per call so cross-attribution is detectable
      content: [{ type: 'text', text: JSON.stringify(script[n - 1] ?? script[script.length - 1]) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 },
    };
    if (omitReportedModel) delete body.model;
    return json(body);
  }
  return json({});
};

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origLog(...a); };

const rs = await import('../src/lib/researchStore.js');
const memStore = rs.createMemoryResearchStore();
rs.setResearchStoreForTests(memStore);
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({
  async set(k, v) { rmem.set(k, JSON.parse(JSON.stringify(v))); },
  async get(k) { return rmem.has(k) ? JSON.parse(JSON.stringify(rmem.get(k))) : null; },
  async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; },
});
const pricing = await import('../src/lib/anthropicPricing.js');
const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');

let ip = 0;
const run = async (extra, responses, { omit = false, items = [] } = {}) => {
  calls.length = 0; logs.length = 0; script = responses; omitReportedModel = omit; ebayItems = items;
  let status = null, body = null, threw = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader: () => {} };
  try {
    await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.9.0.${++ip}` }, body: { images: [PNG], ...extra } }, res);
  } catch (e) { threw = e; }
  const claim = body?.gradeReceiptId
    ? await receiptLib.claimGradeReceipt({ principalId: PRINCIPAL, receiptId: body.gradeReceiptId })
    : null;
  return { status, body, threw, logs: [...logs], calls: [...calls], rec: claim?.ok ? claim.record : null };
};
const watch = (resps, o) => run({ source: 'watch' }, resps, o);
const HI = base({ confidence: 'high' });
const LOW = base({ confidence: 'low' });
const MED = base({ confidence: 'medium' });

origLog('\n=== model provenance + cost observability ===\n');

origLog('— WATCH: accepted-pass attribution');
const w1 = await watch([HI]);
ok(w1.threw === null && w1.status === 200, 'W1 handler 200, no throw');
ok(w1.calls.length === 1, 'W1 accepted at pass 1 (1 model call)');
ok(w1.rec?.model === 'claude-haiku-4-5-20251001' && w1.rec?.modelVersion === 'reported::claude-haiku-4-5-20251001::call1', 'W1 receipt: requested + reported belong to call 1 (Haiku)');
ok(w1.rec?.provider === 'anthropic', 'W1 provider anthropic');

const w2 = await watch([LOW, MED]);
ok(w2.status === 200 && w2.calls.length === 2, 'W2 accepted at pass 2 (2 model calls)');
ok(w2.rec?.modelVersion === 'reported::claude-haiku-4-5-20251001::call2', 'W2 reported model is call 2, NOT first-pass call 1');
ok(w2.rec?.model === 'claude-haiku-4-5-20251001', 'W2 requested model is Haiku');

const w3 = await watch([LOW, LOW, HI]);
ok(w3.status === 200 && w3.calls.length === 3, 'W3 escalated to pass 3 (3 model calls)');
ok(w3.rec?.model === 'claude-opus-4-7' && w3.rec?.modelVersion === 'reported::claude-opus-4-7::call3', 'W3 receipt carries Opus requested + Opus call-3 reported');
ok(!/haiku/.test(`${w3.rec?.model} ${w3.rec?.modelVersion}`), 'W3: no Haiku metadata cross-attributed onto an Opus-produced grade');
ok(w1.rec?.model !== w3.rec?.model && !/opus/.test(`${w1.rec?.model} ${w1.rec?.modelVersion} ${w2.rec?.model} ${w2.rec?.modelVersion}`), 'Haiku-accepted results never carry Opus metadata');

// Reachability: every WATCH return point is reached right after the accepted pass's own call, so
// accepted-pass index == last-attempted-pass index in the real control flow. A "last attempted pass" mutation is
// therefore EQUIVALENT (cannot be killed); the reachable wrong selections are first-pass / wrong-pass metadata,
// which W2 and W3 above discriminate (call1 and call2 reported ids differ from the accepted call's).
ok(w1.calls.length === 1 && w2.calls.length === 2 && w3.calls.length === 3, 'control flow: accepted pass index equals number of calls made at every return point (reachability proof)');

origLog('— missing reported model stays null (never filled from the request)');
const w4 = await watch([HI], { omit: true });
ok(w4.status === 200 && w4.rec?.model === 'claude-haiku-4-5-20251001', 'W4 requested model still recorded');
ok(w4.rec?.modelVersion === null, 'W4 provider-reported model absent => modelVersion null (not substituted from requested)');

origLog('— standard paths keep correct provenance');
const s2 = await run({}, [HI], { items: [] }); // no eBay identity -> Sonnet vision fallback
ok(s2.status === 200 && s2.calls.length === 1, 'S2 Sonnet vision fallback: 1 model call');
ok(s2.rec?.model === 'claude-sonnet-4-5-20250929' && s2.rec?.modelVersion === 'reported::claude-sonnet-4-5-20250929::call1', 'S2 receipt: Sonnet requested + reported');
const items = Array.from({ length: 8 }, (_, i) => ({ title: `Creepy #1 Warren 1964 VG`, itemId: `v1|${i}|0`, price: { value: '50', currency: 'USD' }, image: { imageUrl: 'x' } }));
const s1 = await run({}, [HI], { items });
ok(s1.logs.some((l) => l.includes('using Haiku for grade-only')), 'S1 reached the eBay-consensus Haiku grade-only branch');
ok(s1.rec?.model === 'claude-haiku-4-5-20251001' && s1.rec?.modelVersion === 'reported::claude-haiku-4-5-20251001::call1', 'S1 receipt: Haiku requested + reported');

origLog('— unknown-model cost through the real handler');
const priced = { ...pricing.PRICING_USD_PER_MTOK['claude-opus-4-7'] };
delete pricing.PRICING_USD_PER_MTOK['claude-opus-4-7']; // simulate an unpriced model reaching the real cost-audit site
const u1 = await watch([LOW, LOW, HI]);
pricing.PRICING_USD_PER_MTOK['claude-opus-4-7'] = priced;
ok(u1.status === 200 && u1.threw === null, 'unpriced model: scan still 200, nonblocking');
ok(u1.calls.length === 3 && u1.body?.grade === 'VG 4.0', 'unpriced model: model-call count and grade unchanged');
ok(u1.logs.some((l) => l.includes('model=claude-opus-4-7') && l.includes('totalCostUsd=null') && l.includes('costStatus=unknown_model')), 'cost-audit line: cost null + costStatus=unknown_model (not 0)');
ok(!u1.logs.some((l) => l.includes('model=claude-opus-4-7') && /totalCostUsd=0(\.0+)?\b/.test(l)), 'unknown cost is never logged as zero');
ok(u1.logs.some((l) => l.startsWith('[grade-provenance]') && l.includes('"kind":"cost"') && l.includes('"outcome":"unknown_model"') && l.includes('"model":"claude-opus-4-7"')), 'existing [grade-provenance] structured line records the unknown model');
const { counterKey } = await import('../src/lib/gradeProvenanceObservability.js');
const day = new Date().toISOString().slice(0, 10);
ok((await memStore.get(counterKey({ day, kind: 'cost', outcome: 'unknown_model', branch: 'cost-audit', model: 'claude-opus-4-7', buildSha: null, predictionKind: null }))) === 1, 'existing Upstash-style daily counter incremented exactly once');
ok(u1.rec?.model === 'claude-opus-4-7' && u1.rec?.modelVersion === 'reported::claude-opus-4-7::call3', 'unpriced model still has full provenance recorded');
const k1 = await watch([LOW, LOW, HI]);
ok(k1.logs.some((l) => l.includes('model=claude-opus-4-7') && l.includes('costStatus=known')) && !k1.logs.some((l) => l.includes('"kind":"cost"')), 'priced model: costStatus=known and no unknown-model event');

origLog('— observability failure is nonblocking');
const brokenStore = { ...memStore, incr: async () => { throw new Error('store down'); } };
rs.setResearchStoreForTests(brokenStore);
delete pricing.PRICING_USD_PER_MTOK['claude-opus-4-7'];
const u2 = await watch([LOW, LOW, HI]);
pricing.PRICING_USD_PER_MTOK['claude-opus-4-7'] = priced;
rs.setResearchStoreForTests(memStore);
ok(u2.status === 200 && u2.threw === null && u2.calls.length === 3, 'counter store failure: scan still completes (200, same call count)');

origLog('— resolveCallCost unit semantics');
const U = { input_tokens: 1000, output_tokens: 500 };
const kH = pricing.resolveCallCost('claude-haiku-4-5-20251001', U);
ok(kH.status === 'known' && Math.abs(kH.cost.totalCostUsd - 0.0035) < 1e-12, 'known Haiku 4.5: 1000 in/500 out = $0.0035 (unchanged)');
ok(JSON.stringify(kH.cost) === JSON.stringify(pricing.computeAnthropicCallCostUsd('claude-haiku-4-5-20251001', U)), 'resolveCallCost(known) deep-equals computeAnthropicCallCostUsd');
for (const m of Object.keys(pricing.PRICING_USD_PER_MTOK)) {
  const r = pricing.resolveCallCost(m, { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 6, cache_creation_input_tokens: 7 });
  ok(r.status === 'known' && JSON.stringify(r.cost) === JSON.stringify(pricing.computeAnthropicCallCostUsd(m, { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 6, cache_creation_input_tokens: 7 })), `known-model cost unchanged: ${m}`);
}
const unk = pricing.resolveCallCost('claude-haiku-5-5', U);
ok(unk.status === 'unknown_model' && unk.cost === null, 'unpriced model => unknown_model, cost null');
const miss = pricing.resolveCallCost('claude-haiku-4-5', undefined);
ok(miss.status === 'missing_usage' && miss.cost === null, 'priced model + no usage => missing_usage, cost null');
ok(pricing.resolveCallCost('claude-haiku-5-5', undefined).status === 'unknown_model', 'unpriced + no usage => unknown_model (model checked first)');
const zero = pricing.resolveCallCost('claude-haiku-4-5', { input_tokens: 0, output_tokens: 0 });
ok(zero.status === 'known' && zero.cost.totalCostUsd === 0, 'a real zero-token call is known $0 — distinguishable from null');
ok(pricing.resolveCallCost('toString', U).status === 'unknown_model' && pricing.resolveCallCost(undefined, U).status === 'unknown_model', 'prototype keys / non-string models are unknown, not priced');

origLog('— static wiring');
const grade = fs.readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8');
const enrich = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
ok(!/attachGradeReceipt\([^)]*\bmodel:\s*["'`]/.test(grade) && !/attachGradeReceipt\([^)]*\bmodel:\s*null/.test(grade), 'no attachGradeReceipt call passes a call-site model literal or model:null');
ok(/model:\s*meta\?\.requestedModel\s*\|\|\s*null/.test(grade) && /modelVersion:\s*meta\?\.model\s*\|\|\s*null/.test(grade), 'provenance.model/modelVersion derive only from meta');
ok(/\.\.\.provenance,\s*resultId/.test(grade) || /\.\.\.base/.test(grade), 'prediction events and receipt spread the same provenance object');
ok(!/computeAnthropicCallCostUsd/.test(grade) && !/computeAnthropicCallCostUsd/.test(enrich), 'callers use resolveCallCost');
ok((enrich.match(/claude-haiku-4-5["']/g) || []).length === 1 && /const VERIFY_MODEL = "claude-haiku-4-5"/.test(enrich), 'enrich verification model literal exists exactly once (VERIFY_MODEL)');
ok(/model: VERIFY_MODEL,/.test(enrich) && /resolveCallCost\(VERIFY_MODEL, message\.usage\)/.test(enrich), 'enrich request + pricing lookup share VERIFY_MODEL');

console.log = origLog;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
