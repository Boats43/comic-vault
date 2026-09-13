// src/components/GrailKeyOperatorPanel.jsx — renders the durable GrailKey
// asset graph for one catalogue item (if one is linked) and the human
// decision controls (LIST/HOLD/PASS).
//
// I13 discipline: this panel shows only what the durable record actually
// contains — no client-side recomputation of valuation/recommendation, no
// fabricated fields. Absent data renders as an explicit "no durable record"
// state, never a blank silently standing in for missing evidence.
//
// decision_event (GrailKey's engine-authored recommendation) is never
// mutated by this panel. Clicking LIST/HOLD/PASS only ever creates a new
// operator_action_event via the existing /api/operator-action endpoint —
// this dispatch does not call eBay or write any marketplace/outcome row.

import { useEffect, useState, useCallback } from "react";
import { authFetch, isAuthenticated, getPrincipalScope } from "../lib/grailkeySession.js";
import {
  getPendingIdempotencyKey,
  getOrCreatePendingIdempotencyKey,
  retirePendingIdempotencyKey,
  isDefinitiveResponseStatus,
  pendingAgeMs,
} from "../lib/operatorActionIdempotency.js";

const ACTIONS = ["LIST", "HOLD", "PASS"];
const REQUEST_TIMEOUT_MS = 15000;

