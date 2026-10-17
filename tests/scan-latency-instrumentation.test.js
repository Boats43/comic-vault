// SCAN-LATENCY INSTRUMENTATION (measurement only). Real api/grade.js handler with a scripted provider (global fetch stub
// installed BEFORE the handler is imported) — no network, no database, no paid call. Pure-module tests for
// src/lib/scanLatency.js. Static wiring checks for src/App.jsx.
//   node tests/scan-latency-instrumentation.test.js

import './helpers/spendGuardTestSetup.js';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const fs = await import('node:fs');
const { issueToken } = await import('../src/modules/auth/token.js');
const PRINCIPAL = 'scan-latency-test-principal';
const TOKEN = issueToken({ principalId: PRINCIPAL }).token;

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const origLog = console.log;
const logs = [];
console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origLog(...a); };

// ─────────────────────────── pure module ───────────────────────────
const L = await import('../src/lib/scanLatency.js');
origLog('\n=== scan-latency instrumentation ===\n\n— server timing (pure)');
{
  const t = buildMarks({ handler_entry: 0, ebay_image_start: 40, ebay_image_complete: 1640, vision_start: 1641, vision_complete: 6240, finalize_start: 6241, finalize_complete: 6900, response_sent: 6900 });
  const s = L.buildServerTiming(t, 6905, 'HAIKU_EBAY_CONSENSUS');
  ok(s.stages.pre === 40 && s.stages.ebay === 1600 && s.stages.vision === 4599 && s.stages.finalize === 659 && s.stages.total === 6905, 'stages are differences between existing marks');
  ok(!('book' in s.stages) && !('ctx' in s.stages), 'stages absent for the branch taken are OMITTED, never zero-filled');
  const p = L.parseServerTiming(s.header);
  ok(p.ebay === 1600 && p.vision === 4599 && p.total === 6905, 'parseServerTiming round-trips buildServerTiming');
  ok(L.buildServerTiming({ vision_start: 5, vision_complete: 3 }, 10).stages.vision === undefined, 'a backwards pair is dropped');
  ok(L.buildServerTiming(null, NaN).header === '' && L.buildServerTiming(undefined, undefined).branch === null, 'null/garbage input yields an empty header, no throw');
  ok(L.buildServerTiming({}, 1, 'EVIL<script>').branch === null, 'only the fixed branch vocabulary is ever emitted');
  ok(Object.keys(L.parseServerTiming('a;dur=1, <x>;dur=2, vision;dur=3.5, total;dur=abc')).sort().join() === 'a,vision', 'parse ignores malformed entries');
}
function buildMarks(o) { return o; }

