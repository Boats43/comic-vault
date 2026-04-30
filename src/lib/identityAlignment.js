// Ship #20a.6.7c — Identity Alignment
//
// Cross-reference Vision, eBay image search, PriceCharting, and ComicVine
// to determine the most accurate title before pricing queries run.
//
// Trust hierarchy:
// 1. eBay image search (matched actual cover image)
// 2. Vision + text source agreement (PC or CV)
// 3. Vision only (flagged if low confidence)

export function alignIdentity({
  visionTitle,
  visionIssue,
  visionYear,
  visionConfidence,
  ebayImageResults,
  pcProductName,
  cvVolumeName,
}) {
  // Build consensus from eBay image search
  const ebayConsensus = buildEbayConsensus(ebayImageResults);

  // Token overlap helper
  const overlap = (a, b) => {
    if (!a || !b) return 0;
    const ta = tokenize(a);
    const tb = tokenize(b);
    const matches = ta.filter((t) => tb.includes(t));
    return matches.length / Math.max(ta.length, 1);
  };

  // eBay image search = highest trust (visual match)
  if (ebayConsensus && overlap(ebayConsensus, visionTitle) < 0.5) {
    // eBay and Vision disagree
    // eBay wins — it matched the actual image
    return {
      confirmedTitle: ebayConsensus,
      confirmedSource: 'ebay_image',
      overrodeVision: true,
      visionWas: visionTitle,
      confidence: 'HIGH',
    };
  }

  // PC and CV agree with Vision
  const textSources = [pcProductName, cvVolumeName].filter(Boolean);
  const agreements = textSources.filter((s) => overlap(s, visionTitle) >= 0.5);

  if (agreements.length >= 1) {
    return {
      confirmedTitle: visionTitle,
      confirmedSource: 'vision+text',
      overrodeVision: false,
      confidence: 'HIGH',
    };
  }

  // Nothing aligns strongly
  // Keep Vision but flag low confidence
  const visionConfLower = String(visionConfidence || 'low').toLowerCase();
  let finalConfidence = 'LOW';
  if (visionConfLower === 'high') {
    finalConfidence = 'MEDIUM';
  } else if (visionConfLower === 'medium') {
    finalConfidence = 'MEDIUM';
  }
  return {
    confirmedTitle: visionTitle,
    confirmedSource: 'vision_only',
    overrodeVision: false,
    confidence: finalConfidence,
    needsReview: visionConfLower !== 'high',
  };
}

function buildEbayConsensus(items) {
  if (!items?.length) return null;
  // Extract series titles from eBay results
  // Find most common (≥2 agree)
  const titles = items.map((i) => i.title).filter(Boolean);
  const freq = {};
  titles.forEach((t) => {
    freq[t] = (freq[t] || 0) + 1;
  });
  const entries = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  return top?.[1] >= 2 ? top[0] : null;
}

function tokenize(str) {
  if (!str) return [];
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

// Extract issue number from eBay image results consensus
export function extractIssueFromEbayResults(items) {
  if (!items?.length) return null;
  const issues = items
    .map((i) => {
      const m = String(i.title || '').match(/#\s*(\d+)/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
  if (issues.length === 0) return null;
  // Find most common issue
  const freq = {};
  issues.forEach((iss) => {
    freq[iss] = (freq[iss] || 0) + 1;
  });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  return top?.[1] >= 2 ? top[0] : null;
}
