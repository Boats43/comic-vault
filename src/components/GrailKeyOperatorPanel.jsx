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
//
// GRAILKEY — FINAL CAPTURE-PATH WIRING (2026-09-19). Before this pass, the
// entire Scan/grade/save pipeline (gradeBlob/addToCatalogue/
// persistCollectionItem, src/App.jsx) never called /api/capture-scan at
// all — confirmed by grep, zero references anywhere in the frontend.
// Every catalogue item, regardless of how it was scanned, was structurally
// incapable of minting a durable gkAssetId. This is the ONLY place that
// changes: when NO durable asset is linked yet (state.status === 'none',
// below), this panel renders one explicit, clearly-labeled button —
// "Capture as Owned Physical Asset" — instead of returning null. Tapping
// it is the ENTIRE mint/don't-mint decision point in this codebase: never
// inferred from image source, camera vs. upload, file origin, screenshot
// metadata, presence/absence of photos, whether the original scan
// succeeded, or any default-open branch. The scan/grade/save pipeline
// itself is completely untouched — a reference/quick-lookup scan that is
// never brought to THIS panel and THIS button can structurally never
// reach /api/capture-scan; there is no other code path in the frontend
// that calls it.

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

// Capture idempotency: same lifecycle rule as operatorActionIdempotency.js
// (persist BEFORE the request, retire only on a definitive response,
// retain on anything ambiguous so a retry safely replays instead of
// double-minting) — a small, dedicated, per-collectionItemId key holder
// rather than reusing that module's own key shape, which is keyed by
// {gkAssetId, decisionEventId, actionCode} and doesn't fit "before any
// gkAssetId exists yet."
const CAPTURE_KEY_PREFIX = "grailkey_capture_pending_v1:";

