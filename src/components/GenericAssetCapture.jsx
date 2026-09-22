// src/components/GenericAssetCapture.jsx — U4, Generic Asset Mode.
//
// U4.1 — the smallest operator-facing entry point for "Capture Generic
// Asset": explicit physical capture only, reachable ONLY from a
// dedicated button an operator taps on purpose (wired in src/App.jsx's
// Collection tab toolbar). This component is NEVER rendered from
// QUICK_LOOKUP/REFERENCE/SCREENSHOT flows or from any automatic/
// background path — those flows never import it. Submitting here is the
// ENTIRE mint/don't-mint decision point for a generic physical asset,
// exactly mirroring GrailKeyOperatorPanel.jsx's own "Capture as Owned
// Physical Asset" button for the comic path (see that file's header for
// the same design rationale).
//
// This component never calls /api/grade or /api/enrich, never imports
// ComicAdapter, and never computes or displays a price — all orchestration
// (idempotent mint, durable draft persistence, collection_item sync) lives
// in src/lib/genericAssetCapture.js; this file is presentation + form
// state only.

import { useEffect, useRef, useState } from "react";
import {
  createGenericCaptureDraft, updateGenericCaptureDraft, listGenericCaptureDrafts,
  discardGenericCaptureDraft, submitGenericCapture,
} from "../lib/genericAssetCapture.js";

export default function GenericAssetCapture({ onClose, onCaptured }) {
  const [draft, setDraft] = useState(null); // null until a photo is picked or a pending draft is resumed
  const [resumedNotice, setResumedNotice] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const fileInputRef = useRef(null);

  // A1 — resume any draft left behind by a reload/crash mid-capture,
  // using its EXACT persisted photo bytes and EXACT capture key, never a
  // fresh file-picker read or a fresh id.
  useEffect(() => {
    (async () => {
      const pending = await listGenericCaptureDrafts();
      if (pending && pending.length > 0) {
        // Only ever one generic-capture flow is open at a time (this
        // component itself has no way to create a second concurrent
        // draft) — the most recently created pending draft is resumed.
        const mostRecent = pending.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        setDraft(mostRecent);
        setName(mostRecent.name || "");
        setDescription(mostRecent.description || "");
        setAcquisitionCost(mostRecent.acquisitionCost != null ? String(mostRecent.acquisitionCost) : "");
        setResumedNotice(true);
      }
    })();
  }, []);

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      // A1 — persisted to IndexedDB (db.js's genericCaptureDrafts store)
      // immediately, before any network call. This IS the "generate the
      // stable capture key" step — createGenericCaptureDraft mints and
      // durably persists draft.id in the same call.
      const created = await createGenericCaptureDraft({ photoDataUrl: dataUrl, name, description, acquisitionCost: parseAcquisitionCost(acquisitionCost) });
      setDraft(created);
      setError(null);
    } catch (err) {
      setError(err?.message || "Could not read photo file.");
    }
  }

  function parseAcquisitionCost(raw) {
    if (raw === "" || raw == null) return null;
    const n = parseFloat(String(raw).replace(/[$,]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // Every field edit writes through to the durable draft immediately —
  // there is no separate "save" step for form fields; the photo (above)
  // and every field change are all persisted before Submit is ever
  // pressed, matching A1's persist-before-network-call requirement for
  // the WHOLE draft, not just the photo.
  async function commitField(patch) {
    if (!draft) return;
    const updated = await updateGenericCaptureDraft(draft.id, patch);
    setDraft(updated);
  }

  async function handleSubmit() {
    if (!draft || submitting) return;
    if (!name.trim()) {
      setError("A name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setAmbiguous(false);
    const finalDraft = { ...draft, name: name.trim(), description, acquisitionCost: parseAcquisitionCost(acquisitionCost) };
    await updateGenericCaptureDraft(draft.id, {
      name: finalDraft.name, description: finalDraft.description, acquisitionCost: finalDraft.acquisitionCost,
    });
    const result = await submitGenericCapture(finalDraft);
    setSubmitting(false);
    if (!result.ok) {
      if (result.ambiguous) {
        setAmbiguous(true);
      } else {
        setError(result.error || "Capture failed.");
      }
      return;
    }
    if (onCaptured) onCaptured(result.entry);
    if (onClose) onClose();
  }

  async function handleDiscard() {
    if (draft) await discardGenericCaptureDraft(draft.id);
    if (onClose) onClose();
  }

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ color: "#d4af37", fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>CAPTURE GENERIC ASSET</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        {resumedNotice && (
          <div style={{ color: "#c9a227", fontSize: 12, marginBottom: 10 }}>
            Resumed an in-progress capture from before — same photo, same record, will not create a duplicate.
          </div>
        )}

        <div style={{ color: "#888", fontSize: 11, marginBottom: 12 }}>
          For any physical item that isn't a comic. This mints a permanent, durable ownership record — no automated pricing, grading, or eBay listing.
        </div>

        {draft?.photoDataUrl ? (
          <img src={draft.photoDataUrl} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, background: "rgba(255,255,255,0.03)", marginBottom: 10 }} />
        ) : null}

        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ width: "100%", padding: "10px 0", borderRadius: 6, border: "1px dashed rgba(212,175,55,0.4)", background: "transparent", color: "#d4af37", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 12 }}
        >
          {draft?.photoDataUrl ? "Retake Photo" : "📷 Take / Choose Photo"}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhotoChange} />

        <label style={labelStyle}>Name *</label>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); commitField({ name: e.target.value }); }}
          placeholder="e.g. Vintage brass compass"
          style={inputStyle}
        />

        <label style={labelStyle}>Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => { setDescription(e.target.value); commitField({ description: e.target.value }); }}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />

        <label style={labelStyle}>Acquisition cost (optional)</label>
        <input
          value={acquisitionCost}
          onChange={(e) => { setAcquisitionCost(e.target.value); commitField({ acquisitionCost: parseAcquisitionCost(e.target.value) }); }}
          placeholder="$0.00"
          inputMode="decimal"
          style={inputStyle}
        />

        {error && <div style={{ color: "#e05656", fontSize: 12, marginTop: 8 }}>{error}</div>}
        {ambiguous && <div style={{ color: "#c9a227", fontSize: 12, marginTop: 8 }}>Could not confirm the result — outcome unknown. Tap Submit again to safely retry; it will not create a duplicate.</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={handleDiscard}
            disabled={submitting}
            style={{ flex: 1, padding: "10px 0", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#999", fontSize: 13, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!draft?.photoDataUrl || !name.trim() || submitting}
            style={{
              flex: 2, padding: "10px 0", borderRadius: 6, border: "1px solid rgba(212,175,55,0.4)",
              background: submitting ? "#333" : "transparent", color: "#d4af37", fontWeight: 700, fontSize: 13,
              cursor: (!draft?.photoDataUrl || !name.trim() || submitting) ? "not-allowed" : "pointer",
              opacity: (!draft?.photoDataUrl || !name.trim()) ? 0.5 : 1,
            }}
          >
            {submitting ? "Capturing…" : "Capture Asset"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
};
const panelStyle = {
  background: "#141414", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 12,
  padding: 16, width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto",
};
const labelStyle = { display: "block", color: "#888", fontSize: 11, marginTop: 10, marginBottom: 4 };
const inputStyle = {
  width: "100%", padding: "10px 12px", background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff", fontSize: 14,
  outline: "none", boxSizing: "border-box",
};
