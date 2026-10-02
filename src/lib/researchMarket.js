// GK-273 — RESEARCH THE MARKET (bounded web-research fallback), server side.
//
// PERMANENT LAW: AI DISCOVERS EVIDENCE. AI DOES NOT CREATE MARKET FACTS.
//  * WEB_RESEARCH is a PROVENANCE / COLLECTION CHANNEL (`sourceMode`), never an
//    evidence class. Rows keep the normalized taxonomy (REALIZED_SALE,
//    ACTIVE_ASK, AUCTION_STATE, REFERENCE) and carry `authorityStatus`.
//  * Every discovered transaction claim starts CANDIDATE. This module has NO
//    promotion path to CONFIRMED (CONFIRMATION_RULES is empty by design —
//    a deterministic provider-specific verifier would have to be added there).
//  * Research output NEVER feeds the automated recommended price, the
//    contract, the decision engine, or any listing lock. It is presented
//    separately (RESEARCH RANGE) for the operator.
//  * Receipts, not page copies: only extracted facts + provenance persist;
//    fetched page bodies exist in memory for verification and are discarded.
//  * Cost is bounded by construction: hard-clamped search/fetch/output caps,
//    one model call (no agent loop on our side), Haiku by default, no
//    automatic escalation.
//
// Universal by design: the request/result contract is category-neutral
// (`assetCategory`, free-form identity facts); category-specific prompts can
// be layered later without changing the contract.

import crypto from 'node:crypto';

export const RESEARCH_VERSION = 'rm-v1';

// ───────────────────────── limits (server-enforced) ─────────────────────────

// Absolute ceilings. Environment configuration may only LOWER these.
export const RESEARCH_HARD_CAPS = Object.freeze({
  MAX_WEB_SEARCHES_PER_RUN: 3,
  MAX_WEB_FETCHES_PER_RUN: 3,
  MAX_CONTENT_TOKENS_PER_FETCH: 2000,
  MAX_OUTPUT_TOKENS: 1200,
});

export const RESEARCH_DEFAULTS = Object.freeze({
  MODEL: 'claude-haiku-4-5-20251001',
  DAILY_RUNS_PER_PRINCIPAL: 3,
  CACHE_TTL_SECONDS: 72 * 3600,        // application result cache: 72h (>= the 24h floor)
  RECORD_TTL_SECONDS: 30 * 24 * 3600,  // receipts retained for history
  LOCK_TTL_SECONDS: 150,               // in-flight de-dupe (double-click protection)
  MAX_ROWS: 6,
});

const lowerOnly = (envVal, hardCap) => {
  const n = parseInt(envVal, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, hardCap) : hardCap;
};

export const resolveResearchConfig = (env = process.env) => ({
  model: env.RESEARCH_MODEL || RESEARCH_DEFAULTS.MODEL,
  maxWebSearches: lowerOnly(env.RESEARCH_MAX_WEB_SEARCHES, RESEARCH_HARD_CAPS.MAX_WEB_SEARCHES_PER_RUN),
  maxWebFetches: lowerOnly(env.RESEARCH_MAX_WEB_FETCHES, RESEARCH_HARD_CAPS.MAX_WEB_FETCHES_PER_RUN),
  maxContentTokensPerFetch: lowerOnly(env.RESEARCH_MAX_CONTENT_TOKENS_PER_FETCH, RESEARCH_HARD_CAPS.MAX_CONTENT_TOKENS_PER_FETCH),
  maxOutputTokens: lowerOnly(env.RESEARCH_MAX_OUTPUT_TOKENS, RESEARCH_HARD_CAPS.MAX_OUTPUT_TOKENS),
  // Configurable (no hard ceiling beyond sanity): beta cost protection.
  dailyRunsPerPrincipal: (() => {
    const n = parseInt(env.RESEARCH_MAX_RUNS_PER_PRINCIPAL_PER_DAY, 10);
    return Number.isFinite(n) && n >= 0 ? n : RESEARCH_DEFAULTS.DAILY_RUNS_PER_PRINCIPAL;
  })(),
  cacheTtlSeconds: (() => {
    const n = parseInt(env.RESEARCH_CACHE_TTL_SECONDS, 10);
    return Number.isFinite(n) && n > 0 ? Math.max(n, 86400) : RESEARCH_DEFAULTS.CACHE_TTL_SECONDS; // never below 24h
  })(),
  recordTtlSeconds: RESEARCH_DEFAULTS.RECORD_TTL_SECONDS,
  lockTtlSeconds: RESEARCH_DEFAULTS.LOCK_TTL_SECONDS,
  maxRows: RESEARCH_DEFAULTS.MAX_ROWS,
});

