#!/usr/bin/env node
"use strict";

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");

// Fetch with redirect following
function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; jbuck-portfolio/1.0)",
        "Accept": "text/csv,text/plain,application/json,*/*"
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        fetchText(res.headers.location, redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error(`Timeout: ${url}`)); });
  });
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function parseFredCsv(csv) {
  const rows = csv
    .trim()
    .split("\n")
    .filter(r => r && !r.startsWith("DATE"))
    .map(r => { const [d, v] = r.split(","); return { date: d?.trim(), value: v?.trim() }; })
    .filter(r => r.value && r.value !== "." && r.date);
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const prev   = rows[rows.length - 2];
  return {
    value:    parseFloat(latest.value),
    date:     latest.date,
    prev:     prev ? parseFloat(prev.value) : null,
    prevDate: prev?.date ?? null
  };
}

async function fetchYahooFinance(symbol) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d`;
  const json = await fetchJson(url);
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo data for ${symbol}`);
  const meta = result.meta;
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result.timestamp ?? [];
  // Find last two valid closes
  const valid = [];
  for (let i = closes.length - 1; i >= 0 && valid.length < 2; i--) {
    if (closes[i] != null) {
      valid.push({ close: closes[i], ts: timestamps[i] });
    }
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

const fredSeries = {
  inflation:    "FPCPITOTLZGUSA",
  cpi:          "CPIAUCSL",
  coreCpi:      "CPILFESL",
  pce:          "PCEPI",
  housing:      "HOUST",
  mortgage30:   "MORTGAGE30US",
  mortgage15:   "MORTGAGE15US",
  caseShiller:  "CSUSHPISA",
  homeSales:    "EXHOSLUSM495S",
  medianHome:   "MSPUS",
  treasury10y:  "GS10",
  fedFunds:     "FEDFUNDS",
  unemployment: "UNRATE",
  umich:        "UMCSENT"
};

// Yahoo Finance symbols
const yahooSymbols = {
  sp500:       "^GSPC",
  dow:         "^DJI",
  nasdaq:      "^IXIC",
  russell2000: "^RUT",
  vix:         "^VIX",
  qqq:         "QQQ",
  xlc:         "XLC",
  botz:        "BOTZ"
};

async function main() {
  const snapshot = { updated: new Date().toISOString(), stocks: {}, fred: {}, fx: {} };

  console.log("Fetching stocks via Yahoo Finance...");
  for (const [key, symbol] of Object.entries(yahooSymbols)) {
    try {
      const data = await fetchYahooFinance(symbol);
      if (data?.value) {
        snapshot.stocks[key] = data;
        console.log(`  ${key}: ${data.value}`);
      } else {
        console.warn(`  ${key}: no data`);
      }
    } catch (e) {
      console.warn(`  ${key}: ${e.message}`);
    }
  }

  console.log("Fetching FRED series...");
  for (const [key, series] of Object.entries(fredSeries)) {
    try {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`;
      const csv = await fetchText(url);
      const data = parseFredCsv(csv);
      if (data?.value) {
        snapshot.fred[key] = { ...data, series };
        console.log(`  ${key}: ${data.value}`);
      } else {
        console.warn(`  ${key}: no data`);
      }
    } catch (e) {
      console.warn(`  ${key}: ${e.message}`);
    }
  }

  console.log("Fetching FX...");
  try {
    const data = await fetchJson("https://api.frankfurter.app/latest?from=EUR&to=USD");
    snapshot.fx.eurusd = { value: data.rates?.USD, date: data.date };
    console.log(`  eurusd: ${data.rates?.USD}`);
  } catch (e) {
    console.warn(`  eurusd: ${e.message}`);
  }

  const outPath = path.join(__dirname, "..", "data", "snapshot.json");
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSaved snapshot → ${outPath}`);
  console.log(`Stocks: ${Object.keys(snapshot.stocks).length}/${Object.keys(yahooSymbols).length}, FRED: ${Object.keys(snapshot.fred).length}/${Object.keys(fredSeries).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
