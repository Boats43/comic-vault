// scripts/gated-run.mjs: a BLOCK from the gate must prevent the command from starting, with a non-zero exit. The proof uses stub gates (exit 2 / exit 0) and a command that
// writes a marker file the moment it starts; the marker's absence after a BLOCK is the evidence that the process never ran.
// Also pins that the real gate's thresholds are untouched (3000 MB free, 70% commit) and that the wrapper offers no threshold override.
// Invoke: node tests/gated-run.test.js
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const root = fileURLToPath(new URL('..', import.meta.url));
const wrapper = join(root, 'scripts', 'gated-run.mjs');
const dir = mkdtempSync(join(tmpdir(), 'gated-run-'));
try {
  const block = join(dir, 'gate-block.mjs');
  const pass = join(dir, 'gate-pass.mjs');
  writeFileSync(block, "console.log('freeMB=1309 (min 3000)  commit=69% (max 70)'); console.log('BLOCK: free physical memory below floor'); process.exit(2);\n");
  writeFileSync(pass, "console.log('freeMB=4000 (min 3000)  commit=40% (max 70)'); console.log('OK'); process.exit(0);\n");
  const marker = join(dir, 'started.marker');
  const cmd = (code = 0) => [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started'); process.exit(${code})`];
  const run = (gate, command) => spawnSync(process.execPath, [wrapper, ...(gate ? [`--gate=${gate}`] : []), '--', ...command], { encoding: 'utf8' });

  console.log('-- BLOCK must stop the chain --');
  let r = run(block, cmd(0));
  ok(r.status === 2, `a gate that exits 2 makes the wrapper exit 2, not 0 (exit ${r.status})`);
  ok(!existsSync(marker), 'the command NEVER started: its marker file does not exist');
  ok(/BLOCK: free physical memory below floor/.test(r.stdout) && /GATED-RUN: BLOCKED \(gate exit 2\)/.test(r.stderr), 'the gate output is relayed and the wrapper states that the command was not started');

  r = run(join(dir, 'does-not-exist.mjs'), cmd(0));
  ok(r.status === 5 && !existsSync(marker), 'a missing gate script fails closed (exit 5) and the command does not start');

  const crash = join(dir, 'gate-crash.mjs');
  writeFileSync(crash, "process.kill(process.pid, 'SIGKILL');\n");
  r = run(crash, cmd(0));
  ok(r.status !== 0 && !existsSync(marker), `a gate that dies without an exit status fails closed (exit ${r.status}) and the command does not start`);

  r = spawnSync(process.execPath, [wrapper, `--gate=${pass}`], { encoding: 'utf8' });
  ok(r.status === 64 && !existsSync(marker), 'no command after -- is a usage error (exit 64), nothing runs');

  console.log('-- PASS must run the command and keep its status --');
  r = run(pass, cmd(7));
  ok(existsSync(marker) && readFileSync(marker, 'utf8') === 'started', 'with a passing gate the command starts');
  ok(r.status === 7, `the command's own exit status is returned (exit ${r.status})`);
  rmSync(marker);
  r = run(pass, cmd(0));
  ok(r.status === 0 && existsSync(marker), 'a passing gate and a passing command exit 0');

  console.log('-- heap setting travels in the environment, never in argv --');
  const envMarker = join(dir, 'env.marker');
  r = spawnSync(process.execPath, [wrapper, `--gate=${pass}`, '--heap-mb=512', '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(envMarker)}, String(process.env.NODE_OPTIONS))`], { encoding: 'utf8' });
  ok(r.status === 0 && /--max-old-space-size=512/.test(readFileSync(envMarker, 'utf8')), 'the payload sees --max-old-space-size=512 in NODE_OPTIONS');
  ok(!process.argv.join(' ').includes('max-old-space-size'), 'this test process carries no heap flag in its own argv (the gate pattern cannot match it)');

  console.log('-- the real gate is untouched --');
  const gateSrc = readFileSync(join(root, 'scripts', 'sweep-gate.ps1'), 'utf8');
  ok(/\$MinFreeMB\s*=\s*3000/.test(gateSrc) && /\$MaxCommitPct\s*=\s*70/.test(gateSrc), 'sweep-gate.ps1 keeps its 3000 MB / 70% thresholds');
  ok(/if \(\$freeMB -lt \$MinFreeMB\) \{[^}]*exit 2/.test(gateSrc), 'sweep-gate.ps1 still exits non-zero (2) when free memory is below the floor');
  const wrapperSrc = readFileSync(wrapper, 'utf8');
  ok(!/MinFreeMB|MaxCommitPct|--min|--threshold/.test(wrapperSrc.replace(/^\/\/.*$/gm, '')), 'the wrapper has no threshold flag or override of its own');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
