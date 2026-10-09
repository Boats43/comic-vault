// WATCH accepted-pass authority — the result and its producing pass's metadata stay associated, explicitly.
// TICKET: UNASSIGNED. Mocked provider only; no network, no database, no paid call.
//   node tests/watch-accepted-pass-authority.test.js
//
// Part A: pure association contract (src/lib/watchProvenance.js). The "accepted earlier than last attempted" cases
//         are CONTRACT-LEVEL (helper inputs), NOT a claimed production execution path: today every WATCH return is the
//         last attempted pass. They exist so a future selection strategy cannot silently mis-attribute.
// Part B: the real api/grade.js WATCH handler reports acceptedPassIndex == attempted calls, with matching receipts.

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
const fs = await import('node:fs');
const { selectAcceptedPassMeta } = await import('../src/lib/watchProvenance.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

console.log('\n=== WATCH accepted-pass authority ===\n');
console.log('— Part A: association contract');
const m1 = { requestedModel: 'claude-haiku-4-5-20251001', model: 'rep-1' };
const m2 = { requestedModel: 'claude-haiku-4-5-20251001', model: 'rep-2' };
const m3 = { requestedModel: 'claude-opus-4-7', model: 'rep-3' };
const attempts = [m1, m2, m3];
for (const [idx, m] of [[1, m1], [2, m2], [3, m3]]) {
  const r = selectAcceptedPassMeta({ meta: m, acceptedPassIndex: idx, attemptedPassCount: idx, attemptMetas: attempts.slice(0, idx) });
  ok(r.ok && r.meta === m, `current shape: accepted pass ${idx} of ${idx} attempted keeps its own metadata`);
}
// Hypothetical future strategy: pass 2 accepted although 3 were attempted. Attribution must follow the ACCEPTED pass.
const early = selectAcceptedPassMeta({ meta: m2, acceptedPassIndex: 2, attemptedPassCount: 3, attemptMetas: attempts });
ok(early.ok && early.meta === m2 && early.meta !== m3, 'contract: accepted pass 2 of 3 attempted is attributed to pass 2, NOT the last attempted pass');
const earlyWrong = selectAcceptedPassMeta({ meta: m3, acceptedPassIndex: 2, attemptedPassCount: 3, attemptMetas: attempts });
ok(!earlyWrong.ok && earlyWrong.meta === null, 'contract: last-attempted metadata attached to an earlier accepted pass is REJECTED (UNKNOWN)');
ok(!selectAcceptedPassMeta({ meta: m1, acceptedPassIndex: 3, attemptedPassCount: 3, attemptMetas: attempts }).ok, 'rejects first-pass metadata attached to pass 3');
ok(!selectAcceptedPassMeta({ meta: { ...m2 }, acceptedPassIndex: 2, attemptedPassCount: 3, attemptMetas: attempts }).ok, 'rejects a look-alike copy that is not the recorded pass object');
ok(!selectAcceptedPassMeta({ meta: m2, acceptedPassIndex: 4, attemptedPassCount: 3, attemptMetas: attempts }).ok, 'rejects accepted index beyond attempted count');
ok(!selectAcceptedPassMeta({ meta: m2, acceptedPassIndex: 0, attemptedPassCount: 3, attemptMetas: attempts }).ok, 'rejects accepted index 0');
ok(!selectAcceptedPassMeta({ meta: m2, acceptedPassIndex: 2, attemptedPassCount: 2, attemptMetas: attempts }).ok, 'rejects attempt-metadata/count mismatch');
ok(!selectAcceptedPassMeta({ meta: null, acceptedPassIndex: 1, attemptedPassCount: 1, attemptMetas: [null] }).ok, 'absent metadata => UNKNOWN (not ok, meta null)');
ok(!selectAcceptedPassMeta({ meta: m1, attemptMetas: [m1] }).ok && !selectAcceptedPassMeta(undefined).ok && !selectAcceptedPassMeta({}).ok, 'missing index/count or no input => UNKNOWN, never throws');
ok(!selectAcceptedPassMeta({ meta: { model: 'rep' }, acceptedPassIndex: 1, attemptedPassCount: 1, attemptMetas: [{ model: 'rep' }] }).ok, 'metadata without a requested model is not accepted as provenance');

console.log('— Part B: real WATCH handler');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = (o) => ({ title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false, isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30', reason: 'Moderate wear.', confidence: 'high', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null, ...o });
let script = []; let n = 0;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('count_tokens')) return json({ input_tokens: 1 });
  if (u.includes('api.anthropic.com')) {
    const requested = JSON.parse(init.body).model; n += 1;
    return json({ id: 'm' + n, type: 'message', role: 'assistant', model: `reported::${requested}::call${n}`, content: [{ type: 'text', text: JSON.stringify(script[n - 1] ?? script[script.length - 1]) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 } });
  }
  return json({});
};
const rs = await import('../src/lib/researchStore.js'); rs.setResearchStoreForTests(rs.createMemoryResearchStore());
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({ async set(k, v) { rmem.set(k, JSON.parse(JSON.stringify(v))); }, async get(k) { return rmem.has(k) ? JSON.parse(JSON.stringify(rmem.get(k))) : null; }, async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; } });
const { issueToken } = await import('../src/modules/auth/token.js');
const PRINCIPAL = 'watch-accepted-pass-test'; const TOKEN = issueToken({ principalId: PRINCIPAL }).token;
const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
let ip = 0;
const watch = async (resps) => {
  n = 0; script = resps; const headers = {}; const logs = []; const orig = console.log;
  console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  let status = null, body = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; } }), setHeader: (k, v) => { headers[k] = v; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.8.0.${++ip}` }, body: { images: [PNG], source: 'watch' } }, res);
  console.log = orig;
  const claim = body?.gradeReceiptId ? await receiptLib.claimGradeReceipt({ principalId: PRINCIPAL, receiptId: body.gradeReceiptId }) : null;
  return { status, headers, logs, calls: n, rec: claim?.ok ? claim.record : null };
};
const HI = base({ confidence: 'high' }), LOW = base({ confidence: 'low' }), MED = base({ confidence: 'medium' });
for (const [label, resps, expectPass, expectModel] of [['pass 1', [HI], 1, 'claude-haiku-4-5-20251001'], ['pass 2', [LOW, MED], 2, 'claude-haiku-4-5-20251001'], ['pass 3', [LOW, LOW, HI], 3, 'claude-opus-4-7']]) {
  const r = await watch(resps);
  ok(r.status === 200 && String(r.headers['x-watch-passes']) === String(expectPass), `${label}: handler reports accepted pass ${expectPass}`);
  ok(r.calls === expectPass, `${label}: model-call count ${r.calls} equals accepted pass index (current invariant, asserted not assumed)`);
  ok(r.rec?.model === expectModel && r.rec?.modelVersion === `reported::${expectModel}::call${expectPass}`, `${label}: receipt carries that pass's requested + reported model`);
  ok(!r.logs.some((l) => l.includes('[watch-provenance]')), `${label}: association verified (no inconsistency log)`);
}

console.log('— static wiring');
const grade = fs.readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8');
ok(/selectAcceptedPassMeta\(watchRun\)/.test(grade) && /meta: watchMeta \?\? null/.test(grade) && !/meta:\s*watchRun\.meta/.test(grade), 'handler attaches only the verified association (never watchRun.meta directly)');
ok((grade.match(/acceptedPassIndex: [123], attemptedPassCount: attemptMetas\.length, attemptMetas/g) || []).length === 3, 'all three watchPipeline return points carry acceptedPassIndex + attemptedPassCount + attemptMetas');
ok((grade.match(/attemptMetas\.push\(pass[123]\.meta\)/g) || []).length === 3, 'every attempted pass records its own metadata');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