function getOrCreateCaptureIdempotencyKey(collectionItemId) {
  const storageKey = CAPTURE_KEY_PREFIX + collectionItemId;
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const fresh = (crypto.randomUUID ? crypto.randomUUID() : `${collectionItemId}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(storageKey, fresh);
    return fresh;
  } catch {
    // localStorage unavailable — fall back to a one-shot key; retry-safety
    // is best-effort in that case, never a reason to block the action.
    return (crypto.randomUUID ? crypto.randomUUID() : `${collectionItemId}-${Date.now()}`);
  }
}

function retireCaptureIdempotencyKey(collectionItemId) {
  try {
    localStorage.removeItem(CAPTURE_KEY_PREFIX + collectionItemId);
  } catch {
    // no-op
  }
}

// Strips a data: URL down to pure base64 — api/capture-scan.js decodes
// photos[i].bytes with Buffer.from(bytes, 'base64'), which requires the
// bare payload, not the data: URL wrapper.
function stripDataUrlPrefix(dataUrl) {
  const idx = dataUrl.indexOf(",");
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
}
function contentTypeFromDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return m ? m[1] : "image/jpeg";
}

function formatPendingAge(createdAt) {
  const mins = Math.round(pendingAgeMs(createdAt) / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function GrailKeyOperatorPanel({ collectionItemId, item, photos }) {
  const [state, setState] = useState({ status: "loading" }); // loading | none | found | error
  const [submitting, setSubmitting] = useState(null); // which actionCode is in flight
  const [lastResult, setLastResult] = useState(null); // { actionCode, operatorActionEventId }
  const [actionError, setActionError] = useState(null);
  const [ambiguousNotice, setAmbiguousNotice] = useState(null);
  // Mint/don't-mint — see this file's own header. 'idle' | 'capturing' |
  // { error } | { ambiguous: true }. A successful capture doesn't set its
  // own "success" state — it just re-runs load() (below), which finds the
  // newly-linked asset and transitions this whole panel to status:'found'.
  const [captureState, setCaptureState] = useState("idle");
  // H8 (Milestone Ten operator proof) — on-demand only, never fetched
  // automatically: 'idle' | 'loading' | { gkAssetId, mediaId, byteLength }
  // | { error }. Reuses the SAME two existing read-only, authenticated
  // endpoints this panel already calls (GET /api/assets and GET
  // /api/asset-media) — no new backend surface, no write, no asset
  // mutation. byteLength is the real length of the bytes actually
  // retrieved through /api/asset-media (which itself streams
  // media.getBytes()'s real result) — never a stored/hardcoded number;
  // the media table has no byte-count column at all (confirmed against
  // db/data0/0004_data1_foundation.sql + 0009's own content_type
  // addition), so this is the only honest source for it.
  const [h8Proof, setH8Proof] = useState("idle");

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

  // Mint/don't-mint — the ENTIRE decision point. See this file's own
  // header. Requires: a real collectionItemId, a real authenticated
  // session, and a real LOCAL photo on THIS device (item.images/item.image
  // — never a synced remoteImages proxy path from another device, which
  // is display evidence, not this device's own capture). scanPayload is
  // built from already-computed, already-displayed catalogue fields —
  // this reads existing grading/pricing output, it never recomputes or
  // changes any of it.
  async function captureAsOwnedAsset() {
    if (captureState === "capturing" || !collectionItemId || !item) return;
    const localPhoto = (item.images && item.images[0]) || item.image || null;
    if (!localPhoto || typeof localPhoto !== "string" || !localPhoto.startsWith("data:")) {
      setCaptureState({ error: "No local photo on this device for this item — capture requires this device's own photo, not a synced reference image." });
      return;
    }
    setCaptureState("capturing");
    const idempotencyKey = getOrCreateCaptureIdempotencyKey(collectionItemId);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 4); // photo upload, allow more time
    try {
      const scanPayload = {
        correlationId: idempotencyKey,
        collectionItemId,
        book: {
          title: item.title || null,
          issue: item.issue || null,
          year: item.year || null,
        },
        outcome: {
          decisionAction: item.decision?.action || null,
          pricingSource: item.pricingSource || null,
          price: item.price != null ? `$${Number(item.price).toFixed(2)}` : null,
          gradeMultiplier: item.gradeMultiplier ?? null,
        },
      };
      const res = await authFetch("/api/capture-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanPayload,
          photos: [{ bytes: stripDataUrlPrefix(localPhoto), contentType: contentTypeFromDataUrl(localPhoto), captureRole: "capture-photo" }],
          idempotencyKey,
        }),
        signal: controller.signal,
      });
      if (!res) {
        setCaptureState({ error: "Not signed in." });
        return;
      }
      if (!isDefinitiveResponseStatus(res.status)) {
        setCaptureState({ ambiguous: true });
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Definitive failure (e.g. the H8 gate's own 403, or a real
        // validation error) — safe to retire the key, a fresh retry
        // should mint fresh rather than replay a request that was
        // itself rejected.
        retireCaptureIdempotencyKey(collectionItemId);
        setCaptureState({ error: body.detail || body.error || `Request failed (${res.status})` });
        return;
      }
      retireCaptureIdempotencyKey(collectionItemId);
      setCaptureState("idle");
      await load(); // re-fetch — now finds the newly-linked asset, transitions to status:'found'
    } catch {
      setCaptureState({ ambiguous: true });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (state.status === "loading") return null;
  if (state.status === "none") {
    if (!collectionItemId || !item) return null;
    return (
      <div style={panelStyle}>
        <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>
          No durable GrailKey physical-asset record exists for this catalogue item.
        </div>
        <button
          onClick={captureAsOwnedAsset}
          disabled={captureState === "capturing"}
          style={{
            width: "100%", padding: "10px 0", borderRadius: 6,
            border: "1px solid rgba(212,175,55,0.4)",
            background: "transparent", color: "#d4af37", fontWeight: 700, fontSize: 13,
            cursor: captureState === "capturing" ? "not-allowed" : "pointer",
            opacity: captureState === "capturing" ? 0.6 : 1,
          }}
        >
          {captureState === "capturing" ? "Capturing…" : "Capture as Owned Physical Asset"}
        </button>
        <div style={{ color: "#666", fontSize: 10, marginTop: 6 }}>
          Mints a permanent GrailKey physical-asset record from this device's own photo. Never use this for a quick lookup or reference-only scan.
        </div>
        {captureState !== "idle" && captureState !== "capturing" && captureState.ambiguous && (
          <div style={{ color: "#c9a227", fontSize: 12, marginTop: 6 }}>Could not confirm the result — outcome unknown. Tap again to safely retry; it will not create a duplicate.</div>
        )}
        {captureState !== "idle" && captureState !== "capturing" && captureState.error && (
          <div style={{ color: "#e05656", fontSize: 12, marginTop: 6 }}>{captureState.error}</div>
        )}
      </div>
    );
  }
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

  // H8 — fetch the real byte length by actually retrieving the media
  // bytes through the existing authenticated proxy (the same one the
  // photo strip elsewhere in the app already loads from), rather than
  // trusting any header alone.
  async function loadH8Proof() {
    const media0 = graph.media?.[0];
    if (!gkAssetId || !media0?.id || !media0?.object_uri) {
      setH8Proof({ error: "No durable media record linked to this asset." });
      return;
    }
    setH8Proof("loading");
    try {
      const res = await authFetch(media0.object_uri);
      if (!res) {
        setH8Proof({ error: "Not signed in." });
        return;
      }
      if (!res.ok) {
        setH8Proof({ error: `Media fetch failed (HTTP ${res.status})` });
        return;
      }
      const bytes = await res.arrayBuffer();
      setH8Proof({ gkAssetId, mediaId: media0.id, byteLength: bytes.byteLength });
    } catch (e) {
      setH8Proof({ error: e?.message || "Fetch failed" });
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

      {/* H8 — Milestone Ten operator proof values. Read-only, on-demand. */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(212,175,55,0.15)" }}>
        {h8Proof === "idle" && (
          <button
            onClick={loadH8Proof}
            style={{
              background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6,
              color: "#999", fontSize: 11, padding: "6px 10px", cursor: "pointer",
            }}
          >
            Show H8 proof values
          </button>
        )}
        {h8Proof === "loading" && (
          <div style={{ color: "#888", fontSize: 12 }}>Fetching real server record…</div>
        )}
        {h8Proof !== "idle" && h8Proof !== "loading" && h8Proof.error && (
          <div style={{ color: "#e05656", fontSize: 12 }}>{h8Proof.error}</div>
        )}
        {h8Proof !== "idle" && h8Proof !== "loading" && !h8Proof.error && (
          <div style={{ fontSize: 12 }}>
            <div style={{ color: "#d4af37", fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>H8 PROOF VALUES</div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#888" }}>gkAssetId: </span><span style={{ color: "#eee", wordBreak: "break-all" }}>{h8Proof.gkAssetId}</span></div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#888" }}>mediaId: </span><span style={{ color: "#eee", wordBreak: "break-all" }}>{h8Proof.mediaId}</span></div>
            <div><span style={{ color: "#888" }}>byteLength: </span><span style={{ color: "#eee" }}>{h8Proof.byteLength}</span></div>
          </div>
        )}
      </div>
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
