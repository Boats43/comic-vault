# ADR-ADAPTER-001 — Adapter Contract, GK-147 Expansion Gate, Listing-as-Projection

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 30–34, 37.**

## Context

CLAUDE.md's own AssetCore architecture already states the intended shape: "AssetCore is now universal — operates on primitives only... All format-specific domain knowledge lives in adapters." `src/adapters/ComicAdapter.js` (312 lines, 4/4 functions) is the one adapter that exists; `BookAdapter.js`/`CardAdapter.js` are documented roadmap (Session 4A/4B), not built. GK-147 (`docs/DATA-1-READINESS.md` D2, found during the DATA-1 readiness interrogation) proved the "universal" claim is not yet true in practice: `decisionEngine.js:137-151` hard-gates identity-completeness on comic-specific `issue`/`publisher` presence; `pricingEngine.js:126` carries its own TODO admitting a comic-specific assumption; `pricingEngine.js:111` hardcodes the 1956 Silver Age boundary inside a module claiming to be domain-agnostic; `pricingEngine.js:46,183` exposes `isMegaKey` as if it were universal. GK-147's own registry text was explicit about its purpose: "this ticket is the fence, not a repair" — logged so a second adapter isn't built on top of an assumption nobody checked. Separately, GK-150's Asset Network census finding (`bundleId = ebayItemId`) showed a second, related defect class: a GrailKey concept (a bundle) deriving its own identity from an external marketplace's ID scheme, with no independent existence of its own.

## Decision

**Ruling 30 — the adapter contract is formalized, not just documented as intent.** An adapter implements a fixed, small interface (matching `ComicAdapter.js`'s own existing 4-function shape: `detectKeyValue`, `verifyStory`, `computeEraRisk`, `sanitizeFormatTitle`, or their equivalents for a new asset class) and NOTHING outside that interface may be format-specific. AssetCore (`identityCore.js`, `pricingEngine.js`, `decisionEngine.js`) may only call INTO the adapter interface for anything format-specific — it may never itself branch on asset type, hardcode a format-specific threshold, or assume a format-specific field exists.

**Ruling 31 — GK-147 is the literal exit gate for building a second adapter.** No `BookAdapter.js`/`CardAdapter.js` (or any future adapter) may be started until every item GK-147 named is either fixed (moved behind the adapter interface) or explicitly re-scoped with its own ticket and rationale for why it can wait. This is stated as a hard sequencing rule, not a preference: building a second adapter on top of an AssetCore that secretly assumes comic-shaped data would silently reproduce the exact "second, competing truth system" failure class this project's other ADRs and `THE REBUILD RULE` already exist to prevent, one layer up — a hypothetical `BookAdapter.js` would either inherit the comic-specific bugs unknowingly, or need its own parallel patches, defeating the point of AssetCore's universality claim.

**Ruling 32 — listing-as-projection.** A marketplace listing (eBay, Whatnot, any future channel) is a PROJECTION of the canonical `gkAssetId`/identity/pricing data, never an independent source of truth and never the origin of a GrailKey-owned identifier. GK-150's `bundleId = ebayItemId` is the concrete defect this ruling fixes: a bundle's real identity is a GrailKey-owned grouping of `gkAssetId`s (ADR-ASSET-001); `ebayItemId` becomes an `external_map` row (ADR-ID-001's own external-reference model) — one mapped reference among possibly several external channels, never the primary key. This generalizes past bundles to every listing-shaped concept the adapter/commerce layer produces.

**Ruling 33 — commerce separation.** Identity/catalog concerns (what is this, which physical copy, who owns it) are architecturally separate from commerce concerns (is it listed, at what price, on which channel, in what state of a sale). The commerce layer CONSUMES identity/catalog/pricing data through defined interfaces; it never becomes a second place identity or ownership facts get written. This is the same principle ADR-AUTH-001's four-step authorization chain already assumes (asset authorization is checked before marketplace-account authorization, not folded together) — stated here as a structural separation, not just an authorization-order rule.

**Ruling 34 — commerce-layer idempotency.** Listing creation, delisting, and bundle operations are idempotent under the same discipline ADR-API-001 (Ruling 26) and ADR-ID-001 (mint idempotency) already require elsewhere: retrying a "list this asset" request must never produce two live listings for the same `gkAssetId` on the same channel.

**Ruling 37 — the adapter interface itself is versioned and stable independently of any single adapter's implementation.** Changing what AssetCore expects from an adapter (adding a required function, changing a signature) is an interface-version change, reviewed with the same weight as a schema migration — an adapter written against interface v1 must not silently break when AssetCore evolves, matching ADR-API-001's own versioning discipline extended to this internal contract.

## Invariants

1. No file under `src/lib/` (AssetCore) branches on asset type, format, or any format-specific field name.
2. No second adapter is started while any GK-147 item remains unresolved and unre-scoped.
3. No marketplace/channel identifier (eBay item ID, Whatnot listing ID, etc.) is ever used as, or stored as, a GrailKey primary key — always `external_map`.
4. Listing/bundle mutations are idempotent per Ruling 34.

## Consequences

- GK-147 gains real teeth: it is not just a documented debt, it is a hard blocker on the Session 4A/4B roadmap CLAUDE.md already describes.
- GK-150's fix has a concrete target (`external_map` + `gkBundleId`, per that ticket's own registry text) and is no longer just "logged, no fix" — this ADR is its remediation path (amendment A2: "GK-150 OPEN/remediation-ADAPTER").
- Future adapters (Book, Card) inherit a real, enforced contract rather than needing to independently discover which parts of AssetCore actually are universal versus quietly comic-shaped.

## Rejected Alternatives

- **Fix GK-147's specific 4 named items and consider the adapter boundary "good enough."** Rejected: GK-147's own text frames itself as "the fence, not a repair" — a spot-fix of the 4 known instances doesn't establish the STRUCTURAL guarantee (Invariant 1) that a fifth, not-yet-found instance can't exist; the contract must be enforced, not just patched around known cases.
- **Let `BookAdapter.js` work proceed in parallel with GK-147 remediation.** Rejected: risks the second-adapter effort discovering AND working around the same comic-specific leakage independently, duplicating the fix and likely diverging from it — sequencing (Ruling 31) is cheaper than parallel rediscovery.
- **Keep `ebayItemId` as a bundle's primary key for simplicity (it already works for the single-channel prototype).** Rejected: GK-150's own finding already identifies why — no independent existence for non-eBay bundles (Whatnot, local sale, any future channel), and the "external ID as primary key" pattern is exactly the shape ADR-ID-001's `external_map` model exists to replace project-wide.

## Implementation Gates

- `BookAdapter.js`/`CardAdapter.js` (Session 4A/4B, CLAUDE.md roadmap) are blocked until GK-147 is closed or explicitly re-scoped per Ruling 31.
- Any new marketplace/channel integration must route its own identifiers through `external_map` from its first commit, never introduce a new "external ID as primary key" pattern.

## Related Tickets

- GK-147 — OPEN/exit-gate-ADAPTER (per amendment A2) — the founding finding and the literal gate this ADR enforces.
- GK-150 — OPEN/remediation-ADAPTER (per amendment A2) — fixed by Ruling 32 (listing-as-projection), implementation not yet built.

## Supersession

None. New ADR, formalizes intent CLAUDE.md's own AssetCore documentation already stated but GK-147 proved was not yet actually true.
