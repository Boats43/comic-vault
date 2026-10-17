// SCAN-LATENCY INSTRUMENTATION — (1) cross-principal isolation, (2) instrumentation faults cannot interrupt a scan.
// Uses the REAL principal-scoped storage (src/lib/principalStorage.js) and the REAL session reader
// (src/lib/grailkeySession.js) over an in-memory localStorage shim. No network, no database, no provider.
//   node tests/scan-latency-isolation-and-faults.test.js

import { signInTestPrincipal } from './helpers/installBrowserSession.js'; // installs localStorage/window shim + signs in a fixed principal
import { clearSession } from '../src/lib/grailkeySession.js';
import { scopedGet, scopedSet, scopedKey } from '../src/lib/principalStorage.js';
import * as L from '../src/lib/scanLatency.js';
import fs from 'node:fs';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const storage = { get: scopedGet, set: scopedSet };
const rec = (scanId, extra = {}) => ({ scanId, at: Date.now(), outcome: 'complete', category: 'comic', marks: { scan_start: 0, encoded: 30 }, durations: { shutterToFinalMs: 9000 }, ...extra });

console.log('\n=== scan-latency: isolation + fault immunity ===\n\n— cross-principal isolation');
const A = 'principal-A-00000000-0000-4000-8000-00000000000a';
const B = 'principal-B-00000000-0000-4000-8000-00000000000b';
signInTestPrincipal(A);
ok(L.recordScanTiming(storage, rec('A-scan-1', { buyerMode: false })) === true, 'I1 principal A records a scan timing');
L.recordScanTiming(storage, rec('A-scan-2'));
ok(L.loadScanTimings(storage).map((r) => r.scanId).join() === 'A-scan-1,A-scan-2', 'I2 A reads back exactly its own records');
const keyA = scopedKey(L.SCAN_LATENCY_STORAGE_KEY, A);

signInTestPrincipal(B); // account switch on the same device/browser
ok(L.loadScanTimings(storage).length === 0, 'I3 principal B reads NONE of A\'s records');
ok(scopedGet(L.SCAN_LATENCY_STORAGE_KEY) === null, 'I4 B\'s scoped read of the same logical key is empty (raw)');
ok(L.lastScanAt(storage) === null, 'I5 B\'s idle-time proxy is not derived from A\'s scans');
const expB = JSON.parse(L.exportScanTimingsText(storage, { build: 'x' }));
ok(expB.count === 0 && !JSON.stringify(expB).includes('A-scan'), 'I6 B\'s export contains none of A\'s data');
ok(globalThis.localStorage.getItem(keyA) !== null, 'I7 A\'s data still physically exists under A\'s scoped key (not deleted, not readable by B)');
ok(globalThis.localStorage.getItem(L.SCAN_LATENCY_STORAGE_KEY) === null, 'I8 no UNSCOPED copy of the key exists');
L.recordScanTiming(storage, rec('B-scan-1'));
ok(L.loadScanTimings(storage).map((r) => r.scanId).join() === 'B-scan-1', 'I9 B writes only to B\'s own scope');

signInTestPrincipal(A);
ok(L.loadScanTimings(storage).map((r) => r.scanId).join() === 'A-scan-1,A-scan-2', 'I10 switching back, A sees only A\'s records, untouched by B\'s write');
ok(!JSON.stringify(L.loadScanTimings(storage)).includes('B-scan'), 'I11 A never sees B\'s records');

clearSession(); // logged out
ok(L.recordScanTiming(storage, rec('anon-1')) === false, 'I12 with no session nothing is recorded');
ok(L.loadScanTimings(storage).length === 0 && L.lastScanAt(storage) === null, 'I13 with no session nothing is readable');
const allKeys = [];
{ // enumerate the shim's keys through the only API it has: probe the two known scoped keys + the raw key
  for (const p of [A, B]) { const k = scopedKey(L.SCAN_LATENCY_STORAGE_KEY, p); if (globalThis.localStorage.getItem(k) !== null) allKeys.push(k); }
}
ok(allKeys.length === 2 && allKeys[0] !== allKeys[1], 'I15 A and B hold two distinct scoped keys');
ok(!/::p::/.test(L.SCAN_LATENCY_STORAGE_KEY), 'I16 the base key itself carries no principal (scoping is applied only by principalStorage)');

