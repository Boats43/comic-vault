# V1 Certification — 2026-10-18

Base: Production `ba82e93` (= origin/main). Branch `v1-certification-rc`. NOT pushed, NOT deployed.

## Scorecard (what was actually tested)
| | Area | Verdict | Evidence / scope |
|---|---|---|---|
| A | Capture & evidence integrity | PASS (local) | v1-p0d-physical-evidence-authenticity 50/50 (real capture-scan handler + Development DB); screen/uncertain captures withhold physical claims, grade PROVISIONAL, never "verified"; attestation required. Model screen-detection is a claim only (residual). Production: not verified. |
| B | Exact-object identity & edition authority | PASS (local) | v1-enrich-handler-truthfulness 14/14 over the real 29-listing Street Fighter pool; foreign-edition claim needs transcription, else dropped; unresolved edition => identityStanding CONFLICTED. P0-C (fa9b27f) is NOT in this branch (separate, local-only). |
| C | Condition assessment & uncertainty | PARTIAL | Containment of unsupported claims done; grade accuracy itself not calibrated (no blind certified corpus, per GRADING-CAMPAIGN). NOT CERTIFIED for grade accuracy. |
| D | Market evidence, pricing, economic refusal | PASS (local) | $19 = activeAvg 22.3476 x 0.85 (grade multiplier does not enter), real handler; label "active asks (not sold-verified)"; NO_SOLD_EVIDENCE REVIEW lock holds. Comp-pool leakage (lots/Gold/other-publisher) NOT fixed — pricing-math greenlight needed. |
| E | Durable ownership & Collection management | PASS (local/dev) | u1-generic-book-live 85/85, second-principal 20/20, gk253/254 130/130 (Book never becomes Comic). Production has zero physical assets besides Old Man Logan #25. |
| F | Auth, session recovery, principal isolation | PASS (local/dev) | gk268-auth-recovery-ux 52/52, google-login 13/13, second-principal-capture-certification 20/20. /api/assets 404 = "no asset linked to this item" (by design, UI treats as none). Session is fixed 12h, no refresh: relogin required (UX friction, not a defect). |
| G | Operator corrections & provenance | PASS (local) | operator-confirmed title/variant/grade authority tests in base; attestation + capture-authenticity recorded in asset.minted event. |
| H | Governed marketplace listing readiness | NOT CERTIFIED | GK-240 fail-open fixed and proven through real list-ebay handler (172/172). Old Man Logan blocked by operator-only gates (below). |
| I | Realized economic outcome | NOT CERTIFIED | Requires a real completed external sale. |

## Defects repaired
1. GK-240: `api/list-ebay.js` now resolves authority evidence from the owned asset's durable row first (`src/lib/listingAuthorityEvidence.js`); absent sold diagnostics FAIL CLOSED. Tests: v1-gk240-listing-authority-fail-closed 9/9; list-ebay-outcome1-handler-smoke 172/172 (new forged-READY scenario -> 403, zero eBay writes).
2. Verification truthfulness: skipped claude-check = `{verified:null,status:'SKIPPED'}`; legacy cached `verified:true+skipReason` reclassified; priceNote says "active asks (not sold-verified)" for ask-derived prices.
3. P0-D: `src/lib/captureAuthenticity.js`, grade.js prompt/shapes/choke point, `src/lib/ownershipAttestation.js`; `/api/capture-scan` requires the fixed attestation statement (400 OWNERSHIP_ATTESTATION_REQUIRED) and refuses scan-flagged screens (400 CAPTURE_REFERENCE_ONLY); both client capture paths gained an unchecked-by-default checkbox; durable provenance in `asset.minted`.
4. Identity: unresolved edition => identityStanding CONFLICTED (`actionAuthority.js`).
5. UI: "Low match 100/100" contradiction (score hidden when tiers disagree); reference-only/provisional notice.

## Pre-existing failures (identical on pristine ba82e93, not regressions)
gk227-asset-media-append-handler-smoke (4/28), grailkey-operator-panel-capture-wiring (4/4, fixture collision with retained Development rows), p0a-rescan-continuity-handler-proof (5), gk168-edition-facet (18), gk159-commit4-terminal-floor-handler-smoke (8), gk277 (1, global-count race).

## Banked, not fixed
- Comp pool admits multi-issue lots ("#1 & 3"), "Gold Edition", other-publisher and "Best of" listings; no raw-pool grade-proximity filter (pricing-math greenlight).
- Active-path `comps.lastSoldDate`/`recentSales` carry an active listing's end date (api/comps.js:2470); not displayed as a sale (contract.lastSold is null).
- Collection attributes are client-synced; durable-evidence authority in list-ebay is per-request-forgery-proof, not server-computed.
- Authenticity detection is the model's claim; the attestation is the ownership control.

## Old Man Logan #25 (marketplace)
A2 resolved on Production code: title is `Old Man Logan Deodato #25 1:25 Marvel 2017 Raw NM-` (the earlier bare-"9.2" title was computed on stale local code). A3: `authoritativeRecommendation` ($4.18) is a stale enrich-time copy of out.price kept by `||` merge precedence; nothing in listing/price code reads it. A1 (confirmedTitle "Wolverine: Old Man Logan Giant-Size" vs the comic) and identity confirmations, persisted $19.99 price, Q41/LIST approval, seller identity (`/api/ebay-connection?verify=1`), duplicate state and eBay policies require the operator.
