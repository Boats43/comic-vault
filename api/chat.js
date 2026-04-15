import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { message, collection, history, buyerSessions } = req.body || {};
    if (!message) {
      res.status(400).json({ error: "message required" });
      return;
    }

    // Build collection summary for Claude context (strip images).
    const list = Array.isArray(collection)
      ? collection
      : (collection?.books || []);
    const allComics = list.map((c) => ({
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

    // Total value from the full collection, never just the subset sent to Claude.
    const totalValue = allComics.reduce((s, c) => {
      const p = parseFloat(String(c.price||"0").replace(/[$,]/g,""));
      return s + (p || 0);
    }, 0);

    // Limit to top 20 by display price (price or comps.averageNum×1.15) to
    // keep the prompt under the model's effective token budget for 58+
    // comics. Matches frontend getDisplayPrice logic.
    const displayPriceOf = (c) => {
      const p = parseFloat(String(c.price || "0").replace(/[$,]/g, ""));
      if (p > 0) return p;
      if (c.comps?.averageNum) return Math.round(c.comps.averageNum * 1.15);
      return 0;
    };
    const comics = [...allComics]
      .sort((a, b) => displayPriceOf(b) - displayPriceOf(a))
      .slice(0, 20);
    const truncated = allComics.length - comics.length;

    // Buyer session summary (Whatnot history)
    let buyerContext = "";
    if (buyerSessions && typeof buyerSessions === "object" && buyerSessions.recentSessions?.length > 0) {
      const bs = buyerSessions;
      buyerContext = `\n\nWHATNOT BUYING HISTORY (last ${bs.recentSessions.length} sessions):
Buy rate: ${Math.round((bs.buyRate || 0) * 100)}% | Avg discount: ${Math.round((bs.avgDiscount || 0) * 100)}% below market | Total spent: $${Math.round(bs.totalSpent || 0)}
${bs.bestDeal ? `Best deal: ${bs.bestDeal.title} — bought at $${bs.bestDeal.bidPrice} (market $${bs.bestDeal.marketValue}, ${Math.round(bs.bestDeal.discount * 100)}% discount)` : ""}
Recent decisions: ${JSON.stringify(bs.recentSessions.slice(-10).map((s) => ({ title: s.title, decision: s.decision, bid: s.bidPrice, market: s.marketValue })))}

You also have access to the user's Whatnot buying history. Use it to give advice on their buying patterns, best deals, and areas to improve.`;
    }

    const truncNote = truncated > 0
      ? ` (showing top ${comics.length} by value; ${truncated} more in full collection)`
      : "";
    const systemPrompt = `You are the collection manager AI for Comic Vault. You have complete knowledge of this collector's inventory.

COLLECTION (${allComics.length} comics total${truncNote}, ~$${Math.round(totalValue).toLocaleString()} estimated value):
${JSON.stringify(comics)}${buyerContext}

RULES:
- Keep responses under 3 sentences. Be direct and actionable.
- When recommending an action, include it in the "actions" array of your JSON response.
- Always respond with ONLY valid JSON, no markdown, no explanation outside the JSON.
- Response shape: { "response": "your message text", "actions": [...], "metrics": [...], "signals": [...] }

ACTIONS array (optional buttons the user can tap):
- { "label": "List Now — $X", "action": "list", "comicId": "xxx" }
- { "label": "Create Bundle — $X", "action": "bundle", "comicIds": ["xxx","yyy"], "price": number }
- { "label": "View Details", "action": "view", "comicId": "xxx" }

METRICS array (exactly 4 boxes for the dashboard, ordered by priority):
Each: { "label": string, "value": string, "color": "red"|"yellow"|"green", "detail": string, "filter": string }
- color: red = action needed now, yellow = watch this, green = good position
- filter: a search string that filters the collection grid when tapped
Pick the 4 most relevant from: Total Value, Hot Right Now, Stagnant Alert, Bundle Ready, Grade Signal, Market Alert, Listed Count, Key Issues

SIGNALS array (3-5 short market intelligence strings for the scrolling strip):
Each: string like "📈 Variant covers +12% this week" or "🔥 ASM #300 — high demand"

Always include metrics and signals in EVERY response.`;

    // Build message history (keep last 5 exchanges for continuity).
    const messages = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        messages.push({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.content,
        });
      }
    }
    messages.push({ role: "user", content: message });

    // 8s timeout guard — if Claude doesn't respond in time, return a safe
    // fallback so the Manage card never shows "Something went wrong".
    const TIMEOUT_MS = 8000;
    const apiPromise = client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      system: systemPrompt,
      messages,
    });
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve({ __timedOut: true }), TIMEOUT_MS)
    );
    const result = await Promise.race([apiPromise, timeoutPromise]);
    if (result && result.__timedOut) {
      console.warn(`[chat] Claude timeout after ${TIMEOUT_MS}ms — returning fallback`);
      res.status(200).json({
        response: "Taking longer than usual — try a narrower question like \"What should I sell?\" or \"Any bundle ideas?\"",
        actions: [],
        metrics: [],
        signals: [],
      });
      return;
    }

    const text = result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = { response: text, actions: [], metrics: [], signals: [] };
        }
      } else {
        parsed = { response: text, actions: [], metrics: [], signals: [] };
      }
    }

    // Ensure arrays exist.
    parsed.actions = parsed.actions || [];
    parsed.metrics = parsed.metrics || [];
    parsed.signals = parsed.signals || [];

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
