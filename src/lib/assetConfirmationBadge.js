// GrailKey Directive 2026-08-11-D (Task 2) / 2026-08-11-E (Task 2) —
// GK-39-class fix. src/App.jsx's identity-provenance line used to render
// "✓ comic confirmed" as the bare else-branch of a ternary keyed only on
// item.assetType === 'book' — no failure mode for the thing it claimed to
// verify. Vision's own real "is this genuinely a comic" signal
// (assetTypeConfident, computed api/enrich.js:2488, already a RESEARCH-tier
// warning at decisionEngine.js) was never wired to it — a Spawn #351 scan
// whose own condition text read "not an actual comic book cover" still
// rendered the confirmed badge.
//
// Extracted as a pure function (same pattern as listPriceWarning.js) so
// App.jsx's render site and this feature's tests exercise the identical
// three-state decision.
export function getAssetConfirmationBadge(item) {
  if (item?.assetType === 'book') {
    return { text: '⚠ book detected', state: 'book', color: '#f59e0b' };
  }
  if (item?.assetTypeConfident === false) {
    return { text: '⚠ not confirmed as a comic', state: 'uncertain', color: '#f59e0b' };
  }
  return { text: '✓ comic confirmed', state: 'confirmed', color: '#888' };
}
