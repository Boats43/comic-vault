# B1 — semantic disposition of the 22 "code or stale-test" failures (2026-10-19)

Source: the first full sweep of RC `56b2448` (`rc.jsonl`, 33 reproduced failures on clean rerun, all with identical failing assertions on pristine `ba82e93`;
full per-file logs in the sweep scratchpad `c2-logs/`). "Fails on baseline" was NOT accepted as proof that a test is expired.

Dispositions: **PRODUCT DEFECT** (asserted contract is valid, implementation violates it) · **EXPIRED CONTRACT** (a deliberate, documented change superseded the
assertion) · **UNDETERMINED** · **TEST-HARNESS DEFECT** (the contract is valid and the implementation conforms; the test's own extraction / stripping is broken — it fits none
of the three labels, so it is reported as its own class rather than mislabeled).

| # | File | Disposition | Governing change / evidence |
|---|---|---|---|
| 1 | gk152-handler-smoke | EXPIRED CONTRACT | Fixture sends no `assetType`; GK-250 category allowlist + Universal U1 (no default category) refuse before comps (`refused-category-pricing-not-authorized`, enrich.js:7240) so the rescue (:12599) never runs. **Same unmodified baseline code passes 11/11 once `assetType:'comic'` is added.** |
| 2 | gk157-158-handler-smoke | EXPIRED CONTRACT | Same: 17/17 with `assetType:'comic'` on baseline. |
| 3 | gk159-commit4-terminal-floor-handler-smoke | EXPIRED CONTRACT (the contract itself is CURRENT — see B2) | Same: 18/18 with `assetType:'comic'`; REVIEW / ISSUE_CONTESTED is produced. |
| 4 | gk168-edition-facet | EXPIRED CONTRACT | Same: 85/85 with `assetType:'comic'`. |
| 5 | gk184-handler-smoke | EXPIRED CONTRACT | Same: 9/9. |
| 6 | gk229-content-unverified-handler-smoke | EXPIRED CONTRACT | Same: 14/14. |
| 7 | gk271-enrich-handler-smoke | EXPIRED CONTRACT | Same: 25/25 on baseline and on `be9a611`; **20/5 at P0-C `fa9b27f`** (a P0-C behavior change, see B2/"P0-C side effects"). |
| 8 | gk272-classic-comics-refused-conflict-smoke | EXPIRED CONTRACT | Same: 9/9. |
| 9 | gk276-enrich-canary-handler-smoke | EXPIRED CONTRACT | Same: 11/11. |
| 10 | grailkey-directive-aj-http-handler | EXPIRED CONTRACT | Sends `headers: {}` (GK-269 requires a verified bearer) and no `assetType`. 13/13 with both added. |
| 11 | batch1-fixes | EXPIRED CONTRACT | Q22 "Spider-Man tokenizes to spiderman" superseded by FIX-2 (compHygiene.js: hyphen -> SPACE both sides; compact spellings handled by the bigram-join in `hasSufficientTitleOverlap`). |
| 12 | gk227-asset-media-append-handler-smoke | EXPIRED CONTRACT | Setup mint fails: "collectionItemId … does not resolve to a durable collection_item … sync the catalogue item (POST /api/collection) before linking" (collection-first ordering, U1 F+G). The append handler itself is untested until the fixture creates the row. |
| 13 | gk270-canonical-collection-projection | EXPIRED CONTRACT | Pins `titlesLikelySameBook(` at >= 2 App.jsx sites; bulk import now uses server-owned candidate standing (`fetchCandidates`/`classifyBulkDuplicate`, GK-279). |
| 14 | comp-filter-hygiene | **PRODUCT DEFECT** | `hasIssueNumber` accepts `#1 & #4`, `#1 #2 #3 set`, `#1,#2,#3` (assertions: reject). Active comps are protected by `hasMultipleDistinctIssues` (comps.js:1478) but **sold verification is not**: executed `verifySoldComps` on pristine `ba82e93` VERIFIES "Absolute Batman #1 #2 #3 set" ($95) and "#1,#2,#3 NM" ($99) as sold comps for issue #1 (4 of 5 rows verified). Multi-issue lots reach verified-sold pricing. Needs a pricing-composition greenlight to fix; not changed here. |
| 15 | artist-registry-sync | **PRODUCT DEFECT** (low) | ARTIST_SURNAME_WORDS "dekal" and "spears" have no ARTIST_PATTERNS entry; compHygiene.js:847-856 says "dekal" is kept failing on purpose. A deliberately red sentinel for registry drift. |
| 16 | decision-engine | UNDETERMINED | 6 failing cases. Two are EXPIRED with evidence: "Missing issue triggers ID_REQUIRED" (the engine now reads a precomputed `identityComplete`, GK-147 L1/AssetCore) and "Green Hornet missing publisher" (Q133 Slice 1c demoted publisher-only gaps). The other four (Action #33 thin pool, SYNTHETIC grading candidate, variant-contamination warning, zero-verified cap) are not established. |
| 17 | b1rc-ebay-xml-contract | UNDETERMINED | Failing: "READY-path packet is BYTE-IDENTICAL to the unmodified Production builder's packet" — the frozen reference packet vs later governed-copy/shipping changes; not traced. (The `currencyID` gap it labels KNOWN PRE-EXISTING is a separate, real eBay-schema item.) |
| 18 | gk213a-identity-authority | UNDETERMINED | `SyntaxError: Unexpected token '}'` inside the test's `new Function` over a block it slices from App.jsx; contract (duplicate-confirm merge keeps identity authority) not exercised. |
| 19 | gk270-relink-tool | UNDETERMINED | Tool returned something other than `DRY-RUN-OK` for the fixture (`REFUSED` is the other result); refusal code not captured. |
| 20 | gk184-evidence-observed-at-unit | TEST-HARNESS DEFECT | Module has **0** code references to recordedAt/occurredAt and 2 `new Date(` sites. The test strips comments with `line.replace(/\/\/.*$/, '')`, which does not match when the line ends in `\r` (CRLF checkout), so comments stay in "code". Passes on LF. |
| 21 | d5a-market-observation-migration-contract | TEST-HARNESS DEFECT | Same CRLF defect in `stripSqlComments` (`/--.*$/`); `0014`'s non-comment SQL has no comp_snapshot/valuation_event/occurred_at_precision. |
| 22 | eux-edition-verify-panel | TEST-HARNESS DEFECT | Boundary marker `'\nfunction CollectionDetail('` no longer exists (`export function CollectionDetail`), so the panel block is empty. With the correct boundary the panel satisfies the pinned requirements (null armedChoice, `onManualCorrect(item, { printingClass: armedChoice }, ['printingClass'])`, reads `item.editionReconciliation`). |

Tally: EXPIRED CONTRACT 13 · PRODUCT DEFECT 2 · UNDETERMINED 4 · TEST-HARNESS DEFECT 3.

## dispatch-42-comicvine-kill (separate)
Failing assertion: `all 7 merge paths now assign comicVine with no cur/s/item fallback … expected 7, actual 9`. The structural contract it protects (no stale `enrich.comicVine || cur.comicVine` fallback) PASSES three times in the same file; only the **count** is stale (merge sites grew 7 -> 9) — EXPIRED CONTRACT (a sixth magnitude pin). Its TIMEOUT is separate and still UNRESOLVED.

## gk152 / gk157-158 `out.issue === undefined` vs P0-C's "43% null issue"
1. Source issue evidence: Vision read issue "1"; visual pool mixed #16/#17/#18/#20 (consensus ratio 0.56, `no-consensus`).
2. Candidate extraction: `resolveFamilyIssueConsensus` -> `conflict-locked/no-consensus` -> confirmedIssue nulled by the zero-support ESCALATE (`[vision-zero-support] ESCALATE`).
3. Rescue/reconciliation: `rescueIssueFromCompsPoolConsensus` (identityCore.js:2852) runs after comps (enrich.js:12599) — **but only if the request reached comps**.
4. `confirmedIssue` assignment: enrich.js:12601 (unwrapped; see B3).
5. Projection: Q140 terminal writes `out.issue`.
6. In the failing tests the request has no `assetType`, so the handler exits at the category refusal (enrich.js:7240) BEFORE step 3: `out.issue` is simply never produced.
P0-C's 43% (12 of 28 runs of ONE image, Vision returned `issue:null`; docs TICKET-REGISTRY "SCAN SPEED — IDENTITY STABILITY FIRST") is **model output variability** at step 1. The two observations are **independent** (different mechanism, different stage); they share only the symptom "issue is null/undefined".