function formatPendingAge(createdAt) {
  const mins = Math.round(pendingAgeMs(createdAt) / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function GrailKeyOperatorPanel({ collectionItemId }) {
  const [state, setState] = useState({ status: "loading" }); // loading | none | found | error
  const [submitting, setSubmitting] = useState(null); // which actionCode is in flight
  const [lastResult, setLastResult] = useState(null); // { actionCode, operatorActionEventId }
  const [actionError, setActionError] = useState(null);
  const [ambiguousNotice, setAmbiguousNotice] = useState(null);

  const load = useCallback(async () => {
    if (!collectionItemId || !isAuthenticated()) {
      setState({ status: "none" });
      return;
    }
    setState({ status: "loading" });
    try {
      const res = await authFetch(`/api/assets?collectionItemId=${encodeURIComponent(collectionItemId)}`);
      if (!res) { setState({ status: "none" }); return; }
      if (res.status === 404) { setState({ status: "none" }); return; }
      if (!res.ok) { setState({ status: "error" }); return; }
      const body = await res.json();
      setState({ status: "found", graph: body.asset });
      setLastResult(null);
    } catch {
      setState({ status: "error" });
    }
  }, [collectionItemId]);

  useEffect(() => { load(); }, [load]);

  if (state.status === "loading" || state.status === "none") return null;
  if (state.status === "error") {
    return (
      <div style={panelStyle}>
        <div style={{ color: "#e05656", fontSize: 12 }}>Could not load the GrailKey record for this item.</div>
      </div>
    );
  }

  const { graph } = state;
  const gkAssetId = graph.asset?.id;
  const valuations = graph.valuations || [];
  const decisions = graph.decisions || [];
  // P0-B — bind to the server-declared current pointer (repository.js's
  // getAssetGraph, deterministic recorded_at+id order), never re-derive
  // "the last one" here via array-index arithmetic. Once multiple
  // decisions exist for an asset, `decisions[decisions.length - 1]`
  // and this explicit lookup are NOT guaranteed to agree in every future
  // case (e.g. a decision recorded out of array order for any reason) —
  // find-by-id is the only form that can never silently pick the wrong
  // row. The OperatorAction submit below sends exactly this id.
  const latestValuation = graph.currentValuationId
    ? valuations.find((v) => v.id === graph.currentValuationId) ?? null
    : null;
  const latestDecision = graph.currentDecisionId
    ? decisions.find((d) => d.id === graph.currentDecisionId) ?? null
    : null;
  const decisionEventId = latestDecision?.id ?? null;

  // Local namespace only (never authorization) — see grailkeySession.js's
  // getPrincipalScope and operatorActionIdempotency.js's own header for why
  // this exists: a second operator on the same browser must never resolve
  // or reuse a different operator's still-pending idempotency key.
  const principalScope = getPrincipalScope();

  // Reload-safe: whatever is on disk right now for each action, recomputed
  // on every render — no separate "did I already check" state to fall out
  // of sync with localStorage after a submit retires a key.
  const pendingByAction = {};
  if (gkAssetId && decisionEventId) {
    for (const code of ACTIONS) {
      pendingByAction[code] = getPendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode: code });
    }
  }

  async function submitAction(actionCode) {
    if (!latestDecision || submitting) return;
    // Persisted BEFORE the request is sent — a reload or ambiguous failure
    // between this line and the response still leaves the same key on disk,
    // ready to be reused by the next attempt of this exact (asset, decision,
    // action) tuple. See src/lib/operatorActionIdempotency.js for the full
    // lifecycle rule this implements.
    const pending = getOrCreatePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode });
    setSubmitting(actionCode);
    setActionError(null);
    setAmbiguousNotice(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await authFetch("/api/operator-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gkAssetId, decisionEventId, actionCode, idempotencyKey: pending.idempotencyKey }),
        signal: controller.signal,
      });
      if (!res) {
        // No request was ever transmitted (not signed in) — nothing to be
        // ambiguous about, so the just-created local key is retired.
        retirePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode });
        setActionError("Not signed in.");
        return;
      }
      if (!isDefinitiveResponseStatus(res.status)) {
        // e.g. a bare 5xx — the server did not tell us, authoritatively,
        // what happened. Retain the pending key; the same click, later, is
        // the correct and safe way to resolve this.
        setAmbiguousNotice(`Response ${res.status} — outcome unknown. Click ${actionCode} again to safely retry.`);
        return;
      }
      retirePendingIdempotencyKey({ principalScope, gkAssetId, decisionEventId, actionCode });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body.error || `Request failed (${res.status})`);
        return;
      }
      setLastResult({ actionCode, operatorActionEventId: body.operatorActionEventId });
    } catch {
      // Network error, abort, or the timeout above — no response was ever
      // received. Retain the pending key (do not retire it).
      setAmbiguousNotice(`Could not confirm the result — outcome unknown. Click ${actionCode} again to safely retry.`);
    } finally {
      clearTimeout(timeoutId);
      setSubmitting(null);
    }
  }

  return (
    <div style={panelStyle}>
      <div style={{ color: "#d4af37", fontSize: 12, fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>
        GRAILKEY HISTORICAL RECORD
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10, fontSize: 13 }}>
        <Field label="Grade" value={latestValuation?.grade_assumption ?? "—"} />
        <Field
          label="Valuation"
          value={latestValuation ? `$${Number(latestValuation.value_amount).toFixed(2)}` : "—"}
        />
        <Field label="Recommendation" value={latestDecision?.recommendation ?? "—"} />
      </div>

      {latestDecision ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {ACTIONS.map((code) => (
              <button
                key={code}
                onClick={() => submitAction(code)}
                disabled={submitting !== null}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 6,
                  border: "1px solid rgba(212,175,55,0.4)",
                  background: submitting === code ? "#333" : "transparent",
                  color: "#d4af37", fontWeight: 700, fontSize: 13,
                  cursor: submitting !== null ? "not-allowed" : "pointer",
                  opacity: submitting !== null && submitting !== code ? 0.5 : 1,
                }}
              >
                {submitting === code ? "…" : code}
              </button>
            ))}
          </div>
          {ACTIONS.filter((code) => pendingByAction[code] && submitting !== code).map((code) => (
            <div key={code} style={{ color: "#c9a227", fontSize: 11, marginBottom: 4 }}>
              A previous {code} attempt never confirmed ({formatPendingAge(pendingByAction[code].createdAt)}) — click {code} again to safely retry; it will not create a duplicate.
            </div>
          ))}
          {ambiguousNotice && <div style={{ color: "#c9a227", fontSize: 12 }}>{ambiguousNotice}</div>}
          {actionError && <div style={{ color: "#e05656", fontSize: 12 }}>{actionError}</div>}
          {lastResult && (
            <div style={{ color: "#7cc47c", fontSize: 12 }}>
              Recorded: operator chose {lastResult.actionCode}.
            </div>
          )}
        </>
      ) : (
        <div style={{ color: "#888", fontSize: 12 }}>No durable recommendation exists yet for this asset.</div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ color: "#888", fontSize: 10, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: "#eee", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const panelStyle = {
  border: "1px solid rgba(212,175,55,0.25)",
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
  background: "rgba(212,175,55,0.04)",
};
