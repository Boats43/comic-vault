// Durable ledger path guard for scripts/sweep-runner.mjs: a `run` that writes a ledger under the system temp directory is REFUSED (exit 4, nothing created)
// unless --allow-temp is passed. Negative controls: plain temp path, '..' traversal into temp, a junction/symlink that points into temp, a case variant (Windows),
// a missing ledger argument. Positive controls: a non-temp ledger runs and resumes unchanged; --allow-temp accepts a temp ledger; read-only modes are not guarded.
// Not covered (stated, not skipped silently): Windows 8.3 short-name aliases of the temp directory (realpath.native expands them, but no short name is constructed here).
// Append/fsync/resume/interruption behavior itself is proven by tests/sweep-runner-instrumentation.test.js, which now passes --allow-temp explicitly.
// Invoke: node tests/sweep-runner-ledger-guard.test.js
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const root = fileURLToPath(new URL('..', import.meta.url));
const runner = join(root, 'scripts', 'sweep-runner.mjs');
const sh = (args, opts = {}) => spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', ...opts });
const lastJson = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

const tree = mkdtempSync(join(tmpdir(), 'sweep-guard-tree-'));
mkdirSync(join(tree, 'tests'));
writeFileSync(join(tree, 'tests', 'a-pass.test.js'), "console.log('ok');\n");
const tempWork = mkdtempSync(join(tmpdir(), 'sweep-guard-work-'));
const durable = join(root, `.ledger-guard-${process.pid}`);   // a non-temp directory (inside the repo checkout), removed in finally
mkdirSync(durable);
const link = join(durable, 'into-temp');
try {
  console.log('-- negative controls --');
  const nested = join(tempWork, 'sub', 'nested', 'ledger.jsonl');
  let r = sh(['run', tree, nested, '5000', '128']);
  ok(r.status === 4 && /REFUSED/.test(r.stderr) && /--allow-temp/.test(r.stderr), `a ledger under the temp directory is refused (exit ${r.status}) and the message names --allow-temp`);
  ok(!existsSync(nested) && !existsSync(join(tempWork, 'sub')), 'the refused run created neither the ledger nor its parent directories (nothing was redirected or created)');

  const viaDots = join(tempWork, 'a', '..', 'b', 'ledger.jsonl');
  r = sh(['run', tree, viaDots, '5000', '128']);
  ok(r.status === 4 && !existsSync(join(tempWork, 'b')), "a path that reaches temp through '..' segments is refused");

  const rel = relative(root, join(tempWork, 'rel', 'ledger.jsonl'));
  r = sh(['run', tree, rel, '5000', '128'], { cwd: root });
  ok(r.status === 4 && !existsSync(join(tempWork, 'rel')), `a relative path resolving into temp is refused (${rel.length > 60 ? rel.slice(0, 57) + '...' : rel})`);

  mkdirSync(join(tempWork, 'target'));
  symlinkSync(join(tempWork, 'target'), link, 'junction');   // 'junction' needs no privilege on Windows and is ignored on POSIX
  r = sh(['run', tree, join(link, 'ledger.jsonl'), '5000', '128']);
  ok(r.status === 4 && !existsSync(join(tempWork, 'target', 'ledger.jsonl')), 'a ledger addressed through a junction/symlink that points into temp is refused by its REAL path');

  if (process.platform === 'win32') {
    r = sh(['run', tree, join(tempWork, 'upper', 'ledger.jsonl').toUpperCase(), '5000', '128']);
    ok(r.status === 4, 'a case-variant spelling of the temp path is refused on a case-insensitive filesystem');
  } else {
    console.log('  (case-variant control applies to Windows only; this platform is case-sensitive)');
  }

  r = sh(['run', tree]);
  ok(r.status === 4 && /fail closed/.test(r.stderr), 'a missing ledger argument is refused (fail closed), not crashed after starting');

  console.log('-- positive controls --');
  const good = join(durable, 'ledger.jsonl');
  r = sh(['run', tree, good, '20000', '128']);
  ok(r.status === 0 && lastJson(r).total === 1 && lastJson(r).PASS === 1, 'a ledger outside temp runs normally (1 PASS)');
  const lines = readFileSync(good, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  ok(lines.map((e) => e.t).join() === 'run,start,end' && lines[2].status === 'PASS', 'append-only run/start/end records are written as before');
  r = sh(['run', tree, good, '20000', '128']);
  ok(r.status === 0 && readFileSync(good, 'utf8').split('\n').filter((l) => l && JSON.parse(l).t === 'end').length === 1, 'resume semantics unchanged: a second run re-executes nothing already completed');

  const allowed = join(tempWork, 'allowed.jsonl');
  r = sh(['run', tree, allowed, '20000', '128', '--allow-temp']);
  ok(r.status === 0 && existsSync(allowed) && lastJson(r).PASS === 1, '--allow-temp explicitly accepts a throwaway temp ledger');

  r = sh(['summary', tree, allowed]);
  ok(r.status === 0 && JSON.parse(r.stdout).PASS === 1, 'read-only modes (summary) over a temp ledger are not guarded');
  ok(!readdirSync(root).some((f) => f === 'ledger.jsonl'), 'no ledger was written into the repository root by any refused run');
} finally {
  try { unlinkSync(link); } catch { try { rmdirSync(link); } catch { /* already gone */ } }
  rmSync(durable, { recursive: true, force: true });
  rmSync(tree, { recursive: true, force: true });
  rmSync(tempWork, { recursive: true, force: true });
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
