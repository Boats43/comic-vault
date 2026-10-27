// src/components/ListingPreviewPanel.jsx -- V1.1a: the seller's LISTING PACKAGE preview, correction and approval.
//
// Shows exactly what would publish (title, condition, item specifics, description, the exact photographs and the views that are
// MISSING, the approved price + evidence class, unresolved fields, unsupported claims) from api/listing-preview.js. The seller can
// correct the title, add their own condition note and choose which durable photographs publish. Corrections are saved on the item
// (and synced); approval is a separate click that asks the server to sign THIS exact package. A generated draft is never
// permission to publish: api/list-ebay.js refuses without a current signed approval.
//
// Read-only toward eBay: nothing here publishes anything.

import { useState, useCallback, useEffect } from "react";
import { authFetch, isAuthenticated } from "../lib/grailkeySession.js";
import { isApprovalCurrent } from "../lib/listingPackage.js";

const SEV = { blocking: "#ef4444", advisory: "#eab308" };
const box = { marginTop: 12, padding: 12, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, fontSize: 12 };
const h = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#888", marginTop: 10, marginBottom: 4 };

const approvedHash = (approval) => { try { return JSON.parse(approval?.body || "{}").packageHash || null; } catch { return null; } };

export default function ListingPreviewPanel({ item, price, onSaveListingFields }) {
  // The catalogue item does not carry the durable asset id; resolve it through the authenticated, ownership-checked asset graph.
  const [gkAssetId, setGkAssetId] = useState(null);
  useEffect(() => {
    let live = true;
    if (!isAuthenticated() || !item?.id) return undefined;
    authFetch(`/api/assets?collectionItemId=${encodeURIComponent(item.id)}`)
      .then((r) => (r && r.ok ? r.json() : null)).then((b) => { if (live) setGkAssetId(b?.asset?.asset?.id || null); }).catch(() => {});
    return () => { live = false; };
  }, [item?.id]);
  const [pkg, setPkg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(item?.listingDraft?.conditionNote || "");
  const [titleOverride, setTitleOverride] = useState(item?.listingDraft?.titleOverride || "");
  const [selected, setSelected] = useState(() => new Set(item?.listingDraft?.selectedMediaIds || []));

  const draftFromForm = useCallback(() => ({
    titleOverride: titleOverride.trim() || undefined,
    conditionNote: note.trim() || undefined,
    selectedMediaIds: selected.size ? [...selected] : undefined,
  }), [titleOverride, note, selected]);

  const call = useCallback(async (body) => {
    const res = await authFetch("/api/listing-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.package) throw new Error(data.message || data.error || `Preview failed (${res.status})`);
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try { const d = await call({ action: "preview", gkAssetId, price, draft: draftFromForm() }); setPkg(d.package); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [call, gkAssetId, price, draftFromForm]);

  const save = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // Saving corrections invalidates any earlier approval (the package changes); the seller must approve again.
      const final = await onSaveListingFields(item, { listingDraft: draftFromForm(), listingApproval: null, listingApprovalMediaIds: null });
      if (final?._syncStatus && final._syncStatus !== "synced") setError("Corrections are saved on this device but have not reached the server yet; approval needs the server copy. Try again in a moment.");
      await refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [item, onSaveListingFields, draftFromForm, refresh]);

  const approve = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const d = await call({ action: "approve", gkAssetId, price });
      setPkg(d.package);
      await onSaveListingFields(item, { listingApproval: d.approval, listingApprovalMediaIds: d.package.photos.selected.map((p) => p.mediaId) });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [call, gkAssetId, price, item, onSaveListingFields]);

  if (!isAuthenticated() || !gkAssetId) return null;
  const current = pkg && isApprovalCurrent({ approvedPackageHash: approvedHash(item?.listingApproval) }, pkg);

  return (
    <div data-testid="listing-preview-panel" style={box}>
      <div style={{ fontWeight: 700 }}>Listing package</div>
      <div className="muted small" style={{ marginBottom: 6 }}>A draft is not permission to publish. Step 1: review and correct. Step 2: approve this exact package (valid 24 hours). Step 3: use the List on eBay button below, which still requires its own price acknowledgement and recorded LIST action.</div>
      <button className="reset-btn" onClick={refresh} disabled={busy}>{busy ? "Working…" : pkg ? "Refresh preview" : "Prepare listing preview"}</button>
      {error && <div style={{ color: "#ef4444", marginTop: 6 }}>{error}</div>}
      {pkg && (
        <div>
          <div style={h}>TITLE ({pkg.titleSource === "seller" ? "seller-edited" : "from verified facts"})</div>
          <div style={{ fontWeight: 700 }}>{pkg.title} <span className="muted">({pkg.title.length}/80)</span></div>
          <input value={titleOverride} onChange={(e) => setTitleOverride(e.target.value)} placeholder="Optional: your own title (must keep issue + edition)" style={{ width: "100%", marginTop: 4 }} maxLength={200} />

          <div style={h}>CONDITION</div>
          <div>{pkg.condition.isRaw ? `Raw copy, operator grade ${pkg.condition.publicGrade}` : (pkg.condition.publicGrade || "No operator-confirmed grade")}. Certification: {pkg.condition.certification === "NONE" ? "none claimed" : pkg.condition.certification}.</div>
          <div className="muted">{pkg.condition.note}</div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional seller condition note (your own observation)" rows={2} style={{ width: "100%", marginTop: 4 }} maxLength={1000} />
          {(pkg.modelObserved?.restoration || pkg.modelObserved?.defectPenalty) && (
            <div className="muted" style={{ marginTop: 4 }}>Model-observed condition (unverified, NOT published unless you add it to your note): {JSON.stringify({ restoration: pkg.modelObserved.restoration, defectPenalty: pkg.modelObserved.defectPenalty })}</div>
          )}

          <div style={h}>ITEM SPECIFICS</div>
          {pkg.specifics.length ? pkg.specifics.map((s) => <div key={s.name}>{s.name}: <strong>{s.value}</strong></div>) : <div className="muted">None provable.</div>}

          <div style={h}>PHOTOGRAPHS — exactly what will publish</div>
          {pkg.photos.selected.map((p) => (
            <div key={p.mediaId}>{p.role === "PRIMARY" ? "★ " : "• "}{p.viewLabel} <span className="muted">· {p.contentHash.slice(0, 10)}…</span></div>
          ))}
          {pkg.photos.selected.length === 0 && <div style={{ color: SEV.blocking }}>No eligible physical photograph.</div>}
          {pkg.photos.missingViews.length > 0 && <div className="muted">Missing (will not publish, not represented): {pkg.photos.missingViews.join(", ")}</div>}
          {(pkg.photos.candidates || []).length > 1 && (
            <div style={{ marginTop: 4 }}>
              <div className="muted">Choose which durable photographs publish:</div>
              {pkg.photos.candidates.map((c) => (
                <label key={c.mediaId} style={{ display: "block" }}>
                  <input type="checkbox" checked={selected.size === 0 ? c.selected : selected.has(c.mediaId)}
                    onChange={() => setSelected((prev) => { const base = prev.size ? new Set(prev) : new Set(pkg.photos.candidates.filter((x) => x.selected).map((x) => x.mediaId)); base.has(c.mediaId) ? base.delete(c.mediaId) : base.add(c.mediaId); return base; })} />
                  {" "}{c.viewLabel} <span className="muted">· {c.contentHash.slice(0, 10)}…</span>
                </label>
              ))}
            </div>
          )}

          <div style={h}>PRICE</div>
          <div>{pkg.price.amount != null ? `$${pkg.price.amount.toFixed(2)}` : "No approved price"} <span className="muted">— {pkg.price.disclosure}</span></div>

          <div style={h}>DESCRIPTION</div>
          <div style={{ whiteSpace: "normal" }} dangerouslySetInnerHTML={{ __html: pkg.descriptionBody }} />
          <div className="muted" style={{ marginTop: 6 }} data-testid="approval-scope-note">Shipping and return terms are fixed text added when you publish; the shipping service is resolved from eBay at that moment. <strong>This approval covers the category, title, condition, item specifics, description above, photographs and price. It does not cover shipping or return terms.</strong></div>

          {pkg.unresolved.length > 0 && (
            <div>
              <div style={h}>UNRESOLVED / UNSUPPORTED</div>
              {pkg.unresolved.map((u, i) => <div key={i} style={{ color: SEV[u.severity] || "#aaa" }}>{u.severity === "blocking" ? "✗ " : "⚠ "}{u.message}</div>)}
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="reset-btn" onClick={save} disabled={busy}>Save corrections &amp; re-check</button>
            <button className="reset-btn primary" onClick={approve} disabled={busy || !pkg.approvable} data-testid="approve-listing-package">{current ? "Approved ✓ (re-approve)" : "Approve this package"}</button>
          </div>
          <div className="muted" style={{ marginTop: 4 }} data-testid="approval-status">
            {current ? `Approved for publication (package ${pkg.packageHash.slice(0, 8)}). Any change requires re-approval.`
              : item?.listingApproval ? "A previous approval no longer matches this package — approve again." : "Not approved — a draft is not permission to publish."}
          </div>
        </div>
      )}
    </div>
  );
}
