// Ship #24 — Identity Authentication Score
//
// Cross-reference Vision, eBay image search, PriceCharting, ComicVine, and CGC
// to validate ALL identity fields (title, issue, year, publisher) and produce
// a 0-100 authentication score.
//
// Trust hierarchy (per field):
// 1. CGC cert (authoritative when present)
// 2. eBay image search consensus (visual match)
// 3. ComicVine (canonical comic database)
// 4. PriceCharting (market database)
// 5. Vision (our extraction)
//
// Scoring:
// - Title: 50% weight (most critical)
// - Issue: 25% weight
// - Year: 15% weight
// - Publisher: 10% weight
//
// Tiers:
// - VERIFIED (90-100): All sources agree, high confidence
// - UNCERTAIN (60-89): Partial agreement, needs review
// - UNVERIFIED (<60): Major conflicts, block listing

export function alignIdentity({
  visionTitle,
  visionIssue,
  visionYear,
  visionPublisher,
  visionConfidence,
  ebayImageResults,
  pcProductName,
  pcIssue,
  pcYear,
  cvVolumeName,
  cvIssue,
  cvYear,
  cvPublisher,
  cgcTitle,
  cgcIssue,
}) {
  // Token overlap helper
  const overlap = (a, b) => {
    if (!a || !b) return 0;
    const ta = tokenize(a);
    const tb = tokenize(b);
    const matches = ta.filter((t) => tb.includes(t));
    return matches.length / Math.max(ta.length, 1);
  };

  // Normalize year helper (handle cover date strings)
  const normalizeYear = (y) => {
    if (!y) return null;
    const str = String(y);
    const match = str.match(/(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  };

  // Normalize issue helper (strip leading zeros, handle decimals)
  const normalizeIssue = (i) => {
    if (!i) return null;
    const str = String(i).replace(/^0+/, '');
    return str || null;
  };

  // Build consensus from eBay image search
  const ebayTitleConsensus = buildEbayConsensus(ebayImageResults);
  const ebayIssueConsensus = buildEbayIssueConsensus(ebayImageResults);

  // Normalize inputs
  const visionYearNorm = normalizeYear(visionYear);
  const pcYearNorm = normalizeYear(pcYear);
  const cvYearNorm = normalizeYear(cvYear);
  const visionIssueNorm = normalizeIssue(visionIssue);
  const pcIssueNorm = normalizeIssue(pcIssue);
  const cvIssueNorm = normalizeIssue(cvIssue);
  const cgcIssueNorm = normalizeIssue(cgcIssue);
  const ebayIssueNorm = normalizeIssue(ebayIssueConsensus);

  // Publisher normalization (lowercase, trim)
  const normPub = (p) => p ? String(p).toLowerCase().trim() : null;
  const visionPubNorm = normPub(visionPublisher);
  const cvPubNorm = normPub(cvPublisher);

  const conflicts = [];

  // === TITLE SCORING (50% weight) ===
  let titleScore = 0;
  let confirmedTitle = visionTitle;
  let titleOverrodeVision = false;

  // CGC has highest authority
  if (cgcTitle && overlap(cgcTitle, visionTitle) >= 0.5) {
    titleScore = 100;
    confirmedTitle = cgcTitle;
    if (overlap(cgcTitle, visionTitle) < 0.9) {
      titleOverrodeVision = true;
      conflicts.push({ field: 'title', vision: visionTitle, cgc: cgcTitle });
    }
  }
  // eBay image search consensus (visual match)
  else if (ebayTitleConsensus && overlap(ebayTitleConsensus, visionTitle) >= 0.5) {
    const ebayOverlap = overlap(ebayTitleConsensus, visionTitle);
    titleScore = Math.min(95, ebayOverlap * 100);
    if (ebayOverlap < 0.9) {
      confirmedTitle = ebayTitleConsensus;
      titleOverrodeVision = true;
      conflicts.push({ field: 'title', vision: visionTitle, ebay: ebayTitleConsensus });
    }
  }
  // CV + PC agreement
  else if (pcProductName && cvVolumeName) {
    const pcOverlap = overlap(pcProductName, visionTitle);
    const cvOverlap = overlap(cvVolumeName, visionTitle);
    const bothAgree = pcOverlap >= 0.5 && cvOverlap >= 0.5;
    if (bothAgree) {
      titleScore = Math.min(90, (pcOverlap + cvOverlap) / 2 * 100);
    } else if (pcOverlap >= 0.5 || cvOverlap >= 0.5) {
      titleScore = Math.max(pcOverlap, cvOverlap) * 80;
      const disagreer = pcOverlap < 0.5 ? 'CV' : 'PC';
      conflicts.push({ field: 'title', vision: visionTitle, [disagreer]: pcOverlap < 0.5 ? cvVolumeName : pcProductName });
    } else {
      titleScore = 40; // Both disagree
      conflicts.push({ field: 'title', vision: visionTitle, pc: pcProductName, cv: cvVolumeName });
    }
  }
  // CV only
  else if (cvVolumeName) {
    const cvOverlap = overlap(cvVolumeName, visionTitle);
    titleScore = cvOverlap * 75;
    if (cvOverlap < 0.5) {
      conflicts.push({ field: 'title', vision: visionTitle, cv: cvVolumeName });
    }
  }
  // PC only
  else if (pcProductName) {
    const pcOverlap = overlap(pcProductName, visionTitle);
    titleScore = pcOverlap * 70;
    if (pcOverlap < 0.5) {
      conflicts.push({ field: 'title', vision: visionTitle, pc: pcProductName });
    }
  }
  // Vision only
  else {
    const visionConfLower = String(visionConfidence || 'medium').toLowerCase();
    titleScore = visionConfLower === 'high' ? 60 : visionConfLower === 'medium' ? 40 : 20;
    conflicts.push({ field: 'title', vision: visionTitle, sources: 'none' });
  }

  // === ISSUE SCORING (25% weight) ===
  let issueScore = 0;
  let confirmedIssue = visionIssueNorm;

  if (cgcIssueNorm && cgcIssueNorm === visionIssueNorm) {
    issueScore = 100;
  } else if (cgcIssueNorm && cgcIssueNorm !== visionIssueNorm) {
    issueScore = 50;
    confirmedIssue = cgcIssueNorm;
    conflicts.push({ field: 'issue', vision: visionIssueNorm, cgc: cgcIssueNorm });
  } else if (ebayIssueNorm && ebayIssueNorm === visionIssueNorm) {
    issueScore = 95;
  } else if (ebayIssueNorm && ebayIssueNorm !== visionIssueNorm) {
    issueScore = 60;
    confirmedIssue = ebayIssueNorm;
    conflicts.push({ field: 'issue', vision: visionIssueNorm, ebay: ebayIssueNorm });
  } else {
    const sources = [cvIssueNorm, pcIssueNorm].filter(Boolean);
    const matches = sources.filter(s => s === visionIssueNorm);
    if (matches.length === sources.length && sources.length > 0) {
      issueScore = 90; // All text sources agree with Vision
    } else if (matches.length > 0) {
      issueScore = 75; // Partial agreement
    } else if (sources.length > 0) {
      issueScore = 40; // Disagreement
      if (cvIssueNorm && cvIssueNorm !== visionIssueNorm) {
        conflicts.push({ field: 'issue', vision: visionIssueNorm, cv: cvIssueNorm });
      }
      if (pcIssueNorm && pcIssueNorm !== visionIssueNorm) {
        conflicts.push({ field: 'issue', vision: visionIssueNorm, pc: pcIssueNorm });
      }
    } else {
      issueScore = 60; // Vision only
    }
  }

  // === YEAR SCORING (15% weight) ===
  let yearScore = 0;
  let confirmedYear = visionYearNorm;

  const yearMatch = (a, b) => a && b && Math.abs(a - b) <= 2; // ±2y tolerance (cover date drift)

  if (yearMatch(visionYearNorm, cvYearNorm) && yearMatch(visionYearNorm, pcYearNorm)) {
    yearScore = 100; // All agree
  } else if (yearMatch(visionYearNorm, cvYearNorm) || yearMatch(visionYearNorm, pcYearNorm)) {
    yearScore = 85; // Partial agreement
  } else if (cvYearNorm && pcYearNorm && yearMatch(cvYearNorm, pcYearNorm)) {
    // CV and PC agree but disagree with Vision
    yearScore = 60;
    confirmedYear = cvYearNorm;
    conflicts.push({ field: 'year', vision: visionYearNorm, cv: cvYearNorm, pc: pcYearNorm });
  } else if (cvYearNorm || pcYearNorm) {
    yearScore = 50; // Disagreement
    if (cvYearNorm && !yearMatch(visionYearNorm, cvYearNorm)) {
      conflicts.push({ field: 'year', vision: visionYearNorm, cv: cvYearNorm });
    }
    if (pcYearNorm && !yearMatch(visionYearNorm, pcYearNorm)) {
      conflicts.push({ field: 'year', vision: visionYearNorm, pc: pcYearNorm });
    }
  } else {
    yearScore = 60; // Vision only
  }

  // === PUBLISHER SCORING (10% weight) ===
  let publisherScore = 0;

  if (visionPubNorm && cvPubNorm) {
    // Handle abbreviations: "DC" vs "Detective Comics Inc"
    // Check if one is substring of the other OR abbreviation match
    const isSubstring =
      visionPubNorm.includes(cvPubNorm) ||
      cvPubNorm.includes(visionPubNorm);

    // Abbreviation check: "dc" could be initials of first N words of CV publisher
    // Extract first letters of CV publisher words
    const cvWords = cvPubNorm.split(/\s+/).filter(w => w.length > 0);
    const cvInitials = cvWords.map(w => w[0]).join('');
    // Check if vision matches first N initials (e.g., "dc" matches first 2 letters of "dci")
    const isAbbreviation = cvInitials.startsWith(visionPubNorm) || visionPubNorm.startsWith(cvInitials);

    const pubOverlap = (isSubstring || isAbbreviation) ? 1.0 : overlap(visionPubNorm, cvPubNorm);
    publisherScore = pubOverlap * 100;
    if (pubOverlap < 0.5) {
      conflicts.push({ field: 'publisher', vision: visionPublisher, cv: cvPublisher });
    }
  } else if (cvPubNorm) {
    publisherScore = 50; // Vision missing, CV present
  } else {
    publisherScore = 60; // Vision only
  }

  // === WEIGHTED AUTHENTICATION SCORE ===
  const authenticationScore = Math.round(
    titleScore * 0.50 +
    issueScore * 0.25 +
    yearScore * 0.15 +
    publisherScore * 0.10
  );

  // === CONFIDENCE TIER ===
  let confidence;
  if (authenticationScore >= 90) {
    confidence = 'VERIFIED';
  } else if (authenticationScore >= 60) {
    confidence = 'UNCERTAIN';
  } else {
    confidence = 'UNVERIFIED';
  }

  // === DETERMINE CONFIRMED SOURCE ===
  let confirmedSource;
  if (cgcTitle || cgcIssueNorm) {
    confirmedSource = 'cgc';
  } else if (titleOverrodeVision || (ebayIssueNorm && ebayIssueNorm !== visionIssueNorm)) {
    // eBay is source only if it actually overrode Vision title OR issue
    confirmedSource = 'ebay_image';
  } else if (cvVolumeName && pcProductName) {
    confirmedSource = 'vision+text';
  } else if (cvVolumeName) {
    confirmedSource = 'comicvine';
  } else if (pcProductName) {
    confirmedSource = 'pricecharting';
  } else {
    confirmedSource = 'vision_only';
  }

  return {
    confirmedTitle,
    confirmedIssue,
    confirmedYear,
    confirmedSource,
    overrodeVision: titleOverrodeVision,
    visionWas: titleOverrodeVision ? visionTitle : undefined,
    confidence,
    authenticationScore,
    conflicts,
    needsReview: authenticationScore < 80,
    breakdown: {
      title: Math.round(titleScore),
      issue: Math.round(issueScore),
      year: Math.round(yearScore),
      publisher: Math.round(publisherScore),
    },
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

function buildEbayIssueConsensus(items) {
  if (!items?.length) return null;
  // Extract issue numbers from eBay results
  // Find most common (≥2 agree)
  const issues = items
    .map((i) => {
      const m = String(i.title || '').match(/#\s*(\d+)/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
  if (issues.length === 0) return null;
  const freq = {};
  issues.forEach((iss) => {
    freq[iss] = (freq[iss] || 0) + 1;
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
