import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT =
  "You are an expert comic book grader with 30 years experience. You know the CGC grading scale 0.5 to 10.0. You know every key issue. You know Golden age  Silver Age Bronze Age Copper Age Modern Age pricing. Return JSON only no markdown no explanation.";

const JSON_SHAPE =
  '{ "title": string, "issue": string, "publisher": string, "year": string, "grade": string, "isGraded": boolean, "numericGrade": number or null, "certNumber": string or null, "keyIssue": string or null, "variant": string or null, "price": string, "priceLow": string, "priceHigh": string, "reason": string, "confidence": string, "detectedPrice": string or null, "restoration": string or null, "defectPenalty": number or null }';

const STANDARD_PROMPT =
  `Grade this comic book. Return ONLY this JSON shape with no markdown, no commentary: ${JSON_SHAPE}. title is the series name WITHOUT the issue number (e.g. "Amazing Spider-Man" not "Amazing Spider-Man #300"). issue is the issue number as a string (e.g. "300"). Set isGraded to true ONLY when a CGC, CBCS, or PGX slab label is clearly visible in the image; otherwise false. grade: always return both the letter grade AND numeric equivalent e.g. "VG 4.0", "GD- 1.8", "FN 6.0". Never return just a number or just letters alone. Set numericGrade to the numeric grade as a number (e.g. 9.8) when visible on a slab label, otherwise null. certNumber: if this is a CGC, CBCS, or PGX slab, extract the certification number from the label. CGC cert numbers are typically 10 digits (e.g. "1234567890"). Return null if not a slab or cert number not visible. If you see a price, bid amount, current bid, Buy It Now price, or starting price visible anywhere in the image (such as from a livestream overlay, auction listing, or price tag), return it as detectedPrice (e.g. "45.00"). Otherwise set detectedPrice to null. keyIssue: return a value for: first appearance of any character, origin issues, death of major character, first issue of a series (#1), last issue or final issue, classic artist significance (Jack Kirby, Steve Ditko, Kirby/Ditko art), notable historic covers. Return null for all other issues. NEVER return No, N/A, None, or negative text. variant: if this is a variant edition return a description. Examples: "2nd print", "gold cover", "newsstand", "direct edition", "whitman variant", "30 cent price variant". Return null for standard first prints. restoration: if you detect any restoration (tape, color touch, trimming, added staples, spine reinforcement), describe it briefly. Return null if none detected. defectPenalty: if a significant cover defect exists (writing, tape, sticker, torn piece, water damage) return a multiplier between 0.5 and 0.9. Return null if no defects beyond normal wear.`;

const WATCH_PROMPT =
  `Grade this comic book from a live video frame. Read the issue number DIRECTLY from the cover. Read the title DIRECTLY from the cover masthead. Do not infer or guess — only report what you see. If a price overlay is visible report as detectedPrice. Return ONLY this JSON shape with no markdown, no commentary: ${JSON_SHAPE}. title is the series name WITHOUT the issue number. issue is the issue number as a string. Set isGraded to true ONLY when a CGC/CBCS/PGX slab label is clearly visible. grade: always return both letter grade AND numeric e.g. "VG 4.0". certNumber: extract from slab label if visible, else null. keyIssue: first appearance, origin, death of major character, first issue, classic artist significance, notable covers — null for all others. NEVER return No, N/A, None. variant: describe if variant edition, null for standard first prints. restoration: describe briefly if detected, null if none. defectPenalty: 0.5-0.9 multiplier for significant cover defects, null if normal wear.`;

// Parse Claude response text into JSON, tolerating markdown fences.
const parseResponse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { raw: text };
  }
};

// Build image content blocks from base64 array.
const buildImageContent = (images) => {
  const content = [];
  for (const img of images) {
    const s = String(img);
    const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    const media_type = m ? m[1] : "image/jpeg";
    const data = m ? m[2] : s.replace(/^data:[^;]+;base64,/, "");
    content.push({ type: "image", source: { type: "base64", media_type, data } });
  }
  return content;
};

