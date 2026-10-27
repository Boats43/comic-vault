// src/lib/approveAndList.js -- ONE explicit seller action that performs, strictly in order:
//
//   PREFLIGHT -> APPROVE_PACKAGE -> Q41 -> LIST_AUTHORITY -> PUBLISH
//
// It CREATES the artifacts the existing server gates require and never grants authority itself. Every server contract is unchanged and
// still independently enforced by api/list-ebay.js: the C1 authority receipt, Q41 price binding (assertQ41PriceBinding), the durable
// LIST action price (assertListActionPriceBinding), the signed listing-package approval (principal + asset + package hash, 24 h), the
// exact ordered photo hashes, the inventory/duplicate guard, the attempt ledger and provider-UUID recovery. If any step fails the
// sequence STOPS: nothing after it runs.
//
// Pure orchestration: every side effect is an injected dependency (so the whole contract is unit-testable without a browser).
//
// Result statuses (what the seller is told):
//   LISTED     the listing was created
//   REFUSED    a rule said no (nothing was published); `code`/`message` say which
//   FAILED     a step failed before publication; nothing was published; safe to retry
//   UNCERTAIN  the publish request's outcome is not known (network / 5xx / in-progress / ambiguous prior attempt). A listing MAY exist.
//              Retrying is safe (provider Item.UUID dedupe + attempt ledger + duplicate guard) but check Seller Hub / Check for Sale first.

import { deriveQ41Requirement, buildQ41Payload, buildQ41Ack, buildQ41Override, Q41_KIND } from './q41Authority.js';
import { planListAuthority } from './operatorListAction.js';

export const AAL_STATUS = Object.freeze({ LISTED: 'LISTED', REFUSED: 'REFUSED', FAILED: 'FAILED', UNCERTAIN: 'UNCERTAIN' });
export const AAL_STEP = Object.freeze({ PREFLIGHT: 'PREFLIGHT', APPROVE_PACKAGE: 'APPROVE_PACKAGE', Q41: 'Q41', LIST_AUTHORITY: 'LIST_AUTHORITY', PUBLISH: 'PUBLISH' });

/** Server answers that mean "an attempt may exist / is running": never reported as a clean refusal. */
export const UNCERTAIN_PUBLISH_CODES = Object.freeze(new Set([
  'PUBLICATION_IN_PROGRESS', 'LISTING_OUTCOME_UNKNOWN', 'DUPLICATE_UUID_UNVERIFIED', 'AMBIGUOUS_PRIOR_ATTEMPT', 'LISTING_ATTEMPT_AMBIGUOUS',
]));

export const SHIPPING_RETURNS_NOTICE =
  'This approval covers the title, condition, item specifics, description, photographs and price. It does NOT cover shipping or return terms: ' +
  'those are fixed text added when you publish, and the shipping service is resolved from eBay at that moment.';

const inFlight = new Set();
const result = (status, step, code, message, extra = {}) => ({ status, step, code, message, ...extra });

/**
 * @param {object} a
 * @param {object} a.item        the catalogue item (contract, q41Ack, priceOverridden, status ...)
 * @param {number} a.price       the exact price the seller reviewed
 * @param {boolean} a.confirmed  the explicit operator confirmation click (REQUIRED)
 * @param {object} a.deps        { approvePackage, acknowledgeQ41, getGraph, recordListAction, publish, isListed }
 * @param {(step:string, state:string, detail?:string)=>void} [a.onStep] progress callback for the UI
 */
