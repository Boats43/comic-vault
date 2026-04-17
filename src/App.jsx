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

const getDisplayPrice = (item) => {
  if (!item) return 0;
  const p = parseFloat(String(item.price || "0").replace(/[$,]/g, ""));
  if (p > 0) return p;
  if (item.comps?.averageNum)
    return Math.round(item.comps.averageNum * 1.15);
  return 0;
};

const marketValueOf = (r) => {
  if (!r) return null;
  const v = getDisplayPrice(r);
  return v || null;
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
const formatConfidence = (c) => {
  if (!c) return "low";
  const s = String(c).toLowerCase().trim();
  if (s === "high" || s === "excellent") return "high";
  if (s === "medium" || s === "mid" || s === "moderate") return "medium";
  const num = parseFloat(s);
  if (!isNaN(num)) {
    const n = num > 10 ? num / 100 : num > 1 ? num / 10 : num;
    if (n >= 0.8) return "high";
    if (n >= 0.6) return "medium";
    return "low";
  }
  return "low";
};

const showKeyIssue = (k) => {
  if (!k) return false;
  const s = k.toLowerCase().trim();
  if (["no", "n/a", "none", "false", "not a key",
    "non-key", "non key", "not key"]
    .some((x) => s.includes(x))) return false;
  return ["1st", "first", "origin", "death",
    "intro", "appearance", "cameo", "key",
    "classic", "vs ", "battle", "debut",
    "kirby", "ditko", "first issue", "last issue",
    "final issue", "historic", "landmark", "#1"]
    .some((x) => s.includes(x));
};

function ScanZone({ onFile, inputRef, compact, label }) {
  const cameraRef = useRef(null);

  return (
    <div
      className={`upload-zone${compact ? " compact" : ""}`}
      onClick={() => cameraRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && cameraRef.current?.click()}
    >
      <div className="upload-emoji">📷</div>
      <div className="upload-text">{label}</div>
      <input
        ref={(el) => { cameraRef.current = el; if (inputRef) inputRef.current = el; }}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
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
  const displayPrice = getDisplayPrice(result);
  const recommendedLabel = displayPrice > 0
    ? `$${displayPrice.toLocaleString("en-US")}`
    : result.price || "—";

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
      <div className="title">{result.title}{result.issue && !result.title?.includes(`#${result.issue}`) ? ` #${result.issue}` : ''}</div>
      <div className="muted small">
        {result.publisher}
        {result.publisher && result.year ? " · " : ""}
        {result.year}
      </div>
      {!result.image && (
        <div className="muted small" style={{ fontStyle: "italic" }}>
          No cover photo — rescan for image
        </div>
      )}
      {result.isGraded === true && result.numericGrade != null
        ? <div className="grade-badge cgc">CGC {result.numericGrade}</div>
        : result.grade
          ? <div className="grade-badge raw">{result.grade}</div>
          : null}
      {showKeyIssue(result.keyIssue) && <div className="key-box">⭐ {result.keyIssue}</div>}
      {result.variant && (
        <div style={{ color: "#FFD700", fontSize: 13, marginTop: 4, fontWeight: "bold" }}>
          ⚡ {result.variant}
        </div>
      )}
      {result.restoration && (
        <div style={{ background: "#ff000022", border: "1px solid #ff4444", borderRadius: 6, padding: "8px 12px", marginTop: 8, color: "#ff6666" }}>
          ⚠️ RESTORED: {result.restoration}
        </div>
      )}
      {recommendedLabel && (
        <>
          <div className="muted small" style={{ marginTop: 12 }}>
            Recommended list price
          </div>
          <div className="price">{recommendedLabel}</div>
          {result.priceNote && (
            <div style={{ color: "#aaa", fontSize: 12 }}>
              {result.priceNote}
            </div>
          )}
          {hasComps && (
            <div className="muted small">
              {comps.source === "browse_api"
                ? `Based on ${comps.count} active eBay listing${comps.count === 1 ? "" : "s"}`
                : `Based on ${comps.count} eBay sale${comps.count === 1 ? "" : "s"} in last 30 days`}
            </div>
          )}
          {result.priceNote && /defect adj/i.test(result.priceNote) && (
            <div style={{ color: "#f59e0b", fontSize: 12, marginTop: 4 }}>
              Adjusted for cover defects
            </div>
          )}
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
          {/* LAST SOLD section */}
          {Array.isArray(result.soldComps) && result.soldComps.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                className="muted small"
                style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
              >
                Last Sold
              </div>
              {result.soldComps.slice(0, 3).map((s, i) => {
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
                      {s.daysAgo != null ? (s.daysAgo === 0 ? "today" : s.daysAgo === 1 ? "yesterday" : `${s.daysAgo} days ago`) : s.date || "—"}
                    </span>
                    <span style={{ fontWeight: 600, color: "#16a34a" }}>
                      {s.priceFormatted || fmtPrice(s.price)} <span style={{ fontSize: 11, opacity: 0.8 }}>SOLD</span>
                      {s.url && <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>}
                    </span>
                  </>
                );
                return s.url ? (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}>
                    {inner}
                  </a>
                ) : (
                  <div key={i} style={rowStyle}>{inner}</div>
                );
              })}
              {result.soldComps.length >= 2 && (() => {
                const avg = result.soldComps.reduce((s, c) => s + (c.price || 0), 0) / result.soldComps.length;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14, borderTop: "1px solid rgba(22,163,106,0.2)", marginTop: 4 }}>
                    <span className="muted small">Avg sold</span>
                    <span style={{ fontWeight: 600, color: "#16a34a" }}>{fmtPrice(avg)}</span>
                  </div>
                );
              })()}
              <div style={{ borderTop: "1px solid rgba(212,175,55,0.25)", margin: "8px 0" }} />
            </div>
          )}

          {/* ACTIVE LISTINGS section */}
          {Array.isArray(comps.recentSales) && comps.recentSales.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                className="muted small"
                style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
              >
                Active Listings
              </div>
              {comps.recentSales.slice(0, 3).map((s, i) => {
                const row = (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="muted small">
                        {fmtSaleWhen(s.date, s.daysAgo)}
                      </span>
                      <span style={{ fontWeight: 600, color: "#d4af37" }}>
                        {fmtPrice(s.price)}
                        {s.itemWebUrl ? (
                          <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>
                        ) : null}
                      </span>
                    </div>
                    {s.title && (
                      <div style={{ fontSize: 11, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                        {s.title.length > 55 ? s.title.slice(0, 55) + "…" : s.title}
                      </div>
                    )}
                  </div>
                );
                const rowStyle = {
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
              alignItems: "center",
              padding: "4px 0",
              fontSize: 14,
            }}
          >
            <span className="muted small">Recommended</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, color: "#d4af37" }}>
                {recommendedLabel}
              </span>
              {(() => {
                const cc = comps?.count || 0;
                const sc = Array.isArray(result.soldComps) ? result.soldComps.length : 0;
                const hasPriceData = result?.pricingSource === "pricecharting";
                const level = sc >= 2 ? "HIGH" : cc >= 2 ? "MEDIUM" : hasPriceData ? "MEDIUM" : "LOW";
                const bg = level === "HIGH" ? "rgba(22,163,106,0.2)" : level === "MEDIUM" ? "rgba(212,175,55,0.2)" : "rgba(245,158,11,0.2)";
                const fg = level === "HIGH" ? "#16a34a" : level === "MEDIUM" ? "#d4af37" : "#f59e0b";
                const label = level === "HIGH" ? "HIGH ✓" : level === "MEDIUM" ? "MED ~" : "AI EST";
                return (
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, fontWeight: 700, background: bg, color: fg }}>
                    {label}
                  </span>
                );
              })()}
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
            {result.pricingSource === "pricecharting"
              ? "Source: PriceCharting market data"
              : "Source: Browse API — active listings"}
            {Array.isArray(result.soldComps) && result.soldComps.length > 0 && " + eBay sold"}
          </div>
        </div>
      )}

      {result.cgcVerified === true && (
        <div style={{ background: "#00aa4422", border: "1px solid #00aa44", borderRadius: 6, padding: "6px 12px", marginTop: 8, color: "#00cc55", fontSize: 13 }}>
          ✓ CGC Verified · {result.certNumber} · {result.cgcLabel}
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
  const [listPrice, setListPrice] = useState(() => getDisplayPrice(result));

  useEffect(() => {
    setListPrice(getDisplayPrice(result));
  }, [result?.title, result?.issue, result?.grade]);

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

  const displayPrice = getDisplayPrice(result);
  const recommendedLabel = displayPrice > 0
    ? `$${displayPrice.toLocaleString("en-US")}`
    : "—";

  const gradeBadge =
    result?.isGraded === true && result?.numericGrade != null
      ? `CGC ${result.numericGrade}`
      : result?.grade || "RAW COPY";

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
      const overridePrice = parseFloat(listPrice);
      const payload = overridePrice > 0
        ? { ...result, price: `$${overridePrice.toFixed(2)}` }
        : result;
      await onListEbay(payload);
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
                {showKeyIssue(result.keyIssue) && (
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

            {/* Section 4 — LIST PRICE OVERRIDE */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#aaa", fontSize: 13 }}>List price</span>
              <input
                type="number"
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 700,
                  padding: "6px 10px",
                  width: 100,
                  textAlign: "right",
                }}
              />
            </div>

            {/* Section 5 — ACTIONS */}
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
                disabled={listing || !(parseFloat(listPrice) > 0)}
              >
                {listing
                  ? "Listing…"
                  : `List on eBay — $${listPrice || "0"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Session logger — ephemeral buyer history in localStorage
const SESSIONS_KEY = "cv_buyer_sessions";
const getSessions = () => { try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]"); } catch { return []; } };
const saveSession = (entry) => {
  const sessions = getSessions();
  sessions.push({ ...entry, ts: Date.now() });
  if (sessions.length > 100) sessions.splice(0, sessions.length - 100);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
};
const getSessionSummary = () => {
  const sessions = getSessions().slice(-20);
  if (sessions.length === 0) return null;
  const buys = sessions.filter((s) => s.decision === "BUY");
  const totalSpent = buys.reduce((s, b) => s + (b.bidPrice || 0), 0);
  const discounts = buys.filter((b) => b.marketValue > 0).map((b) => (b.marketValue - b.bidPrice) / b.marketValue);
  const avgDiscount = discounts.length > 0 ? discounts.reduce((s, d) => s + d, 0) / discounts.length : 0;
  const bestDeal = buys.reduce((best, b) => {
    const disc = b.marketValue > 0 ? (b.marketValue - b.bidPrice) / b.marketValue : 0;
    return disc > (best?.discount || 0) ? { title: b.title, discount: disc, bidPrice: b.bidPrice, marketValue: b.marketValue } : best;
  }, null);
  return { recentSessions: sessions, buyRate: buys.length / sessions.length, avgDiscount, totalSpent, bestDeal };
};

const DEFAULT_BUYER_SETTINGS = { whatnotFee: 10, supplies: 0.75, labor: 2.0, minProfit: 5.0 };

const loadBuyerSettings = () => {
  try {
    const raw = localStorage.getItem("cv_buyer_settings");
    if (!raw) return { ...DEFAULT_BUYER_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BUYER_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BUYER_SETTINGS };
  }
};

function BidCalculator({ marketValue, detectedPrice, resultTitle, resultGrade, onLogSession }) {
  const [bid, setBid] = useState("");
  const [budget, setBudget] = useState(() => localStorage.getItem("cv_buyer_budget") || "");
  const [seeded, setSeeded] = useState(false);
  const [logged, setLogged] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(loadBuyerSettings);

  useEffect(() => {
    if (detectedPrice && !seeded) {
      const cleaned = String(detectedPrice).replace(/[^0-9.]/g, "");
      if (cleaned && parseFloat(cleaned) > 0) {
        setBid(cleaned);
        setSeeded(true);
      }
    }
  }, [detectedPrice, seeded]);

  useEffect(() => {
    if (budget) localStorage.setItem("cv_buyer_budget", budget);
  }, [budget]);

  useEffect(() => {
    localStorage.setItem("cv_buyer_settings", JSON.stringify(settings));
  }, [settings]);

  const bidNum = parseFloat(bid);
  const budgetNum = parseFloat(budget);
  const hasBid = !isNaN(bidNum) && bidNum > 0;
  const hasBudget = !isNaN(budgetNum) && budgetNum > 0;
  const hasMV = marketValue != null && marketValue > 0;

  const feePct = parseFloat(settings.whatnotFee) || 0;
  const supplies = parseFloat(settings.supplies) || 0;
  const labor = parseFloat(settings.labor) || 0;
  const minProfit = parseFloat(settings.minProfit) || 0;

  const whatnotFeeAmt = hasMV ? marketValue * (feePct / 100) : 0;
  const netProfit = hasMV && hasBid
    ? marketValue - whatnotFeeAmt - supplies - labor - bidNum
    : null;

  const overBudget = hasBid && hasBudget && bidNum > budgetNum;

  let verdictColor = "#aaa";
  if (netProfit != null) {
    if (netProfit >= minProfit) verdictColor = "#16a34a";
    else if (netProfit > 0) verdictColor = "#d4af37";
    else verdictColor = "#e05656";
  }
  const shouldBuy = netProfit != null && netProfit >= minProfit && !overBudget;

  const logDecision = (decision) => {
    if (logged) return;
    const entry = {
      title: resultTitle || "Unknown",
      marketValue: marketValue || 0,
      bidPrice: bidNum || 0,
      budget: budgetNum || 0,
      netProfit: netProfit != null ? Math.round(netProfit * 100) / 100 : 0,
      decision,
    };
    saveSession(entry);
    setLogged(true);
    if (onLogSession) onLogSession(entry);
  };

  const updateSetting = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="calc-card">
      {/* Header: title + grade + settings gear */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {resultTitle && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resultTitle}
            </div>
          )}
          {resultGrade && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{resultGrade}</div>
          )}
        </div>
        <button
          onClick={() => setShowSettings((s) => !s)}
          style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
            padding: "4px 8px", fontSize: 14, color: "#aaa", cursor: "pointer", lineHeight: 1,
          }}
          aria-label="Settings"
        >⚙</button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
          padding: 12, marginBottom: 12, background: "rgba(255,255,255,0.03)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#d4af37", marginBottom: 8 }}>Buyer settings</div>
          {[
            { k: "whatnotFee", label: "Whatnot fee %", step: "0.5" },
            { k: "supplies", label: "Supplies $", step: "0.25" },
            { k: "labor", label: "Labor $", step: "0.5" },
            { k: "minProfit", label: "Min profit $", step: "0.5" },
          ].map(({ k, label, step }) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#aaa" }}>{label}</span>
              <input
                type="number" inputMode="decimal" step={step}
                value={settings[k]}
                onChange={(e) => updateSetting(k, e.target.value)}
                style={{
                  width: 80, padding: "4px 8px", borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.15)", background: "#1a1a1a",
                  color: "#fff", fontSize: 13, textAlign: "right",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Inputs: budget + bid */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="calc-label">Budget</label>
          <div className="calc-input-wrap">
            <span className="calc-dollar">$</span>
            <input type="number" inputMode="decimal" placeholder="50" value={budget} onChange={(e) => setBudget(e.target.value)} className="calc-input" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label className="calc-label">Bid / Ask</label>
          <div className="calc-input-wrap">
            <span className="calc-dollar">$</span>
            <input type="number" inputMode="decimal" placeholder="0" value={bid} onChange={(e) => setBid(e.target.value)} className="calc-input" />
          </div>
        </div>
      </div>

      {/* NET PROFIT hero */}
      {hasMV && hasBid ? (
        <div style={{ textAlign: "center", padding: "14px 0 8px" }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#888", fontWeight: 700 }}>NET PROFIT</div>
          <div style={{ fontSize: 52, fontWeight: 900, color: verdictColor, lineHeight: 1.05, marginTop: 4 }}>
            {netProfit >= 0 ? "$" : "-$"}{Math.abs(Math.round(netProfit))}
          </div>
          {overBudget && (
            <div style={{ fontSize: 12, color: "#e05656", marginTop: 4 }}>
              Over budget by ${Math.round(bidNum - budgetNum)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "14px 0 8px", color: "#666", fontSize: 13 }}>
          {!hasMV ? "Scan a comic to see net profit" : "Enter a bid"}
        </div>
      )}

      {/* BUY / PASS */}
      {hasMV && hasBid && (
        <button
          onClick={() => logDecision(shouldBuy ? "BUY" : "PASS")}
          disabled={logged}
          style={{
            width: "100%", padding: "16px 0", borderRadius: 10, border: "none",
            fontWeight: 900, fontSize: 20, letterSpacing: 2, cursor: logged ? "default" : "pointer",
            background: logged ? "rgba(255,255,255,0.06)" : (shouldBuy ? "#16a34a" : "#e05656"),
            color: logged ? "#666" : "#fff", marginTop: 6,
          }}
        >{logged ? "LOGGED" : (shouldBuy ? "BUY" : "PASS")}</button>
      )}

      {/* See details */}
      {hasMV && hasBid && (
        <>
          <button
            onClick={() => setShowDetails((s) => !s)}
            style={{
              width: "100%", padding: "8px 0", marginTop: 8, background: "transparent",
              border: "none", color: "#888", fontSize: 12, cursor: "pointer",
            }}
          >See details {showDetails ? "▾" : "›"}</button>
          {showDetails && (
            <div style={{ fontSize: 12, color: "#aaa", padding: "0 4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Market value</span><span style={{ color: "#ddd" }}>{fmt(marketValue)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Whatnot fee ({feePct}%)</span><span>-${whatnotFeeAmt.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Supplies</span><span>-${supplies.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Labor</span><span>-${labor.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>Your bid</span><span>-${bidNum.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 4, fontWeight: 700 }}>
                <span style={{ color: "#ddd" }}>Net profit</span>
                <span style={{ color: verdictColor }}>${netProfit.toFixed(2)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FloatingSearchBar({ value, onChange, items, onAskClaude, onClaudeCardChange }) {
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aiResponse, setAiResponse] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInput, setAiInput] = useState(""); // separate state for Claude queries
  const [mode, setMode] = useState("search"); // "search" or "claude"
  const recognitionRef = useRef(null);
  const silenceTimer = useRef(null);
  const inputRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);

  const isAiQuery = (text) => {
    const t = text.trim().toLowerCase();
    if (t.startsWith("ask ")) return true;
    if (/^(what|which|who|how|why|show me|find|tell|suggest|recommend|should|is there|are there|do i|any )/i.test(t)) return true;
    return false;
  };

  const submitAiQuery = useCallback(async (text) => {
    const query = text.replace(/^ask\s+/i, "").trim();
    if (!query || !items) return;
    setAiLoading(true);
    setAiResponse(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query, collection: items, history: [], buyerSessions: getSessionSummary() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAiResponse(data.response || "No response.");
      if (onAskClaude) onAskClaude(data);
    } catch {
      setAiResponse("Something went wrong. Try again.");
    } finally {
      setAiLoading(false);
    }
  }, [items, onAskClaude]);

  const displayValue = mode === "claude" ? aiInput : value;
  const handleInputChange = (text) => {
    if (mode === "claude") {
      setAiInput(text);
    } else {
      // Auto-detect AI query and switch modes
      if (isAiQuery(text)) {
        setMode("claude");
        setAiInput(text);
        onChange(""); // clear filter
      } else {
        onChange(text);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && mode === "claude" && aiInput.trim()) {
      submitAiQuery(aiInput);
    }
  };

  const clearAll = () => {
    onChange("");
    setAiInput("");
    setAiResponse(null);
    setMode("search");
  };

  const claudeCardVisible = !!(aiResponse || aiLoading);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
    }
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setListening(false);
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#d4af37";
      ctx.beginPath();
      const sliceW = canvas.width / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };
    draw();
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognitionRef.current = rec;

    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join("");
      if (isAiQuery(transcript)) {
        setMode("claude");
        setAiInput(transcript);
        onChange("");
      } else {
        onChange(transcript);
      }
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (e.results[e.results.length - 1].isFinal) {
        silenceTimer.current = setTimeout(() => {
          stopListening();
          if (isAiQuery(transcript)) submitAiQuery(transcript);
        }, 1500);
      }
    };
    rec.onerror = () => stopListening();
    rec.onend = () => stopListening();
    rec.start();
    setListening(true);

    navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
      streamRef.current = stream;
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      drawWaveform();
    }).catch(() => {});
  }, [onChange, stopListening, drawWaveform, submitAiQuery]);

  useEffect(() => () => stopListening(), [stopListening]);

  const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (onClaudeCardChange) onClaudeCardChange(claudeCardVisible);
  }, [claudeCardVisible, onClaudeCardChange]);

  return (
    <div style={{
      position: "fixed", bottom: 70, left: 0, right: 0,
      maxWidth: 480, margin: "0 auto",
      padding: "0 12px", zIndex: 20,
      pointerEvents: "none",
    }}>
      {/* Claude AI response bubble */}
      {claudeCardVisible && (
        <div style={{
          background: "rgba(18,18,18,0.95)", backdropFilter: "blur(12px)",
          border: "1px solid rgba(212,175,55,0.3)", borderRadius: 16,
          padding: "12px 14px", marginBottom: 8,
          pointerEvents: "auto", maxHeight: 200, overflowY: "auto",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#d4af37", fontWeight: 600 }}>Claude</span>
            <button
              onClick={clearAll}
              style={{ background: "transparent", border: "none", color: "#666", fontSize: 14, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}
            >✕</button>
          </div>
          {aiLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 14, height: 14, border: "2px solid rgba(212,175,55,0.3)", borderTopColor: "#d4af37", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ color: "#d4af37", fontSize: 13 }}>Thinking...</span>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "#e0e0e0" }}>{aiResponse}</div>
          )}
        </div>
      )}

      {/* Search bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "rgba(18,18,18,0.95)", backdropFilter: "blur(12px)",
        border: `1px solid ${mode === "claude" ? "rgba(212,175,55,0.6)" : "rgba(212,175,55,0.35)"}`, borderRadius: 28,
        padding: "6px 6px 6px 16px", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        pointerEvents: "auto",
      }}>
        {expanded ? (
          <>
            {/* Mode toggle */}
            <button
              onClick={() => { setMode(mode === "claude" ? "search" : "claude"); }}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: 16, flexShrink: 0, padding: "2px 4px",
                color: mode === "claude" ? "#d4af37" : "#888",
              }}
              aria-label={mode === "claude" ? "Switch to search" : "Switch to Claude"}
            >{mode === "claude" ? "🧠" : "🔍"}</button>
            <input
              ref={inputRef}
              type="text"
              placeholder={mode === "claude" ? 'Ask Claude about your collection...' : 'Filter by title, "key", "$100+"...'}
              value={displayValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#fff", fontSize: 15, padding: "6px 0",
              }}
            />
            {listening && (
              <canvas ref={canvasRef} width={60} height={28} style={{ flexShrink: 0, opacity: 0.9 }} />
            )}
            {displayValue && (
              <button
                onClick={clearAll}
                style={{ background: "transparent", border: "none", color: "#aaa", fontSize: 18, cursor: "pointer", padding: "4px 6px", lineHeight: 1 }}
              >✕</button>
            )}
            {hasSpeech && (
              <button
                onClick={listening ? stopListening : startListening}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: listening ? "#d4af37" : "rgba(255,255,255,0.1)",
                  color: listening ? "#000" : "#d4af37", fontSize: 18, transition: "all 0.2s",
                }}
                aria-label={listening ? "Stop voice" : "Voice search"}
              >{listening ? "⏹" : "🎤"}</button>
            )}
            {mode === "claude" && aiInput.trim() && !aiLoading && (
              <button
                onClick={() => submitAiQuery(aiInput)}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: "#d4af37", color: "#000", fontSize: 16, fontWeight: 700,
                }}
                aria-label="Ask Claude"
              >→</button>
            )}
            <button
              onClick={() => { setExpanded(false); stopListening(); }}
              style={{ background: "transparent", border: "none", color: "#888", fontSize: 14, cursor: "pointer", padding: "4px 8px", fontWeight: 600 }}
            >Done</button>
          </>
        ) : (
          <button
            onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 100); }}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8,
              background: "transparent", border: "none", cursor: "pointer",
              color: "#888", fontSize: 15, padding: "6px 0", textAlign: "left",
            }}
          >
            <span style={{ fontSize: 16 }}>🔍</span>
            <span>{value || 'Search or ask Claude...'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function CollectionList({ items, totalValue, onOpen, onDelete, refreshingPrices, snapshots, bulkEnrichProgress }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [sortBy, setSortBy] = useState("recent");
  const [eraFilter, setEraFilter] = useState("all");
  const [localSearch, setLocalSearch] = useState("");
  const [importStatus, setImportStatus] = useState(null);
  const [claudeCardVisible, setClaudeCardVisible] = useState(false);
  const [backupBanner, setBackupBanner] = useState(false);
  const importRef = useRef(null);

  // Track collection changes for backup reminder
  useEffect(() => {
    if (items.length === 0) return;
    const lastBackup = localStorage.getItem("cv_last_backup_date");
    const lastCount = parseInt(localStorage.getItem("cv_last_backup_count") || "0", 10);
    if (!lastBackup || items.length !== lastCount) {
      setBackupBanner(true);
    }
  }, [items.length]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(items.map((i) => i.id)));
  const cancelSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const deleteSelected = () => {
    if (!confirm(`Delete ${selected.size} comic${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    for (const id of selected) onDelete(id);
    setSelected(new Set());
    setSelectMode(false);
  };

  const exportJSON = () => {
    const data = items.map(({ images, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comic-vault-export-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const cols = ["title","issue","publisher","year","grade","isGraded","numericGrade","keyIssue","price","pricingSource","status","ebayUrl","purchasePrice","timestamp"];
    const escape = (v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [cols.join(",")];
    for (const item of items) {
      rows.push(cols.map((c) => escape(item[c])).join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comic-vault-export-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const backupToDrive = () => {
    const data = items.map(({ images, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `comic-vault-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem("cv_last_backup_date", date);
    localStorage.setItem("cv_last_backup_count", String(items.length));
    setBackupBanner(false);
    setTimeout(() => {
      window.open("https://drive.google.com/drive/my-drive", "_blank");
    }, 500);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (importRef.current) importRef.current.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) { setImportStatus("Invalid file: expected JSON array"); return; }
      const existing = new Set(items.map((c) => `${c.title}|${c.issue}|${c.year}`));
      let imported = 0, skipped = 0;
      for (let i = 0; i < parsed.length; i++) {
        const c = parsed[i];
        if (!c || !c.title) { skipped++; continue; }
        const key = `${c.title}|${c.issue}|${c.year}`;
        if (existing.has(key)) { skipped++; continue; }
        existing.add(key);
        const entry = {
          ...c,
          id: c.id || `cv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          timestamp: c.timestamp || Date.now(),
          images: c.images || [],
        };
        await putComic(entry);
        imported++;
        if (i % 10 === 0) setImportStatus(`Importing ${i + 1} of ${parsed.length}...`);
      }
      setImportStatus(`Imported ${imported}, skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""}`);
      if (imported > 0) window.location.reload();
    } catch (err) {
      setImportStatus(`Import failed: ${err.message}`);
    }
  };

  // Value trend sparkline from snapshots
  const trendData = (snapshots || []).slice(-30);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const weekAgoSnap = trendData.find((s) => s.date >= weekAgo) || trendData[0];
  const latestSnap = trendData[trendData.length - 1];
  const weekDelta = latestSnap && weekAgoSnap ? latestSnap.totalValue - weekAgoSnap.totalValue : null;

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="upload-emoji">📚</div>
        <div className="muted">No comics in your collection yet.</div>
        <div className="muted small">Scanned comics will appear here.</div>
        <input ref={importRef} type="file" accept=".json" onClick={(e) => { e.target.value = null; }} onChange={handleImport} hidden />
        <button
          onClick={() => importRef.current?.click()}
          style={{ marginTop: 12, fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(212,175,55,0.4)", background: "transparent", color: "#d4af37", cursor: "pointer", fontWeight: 600 }}
        >Import Collection</button>
        <div className="muted small" style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>Tip: Find your backup in Downloads folder</div>
        {importStatus && <div className="muted small" style={{ marginTop: 8 }}>{importStatus}</div>}
      </div>
    );
  }

  return (
    <>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#d4af37", textAlign: "center", padding: "8px 0 4px", letterSpacing: 0.5 }}>
        Comic Vault
      </div>
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
      {/* Value trend sparkline */}
      {trendData.length >= 2 && (() => {
        const vals = trendData.map((s) => s.totalValue);
        const minV = Math.min(...vals);
        const maxV = Math.max(...vals);
        const range = maxV - minV || 1;
        const w = 300;
        const h = 60;
        const pad = 4;
        const points = vals.map((v, i) => {
          const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
          const y = h - pad - ((v - minV) / range) * (h - pad * 2);
          return `${x},${y}`;
        });
        return (
          <div style={{ margin: "8px 0" }}>
            {weekDelta != null && (
              <div style={{ fontSize: 12, fontWeight: 600, textAlign: "center", marginBottom: 4, color: weekDelta >= 0 ? "#16a34a" : "#e05656" }}>
                {weekDelta >= 0 ? "\u2191" : "\u2193"} {fmt(Math.abs(weekDelta))} since last week
              </div>
            )}
            <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 60 }}>
              <polyline points={points.join(" ")} fill="none" stroke="#FFD700" strokeWidth="2" strokeLinejoin="round" />
              {points.map((p, i) => (
                <circle key={i} cx={p.split(",")[0]} cy={p.split(",")[1]} r="2.5" fill="#FFD700" />
              ))}
            </svg>
          </div>
        );
      })()}

      {refreshingPrices > 0 && (
        <div className="muted small" style={{ textAlign: "center", margin: "4px 0 8px" }}>
          Updating prices... ({refreshingPrices} remaining)
        </div>
      )}

      {bulkEnrichProgress && bulkEnrichProgress.current < bulkEnrichProgress.total && (
        <div className="muted small" style={{ textAlign: "center", margin: "4px 0 8px", color: "#4caf50" }}>
          Fetching market data… {bulkEnrichProgress.current} of {bulkEnrichProgress.total}
        </div>
      )}

      {/* Backup banner */}
      {backupBanner && (
        <div
          onClick={backupToDrive}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 12px", margin: "4px 0", borderRadius: 8, background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.3)", cursor: "pointer" }}
        >
          <span style={{ fontSize: 13, color: "#d4af37", fontWeight: 600 }}>Collection updated — tap to backup to Drive</span>
          <button onClick={(e) => { e.stopPropagation(); setBackupBanner(false); }} style={{ background: "transparent", border: "none", color: "#888", fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>&times;</button>
        </div>
      )}

      {/* Select mode header */}
      <input ref={importRef} type="file" accept=".json" onClick={(e) => { e.target.value = null; }} onChange={handleImport} hidden />
      {importStatus && <div className="muted small" style={{ textAlign: "center", margin: "4px 0" }}>{importStatus}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "4px 0", marginBottom: 4 }}>
        {selectMode ? (
          <>
            <span className="muted small" style={{ marginRight: "auto" }}>
              {selected.size} selected
            </span>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(212,175,55,0.4)", background: "transparent", color: "#d4af37", cursor: "pointer", fontWeight: 600 }}
              onClick={selectAll}
            >Select All</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid #e05656", background: selected.size > 0 ? "#e05656" : "transparent", color: selected.size > 0 ? "#fff" : "#e05656", cursor: selected.size > 0 ? "pointer" : "default", fontWeight: 700, opacity: selected.size > 0 ? 1 : 0.4 }}
              onClick={deleteSelected}
              disabled={selected.size === 0}
            >Delete Selected</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={cancelSelect}
            >Cancel</button>
          </>
        ) : (
          <>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(212,175,55,0.25)", background: "rgba(212,175,55,0.08)", color: "#d4af37", cursor: "pointer", fontWeight: 600 }}
              onClick={backupToDrive}
            >Backup to Drive</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={exportJSON}
            >Export</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={exportCSV}
            >CSV</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={() => importRef.current?.click()}
            >Import</button>
            <button
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#aaa", cursor: "pointer" }}
              onClick={() => setSelectMode(true)}
            >Select</button>
          </>
        )}
      </div>

      {/* Sort bar */}
      <div style={{ display: "flex", gap: 4, padding: "4px 0", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {[["value", "Value ↓"], ["title", "Title"], ["year", "Year"], ["grade", "Grade"], ["recent", "Recent"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: sortBy === key ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.12)", background: sortBy === key ? "rgba(212,175,55,0.15)" : "transparent", color: sortBy === key ? "#d4af37" : "#aaa", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
          >{label}</button>
        ))}
      </div>

      {/* Era filter pills */}
      <div style={{ display: "flex", gap: 4, padding: "4px 0 8px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {[["all", "All"], ["silver", "Silver Age"], ["bronze", "Bronze"], ["modern", "Modern"], ["keys", "Keys"], ["listed", "Listed"], ["unlisted", "Unlisted"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setEraFilter(eraFilter === key ? "all" : key)}
            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, border: eraFilter === key && key !== "all" ? "none" : "1px solid rgba(255,255,255,0.12)", background: eraFilter === key && key !== "all" ? "#FFD700" : eraFilter === key ? "rgba(212,175,55,0.15)" : "transparent", color: eraFilter === key && key !== "all" ? "#000" : eraFilter === key ? "#d4af37" : "#aaa", cursor: "pointer", fontWeight: eraFilter === key ? 700 : 600, whiteSpace: "nowrap" }}
          >{label}</button>
        ))}
      </div>

      <FloatingSearchBar value={localSearch} onChange={setLocalSearch} items={items} onClaudeCardChange={setClaudeCardVisible} />

      {(() => {
        const sq = localSearch.toLowerCase().trim();
        const searchFilter = (item) => {
          if (!sq) return true;
          const priceMatch = sq.match(/^\$(\d+)\+?$/);
          if (priceMatch) return (getDisplayPrice(item) || 0) >= parseInt(priceMatch[1]);
          if (sq === "key" || sq === "keys") return showKeyIssue(item.keyIssue);
          if (sq === "listed") return item.status === "listed";
          if (sq === "unlisted") return item.status !== "listed";
          const hay = `${item.title} ${item.publisher} ${item.year} ${item.grade} ${item.keyIssue}`.toLowerCase();
          return hay.includes(sq);
        };
        const filteredItems = items
          .filter(searchFilter)
          .filter((item) => {
            if (eraFilter === "all") return true;
            const yr = parseInt(item.year, 10);
            if (eraFilter === "silver") return yr >= 1956 && yr <= 1969;
            if (eraFilter === "bronze") return yr >= 1970 && yr <= 1985;
            if (eraFilter === "modern") return yr >= 1986;
            if (eraFilter === "keys") return showKeyIssue(item.keyIssue);
            if (eraFilter === "listed") return item.status === "listed";
            if (eraFilter === "unlisted") return item.status !== "listed";
            return true;
          })
          .sort((a, b) => {
            if (sortBy === "value") return (getDisplayPrice(b) || 0) - (getDisplayPrice(a) || 0);
            if (sortBy === "title") return (a.title || "").localeCompare(b.title || "");
            if (sortBy === "year") return (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0);
            if (sortBy === "grade") return (b.numericGrade || 0) - (a.numericGrade || 0);
            if (sortBy === "recent") return (b.timestamp || 0) - (a.timestamp || 0);
            return 0;
          });
        const isFiltered = eraFilter !== "all" || sq;
        return (
          <>
            {isFiltered && (
              <div className="muted small" style={{ textAlign: "center", marginBottom: 6 }}>
                Showing {filteredItems.length} of {items.length} comics
              </div>
            )}
            <div className="collection-list" style={{ paddingBottom: claudeCardVisible ? 220 : 100 }}>
              {filteredItems.map((item) => {
          const thumbSrc = getComicPhotos(item)[0] || null;
          const extractIssueFromReport = (txt) => {
            if (!txt) return null;
            const m = String(txt).match(/#\s*(\d+)/);
            return m ? m[1] : null;
          };
          const displayIssue = item.issue || extractIssueFromReport(item.conditionReport || item.notes || '');
          const titleWithIssue = (item.title || "Unknown") + (displayIssue && !String(item.title || "").includes('#' + displayIssue) ? ` #${displayIssue}` : '');
          const gradeTxt = item.isGraded === true && item.numericGrade != null
            ? `CGC ${item.numericGrade}`
            : (() => {
                if (!item.grade) return null;
                const g = String(item.grade).trim();
                const hasLetters = /[A-Z]/i.test(g);
                const hasNumber = /\d/.test(g);
                if (hasLetters && hasNumber) return g;
                if (hasLetters && !hasNumber) {
                  const RAW_NUMS = { "NM/M": "9.8", "NM": "9.4", "VF/NM": "8.5", "VF": "7.5", "VF/F": "7.0", "FN/VF": "6.5", "FN": "6.0", "VG/FN": "5.0", "VG": "4.0", "VG/G": "3.5", "GD/VG": "3.0", "GD": "2.0", "GD-": "1.8", "FR/GD": "1.5", "FR": "1.0", "PR": "0.5" };
                  const abbrev = g.toUpperCase().replace(/\s+/g, "");
                  return RAW_NUMS[abbrev] ? `${g} ${RAW_NUMS[abbrev]}` : g;
                }
                return g;
              })();
          const isSelected = selected.has(item.id);
          return (
          <div
            key={item.id}
            className="collection-item"
            style={isSelected ? { background: "rgba(212,175,55,0.1)" } : undefined}
            onClick={() => selectMode ? toggleSelect(item.id) : onOpen(item)}
          >
            {selectMode && (
              <div
                style={{ display: "flex", alignItems: "center", paddingRight: 8, cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: 4,
                  border: isSelected ? "2px solid #d4af37" : "2px solid rgba(255,255,255,0.25)",
                  background: isSelected ? "#d4af37" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, color: "#000", fontWeight: 700,
                }}>{isSelected ? "✓" : ""}</div>
              </div>
            )}
            {thumbSrc ? (
              <img src={thumbSrc} alt="" loading="lazy" className="thumb" />
            ) : (
              <div className="thumb thumb-placeholder">📘</div>
            )}
            <div className="collection-meta">
              <div className="cl-row1">
                <span className="collection-title">{titleWithIssue}</span>
                {getDisplayPrice(item) > 0 && (
                  <span className="collection-price">${getDisplayPrice(item).toLocaleString("en-US")}</span>
                )}
              </div>
              {item.variant && !['cover a','corner box','masterpieces'].some(v => item.variant.toLowerCase().includes(v)) && (
                <div style={{ fontSize: 11, color: '#d4af37', marginTop: 1 }}>⚡ {item.variant}</div>
              )}
              <div className="cl-row2 muted small">
                {item.publisher}{item.publisher && item.year ? " · " : ""}{item.year}{gradeTxt ? ` · ${gradeTxt}` : ""}
              </div>
              {(() => {
                const soldLow = item.soldComps?.[0]?.price;
                const askLow = item.comps?.lowestNum;
                const askHigh = item.comps?.highestNum;
                if (!soldLow && !askLow) return null;
                return (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                    {soldLow ? `Last sold $${Math.round(soldLow)}` : ''}
                    {soldLow && askLow ? ' · ' : ''}
                    {askLow ? `Asking $${Math.round(askLow)}` : ''}
                    {askHigh && askHigh !== askLow ? `–$${Math.round(askHigh)}` : ''}
                  </div>
                );
              })()}
              {(showKeyIssue(item.keyIssue) || item.status === "listed" || item.purchasePrice > 0) && (
                <div className="cl-row3">
                  {showKeyIssue(item.keyIssue) && <span className="pill pill-key">KEY</span>}
                  {item.status === "listed" && <span className="pill pill-listed">LISTED</span>}
                  {item.purchasePrice > 0 && getDisplayPrice(item) > 0 && (() => {
                    const roi = ((getDisplayPrice(item) - item.purchasePrice) / item.purchasePrice) * 100;
                    const pos = roi >= 0;
                    return (
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, fontWeight: 700, background: pos ? "rgba(22,163,106,0.2)" : "rgba(224,86,86,0.2)", color: pos ? "#16a34a" : "#e05656" }}>
                        {pos ? "+" : ""}{Math.round(roi)}%
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
            {!selectMode && (
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${titleWithIssue}"?`)) onDelete(item.id);
                }}
                aria-label="Delete"
              >
                ✕
              </button>
            )}
          </div>
          );
              })}
            </div>
          </>
        );
      })()}
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
  onUpdateField,
  currentIndex,
  totalItems,
  onPrev,
  onNext,
}) {
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [addPhotoError, setAddPhotoError] = useState(null);
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [ppInput, setPpInput] = useState(item.purchasePrice != null ? String(item.purchasePrice) : "");
  const [listPrice, setListPrice] = useState(() => getDisplayPrice(item));
  const [swipeHint, setSwipeHint] = useState(() => !localStorage.getItem("cv_swipe_hint_seen"));
  const addPhotoRef = useRef(null);
  const touchStartX = useRef(null);

  useEffect(() => {
    setListPrice(getDisplayPrice(item));
  }, [item?.id]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onPrev, onNext]);

  useEffect(() => {
    if (!swipeHint) return;
    const t = setTimeout(() => {
      setSwipeHint(false);
      localStorage.setItem("cv_swipe_hint_seen", "1");
    }, 2000);
    return () => clearTimeout(t);
  }, [swipeHint]);

  const photos = getComicPhotos(item);
  const canAddMore = photos.length < 4;
  const isListed = item.status === "listed" && item.ebayUrl;

  // Pricing: single source of truth via getDisplayPrice.
  const hasComps =
    item.comps &&
    Array.isArray(item.comps.recentSales) &&
    item.comps.recentSales.length > 0;
  const displayPrice = getDisplayPrice(item);
  const recommendedLabel = displayPrice > 0
    ? `$${displayPrice.toLocaleString("en-US")}`
    : "—";

  // Grade badge: CGC numeric if graded, raw grade if available, else RAW COPY.
  const gradeBadgeText =
    item.isGraded === true && item.numericGrade != null
      ? `CGC ${item.numericGrade}`
      : item.grade || "RAW COPY";

  const conditionBullets = parseConditionReport(item.reason);
  const confidenceText = formatConfidence(item.confidence);
  const scannedText = item.timestamp
    ? new Date(item.timestamp).toLocaleString()
    : null;

  const handleList = async () => {
    setListing(true);
    setListError(null);
    try {
      const overridePrice = parseFloat(listPrice);
      const itemToList = overridePrice > 0
        ? { ...item, price: `$${overridePrice.toFixed(2)}` }
        : item;
      await onList(itemToList);
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
    <div
      className="detail-view"
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchStartX.current === null) return;
        const diff = touchStartX.current - e.changedTouches[0].clientX;
        touchStartX.current = null;
        if (Math.abs(diff) < 50) return;
        if (diff > 0) { onNext && onNext(); }
        else { onPrev && onPrev(); }
      }}
    >
      {swipeHint && totalItems > 1 && (
        <div style={{ textAlign: "center", fontSize: 11, color: "rgba(212,175,55,0.6)", marginBottom: 4, transition: "opacity 0.5s", animation: "fadeOut 2s forwards" }}>
          ← swipe to navigate →
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <button className="back-btn" onClick={onBack} style={{ margin: 0 }}>← Back</button>
        {totalItems > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onPrev}
              disabled={currentIndex <= 0}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: currentIndex <= 0 ? "#555" : "#d4af37", cursor: currentIndex <= 0 ? "default" : "pointer", padding: "4px 10px", fontSize: 14, fontWeight: 700 }}
            >←</button>
            <span className="muted small">{currentIndex + 1} of {totalItems}</span>
            <button
              onClick={onNext}
              disabled={currentIndex >= totalItems - 1}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: currentIndex >= totalItems - 1 ? "#555" : "#d4af37", cursor: currentIndex >= totalItems - 1 ? "default" : "pointer", padding: "4px 10px", fontSize: 14, fontWeight: 700 }}
            >→</button>
          </div>
        )}
      </div>

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
        {(() => {
          const PHOTO_LABELS = ['Front', 'Back', 'Spine', 'Pages'];
          const missing = PHOTO_LABELS.slice(Math.min(photos.length, 4));
          if (missing.length === 0) return null;
          return missing.map((label) => (
            <button
              key={label}
              onClick={handleAddPhotoClick}
              disabled={addingPhoto}
              style={{
                height: 120,
                minWidth: 80,
                width: 80,
                flexShrink: 0,
                border: "2px dashed rgba(212,175,55,0.5)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                color: "#d4af37",
                fontSize: 11,
                fontWeight: 600,
                cursor: addingPhoto ? "wait" : "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: 6,
              }}
            >
              {addingPhoto ? (
                <div style={{ width: 20, height: 20, border: "2px solid rgba(212,175,55,0.3)", borderTopColor: "#d4af37", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              ) : (
                <>
                  <span style={{ fontSize: 20, lineHeight: 1, opacity: 0.6 }}>{"\uD83D\uDCF7"}</span>
                  <span>{label}</span>
                </>
              )}
            </button>
          ));
        })()}
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
        {item.title || "Unknown"}{item.issue && !String(item.title || "").includes('#' + item.issue) ? ` #${item.issue}` : ''}
      </div>
      <div className="muted small">
        {item.publisher}
        {item.publisher && item.year ? " · " : ""}
        {item.year}
      </div>
      {/* 2a. STATS BAR */}
      {(() => {
        const lastSoldPrice = item.soldComps?.[0]?.price || item.comps?.recentSales?.[0]?.price || null;
        const lastSoldLabel = lastSoldPrice ? '$' + Math.round(lastSoldPrice) : null;
        const activeLoNum = item.comps?.lowestNum;
        const activeHiNum = item.comps?.highestNum;
        const activeAvgNum = item.comps?.averageNum;
        const activeLow = activeLoNum ? '$' + Math.round(activeLoNum) : null;
        const activeHigh = activeHiNum ? '$' + Math.round(activeHiNum) : null;
        const activeRange = activeLow && activeHigh ? activeLow + '\u2013' + activeHigh : (activeAvgNum ? '$' + Math.round(activeAvgNum) : null);
        const dp = getDisplayPrice(item);
        return (
          <div style={{ fontSize: 12, color: '#888', marginTop: 4, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 12, color: '#d4af37', fontWeight: 600 }}>{item.grade || 'RAW'}</span>
            {dp > 0 && <span>${dp.toLocaleString('en-US')}</span>}
            {lastSoldLabel && <span>· Last sold {lastSoldLabel}</span>}
            {activeRange && <span>· Asking {activeRange}</span>}
          </div>
        );
      })()}

      {/* 2b. PURCHASE PRICE + ROI */}
      <div style={{ marginTop: 10 }}>
        <input
          type="text"
          inputMode="decimal"
          placeholder="What did you pay? (optional)"
          value={ppInput}
          onChange={(e) => setPpInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.target.blur();
            }
          }}
          onBlur={() => {
            const val = parseFloat(ppInput.replace(/[$,]/g, ""));
            const newVal = !isNaN(val) && val > 0 ? val : null;
            if (newVal !== item.purchasePrice) {
              onUpdateField?.(item, "purchasePrice", newVal);
            }
          }}
          style={{
            width: "100%", padding: "8px 12px", boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6, color: "#fff", fontSize: 14, outline: "none",
          }}
        />
        {item.purchasePrice > 0 && displayPrice > 0 && (() => {
          const gain = displayPrice - item.purchasePrice;
          const pct = (gain / item.purchasePrice) * 100;
          const pos = gain >= 0;
          return (
            <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 14 }}>
              <span className="muted">Paid: <strong>${item.purchasePrice.toLocaleString("en-US")}</strong></span>
              <span className="muted">Current: <strong>${displayPrice.toLocaleString("en-US")}</strong></span>
              <span style={{ fontWeight: 700, color: pos ? "#16a34a" : "#e05656" }}>
                ROI: {pos ? "+" : ""}{fmt(gain)} ({pos ? "+" : ""}{Math.round(pct)}%)
              </span>
            </div>
          );
        })()}
      </div>

      {/* 3. KEY ISSUE BLOCK */}
      {showKeyIssue(item.keyIssue) && (
        <div className="key-box" style={{ marginTop: 12 }}>
          ⭐ {item.keyIssue}
        </div>
      )}
      {item.variant && (
        <div style={{ color: "#FFD700", fontSize: 13, marginTop: 4, fontWeight: "bold" }}>
          ⚡ {item.variant}
        </div>
      )}

      {/* 3b. RESTORATION WARNING */}
      {item.restoration && (
        <div style={{ background: "#ff000022", border: "1px solid #ff4444", borderRadius: 6, padding: "8px 12px", marginTop: 8, color: "#ff6666" }}>
          ⚠️ RESTORED: {item.restoration}
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div className="muted small">Recommended list price</div>
            <div
              className="price"
              style={{ fontSize: 28, fontWeight: 800, color: "#d4af37" }}
            >
              {recommendedLabel}
            </div>
            {item.priceNote && (
              <div style={{ color: "#aaa", fontSize: 12, marginTop: 4 }}>
                {item.priceNote}
              </div>
            )}
          </div>
          {(() => {
            const cc = item.comps?.count || 0;
            const sc = Array.isArray(item.soldComps) ? item.soldComps.length : 0;
            const hasPriceData = item?.pricingSource === "pricecharting";
            const level = sc >= 2 ? "HIGH" : cc >= 2 ? "MEDIUM" : hasPriceData ? "MEDIUM" : "LOW";
            const bg = level === "HIGH" ? "rgba(22,163,106,0.2)" : level === "MEDIUM" ? "rgba(212,175,55,0.2)" : "rgba(245,158,11,0.2)";
            const fg = level === "HIGH" ? "#16a34a" : level === "MEDIUM" ? "#d4af37" : "#f59e0b";
            const label = level === "HIGH" ? "HIGH ✓" : level === "MEDIUM" ? "MED ~" : "AI EST";
            return (
              <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, fontWeight: 700, background: bg, color: fg, alignSelf: "flex-end", marginBottom: 4 }}>
                {label}
              </span>
            );
          })()}
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
            {/* LAST SOLD section */}
            {Array.isArray(item.soldComps) && item.soldComps.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                  Last Sold
                </div>
                {item.soldComps.slice(0, 3).map((s, i) => {
                  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 14 };
                  const inner = (
                    <>
                      <span className="muted small">
                        {s.daysAgo != null ? (s.daysAgo === 0 ? "today" : s.daysAgo === 1 ? "yesterday" : `${s.daysAgo} days ago`) : s.date || "—"}
                      </span>
                      <span style={{ fontWeight: 600, color: "#16a34a" }}>
                        {s.priceFormatted || fmtPrice(s.price)} <span style={{ fontSize: 11, opacity: 0.8 }}>SOLD</span>
                        {s.url && <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>}
                      </span>
                    </>
                  );
                  return s.url ? (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}>{inner}</a>
                  ) : (
                    <div key={i} style={rowStyle}>{inner}</div>
                  );
                })}
                <div style={{ borderTop: "1px solid rgba(212,175,55,0.25)", margin: "8px 0" }} />
              </div>
            )}

            {/* ACTIVE LISTINGS section */}
            <div
              className="muted small"
              style={{ textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}
            >
              Active Listings
            </div>
            {item.comps.recentSales.slice(0, 3).map((s, i) => {
              const rowStyle = { padding: "6px 0", fontSize: 14 };
              const inner = (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="muted small">{fmtSaleWhen(s.date, s.daysAgo)}</span>
                    <span style={{ fontWeight: 600, color: "#d4af37" }}>
                      {fmtPrice(s.price)}
                      {s.itemWebUrl && <span style={{ marginLeft: 4, fontSize: 12 }}>→</span>}
                    </span>
                  </div>
                  {s.title && (
                    <div style={{ fontSize: 11, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                      {s.title.length > 55 ? s.title.slice(0, 55) + "…" : s.title}
                    </div>
                  )}
                </div>
              );
              return s.itemWebUrl ? (
                <a key={i} href={s.itemWebUrl} target="_blank" rel="noopener noreferrer" style={{ ...rowStyle, textDecoration: "none", color: "inherit" }}>{inner}</a>
              ) : (
                <div key={i} style={rowStyle}>{inner}</div>
              );
            })}
            <div style={{ borderTop: "1px solid rgba(212,175,55,0.25)", margin: "8px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
              <span className="muted small">30-day average</span>
              <span style={{ fontWeight: 600 }}>{fmtPrice(item.comps.averageNum)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
              <span className="muted small">Recommended</span>
              <span style={{ fontWeight: 700, color: "#d4af37" }}>{recommendedLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 14 }}>
              <span className="muted small">Floor</span>
              <span style={{ fontWeight: 600, color: "#e05656" }}>{fmtPrice(item.comps.lowestNum)}</span>
            </div>
            {item.comps.highestNum != null && (
              <div className="muted small" style={{ marginTop: 4, fontSize: 12 }}>
                Low ${item.comps.lowestNum?.toLocaleString("en-US")} → Avg ${(Math.round((item.comps.averageNum || 0) * 100) / 100).toLocaleString("en-US")} → High ${item.comps.highestNum?.toLocaleString("en-US")}
              </div>
            )}
            {item.gradeMultiplier != null && (
              <div className="muted small" style={{ marginTop: 4, fontSize: 12 }}>
                Grade adj: ×{item.gradeMultiplier}{item.priceNote && /estimate|CGC/i.test(item.priceNote) ? ` (${item.priceNote})` : ""}
              </div>
            )}
            {item.variantMultiplier != null && (
              <div style={{ color: "#aaa", fontSize: 11, marginTop: 4 }}>
                Variant adj: ×{item.variantMultiplier}
              </div>
            )}
            <div className="muted small" style={{ marginTop: 6, fontStyle: "italic" }}>
              {item.pricingSource === "pricecharting"
                ? "Source: PriceCharting market data"
                : item.pricingSource === "browse_api"
                  ? "Source: Browse API — active listings"
                  : "Source: AI estimate"}
              {Array.isArray(item.soldComps) && item.soldComps.length > 0 && " + eBay sold"}
            </div>
            <div className="muted small" style={{ fontSize: 11 }}>
              {item.comps.source === "browse_api"
                ? `Based on ${item.comps.count} active eBay listing${item.comps.count !== 1 ? "s" : ""}`
                : `Based on ${item.comps.count} eBay sale${item.comps.count !== 1 ? "s" : ""} in last 30 days`}
              {item.comps.verifiedByAI ? " · AI verified" : ""}
            </div>
            {item.priceNote && /defect adj/i.test(item.priceNote) && (
              <div style={{ color: "#f59e0b", fontSize: 12, marginTop: 4 }}>
                Adjusted for cover defects
              </div>
            )}
          </div>
        )}

        {/* GoCollect CGC FMV panel */}
        {(item.goCollect || item.userFmv98) && (() => {
          const gc = item.goCollect || {};
          const fmv98 = item.userFmv98 || gc.fmv98;
          const fmv96 = gc.fmv96;
          const fmv94 = gc.fmv94;
          return (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid rgba(138,43,226,0.3)", borderRadius: 8, background: "rgba(138,43,226,0.06)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#8a2be2", marginBottom: 8 }}>CGC Fair Market Value</div>
              {fmv98 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                  <span style={{ color: "#aaa" }}>CGC 9.8</span>
                  <span style={{ fontWeight: 700, color: "#8a2be2" }}>${Number(fmv98).toLocaleString("en-US")}{item.userFmv98 ? " (manual)" : ""}</span>
                </div>
              )}
              {fmv96 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                  <span style={{ color: "#aaa" }}>CGC 9.6</span>
                  <span style={{ fontWeight: 600 }}>${Number(fmv96).toLocaleString("en-US")}</span>
                </div>
              )}
              {fmv94 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
                  <span style={{ color: "#aaa" }}>CGC 9.4</span>
                  <span style={{ fontWeight: 600 }}>${Number(fmv94).toLocaleString("en-US")}</span>
                </div>
              )}
              {gc.submitRecommended && (
                <div style={{ color: "#4caf50", fontSize: 12, marginTop: 6, fontWeight: 600 }}>
                  ⭐ Submit to CGC — {gc.submitGap}x return potential
                </div>
              )}
              {gc.fmv98 && !gc.submitRecommended && (
                <div style={{ color: "#888", fontSize: 11, marginTop: 4 }}>
                  Raw value similar to graded — sell raw or hold
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Override FMV 9.8"
                  defaultValue={item.userFmv98 || ""}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (v > 0) onUpdateField?.(item, "userFmv98", v);
                    else if (!e.target.value) onUpdateField?.(item, "userFmv98", null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(138,43,226,0.3)", background: "rgba(0,0,0,0.2)", color: "#ccc", fontSize: 12, boxSizing: "border-box" }}
                />
              </div>
              {gc.source && <div className="muted small" style={{ marginTop: 4, fontSize: 10 }}>Source: GoCollect</div>}
            </div>
          );
        })()}

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

        {item.cgcVerified === true && (
          <div style={{ background: "#00aa4422", border: "1px solid #00aa44", borderRadius: 6, padding: "6px 12px", marginTop: 8, color: "#00cc55", fontSize: 13 }}>
            ✓ CGC Verified · {item.certNumber} · {item.cgcLabel}
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
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ color: "#aaa", fontSize: 13 }}>List price</span>
              <input
                type="number"
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 700,
                  padding: "6px 10px",
                  width: 100,
                  textAlign: "right",
                }}
              />
            </div>
            <button
              className="reset-btn primary"
              onClick={handleList}
              disabled={listing || !(parseFloat(listPrice) > 0)}
              style={{ width: "100%" }}
            >
              {listing
                ? "Listing on eBay..."
                : `📋 List on eBay — $${listPrice || "0"}`}
            </button>
          </>
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

// --- Manage Tab: Claude Command Center ---

function ManagePage({ catalogue, totalValue, onOpenItem, onListComic, onBundleList }) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bundling, setBundling] = useState(false);
  const [bundleMsg, setBundleMsg] = useState(null);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const submitBundle = async () => {
    if (bundling || !onBundleList) return;
    const items = catalogue.filter((c) => selectedIds.has(c.id));
    if (items.length < 2) {
      setBundleMsg({ type: "err", text: "Select at least 2 comics" });
      return;
    }
    setBundling(true);
    setBundleMsg({ type: "info", text: `Creating bundle listing for ${items.length} comics…` });
    try {
      const r = await onBundleList(items);
      setBundleMsg({ type: "ok", text: `Bundle listed! ${r.count} comics → eBay #${r.ebayItemId}` });
      exitSelection();
      setTimeout(() => setBundleMsg(null), 4000);
    } catch (err) {
      setBundleMsg({ type: "err", text: err?.message || "Bundle listing failed" });
    } finally {
      setBundling(false);
    }
  };

  const [chatInput, setChatInput] = useState("");
  const [latestResponse, setLatestResponse] = useState(null);
  const [latestActions, setLatestActions] = useState([]);
  const [history, setHistory] = useState([]);
  const [sending, setSending] = useState(false);
  const totalCostBasis = catalogue.reduce((s, c) => s + (c.purchasePrice || 0), 0);
  const totalGain = totalValue - totalCostBasis;
  const totalGainPct = totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : null;
  const [metrics, setMetrics] = useState(() => {
    // Instant default metrics from local data — no API wait.
    const listed = catalogue.filter((c) => c.status === "listed").length;
    const keys = catalogue.filter((c) => showKeyIssue(c.keyIssue)).length;
    const stagnant = catalogue.filter((c) => c.status !== "listed" && (Date.now() - (c.timestamp || 0)) > 86400000 * 30).length;
    const m = [
      { label: "Total Value", value: fmt(totalValue), color: "green" },
      { label: "Listed", value: `${listed} of ${catalogue.length}`, color: listed < catalogue.length / 2 ? "red" : "green" },
      { label: "Key Issues", value: String(keys), color: keys > 0 ? "yellow" : "green" },
      { label: "Stagnant", value: String(stagnant), color: stagnant > 0 ? "red" : "green" },
    ];
    if (totalCostBasis > 0) {
      m.push({ label: "Cost Basis", value: fmt(totalCostBasis), color: "yellow" });
      m.push({ label: "Gain/Loss", value: `${totalGain >= 0 ? "+" : ""}${fmt(totalGain)}${totalGainPct != null ? ` (${totalGain >= 0 ? "+" : ""}${Math.round(totalGainPct)}%)` : ""}`, color: totalGain >= 0 ? "green" : "red" });
    }
    return m;
  });
  const [search, setSearch] = useState("");
  const [aiTags, setAiTags] = useState({});
  const [actionStatus, setActionStatus] = useState({});
  const [booted, setBooted] = useState(false);

  // Auto-fire Claude analysis on tab open.
  useEffect(() => {
    if (booted || catalogue.length === 0) return;
    setBooted(true);
    setSending(true);
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Give me a quick summary of my collection status and top 3 actions I should take right now",
        collection: catalogue,
        history: [],
        buyerSessions: getSessionSummary(),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.response) {
          setLatestResponse(data.response);
          setLatestActions(data.actions || []);
          setHistory([
            { role: "user", content: "Give me a quick summary of my collection status and top 3 actions I should take right now" },
            { role: "assistant", content: data.response },
          ]);
        }
        if (data.metrics?.length) {
        // Total Value must come from local getDisplayPrice sum — never from Claude.
        const filtered = data.metrics.filter((m) => m.label !== "Total Value");
        setMetrics((prev) => {
          const tv = prev.find((m) => m.label === "Total Value");
          return tv ? [tv, ...filtered] : filtered;
        });
      }
        applyAiTags(data);
      })
      .catch(() => {})
      .finally(() => setSending(false));
  }, [catalogue, booted]);

  const applyAiTags = (data) => {
    const tags = {};
    (data.actions || []).forEach((a) => {
      if (a.action === "list" && a.comicId) tags[a.comicId] = { emoji: "🔥", label: "HOT" };
      if (a.action === "bundle" && a.comicIds) {
        a.comicIds.forEach((id) => { tags[id] = { emoji: "📦", label: "BUNDLE" }; });
      }
    });
    catalogue.forEach((item) => {
      const marketVal = item.comps?.averageNum;
      const displayVal = getDisplayPrice(item);
      if (marketVal && displayVal < marketVal * 0.85) {
        if (!aiTags[item.id] && !tags[item.id]) {
          tags[item.id] = { emoji: "🔥", label: "HOT", reason: "Priced below market" };
        }
      }
    });
    catalogue.forEach((c) => {
      if (!tags[c.id] && c.status !== "listed" && (Date.now() - (c.timestamp || 0)) > 86400000 * 30) {
        tags[c.id] = { emoji: "⏳", label: "STAGNANT" };
      }
    });
    setAiTags((prev) => ({ ...prev, ...tags }));
  };

  const sendMessage = async (text) => {
    if (!text.trim() || sending) return;
    setChatInput("");
    setSending(true);
    const newHistory = [...history, { role: "user", content: text.trim() }];
    setHistory(newHistory);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          collection: catalogue,
          history: newHistory.slice(-10, -1),
          buyerSessions: getSessionSummary(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLatestResponse(data.response || "I couldn't analyze that.");
      setLatestActions(data.actions || []);
      setHistory((prev) => [...prev, { role: "assistant", content: data.response }]);
      if (data.metrics?.length) {
        // Total Value must come from local getDisplayPrice sum — never from Claude.
        const filtered = data.metrics.filter((m) => m.label !== "Total Value");
        setMetrics((prev) => {
          const tv = prev.find((m) => m.label === "Total Value");
          return tv ? [tv, ...filtered] : filtered;
        });
      }
      applyAiTags(data);
    } catch {
      setLatestResponse("Something went wrong. Try again.");
      setLatestActions([]);
    } finally {
      setSending(false);
    }
  };

  const handleAction = async (action) => {
    if (action.action === "view" && action.comicId) {
      const comic = catalogue.find((c) => c.id === action.comicId);
      if (comic) onOpenItem(comic);
      return;
    }
    if (action.action === "list" && action.comicId) {
      const comic = catalogue.find((c) => c.id === action.comicId);
      if (!comic || !onListComic) return;
      setActionStatus((prev) => ({ ...prev, [action.comicId]: "listing" }));
      try {
        await onListComic(comic);
        setActionStatus((prev) => ({ ...prev, [action.comicId]: "listed" }));
      } catch {
        setActionStatus((prev) => ({ ...prev, [action.comicId]: "error" }));
      }
      return;
    }
    if (action.action === "bundle" && action.comicIds) {
      const validIds = action.comicIds.filter((id) => catalogue.some((c) => c.id === id));
      if (validIds.length < 2) {
        setLatestResponse("Not enough comics for a bundle.");
        return;
      }
      setSelectionMode(true);
      setSelectedIds(new Set(validIds));
      const titles = validIds
        .map((id) => catalogue.find((c) => c.id === id)?.title)
        .filter(Boolean);
      setLatestResponse(
        `Bundle pre-selected: ${titles.join(", ")}. Review checkboxes and tap "List Bundle" to create the combined eBay listing.`
      );
      setLatestActions([]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Filter and sort
  const q = search.toLowerCase().trim();
  const filtered = catalogue
    .filter((item) => {
      if (!q) return true;
      const priceMatch = q.match(/^\$(\d+)\+?$/);
      if (priceMatch) return (marketValueOf(item) || 0) >= parseInt(priceMatch[1]);
      if (q === "key" || q === "keys") return showKeyIssue(item.keyIssue);
      if (q === "listed") return item.status === "listed";
      if (q === "unlisted") return item.status !== "listed";
      if (q === "hot") return aiTags[item.id]?.label === "HOT";
      if (q === "stagnant") return aiTags[item.id]?.label === "STAGNANT";
      if (q === "bundle") return aiTags[item.id]?.label === "BUNDLE";
      const hay = `${item.title} ${item.publisher} ${item.year} ${item.grade} ${item.keyIssue}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      const tagOrder = { HOT: 0, BUNDLE: 1, STAGNANT: 3 };
      const aO = tagOrder[aiTags[a.id]?.label] ?? 2;
      const bO = tagOrder[aiTags[b.id]?.label] ?? 2;
      if (aO !== bO) return aO - bO;
      return (marketValueOf(b) || 0) - (marketValueOf(a) || 0);
    });

  const metricColors = { red: "#dc2626", yellow: "#d4af37", green: "#16a34a" };

  const actionBtnStyle = (a) => {
    const s = actionStatus[a.comicId];
    if (s === "listing") return { background: "rgba(212,175,55,0.2)", color: "#d4af37", cursor: "wait" };
    if (s === "listed") return { background: "rgba(22,163,106,0.2)", color: "#16a34a", cursor: "default" };
    if (s === "error") return { background: "rgba(220,38,38,0.2)", color: "#dc2626", cursor: "pointer" };
    if (a.action === "list") return { background: "linear-gradient(135deg, #d4af37, #b8941f)", color: "#0a0a0a", cursor: "pointer" };
    return { background: "rgba(212,175,55,0.15)", color: "#d4af37", cursor: "pointer" };
  };

  const actionBtnLabel = (a) => {
    const s = actionStatus[a.comicId];
    if (s === "listing") return "Listing...";
    if (s === "listed") return "Listed! View on eBay →";
    if (s === "error") return "Failed — Retry";
    if (a.action === "list" && a.comicId) {
      const listItem = catalogue.find((c) => c.id === a.comicId);
      const realPrice = listItem ? getDisplayPrice(listItem) : null;
      const label = realPrice ? "List Now — $" + realPrice : a.label;
      return label;
    }
    return a.label;
  };

  const bundleItems = catalogue.filter((c) => selectedIds.has(c.id));
  const bundleSum = bundleItems.reduce((acc, it) => acc + (getDisplayPrice(it) || 0), 0);
  const bundlePrice = bundleSum * 0.82;

  return (
    <div style={{ paddingBottom: selectionMode ? 120 : 8, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* A. CLAUDE RESPONSE BOX (top) */}
      <div style={{
        border: "1px solid rgba(212,175,55,0.4)",
        borderRadius: 12,
        padding: 14,
        background: "rgba(212,175,55,0.06)",
      }}>
        <div style={{ fontSize: 11, color: "#d4af37", fontWeight: 600, marginBottom: 8 }}>
          🧠 Claude
        </div>

        {/* Loading state */}
        {sending && !latestResponse && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
            <div style={{
              width: 16, height: 16,
              border: "2px solid rgba(212,175,55,0.3)",
              borderTopColor: "#d4af37",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <span style={{ color: "#d4af37", fontSize: 14 }}>Analyzing your collection...</span>
          </div>
        )}

        {/* Response text */}
        {latestResponse && (
          <div style={{ fontSize: 14, lineHeight: 1.6, color: "#e0e0e0" }}>
            {latestResponse}
          </div>
        )}

        {/* Refreshing indicator after initial load */}
        {sending && latestResponse && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <div style={{
              width: 12, height: 12,
              border: "2px solid rgba(212,175,55,0.3)",
              borderTopColor: "#d4af37",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <span className="muted small">Updating...</span>
          </div>
        )}

        {/* Action buttons */}
        {latestActions.length > 0 && !sending && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {latestActions.map((a, j) => (
              <button
                key={j}
                onClick={() => handleAction(a)}
                disabled={actionStatus[a.comicId] === "listing"}
                style={{
                  padding: "10px 16px",
                  border: a.action === "list" ? "none" : "1px solid rgba(212,175,55,0.3)",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  ...actionBtnStyle(a),
                }}
              >
                {actionBtnLabel(a)}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!latestResponse && !sending && catalogue.length === 0 && (
          <div className="muted small">Scan some comics first, then Claude will analyze your collection.</div>
        )}
      </div>

      {/* B. CHAT INPUT */}
      <div>
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(chatInput); }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="text"
            placeholder="Ask Claude..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={sending}
            style={{
              flex: 1,
              padding: "12px 14px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              color: "#fff",
              fontSize: 15,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={sending || !chatInput.trim()}
            style={{
              padding: "12px 18px",
              background: sending ? "rgba(212,175,55,0.2)" : "linear-gradient(135deg, #d4af37, #b8941f)",
              color: sending ? "#d4af37" : "#0a0a0a",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              cursor: sending ? "wait" : "pointer",
              flexShrink: 0,
            }}
          >
            {sending ? "..." : "Ask"}
          </button>
        </form>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => {
              if (selectionMode) exitSelection();
              else setSelectionMode(true);
            }}
            style={{
              padding: "6px 12px",
              background: selectionMode ? "rgba(220,38,38,0.2)" : "rgba(212,175,55,0.15)",
              border: `1px solid ${selectionMode ? "rgba(220,38,38,0.4)" : "rgba(212,175,55,0.35)"}`,
              borderRadius: 20,
              color: selectionMode ? "#dc2626" : "#d4af37",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {selectionMode ? "✕ Cancel Bundle" : "📦 Create Bundle"}
          </button>
          {["Sell?", "Keys?", "Bundle?", "Stagnant?", "Value?"].map((q) => (
            <button
              key={q}
              onClick={() => sendMessage(q === "Sell?" ? "What should I sell this week?" : q === "Keys?" ? "Which books are key issues?" : q === "Bundle?" ? "Any bundle opportunities?" : q === "Stagnant?" ? "Which books are stagnant?" : "What's my most valuable book?")}
              disabled={sending}
              style={{
                padding: "6px 12px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 20,
                color: "#999",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* C. METRIC BOXES (2x2) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {metrics.slice(0, 4).map((m, i) => (
          <div
            key={i}
            onClick={() => {
              if (m.filter) setSearch(m.filter);
              else sendMessage(`Tell me about ${m.label}`);
            }}
            style={{
              padding: 14,
              borderRadius: 10,
              border: `1px solid ${metricColors[m.color] || "#d4af37"}40`,
              background: `${metricColors[m.color] || "#d4af37"}10`,
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, color: metricColors[m.color] || "#d4af37" }}>
              {m.value}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#ccc", marginTop: 2 }}>
              {m.label}
            </div>
            {m.detail && <div className="muted small" style={{ marginTop: 4 }}>{m.detail}</div>}
          </div>
        ))}
      </div>

      {/* D. SEARCH BAR */}
      <input
        type="text"
        placeholder='Search: title, "key", "$100+", "hot"...'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10,
          color: "#fff",
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      {/* E. COLLECTION GRID */}
      {filtered.length === 0 && (
        <div className="muted small" style={{ textAlign: "center", padding: 20 }}>
          {q ? "No comics match" : "No comics in collection yet"}
        </div>
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 10,
      }}>
        {filtered.map((item) => {
          const thumbSrc = getComicPhotos(item)[0] || null;
          const mv = marketValueOf(item);
          const tag = aiTags[item.id];
          const isSelected = selectionMode && selectedIds.has(item.id);
          return (
            <div
              key={item.id}
              onClick={() => {
                if (selectionMode) toggleSelected(item.id);
                else onOpenItem(item);
              }}
              style={{
                position: "relative",
                borderRadius: 10,
                border: isSelected
                  ? "2px solid #d4af37"
                  : "1px solid rgba(255,255,255,0.08)",
                background: isSelected
                  ? "rgba(212,175,55,0.1)"
                  : "rgba(255,255,255,0.03)",
                overflow: "hidden",
                cursor: "pointer",
              }}
            >
              {selectionMode && (
                <div style={{
                  position: "absolute",
                  top: 6,
                  left: 6,
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: isSelected ? "#d4af37" : "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(212,175,55,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#0a0a0a",
                  fontWeight: 800,
                  fontSize: 14,
                  zIndex: 2,
                }}>
                  {isSelected ? "✓" : ""}
                </div>
              )}
              {thumbSrc ? (
                <img src={thumbSrc} alt="" loading="lazy" style={{ width: "100%", height: 160, objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: 160, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>📘</div>
              )}
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
                  {item.title || "Unknown"}
                </div>
                {(() => {
                  const gt = item.isGraded === true && item.numericGrade != null
                    ? `CGC ${item.numericGrade}`
                    : (item.grade || null);
                  return gt ? (
                    <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>{gt}</div>
                  ) : null;
                })()}
                <div style={{ fontSize: 15, fontWeight: 800, color: "#d4af37" }}>
                  {mv != null ? fmt(mv) : "—"}
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                  {tag && (
                    <span style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 5, fontWeight: 700,
                      background: tag.label === "HOT" ? "rgba(220,38,38,0.2)" : tag.label === "STAGNANT" ? "rgba(245,158,11,0.2)" : "rgba(212,175,55,0.15)",
                      color: tag.label === "HOT" ? "#dc2626" : tag.label === "STAGNANT" ? "#f59e0b" : "#d4af37",
                    }}>
                      {tag.emoji} {tag.label}
                    </span>
                  )}
                  {item.status === "listed" && (
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: "rgba(22,163,106,0.2)", color: "#16a34a", fontWeight: 700 }}>
                      LISTED
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {bundleMsg && (
        <div style={{
          position: "fixed",
          left: 12,
          right: 12,
          bottom: selectionMode ? 90 : 70,
          padding: "10px 14px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          textAlign: "center",
          zIndex: 50,
          background: bundleMsg.type === "err"
            ? "rgba(220,38,38,0.2)"
            : bundleMsg.type === "ok"
              ? "rgba(22,163,106,0.2)"
              : "rgba(212,175,55,0.2)",
          border: `1px solid ${bundleMsg.type === "err" ? "#dc2626" : bundleMsg.type === "ok" ? "#16a34a" : "#d4af37"}`,
          color: bundleMsg.type === "err" ? "#dc2626" : bundleMsg.type === "ok" ? "#16a34a" : "#d4af37",
        }}>
          {bundleMsg.text}
        </div>
      )}

      {selectionMode && (
        <div style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 56,
          padding: "10px 12px",
          background: "rgba(15,15,15,0.96)",
          borderTop: "1px solid rgba(212,175,55,0.4)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 40,
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#d4af37" }}>
              {selectedIds.size} selected
            </div>
            <div style={{ fontSize: 11, color: "#999" }}>
              {bundleItems.length >= 2
                ? `$${bundleSum.toFixed(2)} → $${bundlePrice.toFixed(2)} (18% off)`
                : "Select 2+ comics to bundle"}
            </div>
          </div>
          <button
            onClick={exitSelection}
            disabled={bundling}
            style={{
              padding: "10px 14px",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              background: "transparent",
              color: "#ccc",
              fontSize: 13,
              fontWeight: 600,
              cursor: bundling ? "wait" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submitBundle}
            disabled={bundling || selectedIds.size < 2}
            style={{
              padding: "10px 16px",
              border: "none",
              borderRadius: 8,
              background: selectedIds.size >= 2 && !bundling
                ? "linear-gradient(135deg, #d4af37, #b8941f)"
                : "rgba(212,175,55,0.2)",
              color: selectedIds.size >= 2 && !bundling ? "#0a0a0a" : "#d4af37",
              fontSize: 13,
              fontWeight: 800,
              cursor: bundling ? "wait" : selectedIds.size >= 2 ? "pointer" : "not-allowed",
            }}
          >
            {bundling ? "Listing…" : "📦 List Bundle"}
          </button>
        </div>
      )}
    </div>
  );
}

function WatchMode({ onStop }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const lastTitleRef = useRef("");
  const busyRef = useRef(false);
  const recognitionRef = useRef(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("Starting camera...");
  const [settings] = useState(loadBuyerSettings);
  const [watchContext, setWatchContext] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState(null);
  const [bid, setBid] = useState("");
  const watchContextRef = useRef("");
  useEffect(() => { watchContextRef.current = watchContext; }, [watchContext]);

  useEffect(() => {
    let stream = null;
    let intervalId = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("Watching...");

        const captureAndGrade = async () => {
          if (busyRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || !v.videoWidth) return;
          busyRef.current = true;
          try {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
            if (!blob) return;
            const b64 = await fileToBase64(blob);
            const res = await fetch("/api/grade", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ images: [b64], source: 'watch', voiceContext: watchContextRef.current || undefined }),
            });
            const data = await res.json();
            if (!res.ok || !data.title) return;
            const low = data.title.toLowerCase();
            if (low.includes("not a comic") || low.includes("unknown")) return;
            const issueNum = data.issue || data.title?.match(/#(\d+)/)?.[1] || null;
            const key = `${data.title}|${issueNum}`;
            if (key === lastTitleRef.current) return;
            lastTitleRef.current = key;
            setResult({ ...data, issue: issueNum, image: b64, _enriching: true });

            fetch("/api/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: data.title,
                issue: issueNum,
                grade: data.grade,
                isGraded: data.isGraded,
                numericGrade: data.numericGrade,
                year: data.year,
                publisher: data.publisher,
                variant: data.variant || null,
                keyIssue: data.keyIssue || null,
                images: [b64],
              }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((enrich) => {
                if (!enrich || cancelled) return;
                setResult((prev) => prev ? { ...prev, ...enrich, image: prev.image, _enriching: false } : prev);
              })
              .catch(() => {});
          } catch {
            /* skip frame */
          } finally {
            busyRef.current = false;
          }
        };

        intervalId = setInterval(captureAndGrade, 3000);
        captureAndGrade();
      } catch (err) {
        setStatus("Camera error: " + (err.message || "permission denied"));
      }
    })();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceNote("Type context above instead"); return; }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(" ").trim();
      if (transcript) {
        setWatchContext(transcript);
        const bidMatch = transcript.match(/\$?\b(\d+(?:\.\d{1,2})?)\b/);
        if (bidMatch) {
          const autoBid = parseFloat(bidMatch[1]);
          if (autoBid > 0 && autoBid < 10000) {
            setBid(String(autoBid));
            setVoiceNote("\uD83C\uDFA4 Bid: $" + autoBid);
          }
        }
      }
    };
    recognition.onerror = () => { setListening(false); setVoiceNote("Type context above instead"); };
    recognition.onend = () => { setListening(false); };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setVoiceNote(null);
    } catch {
      setListening(false);
      setVoiceNote("Type context above instead");
    }
  };

  const mv = marketValueOf(result);
  const fee = Number(settings.whatnotFee) || 0;
  const supplies = Number(settings.supplies) || 0;
  const labor = Number(settings.labor) || 0;
  const bidNum = parseFloat(bid);
  const hasBid = !isNaN(bidNum) && bidNum > 0;
  const netAtZero = mv != null ? mv - mv * (fee / 100) - supplies - labor : null;
  const netAtBid = mv != null && hasBid ? mv - mv * (fee / 100) - supplies - labor - bidNum : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#d4af37" }}>👁 Watch Mode</div>
        <button
          onClick={onStop}
          style={{ padding: "6px 14px", background: "transparent", border: "1px solid #e05656", borderRadius: 8, color: "#e05656", fontWeight: 700, cursor: "pointer" }}
        >Stop</button>
      </div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", aspectRatio: "4/3" }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.6)", color: "#d4af37", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
          {status}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
        <input
          placeholder="Context: title, grade, notes..."
          value={watchContext}
          onChange={e => setWatchContext(e.target.value)}
          style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#fff", fontSize: 13, padding: "6px 10px" }}
        />
        {watchContext && (
          <button onClick={() => { setWatchContext(""); setVoiceNote(null); }} style={{ background: "transparent", border: "none", color: "#999", fontSize: 16, cursor: "pointer", padding: "4px" }}>✕</button>
        )}
        <button
          onClick={toggleVoice}
          style={{ padding: "6px 10px", background: listening ? "rgba(224,86,86,0.3)" : "rgba(212,175,55,0.15)", border: `1px solid ${listening ? "#e05656" : "rgba(212,175,55,0.4)"}`, borderRadius: 8, color: listening ? "#e05656" : "#d4af37", fontSize: 16, cursor: "pointer" }}
        >{listening ? "⏹" : "\uD83C\uDFA4"}</button>
      </div>
      {voiceNote && <div style={{ fontSize: 11, color: "#d4af37", marginTop: 2 }}>{voiceNote}</div>}
      {result && (
        <div style={{ border: "1px solid rgba(212,175,55,0.4)", borderRadius: 12, padding: 14, background: "rgba(212,175,55,0.06)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
            {result.title}{result.issue ? ` #${result.issue}` : ""}
          </div>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>
            {result.publisher}{result.year ? ` · ${result.year}` : ""}{result.grade ? ` · ${result.grade}` : ""}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase" }}>Market</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#d4af37" }}>
                {mv != null ? fmt(mv) : (result._enriching ? "..." : "\u2014")}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase" }}>{hasBid ? `Net @ $${bid}` : "Net @ $0 bid"}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: (hasBid ? netAtBid : netAtZero) != null && (hasBid ? netAtBid : netAtZero) > 0 ? "#16a34a" : "#e05656" }}>
                {hasBid
                  ? (netAtBid != null ? fmt(netAtBid) : "\u2014")
                  : (netAtZero != null ? fmt(netAtZero) : (result._enriching ? "..." : "\u2014"))}
              </div>
            </div>
          </div>
        </div>
      )}
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
  const [watchMode, setWatchMode] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // { current, total, title }
  const [bulkDone, setBulkDone] = useState(null); // number or null
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState(null); // { current, total }
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [refreshingPrices, setRefreshingPrices] = useState(0);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [pendingDuplicate, setPendingDuplicate] = useState(null);
  const fileRef = useRef(null);
  const buyerFileRef = useRef(null);
  const bulkRef = useRef(null);
  const collectionScrollPos = useRef(0);
  const manageScrollPos = useRef(0);
  const prevTabRef = useRef("collection");
  const lastAutoRefreshRef = useRef(0);

  // Load catalogue, snapshots, and cached analysis from IndexedDB on mount.
  useEffect(() => {
    // Warm up grade + enrich endpoints silently
    fetch('/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warmup: true })
    }).catch(() => {});
    fetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warmup: true })
    }).catch(() => {});

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

  // Auto-refresh stale prices: items saved before enrich persistence was fixed
  // may have null pricingSource or comps. Also sync duplicate copies where
  // prices differ. Only fires when on collection tab with no detail open,
  // and at least 60s since last refresh to prevent rapid re-firing.
  useEffect(() => {
    if (catalogue.length === 0) return;
    if (tab !== "collection") return;
    if (selectedItem) return;
    if (Date.now() - lastAutoRefreshRef.current < 60000) return;
    lastAutoRefreshRef.current = Date.now();
    // Skip books imported in the last 5 minutes — bulk import enrich is still
    // in flight and would race with auto-refresh, overwriting fresh data.
    const isRecentlyImported = (c) =>
      Date.now() - (c.timestamp || 0) < 300000;
    const missingSource = catalogue.filter(
      (c) => !isRecentlyImported(c) && (!c.pricingSource || !c.comps)
    );
    const missingIds = new Set(missingSource.map((c) => c.id));

    // Find duplicate groups with inconsistent prices.
    const groups = {};
    catalogue.forEach((c) => {
      const key = [c.title?.toLowerCase(), c.issue, c.year].join("|");
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    const dupStale = [];
    Object.values(groups).forEach((group) => {
      if (group.length < 2) return;
      const prices = group.map((c) =>
        parseFloat(String(c.price || "0").replace(/[$,]/g, ""))
      );
      if (!prices.every((p) => p === prices[0])) {
        const oldest = group.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))[0];
        if (!missingIds.has(oldest.id) && !isRecentlyImported(oldest)) dupStale.push(oldest);
      }
    });

    const stale = [...missingSource, ...dupStale];
    if (stale.length === 0) return;
    let cancelled = false;
    setRefreshingPrices(stale.length);
    const queue = stale.slice();
    let active = 0;
    const MAX_CONCURRENT = 3;
    const next = () => {
      while (active < MAX_CONCURRENT && queue.length > 0 && !cancelled) {
        const item = queue.shift();
        active++;
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: item.title,
            issue: item.issue || item.title?.match(/#(\d+)/)?.[1] || null,
            grade: item.grade,
            isGraded: item.isGraded,
            numericGrade: item.numericGrade,
            year: item.year,
            publisher: item.publisher,
            confidence: item.confidence,
            variant: item.variant || null,
            keyIssue: item.keyIssue || null,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((enrich) => {
            if (cancelled || !enrich) return;
            setCatalogue((prev) => {
              const cur = prev.find((x) => x.id === item.id);
              if (!cur) return prev;
              const updated = {
                ...cur,
                comps: enrich.comps || cur.comps,
                price: enrich.price || cur.price,
                priceLow: enrich.priceLow || cur.priceLow,
                priceHigh: enrich.priceHigh || cur.priceHigh,
                keyIssue: enrich.keyIssue || cur.keyIssue,
                soldComps: enrich.soldComps || cur.soldComps || [],
                confidenceLevel: enrich.confidenceLevel || cur.confidenceLevel || "LOW",
                pricingSource: enrich.pricingSource || null,
                priceNote: enrich.priceNote || null,
                gradeMultiplier: enrich.gradeMultiplier || null,
                defectPenalty: enrich.defectPenalty || cur.defectPenalty || null,
                comicVine: enrich.comicVine || cur.comicVine || null,
                certNumber: enrich.certNumber || cur.certNumber || null,
                cgcVerified: enrich.cgcVerified || cur.cgcVerified || false,
                cgcLabel: enrich.cgcLabel || cur.cgcLabel || null,
                goCollect: enrich.goCollect || cur.goCollect || null,
                variant: enrich.variantNote || cur.variant || null,
                variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null,
              };
              putComic(updated).catch(() => {});
              return prev.map((x) => {
                if (x.id === item.id) return updated;
                // Sync duplicate copies with same title + issue + year.
                if (x.title?.toLowerCase() === item.title?.toLowerCase()
                  && x.issue === item.issue
                  && x.year === item.year) {
                  const synced = { ...x, price: enrich.price ?? x.price, priceLow: enrich.priceLow ?? x.priceLow, priceHigh: enrich.priceHigh ?? x.priceHigh, comps: enrich.comps ?? x.comps, pricingSource: enrich.pricingSource ?? x.pricingSource, priceNote: enrich.priceNote ?? null, gradeMultiplier: enrich.gradeMultiplier ?? x.gradeMultiplier };
                  putComic(synced).catch(() => {});
                  return synced;
                }
                return x;
              });
            });
            // FIX 4: update detail view if open during background refresh
            setSelectedItem((s) =>
              s && s.id === item.id ? { ...s, ...enrich, comicVine: enrich.comicVine || s.comicVine || null, certNumber: enrich.certNumber || s.certNumber || null, cgcVerified: enrich.cgcVerified || s.cgcVerified || false, cgcLabel: enrich.cgcLabel || s.cgcLabel || null, goCollect: enrich.goCollect || s.goCollect || null } : s
            );
          })
          .catch(() => {})
          .finally(() => {
            if (cancelled) return;
            active--;
            setRefreshingPrices((n) => Math.max(0, n - 1));
            next();
          });
      }
    };
    next();
    return () => { cancelled = true; };
  }, [catalogue.length > 0 && catalogue.some((c) => !c.pricingSource || !c.comps), tab, selectedItem]);

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
      issue: data.issue || null,
      keyIssue: data.keyIssue || "",
      price: data.price || "",
      priceLow: data.priceLow || "",
      priceHigh: data.priceHigh || "",
      reason: data.reason || "",
      confidence: data.confidence || "",
      restoration: data.restoration || null,
      defectPenalty: data.defectPenalty || null,
      variant: data.variant || null,
      variantMultiplier: data.variantMultiplier || null,
      certNumber: data.certNumber || null,
      cgcVerified: data.cgcVerified || false,
      cgcLabel: data.cgcLabel || null,
      purchasePrice: data.purchasePrice != null ? parseFloat(data.purchasePrice) || null : null,
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

        // FIX 2: Non-comic rejection
        if (!data.title ||
            data.title.toLowerCase().includes('not a comic') ||
            data.title.toLowerCase().includes('unknown') ||
            (!data.publisher && !data.year && !data.issue)) {
          setError("No comic detected. Try again.");
          setLoading(false);
          return;
        }

        // Extract issue number: prefer explicit field, fall back to parsing title.
        const issueNum = data.issue || data.title?.match(/#(\d+)/)?.[1] || null;
        console.log('[grade] title:', data.title, 'issue:', issueNum);

        // Duplicate detection: skip auto-save if already in collection.
        const isDuplicate = save && catalogue.some(c =>
          c.title?.toLowerCase() === data.title?.toLowerCase() &&
          c.issue === issueNum &&
          c.year === data.year
        );
        if (isDuplicate) {
          setDuplicateWarning({ title: data.title, issue: issueNum, year: data.year });
          setPendingDuplicate({ data: { ...data, issue: issueNum }, b64 });
        } else {
          setDuplicateWarning(null);
          setPendingDuplicate(null);
        }

        // Show the Claude result immediately.
        setResult({ ...data, issue: issueNum, image: b64 });
        setLoading(false);
        const savedId = (save && !isDuplicate) ? await addToCatalogue({ ...data, issue: issueNum }, b64) : null;

        // Fire-and-forget enrichment pass — merges into the card when ready.
        setEnriching(true);
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            issue: issueNum,
            grade: data.grade,
            isGraded: data.isGraded,
            numericGrade: data.numericGrade,
            year: data.year,
            publisher: data.publisher,
            confidence: data.confidence,
            defectPenalty: data.defectPenalty || null,
            certNumber: data.certNumber || null,
            variant: data.variant || null,
            keyIssue: data.keyIssue || null,
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
              // Use setCatalogue updater to get the CURRENT state (avoids
              // stale closure — catalogue from gradeBlob call time won't
              // contain the item that addToCatalogue just inserted).
              setCatalogue((prev) => {
                const cur = prev.find((x) => x.id === savedId);
                if (!cur) return prev;
                const updated = {
                  ...cur,
                  comps: enrich.comps || cur.comps,
                  price: enrich.price || cur.price,
                  priceLow: enrich.priceLow || cur.priceLow,
                  priceHigh: enrich.priceHigh || cur.priceHigh,
                  keyIssue: enrich.keyIssue || cur.keyIssue,
                  soldComps: enrich.soldComps || cur.soldComps || [],
                  confidenceLevel: enrich.confidenceLevel || cur.confidenceLevel || "LOW",
                  pricingSource: enrich.pricingSource || null,
                  priceNote: enrich.priceNote || null,
                  gradeMultiplier: enrich.gradeMultiplier || null,
                  comicVine: enrich.comicVine || cur.comicVine || null,
                  certNumber: enrich.certNumber || cur.certNumber || null,
                  cgcVerified: enrich.cgcVerified || cur.cgcVerified || false,
                  cgcLabel: enrich.cgcLabel || cur.cgcLabel || null,
                  variant: enrich.variantNote || cur.variant || null,
                  variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null,
                };
                console.log('[persist] savedId:', savedId,
                  'price:', updated.price,
                  'comps count:', updated.comps?.count);
                putComic(updated).catch(() => {});
                return prev.map((x) => x.id === savedId ? updated : x);
              });
              setSelectedItem((s) => {
                if (!s || s.id !== savedId) return s;
                return {
                  ...s,
                  comps: enrich.comps || s.comps,
                  price: enrich.price || s.price,
                  priceLow: enrich.priceLow || s.priceLow,
                  priceHigh: enrich.priceHigh || s.priceHigh,
                  keyIssue: enrich.keyIssue || s.keyIssue,
                  soldComps: enrich.soldComps || s.soldComps || [],
                  confidenceLevel: enrich.confidenceLevel || s.confidenceLevel || "LOW",
                  pricingSource: enrich.pricingSource || null,
                  priceNote: enrich.priceNote || null,
                  gradeMultiplier: enrich.gradeMultiplier || null,
                  defectPenalty: enrich.defectPenalty || s.defectPenalty || null,
                  comicVine: enrich.comicVine || s.comicVine || null,
                  certNumber: enrich.certNumber || s.certNumber || null,
                  cgcVerified: enrich.cgcVerified || s.cgcVerified || false,
                  cgcLabel: enrich.cgcLabel || s.cgcLabel || null,
                  goCollect: enrich.goCollect || s.goCollect || null,
                  variant: enrich.variantNote || s.variant || null,
                  variantMultiplier: enrich.variantMultiplier || s.variantMultiplier || null,
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
    [addToCatalogue, catalogue]
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
    setBulkEnrichProgress(null);
    let added = 0;
    const errors = [];
    let enrichTotal = 0;
    let enrichDone = 0;
    const bumpEnrichFired = () => {
      enrichTotal++;
      setBulkEnrichProgress({ current: enrichDone, total: enrichTotal });
    };
    const bumpEnrichSettled = () => {
      enrichDone++;
      setBulkEnrichProgress({ current: enrichDone, total: enrichTotal });
    };
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log('[bulk] processing file:', file.name);
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
        if (!res.ok) {
          const msg = data.error || `HTTP ${res.status}`;
          console.warn('[bulk] grade error for', file.name, msg);
          errors.push(`${file.name}: ${msg}`);
          continue;
        }
        console.log('[bulk] grade result:', JSON.stringify(data));

        // Non-comic rejection (mirrors gradeBlob :3844-3852)
        const titleLower = (data.title || '').toLowerCase();
        if (!data.title ||
            titleLower === 'unknown' ||
            titleLower.includes('not a comic') ||
            (!data.publisher && !data.year && !data.issue)) {
          console.warn('[bulk] not a comic, skipping:', file.name);
          errors.push(`${file.name}: not a comic`);
          continue;
        }

        // Publisher-as-title detection — WARN, don't block. Book still gets
        // added; user can review and edit the title manually in the catalogue.
        const PUBLISHER_NAMES = [
          'marvel comics', 'dc comics', 'image comics', 'dark horse comics',
          'idw publishing', 'boom studios', 'dynamite entertainment', 'valiant',
          'archie comics', 'oni press', 'vault comics', 'mad cave',
          'aftershock', 'awaken comics',
          'marvel', 'dc', 'image', 'dark horse', 'idw'
        ];
        if (PUBLISHER_NAMES.some(p => titleLower.includes(p)) &&
            data.publisher && titleLower.includes(data.publisher.toLowerCase())) {
          console.warn('[bulk] title may be publisher name:', data.title, file.name);
          data.titleWarning = true;
          data.titleWarningMsg = 'Title may be publisher name — verify';
          errors.push(`${file.name}: title "${data.title}" may be publisher name — added, review manually`);
          // book still gets added
        }

        const bulkIssue = data.issue || data.title?.match(/#(\d+)/)?.[1] || null;

        // Duplicate detection (mirrors gradeBlob :3859-3863)
        const isDuplicate = catalogue.some(c =>
          c.title?.toLowerCase() === titleLower &&
          c.issue === bulkIssue &&
          c.year === data.year
        );
        if (isDuplicate) {
          console.log('[bulk] duplicate, skipping:', data.title, '#' + bulkIssue);
          errors.push(`${file.name}: duplicate (${data.title} #${bulkIssue})`);
          continue;
        }

        setBulkProgress({ current: i + 1, total: files.length, title: data.title || "" });
        const savedId = await addToCatalogue({ ...data, issue: bulkIssue }, b64);
        if (savedId) {
          added++;
          console.log('[bulk] added to catalogue:', data.title, bulkIssue);
        } else {
          console.warn('[bulk] addToCatalogue returned null for', file.name);
          errors.push(`${file.name}: failed to save`);
        }
        // Fire-and-forget enrichment — tracked via bulkEnrichProgress.
        bumpEnrichFired();
        fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            issue: bulkIssue,
            grade: data.grade,
            isGraded: data.isGraded,
            numericGrade: data.numericGrade,
            year: data.year,
            publisher: data.publisher,
            confidence: data.confidence,
            defectPenalty: data.defectPenalty || null,
            variant: data.variant || null,
            keyIssue: data.keyIssue || null,
            images: [b64],
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((enrich) => {
            if (!enrich || !savedId) return;
            setCatalogue((prev) => {
              const cur = prev.find((x) => x.id === savedId);
              if (!cur) return prev;
              const updated = {
                ...cur,
                comps: enrich.comps || cur.comps,
                price: enrich.price || cur.price,
                priceLow: enrich.priceLow || cur.priceLow,
                priceHigh: enrich.priceHigh || cur.priceHigh,
                keyIssue: enrich.keyIssue || cur.keyIssue,
                soldComps: enrich.soldComps || cur.soldComps || [],
                confidenceLevel: enrich.confidenceLevel || cur.confidenceLevel || "LOW",
                pricingSource: enrich.pricingSource || null,
                priceNote: enrich.priceNote || null,
                gradeMultiplier: enrich.gradeMultiplier || null,
                defectPenalty: enrich.defectPenalty || cur.defectPenalty || null,
                comicVine: enrich.comicVine || cur.comicVine || null,
                certNumber: enrich.certNumber || cur.certNumber || null,
                cgcVerified: enrich.cgcVerified || cur.cgcVerified || false,
                cgcLabel: enrich.cgcLabel || cur.cgcLabel || null,
                goCollect: enrich.goCollect || cur.goCollect || null,
                variant: enrich.variantNote || cur.variant || null,
                variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null,
              };
              console.log('[persist-bulk] savedId:', savedId,
                'price:', updated.price);
              putComic(updated).catch(() => {});
              return prev.map((x) => x.id === savedId ? updated : x);
            });
          })
          .catch(() => {})
          .finally(bumpEnrichSettled);
      } catch (err) {
        console.warn('[bulk] unexpected error for', file.name, err);
        errors.push(`${file.name}: ${err.message || 'unexpected error'}`);
      }
    }
    setBulkProgress(null);
    // Poll enrich completion; clear progress when all settle (max 45s wait).
    const pollStart = Date.now();
    while (enrichDone < enrichTotal && Date.now() - pollStart < 45000) {
      await new Promise((r) => setTimeout(r, 250));
    }
    setBulkEnrichProgress(null);
    if (errors.length > 0) {
      console.warn('[bulk] errors:', errors);
      setError(`Bulk import: ${added} added, ${errors.length} failed.\n${errors.join('\n')}`);
    }
    setBulkDone(added);
    // Auto-switch to collection tab after a short delay
    setTimeout(() => {
      setTab("collection");
      setBulkDone(null);
    }, 2000);
  }, [addToCatalogue, catalogue]);

  // Android back gesture intercept — return to list instead of exiting app.
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      if (selectedItem) setSelectedItem(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [selectedItem]);

  // Web Share Target handoff — persist into Buyer tab (save:false).
  // Strip ?share-target=1 immediately so reloads don't re-trigger the flow.
  useEffect(() => {
    if (!widgetMode) return;
    setTab("buyer");
    window.history.replaceState({}, "", "/");
    setWidgetMode(false);
    (async () => {
      try {
        const tryFetchSharedImage = async (retries = 3) => {
          for (let i = 0; i < retries; i++) {
            const res = await fetch("/__shared-image", { cache: "no-store" });
            if (res.ok) return res;
            await new Promise((r) => setTimeout(r, 500));
          }
          return null;
        };
        const res = await tryFetchSharedImage();
        if (!res) return;
        const blob = await res.blob();
        if (blob.size > 0) await gradeBlob(blob, { save: false });
      } catch {
        /* noop */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setResult(null);
    setError(null);
    setDuplicateWarning(null);
    setPendingDuplicate(null);
  };

  const deleteFromCatalogue = useCallback(async (id) => {
    const item = catalogue.find((x) => x.id === id);

    // If listed on eBay with a known ItemID, offer to delist first.
    if (item && item.status === "listed" && item.ebayItemId) {
      const choice = prompt(
        `"${item.title}" is listed on eBay.\n\n` +
        `Type 1 to Remove from eBay + Collection\n` +
        `Type 2 to Remove from Collection Only\n` +
        `Type anything else to Cancel`
      );
      if (choice === "1") {
        try {
          const res = await fetch("/api/delist-ebay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ebayItemId: item.ebayItemId }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            const proceed = confirm(
              `eBay removal failed: ${data.error || "unknown error"}\n` +
              `Remove manually at ebay.com/myebay.\n\n` +
              `Still remove from collection?`
            );
            if (!proceed) return;
          }
        } catch {
          const proceed = confirm(
            `Could not reach eBay API.\n` +
            `Remove manually at ebay.com/myebay.\n\n` +
            `Still remove from collection?`
          );
          if (!proceed) return;
        }
      } else if (choice !== "2") {
        return; // cancelled
      }
    }

    await deleteComic(id);
    setCatalogue((prev) => prev.filter((x) => x.id !== id));
    setSelectedItem((cur) => (cur && cur.id === id ? null : cur));
  }, [catalogue]);

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
      ebayItemId: data.listingId || null,
      listedAt: Date.now(),
    };
    await putComic(updated);
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? updated : cur));
  }, []);

  const listBundleOnEbay = useCallback(async (items) => {
    if (!Array.isArray(items) || items.length < 2) {
      throw new Error("Select at least 2 comics to bundle");
    }
    const payloadItems = items.map((it) => ({
      id: it.id,
      title: it.title,
      issue: it.issue,
      publisher: it.publisher,
      year: it.year,
      grade: it.grade,
      isGraded: it.isGraded,
      numericGrade: it.numericGrade,
      keyIssue: it.keyIssue,
      price: it.price,
      priceLow: it.priceLow,
      priceHigh: it.priceHigh,
      reason: it.reason,
      images: [getComicPhotos(it)[0]].filter(Boolean),
    }));
    const res = await fetch("/api/list-ebay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle: true, items: payloadItems }),
    });
    const data = await res.json();
    if (!res.ok || !data.listingUrl) {
      throw new Error(data.error || "Failed to create bundle listing");
    }
    const ebayItemId = data.listingId || null;
    const ebayUrl = data.listingUrl;
    const ids = new Set(items.map((i) => i.id));
    const listedAt = Date.now();
    setCatalogue((prev) =>
      prev.map((x) => {
        if (!ids.has(x.id)) return x;
        const updated = {
          ...x,
          status: "listed",
          ebayUrl,
          ebayItemId,
          listedAt,
          bundleId: ebayItemId,
        };
        putComic(updated).catch(() => {});
        return updated;
      })
    );
    return { ebayItemId, ebayUrl, count: items.length };
  }, []);

  // Update a single field on a catalogue entry and persist to IndexedDB.
  const updateComicField = useCallback((item, field, value) => {
    const updated = { ...item, [field]: value };
    // Optimistic UI: update React state immediately so ROI and any other
    // derived views render instantly, then flush to IndexedDB in the
    // background. Users never see the putComic latency.
    setCatalogue((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
    setSelectedItem((cur) => (cur && cur.id === item.id ? updated : cur));
    putComic(updated).catch((err) => console.error("[db] write failed:", err));
  }, []);

  // Re-fetch eBay comps + ComicVine + AI verification for an
  // existing catalogue entry, without re-running the image identification.
  // Used by the CollectionDetail "Refresh Market Data" button.
  const refreshMarketData = useCallback(async (item) => {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        issue: item.issue || item.title?.match(/#(\d+)/)?.[1] || null,
        grade: item.grade,
        isGraded: item.isGraded,
        numericGrade: item.numericGrade,
        year: item.year,
        publisher: item.publisher,
        confidence: item.confidence,
        variant: item.variant || null,
        keyIssue: item.keyIssue || null,
      }),
    });
    if (!res.ok) throw new Error("Failed to refresh market data");
    const enrich = await res.json();
    const updated = {
      ...item,
      comps: enrich.comps ?? item.comps,
      price: enrich.price ?? item.price,
      priceLow: enrich.priceLow ?? item.priceLow,
      priceHigh: enrich.priceHigh ?? item.priceHigh,
      keyIssue: enrich.keyIssue || item.keyIssue,
      soldComps: enrich.soldComps || item.soldComps || [],
      confidenceLevel: enrich.confidenceLevel || item.confidenceLevel || "LOW",
      pricingSource: enrich.pricingSource ?? null,
      priceNote: enrich.priceNote || null,
      gradeMultiplier: enrich.gradeMultiplier || null,
      defectPenalty: enrich.defectPenalty || item.defectPenalty || null,
      comicVine: enrich.comicVine || item.comicVine || null,
      certNumber: enrich.certNumber || item.certNumber || null,
      cgcVerified: enrich.cgcVerified || item.cgcVerified || false,
      cgcLabel: enrich.cgcLabel || item.cgcLabel || null,
      goCollect: enrich.goCollect || item.goCollect || null,
      variant: enrich.variantNote || item.variant || null,
      variantMultiplier: enrich.variantMultiplier || item.variantMultiplier || null,
    };
    await putComic(updated);
    setCatalogue((prev) => prev.map((x) => {
      if (x.id === item.id) return updated;
      // Sync duplicate copies with same title + issue + year.
      if (x.title?.toLowerCase() === item.title?.toLowerCase()
        && x.issue === item.issue
        && x.year === item.year) {
        const synced = {
          ...x,
          price: enrich.price ?? x.price,
          priceLow: enrich.priceLow ?? x.priceLow,
          priceHigh: enrich.priceHigh ?? x.priceHigh,
          comps: enrich.comps ?? x.comps,
          pricingSource: enrich.pricingSource ?? x.pricingSource,
          priceNote: enrich.priceNote ?? null,
          gradeMultiplier: enrich.gradeMultiplier ?? x.gradeMultiplier,
        };
        putComic(synced).catch(() => {});
        return synced;
      }
      return x;
    }));
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

    const photoIssue = data.issue || data.title?.match(/#(\d+)/)?.[1] || item.issue || null;
    const updated = {
      ...item,
      title: data.title || item.title,
      issue: photoIssue,
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
    return sum + (getDisplayPrice(item) || 0);
  }, 0);

  // Record a daily value snapshot whenever catalogue changes.
  useEffect(() => {
    if (catalogue.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const val = catalogue.reduce((s, c) => s + (getDisplayPrice(c) || 0), 0);
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
    // Save current scroll position for restore
    if (tab === "collection") collectionScrollPos.current = window.scrollY;
    if (tab === "manage") manageScrollPos.current = window.scrollY;
    setTab(next);
    reset();
    setSelectedItem(null);
    // Restore saved scroll position for the target tab
    if (next === "manage") {
      setTimeout(() => window.scrollTo(0, manageScrollPos.current), 50);
    } else if (next === "collection") {
      setTimeout(() => window.scrollTo(0, collectionScrollPos.current), 50);
    } else {
      window.scrollTo(0, 0);
    }
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

          {/* Bulk enrich progress (shown on Scan tab after grading finishes,
              until the tab switches to collection). */}
          {!bulkProgress && bulkEnrichProgress && bulkEnrichProgress.current < bulkEnrichProgress.total && (
            <div className="muted small" style={{ textAlign: "center", margin: "8px 0", color: "#4caf50" }}>
              Fetching market data… {bulkEnrichProgress.current} of {bulkEnrichProgress.total}
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0 4px" }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#16a34a",
                  boxShadow: "0 0 6px #16a34a, 0 0 12px rgba(22,163,106,0.4)",
                  animation: "pulse-dot 2s ease-in-out infinite",
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>Scanner ready</span>
              </div>
              <ScanZone
                onFile={(e) => handleFile(e, "scan")}
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
              {duplicateWarning && pendingDuplicate && (
                <div style={{ background: "#ff990022", border: "1px solid #ff9900", borderRadius: 6, padding: "8px 12px", marginBottom: 8, color: "#ffaa33", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⚠️ Already in collection. Tap Save to add another copy.</span>
                  <button
                    style={{ background: "#ff9900", color: "#000", border: "none", borderRadius: 4, padding: "4px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 8 }}
                    onClick={async () => {
                      const { data, b64 } = pendingDuplicate;
                      const savedId = await addToCatalogue(data, b64);
                      setPendingDuplicate(null);
                      setDuplicateWarning(null);
                      if (savedId) {
                        // Fire enrichment for the newly saved copy
                        fetch("/api/enrich", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            title: data.title, issue: data.issue, grade: data.grade,
                            isGraded: data.isGraded, numericGrade: data.numericGrade,
                            year: data.year, publisher: data.publisher,
                            confidence: data.confidence, defectPenalty: data.defectPenalty || null,
                            certNumber: data.certNumber || null, variant: data.variant || null,
                            keyIssue: data.keyIssue || null, images: [b64],
                          }),
                        })
                          .then((r) => r.ok ? r.json() : null)
                          .then((enrich) => {
                            if (!enrich) return;
                            setCatalogue((prev) => {
                              const cur = prev.find((x) => x.id === savedId);
                              if (!cur) return prev;
                              const updated = { ...cur, comps: enrich.comps || cur.comps, price: enrich.price || cur.price, priceLow: enrich.priceLow || cur.priceLow, priceHigh: enrich.priceHigh || cur.priceHigh, keyIssue: enrich.keyIssue || cur.keyIssue, soldComps: enrich.soldComps || cur.soldComps || [], confidenceLevel: enrich.confidenceLevel || cur.confidenceLevel || "LOW", pricingSource: enrich.pricingSource || null, priceNote: enrich.priceNote || null, gradeMultiplier: enrich.gradeMultiplier || null, defectPenalty: enrich.defectPenalty || cur.defectPenalty || null, comicVine: enrich.comicVine || cur.comicVine || null, certNumber: enrich.certNumber || cur.certNumber || null, cgcVerified: enrich.cgcVerified || cur.cgcVerified || false, cgcLabel: enrich.cgcLabel || cur.cgcLabel || null, variant: enrich.variantNote || cur.variant || null, variantMultiplier: enrich.variantMultiplier || cur.variantMultiplier || null };
                              putComic(updated).catch(() => {});
                              return prev.map((x) => x.id === savedId ? updated : x);
                            });
                          })
                          .catch(() => {});
                      }
                    }}
                  >Save Another Copy</button>
                </div>
              )}
              <ResultCard result={result} enriching={enriching} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
        </>
      )}

      {tab === "buyer" && (
        <>
          {watchMode ? (
            <WatchMode onStop={() => setWatchMode(false)} />
          ) : (
          <>
          {!loading && !result && !error && (
            <>
              <ScanZone
                onFile={(e) => handleFile(e, "buyer")}
                inputRef={buyerFileRef}
                compact
                label="Scan the book on stream"
              />
              <button
                onClick={() => setWatchMode(true)}
                style={{
                  width: "100%", padding: "12px 0", marginTop: 8,
                  background: "transparent", border: "1px solid rgba(212,175,55,0.4)",
                  borderRadius: 10, color: "#d4af37", fontWeight: 700, fontSize: 14,
                  cursor: "pointer",
                }}
              >👁 Watch Mode</button>
            </>
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
              <button
                onClick={() => {
                  window.location.href = "whatnot://";
                  setTimeout(() => { window.location.href = "https://whatnot.com"; }, 1500);
                }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  width: "100%", padding: "10px 0", marginBottom: 8,
                  background: "transparent", border: "1px solid rgba(212,175,55,0.4)",
                  borderRadius: 8, color: "#d4af37", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >Back to stream →</button>
              <ResultCard result={result} enriching={enriching} />
              <BidCalculator marketValue={marketValue} detectedPrice={result?.detectedPrice} resultTitle={result?.title} resultGrade={result?.grade} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
          {!result && !loading && !error && <BidCalculator marketValue={null} />}
          </>
          )}
        </>
      )}

      {tab === "collection" && (
        selectedItem ? (
          <CollectionDetail
            item={selectedItem}
            onBack={() => {
              const prev = prevTabRef.current;
              setSelectedItem(null);
              if (prev === "manage") {
                setTab("manage");
                setTimeout(() => window.scrollTo(0, manageScrollPos.current), 50);
              } else {
                setTimeout(() => window.scrollTo(0, collectionScrollPos.current), 50);
              }
              prevTabRef.current = "collection";
            }}
            onDelete={deleteFromCatalogue}
            onList={listOnEbay}
            onRefreshMarket={refreshMarketData}
            onAddPhoto={addPhotoToComic}
            onUpdateField={updateComicField}
            currentIndex={catalogue.indexOf(selectedItem)}
            totalItems={catalogue.length}
            onPrev={() => {
              const idx = catalogue.indexOf(selectedItem);
              if (idx > 0) { setSelectedItem(catalogue[idx - 1]); window.scrollTo(0, 0); }
            }}
            onNext={() => {
              const idx = catalogue.indexOf(selectedItem);
              if (idx < catalogue.length - 1) { setSelectedItem(catalogue[idx + 1]); window.scrollTo(0, 0); }
            }}
          />
        ) : (
          <CollectionList
            items={catalogue}
            totalValue={totalValue}
            refreshingPrices={refreshingPrices}
            bulkEnrichProgress={bulkEnrichProgress}
            snapshots={snapshots}
            onOpen={(item) => {
              collectionScrollPos.current = window.scrollY;
              prevTabRef.current = "collection";
              setSelectedItem(item);
            }}
            onDelete={deleteFromCatalogue}
          />
        )
      )}

      {tab === "manage" && (
        <ManagePage
          catalogue={catalogue}
          totalValue={totalValue}
          onOpenItem={(item) => {
            manageScrollPos.current = window.scrollY;
            prevTabRef.current = "manage";
            setSelectedItem(item);
            setTab("collection");
          }}
          onListComic={listOnEbay}
          onBundleList={listBundleOnEbay}
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
