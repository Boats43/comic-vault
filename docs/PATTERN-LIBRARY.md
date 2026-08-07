# Pattern Library

Full finding history for Comic Vault's identity/pricing pipeline, moved out of CLAUDE.md 2026-08-07 (GrailKey Dispatch 16) to keep CLAUDE.md under the 150k-char load limit. CLAUDE.md carries a one-line index; this file carries the complete writeups verbatim, in the same approximate order of discovery.

**Descriptive names, not letters. Listed in approximate order of discovery.**

- **Sinful Suzie class** — wrong-title comp contamination (different series under same nominal title).
- **Thor #4 class** — printing version mismatch (1st vs 2nd print same cover).
- **Howard Duck Magazine class** — format collision (magazine vs comic same character).
- **Marvel Age #58 class** — shared issue # different title.
- **Annual #2 class** — marker asymmetry (Annual #1 vs Annual #2 same series).
- **Loot Crate class** — convention/variant in active pool not flagged as variant.
- **Chip n Dale class** — text verified but cover image was different book.
- **Whitman #978 class** — non-comic format priced as regular comic.
- **Action Force class** — thin pence/UK market false HIGH match.
- **Spooky #118 class** — grade mismatch in active pool.
- **D'Orc #1 class** — apostrophe title eBay tokenization (`cleanTitleForSearch` SPACE replacement).
- **Star Wars #1 class** — reprint vs first-print (Vision sees, engine ignores) — Ship #19 territory.
- **Biker Mice #1 class** — thin pool sanity-flipped above lone comp — Ship #13.1 territory.
- **Action #1 / Superman #1 / Detective #27 class** — manual-review mega-keys.
- **JLA #62 class** — bottom-of-CGC-census low-grade floor — Ship #17 territory.
- **FF #61 class** — Silver Age key low-side threshold underpricing — Ship #14 territory.
- **House of Secrets #106 class** — alias-only creator detection — Ship #16 territory.
- **TMNT #1 IDW 2016 class** — mega-key publisher+year disambiguation — Ship #20a.7 territory.
- **Donald Duck Whitman #978 class** — refuse-to-price gate — Ship #20a.6.4 territory.
- **Provisional State Write class** — component writes optimistic state before backend confirmation, persists through merge.
- **Vision Hallucination class** — Vision infers fields from JSON_SHAPE context when confidence low.
- **Build-Pass Runtime-Fail class** — code passes build + tests but crashes at runtime (JSX scope errors).
- **Renumbered-franchise title/issue collision class** (ASM #17, 2026-07-16) —
  active-comp pool contaminated by a modern relaunch/anthology reprint sharing
  the exact same title+issue# as a scarce vintage original (Amazing
  Spider-Man #17 1964 vs. 2015/2025 relaunch "#17"s; also reproduced live for
  Action Comics #33 vs. its 2014 New 52 "#33"). NOT merch, NOT a category-gate
  leak — `MERCH_RE` and the `category_ids=259104` restriction work correctly;
  these are genuine, honestly-priced comics, just the wrong book. Root cause:
  `api/comps.js` Filter 0c (era-consistency, "FIX B"/Ship #25.1) deliberately
  accepts any active listing with no year token in its title, to protect
  genuine vintage sellers who omit the year (World's Finest #139/#149/#159/
  #163). That escape valve is symmetric — undated modern-relaunch listings
  pass the identical branch. **Source-level fix investigated and closed
  2026-07-16, no code path exists:** checked every field the eBay Browse API
  returns at both `item_summary/search` and `item/{itemId}` (full inventory —
  `itemCreationDate`/`itemOriginDate` is the *listing* post date, not the
  comic's publication date; `condition`/`conditionId` and `categoryId`/
  `leafCategoryIds` are identical across modern and vintage examples; `epid`
  correlates with lot-vs-single-item, not era) — no publication-date field
  exists anywhere in the API surface. Tested a price-band heuristic
  ($3.99-$4.99 = "probably modern") against a non-collision control book
  (Fantastic Four #187, 1977, no relaunch overlap) — 12/98 real, genuinely
  dated 1977 comps sat in that exact band, proving the heuristic would mass-
  reject legitimate non-key vintage back-issue comps. **Do not re-attempt a
  source-level (admission-time) fix without a genuinely new signal — this
  was investigated exhaustively, not skipped.** Mitigated at the card level
  instead: `computePriceBands` Tier 2 (`src/lib/priceBands.js`) flags the
  active pool as suspect when `activeAvg < soldAvg×0.25` or
  `activeLow < soldLow×0.25` and falls back to sold-only pricing rather than
  blending contaminated data in (commit 354d759). The parallel Q75 filter in
  `buildVerifiedActivePool` (same file) consumes the same eBay-sourced
  `{price, title}` shape and inherits the identical blind spot — no
  independent fix needed there; it's covered by the same card-level backstop
  once sold data reaches tier pricing. Residual gap: this backstop only
  engages when verified sold comps exist (`soldPool > 0`, i.e. Tier 2); a
  book with zero sold comps and a contaminated active-only pool (Tier 3/4)
  has no sold anchor to flag against and remains exposed. **A second,
  more severe gap in this exact guard — a sold pool of `n=1` treated as
  authoritative over 18 actives — found 2026-08-07: see "Bone #1 class"
  in the Pattern Library below (GK-34), scoped together with the
  mirror-image GK-21 defect in `applyVariantFallbackDivergenceCap`.**
- **Distinctive-artist-style confusion class** (Uncanny X-Men #27 /
  Ultimate X-Men #1, 2026-07-18) — Vision's own direct-image read
  (`STANDARD_PROMPT`, Sonnet) and eBay's independent reverse-image search
  both misidentified a Peach Momoko-illustrated cover as a different,
  unrelated title (Uncanny X-Men #27, 2026, misread as Ultimate X-Men #1,
  2024) — a title-level, not issue-level, confusion, confirmed on 3
  independent physical rescans of the same book with identical results.
  NOT the artist-consensus backfill ratio-gate class (Ditko/ASM #17,
  McFarlane/ASM #300, same night) — that gate governs whether an artist
  name in a MINORITY of a mixed pool should be trusted as distinguishing;
  Vision wasn't null on title here, so that mechanism never engages.
  Root cause: Vision's title came back wrong BEFORE any eBay signal
  entered the pipeline — grade.js's own eBay-image-search pre-check
  independently scored <0.3 confidence (triggering Vision fallback on its
  own), then Sonnet's `STANDARD_PROMPT` call (no eBay data injected)
  independently produced "Ultimate X-Men," and enrich.js's own separate
  reverse-image search (phase1) also converged on "Ultimate X-Men" from
  the raw photo. Two nominally-independent signals agreed, but on a
  correlated error — both keying off Momoko's stylistically consistent
  art across her different Marvel covers — not genuine corroboration,
  which is exactly what the system's "eBay agrees with Vision → trust it"
  design principle cannot distinguish from the real thing.
  **Mitigation investigated and implemented, honestly confirmed
  insufficient for this specific case:** TPB/collected-edition
  contamination of the identity-determination pool was a real,
  independently-discovered, separate gap (`TPB_MARKER_RE` gated the LATER
  comp-pricing pool only, never the earlier identity-consensus stage) —
  fixed via `IDENTITY_TPB_MARKER_RE` in `extractConsensus` (commit
  `2b00db5`). Reconstructed the real 20-listing production pool and
  confirmed: only 1/20 rows even matched (most sellers write "Paperback"
  with no "Trade" prefix), and removing it neither flips nor meaningfully
  moves the outcome — `extractConsensus`'s `issueOk` gate (3/20
  extractable issue numbers = 0.15, needs ≥0.5) was already correctly
  returning no-consensus with or without that row, matching production
  logs verbatim (`[visual] consensus: none — pool=20 (below issueOk>=50%
  coherence gate)`). With no consensus, the system correctly falls back
  to trusting Vision's own title — which was wrong from the start,
  upstream of anything this fix touches. **No further code-level fix
  identified — do not re-attempt without a genuinely new signal.** No
  field in Vision's response or eBay's API distinguishes "confidently
  reading the masthead correctly" from "confidently pattern-matching on a
  recognized artist's style"; both produce an identical high-confidence
  shape. A hard-coded "Uncanny ≠ Ultimate X-Men" rule would fix this one
  pair without generalizing (same caveat as the `OTHER_VARIANT_DESCRIPTOR_RE`
  stopgap elsewhere). This was investigated with a real, correctly
  implemented, low-risk, independently-justified mitigation attempt, not
  skipped or shrugged off — the mitigation shipped on its own merits but
  did not and could not resolve this case. Flagged for manual
  verification: any scan attributing a book to Peach Momoko (or any
  artist with a highly distinctive, recognizable style across multiple
  titles) should be double-checked against the physical masthead text
  before trusting title/issue.
- **Variant-artist token fusion class** (Black Cat #1 Skottie Young,
  2026-07-18) — the title-family weighted-consensus clustering pipeline
  (`buildTitleFamilies`/`selectTitleFamilyCandidate`, `src/lib/
  imageSearchIdentity.js`) fused a widely-shared variant-descriptor token
  into the confirmed series title. Vision correctly read "Black Cat" #1;
  because nearly every seller in the pool named the variant artist
  (Skottie Young) in their listing title, "young"/"skottie" co-occurred
  with "black"/"cat" in the required ≥60%-of-members share, so the Q45
  consensus-token vote treated them as core title tokens and fused them
  into the family string ("black cat young skottie"). That corrupted
  title then failed every downstream comp-title match (0/30 verified on
  20 genuinely correct comps), collapsing price to a fallback far under
  Vision's own estimate. Same failure SHAPE as the McFarlane/Ditko
  backfill-ratio finding the same night (a widely-shared artist name
  treated as distinguishing when it's common seller phrasing) but a
  DIFFERENT mechanism — that fix (`BACKFILL_MIN_YEAR` era-gate) only
  guards the CONFIRMEDVARIANT backfill path; the title-family clustering
  algorithm itself had zero artist-name awareness at the token-extraction
  stage (`tokenizeTitleFamily` → `extractSeriesTitle`, whose
  `NOISE_WORDS_RE`/`CATEGORY_BLOCKS` strip convention/ratio/retailer/
  exclusive/limitation/authentication/finish tokens but never creator
  names). Root cause was compounded by drift: TWO other independent,
  hand-maintained creator-name blocklists already existed downstream
  (`sanitizeSeriesTitle` in `src/lib/identityCore.js`, and
  `stripVariantNoise`/`extractMainTitle` in `imageSearchIdentity.js`) and
  BOTH were also missing Skottie Young — three separate artist-name lists
  had drifted out of sync with the canonical, comprehensive registry
  (`ARTIST_PATTERNS` in `src/lib/compHygiene.js`, which already had
  `/skottie young/i`) that `api/comps.js` soft-match creator filtering
  already trusts. **Fix:** `tokenizeTitleFamily` now strips
  `ARTIST_PATTERNS` matches before tokenizing, closing the gap at the
  single choke point shared by both Jaccard clustering AND the Q84
  dual-axis `ebayConsensusTitle` comparison (both route through this
  function), rather than forking a fourth list. Falls back to the
  unstripped title if stripping would empty it. Verified this does not
  regress the deliberate "creator-class addition allowed" behavior
  (Wonder Woman #75 / Jenny Frison, `tests/q84-dual-axis.test.js`) — that
  gate governs whether the Q84 override may ADD an artist name beyond
  what Vision+eBay already agreed on; it never depended on artist names
  surviving the base tokenizer, and the WW#75 fixture still passes
  unchanged. Regression fixture added: `tests/family-clustering.test.js`
  Fixture G, reconstructing the 20-listing Black Cat pool — confirms
  `confirmedTitle` resolves to "Black Cat" (not "black cat young
  skottie") and all 20 comps now cluster into a single matchable family.
  The other two drifted blocklists (`sanitizeSeriesTitle`,
  `stripVariantNoise`) were left as-is (out of scope for this fix — they
  didn't need to change for this bug's root cause to close, and touching
  them risks their own independently-tuned behavior); flag for a future
  pass if either surfaces its own production miss.
- **Intake-vs-listing gate class** (Walking Dead #109 / Siege #3 / Edge of
  Spider-Verse, Q110 dispatch, 2026-07-18) — three independent conditions
  (`assetTypeConfident=false`, Vision-confirmed `isReprint`/`editionType`,
  title-family-clustering `refused-identity-conflict`) were each wired as
  hard blockers that nulled price AND comps even when real, already-
  computed pricing data existed underneath — a card with a genuine
  10-listing comp pool (Walking Dead #109) showed a blank "Identification
  Required" wall instead of a number. Root cause was a FOUR-layer redundant
  block chain, not one gate: `api/enrich.js` nulled price directly and
  skipped the entire tier1-4 synthesis block (so the already-fetched
  comps never got priced); `decisionEngine.js`'s `identityBlockers` list
  forced `decision.action='ID_REQUIRED'`; `responseContract.js`'s
  `deriveState()` treated `ID_REQUIRED`/`refusedToPrice` as REFUSED-class
  and force-nulled `contract.price` regardless of what `out.price` held
  (enforced by invariant I1); `App.jsx`'s client-side merge separately
  folded `assetTypeConfident===false` into `idGated`, re-nulling price a
  third time. Comps were never gated by any of these layers and reached
  the client fully intact the whole time — hence "10 real listings, blank
  price." Separately, Siege #3 (a 2010 Marvel event tie-in) hit
  `identityRefused` — one of only 3 hard `return`s in the entire
  `api/enrich.js` pricing pipeline — which discarded the already-fetched
  eBay reverse-image-search pool (`visualResult.items`) entirely before
  the tier-4 visual-pool fallback (Ship 11, fires on
  `verifiedCount===0 && soldCount===0 && visualResult.items.length>=10`)
  ever got a chance to run; a sibling book in the same batch
  (Transformers Universe #1) correctly hit that same fallback and showed
  a $30 estimate with a $9.95–$125.99 range. Root-cause hypothesis for why
  event tie-ins are exposed: `tokenizeTitleFamily`/`buildTitleFamilies`
  (title-family clustering, see the Variant-artist-token-fusion entry
  above) has zero event/crossover awareness — a heavily cross-promoted
  event book's visual pool plausibly fragments across differently-titled
  tie-ins sharing similar cover branding, landing on a fragmented
  `fallback-vision` that escalates to `refused-identity-conflict`
  whenever Vision's own title-read confidence is LOW (plausible when a
  dominant event banner overwrites the small-print series title).
  **Ruling (explicit, not inferred):** all three conditions become
  informational-only at intake — the flag stays visible, but never
  prevents a computed price from displaying. Reserve hard, unconditional
  blocking for a later "ready to publish" stage, not intake/scan time.
  Genuinely-missing identity (no usable title/issue/year/publisher at
  all — `identity-not-confident`) is explicitly NOT included in this
  ruling and remains a hard blocker; there is no book to price against in
  that case, distinct from "identity present but a confidence flag fired."
  **Fix, reusing existing primitives rather than inventing new state:**
  `responseContract.js` already had exactly the right mechanism —
  `listingHardLocked` routes to contract state `LOCKED`, which (per the
  pre-existing "XMEN1 ruling" comment) keeps price/bands visible and only
  gates the List button, unlike `REFUSED`/`ID_REQUIRED` which null price
  everywhere. All three conditions now set `listingHardLocked` +
  `listingHardLockBanner` (the advisory copy) instead of
  `refusedToPrice`/`identityConfident=false`/forcing `ID_REQUIRED`, and
  `api/enrich.js`'s price-synthesis gate no longer short-circuits on
  `assetTypeConfident`. `isPolybagPricing` is deliberately NOT set true
  for the Vision-confirmed-reprint case (it was overloaded — also used by
  two genuinely data-driven, untouched divergence-abort branches and the
  legitimate reprint-pool pricing formula a few lines below) so control
  now falls through into that SAME existing reprint-pool pricing formula,
  or the normal tier engine, rather than a new bespoke path. The
  `identityRefused` early-return in `api/enrich.js` now computes the
  identical Ship-11 median/P25/P75 formula from `visualResult.items`
  inline (duplicated, not refactored, to avoid touching the already-
  tested Ship-11 code path) before returning, so a card only shows a
  genuinely blank price when there's truly nothing to fall back to (no
  visual pool either) — still not a REFUSED wall, an honest INCOMPLETE.
  Session-adjacent note: the `assetTypeConfident` hard-block itself was
  added same-day, hours earlier, in commit `1ea15f8` — this ruling is a
  conscious, explicit reversal of that gate's severity (confirmed with
  the user before implementing), not an accidental undo.
  **Messaging (Part 3, same dispatch):** `App.jsx`'s decision-panel
  render was showing raw blocker/warning slugs verbatim (literally
  `content-unverified`, `zero-verified-comps`) — `decisionEngine.js`
  already had nicer text in `buildWarningReason`/`buildBlockerReason` for
  some slugs, but that function's OUTPUT (`decision.reason`) was never
  what `App.jsx` rendered per-item. New exported `describeBlocker`/
  `describeWarning(slug, item)` functions map each slug to a specific,
  item-grounded sentence — `zero-verified-comps` now names the dominant
  `soldCompDiagnostics.reasons` rejection cause ("mostly variant
  mismatch"), `content-unverified` names the specific
  `storySuppressedReason` (era-gate-year-drift / foreign-edition /
  title-weak-match / title-token-mismatch / publisher-mismatch),
  `thin-pool-anchor` names the actual comp count, `identity-conflict-
  unresolved` surfaces the real `refusalReason` text. Found and fixed a
  genuinely dead field along the way: `out.compPoolContaminated` could
  never fire — `api/comps.js` computes and returns
  `reprintFallback`/`variantFallback` on its result, but `api/enrich.js`'s
  copy-forward block only ever threaded `artistFallback`/
  `premiumVariantIsolated` onto `out`, never those two — so "comp pool
  used a variant/reprint fallback" could never actually surface to a
  customer despite the check for it existing.
  Regression: `tests/q110-intake-nonblocking.test.js` — reconstructs
  Walking Dead #109 (LOCKED, real price visible), Siege #3 (LOCKED,
  Ship-11-formula fallback visible, range intact), the genuinely-zero-
  data sibling (honest no-price, still not REFUSED), and Edge of
  Spider-Verse (no longer the ID_REQUIRED wall, reframed as lowest-
  confidence RESEARCH tier) — plus a completeness guard asserting every
  known warning slug has a specific `describeWarning` branch, so a future
  `push()` with no matching branch can't silently regress back to raw-
  slug display.
- **Generic-descriptor variant-match class** (Venomverse #1, Q111
  dispatch, 2026-07-18) — active-comp variant isolation used only the
  generic finish descriptor ("foil") to require a match, pooling 2-3
  genuinely different products together (2017 "1:2000 Remastered B&W
  Variant", 2017 "1:1000 Remastered Incentive Color Variant" — same ratio
  as the correct book but a different, cheaper 2017 product — and the
  actual 2025 "SDCC McFarlane 1:1000 Mexican Foil" exclusive) into one
  averaged price. Confirmed NOT covered by the SAME-DAY Magik #1 / Silk #1
  fix (commit `1ea15f8`, `PREMIUM_VARIANT_RE` + `minMatches` threshold in
  `api/comps.js` Filter 1c) — that fix is a pure count/threshold change
  (2→1 matches required when the variant string contains a premium
  keyword); it assumes the token list handed to Filter 1c is already
  correct and never touches which tokens are extracted or how a listing is
  deemed to match. Two stacked, independent bugs, both real:
  1. **Upstream (root cause of this specific case):** `extractConsensus`
     (`src/lib/imageSearchIdentity.js`) built the confirmed `variant`
     string by flattening every category (convention/ratio/retailer/
     exclusive/limitation/authentication/finish) into ONE array and
     picking the single most-frequent token pool-wide via `getMostCommon`.
     In a foil-heavy pool, "foil" (finish category) is nearly always the
     most common token and wins outright — "sdcc" (convention) and
     "1:1000" (ratio), which `extractVariantTokens` correctly extracted
     per-listing one line earlier, were discarded before `variant` even
     left this function. Only affects the "Ship #EBAY-FIRST" eBay-first
     identity path (`api/grade.js:589-639`, the common "cheap path" when
     image-search confidence ≥0.3, per the Standard scan pipeline docs
     above) — the STANDARD_PROMPT/Vision-direct path is unaffected since
     Vision writes its own combined descriptive phrase with no lossy
     consensus step.
  2. **Filter 1c itself (independent, compounding, affects both identity
     paths):** `varWords.some(w => t.includes(w))` — ANY single token
     match counts as a full "variantMatch," never ALL. Even when `variant`
     DOES survive as a multi-word string, a listing containing only the
     generic "foil" (and none of the specific tokens) still isolates into
     the pool. Made WORSE by the same-day Magik/Silk fix specifically: a
     `variant` containing "sdcc" trips `PREMIUM_VARIANT_RE`, dropping
     `minMatches` to 1 — so a pool could "isolate" on a single
     generic-foil-only match with zero listings actually containing the
     premium marker, and get logged as validated `premium-variant
     isolation`.
  **Fix, reusing the existing taxonomy rather than forking a new one:**
  new `classifyVariantTokens(variant)` (`imageSearchIdentity.js`) — single
  source of truth splitting tokens into SPECIFIC (convention/ratio/
  retailer/exclusive/limitation/authentication) vs GENERIC (finish only:
  foil/virgin/sketch/holographic/etc — a cover TREATMENT, not a
  distinguishing PRODUCT) — used by BOTH call sites so they can't drift.
  (1) `extractConsensus` now computes the most-common token WITHIN each
  category independently (same pre-existing ≥2 adoption threshold), joins
  every category that reaches consensus in stable order — "sdcc 1:1000
  foil", not just "foil". (2) Filter 1c, extracted into a pure exported
  `applyVariantPreferenceFilter(pool, variant)`
  (`api/comps.js`) for direct regression-testability (matches the
  `hasMultipleDistinctIssues`/`detectSeriesMarkers` pattern already used
  in this file) — when 2+ specific tokens exist, require ALL of them
  (AND-match) instead of any single token; falls back to the original
  any-token OR-match if the AND-match produces zero comps (flagged via a
  `matchMode` field — `'all-specific'` / `'any'` / `'any-fallback'` —
  never silent). Single-specific-token variants (`"exclusive"` alone,
  Silk #1 class) and pure-generic variants (`"virgin"` alone — classifies
  as `finish`, i.e. generic — Magik #1 class) reduce to exactly the
  pre-Q111 OR-match behavior; only multi-token mixes change, confirmed by
  regression. Residual, deliberately out of scope: no regional-descriptor
  category exists anywhere in the codebase (`"mexican"`/`"uk"`/
  `"canadian"` are invisible to every tokenizer, including this fix) — not
  load-bearing for this case (`sdcc`+`1:1000` alone already correctly
  excludes both 2017 products), flagged as a follow-up if a future case
  needs it.
  Regression: `tests/q111-variant-token-specificity.test.js` — reconstructs
  the real Venomverse #1 pool (2017 ×2 wrong-ratio + 2017 wrong-product
  sharing "1:1000" + 2025 SDCC Mexican foil ×4), confirms `variant` recovers
  "sdcc 1:1000 foil" (not bare "foil") and Filter 1c isolates to exactly
  the 4 genuine SDCC listings, excluding BOTH 2017 products including the
  1:1000-sharing one a naive single-token match would still catch. Also
  reconstructs Magik #1 and Silk #1 (confirmed byte-for-byte unchanged
  behavior), a bare-generic-only variant (ANY-match fallback intact, no
  over-narrowing), and a synthetic AND-match-produces-zero case (confirms
  the fallback fires and is visibly flagged, never silently starves the
  pool to zero).
- **Batman #608 class, five stacked but independent bugs** (Q112/Q113/Q114/
  Q115 dispatch, 2026-07-18) — one card, four internal contradictions plus
  a fifth, deeper root cause discovered via direct production-log
  reconstruction AFTER Q112 shipped — confirmed as five genuinely separate
  root causes (not one fix covering all of them):
  1. **Year resolution (SHIPPED)** — `cvYear` was derived from
     `comicVine.startYear` (the matched ComicVine *volume*'s launch year —
     1940 for Batman vol. 1) instead of the matched *issue*'s own
     `coverDate` (2002 for #608, Hush). `resolveYear`'s `(!userYear || …)`
     branches (`src/lib/identityCore.js`) accept PC/CV years unconditionally
     with zero plausibility check whenever no Vision/user year is present on
     the request — the documented "keep user, reject override" safeguard is
     unreachable in that case. Structural: exposes any long-running ongoing
     series (Detective, Action, Superman, ASM v1, FF v1, X-Men v1, etc.), not
     Batman-specific. Fix: new `deriveCvYear(comicVine)`
     (`identityCore.js`) — issue `coverDate` only, no `startYear` fallback.
     Ruling: core fix only — the dead era-gate at `api/enrich.js` ~2893-2909
     (built to catch exactly this via an eBay-visual-pool-derived era lock,
     but reads the wrong `comicVine?.volume?.startYear` shape and has never
     fired) is a QUEUED FOLLOW-UP, not bundled here — it also touches CV
     convergence-score axes (~2811/2817/2823) and CV publisher backfill
     (~3332-3335), three more dead-code paths sharing the same shape bug,
     with unknown interaction effects once simultaneously reactivated after
     however long they've been dormant. Regression:
     `tests/q112-year-resolution.test.js`.
  2. **Sold-comp verification-count math (SHIPPED)** — card showed "30→20
     verified (20 variantMismatch, 6 annualMismatch, 3 lot)," summing to
     ~29 against a rejectedCount of 10. Root cause: `verifySoldComps`'s
     VARIANT FALLBACK path (`src/lib/soldVerification.js` ~828-1080) is a
     SECOND, independent filter pass over the full raw pool (fires when the
     first pass rejects 100% of rows with ≥1 variantMismatch, skipping
     variant filters on retry) — the returned verifiedCount/rejectedCount
     came from this second pass, but `reasons` was the abandoned FIRST
     pass's tally, which (having rejected every row before falling back)
     always sums to ~rawCount regardless of what the second pass actually
     excluded. Two different runs' numbers displayed as one set. Fix: the
     fallback pass now tracks its own `fallbackReasons`/
     `fallbackRejectedSamples` during construction, mirroring the main
     chain's exact per-filter reason-key mapping — `sum(reasons)` now
     reconciles with `rejectedCount` by construction, for any pool shape.
     Regression: `tests/q113-sold-fallback-reasons.test.js`, a 30-item pool
     reconstructing the real production shape.
  3. **Contradictory sold-data claims (SHIPPED, labeling only)** — "Sold
     data: 16d recency" (3 visible solds) vs Price Derivation's "Based on 0
     eBay sales in last 30 days" on the same card. NOT a data bug — confirmed
     these are two genuinely independent sources (`item.soldComps`,
     PriceCharting sales-history via `soldVerification.js`, vs
     `item.comps.count`, a separate eBay Browse/Finding API fetch via
     `api/comps.js`) that can legitimately disagree, presented with no
     source qualifier so they read as contradictory. Bonus finding: the "in
     last 30 days" claim is itself unenforced — `api/comps.js`'s
     `findCompletedItems` has no explicit date-range filter anywhere in the
     query. Fix: source qualifiers added to both lines (`App.jsx`, "Sold
     data: Nd recency (PriceCharting)" / "Based on N eBay listings (eBay)"),
     "in last 30 days" removed since it was never actually true.
  4. **Over-broad variantMismatch rejection (INVESTIGATED, FIX REVERTED —
     highest financial impact of the four, still open)** — 20/30 sold comps
     rejected as `variantMismatch` on a book with multiple genuine first-print
     Hush Cover A comps visibly sitting in the "Last Sold" pool; price
     $19.28 vs Vision's own $175-275 estimate. Confirmed NOT the same bug as
     the same-night Q111 fix (`f705054`) — `soldVerification.js` is untouched
     by that commit, imports nothing from `imageSearchIdentity.js`, and
     defines its own separate, cruder local `extractVariantTokens` (flat
     foil/virgin/newsstand/exclusive/ratio/sketch/altcover/reprint labels,
     no specific-vs-generic distinction). Root mechanism: Filter 8 case (a)
     (`compVariantTokens.length > 0 && userVariantTokens.length === 0` →
     reject) fires on ANY token when our confirmed variant is empty,
     including incidental marketing language, not just genuine variant
     declarations. **Attempted fix, reverted after implementation testing
     (not caught during the investigation/report phase):** classify tokens
     via `classifyVariantTokens` (same taxonomy as the Q111 fix) into
     SPECIFIC (convention/ratio/retailer/exclusive/limitation/authentication)
     vs GENERIC (finish: foil/virgin/sketch), only reject on specific-token
     presence. Broke a validated, real protection instead — the existing
     test `"Test Comic #1 virgin variant"` / `"Test Comic #1 foil variant"`
     (`tests/sold-verification.test.js`, "Variant contamination — our book
     NOT a variant rejects variant rows") are UNAMBIGUOUS explicit variant
     labels (the word "variant" is right there), not marketing hype — and
     CATEGORY_BLOCKS classifies by WORD MEANING (is "foil" a finish
     descriptor?), not by whether the word appears as part of an actual "X
     variant"/"X cover" declaration vs standing alone as sales language on
     an otherwise-standard listing. Those are different questions; the
     generic/specific split can't answer the second one, and conflating them
     silently reopened exactly the contamination class Filter 8 case (a)
     exists to prevent. **A correct fix needs phrase-level context-
     sensitivity — does the token sit inside an explicit variant-declaring
     phrase, or stand alone as apparent hype? — which no pattern in this
     codebase has today.** Reverted cleanly (confirmed `sold-verification.test.js`
     back to the exact 124-passed/5-failed pre-existing baseline). Do not
     re-attempt with the same specific/generic heuristic without first
     designing the phrase-context signal — this was a real, honest attempt
     that surfaced a genuine gap during testing, not skipped or guessed at.
  5. **Visual-pool contamination corrupting variant/year backfill (SHIPPED
     — the actual primary root cause of the wrong year in this exact card,
     discovered via direct Vercel production-log reconstruction AFTER #1
     shipped)** — pulled the real 20-item eBay reverse-image-search pool
     for this exact scan (searched runtime logs for the distinctive title
     string, confirmed via `[boot]` build ID it was the authentic pre-fix
     request). **0 of 20 items were genuinely Batman #608** — a mix of
     Superman/Batman #657, Absolute Batman #19, Detective Comics #1000,
     Batman #1 reprints/facsimiles, Batman and Robin #25, and even
     unrelated Marvel Venomverse listings, sharing only eBay's own visual-
     similarity confusion around cover artist Dell'Otto's distinctive
     painted style across his many DIFFERENT DC variant covers (confirmed
     genuine eBay-search-quality noise, not a category/leaf-filter gap on
     our side — all correctly categorized `259104`). Title-family
     clustering correctly detected the incoherence (`decision=fallback-
     vision`, `[visual] consensus: none`) and correctly avoided the pool
     for TITLE purposes. **The bug: `extractConfirmedVariant`
     (`src/lib/variantIdentity.js`) is a SEPARATE consumer of the exact
     same raw pool that never learns about that determination** — it
     re-processes the full unfiltered 20 items regardless. 4/20 mentioned
     "Dell'Otto" — a MINORITY (20%), correctly scored as *not* the
     standard cover by the existing artist-consensus ratio gate (Q109-FIX-
     A, `< 70%` = "distinguishing," the exact signal shape this feature
     treats as a genuine variant subset when the pool IS the same book,
     its original documented purpose — e.g. a Skottie Young facsimile
     mixed into a Captain America #25 pool). With no issue-level check,
     the gate can't distinguish "genuine minority-variant subset of THIS
     book" from "these are just different books that happen to share a
     prolific painter." Backfilled `confirmedVariant="exclusive Dell'Otto
     limited"` and, via the feature's own Q99-B artist-year sub-mechanism,
     overrode `confirmedYear` 2002 → 1940 — **entirely independent of and
     downstream from `resolveYear`**, which had already correctly resolved
     2002 by this point (confirmed directly in the log:
     `[variant-identity] gates passed: year=2002` immediately followed by
     `[variant-year] overriding confirmedYear 2002 → 1940`). This
     corrupted variant then drove the active-comp search query itself
     (`Batman #608 Dell'Otto 1940 DC Comics`) and rejected all 30 genuine
     PriceCharting sold comps in Filter 7 (`classifyArtistMatch` — real
     Batman #608 listings never mention "Dell'Otto," the actual artist is
     Jim Lee) before Q113's fallback rescued 20 of them at the wrong
     price. **Confirms Fix #1 (item 1 above) is real and independently
     worth keeping, but was NOT sufficient alone for this exact production
     symptom** — the two fixes are complementary defense-in-depth on two
     structurally separate pathways (ComicVine volume-year leak vs.
     visual-pool variant/year backfill), not redundant.
     **Fix, reusing the existing per-item `.issue` field rather than new
     extraction logic:** new `filterItemsByIssue(items, confirmedIssue)`
     (`src/lib/variantIdentity.js`) — filters the visual pool to only
     items whose OWN extracted issue number (already computed by
     `extractIdentityFromImageSearch`/`extractIssueFromTitle`, the exact
     value the `[visual] extracted issues: [...]` log line already draws
     from) matches our confirmed issue, applied in `api/enrich.js`
     immediately before `extractConfirmedVariant` is called — root-
     mechanism fix (bad input never reaches the computation), not a
     downstream flag on bad output. An artist-name match can structurally
     never come from a different issue once this filter is applied. The
     pre-existing Ship 26.3B family-narrowing (only fires for
     `top-rank-protection`/`weighted-consensus` decisions) is unioned with
     this filter, not replaced by it — Ship 26.3B still narrows to the
     selected title family first when one was found; this filter then
     additionally requires genuine issue-number agreement regardless of
     which branch produced the candidate pool. Confirmed the facsimile/
     genuine-variant case this feature was originally built for (Captain
     America #25 / Skottie Young) is unaffected — those listings still
     carry "#25," so they survive the filter untouched, including when
     mixed with unrelated-issue noise in the same pool.
     Regression: `tests/q115-variant-issue-filter.test.js` — reconstructs
     the real 20-item Batman #608 pool with `.issue` values matching the
     production log exactly (15 non-null / 5 null, zero "608"), confirms
     the bug reproduces on the unfiltered pool (fixture fidelity check)
     and resolves after filtering (`confirmedVariant` stays null,
     `confirmedYear` stays 2002); confirms Captain America #25 / Skottie
     Young still backfills correctly standalone AND when mixed with
     unrelated-issue noise; confirms empty and single-item post-filter
     pools fall through gracefully (no crash, no backfill) rather than
     defaulting to something else.
- **Incredible Hulk #377 class, printing/edition not tracked** (Q116
  dispatch, 2026-07-18) — printing (1st/2nd/3rd/.../Nth, facsimile) was not
  a variant category anywhere in the system. Confirmed real: Incredible
  Hulk #377 (McKeown/McLeod 3rd printing, $100 min raw per Goldin.co) priced
  at $10.52 by blending 1st/2nd/3rd-print comps together. Investigation via
  real Vercel production logs found `editionWarning.detected` never fired
  for that exact scan — Vision's cover-photo-only analysis never captured a
  printing signal at all, a genuine upstream limitation this dispatch
  cannot fix (see Part 3 / Option A below). Separately found a real,
  actionable bug even when the signal DOES fire: `api/enrich.js`'s existing
  edition-gate (Ship #1.3) grouped ALL reprint-labeled comps into one
  undifferentiated "any reprint" bucket, discarding
  `editionWarning.signals`' own specific classification
  (`'second-print'`/`'third-print'`/`'facsimile'`).
  **Part 1 fix:** new `classifySpecificPrinting(signals)` (`api/grade.js`)
  — priority third > second > facsimile, returns `null` on generic-only
  signals (`'reprint'`/`'later-printing'`/`'not-first-print'`/
  `'not-original'`/`'less-valuable'` — deliberately not threaded, since a
  vague "some kind of reprint" signal is exactly the under-specified input
  Q111 already fixed AND-match against, not real data). `api/enrich.js`'s
  edition-gate now isolates comps to the specific printing kind when one is
  classified, falling back to the old undifferentiated regex only when
  Vision's signal was itself generic.
  **Part 2 fix:** the classified kind is threaded into `confirmedVariant`
  (`api/enrich.js`, guarded by `!cgcIdentityConfirmed && editionWarning?.detected`)
  so it feeds the SAME isolation machinery already built for other variant
  categories — Q111's AND-match (`applyVariantPreferenceFilter`, Filter 1c)
  on the active-comp side, and the pre-existing `printingMatch`
  (`soldVerification.js`) on the sold-comp side. New `PRINTING_PATTERNS`
  category added to `CATEGORY_BLOCKS` (`imageSearchIdentity.js`), classified
  SPECIFIC (not generic — a 3rd printing and a 1st printing are different
  products with different market values, same reasoning as an
  SDCC-exclusive or ratio-incentive claim).
  **Compounding bug found and fixed while writing the regression (NOT part
  of the original ask, surfaced by testing, reported before fixing per
  standing protocol):** threading `confirmedVariant = "3rd print"` did
  NOT actually activate Q111's AND-match on the active-comp side.
  Two stacked root causes in `api/comps.js`'s `applyVariantPreferenceFilter`
  (Filter 1c), both pre-existing and general, not introduced by Part 1/2:
  (a) a `varWords` stopword/length filter gated the ENTIRE function before
  `classifyVariantTokens` was even consulted — `'3rd'` is length 3 (filter
  requires `>3`), `'print'` is an explicit stopword, so `varWords` came out
  empty and the function early-returned `matchMode:'none'` for every
  printing token, unconditionally; (b) `classifyVariantTokens` itself
  word-split the input and looked up each word individually against the
  token registry — silently breaks any token that's inherently multi-word
  with no useful standalone-word remainder. Confirmed this second issue
  predates Q116 entirely: `classifyVariantTokens('signature series')` was
  already `{specific:[], generic:[]}` (`'gold foil'`/`'convention
  exclusive'` happened to survive "by luck," since their second word is
  separately a valid standalone token — `'3rd print'` has no such luck).
  **Fix (greenlit separately, same dispatch):** `classifyVariantTokens`
  rewritten from whitespace word-split to a longest-token-first substring
  match against the full known-token registry (mirrors
  `extractVariantTokens`' own convention, with the same
  skip-if-already-covered-by-a-longer-match guard used there for bare
  `'foil'` vs `'gold foil'`). `applyVariantPreferenceFilter` no longer lets
  `varWords` gate the function up front — `classifyVariantTokens` is
  consulted first; `varWords` is now only a same-purpose fallback for
  variant text `classifyVariantTokens` can't classify at all. Verified
  zero regression on the full Q111 suite (27/27, including the Venomverse
  AND-match, Silk #1, Magik #1, and AND-match-fallback fixtures,
  byte-identical behavior) plus the `signature series` fix landing as a
  confirmed side effect, not the reason it shipped.
  **Part 3 (explicit product decision, not a code fix, recorded for future
  reference):** cover-only photography cannot see printing-edition indicia
  for most books — physics, not a bug. Decided: Option A — a manual
  "Printing" dropdown field (1st/2nd/3rd/Nth/Unknown), same UX pattern as
  the existing Mark-as-Raw/Mark-as-Graded toggle, feeding directly into
  `confirmedVariant` to trigger the same isolation machinery built here.
  Not yet implemented — queued as a future dispatch, not bundled into this
  one.
  Regression: `tests/q116-printing-edition.test.js` (39 assertions) —
  `classifySpecificPrinting` priority/null behavior; `PRINTING_PATTERNS`
  extraction and SPECIFIC classification; an end-to-end reconstruction
  (Vision text genuinely triggers `'third-print'`, real Incredible Hulk
  #377 comp-pool title data reused from the actual production pool) proving
  both the active-side isolation (14 comps → 2 genuine 3rd-print survivors)
  and the sold-side `printingMatch` isolation (verified average $105 vs.
  the $12-20 blended 1st/2nd-print comps) now work; a thin-pool honest
  refusal case (<3 matching comps); and a control case confirming a normal
  no-printing-signal book is completely unaffected end to end.
- **Catwoman #64 Szerdy-variant class, same title/same issue#/different
  year** (Q127 dispatch, 2026-07-19) — a NEW visual-pool contamination
  shape, distinct from the Batman #608 class (Q115): there, the wrong-book
  pool shared a DIFFERENT issue number, so `filterItemsByIssue` fixes it at
  the root. Here, the wrong-book pool (a 2024 Nathan Szerdy "exclusive/
  limited" trade-dress homage variant) shares the SAME title string AND the
  SAME issue number as the real 2007 Catwoman #64 — `filterItemsByIssue` is
  a structural no-op against it (confirmed: 20/20 pool items genuinely
  extract issue "64"). The only signal distinguishing the two books is
  YEAR. `poolYearHint` (independently computed per-request from the same
  visual pool, no ComicVine dependency) already carried it — 2024 at 100%
  agreement (6/20 explicit mentions) — completely decoupled from
  `confirmedYear` (2007, resolved later from PriceCharting) and never
  cross-checked against it. Root mechanism was two-layered: (1) grade.js's
  own eBay-first path (`extractConsensus`, api/grade.js:353, a SEPARATE
  request/pool fetch from enrich.js's own) produced the contaminated
  `variant="exclusive limited signed"` and forwarded it to the client, who
  sent it back as `req.body.variant`; (2) `extractConfirmedVariant`'s own
  gates in enrich.js never fired to correct it (Gate 4, confidence=high,
  silently declined the override), so the contaminated client-forwarded
  string passed through untouched. Fix: `detectVariantPoolYearConflict`
  (`src/lib/variantIdentity.js`) — a POOL-LEVEL (not item-level) gate,
  deliberately: only 6/20 of the real contaminating listings even mentioned
  a year at all; the other 14 ("Nathan Szerdy DC Comics Trade Dress Variant
  A /3000 Homage Cover") carry no year and would survive a per-item filter
  untouched, still contributing exclusive/limited tokens. Mirrors the
  existing `[cv-era-gate]` precedent (suppress outright on a huge,
  incontrovertible year drift, rather than partially filter). When
  `poolYearHint` conflicts with `confirmedYear` by more than 5 years (a
  tunable tolerance, looser than mega-key/AI-verify ±1-2y conventions —
  this is a coarser "is this pool even plausibly the same printing"
  check), `api/enrich.js` suppresses BOTH the client-forwarded
  `req.body.variant` (nulled, not trusted) AND the `extractConfirmedVariant`
  recomputation (skipped entirely, never re-derives the same contamination
  from the same pool) — surfaced via `out.variantPoolYearConflict` per I13
  (annotate, never silently drop). Deliberately conservative: can suppress
  a genuine Vision-read variant on the rare chance one coincides with a
  conflicting `poolYearHint` — accepted per standing doctrine (prefer
  under-confident over over-confident identification; a missed multiplier
  is a small miss, a contaminated one is the $13.50-vs-real-price class of
  bug this gate exists to close).
  Regression: `tests/q127-variant-pool-year-conflict.test.js` (26
  assertions) — `detectVariantPoolYearConflict` unit behavior (no-hint,
  agreement, boundary-at-tolerance, over-tolerance); an end-to-end
  reconstruction of the real 20-item Catwoman #64 pool confirming
  `filterItemsByIssue` is genuinely a no-op (0/20 removed) while the new
  year-gate correctly suppresses both `req.body.variant` and
  `extractConfirmedVariant`; a regression confirming the Batman #608 class
  stays inert under this new gate (no poolYearHint → gate never engages,
  Q115's own fix remains the mechanism that closes it); and a genuine
  same-year multi-variant case (Captain America #25 / Skottie Young,
  poolYearHint agreeing with confirmedYear) confirming the gate does not
  false-positive and the real variant backfill still fires normally.
- **Drifted-duplicate-constant class, third instance: year-tolerance
  numbers** (Q128 dispatch, 2026-07-19) — the same "independently-
  maintained copy silently drifts from its sibling" shape found twice
  earlier the same night (Q119: five separate `COMPOUND_TITLE_WHITELIST`-
  equivalent lists, consolidated onto one canonical export; Finding 2/Q127:
  ~10 separate `req.body.variant` read-sites in `api/enrich.js`, several
  bypassing the gated `confirmedVariant`) — recurring a third time, this
  time as a NUMERIC tolerance constant rather than a string list or a
  variable-read site. `api/comps.js`'s active-listing Filter 0c (±3y for
  modern books) and `src/lib/soldVerification.js`'s sold-comp
  `yearMismatch` filter (±2y for modern, in TWO places — a main pass and a
  fallback pass) had already silently diverged — and `soldVerification.js`'s
  own comment literally read "Era-based tolerance (mirrors active Filter
  0c)," a claim that was no longer true by the time it was read. Same
  lesson as the prior two instances: a comment asserting cross-file
  consistency is not itself evidence of consistency; only a shared,
  single-sourced value is. Fix: `getEraYearTolerance` +
  `evaluateEraYearMatch` (`src/lib/compHygiene.js`, already the
  established shared-helpers home per this doc's Key Files list) — one
  function each, reused by `api/comps.js` and both `soldVerification.js`
  passes. `identityAlignment.js`'s own flat (non-era-banded) ±2y
  `yearMatch` was deliberately NOT folded in — it serves a different
  purpose (Vision/CV/PC self-consistency scoring, not comp-pool admission)
  and was never part of the false "mirrors" claim; consolidating it too
  risked unrelated collateral effects on identity-confidence scoring for
  no clear benefit. When auditing for this class going forward: grep for
  the same VALUE (a regex, a whitelist, a tolerance number, a threshold)
  appearing in more than one file, not just for files that explicitly cite
  each other — the citation is exactly the thing that goes stale first.
- **Back-issue comp listings commonly cite a series' volume-launch year,
  not the specific issue's own cover date** (Q128 dispatch, 2026-07-19,
  Harley Quinn #62) — a domain-knowledge fact about how the secondary
  comics market labels listings, independent of the code-drift finding
  above; documented here on its own so a future investigation doesn't
  have to re-derive it. Confirmed via a direct, real ComicVine `/volumes/`
  API lookup during this dispatch (not inferred): a real production card
  for Harley Quinn #62 (confirmed via PriceCharting to be cover-dated
  2019) had an active eBay comp titled "...Harley Quinn #62 (2016)
  Guillem March 1st Print..." sitting in its comp pool. This looked, on
  its face, identical to the Batman #608 / Catwoman #64 wrong-volume
  contamination shape (Q115/Q127) — but querying ComicVine directly for
  the exact volume this book's issue #62 resolves to (vol_id 92750, per
  the same production log's own `[comicvine] volDetails fetched: 1/1 —
  92750:Harley Quinn(2016,DC Comics)` line) returned `start_year: 2016`
  as ComicVine's own canonical value for that volume — confirming the
  "(2016)" label is the ongoing series' launch year, not a different,
  wrong printing. Sellers on eBay (and, per this same lookup, ComicVine/
  GCD/MyComicShop-style cataloging generally) routinely cite the volume's
  start year for back issues rather than looking up each individual
  issue's specific cover date — completely standard practice, not seller
  error and not contamination. Mechanically encoded as `isVolumeLabelYear`
  (`src/lib/compHygiene.js`): a comp's stated year is treated as
  legitimate when it lands within ±1y of the CONFIRMED book's own
  ComicVine volume start year, even when it falls outside the ordinary
  confirmedYear era tolerance. Does NOT weaken protection against genuine
  wrong-volume contamination (Batman #608 class) — a volume-label match
  only admits a year matching THIS specific book's own resolved volume,
  never an arbitrary nearby year. Before assuming a same-title/same-issue,
  different-year comp is contamination: check whether the stated year
  matches the confirmed book's own ComicVine volume start year first —
  it may be the more mundane, correct explanation.
- **Correct-rejection silent-substitution class** (Q129 dispatch,
  2026-07-19, Harley Quinn #62 Guillem March Cover C) — a fourth same-
  night instance of the "same title, same issue#, different year meaning"
  shape (Q115 Batman #608, Q127 Catwoman #64, Q128 Harley Quinn #62's own
  active-pool tolerance gap), but structurally the FIRST where the correct
  behavior (era-filter rejecting a different printing) is what CAUSES the
  downstream problem, rather than a filter failing to reject something.
  Confirmed real: the physical book is the Guillem March Cover C card-
  stock variant (confirmedYear 2019). Every currently-live eBay listing
  matching that exact description is a 2026 DC homage/nostalgia reprint
  solicitation, correctly rejected by Filter 0c's era check (3 of 14
  rejections explicitly named "Cover C"/"Guillem March"). With zero
  genuine 2019 Cover C comps left in the market right now, the variant-
  preference filter fell back to matching on "1st print" — a token nearly
  every current listing shares, including the wrong ones — and the
  surviving pool (generic Main Cover comps) silently produced a price with
  no signal that the SPECIFIC variant being priced has no current market
  data. Not fabrication (Vision Hallucination class), not contamination
  (Q115/Q127/Q128) — a silent substitution of one real product's comps for
  a different real product's when the correct data genuinely doesn't
  exist right now. Compounding factor found during investigation: "Guillem
  March" was entirely absent from `ARTIST_PATTERNS`
  (`src/lib/compHygiene.js`) — the same drifted/incomplete-registry shape
  documented multiple times this session, discovered fresh here; added as
  a multi-word-only pattern (deliberately no bare `/march/i` fallback —
  collides with the calendar month). Fix: `hasNamedVariantDescriptor` +
  `detectVariantCompsExcludedByEra` (`src/lib/compHygiene.js`) — reuses
  three pre-existing detectors (`OTHER_COVER_RE`, `OTHER_VARIANT_DESCRIPTOR_RE`,
  `extractArtist`) rather than inventing a fourth. `api/comps.js`'s Filter
  0c tracks era-rejected listings that name a specific cover variant, then
  flags only when the FINAL priced pool carries no named descriptor at
  all — a final pool that DOES carry a different-but-still-named variant
  is still pricing a real, specific product, not the silent-substitution
  shape this catches. Surfaced via `out.variantCompsExcludedByEra` (I13)
  and a new `variant-comps-unavailable` decision warning, escalating to
  RESEARCH. When investigating a "wrong price" report going forward: check
  whether an upstream filter (era, in this case) correctly rejected the
  RIGHT comps for a legitimate reason, leaving only wrong-but-permitted
  comps behind — this is a different failure shape from data getting IN
  that shouldn't have, and needs a flag, not a filter change.
- **Bone #1 class — Strip 1's first production validation, plus a cluster
  of independent real findings surfaced by the same scan** (GrailKey
  Dispatch 05/06, 2026-08-07). Two Bone #1 books scanned back to back.

  **Strip 1 confirmed working, first production evidence.** Book 1:
  `[Q84] override-allowed reason=coherent-content tokens [cartoon,books]
  (>=3 member support each: [4,4])`, `[title-family] selected=bone`,
  `[identity] confirmed="bone" #1` — verified against `confirmedTitle` in
  the logs, not the card, per standing practice in this dispatch chain.
  The publisher/imprint-noise tokens ("cartoon," "books" — pool boilerplate
  from "Cartoon Books" imprint mentions) were routed to the variant-suffix
  path instead of corrupting the title, exactly as Strip 1 was designed to
  do. `[strip1-variant-routing]` itself did not fire on this scan because
  `confirmedVariant` was already populated ("signed nth print" from
  Vision) and that block is fill-only-if-empty — an acceptable non-fire,
  not a miss: the load-bearing half (keeping the tokens OUT of the title)
  worked regardless of which specific block absorbed them. Book 2 shows
  Strip 1's known limit, not a regression: Q140 admitted `[jeff,smith]` as
  coherent-content (not on the routing phrase list), so both tokens stayed
  in the title — `confirmedTitle = "bone jeff"` — and were then rejected
  by the pre-existing `[22c]` title-revote backstop as expected
  (`title rejections: ebay="bone" (expected "bone jeff"), vision="bone"
  (expected "bone jeff")`). The creator-recognition gate independently
  failed on the same input (`override-blocked reason=non-creator additions
  [jeff,smith]`) — see the registry-gap finding below; this is a separate
  mechanism from Strip 1/22c, not a second instance of the same bug.

  **GK-34 — mirror-image of GK-21, same root defect, not yet fixed.**
  Both books priced at $1,619.99 (real value ~$15-40). Root chain,
  verified directly in `src/lib/priceBands.js`:
  `[sold-verify] kept 1/21 (rejected 20: annualMismatch=1, gradeMismatch=4,
  stale=15)` left exactly one surviving sold comp — a genuine $1,619.99
  sale of a **1991 US first printing** — against a book that is actually a
  **later-printing UK edition** (£2.95, "signed nth print"). The Tier-2
  `activePoolSuspect` predicate (`priceBands.js:658-661`,
  `activeAvg > 0 && soldAvg > 0 && (activeAvg < soldAvg*0.25 ||
  activeLow < soldLow*0.25)`) compared that lone $1,619.99 sold comp
  against 18 active listings averaging $40.50, concluded the 18 actives
  must be the anomaly, and discarded them — `market = soldAvg` at line
  668. **Confirmed: neither this predicate nor its mirror-image sibling
  has any minimum-pool-size floor on the side doing the overriding.**
  `applyVariantFallbackDivergenceCap` (`priceBands.js:417-459`, the GK-21
  mechanism — 1 active listing previously overrode 28 solds) only checks
  `activePrices.length === 0` (line 423, i.e. "not empty," not "big
  enough") before letting a single active price cap/overwrite a
  sold-pool-derived result of any size. Both are pure ratio tests with no
  sample-size gate on the overriding pool — `n=1` carries the same
  authority as `n=18` or `n=28`. (By contrast, the sibling
  `activeAnchoredOverFallbackSold`/GK-31 branch, `priceBands.js:546`, and
  `isActivePoolVariantConfirmed`, `priceBands.js:298`, already DO enforce
  a `verifiedActive.length >= 3` / `< 2`-reject floor — precedent for the
  fix below already exists in this same file, just not applied to these
  two mechanisms.)

  **FIXED (2026-08-07, commit `2dbf651`) — greenlit with a revision to the
  original GK-34 proposal.** Shared constant `MIN_POOL_FOR_OVERRIDE = 3`
  (matching the GK-31/`isActivePoolVariantConfirmed` precedent),
  `priceBands.js`. **GK-21** (line 423, `applyVariantFallbackDivergenceCap`):
  shipped exactly as specced — `activePrices.length === 0` → `< 3`. **GK-34**
  (Tier 2 `activePoolSuspect`): the original 70/30-blend-fallthrough
  proposal was rejected before coding — 0.7×1619.99 + 0.3×40.50 = $1,146,
  still absurd for a $15-40 book, because a thin sold pool would still
  dominate the blend's arithmetic even without dominating it outright.
  Revised instead: when `soldPrices.length < MIN_POOL_FOR_OVERRIDE`, the
  weighting inverts — the active pool carries the price via the same
  ask-discount formula Tier 3 already uses (`activeAvg × 0.85`), and the
  thin sold pool is demoted to a reference annotation
  (`soldPoolTreatedAsReference`, I13-compliant: surfaced, never
  vaporized, never the anchor). **Verified against the real Bone #1
  numbers before shipping, per the acceptance-test requirement**:
  soldAvg=$1,619.99 (n=1), activeAvg=$40.50 (n=18) → market=**$34.42**,
  inside the specified $15–40 target. A sold pool that clears the floor
  keeps the original sold-only behavior — the ASM #17 contamination
  defense this guard exists for is untouched. Also added, per explicit
  request: `[pool-ratio-warn]` logging (observational, non-gating) on
  both mechanisms whenever an override fires with the overriding pool
  smaller than 1/3 of the overridden pool — n=3 clears the floor but
  isn't asserted as sufficient; this is what will show whether it is, in
  production. Regression: `tests/priceBands.test.js` — EX-A(c)'s "2.01x
  caps" fixture widened to a 3-comp active pool to keep testing the cap
  threshold now that it requires a floor-clearing pool (discovered while
  updating it: 3 identically-titled comps matching the confirmed variant
  word tripped `isActivePoolVariantConfirmed` and rerouted to the
  unrelated GK-31 branch — retitled to a non-matching title to keep the
  test on its original target); new dedicated test confirms a 1-comp
  active pool no longer caps at all, any divergence ratio. Baseline
  7-failure count (this doc's own documented pre-existing stale-suite
  list) unchanged before and after — zero regressions.

  **Upstream contributor to the GK-34 singleton, investigated, not yet
  addressed:** the `stale` filter in `verifySoldComps`
  (`src/lib/soldVerification.js:216-224`, thresholds at lines 61-68 —
  `MODERN_STALE_DAYS=90` for books ≥2000, `COPPER_STALE_DAYS=180` for
  1985-1999, no cutoff at all below 1985) rejected 15 of Bone #1's 21 raw
  sold rows. Bone #1 (1991) falls in the 180-day Copper tier. Git history
  shows this was tightened from a uniform 540-day window
  (commit `1e77516`, "Modern (2000+): 540d → 90d, Copper (1985-1999):
  540d → 180d") — a 3x cut for Copper, 6x for Modern — on an asserted-not-
  demonstrated rationale ("higher velocity markets... still active," no
  sales-cadence data cited). `tests/sold-verification.test.js`'s existing
  stale fixture only exercises day values that reject/keep identically
  under both the old and new thresholds (30/90 kept, 600/800 rejected) —
  the tightening shipped with no regression test pinning the new
  90/180-day boundary specifically. The vintage tier (`bookYear < 1985`)
  is explicitly exempted from rejection because "sold pools naturally
  thin" (`soldVerification.js:64`) — the same reasoning applies to a
  non-blockbuster Copper-era back issue like Bone #1 in a specific grade,
  which the current era cutoff doesn't protect. Not yet fixed or
  rescoped — flagged as the upstream manufacturer of GK-34-shaped
  singletons generally, not just this one book; any fix to the trust-
  decision floor above should be paired with re-examining this threshold,
  not treated as a full substitute for it.

  **Measurement attempt (2026-08-07), partial, honest result — does NOT
  answer "how many of the 48 ledger scans" as asked.** Queried live
  Vercel production runtime logs directly (`get_runtime_logs`, full-text
  search on `[sold-verify] kept`) rather than guessing. A `since=24h`
  window returned exactly 15 scans total; wider windows (`48h`, `4d`,
  `7d`) all timed out against this project's log volume before returning
  results — this tool cannot currently reach back far enough to cover an
  arbitrary 48-scan ledger without knowing which 48 requests those are.
  Of the 15 scans in the successful 24h sample, exactly 2 hit the `stale`
  filter at all — and both are the two Bone #1 scans from this exact
  dispatch (`kept 1/21 ... stale=15` / `kept 1/21 ... stale=14`,
  byte-matching the quoted log lines). Zero of the other 13 scans in the
  sample show any `stale=` rejection. This is consistent with either "the
  180-day cutoff mostly doesn't bite in practice, Bone #1 was unlucky" or
  "the ledger's other 46 scans mostly fall outside this 24h window and
  the sample is too small/recent to say anything" — 15 scans, 2 of which
  are the known-bad case, cannot distinguish those. **Does not clear the
  threshold change for a decision either way.** To get a real answer:
  either supply the actual 48 request IDs/timestamps being tracked so
  they can be queried directly, or accept a `deploymentId`-scoped,
  narrower-but-deeper query as a substitute. Threshold left untouched.
  **Parked (2026-08-07)** — not answerable from available logs, not worth
  further time until the right requests can be queried directly (request
  IDs/timestamps, or a `deploymentId`-scoped query). No further action
  pending new input.

  **Creator-registry gap, confirmed as a real audit (not a one-off name
  add) — "Jeff Smith"/"Cory Walker" class.** Traced the
  `override-blocked reason=non-creator additions [jeff,smith]` gate to its
  actual source: `applyDualAxisGate`
  (`src/lib/imageSearchIdentity.js:1455`, blocked-return at line 1593)
  computes `nonCreator` (line 1525) against `poolArtistTokens`
  (`extractPoolArtistTokens`, lines 1296-1314), which matches pool titles
  against `ARTIST_PATTERNS` — the canonical registry
  (`src/lib/compHygiene.js:370-442`, ~68 patterns, already named canonical
  by the Variant-artist-token-fusion entry above). **Root cause: neither
  "Jeff Smith" nor "Cory Walker" exists in `ARTIST_PATTERNS`, or in any of
  the other five creator-name-adjacent lists in the codebase** — a genuine
  absence, not a canonical-vs-drifted disagreement for these two names
  specifically. Full inventory: `ARTIST_PATTERNS` (canonical, ~68
  patterns); the `artistWords` Set inside `compHygiene.js`'s own
  `tokenizeTitle()` (lines 756-777, labeled "Q55-C: Full sync with
  ARTIST_PATTERNS" but confirmed stale — missing frison/giang/eom/lozano,
  all added to the canonical list after that sync comment was written —
  **a THIRD drifted copy, not previously named in this doc alongside the
  two the Variant-artist-token-fusion entry already tracks**
  (`sanitizeSeriesTitle`'s `NOISE_PATTERNS` in `identityCore.js:171`, and
  `stripVariantNoise` in `imageSearchIdentity.js:528-529`)); and
  `PREMIUM_CREATORS` (`src/lib/premiumCreators.js`, 84 entries — grown
  from the "80" this doc's own Premium Creator Credits section states,
  itself minor doc/code drift — architecturally separate, display-only,
  does not gate anything, should NOT be folded into a gating-list
  consolidation). "neal passenger" resolved as a false lead — not a named
  case, no dedicated registry: it's two adjacent words from an unrelated
  `imageSearchIdentity.js:1541-1547` comment ("'joker'/'iconic' rode along
  as **passengers** on **'neal'**'s recovery, Batman #251 class") about
  the generic token `"neal"`, already covered by existing test coverage.
  **Scoping note, not yet actioned:** this doc's own prior text (line
  ~927-931, Variant-artist-token-fusion entry) already flagged "extend
  this list as new named-variant patterns emerge" / "flag for a future
  pass if either [drifted list] surfaces its own production miss" — Jeff
  Smith/Cory Walker are exactly that trigger, now on its third instance
  (after Q119's title-whitelist and Q128's year-tolerance consolidations).
  Adding the two missing names to `ARTIST_PATTERNS` alone would fix this
  one instance but leave `artistWords`/`sanitizeSeriesTitle`/
  `stripVariantNoise` independently stale again, per the established
  pattern — a real consolidation (mirroring Q119's) is the request here,
  not a fourth patch. Not yet scoped as a concrete diff or implemented.

  **Consolidation attempt (2026-08-07) — started, deliberately stopped
  before coding. The three "drifted copies" are not as structurally
  uniform as the first-pass audit characterized; a byte-identical
  mechanical merge is not actually mechanical.** Read all three in full
  before touching anything:
  - `identityCore.js:171`'s `NOISE_PATTERNS[0]` strips bare, individual
    FIRST names (neal, john, jim, todd, chris, joe, steve, barry, alan,
    kaare) alongside surnames — `ARTIST_PATTERNS` has NO first-name
    entries at all (deliberately — this doc's own Q131 note explains bare
    single words are collision-risk-swept one at a time, first names
    being far more collision-prone than distinctive surnames). Replacing
    this list with an `ARTIST_PATTERNS`-derived regex would silently
    **stop** stripping "neal," "john," "jim," etc. — a real behavior
    regression, and specifically the kind of gap the "neal passenger"
    comment thread (`imageSearchIdentity.js:1541-1547`, referenced above)
    is adjacent to.
  - `imageSearchIdentity.js:528-529`'s `stripVariantNoise` list has the
    inverse problem: "raymond gay" and "stanley lau" appear in it but
    exist **nowhere** in `ARTIST_PATTERNS` — not as multi-word entries,
    not even as bare surnames. These aren't drift from the canonical
    list; they're names the canonical list itself is missing. Discovered
    as a direct byproduct of attempting this consolidation, not
    previously known.
  - `compHygiene.js:756-777`'s `artistWords` Set (inside `tokenizeTitle`)
    IS confirmed genuinely stale relative to `ARTIST_PATTERNS`'s own
    single-word entries specifically (missing `frison`/`giang`/`eom`/
    `lozano` — re-verified directly against the live file this session,
    matching the original audit) — but attempting to auto-derive it from
    `ARTIST_PATTERNS.map(p => p.source)` risks a different class of bug:
    several patterns use regex constructs that don't reduce to clean
    words (`/dell'?otto/i`, `/windsor.?smith/i`) — the existing hand list
    already has an unexplained artifact from this exact ambiguity
    (`'dekal'`, which is not a substring of `dell'?otto` or any other
    entry — likely a stale/mistaken addition from a past manual edit, a
    small live example of exactly the risk a scripted derivation could
    reintroduce silently).

  **SHIPPED (2026-08-07), the narrowed two-commit split — approved as
  proposed, with `NOISE_PATTERNS[0]`'s bare-first-name stripping and
  `stripVariantNoise`'s exact regex shape deliberately left untouched
  pending the design decision above (not a mechanical question).**
  Commit 1 (`e05b040`): closed the confirmed frison/giang/eom/lozano gap
  in `artistWords` directly (mechanical — catching up to what
  `ARTIST_PATTERNS` already recognized, not new recognition) and added
  `tests/artist-registry-sync.test.js`, asserting every single-word
  `ARTIST_PATTERNS` entry is actually stripped by `tokenizeTitle` —
  47/47 passing, would have caught this exact gap. Commit 2 (`47cf1e0`):
  added Jeff Smith, Cory Walker (the two real Bone #1/Invincible #1
  gaps), and Raymond Gay / Stanley Lau (the reverse gap this
  investigation found — present in `stripVariantNoise`, absent from the
  canonical list it was assumed to mirror) to `ARTIST_PATTERNS` as
  multi-word-only entries, each individually collision-swept (no bare
  `smith`/`walker`/`gay`/`lau` fallback — all four too generic alone,
  same convention as `guillem march`/`brett booth`); their last names
  also added to `artistWords` in the same commit, so the addition works
  in the tokenizer immediately rather than leaving a second gap for
  commit 1's guard to eventually catch. Extended the same test file with
  per-name checks (pattern match + tokenizer strip) plus a negative check
  confirming Jeff Smith stays multi-word-only — 56/56 passing. Full build
  clean both commits; adjacent suites (`comp-filter-hygiene`,
  `image-search-extraction`, `family-clustering`,
  `q130`/`q131`/`q133`/`q136`-named artist tests) all match their
  documented pre-existing baselines — zero regressions. Both deployed
  (`dpl_7kgVfL5M7dz8gdsbsfNTqKr1QFCM`, READY, production).

  **Reverse direction, SHIPPED (2026-08-07, `818037c`, GrailKey Dispatch
  09).** Commit 1's guard only checked one direction (`ARTIST_PATTERNS` →
  `artistWords`). Promoted `NOISE_PATTERNS[0]` and `stripVariantNoise`'s
  two creator-name regexes to module-level exports
  (`LEGACY_CREATOR_NOISE_WORDS` in `identityCore.js`;
  `STRIP_VARIANT_NOISE_CREATOR_NAMES_1`/`_2` in `imageSearchIdentity.js`;
  `artistWords` itself promoted and renamed `ARTIST_SURNAME_WORDS` in
  `compHygiene.js`) — pure extraction, zero behavior change, verified via
  a full regression sweep. Three reverse checks added to
  `tests/artist-registry-sync.test.js`: (1) `stripVariantNoise`'s 12
  names against `ARTIST_PATTERNS` — all pass; (2)
  `LEGACY_CREATOR_NOISE_WORDS`' 27 bare words against
  `ARTIST_SURNAME_WORDS`, with two documented, permanent exception
  classes (13 bare first names — `neal, john, jack, steve, barry, jim,
  todd, frank, alan, chris, joe, kaare, alex` — `ARTIST_PATTERNS`
  deliberately never carries these; `windsor`, a compound-surname
  fragment, neither a first name nor independently a surname); (3)
  `ARTIST_SURNAME_WORDS` itself against `ARTIST_PATTERNS`' raw regex
  sources (word-boundary-safe — a naive `\bword\b` test against a raw
  `.source` string false-negatives right at the `\b` anchor's own literal
  "b" character, a real bug hit and fixed while building this).

  **Found 4 new, real, previously-unknown gaps via check (2) — fixed in
  the same commit:** John Romita, Alan Moore, Chris Claremont, Joe Jusko
  — all legitimate, major, well-known creators entirely absent from
  `ARTIST_PATTERNS`, identical shape to Raymond Gay/Stanley Lau, just
  surfaced by the test instead of a production incident. Added as
  multi-word-only entries (individually collision-swept — no bare
  `moore`/`claremont` fallback, both have real ambiguity; `romita`/`jusko`
  kept multi-word for consistency within the batch rather than mixing
  conventions) plus their surnames into `ARTIST_SURNAME_WORDS`.

  **Found a second unexplained artifact via check (3), left deliberately
  failing, same as `dekal`:** `'spears'` in `ARTIST_SURNAME_WORDS` traces
  to no `ARTIST_PATTERNS` entry either — origin unknown, not documented
  anywhere. Per the explicit instruction that produced check (3), neither
  `dekal` nor `spears` is exempted or silently fixed. The test currently
  reports 153/155 — those 2 failures are the point, not a bug in the
  test. If a future investigation explains either, add it with a reason;
  otherwise the evidence points toward removing both.

  **First-name split — investigated (Dispatch 09), NOT coded, per
  explicit instruction.** The proposal: `LEGACY_CREATOR_NOISE_WORDS`
  conflates two different jobs — bare first-name stripping (genuine
  title noise, no creator-recognition intent) and surname stripping
  (creator recognition, ARTIST_PATTERNS' actual job) — and should split
  so each list has one clear purpose. Checked empirically, not assumed:
  of the 27 words, 13 are bare first names (`neal`/`john`/`jack`/...,
  listed above) and 1 (`windsor`) is the compound-fragment edge case;
  the remaining 13 are surnames (`adams, romita, kirby, ditko, smith,
  lee, mcfarlane, miller, moore, claremont, jusko, andrews, ross`) —
  **every single one of which is now, post-Dispatch-09, already a member
  of `ARTIST_SURNAME_WORDS`** (confirmed via direct set-difference query,
  zero remainder). **The split is clean, and better than a rename: the
  surname half doesn't need its own list at all — it can just import
  `ARTIST_SURNAME_WORDS` directly**, leaving `identityCore.js` with only
  a small, genuinely-standalone `BARE_FIRST_NAME_TITLE_NOISE`-style list
  (13 entries + `windsor` as a documented edge case) that has zero
  overlap with the creator registry and never will by design. This would
  eliminate `LEGACY_CREATOR_NOISE_WORDS` as an independent list entirely
  rather than just renaming it — one fewer hand-maintained structure, not
  a relabeled one.
  **One real caveat, not resolved, requires a decision:** `ARTIST_SURNAME_WORDS`
  is 60 entries; the current surname-stripping behavior in
  `sanitizeSeriesTitle` only ever exercised the 13 that happened to be
  hand-copied into `LEGACY_CREATOR_NOISE_WORDS`. Switching to import
  `ARTIST_SURNAME_WORDS` wholesale would widen what `sanitizeSeriesTitle`
  strips from raw titles to all 60 (`kirkham`, `suayan`, `forstner`,
  `albuquerque`, etc.) — a real behavior change for this specific
  consumer, not yet vetted against real title data the way the original
  13-word list implicitly was by years of production use. Recommend: if
  this split is greenlit, treat the behavior-widening as its own
  reviewable decision (possibly a separate flag/step), not a silent
  side effect of the rename. Not coded.

  **Two further real, independently-verified findings from the same
  scan, not yet actioned (surfaced, not requested for investigation this
  round):**
  - **Mega-key protection defeated by a publisher mismatch.** Bone #1 is
    in the mega-keys table, but `passesIdentityGates`
    (`api/mega-keys.js:1081-1103`) hard-rejects on any publisher
    disagreement (`entryPub && userPub && userPub !== entryPub`, line
    1097) with no fuzzy tolerance — logged as `[mega-key-match] rejected —
    publisher mismatch`. `confirmedPublisher` had been set to "Bonnier
    Carlsen" (a Swedish publisher) via a ComicVine volume-match issue,
    defeating the strongest available protection against exactly this
    class of mispricing on the one book most in need of it.
  - **`[q27]` correctly detects, but doesn't gate the path that mattered.**
    The foreign-edition flag (`api/enrich.js:10130-10134`,
    `out.foreignEdition = true`, logged `[q27] foreign edition detected —
    pc_estimate blocked`) fired correctly and, per its own design, blocks
    the `pc_estimate` (PriceCharting single-point lookup) path only. It
    does not gate the PriceCharting sales-history scrape /
    `verifySoldComps` pipeline (Ship #20a) — the actual path that
    supplied the $1,619.99 US-first-print anchor. The system detected the
    mismatch and the detection had no reach into the pricing path that
    used it.
  - **GK-29 recurrence, untracked.** `gradeMult=0.55` was displayed but
    not applied — `$1,619.99 × 0.55 = $891`, not the shipped price. Both
    books (VG 4.0 and VF 8.0) received the identical price despite
    different grades. Referenced as "again" in the dispatch (implying a
    prior, undocumented occurrence) — not yet given its own root-cause
    investigation in this doc; flagged here so it isn't lost, not closed.

  **GK-34 + registry, CONFIRMED IN PRODUCTION (2026-08-07, GrailKey
  Dispatch 10) — third and fourth validated fixes of this effort.** Both
  Bone books re-scanned on live production traffic, not the unit
  harness:
  ```
  [tier-2] SOLD POOL TOO THIN TO OVERRIDE — treated as reference, active pool anchors price:
           sold pool n=1 below MIN_POOL_FOR_OVERRIDE=3 — shown as reference (I13),
           active pool (n=2) used as pricing anchor instead
  [price-bands] source=tier2_active_dominant_thin_sold market=$10.49
  ```
  $1,619.99 → $10.49 and $13.51, exact arithmetic ($12.34×0.85=$10.49,
  $15.89×0.85=$13.51), real market $10-25. Same scan's `[Q84]
  override-allowed reason=same title, nothing added` and
  `confirmedTitle="bone"` (not "bone jeff") confirms the registry fix
  independently — Jeff Smith recognized, no override needed at all this
  time since Q140 didn't even try to add the tokens.

  **Found in the same batch — a real I13 provenance bug in the NEW GK-34
  path, fixed same-day (`b2d16ed`).** `api/enrich.js`'s `tierSourceMap`
  (~line 7367, `#20b-FIX1`) translates `priceBands.js`'s internal
  `source` values into the label the card displays, defaulting unmapped
  sources to `'pc_estimate'`. `tier2_active_dominant_thin_sold` was
  missing from this map — confirmed live: `[price-bands] source=
  tier2_active_dominant_thin_sold` (correct) immediately followed by the
  card showing `pc_estimate` (wrong). Not merely cosmetic: this exact map
  already has two documented prior incidents of the identical shape
  (`Q109-DISPATCH-1-B`, `Q109-D`, both inline in this file) where a
  missing entry fell through to `'pc_estimate'`, which sits inside
  `VARIANT_MULT_ELIGIBLE_SOURCES` (~line 7629) — an unmapped,
  already-active-anchored, already-0.85-discounted price is eligible to
  get a variant/key multiplier re-applied on top, double-counting. Fixed
  by mapping to the same semantic sibling those two prior fixes used —
  `'active_ask_derived'` (matches `tier3_active_discounted`'s
  construction: active-pool anchor, ask-derived, already discounted).

  **Reclassified and closed permanently (2026-08-07, GrailKey Dispatch
  11, `1699c2e`) — this was called a display defect; it wasn't.**
  `pc_estimate` is the default for any unmapped source, and it sits
  inside `VARIANT_MULT_ELIGIBLE_SOURCES` (~`api/enrich.js:7629`) — so an
  already active-anchored, already-discounted price was eligible for a
  variant/key multiplier re-application on top, the exact double-count
  this map exists to prevent. Three incidents of the identical shape
  (`Q109-DISPATCH-1-B`, `Q109-D`, this one) is a design gap, not a
  pattern of missed entries — closed with a completeness check instead
  of hoping for a fourth catch: `PRICE_BANDS_SOURCES` (the exhaustive
  list of every `source` value `priceBands.js` can emit) and
  `TIER_SOURCE_MAP` both relocated to `src/lib/priceBands.js` (not left
  in `api/enrich.js`, which does not cleanly exit when imported in a
  bare Node/test context — same reason `cacheKeys.js` exists) so
  `tests/tier-source-map-completeness.test.js` can assert every source
  has an explicit map entry (12/12 passing). Also added a
  `console.error` diagnostic in the handler itself for the case this
  test can't cover — an unmapped source actually reaching production
  before the next test run catches it — so the gap is loud at runtime
  too, not just at test time. "No silent default," both statically and
  at runtime.

  **Wolverine #37 — worst card in the batch, traced.** Two numbers from
  one request: `[price-bands] source=tier4_pc_estimate market=$5.09`
  followed later by `[verify] ... recommended: $99.99`. Traced directly:
  `recommendedPrice` (`api/enrich.js` ~line 8957) reads `finalPriceNum =
  parseFloat(out.price)` — so `[verify]` showing $99.99 proves `out.price`
  was ALREADY $99.99 by the time that log line ran, not $5.09. Between
  the `[price-bands-pricing]` log (~line 7443, where `out.price` is first
  set to $5.09) and `[verify]` (~line 8967), two floor mechanisms run:
  `computeThinPoolAnchor` (Ship #13.1, a CAP — cannot raise a price, ruled
  out) and `computeLowGradeFloor` (Ship #17, ~line 8078 — a genuine
  raise: "when pop.belowGrade===0, override with `rawComps.lowest`").
  `computeLowGradeFloor` is the only mechanism in that window capable of
  moving a price UP from $5.09 to $99.99, and its own log format
  (`[low-grade-floor] anchored cur=$X → comp.lowest=$Y`) matches the
  dispatch's own description ("a floor fired at 99.99 after the fact")
  exactly. **The card shows $99.99, not $5.09** — `out.price` is the same
  field both `[verify]` and the client read; nothing after
  `computeLowGradeFloor` in this trace lowers it back down. **CONFIRMED
  (2026-08-07)** — the `[price-trace]` line from the actual request
  supplies the direct evidence this entry originally lacked:
  `rawFloor: 99.99 floor: 99.99 floorFired: true`. `computeLowGradeFloor`
  fired, and its anchor came from `rawComps.lowest` in a comp pool built
  on the corrupted query. Root chain: the Greg Capullo registry gap
  (below) corrupted the search query (`confirmedTitle="wolverine greg
  capullo"`), which — being the same query construction `api/comps.js`
  uses to build BOTH the sold-comp pool (25/30 titleMismatch-rejected)
  and the active `rawComps` pool the low-grade floor reads
  `rawComps.lowest` from — pulled in wrong-book active listings whose
  lowest price is $99.99, which the floor then (correctly, by its own
  logic, on contaminated input) trusted as the real market bottom. This
  specific instance is closed by the registry fix below (a corrected
  query no longer feeds the floor a contaminated pool). **The general
  class stays open as its own standing finding, separate from this
  instance:**

  - **Floor-on-contaminated-pool class (open).** `computeLowGradeFloor`
    (and, by the same reasoning, `computeThinPoolAnchor` — any mechanism
    that derives a price from `rawComps` rather than from
    identity-verified sold/active pools) trusts whatever `rawComps`
    contains with no independent check that the pool itself is
    correctly-identified. Registry gaps are ONE way to corrupt the query
    that builds `rawComps` — closing them one name at a time (this week's
    9 additions) reduces how often this fires but does not close the
    class, since ANY upstream identity corruption (a title-family
    misfire, a wrong-issue consensus, any of the other classes already
    documented in this Pattern Library) feeds the exact same floor
    mechanism with the exact same blind trust. Not yet scoped as a fix —
    recorded here so a future "why did the floor anchor to a wrong price"
    report is recognized as this class, not investigated from scratch.

  **Registry gaps 5, 6, 7 — SHIPPED (`cb49224`), same shape as 1-4, found
  by production scans instead of the reverse-direction sweep this time.**
  Greg Capullo (Wolverine #37 — corrupted `confirmedTitle`, the direct
  cause of the trace above) and Jason Latour + Robbi Rodriguez
  (Spider-Gwen — `confirmedTitle="spider gwen latour rodriguez"`, both
  co-creators missing at once). All three added to `ARTIST_PATTERNS` as
  multi-word-only entries (no bare fallback — Rodriguez is one of the
  most common US surnames, Latour has real ambiguity with wine/place
  names, Capullo is plausibly bare-fallback-safe under this file's own
  precedent for distinctive names but deliberately not swept to keep this
  batch's risk profile consistent with the rest) plus their surnames into
  `ARTIST_SURNAME_WORDS`. `tests/artist-registry-sync.test.js` extended
  with all three (163/165 passing — `dekal`/`spears` remain the only, and
  only intended, failures). Both commits deployed
  (`dpl_FtwvjUjjWW8pgiNBoAPm2FpCqhTu`, READY, production). This is now
  five production-incident-driven additions plus four found by the
  reverse-direction test itself in one week — the registry's real
  completeness gap is likely still wider than either discovery channel
  has surfaced alone.

  **Seeding `ARTIST_PATTERNS` from ComicVine `person_credits` —
  investigated (2026-08-07, GrailKey Dispatch 11), PLAN ONLY, not coded.**
  Nine additions in one week across two independent discovery channels
  (five production incidents, four from the reverse-direction test) is
  the strategic signal this dispatch called it: one-at-a-time addition
  will not converge. The proposal — reuse data already being fetched,
  the same move that closed the publisher question — checks out on
  direct inspection, not assumption:
  - `api/enrich.js:609` already requests `person_credits` in the
    ComicVine issue-search `field_list` (has for a while — this is not a
    new API call).
  - `api/enrich.js:1219-1224` already parses it into a clean
    `personCredits: [{name, role}, ...]` array per match.
  - `docs/WHAT_WE_HAVE.md:96-100` confirms this data is currently used
    for exactly one thing: display-only "Creators" text on the metadata
    endpoint. It is fetched, parsed, and then discarded for registry
    purposes on every single scan.

  **Proposed plan, two phases, neither built yet:**
  1. **Live detection (near-zero cost, no new API calls, no pricing/
     identity behavior change).** On every scan that already returns
     `personCredits`, check each credited name against
     `ARTIST_PATTERNS` (reusing the exact substring-match logic
     `tests/artist-registry-sync.test.js` already uses) and log a
     structured line — e.g. `[artist-registry-gap] name="X" role="Y" not
     in ARTIST_PATTERNS` — for anything unrecognized. Purely additive
     instrumentation, same shape as the `titleOk`-failure and
     `pool-ratio-warn` logging already shipped this week; zero risk to
     pricing or identity resolution.
  2. **Periodic batch review (reuses existing tooling, no new
     infrastructure).** Query accumulated `[artist-registry-gap]` lines
     via the same Vercel `get_runtime_logs` mechanism already used for
     the stale-threshold measurement above, producing a ranked list of
     real, production-observed creator gaps — reviewed and added to
     `ARTIST_PATTERNS` in a batch sweep, the same discipline already
     established this week (multi-word-only by default, individual
     collision sweep before any bare single-word fallback), rather than
     waiting for the next book to misfire.

  **Explicitly NOT proposed:** a one-time bulk harvest that calls
  ComicVine's API against a broad catalog swath to pre-populate the
  registry wholesale. That would need new tooling, raises API-quota
  questions (`COMICVINE_API_KEY` is presumably rate-limited, exact limits
  not confirmed), and would scan mostly-irrelevant books — Option 1
  above gets the same data for free, scoped to exactly the books real
  users actually scan, with zero additional ComicVine calls.

  **Open questions, not resolved by this investigation:** should ALL
  credited roles feed the check, or only cover/artist-relevant ones? The
  week's own evidence argues for ALL roles — Alan Moore and Chris
  Claremont are writers, not artists, and both bled into titles exactly
  the way Jeff Smith and Cory Walker did; role does not predict whether a
  name shows up in a seller's listing title. Should gap-detection ALSO
  apply the multi-word-vs-bare-fallback risk classification
  automatically (flag common-word surnames for mandatory human review,
  auto-suggest distinctive ones), or should every detected gap go through
  the same manual judgment call this week's 9 additions did? Leaning
  toward the latter — the `'dekal'`/`'spears'` artifacts are a caution
  against trusting any mechanical classification of "safe to auto-add"
  without a human step. Not coded; both phases require their own
  greenlight before implementation.

  **Build/version skew across a single log batch — flagged, not a code
  issue.** Four different deployment SHAs appeared across one scan
  window: `0b46a52`, `3f0ed98`, `6979b4f`, `6af0698`. The Wolverine and
  Marvel Feature scans specifically ran on `6979b4f` — pushed BEFORE
  GK-34/GK-21 (`2dbf651`) — meaning their pricing behavior reflects a
  pre-fix build, not a regression against the fixes documented above.
  This is expected, ordinary client/CDN cache staleness (a phone or
  browser tab that loaded the app before a newer deploy went out keeps
  hitting the old bundle's API calls until it's reloaded or the cache
  expires) — not a deployment pipeline defect. Recorded here as a
  standing caution for reading any future multi-scan batch: **check the
  `[boot] Comic Vault build <sha>` line on every individual scan before
  attributing its behavior to the current code** — a batch spanning
  several builds can contain both pre-fix and post-fix evidence at once,
  and conflating them misreads which is which.

- **Dormant-multiplier class (GrailKey Dispatch 12, 2026-08-07) —
  investigated, PLAN ONLY, no code, pricing-math greenlight held pending
  review of the projection below.** Every tier-engine pricing source
  (Tiers 1/2/2.5/3 — i.e. every price actually derived from verified
  sold/active comps) is excluded from the newsstand/variant multiplier,
  and mostly excluded from the key multiplier too, while Tier 4
  (`pc_estimate`, the LEAST-verified generic PriceCharting lookup) is the
  primary source that DOES get both. This is backwards from what you'd
  want — multipliers apply most readily to the least-trustworthy price,
  not the best-verified one.

  **Part 1 — every `pricingSource` whitelist in the repo, enumerated by
  direct grep, not assumed to be "the two" originally suspected:**
  1. `VARIANT_MULT_ELIGIBLE_SOURCES` (`api/enrich.js:~7616`) — Set of 4:
     `pricecharting`, `pc_estimate`, `verified_active`, `browse_api`.
     Gates `isFromPC`, which gates BOTH the newsstand/era/variant
     multiplier directly AND (via `isFromPC && blendedAvg`) the PRIMARY
     key-multiplier path.
  2. Key-mult fallback inline check (`~7998`):
     `out.pricingSource === 'verified_sold' || out.pricingSource ===
     'verified_active'` — the SECONDARY key-mult path used when
     `isFromPC` is false.
  3. `SOLD_DERIVED_SOURCES` (`~8179`) — Set of 5:
     `verified_sold_recency`, `verified_sold`, `sold_active_blend_30`,
     `verified_sold_active_blend`, `verified_sold_stale`. Gates the
     mega-key-floor contamination-detection basis — a different purpose
     (not multiplier eligibility), but the same whitelist-drift shape.
     Checked against `TIER_SOURCE_MAP`'s current sold-tier outputs:
     **currently correct and complete**, not itself a gap.
  4. Web-search trigger gate (`~9247-9248`):
     `out.pricingSource !== 'verified_sold' && out.pricingSource !==
     'pricecharting'` — unrelated to multipliers (gates the AI web-search
     fallback), noted for completeness of the grep, not in scope here.
  5. `hasPCData = out.pricingSource === "pricecharting"` (`~8851`) —
     gates match-confidence display tier, not a multiplier, not in scope.

  **Part 2 — cross-referencing every real `out.pricingSource` label
  against whitelists 1 and 2 (the actual multiplier gates):**

  | pricingSource label | Tier | Newsstand/variant mult (whitelist 1) | Key mult (whitelist 1 or 2) |
  |---|---|---|---|
  | `verified_sold_recency` | 1 | ✗ excluded | ✗ excluded (exact-string mismatch — check wants literal `'verified_sold'`) |
  | `sold_active_blend_30` | 2 blend | ✗ excluded | ✗ excluded |
  | `verified_sold` | 2 sold-only / sold-only-suspect | ✗ excluded | ✓ eligible (whitelist 2) |
  | `verified_sold_stale` | 2.5 | ✗ excluded | ✗ excluded |
  | `active_ask_derived` | 3 (all sub-variants) + GK-34 | ✗ excluded | ✗ excluded — **this is the label all 3 confirmed-affected books hit** |
  | `pc_estimate` | 4 | ✓ eligible | ✓ eligible (via `isFromPC && blendedAvg`, if PC price present) |
  | `active_reference_range`, `thin_pool_anchor`, `visual_pool_fallback`/`visual_pool_family_isolated`, `catalog_ladder_reference` | non-tier real pricing paths | ✗ excluded | ✗ excluded |
  | `ebay-polybag-active` | polybag | ✗ excluded (deliberately — Ship 6 explicitly skips key mult on polybag pricing; correct, not a gap) | ✗ excluded (deliberate) |
  | `web_search_fallback`, `ai_estimate` | AI-estimated fallback | ✗ excluded | ✗ excluded (defensible — compounding an AI estimate with a premium multiplier is a real risk, not obviously a bug) |
  | `verified_active` | — | referenced in both whitelists but **dead code** — not in `PRICE_BANDS_SOURCES`, never directly assigned anywhere in the handler; a stale reference, plausibly meant to represent what `active_ask_derived` now covers |

  **Part 3 — impact projection, real production data, table form.**
  Pulled directly from live Vercel runtime logs (`get_runtime_logs`),
  not estimated. 2 of the 3 named books fully confirmed end-to-end; the
  third confirmed as a real request with the same root shape but its
  pricing-tail log lines could not be retrieved within reasonable query
  effort (truncated before the `[key]`/`[price-bands]` lines across
  multiple attempts) — reported as partial, not padded into a number:

  | Book | Grade | Tier / mapped source | Current price | Multiplier(s) dormant | Would-be price | Δ |
  |---|---|---|---|---|---|---|
  | Batman: The Killing Joke #1 | FN 6.0 | `tier3_active_discounted` → `active_ask_derived` | $52.19 | key ×1.5 (major: "first printing, classic Brian Bolland cover, seminal Joker origin story") | $78.29 | +50.0% |
  | Amazing Spider-Man #222 | FN 6.0, newsstand | `tier3_active_discounted_over_fallback_sold` → `active_ask_derived` | $10.31 | newsstand ×1.3 (variant mult skipped via whitelist 1) | $13.40 | +30.0% |
  | Giant-Size Chillers #1 | — | `active_ask_derived` (confirmed via identity/title logs) | not retrieved | key ×1.5 per original report | not retrieved | — |

  **Important nuance on ASM #222, found directly in its logs, not
  assumed:** its key multiplier did NOT skip via the whitelist-gap
  mechanism this dispatch is about — `[key] keyIssue: null major: false
  minor: false mult: 1 isFromPC: false` shows `out.keyIssue` itself was
  never populated for this scan, so `keyMult` was `1.0` by construction;
  the multi-key comp-derived detection did find the signal
  (`[key-from-comps] consensus: first-appearance/1st App×5`) but that
  mechanism is **display-only** (Ship #12a, `CLAUDE.md` "Multi-key
  extraction from comps" — promotion to `keyIssue` is Ship #12b, gated
  behind its own separate greenlight, never granted). So ASM #222's
  newsstand-multiplier loss IS the whitelist-gap class; its key-multiplier
  loss is a different, already-documented, separately-gated limitation —
  conflating the two would misdiagnose the fix's actual scope.

  **Part 4 — over-correction check: inconclusive, not cleared.** Neither
  confirmed example strikes an obvious "too high" note on a plain-market
  read ($78.29 for a raw FN 6.0 Killing Joke #1 — a well-known,
  consistently $75-150-raw back issue — reads as a correction toward
  accuracy, not past it; $13.40 for a raw FN 6.0 ASM #222 newsstand with
  a minor first appearance is unremarkable). **This is a qualitative
  read, not a verified one** — the actual PC price-ladder rung values for
  the confirmed grade on each book were not pulled (ASM #222's own logs
  confirm a real 12-rung ladder exists — `[pc-sales] id=2315254 grades=8
  ... ladder=12` — but not its dollar values). Before this multiplier
  ships, the ladder-rung comparison the dispatch asked for needs the
  actual numbers, not an eyeball read — flagged as not yet done, not
  quietly assumed clear.

  **Part 5 — structural fix, proposed, NOT coded.** Same discipline just
  established for `TIER_SOURCE_MAP` itself: stop hardcoding independent
  literal whitelists that can silently exclude a new source by omission.
  Concretely: restructure `TIER_SOURCE_MAP`'s values from plain label
  strings to small records carrying explicit eligibility flags (e.g.
  `{ label, variantMultEligible, keyMultEligible }`), and derive
  `VARIANT_MULT_ELIGIBLE_SOURCES` / the key-mult check FROM that
  structure instead of maintaining them as separate hardcoded Sets. A new
  tier source then can't be added without an explicit eligibility
  decision at the same time it's named — the same "no silent default"
  shape that closed the `TIER_SOURCE_MAP` gap itself.

  **Reframed explicitly (2026-08-07, GrailKey Dispatch 13) — this is not
  "add missing labels to a whitelist," it's an inverted trust model.**
  Every tier-engine source (real, comp-verified prices) is currently
  LESS eligible for a key/newsstand premium than `pc_estimate` (the
  least-verified source). The default direction going forward: **yes for
  both**, per-source, unless a specific source has a reason to decline —
  a verified sold pool for a key issue already reflects real market
  demand for that key (the comps ARE the premium), and a newsstand
  premium is a scarcity signal the comp pool cannot see on its own (nothing
  in an active-listing price tells you it's the rarer distribution
  channel) and therefore still needs to be applied externally regardless
  of how well-verified the base price is.

  **Approved in principle (2026-08-07) — plan-only, still gated on the
  ladder check below, not on anything else.**

  **Part 6 — the ladder-rung check, done. Split verdict — the multiplier
  does NOT clear cleanly.** Pulled the real PriceCharting price guide for
  both books directly (their public price-guide pages, not estimated),
  matched to the exact grade (6.0 = Fine, matching both books'
  user-supplied "FN 6.0"):
  - **Amazing Spider-Man #222 (1981)**, PC product id=2315254 (the exact
    product the real production request anchored to): **FN 6.0 rung =
    $20.80.** Projected price with the newsstand ×1.3 multiplier: $13.40
    — comfortably BELOW the rung (35% under). No over-correction; the
    multiplier moves the price toward the ladder, not past it. **Clears.**
  - **Batman: The Killing Joke (1988)**, PC product id=2405125 — the
    genuine 1988 first-print entry. Note: this exact product was NEVER
    surfaced by the app's own PC search query for this book at all (its
    candidate list only ever returned the 2018 Absolute anniversary
    edition and 2026 reprints, all correctly rejected on year grounds) —
    a separate, real gap (the app's PC query construction misses this
    product entirely) flagged here but not investigated further, out of
    scope for this dispatch. **FN 6.0 rung = $47.43.** Projected price
    with the key ×1.5 multiplier: $78.29 — **65% ABOVE the rung**
    ($30.86 over). This is the over-correction the ladder check exists to
    catch. **Does not clear.**

  **Verdict, per the explicit decision rule this check was set up to
  answer: 1.5× needs recalibration before it ships to every key in the
  collection.** The newsstand ×1.3 multiplier clears on its one tested
  book; the key ×1.5 multiplier does not, on the one book where a real
  ladder comparison was possible. Structural fix (Part 5) stays
  plan-only — approved in principle, but the specific 1.5×/1.2× key-tier
  multiplier values themselves are now confirmed miscalibrated for at
  least this tier/book combination and must not ship as-is. Recalibrating
  those values is itself pricing math and needs its own dedicated pass
  (likely a lower multiplier, or a cap relative to the ladder rung when
  one is available) before the structural fix's eligibility change is
  implemented — implementing eligibility correctly and then immediately
  overshipping the multiplier value would just move the over-correction
  from "silently skipped" to "silently applied wrong."

  **Dead-code cleanup, SHIPPED (`b30d4e7`).** `'verified_active'`
  confirmed genuinely dead (not in `PRICE_BANDS_SOURCES`, never assigned
  to `out.pricingSource` anywhere) and removed from both multiplier
  whitelists plus `TIER_SOURCE_MAP`'s own legacy pass-through. Two more
  independent references found in the same sweep, deliberately left
  untouched (different mechanisms, not multiplier eligibility, out of
  this fix's scope): `src/lib/responseContract.js`'s `ESTIMATED_SOURCES`
  Set + an inline `===` check, and `src/lib/dataQualityGuard.js`'s
  `PRICE_RANK` ordering table. `src/App.jsx`'s display label for this
  value was also deliberately left alone — legitimate backward-compat
  rendering for old catalogue items that may still carry this value in
  IndexedDB from before it went dead in the live pipeline, a display
  concern rather than a pricing gate.

  **Giant-Size Chillers — stays partial, no further effort spent**, per
  explicit instruction. Two confirmed books (one clearing, one not) was
  enough to answer the gating question.

  **Part 7 — SPLIT (2026-08-07, GrailKey Dispatch 14). Newsstand
  greenlit and SHIPPED (`3d5ec78`); key held.** The two
  multipliers had two different verdicts (newsstand clears, key doesn't)
  and were de-coupled rather than shipped or held together. Implemented
  in `api/enrich.js`: a new `isNewsstandMultEligible` flag
  (`NEWSSTAND_MULT_TIER_SOURCES` — the 5 tier-engine labels:
  `verified_sold_recency`, `sold_active_blend_30`, `verified_sold`,
  `verified_sold_stale`, `active_ask_derived`), checked independently of
  `isFromPC`. The outer variant-multiplier gate now reads
  `isFromPC || isNewsstandMultEligible`; internally, the era-aware
  newsstand branch runs under that OR, while the numbered/limited-run
  block and the entire flat `variantMultipliers` table (35¢/30¢, gold,
  triple/double cover, canadian, whitman, virgin, exclusive, etc.) were
  wrapped in an explicit `if (isFromPC)` so they stay on the original,
  narrower, untouched eligibility — none of those were ladder-tested this
  round. `isFromPC` itself, and everything it gates for the key
  multiplier (`isFromPC && blendedAvg` at the key-mult's primary path),
  is completely unmodified — key stays held by construction, not by
  convention. No dedicated unit test added (matches established practice
  for this exact inline handler logic — the two prior fixes to this same
  area, Q109-DISPATCH-1-B and Q109-D, also shipped on production-log
  verification rather than a unit harness, since the handler doesn't
  cleanly import into a bare test context); verify on the next real
  1985-1995 newsstand scan.

  **Part 8 — double-count hypothesis: investigated, hypothesis
  correction found, genuine test still open.** The proposed test
  ("compare $52.19, sold-derived, against the $47.43 rung") rests on a
  factual error worth catching before it shapes the recalibration:
  **Killing Joke's $52.19 is NOT sold-derived.** Its own production log
  states `[Q52-investigate] Batman: The Killing Joke #1: zero sold rows
  from PriceCharting` — zero sold comps existed for this request at all;
  `$52.19` came from `tier3_active_discounted` (7 active/ask comps ×0.85),
  the SAME `active_ask_derived` label the whole dormant-multiplier
  finding is about, not a sold-tier price. The evidence offered doesn't
  test "do sold comps already price in the key premium" — there's no
  sold data in this example to test that claim with. What it DOES
  support, more narrowly: active ASK prices for a widely-recognized key
  may already reflect elevated demand (sellers who know what they're
  listing price accordingly) — a real, plausible, but different and
  narrower finding than the one proposed.
  A genuine test of the original hypothesis needs a book that (a)
  actually has `out.keyIssue` populated (rare — established earlier this
  same dispatch that 10/10 scans in a 6h production sample had
  `keyIssue: null`) AND (b) priced via a genuinely sold-derived tier
  (1, 2, or 2.5 — `verified_sold_recency`/`verified_sold`/
  `sold_active_blend_30`/`verified_sold_stale`), so a real sold-average
  can be compared against the ladder rung directly. Neither confirmed
  example from Part 3 satisfies both conditions (Killing Joke: no
  keyIssue path relevant here since it's active-derived; ASM #222: real
  sold data existed — 27 verified comps, sold avg $7.77 — but no
  `keyIssue` was ever populated for it either, and its sold avg sits
  63% BELOW its own $20.80 ladder rung, which if anything argues against
  "sold data converges to ladder value" as a general rule, independent
  of the key question). **Not resolved — flagged as needing a genuinely
  matching example, not answered by the data in hand.** The theoretical
  case for excluding key-mult from truly sold-derived sources remains
  plausible on its own economic logic (a completed transaction for a
  recognized key already reflects whatever premium buyers paid), but
  that logic hasn't yet been tested against real matching data — treat
  it as a hypothesis worth keeping, not yet as a confirmed answer.

  **Part 9 — PC-product-discovery gap, elevated to its own standing
  finding.** Killing Joke's genuine 1988 first-print PriceCharting
  product (id=2405125, `https://www.pricecharting.com/game/2405125`) —
  the exact product whose ladder just settled the key-multiplier
  question — was **never returned as a candidate by the app's own PC
  search query** for this book at all. The real production log's
  `[pc-candidate]` list for this request contained only "Absolute
  Batman: The Killing Joke [30th Anniversary] #1 (2018)" and three 2026
  reprint/foil/blank entries — all correctly rejected on year grounds —
  never the plain 1988 base entry, despite it demonstrably existing on
  PriceCharting (found directly via their site search, 31 total results
  for "Batman The Killing Joke", of which the genuine 1988 entry is one).
  This means: **the ladder that just decided this dispatch's outcome was
  never available to the pricing engine itself** — Killing Joke priced
  via Tier 3 active-only specifically BECAUSE its own PC query never
  found a usable anchor, the same structural shape as the anchor
  rejection already visible in this exact request's own log
  (`[pc-anchor-gate] rejecting PC match ... no PC anchor for this book's
  actual edition`), just one layer further upstream — not a rejection of
  a found-but-wrong candidate, an outright miss of the right one. Root
  cause not yet investigated (query construction, PriceCharting's own
  search ranking for this specific product, or something else) — logged
  here as its own finding per explicit instruction, not folded into the
  ladder-check note it was originally attached to.

  **dekal/spears — unchanged, still the only two deliberately-failing
  entries in the registry sync test**, per explicit instruction (no
  action needed; recorded here only to confirm the standing state wasn't
  touched by this dispatch).

- **GrailKey Dispatch 15 (2026-08-07) — six identity/pricing fixes, three
  shipped, three designed-not-coded, plus a cover-matcher investigation.**
  ~14 production scans this dispatch, all production-observed evidence.

  **Fix 1 SHIPPED (`2c11377`) — `extractConsensus`'s `titleOk` bar lowered
  0.30 → 0.15** (`src/lib/imageSearchIdentity.js`). Two confirmed live
  misses at the old bar (Wha...!? #1 5/20=0.25, Power Rangers #1
  4/20=0.20) — both indie titles whose pools legitimately can't reach 30%
  title-string agreement, which silently disabled the downstream
  vision-zero-support OVERRIDE/ESCALATE check exactly on the thin/
  scattered pools most likely to need it. Issue consensus keeps its own
  separate 50% bar untouched — lowering titleOk alone cannot adopt a
  wrong issue on an incoherent pool, it only stops discarding the
  zero-support signal outright. Verified against the full
  extractConsensus-touching regression battery (9 suites); one real,
  understood side effect found and handled: two Adventure Time SS #1
  assertions (`tests/q141b-shared-issue-extractor.test.js`,
  `tests/q141c-marketplace-category-rejection.test.js`) were pinned to
  the old null return and flipped to a real (safe, `noIssueConsensus`)
  object — confirmed inert in production because
  `familyAuthoritySkip` (`identityCore.js` ~2170) already resolves that
  exact book via family-scoped consensus before the raw-pool check this
  object feeds ever runs. Both pre-existing documented-baseline failure
  counts (image-search-extraction: 2, q-adv397-visual-guard: 5)
  unchanged.

  **Fix 2 SHIPPED (`368f4d0`) — vision-zero-support ratio floor, not
  exact zero.** `visionIssueCount === 0` was an equality test. Real case
  (Jetsons, Dispatch 05 item 2): Vision's "#10" had 1/19 = 5.3% raw-pool
  support — not literally zero — so the escalation never fired and the
  book shipped under the wrong issue (#10 instead of the correct #32,
  market $9.95–$16.00). New shared `isIssueZeroSupport(count, total)`
  helper (`identityCore.js`, `ISSUE_ZERO_SUPPORT_RATIO_FLOOR = 0.10`)
  replaces the equality check at both call sites — `resolveIdentity`'s
  OVERRIDE/ESCALATE gate and `extractConsensus`'s
  `zeroSupportNoAdoption` carve-out — one source of truth instead of two
  independently-maintained checks. Scoped to the issue axis only, per
  explicit dispatch scope: the sibling `visionPublisherCount` check and
  `resolveFamilyIssueConsensus`'s own pure aggregate-vote adoption logic
  (the Flash #139 standing constraint) are untouched. Verified against
  18 suites / ~1,100 assertions, zero new failures.

  **Fix 3 SHIPPED (`184675a`) — registry additions.** Greg Land
  (`ARTIST_PATTERNS`, `compHygiene.js`) — Wolverine #10 scan corrupted
  `confirmedTitle` to "wolverine greg land," rejecting 26/27 genuine
  sold comps; a real eBay search for the correct book returns 5+
  listings ($4.99–$19.99, median ~$13.85) vs. the 1 GrailKey found priced
  at $9.99. Multi-word ONLY, no bare `/land/i` — deliberately also NOT
  added to `ARTIST_SURNAME_WORDS` (the `tokenizeTitle` strip-list),
  unlike this batch's precedent (Capullo/Latour/Rodriguez/etc. all got a
  surname-list entry) — "land" as a standalone token appears in real
  comic titles ("No Man's Land"), a materially higher collision risk for
  a strip-list than a surname like Moore/Walker; the reverse-sync test
  only requires single-word `ARTIST_PATTERNS` entries to have a surname
  counterpart, so this is not a test gap. Bruce Hershenson
  (`KNOWN_PUBLISHER_IMPRINT_EVENT_PHRASES`, `imageSearchIdentity.js`) —
  Wha...!? #1's `confirmedTitle` corrupted to "wha hero hershenson,"
  every comp query zero-matched; not a publisher/imprint/event in the
  strict sense this list is named for, reused anyway rather than forking
  a fifth near-identical list for one entry.

  **Fix 4 DESIGNED, NOT CODED — issue adoption bar for the zero-support
  override.** Real case: Spawn #350 (Vision) → pool consensus adopted
  #369 at 9/17=53% winner share, reported `[22c] convergence=90
  tier=HIGH`. Real answer: #360D (Brett Booth 1:50 virgin variant),
  which never appeared in the pool at all — a cover-image-only variant
  with no masthead text a title-based reverse-image search can surface.
  Two distinct, independently-confirmed root causes:
  1. The OVERRIDE branch (`identityCore.js` ~2194) adopts `ebay.issue`
     whenever non-null, and `ebay.issue` is set by `extractConsensus`'s
     plain `issueOk >= 0.5` bar (`imageSearchIdentity.js`,
     `agreement.issue = issueResult.count`) — a 53% winner over a close
     runner-up is treated identically to a 95% landslide. No
     margin-over-runner-up signal exists anywhere in this path today.
  2. `[22c]` convergence (`src/lib/convergenceScore.js`,
     `computeConvergenceScore`/`applyIdentityConflictDemotion`) is a
     genuinely separate, uncoordinated scoring mechanism from
     vision-zero-support's own `matchConfidenceDemote`/`visionZeroSupport`
     flags — those are consumed only by the `finalMc` match-confidence
     cap at `api/enrich.js:8663`, computed hundreds of lines AFTER `[22c]`
     runs (`api/enrich.js:3759-3803`). `applyIdentityConflictDemotion`'s
     only existing input is `familyDecision==='refused-identity-conflict'`
     — it has never been told "this axis's value came from an
     unsupported-claim override," so a confidently-reported HIGH tier can
     sit directly on top of an override the system itself flagged as
     uncertain.

  Proposed design (not implemented): (a) extend `extractConsensus`'s
  issue tally with a runner-up count (new sibling to `getMostCommon`,
  e.g. `getTopTwo`), exposed as `agreement.issueRunnerUpCount` — a pure
  aggregate count, no rank-weighting, Flash #139-constraint-compliant.
  (b) In the OVERRIDE branch specifically (not the general `issueOk`
  report used elsewhere), require `issueWinnerRatio >= 0.75 AND
  (issueWinnerRatio - issueRunnerUpRatio) >= <margin, candidate 0.20>`
  before adopting; below that bar (including the current 50–74% adoption
  band), fall through to the ESCALATE branch (`confirmedIssue = null`,
  `ID_REQUIRED`) instead of silently adopting a bare-majority winner —
  strictly more conservative, per the standing "conservative direction
  preferred when uncertain" rule. (c) Thread `visionZeroSupport`/
  `matchConfidenceDemote` into `applyIdentityConflictDemotion` as a
  second demotion input alongside the existing family-conflict cap, so
  an override/escalate always caps convergence to LOW/≤69 directly
  rather than relying on the axis-disagreement side effect that
  currently only sometimes drags the score down. Open before landing:
  confirm the exact adoption-margin number against real captured pools
  (same discipline as Fix 2's ratio floor and Dispatch 14's ladder
  check, not guessed blind); confirm scope stays confined to this
  OVERRIDE branch, never touching `resolveFamilyIssueConsensus`'s own
  adoption bar.

  **Fix 5 DESIGNED, NOT CODED, RE-SCOPED — pool overriding a "not a
  comic" verdict.** Investigation found the dispatch's literal framing
  doesn't match current code: `assetTypeConfident`
  (`api/enrich.js:2402-2420`, `:7328-7334`) has been advisory-only since
  Q110 — it sets `listingHardLocked` (List button gated) but does NOT
  block title/issue extraction, the eBay visual-pool search, or pricing;
  all of those already run unconditionally regardless of this flag. The
  real damage the dispatch describes (Vision returns no issue at all)
  is a Vision-output-shape problem upstream of this gate, not something
  the gate itself causes. Re-scoped design: reuse the EXISTING Q32
  category-vote machinery (`inferAssetTypeFromCategories`,
  `imageSearchIdentity.js:428-467`, wired at `api/enrich.js:3428-3445`)
  that today only detects merchandise contamination (`merchandiseRatio
  >= 0.5` → hard `DO_NOT_LIST` block) — extend it to also tally
  comic-category votes, and when `!assetTypeConfident` but the pool
  independently shows strong, title-coherent comic-category agreement
  (candidate bar: `>=5` comic-category listings, `>=60%` ratio, plus
  reusing `extractConsensus`'s own title-coherence check on the same
  pool so a scattered pool of unrelated comic-category junk can't force
  an override), flip the advisory lock off before it fires. Must be
  strictly additive to the Q32 merchandise hard-block, never able to
  override it. Open before landing: one real captured Vision JSON
  response for a genuine "not a comic" virgin-variant misread, to
  confirm whether `issue` comes back null vs. a stale wrong value
  (determines whether this is a display/lock-only fix or also needs to
  feed a corrected issue back into `resolveIdentity` — though the
  now-shipped Fixes 1–2 already improve that path independently);
  threshold numbers are placeholders pending real-pool validation.

  **Fix 6 DESIGNED, NOT CODED — pool year hint feeding `resolveYear`.**
  Confirmed real and currently narrow: `poolYearHint`
  (`api/enrich.js:2659-2678`, >=3 pool items / >=50% agreement) is
  computed early but today feeds ONLY ComicVine volume-disambiguation
  scoring and two narrow conflict-detection checks — never `resolveYear`
  itself (`identityCore.js:2787`), whose 4th argument (`ebayYear`) is
  bound to the separate, stricter `ebayYearAuthoritative` (>=10 items,
  >=8 agreeing). Proposed design: thread `poolYearHint` into `resolveYear`
  via a new branch inserted between existing branch (a) (`ebayYear`,
  kept top-priority — already vetted at a stronger bar) and branch (b)
  (pc+cv agreement), firing ONLY when there is no Vision/user year at
  all (`!visionYear && !userYear`) and `poolYearHint.agreement >= 0.80`
  — deliberately narrower than the raw 50%-bar computation, applied only
  at this consumption point so the two existing looser-bar consumers are
  untouched. This targets exactly the documented gap in the "Year
  override guard" section above (branch (e)'s "no year at all" hole) and
  never overrides an actual Vision-asserted year, unlike Fix 4's
  issue-override territory. New `yearSource = 'pool-year-hint'` needs an
  explicit `PROVEN_SOURCES` classification decision (candidate:
  `'unproven'`, same tier as `vision-fallback` — a raw title-text tally
  is a weaker source than the independently-verified sources that
  currently earn `'proven'`). **Found a real inconsistency in the
  dispatch's own evidence, not silently resolved either way:** the
  dispatch cites two production instances — "year=2019 agreement=80%
  (4/5)" and "year=2024 support=3/4" — but 3/4 is 75%, not >=80% as the
  dispatch's own proposed bar states. Either the bar needs to be >=75%
  to cover both cited cases, or the second case is expected to still
  fail and escalate under an 80% bar. Needs an explicit decision before
  coding, not a guess.

  **Cover-matcher investigation — PLAN ONLY, no code, per explicit
  scope.** Six virgin/sketch variant scans this dispatch, zero correct
  identifications (three scans of the same book alone returned #351,
  #293, #369 — correct answer #360D). Researched, not assumed:
  - **GCD (comics.org) API** — public JSON endpoints, no auth challenge.
    Variant linkage exists as data (`variant_of_id`, `is_variant` fields
    on the issue model) — i.e. variant covers ARE distinct records,
    filterable by series/year via the series walk. Data/metadata is
    CC-BY-SA (commercial use with attribution permitted). Two real
    caveats worth flagging before building on this: (1) GCD explicitly
    prohibits bulk image distribution and aggressive scraping — cover
    images are hosted under fair-use for on-site identification, a
    materially different (and murkier, for a commercial third-party app)
    legal footing than the CC-BY-SA metadata; a production integration
    needs its own light-touch usage review, not an assumption that the
    data license covers the images too. (2) The app guidelines page
    (`docs.comics.org/wiki/App_Guidelines`) returned HTTP 403 on a
    direct fetch during this investigation — confirm current terms
    directly before integrating, this doc is relaying search-result
    summaries, not a verified primary read. Community guidance (not
    official docs) suggests conservative concurrency (~8 parallel issue
    fetches, 200ms/series-page and 50ms/issue-fetch delays) to stay
    within polite-use norms on the community-run server.
  - **ComicVine's `image` field** — per existing public documentation
    and community reports, models one primary image per issue record;
    variant covers are inconsistently catalogued (sometimes as separate
    issue objects with a lettered issue_number suffix, often not at
    all) — not a reliable variant-cover source on its own, consistent
    with this codebase's own existing experience (`deriveCvYear`,
    `comicVine.volume` shape bugs elsewhere in this doc already
    established ComicVine's data as inconsistent in adjacent ways).
  - **Narrowing — confirmed already possible without new extraction
    code.** The dispatch worried Booth's variant/artist tokens are
    invisible at the point an issue would resolve, since
    `tokenizeTitleFamily` (`imageSearchIdentity.js:920`) strips
    `ARTIST_PATTERNS` matches (including `/brett booth/i`, already
    registered) from the family-clustering title key — by design, the
    Black Cat/Skottie Young class protection. Confirmed this does NOT
    lose the data: `extractVariantTokens(rawTitle)` is computed and
    stored per-row independently (`imageSearchIdentity.js:407`,
    `row.variantTokens`), untouched by the family-title stripping. A
    cover-matcher candidate-narrowing step can reuse
    `row.variantTokens`/`extractArtist` directly to scope a candidate
    set to series + artist + year, without touching the existing
    stripping behavior that a different, load-bearing fix depends on.
  - **Image hashing** — `jimp` (`^0.22.12`) is already a dependency,
    currently used only for resize/JPEG-quality reduction before the
    Vision API call (`api/grade.js:413-428`), not for any hashing today.
    Jimp's own API includes a perceptual-hash method and a
    hash-distance comparator, which would need a small spike to confirm
    behavior/accuracy on real comic cover photos (cover art has very
    different structure than the photography Jimp's hash is typically
    validated against) before relying on it — not yet spiked.
  - **Failure mode, per explicit instruction:** strict threshold,
    `ID_REQUIRED` below it, never a guess. A cover-matcher would be a
    NEW identity authority requiring an explicit rank in the existing
    authority matrix (`decideFieldAuthority`, `identityCore.js:1444`) —
    not scoped further than that here; where it ranks relative to
    Vision/eBay-consensus/family-clustering is a design decision for
    when this moves from investigation to a real proposal.
  - **Explicitly not scoped into this dispatch's six fixes** — ships
    independently, per instruction.

