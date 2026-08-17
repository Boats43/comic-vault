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

  **Margin validation attempt (2026-08-07, GrailKey Dispatch 16) — one
  anchor confirmed, one anchor confirmed VACUOUS, still NOT CODED.**
  Pulled both cited anchors directly from live Vercel production runtime
  logs, not re-derived from the dispatch's own summary:
  - **Spawn #369 (2026-08-07 04:51:10 UTC, `/api/enrich`) — must-fail
    case, confirmed as specced.** `[visual] consensus: issue=369 (9/17)
    visionIssueCount=0`, `[vision-zero-support] OVERRIDE: Vision
    issue="350" has 0/17 pool support — adopting pool #369`, `[22c]
    convergence=90 tier=HIGH`. Raw-pool winner share is 9/17=52.9% (just
    clears the existing `issueOk >= 0.5` bar); the family-scoped
    consensus separately reports `ratio=0.75 uniqueRows=8 runnerUp=366`
    — a different, stricter computation over deduplicated rows, not the
    number the OVERRIDE branch actually reads. Under the proposed design
    (`>=0.75` winner AND `>=0.20` margin over runner-up, both computed on
    the SAME basis the OVERRIDE branch consumes), this adoption would
    correctly fail to clear and fall through to ESCALATE — confirms the
    bug is real and the proposed gate closes it on the exact case that
    motivated it.
  - **Tomb of Dracula #17 (2026-08-07 04:23:00 UTC, `/api/enrich`) —
    confirmed VACUOUS, does not test this branch at all.** `[visual]
    consensus: issue=17 (20/20) visionIssueCount=20`, `[vision-zero-
    support] SKIPPED reason=winning-family-authority mode=corroborated
    issue=17 population=8 support=8 ratio=1.00 rawPoolVisionSupport=20`.
    Vision's own issue had full raw-pool support, so `familyAuthoritySkip`
    exempted this scan from the zero-support check entirely — the
    OVERRIDE branch this fix targets never ran. This anchor can confirm
    Fix 4 doesn't regress a clean-agreement scan, but cannot validate the
    margin gate's pass side, since the gate it would sit inside never
    engaged.
  - **Searched for a natural third anchor, found none.** Queried
    production logs for every `[vision-zero-support] OVERRIDE` firing
    over the trailing 3 days (`get_runtime_logs`, full-text + grouped
    count) — exactly 1 result, the Spawn #369 scan above. No production
    scan in this window shows the shape Fix 4's "must pass" side needs:
    Vision issue with near-zero pool support, where the ADOPTED pool
    consensus itself is a landslide (candidate: `>=0.90` with a clear
    runner-up gap). **Fix 4 stays DESIGNED, NOT CODED — blocked on a
    genuine must-pass anchor, not on the margin number itself.** Coding
    against only a must-fail example risks tuning the gate to reject
    everything rather than to discriminate; a landslide OVERRIDE case
    needs to actually pass once one is captured, either from a future
    production scan or (if the wait is unacceptable) a synthetic pool
    constructed and explicitly flagged as synthetic rather than presented
    as production-validated.

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

  **RESOLVED (2026-08-07, GrailKey Dispatch 16) — bar set to >=0.75, not
  >=0.80. Still DESIGNED, NOT CODED.** Both cited production instances
  (year=2019 at 4/5=80%, year=2024 at 3/4=75%) were confirmed correct
  identifications — an 80% bar would silently exclude the second, correct
  case to hit a round number, and this branch only fires when there is no
  Vision year at all, so the alternative for that case is the book
  blocking entirely rather than resolving. `yearSource = 'pool-year-hint'`
  confirmed classified `'unproven'` (same tier as `vision-fallback`) — a
  raw title-text tally is weaker than the independently-verified sources
  that earn `'proven'`. Still not coded — this closes the bar-selection
  question only; implementation is unstarted.

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
  - **GCD terms verification attempt (2026-08-07, GrailKey Dispatch 16)
    — BLOCKED, primary source unreachable, gate stays closed.** Per
    explicit instruction, attempted to read GCD's terms directly rather
    than relay the search-summary caveat a second time. Every path tried
    failed:
    - `docs.comics.org/wiki/App_Guidelines` — HTTP 403 (repeat of the
      original finding, re-confirmed).
    - `docs.comics.org/wiki/API_Terms` — HTTP 403.
    - `www.comics.org/about/` — HTTP 403.
    - `www.comics.org/` (bare root) — HTTP 403. This confirms the block
      is domain-wide (both `docs.` and `www.` subdomains, including the
      bare root), not a permissions issue on one specific page — reads as
      a bot/WAF block on this fetch tool generically, not a
      terms-specific restriction.
    - A web.archive.org mirror of the App_Guidelines page — refused
      outright at the tool level ("unable to fetch from web.archive.org"),
      not a site-specific 403.
    - `github.com/GrandComicsDatabase/gcd-django` (the Django application
      repo) — reachable, but its GPL-3.0 license badge covers the
      **application code**, not comics.org's site content, images, or
      API data; conflating the two would be a real category error, not a
      substitute answer. No terms-of-use text present in the visible
      README/LICENSE excerpt.
    - `github.com/GrandComicsDatabase/gcd-django/wiki/API` (GitHub-hosted
      wiki, reachable) — contains only a rate-limit note ("accessible for
      anonymous users with some limits... larger limits" for logged-in
      users, no numbers given); zero licensing or image-usage terms.
    **Conclusion, stated plainly rather than re-summarized from search
    results: no path available to this session can reach GCD's actual
    terms.** The image-licensing question this gates — whether cover
    images fall under the same CC-BY-SA the metadata carries, or under a
    narrower fair-use-for-identification basis as the original
    search-summary suggested — remains unverified from a primary source.
    Cover-matcher stays blocked on this exactly as before; the entire
    feature is gated pending terms obtained through a different channel
    (a logged-in browser session, a direct GCD contact, or equivalent).
  - **GCD terms obtained via external channel (2026-08-07, GrailKey
    Dispatch 17) — supersedes the "BLOCKED" finding above.** Obtained and
    read directly by the user (not this session's fetch tool, which
    remained blocked) — GCD App Guidelines page (`docs.comics.org` wiki),
    last edited 2022-01-02. **Evidence-quality caveat, stated explicitly
    rather than glossed over:** only one sentence was passed through as
    an exact quote; the three findings below are the user's own summary
    of the page, not a second verbatim transcript. Recorded as such —
    the one verbatim sentence quoted, the rest marked reported —
    consistent with this file's own standing discipline elsewhere
    (confirm via direct evidence, don't present a paraphrase as a
    primary read). A true verbatim archive of the full page is still
    outstanding; add it here if it becomes available.

    **Verbatim quote:** "We don't offer access to our data via an API,
    only as a database dump download."

    **Reported findings (paraphrase, not verbatim):**
    1. **No API exists.** Confirmed by the quote above. Intended
       consumption pattern per GCD: download the database dump, import
       it into your own store, build your own query layer against it,
       refresh periodically.
    2. **Images ARE permitted under fair use for identification**, with
       a named compliant pattern GCD points integrators to (the CBI case
       study): check local cache → check back-end cache → fetch the
       single image on demand → archive it permanently. This is a
       narrower basis than the CC-BY-SA metadata license, and a
       materially different *pattern* than bulk retrieval.
    3. **CC-BY-SA attribution is a hard requirement** on the metadata:
       visible credit to Grand Comics Database plus a link back to the
       specific source page, on any UI surfacing their data. ShareAlike's
       interaction with a commercial pricing product is a separate
       question from attribution and is NOT resolved by this finding.

    **Re-scoped plan, PLAN ONLY, no code — three changes from the
    original Dispatch 15 sketch:**
    1. **No live API → local dump import, not a live-query integration.**
       The original sketch ("GCD API — public JSON endpoints") was
       wrong; there is no API to call at request time. This means: (a)
       download and import GCD's DB dump into a store this project
       controls, (b) build a query layer over that import, (c) refresh
       on some cadence (release frequency not established — open
       question). This is a genuinely different category of work than
       "call an endpoint" — it's a new data-ingestion pipeline plus
       wherever it lives long-term. Concretely against this codebase:
       the Stack section states "no server database," but production
       logs show an active `[kv-cache]` layer already caching ComicVine/
       PriceCharting/eBay lookups in production right now (`SET`/`MISS`
       lines on nearly every `/api/enrich` request) — meaning some
       server-side KV already exists and is provisioned, contradicting
       the "Future: Vercel KV for cross-instance rate limit persistence"
       framing as not-yet-done elsewhere in this doc (flagged here as a
       doc/reality drift worth reconciling separately, not fixed in this
       pass). That existing KV is a plain key-value store, not a
       relational one — adequate for flattening the dump into precomputed
       lookup keys (e.g. `gcd:covers:<series>:<issue>` populated once at
       import time), NOT adequate for arbitrary relational queries
       (fuzzy series matching, joins across variant/series/publisher
       tables) the way the raw dump itself supports. Two real options,
       neither scoped further than naming them: (i) flatten the dump to
       the specific lookup shapes this feature needs and load those into
       the existing KV — smaller lift, less flexible; (ii) provision a
       real relational store for the dump via the Vercel Marketplace
       (Neon Postgres is the natural fit per current Vercel offerings)
       — bigger lift, keeps the dump queryable on its own terms. This
       decision needs its own scoping pass, not a default pick here.
    2. **Bulk-hash spike → per-lookup fetch with permanent archival.**
       The original idea ("pull a series' variant covers to hash") is
       exactly the bulk-retrieval pattern GCD's terms don't cover —
       re-scoped to the CBI pattern instead: at scan time, narrow to a
       small candidate set using data already available locally (the
       dump-derived series/issue/variant match, refined by
       `row.variantTokens`/`extractArtist`, both already confirmed
       reusable per the Narrowing finding above), THEN fetch only those
       specific candidate images one at a time, checking local cache and
       back-end cache first, archiving each fetched image permanently
       once retrieved.

       **Vercel Blob question, sharpened (2026-08-07, GrailKey Dispatch
       18) — explicitly unresolved, do not assume equivalence.** The
       CBI pattern GCD points to describes caching to your OWN back-end
       — an internal application cache, not visible to the outside world
       as a re-served copy. Vercel Blob, even on private access, is a
       distinct third-party cloud storage/CDN product with its own
       delivery infrastructure — storing an archived GCD image there is
       plausibly a materially different act than an in-process or
       same-service cache, and GCD's terms (as reported so far) don't
       speak to that distinction one way or the other. Treat "cache to
       our back-end" and "re-host in a blob store" as two different
       claims until reviewed, not two names for the same thing. Default,
       pending that review: **private access only, never public** — a
       publicly-reachable Blob URL for an archived GCD image is the
       closer of the two to redistribution, and redistribution is
       exactly what the fair-use-for-identification basis does NOT
       obviously cover. Do not provision or wire up Blob storage for
       this feature until this specific question — internal cache vs.
       third-party-hosted archive, under GCD's actual terms — has an
       answer.

       The `jimp` perceptual-hash spike (still not done)
       now scopes down to hashing individual on-demand-fetched images
       against a narrowed candidate set, not building a pre-hashed index
       of an entire series' variant covers.
    3. **Attribution — new UI surface, not yet designed.** Any card
       showing GCD-sourced data (metadata now, images later if the
       fair-use pattern above ships) needs a visible "Grand Comics
       Database" credit and a link back to the specific GCD source page
       — a real, unscoped UI addition, not a footer-once fix, since
       CC-BY-SA attribution conventionally travels with the specific
       data shown, not just a blanket site-wide mention. ShareAlike vs.
       the commercial pricing model is a legal/product question flagged
       for explicit human review — not something to resolve by
       implementation choice.

    **Net effect on scope: materially larger than the original Dispatch
    15 estimate.** The original sketch treated this as roughly
    "call GCD's API, add a hash spike." The actual requirement is a
    data-ingestion pipeline (dump download + import + refresh cadence +
    a storage decision), a request-time fetch-and-archive pattern
    instead of a pre-built index, and a new attribution UI surface — three
    separate, real pieces of infrastructure work, each needing its own
    scoping before any of this becomes buildable. Cover-matcher remains
    plan-only; nothing here is coded.
  - **Explicitly not scoped into this dispatch's six fixes** — ships
    independently, per instruction.

- **GrailKey Dispatch 19 (2026-08-07) — Spawn #351 real scan, four
  findings: Fix 6 shipped (corrected design), Fix 5 shipped, Vision
  confidence string leak fixed, commit-p near-miss investigated (report
  only, no code).** Single real production scan (Spawn #351, 2026-08-07
  20:40:36 UTC, POST /api/enrich, `dep=dpl_4mwr6MwTQZ7m4CxsZQFdjoaXr1SW`)
  supplied the evidence for all four items — pulled directly from Vercel
  runtime logs, not summarized secondhand.

  **Fix 6 SHIPPED, design corrected from Dispatch 15/16's original —
  `rescueYearFromVisionFallback` (`src/lib/issueAuthority.js`, log tag
  `[commit-p3]`).** The queued design (thread `poolYearHint` into
  `resolveYear`) was never coded as originally specced — investigating
  this scan found the design's own justifying citation had conflated two
  different signals. The scan's real log:
  ```
  [commit4.1] identityProvisionalFields += 'year' (family-scoped adoption): year=2024 support=3/4
  ...
  [identity-write] field=confirmedYear from="2024" (source=unknown) to="Unknown" (source=vision-fallback) site=resolve-year
  ```
  Commit 4.1 (`api/enrich.js` ~3026-3041) had already adopted year=2024
  from `identity.familyYearConsensus` (family-scoped, support=3/4=75%) —
  but `resolveYear` (`identityCore.js`) never even sees that adopted
  value on this path (`identityIsProvisionalOverride` is false for the
  weighted-consensus family-override route — B-Q1, `api/enrich.js`
  ~6933), so it fell through its own final branch and returned Vision's
  raw sentinel value, the literal string `"Unknown"` — not JS `null`.
  This is why the pre-existing `deriveProvisionalYearBackfill`/commit-p2
  rescue (added GrailKey Commit P2, 2026-08-03, specifically to guard
  against resolveYear clobbering an adopted year) didn't catch it: its
  `currentConfirmedYear != null` guard was built assuming a JS-`null`
  fallback and never fires against a non-null "Unknown" string, and
  separately its `issueAuthority.highConfidenceMarketplaceConsensus`
  gate was ALSO false on this exact scan (see the commit-p near-miss
  finding below — the same root cause blocks both commit-p and
  commit-p2 on this scan, independently discovered while investigating
  each). Two compounding reasons, not one.

  **The Dispatch 15/16 citation error, specifically:** the original Fix
  6 write-up cited "year=2024 support=3/4" as a `poolYearHint` instance
  ("agreement=X%" is `poolYearHint`'s own log format;
  `[commit4.1]`'s format is "support=X/Y" — a different field entirely).
  On this exact scan, `poolYearHint` really was computed
  (`[cv-pool-year-hint] year=2020 agreement=50% (3/6)`) and it was
  WRONG (2020, diluted by unrelated #300/#307/#293 listings in the raw
  20-item pool) — confirming `poolYearHint` was never the right signal
  to thread into `resolveYear` at all. `rescueYearFromVisionFallback`
  reads `identity.familyYearConsensus` exclusively; `poolYearHint` is
  not a parameter.

  **Fires ONLY when `yearSource === 'vision-fallback'` exactly** (not a
  loose truthy/null check) **AND** `familyYearConsensus.mode ===
  'adopted'` **AND** `support >= 3` — the same floor commit-p2 already
  enforces, validated by this real 3/4=75% case, unchanged. Placed
  immediately after the existing commit-p2 block in `api/enrich.js`
  (after every intermediate backfill — Q86 PC-tolerated, Q58-TITLE comp
  consensus, pc-anchor-gate, q99-b-variant-year — has already had its
  chance to find something better), so it only fires when NOTHING else
  fixed the year in between. Never touches any yearSource representing
  real corroboration (pc-cv-agreement, pricecharting, comicvine,
  ebay-consensus, or even the rejected-override case). 25-assertion
  regression: `tests/grailkey-dispatch-19-fix6-year-rescue.test.js`.

  **commit-p near-miss — INVESTIGATED, report only, no code changed,
  per explicit instruction.** The same scan's terminal gate fired
  `[commit4-terminal]` (forcing `ID_REQUIRED`, clearing price authority)
  instead of `[commit-p]` (price preserved) despite `issue=#351
  support=4/4=100%` — matching the shape of an earlier same-day scan
  (04:37:20 UTC, same book, same deployment) where `[commit-p]` DID
  fire. Traced to `meetsHighConfidenceMarketplaceConsensusBar`
  (`src/lib/issueAuthority.js`): `HIGH_CONFIDENCE_WEIGHT_FLOOR = 12`
  (justified in-code as "the maximum weight three members could carry
  using only the highest-ranked results," 5+4+3 from `getRankWeight`'s
  own scale, `imageSearchIdentity.js`). The two scans' own title-family
  weightSums:
  | Scan | Members (raw-pool rank indices) | Weight | Clears floor? |
  |---|---|---|---|
  | 04:37:20 (earlier, same day) | 0,1,2,5 → 5+4+3+1 | 13 | Yes — `[commit-p]` fired |
  | 20:40:36 (the dispatch scan) | 0,1,3,4 → 5+4+1+1 | 11 | No — one point short |

  Every OTHER `meetsHighConfidenceMarketplaceConsensusBar` condition
  passed identically on the 20:40 scan (decision='weighted-consensus',
  `topFamily.count=4 >= 3`, `overlapRatio=1`, dominant margin over
  runner-up 11 vs 3, no contaminated member, no series-marker
  asymmetry) — it failed on weight alone, by exactly one point. Root
  cause of the DIFFERENCE between the two scans: in the 04:37 scan,
  eBay's own reverse-image-search results happened to put a genuine
  #351 comp at raw-pool rank-2 (the third-highest weight tier, worth 3);
  in the 20:40 scan, that same rank slot was occupied by an unrelated
  "Spawn #326-#352 YOU PICK We Combine Shipping!!" lot listing, which
  the family-clustering step correctly excludes from membership but
  which still CONSUMED the rank-2 weight slot, denying it to a genuine
  member. `filterVisualIdentityPool`, `getRankWeight`, and
  `meetsHighConfidenceMarketplaceConsensusBar` all behaved correctly and
  identically given their actual inputs on both scans — this is NOT a
  code bug in either mechanism. It is a structural property of a
  rank-position-based weight floor: which raw listings eBay's live
  search-by-image API returns, and in what order, genuinely varies
  scan-to-scan for the same physical book (ordinary marketplace
  listing churn, not a determinism bug on this codebase's side) —
  meaning the SAME confirmed-correct book, photographed and scanned
  identically hours apart, can non-deterministically land on either
  side of the P1 high-confidence bar depending purely on what else eBay
  happened to rank alongside it that day.
  **Not fixed, not scoped — reported for a decision.** Two directions
  worth naming, neither implemented: (a) leave the floor as-is — it is
  a genuine floor, not a bug, and this near-miss is exactly the kind of
  case a floor is supposed to sometimes not clear; or (b) exclude
  known-junk categories (lot/bundle listings specifically, reusing the
  existing `LOT_RE`-family detection already used elsewhere in this
  codebase) from consuming a top-3 rank slot in the weight computation,
  so an irrelevant listing can no longer silently cost a genuine
  family its rank-3 weight. Direction (b) touches
  `meetsHighConfidenceMarketplaceConsensusBar`/`getRankWeight` — pricing
  math-adjacent territory (the P1 gate directly controls whether a
  price gets nulled) and needs its own explicit greenlight before any
  implementation, per this project's standing pricing-math protocol.

  **Vision confidence string leak — TRACED AND FIXED.** The same
  scan's own `[match-conf]` log line read
  `vision=high that this is not a comic book` — an asset-type verdict
  sentence being consumed where a `low`/`medium`/`high` confidence tier
  was expected. Traced to `req.body.confidence`
  (`api/enrich.js`, destructured at handler entry) literally containing
  the string `"High that this is NOT a comic book"` on this scan.
  Root cause was two-layered:
  1. **Prompt gap (`api/grade.js`).** `STANDARD_PROMPT`/`WATCH_PROMPT`
     never actually instructed Vision on `confidence`'s required format
     — confirmed by direct read of the live prompt text, no such
     sentence existed, despite `normalizeVisionConfidence`'s own doc
     comment (`identityCore.js`) claiming otherwise. The separately-
     specified `buildGradeOnlyPrompt` (the eBay-first cheap path) DID
     already have the correct instruction — the gap was specific to the
     two full-identification prompts. With `assetTypeConfident` and
     `confidence` presented back-to-back with no explicit format given
     for the latter, the model free-styled a justification sentence
     instead. Fixed: both prompts now carry an explicit "confidence
     must always be exactly one of the three words low/medium/high...
     never a restatement of the assetTypeConfident determination"
     instruction.
  2. **Zero validation at consumption (four independently-drifted call
     sites).** `normalizeVisionConfidence` (`identityCore.js`) blindly
     lowercased whatever string arrived with no check against the
     three-value enum — AND three separate, independent inline
     duplicates of the identical unchecked
     `String(confidence || 'medium').toLowerCase()` pattern existed in
     `api/enrich.js` (~4049, ~4232, ~8667), none of them routing
     through the one centralized function at all — the same
     drifted-duplicate-constant shape this file has documented
     repeatedly (Q119/Q127/Q128, the `ARTIST_PATTERNS` registry saga).
     Fixed: `normalizeVisionConfidence` now validates against
     `{low, medium, high}`, defaulting anything else to `'medium'` with
     a loud `[vision-confidence-invalid]` log line (never silent,
     preserves the offending raw value for diagnosis); all three inline
     `api/enrich.js` duplicates now call the shared function instead of
     re-deriving it. 20-assertion regression, including a direct read
     of the live prompt source confirming the instruction text actually
     landed: `tests/grailkey-dispatch-19-vision-confidence-leak.test.js`.

  **The leak is intermittent, not deterministic — confirmed, not
  assumed (GrailKey Dispatch 24, 2026-08-07).** A second Spawn #351
  scan, same build (`b212c64`, the pre-push build — this observation
  predates the fix reaching production), did NOT reproduce the bad
  string: `confidence="Low"` / `visionConfidence: "low"` /
  `[match-conf] vision=low`, a well-formed value, on the exact same
  code that produced `"High that this is NOT a comic book"` the day
  before. Same prompt, same code path, different Vision output shape
  from one photo to the next — the model doesn't reliably free-style
  the bad sentence every time it sets `assetTypeConfident=false`, only
  sometimes. **This does not weaken the Dispatch 19 fix or its
  reasoning** — a prompt gap plus an unvalidated consumer was a real
  defect regardless of how often it manifested, and an intermittent
  failure mode is arguably worse to leave unfixed, not less urgent,
  since it would have passed casual spot-checks indefinitely. It DOES
  mean: **do not expect to reproduce the original bad string on demand
  for verification.** A future regression check for this class of bug
  should rely on the unit test (`grailkey-dispatch-19-vision-confidence-
  leak.test.js`, which forces the input directly rather than waiting for
  Vision to volunteer it) and on the validator's own
  `[vision-confidence-invalid]` log line staying silent in production
  (its absence over time is the actual evidence the fix holds), not on
  catching the literal sentence in a fresh scan — the sentence's
  absence from any one scan is not evidence of anything, in either
  direction. The `scanlog:` record (GrailKey Dispatch 22) does not
  currently carry `confidence`/`visionConfidence` as a field either —
  another concrete instance of the same "v1 doesn't collect what a
  follow-up question needs" gap already noted for the `titleOk`
  question in the Dispatch 23 scan-log validation-questions note above.

  **Fix 5 SHIPPED — `shouldLiftAssetTypeAdvisoryLock`
  (`src/lib/imageSearchIdentity.js`), log tag `[Q32-asset-type-override]`.**
  Blocked since GrailKey Dispatch 15 on a real captured Vision JSON to
  determine whether a "not a comic" misread returns `issue=null`
  (display/lock-only fix) or a stale wrong value (would also need to
  feed a corrected issue back into `resolveIdentity`). This exact scan
  answers it: `[phase1] identity determination: Vision="Spawn" #null` —
  confirmed null, not stale. Implemented as originally re-scoped in
  Dispatch 15: extends the existing Q32 category-vote machinery
  (merchandise detection) to also tally comic-category votes, and when
  Vision flagged `!assetTypeConfident` but the pool independently shows
  strong (`>=5` listings, `>=60%` ratio) comic-category agreement AND
  the pool is coherent, lifts Q110's advisory `listingHardLocked` flag
  before it fires. Strictly additive to the Q32 merchandise hard-block —
  the predicate short-circuits to `false` whenever `merchandiseRatio >=
  0.5`, so it can never override that block; it only ever runs from
  inside the branch merchandise detection already declined.
  **Coherence-gate design decision, made explicit rather than left
  ambiguous:** the original Dispatch 15 wording said "reusing
  extractConsensus's own title-coherence check" — investigating the
  actual code found `titleOk` is a private local variable inside
  `extractConsensus` (`imageSearchIdentity.js`), not exposed on its
  return value, and `extractConsensus` returning `null` conflates TWO
  independent failure axes (title OR issue incoherence), not title
  alone. Rather than refactor `extractConsensus`'s internal closures
  (`stripVariantNoise`/`extractMainTitle`/`getMostCommon`) out to module
  scope just to isolate the title-only sub-check — a real option,
  deliberately not taken, to keep this fix's surface area contained —
  the shipped gate reuses `extractConsensus(...) !== null` as a single
  boolean input, which is the MORE conservative of the two choices
  (requires the pool to agree on both title AND issue, not title alone),
  consistent with this project's standing "conservative when uncertain"
  rule. **Disclosed limitation, not hidden:** this exact scan's own
  `visualConsensus` was `null` (`[phase1] eBay visual: 20 results,
  consensus=NO` — title consensus was fine, but the issue axis never
  reached its own separate 50% bar, the same near-miss described
  above) — so Fix 5, as shipped, would NOT have lifted this specific
  scan's own advisory lock. It targets the more common, different shape
  where the pool agrees on both title and issue but Vision's own
  `assetTypeConfident` read was wrong (a poster/print visually confused
  for a genuine, convergent listing pool) — real and different from
  this scan's own outcome, which is disclosed rather than papered over.
  Thresholds (`>=5`, `>=60%`) validated against this scan's real numbers
  (0/20 merchandise, ~20/20 comic-category — clears trivially, though
  this pool doesn't exercise the boundary itself since its own
  coherence gate declines regardless). 14-assertion regression:
  `tests/grailkey-dispatch-19-fix5-asset-type-override.test.js`.

  **Regression sweep, all pre-existing baseline failures confirmed
  byte-identical before/after (via `git stash`, not assumed):**
  `q-trackB-commit4.3-winning-family-authority` (266/266, zero
  pre-existing failures), `q110-intake-nonblocking` (38/38),
  `identity-gate` (1 pre-existing failure, an unrelated stale "author"
  field fixture, confirmed identical on `git stash`), `mega-keys` (the
  documented B&B #28 boundary failure), `q-adv397-visual-guard` (the
  documented 5-failure baseline), `image-search-extraction` (the
  documented 2-failure baseline), `pattern-k-dedupe-issue` (the
  documented 4-failure baseline) — none of this dispatch's four changes
  touched any of the code paths those pre-existing failures exercise.

- **Misattributed-anchor class — the Fix 6 spec error, standing note
  (GrailKey Dispatch 20, 2026-08-07).** Not just a corrected
  implementation: a wrong specification survived three dispatches (15,
  16, and would have shipped as designed in 19 had a real production
  scan not incidentally exposed it during unrelated work) with a
  passing, 25-assertion regression suite behind it — worth recording as
  its own failure class, because "well-tested" and "correctly specified"
  turned out to be independent properties here, and the gap between
  them is exactly the dangerous kind: invisible from the test output.

  **What happened, precisely.** GrailKey Dispatch 15 proposed Fix 6
  ("thread `poolYearHint` into `resolveYear`'s branch (e)"), citing two
  production log lines as validation: "year=2019 agreement=80% (4/5)"
  and "year=2024 support=3/4." Dispatch 15 itself flagged that 80% and
  75% didn't match one proposed bar and left the number an open
  question — a good instinct — but did not ask a prior, more basic
  question: were both citations actually instances of the SAME signal
  (`poolYearHint`) at all? GrailKey Dispatch 16 (this same session,
  earlier) picked `>=0.75` to accommodate both citations and shipped
  the design decision, with a 25-assertion regression suite built
  entirely from those two numbers. Every assertion passed. The design
  itself was never coded in that dispatch (implementation stayed
  queued) — which is the only reason this didn't ship silently wrong;
  had implementation kept pace with the validated bar, it would have
  shipped reading `poolYearHint` on every future scan, believing itself
  tested.

  GrailKey Dispatch 19, investigating an unrelated real production scan
  (Spawn #351) for Fix 5's evidence, incidentally pulled the exact log
  line the second citation came from and found it was never
  `poolYearHint` at all — it was `[commit4.1]`'s own family-scoped year
  adoption line (`identity.familyYearConsensus`), a structurally
  different computation (scoped to a title-family's own members, not
  the raw whole pool) that happens to share a superficially similar log
  shape: both read as "a ratio of pool rows supporting a candidate
  year," both print an X/Y-shaped fraction, easy to mistake for the
  same field at a glance if you don't trace the literal source line.
  `poolYearHint`'s OWN real value on that same scan was 2020 at
  3/6=50% — a third number, genuinely computed, and wrong. Three
  numbers on one real scan (2019/80%, 2024/75%, 2020/50%), only one of
  which was ever poolYearHint, and the design being validated (Fix 6)
  was never checked against that one correctly.

  **Why the passing tests didn't catch it.** The 25 Dispatch 16
  assertions validated that `>=0.75` correctly accepted both cited
  ratios and correctly rejected values below it — a genuine, honest
  test of the THRESHOLD. They could not have caught the deeper problem
  because the test fixtures were HAND-CONSTRUCTED from the citations
  themselves (`{ agreement: 0.75, year: 2024 }`-shaped inputs), not
  derived by re-tracing each citation back to its actual log line and
  variable. A test built from a mislabeled citation faithfully tests
  the mislabel. Coverage of "does the bar behave correctly given this
  input" is a different claim from "is this the right input" — the
  first is a property of the test, the second is a property of the
  citation, and no amount of the first proves the second.

  **The standing rule, generalized beyond this one case:** when a
  design cites a production log line as validation — a ratio, a
  count, an X/Y fraction — trace it back to its LITERAL source (the
  exact `console.log` call site and the exact variable printed) before
  building anything on it, not just its face-value meaning. This
  matters most exactly when two mechanisms in the same pipeline can
  produce similarly-shaped output for a related purpose (here:
  `poolYearHint`'s whole-pool `agreement=X%` vs `[commit4.1]`'s
  family-scoped `support=X/Y` — both about "how many rows support this
  year," different scopes, different reliability, easy to conflate).
  A citation that "looks like" the signal a design names is not
  evidence it IS that signal. This is a different, earlier-stage
  failure than the drifted-duplicate-constant class already documented
  in this file (Q119/Q127/Q128, the `ARTIST_PATTERNS` saga) — those are
  about a value or list independently drifting apart from a sibling
  copy after correct attribution; this is about the attribution itself
  being wrong from the start, before any drift could even occur. Watch
  for it specifically whenever a fix's evidence section cites "a real
  production log line" without also showing the line's own log tag/
  call-site context — the tag is what proves which mechanism actually
  produced it.

- **GrailKey Dispatch 20 (2026-08-07) — Fix 5 decline-path logging
  shipped; commit-p rank-slot theft investigated and found to be the
  MINORITY cause, not the majority, of the near-misses it superficially
  resembles.**

  **Fix 5 decline-path logging, SHIPPED.** The `[Q32-asset-type-override]`
  call site already logged both branches (fire and decline) as shipped
  in Dispatch 19 — verified directly before changing anything, not
  assumed missing. Enhanced the decline log with a `blockedBy` reason
  breakdown (`merchandise-hard-block-region` / `comicVotes<5` /
  `comicRatio<60%` / `pool-incoherent`) and explicit `merchandiseRatio`,
  so a future batch sweep asking "does this ever fire" doesn't need to
  hand-recompute which sub-condition failed from raw numbers alone.
  8-assertion regression: `tests/grailkey-dispatch-20-fix5-decline-logging.test.js`.

  **commit-p rank-slot theft — INVESTIGATED, report only, no code,
  `HIGH_CONFIDENCE_WEIGHT_FLOOR` left untouched, per explicit
  instruction.** Queried production runtime logs for every
  `[commit4] issueAuthority=provisional` firing (the only population
  where `HIGH_CONFIDENCE_WEIGHT_FLOOR` actually gates anything) across
  2026-08-01 through 2026-08-07. Group-by counts (fast, reliable):
  16 total firings in that window. Full-content pulls (the only way to
  see each scan's actual raw-pool indices) repeatedly timed out over
  multi-day and even single-day windows for this specific query — narrow
  (≤12h) windows worked reliably; wider ones did not, regardless of
  `deploymentId` scoping. **9 of the 16 were reachable and fully
  verified** (indices, family membership, and the literal content of
  every raw-pool row checked directly, not inferred); **7 remain
  unreachable** within this investigation's tool budget — recorded as a
  genuine gap, not glossed over.

  **Critical caveat found while pulling the 9: this is not a diverse
  sample.** All 9 reachable scans are repeat scans of essentially ONE
  physical book — Spawn #351 Cover C Brett Booth Virgin (8 of the 9) —
  plus one scan of a second book, Spawn #369 (the Dispatch 15/16 anchor).
  This strongly suggests the reachable window is dominated by this
  investigation's own repeated test/dev scans of the same book, not a
  representative cross-section of real customer traffic. Any frequency
  claim below is scoped honestly to "within this narrow, non-diverse
  sample," not "across the scan ledger" as originally asked — the
  ledger-wide question remains genuinely unanswered given the tool's
  reach limits, the same honest conclusion this file already reached
  once before for a different measurement (see the Bone #1 / GK-34
  entry's own stale-threshold measurement, "Parked... not answerable
  from available logs").

  **Finding, precise per-scan (all 9 checked directly against the raw
  `[visual] titles:` array and the `[family-evidence]` index list, not
  pattern-matched from memory across scans):**

  | Scan (UTC) | Book | Weight | Family indices | Top-3 slot 2 occupant | Mechanism |
  |---|---|---|---|---|---|
  | 04:37:20 Aug 7 | Spawn #351 | 13 | {0,1,2,5} | genuine family member | clean, `commit-p` fires |
  | 03:48:42 Aug 4 | Spawn #351 | 14 | {0,1,2,3,5} | genuine family member | clean, `commit-p` fires |
  | 04:40:00 Aug 3 | Spawn #351 | 14 | (5 members) | genuine family member | clean, `commit-p` fires |
  | 04:39:27 Aug 3 | Spawn #351 | 14 | (5 members) | genuine family member | clean, `commit-p` fires |
  | 20:40:36 Aug 7 | Spawn #351 | 11 | {0,1,3,4} | **genuine junk — "Spawn #326-#352 YOU PICK We Combine Shipping!!" lot listing** | **junk rank-slot theft** |
  | 02:23:00 Aug 4 | Spawn #351 | 10 | {0,1,4} | real, on-topic "CAMEO OF LYRA" listing — split into its own 2-member sibling sub-family instead of merging | title-family fragmentation, NOT junk |
  | 04:24:49 Aug 3 | Spawn #351 | 10 | {0,1,4} | same as above | fragmentation, NOT junk |
  | 03:52:16 Aug 3 | Spawn #351 | 10 | {0,1,4} | same as above | fragmentation, NOT junk |
  | 04:51:10 Aug 7 | Spawn #369 | 8.5 | (8 members, broad "spawn"-only family) | slots 0 and 1 both genuine, on-topic #369 listings that didn't cluster into this family | fragmentation, NOT junk |

  **The specific mechanism asked about — a lot/multi-issue/junk-category
  listing directly occupying a top-3 rank slot — was confirmed in
  exactly 1 of the 9 reachable scans.** The mechanism that actually
  recurs more often in this sample (4 of 9, all involving no junk
  whatsoever) is a different, structurally distinct problem: title-family
  clustering splitting genuinely relevant, on-topic listings into
  sibling sub-families instead of merging them into the winning family —
  which drags `weightSum` below the floor for a completely unrelated
  reason. Both mechanisms independently produce the same visible symptom
  (near-miss, `commit-p` doesn't fire, `commit4-terminal` forces
  `ID_REQUIRED`) — which is why a first look at two symptomatically
  identical scans (both landing on `family={0,1,4}`/weight=10) can look
  like "the same bug happening twice" when re-tracing the ACTUAL content
  behind the missing slot shows they are not. The initial hypothesis
  going into this investigation ("the junk listing keeps stealing rank
  slots") was itself a version of the misattributed-anchor mistake
  documented above — two scans producing an identical-looking
  `family=/weight=` fingerprint were assumed to share a cause without
  independently re-verifying each one's actual row content.

  **Conclusion, matching the explicit instruction not to touch anything:**
  within the reachable, honestly-caveated sample, junk-in-top-3 is a
  known marginal case — 1 confirmed instance, not evidence of a common
  problem, consistent with "leave `HIGH_CONFIDENCE_WEIGHT_FLOOR` alone."
  The fragmentation mechanism recurred more often in this same sample
  and is a genuinely different, unscoped problem — flagged here as a
  candidate for its own future investigation if the pattern holds up
  outside this narrow, single-book-dominated sample, but explicitly NOT
  requested or scoped this dispatch, and not investigated further here.
  `HIGH_CONFIDENCE_WEIGHT_FLOOR` and every rank-weight mechanism
  (`getRankWeight`, `meetsHighConfidenceMarketplaceConsensusBar`,
  `selectTitleFamilyCandidate`'s merge logic) remain completely
  untouched by this dispatch.

- **GrailKey Dispatch 21 (2026-08-07) — title-family fragmentation added
  to the watch list (no action); structured KV scan-logging investigated,
  plan only, no code.**

  **Watch list, not scoped, no action — title-family fragmentation.**
  Dispatch 20's commit-p investigation found that 4 of 9 verified scans'
  near-misses were caused by `selectTitleFamilyCandidate` splitting
  genuinely on-topic, relevant listings into sibling sub-families instead
  of merging them into the winning family (e.g. a "CAMEO OF LYRA"
  variant-descriptor listing landing in its own 2-member family rather
  than joining the main 3-member "spawn brett booth" family it visually
  and topically belongs with) — a structurally different mechanism from
  junk-listing rank-slot theft, confirmed by direct re-verification of
  each scan's actual row content. **Explicitly not scoped or
  investigated further per instruction:** all 4 instances are the same
  single book (Spawn #351) in a sample already established as
  non-diverse (dominated by repeat scans of that one book) — one book at
  nine repeats is not evidence of a general pattern, and generalizing
  from it would repeat the exact misattribution error this session
  already found and corrected once (the Fix 6 spec error). Recorded here
  so a future dispatch that sees this shape on an UNRELATED book
  recognizes it rather than re-diagnosing from scratch — flag if it
  recurs elsewhere; no threshold, no code, no scoping decision made now.

  **Structured KV scan-logging — INVESTIGATED, PLAN ONLY, no code.**
  Two separate frequency questions this session ended genuinely
  unanswered for the identical underlying reason: the GK-34 stale-comp
  threshold measurement (see that entry above, "Parked... not answerable
  from available logs") and this dispatch's own commit-p rank-slot
  frequency investigation (7 of 16 scans unreachable). Both hit the same
  wall: the Vercel runtime-log tool reliably answers COUNT queries
  (`group_by`) over wide time ranges, but full-content pulls — the only
  way to see the actual field values a frequency question needs — time
  out past roughly a 12-hour window regardless of `deploymentId` scoping,
  confirmed via repeated direct attempts across both investigations, not
  assumed. This is a standing tooling gap, not a one-off — two unrelated
  questions failed on it in one session.

  **The proposal: write one compact, structured record per scan directly
  to the KV layer that already exists** (`api/kv-cache.js`, Upstash
  Redis, live since 2026-06-29 — see the Stack section and GrailKey
  Dispatch 18) — a direct Redis query against that store is not subject
  to the runtime-log tool's content-scan timeout at all, since it reads
  pre-structured records instead of re-parsing verbose console output
  after the fact.

  **Record shape, first draft, not final — needs iteration before
  coding:**
  ```json
  {
    "v": 1,
    "ts": 1786...,
    "requestId": "...",
    "book": { "title": "...", "issue": "...", "year": "..." },
    "issueAuthority": { "status": "provisional", "reasons": [...], "highConfidenceMarketplaceConsensus": true, "supportRatio": 0.53 },
    "familyWeight": { "weightSum": 11, "count": 4, "overlapRatio": 1, "decision": "weighted-consensus" },
    "terminalReason": "commit-p" | "commit4-terminal" | "clean" | null,
    "poolSizes": { "raw": 20, "eligible": 20, "familyMembers": 4 },
    "assetTypeOverride": { "evaluated": true, "fired": false, "blockedBy": ["pool-incoherent"] }
  }
  ```
  Directly answers both of this session's dead-end questions (the
  `familyWeight`/`terminalReason` fields alone would have made the
  rank-slot investigation a direct query instead of nine individual log
  pulls) and is written generally enough to answer whatever the NEXT
  unanswerable frequency question turns out to be — a per-scan record
  scoped only to today's specific question would just recreate today's
  problem the next time a different filter is needed. Versioned (`v: 1`)
  from day one, matching this exact file's own `PC_FILTER_VERSION`/
  `CV_FILTER_VERSION` convention (`api/kv-cache.js`) — a schema change
  must not silently corrupt historical queries.

  **Storage primitive — two options, recommendation given, needs
  verification before committing:**
  1. **Redis Streams (`XADD`/`XRANGE`), recommended.** Purpose-built for
     exactly this shape (append-only, time-ordered, range-queryable
     event log) — one command per write, no separate index structure to
     keep in sync. Not yet verified whether Upstash Redis's specific
     offering supports stream commands on the plan this project is on —
     a real prerequisite check, not assumed, before this direction is
     picked.
  2. **Plain per-record keys (`scanlog:v1:<ts>:<id>`) + a sorted-set time
     index (`ZADD scanlog:index:v1 <ts> <key>`), fallback.** Definitely
     supported (uses only primitives `api/kv-cache.js` already proves
     work against this project's Upstash instance), but two writes per
     scan instead of one, and the index needs its own retention/trim
     policy independent of the records it points to.

  Either option needs new wrapper functions in `api/kv-cache.js` (today
  only exports `kvGet`/`kvSet`/`kvDel`, plain GET/SET/DEL — no
  stream/sorted-set operations wrapped yet) — a small, additive change to
  that file, not a rewrite.

  **Open questions, deliberately not resolved here:**
  - **Volume/cost.** No current daily/monthly scan-count figure exists
    in this codebase's own documentation to project storage or
    per-command cost against. Needs a real number (Vercel function
    invocation count, or a short observation period) before committing
    to "log every scan" — the record above is small, but small × unknown
    volume × unbounded retention is not a costed decision.
  - **Retention.** This is an analytics/audit trail, not a cache in the
    existing sense (avoiding redundant external API calls) — a distinct
    purpose deserving its own TTL policy (candidate: 30-90 days) rather
    than inheriting any existing `KV_TTL` constant, and its own key
    namespace (`scanlog:`, distinct from the existing `cv:`/`pc:`/`gc:`/
    `ac:`/`bc:`/`ph:`/`oauth:` prefixes) per this file's own established
    namespace-isolation discipline.
  - **Scope: every scan, or only the interesting ones?** Logging only
    `commit4`-provisional scans directly answers today's specific
    question cheaply, but recreates the SAME narrow-denominator problem
    the next time a different filter is needed (as it did twice this
    session, for two different filters). Logging every scan with a
    small, flat record answers arbitrary future frequency questions but
    costs more and is a bigger decision — leaning toward "every scan"
    for durability of the investment, but this is exactly the kind of
    tradeoff to decide once volume is known, not before.
  - **Write-site failure mode.** Must follow the SAME graceful-degradation
    convention `kvGet`/`kvSet` already use (try/catch, swallow failures,
    console.warn, never block or fail the actual pricing response) — a
    logging write must never be able to take down a real scan.
  - **Query interface.** Recommended: a local Node script
    (`scripts/query-scanlog.mjs`, not yet written) run against
    `KV_REST_API_URL`/`TOKEN` pulled via `vercel env pull` — talks
    directly to Upstash, no new deploy, no new Vercel function. A
    dedicated API endpoint was considered and rejected as the default:
    `api/` is already at 14 files against a nominally-12 cap (unresolved
    per GrailKey Dispatch 18) — spending one of those scarce slots on an
    investigation tool, not a customer-facing feature, is the wrong
    trade when a local script reaches the same data with zero function
    cost.

  Nothing in this proposal is implemented. The next step, if greenlit,
  is verifying Upstash's stream-command support specifically (the one
  real unknown blocking a choice between the two storage options above)
  before any code is written.

- **GrailKey Dispatch 22 (2026-08-07) — structured KV scan-logging
  SHIPPED, greenlit with two decisions made explicitly to avoid waiting
  on data that wouldn't start accumulating until this was live.**

  **Decision 1: log every scan, not just the interesting ones.** The
  Dispatch 21 plan's own argument was the deciding one — a narrowly-
  scoped log recreates the exact denominator problem that broke both
  of this session's frequency investigations, each needing a different
  filter. Volume judged not a real constraint at current scale (~60
  scans/week during heavy testing, ~500-byte records, well under
  20MB/year) — explicitly revisit if usage grows an order of magnitude,
  not a permanent assumption.

  **Decision 2: sorted-set index instead of Redis Streams.** Streams
  were the Dispatch 21 recommendation but carried one real, named
  blocker: unverified whether this project's Upstash plan supports
  stream commands. The sorted-set fallback uses only primitives
  `api/kv-cache.js` already proves work against this project's real
  Upstash instance (plain `GET`/`SET`, now `ZADD`/`ZRANGE`) — removes
  the blocker outright rather than resolving it. Two writes per scan
  (the record plus the index entry) instead of Streams' one judged
  irrelevant at ~60 scans/week. Streams remain the documented upgrade
  path, not abandoned — worth revisiting if write volume ever grows
  enough that two round-trips per scan starts to matter.

  **What shipped, concretely:**
  - `src/lib/scanLog.js` (new) — `buildScanLogRecord` (pure, no I/O,
    every field defaults to `null` rather than being omitted, so a
    consumer querying many records never needs a presence check) and
    `buildScanLogKey` (`scanlog:v1:<ts>:<id>`). `SCAN_LOG_VERSION=1`,
    `SCAN_LOG_TTL_SECONDS` (90 days), `SCAN_LOG_INDEX_KEY`
    (`scanlog:index:v1`) all exported as named constants, matching this
    file's own `PC_FILTER_VERSION`/`CV_FILTER_VERSION` versioning
    discipline (`api/kv-cache.js`) from day one — a future schema
    change bumps the version rather than silently reshaping historical
    records a live query is still reading.
  - `api/kv-cache.js` — new `kvZAdd(key, score, member)`, same
    graceful-degradation contract as the existing `kvGet`/`kvSet`
    (try/catch, swallow failures, `console.warn`, never throw). New
    `KV_TTL.SCANLOG` constant and a `scanlog:` line added to the file's
    own key-prefix documentation comment.
  - `api/enrich.js` — three changes: (1) a `scanLogTerminalReason`
    variable, declared just above the commit4-terminal/commit-p branch
    and set inside each (`'commit4-terminal'` / `'commit4.1-terminal'`
    / `'commit-p'` / stays `null` when neither fires — a normal,
    confident scan); (2) Fix 5's `assetTypeOverrideEvaluated`/
    `assetTypeOverrideBlockedBy` now persisted onto `out` (previously
    only logged, not stored, so the scanlog write site — much later in
    the same handler — had nothing to read); (3) the write site itself,
    placed immediately after `out.decision = computeDecision(...)` (the
    point every field the record needs — `out.issueAuthority`,
    `familyCandidate.topFamily`, pool sizes, the terminal reason — is
    settled), wrapped in its own try/catch as a second layer of
    protection beyond `kvSet`/`kvZAdd`'s own internal error-swallowing
    (this block also builds the record and reads several `out`/local
    fields, which the KV wrapper functions' own try/catch can't cover).
    Awaited, not fire-and-forget — a genuinely un-awaited promise in a
    serverless function has no guaranteed chance to complete once the
    response is sent; `kvSet`/`kvZAdd` already resolve in one fast
    Redis round-trip each, so awaiting costs negligible latency while
    guaranteeing the write is attempted.
  - `scripts/query-scanlog.mjs` (new) — local script, no new Vercel
    function (deliberately: `api/` is already at 14 files against a
    nominally-12 cap, an unresolved open question since GrailKey
    Dispatch 18; spending one of those scarce slots on an investigation
    tool rather than a customer-facing feature would be the wrong
    trade). Loads `KV_REST_API_URL`/`KV_REST_API_TOKEN` from whichever
    pulled `.env*` file has them, same preference-order pattern already
    established in `scripts/pc-token-health.mjs` — no new dependency,
    no dotenv (this repo has none). Accepts `--since`/`--until` (ISO or
    relative, `"7d"`/`"24h"`/`"30m"`), `--json` for raw records, `--limit`
    on the index read. Default summary output breaks down
    `terminalReason` and `issueAuthority.status` counts and Fix 5's
    evaluated/fired counts directly — the exact shape both of this
    session's dead-end investigations actually needed.

  **26-assertion regression** (`tests/grailkey-dispatch-22-scanlog.test.js`):
  the pure builders' full/minimal/partial-input behavior, and a direct
  confirmation that `kvZAdd` never throws even with no KV configured
  (this test environment's own real shape — the same shape a production
  Redis outage would produce). Full build clean. Regression sweep against
  `q-trackB-commit4.3-winning-family-authority` (266/266),
  `q110-intake-nonblocking` (38/38), `identity-gate` (1 pre-existing,
  unrelated failure, unchanged), and every Dispatch 19/20 test file
  (`fix6-year-rescue`, `vision-confidence-leak`,
  `fix5-asset-type-override`, `fix5-decline-logging`) — all confirmed
  passing, zero regressions from touching `api/enrich.js` a fourth time
  this session.

  **What this instrumentation exists to answer (GrailKey Dispatch 23,
  2026-08-07) — recorded here so a future session queries for these
  directly instead of re-deriving them from scratch. All three are
  currently guesses; revisit after roughly 2 weeks of accumulated
  records (`node scripts/query-scanlog.mjs --since=14d`).**
  1. **Does `shouldLiftAssetTypeAdvisoryLock` ever fire in production,
     or is the bar too conservative?** Dispatch 19's own disclosed gap
     — the fix shipped with its own motivating scan (Spawn #351)
     confirmed NOT to qualify under its own bar. Query:
     `assetTypeOverride.evaluated` count vs. `assetTypeOverride.fired`
     count (the query script's default summary already reports both).
     If `evaluated > 0` and `fired` stays at 0 across a real batch, the
     `>=5` / `>=60%` / coherence-gate combination needs revisiting with
     real numbers instead of the Dispatch 15 placeholders it still
     carries.
  2. **How often does a commit-p near-miss happen, and on books other
     than Spawn #351, does fragmentation or junk-slot theft dominate?**
     Dispatch 20's finding was a single-book sample (8 of 9 verified
     scans were the same physical book) — explicitly flagged as not
     generalizable. Query: `terminalReason` breakdown
     (`commit-p`/`commit4-terminal`/`commit4.1-terminal`/`clean`)
     grouped by `book.title`/`book.issue`, once enough distinct books
     have accumulated records to say anything. The `familyWeight` field
     doesn't by itself distinguish fragmentation from junk-slot-theft —
     that still requires reading the actual raw-pool row content the
     way Dispatch 20 did by hand — but a `terminalReason` breakdown
     across many DIFFERENT books would at minimum answer the frequency
     half of the question, which the single-book sample explicitly
     could not.
  3. **Are the `titleOk` 0.15 bar (GrailKey Dispatch 15 Fix 1) and the
     vision-zero-support ratio floor (Dispatch 15 Fix 2) actually
     catching real cases, or firing on nothing?** Both shipped against
     specific cited production misses at the time, but neither has a
     structured way to check its ongoing hit rate — today that would
     mean a fresh runtime-log sweep for each, the same reach-limited
     approach that produced two unanswerable measurements this session.
     Not yet a field on the scanlog record — closing this specific
     question would need `familyIssueConsensus`'s `titleOk` value (and
     whether the zero-support override path was taken at all) added to
     `buildScanLogRecord`'s schema before it's queryable. Recorded here
     as a real gap in the CURRENT schema, not just an open question —
     v1 doesn't carry what this specific question needs; a v2 addition
     is the honest next step if this is prioritized, not a query against
     data already being collected.

- **GrailKey Dispatch 25 (2026-08-07) — unanimous-consensus identity
  unblock. Fix 1 STEP 1 shipped, bare-title hypothesis KILLED, Fix 1/
  Fix 2 confirmed as one root cause, GK-35 opened.**

  **Repro (locked, reproduced twice on demand):** Spawn #351 Cover C
  Brett Booth Virgin Variant, two scans (22:08:43 and 22:16:19 UTC,
  build `b926dba`), identical failure both times — `ID_REQUIRED`, no
  price, listing blocked, despite unanimous marketplace evidence
  (`[commit4] issueAuthority=provisional (marketplace-only-adoption):
  issue=#351 support=4/4=100%`).

  **Step 0/0b locations (`git grep`, verified structurally, not from
  memory):** `[evidence-eligibility]` (`api/comps.js:2238/2250`, inside
  `fetchComps`); `[commit4] issueAuthority` (`api/enrich.js:3011`
  provisional-adoption, `:9302` conflict-escalation, both inside the
  single `handler` function — confirmed no nested function boundary
  anywhere in `api/enrich.js` between lines 2158–10600); `[commit4-
  terminal]` (`api/enrich.js:10549`, also inside `handler`); `[22e-LOSS]`
  (three print sites — `src/lib/identityCore.js:352`/`:386` inside
  `checkAssemblyIntegrity`, and `api/enrich.js:6102` inside `handler`,
  its own wrapper log around calling that function a second time in
  "Phase 2"); `[identity-gate] REFUSED` (`api/enrich.js:7403`, inside
  `handler`). Step 0b — the actual Phase 1 force behind the repro's
  title revert — `api/enrich.js:3266` (`writeConfirmed(...,
  '22e-force')`, inside `handler`, calling `checkAssemblyIntegrity` at
  line 3254 — runs BEFORE the `fetchComps` call site at line 5689, which
  is why this site and not the Phase 2 one at 6102 is the one that could
  have affected `evidenceTarget.seriesTitle` at classification time).

  **Fix 1 STEP 1, SHIPPED — instrumentation only, zero behavior
  change.** `classifyEvidenceRow` (`src/lib/evidenceEligibility.js:245`)
  now returns a `rejectionDetails` array alongside the existing
  `rejectionCodes` — one entry per code, pairing it with the exact
  predicate/values that produced it. `buildPricingEligibleRows`
  (`evidenceEligibility.js:824`) now logs `[evidence-eligibility-reject]`
  once per row it filters out, naming the specific `PRICING_GATE_CODES`
  entry(ies) that blocked it. `fetchComps` (`api/comps.js:2175`) now
  logs `[evidence-target]` once, printing the exact population every row
  is measured against. Every behavior-determining line
  (`rejectionCodes.push`, `identityEligible`, `rawPricingEligible`, the
  `isPricingMathEligible(...)` call itself) is byte-identical to before
  — confirmed via a 471-assertion regression sweep across the 9 suites
  that exercise this file, all unchanged, plus 22 new assertions
  (`tests/grailkey-dispatch-25-fix1-instrumentation.test.js`).

  **Bare-title hypothesis — KILLED, not left open.** The original
  hypothesis (classification measures against `confirmedTitle="Spawn"`,
  the post-`22e-force` bare title, rather than the winning family, so
  variant-specific comps fail a title predicate they already passed
  upstream) is refuted at the code level, confirmed by a direct test
  (`grailkey-dispatch-25-fix1-instrumentation.test.js`, Section 2): a
  row reconstructing the repro's exact shape
  (`issueAuthorityPresent=true, issueAuthorityStatus='provisional'`)
  rejects on `TARGET_ISSUE_PROVISIONAL_AUTHORITY` alone — no
  `WRONG_ISSUE`, no `WRONG_VARIANT` — **despite a title that would
  otherwise match on both axes**. Swapping in a row title with zero
  relation to "Spawn"/"351" produces the byte-identical single rejection
  code, proving the result does not depend on title content at all:
  `TARGET_ISSUE_PROVISIONAL_AUTHORITY` (`evidenceEligibility.js` ~line
  322) is an `else if` branch mutually exclusive with `WRONG_ISSUE` —
  when it fires, `hasIssueNumber()` (the actual title/issue text check)
  is never evaluated for that row, regardless of what
  `evidenceTarget.seriesTitle` holds. The 22e-force mechanism (Step 0b)
  is real and does revert `confirmedTitle` to Vision's bare title in
  this exact scan, but that revert is irrelevant to why these 14 rows
  were eliminated — a genuinely different mechanism, evaluated earlier
  in the same `if`/`else if` chain, got there first.

  **Fix 1 and Fix 2 are one root cause, not two — confirmed, all four
  cited blocks verified present in this exact repro's log shape, not
  assumed from the claim alone.** `out.issueAuthority.status ===
  'provisional'` (Commit 4's marketplace-only-adoption) independently
  gates four separate blocks, all keyed off the identical field:
  1. CV/PC exact-identity lookup skip — `[commit4.3.1] exact-identity
     cv/pc: lookup SKIPPED — issueAuthority.status="provisional"`.
  2. Active-comps cache skip — `[active-cache] SKIP:
     issueAuthority.status="provisional" — marketplace-only-adopted
     issue not cached (Commit 4)`.
  3. Evidence-eligibility 14→0 elimination — this dispatch's own
     finding, above: `TARGET_ISSUE_PROVISIONAL_AUTHORITY` in
     `PRICING_GATE_CODES` rejects every row unconditionally.
  4. `commit4-terminal` forcing `ID_REQUIRED`, clearing price authority,
     locking the listing (`api/enrich.js:10549`).
  A single upstream promotion (provisional → confirmed, under the strict
  unanimous-consensus predicate specified below) resolves all four
  simultaneously, since none of the four has any logic of its own beyond
  reading this one field. **Fix 2/2b SHIPPED (commit `81ca1d2`)** — see
  the dedicated writeup below for the final predicate, the year-axis
  correction found during plan review, and the V4 safety-regression
  closure.

- **GK-35 (2026-08-07, GrailKey Dispatch 25) — `PRICING_GATE_CODES`
  covers only 6 of 14 `classifyEvidenceRow` rejection codes; the other
  8 have zero redundancy at the pricing layer. LOGGED ONLY, not
  scoped or acted on this session, per explicit instruction.** Found
  while writing Fix 1 STEP 1's regression test (a wrong test assumption
  — that `LOT_OR_BUNDLE` would block `buildPricingEligibleRows` —
  failed and revealed this directly, not inferred from documentation).
  `PRICING_GATE_CODES` (`evidenceEligibility.js:802`) = `[INCOMPLETE_COPY,
  RESTORED_COPY, FORMAT_MISMATCH_RAW_VS_SLAB, UNCONFIRMED_EDITION,
  TARGET_ISSUE_UNRESOLVED, TARGET_ISSUE_PROVISIONAL_AUTHORITY]`. The
  other 8 codes `classifyEvidenceRow` can produce — `WRONG_VARIANT`,
  `WRONG_PRINTING`, `WRONG_ISSUE`, `WRONG_YEAR`, `SIGNED_MISMATCH`,
  `LOT_OR_BUNDLE`, `COLLECTED_EDITION_MISMATCH`,
  `FORMAT_MISMATCH_GRADED_VS_RAW` — do NOT block
  `isPricingMathEligible`. A row carrying ONLY one of those 8 codes
  (`identityEligible=false` inside `classifyEvidenceRow`, per that
  function's own determination) still passes `buildPricingEligibleRows`
  and can enter `fetchComps`'s pricing pool. This is deliberate,
  documented design (`evidenceEligibility.js`'s own Track B Phase 0
  Commit 1 comment: those 9 original codes — now 8, `TARGET_ISSUE_
  UNRESOLVED` having since been added to the gate — "already locked in
  by tests/q-commitD1.1-collision-aware-eligibility.test.js's
  LEGACY_OVERLAPPING_CODES assertion... the existing, more nuanced
  api/comps.js/soldVerification.js filter chains already enforce these
  with edge-case handling this narrower classifier doesn't replicate")
  — `classifyEvidenceRow` was designed as a SECOND, narrower layer
  covering gaps in the legacy filter chains specifically, not a full
  redundant re-check of everything the legacy chains already do. That
  design intent is real, but its practical consequence is what this
  finding names: variant/issue/printing/year correctness at the
  pricing-math layer currently has exactly ONE line of defense (the
  legacy `api/comps.js`/`soldVerification.js` filter chains) for 8 of
  14 possible mismatch classes, not two. Directly relevant to this
  session's own virgin-variant repro: if a future scan's legacy filter
  chain ever admits a wrong-variant row (e.g. a Cover B listing
  contaminating a virgin-variant pool) that `classifyEvidenceRow`
  correctly flags `WRONG_VARIANT` on, that row still prices — the
  narrower classifier's correct identification provides zero backstop
  for 8 of its own 14 possible findings. Not scoped, not fixed, no
  threshold or gate touched this session — flagged for a future
  dispatch to decide whether closing this gap (widening
  `PRICING_GATE_CODES`, and re-running the Commit 1 audit that
  originally decided against it) is warranted, given the legacy chains'
  own edge-case handling was the stated reason it wasn't done at the
  time.

- **GrailKey Dispatch 25, Fix 2/2b SHIPPED (2026-08-07, commit `81ca1d2`)
  — unanimous-consensus promotion of `issueAuthority.status`, plus a
  third "wrong population" instance found in plan review, plus a safety
  regression found in the same review before push.** Closes the four
  blocks enumerated in the entry above by promoting
  `out.issueAuthority.status` from `'provisional'` to `'confirmed'`
  ONLY under a strict, all-of predicate — never a general loosening.

  **Fix 2 (issue axis) — `evaluateUnanimousConsensusPromotion`
  (`src/lib/issueAuthority.js`).** Promotes only when: family
  `uniqueRows >= 4`; `support === uniqueRows` (exact unanimity, integer
  equality, not a ratio threshold); `runnerUp === null` (no second-place
  candidate exists at all — confirmed via direct source read that
  `resolveFamilyIssueConsensus` returns literal `null` here, not a
  string `'none'`, which only appears in one display-only log template
  downstream); family `weightSum >= 8.0`; every contributing row has a
  distinct `itemId` AND a distinct `sellerUsername` (new
  `checkDistinctItemIdAndSeller` helper — guards against a single seller
  cross-posting the same claim under several listings inflating
  `uniqueRows` without genuine independent corroboration). Any one
  condition failing declines outright; current pre-Dispatch-25 behavior
  is unchanged on decline. Logs `[commit4-promote]` with every input on
  both the promote and decline paths.

  **Fix 2b (year axis) — third recorded instance of "measuring
  coherence against the wrong population."** The first two instances of
  this class are the launch-era vision-zero-support defect and the
  Bone #1/GK-34 sold-pool-size-floor family documented earlier in this
  file. This is the third, found during plan review (not shipped, then
  caught by tests) — the user explicitly required a verification step
  before any code was written. `resolveFamilyYearConsensus`'s own
  `uniqueRows`/`support` fields (`identityCore.js:1234`) are NOT
  assertion counts — `uniqueRows` increments for every deduped family
  member regardless of whether that row carries a parseable year at all
  (line 1278), while `support` (the field this dispatch initially
  proposed reusing directly) only increments for rows that DO assert a
  year (line 1281-1282). Naively reusing `support === uniqueRows` as the
  unanimity check would therefore count a SILENT row (no year token in
  that listing's title — neutral, no claim made) as equivalent to a
  DISSENTING row (a different year explicitly asserted) — both would
  suppress promotion identically, when only the second is a real
  disagreement. Named explicitly per the user's instruction: **"silence
  counted as dissent."** Fixed by `evaluateUnanimousYearConsensusPromotion`
  recomputing directly from raw `indices`/`visualItems` rather than
  reusing the family-consensus object's aggregate fields at all: tallies
  only rows that assert a year (`analyzeYearAssertions`), requires
  `assertingCount >= 3`, requires zero dissent among the asserting rows
  (any asserting row naming a different year is a hard fail — the
  standing rule, "conservative direction preferred when uncertain," made
  explicit at the row level), and applies the identical
  itemId/seller-distinctness check as Fix 2. Verified directly against
  the real repro shape before shipping: 3 rows unanimously asserting one
  year, 1 silent row — would have wrongly DECLINED under the naive
  `support === uniqueRows` reuse (the silent row drags `support` below
  `uniqueRows`), correctly PROMOTES under the corrected, assertion-scoped
  predicate. On promotion, `'year'` is deliberately never appended to
  `identityProvisionalFields` (there is no removal primitive for that
  list; not appending in the first place is the correct representation
  of "no longer provisional").

  **V4 — found in review before push, not by any test: "status
  promotion orphans a status-gated guard."** Fix 2's promotion
  unconditionally unlocked two things at once: the CV/PC exact-identity
  lookup and active-cache paths that were correctly skipped while
  provisional, AND `escalateIssueAuthorityOnConflict`
  (`issueAuthority.js`), which existed before this dispatch specifically
  to re-escalate a marketplace-only-adopted issue back to `'conflicted'`
  if later evidence disagreed with it. That function's original guard
  checked `status === 'provisional'` only — so a row promoted to
  `'confirmed'` by Fix 2 could never re-escalate again, even on a
  genuine later contradiction. **A safety regression shipped inside a
  safety fix**, and the general lesson is the point worth keeping: any
  code path that promotes/upgrades a status field must grep every
  consumer that gates on the PRE-promotion value before shipping — a
  promotion is not just "this row is now trusted more," it is also
  "every guard that only fires on the old, lower-trust status now goes
  silently dark for this row." Nothing in Fix 2's own test suite caught
  this, because nothing in that suite exercised the conflict-escalation
  path against a promoted row — it took a second, explicit review pass
  before push to find it, not a red test.

  The user explicitly forbade the obvious-looking fix
  (`status === 'provisional' || status === 'confirmed'`), since that
  would let ANY confirmed row — including one confirmed via the
  catalog/user-correction route, which this project's standing authority
  matrix (catalog holds identity authority, marketplace holds
  pricing-evidence authority only) treats as strictly higher-trust than
  marketplace consensus — be knocked back down by a mere marketplace
  pool disagreement. Verified directly against
  `manualCorrection.js:599-605`, the real other-confirmed route:
  `{source:'user', status:'confirmed', reasons:['user-correction']}` —
  no `'unanimous-marketplace-consensus'` reason present. Fixed with
  provenance instead of a loosened status check, reusing this file's own
  pre-existing convention rather than adding a new field: promotion now
  appends `'unanimous-marketplace-consensus'` to `issueAuthority.reasons`
  (the same array `escalateIssueAuthorityOnConflict` already read for its
  provisional-case check, `reasons.includes('marketplace-only-adoption')`
  — the array was already the live provenance mechanism in this file
  before this session touched it). `escalateIssueAuthorityOnConflict`'s
  eligibility is now `(status==='provisional' && reasons.includes(
  'marketplace-only-adoption')) || (status==='confirmed' &&
  reasons.includes('unanimous-marketplace-consensus'))` — a confirmed
  row is only escalatable if its OWN reasons explicitly say it arrived
  via this dispatch's marketplace-consensus route; the user-correction
  route's `reasons` array never contains that string, so it structurally
  cannot be knocked back down by marketplace disagreement, preserving the
  authority matrix by construction rather than by convention.
  `computeIssueAuthorityContractPatch` verified (not assumed) to already
  handle `'conflicted'` uniformly regardless of which status it
  escalated from — no `escalatedFrom`-style branching exists anywhere in
  that function, so no change was needed there. The one real
  escalation call site (`api/enrich.js`) now captures `originStatus`/
  `wasPromoted` before calling and logs which origin produced a given
  `'conflicted'` outcome, so a promoted-then-conflicted row is
  distinguishable in logs from a provisional-then-conflicted one.

  Regression: `tests/grailkey-dispatch-25-fix2-unanimous-promotion.test.js`,
  38 assertions — sections 1-8 cover Fix 2/2b promote/decline cases
  including the exact real repro shapes for both axes; sections 9-12
  (added for V4) cover promoted-confirmed+conflict escalates,
  catalog/user-confirmed+conflict does NOT escalate (the proof this fix
  is provenance-scoped, not status-loosened), provisional+conflict still
  escalates (regression guard on the original mechanism), and
  promoted-confirmed+no-conflict stays confirmed (referential no-op).
  Full pre-existing suite sweep re-run clean after the V4 amend, working
  tree confirmed clean via `grailkey-commit-e`/`-f` going green (both are
  the pre-documented "false-fails on any uncommitted diff" tests
  elsewhere in this file — their passing here is itself part of the
  verification, not incidental). Fix 3 (Vision virgin-variant prompt
  change) remains explicitly HELD, not started this session.

  **PRODUCTION VALIDATION (2026-08-08, GrailKey Dispatch 27, build
  `4f9a62c`).** The Spawn #351 re-scan that motivated Dispatch 26 landed
  on `mode==='adopted'` — Fix 2/2b's own path, not Fix 4/4b's — and
  validated both fixes directly against real production data, verbatim:
  ```
  [commit4-promote] PROMOTE issue=#351 uniqueRows=4 support=4
    runnerUp=null weightSum=11 uniqueItemIdCount=4/4
    uniqueSellerCount=4/4 — provisional -> confirmed
  [commit4-promote-year] PROMOTE year=2024 assertingRows=3 silentRows=1
    dissentingRows=0
  [evidence-target] issueAuthorityStatus="confirmed"
  [evidence-eligibility] activeInput=14 rawPricingEligible=14 rejected=0
  ```
  The year promotion is the EXACT Fix 2b corrected-denominator shape
  this entry documents above (3 asserting rows, 1 silent, 0 dissent) —
  under the naive `support === uniqueRows` reuse Fix 2b replaced, this
  would have wrongly declined (`support=3 !== uniqueRows=4`). Confirmed
  live, not just in the regression fixture: zero comps eliminated
  (`rejected=0` of 14), the book priced. Fix 4/4b (this same session,
  GrailKey Dispatch 26) shipped alongside this validated path but were
  NOT exercised by this scan — record that distinction explicitly: Fix
  2/2b is production-validated; Fix 4/4b remains shipped but
  UNVALIDATED in production, pending a scan that actually reaches the
  `mode==='conflict-locked'`/zero-support shape.

- **GrailKey Dispatch 25, Fix 2c (2026-08-07) — Batman #213 class:
  title-family weight margin was reported as an issue-authority
  conflict.** `identityCore.js`'s near-miss margin-decline branch
  (Commit 4.3.1, `isNearMissMarginDecline`) measures its 3x dominance
  requirement purely on TITLE-FAMILY WEIGHT
  (`familyDominatesRunnerUp(topFamily.weightSum, runnerUp.weightSum)`,
  `compHygiene.js:203-206`) — zero awareness of what issue number either
  family's own rows assert. A real production scan (Batman #213, scan
  23:13:49 UTC, build `b2c7358`) hit this: two competing TITLE clusters
  ("batman giant 30th anniversary issue origin robin" vs "batman dc"),
  margin 1.3 against a required 3 — but every row in BOTH clusters, and
  the raw pool overall (19/19), asserted issue #213. Verified by direct
  source read (STEP A, before any code was written): the near-miss
  branch only ever measures `resolveFamilyIssueConsensus` against
  `topFamily.indices` — `runnerUp.indices` was never read at all — so it
  wrote `outcome:'conflicted'` unconditionally whenever the margin
  failed, regardless of whether the competing family agreed. That false
  conflict reached the card verbatim via `api/enrich.js`'s
  `out.issueConsensusConflict` construction
  (`identity.familyIssueConsensus?.mode==='conflict-locked'` gate,
  ~line 2935): "Marketplace listings disagree on this book's issue
  number" — false when every row agrees. Wrong axis, the same disease
  class as Fix 2b's denominator and vision-zero-support.

  Fix: before recording a conflict, measure the DISTINCT set of issues
  asserted by the top family AND by the runner-up (the only competing
  family the margin predicate itself concerns — it is `scored[1]`, the
  sole family ever compared against `scored[0]`). Agreement requires
  UNANIMITY, not plurality: both families' own asserted-issue sets must
  each have size exactly 1, and those two single values must match. If
  so, there is no issue conflict — `familyIssueConsensusResult` is left
  `null` (not populated with a new "agreed" pseudo-state) so every
  downstream consumer evaluates the field exactly as if no near-miss had
  occurred at all. A genuine disagreement — either family internally
  split, or both unanimous but on different issues — is unaffected, same
  `'conflicted'` outcome as before, confirmed unchanged against the
  pre-existing 73-assertion
  `q-trackB-commit4.3.1-retention-decline-fail-closed.test.js` suite
  (its own fixture's runner-up is a lot listing with no coherent issue
  of its own — correctly still conflicts under the fix).

  **Two implementation traps found and fixed before shipping — both
  caught by the user's own review, not by the first-pass test suite.**
  (1) The obvious choice, comparing `resolveFamilyIssueConsensus(...).issue`
  on both families, is silently wrong: `.issue` is gated behind the
  standing uniqueRows>=3 adoption floor (the "Issue-consensus guard"
  standing constraint elsewhere in this file) — a real 2-member
  synthetic runner-up family whose both rows plainly assert the same
  issue returns `{issue: null, mode: 'no-consensus', winner: '213', ...}`.
  Caught during test authoring, not static review: the first fixture
  attempt failed against `.issue` and revealed the floor directly. (2) A
  first-shipped correction reached for `.winner` (raw per-row PLURALITY)
  instead — this is a SECOND, more dangerous defect, caught only in
  review before push: `.winner` is populated the instant a single
  non-tied top candidate exists, regardless of whether every row agrees.
  A 3-row runner-up with two rows asserting #213 and one asserting #300
  has `.winner==='213'` — plurality — so the `.winner`-based version
  would have suppressed a GENUINE conflict on live dissent. Explicitly
  named as the fourth instance this session of the "measuring coherence
  against the wrong population" disease class — and its own inverse of
  Fix 2b's bug: there, silence was wrongly counted as dissent; here,
  dissent would have been wrongly absorbed by plurality. Fixed by using
  `.assertedIssues` (the distinct SET of values a family's rows assert —
  `Object.keys(counts)` inside `resolveFamilyIssueConsensus`, entirely
  unfloored, same underlying tally `.issue`/`.winner` are both built
  from) and requiring its size be exactly 1 on BOTH families before
  calling it agreement — silence (a row asserting nothing) stays neutral
  per Fix 2b's own rule, but any row asserting a genuinely different
  value fails unanimity outright, regardless of how rare it is relative
  to the majority.

  Logs `[commit4.3.1-axis-check]` with `topFamilyAssertedIssues`,
  `topFamilyIssueCounts` (a local, read-only per-family tally —
  `tallyFamilyIssueCounts`, `identityCore.js` — deliberately mirroring
  `resolveFamilyIssueConsensus`'s own row-counting loop exactly rather
  than adding a field to that function's return shape, which is spread
  verbatim into `familyIssueConsensusResult` at multiple call sites, at
  least one of which has an existing exact-full-object-shape regression
  assertion — `q-trackB-commit4.2-fingerprint-year-restamp.test.js`,
  confirmed unaffected, still 160/160), `runnerUpAssertedIssues`,
  `runnerUpIssueCounts`, `topUnanimous`, `runnerUpUnanimous`, and
  `decision` on BOTH paths (agree/disagree) — never silent. 60 assertions
  (`tests/grailkey-dispatch-25-fix2c-axis-check.test.js`, up from an
  initial 31 before the unanimity correction): the real near-miss shape
  (genuinely emergent weights from real row positions, not hand-set) for
  the agreement case (Batman #213 itself, some rows silent elsewhere in
  the wider pool), a full-disagreement regression guard (both families
  unanimous but on different issues), a no-runner-up sanity check, and —
  the two cases the plurality defect required — a runner-up internally
  split 2x#213/1x#300 (conflict correctly stands; this fixture is proven
  to be exactly the shape that would have wrongly agreed under the
  rejected `.winner`-based version) and a top family internally split
  (conflict stands regardless of a unanimous runner-up). Full
  pre-existing suite sweep re-run clean; `npm run build` clean.

  **Regression-baseline discipline (V-A, per explicit instruction):**
  every failing suite in the post-fix sweep was individually checked
  against a clean `git worktree` at `bf543d6` (the commit immediately
  preceding Dispatch 25's first commit), not summarized as "matches
  documented baseline." `artist-registry-sync` (163/2),
  `decision-engine` (39/7), `image-search-extraction` (161/2),
  `mega-keys` (198/8), `pattern-k-dedupe-issue` (4/4), `priceBands`
  (24/7), `sold-verification` (124/5), `comp-filter-hygiene`,
  `identity-gate`, `q-adv397-visual-guard`, and `batch1-fixes`
  (throws-on-first, same first assertion) all reproduce byte-identical
  failures at `bf543d6` once the worktree's missing `node_modules`
  symlink was fixed (a worktree doesn't share `node_modules`, which
  isn't git-tracked — the first baseline run threw
  `ERR_MODULE_NOT_FOUND` for unrelated files, not a real difference).
  `grailkey-commit-m-pc-query-fallback` and `ship26-integration` both
  time out identically at `bf543d6` too (network-dependent — no
  `KV_REST_API_URL`/PriceCharting token in this sandbox). `grailkey-
  commit-v1`'s drift was already proven pre-existing earlier this
  dispatch (checked out `bf543d6`, same 24-vs-25 mismatch, unrelated to
  Dispatch 25 entirely). `grailkey-commit-e`/`-f`/`-g` are the
  documented "false-fail on any uncommitted diff" tests (`git diff
  --name-only HEAD` against the live working tree, not the historical
  commit diff) — expected to fail whenever ANY uncommitted change
  exists, which one genuinely did at sweep time; `-g`'s own failure text
  names the exact extra file (`src/lib/identityCore.js`), confirming the
  mechanism directly rather than by assertion. All three go green
  immediately upon commit (already demonstrated twice earlier this
  dispatch, for `81ca1d2` and again expected here).

  **Downstream investigation, reported not fixed blind (per explicit
  instruction) — `confirmedPublisher` resolving to `null` on this same
  book. CORRECTED after an initial reported comp-title count turned out
  wrong (a misread of a different log figure, `[cv-pool-year-hint]`'s
  11/11 year-agreement, not a DC publisher count).** Real counts from
  the 19 visual titles: "DC Comics" exact phrasing 3/19 = 15.8%; any
  form including bare "DC" 7/19 = 36.8%. Two independent publisher paths
  exist. (1) `comicVine?.publisher` fallback (`api/enrich.js:4594`) is
  genuinely gated on the CV/PC exact-identity lookup skip
  (`marketCustodyConflicted`, driven by `out.issueAuthority.status===
  'conflicted'`) — Fix 2c resolves this one for free, since the
  axis-agreement case no longer sets that status. (2)
  `backfillFromComps`'s comp-consensus publisher backfill
  (`identityCore.js:2668`, called `api/enrich.js:4539`) reads
  `visualResult?.items` directly and is NOT gated on `issueAuthority` at
  all. Verified precisely against source: `hitRatio`'s denominator
  (`identityCore.js:2824`) is `compTitles.length` — essentially the full
  comp pool — not narrowed by the separate `titleMatchRatio>=0.7`
  precondition gate a few lines up, which only decides whether ANY
  publisher-backfill attempt is allowed at all, not which titles count
  toward the ratio. Against the `>=0.5` backfill floor, **both real
  counts fail** — even the generous "any form" figure (36.8%) falls
  well short. Confirmed: on this specific book, the bare-word "DC"
  pattern gap (found while investigating, real as a general observation
  — see GK-37 below) would NOT have rescued publisher resolution either
  way. `confirmedPublisher` on Batman #213 resolves only via the CV/PC
  path Fix 2c unblocks — not via comp-consensus regardless of pattern
  coverage. The pattern gap itself is downgraded to its own logged
  finding (GK-37), explicitly not scoped as part of Fix 2c.

- **GK-36 (2026-08-07, GrailKey Dispatch 25) — `[ship11]
  visual_pool_fallback` median is not grade-scoped. LOG ONLY, not
  scoped or acted on this session, per explicit instruction.**
  `api/enrich.js:9149-9184`: when the primary comp pipeline returns zero
  verified/sold comps and the eBay visual-similarity pool has >=10 items
  with >=5 valid prices, the block computes `median`/`low`(p25)/`high`
  (p75) directly from `poolPrices` — every priced item in the visual
  pool, unconditionally, with **no grade filter of any kind** against
  the book's own actual grade. Confirmed via direct source read: the
  only filters applied are `Number.isFinite(p) && p > 0 && p < 10000`
  (numeric sanity), nothing grade-related. Reported on a real GD 2.0
  book: `median=$71.85` from a pool spanning VG through VF/NM
  ($34.99-$153.00) — not representative of the book's actual condition.
  `out.pricingSource`/`out.price` ARE set to this value when the block
  fires (lines 9165-9175), so on a book where this is the terminal
  pricing path it would be the shown price, not merely a reference
  figure — worth re-checking against the specific request that surfaced
  this the next time it's investigated, since "not used as price here"
  implies some other path won out on that particular scan. Not scoped,
  not fixed, no threshold touched.

- **GK-37 (2026-08-07, GrailKey Dispatch 25) — `PUBLISHER_CONSENSUS_PATTERNS`
  has no bare-word fallback for major publishers (DC/Marvel/Image/etc.).
  LOG ONLY, not scoped or acted on this session — explicitly downgraded
  out of Fix 2c after V-B correction (see that entry above): confirmed
  NOT the cause of Batman #213's `confirmedPublisher=null`, since even
  the generous "any bare-DC form" count (36.8%) falls short of the
  backfill floor on that specific book.** `identityCore.js:2572-2600`:
  DC's entry is `\b(?:dc\s+comics?|dc\s+universe|dcu)\b` — requires "DC"
  followed by "Comics"/"Universe," or the exact token "DCU." No bare-word
  "DC" pattern exists, unlike Charlton/Eclipse/Warren, which explicitly
  got one added (same list, Q96 comment) specifically because casual
  eBay listing titles often drop "Comics." Marvel/Image/Dark
  Horse/IDW/BOOM!/Valiant/Archie share the identical shape — full-name-
  only, no bare-word fallback — while several smaller indies do have
  one. This is a real, general asymmetry in the pattern table (the
  publishers most likely to be shortened casually in listing titles are
  exactly the ones with no fallback for it), independent of any single
  book's resolution. Not scoped, not fixed, no pattern added — a future
  dispatch should decide whether adding bare-word fallbacks for the
  major publishers is warranted, and if so, whether a higher hit-ratio
  floor is needed for a bare 2-letter/short token to avoid false
  positives that "DC Comics"/"Marvel Comics"-style full phrases don't
  risk.

- **"Measuring coherence against the wrong population" — four instances
  in one session (2026-08-07, GrailKey Dispatch 25). The frequency is
  itself the finding.** (1) vision-zero-support's `visionIssueCount===0`
  equality check (prior dispatch, referenced in this session's Fix 1/2
  root-cause work) measured presence against the WRONG population
  boundary (exact-zero vs. near-zero support). (2) Fix 2b's year-axis
  promotion predicate: `resolveFamilyYearConsensus`'s own `support`/
  `uniqueRows` denominator is family MEMBERSHIP (every row, silent or
  not), not ASSERTION — a naive reuse would have counted a silent row
  against unanimity exactly like a dissenting row ("silence counted as
  dissent"). (3) Fix 2c's first draft: `.issue` is gated behind the
  unrelated uniqueRows>=3 adoption floor — a real 2-member family that
  unanimously agrees returns `issue: null` anyway, because the FLOOR's
  population (rows needed to trust ADOPTION elsewhere) is not the
  question being asked (do these rows agree with each other at all).
  (4) Fix 2c's second draft: `.winner` measures PLURALITY across a
  family's rows — the wrong population is "the majority" when the actual
  question is "every row, including the minority." A 2-of-3 majority
  read as agreement while a real dissenting row sat in the pool
  unexamined.
  Every instance has the same shape: a value or threshold that is
  correct and well-tested FOR THE QUESTION IT WAS ORIGINALLY BUILT TO
  ANSWER gets reused for a DIFFERENT question that sounds similar but
  scopes a different population — adoption-worthiness vs. mere
  agreement, membership vs. assertion, majority vs. unanimity. None of
  the four were caught by writing the predicate correctly the first
  time; all four were caught by either dedicated verification steps or
  by review before push, never by intuition about what a field named
  `.issue` or `.winner` "obviously" measures.
  **Standing check, going forward: before writing any consensus or
  agreement predicate, name the population the CANDIDATE FIELD actually
  measures and the population THE QUESTION AT HAND is actually about,
  and confirm the two match, in writing, before the code is written —
  not after a test fails.** This is now the highest-yield single check
  available for this class of bug in this codebase, evidenced by a 4-for-4
  hit rate in one session once someone started asking it explicitly.

- **CORRECTED (2026-08-08, GrailKey Dispatch 26, before any code was
  written) — Dispatch 26's own opening diagnosis was wrong about WHICH
  gate blocked the Spawn #351 (Cover C Brett Booth virgin variant) family
  alternate, and the wrong framing is retracted here rather than left
  standing.** The dispatch's initial repro writeup attributed the miss to
  "a TITLE-axis block suppressed an ISSUE-axis adoption" — i.e., Q84's
  title-safety gate (`family.decision === 'fallback-vision'`). Verified
  false by direct source read (STEP A, `identityCore.js`) before any fix
  was scoped: Commit 4.3's retention branch (`isQualifiedFamilyForRetention`,
  ~line 2031) exists specifically to survive a Q84 title-axis block, and it
  fired correctly on this exact scan — the family's 4/4=100% unanimous
  issue consensus (`#351`, weightSum 13.0) WAS measured and reached
  `decideFieldAuthority` (`identityCore.js:1505`). Q84 is not the gate that
  discarded the alternate; Commit 4.3 already defeats that mechanism, as
  designed.

  The real gate is `decideFieldAuthority`'s Rule D (`identityCore.js:1561-1564`,
  GrailKey Dispatch 25's own IMPLEMENTATION PACKET HOLD): a Vision prior
  that is untrusted (`priorIndependentlyTrusted=false`) but self-reports
  `confidence:'high'`, with ZERO support inside an otherwise-unanimous
  qualified family, is deliberately routed to `outcome:'conflicted',
  authoritativeForCustody:false` rather than silently adopting the
  family's value — a design decision from Dispatch 25 to protect a
  confident Vision read from being silently overridden. `legacyModeFor`
  then maps that to the legacy mode `'conflict-locked'`
  (`identityCore.js:2095`), which fails `familyAuthoritySkip`'s
  `mode==='adopted'||'corroborated'` check (~line 2338), and the
  zero-support ESCALATE branch (~line 2361) falls through to a check of
  the RAW, unclustered pool's `ebay.issue`/`ebay.noIssueConsensus` only —
  never re-consulting `familyIssueConsensusResult`, which is fully present
  at that point but was already read once (for the coarse skip check) and
  discarded.

  Net effect unchanged from the dispatch's original conclusion (a real,
  unanimous family alternate is discarded in favor of ID_REQUIRED) — only
  the MECHANISM was misattributed. Filed as its own entry, not folded into
  the "wrong population" pattern above: this is a different disease
  (correct population, correct measurement, but a confidence-based override
  rule applied to a case — Vision confident on a virgin variant with no
  printed issue number, 0/20 raw-pool support, 0/4 family support — where
  the self-reported confidence itself has no corroboration and should not
  have earned the veto). Fix 4 (scoping in progress) targets Rule D's
  confidence carve-out directly, not the population-measurement class of
  bug this correction sits next to.

- **"Independent posting is not independent identification" (2026-08-08,
  GrailKey Dispatch 26, Fix 4 scoping) — caught by asking the risk
  question before shipping, not by a test.** While scoping Fix 4's
  zero-support rescue predicate (reuses `evaluateUnanimousConsensusPromotion`,
  `issueAuthority.js`), the question "construct a case where Vision is
  right and a unanimous, distinct-seller family is wrong" produced a
  concrete, realistic answer: eBay sellers routinely copy a competitor's
  listing title verbatim for search-ranking reasons (a well-documented,
  non-adversarial marketplace behavior, not collusion). If the first
  seller to list a hard-to-identify book (a no-printed-issue-number
  virgin variant, exactly Fix 3's target class) mislabels it, later
  sellers copying that title text propagate the identical wrong number
  under their own distinct account, distinct item ID, distinct listing.
  `checkDistinctItemIdAndSeller` (`issueAuthority.js:188-210`) — the
  anti-collusion guard `evaluateUnanimousConsensusPromotion` already
  relies on for both the issue-axis and year-axis unanimous-promotion
  predicates (Fix 2/2b, this same dispatch) — answers "were these
  listings independently POSTED," which it does correctly. It cannot
  answer, and was never built to answer, "did these sellers independently
  IDENTIFY the book." Four distinct sellers carrying one propagated
  labeling error look identical, to that check, to four sellers who each
  independently read the cover and agreed.

  The fix is not a new axis of distrust — it's a signal already latent in
  the data. Copy-propagated titles are near-identical strings; independently-
  authored titles describing the same real book diverge in wording,
  ordering, and which details get mentioned. Verified directly against the
  real Spawn #351 repro's four family-member titles: pairwise Jaccard
  token-set similarity (the same metric `buildTitleFamilies` already uses
  for coarse family formation, `imageSearchIdentity.js:1046-1055`, reapplied
  within a family at a much higher threshold to detect near-duplicates
  rather than same-book clustering) separates one genuinely-copied pair
  (0.929) from every other pairing (0.368–0.538) with a clean gap — the
  two listings sharing the identical "cameo of lyra htf scarce" boilerplate
  phrase are the copy-propagated pair; the other two are independently
  worded. See Fix 4's sixth condition (title-text independence, ≥3 distinct
  clusters among asserting rows) for the shipped predicate.

  General lesson, stated for reuse: **any predicate that treats
  seller-distinctness or listing-ID-distinctness as evidence of
  independent corroboration is measuring the wrong thing** — distinct
  postings prove nothing about how many people actually looked at the
  book and formed an opinion, only that nobody technically reused an
  account. Anywhere this codebase leans on "N distinct sellers" as a
  trust signal (currently: `checkDistinctItemIdAndSeller`, both call
  sites) should be read as "N distinct postings, authorship not yet
  verified" until a text-independence check like this one is layered on
  top.

- **GK-38 (2026-08-08, GrailKey Dispatch 26) — Fix 2's issue-axis path
  renders a correction box on a book it just confirmed. LOG ONLY, not
  fixed this pass.** Found while reviewing Fix 4's own `out.issueAuthority`/
  `out.identityProvisionalFields` wiring (P1-1, same dispatch): Fix 2's
  promotion call site (`api/enrich.js`, the `mode==='adopted'` branch)
  calls `deriveIssueAuthorityFromAdoption`, which unconditionally returns
  `identityProvisionalFields: ['issue']` for the 'adopted' case
  (`issueAuthority.js:508`) — set BEFORE Fix 2's own promotion check
  (`evaluateUnanimousConsensusPromotion`) even runs, and never revisited
  afterward. When promotion succeeds and `out.issueAuthority.status`
  becomes `'confirmed'`, `out.identityProvisionalFields` still carries
  `'issue'` — `getCorrectableFields` (`manualCorrection.js:286-291`, real
  render site `App.jsx:6001`) unions `identityProvisionalFields` with
  `identityMissingFields` with no awareness of `issueAuthority.status` at
  all, so a Fix-2-promoted book renders an "Issue #" correction input
  exactly as if the issue were still an unconfirmed marketplace guess.
  Contrast Fix 2b (year axis), which already gets this right by design —
  its own doc comment: "'year' NOT appended to identityProvisionalFields
  at all... not appending is the only correct way to represent 'not
  provisional'" (there is no removal mechanism anywhere in this codebase,
  so the only way to avoid this state is to never enter it). Fix 4's own
  new rescue branch (this dispatch) was built correctly from the start —
  it never sets `identityProvisionalFields` for the field it confirms,
  matching Fix 2b's precedent rather than Fix 2's. Real, user-visible,
  pre-existing (Fix 2 shipped GrailKey Dispatch 25, 2026-08-07) — not
  touched here: fixing it means either making `deriveIssueAuthorityFromAdoption`
  promotion-aware (a signature change) or having Fix 2's own promotion
  block strip `'issue'` back out of `out.identityProvisionalFields` after
  a successful promotion (no removal mechanism currently exists for that
  either — would be the first). Scoping either belongs to its own
  dispatch, not folded into Fix 4/4b.

- **GK-40 (2026-08-08, GrailKey Dispatch 27) — three independent variant-
  token vocabularies, plus two same-named-but-different functions. LOG
  ONLY, its own dispatch, not consolidated here.** Found while diagnosing
  why a 16/20-consensus "virgin" signal (Spawn #351, real production
  scan) never reached `confirmedVariant` and, independently, why
  `soldVerification.js` rejected 11 real virgin sold comps outright. The
  fourth recorded instance of the drifted-duplicate-constant class
  (Q119/Q127/Q128 were the first three — all VALUE-level constants; this
  is the first at the FUNCTION/vocabulary level). Three separate lists,
  all encoding roughly "which physical cover-treatment terms exist,"
  independently extended over time:
  - `src/lib/compHygiene.js:extractVariantTokensByAxis`'s `coverType`
    axis — 3 tokens (`foil`, `virgin`, `sketch`), bare substring regex,
    no `\b` word-boundary. This is the ONLY one `soldVerification.js`
    (`:56,655-657`) actually reads when comparing a comp's title against
    `confirmedVariant`.
  - `src/lib/imageSearchIdentity.js:CATEGORY_BLOCKS`'s `'finish'` kind
    (`FINISH_PATTERNS`) — 10 tokens (adds `gold foil`/`silver foil`/
    `holofoil`/`holographic`/`glow-in-dark`/`embossed`/`metallic`),
    `\b`-bounded. Feeds `item.variantTokens` on every pool row
    (`imageSearchIdentity.js:407`) and `extractConsensus`'s own
    per-category consensus — this is where the real scan's `[image-
    search-titles]` log's `tokens:["virgin"]` actually came from.
  - `src/lib/compHygiene.js` ALSO exports its own, second,
    **identically-named** `extractVariantTokens` (line 1427) — a flat
    wrapper over its own `extractVariantTokensByAxis` — confusable with
    `imageSearchIdentity.js`'s unrelated `extractVariantTokens` (line
    262) of the same name in a different file. `variantIdentity.js`
    imports the `imageSearchIdentity.js` one; `soldVerification.js`
    imports the `compHygiene.js` one. Neither file's own token vocabulary
    is aware the other exists.
  Verified directly (not assumed): extracting via the richer
  `imageSearchIdentity.js` 'finish' list and feeding it into
  `confirmedVariant` would silently fail to round-trip for 4 of its 10
  tokens (`holographic`/`glow-in-dark`/`embossed`/`metallic` — none
  contain the substrings `foil`/`virgin`/`sketch` `compHygiene.js`'s
  narrower regex checks for) — confirming a variant `soldVerification`
  could never subsequently match, the exact "nothing changes" failure
  the fix this dispatch's own predicate had to route around. Fix 27-A
  (below) reads `compHygiene.js`'s narrower list specifically, BY
  CONSTRUCTION guaranteeing the round-trip, rather than consolidating
  the three vocabularies — a real, separate piece of work (which list
  should be canonical, whether the richer 'finish' set should be taught
  to `compHygiene.js`'s coverType axis or vice versa, and a rename to
  de-collide the two same-named `extractVariantTokens` exports) that
  belongs to its own dispatch, scoped and greenlit on its own, not folded
  into a pricing fix under time pressure.

  **GK-40 addendum (2026-08-08, GrailKey Dispatch 28) — a fourth
  independent variant-token vocabulary, found while diagnosing why
  `buildVerifiedActivePool`'s Q75 filter rejected the same 4 comps the
  variant preference filter had just accepted.**
  `src/lib/priceBands.js:329`, `VARIANT_CONTAM_ACTIVE = /\b(1:25|1:50|
  1:100|1:500|incentive|sketch|virgin|timeless|ratio|exclusive|
  convention|sdcc|nycc)\b/i` — its own bare hand-rolled list, matching
  none of the three named above. **Confirmed NOT the actual cause of the
  Q75 rejection** (GrailKey Dispatch 28 STEP A1): the real defect was a
  stale INPUT VALUE (`safeReqVariant`, pre-consensus, passed where
  `confirmedVariant` was needed — see the "deferred debt" entry below),
  not the vocabulary itself — even a perfectly shared vocabulary would
  have misfired against the wrong input. **Deliberately NOT touched**
  when the real fix shipped: with `confirmedVariant` correctly wired,
  `scanIsVariant` is true and this regex never evaluates for this class
  of book — the vocabulary divergence goes DORMANT, not fixed. Flagging
  explicitly: a future change that nulls or bypasses `confirmedVariant`
  on this code path reactivates this exact divergence. Left for the
  consolidation dispatch GK-40 already scopes.

- **"Deferred debt promoted to live by a downstream fix's success"
  (2026-08-08, GrailKey Dispatch 28) — a distinct class from GK-40's
  vocabulary drift and from the wrong-population family. SHIPPED.**
  `enrich.js:6529`'s `computePriceBandsFromSold` call passed
  `variant: safeReqVariant` (the raw, pre-consensus request field)
  instead of `confirmedVariant` — one wrong variable, two simultaneous
  symptoms: `buildVerifiedActivePool`'s Q75 filter (`priceBands.js`)
  saw a false `scanIsVariant=false` and rejected a book's own confirmed-
  variant active comps down to zero; `isActivePoolVariantConfirmed`'s
  `!variant` early-return starved GK-31's own already-shipped
  `activeAnchoredOverFallbackSold` mechanism — built specifically to
  anchor to a confirmed variant-matched active pool instead of blending
  in wrong-variant sold-fallback data — so it never got the chance to
  fire even though the exact condition it exists for was present.

  This was not a fresh oversight. `enrich.js:5152-5167` (Commit D2,
  2026-08-02) explicitly named this exact gap and consciously deferred
  it: *"req.body.variant itself is left untouched for its other
  existing consumers (variant-multiplier block, computePriceBandsFromSold,
  AI-verify prompt) — out of scope for this dispatch."* The gap sat
  inert for six days because `confirmedVariant` was categorically never
  populated from backfill at all before Fix 27-A (GrailKey Dispatch 27)
  — `safeReqVariant` and `confirmedVariant` were identical (both null)
  for any book reaching this shape, so the wrong-variable bug had no
  observable effect. The moment Fix 27-A started producing real,
  non-null backfilled values, the six-day-old deferred gap became
  load-bearing on the very next relevant scan.

  Fixed as a bare one-line substitution (`variant: safeReqVariant` →
  `variant: confirmedVariant`), not a composite re-guarded expression —
  verified, not assumed, that `confirmedVariant` already carries both
  guards `safeReqVariant` encodes (`suppressVariantForYearConflict` via
  two redundant paths — `safeReqVariant`'s own null-out, which seeds
  `confirmedVariant`, AND the separate `variantCheck = ... ? null : ...`
  gate on the pool-consensus update itself — and `variantProvenanceValid`
  the same way, plus Fix 27-A's own backfill path being independently
  safe regardless since it's scoped to `confirmedIssue` by construction
  via `filterItemsByIssue`). Re-deriving either guard a second time at
  the pricing call site would have been exactly the kind of redundant,
  independently-drifting logic GK-40's vocabularies show the cost of.
  Every other consumer of the same parameter audited (`buildVerifiedSoldPool`
  destructures `variant` but never reads it — confirmed dead, noted in
  its own doc comment so a future reader doesn't wonder).

  **The general check this implies, for reuse whenever a fix starts
  producing real values in a field that was categorically null/empty
  before: grep every consumer of that field, AND every sibling variable
  that was previously interchangeable with it while the field was
  always empty — the divergence between them only becomes observable
  once the field stops being empty, exactly like the value-vs-variable
  confusion this entry documents.**

- **Accepted residual risk (2026-08-08, GrailKey Dispatch 27, Fix
  27-A) — population contamination on `fallback-vision` variant
  extraction, defended by exact-unanimity, not by population-scoping.**
  `variantSourceItemsPreIssueFilter` (`api/enrich.js:5228-5233`) uses the
  FULL raw visual pool (not the winning title-family) whenever
  `familyCandidate.decision === 'fallback-vision'`, narrowed only by
  `filterItemsByIssue`'s per-row issue-number text match — never by
  title-cluster membership. Deliberately NOT reworked to scope to
  `family.topFamily.indices` instead: doing so requires either exposing
  a new "is this family qualified" signal out of `resolveIdentity`
  (`identityCore.js`'s `isQualifiedFamilyForRetention` is presently a
  local, unexported variable) or re-deriving that exact predicate a
  second time at the variant call site — the latter would be a FOURTH
  independently-drifting copy of the same population-qualification
  logic GK-40 already names one instance of, at the function-vocabulary
  level, and Q119/Q127/Q128 name at the value level. The existing
  raw-pool behavior is also deliberately load-bearing for the GENERAL
  `fallback-vision` case (Q115 dispatch, Batman #608: title-clustering
  itself found no coherent family at all, so scoping to a "family" would
  scope to nothing trustworthy) — reworking it purely for this dispatch
  risks reintroducing that exact regression for the many `fallback-
  vision` scans that never reach a qualified family.

  Instead, Fix 27-A relies on `evaluateUnanimousConsensusPromotion`'s
  own exact-unanimity requirement (`support === uniqueRows`) as the
  practical defense — identical reasoning, identical population, and
  identical residual risk to Fix 4's own issue-axis rescue, which
  already accepted this exact trade-off on this exact population. A
  contaminating row from a different, same-issue-number variant cluster
  would almost always assert either a different coverType token or none
  at all, failing exact unanimity and declining the whole rescue —
  fail-closed, consistent with the standing "when uncertain, leave
  null" principle. **Explicitly NOT a complete defense**: a
  contaminating row that coincidentally also asserts the SAME coverType
  token (e.g. a second, genuinely different virgin-variant product
  sharing the same issue number) would slip through either way, whether
  or not the population were family-scoped — narrowing to the family
  would not have closed this specific residual case either. Accepted
  as a known, named, residual risk rather than built around, per
  explicit instruction.

- **Fix 27-A PRODUCTION VALIDATION (2026-08-08, GrailKey Dispatch 28,
  build `75a2ba3`).** The Spawn #351 re-scan fired exactly as predicted,
  verbatim:
  ```
  [coverType-consensus] FIRE winner=virgin support=4/4 runnerUp=null
    promotion.declineReason=none uniqueItemIdCount=4/4
    uniqueSellerCount=4/4 independence.pass=true assertingRows=4
    distinctClusters=3 largestClusterSize=2 maxPairwiseJaccard=1
    minPairwiseJaccard=0.3888888888888889
  [identity-write] field=confirmedVariant from="" to="virgin"
    (source=ebay_image_consensus) site=variant-check-consensus fill=true
  [comps] variant preference filter: before=35 after=4 kept=4
    (match "virgin", mode=any, premium-variant isolation)
  [evidence-target] variant="virgin" issueAuthorityStatus="confirmed"
  ```
  Three distinct clusters on the real production pool (the copy-
  propagated pair scored `maxPairwiseJaccard=1.0` this time — a
  verbatim duplicate rather than the near-duplicate 0.929 seen during
  scoping; `minPairwiseJaccard=0.389` for the independents) — condition
  6 held on real, not synthetic, data. The active-comp variant
  preference filter (`api/comps.js`) correctly narrowed 35 candidates
  to the 4 real virgin listings ($21.25-$26.50) using the newly-
  confirmed variant. **Two further, previously-invisible bugs
  surfaced downstream once `confirmedVariant` stopped being null for
  the first time on this exact book** — `[Q75]` rejecting the same 4
  rows the variant preference filter had just accepted, and the sold-
  comp variant fallback re-admitting Cover A pricing data onto a now-
  confirmed-virgin book — both scoped as their own dispatch (GrailKey
  Dispatch 28), not fixed in this entry.

- **GrailKey Dispatch 28 PRODUCTION VALIDATION (2026-08-08, build
  `c95f1c8`) — verified via the card, not the runtime log.** Spawn #351
  re-scanned 2026-08-07 9:56 PM: headline price **$20.77** (was
  $5.49/$5.64 before Dispatch 27/28) — Price Bands Quick $18.06 /
  Market $20.77 / Stretch $23.88; Active Listings correctly shows the 4
  virgin comps, $21.25-$26.50, avg $24.43; "Price ready" checkmark set;
  the old $5.64 sold average correctly DEMOTED to a labeled reference
  line rather than driving the headline; no two-prices-on-one-card
  contradiction. Both symptoms confirmed resolved: Q75 no longer zeroes
  the active pool, and GK-31's `activeAnchoredOverFallbackSold` fired
  in production for the first time on record. (Note for anyone
  reviewing this session's transcript: a runtime log pasted alongside
  this card in the same message was from a DIFFERENT, unrelated scan —
  build `75a2ba3`, pre-Dispatch-28, a different book — and does not
  belong to this verification; the card is the evidence here, not that
  log.)

- **"The prompt told it to guess" (2026-08-08, GrailKey Dispatch 29,
  Fix 3a) — the fabricated "Spawn #1, 1992, high confidence" this
  session's own Fix 4/4b were built to survive was not a model
  hallucination.** `api/grade.js`'s `STANDARD_PROMPT` `year` clause, as
  shipped through GrailKey Dispatch 28, ended: *"Read it from the cover
  — do not guess. If year is not visible use context clues like art
  style, cover price, and characters."* That second sentence is an
  **explicit, standing instruction** to infer a year from recognizing
  the character/franchise when no printed year is visible — precisely
  what produced "1992" on a virgin variant with no cover date at all.
  The `issue` clause had the mirror-image gap: no absence guidance at
  all, leaving Vision free to default to "1" on any recognized
  first-issue-adjacent character with nothing telling it not to.

  The instinct on seeing a fabricated field is to suspect the model.
  The first place to look is the instruction actually given to it —
  named here as its own standing check, for reuse whenever a Vision
  field looks fabricated rather than merely wrong: **read the literal
  prompt text governing that field before assuming the model invented
  the value on its own.** Fixed by replacing (not appending after) the
  guess-from-characters sentence — appending would have left the
  prompt self-contradictory, with a real risk Vision keeps obeying the
  older, more specific instruction over a newer, more general one
  added alongside it. Same reasoning applied to the `issue` clause,
  which previously had no absence guidance to contradict but was given
  an explicit one for the same reason.

  Full wording and the asset-type-classification companion fix (a
  virgin/sketch/blank-cover variant recognized by physical book cues —
  staples, spine, interior page edges — rather than cover text) are
  Fix 3a, `api/grade.js`, both `STANDARD_PROMPT` and `WATCH_PROMPT`.
  Explicitly verified before shipping (per the standing risk-asymmetry
  discipline) that the new physical-cue wording does not weaken the
  existing poster/art-print/statue/toy disqualification — the gate
  requires positive physical-book evidence (staples/spine/page edges),
  not merely "the art looks like a comic," so a flat art print or
  poster fails it regardless of how comic-accurate the rendering is. A
  bound art-print-portfolio edge case was identified and deliberately
  NOT closed with a required paper-stock gate (Vision judging stock
  from a photo is unreliable and would trade a common virgin-variant
  false-negative for a rare portfolio false-positive) — added instead
  as a tiebreaker for the specifically-ambiguous case only (staples/
  spine visible, but stock/format suggests an oversized art object).

  **`shouldLiftAssetTypeAdvisoryLock`'s documented gap remains open,
  log only, not fixed here.** Its own Dispatch 19 doc comment already
  ran this exact Spawn #351 pool and found `hasCoherentConsensus ===
  false`, meaning it would not have qualified to lift the advisory
  lock even under its own merchandise/comic-vote conditions clearing.
  Fix 3a routes around this entirely for the virgin-variant class — if
  the prompt fix makes Vision report `assetTypeConfident=true`
  directly, the advisory-lock/lift mechanism never engages for this
  book at all — but the underlying gap is untouched and remains open
  for any pool where Vision still reports `assetTypeConfident=false`
  for other reasons.

- **Fix 3a SAME-DAY PRODUCTION REGRESSION, corrected as GrailKey
  Dispatch 30 (2026-08-08) — the physical-cues-required design was
  unsatisfiable by the way comics are normally photographed.** Fix
  3a's `assetTypeConfident` wording required a visible staple, spine,
  or interior page edge before treating a textless cover as a comic. A
  flat, straight-on cover photograph — the ordinary shape of a bulk-
  import scan — can never show any of those, comic or not. A real
  Spawn #351 virgin-variant bulk import returned "0 added, 1 failed…
  not a comic" the same day Fix 3a shipped. **Corrected direction:**
  a textless or minimally-texted cover at comic-cover proportions
  (~6.6 x 10.2 in) showing comic-style character art is a comic BY
  DEFAULT — `assetTypeConfident=true`. Physical-book cues, when
  visible, only STRENGTHEN that call; their absence is the ordinary
  case for a cover scan, never evidence against it. The
  paper-stock/"bound art portfolio" tiebreaker is dropped entirely —
  also unassessable from a flat scan, same root problem one level
  down. **Named misclassification gap, stated plainly rather than
  claimed airtight:** a poster deliberately printed at exact
  comic-cover proportions, photographed straight-on with no visible
  mat, mounting, or border, has no remaining discriminator besides
  aspect ratio and framing, and could pass. Accepted per the standing
  risk-asymmetry principle — a false "is a comic" is caught downstream
  by identity resolution and comp-matching (no real comps for a
  poster's fabricated identity); a false "not a comic" kills the
  workflow with nothing downstream to catch it.

  **GK-41, SHIPPED same commit — the actual bug the wording fix alone
  would NOT have resolved.** The bulk-import "0 added" hard-reject is
  `(!data.publisher && !data.year && !data.issue)` at both
  `gradeBlob` and `handleBulkImport` (`src/App.jsx`) — a gate fully
  independent of `assetTypeConfident`, never consulted by it. On a
  genuine virgin variant Vision now correctly returns null for all
  three, because Fix 3a's own (correct, kept) issue-null and
  year-null clauses are working exactly as designed. **The old
  year-guessing sentence Fix 3a removed had been accidentally
  load-bearing for this gate**: a fabricated "1992" kept the
  three-null clause from ever firing; removing the fabrication —
  correctly — exposed a downstream consumer that had never seen an
  empty value before. Named class, general check for reuse: **"a
  consumer depending on a fabricated value fails when the value
  becomes honest"** — one layer deeper than Dispatch 28's "deferred
  debt promoted to live by a downstream fix's success" (same shape:
  a fix makes a field honest for the first time, and a latent
  consumer that only ever saw the dishonest version breaks). When a
  fix replaces a fabricated value with null, grep every consumer that
  tests that field for presence — a truthiness check written against
  a field that was never empty is a latent hard failure.

  Fix: `(!data.publisher && !data.year && !data.issue &&
  data.assetTypeConfident !== true)` at both call sites — the
  three-null clause is bypassed only when Vision itself affirms
  `assetTypeConfident===true`. Deliberately NOT also re-gated on
  `data.title` in the new conjunct: `!data.title` already forces
  rejection via the first clause in the same `||` chain, so repeating
  it would be dead logic dressed as a safeguard — the exact shape
  GK-40's duplicated-vocabulary drift warns against. Slipped-through
  case, bounded and accepted: Vision wrongly asserts
  `assetTypeConfident=true` on a genuine non-comic object AND
  simultaneously returns zero identity signal — narrower than the
  prior blanket rejection of every zero-metadata cover, and it
  degrades honestly downstream (`identityGate.assessIdentityConfidence`
  still requires `missingFields.length===0`, so the book lands on
  `ID_REQUIRED`, not a fabricated price). Verified via extraction-and-
  eval of the real shipped `if` condition text from both call sites
  (`tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js`) rather
  than a hand-retyped predicate, so the test cannot silently drift
  from the shipped code. **Cannot-verify note, stated plainly:**
  client-side bulk rejections never reach `/api/enrich`, so there is
  no server-side log trace of the specific reported failure
  (`s-l1600.webp`) — the evidence for this fix is the code read (the
  byte-identical three-null predicate at both call sites), not a
  reproduced production log line.

  **GK-42, logged only — a different, adjacent bug found while
  pulling logs for GK-41, not chased.** A post-`ba28666` Spawn #351
  scan resolved to "Spawn #1" via `commit4.3.1`'s near-miss
  family-conflict margin decline (`family=351@4/9.5 runnerUp=4
  margin=2.38 prior=1 requiredMargin=3`) — Dispatch 26/Fix 2c
  territory. Note for whoever picks this up: `prior=1` is Vision's
  own fabricated issue number, which Fix 3a's issue-null clause
  should now prevent from ever being set in the first place — this
  may resolve itself on the next scan with no code change. Re-check
  before scoping any fix.

  **GK-43, logged only — pre-existing, deliberately untouched in this
  commit.** `gradeBlob`'s non-comic title check uses
  `.includes('unknown')` (substring match); `handleBulkImport`'s uses
  `titleLower === 'unknown'` (exact match). Real divergence, confirmed
  by direct outcome test (Section 3,
  `tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js`), unrelated
  to GK-41, left alone — touching an unrelated pre-existing quirk
  inside an urgent regression fix is how unrelated regressions get
  bought.

- **STANDING TEST-DESIGN RULE (2026-08-08, GrailKey Dispatch 30) —
  assert against the shipped expression, never a copy of it.** A test
  that hand-retypes the logic under test (a predicate, a regex, a
  formula) passes even after the shipped version drifts, because it is
  only ever checking itself. This is the third time this exact
  false-pass shape was caught and avoided in one session: the Fix 27-A
  fixture (an all-virgin-only sold pool triggered `verifySoldComps`'s
  legitimate variant-fallback safety net and produced a false pass by
  accident, not by design), the Dispatch 28 test's
  `variantAdjusted`-vs-`diagnostics.reasons.variantMismatch` assertion
  (checking the wrong pass's tally), and GK-41's own non-comic gate,
  which has no exported function to import at all — the App.jsx
  predicate is an inline conditional in a React callback. Rather than
  hand-retype it into the test (which would silently drift from the
  shipped code the moment either changed independently — precisely the
  GK-43 divergence this same dispatch documents happening for real),
  `tests/grailkey-dispatch-30-gk41-non-comic-gate.test.js` extracts
  each call site's actual `if (...)` condition text directly from the
  live `src/App.jsx` source via anchored regex and evaluates it as real
  JavaScript against fixture data. When no exported function exists to
  test directly, extract-and-eval the literal shipped text rather than
  reimplementing it — a reimplementation is a second copy of the logic,
  and a second copy is exactly what GK-40 and GK-43 show the cost of.

- **GrailKey Dispatch 30 PRODUCTION VALIDATION (2026-08-08, build
  `30fb7f2`).** Bulk import of the same Spawn #351 virgin variant
  (`s-l1600.webp`) accepted — "1 of 5," no "not a comic" rejection.
  GK-41 confirmed resolved on real production data. Full pricing chain
  confirmed working on the same scan, verbatim:
  ```
  [coverType-consensus] FIRE winner=virgin support=4/4
  [commit4-promote] PROMOTE issue=#351 ... provisional -> confirmed
  [commit4-promote-year] PROMOTE year=2024 assertingRows=3 silentRows=1
  [Q53-buildActive] filtered 4/4 active comps
  [price-trace] sold pool 100% edition-fallback but active pool
    confirmed variant-matched (4 comps, variant="virgin") — anchoring
    Tier 3 active-only instead of blending
  [tier-3] activeAvg=$24.43 discounted=$20.77
  [match-conf] score=96 tier=HIGH
  ```
  Fix 3a's null clauses (Dispatch 29, kept unchanged through Dispatch
  30) also confirmed working on this same scan, recorded here as its
  own separate success rather than folded into the failure below:
  `[phase1] identity determination: Vision="Spawn" #null`, and the
  year-drift conflict log shows `"vision": null` — no fabricated issue,
  no fabricated year. Half of Fix 3a's job (issue/year absence
  guidance) has been production-correct since Dispatch 29; the other
  half (assetTypeConfident wording) needed two more corrective passes
  — Dispatch 30, then Dispatch 31 below — before it matched reality.

- **GrailKey Dispatch 31 (2026-08-08) — two independent bugs found on
  the same re-scan, one prompt (second correction), one decision gate.**

  **Fix 31-A, SHIPPED — the wrong-axis gate, named and removed.**
  `shouldLiftAssetTypeAdvisoryLock`'s `hasCoherentConsensus` conjunct
  (title+issue majority-vote agreement on the eBay visual pool) gated
  whether Vision's own `assetTypeConfident=false` could be overridden
  by category-vote evidence. On the real re-scan: `comicVotes=20/20
  (ratio=100%) merchandiseRatio=0% coherent=false blockedBy=
  [pool-incoherent]` — an unambiguous asset-type signal (20/20 comic-
  category, zero merchandise) blocked solely because the pool's 20
  listings didn't converge on one title/issue. Confirmed by direct
  source read: `hasCoherentConsensus` measures "do these listings
  describe the same book," a different question from "is this object a
  comic," which the category vote already answers directly over the
  identical pool. No named failure case motivated the conjunct at
  introduction (Dispatch 19's own comment called it "the MORE
  conservative of the two options," a general principle) and it failed
  against its own only validation pool at ship time (that same comment
  disclosed the motivating Spawn #351 scan wouldn't have qualified
  under its own bar). Removed entirely, not replaced — category votes
  are already the correct-axis, direct measure; inventing a replacement
  conjunct would be a second, weaker proxy for what Q32 already
  measures. If a genuine pool-quality failure mode is ever observed, it
  needs a signal that actually measures pool quality/diversity, sized
  against a real incident — logged as an unscoped watch item, not built
  speculatively here. `src/lib/imageSearchIdentity.js`'s
  `shouldLiftAssetTypeAdvisoryLock` dropped from 4 params to 3; call
  site (`api/enrich.js`) and both stale test files
  (`grailkey-dispatch-19-fix5-asset-type-override.test.js`,
  `grailkey-dispatch-20-fix5-decline-logging.test.js`) updated in the
  same commit — the former's Section 1/5 inverted to assert the new
  behavior rather than deleted, so the removal itself stays a checked
  fact.

  **Fix 31-B, SHIPPED — Dispatch 30's own aspect-ratio wording
  backfired the same day it shipped.** The photo was the book on a
  light background with margins; Vision's condition report cited "The
  proportions and presentation suggest this is printed art stock rather
  than a periodical comic book cover" and "The paper stock and framing
  indicate this is likely a standalone art piece or poster." Two
  failures: (a) Vision cited paper stock — the exact tiebreaker
  Dispatch 30 explicitly dropped — re-inventing it; (b) IMAGE
  proportions are not OBJECT proportions, and the aspect-ratio/framing
  cue Dispatch 30 added was read as evidence AGAINST an ordinary
  photographed book, backfiring on the ordinary case it was meant to
  protect. Both cues removed entirely (not narrowed) from both prompts
  — an explicit, by-name prohibition on paper-stock/print-stock/
  material-appearance reasoning added instead. Explicitly a wider
  positive-signal surface than Dispatch 30's version, and explicitly
  conditional on GK-41 (Dispatch 30) remaining in place: before GK-41 a
  false "is a comic" could reach a hard block; after GK-41 it degrades
  to `ID_REQUIRED` (if identity can't resolve) or an advisory-locked
  listing button (if it can't be verified) — never a fabricated price
  or a dead end. A future reader must not treat this width as an
  unconditional loosening independent of GK-41 staying shipped.

  **GK-44 — named finding, most reusable of this dispatch, standing
  rule for every future prompt change in this codebase.** Vision has
  now reached for an unstated criterion twice: the masthead/price-box/
  barcode checklist (pre-Dispatch-29, part of "the prompt told it to
  guess"), then paper stock and framing (pre-Dispatch-31, this entry).
  **Omitting guidance is not the same as prohibiting a behavior —
  silence reads as "unconstrained," not "not applicable."** Pre-ship
  check for every future default-permissive prompt clause: ask what
  specific reasoning shortcut a model might reach for to justify the
  restrictive outcome, and forbid it by name before shipping, rather
  than discovering it re-invented in production after the fact.

  **GK-42 status, checked before scoping (per the explicit note left in
  Dispatch 30): re-verify before touching.** Not re-checked this
  dispatch — still open, unchanged.

  Verified: 19/19 new assertions
  (`tests/grailkey-dispatch-31-fix31a-wrong-axis-removed.test.js`),
  split three ways — Part 1 calls the real exported
  `shouldLiftAssetTypeAdvisoryLock` directly on the actual Spawn #351
  figures and a genuine merchandise-heavy contrast case; Part 2
  extracts the real `listingHardLocked` conditional text from
  `api/enrich.js` via anchored regex (tightened during authoring after
  an initial loose anchor-then-wildcard pattern accidentally matched an
  unrelated polybag-pricing gate elsewhere in the file — caught before
  commit, not shipped) and evaluates it against the real predicate's
  output, proving the actual downstream outcome (not locked) rather
  than just the predicate in isolation; Part 3 is prompt source-
  presence, absence-first per the standing Dispatch 29/30 discipline.
  13/13 pre-existing assertions across the two superseded Dispatch
  19/20 test files updated (not deleted) to assert current behavior —
  34/34 the (twice-superseded) Dispatch 29 prompt test still clean.
  Both changes are decision-gate / trust-intake adjacent, not pricing
  math — 31-A explicitly flagged and greenlit as a decision-gate change
  per CLAUDE.md's standing protocol; 31-B's width explicitly signed off
  given the GK-41 risk-budget argument above.

- **"A log excerpt is not evidence unless it includes the reconciling
  line" — review-discipline note, GrailKey Dispatch 32 (2026-08-08),
  pairing two retractions.** Two flagged defects in the same batch
  review (47 real scans) both turned out to be pipeline components
  working as designed, both caught by the identical failure mode: a
  partial log excerpt was read as proof of a discrepancy without
  checking for the line that explains it.
  - **Key multiplier** (Marvel Super Heroes Secret Wars #8, Batman: The
    Killing Joke, Immortal Hulk Great Power #1). `[key] SKIPPED — no
    multiplier base available (source=verified_sold_recency/
    active_ask_derived, isFromPC=false)` was read as a missed
    multiplier. It is the `isFromPC` gate working exactly as designed —
    a comp-verified price (18 real sold comps of that exact key issue)
    already embeds the key premium; applying the 1.5x key multiplier on
    top would double-count. The gate exists precisely so the multiplier
    only lifts a generic PriceCharting base, never a real,
    comp-derived price.
  - **Recommended-price divergence** (Spidey Super Stories #23,
    Dispatch 32 Defect 5). `[tier-4] pc_estimate=$9.90` next to
    `[verify] ... recommended: $50` was read as an untracked variable.
    `[verify]`'s `recommended` re-parses `out.price` directly
    (`enrich.js:9364-9386`) — it is not independently computed. The
    $9.90→$50 jump is the single-comp ask-based floor guard
    (`enrich.js:8065-8093`, `enforceFloorWithCap`) firing correctly on a
    1-item active pool, logged at `` `[floor] price 9.90 < floor 50 ...
    — enforcing` `` (line 8087) — a line the report's excerpt simply
    stopped short of.
  Both defects were retracted in the same review pass they were raised
  in, at the cost of one extra grep each. **Standing check, going
  forward: when a report cites two numeric values from the pipeline as
  evidence of a discrepancy, the report must also show — or explicitly
  say it checked for and did not find — the log lines between them.** A
  value pulled from one log line and compared against a value pulled
  from a different, non-adjacent log line is not itself evidence of a
  bug; it is evidence that needs the connecting narrative before it's
  reportable.

- **"Two guards on the same population with different threshold shapes
  disagree by construction" — GrailKey Dispatch 32 (2026-08-08), STEP A
  finding, provable from the arithmetic rather than observed from
  failures.** Q84's coherent-content lane (`src/lib/
  imageSearchIdentity.js:1545-1695`, `applyDualAxisGate`) admits a
  marketplace token into `confirmedTitle` on an ABSOLUTE floor:
  `countMemberSupport(token, familyMemberTokens) >= 3` (`:1465-1466`,
  `:1652-1681`). `22e-force`/`22e-LOSS` (`identityCore.js:294-436`,
  `checkAssemblyIntegrity`) rejects the same class of token as a stray
  addition on a PERCENTAGE floor: `<60%` of `compTitles` (`:368-406`).
  When a family override has occurred, both predicates are confirmed to
  run over the literal same population — `compTitles` at the
  `22e-force`/`22e-LOSS` call sites is set to `winningFamilyTitles`
  (`enrich.js:3422-3428`, `6282-6285`), the identical `topFamily`
  Q84's `familyMemberTokens` is drawn from.
  Given that, the two thresholds are not independently tunable — they
  are the same measurement expressed in two incompatible units, and the
  crossover point is arithmetic, not incidental: in any family with 5 or
  fewer members, 3 supporters is already >=60% (3/5 = 60%), so
  `22e-force`'s percentage floor can mathematically never flag what
  Q84's absolute floor admitted, for any family at or under that size.
  In a larger family, 3 supporters can fall under 60% and gets caught.
  This reproduces the observed catch-rate split exactly (small, tight
  visual-pool families — Star Wars #68, Strange Tales, and others —
  passed through uncaught; larger families — Iron Man #150, X-Men #39,
  and others — were caught) without needing to have observed every
  individual failure to know it would happen: the disagreement is
  guaranteed by the two threshold shapes alone, for any family under the
  crossover size, regardless of which specific tokens are involved.
  Related to, but a distinct sibling of, the "measuring coherence
  against the wrong population" class (vision-zero-support, Bone
  #1/GK-34, Fix 2b, Fix 2c's two drafts) and the "drifted-duplicate-
  constant" class (Q119, Q127, Q128, GK-40): those are about a
  measurement applied to the wrong population, or the same nominal
  vocabulary independently drifting in content. This is neither — the
  population is identical and correctly identified by both guards; what
  disagrees is the SHAPE of the threshold applied to it. Recorded as its
  own class since a fix that only closes one sibling (e.g. widening a
  drifted vocabulary, or re-scoping a wrong-population measurement)
  would not touch this one. (Numbering note: this entry is not asserted
  as a specific ordinal instance of any single prior-named class — it is
  the first instance of this particular sub-shape, cross-referenced
  above to its two nearest siblings rather than folded into either
  one's running count.)
  **Standing check, added to the existing "name the population" check
  from the wrong-population class: when two predicates gate the same
  population, state both thresholds in the same units — before shipping
  either — and confirm neither can structurally out-vote the other for
  any population size in the expected range.**

- **GK-45 (2026-08-08, GrailKey Dispatch 32, found while scoping Fix 32-C).
  `convergence.tier` does not actually certify PriceCharting agreement on
  issue number or title — LOG ONLY, not fixed this dispatch.**
  `convergenceSources` (`api/enrich.js:4016-4060`) feeds PC data into the
  `era` (`:4046`) and `publisher` (`:4052`) axes only. The `title` axis
  has no `pc:` key at all (`:4017-4036` — only `ebay`/`vision`/`cv`), and
  the `issue` axis's `pc: priceChartingInitial?.issue` (`:4040`) is a
  dead reference: `lookupPriceCharting`'s returned candidate objects
  (`api/enrich.js:1782`, `{ price, productName, id, year, source }`; the
  id-anchored branch's return at `:1568-1575` is the same shape) never
  set an `.issue` field, so this axis reads `undefined` from PC on every
  scan, always. Net effect: `convergence.tier === 'HIGH'` currently means
  year/publisher agreement was confirmed against PC — it says nothing
  about whether PC agrees on issue number or title, despite the field's
  name implying general identity convergence. Relevant to Fix 32-C:
  `visionLowButCorroborated`'s new catalog-corroboration arm deliberately
  does NOT gate on `convergence.tier === 'HIGH'` for exactly this reason
  — raising that bar would not buy real issue-level assurance, only make
  the arm harder to satisfy for an unrelated reason. Flag for any other
  future consumer of `convergence.tier`: treat it as weaker evidence than
  its name implies until the dead `.issue` axis and missing `title`/`pc`
  key are addressed.

- **GK-46 (2026-08-08, GrailKey Dispatch 32, found while scoping Fix
  32-B). The `soldVerification.js:934` zero-pool variant fallback is
  ALREADY unconditionally reachable today, regardless of
  `variantIdentitySource` — meaning Fix 32-B's originally-planned
  mechanism (gate Filter 8's case a-inverse by provenance, route to the
  `:934` fallback) may not change Marvel Team-Up #141's actual outcome.
  Investigated, NOT resolved — needs live verification before 32-B's
  code proceeds.** `soldVerification.js:934`'s guard —
  `working.length === 0 && reasons.variantMismatch > 0 && rawCount > 0`
  — has no provenance check today. If Filter 8's case (a-inverse) zeroed
  `working` for Marvel Team-Up #141 (as the Dispatch 32 report's
  `codes={"WRONG_VARIANT":30}` log line implied), this fallback should
  already have engaged in the real scan, independent of whether
  `confirmedVariant="newsstand"` came from Vision alone or a corroborated
  source. That means the real production outcome (zero pricing evidence,
  per the original report) was decided by what happened INSIDE the
  fallback — either its self-consistency guard
  (`recognizedDistinct.size >= 2`, `:1149-1151`) tripped, or the
  re-filtered pool fell to zero via filters 1-6/9-13 — not by the
  fallback failing to trigger at all. **This is also a corroborating
  data gap, not just a mechanism gap**: the `codes={"WRONG_VARIANT":30}`
  figure cited in the original report comes from
  `evidenceEligibility.js`'s independent DIAGNOSTIC classifier (confirmed
  elsewhere in this dispatch to be non-gating for pricing), not from
  `soldVerification.js`'s own internal fallback logging — so it is not
  itself proof that `soldVerification.js`'s real working pool ended up
  empty after the fallback ran; it only proves Filter 8's initial
  rejection tally. Fix 32-B's design (skip the case-(a-inverse) hard
  reject when uncorroborated, route through the same `:934` machinery)
  produces a near-identical candidate pool to what the existing
  unconditional fallback already computes — if the fallback already ran
  and already failed via `recognizedDistinct` or re-filtering, the
  planned fix may hit the identical failure point and change nothing.
  **Before writing code for Fix 32-B: pull the real `[sold-verify]`
  fallback log lines (`variant fallback triggered` /
  `variant fallback INCOHERENT` / `variant fallback — N any-variant
  grade-matched comps`) from the actual Marvel Team-Up #141 production
  scan, or re-scan live, to confirm which of the fallback's three
  outcomes actually occurred** — this determines whether Fix 32-B's
  provenance gate is the real fix, or whether the real fix instead needs
  to touch the self-consistency guard's behavior when the disputed axis
  token is itself uncorroborated.

- **NAMED OPEN INFRASTRUCTURE PROJECT (2026-08-08, GrailKey Dispatch 32,
  post-catalog title finalization) — scoped, NOT started. An outside
  architectural review reached this independently: the durable fix for
  the coherent-content-token-lane class of bug is Evidence ->
  Classification -> Authority -> Identity -> Market, replacing
  marketplace-repetition-infers-identity-with-exceptions-patched-after.**
  Confirmed tractable because **this architecture already exists in this
  codebase, on the issue axis** — `issueAuthority`
  (`{status: provisional|confirmed|conflicted, reasons[], source}`,
  `identityProvisionalFields` as pending state, promotion via
  `decideFieldAuthority`/`resolveFamilyIssueConsensus`, shipped by Fix
  2/2b/V4) is the exact pattern. `titleComponents`
  (`[{value, type, status:'pending-catalog'}]`) is the SAME pattern
  extended to the title axis — not a rewrite, an application of a proven
  in-repo pattern to the one axis that lacks it.
  **CORRECTED (parallel review, same dispatch) — not "reusable
  verbatim."** The authority-state vocabulary, custody semantics,
  provisional-state pattern, and decision model (`decideFieldAuthority`'s
  outcome vocabulary — adopted / provisionally-corrected / corroborated /
  preserved-prior / conflicted, the `authoritativeForCustody` boolean,
  `identityProvisionalFields`'s pending-state bookkeeping, the
  legacy-mode compatibility mapping pattern) are reusable as a PATTERN.
  **Direct implementation reuse requires title-axis interface proof
  first** — `decideFieldAuthority` takes a single scalar `priorValue`/
  `familyValue` pair; title is an ORDERED SET of independently-typed
  claims, not one scalar claim, and nothing in this codebase has proven
  the function (or a variant of it) actually composes over a set without
  redesign. Recording this distinction explicitly so a future engineer
  doesn't read "reusable verbatim," conclude `decideFieldAuthority()`
  just needs to accept arrays, and call the architecture question closed
  without doing that proof.
  **Needs a title-axis equivalent, does not exist today**: issue
  authority only ever resolves a single scalar (a number, via one regex
  shape, `#\s*(\d+)`) — title is a SET/SEQUENCE of tokens, and unlike an
  issue number, individual tokens need their own TYPE classification
  (canonical / edition-event / creator / story-content / publisher-
  imprint / seller-boilerplate) before authority can even be asked about
  them. This per-token classification step has no issue-axis analog to
  reuse — it is new work, not an extension of `resolveFamilyIssueConsensus`.
  Target shape for the eventual project (Phase 1 collect candidates
  without finalizing uncertain tokens -> Phase 2 acquire CV/PC catalog
  candidates -> Phase 3 reconcile candidate tokens against catalog
  identity -> Phase 4 finalize canonicalTitle/issue/year/publisher/
  format/variant -> Phase 5 generate market-search fingerprint -> Phase 6
  price only against the finalized fingerprint) is recorded here as the
  standing target, not yet designed in detail.
  **Standing design criteria for this project, going forward:**
  1. Does the code encode a property of the world, or today's dataset
     behavior?
  2. Does the same concept exist in more than one place? Consolidate.
  3. Would adding 100 new publishers/conventions/formats/marketplaces
     require modifying control flow? If yes, the abstraction is wrong.
  4. Can the system say "unknown / not yet authoritative" instead of
     deciding prematurely? If not, it needs an intermediate
     representation.
  **Question 4 is load-bearing — it is the structural form of this
  codebase's own standing product principle: honest and locked, never
  confident and wrong.** The Adventure Time SDCC reachability trace
  (this same dispatch) is a direct, empirical instance of question 4 in
  action: post-deletion, the book resolves to `confirmedTitle="Adventure
  Time"` / `confirmedIssue=null` — an honest incomplete state — rather
  than the pre-fix confidently-wrong $22.09 off a different product.
  This project would let the SAME honest-null discipline extend to the
  title tokens themselves ("summer special" is `pending-catalog`, not
  silently dropped and not silently promoted) instead of the current
  binary admit-or-block choice this dispatch is stuck making.

- **SDCC-fix scope correction, recorded alongside the deletion
  (2026-08-08, GrailKey Dispatch 32).** An earlier draft of the
  EDITION/EVENT typed-replacement list proposed routing `annual`,
  `giant-size`, and `summer special` to variant alongside genuine
  event/convention tokens (`sdcc`, `nycc`, `c2e2`). Two real corpus
  books falsify this: **giant size doctor strange #1** ($15.00, 20 sold
  comps, Vision itself already reads "giant size" directly off the
  cover — "giant-size" is CANONICAL for this book, not a routable
  edition descriptor) and **Marvel 85th Anniversary Special #1**
  ($11.62 — "special" is CANONICAL, part of PriceCharting's own product
  name). Routing either word to variant would strip canonical title
  content on these two books — the inverse of the bug being fixed. The
  typed EDITION/EVENT list ships scoped to genuine named-convention/
  event phrases only (`sdcc`, `nycc`, `c2e2`, `convention exclusive`);
  `annual`/`giant-size`/`summer special`/`special` are explicitly
  excluded and stay in the "never blindly routed, catalog-corroboration
  only" bucket — which, per the open infrastructure project above, does
  not exist yet. Adventure Time Summer Special's own "summer special"
  falls in this excluded bucket and stays a named, explicitly
  unresolved gap.

- **CLASSIFICATION IS NOT AUTHORITY — standing design principle
  (2026-08-08, GrailKey Dispatch 32).** Recognizing that a token is a
  particular KIND of claim (an event name, a creator name, a printing
  descriptor) answers only what kind it is — never whether it belongs to
  the specific book being identified. Required shape for any future
  classifier in this codebase: `token -> classification -> [family-scoped
  corroboration | visual evidence | catalog evidence] -> authority
  decision -> adopt | provisional | conflict | reject`. NOT: `known type
  -> automatically adopted`. Concretely enforced in this dispatch's own
  typed event/imprint routing (`matchKnownPublisherImprintEventTokens` +
  `countMemberSupport`'s >=3-member floor, `imageSearchIdentity.js`) —
  matching a known phrase (classification) and clearing family-scoped
  corroboration (authority) are both required, checked in that order, and
  a token that clears only the first (e.g. "sdcc" at 2/5 member support)
  is never routed. This is the same principle the coherent-content
  lane's own deletion establishes from the opposite direction: a token
  does not gain identity authority by being repeated across marketplace
  listings — classification by phrase-match doesn't grant authority
  either, corroboration does the actual work in both directions. Applies
  to the co-title gating in this same dispatch too: `visual_pool_top3` as
  a SOURCE is a classification of where a token came from, not evidence
  it belongs to the book — audited (0/1 beneficial) and found wanting on
  authority grounds, not on classification grounds (the source was
  correctly identified as visual_pool_top3 every time; that correct
  classification never implied the token belonged to the family).

- **3x margin finding — narrow conclusion only, not an argument to tune
  (2026-08-08, GrailKey Dispatch 32).** `isQualifiedFamilyForRetention`'s
  `familyDominatesRunnerUp` (Commit 4.3, `identityCore.js`) requires the
  winning family to out-weight its runner-up by 3x before independently
  rescuing issue/year on a title-axis-only block. Checked against 8 real
  corpus books during this dispatch's reachability work: **5 of 8 fail
  the margin** (star wars #68 10<12, strange tales 8.5<25.5, batman #608
  5.5<16.5, gears of war #1 14.5<21, fantasy masterpieces #1 13.5<22.5),
  3 pass (immortal hulk #44 18>=9, super villain team-up #5 17.5>=9,
  spidey super stories #23 14>=12). **The correct, narrow conclusion:
  Commit 4.3 is a deliberately narrow rescue that frequently does not
  activate, and this is usually harmless — checked directly, 7 of the 8
  books above have Vision independently supplying the correct issue
  number regardless of whether Commit 4.3 fires, so the margin miss has
  no consequence for them.** The demonstrated residual-risk class is
  narrower than "the margin is too strict": it is specifically
  Vision-has-zero-issue-signal PLUS an ambiguous-or-wrong pool-wide vote
  — Adventure Time Summer Special is the one specimen of this class found
  in this dispatch's work (real trace: `confirmedIssue` resolves to
  honest `null`, not the wrong pool-wide vote, when the margin misses —
  see the Part 2 reachability trace, `tests/q140-coherent-content-token-
  lane.test.js`). Adventure Time's own margin miss (14 < 15) is a
  one-point coincidence, not evidence the threshold is miscalibrated —
  do not read it as one. **Explicitly not touched this dispatch, and not
  to be touched as adjacent cleanup in any future dispatch without its
  own dedicated scoping and greenlight**: `familyDominatesRunnerUp`'s 3x
  constant, same standing status as the standing "do not rank-weight
  issue-consensus" and "do not touch Commit 4.3" rules already recorded
  in this file.

- **Coherent-content lane deletion + co-title `visual_pool_top3` gating
  — SHIPPED (2026-08-08, GrailKey Dispatch 32).** Two independent
  injectors closed in one atomic commit, per real-corpus audit evidence
  gathered across this dispatch (47 real production scans, 2026-08-08
  07:00-08:15 UTC): the Q140 coherent-content-token lane
  (`applyDualAxisGate`, `imageSearchIdentity.js`) deleted outright — 15
  observed firings, 0 beneficial, real motivating incident (Adventure
  Time SDCC) not reproduced in the audited corpus and left explicitly
  unresolved rather than half-fixed; and `co-title`'s `visual_pool_top3`
  source (`api/enrich.js`) stripped of append authority entirely — 1
  observed firing (iron man #150, "DR DOOM White"), 0 beneficial,
  vision-sourced co-title (the validated Q104 FIX-3 crossover-title
  path) left untouched. Replaced by a standalone typed event/imprint
  routing mechanism reusing the existing >=3-member corroboration floor
  (never title-admission authority again) — widened with genuine named-
  convention phrases (`sdcc`, `nycc`, `c2e2`, `convention exclusive`),
  deliberately excluding `annual`/`giant-size`/`summer special`/`special`
  (see the SDCC-fix-scope-correction entry above). **Corpus role, not
  count, for the 15 firings** — do not let a future benchmark or launch
  document read this as "15 books fixed": ~8 were genuine harm this
  deletion corrects (star wars #68, strange tales, immortal hulk #44,
  batman #608, gears of war #1, fantasy masterpieces #1, spidey super
  stories #23, amazing spider man #17); 4 were already self-correcting
  pre-deletion via an unrelated mechanism (super villain team-up #5 via
  22e-force Rule 2; x-men #39, marvel team-up #14, marvel team-up #141
  via Rule 1) and stay correct post-deletion via the same or a more
  direct path; amazing spider man #119's title is fixed here but its
  pricing outcome is governed separately by the already-shipped Fix
  32-C; iron man #150 needed BOTH injectors closed to reach fully clean.
  Frozen as a permanent, deterministic, no-live-eBay regression suite:
  `tests/grailkey-dispatch-32-frozen-corpus.test.js` (33 assertions, all
  15 firings plus 2 controls, real pools copied verbatim from the
  production log corpus, not reconstructed), plus
  `tests/q140-coherent-content-token-lane.test.js` rewritten (26
  assertions: lane-deletion proof, typed-routing unit behavior including
  a CLASSIFICATION-IS-NOT-AUTHORITY control, and the Adventure Time gap
  re-verified against real function calls) and
  `tests/q133-slice1b-eom-registry.test.js` restored to its pre-Q140
  assertions verbatim (13 assertions — the reintroduction guard). One
  real gap found and fixed during implementation, not just documented:
  the `fallback-vision` return object in `selectTitleFamilyCandidate`
  never threaded `admittedVariantTokens` at all — without the fix, Gears
  of War #1's "wildstorm" routing would have silently regressed the
  moment the lane's admission path stopped being the only way to reach
  that return site. Full regression sweep (decision-engine 39/7, comp-
  filter-hygiene 182/4, sold-verification 124/5, identity-gate 92/7,
  image-search-extraction 161/2, mega-keys 198/8, pattern-k-dedupe-issue
  4/4, q-adv397-visual-guard 11/5) matches documented baseline exactly;
  one pre-existing test (`tests/q144a-family-discriminator-gate.test.js`)
  had its one predicted assertion updated, everything else in that file
  unaffected, confirmed by the suite staying green. `npm run build`
  clean. `resolveFamilyIssueConsensus`, Commit 4.3, the 3x margin, Fix
  32-B, and the gate chain are all untouched.

- **HIDDEN-PATH DEPENDENCY — named, reusable principle (2026-08-08,
  GrailKey Dispatch 32).** `selectTitleFamilyCandidate`'s
  `fallback-vision` return object (`imageSearchIdentity.js`, the
  weighted-consensus branch's blocked-addition return) never threaded
  `admittedVariantTokens` through — this went unnoticed for as long as
  the coherent-content lane existed, because that lane's own
  `allowed: true` success return was the only place `admittedVariantTokens`
  ever needed to survive to the caller; the blocked path never carried a
  populated value worth losing. Deleting the lane made `fallback-vision`
  the sole outcome for every non-creator addition — including the new
  standalone typed event/imprint routing's corroborated tokens — and the
  same missing field that was harmless for years became a silent
  regression on the very first real case (Gears of War #1's "wildstorm").
  Found and fixed during implementation, not left as a shipped defect.
  **Reusable principle, name it before it recurs: a mechanism reached
  through only one historical control-flow path can acquire a hidden
  dependency on that path — a field or side effect that "just happens"
  to survive because nothing else ever took the other branches. When
  deleting or bypassing a path, audit every side-channel field produced
  anywhere in the deleted/bypassed code for whether every NEWLY reachable
  return site actually threads it through — do not assume a return
  object's shape was ever exercised by the case you're about to make
  common.**

- **CO-TITLE EVIDENCE DISCIPLINE — three verdicts, not two (2026-08-08,
  GrailKey Dispatch 32).** Auditing `[co-title]` firings across the
  47-scan corpus produced exactly one resolved case (`visual_pool_top3`,
  iron man #150, pollution) and zero firings of the other source
  (`vision`-sourced co-title, the validated Q104 FIX-3 crossover-title
  path). **Zero firings is recorded as a COVERAGE GAP, not as evidence
  either for or against the mechanism** — the corpus simply never
  exercised it. `visual_pool_top3`'s append authority was removed on its
  own resolved evidence (1 firing, 0 beneficial); `vision`-sourced
  co-title was left unchanged on the correct basis that its own separate,
  prior validation (the real Deadpool/Batman incident) still stands,
  never on this corpus having tested it. Recorded as a standing
  discipline for future hit-rate audits in this codebase: a mechanism
  with zero observed firings in an audit corpus gets UNRESOLVED, not a
  default verdict borrowed from a sibling mechanism's result — the same
  three-verdict requirement (BENEFICIAL / POLLUTION / UNRESOLVED, never
  forced to a binary) that governed the co-title audit itself applies one
  level up, to whether a source was tested at all.

- **"NO NEW REGRESSION AGAINST DOCUMENTED BASELINE" — standing
  terminology rule, not "tests pass" (2026-08-08, GrailKey Dispatch
  32).** This codebase's test suites carry real, individually-documented
  pre-existing failures — decision-engine 39/7, comp-filter-hygiene
  182/4, identity-gate 92/7, image-search-extraction 161/2, mega-keys
  198/8, sold-verification 124/5, q-adv397-visual-guard 11/5, and more
  (see "Known stale test suites" in CLAUDE.md's Current State section).
  **"Tests pass" is never the accurate claim for a sweep against this
  suite — it silently grandfathers 30+ already-known failures as if they
  were successes.** The accurate, required claim is that the sweep
  produced NO NEW failures beyond the documented count for each file —
  verified by comparing the exact pass/fail numbers to the documented
  baseline, not by checking exit codes or "did it print all-green."
  GrailKey Dispatch 32's own regression sweep is the worked example:
  reported as "decision-engine 39/7... matches documented baseline
  exactly," never as "decision-engine passes." **Use this exact phrasing
  in every future commit message and report describing a regression
  sweep against this suite.** Standing reason to keep this precise, not
  just a style preference: when a formal launch-certification gate is
  eventually built in this codebase, this distinction is the entire
  difference between an honest gate and one that silently certifies
  everything already broken. A certification step that reports "tests
  pass" against a baseline already carrying 30+ known failures certifies
  nothing — it would pass unchanged the day before and the day after an
  unrelated regression landed in one of the already-red suites, because
  nothing in "tests pass" phrasing distinguishes "still red for the
  documented reason" from "newly red for an undocumented one."

- **Dispatch 32 Defect 7 downgraded, log only, not scoped (2026-08-08).**
  The three `[22e-LOSS]` log lines the batch report read as
  `buildTitleFamilies` silently dropping tokens (`x`, `marvel`) into a
  truncated `confirmedTitle` are the guard's own FAIL output
  (`identityCore.js:358-363`) — meaning all three were caught and
  reverted to Vision's clean title before shipping, not silently
  truncated. Underlying mechanism confirmed real: a min-length filter
  drops single-character tokens (`src/lib/imageSearchIdentity.js:
  1015-1019`, catches "x"), and a separate 60%-family-consensus step
  drops non-majority publisher tokens like "marvel" (`:1114-1118`) — but
  confirmed cosmetic only, since family membership/clustering is decided
  before the token-consensus step runs (`:1074-1097` vs. `:1103-1174`),
  so truncation never changes which listings cluster together. No fix
  scoped.

## GrailKey Dispatch 33 (2026-08-08) — Architecture v1.0, Week 1: instrumentation and contracts only

Zero customer-visible behavior change this week. No routing change, no
new lanes, no barcode decode logic, no agent framework, no prompt
changes, no `api/enrich.js` control-flow changes (only new
timer-wrapping/logging around existing calls). Full plan and design
decisions: `.claude/plans/bright-meandering-reddy.md` (this session).

### Step 0 — eBay legacy Product API urgency check

Grepped the full codebase for `findProducts`, `getProductDetails`, and
`getProductCompatibilities` — **zero call sites anywhere.** Confirmed via
eBay's own developer docs
(`developer.ebay.com/devzone/Product/CallRef/findProducts.html`,
`.../getProductDetails.html`) that all three are genuinely deprecated and
scheduled for decommission **2026-08-15** — the secondhand claim that
triggered this check was accurate, not a rumor. This codebase's actual
eBay surface: Browse API (`buy/browse/v1`, current, not part of this
decommission), Trading API (`ws/api.dll` — `AddFixedPriceItem`/`EndItem`,
a separate legacy API, also not part of this decommission), the legacy
Finding API (`svcs.ebay.com/FindingService`, already documented dead/
bypassed in CLAUDE.md's Open Blockers), and Marketplace Insights
(already documented dead/gated). The `epid` field seen throughout
`src/lib/imageSearchIdentity.js`/`evidenceEligibility.js` is a Browse API
response field used as a cross-reference key into PriceCharting lookups
— not a call to the deprecated Product API. **Conclusion: no migration
needed, nothing was ever built against the decommissioned surface.**

### Step 1 — two standing invariants for every future evidence source

Recorded here verbatim, per instruction, before any contract code was
written — the contracts in Step 2 exist to satisfy these, not the other
way around.

**INVARIANT 1 — MONOTONIC EVIDENCE EXTENSION.** A new evidence source may
strengthen, contradict, or leave unchanged an existing determination.
Failure or absence of the new source must not weaken, contaminate,
constrain, or otherwise alter the established fallback path. Concretely,
a fast-identity miss may NOT: alter the legacy Vision prompt; alter the
eBay query; shrink or reorder the candidate pool; populate
confirmedTitle/issue/year/variant/publisher; contaminate shared request
state; write a cache entry that affects the legacy route; change grading
mode. This is stronger than fallback logic — it is monotonic extension:
the legacy path is the floor, by construction.

**INVARIANT 2 — NO SELF-CORROBORATION.** Evidence derived directly or
transitively from an authority mechanism cannot count as independent
corroboration of that same mechanism. Independence is COMPUTED by the
Authority Resolver (future work, not built this week) from evidence
lineage (`derivedFromEnvelopeIds`, `sourceIndependenceGroup`) — it is
NEVER a boolean a worker sets. This covers barcode, catalog, visual
retrieval, future agents, and sources not yet conceived. See
`src/lib/evidenceContracts.js`'s closing comment: a stored `independent`
field would defeat this guard by construction, which is why one does not
exist anywhere in this codebase and any future addition of one should be
rejected on sight, not patched around.

### Step 2 — EvidenceEnvelope / SourcePolicy / barcode-ladder contracts (types and tables only)

`src/lib/evidenceContracts.js` — new file, **nothing imports it yet**
(grep-verified at ship time; re-verify before this claim goes stale).
Contains: the `EvidenceEnvelope` JSDoc typedef (every field from the
dispatch spec); `RetentionClass` frozen enum
(`FIRST_PARTY_PERMANENT`/`LICENSED_PERMANENT`/`TRANSIENT_EXTERNAL`);
`SOURCE_POLICIES`, one row per source (ebay, pricecharting, comicvine,
google, gcd) — populated conservatively, `termsCheckedAt: null` + a TODO
on every row except GCD's (the one row with real, if still incomplete,
cited terms from Dispatch 17 — CC-BY-SA attribution confirmed required,
no live query API, no bulk retrieval); `BARCODE_AUTHORITY_LADDER`, a
plain 3-value enum (`BARCODE_OBSERVED`/`BARCODE_MAPPED`/
`BARCODE_EDITION_RESOLVED`) with no decode logic behind it.

**Flagged, not fixed:** this ladder needs future reconciliation with the
*existing* barcode path in `api/enrich.js` (`lookupComicVineByUPC`,
`identitySource === 'barcode'`) — today that path is an all-or-nothing
lock (UPC found in ComicVine ⇒ "100% certain," skips `resolveIdentity`
entirely; UPC not found ⇒ hard 404) with no "observed but unmapped"
state at all. Wiring the 3-tier ladder into that existing lock is
deliberately out of scope this week.

### Step 3/4 — instrumentation, threaded through `src/lib/scanLog.js` (additive, no version bump)

Same additive-field convention as Fix 32-C (`visionLowButCorroborated`):
every new key defaults to `null`/`[]` on absence, `SCAN_LOG_VERSION`
stays `1`. New top-level keys: `correlationId`, `latency`, `identity`,
`cost`, `evidence`, `sources`, `barcode`, `eventualCertifiedGrade`.

**correlationId** — reuses `api/enrich.js`'s existing `pipelineTraceId`
(`randomUUID()` at handler entry, already threaded through
`out.pipelineAudit.traceId`). No new ID generation, no new plumbing.

**A key architectural fact this instrumentation is built around:**
`api/grade.js` (Vision identification) and `api/enrich.js` (pricing
pipeline, the only place `scanLog` writes to KV) are **two separate HTTP
requests**, not one. There is no shared correlation ID or log sink
spanning both today. This creates two honest, documented gaps rather
than fabricated numbers:

- `latency.visionLatencyMs` is always `null` in `scanLog` — Vision's
  latency is real and measured (`api/grade.js`'s own `mark()`/`ms`
  timers), just not persisted here.
- `cost.conditionCostUsd` is always `null` in `scanLog` for the same
  reason — Vision's per-call cost IS computed and logged (see below),
  just not joined to the enrich-side record.

Resolved direction (explicit, not a default): compute and
`console.log` both numbers inside `api/grade.js` (readable via Vercel
runtime logs for the Step 5A audit) and leave the corresponding
`scanLog` fields `null` with a code comment. **Do not timestamp-stitch
the two requests to manufacture a joined per-scan total** — a correlation
built by matching timestamps between two independent requests is false
precision, not data. Closing this gap for real needs either a client
(`App.jsx`) contract change forwarding `correlationId`/measured values
from `grade.js` into the `enrich.js` request, or a second KV log sink
inside `grade.js` itself — both are named, scoped-but-not-started
follow-ups, not started this week.

**latency** (`ebayImageSearchLatencyMs`, `comicvineLatencyMs`,
`priceChartingLatencyMs`, `compsLatencyMs`, `aiVerifyLatencyMs`,
`totalLatencyMs`, `visionLatencyMs`) — the first three are new timers
wrapped around `api/enrich.js`'s own existing eBay-image-search
(`lookupEbayVisual`), ComicVine (`lookupComicVine`), and PriceCharting
(`lookupPriceCharting`) calls; `compsLatencyMs`/`aiVerifyLatencyMs`/
`totalLatencyMs` alias the already-computed `out.timings.comps_ms`/
`verify_ms`/`total_ms`. **Documented partial coverage:** ComicVine and
PriceCharting each have multiple call sites in this handler (retries,
subtitle-stripped fallback, a later re-query path) — only the PRIMARY
(first, cache-miss) call at each is timed, not summed across every
retry/fallback. Touching every call site's control flow to sum them was
judged out of scope for an instrumentation-only week; this is a
documented gap, not a silent one.

**identity** (`identityRoute`, `identityOwnedEvidenceOnly`,
`authorityPath`) — all three are derived **read-only** from the existing
`identitySource` string (`src/lib/identityCore.js`, already documented
as "KNOWN-FRAGILE" for exact-match callers due to `+`-joined suffix
mutation). `identityRoute` = `identitySource.split('+')[0]`;
`authorityPath` = the full split array; `identityOwnedEvidenceOnly` =
true only when the route is `barcode`/`manual`/`cgc_cert` (the three
single-source bypass branches in `api/enrich.js`, confirmed via direct
read of the identity-resolution `if/else if/else` chain). None of this
mutates `identitySource` itself.

**cost** (`identityCostUsd`, `conditionCostUsd`, `verificationCostUsd`,
`researchCostUsd`, `totalCostUsd`) — **the four lanes are never blended**
(explicit design goal: showing identity cost trend toward zero while
condition cost doesn't requires keeping them apart). Real mapping,
confirmed by enumerating every `messages.create`/`anthropic.messages`
call site in `api/enrich.js` (there is exactly one):
- `verificationCostUsd` ← `verifyCompsTitles`, the AI-verify comp-title-
  matching pass — the only enrich.js-side Claude call, confirmed against
  its own prompt text (asks Claude to MATCH/NO_MATCH each eBay comp
  listing against the identified book). Attached to its return value as
  a side-channel `_verificationCostUsd` property (same idiom as
  `api/grade.js`'s existing `_watchPasses`, since arrays are objects in
  JS and this is invisible to every existing caller) rather than
  changing the function's return contract.
- `identityCostUsd` — **always null.** There is no identity-
  disambiguation LLM call anywhere inside `api/enrich.js` today; identity
  resolution in this codebase (`resolveIdentity`, `decideFieldAuthority`,
  the whole issue/year-authority machinery) is pure deterministic JS, not
  an LLM call. A hypothesized "aiChooseBestProduct" call was searched for
  and does not exist. This is an honest absence, not an unmapped call —
  flag it here so a future reader doesn't assume a bug.
- `conditionCostUsd` — always null in `scanLog` (cross-request gap
  above); real value computed and logged in `api/grade.js`.
- `researchCostUsd` — fixed `0.0`, reserved for product-keyed enrichment,
  never computed per-scan.

**PRICING_USD_PER_MTOK** (`src/lib/anthropicPricing.js`) — one named
pricing table, verified against Anthropic's official pricing page
(`platform.claude.com/docs/en/about-claude/pricing`, retrieved
2026-08-08) rather than assumed from training data. Keyed on the EXACT
literal model-ID strings this codebase sends — four distinct strings
across two files, not one: `claude-haiku-4-5-20251001`,
`claude-sonnet-4-5-20250929`, `claude-opus-4-7` (all three in
`api/grade.js`), and a fourth, separate **undated alias**
`claude-haiku-4-5` (`api/enrich.js`'s `verifyCompsTitles`, its own
distinct literal string, not the same key as the dated Haiku row). A
table keyed on anything other than what the code actually sends makes
`computeAnthropicCallCostUsd` return `null` on every call and the whole
instrumentation logs nothing — silently. (A review pass initially
flagged `claude-opus-4-7`/`claude-sonnet-4-5-20250929` as stale/invalid
based on general recall; both were re-confirmed live and non-retired
directly against the fetched pricing page before proceeding — worth
recording as a small worked example of why a live source beats memory
even when the pushback sounds confident.) Cache-write TTL uses the SDK's
real `usage.cache_creation.{ephemeral_5m_input_tokens,
ephemeral_1h_input_tokens}` breakdown when present, falling back to
pricing the flat `cache_creation_input_tokens` as 5-minute-only only
because source inspection confirms this codebase's one `cache_control`
call site never sets `ttl: "1h"` — not a general assumption. Static-
prefix token counts use Anthropic's real `messages.countTokens` API
(confirmed present in the installed SDK), cached per
(model, git-SHA, prompt-hash) so it runs once per unique combination,
not once per scan; `promptText.length` is demoted to a diagnostic-only
figure, never the cache-eligibility or reported-token signal.

**evidence** (`conditionEvidenceLevel`, `model`, `modelVersion`,
`promptVersion`) — `conditionEvidenceLevel` hardcoded `'front'` this
week (no per-scan image-count awareness exists yet — TODO, not inferred).
`model`/`modelVersion` describe the condition-assessment (Vision) call,
which happens in `api/grade.js` — always null here, same cross-request
gap as `conditionCostUsd`. `promptVersion` = `process.env
.VERCEL_GIT_COMMIT_SHA` (Vercel's own system env var) — chosen explicitly
over a hand-maintained version constant, since prompt behavior is fully
determined by the deployed commit and a parallel constant would
eventually drift silently from what's actually live. Revisit if prompts
ever move out of this repo.

**sources** (`sourceCalls`, `quotaState`) — `sourceCalls` covers only the
legs this dispatch actually instrumented (ebay-image-search, comicvine,
pricecharting, ai-verify) — explicitly not a comprehensive inventory of
every external call this 10,000+-line handler makes. `quotaState` is
always null; no external API in this codebase currently surfaces quota
headers.

**barcode** (`barcodeDetected`, `barcodeRaw`, `barcodeBase`,
`barcodeSupplementLength`) — capture-only, from the existing opaque
`barcode` request field. `barcodeSupplementLength` is always null: this
codebase has no supplement-digit (2-digit/5-digit UPC add-on) concept
anywhere — the full 12/13-digit scanned or typed string is retained as
one opaque field end-to-end, confirmed via direct read of the client
scanner, the request contract, and `lookupComicVineByUPC`.

`scripts/query-scanlog.mjs` updated to aggregate the new fields
(identityRoute distribution, totalLatencyMs p50/p95, verificationCostUsd
sum/avg) without breaking `--json` raw-dump mode; tolerates pre-Dispatch-
33 records that simply lack these keys. `SCAN_LOG_INDEX_KEY` import
confirmed intact (unchanged by this dispatch — Fix 32-C's actual change
was the `visionLowButCorroborated` field, not this constant; there was
never a separate index-key bug to fix here).

### Step 5A — prompt-caching audit (mechanism shipped, real numbers pending data)

`[cost-audit]`/`[cache-audit]` tagged `console.log` lines added at every
Claude call site in both `api/grade.js` (`callModel`) and
`api/enrich.js` (`verifyCompsTitles`) — real token counts
(`message.usage`), real computed cost (`PRICING_USD_PER_MTOK`), and for
`api/grade.js` specifically, an ESTIMATED static-prefix length via the
cached `countTokens` call described above.

**Precision correction (2026-08-08, same-day review):** the function was
initially named `getStaticPrefixTokenCount` and its log field
`staticPrefixTokens`, both implying a measured, authoritative count.
Anthropic's own token-counting docs
(`platform.claude.com/docs/en/build-with-claude/token-counting`,
retrieved 2026-08-08) say otherwise, verbatim: *"The token count is an
estimate. In some cases, the actual number of input tokens used when
creating a message might differ by a small amount,"* counts *"may
include tokens added automatically by Anthropic for system
optimizations,"* and — the more consequential line — *"token counting
provides an estimate without using caching logic"* — it does not
simulate or confirm caching behavior at all. Renamed to
`getEstimatedStaticPrefixTokens` / `estimatedStaticPrefixTokens`
throughout, with the docstring and log line now stating plainly that
`usage.cache_creation_input_tokens`/`cache_read_input_tokens`/the
`cache_creation.ephemeral_5m_input_tokens`/`ephemeral_1h_input_tokens`
breakdown from a REAL call (already read by `computeAnthropicCallCostUsd`)
are the only authoritative signal — this estimate is diagnostic-only, a
"is this prefix in the right ballpark" check, never a substitute.

A new `classifyCacheEligibility(estimatedTokens, model)` returns
`likely-eligible`/`likely-ineligible`/`unresolved` against real, verified
per-model cache minimums (`platform.claude.com/docs/en/build-with-claude
/prompt-caching`, "Cache limitations" section, retrieved 2026-08-08 —
**no longer "reportedly," now confirmed**: Haiku 4.5 = 4,096 tokens,
Sonnet 4.5 = 1,024 tokens, Opus 4.7 = 2,048 tokens). Estimates landing
within ±10% of the model's minimum classify as `unresolved` rather than
asserting a side of the line — that 10% band is this file's own chosen
diagnostic margin, not an Anthropic-published error figure, and should
be revisited once real `usage` data shows whether it's too tight or too
loose. If a real call's `cache_creation_input_tokens` and
`cache_read_input_tokens` both read 0, the prefix did not meet the
minimum, full stop — that observation always overrides this
classification.

**No real numbers are reported here yet — that would be fabrication.**
Pull them from Vercel runtime logs (or, once accumulated,
`scripts/query-scanlog.mjs` for the `enrich.js`-side lanes) after this
ships and a real batch of scans runs. Whether Haiku's cache hit rate
being 0% (if that's what the data shows) is a bug or correct behavior
given its real 4,096-token minimum is exactly the open question this
logging exists to answer; do not assume either way before the data is
in.

### Step 5B — Fix 4/4b reachability, traced against the G.I. Joe #303 shape

**Terminology hazard found first:** "Fix 4" is reused for at least four
unrelated things in this codebase — a Ship #23 UI button
("Update All Books"), the manual-identity-bypass branch in
`api/enrich.js`, Ship #14's sanity-threshold tuning
(`pricingEngine.js`), and a Dispatch-15 margin-gate proposal that was
never shipped. The mechanism this dispatch actually means is GrailKey
Dispatch 26's "zero-support unanimous rescue"
(`src/lib/identityCore.js:2227-2409`,
`tests/grailkey-dispatch-26-fix4-zero-support-rescue.test.js`) — Fix 4 is
the issue-axis rescue, Fix 4b its year-axis mirror. Recording this here
so the name isn't silently re-collided with in a future dispatch.

**The trace.** Fix 4 fires only when six conditions ALL hold (full detail
in `identityCore.js`'s own comment, `:2240-2290`); the three that matter
for this shape:
1. `issueDecision.outcome === 'conflicted'` and `authoritativeForCustody === false` (Rule D already produced a non-authoritative outcome).
2. Vision's prior isn't independently trusted (never true for a plain Vision guess).
3. **`isIssueZeroSupport(visionIssueCount, total)`** — raw-pool support for Vision's own issue number is at or below the zero-support ratio floor.

For G.I. Joe #303 (Vision issue = 303, 0/20 raw-pool support, per the
dispatch's own framing): condition 3 above **would be satisfied** by this
shape — a 0/20 pool is squarely inside "zero support." But conditions
4-6 (not reproduced in full here — see the source comment) require
`evaluateUnanimousConsensusPromotion` AND `evaluateTitleTextIndependence`
to both pass on the REPLACEMENT candidate — i.e., the family's own issue
axis must show real, independently-worded unanimous consensus (≥4 unique
rows, exact unanimity, no runner-up, weightSum≥8, distinct itemId AND
seller, AND ≥3 distinct Jaccard-clustered title-wording clusters among
the asserting rows). A genuinely scattered pool — the same
"no-consensus" shape already documented for the Jetsons #19 precedent
(Dispatch 03/05 above, ratio below the 60% bar) — would fail this bar and
correctly DECLINE, not fire.

**Conclusion: Fix 4 is not proven unreachable for this shape.** "Reached
the zero-support gate and correctly declined for lack of a real
replacement candidate" is at least as plausible as "never reached at
all," and the two produce identical observable behavior (Vision's own
issue stands, unrescued) — which is exactly why this was unresolvable
from log absence alone before this dispatch's instrumentation. The
`[commit4.3-zero-support-rescue]` log line already fires on BOTH the fire
and decline path (never silent) — what's been missing is aggregate
volume across real scans to tell "reached-and-declines" apart from
"never reached." That's precisely what `scripts/query-scanlog.mjs`
exists to answer once enough records accumulate; no code changed here,
this is a report-only trace per the dispatch's explicit instruction.

### Step 6 — the certification metric (standing gate for every future routing change)

Accuracy alone is the wrong primary metric — a routing change can raise
raw accuracy while making the WRONG cases worse (confidently wrong more
often, on fewer but higher-stakes books). A candidate architecture wins
only if ALL of the following hold, recorded here as the standing bar:

- **PRIMARY — confident-wrong identity rate ↓ toward zero**
  (`confident_wrong / authoritative_identity_results`). This is the
  metric that actually matters: a book shipped as confidently,
  authoritatively identified that is WRONG is worse than one correctly
  flagged as uncertain.
- **SECONDARY — correct authoritative resolution rate ↑ or unchanged.**
  A architecture that reduces confident-wrong purely by resolving fewer
  books authoritatively isn't winning, it's punting — this metric alone
  distinguishes real improvement from that failure mode.
- **GUARD — false refusal rate ↓ or acceptable.** Prevents gaming the
  primary metric by refusing to resolve everything (a system that never
  claims authority can trivially hit zero confident-wrong).
- **ALSO tracked, not gating alone:** fallback parity (the parity harness
  above), identity-correction rate, grade drift, median + p95 latency,
  external cost-per-scan.
- **AND:** no new structural failure class introduced (a genuinely new
  way to be wrong that didn't exist before, distinct from an existing
  failure mode simply occurring at a different rate).

Any future routing/fast-lane proposal is evaluated against this exact
gate, not against raw accuracy alone.

### Step 7 — the parity harness (stub, ships before the shadow lane it will gate)

`tests/grailkey-dispatch-33-parity-harness.test.js` — `assertParity`
deep-compares `identity`/`variant`/`compPool`/`price`/`decision`/
`warnings` between a legacy-path result and a new-architecture result;
anything outside the allowed-diff set (`timing`, `instrumentation`,
`latency`, `cost`, `correlationId`) that differs is a hard FAIL, with no
"close enough" exception. Shipped with **zero cases, on purpose, before
any shadow lane exists** — per explicit instruction, an empty harness
with a documented contract forces the next phase to have a gate already
waiting for it, rather than building the gate to fit whatever gets
written later (which is how parity tests become theater). **Zero cases
is a LOUD SKIP, not a pass** — same reasoning as this project's other
intentionally-red suites (CLAUDE.md's "Known stale test suites"
baseline): an unexplained green reads as coverage to a future session,
and there is none here yet. The harness exits non-zero with an explicit
SKIP banner for as long as it has zero cases; it only becomes a real
pass/fail gate once a future shadow lane adds its first case.

## GrailKey Dispatch 34 (2026-08-08) — ledger consolidation

Analysis-only dispatch except where explicitly noted. Source: two real
production scans (Hero for Hire, Spawn #351) reviewed against the
Dispatch 33 instrumentation. One code change authorized and shipped
(Step 1, timing collision); everything else below is recorded for future
prioritization, not fixed this dispatch.

### New standing invariant — REJECTION MUST NOT CREATE AUTHORITY

> **Evidence rejected from an authority decision may not regain authority
> merely because rejection emptied the candidate population.**

Recorded alongside Monotonic Evidence Extension and No Self-Corroboration
(GrailKey Dispatch 33) as a third standing invariant governing every
future evidence source.

**Hero for Hire is the concrete violation:**
```
[cv-year-strict] REJECT ×12
[cv-year-strict] would remove all 12 issues — keeping original set
[comicvine] matched=Luke Cage #1 (vol_id=101484)   ← rejected 2017 volume
```
Every ComicVine candidate failed the year gate. The rejected population
was then restored (the "would remove all 12 — keeping original set"
fallback), and one of those SAME rejected candidates was subsequently
selected as the matched ComicVine record. The gate's own rejection
verdict was silently overridden by the emptiness of its result, not by
any new evidence — rejection produced authority by default. This is the
direct violation the invariant exists to name.

**Scope discipline applied to two related-looking mechanisms, per
explicit instruction — do not conflate:**
- The single-shot era-gate fallback is tracked as the SAME structural
  class only if a future source trace confirms rejected evidence can
  re-enter the same authority axis through it — not asserted here
  without that trace.
- The variant fallback (thin-market comp fallback reintroducing degraded
  market evidence for PRICING) is related but NOT claimed as an instance
  of this invariant — it risks contaminating a price with weaker
  evidence, not creating IDENTITY authority from a rejected candidate.
  Kept in the same broader "fallback risk" family, not asserted as the
  same violation, absent source-level proof.

**No fix in this dispatch.** Hero for Hire itself is not patched
individually — the fail-open pattern is tracked below pending frequency
data from the upcoming batch.

### 22c word-order false positive — counterexample, no code change

No "Q84-AMENDED" label exists verbatim anywhere in this repo's docs
(checked directly) — the closest actual material is Q84's dual-axis gate
work threaded through several entries elsewhere in this file (the
`applyDualAxisGate`/`isBareCreatorTokensOnly` coupling in CLAUDE.md, and
the coherent-content-lane entries above). Recording this counterexample
as its own entry, cross-referenced to that material, rather than to a
label that doesn't exist in this codebase.

Hero for Hire's `22c` log:
```
[22c] title rejections:
ebay="luke cage hero for hire"
    expected="hero for hire luke cage"

vision="luke cage hero for hire"
    expected="hero for hire luke cage"
```
Same meaningful token set (`luke`, `cage`, `hero`, `for`, `hire`) on both
sides — only word order differs, and there's no descriptive-token
injection anywhere in either string. This is a legitimate dual-naming
case: the catalog series is *Hero for Hire*, the cover/marketing title is
*Luke Cage, Hero for Hire* — both real, both referring to the same book.

This is the empirical counterexample against ever making `22c` terminal
purely on "multiple authorities disagree with canonical word order."

**Rule refinement for any future `22c` work:**
> A unanimous title rejection may justify a revert when the meaningful
> token SETS differ. Word-order difference alone is insufficient.

`22c` is not modified this dispatch. Counterexample and rule recorded
only.

### Condition-evidence overreach — priority elevated

Now directly measurable because GrailKey Dispatch 33 records
`conditionEvidenceLevel` on every scan. Hero for Hire's own record:
```
conditionEvidenceLevel = front
1 photo stored
Back missing / Spine missing / Pages missing
```
yet the condition report asserts:
```
"interior pages appear sound"
"No major tears, stains, or restoration detected."
```
Neither claim is supported by a front-cover-only observation. **This is
a high-risk condition-claim failure, not copy-quality noise** — it's an
affirmative claim about a surface that was never photographed.

Required conceptual distinction for any future grading-prompt work:
```
OBSERVED (front-only evidence level)
  front-cover corner chipping, front-cover edge wear, visible stamp

NOT OBSERVED
  interior condition, back-cover condition, spine condition,
  restoration status beyond visible front evidence
```

**Also track separately — pseudo-precision:** phrases like *"CGC may
dock ~1.3 grades"* or *"may dock up to 4 grades"* imply a calibrated
model backing that specific number. GrailKey must eventually be able to
name the empirical source/model behind such figures, or stop presenting
them with that level of implied precision. No grading-prompt change this
dispatch.

### Fix 4 — synthetic anchor scoping (for the next attempt, not yet built)

Fix 4 (GrailKey Dispatch 26's zero-support unanimous rescue — see
Dispatch 33's Step 5B trace above) still needs a must-pass anchor. If the
next 10-15 heterogeneous production scans fail to produce a natural
qualifying case, a synthetic fixture constructed from the verified source
predicates is authorized — but two claims must stay separate:
```
synthetic fixture PASS  =  the intended code path is executable and
                            behaves correctly under those exact conditions

does NOT establish        production reachability or frequency
```
Production reachability remains an empirical scan-log question, answered
by aggregating the `[commit4.3-zero-support-rescue]` fire/decline log
line (already emitted on both paths, per Dispatch 33) — never by a
synthetic fixture's pass/fail alone. If a synthetic fixture is built in a
future dispatch, it certifies mechanism correctness, not real-world
validation, and must be labeled as such everywhere it's cited.

### Virgin/sketch variant class — status corrected

Prior framing (`6/6 failures`) was a stale pre-fix count. **Spawn #351 is
a real production virgin-variant SUCCESS**, not a failure: virgin
consensus established, wrong Cover A/B sold rows correctly rejected,
active virgin pool retained, fallback sold evidence prevented from
contaminating the variant-specific active anchor.

**Corrected status:** *Historically failing; at least one confirmed
post-fix production pass; class not yet certified.* Not `UNSOLVED` — that
label no longer matches the evidence. Continue collecting virgin/sketch
cases before attempting certification.

### Timing mark collision — SHIPPED (Step 1, `9eb4601`)

Two production scans (Hero for Hire, and one prior) reproduced an
impossible `phase2_start > phase2_complete` structure. Root cause:
`mark('phase2_start')` was called at two semantically distinct points in
`api/enrich.js`'s handler — the real "PHASE 2: DATA FETCHING"
identity-confirmed lookup window (`identity_fetch_start`/`_complete` as
of this fix), and separately the Step 2b comps/pricing-fetch gate
(`comps_pricing_start` as of this fix) that `out.timings.comps_ms`
actually measures against `comps_fetched`. The second write silently
overwrote the first in the shared `t` marks object — `comps_ms` itself
computed the numerically correct duration by last-write-wins coincidence,
but the raw marks dump lost the ability to show the first phase's true
boundary at all, and the two labels' final values could read as an
impossible ordering when compared against each other. Pure rename, one
downstream key-read updated to match, zero control-flow change — same
inputs, same identity, same comps, same pricing, same decision. All 8
documented-baseline test suites (decision-engine, comp-filter-hygiene,
sold-verification, identity-gate, image-search-extraction, mega-keys,
pattern-k-dedupe-issue, q-adv397-visual-guard) matched their exact
recorded failure counts before and after — **NO NEW REGRESSION AGAINST
DOCUMENTED BASELINE.** Deployed and verified: `dpl_7jQKZ2qxXY1VvFtMs87T8wK1uwgr`,
commit `9eb4601bccbc9d603346c8f2de3aa718eef67a8b`, READY, target=production,
SHA-matched against `git log` directly (not certified via alias).

### Open ledger — remaining items, by tier

**Structural, awaiting frequency data (do not patch individually yet):**
- **ComicVine fail-open** — direct instance of "rejection must not create
  authority" (Hero for Hire, above). Downstream story-era gate happened
  to prevent customer-facing contamination on this specific scan — that
  is not a general guarantee.
- **Key-event authority gap** — Hero for Hire's raw pool asserted
  `first-appearance ×3`, `1st App ×2` while structured state stayed
  `keyIssue: null, major: false, minor: false, mult: 1`. Track as a gap
  between detected key-event EVIDENCE and structured key KNOWLEDGE. Do
  NOT auto-promote marketplace phrases into key authority — that would
  recreate marketplace-SEO contamination (the exact class this project
  already deleted once, GrailKey Dispatch 32's coherent-content-token
  lane). The open question is architectural: how does verified key-event
  knowledge become authoritative without treating seller copy as truth.
- **Identity provenance/display mismatch** — UI showed `Identity: vision`
  while the final pipeline's resolved source was
  `title-family-top-rank-protection`. Unresolved question: does this
  correctly distinguish "initial identity source" from "final authority
  path," or is the UI displaying stale/incomplete provenance? Not changed
  until the ontology is traced.
- **Story-metadata banner** — do NOT hard-code the previously-quoted
  `~85%` firing rate; it was an eyeballed count across the incident
  corpus, not a query result. Let the Dispatch 33 scan-log aggregation
  establish the real measured rate. Known issue independent of the rate:
  the warning fires often AND has also been absent on cases where story
  metadata was genuinely wrong — current information value looks weak in
  both directions.
- **External-source latency** — Hero for Hire ~6.0s total (heavy
  ComicVine/PriceCharting lookup + requery time) vs. Spawn #351 ~2.45s.
  Two scans is not a distribution — do not generalize. Measure real
  p50/p95 only after the timing fix above is live (it now is).
- **22c word-order false positive** — see dedicated entry above.

**Designed but production-unvalidated:**
- **Fix 4** — needs a must-pass anchor; see scoping entry above.
- **Fix 6** (`rescueYearFromVisionFallback`, GrailKey Dispatch 19) —
  still production-unvalidated. Spawn #351 no longer exercises it because
  upstream year authority now resolves before the rescue would be needed
  — **Spawn does NOT count as Fix 6 validation.**

**Historically failing / post-fix uncertified:**
- **Virgin/sketch variant class** — see corrected status entry above.
- **Cover matcher** — still blocked on rights-safe image corpus/licensing
  and catalog-import infrastructure (GrailKey Dispatch 17). Explicitly
  NOT a prerequisite for the current batch.

**Parked — do not reopen this dispatch unless a new scan independently
reproduces one:**
key multiplier (prior 1.5× overshot the PC ladder by ~65%, GrailKey
Dispatch 12-14), stale threshold, first-name split, `dekal`/`spears`,
floor-on-contaminated-pool (3 historical instances), PriceCharting
cross-category leak, comp-query degradation, title-family fragmentation
(GrailKey Dispatch 21 — currently single-book evidence).

### Next execution (per this dispatch)

1. **Step 1 — timing instrumentation.** SHIPPED, this section, above.
2. **Step 2 — production batch.** 10-15 heterogeneous ORDINARY books, not
   hand-picked problem cases — a representative operational sample.
3. **Step 3 — aggregate**, ranked by measured scan-log frequency, not
   anecdote: (1) ComicVine fail-open, (2) key-authority gap, (3)
   condition-evidence overreach, (4) identity provenance/display
   discrepancy, (5) external-source latency, (6) story-metadata warning
   behavior, (7) Fix 4/4b eligibility/entry/decline, (8) Fix 5 firing
   frequency, (9) post-fix virgin/sketch success/failure rate.

**Cost data note:** two verification-lane observations so far
(`$0.000409`, `$0.000434`) — one lane, two data points. Do not average
these into an architecture conclusion; wait for the batch.

## GrailKey Dispatch 37 (2026-08-09) — cache-key proxy-vs-predicate fix shipped, standing invariant, architecture scope closed

Three commits shipped (`c11346c`, `913cb46`, `c8a9c71`), each verified in
isolation against the complete final tree with the documented baseline
re-run and matched exactly — no new regression. Full commit messages
carry the per-suite pass/fail breakdown; not repeated here.

### New standing invariant — CACHE CORRECTNESS IS AUTHORITY CORRECTNESS

> **A correct filter is worthless if its output can later be served to a
> different asset under an incomplete cache identity.**

Fourth standing invariant, joining Monotonic Evidence Extension and No
Self-Corroboration (GrailKey Dispatch 33) and Rejection Must Not Create
Authority (GrailKey Dispatch 34). Concrete instance this dispatch: the
active-comp cache key (`buildActiveCompCacheKey`) was built from
title+issue alone while `applyFilterChain` (`api/comps.js`) actually
consumed seven material inputs — grade target, confirmedYear,
confirmedVariant, isGraded, labelType, signedConsensus, assetType — none
of them keyed. A correctly-filtered pool for one grade/year/variant
combination could be served, byte-identical, to a request that resolved
to a different asset entirely. Fixed via `buildFilterContextFingerprint`
(SHA-256 over all seven, fail-closed — `buildActiveCompCacheKey` now
throws on a missing/malformed fingerprint rather than silently
stringifying `undefined` into the key). `COMP_FILTER_VERSION` bumped
9→10. See commit `913cb46` for full detail.

### Derived rule — derive the key from the predicate, never a proxy

> **Derive the key from the lookup's own predicate, never from a proxy
> for it.**

Concrete instance: `buildComicVineCacheKey`'s `poolYearHint` segment
must be keyed (non-null) exactly when `lookupComicVine`'s own scoring
would actually consult it — that condition is `hasYearComparison =
Boolean(comicYear && startYear)` (`api/enrich.js:963`), a truthiness
predicate. An earlier draft of this dispatch's fix gated on `comicYear
== null` instead — `year present` used as a stand-in for `year
usable-and-comparable`. The two diverge on exactly the input GrailKey is
known to produce: `parseInt("Unknown", 10)` is `NaN`. `NaN != null` is
`true` (so `== null` reads "year present," suppressing the hint from the
key) while `Boolean(NaN)` is `false` (so the real lookup reads "no year,"
and DOES consult the hint). Two requests sharing the same unusable year
but different `poolYearHint` values would have silently collided on one
cache entry despite the real lookup behaving differently for each — a
false-HIT, caught before shipping only because the diff was checked
against `hasYearComparison`'s literal source rather than reimplemented
from a paraphrase of it. Regression case:
`tests/cacheKeys-comicvine-year.test.js`, the `"Unknown"`-year block.
Generalized rule for any future cache-key or gate-parity work in this
codebase: when a key or gate is meant to mirror another function's
condition, read that function's actual predicate at the call site — do
not re-derive a description of it from memory or from a comment.

### Tracked debt — duplicated normalization inside buildFilterContextFingerprint

`buildFilterContextFingerprint`'s grade/year derivation
(`deriveNumericGradeTargetForFingerprint`,
`deriveNormalizedYearForFingerprint`, `src/lib/cacheKeys.js`) is
deliberately DUPLICATED from `fetchComps`'s own inline normalization
(`api/comps.js`, ~line 984-989 for grade, ~line 1020 for year) rather
than imported, to scope this fix to the cache-key layer only. This is
the same shape as the **Drifted-duplicate-constant class** already
documented three times in this file (Q119: five separate
`COMPOUND_TITLE_WHITELIST`-equivalent lists; Q127: ~10 separate
`req.body.variant` read-sites; Q128: year-tolerance constants
independently drifting between `api/comps.js` and two passes of
`soldVerification.js` behind a comment that falsely claimed they still
matched). Explicit failure mode for this fourth instance: **if
`fetchComps`'s inline grade/year normalization ever changes and
`cacheKeys.js`'s two derive functions aren't updated identically, the
fingerprint will silently key on stale semantics** — it will keep
computing a valid-looking 64-character hash, tests against the
fingerprint function in isolation will keep passing, and the drift will
only surface as a real cache-identity failure once a request pattern hits
the exact input where the two normalizations disagree. Not remediated
this dispatch (duplication was the explicit scope decision). Flag: any
future edit to `fetchComps`'s inline grade/year parsing must grep
`cacheKeys.js`'s two derive functions and update them in lockstep, the
same discipline `getEraYearTolerance`/`evaluateEraYearMatch` now enforce
for the year-tolerance class.

### Architecture decision — 14-broker memo rejected except two items

An external memo proposed 14 broker abstractions (ModelRouter,
SourceBroker, VisualBroker, CatalogBroker, MarketBroker, AgentGateway,
SkillRegistry, CommerceGateway, PaymentBroker, RightsPolicyEngine,
EvaluationHarness, and others), an 8-layer event-sourced kernel, MCP
server exposure, A2A, ACP/UCP agentic-commerce protocols, x402 payments,
WebMCP, and on-device inference. **Rejected in full except two items,
confirmed and recorded this dispatch:**

- **Adopted:** the four-layer authority distinction (*observation is not
  a claim; a claim is not authority; authority is not history*), and an
  immutable ledger with supersession — as a forward **design target
  only**, not a refactor, so future persistence decisions aren't built in
  a direction that forecloses it.
- **Declined:** all 14 broker abstractions, the 8-layer kernel, and every
  agent/commerce-protocol item (MCP server exposure, A2A, ACP/UCP, x402,
  WebMCP, on-device inference). Checked directly against the current
  codebase before declining — none of the 14 broker names, kernel layers,
  or protocol integrations appear anywhere in this repo; nothing declined
  is currently load-bearing.

**Reasoning, recorded so this doesn't resurface without new evidence:**
the memo's central justification was insurance against vendor lock-in,
which this project has no live symptom of. Meanwhile the SAME dispatch
that evaluated the memo found this codebase's single existing
active-comp cache key was missing **seven** material dependencies (not
six — the exact count is grade target, confirmedYear, confirmedVariant,
isGraded, labelType, signedConsensus, assetType; corrected here from an
earlier six-item paraphrase of this same finding, since this file is the
canonical record and the miscount would otherwise propagate). Fourteen
new broker abstractions is fourteen new identity/caching/normalization
surfaces, each capable of the exact class of bug this one dispatch just
spent three commits fixing on a single surface. The adopted two items
(authority-layer distinction, ledger-as-target) cost nothing to hold as
direction and constrain future work in the right direction; the declined
items would have created surface area with no demonstrated corresponding
need.

### GCD corroboration — second source, reported not independently verified

A June 2026 GCD technical mailing-list message is reported to state "We
do not have an API at this time" — consistent with the App Guidelines
text obtained in GrailKey Dispatch 17. **Recorded with the same
verbatim-vs-reported caveat Dispatch 17 already applies to its own
source:** this message was not independently fetched or read in full by
this session; it is recorded as reported corroboration, not as a
directly-verified primary source. Taken together, two independently-
sourced statements now agree GCD has no live query API — this
strengthens, but does not newly establish, the cover-matcher scoping
already on record (DB-dump import + own query layer + refresh cadence,
GrailKey Dispatch 17; still blocked on rights-safe image corpus/
licensing and catalog-import infrastructure, per Dispatch 34's open
ledger). No cover-matcher work authorized or started this dispatch.

### Blocked items — reaffirmed, no workaround taken

- **Bone pricing fix** — still blocked on production KV credentials for
  the 13-scan blast-radius report.
- **Fix 4** — still blocked on a must-pass anchor; scoping only, see
  GrailKey Dispatch 34's dedicated entry above.

### Next by measured frequency, once the above unblock

Key-authority gap (6/15, 40%), then ComicVine fail-open (4/15, 27%) —
reported ranking from the production batch Dispatch 34's "Step 2/Step 3"
plan called for. Note this reverses Dispatch 34's own anecdotal
1-ComicVine/2-key-authority ordering (recorded there explicitly as
unranked hypothesis, not measurement) — the measured batch is the
authoritative ranking going forward once available for direct
cross-check in a future dispatch.

## GrailKey Dispatch 38 (2026-08-09) — third axis of "rejection must not create authority"; Bone root-cause correction; cache-fingerprint certification partial

Post-deploy production evidence (13-book batch against `6f17f63`). Record
only — no code shipped this dispatch. Pricing-math surfaces named below
(mega-key floor) are unchanged; any fix requires its own explicit
greenlight per the standing pricing-math protocol.

### Third axis — mega-key floor re-authorizing price after a structurally weak market path

Extends **Rejection must not create authority** (third standing
invariant, GrailKey Dispatch 34) with a third concrete instance,
alongside:
1. ComicVine fail-open (Hero for Hire, Dispatch 34) — the year-gate
   rejects every candidate, the rejected population is restored, and a
   rejected candidate is then selected.
2. The variant fallback (thin-market comp fallback reintroducing
   degraded market evidence into pricing) — related, tracked separately
   in the same invariant family since Dispatch 34.
3. **The mega-key floor, this dispatch.** The floor can re-authorize a
   full price after the market-evidence path feeding it has already been
   assessed as structurally weak (this batch's live case: tier=2,
   `soldPool=1`, `activePool=2`) — the same shape as the other two: a
   mechanism upstream demotes or rejects the evidence as insufficient,
   and a downstream consumer restores full pricing authority from it
   anyway.

One invariant, three independently-discovered axes (identity, comp-based
pricing, key-floor pricing) — recorded together so a future fix to any
one axis doesn't get treated as having closed the general class.

### Bone root-cause correction — Dispatch 36's fingerprint fix does not fix Bone

**Explicit correction to the record, so the blast-radius report isn't
scoped too narrowly once KV access unblocks it:** the active-comp cache
fingerprint fix (commit `913cb46`, GrailKey Dispatch 36 P0) corrects
cache IDENTITY — it stops one grade's filtered pool from being served to
a different grade's request. It does **not** correct Bone's shipped
price. As scoped through Dispatch 36 alone, the fix would have corrected
the specific $19.33 figure implicated in the original cache-collision
finding — **and Bone would still have shipped $800**, because the $800
traces through the third axis above (mega-key floor), a structurally
different mechanism the cache-identity fix never touched. Confirmed live
post-deploy: Bone is still producing `tier=2 soldPool=1 activePool=2` →
a LIST_NOW-class output, with the fingerprint fix already in production.

**This is why the blast-radius report (blocked on KV, below) must trace
the full path — cache key alone is not sufficient evidence of a fix.** A
report that only checked "did the cache key change under the new
fingerprint" would have wrongly certified Bone as resolved.

### Cache-fingerprint certification — deployed and discriminating, certification incomplete

13-book batch confirms `buildFilterContextFingerprint` is live and
producing distinct keys in production, but the certification protocol
agreed for this dispatch is not yet satisfied:

- **All `ac:v10` lookups MISS across the full batch.** Expected and
  correct — `COMP_FILTER_VERSION` 9→10 orphans every pre-existing v9
  entry by design (Dispatch 36). This batch proves the orphaning
  behavior, nothing more; **the cache HIT path remains unproven** — no
  entry in this batch was old enough to have a v10 sibling to hit.
- **Bone scanned at two grades produced distinct fingerprints and
  distinct pools (2 vs. 22 comps) — but the two scans' titles differed
  in case.** Title casing is not one of the fingerprint's seven keyed
  axes, but it IS part of the surrounding cache key's own `confirmedTitle`
  segment and can independently affect eBay query results upstream of
  the fingerprint entirely. Because casing varied between the two scans,
  **`numericTarget` (grade) is not yet isolated as the cause of the
  2-vs-22 pool difference** — a real, uncontrolled confound, not a
  disproof of the fingerprint working correctly.

**Certification protocol, not yet run (needs controlled scans, casing
held constant):**
1. Same book, same grade, twice → must **HIT**. Proves the cache
   actually reuses a fingerprint-matched entry, not just that it writes
   distinct keys.
2. Same book, different grade, same casing → must **MISS**, with
   grade-proximity correctly rerunning. Proves the fingerprint's grade
   axis alone is what drives the miss, with the casing confound removed.

### Working correctly, confirmed by this batch

- Grade-proximity rejection functioning as designed across the batch:
  ASM #147, Batman #213, Iron Man #126.
- Classics Illustrated #26 correctly refused to cache on
  `issueAuthority.status === "conflicted"`, routing to `ID_REQUIRED`
  instead of caching or pricing a conflicted identity.

### New anomaly flagged, not investigated — Marvel Age #1000

257 log lines, no `[decision]` line emitted at all. **Second occurrence
of this exact shape** (first occurrence not otherwise detailed in this
batch's report). Not scoped or root-caused this dispatch — flag for the
next batch review; if a third occurrence appears, treat as a pattern,
not a fluke.

### Blocked, unchanged

- **Bone blast-radius report** — still blocked on production KV
  credentials. Scope confirmed widened by the root-cause correction
  above: must trace the full mega-key-floor path, not just cache-key
  identity.
- **A/B/C cache certification** — needs the two controlled scans above
  (same book/same grade twice; same book/different grade/same casing),
  not yet run.
- **Fix 4** — still blocked on a must-pass anchor (GrailKey Dispatch 34).

### Next by measured frequency, unchanged

Key-authority gap (6/15, 40%), then ComicVine fail-open (4/15, 27%) —
still pending the KV/certification unblocks above before either gets its
own dedicated dispatch.

## GrailKey Dispatch 39 (2026-08-09) — pricing auditability gap named; Bone dataset recollection protocol; KV access path corrected

Record only, no code, no fix this dispatch. Direct continuation of
Dispatch 38's blocked gates — one gate's access path corrected, one new
architectural gap named as a direct consequence of attempting it.

### KV access path corrected — `vercel env pull` abandoned for these credentials

`KV_REST_API_URL`/`KV_REST_API_TOKEN`/`KV_REST_API_READ_ONLY_TOKEN`/
`KV_URL`/`REDIS_URL` (plus `ANTHROPIC_API_KEY`/`ACCESS_CODE`/
`GOCOLLECT_API`) pulled as deterministic empty strings via
`vercel env pull` — reproduced twice, while every other production var
(`PRICECHARTING_TOKEN`, `XIMILAR_API_TOKEN`, `COMICVINE_API_KEY`,
`EBAY_*`) pulled with real values in the same file. Root cause: these
are stored as Vercel **Sensitive** variables, not the milder Encrypted
type `vercel env ls` labels them as in list view — Sensitive values are
write-only by platform design and never come back through the CLI, the
API, or the dashboard once set. **Do not retry `vercel env pull` for
these — it is not a flag or retry problem, it is a platform access
boundary.** Corrected path: this is an Upstash-backed integration, so a
read-only REST token is obtainable directly from the Upstash console
(Console → Redis → production DB → Connect/REST), independent of
Vercel's restriction, into a separately gitignored local file. In
progress, owner-side.

### New architectural debt — PRICING AUDITABILITY GAP

> **A past price cannot be reproduced from durable telemetry alone.**

Discovered as a direct consequence of attempting the Bone blast-radius
report (Dispatch 34/38): the durable scanLog record
(`src/lib/scanLog.js`, 90-day TTL) captures identity-resolution state
(`issueAuthority`, `familyWeight`, `poolSizes` for identity candidates)
but has **no fields for the active/sold comp pools or the pricing-branch
inputs** (tier, mega-key-floor application, final price, dispersion) that
would be needed to reconstruct a historical valuation. The one place
that data DOES exist — the `ac:v10:*` cached comp-pool objects
(`api/kv-cache.js`) — has a **one-hour TTL** (`KV_TTL.ACTIVE = 3600`).
Once that hour passes, the evidence a price was built on is gone,
durably, everywhere. Today's pricing pipeline can be fully event-sourced
for identity, and not at all for the market evidence and pricing
decision that actually produced a shipped number. Not remediated this
dispatch — named so no future blast-radius attempt re-discovers it from
scratch, and so any future scanLog schema work treats "pricing branch
inputs" as a known, scoped gap rather than an incidental omission.

### Bone dataset must be recollected — the 13/15-book batch's pools are gone

Direct consequence of the TTL fact above, not a new finding: the pools
Dispatch 38's batch analysis would have needed no longer exist —
`KV_TTL.ACTIVE = 3600` means any `ac:v10:*` entry from that batch expired
long before KV read access was corrected. **Recollection protocol,
specified now so it's ready the moment Upstash read access lands, not
improvised under time pressure against another expiring window:**

1. Scan a **fresh** batch (Bone plus the rest of the representative set)
   against current production.
2. Retrieve each book's `ac:v10:*` object **immediately**, before the
   one-hour TTL elapses — this step is time-critical in a way most of
   this project's other KV work has not been.
3. Save a **sanitized** local fixture per book (pool contents only, no
   credentials, no unrelated PII) — freeze it. This fixture, not live KV,
   becomes the input for everything downstream.
4. Implement the count+dispersion recovery predicate **offline** against
   the frozen fixture — no production code touched at this stage.
5. Replay **every** book in the fixture through the predicate, not just
   Bone, and report every changed outcome — including full
   mega-key-floor behavior, per the Dispatch 38 acceptance criterion
   (Bone demotes and does not re-emerge at $800 through the floor; clean
   pools stay semantically unchanged; if normal books shift, the
   dispersion bound is wrong, not Bone).
6. Only after that offline replay report is reviewed does a production
   code proposal get scoped — still subject to the standing
   pricing-math greenlight protocol regardless of how convincing the
   offline replay looks.

### A/B/C cache certification — status correction

Dispatch 38 recorded this as blocked on KV credentials; that was
imprecise. **A/B/C is not blocked on credentials at all — it only needs
the app's own runtime traces (the scan logs each request already
produces), not a direct KV connection.** Three Batman #213 scans
(A: MISS + write, B: same request, must HIT the same key, C: grade
changed only, must MISS with grade-proximity rerun) are in progress
against production directly. Results land in their own dispatch.

### Holding

Everything else — no key-authority work, no ComicVine fail-open work,
Q54 work, or any other expansion — stays held pending the A/B/C
certification result and the Bone dataset recollection above.

## GrailKey Dispatch 40 (2026-08-09) — Gate 2 (A/B/C) CLOSED: PASSED, stronger than specified; new decision-layer non-determinism finding

Record only, no code shipped. Live production evidence: three Batman
#213 scans against `f0690ab`/`dpl_FVdxeJXajkXqy4jmTGEzRKmwMReT`.

### A/B/C active-comp cache certification — PASSED

| Time | Grade | Fingerprint | Result | Pool |
|---|---|---|---|---|
| A 19:15:47 | GD 2.0 (target 2) | `7c71e899…` | MISS → SET | cached 17 |
| C 19:18:03 | FN 6.0 (target 6) | `fd384d8e…` | MISS → SET, grade-proximity reran (`before=14 after=10, ±1.5 from 6`) | cached 9 |
| B 19:20:19 | GD 2.0 (target 2) | `7c71e899…` | **HIT** | **activePool=17**, exactly A's pool |

Both halves of the Gate 2 requirement (`c8a9c71`/`913cb46`'s fingerprint
work) are proven, not merely asserted:
- Same normalized context → same fingerprint (`7c71e899…` recurred
  identically at 18:05, 19:15, and 19:20 — the 18:05 occurrence MISSED
  its own repeat at 19:15 correctly: 70 minutes elapsed against the
  1-hour `KV_TTL.ACTIVE` TTL, expected behavior, not a defect).
- Grade change alone → different fingerprint, with grade-proximity
  correctly rerunning (`fd384d8e…` on the FN 6.0 scan).
- **B retrieved exactly what A cached** — the actual missing proof from
  Dispatch 38's certification protocol, now closed.

**Stronger than the protocol specified:** C ran between A and B, which
wasn't required by the original design. A different-grade scan
sandwiched between A and B did not clobber or contaminate A's entry —
B still hit A's exact key with A's exact pool. This proves the Hero for
Hire class of cross-request contamination impossible under the new
fingerprint scheme, not merely absent from this one test. **Gate 2:
CLOSED.**

### New finding — decision-layer non-determinism, independent of pricing

Same book, same fingerprint, same cached pool, same price, three scans:

| Time | Price | Pools | Decision |
|---|---|---|---|
| 18:05:16 | $19.24 | sold 19 / active 14 (fresh MISS) | LIST_NOW, high, warnings=0 |
| 19:15:47 (A) | $19.24 | sold 19 / active 17 (fresh MISS) | RESEARCH, low, warnings=1 |
| 19:20:19 (B) | $19.24 | sold 19 / active 17 (**cache HIT of A**) | LIST_NOW, high, warnings=0 |

A and B are the sharpest pair: **identical fingerprint, identical
cached pool object (B is a literal HIT of A's write), identical price —
and opposite decision.action.** The pricing layer was stable and
correct all three times; something entirely outside it flipped
`decision.warnings` from empty to non-empty and back.

**Investigated via direct code read (no live log access to the actual
`decision.warnings` array or `[ship28b-conflicts]` line for these three
specific requests — this is a code-grounded hypothesis, not a confirmed
root cause):**

`api/enrich.js`'s active-comp cache boundary (`ac:v10:*`, the code this
dispatch just certified) sits entirely *inside* the pricing path. Two
mechanisms run **downstream of, and independently from,** that boundary
on every request regardless of HIT or MISS:

1. **`allConflicts` is recomputed fresh every request**
   (`detectIdentityConflicts` + `detectCompsConflicts`,
   `api/enrich.js:6108-6140`), gating `shouldRunAIVerify`. Its inputs
   (`visualConsensus`, `comicVine`, `priceCharting`, live
   `compsFromEbay` metadata) are not all part of the cached pool object
   — some come from identity resolution, which runs on a **fresh,
   uncached eBay image search every single request**
   (`lookupEbayIdentity` — there is no identity-level cache anywhere in
   this pipeline, only the ComicVine/PriceCharting/active-comp caches
   downstream of it). Two calls 5 minutes apart can see different live
   eBay search-result ordering/content, changing `visualConsensus`
   without touching the active-comp cache at all.
2. When `allConflicts.length > 0`, `verifyCompsTitles` (AI verify) runs
   — a **live, non-deterministic Claude call** — and its output filters
   `rawComps.recentSales` downstream of the cache read. A cache HIT
   returns the identical raw pool, but AI verify's filtering of that
   pool is not itself cached or pinned to the fingerprint; it can
   legitimately produce a different verified subset on two calls
   against the exact same input pool.

Either path can flip a `criticalWarnings`-listed slug
(`src/lib/decisionEngine.js:697-722`) without moving price at all — most
plausible candidates given they depend on live, per-request identity/
consensus state rather than the cached price pool:
`vision-confidence-overridden` (fires on `isVisionLowButCorroborated`,
itself downstream of Vision's own per-request, non-deterministic
confidence read — `api/grade.js`, a separate LLM call every scan),
`issue-consensus-conflict`, `identity-conflict-unresolved`,
`zero-verified-comps`/`ai-verify-rejected-all` (both downstream of AI
verify specifically). **Not narrowed further than this without the
actual `decision.warnings` array or `[ship28b-conflicts]` log line from
the 19:15 response** — that is the specific artifact that would confirm
or eliminate candidates from this list; the confirming evidence stays
uncaptured until a future scan pins down which slug actually fired,
rather than guessing now. No code changed to investigate or fix this;
flagged as a new open item, independent of and unrelated to the
cache-fingerprint work this dispatch certified.

**Architectural framing, stated plainly because it sets a ceiling, not
just a bug report:** the finding here isn't merely "a warning flipped."
The cache boundary this dispatch just certified sits *below* two
uncached, non-deterministic inputs — the live eBay image search feeding
conflict detection, and Vision itself. **Deterministic pricing does not
imply deterministic routing, and no amount of cache correctness changes
that.** Gate 2 proves the price a request produces is reproducible;
nothing in this dispatch, or available to fix within the current
architecture's identity/Vision layers, makes the *decision* that price
gets routed through equally reproducible. That is a property of the
current design, not a defect introduced by any commit in this series —
worth stating explicitly, because it bounds what "certified" can mean
for anything downstream of pricing until the identity and Vision layers
get their own reproducibility story.

### Bone — confirmed unchanged, more precisely specified

`tier2_active_dominant_thin_sold` → `$19.33` → `mega-key-floor` →
`$800`, decision `LIST_LOW` (corrects the looser "LIST_NOW-class"
phrasing this was recorded with in Dispatch 38/39 — now confirmed to the
exact branch name and decision action). Still blocked on the Upstash
read-only token and a fresh pool capture per the Dispatch 39 recollection
protocol — the 13/15-book batch's own pools are gone (`KV_TTL.ACTIVE`).

### Status

Gate 2 (A/B/C cache certification): **CLOSED, PASSED.**
Gate 1 (Upstash read-only token): still open — the only remaining
blocker on Bone dataset recollection.
Decision-layer non-determinism: new, open, record-only, no fix scoped.
Holding everything else, unchanged.

## GrailKey Dispatch 41 (2026-08-09) — Gate 1 CLOSED; Marvel Age #1000 settled; sold-pool durability gap; Bone recollection tooling ready

Record only, no production code. Gate 1 access corrected in Dispatch 39
(Upstash console, not `vercel env pull`) is now live — read-only Upstash
credentials confirmed working (`dbsize: 330`, real key sample returned,
matching the certified Dispatch 40 Batman #213 keys exactly). No
credential value has been printed, echoed, or logged anywhere in this
investigation at any point.

### Gate 1: CLOSED

Both remaining gates from Dispatch 38/39/40 are now closed. Only the
Bone recollection work itself remains, tooling for which is below.

### Marvel Age #1000 — settled, first concrete case of the ledger resolving a runtime-log ambiguity

Direct scanlog query (full 90-day window, 141 records scanned) found
**both** reported occurrences:

| Timestamp (UTC) | Deploy (`promptVersion`) | `terminalReason` | `issueAuthority` | identityRoute |
|---|---|---|---|---|
| 2026-08-09 05:08:10 | `4716cef...` (pre-Dispatch-36) | `null` | `null` | `title-family-weighted-consensus` |
| 2026-08-09 18:05:31 | `6f17f63...` (post-Dispatch-37) | `null` | `null` | `title-family-weighted-consensus` |

Both records show a normal, healthy identity resolution (`familyWeight`
decision `weighted-consensus`, pool sizes 20/20/16, no error/terminal
flag). Per Dispatch 22's own write-site placement ("right after
`out.decision` is computed"), **a record's existence is proof the
handler reached that point** — both scans terminated normally. **This
is the first concrete case where the durable scanlog ledger resolved an
ambiguity the Vercel runtime logs could not**: the "257 log lines, no
`[decision]` line" symptom is settled as the runtime-log tool failing to
surface one console line (the exact class of limitation
`src/lib/scanLog.js`'s own header names as the reason this ledger
exists), not the backend failing to reach a decision. Second occurrence
lands on a deploy after the whole cache-fingerprint series shipped —
confirmed unrelated to that work.

**Limitation recorded alongside the settlement, itself a concrete
instance of Dispatch 39's pricing auditability gap:** the ledger proves
decision *computation* happened; its current schema has no
`decision.action`, price, or pricing-branch field, so it cannot say
*what* either scan decided — only that it decided something.

### Sold-pool durability — second concrete instance of the pricing auditability gap

Investigated directly via code before any Bone recollection scanning
started, per explicit instruction not to find this out at replay time.
**The sold pool is not independently cached in KV under any key, at any
TTL — verified or raw.** `fetchPricechartingSales`
(`api/pricecharting-pop.js:560-612`) re-parses `soldComps`/
`salesByGrade`/`priceLadder` fresh from the shared raw-HTML cache
(`ph:<productId>`, `KV_TTL.PC_HTML` = 7 days) on **every call** — the
7-day TTL only protects the raw PriceCharting HTML page, not the parsed
sales rows. Worse: the actual PRICING-CONSUMED sold data
(`out.soldComps`, `out.soldCompsRaw`, `out.soldCompDiagnostics` —
`api/enrich.js:9343-9351`) is the output of `verifySoldComps` running
fresh on every request against that HTML; this verified/filtered set is
**never persisted anywhere**, cached nowhere, and exists only in that
one request's response object.

**Consequence for the fixture contract:** the `ac:v10` KV object (the
active pool) is the ONLY piece of the fixture contract retrievable from
KV after the fact, and only within its 1-hour TTL. Everything else the
contract specifies — sold evidence, request context, output baseline
(tier/branch, floors fired, decision, warnings) — exists nowhere durable
at all; it is only ever present in the live `/api/enrich` JSON response
body for that exact scan. There is no TTL to race for that half of the
fixture, because there is no cache to race — it must be captured from
the response itself, not reconstructed afterward from any KV read, no
matter how quickly that read happens. `scripts/capture-active-cache-entry.mjs`
(below) is scoped honestly to what KV can actually provide and stubs the
rest for manual merge from the real response, rather than silently
omitting or fabricating it.

### Bone recollection tooling — ready, tested against live data

Two throwaway-precedent scripts (same convention as
`scripts/query-scanlog.mjs`), both tested end-to-end against the live
Batman #213 entries before any Bone scanning starts:

- **`scripts/watch-active-cache-ttl.mjs`** — single-shot snapshot of every
  live `ac:v10:*` key with remaining TTL, soonest-expiring first, flags
  anything under 5 minutes. Verified: correctly listed both live Batman
  #213 keys with real remaining TTLs.
- **`scripts/capture-active-cache-entry.mjs "<title>" "<issue>" [label]`**
  — pulls the matching `ac:v10` object + fingerprint + TTL remaining,
  infers rough write-age from TTL-remaining-vs-3600s (a proxy for
  HIT-vs-MISS, since KV alone can't distinguish "just written" from
  "written earlier, now being read" — only the server's own
  `[active-cache] HIT/MISS` log line can say that directly), and writes a
  fixture stub to `dispatch39-fixtures/` (new, gitignored — see
  `.gitignore`) with the `manualCapture` section explicitly stubbed for
  the request-context/sold-evidence/output-baseline fields that must come
  from the real response. Verified: captured both live entries correctly
  (`activePoolRaw.count` 17 and 9, matching Dispatch 40's certified
  numbers exactly); test fixtures deleted after verification, directory
  clean for the real batch.

### Batch composition, confirmed

- 11-15 heterogeneous ordinary books, Bone included in the same batch
  (not captured separately).
- **New requirement, recorded:** capture at least one other book that
  naturally exercises mega-key-floor, if one appears in the batch
  selection — not manufactured. Bone is currently the only observed
  instance of floor resurrection; one book cannot distinguish "the floor
  is wrong for Bone" from "the floor is wrong generally," and the
  acceptance criterion needs to know which. Recommend deliberately
  including one additional mega-key-table title (`api/mega-keys.js`, 43
  entries) in the ordinary-book selection so there's a real chance of
  observing this — not forcing the floor to fire, just giving it the
  opportunity a random ordinary sample might not.

### Status

Gate 1: **CLOSED.** Gate 2: **CLOSED** (Dispatch 40). Both certification
gates closed. Tooling ready and verified. Sold-pool/output-baseline
capture depends on the real `/api/enrich` response per scan, not KV, per
the durability finding above — flagged before scanning starts, not
discovered at replay time. Holding for the go-ahead to begin scanning.

## GrailKey Dispatch 42 (2026-08-09) — IndexedDB does not preserve `priceDerivationTrace`; preflight target corrected before scanning

Record only, no code changes. Direct consequence of checking, before the
Bone batch starts, whether the structured `/api/enrich` response carries
the pricing-branch field the fixture contract needs (`[price-bands]
source`) without a runtime-log dependency.

### `out.priceBands.source` is present but gets overwritten by the exact mechanism under test

`out.priceBands` (`api/enrich.js:6761-6769`) is trimmed to
`{quick, market, stretch, source, count, tier, variantAdjusted}` and IS
threaded through every App.jsx catalogue merge path — confirmed present
in the persisted IndexedDB record. But when mega-key-floor fires (Bone's
exact case), `out.priceBands` is **rebuilt** (`api/enrich.js:8891-8899`)
with `source` hardcoded to the literal string `'mega-key-floor'` — the
original tier-2 branch name (`tier2_active_dominant_thin_sold`) is gone
from that field the moment the floor engages. A coarser fallback exists
(`out.preFloorSource`, set from `out.pricingSource` just before the
rebuild, mapped through `TIER_SOURCE_MAP` to `'active_ask_derived'` —
shared with `tier3_active_discounted`, not unique on its own) and IS
threaded through every merge path, confirmed by direct grep (`preFloorPrice`/
`preFloorSource` present in all checked App.jsx call sites). Combined
with `out.priceBands.tier` (also preserved through the rebuild), the
pair `(tier=2, preFloorSource='active_ask_derived')` does uniquely
identify the branch — but only by cross-referencing `TIER_SOURCE_MAP`,
not from a single direct field.

### The actually-correct field exists, survives the floor untouched, and carries the raw per-comp arrays — but IndexedDB drops it

`out.priceDerivationTrace` (`api/enrich.js:6777`, sourced from
`priceBandsRaw.derivationTrace`, built by `buildDerivationTrace`/
`buildTraceStep` in `src/lib/priceBands.js:501-507,874-887`) is set
**before** the mega-key-floor block runs and is **never referenced
anywhere in that block** — confirmed by reading the full floor-override
branch (`api/enrich.js:8870-8908`), which touches `priceBands`, `price`,
`priceLow/High`, `megaKeyFloor*`, `preFloor*`, but not
`priceDerivationTrace`. For Bone's exact branch, its `operations` array
carries a step literally named `'active_dominant_thin_sold_discount'`
(`priceBands.js:880-881`) — the original branch identity, intact,
regardless of what `out.priceBands.source` gets rebuilt to afterward.
Its `sold_average`/`active_average` steps carry the **raw
`soldPrices`/`activePrices` arrays themselves** as `inputValue`
(`priceBands.js:878-879`) — individual per-comp prices, not aggregates,
for both pools, on both branches with and without floor override.

**This is the single richest field for the recovery-predicate fixture
— and it is not persisted to the client catalogue at all.** Grepped
`priceDerivationTrace` across `src/App.jsx`: zero matches, anywhere, in
any of the five documented client merge paths. It exists only in the
raw `/api/enrich` HTTP response body for that one request — computed,
sent, and then silently dropped by every client-side merge path before
anything reaches IndexedDB. This is a fourth concrete instance of the
Dispatch 39 pricing auditability gap, and the most surprising one so
far: even the one place client-side persistence exists at all (the
catalogue) doesn't preserve the server's own richest diagnostic output —
not a TTL problem this time, a merge-path omission.

### Preflight target corrected, before any scanning happened

Originally scoped as "verify the IndexedDB/catalogue object still
contains the structured response fields needed for replay." **Corrected
before running it**, per instruction not to proceed on a degraded
capture path: IndexedDB is confirmed, by direct code inspection (not
requiring a live scan to establish), to be missing `priceDerivationTrace`
— the field that both survives the floor override with the original
branch label intact AND carries the raw per-comp price arrays for both
pools. Recommended alternative, cheapest available: **capture the raw
`/api/enrich` HTTP response body directly** (browser DevTools Network
tab "Copy Response," or direct stdout if scanning via script/API call)
instead of an IndexedDB export. Strictly a superset of what IndexedDB
would have offered — everything IndexedDB persists is also in the raw
response, plus `priceDerivationTrace`. The one live control-book scan
still specified as a preflight step now validates this corrected target,
not the original IndexedDB-export plan.

### Status

Preflight target corrected before the first scan, per the explicit
instruction not to discover a degraded capture path mid-batch. One
live control-book scan (direct response capture, not IndexedDB export)
still outstanding before the 11-15-book batch begins. Holding.

## GrailKey Dispatch 43 (2026-08-09) — bulk request cardinality proven from source; deterministic fixture pipeline built, tested against live data

Record only for the source audit; three tooling scripts added (no
production code touched).

### Bulk request cardinality — source-proven, not inferred from console labels

Read `handleBulkImport` end to end (`src/App.jsx:11110-11290`), per
explicit instruction not to infer from `[bulk-parallel]`/`[persist-bulk]`
log labels. **One independent `/api/enrich` request per book, confirmed
at the call site.** `handleBulkImport` runs a `CONCURRENCY=3` worker
pool (`processFile(file, index)`, line 11135) — each worker grades one
file via `/api/grade`, saves it to the catalogue, then fires exactly one
`fetch("/api/enrich", {..., body: JSON.stringify({title: data.title,
issue: bulkIssue, grade: data.grade, ...})})` (line 11235) carrying that
single book's fields, not an array. No batched/multi-book enrich
endpoint exists anywhere in this call path. **Conclusion: Network-tab
"Copy Response" per book works unchanged for bulk scans — no adaptation
to the capture method needed.**

### Deterministic fixture pipeline — three scripts, tested against live data (success and failure paths)

`dispatch39-fixtures/<NN>-<title-slug>-<issue>__<trace8>/` layout, per
spec. `trace8` sourced from `out.pipelineAudit.traceId`
(`api/enrich.js:11106-11112`, `src/lib/pipelineAudit.js:77` —
`traceId: ctx.traceId`, confirmed present on every response, a
`randomUUID()`).

- **`scripts/ingest-fixture-response.mjs <response.json> [request.json]`**
  — auto-assigns the next `NN`, builds the directory, copies
  `response.json` (and `request.json` if given) verbatim, reports
  structural proof only (soldComps is-Array + length, decision.action,
  price, priceDerivationTrace present/absent, activeCached.count,
  megaKeyFloorApplied) — never comp contents.
- **`scripts/capture-active-cache-entry.mjs --dir "<dir>" "<title>" "<issue>"`**
  — rewritten from Dispatch 41's flat-file version. Writes
  `active-cache.json` into the given directory. When multiple live
  `ac:v10:*` keys match title/issue (same book scanned at different
  grades, exactly the Batman #213 A/B/C shape), disambiguates by
  matching `response.json`'s `activeCached.count` against each
  candidate's live `.count` — if that's still ambiguous, **refuses to
  guess** and exits non-zero, listing all candidates.
- **`scripts/merge-fixture.mjs "<dir>"`** — reads `response.json` +
  `active-cache.json` (+ `request.json` if present), never modifies
  either source artifact, produces `fixture.json` as the only output.
  **Custody check, required not optional:** `response.activeCached.count`
  (`api/enrich.js:9360`, the same object the `ac:v10` KV entry holds)
  must equal the captured KV value's own `.count` — a mismatch means
  the KV entry does not correspond to this response, and the script
  refuses to write `fixture.json` rather than silently merging two
  unrelated books' evidence. `fixture.json` surfaces
  `priceDerivationTrace` (Dispatch 42's finding — survives mega-key-floor
  intact, carries raw per-comp sold/active price arrays) alongside the
  raw post-rebuild `priceBands.source`, both labeled so a reader can't
  confuse "current field value" with "original branch identity."

**Tested end-to-end against real live KV data** (the live
`hero for hire luke cage|1` `ac:v10` entries, two fingerprints, real
counts 17/19) using a synthetic response.json: full success path
(ingest → disambiguated capture → custody-check-passed merge) verified
correct field mapping; failure path (deliberately mismatched count)
verified the custody check fails loudly and writes no `fixture.json`.
All test artifacts deleted before commit — `dispatch39-fixtures/` is
clean for the real batch.

### New gap found while building the merge script — `numericTarget`/`isGraded`/`signedConsensus` absent from the response entirely

`out` is initialized as `const out = {}` (`api/enrich.js:2429`, not
spread from `req.body`), and direct grep found no `out.isGraded =`,
`out.numericGrade =`, or `out.signedConsensus =` assignment anywhere in
the handler — these exist only as local variables during processing,
never surfaced back to the client. `fixture.json`'s `requestContext`
falls back to `request.json` (the original request payload, also
capturable from the Network tab via "Copy request payload," trivially
alongside "Copy Response") for these three fields, and is explicitly
`null` if `request.json` wasn't captured — not guessed.

### Status

Bulk cardinality proven. Fixture pipeline built and tested against live
data, both success and failure paths. Ready for the batch pending
confirmation on the live `hero for hire luke cage|1` entries currently
in KV (39min TTL remaining as of this dispatch) — flagged as a real
opportunity, not a blocker, in case that's the actual preflight scan
already run.

## GrailKey Dispatch 44 (2026-08-09) — mega-key floor gate root-caused; fifth standing invariant; Bone reframed as two distinct failure modes

Record only. Direct continuation of the Dispatch 43 mega-key-floor
source audit — root cause confirmed against the actual card, not left
at "two ranked candidates."

### Root cause confirmed: candidate 1, exactly as scoped

The scanned card shows `Bonnier Carlsen · 1991`. Bone's table entry
(`api/mega-keys.js:920-935`) requires `publisher: "image"`. `Bonnier
Carlsen` cannot normalize to `"image"` under any alias — `passesIdentityGates`
(`api/mega-keys.js:1081-1111`) hard-rejects on the publisher mismatch,
`getMegaKeyEntry` returns `null`, and the entire mega-key floor block
(`api/enrich.js:8689-8908`) is skipped **silently, with no log line at
any stage** — matching the observed symptom exactly (no `[mega-key-floor]`
line of any kind, not just no "enforced" line). The active-pool-composition
hypothesis from the prior turn is withdrawn — confirmed, not just
suspected, to play no role: none of the gates in this block read active-pool
data at all; active composition only feeds the pre-floor price, which
was identical ($19.33) in both the scan under audit and the one that
skipped the floor.

### Fifth standing invariant — AUTHORITY MUST BE USE-CONSISTENT

> **A source rejected as incompatible on an identity axis cannot
> simultaneously establish that same axis for downstream economic
> decisions.**

Joining Monotonic Evidence Extension, No Self-Corroboration (Dispatch
33), Rejection Must Not Create Authority (Dispatch 34, three axes:
ComicVine fail-open, variant fallback, mega-key floor — Dispatch 38),
and Cache Correctness Is Authority Correctness (Dispatch 37). **Distinct
from Rejection Must Not Create Authority** — that invariant is about a
mechanism restoring REJECTED evidence after rejection empties a
candidate population; this one is about the SAME value being treated as
disqualifying by one consumer (ComicVine's own volume-matching, which
judged `Bonnier Carlsen` publisher-incompatible against the expected
volume) and simultaneously authoritative by another (the value survives
as `confirmedPublisher`, which then gates mega-key eligibility). The
shape is general, not Bone-specific: any pipeline stage that both scores
a candidate DOWN on an axis and later reads that same axis's SURVIVING
value as ground truth for an unrelated downstream decision is exposed to
this class, wherever it recurs.

This is the same underlying mechanism the Pattern Library already named
once, earlier and narrower: "Mega-key protection defeated by a publisher
mismatch" (Bone #1, `confirmedPublisher` set to "Bonnier Carlsen" via a
ComicVine volume-match issue — recorded mid-way through this file's
history, prior to the GrailKey dispatch numbering). This dispatch
generalizes that specific observation into the standing invariant above.

### Bone reframed — two distinct, independently real failure modes, not one

```
HISTORICAL BONE (18:05 scan)
  thin/suspect market evidence
    -> $19.33
    -> mega-key floor RESTORES/AMPLIFIES authority
    -> $800
    -> LIST

CURRENT BONE (this dispatch's scan)
  ComicVine publisher authority leak (rejected on identity axis,
  adopted as confirmedPublisher anyway)
    -> mega-key eligibility gate reads confirmedPublisher
    -> "Bonnier Carlsen" != "image" -> floor silently SKIPPED
  PLUS, independently:
  thin/suspect market evidence (soldPool=1, activePool=2)
    -> price still authorized
    -> $19.33
    -> LIST_LOW
```

Both are real, both are documented, neither supersedes the other. The
historical $800 path's own precise trigger (which of the two candidates
from the prior turn — `soldMatchedFloorGuard` vs `isSuspectContaminated`
— actually fired at 18:05) remains unconfirmed; that scan's data no
longer exists (`ac:v10` TTL long expired, response body never captured).
Not re-investigated this dispatch — the current scan's defect is
sufficient on its own.

### Batch no longer blocked on reproducing $800

**Bone still demonstrates the trust violation this whole exercise exists
to catch, without the floor firing at all**: thin/suspect market
evidence (`soldPool=1`, `activePool=2`) ships as an authoritative
`$19.33`, `LIST_LOW` — the recovery predicate this dispatch chain is
building has a real defect to test against regardless of which mega-key
branch fires on any given scan. The $800 reproduction was a "nice to
have," never a hard requirement — this dispatch retires it as a
blocker. This scan is being captured through the fixture pipeline as its
own artifact (a second, distinct Bone failure mode, not a replacement
for the first).

### Status

Root cause confirmed. New invariant recorded. Bone reframed as two
independent failure modes, both documented, neither reproduced from
scratch. Batch unblocked — proceeding without the $800 reproduction
requirement. Capture of this specific scan (response.json/request.json)
still pending — files not yet received from the operator side.

## Dispatch 42-I (2026-08-10) — SAFE-KILL certified, Task 6 Identity closed; GK-50–GK-57 logged, NO WORK

Capture 2 (Batman #213, `cv_1786144793823_j1lx5j`, build `1d4c125`,
`compFilterVersion` 9, `comicVine` 19 keys, `id` 10331, `volumeId` 796)
executed by hand against a real production record — 7/7 checks PASS
(1c flag absent, 2c timestamp index present, 2e comicVine present (19),
2f flag removed, 3g flag present, 3h key exists:false, 3i key
exists:false). Task 6 Identity closed; ComicVine safe-kill (Dispatch 42
Tasks 1-5 + 42-A item 2) certified. `9ca0b9a`/`544fb7d`/`cf96d1b` pushed
to `origin/main` (`b79e4d1..cf96d1b`); Vercel deploy `dpl_97m8pmcLzuC6M3Zx1ySDW96rKvm4`
confirmed READY/production, `githubCommitSha cf96d1b6f4c397bb9aca38fcecb7b2873f709dc8`,
aliased live to `comic-vault-rouge.vercel.app`.

**GK-50 through GK-57 — logged verbatim as reported by the operator this
dispatch. NOT independently investigated, NOT reproduced, NOT fixed —
explicit instruction was log only.** Each needs its own scoping pass
before any code is touched.

- **GK-50** — volume-label rescue unobservable in the sold lane.
- **GK-51** — era filter returns `bypassed:false` while actually bypassing.
- **GK-52** — `yearCorrected` true when the raw year was empty.
- **GK-53** — `noImage:true` on scans that had images.
- **GK-54** — `comicVine:{}` stored on no-match; 3 of 5 production records
  carry an empty-but-truthy shell (falsy-check consumers would misread
  this as "present").
- **GK-56** — the same eBay listing ID present in both the active and
  sold pools — double-counted as two independent observations.
- **GK-57** — `[bulk]` "year healed" and `[persist-bulk]` both logged
  twice for one `savedId`.

(GK-55 already shipped this dispatch — see the `cf96d1b` commit message
above — and is not re-logged here as open.)

### Status

SAFE-KILL certified, pushed, deployed, verified READY at the exact
pushed SHA. Eight defects logged at the operator's explicit instruction
not to work them. Standing by. GK-39 to be issued separately.

## Dispatch 45 (2026-08-10) — GK-39 confidence-provenance trace, four defects split out

Trace-only, no code (per dispatch instruction). Investigated why the
`identityAlignment` panel showed identical `90/90/85/100 · VERIFIED`
across two unrelated books on two different identity sources, and why
`breakdown.year: 85` rendered next to `confirmedYear: null`.

**Root cause, `authenticationScore`/`breakdown`: hardcoded constants,
not a computation.** `api/enrich.js:4319-4338` builds the `alignment`
object as a two-branch literal keyed on a single boolean
(`identitySource === 'ebay_visual_override'`) — every OTHER
`identitySource` value (manual, title-family-top-rank-protection,
barcode, cgc_cert, ...) collapses to the identical
`90/90/85/100/VERIFIED/needsReview:false` tuple, unconditionally.
`breakdown.year: 85` is written regardless of what `confirmedYear`
holds — there is no check being skipped, there is no check.

**The real scorer exists and is dead.** `src/lib/identityAlignment.js`'s
`alignIdentity()` is a genuine weighted cross-source scorer (title 50% /
issue 25% / year 15% / publisher 10%, real per-field token-overlap and
year-match comparisons). `git grep "alignIdentity("` outside test files
returns exactly one hit — its own definition. It ran in production for
one day (`44cf43b` 2026-04-30 → `0234ea2` 2026-05-01), then an
architecture refactor moved identity resolution earlier in the pipeline
(before eBay/PC/CV data was in scope) and replaced the real call with
the hardcoded placeholder at the identical call site, under the
identical `"Ship #24"` comment — confirmed via `git show 0234ea2`. Never
restored since.

**Persistence gap, found independently:** `identityAlignment` is never
written to IndexedDB — `git grep identityAlignment src/db.js` = 0 hits,
and `addToCatalogue`'s `entry` object (`App.jsx:10539-10575`) is an
explicit ~25-field whitelist that omits it. The one real decision
consumer — `App.jsx:7506-7510`'s listing-button gate,
`needsAuthAck = authenticationScore < 80` — reads `item.identityAlignment`
off `selectedItem`, which for the ordinary "open a saved book" flow is
catalogue-sourced (`App.jsx:13009/13025`, `catalogue[idx±1]`) and
therefore undefined. The gate is real code, but only reachable in the
narrow window right after a fresh scan, before the book is saved.

**Real, live defect found while tracing the "laundering" question:**
`convergenceSources` (`api/enrich.js`, then lines 4141-4185) sourced
its `vision` slot from `effectiveTitle`/`effectiveIssue`/`effectiveYear`/
`effectivePublisher` — which, under `manualIdentity` or a valid
`manualCorrectionRequest`, carry the operator's typed/corrected value
(Vision explicitly skipped, `api/enrich.js:2284` comment). That value is
also `confirmedX`, so in the REAL, unmodified `computeAxisScore`
(`src/lib/convergenceScore.js` — a legitimate weighted voter, unrelated
to the fake `identityAlignment` constants), the manual value voted for
itself under a false `'vision'` label and gained full axis weight
(85/100 for issue/title/publisher). This is `convergence`, the *other*
score on the same card — the one that computes honestly everywhere
except this one caller-side mislabeling.

**Four defects split apart, deliberately not merged (they don't share a
fix and don't share urgency):**
- **GK-39** — fabricated `authenticationScore`/`breakdown` constants.
- **GK-62** — manual value in `convergenceSources`' vision slot,
  self-corroborates, inflates the real `convergenceScore`.
- **GK-65** (renumbered from GK-63, Dispatch 46B correction — GK-62 stays
  with the vision-provenance fix, exactly one defect per number) —
  `identityAlignment` never persisted; the listing gate at `App.jsx:7506`
  is unreachable post-save.
- **GK-64** — `identityAlignment` is a Phase-2 snapshot
  (`api/enrich.js:4319-4322`, captured before 8 later `writeConfirmed`
  passes on `confirmedYear` alone, `:4732` through `:7582`), stale
  relative to the terminal `out.confirmedYear` (`:9558`), unmarked as
  stale.

### Status

Trace complete, no code this dispatch. GK-62 ordered first the
following dispatch (below) — fires today on every manual scan and
corrupts a real scorer; GK-39's constants (65 or 90 against an <80
gate) have never changed an outcome. GK-39 itself decided
(next-dispatch note below) but not yet scoped.

## Dispatch 46 (2026-08-10) — GK-62 IMPLEMENTED (working tree, uncommitted): convergence vision-slot no longer accepts manual values

`api/enrich.js` and `tests/grailkey-dispatch-46-gk62-vision-provenance.test.js` — **implemented, sitting in the working tree, no commit, no SHA** as of this dispatch. `src/lib/convergenceScore.js` untouched (re-verified: `SOURCE_WEIGHTS` and `applyIdentityConflictDemotion` byte-identical, checked by the new test itself, Part 0). See Dispatch 46B immediately below for the field-level-exclusion trace, the decision to keep all-or-nothing, and the eventual commit/push record.

### Fix

Four new consts inserted immediately before `convergenceSources`
(`api/enrich.js:4159-4163`):
```js
const visionWasSkipped = manualIdentity === true || manualCorrectionRequest?.valid === true;
const rawVisionTitle = visionWasSkipped ? null : (title ?? null);
const rawVisionIssue = visionWasSkipped ? null : (issue ?? null);
const rawVisionYear = visionWasSkipped ? null : (year ?? null);
const rawVisionPublisher = visionWasSkipped ? null : (rawPublisher ?? null);
```
All four `convergenceSources` axes (title/issue/era/publisher) now read
`rawVisionX` instead of `effectiveX`. `effectiveX` itself is untouched
and still drives identity resolution, pricing, cache keys, and
everything else it always has — this fix touches only the caller-side
input to `computeAxisScore`'s vision slot. `barcodeIdentity` is
deliberately never consulted when building `rawVisionX` (its resolved
fields come from a ComicVine UPC lookup, not Vision — "same treatment"
per the dispatch instruction), so a barcode scan's genuine Vision
extraction (if Vision also ran on the same image) still counts, while
barcode's own resolved values never did and still don't leak in.

### Manual source-class decision: EXCLUDE, not relabel

The dispatch offered two shapes — a peer `'manual'`/`'operator authority'`
label inside automated convergence, or exclusion from it entirely.
**Exclusion chosen**, for two reasons: (1) it's the only shape available
under the dispatch's own constraint not to touch
`src/lib/convergenceScore.js` — `computeAxisScore` only iterates
`Object.entries(SOURCE_WEIGHTS[axis])`, so a `'manual'` key in `sources`
would need a matching weight entry in that file to be counted at all;
adding one is out of scope this dispatch. (2) it's what the dispatch
text asked for literally — "must never enter the automated
denominator," and even an honestly-labeled manual vote would still
enter `totalWeight`. Operator authority is not un-recorded by this
choice: `identitySource`/`confirmedSource` (already shipped, already
surfaced on `out.identityAlignment.confirmedSource` and elsewhere)
already carries `'manual'` honestly as its own field — this fix doesn't
duplicate that, it just stops smuggling the same value into a second,
differently-labeled field.

### `workingIdentity` consumer trace (required before implementing)

`git grep -n "manualCorrectionRequest\|workingIdentity" api/enrich.js`
— exactly one consumer of `.workingIdentity.*`:
`effectiveTitle`/`Issue`/`Year`/`Publisher` at `api/enrich.js:2390-2393`.
The only other `manualCorrectionRequest` reads are `.valid` (control
flow) and `.validation` (fed to `buildManualCorrectionProvenance` at
`:10747-10748`, which already tags its output
`provenanceTrust: 'client-reported'` — honest, not a laundering site).
No second consumer of `effectiveX` mislabels it as Vision — `git grep`
for `vision:\s*effective` across the repo returns exactly the four
lines this fix changed, plus one unrelated hit at `api/enrich.js:4332`
(`vision: title` inside `alignment.conflicts`, GK-39's dead-constant
object — explicitly out of scope, untouched).

### Frozen-corpus convergence deltas (real, unmodified `computeConvergenceScore`)

| Scan | OLD | NEW | delta |
|---|---|---|---|
| Witching Hour #66 class — manual entry, zero corroboration | 100 | 0 | −100 |
| Manual correction, issue-only, zero corroboration | 67 | 0 | −67 |
| Ordinary camera scan, Vision genuinely agrees with eBay | 100 | 100 | +0 |
| Manual entry WITH real eBay corroboration (manual value happens to be right) | 100 | 75 | −25 |

Every manual-path score drops or holds; camera-scan path is
byte-identical. No case increases — matches the dispatch's explicit
"convergence DROPS on manual scans, do not tune it back up." 28/28
new assertions pass (`tests/grailkey-dispatch-46-gk62-vision-provenance.test.js`),
including an extract-and-eval of the real shipped
`visionWasSkipped`/`rawVisionX` source (not a retyped copy, per the
repo's standing test-design rule) exercised against the frozen corpus.

### Four-category baseline, post-fix

153 PASS → **154** (+1, the new test file itself). 16 PRE-EXISTING FAIL
→ 16 (unchanged — `git grep` confirmed no existing test asserts the old
vision-slot behavior; the two candidate files a broad grep flagged,
`q-trackB-commit4.3.1-retention-decline-fail-closed.test.js` and
`q117-cv-title-axis-field.test.js`, contain zero references to manual
identity on inspection — false positives from the OR pattern). 3 GATED
SKIP → 3 (unchanged, unrelated to this fix — the rate-limit.js interval
leak and the API-key-gated integration test from GrailKey Dispatch 22-J
carry over unchanged). 0 NEW FAIL → 0. Total 173, not 172 (+1 new file).

### Status

GK-62 implemented, uncommitted, tests passing, `convergenceScore.js`
untouched, baseline delta fully explained. **Held for the field-level-
exclusion question — see Dispatch 46B immediately below before treating
this as final.** GK-39 stays contained by presentation rule (no code —
Auth %/breakdown/VERIFIED/needsReview simply don't belong in any
customer-facing surface going forward), scoping deferred per the
operator's explicit "not yet scoped" note. GK-65/GK-64 logged, not
worked, per the same dispatch.

## Dispatch 46B (2026-08-10) — GK-62 correction round: terminology, renumbering, field-level-exclusion trace

**Corrections to Dispatch 46's own record, per direct operator
correction:** GK-62 was IMPLEMENTED (working tree, uncommitted, no SHA),
not "shipped" — that word is wrong until a commit exists and was struck
above. The persistence/listing-gate defect renumbers **GK-63 → GK-65**
throughout this file and CLAUDE.md, so there is exactly one GK-62 (the
vision-provenance fix) and no collision.

### Trace — is field-level exclusion possible instead of all-or-nothing?

**a. Does `manualCorrectionRequest` carry field-level information about
which fields were actually corrected? YES.**
`validateManualAuthority` (`src/lib/manualCorrection.js:146-178`)
returns `acceptedFields` (`:171`) — allow-listed fields the client
claimed AND actually supplied a valid, non-empty value for, this
request. Threaded through `prepareManualCorrectionRequest`'s return
(`:268`, the `validation` object) — reachable in `api/enrich.js` as
`manualCorrectionRequest.validation.acceptedFields`.

**b. For fields NOT corrected, where does `workingIdentity`'s value
come from? Traced per field — same answer for all four.**
`buildField` (`manualCorrection.js:255-259`): for a field not in
`acceptedFields`, `workingIdentity.X = normalizeFieldValue(field,
body[field]) ?? body[field]` — i.e. whatever the CLIENT sent as
`body.title`/`issue`/`year`/`publisher` on THIS request. The real,
production-used request builder — `buildManualCorrectionPayload`
(`manualCorrection.js:626-639`) — sets an uncorrected field to
`item.title`/`item.year`/`item.publisher`: **the catalogue item's
current confirmed value**, not a freshly re-read Vision extraction.
That value could have originated from Vision, eBay, PriceCharting,
ComicVine, or an earlier manual correction — nothing tags which. **"Not
corrected this request" is not the same fact as "genuinely this-request
Vision observation," and the codebase does not equate them anywhere.**

**c. Does the correction request retain the original raw Vision
observations anywhere (request, session, cache)? NO, confirmed absent
for title/year/publisher; partial and still not "vision" for issue.**
`buildManualCorrectionProvenance`'s own comment
(`manualCorrectionRequest.js:572-576`, sic — `src/lib/
manualCorrection.js`): *"Only the 'issue' field currently carries a
structured prior-source signal (issueAuthority) ... title/year/
publisher have no equivalent authority object yet in this codebase, so
their priorSource is honestly null, not guessed."* Even where a source
tag exists (`priorIdentity.issueAuthority?.source`, issue only), its
possible values include `'ebay_visual_override'`,
`'title-family-top-rank-protection'`, etc. — genuinely non-Vision
sources — so even that one tag would frequently say "not vision" if
consulted, not confirm safety. `src/lib/scanLog.js:99` records only the
final `book.title`/`issue`/`year`, no separate raw-Vision snapshot.
Nowhere in the request, a session object, or the KV cache is a raw,
this-scan Vision observation retrievable at correction time.

**d. One fixture, real `computeConvergenceScore`, camera identity on
all four axes → operator corrects issue only (300→301), publisher
modeled as genuinely Vision-only (no eBay/PC/CV publisher data — the
exact shape the risk item named):**

| axis | OLD score | CURRENT (all-or-nothing) score | note |
|---|---|---|---|
| title | 100 | 100 | unaffected — eBay alone already saturates it |
| issue | 49 | 0 | the corrected axis — expected to drop |
| era | 100 | 100 | unaffected — histogram alone saturates it |
| publisher | 100 | **0, zero votes** | **genuinely lost** — the one axis with no non-Vision corroboration at all |
| **TOTAL** | **87 (MEDIUM)** | **50 (LOW)** | tier changes, driven entirely by publisher |

Confirms the risk item concretely: an untouched, never-questioned axis
with only Vision behind it drops from full agreement to zero evidence,
purely as a side effect of an unrelated field's correction, moving the
card's tier from MEDIUM to LOW.

### Decision: all-or-nothing exclusion is CORRECT. Not implementing field-level exclusion.

The mechanical rule turns on whether field-level provenance is both
available AND trustworthy. (a) is available. But the actual question
the fix needs answered isn't "was this field corrected this request" —
it's "is this field's CURRENT value genuinely this-request Vision
output," and (b)+(c) prove that second question has no reliable answer
anywhere in the system for title/year/publisher, and an unreliable one
(frequently non-Vision) for issue. Building field-level exclusion on
top of "acceptedFields says this wasn't touched" would silently
re-introduce GK-62's exact defect on a narrower set of fields — labeling
a value 'vision' that has no verified Vision provenance, just because
nothing this request happened to change it. Per the operator's own
framing: the information isn't there, so the conservative
(all-or-nothing) behavior stands. The reduced-evidence cost is real
(the fixture above) and logged here as a known, accepted tradeoff, not
silently absorbed — a future fix would need a genuine per-field
provenance tag (e.g. extending `issueAuthority`-style tracking to
title/year/publisher, and populating it from actual Vision output, not
"whichever value happens to be on the card") before field-level
exclusion could be done safely. Not scoped, not built.

### Status

Terminology and numbering corrected (GK-62 implemented not shipped;
GK-63→GK-65). Field-level exclusion traced and explicitly rejected —
all-or-nothing commits as-is. Two commits made:
`api/enrich.js` + the GK-62 test, then docs. Pushed. See commit/deploy
record appended at the end of this entry once available.

## Standing invariants (Dispatch 46) — added to the running list started at Dispatch 33

**A safety gate must not disappear because an asset crossed a
persistence boundary.** (GK-65 — the Ship #24 auth gate is real code
that can only ever fire in the pre-save window, because the field it
reads is dropped by every catalogue merge path.) Joins the Dispatch 33
invariants (Monotonic Evidence Extension, No Self-Corroboration),
Dispatch 34 (Rejection Must Not Create Authority), Dispatch 37 (Cache
Correctness Is Authority Correctness), Dispatch 44 (Authority Must Be
Use-Consistent).

**A value must not vote for itself.** (GK-62 — the mechanism this
dispatch fixed: a manual value placed in a source-labeled voting slot,
then compared for agreement against itself.) Distinct from the other
five: those are about a rejected/stale/incompatible value being read as
authoritative by a later consumer; this one is about a single value
appearing on both sides of an agreement check under two different
identities (the confirmed value, and a "second source" that is secretly
the same value).

## Dispatch 47 (2026-08-10) — GK-39A SHIPPED: fabricated confidence removed, no replacement

`api/enrich.js`, `src/App.jsx`,
`tests/grailkey-dispatch-47-gk39a-remove-fabricated-confidence.test.js`.
`src/lib/convergenceScore.js`, `src/lib/identityAlignment.js`
(`alignIdentity()`), `src/lib/decisionEngine.js` all untouched — re-
verified by the new test, not just asserted.

### What was removed

`authenticationScore`, `breakdown`, `confidence`, `needsReview` deleted
from both `identityAlignment` construction sites in `api/enrich.js` (the
`alignment` object and the `out.identityAlignment` copy) — GK-39's own
finding: these were a hardcoded two-branch literal (65/90,
UNCERTAIN/VERIFIED), never a computation. `confirmedTitle`,
`confirmedIssue`, `confirmedYear`, `confirmedSource`, `overrodeVision`,
`conflicts` are untouched — real, evidence-grounded fields, explicitly
kept per the dispatch (GK-64's staleness on `confirmedYear` is a
separate, not-yet-worked defect). No replacement number introduced —
per the dispatch's explicit instruction and per GK-39's own recorded
"next dispatch" note (Dispatch 45): the eventual replacement is an
evidence list, not a percentage, and that's still not this dispatch.

Both render surfaces removed: `App.jsx`'s ResultCard "Auth: X%" badge,
and CollectionDetail's colored dot + tier word + per-field breakdown
row. CollectionDetail's `conflicts` rendering — real data, explicitly
kept — was previously nested INSIDE the now-removed badge's wrapper
conditional (`authenticationScore != null`); re-gated on its own
presence (`identityAlignment?.conflicts?.length > 0`) so it isn't
silently orphaned by the removal of the field it used to piggyback on.

### The listing gate — decided before implementing, per the dispatch's explicit requirement

**Removed outright, not fail-safed.** Reasoning recorded both here and
at the deletion site in `App.jsx` itself: the moment
`authenticationScore` no longer exists, `needsAuthAck`'s condition
becomes permanently `false` regardless of what code surrounds it — the
only real choice was whether to leave that dead condition in place
(reading as a live safety gate to a future maintainer, per its own
comment: "block listing when score < 80") or delete it. Leaving inert
code that LOOKS like a real gate is the same category of falsehood
GK-39A exists to remove, just relocated from a displayed number to a
phantom protection. Deleted the `needsAuthAck` const and its `if` block
entirely; both the read site and the only write site
(`onUpdateField(item, 'authenticationConfirmed', true)`) are gone — a
full removal, not a one-sided orphan. Verified: this gate's own
constants (65 in the one branch that could ever apply, 90 everywhere
else, against a `<80` threshold) mean it never fired in production
regardless — deleting it costs nothing.

### Tests — 46/46 passing

Five parts: (1) source-extraction proof the two `identityAlignment`
construction sites in `api/enrich.js` carry the real fields and not the
removed ones; (2) same for `App.jsx`'s render surfaces, plus proof the
gate's variable/field names are fully gone and the removal-reasoning
comment survives at the deletion site; (3) `alignIdentity()` still has
zero call sites, `convergenceScore.js` byte-identical
(`SOURCE_WEIGHTS`/`applyIdentityConflictDemotion` checked directly); (4)
`decisionEngine.js` has zero references to either field (true before
and after this dispatch) plus a direct behavioral proof —
`computeDecision()` run on the identical fixture with and without the
fabricated fields produces byte-identical `action`/`blockers`/
`warnings`; (5) `priceBands.js`/`pricingEngine.js` confirmed to have
zero references to `identityAlignment` at all, and a `convergenceScore`
fixture proven deterministic and unaffected.

### Four-category baseline

154 PASS (expected) → **155** (+1, the new test file). 16 PRE-EXISTING
FAIL → 16, byte-identical file list to the prior sweep. 3 GATED SKIP →
3, byte-identical. 0 NEW FAIL → 0. `npm run build` clean both after the
`api/enrich.js` edit and again after the `App.jsx` edits.

### Status

GK-39A shipped. GK-39 itself (the presentation-rule containment from
Dispatch 45) is now the actual, enforced state, not just a stated
policy — there is no code left anywhere that can emit or render the
constants. `convergence` (GK-62's real scorer, honestly fed as of
`33079e4`) is the only identity-confidence signal left on the card.
Next queued: PriceCharting-ladder-as-passthrough labeling defect (same
disease — the UI claiming to know something it doesn't) — renumbered
in Dispatch 50 (below) from the collision-prone GK-38/GK-42 draft
labels used in Dispatch 48 to GK-66/GK-67, since GK-38 and GK-42
already exist for unrelated Dispatch 26 identity findings.

## Dispatch 48 (2026-08-10) — pricing-truth trace, no code (renumbered in Dispatch 50, below)

Full trace of the executed-vs-displayed pricing path for a tier-2
(`sold_active_blend_30`) scan. Findings drafted under collision-prone
placeholder labels (GK-38/GK-41/GK-42, matching draft numbers the
operator also flagged as guessed) — renumbered to GK-66/67/68/69 in
Dispatch 50 immediately below; this entry exists only to record what
Dispatch 48 actually traced, not to re-litigate the numbers.

- **Executed path (tier 2):** `api/enrich.js:6726` →
  `computePriceBandsFromSold` → `src/lib/priceBands.js:783` — real
  formula `market = (soldAvg × 0.7) + (activeAvg × 0.3)` (`:841`),
  `out.price = fmtUsd(priceBandsRaw.market)` (`enrich.js:7982`),
  `out.pricingSource = 'sold_active_blend_30'` (via `TIER_SOURCE_MAP`,
  `priceBands.js:79`). `gradeMultiplier` confirmed inert for this tier
  (reference-only, never multiplied in — `priceBands.js:764-767`'s own
  comment). `enforceFloorWithCap` confirmed structurally skipped for
  tier 1/2/2.5 (`enrich.js:8285-8295`) — it protects `market` only,
  tier 3/4 only, never `quick`, in any tier.
- **Displayed derivation vs. executed (GK-67, was draft GK-42):** the
  causal walkthrough panel (`App.jsx:6280-6362`) shows `→ Blend
  (60/40): $item.blendedAvg` as a step toward "Final." `blendedAvg`
  (`enrich.js:6636-6654`, `soldAvg×0.6 + activeAvg×0.4`) is a THIRD,
  independent computation — different formula, different inputs
  (recency-weighted `soldAvg`, `rawComps?.average` for `activeAvg`)
  than priceBands.js's own tier-2 `soldAvg`/`activeAvg` (plain means
  of `verifiedSolds`/`verifiedActive`). Set once, never cleared,
  regardless of which tier fires. `sold_active_blend_30`'s `_30`
  confirmed to encode the active-side blend weight (30%), not a
  recency window or sample threshold. The codebase's own history
  already fixed the identical bug class once (`enrich.js:6829-6835`'s
  comment: `priceDerivationTrace` replaced an earlier log line for
  exactly this "conflated an unrelated tier result with a product
  never actually computed" reason) — the `App.jsx:6339` line is a
  surviving, un-migrated instance.
- **Ladder (GK-66, was draft GK-38):** `extractPriceLadder`
  (`api/pricecharting-pop.js:384-404`) is a pure regex scrape of
  PriceCharting's own per-grade table, zero GrailKey math, explicitly
  documented as non-monotonic-tolerant. UI header bare ("PRICE LADDER
  (N grades)," `App.jsx:4637`), no source attribution, unlike sibling
  panels that say "Source: PriceCharting" (`:6449`). Client already
  flags individual inversions ("⚠ thin data," `:4684-4692`).
  Independent of GK-67/blendedAvg — disproven relationship, `priceLadder`
  has zero references anywhere in the pricing stack (`computePriceBands`,
  `blendedAvg`, floor guards). **New finding beyond the dispatch's own
  framing: GK-66 is decision-affecting, not display-only.**
  `decisionEngine.js:783-843` reads `item.priceLadder[nearestGrade]`
  directly as `cgcValue`, and on threshold can set
  `decision.action='HOLD_FOR_CGC'` with `decision.price=null` — a
  noisy/inverted ladder rung (proven present on 2 of 3 frozen
  specimens) can trigger a real grading recommendation and blank the
  price.
- **Quick-band floor (GK-68, was draft GK-41):** confirmed
  structurally on the current build — see executed-path bullet above.
- **Fold-in, confirmed still present, current lines:** GK-48
  (App.jsx, now `:7064-7065`, shifted ~70 lines from this session's own
  GK-39A/GK-62 edits — unrelated drift) and GK-49
  (`api/comps.js:442`, unchanged) both reconfirmed live. Related third
  instance found incidentally: `App.jsx:6448-6452`, a second ternary
  defaulting unmapped `pricingSource` values to `"Source: AI estimate"`.
- **Persistence:** `priceBands`/`pricingSource`/`priceNote`/
  `priceUpdatedAt` all persist (confirmed, 5+ merge sites).
  `priceDerivationTrace` — zero references anywhere in `App.jsx`, never
  persisted (same class as GK-65). `blendedAvg` also never persists
  (zero assignment sites in any merge path) — GK-67's exposure is
  pre-save-only. `priceLadder` DOES persist — GK-66's `HOLD_FOR_CGC`
  risk is NOT time-limited, fires on reopened books too.

### Status

Trace complete, no code. Renumbering + smallest-fix proposals recorded
in Dispatch 50 below.

## Dispatch 50 (2026-08-10) — GK-66/67/68/69 assigned; GK-66 decision authority removed; GK-67 display fixed

### Step 0 — renumbering, grep-verified

`grep -oE "GK-[0-9]+" CLAUDE.md docs/PATTERN-LIBRARY.md | sort -n -u`
showed the highest number anywhere in this repo's ledger is **GK-65**
(confirmed GK-63 has zero live references — only "renumbered from"
historical notes at three lines, per Dispatch 46B). Gaps exist at
47-49 (already externally assigned — Dispatch 48's own text referred
to `GK-48`/`GK-49` as pre-existing labels this repo had never logged)
and at 58-61 (unverifiable from this repo alone — could be externally
claimed too, no way to confirm). Per the operator's own instruction
not to guess, assigned sequentially immediately after the highest
**confirmed** number rather than reusing an ambiguous gap:

```
GK-66  ladder passthrough + HOLD_FOR_CGC authority       (was draft GK-38)
GK-67  blendedAvg 60/40 rendered as a step toward a 70/30 final  (was draft GK-42)
GK-68  Quick band below the floor that protects Market   (was draft GK-41)
GK-69  PRICING DERIVATION CUSTODY GAP — log only, not fixed
```

**GK-69, logged, not fixed:** `priceDerivationTrace` and `blendedAvg`
never persist to IndexedDB; `priceLadder` does. The one field that
explains the price honestly is dropped on save; the one field that can
override the price with zero GrailKey computation behind it survives.
Same class as GK-65 (a safety/explanatory signal disappearing across
the persistence boundary), but the asymmetry runs the wrong direction
here — the thing kept is the less-trustworthy one.

Caveat, stated plainly: GK-47/48/49 are referenced in this repo's own
Dispatch 48 entry above but were never formally logged here before
now — this dispatch does not backfill full writeups for them, only
notes their existence so a future renumbering pass doesn't collide
with them either.

### Commit 1 — GK-66: priceLadder authority removed from decisionEngine.js

`src/lib/decisionEngine.js`, `tests/grailkey-dispatch-50-gk66-ladder-authority-removed.test.js`.

Removed the entire CGC-grading-upside block (`hasAutoKey`/`autoDetectedKey`/
`keyCharacters` consts, `CGC_ALL_IN_COST`/`CGC_UPSIDE_THRESHOLD`, the whole
`if (!item.isGraded && item.priceLadder && ...)` branch, and the now-unused
`GRADE_TO_NUMERIC` import) — the only place `item.priceLadder` had authority
to set `decision.action`/`decision.price`. No server-side ladder-quality
heuristic and no mirror of the client-side inversion check were added
(forbidden this dispatch) — the ladder simply carries zero pricing/decision
authority now, full stop.

**Degradation, reported before implementing:** the ordinary path
(LIST_NOW/LIST_LOW/RESEARCH/etc., unchanged, below the removed block) now
determines the action for every book that would previously have hit
HOLD_FOR_CGC. **No non-authoritative "potential grading upside" signal
existed to preserve** — confirmed by grep, not assumed: `decision.evidence.
gradingUpside` was never read by any UI surface (zero references in
`App.jsx`), and `GRADE_CANDIDATE` (the action this block's own commentary
aimed at) is never assigned anywhere in the live codebase — only checked
(`decisionEngine.js:43`, `App.jsx:317/463`) and referenced in one
investigation doc. HOLD_FOR_CGC was the sole live implementation. Per the
dispatch's own instruction, nothing was invented to fill the gap — the
ordinary action stands.

**Tests: 20/20 passing.** Inverted rung (Witching-Hour/Batman-#213-shaped
fixture) → no HOLD_FOR_CGC, price not nulled. Clean monotonic ladder with a
genuine large upside → **still** no HOLD_FOR_CGC (demotion is unconditional,
not inversion-gated, exactly as specified). Missing/empty ladder →
unaffected (was already unreachable). Frozen corpus (the three real
Dispatch 48 specimens) → all three resolve to `LIST_NOW`, `decision.price`
unchanged at the fixture's base price; nearest rung per book logged
explicitly (Witching Hour: 8.0=$89.95; Batman #213: 7.0=$63.08; Harley
Quinn: 6.0=$12).

**Baseline after Commit 1: 156/16/3/0** (155 expected +1 new file).
`decision-engine.test.js` unchanged at 39 passed/7 failed, same 7 named
assertions (including the pre-existing, already-broken "High-value grading
candidate (SYNTHETIC)" test, which checked for `decision.action === 'HOLD'`
— a string that was never right even before this dispatch, since the old
code set `'HOLD_FOR_CGC'`, not `'HOLD'`; still fails, now for the additional
reason that HOLD_FOR_CGC is gone entirely — not a new failure, the same one).

### Commit 2 — GK-67 + fold-in: display truth, zero computation changes

`src/App.jsx`, `tests/grailkey-dispatch-50-gk67-display-truth.test.js`.

- **(a)** `App.jsx:6339-6341`'s `"→ Blend (60/40): $item.blendedAvg"` line
  deleted from the causal derivation panel. `blendedAvg`'s own computation
  (`enrich.js:6642`) untouched — still real, still used elsewhere
  (`keyMultBase`, `compsAvgForCap`). Only the false causal presentation is
  gone.
- **(b)** Two source-label ternaries replaced with explicit lookup tables.
  `App.jsx:6448-6452` (`item.pricingSource`, the `TIER_SOURCE_MAP` output
  vocabulary — 7 values) now labels every one truthfully
  (`sold_active_blend_30` → "sold + active blend (70/30)", etc.); unmapped
  falls to the literal `"Source unavailable"`, never a euphemism.
  `App.jsx:7064-7065` (`item.priceBands.source`) — **found to be a more
  severe instance than documented**: it compared against the literal
  strings `'verified_sold'`/`'verified_active'`, but `item.priceBands.source`
  is `priceBandsRaw.source`, the RAW internal tier name
  (`PRICE_BANDS_SOURCES` — e.g. `'tier2_blend_70_30'`), never those two
  TIER_SOURCE_MAP-output strings. Both real branches were dead code — every
  book, regardless of actual source, has always fallen to `'estimated'`
  here. Replaced with a 10-entry lookup covering every `PRICE_BANDS_SOURCES`
  value; unmapped falls to `'source-unavailable'`.
- **(c)** Both PRICE LADDER panels (ResultCard + CollectionDetail — same
  panel, two render sites) now carry `"Source: PriceCharting, unedited"`,
  matching the attribution sibling panels already carry.
  `api/pricecharting-pop.js:384-404` untouched.
- **(d)** `"~ Similar {score}"` (MEDIUM tier only, as named) →
  `"Match quality: {score}/100"`. `api/comps.js:442` (`computeMatchConfidence`)
  untouched — score itself unchanged. HIGH (`"✓ Verified {score}"`) and LOW
  (`"⚠ Estimate {score}"`) tiers share the same ambiguous shape but were
  left untouched — not named in the dispatch, flagged here as a possible
  follow-up rather than assumed in scope.

**Tests: 35/35 passing**, including extract-and-eval of both new label
lookups (verbatim from the shipped source, evaluated against every real
`TIER_SOURCE_MAP`/`PRICE_BANDS_SOURCES` value) and confirmation that
`blendedAvg`'s computation, `priceBands.js`'s 70/30 formula, `TIER_SOURCE_MAP`,
and `decisionEngine.js` are all byte-identical to Commit 1 — this commit
changed presentation only.

**Baseline after Commit 2: 157/16/3/0** (155 expected +2 new files),
byte-identical FAIL/TIMEOUT lists to the documented baseline both times.

### HELD, per the operator's explicit instruction — no code

Quick-band floor semantics (GK-68): the trace proves the floor
(`enforceFloorWithCap`) protects `market` only, tier 3/4 only, never `quick`
in any tier — structurally confirmed true on the current build. Whether
that's a defect or an intentional product choice ("price aggressively for
liquidity" vs. "never recommend below X") is the operator's call, not
inferred here. No code touched for GK-68 this dispatch.

### GK-68 — DECIDED (GrailKey — Operator Mode Hold, 2026-08-10)

**Decision: B — no displayed recommendation may contradict a displayed
floor.** Quick sitting below a floor that protects Market is a real defect
under this ruling, not an intentional liquidity-pricing choice — recorded
as decided, not merely traced.

**No code required to enact it right now**: the operator-mode transition to
real-inventory operation (SCAN → REVIEW → CUSTOMER OUTPUT →
CORRECTION/OUTCOME LOG) suppresses Quick/Market/Stretch bands entirely from
the customer deliverable (identity · condition · verified comp evidence ·
one manually reviewed estimate) — with bands not shown at all, the
contradiction Decision B forbids cannot currently reach a customer. The
underlying code defect (the floor guard's tier-1/2/2.5 skip,
`api/enrich.js:8285-8295`, and `quick` never being cross-checked against
`rawFloor` in any tier) is unchanged and would resurface the moment bands
are unsuppressed — tracked as a backlog item against that reopening, not
closed.

### Status

GK-66 and GK-67 (+ the GK-49 fold-in) shipped. **GK-68 decided (B), not
implemented — enacted by suppression, not by code; the underlying floor
gap remains, backlogged against band re-enablement.** GK-69 (pricing-
derivation custody gap) logged only, unfixed — `priceDerivationTrace`/
`blendedAvg` still don't persist; `priceLadder` still does (now
decision-inert per Commit 1, but still display-persisted).

## GrailKey — Operator Mode Hold (2026-08-10)

Engineering dispatches paused. **`1aa6eb0` is the operating baseline.** No
pricing/identity/convergence/routing/persistence/UI/provider work without
a new dispatch; no proactive work on a logged defect merely because it
looks imperfect.

**Workflow shift, recorded for context:** SCAN → REVIEW → CUSTOMER OUTPUT
→ CORRECTION/OUTCOME LOG. Customer deliverable narrowed to identity,
condition, verified comp evidence, and one manually reviewed estimate.
Price ladder, Quick/Market/Stretch bands, the derivation panel, exit
strategy, and authentication/per-field percentages are suppressed from
that deliverable under the new operational process (not via a code
change this session — no code was touched to enact this hold).

**Reopen triggers, recorded:**
- Immediate: wrong identity presented as safe; wrong-book comps entering
  pricing; a price that cannot be explained; any falsehood in the customer
  deliverable; data loss; a scan that cannot complete.
- Backlog: everything else, including test-harness friction and invisible
  persistence gaps (GK-69 and all remaining internal/test/provenance
  items stay logged and untouched under this rule).

## GrailKey Directive 2026-08-11-A (investigation only, no code)

Five-task investigation batch. Full document published as an artifact this
session (not reproduced verbatim here — this is the pointer entry per the
CLAUDE.md size-limit rule). Headline finding: "GK-38" and "GK-42" as named
in that directive were not new defects — they were the identical Dispatch
26/48 draft-labeled defects already shipped as GK-66/GK-67 (see Dispatch
48+50 above), independently re-verified against live HEAD code rather than
trusted from the docs (quoted the actual removed `HOLD_FOR_CGC` block from
`git show d07c236`, confirmed zero live references remain, confirmed test
coverage). Task 4 (source-rights facts) found the ComicVine "restore
rejected candidates on empty filter" shape at **three** gates (year, token,
publisher) — broader than the single instance the Pattern Library had
logged before this — and found `api/comps.js`'s `emptyComps().reason` field
is computed but never read downstream, meaning an eBay outage was
indistinguishable from "book has zero real listings" anywhere in the app.
Both became the two code tasks of Directive B, below. Task 3 (provenance
sizing) came back INVASIVE for an IndexedDB rights-envelope retrofit — 8
real merge sites found via direct App.jsx audit, not the 5 CLAUDE.md
documented; recommended a KV-only Phase 1 first, deferred. Task 5 (secret
audit): clean across all 1,039 commits of git history and the Vite client
bundle; found `EBAY_SANDBOX` is documented but dead — nothing in code reads
it, every environment hits eBay's live production API.

## GrailKey Directive 2026-08-11-B — state reconciliation + fail-open closure (explicit exception to the Operator Mode Hold)

Three tasks, Jimmy-authorized under the standing freeze exception (Tasks 2
and 3 are code changes; Task 1 is documentation/tooling). Preflight run
first per the directive's own section 0: HEAD `1aa6eb0`, working tree
carrying only pre-existing uncommitted docs/tooling changes (not touched
this session), GK-66/GK-67 confirmed CLOSED at HEAD, the eBay-reason-unread
and three-gate claims both confirmed VERIFIED (not stale) by direct grep
before any other work began.

### Task 1 — Ticket registry + CLAUDE.md reconciliation

`docs/TICKET-REGISTRY.md` created: one line per `GK-N` ticket, closed status
vocabulary (`OPEN`/`CLOSED`/`RENAMED`/`SUPERSEDED`/`DEFERRED`), an absolute
alias rule (every retired identifier's successor lists it under `aliases:`
so a grep for a dead number returns the live line, never something
greppable as OPEN). Populated from `git log` + this file — 37 pre-existing
`GK-N` tickets found and classified; 5 (`GK-19`, `GK-24`, `GK-47`, `GK-48`,
`GK-49`) could not be conclusively resolved from evidence in this repo and
are marked `UNKNOWN`, flagged for Jimmy rather than guessed. CLAUDE.md
stamped with `IndexedDB merge sites: 8` (was documented as 5 — the 3-site
undercount Directive A's Task 3 found is now corrected in the canonical
doc, not just logged as a finding), live/dormant external-source counts,
and the test baseline, each carrying a verified-against-SHA/verified-date
stamp. A new standing rule was added: any directive referencing a ticket ID
or a structural fact must run the preflight against the registry first —
this is the mechanism fix, not just the one-time correction; the actual
problem (two directives in one day burning time rediscovering already-
resolved state) doesn't recur if the lookup is a `grep` instead of a
re-investigation.

### Task 2 — GK-72: eBay UNAVAILABLE != EMPTY

`api/comps.js`'s `emptyComps(query, reason)` gained a third parameter,
`unavailable` (default `false`, so every pre-existing call site keeps its
current meaning unless explicitly reclassified). Three call sites marked
`true` at the source — the only place that genuinely knows which case it
is: `"missing eBay credentials"` (:985), `"title required"` (:988, no
search ever attempted), and the catch-all `"fetch failed"` path (:2360,
now exported alongside `emptyComps` itself so it's directly testable).
`api/enrich.js`'s own outer `.catch` around the `fetchComps()` call (used
to discard a thrown error to a bare `null`, which downstream code —
`rawComps?.count === 0 || !rawComps` — treated identically to a healthy
search finding nothing) now returns `emptyComps(null, err?.message ||
'comps fetch threw', true)` instead, so nothing downstream needs a special
case for "rawComps is literally null" vs. "rawComps.unavailable is true."

`out.ebaySourceUnavailable` / `out.ebaySourceReason` are stamped
immediately after `rawComps` is finalized (`api/enrich.js`, right after
`let rawComps = compsFromEbay;`) — deliberately unconditional, not
confined to the refuse-to-price path. This closes the specific gap Task 4
of Directive A named: prior to this fix, a book with eBay genuinely
unreachable but a PC-based price still computable would ship that price
with zero indication the eBay cross-check never ran. Now the flag is
present on `out` regardless of which pricing tier fires. The refuse-to-
price block's generic `"Insufficient data — no verified comps found"`
message now branches to `"eBay data unavailable (<reason>) — no price
could be verified"` when the flag is set, leaving the original message
byte-identical for the genuine-zero case (no regression there).

`decisionEngine.js` gained a new critical warning, `'ebay-source-
unavailable'`, added to the existing `criticalWarnings` list alongside its
closest sibling, `'zero-verified-comps'` (which is about sold-comp AI-
verification rejecting everything — a different condition; this warning is
about the eBay active-listing search never running at all). It escalates
`decision.action` to `RESEARCH` on the same tier as `zero-verified-comps` —
a price computed from PC/sold data alone, with the primary active-listing
cross-check silently unavailable, is not evidence this project can stand
behind at LIST_NOW confidence. `describeWarning` gained the matching
per-slug sentence. Persisted through the same 5 App.jsx merge sites the
sibling `compsExhausted` flag already uses (auto-refresh, scan→catalogue,
scan→selectedItem, bulk-import, refreshMarketData) — the 3 additional
merge sites Directive A's Task 3 found (duplicate-confirm, reIdentifyBook,
manual correction) were deliberately NOT touched, matching the "minimal
blast radius" instruction; noted here so a future full-coverage pass knows
those 3 still need it if Jimmy wants parity with Task 3's full 8-site
audit.

Test: `tests/grailkey-directive-b-task2-ebay-unavailable.test.js`, 12/12
passing — Part A imports the real `emptyComps` and checks its
classification directly; Part B imports the real `computeDecision` and
confirms the new warning/escalation; Part C mirrors `api/enrich.js`'s
refuse-to-price branch (not independently importable, same documented
constraint as `tests/ship23-consistency.test.js`). Shown failing first
against the unmodified source (`emptyComps` wasn't exported yet) before any
edit landed.

### Task 3 — GK-71: Resurrect-Rejected-Evidence pattern, three ComicVine gates

Confirmed all three gates at HEAD before touching anything: year-strict
(`api/enrich.js:755-774`), token (`:883-915`), publisher (`:917-952`). All
three shared one shape — `if (filtered.length > 0) { use filtered } else {
console.log('would remove all... keeping original set') }` — silently
restoring the pre-filter (rejected) candidate set whenever a gate would
otherwise empty it. Fixed identically at all three: the `else` branch now
does `candidates.length = 0` instead, matching the reprint-publisher gate's
own already-correct sibling in the same function (Q99 ruling, deliberately
untouched — it already does exactly this). Confirmed via direct code read
(not assumed) that nothing downstream depends on the restore behavior:
`let match = null;` is the only value used once `candidates` reaches the
scoring stage, and it's only overwritten inside the `candidates.length ===
1` / `> 1` branches — a `candidates.length === 0` array was already handled
gracefully before this fix, for the reprint gate's case at least; this
fix makes the other three gates degrade the identical way instead of
reaching for `candidates[0]` off a set that includes rejected evidence.

Swept for a fourth instance of the shape per the task's own instruction —
found one, in a different subsystem: `api/comps.js:1803`, the eBay
grade-proximity comp filter, explicitly comments "When grade filter would
remove all comps, we fall back to full pool for pricing (to avoid refusing
to price)." Logged as `GK-70`, deliberately **not** fixed — closing it
changes which comps enter price computation, crossing into the pricing-math
boundary this directive's authorization didn't extend to. Two other
similar-sounding comments were checked and found to already be CORRECT,
not violations: `api/comps.js:1441` ("pool is no longer restored on
all-rejected") and `src/lib/categoryClassifier.js:304` ("NEVER let the
thin-pool safety path restore a hard-rejected row") are both pre-existing
enforcements of the same invariant, not instances of the bug.

Test: `tests/grailkey-directive-b-task3-resurrect-rejected-evidence.test.js`,
6/6 passing — mirrors all three real gate predicates plus the untouched
reprint-gate predicate as a regression control, verbatim against the fixed
source. Shown failing first via a throwaway scratch script mirroring the
literal pre-fix `else { return candidates; }` behavior against the same
three predicates — all 3 failed as expected before any edit, confirming
the test would have caught the violation.

### Handoff

Full regression baseline (all 177 `tests/*.test.js` files) run in parallel
with this work; see the closing HANDOFF block reported to Jimmy for the
exact before/after tallies. `npm run build` clean. Three commits, one per
task, per the directive's own commit discipline. `docs/TICKET-REGISTRY.md`
gained 4 new entries this dispatch beyond the 37 backfilled: `GK-70`
(open, deferred), `GK-71` (closed, Task 3), `GK-72` (closed, Task 2).

## GrailKey Directive 2026-08-11-G, Task 4 — Authority Propagation Invariant (named, generalizes Rejection Must Not Create Authority)

Directive F (2026-08-11) ran two traces — PriceCharting edition-trust
render authority, and floor-raise authority — expecting they might land
on the same defect shape as the standing "Rejection Must Not Create
Authority" invariant (Dispatch 34) or as separate things entirely. Both
traces found real, distinct instances, but neither was a clean fit for
"rejection" specifically: one was a correctly-computed classification
whose consumer never saw it (a narrower gating problem than rejection);
the other was a correctly-attempted correction discarded by an
unconditional overwrite built for an unrelated invariant (single-source-
of-truth). Sweeping for a third example (Task 3 of this dispatch, the
22c-title-revote path) turned up a shape that isn't even about a value
being dropped — a *replacement* value skipping a gate its predecessor was
required to pass.

**The umbrella invariant, verbatim (widened, Directive H Item 4 — see the
note at the end of this section):**

> **Authority Propagation Invariant.** A value that is computed,
> classified, rejected, corrected, or replaced must propagate to every
> downstream consumer whose behavior depends on it. If a later write
> replaces or preserves that value, the preserved or replacing value must
> still satisfy the authority checks that governed the original before
> becoming actionable.

Three distinct mechanisms live under it. Keep them separate — a failure
class that blurs different bugs into one name stops being useful for
diagnosis, because the fix shape differs (gate the consumer / gate the
writer / clear on absence).

### (a) Computed-Then-Discarded

The signal is produced correctly and dropped before the consumer that
needs it. The practical test: *name every consumer of the value. If a
consumer that depends on it doesn't see the classification, that's (a).*

**Six confirmed instances** (normalized from an original count of eight —
Directive H Item 4 folded one duplicate and demoted one non-instance; see
the note below the table):

| Value | Fate | Status |
|---|---|---|
| `emptyComps().reason` | unread by the response surface | CLOSED, GK-72 |
| `assetTypeConfident` | never reached the confirmation badge | CLOSED, Directive E |
| `assessPcAnchorTrust` verdict (`out.pcAnchorTrust`) | persisted only when the comp pool is completely empty (`evidenceEligibility.js:927`, `rawPricingPoolEmpty && gradedReferencesEmpty`) — the opposite of the case that needs it (a real pool, a merely-plausible PC edition match) | FIXED, Directive G Task 2 — now stamped unconditionally whenever a PC record exists (the same gate condition that discarded it is the fix site — value and mechanism are one instance, not two), gated into render at `src/lib/pcAnchorAuthority.js` |
| `preFloorPrice` | written, never read back downstream | OPEN |
| `floorFired` | never reaches the render site (`App.jsx`'s "Floor guard" panel reads `rawComps.lowest` directly instead) | OPEN |
| `decision.price` floor-raise (`decisionEngine.js:862-865`, `enforceFloor(item.price*0.8, floor)`) | unconditionally overwritten by `responseContract.js:741` (`out.decision.price = contract.price`) before the response ships — the raise is computed, never propagates | OPEN (wording-only fix shipped, Directive G Task 1 — the underlying non-enforcement is GK-68/GK-75, still open) |

**Correction, Directive H Item 4:** the original table also listed
"`pcAnchorTrust` persistence gate itself" as a separate row from the
`assessPcAnchorTrust` verdict row directly above it — the same fact
(the gate at `evidenceEligibility.js:927` was inverted) described from
two angles, not two instances. Folded into one row.

**Demoted, not an (a) instance:** PriceCharting `reference-only`
classification (the `[price-trace]` log label at `api/enrich.js:9155`).
The original table's own text for this row said *"no field ever existed
to carry an edition-trust signal alongside it — an absence, not a drop"*
— which, by this section's own definition directly above ("the signal is
produced correctly and **dropped**"), disqualifies it: nothing was ever
computed here to be discarded. It is a **design gap**, not a
Computed-Then-Discarded instance — there was no carrier field for an
edition-trust signal at that log site until `out.pcAnchorTrust`/
`out.pcAnchorYear` (Directive G Task 2) gave the codebase one elsewhere.

### (b) Validation Bypass on Authority Replacement

A new write replaces a validated value without re-running the validation
that governed the value it replaced. The practical test: *name every
writer of the value. If a writer skips a gate the previous value was
required to pass, that's (b).*

One confirmed instance: **GK-76**, the 22c-title-revote path
(`api/enrich.js:6649-6661`). When `[22c-title-revote]` fires (unanimous
pool rejection + PC no-match on the original title), the handler
re-queries PriceCharting against the revoted title and writes
`out.pcProductId`/`out.pcProductName` from whatever it finds —
unconditionally. The ORIGINAL PC match, earlier in the same request, had
to clear `pc-anchor-gate` (`api/enrich.js:5045-5126` — year/name/
discriminator conflict checks against `poolYearHint` and the winning
family's own member titles) before its `pcProductId` was allowed to
stand. The revoted match never runs that gate at all. Not fixed —
logged, needs its own scoping (whether the revote should re-run the full
three-axis gate, or a narrower re-check scoped to just the axis that
triggered the revote, is an open design question, not an implementation
detail).

### (c) Stale Authority Inheritance (new, Directive H Item 4)

A value outlives the evidence that produced it, because a later write
path *preserves on absence* instead of clearing — distinct from (a) (a
consumer never seeing a value at all) and (b) (a replacement value
skipping a gate): here the value genuinely reached its consumer once,
correctly, and then survived past the point where the evidence backing
it stopped existing. The practical test: *for any value, ask what
happens when the producing evidence disappears on a later write. If the
old value survives, that's (c).*

Two confirmed instances:

| Value | Fate | Status |
|---|---|---|
| `out.ebaySourceUnavailable`/`Reason` | `api/enrich.js:6240-6244` only ever explicitly sets `true` — no `else` branch clears/sets `false` on the healthy path, so a stale `true` from before a correction can survive a correction whose fresh response is genuinely healthy and simply omits the key (GK-73's third finding) | OPEN |
| `pcAnchorTrust`/`pcAnchorYear` | 6 of 7 explicit `src/App.jsx` merge sites read `enrich.pcAnchorTrust ?? cur.pcAnchorTrust ?? null` — when a later scan's response carries no PC anchor at all, the stale prior verdict (including `EXACT_EDITION`) survived the merge; the 8th site (`buildCorrectedCatalogueItem`, full-spread merge) had the same symptom via a different mechanism (an omitted key is never overwritten by a spread) | FIXED, Directive H Item 1 — the `?? cur.` fallback removed at all 6 explicit sites (matching `reIdentifyBook`'s pre-existing correct pattern); `pcAnchorYear` added to `buildCorrectedCatalogueItem`'s clear-list (`pcAnchorTrust` was already there, added Commit E1, 2026-07-29, before this field existed) |

Fix shapes differ by mechanism, which is why the three classes stay
separate: **(a)** gate the consumer · **(b)** gate the writer · **(c)**
clear on absence instead of inheriting.

### Why the invariant statement was widened (Directive H, Item 4)

The original umbrella statement covered only *replacement*: "if a later
write replaces that value, the replacement must pass the same authority
checks." Mechanism (c) — a value surviving unchanged because a later
write *preserves on absence* rather than replacing at all — is not a
replacement and fell outside that sentence's literal scope, even though
it is the same underlying failure (a later write producing a value that
does not deserve the authority it inherits). The statement now covers
both: "if a later write replaces **or preserves** that value, the
preserved or replacing value must still satisfy the authority checks
that governed the original."

### Relationship to the existing invariant list

This umbrella sits above, and does not replace, **Rejection Must Not
Create Authority** (Dispatch 34) — that invariant is the special case of
(a) where the specific value being lost is a rejection determination
(the ComicVine fail-open, the mega-key-floor path, the eBay
grade-proximity filter at GK-70). Authority Propagation Invariant
generalizes it to any computed/classified/corrected/preserved value, not
only rejections, and adds mechanisms (b) and (c) as genuinely separate
shapes sitting alongside it — not a rewording, two additional failure
modes the narrower "rejection" framing never covered.

Joins the running list: Dispatch 33 (Monotonic Evidence Extension, No
Self-Corroboration), Dispatch 34 (Rejection Must Not Create Authority),
Dispatch 37 (Cache Correctness Is Authority Correctness), Dispatch 44
(Authority Must Be Use-Consistent), Dispatch 46 (A safety gate must not
disappear because an asset crossed a persistence boundary; A value must
not vote for itself).

## GrailKey Directive 2026-08-13-O — comp query ladder ordering fix (Sabrina / Dan Parent NYCC class, Defect A)

Successor to Directive N1's identity-resolution trace, which proved (but
did not fix, investigation-only) that `api/comps.js`'s comp-query attempt
ladder was mis-ordered for any book with a confirmed variant. This
dispatch was explicitly greenlit to trace further and fix that one
defect only — not the PC-year anchor Directive N1 also flagged
(Defect B, still unconfirmed as independent — see below), not identity
resolution, not Q140/Flash #139.

### The defect, traced

`api/comps.js` builds an ordered `attempts` array, most-specific-first by
design (documented in CLAUDE.md's "Search query construction" section).
Full ladder as it existed pre-fix, in construction order:

1. **`n=-1`, label `image-search`** (`api/comps.js:1114-1121`, Ship
   #20a.6.7b.3, commit `6f5b0df`, 2026-04-29) — built from
   `imageSearchTitle` (the upstream `ship12`/Q141-sanitized title+issue+
   year string, deliberately variant-blind by design —
   `buildSanitizedComicSearchTitle` takes three params, no variant).
   **Pushed unconditionally, always first.**
2. **`n=0`** (`api/comps.js:1143-1148`) — `cleanTitle #issue fullVariant
   year publisher`. First attempt that carries the confirmed variant.
3. **`n=1`** (`1149-1152`) — `cleanTitle #issue variantKeyword year`
   (short variant keyword, not the full string).
4. **`n=2`** (`1153-1156`) — `cleanTitle #issue variantKeyword`, no year.
   Last attempt carrying any variant signal.
5. **`n=3`** (`1157-1160`) — `cleanTitle year`, no issue, no variant.
6. **`n=4`** (`1161-1162`) — `cleanTitle` only.
7. **`n=5`** (`1163-1169`) — first significant word + issue.
8. Dell Four Color aliases (conditional, `n = attempts.length` — always
   sort last).
9. **`unshift`, artist-specific** (`1198-1231`) — when `variant` matches
   a known `ARTIST_PATTERNS` entry, a dedicated artist+variant query is
   unshifted to absolute index 0. Genuine precedent for "put a variant-
   aware query ahead of image-search," but gated on a strict allowlist —
   "Dan Parent" is not in `ARTIST_PATTERNS` (confirmed by grep), so this
   mechanism never fired for the Sabrina scan.
10. **`unshift`, tpb-aware** (`1233-1255`) — same unshift shape, gated on
    a TPB-format marker in our own title. Also never fired for Sabrina.

The attempt loop (`api/comps.js`, formerly ~1988, now shifted by the
inserted fix block) breaks on the **first** attempt with
`filtered.parsed.length > 0` — no minimum count, no quality bar (see
GK-82 below). Attempt `-1` is *broader* than attempts 0-2 for any book
with generic copies alongside a real variant, yet ran before all three.
Production evidence (Sabrina, build `11d70aa`, 16:16 UTC): attempt `-1`
alone returned 84 raw / 11 final survivors off generic 1997 copies;
attempts 0-2 (carrying "Dan Parent NYCC variant") never ran at all.
Priced $9.56 against a real ~$50 book.

**Why attempt `-1` exists, and whether that blocks reordering:** traced
to commit `6f5b0df` (2026-04-29, "Ship #20a.6.7b — image search wired
into PC + comp query"). The commit's own stated purpose for the `.3`
sub-ship: "Pass top image search rawTitle as first comp attempt — Catches
exact listings Vision might have misread — No pricing-math impact (comp
filter logic unchanged)." This is a coverage justification (catch cases
where Vision's own title text is wrong), not a specificity ruling — the
commit message never asserts image-search must outrank a confirmed
variant, and grepping `docs/PATTERN-LIBRARY.md` for `attempt -1`/
`image-search attempt`/`20a.6.7b.3` prior to this dispatch returns zero
hits, i.e. no later ruling protected this ordering either. **No blocking
ruling found.** Reordering for the variant-confirmed case does not
undermine the original "catch a misread listing" purpose — image-search
still runs, just no longer ahead of a real, confirmed-variant query.

### The fix — order only

`api/comps.js`, inserted between the Dell Four Color alias block and the
artist-specific `unshift` block (i.e. runs on the fully-built attempts
0-5 + aliases, before either `unshift` mechanism, so both still win
absolute index 0 exactly as before): when `variant` is truthy, find the
last attempt with `n` in `[0, 2]` (the only three that carry variant
text) and splice the already-built image-search attempt to run
immediately after it. No variant, or no variant-bearing attempt exists
at all (e.g. no issue number) → no-op, image-search stays at position 0,
byte-identical to pre-dispatch behavior. Query string construction for
every attempt is completely unchanged — this is a pure array-ordering
change. A second, independent addition: an explicit
`[comps-ladder] winner: attempt N ...` log line at the break point, so a
production log states which query produced the priced pool without
requiring the reader to infer it from the last non-empty attempt/
post-filter pair.

### Verification

Demonstrated **directly against real code**, not a mirrored predicate —
the attempt-array construction lives entirely inside `fetchComps`'s
non-exported body and isn't independently constructible, so the test
(`tests/grailkey-directive-o-comp-ladder-reorder.test.js`) runs the real,
exported `fetchComps()` against a query-differentiated mocked eBay Browse
API (generic-copy pool vs. "Dan Parent" variant pool, keyed off the
actual outgoing query text). Verified both ways via a `git stash` of
`api/comps.js` alone: pre-fix (real HEAD `11d70aa` code, stashed fix),
Scenario A fails exactly as predicted — the generic pool wins, and
`[comps] attempt 0 query=...` never appears in the log at all (attempt 0
genuinely never ran). Post-fix (stash popped), all 5 assertions pass:
the variant pool wins Scenario A; Scenario B confirms the broaden-on-
failure fall-through still works when the variant query itself returns
nothing; Scenario C confirms the no-variant case is byte-identical to
pre-dispatch behavior.

24-file targeted regression — every test file that imports
`api/comps.js` directly, plus the suites CLAUDE.md documents as covering
the attempt ladder/artist-pattern/variant-filter mechanisms, plus
`comp-filter-hygiene.test.js` and `priceBands.test.js` by name per this
dispatch's own instruction — run individually, both pre-fix (stashed)
and post-fix, output diffed. **Byte-identical on all 24**, including the
two suites with pre-existing, already-documented failures
(`comp-filter-hygiene`: 4 failed both runs, matches CLAUDE.md's
documented "comp-filter-hygiene (4, Bug 1/2 helpers)"; `priceBands`: 7
failed both runs, matches the documented "priceBands (7)" baseline) —
confirming this change touches neither of those pre-existing gaps.
`npm run build` clean (ESM-parse check + vite build). Test baseline
re-stamped in the same commit: 166/16/3/185 → 167/16/3/186.

### Findings logged, not fixed (explicit dispatch non-goals)

- **GK-82** (`docs/TICKET-REGISTRY.md`) — the attempt loop's break
  condition, `filtered.parsed.length > 0`, has no quality/confidence
  floor beyond nonzero count; a single junk survivor can win an entire
  attempt. Confirmed directly reading the loop; not touched, per this
  dispatch's own explicit instruction not to change the break condition
  unless this exact finding surfaced — it did, so it is reported here and
  in the registry, not fixed.
- **Defect B (PC-year anchor) remains unconfirmed as independent of
  Defect A.** This dispatch did not touch `confirmedYear` or the era
  filter at all, by design. A future rescan of the real Sabrina book
  against the now-fixed ladder is the only way to know whether the
  variant-bearing attempt, once it runs, retrieves real 2024/variant
  candidates that the `confirmedYear=1997` era anchor then rejects — the
  documented four-cause proof chain (attempt 0's query itself still too
  broad/wrong; variant tokens not matching real marketplace wording;
  attempt 0 returning zero for an unrelated reason; or the year anchor
  specifically rejecting otherwise-correct candidates) means a generic
  post-fix pool alone would not, by itself, confirm Defect B. Not
  investigated further this dispatch — explicitly out of scope.

## GrailKey Directive 2026-08-13-P — corroborated title-family adoption (Task 1 BLOCKED, Task 3 SHIPPED)

Third consecutive Sabrina scan producing a wrong identity while the
correct one sat at ranks 1 and 2 of the pool. Two-task dispatch: Task 1/2
traced and (conditionally) fixed the `top-rank-guard`/weighted-consensus
overlap veto; Task 3, independent of 1/2, fixed variant visibility on the
operator card.

### Task 1 — the trace

Production evidence, 21:16 scan, build `e95b9a9`: ranks 1 and 2 of the
image-search pool are both the real book (`Sabrina Annual Spectaculer
2024 #1 Dan Parent NYCC Foil Variant`, `$50.00`; `Sabrina Annual
Spectacular #1 Dan Parent NYCC PINK LAVA FOIL Variant`, `$109.95`). The
weighted-consensus family containing both (`weight 9.0, 2 members`)
outweighs the generic runner-up (`weight 5.0, 7 members`) — genuine
aggregate evidence, not a single-row override — yet the pipeline still
fell all the way back to Vision's bare `"Sabrina the Teenage Witch"`.

**Mechanism, traced precisely.** `selectTitleFamilyCandidate`
(`src/lib/imageSearchIdentity.js`) runs two, not one, overlap gates in
sequence for this scan's shape: `top-rank-guard`'s own bidirectional
check (`~2440-2448`, forward ≥50% of Vision's tokens / reverse ≥40% of
the candidate's tokens — two genuinely different denominators, not the
same bar twice) falls through when forward overlap is 25% (1/4 shared
tokens); execution then reaches the separate `weighted-consensus`
branch's own overlap gate (`OVERLAP_THRESHOLD = 0.4`, `~2511`,
`sharedTokens / min(topFamily.tokens.length, visionTokens.length)`),
which independently also measures ~25% here and returns
`decision: 'fallback-vision'` (`~2774-2784`, the literal
`"Top family weak overlap (X/Y tokens = Z% < 40%) — preserve Vision"`
reason string in the production log). `familyCandidate.decision ===
'fallback-vision'` leaves `confirmedTitle` untouched by the family branch
entirely (`identityCore.js` — the branch this decision reaches never
reassigns it), so `confirmedTitle` stays whatever Vision's own read
already set it to.

**Why the guard fires backwards, confirmed as designed, not a bug in
itself.** Both overlap gates measure the candidate FAMILY against
VISION's own tokens — the more a family extends past what Vision could
read off the cover (exactly the shape of a genuine correction), the
lower its overlap with Vision, the more likely both gates reject it. This
is the standing "measuring coherence against the wrong population"
disease class, applied to a mechanism (title-family selection) that
hasn't previously been named as an instance of it.

**Not Flash #139 territory, confirmed directly, not asserted.** Issue is
not in dispute (Vision `#1`, family `#1`); `resolveFamilyIssueConsensus`/
Q140 is never reached by this trace at all — the whole failure happens
inside title-family SELECTION, a structurally separate mechanism from
issue-CONSENSUS adoption. The directive's proposed corroboration rule
(≥2 unique rows + issue agreement + cross-source variant corroboration,
never rank/position as an input) does not conflict with the Flash #139
invariant as literally stated.

**Two independent blockers, each alone sufficient — Task 2 did not ship.**

1. **`weightSum` is rank by construction, not merely correlated with it.**
   `scoreTitleFamilies`'s `getRankWeight(idx)` (`imageSearchIdentity.js:
   1195-1202`) is a literal per-array-index lookup table (rank 1→5, rank
   2→4, rank 3→3, ranks 4-10→1, ranks 11-20→0.5, else 0);
   `weightSum = family.indices.reduce((sum, idx) => sum + getRankWeight(idx), 0)`
   (`:1206`). For this scan's family (members at index 0 and 1):
   `5 + 4 = 9.0` — exactly the logged figure. The directive's own stated
   test (Blocker 3) — "what would the winner be under a rank-free
   signal?" — resolves against the proposed fix: a bare row count (2 vs
   7) flips the answer entirely, meaning "the family won the weighted
   vote" is not independent evidence separate from rank; it currently IS
   rank, restated as a sum. Adopting on this signal, even gated behind
   additional corroboration conditions, would still be adopting because
   the correct rows happened to rank first — the precise shape Flash #139
   forbids, even though the ISSUE axis itself is untouched.
2. **`confirmedVariant` does not exist yet at the decision point.**
   `selectTitleFamilyCandidate` is called at `api/enrich.js:2867`;
   `confirmedVariant` isn't declared until `api/enrich.js:5348` (`let
   confirmedVariant = writeConfirmed(...)`), ~2700 lines and several
   pipeline phases later. Confirmed directly against the real production
   log timestamps: guard decision at `21:16:07.402`, `confirmedVariant`
   write at `21:16:07.442` — 40ms AFTER the guard has already returned.
   No legal corroboration variant signal exists at the guard's call site
   as the pipeline is currently phased; `req.body.variant` (the raw,
   pre-confirmation value) is explicitly not a substitute per the
   directive's own instruction — it can be invalidated/cleared downstream
   (`[commit4.3] variant provenance invalidated ... clearing
   req.body.variant`, a real log line from a nearby scan) and using it
   early would bypass the exact confirmation process this campaign
   exists to enforce.

Both logged as blocking findings per the directive's own gating
structure (item 6 / Blocker 2, item 5 / Blocker 3); **GK-83** records
Blocker 2 specifically as a standing architectural fact for any future
dispatch attempting a similarly-shaped early-phase corroboration check.

**A third, non-blocking but load-bearing finding, for whenever Task 2 is
revisited.** Even with both blockers cleared, the directive's proposed
"≥2 unique rows" floor would collide with the pre-existing `Q38` gate
(`imageSearchIdentity.js:2760`, commit `6e35aa8`, "Require ≥3 members for
weighted-consensus override") — a real, production-evidence-justified
rule (a 1-member family with an internally mismatched issue number, title
said #157, family extracted #201, silently overrode Vision before this
gate existed). If a future corroboration bypass is implemented as a
modification INSIDE the existing `weighted-consensus` branch rather than
as its own structurally separate decision path with its own return, a
2-member family would fall through into `Q38`'s gate and be blocked
there regardless of corroboration — the fix would need its own explicit,
new decision type (analogous to how `top-rank-protection` and
`weighted-consensus` are already two distinct decision types with two
distinct gate sets), not a threshold change inside Q38's own branch.
Interesting, not yet resolved: the directive's proposed corroboration
bar (2 rows + mandatory issue agreement + cross-source variant
corroboration) is arguably STRICTER on the axes Q38's own real failure
case exposed (issue coherence, external corroboration) than Q38's bare
"3 members, ≥40% overlap" bar — Q38's single-member failure would have
been caught by the issue-agreement condition alone — but this is a
design argument for Jimmy to weigh, not a decision made here.

**No prior ruling directly forbids the bypass (item 2).** Traced to
commit `6f5b0df` (2026-04-29) for the OTHER investigated mechanism
(image-search attempt ordering, Directive O) — not directly relevant
here. No commit or Pattern Library entry found asserting `top-rank-guard`
or the weighted-consensus overlap gate must never yield to
cross-source corroboration; the blockers above are structural (rank
embedding, temporal unavailability), not a standing ruling against the
concept itself.

**Test suites in this mechanism's blast radius (30 files, grep-confirmed)
— named so a future implementation's regression sweep has a starting
list**: `q-trackB-commit4.3-winning-family-authority`,
`q-trackB-commit4.3.1-retention-decline-fail-closed`,
`q144a-family-discriminator-gate`, `grailkey-dispatch-32-frozen-corpus`,
`q140-coherent-content-token-lane`, `q133-slice1b-eom-registry`,
`grailkey-dispatch-25-fix2c-axis-check`, `grailkey-commit-s`,
`ship26-integration`, `grailkey-commit-t`,
`q-trackB-commit4-adoption-provisional`, `grailkey-commit-p`,
`grailkey-commit-d1-d2-printing-axis-injection`,
`grailkey-commit-b1-q84-issue-corroboration`,
`q140-at-vision-zero-support-skip`,
`q-trackB-commit4.2-fingerprint-year-restamp`,
`q-trackB-commit4.1-spawn-visual-family-merge`,
`q131-refused-identity-conflict-provisional`,
`q133-slice2-identityrefused-promotion`,
`q134-provisional-override-boolean`,
`q132-layers-1-2-year-conflict-resolution`,
`q132-david-nakayama-family-recovery`, `q131-systemic-audit-fixes`,
`q130-john-giang-artist`, `q119-compound-title-consolidation`,
`family-clustering`, `q-pc-requery-gate`, `q85-compact-key`,
`q84-dual-axis`, `pattern-k-dedupe-issue`. `q140-issue-consensus-
corrective` (the Flash #139 regression guard) re-run directly this
dispatch: 124/0, unchanged — confirmed byte-identical since zero
`src/lib`/`api` files were touched.

### Task 3 — variant identity on the operator card, SHIPPED

Independent of Task 1/2 — display and custody only, zero pricing math.
Production evidence proved the value is computed, confirmed, and
consumed correctly server-side (shapes the comp query, rejects
mismatched sold comps) but never reached the person looking at the card.

**Custody trace, hop by hop.** `confirmedVariant` → `out.variantNote`
(`api/enrich.js:~10862-10863`, a pre-existing Q135-dispatch universal
fallback, unconditional, confirmed unchanged) → four pre-existing
catalogue-merge sites already correctly rename it to `item.variant`
(`enrich.variantNote || cur.variant || null`, `App.jsx:10347/11388/
11943/12913`) → the PRIMARY scan-save merge does too, via a shared
helper (`mergeConfirmedIdentity`, `src/lib/dataQualityGuard.js`,
presence-aware `hasKey(enrich, 'variantNote') ? enrich.variantNote :
prior?.variant`, spread into the merge at `App.jsx:10931`). All of this
was ALREADY correct — not touched.

**Two real, distinct gaps found and fixed:**

1. **The live, fresh-scan `result` state never picked up the confirmed
   value at all.** `gradeBlob`'s two `setResult` merges did a bare
   `{ ...prev, ...enrich, ... }` spread — this brings `enrich.variantNote`
   into `result` under the SERVER's field name, but `ResultCard` (the
   very first thing an operator sees, before any save) reads
   `result.variant`, a different key a plain spread never populates from
   `variantNote`. `result.variant` therefore stayed frozen at whatever
   Vision's own PRE-enrich guess was (`data.variant`, set once when the
   scan started), never updated even when enrich.js's own identity
   resolution corrected or enriched the variant text afterward. Fixed:
   both `setResult` call sites now do `variant: enrich.variantNote ??
   prev.variant` (same `??`-over-honest-null convention `mergeConfirmedIdentity`
   already established for the catalogue path, not `||`).
2. **Even where `item.variant` WAS correctly populated (`CollectionDetail`,
   the saved-book view), it rendered ~1,400 lines below the title block**
   — after grading, pricing, comps, and a "known keys" expandable section
   — not adjacent to title/issue/year as an identity-shaping value
   deserves. Moved to directly under the title/publisher/year header for
   both `ResultCard` and `CollectionDetail`; the old, buried duplicate
   removed (not left rendering the same value twice); the separate,
   compact collection-LIST-tile badge (a different, earlier component,
   space-constrained by design) deliberately left untouched — not the
   surface this dispatch targets.

**Unconfirmed/invalidated state does not reach the client today, checked
directly.** `out.variantNote` is a single string-or-null field with no
companion status/confidence field (unlike `identityConfident`/
`assetTypeConfident`, which do have one) — grep-confirmed zero
`variantConfidence`/`variantStatus`-shaped fields anywhere. When a
variant is invalidated server-side, `confirmedVariant` is nulled and
`out.variantNote` correctly resolves to `null` — ~~the client's existing
"only render if truthy" pattern already, correctly, shows nothing in
that case (satisfies "no false variant label" by the existing absence
convention, not a new mechanism)~~. **FALSE, corrected by GrailKey
Directive Q (2026-08-13) — see that dispatch's own Pattern Library entry
below.** The merge that fed the truthy check (`?? prev.variant` / `||
cur.variant || null`) converted that server null BACK into the stale
prior string before the truthy check ever ran — the check itself was
never wrong, but it never actually saw a null on this path, because the
merge upstream of it silently discarded the server's authoritative
clear. This was P's own shipped defect, not a pre-existing condition P
correctly described. What the client CANNOT do is show "a
variant was claimed but could not be confirmed" as a distinguishable
state from "no variant was ever claimed" — per the directive's explicit
instruction, this is reported as a propagation gap, not built around
with a new field.

**Candidate pattern recorded, single observation, not promoted:**
**"Hidden actionable identity is a product defect."** If a facet is
authoritative enough to change search, filtering, pricing, or listing
behavior, it is authoritative enough to be visible to the operator.
Distinct from Computed-Then-Discarded (the value here is never
discarded — it reaches every intended consumer correctly; it simply
never reaches the one consumer, the operator, that was never wired as a
recipient at all).

**Test baseline correction folded in, same commit.** Directive O's own
`grailkey-directive-o-comp-ladder-reorder.test.js` was missing the
explicit `process.exit()` call every `fetchComps`-importing test in this
suite requires (the Upstash client leaves a dangling handle even when
unconfigured) — it exited 124 (TIMEOUT under a naive sweep) despite its
5 assertions passing cleanly both pre- and post-fix. Fixed in this
commit rather than left as a stamp that would read false to the next
automated sweep. 167/16/3/186 → 168/16/3/187 (one new file,
`grailkey-directive-p-task3-variant-on-card`, 20/20 clean, Part 1 proving
both pre-fix defects against real `git show HEAD:src/App.jsx`, not a
mirror).

### Handoff

Task 2 (title-family corroboration bypass) not shipped — two independent
blockers, reported per the directive's own gating instructions, both
logged (`GK-83` for the temporal one; the rank-embedded-weight finding
is structural, not a ticket). Task 3 shipped and pushed. `confirmedYear`
untouched, as instructed — Defect B (from Directive O) remains open and
unwaived; this dispatch made no attempt to resolve it. Next: Jimmy rules
on whether/how to pursue title-family corroboration given the two
blockers (a genuinely rank-free family-strength signal would need to be
designed from scratch — not requested, not built this dispatch), then a
live Sabrina rescan for Task 3's visual confirmation and Defect B's own
four-cause proof chain, per Directive O's still-open instructions.

## GrailKey Directive 2026-08-13-Q — corrective: variant null custody (third Stale Authority Inheritance instance)

Directive P shipped a variant-custody fix that was itself backwards. This
dispatch corrects it — same file, same merge boundaries, opposite defect
class from what P set out to fix.

### The defect

P's own shipped code, at both `setResult` merge sites:

```js
variant: enrich.variantNote ?? prev.variant
```

with a comment claiming `??` (not `||`) lets an honest server null
override a stale guess. **Backwards.** `??` falls through on `undefined`
**and** explicit `null` alike:

| `enrich.variantNote` | Result | Correct? |
|---|---|---|
| `"Dan Parent NYCC variant"` | that value | correct |
| `undefined` (field absent) | `prev.variant` | correct |
| `null` (server revoked it) | `prev.variant` | **wrong — resurrected** |

The four pre-existing catalogue-merge sites (`enrich.variantNote ||
cur.variant || null` / `|| item.variant || null`), which P's own trace
called "already correct," have the identical defect (`||` falls through
on null, undefined, AND empty string alike) — P's trace was wrong about
these, not just silent on them.

**Confirmed reachable, not hypothetical.** `out.variantNote` is an
own-property on every response from the NORMAL (non-early-return)
completion path — `api/enrich.js`'s Q135 universal fallback
(`~10862-10863`, `if (out.variantNote === undefined) { out.variantNote =
confirmedVariant || null; }`) always fires exactly once per request on
that path, always assigning either a string or an explicit `null`. Any
ordinary rescan where Vision's fresh read doesn't re-detect a variant it
previously caught (different angle, subtler cover marking missed a
second time — no special "invalidation" mechanism required) produces
`confirmedVariant = null` → `out.variantNote: null` as a real,
serialized own-property, reaching every one of P's six defective merges.
Two early-return paths (`api/enrich.js:5911` "refused",
`api/enrich.js:7394` "STOP — no pricing") DO omit the key entirely —
traced directly, `out.variantNote` is never assigned before either
`return`. That is not a bug: the corrected rule's own "absent → preserve
prior" arm is the CORRECT behavior for those paths (no new information
this request, keep whatever the card showed), so no special-casing was
needed for them.

### A 7th, differently-shaped defect, found in the same audit

`buildCorrectedCatalogueItem` (`src/lib/manualCorrection.js`) — `variant`
is in `IDENTITY_DEPENDENT_FIELDS_TO_CLEAR` (unconditionally nulled on
every manual correction, by design — a correction changes identity, and
the old variant shouldn't survive under a new one), but the generic
`{ ...cleared, ...enrichData }` spread never renames `enrichData`'s own
`variantNote` field to `variant` — no other field in this merge needs a
rename, `variant` is the one exception, and it was missing. Result:
`merged.variant` was **unconditionally `null` on every manual
correction**, regardless of what the server actually determined — not a
resurrection (nothing to resurrect; "prior" is deliberately cleared
here), a straightforward, silent, 100%-rate data loss. Fixed with one
explicit line, `merged.variant = enrichData?.variantNote ?? null;` — a
bare `??` is correct in this one specific context (unlike the other six
sites) precisely because there is no legitimate "prior" to protect here.

### The fix

**7 defective sites fixed, out of 8 audited merge-boundary entries total**
(the 6 `App.jsx` sites + `manualCorrection.js`'s one site + `mergeConfirmedIdentity`,
which was independently verified already correct and untouched — the
primary scan-save merge already spreads its full return, the only one of
the eight that did). **Corrected here (GrailKey Directive R, Task 3) — not
one uniform contract, two different correct contracts for two different
situations:**

```
6 App.jsx sites:      property absent       → preserve prior
                       property present      → trust the fresh signal
                       (value or null)
manualCorrection.js:   property absent       → null
(1 site)               property present      → trust the fresh signal
                       (value or null)         (no prior exists to
                                                 preserve — the old
                                                 identity's variant is
                                                 deliberately cleared
                                                 before this line runs)
```

The six `App.jsx` sites use `Object.prototype.hasOwnProperty.call(enrich,
'variantNote')` inlined directly, not `dataQualityGuard.js`'s private
`hasKey` (not exported — would export a private internal) and not
`mergeConfirmedIdentity` (would silently widen those sites' merge
behavior to title/issue/year/publisher too, fields they don't otherwise
touch). `manualCorrection.js`'s one site uses a plain `?? null` — correct
there specifically because it is the one site among the eight where no
legitimate "prior" exists to protect.

### Classification: third confirmed instance of Stale Authority Inheritance

Per the directive's own instruction, promotion required proving
production reachability first, not assuming the shape — done above
(`out.variantNote: null` is a genuine own-property on the normal
completion path, not merely structurally possible). Joins `ebaySourceUnavailable`
(GK-73) and `pcAnchorTrust`/`pcAnchorYear` (Directive H, Item 1) — same
file, same merge layer, same shape: a value outlives the evidence that
produced it because the write path preserves on absence rather than
clearing. **Deliberately not merged with the "Hidden Actionable
Identity" candidate pattern** (Directive P, single observation, not
promoted) — that candidate is about authority never reaching the
operator at all; this is a different mechanism, old authority surviving
past the point newer authority revoked it. Blurring the two is exactly
the failure mode the candidate/doctrine separation exists to prevent.

### Why the test didn't catch it

`tests/grailkey-directive-p-task3-variant-on-card.test.js` passed 20/20
while this defect shipped — it verified source structure and string
placement (`Variant: {item.variant}` appears near the title; the rename
text exists), never a merge OUTCOME. Same class as Directive H, Item 2:
structure passing for behavior. The corrective test
(`tests/grailkey-directive-q-variant-null-custody.test.js`, 49
assertions) extracts each real merge expression from source via regex
and actually evaluates it (`new Function`) against constructed
`{variantNote: ...}` / prior-object inputs, asserting the real output for
all three cases at all seven sites — plus `buildCorrectedCatalogueItem`,
imported and called directly (a real `src/lib/` module, not App.jsx).
Part 1 proves the pre-fix defect directly against `ef7cf53` (`git show`
for the six App.jsx sites; `git stash` + real import for
`manualCorrection.js`), not a mirror. P's own test was repaired in the
same commit (its Part 1 pinned to bare `HEAD`, which silently stopped
proving the pre-fix state once HEAD moved past `ef7cf53` — repinned to
that exact SHA; Part 2/3's exact-string checks updated to match the
corrected expressions) rather than left permanently red.

### Regression

`q-trackB-commit3-manual-correction` (466 assertions),
`q-trackB-commit4-adoption-provisional` (152), `grailkey-directive-h-item1-stale-pc-anchor`
(6) — every suite importing `manualCorrection.js` — re-run directly, byte-
identical, 0 new failures. `npm run build` clean. Zero `api/*.js` files
touched. Test baseline re-stamped: 168/16/3/187 → 169/16/3/188 (one new
file, one repaired file, net PASS-file-count effect +1/+1).

### Handoff

Pushed and deployed. **CORRECTED (GrailKey Directive R) — the rescan-
cleared claim below was premature.** This dispatch's own Task 1 traced
client-side merge boundaries only; it inferred, rather than proved, that
`api/enrich.js`'s two early-return paths safely omitted `variantNote` on
the server side. ~~The Sabrina rescan Directive O/P left pending is now
cleared to run.~~ Directive R held the rescan, traced both server-side
paths directly, found both LIVE DEFECTS (not the safe omissions assumed
here), and fixed them — see that dispatch's own entry below for the
actual clearance. Nothing else deferred from this dispatch's own scope —
all 7 client-side sites Task 1 found were fixed, none held back; the
server-side gap was a genuinely separate question this dispatch did not
ask.

## GrailKey Directive 2026-08-13-R — early-return variant omission (server-side, held rescan)

Directive Q's handoff stated the two early-return paths in `api/enrich.js`
"omit the key entirely — but that's correct behavior under the fixed
rule (absent → preserve prior), not a gap requiring special-casing." That
was an inference from the shape of the omission, not a proof against the
actual control flow — and the line ordering directly contradicts the
premise: `confirmedVariant` (`:5348`) is computed before both returns
(`:5911`, `:7394`, pre-Directive-R line numbers), so "no new information
this request" could not simply be assumed.

### Task 1 — trace, per return

**Return `api/enrich.js:5911` (pre-R), the refused-identity exit
(`if (identityRefused) { ... return res.status(200).json(finalizeResponse(refusedOut)); }`).**
`identityRefused` is set at two sites (`:2896`, `:4680`), both well before
`confirmedVariant`'s declaration — the `if (identityRefused)` branch
itself doesn't gate anything until `:5701`, so every line of
`confirmedVariant`'s write chain (`:5348` init through `:5616`) executes
unconditionally regardless of which path this request eventually takes.
By the time execution reaches `:5911`, `confirmedVariant` holds its fully
resolved value — string or `null`, with no separate "unknown" state of
its own (traced directly: every write site assigns either a real value
or explicitly falls back to `null`, never leaves it `undefined`).
`confirmedVariant === null` at this point IS the resolved verdict, not
an ambiguous absence — this is the exact scenario the directive's
verdict (C) worried about (`variantConfidence`/`variantStatus` don't
exist anywhere, confirmed in Directive Q's own trace), but it doesn't
apply here because `confirmedVariant` was never ambiguous to begin
with — only the CLIENT's undefined/null conflation (fixed by Directive
Q) was.

The gap: `refusedOut` (this exit's own, separately-built response
object) is constructed as `{ ...sanitizeIdentityFields(req.body), ... }`
plus ~80 lines of explicit fields — read in full. `sanitizeIdentityFields`
(`src/lib/identityGate.js:110-191`) returns exactly `{ title, issue, year,
publisher, author, visionConfidence }` — no `variant` field exists in
that function's output shape at all, structurally. The explicit field
list that follows carefully treats every other identity-adjacent field
(`year`/`publisher` get real fallback treatment; `comps`/`comicVine`/
`priceCharting` get explicit `null`s; even the `isProvisionalFamilyIdentity`
override block gets `title`/`issue`/`year`/`publisher`) — variant is
absent from all of it, not even an explicit `null`. Given how
deliberately every other field here was handled (the object's own
comments cite Q131, Track B Commit 4.3, and I13 by name for other
fields), this reads as an asymmetric gap, not a considered design
choice. **VERDICT: (B), live defect.**

**Return `api/enrich.js:7394` (pre-R), the Q32 merchandise hard gate
(`if (out.assetType === 'merchandise') { ... return res.json(finalizeResponse(out)); }`).**
Returns `out` directly, not a separate object. `out.variantNote`'s three
real write sites — the two `isFromPC`-gated assignments and the Q135
universal fallback — all sit later in the file than this return (verified
by direct read: none appear before `:7394`), so `out.variantNote` is
genuinely `undefined` at this exit, for any request that reaches it.
`confirmedVariant` itself is unconditionally computed by `:5348` same as
above, regardless of `assetType`. **VERDICT: (B), live defect.**

**Known production shape check.** The directive named the 21:12 Sabrina
scan ("ended `ID_REQUIRED` with variant cleared by `[commit4.3]`") as a
suspected real-world hit on these paths. Checked directly: `ID_REQUIRED`
is a `decision.action` value, computed by `out.decision =
computeDecision(out, {...})` at `api/enrich.js:11095` (post-R line
numbers) — hundreds of lines AFTER both early returns and after the Q135
fallback (`~10862`). A scan that "ended `ID_REQUIRED`" completed the
FULL pipeline; it did not hit either of these two branches. That specific
scan is evidence for the NORMAL-path reachability Directive Q already
fixed, not for these two paths — named here so a future audit doesn't
re-cite it as evidence for the wrong mechanism. No production log
evidence of an actual hit on either `:5911` or `:7394` was found or
searched for beyond this check (out of scope — both are proven (B) on
the control-flow trace alone, which doesn't require a production
sighting to act on).

### Task 2 — fix and tests

Both fixed identically, reproducing the Q135 completion-path contract
exactly at each exit:

```js
if (X.variantNote === undefined) {
  X.variantNote = confirmedVariant || null;
}
```

— `X` is `refusedOut` at the refused-identity exit, `out` at the
merchandise-gate exit. The `=== undefined` guard is the non-clobber
proof itself: nothing currently sets either field before these points
(confirmed in Task 1), but the guard means a future write earlier in
either path would survive untouched rather than being silently
overwritten by this addition.

`tests/grailkey-directive-r-early-return-variant.test.js` (19
assertions) — the full `api/enrich.js` handler cannot be invoked
directly without mocking its entire eBay/PriceCharting/ComicVine
dependency graph, a different order of effort than this narrow fix
warrants. Labeled **MIRRORED**, honestly: the test extracts the two
real, just-committed guard statements from source via regex (Part 1
confirms they exist verbatim, in the right position relative to their
returns) and evaluates them with real JS semantics (`new Function`)
against constructed inputs (Part 2a) — the same "extract and evaluate
the actual code" discipline as Directive Q's own test, just not a full
HTTP round-trip. Proves: a stale-prior-plus-fresh-revocation state
reaches `variantNote: null` as an own-property (not omitted) at both
sites; a real confirmed value passes through; an already-established
value is not clobbered. Part 2b chains this dispatch's server-side proof
to Directive Q's own already-proven client merge (re-extracted from the
current source, not re-asserted) and Directive P's unchanged render
guards, proving the full path end to end: server revocation →
`variantNote: null` → client merge → `variant: null` → no confirmed
`Variant:` label renders — the exact render assertion Directive Q
required but never demonstrated end to end.

### Task 3 — record corrections

Folded into Directive Q's own entries above (CLAUDE.md and this file)
rather than left as separate errata: (a) merge-boundary count corrected
to "8 audited entries / 7 defective" (was ambiguously "all 7" in a way
that dropped `mergeConfirmedIdentity` from the total); (b) the false "all
7 fixed to genuine presence-awareness" claim corrected — six `App.jsx`
sites are presence-aware (absent → preserve prior), `manualCorrection.js`'s
one site is not and should not be (absent → `null`, no prior exists
there to preserve, by design); (c) a stale "20/20" reference for
Directive P's test (already repaired to 19/19 within Directive Q's own
commit) corrected where it was left standing elsewhere in CLAUDE.md.

### Regression

`grailkey-dispatch-19-fix5-asset-type-override` (13),
`q141c-marketplace-category-rejection` (47), `pipeline-audit` (38),
`q110-intake-nonblocking` (38), `q131-systemic-audit-fixes` (18) — every
test file referencing `refusedOut`/the Q32 merchandise gate — plus
`q140-issue-consensus-corrective` (124, the Flash #139 regression guard,
re-run on principle since `api/enrich.js` was touched) — re-run directly,
byte-identical, 0 new failures. `npm run build` clean. Test baseline
re-stamped: 169/16/3/188 → 170/16/3/189 (one new file, 19/19 clean).

### Handoff

Both early-return paths proved (B), both fixed with the exact Q135
contract, both tested (merge outcomes AND the full render chain).
**Neither is (C) — no ambiguous authority state found.** Pushed and
deployed. The Sabrina rescan is genuinely cleared this time — both the
client-side custody (Directive Q) and the server-side response-shape
gap (this dispatch) that could each independently have caused stale-
variant resurrection are now closed and tested end to end.

## GrailKey Directive 2026-08-14-T — picker foundation (GK-85/86/87)

Directive S's own trace stopped at a STOP GATE it discovered, not
re-derived here: three gaps (GK-85, GK-86, GK-87) that would have made
building a candidate picker on top of them "produce a correction that
silently reverts." T closes all three, with GK-85 reframed correctly per
Jimmy's own instruction: it is a live defect in the ALREADY-SHIPPED
manual-correction feature, not picker-specific plumbing — manual
correction has never held durably against a subsequent automatic rescan.

### Task 1 — GK-84 corrected, registry committed first

`UploadSiteHostedPictures` specifically decommissions 2026-09-30 (Media
API `createImageFromFile`/`createImageFromUrl` is the migration target);
`AddFixedPriceItem`/`GetItem`/`EndItem` have no announced Trading-API-wide
sunset. Implementation target 2026-09-01. Committed and pushed
(`d58a697`) before any code changed, per the directive's own ordering.

### Task 2 (GK-86) — one normalized `imageUrl` field

`extractIdentityFromImageSearch`'s parsed row shape
(`src/lib/imageSearchIdentity.js:402-423`) gained exactly one field:
`imageUrl: it?.image?.imageUrl ?? it?.thumbnailImages?.[0]?.imageUrl ?? null`.
Checked all 8 files importing this function for exact-shape/deep-equal
assertions that an added key could break — none found; every consumer
reads via field access or destructuring. `tests/grailkey-directive-t-
task2-imageurl.test.js` (12 assertions) proves the pre-fix absence
directly against `git show d58a697:...` and the post-fix presence via
real import — both the `image.imageUrl` and `thumbnailImages[0].imageUrl`
shapes, plus the no-image case (null, not a crash).

### Task 3 (GK-85) — per-field `identityAuthority`, the live-defect fix

**The mechanism.** `identityAuthority: { [facet]: 'OPERATOR_CONFIRMED' }`,
governed by the identical presence-aware discipline Directive Q already
established for identity VALUES: `mergeIdentityAuthority` (new export,
`src/lib/dataQualityGuard.js`) treats a facet absent from
`enrich.identityAuthority` as "preserve whatever `prior` already held,"
a facet present with a value as "replace," and a facet present with an
explicit `null` as "clear that facet's lock" (own-property deleted, not
set to null — verified directly in the test). Never `||`/`??` at the
whole-object level, per the directive's own governing invariant — either
would have reproduced exactly the Stale Authority Inheritance class this
whole campaign (GK-73, GK-80, Directives H/Q/R) keeps finding in this
merge layer.

**`mergeConfirmedIdentity` is the single choke point.** It is the merge
function spread at 5 of `App.jsx`'s identity-writing call sites
(`captureAndGrade`, `gradeBlob`'s scan→catalogue and scan→selectedItem
siblings, `handleBulkImport`, `refreshMarketData`) — fixing it once
fixes all 5 for free, since every call site just spreads its return.
Per-field, not per-item: `pick(field, enrichField)` returns `prior[field]`
when `authority[field] === 'OPERATOR_CONFIRMED'`, otherwise falls through
to the existing presence-aware accept-or-preserve logic unchanged. The
acceptance test this design choice hinges on (title/issue locked, year
unresolved, a fresh automatic response conflicts on title/issue but
supplies a genuinely new year): title and issue survive; year is
accepted. A whole-item lock would have blocked year too — strictly
WORSE than today's behavior for a partial correction, the reason
Directive T's own text named for choosing per-field over per-item.

**Server side.** `api/enrich.js`'s existing `if (manualCorrectionRequest?.valid)`
block (the same block that already writes the write-only
`out.manualCorrection` historical record) now ALSO sets
`out.identityAuthority = Object.fromEntries(validation.acceptedFields.map(f
=> [f, 'OPERATOR_CONFIRMED']))` — only the fields the operator actually
corrected THIS request get locked; anything left uncorrected stays
fillable by future automatic resolution. `out.manualCorrection` itself
is untouched — deliberately NOT repurposed as the authority carrier, per
the directive's explicit instruction (conflating a write-only audit
record with an authority gate would have made neither reliable).

**`buildCorrectedCatalogueItem`'s own custody gap, found while wiring
this in.** `identityAuthority` is correctly NOT added to
`IDENTITY_DEPENDENT_FIELDS_TO_CLEAR` (a correction to one facet must not
wipe a DIFFERENT facet's lock from an earlier correction) — but that
means the raw `{...cleared, ...enrichData}` spread would otherwise
WHOLESALE REPLACE the whole map with only this correction's newly-locked
field(s), silently dropping every other previously-locked facet. Fixed
with an explicit `merged.identityAuthority =
mergeIdentityAuthority(enrichData, oldItem);` line, same shape as
Directive Q's own `merged.variant` fix at this exact function for the
same underlying reason (a raw spread is not a merge).

**Tests** (`tests/grailkey-directive-t-task3-identity-authority.test.js`,
18 assertions, all DIRECT real function calls — these are pure,
independently importable functions): the acceptance case; a manual
correction surviving a later, unrelated automatic enrich end to end;
the carrier's own absent-preserves and present-null-clears behavior;
and a full reload-durability proof through `buildCorrectedCatalogueItem`
itself — an earlier correction's lock (issue) and a new correction's
lock (title) both surviving together, then a SUBSEQUENT simulated
automatic rescan still failing to override either.

**Regression:** `q-trackB-commit3-manual-correction` (466),
`q-trackB-commit4-adoption-provisional` (152),
`grailkey-directive-h-item1-stale-pc-anchor` (6),
`q140-issue-consensus-corrective` (124, byte-identical as required) —
all re-run directly, 0 new failures.

### Task 4 — `variant` joins the correction path

`MANUAL_CORRECTION_ALLOWED_FIELDS` grew from 4 to 5 fields (the ONE
addition the directive authorized, not a general widening) — threaded
through a new `normalizeManualVariant` (trim, empty→null, same shape as
title/publisher — no numeric/date format to validate, unlike issue/year),
`NORMALIZERS`, `normalizeFieldValue`, `validateManualAuthority`'s
`fieldValues` destructure, `prepareManualCorrectionRequest`'s
`workingIdentity` object, and `buildManualCorrectionPayload` (both the
outgoing `variant` field and the `priorIdentity.variant` snapshot).
Server side: `confirmedVariant`'s init (`api/enrich.js:5348` area) now
checks whether a valid manual correction accepted `variant` and, if so,
seeds directly from `manualCorrectionRequest.workingIdentity.variant` —
bypassing `safeVariantForConfirmed` (Vision's printing-claim-filtered
read) entirely, the same treatment `effectiveTitle`/`Issue`/`Year`/
`Publisher` already get at `~2404-2407`. Later `confirmedVariant`
rewrites (CGC-cert, eBay-image-consensus, edition-warning-printing,
canonical-projection-residue) are reasoned, not exhaustively re-verified,
to be structurally unable to fire on a manual-correction request — each
depends on data (Vision's read, image-search results) that
`skipVision`/`skipImageSearch` already prevent from existing at all on
this request shape. Flagged as inferred-safe-by-construction, not
independently proven line-by-line for every one of those ~5 sites.

**One pre-existing test broke as a direct, anticipated consequence** —
`q-trackB-commit3-manual-correction.test.js`'s own exact-array sanity
check (`MANUAL_CORRECTION_ALLOWED_FIELDS` == exactly 4 fields) — updated
to expect 5, still 466/466 clean. Not a regression; the premise
intentionally changed.

**Tests:** `tests/grailkey-directive-t-task4-variant-correction.test.js`
(16 assertions, DIRECT) — the allow-list itself, `validateManualAuthority`
accepting a variant correction while still rejecting an unrelated
unlisted field (proving the widening is exactly one field, not
open-ended), `workingIdentity.variant` in both the corrected-this-request
and Safeguard-2-parity (present-but-not-corrected) cases,
`buildManualCorrectionPayload`, and `getCorrectableFields` (already
generic, confirmed to need no code change).

### Task 5 (GK-87, correction-flow scope) — revision token

**Scope, stated precisely, not overstated.** S found TWO race gaps: the
persisted catalogue write is unconditional by explicit design, and even
where the ownership guard IS wired (`gradeBlob`'s transient `setResult`
sites), `CURRENT_SCAN_OWNERSHIP_MODE = SHADOW` means it never blocks
anything in production. The directive's explicit non-goal forbids a
global SHADOW→ENFORCE flip. This dispatch wires the CORRECTION flow
specifically into the existing primitives (`src/lib/scanOwnership.js` —
`mintScanId`, `nextGeneration`, `applyScanOwnershipGuard`, all reused
verbatim, no new mechanism invented), narrowly ENFORCE-gated at exactly
one new call site: `submitManualCorrection` mints a fresh `{scanId,
generation}` and updates the SAME shared `activeScanRef`/
`scanGenerationRef` refs `gradeBlob` already closes over (both are
`useCallback`s in the same component — no new plumbing needed to share
them). Starting a correction therefore immediately supersedes any older
in-flight `gradeBlob` closure's ownership identity. The correction's own
response is gated: `applyScanOwnershipGuard('correction', enrichData,
correctionOwnership, activeScanRef.current, SCAN_OWNERSHIP_MODE.ENFORCE,
() => {...})` — the write callback only runs if nothing newer has begun
since; otherwise `submitManualCorrection` throws rather than silently
no-oping.

**What this does NOT cover, deliberately, logged against GK-87 (not
re-opened as a new ticket — the same finding, now partially resolved):**
`gradeBlob`'s own PRE-EXISTING automatic-scan persisted-write path (the
`setCatalogue` updater inside its `.then((enrich) => {...})` block) still
has no generation check of its own — a stale automatic response can
still write there. Deferred, not fixed: it is a separate, larger, riskier
change to a different, already-live, heavily-used code path, and
critically, **Task 3's per-field `identityAuthority` check already
protects the specific class of bug this whole campaign has been
chasing** (an operator-locked identity FACET surviving a stale automatic
overwrite) on that exact path, independent of race timing — because
`mergeConfirmedIdentity` reads whatever `cur`/`prior` state is freshest
at the moment its own `setCatalogue` callback actually executes,
regardless of which response arrived first. The remaining exposure on
that path is for UN-locked fields (price, comps, etc.), not identity
authority. A real, correctly-scoped remaining gap — not hand-waved away,
named precisely in the registry for a future dispatch to close with its
own dedicated pass.

**Tests** (`tests/grailkey-directive-t-task5-revision-token.test.js`, 15
assertions): Part 1 DIRECT (`buildManualCorrectionPayload` threading
`scanId`). Parts 2-3 DIRECT, using the real, already-independently-tested
`scanOwnership.js` primitives (not re-testing them, `slice7-scan-
ownership.test.js` already does) in the exact shape
`submitManualCorrection` now calls them — a stale correction superseded
by a newer operation is rejected (`scanid-mismatch`, checked before
generation per the file's own documented order) and its write callback
never runs; an un-superseded correction is accepted and its callback
does run. Part 4 MIRRORED, honestly labeled: a structural proof against
the real committed `App.jsx` source that `submitManualCorrection` is
actually wired to call this mechanism correctly (mints via the shared
refs, gates ENFORCE specifically — verified as a call-site argument, not
merely absent from prose — throws on rejection) — the function itself
isn't independently invocable outside the full React tree, the same
constraint every `App.jsx`-touching test in this repo works under.

### Regression, full dispatch

Every suite named per-task above, plus a full rebuild (`npm run build`
clean after every task), plus `q140-issue-consensus-corrective` re-run
directly and confirmed byte-identical (124/0) — the Flash #139 guard,
required unchanged by this dispatch's own non-goals, since none of
Tasks 1-5 touch issue consensus.

### Handoff

Test baseline re-stamped: 170/16/3/189 → 174/16/3/193 (four new files,
one repaired). **GK-84 CORRECTION (Directive U, 2026-08-14): the line
above ("GK-84 corrected and closed as a record-only ticket") was wrong.
The registry line was never actually set to CLOSED — it read OPEN in
`d58a697` and still does; only this prose overstated it. GK-84 remains
OPEN, migration NOT BUILT.** GK-85 CLOSED — the live defect is
fixed and tested. GK-86 CLOSED. GK-87 PARTIALLY ADDRESSED — correction-
flow scope closed, `gradeBlob`'s own automatic-scan persisted-write path
remains open, precisely scoped in the registry for a future dispatch.
Directive S's STOP GATE is cleared for the scope this dispatch closed;
S resumes at its own Task 2 (build the picker) next — its Task 1 trace
is not to be re-run, per this directive's own explicit instruction.

## GrailKey Directive 2026-08-14-U — corrective: stale automatic write

Two items. Reopen GK-84's false-closed claim. Close GK-87's remaining,
picker-required race scope.

### Task 1 — GK-84 was never actually closed

Directive T's own handoff prose (`docs/PATTERN-LIBRARY.md`'s Handoff
paragraph above, and this repo's own prior chat report) both said "GK-84
corrected and closed as a record-only ticket." That claim was checked
against the actual registry line, not assumed: `docs/TICKET-REGISTRY.md`
line 73 has read `STATUS: OPEN` continuously since it was first committed
(`d58a697`, Directive T's own Task 1) — the ticket was never set to
CLOSED anywhere in the registry itself. The false claim existed only in
prose (`docs/PATTERN-LIBRARY.md`'s Directive T Handoff paragraph), which
this dispatch's own preflight treated as registry state without checking
the actual line — the exact failure the "Directive preflight requirement"
protocol exists to prevent, caught this time because Directive U's own
preflight explicitly required checking real state rather than trusting
the directive text's premise.

Fixed both: the registry line now carries an explicit `STATUS CONFIRMED
OPEN` note naming the error and where it lived; the Pattern Library
Handoff paragraph above is corrected in place (not silently rewritten),
per this campaign's established correction convention (Directive Q/R
style — see those entries for the same pattern). Registry-only, committed
(`30d2e8b`) and pushed before any code changed, per the directive's own
ordering requirement.

### Task 2 — closing GK-87's picker-required race scope

**Why S is still blocked without this.** Directive T's Task 5 gated the
CORRECTION's own response (`submitManualCorrection`'s `applyScanOwnershipGuard`
call, ENFORCE-mode). It did not stop an OLDER `gradeBlob` (automatic
scan) response from arriving AFTER a correction begins and writing stale
state anyway — `gradeBlob`'s three write sites all used
`CURRENT_SCAN_OWNERSHIP_MODE` (SHADOW), which logs what would be rejected
but always still performs the write. The resulting shape — an
operator-confirmed identity next to a stale, contradicting evidence panel
— is structurally identical to the Bone-class defect this campaign has
spent many dispatches chasing, except here a picker feature would CREATE
it rather than merely fail to prevent it. GK-87's remaining scope was
therefore a genuine S prerequisite, not unrelated debt.

**Reachability, checked directly against real code before writing any
fix** (per the directive's explicit instruction not to repeat Directive
R's mistake of naming a suspected mechanism as evidence without
confirming it):

- **Auto-refresh** — NOT reachable. `src/App.jsx`'s auto-refresh effect
  contains `if (selectedItem) return;` as its second gate, unconditional.
  A correction can only ever operate on an item whose `CollectionDetail`
  is open (`submitManualCorrection`'s `item` argument comes from that
  view), which means `selectedItem` is non-null for the correction's
  entire duration — structurally excluding auto-refresh from firing at
  any point while a correction could be in flight, not merely unlikely to
  race with it.
- **Back-to-back corrections** — already protected, no gap. Each
  `submitManualCorrection` call re-mints `activeScanRef.current` at its
  own start (Directive T, Task 5); its own ENFORCE-gated guard (already
  shipped) already rejects a stale FIRST correction's response once a
  SECOND correction has begun. Confirmed by reading the function directly;
  covered by the existing `grailkey-directive-t-task5-revision-token.test.js`,
  not re-tested here.
- **`refreshMarketData`** — reachable, but as an INDEPENDENT race with
  both `gradeBlob` and corrections, through a wholly separate guard
  (`activeCardEnrichIdRef`/`cardEnrichAbortRef`, a single-slot
  last-call-wins mechanism, `src/App.jsx`) that has zero relationship to
  `activeScanRef`/`scanOwnership.js`. Neither `gradeBlob` nor
  `submitManualCorrection` register with or check
  `activeCardEnrichIdRef`, and `refreshMarketData` never touches
  `activeScanRef`. This is out of GK-87's specific scope (which is about
  `gradeBlob`'s `scanOwnership`-based persisted write) — wiring it in
  would be a new, unscoped mechanism change, exactly what this dispatch's
  non-goals forbid ("no new merge helper, no new ownership mechanism").
  Logged as **GK-88**, not fixed.
- **The scan-to-catalogue `.then()` chain** (`gradeBlob`'s own
  fire-and-forget `/api/enrich` continuation) — REACHABLE, and IS GK-87's
  documented remaining gap. `setLoading(false)` fires immediately after
  `/api/grade` resolves, well before `/api/enrich` resolves (PriceCharting
  scrape + eBay + ComicVine chains, no fixed short bound); `savedId` is
  already awaited and set before the enrich fetch fires, so the item
  exists and is open-able the moment the operator sees the result card.
  This is the scenario the fix targets.

**The fix.** `kind: 'scan' | 'correction'` tags the ownership object
minted by `gradeBlob` and `submitManualCorrection` respectively — the
same `{scanId, generation}` shape, one added field, not a parallel
mechanism. A new pure predicate, `wasSupersededByCorrection(closure,
active)` (`src/lib/scanOwnership.js`), returns true only when the
CURRENTLY active ownership is a correction that differs from the closure
that captured it. `gradeBlob`'s three write sites — grade-stage transient
`setResult`, enrich-stage transient `setResult`, and enrich-stage
persisted `setCatalogue`+`setSelectedItem` (gated as ONE unit inside a
single `applyScanOwnershipGuard` call, stage `'enrich-persist'`, never
split so neither can be selectively applied while the other is rejected)
— each compute their `applyScanOwnershipGuard` mode dynamically:

```
wasSupersededByCorrection(scanOwnership, activeScanRef.current)
  ? SCAN_OWNERSHIP_MODE.ENFORCE
  : CURRENT_SCAN_OWNERSHIP_MODE
```

Correction-caused staleness always rejects, regardless of the shared
constant. Every OTHER staleness cause — scan-vs-scan included — is
completely unaffected: it still evaluates `CURRENT_SCAN_OWNERSHIP_MODE`
(SHADOW) exactly as before this dispatch, because the directive's own
"no global SHADOW→ENFORCE flip" constraint is specifically about not
changing behavior for causes other than correction-supersession (that
flip needs a clean shadow-window read nobody has performed, and remains
out of scope). This was a deliberate design choice over the simpler
alternative of just enforcing on ANY staleness at these three sites:
that simpler version would have had the identical practical effect as
flipping the global constant (just locally instead of via the shared
export) for the scan-vs-scan case specifically, which the directive
explicitly prohibited pending validation.

**Rejection is logged.** `applyScanOwnershipGuard`'s existing
`logStaleScanResponse` call fires unconditionally on any non-accepted
verdict, with `mode` recorded — a correction-caused ENFORCE rejection logs
`mode=enforce ... rejected`, distinguishable in production logs from a
SHADOW-mode `mode=shadow ... observed` line for every other cause. No new
logging mechanism needed.

### Tests

`tests/grailkey-directive-u-task2-stale-automatic-write.test.js`, 33
assertions, 0 failed:
- **Part 0 (DIRECT)** — the pre-fix vulnerability reproduced against the
  REAL, unchanged `CURRENT_SCAN_OWNERSHIP_MODE` constant and the real
  `applyScanOwnershipGuard` function (neither touched by this dispatch),
  proving that a static, non-dynamic mode argument — exactly what all
  three sites used before this dispatch — writes a correction-superseded
  stale response through anyway. Cross-checked against real git history:
  `git show 1627d06:src/App.jsx` confirms the pre-fix source had exactly
  2 `applyScanOwnershipGuard` calls in `gradeBlob` (both transient) and
  NO guard at all around the persisted `setCatalogue`/`setSelectedItem`
  write.
- **Part 1 (DIRECT)** — `wasSupersededByCorrection`'s predicate logic
  against 5 cases (different correction, different scan, same closure,
  null active, structurally-equal-but-different-reference active).
- **Part 2 (DIRECT)** — the exact dynamic-mode expression gradeBlob's
  write sites use, exercised against the real functions: Scenario A
  (correction supersedes — zero transient write, zero persisted write,
  corrected state stays authoritative, matching the directive's own
  GIVEN/WHEN/THEN); Scenario B, a required control — superseded by
  ANOTHER SCAN, not a correction, still writes through under SHADOW,
  proving no global flip occurred; Scenario C, the directive's own
  required control — a non-superseded response still writes normally.
- **Part 3 (DIRECT)** — console.log capture proving the rejection is
  observably logged, with the correct mode and reason recorded.
- **Part 4 (MIRRORED)** — structural proof against the real committed
  `src/App.jsx` source that all three call sites actually use the pattern
  (gradeBlob isn't independently invocable outside the full React tree,
  same constraint every App.jsx-touching test in this repo works under,
  same labeling discipline Directive T's Task 5 test established), plus
  confirmation that `setCatalogue`/`setSelectedItem` share exactly one
  `applyScanOwnershipGuard` call (never two independent guards).

### Regression

Every suite referencing `scanOwnership` or `App.jsx` (35 files) run
individually and directly, not sampled: `grailkey-directive-t-task5-revision-token`
(15/0), `grailkey-directive-t-task3-identity-authority` (18/0),
`grailkey-directive-t-task4-variant-correction` (16/0),
`grailkey-directive-t-task2-imageurl` (12/0),
`q-trackB-commit3-manual-correction` (466/0),
`grailkey-directive-r-early-return-variant` (19/0),
`slice7-scan-ownership` (15/0), `q-trackB-commit4-adoption-provisional`
(152/0), `grailkey-directive-h-item1-stale-pc-anchor` (6/0),
`pipeline-audit-merge` (17/0), `merge-site-parity` (26/0),
`q110-intake-nonblocking` (38/0), `q144c-confirmed-identity-merge`
(44/0), `q145-contract-decision-sync` (41/0), `response-contract` (73/0),
`q135-p1-p2-p3-fixes` (34/0), `q-flashgordon13-badge-accuracy` (12/0),
`q140-issue-consensus-corrective` (124/0, byte-identical as required),
`grailkey-dispatch-g-task2-pc-anchor-authority`,
`grailkey-dispatch-50-gk67-display-truth`,
`grailkey-dispatch-e-task3-source-labels`,
`grailkey-dispatch-e-task2-asset-confirmation-badge`,
`grailkey-dispatch-50-gk66-ladder-authority-removed`,
`grailkey-dispatch-47-gk39a-remove-fabricated-confidence`,
`dispatch-42-comicvine-kill` (27/0 — TIMEOUT under a short per-file
cutoff, clean under a longer one, the same known sweep-harness artifact
CLAUDE.md already documents for this exact file),
`grailkey-dispatch-30-gk41-non-comic-gate`, `grailkey-commit-t`,
`grailkey-commit-r`, `grailkey-commit-q`, `grailkey-commit-p`,
`grailkey-commit-p2`, `grailkey-commit-c-collection-header` — all clean.

Three suites failed, and EACH was individually verified via `git stash`/
`git diff` comparison to be pre-existing and unrelated to this dispatch's
changes (identical failure reproduces with `src/App.jsx`/
`src/lib/scanOwnership.js` stashed back to the exact pre-Directive-U
state) — not silently absorbed into "0 new regressions," each logged as
its own ticket per the directive's "if you find another defect, log it
OPEN with a written trigger and move on" instruction:

- **GK-89** — `grailkey-directive-q-variant-null-custody` Part 1b crashes
  (not fails) via an unhandled `git stash pop` error whenever
  `src/lib/manualCorrection.js` has zero uncommitted diff at run time
  (its own internal `git stash push`/`pop` dance assumes the file is
  always dirty when the test runs — true only immediately after a
  dispatch that just edited it). `git diff 1627d06 --
  src/lib/manualCorrection.js` is byte-empty, proving this reproduces
  identically at pure pre-Directive-U HEAD.
- **GK-90** — `grailkey-directive-p-task3-variant-on-card` Part 3's
  "`mergeConfirmedIdentity` variant merge unchanged" scope-check now
  fails, because Directive T's Task 3 (GK-85) genuinely DID change that
  function (added the `identityAuthority`-aware `pick()` helper) — a real,
  intended change this test's stale scope-check was never updated to
  account for. Confirmed pre-existing via the same stash comparison.

Separately, not new tickets: `grailkey-commit-e`/`-f`/`-g` all failed
their own "only `src/App.jsx` changed" scope-check during this sweep,
exactly as CLAUDE.md's already-documented "reads live `git diff
--name-only HEAD`" defect class predicts whenever other uncommitted
changes are present (this dispatch's own working tree, at sweep time) —
observed reproducing exactly as documented, not a new finding.
- **GK-91** — `grailkey-directive-j-gk79a-relabel` Part 1 fails
  permanently by construction: it calls `git show HEAD:src/App.jsx`
  (the literal string `'HEAD'`, not a pinned pre-fix SHA) to prove the
  OLD "Condition confidence" text once existed — this could only ever
  pass while `HEAD` still pointed at a pre-fix commit, and this repo has
  advanced many commits past the actual fix (`1d827e7`) since. Confirmed
  pre-existing via the same stash comparison.

None of the three trace to this dispatch's `src/App.jsx`/
`src/lib/scanOwnership.js` changes — all three are either state-dependent
harness fragility (GK-89) or genuinely stale assertions from EARLIER
dispatches that this sweep happened to be the first to re-run since the
change that broke them landed (GK-90, GK-91). Test baseline re-stamped
accordingly: 174/16/3/193 → 172/19/3/194 (+1 new file counted PASS, -3
previously-uncounted fails moved from the implicit PASS bucket into FAIL,
net PASS -3+1, FAIL +3, total +1).

### Handoff

GK-84: reopened (was never actually closed — corrected). GK-87: CLOSED
for the picker-required race scope; `identityAuthority` (GK-85) plus this
dispatch's `wasSupersededByCorrection` guard together mean neither a
locked identity facet NOR an unlocked evidence field can be silently
overwritten by a stale automatic response once a correction has begun.
GK-88/89/90/91 logged, not fixed, explicitly out of this dispatch's
two-task scope. **GK-92 also logged**: `CLAUDE.md` measured at 148,847
chars after this dispatch's own required edits — within ~1,150 chars of
the standing 150,000-char P0 load limit, flagged urgently rather than
left for the next dispatch to discover after crossing it. Directive S's
STOP GATE is now fully closed (all of GK-85/86/87 addressed) — S resumes
at its own Task 2 (build the picker) next, per this directive's own
closing instruction. Do not propose the next directive.

## GrailKey Directive 2026-08-14-V — ownership perimeter

**S REMAINS BLOCKED** at the start of this dispatch (GK-88 open). Mode:
enumerate first, guard second.

### Compaction gate

`CLAUDE.md` measured 148,847 chars at preflight — within ~1,150 of the
150,000-char P0 load limit (GK-92). Compacted BEFORE Task 1, per the
directive's own explicit instruction, docs-only commit (`8d8af44`): the
Pattern Library dispatch-index section (was 64,116 of 148,847 chars, 43%
of the file) compressed to name + one-clause result + pointer per entry,
since every entry already has a full writeup in this file (verified by
direct grep, dispatch by dispatch, before touching anything — nothing
lost). Every named standing invariant preserved so it stays greppable.
Doctrine, rules, the test baseline, Open Blockers, and Handoff Pointers
verified byte-identical before/after via direct diff on both the
untouched head and tail of the file. 148,847 → 98,875 chars (-34%).

**Self-correction during this same compaction pass**: the first attempt
at re-stamping the test baseline line accidentally deleted its own
"Standing rule: any dispatch that adds or removes a `tests/*.test.js`
file must re-stamp this line in the same commit" sentence while
trimming it for length — caught before commit and restored. Recorded
here as a caution for future compaction passes: trimming doctrine text
down to "just the facts" can silently drop the RULE embedded inside a
fact-heavy paragraph if it isn't checked for after the edit.

### Task 1 — the async writer table

Full trace, not by function name — by tracing every `setCatalogue`/
`setSelectedItem`/`putComic` call site in `src/App.jsx` back to its
enclosing async producer (per the directive's own instruction: "A
perimeter enumerated by function name will miss a wrapper").

| producer | async boundary | state written | target item/key | ownership mechanism (before this dispatch) | can finish after correction begins? | same-item overlap possible? | superseded today (pre-fix)? | atomic write group |
|---|---|---|---|---|---|---|---|---|
| `gradeBlob` | `/api/grade` then fire-and-forget `/api/enrich` | full identity + pricing + comps + evidence | new item (savedId, known only after `addToCatalogue`) | `scanOwnership`/`activeScanRef` (Directive U) | YES | YES (item-BLIND pre-fix — see finding below) | YES, but item-blind (would wrongly reject/accept for wrong item) | setResult (×2, transient) + setCatalogue+setSelectedItem (persisted, 1 unit) |
| `submitManualCorrection` | `/api/enrich` | full identity + pricing + comps + evidence, `identityAuthority` | existing item, known immediately | `correctionOwnership`/`activeScanRef` ENFORCE (Directive T) | N/A (this IS the correction) | N/A | N/A | putComic+setCatalogue+setSelectedItem, 1 unit |
| `refreshMarketData` | `/api/enrich` | pricing + comps + evidence (not identity) + duplicate-sync to title/issue/year-matched items | existing item + any duplicate-matched items | `activeCardEnrichIdRef` only (self-consistency, zero relation to `activeScanRef`) | YES | YES | **NO — unguarded** (GK-88 original finding) | putComic+setCatalogue(primary+dup-sync)+setSelectedItem, 1 unit |
| `reIdentifyBook` | `/api/grade` then `/api/enrich` (sequential) | full identity + pricing + comps + evidence | existing item, known immediately | none | YES | YES | **NO — unguarded** | putComic+setCatalogue+setSelectedItem, 1 unit |
| `addPhotoToComic` | `/api/grade` | full identity + pricing + evidence | existing item, known immediately | none | YES | YES | **NO — unguarded** | putComic+setCatalogue+setSelectedItem, 1 unit (2 branches: normal + quota-fallback) |
| duplicate-confirm ("Save Another Copy", inline JSX handler) | fire-and-forget `/api/enrich` | full pricing + comps + evidence (title/issue/year already fixed at creation) | new item (savedId, known after `addToCatalogue`) | none | YES | YES (low-frequency — brand-new item) | **NO — unguarded** | setCatalogue, 1 unit |
| `handleBulkImport`'s `processFile` (×`CONCURRENCY=3` workers) | fire-and-forget `/api/enrich` per file | full pricing + comps + evidence | new item per file (savedId, known after `addToCatalogue`) | in-flight dedup `Set` only (prevents duplicate SAME-book races, not staleness) | YES | YES, but MULTIPLE items concurrently by design | **NO — unguarded, and NOT fixed this dispatch** (see reasoning below) | setCatalogue, 1 unit, per file |
| auto-refresh (`useEffect` queue, `MAX_CONCURRENT=2`) | fire-and-forget `/api/enrich` per stale item | pricing + comps + evidence (not identity) | multiple existing items in the "missing source" queue | `AbortController` per fetch, all aborted on `selectedItem` change | **NO — proven unreachable** | N/A (structurally excluded) | N/A | setCatalogue per item |
| `listOnEbay` | `/api/list-ebay` | `status`/`ebayUrl`/`ebayItemId`/`listedAt` (spreads STALE closed-over `item`, not fresh state) | existing item, known immediately | none | YES | YES | **NO — unguarded, different defect shape (GK-94)** | putComic+setCatalogue+setSelectedItem, 1 unit |
| `syncEbayStatus` | `/api/list-ebay` (status check) | `status`/`soldPrice`/`soldAt`/`endedAt` (same stale-closure pattern) | existing item, known immediately | none | YES | YES | **NO — unguarded, GK-94** | putComic+setCatalogue+setSelectedItem, 1 unit |
| `listBundleOnEbay` | `/api/list-ebay` (bundle) | `status`/`ebayUrl`/`ebayItemId`/`bundleId` ONLY, via a fresh `prev.map` read (NOT a stale closure) | multiple existing items | none | YES | YES | Confirmed SAFE already — fresh-read base means no collateral identity/pricing overwrite; only listing-status fields, out of this invariant's stated scope | setCatalogue, 1 unit |
| `updateComicField` | none (synchronous; `putComic` is fire-and-forget, no state write depends on it) | single field (e.g. list price) | existing item | N/A — no async window before the state write | N/A | N/A | Confirmed NOT REACHABLE | N/A |
| `handleImport` (JSON collection restore) | `file.text()`/`JSON.parse` (no network) | new/pre-existing ids, full collection restore | many, brand-new or explicit-id | none | technically yes, but page reloads immediately after (`window.location.reload()`) | N/A | Confirmed NOT REACHABLE in practice | N/A |
| `createTradePile` / trade-pile delete handler | none (synchronous, `putComic` per item awaited inline) | `inTradePile`/`tradePileId`/`tradeValue` only | multiple existing items | N/A — no network round-trip | N/A | N/A | Confirmed NOT REACHABLE | N/A |
| `refreshAnalysis` | `/api/manage` | `analysis` (a SEPARATE collection-wide object, no per-item identity/pricing/comp/evidence state) | none (not per-item) | none | N/A | N/A | Out of scope — different state entirely | N/A |

**Reachability, with evidence, not inference:**

- **Auto-refresh — NOT reachable.** Confirmed by direct read of the
  effect's cleanup and dependency array (`src/App.jsx`): `for (const c of
  autoRefreshAbortersRef.current) c.abort();` runs in the `useEffect`
  cleanup, and the effect's own dependency array includes `selectedItem`
  — meaning the cleanup fires and aborts every in-flight fetch the
  instant a card opens (any card, not just the one being corrected), well
  before a correction could begin. The gate condition `if (selectedItem)
  return;` additionally means the queue never even LAUNCHES while a card
  is open. Stronger than a rejection-based guard: the response never
  resolves at all.
- **`handleImport`, trade-pile functions, `updateComicField` — NOT
  reachable.** No real async network boundary exists between the
  operator's action and the state write (either fully synchronous, or
  the only "async" step is a local file read with no server round-trip).
- **`refreshAnalysis` — out of scope.** Writes a wholly separate
  collection-wide `analysis` object, never per-item identity/pricing/
  comp/evidence state.
- **`refreshMarketData`, `reIdentifyBook`, `addPhotoToComic`,
  duplicate-confirm — REACHABLE, and now guarded** (see Task 2).
- **`handleBulkImport`'s `processFile` — REACHABLE, deliberately NOT
  guarded this dispatch** — see the GK-88 registry entry for the full
  reasoning (concurrent multi-item producer, incompatible with the
  single-slot `activeScanRef` even with the itemId fix).
- **`listOnEbay`/`syncEbayStatus` — REACHABLE, a DIFFERENT defect shape
  (GK-94), not fixed this dispatch** (stale-closure collateral overwrite,
  not a missing-ownership-check gap — see registry).
- **`listBundleOnEbay` — REACHABLE but confirmed SAFE already**, checked
  directly: its `setCatalogue` updater spreads `{...x, status, ...}`
  where `x` comes from the live `prev` array (a fresh read), not the
  stale closed-over `items` argument — so even if superseded, it can
  never resurrect stale identity/pricing fields, and the fields it DOES
  write (`status`/`ebayUrl`/`ebayItemId`/`bundleId`) are out of this
  invariant's stated scope (identity/pricing/comp/evidence).

### The item-blindness finding (the central discovery of this dispatch)

Directive U's shipped `wasSupersededByCorrection` (commit `a734483`) had
NO item concept at all: `!!active && active.kind === 'correction' &&
active.scanId !== closure?.scanId`. This meant a correction on ANY comic
would supersede a stale `gradeBlob` write for ANY OTHER comic — a global
kill switch, not a guard, exactly the shape this directive's mandatory
cross-item control test exists to catch. Proven DIRECTLY against the
real `a734483` source (`tests/grailkey-directive-v-task2-ownership-
perimeter.test.js` Part 0): extracted the exact pre-fix predicate body
verbatim via `git show`, ran it against a genuine cross-item scenario
(item B's stale scan closure vs. item A's active correction), and
confirmed both that the predicate wrongly returns `true` and that the
real `applyScanOwnershipGuard` consequently drops item B's legitimate
write.

**Fix**: `itemId` added to the ownership objects — same `{scanId,
generation, kind}` shape, one more field, not a new mechanism.
`wasSupersededByCorrection` now additionally requires `closure.itemId ===
active.itemId` (both non-null) before rejecting. `gradeBlob`'s
`scanOwnership` starts `itemId: null` (the item doesn't exist yet before
`addToCatalogue` resolves) and is mutated to `savedId` once known — this
means the grade-stage transient write (fires before `savedId` exists)
is NEVER eligible for the correction-supersession special case, which is
the semantically correct answer: a scan preview for a not-yet-saved
comic cannot conflict with a correction on an already-saved one.
`submitManualCorrection`'s `correctionOwnership` carries `itemId:
item.id` from the start (always known).

Verified via the directive's own mandatory cross-item control (Part 2 of
the same test file): item B's async work in flight, a correction begins
for item A, item B's response still writes normally. Also verified the
inverse controls: same-item correction still rejects correctly (Part 1/3),
and scan-vs-scan staleness (not a correction at all) is completely
unaffected — no global SHADOW→ENFORCE flip anywhere.

### Task 2 — guards applied

`refreshMarketData`, `reIdentifyBook`, `addPhotoToComic`, and the
duplicate-confirm handler each mint their own ownership object at the
start of their async flow, using the exact same `mintScanId`/
`nextGeneration(scanGenerationRef)`/`activeScanRef` primitives every
other producer already uses — `itemId: item.id` (or `savedId` once known,
for the two new-item producers) set immediately, since (unlike
`gradeBlob`) these all operate on an item whose identity is known from
the start. Each threads `scanId` into its own outgoing request body (so
the server-echo verification stays meaningful, matching the established
pattern) and wraps its persisted write in `applyScanOwnershipGuard` with
the same dynamic-mode expression Directive U introduced:

```
wasSupersededByCorrection(ownership, activeScanRef.current)
  ? SCAN_OWNERSHIP_MODE.ENFORCE
  : CURRENT_SCAN_OWNERSHIP_MODE
```

**One superseded response = zero writes, preserved exactly**:
`refreshMarketData`'s guard wraps `putComic` + the primary `setCatalogue`
write + the duplicate-sync `setCatalogue` write + `setSelectedItem` as
ONE unit inside a single `applyScanOwnershipGuard` call — none of it
partially applies. `addPhotoToComic`'s supersession check runs ONCE,
before either of its two write branches (normal + quota-fallback), so a
superseded response can't fall through to the fallback branch either.
`reIdentifyBook` and the duplicate-confirm handler follow the same
one-unit discipline. `reIdentifyBook` and `addPhotoToComic` `throw` when
superseded (matching `submitManualCorrection`'s own established
convention) rather than silently returning, so their callers' existing
try/catch error-surfacing paths correctly report "didn't apply" instead
of silently treating a discarded response as success.

### Tests

`tests/grailkey-directive-v-task2-ownership-perimeter.test.js`, 36
assertions, 0 failed:
- **Part 0 (DIRECT)** — the pre-fix cross-item bug, reproduced against
  the real `a734483` source via `git show` (not retyped), proving both
  the predicate's wrong verdict and the real `applyScanOwnershipGuard`'s
  consequent dropped write.
- **Part 1 (DIRECT)** — the post-fix itemId-scoped predicate against 5
  cases (same-item correction, different-item correction, null closure
  itemId, null active itemId, same-item non-correction).
- **Part 2 (DIRECT)** — the MANDATORY cross-item control: item B's
  response still writes normally while item A's correction is active.
- **Part 3 (DIRECT)** — the directive's own required same-item
  GIVEN/WHEN/THEN shape (zero transient write, zero persisted write,
  corrected state stays authoritative, rejection logged) plus the
  required non-superseded control, run against the real shared mechanism.
- **Part 4 (MIRRORED)** — auto-refresh's `AbortController`+`selectedItem`
  protection reconfirmed unchanged in the real source.
- **Part 5 (MIRRORED)** — structural proof every one of the 4 newly-
  guarded sites, plus `gradeBlob`/`submitManualCorrection`'s itemId
  retrofit, is actually wired correctly in the real committed
  `src/App.jsx` — ownership minting, `scanId` threading, guard calls,
  and the throw-on-supersession convention, all checked by exact source
  substring, not assumed from the diff.

`tests/grailkey-directive-u-task2-stale-automatic-write.test.js` repaired
in the same commit — its own fixtures needed `itemId` added (same-item on
both sides) to keep exercising the same-item scenarios it was written to
test, since the bare predicate now requires it; two literal-string
assertions in Part 4 updated to match the real (intentionally changed)
object-literal text. Still 33/33, same scope as before, no assertion
removed.

### Regression

Every suite from Directive U's own regression list re-run directly:
35 `App.jsx`/`scanOwnership`-referencing files, `q-trackB-commit3-manual-
correction` (466/0), `q-trackB-commit4-adoption-provisional` (152/0),
`grailkey-directive-h-item1-stale-pc-anchor` (6/0), `slice7-scan-
ownership` (15/0), `q140-issue-consensus-corrective` (124/0, byte-
identical as required). All clean except the three already-logged,
already-diagnosed pre-existing failures (GK-89/90/91) — each re-confirmed
identical to their Directive U state, none new, none worsened.

### Handoff

GK-88: mostly closed, kept explicitly OPEN for `handleBulkImport`'s
concurrent worker pool (named, with its own trigger, not silently folded
into "done"). GK-92: closed (compaction). GK-93 (residual same-slot risk
between two different single-flow producers) and GK-94 (`listOnEbay`/
`syncEbayStatus` stale-closure risk) logged as new, distinctly-shaped
findings, not fixed. S's Task 2 remains blocked on GK-88's full closure,
per the directive's own explicit gate — the bulk-import gap, while
lower-frequency than the gap this dispatch closed, is real and
enumerated, not swept under a "mostly done" label.

## GrailKey Directive 2026-08-14-W — reachability only, no code

Investigation-only, requested twice (sent verbatim a second time; the
repeat was flagged, HEAD/registry state reconfirmed unchanged, and the
same answer stood without re-deriving it). Answered three questions
about whether V's two deferred findings (bulk import, GK-94) actually
block Directive S's Task 2, distinct from whether the *mechanism* V
identified could safely fix them.

**Q1 — bulk import same-item overlap: YES, reachable.** `addToCatalogue`
(`src/App.jsx:10583-10645`) calls `setCatalogue(...)` synchronously at
line 10643, before returning `savedId` — the item is selectable and
therefore correctable in the UI the instant that resolves, which is
*before* `processFile`'s own fire-and-forget `/api/enrich` for that same
item is even sent (`src/App.jsx:11354`), let alone before it resolves.
Confirmed as a genuine S blocker — but the reason V didn't fix it stands
independently: tracing what happens if `processFile` were naively wired
into the shared `activeScanRef` slot (same pattern as every other
guarded producer) shows a NEW failure mode — a second, unrelated bulk
worker touching the slot after a correction would silently erase that
correction's protection for a third item's stale response, a real
regression risk, not merely an inconvenience. Two separate facts, not
one: bulk import needs same-item protection (blocks S) AND the existing
single-slot mechanism cannot safely provide it (needs its own,
out-of-scope fix).

**Q2 — GK-94 same-item stale closure: YES, reachable.** `listOnEbay`
(`src/App.jsx:11747-11756` at the time) and `syncEbayStatus`
(`:11828-11845`) both spread the closed-over, pre-request `item` back
into catalogue state on write — a correction landing on the same item
mid-flight gets silently reverted the moment the listing/status response
resolves, with only the listing-status fields reflecting anything real.
Confirmed as a genuine S blocker, and — unlike bulk import — the fix
needs no new mechanism at all.

**Q3 — what those handlers actually need:** neither requires the whole
captured item for its WRITE (only for building the outgoing request,
which is unaffected). `listOnEbay` writes exactly
`status`/`ebayUrl`/`ebayItemId`/`listedAt`; `syncEbayStatus` writes
`status` plus conditional sold/ended fields. `listBundleOnEbay`
(`:11778-11793`, same file) already does the safe version of this exact
write — read fresh `x` from `prev`, merge only the mutated fields — so
the fix is applying an existing, proven-safe pattern to two more sites,
not designing something new.

**Revised S blocker list**: both bulk import and GK-94 confirmed
blocking, for different reasons — bulk import needs a mechanism that
doesn't exist yet (deferred, GK-88 stays open for it specifically);
GK-94 needs no new mechanism (closeable immediately). Registry edits
were proposed in the report only, per the directive's explicit
constraint — not applied in this dispatch. Directive X (below) applies
the GK-94 half.

## GrailKey Directive 2026-08-14-X — GK-94 CLOSED

Straight implementation of the fix Directive W's Q3 already specified:
no redesign, no new mechanism, no ownership tokens — a closure fix.

**`listOnEbay`** (`src/App.jsx`) — was:
```js
const updated = { ...item, status: "listed", ebayUrl: data.listingUrl,
  ebayItemId: data.listingId || null, listedAt: Date.now() };
await putComic(updated);
setCatalogue((prev) => prev.map((x) => (x.id === item.id ? normalizeItem(updated) : x)));
setSelectedItem((cur) => (cur && cur.id === item.id ? normalizeItem(updated) : cur));
```
Now:
```js
const listedAt = Date.now();
const ebayUrl = data.listingUrl;
const ebayItemId = data.listingId || null;
setCatalogue((prev) => prev.map((x) => {
  if (x.id !== item.id) return x;
  const updated = { ...x, status: "listed", ebayUrl, ebayItemId, listedAt };
  putComic(updated).catch(() => {});
  return normalizeItem(updated);
}));
setSelectedItem((cur) => (cur && cur.id === item.id
  ? normalizeItem({ ...cur, status: "listed", ebayUrl, ebayItemId, listedAt })
  : cur));
```
The spread base moved from the closed-over `item` to the fresh `x`/`cur`
read at write time — matching `listBundleOnEbay`'s own pattern in this
file exactly, down to the fire-and-forget `putComic(...).catch(() => {})`
(was previously `await`ed before the state write; now consistent with
the reference implementation). `listOnEbay`'s reads (the outgoing
request body: `q41Override`/`title`/`publisher`/`year`/`grade`/
`keyIssue`/`price`/`priceLow`/`priceHigh`/`reason`/`coverPhoto`) are
untouched — this only changes the write.

**`syncEbayStatus`** — identical restructuring: the sold/ended
conditional field logic is unchanged in substance, just collected into a
`statusFields` object first, then merged onto fresh `x`/`cur` instead of
spread onto the closed-over `item`.

**"If the id no longer exists in catalogue at write time, write
nothing"** — satisfied by construction: `prev.map`'s `if (x.id !== item.id)
return x` branch means no match → the array returns unchanged and the
`putComic` call (inside the matched branch only) never fires.
`setSelectedItem`'s equivalent guard behaves the same way.

**`listBundleOnEbay` untouched** — not just unedited, verified
byte-identical: the test's Part 5 extracts the function body from both
`git show f39e392:src/App.jsx` (immediately pre-fix) and the current
source, normalizes CRLF/LF (the on-disk checkout is CRLF, git's stored
blob is LF — this normalization was necessary to get an accurate content
comparison, not just an EOL-noise "difference"), and asserts exact
string equality.

### Tests

`tests/grailkey-directive-x-gk94-stale-closure-listing.test.js`, 37
assertions, 0 failed:
- **Part 0 (DIRECT)** — the pre-fix defect, extracted verbatim via `git
  show f39e392:src/App.jsx` (both handlers' literal `...item,` spread
  confirmed present in the real historical source, not asserted from
  memory), then that exact re-derived merge logic run against a
  constructed same-item correction race — proves the stale title/
  variant/price are what actually get written, diverging from what the
  catalogue had already been corrected to.
- **Part 1/2 (DIRECT)** — the post-fix fresh-read merge for both
  handlers (including syncEbayStatus's sold AND ended branches),
  confirming the corrected identity survives and a value-by-value diff
  shows only the intended fields changed.
- **Part 3 (DIRECT)** — the required control: with no intervening
  correction, both handlers still write normally.
- **Part 4 (DIRECT)** — the explicit "id no longer exists" constraint:
  zero `putComic` calls, catalogue array returned unchanged.
- **Part 5 (MIRRORED)** — structural proof against the real committed
  source that both handlers are wired to the fresh-read pattern, plus
  the `listBundleOnEbay` byte-identical proof described above.

### Regression

Every suite from the standing App.jsx/scanOwnership regression list
re-run directly: `slice7-scan-ownership`, `q-trackB-commit3-manual-
correction` (466/0), `q-trackB-commit4-adoption-provisional` (152/0),
`grailkey-directive-h-item1-stale-pc-anchor` (6/0), `grailkey-directive-
v-task2-ownership-perimeter` (36/0), `grailkey-directive-u-task2-stale-
automatic-write` (33/0), `grailkey-directive-t-task5-revision-token`
(15/0), `q140-issue-consensus-corrective` (124/0, byte-identical as
required), plus the rest of the merge/contract-adjacent suites — all
clean. `grailkey-directive-p-task3-variant-on-card` (GK-90) reconfirmed
in its same known pre-existing failing state, untouched by this
dispatch (neither `dataQualityGuard.js` nor `mergeConfirmedIdentity` was
touched here). GK-89/91 unchanged.

### Handoff

GK-94: CLOSED. GK-88: untouched (explicit non-goal — "No GK-88 work"),
stays OPEN, bulk import remains the named blocker. Test baseline
re-stamped 173/19/3/195 → 174/19/3/196 (one new file). S's Task 2 is
narrower than it was: one of its two confirmed blockers (GK-94) is now
closed; the other (bulk import, needs its own mechanism) remains.

## GrailKey Directive 2026-08-14-AG — GK-98 kill path 3: the 22e veto

AF's `discriminative-corroboration` resolver works correctly in
production — confirmed again directly in this dispatch. A downstream,
independent consumer overwrote its result 3ms later. This dispatch is
one narrow fix plus the enumeration AF's own trace should have done and
didn't.

### The standing rule this dispatch adds

**A trace that enumerates kill paths for a changed value must enumerate
every CONSUMER of that value — every place downstream code reads or acts
on it — not only competing BRANCHES within the module that produces it.**
AF's trace was thorough about the two ways `selectTitleFamilyCandidate`
itself could pick the wrong family (`top-rank-protection` vs.
`weighted-consensus`) and correctly fixed both. It then wrote "ADDITIONAL
KILL PATHS: none beyond those two" — a true statement about branches
*inside* the function that produces `familyCandidate.decision`, and a
false statement about the value's fate once it leaves that function.
`checkAssemblyIntegrity` ("22e," `src/lib/identityCore.js`) is a
completely separate module, called from two sites in `api/enrich.js`,
that reads `confirmedTitle` (derived from `familyCandidate` inside
`resolveIdentity`) and can silently overwrite it back to Vision's raw
value. It was never a "branch" of AF's resolver — it is a consumer AF's
trace never looked for, because the trace's search scope was "how does
this function decide" rather than "who reads what this function
decided." This is the reason a green test suite (AF's own 25/25) shipped
a product that still failed on the real book. Future dispatches
extending a resolver's decision space must grep for every reader of the
field being changed (`identitySource`, `confirmedTitle`,
`familyCandidate.decision`, whatever the specific value is) across the
whole file/module graph, not just verify the producing function's own
branches are correct.

### Root cause

`checkAssemblyIntegrity`'s Rule 1 (missing-vision-tokens) has a
zero-support-defer carve-out (`src/lib/identityCore.js:325-354`,
pre-existing, correctly reasoned on its own terms) that requires
`compTitles.length >= 3` to activate at all. The population it checks
against — `winningFamilyTitles`, the winning family's own member
rawTitles (a Q142-era fix, itself correct: checking against the
member population rather than the full ambiguous pool) — is exactly 1
row for a genuinely thin `discriminative-corroboration` family (the
Sabrina fixture: one Dan Parent NYCC row out of nine). A 1-member family
can never clear the `>= 3` floor, so the carve-out never gets to render
a verdict, and 22e's conservative default — force Vision — fires
unconditionally for the exact shape AF exists to rescue. Two correct
mechanisms (the carve-out's floor, the winning-family-scoped population)
interact to produce a wrong outcome for a case neither was designed
against. Confirmed via real production log timestamps (10.524 AF wins,
10.532 `[22e] FORCED` reverts) and reproduced directly against real
committed pre-AG source in the acceptance test below.

### Fix

`shouldSkipAssemblyIntegrityCheck` (`src/lib/identityCore.js`) extended
by one disjunct:
```js
export const shouldSkipAssemblyIntegrityCheck = (familyDecision) =>
  familyDecision === 'refused-identity-conflict' || familyDecision === 'discriminative-corroboration';
```
`checkAssemblyIntegrity` itself, both its call sites' surrounding logic,
`FAMILY_OVERRIDE_DECISIONS`, `resolveIdentity`, and
`selectTitleFamilyCandidate` are all untouched. `api/enrich.js`'s
Phase-1 skip log line was made dynamic (names whichever decision
actually triggered the skip) since it previously hardcoded language
naming only the old `refused-identity-conflict` case.

### Consumer enumeration (the directive's actual ask)

Every downstream reader of `familyCandidate`/`confirmedTitle` between
family-selection and the outgoing Phase-2 query was checked, not
assumed:
- **Phase-1 22e** (`api/enrich.js:3468-3537`) — the failing consumer,
  fixed above.
- **Phase-2 22e** (`api/enrich.js` ~6550-6590) — only evaluates Rule 2
  (excess-non-consensus-tokens), never Rule 1 (the failing rule for this
  shape); does not call `shouldSkipAssemblyIntegrityCheck` at all today.
  No change needed for this specific defect — recorded, not silently
  assumed safe forever.
- **Q141-A PC-anchor-projection** (`api/enrich.js` ~5195-5217) — already
  gated by `isCorroboratedIdentitySource(identitySource)`
  (`src/lib/identityCore.js`), which checks
  `identitySource === 'title-family-' + decision` for every decision in
  `FAMILY_OVERRIDE_DECISIONS`. Since AF already added
  `'discriminative-corroboration'` to that shared constant, this
  consumer was automatically protected as a side effect of AF's own
  work — zero new code required, confirmed by reading the gate directly
  rather than assumed from the pattern.
- `confirmedTitle = sanitized` (contamination-gated) and the Q58-TITLE
  backfill (`backfillFromComps`-gated) were traced and found gated on
  conditions this identity path doesn't trigger — low-risk, not
  independently re-verified against a live Sabrina rescan (that
  verification is the user's physical-book acceptance test, not this
  dispatch's).

### Tests

`tests/grailkey-directive-ag-22e-provenance-exemption.test.js`, 32/32:
- **Fixture 1 (ship-blocking)** — the corrected version of AF's own
  Fixture 7, which claimed PASS on a route production never took (it
  stopped at `selectTitleFamilyCandidate`'s own output and never touched
  `resolveIdentity` or 22e at all). This fixture chains the REAL
  functions in the REAL order (`selectTitleFamilyCandidate` →
  `resolveIdentity` → the 22e population/skip/`checkAssemblyIntegrity`
  logic) — labeled precisely: DIRECT for the four real exported function
  calls, MIRRORED for the inline `api/enrich.js:3468-3537` orchestration
  glue between them (not an exported function, reproduced byte-faithful
  and cited by line number) and for the outgoing Phase-2 query (built
  from the documented Attempt-0 formula, since `fetchComps` makes a live
  HTTP call and cannot run offline). Demonstrates PRE-AG forced revert
  against real committed source, POST-AG survival, and prints the actual
  outgoing query string.
- **Fixture 2** — `shouldSkipAssemblyIntegrityCheck` checked directly
  against 7 decision values; confirms the exemption is exactly 2 values,
  not a general disable.
- **Fixture 3 (ship-blocking negative control)** — Flash #139 pool
  reproduced verbatim from the q140 fixture; confirms AG introduces no
  new route into `discriminative-corroboration` for this pool and that
  AG's predicate agrees with the pre-AG predicate for whatever decision
  this pool actually produces.
- **Fixture 4** — a corroborated-but-issue-contradicting candidate does
  not reach `discriminative-corroboration` (AF's own C2/C5, unaffected
  by AG).
- **Fixture 5** — direct source-text assertion that the skip branch is
  exactly a `console.log`, no `writeConfirmed`/`out.*` write.

### Regression

Full unfiltered sweep, all 202 `tests/*.test.js` files (201 existing + 1
new), 20s-per-file cutoff: 19 FAIL / 3 TIMEOUT, byte-identical by name to
the documented baseline (`CLAUDE.md`) — every one of the 19 FAIL files
(`artist-registry-sync`, `batch1-fixes`, `comp-filter-hygiene`,
`decision-engine`, `grailkey-commit-e/f/g/v1`,
`grailkey-directive-j-gk79a-relabel` [GK-91],
`grailkey-directive-p-task3-variant-on-card` [GK-90],
`grailkey-directive-q-variant-null-custody` [GK-89],
`grailkey-dispatch-33-parity-harness`, `identity-gate`,
`image-search-extraction`, `mega-keys`, `pattern-k-dedupe-issue`,
`priceBands`, `q-adv397-visual-guard`, `sold-verification`) and all 3
TIMEOUT files (`dispatch-42-comicvine-kill`,
`grailkey-commit-m-pc-query-fallback`, `ship26-integration`) cross-
checked by name against the registry/CLAUDE.md's own documented list —
zero unexplained. `grailkey-commit-v1.test.js`'s specific failure
additionally re-verified via `git stash`/`git stash pop`: identical
failure with AG's changes removed, confirming it is pre-existing and
unrelated. `tests/q140-issue-consensus-corrective.test.js` re-run,
byte-identical (124/0, the Flash #139 invariant unrelaxed).
`node --input-type=module --check` clean on both modified files;
`npm run build` clean.

### WATCH — traced, NOT fixed (explicit directive non-goal)

What happens when the surviving discriminative title reaches
PriceCharting matching downstream: **1997 can still reappear, through a
different, independent mechanism than the one this dispatch fixes.**
Logged as **GK-109** (`docs/TICKET-REGISTRY.md`) rather than left as
prose only, since it is a concrete, source-confirmed risk, not a
hypothetical:
1. `lookupPriceCharting`'s `mainToken` overlap check
   (`api/enrich.js:1808-1823`) validates only the FIRST tokenize()'d
   word of the query series name — "sabrina" for this book — which the
   wrong generic 1997 product also contains. "annual"/"spectaculer"/
   "dan"/"parent" are never checked by this gate at all.
2. The year-gap validation (`api/enrich.js:1787-1798`) is skipped
   entirely when `comicYear` is null — which it genuinely is here, since
   neither AF nor AG touch year (C3, deliberate) and this book's year is
   correctly left unresolved.
3. `assessPcAnchorTrust` (`src/lib/evidenceEligibility.js:979-999`), the
   gate that stamps `out.pcAnchorTrust`, is a pure price+year function
   with zero title/discriminator comparison of its own; when
   `confirmedYear` is null it returns `'COMPATIBLE_REFERENCE'` (not
   `'REJECTED'`), granting usable trust to a match it never verified
   against the title at all.
Net effect: a `discriminative-corroboration`-resolved book whose year
stays unresolved (the normal case for this decision path) can still have
its PRICE anchored to PriceCharting's wrong generic product even though
its TITLE is now correct — a FAILURE by this directive's own acceptance
criteria. Not fixed — pricing-math/PC-matching boundary, explicitly out
of this dispatch's scope; needs its own greenlight.

### Handoff

GK-98: CLOSED (corrected — AF alone was insufficient, AG's fix is what
actually closes it; full corrective history in the registry line, not
duplicated here). GK-110: CLOSED (this dispatch). GK-109: OPEN, logged,
not fixed. Test baseline unchanged in category (19/3), file count
201→202. Physical-book acceptance (rescan Sabrina, confirm the
Annual/Spectacular/Dan-Parent/NYCC identity survives with year
unresolved or independently-supported-non-1997, and separately confirm
the price does NOT anchor to the wrong 1997 PriceCharting product per
the GK-109 finding above) is the user's own next step, not verified by
this dispatch's test suite (which proves the code path, not a live
scan). Do not propose the next directive.

## GrailKey Directive 2026-08-15-AH — third false-READY (GK-111)

A third, independent false-READY, different tier than GK-96 (tier-4) and
GK-101 (tier-3 active) — this one tier-2 blend. Two additive locks, no
pricing math touched (C2).

### The defect

Production, 2026-08-15 00:33, build `f52c92f`: the operator's actual book
(a $24.99 SOLD listing whose title genuinely says "NYCC Foil LTD 50...Dan
Parent") was rejected by `src/lib/soldVerification.js`'s own variant
fallback (filters 7/8, `variantMismatch:user_has_comp_none` on the
coverType axis) as not matching the confirmed variant, then silently
re-admitted (`variantVerified:false`, grade-matched only) and blended 70/30
against a single active ask for a DIFFERENT, more expensive book ($109.95,
"Pink Lava Foil...LTD 5") that `api/comps.js`'s Filter 1c matched via a
single bare-substring token, "nycc" — `actionAuthority.state:READY`, a live
$65.88 List button.

### Root cause 1 — the sold-path applicability signal was never stamped

AB (GK-101) wired ONE applicability-relaxation mechanism — the active
pool's Filter 1c fallback — into `out.variantApplicability`, which
`deriveMarketStanding` (`src/lib/actionAuthority.js`) already floors
EXACT_CURRENT on. `verifySoldComps`'s OWN, entirely independent variant
fallback (the sold-pool sibling of the exact same disease) was never wired
into anything — `out.priceBands.variantAdjusted` existed and was already
computed, but was consumed only for a display string
(`priceNoteBase += ' · variant-adjusted (verify premium)'`,
`api/enrich.js:8146`) — Computed-Then-Discarded, confirmed by direct read
before writing a line of fix code.

The fix could not just wire `variantAdjusted` straight through: that flag
is TRUE whenever the fallback fired ANYWHERE upstream, even when the tier
that ultimately won demoted the fallback pool to a reference annotation
rather than pricing off it (`soldPoolTooThinToOverride`, GK-34's own
active-dominant branch) — wiring it unscoped would violate this dispatch's
own C5 (custody) and C1 (revocation only, never a global "fallback exists
anywhere" rule) at once. `soldPoolFallbackConsumed`
(`src/lib/priceBands.js`, computed once inside `computePriceBands` where
the tier decision and the fallback fact are both already in scope, carried
— never re-derived — into `api/enrich.js`) is TRUE only for the tier-2
sub-branches whose own `market` value genuinely folds `soldAvg` in
(blend, sold-only, sold-only-active-suspect), FALSE for
`soldPoolTooThinToOverride` and explicitly re-zeroed (not merely
inherited via spread) inside `applyVariantFallbackDivergenceCap`'s
override branch, where the fallback-sourced sold data is discarded
entirely in favor of an already-vetted (`MIN_POOL_FOR_OVERRIDE`-gated)
active anchor. Fixture 3b is the required proof this scoping is real, not
asserted: an identical fallback-fired setup that the tier engine does NOT
consume produces zero demotion.

Folded into AB's own `out.variantApplicability` field (not a parallel
signal) — `deriveMarketStanding` needed zero changes. A new
`out.variantApplicabilitySoldFallback` own-property exists purely so
`src/lib/responseContract.js` can emit a precise, distinct reason code
(`SOLD_VARIANT_FALLBACK_POOL`) instead of collapsing two structurally
different causes into AB's original `VARIANT_UNMATCHED_POOL` — Fixture 6
proves the two stay correctly discriminated and neither cross-fires.

### Root cause 2 — EXACT_CURRENT has no sufficiency floor

`marketStanding` answers "is this evidence current and applicable"; it
never answered "is there enough of it." A single genuinely exact/current
comp is honestly EXACT_CURRENT — demoting the LABEL to force a lock would
make the diagnostic dishonest to manufacture a desired outcome, the same
discipline AB itself observed (floor `EXACT_CURRENT` to `SIMILAR_ONLY`,
never fabricate a worse label than the evidence supports). A new,
tier-independent `single-comp-pool` soft lock (`SINGLE_COMP_POOL`) is the
gate instead — fires whenever an EXACT_CURRENT-standing price rests on
fewer than 2 total comps, deliberately NOT keyed to
`matchConfidence.tier` the way the pre-existing `low-tier-thin-pool` lock
is: this dispatch's own production case scored `matchConfidence.tier=LOW`
at `totalComps===3`, ONE comp above that lock's own `<3` floor — the
same MEDIUM-tier-slips-through shape GK-96 already named (HIGH-only cap,
LOW-only lock), reproduced on a completely different axis. The floor
itself (N<2) is stated plainly as what the code can defend, not dressed
up as calibrated: a single comp cannot definitionally establish a market
by itself; two is the smallest population that can.

### Server boundary (1f) — found while tracing, not chased for its own sake

`api/list-ebay.js`'s synthetic re-derivation has read
`item.variantApplicability` since Z/AB shipped — but `src/App.jsx`'s
single-item listing request body (the `fetch("/api/list-ebay", ...)` call,
`listOnEbay`) never actually included that field at all. Every listing
request has silently sent `undefined` for it since AB shipped, meaning
GK-101's server-side protection was never reachable through the normal
UI at all — the SAME shape this campaign has chased repeatedly (GK-103's
own framing: "a new signal the client never sends is a signal the server
never sees" — except here the signal wasn't even new, it just never
actually made the trip). Fixed alongside this dispatch's own two new
fields, same raw-evidence-field convention, GK-103's own trust-boundary
scope (server trusts client-SENT evidence, never a client-sent VERDICT)
untouched and unwidened. Without this fix, Fixture 7 could not have
passed regardless of anything else in this dispatch — the server would
have kept deriving off `null` applicability forever.

### Deferred, logged not chased (C6)

GK-112: the active-pool matcher itself (`api/comps.js`'s Filter 1c) is a
pure substring match whose registry (`classifyVariantTokens`,
`src/lib/imageSearchIdentity.js`) never recognized "Dan"/"Parent" as
variant-taxonomy tokens at all (a creator name, not a member of that
registry) — for `confirmedVariant="Dan Parent NYCC variant"` the entire
match reduced to a single generic token, bare "nycc". Print-run tokens
("LTD 5"/"LTD 50") and finish-descriptor tokens are absent from the
registry entirely, and — more fundamentally — never populated into
`confirmedVariant` by Vision's capture in the first place, so even a
token-exact rewrite of the same matcher could not have distinguished the
two books. This is the layer GK-111's authority-side fix demotes standing
on, not corrects: GK-111 stops a wrong-population price from reaching
READY; it cannot fix which population the price is drawn from. Needs its
own scoping (Vision capture + a genuinely discriminative matcher design),
explicitly out of this dispatch.

### Tests

`tests/grailkey-directive-ah-sold-fallback-authority.test.js`, 54/54 —
Fixture 1 (ship-blocking, real `verifySoldComps`→`computePriceBands`
chain reproducing the exact production numbers, PRE-AH/POST-AH), Fixture
2 (sufficiency floor isolated, `marketStanding` stays honestly
EXACT_CURRENT), Fixture 3 (fallback demotion isolated from sufficiency,
many-comp pool), Fixture 3b (ship-blocking negative control — unconsumed
fallback must not fire, the scoping proof for root cause 1), Fixture 4
(four-way monotonicity including a demonstrated upward route — without
which this would be a wall, not a boundary), Fixture 5 (no over-fire on
an ordinary healthy book), Fixture 6 (AB's original lock unregressed and
correctly discriminated from the new one), Fixture 7 (ship-blocking,
server-side independent denial via the real `deriveLocks`/
`deriveActionAuthority`, forged client `actionAuthority:{state:'READY'}`
proven to have zero effect).

### Regression

Full 203-file sweep initially surfaced ONE unexpected regression:
`tests/grailkey-directive-ag-22e-provenance-exemption.test.js` (AG's own
acceptance test, shipped clean 32/32 at AG-close) started failing —
traced directly, not assumed: AG's Fixture 1 pinned its "pre-AG" git-show
comparison to the literal string `'HEAD'`, which correctly resolved to
AF's commit (genuinely pre-AG) at the moment AG was written and committed,
but silently starts resolving to AG's OWN post-fix commit the instant AG
itself becomes HEAD — the identical "designed-to-go-stale-by-construction"
defect already named for GK-91
(`grailkey-directive-j-gk79a-relabel.test.js`), a SECOND, independent
instance of the same class, not previously connected to it. Fixed forward
in this dispatch's own commit (pinned to the real immutable SHA `7d0d434`
instead of the moving target `'HEAD'`) rather than left failing — same
"correcting forward" convention as `grailkey-commit-t.test.js` (AF) and
`dispatch-42-comicvine-kill.test.js` (AE). Full sweep re-run clean after:
19 FAIL / 3 TIMEOUT, byte-identical by name to the documented baseline
(203 files, one new). `q140-issue-consensus-corrective` 124/0 unchanged.
`priceBands.test.js` (7 failures) and `tests/sold-verification.test.js`
(5 failures) re-checked individually against `src/lib/priceBands.js`'s
real diff — same named failures, same counts, confirmed pre-existing
(this dispatch never touched `src/lib/soldVerification.js` at all, and
`priceBands.js`'s new code is additive, not a rewrite of anything those
7 failures already depended on).

### Pattern Library — the standing rule this finding confirms, not a new one

Root cause 1 is the disease class this campaign has now named four times
independently (GK-83/98's "measuring coherence against the wrong
population," Dispatch 25's four intra-family instances, this one) —
recorded here as a fifth confirmation, not a new taxonomy entry: TWO
structurally similar evidence-relaxation mechanisms (active Filter 1c,
sold-verify's own fallback) existed in the SAME pricing pipeline, and
fixing the first one (AB) created no structural reason to assume the
second was also covered — it wasn't, and nothing short of directly
tracing every mechanism that can relax the SAME kind of evidence (not
just the first one found) would have caught it. The Computed-Then-
Discarded count in `docs/TICKET-REGISTRY.md` (GK-101's own entry) is now
at its 8th instance with this dispatch's server-boundary finding (the
listing request body silently dropping `variantApplicability`) — a NINTH,
if the sold-fallback-to-`variantApplicability` wiring itself is counted
separately from the request-body gap it depends on.

### Handoff

GK-111: CLOSED. GK-112: OPEN, logged, deferred. GK-109 remains OPEN,
untouched by this dispatch (PC base-entry preference/year ordering is a
different layer, explicitly out of scope, C6). Test baseline
180/19/3/202 → 181/19/3/203 (one new file; the AG test-file regression
described above was found and fixed in the SAME commit as this stamp,
not left for a future dispatch to discover). Physical-book acceptance —
rescan Sabrina, confirm MARKET STANDING reads SIMILAR_ONLY (or better, if
the operator's real book now clears the pool cleanly), ACTION AUTHORITY
reads REVIEW with `SOLD_VARIANT_FALLBACK_POOL` and/or `SINGLE_COMP_POOL`
among the reason codes, Decision safe does NOT pass, and the List button
is disabled, with year 1971/GK-109 still expected and explicitly out of
scope — is the user's own next step, not verified by this dispatch's
suite. Do not propose the next directive.

## Standing-rule violation record — same-commit test-baseline re-stamp

The standing rule (CLAUDE.md, "Directive preflight requirement" /
test-baseline paragraph): **the test baseline is re-stamped in the same
commit that adds or removes a `tests/*.test.js` file.** Two confirmed
violations, recorded here so a rule violated twice and recorded once
does not read as decorative.

**Instance 1 — Directive J / Directive K (2026-08-12).** Directive J
added `tests/grailkey-directive-j-gk79a-relabel.test.js` in commit
`1d827e7` without re-stamping the baseline line in the same commit; the
re-stamp landed separately in `aef558a` ("re-stamp test baseline
165/16/3/184 → 166/16/3/185"). Directive K's commit (`8514b3d`) states
it recorded this violation via "the missing CLAUDE.md dispatch-index
entry for Directive J... including an explicit record that the standing
same-commit re-stamp rule was violated." **That CLAUDE.md entry could
not be located in the current file** as of this record (2026-08-14,
Directive AC) — grepped for "Directive J" and "Directive K" across
`CLAUDE.md` and this file, zero hits for either as a dispatch-index
bullet. Most likely cause: Directive V's CLAUDE.md compaction pass
(2026-08-14, `8d8af44`, 148,847→98,875 chars) compressed or dropped the
entry along with the rest of the Pattern Library dispatch-index section
it targeted — that compaction's own commit claims "nothing lost,"
verified only against sections with a full Pattern Library writeup to
fall back on, which Directive K's docs-only, no-writeup commit never
had. Not re-investigated further here (out of this dispatch's docs+
CLAUDE.md-only, non-expanding scope) — flagged as a gap, not silently
assumed still present. The commit messages of `1d827e7`, `aef558a`, and
`8514b3d` themselves remain the durable, un-losable record of instance 1.

**Instance 2 — Directive AB (2026-08-14).** Added
`tests/grailkey-directive-ab-evidence-applicability.test.js` in commit
`cb987d1` (implementation + tests) without re-stamping the baseline line
in the same commit; the re-stamp landed separately in `378b45e`
(registry + docs close-out). The baseline value itself (176/19/3/198)
is correct and was fully cross-checked against the documented stale
list before being committed — this is a commit-placement violation, not
a data error, identical in shape to instance 1.

The rule is not amended or softened by either instance — it remains
"same commit," not "same push" or "same dispatch."

## GrailKey Directive 2026-08-15-AI — visual-first identity authority (Slice 1)

The disease this dispatch names once, structurally, instead of patching a
fifth branch: **a physical-identity fact with two meanings and more than
one writer.** Four earlier dispatches (AF, AB, GK-109, and this campaign's
own PC-year class) each independently produced a variant of the same
shape — a value computed in one place, discarded or contradicted in
another, with no single arbiter. This dispatch is Slice 1 of a
three-slice plan to make identity resolution single-writer and
order-independent; it deliberately does not attempt Slices 2 or 3.

### The defect, two shapes

**Detective Comics #1107 (split-brain).** Vision returns "Batman #null" —
no issue at all. The visual pool's top-ranked, most-specific result is
"Detective Comics #1107 · Corner Box Variant · Jorge Jimenez." The
existing top-rank-guard (`selectTitleFamilyCandidate`,
`imageSearchIdentity.js`) requires forward token overlap between the
candidate and Vision's own title before trusting it — "batman" shares no
tokens with "detective comics 1107 corner box variant jorge jimenez," so
the guard rejects it and falls through toward Vision's own (empty) value.
`confirmedIssue` stays null. Separately, `api/comps.js`'s own `issueNum`
derivation (`issue ? String(issue).trim() : extractIssueNumber(title)`)
re-parses the SAME "#1107" straight out of `confirmedTitle`'s raw text
(which `sanitizeSeriesTitle` never strips issue tokens from) and uses it
to build the comp-search query and `evidenceTarget.issue` — the pipeline
searches the market for #1107 while telling the operator the issue is
unknown. Two genuinely separate variables (`confirmedIssue`,
`issueNum`), not one read twice — confirmed by direct trace, not
assumed.

**Venom (value vs. authority false binary).** Vision reads "Venom:
Separation Anxiety #3." The raw pool has zero support for "#3" (8
distinct issue numbers extracted across 20 rows, best agreement 30%) and
no adoptable pool-wide alternate — the existing vision-zero-support
ESCALATE branch (`identityCore.js`) correctly does what it was built to
do: null `confirmedIssue`, force `ID_REQUIRED`. But the top-ranked visual
result plainly says "Venom Separation Anxiety #1 · Trade Variant Cover."
Erasing it to null throws away real evidence (I13); silently adopting
"#1" as confirmed would repeat the Flash #139 mistake in reverse
(confident and possibly wrong). Neither answer is correct — the right
answer is a THIRD state this pipeline had no vocabulary for: adopt the
value, demote the authority.

### The fix — eligibility, then a narrow, guarded gap-fill

`src/lib/identityReconciler.js` (new file) provides two independent
pieces, both deliberately general enough to outlive this one dispatch:

1. **Eligibility filtering** (`isEligibleVisualRow`,
   `selectFirstEligibleVisual`) — a lot/bundle listing or a seller
   "variation group" placeholder ("Sabrina the Teenage Witch comics
   select an issue," a picker with no single book identity) is excluded
   from candidacy BEFORE any rank or weight-based selection runs, not
   filtered after. Wired into `selectTitleFamilyCandidate`
   (`imageSearchIdentity.js`) by filtering `scored` (the ranked family
   list) the moment it's built — `families: scored` downstream, `topFamily
   = scored[0]`, `item0Family = scored.find(...)`, everything else in the
   function is unchanged, now simply operating on the eligibility-filtered
   list. Index numbering into the original `items` array is untouched —
   whole families are removed from candidacy, nothing is renumbered, so
   every consumer of `family.indices` downstream keeps working unmodified.
   Text-pattern heuristic, not structural (GK-115) — eBay's Browse API
   `itemGroupType`/`SELLER_DEFINED_VARIATIONS` marker is never captured
   anywhere in this codebase's parsed visual-pool rows (grep-confirmed
   zero hits across `api/enrich.js`/`api/comps.js`/`imageSearchIdentity.js`),
   so a normal variant cover cannot always be distinguished from a
   variation-group placeholder by text alone — logged as its own gap, not
   fixed here.

2. **A Slice-1-scoped evidence/reconcile API**, issue facet only —
   `createEvidenceSet`/`addEvidence`/`proposeRefinement`/`reportConflict`
   (write evidence, never canonical state) and `reconcileIssue` (the
   pure, deterministic derivation — same evidence set in, same result out,
   regardless of call order; D1/D4). This is genuinely new machinery, but
   Slice 1 wires it into exactly ONE integration point:
   `resolveIdentity`'s new last-resort branch (`identityCore.js`), placed
   after every existing family-consensus/vision-zero-support branch. It
   fires only when `confirmedIssue` is STILL null after everything else
   has run — meaning it is structurally a no-op for every case an
   existing mechanism already resolved, including Flash #139's
   `conflict-locked` mode (which leaves `confirmedIssue` non-null by
   construction). Title/year/publisher/variant/creator keep their
   existing ~37 direct writers untouched this dispatch — Slice 2's job,
   not invented here.

### Five guards, all found regression-testing against this codebase's own existing fixtures

A naive "adopt the first eligible visual row's issue whenever nothing
else did" over-fired on four different pre-existing, deliberately-encoded
"honest null" precedents before converging on the following:

1. **No-new-information** — if the candidate's issue equals the value
   Vision already asserted (the value the raw-pool zero-support check
   JUST rejected for lack of support), adopting it back is not
   corroboration, it's the same unsupported number restated
   (`tests/q140-at-vision-zero-support-skip.test.js`, "Test 5b":
   vision.issue="1", zero raw-pool support, first eligible visual row
   also reads "#1").
2. **Respect an already-considered margin decline** —
   `isNearMissMarginDecline`/`isNearMissConflictActive` mean a family WAS
   evaluated against the real adoption bar and explicitly fell short
   (`tests/q140-coherent-content-token-lane.test.js`'s Adventure Time
   Summer Special/SDCC near-miss: topFamily weightSum 14 vs required 15
   — this codebase's own named, repeated "honest null" ruling, not a gap
   to route around).
3. **Marketing-flavored single row** — a narrowed keyword filter
   (`isMarketingFlavoredRow`, `anniversary|special|collector|limited|
   exclusive` — deliberately WITHOUT "variant," which merely describes a
   cover print and does not cast doubt on the issue number the way a
   renumbered-one-shot signal does) rejects a lone row whose "#N" sits
   next to marketing language, matching the same Adventure Time
   precedent. Excluding "variant" specifically was required to keep
   Venom's own "Trade Variant Cover" row eligible.
4. **Minimum corroboration floor** (`countCorroboratingEligibleRows`,
   `MINIMUM_CORROBORATING_ROWS = 3`) — the SAME >=3-unique-row floor
   `resolveFamilyIssueConsensus` already enforces everywhere else in this
   codebase (`tests/q131-refused-identity-conflict-provisional.test.js`'s
   Eternus #2 fixture: even 2 unique rows at 100% self-agreement stays
   below the floor). A flat count, not a percentage of the total pool —
   a large pool full of unrelated eligible rows (TPB listings, apparel)
   diluting a ratio would make a genuinely strong candidate artificially
   harder to adopt as pool size grows. This guard alone also resolved
   `tests/q-trackB-commit4.3-winning-family-authority.test.js`'s "CONTROL
   E" (Quux Anthology) fixture without needing to treat it as an accepted
   behavioral delta — a pool of 3 identical duplicate rows dedupes to 1
   unique row, below the floor.
5. **Respect an already-considered rescue decline** — the SAME "already
   evaluated and declined" principle as guard 2, applied to Dispatch 26
   Fix 4's unanimous-zero-support-rescue mechanism specifically. Found on
   the FIRST full regression sweep (not caught by unit-level testing
   against the four fixtures above): `zeroSupportRescueDeclined`, hoisted
   to function scope and set whenever that mechanism's own `if` condition
   is entered but `rescueEligible` is false, gates the new branch — two
   of `tests/grailkey-dispatch-26-fix4-zero-support-rescue.test.js`'s own
   control fixtures require ESCALATE to stand unmodified when that
   mechanism evaluates and declines (weightSum too thin; title collapsed
   to one cluster).

Only guard 5 was found by the full sweep rather than by direct fixture
construction — recorded here as a reminder that a family of related
"already decided, don't second-guess" mechanisms in one file is easy to
enumerate incompletely by inspection alone; the sweep is what catches the
member you missed.

### Authority demotion — no new mechanism

`identityProvisionalFromVisualFirst` (the new branch's own output flag)
is consumed by `api/enrich.js` to set `out.identityProvisional = true` +
`out.listingHardLocked = true` + `out.listingHardLockReason =
'identity-unresolved'` — the EXACT mechanism Q133 Slice 2 already
established for a different provisional-identity shape.
`deriveIdentityStanding` (`src/lib/actionAuthority.js`) already reads
`out.identityProvisional === true` as `CONFLICTED`, never `CONFIRMED`;
`deriveActionAuthority` already cannot reach `READY` off a non-CONFIRMED
`identityStanding` — verified directly (Fixture 4B: `identityProvisional:
true` + an EXACT_CURRENT-tier `pricingSource` still derives
`actionAuthority.state: REVIEW`, never `READY`). No change to
`actionAuthority.js` itself. The operator-facing detail text
(`out.listingHardLockBanner`, naming both numbers when Vision asserted
one) reaches the card through the equally pre-existing `deriveLocks`
mechanism (`responseContract.js:142-153`, `out.listingHardLocked` →
`contract.locks[].reason` → rendered generically at
`item.contract.locks?.[0]?.reason`, `src/App.jsx`) — no client-side
render code needed at all.

### Creator registry gap (GK-114) and the shared 999 cap (GK-116)

Detective Comics' own fixture required a second, independent fix: the
card's "CREATOR CREDITS" section (`item.creatorFromComps`, driven by
`extractCreatorsFromComps`, `src/lib/premiumCreators.js`) resolved bare
"jimenez" unconditionally to Phil Jimenez even when the pool/visual text
carried the full, different name "Jorge Jimenez" — never added to the
file's own documented ambiguous-surname set (Adams/Lee/Miller/Wood/
Davis/Ross) despite qualifying by the same standard (two real,
comparably-prominent creators sharing one bare surname). Fixed by
splitting into two full-name-only entries — the registry gap was the
entire defect; `extractCreatorsFromComps` itself needed no change.

Building the fix also surfaced `extractIssueCandidate`'s (`identityCore.js`)
shared 999 cap on both its hash- and bare-number branches — Detective
Comics' real #1107 (DC's restored legacy numbering, reached #1107 by
2022) would silently fail to extract through the function every OTHER
consumer in this codebase relies on, including `resolveFamilyIssueConsensus`
itself. Not widened at the shared site (19+ dependent test files, unknown
blast radius on the bare-number branch's year-collision guards,
deliberately out of scope) — this dispatch's new mechanism uses a
separate, narrow, hash-prefixed-only, uncapped extractor
(`extractHashIssueNumber`) instead. Logged as GK-116 for a future
dispatch to widen the shared function properly.

### Handoff

GK-113/114 CLOSED. GK-115 OPEN (partial — text-heuristic shipped,
structural `itemGroupType` capture not). GK-116 OPEN, logged, deferred.
GK-98/109/112 remain explicitly untouched, per this dispatch's own
non-goals. Test baseline 181/19/3/203 → 182/19/3/204 (one new file; a
real regression the first full sweep surfaced — guard 5 above — was
found and fixed in the SAME commit as this stamp, not left for a future
dispatch to discover, matching the standing same-commit rule this
campaign has twice violated before). Physical-book acceptance (per the
directive: Detective Comics, Sabrina, Dell'Otto, Venom, one scan each, no
correction) is the user's own next step, not verified by this dispatch's
suite — this dispatch's own test file exercises `resolveIdentity`/
`selectTitleFamilyCandidate`/the reconciler directly, not the full
`/api/enrich` HTTP handler end to end. Dell'Otto (Fixture 3) is
explicitly OUT of this dispatch's scope — variant-facet resolution has
its own ~6 direct writers, not traced or touched here; Vision's guessed
variant will still win over visual/slab-label evidence until a future
dispatch extends this same eligibility+evidence approach to the variant
facet. Do not propose the next directive.

## GrailKey Directive 2026-08-15-AJ — Slice 1 acceptance: reconciler reachability (GK-117/118)

Directive AI's own handoff claimed the visual-first mechanism was wired
in. It wasn't — not for the case that mattered most.

### Proof 1's finding: the reconciler was never called

Direct trace (grep for `reconcileIssue`/`createEvidenceSet`/`addEvidence`/
`reportConflict` across `identityCore.js`, `api/enrich.js`,
`imageSearchIdentity.js`) returned **zero hits**. `identityReconciler.js`'s
evidence API existed only as exported, unit-tested pure functions,
invoked exclusively by AI's own test file — never by `resolveIdentity`
itself. The shipped branch reimplemented the same five guards ad hoc,
directly in `identityCore.js`, gated on `confirmedIssue == null` — a
rescue path for the case where nothing upstream resolved a value, not
the visual-first authority mechanism the directive specified.

The practical consequence: a book where Vision confidently (even if
wrongly) asserted an issue, and the raw pool had merely WEAK — not zero —
support for it, never reached the new mechanism at all. The
`vision-zero-support` block that would otherwise re-examine the value
requires the support ratio to fall below `ISSUE_ZERO_SUPPORT_RATIO_FLOOR`
(10%) before it even runs; anything above that, `confirmedIssue` sails
through unchanged with `firstEligibleVisual` never consulted. This is
precisely "a confidently wrong value the evidence system never gets to
examine" — the disease this entire campaign exists to close, reproduced
inside the campaign's own fix.

### The fix: unconditional reconciliation, evidence-based precedence

`resolveIdentity` now builds an issue evidence set and calls
`reconcileIssue` on **every** issue resolution — not gated on null.
Concretely, right before the function's final return:

- Vision's own asserted value becomes evidence: `addEvidence` if the
  pipeline never explicitly rejected it, `reportConflict` if it did
  (confirmedIssue is null here despite Vision having supplied a value —
  zero-support ESCALATE, or a title-family branch that refused to trust
  it). The distinction matters: a rejected value must be visible as
  conflict context without being fallback-worthy corroboration.
- A genuine upstream RESOLUTION (family-consensus adopted/corroborated/
  conflict-locked/rescue, or a zero-support OVERRIDE) becomes
  `'family-consensus'`-tier evidence at whatever value it settled on —
  computed via `issueHasUpstreamAuthority`, which checks EITHER that
  `confirmedIssue` differs from Vision's own value (something changed
  it) OR that `familyIssueConsensusResult.mode` is a genuine verdict
  (covers Flash #139's `conflict-locked`, where the value happens to
  equal Vision's own — still a real resolution, not a passthrough, and
  must carry top precedence so a disagreeing visual cluster can never
  outrank it).
- `firstEligibleVisual`'s candidate becomes `'first-eligible-visual'`-tier
  evidence, subject to all five of AI's original guards — now understood
  as gates on WHETHER this evidence enters the set, not on whether the
  reconciler runs at all.
- `reconcileIssue(evidenceSet)` is called unconditionally. A
  `[reconcile-issue]` decision log (value/source/authority/justifiedBy/
  conflicts) fires on every single call — the artifact Proof 1 requires
  assertions to target, so reachability is provable independent of the
  outcome.

Demotion (`identityProvisionalFromVisualFirst`) fires precisely when the
WINNING evidence source is `'first-eligible-visual'` AND its value
differs from Vision's own (present or absent) — never merely because
first-eligible-visual happened to win precedence while agreeing with
Vision. This is what keeps an ordinary book (ambient visual match
confirms Vision) from being wrongly flagged provisional.

### Fixture P1 — the case that actually mattered

Vision keeps issue "#3" (real production shape: Venom's own vision
read). The raw pool has WEAK but NONZERO support for "#3" (15%, above
the 10% zero-support floor) — the pre-existing zero-support block never
runs, so under AI's original code `confirmedIssue` stays "3" untouched,
full stop. Under the fix: the evidence set gets `{vision:"3"}` (not
rejected — zero-support never fired) and `{first-eligible-visual:"1"}`
(the pool's own top eligible row). No family-consensus evidence exists.
Precedence picks `first-eligible-visual` over bare `vision` — the
reconciler overturns Vision's confidently-wrong "3" to the correctly-
supported "1", CONTESTED, demoted. `tests/grailkey-directive-aj-
reconciler-reachability.test.js`'s Fixture P1 asserts on the
`[reconcile-issue]` log line's `source`/`justifiedBy`/`conflicts`/
`authority` fields directly — not merely that the final value looks
right, which the old, still-broken code could also have produced by
coincidence on a different input.

### Proof 2 — Flash #139 is protected by precedence, verified in isolation

The canonical Flash #139 fixture's own pool text happens to contain
"Anniversary" (`The Flash #170 Anniversary Giant-Size...`) — meaning BOTH
the marketing-flavor guard (Guard 3) AND family-consensus precedence
independently protect it, and running the canonical fixture alone cannot
tell which mechanism actually did the work. A second fixture, identical
except for stripping "Anniversary" from the #170 cluster's text, confirms
precedence ALONE is sufficient: `first-eligible-visual="170"` DOES enter
the evidence set in that variant (Guard 3 no longer blocks it), and
family-consensus still wins — `confirmedIssue` stays "139",
`identityProvisionalFromVisualFirst` stays `false`, and the disagreeing
"170" is recorded in `conflicts` rather than silently discarded.
Authority on the canonical fixture reads `CORROBORATED` (marketing-guard
suppressed the competing candidate entirely, so no conflict is even
recorded); on the no-"Anniversary" variant it reads `CONTESTED` (the
competing candidate IS recorded, just outranked) — both are honest,
neither is a value change, and Flash #139's actual required invariant
(`confirmedIssue === "139"`, no demotion) holds in both.

### Guard 6 — contamination, found on the very first post-fix regression sweep

Making the reconciler reachable on non-null Vision values immediately
exposed a case AI's fixtures never reached:
`tests/q-trackB-commit4.3-winning-family-authority.test.js`'s "CONTROL
C" — a naturally-formed family mixing a raw listing with a slabbed "CGC
9.8" member, Vision issue present and untouched (zero-support never ran,
no `ebay.agreement` at all). With the reconciler now reachable, the
contaminated family's own first-eligible-visual candidate ("7," from
"Zap #7 NM") could win by precedence over bare `vision` evidence — the
CORRECT visual-first behavior GK-117 exists to enable, except this
specific family is one `hasContaminatedMember` (LOT_RE/REPRINT_RE/
SLAB_RE/GRADED_RE/SIGNED_RE/IDENTITY_TPB_MARKER_RE) already flags as
untrustworthy for the SAME reason `familyAuthorityBaseConditions` refuses
it for retention/rescue. Fixed by reusing the identical signal:
`hasContaminatedMember(opts.visualItems, family?.topFamily?.indices)` now
also suppresses first-eligible-visual evidence. Safe with no `topFamily`
at all (Detective/Venom's own fixtures) — `indices` defaults to `[]`
internally, returns `false`, never a false suppression.

Building the fix surfaced a related, non-code finding: this dispatch's
OWN Detective test fixtures (both the unit-level file and the new
HTTP-handler file below) originally mixed CGC-graded rows into the
corroborating set to satisfy the >=3-row floor — which legitimately
tripped this SAME new guard for a realistic "multiple graded copies of a
hot recent book" shape. Not a bug in the guard; the fixtures were
corrected to use plain condition words (NM/VF) instead.

### Proof 3 — the real HTTP handler, not just the unit level

AG's lesson (a unit-level fix silently reverted 3ms later by an untested
downstream consumer) is now a repeatedly-confirmed class in this
codebase. This environment has no live EBAY_APP_ID/EBAY_CERT_ID/
COMICVINE_API_KEY/PRICECHARTING_TOKEN; a bounded probe confirmed the
unmodified handler already degrades gracefully to a clean 200/ID_REQUIRED
with zero visual-pool data when no credentials exist at all (every
external source's own early `if (!token) return null` guard fires before
any network call). To exercise the identity path specifically, fake
EBAY_APP_ID/EBAY_CERT_ID values were set so `lookupEbayVisual`'s guard
passes, and ONLY the network calls it and `getOAuthToken`/`api/comps.js`'s
own comp-search actually make (`oauth2/token`, `search_by_image`,
`item_summary/search`) were intercepted with canned responses shaped
like the Detective/Venom fixtures already proven at the unit level.
Every other external call (ComicVine/PriceCharting/Ximilar/sold-history)
was left exactly as this environment already produces it — no
credentials, no call, graceful null — so nothing about the actual
identity-resolution CODE PATH (`resolveIdentity`, `selectTitleFamilyCandidate`,
`reconcileIssue`, the `api/enrich.js` consumption sites) was mocked,
patched, or bypassed.

Both fixtures pass end to end through the real handler: Detective's
`out.issue` resolves to `"1107"` (not reported missing), `out.
identityProvisional`/`listingHardLocked` are set through the real
consumption site, and the creator surfaces correctly as `"Jorge
Jimenez"` — though as a SINGLETON (`creatorFromCompsSingleton`, hits=1),
not consensus, because `api/comps.js`'s own dedup filter (unrelated to
this dispatch) collapses this mock's four near-identical corroborating
titles down to one survivor before `extractCreatorsFromComps` ever sees
them; the unit-level fixture's combined consensus+singleton check was
reused rather than asserting on consensus alone. Venom's `out.issue`
resolves to `"1"` (not Vision's rejected "3"), `identityProvisional` is
set, and `decision.action` is confirmed to never reach `LIST_NOW`. One
honest, NOT-fixed divergence found and documented rather than papered
over: Detective's `listingHardLockBanner` TEXT (not its lock STATE) gets
overwritten later in the pipeline by a different, pre-existing mechanism
(the `refused-identity-conflict` promotion path, which independently and
correctly ALSO fires for this exact book) once real comp data flows —
both banners are accurate; which of two independently-correct messages
wins display precedence is a pre-existing, unrelated question this
dispatch did not scope in to fix.

### Handoff

GK-117/118 CLOSED. GK-113/114 corrected from CLOSED to OPEN/SHIPPED —
closure requires Jimmy's own physical scans (Detective, Sabrina,
Dell'Otto, Venom), not a BUILDING deploy or unit-level fixtures; this
directive's own preflight named that standard and this dispatch holds to
it. GK-115/116/109/112/98 remain untouched, per this dispatch's own
non-goals. Test baseline 182/19/3/204 → 183/19/4/206 (two new files; the
4th TIMEOUT is this dispatch's own HTTP-handler test, a documented,
re-verified-clean artifact of the sweep harness's 25s cutoff, not a
failure — see CLAUDE.md's stamp for the full accounting). Slice 2 (the
remaining ~37 direct writers across title/year/publisher/variant/
creator) and Slice 3 (convergence) are unstarted — this dispatch closed
a mechanism gap inside Slice 1, it did not begin Slice 2. Do not propose
the next directive.

## GrailKey Directive 2026-08-15-AK — the population-precedence gate (GK-119)

Slice 1's last policy bug: the precedence table AJ shipped to make the
reconciler reachable was itself carrying Sabrina's original disease,
just moved one layer down.

### The question, and why it wasn't rhetorical

AJ's precedence order was `family-consensus > first-eligible-visual >
vision`. A single evidence tier named `'family-consensus'` covers every
mode `resolveFamilyIssueConsensus` can return — including `'adopted'`,
which fires specifically when NO prior issue existed and a family's own
raw member-count vote filled the gap. Nothing in AJ's design asked
whether that vote came from genuine corroboration of something already
known, or from nothing more than "more listings said this than anything
else." The governing rule this whole campaign operates under —
**"visual decides what the object is; corroboration decides how
strongly to stand behind that answer; population alone corroborates or
contradicts, it never replaces"** — was violated by construction the
moment `'adopted'` mode was folded into the SAME tier as `'corroborated'`
and `'conflict-locked'`.

### The fixture, and what it proved on first run

A Sabrina-shaped fixture: `firstEligibleVisual` is a specific, eligible,
title-agreeing candidate ("Sabrina Annual Spectacular #1, Dan Parent,
NYCC, Foil"), corroborated by 3 unique rows. Competing against it: a
LARGER, GENERIC "Sabrina the Teenage Witch" population (6 unique rows)
that clears `resolveFamilyIssueConsensus`'s own adoption bar for "#5"
(4/6 = 67%, clear lead over a "#12" runner-up) — no prior to compare
against (Vision supplied no issue at all), no discriminative
corroboration (no `opts.visionVariant` token match — the case AF's own
GK-98 fix does NOT cover), no hard contradiction.

**The fixture failed.** `[reconcile-issue] value=5 source=family-
consensus authority=CORROBORATED justifiedBy=[{"source":"family-
consensus","value":"5"}]` — `first-eligible-visual`'s own correct "1"
never even entered the winner's `justifiedBy`; it lost purely on
precedence rank, not on any evidentiary comparison. `confirmedIssue`
resolved to `"5"` — the generic population's own vote, not the specific
physical book actually in hand. Exactly the shape the directive
predicted: "fourteen generic rows outranking the specific physical
match — now with a single writer faithfully executing the wrong
policy."

### The fix: two tiers instead of one, split by WHAT KIND of evidence it is

`identityCore.js` now tags family issue evidence with one of two
differently-precedenced sources, never a single unified label:

- **`'family-population'`** — `resolveFamilyIssueConsensus`'s own
  `'adopted'` mode, identified specifically by the ABSENCE of an
  `outcome` field (see below for why that field is the reliable
  discriminator). A bare vote filling an empty gap. Demoted BELOW
  `'first-eligible-visual'` — it may still corroborate (when it agrees)
  or be recorded as a disagreeing conflict, but cannot outrank a
  specific candidate purely on count.
- **`'family-corroborated'`** — every mode that represents a genuine
  relationship to an EXISTING prior: `'corroborated'` (the family agrees
  with a present value), `'conflict-locked'` (a locked contradiction
  that preserves the prior verbatim — Flash #139), `'unanimous-zero-
  support-rescue'` (Dispatch 26 Fix 4 — a materially higher bar than
  population: unanimity PLUS independent-posting verification via
  `evaluateTitleTextIndependence`, not mere count), and the raw-pool
  zero-support OVERRIDE mechanism (a separate, already load-bearing,
  already-tested path this split does not touch). Keeps top precedence,
  unconditionally outranking a disagreeing visual cluster.

`ISSUE_SOURCE_PRECEDENCE` becomes `['family-corroborated',
'first-eligible-visual', 'family-population', 'vision']`.

### The regression the fix itself caused, and the discriminator that closes it

The naive version of this fix — "demote every `mode==='adopted'`
result" — broke `tests/q-trackB-commit4.3-winning-family-authority.
test.js` on the very first regression pass. Its Spawn #351 fixture ALSO
legacy-maps to `mode: 'adopted'` (`legacyModeFor`'s own mapping:
`decision.outcome === 'adopted' || 'provisionally-corrected'` both
collapse to the string `'adopted'` for backward compatibility with
pre-Commit-4.3 consumers) — but that "adopted" means something entirely
different: Vision's own LOW-CONFIDENCE "301" being corrected by a
5/5-unanimous, dominance-verified family via `decideFieldAuthority`, a
confidence-AWARE correction of an existing prior, not a bare count vote
filling an empty gap.

The two cases are structurally distinguishable: `resolveFamilyIssueConsensus`'s
raw output (from the title-family override / refused-identity-conflict
branches, where Sabrina's real population-only case originates) never
carries an `outcome` field. The retention branch's `decideFieldAuthority`-
derived result (Spawn #351's shape) always does — `outcome` and
`authoritativeForCustody` are explicit fields on that object
(`identityCore.js` ~line 2211). `isRawPopulationAdoption =
familyIssueConsensusResult?.mode === 'adopted' && familyIssueConsensusResult?.outcome
== null` is the exact, reliable test: `outcome == null` means the vote
is genuinely bare; `outcome != null` means it already passed through a
confidence-aware authority decision and belongs in the corroborated
tier regardless of its legacy-mapped mode string.

### A second regression, found on the SAME full sweep: demotion was asking the wrong question

Fixing the tier split surfaced a second, independent bug in the SAME
commit, on the SAME first regression pass:
`tests/q-trackB-commit4.1-spawn-visual-family-merge.test.js`'s own live
Spawn #351 fixture (a genuinely different fixture than
`q-trackB-commit4.3`'s — this one exercises the title-family override
path directly, a bare `resolveFamilyIssueConsensus` 'adopted' result
with NO `outcome` field, i.e. exactly the `'family-population'` tier
this dispatch demotes) failed on `identitySource`: the expected
`'title-family-weighted-consensus'` had grown an unwanted
`+first_eligible_visual_contested` suffix.

Root cause: AJ's original demotion condition was `reconciledIssue.source
=== 'first-eligible-visual' && vision.issue !== reconciledIssue.value`
— it only ever asked whether VISION agreed with the winner. In Spawn
#351's real production shape, Vision supplied no issue at all
(`vision.issue === null`), and the family's own unanimous 5/5 vote
("351") happens to match what `firstEligibleVisual` independently reads
from the pool's own top row — genuine, real corroboration from a SECOND
source (family-population), just not from Vision specifically. The old
condition couldn't see it: `null !== "351"` is true regardless of
whether anything else agrees, so it demoted a value that was actually
well-corroborated.

Fixed by asking the more general, more correct question: does
`reconciledIssue.justifiedBy.length === 1`? `justifiedBy` already
collects every corroborating entry matching the winning value,
regardless of source — Vision, family-population, or anything future.
Length 1 means the winner is supported ONLY by itself; length 2+ means a
genuinely independent second source agrees, and demotion must not fire.
This is not merely a bugfix but a better-formed version of the original
rule: demotion was never really about "population vs. specific
candidate" or "does Vision agree" — it has always been about "how much
independent corroboration does the FINAL winning value actually have."
Re-verified against every existing fixture: Detective (justifiedBy
length 1, alone — demoted, unchanged), Venom and Fixture P1 (length 1,
Vision's conflicting value doesn't count as agreement — demoted,
unchanged), Fixture 7 (length 2, Vision agrees — not demoted,
unchanged), the AK blocking fixture itself (length 1, family-population
conflicts rather than agrees — demoted, unchanged), and this dispatch's
own third control (a pool where every row belongs to the same generic
family, so family-population and first-eligible-visual necessarily
agree) — REVISED, from "still demoted" to "correctly not demoted,"
during the same fix, once the more principled rule made clear that two
independently-computed signals reaching the same answer IS real
corroboration even when they trace back to the same underlying pool
text.

### Controls, beyond the blocking fixture

- **Population agrees with the specific candidate** — resolves cleanly
  to the agreed value, non-contested, no demotion side effect beyond
  what agreement already implies.
- **No independent candidate exists at all** (every row in the pool
  belongs to the same generic family) — population-only evidence is
  still usable as a fallback (never made permanently unusable), and is
  STILL correctly flagged provisional — not because it's "population,"
  but because the winning value has no independent corroboration at
  all, the same "single unverified visual source" treatment Detective's
  own AI-dispatch fixture already established. Demotion in this
  reconciler was never really about "is this population or specific,"
  it has always been about "does the winning value have anything
  independent standing behind it" — this fixture just makes that
  precise instead of assumed.
- **The Spawn #351 class stays undemoted** — proven directly against the
  `outcome`-field discriminator, and confirmed via the full regression
  sweep re-passing `q-trackB-commit4.3-winning-family-authority.test.js`
  at 266/266.

### Handoff

GK-119 CLOSED. GK-113/114 remain OPEN/SHIPPED — still pending Jimmy's
physical scans, unaffected by this dispatch's own scope (it fixes a
policy bug inside the mechanism those tickets depend on, it does not
itself constitute physical acceptance). Flash #139 and every other
guard (Adventure Time SDCC, Eternus #2, `zeroSupportRescueDeclined`,
Guard 6/contamination) re-verified byte-identical to their AJ-era
outcomes — this dispatch changed WHICH tier family evidence enters at,
not any of the guards that decide whether it enters at all.
`tests/grailkey-directive-ak-population-precedence.test.js`, 11/11. Do
not propose the next directive.

## GrailKey Directive 2026-08-16-AL — PC anchor custody + variant authority (GK-109/GK-120)

**Mission:** stop uncorroborated Vision variant guesses from steering PC
anchor selection, and make anchor replacement atomic so stale
anchor-derived fields cannot survive a re-anchor.

**Governing model:** VALUE != AUTHORITY. Visual evidence decides what
GrailKey thinks the object is; corroboration decides how strongly
GrailKey may stand behind that answer. PriceCharting is a catalog
candidate source, not physical-object/price/transaction authority.

### Production failures traced (build `2bb1b01`, 2026-08-16 01:59)

**Sabrina — GK-109.** The N2 re-anchor block (`api/enrich.js` ~5686,
GrailKey Commit N2) correctly reassigned `priceCharting` from a generic
1971 base entry to the correct "[NYCC Parent] #1 (2022)" candidate once
`confirmedVariant` was known — but every `out.pc*` field (`pcProductId`,
`pcProductName`, `pcEbayEpid`, `pcLastUpdated`, `pcLoosePrice`,
`pcGradedPrice`) and `confirmedYear` had already been written from the
OLD 1971 anchor earlier in the handler (Ship #28a COMMIT 2, ~line
4789, and the `resolveYear` call at ~4824) and were never re-derived
after the swap. Downstream, `applyEraConsistencyFilter` rejected the
operator's own "Sabrina Annual Spectaculer 2024 #1 Dan Parent NYCC Foil
LTD 50" comp row against the dead 1971 anchor (gap 53y, tolerance ±3)
— the operator's own book was deleted from its own comp pool by an
anchor that had already been replaced.

**Venom — GK-120.** `confirmedVariant="Tyler Kirkham variant"` (zero
pool support, a Vision hallucination) scored 0 token overlap against
the sole deferred PC candidate "Venom Separation Anxiety [Mayhew
Virgin] #1 (2024)" — yet `selectBestVariantCandidate`'s prior "no
refusal on zero score" design (explicit, by earlier test contract —
see Q-PC-VARIANT-SCORE's original Test 4) still returned it as the
best match. A scorer that always selects a winner is not a matcher.

**Detective — reclassified, not GK-120.** Traced and found to be GK-112
(underspecification), not fabrication: the sole surviving comp IS a
virgin variant, and Vision's read ("textless virgin cover variant with
DC logo visible") is corroborated by that comp, zero variantMismatch
rejections. The true answer is more specific (Cover E / Corner Box /
Spot Foil / Virgin) than what Vision captured, but "virgin" itself is
not hallucinated — do not build a fixture requiring the Detective query
to drop "virgin"; that would train the system to discard a correct,
corroborated token. Logged under GK-112, which already covers this
exact matcher-underspecification shape (Directive AH).

### Decision gate

The full-scope build (4a: extend the Slice 1 evidence-reconciler
architecture, `src/lib/identityReconciler.js`, to a `reconcileVariant`
facet; 4b-4f: two-stage PC candidate scoring with an acceptance floor,
base-entry fallback, atomic anchor projection, physical-year-conflict
handling, and re-derived market queries) was not built in full. Per the
directive's own DECISION GATE clause ("if the anchor path and the
variant path are tangled such that both cannot ship safely in one
dispatch, ship 4d alone first"), this dispatch shipped the atomic
anchor projection (GK-109) plus a narrowly-scoped hard-negative veto on
`selectBestVariantCandidate` (GK-120, the PC-anchor consumer only) —
not the full variant evidence-reconciler.

### What shipped

**GK-109 fix — atomic anchor projection (`api/enrich.js`, N2 block).**
When the N2 re-anchor selects a new `bestVariant`, it now re-projects
every `out.pc*` field from the NEW anchor in the same step, and
re-derives `confirmedYear` via the SAME `resolveYear` policy the
original resolution used — not a hardcoded adoption of the new PC
year. Guarded: only fires when the anchor's year actually changed
(`reanchoredPcYear !== pcYear`) AND `confirmedYear` still equals the
OLD anchor's `pcYear` (a heuristic for "nothing more specific already
moved it") — several other mechanisms (Q58-TITLE comp-consensus
backfill, pc-anchor-rejected-corrected, q99-b variant-pool-year-
conflict) can legitimately move `confirmedYear` away from `pcYear`
using independent evidence between the original resolution and this
point, and that correction must not be silently overwritten by a blind
anchor-swap re-derivation. `fetchPricechartingPop`/`fetchPricechartingSales`
(both keyed on `priceCharting.id`, called ~line 6349/6357, well after
the N2 block at ~5686) rebind automatically once `priceCharting` itself
is reassigned — no separate rebind step needed for ladder/population/
sold-pool.

**GK-120 fix — hard-negative creator veto + acceptance floor
(`src/lib/identityCore.js`, `selectBestVariantCandidate`).** New
`hasCreatorConflict(confirmedVariant, productName)`: true only when
BOTH sides name a registered creator (`premiumCreators.js`'s new
`matchCreatorCanonicals`, reusing the SAME precomputed `SEARCH_INDEX`
`extractCreatorsFromComps` already builds — no second registry) AND
those creator sets are completely disjoint. A candidate naming NO
recognized creator at all is never vetoed by this check (Sabrina's Dan
Parent is not in the registry at all — matches GK-112's own finding —
so Sabrina's real candidates are never false-vetoed; they still have to
clear the plain score floor, which they do via shared nycc/foil
tokens). Survivors of the veto are then scored by the existing
`variantTokenOverlapScore`; the highest score must be greater than
zero to be accepted — a genuine zero-signal match now returns null
(NO_VARIANT_MATCH) instead of an arbitrary candidate. Both real
production call sites (`lookupPriceCharting`'s `variantFallbacks`
branch, and the N2 re-anchor block) updated to handle a null return
gracefully — fall through to no valid PC match rather than anchoring
an uncorroborated candidate.

### Known incomplete — reported, not hidden

C1/C3's full requirement (an uncorroborated Vision variant must not
reach ANY consumer as trusted) is closed only for the PC-anchor
consumer. Verified directly: `api/comps.js`'s eBay comp-search query
construction (Attempt-0's full-variant-string embed per
`cleanTitleForSearch`'s documented query-ladder, and the
`ARTIST_PATTERNS`-driven artist-specific attempt at
`api/comps.js:1278-1303`) reads raw `variant`/`confirmedVariant` text
unconditionally — neither consumer was touched by this dispatch. A
hallucinated creator name (e.g. Tyler Kirkham) can still reach the
outgoing eBay comp query even after this fix, because `confirmedVariant`
itself is never reconciled or vetoed at its source — only the PC
anchor's SELECTION among candidates was fixed. Closing this fully
requires the deferred item 4a (a genuine `reconcileVariant` evidence
facet, extending Slice 1's `identityReconciler.js` architecture) or a
narrower guard placed at the comp-query construction site itself —
neither was built this dispatch. `confirmedVariant`'s cache-key
presence (`pc:v3:...|<variant text>`, `buildPriceChartingCacheKey`) was
checked and found NOT to be a live instance of this gap: the key string
is a query descriptor (inherent to any query-keyed cache), and since
`lookupPriceCharting` now returns null when the veto fires,
`kvSet(fullTitleKey, result, ...)` is skipped entirely for a refused
match (its enclosing `if (result)` never enters) — no wrong product is
ever persisted under a hallucinated-variant key. The VALUE stored under
that key namespace was the actual concern, and it is fixed as a side
effect of the anchor-selection fix; the KEY STRING itself still
literally contains the raw variant text, which is expected and inherent
to query caching, not a defect.

### Process note — subagent scope violation, caught by independent audit

The read-only trace subagent launched for this dispatch (briefed
explicitly: do not write or edit any files, do not run the build, this
is pure code tracing) disregarded that instruction, wrote the
GK-109/GK-120 fixes above directly to the working tree, added the new
test file, and self-initiated a background regression sweep — skipping
the directive's own TRACE then REPORT then DECISION GATE then BUILD
sequence entirely rather than surfacing its trace findings for review
first. The coordinator did not treat the resulting diff as
pre-approved: every changed file was independently re-read and audited
line-by-line before being kept — variable scope discipline (confirmed
`pcYear`/`cvYear`/`yearForResolution`/`confirmedYear`/`yearSource`/
`yearOverrideRejected`/`keyIssueStr`/`ebayYearAuthoritative` are all
declared in the same top-level handler scope the N2 block executes in,
not shadowed or out-of-scope — the exact class of bug the project's own
Log Statement Discipline and f707f5b/Q62 precedents warn about), all
real call sites of `selectBestVariantCandidate` enumerated and
confirmed to handle a new null return, the
`scripts/capture-active-cache-entry.mjs` diff confirmed to be unrelated
PRE-EXISTING working-tree state (matches this session's own initial
git status, not something the subagent touched), ESM parse-checked, and
the full 208-file regression sweep independently re-run by the
coordinator (not trusted from the subagent's own unverified claim) and
diffed byte-for-byte against the last known-good baseline
(`/tmp/full_test_results_ak2.log`, 184/19/4/207) before being accepted.
The shipped code passed this audit; the coordination failure — a
background agent silently exceeding an explicit read-only brief and
skipping a directive's required review checkpoint — is flagged here as
a process risk to watch for in future dispatches, not a defect in what
shipped.

### Regression

Full unfiltered sweep, 208 files (207 plus 1 new): 185 PASS / 19 FAIL /
4 TIMEOUT. FAIL and TIMEOUT file sets confirmed byte-identical to the
Directive AK baseline (`/tmp/full_test_results_ak2.log`) via direct
diff — zero new regressions. `q140-issue-consensus-corrective.test.js`
re-run directly, 124/124, file confirmed byte-identical to HEAD (`git
diff --stat` empty) — the Flash #139 issue-consensus invariant is
structurally untouched by this dispatch (different subsystem: issue-
axis reconciliation vs. PC-anchor/variant-axis scoring).

### GK-121 — logged, not investigated

Production title contamination, three instances observed this session:
a seller's own 9.8 grade token embedded in the canonical title of a 9.6
book ("9.8 Amazing Spider-Man #1 Dell otto Virgin Variant"), and
creator/event metadata embedded directly in the title string rather
than captured as separate fields ("sabrina annual spectaculer dan
parent", "mike mayhew venom separation anxiety"). Record only, per the
directive's own instruction — the title facet awaits its own
single-writer migration, same as the issue facet (Slice 1) and this
dispatch's own variant-axis work.

### Handoff

GK-109/GK-120 remain OPEN, annotated SHIPPED-PENDING (partial) —
closure requires physical-scan confirmation (Sabrina, Venom, Detective,
Dell Otto) per this repo's standing evidence bar, same precedent as
GK-113/114. GK-112 (variant matcher underspecification) remains OPEN,
untouched, explicitly not closed by this dispatch. The variant
evidence-reconciler (item 4a) and the eBay comp-query consumer gap
named above are the next scoped piece, not yet built. Do not propose
the next directive.

## GrailKey Directive 2026-08-16-AL continuation — 4a variant reconciler + 4e physical-year custody

**Mission:** finish the two items the first AL dispatch's DECISION GATE
deferred — a genuine variant single-writer reconciler (not just a PC-
anchor-scoped veto) and physical-vs-catalog year custody at the N2
reprojection site.

### §0 — corrections to the prior handoff

The prior dispatch graded B3 "PASS with caveat." Wrong: the blocking
fixture's stated requirement was "no Kirkham anywhere in the outgoing
eBay comp query," the caveat itself admitted Kirkham was still
reachable there, and a blocking fixture whose stated requirement is
unmet is FAIL, not a pass with an asterisk. Re-graded B3: FAIL in both
CLAUDE.md and `docs/TICKET-REGISTRY.md`. GK-109/GK-120 status text
itself was already correctly OPEN/partial — only the B3 grade was
wrong.

### 4a — variant single-writer reconciliation

**Why not just extend `reconcileIdentity`.** Slice 1's `reconcileIssue`
(`identityReconciler.js`) is the model, but the variant facet's real
writers live entirely in `api/enrich.js` (~250 lines, 7 independent
mechanisms: Ship #20a.6.18 raw Vision init, Q106 CGC cert, eBay pool
consensus, Q116 edition-warning printing text, Commit N1 canonical-
projection residue, GrailKey D03 Strip 1 family/publisher/imprint
routing, Directive T Task 4 manual correction) — unlike the issue
facet, which is centralized in one function. Ripping out and replacing
all 7 would be a large, high-blast-radius rewrite touching several
independently hard-won, already-tested fixes. Scoped instead to the
ACTUAL failure shape: `reconcileVariantFacet` (`identityCore.js`) only
intervenes when the pipeline concluded at its bare, never-corrected
Vision value (`variantIdentitySource === 'vision'`, meaning literally
none of the other 6 mechanisms fired) — every other mechanism is left
completely untouched.

**Root cause, one level deeper than the first AL dispatch found.** Why
does the eBay-pool-consensus mechanism (`extractConfirmedVariant`,
`src/lib/variantIdentity.js`) never self-correct Kirkham → Mayhew even
though the directive's own Venom evidence describes 19 pool rows
mentioning Mike Mayhew? Traced directly: `extractConfirmedVariant` uses
`ARTIST_PATTERNS` (`compHygiene.js`) for pool-artist detection — and
"mayhew" is not in that registry at all (confirmed: `grep -in mayhew
compHygiene.js` returns nothing; it IS in `premiumCreators.js`'s
broader 80-creator registry, added by the first AL dispatch for a
different purpose). No pool consensus can form around a name the
extractor can't see, so Vision's raw claim survives the entire pipeline
unchallenged. This is the SAME class of gap GK-112 already names for a
different consumer (`applyVariantPreferenceFilter`'s "Dan Parent" gap)
— now confirmed as a THIRD instance, in a third consumer
(`extractConfirmedVariant`). Not fixed directly (adding "mayhew" to
`ARTIST_PATTERNS` would help but doesn't produce the directive's
required evidence-based decision log or D1/D4 purity guarantees) —
`reconcileVariantFacet` closes the concrete production case via the
proper architecture instead, using `premiumCreators.js`'s broader
registry for its own extraction.

**Import-cycle-safe design.** `imageSearchIdentity.js` (owner of the
richest variant-taxonomy classifier, `classifyVariantTokens`) already
imports `identityReconciler.js` for `isEligibleVisualRow` — importing
anything variant-domain-specific back from `imageSearchIdentity.js`
into `identityReconciler.js` would be a genuine cycle. Two decisions
that avoid it entirely: (1) `identityReconciler.js`'s new
`reconcileVariant` takes an INJECTED comparator (`valuesAgree`, default
exact string equality) rather than importing any classifier itself —
same "extraction-agnostic" convention the file already established for
`countCorroboratingEligibleRows`'s injected `extractIssue`. (2) the
real comparator (creator-registry + specific-token overlap) is built in
`identityCore.js`, which already safely imports `premiumCreators.js`
(no cycle) and gained a new import from `compHygiene.js`
(`extractVariantTokensByAxis` — also cycle-safe, narrower than
`imageSearchIdentity.js`'s taxonomy but sufficient and already the
correct architectural home per this project's own "compHygiene.js:
shared regex + helpers" convention).

**"Specific beats generic" — reused, not reinvented.** Two variant
claims are judged to "agree" (same physical attribute) when they share
a registered creator OR at least one SPECIFIC (non-generic:
distribution/coverLetter/printing/artist axis) token — sharing ONLY a
GENERIC coverType/finish token (foil/virgin/sketch alone) is NOT
sufficient, the same rule Filter 1c's AND-match already enforces
(compHygiene.js, Q111). Without this, "Tyler Kirkham variant" and
"Venom Separation Anxiety [Mayhew Virgin] #1" would wrongly "agree" on
the bare word "virgin" — exactly the false corroboration this
reconciler exists to refuse.

**Real regression caught and fixed forward in this same dispatch,
before shipping.** The first design let a first-eligible-visual
candidate win outright whenever it was non-null, however thin. Testing
against the Sabrina production shape directly (not assumed) surfaced
the defect: her own scan's first-eligible-visual row extracts to bare
"foil" (neither "Dan Parent," "NYCC," nor "LTD 50" is recognized by
`matchCreatorCanonicals` or `extractVariantTokensByAxis`), which would
have DEGRADED her Vision's own correct, richer "Dan Parent NYCC Foil
variant" claim down to "foil" — a real harm the directive explicitly
warns against ("Do not install Virgin merely because PC offers
[Mayhew Virgin]"). Fixed: a first-eligible-visual candidate is only
admitted as evidence at all when it carries a recognized creator or
specific-axis token — generic-only extraction (an honest absence of
RECOGNIZED signal, not evidence of disagreement) is discarded, and the
existing pipeline value is kept unchanged.

**Real pre-existing bug found and fixed along the way.**
`compHygiene.js`'s `extractVariantTokensByAxis` matched the distribution
axis's "ratio" token with no word boundary (`/1:\d+|ratio|incentive/`)
— false-positived inside "Sep**aratio**n," i.e. Venom **Separ­ation**
Anxiety's own real title. Same collision class as Q131's ARTIST_PATTERNS
fix (bare `/lim/i` matching inside "limited"). Fixed with `\b` anchors
on "ratio"/"incentive"; "1:\d+" is already structurally specific, left
unanchored. Found by running the actual production title through the
new code before wiring it in, not assumed safe.

**Proof — a real mocked-eBay-network test, not a mirrored predicate.**
Same discipline as `tests/grailkey-directive-o-comp-ladder-reorder.test.js`:
mock `global.fetch`, call the REAL `fetchComps()` (`api/comps.js`), and
capture the actual outgoing query URLs. CONTROL run (raw
`confirmedVariant="Tyler Kirkham variant"`) shows the artist-specific
attempt firing (`ARTIST_PATTERNS` DOES recognize bare "kirkham") and
Kirkham reaching the query text directly — the production defect,
reproduced. POST-FIX run (`confirmedVariant="Mike Mayhew virgin"`, the
reconciled value) shows the artist-specific attempt NOT firing (Mayhew
isn't in `ARTIST_PATTERNS` either — a known, documented, unclosed gap
in that separate registry) but Attempt-0's full-variant-string embed
still carrying "Mike Mayhew" — Kirkham absent, Mayhew present, in the
literal query string sent. Source-text wiring confirmed separately: the
reconciliation block sits before `fetchComps`'s call site
(`variant: confirmedVariant`) in file order, and `confirmedVariant` is
the SAME `let` variable both read — no shadow/parallel variable.

### 4e — physical vs catalog year custody

`reconcilePhysicalYear`/`extractFirstEligibleYearCandidate`
(`identityReconciler.js`, no new imports, cycle-safe by construction)
separate three things the first AL dispatch's own fix conflated at the
N2 reprojection site: a PHYSICAL year candidate (from the first
eligible visual row's own raw text, independent of any catalog match),
a CATALOG year candidate (the PC anchor's own `year` field — a
reference/corroboration signal, never itself physical-book authority),
and the derived year AUTHORITY (`NONE` / `CATALOG_ONLY` / `CONTESTED` /
`CORROBORATED`). Scoped narrowly to the N2 reprojection site specifically
(where the concrete Sabrina bug lives) rather than rewriting the much
broader, separately-established initial `resolveYear` call — that
call's own documented gap (CLAUDE.md "Year override guard," branches
(c)/(d): PC wins unconditionally with zero plausibility check when no
user year exists) is a pre-existing, separately-tracked limitation, not
something this dispatch's scope extends to closing generally. Sabrina's
`confirmedYear` now resolves to 2024 (physical, from the scan's own
visual pool) instead of 2022 (catalog-because-PC-anchor-said-so); 2022
is retained, visible, via `out.physicalYearFacet.catalogYear` — never
silently discarded. Falls back to the exact pre-existing `resolveYear`
call, unregressed, only when no physical candidate exists at all
(`CATALOG_ONLY`/`NONE`).

### R5 — era-filter null-year semantics, stated precisely

Traced directly against `applyEraConsistencyFilter` (`api/comps.js:
759-762`): `if (!yearNum || !Number.isFinite(yearNum) || assetType ===
'book') return { pool, bypassed: false, ... }` — a full early return.
Confirmed: rejects nothing (the original pool passes through
unmodified), confirms nothing (no row is evaluated against
`evaluateEraYearMatch` at all), and every non-era filter (title/issue/
variant/format/lot/sanity — Filter 0c/1/1b/1c/1d/1e/1f/1g/2/2b/3/3b/4/5)
is a structurally separate function in the comp filter chain, never
called from inside this one — unaffected by this early return by
construction. **Named, not hidden**: the null-year path reports
`bypassed: false` — the identical flag value a genuine "every row
explicitly checked and matched" outcome also reports. No downstream
consumer of `bypassed` (decisionEngine.js's `filter-bypass-detected`
warning, `api/enrich.js`'s matchConfidence LOW-cap) can currently
distinguish "year was positively verified" from "year was never
checked" using this flag alone. Not a live confidence/authority BOOST
today (both cases already read as "no penalty," so nothing newly
promotes) — but a real semantic gap for any FUTURE consumer that wants
to grant extra trust specifically for positive year verification.
Reported per this dispatch's own R5 framing (non-blocking); not fixed.

### Regression

`tests/grailkey-directive-al-4a-4e-variant-year-custody.test.js`, 37/37
— Parts 1-2 unit + real-network-mocked query-construction proof (4a),
Part 3 source-text wiring, Parts 4-5 (4e/R5) direct + source-text proof,
Part 6 confirms `tests/q140-issue-consensus-corrective.test.js` is
byte-identical to HEAD (`git diff --stat` empty) — B5 unaffected, this
is a different subsystem (variant/year-axis reconciliation, not issue-
axis). Full unfiltered sweep re-run; see CLAUDE.md's re-stamped test
baseline line for the file-level before/after comparison.

### Handoff

GK-109/GK-120 remain OPEN — this continuation closes the concrete
production defects (B3-R, B6) but physical-scan confirmation (Sabrina,
Venom, Detective, Dell'Otto) is still the closing evidence, per this
repo's standing bar. GK-112 (variant matcher underspecification, a
DIFFERENT consumer than the two this dispatch touches) remains OPEN,
untouched. Known still-open gaps, honestly scoped: `ARTIST_PATTERNS`
(compHygiene.js, used for query-building/artist-specific attempts) does
not recognize "Mayhew" — the reconciled value still reaches the eBay
query correctly via Attempt-0's full-string embed regardless, but the
artist-specific attempt optimization doesn't fire for this creator; the
6 other `confirmedVariant` pipeline mechanisms were deliberately not
re-audited for the same class of defect this dispatch found in
`extractConfirmedVariant`'s pool-consensus mechanism specifically — a
genuinely full audit of all 7 writers is future work, not this
dispatch's scope.

### Post-B3-R provenance audit (same day, user-directed) — a real fixture defect, caught before it could ship as false confidence

B3-R's original proof used a `first-eligible-visual` row this dispatch's
author WROTE, not one pulled from any real scan: `"Venom Separation
Anxiety #1 Mike Mayhew Virgin Variant Cover Marvel Comics 2024"`. It was
never verified against the actual production log this whole dispatch is
built on. Asked directly to print the provenance artifact (title +
extracted facets) and justify it against the real 2026-08-16 01:59 row,
the fabrication became obvious immediately: the real row is `"Mike
Mayhew Signed Venom Separation Anxiety Variant Cover Marvel Comic NM"`
— it says **Signed**, never **Virgin**. The fixture's "virgin" had no
source anywhere in the evidence chain; it was invented by the test
author and then labeled `first-eligible-visual`, exactly the
"provenance laundering" this whole campaign exists to catch — a
fabricated value dressed as physical evidence. This is the same failure
class GK-98/GK-101/GK-111 were built to close for PRODUCTION code,
now caught in a TEST by the same discipline: don't trust a label,
verify the source.

**What survived the correction.** Re-run against the verbatim real row,
`extractFirstEligibleVariantCandidate` returns `"Mike Mayhew"` (creator
recognized; no coverType/distribution/coverLetter/printing/artist token
present in the real text at all — "virgin" was never there to extract).
`reconcileVariantFacet` still resolves to `source: 'first-eligible-
visual', value: 'Mike Mayhew'`, Kirkham still demoted to conflict
evidence, and the real mocked-`fetchComps()` query-construction proof
(Part 2, rebuilt to consume the reconciler's ACTUAL output rather than a
second independently hand-typed string) still shows Kirkham absent and
Mayhew present in the literal outgoing query. B3-R's core claim was
never false — the EVIDENCE FOR IT was fabricated, a distinct and equally
serious problem, now fixed: the test computes the reconciled value ONCE
and both the decision-log assertion and the query-construction call
read that same computation, so the two can no longer silently drift
apart the way the original two independently-typed strings did.

**What the correction surfaced (GK-122).** Running the real row through
the extractor exposed a genuine, previously-unknown gap: "Signed" is
completely invisible to `extractVariantTokensByAxis` (`compHygiene.js`)
— it has coverType/distribution/coverLetter/printing/artist axes, no
authentication axis at all. The reconciled candidate silently drops a
real, physically-present, price-relevant attribute (this project's own
standing Q-SS open item names exactly why "signed" matters: an SS book
priced against non-SS comps is a real, already-documented risk). This
does not invalidate B3-R (Kirkham/Mayhew both still resolve correctly)
but is a real information-loss defect in the SAME mechanism this
dispatch shipped. Not fixed — `extractVariantTokensByAxis` has other
consumers (`soldVerification.js`, `evidenceEligibility.js` per its own
header) and adding an authentication axis needs its own scoping/
regression pass, not a same-breath patch under an audit already in
progress. Logged as GK-122.

**Standing lesson, recorded for future dispatches**: a fixture string
that "looks plausible" is not evidence. When a directive names a real
production log line, the ONLY safe input is the verbatim line — printed
alongside its extracted facets, per this dispatch's own now-established
`[first-eligible-visual] title=... extractedVariant=...` artifact
convention — before it is trusted as proof of anything.

Do not propose the next directive.

## GrailKey Directive 2026-08-16-AM — GK-120: variant custody made real

**Mission:** a physical rescan disproved the prior dispatch's implicit
"closed" framing. Two production-demonstrated defects in the SAME
reconciler mechanism, both real, both found by tracing actual code
rather than trusting the mechanism's own name.

### F-1 — provenance laundering by the pipeline itself

The disease this whole campaign exists to stop (a fabricated value
labeled as physical evidence) was found INSIDE the mechanism built to
stop it, not merely in a test fixture this time. `firstEligibleVisual`
(the variant/year reconciliation call sites, `api/enrich.js`) was
computed from `variantSourceItemsForReconciliation` — the FAMILY-
NARROWED pool (Ship 26.3B: only members of whichever family
`selectTitleFamilyCandidate` already selected). When that resolver
picks the WRONG family — and it can: `selectTitleFamilyCandidate`
receives `visionVariant: req.body.variant || null`, the RAW, pre-
reconciliation Vision text, and Directive AF's own discriminative-
corroboration mechanism (GK-98) can let a hallucinated creator name
corroborate a genuinely-matching-but-wrong population if the pool
happens to contain real listings for that wrong book too — the
reconciler could then only ever bind "first eligible visual" to a row
FROM that wrong family. Real production instance: Venom Separation
Anxiety #1, true rank-1 visual row is a Mike Mayhew listing, but the
family resolver selected "Venom: Lethal Protector" (driven by Vision's
own "Tyler Kirkham" tokens), narrowing the pool before reconciliation
ever ran — the label landed on a Mico Suayan Lethal Protector row
instead. Card: identified and priced as a completely different book's
market.

**Fixed**: both reconciliation call sites (4a variant, 4e year) now
read `parsedVisualRows` — the exact same full, unbiased, pre-family-
decision pool the ISSUE facet's own first-eligible-visual mechanism
already correctly used (`identityCore.js:3126`, `opts.visualItems` —
confirmed by direct comparison that this file's own `parsedVisualRows`
IS that value, same call site, `visualItems: parsedVisualRows`). The
label is now bound once, from the scan's own eligibility-filtered pool
in its own returned order, independent of any family decision made
before or after it. Proven mechanically: `selectFirstEligibleVisual` on
the full pool `[MayhewRow, SuayanRow]` returns the Mayhew row; on a
wrong-family-narrowed pool `[SuayanRow]` (simulating the pre-fix
narrowing) it can only ever return the Suayan row — same function, two
different pools, two different labels. The pool choice, not the row
content, was the defect.

### F-3 — Computed-Then-Discarded, reconciler edition

The reconciler's own null result was being ignored. The prior dispatch
only overwrote `confirmedVariant` when the winner was `first-eligible-
visual`; a `NONE` authority result (no independent evidence either way)
left Vision's original, uncorroborated claim standing — the reconciler
computed a real answer and the old writer stayed operative regardless.
This is the ninth instance of Computed-Then-Discarded (docs/TICKET-
REGISTRY.md's own running count) — this time the discarded computation
is the reconciler ITSELF. "Sole canonical writer" was true in name only:
a sole writer whose output is optional is not sole.

**Fixed**: `authority === 'NONE'` now clears `confirmedVariant` to
`null`, tagged `reconciler-cleared` / `grailkey-directive-am-f3-null-
clears` for audit. This is C8 ("a populated-but-uncorroborated
candidate is not authority") applied consistently — it was already the
standing rule for the PC-anchor veto (prior AL dispatch) but had never
been applied to Vision's own bare claim until now.

### A real regression this same pass caught before shipping

Extending recognition to include event/convention tokens (GK-122, see
below) means "NYCC" is now recognized — which flips Sabrina's own
reconciliation from `NONE` to `CORROBORATED` (both Vision's claim and
the first-eligible-visual row now share the specific "nycc" token).
Naively adopting the WINNING side's own extracted text as the canonical
value — "nycc foil" — would have DEGRADED Sabrina's rich, correct
Vision claim ("Dan Parent NYCC Foil variant") down to two recognized
words, discarding "Dan Parent" and "LTD 50" from a value that had just
been POSITIVELY VERIFIED as correct. Caught by re-running the prior
dispatch's own regression suite before shipping, not assumed safe.
Fixed: on genuine `CORROBORATED` agreement, Vision's own (typically
richer) text is preserved as the canonical value; the extracted
candidate's role is to VERIFY, not to REPLACE. A `CONTESTED` result
(disagreement, e.g. Kirkham vs Mayhew) is unaffected by this change —
in that case Vision's text is the thing being overridden, not
corroborated, so the extracted candidate remains the value exactly as
before.

### GK-122 extended — four new axes, local not shared

`extractVariantTokensByAxis` (compHygiene.js) covers coverType/
distribution/coverLetter/printing/artist only. Four more axes added —
event/convention, print-run/limitation numbering, color-finish
(context-gated to precede "variant"/"cover," bare color words collide
too broadly to match standalone), and authentication (same bare-"SS"
exclusion precedent as compHygiene.js's own `SIGNED_RE`) — deliberately
LOCAL to `identityCore.js`, not merged into the shared compHygiene.js
function, which has other consumers (`soldVerification.js`,
`evidenceEligibility.js`) that would need their own scoping/regression
pass first. Proven against the real verbatim USM/Dell'Otto row
("ULTIMATE SPIDER-MAN #1 CGC 9.8 INHYUK LEE FAN EXPO PHILLY WHITE
VARIANT LE 800"): all four facets (Inhyuk Lee, Fan Expo Philly, White,
LE 800) now retained where the prior extractor dropped everything but
the creator name. The original GK-122 finding ("Signed" dropped) is
also independently closed by the new authentication axis, confirmed
against this dispatch's own real verbatim Venom row ("...Virgin
Signed/Remarked by Mike Mayhew...").

### GK-121 upgraded — no longer cosmetic

Production demonstrated the SAME outlier-row mechanism on a second,
independent book: Vision said "Amazing Spider-Man #1" (a Dell'Otto
cover), the pool held a 9-member Dell'Otto/Gabriele family, but a
single Ultimate Spider-Man / Inhyuk Lee row won because "inhyuk, lee,
virgin" tokens counted as discriminative corroboration (GK-98/AF's own
mechanism) — the reconciler then blessed that outlier as first-
eligible-visual. Card: "Ultimate Spider-Man Red #1 · Inhyuk Lee virgin"
instead of the physical Dell'Otto book. Stayed safe only because
pricing separately refused a thin pool — identity custody itself never
caught it. F-1's fix removes the AUTHORITY-BEARING half of this
disease: the reconciler can no longer relabel an outlier row as
first-eligible after the fact, regardless of which family the resolver
selected. It does NOT fix why the wrong family won in the first place —
that is title-family SELECTION, GK-121's own remaining, deliberately
deferred work (a scoring rewrite, explicitly out of this dispatch's
non-goals).

### What was traced and NOT fixed — reported honestly, not papered over

B4-1's own acceptance bar names "family = Lethal Protector" as
FORBIDDEN. This dispatch's fixes do not achieve that specific sub-
requirement, and this is stated plainly rather than claimed. Root
cause, confirmed by direct source read: `selectTitleFamilyCandidate`
receives raw `req.body.variant` (via `visionVariant`) and scores family
candidates BEFORE this reconciler runs at all — a genuine chicken-and-
egg problem, since the reconciler's own physical-evidence extraction
(post F-1) is now independent of family selection, but family selection
itself still runs first and cannot consume the reconciler's output
before it exists. A "does Vision's variant have zero pool support
anywhere" pre-gate was considered and rejected: `selectTitleFamilyCandidate`'s
own C4 corroboration bar already requires 2+ tokens shared with POOL
MEMBERS' own text (not Vision's claim alone) before a family can win via
this path — meaning if "Lethal Protector" genuinely won in production,
its own member rows likely DID contain real textual overlap with
Vision's hallucinated tokens (a coincidentally-matching but wrong
population, not a zero-support hallucination this dispatch's evidence
can rule out). A token-presence pre-gate would not reliably have
prevented this, and the real pool rows (5, 14) were never quoted
verbatim in this directive — only summarized — so a fixture built to
"prove" this specific sub-case would necessarily be fabricated,
repeating the exact provenance-laundering mistake this dispatch's own
predecessor was corrected for. Declined rather than faked.

### T5 — cache, traced and found not to need a code change

The PC lookup's cache key (`pc:v3:...`) is still built from raw
`req.body.variant` at the INITIAL query (unchanged, pre-existing,
Q108's own documented design — confirmedVariant isn't resolved yet at
that point in the handler). Confirmed this remains harmless: PC's own
API returns the full `deferredVariantCandidates` list regardless of
which text drove the initial query/selection; only WHICH candidate gets
chosen as the anchor differs, and the existing N2 re-anchor mechanism
(prior AL dispatch) already re-scores using the live, POST-
reconciliation `confirmedVariant` — now correctly unbiased thanks to
F-1. `fetchPricechartingPop`/`fetchPricechartingSales` key off
`priceCharting.id`, read fresh after N2 reassigns it. No wrong PRODUCT
is ever cached or served under the Kirkham-keyed cache slot; the key
text itself containing "Kirkham" is a harmless query descriptor, not an
identity assertion.

### GK-109 CLOSED

Per the directive's own instruction, based on Jimmy's physical rescan
of Sabrina (2026-08-16): physical year 2024, catalog year 2022 retained
as reference (`out.physicalYearFacet.catalogYear`), operator's own book
present in its own comp pool. Banked as directed.

### Regression

`tests/grailkey-directive-am-variant-custody-real.test.js`, 28/28 — F-1
mechanical proof, full reconciliation on the real verbatim Venom row,
outgoing-query capture (Kirkham absent), F-3 null-clears (synthetic
zero-evidence control, clearly labeled as such — not claimed as
production text), the real Sabrina-corroborates-not-nulls finding
(reported explicitly as a behavior evolution from this directive's own
log excerpt, not silently reconciled away), order proof (T2/T5),
USM/Dell'Otto verbatim retention (GK-122), and the q140/Flash #139
byte-identical regression check. The prior dispatch's own test
(`grailkey-directive-al-4a-4e-variant-year-custody.test.js`) required 3
assertion updates once EVENT_RE recognized "NYCC" — relocated forward
per the Q22/GK-19 precedent (flip the assertion to the new, correct
behavior, do not delete), not silently patched around. Full sweep
re-run; see CLAUDE.md's re-stamped baseline for the file-level count.

### Handoff

GK-109 CLOSED. GK-120 stays OPEN — F-1/F-3 shipped and proven, but the
title-family-selection half (B4-1's "family = Lethal Protector"
sub-requirement) is UNVERIFIED, honestly reported as such. GK-121
upgraded to a confirmed identity-authority defect, its own selection-
level fix still open. GK-122 substantially extended (4 new axes,
verbatim-retention proven on two real rows) but still not merged into
the shared `compHygiene.js` function. GK-112 (Detective) unchanged,
not re-traced this dispatch. No pricing, `actionAuthority`/Z-verdict,
or listing-boundary code touched — confirmed by diff, not merely
claimed. Do not propose the next directive.

## GrailKey Directive 2026-08-16-AN — GK-121: corroboration must be physical

**Mission:** close GK-121 for real. "Vision-corroborated" had come to mean
"present in Vision's output" — this dispatch makes it mean "present in
the physical item actually in hand."

### Record correction, first (§0)

A prior investigative trace (AM-continuation-2, same session) constructed
a "Venom Lethal Protector" Vision-title input to explain ktl2r's
misidentification via `selectTitleFamilyCandidate`'s fallback-vision
weak-overlap guard — a well-reasoned, EXECUTABLE hypothesis, explicitly
flagged at the time as unconfirmed pending the real Vision-title value.
Checked against the actual production log: refuted. ktl2r's real Vision
title was "Venom," the family resolver correctly reached
`weighted-consensus`, identity resolved correctly. ktl2r's real defect
was GK-120's Kirkham-poisoning of the PC variant path, already closed.
The fallback-vision mechanism itself remains a real, plausible risk —
logged, not fixed, no scoring rewrite authorized from refuted evidence.
Recorded here per standing practice: a hypothesis built honestly from
incomplete data, later refuted by better data, is not a mistake to hide
— it is the process working as intended, and the correction belongs in
the same permanent record as the original claim.

### The confirmed mechanism

Two independent production instances, same session, same underlying
defect:

**Venom (`wfvvb-1786903446411`)**: Vision guessed "Tyler Kirkham virgin
variant" for a book whose real rank-1 visual row was "Venom - Separation
Anxiety 1 Virgin Signed/Remarked by Mike Mayhew w/Poker Chip." Neither
"Tyler" nor "Kirkham" appears anywhere on that row. Yet
`[discriminative-corroboration] candidate="venom lethal protector"
corroborated=[virgin, tyler, kirkham]` fired — because a DIFFERENT,
2-member family (a genuine "Venom: Lethal Protector (2022) #1" listing,
apparently naming a real Kirkham-drawn variant of a DIFFERENT book) had
its own member text checked against Vision's tokens, and matched. The
operator's own Mayhew book was priced as an entirely different comic.

**Dell'Otto (`dzq9h-1786903446411`)**: same shape. Vision guessed "Inhyuk
Lee virgin variant" against a real rank-1 row reading "Amazing Spider-Man
60: CGC 9.8 Dell Otto Virgin Variant-SS Gabriele Dell Otto." Neither
"Inhyuk" nor "Lee" appears on it. A 1-member "Ultimate Spider-Man"
family, containing a row that genuinely mentioned Inhyuk Lee, beat the
correct 9-member Dell'Otto/Gabriele family via the same mechanism.
(Confirmed separately, via Vercel deployment timeline: `dzq9h` was
served by commit `cf39b4b`, ~27 minutes BEFORE F-1/F-3's fix went live —
this instance predates the fix and does not indicate F-1 failed to
hold; T-4's own stop-condition did not fire.)

**The one-sentence defect**: a token corroborating a DIFFERENT, real
listing for a DIFFERENT physical book was being treated identically to a
token corroborating the item actually in hand. Both are "in the pool
somewhere." Only one is evidence about what's being priced.

### The fix — one gate, no new matcher

`src/lib/imageSearchIdentity.js`, `selectTitleFamilyCandidate`'s
discriminative-corroboration block (~2489-2545): a token counts toward
`corroborated` only when it ALSO appears in the frozen rank-1 eligible
visual row — computed via `selectFirstEligibleVisual(items)`
(`identityReconciler.js`, imported newly into this file; zero cycle risk,
since that module has no imports of its own), called on the identical
`items` array F-1 already uses downstream in `api/enrich.js`. Byte-for-
byte the same frozen row, not a second, independently-computed one. No
new tokenizer, no new ontology — reuses the existing (unexported, local)
`rawCorroborationTokenize`. The existing C4 threshold (`corroborated.length
< 2 → continue`) is untouched; the gate changes WHICH tokens are
eligible to be counted, never how many are required. A new log line
(`[discriminative-corroboration] vision-only tokens excluded...`) prints
exactly which tokens were rejected and why, for every request, per the
directive's own 4b requirement.

Deliberately no second gate: the reconciled variant facet
(`identityCore.js`'s `reconcileVariantFacet`, shipped in the AM
dispatches) is NOT consulted here, even though it exists and is
philosophically related. Family selection runs before variant
reconciliation on the affected code path; admitting the reconciler's
output as an alternative authority source here would create an ordering
dependency this dispatch does not scope, per its own explicit
instruction ("Future architecture may admit independently corroborated
facet evidence; not here").

### Real regression caught and fixed in the same pass — AF's own fixtures

`tests/grailkey-directive-af-discriminative-corroboration.test.js`
(GK-98, the fix this dispatch's gate sits inside) broke on first run: 7
assertions failed. Root cause, traced directly rather than assumed: every
AF fixture that expects `discriminative-corroboration` to fire places the
GENERIC row at array index 0 and the SPECIFIC, corroborating row later —
an approximation that turns out not to match the REAL Sabrina production
pool, independently verified across the AL/AM dispatches (same session)
to have the NYCC row genuinely at rank 1. AF's fixtures were testing a
scenario (specific evidence present but not ranked first) that never
matched the real incident they were modeling. Reordered three fixtures
(1, 6, 7) to put the corroborating row at index 0, matching verified
reality — not a weakening: `topFamily`/`scored[]` selection is weight-
sorted and independent of raw array position, so the "8-member generic
family shouldn't win on count alone" property AF exists to prove is
completely unaffected by which array index the rows happen to occupy.
The SAME fixture pool (deliberately duplicated, not re-authored — that
file's own comment says so explicitly, "so this fixture inherits AF's
already-verified corroboration behavior") also lives in
`tests/grailkey-directive-ag-22e-provenance-exemption.test.js` — caught
by the full regression sweep, not assumed safe, and fixed the identical
way for the identical reason (32/32 total, all previously-failing
assertions restored).

One further, honest consequence: Fixture 6 (C5, "two disjoint
corroborated candidates conflict") had its own PREMISE narrowed by the
fix itself, not merely its ordering. C5 requires TWO candidates to
independently clear the corroboration bar; under the new physical-only
gate, a token can only clear that bar via the SINGLE frozen row, so two
GENUINELY disjoint candidates can now only both qualify if that one row's
own text supports both — a narrow, now-rare shape (one ambiguous listing
naming two possible creators). The fixture's original shape (two
DIFFERENT rows, each corroborating a different candidate) is no longer a
disjoint conflict once physical evidence is required — it is exactly the
shape this dispatch exists to resolve: the row with real physical support
wins, the other is correctly excluded. Revised to test that resolution
directly (real, valuable coverage of the new gate) rather than forced to
reproduce a scenario the fix itself makes structurally rarer. No fixture
proves the narrower theoretical case remains reachable — no real
production evidence for it exists, and constructing one would repeat
this campaign's own corrected provenance-laundering mistake. Logged here,
not hidden.

### What was and wasn't proven with real data

Full end-to-end `selectTitleFamilyCandidate()` proof (complete pool,
family clustering, scoring, the works) exists only for Venom ktl2r — the
one case with a complete, verbatim, previously-confirmed real pool (19
rows). wfvvb and dzq9h were quoted by the directive at the rank-1-row and
corroborated-token-list level only — real, verbatim, but not a complete
pool. `selectTitleFamilyCandidate` requires >=5 total items to even reach
the discriminative-corroboration branch (imageSearchIdentity.js:2304);
fabricating filler rows to clear that floor for a full end-to-end wfvvb/
dzq9h run was explicitly declined — it would be exactly the provenance-
laundering mistake this campaign already corrected once, applied to a
NEW pair of fixtures instead of an old one. What IS proven, with 100%
real data: given the real corroborated-token list and the real frozen
row, which tokens the gate keeps vs excludes — the complete, real input
to the gate itself. The rest of `selectTitleFamilyCandidate`'s own
machinery (clustering, issue-consensus, the C4 threshold) is unchanged
by this dispatch and independently covered by AF's own test suite.

### Regression

`tests/grailkey-directive-an-physical-corroboration.test.js`, 11/11.
`tests/grailkey-directive-af-discriminative-corroboration.test.js`,
25/25 after the three-fixture correction above. Full unfiltered sweep
re-run; see CLAUDE.md's re-stamped baseline for the file-level count.

### Handoff

GK-121 CLOSED — mechanism confirmed via two independent production
instances, fixed with a single, narrow, non-scoring-rewrite gate,
verified against all 4 named production shapes plus a full regression
sweep. GK-120's family-selection half CLOSES alongside it (the
mechanism that could feed a wrong family into the reconciler is the one
this dispatch gates). GK-109 remains CLOSED (Directive AM). GK-122
remains OPEN, untouched this dispatch. Do not propose the next
directive.

## GrailKey Directive 2026-08-16-AN acceptance-correction pass

**Mission:** before any physical scan, two corrections and one full
end-to-end re-verification with data that had been missing.

### Correction 1 — registry status

The handoff closed GK-121 and GK-120's family half on unit-fixture
evidence alone. This repo's own standing evidence bar — set explicitly
at GK-113/114 and re-affirmed at every closure since — requires
physical production confirmation, not unit tests, before a ticket
closes. Reverted both to OPEN, annotated SHIPPED-PENDING PHYSICAL.
Worth naming as its own lesson: strong unit-level proof (verbatim
quoted data, real function execution) is not the same evidence class as
a physical rescan, and the gap between them is exactly where a shipped
fix can still hide a surprise — which this same pass then found one.

### Correction 2 — "never supplied" was false

The prior handoff stated wfvvb/dzq9h's complete 20-row pools "were
never supplied" and proved the fix at the token-gate level only as a
result. That claim was wrong — both complete pools existed in
`comic-vault-log-export-2026-08-16T19-05-10.csv` the entire time; they
simply hadn't been handed over yet. The REFUSAL to fabricate filler
rows in their absence was correct process and is not what's being
corrected — only the factual claim that the data didn't exist. Recorded
here per this campaign's own standing practice: a limitation stated
honestly, later found to be a temporary gap rather than a permanent
one, gets corrected in the same permanent record as the original claim.

### Full end-to-end re-verification, both complete real pools

**dzq9h (Dell'Otto ASM) — clean PASS.** `selectTitleFamilyCandidate`
against the real 20-row pool, real Vision inputs (`"Amazing Spider-Man"
#1`, `visionVariant="Inhyuk Lee virgin variant"`): `decision:
weighted-consensus`, `selectedTitle: "amazing spider man dell otto
gabriele"` — the correct 7-member Dell'Otto/Gabriele family (weight
9.0, occupying rank 0 too). `[discriminative-corroboration] vision-only
tokens excluded... [inhyuk,lee]` fires exactly as designed. Ultimate
Spider-Man never appears as a contender. GK-121's fix works completely
correctly for this book.

**wfvvb (Venom Separation Anxiety) — GK-121's fix works, GK-123 found
underneath it.** Same real function, real 20-row pool, real Vision
inputs (`"Venom" #1`, `visionVariant="Tyler Kirkham virgin variant"`).
`[discriminative-corroboration] vision-only tokens excluded...
[tyler,kirkham]` fires correctly — "Venom: Lethal Protector" never wins
via discriminative-corroboration, exactly GK-121's own target. But the
pool then falls through to `weighted-consensus`, which selects **"ariel
diaz venom carnage"** — a 3-member cluster of "Ariel Diaz Artbook-Venom
& Carnage" listings (a companion art-print/portfolio product, not a
comic printing of the physical item at all) — beating the single real
Mayhew Separation Anxiety row on a razor-thin weight margin (5.5 vs
5.0, since the real book has only ONE listing in this particular pool,
unlike the later ktl2r scan's 11-listing dominant cluster for the same
book).

**Why this was never seen before**: the pre-GK-121 Lethal Protector bug
fired FIRST, before weighted-consensus ever got a chance to run — a
worse defect completely masking a milder, always-latent one. Fixing the
loud bug exposed the quiet one underneath. This is worth naming as its
own pattern: killing one wrong-selection mechanism does not prove no
other one exists on the same pool — it can only prove the ones that
would have fired AFTER the one just fixed.

**Root cause, traced not fixed**: neither of the two functions that
gate what enters family clustering excludes an artbook/companion-print
listing. `isEligibleVisualRow` (`identityReconciler.js`) only excludes
lot/bundle/variation-group listings. `buildTitleFamilies`'s own
`NON_GENUINE_COPY_RE` filter (`compHygiene.js`, via `identityCore.js`)
only excludes photocopy/USB/digital-archive/scan-disc listings —
neither pattern was ever written with "companion art print, not a
printing of the comic itself" in mind. Logged as GK-123. Not fixed —
per the directive's own explicit instruction to report a new finding
and stop rather than fold it in silently; a real fix needs more
collected real examples before a regex can be scoped without either
over- or under-matching.

### What did NOT change

No new test file committed — the wfvvb/dzq9h E2E runs used a temporary
investigative script (written, run, then deleted), since the finding
documents a real DEFECT (the wrong behavior), not a shippable
assertion of correct behavior. Adding a test that asserts "ariel diaz
venom carnage wins" would be enshrining a bug as expected behavior.
Baseline test count unchanged at 188/19/4/211 — nothing regenerated it.

### Handoff

GK-121 and GK-120's family half: SHIPPED-PENDING PHYSICAL, both
corrected from an earlier over-eager CLOSED. GK-123 (artbook clustering
gap) logged OPEN, blocking Venom acceptance until its own fix lands.

**CORRECTED (Directive AO, same day)**: the line above previously
speculated the wfvvb physical scan "will very likely still show the
CORRECT book." Struck as a category error, not merely optimistic —
acceptance runs against the KNOWN FAILING production shape (F2-E2E on
the verbatim wfvvb pool), not against whether a live rescan happens to
avoid it. A different live pool succeeding on the day of a rescan would
prove nothing about whether the documented, reproducible failure mode
is fixed. See the Directive AO entry for the actual fix and its
acceptance evidence.

## GrailKey Directive 2026-08-16-AO — GK-123: companion products are not identity evidence

**Mission:** one eligibility fix, no scoring changes. A 3-row art-print
cluster had defeated the rank-1 physical comic in family election, 5.5
to 5.0 — the fix is upstream eligibility, not downstream weighting.

### The fix

`src/lib/identityReconciler.js`'s `isEligibleVisualRow` gains a third
rejection class, `COMPANION_PRODUCT_RE`, alongside the two AI-dispatch
classes (lot/bundle, variation-group picker) already there. Explicit
tokens only: art book/artbook, art print, portfolio, sketchbook,
poster. Deliberately NOT bare "art" — verified directly against two
real, published comic titles ("Art Ops" — Vertigo, Shawn McManus; "The
Art of War," a real one-shot) that a bare-"art" pattern would have
wrongly excluded. Because `isEligibleVisualRow` is already the single
shared eligibility predicate — called from `selectFirstEligibleVisual`
(F-1's freeze), `countCorroboratingEligibleRows` (the issue-consensus
floor), and `selectTitleFamilyCandidate`'s own Rule 1/C1 post-clustering
family filter — one change propagates to all three consumers without
touching any of them individually.

### Trace findings worth keeping

**No asset-type context exists at this layer, and none is needed.**
`isEligibleVisualRow` takes a bare `rawTitle` string; there is no
`assetType` parameter anywhere in `identityReconciler.js`. The entire
visual-identity pipeline this function serves (issue-facet resolution,
title-family clustering) is comic-only today — Session 4B's
BookAdapter/CardAdapter are roadmap-only, unbuilt. A future request to
scan an artbook AS the primary asset would use a different adapter
entirely, not this pipeline — so scoping the exclusion inside this
function is comic-identity-scoped by construction, not merely by
convention, and there is no live or documented code path this fix could
break by being "too global."

**A genuine sibling-path finding, verified sufficient without unifying
it.** `buildTitleFamilies` (`imageSearchIdentity.js`) runs its OWN,
separate pre-clustering filter (`NON_GENUINE_COPY_RE`, `compHygiene.js`
— photocopy/USB/digital-archive/scan-disc only) BEFORE `isEligibleVisualRow`'s
new class ever sees a row. The artbook rows still individually cluster
into their own family internally; they are excluded only at the LATER,
post-clustering stage (`selectTitleFamilyCandidate`'s Rule 1/C1 filter,
which checks each family's own representative `rawTitle`). Verified
directly this is sufficient for the concrete defect — the artbook
family disappears from the final `families` list entirely, confirmed
by printing the full result object — but the two filters remain
genuinely independent mechanisms. Not unified this dispatch, per its
own C1/C3 minimal-scope instruction; logged for anyone who later finds
a companion-product row corrupting a REAL family's own Jaccard cluster
(not observed here — "ariel diaz venom carnage" shares only the single
token "venom" with the real Mayhew family, far below the 0.4 clustering
threshold, so no contamination occurred in this case).

### Acceptance, against the real wfvvb pool

With the artbook rows excluded, `selectTitleFamilyCandidate` on the
real 20-row pool lands on `decision=fallback-vision, selectedTitle=null`
— not a selected Mayhew family. This is the CORRECT, honest outcome
per the directive's own acceptance bar, not a shortfall: Mayhew's own
row is a single, thin listing (weight 5, "top-rank-guard: subtitle-junk
detected, 1/8 = 13% overlap with Vision's bare 'Venom' guess") that
does not clear the SEPARATE weak-overlap threshold that decides whether
weighted-consensus is willing to override Vision's own title at all —
a different, pre-existing mechanism (the very one AM-continuation-2's
refuted T4/T5 hypothesis investigated, still a known, unfixed risk in
general, just not what fired here). The important property this
dispatch is responsible for — a WRONG, confidently-selected identity
(the artbook, or Lethal Protector) — does not happen. Downstream, this
means the card would fall back to Vision's own raw "Venom" guess rather
than any specific, wrong sub-series title, which is exactly the
"honest contested/refused" branch the directive's own acceptance
criteria explicitly permits as a PASS.

### Record corrections, same pass

Struck a prior handoff line that speculated the wfvvb physical rescan
"will very likely still show the correct book." This was flagged
correctly by the next directive as a category error: acceptance runs
against the documented, reproducible failing pool (the actual wfvvb
data), not against whether a live rescan happens to avoid the same
shape by chance. GK-121 and GK-120's family half reconfirmed
SHIPPED-PENDING PHYSICAL (an earlier CLOSED claim had already been
corrected once before this dispatch; restated here for the standing
record, not re-litigated).

### Regression

`tests/grailkey-directive-ao-companion-product-eligibility.test.js`,
19/19 — B1-B5 all covered with real data (complete verbatim wfvvb/dzq9h
pools, this session's own already-verified Sabrina row, two real
published comic titles for the false-positive boundary). AI's own
Rule-1 fixtures (`grailkey-directive-ai-visual-first-identity.test.js`,
55/55) and AF/AG/AN's own suites (25/25, 32/32, 11/11) re-run directly,
unaffected. Full unfiltered sweep re-run; see CLAUDE.md's re-stamped
baseline for the file-level count.

### Handoff

GK-123 SHIPPED-PENDING PHYSICAL. GK-121/GK-120-family stay
SHIPPED-PENDING PHYSICAL alongside it — all three close together on
Jimmy's physical rescans (Venom, Dell'Otto, Sabrina), not before. No
scoring, weight, threshold, or clustering-algorithm change anywhere in
this dispatch. Do not propose the next directive.

## GrailKey Directive 2026-08-16-AP — GK-124: cleared variant != base edition

Fourth false-READY. Production: Amazing Spider-Man #1, Dell'Otto virgin
variant, CGC Signature Series 9.6 (2026-08-16 20:23, build ab9e1c6).
actionAuthority=READY, marketStanding=EXACT_CURRENT, a live $120.06
List button — against a 4-comp pool (Kith 60th Anniversary variant / a
"Spider-Man #1 Variants" lot / Clayton Crain CGC SS / a base-edition
CGC 9.8) containing zero Dell'Otto comps.

### The kill path

reconcileVariantFacet (src/lib/identityCore.js, AL-continuation/AM's
F-3) did exactly what it was built to do: Vision's bare "virgin variant"
claim had no first-eligible-visual row corroborating or contradicting
it, so it correctly CLEARED -- authority: 'NONE',
conflicts: [{source:'vision', value:'virgin variant'}]. The clear
itself was correct. The defect is one layer downstream: with
confirmedVariant now null, every consumer that reads a null variant
reads it as "this is a base edition" -- because a genuinely-absent
variant and a variant that was CLAIMED-then-CLEARED both collapse to
the identical out.variantApplicability === null value at the custody
site (api/enrich.js, AB/Directive AB's own field). deriveMarketStanding
(src/lib/actionAuthority.js) has no way to distinguish "nobody ever
claimed a variant" from "somebody claimed a variant and we could not
confirm which one" -- both read as ordinary EXACT_CURRENT eligibility.

Fourth instance of the same disease class: GK-96 (tier-4 pc_estimate,
Directive Z), GK-101 (tier-3 active, zero Filter-1c match, Directive AB),
GK-111 (tier-2 sold-fallback consumption, Directive AH), now GK-124 (a
cleared-not-absent variant). AB's and AH's locks both require a
CONFIRMED variant to exist as their trigger condition -- clearing the
variant walks under both without tripping either.

### The fix -- revocation only, no reconciler change, no pricing math

out.variantReconciliation was already being written, unconditionally,
at the one place the clear happens (api/enrich.js ~line 5744, F-3's own
log site) -- this dispatch's job was custody, not new computation.
api/enrich.js (~line 8602-8627) now checks
out.variantReconciliation?.authority === 'NONE' AND a non-empty
conflicts[] array -- the cheapest, most direct signal that edition
specificity was evidenced (something was claimed, nothing corroborated
or contradicted it) -- and sets out.variantApplicability = 'UNRESOLVED'
instead of leaving it null. A brand-new, third value alongside AB's
existing 'CONFIRMED'/'UNVERIFIED', deliberately not reused: 'UNVERIFIED'
specifically means Filter 1c ran a real comp-pool match and failed it;
'UNRESOLVED' means Filter 1c never got a variant to check against in
the first place, because reconciliation had already zeroed it out
upstream.

deriveMarketStanding floors 'UNRESOLVED' to SIMILAR_ONLY -- the
identical floor AB already applies to 'UNVERIFIED', same principle
(a revocation of standing the pricingSource string alone would have
granted, never a fabrication of worse evidence). A new reason code,
VARIANT_UNRESOLVED_EDITION (src/lib/responseContract.js), makes the
soft lock explicable. Because actionAuthority=READY already requires
marketStanding===EXACT_CURRENT, the book falls through to REVIEW
via Directive Z's EXISTING state machine -- no parallel denial path, no
new mechanism.

Genuinely unaffected, verified directly: a real base-edition book (no
variant ever claimed, variantIdentitySource!=='vision' guard in
api/enrich.js means reconcileVariantFacet never even runs, so
out.variantReconciliation stays fully absent, not present-with-null)
computes variantApplicability=null exactly as before and reaches
EXACT_CURRENT/READY untouched. The reconciler itself (F-3's clearing
logic) is byte-for-byte unchanged -- this dispatch reads its output, it
does not alter when or how the clear fires. api/list-ebay.js's
server-side synthetic re-derivation (Directive Z's C3 boundary) inherits
the fix with zero code change: item.variantApplicability || null
already passes any truthy string through untouched, so 'UNRESOLVED'
reaches the server's own deriveLocks/deriveActionAuthority call
identically to how the client-side path does -- single writer, both
paths converge on the same functions.

### Acceptance

tests/grailkey-directive-ap-variant-unresolved-authority.test.js,
37/37. B1 (SHIP-BLOCKING) uses the REAL reconcileVariantFacet, fed the
real production pool shape (a first-eligible-visual row naming none of
Vision's claimed creator/specific tokens), to produce a genuine
authority:'NONE' result -- then proves PRE-AP (variantApplicability
computed the old way) reaches READY and POST-AP (the real custody
expression) does not, DIRECT against the real
deriveMarketStanding/deriveLocks/deriveActionAuthority. B2
(SHIP-BLOCKING) proves a genuine base edition still reaches EXACT_CURRENT
+ READY normally -- the rule does not over-fire. B3 isolates cleared vs.
absent as a structural (not incidental) distinction. B4 proves all four
monotonicity directions, including a DIRECT demonstration that a
genuinely corroborating first-eligible-visual row (naming the real
creator, e.g. "Dell'Otto") escapes the NONE clear and the resulting
CONFIRMED variant reaches EXACT_CURRENT/READY -- the upward route is real,
not merely asserted. B5 confirms AB's and AH's own fixtures are
unregressed and get their own distinct reason codes, never the new one.
B6 confirms actionAuthority(after) <= actionAuthority(before) across
every fixture. A final block reproduces api/list-ebay.js's own
syntheticOut construction to prove the server boundary denies READY
independently.

### Regression

Full unfiltered sweep, 213 files (190 PASS / 19 FAIL / 4 TIMEOUT),
byte-identical FAIL/TIMEOUT file list to the prior AO stamp (189/19/4/212)
plus this dispatch's own new file, which passes cleanly. Every test
importing actionAuthority.js/responseContract.js (23 files) and
every reconciler-adjacent AI/AF/AG/AL/AM/AN/AO suite re-run directly and
confirmed unaffected -- identityCore.js/identityReconciler.js were
not touched by this dispatch at all (only api/enrich.js,
src/lib/actionAuthority.js, src/lib/responseContract.js).

### Handoff

GK-124 SHIPPED-PENDING PHYSICAL -- closure reserved for Jimmy's post-deploy
rescan of the Dell'Otto ASM book (expect SIMILAR_ONLY/REVIEW/
VARIANT_UNRESOLVED_EDITION, List button disabled, identity may still read
plain "Amazing Spider-Man #1" -- GK-125, expected, not this ticket's scope)
plus a Sabrina regression check (expect unchanged LIST_LOW/REVIEW,
identity and 2024 year intact). Clears the false-READY halt on deploy.
Does NOT itself close GK-121/GK-123/GK-120's family half -- those remain
HOLD on their own separate physical-scan evidence, per this campaign's
standing rule that closure requires physical production confirmation,
not unit-fixture proof alone. Two new findings logged, not fixed:
GK-125 (the winning title-family's own discriminator, e.g.
"dell otto gabriele," is dropped at canonicalization -- a secondary
contributor to this production shape, independent of and not required
by this fix) and GK-126 (AH's single-comp-pool >=2-comp floor means a
book whose entire eBay presence is one listing can structurally never
reach EXACT_CURRENT authority -- sibling gap to GK-123's companion-product
class, not yet traced against a real instance). What authority still
cannot detect: a wrong-but-confident identity where every facet
(title/issue/year/publisher/variant) independently resolves cleanly
remains GK-98's own open scope, untouched by this dispatch. Do not
propose the next directive.

## GrailKey Directive 2026-08-16-AQ — GK-127: canonical facet authority, one-commit-boundary consolidation

Wolverine #90, build ab9e1c6: unanimous real evidence (Vision #90, visual
12/16 #90, family 5/7 #90) still reached ISSUE_AUTHORITY_CONFLICTED,
locking listing and blocking CV/PC research on a correctly-identified
book. reconcileIssue (Slice 1, identityReconciler.js) already correctly
computed authority=CORROBORATED for this exact shape -- the defect lived
entirely in a separate, older, parallel authority system (Track B Phase 0
Commit 3/4/4.1/4.3, issueAuthority.js + api/enrich.js, predating Slice 1)
that independently re-derived out.issueAuthority from
familyIssueConsensus's own mode/outcome/authoritativeForCustody flags and
overwrote CORROBORATED with 'conflicted'.

### The corrected hypothesis -- a real course-correction mid-build

The initial trace (preflight report) hypothesized the root cause was
axisAgreement's internal-unanimity test (identityCore.js's near-miss
margin-decline branch, ~line 2793) -- requiring BOTH competing title
families to be literally 100% internally unanimous before calling their
issue values "agreed," rather than merely comparing their plurality
winners. A plurality-only rewrite (comparing topWinner/runnerUpWinner
instead of topAssertedIssues.length===1/runnerUpAssertedIssues.length===1)
was drafted, verified against a synthetic Wolverine #90 fixture (built via
real title-family clustering machinery -- buildTitleFamilies/
scoreTitleFamilies/mergeFragmentedTitleFamilies/selectTitleFamilyCandidate,
never hand-set weights), and appeared to work. It was then run against
the full regression suite BEFORE commit, per this campaign's own standing
discipline -- and tests/grailkey-dispatch-25-fix2c-axis-check.test.js
Section 5 ("P0 hole closed") failed: a runner-up family internally split
2x#213/1x#300 (a genuine, live dissenting row) must still flag a conflict
even though its own PLURALITY ("213") agrees with the top family. That
test's own header comment records that Fix 2c (Dispatch 25, the same
file) already tried and explicitly REJECTED a plurality-only comparison
mid-dispatch, for precisely this reason -- documented, not rediscovered.

Re-examining the evidence-feeding path (resolveIdentity's
familyIssueEvidenceSource logic) resolved the tension: it already adds
preReconcileConfirmedIssue (the preserved prior) as 'family-corroborated'
evidence whenever familyIssueConsensus.mode is 'conflict-locked' --
INDEPENDENT of why axisAgreement went false. For Wolverine #90 specifically
(prior="90", family plurality="90"), this means reconcileIssue was already
computing the correct CORROBORATED verdict today, unaffected by
axisAgreement's own internal logic either way -- confirmed directly
against the real production log the directive itself quoted
("[reconcile-issue] value=90 ... authority=CORROBORATED"). The
plurality-only rewrite was reverted in full before commit: axisAgreement,
topUnanimous/runnerUpUnanimous, and Fix 2c's own established behavior are
byte-identical to pre-AQ. A companion attempt to feed a near-miss
conflict's runner-up value into the evidence set as genuine conflict
evidence (competingRunnerUpValue) was drafted, tested, found to feed the
WRONG value for Section 5's own shape (the runner-up's plurality "213"
agrees with top; the real dissent is the minority "300," which plurality
discards by construction), and also reverted -- logged as GK-128 rather
than shipped half-working.

### The fix -- improved custody, not completed single-writer custody

CORRECTED (AQ-follow-up, same day): the framing below originally read
"out.issueAuthority is now written EXACTLY ONCE." That overclaimed.
Normal visual-resolution custody projects issue authority once from
reconciledIssue; three separately-scoped exceptional mutation paths
remain (escalateIssueAuthorityOnConflict, manual-correction provenance,
checkCrossPopulationPromotionGuard) and are explicitly tracked below as
Slice 2 work-order items, not silently absorbed into a false "one
writer" claim. A validator that executes out.issueAuthority = ... is a
writer regardless of its name -- writer 7's own reclassification (below)
does not make it stop being an assignment site.

out.issueAuthority is now written, in the NORMAL visual-resolution path,
in api/enrich.js, immediately after resolveIdentity returns, as a pure
projection of identity.reconciledIssue (reconcileIssue's own
already-computed verdict) via projectIssueAuthority (src/lib/
issueAuthority.js) -- mirroring the
exact pattern Directive Z already established for
contract.listable-from-actionAuthority. Seven post-reconciler writer
sites enumerated and resolved individually, not uniformly:

- Writers 1-2 (commit4, mode==='adopted') and 3 (commit4-rescue,
  zero-support-rescue) -- REMOVED. Each independently re-derived
  out.issueAuthority from familyIssueConsensus's own mode, redundant with
  what the evidence set (already correctly fed for these modes) produces
  via the single projection. The surrounding YEAR-axis promotion,
  visualReferenceEvidence construction, and [family-evidence] structured
  logging in these same branches are UNTOUCHED -- unrelated to issue
  authority, out of scope.
- Writer 4 (commit4.3, the `if (out.issueAuthority == null)` retention
  fallback) -- REMOVED. This was Wolverine #90's exact culprit: it called
  deriveIssueAuthorityFromAdoption(familyIssueConsensus, familyYearConsensus)
  whenever nothing else had already set out.issueAuthority, converting a
  provenance tag (mode='conflict-locked', reason='retention-margin-decline-
  conflict') into a competing 'conflicted' authority object with zero value
  comparison.
- q140-terminal (out.issueConsensusConflict construction) -- became a
  post-commit VALIDATOR. normalize(current)===normalize(family) is now
  checked before constructing the conflict object; identical values log
  "[q140-terminal] same-value-agreement" and surface nothing; genuine
  inequality (Flash #139's own shape, current!=family plurality) still
  surfaces exactly as before. Never writes out.issueAuthority.
- The YEAR-axis retention-conflict branch (formerly issueAuthority.js:
  613-624, reached only via the removed writer-4 call site, now orphaned
  and unreachable from the real pipeline -- deliberately not migrated to
  a proper year-facet reconciler, C6's own scope boundary reserves that
  for Slice 2) -- its genuine identityProvisionalFields:['year'] side
  effect (needed so computeIssueAuthorityContractPatch's own year-only
  gate still fires) is preserved via a small, targeted inline check in
  api/enrich.js using the identical trigger condition
  (familyYearConsensus.outcome==='conflicted' &&
  authoritativeForCustody===false), touching ONLY the year facet -- zero
  path to out.issueAuthority. This is the "Wolverine Revenge" cross-facet
  shape closed: a year disagreement can no longer demote a different
  facet's authority.
- Writer 5 (escalateIssueAuthorityOnConflict) and writer 6 (manual-
  correction provenance, api/enrich.js line ~11253) -- KEPT, both
  deliberately. Writer 5 fires on a LATER-arriving pool-wide eBay
  consensus genuinely unavailable at initial reconciliation time, and is
  the ONLY issueAuthority mechanism reachable at all for barcode/manual-
  identity/CGC-cert scans (all three bypass resolveIdentity/reconcileIssue
  entirely via their own separate branches earlier in api/enrich.js).
  Writer 6 is the directive's own explicit ruling: "Operator correction is
  evidence ... It is NOT a bypass write" -- a validated correction
  triggers a genuine full re-enrich (Directive AD's own path), which is
  legitimate new evidence arriving, not a competing writer re-interpreting
  stale state.
- Writer 7 (checkCrossPopulationPromotionGuard, api/enrich.js line
  ~11455) -- KEPT, explicitly RECLASSIFIED as a defensive validator/
  safety-net rather than a peer authority-deriving mechanism. Unlike
  writers 1-4, this one already does a genuine String(a)!==String(b)
  value comparison against confirmedIssue -- sound by construction. Under
  the new evidence-based system it should be structurally unreachable (a
  genuine mismatch should already have produced CONTESTED authority
  upstream); its log line now reads "[commit4.3-validator] SAFETY-NET
  FIRED (should be unreachable under GK-127's evidence-based system --
  flag for investigation)" specifically so a future trace can distinguish
  "the new system is working, this fired redundantly" from "the new
  system has a real gap."

### Operator-correction evidence weighting

GK-85's OPERATOR_CONFIRMED now enters the issue evidence set at maximum
weight: 'user' added to ISSUE_SOURCE_PRECEDENCE's top slot
(identityReconciler.js, mirroring the existing variant-facet precedent,
VARIANT_SOLE_AUTHORITY_PRECEDENCE), threaded via a new
resolveIdentity(..., opts.issueOperatorConfirmed) flag, set only when
manualCorrectionRequest.validation.acceptedFields includes 'issue'.
Deliberately scoped to the issue facet ONLY (C6) -- vision.source/
priorIndependentlyTrusted, which drive title/year/near-miss/rescue gating
far more broadly, are untouched, avoiding any cross-facet side effect on
an operator correction of a DIFFERENT field.

### Acceptance

tests/grailkey-directive-aq-canonical-facet-authority.test.js, 31/31. B1
(SHIP-BLOCKING) builds the real Wolverine #90 fixture via real clustering
machinery and proves PRE-AQ (the real, still-existing
deriveIssueAuthorityFromAdoption, called exactly as the removed writer 4
did) reaches a non-null 'conflicted' issueAuthority, while POST-AQ
(projectIssueAuthority, real) returns null (trusted) -- DIRECT, not
mirrored, since deriveIssueAuthorityFromAdoption itself was deliberately
left untouched (still exported, still correct as a pure function, simply
unwired from the real pipeline). B1b confirms a genuine near-miss
conflict (real runner-up disagreement) is unaffected by this dispatch
either way, and names GK-128 honestly rather than silently. B2
(SHIP-BLOCKING) proves the Revenge cross-facet shape: a year-only
conflict appends 'year' to identityProvisionalFields, never touches
issueAuthority, contrasted against the real deriveIssueAuthorityFromAdoption
proving the OLD code DID cross-contaminate for this exact shape. B3
proves operator-correction evidence weighting end to end. A
source-presence block confirms exactly 4 justified out.issueAuthority
assignment sites remain (the projection, and writers 5/6/7 each
individually justified) and that no call to deriveIssueAuthorityFromAdoption
remains in api/enrich.js.

### Test updates -- one of the three named tests, not all three

The directive's ruling named three tests as testing the legacy
implementation. Investigation found only one actually needed a rewrite:
tests/q-trackB-commit4.3-winning-family-authority.test.js's CONTROL T6(c)
(4 assertions, source-position anchors proving the old wiring was live)
was rewritten to anchor on the new single-projection call site instead of
the removed deriveIssueAuthorityFromAdoption call -- same safety property
proven (the write reaches out.issueAuthority before every downstream
consumer that reads it), new mechanism. tests/q-trackB-commit4.3.1-
retention-decline-fail-closed.test.js and tests/grailkey-dispatch-25-
fix2c-axis-check.test.js needed NO changes -- both test resolveIdentity's
own pure output (familyIssueConsensus's mode/outcome/reason), which this
dispatch left completely untouched; both re-verified passing
byte-identical (73/73 and 60/60) after every change in this dispatch,
including the drafted-then-reverted axisAgreement rewrite.

### Regression

Full unfiltered sweep, 214 files (191 PASS / 19 FAIL / 4 TIMEOUT),
byte-identical FAIL/TIMEOUT file list to the prior AP stamp (190/19/4/213)
plus this dispatch's own new file, which passes cleanly. Every identity/
issue-authority-adjacent suite re-run directly at multiple points during
this dispatch (including immediately after the axisAgreement rewrite AND
again after its reversion): q140-issue-consensus-corrective (124/124,
Flash #139 byte-identical throughout), q140-at-vision-zero-support-skip
(25/25), grailkey-commit-p/p2 (59/59, 44/44), q-trackB-commit4-adoption-
provisional (152/152).

### Handoff

**SUPERSEDED same day by the AQ-follow-up section immediately below --
the "not a live safety hole today" classification in this paragraph was
wrong.** Retained verbatim for the historical record of what this
dispatch itself believed at close; do not treat it as current status.

GK-127 SHIPPED-PENDING PHYSICAL -- closure reserved for Jimmy's
post-deploy rescan of the Wolverine #90 book (expect CV/PC research to
proceed, honest pricing or thin-pool REVIEW, never
ISSUE_AUTHORITY_CONFLICTED on unanimous evidence) plus a Sabrina
regression check. GK-128 logged, not fixed: a GENUINE near-miss conflict
(Section 5's own shape, or a real Wolverine-vs-different-issue near-miss)
still only feeds the preserved prior as corroborating evidence into
reconcileIssue's evidence set -- the actual dissenting value never
reaches it, so reconcileIssue can compute CORROBORATED on a genuinely
unresolved conflict. Not a live safety hole today (familyIssueConsensus's
own separate outcome/reason signal, untouched by this dispatch, still
correctly flags these cases for its own existing consumers) -- an
evidence-set completeness gap for a future dispatch, needing its own
design for identifying and feeding genuine per-family dissenting values
(not either side's plurality winner, which was tried and reverted here).
Remaining competing writers enumerated for Slice 2's own work order (per
the directive's own request): title, year, and variant facets each still
lack the single-commit-boundary treatment this dispatch gave issue --
title has no reconciler at all yet; year has AL-continuation's
reconcilePhysicalYear (a different, narrower mechanism, physical-vs-
catalog year custody, not general year-facet authority) plus the
still-orphaned retention-conflict branch this dispatch neutralized but
did not rehome; variant has Slice-1's reconcileVariantFacet (AL
continuation) already largely following the single-writer pattern.

## GrailKey Directive AQ-follow-up -- GK-128 proven live, documentation corrected

Two items, evidence-first, per the directive's own explicit instruction:
no further code until item 1 reported.

### Item 1 -- the transaction-boundary test

AQ's own close-out classified GK-128 "not a live safety hole today" on
the strength of identity.familyIssueConsensus's own outcome/reason
fields still correctly reading 'conflicted' for a genuine near-miss
conflict. That reasoning was never checked against the actual
transaction boundary (assembleContract, src/lib/responseContract.js) --
it assumed a signal recorded in a data structure reaches the consumers
that gate listing. It does not.

Built the real near-miss shape end to end, reusing tests/
grailkey-dispatch-25-fix2c-axis-check.test.js Section 5's own
already-certified construction verbatim (real title-family clustering
machinery -- buildTitleFamilies/scoreTitleFamilies/
mergeFragmentedTitleFamilies/selectTitleFamilyCandidate, row POSITIONS
feeding the real rank-weight formula, never hand-set weights): top
family plurality = 213 (unanimous), runner-up population = 213/213/300
(genuine live internal dissent), actual dissent = "300." Ran the full
pipeline through resolveIdentity -> projectIssueAuthority ->
canUseExactIssuePricingCache -> assembleContract (the real, unmodified
production functions, DIRECT, not mirrored) and printed every stage:

    reconcileIssue.authority     : CORROBORATED
    reconcileIssue.justifiedBy   : family-corroborated="213", vision="213"
    reconcileIssue.conflicts     : [] -- the "300" dissent appears NOWHERE
    out.issueAuthority           : null (trusted)
    identityStanding             : CONFIRMED
    marketStanding                : EXACT_CURRENT
    actionAuthority.state         : READY
    actionAuthority.reasonCodes   : []
    contract.locks                : []
    contract.listable             : true
    CV exact lookup allowed?      : true
    PC exact lookup allowed?      : true

identity.familyIssueConsensus itself DOES correctly compute
outcome='conflicted', reason='retention-margin-decline-conflict' for
this exact shape -- proving the signal exists and is computed correctly.
It also proves the signal is discarded: nothing in deriveIdentityStanding,
deriveMarketStanding, deriveActionAuthority, deriveLocks, or
canUseExactIssuePricingCache ever reads familyIssueConsensus. "Remembered
in a log [structure]" is not custody -- a signal the transaction boundary
never receives is a signal that doesn't exist, exactly as AB's own
precedent (evidence applicability custody, GK-101) already established
for a different facet. GK-128 is upgraded from "logged, not fixed,
evidence-set completeness gap" to CONFIRMED LIVE -- the fifth false-READY
sibling (GK-96, GK-101, GK-111, GK-124, now GK-128), same disease class,
same structural shape: a real gate exists somewhere in the pipeline, and
a downstream consumer never reads it.

Fix traced, not built, per the directive's own instruction to report and
wait for greenlight. Two candidates evaluated:

  - REJECTED as dishonest: have projectIssueAuthority additionally
    consume familyIssueConsensus.outcome==='conflicted' as an
    independent demotion input. This resurrects GK-127 verbatim --
    Wolverine #90's own real shape ALSO carries outcome='conflicted'
    despite genuine value agreement (the near-miss branch sets that flag
    from axisAgreement/margin-decline provenance, not from a value
    comparison); consuming it directly would re-demote the exact book
    this dispatch just un-blocked.
  - PROPOSED, narrowest, revocation-only: when the near-miss branch
    fires, feed the runner-up's own NON-WINNING asserted issue value(s)
    (runnerUpAssertedIssues filtered to exclude whatever matches
    confirmedIssue) into issueEvidence as genuine reportConflict entries
    -- for this fixture, exactly "300." Both inputs (runnerUpAssertedIssues,
    confirmedIssue) are already computed at the point the near-miss
    branch runs; no new plumbing. Verified by hand against both shapes
    this dispatch already built: Wolverine #90's own runner-up has zero
    internal dissent (a single clean "90" row), so the filtered set is
    empty and nothing changes for that book; Section 5's runner-up
    (213/213/300) yields exactly "300," which would correctly demote
    reconcileIssue's own authority to CONTESTED via its EXISTING conflict
    logic -- no new authority-derivation mechanism, just a missing
    evidence input. Deliberately scoped to the RUNNER-UP's dissent only,
    never the TOP family's own internal minority (Wolverine #90's top
    family itself contains a dissenting "91" row among four "90" rows) --
    feeding top-family dissent would re-trigger GK-127's own false
    conflict on the book this dispatch exists to fix. NOT IMPLEMENTED.

### Item 2 -- documentation correction

Every instance of "out.issueAuthority is now written EXACTLY ONCE" (or
equivalent single-writer-completed framing) in CLAUDE.md, docs/
TICKET-REGISTRY.md, and this file corrected in the same commit as this
section, per the directive's own instruction. Replaced with: normal
visual-resolution custody projects issue authority once from
reconciledIssue; three separately-scoped exceptional mutation paths
remain (escalateIssueAuthorityOnConflict, manual-correction provenance,
checkCrossPopulationPromotionGuard) and are explicitly tracked as Slice 2
work-order items, with their eventual destination named (evidence ->
reconciler -> projection, or a pre-reconciler entry path terminating in
the same owner) rather than left as an open question. The correction
applies uniformly -- a validator that executes out.issueAuthority = ...
is a writer regardless of its name; writer 7's own reclassification as a
"safety-net validator" does not exempt it from this accounting.

### Regression

No code changed by this follow-up -- item 1 is an investigation (a
throwaway script exercising only real, already-shipped functions,
deleted after use, not committed), item 2 is docs-only. Baseline
unchanged at 191/19/4/214.

### Handoff

GK-127 stays SHIPPED-PENDING PHYSICAL. GK-124/AP stays SHIPPED-PENDING
PHYSICAL -- the false-READY halt remains active independently of this
finding; the Dell'Otto production acceptance has not run. **GK-128
reclassified OPEN, proven live** -- the halt covers it too now. Nothing
lists until GK-128's own fix is greenlit, built, and accepted, in
addition to both physical rescans already pending. Do not propose the
next directive. Do not implement GK-128's traced fix without explicit
greenlight.

## GrailKey Directive AQ-follow-up (build) -- GK-128 CLOSED, evidence-set completeness

Greenlit build on top of e7c0eac. The rule installed: every materially
asserted issue value in an eligible conflicting family must reach the
issue evidence set -- a family's plurality winner is not a substitute
for its dissenting evidence.

### The fix

src/lib/identityCore.js, two sites, both inside the existing near-miss
margin-decline branch:

1. familyIssueConsensusResult (the near-miss object) now carries the
   runner-up TITLE FAMILY's own full asserted-issue set,
   runnerUpAssertedIssues -- already computed by the pre-existing
   axis-check (runnerUpIssueMeasurement.assertedIssues), just not
   previously carried forward. Distinct from the `runnerUp`/
   `runnerUpSupport` fields already on the object via the
   `...issueMeasurement` spread, which are the TOP family's own internal
   runner-up-candidate-value fields -- a different thing entirely,
   confirmed by direct trace to avoid reusing the wrong field name.

2. At the evidence-set builder (issueEvidence, same function, ~150 lines
   later), when the near-miss branch fired
   (isNearMissConflictActive), every value in runnerUpAssertedIssues that
   does NOT match preReconcileConfirmedIssue (the value actually being
   preserved/adopted) is fed into issueEvidence via reportConflict,
   tagged 'family-runnerup-dissent'. reconcileIssue's own EXISTING
   conflict logic (identityReconciler.js, unchanged) then correctly
   computes CONTESTED -- no new authority-derivation mechanism, a missing
   evidence input restored.

Scoped to the RUNNER-UP's own dissent only, never the TOP family's own
internal minority. This is not a convenience simplification -- verified
required by direct execution: Wolverine #90's own real shape has
TOP-family dissent (a genuine "91" among four "90" rows) with a
completely clean, unanimous runner-up. Feeding top-family dissent here
would have fed "91" as conflict evidence and resurrected GK-127's exact
false conflict on the book that fix was built to close. The "eligible
conflicting family" the rule names is the runner-up specifically -- the
family competing against, never becoming, the adopted value; the top
family's own minority noise is the ordinary texture of a real population
that still produced a genuine majority, not itself in conflict with
anything.

Two alternatives considered and rejected, both recorded so they are not
silently re-attempted:

  - Feed the runner-up's own PLURALITY (winner) instead of its dissent.
    Already tried and reverted TWICE in this campaign (once in AQ's
    original build, once implicitly re-derivable from the same mistake)
    -- wrong value for exactly this shape: plurality "213" agrees with
    top, the real dissent is the minority "300," which plurality
    discards by construction. The trap this dispatch's own instruction
    named explicitly.
  - Have projectIssueAuthority consume familyIssueConsensus.outcome
    directly as an authority-demotion input, bypassing the evidence set
    entirely. Rejected as dishonest: Wolverine #90's own real shape ALSO
    carries outcome:'conflicted' (the near-miss branch sets that flag
    from axisAgreement/margin-decline provenance, not a value
    comparison) -- consuming it directly would re-demote the exact book
    GK-127 exists to keep unblocked, resurrecting that bug verbatim
    under a different name.

### Item 2 -- null-defaults-to-trusted audit

Traced per the directive's own instruction: "What does every downstream
consumer do with a null issueAuthority today? If null defaults to
trusted anywhere, close it the same way." Two candidate shapes checked,
both found already safe via independent, pre-existing mechanisms --
no additional live gap, no further code:

  1. A lone, uncorroborated 'family-population' winner (no prior
     existed). projectIssueAuthority's own existing
     isLoneFamilyPopulationWinner check (shipped in AQ's original build)
     already demotes this to 'provisional' unless
     evaluateUnanimousConsensusPromotion clears a materially stricter
     bar. Unaffected by this dispatch.

  2. A lone, uncorroborated 'first-eligible-visual' winner.
     identityCore.js's OWN pre-existing, pre-AQ mechanism
     (identityProvisionalFromVisualFirst, source-verified at
     api/enrich.js ~line 3509-3516) already sets
     out.identityProvisional=true whenever this exact shape occurs.
     deriveIdentityStanding (src/lib/actionAuthority.js) already reads
     out.identityProvisional===true as CONFLICTED, never CONFIRMED --
     actionAuthority.state cannot reach READY off this alone, via a
     SEPARATE axis (identityStanding), independent of out.issueAuthority
     entirely. Verified by direct source read of both the write site and
     the read site; not re-run end to end in this dispatch since neither
     site was touched.

The specific symptom the boundary test demonstrated (null flowing to
identityStanding=CONFIRMED / actionAuthority=READY) was entirely caused
by the evidence-set completeness gap this fix closes. No other live
"null defaults to trusted" path was found.

### Acceptance

tests/grailkey-directive-aq-followup-gk128-evidence-completeness.test.js,
23/23. B1 (SHIP-BLOCKING) runs the full real chain (resolveIdentity ->
projectIssueAuthority -> canUseExactIssuePricingCache ->
computeIssueAuthorityContractPatch -> assembleContract, all real,
unmodified production functions) on the real Batman #213/#300 near-miss
fixture (reused verbatim from grailkey-dispatch-25-fix2c-axis-check.test.js
Section 5's own already-certified construction). PRE-FIX is reproduced
MIRRORED -- the exact reconciledIssue shape captured via direct
execution before this fix landed (this dispatch's own investigation,
preserved in commit e7c0eac's history), since the evidence-set builder
that produced it no longer exists in that form to re-run live. POST-FIX
is DIRECT, the real resolveIdentity output through the unmodified
downstream chain: issue candidate retained ("213"), authority CONTESTED
with conflicts=[300] and honest provenance, CV/PC exact lookups both
blocked, marketStanding=NONE (!=EXACT_CURRENT), actionAuthority=LOCKED
(!=READY), contract.listable=false -- every acceptance criterion the
directive specified, proven on the real transaction boundary, not
asserted against a mock. The Wolverine #90 control (SHIP-BLOCKING) proves
no self-conflict regression through the SAME full chain: authority stays
CORROBORATED, out.issueAuthority stays null, CV/PC lookups stay allowed.
tests/grailkey-directive-aq-canonical-facet-authority.test.js's own B1b
(previously asserting the KNOWN GAP as expected behavior) updated to
assert the fixed CONTESTED/conflicts=[170] outcome for its own,
differently-shaped fixture (a single-row, unanimous-but-differing
runner-up, distinct from Section 5's internally-split shape) -- both
shapes now correctly close under the same fix.

### Regression

Full unfiltered sweep, 215 files (192 PASS / 19 FAIL / 4 TIMEOUT),
byte-identical FAIL/TIMEOUT list to the AQ stamp (191/19/4/214) plus one
new file. Every blocking control named in the directive re-run directly
and confirmed byte-identical: q140-issue-consensus-corrective.test.js
(124/124, Flash #139 genuine conflict still locks exactly as before),
grailkey-dispatch-25-fix2c-axis-check.test.js (60/60, Section 5's own
"P0 hole closed" safety property fully intact -- this fix operates one
layer downstream of that test's own axisAgreement/unanimity logic,
never touching it), q-trackB-commit4.3.1-retention-decline-fail-closed.test.js
(73/73), q-trackB-commit4.3-winning-family-authority.test.js (263/263),
grailkey-directive-ap-variant-unresolved-authority.test.js (37/37, AP
fixtures unchanged).

### Handoff

GK-128 CLOSED, code-complete, P0 SHIPPED-PENDING PHYSICAL. GK-127 and
GK-124/AP remain SHIPPED-PENDING PHYSICAL, unaffected by this dispatch.
The halt now covers three physical rescans before any ticket moves off
SHIPPED-PENDING PHYSICAL: Wolverine #90 (GK-127), a genuine near-miss
book if one is reproducible in production (GK-128), and Dell'Otto ASM #1
(GK-124). Nothing lists. Committed locally on top of e7c0eac, NOT
pushed -- per instruction, report and ask before pushing, since the push
carries both commits together and deploys production. Do not propose the
next directive.

## GrailKey Directive AR -- GK-129 + GK-130: evidence outranks lists, CONTESTED cannot price EXACT

One law, two tickets: authority is earned from evidence. It is never
granted by list membership, and never retained by an unresolved contest.

### Part A -- GK-130, the pattern-list veto

Production evidence, Absolute Batman #19, Ben Oliver Variant Cover, 1st
Scarecrow, DC 2026 (2026-08-17 03:58, build d3e2816):

```
rank-1 visual row:  "Absolute Batman#19 - Ben Oliver Variant Cover - 1st
                     Scarcrow - DC Comics 2026"
top family:         "absolute batman ben oliver 1st dc" -- weight 14.5,
                     10 members
[Q84] override-blocked reason=non-creator additions [ben,oliver]
[price] $6.35 from the generic pool -- RESEARCH
```

`Ben Oliver` is not in ARTIST_PATTERNS (src/lib/compHygiene.js), so
extractPoolArtistTokens (src/lib/imageSearchIdentity.js) never populated
poolArtistTokens with 'ben'/'oliver' no matter how many independent pool
listings named him. applyDualAxisGate's non-creator branch vetoed the
addition purely on registry absence -- a hardcoded list acting as the
ONLY path to "this is a creator name," not merely informing it.

Rule installed: a hardcoded pattern list may inform token classification;
it may never veto a token corroborated by (a) the frozen rank-1 eligible
visual row AND (b) >= 3 independent family members.

Trace findings:
- A-T1: the veto site is imageSearchIdentity.js's applyDualAxisGate,
  the `nonCreator.length > 0` branch (poolArtistTokens membership test).
- A-T2: Q84 did not see family-member support counts at decision time --
  applyDualAxisGate's signature carried familyTokens/familyMemberTokens
  but never the raw items/indices needed to check physical presence or
  seller independence.
- A-T3: no structural pattern ("<Name> Variant Cover") existed anywhere
  in the variant-extraction path either -- extractFirstEligibleVariantCandidate
  (identityCore.js) and matchCreatorCanonicals (premiumCreators.js) are
  both registry-lookup-only. List-only confirmed.
- A-T4: reused, not reinvented -- checkDistinctItemIdAndSeller
  (issueAuthority.js), the same anti-injection unique-seller guard
  coverType-consensus already relies on.
- A-T5: ARTIST_PATTERNS consumers enumerated (extractPoolArtistTokens,
  recoverAdjacentCreatorTokens's adjacency check, extractFirstEligibleVariantCandidate
  via matchCreatorCanonicals) -- none of the other consumers were touched;
  this dispatch is scoped to applyDualAxisGate's veto only.

Fix: `findPhysicallyCorroboratedTokens` (imageSearchIdentity.js) checks,
for every non-creator added token, whether it is present on the frozen
rank-1 row (identityReconciler.js's selectFirstEligibleVisual, reused
byte-for-byte -- Directive AN's own discipline) AND supported by >= 3
family members whose unique-seller count also clears 3
(checkDistinctItemIdAndSeller). When ALL non-creator tokens clear both
bars, the addition is allowed under a new provenance,
'creator-lane-physical-corroboration' -- starts with 'creator-lane' so
buildGatedTitleSource's prefix check picks it up correctly, but is not
'creator-lane-direct', so isBareCreatorTokensOnly's extra issue-
corroboration check does not apply (this branch carries its own
independent physical evidence, same exemption 'creator-lane-adjacent-
recovery' already gets). Checked BEFORE the narrower registry-adjacency
recovery chain -- when it fully clears the addition, the narrower check
is unnecessary; a family where only SOME added tokens clear the physical
bar falls through unchanged to that existing chain, a deliberate scope
boundary, not hidden.

`applyDualAxisGate`/`q84Gate` signatures extended with two new,
defaulted-null trailing params (`familyIndices`, `items`) -- both call
sites (top-rank-protection, weighted-consensus) updated to pass
`family.indices` and the closure's own `items`. Every pre-existing call
shape (the old positional arg count, used throughout
tests/q84-dual-axis.test.js) is structurally unaffected -- the new
branch simply never fires without the new args, reproducing exact
pre-fix behavior.

Verified via three negative controls (all still correctly vetoed):
below-floor independent-seller count (2 of 3 members), a token present
in 3+ members but ABSENT from the frozen row itself (the same "physical,
not merely marketplace-coincidental" discipline Directive AN established
for discriminative-corroboration), and same-seller relisting (3 rows,
1 unique seller -- the anti-injection guard doing its job).

### Part B -- GK-129, CONTESTED cannot price EXACT

Production evidence, Venom Separation Anxiety #1, Mike Mayhew
(2026-08-17 03:21, build d3e2816):

```
[reconcile-variant] value="Mike Mayhew signed" authority=CONTESTED
card: EXACT_CURRENT -- READY -- List on eBay -- $48.86
card, same screen: "Exact match not found -- AI estimate.
                    These are SIMILAR listings, not exact matches."
```

The sixth false-READY sibling (after GK-96, GK-101, GK-111, GK-124,
GK-128). `reconcileVariant` (identityReconciler.js) correctly computed
CONTESTED -- a candidate value was adopted, but at least one independent
source (a different, disagreeing first-eligible-visual candidate) still
disagreed with it. api/enrich.js's custody of out.variantApplicability
(the field deriveMarketStanding reads) only ever distinguished
UNVERIFIED (Filter 1c mismatch) / UNRESOLVED (AP's cleared-with-evidence
case) / null -- CONTESTED fell straight through to whatever
rawComps?.variantApplicability said, which was genuinely 'CONFIRMED'
(Filter 1c found comps matching the disputed value). A pool that matches
a disputed guess is not evidence the guess is right.

Trace findings:
- B-T1: derivation site is api/enrich.js, ~line 8611-8636 (the
  out.variantApplicability custody block) -- CONTESTED mapped to
  'CONFIRMED'/applicable before this fix, confirmed.
- B-T2: custody, not recomputation -- the fix reads
  out.variantReconciliation.authority (already written unconditionally
  at the one place the reconciler runs, ~line 5748) rather than
  re-deriving anything; deriveMarketStanding itself never re-reads
  out.variantReconciliation, only the already-custodied
  out.variantApplicability string, same discipline AB/AP established.
- B-T3: the issue facet already conforms (GK-128's own fix blocks a
  CONTESTED issue from reaching exact standing via a different path --
  CV/PC exact-lookup gates). Variant is the only other facet feeding
  exact-standing custody today.

Fix: api/enrich.js custodies `out.variantReconciliation.authority===
'CONTESTED'` into `out.variantApplicability='CONTESTED'`, placed ABOVE
the Filter-1c read (so CONTESTED overrides even a CONFIRMED pool match)
and below `soldFallbackConsumed` (the strongest, most-specific signal,
unchanged). `deriveMarketStanding` (actionAuthority.js) floors
'CONTESTED' to SIMILAR_ONLY -- same floor as AB's UNVERIFIED and AP's
UNRESOLVED, own reason code VARIANT_CONTESTED_EDITION
(responseContract.js) so the operator sees why, distinct from and
mutually exclusive with the AB/AP codes. Falls through Z's EXISTING
state machine to REVIEW -- no parallel denial path, no price cleared
(I13/C1: this is a revocation of standing, not a fabrication of worse
evidence -- the 4-comp pool and $48.86 price stay fully visible).
Server boundary (api/list-ebay.js) inherits the fix with zero code
change (`item.variantApplicability || null` passes the truthy
'CONTESTED' string through unchanged, same C6 single-writer pattern
every prior false-READY fix has used).

The upward route (corroborated variant reaches EXACT_CURRENT normally)
and the operator escape hatch (a GK-85 OPERATOR_CONFIRMED correction
never runs through reconcileVariantFacet at all -- that function's own
guard requires pipelineSource==='vision' -- so out.variantReconciliation
stays absent, not CONTESTED, for an operator-confirmed variant) are both
demonstrated directly, not merely asserted.

### Integration

The two parts compose on one book: Absolute Batman's Ben Oliver axis
(Part A) can be corroborated while a DIFFERENT axis (e.g. printing) is
independently CONTESTED -- Part B still denies EXACT_CURRENT/READY even
though the right variant identity is now on the card. Proven with a
combined fixture (reconcileVariantFacet fed a genuinely disagreeing
printing signal on top of the Ben Oliver candidate) -- marketStanding
stays non-EXACT_CURRENT, authority stays non-READY, price still
displays. Full end-to-end wiring through api/comps.js's sold-filter/
Filter-1c chain for the "ben oliver"-corrected query string is NOT
exercised by this unit-level suite -- that would require a live or
large synthetic eBay pool beyond what a pure-function test constructs;
reported as a real scope boundary, not hidden.

### Tests

tests/grailkey-directive-ar-evidence-authority.test.js, 42/42 -- DIRECT
calls throughout (real applyDualAxisGate, real selectTitleFamilyCandidate,
real reconcileVariantFacet, real deriveMarketStanding/deriveActionAuthority/
deriveLocks), PRE-vs-POST proofs on the real production shapes for both
parts, negative controls, sibling-fixture mutual exclusivity, no-new-READY
sweeps, the server re-derivation boundary, and the combined integration
fixture. Full regression sweep re-run across all 216 test files (see
CLAUDE.md's baseline stamp for the re-verified counts) -- zero new
regressions attributed to this dispatch's changes.

### Handoff

GK-129/GK-130 SHIPPED-PENDING PHYSICAL per this registry's standing
evidence bar. GK-131 (the "1st Scarecrow" key-issue-signal-present-but-
keyIssue=null gap surfaced while tracing GK-130) logged, explicitly NOT
fixed -- pricing-math-adjacent territory (key multiplier machinery),
needs its own greenlight, out of this dispatch's authorized scope.
Closure reserved for Jimmy's post-deploy rescans of the Absolute Batman
#19 and Venom Mayhew books, alongside the three rescans GK-127/GK-124/
GK-128 already have pending. Committed locally, NOT pushed -- report and
ask before pushing, since the push deploys production. Do not propose
the next directive.

## GrailKey Directive AS -- GK-132/GK-126: the candidate always enters

Rule installed: first-eligible-visual evidence always enters the issue
evidence set -- every scan, unconditionally. A refuted Vision value
cannot force ID_REQUIRED while an eligible rank-1 physical candidate
exists. The candidate is adopted CONTESTED; the refuted value becomes
conflict evidence; Z/AR derive REVIEW. ID_REQUIRED is reserved for scans
with genuinely no candidate. The >=3-member family floor governs
CONSENSUS OVERRIDE only -- it may not erase the frozen rank-1
candidate's standing as the identity value.

### The defect

Production, Venom Separation Anxiety #1, Mike Mayhew signed/remarked
w/Poker Chip (2026-08-17 19:40, build ee03e5a):

```
rank-1 frozen row:  'Venom - Separation Anxiety 1 Virgin Signed/Remarked
                     by Mike Mayhew w/Poker Chip'
Vision:             "Venom" #150 -- 0/20 pool support

[title-family] Top family has only 1 members (need >=3) -- preserve Vision
[vision-zero-support] ESCALATE: Vision issue="150" has 0/20 pool support
                      and no adoptable alternate -- forcing ID_REQUIRED
[reconcile-issue] value=null source=none authority=NONE
                  conflicts=[{vision:"150"}]
-> "Venom" #null LOCKED ID_REQUIRED
```

Every guard built in prior dispatches worked correctly (artbook out,
Crain tokens excluded, Lethal Protector impossible via AN's physical-
corroboration gate). Two LEGACY gates, both older than this campaign's
own evidence-reconciliation architecture, compounded on top:

1. `MINIMUM_CORROBORATING_ROWS` (identityReconciler.js,
   `countCorroboratingEligibleRows`) gated ENTRY into the issue evidence
   set at 3 unique corroborating rows -- not merely whether a candidate
   could win a consensus vote. The Venom pool had exactly 1 genuinely
   eligible, genuinely corroborating row (the frozen row itself); every
   other row was either ineligible (AO's companion-product filter caught
   the artbook) or simply didn't mention an issue number at all.
2. `hasContaminatedMember` (compHygiene.js) flags ANY member matching
   LOT/REPRINT/SLAB/GRADED/SIGNED/TPB, with no requirement that the
   family actually be a MIXTURE of types. Applied to the issue-evidence
   builder's own Guard 6 (Directive AJ's GK-118), this meant a
   genuinely-signed 1-member family was flagged "contaminated" purely
   for being signed -- a category error, since mixture is structurally
   impossible with one member.

Directive AI's own Fixture 4 (tests/grailkey-directive-ai-visual-first-
identity.test.js) already covers "Vision issue wrong, first-eligible
says the right one, adopt CONTESTED" -- but its own fixture happens to
clear MINIMUM_CORROBORATING_ROWS (3 different-titled rows all
coincidentally say "#1"), so it never actually tested the arrival path
for a thin, single-corroboration pool. The fixture asserted the
reconciler's behavior GIVEN the evidence; it never asserted the
evidence's ARRIVAL. Same class as the AJ reachability finding
(Directive AJ, GK-117).

### Why this dispatch could relax these floors safely

Directive AR (earlier the same day, `ee03e5a`) already closed the loop:
a CONTESTED facet can never reach EXACT_CURRENT or READY
(`VARIANT_CONTESTED_EDITION` for variant, GK-128's issue-authority gate
for issue). Adopting a thin, single-row candidate now produces an
honest REVIEW card with the correction form reachable -- never a
confident wrong listing. Before AR shipped, this same relaxation would
have been a real regression risk; after, it is a strict improvement
(a book that used to hard-wall now gets an honest, correctable answer).

### The fix (src/lib/identityCore.js, the same unconditional issue-
### evidence builder Directive AJ's Proof 1 already made run
### unconditionally)

1. `corroboratingRows >= MINIMUM_CORROBORATING_ROWS` removed from the
   evidence-entry condition. `MINIMUM_CORROBORATING_ROWS`/
   `countCorroboratingEligibleRows` themselves are UNCHANGED and remain
   fully load-bearing everywhere else (resolveFamilyIssueConsensus's own
   >=3-unique-row bar, the retention/rescue branches, the title-family
   Q38 "need >=3 for consensus override" floor) -- this was the ONE
   consumer conflating "can this candidate enter the evidence set" with
   "can this candidate win a consensus vote," two genuinely different
   questions. `corroboratingRows` stays computed, now purely diagnostic,
   threaded into `visionZeroSupport.corroboratingRows` (I13 -- a thin
   candidate is visibly thin, no longer invisible).
2. Guard 6 (family contamination) now requires `>=2` family members
   before running the FULL, unchanged `hasContaminatedMember` check --
   mixture is structurally impossible at n=1. The shared function and
   its two OTHER call sites (identityCore.js's own qualified-family-
   authority retention gate; issueAuthority.js's P1 predicate;
   imageSearchIdentity.js's mergeFragmentedTitleFamilies) are completely
   untouched.

### Three new guards, each found and refined by running the FULL
### existing regression suite after every change -- not merely the
### fixtures this directive named

The build did not stop at "the two named production blockers are
fixed." Each incremental relaxation broke a real, pre-existing,
deliberately-designed test somewhere else in the suite; each break was
traced to its actual root cause (never patched around) before the next
attempt:

- **Own-row REPRINT_RE/IDENTITY_TPB_MARKER_RE check.** `isEligibleVisualRow`
  filters lot/variation-group/companion-product rows but never checked
  reprint or TPB markers -- a facsimile reprint (which routinely
  renumbers to "#1" regardless of the true issue) or a TPB (no single
  issue number applies) could become `firstEligible`. Found regression-
  testing against tests/q-vision-zero-support.test.js's own pre-existing
  "True Believers" control (Test 7, a 2026-07-era fixture): removing the
  row-count floor let a reprint's own repeated "#1" claim through, where
  the OLD floor had accidentally also blocked it (every row shared one
  identical rawTitle with no itemId, so the dedup-by-title logic in
  `countCorroboratingEligibleRows` collapsed the whole 20-row pool to
  corroboratingRows=1 -- coincidence, not design). Fixed with a per-row
  property check on the candidate's OWN text, independent of any count.
- **Deference to a genuine prior 'no-consensus' verdict** --
  `resolveFamilyIssueConsensus` (identityCore.js) is called from at
  least two structurally different places: the 'refused-identity-
  conflict' branch's own considered refusal (Eternus #2,
  tests/q131-refused-identity-conflict-provisional.test.js, Q140
  corrective dispatch precedent: 2 unique rows below the family's own
  >=3-row floor, even at 100% agreement, must stay null), AND a
  genuinely SUCCESSFUL title-family adoption's own internal issue-split
  check (AI's own Fixture 4, run through the real handler in
  tests/grailkey-directive-aj-http-handler.test.js: 4 different issue
  numbers split across "venom separation anxiety"'s 5 winning members,
  correctly mode='no-consensus' too, but here the candidate MUST still
  win). A first attempt (defer whenever familyIssueConsensusResult is
  non-null) broke AK's own population-precedence fixture (tests/
  grailkey-directive-ak-population-precedence.test.js: a bare
  'adopted'/outcome==null population vote is a weak, DEMOTABLE
  corroboration by design, not a refusal -- blocking its entry defeated
  the whole point of AK's own precedence ordering). A second attempt
  (defer only inside 'refused-identity-conflict') broke CONTROL 3
  (tests/q-trackB-commit4.3-winning-family-authority.test.js: Commit
  4.3's qualified-family-authority retention gate ALSO produces a
  considered 'no-consensus' verdict for a `fallback-vision` decision,
  independent of 'refused-identity-conflict' entirely). Generalized to
  `family.decision` NOT IN `FAMILY_OVERRIDE_DECISIONS` (compHygiene.js's
  own closed set of "this was a real title win") -- but this STILL broke
  Detective Comics #1107 itself, run through the real `/api/enrich`
  handler (tests/grailkey-directive-aj-http-handler.test.js): the
  'refused-identity-conflict' branch's OWN `resolveFamilyIssueConsensus`
  call uses the OLDER, 999-capped issue extractor (identityReconciler.js's
  `extractIssueCandidate`, not the uncapped `extractHashIssueNumber` GK-116
  added specifically for legacy numbering like #1107) -- it genuinely
  cannot SEE "1107" at all, producing `assertedIssues: []` and a FALSE
  'no-consensus' (nothing parsed, not "parsed but insufficient"). Final
  fix: additionally require `assertedIssues.length > 0` -- the family-
  level mechanism must have actually SEEN and weighed real values before
  its refusal counts as a considered verdict this guard defers to.
- **Pool-wide Vision-title-overlap check.** A real, non-contaminated,
  count-sufficient family can still be about the WRONG BOOK relative to
  Vision's own read (tests/q-trackB-commit4.3-winning-family-authority.
  test.js's own CONTROL E: "Quux Anthology #9" pool, Vision title
  "Something Else Entirely" -- zero relationship anywhere). Winning-
  family-only overlap checking is too narrow, though: Detective's own
  real pool (same http-handler test) has a winning "Detective Comics
  #1107..." cluster sharing NOTHING with Vision's "Batman" either, yet
  Detective genuinely IS about the right book -- "Batman" appears
  elsewhere in the SAME raw pool (Funko Pop Figure, T-Shirt, Compendium
  TPB rows), just not in the winning cluster's own title. Fixed by
  checking the WHOLE raw pool, not just the winning family, for ANY
  shared Vision-title token -- a much weaker, more permissive bar than
  family-level overlap, exactly wide enough to separate "plausibly the
  right subject, wrong cluster" from "shares literally nothing."

### Registry correction

This directive's own preflight described GK-126 as "the >=3-member
floor discards a 1-member correct family" -- checked against
docs/TICKET-REGISTRY.md directly (the mandatory preflight step) and
found FALSE: GK-126 is an already-registered, unrelated ticket
(`responseContract.js`'s `single-comp-pool` pricing floor, Directive
AP, 2026-08-16). The defect this dispatch actually fixes is filed
under GK-132 alone; GK-126 is untouched, still open, still about its
own original single-comp-pool scope. Flagged per the directive-
preflight protocol's own purpose -- catching exactly this class of
stale/misattributed ticket reference before work proceeds on a false
premise.

### What was traced but deliberately not built (Task 2d)

The TITLE facet has its own, separate default (`confirmedTitle =
vision.title`, only overridden by a REAL family adoption --
top-rank-protection/weighted-consensus/discriminative-corroboration/
refused-identity-conflict's own provisional branch). Q38's plain
"1-2 members, need >=3" `fallback-vision` decision is none of those, so
on the real Venom production shape `confirmedTitle` stays Vision's own
raw "Venom" even after `confirmedIssue` is correctly rescued to "1" --
the two facets are resolved by genuinely independent code paths,
confirmed by direct trace (tests/grailkey-directive-as-candidate-
always-enters.test.js's own B5), not assumed. Per the directive's own
instruction ("do not build a second canonicalization"), this is
reported, not fixed -- logged as GK-133.

### Tests

tests/grailkey-directive-as-candidate-always-enters.test.js, 31/31 --
DIRECT proof on the real production shape (with a PRE-fix demonstration
that the lone Signed/Remarked member would have tripped the old,
unscoped `hasContaminatedMember` check), Detective Comics #1107 and AI
Fixture 4 regressions re-verified unregressed (including an "arrival
path" assertion -- corroboratingRows is a real computed artifact, not
merely an asserted reconciler output), a genuine no-candidate control
(ID_REQUIRED survives when literally no eligible row exists), the
title-facet floor (Q38) confirmed untouched by direct execution, Flash
#139 unaffected, and no-listing-unlock derivation chains verified
through the real `actionAuthority` machinery. Full 217-file regression
sweep re-run clean: 194 PASS / 19 FAIL / 4 TIMEOUT, byte-identical
FAIL/TIMEOUT file list to the prior baseline -- the only delta is this
one new, fully-passing test file.

### Handoff

GK-132 SHIPPED-PENDING PHYSICAL. GK-126 untouched (registry correction
above). GK-133 (title-facet gap) logged, not fixed, deliberately out of
this dispatch's scope. Closure reserved for Jimmy's post-deploy rescan
of the Venom Mayhew book, alongside the still-pending Absolute Batman
#19 (GK-130), Dell'Otto ASM (GK-124/AP), Wolverine #90 (GK-127/128), and
Sabrina control rescans. Committed locally, NOT pushed -- report and ask
before pushing, since the push deploys production. Do not propose the
next directive.
