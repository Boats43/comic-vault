// src/lib/listingPackage.js -- V1.1a: the seller-reviewable, evidence-grounded eBay LISTING PACKAGE.
//
// ONE pure builder shared by the preview endpoint (api/listing-preview.js) and the publish handler (api/list-ebay.js), so
// "what the seller approved" and "what is published" are the same bytes. No I/O, no pricing math, no eBay calls.
//
//   inputs  : GOVERNED catalogue facts (durable canonical row), the seller's own corrections (`listingDraft`), the asset's
//             durable media rows (id, hash, physical view), the approved asking price, eBay category metadata (or null).
//   outputs : title, condition mapping, item specifics, factual description, exact photo selection (+ missing views),
//             price + evidence-class disclosure, unresolved fields, unsupported claims, and a packageHash that binds approval.
//
// Law: describe ONLY supported facts. Never invent signatures, defects, restoration status, scarcity ratios, provenance or a
// CGC/CBCS certification. Model-observed condition is shown to the seller but NEVER published unless the seller adopts it as
// their own note. A generated package is not permission to publish: approval is a separate act bound to packageHash.

import { createHash } from 'node:crypto';
import { toBuyerSafeListingFacts, buildGovernedListingTitle, rawConditionDisclosure } from './buyerSafeListingCopy.js';
import { buildItemSpecificsFromMetadata } from './ebayListingMetadata.js';
import { targetEditionKind, readEditionSignals, EDITION_KIND } from './variantEditionAxis.js';

export const PACKAGE_VERSION = 1;
export const MAX_TITLE_LENGTH = 80;
export const MAX_PHOTOS = 12;
export const MAX_SELLER_NOTE_LENGTH = 600;

/** Views a complete physical packet would show, in publish order (FRONT is always the primary image). */
export const VIEW_ORDER = Object.freeze(['FRONT', 'BACK', 'SPINE', 'PAGES', 'DETAIL']);
export const REQUIRED_VIEWS = Object.freeze(['FRONT', 'BACK', 'SPINE', 'PAGES']);
const VIEW_LABEL = Object.freeze({ FRONT: 'Front cover', BACK: 'Back cover', SPINE: 'Spine', PAGES: 'Interior pages', DETAIL: 'Detail' });
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
};

