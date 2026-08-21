# DATA-0 Architecture — GrailKey Catalog Contract

**Status: DATA-0A, design-only. No database provisioned, no credentials,
no packages installed, no ingestion, no Vercel wiring, no production
behavior change, no external calls made by this document or its
accompanying DDL.** Rights responses (Metron bootstrap/commercial terms,
GCD CC BY-SA counsel opinion) gate DATA-0B/DATA-0C — nothing here is
blocked on them because nothing here touches real data.

DDL drafts: `db/data0/0001_generic_substrate.sql`,
`db/data0/0002_comic_projection.sql`.

---

## 1. The governing doctrine — generic evidence, typed canonical entities

Two failure modes, avoided by construction, not by discipline:

- **Pure EAV for everything** — a catalog where `comic_issue` doesn't
  exist and every query reconstructs "issue number" from raw claim rows
  at request time. Technically pure, operationally hostile: every
  application query becomes a reconciliation computation, and the fast
  path (a scan pipeline doing a lookup against 2.2M rows) needs an index
  on a resolved value, not a live aggregation.
- **Pure typed tables for everything** — `comic_issue.issue_number` as a
  plain column with no evidence trail. Fast, but it's exactly the
  "second truth system" disease this project has spent AS/AM/AU/AT/AR/AQ
  fixing at the application layer (`docs/PATTERN-LIBRARY.md`) — a typed
  value with no reconciliation lineage is a value nobody can later ask
  "why do we believe this."

The resolution: **claims are the only place evidence lives; typed tables
are the only place fast lookups happen; typed tables are always
reproducible from claims.** Neither is optional, and neither substitutes
for the other. Comics get typed tables because comics are the first
vertical shipping; the evidence substrate underneath never mentions a
comic-specific concept, so the second vertical (books, per the roadmap's
own Session 4A) adds `book_*` tables and `asset_class` rows, not a
migration that touches `claim`/`external_map`/`alias`.

## 2. Table → runtime reconciler mapping

This is the load-bearing correspondence — every table above exists
because a runtime concept already exists and is already proven correct
in production. The schema does not invent a new authority model; it
persists the one that's already shipped.

| DB concept | Runtime equivalent | File |
|---|---|---|
| `claim` row | one entry from `addEvidence`/`reportConflict` | `src/lib/identityReconciler.js` |
| `claim.type` | evidence type (`corroboration` \| `conflict` \| `refinement`) | same |
| resolving a facet's canonical value | `reconcileTitle` / `reconcileIssue` / `reconcileYear` / `reconcileVariant` | same |
| `*_authority` column (cache) | the `authority` field a `reconcileX` call returns (`NONE`\|`CONTESTED`\|`CORROBORATED`) | same |
| `external_map` | provider ID mappings (GCD/Metron/ComicVine/PriceCharting) — **never** identity itself | new, no direct runtime analog yet — `api/mega-keys.js`'s own publisher/year matching is the closest existing precedent for "external value used to gate, not define, identity" |
| `alias.kind` (0A-r2: `canonical_alias`\|`catalog_alias`\|`source_alias`\|`market_observed_alias`\|`operator_alias`) | recognized canonical/source/market aliases — `source_alias`/`market_observed_alias` are the DEL O'TT lesson as data (see `0001_generic_substrate.sql`'s own header comment on `alias`) | `src/lib/premiumCreators.js`'s creator alias arrays, `src/lib/pedigreeRegistry.js`'s alias lookups — same shape, generalized |
| typed comic projection (`comic_issue` etc.) | a fast materialized cache of what the reconciler would compute live | no direct runtime analog — this is new, and exists purely for query speed; see THE REBUILD RULE (§5) for why that's the only reason it's allowed to exist |

The one deliberate asymmetry: `reconcileTitle`'s own sole-authority
source list includes `'first-eligible-visual'` (a physical, in-scan
observation) which has no equivalent in `claim.source` — a scan-time
observation is not a catalog claim, and never becomes one. The catalog
answers "what does the reference data say"; the scan pipeline's own
reconciler answers "what does THIS physical book say," and AR's own
per-facet law already governs how those two kinds of evidence combine
at scan time. DATA-0 does not change that law — it gives the catalog
side of it a persistent home for the first time.

## 3. Why the evidence layer is generic and the operational catalog is typed

