// POST /api/research-market { collectionItemId, refresh?, frontImage? } -> { record, cache, limit }
// GET  /api/research-market?collectionItemId=...                       -> { record|null, limit }
//
// GK-273 — RESEARCH THE MARKET. Operator-triggered, bounded web research that
// DISCOVERS candidate evidence. It never alters price, contract, decision or
// listing locks, and performs no database or marketplace write (its only
// persistence is the principal-scoped result/receipt store).
//
// principalId is derived ONLY from the verified Bearer token. The item is
// loaded through the collection module's own ownership check, and every
// cache/limit/lock key is principal-namespaced.
//
// Cost control is enforced HERE, not in the prompt: hard-clamped search /
// fetch / output ceilings, one provider request (no agent loop), no
// automatic model escalation, an application result cache, an in-flight
// lock, and a per-principal daily limit that fails CLOSED when its store is
// unavailable.

import Anthropic from '@anthropic-ai/sdk';
import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';
import { getMyCollectionItem, NotFoundError } from '../src/modules/collection/index.js';
import { checkRateLimit } from './rate-limit.js';
import {
  resolveResearchConfig, buildResearchFacts, researchFingerprint, researchAssetKey,
  runResearchModelCall, assembleResearchRecord,
} from '../src/lib/researchMarket.js';
import {
  researchStore, ResearchStoreUnavailableError, resultKey, lastKey, lockKey, dayKey,
} from '../src/lib/researchStore.js';

let clientOverride = null;
let itemLoaderOverride = null;
export const __setResearchClientForTests = (c) => { clientOverride = c; };
export const __setResearchItemLoaderForTests = (f) => { itemLoaderOverride = f; };

const getClient = () => clientOverride || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const loadItem = (args) => (itemLoaderOverride || getMyCollectionItem)(args);

const extractBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
};

// One canonical front image, optional. Accepts a data URL; bounded size.
const MAX_IMAGE_B64_CHARS = 1_500_000;
const parseFrontImage = (v) => {
  if (typeof v !== 'string') return null;
  const m = v.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > MAX_IMAGE_B64_CHARS) return null;
  return { mediaType: m[1], base64: m[2] };
};

const limitStatus = async (store, principalId, config) => {
  const used = Number(await store.get(dayKey(principalId))) || 0;
  return { used, max: config.dailyRunsPerPrincipal };
};

