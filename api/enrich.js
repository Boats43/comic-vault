// POST /api/enrich
//
// Second-pass enrichment. Fires ComicVine, eBay comps, and the
// Ximilar image fallback in parallel and returns everything together. The
// client displays the Claude /api/grade result immediately and merges this
// payload into the card when it resolves.
//
// Request body: { title, grade, confidence?, images? }
// Response: { comicVine?, comps?, ximilar?, price?, priceLow?,
//             priceHigh?, keyIssue?, identifiedBy? }

import Anthropic from "@anthropic-ai/sdk";
import { fetchComps } from "./comps.js";
import { fetchSold } from "./sold.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Format a number as USD ("$1,234.56") or null. Mirrors the formatter
// used in api/comps.js so the UI gets identically-shaped strings whether
// the stats came from fetchComps or the post-verification recomputation.
const fmtUsd = (n) =>
  n == null || isNaN(n)
    ? null
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

// Fast, text-only AI verification pass. Asks Claude whether each eBay
// listing title actually matches the identified comic. Returns an array
// of booleans in the same order as `listings`, or null on any failure so
// the caller can silently fall back to unverified comps.
const verifyCompsTitles = async ({ title, issue, year, publisher, listings }) => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!Array.isArray(listings) || listings.length === 0) return null;
  try {
    const metaParts = [];
    if (title) metaParts.push(String(title).trim());
    if (issue) metaParts.push(`#${issue}`);
    if (year) metaParts.push(`(${year})`);
    const comicLabel =
      metaParts.filter(Boolean).join(" ").trim() || "this comic";
    const publisherPart = publisher ? ` by ${publisher}` : "";
    const numbered = listings
      .map((t, i) => `${i + 1}. ${String(t || "").trim()}`)
      .join("\n");

    const prompt =
      `I identified this comic: ${comicLabel}${publisherPart}.\n\n` +
      `These are eBay listings returned as price comps:\n${numbered}\n\n` +
      `For each listing reply with MATCH or NO_MATCH. Only MATCH if the ` +
      `listing is clearly the same comic — same title, same issue number, ` +
      `same era. Reply with only a JSON array like:\n[true, false, true, false]\n` +
      `in the same order as the listings.`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (message.content || [])
      .filter((b) => b && b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\[[\s\S]*?\]/);
      parsed = m ? JSON.parse(m[0]) : null;
    }
    if (!Array.isArray(parsed)) return null;
    if (parsed.length !== listings.length) {
      console.warn(
        `[enrich] AI verify length mismatch: got ${parsed.length}, expected ${listings.length}`
      );
      return null;
    }
    return parsed.map((v) => v === true);
  } catch (err) {
    console.error(`[enrich] AI verify error: ${err?.message || err}`);
    return null;
  }
};

