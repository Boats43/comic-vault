import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import './index.css'
import App from './App.jsx'

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  })
}

// BETA-1A — ClerkProvider mounts ONLY when a publishable key is actually
// configured (Vite exposes client-safe env vars via the VITE_ prefix; this
// is never the secret key, which api/auth-clerk.js reads server-side only
// from process.env.CLERK_SECRET_KEY). Absent the key, the app renders
// exactly as it did before this dispatch — the existing GrailKey
// passphrase login (src/components/GrailKeyLoginGate.jsx) is completely
// unchanged and is not wrapped by, or dependent on, Clerk in any way.
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

createRoot(document.getElementById('root')).render(
  clerkPublishableKey ? (
    <StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <App />
      </ClerkProvider>
    </StrictMode>
  ) : app
)
