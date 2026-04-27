// PriceCharting product-page extractors (Phase 5a.1 + Ship #20a).
//
// Hosts TWO extractors over a single shared HTML fetch:
//   1. fetchPricechartingPop  — CGC pop_data (Phase 5a.1, since 2026-04-22)
//   2. fetchPricechartingSales — completed-sales rows (Ship #20a, 2026-04-26)
//
// Both parse the SAME HTML PriceCharting serves at /game/{productId}.
// fetchPCProductHtml caches the raw HTML for 24h per warm Lambda so a
// single page fetch services both extractors with no extra requests.
//
// Fails CLOSED throughout: any error (network, regex miss, parse, schema
// mismatch) returns null / []. Engine behavior is unchanged when the
// extractors return nothing — pop hides its UI panel, sales surfaces
// an empty soldComps array. Indie books, new products, PC outages, or
// HTML schema drift never break the enrich pipeline.

// ───────────────────────── shared HTML fetch + cache ─────────────────────────

const HTML_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const htmlCache = new Map();

const fetchPCProductHtml = async (productId) => {
  if (!productId) return null;
  const cached = htmlCache.get(productId);
  if (cached && Date.now() - cached.ts < HTML_CACHE_TTL_MS) {
    return cached.html;
  }
  try {
    const url = `https://www.pricecharting.com/game/${productId}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      console.log(`[pc-html] HTTP ${res.status} for id=${productId}`);
      return null;
    }
    const html = await res.text();
    htmlCache.set(productId, { ts: Date.now(), html });
    return html;
  } catch (err) {
    console.error(`[pc-html] fetch error id=${productId}: ${err?.message || err}`);
    return null;
  }
};

// ───────────────────────── pop_data extractor (Phase 5a.1) ───────────────────

// 14-bucket CGC grade index — VERIFIED from PC's render_pop_chart()
// in /js/market_ab.js line 5544 (April 2026). The xAxis categories
// for is_comic products are exactly:
//   ['1','2','3','4','5','6','7','8','9.0','9.2','9.4','9.6','9.8','10']
//
// PC bucketing semantics:
// - Grades 1-8: whole-number bins. CGC 8.5 → bucket "8", CGC 1.8 → "1".
// - Grades 9.0+: exact buckets (9.0, 9.2, 9.4, 9.6, 9.8, 10).
// - CGC 9.9 has no bucket — closest is 9.8.
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

const POP_DATA_RE = /VGPC\.pop_data\s*=\s*(\{[^;]+\})\s*;/;

export const fetchPricechartingPop = async (productId, userGrade = null) => {
  if (!productId) return null;
  const html = await fetchPCProductHtml(productId);
  if (!html) return null;

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
    return attachGradeContext(emptyPop, userGrade);
  }

  const byGrade = {};
  for (let i = 0; i < cgc.length && i < POP_GRADE_INDEX.length; i++) {
    byGrade[POP_GRADE_INDEX[i]] = Number(cgc[i]) || 0;
  }

  const pop = { cgc, total, byGrade, source: "pricecharting" };
  return attachGradeContext(pop, userGrade);
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

// ───────────────────────── sales-history extractor (Ship #20a) ───────────────
//
// PC product pages embed completed-sales tables in per-grade tab divs:
//   <div class="completed-auctions-{slot}">
//     <table class="hoverable-rows sortable">
//       <tbody>
//         <tr id="ebay-{itemId}">         (or bare <tr> for Heritage)
//           <td class="date">2026-04-25</td>
//           <td class="title">
//             <a class="js-ebay-completed-sale" href="...">TITLE</a>
//             [eBay]                       (or [HeritageAuctions])
//           </td>
//           <td class="numeric"><span class="js-price">$672.00</span></td>
//         </tr>
//
// CRITICAL: tab class names ("cib", "manual-only", "grade-seventeen") are
// arbitrary slot identifiers from PC's video-game origins and DO NOT map
// to grades by name. The dropdown <select id="completed-auctions-condition">
// declares the per-page mapping ("completed-auctions-grade-seventeen" →
// "9.4 (30)"). Parse the dropdown FIRST, then walk the divs.
//
// Heritage rows have no `<tr id>` — extractor MUST iterate ALL rows in the
// table tbody and detect source from the row's anchor class / [Marketplace]
// suffix in the title cell.

const TAB_GRADE_BLOCK_RE =
  /<select id="completed-auctions-condition">([\s\S]*?)<\/select>/i;
// Captures: option-value (e.g. "completed-auctions-grade-seventeen"),
// label-text up to the trailing "(N)" count.
const OPTION_RE =
  /<option value="(completed-auctions-[a-z-]+)">\s*([^<(]+?)\s*\(/gi;

// Build { tabClass: gradeKey } where gradeKey is a number (e.g. 9.4) for
// CGC tabs or the string 'raw' for the Ungraded tab.
export const buildTabGradeMap = (html) => {
  if (!html) return {};
  const block = html.match(TAB_GRADE_BLOCK_RE);
  if (!block) return {};
  const map = {};
  for (const m of block[1].matchAll(OPTION_RE)) {
    const tab = m[1];
    const label = (m[2] || "").trim();
    if (!tab || !label) continue;
    if (/^ungraded$/i.test(label)) {
      map[tab] = "raw";
      continue;
    }
    const num = parseFloat(label);
    if (!isNaN(num)) map[tab] = num;
  }
  return map;
};

const decodeHtmlEntities = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#43;/g, "+")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const computeDaysAgo = (dateStr) => {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

const ROW_RE = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
const DATE_RE = /<td class="date">\s*(\d{4}-\d{2}-\d{2})/i;
const PRICE_RE =
  /<span class="js-price"[^>]*>\s*\$([\d,]+(?:\.\d+)?)\s*<\/span>/i;
// Capture the FIRST anchor inside the title cell (PC sometimes nests an
// image link before it, but that has no href to ebay/ha — the relevant
// anchor always has class js-ebay-completed-sale or js-ha-completed-sale).
const TITLE_LINK_RE =
  /<a[^>]*class="js-(?:ebay|ha)-completed-sale"[^>]*href="([^"]+)"[^>]*>\s*([\s\S]*?)<\/a>/i;
const EBAY_ID_RE = /id="ebay-(\d+)"/i;

// Extract sales rows from one tab div. The div's content runs until the
// next sibling tab div (any `completed-auctions-` class) or the
// `population-report` div, whichever comes first.
export const extractTabRows = (html, tabClass) => {
  if (!html || !tabClass) return [];
  const startRe = new RegExp(
    `<div class="${tabClass}"[^>]*>`,
    "i"
  );
  const startMatch = html.match(startRe);
  if (!startMatch) return [];
  const startIdx = startMatch.index + startMatch[0].length;
  const remaining = html.slice(startIdx);
  const nextSiblingRe =
    /<div class="(?:completed-auctions-[a-z-]+|population-report)"/i;
  const nextMatch = remaining.match(nextSiblingRe);
  const tabHtml = nextMatch
    ? remaining.slice(0, nextMatch.index)
    : remaining;

  // Empty-state shortcut: PC renders <p>No sales data...</p> with no
  // <table> when a grade tab has no completed sales.
  if (/<p>\s*No sales data/i.test(tabHtml) && !/<table\b/i.test(tabHtml)) {
    return [];
  }

  const rows = [];
  for (const m of tabHtml.matchAll(ROW_RE)) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    // Skip <thead> rows — they contain <th> not <td>.
    if (/<th\b/i.test(inner)) continue;

    const dateMatch = inner.match(DATE_RE);
    const priceMatch = inner.match(PRICE_RE);
    if (!dateMatch || !priceMatch) continue;

    const price = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (!(price > 0)) continue;

    const date = dateMatch[1];

    const linkMatch = inner.match(TITLE_LINK_RE);
    const url = linkMatch ? decodeHtmlEntities(linkMatch[1]) : null;
    const title = linkMatch ? decodeHtmlEntities(linkMatch[2]) : null;

    let marketplace = null;
    if (
      EBAY_ID_RE.test(attrs) ||
      /js-ebay-completed-sale/i.test(inner) ||
      /\[eBay\]/i.test(inner)
    ) {
      marketplace = "ebay";
    } else if (
      /js-ha-completed-sale/i.test(inner) ||
      /\[HeritageAuctions\]/i.test(inner)
    ) {
      marketplace = "heritage";
    }

    rows.push({ price, date, title, url, marketplace });
  }
  return rows;
};

// Stable key shape for salesByGrade map. Integer grades keep an explicit
// ".0" suffix ("9.0" not "9") so consumers can rely on a uniform shape
// across half-grades. 'raw' passes through verbatim.
const formatGradeKey = (grade) => {
  if (grade === "raw") return "raw";
  if (typeof grade !== "number" || isNaN(grade)) return null;
  return Number.isInteger(grade) ? `${grade}.0` : String(grade);
};

// Choose which salesByGrade bucket maps to the user's grade.
// Number → exact match via formatGradeKey (or null if absent — Ship #20a
// is exact-match v1, no nearest-bucket fallback).
// 'raw' → 'raw' bucket.
// Anything else → null.
const pickUserGradeKey = (userGrade) => {
  if (userGrade === "raw") return "raw";
  if (typeof userGrade === "number" && !isNaN(userGrade)) {
    return formatGradeKey(userGrade);
  }
  if (userGrade == null) return null;
  const n = parseFloat(String(userGrade).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : formatGradeKey(n);
};

export const fetchPricechartingSales = async (
  productId,
  userGrade = null
) => {
  if (!productId) return { soldComps: [], salesByGrade: {} };
  try {
    const html = await fetchPCProductHtml(productId);
    if (!html) return { soldComps: [], salesByGrade: {} };

    const tabMap = buildTabGradeMap(html);
    const salesByGrade = {};
    for (const [tab, grade] of Object.entries(tabMap)) {
      const rows = extractTabRows(html, tab);
      if (rows.length === 0) continue;
      const enriched = rows
        .map((r) => ({
          price: r.price,
          date: r.date,
          daysAgo: computeDaysAgo(r.date),
          grade,
          title: r.title,
          url: r.url,
          marketplace: r.marketplace,
          source: "pricecharting-history",
        }))
        // Newest first — PC already returns roughly date-desc but stable.
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const key = formatGradeKey(grade);
      if (key != null) salesByGrade[key] = enriched;
    }

    const lookupKey = pickUserGradeKey(userGrade);
    let soldComps = [];
    if (lookupKey != null) {
      soldComps = salesByGrade[lookupKey] || [];
    }

    console.log(
      `[pc-sales] id=${productId} grades=${Object.keys(salesByGrade).length} userGrade=${lookupKey} soldComps=${soldComps.length}`
    );
    return { soldComps, salesByGrade };
  } catch (err) {
    console.error(`[pc-sales] error id=${productId}: ${err?.message || err}`);
    return { soldComps: [], salesByGrade: {} };
  }
};

// ───────────────────────── HTTP handler (calibration / debug) ────────────────

// Default handler — exercises both extractors with one HTTP call so a
// single curl can verify both pipelines without driving a full scan.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { productId, grade } = req.body || {};
  const [pop, sales] = await Promise.all([
    fetchPricechartingPop(productId, grade),
    fetchPricechartingSales(productId, grade),
  ]);
  res.status(200).json({
    pop: pop || null,
    sales: sales || { soldComps: [], salesByGrade: {} },
  });
}
