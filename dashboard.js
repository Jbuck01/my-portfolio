"use strict";

// ── FRED series IDs ──────────────────────────────────────────────────────────

const FRED = {
  inflation:   "FPCPITOTLZGUSA",
  cpi:         "CPIAUCSL",
  coreCpi:     "CPILFESL",
  pce:         "PCEPI",
  housing:     "HOUST",
  mortgage30:  "MORTGAGE30US",
  mortgage15:  "MORTGAGE15US",
  caseShiller: "CSUSHPISA",
  homeSales:   "EXHOSLUSM495S",
  medianHome:  "MSPUS",
  treasury10y: "GS10",
  fedFunds:    "FEDFUNDS",
  unemployment:"UNRATE",
  umich:       "UMCSENT"
};

// ── DOM helpers ───────────────────────────────────────────────────────────────

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setClass(id, cls) {
  const el = document.getElementById(id);
  if (el) {
    el.className = el.className.replace(/\b(positive|negative|neutral)\b/g, "").trim() + " " + cls;
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

const fmt = {
  number(v, decimals = 2) {
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : "--";
  },
  pct(v, decimals = 2) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(decimals) + "%" : "--";
  },
  currency(v) {
    const n = Number(v);
    return Number.isFinite(n)
      ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "--";
  },
  millions(v, decimals = 2) {
    const n = Number(v);
    return Number.isFinite(n) ? (n / 1000).toFixed(decimals) + "M" : "--";
  },
  // For EXHOSLUSM495S which is already in millions
  millionsDirect(v, decimals = 2) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(decimals) + "M" : "--";
  }
};

function formatChange(current, prev) {
  const c = Number(current);
  const p = Number(prev);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return { text: "--", cls: "neutral" };
  const diff = c - p;
  const pct  = (diff / Math.abs(p)) * 100;
  const sign = diff >= 0 ? "+" : "";
  const arrow = diff >= 0 ? "▲" : "▼";
  const cls  = diff >= 0 ? "positive" : "negative";
  return {
    text: `${arrow} ${sign}${diff >= 10000 ? diff.toFixed(0) : diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,
    cls
  };
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ── Indicator application ─────────────────────────────────────────────────────

function applyIndicator(id, { value, prev, date, prevDate, formatted, prevFormatted, source }) {
  setText(id, formatted ?? "--");
  setText(`${id}-prev`, prevFormatted ?? "--");
  setText(`${id}-date`, date ? formatDate(date) : "");
  if (source) setText(`${id}-src`, source);

  const chg = formatChange(value, prev);
  setText(`${id}-chg`, chg.text);
  setClass(`${id}-chg`, `ic-change ${chg.cls}`);
}

function resetIndicator(id) {
  setText(id, "--");
  setText(`${id}-prev`, "--");
  setText(`${id}-chg`, "--");
  setText(`${id}-date`, "");
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchFredSeries(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED ${seriesId} failed: ${res.status}`);
  const csv = await res.text();
  const rows = csv.trim().split("\n").slice(1)
    .map(r => { const [d, v] = r.split(","); return { date: d, value: v?.trim() }; })
    .filter(r => r.value && r.value !== ".");
  const latest = rows[rows.length - 1];
  const prev   = rows[rows.length - 2];
  return {
    value:    parseFloat(latest?.value),
    date:     latest?.date,
    prev:     parseFloat(prev?.value),
    prevDate: prev?.date
  };
}

