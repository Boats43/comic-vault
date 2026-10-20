// Durable certification evidence contract for scripts/sweep-runner.mjs `finalize`, proven on a throwaway 3-file git tree (no repo sweep is launched).
// Asserts: every required artifact exists AFTER the runner process has exited; the raw ledger is preserved byte for byte; the prediction hash is a full SHA-256 of the exact
// prediction bytes; the manifest pins git blob ids at the tested sha; tested sha and HEAD are recorded distinctly when a later (evidence-only) commit exists; prediction vs
// actual is reconciled; unresolved failures are listed; a second finalize into the same directory REFUSES (exit 3) and leaves every byte untouched; a non-ancestor sha is refused.
// Invoke: node tests/sweep-runner-evidence-contract.test.js
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const root = fileURLToPath(new URL('..', import.meta.url));
const runner = join(root, 'scripts', 'sweep-runner.mjs');
const tree = mkdtempSync(join(tmpdir(), 'sweep-ev-'));
const g = (...a) => spawnSync('git', ['-C', tree, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
try {
  g('init', '-q');
  mkdirSync(join(tree, 'tests'));
  writeFileSync(join(tree, 'tests', 'a-pass.test.js'), "console.log('ok');\n");
  writeFileSync(join(tree, 'tests', 'b-fail.test.js'), "console.log('boom'); process.exit(1);\n");
  writeFileSync(join(tree, 'tests', 'c-pass.test.js'), "console.log('x');\n");
  g('add', '-A'); g('commit', '-q', '-m', 'tested');
  const tested = g('rev-parse', 'HEAD').stdout.trim();
  const ledger = join(tree, 'ledger.jsonl'), evRoot = join(tree, 'evidence');
  const pred = join(tree, 'PREDICTION.txt');
  writeFileSync(pred, 'PRE-SWEEP PREDICTION\nEXPECTED TOTALS: 2 PASS / 1 FAIL / 0 TIMEOUT / 0 ENV_ERROR / 0 INTERRUPTED / 0 NOT_RUN = 3\n');
  await new Promise((r) => setTimeout(r, 30));
  const run = spawnSync(process.execPath, [runner, 'run', tree, ledger, '20000', '128', '--allow-temp'], { encoding: 'utf8' });
  ok(JSON.parse(run.stdout.trim().split('\n').pop()).total === 3, 'throwaway sweep completed (3 files)');
  // a later evidence-only commit makes HEAD differ from the tested sha
  writeFileSync(join(tree, 'NOTE.md'), 'evidence-only\n'); g('add', 'NOTE.md'); g('commit', '-q', '-m', 'evidence only');
  const head = g('rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(tree, 'tests', 'z-late-untested.test.js'), "console.log('late');\n");   // an untracked file added AFTER the sweep must not enter the tested roster
  const fin = spawnSync(process.execPath, [runner, 'finalize', tree, ledger, evRoot, `--tested-sha=${tested}`, `--prediction=${pred}`, '--label=t'], { encoding: 'utf8' });
  ok(fin.status === 0, `finalize exits 0 (status ${fin.status}) ${fin.stderr.trim().slice(0, 120)}`);
  const info = JSON.parse(fin.stdout.trim().split('\n').pop());
  const dir = info.evidenceDir;
  const need = ['source-sha.txt', 'manifest.json', 'prediction.txt', 'prediction.sha256', 'results.raw.jsonl', 'results.json', 'resources.json', 'reconciliation.json', 'SUMMARY.md'];
  ok(need.every((f) => existsSync(join(dir, f))), 'every required artifact exists after the runner process exited');
  ok(readFileSync(join(dir, 'results.raw.jsonl'), 'utf8') === readFileSync(ledger, 'utf8'), 'raw ledger preserved byte for byte');
  const predBuf = readFileSync(pred);
  ok(readFileSync(join(dir, 'prediction.txt')).equals(predBuf) && readFileSync(join(dir, 'prediction.sha256'), 'utf8').startsWith(`${sha256(predBuf)}  `) && sha256(predBuf).length === 64, 'prediction copied exactly; full 64-hex SHA-256 recorded');
  const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const blob = g('rev-parse', `${tested}:tests/a-pass.test.js`).stdout.trim();
  ok(man.fileCount === 3 && JSON.parse(readFileSync(join(dir, 'reconciliation.json'), 'utf8')).actual.total === 3 && !man.files.some((f) => /z-late/.test(f.file)) && man.matchesLedgerRoster === true && man.files.find((f) => f.file === 'a-pass.test.js').gitBlob === blob, 'manifest pins exactly the 3 tested files (a later untracked file is excluded) with git blob ids at the tested sha');
  const sha = readFileSync(join(dir, 'source-sha.txt'), 'utf8');
  ok(sha.includes(`tested_source_sha=${tested}`) && sha.includes(`head_at_finalize=${head}`) && tested !== head && /NO: HEAD differs/.test(sha), 'tested sha and later HEAD recorded as distinct; evidence commit is not claimed as tested');
  const rec = JSON.parse(readFileSync(join(dir, 'reconciliation.json'), 'utf8'));
  ok(rec.complete === true && rec.reconciliation.PASS.match && rec.reconciliation.FAIL.match && rec.reconciliation.total.match && rec.prediction.mtimePrecedesFirstRun === true, 'prediction reconciles with actual (2 PASS / 1 FAIL / 3) and predates the first run');
  const summary = readFileSync(join(dir, 'SUMMARY.md'), 'utf8');
  ok(/FAIL b-fail\.test\.js \(exit 1\)/.test(summary) && /not recorded in the ledger/.test(summary), 'SUMMARY lists the unresolved failure and states the uncaptured assertion-coverage gap');
  ok(JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')).find((r) => r.file === 'b-fail.test.js').exitClass === 'nonzero-exit', 'per-file exit classification retained');
  const before = need.map((f) => readFileSync(join(dir, f), 'utf8'));
  const again = spawnSync(process.execPath, [runner, 'finalize', tree, ledger, evRoot, `--tested-sha=${tested}`, `--prediction=${pred}`, '--label=t'], { encoding: 'utf8' });
  ok(again.status === 3 && /REFUSED/.test(again.stderr), 'a second finalize into the same evidence directory is REFUSED (exit 3)');
  ok(need.every((f, i) => readFileSync(join(dir, f), 'utf8') === before[i]) && readdirSync(evRoot).length === 1, 'the refused run changed no byte and created no sibling directory');
  const bad = spawnSync(process.execPath, [runner, 'finalize', tree, ledger, evRoot, `--tested-sha=${'0'.repeat(40)}`], { encoding: 'utf8' });
  ok(bad.status === 2 && readdirSync(evRoot).length === 1, 'a sha that is not an ancestor of HEAD is refused and writes nothing');
} finally {
  rmSync(tree, { recursive: true, force: true });
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
