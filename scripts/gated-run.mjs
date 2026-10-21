#!/usr/bin/env node
// scripts/gated-run.mjs -- run a command ONLY if the resource gate passes (2026-10-20).
//
//   node scripts/gated-run.mjs [--gate=<script>] [--heap-mb=<N>] -- <command> [args...]
//
// WHY: the memory gate (scripts/sweep-gate.ps1) printed BLOCK and an enclosing command chain kept going, because nothing converted that text into a failed step. A control that
// announces its own failure in text nothing reads is not a control. This wrapper makes the gate's exit status the only thing that decides whether the command starts:
//   gate exit 0            -> the command is spawned (stdio inherited) and its exit status is returned
//   gate exit non-zero     -> the command is NEVER spawned; the gate's output is relayed; this process exits with the gate's status (>= 1)
//   gate cannot be run     -> same: fail closed, exit 5, command never spawned
// The default gate is scripts/sweep-gate.ps1 (run through powershell). Its thresholds (3000 MB free, 70% commit) live in that file and are not touched or overridable here.
// `--heap-mb=N` gives the COMMAND a V8 heap limit through its NODE_OPTIONS environment (never through argv): the gate's process-name pattern (`*max-old-space-size=1024*`) matches any process whose
// command line carries that flag, so a wrapper or payload argv containing it blocks itself (exit 3). Do not put the flag in argv.
// `--gate=` exists so the wrapper itself can be tested with stub gates (a .ps1 runs under powershell, anything else under node); do not use it to bypass the real gate.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const head = dd === -1 ? argv : argv.slice(0, dd);
const command = dd === -1 ? [] : argv.slice(dd + 1);
const gateArg = (head.find((a) => a.startsWith('--gate=')) || '').slice(7);
const heapMb = Number((head.find((a) => a.startsWith('--heap-mb=')) || '').slice(10)) || 0;
const defaultGate = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sweep-gate.ps1');
const gate = gateArg || defaultGate;

if (command.length === 0) { console.error('usage: node scripts/gated-run.mjs [--gate=<script>] -- <command> [args...]'); process.exit(64); }
if (!existsSync(gate)) { console.error(`GATED-RUN: BLOCKED. Gate script not found (${gate}); failing closed. Command not started.`); process.exit(5); }

const isPs1 = /\.ps1$/i.test(gate);
const g = isPs1
  ? spawnSync('powershell', ['-NoProfile', '-File', gate], { encoding: 'utf8' })
  : spawnSync(process.execPath, [gate], { encoding: 'utf8' });

if (g.error || g.status === null) {
  console.error(`GATED-RUN: BLOCKED. The gate could not be run (${g.error ? g.error.message : `signal ${g.signal}`}); failing closed. Command not started.`);
  process.exit(5);
}
if (g.stdout) process.stdout.write(g.stdout);
if (g.stderr) process.stderr.write(g.stderr);
if (g.status !== 0) {
  console.error(`GATED-RUN: BLOCKED (gate exit ${g.status}). Command not started: ${command.join(' ')}`);
  process.exit(g.status);
}

const env = heapMb > 0 ? { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--max-old-space-size=${heapMb}` } : process.env;
const child = spawn(command[0], command.slice(1), { stdio: 'inherit', shell: false, env });
child.on('error', (e) => { console.error(`GATED-RUN: command failed to start: ${e.message}`); process.exit(127); });
child.on('close', (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
