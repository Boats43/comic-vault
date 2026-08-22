# ADR-ASYNC-001 — Async Execution: Outbox, Queue, Worker, DLQ

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 23–24.**

## Context

GK-144 (`docs/TICKET-REGISTRY.md`) investigated moving `api/enrich.js`'s scanlog persistence off the synchronous customer-response path using `waitUntil()` (`@vercel/functions`). Phase 0.3's verification (four required checks, amendment-gated on real evidence, not assumption) FAILED three of four: `@vercel/functions` is not even an installed dependency; today's failure logging (`console.warn` in `api/kv-cache.js`) only fires reliably because the write is currently awaited before response — moved inside an unverified `waitUntil` callback, a mid-write instance freeze could silently drop both the write and its own failure log with no independent signal; and no runtime-config evidence in this repo confirms post-response execution survival under cold-start teardown for this specific function. The ticket's own conclusion stood: "a slow honest write beats a fast lost one," scanlog stays synchronous. This ADR resolves the underlying architectural question GK-144 could only partially answer with the tools available at the time — not by re-attempting `waitUntil` alone, but by ratifying a real, durable async mechanism `waitUntil` can accelerate without ever being the thing correctness depends on.

## Decision

**Ruling 23 — outbox → queue → worker → dead-letter-queue is the async execution pattern**, for scanlog persistence (GK-144) and any future non-response-path work (ADR-EVENT-001's event stream, future notification/webhook delivery, etc.):

1. **Outbox**: the write to the outbox table happens in the SAME transaction (or, where true transactional coupling isn't available — e.g. today's KV-only persistence — the same synchronous request path) as the primary operation it's paired with. This is the durability anchor: if the primary operation succeeds, the outbox row exists, full stop, no dependency on any later async step actually running.
2. **Queue**: a separate process picks up outbox rows and enqueues them for processing — decouples "the write happened" from "the write was delivered to its final destination."
3. **Worker**: consumes the queue, performs the actual downstream work (e.g. the scanlog KV write), and marks the outbox row processed on success.
4. **Dead-letter-queue**: after a bounded number of retries, a failing item moves to a DLQ rather than being silently dropped or retried forever — visible, alertable, and exactly the "failure observability" GK-144's own Q2 check found missing from a bare `waitUntil` approach.

**Ruling 24 — `waitUntil` (or any post-response execution primitive) is a LATENCY OPTIMIZATION, never a correctness mechanism.** It may be used to kick the queue/worker step off sooner (avoid waiting for a separate cron/poll cycle), but the outbox row's existence — not the `waitUntil` callback's completion — is what guarantees the work eventually happens. If `waitUntil` never fires, freezes mid-execution, or the runtime doesn't support it at all, a separate poller/cron sweep of unprocessed outbox rows is the correctness backstop. This directly resolves GK-144's own Q1/Q3 gaps (delivery semantics and runtime lifecycle both unverifiable) by making them irrelevant to correctness — they become pure latency questions once the outbox exists.

## Invariants

1. No async work is correctness-dependent on a specific post-response execution primitive being available or reliable.
2. Every outbox row eventually reaches a terminal state: processed, or DLQ after bounded retries — never silently abandoned.
3. DLQ entries are visible/alertable, not a silent black hole.
4. The primary operation's own success/failure is never gated on the async step succeeding (the entire point of decoupling via outbox).

## Consequences

- GK-144 can now be reopened as an implementation ticket under this ADR's governance (amendment A2: "GK-144 OPEN/governed-by-ASYNC") — the architectural question is resolved; building the outbox/queue/worker/DLQ mechanism is real, scoped implementation work, not ratified as complete by this ADR alone.
- `@vercel/functions`/`waitUntil` may still be worth adding as a dependency once the outbox exists — but as an optimization on top of a correctness mechanism that doesn't need it, not as the mechanism itself. Installing it is no longer a decision this ADR needs to gate.
- The outbox pattern generalizes cleanly to ADR-EVENT-001's event stream and any future async need (notifications, marketplace sync) without a redesign per use case.

## Rejected Alternatives

- **Re-attempt bare `waitUntil` once `@vercel/functions` is installed.** Rejected: installing the dependency would only resolve GK-144's Q1 (delivery semantics become checkable) but does nothing for Q2 (failure observability) — a `waitUntil` callback that fails mid-execution still has no independent record that it was ever supposed to run, unless something OUTSIDE the callback (i.e., an outbox row) already recorded the intent. The outbox is required regardless of whether `waitUntil` ships alongside it.
- **Keep scanlog synchronous forever.** Rejected as a permanent architecture (though correct as GK-144's own interim conclusion): a slow honest write is the right call absent a real async mechanism, but this project's growth (DATA-1's own outcome-measurement ambitions) will accumulate more non-response-path work than scanlog alone, and each new need re-litigating "should this be sync or async" from scratch doesn't scale.
- **A dedicated message broker (SQS/RabbitMQ/etc.) instead of a Postgres-table outbox.** Not rejected outright — a real option for the queue/worker steps' own implementation — but the OUTBOX step specifically should be a table in the same durable store as the primary operation (Postgres, per ADR-STORAGE-001), not a separate system, so the "same transaction" durability guarantee in Ruling 23 actually holds. Which broker (if any) sits behind the queue/worker steps is DATA-1 implementation scope, not ratified here.

## Implementation Gates

- GK-144's scanlog write may migrate off the synchronous path only after the outbox table exists and a worker/poller consuming it is running — not before.
- Any future async need must be routed through this same outbox pattern rather than a bespoke one-off mechanism, unless a documented reason this pattern doesn't fit is recorded (none anticipated, but not foreclosed).

## Related Tickets

- GK-144 — OPEN/governed-by-ASYNC (per amendment A2). This ADR is that governance.

## Supersession

None. New ADR. Does not reverse GK-144's own "stay synchronous for now" interim conclusion — that conclusion was correct given the evidence at the time and remains correct until this ADR's mechanism is actually built.
