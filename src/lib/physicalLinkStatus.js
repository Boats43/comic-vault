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
