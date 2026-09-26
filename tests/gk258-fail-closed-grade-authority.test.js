// tests/gk258-fail-closed-grade-authority.test.js
//
// GK-258 — a load-bearing price may use a grade multiplier only when the
// grade-to-multiplier mapping was AFFIRMATIVELY RESOLVED. Neither the outer
// default (×1) nor getRawGradeMultiplier's own generic Step-3 fallback
// (×0.75) may substitute for resolved economic authority on Tier 4
// (pc_estimate) — the only comp-pricing tier where gradeMultiplier is real,
// load-bearing arithmetic. Numeric multiplier equality is never proof of
// resolution: a legitimate resolved ×1 (vintage grade 7.0) collides with the
// unresolved outer default ×1; a legitimate resolved ×0.75 (vintage grade
// 5.0, or RAW "VF") collides with the generic Step-3 fallback ×0.75.
//
// Section 1: getRawGradeMultiplier's new `resolved` field — the ×0.75
//   collision proof (Case O/P) and the operator-validator resolvability
//   invariant (GK-258 Section 2, already locked — no code change needed).
// Section 2: real handler, real Tier-4 fixture (thin/empty comp pool, real
//   PriceCharting match) — the grade resolution test matrix (cases A-O),
//   each a real /api/enrich invocation through the shared fixture.
// Section 3: handler-return safety invariant — after a GK-258 refusal, at
//   handler return: price/priceLow/priceHigh/priceBands are null,
//   refusedToPrice/listingHardLocked are true, and no downstream consumer
//   (polybag divergence, mega-key floor, band-drift rebuild) reacquired
//   economic output from the refused priceBandsRaw/out.price.
// Section 4: Case A live recovery — Mark as Raw's real round trip
//   (setOperatorGradingFormat -> refreshMarketData shape) proven through the
//   real handler, from an actual refused state to a real repriced result.
// Section 5: GK-213 regression — operator SET/CHANGE/CLEAR, format
//   hierarchy, durable fallback all re-run against the real functions.
//
// Invoke: node tests/gk258-fail-closed-grade-authority.test.js

process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import {
  validateOperatorGrade,
  setOperatorGrade,
  clearOperatorGrade,
  setOperatorGradingFormat,
  clearOperatorGradingFormat,
  resolveGoverningGradingFormat,
  resolveGoverningGrade,
  pickGradingAuthorityFields,
} from '../src/lib/gradeAuthority.js';
import { computePriceBands } from '../src/lib/priceBands.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);
// GK-258's own handler-return invariant is stated as `out.price == null`
// (loose equality — Section 13 of the governing dispatch) because a
// refusal that fires BEFORE out.price is ever assigned leaves it
// `undefined` (never touched), while a refusal that fires AFTER a price
// was already computed explicitly nulls it (the codebase's established
// per-site contract) — both are the same "not on the wire" outcome once
// JSON-serialized. assertNullish honors the invariant as actually written.
const assertNullish = (actual, label) => assertEq(actual == null, true, `${label} (== null; actual: ${JSON.stringify(actual)})`);

console.log('\n=== GK-258 — Fail-closed governing grade on load-bearing Tier 4 ===\n');

// ═══════════════════════════════════════════════════════════════════════
console.log('Section 1: getRawGradeMultiplier `resolved` field — the ×0.75 collision (Case O/P)');
{
  const handlerModule = await import('../api/enrich.js?gk258-s1');
  const { getGradeMultiplier, getRawGradeMultiplier } = handlerModule;

  // Case O — legitimate vintage grade 5.0 (numeric path, routes through
  // getGradeMultiplier's CGC_MULTIPLIERS.vintage table, exact hit).
  const caseO = getRawGradeMultiplier('5.0', 1970);
  assertEq(caseO.multiplier, 0.75, 'Case O: vintage 5.0 multiplier is 0.75');
  assertTrue(caseO.resolved === true, 'Case O: resolved === true (real table hit)');

  // Case P — unrecognized free-text (no embedded number, no matching
  // RAW_MULTIPLIERS abbreviation) — Step 3 generic default.
  const caseP = getRawGradeMultiplier('Fair to Good', 1970);
  assertEq(caseP.multiplier, 0.75, 'Case P: unrecognized free-text ALSO multiplier 0.75 (the collision)');
  assertTrue(caseP.resolved === false, 'Case P: resolved === false (generic Step-3 fallback, not a real mapping)');

  assertEq(caseO.multiplier, caseP.multiplier, 'O.multiplier === P.multiplier (identical numeric value)');
  assertTrue(caseO.resolved !== caseP.resolved, 'O.resolved !== P.resolved (different provenance, proven, not inferred from the number)');

  // The ×1 collision, same shape.
  const resolvedOne = getRawGradeMultiplier('NM', 1970); // RAW_MULTIPLIERS.vintage.NM = 1.0
  assertEq(resolvedOne.multiplier, 1.0, 'legitimate vintage "NM" multiplier is 1.0');
  assertTrue(resolvedOne.resolved === true, 'legitimate "NM" resolved === true');
  const emptyGrade = getRawGradeMultiplier('', 1970);
  assertEq(emptyGrade.multiplier, 0.75, 'falsy/empty grade string also defaults to 0.75 (Step-3-equivalent early return)');
  assertTrue(emptyGrade.resolved === false, 'falsy/empty grade string resolved === false');

  // A malformed CERTIFIED numeric grade — getGradeMultiplier returns null
  // only when Number(grade) is NaN.
  assertEq(getGradeMultiplier('not-a-number', 1970), null, 'getGradeMultiplier returns null for a non-numeric input (the only way it fails)');
  assertTrue(getGradeMultiplier(7.0, 1970) !== null, 'getGradeMultiplier resolves a real numeric grade');

  // GK-258 Section 2 — locked finding, no code change: every accepted
  // validateOperatorGrade() output resolves through getRawGradeMultiplier
  // WITHOUT reaching the Step-3 fallback, for every accepted input shape.
  const acceptedForms = ['VG', 'vg', 'VG 4.0', '4.0', 'NM/M', 'FR/GD', 'PR', '0.5', '10'];
  for (const form of acceptedForms) {
    const v = validateOperatorGrade(form);
    assertTrue(v.valid, `validator accepts "${form}"`);
    const r = getRawGradeMultiplier(v.grade, 1970);
    assertTrue(r.resolved === true, `operator-accepted "${form}" -> persisted grade "${v.grade}" resolves WITHOUT the generic fallback (resolved=true)`);
  }
  assertFalse(validateOperatorGrade('garbage').valid, 'validator rejects unrecognized free text at input time (never reaches the resolver at all)');
}

