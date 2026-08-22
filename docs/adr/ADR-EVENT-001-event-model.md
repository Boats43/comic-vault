# ADR-EVENT-001 — Event Model: Hybrid Events, Envelope, Outcome Ledger, Audit ≠ Trace

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 20–22, 35.**

## Context

Structured scan telemetry already exists and already works: `src/lib/scanLog.js` writes a versioned record (`SCAN_LOG_VERSION=1`) per scan to Upstash Redis (`scanlog:v1:<ts>:<id>` + a sorted-set time index), and GK-145/GK-146 (DATA-1 readiness, shipped `c825192`) extended it with `collectionItemId` correlation and `outcome` (decision/pricingSource/price/gradeMultiplier) fields specifically to make outcome-class measurement possible. That work was explicitly measurement-only — CLAUDE.md's own note: it "does NOT capture the comp-pool snapshot, `priceDerivationTrace`, or the full pricing rationale — does not make 'why did it say $X' reconstructable." This ADR ratifies what the scanlog becomes once it graduates from measurement instrumentation to first-class system-of-record, and separates two concerns that log lines in this codebase have always informally mixed: what a human/compliance process needs to see later (audit) versus what a developer needs to see while debugging right now (trace).

## Decision

**Ruling 20 — hybrid event model.** Not pure event-sourcing (this project's `claim`/reconciliation model already IS the append-only source of truth for identity facets — re-deriving it from a generic event stream would duplicate that with a second, weaker mechanism) and not pure CRUD-with-logging (loses the append-only provenance discipline every other ADR in this set depends on). The hybrid: durable STATE lives in the typed tables and the `claim`/mint-ledger append-only records (ADR-ID-001, ADR-EVIDENCE-001) as the primary mechanism; EVENTS are a secondary, derived stream describing "what happened" for consumption by async workers (ADR-ASYNC-001), audit readers, and outcome analytics — never the sole record of a state change, always alongside a durable write to the actual state-holding table/ledger.

**Ruling 21 — a standard event envelope**, shared across every event this system emits (scan outcomes, mint events, ownership/custody transfers, identity assignment changes):

```
{
  event_id      UUID (v7, ADR-ID-001)
  event_type    TEXT  -- 'scan.outcome' | 'mint.issued' | 'ownership.transferred' | ...
  occurred_at   TIMESTAMPTZ
  actor         { principal_id, kind: 'user'|'system'|'ai-model' }
  subject       { entity_type, entity_id }  -- what this event is ABOUT
  payload       JSONB  -- event_type-specific fields
  correlation_id UUID  -- ties related events together (one scan -> one mint attempt -> one listing, etc.)
  schema_version INT
}
```

This is deliberately close in shape to `scanLog.js`'s own existing record, not a wholesale redesign — that shape is proven in production and GK-145/146 already extended it once cleanly.

**Ruling 22 — the outcome ledger is first-class, not instrumentation.** The scanlog's `outcome` field (GK-146) stops being "measurement only" and becomes a real, queried-against system-of-record for "what did this scan actually decide and why" — subject to the same durability expectations as any other permanent record this project keeps (not a cache, not TTL-bounded the way today's 90-day `KV_TTL.SCANLOG` is). The exact durability mechanism (does it move to Postgres, stay in Redis with a longer/no TTL, or something else) is DATA-1 implementation scope, not ratified here — this ruling states that it MUST become durable, not where.

**Ruling 35 — audit and trace are never the same log stream.**
- **Audit**: who did what, when, to what — compliance/accountability record, append-only, permanent, tied to a real principal (ADR-AUTH-001) and a real subject entity. Every mutation this project's ADRs govern (identity assignment, ownership transfer, mint, listing) produces an audit event.
- **Trace**: debugging/performance instrumentation — `console.log` phase timing (the existing `[perf] phase=<name>`  instrumentation in `api/enrich.js`), request-scoped diagnostic detail, anything whose purpose is helping a developer understand what the code just did. Not permanent, not principal-scoped, not a compliance record.

Conflating them (as informal `console.log` calls throughout this codebase currently do, by necessity of having no formal event model yet) means either audit-quality data gets lost when trace logs rotate/expire, or trace-volume noise pollutes what should be a clean compliance record. This ADR does not require an immediate migration of existing `console.log` call sites — it requires that any NEW durable event this project defines is explicitly one or the other, never both conflated into one stream.

## Invariants

1. Every event carries the standard envelope (Ruling 21) — no ad hoc, differently-shaped event types.
2. No event is the SOLE record of a state change — a corresponding durable write to the actual state table/ledger always accompanies it.
3. Audit events and trace instrumentation are never persisted to the same store with the same retention policy.
4. The outcome ledger's durability is real (survives longer than a debugging session), even before its final storage mechanism is chosen.

## Consequences

- `scanLog.js`/GK-145/GK-146's existing shape and fields are largely preserved, not rewritten — this ADR extends their status, not their structure.
- Future async work (ADR-ASYNC-001's outbox pattern) consumes FROM this event stream, giving the outbox a concrete, already-designed source rather than needing its own bespoke event shape.
- A future audit UI/export (for compliance, dispute resolution, or user-facing "history of my item") has a real, intended data source once this ships, rather than needing to be reverse-engineered from scattered `console.log` lines.

## Rejected Alternatives

- **Pure event-sourcing (rebuild all state from the event log).** Rejected: this project's `claim`/reconciliation model is already the append-only source of truth for identity; a second, parallel event-sourced reconstruction mechanism would be a competing truth system — the exact disease `THE REBUILD RULE` (`db/data0/0002_comic_projection.sql`) exists to prevent, one layer up.
- **Keep audit and trace conflated in one log stream (status quo).** Rejected: `docs/DATA-0-METRON-CENSUS.md`/CLAUDE.md's own scanlog history shows this project already hit the limits of that approach once (GK-145/146's own dispatch existed specifically because instrumentation-only logging couldn't answer real outcome-measurement questions) — formalizing the split now avoids repeating that gap for audit-grade questions later.
- **Make the outcome ledger durable by simply removing scanlog's TTL.** Considered, not ratified: sufficient as a stopgap but doesn't address the event-envelope standardization or audit/trace separation this ADR also requires; left to DATA-1 to decide the concrete mechanism against Ruling 22's requirement.

## Implementation Gates

- GK-144 (async scanlog write, see ADR-ASYNC-001) is governed by this ADR's event model — the write being made async does not change that it must still conform to the envelope and durability rulings here.
- No new event type ships without being classified audit or trace at design time.

## Related Tickets

- GK-144 — OPEN, governed-by-ASYNC (per amendment A2) — this ADR defines WHAT the event is; ADR-ASYNC-001 defines HOW it's delivered.
- GK-146 — the outcome-field foundation this ADR elevates to first-class.

## Supersession

None. New ADR, extends rather than replaces the existing `scanLog.js`/GK-145/146 work.