// ───────────────────────── cost (versioned, deterministic) ─────────────────────────

export const RESEARCH_PRICE_TABLE = Object.freeze({
  version: '2026-10-01',
  note: 'Anthropic list prices per million tokens; web search per request. Estimate only — not accounting authority.',
  models: Object.freeze({
    'claude-haiku-4-5-20251001': { inPerMTok: 1.0, outPerMTok: 5.0, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
    'claude-haiku-4-5': { inPerMTok: 1.0, outPerMTok: 5.0, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  }),
  webSearchPerRequestUsd: 0.01,
});

// Returns null (never an invented number) when the model is not in the table.
export const estimateResearchCostUsd = (receipt) => {
  const p = RESEARCH_PRICE_TABLE.models[receipt?.model];
  if (!p) return null;
  const M = 1e6;
  const cost =
    ((receipt.inputTokens || 0) / M) * p.inPerMTok +
    ((receipt.outputTokens || 0) / M) * p.outPerMTok +
    ((receipt.cacheWriteTokens || 0) / M) * p.cacheWritePerMTok +
    ((receipt.cacheReadTokens || 0) / M) * p.cacheReadPerMTok +
    (receipt.webSearchCount || 0) * RESEARCH_PRICE_TABLE.webSearchPerRequestUsd;
  return Math.round(cost * 1e5) / 1e5;
};

// ───────────────────────── request facts (durable/current only) ─────────────────────────

const STANDING_BLOCKING = new Set(['CONFLICTED', 'UNRESOLVED', 'REFUSED']);

const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';

// Only durable/current GrailKey facts, each with an explicit status. Rejected
// or unresolved identity claims are NEVER sent as facts: they are either
// PROVISIONAL (flagged as unverified hints) or UNKNOWN.
export const buildResearchFacts = (item) => {
  const a = item || {};
  const identityStanding =
    a.contract?.actionAuthority?.identityStanding ||
    (a.identityConfident === false ? 'UNRESOLVED' : 'CONFIRMED');
  const identityBlocked = a.identityConfident === false || STANDING_BLOCKING.has(identityStanding);
  const idStatus = identityBlocked ? 'PROVISIONAL' : 'ESTABLISHED';

  const field = (value, status = idStatus) => (present(value) ? { value: String(value), status } : { value: null, status: 'UNKNOWN' });

  const gradeConfirmed = a.gradeAuthority === 'OPERATOR_CONFIRMED';
  const governingGrade = gradeConfirmed && present(a.operatorGrade) ? a.operatorGrade : a.grade;
  const slabbed = (gradeConfirmed && a.operatorIsGraded != null ? a.operatorIsGraded : a.isGraded) === true;

  const facts = {
    assetCategory: present(a.assetType) ? String(a.assetType) : (present(a.assetCategory) ? String(a.assetCategory) : 'comic'),
    gkAssetId: a.gkAssetId || null,
    identityStanding: STANDING_BLOCKING.has(identityStanding) ? identityStanding : (identityBlocked ? 'UNRESOLVED' : 'CONFIRMED'),
    title: field(a.title),
    issue: field(a.issue),
    year: field(a.year),
    publisher: field(a.publisher),
    // Variant/edition/country/HRN are NEVER taken from raw model text. A
    // variant is a fact only if the reconciler confirmed it.
    variant: present(a.confirmedVariant) ? { value: String(a.confirmedVariant), status: 'ESTABLISHED' } : { value: null, status: 'UNKNOWN' },
    editionStanding: present(a.editionStanding) ? String(a.editionStanding) : 'UNRESOLVED',
    country: { value: null, status: 'UNKNOWN' },
    hrn: { value: null, status: 'UNKNOWN' },
    printing: { value: null, status: 'UNKNOWN' },
    governingGrade: present(governingGrade)
      ? { value: String(governingGrade), status: gradeConfirmed ? 'ESTABLISHED' : 'MODEL_ESTIMATE' }
      : { value: null, status: 'UNKNOWN' },
    rawOrSlabbed: slabbed ? 'SLABBED' : 'RAW',
    certNumber: slabbed && present(a.certNumber) ? String(a.certNumber) : null,
  };
  return facts;
};

const canonicalJson = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};

export const researchFingerprint = (facts) =>
  crypto.createHash('sha256').update(`${RESEARCH_VERSION}|${canonicalJson(facts)}`).digest('hex').slice(0, 32);

export const researchAssetKey = (item, collectionItemId) => (item?.gkAssetId ? `a:${item.gkAssetId}` : `c:${collectionItemId}`);

// ───────────────────────── tools + prompt ─────────────────────────

export const WEB_FETCH_BETA = 'web-fetch-2025-09-10';

export const buildResearchTools = (config) => [
  { type: 'web_search_20250305', name: 'web_search', max_uses: config.maxWebSearches },
  {
    type: 'web_fetch_20250910',
    name: 'web_fetch',
    max_uses: config.maxWebFetches,
    max_content_tokens: config.maxContentTokensPerFetch,
  },
];

export const RESEARCH_SYSTEM_PROMPT = [
  'You are a market-evidence researcher for a collectibles app. You DISCOVER evidence; you do not create market facts.',
  'Rules:',
  '- Report only facts literally present in a page you searched or fetched. Never estimate, average, infer or fill gaps. Unknown = null.',
  '- Every row needs the exact sourceUrl you saw. Do not invent URLs.',
  '- Classify each row: REALIZED_SALE (a completed sale/hammer with a price and date), ACTIVE_ASK (a current listing or dealer ask), AUCTION_STATE (a current bid/estimate, not final), REFERENCE (a guide/database/catalogue reference).',
  '- identityMatch: EXACT only if title, issue AND printing/edition/country/grade are demonstrably the same as the target; SIMILAR for the same issue but another printing/edition/grade/country; DIFFERENT if it is a different book. If edition-bearing details (printing, country, HRN) are not stated on the page, do NOT assume them — use UNKNOWN fields and at most SIMILAR.',
  '- Do not label anything confirmed. Do not copy page text; short notes only.',
  '- Be economical: at most the permitted searches and fetches; stop as soon as evidence is sufficient. If evidence is thin say INSUFFICIENT. Never keep searching to improve confidence.',
  '- Write NO text before, between or after tool calls except the final JSON. No commentary, no plans, no explanations.',
  'Return ONLY compact JSON, no prose, no markdown.',
].join('\n');

const JSON_SHAPE = [
  '{"rows":[{"provider":string,"sourceUrl":string,"sourceTitle":string,"evidenceClass":"REALIZED_SALE|ACTIVE_ASK|AUCTION_STATE|REFERENCE",',
  '"price":number|null,"currency":"USD","saleDate":"YYYY-MM-DD"|null,"title":string,"issue":string|null,"year":number|null,"publisher":string|null,',
  '"variant":string|null,"edition":string|null,"printing":string|null,"country":string|null,"hrn":string|null,',
  '"grade":string|null,"gradingCompany":string|null,"rawOrSlabbed":"RAW|SLABBED|UNKNOWN","identityMatch":"EXACT|SIMILAR|DIFFERENT|UNKNOWN",',
  '"matchConfidence":number,"note":string}],"summary":string,"sufficiency":"SUFFICIENT|INSUFFICIENT"}',
].join('');

export const buildResearchUserText = (facts, config) =>
  [
    'TARGET (durable GrailKey facts; PROVISIONAL = unverified hint, UNKNOWN = not established — do not assume):',
    JSON.stringify(facts),
    '',
    `Hard budget: at most ${config.maxWebSearches} web searches and ${config.maxWebFetches} page fetches in total; most runs need far fewer. Plan:`,
    '1) ONE search combining exact identity + edition/printing + realized-sale terms (sold, auction result, hammer, completed). Often this is enough.',
    '2) Only if search 1 found no realized sales: one search for realized/auction archives of the same issue (adjacent grade or other printings = SIMILAR).',
    '3) Only if still needed: one search for current asks/dealer inventory or a reference entry.',
    'Fetch a page only when a search result clearly shows a sale but not its price/date; at most one fetch unless that page is clearly insufficient. Do not repeat a search you have effectively done.',
    `At most ${config.maxRows} rows total, best evidence first, each note under 60 characters, summary under 200 characters. Keep the JSON compact.`,
    `Output exactly this JSON shape: ${JSON_SHAPE}`,
  ].join('\n');

export const buildResearchMessages = (facts, config, image = null) => {
  const content = [];
  // One canonical front image only, and only when identity is not already
  // established (visual evidence materially helps then). Never re-sent per search.
  if (image && image.base64 && facts.identityStanding !== 'CONFIRMED') {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  }
  content.push({ type: 'text', text: buildResearchUserText(facts, config) });
  return [{ role: 'user', content }];
};

// ───────────────────────── response handling ─────────────────────────

const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u);

