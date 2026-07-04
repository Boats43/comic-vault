// Ship #28a COMMIT 3 — Conflict detector (LOG ONLY)
//
// Deterministic conflict detection across 5 data sources:
// Vision, eBay image search, ComicVine, PriceCharting, GoCollect
//
// Returns array of conflict objects:
//   { type, severity, detail, sources }
//
// Ship #28b will use conflicts to gate AI calls.
// Ship #28a observes only (logs conflicts, stores on out.conflicts).

// Q42 C-A3: Import abbreviation map (single source of truth from compHygiene)
import { ABBREV_MAP } from './compHygiene.js';

/**
 * Q44 A2 — Normalize title for conflict checking (strip cosmetic variants).
 *
 * Leading article normalization: "The Mighty Thor" → "Mighty Thor"
 * Adjective prefix normalization: "Amazing Spider-Man" → "Spider-Man"
 * Imprint prefix normalization: "Dark Horse Presents" → "Presents"
 *
 * Prevents false CRITICAL conflicts when Vision says "The Mighty Thor"
 * and eBay says "Thor" — same book, cosmetic title variant.
 *
 * @param {string} title - Raw title string
 * @returns {string} Normalized title for conflict comparison
 */
const normalizeTitleForConflict = (title) => {
  if (!title) return '';

  let normalized = String(title).toLowerCase().trim();

  // Strip leading articles (the, a, an) — must be word-boundary anchored
  normalized = normalized.replace(/^(the|a|an)\s+/i, '');

  // Q44: Adjective prefix map — common descriptive prefixes that are cosmetic
  // variants of the same series. "Amazing Spider-Man" vs "Spider-Man" should
  // NOT conflict. Map: adjective → canonical (when prefix + canonical match).
  const ADJECTIVE_PREFIX_MAP = [
    'mighty', 'amazing', 'astonishing', 'uncanny', 'incredible',
    'invincible', 'immortal', 'sensational', 'spectacular', 'ultimate',
    'all-new', 'all new', 'new',
  ];

  // Q44: Imprint prefix map — publisher/imprint names that prefix series titles
  // in some scans but not others. "Dark Horse Presents" vs "Presents",
  // "Marvel Team-Up" vs "Team-Up" should NOT conflict when both share core tokens.
  const IMPRINT_PREFIX_MAP = [
    'marvel', 'dc', 'dark horse', 'image', 'idw',
    'vertigo', 'wildstorm', 'max',
  ];

  // Try stripping adjective prefix (only if result retains ≥3 chars)
  for (const adj of ADJECTIVE_PREFIX_MAP) {
    const pattern = new RegExp(`^${adj}\\s+`, 'i');
    const stripped = normalized.replace(pattern, '');
    if (stripped.length >= 3) {
      normalized = stripped;
      break; // first match wins
    }
  }

  // Try stripping imprint prefix (only if result retains ≥3 chars)
  for (const imp of IMPRINT_PREFIX_MAP) {
    const pattern = new RegExp(`^${imp}\\s+`, 'i');
    const stripped = normalized.replace(pattern, '');
    if (stripped.length >= 3) {
      normalized = stripped;
      break; // first match wins
    }
  }

  return normalized.trim();
};

/**
 * Detect identity conflicts across data sources.
 *
 * @param {object} vision - Vision scan result (title, issue, year, publisher)
 * @param {object} ebay - eBay image search consensus (title, issue, year, agreement)
 * @param {object} comicVine - ComicVine top match (volume, startYear, publisher)
 * @param {object} priceCharting - PriceCharting match (productName, year)
 * @returns {array} Array of conflict objects
 */