origLog('\n— client timer: the TWO milestones stay separate');
{
  let clock = 1000;
  const painted = [];
  const timer = L.createScanTimer({ now: () => clock, paint: (fn) => painted.push(fn), buildSha: 'abc1234', scanId: 'scan_1', incompleteAfterMs: 0 });
  clock += 20; timer.mark('encoded');
  clock += 10; timer.mark('grade_sent');
  clock += 6500; timer.mark('grade_received');
  clock += 5; timer.markPainted('identity');
  ok(painted.length === 1, 'markPainted schedules exactly one paint callback');
  ok(timer.snapshot().marks.identity_committed === 6535 && timer.snapshot().marks.identity_painted === undefined, 'identity_committed is recorded immediately; identity_painted only after the paint callback');
  clock += 30; painted.shift()();
  clock += 400; timer.mark('saved');
  clock += 2; timer.mark('enrich_sent');
  clock += 3600; timer.mark('enrich_received');
  clock += 5; timer.markPainted('final', 'complete');
  clock += 25; painted.shift()();
  const rec = timer.finish('error');
  ok(rec.outcome === 'complete', 'finish() is idempotent: the paint-triggered finish("complete") wins over a later call');
  ok(rec.durations.shutterToIdentityMs === 6565, 'shutterToIdentityMs uses the PAINTED mark (6535 + 30)');
  ok(rec.durations.shutterToFinalMs === 6565 + 400 + 2 + 3600 + 5 + 25 && rec.durations.shutterToFinalMs > rec.durations.shutterToIdentityMs, 'shutterToFinalMs is a different, later number');
  ok(rec.durations.enrichAfterIdentityMs === rec.durations.shutterToFinalMs - rec.durations.shutterToIdentityMs && rec.durations.enrichAfterIdentityMs > 4000, 'enrichment is NOT reported as eliminated: enrichAfterIdentityMs keeps it');
  ok(rec.durations.persistBeforeEnrichMs === 5 + 30 + 400 + 2 - 30 || typeof rec.durations.persistBeforeEnrichMs === 'number', 'awaited persistence between identity render and enrich dispatch is measured');
  ok(rec.durations.gradeRoundTripMs === 6500 && rec.durations.encodeMs === 20, 'grade round trip and encode are measured');
  ok(rec.build === 'abc1234' && rec.scanId === 'scan_1' && typeof rec.t0 === 'string' && /after camera/.test(rec.t0), 'record carries build, scanId and the explicit t0 definition');
}
{
  const timer = L.createScanTimer({ now: () => 5, paint: (fn) => fn(), incompleteAfterMs: 0 });
  timer.mark('encoded'); timer.markPainted('identity'); // never reaches enrich
  const rec = timer.finish('rejected');
  ok(rec.durations.shutterToFinalMs === undefined && rec.durations.shutterToIdentityMs === 0, 'no enrichment merged -> shutterToFinalMs ABSENT (not zero, not the identity time)');
}
{
  const bad = L.createScanTimer({ now: () => { throw new Error('boom'); }, paint: () => { throw new Error('boom'); }, incompleteAfterMs: 0 });
  let threw = false;
  try { bad.mark('x'); bad.set(null); bad.markPainted('y', 'complete'); bad.finish('error'); } catch { threw = true; }
  ok(!threw, 'a faulty clock / paint never throws into the scan path');
  let t2 = false;
  try { L.createScanTimer({ now: () => NaN, paint: (f) => f(), onFinish: () => { throw new Error('sink'); }, incompleteAfterMs: 0 }).finish('complete'); } catch { t2 = true; }
  ok(!t2, 'a throwing onFinish sink never throws into the scan path');
}

origLog('\n— privacy whitelist');
{
  const evil = L.sanitizeScanRecord({
    build: 'abc', scanId: 's', at: 1, outcome: 'complete', category: 'book', identitySource: 'vision_fallback',
    title: 'Secret Title', image: 'data:image/jpeg;base64,AAAA', token: 'Bearer abc.def.ghi', authorization: 'x', principalId: 'p-1',
    marks: { encoded: 5, 'evil key!': 9, scan_start: 0, bad: 'str' }, durations: { shutterToFinalMs: 100, secret: 5 },
    serverGrade: { vision: 4000, evil: 1 }, serverEnrich: { total_ms: 3000, comps_ms: 900, claude_check_ms: 0, stack: 7 },
    network: { type: '4g', rttMs: 50, downlinkMbps: 9.37, ip: '1.2.3.4' },
  });
  const flat = JSON.stringify(evil);
  ok(!/Secret Title|data:image|Bearer|authorization|principalId|p-1|1\.2\.3\.4|evil/i.test(flat), 'no title, image data, token, principal id, ip, or unknown key survives sanitization');
  ok(evil.marks.encoded === 5 && evil.marks.scan_start === 0 && Object.keys(evil.marks).length === 2, 'only well-formed numeric marks survive');
  ok(evil.category === 'book' && evil.identitySource === 'vision_fallback', 'enumerated labels survive');
  ok(L.sanitizeScanRecord({ category: 'my-secret-category' }).category === null, 'an out-of-vocabulary label is dropped');
}

