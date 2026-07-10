// Force redeploy 2026-06-19 — Pro plan active
import Anthropic from "@anthropic-ai/sdk";
import Jimp from "jimp";
import { lookupPedigree } from "../src/lib/pedigreeRegistry.js";
import {
  extractIdentityFromImageSearch,
  extractConsensus
} from "../src/lib/imageSearchIdentity.js";
import { getOAuthToken } from "./comps.js";
import { checkRateLimit } from "./rate-limit.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// A3 ACCESS GATE: T1 invite-only mechanism
function checkAccessGate(req) {
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) return null; // Gate disabled when env var not set
  const clientKey = req.headers['x-vault-key']?.trim();

  // DIAGNOSTIC: Log comparison without exposing full value
  const match = clientKey === accessCode;
  console.log(`[access] received_len=${clientKey?.length ?? 0} expected_len=${accessCode.length} match=${match}`);

  if (!match) {
    return { error: 'Access denied. Contact the vault administrator for an access code.', status: 401 };
  }
  return null;
}
const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";

const SYSTEM_PROMPT =
  "You are an expert comic book grader with 30 years experience. You know the CGC grading scale 0.5 to 10.0. You know every key issue. You know Golden age  Silver Age Bronze Age Copper Age Modern Age pricing. Return JSON only no markdown no explanation.";

const JSON_SHAPE =
  '{ "title": string, "issue": string, "publisher": string, "year": string, "foreignEdition": boolean, "grade": string, "isGraded": boolean, "numericGrade": number or null, "certNumber": string or null, "keyIssue": string or null, "variant": string or null, "creator": string or null, "price": string, "priceLow": string, "priceHigh": string, "reason": string, "confidence": string, "detectedPrice": string or null, "restoration": string or null, "defectPenalty": number or null, "cgcPenaltyFlags": { "storeStamp": { "detected": boolean, "pedigreeName": string or null }, "staplePopping": { "detected": boolean, "severity": "minor" or "severe" or null }, "polybagIndents": { "detected": boolean }, "cornerChips": { "detected": boolean, "count": number or null }, "pedigreeStamp": { "detected": boolean, "pedigreeName": string or null } } or null }';

