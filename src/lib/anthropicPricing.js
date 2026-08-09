// GrailKey Dispatch 33 (2026-08-08) — instrumentation-only cost accounting.
// No token/cost accounting existed anywhere in this codebase before this
// dispatch (confirmed by full-repo grep). This is the one named pricing
// table every cost-audit log line should read from — do not hardcode a
// rate inline at a call site.
//
// Keys are the EXACT literal model-ID strings api/grade.js and
// api/enrich.js actually pass to `messages.create({ model, ... })`
// (grep-verified 2026-08-08: "claude-haiku-4-5-20251001",
// "claude-sonnet-4-5-20250929", "claude-opus-4-7" in api/grade.js; a
// FOURTH, distinct string — the undated alias "claude-haiku-4-5" — in
// api/enrich.js's verifyCompsTitles, its only Claude call site. This
// codebase pins specific model versions in three places but uses an
// undated alias in the fourth — both forms need their own table row. A
// key here that doesn't match what the code actually sends makes
// computeAnthropicCallCostUsd return null on every call and the whole
// instrumentation logs nothing, silently — keep these in lockstep on
// every model-string change. NOTE: an undated alias can be repointed by
// Anthropic to a different underlying snapshot in the future, which
// could silently change both its behavior and its true price out from
// under this hardcoded row — revisit this row specifically if
// verification-lane costs ever look inexplicably wrong.
//
// Rates verified against Anthropic's official pricing page —
// https://platform.claude.com/docs/en/about-claude/pricing — retrieved
// 2026-08-08. Quoted verbatim from that page's Model Pricing table:
//   Claude Haiku 4.5:  $1 / MTok input,  $5 / MTok output,  5m cache write $1.25 / MTok,  1h cache write $2.00 / MTok,  cache read $0.10 / MTok
//   Claude Sonnet 4.5: $3 / MTok input,  $15 / MTok output, 5m cache write $3.75 / MTok,  1h cache write $6.00 / MTok,  cache read $0.30 / MTok
//   Claude Opus 4.7:   $5 / MTok input,  $25 / MTok output, 5m cache write $6.25 / MTok,  1h cache write $10.00 / MTok, cache read $0.50 / MTok
// (Opus 4.5/4.6/4.7/4.8/5 all share this identical price tier per that
// page as of the retrieval date above — not a discounted/legacy rate.)
// UPDATE THIS TABLE (AND THE RETRIEVAL DATE ABOVE) WHEN ANTHROPIC PRICING
// CHANGES — it will not update itself, and a stale rate here silently
// makes every downstream cost figure wrong without any error or warning.
//
// cacheWrite5m / cacheWrite1h / cacheRead are the already-multiplied
// per-MTok rate (base input × 1.25 / × 2 / × 0.1), not the raw
// multiplier — a caller never has to know the multiplier math.
export const PRICING_USD_PER_MTOK = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, cacheWrite5m: 1.25, cacheWrite1h: 2.00, cacheRead: 0.10 },
  // Undated alias used only by api/enrich.js's verifyCompsTitles — same
  // rate as the dated Haiku 4.5 row above as of the retrieval date on
  // this file's header (both are "Claude Haiku 4.5" on the pricing
  // page); kept as a separate key because it's a separate literal string
  // the code actually sends, per the note above.
  'claude-haiku-4-5': { input: 1.00, output: 5.00, cacheWrite5m: 1.25, cacheWrite1h: 2.00, cacheRead: 0.10 },
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00, cacheWrite5m: 3.75, cacheWrite1h: 6.00, cacheRead: 0.30 },
  'claude-opus-4-7': { input: 5.00, output: 25.00, cacheWrite5m: 6.25, cacheWrite1h: 10.00, cacheRead: 0.50 },
};