export const detectIdentityConflicts = (vision, ebay, comicVine, priceCharting) => {
  const conflicts = [];

  if (!vision) return conflicts; // no Vision data = no conflicts to detect

  // CONFLICT 1: Title family mismatch (Vision vs eBay)
  if (ebay?.title && ebay.agreement >= 0.7) {
    // Q44 C-A2: Normalize BOTH titles before tokenizing to strip cosmetic variants.
    // Track whether normalization altered either title for observability.
    const visionRaw = vision.title || '';
    const ebayRaw = ebay.title;
    const visionNorm = normalizeTitleForConflict(visionRaw);
    const ebayNorm = normalizeTitleForConflict(ebayRaw);

    const visionNormalized = visionRaw.toLowerCase().trim() !== visionNorm;
    const ebayNormalized = ebayRaw.toLowerCase().trim() !== ebayNorm;

    const visionTokens = tokenize(visionNorm);
    const ebayTokens = tokenize(ebayNorm);
    const overlap = visionTokens.filter(t => ebayTokens.includes(t)).length;
    const overlapRatio = visionTokens.length > 0 ? overlap / visionTokens.length : 0;

    // Ship #28a: Require BOTH < 50% overlap AND low eBay agreement to flag
    // Abbreviations like "LOTDK" vs "Legends of the Dark Knight" should pass
    // when eBay agreement is decent (≥0.7 = sellers know what they're listing)
    if (overlapRatio < 0.5 && ebay.agreement < 0.7) {
      conflicts.push({
        type: 'TITLE_FAMILY_MISMATCH',
        severity: 'CRITICAL',
        detail: `Vision "${visionRaw}" vs eBay "${ebayRaw}" (${Math.round(overlapRatio * 100)}% overlap after normalization)`,
        sources: {
          vision: visionRaw,
          ebay: ebayRaw,
          ebayAgreement: ebay.agreement,
        },
      });
    }

    // C-A2: Observability conflict — when adjective/article/imprint normalization
    // fired on either title, push INFO-severity flag. Never silent.
    if ((visionNormalized || ebayNormalized) && overlapRatio >= 0.5) {
      conflicts.push({
        type: 'ADJECTIVE_NORMALIZED',
        severity: 'INFO',
        detail: `Cosmetic variant normalized: Vision "${visionRaw}" → "${visionNorm}", eBay "${ebayRaw}" → "${ebayNorm}" (${Math.round(overlapRatio * 100)}% overlap)`,
        sources: {
          visionRaw,
          visionNorm,
          ebayRaw,
          ebayNorm,
        },
      });
    }
  }

  // CONFLICT 2: Issue number mismatch (Vision vs eBay consensus)
  if (ebay?.issue && ebay.agreement >= 0.7) {
    const visionIssue = String(vision.issue || '').trim();
    const ebayIssue = String(ebay.issue).trim();
    if (visionIssue && ebayIssue && visionIssue !== ebayIssue) {
      conflicts.push({
        type: 'ISSUE_MISMATCH',
        severity: 'CRITICAL',
        detail: `Vision #${visionIssue} vs eBay #${ebayIssue} (${ebay.agreement} agreement)`,
        sources: {
          vision: visionIssue,
          ebay: ebayIssue,
          ebayAgreement: ebay.agreement,
        },
      });
    }
  }

  // CONFLICT 3: Year drift across sources (>5y spread)
  const years = [
    vision.year,
    ebay?.year,
    comicVine?.startYear,
    priceCharting?.year,
  ]
    .map(y => parseInt(y, 10))
    .filter(y => !isNaN(y) && y > 1900 && y < 2100);

  if (years.length >= 2) {
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const spread = maxYear - minYear;

    if (spread > 5) {
      conflicts.push({
        type: 'YEAR_DRIFT',
        severity: 'HIGH',
        detail: `Year spread ${minYear}-${maxYear} (${spread}y gap)`,
        sources: {
          vision: vision.year,
          ebay: ebay?.year,
          comicVine: comicVine?.startYear,
          priceCharting: priceCharting?.year,
        },
      });
    }
  }

  // CONFLICT 4: Publisher mismatch (Vision vs ComicVine)
  if (vision.publisher && comicVine?.publisher) {
    const vPub = String(vision.publisher).toLowerCase().trim();
    const cvPub = String(comicVine.publisher).toLowerCase().trim();

    // Q44 C-A2: Expand imprint normalization map
    // Imprints: Vertigo/Wildstorm/Max → parent DC/Marvel
    // Colloquial: "dc" matches "dc comics", "marvel" matches "marvel comics"
    const IMPRINT_PARENTS = {
      'vertigo': 'dc',
      'wildstorm': 'dc',
      'max': 'marvel',
      'marvel max': 'marvel',
      'icon': 'marvel',
      'marvel knights': 'marvel',
      'ultimate marvel': 'marvel',
    };

    // Normalize to parent publisher if imprint detected
    const vNorm = IMPRINT_PARENTS[vPub] || vPub;
    const cvNorm = IMPRINT_PARENTS[cvPub] || cvPub;

    const match = vNorm.includes(cvNorm) || cvNorm.includes(vNorm) ||
                  (vNorm === 'dc' && cvNorm.includes('dc comics')) ||
                  (vNorm === 'marvel' && cvNorm.includes('marvel')) ||
                  (cvNorm === 'dc' && vNorm.includes('dc comics')) ||
                  (cvNorm === 'marvel' && vNorm.includes('marvel'));

    if (!match) {
      // C-A2 REVERT: Severity back to MEDIUM (was INFO in A2, regression).
      // INFO downgrade allowed GENUINE cross-publisher conflicts (Marvel vs DC,
      // Editorial Novaro class) to slip through. Imprint normalization already
      // neutralizes cosmetic cases by producing match=true — only real conflicts
      // reach this push. MEDIUM is correct.
      conflicts.push({
        type: 'PUBLISHER_MISMATCH',
        severity: 'MEDIUM',
        detail: `Vision "${vision.publisher}" vs CV "${comicVine.publisher}"`,
        sources: {
          vision: vision.publisher,
          comicVine: comicVine.publisher,
        },
      });
    }
  }

  return conflicts;
};

