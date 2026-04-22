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

// 14-bucket CGC grade index — PLACEHOLDER pending calibration.
// ASM #300 sample array [12,57,142,419,776,1499,2881,5431,3509,
// 3929,4869,4243,1588,0] sums to 33,355 which matches the real
// public ASM #300 CGC pop — so the TOTAL is trustworthy. The
// per-grade mapping below is the best-guess peak-around-9.0 scheme;
// actual bucket boundaries will be locked after Phase 5a.2 cross-
// references raw arrays against CGC's official census on 5 test
// books (ASM #300, AF #15, Hulk #181, NYX #3, Detective #27).
const POP_GRADE_INDEX = [
  0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0,
  5.0, 6.0, 7.0, 8.0, 9.0, 9.4,
];

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
// given user grade. Separated from the fetch so a cached pop can
// service different grades without re-parsing HTML.
const attachGradeContext = (pop, userGrade) => {
  if (!pop) return null;
  const out = {
    ...pop,
    atGrade: null,
    aboveGrade: null,
    belowGrade: null,
    scarcityRatio: null,
  };
  if (!pop.total || !userGrade) return out;
  const g = parseFloat(String(userGrade).replace(/[^\d.]/g, ""));
  if (isNaN(g)) return out;

  let at = 0;
  let above = 0;
  let below = 0;
  for (const [gradeStr, count] of Object.entries(pop.byGrade)) {
    const grade = parseFloat(gradeStr);
    const c = Number(count) || 0;
    if (isNaN(grade)) continue;
    if (grade === g) at += c;
    else if (grade > g) above += c;
    else below += c;
  }
  out.atGrade = at;
  out.aboveGrade = above;
  out.belowGrade = below;
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
