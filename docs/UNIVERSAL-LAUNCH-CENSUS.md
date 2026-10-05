# THE UNIVERSAL LAUNCH CENSUS IS A SYSTEM MAP, NOT THE ROADMAP.

**Current roadmap:**

```
LIVE EXPOSURE CLOSURE
→ UNIVERSAL U1
→ OUTSIDE-USER PRIVATE BETA
```

**Outcome #1 proceeds in parallel** and does not gate Universal U1.

This document is the read-only census taken at HEAD `2e74cb1` (2026-10-04). It maps what exists versus what is missing for the product promise *"photograph almost any physical object, create a durable GrailKey physical asset, manage it independent of category, and route supported assets through one or more marketplace adapters."* It is a map of the territory, not a plan or a commitment to build any item in it.

## Evidence labels (preserved exactly; INFERRED claims are never upgraded)

- **VERIFIED** — a research subagent read it in code or SQL (a subset was independently re-checked by the author; see "Independent re-checks").
- **DOC** — a registry, board, or ADR claim; not re-derived from code.
- **INFERRED** — reasoned from the above, not executed.

## Independent re-checks performed by the author (not merely reported)

- No code in `api/` or `src/` writes a `DELISTED` outcome except through the manual `scripts/observe-outcome1-listing.mjs`. (VERIFIED, grep.)
- `Phoenix, AZ` / `85033` is hardcoded in both XML builders in `api/list-ebay.js` (single + bundle). (VERIFIED, grep.)
- `ALLOWED_ASSET_CLASSES = ['comic','generic']` at `src/modules/capture/service.js:45`; `createPhysicalAsset` defaults `assetClass = 'comic'`. (VERIFIED, grep.)
- `marketplace_connection.provider CHECK (provider IN ('EBAY'))` in migration `0031`; `collection_item.asset_category TEXT NOT NULL DEFAULT 'comic'` in `0026`. (VERIFIED, grep.)
- No code change was made by the census. `git status` was identical before and after it.

## Standing caveats

- Production state (H8 flag value, Production row counts, Clerk dashboard restrictions, Vercel env values) was **not read**. Anything about Production is DOC or INFERRED.
- Provider API availability claims (Shopify, Whatnot, Mercari, Facebook) are general knowledge, labeled as such, and uncertain. Re-check against current provider docs before relying on them.

## Major conclusions (retained verbatim in intent)

1. **Photo → Generic does not yet exist.** The scan path classifies only `comic` or `book`; a non-comic dead-ends at "No comic detected." (VERIFIED)
2. **Silent Comic defaults remain.** `gk_asset.asset_class`, `collection_item.asset_category`, `createPhysicalAsset`, `createCollectionItem`, `getAdapter`, `App.jsx:12229`, `enrich.js:2587` all default a missing/unknown category to `comic`. (VERIFIED)
3. **Book cannot mint as Book.** `ALLOWED_ASSET_CLASSES` excludes `book`; a book capture is `comic` at asset level. (VERIFIED)
4. **Generic management is incomplete.** After capture there is no inventory state, no operator corrections, no reclassification, no add-photo, no valuation trigger, no listing, no outcome path. (VERIFIED; the add-photo gap is INFERRED from render structure.)
5. **Multi-marketplace safety is incomplete.** No cross-channel duplicate prevention, no automatic reservation, no SOLD-closeout withdrawal, no `DELISTED` write from the in-app delist path. (VERIFIED)
6. **A normalized marketplace adapter contract does not yet exist.** `marketplacePackets.js` covers only Mercari/Facebook/Craigslist/Whatnot text; eBay facts are assembled ad hoc inside `list-ebay.js`. (VERIFIED)

## ADDENDUM — 2026-10-04, post-census, VERIFIED BY REAL HANDLER EXECUTION

The census said the manual Generic Asset Mode button "mints a durable asset" (PARTIAL for non-comic capture). **That is corrected: the Generic capture path is currently rejected.**