console.log('\n— storage faults cannot interrupt a scan');
signInTestPrincipal(A);
const realSet = globalThis.localStorage.setItem, realGet = globalThis.localStorage.getItem;
{
  globalThis.localStorage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  let threw = false, r;
  try { r = L.recordScanTiming(storage, rec('quota')); } catch { threw = true; }
  ok(!threw && r === false, 'F1 localStorage.setItem throwing (quota / private mode) -> recordScanTiming returns false, never throws');
  globalThis.localStorage.setItem = realSet;

  globalThis.localStorage.getItem = () => { throw new Error('SecurityError'); };
  threw = false;
  try { L.loadScanTimings(storage); L.lastScanAt(storage); L.exportScanTimingsText(storage); L.recordScanTiming(storage, rec('x')); } catch { threw = true; }
  ok(!threw, 'F2 localStorage.getItem throwing -> load/last/export/record all swallow');
  globalThis.localStorage.getItem = realGet;
}
{
  // full finish pipeline: timer -> sink -> (throwing storage) + (throwing log)
  const logCalls = [];
  const sink = L.createScanFinishSink({ storage: { get: () => { throw new Error('s'); }, set: () => { throw new Error('s'); } }, log: (...a) => { logCalls.push(a); } });
  let clock = 0;
  const t = L.createScanTimer({ now: () => (clock += 10), paint: (f) => f(), onFinish: sink, incompleteAfterMs: 0 });
  let threw = false;
  try { t.mark('encoded'); t.markPainted('identity'); t.markPainted('final', 'complete'); } catch { threw = true; }
  ok(!threw && t.isFinished(), 'F3 storage throwing inside the finish sink: scan path unaffected, record still finishes');
  ok(logCalls.length === 1 && String(logCalls[0][0]) === '[scan-latency]', 'F4 …and the log line is STILL emitted (storage fault does not suppress logging)');

  const stored = [];
  const sink2 = L.createScanFinishSink({ storage: { get: () => null, set: (k, v) => { stored.push(v); return true; } }, log: () => { throw new Error('console closed'); } });
  t2(sink2);
  function t2(s) {
    const tm = L.createScanTimer({ now: () => 1, paint: (f) => f(), onFinish: s, incompleteAfterMs: 0 });
    let th = false;
    try { tm.markPainted('final', 'complete'); } catch { th = true; }
    ok(!th, 'F5 logging throwing: scan path unaffected');
  }
  ok(stored.length === 1, 'F6 …and the record is STILL stored (log fault does not suppress storage)');

  const sink3 = L.createScanFinishSink({ storage: { get: () => null, set: () => true }, log: () => { throw new Error('x'); } });
  let th3 = false; try { sink3(null); sink3(undefined); sink3({ circular: (() => { const o = {}; o.o = o; return o; })() }); } catch { th3 = true; }
  ok(!th3, 'F7 sink given null / undefined / circular input never throws');
}

