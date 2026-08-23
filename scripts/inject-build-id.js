// A6 BUILD-ID: Inject commit hash at build time
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

function resolveHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    // A local `vercel deploy` uploads the file tree only — no .git dir in
    // the remote build container, so `git rev-parse` fails there even
    // though the same command works fine for a normal git-triggered
    // build. Fall back to the SHA Vercel itself injects for git-linked
    // deployments; 'unknown' only if even that isn't present.
    const sha = process.env.VERCEL_GIT_COMMIT_SHA;
    return sha ? sha.slice(0, 7) : 'unknown';
  }
}

const hash = resolveHash();
const buildId = `CV_BUILD_ID="${hash}"`;

console.log(`[build-id] Injecting: ${buildId}`);
writeFileSync('.env.local', `${buildId}\n`, { flag: 'w' });
console.log('[build-id] Written to .env.local');
