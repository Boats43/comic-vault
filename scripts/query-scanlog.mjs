#!/usr/bin/env node
/**
 * scanlog: query tool — GrailKey Dispatch 22 (2026-08-07).
 *
 * Reads structured per-scan records (src/lib/scanLog.js) directly from
 * the Upstash Redis instance api/kv-cache.js already writes to, via the
 * scanlog:index:v1 sorted-set time index. This is the reason the
 * scanlog feature exists: the Vercel runtime-log tool reliably answers
 * COUNT queries over wide time ranges but times out on full-content
 * pulls past roughly a 12-hour window (confirmed via repeated direct
 * attempts across two separate investigations, GrailKey Dispatch 20/21
 * — see the Pattern Library). A direct Redis range read against
 * pre-structured records has no such limit.
 *
 * Usage:
 *   node scripts/query-scanlog.mjs [--since=<ISO|relative>] [--until=<ISO|relative>] [--json] [--limit=N]
 *
 * --since / --until accept an ISO timestamp ("2026-08-01T00:00:00Z") or
 * a relative duration back from now ("7d", "24h", "30m"). Defaults:
 * since=7d, until=now.
 * --json prints the raw record array instead of the summary breakdown.
 * --limit caps how many records are fetched from the index (default
 * 1000 — this is a read cap on the query, not a write cap on scanlog
 * itself; every scan still gets logged regardless of this flag).
 *
 * No dotenv dependency (this repo has none) — loads
 * KV_REST_API_URL/KV_REST_API_TOKEN from whichever pulled env file has
 * them, same preference-order pattern as scripts/pc-token-health.mjs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

for (const envVar of ["KV_REST_API_URL", "KV_REST_API_TOKEN"]) {
  if (process.env[envVar]) continue;
  for (const file of [".env.production", ".env.vercel", ".env.local", ".env"]) {
    try {
      const text = readFileSync(join(repoRoot, file), "utf8");
      const match = text.match(new RegExp(`^${envVar}=(.+)$`, "m"));
      if (match) {
        process.env[envVar] = match[1].trim().replace(/^["']|["']$/g, "");
        console.log(`[query-scanlog] loaded ${envVar} from ${file}`);
        break;
      }
    } catch {
      // file doesn't exist — try the next one
    }
  }
}

if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
  console.error(
    "[query-scanlog] KV_REST_API_URL/KV_REST_API_TOKEN not found in process.env or any .env file.\n" +
    "Run `vercel env pull` first, or export them manually."
  );
  process.exit(1);
}

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();

const SCAN_LOG_INDEX_KEY = "scanlog:index:v1";

const parseArgs = (argv) => {
  const args = { since: "7d", until: null, json: false, limit: 1000 };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg.startsWith("--since=")) args.since = arg.slice("--since=".length);
    else if (arg.startsWith("--until=")) args.until = arg.slice("--until=".length);
    else if (arg.startsWith("--limit=")) args.limit = parseInt(arg.slice("--limit=".length), 10);
  }
  return args;
};

const resolveTimestamp = (value, fallback) => {
  if (!value) return fallback;
  const relativeMatch = value.match(/^(\d+)(m|h|d)$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relativeMatch[2]];
    return Date.now() - amount * unitMs;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    console.error(`[query-scanlog] could not parse timestamp: "${value}" (expected ISO or "<N>m"/"<N>h"/"<N>d")`);
    process.exit(1);
  }
  return parsed;
};

const args = parseArgs(process.argv.slice(2));
const sinceTs = resolveTimestamp(args.since, Date.now() - 7 * 86_400_000);
const untilTs = resolveTimestamp(args.until, Date.now());

console.log(`[query-scanlog] range: ${new Date(sinceTs).toISOString()} → ${new Date(untilTs).toISOString()}`);

const keys = await redis.zrange(SCAN_LOG_INDEX_KEY, sinceTs, untilTs, { byScore: true, offset: 0, count: args.limit });

if (!keys.length) {
  console.log("[query-scanlog] 0 records in range.");
  process.exit(0);
}

console.log(`[query-scanlog] ${keys.length} keys in range, fetching records...`);

const records = [];
for (const key of keys) {
  const record = await redis.get(key);
  if (record) records.push(record);
}

if (args.json) {
  console.log(JSON.stringify(records, null, 2));
  process.exit(0);
}

// Summary breakdown — the shape both dead-end investigations this
// session actually needed (GK-34 stale-threshold, commit-p rank-slot).
const byTerminalReason = {};
const byIssueAuthorityStatus = {};
let assetTypeOverrideEvaluated = 0;
let assetTypeOverrideFired = 0;

for (const r of records) {
  const terminal = r.terminalReason ?? "clean";
  byTerminalReason[terminal] = (byTerminalReason[terminal] || 0) + 1;

  const status = r.issueAuthority?.status ?? "none";
  byIssueAuthorityStatus[status] = (byIssueAuthorityStatus[status] || 0) + 1;

  if (r.assetTypeOverride?.evaluated) {
    assetTypeOverrideEvaluated++;
    if (r.assetTypeOverride.fired) assetTypeOverrideFired++;
  }
}

console.log(`\n=== scanlog summary (${records.length} records) ===\n`);
console.log("terminalReason breakdown:");
for (const [reason, count] of Object.entries(byTerminalReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason}: ${count}`);
}
console.log("\nissueAuthority.status breakdown:");
for (const [status, count] of Object.entries(byIssueAuthorityStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${count}`);
}
console.log(`\nFix 5 (assetTypeOverride): evaluated ${assetTypeOverrideEvaluated} times, fired ${assetTypeOverrideFired} times`);
console.log("\nPass --json to print full records instead of this summary.");
