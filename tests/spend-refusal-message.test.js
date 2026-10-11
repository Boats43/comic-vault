// Client-only 429 UX: a spend-guard refusal must reach the user as a readable sentence, not a raw code,
// and must leave no partial model/economic result. Real api/grade.js handler, stubbed network, no paid calls.
//   node tests/spend-refusal-message.test.js
import './helpers/spendGuardTestSetup.js';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
delete process.env.GRAILKEY_CATALOG_DATABASE_URL;
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS = '2'; // below the 3-unit grade cost: the first call is refused
process.env.SPEND_GUARD_OPERATOR_PRINCIPAL_IDS = '95b42d2e-a1d8-47de-904e-798122731b08'; // a VALID operator id (v4: an empty one now refuses every paid call)
const { readFileSync } = await import('node:fs');
const { issueToken } = await import('../src/modules/auth/token.js');
const store = await import('../src/lib/researchStore.js');
const { spendRefusalText, spendRefusalError, formatLocalResetTime, isNonRetryableSpendRefusal, CONFIGURATION_TEXT } = await import('../src/lib/spendRefusalMessage.js');
store.setResearchStoreForTests(store.createMemoryResearchStore());
const TOKEN = issueToken({ principalId: 'spend-refusal-ux-principal' }).token;

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

console.log('\n=== 429 message correction (client-only) ===\n');
const CAP = 'Daily usage limit reached for this account. It resets at 00:00 UTC.';
ok(spendRefusalText({ error: 'SPEND_PRINCIPAL_DAILY_CAP', message: CAP }) === CAP, 'principal cap with NO usable resetAt: the server\'s own readable sentence (honest fallback), not the raw code');
ok(spendRefusalText({ error: 'SPEND_GLOBAL_DAILY_CAP', message: 'GrailKey is at its daily capacity. Please try again after 00:00 UTC.' }).includes('daily capacity'), 'global cap: readable message');
ok(spendRefusalText({ error: 'SPEND_GUARD_UNAVAILABLE', message: 'Usage accounting is temporarily unavailable — please try again shortly.' }).includes('temporarily unavailable'), 'guard-unavailable: readable message');
ok(spendRefusalText({ error: 'Image too large — 8MB limit exceeded.' }, 'x') === 'Image too large — 8MB limit exceeded.', 'non-spend errors keep their existing text');
ok(spendRefusalText({ error: 'INVALID', message: 'something internal' }, 'x') === 'INVALID', 'a non-spend body never has its message substituted');
ok(spendRefusalText({}, 'Failed to grade') === 'Failed to grade' && spendRefusalText(null, 'Failed') === 'Failed', 'fallback preserved when there is no body');

