// POST /api/census
//
// Scrapes the CGC Comics census page for a given title + issue number and
// returns total graded count, count at the specified grade, and rarity %.
//
// CGC URL: https://www.cgccomics.com/census/search/?title={title}&issue={issue}
//
// NOTE: CGC's census site is a client-rendered single page application,
// so a plain fetch returns an HTML shell with no data. This module makes
// a best effort to parse whatever is in the shipped HTML (embedded JSON,
// preload data, etc.) and silently returns null when nothing can be
// extracted. Also exported as `fetchCensus` so api/grade.js can reuse it
// without an HTTP hop.

const CGC_BASE = "https://www.cgccomics.com/census/search/";

// Strip "#N" and trailing spaces to isolate the series title.
const splitTitleAndIssue = (rawTitle) => {
  if (!rawTitle) return { title: "", issue: "" };
  const m = String(rawTitle).match(/^(.*?)#\s*(\d+)/);
  if (m) return { title: m[1].trim(), issue: m[2].trim() };
  return { title: String(rawTitle).trim(), issue: "" };
};

const toNumber = (s) => {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
};

// Parse a loose HTML/JSON blob looking for census totals and a per-grade
// row matching the target grade. Returns { totalGraded, countAtGrade } or
// null if nothing matched.
const parseCensusHtml = (html, targetGrade) => {
  if (!html) return null;

  // Look for an inline JSON island (Next.js __NEXT_DATA__ or similar).
  const jsonMatch =
    html.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) ||
    html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
  if (jsonMatch) {
    try {
      const blob = JSON.parse(jsonMatch[1]);
      const str = JSON.stringify(blob);
      const totalMatch = str.match(/"total(?:Graded|Census)?":\s*(\d+)/i);
      const totalGraded = totalMatch ? parseInt(totalMatch[1], 10) : null;

      let countAtGrade = null;
      if (targetGrade != null) {
        const gradeKey = String(targetGrade).replace(".", "\\.");
        const gradeRe = new RegExp(
          `"grade":\\s*"?${gradeKey}"?[^}]*?"(?:count|total)":\\s*(\\d+)`,
          "i"
        );
        const gm = str.match(gradeRe);
        if (gm) countAtGrade = parseInt(gm[1], 10);
      }

      if (totalGraded != null || countAtGrade != null) {
        return { totalGraded, countAtGrade };
      }
    } catch {
      /* fall through to HTML heuristics */
    }
  }

  // Fallback: look for "Total: N" / "Total Graded: N" style markers.
  let totalGraded = null;
  const totalText =
    html.match(/Total\s*Graded[^0-9]*([\d,]+)/i) ||
    html.match(/Total[^0-9]*([\d,]+)/i);
  if (totalText) totalGraded = toNumber(totalText[1]);

  // Try to find a table row containing the target grade string.
  let countAtGrade = null;
  if (targetGrade != null) {
    const escaped = String(targetGrade).replace(".", "\\.");
    const rowRe = new RegExp(
      `(?:\\b${escaped}\\b)[\\s\\S]{0,400}?([\\d,]+)`,
      "i"
    );
    const rm = html.match(rowRe);
    if (rm) countAtGrade = toNumber(rm[1]);
  }

  if (totalGraded == null && countAtGrade == null) return null;
  return { totalGraded, countAtGrade };
};

export const fetchCensus = async ({ title, grade }) => {
  try {
    const { title: seriesTitle, issue } = splitTitleAndIssue(title);
    if (!seriesTitle) return null;

    const url = `${CGC_BASE}?title=${encodeURIComponent(seriesTitle)}${
      issue ? `&issue=${encodeURIComponent(issue)}` : ""
    }`;
    console.log(`[census] url=${url}`);

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ComicVaultBot/1.0; +https://comic-vault-rouge.vercel.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    console.log(`[census] http status=${res.status}`);
    if (!res.ok) return null;

    const html = await res.text();
    const targetGrade = grade != null ? parseFloat(grade) : null;
    const parsed = parseCensusHtml(html, targetGrade);
    if (!parsed) {
      console.log(`[census] no data extracted`);
      return null;
    }

    const { totalGraded, countAtGrade } = parsed;
    const rarityPercent =
      totalGraded && countAtGrade != null && totalGraded > 0
        ? Math.round((countAtGrade / totalGraded) * 10000) / 100
        : null;

    return {
      totalGraded,
      countAtGrade,
      rarityPercent,
      url,
    };
  } catch (err) {
    console.error(`[census] error: ${err?.message || err}`);
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { title, grade } = req.body || {};
    if (!title) {
      res.status(400).json({ error: "title required" });
      return;
    }
    const data = await fetchCensus({ title, grade });
    res.status(200).json(data || { totalGraded: null, countAtGrade: null, rarityPercent: null });
  } catch (err) {
    res.status(200).json({ error: err?.message || "Server error" });
  }
}