const STANDARD_PROMPT =
  `Grade this comic book. Return ONLY this JSON shape with no markdown, no commentary: ${JSON_SHAPE}. title is the series name WITHOUT the issue number (e.g. "Amazing Spider-Man" not "Amazing Spider-Man #300"). CRITICAL: Return ONLY the comic series name in the title field. Do NOT include: grade labels (VG/FN/CGC/CBCS), years, publishers, condition descriptors, seller notes, format markers, or any other metadata. Extract just the series name from the masthead. issue is the issue number as a string (e.g. "300"). year: Read the publication year directly from the cover price box, indicia, or copyright notice. Books from 2025 or 2026: return "2025" or "2026" — never default to 2024 for recent books. Read it from the cover — do not guess. If year is not visible use context clues like art style, cover price, and characters. foreignEdition: Set to true if you see EXPLICIT visual evidence of a foreign edition: price in pence (e.g. "15p", "20p UK"), non-US currency (Canadian cents different from US, foreign publisher indicia visible on cover or copyright), or foreign-language title text. Set to false for standard US editions. When uncertain, set to false — only mark true when clear foreign indicators are present. Set isGraded to true ONLY when a CGC, CBCS, or PGX slab label is clearly visible in the image; otherwise false. grade: always return both the letter grade AND numeric equivalent e.g. "VG 4.0", "GD- 1.8", "FN 6.0". Never return just a number or just letters alone. Set numericGrade to the numeric grade as a number (e.g. 9.8) when visible on a slab label, otherwise null. certNumber: if this is a CGC, CBCS, or PGX slab, extract the certification number from the label. CGC cert numbers are typically 10 digits (e.g. "1234567890"). Return null if not a slab or cert number not visible. If you see a price, bid amount, current bid, Buy It Now price, or starting price visible anywhere in the image (such as from a livestream overlay, auction listing, or price tag), return it as detectedPrice (e.g. "45.00"). Otherwise set detectedPrice to null. keyIssue: return a value for: first appearance of any character, origin issues, death of major character, first issue of a series (#1), last issue or final issue, classic artist significance (Jack Kirby, Steve Ditko, Kirby/Ditko art), notable historic covers. Return null for all other issues. NEVER return No, N/A, None, or negative text. variant: if this is a variant edition return a SHORT STANDARDIZED description (under 5 words) using these formats: ratio variants: "1:25 variant", "1:50 variant". Artist/character variants: "Paco Medina Thing variant", "Alex Ross painted variant". Cover letter: "Cover B", "Cover C", "Cover D". Print variants: "2nd print", "newsstand", "direct edition", "whitman variant". Price variants: "30 cent variant", "35 cent variant". Special editions: "gold foil variant", "virgin variant", "sketch variant", "blank cover variant". Classic: "gold cover", "silver foil cover". CRITICAL: Only populate variant field when you can see EXPLICIT visual evidence of variant status (cover letter designation, ratio text, price difference, foil/virgin/sketch elements visible, or visible artist credit with variant label). Do NOT infer variant status from art style or artist recognition alone. If the cover shows no explicit variant indicators, return null even if you recognize a notable artist's style. Rare variants to specifically identify: "35 cent variant" or "30 cent variant": Marvel 1976-1977 test market — price box on cover shows 35¢ or 30¢ instead of standard 25¢/35¢. "Mark Jewelers variant": small insert booklet inside the comic advertising jewelry — look for "Mark Jewelers" insert visible at spine. "Whitman variant": diamond/Whitman logo on cover instead of standard logo. "Canadian price variant": different cover price in cents Canadian. "Pence variant": British price in pence. "double cover" or "triple cover": two or three covers on one book. "printing error": miscut, inverted cover, color error, missing ink. "Type 1A variant" or "Type 1B variant": early Marvel distribution variants. Always return these specifically if detected. Return null for standard first prints (Cover A). NEVER return just "variant" alone — always include the type. creator: extract the main cover artist name from cover credits or signature visible on the cover (e.g. "Brett Bean", "Frank Miller", "Jim Lee"). Return the artist who DREW the cover, not the writer or interior artist. Modern books (1990+) usually have it printed on the cover bottom or near the masthead. Return null if no creator credit is visible — do NOT guess from style. restoration: if you detect any restoration (tape, color touch, trimming, added staples, spine reinforcement), describe it briefly. Return null if none detected. defectPenalty: if a significant cover defect exists (writing, tape, sticker, torn piece, water damage) return a multiplier between 0.5 and 0.9. Return null if no defects beyond normal wear. cgcPenaltyFlags: detect five specific defects that affect CGC grading. Inspect cover, spine, edges, staples, and any visible stamps. Return as a nested object with these fields. Set each detected to true ONLY when you can clearly see the defect — when uncertain, set to false. Return null for the entire cgcPenaltyFlags object only if the image is too low-quality or partial to assess any of these. (1) storeStamp = {detected, pedigreeName}: detect circular ink stamps, retailer marks, or back-of-cover stamps identifying a comic shop. EXCEPT recognized pedigree stamps (Mile High Collection / Edgar Church, Pacific Coast, White Mountain, Promise Collection, Massachusetts, San Francisco, Boston, Allentown, Bethlehem, Big Apple, Crowley, Davis Crippen / "D Copy", Circle 8, Northford, Rockford, Twin Cities, Vancouver, Winnipeg, Curator, Larson, Long Beach, Oakland) — for those, leave storeStamp.detected=false and instead populate pedigreeStamp.pedigreeName with the recognized name. storeStamp.pedigreeName should be null (it is reserved for if you ever see a pedigree-style stamp here too — typically null). (2) staplePopping = {detected, severity}: detect staples tearing through spine, rusted staples, or missing staples. severity = "severe" when staple has fully torn through cover or interior; "minor" when early-stage rust or partial pull-through. Set severity to null when detected is false. (3) polybagIndents = {detected}: detect wave pattern across cover, rectangular seal-impression marks at edges, or visible horizontal/vertical pressure lines from polybag storage. (4) cornerChips = {detected, count}: detect missing pieces of paper at corners (NOT mere blunting or rounding) larger than a fingernail clipping. count = number of corners affected (1 to 4) when detected; null when detected is false. (5) pedigreeStamp = {detected, pedigreeName}: when you see a recognized pedigree stamp from the list above, set detected=true and pedigreeName to the canonical name (e.g. "Mile High Collection"). Set both to false/null when no recognized pedigree stamp is visible.`;

