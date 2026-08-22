# ADR-AUTH-001 — Principal / Owner / Custodian Separation

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 12–15, 36.**

## Context

`docs/PATTERN-LIBRARY.md`'s GK-151 finding (Asset Network census) already did the hard diagnostic work this ADR formalizes: 11 of 14 `api/*.js` endpoints carry zero access-gate check of any kind, the 3 that do check a single shared secret (`ACCESS_CODE`/`vault_key`) rather than a per-user principal, and "list on eBay" today means "list on the one operator's eBay account" — a single static credential set for the whole deployment. GK-151's own registry entry already named the four-step chain required before multi-user commerce ships: **authenticated principal → authorized asset → authorized marketplace account → authorized mutation**, all four, in that order. This ADR ratifies that chain as binding architecture and adds the ownership/custody model it depends on.

GK-151 is explicit that today's single-shared-secret model is "acceptable today, as a single-operator prototype under Jimmy's own sole use. Categorically unacceptable the moment a second real user exists." Nothing in this ADR requires immediate implementation against that reality — it is the standing hard gate for when it changes.

## Decision

**Ruling 12 — three distinct roles, never conflated:**
- **Principal**: the authenticated actor making a request right now (a logged-in user, or — during the current single-operator era — the one shared operator identity). A principal is a session-scoped fact about who is asking.
- **Owner**: who the system's own records say legally/records-wise owns a given `gkAssetId`, right now. A durable fact about the asset, independent of who's currently logged in.
- **Custodian**: who currently physically possesses or controls the asset, which may differ from the owner (consignment, storage, a pending sale, a loan). Also a durable fact about the asset, tracked separately from ownership.

**Ruling 13 — the authorization chain is four steps, always in order, never short-circuited:**
1. Authenticated principal (does a real, verified identity exist for this request at all)
2. Authorized asset (does THIS principal have a real ownership/authorization relationship to this specific `gkAssetId` — owner, custodian, or an explicit delegation)
3. Authorized marketplace account (does this principal's OWN external credential — eBay, Whatnot, etc. — authorize this action, never a shared deployment-wide credential standing in for them)
4. Authorized mutation (does the specific write being attempted fall within what this principal is allowed to do to this asset — e.g. a custodian without ownership may not be authorized to list-for-sale even if they can update condition notes)

**Ruling 14 — ownership and custody are append-only histories**, mirroring the `claim`/`conflict` append-only discipline `identityReconciler.js` already established for identity facets (`db/data0/0001_generic_substrate.sql`'s own `claim` table). A transfer of ownership or custody is a NEW row, never an edit to a prior one — the full chain of "who owned/held this, when" is permanent, auditable history, not a mutable current-state field.

**Ruling 15 — authorization chains, not flat roles.** A principal's authorization to act on a specific asset can be DELEGATED (an owner authorizing a custodian to list on their behalf, for instance) without transferring ownership itself. Delegation is its own append-only record, distinct from both ownership and custody transfer, with its own scope (which mutations it authorizes) and its own expiry/revocation.

**Ruling 36 — this is a hard gate, not a phased rollout that ships partially enforced.** All four steps of Ruling 13's chain must exist together before ANY multi-principal commerce mutation ships — GK-151's own registry text ("ALL FOUR required, in this order, before any multi-user commerce ships") is preserved verbatim as binding.

## Invariants

1. No endpoint performs an asset mutation without checking all four chain steps, in order — a partial check (e.g. principal + mutation-type, skipping asset authorization) is a defect, not an acceptable interim state.
2. Ownership/custody/delegation records are never updated in place — every change is a new row with its own timestamp and acting principal.
3. A shared, deployment-wide credential (today's `ACCESS_CODE`, `EBAY_AUTH_TOKEN`) may never be treated as equivalent to a verified principal's own authorization once a second real user exists — GK-151's own line, restated as an invariant.

## Consequences

- The current single-operator prototype is explicitly acknowledged as NOT YET compliant with this ADR and is not required to become so immediately — this ADR governs what must be true before multi-user commerce, not a retroactive judgment on the prototype.
- Every future commerce-adjacent endpoint (listing, delisting, bundle creation, transfer) must be designed against this four-step chain from day one, not bolted on after the fact.
- Ownership/custody as append-only history gives GrailKey a real provenance record per physical asset — directly useful for future consignment/marketplace features, not just an access-control mechanism.

## Rejected Alternatives

- **Flat "owner" role only, no custodian distinction.** Rejected: consignment, storage, and pending-sale scenarios are ordinary in the collectibles market this project serves; conflating owner and custodian would make those scenarios structurally unrepresentable.
- **Mutable current-owner field instead of append-only history.** Rejected: loses the provenance trail, and reintroduces the exact "second, competing truth system with no reproducible history" failure class `THE REBUILD RULE` and `identityReconciler.js`'s own claim model already exist to prevent — applied here to authorization instead of identity.
- **Per-endpoint ad hoc authorization checks.** Rejected: GK-151's own finding (11/14 endpoints with zero gate) is a direct consequence of authorization being left to each endpoint's own judgment rather than a shared, enforced chain.

## Implementation Gates

- GK-151 stays OPEN, governed by this ADR (per amendment A2) — this ADR does not close it, it defines what closing it requires.
- No second real user account may be onboarded until Ruling 13's four-step chain is implemented and enforced on every commerce-mutation endpoint.

## Related Tickets

- GK-151 — OPEN/HARD-GATE-AUTH (per amendment A2), the founding finding this ADR formalizes.
- GK-150 — the `bundleId=ebayItemId` finding is partly an ADR-ADAPTER-001 concern (listing-as-projection) and partly this ADR's concern (a bundle's real owner/custodian must be GrailKey-tracked, not inferred from an external marketplace ID).

## Supersession

None. New ADR, no prior authorization model existed to supersede (the current `ACCESS_CODE`/`vault_key` mechanism was never itself the subject of a prior ADR — it is prototype-era code, not a ratified architecture decision).