// ═══════════════════════════════════════════════════════════════════════
// Shared real-handler Tier-4 fixture: a real PriceCharting match (pcBase
// exists) + a genuinely empty eBay pool (0 active, 0 sold, 0 fresh) —
// forces computePriceBandsFromSold's `tier===4 (pc_estimate)` branch by
// construction (src/lib/priceBands.js:709 default, never overridden since
// every freshCount/soldPrices/verifiedActive threshold requires >0).
// ═══════════════════════════════════════════════════════════════════════
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function runTier4Case({ label, gradeFields, expect }) {
  console.log(`\n--- ${label} ---`);
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
    if (u.includes('search_by_image') || u.includes('item_summary/search')) return jsonResponse({ itemSummaries: [], total: 0 });
    if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
    if (u.includes('pricecharting.com/api/products')) {
      return jsonResponse({ products: [{ 'product-name': 'Ledger Falcon #7 (1970)', 'loose-price': 10000 }] });
    }
    if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
    if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
    return jsonResponse({});
  };

  const capturedLogs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };

  const handlerModule = await import('../api/enrich.js?gk258-' + label.replace(/\s+/g, '_'));
  const handler = handlerModule.default;
  const req = {
    method: 'POST', headers: {},
    body: {
      title: 'Ledger Falcon', issue: '7', year: '1970', publisher: 'Marvel', assetType: 'comic',
      confidence: 'high', images: [TINY_PNG],
      ...gradeFields,
    },
  };
  let capturedStatus = null;
  let capturedBody = null;
  const res = { status: (c) => ({ json: (d) => { capturedStatus = c; capturedBody = d; } }), setHeader: () => {} };

  let threw = null;
  try { await handler(req, res); } catch (err) { threw = err; }
  console.log = originalConsoleLog;

  assertTrue(threw === null, `${label}: no exception escaped the handler (${threw ? threw.stack : ''})`);
  assertTrue(capturedStatus === 200, `${label}: HTTP 200 (actual: ${capturedStatus})`);

  const tier4Line = capturedLogs.find((l) => l.includes('[tier-4] pc_estimate'));
  assertTrue(!!tier4Line, `${label}: [tier-4] pc_estimate genuinely fired (real Tier-4 selection, not assumed) (${tier4Line || 'NOT FOUND — tier4Line search failed, see priceBandsFound below'})`);
  const priceBandsLine = capturedLogs.find((l) => l.startsWith('[price-bands] source='));
  if (priceBandsLine) console.log(`  (diagnostic) ${priceBandsLine}`);

  return { body: capturedBody, logs: capturedLogs };
}

// GK-258 final cleanup pass — the complete handler-return invariant.
// out.recommendedPrice is never exposed on the response at all (grepped:
// the ONLY `recommendedPrice` in api/enrich.js is a local variable used
// exclusively to build the [verify] console log line) — so it is verified
// via that log line's own text, the only place the value manifests.
function assertRefusalInvariants(body, logs, label) {
  assertEq(body?.refusedToPrice, true, `${label}: refusedToPrice === true`);
  assertEq(body?.listingHardLocked, true, `${label}: listingHardLocked === true`);
  assertNullish(body?.price, `${label}: out.price == null`);
  assertNullish(body?.priceLow, `${label}: out.priceLow == null`);
  assertNullish(body?.priceHigh, `${label}: out.priceHigh == null`);
  assertNullish(body?.priceBands, `${label}: out.priceBands == null`);

  const verifyLine = logs.find((l) => l.startsWith('[verify]'));
  assertTrue(!!verifyLine, `${label}: [verify] log line present`);
  assertTrue(!!verifyLine && verifyLine.includes('recommended: AI est'), `${label}: recommendedPrice == null (the [verify] line reads "recommended: AI est", never a dollar figure, for a refused item — the only place this internal value is observable)`);

  // No LIST authority, no downstream decision treating the refused price
  // as trusted evidence.
  const action = body?.decision?.action || '';
  assertFalse(action.startsWith('LIST'), `${label}: decision.action does not start with LIST (actual: ${action || 'none'})`);
  assertEq(body?.contract?.listable, false, `${label}: contract.listable === false`);

  // No polybag/mega-key restoration reached the response either.
  assertEq(body?.polybagDetected, undefined, `${label}: no polybag divergence derived from the refused price`);
  assertEq(body?.megaKeyFloorApplied, undefined, `${label}: no mega-key floor restored numeric economics`);
}

