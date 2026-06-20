# Prompt Caching Investigation — Anthropic API Usage

**Date:** 2026-06-20  
**Finding:** Zero prompt caching currently enabled (cache_write and cache_read columns all 0)

## Summary

**No `cache_control` parameters used anywhere in the codebase.**

Anthropic API calls send large repeated context on every scan:
- System prompts (static, ~3.5K chars)
- Grade instructions (static, ~1.5K tokens)
- AI verify prompt template (static, ~200 tokens)
- Test-market variant lists (static, ~400 lines)

**Enabling prompt caching on static content could reduce input token cost by 50-80% on those portions.**

---

## Anthropic API Call Sites

**5 files make API calls:**

1. **api/grade.js** — Vision grading (Opus 4.7)
2. **api/enrich.js** — AI verify comp matching (Haiku 4.5)
3. **src/lib/claudeCheck.js** — Quality check (Haiku 4.5 or Sonnet 4.5)
4. **api/chat.js** — Collection chat (Sonnet 4.5)
5. **api/manage.js** — Collection analysis (Sonnet 4.5)

**None use `cache_control` parameter.**

---

## Largest Repeated Context Blocks

### 1. STANDARD_PROMPT (api/grade.js:19-20)

**Size:** ~3,500 characters (~1,500 tokens)  
**Frequency:** Every comic scan (Opus 4.7 call)  
**Content:** Static instructions for Vision grading

**Excerpt:**
```javascript
const STANDARD_PROMPT =
  `Grade this comic book. Return ONLY this JSON shape with no markdown, 
  no commentary: ${JSON_SHAPE}. title is the series name WITHOUT the 
  issue number (e.g. "Amazing Spider-Man" not "Amazing Spider-Man #300"). 
  CRITICAL: Return ONLY the comic series name in the title field...`
```

**Static parts:**
- JSON shape description
- Field-by-field instructions (title, issue, year, grade, variant, creator, etc.)
- CGC penalty flags instructions (5 nested fields)
- Variant identification patterns (ratio, artist, cover letter, print, price, special editions)
- Premium creator list (20+ artists)
- Pedigree list (22 recognized pedigrees)

**Cacheable:** YES ✅  
**Est. token savings:** ~1,200 tokens per scan (90% reduction on prompt portion)

---

### 2. TEST_MARKET_VARIANTS Map (api/enrich.js:127-270)

**Size:** ~400 lines (~800 tokens)  
**Frequency:** Every enrich call (loaded into memory but not sent to API)  
**Content:** Static allowlists for 35¢ and 30¢ Marvel test-market variants

**NOT sent to Anthropic API** — this is server-side lookup only.

**Cacheable:** N/A (not sent to API)

---

### 3. AI Verify Prompt Template (api/enrich.js:305-319)

**Size:** ~200 characters (~80 tokens)  
**Frequency:** Every enrich call when comp verification runs  
**Content:** Static instructions for comp matching

**Example:**
```javascript
const prompt =
  `I identified this comic: ${comicLabel}${publisherPart}.\n\n` +
  `These are eBay listings returned as price comps:\n${numbered}\n\n` +
  `For each listing reply with MATCH or NO_MATCH. MATCH if the ` +
  `listing is clearly the same comic — same title, same issue number, ` +
  `same era...`
```

**Static parts:**
- Instructions for matching logic
- Year tolerance guidance (±1-2 years)
- Variant acceptance rules
- JSON output format

**Dynamic parts:**
- `${comicLabel}` — changes per comic
- `${publisherPart}` — changes per comic
- `${numbered}` — comp listing titles (changes per comic)

**Cacheable:** Partially ✅  
- Split static instructions into system message with `cache_control`
- Keep dynamic parts in user message
- **Est. savings:** ~60 tokens per verify call (75% reduction on instruction portion)

---

### 4. Claude Check Prompt (src/lib/claudeCheck.js:92-140)

