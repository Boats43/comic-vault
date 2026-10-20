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
function state(roster = allFiles) {
  const ends = new Map(), starts = new Set();
  for (const e of readEvents()) { if (e.rerun) continue; if (e.t === 'start') starts.add(e.file); if (e.t === 'end') ends.set(e.file, isEnvError(e) ? { ...e, status: 'ENV_ERROR' } : e); }
  const rows = roster.map((f) => ends.get(f) || { file: f, status: starts.has(f) ? 'INTERRUPTED' : 'NOT_RUN' });
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

if (mode === 'finalize') {
  // DURABLE CERTIFICATION EVIDENCE (added 2026-10-20). Writes a self-contained, never-overwritten evidence directory:
  //   node scripts/sweep-runner.mjs finalize <tree> <ledger.jsonl> <evidenceRoot> --tested-sha=<full sha> [--prediction=<file>] [--label=<name>]
  // <evidenceRoot>/<sha12>-<UTC date>[-label]/ is created NON-recursively: if it already exists the command refuses (exit 3) and touches nothing; every file is written with flag 'wx'.
  // Artifacts: source-sha.txt, manifest.json (frozen test list + git blob ids AT the tested sha), prediction.txt + prediction.sha256 (full SHA-256), results.raw.jsonl (byte copy of the ledger),
  // results.json (per-file rows), resources.json, reconciliation.json (prediction vs actual), SUMMARY.md (unresolved failures; blockers are classified by a human, never by this tool).
  // The runner does NOT capture per-assertion counts or skipped-assertion coverage; the per-file output tail is kept and the gap is stated in SUMMARY.md. Nothing here runs a test.
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const flag = (n) => (process.argv.find((f) => f.startsWith(`--${n}=`)) || '').slice(n.length + 3);
  const evidenceRoot = timeoutMsArgGuard(tmoArg), testedSha = flag('tested-sha'), predFile = flag('prediction'), label = flag('label');
  function timeoutMsArgGuard(v) { if (!v) { console.error('finalize: <evidenceRoot> required'); process.exit(2); } return v; }
  if (!/^[0-9a-f]{40}$/.test(testedSha)) { console.error('finalize: --tested-sha=<full 40-hex sha> required'); process.exit(2); }
  const git = (...a) => execFileSync('git', ['-C', tree, ...a], { encoding: 'utf8' }).trim();
  const headSha = git('rev-parse', 'HEAD');
  let testedIsAncestor = false;
  try { execFileSync('git', ['-C', tree, 'merge-base', '--is-ancestor', testedSha, 'HEAD']); testedIsAncestor = true; } catch { /* not an ancestor */ }
  if (!testedIsAncestor) { console.error(`finalize: tested sha ${testedSha} is not an ancestor of HEAD ${headSha}`); process.exit(2); }
  const dir = path.join(evidenceRoot, `${testedSha.slice(0, 12)}-${new Date().toISOString().slice(0, 10)}${label ? `-${label}` : ''}`);
  fs0.mkdirSync(evidenceRoot, { recursive: true });
  try { fs0.mkdirSync(dir); } catch (e) { if (e.code === 'EEXIST') { console.error(`finalize: REFUSED, evidence directory already exists: ${dir}`); process.exit(3); } throw e; }
  const wx = (name, data) => fs0.writeFileSync(path.join(dir, name), data, { flag: 'wx' });
  const sha256 = (b) => createHash('sha256').update(b).digest('hex');
  const treeLines = git('ls-tree', '-r', testedSha, 'tests').split('\n').filter((l) => /\.test\.js$/.test(l)).map((l) => { const [meta, file] = l.split('\t'); return { file: path.basename(file), gitBlob: meta.split(' ')[2] }; }).sort((a, b) => a.file.localeCompare(b.file));
  const st = state(treeLines.map((m) => m.file)), events = readEvents();   // roster = the TESTED SHA's test files, never the live directory (which may hold later, untested files)
  const ledgerFiles = [...new Set(events.filter((e) => e.t === 'end' && !e.rerun).map((e) => e.file))].sort();
  const manifestMatchesLedgerRoster = treeLines.length === ledgerFiles.length && treeLines.every((m, i) => m.file === ledgerFiles[i]);
  const firstRunAt = (events.find((e) => e.t === 'run') || {}).at || null;
  let prediction = null;
  if (predFile) {
    const buf = readFileSync(predFile);
    const m = buf.toString('utf8').match(/EXPECTED TOTALS:\s*(\d+) PASS \/ (\d+) FAIL \/ (\d+) TIMEOUT \/ (\d+) ENV_ERROR \/ (\d+) INTERRUPTED \/ (\d+) NOT_RUN = (\d+)/);
    const mtime = fs0.statSync(predFile).mtime.toISOString();
    prediction = { file: path.basename(predFile), sha256: sha256(buf), mtimeUtc: mtime, mtimePrecedesFirstRun: firstRunAt ? mtime < firstRunAt : null, expected: m ? { PASS: +m[1], FAIL: +m[2], TIMEOUT: +m[3], ENV_ERROR: +m[4], INTERRUPTED: +m[5], NOT_RUN: +m[6], total: +m[7] } : null, buf };
  }
  const actual = { total: st.total, PASS: st.PASS, FAIL: st.FAIL, TIMEOUT: st.TIMEOUT, SKIP: st.SKIP, ENV_ERROR: st.ENV_ERROR, INTERRUPTED: st.INTERRUPTED, NOT_RUN: st.NOT_RUN };
  const complete = st.INTERRUPTED === 0 && st.NOT_RUN === 0 && st.ENV_ERROR === 0;
  const ends = st.rows.filter((r) => r.t === 'end');
  const num = (k) => ends.map((r) => r[k]).filter((v) => Number.isFinite(v));
  wx('source-sha.txt', `tested_source_sha=${testedSha}\nhead_at_finalize=${headSha}\nevidence_commit_is_independently_tested=${headSha === testedSha ? 'n/a (same commit)' : 'NO: HEAD differs from the tested sha; only the tested sha was executed'}\n`);
  wx('manifest.json', JSON.stringify({ testedSha, fileCount: treeLines.length, matchesLedgerRoster: manifestMatchesLedgerRoster, files: treeLines }, null, 1));
  if (prediction) { wx('prediction.txt', prediction.buf); wx('prediction.sha256', `${prediction.sha256}  prediction.txt\nalgorithm=SHA-256 full 64-hex digest\n`); }
  fs0.copyFileSync(out, path.join(dir, 'results.raw.jsonl'), fs0.constants.COPYFILE_EXCL);
  wx('results.json', JSON.stringify(st.rows.map((r) => ({ file: r.file, status: r.status, code: r.code ?? null, exitClass: r.exitClass ?? null, signal: r.signal ?? null, wallMs: r.wallMs ?? r.ms ?? null, memFreeBeforeMB: r.memFreeBeforeMB ?? null, memFreeAfterMB: r.memFreeAfterMB ?? null, timeoutMs: r.timeoutMs ?? null, logfile: r.logfile ?? null, tail: r.tail ?? null })), null, 1));
  wx('resources.json', JSON.stringify({ minMemFreeBeforeMB: num('memFreeBeforeMB').length ? Math.min(...num('memFreeBeforeMB')) : null, minMemFreeAfterMB: num('memFreeAfterMB').length ? Math.min(...num('memFreeAfterMB')) : null, maxWallMs: num('wallMs').length ? Math.max(...num('wallMs')) : (num('ms').length ? Math.max(...num('ms')) : null), totalWallMs: ends.reduce((a, r) => a + (r.wallMs ?? r.ms ?? 0), 0), invocations: events.filter((e) => e.t === 'run').length, heapMB: (events.find((e) => e.t === 'run') || {}).heapMB ?? null, timeoutsMs: [...new Set(events.filter((e) => e.t === 'run').map((e) => e.timeoutMs))] }, null, 1));
  const recon = prediction && prediction.expected ? Object.fromEntries(['PASS', 'FAIL', 'TIMEOUT', 'ENV_ERROR', 'INTERRUPTED', 'NOT_RUN', 'total'].map((k) => [k, { predicted: prediction.expected[k], actual: actual[k], match: prediction.expected[k] === actual[k] }])) : null;
  wx('reconciliation.json', JSON.stringify({ complete, actual, prediction: prediction ? { file: prediction.file, sha256: prediction.sha256, mtimeUtc: prediction.mtimeUtc, mtimePrecedesFirstRun: prediction.mtimePrecedesFirstRun } : null, reconciliation: recon }, null, 1));
  const unresolved = st.rows.filter((r) => ['FAIL', 'TIMEOUT', 'ENV_ERROR', 'INTERRUPTED', 'NOT_RUN'].includes(r.status));
  wx('SUMMARY.md', [`# Certification evidence: tested ${testedSha}`, '', `- Tested source SHA: \`${testedSha}\``, `- HEAD when finalized: \`${headSha}\`${headSha === testedSha ? '' : ' (differs: later commits were NOT independently tested)'}`, `- Complete (no INTERRUPTED / NOT_RUN / ENV_ERROR): **${complete}**`, `- Totals: ${JSON.stringify(actual)}`, `- Manifest matches ledger roster: ${manifestMatchesLedgerRoster}`, prediction ? `- Prediction SHA-256: \`${prediction.sha256}\` (mtime precedes first run: ${prediction.mtimePrecedesFirstRun})` : '- Prediction: none supplied', recon ? `- Prediction vs actual: ${Object.entries(recon).map(([k, v]) => `${k} ${v.predicted}/${v.actual}${v.match ? '' : ' MISMATCH'}`).join(', ')}` : '', '', '## Unresolved results (classification and release-blocker status are assigned by a human, not by this tool)', ...unresolved.map((r) => `- ${r.status} ${r.file}${r.code != null ? ` (exit ${r.code})` : ''}`), '', '## Coverage not captured by the runner', '- Per-assertion counts and skipped-assertion coverage are not recorded in the ledger; the last output lines of each file are kept in results.json (`tail`) and full logs only when --logdir was used.', ''].join('\n'));
  console.log(JSON.stringify({ evidenceDir: dir, complete, actual }));
  process.exit(0);
}

// DURABLE LEDGER PATH GUARD (added 2026-10-20). A ledger that lives under the system temporary directory can be cleaned with its session (the 596f868 ledger had to be recovered from a
// scratchpad), so a run that WRITES a ledger refuses a temp location unless --allow-temp is passed explicitly. The caller's path is never rewritten or redirected: the run is refused
// (exit 4) before anything is created. Paths are resolved through the nearest existing ancestor's real path (symlinks, junctions, 8.3 short names, '..' segments) and compared
// case-insensitively on Windows. If the real path cannot be established the run is refused (fail closed). Read-only modes (plan, reruns, summary, finalize) are not guarded.
const realish = (p) => {
  let cur = path.resolve(p); const rest = [];
  while (!existsSync(cur)) { const parent = path.dirname(cur); if (parent === cur) break; rest.unshift(path.basename(cur)); cur = parent; }
  return path.join(fs0.realpathSync.native(cur), ...rest);
};
const insideDir = (root, p) => {
  const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const rel = path.relative(norm(root), norm(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const tempRoots = () => {
  const cands = [os.tmpdir(), process.env.TMPDIR, process.env.TEMP, process.env.TMP, ...(process.platform === 'win32' ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp')] : ['/tmp', '/var/tmp'])].filter(Boolean);
  const out = [];
  for (const c of cands) { try { out.push(realish(c)); } catch { /* a candidate that cannot be resolved cannot contain the ledger */ } }
  return out;
};
if (!process.argv.includes('--allow-temp')) {
  let verdict = null;
  try {
    const real = realish(out);
    const hit = tempRoots().find((r) => insideDir(r, real));
    if (hit) verdict = `ledger path resolves under the system temporary directory (${hit}): ${real}`;
  } catch (e) { verdict = `cannot establish the real path of the ledger (${e.code || e.message}); refusing (fail closed)`; }
  if (verdict) {
    console.error(`sweep-runner: REFUSED. ${verdict}\nA temporary ledger is not durable evidence. Choose a ledger path outside the temp directory, or pass --allow-temp to accept a throwaway ledger (instrumentation tests do). Nothing was created or run.`);
    process.exit(4);
  }
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
