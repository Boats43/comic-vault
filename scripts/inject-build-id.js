// A6 BUILD-ID: Inject commit hash at build time
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const hash = execSync('git rev-parse --short HEAD').toString().trim();
const buildId = `CV_BUILD_ID="${hash}"`;

console.log(`[build-id] Injecting: ${buildId}`);
writeFileSync('.env.local', `${buildId}\n`, { flag: 'w' });
console.log('[build-id] Written to .env.local');
