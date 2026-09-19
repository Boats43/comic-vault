// src/lib/buyerDecisionSync.js — GRAILKEY DURABLE BUYER DECISION LEDGER
// V1. Thin client for /api/buyer-decision, mirroring collectionSync.js's
// own contract exactly: every call goes through authFetch, returns null
// (never throws) on no session / network failure / non-OK response.
// Callers (src/App.jsx) treat null as "stays locally pending, retried
// later," never as a fatal error — the same local-first doctrine
// collectionPersistence.js already established for the catalogue.
//
// principalId is never sent from here — the server derives it from the
// Bearer token authFetch attaches.

import { authFetch } from "./grailkeySession.js";

export async function pushBuyerDecision(entry) {
  try {
    const res = await authFetch("/api/buyer-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decision", ...entry }),
    });
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function pushBuyerAcquisition(entry) {
  try {
    const res = await authFetch("/api/buyer-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acquisition", ...entry }),
    });
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}