`src/lib/genericAssetCapture.js` calls `POST /api/capture-scan` *before* the `collection_item` exists server-side, and the GK-266 guard (`assertCollectionItemLinkable`) rejects exactly that: *"collectionItemId … does not resolve to a durable collection_item owned by this principal — sync the catalogue item (POST /api/collection) before linking a physical asset to it."* Reproduced against the real `api/capture-scan.js` handler and real Development Postgres (`tests/second-principal-capture-certification.test.js`, FINDING PROBE). The owned-capture path used by `GrailKeyOperatorPanel` (sync the item, then capture) works. Fixing Generic ordering belongs to Universal U1 and was **not** done in the live-exposure-closure dispatch.

Revised answer to census Q1: *Can a user today photograph an arbitrary non-comic object and end with a durable `gkAssetId` and a Collection row?* — **NO** (previously labeled PARTIAL).

Also found: `GET /api/assets?gkAssetId=<not-a-uuid>` returns HTTP 500 (`invalid input syntax for type uuid`) instead of 400. Informational; no data exposure.

---

## 1. Universal capture, current state

**Can a user today photograph an arbitrary non-comic object and end with a durable `gkAssetId` and a Collection row?** ~~PARTIAL~~ → **NO** (see addendum).

| Path | Entry point | Classification and mint | Failure behavior |
|---|---|---|---|
| Comic scan | `gradeBlob` → `/api/grade` → `/api/enrich` → `addToCatalogue` | `ensureAssetType` returns only `book` or `comic` (`grade.js:204-212`). No mint on scan; mint is the separate explicit "Capture as Owned Physical Asset" button → `/api/capture-scan`. (VERIFIED) | A non-comic gets "No comic detected. Try again." (`App.jsx` gate). Nothing is saved. (VERIFIED) |
| Book scan | Same route; the GK-252 gate accepts `assetType==='book'` | Saved as `assetCategory:'book'`; a mint would be `asset_class='comic'` since `'book'` is not in the capture allowlist. (VERIFIED/INFERRED) | Book is never priced (GK-250). (VERIFIED) |
| Generic | Collection toolbar → `GenericAssetCapture.jsx` → `genericAssetCapture.js`; never calls grade/enrich | Operator enters a required name; POSTs `/api/capture-scan` with `assetClass:'generic'`. (VERIFIED) **Currently rejected by GK-266 — see addendum.** | Draft kept in IndexedDB for retry. (VERIFIED) |

## 2. Kernel neutrality

**Neutral (YES):** ownership, principal scoping, acquisition basis, inventory state, valuation history, decision history, provenance. (VERIFIED)
**PARTIAL:** media (`capture_view` is `FRONT/BACK/SPINE/PAGES/DETAIL`, book-shaped); marketplace linkage and outcomes (`channel` is free text but eBay is the only provider); corrections (`GRADE/GRADING_FORMAT/IDENTITY/CONDITION`).
**NO:** operator actions (`action_code` is `LIST/HOLD/PASS` only).

| Comic assumption | Class |
|---|---|
| `gk_asset.asset_class DEFAULT 'comic'` and the `createPhysicalAsset` default | **P0 universal blocker** |
| `ALLOWED_ASSET_CLASSES` excludes `book` | **P0 universal blocker** |
| `collection_item.asset_category DEFAULT 'comic'`, plus ~10 code defaults | **P0 universal blocker** |
| `operator_action_event` is `LIST/HOLD/PASS` only (no TRADE/CONSIGN/DONATE) | **P0 universal blocker, for disposition** |
| Capture mapping needs `title+issue+year` for CORROBORATED identity | Category-adapter concern |
| Duplicate-copy detection keyed on comic identity | Category-adapter concern |
| `buyer_decision_event` typed comic columns, no JSONB | Category-adapter concern |
| `valuation_question.disposition IN ('raw','graded')`, `grade_assumption NUMERIC(3,1)` | Category-adapter concern |
| `condition_observation` CGC CHECK (never applied) | Banked |
| `catalog_entity` seeded with `comic` only | Banked |

## 3. Category authority

