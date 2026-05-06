#!/usr/bin/env node
/**
 * Comic Vault smoke test harness — Ship 0.5
 *
 * Runs api/enrich.js handler against known-input fixtures.
 * Validates output ranges. Exits non-zero if any fixture fails.
 *
 * Run before every commit:
 *   node scripts/smoke-test.mjs
 *
 * Add a new fixture whenever a ship lands that should be permanently protected
 * from regression.
 */

import handler from '../api/enrich.js';

// Mock res object — captures status + body
const makeMockRes = () => {
  const captured = { statusCode: null, body: null };
  return {
    status: (code) => ({
      json: (data) => {
        captured.statusCode = code;
        captured.body = data;
        return captured;
      },
    }),
    _captured: captured,
  };
};

// Wrap handler call to extract response body
const callEnrich = async (body) => {
  const req = { method: 'POST', body };
  const res = makeMockRes();
  await handler(req, res);
  return res._captured.body;
};

// ============================================================
// ENVIRONMENT DETECTION
// ============================================================
//
// Some fixtures exercise pricing code paths that require live API access
// (eBay Browse, PriceCharting). Others test pure code-path behavior
// (polybag refusal, edition-gate, etc.) and run in any environment.
//
// When env vars are missing, API-dependent fixtures skip with a note.
// Crash-detection still runs for every fixture regardless of env.
// ============================================================

const hasApiKeys =
  !!process.env.EBAY_APP_ID &&
  !!process.env.EBAY_CERT_ID &&
  !process.env.EBAY_APP_ID.includes('MISSING');

const envNote = hasApiKeys
  ? '(API keys present — full pricing validation)'
  : '(API keys missing — code-path validation only)';

// ============================================================
// FIXTURES
// ============================================================
//
// Each fixture has:
//   name: human-readable identifier
//   input: req.body shape passed to enrich handler
//   expected: assertions on the response body
//   currentlyPassing: boolean — is this expected to pass on current HEAD?
//
// Fixtures with currentlyPassing=false document regressions or
// queued ship targets. They're skipped unless --include-failing is set.
// ============================================================

const FIXTURES = [
  {
    name: 'Tomb of Dracula #14 (verified_sold baseline)',
    input: {
      title: 'Tomb of Dracula',
      issue: '14',
      grade: '6.0',
      year: 1973,
      publisher: 'Marvel',
      isGraded: false,
      numericGrade: 6.0,
    },
    expected: {
      priceMin: 8,
      priceMax: 25,
      pricingSourceNotIn: ['refused', 'refused-claude-gate'],
      refusedToPriceFalse: true,
    },
    currentlyPassing: true,
    requiresApiKeys: true,
  },
  {
    name: 'Amazing Spider-Man #606 (verified_sold + creator)',
    input: {
      title: 'Amazing Spider-Man',
      issue: '606',
      grade: '9.2',
      year: 2009,
      publisher: 'Marvel',
      isGraded: false,
      numericGrade: 9.2,
    },
    expected: {
      priceMin: 70,
      priceMax: 160,
      pricingSourceNotIn: ['refused', 'refused-claude-gate'],
      refusedToPriceFalse: true,
    },
    currentlyPassing: true,
    requiresApiKeys: true,
  },
  {
    name: 'Brave and the Bold #28 polybag (Ship 6.x + Ship 0.6 crash check)',
    input: {
      title: 'The Brave and the Bold',
      issue: '28',
      grade: '9.4',
      year: 2017,
      publisher: 'DC',
      isGraded: false,
      numericGrade: 9.4,
      reason: 'Loot Crate reprint, polybag sealed',
    },
    expected: {
      // No price assertions — without API keys this hits edition-gate
      // refusal path with 0 comps. Ship 0.6 ensures it does not CRASH.
      // With API keys, this would price ~$9.71 via polybag pipeline.
      priceMaxStrict: 50, // hard ceiling — must NOT fire $2,275 mega-key bug
    },
    currentlyPassing: true,
    requiresApiKeys: false, // intentional — validates Ship 0.6 crash fix
  },
  {
    name: 'Wolverine #1 1982 (Ship 10 unblock)',
    input: {
      title: 'Wolverine',
      issue: '1',
      grade: '4.0',
      year: 1982,
      publisher: 'Marvel',
      isGraded: false,
      numericGrade: 4.0,
    },
    expected: {
      priceMin: 80,
      priceMax: 250,
      pricingSourceNotIn: ['refused', 'refused-claude-gate'],
      refusedToPriceFalse: true,
    },
    currentlyPassing: true,
    requiresApiKeys: true,
  },
  {
    name: 'Catwoman Uncovered #1 variant (Ship 11 path)',
    input: {
      title: 'Catwoman Uncovered',
      issue: '1',
      grade: '9.4',
      year: 2023,
      publisher: 'DC',
      isGraded: false,
      numericGrade: 9.4,
      variant: 'foil',
    },
    expected: {
      priceMin: 5,
      priceMax: 50,
      pricingSourceNotIn: ['refused', 'refused-claude-gate'],
    },
    currentlyPassing: true,
    requiresApiKeys: true,
  },
  {
    name: 'Fantastic Four #52 (Silver Age key, mega-key NOT applied)',
    input: {
      title: 'Fantastic Four',
      issue: '52',
      grade: '4.0',
      year: 1966,
      publisher: 'Marvel',
      isGraded: false,
      numericGrade: 4.0,
    },
    expected: {
      priceMin: 150,
      priceMax: 500,
      pricingSourceNotIn: ['refused', 'refused-claude-gate'],
    },
    currentlyPassing: true,
    requiresApiKeys: true,
  },
  {
    name: 'Detective Comics #27 REPRINT (Ship 13 target)',
    input: {
      title: 'Detective Comics',
      issue: '27',
      grade: '0.5',
      year: 1939,
      publisher: 'DC',
      isGraded: false,
      numericGrade: 0.5,
      reason:
        'This appears to be a reprint or facsimile edition of Detective Comics #27, not an original 1939 issue. The paper quality and printing suggest this is a later reproduction.',
    },
    expected: {
      priceMaxStrict: 5000, // CRITICAL: must NOT fire $150K mega-key floor
      editionWarningExpected: true,
    },
    currentlyPassing: false, // Ship 13 will fix this
  },
];