const WATCH_PROMPT =
  `Grade this comic book from a live video frame. Read the issue number DIRECTLY from the cover. Read the title DIRECTLY from the cover masthead. Do not infer or guess — only report what you see. If a price overlay is visible report as detectedPrice. Return ONLY this JSON shape with no markdown, no commentary: ${JSON_SHAPE}. title is the series name WITHOUT the issue number. CRITICAL: Return ONLY the series name — no grade labels, years, publishers, or metadata. issue is the issue number as a string. Set isGraded to true ONLY when a CGC/CBCS/PGX slab label is clearly visible. grade: always return both letter grade AND numeric e.g. "VG 4.0". certNumber: extract from slab label if visible, else null. keyIssue: first appearance, origin, death of major character, first issue, classic artist significance, notable covers — null for all others. NEVER return No, N/A, None. variant: standardized short description under 5 words. Ratio: "1:25 variant". Artist: "Alex Ross variant". Cover letter: "Cover B". Print: "newsstand", "2nd print". Special: "virgin variant", "gold foil variant". Null for standard Cover A. Never return just "variant" alone. restoration: describe briefly if detected, null if none. defectPenalty: 0.5-0.9 multiplier for significant cover defects, null if normal wear.`;

// Session 4B — Book Vision prompt
const BOOK_JSON_SHAPE = '{ "title": string, "author": string or null, "publisher": string or null, "year": string or null, "edition": string or null, "format": string, "isbn": string or null, "grade": string, "signed": boolean, "restoration": string or null, "defectPenalty": number or null, "price": string, "priceLow": string, "priceHigh": string, "reason": string, "confidence": string, "detectedPrice": string or null, "assetType": "book" }';

const BOOK_PROMPT =
  `Identify and assess this book. Return ONLY this JSON shape with no markdown, no commentary: ${BOOK_JSON_SHAPE}. title is the book title WITHOUT edition/format markers (e.g. "Thinking Fast and Slow" not "Thinking Fast and Slow Paperback First Edition"). Extract from cover or title page. author is the author name (e.g. "Daniel Kahneman"). Return null if not visible. publisher is the publisher name if visible on cover or spine (e.g. "Farrar, Straus and Giroux"). Return null if not visible. year: Read publication year from copyright page, cover, or spine. Return null if not visible — do NOT guess. edition: extract edition descriptor if visible (e.g. "First Edition", "Revised Edition", "Second Edition"). Return null for standard/unmarked editions. format: REQUIRED. Return one of: "Hardcover", "Paperback", "Trade Paperback", "Mass Market", "Kindle", "eBook". Read from cover — hardcovers have dust jackets or stiff boards; paperbacks have flexible covers. isbn: extract ISBN from barcode or back cover (10 or 13 digits, with or without hyphens). Return null if not visible. grade: assess book condition using book grading scale. Return one of: "Fine" (minimal wear, tight binding, clean pages), "Very Good" (minor wear, pages clean, binding solid), "Good" (moderate wear, some foxing/aging, binding intact), "Fair" (heavy wear, loose binding, staining/marks present), "Poor" (severe damage, loose pages, heavy staining). Always return condition as word grade, NOT numeric. signed: true if author signature is visible on title page or elsewhere, otherwise false. restoration: describe if detected (tape on spine, rebinding, torn page repair). Return null if none detected. defectPenalty: if significant defects exist (water damage, torn pages, missing dust jacket when expected, heavy staining, broken spine) return a multiplier between 0.5 and 0.9. Return null if normal wear for grade. price, priceLow, priceHigh: estimate market value based on edition, condition, author significance, and scarcity. If you see a price visible in the image (price sticker, auction overlay, listing price), return it as detectedPrice. Otherwise set detectedPrice to null. reason: brief condition report (2-3 sentences) describing visible wear, edition notes, and value factors. confidence: "low", "medium", or "high" based on image quality and visible information. assetType: ALWAYS set to "book" for this prompt.`;

// Ship #EBAY-FIRST — Grade-only prompt for Sonnet when identity is already known from eBay.
// Simplified task: just assess condition and defects. Identity fields passed in separately.
const GRADE_JSON_SHAPE = '{ "grade": string, "isGraded": boolean, "numericGrade": number or null, "certNumber": string or null, "restoration": string or null, "defectPenalty": number or null, "cgcPenaltyFlags": { "storeStamp": { "detected": boolean, "pedigreeName": string or null }, "staplePopping": { "detected": boolean, "severity": "minor" or "severe" or null }, "polybagIndents": { "detected": boolean }, "cornerChips": { "detected": boolean, "count": number or null }, "pedigreeStamp": { "detected": boolean, "pedigreeName": string or null } } or null, "reason": string, "confidence": string, "detectedPrice": string or null }';

