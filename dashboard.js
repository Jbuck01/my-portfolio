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
