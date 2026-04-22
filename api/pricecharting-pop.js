// PriceCharting CGC population extractor (Phase 5a.1).
//
// Fetches the public PC product page and extracts the embedded
// `VGPC.pop_data = {"cgc":[...]}` JS assignment. Same data PC
// renders publicly in its Pop Report tab — no auth required.
//
// Fails CLOSED: any error (network, regex miss, parse, empty array)
// returns null. Engine behavior is unchanged when pop is null, so
// indie books, new products, PC outages, or an HTML schema change
// never break the enrich pipeline.
//
// Phase 5a.1 scope: extractor + debug logging only. No UI, no
// pricing math changes. POP_GRADE_INDEX is a working hypothesis
// pending empirical calibration in Phase 5a.2.

// 14-bucket CGC grade index — VERIFIED from PC's render_pop_chart()
// in /js/market_ab.js line 5544 (April 2026). The xAxis categories
// for is_comic products are exactly:
//   ['1','2','3','4','5','6','7','8','9.0','9.2','9.4','9.6','9.8','10']
//
// PC bucketing semantics:
// - Grades 1-8: whole-number bins. CGC 8.5 → bucket "8", CGC 1.8 → "1".
// - Grades 9.0+: exact buckets (9.0, 9.2, 9.4, 9.6, 9.8, 10).
// - CGC 9.9 has no bucket — closest is 9.8.
//
// User grade → bucket mapping (see normalizeGradeToPopBucket):
// - CGC 8.5 → bucket 8 (index 7)
// - CGC 9.4 → bucket 9.4 (index 10)
// - CGC 9.9 → bucket 9.8 (index 12)
// - CGC 10.0 → bucket 10 (index 13)
const POP_GRADE_INDEX = [
  1, 2, 3, 4, 5, 6, 7, 8, 9.0, 9.2, 9.4, 9.6, 9.8, 10,
];

// Normalize a CGC numeric grade to the matching pop bucket.
// Sub-9.0 grades fall to the floor whole number (PC bins them).
// 9.0+ grades match the half-grade tracked by PC.
const normalizeGradeToPopBucket = (grade) => {
  if (grade >= 10) return 10;
  if (grade >= 9.8) return 9.8;
  if (grade >= 9.6) return 9.6;
  if (grade >= 9.4) return 9.4;
  if (grade >= 9.2) return 9.2;
  if (grade >= 9.0) return 9.0;
  return Math.floor(grade);
};

// In-memory cache per warm Lambda. Product pop data changes monthly
// per the PC blog footer, so 24h TTL is conservative.
const popCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const POP_DATA_RE = /VGPC\.pop_data\s*=\s*(\{[^;]+\})\s*;/;

export const fetchPricechartingPop = async (productId, userGrade = null) => {
  if (!productId) return null;

  const cached = popCache.get(productId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return attachGradeContext(cached.pop, userGrade);
  }

  try {
    const url = `https://www.pricecharting.com/game/${productId}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.log(`[pc-pop] HTTP ${res.status} for id=${productId}`);
      return null;
    }
    const html = await res.text();
    const m = html.match(POP_DATA_RE);
    if (!m) {
      console.log(`[pc-pop] no pop_data match for id=${productId}`);
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch (err) {
      console.log(
        `[pc-pop] JSON parse failed for id=${productId}: ${err?.message || err}`
      );
      return null;
    }
    const cgc = Array.isArray(parsed?.cgc) ? parsed.cgc : null;
    if (!cgc || cgc.length === 0) return null;

    const total = cgc.reduce((a, b) => a + (Number(b) || 0), 0);

    console.log(
      `[pc-pop-calibrate] id=${productId} total=${total} cgc=${JSON.stringify(cgc)}`
    );

    if (total === 0) {
      const emptyPop = {
        cgc,
        total: 0,
        byGrade: {},
        source: "pricecharting",
      };
      popCache.set(productId, { ts: Date.now(), pop: emptyPop });
      return attachGradeContext(emptyPop, userGrade);
    }

    const byGrade = {};
    for (let i = 0; i < cgc.length && i < POP_GRADE_INDEX.length; i++) {
      byGrade[POP_GRADE_INDEX[i]] = Number(cgc[i]) || 0;
    }

    const pop = { cgc, total, byGrade, source: "pricecharting" };
    popCache.set(productId, { ts: Date.now(), pop });
    return attachGradeContext(pop, userGrade);
  } catch (err) {
    console.error(`[pc-pop] error id=${productId}: ${err?.message || err}`);
    return null;
  }
};

// Derives atGrade / aboveGrade / belowGrade / scarcityRatio for a
// given user grade. Bucket the user grade first via PC's bucketing
// scheme so CGC 8.5 lands in bucket "8" (not an unmatched 8.5).
// Separated from the fetch so a cached pop can service different
// grades without re-parsing HTML.
const attachGradeContext = (pop, userGrade) => {
  if (!pop) return null;
  const out = {
    ...pop,
    atGrade: null,
    aboveGrade: null,
    belowGrade: null,
    scarcityRatio: null,
    userBucket: null,
  };
  if (!pop.total || !userGrade) return out;
  const g = parseFloat(String(userGrade).replace(/[^\d.]/g, ""));
  if (isNaN(g)) return out;

  const userBucket = normalizeGradeToPopBucket(g);

  let at = 0;
  let above = 0;
  let below = 0;
  for (const [gradeStr, count] of Object.entries(pop.byGrade)) {
    const bucket = parseFloat(gradeStr);
    const c = Number(count) || 0;
    if (isNaN(bucket)) continue;
    if (bucket === userBucket) at += c;
    else if (bucket > userBucket) above += c;
    else below += c;
  }
  out.atGrade = at;
  out.aboveGrade = above;
  out.belowGrade = below;
  out.userBucket = userBucket;
  out.scarcityRatio = pop.total > 0 ? at / pop.total : 0;
  return out;
};

// Default handler — lets the extractor be exercised directly with a
// productId for Phase 5a.2 calibration without a full scan.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { productId, grade } = req.body || {};
  const pop = await fetchPricechartingPop(productId, grade);
  res.status(200).json(pop || { unavailable: true });
}
