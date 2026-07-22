// Ship #20a.6.22 — Autofix engine
//
// Pure logic. No LLM. Runs after every enrich and after every Re-identify.
// Detects common pricing/comp issues and applies automatic corrections.

import { normalizeAcronyms } from './compHygiene.js';

export function runAutoFix(item) {
  const fixes = [];
  let updated = { ...item };

  // Fix 1: Sold >> Active gap (10× rule)
  // Golden Age / Silver Age under-pricing from contaminated active pool
  if (item.soldComps?.length >= 2 && item.comps?.averageNum > 0) {
    const soldMedian = median(item.soldComps.map(s => s.price));
    const activeAvg = item.comps.averageNum;
    if (soldMedian > activeAvg * 3 && activeAvg > 0) {
      const mult = item.gradeMultiplier || 1;
      updated.price = fmtUsd(soldMedian * mult);
      updated.priceNote = 'sold-anchor (active comps contaminated)';
      fixes.push('sold-over-active-anchor');
    }
  }

  // Fix 2: Wrong issue in active comps
  if (item.issue && item.comps?.prices?.length) {
    const issueRe = new RegExp(`#\\s*${item.issue}\\b`, 'i');
    const exactMatches = item.comps.prices.filter(c => issueRe.test(c.title || ''));
    if (exactMatches.length === 0) {
      updated.needsExactIssueRequery = true;
      fixes.push('wrong-issue-comps');
    }
  }

  // Fix 3: Sold/active series mismatch
  if (item.soldComps?.length && item.comps?.prices?.length) {
    const soldTokens = tokenize(item.soldComps[0]?.title || '');
    const activeTokens = tokenize(item.comps.prices[0]?.title || '');
    const overlap = soldTokens.filter(t => activeTokens.includes(t));
    const overlapRatio = overlap.length / Math.max(soldTokens.length, 1);
    if (overlapRatio < 0.3) {
      updated.needsSoldRequery = true;
      fixes.push('sold-active-series-mismatch');
    }
  }

  // Fix 4: Magazine format
  if (/magazine/i.test(item.reason || '')) {
    updated.isMagazine = true;
    updated.needsMagazineRequery = true;
    fixes.push('magazine-format-detected');
  }

  // Fix 5: Grade multiplier mismatch
  const grade = item.numericGrade || 0;
  const mult = item.gradeMultiplier || 1;
  const expectedRanges = {
    2.0: [0.40, 0.50],
    4.0: [0.60, 0.70],
    6.0: [0.80, 0.90],
    8.0: [1.00, 1.20],
    9.4: [1.30, 1.45],
  };
  if (grade > 0) {
    const nearestGrade = Object.keys(expectedRanges).reduce((prev, curr) =>
      Math.abs(parseFloat(curr) - grade) < Math.abs(parseFloat(prev) - grade) ? curr : prev
    );
    const [lo, hi] = expectedRanges[nearestGrade] || [0, 2];
    if (mult < lo || mult > hi) {
      const correctMult = (lo + hi) / 2;
      updated.gradeMultiplier = correctMult;
      const currentPriceNum = parsePriceNum(updated.price);
      if (currentPriceNum > 0) {
        updated.price = fmtUsd(currentPriceNum * (correctMult / mult));
      }
      fixes.push('grade-multiplier-corrected');
    }
  }

  // Fix 6: Modern contamination on vintage
  const modernMarkers = /\b(MCU|Taylor Swift|Deadpool 3|2023|2024|2025|2026)\b/i;
  if (item.year < 2000 && item.comps?.prices) {
    const filtered = item.comps.prices.filter(c => !modernMarkers.test(c.title || ''));
    if (filtered.length < item.comps.prices.length && filtered.length > 0) {
      updated.comps = { ...item.comps, prices: filtered };
      fixes.push('modern-contamination-removed');
    }
  }

  // Fix 7: Pre-1985 newsstand penalty removal
  if (item.year < 1985 &&
      /newsstand/i.test(item.variant || '') &&
      item.variantMultiplier != null &&
      item.variantMultiplier < 1.0) {
    updated.variantMultiplier = 1.0;
    const currentPriceNum = parsePriceNum(updated.price);
    if (currentPriceNum > 0 && item.variantMultiplier > 0) {
      updated.price = fmtUsd(currentPriceNum / item.variantMultiplier);
    }
    fixes.push('newsstand-penalty-removed-pre1985');
  }

  // Fix 8: Single comp false warning suppression
  if (item.comps?.count === 1) {
    updated.suppressAboveMarketWarning = true;
    fixes.push('single-comp-warning-suppressed');
  }

  return { updated, fixes };
}

function tokenize(str) {
  // G.O.D.S. dispatch — collapse punctuated acronyms before the strip below.
  return normalizeAcronyms(String(str))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function median(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtUsd(n) {
  if (n == null || isNaN(n)) return null;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function parsePriceNum(priceStr) {
  if (!priceStr) return 0;
  const num = parseFloat(String(priceStr).replace(/[$,]/g, ''));
  return isNaN(num) ? 0 : num;
}
