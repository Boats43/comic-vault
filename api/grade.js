import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT =
  "You are an expert comic book grader with 30 years experience. You know the CGC grading scale 0.5 to 10.0. You know every key issue. You know Golden age  Silver Age Bronze Age Copper Age Modern Age pricing. Return JSON only no markdown no explanation.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { images } = req.body || {};
    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: "images array required" });
      return;
    }

    const content = [];
    for (const img of images) {
      const s = String(img);
      const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      const media_type = m ? m[1] : "image/jpeg";
      const data = m ? m[2] : s.replace(/^data:[^;]+;base64,/, "");
      content.push({
        type: "image",
        source: { type: "base64", media_type, data },
      });
    }
    content.push({
      type: "text",
      text:
        'Grade this comic book. Return ONLY this JSON shape with no markdown, no commentary: { "title": string, "publisher": string, "year": string, "grade": string, "keyIssue": string, "price": string, "priceLow": string, "priceHigh": string, "reason": string, "confidence": string }',
    });

    const message = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
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

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
