// tests/appsec01-spend-limits.test.js
//
// APP-SEC-01 PACKAGE C — public-beta spend limits, proven against the REAL durable guard (src/lib/spendGuard.js).
//
// What this pins:
//   - shipped defaults: principal 50, operator 5000, global 6000, non-operator pool 1000 (operator limit and global ceiling
//     are UNCHANGED by this package; only the ordinary-user default moved 300 -> 50);
//   - unit weights of every covered AI endpoint;
//   - per-user exhaustion, principal isolation, non-operator pool exhaustion, global exhaustion;
//   - failed store operations fail CLOSED and refund anything already taken;
//   - limits live in the shared store, not in process memory (two independent "instances" share one store);
//   - the capacity arithmetic reported to the operator (how many maximum-usage accounts the pools support).
//
// Production note: Vercel Production sets SPEND_GUARD_PRINCIPAL_DAILY_UNITS explicitly, and an explicit env value always
// beats this default (asserted below). Changing the default alone does not change a deployment that sets the variable.
//
// Invoke: node tests/appsec01-spend-limits.test.js

import './helpers/spendGuardTestSetup.js';
import { createMemoryResearchStore, ResearchStoreUnavailableError } from '../src/lib/researchStore.js';
import {
  SPEND_DEFAULTS, SPEND_UNITS, resolveSpendConfig, reserveSpend, effectiveNonOperatorCeiling,
  principalDayKey, nonOperatorDayKey, globalDayKey,
} from '../src/lib/spendGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

const OPERATOR = '95b42d2e-0000-4000-8000-000000000001';
const baseEnv = { SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: OPERATOR };
const cfgWith = (extra = {}) => resolveSpendConfig({ ...baseEnv, ...extra });
const recognizer = async () => true;
const reserve = (store, principalId, endpoint, config) => reserveSpend({ principalId, endpoint, store, config, operatorRecognizer: recognizer });
const user = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

console.log('1. shipped defaults');
{
  eq({ ...SPEND_DEFAULTS }, { PRINCIPAL_DAILY_UNITS: 50, OPERATOR_DAILY_UNITS: 5000, GLOBAL_DAILY_UNITS: 6000, NONOPERATOR_DAILY_UNITS: 1000 }, 'defaults: user 50 / operator 5000 / global 6000 / non-operator pool 1000');
  const c = cfgWith();
  eq([c.principalDaily, c.operatorDaily, c.globalDaily, c.nonOperatorDaily], [50, 5000, 6000, 1000], 'resolveSpendConfig with no overrides yields the same limits');
  eq(effectiveNonOperatorCeiling(c), 1000, 'effective ordinary pool is 1000 (global 6000 - operator 5000 leaves 1000 of headroom)');
  ok(Object.isFrozen(SPEND_DEFAULTS) && Object.isFrozen(SPEND_UNITS), 'defaults and unit weights are frozen');
  eq(cfgWith({ SPEND_GUARD_PRINCIPAL_DAILY_UNITS: '100' }).principalDaily, 100, 'an explicit env value (Production currently sets 100) overrides the default');
  eq(cfgWith({ SPEND_GUARD_PRINCIPAL_DAILY_UNITS: 'abc' }).principalDaily, 50, 'an unparseable env value falls back to the 50 default');
}

console.log('2. unit weights of every covered AI endpoint');
eq({ ...SPEND_UNITS }, { grade: 3, 'grade-watch': 1, enrich: 2, comps: 1, chat: 1, manage: 1 }, 'grade 3, grade-watch 1, enrich 2, comps 1, chat 1, manage 1');

console.log('3. per-user exhaustion at the default: a normal scan (grade + enrich = 5 units) gives exactly 10 scans');
{
  const store = createMemoryResearchStore();
  const cfg = cfgWith();
  let scans = 0;
  for (let i = 0; i < 12; i++) {
    const g = await reserve(store, user(1), 'grade', cfg);
    if (!g.ok) break;
    const e = await reserve(store, user(1), 'enrich', cfg);
    if (!e.ok) break;
    scans++;
  }
  eq(scans, 10, 'exactly 10 full scans are served before the user is refused');
  const refused = await reserve(store, user(1), 'grade', cfg);
  eq([refused.ok, refused.status, refused.code], [false, 429, 'SPEND_PRINCIPAL_DAILY_CAP'], 'the 11th scan is refused 429 SPEND_PRINCIPAL_DAILY_CAP');
  eq(store._dump()[principalDayKey(user(1))], 50, 'the refused call was refunded (counter stays at 50, not 53)');
  const other = await reserve(store, user(2), 'grade', cfg);
  ok(other.ok === true, 'principal isolation: a different user is unaffected by user 1 being exhausted');
}

