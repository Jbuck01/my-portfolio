/**
 * yahoo-proxy.js — Cloudflare Worker
 *
 * Proxies Yahoo Finance's quoteSummary / search / chart / recommendations
 * endpoints with CORS headers, so the static dashboard can fetch arbitrary
 * tickers (not just the 10 cached in snapshot.json) directly from the browser.
 *
 * Endpoints:
 *   GET /fundamentals?symbol=AAPL  → cleaned fundamentals object
 *   GET /history?symbol=AAPL&range=1y → { dates, closes, volumes }
 *   GET /news?symbol=AAPL          → [{ title, publisher, link, publishedAt }]
 *   GET /peers?symbol=AAPL         → { peerSummaries: [...], peers: [SYM, SYM, ...] }
 *
 * Deploy steps (Cloudflare dashboard, no CLI needed):
 *   1. Sign in at https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. Name it (e.g. "yahoo-proxy"), click "Deploy", then "Edit code"
 *   3. Replace the default file contents with this entire file → Save and Deploy
 *   4. Copy the *.workers.dev URL from the Worker's overview page
 *   5. Paste it into dashboard.js: const WORKER_URL = "https://...workers.dev"
 *
 * Optional: tighten ALLOWED_ORIGIN below to your GitHub Pages domain
 * (e.g. "https://yourname.github.io") instead of "*" once it's working.
 */

const UA = "Mozilla/5.0 (compatible; jbuck-portfolio-proxy/1.0)";
const ALLOWED_ORIGIN = "*";
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

// Module-scoped session cache. Cloudflare may rotate isolates; on cache miss
// we transparently re-bootstrap a session.
let cachedSession = null;

async function getSession() {
  if (cachedSession && Date.now() < cachedSession.expires) return cachedSession;
  const cookieRes = await fetch("https://fc.yahoo.com/", {
    redirect: "manual",
    headers: { "User-Agent": UA }
  });
  const setCookies = typeof cookieRes.headers.getSetCookie === "function"
    ? cookieRes.headers.getSetCookie()
    : [cookieRes.headers.get("Set-Cookie")].filter(Boolean);
  const cookieJar = setCookies.map(c => c.split(";")[0]).join("; ");
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "Cookie": cookieJar, "User-Agent": UA }
  });
  const crumb = (await crumbRes.text()).trim();
  cachedSession = { cookie: cookieJar, crumb, expires: Date.now() + 30 * 60 * 1000 };
  return cachedSession;
}

async function yahoo(url, attempt = 0) {
  const s = await getSession();
  const sep = url.includes("?") ? "&" : "?";
  const finalUrl = url + sep + "crumb=" + encodeURIComponent(s.crumb);
  const res = await fetch(finalUrl, {
    headers: { "Cookie": s.cookie, "User-Agent": UA }
  });
  if ((res.status === 401 || res.status === 403) && attempt === 0) {
    cachedSession = null;
    return yahoo(url, 1);
  }
  return res;
}

const raw = obj => obj?.raw ?? null;

