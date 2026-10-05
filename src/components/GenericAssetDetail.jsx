// src/components/GenericAssetDetail.jsx — UNIVERSAL U1: the Generic asset card.
//
// A Generic asset is a first-class physical asset: durable gkAssetId, principal
// ownership, primary + additional photos, an operator-editable name and notes,
// the acquisition basis when supplied, an explicit GENERIC category label, and
// its Inventory Authority state. It deliberately shows NO grade, price,
// comps, decision, or listing control: a Generic asset has no automated
// economics and may remain Generic permanently. No reclassification control.

import { useEffect, useRef, useState } from "react";
import { genericDisplayLabel } from "../lib/genericAssetCapture.js";
import { updateGenericFields, addGenericPhoto, fetchGenericInventoryState } from "../lib/genericAssetManage.js";
import { downscaleImageDataUrl, readFileAsDataUrl } from "../lib/imageDownscale.js";

const INVENTORY_LABELS = {
  AVAILABLE: "Available — in your inventory",
  RESERVED: "Reserved",
  SOLD: "Sold",
  UNMANAGED: "Not yet in inventory control",
};

export default function GenericAssetDetail({ item, photos, onBack, onDelete, onItemChange, currentIndex, totalItems }) {
  const [name, setName] = useState(item.title || "");
  const [description, setDescription] = useState(item.description || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [inventory, setInventory] = useState(undefined); // undefined = loading, null = unknown
  const fileRef = useRef(null);

  useEffect(() => {
    setName(item.title || "");
    setDescription(item.description || "");
  }, [item.id]);

  useEffect(() => {
    let cancelled = false;
    setInventory(undefined);
    fetchGenericInventoryState(item.gkAssetId).then((s) => { if (!cancelled) setInventory(s); });
    return () => { cancelled = true; };
  }, [item.gkAssetId]);

  async function saveFields() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const entry = await updateGenericFields(item, { name, description });
      if (onItemChange) onItemChange(entry);
      setMessage(entry._syncStatus === "synced" ? "Saved." : "Saved on this device — will sync when you're back online.");
    } catch (e) {
      setMessage(e?.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const dataUrl = await downscaleImageDataUrl(await readFileAsDataUrl(file));
      const { entry, kernel } = await addGenericPhoto(item, dataUrl);
      if (onItemChange) onItemChange(entry);
      setMessage(kernel === "pending" ? "Photo saved here — it will attach to the asset record when you're back online." : "Photo added.");
    } catch (err) {
      setMessage(err?.message || "Could not add the photo.");
    } finally {
      setBusy(false);
    }
  }

  const label = genericDisplayLabel(item);
  const dirty = name.trim() !== (item.title || "").trim() || description !== (item.description || "");

  return (
    <div className="detail-view" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#d4af37", fontSize: 15, cursor: "pointer" }}>← Back</button>
        {totalItems > 1 && <div style={{ color: "#888", fontSize: 12 }}>{currentIndex + 1} / {totalItems}</div>}
      </div>

      {photos[0] ? (
        <img src={photos[0]} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 10, background: "rgba(255,255,255,0.03)" }} />
      ) : (
        <div style={{ width: "100%", height: 220, background: "rgba(255,255,255,0.04)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#666" }}>No photo on this device</div>
      )}
      {photos.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto" }}>
          {photos.slice(1).map((p, i) => (
            <img key={i} src={p} alt="" style={{ height: 64, borderRadius: 6, background: "rgba(255,255,255,0.03)" }} />
          ))}
        </div>
      )}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        style={{ marginTop: 10, width: "100%", padding: "9px 0", borderRadius: 6, border: "1px dashed rgba(212,175,55,0.4)", background: "transparent", color: "#d4af37", fontWeight: 700, fontSize: 13, cursor: busy ? "not-allowed" : "pointer" }}
      >
        📷 Add photo
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhoto} />

      <div style={{ marginTop: 14 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#0a0a0a", background: "#d4af37", padding: "2px 8px", borderRadius: 4 }}>GENERIC ASSET</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>{label}</div>

      <label style={{ display: "block", color: "#888", fontSize: 12, marginTop: 14, marginBottom: 4 }}>Name (optional)</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add a name when you know it"
        style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)", color: "#eee", fontSize: 14, boxSizing: "border-box" }}
      />
      <label style={{ display: "block", color: "#888", fontSize: 12, marginTop: 10, marginBottom: 4 }}>Notes</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)", color: "#eee", fontSize: 14, resize: "vertical", boxSizing: "border-box" }}
      />
      <button
        onClick={saveFields}
        disabled={busy || !dirty}
        style={{ marginTop: 8, width: "100%", padding: "9px 0", borderRadius: 6, border: "none", background: dirty && !busy ? "#d4af37" : "rgba(255,255,255,0.1)", color: dirty && !busy ? "#0a0a0a" : "#777", fontWeight: 700, fontSize: 13, cursor: dirty && !busy ? "pointer" : "not-allowed" }}
      >
        Save changes
      </button>
      {message && <div style={{ color: "#c9a227", fontSize: 12, marginTop: 8 }}>{message}</div>}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
        <div><span style={{ color: "#888" }}>Category: </span><span style={{ color: "#eee" }}>Generic</span></div>
        <div>
          <span style={{ color: "#888" }}>Inventory: </span>
          <span style={{ color: "#eee" }}>{inventory === undefined ? "checking…" : (inventory ? (INVENTORY_LABELS[inventory] || inventory) : "unavailable right now")}</span>
        </div>
        <div>
          <span style={{ color: "#888" }}>Acquisition cost: </span>
          <span style={{ color: "#eee" }}>{item.purchasePrice != null ? `$${Number(item.purchasePrice).toFixed(2)}` : "—"}</span>
        </div>
        {item.gkAssetId && (
          <div><span style={{ color: "#888" }}>GrailKey asset id: </span><span style={{ color: "#666", fontSize: 11, wordBreak: "break-all" }}>{item.gkAssetId}</span></div>
        )}
      </div>

      {onDelete && (
        <button
          onClick={() => {
            if (confirm(`Delete "${label}"?`)) {
              onDelete(item.id);
              onBack();
            }
          }}
          style={{ marginTop: 20, width: "100%", padding: "10px 0", borderRadius: 6, border: "1px solid rgba(224,86,86,0.4)", background: "transparent", color: "#e05656", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          Delete
        </button>
      )}
      <div style={{ color: "#666", fontSize: 10, marginTop: 10 }}>
        Generic assets have no automated grading, pricing, or marketplace listing — this is a durable ownership record you manage yourself.
      </div>
    </div>
  );
}