- Lives in two unsynchronized fields: `collection_item.asset_category` and `gk_asset.asset_class`. (VERIFIED)
- Refresh is protected: with `ownedRefresh` the server pins the durable category (GK-253/254); auth failure fails closed. (VERIFIED)
- A re-identification conflict keeps the durable value and withholds pricing; no operator action exists to accept the change. (VERIFIED; "no explicit reclassification exists" is INFERRED.)
- Missing category defaults to `comic` at the DB column, the client hydrate (`App.jsx:11596`), `enrich.js:2587`, and `adapterRegistry.getAdapter`. (VERIFIED)
- The client can only write `comic` or `book` (`App.jsx:12229`). (VERIFIED)
- Generic can stay Generic permanently; nothing auto-converts it. (VERIFIED)

## 4. Category adapters

| Adapter | Identity | Condition | Valuation | Market evidence | Marketplace |
|---|---|---|---|---|---|
| COMIC | Yes (`ComicAdapter.js`); `identityComplete` is still inline in `enrich.js:13050` | CGC scale, mostly in `enrich.js` | Yes | Inline in `comps.js` | eBay 259104 |
| BOOK | title, author, year | `computeFormatRisk` only | Refused by GK-250 | `buildBookQuery` is live | eBay 267 category exists, not authorized |
| GENERIC | Operator photo + name only | None | None | None | Hard-refused (`list-ebay.js:741,827`) |
| OTHER (merchandise) | `inferAssetTypeFromCategories` | None | Refused | None | None |

There is no card or coin adapter (registry entries are commented out). (VERIFIED)

## 5. Universal enrichment contract

No adapter entry point exists today. The comic adapter exposes helpers; `enrich.js` (13,704 lines) calls them ad hoc. Refusal and provenance are inline in `enrich.js`, not returned by an adapter object. Reaching "physical asset → category adapter → normalized governed facts" is a large refactor, not configuration (INFERRED size). `ASSETCORE_INTERFACE.md` was only partly executed. (VERIFIED/INFERRED)

## 6. Generic asset capability

| Capability | State |
|---|---|
| Mint asset | ~~YES~~ → **rejected today (see addendum)** |
| Photos | PARTIAL — one photo only; the Generic detail view returns early before the operator panel, so no add-photo (INFERRED) |
| Title | YES (Collection only) |
| Description | PARTIAL — Collection `attributes` only, not on the asset |
| Category uncertainty | NO — operator hard-sets `generic` |
| Acquisition basis | YES if a cost is entered; `source` hardcoded `other` |
| Inventory state | NO — nothing wires it |
| Operator corrections | NO |
| Later valuation | NO — module not category-gated, nothing triggers it |
| Reclassification | NO |
| Listed anywhere | NO, by design |
| Outcome | NO |

## 7. Marketplace adapter architecture

**Second adapter without changing kernel authorities: PARTIAL.** Neutral already: asset schema, identity, price binding (`listingPriceBinding.js`), LIST-action linkage, outcome `channel`/`external_listing_id`. eBay adapter input: `gkAssetId`, `decisionEventId`, `operatorActionEventId`, governed Collection facts resolved server-side, a price bound to the recorded LIST amount. Output: a live listing plus a `LISTED` outcome event. It may not choose identity or price, list a SOLD / non-AVAILABLE / other-principal's asset, list Generic assets, or write SOLD (only the reconciler does). `list-ebay.js` mixes category content with eBay projection (ADR-ADAPTER-001 Ruling 43). Blockers: connection CHECK + `SUPPORTED_PROVIDERS = ['EBAY']`, hardcoded `channel:'ebay'`, an eBay-only reconciler, and a global unique index `outcome_event_listing_type_uidx` that omits channel (INFERRED collision risk). (VERIFIED unless noted)

## 8. Provider capability table

| Provider | Class |
|---|---|
| eBay | LIVE WRITE ADAPTER and READ INTEGRATION |
| Whatnot | PACKET / ASSISTED EXPORT, UI concept, buyer-history read data; no API client |
| Mercari, Facebook, Craigslist | PACKET / ASSISTED EXPORT |
| Shopify, Etsy, Amazon | ABSENT |
| Dealer, Auction, Consignment, Trade | Not traced to any integration |
| Whatnot and other channels in planning docs | BANKED |

