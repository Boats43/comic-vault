// tests/launch1a-nonoperator-spend-ceiling.test.js
//
// GK-L1A (2026-10-11) -- non-operator AGGREGATE daily sub-ceiling in src/lib/spendGuard.js.
// Pure/in-memory: no network, no database, no provider. Proves, with the real reserveSpend:
//   * ordinary usage can never consume the operator's reserved 5000 units (table at 1/10/50/200/1000 accounts)
//   * a refused reservation takes NOTHING (principal, aggregate and global counters all unchanged)
//   * a store failure part-way through leaves no partial consumption (fail closed)
//   * adversarially interleaved concurrency (yielding store) cannot breach any ceiling
//   * the UTC day boundary resets the aggregate
//   * misconfiguration is clamped; with no operator configured the old behaviour is untouched
//
// Invoke: node tests/launch1a-nonoperator-spend-ceiling.test.js

import { setImmediate as tick } from 'node:timers/promises';

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}`); } };
const eq = (a, b, label) => ok(a === b, `${label}${a === b ? '' : ` (got ${a}, want ${b})`}`);

const guard = await import('../src/lib/spendGuard.js');
const { createMemoryResearchStore, ResearchStoreUnavailableError } = await import('../src/lib/researchStore.js');

const OP = 'op-principal-0000-0000-000000000001';
const CFG = (over = {}) => ({
  principalDaily: 100, operatorDaily: 5000, globalDaily: 6000, nonOperatorDaily: 1000,
  operatorPrincipalIds: new Set([OP]), ...over,
});
const NOW = new Date('2026-10-12T12:00:00.000Z');
const counters = (st, now = NOW) => {
  const d = st._dump();
  return { g: d[guard.globalDayKey(now)] ?? 0, n: d[guard.nonOperatorDayKey(now)] ?? 0 };
};
const nz = (st) => JSON.stringify(Object.fromEntries(Object.entries(st._dump()).filter(([, v]) => v !== 0))); // a refunded key reads 0 == nothing consumed
const reserve = (st, principalId, over = {}) => guard.reserveSpend({ principalId, endpoint: 'chat', store: st, now: NOW, config: CFG(over.cfg), ...over.args });

// a store whose every operation yields to the event loop first, so concurrent reservations genuinely interleave
const yielding = (inner) => {
  const wrap = {};
  for (const k of Object.keys(inner)) wrap[k] = async (...a) => { await tick(); return inner[k](...a); };
  wrap._dump = inner._dump;
  return wrap;
};

console.log('\n[1] effective ceiling');
{
  eq(guard.effectiveNonOperatorCeiling(CFG()), 1000, 'default 1000');
  eq(guard.effectiveNonOperatorCeiling(CFG({ nonOperatorDaily: 9000 })), 1000, 'configured above (global - operator) is clamped to 1000');
  eq(guard.effectiveNonOperatorCeiling(CFG({ globalDaily: 5000 })), 0, 'global == operator reserve -> ordinary pool is 0 (never reaches the reserve)');
  eq(guard.effectiveNonOperatorCeiling(CFG({ globalDaily: 3000 })), 0, 'global below operator cap never goes negative');
  eq(guard.effectiveNonOperatorCeiling(CFG({ operatorPrincipalIds: new Set() })), null, 'no operator configured -> no pooled limit (nobody to protect)');
  const env = guard.resolveSpendConfig({ SPEND_GUARD_NONOPERATOR_DAILY_UNITS: '750', SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: OP });
  eq(env.nonOperatorDaily, 750, 'env SPEND_GUARD_NONOPERATOR_DAILY_UNITS is read');
  eq(guard.resolveSpendConfig({}).nonOperatorDaily, 1000, 'default when unset');
  eq(guard.resolveSpendConfig({ SPEND_GUARD_NONOPERATOR_DAILY_UNITS: 'garbage' }).nonOperatorDaily, 1000, 'garbage falls back to the default');
}

console.log('\n[2] operator capacity at 1 / 10 / 50 / 200 / 1000 ordinary accounts each consuming their FULL 100-unit quota');
for (const N of [1, 10, 50, 200, 1000]) {
  const st = createMemoryResearchStore();
  let ordinaryGranted = 0;
  for (let i = 0; i < N; i += 1) {
    for (let u = 0; u < 100; u += 1) { // 100 one-unit calls = the full ordinary quota
      const r = await reserve(st, `user-${i}`);
      if (r.ok) ordinaryGranted += 1;
    }
  }
  let operatorGranted = 0;
  for (;;) { const r = await reserve(st, OP); if (!r.ok) break; operatorGranted += 1; if (operatorGranted > 9000) break; }
  const c = counters(st);
  console.log(`      N=${String(N).padStart(4)}: ordinary granted ${String(ordinaryGranted).padStart(4)} units, operator then reserved ${operatorGranted}, global ${c.g}`);
  eq(ordinaryGranted, Math.min(1000, N * 100), `N=${N}: ordinary total is min(1000, N*100)`);
  eq(operatorGranted, 5000, `N=${N}: operator keeps its FULL 5000 units`);
  ok(c.g <= 6000, `N=${N}: global never exceeds 6000 (${c.g})`);
}

console.log('\n[3] a refusal takes nothing (no partial consumption)');
{
  const st = createMemoryResearchStore();
  for (let i = 0; i < 10; i += 1) for (let u = 0; u < 100; u += 1) await reserve(st, `user-${i}`); // saturate the aggregate
  const before = nz(st);
  const r = await reserve(st, 'user-new');
  eq(r.code, 'SPEND_NONOPERATOR_DAILY_CAP', 'aggregate refusal uses its own stable code');
  eq(r.status, 429, 'status 429');
  eq(nz(st), before, 'every counter (principal, aggregate, global) is exactly as before the refused call');
  const r2 = await reserve(st, 'user-3'); // also over its own principal cap
  ok(!r2.ok, 'an over-quota principal is refused');
  eq(nz(st), before, 'still no residue after a second refusal');
  const op = await reserve(st, OP);
  ok(op.ok, 'the operator is unaffected by a saturated aggregate');
}

console.log('\n[4] store failure part-way through is fail-closed with no residue');
{
  for (const failOn of [1, 2, 3]) {
    const inner = createMemoryResearchStore();
    let n = 0;
    const flaky = { ...inner, incrBy: async (...a) => { n += 1; if (n === failOn) throw new ResearchStoreUnavailableError('simulated'); return inner.incrBy(...a); } };
    const before = JSON.stringify(inner._dump());
    const r = await guard.reserveSpend({ principalId: 'user-x', endpoint: 'chat', store: flaky, now: NOW, config: CFG() });
    ok(!r.ok && r.code === 'SPEND_GUARD_UNAVAILABLE' && r.status === 503, `incrBy #${failOn} throws -> 503 SPEND_GUARD_UNAVAILABLE`);
    const after = inner._dump();
    ok(Object.values(after).every((v) => v === 0) || JSON.stringify(after) === before, `incrBy #${failOn}: all counters back to zero / unchanged`);
  }
}

