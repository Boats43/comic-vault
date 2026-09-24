# U6 Pre-Flight Census — Existing Book/Non-Comic Code

**U5-MINIMAL-B dispatch, 2026-09-23. Report-only. Nothing in this document was changed, fixed, repaired, wired, or extended by the pass that wrote it.** Banked for whoever runs U6 — U6 must not begin from the assumption that Book support is a blank slate. It is not.

This census materially corrects the framing this same dispatch train used in its own prior pass (U5-MINIMAL's trace) and GK-242/U1's "BookAdapter.js already exists as a dormant 2026-06-06 skeleton" correction. Both undercounted what's actually live. `BookAdapter.js` is not dormant — one of its five exports (`buildBookQuery`) is real, non-stub, and called in a live Production request path today, gated on a real server-side book-detection signal that also runs on every scan regardless of any UI entry point (because none exists).

---

## F1 — Category branching (production-path)

Every production-path branch/switch/lookup involving `assetType`, `asset_class`, `category`, `'book'`, `'comic'`, or non-comic routing, found and traced this pass:

**`api/enrich.js`** (the handler — most of the real branching lives here):
- `:2309-2310` — destructures `assetType`/`assetTypeConfident` from `req.body`.
- `:2527-2530` — `out.assetType = assetType || 'comic'` ("Session 4B — Set assetType early so identityComplete logic can use it").
- `:3823-3847` — **the core finding.** "Session 4B — Derive assetType server-side from eBay category + title signals... Do not trust client handoff... Server derivation is source of truth." Counts eBay Browse API results whose `categories[]` match `/book|magazine|antiquarian/i` (`ebaySaysBook`, ≥50% of the pool) OR runs `detectBookSignals()` against the confirmed title/issue (`titleSaysBook`); either signal flips `out.assetType = 'book'`. **This runs unconditionally on every scan that reaches this point in the pipeline, independent of any client-supplied `assetType` and independent of any UI book-selection flow.**
- `:3853-3944` — Q32 merchandise detection (a sibling mechanism, not book-specific, but shares the same `assetType` field — sets `'merchandise'`).
- `:3949-3990`(approx) — "Session 4B — Derive author for books server-side when missing from client." Tries `author` from `req.body` (itself sourced from `api/grade.js`'s `BOOK_PROMPT`, see below), falls back to extracting a repeated author name across eBay listing titles.
- `:6645, :6782-6784` — `getAdapter(out.assetType).ebayCategoryId` (routes the eBay comp search to category `267` "Books & Magazines" instead of `259104` "Comics > Single Issues" when `assetType==='book'`); `author` threaded into the comp-fetch call for `buildBookQuery`.
- `:6981, :7146` — `out.assetType !== 'book'` guards on comic-only logic (edition-warning detection, signed-consensus handling) — confirms those comic-specific paths are already skipped for books, whether or not anything downstream is ready to fill the gap.
- `:8339-8341` — `assetType === 'merchandise'` forces the pricing pipeline into `RESEARCH`, regardless of comps.
- `:8578-8580` — `const adapter = getAdapter(out.assetType); const idCheck = assessIdentityConfidence(sanitizedIdentity, identitySource, adapter.identityFields, out.pcProductId);` — **identity-confidence gating is already adapter-driven in production**, not comic-hardcoded (see `identityGate.js` below).
- `:12188-12190` — the `identityComplete` ternary (GK-246's subject).
- `:12501-12505` — `assetTypeOverride`/`assetTypeConfidentOverride` surfaced in the response/scanlog payload.

**`api/comps.js`:**
- `:1018` — `author` parameter documented "Session 4B — book identity field (for buildBookQuery)".
- `:1178-1189` — `if (assetType === 'book') { const { getAdapter } = await import('../src/adapters/adapterRegistry.js'); const adapter = getAdapter('book'); if (adapter.buildQuery) { const bookQueries = adapter.buildQuery(title, author, null, null, year); ... } } else { /* existing comic query builder */ }`. **`buildBookQuery` is genuinely invoked here** — this is not wiring that stops short of a call.

**`api/grade.js`** (the Vision identification pass — branches before enrich.js ever runs):
- `:57` — a real `BOOK_PROMPT` constant (a distinct Claude Vision system prompt for books, alongside `STANDARD_PROMPT`/`WATCH_PROMPT`).
- `:122, :130-131, :787-794` — `detectBookSignals()` imported from `categoryClassifier.js`; `isBook` computed from the initial scan result; `if (isBook) { userPrompt = BOOK_PROMPT; console.log('[grade] Book signals detected — using BOOK_PROMPT'); }`. **The very first Claude call in the pipeline already branches on book-vs-comic.**

**`src/adapters/adapterRegistry.js`** — the dispatch table itself (see F2).

**`src/lib/categoryClassifier.js`** — `classifyTitle()` returns `'BOOK'` as one of its category values (`BOOK_PATTERN` regex: isbn/978-prefix/novel/paperback/hardcover/kindle/ebook/edition/trade-paperback); `detectBookSignals()` (14-pattern signal list — author/isbn/978-prefix/published-by/copyright/edition/hardcover/paperback/novel/title-page/dust-jacket/hc/dj/nth-ed/press/vol — requires 2+ matches); `filterByCategory(items, expectedCategory='COMIC')` — **only `'COMIC'` filtering is actually implemented; any other `expectedCategory` value (including `'BOOK'`) hits `console.log('[category-gate] category "X" not implemented, skipping filter')` and returns the pool unfiltered.** This is a real, disclosed gap: if a future book-facing pool-filtering call site ever passes `expectedCategory: 'BOOK'`, it will silently no-op rather than filter.

**`src/lib/identityGate.js`** — `assessIdentityConfidence(sanitized, identitySource, identityFields=['title','issue','year','publisher'], pcProductId=null)` — the `identityFields` parameter is genuinely adapter-driven at its one real call site (`api/enrich.js:8578-8579`, `adapter.identityFields`). The function's own header comment already documents all three planned shapes: Comic `title/issue/year/publisher`, Book `title/author/year`, Card `player/year/cardNumber/set`.

**`src/lib/decisionEngine.js`** — already covered under L1/GK-246: reads only the primitive `item.identityComplete` boolean, no direct field-name branching.

**`src/modules/assets/service.js` / `repository.js`** — a **separate, lower-layer** category concept: `createPhysicalAsset({..., assetClass = 'comic', ...})` (`service.js:94`), `if (assetClass && assetClass !== 'comic') { UPDATE data1_dev.gk_asset SET asset_class = $1 ... }` (`:123-124`). This is the GrailKey physical-asset **kernel's** `asset_class` column (DATA-1, `gk_asset` table) — **not the same field as `api/enrich.js`'s pricing-pipeline `assetType`.** They are unrelated variables in unrelated layers with no code path connecting them (see "Two separate category vocabularies" below).

**Found via grep, not individually deep-traced this pass** (flagged for U6's own closer look, not characterized further here to avoid overclaiming): `src/modules/capture/service.js`, `src/modules/capture/mapping.js`, `src/lib/captureScanHandler.js`, `src/lib/assetRecoveryHandler.js`, `src/lib/genericAssetCapture.js`, `src/lib/soldVerification.js`, `src/lib/compHygiene.js`, `src/lib/valuationQuestionHash.js`, `src/lib/cacheKeys.js`, `src/lib/assetConfirmationBadge.js`, `src/lib/manualCorrection.js`, `src/lib/scanLog.js`, `src/lib/evidenceEligibility.js` (line 86, a comment referencing "the not-yet-built BookAdapter" — now stale phrasing given BookAdapter exists, not verified whether the surrounding logic itself has any real coupling), `src/lib/identityReconciler.js` (line 71, similarly stale "Session 4B's BookAdapter/CardAdapter are roadmap-only" phrasing).

**`src/App.jsx`** — **zero** occurrences of `assetType === 'book'` (or any equivalent) anywhere in the file (confirmed by direct search). The client reads `item.assetTypeConfident`/`assetTypeCorroboratedBy` (comic-confidence flags) but never the `assetType` string value itself, and never `item.author`. Instead, the UI has its **own, separate, regex-based book-detection heuristic** (`isLikelyNonComic`, `App.jsx:1876-1885`, title-pattern match against `/\b(book|novel|paperback|...)\b/i` combined with a missing-issue check) that does **not** consult the server's real `out.assetType`/`out.author` fields at all. When it fires, the UI shows: *"📚 Book/Object detected — comic pricing disabled. Scan ISBN/barcode or archive this item."* (also at `App.jsx:6933`). **Two independent, unsynced book-detection mechanisms exist today** — a real server-side one (Vision prompt → eBay-category/title signals → `assetType='book'` → adapter-routed comps) and a separate, cruder client-side one (title regex only) that is the one actually gating what the user sees, and which dead-ends into a refusal rather than surfacing any of the server's real book data.

## F2 — BookAdapter

**File:** `src/adapters/BookAdapter.js` (123 lines, header: *"Session 4B — Book-specific domain logic. Extracts book knowledge from AssetCore... BookAdapter owns: author, ISBN, edition, format (hardcover/paperback), book-specific title sanitization."*)

**Imports:** none (standalone file, no dependencies on other project modules).

**Exports and classification:**

| Export | Shape | Classification |
|---|---|---|
| `expectedCategory` (const `'BOOK'`) | data | **DORMANT / UNREACHABLE** — never imported anywhere in the repo (confirmed by direct search); `categoryClassifier.js`'s `filterByCategory` has its own independently-defined, same-named `expectedCategory` parameter and does not import this constant. |
| `detectKeyValue(edition, signed, author)` | function | **DORMANT / UNREACHABLE** — real signature, but body is `// TODO Session 4B: implement first edition + signed detection; return false;`. Not imported/called anywhere. |
| `verifyContent(description)` | function | **DORMANT / UNREACHABLE** — `// TODO...; return true;`. Not imported/called anywhere. |
| `computeFormatRisk(format, price, soldComps)` | function | **DORMANT / UNREACHABLE** — `// TODO...; return null;`. Not imported/called anywhere. |
| `buildBookQuery(title, author, edition, format, year)` | function | **LIVE PRODUCTION.** Fully implemented (5-tier query-attempt ladder: title+author+edition+format+year down to bare title). Called at `api/comps.js:1184` — `adapter.buildQuery(title, author, null, null, year)` — reachable whenever `assetType === 'book'` at comp-fetch time. Note the live call site always passes `edition`/`format` as `null` — those two parameters of the ladder are wired but never actually populated from anything upstream. |
| `sanitizeBookTitle(title, context)` | function | **DORMANT / UNREACHABLE** — `// TODO...`, passthrough no-op (`return title`). Not imported/called anywhere. |

**Adapter registry entry** (`src/adapters/adapterRegistry.js`):
```
book: {
  identityFields: ['title', 'author', 'year'],
  usesComicVine: false,
  usesPriceCharting: false,
  gradeScale: 'book',
  ebayCategoryId: '267', // Books & Magazines
  buildQuery: buildBookQuery,
}
```
`getAdapter(assetType)` defaults to `ADAPTERS.comic` for any unrecognized type (including `undefined`/`null`) — safe fallback, matches existing comic-only behavior when `assetType` is absent. `card`/`coin` entries exist only as a commented-out template ("Future asset types (uncommitted)").

**Every reference, every dynamic path capable of selecting it:**
- `api/enrich.js:131` — static import, `getAdapter` called at `:6782` and `:8578` with `out.assetType` (which can genuinely be `'book'`, per F1's server-derivation trace).
- `api/comps.js:1181` — dynamic `import()`, `getAdapter('book')` called with a hardcoded literal `'book'`, gated on the caller's own `assetType === 'book'` check one line above.
- No other production file references `adapterRegistry.js` or `BookAdapter.js`.
- `src/App.jsx` does not import either file.

**Answer to F9-A (is BookAdapter actually dormant): NO.** One of its five exports (`buildBookQuery`) is live in Production, reachable on every scan the server classifies as a book. The other four exports are genuinely dormant stubs. "BookAdapter is dormant" and "BookAdapter is fully wired" are both wrong framings — it is a real, partial, already-integrated adapter with a working query-builder and four unimplemented category-specific functions.

## F3 — Book identity

- **Title/author/year:** real, live identity fields for the book category (`identityFields: ['title', 'author', 'year']`, `adapterRegistry.js`), consumed by `assessIdentityConfidence` (`identityGate.js`) and by `identityComplete`'s book branch (`!!(out.title && out.author)`, GK-246's subject).
- **ISBN:** referenced in Vision-signal detection (`categoryClassifier.js`'s `BOOK_SIGNALS`/`BOOK_PATTERN`, both matching `isbn`/`978-\d{10}`) and in the UI refusal message ("Scan ISBN/barcode or archive this item") — **but ISBN is never captured, parsed, stored, or passed through any book identity/pricing code path.** No field named `isbn`/`ISBN` exists anywhere in `out.*`, `BookAdapter.js`'s real parameters, or `adapterRegistry.js`'s `identityFields`.
- **Edition/binding/format:** `BookAdapter.js`'s `buildBookQuery` accepts `edition`/`format` parameters, but the one live call site (`api/comps.js:1184`) always passes `null` for both — no upstream code derives either value from Vision, eBay, or user input.
- **Publisher/volume/series/language:** no book-specific handling found anywhere; these remain purely comic-shaped concepts in the rest of the pipeline (e.g. `publisher` is a required comic identity field but not a book one).
- **Durable storage:** see F5.

## F4 — Response contract

- `src/lib/responseContract.js` (the I13 log-card-fidelity validator) has **zero** references to `assetType`, `'book'`, `author`, or `isbn` anywhere in the file (confirmed by direct search). It validates comic-shaped fields exclusively — any book-specific data the server computes (`out.assetType='book'`, `out.author`, the book-routed comps pool) is **not covered by the I13 contract** at all. A future U6 pass that starts rendering book fields on the card would need to extend this contract, not just the UI.
- `out.assetType` and `out.author` are real, live, populated `out.*` fields on the enrich response today (per F1) but are classified **live-but-unconsumed** — the response contains them, the client never reads them.
- `out.assetTypeOverride`/`assetTypeOverrideEvaluated`/`assetTypeOverrideBlockedBy`/`assetTypeConfidentOverride` — live, but these are all about the comic-vs-merchandise advisory-lock override (Q32/Dispatch 19), not book-specific.
- No dedicated `out.bookIdentity`/`out.isbn`/`out.edition` field exists anywhere in the response shape.

## F5 — Database / persistence

- **`db/data0/0001_generic_substrate.sql`** (DATA-0 layer) — `asset_class` table, seeded today with exactly one row: `INSERT INTO asset_class (code, name) VALUES ('comic', 'Comic Book');` (`:227`). `external_map.source` is documented (comment, `:150`) to include `'isbn'` as one of several free-text source values (`'gcd' | 'metron' | 'comicvine' | 'upc' | 'isbn' | 'sku' | 'pricecharting' | ...`) — a **designed slot**, not an enforced enum, and not a column that has ever held a real ISBN row. `facet` table (`:53-58`) is explicitly designed so "a future book vertical's `isbn`/`author` facets are new rows, not new columns or tables" — extensibility by design, zero real usage.
- **`db/data0/0004_data1_foundation.sql:64`** — `gk_asset.asset_class TEXT NOT NULL DEFAULT 'comic', -- future: 'book' | 'card', per the AssetCore/BookAdapter/CardAdapter roadmap`. A free-form TEXT column, not a CHECK-constrained enum — genuinely open to `'book'` today at the schema level. `createPhysicalAsset` (`src/modules/assets/service.js:94,123-124`) will happily write any non-`'comic'` string here if a caller ever passes one.
- **Real-world state (per GK-215/216/224, re-confirmed by this pass's own reading of those tickets, not independently re-queried against live DB this pass):** `gk_asset` has exactly one real row in Production (Old Man Logan #25, `asset_class` presumably `'comic'` or its default — not independently re-verified here) and zero rows anywhere else. **No `'book'` `asset_class` row has ever been written, in Production or Development.**
- **`db/data0/0026_collection_item.sql:15`** — the `attributes` JSONB column's own comment: *"...price/... for comics today; a future book/card adapter reuses this."* Confirms the category-extension boundary (per U2's ratified "Universal Kernel Boundary," CLAUDE.md) is intended to be this JSONB bag, not new dedicated columns — but nothing writes book data into it today (the UI never captures ISBN/author/edition, so there is nothing to write).
- **Two separate category vocabularies, not reconciled:** (1) the pricing-pipeline's `out.assetType` (`api/enrich.js`/`comps.js`/`grade.js`/`adapterRegistry.js`) — request-scoped, values `'comic' | 'book' | 'merchandise'`, drives Vision prompt / identity fields / eBay category / comp query construction; (2) the kernel's `gk_asset.asset_class` (DATA-1, `src/modules/assets/service.js`) — a persisted DB column, values in practice `'comic'` (default, the only value ever written) and `'generic'` (U4, Generic Asset Mode), schema-open to `'book'` but never populated with it. **Nothing in the codebase today sets `gk_asset.asset_class` from `out.assetType`, or vice versa.** A book scan that reaches `out.assetType='book'` and a durable capture via GK-218's "Capture as Owned Physical Asset" button are two entirely unconnected actions — the capture button (per GK-218) defaults `assetClass='comic'` and has no book-aware branch. **U6 must decide which of these two vocabularies it is actually extending** — they are not the same concept and currently point at different layers with no wiring between them.
- **Answer to F5's required question — "Does ISBN already have a durable storage location?" NO**, not as any populated column/table. A designed, generic *capacity* exists (`external_map.source='isbn'`, or a `facet` row, or `collection_item.attributes` JSONB) but no code path in the repo writes an ISBN value to any of them today.

## F6 — Market / pricing

- Real, live: eBay category routing (`ebayCategoryId: '267'`), `buildBookQuery`'s 5-tier query ladder, `usesComicVine: false`/`usesPriceCharting: false` (both correctly disable comic-only external lookups for the book path at the adapter-config level — not verified this pass whether every PriceCharting/ComicVine call site in `api/enrich.js` actually checks this flag before firing, versus only the ones already gated on `assetType !== 'book'` found in F1).
- No ISBN-based marketplace lookup exists anywhere (no ISBN is ever captured, so none could exist).
- No book-specific condition normalization, sold-comp filtering, or pricing formula exists — a book's comps, once fetched via `buildBookQuery`, flow through the SAME downstream pricing math (`pricingEngine.js`'s grade multipliers, sanity fallback, floor guards — all still comic-calibrated) as a comic would. This is itself a real, live risk: nothing in the traced pricing pipeline currently branches AWAY from comic-specific pricing math for a book-classified item, meaning a book that reaches pricing today would be priced using CGC-grade multipliers and comic-era boundaries never designed for it. Not independently confirmed whether pricing ever actually completes for a real `assetType='book'` item end-to-end (the identity gate's book `identityFields` don't require `issue`, so it's plausible a book could reach the pricing block) — flagged as a real, unverified risk for U6 to check before assuming the book pathway is merely "incomplete" rather than "would price wrong today if it ever completed."
- Not activated, repaired, or expanded by this pass, per instruction.

## F7 — UI

- **Book selection:** no UI path exists to explicitly choose "Book" as a scan/asset type. No book-specific scan mode.
- **Book capture/scan:** the same universal scan flow (grade → enrich) runs regardless of category; the server may classify the result as a book (F1), but nothing in the UI acts on that classification except the unrelated, regex-based refusal heuristic described above.
- **Book display:** none. `App.jsx` never renders `title`/`author`/edition for a book-classified item as such.
- **ISBN/barcode:** referenced only in the refusal message's own text ("Scan ISBN/barcode or archive this item") — no actual ISBN/barcode scanning UI or handler was found for books specifically (a general barcode-identify path exists for comics/CGC certs per CLAUDE.md's "Misc" section, not traced further this pass as it wasn't part of the book signal chain).
- **Generic Asset routing to book-specific behavior:** none found — U4's Generic Asset Mode (per CLAUDE.md) is its own separate `asset_class='generic'` path, unconnected to the book-detection machinery traced here.
- **Classification: DORMANT.** Every UI-side book touchpoint found is either a dead-end refusal message or simply absent.

## F8 — Census table

| Site | File:line | Existing behavior | Live? | Intended future owner | Collision risk with U6 |
|---|---|---|---|---|---|
| Server assetType derivation | `api/enrich.js:3823-3847` | eBay-category + title-signal book detection, sets `out.assetType='book'` | LIVE | AssetCore / Marketplace Adapter (category signal is eBay-specific) | HIGH — U6 must decide whether to keep, replace, or relocate this behind a real category-detection adapter method |
| Vision prompt routing | `api/grade.js:787-794` | Selects `BOOK_PROMPT` over `STANDARD_PROMPT` | LIVE | BookAdapter (prompt content) / AssetCore (routing) | MEDIUM — a real prompt exists; U6 should audit its quality/fields before assuming it needs to be written from scratch |
| `detectBookSignals` | `src/lib/categoryClassifier.js:407` | 14-signal book-vs-comic heuristic (2+ required) | LIVE | Marketplace Adapter / shared classifier | LOW — reusable as-is |
| `adapterRegistry.js` | `src/adapters/adapterRegistry.js` | assetType → config dispatch (identityFields, ebayCategoryId, buildQuery) | LIVE | AssetCore (the registry pattern itself) | HIGH — U6 may assume it needs to build this; it already exists and already has a `book` entry |
| `buildBookQuery` | `src/adapters/BookAdapter.js:69` | Real 5-tier eBay query builder | LIVE | BookAdapter | LOW — reusable; `edition`/`format` params always null today, real gap |
| `identityFields` book set | `src/adapters/adapterRegistry.js:37` | `['title','author','year']` | LIVE (consumed by `identityGate.js`) | BookAdapter / AssetCore contract | LOW |
| `identityComplete` book branch | `api/enrich.js:12188-12190` | `!!(out.title && out.author)` | LIVE | BookAdapter (per GK-246) | already ticketed |
| `detectKeyValue`/`verifyContent`/`computeFormatRisk`/`sanitizeBookTitle` | `src/adapters/BookAdapter.js` | Stubs, TODO, constant returns | DORMANT | BookAdapter | MEDIUM — U6 will likely need to implement these for real; nothing calls them today so nothing currently depends on their stub values |
| `expectedCategory` | `src/adapters/BookAdapter.js:16` | Unused constant | DORMANT/UNREACHABLE | BookAdapter / categoryClassifier (should probably be wired together) | LOW — safe to ignore or wire up |
| `filterByCategory('BOOK', ...)` | `src/lib/categoryClassifier.js:387-389` | No-op passthrough for any non-COMIC category | LIVE-BUT-INERT | Marketplace Adapter / shared classifier | MEDIUM — a real, disclosed gap: any future book-pool-filtering call silently does nothing |
| `gk_asset.asset_class` | `db/data0/0004_data1_foundation.sql:64` | Free-text TEXT column, default `'comic'`, schema-open to `'book'` | LIVE SCHEMA, never populated with `'book'` | Persistence / Generic Asset kernel | HIGH — separate vocabulary from `out.assetType`, not reconciled (see F5) |
| ISBN storage | none (no column/field found) | n/a | NOT LIVE | Persistence | HIGH — no durable location, must be designed |
| UI book display/capture | `src/App.jsx` | Absent; own separate refusal heuristic instead | DORMANT (display) / LIVE (refusal message, unrelated mechanism) | UI | HIGH — the refusal message actively blocks whatever U6 builds unless replaced/updated |
| Comic-calibrated pricing math applied to books | `src/lib/pricingEngine.js` (grade multipliers, sanity fallback, era boundaries) | Applies unconditionally to any comps pool, including a book's | LIVE, unverified whether ever reached for a real book | AssetCore / BookAdapter | HIGH — unverified, flagged risk, not confirmed this pass whether a book can currently reach a completed (wrong) price |

## F9 — Required census conclusions

**A. Is BookAdapter actually dormant?** No. `buildBookQuery` is live; four of five exports are dormant stubs; the surrounding routing infrastructure (`adapterRegistry.js`, server-side `assetType` derivation, `BOOK_PROMPT`, adapter-aware identity gating) is live and non-trivial. "Dormant" is the wrong word for the file as a whole.

**B. What book behavior is already live in Production?** Vision prompt selection (`BOOK_PROMPT`), server-side book detection from eBay category + title signals (independent of any client flag), server-side author derivation from eBay listing titles, adapter-driven identity-confidence checking (`title`/`author`/`year` required, not `issue`/`publisher`), eBay category-ID routing (`267` Books & Magazines), and a real 5-tier eBay comp-query builder that actually executes.

**C. What book behavior is partially implemented but not wired?** `detectKeyValue`/`verifyContent`/`computeFormatRisk`/`sanitizeBookTitle` (real signatures, stub bodies, zero callers); `edition`/`format` parameters on `buildBookQuery` (accepted, never populated); `BookAdapter.expectedCategory` (defined, never imported); `filterByCategory`'s non-COMIC branch (present, explicitly a no-op); ISBN (referenced in detection signals and UI copy, never captured/stored/used); the `gk_asset.asset_class` schema slot for `'book'` (open, never populated).

**D. What existing code would U6 duplicate or collide with if implementation began without accounting for it?** Building a new adapter-registry pattern (one already exists and already has a `book` entry). Rebuilding book-vs-comic detection (a real 14-signal classifier and a live server-side derivation path already exist). Rebuilding a Vision book prompt (one already exists and is already selected automatically). Assuming `gk_asset.asset_class='book'` is how U6 should represent a book asset without first reconciling it against the completely separate `out.assetType` pricing-pipeline concept already in use.

**E. What existing live behavior must be preserved byte/behavior-identically when U6 moves responsibility behind BookAdapter?** The book-vs-comic derivation trigger conditions (`ebaySaysBook`/`titleSaysBook` thresholds), the `BOOK_PROMPT` selection trigger (`detectBookSignals` on the initial Vision scan), the `identityFields` set consumed by `assessIdentityConfidence`, `buildBookQuery`'s existing 5-tier ladder and its 100-char truncation behavior, and the `getAdapter()` fallback-to-comic default for any unrecognized/absent `assetType`.

**F. Is there any evidence that a partial U6 implementation was already introduced without being formally inventoried as U6?** Yes, in the sense that real "Session 4B" book-support code already exists in `api/enrich.js`, `api/comps.js`, `api/grade.js`, `src/adapters/adapterRegistry.js`, `src/adapters/BookAdapter.js`, and `src/lib/categoryClassifier.js`, predating this dispatch and this dispatch train's own U5-MINIMAL trace — but it was introduced under CLAUDE.md's own "Session 4A/4B" roadmap labeling (visible throughout the source comments cited above), not silently or under a different name. It was, however, **under-counted by this project's own recent governance record**: GK-242/U1 (2026-09-21) corrected "BookAdapter.js not yet built" to "a dormant 2026-06-06 skeleton" — itself still wrong, since `buildBookQuery` is live and called. **One additional, out-of-repo observation, disclosed but not investigated further:** this machine's `.claude/worktrees/` directory contains several separate git worktree checkouts (`agent-a30e21973fd4ce7b8`, `agent-a913bbc37aa59ae39`, `agent-af4a9d94be57ca674`, `agent-ad55e1a1c62dba031`, `slice7-scan-ownership`), each with its own copy of `src/adapters/BookAdapter.js`. These are not part of the current branch or working tree this dispatch operated on, were not read or compared in any detail, and are flagged here only as a fact worth a future dispatch's attention — not characterized as U6 work, partial or otherwise, without actually reading them.

---

*Compiled by the U5-MINIMAL-B dispatch (2026-09-23), Section F, as a report-only deliverable. See `docs/TICKET-REGISTRY.md`, "GK-147 — CLOSURE (U5-MINIMAL-B)" for the ticket record this census is attached to.*
