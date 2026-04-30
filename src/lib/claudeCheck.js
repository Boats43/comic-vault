/**
 * Claude Quality Check - Ship #21
 *
 * Haiku call to verify data alignment and provide recommendation.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Build the verification prompt from assembled data.
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
    storyDescription,
    creators,
    priceBands,
    soldComps,
    activeComps,
    pop,
    demandSignals
  } = data;

  // Format sold comps
  const soldLines = (soldComps || []).slice(0, 3).map(s =>
    `  ${s.title} $${s.price} ${s.daysAgo}d ago`
  ).join('\n') || '  (none)';

  // Format active comps
  const activeLines = (activeComps?.prices || []).slice(0, 3).map(p =>
    `  $${p.toFixed(2)}`
  ).join('\n') || '  (none)';

  // Format creators
  const creatorLines = (creators || []).slice(0, 3).map(c =>
    `  ${c.name}${c.role ? ` (${c.role})` : ''}`
  ).join('\n') || '  (unknown)';

  return `BOOK: ${title}${issue ? ` #${issue}` : ''} ${year || '?'} ${publisher || '?'}
VARIANT: ${variant || 'standard'}
GRADE: ${grade || 'unknown'}${numericGrade ? ` (${numericGrade})` : ''}

CONDITION REPORT:
${conditionSummary || 'No condition details available'}

KEY ISSUE: ${keyIssue || 'None identified'}
STORY: ${storyDescription || 'No story description available'}
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

DEMAND: ${demandSignals?.velocity || '?'} velocity, ${demandSignals?.trend || '?'} trend, ${demandSignals?.liquidity || '?'} liquidity

VERIFY ALL OF THE FOLLOWING:
1. Do sold/active comps match this exact book?
2. Is grade consistent with condition described?
3. Are price bands reasonable for this grade/era?
4. Is key issue description accurate for THIS issue?
5. What is your recommendation?

JSON response:
{
  "verified": true/false,
  "flags": ["specific issue if any"],
  "gradeConsistent": true/false,
  "compsAccurate": true/false,
  "pricingReasonable": true/false,
  "keyIssueAccurate": true/false,
  "recommendation": "SELL_RAW|PRESS|CGC|HOLD",
  "recommendationReason": "one sentence",
  "suggestedListingTitle": "exact eBay title",
  "confidence": "HIGH|MEDIUM|LOW"
}`;
}

/**
 * Call Claude Haiku to verify data and provide recommendation.
 */
export async function runClaudeCheck(data) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[claude-check] skipped — no API key');
    return null;
  }

  try {
    const prompt = buildVerificationPrompt(data);

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: "You are a comic book expert and pricing analyst. Review this complete record for accuracy. Be concise. Respond in JSON only.",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const responseText = message.content[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[claude-check] no JSON in response:', responseText);
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);

    console.log(
      `[claude-check] verified=${result.verified} ` +
      `recommendation=${result.recommendation} ` +
      `confidence=${result.confidence}` +
      (result.flags?.length > 0 ? ` flags=${result.flags.join(', ')}` : '')
    );

    return result;
  } catch (err) {
    console.error(`[claude-check] error: ${err?.message || err}`);
    return null;
  }
}