async function fetchYahooFinance(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res  = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo Finance ${symbol} failed: ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo data for ${symbol}`);
  const meta       = result.meta;
  const closes     = result.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result.timestamp ?? [];
  const valid = [];
  for (let i = closes.length - 1; i >= 0 && valid.length < 2; i--) {
    if (closes[i] != null) valid.push({ close: closes[i], ts: timestamps[i] });
  }
  const latest = valid[0];
  const prev   = valid[1];
  const toDate = ts => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;
  return {
    value:    latest?.close ?? meta.regularMarketPrice,
    date:     toDate(latest?.ts),
    prev:     prev?.close ?? meta.chartPreviousClose ?? null,
    prevDate: toDate(prev?.ts)
  };
}

async function fetchExchangeRate() {
  const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD");
  if (!res.ok) throw new Error("Frankfurter failed");
  const data = await res.json();
  const rate = data.rates?.USD;
  if (!rate) throw new Error("No EUR/USD rate");
  return { value: rate, date: data.date, prev: null, prevDate: null };
}

async function tryLoadSnapshot() {
  try {
    const res = await fetch("data/snapshot.json");
    if (!res.ok) return null;
    const json = await res.json();
    return json;
  } catch {
    return null;
  }
}

// ── Main refresh ──────────────────────────────────────────────────────────────

const stockMap = {
  sp500:      { symbol: "^GSPC", label: "S&P 500",     formatFn: v => fmt.number(v, 2) },
  dow:        { symbol: "^DJI",  label: "Dow Jones",   formatFn: v => fmt.number(v, 2) },
  nasdaq:     { symbol: "^IXIC", label: "Nasdaq",      formatFn: v => fmt.number(v, 2) },
  russell2000:{ symbol: "^RUT",  label: "Russell 2000",formatFn: v => fmt.number(v, 2) },
  vix:        { symbol: "^VIX",  label: "VIX",         formatFn: v => Number(v).toFixed(2) },
  qqq:        { symbol: "QQQ",   label: "QQQ",         formatFn: v => fmt.number(v, 2) },
  xlc:        { symbol: "XLC",   label: "XLC",         formatFn: v => fmt.number(v, 2) },
  botz:       { symbol: "BOTZ",  label: "BOTZ",        formatFn: v => fmt.number(v, 2) }
};

const fredMap = {
  "fed-funds":   { series: FRED.fedFunds,    formatFn: v => fmt.pct(v, 2), prevFn: v => fmt.pct(v, 2) },
  "treasury10y": { series: FRED.treasury10y, formatFn: v => fmt.pct(v, 2), prevFn: v => fmt.pct(v, 2) },
  "inflation":   { series: FRED.inflation,   formatFn: v => fmt.pct(v, 1), prevFn: v => fmt.pct(v, 1) },
  "cpi":         { series: FRED.cpi,         formatFn: v => fmt.number(v, 2), prevFn: v => fmt.number(v, 2) },
  "core-cpi":    { series: FRED.coreCpi,     formatFn: v => fmt.number(v, 2), prevFn: v => fmt.number(v, 2) },
  "pce":         { series: FRED.pce,         formatFn: v => fmt.number(v, 2), prevFn: v => fmt.number(v, 2) },
  "unemployment":{ series: FRED.unemployment,formatFn: v => fmt.pct(v, 1), prevFn: v => fmt.pct(v, 1) },
  "umich":       { series: FRED.umich,       formatFn: v => fmt.number(v, 1), prevFn: v => fmt.number(v, 1) },
  "mortgage30":  { series: FRED.mortgage30,  formatFn: v => fmt.pct(v, 2), prevFn: v => fmt.pct(v, 2) },
  "mortgage15":  { series: FRED.mortgage15,  formatFn: v => fmt.pct(v, 2), prevFn: v => fmt.pct(v, 2) },
  "housing":     { series: FRED.housing,     formatFn: v => fmt.millions(v), prevFn: v => fmt.millions(v) },
  "home-sales":  { series: FRED.homeSales,   formatFn: v => fmt.millionsDirect(v), prevFn: v => fmt.millionsDirect(v) },
  "case-shiller":{ series: FRED.caseShiller, formatFn: v => fmt.number(v, 2), prevFn: v => fmt.number(v, 2) },
  "median-home": { series: FRED.medianHome,  formatFn: v => fmt.currency(v), prevFn: v => fmt.currency(v) }
};

function showStaleWarning() {
  const el = document.getElementById("stale-warning");
  if (el) el.hidden = false;
}

function updateTimestamp(label) {
  const ts = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  setText("updated-at", `Updated: ${ts}`);
  setText("footer-updated", `Last updated: ${ts}${label ? " · " + label : ""}`);
}

async function refreshDashboard() {
  const btn = document.getElementById("refresh-data");
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }

  // Try snapshot first
  const snapshot = await tryLoadSnapshot();
  const snapshotAge = snapshot?.updated
    ? (Date.now() - new Date(snapshot.updated).getTime()) / 86400000
    : Infinity;
  const isStale = snapshotAge > 3;

  // Apply stocks from snapshot
  if (snapshot?.stocks) {
    for (const [id, cfg] of Object.entries(stockMap)) {
      const data = snapshot.stocks[id];
      if (data?.value) {
        applyIndicator(id, {
          value:         data.value,
          prev:          data.prev,
          date:          data.date,
          prevDate:      data.prevDate,
          formatted:     cfg.formatFn(data.value),
          prevFormatted: data.prev ? cfg.formatFn(data.prev) : "--",
          source:        "Snapshot · Yahoo Finance"
        });
      }
    }
  }

  // Apply FRED from snapshot
  if (snapshot?.fred) {
    const snapshotFredKeys = {
      "fed-funds":   "fedFunds",
      "treasury10y": "treasury10y",
      "inflation":   "inflation",
      "cpi":         "cpi",
      "core-cpi":    "coreCpi",
      "pce":         "pce",
      "unemployment":"unemployment",
      "umich":       "umich",
      "mortgage30":  "mortgage30",
      "mortgage15":  "mortgage15",
      "housing":     "housing",
      "home-sales":  "homeSales",
      "case-shiller":"caseShiller",
      "median-home": "medianHome"
    };
    for (const [id, snapshotKey] of Object.entries(snapshotFredKeys)) {
      const data = snapshot.fred[snapshotKey];
      const cfg  = fredMap[id];
      if (data?.value && cfg) {
        applyIndicator(id, {
          value:         data.value,
          prev:          data.prev,
          date:          data.date,
          prevDate:      data.prevDate,
          formatted:     cfg.formatFn(data.value),
          prevFormatted: data.prev ? cfg.prevFn(data.prev) : "--",
          source:        `Snapshot · FRED ${data.series ?? ""}`
        });
      }
    }
  }

  // Apply FX from snapshot
  if (snapshot?.fx?.eurusd?.value) {
    const d = snapshot.fx.eurusd;
    applyIndicator("eurusd", {
      value: d.value, prev: d.prev, date: d.date,
      formatted: d.value.toFixed(4),
      prevFormatted: d.prev ? d.prev.toFixed(4) : "--",
      source: "Snapshot · Frankfurter"
    });
  }

  if (isStale && snapshotAge < Infinity) showStaleWarning();
  if (snapshotAge < Infinity) updateTimestamp("snapshot");

  // Always attempt live fetch in parallel for fresh data
  const livePromises = [];

  // Live stocks
  for (const [id, cfg] of Object.entries(stockMap)) {
    livePromises.push(
      fetchYahooFinance(cfg.symbol)
        .then(data => {
          applyIndicator(id, {
            value:         data.value,
            prev:          data.prev,
            date:          data.date,
            formatted:     cfg.formatFn(data.value),
            prevFormatted: data.prev ? cfg.formatFn(data.prev) : "--",
            source:        "Yahoo Finance · delayed"
          });
        })
        .catch(err => {
          console.warn(`Stock ${id}:`, err.message);
          if (!snapshot?.stocks?.[id]?.value) resetIndicator(id);
        })
    );
  }

  // Live FRED
  for (const [id, cfg] of Object.entries(fredMap)) {
    livePromises.push(
      fetchFredSeries(cfg.series)
        .then(data => {
          applyIndicator(id, {
            value:         data.value,
            prev:          data.prev,
            date:          data.date,
            formatted:     cfg.formatFn(data.value),
            prevFormatted: data.prev ? cfg.prevFn(data.prev) : "--",
            source:        `FRED · ${cfg.series}`
          });
        })
        .catch(err => {
          console.warn(`FRED ${id}:`, err.message);
          if (!snapshot?.fred) resetIndicator(id);
        })
    );
  }

  // Live FX
  livePromises.push(
    fetchExchangeRate()
      .then(data => {
        applyIndicator("eurusd", {
          value: data.value, prev: data.prev, date: data.date,
          formatted:     data.value.toFixed(4),
          prevFormatted: data.prev ? data.prev.toFixed(4) : "--",
          source:        "Frankfurter"
        });
      })
      .catch(err => {
        console.warn("FX:", err.message);
        if (!snapshot?.fx?.eurusd?.value) resetIndicator("eurusd");
      })
  );

  await Promise.allSettled(livePromises);
  updateTimestamp("live");

  if (btn) { btn.disabled = false; btn.textContent = "↻ Refresh data"; }
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.getElementById("refresh-data")?.addEventListener("click", refreshDashboard);
document.getElementById("dismiss-warning")?.addEventListener("click", () => {
  const el = document.getElementById("stale-warning");
  if (el) el.hidden = true;
});

// Auto-load on page open
refreshDashboard();

// ── Company Lookup ────────────────────────────────────────────────────────────

const LOOKUP_PROXIES = [
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => url
];

async function fetchWithProxy(url) {
  let lastErr;
  for (const wrap of LOOKUP_PROXIES) {
    try {
      const res = await fetch(wrap(url), { headers: { Accept: "application/json" } });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("All proxies failed");
}

function rawOrNull(v) {
  if (v == null) return null;
  if (typeof v === "object") return v.raw ?? null;
  return Number.isFinite(v) ? v : null;
}

const lkFmt = {
  bigCurrency(n) {
    if (!Number.isFinite(n)) return "--";
    const abs = Math.abs(n);
    if (abs >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
    if (abs >= 1e9)  return "$" + (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6)  return "$" + (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3)  return "$" + (n / 1e3).toFixed(2) + "K";
    return "$" + n.toFixed(2);
  },
  bigNumber(n) {
    if (!Number.isFinite(n)) return "--";
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toLocaleString("en-US");
  },
  ratio(n, decimals = 2) {
    return Number.isFinite(n) ? n.toFixed(decimals) + "×" : "--";
  },
  multiple(n, decimals = 2) {
    return Number.isFinite(n) ? n.toFixed(decimals) : "--";
  },
  pct(n, decimals = 2) {
    if (!Number.isFinite(n)) return "--";
    return (n * 100).toFixed(decimals) + "%";
  },
  pctDirect(n, decimals = 2) {
    return Number.isFinite(n) ? n.toFixed(decimals) + "%" : "--";
  },
  price(n) {
    return Number.isFinite(n)
      ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "--";
  },
  range(lo, hi) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "--";
    return `${lkFmt.price(lo)} – ${lkFmt.price(hi)}`;
  }
};

function setLk(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showLookupStatus(msg, isError = false) {
  const el = document.getElementById("lookup-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "lookup-status" + (isError ? " error" : "");
  el.hidden = false;
}

function hideLookupStatus() {
  const el = document.getElementById("lookup-status");
  if (el) el.hidden = true;
}

function showLookupResult() {
  const el = document.getElementById("lookup-result");
  if (el) el.hidden = false;
}

async function fetchYahooSearch(query) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
  return await fetchWithProxy(url);
}

async function fetchYahooChart(symbol, range = "1y", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  // chart endpoint usually works direct; only fall back to proxy if it fails
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) return await res.json();
  } catch (_) { /* fall through */ }
  return await fetchWithProxy(url);
}

async function fetchYahooSummary(symbol) {
  const modules = [
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "price",
    "assetProfile",
    "summaryProfile"
  ].join(",");
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  return await fetchWithProxy(url);
}

function buildSparkPaths(closes) {
  const valid = closes.map((v, i) => ({ v, i })).filter(p => Number.isFinite(p.v));
  if (valid.length < 2) return { line: "", fill: "" };
  const w = 600, h = 120;
  const min = Math.min(...valid.map(p => p.v));
  const max = Math.max(...valid.map(p => p.v));
  const range = (max - min) || 1;
  const stepX = w / (valid.length - 1);
  const pad = 6;
  const usableH = h - pad * 2;
  const points = valid.map((p, i) => {
    const x = i * stepX;
    const y = pad + usableH - ((p.v - min) / range) * usableH;
    return [x, y];
  });
  const line = points.map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : `L${x.toFixed(1)} ${y.toFixed(1)}`)).join(" ");
  const first = points[0], last = points[points.length - 1];
  const fill = `${line} L${last[0].toFixed(1)} ${h} L${first[0].toFixed(1)} ${h} Z`;
  return { line, fill };
}

function renderQuote(symbol, chartJson) {
  const result = chartJson?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  const meta = result.meta || {};
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const price = meta.regularMarketPrice;
  const prev  = meta.chartPreviousClose ?? meta.previousClose;
  const change = (Number.isFinite(price) && Number.isFinite(prev)) ? price - prev : null;
  const changePct = (change != null && prev) ? (change / prev) * 100 : null;

  setLk("lk-symbol", (meta.symbol || symbol).toUpperCase());
  setLk("lk-exch", meta.exchangeName ? `· ${meta.exchangeName}` : "");
  setLk("lk-price", lkFmt.price(price));
  setLk("lk-prev-close", lkFmt.price(prev));
  setLk("lk-currency", meta.currency || "--");
  setLk("lk-day-range", lkFmt.range(meta.regularMarketDayLow, meta.regularMarketDayHigh));
  setLk("lk-52w-range", lkFmt.range(meta.fiftyTwoWeekLow, meta.fiftyTwoWeekHigh));
  setLk("lk-volume", lkFmt.bigNumber(meta.regularMarketVolume));

  const chgEl = document.getElementById("lk-change");
  if (chgEl) {
    if (change == null) {
      chgEl.textContent = "--";
      chgEl.className = "lookup-change neutral";
    } else {
      const sign = change >= 0 ? "+" : "";
      chgEl.textContent = `${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`;
      chgEl.className = "lookup-change " + (change >= 0 ? "positive" : "negative");
    }
  }

  if (Number.isFinite(meta.regularMarketTime)) {
    const d = new Date(meta.regularMarketTime * 1000);
    setLk("lk-asof", "As of " + d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }));
  } else {
    setLk("lk-asof", "");
  }

  const { line, fill } = buildSparkPaths(closes);
  const lineEl = document.getElementById("lk-spark-line");
  const fillEl = document.getElementById("lk-spark-fill");
  if (lineEl) lineEl.setAttribute("d", line);
  if (fillEl) fillEl.setAttribute("d", fill);
}

function renderFundamentals(summaryJson) {
  const r = summaryJson?.quoteSummary?.result?.[0];
  if (!r) return false;
  const sd = r.summaryDetail || {};
  const ks = r.defaultKeyStatistics || {};
  const fd = r.financialData || {};
  const pr = r.price || {};
  const ap = r.assetProfile || r.summaryProfile || {};

  // Header
  if (pr.longName || pr.shortName) setLk("lk-name", pr.longName || pr.shortName);
  if (ap.sector)   setLk("lk-sector",   ap.sector);
  if (ap.industry) setLk("lk-industry", ap.industry);

  // Quote extras
  setLk("lk-avg-volume", lkFmt.bigNumber(rawOrNull(sd.averageVolume) ?? rawOrNull(sd.averageDailyVolume10Day)));

  // Valuation
  setLk("lk-mktcap",    lkFmt.bigCurrency(rawOrNull(sd.marketCap) ?? rawOrNull(pr.marketCap)));
  setLk("lk-ev",        lkFmt.bigCurrency(rawOrNull(ks.enterpriseValue)));
  setLk("lk-pe",        lkFmt.multiple(rawOrNull(sd.trailingPE)));
  setLk("lk-fpe",       lkFmt.multiple(rawOrNull(sd.forwardPE) ?? rawOrNull(ks.forwardPE)));
  setLk("lk-ps",        lkFmt.multiple(rawOrNull(sd.priceToSalesTrailing12Months)));
  setLk("lk-ev-ebitda", lkFmt.multiple(rawOrNull(ks.enterpriseToEbitda)));
  setLk("lk-ev-rev",    lkFmt.multiple(rawOrNull(ks.enterpriseToRevenue)));
  setLk("lk-peg",       lkFmt.multiple(rawOrNull(ks.pegRatio)));

  // Profitability & growth
  setLk("lk-rev",           lkFmt.bigCurrency(rawOrNull(fd.totalRevenue)));
  setLk("lk-rev-growth",    lkFmt.pct(rawOrNull(fd.revenueGrowth)));
  setLk("lk-gross-margin",  lkFmt.pct(rawOrNull(fd.grossMargins)));
  setLk("lk-op-margin",     lkFmt.pct(rawOrNull(fd.operatingMargins)));
  setLk("lk-profit-margin", lkFmt.pct(rawOrNull(fd.profitMargins) ?? rawOrNull(ks.profitMargins)));
  setLk("lk-eps",           lkFmt.price(rawOrNull(ks.trailingEps)));
  setLk("lk-roe",           lkFmt.pct(rawOrNull(fd.returnOnEquity)));
  setLk("lk-roa",           lkFmt.pct(rawOrNull(fd.returnOnAssets)));

  // Balance sheet
  const cash = rawOrNull(fd.totalCash);
  const debt = rawOrNull(fd.totalDebt);
  setLk("lk-cash",      lkFmt.bigCurrency(cash));
  setLk("lk-debt",      lkFmt.bigCurrency(debt));
  setLk("lk-net-debt",  lkFmt.bigCurrency(Number.isFinite(cash) && Number.isFinite(debt) ? (debt - cash) : null));
  const de = rawOrNull(fd.debtToEquity);
  setLk("lk-de",        Number.isFinite(de) ? (de / 100).toFixed(2) : "--");
  setLk("lk-current",   lkFmt.multiple(rawOrNull(fd.currentRatio)));
  setLk("lk-fcf",       lkFmt.bigCurrency(rawOrNull(fd.freeCashflow)));
  setLk("lk-div-yield", lkFmt.pct(rawOrNull(sd.dividendYield)));
  setLk("lk-beta",      lkFmt.multiple(rawOrNull(sd.beta) ?? rawOrNull(ks.beta)));

  return true;
}

function clearFundamentals(name = "--") {
  setLk("lk-name", name);
  setLk("lk-sector", "—");
  setLk("lk-industry", "—");
  ["lk-avg-volume","lk-mktcap","lk-ev","lk-pe","lk-fpe","lk-ps","lk-ev-ebitda","lk-ev-rev","lk-peg",
   "lk-rev","lk-rev-growth","lk-gross-margin","lk-op-margin","lk-profit-margin","lk-eps","lk-roe","lk-roa",
   "lk-cash","lk-debt","lk-net-debt","lk-de","lk-current","lk-fcf","lk-div-yield","lk-beta"
  ].forEach(id => setLk(id, "--"));
}

async function lookupTicker(rawSymbol) {
  const symbol = String(rawSymbol || "").trim().toUpperCase();
  if (!symbol) return;
  hideSuggestions();
  showLookupStatus(`Loading ${symbol}…`);

  // 1) Chart (price + sparkline) – usually works direct
  let chartJson;
  try {
    chartJson = await fetchYahooChart(symbol, "1y", "1d");
  } catch (err) {
    showLookupStatus(`Could not load price data for "${symbol}". ${err.message}`, true);
    return;
  }
  if (chartJson?.chart?.error || !chartJson?.chart?.result?.[0]) {
    showLookupStatus(`No price data for "${symbol}". Try a different ticker.`, true);
    return;
  }

  clearFundamentals();
  try {
    renderQuote(symbol, chartJson);
  } catch (err) {
    showLookupStatus(`Could not parse price data: ${err.message}`, true);
    return;
  }
  showLookupResult();
  showLookupStatus("Loading fundamentals…");

  // 2) Fundamentals via CORS proxy
  try {
    const summary = await fetchYahooSummary(symbol);
    if (summary?.quoteSummary?.error) {
      throw new Error(summary.quoteSummary.error.description || "Yahoo error");
    }
    const ok = renderFundamentals(summary);
    if (!ok) throw new Error("No fundamentals returned");
    hideLookupStatus();
  } catch (err) {
    console.warn("Fundamentals failed:", err);
    setLk("lk-name", chartJson.chart.result[0].meta?.symbol || symbol);
    showLookupStatus(`Showing price only — fundamentals unavailable (${err.message}). Public CORS proxies can rate-limit; try again in a moment.`, true);
  }

  const url = new URL(window.location.href);
  url.hash = "lookup=" + symbol;
  history.replaceState(null, "", url);
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

let suggestionState = { items: [], active: -1, controller: null };

function hideSuggestions() {
  const el = document.getElementById("ticker-suggestions");
  if (el) { el.hidden = true; el.innerHTML = ""; }
  suggestionState = { items: [], active: -1, controller: null };
}

function renderSuggestions(items) {
  const el = document.getElementById("ticker-suggestions");
  if (!el) return;
  if (!items.length) { hideSuggestions(); return; }
  suggestionState.items = items;
  suggestionState.active = -1;
  el.innerHTML = items.map((q, i) => `
    <li role="option" data-index="${i}" data-symbol="${q.symbol}">
      <span class="sg-symbol">${q.symbol}</span>
      <span class="sg-name">${q.shortname || q.longname || ""}</span>
      <span class="sg-exch">${q.exchDisp || q.exchange || ""}</span>
    </li>`).join("");
  el.hidden = false;
}

function highlightSuggestion(idx) {
  const el = document.getElementById("ticker-suggestions");
  if (!el) return;
  const lis = el.querySelectorAll("li");
  lis.forEach((li, i) => li.classList.toggle("active", i === idx));
  suggestionState.active = idx;
}

let searchTimer = null;
function scheduleSearch(query) {
  clearTimeout(searchTimer);
  if (!query || query.length < 1) { hideSuggestions(); return; }
  searchTimer = setTimeout(async () => {
    try {
      const json = await fetchYahooSearch(query);
      const quotes = (json?.quotes || []).filter(q => q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "INDEX"));
      renderSuggestions(quotes.slice(0, 8));
    } catch (err) {
      console.warn("Search failed:", err);
      hideSuggestions();
    }
  }, 220);
}

// ── Wire up events ────────────────────────────────────────────────────────────

const tickerInput = document.getElementById("ticker-input");
const tickerGo    = document.getElementById("ticker-go");
const suggestEl   = document.getElementById("ticker-suggestions");

tickerInput?.addEventListener("input", e => scheduleSearch(e.target.value));
tickerInput?.addEventListener("keydown", e => {
  const items = suggestionState.items;
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    highlightSuggestion((suggestionState.active + 1) % items.length);
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    highlightSuggestion((suggestionState.active - 1 + items.length) % items.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const chosen = items[suggestionState.active];
    if (chosen) lookupTicker(chosen.symbol);
    else if (tickerInput.value.trim()) lookupTicker(tickerInput.value);
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

tickerInput?.addEventListener("blur", () => { setTimeout(hideSuggestions, 150); });

suggestEl?.addEventListener("mousedown", e => {
  const li = e.target.closest("li[data-symbol]");
  if (!li) return;
  e.preventDefault();
  const sym = li.getAttribute("data-symbol");
  if (tickerInput) tickerInput.value = sym;
  lookupTicker(sym);
});

tickerGo?.addEventListener("click", () => {
  const v = tickerInput?.value?.trim();
  if (v) lookupTicker(v);
});

document.querySelectorAll(".lookup-chip").forEach(btn => {
  btn.addEventListener("click", () => {
    const sym = btn.getAttribute("data-symbol");
    if (!sym) return;
    if (tickerInput) tickerInput.value = sym;
    lookupTicker(sym);
  });
});

// Deep-link support (#lookup=AAPL)
{
  const m = /lookup=([A-Za-z0-9.\-^]+)/.exec(window.location.hash || "");
  if (m && tickerInput) {
    tickerInput.value = m[1].toUpperCase();
    lookupTicker(m[1]);
  }
}
