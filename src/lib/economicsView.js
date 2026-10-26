// src/lib/economicsView.js -- OUTCOME #1 FIRST SALE (2026-10-26). Pure, no I/O.
//
// THE ONE PLACE that decides what is KNOWN and what is UNKNOWN about a sale's money.
//
// Why: getRealizedEconomics used to COALESCE every absent component to 0 and sum, so a sale with a known gross and an
// unarrived fee read as "net = gross" -- a still-unknown fee silently became "$0 in fees". Absent now means UNKNOWN, and
// UNKNOWN is never arithmetic.
//
// DEFINITIONS (binding)
//   KNOWN    -- at least one persisted component row of that type exists. An explicitly verified ZERO (a row whose
//               amount is 0.00, from eBay or from the operator with a receipt) is KNOWN and equals $0.
//   UNKNOWN  -- no row of that type exists. Never $0, never inferred, never carried forward from another field.
//   Required for a net: gross, fees, shipping (postage). refund and credit are ADJUSTMENTS: included when a row exists;
//   their absence is not claimed to be zero, only "none recorded" (a later refund can still arrive).
//   economics status
//     PENDING    -- no gross recorded yet (only the order reference, or nothing).
//     INCOMPLETE -- gross known, at least one of fees / shipping still UNKNOWN. No net is produced.
//     COMPLETE   -- gross, fees and shipping all KNOWN. A net is produced.
//   NET PROCEEDS are not PROFIT. Acquisition cost is not tracked by this system for a sale yet, so profit is always
//   UNKNOWN here; packaging cost and payout are likewise untracked and reported UNKNOWN.

export const REQUIRED_FOR_NET = Object.freeze(['gross', 'fees', 'shipping']);
const ADJUSTMENTS = Object.freeze(['refund', 'credit']);
const TYPES = Object.freeze(['gross', 'fees', 'shipping', 'refund', 'credit']);

const toCents = (x) => Math.round(Number(x) * 100);
const fromCents = (c) => c / 100;

/** presence + dollar totals from either the repository summary or a bare component list. */
export function summarizeComponents(economics) {
  const comps = Array.isArray(economics?.components) ? economics.components : [];
  const present = {};
  const totals = {};
  for (const t of TYPES) {
    const typed = comps.filter((c) => c.component_type === t);
    const rows = typed.filter((c) => c.amount !== null && c.amount !== undefined);
    // presence = a row of that type exists (the table guarantees an amount on every non-reference row)
    present[t] = economics?.present && typeof economics.present[t] === 'boolean' ? economics.present[t] : typed.length > 0;
    if (present[t]) {
      const fromRows = rows.length > 0 ? rows.reduce((s, c) => s + toCents(c.amount), 0) / 100 : null;
      const fromSummary = economics && economics[t] !== undefined && economics[t] !== null ? Number(economics[t]) : null;
      totals[t] = fromRows !== null ? fromRows : fromSummary;
    } else {
      totals[t] = null;
    }
  }
  return { present, totals };
}

/** @returns {{status:'PENDING'|'INCOMPLETE'|'COMPLETE', missing:string[]}} */
export function classifyEconomics(economics) {
  if (!economics?.hasAnyComponent) return { status: 'PENDING', missing: [...REQUIRED_FOR_NET] };
  const { present } = summarizeComponents(economics);
  if (!present.gross) return { status: 'PENDING', missing: REQUIRED_FOR_NET.filter((t) => !present[t]) };
  const missing = REQUIRED_FOR_NET.filter((t) => !present[t]);
  return { status: missing.length === 0 ? 'COMPLETE' : 'INCOMPLETE', missing };
}

/**
 * computeRealizedNet -- gross - fees - shipping - refund(if recorded) + credit(if recorded), in integer cents; null
 * unless every REQUIRED component is KNOWN. Never treats an absent component as 0.
 */
export function computeRealizedNet(totals, present) {
  if (!REQUIRED_FOR_NET.every((t) => present?.[t] && totals?.[t] !== null && totals?.[t] !== undefined)) return null;
  let c = toCents(totals.gross) - toCents(totals.fees) - toCents(totals.shipping);
  if (present.refund && totals.refund !== null) c -= toCents(totals.refund);
  if (present.credit && totals.credit !== null) c += toCents(totals.credit);
  return fromCents(c);
}

const LABELS = { gross: 'Sale amount', fees: 'eBay fees', shipping: 'Postage', refund: 'Refunds', credit: 'Credits' };

/**
 * buildEconomicsView -- the operator-facing model. Every line is either {status:'KNOWN', amount} or
 * {status:'UNKNOWN', amount:null}; the UI renders UNKNOWN as "Unknown", never as $0.
 */
export function buildEconomicsView(economics) {
  const { status, missing } = classifyEconomics(economics);
  const { present, totals } = summarizeComponents(economics);
  const lines = TYPES.map((t) => ({
    key: t, label: LABELS[t],
    status: present[t] ? 'KNOWN' : 'UNKNOWN',
    amount: present[t] ? totals[t] : null,
    required: REQUIRED_FOR_NET.includes(t),
  }));
  const net = status === 'COMPLETE' ? computeRealizedNet(totals, present) : null;
  return {
    status,
    missing,
    lines,
    netProceeds: net === null
      ? { status: 'UNKNOWN', amount: null, reason: status === 'PENDING' ? 'sale amount not yet recorded' : `still unknown: ${missing.join(', ')}` }
      : { status: 'KNOWN', amount: net, includesRefunds: present.refund, includesCredits: present.credit },
    notTracked: { packaging: 'UNKNOWN', payout: 'UNKNOWN', acquisitionCost: 'UNKNOWN' },
    profit: { status: 'UNKNOWN', amount: null, reason: 'acquisition cost is not recorded; net proceeds are not profit' },
    orderId: economics?.externalOrderId ?? null,
    canRecordPostage: !present.shipping,
  };
}