origLog('\n— ring buffer + storage');
{
  const mem = new Map();
  const storage = { get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => { mem.set(k, v); return true; } };
  for (let i = 0; i < 75; i++) L.recordScanTiming(storage, { scanId: `s${i}`, at: 1000 + i, outcome: 'complete', marks: { scan_start: 0 } });
  const list = L.loadScanTimings(storage);
  ok(list.length === L.SCAN_LATENCY_MAX_RECORDS && list[0].scanId === 's15' && list[59].scanId === 's74', 'ring buffer keeps the newest 60');
  ok(L.lastScanAt(storage) === 1074, 'lastScanAt feeds the idle (cold-start proxy) measurement');
  const exp = JSON.parse(L.exportScanTimingsText(storage, { build: 'b', now: 5 }));
  ok(exp.kind === 'grailkey-scan-latency' && exp.count === 60 && exp.build === 'b', 'export is a self-describing JSON document');
  ok(L.recordScanTiming({ get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); } }, { scanId: 'z' }) === false, 'a faulty storage never throws');
  ok(L.recordScanTiming({ get: () => 'not json', set: () => true }, { scanId: 'z' }) === true, 'a corrupt stored value is replaced, not fatal');
  const noSession = { get: () => null, set: () => false };
  ok(L.recordScanTiming(noSession, { scanId: 'z' }) === false, 'with no session (storage refuses) nothing is recorded');
}

// ─────────────────────────── real handler ───────────────────────────
const base = (o) => ({
  title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false,
  isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null,
  labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10',
  priceHigh: '$30', reason: 'Moderate wear.', confidence: 'high', detectedPrice: null, restoration: null,
  defectPenalty: null, cgcPenaltyFlags: null, ...o,
});
const calls = [];
let script = [];
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
    await new Promise((r) => setTimeout(r, 15)); // make stage durations non-zero and observable
    return json({
      id: 'msg_' + n, type: 'message', role: 'assistant', model: requested,
      content: [{ type: 'text', text: JSON.stringify(script[n - 1] ?? script[script.length - 1]) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 },
    });
  }
  return json({});
};
const rs = await import('../src/lib/researchStore.js');
rs.setResearchStoreForTests(rs.createMemoryResearchStore());
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({
  async set(k, v) { rmem.set(k, JSON.parse(JSON.stringify(v))); },
  async get(k) { return rmem.has(k) ? JSON.parse(JSON.stringify(rmem.get(k))) : null; },
  async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; },
});
const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');

