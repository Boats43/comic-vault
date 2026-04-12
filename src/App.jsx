import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllComics,
  putComic,
  deleteComic,
  migrateFromLocalStorage,
  putSnapshot,
  getAllSnapshots,
  getAnalysis,
  putAnalysis,
} from "./db.js";

const LOADING_STEPS = [
  "Reading cover...",
  "Identifying issue...",
  "Checking grade...",
  "Pricing...",
];

const parsePrice = (p) => {
  if (p == null) return null;
  const m = String(p).replace(/,/g, "").match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

const fmt = (n) =>
  n == null || isNaN(n)
    ? "—"
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// Format a price dropping trailing .00 so "$22.00" becomes "$22".
const fmtPrice = (n) => {
  if (n == null || isNaN(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded)
    ? `$${rounded.toLocaleString("en-US")}`
    : `$${rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Format a sale timestamp as "X hours ago" same-day, "yesterday", "N days
// ago", or a calendar date for older items. Browse API (active listings)
// has no end date yet, so those rows show "Active".
const fmtSaleWhen = (iso, daysAgo) => {
  if (!iso && daysAgo == null) return "Active";
  if (iso) {
    const then = new Date(iso).getTime();
    if (!isNaN(then)) {
      const diffMs = Date.now() - then;
      if (diffMs < 86400000 && diffMs >= 0) {
        const hours = Math.max(1, Math.round(diffMs / 3600000));
        return `${hours} hour${hours === 1 ? "" : "s"} ago`;
      }
    }
  }
  if (daysAgo === 1) return "yesterday";
  if (daysAgo != null) return `${daysAgo} days ago`;
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
    }
  }
  return "—";
};

const marketValueOf = (r) => {
  if (!r) return null;
  const p = parsePrice(r.price);
  if (p != null) return p;
  const lo = parsePrice(r.priceLow);
  const hi = parsePrice(r.priceHigh);
  if (lo != null && hi != null) return (lo + hi) / 2;
  return lo ?? hi ?? null;
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// Downscale an image data URL to a JPEG thumbnail for localStorage storage.
// Keeps cover thumbs ~20-50KB each so the catalogue doesn't blow the 5MB quota.
const makeThumbnail = (dataUrl, maxDim = 1000, quality = 0.85) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

// Return an array of photo data URLs for a comic, supporting both the
// legacy single `image` field and the new `images` array. Used by
// CollectionList, CollectionDetail, and the list-to-eBay flow so either
// storage shape works.
const getComicPhotos = (comic) => {
  if (!comic) return [];
  if (Array.isArray(comic.images) && comic.images.length > 0) {
    return comic.images.filter(Boolean);
  }
  if (comic.image) return [comic.image];
  return [];
};

// Keyword set used to flag condition-concern sentences in Claude's reason
// field. Deliberately loose — matches "wear", "creases", "tanning", etc.
const CONDITION_KEYWORDS =
  /\b(wear|stress|crease|fold|tear|soil|tann|scratch|blunt|dent|missing|soiling|handling|edge|corner)/i;

// Split Claude's reason into sentences and classify each as a concern
// (condition issue ⚠️) or positive (✅) bullet for the condition report.
const parseConditionReport = (reason) => {
  if (!reason) return [];
  return String(reason)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({ text, concern: CONDITION_KEYWORDS.test(text) }));
};

// Normalize Claude's confidence field for display. Claude returns
// "High" / "Medium" / "85" / "85%" / "High (90%)" inconsistently.
const formatConfidence = (confidence) => {
  if (!confidence) return null;
  const s = String(confidence).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return `${s}%`;
  return s;
};

function ScanZone({ onFile, onGalleryFiles, inputRef, compact, label }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const handleGalleryChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (galleryRef.current) galleryRef.current.value = "";
    if (files.length === 0) return;
    if (files.length === 1) {
      // Single file — use the normal onFile path
      onFile({ target: { files: [files[0]] } });
    } else if (onGalleryFiles) {
      onGalleryFiles(files);
    } else {
      onFile({ target: { files: [files[0]] } });
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        className={`upload-zone${compact ? " compact" : ""}`}
        onClick={() => cameraRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && cameraRef.current?.click()}
      >
        <div className="upload-emoji">📷</div>
        <div className="upload-text">{label}</div>
      </div>

      {/* Gallery shortcut — bottom-right corner */}
      <button
        onClick={(e) => { e.stopPropagation(); galleryRef.current?.click(); }}
        aria-label="Choose from gallery"
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "rgba(212,175,55,0.15)",
          border: "1px solid rgba(212,175,55,0.3)",
          color: "#d4af37",
          fontSize: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
        }}
      >
        🖼
      </button>

      {/* Hidden file inputs */}
      <input
        ref={(el) => { cameraRef.current = el; if (inputRef) inputRef.current = el; }}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        hidden
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleGalleryChange}
        hidden
      />
    </div>
  );
}

function ResultCard({ result, enriching }) {
  const comps = result.comps;
  const hasComps =
    comps &&
    Array.isArray(comps.recentSales) &&
    comps.recentSales.length > 0;
  const avgNum = hasComps ? comps.averageNum : null;
  const recommendedNum =
    avgNum != null ? Math.round(avgNum * 1.15) : null;
  const recommendedLabel =
    recommendedNum != null
      ? `$${recommendedNum.toLocaleString("en-US")}`
      : result.price;
  const sourceLabel = hasComps
    ? `Source: ${comps.count} eBay sale${comps.count === 1 ? "" : "s"}`
    : "Source: AI estimate";

  return (
    <div className="result-card">
      {result.image && (
        <img
          src={result.image}
          alt=""
          loading="lazy"
          className="result-image"
          style={{
            width: "100%",
            maxHeight: 360,
            objectFit: "contain",
            borderRadius: 8,
            marginBottom: 12,
          }}
        />
      )}
      <div className="title">{result.title}</div>
      <div className="muted small">
        {result.publisher}
        {result.publisher && result.year ? " · " : ""}
        {result.year}
      </div>
      {result.noImage && (
        <div className="muted small" style={{ fontStyle: "italic" }}>
          No cover photo — rescan for image
        </div>
      )}
      {result.grade && <div className="grade-badge">CGC {result.grade}</div>}
      {result.census && result.census.countAtGrade != null && (
        <div className="muted small" style={{ marginTop: 4 }}>
          {result.census.countAtGrade.toLocaleString()} copies graded at this level
          {result.census.totalGraded
            ? ` · ${result.census.totalGraded.toLocaleString()} total${
                result.census.rarityPercent != null
                  ? ` (${result.census.rarityPercent}%)`
                  : ""
              }`
            : ""}
        </div>
      )}
      {result.keyIssue && <div className="key-box">⭐ {result.keyIssue}</div>}
      {recommendedLabel && (
        <>
          <div className="muted small" style={{ marginTop: 12 }}>
            Recommended list price
          </div>
          <div className="price">{recommendedLabel}</div>
          {hasComps && (
            <div className="muted small">
              Based on {comps.count} eBay sale{comps.count === 1 ? "" : "s"} in last 30 days
            </div>
          )}
          <div className="muted small" style={{ marginTop: 4, fontStyle: "italic" }}>
            {sourceLabel}
          </div>
        </>
      )}

      {!hasComps && enriching && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 8,
            background: "rgba(212,175,55,0.05)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              border: "2px solid rgba(212,175,55,0.3)",
              borderTopColor: "#d4af37",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span className="muted small">Loading market data…</span>
        </div>
      )}

      {!hasComps && !enriching && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(245,158,11,0.5)",
            borderRadius: 8,
            background: "rgba(245,158,11,0.1)",
            color: "#f59e0b",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠ No recent eBay sales found for this book
          </div>
          <div className="small" style={{ marginBottom: 4 }}>
            Price estimated from AI market knowledge
          </div>
          <div className="small" style={{ marginBottom: 8 }}>
            Verify on eBay before listing
          </div>
          {(result.priceLow || result.priceHigh) && (
            <div style={{ fontWeight: 600 }}>
              AI range: {result.priceLow}
              {result.priceLow && result.priceHigh ? " – " : ""}
              {result.priceHigh}
            </div>
          )}
        </div>
      )}

      {hasComps && (
        <div
          className="comps-breakdown"
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 8,
            background: "rgba(212,175,55,0.05)",
          }}
        >
          {Array.isArray(comps.recentSales) && comps.recentSales.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                className="muted small"
                style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
              >
                Recent eBay listings
              </div>
              {comps.recentSales.slice(0, 3).map((s, i) => {
                const row = (
                  <>
                    <span className="muted small">
                      {fmtSaleWhen(s.date, s.daysAgo)}
                    </span>
                    <span style={{ fontWeight: 600, color: "#d4af37" }}>
                      {fmtPrice(s.price)}
                      {s.itemWebUrl ? (
                        <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>
                      ) : null}
                    </span>
                  </>
                );
                const rowStyle = {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 0",
                  fontSize: 14,
                };
                return s.itemWebUrl ? (
                  <a
                    key={i}
                    href={s.itemWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}
                  >
                    {row}
                  </a>
                ) : (
                  <div key={i} style={rowStyle}>
                    {row}
                  </div>
                );
              })}
            </div>
          )}

          <div
            style={{
              borderTop: "1px solid rgba(212,175,55,0.25)",
              margin: "8px 0",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 14,
            }}
          >
            <span className="muted small">30-day average</span>
            <span style={{ fontWeight: 600 }}>
              {fmtPrice(comps.averageNum)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 14,
            }}
          >
            <span className="muted small">Recommended</span>
            <span style={{ fontWeight: 700, color: "#d4af37" }}>
              {recommendedLabel}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 14,
            }}
          >
            <span className="muted small">Floor</span>
            <span style={{ fontWeight: 600, color: "#e05656" }}>
              {fmtPrice(comps.lowestNum)}
            </span>
          </div>
          {comps.fellBack && (
            <div className="muted small" style={{ marginTop: 6 }}>
              (raw copy comps)
            </div>
          )}
          <div
            className="muted small"
            style={{ marginTop: 8, fontStyle: "italic" }}
          >
            Source: Browse API — active listings
          </div>
        </div>
      )}

      {result.reason && <div className="reason muted small">{result.reason}</div>}
    </div>
  );
}

function WidgetOverlay({
  loading,
  step,
  result,
  enriching,
  error,
  onDismiss,
  onSave,
  onListEbay,
}) {
  const [bid, setBid] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listing, setListing] = useState(false);
  const [saved, setSaved] = useState(false);

  const detectedPrice = result?.detectedPrice;
  useEffect(() => {
    if (detectedPrice && !seeded) {
      const cleaned = String(detectedPrice).replace(/[^0-9.]/g, "");
      if (cleaned && parseFloat(cleaned) > 0) {
        setBid(cleaned);
        setSeeded(true);
      }
    }
  }, [detectedPrice, seeded]);

  const bidNum = parseFloat(bid);
  const hasBid = !isNaN(bidNum) && bidNum > 0;
  const marketValue = marketValueOf(result);

  const comps = result?.comps;
  const hasComps =
    comps && Array.isArray(comps.recentSales) && comps.recentSales.length > 0;
  const avgNum = hasComps ? comps.averageNum : null;
  const lowestNum = hasComps ? comps.lowestNum : null;
  const highestNum = hasComps
    ? Math.max(...comps.recentSales.map((s) => s.price).filter(Boolean))
    : null;

  const max20 = marketValue != null ? marketValue * 0.8 : null;
  const max30 = marketValue != null ? marketValue * 0.7 : null;

  let rating = null;
  if (hasBid && marketValue) {
    if (bidNum <= max30) rating = { label: "STRONG BUY", bg: "#16a34a", color: "#fff" };
    else if (bidNum <= max20) rating = { label: "FAIR", bg: "#d4af37", color: "#0a0a0a" };
    else rating = { label: "OVERPRICED", bg: "#dc2626", color: "#fff" };
  }

  const recommendedNum = avgNum != null ? Math.round(avgNum * 1.15) : null;
  const recommendedLabel =
    recommendedNum != null
      ? `$${recommendedNum.toLocaleString("en-US")}`
      : result?.price || "—";

  const gradeBadge =
    result?.isGraded === true && result?.numericGrade != null
      ? `CGC ${result.numericGrade}`
      : "RAW COPY";

  const handleSave = async () => {
    if (!result || saving) return;
    setSaving(true);
    try {
      await onSave(result, result.image);
      setSaved(true);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleList = async () => {
    if (!result || listing) return;
    setListing(true);
    try {
      await onListEbay(result);
    } catch {
      /* ignore */
    } finally {
      setListing(false);
    }
  };

  const s = {
    overlay: {
      position: "fixed",
      inset: 0,
      background: "#0a0a0a",
      zIndex: 5000,
      display: "flex",
      flexDirection: "column",
      overflow: "auto",
      WebkitOverflowScrolling: "touch",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 16px 8px",
      flexShrink: 0,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: 700,
      color: "#d4af37",
    },
    closeBtn: {
      background: "transparent",
      border: "none",
      color: "#999",
      fontSize: 22,
      cursor: "pointer",
      padding: "4px 8px",
      lineHeight: 1,
    },
    body: {
      flex: 1,
      padding: "0 16px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    },
    idRow: {
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
    },
    thumb: {
      width: 80,
      height: 110,
      objectFit: "cover",
      borderRadius: 8,
      border: "1px solid rgba(212,175,55,0.3)",
      flexShrink: 0,
      background: "#1a1a1a",
    },
    idMeta: {
      flex: 1,
      minWidth: 0,
    },
    goldBox: {
      border: "1px solid rgba(212,175,55,0.4)",
      borderRadius: 10,
      padding: 12,
      background: "rgba(212,175,55,0.05)",
    },
    row: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "5px 0",
      fontSize: 14,
    },
    divider: {
      borderTop: "1px solid rgba(212,175,55,0.2)",
      margin: "6px 0",
    },
    inputWrap: {
      display: "flex",
      alignItems: "center",
      background: "rgba(255,255,255,0.08)",
      borderRadius: 8,
      padding: "0 10px",
      flex: 1,
    },
    input: {
      background: "transparent",
      border: "none",
      color: "#fff",
      fontSize: 16,
      fontWeight: 700,
      width: "100%",
      padding: "8px 4px",
      outline: "none",
    },
    ratingBar: {
      borderRadius: 10,
      padding: "14px 16px",
      textAlign: "center",
      fontWeight: 800,
      fontSize: 20,
      letterSpacing: 1,
    },
    actionRow: {
      display: "flex",
      gap: 10,
      flexShrink: 0,
    },
    btnOutline: {
      flex: 1,
      padding: "14px 8px",
      background: "transparent",
      color: "#d4af37",
      border: "1px solid rgba(212,175,55,0.5)",
      borderRadius: 10,
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
    },
    btnGold: {
      flex: 1,
      padding: "14px 8px",
      background: "linear-gradient(135deg, #d4af37, #b8941f)",
      color: "#0a0a0a",
      border: "none",
      borderRadius: 10,
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
    },
  };

  return (
    <div style={s.overlay}>
      {/* HEADER */}
      <div style={s.header}>
        <span style={s.headerTitle}>Comic Vault</span>
        <button style={s.closeBtn} onClick={onDismiss} aria-label="Close">✕</button>
      </div>

      <div style={s.body}>
        {/* LOADING STATE */}
        {loading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                border: "3px solid rgba(212,175,55,0.3)",
                borderTopColor: "#d4af37",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ color: "#d4af37", fontSize: 16, fontWeight: 600 }}>
              {LOADING_STEPS[step]}
            </div>
          </div>
        )}

        {/* ERROR STATE */}
        {error && !loading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <div style={{ color: "#dc2626", fontSize: 16 }}>{error}</div>
            <button style={s.btnOutline} onClick={onDismiss}>Close</button>
          </div>
        )}

        {/* RESULT */}
        {result && !loading && (
          <>
            {/* Section 1 — IDENTIFICATION */}
            <div style={s.idRow}>
              {result.image ? (
                <img src={result.image} alt="" style={s.thumb} />
              ) : (
                <div style={{ ...s.thumb, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>📘</div>
              )}
              <div style={s.idMeta}>
                <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>
                  {result.title || "Unknown"}
                </div>
                <div className="muted small" style={{ marginTop: 3 }}>
                  {result.publisher}
                  {result.publisher && result.year ? " · " : ""}
                  {result.year}
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className="grade-badge" style={{ fontSize: 11, padding: "3px 8px" }}>
                    {gradeBadge}
                  </span>
                </div>
                {result.keyIssue && result.keyIssue !== "N/A" && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: "#d4af37",
                      fontWeight: 600,
                    }}
                  >
                    ⭐ {result.keyIssue}
                  </div>
                )}
              </div>
            </div>

            {/* Section 2 — PRICE INTEL */}
            <div style={s.goldBox}>
              <div style={s.row}>
                <span className="muted small">Current bid</span>
                <div style={s.inputWrap}>
                  <span style={{ color: "#d4af37", fontWeight: 700, fontSize: 16 }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={bid}
                    onChange={(e) => setBid(e.target.value)}
                    style={s.input}
                  />
                </div>
              </div>
              <div style={s.divider} />
              {hasComps && lowestNum != null && highestNum != null && (
                <div style={s.row}>
                  <span className="muted small">Active range</span>
                  <span style={{ fontWeight: 600, color: "#d4af37" }}>
                    {fmtPrice(lowestNum)} – {fmtPrice(highestNum)}
                  </span>
                </div>
              )}
              {avgNum != null && (
                <div style={s.row}>
                  <span className="muted small">30-day avg</span>
                  <span style={{ fontWeight: 600 }}>{fmtPrice(avgNum)}</span>
                </div>
              )}
              {!hasComps && (result.price || result.priceLow) && (
                <div style={s.row}>
                  <span className="muted small">AI estimate</span>
                  <span style={{ fontWeight: 600 }}>
                    {result.priceLow && result.priceHigh
                      ? `${result.priceLow} – ${result.priceHigh}`
                      : result.price || "—"}
                  </span>
                </div>
              )}
              {enriching && !hasComps && (
                <div style={{ ...s.row, justifyContent: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: "2px solid rgba(212,175,55,0.3)",
                      borderTopColor: "#d4af37",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                    }}
                  />
                  <span className="muted small">Loading market data…</span>
                </div>
              )}
              <div style={s.divider} />
              <div style={s.row}>
                <span className="muted small">Max bid · 20%</span>
                <span style={{ fontWeight: 700, color: "#d4af37" }}>{fmt(max20)}</span>
              </div>
              <div style={s.row}>
                <span className="muted small">Max bid · 30%</span>
                <span style={{ fontWeight: 700, color: "#d4af37" }}>{fmt(max30)}</span>
              </div>
            </div>

            {/* Section 3 — RATING BAR */}
            {rating ? (
              <div
                style={{
                  ...s.ratingBar,
                  background: rating.bg,
                  color: rating.color,
                }}
              >
                {rating.label === "STRONG BUY" && "⚡ "}
                {rating.label}
              </div>
            ) : (
              <div
                style={{
                  ...s.ratingBar,
                  background: "rgba(255,255,255,0.08)",
                  color: "#666",
                }}
              >
                {marketValue == null ? "Loading pricing…" : "Enter bid above"}
              </div>
            )}

            {/* Section 4 — ACTIONS */}
            <div style={s.actionRow}>
              <button
                style={s.btnOutline}
                onClick={handleSave}
                disabled={saving || saved}
              >
                {saved ? "✓ Saved" : saving ? "Saving…" : "Save to Collection"}
              </button>
              <button
                style={s.btnGold}
                onClick={handleList}
                disabled={listing}
              >
                {listing
                  ? "Listing…"
                  : `List on eBay — ${recommendedLabel}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BidCalculator({ marketValue, detectedPrice }) {
  const [bid, setBid] = useState("");
  const [seeded, setSeeded] = useState(false);

  // Auto-fill bid from detectedPrice once
  useEffect(() => {
    if (detectedPrice && !seeded) {
      const cleaned = String(detectedPrice).replace(/[^0-9.]/g, "");
      if (cleaned && parseFloat(cleaned) > 0) {
        setBid(cleaned);
        setSeeded(true);
      }
    }
  }, [detectedPrice, seeded]);

  const bidNum = parseFloat(bid);
  const hasBid = !isNaN(bidNum) && bidNum > 0;

  const max20 = marketValue != null ? marketValue * 0.8 : null;
  const max30 = marketValue != null ? marketValue * 0.7 : null;

  let rating = null;
  if (hasBid && marketValue) {
    if (bidNum <= max30) rating = { label: "STRONG BUY", cls: "rating-strong" };
    else if (bidNum <= max20) rating = { label: "FAIR", cls: "rating-fair" };
    else rating = { label: "OVERPRICED", cls: "rating-bad" };
  }

  const pctBelow =
    hasBid && marketValue
      ? Math.round(((marketValue - bidNum) / marketValue) * 100)
      : null;

  return (
    <div className="calc-card">
      <div className="calc-row">
        <span className="muted small">Market Value</span>
        <span className="calc-mv">{fmt(marketValue)}</span>
      </div>

      <label className="calc-label">Current starting bid</label>
      <div className="calc-input-wrap">
        <span className="calc-dollar">$</span>
        <input
          type="number"
          inputMode="decimal"
          placeholder="0"
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          className="calc-input"
        />
      </div>

      {marketValue != null && (
        <>
          <div className="calc-row">
            <span className="muted small">Max bid · 20% margin</span>
            <span className="calc-max">{fmt(max20)}</span>
          </div>
          <div className="calc-row">
            <span className="muted small">Max bid · 30% margin</span>
            <span className="calc-max">{fmt(max30)}</span>
          </div>
        </>
      )}

      {rating && (
        <div className={`deal-rating ${rating.cls}`}>
          {rating.label === "STRONG BUY" && "⚡ "}
          {rating.label}
          {pctBelow != null && pctBelow > 0 && (
            <div className="deal-sub">Current ask is {pctBelow}% below market</div>
          )}
          {pctBelow != null && pctBelow <= 0 && (
            <div className="deal-sub">
              Current ask is {Math.abs(pctBelow)}% above market
            </div>
          )}
        </div>
      )}

      {marketValue == null && (
        <div className="muted small">Scan a comic above to get a market value.</div>
      )}
    </div>
  );
}

function CollectionList({ items, totalValue, onOpen, onDelete }) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="upload-emoji">📚</div>
        <div className="muted">No comics in your collection yet.</div>
        <div className="muted small">Scanned comics will appear here.</div>
      </div>
    );
  }

  return (
    <>
      <div className="stats-row">
        <div className="stat">
          <div className="stat-value">{items.length}</div>
          <div className="stat-label">Comics</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmt(totalValue)}</div>
          <div className="stat-label">Est. Value</div>
        </div>
      </div>

      <div className="collection-list">
        {items.map((item) => {
          const thumbSrc = getComicPhotos(item)[0] || null;
          return (
          <div key={item.id} className="collection-item" onClick={() => onOpen(item)}>
            {thumbSrc ? (
              <img src={thumbSrc} alt="" loading="lazy" className="thumb" />
            ) : (
              <div className="thumb thumb-placeholder">📘</div>
            )}
            <div className="collection-meta">
              <div className="collection-title">{item.title || "Unknown"}</div>
              <div className="muted small">
                {item.publisher}
                {item.publisher && item.year ? " · " : ""}
                {item.year}
              </div>
              <div className="collection-row">
                {item.grade && <span className="grade-badge sm">CGC {item.grade}</span>}
                {item.keyIssue && <span className="key-flag">⭐</span>}
                {item.status === "listed" && <span className="listed-badge">Listed</span>}
                {item.price && <span className="collection-price">{item.price}</span>}
              </div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${item.title || "this comic"}"?`)) onDelete(item.id);
              }}
              aria-label="Delete"
            >
              ✕
            </button>
          </div>
          );
        })}
      </div>
    </>
  );
}