console.log('\n[5] adversarial concurrency: 300 ordinary principals x 20 calls interleaved with 6000 operator calls');
{
  const st = yielding(createMemoryResearchStore());
  const inner = st; // _dump forwarded
  const tasks = [];
  const outcome = { ord: 0, op: 0, maxG: 0 };
  for (let i = 0; i < 300; i += 1) for (let u = 0; u < 20; u += 1) tasks.push(guard.reserveSpend({ principalId: `user-${i}`, endpoint: 'chat', store: st, now: NOW, config: CFG() }).then((r) => { if (r.ok) outcome.ord += 1; if (r.ok) outcome.maxG = Math.max(outcome.maxG, r.globalUsed); }));
  for (let u = 0; u < 6000; u += 1) tasks.push(guard.reserveSpend({ principalId: OP, endpoint: 'chat', store: st, now: NOW, config: CFG() }).then((r) => { if (r.ok) outcome.op += 1; if (r.ok) outcome.maxG = Math.max(outcome.maxG, r.globalUsed); }));
  await Promise.all(tasks);
  const c = counters(inner);
  eq(outcome.ord, 1000, 'ordinary grants are exactly the 1000-unit aggregate');
  eq(outcome.op, 5000, 'operator grants are exactly its 5000 units despite 6000 attempts and 6000 ordinary attempts');
  ok(outcome.maxG <= 6000, `no granted reservation ever observed global above 6000 (max ${outcome.maxG})`);
  eq(c.n, 1000, 'final aggregate counter is exactly 1000 (all refused attempts refunded)');
  eq(c.g, 6000, 'final global counter is exactly 6000');
}

console.log('\n[6] UTC reset');
{
  const st = createMemoryResearchStore();
  const late = new Date('2026-10-12T23:59:59.999Z');
  const early = new Date('2026-10-13T00:00:00.000Z');
  const cfg = CFG();
  for (let i = 0; i < 10; i += 1) for (let u = 0; u < 100; u += 1) await guard.reserveSpend({ principalId: `user-${i}`, endpoint: 'chat', store: st, now: late, config: cfg });
  const blocked = await guard.reserveSpend({ principalId: 'user-20', endpoint: 'chat', store: st, now: late, config: cfg });
  eq(blocked.code, 'SPEND_NONOPERATOR_DAILY_CAP', 'saturated at 23:59:59.999Z');
  ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 1, 'retry-after is the 1 second to midnight');
  const fresh = await guard.reserveSpend({ principalId: 'user-20', endpoint: 'chat', store: st, now: early, config: cfg });
  ok(fresh.ok, 'the very next millisecond (00:00:00.000Z) starts a fresh aggregate');
  ok(guard.nonOperatorDayKey(late) !== guard.nonOperatorDayKey(early), 'the aggregate key is day-scoped');
  eq(st._dump()[guard.nonOperatorDayKey(early)], 1, 'new-day aggregate counted only the new call');
}