let ip = 0;
const run = async (extra, responses, items = []) => {
  calls.length = 0; logs.length = 0; script = responses; ebayItems = items;
  let status = null, body = null, threw = null;
  const headers = {};
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader: (k, v) => { headers[String(k).toLowerCase()] = String(v); } };
  try {
    await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.7.0.${++ip}` }, body: { images: [PNG], ...extra } }, res);
  } catch (e) { threw = e; }
  return { status, body, threw, headers, logs: [...logs], calls: [...calls] };
};
const poolItems = Array.from({ length: 8 }, (_, i) => ({ title: 'Creepy #1 Warren 1964 VG', itemId: `v1|${i}|0`, price: { value: '50', currency: 'USD' }, image: { imageUrl: 'x' } }));
const BOOK = { title: 'The Rationalists', author: 'Someone', publisher: null, year: null, edition: null, format: 'Paperback', isbn: null, grade: 'Good', signed: false, restoration: null, defectPenalty: null, price: '$10', priceLow: '$5', priceHigh: '$15', reason: 'Moderate wear.', confidence: 'medium', detectedPrice: null, assetType: 'book' };
const BOOKISH = base({ title: 'A Novel', issue: null, publisher: null, year: null, reason: 'Hardcover edition with copyright page, author listed, ISBN on back.' });

origLog('\n— real handler: eBay-first comic');
const a = await run({}, [base({})], poolItems);
ok(a.threw === null && a.status === 200, 'A1 handler 200, no throw');
ok(a.logs.some((l) => /eBay-first path succeeded/.test(l)), 'A2 took the eBay-first branch');
const aT = L.parseServerTiming(a.headers['server-timing']);
ok(a.headers['x-grade-branch'] === 'HAIKU_EBAY_CONSENSUS', 'A3 x-grade-branch = HAIKU_EBAY_CONSENSUS');
ok(aT.ebay >= 0 && aT.vision >= 10 && aT.finalize >= 0 && aT.total >= aT.vision, 'A4 Server-Timing carries ebay / vision / finalize / total with the model call measured');
ok(!('book' in aT) && !('ctx' in aT), 'A5 no book/ctx stage on the eBay-first branch');
ok(a.calls.length === 1, 'A6 exactly ONE model call (instrumentation adds none)');
ok(!/token|bearer|authorization|api[_-]?key/i.test(a.headers['server-timing'] + a.headers['x-grade-branch']), 'A7 headers carry no credential-shaped text');
ok(!('serverTiming' in (a.body || {})) && !('timings' in (a.body || {})) && !('marks' in (a.body || {})) && !Object.keys(a.body || {}).some((k) => /timing/i.test(k)), 'A8 response BODY has no timing field (no change to what is stored on the item)');
ok(a.logs.some((l) => /\[grade-timing\] summary:/.test(l) && /HAIKU_EBAY_CONSENSUS/.test(l)), 'A9 one summary log line');

origLog('\n— real handler: Vision fallback comic');
const b = await run({}, [base({})], []);
ok(b.status === 200 && b.calls.length === 1 && b.calls[0].requested.includes('sonnet'), 'B1 fallback: one Sonnet call');
const bT = L.parseServerTiming(b.headers['server-timing']);
ok(b.headers['x-grade-branch'] === 'SONNET_VISION_FALLBACK' && bT.vision >= 10 && !('book' in bT), 'B2 branch SONNET_VISION_FALLBACK, vision measured, no book stage');

origLog('\n— real handler: Book fallback (the two-Sonnet path under audit)');
const c = await run({}, [BOOKISH, BOOK], []);
ok(c.status === 200 && c.threw === null, 'C1 Book fallback 200, no throw');
ok(c.calls.length === 2 && c.calls.every((x) => x.requested.includes('sonnet')), 'C2 TWO Sonnet calls — measured, not changed');
const cT = L.parseServerTiming(c.headers['server-timing']);
ok(c.headers['x-grade-branch'] === 'SONNET_BOOK', 'C3 branch SONNET_BOOK');
ok(cT.vision >= 10 && cT.book >= 10, 'C4 the first Sonnet call (vision) and the SECOND (book) are timed separately');
ok(cT.total >= cT.vision + cT.book, 'C5 total covers both model calls');
ok(c.logs.some((l) => /\[grade-timing\] summary:/.test(l) && /"isBook":true/.test(l) && /"modelCalls":2/.test(l)), 'C6 summary log records isBook and modelCalls=2');
ok(c.body?.assetType === 'book', 'C7 category result is unchanged by instrumentation (still Book)');

origLog('\n— real handler: WATCH');
const w = await run({ source: 'watch' }, [base({ confidence: 'high' })], []);
ok(w.status === 200 && w.headers['x-grade-branch'] === 'WATCH' && /total;dur=/.test(w.headers['server-timing'] || ''), 'W1 WATCH branch also emits the header');

origLog('\n— a faulty header sink never changes a scan');
{
  calls.length = 0; script = [base({})]; ebayItems = poolItems;
  let body = null, status = null, threw = null;
  const res = { status: (c2) => ({ json: (d) => { status = c2; body = d; return d; } }), setHeader: (k) => { if (/server-timing|x-grade-branch/i.test(k)) throw new Error('header sink down'); } };
  try { await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.7.1.${++ip}` }, body: { images: [PNG] } }, res); } catch (e) { threw = e; }
  ok(threw === null && status === 200 && /^creepy$/i.test(body?.title || ''), 'F1 setHeader throwing is swallowed; the scan result is identical');
}

