import { useEffect, useRef, useState } from "react";

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

function ScanZone({ onFile, inputRef }) {
  return (
    <label className="upload-zone">
      <div className="upload-emoji">📷</div>
      <div className="upload-text">Tap to scan a comic</div>
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

function ResultCard({ result }) {
  return (
    <div className="result-card">
      <div className="title">{result.title}</div>
      <div className="muted small">
        {result.publisher}
        {result.publisher && result.year ? " · " : ""}
        {result.year}
      </div>
      {result.grade && <div className="grade-badge">CGC {result.grade}</div>}
      {result.keyIssue && <div className="key-box">⭐ {result.keyIssue}</div>}
      {result.price && <div className="price">{result.price}</div>}
      {(result.priceLow || result.priceHigh) && (
        <div className="price-range">
          {result.priceLow} – {result.priceHigh}
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
            <div className="deal-sub">
              Current ask is {pctBelow}% below market
            </div>
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

export default function App() {
  const [tab, setTab] = useState("scan"); // 'scan' | 'buyer'
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const buyerFileRef = useRef(null);

  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const id = setInterval(() => {
      setStep((s) => (s + 1) % LOADING_STEPS.length);
    }, 1200);
    return () => clearInterval(id);
  }, [loading]);

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const gradeBlob = async (blob) => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const b64 = await fileToBase64(blob);
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: [b64] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to grade");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (e, which) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await gradeBlob(file);
    if (which === "scan" && fileRef.current) fileRef.current.value = "";
    if (which === "buyer" && buyerFileRef.current) buyerFileRef.current.value = "";
  };

  // Web Share Target: if launched via a share, pull the stashed image from
  // the service worker cache and run it straight through the grader.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share-target") !== "1") return;
    // Default to Buyer Mode — shared-in screenshots are almost always from a stream.
    setTab("buyer");
    (async () => {
      try {
        const res = await fetch("/__shared-image", { cache: "no-store" });
        if (!res.ok) return;
        const blob = await res.blob();
        if (blob.size > 0) await gradeBlob(blob);
      } catch {
        // Ignore; user can still upload manually.
      } finally {
        // Clean the URL so a refresh doesn't retry.
        window.history.replaceState({}, "", "/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const marketValue =
    parsePrice(result?.price) ??
    (() => {
      const lo = parsePrice(result?.priceLow);
      const hi = parsePrice(result?.priceHigh);
      if (lo != null && hi != null) return (lo + hi) / 2;
      return lo ?? hi ?? null;
    })();

  return (
    <div className="app">
      <header className="header">Comic Vault</header>

      {tab === "scan" && (
        <>
          {!loading && !result && !error && (
            <ScanZone onFile={(e) => handleFile(e, "scan")} inputRef={fileRef} />
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
              <ResultCard result={result} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
        </>
      )}

      {tab === "buyer" && (
        <>
          {!loading && !result && !error && (
            <label className="upload-zone compact">
              <div className="upload-emoji">📷</div>
              <div className="upload-text">Scan the book on stream</div>
              <input
                ref={buyerFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleFile(e, "buyer")}
                hidden
              />
            </label>
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
              <ResultCard result={result} />
              <BidCalculator marketValue={marketValue} />
              <button className="reset-btn" onClick={reset}>Scan another</button>
            </>
          )}
          {!result && !loading && !error && <BidCalculator marketValue={null} />}
        </>
      )}

      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === "scan" ? "active" : ""}`}
          onClick={() => { setTab("scan"); reset(); }}
        >
          <div className="tab-icon">📷</div>
          <div>Scan</div>
        </button>
        <button
          className={`tab-btn ${tab === "buyer" ? "active" : ""}`}
          onClick={() => { setTab("buyer"); reset(); }}
        >
          <div className="tab-icon">⚡</div>
          <div>Buyer Mode</div>
        </button>
      </nav>
    </div>
  );
}
