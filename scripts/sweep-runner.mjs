// Interruption-safe sequential test sweep.
//   node scripts/sweep-runner.mjs run     <tree> <out.jsonl> [timeoutMs=150000] [heapMB=1024] [--only=substr] [--limit=N]
//   node scripts/sweep-runner.mjs summary <tree> <out.jsonl>
// One JSON line is APPENDED (and fsync'd) per event: {t:'start',file}, {t:'end',file,status,...}. A file with a start
// but no end is INTERRUPTED; a file with no record is NOT_RUN. Neither is ever counted as PASS. Re-running resumes:
// files that already have an 'end' record are skipped; INTERRUPTED files are re-run.
// Concurrency is always 1; each child gets --max-old-space-size=<heapMB>.
// RESOURCE INSTRUMENTATION (added 2026-10-20; purely additive fields on the same records, no behaviour change, the 3 GB gate lives in sweep-gate.ps1 and is untouched):
//   start: memFreeBeforeMB      end: memFreeBeforeMB, memFreeAfterMB, memDeltaMB, wallMs, cumulativeInvocation (files run by THIS invocation so far),
//   cumulativeLedger (non-rerun 'end' records in the ledger incl. this one), exitClass, signal.
//   exitClass: ok | nonzero-exit | killed-at-ceiling | process-start-failure | skip-reported.   memFree* = os.freemem() (available physical memory, MB).
import { spawn } from 'node:child_process';
import * as fs0 from 'node:fs';
import { readdirSync, readFileSync, openSync, writeSync, fsyncSync, closeSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [mode, tree, out, tmoArg, heapArg, ...flags] = process.argv.slice(2);
const timeoutMs = Number(tmoArg || 150000), heapMB = Number(heapArg || 1024);
const only = (flags.find((f) => f.startsWith('--only=')) || '').slice(7);
const filesArg = (flags.find((f) => f.startsWith('--files=')) || '').slice(8).split(',').filter(Boolean);   // exact file names
const logdir = (flags.find((f) => f.startsWith('--logdir=')) || '').slice(9);                              // full stdout+stderr per attempt, timestamped, never overwritten
const limit = Number((flags.find((f) => f.startsWith('--limit=')) || '').slice(8)) || Infinity;
const allFiles = readdirSync(path.join(tree, 'tests')).filter((f) => f.endsWith('.test.js')).sort();

const readEvents = () => (existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
// A process that never started (Windows STATUS_DLL_INIT_FAILED 0xC0000142 = 3221225794, or any non-zero exit in <200ms with no output)
// says nothing about the test: it is ENV_ERROR (re-queued on resume), never FAIL and never PASS.
const isEnvError = (e) => e && e.t === 'end' && e.status === 'FAIL' && (e.code === 3221225794 || e.code === 3221225786 || (e.code !== 0 && e.ms < 200 && !e.tail));
function state() {
  const ends = new Map(), starts = new Set();
  for (const e of readEvents()) { if (e.rerun) continue; if (e.t === 'start') starts.add(e.file); if (e.t === 'end') ends.set(e.file, isEnvError(e) ? { ...e, status: 'ENV_ERROR' } : e); }
  const rows = allFiles.map((f) => ends.get(f) || { file: f, status: starts.has(f) ? 'INTERRUPTED' : 'NOT_RUN' });
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { rows, total: rows.length, PASS: count('PASS'), FAIL: count('FAIL'), TIMEOUT: count('TIMEOUT'), SKIP: count('SKIP'), INTERRUPTED: count('INTERRUPTED'), ENV_ERROR: count('ENV_ERROR'), NOT_RUN: count('NOT_RUN') };
}
const append = (obj) => { const fd = openSync(out, 'a'); writeSync(fd, JSON.stringify(obj) + '\n'); fsyncSync(fd); closeSync(fd); };

const reruns = () => readEvents().filter((e) => e.rerun && e.t === 'end').map((e) => ({ file: e.file, original: (state().rows.find((r) => r.file === e.file) || {}).status, rerunStatus: e.status, rerunTimeoutMs: e.timeoutMs, ms: e.ms }));
if (mode === 'plan') {
  // dry run: exactly which files a resume WOULD execute. Completed results are never re-run or overwritten.
  const st = state();
  const wouldRun = st.rows.filter((r) => ['ENV_ERROR', 'INTERRUPTED', 'NOT_RUN'].includes(r.status));
  console.log(JSON.stringify({ tree, wouldRun: wouldRun.length, byStatus: wouldRun.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}), keptAsIs: { PASS: st.PASS, FAIL: st.FAIL, TIMEOUT: st.TIMEOUT, SKIP: st.SKIP } }));
  process.exit(0);
}
if (mode === 'reruns') { console.log(JSON.stringify(reruns(), null, 1)); process.exit(0); }
if (mode === 'summary') {
  const s = state();
  console.log(JSON.stringify({ tree, total: s.total, PASS: s.PASS, FAIL: s.FAIL, TIMEOUT: s.TIMEOUT, SKIP: s.SKIP, INTERRUPTED: s.INTERRUPTED, ENV_ERROR: s.ENV_ERROR, NOT_RUN: s.NOT_RUN }));
  process.exit(0);
}

