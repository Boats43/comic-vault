// Cost events must not contaminate grade-prediction / receipt provenance counters or their denominators.
// TICKET: UNASSIGNED. Deterministic; in-memory counter store; mocked provider; no network, no database.
//   node tests/cost-counter-denominator-isolation.test.js
//
// The documented Phase 2 reader (docs/GRADING-CAMPAIGN.md, "Phase 1 observability") computes, per kind,
//   failure rate = write_failed / (ok + write_failed)  over keys
//   gk:gradeprov:v1:<day>:<prediction|receipt>:<outcome>:<branch>:<model>:<buildSha>:<FIRST_GRADE|RE_GRADE>
// No reader exists in code yet; this test implements that documented formula literally and proves cost events are
// invisible to it: separated by the `kind` segment, by the `outcome` segment, and by a predictionKind segment that
// is neither FIRST_GRADE nor RE_GRADE.

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
const fs = await import('node:fs');
const { observeGradeProvenance, counterKey } = await import('../src/lib/gradeProvenanceObservability.js');
const rs = await import('../src/lib/researchStore.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const day = new Date().toISOString().slice(0, 10);
const prefix = `gk:gradeprov:v1:${day}:`;

// Documented reader, implemented literally.
const reader = (dump) => {
  const out = { prediction: {}, receipt: {} };
  for (const [k, v] of Object.entries(dump)) {
    if (!k.startsWith(prefix)) continue;
    const [kind, outcome, branch, model, buildSha, predictionKind] = k.slice(prefix.length).split(':');
    if (kind !== 'prediction' && kind !== 'receipt') continue; // the reader's own kind filter
    if (predictionKind !== 'FIRST_GRADE' && predictionKind !== 'RE_GRADE') continue;
    const b = (out[kind][predictionKind] ||= {});
    b[outcome] = (b[outcome] || 0) + v;
  }
  return out;
};
const rate = (b = {}) => ((b.write_failed || 0) / (((b.ok || 0) + (b.write_failed || 0)) || 1));

console.log('\n=== cost counter denominator isolation ===\n');
const store = rs.createMemoryResearchStore();
const common = { endpoint: 'grade', branch: 'WATCH', model: 'claude-haiku-4-5-20251001', buildSha: 'abc1234', store };
for (let i = 0; i < 6; i++) await observeGradeProvenance({ ...common, kind: 'prediction', outcome: 'ok', predictionKind: 'FIRST_GRADE' });
for (let i = 0; i < 2; i++) await observeGradeProvenance({ ...common, kind: 'prediction', outcome: 'write_failed', predictionKind: 'FIRST_GRADE' });
for (let i = 0; i < 3; i++) await observeGradeProvenance({ ...common, kind: 'prediction', outcome: 'ok', predictionKind: 'RE_GRADE' });
await observeGradeProvenance({ ...common, kind: 'prediction', outcome: 'write_failed', predictionKind: 'RE_GRADE' });
for (let i = 0; i < 5; i++) await observeGradeProvenance({ ...common, kind: 'receipt', outcome: 'issued', predictionKind: 'FIRST_GRADE' });
const before = store._dump();
const readerBefore = JSON.stringify(reader(before));

// cost events exactly as both production call sites emit them (predictionKind: null)
for (let i = 0; i < 7; i++) await observeGradeProvenance({ kind: 'cost', outcome: 'unknown_model', endpoint: 'grade', branch: 'cost-audit', model: 'claude-opus-4-7', buildSha: 'abc1234', predictionKind: null, store });
for (let i = 0; i < 4; i++) await observeGradeProvenance({ kind: 'cost', outcome: 'unknown_model', endpoint: 'enrich', branch: 'verification', model: 'claude-haiku-4-5', buildSha: 'abc1234', predictionKind: null, store });
const after = store._dump();

const predKeys = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith(prefix + 'prediction:') || k.startsWith(prefix + 'receipt:')));
ok(JSON.stringify(predKeys(before)) === JSON.stringify(predKeys(after)), 'cost:unknown_model increments NO prediction/receipt counter (those keys are byte-identical before/after)');
ok(JSON.stringify(reader(after)) === readerBefore, 'documented Phase 2 reader output is unchanged by cost events');
const r = reader(after);
ok(Math.abs(rate(r.prediction.FIRST_GRADE) - 2 / 8) < 1e-12 && Math.abs(rate(r.prediction.RE_GRADE) - 1 / 4) < 1e-12, 'FIRST_GRADE (2/8) and RE_GRADE (1/4) failure-rate denominators exact after cost events');
const costKeys = Object.keys(after).filter((k) => k.startsWith(prefix + 'cost:'));
ok(costKeys.length === 2 && costKeys.every((k) => k.includes(':cost:unknown_model:')), 'cost events live only under kind=cost, outcome=unknown_model');
ok(costKeys.every((k) => { const last = k.split(':').pop(); return last !== 'FIRST_GRADE' && last !== 'RE_GRADE'; }), 'cost keys carry no FIRST_GRADE/RE_GRADE label (a naive predictionKind-suffix aggregation cannot count them)');
const naiveFirst = Object.entries(after).filter(([k]) => k.endsWith(':FIRST_GRADE')).reduce((s, [, v]) => s + v, 0);
const naiveFirstBefore = Object.entries(before).filter(([k]) => k.endsWith(':FIRST_GRADE')).reduce((s, [, v]) => s + v, 0);
ok(naiveFirst === naiveFirstBefore, 'even a kind-blind FIRST_GRADE suffix sum is unchanged by cost events');
ok(costKeys.some((k) => k.endsWith(':unknown')), 'cost keys end in the neutral "unknown" segment (safe(null))');
ok(counterKey({ day, kind: 'cost', outcome: 'unknown_model', branch: 'cost-audit', model: 'claude-opus-4-7', buildSha: 'abc1234', predictionKind: null }) === costKeys.find((k) => k.includes(':cost-audit:')), 'counterKey reproduces the emitted cost key');

