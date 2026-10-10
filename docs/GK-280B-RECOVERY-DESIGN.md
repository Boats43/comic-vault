# GK-280B — governing-grade economic cutover: recovery UX and write contract (DESIGN ONLY)

Status: **design only. Not authorized to implement. Not built. Not deployed.** Depends on GK-280A being released and certified first.
Ticket: GK-280B (the economic half of GK-280; GK-280A is the authority foundation). GK-260 and GK-261 stay CLOSED.

## 1. What GK-280B changes (and what it must not)

GK-280B moves *governing-grade authority ahead of comp admission* and makes every grade-dependent economic step
(sold-comp admission and grade proximity, active-comp grade parameter, ladder, multiplier, mega-key floor, decision)
consume ONE authoritative grade resolved from: verified certified grade, server-owned operator-confirmed grade, or the
server-recorded prediction named by the `currentGradePrediction` pointer GK-280A writes. When none exists it fails
closed. It must not change pricing math, multiplier tables, or admission thresholds — only which grade feeds them.

## 2. Population (read-only Production census, 2026-10-10, counts only)

| Class | Items | Governing-grade authority at cutover |
|---|---|---|
| SERVER_BASELINE_VALID | 53 | has a server-recorded prediction, but only 1 is *demonstrably current*; 52 are currentness-INDETERMINATE (see GK-280A report) |
| LEGACY_CLIENT_ASSERTED | 134 | none (a client-asserted grade is not a prediction and is never promoted) |
| NO_SERVER_PREDICTION | 11 | none (no displayed grade at all) |
| RECOVERABLE_EXACT / AMBIGUOUS_BINDING | 0 / 0 | n/a |
| **Total** | **198** | **at least 145 (134 + 11) unresolved; up to 197 if currentness-indeterminate baselines are also held** |

Development rates do not transfer (44 baselines of 480 there). Whether the 52 indeterminate-currentness baselines
resolve silently or ask the operator is a policy decision for the GK-280B ruling; the safe default is: a baseline is
usable only if demonstrably current, otherwise it is an *unconfirmed suggestion* like a legacy value.

## 3. Unresolved-authority behavior (what the card shows)

- Never a blank price and never `$0` standing in for "unknown". An item without governing-grade authority shows its
  identity and photos normally, its price area shows the single line **“Confirm the grade to price this copy.”**, and the
  existing `$0 != unknown` rule (pricing-experience closeout) is preserved: no numeric price field is emitted.
- The card carries one primary control: **Confirm grade** (one tap opens the existing operator-grade control, pre-filled with the
  legacy / suggested value *as a suggestion only*, never as selected authority).
- No listing or decision button is enabled for an unresolved item (the existing `listingHardLocked` machinery is reused; this is not a new gate).
- The collection header shows **“N of M copies need a grade confirmation”** with a progress bar; N updates as confirmations land.

## 4. Bulk review workflow (efficient human review, not automatic acceptance)

1. Entry: header counter → **Review grades** (queue of unresolved items, oldest first, stable order).
2. One item per screen: front photo, identity line, the legacy/suggested grade shown as a suggestion, a grade picker, and
   **Confirm** / **Skip**. Keyboard/gesture: Confirm advances to the next item automatically.
3. *Confirm* with the suggestion untouched still requires the explicit tap; there is no "accept all", no select-all, no
   default-on checkbox. Skipped items stay unresolved and counted.
4. Progress persists (the queue is simply "items still unresolved"); leaving and returning loses nothing.
5. A confirmation is available only for items the signed-in principal owns; the queue never lists another account's items.

## 5. Write contract (per item, server-validated, no bulk bypass)

Each confirmation is ONE request to the existing authority path — `POST /api/enrich` with `ownedRefresh:true`,
`collectionItemId`, and `operatorGradeAction:{action:'SET', grade, ...}` — i.e. exactly what a single-card grade confirmation does today
(`setOperatorGrade` → `applyGradingAuthorityPatch` → one `operator_correction_event` in the same transaction, under the row lock).
Consequences:

