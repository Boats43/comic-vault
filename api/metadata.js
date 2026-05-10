// POST /api/metadata
//
// SPEED-2a — Lightweight metadata endpoint for display-only fields.
// Returns ComicVine story/creators, CGC population, and GoCollect FMV.
// Does NOT block initial enrich response.

import { lookupComicVine } from "./enrich.js";
import { fetchPricechartingPop } from "./pricecharting-pop.js";
import { lookupGoCollect } from "./gocollect.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { title, issue, year, publisher, pcProductId, grade } = req.body || {};

  if (!title) {
    res.status(400).json({ error: "Missing title" });
    return;
  }

  try {
    // Fetch display-only metadata in parallel
    const [comicVine, pop, goCollect] = await Promise.all([
      lookupComicVine({ title, issue, year, publisher }).catch(() => null),
      pcProductId
        ? fetchPricechartingPop(pcProductId, grade).catch(() => null)
        : Promise.resolve(null),
      lookupGoCollect({ title, issue, year, publisher }).catch(() => null),
    ]);

    // Extract only display fields
    const metadata = {
      story: comicVine?.description || null,
      creators: comicVine?.personCredits || [],
      pop: pop || null,
      goCollect: goCollect || null,
    };

    res.status(200).json(metadata);
  } catch (err) {
    console.error('[metadata] error:', err.message);
    res.status(500).json({ error: "Failed to fetch metadata" });
  }
}
