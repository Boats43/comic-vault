/**
 * Claude Quality Check - Ship #21
 *
 * Haiku call to verify data alignment and provide recommendation.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Build the verification prompt from assembled data.
 * Ship #26: Add web search mode when rawComps=0 (no eBay comp data).
 */
function buildVerificationPrompt(data) {
  const {
    title,
    issue,
    year,
    publisher,
    variant,
    grade,
    numericGrade,
    conditionSummary,
    keyIssue,
    creators,
    priceBands,
    soldComps,
    activeComps,
    pop,
    demandSignals,
    // Ship #26: web search trigger flags
    needsWebSearch,
    rawCompsCount,
    pricingSource
  } = data;

  // Format sold comps
  const soldLines = (soldComps || []).slice(0, 3).map(s =>
    `  ${s.title} $${s.price} ${s.daysAgo}d ago`
  ).join('\n') || '  (none)';

  // Format active comps
  const activeLines = (activeComps?.prices || []).slice(0, 3).map(p =>
    `  $${(Number(p) || 0).toFixed(2)}`
  ).join('\n') || '  (none)';

  // Format creators (Ship #27: cap to 2 for token reduction)
  const creatorLines = (creators || []).slice(0, 2).map(c =>
    `  ${c.name}${c.role ? ` (${c.role})` : ''}`
  ).join('\n') || '  (unknown)';

  // Ship #26: web search mode when rawComps=0
  // Ship #27: Return only dynamic data (static instructions moved to runClaudeCheck)
  if (needsWebSearch) {
    return `BOOK: ${title}${issue ? ` #${issue}` : ''} ${year || '?'} ${publisher || '?'}
VARIANT: ${variant || 'standard'}
GRADE: ${grade || 'unknown'}${numericGrade ? ` (${numericGrade})` : ''}

NO EBAY COMP DATA AVAILABLE (rawComps=0).

Use web search to find current sold and active eBay listings for this exact book.

Search for: site:ebay.com/itm "${title}${issue ? ` #${issue}` : ''}" ${year || ''} sold

Extract from results:
- Recent sold prices (prefer last 30 days)
- Active listing prices
- Typical price range for this grade/condition

KEY ISSUE: ${keyIssue || 'None identified'}
CREATORS:
${creatorLines}`;
  }

  // Standard verification mode (comp data available)
  // Ship #27: Return only dynamic data (static instructions moved to runClaudeCheck)
  return `BOOK: ${title}${issue ? ` #${issue}` : ''} ${year || '?'} ${publisher || '?'}
VARIANT: ${variant || 'standard'}
GRADE: ${grade || 'unknown'}${numericGrade ? ` (${numericGrade})` : ''}

CONDITION REPORT:
${conditionSummary || 'No condition details available'}

KEY ISSUE: ${keyIssue || 'None identified'}
CREATORS:
${creatorLines}

PRICE BANDS:
Quick: ${priceBands?.quick || 'N/A'} | Market: ${priceBands?.market || 'N/A'} | Stretch: ${priceBands?.stretch || 'N/A'}
Source: ${priceBands?.source || 'unknown'} (${priceBands?.count || 0} comps)

TOP SOLD COMPS:
${soldLines}

TOP ACTIVE COMPS:
${activeLines}

CGC POP: ${pop?.total || '?'} copies tracked${pop?.atGrade ? `, ${pop.atGrade} at this grade` : ''}

DEMAND: ${demandSignals?.velocity || '?'} velocity, ${demandSignals?.trend || '?'} trend, ${demandSignals?.liquidity || '?'} liquidity`;
}

// Ship #27: Static instructions for prompt caching (cacheable block)
// FIX 3: Binary checklist for deterministic verification (temp=0 + factual yes/no)
const STATIC_INSTRUCTIONS = `Answer each question with EXACTLY "YES" or "NO" based on the data provided.
No interpretation, no judgment calls — count and compare only.

Q1. TITLE MATCH: Do 80% or more of the sold comp titles contain the same series name as the stated title?
    Count comps with matching series name. If ≥80% match → YES. Otherwise → NO.

Q2. YEAR CONSISTENCY: Do 80% or more of the comp listings fall within ±2 years of the stated year?
    Count comps within year±2 range. If ≥80% within range → YES. Otherwise → NO.

Q3. KEY ISSUE PRESENCE: If a key issue is stated, does it appear in 50% or more of comp titles?
    If no key stated, answer YES. If key stated, count comps mentioning it. If ≥50% mention → YES. Otherwise → NO.

Q4. PUBLISHER CONSISTENCY: Is the stated publisher mentioned in 80% or more of comps?
    Count comps referencing this publisher. If ≥80% match → YES. Otherwise → NO.

Return ONLY this JSON structure with boolean values:
{
  "q1_title_match": true/false,
  "q2_year_consistent": true/false,
  "q3_key_issue_present": true/false,
  "q4_publisher_consistent": true/false,
  "recommendation": "SELL_RAW|PRESS|CGC|HOLD",
  "suggestedListingTitle": "exact eBay title"
}

DO NOT add narrative, flags, or explanations. Answer the 4 questions with true/false only.`;

const WEB_SEARCH_INSTRUCTIONS = `Provide your best price estimate based on web search evidence.

JSON response:
{
  "verified": true/false,
  "flags": [{"message": "specific issue", "severity": "CRITICAL|WARNING"}],
  "web_price": <your estimate in dollars, number only>,
  "web_source": "ebay_sold|ebay_active|estimate",
  "web_confidence": "HIGH|MEDIUM|LOW",
  "web_evidence": "brief description of what you found (max 100 chars)",
  "recommendation": "SELL_RAW|PRESS|CGC|HOLD",
  "recommendationReason": "one sentence",
  "suggestedListingTitle": "exact eBay title",
  "confidence": "HIGH|MEDIUM|LOW"
}

Flag severity rules:
- CRITICAL: Cross-title price contamination, wrong category comps, volume mismatch, identity failure
- WARNING: Title variant differences, story metadata corruption, minor publisher disambiguation`;

/**
 * Call Claude Haiku to verify data and provide recommendation.
 */
export async function runClaudeCheck(data) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[claude-check] skipped — no API key');
    return null;
  }

  const needsWebSearch = data.needsWebSearch;

  // Ship #26: Web search timeout — 20s for web search (Sonnet 4 + tool), 30s for standard
  const TIMEOUT_MS = needsWebSearch ? 20000 : 30000;

  try {
    const dynamicPrompt = buildVerificationPrompt(data);
    const staticInstructions = needsWebSearch ? WEB_SEARCH_INSTRUCTIONS : STATIC_INSTRUCTIONS;

    // Ship #26: Sonnet 4.5 with web search tool for zero-comp pricing
    const modelConfig = needsWebSearch
      ? {
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2048,
          system: "You are a comic book expert and pricing analyst. When comp data is unavailable, use web search to find current eBay sold/active listings and provide a price estimate. Be concise. Respond in JSON only.",
          tools: [{
            type: "web_search_20250305",
            name: "web_search"
          }]
        }
      : {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: "You are a comic book expert and pricing analyst. Review this complete record for accuracy. Be concise. Respond in JSON only.",
        };

    // Ship #27: Prompt caching — static instructions cached, dynamic data fresh
    // Create API call with timeout wrapper
    // FIX 1: temperature=0 for deterministic output (Incredible Hulk #181 non-determinism bug)
    const apiCallPromise = anthropic.messages.create({
      ...modelConfig,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: staticInstructions,
              cache_control: { type: "ephemeral" }
            },
            {
              type: "text",
              text: dynamicPrompt
            }
          ]
        }
      ]
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    );

    const message = await Promise.race([apiCallPromise, timeoutPromise]);

    const responseText = message.content[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[claude-check] no JSON in response:', responseText);
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);

    // FIX 3: Deterministic scoring from binary checklist responses
    // AI answered 4 factual yes/no questions. Now compute decision deterministically.
    if (result.q1_title_match !== undefined) {
      // Binary checklist mode (Fix 3)
      const score = [
        result.q1_title_match,
        result.q2_year_consistent,
        result.q3_key_issue_present,
        result.q4_publisher_consistent
      ].filter(Boolean).length;

      // Deterministic scoring rules
      if (score === 4) {
        result.verified = true;
        result.flags = [];
        result.confidence = 'HIGH';
      } else if (score === 3) {
        result.verified = true;
        result.flags = [{
          message: 'One verification check failed — manual review recommended',
          severity: 'WARNING'
        }];
        result.confidence = 'MEDIUM';
      } else {
        // score <= 2
        result.verified = false;
        const failedChecks = [];
        if (!result.q1_title_match) failedChecks.push('title mismatch');
        if (!result.q2_year_consistent) failedChecks.push('year inconsistency');
        if (!result.q3_key_issue_present) failedChecks.push('key issue not verified');
        if (!result.q4_publisher_consistent) failedChecks.push('publisher mismatch');
        result.flags = [{
          message: `CRITICAL: Identity verification failed (${failedChecks.join(', ')})`,
          severity: 'CRITICAL'
        }];
        result.confidence = 'LOW';
      }

      console.log(
        `[claude-check] binary checklist score=${score}/4 ` +
        `verified=${result.verified} ` +
        `confidence=${result.confidence} ` +
        `(q1=${result.q1_title_match} q2=${result.q2_year_consistent} ` +
        `q3=${result.q3_key_issue_present} q4=${result.q4_publisher_consistent})`
      );
    } else {
      // Legacy response format (backward compatibility)
      console.log(
        `[claude-check] verified=${result.verified} ` +
        `recommendation=${result.recommendation} ` +
        `confidence=${result.confidence}` +
        (result.flags?.length > 0 ? ` flags=${result.flags.join(', ')}` : '')
      );
    }

    return result;
  } catch (err) {
    // Ship #26 hotfix: Graceful fallback for web search errors
    if (needsWebSearch) {
      if (err.message === 'timeout') {
        console.error(`[web-search] timeout after ${TIMEOUT_MS/1000}s — skipping web search fallback`);
      } else {
        console.error(`[web-search] failed: ${err?.message || err} — skipping web search fallback`);
      }
      // Return null to fall through to refused-no-data-sources gracefully
      return null;
    }

    // Standard claude-check error (not web search mode)
    console.error(`[claude-check] error: ${err?.message || err}`);
    return null;
  }
}