function CollectionDetail({
  item,
  onBack,
  onDelete,
  onList,
  onRefreshMarket,
  onAddPhoto,
}) {
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [addPhotoError, setAddPhotoError] = useState(null);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const addPhotoRef = useRef(null);

  const photos = getComicPhotos(item);
  const canAddMore = photos.length < 4;
  const isListed = item.status === "listed" && item.ebayUrl;

  // Pricing: prefer stored comps, fall back to the flat grade fields.
  const hasComps =
    item.comps &&
    Array.isArray(item.comps.recentSales) &&
    item.comps.recentSales.length > 0;
  const avgNum = hasComps ? item.comps.averageNum : null;
  const recommendedNum = avgNum != null ? Math.round(avgNum * 1.15) : null;
  const parsedFallback = parsePrice(item.price);
  const recommendedLabel =
    recommendedNum != null
      ? `$${recommendedNum.toLocaleString("en-US")}`
      : parsedFallback != null
      ? `$${Math.round(parsedFallback).toLocaleString("en-US")}`
      : item.price || "—";

  // Grade badge: CGC numeric if graded, RAW COPY otherwise.
  const gradeBadgeText =
    item.isGraded === true && item.numericGrade != null
      ? `CGC ${item.numericGrade}`
      : "RAW COPY";

  const conditionBullets = parseConditionReport(item.reason);
  const confidenceText = formatConfidence(item.confidence);
  const scannedText = item.timestamp
    ? new Date(item.timestamp).toLocaleString()
    : null;

  const handleList = async () => {
    setListing(true);
    setListError(null);
    try {
      await onList(item);
    } catch (err) {
      setListError(err.message || "Failed to list");
    } finally {
      setListing(false);
    }
  };

  const handleRefresh = async () => {
    if (!onRefreshMarket) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefreshMarket(item);
    } catch (err) {
      setRefreshError(err.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddPhotoClick = () => {
    if (!canAddMore || addingPhoto) return;
    addPhotoRef.current?.click();
  };

  const handleAddPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (addPhotoRef.current) addPhotoRef.current.value = "";
    if (!file || !onAddPhoto) return;
    setAddingPhoto(true);
    setAddPhotoError(null);
    try {
      await onAddPhoto(item, file);
    } catch (err) {
      setAddPhotoError(err.message || "Failed to add photo");
    } finally {
      setAddingPhoto(false);
    }
  };

  return (
    <div className="detail-view">
      <button className="back-btn" onClick={onBack}>← Back</button>

      {/* 1. PHOTO STRIP */}
      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          padding: "4px 0 12px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {photos.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            onClick={() => setExpandedPhoto(src)}
            style={{
              height: 120,
              width: "auto",
              flexShrink: 0,
              borderRadius: 8,
              objectFit: "cover",
              cursor: "pointer",
              border: "1px solid rgba(212,175,55,0.3)",
            }}
          />
        ))}
        {canAddMore && (
          <button
            onClick={handleAddPhotoClick}
            disabled={addingPhoto}
            style={{
              height: 120,
              minWidth: 100,
              flexShrink: 0,
              border: "2px dashed rgba(212,175,55,0.5)",
              borderRadius: 8,
              background: "transparent",
              color: "#d4af37",
              fontSize: 13,
              fontWeight: 600,
              cursor: addingPhoto ? "wait" : "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: 8,
            }}
          >
            {addingPhoto ? (
              <>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    border: "2px solid rgba(212,175,55,0.3)",
                    borderTopColor: "#d4af37",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                <span>Analyzing…</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 24, lineHeight: 1 }}>+</span>
                <span>Add Photo</span>
              </>
            )}
          </button>
        )}
        <input
          ref={addPhotoRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleAddPhotoChange}
          hidden
        />
      </div>
      {addPhotoError && (
        <div className="error-text small" style={{ marginBottom: 10 }}>
          {addPhotoError}
        </div>
      )}

      {/* Fullscreen photo overlay */}
      {expandedPhoto && (
        <div
          onClick={() => setExpandedPhoto(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            cursor: "pointer",
          }}
        >
          <img
            src={expandedPhoto}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      )}

      {/* 2. TITLE BLOCK */}
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
        {item.title || "Unknown"}
      </div>
      <div className="muted small">
        {item.publisher}
        {item.publisher && item.year ? " · " : ""}
        {item.year}
      </div>
      <div style={{ marginTop: 8 }}>
        <span className="grade-badge">{gradeBadgeText}</span>
      </div>

      {/* 3. KEY ISSUE BLOCK */}
      {item.keyIssue && item.keyIssue !== "N/A" && (
        <div className="key-box" style={{ marginTop: 12 }}>
          ⭐ {item.keyIssue}
        </div>
      )}

      {/* 4. AI CONDITION REPORT */}
      {(conditionBullets.length > 0 || confidenceText || scannedText) && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 8,
            background: "rgba(212,175,55,0.05)",
          }}
        >
          <div
            className="muted small"
            style={{
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            AI Condition Report
          </div>
          {conditionBullets.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {conditionBullets.map((b, i) => (
                <li
                  key={i}
                  style={{
                    padding: "4px 0",
                    fontSize: 14,
                    color: b.concern ? "#f59e0b" : "#5cb85c",
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{b.concern ? "⚠️" : "✅"}</span>
                  <span style={{ color: "inherit" }}>{b.text}</span>
                </li>
              ))}
            </ul>
          )}
          {(confidenceText || scannedText) && (
            <div
              className="muted small"
              style={{
                marginTop: conditionBullets.length > 0 ? 10 : 0,
                paddingTop: conditionBullets.length > 0 ? 8 : 0,
                borderTop:
                  conditionBullets.length > 0
                    ? "1px solid rgba(212,175,55,0.2)"
                    : "none",
              }}
            >
              {confidenceText && <div>Confidence: {confidenceText}</div>}
              {scannedText && <div>Scanned: {scannedText}</div>}
            </div>
          )}
        </div>
      )}

      {/* 5. PRICING BLOCK */}
      <div style={{ marginTop: 14 }}>
        <div className="muted small">Recommended list price</div>
        <div
          className="price"
          style={{ fontSize: 28, fontWeight: 800, color: "#d4af37" }}
        >
          {recommendedLabel}
        </div>

        {hasComps && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid rgba(212,175,55,0.3)",
              borderRadius: 8,
              background: "rgba(212,175,55,0.05)",
            }}
          >
            <div
              className="muted small"
              style={{
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 6,
              }}
            >
              Recent eBay listings
            </div>
            {item.comps.recentSales.slice(0, 3).map((s, i) => {
              const rowStyle = {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 0",
                fontSize: 14,
              };
              const inner = (
                <>
                  <span className="muted small">
                    {fmtSaleWhen(s.date, s.daysAgo)}
                  </span>
                  <span style={{ fontWeight: 600, color: "#d4af37" }}>
                    {fmtPrice(s.price)}
                    {s.itemWebUrl ? (
                      <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>
                    ) : null}
                  </span>
                </>
              );
              return s.itemWebUrl ? (
                <a
                  key={i}
                  href={s.itemWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...rowStyle,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {inner}
                </a>
              ) : (
                <div key={i} style={rowStyle}>
                  {inner}
                </div>
              );
            })}
            <div
              style={{
                borderTop: "1px solid rgba(212,175,55,0.25)",
                margin: "8px 0",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                fontSize: 14,
              }}
            >
              <span className="muted small">30-day average</span>
              <span style={{ fontWeight: 600 }}>
                {fmtPrice(item.comps.averageNum)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                fontSize: 14,
              }}
            >
              <span className="muted small">Recommended</span>
              <span style={{ fontWeight: 700, color: "#d4af37" }}>
                {recommendedLabel}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                fontSize: 14,
              }}
            >
              <span className="muted small">Floor</span>
              <span style={{ fontWeight: 600, color: "#e05656" }}>
                {fmtPrice(item.comps.lowestNum)}
              </span>
            </div>
            <div
              className="muted small"
              style={{ marginTop: 6, fontStyle: "italic" }}
            >
              Source:{" "}
              {item.comps.source === "marketplace_insights"
                ? "Marketplace Insights"
                : "Browse API — active listings"}
            </div>
          </div>
        )}

        {!hasComps && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid rgba(245,158,11,0.5)",
              borderRadius: 8,
              background: "rgba(245,158,11,0.1)",
              color: "#f59e0b",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              ⚠ No stored eBay comps for this comic
            </div>
            <div className="small" style={{ marginBottom: 4 }}>
              Tap refresh to fetch live market data
            </div>
            {(item.priceLow || item.priceHigh) && (
              <div style={{ fontWeight: 600, marginTop: 6 }}>
                AI range: {item.priceLow}
                {item.priceLow && item.priceHigh ? " – " : ""}
                {item.priceHigh}
              </div>
            )}
          </div>
        )}

        <button
          className="reset-btn"
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ marginTop: 12, width: "100%" }}
        >
          {refreshing ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  border: "2px solid rgba(212,175,55,0.3)",
                  borderTopColor: "#d4af37",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  marginRight: 8,
                  verticalAlign: "middle",
                }}
              />
              Refreshing…
            </>
          ) : (
            "🔄 Refresh Market Data"
          )}
        </button>
        {refreshError && (
          <div className="error-text small" style={{ marginTop: 6 }}>
            {refreshError}
          </div>
        )}
      </div>

      {/* 6. ACTION BUTTONS */}
      <div style={{ marginTop: 18 }}>
        {isListed ? (
          <div className="listed-card">
            <div className="listed-header">
              <span className="listed-badge">Listed</span>
              <span className="muted small">on eBay</span>
            </div>
            <a
              href={item.ebayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="listed-link"
            >
              {item.ebayUrl}
            </a>
          </div>
        ) : (
          <button
            className="reset-btn primary"
            onClick={handleList}
            disabled={listing}
            style={{ width: "100%" }}
          >
            {listing
              ? "Listing on eBay..."
              : `📋 List on eBay — ${recommendedLabel}`}
          </button>
        )}
        {listError && (
          <div className="error-text small" style={{ marginTop: 6 }}>
            {listError}
          </div>
        )}

        <button
          className="reset-btn danger"
          onClick={() => {
            if (confirm(`Delete "${item.title || "this comic"}"?`)) {
              onDelete(item.id);
              onBack();
            }
          }}
          style={{ marginTop: 12, width: "100%" }}
        >
          Delete from Collection
        </button>
      </div>

      <div
        className="muted small"
        style={{ textAlign: "center", marginTop: 16, fontStyle: "italic" }}
      >
        {photos.length} photo{photos.length === 1 ? "" : "s"} stored
      </div>
    </div>
  );
}