const RERUN_TIMEOUTS = process.argv.includes('--rerun-timeouts');
const RERUN = RERUN_TIMEOUTS || process.argv.includes('--rerun');   // --rerun: explicit --files list, tagged rerun, original outcome kept
const done = new Set(state().rows.filter((r) => ['PASS', 'FAIL', 'TIMEOUT', 'SKIP'].includes(r.status)).map((r) => r.file));
const todo = (RERUN && !RERUN_TIMEOUTS && filesArg.length)
  ? filesArg.filter((f) => allFiles.includes(f))
  : (!RERUN && filesArg.length)
  ? filesArg.filter((f) => allFiles.includes(f) && !done.has(f))
  : RERUN_TIMEOUTS
  ? state().rows.filter((r) => r.status === 'TIMEOUT' && (!only || r.file.includes(only))).map((r) => r.file)   // each at the given (longer) timeout, tagged rerun; the original outcome is kept
  : allFiles.filter((f) => !done.has(f) && (!only || f.includes(only))).slice(0, limit);
const freeMB = () => Math.round(os.freemem() / 1048576);
let cumulativeInvocation = 0;
append({ t: 'run', tree, at: new Date().toISOString(), pid: process.pid, timeoutMs, heapMB, todo: todo.length, rerun: RERUN, memFreeMB: freeMB() });

function runOne(f) {
  return new Promise((resolve) => {
    const memFreeBeforeMB = freeMB();
    append({ t: 'start', file: f, at: new Date().toISOString(), rerun: RERUN, timeoutMs, memFreeBeforeMB });
    const t0 = Date.now();
    const p = spawn(process.execPath, [`--max-old-space-size=${heapMB}`, path.join('tests', f)], { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', timedOut = false;
    const full = [];   // complete output for the per-file log
    const keep = (d) => { full.push(d); buf += d; if (buf.length > 200000) buf = buf.slice(-100000); };
    p.stdout.on('data', keep); p.stderr.on('data', keep);
    const to = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs);
    p.on('close', (code, signal) => {
      clearTimeout(to);
      const tail = buf.split('\n').filter(Boolean).slice(-4).join(' | ').slice(-400);
      const skipped = /\bSKIP(PED)?\b/.test(buf) && code === 0 && /^\s*(SKIP|SKIPPED)\b/m.test(buf);
      const status0 = timedOut ? 'TIMEOUT' : code === 0 ? (skipped ? 'SKIP' : 'PASS') : 'FAIL';
      const status = (status0 === 'FAIL' && (code === 3221225794 || code === 3221225786 || (Date.now() - t0 < 200 && !tail))) ? 'ENV_ERROR' : status0;
      let logfile = null;
      if (logdir) {
        const { mkdirSync, writeFileSync: wf } = fs0;
        mkdirSync(logdir, { recursive: true });
        logfile = path.join(logdir, `${f}.${new Date().toISOString().replace(/[:.]/g, '-')}.${status}.log`);
        wf(logfile, `# tree=${tree}\n# file=${f}\n# status=${status} code=${code} ms=${Date.now() - t0} timeoutMs=${timeoutMs} rerun=${RERUN}\n# ---- complete stdout+stderr ----\n` + full.join(''), { flag: 'wx' });
      }
      cumulativeInvocation++;
      const memFreeAfterMB = freeMB();
      const exitClass = status === 'TIMEOUT' ? 'killed-at-ceiling' : status === 'ENV_ERROR' ? 'process-start-failure' : status === 'SKIP' ? 'skip-reported' : status === 'PASS' ? 'ok' : 'nonzero-exit';
      const cumulativeLedger = readEvents().filter((x) => x.t === 'end' && !x.rerun).length + (RERUN ? 0 : 1);
      const e = { t: 'end', file: f, status, code, ms: Date.now() - t0, tail, rerun: RERUN, timeoutMs, logfile,
        memFreeBeforeMB, memFreeAfterMB, memDeltaMB: memFreeAfterMB - memFreeBeforeMB, wallMs: Date.now() - t0, cumulativeInvocation, cumulativeLedger, exitClass, signal: signal || null };
      append(e); resolve(e);
    });
  });
}
for (const f of todo) await runOne(f);
const s = state();
console.log(JSON.stringify({ tree, total: s.total, PASS: s.PASS, FAIL: s.FAIL, TIMEOUT: s.TIMEOUT, SKIP: s.SKIP, INTERRUPTED: s.INTERRUPTED, ENV_ERROR: s.ENV_ERROR, NOT_RUN: s.NOT_RUN }));