// Single-model call. Returns { parsed, ms }.
const callModel = async (model, imageContent, promptText) => {
  const t0 = Date.now();
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: [...imageContent, { type: "text", text: promptText }] }],
  });
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { parsed: parseResponse(text), ms: Date.now() - t0 };
};

// Self-correcting watch pipeline: Sonnet fast → Sonnet self-correct → Opus escalation.
const watchPipeline = async (imageContent, voiceContext) => {
  const SONNET = "claude-sonnet-4-20250514";
  const OPUS = "claude-opus-4-7";

  let prompt = WATCH_PROMPT;
  if (voiceContext) {
    prompt += "\nSeller said: " + voiceContext + ". Use this context to improve accuracy.";
  }

  // Pass 1: Sonnet fast identification
  const pass1 = await callModel(SONNET, imageContent, prompt);
  const r1 = pass1.parsed;
  const conf1 = String(r1.confidence || "").toLowerCase();
  const title1 = String(r1.title || "").toLowerCase();

  if (conf1 === "high" && !title1.includes("unknown")) {
    r1._watchPasses = 1;
    console.log(`[watch] pass1: ${pass1.ms}ms — high confidence, done`);
    return { result: r1, passes: 1, timings: { pass1: pass1.ms } };
  }

  // Pass 2: Sonnet self-correction with first-pass context
  const correctionPrompt =
    `First pass identified this as: ${r1.title || "unknown"} #${r1.issue || "?"}, ` +
    `grade: ${r1.grade || "?"}, confidence: ${conf1}. ` +
    `Review and correct if wrong. Focus on:\n` +
    `- Issue number (read directly from cover)\n` +
    `- Grade (check spine, corners, cover condition)\n` +
    `- Variant (check cover price, printing notice)\n` +
    `Return corrected JSON in this shape: ${JSON_SHAPE}. ` +
    `Return JSON only, no markdown.`;

  const pass2 = await callModel(SONNET, imageContent, correctionPrompt);
  const r2 = pass2.parsed;
  const conf2 = String(r2.confidence || "").toLowerCase();
  const title2 = String(r2.title || "").toLowerCase();

  if (conf2 !== "low" || title2.includes("unknown")) {
    r2._watchPasses = 2;
    console.log(`[watch] pass1: ${pass1.ms}ms pass2: ${pass2.ms}ms total: ${pass1.ms + pass2.ms}ms — ${conf2} confidence after correction`);
    return { result: r2, passes: 2, timings: { pass1: pass1.ms, pass2: pass2.ms } };
  }

  // Pass 3: Opus escalation — still low confidence after self-correction
  let opusPrompt = STANDARD_PROMPT;
  if (voiceContext) {
    opusPrompt += "\nSeller said: " + voiceContext + ". Use this context to improve accuracy.";
  }
  const pass3 = await callModel(OPUS, imageContent, opusPrompt);
  const r3 = pass3.parsed;
  r3._watchPasses = 3;
  console.log(`[watch] pass1: ${pass1.ms}ms pass2: ${pass2.ms}ms pass3: ${pass3.ms}ms total: ${pass1.ms + pass2.ms + pass3.ms}ms — Opus escalation`);
  return { result: r3, passes: 3, timings: { pass1: pass1.ms, pass2: pass2.ms, pass3: pass3.ms } };
};

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
    const imageContent = buildImageContent(images);

    // Watch mode: self-correcting multi-pass pipeline
    if (body.source === "watch") {
      const { result, passes, timings } = await watchPipeline(imageContent, body.voiceContext);
      if (noImage) result.noImage = true;
      res.setHeader("x-watch-passes", String(passes));
      res.setHeader("x-watch-timing", JSON.stringify(timings));
      res.status(200).json(result);
      return;
    }

    // Standard path: single Opus call
    let userPrompt = STANDARD_PROMPT;
    if (body.voiceContext) {
      userPrompt += "\nSeller said: " + body.voiceContext + ". Use this context to improve accuracy.";
    }

    const { parsed } = await callModel("claude-opus-4-7", imageContent, userPrompt);
    if (noImage) parsed.noImage = true;

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
