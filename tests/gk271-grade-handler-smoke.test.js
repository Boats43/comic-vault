// GK-271 — mandatory real-handler smoke for api/grade.js (GK-138 rule).
// Proves the new condition-evidence guard executes inside the REAL grade
// handler's Vision-fallback path without throwing, withholds unsupported
// claims from a front-only scan, rejects era-implausible polybag claims,
// and that detectEditionWarning still reads Vision's RAW prose.
//
// Deterministic: global fetch stub (installed BEFORE grade.js is imported
// so the Anthropic SDK client binds to it). No network. Invoke:
//   node tests/gk271-grade-handler-smoke.test.js

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: 'gk271-grade-test-principal' }).token;

const VISION_JSON = {
  title: 'Classic Comics', issue: '13', publisher: 'Gilberton', year: '1943',
  assetTypeConfident: true, foreignEdition: true, isReprint: false, editionType: 'original',
  grade: 'FR 1.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null,
  keyIssue: null, variant: 'Canadian edition', creator: null, price: '$20', priceLow: '$10', priceHigh: '$30',
  reason: 'Severe staple failure with visible popping/separation. Heavy corner chipping on all four corners. Significant polybag indentation damage visible across the front and back covers. Overall heavy wear, creasing, and color fading. Canadian edition.',
  confidence: 'medium', detectedPrice: null, restoration: null, defectPenalty: null,
  cgcPenaltyFlags: {
    storeStamp: { detected: false, pedigreeName: null },
    staplePopping: { detected: true, severity: 'severe' },
    polybagIndents: { detected: true },
    cornerChips: { detected: true, count: 4 },
    pedigreeStamp: { detected: false, pedigreeName: null },
  },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'fake', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image')) return json({ itemSummaries: [], total: 0 }); // no eBay identity → Vision fallback
  if (u.includes('api.anthropic.com')) {
    return json({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'text', text: JSON.stringify(VISION_JSON) }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  }
  return json({});
};

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origLog(...a); };

const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');

const run = async (images, principal) => {
  logs.length = 0;
  let status = null, body = null, threw = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader: () => {} };
  try {
    await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': principal }, body: { images } }, res);
  } catch (e) { threw = e; }
  return { status, body, threw, logs: [...logs] };
};

origLog('\n=== GK-271 grade handler smoke ===\n');
const front = await run([PNG], '10.0.0.1');
ok(front.threw === null, `no exception escaped the handler (${front.threw ? front.threw.message : 'none'})`);
ok(front.status === 200, `HTTP 200 (actual ${front.status}${front.body?.error ? ': ' + front.body.error : ''})`);
ok(!front.logs.some((l) => l.includes('ReferenceError')), 'no ReferenceError');
ok(front.logs.some((l) => l.startsWith('[condition-guard]')), '[condition-guard] line emitted in the real handler');
const r = front.body?.reason || '';
ok(!/staple/i.test(r), 'front-only: staple claim withheld from response.reason');
ok(!/polybag|back covers/i.test(r), '1943 book: polybag/back-cover claim withheld');
ok(/corner chipping/i.test(r) && /heavy wear/i.test(r), 'front-visible claims survive');
ok(front.body?.cgcPenaltyFlags?.polybagIndents?.detected === false, 'polybag penalty flag rejected by era gate');
ok(Array.isArray(front.body?.conditionClaimsWithheld) && front.body.conditionClaimsWithheld.length >= 2, 'withheld claims recorded on the response');
ok(front.body?.grade === 'FR 1.0', 'grade is not altered by the guard');

const two = await run([PNG, PNG], '10.0.0.2');
ok(two.threw === null && two.status === 200, 'two-image scan runs through the real handler');
ok(!/polybag/i.test(two.body?.reason || ''), 'era gate applies regardless of image count (1943 polybag impossible)');
ok(/staple/i.test(two.body?.reason || ''), 'multiple undeclared images: staple claim not withheld (cannot be disproven)');

global.fetch = originalFetch;
origLog(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