const buildGradeOnlyPrompt = (consensus) => {
  return `You are grading this comic book: ${consensus.title} #${consensus.issue}${consensus.year ? ` (${consensus.year})` : ''}${consensus.publisher ? ` - ${consensus.publisher}` : ''}.

The book's identity has already been verified by eBay image search (${consensus.agreement?.total ?? 'multiple'} matching listings, ${Math.round(consensus.confidence * 100)}% confidence).

Your ONLY task: Grade this book and detect defects.

Return ONLY this JSON shape with no markdown: ${GRADE_JSON_SHAPE}

grade: letter grade AND numeric e.g. "VG 4.0", "NM 9.4"
isGraded: true if CGC/CBCS/PGX slab visible, else false
numericGrade: numeric grade from slab label (e.g. 9.8), null if not slabbed
certNumber: CGC/CBCS/PGX cert number if visible, else null
restoration: describe if detected (tape, color touch, etc.), null if none
defectPenalty: 0.5-0.9 multiplier for significant defects (writing, sticker, tear, water damage), null if normal wear
cgcPenaltyFlags: detect 5 specific defects (storeStamp, staplePopping, polybagIndents, cornerChips, pedigreeStamp) - same format as full prompt
reason: brief condition report (2-3 sentences)
confidence: "low", "medium", or "high"
detectedPrice: any visible price/bid overlay (e.g. "45.00"), null if none`;
};

// Parse Claude response text into JSON, tolerating markdown fences.
const parseResponse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return { raw: text }; }
    }
    return { raw: text };
  }
};

// Session 4B — Import book signal detection from shared classifier module.
// Moved from local definition to avoid cross-module handler imports (api/enrich
// importing api/grade pulls grade's handler into enrich's bundle).
import { detectBookSignals } from '../src/lib/categoryClassifier.js';

// Session 4B — Ensure assetType is set on every response path.
// Single choke point: all res.status(200).json() calls pass through this.
// Prevents assetType from being undefined regardless of which path
// (Vision fallback, eBay-first, watch pipeline) the scan takes.
const ensureAssetType = (responseObj, initialScan = null) => {
  if (!responseObj.assetType) {
    const isBook = detectBookSignals(responseObj) ||
                   (initialScan && detectBookSignals(initialScan));
    responseObj.assetType = isBook ? 'book' : 'comic';
  }
  return responseObj;
};

// Ship #19 MVP — AI-CROSS-LAYER-DISCONNECT edition warning detection.
//
// Scans Vision's free-form `reason` text for reprint / later-print /
// facsimile signals. When detected, surfaces an `editionWarning` flag
// and the UI gates the List-on-eBay button until the user acknowledges.
//
// This closes the data-flow gap behind the Star Wars #1 live-listing bug:
// Vision's Condition Report explicitly said "35 cent REPRINT edition"
// and "NOT the rare 35 cent first print variant", but the pricing
// engine never read the text — so 1st-print comps anchored the price
// at $297 for a book that trades at $20-50.
//
// MVP SCOPE: detection + gate only. Pricing math untouched. Phase 2
// (Ship #19b) will add comp pool filtering + recalibration.
//
// Patterns use word boundaries so "reprinted" does NOT match
// "reprint" (different word form). Case-insensitive by default;
// the "NOT the" pattern is case-sensitive because Vision uses
// all-caps NOT for emphasis — that's a higher-confidence signal.
const EDITION_WARNING_PATTERNS = [
  // Ship #20a.6.14 — negative lookahead excludes "reprint series" (first printing
  // of issue #1 of a series that reprints old content). Tales to Astonish Sub-Mariner
  // #1 (1979) false-positive: Vision says "issue #1 of the reprint series" but the
  // issue itself IS a first printing. Pattern now: "reprint" NOT followed by "series".
  { kind: 'reprint',          re: /\breprint(?!\s+series)(?:\s+edition)?\b/i },
  { kind: 'facsimile',        re: /\bfacsimile\b/i },
  { kind: 'later-printing',   re: /\blater\s+print(?:ing)?\b/i },
  { kind: 'not-first-print',  re: /\bnot\s+(?:the\s+)?(?:(?:rare|original)\s+(?:\S+\s+){0,4})?(?:first|1st)\s+(?:\S+\s+){0,2}(?:print|edition|printing)\b/i },
  { kind: 'not-original',     re: /\bNOT\s+the\s+(?:original|rare|first|1st)\b/ },
  { kind: 'less-valuable',    re: /\bsignificantly\s+less\s+valuable\b/i },
  { kind: 'second-print',     re: /\b(?:2nd|second)\s+print(?:ing)?\b/i },
  { kind: 'third-print',      re: /\b(?:3rd|third)\s+print(?:ing)?\b/i },
];

