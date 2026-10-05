// tests/spend-guard-env-boundary.test.js
//
// UNIVERSAL U1, 0A — the spend guard's test-harness fallback must be
// UNREACHABLE from any hosted/production runtime. Permanent invariant:
// PRODUCTION MUST HAVE NO PATH THAT SILENTLY DISABLES DURABLE SPEND AUTHORITY.
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

const TEST_ARGV = path.join(repoRoot, 'tests', 'anything.test.js');
const REAL_ARGVS = ['/var/task/api/chat.js', '/var/task/___vc/__launcher/launcher.js', '/var/task/node_modules/@vercel/node/dist/launcher.js', 'C:\\app\\server.js', ''];

console.log('1. baseline: a bare tests/*.test.js process with no markers engages the harness store');
ok(guard.isTestHarnessProcess(TEST_ARGV, {}) === true, 'plain test process, empty env -> harness store allowed');
ok(guard.defaultSpendStore(TEST_ARGV, {}) !== rs.researchStore(), 'and it is the in-memory store (not the durable one)');

console.log('\n2. EVERY hosted/production marker, individually, refuses the in-memory fallback');
const MARKERS = {
  VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'x.vercel.app', VERCEL_REGION: 'iad1',
  VERCEL_DEPLOYMENT_ID: 'dpl_x', VERCEL_GIT_COMMIT_SHA: 'abc', VERCEL_PROJECT_PRODUCTION_URL: 'x',
  AWS_LAMBDA_FUNCTION_NAME: 'fn', AWS_LAMBDA_RUNTIME_API: '127.0.0.1:9001', AWS_LAMBDA_FUNCTION_VERSION: '$LATEST',
  LAMBDA_TASK_ROOT: '/var/task', LAMBDA_RUNTIME_DIR: '/var/runtime', AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
  NOW_REGION: 'iad1', NODE_ENV: 'production', GRAILKEY_CATALOG_ENVIRONMENT: 'production',
};
for (const [k, v] of Object.entries(MARKERS)) {
  const env = { [k]: v };
  ok(guard.isTestHarnessProcess(TEST_ARGV, env) === false, `${k}=${v} -> fallback REFUSED even for a tests/*.test.js argv`);
  ok(guard.defaultSpendStore(TEST_ARGV, env) === rs.researchStore(), `${k} -> the store returned is the durable (Upstash) store, never memory`);
}
ok(guard.isTestHarnessProcess(TEST_ARGV, { VERCEL: '' }) === true, 'an EMPTY marker value is not a marker (no false refusal of a clean test shell)');
ok(guard.isTestHarnessProcess(TEST_ARGV, { SOME_OTHER_VERCEL_LIKE: '1', NOT_VERCEL: '1' }) === true, 'unrelated names containing the word do not trip it');
ok(guard.isTestHarnessProcess(TEST_ARGV, { GRAILKEY_CATALOG_ENVIRONMENT: 'development', NODE_ENV: 'test' }) === true, 'a development test environment still works');
ok(guard.isTestHarnessProcess(TEST_ARGV, { VERCEL_PLUGIN_SETUP_MODE: '1', VERCEL_PLUGIN_BOOTSTRAP_HINTS: 'x' }) === true, 'VERCEL_PLUGIN_* (Claude Code Vercel plugin, dev-machine noise) is not a hosted-runtime marker');
ok(guard.isTestHarnessProcess(TEST_ARGV, { VERCEL_OIDC_TOKEN: 'local-dev-token-from-env-pull' }) === true, 'VERCEL_OIDC_TOKEN alone (a `vercel env pull` dev-machine artifact) is not a hosted-runtime marker');
ok(guard.isTestHarnessProcess(TEST_ARGV, { VERCEL_OIDC_TOKEN: 'x', VERCEL: '1', VERCEL_ENV: 'production', VERCEL_REGION: 'iad1', AWS_LAMBDA_FUNCTION_NAME: 'f', LAMBDA_TASK_ROOT: '/var/task' }) === false, 'a realistic full hosted-runtime environment (OIDC token included) is refused');

console.log('\n3. a real function entry point can never match, with or without markers');
for (const argv of REAL_ARGVS) {
  ok(guard.isTestHarnessProcess(argv, {}) === false, `argv[1]=${JSON.stringify(argv)} -> not a harness process`);
  ok(guard.isTestHarnessProcess(argv, { VERCEL: '1' }) === false, `argv[1]=${JSON.stringify(argv)} + VERCEL -> not a harness process`);
}

console.log('\n4. end to end: with a hosted marker and NO KV configured, reservation FAILS CLOSED (503), never in-memory');
{
  const saved = {};
  for (const k of ['VERCEL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) { saved[k] = process.env[k]; }
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  process.env.VERCEL = '1';
  rs.setResearchStoreForTests(null); // no injected store: the real selection path
  const errs = console.error; console.error = () => {};
  const r = await guard.reserveSpend({ principalId: 'prod-like-user', endpoint: 'chat' });
  console.error = errs;
  ok(r.ok === false && r.status === 503 && r.code === 'SPEND_GUARD_UNAVAILABLE', 'VERCEL set + no durable store -> 503 SPEND_GUARD_UNAVAILABLE (fail closed)');
  const r2 = await guard.reserveSpend({ principalId: 'prod-like-user', endpoint: 'chat' });
  ok(r2.ok === false, 'and it keeps failing closed (nothing was silently counted in memory)');
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

console.log('\n5. static: the in-memory store is referenced only by the guard fallback and its own definition');
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
  hits.sort();
  ok(JSON.stringify(hits) === JSON.stringify(['src/lib/researchStore.js', 'src/lib/spendGuard.js']), `createMemoryResearchStore appears only in researchStore.js (definition) and spendGuard.js (guarded fallback) (got ${JSON.stringify(hits)})`);
  const guardSrc = readFileSync(path.join(repoRoot, 'src/lib/spendGuard.js'), 'utf8');
  ok(/hostedRuntimeMarkers\(env\)\.length > 0\) return false/.test(guardSrc), 'the refusal on any hosted-runtime marker is in the source');
  ok(!/process\.env\.[A-Z_]*(DISABLE|BYPASS|SKIP)[A-Z_]*SPEND/i.test(guardSrc) && !/SPEND_GUARD_(OFF|DISABLED|BYPASS)/.test(guardSrc), 'there is no env-var bypass switch for the guard');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
process.exit(0);
