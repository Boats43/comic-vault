// tests/grailkey-commit-m-pc-query-fallback.test.js
//
// GrailKey dispatch, Commit M — PC query fallback + issue-match repair +
// signed-edition exclusion (Iron Man #126 class).
//
// Root defect, confirmed via Commit L's production diagnostic: PC's
// search for "The Invincible Iron Man 126" returns exactly ONE
// candidate — "Bob Layton The Invincible Iron Man Vol.1 126 #CC-BL" —
// which the OLD issueRe (`#${issue}\b`, required a literal '#'
// immediately before the digits) silently rejected, because this
// product's "126" is bare (no '#'); its only '#' is on an unrelated
// SKU suffix ("#CC-BL", a signed/certified-edition marker). PC never
// even returned the genuine base entry ("Iron Man #126") for this
// query text at all — a second, independent defect in the query text
// itself, not just the matching regex.
//
// Fix, three parts:
//   M1 — issueRe loosened to `\bN\b` (matches with or without a
//        leading '#', but only as a standalone numeric token — never
//        inside a longer number or an alphanumeric SKU).
//   M2 — PC_SKU_CODE_RE (`#[a-z]`) added: a '#' immediately followed
//        by a LETTER is structurally never a genuine issue number
//        (PC's own convention: issue numbers are '#' + digits) — it's
//        a certification/SKU code. Required alongside M1: loosening
//        issueRe alone would ALSO admit the signed edition (it
//        carries "126" bare too), pricing a raw copy off signed comps.
//   M3 — query fallback: when the primary query yields nothing, retry
//        once with the leading substantive word mechanically stripped
//        (reuses the existing tokenize/COMMON_TOKENS machinery
//        mainToken already relies on — no hardcoded alias table).
//
// lookupPriceCharting is exported specifically for this kind of test
// (see the bulk export block, "Q86 — exported for year-confidence
// tests") — same fetch-mocking convention as
// tests/q86-year-confidence.test.js.
//
// Invoke: node tests/grailkey-commit-m-pc-query-fallback.test.js
// Exit code: 0 on all-pass, 1 on any failure.

process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-token';
const { lookupPriceCharting } = await import('../api/enrich.js');

let passed = 0;
let failed = 0;
const failures = [];
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

console.log('\n=== GrailKey Commit M — PC Query Fallback + Issue-Match Repair ===\n');

// ─── M-1: Iron Man #126 — real production shape, end-to-end ────────────
console.log('M-1: Iron Man #126 reaches the correct base entry, not the signed edition:');
{
  // Real production evidence (Commit L diagnostic): attempt 1 ("The
  // Invincible Iron Man 126") returns exactly the signed-edition
  // product. Attempt 2 (M3 fallback, "iron man 126") is simulated here
  // returning PC's genuine base entry — the real answer to "does PC
  // hold Iron Man #126 (1979)" isn't knowable without live PC access
  // (confirmed blocked this session — Encrypted token), so this
  // fixture asserts the MECHANISM correctly reaches and accepts a
  // genuine base entry once the fallback query surfaces one, which is
  // exactly what the live certification scan will confirm or refute.
  globalThis.fetch = async (url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('q=The Invincible Iron Man 126')) {
      return {
        ok: true,
        json: async () => ({
          products: [
            { id: 'signed1', 'product-name': 'Bob Layton The Invincible Iron Man Vol.1 126 #CC-BL', 'loose-price': 8500 },
          ],
        }),
      };
    }
    if (decoded.includes('q=iron man 126')) {
      return {
        ok: true,
        json: async () => ({
          products: [
            { id: 'base126', 'product-name': 'Iron Man #126 (1979)', 'loose-price': 3200 },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({ products: [] }) };
  };

  const r = await lookupPriceCharting({ title: 'The Invincible Iron Man', issue: '126', year: '1979' });
  check(r != null, 'a candidate was returned (not null)');
  check(r?.productName === 'Iron Man #126 (1979)', `resolved to the base entry, not the signed edition (got "${r?.productName}")`);
  check(r?.price === 32, `price from the correct product (got ${r?.price})`);
}

// ─── M-2: ASM #300 — byte-identical, zero change ────────────────────────
console.log('\nM-2: ASM #300 — primary query succeeds immediately, fallback never reached:');
{
  let fetchCallCount = 0;
  globalThis.fetch = async (url) => {
    fetchCallCount++;
    return {
      ok: true,
      json: async () => ({
        products: [
          { id: 'asm300', 'product-name': 'Amazing Spider-Man #300 (1988)', 'loose-price': 15000 },
        ],
      }),
    };
  };
  const r = await lookupPriceCharting({ title: 'Amazing Spider-Man', issue: '300', year: '1988' });
  check(r?.productName === 'Amazing Spider-Man #300 (1988)', 'ASM #300 resolves to the correct product');
  check(fetchCallCount === 1, `fallback never triggered — exactly 1 fetch call (got ${fetchCallCount})`);
}

// ─── M-3: SKU-shaped code never parsed as issue ─────────────────────────
console.log('\nM-3: a "#CC-BL"-shaped SKU is never treated as a match for issue 126:');
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      products: [
        { id: 'sku1', 'product-name': 'Bob Layton Iron Man 126 #CC-BL', 'loose-price': 8500 },
      ],
    }),
  });
  const r = await lookupPriceCharting({ title: 'Iron Man', issue: '126', year: '1979' });
  check(r == null, 'SKU-suffixed signed edition never accepted as a match, even with a bare "126" present');
}

