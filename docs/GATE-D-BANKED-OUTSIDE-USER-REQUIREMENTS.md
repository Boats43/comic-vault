# Gate D: banked outside-user requirements (recorded 2026-10-21, not implemented)

## GD-1: surface an unresolved variant without granting authority
**Observed behavior (S0, `tests/gate-b-enrich-variant-refusal-smoke.test.js`):** Vision suggests a 1:25 edition; the identity reconciler finds no independent corroboration and clears the unsupported `confirmedVariant` (`[reconcile-variant] CLEARING ... authority=NONE`); pricing proceeds as the REGULAR edition ($4.18 from 16 regular covers in the fixture). The response carries no variant claim at all, so the UI does not necessarily tell the user that an unresolved variant could materially change the estimate.

**Requirement for outside users:** when a model/Vision variant suggestion is cleared for lack of authority, show an "unresolved variant" prompt that asks the user to confirm or reject it. The prompt must NOT grant Vision any listing or pricing authority, must NOT change the price until the user confirms (operator confirmation is the only path that engages variant-exact pricing), and must not describe the regular-edition estimate as applying to the suggested variant.

**Wording constraint:** an active-ask-derived estimate (for example $15.29 from five 1:25 asks) is an estimate from active listings, not a realized sold price, and must never be labelled a sale price.

Status: BANKED. UI change not implemented in this pass.
