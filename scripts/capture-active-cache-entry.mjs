#!/usr/bin/env node
/**
 * GrailKey Dispatch 39/41 — Bone recollection: per-book fixture capture.
 *
 * Pulls the live `ac:v10:*` entry for a book (matched by title/issue
 * substring, case-insensitive) and writes a fixture stub to
 * dispatch39-fixtures/ (gitignored — see .gitignore). This captures ONLY
 * the cache-lineage half of the fixture contract: the full key, the
 * filterContextFingerprint segment, TTL remaining at capture, and the raw
 * cached active-comp pool object itself.
 *
 * IMPORTANT — this script does NOT and CANNOT capture the sold pool,
 * decision.action, price, tier/branch, or warnings/blockers. Those are
 * never persisted to KV under any key — verifySoldComps's output
 * (out.soldComps/soldCompsRaw/soldCompDiagnostics, api/enrich.js
 * ~9343-9351) and the decision engine's output exist ONLY in that one
 * request's JSON response, computed fresh every time and cached nowhere.
 * The "current output baseline" and "sold evidence" sections of the
 * fixture contract MUST come from the actual /api/enrich response body
 * for this exact scan — paste/merge it into the JSON file this script
 * writes, under the `manualCapture` key already stubbed in.
 *
 * Usage:
 *   node scripts/capture-active-cache-entry.mjs "<title>" "<issue>" [label]
 *
 * Example:
 *   node scripts/capture-active-cache-entry.mjs "bone" "1" bone-batch1
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const envFile = join(repoRoot, ".env.upstash.local");
const fixtureDir = join(repoRoot, "dispatch39-fixtures");

const [, , titleArg, issueArg, labelArg] = process.argv;
if (!titleArg || !issueArg) {
  console.error('Usage: node scripts/capture-active-cache-entry.mjs "<title>" "<issue>" [label]');
  process.exit(1);
}

const text = readFileSync(envFile, "utf8");
for (const line of text.split(/\r?\n/)) {
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  const key = line.slice(0, eq);
  const val = line.slice(eq + 1);
  if (key === "UPSTASH_REDIS_REST_URL" || key === "UPSTASH_REDIS_REST_TOKEN") {
    process.env[key] = val;
  }
}

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("[capture] UPSTASH_REDIS_REST_URL/TOKEN not found in .env.upstash.local");
  process.exit(1);
}

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();

let cursor = "0";
let allKeys = [];
do {
  const res = await redis.scan(cursor, { match: "ac:v10:*", count: 200 });
  cursor = res[0];
  allKeys = allKeys.concat(res[1]);
} while (cursor !== "0");

const titleLower = titleArg.toLowerCase();
const candidates = allKeys.filter((k) => {
  // key shape: ac:v10:<title>|<issue>|<fingerprint>
  const body = k.slice("ac:v10:".length);
  const [title, issue] = body.split("|");
  return title?.toLowerCase().includes(titleLower) && issue === issueArg;
});

if (candidates.length === 0) {
  console.error(`[capture] no live ac:v10:* key matched title~="${titleArg}" issue="${issueArg}".`);
  console.error("[capture] either the scan hasn't landed yet, or it already expired — check watch-active-cache-ttl.mjs timing.");
  process.exit(1);
}
if (candidates.length > 1) {
  console.log(`[capture] ${candidates.length} candidates matched — capturing all, disambiguate in the fixture file:`);
  candidates.forEach((k) => console.log("  -", k));
}

mkdirSync(fixtureDir, { recursive: true });

for (const key of candidates) {
  const [value, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  const fingerprint = key.split("|")[2] || null;
  const ageSeconds = ttl >= 0 ? 3600 - ttl : null;

  const fixture = {
    capturedAt: new Date().toISOString(),
    cacheLineage: {
      key,
      filterContextFingerprint: fingerprint,
      ttlRemainingSeconds: ttl,
      inferredAgeSeconds: ageSeconds,
      // Heuristic, not certain: KV alone can't distinguish a fresh SET
      // (MISS) from an older entry a HIT is reusing — only server logs
      // ([active-cache] HIT/MISS) can say that directly. Age since write,
      // inferred from TTL remaining vs the known 3600s TTL, is the best
      // proxy available from KV alone: a near-zero age strongly suggests
      // this capture followed a fresh MISS+SET; a larger age means this
      // entry was written by an earlier request.
      inferredFreshWrite: ageSeconds != null && ageSeconds < 120,
    },
    activePoolRaw: value,
    // Everything below MUST be filled in from the actual /api/enrich
    // response body for this exact scan — not retrievable from KV.
    // See this script's header comment and the Dispatch 39/41 record.
    manualCapture: {
      requestContext: {
        timestamp: null,
        deploySha: null,
        correlationId: null,
        confirmedTitle: null,
        confirmedIssue: null,
        confirmedYear: null,
        confirmedVariant: null,
        grade: null,
        numericTarget: null,
        isGraded: null,
        labelType: null,
        signedConsensus: null,
        assetType: null,
      },
      soldEvidence: {
        soldComps: null,       // out.soldComps (verified, pricing-consumed)
        soldCompsRaw: null,    // out.soldCompsRaw
        soldPoolCount: null,
        soldSource: null,
        soldCompDiagnostics: null,  // out.soldCompDiagnostics
      },
      activeEvidence: {
        activePoolCount: null,
        activePoolSuspect: null,
        fallbackFlagsConsumed: null,
      },
      outputBaseline: {
        priceTraceTierBranch: null,   // [price-trace] log line
        priceBandsSource: null,       // [price-bands] source
        calculatedMarketBeforeFloors: null,
        quickMarketStretch: null,
        floorsFired: null,            // mega-key-floor or any other, which one
        finalPrice: null,
        decisionAction: null,
        decisionConfidence: null,
        blockers: null,
        warnings: null,
      },
    },
    label: labelArg || null,
  };

  const safeTitle = titleArg.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const outPath = join(fixtureDir, `${safeTitle}-${issueArg}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(fixture, null, 2));
  console.log(`[capture] wrote ${outPath}`);
  console.log(`[capture]   key: ${key}`);
  console.log(`[capture]   ttlRemaining: ${ttl}s  inferredAge: ${ageSeconds}s  inferredFreshWrite: ${fixture.cacheLineage.inferredFreshWrite}`);
  console.log(`[capture]   activePoolRaw.count: ${value?.count ?? "n/a"}`);
  console.log(`[capture]   >>> manualCapture fields still need the actual /api/enrich response merged in <<<`);
}