console.log('\n— clipboard faults');
{
  const stored = new Map();
  const st = { get: (k) => stored.get(k) ?? null, set: (k, v) => { stored.set(k, v); return true; } };
  L.recordScanTiming(st, rec('c1'));
  const prompts = [];
  let r;
  r = await L.copyScanTimings({ storage: st, build: 'b', clipboard: { writeText: async () => {} }, prompt: (...a) => prompts.push(a) });
  ok(r === 'copied:1' && prompts.length === 0, 'C1 clipboard works -> copied:1, no prompt');
  r = await L.copyScanTimings({ storage: st, build: 'b', clipboard: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } }, prompt: (...a) => prompts.push(a) });
  ok(r === 'prompt' && prompts.length === 1 && /grailkey-scan-latency/.test(prompts[0][1]), 'C2 clipboard permission denied -> falls back to the prompt, which contains the export');
  r = await L.copyScanTimings({ storage: st, clipboard: null, prompt: (...a) => prompts.push(a) });
  ok(r === 'prompt', 'C3 no clipboard API (insecure context) -> prompt');
  r = await L.copyScanTimings({ storage: st, clipboard: { writeText: async () => { throw new Error('x'); } }, prompt: () => { throw new Error('prompt blocked'); } });
  ok(r === 'failed', 'C4 clipboard AND prompt both fail -> "failed", never throws');
  r = await L.copyScanTimings({ storage: st, clipboard: undefined, prompt: null });
  ok(r === 'failed', 'C5 nothing available -> "failed", never throws');
  r = await L.copyScanTimings({ storage: { get: () => { throw new Error('s'); }, set: () => false }, clipboard: { writeText: async () => {} } });
  ok(typeof r === 'string', 'C6 storage throwing during export -> still returns a status string');
  let rejected = false;
  try { await L.copyScanTimings(undefined); await L.copyScanTimings({}); } catch { rejected = true; }
  ok(!rejected, 'C7 called with no arguments -> does not reject');
}

console.log('\n— a scan stand-in with EVERY instrumentation dependency failing returns the same result');
{
  const failing = L.createScanFinishSink({ storage: { get: () => { throw new Error('a'); }, set: () => { throw new Error('b'); } }, log: () => { throw new Error('c'); } });
  const scan = async (timerOpts) => {
    // mirrors gradeBlob's use: timer calls interleaved with the real work whose return value must be unaffected
    const timer = L.createScanTimer({ buildSha: 'x', scanId: 's', onFinish: failing, incompleteAfterMs: 0, ...timerOpts });
    timer.set({ network: { get type() { throw new Error('getter'); } }, rawBytes: 1 });
    timer.mark('encoded'); timer.mark('grade_sent');
    const work = await Promise.resolve({ title: 'Creepy', price: '$20' });
    timer.mark('grade_received'); timer.set({ serverGrade: L.parseServerTiming(undefined), category: 'book' });
    timer.markPainted('identity'); timer.mark('saved'); timer.mark('enrich_sent'); timer.mark('enrich_received');
    timer.set({ serverEnrich: null, enrichStatus: 200 });
    timer.markPainted('final', 'complete');
    timer.finish('error');
    return work;
  };
  const clean = await scan({ now: () => 1, paint: (f) => f() });
  const faulty = await scan({ now: () => { throw new Error('clock'); }, paint: () => { throw new Error('paint'); } });
  ok(JSON.stringify(clean) === JSON.stringify(faulty) && faulty.title === 'Creepy', 'X1 the scan result is byte-identical whether instrumentation works or fails everywhere');
}

console.log('\n— static: instrumentation can never gate, await or feed the scan (src/App.jsx)');
{
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const lines = app.split('\n').filter((l) => /scanTimer/.test(l) && !/^\s*\/\//.test(l));
  ok(lines.length >= 14, `S1 found ${lines.length} scanTimer statements`);
  ok(!lines.some((l) => /await\s+scanTimer/.test(l)), 'S2 no instrumentation call is awaited');
  ok(!lines.some((l) => /(if|while)\s*\([^)]*scanTimer/.test(l) || /scanTimer\.[a-zA-Z]+\([^)]*\)\s*(\?|&&|\|\|)/.test(l)), 'S3 no instrumentation call appears in a condition');
  ok(!lines.some((l) => /(=|return|\()\s*scanTimer\.(mark|set|markPainted|finish|snapshot|isFinished)/.test(l) && !/^\s*scanTimer\./.test(l.trim()) && !/const scanTimer = createScanTimer/.test(l)), 'S4 no instrumentation return value is used by the scan');
  ok(!/scanTimer/.test(app.slice(app.indexOf('const enrichBody = {'), app.indexOf('if (!buyerMode) enrichBody.images'))), 'S5 enrich request body untouched');
  const lat = fs.readFileSync(new URL('../src/lib/scanLatency.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(lat), 'S6 the module makes no network call');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
