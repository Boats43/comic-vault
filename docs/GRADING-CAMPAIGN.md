# Grading Campaign — control plane, provenance, economic grade authority, corpus contract

Recorded 2026-10-05. Not a broad architecture campaign.

## Campaign spine (no stage may claim what a later stage must prove)

1. REMOVE INVALID GRADE AUTHORITY — client/model-confidence `gradeLocked` (this release candidate); sold-comp client grade (OPEN, hard gate below).
2. MEASURE PROVENANCE RELIABILITY — Phase 1 observe-only counters (this RC); refusal is a later pass.
3. MAKE PREDICTIONS RECONSTRUCTIBLE — additive `evidence` metadata on the GRADE prediction payload.
4. BUILD BLIND CERTIFIED CORPUS — contract below; ZERO usable examples today.
5. MEASURE STABILITY / RESOLUTION / PRIMING — not run.
6. ONLY THEN CALIBRATE THE RUBRIC.

**NO RUBRIC CALIBRATION BEFORE CORPUS.**

## Standing process law

**A CONDITIONAL STOP IS A STOP. THE CONDITION IS EVALUATED BY THE REVIEWER, NOT THE IMPLEMENTER.** "IF X -> STOP / HOLD / REPORT" means return the finding and wait for reviewer authorization; do not evaluate X and keep implementing in the same pass.

## Permanent laws

- MODEL CONFIDENCE IS NOT AUTHORITY.
- A BARCODE OBSERVES IDENTITY, NOT CONDITION.
- CLIENT STATE MAY NOT MINT GRADE AUTHORITY.
- A CLIENT MAY NOT CHOOSE WHICH EVIDENCE THE SERVER BELIEVES.
- ONE GOVERNING GRADE MUST GOVERN THE ENTIRE ECONOMIC DECISION FOR THAT VALUATION.
- NEW MATERIAL VISUAL EVIDENCE MUST BE ABLE TO GENERATE A NEW MODEL PREDICTION.
- A GRADE MAY NOT BECOME ECONOMICALLY LOAD-BEARING WITHOUT A DURABLE RECORD THAT IT WAS PREDICTED (recorded, NOT yet enforced; GK-274 precedent: NULL IS NOT NEUTRAL).
- A PARAMETER VALIDATED FOR IDENTITY MAY NOT GOVERN CONDITION WITHOUT ITS OWN EVIDENCE (800px: chosen for cover IDENTIFICATION, commit `6fcd7e6`; never validated for condition).
- PRODUCTION MODEL REFERENCES SHOULD USE IMMUTABLE / DATED IDS WHERE THE PROVIDER SUPPORTS THEM.

## OUTSIDE-USER HARD GATES (before Production principal #2)

1. **CLIENT SOLD-COMP GRADE AUTHORITY CLOSED** — OPEN. CLIENT ECONOMIC AUTHORITY DEFECT: `api/enrich.js` passes the raw request `grade` (`assessedGrade: grade`, plus `fetchComps({ grade })`) into evidence admission BEFORE `resolveGoverningGrade`. It controls sold-comp +/-1.5 proximity, qualitative low-grade ceilings, the price-ladder floor, GK-228 ungraded-title handling and active-comp proximity. A client can post a different grade and change the evidence pool behind a `SERVER_DERIVED` valuation.
2. Seller location no longer hardcoded Phoenix.
3. DELISTED / relist normal operator recovery.
4. Existing multi-user identity/isolation requirements remain satisfied.

Until gate 1 closes, an outside user may exercise asset management but must not cross into economic-decision / listing behavior that depends on client-influenced grade evidence.

### Client callers of `/api/enrich` that supply `grade` (all client-mutable; none server-verified)
scan (`gradeBlob`) and bulk import: raw model grade from `/api/grade`; auto-refresh / refresh / manual refresh: `item.grade` from the catalogue (IndexedDB, also a client-writable synced attribute); re-identify: fresh `gradeData.grade`; manual entry: `manualGrade` typed by the user; barcode: no grade. Operator grade / certified grade are resolved separately and earlier on the server from the durable row (owned flows only) and govern the MULTIPLIER path only.

### Proposed minimum correction (design only, not implemented)
Reuse `resolveGoverningGrade` (`src/lib/gradeAuthority.js`); do not invent an authority system. `effectiveGradeAuthority`/`effectiveOperatorGrade` are already resolved server-side near the top of the handler (before comps/sold fetch), so the call can be moved before admission: compute ONE `governing` early with precedence (1) verified certified grade, (2) operator-confirmed grade, (3) server-recorded model prediction, (4) none; feed it to `fetchComps({grade})`, `verifySoldComps({assessedGrade})`, ladder selection, multiplier, valuation and decision. Tiers 1-2 are available today. Tier 3 is available only for a first grade (receipt / write-once baseline); a re-grade has no durable item->latest-prediction link, so tier 3 needs either a claimed receipt on re-grade or the item's own server-held record. When only a client grade exists (tier 4), the evidence must be admitted grade-agnostically or the economics refused: a pricing-evidence change that needs reviewer/greenlight authorization.