const lookupComicVine = async ({ title, issue, year, publisher }) => {
  if (!process.env.COMICVINE_API_KEY || !title) return null;
  try {
    // Prefer explicit issue param, fall back to parsing from title.
    const issueFromTitle = String(title).match(/#\s*(\d+)/);
    const issueNumber = issue ? String(issue).trim() : (issueFromTitle ? issueFromTitle[1] : null);
    // Strip #N from title for the base series name.
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();
    // Include issue number in query — ComicVine search ranks it much higher.
    const searchQuery = issueNumber ? `${seriesName} ${issueNumber}` : seriesName;

    const url =
      `https://comicvine.gamespot.com/api/search/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
      `&format=json&resources=issue&query=${encodeURIComponent(searchQuery)}` +
      `&field_list=id,name,issue_number,description,first_appearance_characters,volume` +
      `&limit=20`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ComicVault/1.0" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];

    // Filter to issue number matches first.
    const issueMatches = issueNumber
      ? results.filter((r) => String(r?.issue_number ?? "").trim() === String(issueNumber))
      : [];

    // Score each issue match: prefer volume name closest to our series name,
    // then use volume id as a tiebreaker (lower id = older/original volume).
    const seriesLower = seriesName.toLowerCase().replace(/^(the|a|an)\s+/i, "").trim();
    const comicYear = year ? parseInt(String(year).trim(), 10) : null;
    const pubLower = publisher ? String(publisher).toLowerCase().trim() : null;
    const scoreMatch = (r) => {
      const volName = String(r?.volume?.name || "").toLowerCase().replace(/^(the|a|an)\s+/i, "").trim();
      // Exact or near-exact volume name match gets highest priority.
      const nameScore = volName === seriesLower ? 100
        : volName.includes(seriesLower) || seriesLower.includes(volName) ? 50
        : 0;
      // Year proximity scoring: prefer volumes from the same era.
      const startYear = r?.volume?.start_year ? parseInt(r.volume.start_year, 10) : null;
      const yearDiff = comicYear && startYear ? Math.abs(startYear - comicYear) : 999;
      const yearScore = yearDiff < 10 ? 2 : yearDiff < 20 ? 1 : 0;
      // Publisher scoring: prefer matching publisher.
      const volPublisher = String(r?.volume?.publisher?.name || "").toLowerCase().trim();
      const publisherScore = pubLower && volPublisher && volPublisher.includes(pubLower) ? 2 : 0;
      // Lower volume id = older/more likely original series.
      const volId = parseInt(r?.volume?.id, 10) || 999999;
      return { r, nameScore, yearScore, publisherScore, volId,
        total: nameScore + yearScore + publisherScore };
    };

    // For all issue matches (even single), fetch volume details for the
    // unique volumes so we can score on start_year and publisher.
    const candidates = issueMatches.length > 0 ? issueMatches : [];
    const uniqueVolIds = [...new Set(candidates.map((r) => r?.volume?.id).filter(Boolean))];
    const volDetails = {};
    // Fetch up to 5 volume details sequentially (ComicVine rate-limits parallel).
    for (const vid of uniqueVolIds.slice(0, 5)) {
      try {
        const vUrl =
          `https://comicvine.gamespot.com/api/volume/4050-${vid}/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
          `&format=json&field_list=id,name,start_year,publisher`;
        const vRes = await fetch(vUrl, { headers: { "User-Agent": "ComicVault/1.0" } });
        if (vRes.ok) {
          const vJson = await vRes.json();
          if (vJson?.results) volDetails[vid] = vJson.results;
        }
      } catch { /* skip */ }
    }
    console.log(`[comicvine] volDetails fetched: ${Object.keys(volDetails).length}/${uniqueVolIds.length} — ${
      Object.entries(volDetails).map(([id, v]) => `${id}:${v.name}(${v.start_year},${v.publisher?.name || "?"})`).join(", ")}`);

    // Re-score with volume detail data (start_year, publisher).
    const scoreWithDetails = (r) => {
      const base = scoreMatch(r);
      const vid = r?.volume?.id;
      const vol = volDetails[vid];
      if (!vol) return base;
      const startYear = vol.start_year ? parseInt(vol.start_year, 10) : null;
      const yearDiff = comicYear && startYear ? Math.abs(startYear - comicYear) : 999;
      const detailYearScore = yearDiff < 10 ? 2 : yearDiff < 20 ? 1 : 0;
      const volPub = String(vol.publisher?.name || "").toLowerCase().trim();
      const detailPubScore = pubLower && volPub && volPub.includes(pubLower) ? 2 : 0;
      const total = base.nameScore + detailYearScore + detailPubScore;
      return { ...base, yearScore: detailYearScore, publisherScore: detailPubScore, total };
    };

    let match = null;
    if (candidates.length === 1) {
      // Single match — still validate year/publisher if we have details.
      const scored = scoreWithDetails(candidates[0]);
      // Reject if we know both year and publisher and neither matched.
      if (comicYear && pubLower && scored.yearScore === 0 && scored.publisherScore === 0 && volDetails[candidates[0]?.volume?.id]) {
        match = null; // wrong era + wrong publisher — skip
      } else {
        match = candidates[0];
      }
    } else if (candidates.length > 1) {
      // Pick best: highest combined score, then lowest volume id (oldest series).
      const scored = candidates.map(scoreWithDetails);
      scored.sort((a, b) => b.total - a.total || a.volId - b.volId);
      console.log(`[comicvine] top scores: ${scored.slice(0, 3).map((s) =>
        `${s.r.volume?.name}(name=${s.nameScore} yr=${s.yearScore} pub=${s.publisherScore} total=${s.total} vid=${s.volId})`
      ).join(" | ")}`);
      match = scored[0].r;
    }
    // No match — don't fall through to results[0].

    console.log(
      `[comicvine] query="${searchQuery}" issue=${issueNumber} year=${year || "?"}` +
      ` results=${results.length} issueMatches=${candidates.length}` +
      ` matched=${match ? `${match.volume?.name} #${match.issue_number} (vol_id=${match.volume?.id})` : "none"}`
    );

    if (!match) return null;
    const firstApps = match.first_appearance_characters;
    const hasFirstApps = Array.isArray(firstApps) && firstApps.length > 0;
    return {
      id: match.id,
      name: match.name,
      issueNumber: match.issue_number,
      volume: match.volume?.name,
      description: match.description,
      firstAppearanceCharacters: hasFirstApps
        ? firstApps.map((c) => c?.name).filter(Boolean)
        : [],
    };
  } catch (err) {
    console.error(`[enrich] comicvine error: ${err?.message || err}`);
    return null;
  }
};

