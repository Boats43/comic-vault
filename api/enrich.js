// POST /api/enrich
//
// Second-pass enrichment. Fires ComicVine, eBay comps, CGC census, and the
// Ximilar image fallback in parallel and returns everything together. The
// client displays the Claude /api/grade result immediately and merges this
// payload into the card when it resolves.
//
// Request body: { title, grade, confidence?, images? }
// Response: { comicVine?, comps?, census?, ximilar?, price?, priceLow?,
//             priceHigh?, keyIssue?, identifiedBy? }

import Anthropic from "@anthropic-ai/sdk";
import { fetchComps } from "./comps.js";
import { fetchCensus } from "./census.js";

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

const lookupComicVine = async ({ title }) => {
  if (!process.env.COMICVINE_API_KEY || !title) return null;
  try {
    const issueNumMatch = String(title).match(/#\s*(\d+)/);
    const issueNumber = issueNumMatch ? issueNumMatch[1] : null;
    const queryTitle = String(title).replace(/#\s*\d+/, "").trim();
    const url =
      `https://comicvine.gamespot.com/api/search/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
      `&format=json&resources=issue&query=${encodeURIComponent(queryTitle)}` +
      `&field_list=id,name,issue_number,description,first_appearance_characters,volume`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ComicVault/1.0" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];
    const match =
      (issueNumber &&
        results.find(
          (r) => String(r?.issue_number ?? "").trim() === String(issueNumber)
        )) ||
      results[0];
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

    const compsPromise =
      process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID
        ? fetchComps({
            title,
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

    const [comicVine, compsFromEbay, census, ximilar] = await Promise.all([
      lookupComicVine({ title }),
      compsPromise,
      fetchCensus({ title, grade }).catch(() => null),
      lookupXimilar({ images, title, confidence }),
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
      if (comicVine.firstAppearanceCharacters.length > 0) {
        out.keyIssue = `1st appearance of ${comicVine.firstAppearanceCharacters.join(", ")}`;
      }
    }

    if (rawComps && rawComps.count > 0) {
      out.price = rawComps.averageFormatted;
      out.priceLow = rawComps.lowestFormatted;
      out.priceHigh = rawComps.highestFormatted;
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

    if (census) out.census = census;

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