Restated directly, since it's easy to read the schema and miss the
reasoning: **the evidence layer is generic because "what counts as
evidence" (a source made a claim about a facet) is the same fact shape
for a comic, a book, or a trading card — inventing a `comic_claim` table
distinct from a future `book_claim` table would be re-deriving
`reconcileX`'s own generic contract at the schema layer, the same
mistake AssetCore's own extraction (Session 3B, CLAUDE.md) already
corrected once at the application layer.** The operational catalog is
typed because "what a fast lookup needs" is genuinely different per
asset class — a comic's fast-path query is `(series, issue_number)`; a
card's will be `(player, team, card_number, set)`. Typing the lookup
path is not a compromise of the generic doctrine; it's the reason the
generic doctrine doesn't have to also solve query performance.

## 4. Source lineage

`source_snapshot` (see `0001_generic_substrate.sql`) is the explicit
answer to "GCD and Metron must never directly overwrite canonical
GrailKey truth." Fields and why each exists:

- `source` / `source_record_id` — which provider, which record, in the
  provider's own key space.
- `source_version` — GCD's bi-weekly dump date, or Metron's own
  `modified_gt`-comparable timestamp. Lets two snapshots of the same
  source record coexist and be ordered.
- `retrieved_at` vs `source_modified_at` — kept as two separate fields
  deliberately. `retrieved_at` is when WE fetched it; `source_modified_at`
  is when THEY last changed it (when the source exposes one — Metron
  does, GCD's bulk dump may not per-record). Conflating these would make
  "how stale is our copy" unanswerable.
- `payload` (raw JSONB) + `payload_hash` — the verbatim fetched record is
  kept, not just the fields we happened to map at ingestion time. A
  future claim-extraction rule that reads a field we didn't originally
  parse doesn't require re-fetching the source; it re-reads the snapshot
  already on disk. `payload_hash` makes "did anything change" a cheap
  comparison instead of a full re-diff.
- `license` / `rights_classification` — GCD's metadata (CC BY-SA 4.0) and
  GCD's cover images (explicitly rights-reserved, NOT under the CC
  license — confirmed directly from GCD's own docs during the pre-flight)
  are different rights regimes from the SAME source. This field exists so
  a future "can we display this" check is a column read, not a
  per-record judgment call repeated by whoever queries it next. Metron's
  own bootstrap-export terms are pending — its rows land with
  `license = 'metron-bootstrap-pending-terms'` until that email response
  updates the actual value, never assumed permissive by default.
- `superseded_by` / `deleted_at` — a source record is never hard-deleted;
  a retraction or replacement is itself a recorded fact, not an erasure.
  This mirrors AM/AU's own "verbatim survives as evidence" rule (GK-140's
  `justifiedBy[].verbatim`) one layer down, at the ingestion boundary
  instead of the reconciliation boundary.
