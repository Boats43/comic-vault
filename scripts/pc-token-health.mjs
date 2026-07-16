#!/usr/bin/env node
/**
 * PriceCharting token health check — dispatch 2026-07-16.
 *
 * Pings PriceCharting's /api/products endpoint once with the current
 * PRICECHARTING_TOKEN against a well-known, always-present book and reports
 * PASS/FAIL/WARN in one line. Run this before assuming a pricing gap is a
 * scarce-book edge case rather than an expired token:
 *
 *   node scripts/pc-token-health.mjs
 *
 * Reuses lookupPriceCharting's own token-expiry detection (api/enrich.js)
 * rather than re-implementing the auth-error heuristics — same code path,
 * same logging marker, so this check can never drift from what enrich.js
 * actually does in production.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lookupPriceCharting } from "../api/enrich.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// No dotenv dependency — this repo has none. Load PRICECHARTING_TOKEN
// straight from whichever pulled env file has it, so this check works
// without the caller first exporting anything by hand. Preference order
// matches how close each file is to what's actually live in production.
if (!process.env.PRICECHARTING_TOKEN) {
  for (const file of [".env.production", ".env.vercel", ".env.local", ".env"]) {
    try {
      const text = readFileSync(join(repoRoot, file), "utf8");
      const match = text.match(/^PRICECHARTING_TOKEN=(.+)$/m);
      if (match) {
        process.env.PRICECHARTING_TOKEN = match[1].trim().replace(/^["']|["']$/g, "");
        console.log(`[pc-health] loaded PRICECHARTING_TOKEN from ${file}`);
        break;
      }
    } catch {
      // file absent — try the next one
    }
  }
}

if (!process.env.PRICECHARTING_TOKEN) {
  console.log("[pc-health] FAIL — PRICECHARTING_TOKEN not found (checked process.env, .env.production, .env.vercel, .env.local, .env)");
  process.exit(1);
}

const pcDiag = {};
const start = Date.now();

let result;
try {
  result = await lookupPriceCharting({
    title: "Amazing Spider-Man",
    issue: "1",
    year: "1963",
    pcDiag,
  });
} catch (err) {
  console.log(`[pc-health] FAIL — request threw: ${err?.message || err}`);
  process.exit(1);
}

const ms = Date.now() - start;

if (pcDiag.pcTokenExpired) {
  console.log(`[pc-health] FAIL — token expired/invalid, see [pricecharting] TOKEN EXPIRED log above (${ms}ms)`);
  process.exit(1);
}

if (result) {
  console.log(`[pc-health] PASS — token valid, matched "${result.productName}" (${ms}ms)`);
  process.exit(0);
}

// No auth error was flagged, but a book this common should always match.
// Something other than the token broke (query shape, endpoint change) —
// surface it distinctly rather than reporting a clean pass.
console.log(`[pc-health] WARN — no auth error, but no match for "Amazing Spider-Man #1" — investigate query/endpoint shape, not just the token (${ms}ms)`);
process.exit(2);
