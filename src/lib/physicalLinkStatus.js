// Physical-asset link status for the LISTING affordance.
//
// A Collection row is a catalogue record. A stored recommendation (LIST_NOW / LIST_LOW) or a stored `contract.listable` is a client-writable, historical
// statement: it is information, never execution authority. Executing a listing requires a physical asset that the SERVER has linked to this row for the
// authenticated principal. The only provenance this module accepts is the existing authenticated read `GET /api/assets?collectionItemId=<id>`:
//   200 + { asset: { asset: { id } } }  -> LINKED       (server resolved an owner-scoped link)
//   404                                  -> NOT_LINKED   (the server answers 404 identically for "no link", "not yours" and "no such row"; for the listing
//                                                         control all three mean the same thing: no executable link for this principal)
//   401 / no session                     -> UNAUTHENTICATED
//   anything else (network, 5xx)         -> UNAVAILABLE  (fail closed, with its own honest label -- never reported as "not linked")
// There is NO client-authored substitute: nothing on the item (gkAssetId, contract, decision) can make a row LINKED.

export const LINK_STATE = Object.freeze({
  CHECKING: 'CHECKING',
  LINKED: 'LINKED',
  NOT_LINKED: 'NOT_LINKED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
});

export const NOT_LINKED_LABEL = 'Not linked to a physical asset — capture it first.';

/** Pure: the listing control's gate for a link state. `blocked` is true for every state except LINKED (fail closed). */
export function listingLinkGate(linkState) {
  switch (linkState) {
    case LINK_STATE.LINKED: return { blocked: false, label: null };
    case LINK_STATE.NOT_LINKED: return { blocked: true, label: NOT_LINKED_LABEL };
    case LINK_STATE.UNAUTHENTICATED: return { blocked: true, label: 'Sign in to verify the physical-asset link before listing.' };
    case LINK_STATE.UNAVAILABLE: return { blocked: true, label: 'Physical-asset link status unavailable — retry.' };
    default: return { blocked: true, label: 'Checking physical-asset link…' };
  }
}

/** Resolve the state from the existing authenticated read. `authFetch` is injected (src/lib/grailkeySession.js's authFetch in the app). */
export async function fetchPhysicalLinkStatus({ itemId, authFetch }) {
  if (!itemId || typeof authFetch !== 'function') return { state: LINK_STATE.UNAVAILABLE };
  let res;
  try {
    res = await authFetch(`/api/assets?collectionItemId=${encodeURIComponent(itemId)}`);
  } catch {
    return { state: LINK_STATE.UNAVAILABLE };
  }
  if (!res) return { state: LINK_STATE.UNAUTHENTICATED };
  if (res.status === 401) return { state: LINK_STATE.UNAUTHENTICATED };
  if (res.status === 404) return { state: LINK_STATE.NOT_LINKED };
  if (!res.ok) return { state: LINK_STATE.UNAVAILABLE };
  const body = await res.json().catch(() => null);
  const gkAssetId = body?.asset?.asset?.id;
  return gkAssetId ? { state: LINK_STATE.LINKED, gkAssetId } : { state: LINK_STATE.NOT_LINKED };
}

// Per-session memory of the last server answer, keyed by Collection row id, so the control renders the right state immediately on re-render.
// Populated ONLY from fetchPhysicalLinkStatus results (the effect in CollectionDetail) -- plus the explicit test seam below.
const known = new Map();
export const rememberLinkState = (itemId, state) => { if (itemId) known.set(itemId, state); };
export const recallLinkState = (itemId) => (itemId && known.has(itemId) ? known.get(itemId) : LINK_STATE.CHECKING);
export const forgetLinkStates = () => known.clear();   // logout / principal switch
/** TEST SEAM ONLY: lets a server-side render (no effects run) start from a given server answer. Never called by application code. */
export const __seedLinkStateForTests = rememberLinkState;

// ── Execution surfaces other than the single-card button: "Post All Listable" and the chat "Quick List" actions ──
// Per-item eligibility, verified at EXECUTION time against the server (a cached LINKED is never enough to fire a publish), and fail closed for every state but LINKED.
// The server (api/list-ebay.js) remains the final enforcement authority; this only stops doomed or unauthorised attempts from being built client-side.

/** Re-verifies ONE item with the server, then (only if LINKED) runs `onList(item)`. Throws a labelled PHYSICAL_ASSET_LINK_REQUIRED error otherwise; onList is never called. */
export async function listWithLinkCheck({ item, authFetch, onList }) {
  const r = await fetchPhysicalLinkStatus({ itemId: item?.id, authFetch });
  if (item?.id) rememberLinkState(item.id, r.state);
  const gate = listingLinkGate(r.state);
  if (gate.blocked) {
    const e = new Error(gate.label);
    e.code = 'PHYSICAL_ASSET_LINK_REQUIRED';
    e.linkState = r.state;
    throw e;
  }
  return onList(item);
}

/**
 * The Post All loop. Strictly sequential (the pause between publishes is preserved); EVERY item is link-checked individually right before its own publish, so a
 * mixed batch publishes the linked items and reports the others as blocked with their own honest reason -- one blocked item never aborts or unblocks another.
 * `onProgress(id, { state: 'posting'|'success'|'error', msg?, linkState? })`. `sleep` is injectable for tests.
 */
export async function runBulkListing({ items, authFetch, onList, onProgress = () => {}, delayMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    onProgress(it.id, { state: 'posting', msg: null });
    try {
      await listWithLinkCheck({ item: it, authFetch, onList });
      results.push({ id: it.id, state: 'success' });
      onProgress(it.id, { state: 'success' });
    } catch (err) {
      const blocked = err?.code === 'PHYSICAL_ASSET_LINK_REQUIRED';
      results.push({ id: it.id, state: 'error', blocked, linkState: err?.linkState });
      onProgress(it.id, { state: 'error', msg: err?.message || 'failed', linkState: err?.linkState });
    }
    if (i < items.length - 1) await sleep(delayMs);
  }
  return results;
}

/** Resolves link states for many items with bounded concurrency; results are remembered. Never throws (each item fails closed on its own). */
export async function resolveLinkStates({ items, authFetch, concurrency = 4 }) {
  const out = {};
  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      const r = await fetchPhysicalLinkStatus({ itemId: it?.id, authFetch });
      if (it?.id) { rememberLinkState(it.id, r.state); out[it.id] = r.state; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
