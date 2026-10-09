# Haiku 5.5 disposition — REJECT migration for this cycle

Ruled 2026-10-09. Investigation and benchmark were read-only; no API calls, no spend, no code, no routing change. Haiku 5.5 (`claude-haiku-5-5`, released 2026-10-07) is NOT adopted anywhere. Do not build a benchmark harness, provision keys, run shadow calls, or change model routing for it.

**Reconsider only after BOTH:** (1) the certified grading calibration campaign has completed (`docs/GRADING-CAMPAIGN.md` — a model change mid-campaign breaks cohort integrity), and (2) a demonstrated latency or cost benefit exists for a specific lane (measured Production speed baseline, not list price).

## Why (evidence from the investigation)
- No ground-truth corpus: `tests/fixtures/real-captures` are frozen engine output ("no ground truth"), `prediction-vs-label` has 3 records with model/prompt `UNKNOWN`. Usable certified grading examples: zero.
- The grade-only lane (Haiku 4.5, `HAIKU_EBAY_CONSENSUS`), Sonnet vision fallback and Opus watch escalation carry grade/identity authority and may not be touched.

## Migration prerequisites (banked, from the completed investigation)
1. `src/lib/claudeCheck.js:193` sends `temperature: 0` — a 400 on Haiku 5.5 (only `temperature` 1 / `top_p` 0.99 / no `top_k` accepted; both together rejected). Needs a replacement determinism strategy first.
2. Adaptive thinking is on by default and thinking tokens count against `max_tokens`; current limits (512 `enrich`, 1024 `grade`, 800 chat) can end on `max_tokens` after a thinking block with no text. Set `effort` explicitly (likely `low`) and raise limits. Select content blocks by `type` (already done in `callModel` / `enrich`).
3. New `stop_reason: "refusal"`, no server-side fallback — no call site handles it.
4. `src/lib/anthropicPricing.js` has no row for `claude-haiku-5-5` and no >100K-token price tier ($0.50/$2.50 above 100K vs $0.10/$0.50); also `CACHE_MINIMUM_TOKENS`. Unknown-model cost must fail observably first (see the unknown-cost design).
5. ~30% more tokens for the same text; images move to a high-resolution tier (up to ~2.5× visual tokens vs Haiku 4.5 depending on `resizeImageForVision` output — not checked). Recount with `model: claude-haiku-5-5`.
6. Provenance must record requested AND provider-reported model before any model change (grade receipts hardcode call-site strings today).
7. Prefill / forced `tool_choice` / `budget_tokens` / thinking-block replay: not used by the audited call sites. `web_search_20250305` compatibility on Haiku 5.5 is unverified (affects `researchMarket`).
8. Priority Tier is not supported on Haiku 5.5. Bedrock lacks structured outputs for it.
9. Possible tangent: `CACHE_MINIMUM_TOKENS` states 4,096 for Haiku 4.5 while the grade system prompt is ~1.5K tokens — the Haiku lane may never be caching today. Verify from `usage.cache_creation_input_tokens` before attributing any cost change to a model.

Sources: platform.claude.com/docs/en/models/haiku-5-5/{overview,migration-guide}.

## Update 2026-10-09 — item 9 (cache effectiveness) investigated read-only
Not a Haiku-5.5 argument by itself: the Haiku 4.5 grade-only and WATCH cached blocks are an estimated ~1.5-1.7K tokens against a documented 4,096-token minimum (likely-ineligible, unobserved). No usage data is persisted, so cache behavior is "insufficient usage evidence" rather than "confirmed no cache". Details and the evidence table: `docs/GRADING-CAMPAIGN.md`, "Cache effectiveness". Haiku 5.5's 512-token minimum would make these prompts eligible, but that is not a reason to migrate this cycle (REJECTED).

## Cache classification (final wording, 2026-10-09)
**HAIKU 4.5 GRADE CACHE — STRUCTURALLY INELIGIBLE UNDER THE INSPECTED REQUEST CONSTRUCTION.** Basis: estimated ~1.5K-token cached prefix (not a provider token count) vs the documented 4,096-token Haiku 4.5 minimum, plus per-book consensus data inside the cache-controlled block. This is a structural finding, not a historical production-wide measurement; the ≈$0.004/grade-call baseline is not decomposed and no cost/latency penalty is claimed. **Reconsideration condition:** Haiku 5.5's 512-token threshold may make a restructured stable prefix eligible — only after certified calibration and explicit model-evaluation authorization. Closed for this cycle: no prompt, caching, or migration change. Full evidence: `docs/GRADING-CAMPAIGN.md`.