console.log('\n[7] misconfiguration and legacy behaviour');
{
  const st = createMemoryResearchStore();
  const r = await guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', store: st, now: NOW, config: CFG({ globalDaily: 5000 }) });
  eq(r.code, 'SPEND_NONOPERATOR_DAILY_CAP', 'when global == operator reserve, ordinary accounts get nothing (reserve is structurally untouchable)');
  const st2 = createMemoryResearchStore();
  const cfgNoOp = CFG({ operatorPrincipalIds: new Set() });
  let granted = 0;
  for (let i = 0; i < 100; i += 1) { const x = await guard.reserveSpend({ principalId: `u${i}`, endpoint: 'chat', store: st2, now: NOW, config: cfgNoOp }); if (x.ok) granted += 1; }
  eq(granted, 100, 'no operator configured: pooled limit is NOT imposed (ordinary quotas behave exactly as before)');
  eq(st2._dump()[guard.nonOperatorDayKey(NOW)] ?? 0, 0, 'no aggregate counter is written when no operator is configured');
  const st3 = createMemoryResearchStore();
  const x = await guard.reserveSpend({ principalId: OP, endpoint: 'grade', store: st3, now: NOW, config: CFG() });
  ok(x.ok && x.principalCap === 5000 && x.globalCap === 6000, 'success shape unchanged (principalCap 5000, globalCap 6000)');
  eq(st3._dump()[guard.nonOperatorDayKey(NOW)] ?? 0, 0, 'an operator reservation never touches the aggregate');
}

