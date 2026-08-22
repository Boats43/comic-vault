# ADR-API-001 — API Contract Discipline

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 25–27.** (Ruling 29 is scoped to the DATA-0E-FULL execution plan, per amendment A1, and is not part of this ADR.)

## Context

This project already has a real, working contract-enforcement mechanism for the comic-pricing domain: `src/lib/responseContract.js`'s `validateContract` implements invariants I1–I13, including I13 ("Log-Card Fidelity" — every card-rendered value must be traceable to a log line, never silently filtered/replaced/fabricated), a CLAUDE.md standing P0 protocol. The Handler-Wiring Verification protocol (GK-138, also standing) separately requires any `api/enrich.js` wiring change to prove itself against a real handler invocation, not unit fixtures alone — born from a real production `ReferenceError` that unit tests never caught. Neither of these was designed as a general API contract policy; both are comic-pricing-specific. As this architecture introduces genuinely new endpoint classes (identity/mint lookups, asset ownership queries, event-stream consumers) that have nothing to do with pricing, this ADR generalizes the DISCIPLINE those two mechanisms already embody — traceability, real-handler verification — without requiring the new endpoints to literally reuse `responseContract.js`'s comic-specific invariant set.

## Decision

**Ruling 25 — every new API surface is versioned and carries an explicit compatibility policy from its first commit.** Not retrofitted later. A version is embedded in the response envelope (or route path, implementation's choice) from day one; breaking a prior version's contract requires a new version, never a silent in-place change to an existing one — the same "never silently mutate, always a new record" discipline this summit's other ADRs (ID-001's mint ledger, AUTH-001's ownership history) already apply to data, applied here to the API's own shape.

**Ruling 26 — mutating endpoints are idempotent by design, keyed on an explicit idempotency key supplied by the caller (or derived from ADR-EVENT-001's `correlation_id` where one already exists), not by "the caller just shouldn't double-submit."** A retried request with the same idempotency key against a not-yet-completed or already-completed mutation returns the SAME result, never performs the mutation twice. This is the API-layer expression of the same idempotency discipline ADR-ID-001 requires of minting and ADR-ASYNC-001 requires of outbox processing — a caller retrying a listing creation, an ownership transfer, or a mint request must never be able to cause a duplicate by network retry alone.

**Ruling 27 — structured errors, always correlation-traceable, never genericized away.** Every error response carries: a machine-readable error code (stable, documented, not a free-text message alone), the `correlation_id` (ADR-EVENT-001) tying it to whatever event/request chain produced it, and enough structured detail for the caller to distinguish "retry this" from "this will never succeed as submitted" from "you're not authorized" (ADR-AUTH-001's own four-step chain should be distinguishable in the error shape — a 403 from step 2 of that chain looks different from a 403 from step 3). This generalizes I13's own principle ("if the logs have it, the card has it") to errors specifically: if the system knows why something failed, the caller-facing error says so, never collapsed to a generic 500 that discards the reason.

## Invariants

1. No API version is edited in place once a real consumer depends on it — a breaking change is always a new version.
2. Every mutating endpoint accepts and honors an idempotency key.
3. Every error response includes a correlation ID and a stable machine-readable code, never message-text-only.

## Consequences

- New endpoints introduced by DATA-1/DATA-0E-FULL work (mint lookups, asset queries) are built against this discipline from the start, rather than inheriting the current prototype's more ad hoc endpoint conventions (`api/enrich.js` et al., which predate this ADR and are not required to retroactively conform).
- GK-138's own handler-wiring-verification discipline remains standing and applies with equal force to any NEW endpoint this architecture introduces — this ADR does not relax it, it sits alongside it.

## Rejected Alternatives

- **Reuse `responseContract.js`'s I1–I13 invariants verbatim for all future endpoints.** Rejected: those invariants are genuinely comic-pricing-specific (grade multipliers, comp pools, decision actions) — forcing identity/asset/event endpoints to satisfy pricing-domain invariants that don't apply to them would be cargo-culting a mechanism rather than applying its actual principle.
- **No formal idempotency mechanism — rely on clients being well-behaved.** Rejected: directly contradicts ADR-ASYNC-001's own outbox/retry model, which assumes retries WILL happen (that's the point of a DLQ) — an API layer that can't tolerate its own retry semantics defeats the mechanism underneath it.
- **Generic error responses for security (avoid leaking implementation detail).** Rejected as a blanket policy: a machine-readable code plus correlation ID does not require leaking sensitive detail (the actual sensitive-detail question is a per-endpoint judgment call, unrelated to whether the error is traceable at all) — conflating "don't leak secrets" with "don't structure errors" throws away debuggability for a security property structured errors don't actually threaten.

## Implementation Gates

- No new endpoint under this architecture ships without a stated version and idempotency-key handling for any mutation it performs.

## Related Tickets

- GK-138 — standing protocol, unaffected, applies alongside this ADR to any new `api/enrich.js`-adjacent wiring.

## Supersession

None. New ADR. Does not alter `responseContract.js`'s existing I1–I13 invariants or GK-138's own standing requirement.