console.log('4. non-operator pool: with 50/user the 1000-unit pool supports exactly 20 maximum-usage accounts');
{
  const store = createMemoryResearchStore();
  const cfg = cfgWith();
  for (let u = 1; u <= 20; u++) {
    for (let i = 0; i < 10; i++) { // 10 x (grade 3 + enrich 2)
      const g = await reserve(store, user(u), 'grade', cfg); const e = await reserve(store, user(u), 'enrich', cfg);
      if (!g.ok || !e.ok) { ok(false, `user ${u} should be served`); break; }
    }
  }
  eq(store._dump()[nonOperatorDayKey()], 1000, '20 maximum-usage accounts consume exactly the 1000-unit pool');
  const twentyFirst = await reserve(store, user(21), 'grade', cfg);
  eq([twentyFirst.ok, twentyFirst.status, twentyFirst.code], [false, 429, 'SPEND_NONOPERATOR_DAILY_CAP'], 'the 21st account is refused by the shared pool (SPEND_NONOPERATOR_DAILY_CAP)');
  eq(store._dump()[principalDayKey(user(21))] ?? 0, 0, 'the 21st account was refunded (nothing burned)');
  const op = await reserve(store, OPERATOR, 'grade', cfg);
  ok(op.ok === true, 'the operator is still served while the ordinary pool is exhausted (reserve preserved)');
  ok(store._dump()[globalDayKey()] <= 6000 - 5000 + 1000 + 3, 'ordinary use never exceeded global minus the operator reserve');
}

console.log('5. operator limit and global ceiling are preserved');
{
  const store = createMemoryResearchStore();
  const cfg = cfgWith();
  let served = 0;
  for (let i = 0; i < 1700; i++) { const r = await reserve(store, OPERATOR, 'grade', cfg); if (!r.ok) break; served += 3; }
  ok(served === 4998 || served === 5000, `operator served up to its 5000-unit cap (served ${served} units)`);
  const next = await reserve(store, OPERATOR, 'grade', cfg);
  eq([next.ok, next.code], [false, 'SPEND_PRINCIPAL_DAILY_CAP'], 'operator refused past 5000 by its own cap');
}

console.log('6. global exhaustion refuses and refunds every counter it took');
{
  const store = createMemoryResearchStore();
  const cfg = cfgWith({ SPEND_GUARD_GLOBAL_DAILY_UNITS: '6000', SPEND_GUARD_OPERATOR_DAILY_UNITS: '5000' });
  await store.incrBy(globalDayKey(), 5999, 3600); // global counter nearly full
  const r = await reserve(store, user(1), 'grade', cfg);
  eq([r.ok, r.status, r.code], [false, 429, 'SPEND_GLOBAL_DAILY_CAP'], 'global ceiling refuses with SPEND_GLOBAL_DAILY_CAP');
  const d = store._dump();
  eq([d[globalDayKey()], d[principalDayKey(user(1))], d[nonOperatorDayKey()]], [5999, 0, 0], 'global, per-user and pool counters are all rolled back');
}

console.log('7. a failing store fails CLOSED (never fails open) and never leaves a charge');
{
  const base = createMemoryResearchStore();
  const down = { ...base, incrBy: async () => { throw new ResearchStoreUnavailableError('redis down'); } };
  const r = await reserve(down, user(1), 'grade', cfgWith());
  eq([r.ok, r.status, r.code], [false, 503, 'SPEND_GUARD_UNAVAILABLE'], 'store down -> 503 SPEND_GUARD_UNAVAILABLE, request refused');

  // second counter fails after the first was taken: the first must be refunded
  const flaky = createMemoryResearchStore();
  let calls = 0;
  const partial = { ...flaky, incrBy: async (k, n, ttl) => { if (++calls === 2) throw new ResearchStoreUnavailableError('redis blip'); return flaky.incrBy(k, n, ttl); }, decrBy: flaky.decrBy };
  const r2 = await reserve(partial, user(1), 'grade', cfgWith());
  eq([r2.ok, r2.code], [false, 'SPEND_GUARD_UNAVAILABLE'], 'a mid-reservation store error also refuses');
  eq(flaky._dump()[principalDayKey(user(1))], 0, 'the already-taken per-user units were refunded');
  const bad = await reserveSpend({ principalId: user(1), endpoint: 'not-an-endpoint', store: createMemoryResearchStore(), config: cfgWith(), operatorRecognizer: recognizer });
  eq([bad.ok, bad.code], [false, 'SPEND_GUARD_UNAVAILABLE'], 'an unknown endpoint label is refused, never charged zero');
}

console.log('8. limits are shared across serverless instances (counters live in the store, not in process memory)');
{
  const shared = createMemoryResearchStore();
  const instanceA = cfgWith(); // each "instance" resolves its own config object
  const instanceB = cfgWith();
  for (let i = 0; i < 5; i++) await reserve(shared, user(1), 'grade', instanceA); // 15 units via instance A
  for (let i = 0; i < 5; i++) await reserve(shared, user(1), 'grade', instanceB); // 15 units via instance B
  eq(shared._dump()[principalDayKey(user(1))], 30, 'two instances sum into one counter in the shared store');
  let more = 0;
  while ((await reserve(shared, user(1), 'enrich', instanceB)).ok) more++;
  eq(more, 10, 'the remaining 20 units (10 enrich calls) are all that is left, regardless of which instance serves them');
}

console.log('9. capacity arithmetic for the operator report');
{
  const c = cfgWith();
  eq(Math.floor(effectiveNonOperatorCeiling(c) / c.principalDaily), 20, 'maximum-usage ordinary accounts the pool supports at 50 units/day: 20');
  eq(Math.floor(effectiveNonOperatorCeiling(cfgWith({ SPEND_GUARD_PRINCIPAL_DAILY_UNITS: '100' })) / 100), 10, 'at the current Production override of 100 units/day: 10');
  eq(Math.floor(effectiveNonOperatorCeiling(cfgWith({ SPEND_GUARD_PRINCIPAL_DAILY_UNITS: '300' })) / 300), 3, 'at the old 300 default: 3');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  ${f}`));
  process.exit(1);
}
process.exit(0);
