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

// ════════════════════════════════════════════════════════════════════════════
// Market Overview (Feature 1) + Stock Research Panel (Feature 2 + 3)
// ════════════════════════════════════════════════════════════════════════════

// Cloudflare Worker URL — paste your deployed *.workers.dev URL here to enable
// fundamentals/news/peers for arbitrary tickers. When left as the placeholder,
// the dashboard falls back to chart-only data for non-cached tickers.
// Source: worker/yahoo-proxy.js (see comment header for deploy steps).
const WORKER_URL = "https://yahoo-proxy.jedbuckert.workers.dev";
const WORKER_ENABLED = WORKER_URL && !WORKER_URL.startsWith("REPLACE");

async function workerFetch(path, params) {
  if (!WORKER_ENABLED) throw new Error("Worker URL not configured");
  const qs = new URLSearchParams(params).toString();
  const url = `${WORKER_URL}${path}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch {}
    throw new Error(`Worker ${path} ${res.status}${detail ? ": " + detail : ""}`);
  }
  return res.json();
}

const COLORS = {
  accent: "#5db8f5",
  green:  "#4bd498",
  red:    "#e06868",
  muted:  "#8890a4",
  line:   "#272c3a"
};

// ── Chart helpers ─────────────────────────────────────────────────────────────

const chartRegistry = {};

function destroyChart(id) {
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
    delete chartRegistry[id];
  }
}

function waitForChart(retries = 60) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (typeof Chart !== "undefined") return resolve();
      if (--retries <= 0) return reject(new Error("Chart.js failed to load"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function makeMiniLineChart(canvasId, dates, values, color) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || !values?.length) return;
  chartRegistry[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: dates,
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: color + "22",
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.15
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      interaction: { mode: "nearest", intersect: false },
      animation: false
    }
  });
}

function makePriceVolumeChart(canvasId, dates, closes, volumes) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || !closes?.length) return;
  chartRegistry[canvasId] = new Chart(ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: "line",
          label: "Price",
          data: closes,
          borderColor: COLORS.accent,
          backgroundColor: COLORS.accent + "22",
          borderWidth: 1.8,
          pointRadius: 0,
          yAxisID: "y",
          tension: 0.15,
          fill: true,
          order: 1
        },
        {
          type: "bar",
          label: "Volume",
          data: volumes,
          backgroundColor: COLORS.muted + "55",
          borderWidth: 0,
          yAxisID: "y1",
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { color: COLORS.muted, boxWidth: 14 } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed.y;
              if (ctx.dataset.label === "Volume") {
                return `Volume: ${v ? Number(v).toLocaleString() : "--"}`;
              }
              return `${ctx.dataset.label}: ${v != null ? Number(v).toFixed(2) : "--"}`;
            }
          }
        }
      },
      scales: {
        x:  { ticks: { color: COLORS.muted, maxTicksLimit: 6 }, grid: { color: COLORS.line } },
        y:  { position: "left", ticks: { color: COLORS.muted }, grid: { color: COLORS.line } },
        y1: { position: "right", ticks: { color: COLORS.muted, callback: v => (v >= 1e6 ? (v/1e6).toFixed(0) + "M" : v) }, grid: { drawOnChartArea: false } }
      },
      animation: false
    }
  });
}

function makeBarChart(canvasId, labels, datasets) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  chartRegistry[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: COLORS.muted } },
        tooltip: { mode: "index", intersect: false }
      },
      scales: {
        x: { ticks: { color: COLORS.muted }, grid: { color: COLORS.line } },
        y: { ticks: { color: COLORS.muted }, grid: { color: COLORS.line } }
      },
      animation: false
    }
  });
}

// ── Market Overview ───────────────────────────────────────────────────────────

const MARKET_OVERVIEW = [
  { key: "sp500",       cardId: "mo-sp500", chartId: "chart-sp500", symbol: "^GSPC" },
  { key: "nasdaq100",   cardId: "mo-ndx",   chartId: "chart-ndx",   symbol: "^NDX"  },
  { key: "dow",         cardId: "mo-dow",   chartId: "chart-dow",   symbol: "^DJI"  },
  { key: "russell2000", cardId: "mo-rut",   chartId: "chart-rut",   symbol: "^RUT"  },
  { key: "vix",         cardId: "mo-vix",   chartId: "chart-vix",   symbol: "^VIX"  }
];

function renderMarketOverviewCard(entry, quote, history) {
  if (!quote) return;
  setText(entry.cardId, fmt.number(quote.value, 2));
  const chg = formatChange(quote.value, quote.prev);
  setText(`${entry.cardId}-chg`, chg.text);
  setClass(`${entry.cardId}-chg`, `ic-change ${chg.cls}`);
  setText(`${entry.cardId}-date`, quote.date ? formatDate(quote.date) : "");

  if (history?.dates?.length && history?.closes?.length) {
    const trendUp = history.closes[history.closes.length - 1] >= history.closes[0];
    const color = trendUp ? COLORS.green : COLORS.red;
    makeMiniLineChart(entry.chartId, history.dates, history.closes, color);
  }
}

async function renderMarketOverview(snapshot) {
  await waitForChart().catch(err => console.warn(err.message));
  for (const entry of MARKET_OVERVIEW) {
    const quote   = snapshot?.stocks?.[entry.key];
    const history = snapshot?.indexHistory?.[entry.symbol];
    renderMarketOverviewCard(entry, quote, history);
  }
}

async function refreshMarketOverviewQuotes() {
  // Live-refresh just the price/change/date fields (not the chart) every 5 minutes
  for (const entry of MARKET_OVERVIEW) {
    try {
      const quote = await fetchYahooFinance(entry.symbol);
      setText(entry.cardId, fmt.number(quote.value, 2));
      const chg = formatChange(quote.value, quote.prev);
      setText(`${entry.cardId}-chg`, chg.text);
      setClass(`${entry.cardId}-chg`, `ic-change ${chg.cls}`);
      if (quote.date) setText(`${entry.cardId}-date`, formatDate(quote.date));
    } catch (e) {
      console.warn(`Live refresh ${entry.symbol}:`, e.message);
    }
  }
}

// ── Stock Research Panel ──────────────────────────────────────────────────────

let currentSnapshot = null;
let currentTicker   = null;

const POPULAR_TICKERS = ["AAPL","MSFT","GOOGL","AMZN","NVDA","TSLA","META","JPM","V","BRK-B"];

const fmtMetric = {
  pct(v, decimals = 2) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return (n * 100).toFixed(decimals) + "%";
  },
  pctRaw(v, decimals = 2) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n.toFixed(decimals) + "%";
  },
  number(v, decimals = 2) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : null;
  },
  ratio(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) + "×" : null;
  },
  bigDollar(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (abs >= 1e9)  return (n / 1e9).toFixed(2)  + "B";
    if (abs >= 1e6)  return (n / 1e6).toFixed(2)  + "M";
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  },
  dollar(v, decimals = 2) {
    const n = Number(v);
    return Number.isFinite(n) ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : null;
  }
};

function metricCard(label, value, sub) {
  const v = value ?? "--";
  const isEmpty = value == null;
  const subHtml = sub ? `<span class="metric-card-sub">${sub}</span>` : "";
  return `<div class="metric-card">
    <span class="metric-card-label">${label}</span>
    <span class="metric-card-value${isEmpty ? " empty" : ""}">${v}</span>
    ${subHtml}
  </div>`;
}

function fillGrid(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function showStockError(msg) {
  const err = document.getElementById("stock-error");
  const panel = document.getElementById("stock-panel");
  const loading = document.getElementById("stock-loading");
  if (loading) loading.hidden = true;
  if (panel) panel.hidden = true;
  if (err) {
    err.hidden = false;
    err.textContent = msg;
  }
}

function clearStockError() {
  const err = document.getElementById("stock-error");
  if (err) err.hidden = true;
}

function setStockLoading(on) {
  const loading = document.getElementById("stock-loading");
  if (loading) loading.hidden = !on;
}

function renderStockHeader(ticker, fundamentals, liveQuote) {
  const profile = fundamentals?.profile || {};
  const quote   = fundamentals?.quote   || {};
  const analyst = fundamentals?.analyst || {};
  const price   = liveQuote?.value ?? quote?.price;
  const prev    = liveQuote?.prev;
  const change  = (price != null && prev != null && prev !== 0)
    ? { abs: price - prev, pct: ((price - prev) / Math.abs(prev)) * 100 }
    : null;
  const cls = change && change.abs >= 0 ? "positive" : (change ? "negative" : "neutral");
  const arrow = change && change.abs >= 0 ? "▲" : (change ? "▼" : "");
  const sign  = change && change.abs >= 0 ? "+" : "";

  const high52 = liveQuote?.fiftyTwoWeekHigh ?? quote?.fiftyTwoWeekHigh;
  const low52  = liveQuote?.fiftyTwoWeekLow  ?? quote?.fiftyTwoWeekLow;
  const recKey = analyst.recommendationKey ? analyst.recommendationKey.replace(/_/g, " ") : null;
  const target = analyst.targetMean;

  const recBadgeClass = recKey
    ? (/buy|outperform/i.test(recKey) ? "badge-green" : (/sell|underperform/i.test(recKey) ? "badge-red" : "badge-blue"))
    : "badge-blue";

  const headerEl = document.getElementById("stock-header");
  if (!headerEl) return;
  headerEl.innerHTML = `
    <div class="stock-header-main">
      <h3 class="stock-header-name">${profile.longName || profile.shortName || liveQuote?.longName || ticker}</h3>
      <div class="stock-header-meta">${ticker}${profile.exchange || liveQuote?.exchange ? " · " + (profile.exchange || liveQuote?.exchange) : ""}${profile.sector ? " · " + profile.sector : ""}</div>
      <div class="stock-header-price">
        <strong>${price != null ? fmtMetric.dollar(price, 2) : "--"}</strong>
        ${change ? `<span class="ic-change ${cls}">${arrow} ${sign}${change.abs.toFixed(2)} (${sign}${change.pct.toFixed(2)}%)</span>` : ""}
      </div>
    </div>
    <div class="stock-header-side">
      <div class="stock-header-row"><span>52-week high</span><strong>${high52 != null ? fmtMetric.dollar(high52, 2) : "--"}</strong></div>
      <div class="stock-header-row"><span>52-week low</span><strong>${low52 != null ? fmtMetric.dollar(low52, 2) : "--"}</strong></div>
      <div class="stock-header-row"><span>Analyst rating</span>${recKey ? `<span class="badge ${recBadgeClass}">${recKey.toUpperCase()}</span>` : "<strong>--</strong>"}</div>
      <div class="stock-header-row"><span>Price target (mean)</span><strong>${target != null ? fmtMetric.dollar(target, 2) : "--"}</strong></div>
      ${analyst.numberOfAnalysts ? `<div class="stock-header-row"><span>Analyst coverage</span><strong>${analyst.numberOfAnalysts} analysts</strong></div>` : ""}
    </div>`;
}

function renderStockMetrics(fundamentals) {
  const v = fundamentals?.valuation || {};
  const i = fundamentals?.income    || {};
  const b = fundamentals?.balance   || {};
  const c = fundamentals?.cashflow  || {};
  const r = fundamentals?.returns   || {};

  fillGrid("stock-valuation", [
    metricCard("P/E (trailing)", fmtMetric.ratio(v.trailingPE)),
    metricCard("P/E (forward)",  fmtMetric.ratio(v.forwardPE)),
    metricCard("EV / EBITDA",    fmtMetric.ratio(v.evToEbitda)),
    metricCard("Price / Sales",  fmtMetric.ratio(v.priceToSales)),
    metricCard("Price / Book",   fmtMetric.ratio(v.priceToBook)),
    metricCard("PEG Ratio",      fmtMetric.ratio(v.pegRatio))
  ].join(""));

  fillGrid("stock-income", [
    metricCard("Revenue (TTM)",  fmtMetric.bigDollar(i.revenueTTM) ? "$" + fmtMetric.bigDollar(i.revenueTTM) : null),
    metricCard("Revenue growth (YoY)", fmtMetric.pct(i.revenueGrowthYoY, 2)),
    metricCard("Gross margin",   fmtMetric.pct(i.grossMargin, 2)),
    metricCard("EBITDA margin",  fmtMetric.pct(i.ebitdaMargin, 2)),
    metricCard("Net income (TTM)", i.netIncome != null ? "$" + fmtMetric.bigDollar(i.netIncome) : null),
    metricCard("EPS (trailing)", fmtMetric.number(i.epsTrailing, 2)),
    metricCard("EPS (forward)",  fmtMetric.number(i.epsForward, 2))
  ].join(""));

  fillGrid("stock-balance", [
    metricCard("Total cash",   b.totalCash != null ? "$" + fmtMetric.bigDollar(b.totalCash) : null),
    metricCard("Total debt",   b.totalDebt != null ? "$" + fmtMetric.bigDollar(b.totalDebt) : null),
    metricCard("Net debt",     b.netDebt   != null ? "$" + fmtMetric.bigDollar(b.netDebt)   : null),
    metricCard("Debt / Equity", fmtMetric.number(b.debtToEquity, 2))
  ].join(""));

  fillGrid("stock-cashflow", [
    metricCard("Free cash flow (TTM)",   c.freeCashflow != null ? "$" + fmtMetric.bigDollar(c.freeCashflow) : null),
    metricCard("Operating cash flow",    c.operatingCashflow != null ? "$" + fmtMetric.bigDollar(c.operatingCashflow) : null),
    metricCard("Capital expenditure",    c.capex != null ? "$" + fmtMetric.bigDollar(c.capex) : null),
    metricCard("FCF yield",              fmtMetric.pct(c.fcfYield, 2))
  ].join(""));

  fillGrid("stock-returns", [
    metricCard("Return on Equity",      fmtMetric.pct(r.roe, 2)),
    metricCard("Return on Assets",      fmtMetric.pct(r.roa, 2)),
    metricCard("Return on Inv. Capital", fmtMetric.pct(r.roic, 2))
  ].join(""));
}

async function renderStockCharts(tickerData) {
  await waitForChart().catch(() => {});
  const hist = tickerData?.history;
  if (hist?.dates?.length && hist?.closes?.length) {
    makePriceVolumeChart("stock-price-chart", hist.dates, hist.closes, hist.volumes || []);
  } else {
    destroyChart("stock-price-chart");
  }

  const q = tickerData?.fundamentals?.quarterly;
  if (q?.dates?.length) {
    const labels = q.dates.map(d => d?.slice(0, 7) || "");
    makeBarChart("stock-revenue-chart", labels, [{
      label: "Revenue",
      data: q.revenue,
      backgroundColor: COLORS.accent + "cc",
      borderRadius: 4
    }]);
  } else {
    destroyChart("stock-revenue-chart");
  }

  const eps = tickerData?.fundamentals?.epsTrend;
  if (eps?.dates?.length) {
    const labels = eps.dates.map(d => d?.slice(0, 7) || "");
    makeBarChart("stock-eps-chart", labels, [
      { label: "Actual",   data: eps.epsActual,   backgroundColor: COLORS.green + "cc", borderRadius: 4 },
      { label: "Estimate", data: eps.epsEstimate, backgroundColor: COLORS.muted + "aa", borderRadius: 4 }
    ]);
  } else {
    destroyChart("stock-eps-chart");
  }
}

function renderStockNews(news) {
  const el = document.getElementById("stock-news");
  if (!el) return;
  if (!news?.length) {
    el.innerHTML = `<li class="metric-card-sub">No recent headlines available.</li>`;
    return;
  }
  el.innerHTML = news.map(n => {
    const date = n.publishedAt ? new Date(n.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    return `<li>
      <a href="${n.link}" target="_blank" rel="noopener noreferrer">${n.title}</a>
      <div class="news-meta">${n.publisher || ""}${date ? " · " + date : ""}</div>
    </li>`;
  }).join("");
}

function renderStockPeers(ticker, snapshot) {
  const peers = snapshot?.peerMap?.[ticker] || [];
  const tbody = document.querySelector("#stock-peers tbody");
  if (!tbody) return;

  // Include the loaded ticker as the first row so the user can compare directly
  const ownRow = snapshot?.tickers?.[ticker] ? {
    symbol: ticker,
    longName: snapshot.tickers[ticker].fundamentals?.profile?.longName,
    trailingPE: snapshot.tickers[ticker].fundamentals?.valuation?.trailingPE,
    evToEbitda: snapshot.tickers[ticker].fundamentals?.valuation?.evToEbitda,
    revenueGrowth: snapshot.tickers[ticker].fundamentals?.income?.revenueGrowthYoY,
    grossMargin: snapshot.tickers[ticker].fundamentals?.income?.grossMargin,
    roe: snapshot.tickers[ticker].fundamentals?.returns?.roe
  } : null;

  const rows = [ownRow, ...peers.map(p => snapshot?.peers?.[p])].filter(Boolean);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No peer data available.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(p => {
    const isCurrent = p.symbol === ticker;
    return `<tr${isCurrent ? ' style="background: rgba(93, 184, 245, 0.08)"' : ""}>
      <td class="ticker-cell">${p.symbol}${isCurrent ? " <span class='muted-inline'>(current)</span>" : ""}</td>
      <td>${p.longName || "--"}</td>
      <td${p.trailingPE == null ? ' class="empty"' : ""}>${fmtMetric.ratio(p.trailingPE) || "--"}</td>
      <td${p.evToEbitda == null ? ' class="empty"' : ""}>${fmtMetric.ratio(p.evToEbitda) || "--"}</td>
      <td${p.revenueGrowth == null ? ' class="empty"' : ""}>${fmtMetric.pct(p.revenueGrowth, 1) || "--"}</td>
      <td${p.grossMargin == null ? ' class="empty"' : ""}>${fmtMetric.pct(p.grossMargin, 1) || "--"}</td>
      <td${p.roe == null ? ' class="empty"' : ""}>${fmtMetric.pct(p.roe, 1) || "--"}</td>
    </tr>`;
  }).join("");
}

async function loadTicker(ticker, snapshot) {
  ticker = (ticker || "").toUpperCase().trim();
  if (!ticker) return;
  clearStockError();
  setStockLoading(true);
  currentTicker = ticker;

  // Try snapshot first (populated for popular tickers)
  let tickerData = snapshot?.tickers?.[ticker] || null;
  let workerPeers = null; // { peers: [...], peerSummaries: [...] }

  // Always try a live quote
  let liveQuote = null;
  try {
    liveQuote = await fetchYahooFinance(ticker);
  } catch (e) {
    console.warn(`Live quote failed for ${ticker}:`, e.message);
  }

  // For non-cached tickers, ask the Worker for fundamentals/news/peers in
  // parallel. If the Worker isn't configured, these calls throw and we fall
  // back to the chart-only path below.
  if (!tickerData?.fundamentals && WORKER_ENABLED) {
    const [fundRes, newsRes, peersRes] = await Promise.allSettled([
      workerFetch("/fundamentals", { symbol: ticker }),
      workerFetch("/news",         { symbol: ticker }),
      workerFetch("/peers",        { symbol: ticker })
    ]);
    tickerData = tickerData || { symbol: ticker };
    if (fundRes.status === "fulfilled") tickerData.fundamentals = fundRes.value;
    else                                console.warn(`Worker fundamentals ${ticker}:`, fundRes.reason?.message);
    if (newsRes.status === "fulfilled") tickerData.news = newsRes.value;
    else                                console.warn(`Worker news ${ticker}:`, newsRes.reason?.message);
    if (peersRes.status === "fulfilled") workerPeers = peersRes.value;
    else                                 console.warn(`Worker peers ${ticker}:`, peersRes.reason?.message);
  }

  // Live history (chart endpoint allows browser CORS — works for any ticker)
  if (!tickerData?.history) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const result = json.chart?.result?.[0];
        if (result) {
          const ts = result.timestamp || [];
          const closes = result.indicators?.quote?.[0]?.close || [];
          const volumes = result.indicators?.quote?.[0]?.volume || [];
          const dates = [], c = [], v = [];
          for (let i = 0; i < ts.length; i++) {
            if (closes[i] != null) {
              dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
              c.push(closes[i]);
              v.push(volumes[i] != null ? volumes[i] : null);
            }
          }
          tickerData = { ...(tickerData || {}), symbol: ticker, history: { dates, closes: c, volumes: v } };
        }
      }
    } catch (e) {
      console.warn(`Live history failed for ${ticker}:`, e.message);
    }
  }

  // Hard error: nothing usable
  if (!liveQuote && !tickerData?.history && !tickerData?.fundamentals) {
    setStockLoading(false);
    showStockError(`Could not find data for "${ticker}". Yahoo Finance returned no usable data — check the ticker spelling and try again.`);
    destroyChart("stock-price-chart");
    destroyChart("stock-revenue-chart");
    destroyChart("stock-eps-chart");
    return;
  }

  // Show panel
  const panel = document.getElementById("stock-panel");
  if (panel) panel.hidden = false;
  setStockLoading(false);

  // Header (uses fundamentals if cached, falls back to liveQuote)
  renderStockHeader(ticker, tickerData?.fundamentals, liveQuote);

  // Metric grids — only meaningful if we have cached fundamentals
  if (tickerData?.fundamentals) {
    renderStockMetrics(tickerData.fundamentals);
  } else {
    const reason = WORKER_ENABLED
      ? "Fundamentals could not be fetched for this ticker."
      : "Fundamentals are cached daily for the popular-tickers list. Deploy the Cloudflare Worker (worker/yahoo-proxy.js) to enable any ticker.";
    const placeholder = `<div class="metric-card"><span class="metric-card-label">Unavailable</span><span class="metric-card-value empty">--</span><span class="metric-card-sub">${reason}</span></div>`;
    fillGrid("stock-valuation", placeholder);
    fillGrid("stock-income",    placeholder);
    fillGrid("stock-balance",   placeholder);
    fillGrid("stock-cashflow",  placeholder);
    fillGrid("stock-returns",   placeholder);
  }

  // Charts
  await renderStockCharts(tickerData);

  // News
  renderStockNews(tickerData?.news);

  // Peers — three sources, in priority order:
  //   1. snapshot.peerMap (curated list for cached popular tickers)
  //   2. Worker /peers response (for arbitrary tickers, Yahoo's recommendations)
  //   3. Empty fallback message
  if (snapshot?.peerMap?.[ticker]) {
    renderStockPeers(ticker, snapshot);
  } else if (workerPeers?.peerSummaries?.length) {
    renderStockPeersFromWorker(ticker, tickerData?.fundamentals, workerPeers.peerSummaries);
  } else {
    const tbody = document.querySelector("#stock-peers tbody");
    if (tbody) {
      const msg = WORKER_ENABLED
        ? "No peer recommendations returned for this ticker."
        : "Peer data is curated for the popular-tickers list. Deploy the Cloudflare Worker to enable any ticker.";
      tbody.innerHTML = `<tr><td colspan="7" class="empty">${msg}</td></tr>`;
    }
  }
}

function renderStockPeersFromWorker(ticker, fundamentals, peerSummaries) {
  const tbody = document.querySelector("#stock-peers tbody");
  if (!tbody) return;

  const ownRow = fundamentals ? {
    symbol: ticker,
    longName:      fundamentals.profile?.longName,
    trailingPE:    fundamentals.valuation?.trailingPE,
    evToEbitda:    fundamentals.valuation?.evToEbitda,
    revenueGrowth: fundamentals.income?.revenueGrowthYoY,
    grossMargin:   fundamentals.income?.grossMargin,
    roe:           fundamentals.returns?.roe
  } : null;

  const rows = [ownRow, ...peerSummaries].filter(Boolean);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No peer data available.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(p => {
    const isCurrent = p.symbol === ticker;
    return `<tr${isCurrent ? ' style="background: rgba(93, 184, 245, 0.08)"' : ""}>
      <td class="ticker-cell">${p.symbol}${isCurrent ? " <span class='muted-inline'>(current)</span>" : ""}</td>
      <td>${p.longName || "--"}</td>
      <td${p.trailingPE == null ? ' class="empty"' : ""}>${fmtMetric.ratio(p.trailingPE) || "--"}</td>
      <td${p.evToEbitda == null ? ' class="empty"' : ""}>${fmtMetric.ratio(p.evToEbitda) || "--"}</td>
      <td${p.revenueGrowth == null ? ' class="empty"' : ""}>${fmtMetric.pct(p.revenueGrowth, 1) || "--"}</td>
      <td${p.grossMargin == null ? ' class="empty"' : ""}>${fmtMetric.pct(p.grossMargin, 1) || "--"}</td>
      <td${p.roe == null ? ' class="empty"' : ""}>${fmtMetric.pct(p.roe, 1) || "--"}</td>
    </tr>`;
  }).join("");
}

// ── Wiring ────────────────────────────────────────────────────────────────────

document.getElementById("refresh-data")?.addEventListener("click", refreshDashboard);
document.getElementById("dismiss-warning")?.addEventListener("click", () => {
  const el = document.getElementById("stale-warning");
  if (el) el.hidden = true;
});

document.getElementById("ticker-select")?.addEventListener("change", (e) => {
  const v = e.target.value;
  if (v) {
    document.getElementById("ticker-input").value = v;
    loadTicker(v, currentSnapshot);
  }
});

document.getElementById("stock-search-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = (document.getElementById("ticker-input")?.value || "").trim().toUpperCase();
  if (v) loadTicker(v, currentSnapshot);
});

// 5-minute auto-refresh interval (Feature: live-refresh)
const FIVE_MIN_MS = 5 * 60 * 1000;
setInterval(async () => {
  console.log("Auto-refresh tick");
  await refreshMarketOverviewQuotes();
  if (currentTicker) {
    // Re-render the header with a fresh live quote
    try {
      const liveQuote = await fetchYahooFinance(currentTicker);
      const tickerData = currentSnapshot?.tickers?.[currentTicker];
      renderStockHeader(currentTicker, tickerData?.fundamentals, liveQuote);
    } catch (e) {
      console.warn(`Auto-refresh ${currentTicker}:`, e.message);
    }
  }
  updateTimestamp("auto-refresh");
}, FIVE_MIN_MS);

// Auto-load on page open
(async function init() {
  await refreshDashboard();

  // Load the snapshot once for the new sections (refreshDashboard already loaded it but didn't return it)
  currentSnapshot = await tryLoadSnapshot();

  await renderMarketOverview(currentSnapshot);

  // Default ticker = first popular
  const select = document.getElementById("ticker-select");
  if (select) {
    select.value = "AAPL";
    document.getElementById("ticker-input").value = "AAPL";
    await loadTicker("AAPL", currentSnapshot);
  }

  // Refresh Market Overview live quotes once at start
  refreshMarketOverviewQuotes().catch(() => {});
})();
