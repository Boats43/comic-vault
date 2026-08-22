# ADR-MEDIA-001 — Media Storage Role Separation

**Status:** Ratified (Master Architecture Summit, Phase 1). **Ruling covered: 16.**

## Context

Every scan capture (ADR-ASSET-001's `gkAssetId` minting moment) carries at least one photo, and grading/condition documentation may accumulate several more per asset over its lifetime. `docs/DATA-0-ARCHITECTURE.md` §8 already ruled that raw bulk source data (the GCD dump) never enters Neon — the same reasoning applies with more force to binary image data, which Postgres can technically store (`bytea`) but is not designed to serve efficiently at scale, and which has no place at all in the relational identity/claim/catalog model this project's other ADRs establish.

## Decision

**Ruling 16 — media (scan photos, grading documentation images) is never stored in Postgres.** It lives in object storage (a dedicated blob/object store — the specific vendor is an implementation choice for DATA-1, not ratified here), referenced FROM the relational layer by a stable URL/key, never embedded as binary column data. `catalog_entity`/`comic_*`/asset tables carry references (a `media_ref` facet or equivalent claim-shaped record — consistent with `identityReconciler.js`'s own claim model: "here is evidence, here is where it lives," not "here is the evidence, inline"), never the bytes themselves.

This mirrors, at the media layer, the same separation `docs/DATA-0-ARCHITECTURE.md` §8 already ratified at the bulk-data layer: Postgres holds the typed, queryable, relationship-bearing facts; large opaque payloads live elsewhere, referenced, never embedded.

## Invariants

1. No `comic_*`/asset/`catalog_entity` table gains a binary/blob column for image data.
2. Every media reference is resolvable independently of the relational row that points to it (deleting or migrating a catalog row does not orphan-delete the underlying object without an explicit, separate decision).
3. Media references participate in the same append-only evidence discipline as other claims where they serve as evidence (e.g. a grading photo justifying a condition assessment) — a corrected/replaced photo adds a new reference, it does not silently overwrite the old one.

## Consequences

- Object-store vendor selection, upload flow, and CDN/serving strategy are all DATA-1 implementation work, explicitly out of scope for this ADR and for DATA-0E-FULL.
- Existing client-side image handling (Watch Mode capture, `gradeBlob`, base64 image payloads in the current `/api/grade` request shape) is not immediately affected — this ADR governs the PERMANENT catalog/asset schema, not the current prototype's transport mechanism, though it sets the direction that transport should move toward.

## Rejected Alternatives

- **Store images as `bytea` in Postgres.** Rejected: Postgres is not an object store; large binary columns bloat table/index size, complicate backup/restore, and have no serving/CDN story — exactly the reasoning `docs/DATA-0-ARCHITECTURE.md` §8 already applied to bulk GCD data.
- **Store images in the same KV cache used for API response caching (`api/kv-cache.js`, Upstash Redis).** Rejected: that KV layer is designed for small, TTL-bounded cache entries (API lookups), not permanent, potentially-large media assets with no natural expiry.

## Implementation Gates

- No implementation work is gated by this ADR alone — vendor selection and upload-flow design are DATA-1 scope, tracked separately.

## Related Tickets

- None directly — this is a forward-looking ratification ahead of any current ticket needing it.

## Supersession

None. New ADR.
