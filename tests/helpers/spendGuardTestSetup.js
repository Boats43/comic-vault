// tests/helpers/spendGuardTestSetup.js - GK-L1A (v4): the ONLY place a test process configures the spend guard.
//
// Production spend-guard code contains no test sniffing (no argv check, no environment exception, no in-memory fallback).
// A test that reaches a guarded handler (api/grade|enrich|comps|chat|manage) must therefore supply, EXPLICITLY:
//   1. a VALID operator configuration (a well-formed UUID in SPEND_GUARD_OPERATOR_PRINCIPAL_IDS),
//   2. its own spend/attempt store (the in-memory one, injected via setResearchStoreForTests), and
//   3. the principal-table recognizer (stubbed - no database is required just to start a handler).
// Import this file FIRST. A test that exercises the guard itself (tests/spend-guard*.test.js, launch1a-*) overrides any of
// these deliberately and says so.
import { setResearchStoreForTests, createMemoryResearchStore } from '../../src/lib/researchStore.js';
import { setOperatorRecognizerForTests } from '../../src/lib/spendGuard.js';

export const TEST_OPERATOR_PRINCIPAL_ID = '00000000-0000-4000-8000-0000000000a1';
process.env.SPEND_GUARD_OPERATOR_PRINCIPAL_IDS = TEST_OPERATOR_PRINCIPAL_ID;
setResearchStoreForTests(createMemoryResearchStore());
setOperatorRecognizerForTests(async () => true);