export default async function handler(req, res) {
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  let principalId;
  try {
    ({ principalId } = verifyToken(extractBearerToken(req)));
  } catch (e) {
    if (e instanceof InvalidTokenError) return res.status(401).json({ error: 'Missing, invalid, or expired token' });
    console.error('[research-market] unexpected token-verification error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const config = resolveResearchConfig();
  const body = req.method === 'POST' ? (req.body || {}) : {};
  const collectionItemId = String((req.method === 'GET' ? req.query?.collectionItemId : body.collectionItemId) || '').trim();
  if (!collectionItemId || collectionItemId.length > 120) return res.status(400).json({ error: 'collectionItemId is required' });

  let item;
  try {
    item = await loadItem({ principalId, id: collectionItemId });
  } catch (e) {
    if (e instanceof NotFoundError || e?.name === 'NotFoundError') return res.status(404).json({ error: 'Not found' });
    console.error('[research-market] item load failed:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  }
  const attrs = item?.attributes || item || {};
  const facts = buildResearchFacts({ ...attrs, assetCategory: item?.assetCategory || attrs.assetCategory });
  const fingerprint = researchFingerprint(facts);
  const assetKey = researchAssetKey(attrs, collectionItemId);

  const store = researchStore();

  if (req.method === 'GET') {
    try {
      const record = (await store.get(lastKey(principalId, assetKey))) || null;
      return res.status(200).json({ record, limit: await limitStatus(store, principalId, config) });
    } catch (e) {
      if (e instanceof ResearchStoreUnavailableError) return res.status(503).json({ error: 'Research storage unavailable' });
      throw e;
    }
  }

  if (!facts.title.value) return res.status(400).json({ error: 'Not enough identity to research (no title)' });
  const refresh = body.refresh === true;

  // 1. Application result cache — the primary cost control.
  try {
    if (!refresh) {
      const cached = await store.get(resultKey(principalId, assetKey, fingerprint));
      const ageMs = cached?.retrievedAt ? Date.now() - Date.parse(cached.retrievedAt) : Infinity;
      if (cached && ageMs < config.cacheTtlSeconds * 1000) {
        return res.status(200).json({ record: cached, cache: 'HIT', limit: await limitStatus(store, principalId, config) });
      }
    }
  } catch (e) {
    if (e instanceof ResearchStoreUnavailableError) return res.status(503).json({ error: 'Research storage unavailable' });
    throw e;
  }

  if (!process.env.ANTHROPIC_API_KEY && !clientOverride) return res.status(503).json({ error: 'Research is not configured' });

  const lock = lockKey(principalId, assetKey, fingerprint);
  let lockHeld = false;
  let counted = false;
  let used = 0;
  try {
    // 2. In-flight de-dupe (double-click / retry protection).
    if (!(await store.setNx(lock, '1', config.lockTtlSeconds))) {
      return res.status(409).json({ error: 'Research already in progress for this item', code: 'RESEARCH_IN_PROGRESS' });
    }
    lockHeld = true;

    // 3. Per-principal daily limit (cost protection, not monetization).
    used = await store.incr(dayKey(principalId), 2 * 24 * 3600);
    counted = true;
    if (used > config.dailyRunsPerPrincipal) {
      return res.status(429).json({
        error: 'Research limit reached for today.',
        code: 'RESEARCH_LIMIT_REACHED',
        limit: { used: Math.min(used, config.dailyRunsPerPrincipal), max: config.dailyRunsPerPrincipal },
      });
    }

    // 4. The single bounded provider call. No retries, no loop, no escalation.
    let call;
    try {
      call = await runResearchModelCall({ client: getClient(), config, facts, image: parseFrontImage(body.frontImage) });
    } catch (e) {
      // No completed provider response => no counted run (refund the slot).
      try { await store.decr(dayKey(principalId)); counted = false; } catch { /* leave counted */ }
      console.error('[research-market] provider call failed:', e?.status || '', e?.message || e);
      return res.status(502).json({ error: 'Research provider error — no run was counted' });
    }

    const record = assembleResearchRecord({
      ...call, config, facts, fingerprint, principalId, collectionItemId,
    });
    await store.set(resultKey(principalId, assetKey, fingerprint), record, config.recordTtlSeconds);
    await store.set(lastKey(principalId, assetKey), record, config.recordTtlSeconds);

    console.log(
      `[research-market] run model=${record.usage.model} searches=${record.usage.webSearchCount} fetches=${record.usage.webFetchCount} ` +
      `in=${record.usage.inputTokens} out=${record.usage.outputTokens} cacheR=${record.usage.cacheReadTokens} cacheW=${record.usage.cacheWriteTokens} ` +
      `estCostUsd=${record.usage.estimatedCostUsd} rows=${record.rows.length} rejected=${record.rejected.length} status=${record.status} capViolations=${record.capViolations.join(',') || 'none'}`
    );
    return res.status(200).json({ record, cache: 'MISS', limit: { used, max: config.dailyRunsPerPrincipal } });
  } catch (e) {
    if (e instanceof ResearchStoreUnavailableError) {
      // Fail closed: if we could not read/write the guard store, do not spend.
      console.error('[research-market] store unavailable — failing closed:', e.message);
      return res.status(503).json({ error: 'Research storage unavailable' });
    }
    console.error('[research-market] unexpected error:', e?.message || e);
    return res.status(500).json({ error: 'Internal error' });
  } finally {
    if (lockHeld) { try { await store.del(lock); } catch { /* lock expires on its own */ } }
  }
}