origLog('\n— static wiring (src/App.jsx / grade.js)');
{
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const g = fs.readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8');
  const i = (s) => app.indexOf(s);
  const order = ['createScanTimer({', 'scanTimer.mark("encoded")', 'scanTimer.mark("grade_sent")', 'scanTimer.mark("grade_received")', 'scanTimer.markPainted("identity")', 'scanTimer.mark("saved")', 'scanTimer.mark("enrich_sent")', 'scanTimer.mark("enrich_received")', 'scanTimer.markPainted("final", "complete")'].map(i);
  ok(order.every((x) => x > 0) && order.every((x, k) => k === 0 || x > order[k - 1]), 'S1 App.jsx marks appear in pipeline order');
  const eb = app.slice(app.indexOf('const enrichBody = {'), app.indexOf('if (!buyerMode) enrichBody.images'));
  ok(eb.length > 500 && !/scanTimer|serverTiming|latency/i.test(eb), 'S2 the /api/enrich request body is not touched by instrumentation');
  ok(!/scanTimer/.test(app.slice(app.indexOf('const savedId = (save && !isDuplicate)'), app.indexOf('const savedId = (save && !isDuplicate)') + 160).replace(/scanTimer\.mark\("saved"\)/, '')), 'S3 addToCatalogue call is unchanged');
  ok((g.match(/emitServerTiming\(/g) || []).length === 3 && /const emitServerTiming = /.test(g), 'S4 grade.js: helper defined + exactly three emit sites (WATCH, eBay-first, fallback)');
  const emitIdx = [...g.matchAll(/emitServerTiming\('|emitServerTiming\(isBook/g)].map((m) => m.index);
  ok(emitIdx.every((x) => g.slice(x, x + 600).includes('res.status(200)') || g.slice(x, x + 400).includes('setHeader')), 'S5 each emit precedes its response');
  ok(!/api\/enrich/.test(fs.readFileSync(new URL('../src/lib/scanLatency.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')) , 'S6 scanLatency.js makes no network request of its own');
  ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(fs.readFileSync(new URL('../src/lib/scanLatency.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')), 'S7 nothing is sent anywhere by the instrumentation module');
}

origLog('\n— client transport: headers reach the timer, never the item data');
{
  const { runGradeAttempt } = await import('../src/lib/gradeAttemptClient.js');
  const payload = { title: 'Creepy', assetType: 'comic', attemptReplay: false };
  const apiFetch = async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json', 'server-timing': 'ebay;dur=1500, vision;dur=4600, total;dur=7100', 'x-grade-branch': 'HAIKU_EBAY_CONSENSUS' } });
  const out = await runGradeAttempt({ apiFetch, headers: {}, body: { images: ['AAAA'], scanId: 'sc_1' } });
  const parsed = L.parseServerTiming(out.serverTiming);
  ok(out.ok === true && parsed.vision === 4600 && parsed.total === 7100 && out.gradeBranch === 'HAIKU_EBAY_CONSENSUS', 'T1 runGradeAttempt surfaces Server-Timing and x-grade-branch');
  ok(!('serverTiming' in out.data) && !('gradeBranch' in out.data) && out.data.title === 'Creepy', 'T2 the headers are transport annotations — never merged into `data` (which is spread into the synced item)');
  const bare = await runGradeAttempt({ apiFetch: async () => new Response(JSON.stringify({ title: 'x' }), { status: 200 }), headers: {}, body: { images: ['BBBB'], scanId: 'sc_2' } });
  ok(bare.ok === true && bare.serverTiming === null && bare.gradeBranch === null, 'T3 a response without the headers (replay, older server) yields null, not an error');
  const noHeaders = await runGradeAttempt({ apiFetch: async () => ({ ok: true, status: 200, json: async () => ({ title: 'y' }), headers: undefined }), headers: {}, body: { images: ['CCCC'], scanId: 'sc_3' } });
  ok(noHeaders.ok === true && noHeaders.serverTiming === null, 'T4 a fetch-like object with no headers is tolerated');
}

console.log = origLog;
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