/**
 * Computes USD cost for one Messages API call from its raw `usage` block.
 * Returns null (never throws, never guesses) when the model isn't in the
 * table above — an unrecognized model should surface as a visible gap in
 * the pricing table, not a silently wrong $0.00.
 *
 * Cache-write TTL: uses `usage.cache_creation.{ephemeral_5m_input_tokens,
 * ephemeral_1h_input_tokens}` when the SDK response carries that
 * breakdown (confirmed present in the installed @anthropic-ai/sdk's
 * `Usage` type). Falls back to pricing the flat
 * `cache_creation_input_tokens` entirely as 5-minute writes only when no
 * breakdown is present — verified safe for this codebase specifically by
 * direct source inspection: its one `cache_control` call site
 * (api/grade.js callModel) uses `{ type: "ephemeral" }` with no `ttl`
 * field anywhere in the repo, so every cache write this code has ever
 * produced is a 5-minute write. If a future call site ever sets
 * `ttl: "1h"`, that call's cost is undercounted unless the SDK response
 * happens to include the breakdown — revisit this fallback if that
 * happens.
 *
 * @param {string} model
 * @param {import('@anthropic-ai/sdk').Anthropic.Messages.Usage} usage
 * @returns {{inputCostUsd: number, outputCostUsd: number, cacheWriteCostUsd: number, cacheReadCostUsd: number, totalCostUsd: number}|null}
 */
export const computeAnthropicCallCostUsd = (model, usage) => {
  const rates = PRICING_USD_PER_MTOK[model];
  if (!rates || !usage) return null;

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  let cacheWrite5mTokens;
  let cacheWrite1hTokens;
  if (usage.cache_creation) {
    cacheWrite5mTokens = usage.cache_creation.ephemeral_5m_input_tokens ?? 0;
    cacheWrite1hTokens = usage.cache_creation.ephemeral_1h_input_tokens ?? 0;
  } else {
    // No TTL breakdown in this response — treat the flat total as 5m-only.
    // See docstring: verified accurate for this codebase's current single
    // call site, not a general assumption.
    cacheWrite5mTokens = usage.cache_creation_input_tokens ?? 0;
    cacheWrite1hTokens = 0;
  }

  const inputCostUsd = (inputTokens / 1_000_000) * rates.input;
  const outputCostUsd = (outputTokens / 1_000_000) * rates.output;
  const cacheWriteCostUsd =
    (cacheWrite5mTokens / 1_000_000) * rates.cacheWrite5m +
    (cacheWrite1hTokens / 1_000_000) * rates.cacheWrite1h;
  const cacheReadCostUsd = (cacheReadTokens / 1_000_000) * rates.cacheRead;

  return {
    inputCostUsd,
    outputCostUsd,
    cacheWriteCostUsd,
    cacheReadCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd + cacheWriteCostUsd + cacheReadCostUsd,
  };
};

// In-memory cache for the ESTIMATED reusable-prefix token count. Keyed
// on (model, git SHA, prompt hash) — the static system-prompt prefix
// only changes when the deployed code or the prompt text itself
// changes, so counting it once per unique combination (not once per
// scan) avoids a redundant countTokens call on every single request.
// Resets on cold start, which is fine: the first request on a fresh
// instance recomputes and every subsequent request on that instance
// reuses it.
const estimatedStaticPrefixTokenCache = new Map();

// Cheap non-cryptographic string hash (FNV-1a) — only used to keep the
// cache key short; collision risk is irrelevant here since a collision
// just means one prompt variant's count gets reused for another variant
// with the same hash, which self-corrects the next time either prompt
// text changes (new git SHA invalidates the whole cache key anyway).
const hashPromptText = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

// Per-model minimum token count for a prefix to be cacheable at all.
// Verified against Anthropic's official prompt-caching docs —
// https://platform.claude.com/docs/en/build-with-claude/prompt-caching,
// "Cache limitations" section — retrieved 2026-08-08:
//   Claude Haiku 4.5:  4,096 tokens
//   Claude Sonnet 4.5: 1,024 tokens
//   Claude Opus 4.7:   2,048 tokens
// Below this minimum, cache_control is silently ignored — no error, the
// prompt simply never gets cached. UPDATE ALONGSIDE PRICING_USD_PER_MTOK
// if Anthropic changes these minimums.
const CACHE_MINIMUM_TOKENS = {
  'claude-haiku-4-5-20251001': 4096,
  'claude-haiku-4-5': 4096, // same model family/minimum as the dated row above
  'claude-sonnet-4-5-20250929': 1024,
  'claude-opus-4-7': 2048,
};

