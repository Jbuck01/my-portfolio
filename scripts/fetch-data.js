#!/usr/bin/env node
"use strict";

const fs    = require("fs");
const path  = require("path");

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// FRED's TLS stack resets the connection for Node's legacy https.get(), even
// with a browser User-Agent. Built-in fetch() (undici) negotiates TLS the same
// way curl does and works fine, so we use it for every request.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function httpRequest(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Timeout: ${url}`)), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/csv,text/plain,application/json,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(options.headers || {})
      },
      redirect: "follow",
      signal: ctrl.signal
    });
    const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const headers = Object.fromEntries(res.headers.entries());
    if (setCookie.length) headers["set-cookie"] = setCookie;
    const body = await res.text();
    return { status: res.status, headers, body };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options) {
  const res = await httpRequest(url, options);
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.body;
}

async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}

// Pause between Yahoo requests to avoid rate limiting
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── FRED ──────────────────────────────────────────────────────────────────────

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

// ── Yahoo Finance: chart/quote ────────────────────────────────────────────────

async function fetchYahooChart(symbol, { range = "5d", interval = "1d" } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const json = await fetchJson(url);
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo data for ${symbol}`);
  return result;
}

async function fetchYahooQuote(symbol) {
  const result = await fetchYahooChart(symbol, { range: "5d", interval: "1d" });
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
    value:              latest?.close ?? meta.regularMarketPrice,
    date:               toDate(latest?.ts),
    prev:               prev?.close ?? meta.chartPreviousClose ?? null,
    prevDate:           toDate(prev?.ts),
    fiftyTwoWeekHigh:   meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow:    meta.fiftyTwoWeekLow ?? null,
    currency:           meta.currency ?? null,
    exchange:           meta.exchangeName ?? null,
    symbol:             meta.symbol ?? symbol,
    longName:           meta.longName ?? null,
    shortName:          meta.shortName ?? null
  };
}

async function fetchYahooHistory(symbol, range = "1y") {
  const result = await fetchYahooChart(symbol, { range, interval: "1d" });
  const ts     = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const volumes= result.indicators?.quote?.[0]?.volume ?? [];
  const dates = [];
  const c = [];
  const v = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] != null) {
      dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
      c.push(Number(closes[i].toFixed(4)));
      v.push(volumes[i] != null ? volumes[i] : null);
    }
  }
  return { dates, closes: c, volumes: v };
}

// ── Yahoo Finance: crumb session for quoteSummary ─────────────────────────────

let yahooSession = null;

async function getYahooSession() {
  if (yahooSession) return yahooSession;
  // 1) Hit fc.yahoo.com to seed cookies
  let cookieJar = "";
  try {
    const res = await httpRequest("https://fc.yahoo.com/");
    const setCookies = res.headers["set-cookie"] || [];
    cookieJar = setCookies.map(c => c.split(";")[0]).join("; ");
  } catch (e) {
    console.warn(`  Yahoo cookie seed failed: ${e.message}`);
  }
  // 2) Get crumb
  let crumb = "";
  try {
    crumb = (await fetchText("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { Cookie: cookieJar }
    })).trim();
  } catch (e) {
    console.warn(`  Yahoo crumb fetch failed: ${e.message}`);
  }
  yahooSession = { cookie: cookieJar, crumb };
  return yahooSession;
}

const QUOTE_SUMMARY_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
  "incomeStatementHistoryQuarterly",
  "earningsHistory",
  "calendarEvents"
].join(",");

async function fetchYahooQuoteSummary(symbol) {
  const { cookie, crumb } = await getYahooSession();
  const crumbParam = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${QUOTE_SUMMARY_MODULES}${crumbParam}`;
  const res = await httpRequest(url, { headers: { Cookie: cookie } });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for quoteSummary ${symbol}`);
  const json = JSON.parse(res.body);
  const result = json.quoteSummary?.result?.[0];
  if (!result) {
    const err = json.quoteSummary?.error?.description || "no result";
    throw new Error(`quoteSummary ${symbol}: ${err}`);
  }
  return result;
}

const raw = obj => obj?.raw ?? null;

function pickFundamentals(qs) {
  const sd = qs.summaryDetail        || {};
  const ks = qs.defaultKeyStatistics || {};
  const fd = qs.financialData        || {};
  const ap = qs.assetProfile         || {};
  const eh = qs.earningsHistory      || {};
  const is = qs.incomeStatementHistoryQuarterly || {};
  const ce = qs.calendarEvents       || {};
  const pr = qs.price                || {};

  // Quarterly income: last 4 quarters, sorted oldest → newest
  const quarters = (is.incomeStatementHistory || [])
    .filter(q => q.endDate?.fmt)
    .sort((a, b) => a.endDate.fmt.localeCompare(b.endDate.fmt))
    .slice(-4);
  const quarterly = {
    dates:    quarters.map(q => q.endDate?.fmt   ?? null),
    revenue:  quarters.map(q => raw(q.totalRevenue)),
    netIncome:quarters.map(q => raw(q.netIncome)),
    grossProfit: quarters.map(q => raw(q.grossProfit))
  };

  // Quarterly EPS: last 4 quarters, sorted oldest → newest
  const epsQuarters = (eh.history || [])
    .filter(q => q.quarter?.fmt)
    .sort((a, b) => a.quarter.fmt.localeCompare(b.quarter.fmt))
    .slice(-4);
  const epsTrend = {
    dates:        epsQuarters.map(q => q.quarter?.fmt ?? null),
    epsActual:    epsQuarters.map(q => raw(q.epsActual)),
    epsEstimate:  epsQuarters.map(q => raw(q.epsEstimate))
  };

  const price     = raw(fd.currentPrice) ?? raw(pr.regularMarketPrice);
  const marketCap = raw(pr.marketCap)    ?? raw(sd.marketCap);
  const totalDebt = raw(fd.totalDebt);
  const totalCash = raw(fd.totalCash);
  const netDebt   = (totalDebt != null && totalCash != null) ? (totalDebt - totalCash) : null;
  const fcf       = raw(fd.freeCashflow);
  const fcfYield  = (fcf != null && marketCap) ? (fcf / marketCap) : null;
  // CapEx would require cashflowStatementHistory module; left null for now
  const capex     = null;

  return {
    profile: {
      longName:   pr.longName  ?? null,
      shortName:  pr.shortName ?? null,
      symbol:     pr.symbol    ?? null,
      exchange:   pr.exchangeName ?? null,
      currency:   pr.currency  ?? null,
      sector:     ap.sector    ?? null,
      industry:   ap.industry  ?? null
    },
    quote: {
      price,
      marketCap,
      fiftyTwoWeekHigh: raw(sd.fiftyTwoWeekHigh),
      fiftyTwoWeekLow:  raw(sd.fiftyTwoWeekLow)
    },
    valuation: {
      trailingPE:      raw(sd.trailingPE)       ?? raw(ks.trailingPE),
      forwardPE:       raw(sd.forwardPE)        ?? raw(ks.forwardPE),
      evToEbitda:      raw(ks.enterpriseToEbitda),
      priceToSales:    raw(sd.priceToSalesTrailing12Months) ?? raw(ks.priceToSalesTrailing12Months),
      priceToBook:     raw(ks.priceToBook),
      pegRatio:        raw(ks.pegRatio)
    },
    income: {
      revenueTTM:      raw(fd.totalRevenue),
      revenueGrowthYoY:raw(fd.revenueGrowth),
      grossMargin:     raw(fd.grossMargins),
      ebitdaMargin:    raw(fd.ebitdaMargins),
      profitMargin:    raw(fd.profitMargins),
      netIncome:       raw(fd.netIncomeToCommon),
      epsTrailing:     raw(ks.trailingEps),
      epsForward:      raw(ks.forwardEps)
    },
    balance: {
      totalCash,
      totalDebt,
      netDebt,
      debtToEquity: raw(fd.debtToEquity)
    },
    cashflow: {
      freeCashflow: fcf,
      capex,
      operatingCashflow: raw(fd.operatingCashflow),
      fcfYield
    },
    returns: {
      roe: raw(fd.returnOnEquity),
      roa: raw(fd.returnOnAssets),
      roic: null
    },
    analyst: {
      recommendationKey:  fd.recommendationKey ?? null,
      recommendationMean: raw(fd.recommendationMean),
      targetMean:         raw(fd.targetMeanPrice),
      targetHigh:         raw(fd.targetHighPrice),
      targetLow:          raw(fd.targetLowPrice),
      numberOfAnalysts:   raw(fd.numberOfAnalystOpinions)
    },
    quarterly,
    epsTrend,
    nextEarnings: ce.earnings?.earningsDate?.[0]?.fmt ?? null
  };
}

// ── Yahoo Finance: news ───────────────────────────────────────────────────────

async function fetchYahooNews(symbol, limit = 6) {
  const { cookie, crumb } = await getYahooSession();
  const crumbParam = crumb ? `&crumb=${encodeURIComponent(crumb)}` : "";
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=${limit}&quotesCount=0&enableFuzzyQuery=false${crumbParam}`;
  const res = await httpRequest(url, { headers: { Cookie: cookie } });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for news ${symbol}`);
  const json = JSON.parse(res.body);
  const items = json.news || [];
  return items.slice(0, limit).map(n => ({
    title:      n.title,
    publisher:  n.publisher,
    link:       n.link,
    publishedAt:n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null
  }));
}

// ── Symbol sets ───────────────────────────────────────────────────────────────

// Existing snapshot keys — kept for back-compat with the dashboard cards
const yahooSymbols = {
  sp500:       "^GSPC",
  dow:         "^DJI",
  nasdaq:      "^IXIC",
  nasdaq100:   "^NDX",
  russell2000: "^RUT",
  vix:         "^VIX",
  qqq:         "QQQ",
  xlc:         "XLC",
  botz:        "BOTZ"
};

// Market Overview (Feature 1) — 5 indices to show with 1-year line charts
// Note: ^IXIC (Composite) is in the existing card grid; ^NDX (NASDAQ-100) is the new spec
const INDEX_HISTORY_SYMBOLS = ["^GSPC", "^NDX", "^DJI", "^RUT", "^VIX"];

// Stock Research Panel (Feature 2) — popular tickers
const POPULAR_TICKERS = [
  "AAPL","MSFT","GOOGL","AMZN","NVDA",
  "TSLA","META","JPM","V","BRK-B"
];

// Comparable Companies (Feature 3) — curated sector peers per popular ticker
const PEER_MAP = {
  AAPL:    ["MSFT","GOOGL","AMZN","META","NVDA"],
  MSFT:    ["AAPL","GOOGL","AMZN","META","ORCL"],
  GOOGL:   ["MSFT","AAPL","META","AMZN","NFLX"],
  AMZN:    ["AAPL","MSFT","GOOGL","WMT","COST"],
  NVDA:    ["AMD","INTC","AVGO","TSM","QCOM"],
  TSLA:    ["GM","F","TM","RIVN","LCID"],
  META:    ["GOOGL","SNAP","PINS","NFLX","DIS"],
  JPM:     ["BAC","WFC","C","GS","MS"],
  V:       ["MA","AXP","PYPL","COF","FIS"],
  "BRK-B": ["JPM","BAC","WFC","V","MA"]
};

// ── Per-ticker fetch ──────────────────────────────────────────────────────────

async function fetchTickerData(symbol) {
  const out = { symbol };
  // Always try chart-based history (no crumb needed) first
  try {
    out.history = await fetchYahooHistory(symbol, "1y");
  } catch (e) {
    console.warn(`  ${symbol} history: ${e.message}`);
  }
  await sleep(250);

  // quoteSummary fundamentals (with crumb)
  try {
    const qs = await fetchYahooQuoteSummary(symbol);
    out.fundamentals = pickFundamentals(qs);
  } catch (e) {
    console.warn(`  ${symbol} fundamentals: ${e.message}`);
  }
  await sleep(250);

  // News
  try {
    out.news = await fetchYahooNews(symbol, 6);
  } catch (e) {
    console.warn(`  ${symbol} news: ${e.message}`);
  }
  await sleep(250);

  return out;
}

async function fetchPeerSummary(symbol) {
  // Lightweight: just fundamentals subset for the peer comparison table
  try {
    const qs = await fetchYahooQuoteSummary(symbol);
    const f = pickFundamentals(qs);
    return {
      symbol,
      longName:        f.profile.longName,
      trailingPE:      f.valuation.trailingPE,
      evToEbitda:      f.valuation.evToEbitda,
      revenueGrowth:   f.income.revenueGrowthYoY,
      grossMargin:     f.income.grossMargin,
      roe:             f.returns.roe,
      price:           f.quote.price
    };
  } catch (e) {
    console.warn(`  peer ${symbol}: ${e.message}`);
    return { symbol, error: e.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const snapshot = {
    updated: new Date().toISOString(),
    stocks: {},
    fred: {},
    fx: {},
    indexHistory: {},
    tickers: {},
    peers: {}
  };

  console.log("Fetching stocks via Yahoo Finance...");
  for (const [key, symbol] of Object.entries(yahooSymbols)) {
    try {
      const data = await fetchYahooQuote(symbol);
      if (data?.value) {
        snapshot.stocks[key] = {
          value:    data.value,
          date:     data.date,
          prev:     data.prev,
          prevDate: data.prevDate
        };
        console.log(`  ${key}: ${data.value}`);
      } else {
        console.warn(`  ${key}: no data`);
      }
    } catch (e) {
      console.warn(`  ${key}: ${e.message}`);
    }
    await sleep(150);
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

  console.log("Fetching 1-year index history (Market Overview)...");
  for (const sym of INDEX_HISTORY_SYMBOLS) {
    try {
      const hist = await fetchYahooHistory(sym, "1y");
      snapshot.indexHistory[sym] = hist;
      console.log(`  ${sym}: ${hist.dates.length} points`);
    } catch (e) {
      console.warn(`  ${sym} history: ${e.message}`);
    }
    await sleep(200);
  }

  // Warm Yahoo session once before per-ticker work
  await getYahooSession().catch(() => {});

  console.log("Fetching popular ticker fundamentals + history + news...");
  for (const sym of POPULAR_TICKERS) {
    console.log(`  ${sym}...`);
    snapshot.tickers[sym] = await fetchTickerData(sym);
  }

  console.log("Fetching peer summaries...");
  const peerSymbols = Array.from(new Set(Object.values(PEER_MAP).flat()));
  for (const sym of peerSymbols) {
    snapshot.peers[sym] = await fetchPeerSummary(sym);
    await sleep(200);
  }
  // Stash the mapping itself so the dashboard knows which peers belong to which ticker
  snapshot.peerMap = PEER_MAP;

  const outPath = path.join(__dirname, "..", "data", "snapshot.json");
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSaved snapshot → ${outPath}`);
  console.log(
    `Stocks: ${Object.keys(snapshot.stocks).length}/${Object.keys(yahooSymbols).length}, ` +
    `FRED: ${Object.keys(snapshot.fred).length}/${Object.keys(fredSeries).length}, ` +
    `Indices history: ${Object.keys(snapshot.indexHistory).length}/${INDEX_HISTORY_SYMBOLS.length}, ` +
    `Tickers: ${Object.keys(snapshot.tickers).length}/${POPULAR_TICKERS.length}, ` +
    `Peers: ${Object.keys(snapshot.peers).length}/${peerSymbols.length}`
  );
}

main().catch(e => { console.error(e); process.exit(1); });