- **One durable `operator_correction_event` per confirmed item** (GRADE surface, action SET, `authority_before` = the prior state,
  `related_prediction_event_id` = the item's baseline event when it has one).
- There is **no batch endpoint** accepting N grades. The bulk screen is a client loop of per-item actions; each is independently
  authenticated, ownership-checked, validated and recorded. A failure of one item leaves the others untouched.
- The legacy / suggested value is never written as authority by the system. Only the operator's explicit Confirm creates
  `gradeAuthority:'OPERATOR_CONFIRMED'`.
- Idempotency: re-confirming the same grade is a recorded no-op (`correctionNoop`), not a second event.
- The GK-280A pointer is untouched by confirmation (operator authority and model-prediction pointer are separate facts).

## 6. Full positive recovery (what "recovered" means)

A confirmed legacy item must run the *entire* chain on the authoritative operator grade: comp admission (sold and active),
grade proximity, ladder cross-check, multiplier, mega-key floor where applicable, and decision — and the card must show the
grade source (“Confirmed by you”). Proof is behavioral (see §7), not a status flag.

## 7. Certification tests (to be written with GK-280B)

1. Unresolved item (legacy-asserted grade, no operator authority, no pointer): response carries no numeric price, shows the
   confirm message, decision is non-listable; `$0` never appears. Same for NO_SERVER_PREDICTION.
2. Confirm → exactly one `operator_correction_event`; replay → none; the item then prices.
3. Positive recovery: a confirmed legacy item's sold-comp admission, active-comp grade parameter, ladder, multiplier and
   decision all use the OPERATOR grade (instrument each; assert none reads the raw request grade).
4. Raw client grade can no longer influence admission: send a forged `grade` on the request with operator authority present — outputs
   identical to the unforged request.
5. Bulk screen: N confirmations = N events; no code path writes a grade for an item the operator did not confirm; "skip" writes nothing.
6. Cross-principal: confirming another principal's item id is refused and writes nothing.
7. Model-prediction tier: an item whose `currentGradePrediction` resolves and is demonstrably current prices on it; a pointer whose
   event is not the latest known prediction does not (policy per §2).
8. Economic regression: for items WITH authority, outputs equal GK-280A-era outputs for equivalent inputs.
9. Fail-closed: no governing grade → refuse to price, never fall back to the raw request grade.
10. Counters/labels: the unresolved count shown equals the server's own count.

## 8. Explicitly out of scope here

No UI built, no endpoint added, no migration, no change to `api/enrich.js` admission order, no pricing-math change.

## 9. Amendment (2026-10-10): resumable, idempotent, durable bulk confirmation — DESIGN ONLY

Requirements: resumable after interruption; idempotent per item; durable across refresh and re-login; explicitly confirmed by the operator
per physical copy; safe when one item fails midway; built on the existing per-item operator-authority write path (§5). Nothing here is built.

**9.1 The queue is server truth, not client memory.** "Unresolved" is computed from DURABLE state on every load: an item is unresolved iff it
has no `gradeAuthority = OPERATOR_CONFIRMED` and no demonstrably current server-recorded prediction (per the §2 policy). The count shown in the
header and the queue itself are derived from that, so they survive refresh, re-login, another device, and a cleared browser. The client may keep a
purely cosmetic cursor (last viewed item) in local storage; it is non-authoritative and losing it only restarts the view at the first unresolved item.

**9.2 Confirmation is one existing write per item, committed independently.** Each Confirm is the per-item `operatorGradeAction SET`
(`setOperatorGrade` -> `applyGradingAuthorityPatch`), which commits the durable authority and exactly one `operator_correction_event` in ONE transaction
under the item row lock. The server's durable state is the only record of completion: a confirmed item stays confirmed whatever happens to the
page, the request, or the batch. There is no batch endpoint and no "session" object that must complete.

**9.3 Idempotent per item.** Re-sending the same confirmation (double tap, retry after a lost response, replay after reconnect) hits the
existing no-op path (`correctionNoop: true`, no second event). A different grade for the same item is a new, legitimate SET and a new event. The
bulk loop therefore never needs to remember which items it already did: on resume it re-reads the queue (§9.1) and only unresolved items remain.

**9.4 Interruption and mid-batch failure.** Each item has an independent outcome shown in the UI: *confirmed*, *failed (retry)*, *skipped*.
A network error, 4xx/5xx, or an abort leaves THAT item unresolved and visible, never silently advanced past; the loop continues to the next item only
after the operator acts on a failure (retry or skip). An auth failure (401) stops the loop, shows the login gate, and resumes at the first unresolved item
after sign-in. Closing the app mid-batch loses nothing already confirmed and requires repeating nothing.

**9.5 Per physical copy, explicit.** The unit is the collection item (one physical copy). Duplicate copies of the same book are separate items with separate
confirmations; there is no grouping, select-all, "apply to all copies of this title", default-selected suggestion, or auto-advance on Skip that writes anything.
The legacy / suggested value is displayed as a suggestion only; the operator must tap Confirm (or edit then Confirm) for each copy.

**9.6 HARD PREREQUISITE for GK-280B — bulk operator confirmation must NOT consume grading spend-guard units when no paid grading operation occurs.** (Design risk found 2026-10-10, now ruled a prerequisite.) The per-item authority write currently travels through `POST /api/enrich`, which reserves 2 spend units
per call against the per-principal daily cap (300 units/day by default). 145 confirmations would consume ~290 of 300 units although NO paid model call is made
(the action does not need comps or a model). GK-280B must either route operator-authority-only confirmations through a lightweight endpoint that performs
the same validated write without the pricing pipeline (and without reserving spend), or exempt that request class from the guard — decided in the GK-280B
ruling; the validation and the one-event-per-item write contract above must be identical either way. The lightweight, authenticated path must preserve: one durable `operator_correction_event` per item, authorization (the signed-in principal owns the item; another principal's id is refused and writes nothing), per-item idempotency (a replay is a recorded no-op), and auditability (source, reason, build sha, before/after authority on the event). Arithmetic that makes this a prerequisite: 145 confirmations x 2 units = 290 of the 300 default daily units, leaving 10 for any real scan or enrichment that day. It is NOT implemented in GK-280A.

**9.7 Additional certification tests for GK-280B.** (a) kill the page after k of N confirmations, reload and re-login: exactly N-k remain, the k events exist
once each; (b) replay every request: no new events; (c) fail item j with a 500: j stays unresolved and listed, others unaffected, retry succeeds once; (d) 401 mid-batch:
loop halts, resumes at the first unresolved item; (e) two devices confirming the same item concurrently: one event + one no-op; (f) a confirmation for another principal's item
id is refused and writes nothing; (g) 145 confirmations complete without exhausting the daily spend cap.

## 10. Day-31 ANOTHER COPY (GK-280A limitation, recorded here because GK-280B recovers it)

A held copy resolved after the 30-day proof lifetime saves the item, the claim is REFUSED (`GRADE_CLAIM_PROOF_INVALID`, counted, and recorded on the local entry as
`_gradeClaimStatus: REFUSED`), and the server has no association. There is no server-side proof re-issuance (none was added: extending expiry or adding a
re-issue endpoint is a separate security review). Safe recovery today: a user-initiated re-grade of that item (one paid call; associates through the re-grade rule), and,
under GK-280B, operator confirmation with no model call. A no-model-call re-issue (authenticated, same principal, event still unbound) is a candidate GK-280B/280C item.