console.log('— real handler (WATCH, unpriced Opus) leaves prediction/receipt counters exactly as a priced run does');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = (o) => ({ title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false, isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30', reason: 'Moderate wear.', confidence: 'high', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null, ...o });
let n = 0;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('count_tokens')) return json({ input_tokens: 1 });
  if (u.includes('api.anthropic.com')) { const m = JSON.parse(init.body).model; n += 1; return json({ id: 'm' + n, type: 'message', role: 'assistant', model: m, content: [{ type: 'text', text: JSON.stringify(n < 3 ? base({ confidence: 'low' }) : base({ confidence: 'high' })) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 } }); }
  return json({});
};
const hstore = rs.createMemoryResearchStore(); rs.setResearchStoreForTests(hstore);
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({ async set(k, v) { rmem.set(k, JSON.parse(JSON.stringify(v))); }, async get(k) { return rmem.has(k) ? JSON.parse(JSON.stringify(rmem.get(k))) : null; }, async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; } });
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: 'cost-denominator-test' }).token;
const pricing = await import('../src/lib/anthropicPricing.js');
const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
let ip = 0;
const scan = async () => {
  n = 0; const orig = console.log; console.log = () => {};
  let status = null; const res = { status: (c) => ({ json: () => { status = c; } }), setHeader: () => {} };
  try { await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.6.0.${++ip}` }, body: { images: [PNG], source: 'watch' } }, res); } finally { console.log = orig; }
  return status;
};
ok(await scan() === 200, 'priced WATCH scan (Opus pass 3): 200');
const hstoreAfterPriced = JSON.parse(JSON.stringify(hstore._dump()));
const pricedDump = predKeys(hstore._dump());
const saved = { ...pricing.PRICING_USD_PER_MTOK['claude-opus-4-7'] };
delete pricing.PRICING_USD_PER_MTOK['claude-opus-4-7'];
await scan();
pricing.PRICING_USD_PER_MTOK['claude-opus-4-7'] = saved;
const afterUnpriced = hstore._dump();
const pk = predKeys(afterUnpriced);
ok(Object.keys(pk).length === Object.keys(pricedDump).length && Object.entries(pk).every(([k, v]) => v === 2 * pricedDump[k]), 'second (unpriced) scan added exactly one more of each prediction/receipt counter — same as a priced scan, nothing extra');
ok(Object.keys(afterUnpriced).filter((k) => k.includes(':cost:unknown_model:')).length === 1, 'and exactly one cost:unknown_model key was created, outside the prediction/receipt key space');

const handlerCostKey = Object.keys(afterUnpriced).find((k) => k.includes(':cost:unknown_model:'));
ok(handlerCostKey && handlerCostKey.split(':').pop() === 'unknown', 'the cost key the REAL handler emitted carries the neutral "unknown" predictionKind segment');
const suffixSum = (d) => Object.entries(d).filter(([k]) => k.endsWith(':FIRST_GRADE') || k.endsWith(':RE_GRADE')).reduce((t, [, v]) => t + v, 0);
ok(suffixSum(afterUnpriced) === 2 * suffixSum(hstoreAfterPriced), 'kind-blind FIRST_GRADE/RE_GRADE suffix sum after the unpriced scan is exactly 2x the priced-run sum (cost event added nothing)');

console.log('— static: both production call sites emit cost events with predictionKind: null');
const grade = fs.readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8');
const enrich = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
ok(/kind: 'cost', outcome: 'unknown_model', endpoint: 'grade'[^;]*predictionKind: null/.test(grade), 'api/grade.js cost event passes predictionKind: null');
ok(/kind: 'cost', outcome: 'unknown_model', endpoint: 'enrich'[^;]*predictionKind: null/.test(enrich), 'api/enrich.js cost event passes predictionKind: null');
ok((grade.match(/kind: 'cost'/g) || []).length === 1 && (enrich.match(/kind: 'cost'/g) || []).length === 1, 'exactly one cost event emitter per file');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