const CGC_MULTIPLIERS = {
  10: 12.0, 9.9: 8.0, 9.8: 5.0, 9.6: 3.0, 9.4: 2.2, 9.2: 1.8,
  9.0: 1.5, 8.5: 1.3, 8.0: 1.15, 7.5: 1.05, 7.0: 1.0, 6.5: 0.9,
  6.0: 0.85, 5.5: 0.8, 5.0: 0.75, 4.5: 0.7, 4.0: 0.65, 3.5: 0.6,
  3.0: 0.55, 2.5: 0.5, 2.0: 0.45, 1.8: 0.4, 1.5: 0.35, 1.0: 0.3,
  0.5: 0.2,
};

const RAW_MULTIPLIERS = {
  "NM": 1.0, "NM/M": 1.0,
  "VF/NM": 0.85, "VF": 0.75,
  "VF/F": 0.70, "FN/VF": 0.65,
  "FN": 0.55, "VG/FN": 0.50,
  "VG": 0.45, "VG/G": 0.40,
  "GD/VG": 0.35, "GD": 0.30,
  "FR/GD": 0.25, "FR": 0.20,
  "PR": 0.15,
};
const CGC_GRADES = Object.keys(CGC_MULTIPLIERS).map(Number).sort((a, b) => a - b);

const getGradeMultiplier = (grade) => {
  const g = Number(grade);
  if (isNaN(g)) return null;
  if (CGC_MULTIPLIERS[g] != null) return { multiplier: CGC_MULTIPLIERS[g], grade: g };
  let closest = CGC_GRADES[0];
  let minDist = Math.abs(g - closest);
  for (const k of CGC_GRADES) {
    const d = Math.abs(g - k);
    if (d < minDist) { closest = k; minDist = d; }
  }
  return { multiplier: CGC_MULTIPLIERS[closest], grade: closest };
};

// Parse a raw grade string like "VG 4.0" or "FR 1.0" into a multiplier.
// Step 1: extract numeric → find nearest CGC_MULTIPLIERS entry.
// Step 2: extract text abbreviation → look up RAW_MULTIPLIERS.
// Step 3: default 0.75.
const getRawGradeMultiplier = (gradeStr) => {
  if (!gradeStr) return { multiplier: 0.75, label: "RAW" };
  const s = String(gradeStr).trim();

  // Step 1: numeric portion
  const numMatch = s.match(/([\d.]+)/);
  if (numMatch) {
    const g = parseFloat(numMatch[1]);
    if (!isNaN(g) && g >= 0.5 && g <= 10) {
      const info = getGradeMultiplier(g);
      if (info) return { multiplier: info.multiplier, label: s };
    }
  }

  // Step 2: text abbreviation
  const textMatch = s.match(/^([A-Z][A-Z/]*)/i);
  if (textMatch) {
    const abbrev = textMatch[1].toUpperCase().replace(/\s+/g, "");
    if (RAW_MULTIPLIERS[abbrev] != null) {
      return { multiplier: RAW_MULTIPLIERS[abbrev], label: s };
    }
  }

  // Step 3: default
  return { multiplier: 0.75, label: s || "RAW" };
};