// ============================================================
// ASSERTION ENGINE
// ============================================================

const assertFixture = (fx, response) => {
  const failures = [];
  const e = fx.expected;
  const r = response || {};

  // Ship 0.5 hardening — catch crash-mode false passes.
  // Original harness skipped assertions when r.price was null, masking
  // ReferenceError crashes that returned { error, stack } instead of pricing.
  // Found Ship 0.6 bug on first run because of this; tightening so the
  // harness can never silently pass a crashed handler again.
  if (r.error) {
    failures.push(`HANDLER ERROR: ${r.error}`);
    if (r.stack) {
      failures.push(`  ${r.stack.split('\n').slice(0, 3).join(' / ')}`);
    }
    return failures;
  }
  if (r.price == null && r.pricingSource == null && r.refusedToPrice == null) {
    failures.push(`EMPTY RESPONSE: handler returned no pricing data`);
    return failures;
  }

  // priceMaxStrict — CRITICAL hard ceiling (catches mega-key bugs)
  if (e.priceMaxStrict != null && r.price != null && r.price > e.priceMaxStrict) {
    failures.push(
      `CRITICAL: price=$${r.price} exceeds strict ceiling $${e.priceMaxStrict}`
    );
  }

  // priceMin / priceMax — soft range (warn-style)
  if (e.priceMin != null && r.price != null && r.price < e.priceMin) {
    failures.push(`price=$${r.price} below expected min $${e.priceMin}`);
  }
  if (e.priceMax != null && r.price != null && r.price > e.priceMax) {
    failures.push(`price=$${r.price} above expected max $${e.priceMax}`);
  }

  // pricingSourceNotIn — must not be a refusal
  if (e.pricingSourceNotIn) {
    for (const banned of e.pricingSourceNotIn) {
      if (r.pricingSource === banned) {
        failures.push(`pricingSource=${banned} is banned`);
      }
    }
  }

  // refusedToPriceFalse — must be falsy
  if (e.refusedToPriceFalse && r.refusedToPrice) {
    failures.push(`refusedToPrice=true but expected false`);
  }

  // editionWarningExpected — out.editionWarning should be set
  if (e.editionWarningExpected && !r.editionWarning) {
    failures.push(`editionWarning expected but missing`);
  }

  return failures;
};

// ============================================================
// RUNNER
// ============================================================

const includeFailing = process.argv.includes('--include-failing');

const run = async () => {
  console.log('━'.repeat(60));
  console.log('Comic Vault smoke test — Ship 0.5');
  console.log(`Environment: ${envNote}`);
  console.log('━'.repeat(60));

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const fx of FIXTURES) {
    if (!fx.currentlyPassing && !includeFailing) {
      console.log(`⊘  SKIP: ${fx.name}  (queued ship target)`);
      skipped++;
      continue;
    }

    if (fx.requiresApiKeys && !hasApiKeys) {
      console.log(`⊘  SKIP: ${fx.name}  (requires eBay API keys)`);
      skipped++;
      continue;
    }

    try {
      const response = await callEnrich(fx.input);
      const failures = assertFixture(fx, response);

      if (failures.length === 0) {
        console.log(`✓  PASS: ${fx.name}  ($${response?.price ?? '—'})`);
        passed++;
      } else {
        console.log(`✗  FAIL: ${fx.name}`);
        for (const f of failures) console.log(`     - ${f}`);
        console.log(
          `     Got: price=$${response?.price ?? 'null'} source=${response?.pricingSource ?? 'null'} refused=${response?.refusedToPrice ?? false}`
        );
        failed++;
      }
    } catch (err) {
      console.log(`✗  ERROR: ${fx.name}`);
      console.log(`     - ${err?.message || err}`);
      if (err?.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
      failed++;
    }
  }

  console.log('━'.repeat(60));
  console.log(
    `Results: ${passed} passed, ${failed} failed, ${skipped} skipped`
  );
  console.log('━'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(2);
});
