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
import { fetchComps, getOAuthToken } from "./comps.js";
import { fetchSold } from "./sold.js";
import { lookupCGC } from "./cgc-lookup.js";
import { lookupGoCollect } from "./gocollect.js";

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
      `For each listing reply with MATCH or NO_MATCH. MATCH if the ` +
      `listing is clearly the same comic — same title, same issue number, ` +
      `same era. If the title is a close match (same character, same series ` +
      `name, same issue number) accept it even if the listing title has ` +
      `extra words like "variant", "cover B", "ratio variant", "2nd print", ` +
      `"newsstand", or "facsimile". Only reject if it is clearly a different ` +
      `character or different issue number. ` +
      `Reply with only a JSON array like:\n[true, false, true, false]\n` +
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
      `&field_list=id,name,issue_number,cover_date,description,deck,first_appearance_characters,character_credits,story_arc_credits,volume` +
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

    // Parse description + deck for key-issue signals when structured
    // first_appearance_characters is empty (common for origin issues,
    // deaths, #1 issues, classic-artist-significance keys).
    const descText = `${match.deck || ""} ${match.description || ""}`
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let derivedKey = null;
    if (!hasFirstApps && descText) {
      const d = descText.toLowerCase();
      const faMatch = descText.match(/first appearance of ([^.!?;\n]{3,80})/i);
      const originMatch = descText.match(/origin of ([^.!?;\n]{3,80})/i);
      const deathMatch = descText.match(/death of ([^.!?;\n]{3,80})/i);
      if (faMatch) {
        derivedKey = `1st appearance of ${faMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (originMatch) {
        derivedKey = `Origin of ${originMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (deathMatch) {
        derivedKey = `Death of ${deathMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (/\bfirst appearance\b/.test(d)) {
        derivedKey = "1st appearance";
      } else if (/\borigin\b/.test(d) && /\bissue\b/.test(d)) {
        derivedKey = "Origin issue";
      }
      if (derivedKey) console.log("[comicvine] key derived from description:", derivedKey);
    }

    return {
      id: match.id,
      name: match.name,
      issueNumber: match.issue_number,
      volume: match.volume?.name,
      description: match.description,
      deck: match.deck,
      firstAppearanceCharacters: hasFirstApps
        ? firstApps.map((c) => c?.name).filter(Boolean)
        : [],
      derivedKeyIssue: derivedKey,
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
  if (!issue) {
    console.log("[pt] no issue number — skipping");
    return null;
  }
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
        if (productYear && Math.abs(productYear - comicYear) > 5) {
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
      // Stricter era check: skip if year gap > 5
      if (comicYear && productYear && Math.abs(productYear - comicYear) > 5) {
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

const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";

const lookupEbayVisual = async ({ imageBase64, claudeIssue, year }) => {
  // Modern books (1985+): Claude Vision reads issue numbers accurately.
  if (year && parseInt(year, 10) >= 1985) {
    console.log('[visual] modern book — trusting Claude Vision');
    return null;
  }
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId || !imageBase64) return null;
  try {
    const token = await getOAuthToken(appId, certId, BROWSE_SCOPE);
    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image" +
      "?category_ids=63&limit=5";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      body: JSON.stringify({ image: imageBase64 }),
    });
    if (!res.ok) {
      console.error(`[visual] eBay image search HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
    if (items.length === 0) return null;

    // Extract issue numbers from titles (1-3 digits only, skip years)
    console.log('[visual] titles:', items.map((r) => r.title));
    const issueNumbers = [];
    for (const item of items) {
      const title = item.title || "";
      const m = title.match(/#(\d{1,3})(?!\d)/);
      if (m && parseInt(m[1], 10) <= 999) issueNumbers.push(m[1]);
    }
    console.log('[visual] extracted issues:', issueNumbers);
    if (issueNumbers.length === 0) return null;

    // Find most common issue number (majority wins)
    const freq = {};
    for (const n of issueNumbers) {
      freq[n] = (freq[n] || 0) + 1;
    }
    let mostCommon = null;
    let maxCount = 0;
    for (const [num, count] of Object.entries(freq)) {
      if (count > maxCount) { mostCommon = num; maxCount = count; }
    }
    console.log('[visual] winner:', mostCommon, `(${maxCount}/${issueNumbers.length})`);

    const claudeStr = claudeIssue ? String(claudeIssue).trim() : null;
    if (maxCount < 3) {
      console.log('[visual] only', maxCount, 'matches — keeping Claude issue:', claudeStr);
      return null;
    }
    if (mostCommon && claudeStr && mostCommon !== claudeStr) {
      console.log(`[visual] Claude=#${claudeStr} eBay=#${mostCommon} → using #${mostCommon}`);
      return { issue: mostCommon, issueSource: "ebay_visual", claudeIssue: claudeStr };
    }
    console.log(`[visual] Claude=#${claudeStr} matches eBay=#${mostCommon || "none"} — keeping Claude`);
    return { issue: claudeStr, issueSource: "claude_vision" };
  } catch (err) {
    console.error(`[visual] eBay image search error: ${err?.message || err}`);
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (req.body?.warmup === true) {
    res.status(200).json({ warmed: true });
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
      certNumber,
    } = req.body || {};
    const titleLower = (title || "").toLowerCase();
    if (!title || titleLower.includes("not a comic") || titleLower === "unknown") {
      console.log("[enrich] rejected non-comic:", title);
      res.status(400).json({ error: "Not a comic book" });
      return;
    }

    // Prefer explicit issue param, fall back to parsing from title.
    const issueMatch = String(title).match(/#\s*(\d+)/);
    const issueNum = issue || (issueMatch ? issueMatch[1] : null);

    // Step 1: visual issue correction — runs before comps so the
    // corrected issue number flows into all downstream lookups.
    let visualBase64 = null;
    if (Array.isArray(images) && images.length > 0) {
      const firstImg = String(images[0] || "");
      const m = firstImg.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      visualBase64 = m ? m[2] : firstImg.replace(/^data:[^;]+;base64,/, "");
    }
    const visualResult = visualBase64
      ? await lookupEbayVisual({ imageBase64: visualBase64, claudeIssue: issueNum, year }).catch(() => null)
      : null;
    const correctedIssue = (visualResult?.issueSource === "ebay_visual" && visualResult.issue)
      ? visualResult.issue
      : issueNum;

    // Step 2: run everything else with the corrected issue number.
    const compsPromise =
      process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID
        ? fetchComps({
            title,
            issue: correctedIssue,
            grade,
            isGraded,
            numericGrade,
            year,
            variant: req.body.variant || null,
            publisher: publisher || null,
            appId: process.env.EBAY_APP_ID,
            certId: process.env.EBAY_CERT_ID,
          }).catch((err) => {
            console.error(`[enrich] comps error: ${err?.message || err}`);
            return null;
          })
        : Promise.resolve(null);

    const [comicVine, compsFromEbay, ximilar, soldResult, priceCharting, cgcResult, goCollectResult] = await Promise.all([
      lookupComicVine({ title, issue: correctedIssue, year, publisher }),
      compsPromise,
      lookupXimilar({ images, title, confidence }),
      fetchSold({ title, issue: correctedIssue, year }).catch(() => []),
      lookupPriceCharting({ title, issue: correctedIssue, year }).catch(() => null),
      certNumber ? lookupCGC(certNumber).catch(() => null) : Promise.resolve(null),
      lookupGoCollect({ title, issue: correctedIssue, year, publisher }).catch(() => null),
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
        if (removed > 0) {
          const rejectedTitles = titlesToVerify.filter((_, i) => !keepFlags[i]).slice(0, 3);
          console.log('[verify] removed titles:', rejectedTitles);
        }
      }
    }

    // Filter sold comps by issue number before blending — sold results
    // have no title verification, so wrong-issue listings can corrupt the avg.
    let filteredSold = Array.isArray(soldResult) ? soldResult : [];
    if (filteredSold.length > 0 && correctedIssue) {
      const issueRe = new RegExp(
        '#\\s*' + String(correctedIssue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'
      );
      const before = filteredSold.length;
      filteredSold = filteredSold.filter(s => issueRe.test(s.title || ''));
      if (filteredSold.length < before) {
        console.log('[sold-filter] kept', filteredSold.length, 'of', before, 'sold comps');
      }
    }

    // Blended average: weight sold comps (60%) + active comps (40%).
    const soldPrices = filteredSold
      .map(s => typeof s.price === 'number' ? s.price : parseFloat(String(s.price || '0').replace(/[$,]/g, '')))
      .filter(p => p > 0);
    const soldAvg = soldPrices.length > 0
      ? soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length
      : null;
    const activeAvg = rawComps?.average || null;
    let blendedAvg = null;
    if (soldAvg && activeAvg) {
      blendedAvg = (soldAvg * 0.6) + (activeAvg * 0.4);
      console.log('[blend] sold:', soldAvg, 'active:', activeAvg, 'blended:', blendedAvg.toFixed(2));
    } else if (soldAvg) {
      blendedAvg = soldAvg * 1.1;
    } else if (activeAvg) {
      blendedAvg = activeAvg;
    }

    const out = {};

    if (comicVine) {
      out.comicVine = comicVine;
    }

    // Key issue: prefer ComicVine structured data, then description-derived,
    // then Claude's keyIssue from /api/grade.
    const cvChars = comicVine?.firstAppearanceCharacters;
    if (Array.isArray(cvChars) && cvChars.length > 0) {
      out.keyIssue = `1st appearance of ${cvChars.join(", ")}`;
    } else if (comicVine?.derivedKeyIssue) {
      out.keyIssue = comicVine.derivedKeyIssue;
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
    let sanityFired = false;
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

      // Sanity check: compare PC price against blended/eBay comps average.
      const compsAvg = blendedAvg || compsFromEbay?.average;
      if (compsAvg && compsAvg > 5) {
        const pcNum = parseFloat(
          String(out.price || '0').replace(/[$,]/g, '')
        );

        // Grade-adjusted eBay fallback base for sanity overrides.
        const mult = out.gradeMultiplier || 1;
        const adjAvg = compsAvg * mult;

        // PC way too high vs market (compare final price to grade-adjusted avg).
        // Modern books (1985+) use a tighter 2x threshold; older books keep 3x.
        const sanityHighMult = (parseInt(year) >= 1985) ? 2 : 3;
        if (pcNum > adjAvg * sanityHighMult) {
          sanityFired = true;
          // Use raw compsAvg — eBay listings already reflect market grade.
          out.price = fmtUsd(compsAvg * 1.15);
          out.priceLow = fmtUsd(compsAvg * 0.75);
          out.priceHigh = fmtUsd(compsAvg * 1.5);
          out.pricingSource = "browse_api";
          out.priceNote = "PC outlier — eBay avg used";
          console.log('[sanity] PC', pcNum,
            '> adjAvg*' + sanityHighMult, adjAvg * sanityHighMult, '→ fallback compsAvg', compsAvg.toFixed(2));
        }

        // PC way too low vs market floor (compare final price to grade-adjusted avg)
        if (!sanityFired && pcNum < adjAvg * 0.5) {
          sanityFired = true;
          // Use raw compsAvg — eBay listings already reflect market grade.
          out.price = fmtUsd(compsAvg);
          out.priceLow = fmtUsd(compsAvg * 0.75);
          out.priceHigh = fmtUsd(compsAvg * 1.5);
          out.pricingSource = "browse_api";
          out.priceNote = "PC too low — eBay avg used";
          console.log('[sanity] PC', pcNum,
            '< adjAvg*0.5', adjAvg * 0.5, '→ fallback compsAvg', compsAvg.toFixed(2));
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
      // eBay listings already reflect market grade — do not multiply again.
      const browseBase = rawComps.average || 0;
      let browsePrice = browseBase;

      // Still record gradeMultiplier for downstream (floor guard, etc.)
      // but do NOT apply it to the browse price.
      if (isGraded === true && numericGrade != null) {
        const gInfo = getGradeMultiplier(numericGrade);
        if (gInfo) {
          out.gradeMultiplier = gInfo.multiplier;
          out.priceNote = `CGC ${numericGrade} estimate`;
        }
      } else if (grade) {
        const rawInfo = getRawGradeMultiplier(grade);
        out.gradeMultiplier = rawInfo.multiplier;
        out.priceNote = `${rawInfo.label} estimate`;
      }

      out.price = fmtUsd(browsePrice);
      out.priceLow = fmtUsd(browsePrice * 0.75);
      out.priceHigh = fmtUsd(browsePrice * 1.25);
      out.pricingSource = "browse_api";
    }

    // Snapshot pricing source BEFORE floor guard / variant / key blocks.
    // Variant and key multipliers should only apply when the base price
    // came from PriceCharting (not from browse_api or sanity fallback).
    const isFromPC = !!(priceCharting?.price) && !sanityFired && out.pricingSource === 'pricecharting';

    // Floor guard: never price below the lowest eBay comp.
    // eBay comps already reflect market grade — no grade multiplier on floor.
    // Floor is capped at compsAvg to prevent exceeding market.
    const finalNum = parseFloat(
      String(out.price || '0').replace(/[$,]/g, '')
    );
    const rawFloor = rawComps?.lowest || compsFromEbay?.lowest || 0;
    const compsAvgForCap = blendedAvg || compsFromEbay?.average || 0;
    let floorNum = rawFloor;
    if (floorNum > compsAvgForCap && compsAvgForCap > 0) {
      floorNum = compsAvgForCap;
      console.log('[floor] capped at comps avg', compsAvgForCap.toFixed(2));
    }

    let floorFired = false;
    if (floorNum > 0 && finalNum < floorNum) {
      floorFired = true;
      console.log('[floor] price', finalNum,
        '< floor', floorNum, `(raw ${rawFloor}, cap ${compsAvgForCap})`, '— enforcing');
      out.price = fmtUsd(floorNum);
      out.priceLow = fmtUsd(floorNum * 0.85);
      out.priceHigh = fmtUsd(floorNum * 1.25);
      out.priceNote = (out.priceNote || '') + ' · floor enforced';
    }

    console.log('[price-trace]',
      'pcBase:', priceCharting?.price,
      'multiplier:', out.gradeMultiplier,
      'afterMult:', parseFloat(String(out.price || '0').replace(/[$,]/g, '')),
      'compsAvg:', compsFromEbay?.average,
      'rawFloor:', rawComps?.lowest || 0,
      'floor:', floorNum,
      'floorFired:', floorFired,
      'finalPrice:', out.price,
      'source:', out.pricingSource
    );

    // Variant multiplier: adjust price for known variant types.
    // Only apply when PriceCharting is the pricing source — browse_api/ebay_avg
    // already reflect market for this specific variant.
    const variant = req.body.variant ? String(req.body.variant).trim() : null;
    if (variant && out.price && isFromPC) {
      const NO_PREMIUM = [
        'corner box', 'masterpieces', 'design variant', 'headshot',
        'trading card', 'cover a', 'cover b', 'cover c', 'cover d',
        'marvel legacy', 'legacy',
      ];
      const vLower = variant.toLowerCase();
      const isNoPremium = NO_PREMIUM.some((v) => vLower.includes(v));
      if (isNoPremium) {
        out.variantNote = variant;
        console.log('[variant] no premium — skipping mult');
      } else {
        const variantMultipliers = {
          'gold': 3.0,
          '2nd print': 1.5,
          'second print': 1.5,
          'newsstand': 1.3,
          'price variant': 2.0,
          'whitman': 2.0,
          '35 cent': 3.0,
          '30 cent': 3.0,
        };
        let vMult = null;
        for (const [key, mult] of Object.entries(variantMultipliers)) {
          if (vLower.includes(key)) { vMult = mult; break; }
        }
        if (vMult) {
          const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
          out.price = fmtUsd(curPrice * vMult);
          out.priceLow = fmtUsd(curPrice * vMult * 0.75);
          out.priceHigh = fmtUsd(curPrice * vMult * 1.25);
          out.variantNote = variant;
          out.variantMultiplier = vMult;
          console.log('[variant]', variant, '×', vMult);
        }
      }
    }

    // Key issue multiplier: tiered — major keys ×1.5, minor keys ×1.2.
    // Only apply when PriceCharting is the pricing source — browse_api/ebay_avg
    // already reflect market premium for the key.
    const keyStr = String(out.keyIssue || '').toLowerCase();
    const isMajorKey = keyStr.includes('1st appearance') ||
      keyStr.includes('first appearance') ||
      keyStr.includes('origin') ||
      keyStr.includes('death') ||
      keyStr.includes('first issue');
    const isMinorKey = !isMajorKey && (
      keyStr.includes('2nd appearance') ||
      keyStr.includes('second appearance') ||
      keyStr.includes('2nd') ||
      keyStr.includes('second app') ||
      keyStr.includes('first cover') ||
      keyStr.includes('cameo') ||
      keyStr.includes('iconic') ||
      keyStr.includes('classic')
    );
    const keyMult = isMajorKey ? 1.5 : isMinorKey ? 1.2 : 1.0;
    console.log('[key] keyIssue:', out.keyIssue, 'major:', isMajorKey, 'minor:', isMinorKey, 'mult:', keyMult, 'isFromPC:', isFromPC);
    if (keyMult > 1.0 && out.price && isFromPC && blendedAvg) {
      const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
      if (curPrice > 0) {
        out.price = fmtUsd(curPrice * keyMult);
        out.priceLow = fmtUsd(curPrice * keyMult * 0.75);
        out.priceHigh = fmtUsd(curPrice * keyMult * 1.25);
        out.keyMultiplier = keyMult;
        console.log('[key]', isMajorKey ? 'major' : 'minor', '×' + keyMult, '→', out.price);
      }
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

    // Sold comps from eBay completed listings (filtered by issue#)
    out.soldComps = filteredSold;

    // Confidence level — PC data guarantees at least MEDIUM.
    const verifiedCount = rawComps?.count || 0;
    const soldCount = filteredSold.length;
    const hasPCData = out.pricingSource === "pricecharting";
    let confidenceLevel = "LOW";
    if (soldCount >= 2 && verifiedCount >= 2) confidenceLevel = "HIGH";
    else if (verifiedCount >= 2 || soldCount >= 1 || hasPCData) confidenceLevel = "MEDIUM";
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
      `[verify] ${seriesTitle} #${correctedIssue || "?"} | ` +
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

    // eBay visual issue cross-validation
    if (visualResult) {
      out.issueSource = visualResult.issueSource;
      if (visualResult.issueSource === "ebay_visual") {
        out.issue = visualResult.issue;
        out.claudeIssue = visualResult.claudeIssue;
      }
    }

    // CGC cert verification override — authoritative data.
    if (cgcResult) {
      if (cgcResult.title) out.title = cgcResult.title;
      if (cgcResult.issue) out.issue = cgcResult.issue;
      if (cgcResult.grade != null) out.grade = cgcResult.grade;
      out.cgcVerified = true;
      out.cgcLabel = cgcResult.labelType || null;
      out.certNumber = cgcResult.certNumber;
    }

    // GoCollect CGC FMV data (null when API key not set)
    if (goCollectResult) {
      out.goCollect = goCollectResult;
    }

    res.status(200).json(out);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
