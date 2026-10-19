# V1 P0 — /api/collection source authority (2026-10-19)

Branch `v1-source-authority` = RC `56b2448` + this fix. NOT pushed, NOT deployed. The RC branch `v1-certification-rc` is unmodified.

## The vulnerability (VERIFIED BY EXECUTION on pristine `56b2448`)
Authenticated `POST /api/collection` (real handler, real Development Postgres) with forged `decision`, `pricingSource`, `soldCompDiagnostics`,
`matchConfidence`, `identityConfident` and `contract` -> persisted verbatim -> real `api/list-ebay.js` preflight read them as "durable" evidence ->
**HTTP 200 and an AddFixedPriceItem call** (eBay fetch mocked and counted) with no Q41 acknowledgement and no evidence in the request.
`tests/v1-collection-source-authority.test.js`: 8 pass / 10 fail on `56b2448`; 18/18 on this branch.

Already protected before this fix (VERIFIED, same test): `identityAuthority`, `modelPredicted*`, `gradeAuthority`/`operatorGrade*`,
`currentGradePrediction` (GK-260/261 immunity lists) and category immutability (409). The unprotected set was the market/readiness evidence.

## The fix
- `src/lib/authorityReceipt.js` — `api/enrich.js` signs (HMAC-SHA256, purpose-derived key from the session secret, bound to the authenticated principal)
  the exact execution-deciding values it derived, on every response, as `authorityReceipt`. Stateless (no KV).
- `src/modules/collection/repository.js` (`upsertItem`/`updateItem`, the single choke point for `/api/collection` and the grade-claim save):
  a write WITH a receipt that verifies for the principal has its execution fields OVERWRITTEN from the signed payload and gets a server-set
  `authorityProvenance: SERVER_RECEIPT`; a write WITHOUT one has those fields and the receipt slot DISCARDED, and the existing row's values stand.
  Client-supplied `authorityProvenance` is always deleted.
- `src/lib/listingAuthorityEvidence.js` / `api/list-ebay.js` — the preflight derives authority from a VERIFIED, identity-matching receipt only;
  otherwise the fail-closed floor (REVIEW / NO_MARKET_EVIDENCE) applies. The refusal now names `authorityReceipt: UNVERIFIED:<reason> | IDENTITY_MISMATCH`.
  The request can only ADD restrictions. The explicit Q41 price acknowledgement is unchanged (operator intent stays in operator-sourced fields).
- `src/App.jsx` — the receipt travels with the contract it was issued for at all 10 contract-merge sites (never mixed across responses).

## Decisions and residuals (disclosed)
- Legacy rows that already hold client-written authority values are NOT upgraded: they carry no receipt, so they fail closed until the next enrich refresh issues one.
- A genuine receipt can be replayed by its own principal onto another row of the SAME book (same issue, >= 50% title-word overlap). That is the same market
  evidence, so it is accepted; a different book is refused (IDENTITY_MISMATCH). Receipts carry `issuedAt` but no listing-time age limit is enforced (not added).
- Loose display fields the client keeps (`rawComps` prices, `soldComps`) are untrusted display state, never read for authority.
- Not covered: the `title`/`issue`/`year`/`publisher` identity facts remain client-writable unless an OPERATOR_CONFIRMED facet protects them (GK-278B).
- Existing production clients that do not yet carry the receipt through every code path will see READY withheld (fail closed) until refreshed.
