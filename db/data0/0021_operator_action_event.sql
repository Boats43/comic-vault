-- =====================================================================
-- 0021 -- OperatorAction: human decision as kernel truth
-- =====================================================================
-- Extends Chain #2's evidence -> prediction -> recommendation chain
-- with the FOURTH distinct truth: what the authenticated human actually
-- chose. recommendation != operator_action != marketplace_outcome
-- (this dispatch's own binding invariant) -- this table represents
-- ONLY the middle term. It must never be confused with `decision_event`
-- (GrailKey's own engine-authored recommendation, e.g. Chain #2's
-- `LIST_LOW` row -- never the operator's choice) nor with any future
-- marketplace-execution/outcome table (eBay listing IDs, sales, fees --
-- none of that belongs here, GK-199/OperatorAction dispatch's own §11
-- boundary).
--
-- Audited first (this dispatch's own §3): no existing live table
-- represents "an immutable action intentionally performed by the
-- authenticated operator" -- decision_event is engine-authored,
-- acquisition_event is a one-time intake fact (wrong CHECK enum
-- entirely), domain_event is a generic opaque-payload audit envelope
-- (this new table's own recordOperatorAction ALSO writes one, per the
-- existing recordValuation/recordDecision convention, exactly as
-- 0004's other writers already do -- domain_event supplements, never
-- substitutes for, a dedicated typed table). outcome_event (0006,
-- design-draft, NOT applied to data1_dev) is the NEXT lifecycle layer
-- (LISTED/SOLD/FEES_FINALIZED/...) -- marketplace execution outcomes,
-- not human intent; explicitly out of this migration's scope.
--
-- Action vocabulary (action_code) -- DISCLOSED GAP, not invented
-- silently: this dispatch's own UI audit found NO existing product
-- surface wired end-to-end to record an intentional LIST/HOLD/PASS
-- decision against a GrailKey recommendation with GrailKey auth
-- context (the real "List on eBay" button exists and calls a real
-- backend, but carries zero principalId/gkAssetId/session token --
-- entirely disconnected from this kernel). No real, already-validated
-- product vocabulary exists to inherit. The three values below are the
-- SMALLEST set grounded in decisionEngine.js's own existing action
-- roots (LIST_NOW/LIST_LOW share "LIST"; DO_NOT_LIST negates it;
-- RESEARCH/GRADE_CANDIDATE are deferral states, hence HOLD) --
-- deliberately NOT a generalized workflow enum for a hypothetical
-- future product. Widening this CHECK constraint later (e.g. adding
-- an explicit NO_ACTION/DISMISSED code once a real dismiss-UI signal
-- exists) is additive and append-only-compatible.
--
-- Idempotency: reuses the EXISTING class-wide idempotency_key law
-- (operation='recordOperatorAction') -- IDENTICAL mechanism to
-- recordValuation/recordDecision/recordAcquisition, not a new one.
-- A client-generated idempotencyKey minted once per intentional button
-- press is what distinguishes a transport RETRY (same key -> replay,
-- zero duplicate row) from a genuinely later, distinct human decision
-- (a fresh key minted at the new press -> a new row, even if
-- action_code happens to match the prior one -- §9/§10's own append-
-- only law, no code change required to satisfy it, the SAME mechanism
-- already proven for the other three writers handles this by
-- construction).
--
-- Authorization: principal_id is NEVER accepted from an untrusted
-- client body -- the service layer (recordOperatorAction,
-- src/modules/assets/service.js) requires it be the caller's own
-- verifyToken()-derived principalId, exactly like recordValuation/
-- recordDecision/recordAcquisition already do. decision_event_id is
-- REQUIRED (NOT NULL) for this dispatch's minimal scope -- an operator
-- action that cannot float unattached to the historical recommendation
-- it responds to (this dispatch's own §13 "existing asset/evaluation
-- linkage" requirement). A future operator action with no prior
-- recommendation at all is a legitimate but DIFFERENT case, deferred.
--
-- REVERSIBILITY: one new, fully independent table (no existing table
-- altered). Rollback drops it and nothing else.
-- =====================================================================

SET search_path TO data1_dev;

CREATE TABLE operator_action_event (
  id                     UUID PRIMARY KEY,
  gk_asset_id            UUID NOT NULL REFERENCES gk_asset(id),
  decision_event_id      UUID NOT NULL REFERENCES decision_event(id),
  principal_id           UUID NOT NULL REFERENCES gk_principal(id),
  action_code            TEXT NOT NULL CHECK (action_code IN ('LIST', 'HOLD', 'PASS')),
  action_value_amount    NUMERIC(12,2),
  action_value_currency  TEXT NOT NULL DEFAULT 'USD',
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                 TEXT NOT NULL CHECK (source IN ('operator-api', 'test-fixture')),
  correlation_id         UUID NOT NULL
);
CREATE INDEX ON operator_action_event (gk_asset_id, occurred_at);
CREATE INDEX ON operator_action_event (decision_event_id);
