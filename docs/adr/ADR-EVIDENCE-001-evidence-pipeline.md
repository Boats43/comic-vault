# ADR-EVIDENCE-001 — Evidence Pipeline: Model Output → Claim → Evidence → Reconciliation → Assignment

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 18–19.**

## Context

This project has, in practice, already been running this exact pipeline for identity facets for months — `src/lib/identityReconciler.js`'s `addEvidence`/`reportConflict` model, the `reconcileTitle`/`reconcileIssue`/`reconcileYear`/`reconcileVariantFacet` functions, and `db/data0/0001_generic_substrate.sql`'s own `claim` table (explicitly documented as mirroring `identityReconciler.js`'s shape). What has never existed is the equivalent pipeline for the PHYSICAL ASSET layer ADR-ASSET-001 just introduced, and no ADR has previously stated the general principle as a ruling binding on all future evidence-producing sources (not just Claude Vision, though that is the concrete, proven case). CLAUDE.md's own "Vision Hallucination class" (Pattern Library) and the Q54/Q84/AK/AQ history (all instances of "a SEPARATE authority system silently overriding the reconciler's own correct answer") are the accumulated evidence this ADR generalizes into a standing rule.

## Decision

**Ruling 18 — the pipeline, formalized: model output → claim → evidence → reconciliation → assignment.**
1. **Model output**: raw output from any evidence-producing source — Claude Vision's read of a scanned book, a GCD/Metron/ComicVine record, a user's manual correction, a marketplace listing's own text. Never trusted directly.
2. **Claim**: the model output, wrapped as a `claim` row (`facet`, `source`, `value`, `type: corroboration|conflict|refinement`) — exactly `identityReconciler.js`'s existing shape, extended to cover asset-level facets, not just catalog-level ones.
3. **Evidence**: the accumulated claim set for a given facet on a given entity/asset — multiple claims, possibly disagreeing, all preserved (never overwritten by a "winning" one — I13's own "never discarded, only annotated" principle, extended here from display to storage).
4. **Reconciliation**: the SAME rule functions already shipped (`reconcileTitle`, `reconcileIssue`, `reconcileYear`, `reconcileVariantFacet`, and their future asset-layer equivalents) resolve the evidence set to a value + authority (`NONE`/`CONTESTED`/`CORROBORATED`) — never a separate, parallel authority system re-deriving its own answer from the same inputs (the exact Q54/Q84/AK/AQ failure class).
5. **Assignment**: the reconciled result is written as an `asset_identity_assignment` row (Ruling 19) or the equivalent catalog-level assignment — the thing consumers actually read.

**AI never writes truth directly.** No Vision output, no ComicVine match, no any-model's-output is ever written straight to an `identity_authority`/`issue_authority`/`variant_authority` column or equivalent — it always passes through claim → evidence → reconciliation first, exactly as the existing comic-identity pipeline already enforces, generalized here as a project-wide rule covering every future evidence source, not just the ones already built.

**Ruling 19 — `asset_identity_assignment` is append-only history, and `gkAssetId` survives identity correction.** Every reconciliation result for a given asset is a NEW row in `asset_identity_assignment`, never an edit to a prior one — the full history of "what did we think this book was, and when did that change" is permanent. Per ADR-ASSET-001's own Ruling 11, the `gkAssetId` itself never changes as a consequence of this — correcting an asset's identity assignment from `gkIssueId` A to `gkIssueId` B is a new assignment row pointing the SAME `gkAssetId` at a different `gkIssueId`, never a new asset, never a mutation that discards the prior assignment's own record.

## Invariants

1. No evidence-producing source (AI model, external API, user input) ever writes directly to an authority/assignment field — always through claim → reconciliation.
2. Reconciliation logic is never duplicated by a second, independently-derived authority system for the same facet (the standing failure class this project has already found and fixed four times under different names).
3. `asset_identity_assignment` rows are never edited or deleted — only appended.
4. `gkAssetId` is invariant across any number of identity corrections to the asset it names.

## Consequences

- The existing `identityReconciler.js`/`claim` model is validated as the correct pattern, not replaced — this ADR extends its reach (to the asset layer) rather than redesigning it.
- Every future evidence source (a future ComicVine-equivalent for books, a future grading-service API, a future user-facing correction flow) has a single, known integration point (claim ingestion) rather than needing its own bespoke authority logic.
- A user-facing "history of what we thought this book was" feature (corrections, re-identifications) becomes directly supportable from `asset_identity_assignment`'s own append-only record, with no additional tracking needed.

## Rejected Alternatives

- **Let a new evidence source (e.g. a future grading-service integration) write its own authority field directly, for speed.** Rejected: this is precisely the Q54/Q84/AK/AQ failure class this project has already paid to discover and fix four separate times under four different names — ratifying it as a rule closes the door on a fifth instance rather than waiting to find it again.
- **Mutate `asset_identity_assignment` in place (keep only the current assignment).** Rejected: loses the correction history ADR-ASSET-001's own "identity-independent" principle depends on being able to demonstrate (a `gkAssetId` that silently forgot it was ever misidentified as something else isn't actually proving identity-independence, just hiding the evidence of it).
- **Regenerate `gkAssetId` on significant identity correction (treat a big-enough correction as "basically a different item").** Rejected: directly contradicts ADR-ASSET-001 Ruling 11, and would break every external reference (ownership records, listings, prior transaction history) pointing at the original `gkAssetId`.

## Implementation Gates

- ADR-ASSET-001's capture-time `gkAssetId` minting (Ruling 10) may not ship without `asset_identity_assignment` existing to receive its first (possibly `NONE`-authority, unresolved) assignment.
- Any future adapter's evidence source (ADR-ADAPTER-001) must integrate via claim ingestion, never a bespoke authority write — enforced the same way Ruling 30's adapter-interface boundary is enforced.

## Related Tickets

- None directly ticketed — this ADR formalizes an already-proven pattern (`identityReconciler.js`) as binding project-wide rather than resolving a specific open defect.

## Supersession

None. This ADR does not alter `identityReconciler.js`'s existing catalog-facet reconciliation logic — it validates that pattern and extends its reach to the physical-asset layer ADR-ASSET-001 introduces.
