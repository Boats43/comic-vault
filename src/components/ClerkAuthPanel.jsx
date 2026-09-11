// src/components/ClerkAuthPanel.jsx — BETA-1A. Only ever mounted inside a
// live <ClerkProvider> (src/main.jsx gates that on the SAME
// VITE_CLERK_PUBLISHABLE_KEY env var GrailKeyLoginGate.jsx gates this
// component on) — never rendered, never imports @clerk/react's hooks,
// when no publishable key is configured.
//
// On a real Clerk sign-in, exchanges the verified Clerk session token for
// a GrailKey session token via POST /api/auth-clerk. The Clerk userId
// itself is NEVER treated as authority here or anywhere client-side — the
// server independently re-verifies the token against Clerk's own keys and
// maps the verified subject through principal_external_identity
// (db/data0/0022_beta1a_clerk_identity_mapping.sql). This component only
// ever receives back the SAME opaque GrailKey bearer token the passphrase
// path already produces. Never logs the Clerk token or the GrailKey token.

import { useEffect, useState } from "react";
import { useAuth, SignIn } from "@clerk/react";
import { setSession } from "../lib/grailkeySession.js";

export default function ClerkAuthPanel({ onAuthenticated }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || exchanging) return;
    let cancelled = false;
    (async () => {
      setExchanging(true);
      setError(null);
      try {
        const clerkToken = await getToken();
        const res = await fetch("/api/auth-clerk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clerkToken }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(
            res.status === 429
              ? "Too many attempts — try again shortly."
              : "This Clerk account isn't linked to a GrailKey operator yet."
          );
          return;
        }
        setSession(body.token, body.expiresAt);
        onAuthenticated();
      } catch {
        if (!cancelled) setError("Could not reach the server — check your connection.");
      } finally {
        if (!cancelled) setExchanging(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return null;

  if (isSignedIn) {
    return (
      <div style={{ color: exchanging ? "#999" : "#e05656", fontSize: 13, textAlign: "center" }}>
        {exchanging ? "Linking GrailKey session…" : (error || "Signed in with Clerk.")}
      </div>
    );
  }

  return <SignIn routing="virtual" />;
}