const PRICECHARTING_EXCLUDE =
  /facsimile|reprint|homage|variant|walmart|newsstand|mexican|authentix/i;

const lookupPriceCharting = async ({ title, issue, year }) => {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token || !title) return null;
  try {
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();
    const query = issue ? `${seriesName} ${issue}` : seriesName;
    const url =
      `https://www.pricecharting.com/api/products` +
      `?q=${encodeURIComponent(query)}&type=comic&t=${encodeURIComponent(token)}`;
    console.log(`[pricecharting] query="${query}"`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[pricecharting] HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const products = Array.isArray(json?.products) ? json.products : [];
    if (products.length === 0) return null;

    const issueStr = issue ? String(issue).trim() : null;
    const issueRe = issueStr
      ? new RegExp(`#${issueStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
      : null;

    const comicYear = year ? parseInt(String(year).trim(), 10) : null;

    for (const p of products) {
      const name = p["product-name"] || "";
      if (PRICECHARTING_EXCLUDE.test(name)) continue;
      if (issueRe && !issueRe.test(name)) continue;

      // Year validation: reject products from the wrong era.
      if (comicYear) {
        const yearMatch = name.match(/\((\d{4})\)/);
        const productYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
        if (productYear && Math.abs(productYear - comicYear) > 10) {
          console.log(`[pricecharting] skipping "${name}" — year ${productYear} vs ${comicYear}`);
          continue;
        }
      }

      const cents = p["loose-price"];
      if (cents == null || isNaN(cents) || cents <= 0) continue;
      const price = cents / 100;
      const yearMatch2 = name.match(/\((\d{4})\)/);
      const productYear = yearMatch2 ? parseInt(yearMatch2[1], 10) : null;
      console.log(`[pt] matched: "${name}" year: ${productYear} comic year: ${comicYear}`);
      // Stricter era check: skip if year gap > 15
      if (comicYear && productYear && Math.abs(productYear - comicYear) > 15) {
        console.log(`[pt] year mismatch — skipping`);
        continue;
      }
      return { price, productName: name, id: p.id, source: "pricecharting" };
    }
    console.log(`[pricecharting] no valid match in ${products.length} results`);
    return null;
  } catch (err) {
    console.error(`[pricecharting] error: ${err?.message || err}`);
    return null;
  }
};

const lookupXimilar = async ({ images, title, confidence }) => {
  if (!process.env.XIMILAR_API_TOKEN) return null;
  const rawConfidence = parseFloat(
    String(confidence ?? "").replace(/[^\d.]/g, "")
  );
  const lowConfidence = !isNaN(rawConfidence) && rawConfidence < 75;
  const weakTitle = !title || String(title).trim().length < 3;
  if (!lowConfidence && !weakTitle) return null;
  if (!Array.isArray(images) || images.length === 0) return null;

  try {
    const firstImg = String(images[0] || "");
    const m = firstImg.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    const b64 = m ? m[2] : firstImg.replace(/^data:[^;]+;base64,/, "");

    const res = await fetch(
      "https://api.ximilar.com/collectibles/v2/comics_id",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.XIMILAR_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: [{ _base64: b64 }] }),
      }
    );
    if (!res.ok) {
      console.error(`[enrich] ximilar HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const rec = Array.isArray(json?.records) ? json.records[0] : null;
    const idBlock =
      rec?._identification?.best_match ||
      rec?.best_match ||
      rec?._objects?.[0]?._identification?.best_match ||
      null;
    if (!idBlock) return null;
    const name = idBlock.name || idBlock.full_name || idBlock.title || null;
    const issueNumber =
      idBlock.issue_number || idBlock.issue || idBlock.number || null;
    const publisher = idBlock.publisher || null;
    const year =
      idBlock.year ||
      idBlock.publication_year ||
      (idBlock.publication_date
        ? String(idBlock.publication_date).slice(0, 4)
        : null);
    return {
      name,
      issueNumber,
      publisher,
      year: year ? String(year) : null,
      weakTitle,
    };
  } catch (err) {
    console.error(`[enrich] ximilar error: ${err?.message || err}`);
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const {
      title,
      issue,
      grade,
      confidence,
      images,
      isGraded,
      numericGrade,
      year,
      publisher,
    } = req.body || {};
    if (!title) {
      res.status(400).json({ error: "title required" });
      return;
    }

    // Prefer explicit issue param, fall back to parsing from title.
    const issueMatch = String(title).match(/#\s*(\d+)/);
    const issueNum = issue || (issueMatch ? issueMatch[1] : null);

    const compsPromise =
      process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID
        ? fetchComps({
            title,
            issue: issueNum,
            grade,
            isGraded,
            numericGrade,
            year,
            appId: process.env.EBAY_APP_ID,
            certId: process.env.EBAY_CERT_ID,
          }).catch((err) => {
            console.error(`[enrich] comps error: ${err?.message || err}`);
            return null;
          })
        : Promise.resolve(null);

    const [comicVine, compsFromEbay, ximilar, soldResult, priceCharting] = await Promise.all([
      lookupComicVine({ title, issue: issueNum, year, publisher }),
      compsPromise,
      lookupXimilar({ images, title, confidence }),
      fetchSold({ title, issue: issueNum, year }).catch(() => []),
      lookupPriceCharting({ title, issue: issueNum, year }).catch(() => null),
    ]);

    // AI verification pass on the comps that will be displayed. Verifies
    // each listing title from rawComps.prices (which carries titles in the
    // same order as recentSales) and filters recentSales by the returned
    // boolean array. Silent fallback: any failure leaves comps unchanged.
    let rawComps = compsFromEbay;
    if (
      rawComps &&
      Array.isArray(rawComps.recentSales) &&
      rawComps.recentSales.length > 0 &&
      Array.isArray(rawComps.prices)
    ) {
      const verifyCount = rawComps.recentSales.length;
      const titlesToVerify = rawComps.prices
        .slice(0, verifyCount)
        .map((p) => p.title || "");
      const issueMatch = String(title).match(/#\s*(\d+)/);
      const issueNum = issueMatch ? issueMatch[1] : null;
      const seriesTitle = issueMatch
        ? String(title).replace(issueMatch[0], "").trim()
        : title;
      const keepFlags = await verifyCompsTitles({
        title: seriesTitle,
        issue: issueNum,
        year,
        publisher,
        listings: titlesToVerify,
      });
      if (Array.isArray(keepFlags)) {
        const verifiedSales = rawComps.recentSales.filter(
          (_, i) => keepFlags[i]
        );
        const removed = verifyCount - verifiedSales.length;

        // Recompute stats from the verified subset so count, averages,
        // and low/high all reflect the AI-approved comps — no more
        // "count=3 but only 2 rows shown" inconsistency in the UI.
        const verifiedPrices = verifiedSales
          .map((s) => s.price)
          .filter(Boolean);
        const verifiedCount = verifiedPrices.length;
        const verifiedAvg = verifiedCount
          ? verifiedPrices.reduce((a, b) => a + b, 0) / verifiedCount
          : null;
        const verifiedLow = verifiedCount
          ? Math.min(...verifiedPrices)
          : null;
        const verifiedHigh = verifiedCount
          ? Math.max(...verifiedPrices)
          : null;

        rawComps = {
          ...rawComps,
          recentSales: verifiedSales,
          count: verifiedCount,
          average: verifiedAvg,
          averageFormatted: fmtUsd(verifiedAvg),
          lowest: verifiedLow,
          lowestFormatted: fmtUsd(verifiedLow),
          highest: verifiedHigh,
          highestFormatted: fmtUsd(verifiedHigh),
          verifiedByAI: true,
          verificationRemoved: removed,
        };
        console.log(
          `[enrich] AI verify: kept ${verifiedCount}/${verifyCount} (removed ${removed})`
        );
      }
    }

    const out = {};

    if (comicVine) {
      out.comicVine = comicVine;
    }

    // Key issue: prefer ComicVine first appearances, fall back to Claude data.
    const cvChars = comicVine?.firstAppearanceCharacters;
    if (Array.isArray(cvChars) && cvChars.length > 0) {
      out.keyIssue = `1st appearance of ${cvChars.join(", ")}`;
    } else if (
      req.body?.keyIssue &&
      req.body.keyIssue !== "N/A" &&
      String(req.body.keyIssue).length > 3
    ) {
      out.keyIssue = req.body.keyIssue;
    } else {
      out.keyIssue = null;
    }

    // Primary price source: PriceCharting (aggregated sold data).
    // For graded comics, apply a CGC multiplier against the raw base price.
    // For raw comics, apply a raw grade multiplier against the base price.
    // Fallback: Browse API comps (active listings).
    if (priceCharting) {
      let pc = priceCharting.price;
      if (isGraded === true && numericGrade != null) {
        const gradeInfo = getGradeMultiplier(numericGrade);
        if (gradeInfo) {
          const adjusted = pc * gradeInfo.multiplier;
          out.price = fmtUsd(adjusted);
          out.priceLow = fmtUsd(adjusted * 0.85);
          out.priceHigh = fmtUsd(adjusted * 1.15);
          out.gradeMultiplier = gradeInfo.multiplier;
          out.priceNote = `CGC ${numericGrade} estimate`;
          console.log(
            `[enrich] pricecharting base=$${pc} × ${gradeInfo.multiplier} (CGC ${numericGrade}) = $${adjusted.toFixed(2)}`
          );
        }
      } else {
        // Raw comic: apply grade multiplier from grade string.
        const rawInfo = getRawGradeMultiplier(grade);
        const adjusted = pc * rawInfo.multiplier;
        out.price = fmtUsd(adjusted);
        out.priceLow = fmtUsd(adjusted * 0.75);
        out.priceHigh = fmtUsd(adjusted * 1.25);
        out.gradeMultiplier = rawInfo.multiplier;
        out.priceNote = `${rawInfo.label} estimate`;
        console.log(
          `[enrich] pricecharting base=$${pc} × ${rawInfo.multiplier} (${rawInfo.label}) = $${adjusted.toFixed(2)}`
        );
      }
      out.pricingSource = "pricecharting";

      // Sanity check: compare PC price against eBay comps average.
      const compsAvg = compsFromEbay?.average;
      if (compsAvg && compsAvg > 5) {
        const pcNum = parseFloat(
          String(out.price || '0').replace(/[$,]/g, '')
        );

        // PC way too high vs market
        if (pcNum > compsAvg * 3) {
          const fallback = Math.round(compsAvg * 1.15);
          out.price = fmtUsd(fallback);
          out.priceLow = fmtUsd(compsAvg * 0.75);
          out.priceHigh = fmtUsd(compsAvg * 1.5);
          out.pricingSource = "browse_api";
          out.priceNote = "PC outlier — eBay avg used";
          console.log('[sanity] PC', pcNum,
            '> comps*3', compsAvg * 3, '→ fallback');
        }

        // PC way too low vs market floor
        if (pcNum < compsAvg * 0.3 && pcNum < compsAvg - 10) {
          const fallback = Math.round(compsAvg * 1.0);
          out.price = fmtUsd(fallback);
          out.priceLow = fmtUsd(compsAvg * 0.75);
          out.priceHigh = fmtUsd(compsAvg * 1.5);
          out.pricingSource = "browse_api";
          out.priceNote = "PC too low — eBay avg used";
          console.log('[sanity] PC', pcNum,
            '< comps*0.3', compsAvg * 0.3, '→ fallback');
        }
      }

      // If sanity check switched to browse_api but comps are actually empty,
      // the priceNote is misleading — clear it.
      if (out.pricingSource === "browse_api" && !(compsFromEbay?.average > 0)) {
        out.priceNote = null;
      }

      // Defect penalty: reduce price if Claude detected a significant defect.
      if (req.body.defectPenalty) {
        const pen = parseFloat(req.body.defectPenalty);
        if (pen > 0 && pen < 1) {
          const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
          out.price = fmtUsd(curPrice * pen);
          out.priceLow = fmtUsd(parseFloat(String(out.priceLow || '0').replace(/[$,]/g, '')) * pen);
          out.priceHigh = fmtUsd(parseFloat(String(out.priceHigh || '0').replace(/[$,]/g, '')) * pen);
          out.defectPenalty = pen;
          out.priceNote = (out.priceNote || '') + ' · defect adj';
          console.log(`[enrich] defect penalty ×${pen} applied`);
        }
      }
    } else if (rawComps && rawComps.count > 0) {
      out.price = fmtUsd(rawComps.average * 1.15);
      out.priceLow = fmtUsd(rawComps.lowest);
      out.priceHigh = fmtUsd(rawComps.highest);
      out.pricingSource = "browse_api";
    }

    if (rawComps && rawComps.count > 0) {
      out.comps = {
        count: rawComps.count,
        average: rawComps.averageFormatted,
        averageNum: rawComps.average,
        lowest: rawComps.lowestFormatted,
        lowestNum: rawComps.lowest,
        highest: rawComps.highestFormatted,
        highestNum: rawComps.highest,
        lastSoldDate: rawComps.lastSoldDateFormatted,
        recentSales: rawComps.recentSales,
        query: rawComps.query,
        fellBack: rawComps.fellBack,
        source: rawComps.source,
        verifiedByAI: rawComps.verifiedByAI === true,
        verificationRemoved:
          typeof rawComps.verificationRemoved === "number"
            ? rawComps.verificationRemoved
            : 0,
      };
    }

    // Sold comps from eBay completed listings
    const soldComps = Array.isArray(soldResult) ? soldResult : [];
    out.soldComps = soldComps;

    // Confidence level
    const verifiedCount = rawComps?.count || 0;
    const soldCount = soldComps.length;
    let confidenceLevel = "LOW";
    if (soldCount >= 2 && verifiedCount >= 2) confidenceLevel = "HIGH";
    else if (verifiedCount >= 2 || soldCount >= 1) confidenceLevel = "MEDIUM";
    out.confidenceLevel = confidenceLevel;

    // Recommended price
    const recommendedPrice =
      rawComps?.average != null
        ? Math.round(rawComps.average * 1.15)
        : null;

    // [verify] log line
    const seriesTitle = issueMatch
      ? String(title).replace(issueMatch[0], "").trim()
      : title;
    console.log(
      `[verify] ${seriesTitle} #${issueNum || "?"} | ` +
      `grade: ${grade || "unknown"} | ` +
      `comps: ${verifiedCount} verified / ${rawComps?.prices?.length || 0} checked | ` +
      `sold: ${soldCount} found | ` +
      `confidence: ${confidenceLevel} | ` +
      `recommended: ${recommendedPrice != null ? "$" + recommendedPrice : "AI est"}`
    );

    if (ximilar) {
      out.ximilar = {
        name: ximilar.name,
        issueNumber: ximilar.issueNumber,
        publisher: ximilar.publisher,
        year: ximilar.year,
      };
      // Only override title if Claude's was weak; never stomp a good title.
      if (ximilar.weakTitle && ximilar.name) {
        out.title = ximilar.issueNumber
          ? `${ximilar.name} #${ximilar.issueNumber}`
          : ximilar.name;
        out.identifiedBy = "ximilar";
      }
    }

    res.status(200).json(out);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
