// src/components/GrailKeyLoginGate.jsx — the single front door into
// GrailKey: "Continue with Google" (via Clerk's own <SignIn>), and nothing
// else.
//
// GK-268 AUTH LAUNCH (2026-09-30) — retired the legacy "GrailKey Operator
// Login" passphrase form (api/auth-login.js) from this screen. That form
// was the single-operator-era shared credential: there was exactly one
// operator principal, and anyone who knew the one passphrase logged in as
// that same principal (src/modules/auth/service.js's login(), unchanged
// and still callable server-side for admin/break-glass use — just no
// longer reachable from this UI). Real outside users now authenticate as
// themselves via their own verified Google identity. api/auth-clerk.js
// does the real work: verifies the Clerk session token server-side, then
// resolves-or-creates exactly one GrailKey principal for that verified
// subject (src/modules/auth/service.js's loginWithExternalIdentity) —
// never a client-chosen principalId, never a shared secret.
//
// ClerkAuthPanel.jsx is the only remaining entry point into
// onAuthenticated(). It is gated on the same VITE_CLERK_PUBLISHABLE_KEY
// check src/main.jsx uses to decide whether <ClerkProvider> is even
// mounted, so this never renders Clerk UI without a live ClerkProvider
// ancestor. If that env var is somehow unset, this shows an honest
// "sign-in is not configured" message rather than a blank, unexplained
// screen — there is no other way in.

import ClerkAuthPanel from "./ClerkAuthPanel.jsx";

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export default function GrailKeyLoginGate({ onAuthenticated }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "#0a0a0a", display: "flex", alignItems: "center",
        justifyContent: "center", padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ color: "#d4af37", fontSize: 24, fontWeight: 700, marginBottom: 6 }}>
          GrailKey
        </div>
        <div style={{ color: "#999", fontSize: 14, marginBottom: 28 }}>
          Know what it's worth. Get paid.
        </div>

        {CLERK_ENABLED ? (
          <ClerkAuthPanel onAuthenticated={onAuthenticated} />
        ) : (
          <div style={{ color: "#e05656", fontSize: 13 }}>
            Sign-in is not configured for this deployment.
          </div>
        )}
      </div>
    </div>
  );
}