// ─── M-4: "#1265" does not match a query for 126 ────────────────────────
console.log('\nM-4: "#1265" does not falsely match issue 126:');
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      products: [
        { id: 'wrong', 'product-name': 'Iron Man #1265 (1979)', 'loose-price': 500 },
      ],
    }),
  });
  const r = await lookupPriceCharting({ title: 'Iron Man', issue: '126', year: '1979' });
  check(r == null, '"#1265" correctly does not match a search for issue 126');
}

// ─── Control: bare issue number without '#' still matches (the actual fix) ──
console.log('\nControl: bare issue number ("Vol.1 126", no #) now matches — the core M1 fix:');
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      products: [
        { id: 'bare126', 'product-name': 'Iron Man Vol.1 126 (1979)', 'loose-price': 2800 },
      ],
    }),
  });
  const r = await lookupPriceCharting({ title: 'Iron Man', issue: '126', year: '1979' });
  check(r?.productName === 'Iron Man Vol.1 126 (1979)', 'bare "126" (no leading #) now matches correctly');
}

// ─── M-5: MUTATION — restore /#126\b/ -> M-1's core mechanism fails ─────
// A genuine git-stash toggle was run as part of this commit's
// verification: reverting to the pre-M `#${issueStr}\b` pattern makes
// the "Control" fixture above (bare "126", no '#') fail — the exact
// shape of the real production defect. Restoring the fix passes again.
// Lightweight inline re-statement below so CI catches a future silent
// revert without re-running the manual toggle.
console.log('\nM-5 MUTATION PROOF (documented above; re-asserting fixture stability):');
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      products: [
        { id: 'bare126b', 'product-name': 'Iron Man Vol.1 126 (1979)', 'loose-price': 2800 },
      ],
    }),
  });
  const r = await lookupPriceCharting({ title: 'Iron Man', issue: '126', year: '1979' });
  check(r != null, 'bare-issue-number fixture stable — matches genuine git-stash mutation proof result');
}

// ─── M-6: MUTATION — signed-edition control still rejects ──────────────
// The M-3 fixture above IS the M-6 mutation proof requested by the
// dispatch: it fails without PC_SKU_CODE_RE (the signed edition would
// be wrongly admitted via the now-loosened M1 issueRe) and passes with
// it. Genuine git-stash toggle (removing the PC_SKU_CODE_RE check)
// confirmed M-3 fails exactly that way on the reverted code.
console.log('\nM-6 (same mechanism as M-3, re-confirmed):');
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      products: [
        { id: 'sku2', 'product-name': 'Certified Signature Iron Man 126 #ABC-XY', 'loose-price': 9000 },
      ],
    }),
  });
  const r = await lookupPriceCharting({ title: 'Iron Man', issue: '126', year: '1979' });
  check(r == null, 'a differently-worded signed/certified SKU is also correctly excluded');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