const providerCalls = [];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) providerCalls.push(u);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'x' });
  if (u.includes('search_by_image')) return json({ itemSummaries: [], total: 0 });
  return json({});
};
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 48, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
let status = null, body = null, threw = null, calls = 0;
const res = { status: (c) => ({ json: (d) => { status = c; body = d; return d; } }), setHeader: () => {} };
try { calls++; await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': '10.8.0.1' }, body: { images: [PNG] } }, res); } catch (e) { threw = e; }
console.log = origLog;

ok(threw === null && status === 429, 'real grade handler refuses with HTTP 429 at the cap (no crash)');
ok(body?.error === 'SPEND_PRINCIPAL_DAILY_CAP' && body?.message === CAP, 'server body: stable code plus the human message');
ok(/^You've used today's allowance for this account\. It resets at .+\.$/.test(spendRefusalText(body, 'Failed to grade')) && !/UTC/.test(spendRefusalText(body, 'Failed to grade')), 'the client text for that exact response is the readable sentence with the reset time in the VIEWER\'s timezone (no "UTC")');
ok(!/principal|counter|gk:|sk-/i.test(spendRefusalText(body)), 'no internal principal id or counter key is exposed');
ok(providerCalls.length === 0, 'refused BEFORE any paid provider call');
ok(!logs.some((l) => l.startsWith('[grade-provenance]')), 'no prediction attempted: no model_prediction_event write, no receipt');
ok(body?.grade === undefined && body?.gradeReceiptId === undefined && body?.price === undefined && body?.decision === undefined, 'no partial model grade, receipt, valuation or decision in the refusal');
ok(calls === 1, 'single request: no retry loop on the refusal path');

console.log('\n=== v4: refusal screen correction ===\n');
{
  const RESET = '2026-10-13T00:00:00.000Z';
  const pacific = formatLocalResetTime(RESET, { locale: 'en-US', timeZone: 'America/Los_Angeles' });
  const tokyo = formatLocalResetTime(RESET, { locale: 'en-US', timeZone: 'Asia/Tokyo' });
  const utc = formatLocalResetTime(RESET, { locale: 'en-US', timeZone: 'UTC' });
  ok(/Mon, 5:00 PM PDT/.test(pacific), `the same instant renders in the viewer's own timezone: Pacific -> "${pacific}"`);
  ok(/Tue, 9:00 AM/.test(tokyo) && tokyo !== pacific && utc !== pacific, `...and differs by timezone (Tokyo "${tokyo}", UTC "${utc}")`);
  ok(formatLocalResetTime('not a date') === null && formatLocalResetTime(undefined) === null && formatLocalResetTime('') === null, 'a missing or invalid reset instant yields null (never "Invalid Date")');
  for (const [code, re] of [['SPEND_PRINCIPAL_DAILY_CAP', /today's allowance for this account/], ['SPEND_NONOPERATOR_DAILY_CAP', /shared capacity for today is used up/], ['SPEND_GLOBAL_DAILY_CAP', /at its daily capacity/]]) {
    const txt = spendRefusalText({ error: code, message: 'server text after 00:00 UTC', resetAt: RESET }, 'x', { locale: 'en-US', timeZone: 'America/Los_Angeles' });
    ok(re.test(txt) && /5:00 PM PDT/.test(txt) && !/UTC|SPEND_/.test(txt), `${code}: local reset time, no "UTC", no raw code`);
    ok(isNonRetryableSpendRefusal({ error: code }), `${code}: NOT retryable (no "Try again")`);
    ok(spendRefusalError({ error: code, resetAt: RESET }).nonRetryable === true, `${code}: the thrown error carries nonRetryable=true`);
  }
  const cfg = spendRefusalText({ error: 'SPEND_GUARD_MISCONFIGURED', reason: 'absent', message: 'x', resetAt: RESET }, 'x', { locale: 'en-US', timeZone: 'UTC' });
  ok(cfg === CONFIGURATION_TEXT, 'configuration failure: fixed operator-facing text');
  ok(!/resets|midnight|00:00|UTC|tomorrow|try again/i.test(cfg) && /contact the operator/i.test(cfg) && /Nothing was charged/.test(cfg), 'configuration failure NEVER implies it resolves at a reset time, and says nothing was charged');
  ok(isNonRetryableSpendRefusal({ error: 'SPEND_GUARD_MISCONFIGURED' }) && spendRefusalError({ error: 'SPEND_GUARD_MISCONFIGURED' }).nonRetryable === true, 'configuration failure is NOT retryable');
  for (const body of [{ error: 'SPEND_GUARD_UNAVAILABLE', message: 'Usage accounting is temporarily unavailable - please try again shortly.' }, { error: 'GRADE_ATTEMPT_IN_PROGRESS', message: 'Still working.' }, { error: 'Image too large' }, {}, null]) {
    ok(!isNonRetryableSpendRefusal(body) && !spendRefusalError(body, 'Failed').nonRetryable, `recoverable failure keeps its retry control: ${JSON.stringify(body)?.slice(0, 50)}`);
  }
}

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
ok((app.match(/spendRefusalText\(/g) || []).length + (app.match(/spendRefusalError\(/g) || []).length >= 7, 'every paid-endpoint error display (grade, bulk, refresh, enrich, add-photo, manage, re-grade) uses the readable text');
ok(!/throw new Error\(data\.error \|\| "Failed to grade"\)/.test(app) && !/throw new Error\(data\.error \|\| "Failed to re-analyze"\)/.test(app), 'grade and add-photo no longer throw the raw code');
const guardSrc = readFileSync(new URL('../src/lib/spendGuard.js', import.meta.url), 'utf8');
ok(/status:\s*429,\s*code:\s*'SPEND_PRINCIPAL_DAILY_CAP'/.test(guardSrc), 'server cap code/status unchanged by this commit');
const sessionSrc = readFileSync(new URL('../src/lib/grailkeySession.js', import.meta.url), 'utf8');
ok(/429/.test(sessionSrc), 'session library documents that 429 never clears the session (covered by gk268 \'429\' case)');

origLog(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