const normUrl = (u) => {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(u || '').toLowerCase();
  }
};

// What the tools ACTUALLY returned. Source URLs the model cites must be in
// this set. Fetched/cited text is kept only in memory for verification.
export const extractToolEvidence = (message) => {
  const seenUrls = new Set();
  const sourceTexts = new Map();
  const addText = (url, text) => {
    if (!url || !text) return;
    const k = normUrl(url);
    sourceTexts.set(k, `${sourceTexts.get(k) || ''}\n${String(text)}`);
  };
  for (const b of message?.content || []) {
    if (b?.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r?.url) seenUrls.add(normUrl(r.url));
    } else if (b?.type === 'web_fetch_tool_result' && b.content && typeof b.content === 'object') {
      const url = b.content.url;
      if (url) seenUrls.add(normUrl(url));
      const doc = b.content.content;
      const data = doc?.source?.data ?? doc?.data ?? null;
      if (typeof data === 'string') addText(url, data);
    } else if (b?.type === 'text' && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        if (c?.url) { seenUrls.add(normUrl(c.url)); addText(c.url, c.cited_text); }
      }
    }
  }
  return { seenUrls, sourceTexts };
};

export const collectResponseText = (message) =>
  (message?.content || []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n');

// Tolerant JSON extraction: whole text, then first-{..last-}, then a salvage
// of a truncated rows array (cut at the last complete row).
export const parseResearchJson = (text) => {
  const t = String(text || '').trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let parsed = tryParse(t);
  if (!parsed) {
    const a = t.indexOf('{'); const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) parsed = tryParse(t.slice(a, b + 1));
  }
  if (!parsed) {
    // Truncated output (max_tokens): salvage every complete row.
    const rowsIdx = t.indexOf('"rows"');
    const start = rowsIdx >= 0 ? t.lastIndexOf('{', rowsIdx) : -1;
    if (start >= 0) {
      const body = t.slice(start);
      const cut = body.lastIndexOf('},');
      if (cut > 0) parsed = tryParse(body.slice(0, cut + 1) + '],"summary":"","sufficiency":"INSUFFICIENT"}');
    }
  }
  return parsed && typeof parsed === 'object' ? parsed : null;
};