// Pure helper — scan Vision's reason text. Returns:
//   { detected: true, signals: ['kind', ...], source: 'vision-condition-report' }
// when ≥1 pattern fires, or null otherwise. Signals deduped and
// stable-ordered (pattern array order). Safe on null/empty/non-string.
export const detectEditionWarning = (reason) => {
  if (!reason || typeof reason !== 'string') return null;
  const signals = [];
  const seen = new Set();
  for (const { kind, re } of EDITION_WARNING_PATTERNS) {
    if (seen.has(kind)) continue;
    if (re.test(reason)) {
      signals.push(kind);
      seen.add(kind);
    }
  }
  if (signals.length === 0) return null;
  return {
    detected: true,
    signals,
    source: 'vision-condition-report',
  };
};

// Ship #18 — post-parse pedigree cross-validation.
// Vision claims a pedigreeName; the registry normalizes alias→canonical
// (e.g. "Edgar Church" → "Mile High Collection") and flags recognized.
// Strict match policy (Q3 Option A): no fuzzy matching. Unrecognized
// claims surface so the UI can warn "verify manually".
//
// Mutates the parsed object in-place and returns it. Safe to call when
// cgcPenaltyFlags is null/missing — early-returns without throwing.
const enrichPedigree = (parsed) => {
  const flags = parsed?.cgcPenaltyFlags;
  if (!flags || typeof flags !== 'object') return parsed;
  const ped = flags.pedigreeStamp;
  if (!ped || typeof ped !== 'object') return parsed;
  if (!ped.detected || !ped.pedigreeName) {
    ped.recognized = false;
    ped.canonical = null;
    ped.era = null;
    return parsed;
  }
  const lookup = lookupPedigree(ped.pedigreeName);
  ped.recognized = lookup.recognized;
  ped.canonical = lookup.canonical;
  ped.era = lookup.era;
  if (lookup.recognized && lookup.canonical) {
    // Normalize the surfaced pedigreeName to canonical so UI/storage
    // use the standard form regardless of which alias Vision returned.
    ped.pedigreeName = lookup.canonical;
  }
  return parsed;
};

// Ship #EBAY-FIRST — eBay image search for primary identity source.
// Returns { consensus, rawItems } when successful, null when failed or low confidence.
const lookupEbayIdentity = async (imageBase64) => {
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  if (!appId || !certId || !imageBase64) {
    console.log('[ebay-id] missing credentials or image');
    return null;
  }

  try {
    // Strip data URI prefix if present (eBay expects pure base64)
    let cleanBase64 = String(imageBase64);
    const dataUriMatch = cleanBase64.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/);
    if (dataUriMatch) {
      cleanBase64 = dataUriMatch[1];
      console.log('[ebay-id] stripped data URI prefix');
    }

    const token = await getOAuthToken(appId, certId, BROWSE_SCOPE);
    // Category 259104 = Comic Books > Single Issues (correct category for comics)
    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image" +
      "?category_ids=259104&limit=20";

    console.log('[ebay-id] calling eBay image search API...');
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      body: JSON.stringify({ image: cleanBase64 }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[ebay-id] HTTP ${res.status}: ${errorText}`);
      return null;
    }

    const json = await res.json();
    const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];

    if (items.length === 0) {
      console.log('[ebay-id] no results from eBay');
      console.log('[ebay-id] response:', JSON.stringify(json).slice(0, 500));
      return null;
    }

    console.log(`[ebay-id] found ${items.length} matches`);
    console.log('[ebay-id] first 3 titles:', items.slice(0, 3).map(i => i.title));

    // Parse all listings into structured identity rows
    const parsedRows = extractIdentityFromImageSearch(items);

    // Extract consensus
    const consensus = extractConsensus(parsedRows);

    if (!consensus) {
      console.log('[ebay-id] no consensus (low agreement)');
      return null;
    }

    console.log(`[ebay-id] consensus: ${consensus.title} #${consensus.issue} (${consensus.confidence} confidence)`);

    return {
      consensus,
      rawItems: items,
      parsedRows,
    };
  } catch (err) {
    console.error(`[ebay-id] error: ${err?.message || err}`);
    return null;
  }
};