// ───────────────────────────── unsupported-claim scanner (SELLER-SUPPLIED text only) ─────────────────────────────
// System-generated sentences are fixed and safe; the risk is a seller (or a pasted model summary) adding an assertion that
// nothing in GrailKey's evidence supports. Each rule is BLOCKING: the package cannot be approved until the text is changed.
const CLAIM_RULES = Object.freeze([
  { rule: 'certification', re: /\b(cgc|cbcs|pgx)\b|\bslabbed\b|\bcertified\b|\bcert(ificate|ification)?\s*#?\s*\d/i, why: 'Professional certification is claimed but no certification evidence exists for this copy.', skipWhen: (ctx) => ctx.isSlab },
  { rule: 'signature', re: /\b(signed|signature|autograph(ed)?|sig(nature)? series)\b/i, why: 'A signature is claimed but not part of the governed variant facts.', skipWhen: (ctx) => /signed|signature|autograph/i.test(ctx.variant) },
  { rule: 'flawless', re: /\b(flawless|perfect|pristine|immaculate|defect[- ]free|gem mint|(?<!near )mint condition|no (defects?|flaws?|creases?|tears?|stains?|wear|spine ticks?)|unread)\b/i, why: 'An absence-of-defects claim cannot be supported: unphotographed areas and interior pages are not verified.' },
  { rule: 'restoration', re: /\b(unrestored|not restored|no restoration|restoration[- ]free|restored|pressed|cleaned)\b/i, why: 'Restoration status is unknown and cannot be asserted either way.' },
  { rule: 'scarcity', re: /\b(1\s*[:/]\s*\d+|ratio|rare|scarce|limited (to|edition)|print run|only \d+ (made|exist|printed))\b/i, why: 'A scarcity / ratio claim is not in the governed variant facts.', skipWhen: (ctx, m) => ctx.variant && ctx.variant.toLowerCase().includes(String(m).toLowerCase()) },
  { rule: 'provenance', re: /\b(provenance|from the collection of|estate|pedigree|first owner|original owner|one[- ]owner)\b/i, why: 'Provenance is not recorded and cannot be asserted.' },
  { rule: 'commercial-data', re: /\b(overstreet|price guide|pricecharting|gocollect|census|market value|book value|worth \$|recent sales|sold for)\b/i, why: 'Third-party commercial pricing data may not be republished in listing copy without established rights.' },
]);

/** Scan seller-supplied text. Returns [{ where, text, rule, message }]. Pure. */
export function scanUnsupportedClaims(fields, ctx = {}) {
  const out = [];
  for (const [where, raw] of Object.entries(fields || {})) {
    const text = str(raw);
    if (!text) continue;
    for (const r of CLAIM_RULES) {
      const m = text.match(r.re);
      if (!m) continue;
      if (r.skipWhen && r.skipWhen(ctx, m[0])) continue;
      out.push({ where, text: m[0], rule: r.rule, message: r.why });
    }
  }
  return out;
}

// ───────────────────────────── title ─────────────────────────────
/** A seller title must keep the verified issue and must not contradict the confirmed edition. Returns [problem strings]. */
export function validateSellerTitle(title, facts) {
  const problems = [];
  const t = str(title);
  if (!t) return ['Title is empty.'];
  if (t.length > MAX_TITLE_LENGTH) problems.push(`Title is ${t.length} characters; eBay allows ${MAX_TITLE_LENGTH}.`);
  if (facts.issue && !new RegExp(`(^|[^0-9])#?\\s*${String(facts.issue).replace(/[^0-9A-Za-z]/g, '')}(?![0-9])`).test(t)) problems.push(`Title must keep the verified issue number (#${facts.issue}).`);
  if (facts.year && /\b(19|20)\d{2}\b/.test(t) && !t.includes(facts.year)) problems.push(`Title shows a year that differs from the verified year (${facts.year}).`);
  const kind = targetEditionKind(facts.variant);
  const s = readEditionSignals(t);
  if (kind === EDITION_KIND.COLOR_VIRGIN && (s.bw || s.tradeDress)) problems.push('Title names a different edition (B&W/sketch or trade dress) than the confirmed COLOR VIRGIN variant.');
  if (kind === EDITION_KIND.BW_SKETCH && (s.color || s.tradeDress)) problems.push('Title names a different edition than the confirmed B&W/SKETCH VIRGIN variant.');
  if (kind === EDITION_KIND.TRADE_DRESS && (s.virgin || s.bw)) problems.push('Title names a different edition than the confirmed TRADE DRESS variant.');
  return problems;
}

// ───────────────────────────── photographs ─────────────────────────────
/**
 * Exact publish selection from the asset's DURABLE media rows (never catalogue / marketplace / reference images). FRONT is the
 * primary image; unlabelled legacy rows (capture_view NULL, predating migration 0029) are used as primary only when no FRONT exists,
 * and are flagged. Nothing is manufactured: a missing view is reported missing.
 */
export function selectListingPhotos(mediaRows, { excludedMediaIds = [], selectedMediaIds = null } = {}) {
  const excluded = new Set(Array.isArray(excludedMediaIds) ? excludedMediaIds : []);
  // An explicit seller selection (non-empty list) publishes ONLY those rows; with none, every eligible durable photo is a candidate.
  const only = Array.isArray(selectedMediaIds) && selectedMediaIds.length > 0 ? new Set(selectedMediaIds) : null;
  const eligibleAll = (Array.isArray(mediaRows) ? mediaRows : []).filter((m) => m && m.contentHash
    && (m.mediaType === 'capture-photo' || m.mediaType === 'grading-photo') && IMAGE_TYPES.has(String(m.contentType || '').toLowerCase()));
  const eligible = eligibleAll.filter((m) => !only || only.has(m.mediaId));
  const considered = eligible.map((m) => ({ ...m, excluded: excluded.has(m.mediaId) }));
  const live = considered.filter((m) => !m.excluded);
  const rank = (m) => (m.captureView ? VIEW_ORDER.indexOf(m.captureView) : 99);
  const ordered = live.slice().sort((a, b) => rank(a) - rank(b));
  const hasFront = ordered.some((m) => m.captureView === 'FRONT');
  const selected = ordered.slice(0, MAX_PHOTOS).map((m, i) => ({
    mediaId: m.mediaId, contentHash: m.contentHash, contentType: m.contentType, captureView: m.captureView || null,
    viewLabel: m.captureView ? VIEW_LABEL[m.captureView] : 'Unlabelled capture photo', role: i === 0 ? 'PRIMARY' : 'ADDITIONAL',
  }));
  const selectedIds = new Set(selected.map((p) => p.mediaId));
  const present = new Set(selected.map((p) => p.captureView).filter(Boolean));
  return {
    selected,
    // Every eligible durable photograph with whether it is in the publish set (so the seller can choose; nothing is fabricated).
    candidates: eligibleAll.map((m) => ({ mediaId: m.mediaId, contentHash: m.contentHash, captureView: m.captureView || null,
      viewLabel: m.captureView ? VIEW_LABEL[m.captureView] : 'Unlabelled capture photo', selected: selectedIds.has(m.mediaId) })),
    excluded: considered.filter((m) => m.excluded).map((m) => ({ mediaId: m.mediaId, captureView: m.captureView || null })),
    missingViews: REQUIRED_VIEWS.filter((v) => !present.has(v)),
    unlabeledCount: selected.filter((p) => !p.captureView).length,
    primaryIsFront: selected[0]?.captureView === 'FRONT',
    hasFront,
  };
}

// ───────────────────────────── evidence-class disclosure (preview only; never buyer text) ─────────────────────────────
const SOLD_SOURCES = new Set(['verified_sold', 'verified_sold_recency', 'sold_active_blend_30', 'verified_sold_active_blend', 'verified_sold_stale']);
const ASK_SOURCES = new Set(['active_ask_derived', 'verified_active', 'ebay-polybag-active']);
export function describePriceEvidence(pricingSource) {
  const s = str(pricingSource);
  if (SOLD_SOURCES.has(s)) return { evidenceClass: 'VERIFIED_SOLD', disclosure: 'Priced from verified sold listings.' };
  if (ASK_SOURCES.has(s)) return { evidenceClass: 'ACTIVE_ASKS', disclosure: 'Priced from current asking prices (not sold prices).' };
  return { evidenceClass: 'OPERATOR_SET', disclosure: 'Operator-approved asking price; not derived from verified sold evidence.' };
}

// ───────────────────────────── the package ─────────────────────────────
function photoParagraph(photos) {
  const shown = photos.selected.map((p) => p.viewLabel);
  const missing = photos.missingViews.map((v) => VIEW_LABEL[v]);
  const lines = [];
  lines.push(`<p><strong>PHOTOS</strong></p>`);
  lines.push(`<p>${shown.length} photo${shown.length === 1 ? '' : 's'} of the actual book shown: ${escapeHtml(shown.join(', ') || 'none')}.</p>`);
  if (missing.length) lines.push(`<p>Not photographed: ${escapeHtml(missing.join(', '))}. Condition of areas not shown is not represented in this listing.</p>`);
  return lines;
}

/** The hash-bound, shipping-independent part of the description (the fixed shipping/returns block is appended at publish). */
function buildDescriptionBody(facts, draft, photos) {
  const lines = [];
  if (facts.title) lines.push(`<h2>${escapeHtml(facts.title)}${facts.issue ? ` #${escapeHtml(facts.issue)}` : ''}</h2>`);
  const meta = [facts.publisher, facts.year].filter(Boolean).join(' · ');
  if (meta) lines.push(`<p><strong>${escapeHtml(meta)}</strong></p>`);
  if (facts.variant) lines.push(`<p>Variant: ${escapeHtml(facts.variant)}</p>`);
  if (facts.isRaw) lines.push(`<p><strong>${escapeHtml(rawConditionDisclosure(facts))}</strong></p>`);
  else if (facts.publicGrade) lines.push(`<p>Grade: <strong>${escapeHtml(facts.publicGrade)}</strong></p>`);
  else lines.push('<p>Condition: See photos for condition details.</p>');
  const note = str(draft?.conditionNote).slice(0, MAX_SELLER_NOTE_LENGTH);
  if (note) lines.push(`<p>Seller note: ${escapeHtml(note)}</p>`);
  lines.push(...photoParagraph(photos));
  return lines.join('\n');
}

export function appendShippingAndReturns(descriptionBody, shippingDescription = 'USPS Ground Advantage') {
  return [descriptionBody,
    '<p><strong>SHIPPING</strong></p>',
    '<p>Packed in Gemini mailer with cardboard backing and top loader for protection. ' +
    `Ships within 3 business days via ${escapeHtml(shippingDescription)}. Combined shipping available.</p>`,
    '<p><strong>RETURNS</strong></p>',
    '<p>30-day returns accepted. Professional grading available.</p>'].join('\n');
}

/**
 * @param {object} a
 * @param {object} a.governed   durable canonical row attributes (governed facts)
 * @param {object} [a.draft]    seller corrections: { titleOverride, conditionNote, excludedMediaIds }
 * @param {Array}  a.media      durable media rows (listAssetMediaForListing)
 * @param {number} a.price      approved asking price (USD)
 * @param {string} [a.pricingSource]
 * @param {Map|null} a.aspectMeta  eBay aspect metadata (null = unavailable)
 * @param {object|null} a.conditionPolicy  eBay category condition policy (null = unavailable)
 */
export function buildListingPackage({ governed, draft = null, media, price, pricingSource = null, aspectMeta = null, conditionPolicy = null, isTPB = false, isMagazine = false, shippingDescription = 'USPS Ground Advantage' } = {}) {
  const d = draft && typeof draft === 'object' ? draft : {};
  const facts = toBuyerSafeListingFacts(governed);
  const unresolved = [];
  const add = (field, message, severity = 'advisory') => unresolved.push({ field, severity, message });

  // ── title ──
  const governedTitle = buildGovernedListingTitle(facts);
  let title = governedTitle; let titleSource = 'governed';
  if (str(d.titleOverride)) {
    const problems = validateSellerTitle(d.titleOverride, facts);
    if (problems.length) { for (const p of problems) add('title', p, 'blocking'); }
    title = str(d.titleOverride).replace(/\s+/g, ' ').slice(0, 200); titleSource = 'seller';
  }
  if (!facts.title) add('title', 'The governed catalogue row has no series title.', 'blocking');
  if (!facts.issue) add('issue', 'No verified issue number.', 'advisory');
  if (!facts.year) add('year', 'No verified publication year.', 'advisory');
  if (!facts.publisher) add('publisher', 'No verified publisher.', 'advisory');

  // ── condition (ungraded physical copy; never a certification) ──
  const condition = {
    publicGrade: facts.publicGrade || null, isRaw: facts.isRaw, rawConditionLabel: facts.rawConditionLabel || null,
    certification: facts.isSlab ? 'SLAB_CLAIMED_BY_OPERATOR' : 'NONE',
    ebayConditionId: null,
    mapping: conditionPolicy ? (conditionPolicy.itemConditionRequired === true ? 'REQUIRED_UNMAPPED' : 'OMITTED_CATEGORY_OPTIONAL') : 'UNAVAILABLE',
    note: conditionPolicy
      ? (conditionPolicy.itemConditionRequired === true
        ? 'This eBay category requires a condition and no governed mapping exists; a ruling is needed before publishing.'
        : 'The eBay comics category does not require an item condition, so none is sent; condition is stated in the description.')
      : 'eBay category condition policy is unavailable.',
  };
  if (!facts.publicGrade) add('condition', 'No operator-confirmed grade: the listing will say "See photos for condition details."', 'advisory');
  if (condition.mapping === 'REQUIRED_UNMAPPED') add('condition', condition.note, 'blocking');
  if (condition.mapping === 'UNAVAILABLE') add('condition', condition.note, 'blocking');

  // ── item specifics (only values proven by governed facts / eBay enums) ──
  let specifics = [];
  if (aspectMeta) specifics = buildItemSpecificsFromMetadata(facts, aspectMeta, { isTPB, isMagazine });
  else add('specifics', 'eBay item-specific metadata is unavailable, so specifics cannot be validated.', 'blocking');
  for (const need of ['Publisher', 'Series Title', 'Issue Number', 'Publication Year']) {
    if (aspectMeta && !specifics.some((s) => s.name === need)) add(`specific:${need}`, `${need} is not provable from governed facts and will be omitted.`, 'advisory');
  }

  // ── photographs ──
  const photos = selectListingPhotos(media, { excludedMediaIds: d.excludedMediaIds, selectedMediaIds: d.selectedMediaIds });
  if (photos.selected.length === 0) add('photos', 'No eligible physical photograph of this asset exists; eBay requires at least one.', 'blocking');
  else if (!photos.primaryIsFront) add('photos', photos.hasFront ? 'FRONT is excluded; the primary image is not the front cover.' : 'No photograph is labelled FRONT; the primary image is an unlabelled capture photo.', 'advisory');
  for (const v of photos.missingViews) add(`photo:${v}`, `No ${VIEW_LABEL[v].toLowerCase()} photograph exists; it will not be published and is not represented.`, 'advisory');

  // ── description ──
  const descriptionBody = buildDescriptionBody(facts, d, photos);
  const descriptionHtml = appendShippingAndReturns(descriptionBody, shippingDescription);

  // ── unsupported claims in SELLER-supplied text (+ the effective title) ──
  const unsupportedClaims = scanUnsupportedClaims(
    { title: titleSource === 'seller' ? title : '', conditionNote: d.conditionNote },
    { isSlab: facts.isSlab, variant: facts.variant },
  );
  for (const c of unsupportedClaims) add(c.where, `Unsupported claim "${c.text}" (${c.rule}): ${c.message}`, 'blocking');
  if (str(d.conditionNote).length > MAX_SELLER_NOTE_LENGTH) add('conditionNote', `Seller note is longer than ${MAX_SELLER_NOTE_LENGTH} characters and will be truncated.`, 'advisory');

  // ── price ──
  const amount = Number(price);
  const priceOk = Number.isFinite(amount) && amount > 0;
  if (!priceOk) add('price', 'No approved asking price.', 'blocking');
  const { evidenceClass, disclosure } = describePriceEvidence(pricingSource);

  const blocking = unresolved.filter((u) => u.severity === 'blocking');
  const hashInput = {
    v: PACKAGE_VERSION, title, conditionId: condition.ebayConditionId, descriptionBody,
    specifics: specifics.map((s) => [s.name, s.value]), photos: photos.selected.map((p) => p.contentHash),
    priceCents: priceOk ? Math.round(amount * 100) : null,
  };
  const packageHash = aspectMeta && conditionPolicy ? createHash('sha256').update(stable(hashInput)).digest('hex') : null;

  return {
    version: PACKAGE_VERSION, title, titleSource, governedTitle, condition, specifics, descriptionBody, descriptionHtml,
    photos, price: { amount: priceOk ? amount : null, evidenceClass, disclosure },
    unresolved, unsupportedClaims, approvable: blocking.length === 0 && !!packageHash, packageHash,
    // Display-only: what the MODEL saw. Never published unless the seller adopts it into their own note.
    modelObserved: {
      restoration: governed?.restoration ?? null, defectPenalty: governed?.defectPenalty ?? null, cgcPenaltyFlags: governed?.cgcPenaltyFlags ?? null,
      note: 'Model-observed condition is unverified and is not published unless you add it to your own note.',
    },
  };
}

/** True when the seller's stored approval still matches the package that would publish right now. */
export function isApprovalCurrent(approval, pkg) {
  return !!pkg?.packageHash && !!approval?.approvedPackageHash && approval.approvedPackageHash === pkg.packageHash && pkg.approvable === true;
}
