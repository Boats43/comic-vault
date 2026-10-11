// tests/spend-guard-env-boundary.test.js
//
// UNIVERSAL U1 0A, rewritten for GK-L1A v4 -- THE SPEND GUARD HAS NO TEST EXCEPTION AND NO ENVIRONMENT EXCEPTION.
// Permanent invariant: PRODUCTION (AND EVERY OTHER ENVIRONMENT) MUST HAVE NO PATH THAT SILENTLY DISABLES DURABLE SPEND AUTHORITY.
//
// This process IS a tests/*.test.js script. Under the old design that unlocked an in-memory store and exempted operator
// configuration. It now unlocks nothing: with no explicit injection the guard FAILS CLOSED here exactly as it does on
// Vercel, and an absent/empty/malformed/unrecognized operator configuration is refused in every environment.
//
// Invoke: node tests/spend-guard-env-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = await import('../src/lib/spendGuard.js');
const rs = await import('../src/lib/researchStore.js');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const OPERATOR = '95b42d2e-a1d8-47de-904e-798122731b08';
const recognizer = async () => true;

console.log('1. the test-sniffing predicates and the in-memory fallback no longer exist');
{
  ok(typeof guard.isTestHarnessProcess === 'undefined', 'isTestHarnessProcess is gone');
  ok(typeof guard.hostedRuntimeMarkers === 'undefined', 'hostedRuntimeMarkers is gone');
  ok(guard.defaultSpendStore() === rs.researchStore(), 'defaultSpendStore() is ALWAYS the durable store (or an explicit injection) - never a process-local one');
  const src = readFileSync(path.join(repoRoot, 'src/lib/spendGuard.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(!/process\.argv|\.test\.js|harness|NODE_ENV|VERCEL|AWS_|LAMBDA/i.test(src), 'spendGuard.js (code, not comments) reads no argv and no environment marker to relax anything');
}

console.log('\n2. in EVERY environment, absent operator configuration is refused (nothing charged), tests included');
const ENVS = {
  'plain test process (no markers)': {},
  VERCEL: { VERCEL: '1' }, VERCEL_ENV: { VERCEL_ENV: 'production' }, VERCEL_URL: { VERCEL_URL: 'x.vercel.app' },
  AWS_LAMBDA_FUNCTION_NAME: { AWS_LAMBDA_FUNCTION_NAME: 'fn' }, AWS_EXECUTION_ENV: { AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' },
  'NODE_ENV=production': { NODE_ENV: 'production' }, 'NODE_ENV=development': { NODE_ENV: 'development' },
  'GRAILKEY_CATALOG_ENVIRONMENT=production': { GRAILKEY_CATALOG_ENVIRONMENT: 'production' },
  'GRAILKEY_CATALOG_ENVIRONMENT=development': { GRAILKEY_CATALOG_ENVIRONMENT: 'development' },
};
const KEYS = ['SPEND_GUARD_OPERATOR_PRINCIPAL_IDS', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', ...new Set(Object.values(ENVS).flatMap((e) => Object.keys(e)))];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const restore = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
const withEnv = async (over, fn) => { restore(); for (const k of KEYS) delete process.env[k]; Object.assign(process.env, over); try { return await fn(); } finally { restore(); } };
for (const [label, over] of Object.entries(ENVS)) {
  for (const [cfgLabel, cfgVal] of [['unset', undefined], ['empty', ''], ['malformed', 'admin'], ['unrecognized', OPERATOR]]) {
    const r = await withEnv({ ...over, ...(cfgVal === undefined ? {} : { SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: cfgVal }) }, () => quiet(() => {
      rs.setResearchStoreForTests(rs.createMemoryResearchStore()); // a perfectly good injected store: the refusal must not depend on the store
      guard.resetOperatorRecognitionCache();
      return guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', operatorRecognizer: cfgLabel === 'unrecognized' ? async () => false : recognizer });
    }));
    ok(r.ok === false && r.status === 503 && r.code === 'SPEND_GUARD_MISCONFIGURED', `${label} + ${cfgLabel} operator configuration -> 503 SPEND_GUARD_MISCONFIGURED`);
  }
}
rs.setResearchStoreForTests(null);

console.log('\n3. a VALID configuration with NO durable store fails closed everywhere (no in-memory fallback)');
for (const [label, over] of Object.entries(ENVS)) {
  const r = await withEnv({ ...over, SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: OPERATOR }, () => quiet(() => {
    rs.setResearchStoreForTests(null);
    guard.resetOperatorRecognitionCache();
    return guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', operatorRecognizer: recognizer });
  }));
  ok(r.ok === false && r.status === 503 && r.code === 'SPEND_GUARD_UNAVAILABLE', `${label}: valid operator config, no store -> 503 SPEND_GUARD_UNAVAILABLE`);
  const r2 = await withEnv({ ...over, SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: OPERATOR }, () => quiet(() => guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', operatorRecognizer: recognizer })));
  ok(r2.ok === false, `${label}: ...and it keeps failing closed`);
}

console.log('\n4. a valid configuration WITH an explicitly injected store works in this very test process (the only way a test gets a store)');
{
  const st = rs.createMemoryResearchStore();
  rs.setResearchStoreForTests(st);
  const r = await withEnv({ SPEND_GUARD_OPERATOR_PRINCIPAL_IDS: OPERATOR }, () => { guard.resetOperatorRecognitionCache(); return guard.reserveSpend({ principalId: 'user-1', endpoint: 'chat', operatorRecognizer: recognizer }); });
  ok(r.ok === true, 'explicit injection + valid configuration -> reservation granted');
  rs.setResearchStoreForTests(null);
}

console.log('\n5. static: the in-memory store is defined in researchStore.js and referenced by NO production file that could select it');
{
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.git', 'tests', 'docs', 'scripts', '.vercel'].includes(name)) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs)$/.test(name) && readFileSync(full, 'utf8').includes('createMemoryResearchStore')) hits.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
    }
  };
  walk(path.join(repoRoot, 'src')); walk(path.join(repoRoot, 'api'));
  ok(JSON.stringify(hits.sort()) === JSON.stringify(['src/lib/researchStore.js']), `createMemoryResearchStore appears only in its own definition file (${hits.join(', ')})`);
  const guardSrc = readFileSync(path.join(repoRoot, 'src/lib/spendGuard.js'), 'utf8');
  ok(!/process\.env\.[A-Z_]*(DISABLE|BYPASS|SKIP)[A-Z_]*SPEND/i.test(guardSrc) && !/SPEND_GUARD_(OFF|DISABLED|BYPASS)/.test(guardSrc), 'there is no env-var bypass switch for the guard');
  ok(/export const setOperatorRecognizerForTests/.test(guardSrc) && !/setOperatorRecognizerForTests\(/.test(readFileSync(path.join(repoRoot, 'api/chat.js'), 'utf8')), 'the explicit test seam exists and no handler calls it');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
process.exit(0);
