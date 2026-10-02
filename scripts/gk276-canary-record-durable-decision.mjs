#!/usr/bin/env node
/**
 * gk276-canary-record-durable-decision -- GK-276 controlled Production canary.
 *
 * Performs ONE explicit, server-derived, decision-producing action against the
 * real deployed Production /api/enrich for ONE already-linked collection item:
 * an ordinary owned-item market refresh (ownedRefresh) that additionally carries
 * recordDurableDecision:true. The server computes the price/decision itself and
 * (only if the item's gkAssetId is in OUTCOME1_PRODUCTION_ASSET_ALLOWLIST) writes
 * ONE atomic SERVER_DERIVED valuation_event + decision_event.
 *
 * Authentication: a short-lived session token for the OWNER principal is minted
 * IN-PROCESS from the pulled Production session secret and sent as a Bearer
 * header. The secret and the token are never printed or written anywhere.
 * No eBay/marketplace write is performed (enrich is read-only market research).
 *
 * Usage: node scripts/gk276-canary-record-durable-decision.mjs <collectionItemId> [--read-only-plan]
 *
 * Prints ONLY: the canonical item resolution, the decline/attempt outcome and
 * the resulting row ids. No tokens, no URLs with credentials.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const collectionItemId = process.argv[2];
if (!collectionItemId) { console.error('usage: node scripts/gk276-canary-record-durable-decision.mjs <collectionItemId>'); process.exit(2); }
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(path.join(repoRoot, file), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return out;
}
const dbEnv = loadEnv('.env.production-secrets.local');
const pullEnv = loadEnv('.env.production-pull.local');
process.env.GRAILKEY_SESSION_SECRET = pullEnv.GRAILKEY_SESSION_SECRET;
if (pullEnv.GRAILKEY_SESSION_EPOCH !== undefined) process.env.GRAILKEY_SESSION_EPOCH = pullEnv.GRAILKEY_SESSION_EPOCH;
if (!process.env.GRAILKEY_SESSION_SECRET) throw new Error('no session secret available locally');

// 1. Read-only: the durable owned item, its canonical link, and the environment identity.
const db = new pg.Client({ connectionString: dbEnv.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
let item, link;
try {
  await db.query('BEGIN READ ONLY');
  const marker = (await db.query('SELECT app_env FROM data1_dev.environment_marker LIMIT 1')).rows[0]?.app_env;
  if (marker !== 'production') throw new Error(`ABORT -- database environment is ${marker}, expected production`);
  item = (await db.query('SELECT id, principal_id, asset_category, attributes FROM data1_dev.collection_item WHERE id = $1', [collectionItemId])).rows[0];
  if (!item) throw new Error('ABORT -- collection item not found');
  link = (await db.query('SELECT gk_asset_id FROM data1_dev.collection_item_link WHERE collection_item_id = $1', [collectionItemId])).rows[0];
  await db.query('ROLLBACK');
} finally { await db.end(); }
console.log(`canonical resolution: collection_item ${collectionItemId} -> gkAssetId ${link?.gk_asset_id ?? 'NONE (unlinked duplicate)'}`);
if (!link) throw new Error('ABORT -- this collection_item has no collection_item_link; refusing (the canary targets only the canonically linked projection)');
if (process.argv.includes('--read-only-plan')) { console.log('read-only plan only; not calling the endpoint.'); process.exit(0); }

// 2. Mint a short-lived owner token IN-PROCESS (never printed).
const { issueToken } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'token.js')).href);
const { token } = issueToken({ principalId: item.principal_id });

// 3. The same shape the app's refreshMarketData sends for an owned item, built ONLY from the durable row.
const a = item.attributes || {};
const body = {
  title: a.title, issue: a.issue ?? null, year: a.year ?? null, publisher: a.publisher ?? null, variant: a.variant ?? null,
  grade: a.grade ?? null, confidence: a.confidence ?? null, isGraded: !!a.isGraded, numericGrade: a.numericGrade ?? null,
  keyIssue: a.keyIssue ?? null, assetTypeConfident: a.assetTypeConfident, pcProductId: a.pcProductId ?? null,
  skipClaudeCheck: true, skipImageSearch: true, skipVision: true,
  collectionItemId, ownedRefresh: true, recordDurableDecision: true,
};
console.log(`request identity (from the durable row): title=${JSON.stringify(body.title)} issue=${JSON.stringify(body.issue)} year=${JSON.stringify(body.year)}`);

const res = await fetch('https://comic-vault-rouge.vercel.app/api/enrich', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
let json = null;
try { json = JSON.parse(text); } catch { console.log('non-JSON response (first 200 chars):', text.slice(0, 200)); process.exit(1); }
console.log('outcome1Result:', JSON.stringify(json.outcome1Result ?? null));
console.log('server price:', json.price, '| decision:', json.decision?.action, '| pricingSource:', json.pricingSource);
