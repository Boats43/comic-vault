// src/components/GrailKeyLoginGate.jsx — the smallest login surface for the
// existing DATA-1D backend auth contract (api/auth-login.js). Single-operator
// era: passphrase only, no username, no signup, no social login, no password
// reset — invite/provisioned operator account only (docs/adr/
// DATA-1D-AUTH-CROSS-DEVICE.md, T1). Never logs the passphrase or the
// returned token.
//
// BETA-1A — optionally renders a second, independent path to the SAME
// onAuthenticated() callback: Clerk sign-in (src/components/ClerkAuthPanel.jsx),
// gated on the identical VITE_CLERK_PUBLISHABLE_KEY check src/main.jsx uses
// to decide whether ClerkProvider is even mounted, so this never renders
// Clerk UI without a live ClerkProvider ancestor. This is an ADDITIONAL
// entry point, not a replacement — the passphrase form below is completely
// unchanged, and Clerk identity is never trusted as authority client-side;
// see ClerkAuthPanel.jsx / api/auth-clerk.js for where verification and
// principal mapping actually happen (server-side, always).

import { useState } from "react";
import { setSession } from "../lib/grailkeySession.js";
import ClerkAuthPanel from "./ClerkAuthPanel.jsx";

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export default function GrailKeyLoginGate({ onAuthenticated }) {
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    if (!passphrase || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? "Too many attempts — try again shortly." : "Invalid credentials");
        return;
      }
      setSession(body.token, body.expiresAt);
      setPassphrase("");
      onAuthenticated();
    } catch {
      setError("Could not reach the server — check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "#0a0a0a", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔑</div>
        <div style={{ color: "#d4af37", fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
          GrailKey Operator Login
        </div>
        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Operator passphrase"
          disabled={submitting}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 8,
            border: "1px solid rgba(212,175,55,0.4)", background: "#151515",
            color: "#eee", fontSize: 16, marginBottom: 12, boxSizing: "border-box",
          }}
        />
        {error && (
          <div style={{ color: "#e05656", fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <button
          onClick={submit}
          disabled={!passphrase || submitting}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 8, border: "none",
            background: passphrase && !submitting ? "#d4af37" : "#444",
            color: passphrase && !submitting ? "#000" : "#888",
            fontSize: 15, fontWeight: 700,
            cursor: passphrase && !submitting ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        {CLERK_ENABLED && (
          <>
            <div style={{ color: "#555", fontSize: 12, margin: "20px 0 4px" }}>— or —</div>
            <ClerkAuthPanel onAuthenticated={onAuthenticated} />
          </>
        )}
      </div>
    </div>
  );
}
