// Ship T — Batch scan test for accuracy + speed metrics.
// Reads every image from ./comics/, calls production grade + enrich
// endpoints sequentially, writes CSV + summary.
// Ship T does NOT modify production code. Read-only test harness.

import fs from 'fs/promises';
import path from 'path';

const COMICS_DIR = 'C:/Users/matam/OneDrive/Desktop/comic-vault/comics';
const API_BASE = 'https://comic-vault-rouge.vercel.app';
const GRADE_URL = `${API_BASE}/api/grade`;
const ENRICH_URL = `${API_BASE}/api/enrich`;
const CSV_PATH = 'scripts/batch-results.csv';
const SUMMARY_PATH = 'scripts/batch-summary.txt';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fileToBase64(filePath) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mediaType = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mediaType};base64,${buf.toString('base64')}`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: null, raw: text };
  }
}

async function scanOne(filename) {
  const filePath = path.join(COMICS_DIR, filename);
  const start = Date.now();

  try {
    const imageBase64 = await fileToBase64(filePath);

    // Step 1: grade (Vision identification)
    const gradeStart = Date.now();
    const gradeRes = await postJson(GRADE_URL, {
      images: [imageBase64],  // API expects array of images
    });
    const gradeTime = Date.now() - gradeStart;

    if (!gradeRes.ok || !gradeRes.data) {
      return {
        filename,
        total_ms: Date.now() - start,
        grade_ms: gradeTime,
        enrich_ms: 0,
        status: 'grade_failed',
        http: gradeRes.status,
        title: '',
        issue: '',
        year: '',
        grade: '',
        keyIssue: '',
        confidence: '',
        price: '',
        pricingSource: '',
        polybagDetected: '',
        newsstandEra: '',
        issueSource: '',
        refusedToPrice: '',
        identityConfident: '',
      };
    }

    const g = gradeRes.data;

    // Step 2: enrich (full pricing pipeline)
    const enrichStart = Date.now();
    const enrichRes = await postJson(ENRICH_URL, {
      title: g.title,
      issue: g.issue,
      year: g.year,
      publisher: g.publisher,
      grade: g.grade,
      isGraded: g.isGraded,
      numericGrade: g.numericGrade,
      variant: g.variant,
      keyIssue: g.keyIssue,
      reason: g.reason,
      confidence: g.confidence,
      imageBase64,
    });
    const enrichTime = Date.now() - enrichStart;

    const e = enrichRes.data || {};
    const total = Date.now() - start;

    return {
      filename,
      total_ms: total,
      grade_ms: gradeTime,
      enrich_ms: enrichTime,
      status: enrichRes.ok ? 'ok' : 'enrich_failed',
      http: enrichRes.status,
      title: e.title || g.title || '',
      issue: e.issue || g.issue || '',
      year: e.year || g.year || '',
      grade: e.grade || g.grade || '',
      keyIssue: e.keyIssue || '',
      confidence: e.confidenceLevel || g.confidence || '',
      price: e.price || '',
      pricingSource: e.pricingSource || '',
      polybagDetected: e.polybagDetected ? 'YES' : 'NO',
      newsstandEra: e.newsstandEra || '',
      issueSource: e.issueSource || '',
      refusedToPrice: e.refusedToPrice ? 'YES' : 'NO',
      identityConfident: e.identityConfident === false ? 'NO' : 'YES',
    };
  } catch (err) {
    return {
      filename,
      total_ms: Date.now() - start,
      grade_ms: 0,
      enrich_ms: 0,
      status: 'error',
      http: '',
      title: '',
      issue: '',
      year: '',
      grade: '',
      keyIssue: '',
      confidence: '',
      price: '',
      pricingSource: '',
      polybagDetected: '',
      newsstandEra: '',
      issueSource: '',
      refusedToPrice: '',
      identityConfident: '',
      error: err.message,
    };
  }
}

function toCsv(rows) {
  const headers = [
    'filename', 'status', 'http',
    'total_ms', 'grade_ms', 'enrich_ms',
    'title', 'issue', 'year', 'grade',
    'confidence', 'price', 'pricingSource',
    'identityConfident', 'refusedToPrice',
    'keyIssue', 'polybagDetected', 'newsstandEra', 'issueSource',
  ];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

function summary(rows) {
  const ok = rows.filter((r) => r.status === 'ok');
  const failed = rows.filter((r) => r.status !== 'ok');
  const totals = rows.map((r) => r.total_ms).sort((a, b) => a - b);
  const mean = totals.length ? Math.round(totals.reduce((s, v) => s + v, 0) / totals.length) : 0;
  const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0;
  const p95 = totals.length ? totals[Math.floor(totals.length * 0.95)] : 0;
  const min = totals[0] || 0;
  const max = totals[totals.length - 1] || 0;

  const confDist = {};
  for (const r of rows) {
    const c = r.confidence || 'UNKNOWN';
    confDist[c] = (confDist[c] || 0) + 1;
  }

  const sourceDist = {};
  for (const r of rows) {
    const s = r.pricingSource || 'NONE';
    sourceDist[s] = (sourceDist[s] || 0) + 1;
  }

  const polybagCount = rows.filter((r) => r.polybagDetected === 'YES').length;
  const refusedCount = rows.filter((r) => r.refusedToPrice === 'YES').length;
  const identityFailedCount = rows.filter((r) => r.identityConfident === 'NO').length;

  const totalWallTime = rows.reduce((s, r) => s + r.total_ms, 0);
  const throughput = totalWallTime > 0 ? (rows.length / (totalWallTime / 60000)).toFixed(2) : '0';

  return [
    '═══════════════════════════════════════════════════════════',
    '  COMIC VAULT — BATCH SCAN TEST RESULTS',
    '═══════════════════════════════════════════════════════════',
    '',
    `Total comics scanned:    ${rows.length}`,
    `Successful:              ${ok.length}`,
    `Failed:                  ${failed.length}`,
    `Refused to price:        ${refusedCount}`,
    `Identity not confident:  ${identityFailedCount}`,
    `Polybag detected:        ${polybagCount}`,
    '',
    '─── TIMING ──────────────────────────────────────────────',
    `Total wall time:         ${(totalWallTime / 1000).toFixed(1)}s`,
    `Mean per scan:           ${mean}ms`,
    `Median per scan:         ${median}ms`,
    `Min / Max:               ${min}ms / ${max}ms`,
    `P95:                     ${p95}ms`,
    `Throughput:              ${throughput} comics/min`,
    '',
    '─── CONFIDENCE DISTRIBUTION ─────────────────────────────',
    ...Object.entries(confDist).map(([k, v]) => `  ${k.padEnd(20)} ${v} (${(100 * v / rows.length).toFixed(0)}%)`),
    '',
    '─── PRICING SOURCE DISTRIBUTION ─────────────────────────',
    ...Object.entries(sourceDist).map(([k, v]) => `  ${k.padEnd(28)} ${v} (${(100 * v / rows.length).toFixed(0)}%)`),
    '',
    '─── PER-COMIC RESULTS ───────────────────────────────────',
    ...rows.map((r) =>
      `${r.filename.padEnd(30)} ${(r.total_ms + 'ms').padEnd(8)} ${r.title.slice(0, 30).padEnd(30)} #${r.issue} (${r.year}) ${r.confidence}`
    ),
    '',
    '═══════════════════════════════════════════════════════════',
  ].join('\n');
}

async function main() {
  const files = (await fs.readdir(COMICS_DIR))
    .filter((f) => /\.(jpg|jpeg|png|heic|webp)$/i.test(f));

  console.log(`Found ${files.length} comics in ${COMICS_DIR}`);
  console.log(`Hitting ${API_BASE}`);
  console.log('Starting sequential scan...\n');

  const rows = [];
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    console.log(`[${i + 1}/${files.length}] ${filename}...`);
    const result = await scanOne(filename);
    rows.push(result);
    console.log(`  → ${result.total_ms}ms · ${result.title || '(no title)'} #${result.issue || '?'} · ${result.confidence} · ${result.pricingSource || 'none'}`);
    // Small delay to avoid rate limits
    await sleep(500);
  }

  const csv = toCsv(rows);
  const sum = summary(rows);

  await fs.writeFile(CSV_PATH, csv);
  await fs.writeFile(SUMMARY_PATH, sum);

  console.log('\n');
  console.log(sum);
  console.log(`\nResults written to:`);
  console.log(`  ${CSV_PATH}`);
  console.log(`  ${SUMMARY_PATH}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