// ───────────────────────── authority + normalization ─────────────────────────

export const RESEARCH_EVIDENCE_CLASSES = Object.freeze(['REALIZED_SALE', 'ACTIVE_ASK', 'AUCTION_STATE', 'REFERENCE']);
export const AUTHORITY_STATUS = Object.freeze({ CONFIRMED: 'CONFIRMED', CANDIDATE: 'CANDIDATE', SIMILAR: 'SIMILAR', REJECTED: 'REJECTED' });
// Deterministic provider-specific verification rules that may promote a
// CANDIDATE to CONFIRMED. EMPTY in V1: generic AI interpretation can never
// confirm. Adding a rule here is the only sanctioned promotion path.
export const CONFIRMATION_RULES = Object.freeze([]);

const str = (v, max = 200) => (present(v) ? String(v).slice(0, max) : null);
const nul = (v) => (present(v) ? v : null);

const priceVariants = (p) => {
  const n = Number(p);
  if (!Number.isFinite(n)) return [];
  const two = n.toFixed(2);
  const whole = String(Math.round(n));
  const withComma = Number(two).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [...new Set([two, withComma, Number.isInteger(n) ? whole : null].filter(Boolean))];
};

const priceInText = (text, price) => priceVariants(price).some((v) => new RegExp(`(?:^|[^0-9.,])\\$?\\s?${v.replace(/[.,]/g, (m) => `\\${m}`)}(?![0-9])`).test(text));