// Resize image to 800px max dimension before sending to Vision API.
// Claude Vision accuracy plateaus at ~800px for comic cover ID, and smaller
// images = faster upload + inference + lower image token cost (~75% reduction).
const resizeImageForVision = async (base64String) => {
  const MAX_DIMENSION = 800;

  // Pre-validation: fail-fast on invalid input (never send raw image to Vision)
  if (typeof base64String !== 'string' || base64String.length < 100) {
    throw new Error('Invalid image input: expected base64 string');
  }

  try {
    // Strip data URI prefix if present
    const raw = base64String.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/, ''
    );
    const buffer = Buffer.from(raw, 'base64');
    const image = await Jimp.read(buffer);
    const { width, height } = image.bitmap;

    // Already small enough — return original
    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
      return raw;
    }

    // Resize maintaining aspect ratio
    const resized = width > height
      ? image.resize(MAX_DIMENSION, Jimp.AUTO)
      : image.resize(Jimp.AUTO, MAX_DIMENSION);

    const resizedBuffer = await resized
      .quality(85)
      .getBufferAsync(Jimp.MIME_JPEG);

    const originalKB = Math.round(raw.length / 1024);
    const resizedKB = Math.round(resizedBuffer.length * 4 / 3 / 1024); // base64 is ~4/3 larger

    console.log(`[resize] ${width}×${height} → ${resized.bitmap.width}×${resized.bitmap.height} (${originalKB}KB → ${resizedKB}KB)`);

    return resizedBuffer.toString('base64');
  } catch (err) {
    console.error('[resize] failed:', err?.message);
    throw new Error('Image resize failed — please retake photo');
  }
};

// Build image content blocks from base64 array.
const buildImageContent = async (images) => {
  const content = [];
  for (const img of images) {
    const s = String(img);
    const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    const media_type = m ? m[1] : "image/jpeg";
    const rawData = m ? m[2] : s.replace(/^data:[^;]+;base64,/, "");

    // Resize before sending to Vision
    const data = await resizeImageForVision(rawData);

    content.push({ type: "image", source: { type: "base64", media_type, data } });
  }
  return content;
};

// Single-model call. Returns { parsed, ms }.
const callModel = async (model, imageContent, promptText) => {
  const t0 = Date.now();
  // Prompt caching: Move large static prompts to system with cache_control
  // This caches STANDARD_PROMPT/WATCH_PROMPT/BOOK_PROMPT (~1,500 tokens)
  // Savings: ~96% on prompt portion for batch scans (5-min cache TTL)
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: promptText, cache_control: { type: "ephemeral" } }
    ],
    messages: [{ role: "user", content: imageContent }],
  });
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { parsed: parseResponse(text), ms: Date.now() - t0 };
};