// How close an ESTIMATE has to be to a model's cache minimum before this
// diagnostic refuses to guess which side of the line it's actually on.
// Anthropic documents the count-tokens estimate as differing from real
// usage "by a small amount" but does not publish a specific error
// margin — 10% is this file's own chosen diagnostic band, not an
// Anthropic-published figure. Revisit if real `usage` data (the
// authoritative signal — see classifyCacheEligibility below) shows this
// band is too tight or too loose in practice.
const CACHE_ELIGIBILITY_UNRESOLVED_BAND = 0.10;

/**
 * Classifies whether an ESTIMATED static-prefix token count is likely
 * above or below a model's cache minimum — diagnostic only, never
 * authoritative. Anthropic's own docs: "token counting provides an
 * estimate without using caching logic" — it cannot actually confirm
 * whether a real call would be cached. Actual cache behavior is ONLY
 * ever authoritative from a real call's response `usage`:
 * `cache_creation_input_tokens`, `cache_read_input_tokens`, and (when
 * present) `cache_creation.ephemeral_5m_input_tokens`/
 * `cache_creation.ephemeral_1h_input_tokens` (see
 * computeAnthropicCallCostUsd above, which already reads these). If a
 * real call's `cache_creation_input_tokens` and `cache_read_input_tokens`
 * both read 0, the prefix did NOT meet the minimum — that observation
 * always overrides this classification.
 *
 * @param {number|null} estimatedTokens
 * @param {string} model
 * @returns {'likely-eligible'|'likely-ineligible'|'unresolved'}
 */
export const classifyCacheEligibility = (estimatedTokens, model) => {
  const minimum = CACHE_MINIMUM_TOKENS[model];
  if (estimatedTokens == null || !minimum) return 'unresolved';
  const band = minimum * CACHE_ELIGIBILITY_UNRESOLVED_BAND;
  if (estimatedTokens > minimum + band) return 'likely-eligible';
  if (estimatedTokens < minimum - band) return 'likely-ineligible';
  return 'unresolved';
};

/**
 * ESTIMATED token count of the reusable cached prefix (system prompt
 * blocks up to and including the cache_control breakpoint) via
 * Anthropic's countTokens API — NOT an authoritative cache measurement.
 * Per Anthropic's own documentation
 * (platform.claude.com/docs/en/build-with-claude/token-counting,
 * retrieved 2026-08-08): "The token count is an estimate. In some cases,
 * the actual number of input tokens used when creating a message might
 * differ by a small amount," counts "may include tokens added
 * automatically by Anthropic for system optimizations," and critically,
 * "token counting provides an estimate without using caching logic" —
 * it does not simulate or confirm caching behavior at all.
 *
 * Actual cache behavior is ALWAYS read from a real call's response
 * `usage` block, never from this function — this exists purely to
 * diagnose, ahead of time, whether a prefix is materially above or below
 * a model's cache minimum. See classifyCacheEligibility.
 *
 * Character length is a cheap diagnostic only — never a token-count or
 * cache-eligibility proxy. Real token counts depend on tokenizer
 * behavior a character count doesn't capture.
 *
 * Never throws: on any countTokens failure, logs once and returns null
 * so a transient API issue against this side-channel audit call can
 * never affect the real (already-completed) model response it's
 * measuring.
 *
 * @param {import('@anthropic-ai/sdk').default} client
 * @param {string} model
 * @param {Array<{type: 'text', text: string}>} systemBlocks
 * @param {string} gitSha
 * @returns {Promise<number|null>}
 */
export const getEstimatedStaticPrefixTokens = async (client, model, systemBlocks, gitSha) => {
  const combinedText = systemBlocks.map((b) => b.text).join('\n');
  const promptHash = hashPromptText(combinedText);
  const cacheKey = `${model}:${gitSha ?? 'unknown'}:${promptHash}`;
  if (estimatedStaticPrefixTokenCache.has(cacheKey)) {
    return estimatedStaticPrefixTokenCache.get(cacheKey);
  }
  try {
    const result = await client.messages.countTokens({
      model,
      system: systemBlocks,
      messages: [{ role: 'user', content: [{ type: 'text', text: '' }] }],
    });
    const count = result.input_tokens;
    estimatedStaticPrefixTokenCache.set(cacheKey, count);
    return count;
  } catch (err) {
    console.log(`[cache-audit] estimated-static-prefix-tokens-failed model=${model} err=${err?.message ?? 'unknown'}`);
    return null;
  }
};