### Internal inconsistency today (model 2.0, operator validly corrects to 4.0)
Sold proximity, ungraded-title rule, active-comp proximity and ladder selection use the REQUEST grade (item.grade stays the model 2.0; operator fields are separate). Only the multiplier/`governingGrade` use the operator 4.0. Tier-2 `sold_active_blend_30` applies no multiplier, so the whole valuation is built from the 2.0 evidence pool while the card says governing 4.0. Desired: every stage uses the one governing 4.0.

## Traced facts

- `chooseBetterGrade` is CONFIDENCE-BASED on pricing `confidenceLevel` (not authority/magnitude/recency); it runs only after `/api/enrich` merges (auto-refresh, scan-enrich, bulk-enrich), `/api/enrich` never returns a model grade (`out.grade` is CGC-cert only), so it can neither install nor block a model grade. Latent, dormant defect: a CGC-verified grade could be rejected on a low pricing-confidence rank.
- Server-ignored legacy request fields: `gradeLocked`, `existingGrade`, `gradeConfidence`, `forceRegrade` are INERT in `api/grade.js`. Clients still send `existingGrade`/`gradeConfidence`/`forceRegrade` as dead payload. Do NOT reconnect any of them as authority.
- First grade: KV receipt (6h) claimed once into write-once `modelPredictedProvenance`; `model_prediction_event` is attempted for EVERY `/api/grade` call (first and re-grade) but its `inputHash` covers only `images[0]`, not the full photo set. A re-grade's receipt is never claimed (client sends no `_gradeReceiptId` for it), so if its event write fails NO durable provenance remains; the re-grade can still become current (`grade: data.grade || item.grade`) and reach pricing via the client-sent grade.
- Barcode path: Vision skipped, no image, no grade; `/api/enrich` never invents one; the item saves with `grade: ""`.
- Opus: provider lists `claude-opus-4-7` only undated; no dated Opus 4.7 id exists. Do not invent one. Banked (Watch only).

## Phase 1 observability (implemented in this RC, additive, no schema migration)

`src/lib/gradeProvenanceObservability.js`: one structured `[grade-provenance]` log line plus an Upstash daily counter per event:
`gk:gradeprov:v1:<UTC day>:<prediction|receipt>:<ok|write_failed|issued|not_issued>:<branch>:<model>:<buildSha>:<FIRST_GRADE|RE_GRADE>`.
Failure rate per kind = `write_failed / (ok + write_failed)`. `predictionKind` is an observability label only (client label, else inferred from image count). No prompt, image, condition prose or principal id. The grade continues exactly as before; persistence stays non-mandatory. IMPLEMENTED LOCALLY: not shipped, not deployed, not measuring Production yet. Phase 2 (refusal of a grade lacking durable prediction provenance) is a separate later pass after the measured rate.

## Photo roles and material re-grade rule

Role trace: the GK-227 evidence control in `GrailKeyOperatorPanel.jsx` (Back / Spine / Pages, only for kernel-linked items) passes `{gkAssetId, captureView}` to `addPhotoToComic`, which sends `imageViews` with ONLY the new photo's role (all earlier entries null) to `/api/grade` (guard + prediction-event metadata) and appends a kernel `media.capture_view` row; the role is NOT stored per image in IndexedDB / the catalogue `images` array. The ordinary saved-item Add Photo (`handleAddPhotoChange`) declares NO role. Classification: B (one path has a role, another does not), plus A for earlier photos (role known at capture, then dropped). Target rule (not implemented): first declared BACK / SPINE / PAGES is material; the same role again, a same-input-hash duplicate or an undeclared image is not (never infer from count); extra images are always preserved. Held because the ordinary strip has no role selector and roles are not retained per image.

## Spend delta (the RC is NOT spend-neutral; pricing math is unchanged)