// Self-correcting watch pipeline: Haiku fast → Haiku self-correct → Opus escalation.
const watchPipeline = async (imageContent, voiceContext) => {
  const HAIKU = "claude-haiku-4-5-20251001";
  const OPUS = "claude-opus-4-7";

  let prompt = WATCH_PROMPT;
  if (voiceContext) {
    prompt += "\nSeller said: " + voiceContext + ". Use this context to improve accuracy.";
  }

  // Pass 1: Sonnet fast identification
  const pass1 = await callModel(HAIKU, imageContent, prompt);
  const r1 = pass1.parsed;
  const conf1 = String(r1.confidence || "").toLowerCase();
  const title1 = String(r1.title || "").toLowerCase();

  if (conf1 === "high" && !title1.includes("unknown")) {
    r1._watchPasses = 1;
    console.log(`[watch] pass1: ${pass1.ms}ms — high confidence, done`);
    console.log(`[watch-stats] pass=1 conf=${r1.confidence} title=${r1.title ? 'present' : 'missing'}`);
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

  const pass2 = await callModel(HAIKU, imageContent, correctionPrompt);
  const r2 = pass2.parsed;
  const conf2 = String(r2.confidence || "").toLowerCase();
  const title2 = String(r2.title || "").toLowerCase();

  if (conf2 !== "low" && !title2.includes("unknown")) {
    r2._watchPasses = 2;
    console.log(`[watch] pass1: ${pass1.ms}ms pass2: ${pass2.ms}ms total: ${pass1.ms + pass2.ms}ms — ${conf2} confidence after correction`);
    console.log(`[watch-stats] pass=2 conf=${r2.confidence} title=${r2.title ? 'present' : 'missing'}`);
    return { result: r2, passes: 2, timings: { pass1: pass1.ms, pass2: pass2.ms } };
  }

  // Pass 3: Opus escalation — still low confidence after self-correction
  let opusPrompt = STANDARD_PROMPT;
  if (voiceContext) {
    opusPrompt += "\nSeller said: " + voiceContext + ". Use this context to improve accuracy.";
  }
  const pass3 = await callModel(OPUS, imageContent, opusPrompt);
  const r3 = pass3.parsed;
  enrichPedigree(r3);
  r3.editionWarning = detectEditionWarning(r3.reason);
  r3._watchPasses = 3;
  console.log(`[watch] pass1: ${pass1.ms}ms pass2: ${pass2.ms}ms pass3: ${pass3.ms}ms total: ${pass1.ms + pass2.ms + pass3.ms}ms — Opus escalation`);
  console.log(`[watch-stats] pass=3 (opus) conf=${r3?.confidence}`);
  return { result: r3, passes: 3, timings: { pass1: pass1.ms, pass2: pass2.ms, pass3: pass3.ms } };
};

// Fast path: Claude Vision identification + grade only. ComicVine, eBay
// comps and Ximilar enrichment are handled by /api/enrich and
// merged into the result card when they return.
export default async function handler(req, res) {
  // A6 BUILD-ID: Inject commit hash header (Vercel auto-injects VERCEL_GIT_COMMIT_SHA)
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.CV_BUILD_ID || 'unknown';
  res.setHeader('x-cv-build', buildId);
  console.log(`[boot] Comic Vault build ${buildId}`);

  // A3 ACCESS GATE: T1 invite mechanism
  const gateError = checkAccessGate(req);
  if (gateError) {
    return res.status(gateError.status).json({ error: gateError.error });
  }

  // A4 RATE LIMIT: 30 scans / 10 min per key+IP
  const rateCheck = checkRateLimit(req);
  res.setHeader('x-ratelimit-remaining', String(rateCheck.remaining));
  if (!rateCheck.allowed) {
    res.setHeader('retry-after', String(rateCheck.reset));
    return res.status(429).json({ error: rateCheck.error, retryAfter: rateCheck.reset });
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (req.body?.warmup === true) {
    res.status(200).json({ warmed: true });
    return;
  }

  // SPEED BUILD 3 — Timing instrumentation (parallel to enrich.js pattern)
  const startTime = Date.now();
  const t = {};
  const mark = (label) => {
    const ms = Date.now() - startTime;
    t[label] = ms;
    console.log(`[grade-timing] ${label}: ${ms}ms`);
  };
  mark('handler_entry');

  try {
    const body = req.body || {};

    // FIX 4: Grade lock - skip Vision on HIGH confidence books
    if (body.existingGrade &&
        body.gradeConfidence === 'HIGH' &&
        body.gradeLocked === true &&
        !body.forceRegrade) {
      console.log('[grade-lock] returning locked grade, skipping Vision');
      return res.status(200).json({
        ...body.existingGrade,
        skipReason: 'grade_locked',
        locked: true,
        skippedVision: true,
      });
    }

    const { images, image } = body;
    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: "images array required" });
      return;
    }
    // A5 INPUT CAP: 8MB per image (was 1MB, updated for launch)
    const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
    for (const img of images) {
      if (typeof img === "string" && img.length > MAX_IMAGE_SIZE) {
        res.status(413).json({
          error: "Image too large — 8MB limit exceeded. Please retake with lower resolution",
        });
        return;
      }
    }
    const noImage = !image;

    // Build image content with resize — fail-fast on invalid input
    let imageContent;
    try {
      imageContent = await buildImageContent(images);
    } catch (resizeErr) {
      console.error('[grade] image resize failed:', resizeErr?.message);
      res.status(400).json({
        error: resizeErr?.message || "Image processing failed — please retake photo"
      });
      return;
    }

    // Watch mode: self-correcting multi-pass pipeline
    if (body.source === "watch") {
      const { result, passes, timings } = await watchPipeline(imageContent, body.voiceContext);
      if (noImage) result.noImage = true;
      res.setHeader("x-watch-passes", String(passes));
      res.setHeader("x-watch-timing", JSON.stringify(timings));
      res.status(200).json(ensureAssetType(result));
      return;
    }

    // Ship #EBAY-FIRST: Try eBay image search for identity, fallback to Vision if needed
    console.log('[grade] attempting eBay-first identification...');
    mark('ebay_image_start');
    const ebayResult = await lookupEbayIdentity(images[0]);
    mark('ebay_image_complete');

    if (ebayResult && ebayResult.consensus && ebayResult.consensus.confidence >= 0.3) {
      // eBay consensus successful — use Sonnet for grade-only
      console.log(`[grade] eBay consensus: ${ebayResult.consensus.title} #${ebayResult.consensus.issue} (${ebayResult.consensus.confidence} confidence)`);
      console.log('[grade] using Sonnet for grade-only assessment...');

      mark('vision_start');
      const gradePrompt = buildGradeOnlyPrompt(ebayResult.consensus);
      const { parsed: gradeResult } = await callModel("claude-haiku-4-5-20251001", imageContent, gradePrompt);
      mark('vision_complete');

      // Merge eBay identity + Sonnet grade
      const result = {
        // Identity from eBay consensus
        title: ebayResult.consensus.title,
        issue: ebayResult.consensus.issue,
        publisher: ebayResult.consensus.publisher || null,
        year: ebayResult.consensus.year || null,
        variant: ebayResult.consensus.variant || null,
        identitySource: 'ebay_image_search',
        identityConfidence: ebayResult.consensus.confidence,
        ebayAgreement: ebayResult.consensus.agreement,

        // Grade + condition from Sonnet
        grade: gradeResult.grade || null,
        isGraded: gradeResult.isGraded || false,
        numericGrade: gradeResult.numericGrade || null,
        certNumber: gradeResult.certNumber || null,
        restoration: gradeResult.restoration || null,
        defectPenalty: gradeResult.defectPenalty || null,
        cgcPenaltyFlags: gradeResult.cgcPenaltyFlags || null,
        reason: gradeResult.reason || null,
        confidence: gradeResult.confidence || 'medium',
        detectedPrice: gradeResult.detectedPrice || null,

        // Metadata
        keyIssue: null, // will be enriched by enrich.js
        creator: null,  // will be enriched by enrich.js
        price: null,    // will be calculated by enrich.js
        priceLow: null,
        priceHigh: null,
      };

      enrichPedigree(result);
      result.editionWarning = detectEditionWarning(result.reason);
      if (noImage) result.noImage = true;

      console.log('[grade] eBay-first path succeeded');
      mark('response_sent');
      res.status(200).json(ensureAssetType(result));
      return;
    }

    // Fallback: Vision full identification (current approach)
    console.log('[grade] eBay-first failed or low confidence — falling back to Vision full identification');

    // Session 4B — Initial scan to detect asset type
    mark('vision_start');
    const { parsed: initialScan } = await callModel("claude-sonnet-4-5-20250929", imageContent, STANDARD_PROMPT);
    mark('vision_complete');
    const isBook = detectBookSignals(initialScan);

    let userPrompt = STANDARD_PROMPT;
    let finalParsed = initialScan;

    if (isBook) {
      console.log('[grade] Book signals detected — using BOOK_PROMPT');
      userPrompt = BOOK_PROMPT;
      if (body.voiceContext) {
        userPrompt += "\nSeller said: " + body.voiceContext + ". Use this context to improve accuracy.";
      }
      const { parsed: bookScan } = await callModel("claude-sonnet-4-5-20250929", imageContent, userPrompt);
      finalParsed = bookScan;
    } else {
      // Comic — use initial scan result
      if (body.voiceContext) {
        // Re-scan with voice context
        userPrompt = STANDARD_PROMPT + "\nSeller said: " + body.voiceContext + ". Use this context to improve accuracy.";
        const { parsed: contextScan } = await callModel("claude-sonnet-4-5-20250929", imageContent, userPrompt);
        finalParsed = contextScan;
      }
    }

    if (noImage) finalParsed.noImage = true;
    enrichPedigree(finalParsed);
    finalParsed.editionWarning = detectEditionWarning(finalParsed.reason);
    finalParsed.identitySource = 'vision_fallback'; // mark as fallback

    mark('response_sent');
    res.status(200).json(ensureAssetType(finalParsed, initialScan));
  } catch (err) {
    console.error('[FATAL /api/grade]', err?.message || err);
    console.error('[FATAL STACK]', err?.stack || 'no stack trace');
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
