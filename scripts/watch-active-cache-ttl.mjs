#!/usr/bin/env node
/**
 * GrailKey Dispatch 39/41 — Bone recollection: TTL-watch tool.
 *
 * Lists every live `ac:v10:*` key with its remaining TTL, soonest-expiring
 * first — a single-shot snapshot, not a poll loop (run it manually as
 * often as you want during a capture batch). Purely diagnostic: never
 * reads or logs credential values, only key names and TTL seconds.
 *
 * Usage: node scripts/watch-active-cache-ttl.mjs
 *
 * Loads UPSTASH_REDIS_REST_URL/TOKEN from .env.upstash.local (gitignored,
 * per Dispatch 39's Gate 1 corrected access path — vercel env pull cannot
 * retrieve these, they are Vercel Sensitive-type variables).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const envFile = join(repoRoot, ".env.upstash.local");

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
  console.error("[ttl-watch] UPSTASH_REDIS_REST_URL/TOKEN not found in .env.upstash.local");
  process.exit(1);
}

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();

let cursor = "0";
let keys = [];
do {
  const res = await redis.scan(cursor, { match: "ac:v10:*", count: 200 });
  cursor = res[0];
  keys = keys.concat(res[1]);
} while (cursor !== "0");

if (!keys.length) {
  console.log("[ttl-watch] 0 ac:v10:* keys live right now.");
  process.exit(0);
}

const withTtl = [];
for (const key of keys) {
  const ttl = await redis.ttl(key); // seconds remaining, -1 = no TTL, -2 = gone
  withTtl.push({ key, ttl });
}
withTtl.sort((a, b) => a.ttl - b.ttl);

console.log(`[ttl-watch] ${withTtl.length} ac:v10:* keys live, soonest-expiring first:\n`);
for (const { key, ttl } of withTtl) {
  const mins = ttl >= 0 ? (ttl / 60).toFixed(1) : String(ttl);
  const flag = ttl >= 0 && ttl < 300 ? "  <-- under 5 min, capture NOW" : "";
  console.log(`  ${mins.padStart(6)}min  ${key}${flag}`);
}