export const researchEvidenceId = (principalId, row) =>
  crypto.createHash('sha256').update(`${principalId}|${normUrl(row.sourceUrl)}|${row.price}|${row.saleDate}|${row.evidenceClass}`).digest('hex').slice(0, 24);

export const normalizeResearchRows = (parsed, toolEvidence, { principalId, gkAssetId = null, retrievedAt, maxRows = RESEARCH_DEFAULTS.MAX_ROWS, now = Date.now() } = {}) => {
  const rows = [];
  const rejected = [];
  const raw = Array.isArray(parsed?.rows) ? parsed.rows.slice(0, maxRows) : [];
  for (const r of raw) {
    const reject = (reason) => rejected.push({ sourceUrl: isHttpUrl(r?.sourceUrl) ? r.sourceUrl : null, provider: str(r?.provider, 80), reason });
    if (!r || typeof r !== 'object') { reject('malformed-row'); continue; }
    if (!RESEARCH_EVIDENCE_CLASSES.includes(r.evidenceClass)) { reject('invalid-evidence-class'); continue; }
    if (!isHttpUrl(r.sourceUrl)) { reject('missing-or-invalid-source-url'); continue; }
    // AI DOES NOT CREATE MARKET FACTS: the cited page must be one the tools
    // actually returned.
    if (!toolEvidence.seenUrls.has(normUrl(r.sourceUrl))) { reject('source-url-not-returned-by-tools'); continue; }
    const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 ? r.price : null;
    if ((r.evidenceClass === 'REALIZED_SALE' || r.evidenceClass === 'ACTIVE_ASK') && price == null) { reject('price-required'); continue; }
    if (r.identityMatch === 'DIFFERENT') { reject('different-book'); continue; }

    let saleDate = null;
    if (present(r.saleDate) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.saleDate))) {
      const t = Date.parse(`${r.saleDate}T00:00:00Z`);
      if (Number.isFinite(t) && t <= now) saleDate = String(r.saleDate);
    }
    // An ask has no sale date by definition.
    if (r.evidenceClass === 'ACTIVE_ASK' || r.evidenceClass === 'REFERENCE') saleDate = null;

    const flags = [];
    if (r.evidenceClass === 'REALIZED_SALE' && !saleDate) flags.push('no-sale-date');
    const text = toolEvidence.sourceTexts.get(normUrl(r.sourceUrl));
    let priceSupport;
    if (price == null) priceSupport = 'NOT_APPLICABLE';
    else if (text && priceInText(text, price)) priceSupport = 'IN_SOURCE_TEXT';
    else if (text) { priceSupport = 'NOT_FOUND_IN_FETCHED_TEXT'; flags.push('price-not-found-in-fetched-text'); }
    else priceSupport = 'SEARCH_RESULT_ONLY';

    const match = r.identityMatch === 'EXACT' ? 'EXACT' : r.identityMatch === 'SIMILAR' ? 'SIMILAR' : 'UNKNOWN';
    // Authority: CANDIDATE unless it is explicitly a different printing/edition
    // (SIMILAR). Nothing is CONFIRMED (CONFIRMATION_RULES is empty), and a
    // price that the fetched text contradicts stays a flagged candidate.
    const authorityStatus = match === 'SIMILAR' ? AUTHORITY_STATUS.SIMILAR : AUTHORITY_STATUS.CANDIDATE;

    const row = {
      researchEvidenceId: null,
      gkAssetId,
      provider: str(r.provider, 80) || 'UNKNOWN',
      sourceMode: 'WEB_RESEARCH',
      sourceUrl: String(r.sourceUrl).slice(0, 500),
      sourceTitle: str(r.sourceTitle, 160),
      evidenceClass: r.evidenceClass,
      authorityStatus,
      price,
      currency: str(r.currency, 3) || 'USD',
      saleDate,
      title: str(r.title, 160),
      issue: str(r.issue, 20),
      year: Number.isFinite(r.year) ? r.year : null,
      publisher: str(r.publisher, 80),
      variant: str(r.variant, 80),
      edition: str(r.edition, 80),
      printing: str(r.printing, 60),
      country: str(r.country, 40),
      hrn: str(r.hrn, 12),
      grade: str(r.grade, 20),
      gradingCompany: str(r.gradingCompany, 12),
      rawOrSlabbed: ['RAW', 'SLABBED'].includes(r.rawOrSlabbed) ? r.rawOrSlabbed : 'UNKNOWN',
      identityMatch: match,
      matchConfidence: typeof r.matchConfidence === 'number' ? Math.max(0, Math.min(1, r.matchConfidence)) : null,
      priceSupport,
      flags,
      researchSummary: str(r.note, 100),
      retrievedAt,
    };
    row.researchEvidenceId = researchEvidenceId(principalId, row);
    rows.push(row);
  }
  return { rows, rejected };
};