export async function approveAndList({ item, price, confirmed, deps, onStep = () => {} }) {
  const trail = [];
  const step = (s, state, detail) => { trail.push({ step: s, state, detail: detail ?? null }); try { onStep(s, state, detail); } catch { /* UI callback must never break the flow */ } };
  const fin = (r) => ({ ...r, trail });
  const key = item?.id || null;

  // ── PREFLIGHT: explicit confirmation, one flight at a time, nothing already listed, a price, a Q41 position that CAN be acknowledged ──
  if (confirmed !== true) return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PREFLIGHT, 'CONFIRMATION_REQUIRED', 'Explicit seller confirmation is required.'));
  if (!item || !key) return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PREFLIGHT, 'NO_ITEM', 'No item selected.'));
  if (inFlight.has(key)) return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PREFLIGHT, 'ALREADY_IN_PROGRESS', 'An Approve & List for this item is already running.'));
  inFlight.add(key);
  try {
    const p = Number(price);
    if (!(p > 0)) return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PREFLIGHT, 'NO_PRICE', 'There is no valid list price.'));
    if (deps.isListed?.(item)) return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PREFLIGHT, 'ALREADY_LISTED', 'This book is already listed on eBay.'));
    const q41 = deriveQ41Requirement({ contract: item.contract, priceOverridden: item.priceOverridden, q41Ack: item.q41Ack, price: p });
    if (q41.kind === Q41_KIND.BLOCKED) return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PREFLIGHT, 'Q41_BLOCKED', q41.blockedReason));
    if (q41.required && !q41.acknowledged && !q41.canAcknowledge) {
      return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PREFLIGHT, 'Q41_NOT_ACKNOWLEDGEABLE', q41.kind === Q41_KIND.INSUFFICIENCY
        ? 'Set your own list price first: the engine could not verify a price, and acknowledging it requires a price you set and verified.'
        : 'A list price is required before the price can be acknowledged.'));
    }
    step(AAL_STEP.PREFLIGHT, 'ok');

    // ── APPROVE_PACKAGE: the server signs THIS exact package (title, specifics, description body, ordered photo hashes, price, category) ──
    step(AAL_STEP.APPROVE_PACKAGE, 'running');
    let ap;
    try { ap = await deps.approvePackage({ price: p }); }
    catch (e) { step(AAL_STEP.APPROVE_PACKAGE, 'failed', String(e?.message || e)); return fin(result(AAL_STATUS.FAILED, AAL_STEP.APPROVE_PACKAGE, 'APPROVE_NETWORK', 'The listing package could not be approved (network). Nothing was published.')); }
    if (!ap?.ok || !ap.approval) {
      step(AAL_STEP.APPROVE_PACKAGE, 'refused', ap?.code);
      const blocking = (ap?.blocking || []).map((b) => b.message).filter(Boolean);
      return fin(result(AAL_STATUS.REFUSED, AAL_STEP.APPROVE_PACKAGE, ap?.code || 'PACKAGE_NOT_APPROVABLE', ap?.message || 'The listing package cannot be approved yet.', { blocking }));
    }
    if (Math.abs(Number(ap.package?.price?.amount) - p) > 0.005) {
      step(AAL_STEP.APPROVE_PACKAGE, 'refused', 'PRICE_CHANGED');
      return fin(result(AAL_STATUS.REFUSED, AAL_STEP.APPROVE_PACKAGE, 'PRICE_CHANGED', 'The approved package price differs from the price you reviewed. Review again.'));
    }
    step(AAL_STEP.APPROVE_PACKAGE, 'ok');

    // ── Q41: acknowledge the exact reviewed price (only when the existing rules require it; same payload the existing buttons build) ──
    let q41Override = null;
    if (q41.required) {
      step(AAL_STEP.Q41, 'running');
      let acked = item;
      if (!q41.acknowledged) {
        const payload = buildQ41Payload({ kind: q41.kind, item, price: p });
        const ack = buildQ41Ack({ price: p, payload });
        try { acked = (await deps.acknowledgeQ41({ ack })) || { ...item, q41Ack: ack }; }
        catch (e) { step(AAL_STEP.Q41, 'failed', String(e?.message || e)); return fin(result(AAL_STATUS.FAILED, AAL_STEP.Q41, 'Q41_PERSIST_FAILED', 'The price acknowledgement could not be saved. Nothing was published.')); }
      }
      q41Override = buildQ41Override({ item: acked, overridePrice: p, displayPrice: p });
      if (!q41Override) { step(AAL_STEP.Q41, 'refused', 'Q41_UNAVAILABLE'); return fin(result(AAL_STATUS.REFUSED, AAL_STEP.Q41, 'Q41_UNAVAILABLE', 'The price acknowledgement is not in effect. Nothing was published.')); }
      step(AAL_STEP.Q41, 'ok');
    } else {
      step(AAL_STEP.Q41, 'skipped', 'not required');
    }

    // ── LIST_AUTHORITY: the durable LIST operator action must record exactly this price ──
    step(AAL_STEP.LIST_AUTHORITY, 'running');
    let graph;
    try { graph = await deps.getGraph(); } catch { graph = null; }
    if (!graph) { step(AAL_STEP.LIST_AUTHORITY, 'failed', 'graph unavailable'); return fin(result(AAL_STATUS.FAILED, AAL_STEP.LIST_AUTHORITY, 'GRAPH_UNAVAILABLE', 'GrailKey could not read this asset. Nothing was published.')); }
    const plan = planListAuthority({ graph, price: p });
    let operatorActionEventId = plan.operatorActionEventId;
    if (!plan.satisfied) {
      if (!plan.needsRecord) { step(AAL_STEP.LIST_AUTHORITY, 'refused', 'NO_DECISION'); return fin(result(AAL_STATUS.REFUSED, AAL_STEP.LIST_AUTHORITY, 'NO_DECISION', plan.blockedReason)); }
      const rec = await deps.recordListAction({ decisionEventId: plan.decisionEventId, price: p });
      if (!rec?.ok) {
        step(AAL_STEP.LIST_AUTHORITY, rec?.ambiguous ? 'uncertain' : 'refused', rec?.message);
        return fin(result(rec?.ambiguous ? AAL_STATUS.UNCERTAIN : AAL_STATUS.REFUSED, AAL_STEP.LIST_AUTHORITY, rec?.ambiguous ? 'LIST_ACTION_UNCERTAIN' : 'LIST_ACTION_REFUSED',
          `${rec?.message || 'The LIST decision could not be recorded.'} Nothing was published.`, { retrySafe: true }));
      }
      operatorActionEventId = rec.operatorActionEventId;
    }
    step(AAL_STEP.LIST_AUTHORITY, 'ok');

    // ── PUBLISH: the server independently re-checks every gate; a refusal here is final for this attempt ──
    step(AAL_STEP.PUBLISH, 'running');
    let pub;
    try { pub = await deps.publish({ approval: ap.approval, approvalPackage: ap.package, q41Override, price: p, operatorActionEventId, decisionEventId: plan.decisionEventId }); }
    catch (e) { pub = { ok: false, status: e?.status ?? null, code: e?.code ?? null, message: String(e?.message || e) }; }
    if (pub?.ok) { step(AAL_STEP.PUBLISH, 'ok', pub.listingId); return fin(result(AAL_STATUS.LISTED, AAL_STEP.PUBLISH, 'LISTED', 'Listed on eBay.', { listingId: pub.listingId ?? null, listingUrl: pub.listingUrl ?? null, artifacts: { operatorActionEventId } })); }
    const uncertain = pub?.status == null || pub.status >= 500 || UNCERTAIN_PUBLISH_CODES.has(pub?.code);
    if (uncertain) {
      step(AAL_STEP.PUBLISH, 'uncertain', pub?.code || String(pub?.status));
      return fin(result(AAL_STATUS.UNCERTAIN, AAL_STEP.PUBLISH, pub?.code || 'PUBLISH_OUTCOME_UNKNOWN',
        'The listing request did not return a clear answer, so a listing may or may not exist. Check Seller Hub / Check for Sale before doing anything else. Retrying here is safe (eBay de-duplicates the request), but do not publish from another device.',
        { retrySafe: true }));
    }
    step(AAL_STEP.PUBLISH, 'refused', pub?.code);
    return fin(result(AAL_STATUS.REFUSED, AAL_STEP.PUBLISH, pub?.code || 'PUBLISH_REFUSED', pub?.message || 'eBay publication was refused. Nothing was listed.'));
  } finally {
    inFlight.delete(key);
  }
}