// --- Tiny SVG line chart (no dependencies) ---
function MiniChart({ data, width = 320, height = 120 }) {
  if (!data || data.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="muted small">Not enough data yet — check back after a few days</span>
      </div>
    );
  }
  const values = data.map((d) => d.totalValue);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const pad = 8;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((d.totalValue - minV) / range) * h;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="#d4af37"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {data.length > 0 && (() => {
        const last = data[data.length - 1];
        const x = pad + w;
        const y = pad + h - ((last.totalValue - minV) / range) * h;
        return <circle cx={x} cy={y} r="4" fill="#d4af37" />;
      })()}
      {/* Y-axis labels */}
      <text x={pad} y={pad + 4} fill="#666" fontSize="10" fontFamily="inherit">
        {fmt(maxV)}
      </text>
      <text x={pad} y={height - 2} fill="#666" fontSize="10" fontFamily="inherit">
        {fmt(minV)}
      </text>
    </svg>
  );
}

const FILTER_PILLS = [
  { key: "all", label: "All" },
  { key: "listed", label: "Listed" },
  { key: "unlisted", label: "Unlisted" },
  { key: "keys", label: "Key Issues" },
  { key: "highValue", label: "High Value" },
  { key: "stagnant", label: "Stagnant" },
  { key: "bundle", label: "Bundle Ready" },
];

