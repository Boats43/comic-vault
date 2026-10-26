// tests/helpers/gkp0CrashChild.mjs -- spawned by gkp0-failure-injection-live.test.js.
// Runs the REAL api/list-ebay.js handler in a separate process whose provider stand-in kills the process
// (exit 137) the instant it has created the listing -- i.e. a genuine crash after the provider write and before any
// response handling or LISTED persistence. If the handler ever returns, the crash did not happen: exit 3.
//
//   node tests/helpers/gkp0CrashChild.mjs <registryFile> <payloadFile>

import { readFileSync } from 'node:fs';
import { bootstrap } from './gkp0Harness.mjs';

const [registryFile, payloadFile] = process.argv.slice(2);
const { principalId, asset, ready } = JSON.parse(readFileSync(payloadFile, 'utf8'));
const h = await bootstrap({ registryFile, crashAfterCreate: true });
await h.publish(principalId, asset, { ready });
process.exit(3);