// ───────────────────────── presentation-independent summary ─────────────────────────

const range = (xs) => (xs.length ? { low: Math.min(...xs), high: Math.max(...xs), n: xs.length } : null);

// RESEARCH RANGE is context for the operator. It is derived from CANDIDATE
// exact realized rows only and is NEVER an automated recommended price.
export const summarizeResearchRows = (rows) => {
  const priced = (cls, pred) => rows.filter((r) => r.evidenceClass === cls && r.price != null && pred(r)).map((r) => r.price);
  const counts = {
    confirmedRealized: rows.filter((r) => r.evidenceClass === 'REALIZED_SALE' && r.authorityStatus === 'CONFIRMED').length,
    candidateRealized: rows.filter((r) => r.evidenceClass === 'REALIZED_SALE' && r.authorityStatus === 'CANDIDATE').length,
    similarRealized: rows.filter((r) => r.evidenceClass === 'REALIZED_SALE' && r.authorityStatus === 'SIMILAR').length,
    activeAsks: rows.filter((r) => r.evidenceClass === 'ACTIVE_ASK').length,
    auctionStates: rows.filter((r) => r.evidenceClass === 'AUCTION_STATE').length,
    references: rows.filter((r) => r.evidenceClass === 'REFERENCE').length,
  };
  return {
    counts,
    researchRange: range(priced('REALIZED_SALE', (r) => r.authorityStatus === 'CANDIDATE')),
    similarRange: range(priced('REALIZED_SALE', (r) => r.authorityStatus === 'SIMILAR')),
    activeAskRange: range(priced('ACTIVE_ASK', () => true)),
  };
};

// ───────────────────────── receipt (operational metadata) ─────────────────────────

