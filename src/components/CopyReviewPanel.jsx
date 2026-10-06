// src/components/CopyReviewPanel.jsx — DUPLICATE ENTRY CLOSEOUT. Minimum review UI for items HELD
// by bulk import / JSON restore. A held item is NOT an error and never expires or auto-resolves.
// Presentation only: every choice is handed to the parent, which runs the existing server-validated
// SAME COPY / ANOTHER COPY authority (src/lib/copyReviewHeld.js).
import React from "react";

const box = { background: "#ff990022", border: "1px solid #ff9900", borderRadius: 6, padding: "8px 12px", margin: "8px 12px", color: "#ffaa33", fontSize: 13 };
const btn = { background: "#ff9900", color: "#000", border: "none", borderRadius: 4, padding: "6px 10px", fontWeight: 700, fontSize: 12 };
const ghost = { background: "transparent", color: "#ffaa33", border: "1px solid #ff9900", borderRadius: 4, padding: "6px 10px", fontWeight: 700, fontSize: 12 };

export default function CopyReviewPanel({ records, busyId, errors, onSame, onAnother, onDiscard, onRecheck }) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const n = records.length;
  return (
    <div style={box} data-testid="copy-review-panel">
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        {n} item{n === 1 ? "" : "s"} held for copy review
      </div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.85 }}>
        These look like books you already have. Nothing was discarded. Choose SAME COPY or ANOTHER COPY for each.
      </div>
      {records.map((r) => {
        const busy = busyId === r.id;
        const cands = r.candidates || [];
        return (
          <div key={r.id} style={{ borderTop: "1px solid rgba(255,153,0,0.3)", paddingTop: 8, marginTop: 8, display: "flex", gap: 10 }}>
            {r.image && <img src={r.image} alt="" style={{ width: 48, height: 72, objectFit: "cover", borderRadius: 3, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>
                {r.book?.title || "Untitled"}{r.book?.issue ? ` #${r.book.issue}` : ""}{r.book?.year ? ` (${r.book.year})` : ""}
              </div>
              {r.fileName && <div style={{ fontSize: 11, opacity: 0.7 }}>{r.fileName}</div>}
              {errors?.[r.id] && <div style={{ color: "#ff6666", fontSize: 12, marginTop: 4 }}>{errors[r.id]}</div>}
              {!r.candidatesVerified && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Could not check your owned copies yet — nothing was saved.{" "}
                  <button disabled={busy} style={ghost} onClick={() => onRecheck(r)}>Retry ownership check</button>
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {cands.map((c) => (
                  <button key={c.gkAssetId} disabled={busy} style={btn} onClick={() => onSame(r, c)}>
                    {cands.length > 1 ? `Same Copy — ${c.title || "?"}${c.issue ? ` #${c.issue}` : ""}${c.grade ? ` · ${c.grade}` : ""}` : "Same Copy"}
                  </button>
                ))}
                <button disabled={busy} style={ghost} onClick={() => onAnother(r)}>Another Copy</button>
                {r.candidatesVerified && cands.length === 0 && (
                  <button disabled={busy} style={ghost} onClick={() => onDiscard(r)}>Same book — discard this scan</button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