**Size:** ~300 characters (~120 tokens)  
**Frequency:** Every enrich call (Ship #21 quality check)  
**Content:** Static verification instructions

**Example:**
```javascript
system: "You are a comic book expert and pricing analyst. Review this 
complete record for accuracy. Be concise. Respond in JSON only."
```

**Static parts:**
- System message
- Verification checklist
- JSON response schema

**Dynamic parts:**
- Comic data (title, grade, price bands, sold comps, active comps)

**Cacheable:** YES ✅  
**Est. savings:** ~100 tokens per check (85% reduction on system prompt)

---

### 5. Collection Chat System Prompt (api/chat.js)

**Size:** Unknown (need to read file)  
**Frequency:** Per chat message  
**Content:** Likely static instructions + collection context

**Need to investigate:** Check if collection data is sent on every message

**Potentially cacheable:** System prompt portion

---

## Caching Opportunity Summary

| Call Site | Frequency | Static Tokens | Cacheable? | Est. Savings |
|-----------|-----------|---------------|------------|--------------|
| Vision grading (STANDARD_PROMPT) | Per scan | ~1,500 | ✅ YES | ~1,200 tokens/scan |
| AI verify instructions | Per enrich | ~80 | ✅ PARTIAL | ~60 tokens/enrich |
| Claude check system prompt | Per enrich | ~120 | ✅ YES | ~100 tokens/enrich |
| Collection chat system | Per message | Unknown | ✅ LIKELY | TBD |
| Collection analysis | Per analysis | Unknown | ✅ LIKELY | TBD |

**Total estimated savings per comic scan:**
- Vision: 1,200 tokens (cached prompt)
- Enrich: 160 tokens (AI verify + claude-check)
- **Per-scan savings: ~1,360 tokens input** (first call writes to cache, subsequent calls read from cache)

**Anthropic pricing (as of 2025):**
- Cache write: ~$3.75 per 1M tokens (25% of base input)
- Cache read: ~$0.30 per 1M tokens (10% of cache write)
- Standard input: ~$15 per 1M tokens

**ROI calculation (1,000 scans/day):**
- Without caching: 1,360 tokens × 1,000 × $15/1M = **$20.40/day input**
- With caching (after first scan):
  - Cache read: 1,360 tokens × 999 × $0.30/1M = **$0.41/day**
  - Cache write: 1,360 tokens × 1 × $3.75/1M = **$0.01/day**
  - **Total: $0.42/day = 98% savings** on cached portion

**Caveat:** Cache has 5-minute TTL. If scans are >5min apart, every scan pays cache write cost.

---

## How to Enable Prompt Caching

**Anthropic Messages API supports prompt caching via `cache_control` breakpoints.**

### Example: Vision Grading

**Current (api/grade.js:270):**
```javascript
const message = await client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: [
        { type: "image", source: { ... } },
        { type: "text", text: STANDARD_PROMPT }
      ]
    }
  ]
});
```

**With caching:**
```javascript
const message = await client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 4096,
  system: [
    {
      type: "text",
      text: STANDARD_PROMPT,
      cache_control: { type: "ephemeral" }  // ← Cache this block
    }
  ],
  messages: [
    {
      role: "user",
      content: [
        { type: "image", source: { ... } }
      ]
    }
  ]
});
```

**Key changes:**
1. Move static prompt to `system` array
2. Add `cache_control: { type: "ephemeral" }` to cacheable blocks
3. Keep dynamic content (image, comic-specific data) in `messages`

---

## Implementation Plan (NOT IMPLEMENTED)

### Phase 1: Vision Grading Cache

**File:** api/grade.js  
**Change:** Move STANDARD_PROMPT to system message with cache_control

**Impact:**
- ~1,200 tokens/scan saved (after first scan)
- 5-minute TTL → works well for batch scanning sessions
- Does NOT help for isolated single scans >5min apart

---

### Phase 2: AI Verify Cache

**File:** api/enrich.js:305-319  
**Change:** Split static instructions into system message with cache_control

**Impact:**
- ~60 tokens/enrich saved
- Smaller benefit (instruction template is shorter)

---

### Phase 3: Claude Check Cache

**File:** src/lib/claudeCheck.js  
**Change:** Add cache_control to system message

**Impact:**
- ~100 tokens/check saved
- Already uses system message, just needs cache_control flag

---

## Caveats & Considerations

### 1. Cache TTL is 5 minutes
- Only beneficial for batch scanning (multiple scans within 5 min)
- Single isolated scans still pay full cache write cost
- **Best for:** Watch Mode, bulk imports, collection refreshes

### 2. Cache write cost is 25% of base input
- First scan of a session pays cache write (~$3.75/1M tokens)
- Subsequent scans within 5 min pay cache read (~$0.30/1M tokens)
- **Break-even:** 2 scans within 5 minutes

### 3. Dynamic content cannot be cached
- Image data (varies per scan)
- Comic-specific fields (title, issue, year)
- Comp listings (varies per comic)

### 4. Version changes invalidate cache
- Changing STANDARD_PROMPT → all caches invalidate
- Must be careful with prompt iteration during development

---

## Recommendation

**Enable prompt caching for STANDARD_PROMPT (Vision grading) ONLY.**

**Reasons:**
1. **Largest static block** (~1,500 tokens)
2. **Highest frequency** (every scan)
3. **Best ROI** (98% savings on cached portion in batch mode)
4. **Low risk** (system message pattern is well-tested)

**Skip for now:**
- AI verify (small template, ~80 tokens)
- Claude check (small system prompt, ~120 tokens)
- Collection chat (unknown usage pattern)

**ROI for Vision caching alone:**
- Batch scanning (10+ scans in 5 min): **~98% savings** on prompt portion
- Isolated scans: **~0% savings** (pay cache write every time)

**Net benefit:** Positive for active scanning sessions, neutral for isolated scans.

---

## Files That Would Need Changes

**To enable Vision grading cache:**
1. `api/grade.js:270` — Move STANDARD_PROMPT to system array with cache_control
2. `api/grade.js:329` — Same for Watch Mode Sonnet call
3. `api/grade.js:442` — Same for self-correction Opus call

**3 API call sites, same pattern for each.**

---

## Summary

**Current state:** Zero prompt caching enabled  
**Largest opportunity:** Vision STANDARD_PROMPT (~1,500 tokens/scan)  
**Estimated savings:** 98% on cached portion for batch scans  
**Implementation effort:** Small (3 call sites, same pattern)  
**Risk:** Low (system message pattern is standard)  

**Next step:** Enable caching for STANDARD_PROMPT in api/grade.js (deferred until user approves).
