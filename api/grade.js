import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT =
  "You are an expert comic book grader with 30 years experience. You know the CGC grading scale 0.5 to 10.0. You know every key issue. You know Golden age  Silver Age Bronze Age Copper Age Modern Age pricing. Return JSON only no markdown no explanation.";

// Fast path: Claude Vision identification + grade only. ComicVine, eBay
// comps and Ximilar enrichment are handled by /api/enrich and
// merged into the result card when they return.
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
    const body = req.body || {};
    const { images, image } = body;
    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: "images array required" });
      return;
    }
    // Reject oversized images up front. Anything over ~1MB as a base64
    // data URL (~750KB raw file) risks tripping Vercel's 4.5MB request
    // body limit once JSON overhead is added. The client compresses
    // aggressively before upload, but this is a defensive belt.
    const MAX_IMAGE_SIZE = 1024 * 1024;
    for (const img of images) {
      if (typeof img === "string" && img.length > MAX_IMAGE_SIZE) {
        res.status(413).json({
          error: "Image too large — please retake with lower resolution",
        });
        return;
      }
    }
    const noImage = !image;

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
        'Grade this comic book. Return ONLY this JSON shape with no markdown, no commentary: { "title": string, "issue": string, "publisher": string, "year": string, "grade": string, "isGraded": boolean, "numericGrade": number or null, "certNumber": string or null, "keyIssue": string or null, "price": string, "priceLow": string, "priceHigh": string, "reason": string, "confidence": string, "detectedPrice": string or null, "restoration": string or null, "defectPenalty": number or null }. title is the series name WITHOUT the issue number (e.g. "Amazing Spider-Man" not "Amazing Spider-Man #300"). issue is the issue number as a string (e.g. "300"). Set isGraded to true ONLY when a CGC, CBCS, or PGX slab label is clearly visible in the image; otherwise false. grade: always return both the letter grade AND numeric equivalent e.g. "VG 4.0", "GD- 1.8", "FN 6.0". Never return just a number or just letters alone. Set numericGrade to the numeric grade as a number (e.g. 9.8) when visible on a slab label, otherwise null. certNumber: if this is a CGC, CBCS, or PGX slab, extract the certification number from the label. CGC cert numbers are typically 10 digits (e.g. "1234567890"). Return null if not a slab or cert number not visible. If you see a price, bid amount, current bid, Buy It Now price, or starting price visible anywhere in the image (such as from a livestream overlay, auction listing, or price tag), return it as detectedPrice (e.g. "45.00"). Otherwise set detectedPrice to null. keyIssue: return a value for: first appearance of any character, origin issues, death of major character, first issue of a series (#1), last issue or final issue, classic artist significance (Jack Kirby, Steve Ditko, Kirby/Ditko art), notable historic covers. Return null for all other issues. NEVER return No, N/A, None, or negative text. restoration: if you detect any restoration (tape, color touch, trimming, added staples, spine reinforcement), describe it briefly. Return null if none detected. defectPenalty: if a significant cover defect exists (writing, tape, sticker, torn piece, water damage) return a multiplier between 0.5 and 0.9. Return null if no defects beyond normal wear.',
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

    if (noImage) parsed.noImage = true;

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
