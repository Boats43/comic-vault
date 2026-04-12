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

    // Strip images to stay under body limits — Claude only needs metadata.
    const stripped = comics.map((c) => ({
      id: c.id,
      title: c.title,
      publisher: c.publisher,
      year: c.year,
      grade: c.grade,
      isGraded: c.isGraded,
      numericGrade: c.numericGrade,
      keyIssue: c.keyIssue,
      price: c.price,
      priceLow: c.priceLow,
      priceHigh: c.priceHigh,
      status: c.status || "unlisted",
      listedAt: c.listedAt || null,
      timestamp: c.timestamp,
      comps: c.comps
        ? {
            averageNum: c.comps.averageNum,
            lowestNum: c.comps.lowestNum,
            count: c.comps.count,
          }
        : null,
    }));

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

Collection (${stripped.length} books):
${JSON.stringify(stripped)}`,
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