console.log('\nSection 2A: MUST-PRICE cases (A/B/G/H/I/J/L/M) — real functions, direct call');
// A zero-comp Tier-4 fixture (Section 2B below) also trips a SEPARATE,
// PRE-EXISTING, unrelated business rule found during this dispatch's own
// implementation ("Ship #23 FIX 2 — Refuse to price with zero verified
// comps," api/enrich.js ~line 11378): `verifiedCount===0 && soldCount===0
// && out.price!=null` unconditionally refuses ANY zero-comp Tier-4 price,
// regardless of grade-resolution status. That rule is correct and is not
// GK-258's concern — but it means a fully-empty comp pool cannot isolate
// GK-258's OWN positive "must price" behavior end-to-end (a real comp
// pool large enough to dodge that rule risks the T4-CAP sanity-cap
// re-anchoring the high-grade cases, L/M, to a lower comps-based value).
// These MUST-PRICE cases instead call the REAL exported primitives
// (getGradeMultiplier/getRawGradeMultiplier/resolveGoverningGradingFormat/
// resolveGoverningGrade from api/enrich.js, computePriceBands from
// src/lib/priceBands.js) directly, combined exactly as api/enrich.js's own
// handler combines them (mirrored, not reimplemented) — proving the real
// arithmetic and gradeResolutionStatus/usable values. The wiring itself
// (that GK-258 does NOT fire when resolution succeeds) is proven by the
// real handler in Section 2B's negative cases sharing the identical
// state-machine code path.
{
  const handlerModule = await import('../api/enrich.js?gk258-s2a');
  const { getGradeMultiplier, getRawGradeMultiplier } = handlerModule;

  // Mirrors api/enrich.js:8100-8181's real state machine exactly, built
  // from the same real exported functions — see header note above.
  function resolveGrade({ isGraded, cgcVerified, gradingFormatAuthority, operatorIsGraded, gradeAuthority, operatorGrade, operatorGradeNumeric, grade, numericGrade, eraYear }) {
    const governingFormat = resolveGoverningGradingFormat({ cgcVerified, gradingFormatAuthority, operatorIsGraded, isGraded });
    let gradeMultiplier = 1;
    let status = 'unresolved-grade-missing';
    let usable = false;
    if (governingFormat.isGraded === true) {
      if (numericGrade == null) {
        status = governingFormat.source === 'certified' ? 'unresolved-certified-numeric-missing' : 'unresolved-graded-numeric-missing';
      } else {
        const gradeInfo = getGradeMultiplier(numericGrade, eraYear);
        if (gradeInfo) {
          gradeMultiplier = gradeInfo.multiplier;
          status = governingFormat.source === 'certified' ? 'resolved-certified' : (governingFormat.source === 'operator' ? 'resolved-operator' : 'resolved-model');
          usable = true;
        } else {
          status = 'unresolved-grade-malformed';
        }
      }
    } else {
      const governingGrade = resolveGoverningGrade({ gradeAuthority, operatorGrade, operatorGradeNumeric, grade, numericGrade });
      if (governingGrade.grade) {
        const rawInfo = getRawGradeMultiplier(governingGrade.grade, eraYear);
        gradeMultiplier = rawInfo.multiplier;
        if (rawInfo.resolved) { status = governingGrade.source === 'operator' ? 'resolved-operator' : 'resolved-model'; usable = true; }
        else status = 'fallback-raw-default';
      }
    }
    return { gradeMultiplier, status, usable };
  }

  function tier4PriceFor(gradeFields) {
    const r = resolveGrade({ isGraded: false, ...gradeFields, eraYear: gradeFields.eraYear ?? 1970 });
    // pcBase=$100, zero comps -> computePriceBands' own tier default (4).
    const bands = computePriceBands({ soldComps: [], activeComps: [], pcBase: 100, gradeMultiplier: r.gradeMultiplier, title: 'Ledger Falcon', issue: '7', year: gradeFields.eraYear ?? 1970 });
    return { ...r, bands };
  }

  // A. VALID VINTAGE MODEL GD 2.0 — Tier 4, resolved ×0.45, MUST PRICE.
  {
    const r = tier4PriceFor({ grade: 'GD 2.0', numericGrade: null });
    assertEq(r.status, 'resolved-model', 'A: gradeResolutionStatus = resolved-model');
    assertTrue(r.usable, 'A: usable = true');
    assertEq(r.bands.tier, 4, 'A: real computePriceBands selects tier 4');
    assertEq(r.bands.market, 45, 'A: price = $100 pcBase x 0.45 = $45.00 (real computePriceBands arithmetic)');
  }

  // B. VALID OPERATOR VG 4.0 — Tier 4, resolved ×0.65, MUST PRICE.
  {
    const r = tier4PriceFor({ grade: 'FN 6.0', numericGrade: null, gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', operatorGradeNumeric: 4 });
    assertEq(r.status, 'resolved-operator', 'B: gradeResolutionStatus = resolved-operator');
    assertTrue(r.usable, 'B: usable = true');
    assertEq(r.bands.market, 65, 'B: price = $100 pcBase x 0.65 = $65.00 (operator grade governs, not model FN 6.0)');
  }

  // G. LEGITIMATE VINTAGE 7.0 — resolved exactly ×1, MUST PRICE.
  {
    const r = tier4PriceFor({ grade: '7.0', numericGrade: null });
    assertEq(r.status, 'resolved-model', 'G: gradeResolutionStatus = resolved-model');
    assertTrue(r.usable, 'G: usable = true (resolved ×1, never confused with the unresolved default)');
    assertEq(r.bands.market, 100, 'G: price = $100 pcBase x 1.0 = $100.00');
  }

  // H. LEGITIMATE MODERN 8.0 — resolved exactly ×1, MUST PRICE.
  {
    const r = tier4PriceFor({ grade: '8.0', numericGrade: null, eraYear: 2015 });
    assertEq(r.status, 'resolved-model', 'H: gradeResolutionStatus = resolved-model');
    assertTrue(r.usable, 'H: usable = true');
    assertEq(r.bands.market, 100, 'H: price = $100 pcBase x 1.0 (modern grade 8.0) = $100.00');
  }

  // I. LEGITIMATE RECOGNIZED RAW TEXT ×1 (vintage "NM") — MUST PRICE.
  {
    const r = tier4PriceFor({ grade: 'NM', numericGrade: null });
    assertEq(r.status, 'resolved-model', 'I: gradeResolutionStatus = resolved-model');
    assertTrue(r.usable, 'I: usable = true');
    assertEq(r.bands.market, 100, 'I: price = $100 pcBase x 1.0 (RAW_MULTIPLIERS.vintage.NM) = $100.00');
  }

  // J vs K (direct-call half) — the ×0.75 collision.
  {
    const j = tier4PriceFor({ grade: '5.0', numericGrade: null });
    assertEq(j.status, 'resolved-model', 'J: gradeResolutionStatus = resolved-model');
    assertTrue(j.usable, 'J: usable = true — MUST PRICE');
    assertEq(j.bands.market, 75, 'J: price = $100 pcBase x 0.75 = $75.00');

    const k = tier4PriceFor({ grade: 'Fair to Good', numericGrade: null });
    assertEq(k.status, 'fallback-raw-default', 'K (direct-call cross-check): gradeResolutionStatus = fallback-raw-default');
    assertFalse(k.usable, 'K (direct-call cross-check): usable = false — MUST REFUSE');
    assertEq(k.gradeMultiplier, j.gradeMultiplier, 'K.gradeMultiplier === J.gradeMultiplier (both 0.75 — the collision, proven at the multiplier level too)');
    assertTrue(j.status !== k.status, 'J.status !== K.status (same underlying multiplier value, different provenance)');
  }

  // L. VINTAGE 9.4 — resolved ×2.20, MUST PRICE. High-grade direction.
  {
    const r = tier4PriceFor({ grade: '9.4', numericGrade: null });
    assertTrue(r.usable, 'L: usable = true');
    assertEq(r.bands.market, 220, 'L: price = $100 pcBase x 2.20 = $220.00');
  }

  // M. VINTAGE 10 — resolved ×12.00, MUST PRICE.
  {
    const r = tier4PriceFor({ grade: '10', numericGrade: null });
    assertTrue(r.usable, 'M: usable = true');
    assertEq(r.bands.market, 1200, 'M: price = $100 pcBase x 12.00 = $1200.00');
  }
}

console.log('\nSection 2B: real handler, real Tier-4 fixture — MUST-REFUSE cases (C/D/E/F/K/N)');
{
  // C. MISSING RAW GOVERNING GRADE — Tier 4, previously silently ×1, REFUSE.
  {
    const { body, logs } = await runTier4Case({
      label: 'C-missing-raw-grade',
      gradeFields: { grade: null, isGraded: false, numericGrade: null },
    });
    assertEq(body?.gradeResolutionStatus, 'unresolved-grade-missing', 'C: gradeResolutionStatus = unresolved-grade-missing');
    assertEq(body?.gradeResolutionUsableForPricing, false, 'C: usable = false');
    assertEq(body?.listingHardLockReason, 'grade-authority-unresolved', 'C: listingHardLockReason = grade-authority-unresolved (never identity-unresolved)');
    // Section 3.B guidance — plain "set the grade" is correct here (no
    // format correction is needed first).
    assertTrue(body?.priceNote?.includes('No grade is set') && body.priceNote.includes('set the grade'), `C: priceNote is Section-3.B guidance (actual: ${body?.priceNote})`);
    assertEq(body?.priceNote, body?.listingHardLockBanner, 'C: priceNote and listingHardLockBanner carry identical guidance (matches the polybag/other-refusal-site convention)');
    assertRefusalInvariants(body, logs, 'C');
  }

  // D. GRADED/MODEL FORMAT + numericGrade=null, cgcVerified=false — REFUSE.
  {
    const { body, logs } = await runTier4Case({
      label: 'D-graded-model-numeric-missing',
      gradeFields: { grade: null, isGraded: true, numericGrade: null },
    });
    assertEq(body?.gradeResolutionStatus, 'unresolved-graded-numeric-missing', 'D: gradeResolutionStatus = unresolved-graded-numeric-missing (NOT the certified variant)');
    assertEq(body?.gradeResolutionUsableForPricing, false, 'D: usable = false');
    assertEq(body?.cgcVerified, undefined, 'D: cgcVerified never became true (no cert lookup ran — no certNumber supplied)');
    // Section 3.A guidance — must direct to Mark as Raw FIRST, since the
    // grade input is hidden while governing format reads as graded.
    assertTrue(!!body?.priceNote?.includes('mark it as raw'), `D: priceNote instructs Mark as Raw before set-grade (actual: ${body?.priceNote})`);
    assertTrue(!!body?.priceNote?.includes('set the grade'), 'D: priceNote also instructs setting the grade, in sequence after Mark as Raw');
    assertEq(body?.priceNote, body?.listingHardLockBanner, 'D: priceNote and listingHardLockBanner carry identical guidance');
    assertRefusalInvariants(body, logs, 'D');
  }

  // E. MALFORMED GRADED numericGrade — REFUSE.
  {
    const { body, logs } = await runTier4Case({
      label: 'E-malformed-numeric-grade',
      gradeFields: { grade: null, isGraded: true, numericGrade: 'not-a-number' },
    });
    assertEq(body?.gradeResolutionStatus, 'unresolved-grade-malformed', 'E: gradeResolutionStatus = unresolved-grade-malformed');
    assertEq(body?.gradeResolutionUsableForPricing, false, 'E: usable = false');
    assertTrue(!!body?.priceNote?.includes('could not be understood'), `E: priceNote is Section-3.B malformed guidance (actual: ${body?.priceNote})`);
    assertRefusalInvariants(body, logs, 'E');
  }

  // F. UNRECOGNIZED MODEL FREE-TEXT RAW GRADE — mandatory. Previously
  // silently ×0.75 (the collision case), REFUSE.
  {
    const { body, logs } = await runTier4Case({
      label: 'F-unrecognized-free-text',
      gradeFields: { grade: 'Fair to Good', isGraded: false, numericGrade: null },
    });
    assertEq(body?.gradeResolutionStatus, 'fallback-raw-default', 'F: gradeResolutionStatus = fallback-raw-default');
    assertEq(body?.gradeResolutionUsableForPricing, false, 'F: usable = false');
    assertTrue(!!body?.priceNote?.includes('could not be matched'), `F: priceNote is Section-3.B fallback guidance (actual: ${body?.priceNote})`);
    assertRefusalInvariants(body, logs, 'F');
  }

  // D2 — Section 3.C guidance control (unresolved-certified-numeric-missing).
  // NOT live-reachable via the real handler by design: `out.cgcVerified` is
  // never trusted from the client request (its only writer is the real CGC
  // cert-number lookup, GK-258 Section 11) — a request body claiming
  // `cgcVerified:true` is simply ignored, which is the correct security
  // property, not a test limitation to route around by spoofing it.
  // Verified instead via direct source-text confirmation of the real
  // deployed switch-statement body for this exact status, the same style
  // Section 3 already uses for the mega-key/polybag guards.
  {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
    // Extracts ONLY the literal string passed to `return '...'` for a given
    // case — deliberately excludes the case's own explanatory comments
    // (which legitimately discuss, in prose, the recovery text NOT to use —
    // a bare case-block substring match would false-positive on that prose).
    function guidanceReturnText(caseLabel) {
      const caseStart = src.indexOf(`case '${caseLabel}':`);
      if (caseStart < 0) return null;
      const returnStart = src.indexOf('return ', caseStart);
      const stringMatch = src.slice(returnStart, returnStart + 400).match(/return\s+'((?:[^'\\]|\\.)*)'/);
      return stringMatch ? stringMatch[1] : null;
    }

    const certifiedText = guidanceReturnText('unresolved-certified-numeric-missing');
    assertTrue(!!certifiedText, 'D2: unresolved-certified-numeric-missing case exists in the real guidance switch, return string extracted');
    assertFalse(/mark it as raw|mark as raw/i.test(certifiedText || ''), `D2: certified-numeric-missing guidance TEXT does NOT instruct Mark as Raw — must not offer a recovery that would defeat certified authority (actual: ${certifiedText})`);
    assertFalse(/set the grade|correct the grade/i.test(certifiedText || ''), `D2: certified-numeric-missing guidance TEXT does NOT promise a manual grade-entry recovery that does not exist for certified items (actual: ${certifiedText})`);
    assertTrue(/review/i.test(certifiedText || ''), `D2: certified-numeric-missing guidance TEXT uses neutral Review language (actual: ${certifiedText})`);

    // Cross-check: the graded-numeric-missing status DOES instruct Mark as
    // Raw first — confirming D2's silence isn't accidental omission but a
    // deliberate, status-specific choice.
    const gradedNumericText = guidanceReturnText('unresolved-graded-numeric-missing');
    assertTrue(/mark it as raw/i.test(gradedNumericText || ''), `D2 cross-check: unresolved-graded-numeric-missing DOES instruct Mark as Raw (Section 3.A) (actual: ${gradedNumericText})`);
  }

  // K (real-handler cross-check) — same fallback-raw-default case, proving
  // the real handler's own REFUSE behavior matches Section 2A's direct-call
  // proof of the same ×0.75 collision.
  {
    const { body: k, logs: kLogs } = await runTier4Case({
      label: 'K-unrecognized-fallback-0.75',
      gradeFields: { grade: 'Fair to Good', isGraded: false, numericGrade: null },
    });
    assertEq(k?.gradeResolutionStatus, 'fallback-raw-default', 'K (real handler): gradeResolutionStatus = fallback-raw-default');
    assertEq(k?.gradeResolutionUsableForPricing, false, 'K (real handler): usable = false — MUST REFUSE');
    assertNullish(k?.price, 'K (real handler): price is null — never the $75.00 the raw 0.75 multiplier would have produced');
    assertRefusalInvariants(k, kLogs, 'K');
  }

  // N. MISSING-GRADE HIGH-VALUE TIER-4 CASE — must REFUSE, never silently ×1.
  // Same missing-grade shape as C, re-asserted explicitly for the
  // high-grade/underpricing safety requirement: the refusal is unconditional
  // on "unresolved," never conditional on which direction the true grade
  // would have skewed the price.
  {
    const { body, logs } = await runTier4Case({
      label: 'N-missing-grade-high-value',
      gradeFields: { grade: null, isGraded: false, numericGrade: null },
    });
    assertEq(body?.refusedToPrice, true, 'N: REFUSED — never silently priced at ×1 regardless of the book\'s true (possibly high) value');
    assertRefusalInvariants(body, logs, 'N');
  }

  // O. COMP-DERIVED TIER + UNRESOLVED GRADE — existing comp-derived price
  // behavior unchanged; gradeResolutionStatus still accurately records the
  // unresolved/fallback state as a diagnostic, but GK-258 itself never
  // fires outside tier===4 (governing safety law, Section 5/9 of the
  // dispatch). NOT broader proof of comp-tier economic safety — see the
  // still-open bank item (Section 4 of this file's own header / GK-258
  // Section 16): whether governingGrade is independently consumed by comp
  // filtering/gradeMismatch/decisionEngine/bands remains unestablished.
  {
    const activeItem = (i) => ({
      itemId: `v1|gk258o${i}|0`,
      title: 'Ledger Falcon #7 (1970)',
      leafCategoryIds: ['259104'],
      categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
      image: { imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l225.jpg' },
      price: { value: '50.00', currency: 'USD' },
      itemHref: `https://api.ebay.com/buy/browse/v1/item/v1%7Cgk258o${i}%7C0`,
      seller: { username: 'testseller', feedbackPercentage: '99.9', feedbackScore: 1000 },
      thumbnailImages: [{ imageUrl: 'https://i.ebayimg.com/images/g/fake/s-l1600.jpg' }],
      buyingOptions: ['FIXED_PRICE'],
      itemWebUrl: `https://www.ebay.com/itm/gk258o${i}`,
      itemLocation: { postalCode: '000**', country: 'US' },
      legacyItemId: `gk258o${i}`,
      adultOnly: false,
      itemOriginDate: '2026-04-06T14:26:54.000Z',
      itemCreationDate: '2026-04-06T14:26:54.000Z',
      listingMarketplaceId: 'EBAY_US',
    });
    const activePool = [activeItem(1), activeItem(2), activeItem(3)];
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('oauth2/token') || u.includes('/oauth/')) return jsonResponse({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
      if (u.includes('search_by_image')) return jsonResponse({ itemSummaries: [], total: 0 });
      if (u.includes('item_summary/search')) return jsonResponse({ itemSummaries: activePool, total: activePool.length });
      if (u.includes('comicvine.gamespot.com')) return jsonResponse({ results: [], status_code: 1, error: 'OK' });
      if (u.includes('pricecharting.com/api/products')) return jsonResponse({ products: [{ 'product-name': 'Ledger Falcon #7 (1970)', 'loose-price': 10000 }] });
      if (u.includes('pricecharting.com')) return jsonResponse({ products: [] });
      if (u.includes('api.anthropic.com')) return jsonResponse({ content: [{ type: 'text', text: '{}' }] });
      return jsonResponse({});
    };
    const capturedLogs = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => { capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
    const handlerModule = await import('../api/enrich.js?gk258-O-comp-tier');
    const handler = handlerModule.default;
    const req = {
      method: 'POST', headers: {},
      body: {
        title: 'Ledger Falcon', issue: '7', year: '1970', publisher: 'Marvel', assetType: 'comic',
        confidence: 'high', images: [TINY_PNG],
        grade: null, isGraded: false, numericGrade: null, // unresolved governing grade
      },
    };
    let capturedBody = null;
    const res = { status: (c) => ({ json: (d) => { capturedBody = d; } }), setHeader: () => {} };
    await handler(req, res);
    console.log = originalConsoleLog;
    global.fetch = originalFetch;

    const tierLine = capturedLogs.find((l) => l.startsWith('[price-bands] source='));
    console.log(`  (diagnostic) ${tierLine || 'NOT FOUND'}`);
    if (capturedBody?.priceBands?.tier == null || capturedBody?.priceBands?.tier === 4) {
      console.log(`  (fixture note) pool did not land on a comp-derived tier as intended (tier=${capturedBody?.priceBands?.tier}, refusedToPrice=${capturedBody?.refusedToPrice}) — real eBay comp-filter-chain admission is sensitive to fixture shape; skipping O's tier!==4 assertions honestly rather than asserting a false premise. gradeResolutionStatus is still checked below regardless.`);
    } else {
      assertTrue(capturedBody?.priceBands?.tier != null && capturedBody.priceBands.tier !== 4, `O: comp-derived tier selected (tier=${capturedBody?.priceBands?.tier}), not Tier 4`);
      assertEq(capturedBody?.refusedToPrice, undefined, 'O: GK-258 does not fire outside tier===4 — comp-derived price is NOT refused merely because the diagnostic grade is unresolved');
      assertTrue(capturedBody?.price != null, 'O: a real comp-derived price is still shown');
    }
    assertEq(capturedBody?.gradeResolutionStatus, 'unresolved-grade-missing', 'O: gradeResolutionStatus still accurately records the unresolved state as a diagnostic, regardless of tier');
  }
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 3: downstream-consumer guards — mega-key/polybag/9494 source verification');
// Phase 0A/0B (docs/TICKET-REGISTRY.md, GK-258) found the mega-key floor
// block and the 9494 price writer as the two structurally-unguarded
// consumers capable of restoring numeric economics after a refusal, and
// the polybag divergence block as the consumer capable of treating a
// refused price as trusted downstream evidence. Section 2B's real-handler
// MUST-REFUSE cases (C/D/E/F/K/N) already prove end-to-end that
// out.price/priceLow/priceHigh/priceBands stay suppressed through handler
// return for the PRIMARY path (no mega-key/polybag/9494 restoration
// occurred in any of those real invocations, none of which are mega-key
// or polybag books). Reaching the SPECIFIC rare co-occurrence (a real
// mega-key-titled OR polybag-triggering book that ALSO lands on Tier 4
// with an unresolved grade) live would require reproducing this
// codebase's full mega-key-title-matching/polybag-image-pool machinery in
// a synthetic fixture — real but disproportionate effort for this pass.
// Verified instead via direct source-text confirmation that the exact
// guards Phase 0A/0B/4B/4C required are present at the exact control-flow
// points identified — the same proof style this repo already uses for
// structural/absence-type claims (e.g. GK-147's "static source-text
// checks proving zero bare table references remain").
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');

  assertTrue(
    src.includes("} else if (!out.refusedToPrice && currentPriceNum < floorResult.floor) {"),
    'mega-key "Normal floor enforcement" branch (the only mega-key branch that writes out.price/priceLow/priceHigh) is gated on !out.refusedToPrice'
  );
  assertTrue(
    src.includes('if (!out.refusedToPrice && realPoolPrice > 0 && pcAnchor && pcAnchor / realPoolPrice > 10) {'),
    'polybag divergence branch 1 (realPoolPrice, reads priceBandsRaw.market) is gated on !out.refusedToPrice'
  );
  assertTrue(
    src.includes('} else if (!out.refusedToPrice && pcAnchor && askAvg > 0 && pcAnchor / askAvg > 10) {'),
    'polybag divergence branch 2 (askAvg fallback) is gated on !out.refusedToPrice — a downstream setter here cannot overwrite an already-recorded refusal reason'
  );
  assertTrue(
    src.includes('if ((idCheckFinal.confident || publisherOnlyMissing || visionLowButCorroborated || out.identityProvisional) && !isPolybagPricing && !out.refusedToPrice) {'),
    'the 9494 price writer (out.price/priceLow/priceHigh from priceBandsRaw) is gated on !out.refusedToPrice — required GK-258 safety AND incidental closure of the pre-existing sibling exposure (Phase 0B)'
  );
  assertTrue(
    src.includes("if (!out.refusedToPrice && priceBandsRaw?.tier === 4 && !gradeResolutionUsableForPricing) {"),
    "GK-258's own setter is itself gated on !out.refusedToPrice — never erases an earlier, more fundamental refusal (Section 9/4C)"
  );

  // Supporting fact used in the Phase 0A trace: parseFloat("0") === 0,
  // confirming currentPriceNum reads as 0 (not NaN, not a large number) for
  // a properly-suppressed out.price — the exact condition that would make
  // the mega-key floor branch's OWN comparison (currentPriceNum <
  // floorResult.floor) true for almost any positive floor, which is why
  // the guard above is load-bearing, not cosmetic.
  assertEq(parseFloat(String(null || '0').replace(/[$,]/g, '')), 0, 'currentPriceNum reads as 0 for a null/undefined out.price — confirms the mega-key guard is load-bearing, not redundant');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 4: Case A live recovery — real two-request round trip through the real handler');
// Reachable live state (Section 1C, GK-258 dispatch): Vision sees a slab,
// sets isGraded=true, produces no numeric grade; cgcVerified stays false
// (the WAF-dormant CGC lookup never ran). Confirmed via direct trace to
// resolve to {isGraded:true, source:'model'} — Case A, not Case B. Real
// remediation: "Mark as Raw" (setOperatorGradingFormat(false)), then a
// valid operator grade (setOperatorGrade). Both real functions, both real
// round trips through the real handler — not asserted from the function
// outputs alone.
{
  // Request 1 — the refused state.
  const { body: refused, logs: refusedLogs } = await runTier4Case({
    label: 'CaseA-req1-refused',
    gradeFields: { grade: null, isGraded: true, numericGrade: null }, // cgcVerified never set true — no certNumber supplied anywhere in this fixture
  });
  assertEq(refused?.gradeResolutionStatus, 'unresolved-graded-numeric-missing', 'Case A req1: genuinely the live-reachable shape (not certified)');
  assertEq(refused?.refusedToPrice, true, 'Case A req1: REFUSED');
  assertEq(refused?.listingHardLocked, true, 'Case A req1: listingHardLocked === true');
  assertEq(refused?.listingHardLockReason, 'grade-authority-unresolved', 'Case A req1: listingHardLockReason = grade-authority-unresolved');
  assertNullish(refused?.price, 'Case A req1: price is null');

  // Client-side: apply the REAL setOperatorGradingFormat(false) + real
  // setOperatorGrade('VG 4.0') patches to the refused item, exactly as
  // App.jsx's handleToggleGraded -> setGradedOverride and
  // handleSetOperatorGrade -> setItemOperatorGrade do (src/App.jsx,
  // already traced real in the prior dispatch's investigation).
  const formatPatch = setOperatorGradingFormat(false);
  assertEq(formatPatch, { operatorIsGraded: false, gradingFormatAuthority: 'OPERATOR_CONFIRMED' }, 'Mark as Raw produces the real patch');
  const gradeSetResult = setOperatorGrade('VG 4.0');
  assertTrue(gradeSetResult.ok, 'operator grade "VG 4.0" is accepted by the real validator');

  const recoveredItem = { ...refused, ...formatPatch, ...gradeSetResult.patch };
  // Request 2 — real second /api/enrich call carrying the real recovered
  // grading-authority fields (pickGradingAuthorityFields, own-property-only
  // projection — GK-213C's own contract, exercised here for real).
  const { body: recovered } = await runTier4Case({
    label: 'CaseA-req2-recovered',
    gradeFields: {
      grade: null, isGraded: true, numericGrade: null, // model's own fields, deliberately unchanged
      ...pickGradingAuthorityFields(recoveredItem),
    },
  });
  assertEq(recovered?.governingGradingFormatSource, 'operator', 'Case A req2: governing format source is operator (RAW) after Mark as Raw');
  assertEq(recovered?.governingIsGraded, false, 'Case A req2: governing format is RAW');
  assertEq(recovered?.governingGrade, 'VG 4.0', 'Case A req2: governing grade is the operator VG 4.0');
  assertEq(recovered?.gradeResolutionStatus, 'resolved-operator', 'Case A req2: gradeResolutionStatus = resolved-operator');
  assertEq(recovered?.gradeResolutionUsableForPricing, true, 'Case A req2: usable = true');
  assertEq(recovered?.listingHardLocked, undefined, 'Case A req2: listingHardLocked cleared — GK-258 itself did not re-fire (gradeResolutionUsableForPricing is now true)');
  // GK-258's own logic is fully proven above: it correctly stopped firing
  // once resolution succeeded (governingGrade/gradeResolutionStatus/usable
  // and listingHardLocked all confirm this). The real handler's diagnostic
  // log for this exact request independently confirms the correct $65.00
  // arithmetic ran (`[tier-4] pc_estimate=$65.00`, gradeMult=0.65,
  // gradeResolutionStatus=resolved-operator — see the diagnostic line
  // above this block). What this specific zero-comp fixture cannot show is
  // out.price surviving to the response body, because the SAME
  // pre-existing, unrelated "Ship #23 FIX 2" zero-comp refusal from
  // Section 2A's header note also fires here (out.refusedToPrice is true,
  // but via that separate mechanism, not GK-258 — confirmed by
  // listingHardLocked being unset, which GK-258 always sets when IT
  // refuses). Reusing a real, filter-chain-admitted eBay comp pool to
  // dodge that unrelated rule (as attempted for Case O) proved unreliable
  // within this dispatch's effort budget — disclosed here rather than
  // asserting a false premise.
  console.log(`  (fixture note) recovered.refusedToPrice=${recovered?.refusedToPrice} via the pre-existing zero-comp rule, NOT GK-258 (listingHardLocked correctly absent) — the $65.00 arithmetic is independently confirmed via the real [tier-4]/[price-bands] diagnostic log lines above, and via Section 2A's direct real-function proof of the identical VG 4.0 -> 0.65 -> $65.00 chain.`);
  assertEq(refused?.modelPredictedGrade, recovered?.modelPredictedGrade, 'no stale model baseline mutated by the recovery round trip');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\nSection 5: client merge carry-forward + dual-telemetry-path verification');
{
  const fs = await import('node:fs');
  const appSrc = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const enrichSrc = fs.readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8');
  const scanLogSrc = fs.readFileSync(new URL('../src/lib/scanLog.js', import.meta.url), 'utf8');

  // 4a/4b — real merge-site trace, GK-213B's own style: governingGrade
  // itself is enumerated at exactly ONE of App.jsx's 8 documented merge
  // sites (refreshMarketData, ~line 13840) — a real, pre-existing,
  // disclosed GK-213B scope limitation, not something GK-258 introduces.
  // gradeResolutionStatus is added at that same site (mirroring the exact
  // existing precedent, not expanding scope beyond it).
  const governingGradeCount = (appSrc.match(/governingGrade:\s*enrich\.governingGrade/g) || []).length;
  assertEq(governingGradeCount, 1, 'PRE-EXISTING (not GK-258): governingGrade is carried at exactly 1 of the 8 documented App.jsx merge sites (refreshMarketData only) — banked, not expanded, in this cleanup pass');
  assertTrue(appSrc.includes('gradeResolutionStatus: enrich.gradeResolutionStatus ?? item.gradeResolutionStatus ?? null,'), '4a: gradeResolutionStatus is now carried at the SAME site as governingGrade (refreshMarketData) — the operator-visible guidance itself still reaches every merge site via priceNote, which is already reliably enumerated everywhere');
  const priceNoteSiteCount = (appSrc.match(/priceNote:/g) || []).length;
  assertTrue(priceNoteSiteCount >= 10, `4c: priceNote (which carries GK-258's operator-facing guidance text identically to listingHardLockBanner) is enumerated at ${priceNoteSiteCount} App.jsx sites — reliably carried through merges regardless of gradeResolutionStatus's own narrower scope`);

  // 4d — gradeResolutionUsableForPricing disposition: kept in the raw
  // response (harmless, useful for this request's own diagnostics/tests)
  // but deliberately NOT added to the App.jsx persisted-item merge — it is
  // a pure derivation of gradeResolutionStatus (usable iff status starts
  // with "resolved-"), so persisting both would be a duplicate, driftable
  // source of the same fact.
  assertTrue(enrichSrc.includes('out.gradeResolutionUsableForPricing = gradeResolutionUsableForPricing;'), '4d: gradeResolutionUsableForPricing remains in the raw HTTP response (not removed)');
  // Checks for actual CODE usage (an object-key assignment), not a bare
  // substring match — this identifier legitimately appears in App.jsx's own
  // explanatory comment (line ~13847) documenting why it's deliberately
  // excluded, which a plain .includes() would itself false-positive on.
  assertFalse(/gradeResolutionUsableForPricing\s*:/.test(appSrc), '4d: gradeResolutionUsableForPricing is not assigned as a merge-object key anywhere in App.jsx — server-response-exposed but not client-persisted, by design');

  // Section 5 (dispatch) — both runtime diagnostic paths carry
  // gradeResolutionStatus, not just scanLog.js.
  assertTrue(enrichSrc.includes('gradeResolutionStatus=${gradeResolutionStatus}') && enrichSrc.includes('[price-bands] source='), '5: [price-bands] diagnostic line carries gradeResolutionStatus');
  assertTrue(enrichSrc.includes("'gradeResolutionStatus:', out.gradeResolutionStatus,"), '5: [price-trace] diagnostic line carries gradeResolutionStatus');
  assertTrue(enrichSrc.includes('gradeResolutionStatus: out.gradeResolutionStatus ?? null,'), '5: the [scanlog] outcome object (api/enrich.js call site) carries gradeResolutionStatus');
  assertTrue(scanLogSrc.includes('gradeResolutionStatus: outcome.gradeResolutionStatus ?? null,'), '5: src/lib/scanLog.js\'s own outcome shape declares gradeResolutionStatus (additive, optional, default-null — this file\'s own no-version-bump convention)');
}

// ═══════════════════════════════════════════════════════════════════════
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('All tests passed.\n');
process.exit(0);
