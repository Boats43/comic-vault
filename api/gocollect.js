// GoCollect CGC Fair Market Value lookup.
//
// Returns FMV at key CGC grades (9.8, 9.6, 9.4, 9.2, 9.0) plus a
// submit recommendation based on raw-vs-graded gap.
//
// Returns null silently when GOCOLLECT_API_KEY is not set — safe to
// deploy without the key. Add key to Vercel env when approved.

const GOCOLLECT_BASE = "https://api.gocollect.com/api/v2";

export const lookupGoCollect = async ({ title, issue, year, publisher }) => {
  const apiKey = process.env.GOCOLLECT_API_KEY;
  if (!apiKey) return null;
  if (!title || !issue) return null;

  try {
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();
    const query = encodeURIComponent(`${seriesName} ${issue}`);
    const url = `${GOCOLLECT_BASE}/search?q=${query}&type=comic&api_key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(`[gocollect] HTTP ${res.status}`);
      return null;
    }

    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];
    if (results.length === 0) {
      console.log(`[gocollect] no results for "${seriesName} ${issue}"`);
      return null;
    }

    // Match by issue number and year proximity.
    const issueStr = String(issue).trim();
    const comicYear = year ? parseInt(String(year).trim(), 10) : null;

    let match = null;
    for (const r of results) {
      const rIssue = String(r.issue_number || "").trim();
      if (rIssue !== issueStr) continue;

      if (comicYear) {
        const rYear = parseInt(r.year || r.cover_date?.slice(0, 4), 10);
        if (rYear && Math.abs(rYear - comicYear) > 5) continue;
      }

      match = r;
      break;
    }

    if (!match) {
      console.log(`[gocollect] no issue match for #${issue}`);
      return null;
    }

    // Extract FMV at key grades from the match data.
    const fmv = {};
    const grades = match.grades || match.fmv || {};
    for (const [grade, value] of Object.entries(grades)) {
      const g = parseFloat(grade);
      if (!isNaN(g) && g >= 9.0 && value > 0) {
        fmv[g] = typeof value === "number" ? value : parseFloat(value) || null;
      }
    }

    const fmv98 = fmv[9.8] || null;
    const fmv96 = fmv[9.6] || null;
    const fmv94 = fmv[9.4] || null;
    const fmv92 = fmv[9.2] || null;
    const fmv90 = fmv[9.0] || null;

    // Submit recommendation: compare raw value to CGC 9.8 FMV.
    // If CGC 9.8 is >2x the estimated raw value, recommend submitting.
    // CGC submission costs ~$30-65 depending on tier + shipping.
    const submissionCost = 50; // approximate mid-tier cost
    let submitRecommended = false;
    let submitGap = null;
    if (fmv98) {
      // Raw NM is roughly equivalent to the 9.4 or lower CGC price
      const rawEquiv = fmv94 || fmv92 || fmv90 || fmv98 * 0.4;
      if (rawEquiv > 0) {
        submitGap = Math.round((fmv98 / rawEquiv) * 10) / 10;
        submitRecommended = fmv98 > rawEquiv + submissionCost && submitGap >= 2;
      }
    }

    console.log(
      `[gocollect] matched: ${match.title || seriesName} #${issueStr}`,
      `fmv98=$${fmv98} fmv96=$${fmv96} fmv94=$${fmv94}`,
      `submit=${submitRecommended} gap=${submitGap}x`
    );

    return {
      fmv98,
      fmv96,
      fmv94,
      fmv92,
      fmv90,
      submitRecommended,
      submitGap,
      source: "gocollect",
      matchTitle: match.title || null,
      matchId: match.id || null,
    };
  } catch (err) {
    console.error(`[gocollect] error: ${err?.message || err}`);
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { title, issue, year, publisher } = req.body || {};
  const result = await lookupGoCollect({ title, issue, year, publisher });
  res.status(200).json(result || { unavailable: true });
}