- **0A-r2 additions — `source_uri` and `ingestion_run_id`.** `source_uri`
  is the literal URL/file path this specific record was fetched from
  (the GCD dump's own path, or the exact Metron endpoint+query called) —
  "where did this come from" as a re-fetchable fact, not something
  reconstructed from memory later. `ingestion_run_id` (a new
  `ingestion_run` table — id/source/run_kind/started_at/completed_at/
  status/notes) is batch-level lineage: which RUN of the sync worker
  produced this fetch, distinct from the per-record `retrieved_at`
  timestamp already on this table. Answers "did run N complete" or
  "re-process everything run N ingested" without scanning every
  `source_snapshot` row for a timestamp window.

`claim.source_snapshot_id` ties every derived claim back to the exact
fetch that produced it — "why do we believe this" always terminates at a
real, re-inspectable payload, never at "the sync worker said so."

## 5. THE REBUILD RULE

> **Every typed row is derivable from claims + reconciliation rules
> alone. Dropping and rebuilding all `comic_*` tables from the evidence
> layer must be a supported, scripted operation.**
>
> If a typed row can exist that the evidence layer cannot reproduce, the
> projection has become a second truth system — which is the disease
> this entire architecture exists to kill.

This is not aspirational language — it is a concrete, checkable property
the DDL is built to satisfy:

- Every `comic_*` primary key is a `catalog_entity.id` (via
  `REFERENCES catalog_entity(id)`), never an independently-generated ID.
  There is no way to create a `comic_issue` row without first creating
  the `catalog_entity` row the claims attach to.
- Every resolved value column (`comic_series.title`,
  `comic_issue.issue_number`, `comic_issue.cover_year`,
  `comic_variant.variant_label`) has a named counterpart in `claim.facet`
  — nothing in the typed tables names a fact that couldn't have arrived
  as a claim.
- Every `*_authority` column is documented, at the DDL comment level, as
  a cache — "refreshed by the same rebuild job that populates the rest
  of this row," never hand-edited.
- The practical test, once real data exists: `TRUNCATE comic_publisher,
  comic_series, comic_issue, comic_printing, comic_variant, comic_creator,
  comic_issue_creator, comic_variant_creator CASCADE;` followed by
  re-running the materialization job against `claim` alone must produce
  a byte-identical (or authority-identical) result. This should become
  an actual CI-style check once ingestion exists — logged as an open
  question in §8, not built here.

## 6. External mapping

`external_map` supports GCD, Metron, ComicVine, UPC, ISBN, SKU,
PriceCharting, and any future provider via the same `source` column — no
per-provider table. `match_method` and `verification_state` exist
because not all crosswalk links carry the same confidence: Metron's own
`gcd_id`/`cv_id` fields (confirmed real and queryable during the
pre-flight, coverage % unmeasured — GK-141's own open question) are
`match_method = 'source-native-crosswalk'`, `verification_state =
'automated'` by default; a link this project derives itself (fuzzy
title+issue+year matching across two providers with no native
crosswalk) is `match_method = 'automated-fuzzy'`, `verification_state =
'unverified'` until either an automated confidence threshold or a human
promotes it. `rejected` exists so a fuzzy match that turns out wrong
stays recorded (never deleted) as a rejected hypothesis — the same
"verbatim survives, never erased" discipline as `source_snapshot`.

## 7. Future dual-shadow contract (document only — no shadow code exists)

Two lanes, deliberately different, both required before any scan-path
cutover (per the roadmap's own 0G gate):

**A. Agreement Shadow.** Input: the CURRENT production confirmed
identity (`confirmedTitle`/`Issue`/`Year`/`Publisher`, already resolved
by the existing scan-time reconciler). Action: look this exact identity
up in the new catalog. Measures: does the catalog corroborate what
production already decided. This answers "is the catalog consistent with
what we already believe," and is the cheaper, lower-risk lane to build
first — it's what the DATA-0 pre-flight's own Q5 sketched.

**B. Independent Retrieval Shadow.** Input: minimally-constrained raw
scan evidence (Vision's own raw title/issue read, the frozen rank-1 row's
own text) — deliberately NOT the production pipeline's disputed
facets. Action: retrieve the catalog's own top-N candidates from that raw
input alone. Measures: does an INDEPENDENT path through the catalog land
on the same answer production did, via genuinely separate reasoning.

**Why B must not constrain on disputed year/variant:** if lane B fed the
production pipeline's own CONTESTED year or variant value into its query
constraints, a production error would propagate into the catalog query,
the catalog would return a candidate consistent with that same wrong
constraint, and the shadow comparison would read as "agreement" — false
confidence manufactured by the shadow lane inheriting the exact mistake
it exists to catch. This is precisely AR's own "a value must not vote for
itself" invariant (Directive Z/GK-62, `docs/PATTERN-LIBRARY.md`),
restated one layer up: a disputed production value must not be allowed
to author the very query that's supposed to independently check it.

Neither lane exists as code in DATA-0A. Both require the catalog itself
(DATA-0B/C) and real ingested data before there's anything to query.

## 8. Deployment topology (0A-r2)

New fact from the DATA-0 pre-flight and the GCD file itself: Neon's free
tier caps at **0.5GB storage**; the actual GCD dump (`current.zip`,
verified 2026-08-20) is **695MB compressed** — uncompressed, a MySQL dump
regularly runs several times that. Neither fits in, nor belongs in, a
0.5GB serverless Postgres tier meant for fast operational lookups.

**Decision: raw source data never enters Neon.** Concretely:

- **`source_snapshot` (§4) — including its `payload` column, the full
  raw fetched record — lives in LOCAL staging only** (Docker Postgres, or
  even flat files during DATA-0B before any Postgres exists at all — see
  `db/data0/snapshots/`). This is the ONLY table in the substrate that
  holds bulk raw data, and it is deliberately the one excluded from the
  hosted tier.
- **Neon holds the canonical typed projection (all `comic_*` tables),
  `external_map` (crosswalk — small, one row per external ID, not per
  raw record), and a bounded set of `claim` rows** — the claims that
  currently justify a typed row's resolved value and authority, not an
  unbounded historical ledger of every claim ever observed from every
  re-sync. A claim superseded by a newer observation from the SAME
  source moves to local archive alongside its originating
  `source_snapshot`; Neon's own `claim` table stays sized to "what's
  live," not "everything that ever happened."
- This does **not** weaken THE REBUILD RULE (§5) — it narrows what the
  rule is checked against. Neon's own typed projection must still be
  fully reproducible from Neon's own current `claim` set + the
  reconciliation rules; the full historical evidence ledger (every claim
  ever observed, including superseded ones) is a SEPARATE, stronger
  guarantee that exists locally for audit purposes, never conflated with
  the hosted rebuild property.

**Upgrade trigger.** Monitor combined size of `comic_*` + `external_map`
+ live `claim` on Neon. When that total approaches roughly 350-400MB
(leaving real headroom under the 500MB free cap, not running it to the
edge), either: (a) upgrade to Neon's usage-based paid tier — per the
DATA-0 pre-flight's own Q1 finding, this is a genuinely small cost at
this project's scale (storage alone was estimated at ~$0.35/GB-month,
i.e. low single-digit dollars for the overflow, not a re-architecture);
or (b) prune further — archive claims for facets whose authority hasn't
changed across N sync cycles to local-only, keeping Neon's live set
tighter. Both are viable; which one fires first is a DATA-0B/C-era
operational decision, not designed further here.

## 9. Risks / open questions

- **GCD CC BY-SA 4.0 ShareAlike scope** (pending counsel) — does a
  derivative catalog database built FROM GCD metadata trigger the
  ShareAlike obligation to release that database under the same license,
  or does ShareAlike only reach redistribution of the dump itself? This
  gates DATA-0B (real GCD ingestion) entirely; nothing in DATA-0A depends
  on the answer, but nothing past it can proceed without one.
- **Metron bootstrap export + commercial terms** (pending Metron's
  response) — gates DATA-0C (real Metron sync), same reasoning.
- **Crosswalk yield is genuinely unmeasured** (GK-141) — the DDL's
  `external_map.verification_state` distinction exists in anticipation of
  this, but the actual coverage number needs a real API sample once
  credentials exist, not an assumption baked into the schema now.
- **`comic_creator` as a parallel sequence vs. its own `asset_class`** —
  flagged in `0002_comic_projection.sql`'s own comment, not decided.
  Modeling a creator AS a `catalog_entity` (asset_class = 'creator')
  would make creator aliasing/crosswalk (VIAF, Wikidata IDs) fall out of
  the SAME generic substrate for free, at the cost of one more join on
  every creator-credit query. Worth revisiting once real creator-alias
  volume (migrating `premiumCreators.js`'s 80-entry registry) shows
  whether that join cost matters in practice.
- **THE REBUILD RULE's own verification** — described in §5 as a
  practical test, not yet a scripted, CI-enforced check. Should become
  one before DATA-0B ships any real typed row, so the invariant is
  machine-verified, not just documented.
- **`facet` extensibility across asset classes** — the current design
  lets ANY facet code apply to ANY asset_class (no `asset_class_id` on
  `facet` itself). This is deliberate for now (title/issue/year are
  meaningful across comics/books/cards even if the VALUES differ in
  shape), but a future asset-class-scoped facet (a card's "rookie flag")
  will need either a nullable `asset_class_id` FK on `facet` or a
  join table — not designed here, flagged for DATA-0B/Session-4B
  crossover.
- **`waitUntil`-based post-response writes** (GK-144, opened alongside
  this dispatch) — the dual-shadow lanes above will need exactly this
  mechanism once they're built. GK-144's own trace (delivery semantics,
  failure observability, Vercel lifecycle survival) is a prerequisite for
  either shadow lane reaching production, not just for moving the
  existing scanlog write.
