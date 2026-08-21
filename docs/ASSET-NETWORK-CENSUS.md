# Asset Network Current-State Census

**Report-only artifact from the GrailKey Dispatch 2026-08-21 "Asset
Network Current-State Interrogation."** Nothing built, nothing pushed,
no Neon connection, no external calls, no new packages — a read-only
audit of the current repo against the expanded product strategy:

> GrailKey manages the physical asset itself. A single `gkAssetId` may
> eventually be held, valued, offered, listed, auctioned, shown live,
> sold locally, shipped, traded, consigned, transferred, or sold
> wholesale. eBay/OfferUp/Whatnot-style commerce becomes a set of modes
> projected from the same underlying asset — not separate copies of the
> item.

**Governing amendments this report follows:** (1) reuses
`docs/DATA-1-READINESS.md` (commit `4a42860`) rather than re-deriving
what it already answered — cited by section throughout, not re-quoted;
(2) thin sections (F/G/L/M) get one grep-line answers, not padded
paragraphs; (3) this report reorders nothing — the locked sequence
(Docker → DATA-0B-2 load → DATA-0D crosswalk → DATA-1 joint design →
0E/0F canonical IDs + shadow → operating layer → commerce layer) stands
unchanged; this is a map, not a queue change; (4) asset identity and
ownership are kept strictly separate throughout Section K — a
server-durable asset record's absence is reported as a build gap, never
as proof that physical-asset identity structurally requires
authentication.

---

## EXECUTIVE SYSTEM MAP

**API endpoints (14 files, `api/*.js`):**

| MODULE | RESPONSIBILITY | STATUS | COUPLINGS |
|---|---|---|---|
| `api/grade.js` | Claude Vision identification + grading | PRODUCTION | Anthropic, `imageSearchIdentity.js`, `pedigreeRegistry.js` |
| `api/enrich.js` | second-pass enrichment — CV/eBay/PC/decision/pricing | PRODUCTION | fans out to nearly every `src/lib/*` reconciler, kv-cache |
| `api/comps.js` | eBay comp fetch (Browse API) | PRODUCTION | called from `api/enrich.js` |
| `api/pricecharting-pop.js` | PC HTML extractors (pop/sales/ladder/velocity) | PRODUCTION | called from `api/enrich.js` |
| `api/mega-keys.js` | floor-price guard, 43-entry map | PRODUCTION | called from `api/enrich.js` |
| `api/kv-cache.js` | Upstash Redis wrapper, graceful-degradation | PRODUCTION | used by every endpoint above |
| `api/rate-limit.js` | in-memory sliding-window limiter | PRODUCTION, known non-durable (cross-instance gap, CLAUDE.md) | gates only `enrich.js`/`comps.js`/`grade.js` |
| `api/list-ebay.js` | **real** eBay listing creation, Trading API `AddFixedPriceItem` | PRODUCTION | see Section D — no access gate, no rate limit |
| `api/delist-ebay.js` | eBay listing removal, `EndItem` | PRODUCTION | no access gate, no rate limit |
| `api/cgc-lookup.js` | CGC cert verification | **DORMANT** — WAF 403s (CLAUDE.md) | |
| `api/gocollect.js` | GoCollect CGC FMV lookup | **DORMANT** — hardcoded `Promise.resolve(null)` | |
| `api/sold.js` | eBay sold-comp fetch | **DORMANT/legacy** — superseded by PC-sales route | |
| `api/chat.js` | Claude collection chat (AI query) | PRODUCTION | no access gate, no rate limit |
| `api/manage.js` | Claude collection analysis | PRODUCTION, read-only pass-through (no persistence write despite receiving the full catalogue) | no access gate, no rate limit |

