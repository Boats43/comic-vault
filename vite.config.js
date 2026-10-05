import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// U1 closeout — a CLIENT-VISIBLE build marker (the bundle previously carried none), so a live test can be
// proven to come from the current bundle and not a stale cached one. Same resolution order as
// scripts/inject-build-id.js: git, then Vercel's injected SHA.
function resolveBuildId() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    const sha = process.env.VERCEL_GIT_COMMIT_SHA
    return sha ? sha.slice(0, 7) : 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __CV_BUILD__: JSON.stringify(resolveBuildId()) },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/')) {
              return 'vendor'
            }
          }
        },
      },
    },
  },
})