function ManagePage({ catalogue, totalValue, analysis, snapshots, onRefreshAnalysis, analyzing, onOpenItem }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const stagnantIds = new Set((analysis?.stagnant || []).map((s) => s.id));
  const bundleIds = new Set((analysis?.bundleGroups || []).flatMap((g) => g.ids || []));
  const listNowIds = new Set((analysis?.listNow || []).map((s) => s.id));
  const gradeFirstIds = new Set((analysis?.gradeFirst || []).map((s) => s.id));

  const getAiTag = (item) => {
    if (listNowIds.has(item.id)) return { emoji: "🔥", label: "HOT" };
    if (stagnantIds.has(item.id)) return { emoji: "⏳", label: "STAGNANT" };
    if (bundleIds.has(item.id)) return { emoji: "📦", label: "BUNDLE" };
    if (gradeFirstIds.has(item.id)) return { emoji: "💎", label: "GRADE" };
    return null;
  };

  const q = search.toLowerCase().trim();
  const filtered = catalogue.filter((item) => {
    // Text search
    if (q) {
      const hay = `${item.title} ${item.publisher} ${item.year} ${item.grade}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // Filter pills
    switch (filter) {
      case "listed": return item.status === "listed";
      case "unlisted": return item.status !== "listed";
      case "keys": return item.keyIssue && item.keyIssue !== "N/A";
      case "highValue": return marketValueOf(item) >= 100;
      case "stagnant": return stagnantIds.has(item.id);
      case "bundle": return bundleIds.has(item.id);
      default: return true;
    }
  });

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLongPress = (id) => {
    setSelectMode(true);
    setSelected(new Set([id]));
  };

  const analyzedAgo = analysis?.analyzedAt
    ? (() => {
        const mins = Math.round((Date.now() - analysis.analyzedAt) / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.round(hrs / 24)}d ago`;
      })()
    : null;

  const s = {
    section: {
      border: "1px solid rgba(212,175,55,0.3)",
      borderRadius: 10,
      padding: 14,
      background: "rgba(212,175,55,0.05)",
      marginBottom: 12,
    },
    sectionTitle: {
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 11,
      color: "#999",
      marginBottom: 10,
      fontWeight: 600,
    },
    recRow: {
      display: "flex",
      gap: 8,
      alignItems: "flex-start",
      padding: "6px 0",
      fontSize: 14,
    },
    pill: (active) => ({
      padding: "6px 14px",
      borderRadius: 20,
      fontSize: 13,
      fontWeight: 600,
      border: active ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.15)",
      background: active ? "rgba(212,175,55,0.2)" : "transparent",
      color: active ? "#d4af37" : "#999",
      cursor: "pointer",
      whiteSpace: "nowrap",
    }),
    listRow: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 0",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      cursor: "pointer",
    },
  };

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* SEARCH BAR */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Search title, publisher, year..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 14px",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(212,175,55,0.3)",
            borderRadius: 10,
            color: "#fff",
            fontSize: 15,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* FILTER PILLS */}
      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 12,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {FILTER_PILLS.map((p) => (
          <button
            key={p.key}
            onClick={() => { setFilter(p.key); setSelectMode(false); setSelected(new Set()); }}
            style={s.pill(filter === p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* AI OVERVIEW CARD */}
      <div style={s.section}>
        <div style={s.sectionTitle}>AI Collection Intelligence</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
          {catalogue.length} comic{catalogue.length === 1 ? "" : "s"} · {fmt(totalValue)} est. value
        </div>

        {analysis ? (
          <>
            {analysis.marketSummary && (
              <div style={{ fontSize: 14, color: "#ccc", marginBottom: 12, lineHeight: 1.5 }}>
                {analysis.marketSummary}
              </div>
            )}

            {analysis.trending?.length > 0 && (
              <div style={s.recRow}>
                <span>📈</span>
                <span>
                  <strong>Trending up:</strong>{" "}
                  {analysis.trending.map((t) => t.title).join(", ")}
                </span>
              </div>
            )}
            {analysis.listNow?.length > 0 && (
              <div style={s.recRow}>
                <span>🔥</span>
                <span>
                  <strong>List now:</strong> {analysis.listNow.length} book{analysis.listNow.length === 1 ? "" : "s"} at peak value
                </span>
              </div>
            )}
            {analysis.stagnant?.length > 0 && (
              <div style={s.recRow}>
                <span>⏳</span>
                <span>
                  <strong>Stagnant:</strong> {analysis.stagnant.length} book{analysis.stagnant.length === 1 ? "" : "s"} (30+ days unlisted)
                </span>
              </div>
            )}
            {analysis.bundleGroups?.length > 0 && (
              <div style={s.recRow}>
                <span>📦</span>
                <span>
                  <strong>Bundle opportunity:</strong>{" "}
                  {analysis.bundleGroups.map((g) => `${g.ids?.length || 0} ${g.reason || "books"}`).join(", ")}
                </span>
              </div>
            )}
            {analysis.gradeFirst?.length > 0 && (
              <div style={s.recRow}>
                <span>💎</span>
                <span>
                  <strong>Grade before selling:</strong> {analysis.gradeFirst.length} high-value raw{analysis.gradeFirst.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
            {analysis.valueChange != null && analysis.valueChange !== 0 && (
              <div style={s.recRow}>
                <span>{analysis.valueChange > 0 ? "📈" : "📉"}</span>
                <span>
                  Collection value {analysis.valueChange > 0 ? "up" : "down"}{" "}
                  {Math.abs(analysis.valueChange)}% vs 30 days ago
                </span>
              </div>
            )}

            {analyzedAgo && (
              <div className="muted small" style={{ marginTop: 8, fontStyle: "italic" }}>
                Last analyzed: {analyzedAgo}
              </div>
            )}
          </>
        ) : (
          <div className="muted small">
            Tap the button below to get AI recommendations for your collection.
          </div>
        )}

        <button
          onClick={onRefreshAnalysis}
          disabled={analyzing || catalogue.length === 0}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "14px",
            background: analyzing
              ? "rgba(212,175,55,0.15)"
              : "linear-gradient(135deg, #d4af37, #b8941f)",
            color: analyzing ? "#d4af37" : "#0a0a0a",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 700,
            cursor: analyzing ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          {analyzing ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  border: "2px solid rgba(212,175,55,0.3)",
                  borderTopColor: "#d4af37",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              Analyzing collection…
            </>
          ) : (
            "🧠 Refresh AI Analysis"
          )}
        </button>
      </div>

      {/* MARKET TREND CHART */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Collection Value Trend</div>
        <MiniChart data={snapshots} />
      </div>

      {/* BUNDLE GROUPS */}
      {analysis?.bundleGroups?.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Bundle Opportunities</div>
          {analysis.bundleGroups.map((g, i) => (
            <div
              key={i}
              style={{
                padding: "10px 0",
                borderBottom:
                  i < analysis.bundleGroups.length - 1
                    ? "1px solid rgba(212,175,55,0.15)"
                    : "none",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                📦 {g.titles?.join(", ") || g.reason}
              </div>
              {g.suggestedPrice != null && (
                <div style={{ fontSize: 13, color: "#d4af37", marginTop: 4 }}>
                  Bundle price: ${Math.round(g.suggestedPrice).toLocaleString()}
                </div>
              )}
              {g.reason && g.titles && (
                <div className="muted small" style={{ marginTop: 2 }}>{g.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* BULK SELECT BAR */}
      {selectMode && selected.size > 0 && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 100,
            background: "#1a1a1a",
            padding: "10px 0",
            marginBottom: 8,
            display: "flex",
            gap: 8,
            borderBottom: "1px solid rgba(212,175,55,0.3)",
          }}
        >
          <button
            onClick={() => { setSelectMode(false); setSelected(new Set()); }}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              color: "#999",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel ({selected.size})
          </button>
        </div>
      )}

      {/* FILTERED COLLECTION LIST */}
      <div>
        {filtered.length === 0 && (
          <div className="muted small" style={{ textAlign: "center", padding: 20 }}>
            {q ? "No comics match your search" : "No comics in this filter"}
          </div>
        )}
        {filtered.map((item) => {
          const thumbSrc = getComicPhotos(item)[0] || null;
          const mv = marketValueOf(item);
          const tag = getAiTag(item);
          const isSelected = selected.has(item.id);

          const handleClick = () => {
            if (selectMode) {
              toggleSelect(item.id);
            } else {
              onOpenItem(item);
            }
          };

          let pressTimer = null;
          const onTouchStart = () => {
            pressTimer = setTimeout(() => handleLongPress(item.id), 500);
          };
          const onTouchEnd = () => clearTimeout(pressTimer);

          return (
            <div
              key={item.id}
              style={{
                ...s.listRow,
                background: isSelected ? "rgba(212,175,55,0.1)" : "transparent",
              }}
              onClick={handleClick}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchEnd}
            >
              {selectMode && (
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    border: isSelected
                      ? "2px solid #d4af37"
                      : "2px solid rgba(255,255,255,0.2)",
                    background: isSelected ? "#d4af37" : "transparent",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#0a0a0a",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {isSelected ? "✓" : ""}
                </div>
              )}
              {thumbSrc ? (
                <img
                  src={thumbSrc}
                  alt=""
                  loading="lazy"
                  style={{
                    width: 44,
                    height: 60,
                    objectFit: "cover",
                    borderRadius: 6,
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 44,
                    height: 60,
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    flexShrink: 0,
                  }}
                >
                  📘
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.title || "Unknown"}
                </div>
                <div className="muted small">
                  {item.grade || "Raw"} · {mv != null ? fmt(mv) : "—"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {tag && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "rgba(212,175,55,0.15)",
                      color: "#d4af37",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tag.emoji} {tag.label}
                  </span>
                )}
                {item.status === "listed" && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "rgba(22,163,106,0.2)",
                      color: "#16a34a",
                      fontWeight: 600,
                    }}
                  >
                    LISTED
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* SHIPPING PLACEHOLDER */}
      <div style={{ ...s.section, marginTop: 12 }}>
        <div style={s.sectionTitle}>Shipping</div>
        <div className="muted small" style={{ textAlign: "center", padding: 8 }}>
          Shipping labels will appear here when books are sold on eBay.
          USPS Media Mail pre-filled with item details.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("scan"); // 'scan' | 'buyer' | 'collection'
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showSafariBanner, setShowSafariBanner] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(
    () => localStorage.getItem("installDismissed") === "1"
  );
  // Install banner is mobile-only. Desktop Chrome/Edge show their own
  // install icon in the address bar, so a custom banner is just noise.
  const [isMobile] = useState(() =>
    /android|iphone|ipad|ipod/i.test(navigator.userAgent || "")
  );
  const [widgetMode, setWidgetMode] = useState(
    () => new URLSearchParams(window.location.search).get("share-target") === "1"
  );
  const [bulkProgress, setBulkProgress] = useState(null); // { current, total, title }
  const [bulkDone, setBulkDone] = useState(null); // number or null
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const fileRef = useRef(null);
  const buyerFileRef = useRef(null);
  const bulkRef = useRef(null);

  // Load catalogue, snapshots, and cached analysis from IndexedDB on mount.
  useEffect(() => {
    (async () => {
      await migrateFromLocalStorage();
      const items = await getAllComics();
      setCatalogue(items);
      const snaps = await getAllSnapshots();
      setSnapshots(snaps);
      const cached = await getAnalysis();
      if (cached) setAnalysis(cached);
    })();
  }, []);

  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const id = setInterval(() => {
      setStep((s) => (s + 1) % LOADING_STEPS.length);
    }, 1200);
    return () => clearInterval(id);
  }, [loading]);

  // PWA install eligibility detection:
  //  - Chrome / Android fires `beforeinstallprompt`; capture the event so the
  //    banner can trigger the native install flow via installPrompt.prompt().
  //  - iOS Safari never fires that event — detect it manually and show an
  //    instructional banner pointing at the Share sheet instead.
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    const ua = navigator.userAgent || "";
    const isIOS = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
    const isSafari = isIOS && !ua.includes("CriOS");
    if (isSafari && !window.navigator.standalone) {
      setShowSafariBanner(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  // Auto-dismiss the install banner 8s after it becomes visible.
  // IMPORTANT: keyed to the banner's visibility state, NOT to mount —
  // Chrome's `beforeinstallprompt` engagement heuristic often fires
  // 30+ seconds after mount, so a mount-keyed timer would expire long
  // before the banner ever appears and the banner would stay forever.
  // This version restarts the 8s countdown when the banner first shows.
  // Non-persistent: banner reappears next session unless the user taps ✕.
  useEffect(() => {
    if (installDismissed) return;
    if (!installPrompt && !showSafariBanner) return;
    const t = setTimeout(() => {
      setInstallPrompt(null);
      setShowSafariBanner(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [installDismissed, installPrompt, showSafariBanner]);

  const addToCatalogue = useCallback(async (data, sourceDataUrl) => {
    let thumb = null;
    try {
      thumb = sourceDataUrl ? await makeThumbnail(sourceDataUrl) : null;
    } catch {
      thumb = null;
    }
    const entry = {
      id: `cv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: data.title || "",
      publisher: data.publisher || "",
      year: data.year || "",
      grade: data.grade || "",
      isGraded: data.isGraded === true,
      numericGrade:
        typeof data.numericGrade === "number" ? data.numericGrade : null,
      keyIssue: data.keyIssue || "",
      price: data.price || "",
      priceLow: data.priceLow || "",
      priceHigh: data.priceHigh || "",
      reason: data.reason || "",
      confidence: data.confidence || "",
      timestamp: Date.now(),
      images: thumb ? [thumb] : [],
    };
    try {
      await putComic(entry);
    } catch (err) {
      // IndexedDB quota errors are rare but possible on very large libraries.
      // Retry once without photos before giving up.
      if (entry.images.length > 0) {
        try {
          await putComic({ ...entry, images: [] });
          entry.images = [];
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }
    setCatalogue((prev) => [entry, ...prev]);
    return entry.id;
  }, []);

  const gradeBlob = useCallback(
    async (blob, { save = false } = {}) => {
      setError(null);
      setResult(null);
      setEnriching(false);
      setLoading(true);
      try {
        const rawB64 = await fileToBase64(blob);
        // Compress in-browser before upload to stay well under Vercel's
        // 4.5MB request body limit. Max 1200px on the longest side,
        // JPEG quality 0.85. Reuses the same canvas helper the catalogue
        // thumbnail path uses.
        const b64 = await makeThumbnail(rawB64, 1200, 0.85);
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: [b64] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to grade");
        // Show the Claude result immediately.
        setResult({ ...data, image: b64 });
        setLoading(false);
        const savedId = save ? await addToCatalogue(data, b64) : null;

        // Fire-and-forget enrichment pass — merges into the card when ready.
        setEnriching(true);
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            grade: data.grade,
            isGraded: data.isGraded,
            numericGrade: data.numericGrade,
            year: data.year,
            publisher: data.publisher,
            confidence: data.confidence,
            images: [b64],
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((enrich) => {
            if (!enrich) return;
            // Explicitly preserve the cover image from the initial grade
            // response in case enrich ever returns its own image field.
            setResult((prev) =>
              prev ? { ...prev, ...enrich, image: prev.image } : prev
            );
            // Persist comps + enriched price fields into the stored
            // catalogue entry so CollectionDetail can display them after
            // a refresh from IndexedDB — AND update selectedItem in case
            // the user is already viewing the detail page for this comic
            // (otherwise the detail view would keep rendering the stale
            // pre-enrich entry until they close and reopen it).
            if (savedId) {
              setCatalogue((prev) => {
                const idx = prev.findIndex((x) => x.id === savedId);
                if (idx < 0) return prev;
                const updated = {
                  ...prev[idx],
                  comps: enrich.comps || prev[idx].comps,
                  price: enrich.price || prev[idx].price,
                  priceLow: enrich.priceLow || prev[idx].priceLow,
                  priceHigh: enrich.priceHigh || prev[idx].priceHigh,
                  keyIssue: enrich.keyIssue || prev[idx].keyIssue,
                };
                // Fire-and-forget persistence. Idempotent if it runs twice.
                putComic(updated).catch(() => {});
                const next = prev.slice();
                next[idx] = updated;
                return next;
              });
              // Sync the currently-open detail view if it's the same comic.
              setSelectedItem((cur) => {
                if (!cur || cur.id !== savedId) return cur;
                return {
                  ...cur,
                  comps: enrich.comps || cur.comps,
                  price: enrich.price || cur.price,
                  priceLow: enrich.priceLow || cur.priceLow,
                  priceHigh: enrich.priceHigh || cur.priceHigh,
                  keyIssue: enrich.keyIssue || cur.keyIssue,
                };
              });
            }
          })
          .catch(() => {
            /* enrichment failure is non-fatal */
          })
          .finally(() => setEnriching(false));
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    },
    [addToCatalogue]
  );

  const handleFile = async (e, which) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await gradeBlob(file, { save: which === "scan" });
    if (which === "scan" && fileRef.current) fileRef.current.value = "";
    if (which === "buyer" && buyerFileRef.current) buyerFileRef.current.value = "";
  };

  const handleBulkImport = useCallback(async (files) => {
    setBulkDone(null);
    setBulkProgress({ current: 1, total: files.length, title: "" });
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBulkProgress({ current: i + 1, total: files.length, title: "" });
      try {
        const rawB64 = await fileToBase64(file);
        const b64 = await makeThumbnail(rawB64, 1200, 0.85);
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: [b64] }),
        });
        const data = await res.json();
        if (!res.ok) continue; // skip failures
        setBulkProgress({ current: i + 1, total: files.length, title: data.title || "" });
        const savedId = await addToCatalogue(data, b64);
        if (savedId) added++;
        // Fire-and-forget enrichment
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            grade: data.grade,
            isGraded: data.isGraded,
            numericGrade: data.numericGrade,
            year: data.year,
            publisher: data.publisher,
            confidence: data.confidence,
            images: [b64],
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((enrich) => {
            if (!enrich || !savedId) return;
            setCatalogue((prev) => {
              const idx = prev.findIndex((x) => x.id === savedId);
              if (idx < 0) return prev;
              const updated = {
                ...prev[idx],
                comps: enrich.comps || prev[idx].comps,
                price: enrich.price || prev[idx].price,
                priceLow: enrich.priceLow || prev[idx].priceLow,
                priceHigh: enrich.priceHigh || prev[idx].priceHigh,
                keyIssue: enrich.keyIssue || prev[idx].keyIssue,
              };
              putComic(updated).catch(() => {});
              const next = prev.slice();
              next[idx] = updated;
              return next;
            });
          })
          .catch(() => {});
      } catch {
        // skip failures
      }
    }
    setBulkProgress(null);
    setBulkDone(added);
    // Auto-switch to collection tab after a short delay
    setTimeout(() => {
      setTab("collection");
      setBulkDone(null);
    }, 2000);
  }, [addToCatalogue]);

  // Web Share Target handoff — fires gradeBlob; widget mode renders the overlay.
  useEffect(() => {
    if (!widgetMode) return;
    (async () => {
      try {
        const res = await fetch("/__shared-image", { cache: "no-store" });
        if (!res.ok) return;
        const blob = await res.blob();
        if (blob.size > 0) await gradeBlob(blob);
      } catch {
        /* noop */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const deleteFromCatalogue = useCallback(async (id) => {
    await deleteComic(id);
    setCatalogue((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const listOnEbay = useCallback(async (item) => {
    const coverPhoto = getComicPhotos(item)[0] || null;
    const res = await fetch("/api/list-ebay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        publisher: item.publisher,
        year: item.year,
        grade: item.grade,
        keyIssue: item.keyIssue,
        price: item.price,
        priceLow: item.priceLow,
        priceHigh: item.priceHigh,
        reason: item.reason,
        image: coverPhoto,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.listingUrl) {
      throw new Error(data.error || "Failed to create eBay listing");
    }
    const updated = {
      ...item,
      status: "listed",
      ebayUrl: data.listingUrl,
      listedAt: Date.now(),
    };
    await putComic(updated);
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? updated : cur));
  }, []);

  // Re-fetch eBay comps + ComicVine + census + AI verification for an
  // existing catalogue entry, without re-running the image identification.
  // Used by the CollectionDetail "Refresh Market Data" button.
  const refreshMarketData = useCallback(async (item) => {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        grade: item.grade,
        isGraded: item.isGraded,
        numericGrade: item.numericGrade,
        year: item.year,
        publisher: item.publisher,
        confidence: item.confidence,
      }),
    });
    if (!res.ok) throw new Error("Failed to refresh market data");
    const enrich = await res.json();
    const updated = {
      ...item,
      comps: enrich.comps || item.comps,
      price: enrich.price || item.price,
      priceLow: enrich.priceLow || item.priceLow,
      priceHigh: enrich.priceHigh || item.priceHigh,
      keyIssue: enrich.keyIssue || item.keyIssue,
    };
    await putComic(updated);
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? updated : cur));
  }, []);

  // Append a new photo to an existing comic and re-run /api/grade with
  // ALL photos so the identification benefits from multi-angle coverage.
  // Updates the stored entry with fresh grade fields + new images array.
  const addPhotoToComic = useCallback(async (item, file) => {
    const existingPhotos = getComicPhotos(item);
    if (existingPhotos.length >= 4) {
      throw new Error("Maximum 4 photos reached");
    }
    const rawB64 = await fileToBase64(file);
    const newThumb = await makeThumbnail(rawB64, 1200, 0.85);
    const nextPhotos = [...existingPhotos, newThumb];

    const res = await fetch("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: nextPhotos }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to re-analyze");

    const updated = {
      ...item,
      title: data.title || item.title,
      publisher: data.publisher || item.publisher,
      year: data.year || item.year,
      grade: data.grade || item.grade,
      isGraded: data.isGraded === true,
      numericGrade:
        typeof data.numericGrade === "number"
          ? data.numericGrade
          : item.numericGrade,
      keyIssue: data.keyIssue || item.keyIssue,
      price: data.price || item.price,
      priceLow: data.priceLow || item.priceLow,
      priceHigh: data.priceHigh || item.priceHigh,
      reason: data.reason || item.reason,
      confidence: data.confidence || item.confidence,
      images: nextPhotos,
      // Drop the legacy single `image` field if it's still hanging around
      // from an older record — `images` is the source of truth now.
      image: undefined,
    };
    try {
      await putComic(updated);
    } catch {
      // Quota fallback: drop the oldest photo and retry.
      const trimmed = { ...updated, images: nextPhotos.slice(-3) };
      await putComic(trimmed);
      setCatalogue((prev) =>
        prev.map((x) => (x.id === item.id ? trimmed : x))
      );
      setSelectedItem((cur) =>
        cur && cur.id === item.id ? trimmed : cur
      );
      return;
    }
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? updated : cur));
  }, []);

  const marketValue = marketValueOf(result);

  const totalValue = catalogue.reduce((sum, item) => {
    const v = marketValueOf(item);
    return sum + (v || 0);
  }, 0);

  // Record a daily value snapshot whenever catalogue changes.
  useEffect(() => {
    if (catalogue.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const val = catalogue.reduce((s, c) => s + (marketValueOf(c) || 0), 0);
    const snap = { date: today, totalValue: val, comicCount: catalogue.length };
    putSnapshot(snap)
      .then(() => getAllSnapshots())
      .then((s) => setSnapshots(s))
      .catch(() => {});
  }, [catalogue]);

  const refreshAnalysis = useCallback(async () => {
    if (catalogue.length === 0) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comics: catalogue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysis(data);
      await putAnalysis(data);
    } catch {
      /* non-fatal */
    } finally {
      setAnalyzing(false);
    }
  }, [catalogue]);

  const switchTab = (next) => {
    setTab(next);
    reset();
    setSelectedItem(null);
  };

  const handleInstallTap = async () => {
    if (!installPrompt) return;
    try {
      installPrompt.prompt();
      await installPrompt.userChoice;
    } catch {
      /* user dismissed natively or prompt threw — clear state anyway */
    }
    setInstallPrompt(null);
  };

  const handleInstallDismiss = () => {
    localStorage.setItem("installDismissed", "1");
    setInstallDismissed(true);
  };

  const dismissWidget = () => {
    setWidgetMode(false);
    reset();
    window.history.replaceState({}, "", "/");
  };

  const saveFromWidget = async (data, imageDataUrl) => {
    await addToCatalogue(data, imageDataUrl);
  };

  const listFromWidget = async (data) => {
    const coverPhoto = data.image || null;
    const res = await fetch("/api/list-ebay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.title,
        publisher: data.publisher,
        year: data.year,
        grade: data.grade,
        keyIssue: data.keyIssue,
        price: data.price,
        priceLow: data.priceLow,
        priceHigh: data.priceHigh,
        reason: data.reason,
        image: coverPhoto,
      }),
    });
    const d = await res.json();
    if (!res.ok || !d.listingUrl) {
      throw new Error(d.error || "Failed to create eBay listing");
    }
  };

  if (widgetMode) {
    return (
      <WidgetOverlay
        loading={loading}
        step={step}
        result={result}
        enriching={enriching}
        error={error}
        onDismiss={dismissWidget}
        onSave={saveFromWidget}
        onListEbay={listFromWidget}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">Comic Vault</header>

      {tab === "scan" && (
        <>
          {/* Bulk import progress */}
          {bulkProgress && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-text">
                {bulkProgress.title
                  ? `Grading ${bulkProgress.title}… (${bulkProgress.current}/${bulkProgress.total})`
                  : `Grading ${bulkProgress.current} of ${bulkProgress.total}…`}
              </div>
            </div>
          )}

          {/* Bulk import done */}
          {bulkDone != null && !bulkProgress && (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#d4af37" }}>
                {bulkDone} comic{bulkDone === 1 ? "" : "s"} added to collection
              </div>
            </div>
          )}

          {!loading && !result && !error && !bulkProgress && bulkDone == null && (
            <>
              <ScanZone
                onFile={(e) => handleFile(e, "scan")}
                onGalleryFiles={handleBulkImport}
                inputRef={fileRef}
                label="Tap to scan a comic"
              />
              <button
                onClick={() => bulkRef.current?.click()}
                style={{
                  display: "block",
                  width: "100%",
                  maxWidth: 420,
                  margin: "12px auto 0",
                  padding: "12px 16px",
                  background: "transparent",
                  color: "#d4af37",
                  border: "1px solid rgba(212,175,55,0.4)",
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                📚 Bulk Import from Gallery
              </button>
              <input
                ref={bulkRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (bulkRef.current) bulkRef.current.value = "";
                  if (files.length > 0) handleBulkImport(files);
                }}
                hidden
              />
            </>
          )}
          {loading && !bulkProgress && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-text">{LOADING_STEPS[step]}</div>
            </div>
          )}
          {error && (
            <div className="error-card">
              <div className="error-text">{error}</div>
              <button className="reset-btn" onClick={reset}>Try again</button>
            </div>
          )}
          {result && !loading && !bulkProgress && (
            <>
              <ResultCard result={result} enriching={enriching} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
        </>
      )}

      {tab === "buyer" && (
        <>
          {!loading && !result && !error && (
            <ScanZone
              onFile={(e) => handleFile(e, "buyer")}
              inputRef={buyerFileRef}
              compact
              label="Scan the book on stream"
            />
          )}
          {loading && (
            <div className="loading">
              <div className="spinner" />
              <div className="loading-text">{LOADING_STEPS[step]}</div>
            </div>
          )}
          {error && (
            <div className="error-card">
              <div className="error-text">{error}</div>
              <button className="reset-btn" onClick={reset}>Try again</button>
            </div>
          )}
          {result && !loading && (
            <>
              <ResultCard result={result} enriching={enriching} />
              <BidCalculator marketValue={marketValue} detectedPrice={result?.detectedPrice} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
          {!result && !loading && !error && <BidCalculator marketValue={null} />}
        </>
      )}

      {tab === "collection" && (
        selectedItem ? (
          <CollectionDetail
            item={selectedItem}
            onBack={() => setSelectedItem(null)}
            onDelete={deleteFromCatalogue}
            onList={listOnEbay}
            onRefreshMarket={refreshMarketData}
            onAddPhoto={addPhotoToComic}
          />
        ) : (
          <CollectionList
            items={catalogue}
            totalValue={totalValue}
            onOpen={setSelectedItem}
            onDelete={deleteFromCatalogue}
          />
        )
      )}

      {tab === "manage" && (
        <ManagePage
          catalogue={catalogue}
          totalValue={totalValue}
          analysis={analysis}
          snapshots={snapshots}
          onRefreshAnalysis={refreshAnalysis}
          analyzing={analyzing}
          onOpenItem={(item) => {
            setSelectedItem(item);
            setTab("collection");
          }}
        />
      )}

      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === "scan" ? "active" : ""}`}
          onClick={() => switchTab("scan")}
        >
          <div className="tab-icon">📷</div>
          <div>Scan</div>
        </button>
        <button
          className={`tab-btn ${tab === "buyer" ? "active" : ""}`}
          onClick={() => switchTab("buyer")}
        >
          <div className="tab-icon">⚡</div>
          <div>Buyer</div>
        </button>
        <button
          className={`tab-btn ${tab === "collection" ? "active" : ""}`}
          onClick={() => switchTab("collection")}
        >
          <div className="tab-icon">📚</div>
          <div>Collection</div>
        </button>
        <button
          className={`tab-btn ${tab === "manage" ? "active" : ""}`}
          onClick={() => switchTab("manage")}
        >
          <div className="tab-icon">🧠</div>
          <div>Manage</div>
        </button>
      </nav>

      {isMobile && !installDismissed && (installPrompt || showSafariBanner) && (
        <div
          role="dialog"
          aria-label="Install Comic Vault"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            background: "#f0c040",
            color: "#0a0a0a",
            padding: "12px 16px",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            boxShadow: "0 2px 12px rgba(0, 0, 0, 0.4)",
          }}
        >
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
            {installPrompt
              ? "📲 Add Comic Vault to your home screen"
              : "📲 Tap Share then Add to Home Screen to install"}
          </span>
          {installPrompt && (
            <button
              onClick={handleInstallTap}
              style={{
                background: "#0a0a0a",
                color: "#f0c040",
                border: "none",
                padding: "8px 16px",
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Install
            </button>
          )}
          <button
            onClick={handleInstallDismiss}
            aria-label="Dismiss install banner"
            style={{
              background: "transparent",
              color: "#0a0a0a",
              border: "none",
              fontSize: 20,
              fontWeight: 700,
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