**`src/lib/*.js` (45 files), grouped:** identity reconciliation
(`identityCore.js`, `identityReconciler.js`, `identityGate.js`, etc. —
the bulk of this project's engineering effort, actively evolving);
pricing (`pricingEngine.js`, `priceBands.js`); comp hygiene
(`compHygiene.js`, `soldVerification.js`); decision/contract
(`decisionEngine.js`, `responseContract.js`, `actionAuthority.js`);
creator/pedigree registries (`premiumCreators.js`, `pedigreeRegistry.js`);
client-only race-guards/merge logic (`scanOwnership.js`,
`manualCorrection.js`, `dataQualityGuard.js`); instrumentation, mostly
unconsumed (`scanLog.js` live, `evidenceContracts.js` explicitly
"nothing imports this yet" per its own header — designed, not wired);
marketplace text-gen (`marketplacePackets.js` — Mercari/FB/Craigslist/
Whatnot copy generator, zero API calls).

**Client:** `src/App.jsx` (~11,100 lines, single-file frontend) +
`src/db.js` (IndexedDB wrapper). **Auth/user system: ABSENT** (Section
K). **Async/background work:** one awaited KV write (scanlog, GK-144
open ticket on moving it post-response); client-side has
abort-controller race guards but no queue/worker system anywhere.

---

## SECTION A — see Executive System Map above (produced together)

## SECTION B — THE CURRENT "ASSET"

### B1. Full ID census

| IDENTIFIER | GENERATED | DURABLE? | SCOPE | SURVIVES DEVICE CHANGE | SURVIVES CORRECTION | SURVIVES LISTING |
|---|---|---|---|---|---|---|
| `scanId` | client, `crypto.randomUUID()` (`scanOwnership.js:29`) | **Ephemeral** — never persisted to IndexedDB or logged server-side (GK-80) | client-only, per-request | No | N/A | N/A |
| `pipelineTraceId` | server, `randomUUID()` (`api/enrich.js:2231`) | **Persisted** (`item.pipelineAudit.traceId`) but never rendered to the operator, zero UI read sites (GK-80) | server-generated, client-persisted | Yes (rides with the item) | Yes | Yes |
| `item.id` | client, `` cv_${Date.now()}_${rand} `` (`App.jsx:10838`) | **Persisted**, IndexedDB keyPath | client-only, no server mirror | **No — IndexedDB is device-local** | Yes — pinned by `buildCorrectedCatalogueItem` | Yes |
| `collectionItemId` (GK-145) | server, echoes `item.id` from request body | Persisted only inside 90d-TTL `scanlog:` records | mirrors `item.id` | No | carries whatever `item.id` was | N/A — audit-only, explicitly NOT `gkAssetId` |
| cache keys (`cv:`/`pc:`/`ac:`/`bc:`/`ph:`) | server, content hash of identity fields | Persisted, 1h-7d TTL | server-only | N/A | N/A | N/A |
| `scanlog:v1:<ts>:<id>` | server (`scanLog.js:41`) | Persisted, 90d TTL | server-only | N/A | N/A | N/A |
| `ebayItemId` | **external** — eBay's own return value | Persisted client-side onto `item.ebayItemId` | rides with `item.id`'s device-locality | rides with device | **UNKNOWN — not traced this pass**, likely dropped on correction (same class of gap as A5) | defines "survives listing" by definition |
| `bundleId` | client, `= ebayItemId` (reused, not independent) | same as `ebayItemId` | same | same | same | same |
| ownership objects (`scanOwnership`/etc.) | client, `{scanId, generation, kind, itemId}`, 7 call sites | **Ephemeral**, in-memory race-guards only | client-only, per-operation | No | No | No |

**Net finding, extending GK-80:** exactly ONE identifier is both durable
AND round-trips client↔server: `item.id` — and it is device-local.
`pipelineTraceId` is durable and server-authored but invisible to the
operator. **No identifier in this system today is a candidate for
`gkAssetId` as specified** (durable, physical-object identity); `item.id`
is the closest analogue but is explicitly browser-scoped.

### B2. Ownership fields

Beyond `purchasePrice` (DATA-1-READINESS A4): `item.status`
(`"listed"`/`"sold"`/default-unlisted, 15+ read sites) is the closest
inventory-status field. `item.soldPrice`/`soldAt`/`ebayUrl` are real,
set by the listing-sync path (Section D). **`quantity`: ABSENT.
`storageLocation`: ABSENT. `acquired_at`/`acquired_from`: ABSENT**
(`item.timestamp` is scan-time, not acquisition-time — a real
conflation risk if reused). owner/account: ABSENT (Section K).

### B3. Duplicate physical copies — proof

**Partial: WARN-and-allow-override on single scans, hard-BLOCK on bulk
import. Neither path is grade/variant-aware.** Single-scan
(`App.jsx:10972-10983`): a `title+issue+year` match sets a warning and
skips AUTO-save, but the "Tap Save to add another copy" banner calls
`addToCatalogue` directly and unconditionally on confirm — a genuine
second copy CAN be saved, with its own fresh `item.id`. Bulk import
(`:11592-11601`): identical match check, but on hit: `errors.push(...);
return;` — hard skip, no override path in that code block; a real
second copy encountered during bulk import is silently dropped.
**Critical gap in both:** the check is `title+issue+year` only — no
`variant`, no `grade`. Two genuinely different books (Cover A vs. Cover
B of the same issue) would false-positive as duplicates.

## SECTION C — MEDIA AS UNIVERSAL INTAKE

**C1 (beyond DATA-1-READINESS A3/C3):** `createHash('sha256')` exists
exactly once repo-wide (`cacheKeys.js:138`) — for cache-key text, NOT
image content. No image/perceptual hash anywhere. EXIF: ABSENT, zero
hits. `jimp` is used purely for pre-Vision resize; no dimension/metadata
field is captured or persisted downstream.

**C2 (video) — ABSENT as a capability, real adjacent scaffolding
exists.** Zero hits for `MediaRecorder`/streaming/WebRTC/HLS/RTMP. Two
`getUserMedia({video})` sites (barcode scanner live preview; Watch
Mode's 3s-interval still-frame capture) — both grab still frames via
`canvas.toBlob`, never record. The camera-stream permission/lifecycle
handling is real, reusable scaffolding; recording/storage/streaming is
all missing.

**C3 (evidence-model classification):** UI attachment — yes (`images[]`,
no independent identity). Temporary AI input — yes (base64 → Vision,
discarded server-side). Condition evidence — yes, informally (Vision's
`reason` describes condition FROM the photo, but no per-photo
annotation links a claim to a specific image). Identity evidence — yes,
transiently (the frozen rank-1 pool-row TEXT is consulted by the
reconciler; the operator's own PHOTO itself is never a corroboration
source the reconciler reads). **Durable asset evidence — No.** Nothing
treats a stored photo as queryable, hashed, or independently
timestamped — an inert blob riding in the same flat row as everything
else.

## SECTION D — SELLING/LISTING (deep trace, priority section)

### D1. Complete eBay listing path — explicit verdict: **(a) real, live listing**

UI trigger: `handleList` (`App.jsx:3861`, "List on eBay" button) and
`runPostAll` (`:8618`, "Post All HOT" batch, sequential single-item
calls with 1500ms spacing — not a real batch API). Title:
`buildTitle` (`api/list-ebay.js:79-103`, server-side, prefers
`claudeCheck.suggestedListingTitle` on HIGH confidence, else assembles
and caps at 80 chars). Description: `buildDescription` (`:252-356`,
built from the request payload — flags disclosure, grade, ComicVine
story/creators, price-band/pop/demand sections, fixed shipping
boilerplate). Photos: 1 (single-item) or up to 12, uploaded via
`uploadSiteHostedPicture` (`:384-448`) — a **real** `UploadSiteHostedPictures`
Trading API call (GK-84's decommission target, 2026-09-30). Price: real,
from `item.price`, hard-fails if absent. Condition: coarse binary
(`2750` Graded / `4000` Very Good — not a real condition mapping).
Category: `259104` hardcoded (comics), `267`/`180` for TPB/magazine.
Quantity: hardcoded `1`. Shipping: hardcoded USPS Media Mail, flat
$4.99 (free ≥$50). Item Specifics: real, server-constructed (Publisher,
Series, Issue, Era, Grade, Format, Language="English", Character,
Variant). Best Offer: real, always enabled (auto-accept 95%, min 75%).
Seller location: hardcoded "Phoenix, AZ" (no user-profile field exists
to derive it from). **OAuth:** the legacy eBay Trading API "Auth'n'Auth"
scheme — a static, long-lived `EBAY_AUTH_TOKEN` seller token, entirely
**different** from `api/comps.js`'s Browse-API client-credentials OAuth;
the two eBay integrations authenticate completely differently and are
not interchangeable. **Endpoint:** `POST api.ebay.com/ws/api.dll`, real
production (no sandbox flag anywhere in this file). Three real calls:
`AddFixedPriceItem` (create), `GetItem` (status), `EndItem` (delist).
`&lt;ListingDuration&gt;GTC&lt;/ListingDuration&gt;` confirms an actual
live-listing creation call — **no draft, no preview, no dry-run
parameter anywhere.** A successful call returns a real `ItemID`; the
listing is live on ebay.com at that moment. **Listing persistence:**
client-only — `api/list-ebay.js` itself writes nothing durable
server-side; the ONLY record is the client's flat IndexedDB fields
(`status:"listed"`, `ebayUrl`, `ebayItemId`, `listedAt`).

### D2. Listing as projection

The listing payload is built directly from the **live in-memory
Collection item at click-time** — a one-time field-by-field snapshot
copy, zero ongoing link back to the asset afterward. If identity or
price changes post-listing, the live eBay listing does not update and
nothing re-syncs it (the only post-listing sync, `syncEbayStatus`, pulls
state FROM eBay, never pushes local changes TO it). **What blocks
`ASSET → LISTING PROJECTION` today:** no notion anywhere that "this
value traces back to asset record X, facet Y" — because the catalogue
record itself has never been split into the five record classes
(DATA-1-READINESS D1 / DATA-0-ARCHITECTURE §10). Specific destructive-copy
points: `listOnEbay`'s request-body literal (one-time copy, no
back-reference) and the post-success IndexedDB write (flattens the
listing OUTCOME onto the asset record itself, rather than into a
separate listing entity the asset could have many of).

### D3. Listing history — **confirmed absent, overwrite-only**

No listing-event history exists anywhere, client or server — same
overwrite-only shape DATA-1-READINESS A5 found for corrections. A
second listing attempt would silently overwrite `ebayItemId`/`ebayUrl`/
`listedAt` with no trace of the first. **Delist is not a standalone UI
action** — it exists only as a side-effect inside `deleteFromCatalogue`:
choosing "Remove from eBay + Collection" calls `EndItem`
(`EndingReason: NotAvailable`, fixed, not user-selectable) and then
**unconditionally deletes the item from IndexedDB regardless of whether
the eBay call succeeded.** There is no "delisted but still in my
collection" state. `syncEbayStatus` is the only other post-listing
update (sold/ended/active from `GetItem`) — manually triggered, no
polling/webhook, overwrites not appends.

**Bonus finding (D3):** `marketplacePackets.js`'s `generatePacket`
(Mercari/FB/Craigslist/Whatnot copy generator) — **verdict (d), data-only,
zero API calls** — already carries an informal `assetIds: [item.id]`
field, a pre-DATA-1 use of exactly the "asset" framing this dispatch is
standardizing. Flagged for Section R/S.

## SECTION E — EBAY-LIKE COMMERCE PRIMITIVES

| Capability | Status |
|---|---|
| Fixed-price listing | EXISTS |
| Auction / reserve / BIN | ABSENT |
| Offers/counteroffers | ABSENT (real) / ADJACENT-REUSABLE (Trade Pile's text-only value summary) |
| Watchers/saved searches | ABSENT |
| Storefront/seller inventory | ADJACENT-REUSABLE (Collection tab IS a private single-user inventory view) |
| Bulk listing | PARTIAL — sequential single-item calls, not a batch API |
| Drafts/revisions | ABSENT — posts live immediately |
| Promotions | ABSENT |
| Search (internal) | PARTIAL — see J |
| Category browsing | ABSENT internal / EXISTS external comp-search only |
| Filters/sorting | EXISTS — client-side array filter/sort |
| Order state | PARTIAL — manually-triggered `GetItem` poll |
| Payment/shipping-tracking state | ABSENT |
| Returns/refunds | ABSENT (GrailKey-side) — static policy value only, set outbound |
| Analytics | PARTIAL — single-user, display-only |
| Reputation | PARTIAL — eBay's own feedback score, borrowed not owned |

## SECTION F — LOCAL COMMERCE (thin)

Location/distance/nearby/maps/pickup/meetup/availability: **ABSENT**,
zero hits. Buyer/seller chat: **ABSENT** (only AI chat exists).
Profile/reputation/blocking/privacy/ownership-transfer: **ABSENT**. One
real artifact: **Trade Pile** (`App.jsx:9080-9141`) — client-only text
summary + `navigator.share`, no server, no counterparty state.

## SECTION G — LIVE COMMERCE (thin, G1/G2 substantive)

Livestream/WebRTC/RTMP/HLS/realtime-DB/bidding/show-inventory/order-
creation: **ABSENT**, zero hits, no realtime dependency in `package.json`.

**G1:** Nothing is a "show" primitive as-is, but two real analogues
exist: Watch Mode's rear-camera self-correcting loop (camera → identify
→ dedup → enrich, `setInterval` every 3s) is structurally adjacent to
"next item up" sequencing but drives Vision/enrich, not a bid/auction
state machine, no multi-party concept. `BidCalculator` + buyer
session/budget compute a SINGLE local user's own buy/pass math — "bid"
means "what should I personally offer," not "who wins this auction."
Neither is a show primitive; both are the closest things that exist.

**G2:** No realtime infrastructure anywhere — confirmed via
`package.json` (no websocket/pubsub dependency) and zero
`WebSocket`/`EventSource`/`socket.io` hits. Only client-side local
polling exists (Watch Mode's 3s interval) — not a channel/broadcast
mechanism.

## SECTION H — EVENT/CONVENTION MODE

No `event`/`convention`/`lot` inventory primitive exists. Real
adjacent-reusable structures: **Bundle listing** (multi-select → single
eBay listing, shared `bundleId`/`ebayItemId` — already live); **Trade
Pile** (named grouping + aggregate value + wants[] + notes, export-only);
**Buyer sessions** (`cv_buyer_sessions`, capped 100 — a real live-buying
session primitive, scoped to solo acquisition, not multi-seller events).
Quantity/cart/checkout/bulk-selling-selection beyond Post All HOT:
**ABSENT**.

## SECTION I — BUYING/ACQUISITION

`purchasePrice`: exists, persisted (DATA-1-READINESS A4). Acquisition
date/seller-source/lot: **ABSENT**. Buyer-mode net profit (`marketValue
- whatnotFeeAmt - supplies - labor - bid`, `BUY`/`PASS` from
`netProfit >= minProfit`): real, computed live, **NOT persisted** beyond
the 100-entry session log. CGC-submission ROI scenarios: real, computed
live, **NOT persisted**. **Net: every acquisition-economics number in
this app is display-only, recomputed on each render — none of it is a
persisted decision record.**

## SECTION J — SEARCH/DISCOVERY (three-way distinction)

(1) External comp search (`api/comps.js`) — pricing-only, not reusable
for internal search, out of scope here. (2) **Internal Collection
search** — `FloatingSearchBar`'s local filter is a plain
`Array.prototype.filter` over the in-memory catalogue, string-matched
against a concatenated field string plus a few hardcoded special tokens
(`$N+`, `key`, `listed`/`sold`) — no index, no query parser, no
pagination. (3) **Future many-user marketplace search — confirmed
ABSENT, and the existing local filter is NOT a structural foundation
for it** — a client-side array scan over one browser's own data, no
server index, no cross-user scope; would need to be built from zero.
Watchlists/favorites/recommendations/recently-viewed: **ABSENT**.

## SECTION K — USERS/IDENTITY/OWNERSHIP (Amendment 4)

**K1.** The only auth mechanism, `checkAccessGate`, is **one shared
secret** (`ACCESS_CODE`/`vault_key`) compared as a boolean — it does not
identify individual users, has no concept of "who." **K1a — real gap:**
only 3 of 14 endpoints (`enrich.js`, `comps.js`, `grade.js`) call it at
all. **`api/list-ebay.js` and `api/delist-ebay.js` — the two endpoints
that create/cancel a REAL eBay listing — have zero access-gate check.**
Same for `chat.js`/`manage.js`. Rate limiting has the identical 3-of-14
gap.

**K2.** Account/user/session concept: **ABSENT**, confirmed by
exhaustive grep — every apparent hit is a false positive (dev-phase
"Session 4A" labels, Claude message `role`, Watch Mode's scan-count
cap). Zero auth-related dependency in `package.json` (no next-auth,
Clerk, Firebase Auth, Supabase, JWT, bcrypt).

**K3. Proof — if Jimmy logs into GrailKey on another computer today,
does his collection appear? NO.** Two compounding facts: (1) there is
no login concept at all — `vault_key` is a shared invite code, not a
per-person credential; (2) even if there were, nothing syncs IndexedDB
anywhere — `api/manage.js` receives the full catalogue but only for
read-only Claude analysis, confirmed zero persistence write. A second
computer starts with an empty Collection, unconditionally.

**K4. The five Amendment-4 lines:**
```
Can a server-durable asset exist?            NO — no server-side asset persistence exists (KV only caches lookups). NOT evidence identity requires auth — DATA-0's catalog_entity design already models identity with zero ownership coupling.
Can a principal be identified server-side?   NO — checkAccessGate validates a shared secret, not a principal.
Can ownership be assigned durably?           NO — no ownership/possession field exists server-side anywhere.
Can mutations be authorized by ownership?    NO — no code path checks "does requester own this asset" before any write.
Can ownership transfer be represented?       NO — no transfer/transaction record exists at all.
```

**K5. Minimum missing primitives (named, not designed):** (a) principal
identification — distinguishing requester X from Y, doesn't exist in
any form; (b) authorization checking — per-request "is this principal
allowed to act on this asset," cannot be built before (a); (c) an
ownership-assignment relationship (durable principal↔asset link) — the
storage model doesn't exist because neither side (a) or a durable asset
record exists yet to link.

## SECTION L — TRANSACTION/MONEY (thin)

Confirmed via repo-wide grep: **zero real hits** for stripe/paypal/
checkout/invoice/subscription (the one match, "subscription box," is a
comic-market REPRINT_RE term, unrelated). Both distinct concepts are
equally ABSENT: (1) GrailKey's own SaaS billing — no monetization layer
of any kind. (2) Buyer→seller marketplace payment processing — no
payment intent, checkout, escrow, fee, refund, tax, shipping-label, or
order/invoice concept anywhere.

## SECTION M — NOTIFICATIONS (thin)

Email/push/SMS/in-app/messaging/notification-store: **ABSENT**, no
dependency in `package.json`. Scheduled jobs/cron: **ABSENT** — no
`crons` block in `vercel.json`. Webhooks (receiving): **ABSENT** — every
endpoint is direct client-request/response shaped.

## SECTION N — ASSET STATE MACHINE (inventory only)

`decision.action` (ID_REQUIRED/DO_NOT_LIST/RESEARCH/GRADE_CANDIDATE/
LIST_LOW/LIST_NOW — decision state, advisory). `contract.state`
(PRICED/ESTIMATED/REFUSED/ID_REQUIRED/LOCKED/INCOMPLETE — a SEPARATE
machine from `decision.action`, per Q110). `item.status`
(undefined/"listed"/"sold" — marketplace state). `titleAuthority`/
`yearAuthority`/`variantApplicability`/`issueAuthority.status` (NONE/
CONTESTED/CORROBORATED — identity state). `isGraded` (identity/printing
fact). `listingHardLocked`/`megaKeyIdentityUnresolved`/`gradeExceedsMap`/
`manualReviewRequired` (degenerate 2-value gating booleans, not a
richer machine). Pre-listing checklist rows (`status: 'pass'/'caution'/
'fail'`, `identityConfirmed.state: 'UNRESOLVED'` — collection/UI-readiness
state, entirely separate machine).

**Double-duty flags found (the valuable part of this section):**
1. **`status` means three unrelated things** depending on which object
   it's read off — a catalogue item's marketplace lifecycle vs. a
   checklist row's pass/fail/caution vs. (implicitly) whatever future
   meaning gets added — same field name, three vocabularies, same file.
2. **`"ID_REQUIRED"` is a valid value in TWO independent state machines**
   (`decision.action` and `contract.state`) — a log line reading
   `"ID_REQUIRED"` cannot say which machine produced it without also
   checking the field name.
3. **`identityConfirmed` carries both `status` and `state` on the same
   object** — two differently-named keys on one checklist row, only
   `state` ever populated with a real value; every sibling row lacks
   `state` entirely.
4. **`isMegaKey`/`megaKeyFloorApplied`/`megaKeyIdentityUnresolved`** —
   three separate booleans describing what is really one underlying
   4-value state (per CLAUDE.md's own VERIFIED/ESTIMATED/MANUAL
   REVIEW/GRADE EXCEEDS MAP badge), spread across two files rather than
   one enumerated value.

## SECTION O — DOMAIN COUPLING (extends GK-147)

GK-147 already found 4 comic-specific leaks in `decisionEngine.js`/
`pricingEngine.js` (cited, not repeated). **New this pass:**
`identityCore.js`'s header explicitly claims extraction "to reduce code
duplication across future asset formats (books, cards, collectibles)" —
but its actual content (title/issue/variant/publisher resolution,
mega-key-adjacent gating) is comic-printing-specific throughout, and no
book/card call site exists anywhere to test the claim against. This is
a FIFTH instance of GK-147's class, in a file that makes the SAME kind
of unverified universality claim `pricingEngine.js` does.
`identityReconciler.js` is genuinely partially generic — its header
scopes the universality claim narrowly (`isEligibleVisualRow`/
`selectFirstEligibleVisual` only), and the underlying evidence/authority
machinery (NONE/CONTESTED/CORROBORATED) is legitimately facet-name-agnostic
— this is DATA-0-ARCHITECTURE §2's own stated basis for treating the
reconciler pattern as the generic layer, and it holds up.
`responseContract.js` and `scanLog.js`'s outer envelope are genuinely
asset-class-neutral. `mega-keys.js`/`pedigreeRegistry.js`/
`premiumCreators.js` are irreducibly comic-specific, correctly so — no
adapter extraction is warranted.

## SECTION P — SECURITY/TRUST BOUNDARIES

Same 3-of-14 gap as K1a governs both authentication and rate limiting.
Secrets: no leaks found (env-var only, never logged in full). Upload
validation: real but narrow (`Jimp.read` throws on non-image, no
explicit MIME allowlist, bounded only by Vercel's 100MB platform limit).
No `dangerouslySetInnerHTML` anywhere (React's default escaping applies).

**Direct answer — what becomes unsafe if two unrelated users buy/sell
through the same backend tomorrow?** Everything, because there is no
per-request identity to even ask "whose is this" about. Concretely: (a)
User A's requests to list-ebay/delist-ebay/chat/manage are
indistinguishable from User B's — full access to whatever the backend
can do, including creating/canceling REAL eBay listings on the ONE set
of credentials configured for this deployment (there is no per-user
eBay-account concept — "list on eBay" today always means "list on
Jimmy's eBay account," a fact any multi-user design must confront
directly, not layer on top of as-is). (b) On the 3 gated endpoints, both
users share the SAME `ACCESS_CODE` — the gate cannot distinguish them
even where it exists. (c) There is no server-side Collection at all, so
"whose data is this" is answered entirely client-side by which
browser/device is asking — trivially spoofable, not an enforced boundary.

---

## SECTION Q — CAPABILITY KILL MATRIX

| CAPABILITY | EXISTS | PARTIAL | ABSENT | REUSABLE FOUNDATION |
|---|:-:|:-:|:-:|---|
| Asset identity | | ✓ | | `item.id` generation + correction-preservation pattern (pinned across identity edits) |
| Asset ownership | | | ✓ | — |
| Asset history | | | ✓ | — (overwrite-only everywhere checked) |
| Photos | | ✓ | | camera capture/permission scaffolding, photo-attach UI |
| Video | | | ✓ | camera-stream permission/lifecycle handling (2 getUserMedia sites) |
| Condition history | | | ✓ | — |
| Valuation history | | | ✓ | GK-146's outcome-snapshot field selection is a real starting schema draft |
| Decision history | | | ✓ | — |
| Acquisition ledger | | ✓ | | `purchasePrice` field + Buyer-mode net-profit math (correct, just not persisted) |
| Inventory location | | | ✓ | — |
| Fixed-price listing | ✓ | | | full eBay Trading API integration, real and live |
| Auctions | | | ✓ | — (eBay-side concept, GrailKey never builds one) |
| Offers | | ✓ | | eBay Best Offer config (server-side) + Trade Pile's text-only summary |
| Chat | | ✓ | | AI collection chat exists; zero P2P messaging |
| Local discovery | | | ✓ | — |
| Live selling | | | ✓ | Watch Mode's camera loop + BidCalculator (adjacent, not equivalent) |
| Event mode | | ✓ | | Bundle listing + Trade Pile groupings |
| Storefronts | | ✓ | | Collection tab is a private single-user storefront-shaped UI |
| Search/discovery | | ✓ | | local array filter (own-collection only, no server index) |
| Watchlists | | | ✓ | — |
| Want-to-buy | | ✓ | | Trade Pile's `wants[]` list (informal, text-only) |
| Trades | | ✓ | | Trade Pile again |
| Consignment | | | ✓ | — |
| Wholesale | | | ✓ | Bundle listing adjacent (not wholesale-specific) |
| Orders | | | ✓ | flat status/soldPrice fields, overwrite-only |
| Payments | | | ✓ | — |
| Payouts | | | ✓ | — |
| Shipping | | ✓ | | static policy sent outbound to eBay only |
| Returns | | ✓ | | static policy value only |
| Reputation | | ✓ | | eBay's own feedback pulled + stored (borrowed, not owned) |
| Notifications | | | ✓ | — |
| Analytics | | ✓ | | `collectionMetrics.js`, single-user, display-only |
| Transaction ledger | | | ✓ | — |
| Outcome ledger | | | ✓ | scanLog's shape is a plausible starting envelope, not a ledger (90d TTL) |

---

## SECTION R — KEEP / WRAP-ADAPT / MIGRATE / REPLACE / BUILD NEW

**KEEP AS-IS.** The identity/pricing/decision reconciliation engine
(`identityCore.js`, `identityReconciler.js`, `decisionEngine.js`,
`responseContract.js`, `actionAuthority.js`) — this IS the hard-won
value; DATA-1 sits alongside it, never replaces it. The eBay Trading
API-calling code itself (OAuth, XML building, `AddFixedPriceItem`/
`EndItem`/`GetItem`) as the first real channel implementation. The
comp-hygiene/pricing pipeline. Camera capture/permission scaffolding.
The KV cache layer, for exactly what DATA-1-READINESS's own C1 verdict
already scoped it to (lookups/scanlog, never ledger data).

**WRAP-ADAPT.** `listOnEbay`'s payload construction — wrap to read from
a future asset record via a defined interface, without touching the
actual eBay-calling code (the destructive-copy points are narrow and
named in D2). `marketplacePackets.js` — already has an informal
`assetIds` concept; wrap it onto the real `gkAssetId` rather than
rebuilding text-gen for 4 channels. Bundle listing / Trade Pile — wrap
as the first "multiple assets → one sellable unit" primitives.
Buyer-mode/CGC-submission calculators — wrap into a real
acquisition-ledger valuation-event system; the math is already right,
per Section I, it's just not persisted.

**MIGRATE.** The correction-preservation PATTERN (pin id across
identity edits) — migrate onto a real `gkAssetId`, not `item.id` itself
(GK-145's own explicit non-claim). GK-146's outcome-snapshot field
selection — migrate the SHAPE into a real valuation-event table, not
the KV storage layer underneath it. The five-way record-class split
already drafted (DATA-1-READINESS D1 / DATA-0-ARCHITECTURE §10) plus
this report's Section N double-duty findings — migrate directly into
the actual column design so ambiguous fields aren't re-copied with
their ambiguity intact.

**REPLACE.** The flat `item.status`/`ebayItemId`/`soldPrice`/`soldAt`
overwrite-only fields — replace with an append-only listing/transaction-
event table; do not carry the overwrite behavior forward. The
duplicate-detection heuristic (title+issue+year only, variant-blind,
inconsistent warn-vs-block between the two save paths) — replace with a
real `gkAssetId`-aware duplicate/merge flow once physical-copy identity
exists. `checkAccessGate`'s shared-secret model, WHEN multi-user work
begins — extending it instead of replacing it with real per-principal
auth would itself be the exact "temporary plumbing promoted to
permanent architecture" risk this report was asked to watch for.

**BUILD NEW.** Principal identification + authorization +
ownership-assignment (K5's three primitives) — nothing to adapt from.
Durable server-side asset record (Neon, DATA-1). Append-only
valuation/condition/decision event tables (scanLog is an audit trail
with a 90-day TTL, not a permanent ledger). Photo object storage
(confirmed zero infrastructure). `ASSET → LISTING PROJECTION` — the
mechanism to derive a listing FROM an asset record rather than copy
fields once. Cross-device/account sync for the Collection.

**Temporary-plumbing-risk register** (the dispatch's own named example
plus what this pass found):
1. `collectionItemId` (GK-145) — the dispatch's own example; already
   self-documented as temporary (JSDoc + code comment explicitly say
   "not `gkAssetId`"), lowest actual risk of the five because it's
   already flagged.
2. `item.id` — convenient, used everywhere, but device-local and never
   designed as a durable cross-system identity. Real risk: reused as a
   foreign key into a future Neon table without addressing its
   browser-locality first.
3. `ebayItemId`/`bundleId` — eBay's own ID reused directly AS
   GrailKey's own bundle-grouping key (`bundleId = ebayItemId`). Risk:
   coupling GrailKey's grouping concept to one external marketplace's ID
   scheme — a Whatnot or local-sale bundle has no eBay ID to reuse.
4. `pipelineTraceId` — durable, but designed for identity-debugging
   trace correlation, not as a customer-facing audit ID; risk of
   silently becoming "the" audit identifier without ever being
   validated for that purpose (it's invisible to the operator today,
   per GK-80).
5. `marketplacePackets.js`'s informal `assetIds: [item.id]` array —
   already reusing `item.id` as if it were a stable cross-channel asset
   reference, in a SECOND place beyond the obvious one.

---

## SECTION S — FIVE LOAD-BEARING ARCHITECTURAL FACTS

**S1 — Biggest existing head start.** The identity/evidence
reconciliation engine — evidence-based, authority-tracked (NONE/
CONTESTED/CORROBORATED), regression-tested (200+ tests) resolution
logic that would take most teams building a comic-pricing system from
scratch a very long time to reach. DATA-1 doesn't need to build "how do
we know what a book is" — it needs to build "how do we durably remember
what we already know."

**S2 — Single biggest missing prerequisite.** A server-durable,
principal-independent asset record. Nothing — identity, price,
condition, photos — persists anywhere the operator doesn't personally
control (their own browser). Every other gap (ownership, history,
cross-device, multi-user) is downstream of this one absence, and this
report confirms there is no partial version of it anywhere to build
from.

**S3 — Most dangerous decision under multi-user commerce.** The single
shared `ACCESS_CODE` / one-set-of-eBay-credentials-per-deployment model.
Today "list on eBay" always means "list on Jimmy's eBay account" — no
per-user marketplace-credential concept exists, and the access gate
doesn't even reach 11 of 14 endpoints. This is not a bug to patch; it's
a structural assumption (one operator, one set of external accounts)
baked into every write path in the app today.

**S4 — Looks reusable, must NOT become permanent.** `collectionItemId`
is the dispatch's own named example and the LOWEST actual risk, since
it's already self-documented as temporary. The genuinely dangerous ones
are the four NOT self-documented as temporary: `item.id` as a future
foreign key, `ebayItemId`/`bundleId` as a de-facto external-ID-coupled
grouping key, `pipelineTraceId` as a would-be audit ID it was never
validated for, and `marketplacePackets.js`'s informal `assetIds` array
already reusing `item.id` a second time.

**S5 — Five facts needed before writing any Asset Network schema beyond
DATA-1:** (1) the exact five-way record-class split already drafted
(DATA-0-ARCHITECTURE §10) plus this report's Section N double-duty
findings, so ambiguous status/state fields aren't re-copied with their
ambiguity intact; (2) DATA-0B-2's real GCD/Metron catalog counts (still
blocked on Docker) — the catalog-identity side of any asset FK needs
real cardinality to design against; (3) the D2 finding that NO current
code treats a listing as a projection — decide up front whether v1
supports true multi-channel projection or ships single-channel
(eBay-shaped) and migrates later; (4) K5's three named missing
primitives — at minimum their storage SHAPE (not their auth mechanism)
needs deciding before an asset table's ownership FK can be typed; (5)
real accumulated GK-145/GK-146 telemetry — this report is a snapshot of
code CAPABILITY, not of actual USAGE, and both matter for schema
sizing.

---

## TOP 10 EXISTING ASSETS WE SHOULD LEVERAGE

1. The identity/evidence reconciliation engine (S1) — the single
   largest asset in the whole codebase.
2. The eBay Trading API integration itself — real, live, production
   code for one full channel, reusable as the first `LISTING PROJECTION`
   implementation once the asset/listing split exists.
3. `item.id`'s correction-preservation pattern (pin across identity
   edits) — the right PATTERN to carry into `gkAssetId`, even though the
   ID itself shouldn't be reused directly.
4. Bundle listing (multi-item → one sellable unit, already live) — the
   first real "group of assets" primitive.
5. Comp-hygiene/pricing/sold-verification pipeline — irreplaceable
   market-data logic, asset-class-neutral in structure per Section O.
6. Camera capture/permission scaffolding (Watch Mode + barcode
   scanner) — reusable regardless of what asset model sits behind it.
7. `marketplacePackets.js`'s multi-channel text-gen (Mercari/FB/
   Craigslist/Whatnot) — already channel-aware, already carries an
   informal asset-ID concept.
8. GK-146's outcome-snapshot field selection — a real, already-chosen
   starting schema draft for a valuation event.
9. Buyer-mode net-profit / CGC-submission-ROI math — correct
   calculations, just needs a place to persist.
10. The KV cache layer's graceful-degradation contract — a proven
    pattern for "never let telemetry/caching block the real response,"
    worth reusing for any new background writes.

## TOP 10 GAPS WE MUST BUILD

1. A server-durable, principal-independent asset record (S2).
2. Principal identification (K5a).
3. Authorization checking (K5b).
4. Ownership-assignment relationship (K5c).
5. Append-only valuation/condition/decision event tables (not
   overwrite-only, not a 90-day-TTL cache).
6. Photo object storage (confirmed zero infrastructure).
7. `ASSET → LISTING PROJECTION` — deriving a listing from an asset,
   not copying fields once.
8. An append-only listing/transaction-event history (D3's confirmed
   gap — today's delist even DELETES the local record on success).
9. A real, grade/variant-aware duplicate/merge flow for physical
   copies (B3's confirmed gap).
10. Cross-device/account sync for the Collection (K3's proof — this
    literally cannot happen today, by construction).

## TOP 10 THINGS WE MUST NOT ACCIDENTALLY COUPLE

1. `gkAssetId` to authentication or owner identity (Amendment 4 — the
   governing rule of this whole report).
2. `item.id` treated as if it were already `gkAssetId` (S4).
3. `ebayItemId` treated as GrailKey's own bundle/group identity
   (`bundleId = ebayItemId` today — a real, already-shipped instance of
   this exact risk).
4. `pipelineTraceId` treated as a validated customer-facing audit ID
   (it was built for a different purpose and has never been checked
   against this one).
5. The single shared `ACCESS_CODE` extended/hardened instead of
   replaced when multi-user work begins (S3) — hardening it would be
   solving the wrong problem.
6. Listing-channel logic (eBay's XML/OAuth specifics) coupled directly
   into asset-record logic, instead of behind a projection interface
   (D2's exact finding).
7. `scanLog`'s 90-day-TTL, best-effort-cache KV storage treated as
   adequate for ledger/history data (DATA-1-READINESS C1's verdict,
   reaffirmed here).
8. Comic-specific field names/logic inside modules that claim
   cross-asset generality without the claim being tested against a
   second asset type (Section O — now 5 confirmed instances, GK-147 +
   `identityCore.js`).
9. The `title+issue+year`-only duplicate check treated as sufficient
   once variants/grades matter for physical-copy identity (B3).
10. Any future real-time/live-selling feature accidentally built on
    top of Watch Mode's local polling loop as if it were genuine
    realtime infrastructure — it isn't (G2), and treating it as a
    foundation would misjudge how much new work a live-show feature
    actually requires.

---

## HANDOFF

**The locked sequence is unchanged by this report:** Docker → DATA-0B-2
load → DATA-0D crosswalk → DATA-1 joint design (`gkAssetId` + event
ledger + photo architecture) → 0E/0F canonical IDs + shadow → operating
layer → commerce layer. This interrogation is an input to the
master-architecture session that happens AFTER DATA-0B-2 and DATA-1
readiness converge — a map, not a queue change.

**NOTHING BUILT / NOTHING PUSHED / NO NEON / NO EXTERNAL CALLS.**
Stopping here — no architecting performed. The master-architecture
session is where DATA-0 facts + DATA-1 readiness + this census +
competitive strategy get designed as one coherent system.
