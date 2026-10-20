// scripts/sweep-runner.mjs resource instrumentation + unchanged semantics, proven on a throwaway 4-file tree (pass / fail / hang / pass).
// Asserts: the new per-file fields (free memory before/after, wall-clock, cumulative counts, exit classification) are appended to the SAME jsonl stream;
// the statuses and the timeout ceiling behave exactly as before (a hang is killed at the ceiling and classified TIMEOUT); the summary reader still accepts the stream;
// and the memory gate keeps its 3000 MB floor / 70% commit ceiling.
// Invoke: node tests/sweep-runner-instrumentation.test.js
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const root = fileURLToPath(new URL('..', import.meta.url));
const runner = join(root, 'scripts', 'sweep-runner.mjs');
const tree = mkdtempSync(join(tmpdir(), 'sweep-rt-'));
mkdirSync(join(tree, 'tests'));
writeFileSync(join(tree, 'tests', 'a-pass.test.js'), "console.log('ok');\n");
writeFileSync(join(tree, 'tests', 'b-fail.test.js'), "console.log('boom'); process.exit(1);\n");
writeFileSync(join(tree, 'tests', 'c-hang.test.js'), 'setTimeout(() => {}, 60000);\n');
writeFileSync(join(tree, 'tests', 'd-pass.test.js'), "console.log('x');\n");
const out = join(tree, 'ledger.jsonl');
try {
  const r = spawnSync(process.execPath, [runner, 'run', tree, out, '2500', '128', '--allow-temp'], { encoding: 'utf8' });
  const summary = JSON.parse(r.stdout.trim().split('\n').pop());
  ok(summary.total === 4 && summary.PASS === 2 && summary.FAIL === 1 && summary.TIMEOUT === 1 && summary.NOT_RUN === 0, `statuses unchanged: ${JSON.stringify({ PASS: summary.PASS, FAIL: summary.FAIL, TIMEOUT: summary.TIMEOUT })}`);
  const L = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const ends = L.filter((e) => e.t === 'end'), starts = L.filter((e) => e.t === 'start'), run = L.find((e) => e.t === 'run');
  ok(Number.isFinite(run.memFreeMB) && run.memFreeMB > 0, `run record carries memFreeMB (${run.memFreeMB})`);
  ok(starts.length === 4 && starts.every((e) => Number.isFinite(e.memFreeBeforeMB) && e.memFreeBeforeMB > 0), 'every start record carries memFreeBeforeMB');
  ok(ends.length === 4 && ends.every((e) => Number.isFinite(e.memFreeBeforeMB) && Number.isFinite(e.memFreeAfterMB) && e.memDeltaMB === e.memFreeAfterMB - e.memFreeBeforeMB), 'every end record carries memFreeBeforeMB / memFreeAfterMB / memDeltaMB (delta consistent)');
  ok(ends.every((e) => Number.isFinite(e.wallMs) && e.wallMs === e.ms && e.wallMs >= 0), 'every end record carries wallMs (equal to the existing ms field)');
  ok(ends.map((e) => e.cumulativeInvocation).join() === '1,2,3,4' && ends.map((e) => e.cumulativeLedger).join() === '1,2,3,4', 'cumulative file counts (this invocation and ledger-wide) increase 1..4');
  const byFile = Object.fromEntries(ends.map((e) => [e.file, e]));
  ok(byFile['a-pass.test.js'].exitClass === 'ok' && byFile['d-pass.test.js'].exitClass === 'ok', 'passing files classify as ok');
  ok(byFile['b-fail.test.js'].exitClass === 'nonzero-exit' && byFile['b-fail.test.js'].code === 1, 'failing file classifies as nonzero-exit (code 1 preserved)');
  ok(byFile['c-hang.test.js'].status === 'TIMEOUT' && byFile['c-hang.test.js'].exitClass === 'killed-at-ceiling' && byFile['c-hang.test.js'].signal === 'SIGKILL', 'a hang is still killed at the ceiling: TIMEOUT / killed-at-ceiling / SIGKILL');
  ok(byFile['c-hang.test.js'].wallMs >= 2400 && byFile['c-hang.test.js'].wallMs < 6000, `the timeout ceiling is unchanged (2500 ms ceiling, observed ${byFile['c-hang.test.js'].wallMs} ms)`);
  const s2 = spawnSync(process.execPath, [runner, 'summary', tree, out], { encoding: 'utf8' });
  ok(JSON.parse(s2.stdout).TIMEOUT === 1, 'the summary reader still accepts the instrumented stream');
  const r2 = spawnSync(process.execPath, [runner, 'run', tree, out, '2500', '128', '--allow-temp'], { encoding: 'utf8' });
  ok(JSON.parse(r2.stdout.trim().split('\n').pop()).total === 4 && readFileSync(out, 'utf8').split('\n').filter((l) => l && JSON.parse(l).t === 'end').length === 4, 'resume semantics unchanged: a second run re-executes nothing already completed');
  const gate = readFileSync(join(root, 'scripts', 'sweep-gate.ps1'), 'utf8');
  ok(/\$MinFreeMB\s*=\s*3000/.test(gate) && /\$MaxCommitPct\s*=\s*70/.test(gate), 'the gate keeps its 3000 MB free-memory floor and 70% commit ceiling');
} finally {
  rmSync(tree, { recursive: true, force: true });
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