Grade call = 3 units, enrich = 2; per-principal cap 300/day, global 6000/day. Photo cap is 4, so at most 3 Add Photo re-grades per fill. BEFORE: a HIGH-confidence (locked) asset's Add Photo cost 0 units; unlocked cost 3 each. AFTER: every Add Photo costs 3. Worst case per asset ending with 4 photos: before 3 (initial grade) [+9 if unlocked]; after 12 (+2 enrich initial = 14). Active-user projection at the full 4-photo path, 14 units/asset: 10 assets/day = 140 (headroom 160), 25 = 350 (EXCEEDS the 300 principal cap), 50 = 700; before the RC, all-locked: 5 units/asset = 50 / 125 / 250. Hard bounds that remain: the 4-photo cap per fill and the per-principal daily cap (a 429 refusal, fail-closed). Not bounded per asset: delete-and-re-add and explicit re-identify (each costs 3), still capped by the daily guard. `SPEND_GUARD_OPERATOR_PRINCIPAL_IDS`: CANNOT VERIFY. Options (reviewer authorization needed): per-asset automatic re-grade ceiling, or ship the material-view rule (needs role capture first).

## Test-debt diagnosis (identical at `11f9481` and at the RC)

- gk260 (62 pass / 3 fail, then a crash): sections 1-2 send UNAUTHENTICATED requests and now get HTTP 401 from the GK-269 access gate (`ea9aa6e`, 2026-09-30), so `body.gradeAuthority` is `undefined` not `null` (stale fixture; the forged claim is never minted, passing assertions in those sections pass vacuously). The final cleanup `DELETE FROM gk_principal` violates `operator_correction_event_principal_id_fkey` (GK-278 `6e9595e`, 2026-10-02): harness cleanup debt, and every run leaks one fixture principal in Development. All authenticated sections pass. Not behavioral.
- gk258: every request is unauthenticated -> 401 (GK-269), so its refuse-to-price assertions never reach pricing. It currently proves NOTHING about GK-258 behavior (stale fixture).
- gk213c: its two failing assertions expect pre-GK-269 unauthenticated behavior; same FK cleanup crash as gk260.

## Material below is unchanged from the earlier campaign record

### Branch determinism (experiment design only)
Pin the branch by calling the model directly from a Development-only scratch script (no handler, no writes): SONNET = STANDARD_PROMPT with the dated Sonnet id; HAIKU = `buildGradeOnlyPrompt` with a fixed hand-supplied consensus and the dated Haiku id; same image bytes. The handler cannot pin a branch (eBay consensus >=0.3 chooses it and it is re-chosen on every call). SHOULD IDENTITY-RETRIEVAL SUCCESS CHOOSE THE CONDITION-GRADING MODEL? NO: it is unrelated to condition difficulty, silently changes both model and prompt (identity-primed Haiku vs unprimed Sonnet), and makes the same book gradeable two ways.

### Ground-truth corpus contract (schema only; not built)
Each example: `corpus_item_id`, `certifying_body`, `certified_grade`, `certification_number` / verification reference, `authority_class = KNOWN_CERTIFIED_GRADE`, `capture_device`, `capture_conditions`, `truth_image_reference`, `blind_grading_image_reference`, `view_role`, `image_dimensions`, `slabbed_or_raw`, `model_visible_grade_label = false`, `notes`. The blind image MUST NOT expose the certified grade, certification number, barcode, QR code or filename metadata encoding the grade; slabbed: truth image shows the label, blind image excludes the label/cert area. SLAB PLASTIC / GLARE IS A DOMAIN SHIFT FROM RAW-COMIC PHOTOGRAPHY; pre-slab raw photos tied to a certified grade are preferred.

KNOWN_CERTIFIED_GRADE is the best available anchor, NOT a physical constant (professional grading has inter-grader / re-submission variance). Calibration targets directional bias, band accuracy, stability, severe outliers and reproducibility, NOT zero numeric error against every slab label.

Initial target about 10-20 examples: LOW 0.5-2.5; MID-LOW 3.0-4.5; MID 5.0-6.5; HIGH 7.0-8.5; VERY HIGH 9.0+. Current usable authoritative examples: ZERO.

## Banked test debt

- **gk258 merge-site coverage (GK-213B scope debt):** the old self-labelled PRE-EXISTING assertion expected `governingGrade` at exactly 1 of the 8 `App.jsx` merge sites; the count is now 8, so the stale expectation (not a defect) was removed from the executable assertions and the test only logs the count.
- **Deleted non-discriminating assertions (mutation proof: they passed with and without the protected behavior):** see the commit message of the release-hygiene commit for the per-assertion coverage statement.
- **COVERAGE LOSS (disclosed):** the GK-254 `ownedAssetAuthRequired` fail-closed branch inside `api/enrich.js` (owned flow, missing/invalid auth -> refusedToPrice) is no longer reachable over HTTP because the GK-269 access gate refuses first, so no test exercises that internal defense-in-depth branch.