/**
 * Detect pricing conflicts across sold/active comps and price guides.
 *
 * @param {object} sold - Sold comps (median, count, prices)
 * @param {object} active - Active comps (median, count, prices)
 * @param {object} pcGuide - PriceCharting price ladder ({ '9.8': X, raw: Y })
 * @param {object} gcFmv - GoCollect FMV ladder ({ '9.8': X, '9.4': Y })
 * @returns {array} Array of conflict objects
 */
export const detectPricingConflicts = (sold, active, pcGuide, gcFmv) => {
  const conflicts = [];

  // CONFLICT 1: Active listings far below sold median (liquidity crisis)
  if (sold?.median && active?.median && sold.median > 10) {
    const ratio = active.median / sold.median;
    if (ratio < 0.6) {
      conflicts.push({
        type: 'LIQUIDITY_CRISIS',
        severity: 'HIGH',
        detail: `Active $${active.median.toFixed(2)} is ${Math.round((1 - ratio) * 100)}% below sold $${sold.median.toFixed(2)}`,
        sources: {
          soldMedian: sold.median,
          activeMedian: active.median,
          soldCount: sold.count,
          activeCount: active.count,
        },
      });
    }
  }

  // CONFLICT 2: Active listings far ABOVE sold median (price inflation)
  if (sold?.median && active?.median && sold.median > 10) {
    const ratio = active.median / sold.median;
    if (ratio > 2.5) {
      conflicts.push({
        type: 'PRICE_INFLATION',
        severity: 'HIGH',
        detail: `Active $${active.median.toFixed(2)} is ${Math.round((ratio - 1) * 100)}% above sold $${sold.median.toFixed(2)}`,
        sources: {
          soldMedian: sold.median,
          activeMedian: active.median,
          soldCount: sold.count,
          activeCount: active.count,
        },
      });
    }
  }

  // CONFLICT 3: PC vs GC FMV divergence (>30% gap at 9.8)
  if (pcGuide?.['9.8'] && gcFmv?.['9.8']) {
    const pcVal = pcGuide['9.8'];
    const gcVal = gcFmv['9.8'];
    const gap = Math.abs(pcVal - gcVal) / Math.max(pcVal, gcVal);

    if (gap > 0.3 && Math.max(pcVal, gcVal) > 50) {
      conflicts.push({
        type: 'FMV_DIVERGENCE',
        severity: 'MEDIUM',
        detail: `PC 9.8 $${pcVal.toFixed(2)} vs GC 9.8 $${gcVal.toFixed(2)} (${Math.round(gap * 100)}% gap)`,
        sources: {
          pc: pcVal,
          gc: gcVal,
        },
      });
    }
  }

  return conflicts;
};

/**
 * Detect comp pool contamination via eBay metadata.
 *
 * @param {object} comps - Comp data (count, prices, recentSales)
 * @param {array} leafCategories - eBay leafCategoryIds from image search
 * @returns {array} Array of conflict objects
 */
export const detectCompsConflicts = (comps, leafCategories) => {
  const conflicts = [];

  if (!Array.isArray(leafCategories) || leafCategories.length === 0) {
    return conflicts; // no eBay metadata = no conflicts to detect
  }

  // CONFLICT 1: Cross-category contamination
  // Valid comic categories: 259104 (Single Issues), 171228 (Collections), 63 (Comics root)
  const VALID_COMIC_CATEGORIES = ['259104', '171228', '63'];
  const invalidCategories = leafCategories.filter(
    cat => !VALID_COMIC_CATEGORIES.includes(String(cat))
  );

  if (invalidCategories.length > 0) {
    conflicts.push({
      type: 'CROSS_CATEGORY_CONTAMINATION',
      severity: 'CRITICAL',
      detail: `Non-comic categories detected: [${invalidCategories.join(', ')}]`,
      sources: {
        allCategories: leafCategories,
        invalidCategories,
        validCategories: VALID_COMIC_CATEGORIES,
      },
    });
  }

  // CONFLICT 2: Series name mismatch across comps (Ship #28b TODO)
  // Requires comp title parsing — deferred to full implementation

  return conflicts;
};

// Helper: Tokenize title for overlap comparison
const tokenize = (title) => {
  if (!title) return [];

  let normalized = String(title).toLowerCase();

  // C-A3: Expand abbreviations (imported from compHygiene.js — single source of truth)
  for (const [abbrev, expanded] of Object.entries(ABBREV_MAP)) {
    const pattern = new RegExp(`\\b${abbrev}\\b`, 'gi');
    normalized = normalized.replace(pattern, expanded);
  }

  const STOP_WORDS = ['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'with'];
  return normalized
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.includes(t) && !/^\d+$/.test(t));
};
