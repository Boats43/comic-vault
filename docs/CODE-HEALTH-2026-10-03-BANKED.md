# Code-health pass 2026-10-03 — banked findings (NOT fixed in the code-health commit)

None of B1–B4 is closed by the code-health commit. Each stays OPEN until separately ruled and tested.

## B1. `api/list-ebay.js` — durable generic-category marketplace gate: PROPOSED, **NOT IMPLEMENTED** (authority gap, needs a ruling)
- **Risk it prevents:** a non-listable `generic` physical asset being published to eBay as a comic.
- **Current behavior (unchanged by this commit):** the "authoritative" `GENERIC_ASSET_NOT_LISTABLE` gate reads `item.assetCategory`
  from the REQUEST BODY (single path `if (item.assetCategory === 'generic')`, bundle path `items.some(...)`). A caller that omits
  the field (or sends `'comic'`) for a generic asset's `gkAssetId` passes that gate. It must still clear: bearer auth, ownership of
  the asset, a real LIST operator action, Inventory AVAILABLE, a canonical catalogue row with a title, action authority READY or a
  Q41 acknowledgement, price binding, photo guard. Impact is limited to the caller's OWN asset, but it is a client-trusted authority field.
- **Proposed invariant:** listability is decided from the DURABLE category of the owned asset's canonical collection row
  (`collection_item.asset_category`, already loaded by the governed-facts step), never from a request field. A one-line check after
  the governed-facts resolution (`row.assetCategory === 'generic'` -> 400 `GENERIC_ASSET_NOT_LISTABLE`, before price binding / any
  eBay call) was prototyped in this pass and REVERTED: it changes authority semantics and was not authorized. Do not reintroduce
  it without a ruling.
- **Tests required:** real-handler test minting a generic asset + canonical row, request with `assetCategory` omitted and with
  `'comic'` -> 400 and zero eBay calls; comic asset unaffected; `u4-generic-asset-safety` stays green; decide whether `book`
  (non-comic, non-generic) must also be refused by the same durable check.

## B2. `api/enrich.js` — `const issueNum` is reassigned: **LIVE LATENT BUG** (diagnostic only, no code change)
- **Mechanism:** `issueNum` is declared `const` (~line 2912) and reassigned in the Q78 mismatch branch (~3241, `issueNum = visualIssue`)
  and the Q58 backfill branch (~3270, `issueNum = issueBackfill`). If either assignment is reached it throws
  `TypeError: Assignment to constant variable`; there is no inner catch, so the current result of reaching it would be an HTTP 500
  from `/api/enrich`. The const and the reassignment have coexisted since commit `3edf3c0` (2026-07-05). Established by JS semantics and
  ESLint `no-const-assign`; the handler was not executed to demonstrate the throw.
- **Reachability:** by the branch conditions, yes on real scans (Q58: empty/"Unknown" Vision issue, no `#N` in title, visual pool
  rows with >=70% agreement; Q78: Vision issue present, pool disagrees at >=60% and <80%). No deterministic fixture drives either assignment.
- **Production evidence — NO PRODUCTION EXECUTION OBSERVED IN AVAILABLE LOG HISTORY.** The runtime-error aggregation for the last
  7 days has no "Assignment to constant variable" group; a 24h search for the pre-assignment line `[Q58-entry] guard: ... entering backfill
  block` returned no logs, but the companion always-on `[Q58-entry]` query timed out, so the log source's health for that window is not
  demonstrated, and Vercel retention does not cover the period since `3edf3c0`. This is NOT evidence that the branch has never been
  entered. (The `[Q58] backfilled` and `[Q78-issue] adopted` lines are logged AFTER the failing assignment and cannot show entry.)
  `docs/Q58_3RD_ATTEMPT.md` is a historical note, not current evidence.
- **Changing `const` -> `let` is NOT an approved fix.** It would activate an older raw-count identity-adoption path that has not
  executed in any verified form, and that path can disagree with the governed family-scoped consensus path
  (`resolveFamilyIssueConsensus`, "Issue-consensus guard" standing constraint: aggregate unique-row vote, 60% bar plus clear-lead
  margin, never rank-weighted). Flash #139 shape (a 3-of-5 cluster, ratio 0.60) would be ADOPTED by the old Q78 branch.
- **Recommended disposition (requires a separate identity-authority ruling and targeted tests):** delete the old Q58/Q78
  assignments rather than fix them, because (1) the branch is superseded in intent by `resolveFamilyIssueConsensus`;
  (2) `resolveFamilyIssueConsensus` covers the relevant empty-issue (`adopted`) and disagreement (`conflict-locked`) cases;
  (3) the old branch uses materially weaker raw-count thresholds (no unique-row floor, no clear-lead margin); and
  (4) retaining or repairing it would create a competing identity-authority path. Required tests: real-handler fixtures for
  empty-issue and disagreement scans proving the governed path alone decides, including the Flash #139 shape.

## B3. Test/harness debt surfaced by the broad sweep (no production code defect found)
- Real-handler enrich tests (`gk258`, `gk260`, `gk213c`, `grailkey-directive-aj-http-handler`, `ship26-integration`) send no
  bearer token and now receive 401 (GK-269 auth gate), so they no longer exercise the enrich pipeline: coverage gap.
- `buyer-decision-*` (2) and `grailkey-commit-m-pc-query-fallback` finish all assertions then do not exit (open handle).
- `gk179-*`, `gk194-*` need `GRAILKEY_CATALOG_DATABASE_URL(_UNPOOLED)` variants that are not set in the Development env file.
- `npm run lint` is polluted by `.claude/worktrees/*` (~2,700 errors); ESLint has no Node globals for `tests/`, `api/`.
- `list-ebay-outcome1-handler-smoke` cleanup deletes ALL `EBAY` marketplace_connection rows for the Development operator
  principal (not only its own fixture row); it also leaves Creepy's inventory rows behind if the process is killed mid-run.
- `db/data0/0018_gk194_stored_function_schema_resolution*.sql` (untracked, quarantined) duplicates migration number 0018
  (applied `0018_gk179_...`) and is superseded by the tracked `0019_gk194_...`.
- `api/cgc-lookup.js` has no HTTP handler (named export only, called from the authenticated `enrich.js`): SAFE, no action.

## B4. Client IndexedDB / image-sync harness coverage gap — **OPEN, not closed**
- `tests/collection-image-sync.test.js` and `tests/collection-sync-closeout-live-proof.test.js` hang at the first client IndexedDB
  write. Inferred cause (code comparison, not executed): their hand-rolled fake IndexedDB never fires `transaction.oncomplete`, while
  `src/db.js` has resolved mutations only on `oncomplete` since GK-234 (2026-09-20).
- `tests/gk231-fixture-bank-indexeddb.test.js` and `tests/gk234-collection-delete-resurrection.test.js` also fail (`fake-indexeddb`
  VersionError), so NO passing test currently proves client IndexedDB commit semantics or the image-sync round trip.
- Server-side collection invariants remain covered by passing tests (`collection-endpoint-live-proof`, `gk266-collection-continuity`,
  `gk268-auth-recovery-ux`). Not an identity/money/auth/marketplace invariant, but a real coverage gap.
- `tests/dispatch-42-comicvine-kill.test.js` (stale merge-path count 7 vs 9) also does not exit after its assertions.