Packets are client-side text generators and write no durable GrailKey record. (VERIFIED/INFERRED)

## 9. Multi-marketplace safety

**Putting one asset on several venues is unsafe today.**

| Capability | State |
|---|---|
| One inventory authority | Present (`inventory_current_state`) |
| Multiple listing projections | Partial — no listing table, only outcome rows |
| Reservation protection | Partial — atomic compare-and-swap exists; reservation is manual in V1 |
| Duplicate-channel prevention | Per-channel only; read-then-write with no unique constraint (INFERRED race) |
| SOLD closeout across listings | Block-only; no withdrawal action |
| Delisting propagation | **Absent** (see "DELISTED finding" below) |
| Split-brain detection | Partial — only GK-225's SOLD check |
| Marketplace-specific price | Absent |
| Marketplace-specific listing ID | Present |
| Listing-state history | Present |

Required before multi-venue: a cross-channel active-listing check or listing table with a unique key; a per-provider sale-signal contract; automatic reservation on order; a withdrawal job for other listings; a real `DELISTED` write; de-hardcoding eBay from preflight and reconciler; a cross-provider split-brain repair.

## 10. Marketplace connection neutrality

`marketplace_connection` has the right structure: one row per `(principal, provider)`, permanent provider-identity uniqueness, AES-256-GCM credentials with a key version, a CONNECTED / RECONNECT_REQUIRED / DISCONNECTED state machine, scope storage. eBay-specific: the `provider IN ('EBAY')` CHECK, `SUPPORTED_PROVIDERS`, `ebay-*` route names, `eiasToken` identity, the eBay deletion-webhook signature scheme. Shopify per-shop identity and Whatnot partner credentials would not fit one `provider_user_id` + `granted_scopes` without added fields (INFERRED). **GK-151 step 3 is satisfied (VERIFIED):** listing/delisting use the per-principal token with no global `EBAY_AUTH_TOKEN` fallback (the registry's "unbuilt" statement was stale; corrected 2026-10-04).

## 11. Disposition model

Only `LIST/HOLD/PASS` exist as durable actions. Absent: TRADE, CONSIGN, AUCTION, DEALER, DONATE, TRANSFER-as-intent. HOLD is recorded but its outcome-scoring design is unimplemented. No "current intended disposition" projection exists; an asset cannot hold one durable disposition independent of marketplace. (VERIFIED)

## 12. Marketplace packet normalization

No normalized shape exists. `marketplacePackets.js` returns `{title, description, price, photos, tags, …}` with no eBay branch, no currency/condition/category/aspects/shipping/returns/provenance, keyed off `item.id` not `gkAssetId`. The eBay path assembles facts ad hoc inside `list-ebay.js`; `toBuyerSafeListingFacts` and `buildGovernedListingTitle` are the closest thing to a fact contract. Currency, quantity, returns, and seller location are hardcoded. (VERIFIED)

## 13. Provider-neutral outcome support

**PARTIAL.** `channel` is free text and economics components are generic. Shopify/Whatnot sales can be recorded as `SOLD` but with no reconciler; a dealer cash sale works awkwardly as `SOLD` + an operator-entered component; trade needs a consideration-in-kind field; consignment needs a pending-payout state. Outcome types are listing-shaped; there is no direct-sale type. (VERIFIED/INFERRED)

## 14. Outside-user launch readiness

- **Outside user as pure asset manager: PARTIAL.**
- **Outside user connects their own eBay: PARTIAL, leaning NO today.**

Positives: signup is open and isolated server-side; Collection sync is real; eBay credentials are per-principal. (VERIFIED)

## 15. Blockers — "Take a picture of almost anything and manage it"

1. Photo → Generic has no automatic path (scan dead-ends at "No comic detected"); **and the manual Generic path is rejected by GK-266 (addendum).**
2. Silent comic defaults (DB columns, `createPhysicalAsset`, `getAdapter`, `App.jsx:12229`).
3. `'book'` cannot be minted as an asset class.
4. Production capture may be blocked for everyone: it needs `MILESTONE_TEN_H8_PASS=true`; value unreadable; bootstrap exhausted because 4 `gk_asset` rows exist (DOC). Operations decision, not code.
5. ~~Cross-user local data bleed on a shared device (VERIFIED)~~ — **CLOSED 2026-10-04, live exposure closure A (`5902ff7`).**
6. No Generic post-capture surface: no add-photo, corrections, or reclassify action (reclassify would also need `collection_item.asset_category` and `asset_class` updated together).
7. ~~Open signup with no spend gate~~ — **CLOSED 2026-10-04, live exposure closure B (`e8527a9`).** (Caveat: the guard has not been exercised by a real authenticated Production request; first live scan is the proof.)
8. Account deletion and export are manual; no Terms of Service.
9. Fixed 12-hour session with no refresh (recovery UX is fine).
10. Never exercised with a real second principal in Production (Development certification now exists: `tests/second-principal-capture-certification.test.js`).

## 16. Blockers — "Sell a supported asset through a connected marketplace"

1. eBay account-deletion endpoint config and portal registration unconfirmed (GK-269). (DOC)
2. **Seller location hardcoded to Phoenix AZ 85033 — classified OUTSIDE-USER EBAY LISTING BLOCKER: YES.** (VERIFIED; see finding below.)
3. Existing connections need reauthorization for `sell.inventory`. (DOC)
4. Consent-screen branding banked before any outside-user pilot. (DOC)
5. `EBAY_USER_REFRESH_TOKEN` / `EBAY_OAUTH_REFRESH_TOKEN` env-name mismatch banked. (DOC)
6. No two-principal live eBay certification. (DOC)
7. Listing needs Inventory Authority AVAILABLE, an operator LIST action, and linkage — only ever exercised for the operator. (DOC)
8. Delisting writes no `DELISTED` outcome (see finding). (VERIFIED)
9. Bundle listing disabled in Production and has no linkage. (DOC)
10. The first real Production Outcome #1 (NM98) is still not published. (DOC)

## 17. Ranked next marketplace adapters

1. **Shopify** — mature open Product/Inventory/order-webhook APIs, per-store OAuth; medium effort; needs the connection CHECK widened, store-level identity, a SOLD evidence rule. (KNOWLEDGE, uncertain)
2. **Whatnot** — probably limited by partner access, not code. (KNOWLEDGE, uncertain)
3. **Mercari and Facebook** — I believe neither has an open seller listing API; stay export-only until access is confirmed. (KNOWLEDGE, uncertain)

Do the kernel work first: cross-channel check, `DELISTED` write, widened provider CHECK, normalized listing shape.

## 18. Ranked next category adapters

1. **Generic hardening** (permanent deliberate category with corrections, add-photo, reclassify) — shortest route to the product promise.
2. **Book** — allow the `book` class at asset level and add an ISBN store; already half-built.
3. **Card or coin** — nothing exists; `capture_view` would need generalizing.

No adapter interface/entry point is defined in code today; a first definition has to come from the comic helpers (identity facts, a category, a refusal reason, provenance at minimum). (INFERRED)

## 19. Universal Launch board (as of the census; updated by closed items marked above)

**DONE:** auth and principal provisioning; server-side isolation; Collection persistence and sync; per-principal eBay credentials; Inventory Authority and the SOLD gate; durable category pin on refresh; **principal-scoped client storage (2026-10-04)**; **durable per-principal + global spend guard (2026-10-04)**.
**LAUNCH BLOCKER:** photo → Generic scan path (and the Generic ordering defect); silent comic defaults; `book` mint class; Production H8 / capture status; Generic post-capture surfaces; second-principal Production proof; account deletion/export and Terms.
**MARKETPLACE-EXPANSION BLOCKER:** provider CHECK; cross-channel duplicate prevention; `DELISTED` write; normalized packet; provider-neutral reconciler; `LIST/HOLD/PASS` disposition limit; seller location.
**CATEGORY-EXPANSION BLOCKER:** no adapter interface or entry point; `getAdapter` falls back to comic; `capture_view` enum; comic-shaped `buyer_decision_event` columns.
**POST-LAUNCH:** session refresh; auto-reservation; trade/consignment/dealer outcome types; consent-screen branding.
**BANKED:** `condition_observation` CGC CHECK; `catalog_entity` seeds; HOLD scoring; card and coin adapters.

## 20. What does not need rebuilding

The kernel event tables; the auth and session model; the collection store; the marketplace connection table, encryption, and per-principal token; the inventory CAS and the SOLD gate; outcome ledger `channel` and `external_listing_id`; idempotency and the GK-253/254 category pin.

## 21. What genuinely remains

Capture (Generic-from-scan path and its ordering defect, de-comic-ing the defaults, the book class, a deliberate reclassify action); safety for outside users (deletion/export, Terms, a real two-user Production run); kernel gaps (broader disposition vocabulary, cross-channel listing guard, real `DELISTED` write); and a real adapter boundary — the one large piece, since `enrich.js` is still comic-embedded.

---

## FINDINGS ADDED BY THE LIVE EXPOSURE CLOSURE DISPATCH (2026-10-04)

### DELISTED — verdict: PARTIAL / RECOVERABLE (VERIFIED-IN-CODE trace; not executed)

- `api/delist-ebay.js` resolves ownership from an existing durable `LISTED` row, calls `EndItem`, and on `Ack=Success` returns 200 **without writing any outcome event** (`api/delist-ebay.js:172-176`).
- The relist preflight (`src/lib/inventoryListingPreflight.js:101-110`) calls `hasActiveListingForChannel` → `listActiveListingsForChannel` (`src/modules/assets/repository.js:438-460`), which treats a listing as active while it has a `LISTED` row and **no** terminal row (`SOLD`/`DELISTED`/`EXPIRED_UNSOLD`).
- The only writer of `DELISTED`/`EXPIRED_UNSOLD` in the repo is the manual `scripts/observe-outcome1-listing.mjs` (GetItem-based). `ebayOutcomeReconciler.js` only *reads* terminal-unsold rows; it never writes one.
- Consequence: after an in-app delist (or a listing ended on eBay), a **new** LIST of the same asset on channel `ebay` is refused `DUPLICATE_ACTIVE_LISTING` until an operator runs the observe script. It is **recoverable** (that script writes the terminal row from real GetItem evidence) and **not permanent**, but nothing reopens eligibility automatically.
- Smallest patch (NOT implemented; HOLD for operator decision): in `api/delist-ebay.js`, after `Ack=Success`, append a `DELISTED` outcome via `recordOutcomeEvent` (same channel/`externalListingId`, deterministic idempotency key `delist-<ebayItemId>`), plus deterministic handler-smoke tests (success writes one terminal row; replay is idempotent; failure writes none; relist after delist passes the preflight). Not done here because it is an eBay-listing-lifecycle change on the Outcome #1 path and the dispatch forbade marketplace writes.

### Seller location — classification: OUTSIDE-USER EBAY LISTING BLOCKER: YES (VERIFIED)

- Hardcoded in both XML builders: `<Location>Phoenix, AZ</Location>`, `<PostalCode>85033</PostalCode>`, `<Country>US</Country>` (`api/list-ebay.js:206-208` bundle builder, `:418-420` single builder).
- **Item.Location / PostalCode:** every listing from every principal advertises Phoenix, AZ as the item's location.
- **Shipping service selection:** unaffected by the postal code — `ShippingType` is `Flat` with a service token and a flat cost, so shipping cost is not calculated from origin.
- **Calculated shipping:** not used today (Flat only), so the postal code does not drive a computed rate.
- **Buyer-visible location:** the listing page and search results show "Located in: Phoenix, AZ" — a factual misstatement for any seller elsewhere, and a likely eBay item-location policy problem for them.
- **Taxes/fees:** marketplace-facilitator tax is computed by eBay from the buyer address, not item location (KNOWLEDGE, uncertain); the item-location mismatch matters mainly for accuracy/policy, delivery estimates, and carrier-label origin.
- **Smallest valid future source of truth** (design only, not built): explicit operator listing input — a required, validated postal code (and city/state) supplied per principal, **failing closed** for any non-operator principal when absent, never defaulting to Phoenix. Authoritative marketplace-account metadata is not collected anywhere today (`marketplace_connection` holds provider identity, status, scopes, encrypted credential only), and no principal profile exists. Reading an address from eBay account metadata is possible in principle but unproven here (KNOWLEDGE, uncertain). Seller profiles were not redesigned.

### H8 — `MILESTONE_TEN_H8_PASS` code trace (VERIFIED-IN-CODE)

- Read at `api/capture-scan.js:119` (`h8Pass = process.env.MILESTONE_TEN_H8_PASS === 'true'`); the only runtime references in `api/` and `src/` are in that file.
- Gates: `POST /api/capture-scan` — every physical-asset mint (owned comic capture and Generic) — **only when** `GRAILKEY_CATALOG_ENVIRONMENT === 'production'` (`:118-120`).
- **TRUE:** the gate is skipped; the request proceeds to the rate limit, auth, and business logic for any authenticated principal.
- **FALSE/unset:** HTTP 403 `PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN` (`:122-129`) unless the bootstrap flag is set.
- **Bootstrap exception:** `MILESTONE_TEN_H8_BOOTSTRAP === 'true'` (`:121`) permits a capture only if `hasAnyPhysicalAsset()` is false (`:137`); any error determining that is treated as exhausted (fail closed, `:135-140`).
- **Exhaustion:** any `gk_asset` row existing (`:141-148`, 403 `PRODUCTION_CAPTURE_BOOTSTRAP_EXHAUSTED`). The registry records 4 `gk_asset` rows in Production (DOC, GK-266/2026-10-03), so the one-shot bootstrap is exhausted (DOC, not re-read).
- **Production value: NOT READ.** No Vercel CLI is installed, and the Vercel MCP environment listing would return every secret into the transcript (forbidden by Secret Hygiene); the registry records the flag as write-only (DOC, `docs/TICKET-REGISTRY.md` GK-279 section). To determine it, Jimmy inspects **Vercel Dashboard → comic-vault → Settings → Environment Variables → `MILESTONE_TEN_H8_PASS`, Production**, or observes the live response of "Capture as Owned Physical Asset" in Production: `403 PRODUCTION_CAPTURE_BLOCKED_H8_NOT_PROVEN` means DISABLED. The flag was not changed.

---

## UNIVERSAL U1 RESOLUTION (2026-10-05) — what changed against this map

U1 is the second step of the roadmap (LIVE EXPOSURE CLOSURE → **UNIVERSAL U1** → OUTSIDE-USER PRIVATE BETA; Outcome #1 in parallel). Evidence labels as above; the items below were proven by deterministic tests against real handlers and real Development Postgres (`tests/u1-*.test.js`), not by this document.

| Census finding | U1 state |
|---|---|
| "Photo → Generic does not yet exist" | **Built.** A scan the model cannot establish as a comic or book is stamped `assetType:'unsupported'` (never `comic`); the Scan tab offers an explicit **Save as Generic asset** using the already-captured photo. Nothing mints automatically; zero further paid calls. |
| "Silent Comic defaults remain" | **Closed in code; schema default removal is a separate, operator-gated step.** Every live writer now supplies an explicit supported category (`comic|book|generic`); `createPhysicalAsset`, `captureFromScan`, `createCollectionItem`, `pushCollectionItem`, `getAdapter`, `ensureAssetType`, enrich, the operator panel, hydrate and `addToCatalogue` no longer default. Migration `0039` (forward + rollback, Development-applied and certified) drops both `DEFAULT 'comic'`s and adds `NOT VALID` supported-category CHECKs; **it is NOT applied to Production** (HOLD for explicit approval). Historical rows are never rewritten. |
| "Book cannot mint as Book" | **Closed.** `book` is in the explicit allowlist; Book → capture → `asset_class='book'` and `asset_category='book'`, refresh keeps it Book, valuation stays REFUSED. A book-category row cannot be minted as a comic. |
| "Generic management is incomplete" | **Closed for U1 scope.** Durable `gkAssetId`, principal ownership, primary + additional photos (kernel media rows), editable optional name + notes, acquisition basis display, explicit Generic label, Inventory Authority state, Collection persistence, logout/relogin persistence, principal-local isolation. No grade, valuation, comps, listing, or reclassification. |
| "Generic capture is rejected by GK-266" (addendum above) | **Fixed without weakening GK-266 and without a Generic exception:** the authoritative Collection row is created FIRST, then the physical mint links to it (`/api/collection` → `/api/capture-scan` → `/api/collection`). |
| "Generic has no inventory state" | A newly captured Generic enters the **existing** neutral Inventory Authority `AVAILABLE` state (no Generic-only state exists). |
| Category continuity | Category is immutable once a Collection row exists (`409 ASSET_CATEGORY_IMMUTABLE`); a missing category is `400`, never comic; owned refresh pins the durable category. No deliberate reclassification feature. |
| "multi-marketplace safety is incomplete" / "normalized marketplace adapter contract does not exist" | **Unchanged — not U1.** Marketplace #2 and the marketplace kernel are later work. |

### Rulings banked (verified; neither blocks the U1 asset-management private beta)

- **DELISTED — PARTIAL / RECOVERABLE.** `api/delist-ebay.js` writes no `DELISTED` outcome; a same-asset relist on `ebay` is refused `DUPLICATE_ACTIVE_LISTING` until an operator runs `scripts/observe-outcome1-listing.mjs`. **Must close before outside-user marketplace listing.** (VERIFIED-IN-CODE, not executed.)
- **SELLER LOCATION — absolute blocker on outside-user eBay listing.** `Phoenix, AZ` / `85033` is hardcoded in both `api/list-ebay.js` XML builders. **Must close before outside-user marketplace listing.** (VERIFIED.)

### What U1 deliberately did NOT do

No marketplace #2; no full `enrich.js` adapter refactor; no universal valuation; no Generic marketplace listing; no New Mutants/GK-228 change; no billing; no MAX BUY; no Economic Router; no card/coin adapter; no Production migration; no H8 change.

---

## UNIVERSAL U1 PRODUCTION CLOSEOUT (2026-10-05)

Closeout of U1 against Production (full detail: `docs/TICKET-REGISTRY.md`, "UNIVERSAL U1 PRODUCTION CLOSEOUT"):

- **Standing law recorded:** PUSH AND DEPLOY ARE HELD BY DEFAULT (explicit PUSH AUTHORIZED / DEPLOY AUTHORIZED only). The U1 runtime reached Production before the intended final approval; it was backward-compatible and nothing was rewritten.
- **Production category census (read-only, before 0039):** `gk_asset` 4 rows (comic 2, generic 2), `collection_item` 178 rows (comic 177, book 1), no nulls, no value violating 0039's CHECK. Principals: 1 (operator). The two Production `generic` assets have dangling Collection links from the pre-GK-266 Generic ordering (historical, untouched).
- **0039 remains NOT applied to Production** (explicit authorization required). `VALIDATE CONSTRAINT` on its NOT VALID CHECKs is NOT planned and must not be run casually.
- **Stale-client contract:** one stable code `CATEGORY_REQUIRED_CLIENT_OUTDATED` (header `x-grailkey-client-contract`); the current client shows "Update the app and try again."; an already-stale bundle cannot understand it. The bundle now shows a visible `build <sha>` marker so a live test can be proven to come from the current bundle.
- **Still open for the asset-management private beta:** operator spend config confirmation, H8, live supported Comic capture + durable spend-counter certification, live Generic certification, 0039 disposition. Outside-user marketplace selling stays blocked (seller location, DELISTED recovery).