console.log('\n[8] FAIL-CLOSED operator configuration (v3): absent / empty / malformed / unrecognized');
{
  const UUID = '95b42d2e-a1d8-47de-904e-798122731b08';
  const UUID2 = '01A0283A-B1B6-7F90-9B41-9C06BEE6ECBA';
  const p = guard.parseOperatorIds;
  eq(p(undefined).status, 'absent', 'undefined -> absent');
  eq(p(null).status, 'absent', 'null -> absent');
  for (const v of ['', '   ', ',', ' , , ']) eq(p(v).status, 'empty', `${JSON.stringify(v)} -> empty`);
  for (const v of ['admin', 'jimmy@example.com', UUID + ',not-a-uuid', UUID + 'x', '"' + UUID + '"', '95b42d2e-a1d8-47de-904e', 'operator']) eq(p(v).status, 'malformed', `${JSON.stringify(v)} -> malformed`);
  eq(p(UUID).status, 'ok', 'one valid uuid -> ok');
  eq(p(` ${UUID} , ${UUID2} `).ids.length, 2, 'two valid uuids (spaces, mixed case) -> ok');

  const HOSTED = { VERCEL: '1' };
  eq(guard.resolveSpendConfig({ ...HOSTED }).requireOperatorConfig, true, 'a hosted runtime REQUIRES operator configuration');
  eq(guard.resolveSpendConfig({ ...HOSTED }).operatorConfigStatus, 'absent', 'hosted, variable unset -> absent');
  eq(guard.resolveSpendConfig({ ...HOSTED, SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: '' }).operatorConfigStatus, 'empty', 'hosted, empty string -> empty');
  eq(guard.resolveSpendConfig({ ...HOSTED, SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: 'root' }).operatorConfigStatus, 'malformed', 'hosted, junk -> malformed');
  eq(guard.resolveSpendConfig({ NODE_ENV: 'production' }).requireOperatorConfig, true, 'NODE_ENV=production also requires it');
  eq(guard.resolveSpendConfig({ GRAILKEY_CATALOG_ENVIRONMENT: 'production' }).requireOperatorConfig, true, 'GRAILKEY_CATALOG_ENVIRONMENT=production also requires it');
  eq(guard.resolveSpendConfig({}).requireOperatorConfig, false, 'only a tests/*.test.js harness process is exempt (this process)');

  const spyStore = () => { const inner = createMemoryResearchStore(); const spy = { calls: 0 }; const w = {}; for (const k of Object.keys(inner)) w[k] = (...a) => { spy.calls += 1; return inner[k](...a); }; w._dump = inner._dump; w.spy = spy; return w; };
  const hostedCfg = (envOver) => ({ ...guard.resolveSpendConfig({ ...HOSTED, ...envOver }), principalDaily: 100, operatorDaily: 5000, globalDaily: 6000, nonOperatorDaily: 1000 });
  const errs = []; const origErr = console.error; console.error = (...a) => { errs.push(a.join(' ')); };
  for (const [label, envOver, reason] of [['absent', {}, 'absent'], ['empty', { SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: '' }, 'empty'], ['malformed', { SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: 'admin,' + UUID }, 'malformed']]) {
    guard.resetOperatorRecognitionCache();
    const st = spyStore();
    const r = await guard.reserveSpend({ principalId: 'user-1', endpoint: 'grade', store: st, now: NOW, config: hostedCfg(envOver), operatorRecognizer: async () => true });
    ok(!r.ok && r.status === 503 && r.code === 'SPEND_GUARD_MISCONFIGURED' && r.reason === reason, `${label}: refused 503 SPEND_GUARD_MISCONFIGURED (reason ${reason})`);
    eq(st.spy.calls, 0, `${label}: the store was never touched (no quota consumed, nothing to refund)`);
    ok(/operator/i.test(r.error) && /Nothing was charged/.test(r.error), `${label}: actionable message that says nothing was charged`);
    const opR = await guard.reserveSpend({ principalId: UUID, endpoint: 'grade', store: st, now: NOW, config: hostedCfg(envOver), operatorRecognizer: async () => true });
    ok(!opR.ok && opR.code === 'SPEND_GUARD_MISCONFIGURED', `${label}: even the real operator is refused (cannot be classified) - never silently treated as ordinary or unlimited`);
  }
  // unrecognized: well-formed but names no operator principal
  guard.resetOperatorRecognitionCache();
  let recogCalls = 0; const notOp = async () => { recogCalls += 1; return false; };
  const cfgUn = hostedCfg({ SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: UUID });
  const stU = spyStore();
  const rUn = await guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', store: stU, now: NOW, config: cfgUn, operatorRecognizer: notOp });
  ok(!rUn.ok && rUn.code === 'SPEND_GUARD_MISCONFIGURED' && rUn.reason === 'unrecognized', 'unrecognized: well-formed id that is NOT an operator principal -> refused (reason unrecognized)');
  eq(stU.spy.calls, 0, 'unrecognized: store never touched');
  for (let i = 0; i < 10; i += 1) await guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', store: stU, now: NOW, config: cfgUn, operatorRecognizer: notOp });
  eq(recogCalls, 1, 'unrecognized: the verdict is cached (1 lookup for 11 requests)');
  // recognized: proceeds and the aggregate applies
  guard.resetOperatorRecognitionCache();
  const stOk = createMemoryResearchStore();
  const rOk = await guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', store: stOk, now: NOW, config: cfgUn, operatorRecognizer: async (id) => id === UUID });
  ok(rOk.ok === true, 'recognized operator configuration: requests proceed');
  eq(stOk._dump()[guard.nonOperatorDayKey(NOW)], 1, '...and the aggregate counter is in force for an ordinary principal');
  // recognition outage must not take paid features down, and must not disable the aggregate
  guard.resetOperatorRecognitionCache();
  const stDb = createMemoryResearchStore();
  const rDb = await guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', store: stDb, now: NOW, config: cfgUn, operatorRecognizer: async () => { throw new Error('db down'); } });
  ok(rDb.ok === true && stDb._dump()[guard.nonOperatorDayKey(NOW)] === 1, 'recognition lookup outage: proceeds, aggregate STILL enforced');
  // no permanent consumption after a misconfiguration refusal
  guard.resetOperatorRecognitionCache();
  const stFix = createMemoryResearchStore();
  await guard.reserveSpend({ principalId: 'user-1', endpoint: 'grade', store: stFix, now: NOW, config: hostedCfg({}), operatorRecognizer: async () => true });
  eq(Object.keys(stFix._dump()).length, 0, 'after refusals nothing was ever written to the store');
  console.error = origErr;
  ok(!errs.some((e) => e.includes(UUID) || e.includes('admin')), 'the misconfiguration log line never prints the configured values');
  ok(errs.some((e) => /operator configuration/.test(e)), '...but does log an actionable line');

  // HTTP shape
  const rr = { h: {}, code: null, body: null, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  guard.sendSpendRefusal(rr, { ok: false, status: 503, code: 'SPEND_GUARD_MISCONFIGURED', reason: 'absent', error: 'x', retryAfterSeconds: 300, resetAt: null });
  ok(rr.code === 503 && rr.body.error === 'SPEND_GUARD_MISCONFIGURED' && rr.body.reason === 'absent', 'the HTTP refusal carries the stable code and a reason code only');

  // non-spend paths never reach the guard
  const { readFileSync } = await import('node:fs');
  for (const f of ['api/auth-clerk.js', 'api/collection.js', 'api/assets.js', 'api/collection-image-v2.js', 'api/collection-image.js', 'api/asset-media.js']) {
    ok(!/spendGuard/.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), `${f} never imports the spend guard (authentication, Collection reads and images stay available)`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
