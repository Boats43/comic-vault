# Comic Vault Session Archive

## Recent Ships (Last 7 — extracted from CLAUDE.md 2026-07-10)

| Hash | Ship | Summary |
|------|------|---------|
| 46fada1 | fix | CV-VOLUME [P2]: Era-gate CV story fetch (>10y drift suppression) |
| 1b2097f | feat | Q58-TITLE [P2]: Title backfill from comp consensus (≥80%, ≥4 comps) |
| f907aa1 | fix | Q70 [P0]: Route Vision sanitizer through Q54 whitelist (X-Men class) |
| 84c249c | fix | Q68 + P3 + CUSTOMER-GRADE STANDARD [P0] (refuse-state coherence) |
| 383975a | fix | Q69 [P0] + Q67 [P0]: tier-2.5 fix + polybag cap |
| 4b40610 | feat | Ship #22g [P1]: convergence card UI |
| cb90ae6 | feat | Ship #22d [P1]: TIER-0 expansion + convergence lock |

## Session 6/20/26: Pricing investigation complete (7 commits)

- FIX 1: Year backfill from eBay comp consensus (1abac22, a5e1a22)
- FIX 2: Sold avg displayed separately from active listings (06468e7)
- FIX 3: CGC detection cost-aware calculation (df4d6c5, 83deb41)
- ISSUE 6: Grade-proximity filter fix for raw vintage comics (e96ea3d)
- Prompt caching: STANDARD_PROMPT/WATCH_PROMPT/BOOK_PROMPT system cache (0006d78)
- Floor display fix: sold vs active markets when recommended < floor (19b0984)

## Session 6/21/26: Pipeline hardening — accuracy + resilience + cost (7 commits) ✅

- P0-B: AI comp verify gated on refresh (55c4e16) — 600 tokens per refresh stopped
- P0 Token drain: claudeCheck cached on refresh (dabc281) — 90%+ Sonnet savings
- Story-only fix: wrong edition clears story, never nulls verified comps (4ebd6c0)
- Write-back guard: better data never replaced by worse (b1b2750)
- Aggressive caching: CV/PC 24h, GoCollect 24h, active comps 1h (6549578) — 95% API savings
- Web search timeout: log fix (was correct 20s, message said 8s) (ccc7936)
- Diagnostics: AI verify, web search, sold rejection logging (a8fae30, 55c4e16)
- **Phase 3B correction:** Web search timeout was ALWAYS 20s (line 155), Phase 3B investigation was wrong. Only the error log was incorrect ("8s" hardcoded).

## Session 7/5-7/6: Convergence + identity hygiene + accuracy fixes (15 commits)

- Ship #22c [P1]: AXIS VOTING convergence score (deployed, runs every scan, logs [22c] convergence=N)
- Ship #22d [P1]: TIER-0 convergence lock (mega-key gate, <70 score blocks listing)
- Ship #22e [P1]: Assembly integrity check (22e-LOSS fired production 7/5 X-Men class)
- Ship #22f [P1]: Title hygiene extraction ([22f] metadata-stripped firing production)
- Ship #22g [P1]: Convergence card UI (live, awaiting mega-key scan trigger)
- Q70 [P0]: Vision sanitizer Q54 whitelist routing (X-Men "x" preservation)
- Q68 [P0]: Refuse-state coherence (customer-grade standard)
- Q69 [P0]: Tier-2.5 $250-330 fix (Action #33 class)
- Q67 [P0]: Polybag cap $9 (B&B #28 Loot Crate class)
- Q64 [P1]: Tier-2.5 stale-sold pricing (Jungle Comics #54)
- Q58-TITLE [P2]: Title backfill from comp consensus (Challengers #65 class)
- CV-VOLUME [P2]: Era-gate CV story >10y drift (X-Men #25 2010 vol.3 suppression)

## Session 3B (2026-06-05): AssetCore Extraction ✅ Complete

- AssetCore extraction complete (18/18 TODOs resolved)
- identityCore.js — 5 universal identity resolvers
- pricingEngine.js — 9 universal pricing helpers
- ComicAdapter.js — 312 lines, all comic domain knowledge
- enrich.js reduced 4,642 → 3,938 lines (-15%)
- Zero regressions, 48/48 title-sanitization tests passing

## Session Catalog (earliest → latest)

- SESSION_2026_05_06.md — Early development session
- SESSION_2026_05_07_DECISION_ENGINE.md — Decision Engine v0 launch
- SHIP_6_POLYBAG.md — Polybag pricing gate
- (See docs/archive/ for full session transcripts)

## Open Items (as of 2026-07-10)

- **Q65 [P2]:** Invincible #19 ≤$60/REVIEW gate (C4 queue, modern-premium slab filter DEPLOYED + proven removed=2-33 lines production)
- Variant fallback for thin markets (Batman LOTDK #62 foil: 0/5 kept, need fallback pool)
  - Architecture confirmed: belongs in soldVerification.js (has rawRows + reasons)
  - Pattern: if verified=0 AND variantMismatch>0, re-run WITHOUT variant filters
  - Awaiting greenlight before implementing
- Future cache: Vercel KV for cross-session persistence (in-memory resets on cold start)
- Pagination/virtualization at 500+ books
- ComicVine rate limit handling (200/hr cap, request queue with throttle)

## External Blockers

- **GoCollect API key #019483** — pending since 2026-04-15.
- **eBay Marketplace Insights API** — gated for indie devs (DEAD).
- **eBay Finding API** — rate-limited 100% as of late April 2026, bypassed.

## Workaround Active

- PriceCharting sales-history scrape (Ship #20a foundation data layer).
