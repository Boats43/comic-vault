// GK-272B — display authority: contract price existence != user-facing price.
// Run: node tests/gk272b-display-authority.test.js
import fs from 'node:fs';
import { getDisplayPrice, getAuthorityPrice, getAdvisoryContractPrice, isIdentityDisplayGated } from '../src/lib/displayAuthority.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

// The exact shape the Classic Comics #13 replay produced.
const gated = () => ({
  id: 'cc13', title: '; CLASSICS ILLUSTRATED; dr Jekyll & Mr. Hyde #13, april', issue: '13',
  identityConfident: false,
  price: '$59.76', priceBands: { market: '$59.76' }, comps: { averageNum: 50 },
  decision: { action: 'RESEARCH', blockers: [], confidence: 'low' },
  contract: { price: 59.76, state: 'LOCKED', source: 'active_ask_derived',
    actionAuthority: { state: 'LOCKED', identityStanding: 'CONFLICTED', marketStanding: 'NO_SOLD_EVIDENCE', reasonCodes: ['IDENTITY_UNRESOLVED'] } },
});
const confident = () => ({ ...gated(), id: 'ok1', identityConfident: true, title: 'Amazing Spider-Man', decision: { action: 'LIST_NOW' },
  contract: { price: 59.76, state: 'PRICED', source: 'verified_sold', actionAuthority: { state: 'READY', identityStanding: 'CONFIRMED', marketStanding: 'EXACT_CURRENT', reasonCodes: [] } } });

console.log('\n— 1. the defect: gated item must not yield a user-facing price —');
const g = gated();
ok(getDisplayPrice(g) === 0, 'contract.price=59.76 + identityConfident=false + LOCKED + RESEARCH → no user-facing price (0 = existing no-display signal)');
ok(getDisplayPrice({ ...g, priceOverridden: false }) === 0, 'not reachable via the contract branch');
ok(!(getDisplayPrice(g) > 0), 'every caller that tests `> 0` treats it as no price');

console.log('\n— 2. Collection card —');
const collectionCardShowsPrice = (item) => getDisplayPrice(item) > 0;
ok(collectionCardShowsPrice(g) === false, 'gated saved item: collection card shows no price');
ok(/getDisplayPrice\(item\) > 0 && \(\s*<span className="collection-price">/.test(app), 'static: the collection-price render site is still gated on getDisplayPrice(item) > 0');

console.log('\n— 3. stats / portfolio aggregation —');
const catalogue = [gated(), confident()];
const totalValue = catalogue.reduce((s, c) => s + (getDisplayPrice(c) || 0), 0);
ok(totalValue === 59.76, `advisory price excluded from customer-visible valuation (total ${totalValue}, only the confident item counts)`);
const sorted = [...catalogue].sort((a, b) => (getDisplayPrice(b) || 0) - (getDisplayPrice(a) || 0));
ok(sorted[0].id === 'ok1', 'value sort ranks the gated item as having no value');
ok(/catalogue\.reduce\(\(s, c\) => s \+ \(getDisplayPrice\(c\) \|\| 0\), 0\)/.test(app) && /return sum \+ \(getDisplayPrice\(item\) \|\| 0\);/.test(app), 'static: portfolio totals sum getDisplayPrice (the gated helper), never raw contract.price');
ok(!/contract\.price\s*\)\s*\|\|\s*0\)\s*,\s*0\)/.test(app), 'static: no portfolio total sums raw contract.price');

console.log('\n— 4. confident identity still displays —');
ok(getDisplayPrice(confident()) === 59.76, 'identityConfident=true + valid authority: contract.price displays');
ok(getDisplayPrice({ ...confident(), identityConfident: undefined }) === 59.76, 'legacy item with no identityConfident field is not gated');
ok(getDisplayPrice({ contract: { price: 12 } }) === 12, 'item with a contract and no identity flag still displays');

console.log('\n— 5. ResultCard behavior unchanged —');
ok(/const identityGated = result\.identityConfident === false;/.test(app), 'ResultCard identityGated definition unchanged');
ok(/\{!identityGated && !isMegaKeyDivergent && recommendedLabel && \(/.test(app), 'ResultCard Recommended-price gate unchanged');
ok(isIdentityDisplayGated({ identityConfident: false }) && !isIdentityDisplayGated({ identityConfident: true }) && !isIdentityDisplayGated({}), 'one shared gate predicate matches ResultCard\'s own condition');

console.log('\n— 6. pricing math / contract untouched —');
const before = JSON.stringify(g);
getDisplayPrice(g); getAdvisoryContractPrice(g);
ok(JSON.stringify(g) === before, 'helpers do not mutate the item');
ok(g.contract.price === 59.76 && getAdvisoryContractPrice(g) === 59.76, 'internal contract.price remains 59.76 and is explicitly accessible as advisory context');
ok(getAdvisoryContractPrice({}) === null, 'no contract → advisory price is null (not 0)');

console.log('\n— existing display semantics preserved —');
ok(getDisplayPrice({ identityConfident: false, price: '$40', priceBands: { market: '$40' } }) === 0, 'legacy no-contract gated item still 0');
ok(getDisplayPrice({ identityConfident: false, priceOverridden: true, price: '$40', contract: { price: 59.76 } }) === 0, 'operator-overridden price on a gated identity: unchanged legacy behavior (0)');
ok(getDisplayPrice({ identityConfident: true, priceOverridden: true, price: '$40', contract: { price: 59.76 } }) === 40, 'confident + Q41 override: the operator number still wins');
ok(getDisplayPrice(null) === 0 && getDisplayPrice(undefined) === 0, 'null item → 0');
ok(!/^const getDisplayPrice = /m.test(app) && /from "\.\/lib\/displayAuthority\.js"/.test(app), 'App.jsx imports the extracted helper (no second copy)');

console.log('\n— direct contract.price readers (bypassed getDisplayPrice) are under the same law —');
ok(getAuthorityPrice(g) === 0, 'getAuthorityPrice: gated item does not pre-fill the editable list price with the advisory price');
ok(getAuthorityPrice(confident()) === 59.76, 'getAuthorityPrice: confident item still pre-fills');
ok(/const recommendedLabel = identityGatedItem\s*\?\s*"—"/.test(app), 'static: CollectionDetail recommendedLabel is "—" for a gated item');
ok(/\{!isIdentityDisplayGated\(item\) && \(item\.contract \? item\.contract\.price != null/.test(app), 'static: DecisionPanel hero price is gated');
ok(/getAuthorityPrice/.test(app) && !/^const getAuthorityPrice = /m.test(app), 'static: App.jsx uses the single extracted getAuthorityPrice');
const detailRecommended = (item) => (isIdentityDisplayGated(item) ? '—' : item.contract ? (item.contract.price != null ? `$${item.contract.price}` : '—') : '—');
ok(detailRecommended(g) === '—' && detailRecommended(confident()) === '$59.76', 'CollectionDetail label logic: gated → "—", confident → price');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
