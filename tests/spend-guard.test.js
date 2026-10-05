// tests/spend-guard.test.js
//
// LIVE EXPOSURE CLOSURE (2026-10-04) — durable per-principal + global DAILY
// spend guard (src/lib/spendGuard.js), proven through the REAL handlers
// (api/chat.js, api/manage.js, api/grade.js, api/enrich.js) with only the
// network stubbed. Every proof counts real outbound provider calls: a refusal
// must leave the count UNCHANGED (checked BEFORE the paid call).
//
// Invoke: node tests/spend-guard.test.js

import { randomBytes } from 'node:crypto';

process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

// ── network stub: counts REAL provider calls (anything that is not the guard store) ──
let providerCalls = 0;
globalThis.fetch = async (url) => {
  providerCalls++;
  const body = String(url).includes('anthropic.com')
    ? { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

// (installed BEFORE the handlers are imported: the Anthropic SDK binds fetch at construction)
const { issueToken } = await import('../src/modules/auth/token.js');
const guard = await import('../src/lib/spendGuard.js');
const store = await import('../src/lib/researchStore.js');
const { default: chat } = await import('../api/chat.js');
const { default: manage } = await import('../api/manage.js');
const { default: grade } = await import('../api/grade.js');
const { default: enrich } = await import('../api/enrich.js');

const tokenFor = (principalId) => `Bearer ${issueToken({ principalId }).token}`;

const mkRes = () => {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
let ipCounter = 0;
const call = async (handler, principalId, body) => {
  const res = mkRes();
  // distinct IP per call so the (separate, in-memory) burst limiter never interferes
  await handler({ method: 'POST', headers: { authorization: tokenFor(principalId), 'x-forwarded-for': `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` }, body }, res);
  return res;
};
const chatBody = (extra = {}) => ({ message: 'hi', collection: [], history: [], ...extra });
const freshStore = () => { const s = store.createMemoryResearchStore(); store.setResearchStoreForTests(s); return s; };
const setCaps = ({ principal, operator, global, operatorIds = '' }) => {
  process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS = String(principal);
  process.env.SPEND_GUARD_OPERATOR_DAILY_UNITS = String(operator);
  process.env.SPEND_GUARD_GLOBAL_DAILY_UNITS = String(global);
  process.env.SPEND_GUARD_OPERATOR_PRINCIPAL_IDS = operatorIds;
};

console.log('1. per-principal cap refuses BEFORE the provider call (real api/chat.js)');
{
  const s = freshStore();
  setCaps({ principal: 2, operator: 50, global: 100 });
  providerCalls = 0;
  const r1 = await call(chat, 'user-A', chatBody());
  const r2 = await call(chat, 'user-A', chatBody());
  ok(r1.statusCode === 200 && r2.statusCode === 200, 'first two chat calls (1 unit each) are served');
  eq(providerCalls, 2, 'two provider calls were made');
  const r3 = await call(chat, 'user-A', chatBody());
  eq(r3.statusCode, 429, 'third call refused with 429');
  eq(r3.body.error, 'SPEND_PRINCIPAL_DAILY_CAP', 'stable refusal code');
  eq(providerCalls, 2, 'REFUSED BEFORE the provider: provider call count unchanged');
  ok(Number(r3.headers['retry-after']) > 0 && Number(r3.headers['retry-after']) <= 86400, 'retry-after exposed (seconds to UTC reset)');
  ok(/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(r3.body.resetAt), 'resetAt is the next UTC midnight');
  const other = await call(chat, 'user-B', chatBody());
  eq(other.statusCode, 200, 'a different principal is unaffected by user-A\'s cap');
  const dump = s._dump();
  eq(dump[guard.principalDayKey('user-A')], 2, 'refused call refunded its units (user-A counter == cap, not cap+1)');
}

console.log('2. operator cap is independent and higher');
{
  freshStore();
  setCaps({ principal: 2, operator: 6, global: 100, operatorIds: 'operator-1, other-op' });
  providerCalls = 0;
  const results = [];
  for (let i = 0; i < 7; i++) results.push((await call(chat, 'operator-1', chatBody())).statusCode);
  eq(results, [200, 200, 200, 200, 200, 200, 429], 'operator gets 6 units, 7th refused');
  const user = [];
  for (let i = 0; i < 3; i++) user.push((await call(chat, 'plain-user', chatBody())).statusCode);
  eq(user, [200, 200, 429], 'non-operator principal still capped at 2 in the same instance');
  const forged = await call(chat, 'plain-user', chatBody({ operator: true, principalId: 'operator-1', isOperator: true }));
  eq(forged.statusCode, 429, 'a client cannot self-declare operator status or choose principalId in the body');
}

console.log('3. global ceiling refuses across principals');
{
  const s = freshStore();
  setCaps({ principal: 50, operator: 50, global: 3 });
  providerCalls = 0;
  const codes = [];
  for (const p of ['g1', 'g2', 'g3', 'g4', 'g1']) codes.push((await call(chat, p, chatBody())).statusCode);
  eq(codes, [200, 200, 200, 429, 429], 'fourth and fifth calls (different principals) refused at the global ceiling');
  const refused = await call(chat, 'g5', chatBody());
  eq(refused.body.error, 'SPEND_GLOBAL_DAILY_CAP', 'stable global refusal code');
  eq(providerCalls, 3, 'REFUSED BEFORE the provider: only the 3 allowed calls reached it');
  const dump = s._dump();
  eq(dump[guard.globalDayKey()], 3, 'global counter == ceiling (refused calls refunded)');
  eq(dump[guard.principalDayKey('g4')], 0, 'a globally-refused call also refunded the principal slot');
}

console.log('4. durable counter unavailable -> refuses BEFORE the provider call (fails closed)');
{
  const dead = {
    incrBy: async () => { throw new store.ResearchStoreUnavailableError('simulated outage'); },
    decrBy: async () => { throw new store.ResearchStoreUnavailableError('simulated outage'); },
  };
  store.setResearchStoreForTests(dead);
  setCaps({ principal: 50, operator: 50, global: 100 });
  providerCalls = 0;
  for (const [name, handler, body] of [
    ['chat', chat, chatBody()],
    ['manage', manage, { comics: [{ title: 'X', price: '$1' }] }],
  ]) {
    const res = await call(handler, 'user-A', body);
    ok(res.statusCode === 503 && res.body.error === 'SPEND_GUARD_UNAVAILABLE', `${name}: 503 SPEND_GUARD_UNAVAILABLE on store outage`);
  }
  eq(providerCalls, 0, 'no provider call was made during the outage');
  const direct = await guard.reserveSpend({ principalId: 'u', endpoint: 'chat', store: dead });
  ok(direct.ok === false && direct.code === 'SPEND_GUARD_UNAVAILABLE', 'reserveSpend itself fails closed');
  ok((await guard.reserveSpend({ principalId: 'u', endpoint: 'no-such-endpoint', store: store.createMemoryResearchStore() })).ok === false, 'unknown endpoint fails closed');
  ok((await guard.reserveSpend({ principalId: '', endpoint: 'chat', store: store.createMemoryResearchStore() })).ok === false, 'missing principal fails closed');
}

console.log('5. concurrent calls cannot exceed the cap');
{
  const s = store.createMemoryResearchStore();
  const cfg = { principalDaily: 20, operatorDaily: 20, globalDaily: 30, operatorPrincipalIds: new Set() };
  const burst = await Promise.all(Array.from({ length: 60 }, () => guard.reserveSpend({ principalId: 'racer', endpoint: 'chat', store: s, config: cfg })));
  eq(burst.filter((r) => r.ok).length, 20, 'exactly 20 of 60 simultaneous reservations succeed (cap 20)');
  eq(s._dump()[guard.principalDayKey('racer')], 20, 'counter settles at the cap, never above');
  const s2 = store.createMemoryResearchStore();
  const many = await Promise.all(Array.from({ length: 90 }, (_, i) => guard.reserveSpend({ principalId: `p${i % 9}`, endpoint: 'chat', store: s2, config: cfg })));
  eq(many.filter((r) => r.ok).length, 30, 'global ceiling 30 holds across 9 racing principals');
  eq(s2._dump()[guard.globalDayKey()], 30, 'global counter settles at the ceiling');
}

console.log('6. warmup / validation / lock paths cost nothing; real scans are counted');
{
  const s = freshStore();
  setCaps({ principal: 50, operator: 50, global: 100 });
  providerCalls = 0;
  const w1 = await call(grade, 'warm-user', { warmup: true });
  const w2 = await call(enrich, 'warm-user', { warmup: true });
  ok(w1.statusCode === 200 && w1.body.warmed === true && w2.statusCode === 200 && w2.body.warmed === true, 'grade and enrich warmups answered');
  const bad = await call(chat, 'warm-user', { nomessage: true });
  eq(bad.statusCode, 400, 'invalid chat body rejected');
  const locked = await call(grade, 'warm-user', { existingGrade: { grade: '9.8' }, gradeConfidence: 'HIGH', gradeLocked: true, images: ['x'] });
  ok(locked.statusCode === 200 && locked.body.locked === true, 'grade-lock early return answered without Vision');
  eq(s._dump()[guard.principalDayKey('warm-user')], undefined, 'none of those consumed any spend units');
  eq(providerCalls, 0, 'and none reached a provider');
  const g = await call(grade, 'warm-user', { images: ['data:image/png;base64,AAAA'] }); // real scan path: guard runs before image/provider work
  ok(s._dump()[guard.principalDayKey('warm-user')] === 3, 'a real grade request reserves 3 units before any provider work');
  setCaps({ principal: 2, operator: 50, global: 100 });
  const before = providerCalls;
  const refusedGrade = await call(grade, 'warm-user', { images: ['data:image/png;base64,AAAA'] });
  eq(refusedGrade.statusCode, 429, 'grade refused when the cap (2) is below its 3-unit cost');
  eq(providerCalls, before, 'grade refusal happened before any provider call');
  const refusedEnrich = await call(enrich, 'warm-user', { title: 'Batman', issue: '1' });
  eq(refusedEnrich.body?.error, 'SPEND_PRINCIPAL_DAILY_CAP', 'enrich refuses with the same stable code over the cap');
  void g;
}

console.log('7. AUTH — principal comes only from the verified token');
{
  const s = freshStore();
  setCaps({ principal: 50, operator: 50, global: 100 });
  await call(chat, 'attacker', chatBody({ principalId: 'victim', principal_id: 'victim' }));
  const keys = Object.keys(s._dump()).filter((k) => k.includes(':p:'));
  eq(keys, [guard.principalDayKey('attacker')], 'only the authenticated principal\'s counter was charged');
  const res = mkRes();
  await chat({ method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9' }, body: chatBody() }, res);
  eq(res.statusCode, 401, 'no token -> 401 (guard is behind authentication)');
}

console.log('8. harness-store scope is narrow');
{
  ok(guard.isTestHarnessProcess('C:\\repo\\tests\\x.test.js', {}) === true, 'a tests/*.test.js process may use the in-memory store');
  ok(guard.isTestHarnessProcess('/repo/tests/x.test.js', { VERCEL: '1' }) === false, 'never on Vercel');
  ok(guard.isTestHarnessProcess('/repo/tests/x.test.js', { NODE_ENV: 'production' }) === false, 'never with NODE_ENV=production');
  ok(guard.isTestHarnessProcess('/var/task/api/chat.js', {}) === false, 'a real function entry point never matches');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
process.exit(0);
