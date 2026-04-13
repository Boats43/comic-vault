import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { comics } = req.body || {};
    if (!Array.isArray(comics) || comics.length === 0) {
      res.status(400).json({ error: "comics array required" });
      return;
    }

    // Build a compact summary + top books instead of sending full catalogue.
    const getPrice = (c) => {
      const p = parseFloat(String(c.price || "0").replace(/[^0-9.]/g, ""));
      return p > 0 ? p : (c.comps?.averageNum || 0);
    };

    const now = Date.now();
    const totalValue = comics.reduce((s, c) => s + getPrice(c), 0);
    const cgcCount = comics.filter((c) => c.isGraded === true).length;
    const publishers = {};
    const eras = { silver: 0, bronze: 0, modern: 0, other: 0 };
    comics.forEach((c) => {
      const pub = c.publisher || "Unknown";
      publishers[pub] = (publishers[pub] || 0) + 1;
      const yr = parseInt(c.year, 10);
      if (yr >= 1956 && yr <= 1969) eras.silver++;
      else if (yr >= 1970 && yr <= 1985) eras.bronze++;
      else if (yr >= 1986) eras.modern++;
      else eras.other++;
    });

    const stripped = comics.map((c) => ({
      id: c.id, title: c.title, issue: c.issue || null, publisher: c.publisher, year: c.year,
      grade: c.grade, isGraded: c.isGraded, numericGrade: c.numericGrade,
      keyIssue: c.keyIssue, price: c.price,
      status: c.status || "unlisted", timestamp: c.timestamp,
      value: getPrice(c),
    }));

    const topBooks = stripped.slice().sort((a, b) => b.value - a.value).slice(0, 10);
    const keyIssues = stripped.filter((c) => c.keyIssue && c.keyIssue !== "N/A" && c.keyIssue.length > 3);
    const unlisted = stripped.filter((c) => c.status !== "listed");
    const stagnant = stripped.filter((c) => c.status !== "listed" && (now - (c.timestamp || 0)) > 86400000 * 30);
    const rawHighValue = stripped.filter((c) => !c.isGraded && c.value >= 50);

    const summary = {
      totalBooks: comics.length,
      totalValue: Math.round(totalValue),
      avgValue: Math.round(totalValue / (comics.length || 1)),
      gradeDistribution: { CGC: cgcCount, raw: comics.length - cgcCount },
      publishers,
      eras,
      topValueBooks: topBooks,
      keyIssues: keyIssues.slice(0, 10),
      unlisted: unlisted.length,
      stagnant: stagnant.slice(0, 10),
      rawHighValue: rawHighValue.slice(0, 10),
    };

    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system:
        "You are an expert comic book dealer and collection manager with 30 years experience in the comic market. You know CGC grading, key issues, market trends, bundling strategy, and eBay selling tactics. Analyze collections and give actionable selling advice. Return JSON only, no markdown, no explanation.",
      messages: [
        {
          role: "user",
          content: `Analyze this comic collection and return ONLY this JSON shape:
{
  "trending": [{"id": string, "title": string, "reason": string}],
  "listNow": [{"id": string, "title": string, "reason": string}],
  "stagnant": [{"id": string, "title": string, "daysSinceAdded": number}],
  "bundleGroups": [{"titles": [string], "ids": [string], "reason": string, "suggestedPrice": number}],
  "gradeFirst": [{"id": string, "title": string, "reason": string}],
  "marketSummary": string,
  "totalValue": number,
  "valueChange": number
}

Rules:
- trending: books with strong recent market activity or upward price trends
- listNow: books at or near peak value — sell signal
- stagnant: books added 30+ days ago that are still unlisted
- bundleGroups: 2+ related books (same series, era, or character) that sell better as a lot
- gradeFirst: raw (ungraded) books worth $50+ that would benefit from CGC grading before sale
- marketSummary: 2-3 sentence overview of the collection's market position
- totalValue: estimated total collection value in dollars
- valueChange: estimated percent change vs 30 days ago (positive = up, negative = down)

Collection Summary:
${JSON.stringify(summary)}`,
        },
      ],
    });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { raw: text };
    }

    parsed.analyzedAt = Date.now();
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
