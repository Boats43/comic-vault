// GK-273 — RESEARCH THE MARKET operator panel (saved item detail).
//
// Escalation only: shown when the structured market result is insufficient.
// Operator-triggered, never automatic. Everything rendered here is labelled
// as web research (candidate evidence) and sits BESIDE — never inside — the
// structured price authority, which this panel only echoes read-only.

import { useState, useEffect, useCallback } from "react";
import { authFetch, isAuthenticated } from "../lib/grailkeySession.js";
import {
  shouldOfferResearch, groupResearchRows, SECTION_TITLES, AUTHORITY_LABEL,
  formatRange, researchConclusion, describePricingAuthority,
} from "../lib/researchPresentation.js";

const box = { marginTop: 14, padding: 12, border: "1px solid rgba(96,165,250,0.35)", borderRadius: 8, background: "rgba(96,165,250,0.06)" };
const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function EvidenceRow({ r }) {
  const detail = [r.grade && `grade ${r.grade}`, r.gradingCompany, r.printing && `${r.printing} printing`, r.edition, r.country && `country: ${r.country}`, r.hrn && `HRN ${r.hrn}`]
    .filter(Boolean).join(" · ");
  return (
    <li style={{ padding: "6px 0", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 13, listStyle: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span><strong>{r.provider}</strong> <span className="muted small">(web research)</span></span>
        <span style={{ fontWeight: 700 }}>{money(r.price)}</span>
      </div>
      <div className="muted small">
        {r.saleDate ? `${r.saleDate} · ` : ""}{r.title || r.sourceTitle || ""}{detail ? ` — ${detail}` : ""}
      </div>
      <div className="muted small">
        match: {r.identityMatch.toLowerCase()} · authority: {AUTHORITY_LABEL[r.authorityStatus] || r.authorityStatus}
        {r.flags?.length ? ` · ⚠ ${r.flags.join(", ")}` : ""}
      </div>
      <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#60a5fa" }}>VIEW SOURCE</a>
    </li>
  );
}

// Results view (exported for rendering proof). Pure presentation of a saved
// research record; never touches price/authority.
export function ResearchResults({ record, item, busy = false, onRefresh = () => {} }) {
  if (!record) return null;
  const groups = groupResearchRows(record);
  const auth = describePricingAuthority(item);
  return (
    <div style={{ marginTop: 8 }}>
              {Object.keys(SECTION_TITLES).map((k) => (groups[k].length > 0 || ["confirmedRealized", "candidateRealized", "similarRealized", "activeAsks", "references"].includes(k)) && (
                <div key={k} style={{ marginTop: 8 }}>
                  <div className="muted small" style={{ letterSpacing: 1, fontWeight: 700 }}>{SECTION_TITLES[k]} ({groups[k].length})</div>
                  {groups[k].length === 0
                    ? <div className="muted small">None found.</div>
                    : <ul style={{ margin: 0, padding: 0 }}>{groups[k].map((r) => <EvidenceRow key={r.researchEvidenceId} r={r} />)}</ul>}
                </div>
              ))}
    
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(96,165,250,0.25)" }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>RESEARCH CONCLUSION</div>
                <div className="small">{researchConclusion(record)}</div>
                {record.researchRange && (
                  <div className="small" style={{ marginTop: 4 }}>
                    RESEARCH RANGE (candidate evidence — not a recommended price): <strong>{formatRange(record.researchRange)}</strong>
                  </div>
                )}
                {record.summary && <div className="muted small" style={{ marginTop: 4 }}>Researcher note (unverified): {record.summary}</div>}
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  AUTOMATED PRICING AUTHORITY: <strong>{auth.state}</strong>
                  {auth.marketStanding ? ` · market standing ${auth.marketStanding}` : ""} · Recommended price: {auth.recommended}
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  Researched {new Date(record.retrievedAt).toLocaleString()} · {record.usage?.webSearchCount ?? "?"} searches · {record.usage?.webFetchCount ?? "?"} fetches
                </div>
                <button disabled={busy} onClick={() => onRefresh()} className="btn" style={{ marginTop: 6 }}>
                  {busy ? "Researching…" : "REFRESH RESEARCH"}
                </button>
              </div>
            </div>
  );
}

export default function ResearchMarketPanel({ item }) {
  const [record, setRecord] = useState(null);
  const [limit, setLimit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    if (!isAuthenticated() || !item?.id) return;
    try {
      const res = await authFetch(`/api/research-market?collectionItemId=${encodeURIComponent(item.id)}`);
      if (res?.ok) { const d = await res.json(); setRecord(d.record || null); setLimit(d.limit || null); }
    } catch { /* read-only convenience; ignore */ }
  }, [item?.id]);

  useEffect(() => { load(); }, [load]);

  const run = async (refresh) => {
    setBusy(true); setMsg(null);
    try {
      const frontImage = Array.isArray(item.images) && typeof item.images[0] === "string" && item.images[0].startsWith("data:") ? item.images[0] : undefined;
      const res = await authFetch("/api/research-market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionItemId: item.id, refresh: refresh === true, frontImage }),
      });
      if (!res) { setMsg("Sign in to research the market."); return; }
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setRecord(d.record); setLimit(d.limit || null); if (d.cache === "HIT") setMsg("Showing saved research (no new search was run)."); }
      else setMsg(d.error || "Research failed.");
    } catch {
      setMsg("Research failed — no run was counted.");
    } finally {
      setBusy(false);
    }
  };

  if (!shouldOfferResearch(item) && !record) return null;
  if (!isAuthenticated()) return null;

  const remaining = limit ? Math.max(0, limit.max - limit.used) : null;

  return (
    <div style={box} data-testid="research-market-panel">
      <div style={{ fontWeight: 700, fontSize: 13, color: "#60a5fa", letterSpacing: 0.5 }}>RESEARCH THE MARKET</div>
      <div className="muted small" style={{ marginBottom: 8 }}>Search the live web for additional market evidence. Operator-run, limited searches; results are unverified candidates.</div>
      {!record && (
        <button disabled={busy} onClick={() => run(false)} className="btn" style={{ width: "100%" }}>
          {busy ? "Researching…" : "RESEARCH THE MARKET"}
        </button>
      )}
      {limit && <div className="muted small" style={{ marginTop: 4 }}>{remaining} of {limit.max} research runs left today</div>}
      {msg && <div className="small" style={{ color: "#f59e0b", marginTop: 6 }}>{msg}</div>}

      {record && <ResearchResults record={record} item={item} busy={busy} onRefresh={() => run(true)} />}
    </div>
  );
}
