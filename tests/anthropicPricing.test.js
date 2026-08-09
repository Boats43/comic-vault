// tests/anthropicPricing.test.js
//
// GrailKey Dispatch 36 — regression test for the empty-text-block bug
// (getEstimatedStaticPrefixTokens sent `messages: [{..., text: ''}]` on
// every call, which Anthropic's API rejects with HTTP 400 "text content
// blocks must be non-empty"). Asserts against the REAL exported function
// with a fake `client.messages.countTokens` that inspects exactly what
// was sent — not a hardcoded expectation of the fix's own placeholder
// character, so this stays a real regression guard rather than a tests-
// the-implementation-detail check.
//
// Invoke: node tests/anthropicPricing.test.js

import {
  getEstimatedStaticPrefixTokens,
  classifyCacheEligibility,
  computeAnthropicCallCostUsd,
} from '../src/lib/anthropicPricing.js';

let passed = 0;
let failed = 0;
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GrailKey Dispatch 36 — anthropicPricing regression ===\n');

{
  // The core regression guard: every text content block in the request
  // this function actually sends must be non-empty, on every call.
  let capturedRequest = null;
  const fakeClient = {
    messages: {
      countTokens: async (req) => {
        capturedRequest = req;
        return { input_tokens: 42 };
      },
    },
  };
  const count = await getEstimatedStaticPrefixTokens(
    fakeClient,
    'claude-haiku-4-5-20251001',
    [{ type: 'text', text: 'system prompt content' }],
    'abc1234'
  );
  assertEq(count, 42, 'returns the real countTokens response value on success');
  assertTrue(Array.isArray(capturedRequest?.messages), 'sent a messages array');
  const block = capturedRequest?.messages?.[0]?.content?.[0];
  assertTrue(!!block, 'sent at least one content block');
  assertEq(block?.type, 'text', 'content block is type text');
  assertTrue(typeof block?.text === 'string' && block.text.length > 0, 'text content block is non-empty (the exact bug this test guards)');
}

{
  // Cache: a second call with the identical (model, gitSha, prompt text)
  // must NOT call countTokens again.
  let callCount = 0;
  const fakeClient = {
    messages: {
      countTokens: async () => { callCount++; return { input_tokens: 99 }; },
    },
  };
  const systemBlocks = [{ type: 'text', text: 'identical prompt text' }];
  await getEstimatedStaticPrefixTokens(fakeClient, 'claude-sonnet-4-5-20250929', systemBlocks, 'sha-fixed');
  await getEstimatedStaticPrefixTokens(fakeClient, 'claude-sonnet-4-5-20250929', systemBlocks, 'sha-fixed');
  assertEq(callCount, 1, 'identical (model, gitSha, prompt) hits the in-memory cache on the second call');
}

{
  // Never throws — a countTokens failure must return null, not propagate.
  const fakeClient = {
    messages: {
      countTokens: async () => { throw new Error('simulated 400'); },
    },
  };
  const count = await getEstimatedStaticPrefixTokens(fakeClient, 'claude-opus-4-7', [{ type: 'text', text: 'x' }], 'sha-err');
  assertEq(count, null, 'countTokens failure returns null instead of throwing');
}

{
  // classifyCacheEligibility never asserts a side when there's no estimate.
  assertEq(classifyCacheEligibility(null, 'claude-haiku-4-5-20251001'), 'unresolved', 'null estimate classifies unresolved');
  assertEq(classifyCacheEligibility(5000, 'claude-haiku-4-5-20251001'), 'likely-eligible', 'well above Haiku 4.5 minimum (4096) classifies likely-eligible');
  assertEq(classifyCacheEligibility(100, 'claude-haiku-4-5-20251001'), 'likely-ineligible', 'well below Haiku 4.5 minimum classifies likely-ineligible');
  assertEq(classifyCacheEligibility(4096, 'claude-haiku-4-5-20251001'), 'unresolved', 'exactly at the minimum, inside the unresolved band');
}

{
  // computeAnthropicCallCostUsd stays authoritative from real usage,
  // independent of anything the estimator does.
  const cost = computeAnthropicCallCostUsd('claude-haiku-4-5-20251001', {
    input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  });
  assertTrue(cost !== null, 'real usage produces a real cost object');
  assertEq(computeAnthropicCallCostUsd('not-a-real-model', { input_tokens: 1 }), null, 'unrecognized model returns null, never a silently-wrong $0.00');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
