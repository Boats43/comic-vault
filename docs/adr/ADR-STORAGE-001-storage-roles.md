# ADR-STORAGE-001 — Storage Layer Roles

**Status:** Ratified (Master Architecture Summit, Phase 1). **Rulings covered: 17, 28.**

## Context

This project already runs three genuinely different storage mechanisms for three genuinely different jobs, arrived at independently across separate dispatches rather than designed together up front: Upstash Redis via `api/kv-cache.js` (live since 2026-06-29, TTL'd API-lookup caching), local Docker MySQL (`docs/DATA-0B-2-STAGING.md`, raw GCD staging, never Neon per `docs/DATA-0-ARCHITECTURE.md` §8), and now a confirmed-live Neon Postgres instance (`GRAILKEY_CATALOG_DATABASE_URL`, discovered during this summit's own A6 evidence pass, PostgreSQL 18.6, zero tables — see ADR-ID-001). Nothing has previously ratified which storage layer is responsible for which class of data. ADR-MEDIA-001 already carved out object storage for binary media. This ADR states the remaining roles.

DATA-0D's crosswalk validation (`docs/DATA-0D-CROSSWALK-VALIDATION.md`) surfaced a real, load-bearing data-quality fact that any storage/indexing design built on top of the GCD spine must account for: **59.6% of `gcd_issue` (1,554,522 of 2,608,777 rows) has an empty `key_date`** — no issue-level date at all, confirmed via direct query against the real loaded spine, not estimated. Any design that assumes date-based partitioning, decade-stratified indexing, or date-driven query optimization will silently misbehave on well over half of the real catalog if this gap isn't named as a first-class constraint.

## Decision

**Ruling 17 — three storage roles, cleanly separated:**
- **Postgres (Neon)** — the typed, relational, queryable identity/catalog/claim/authorization layer: `catalog_entity`, `comic_*`, `claim`, `external_map`, ownership/custody (ADR-AUTH-001), asset identity assignment (ADR-EVIDENCE-001). The single source of relational truth for everything with real structure and relationships.
- **Object store** — binary media (ADR-MEDIA-001), referenced from Postgres, never embedded in it.
- **KV (Upstash Redis, the existing `api/kv-cache.js`)** — ephemeral, TTL-bounded caching only: API lookup results, computed derivations worth avoiding recomputation of within a bounded window. Never a source of truth for anything — every KV entry must be reconstructable from the Postgres/object-store layer if lost, matching the existing cache's own already-correct contract (`kvGet`/`kvSet`'s graceful-degradation behavior, unaffected by this ADR).

Local staging (Docker MySQL, `docs/DATA-0B-2-STAGING.md`) is explicitly OUT of scope for this role split — it is a transient, local-only intake mechanism for a specific external bulk source, not a permanent storage role in the production architecture, and `docs/DATA-0-ARCHITECTURE.md` §8's own ruling on it stands unchanged.

**Neon usage is usage-driven, not maximalist upfront allocation.** `docs/DATA-0-ARCHITECTURE.md` §8's own monitored-threshold approach (~350-400MB combined `comic_*`/`external_map`/live-`claim` footprint, upgrade trigger before hitting the 500MB free-tier cap) remains the standing discipline — this ADR does not relitigate that math, it ratifies the PRINCIPLE it already embodies: provision what current real usage needs, monitor, upgrade or prune when approached, never pre-allocate for a hypothetical full-population load that DATA-0E-FULL's own budget math (Task C, amendment A7) has not yet justified.

**Ruling 28 — the 59.6% dateless-bias warning is a standing design constraint, not a one-off finding.** Any future schema, index, partitioning strategy, or query pattern touching `comic_issue.cover_year` (or any GCD-sourced date field) must explicitly handle the "no date recorded" case as a first-class, common outcome — not an edge case, not a null defaulted to some sentinel that silently sorts wrong, not an assumption that "if it's missing it's probably old/probably recent." DATA-0D's own by-decade reverse-coverage table (`docs/DATA-0D-CROSSWALK-VALIDATION.md`) was itself only computable against the DATEABLE 40.4% subset for exactly this reason — the same discipline applies to any future query or index built on this data.

## Invariants

1. No binary media data enters Postgres (ADR-MEDIA-001, restated as a storage-role invariant here).
2. No KV entry is the sole record of anything that must survive a cache eviction or Redis-level failure — cache-miss must always be recoverable from Postgres/object-store.
3. Any date-partitioned or date-indexed structure over GCD-sourced data must have an explicit, tested "no date" path, not an implicit one.
4. Neon capacity decisions are re-evaluated against real measured usage (matching `docs/DATA-0-ARCHITECTURE.md` §8's existing upgrade-trigger discipline), not provisioned in advance for a theoretical maximum.

## Consequences

- DATA-0E-FULL's own canonical-subset sizing question (Option A/B/C in `docs/DATA-0E-PILOT-CANONICAL-MINTING.md`'s Task 5 draft) inherits Ruling 17's usage-driven principle directly — the eventual choice must be justified by real, current need, not by "we might as well mint everything since Neon exists now."
- Local MySQL staging remains local, transient, and MySQL-flavored — no attempt to unify it with the Postgres role split is implied or required by this ADR.

## Rejected Alternatives

- **One database for everything (Postgres holds cache too).** Rejected: conflates a durable-truth layer with an ephemeral-performance layer, and this project's existing KV cache (`api/kv-cache.js`) already works correctly in its current role — no reason to disturb it.
- **Provision Neon at a size that comfortably fits the full 2,608,777-issue population upfront.** Rejected: contradicts `docs/DATA-0-ARCHITECTURE.md` §8's own already-ratified usage-driven discipline, and DATA-0D's own reverse-coverage finding (6.24% overall Metron-crosswalk coverage) suggests the vast majority of that population has no corroborating evidence yet anyway — minting it all upfront would be minting mostly-uncorroborated GCD-only claims at real storage cost for no proven benefit.
- **Treat missing `key_date` as defaulting to a specific era for indexing purposes.** Rejected: silently fabricates a fact not in evidence — exactly the class of error `I13` (Log-Card Fidelity, CLAUDE.md standing protocol) already prohibits in the comic-pricing domain, extended here to the catalog layer.

## Implementation Gates

- Any DDL migration adding a date-based index/partition to `comic_issue` must include an explicit test case for the missing-date row shape before merge.

## Related Tickets

- None directly — this ADR formalizes storage-role discipline already implicit in prior DATA-0 work (`docs/DATA-0-ARCHITECTURE.md` §8) plus DATA-0D's own new finding.

## Supersession

None. This ADR extends, and does not contradict, `docs/DATA-0-ARCHITECTURE.md` §8's existing Neon-usage-driven ruling — that document's own math and reasoning stand.
