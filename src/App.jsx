import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllComics,
  putComic,
  deleteComic,
  migrateFromLocalStorage,
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

function ScanZone({ onFile, inputRef, compact, label }) {
  return (
    <label className={`upload-zone${compact ? " compact" : ""}`}>
      <div className="upload-emoji">📷</div>
      <div className="upload-text">{label}</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        hidden
      />
    </label>
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

function BidCalculator({ marketValue }) {
  const [bid, setBid] = useState("");
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
        {items.map((item) => (
          <div key={item.id} className="collection-item" onClick={() => onOpen(item)}>
            {item.image ? (
              <img src={item.image} alt="" loading="lazy" className="thumb" />
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
        ))}
      </div>
    </>
  );
}

function CollectionDetail({ item, onBack, onDelete, onList }) {
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState(null);

  const isListed = item.status === "listed" && item.ebayUrl;

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

  return (
    <div className="detail-view">
      <button className="back-btn" onClick={onBack}>← Back</button>
      {item.image && <img src={item.image} alt="" loading="lazy" className="detail-image" />}
      <ResultCard result={item} />
      <div className="muted small" style={{ textAlign: "center" }}>
        Scanned {new Date(item.timestamp).toLocaleString()}
      </div>

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
        >
          {listing ? "Listing on eBay..." : "List on eBay"}
        </button>
      )}

      {listError && <div className="error-text small">{listError}</div>}

      <button
        className="reset-btn danger"
        onClick={() => {
          if (confirm(`Delete "${item.title || "this comic"}"?`)) {
            onDelete(item.id);
            onBack();
          }
        }}
      >
        Delete from collection
      </button>
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
  const fileRef = useRef(null);
  const buyerFileRef = useRef(null);

  // Load catalogue from IndexedDB on mount (and migrate legacy localStorage data).
  useEffect(() => {
    (async () => {
      await migrateFromLocalStorage();
      const items = await getAllComics();
      setCatalogue(items);
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
      keyIssue: data.keyIssue || "",
      price: data.price || "",
      priceLow: data.priceLow || "",
      priceHigh: data.priceHigh || "",
      reason: data.reason || "",
      confidence: data.confidence || "",
      timestamp: Date.now(),
      image: thumb,
    };
    try {
      await putComic(entry);
    } catch (err) {
      // IndexedDB quota errors are rare but possible on very large libraries.
      // Retry once without the image before giving up.
      if (entry.image) {
        try {
          await putComic({ ...entry, image: null });
          entry.image = null;
        } catch {
          return;
        }
      } else {
        return;
      }
    }
    setCatalogue((prev) => [entry, ...prev]);
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
        if (save) addToCatalogue(data, b64);

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
            if (enrich) {
              // Explicitly preserve the cover image from the initial grade
              // response in case enrich ever returns its own image field.
              setResult((prev) =>
                prev ? { ...prev, ...enrich, image: prev.image } : prev
              );
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

  // Web Share Target handoff.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share-target") !== "1") return;
    setTab("buyer");
    (async () => {
      try {
        const res = await fetch("/__shared-image", { cache: "no-store" });
        if (!res.ok) return;
        const blob = await res.blob();
        if (blob.size > 0) await gradeBlob(blob);
      } catch {
        /* noop */
      } finally {
        window.history.replaceState({}, "", "/");
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
        image: item.image,
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

  const marketValue = marketValueOf(result);

  const totalValue = catalogue.reduce((sum, item) => {
    const v = marketValueOf(item);
    return sum + (v || 0);
  }, 0);

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

  return (
    <div className="app">
      <header className="header">Comic Vault</header>

      {tab === "scan" && (
        <>
          {!loading && !result && !error && (
            <ScanZone
              onFile={(e) => handleFile(e, "scan")}
              inputRef={fileRef}
              label="Tap to scan a comic"
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
              <BidCalculator marketValue={marketValue} />
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
      </nav>

      {!installDismissed && (installPrompt || showSafariBanner) && (
        <div
          role="dialog"
          aria-label="Install Comic Vault"
          style={{
            position: "fixed",
            bottom: 0,
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
            boxShadow: "0 -2px 12px rgba(0, 0, 0, 0.4)",
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
