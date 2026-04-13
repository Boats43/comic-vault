// CGC cert number verification lookup.
// Fetches the CGC verify page and parses key fields from the HTML.

const lookupCGC = async (certNumber) => {
  if (!certNumber) return null;
  const cert = String(certNumber).replace(/\D/g, "").trim();
  if (!cert || cert.length < 6) return null;

  try {
    const url = `https://www.cgccomics.com/certlookup/${cert}/`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      console.log(`[cgc] cert=${cert} HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();

    // CGC pages use a structured layout. Try multiple selectors/patterns.
    // Title line: "Amazing Spider-Man, The #300"
    const titleMatch =
      html.match(/<h2[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ||
      html.match(/<div[^>]*class="[^"]*cert-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<title>\s*CGC\s*-\s*(.*?)(?:\s*\||\s*<)/i);

    // Grade line
    const gradeMatch =
      html.match(/CGC Grade[:\s]*([\d.]+)/i) ||
      html.match(/Grade[:\s]*([\d.]+)/i) ||
      html.match(/<span[^>]*class="[^"]*grade[^"]*"[^>]*>([\d.]+)<\/span>/i);

    // Label type
    const labelMatch =
      html.match(/Label Type[:\s]*<[^>]*>(.*?)<\//i) ||
      html.match(/Label[:\s]*(Universal|Signature Series|Restored|Qualified)/i) ||
      html.match(/(Universal|Signature Series|Restored|Qualified)/i);

    // Year
    const yearMatch =
      html.match(/Year[:\s]*([\d]{4})/i) ||
      html.match(/\((\d{4})\)/);

    if (!titleMatch && !gradeMatch) {
      console.log(`[cgc] cert=${cert} no data found in HTML`);
      return null;
    }

    const rawTitle = (titleMatch?.[1] || "").replace(/<[^>]*>/g, "").trim();
    // Parse "Amazing Spider-Man, The #300" → title + issue
    const issueFromTitle = rawTitle.match(/#(\d+)/);
    const title = rawTitle.replace(/#\d+/, "").replace(/,\s*The\s*$/i, "").trim();
    const issue = issueFromTitle ? issueFromTitle[1] : null;
    const grade = gradeMatch ? parseFloat(gradeMatch[1]) : null;
    const labelType = labelMatch
      ? labelMatch[1].replace(/<[^>]*>/g, "").trim()
      : null;
    const year = yearMatch ? yearMatch[1] : null;

    console.log(`[cgc] cert=${cert} found=${title} #${issue} grade=${grade} label=${labelType}`);
    return {
      certNumber: cert,
      title: title || null,
      issue,
      year,
      grade,
      labelType,
      verified: true,
    };
  } catch (err) {
    console.error(`[cgc] cert=${cert} error: ${err?.message || err}`);
    return null;
  }
};

export { lookupCGC };
export default lookupCGC;
