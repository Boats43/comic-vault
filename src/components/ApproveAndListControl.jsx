// src/components/ApproveAndListControl.jsx -- the seller's ONE action: "Review Listing" -> "Approve & List".
//
// Step 1 "Review Listing" shows everything the action will authorize: the price, the title and variant, condition and item
// specifics, the description, the actual photographs that will publish (and the views that are missing), the price acknowledgement
// (the exact locks) when one is required, unresolved warnings, and what the approval does NOT cover (shipping and returns).
// Step 2 is a separate, explicit confirmation button. Nothing is published by reviewing.
// The sequence itself lives in src/lib/approveAndList.js (approve package -> Q41 -> LIST authority -> publish) and aborts safely on
// any refusal; every server gate (C1 receipt, Q41 price binding, LIST price, signed package approval, ordered photo hashes,
// duplicate guard, attempt ledger, provider-UUID recovery) is unchanged and still enforced by the server.

import { useState, useCallback, useEffect } from "react";
import { authFetch, isAuthenticated } from "../lib/grailkeySession.js";
import { deriveQ41Requirement, Q41_KIND } from "../lib/q41Authority.js";
import { AAL_STATUS, SHIPPING_RETURNS_NOTICE } from "../lib/approveAndList.js";

/** Pure: may the seller start Approve & List for this card at this price, and what would the price acknowledgement be? */
export function deriveApproveAndListGate({ item, price }) {
  const q41 = deriveQ41Requirement({ contract: item?.contract, priceOverridden: item?.priceOverridden, q41Ack: item?.q41Ack, price });
  const priceOk = Number(price) > 0;
  const blocked = q41.kind === Q41_KIND.BLOCKED
    ? q41.blockedReason
    : (q41.required && !q41.acknowledged && !q41.canAcknowledge
      ? (q41.kind === Q41_KIND.INSUFFICIENCY ? "Set your own list price first: the engine could not verify one." : "A list price is required.")
      : (!priceOk ? "There is no valid list price." : null));
  return { q41, blocked };
}

const STEP_LABEL = { PREFLIGHT: "Checks", APPROVE_PACKAGE: "Approve listing package", Q41: "Acknowledge price", LIST_AUTHORITY: "Record LIST decision", PUBLISH: "Publish to eBay" };
const box = { marginTop: 10, padding: 10, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, fontSize: 12 };
const TONE = { LISTED: "#22c55e", REFUSED: "#ef4444", FAILED: "#eab308", UNCERTAIN: "#f59e0b" };

