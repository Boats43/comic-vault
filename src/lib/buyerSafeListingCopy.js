// src/lib/buyerSafeListingCopy.js — INTERNAL DECISION REASONING != BUYER-FACING
// MARKETPLACE COPY.
//
// The ONE explicit projection from a catalogue item to the facts a marketplace
// description may be built from. It selects named fields only — it NEVER
// spreads the item, the decision, or the contract — and the description
// builders (api/list-ebay.js single + bundle) receive ONLY this projection, so
// they structurally cannot read:
//   item.reason (grader/model rationale), decision/contract reasoning,
//   claudeCheck.flags (AI-verification diagnostics), priceBands.source and other
//   pricing-pipeline labels, internal IDs, error text, authority explanations.
// Those stay in GrailKey (operator UI / durable history); they are not deleted,
// merely not projectable into public copy.
//
// Buyer-facing copy may come only from: explicit durable catalogue facts, an
// explicit operator-entered public note (none exists today — omitted rather than
// invented), or deliberately generated public copy with known provenance.

const str = (v) => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''));

// Matches the existing showKeyIssue() semantics (kept identical on purpose).
export const isShowableKeyIssue = (k) => {
  if (!k || typeof k !== 'string') return false;
  const s = k.toLowerCase().trim();
  if (['no', 'n/a', 'none', 'false', 'not a key', 'non-key', 'non key', 'not key'].some((x) => s.includes(x))) return false;
  return s.length > 2;
};

export function toBuyerSafeListingFacts(item) {
  const it = item && typeof item === 'object' ? item : {};
  const cv = it.comicVine && typeof it.comicVine === 'object' ? it.comicVine : {};
  const pb = it.priceBands && typeof it.priceBands === 'object' ? it.priceBands : null;
  const ds = it.demandSignals && typeof it.demandSignals === 'object' ? it.demandSignals : null;
  return Object.freeze({
    title: str(it.title),
    issue: str(it.issue),
    year: str(it.year),
    publisher: str(it.publisher),
    grade: str(it.grade),
    isGraded: it.isGraded === true,
    numericGrade: it.numericGrade ?? null,
    keyIssue: isShowableKeyIssue(it.keyIssue) ? it.keyIssue : '',
    story: typeof cv.description === 'string' ? cv.description : '',
    creators: Array.isArray(cv.personCredits)
      ? cv.personCredits.map((p) => ({ name: str(p?.name), role: str(p?.role) })).filter((p) => p.name) : [],
    characters: Array.isArray(cv.characterCredits)
      ? cv.characterCredits.map((c) => str(c?.name)).filter(Boolean) : [],
    firstAppearance: Array.isArray(cv.firstAppearanceCharacters)
      ? cv.firstAppearanceCharacters.map(str).filter(Boolean) : [],
    // Market figures only — the pipeline's source/label tokens are NOT projected.
    market: pb && pb.quick && pb.stretch && pb.market
      ? { quick: Number(pb.quick), stretch: Number(pb.stretch), market: Number(pb.market), count: Number(pb.count) || 0 } : null,
    hasMarketBlock: !!pb,
    popTotal: Number(it.pop?.total) > 0 ? Number(it.pop.total) : 0,
    demand: ds ? { demandLevel: str(ds.demandLevel), trend: str(ds.trend), liquidity: str(ds.liquidity) } : null,
  });
}