export const buildUsageReceipt = (message, { model, startedAt, completedAt } = {}) => {
  const u = message?.usage || {};
  const st = u.server_tool_use || {};
  const receipt = {
    model: model || message?.model || null,
    webSearchCount: Number.isFinite(st.web_search_requests) ? st.web_search_requests : null,
    webFetchCount: Number.isFinite(st.web_fetch_requests) ? st.web_fetch_requests : null,
    inputTokens: Number.isFinite(u.input_tokens) ? u.input_tokens : null,
    outputTokens: Number.isFinite(u.output_tokens) ? u.output_tokens : null,
    cacheReadTokens: Number.isFinite(u.cache_read_input_tokens) ? u.cache_read_input_tokens : null,
    cacheWriteTokens: Number.isFinite(u.cache_creation_input_tokens) ? u.cache_creation_input_tokens : null,
    stopReason: message?.stop_reason || null,
    startedAt,
    completedAt,
  };
  const est = estimateResearchCostUsd(receipt);
  receipt.estimatedCostUsd = est;
  receipt.priceTableVersion = est == null ? null : RESEARCH_PRICE_TABLE.version;
  return receipt;
};

// Whether the provider-reported usage exceeded the configured caps (the
// server-side max_uses is the enforcement; this is the audit).
export const auditCaps = (receipt, config) => {
  const violations = [];
  if (receipt.webSearchCount != null && receipt.webSearchCount > config.maxWebSearches) violations.push('web-searches');
  if (receipt.webFetchCount != null && receipt.webFetchCount > config.maxWebFetches) violations.push('web-fetches');
  if (receipt.outputTokens != null && receipt.outputTokens > config.maxOutputTokens) violations.push('output-tokens');
  return violations;
};

// ───────────────────────── the one model call ─────────────────────────

// Exactly ONE provider request. No loop on our side: server-side tool use is
// bounded by max_uses, output by max_tokens. A `pause_turn` is NOT resumed.
export const runResearchModelCall = async ({ client, config, facts, image = null }) => {
  const startedAt = new Date().toISOString();
  const message = await client.beta.messages.create({
    model: config.model,
    max_tokens: config.maxOutputTokens,
    system: RESEARCH_SYSTEM_PROMPT,
    messages: buildResearchMessages(facts, config, image),
    tools: buildResearchTools(config),
    betas: [WEB_FETCH_BETA],
  });
  return { message, startedAt, completedAt: new Date().toISOString() };
};

// Assemble the persisted record from a provider message. Pure.
export const assembleResearchRecord = ({ message, startedAt, completedAt, config, facts, fingerprint, principalId, collectionItemId, now = Date.now() }) => {
  const toolEvidence = extractToolEvidence(message);
  const parsed = parseResearchJson(collectResponseText(message));
  const retrievedAt = new Date(now).toISOString();
  const { rows, rejected } = normalizeResearchRows(parsed, toolEvidence, { principalId, gkAssetId: facts.gkAssetId, retrievedAt, maxRows: config.maxRows, now });
  const usage = buildUsageReceipt(message, { model: config.model, startedAt, completedAt });
  const capViolations = auditCaps(usage, config);
  const paused = message?.stop_reason === 'pause_turn';
  const summary = summarizeResearchRows(rows);
  let sufficiency = parsed?.sufficiency === 'SUFFICIENT' && rows.length > 0 && !paused ? 'SUFFICIENT' : 'INSUFFICIENT';
  if (summary.counts.candidateRealized + summary.counts.confirmedRealized === 0) sufficiency = 'INSUFFICIENT';
  return {
    version: RESEARCH_VERSION,
    fingerprint,
    collectionItemId,
    gkAssetId: facts.gkAssetId,
    retrievedAt,
    sourceMode: 'WEB_RESEARCH',
    // Echo of the asset facts used, so the receipt is self-describing. The
    // asset's edition/country/HRN stay UNRESOLVED/UNKNOWN: research rows are
    // facts about THEIR pages, never edition authority for this asset.
    asset: {
      identityStanding: facts.identityStanding,
      editionStanding: facts.editionStanding,
      country: facts.country,
      hrn: facts.hrn,
      governingGrade: facts.governingGrade,
      rawOrSlabbed: facts.rawOrSlabbed,
    },
    rows,
    rejected,
    summary: str(parsed?.summary, 400) || '',
    sufficiency,
    ...summary,
    status: parsed ? (paused ? 'PAUSED_NOT_RESUMED' : 'COMPLETE') : 'UNPARSEABLE',
    capViolations,
    usage,
  };
};