export default function ApproveAndListControl({ item, price, onApproveAndList }) {
  // The catalogue item does not carry the durable asset id; resolve it through the authenticated, ownership-checked asset graph.
  const [gkAssetId, setGkAssetId] = useState(null);
  useEffect(() => {
    let live = true;
    if (!isAuthenticated() || !item?.id) return undefined;
    authFetch(`/api/assets?collectionItemId=${encodeURIComponent(item.id)}`)
      .then((r) => (r && r.ok ? r.json() : null)).then((b) => { if (live) setGkAssetId(b?.asset?.asset?.id || null); }).catch(() => {});
    return () => { live = false; };
  }, [item?.id]);
  const [stage, setStage] = useState("idle"); // idle | reviewing | review | running | done
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [steps, setSteps] = useState([]);
  const [outcome, setOutcome] = useState(null);

  const { q41, blocked } = deriveApproveAndListGate({ item, price });

  const startReview = useCallback(async () => {
    setStage("reviewing"); setError(null); setOutcome(null); setSteps([]);
    try {
      const res = await authFetch("/api/listing-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", gkAssetId, price }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.package) throw new Error(data.message || data.error || `Review failed (${res.status})`);
      setReview(data.package); setStage("review");
    } catch (e) { setError(e.message); setStage("idle"); }
  }, [gkAssetId, price]);

  const confirm = useCallback(async () => {
    setStage("running"); setSteps([]); setOutcome(null);
    const result = await onApproveAndList({ price, confirmed: true, onStep: (step, state, detail) => setSteps((prev) => [...prev, { step, state, detail }]) });
    setOutcome(result); setStage("done");
  }, [onApproveAndList, price]);

  if (!isAuthenticated() || !gkAssetId) return null;
  const pkg = review;
  const blocking = (pkg?.unresolved || []).filter((u) => u.severity === "blocking");

  return (
    <div data-testid="approve-and-list" style={box}>
      <div style={{ fontWeight: 700 }}>Approve &amp; List</div>
      <div className="muted small" style={{ marginBottom: 6 }}>One action: approves this exact listing package, acknowledges your price (when required), records the LIST decision and publishes. It stops at the first refusal.</div>

      {stage === "idle" && (
        <button className="reset-btn" onClick={startReview} disabled={!!blocked} data-testid="aal-review-button">Review Listing</button>
      )}
      {stage === "reviewing" && <div className="muted">Preparing the review…</div>}
      {blocked && stage === "idle" && <div data-testid="aal-blocked" style={{ color: "#fca5a5", marginTop: 6 }}>{blocked}</div>}
      {error && <div style={{ color: "#ef4444", marginTop: 6 }}>{error}</div>}

      {(stage === "review" || stage === "running" || stage === "done") && pkg && (
        <div data-testid="aal-review">
          <div style={{ marginTop: 6 }}><strong>Price:</strong> ${Number(price).toFixed(2)} <span className="muted">— {pkg.price?.disclosure}</span></div>
          <div><strong>Title:</strong> {pkg.title}</div>
          <div><strong>Condition:</strong> {pkg.condition?.isRaw ? `Raw copy, operator grade ${pkg.condition.publicGrade}` : (pkg.condition?.publicGrade || "No operator-confirmed grade")} · certification {pkg.condition?.certification === "NONE" ? "none claimed" : pkg.condition?.certification}</div>
          <div><strong>Item specifics:</strong> {(pkg.specifics || []).map((s) => `${s.name}: ${s.value}`).join("; ") || "none provable"}</div>
          <div><strong>Photographs ({pkg.photos?.selected?.length || 0}):</strong> {(pkg.photos?.selected || []).map((p) => p.viewLabel).join(", ") || "none"}{(pkg.photos?.missingViews || []).length ? ` — not photographed: ${pkg.photos.missingViews.join(", ")}` : ""}</div>
          <div style={{ marginTop: 4 }}><strong>Description:</strong></div>
          <div className="muted" dangerouslySetInnerHTML={{ __html: pkg.descriptionBody }} />
          {q41.required && (
            <div data-testid="aal-q41" style={{ marginTop: 6, color: "#fde68a" }}>
              <strong>Price acknowledgement:</strong> {q41.kind === Q41_KIND.INSUFFICIENCY
                ? `The engine could not verify a price (${(q41.locks || []).map((l) => String(l.code).replace(/-/g, " ")).join(", ")}). Approving acknowledges that you set and verified $${Number(price).toFixed(2)} yourself.`
                : `Recommended action is ${q41.decision || "REVIEW"}, not LIST. Approving acknowledges $${Number(price).toFixed(2)} as your own verified price.`}
            </div>
          )}
          {(pkg.unresolved || []).filter((u) => u.severity === "advisory").map((u, i) => <div key={i} style={{ color: "#eab308" }}>⚠ {u.message}</div>)}
          {blocking.map((u, i) => <div key={i} style={{ color: "#ef4444" }}>✗ {u.message}</div>)}
          <div data-testid="aal-scope-note" className="muted" style={{ marginTop: 6 }}>{SHIPPING_RETURNS_NOTICE}</div>
        </div>
      )}

      {stage === "review" && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="reset-btn primary" onClick={confirm} disabled={blocking.length > 0 || !pkg?.approvable} data-testid="aal-confirm-button">Approve &amp; List on eBay</button>
          <button className="reset-btn" onClick={() => setStage("idle")}>Cancel</button>
        </div>
      )}

      {(stage === "running" || stage === "done") && (
        <div data-testid="aal-steps" style={{ marginTop: 8 }}>
          {steps.map((s, i) => <div key={i} className="muted">{s.state === "ok" ? "✓" : s.state === "skipped" ? "–" : s.state === "running" ? "…" : "✗"} {STEP_LABEL[s.step] || s.step}{s.detail ? ` (${s.detail})` : ""}</div>)}
        </div>
      )}
      {stage === "done" && outcome && (
        <div data-testid={`aal-result-${outcome.status}`} style={{ marginTop: 8, padding: 8, border: `1px solid ${TONE[outcome.status] || "#888"}`, borderRadius: 6, color: TONE[outcome.status] }}>
          <strong>{outcome.status === AAL_STATUS.LISTED ? "Listed on eBay" : outcome.status === AAL_STATUS.UNCERTAIN ? "Outcome not confirmed" : outcome.status === AAL_STATUS.FAILED ? "Not published (safe to retry)" : "Refused — nothing was published"}</strong>
          <div>{outcome.message}</div>
          {(outcome.blocking || []).map((b, i) => <div key={i}>✗ {b}</div>)}
          {outcome.code && outcome.status !== AAL_STATUS.LISTED && <div className="muted">code: {outcome.code}</div>}
          {outcome.status !== AAL_STATUS.LISTED && outcome.status !== AAL_STATUS.UNCERTAIN && <button className="reset-btn" style={{ marginTop: 6 }} onClick={() => setStage("idle")}>Review again</button>}
        </div>
      )}
    </div>
  );
}