function pickFundamentals(qs) {
  const sd = qs.summaryDetail        || {};
  const ks = qs.defaultKeyStatistics || {};
  const fd = qs.financialData        || {};
  const ap = qs.assetProfile         || {};
  const is = qs.incomeStatementHistoryQuarterly || {};
  const eh = qs.earningsHistory      || {};
  const ce = qs.calendarEvents       || {};
  const pr = qs.price                || {};

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
      trailingPE:   raw(sd.trailingPE)       ?? raw(ks.trailingPE),
      forwardPE:    raw(sd.forwardPE)        ?? raw(ks.forwardPE),
      evToEbitda:   raw(ks.enterpriseToEbitda),
      priceToSales: raw(sd.priceToSalesTrailing12Months) ?? raw(ks.priceToSalesTrailing12Months),
      priceToBook:  raw(ks.priceToBook),
      pegRatio:     raw(ks.pegRatio)
    },
    income: {
      revenueTTM:       raw(fd.totalRevenue),
      revenueGrowthYoY: raw(fd.revenueGrowth),
      grossMargin:      raw(fd.grossMargins),
      ebitdaMargin:     raw(fd.ebitdaMargins),
      profitMargin:     raw(fd.profitMargins),
      netIncome:        raw(fd.netIncomeToCommon),
      epsTrailing:      raw(ks.trailingEps),
      epsForward:       raw(ks.forwardEps)
    },
    balance: {
      totalCash,
      totalDebt,
      netDebt,
      debtToEquity: raw(fd.debtToEquity)
    },
    cashflow: {
      freeCashflow: fcf,
      capex:        null,
      operatingCashflow: raw(fd.operatingCashflow),
      fcfYield
    },
    returns: {
      roe:  raw(fd.returnOnEquity),
      roa:  raw(fd.returnOnAssets),
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

function peerSummary(symbol, qs) {
  const f = pickFundamentals(qs);
  return {
    symbol,
    longName:      f.profile.longName,
    trailingPE:    f.valuation.trailingPE,
    evToEbitda:    f.valuation.evToEbitda,
    revenueGrowth: f.income.revenueGrowthYoY,
    grossMargin:   f.income.grossMargin,
    roe:           f.returns.roe,
    price:         f.quote.price
  };
}

// ── Endpoint handlers ────────────────────────────────────────────────────────

async function handleFundamentals(symbol) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${QUOTE_SUMMARY_MODULES}`;
  const res = await yahoo(url);
  if (!res.ok) return jsonError(`Yahoo returned ${res.status} for ${symbol}`, res.status);
  const json = await res.json();
  const result = json.quoteSummary?.result?.[0];
  if (!result) {
    const desc = json.quoteSummary?.error?.description || "no result";
    return jsonError(`fundamentals for ${symbol}: ${desc}`, 404);
  }
  return jsonResponse(pickFundamentals(result));
}

async function handleHistory(symbol, range) {
  if (!/^(1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|max)$/.test(range)) {
    return jsonError("invalid range", 400);
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return jsonError(`Yahoo returned ${res.status} for ${symbol}`, res.status);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) return jsonError(`history for ${symbol}: no result`, 404);
  const ts = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const volumes = result.indicators?.quote?.[0]?.volume ?? [];
  const dates = [], c = [], v = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] != null) {
      dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
      c.push(Number(closes[i].toFixed(4)));
      v.push(volumes[i] != null ? volumes[i] : null);
    }
  }
  return jsonResponse({ dates, closes: c, volumes: v });
}

async function handleNews(symbol) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=6&quotesCount=0&enableFuzzyQuery=false`;
  const res = await yahoo(url);
  if (!res.ok) return jsonError(`Yahoo returned ${res.status} for news ${symbol}`, res.status);
  const json = await res.json();
  const items = (json.news || []).slice(0, 6).map(n => ({
    title:       n.title,
    publisher:   n.publisher,
    link:        n.link,
    publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null
  }));
  return jsonResponse(items);
}

async function handlePeers(symbol) {
  // 1) Get recommended peers from Yahoo
  const recRes = await fetch(
    `https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`,
    { headers: { "User-Agent": UA } }
  );
  if (!recRes.ok) return jsonError(`recommendations failed (${recRes.status})`, recRes.status);
  const recJson = await recRes.json();
  const recommended = recJson.finance?.result?.[0]?.recommendedSymbols || [];
  const peers = recommended.slice(0, 5).map(r => r.symbol).filter(Boolean);
  if (!peers.length) return jsonResponse({ peers: [], peerSummaries: [] });

  // 2) Fetch a fundamentals summary for each peer in parallel
  const summaries = await Promise.all(peers.map(async (sym) => {
    try {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${QUOTE_SUMMARY_MODULES}`;
      const res = await yahoo(url);
      if (!res.ok) return { symbol: sym, error: `HTTP ${res.status}` };
      const json = await res.json();
      const result = json.quoteSummary?.result?.[0];
      if (!result) return { symbol: sym, error: "no result" };
      return peerSummary(sym, result);
    } catch (e) {
      return { symbol: sym, error: e.message };
    }
  }));

  return jsonResponse({ peers, peerSummaries: summaries });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "86400"
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type":  "application/json",
      "Cache-Control": "public, max-age=300", // 5 min
      ...corsHeaders()
    }
  });
}

function jsonError(message, status = 502) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

// ── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return jsonError("method not allowed", 405);
    }

    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) {
      return jsonError("missing or invalid 'symbol' parameter", 400);
    }

    try {
      switch (url.pathname) {
        case "/":             return jsonResponse({ ok: true, endpoints: ["/fundamentals", "/history", "/news", "/peers"] });
        case "/fundamentals": return await handleFundamentals(symbol);
        case "/history":      return await handleHistory(symbol, url.searchParams.get("range") || "1y");
        case "/news":         return await handleNews(symbol);
        case "/peers":        return await handlePeers(symbol);
        default:              return jsonError(`unknown path: ${url.pathname}`, 404);
      }
    } catch (e) {
      return jsonError(e.message || "internal error", 502);
    }
  }
};
