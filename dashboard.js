const fallbackData = {
  sp500: { value: "5,120", note: "Sample value shown until a market API is connected" },
  nasdaq: { value: "16,240", note: "Sample value shown until a market API is connected" },
  inflation: "3.2%",
  cpi: "312.23",
  housing: "1.38M",
  eurusd: { value: "1.08", note: "Sample fallback exchange rate" }
};

const fredSeries = {
  inflation: "FPCPITOTLZGUSA",
  cpi: "CPIAUCSL",
  housing: "HOUST"
};

const setText = (id, value) => {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
};

const formatNumber = (value, options = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat("en-US", options).format(numeric);
};

async function fetchFredSeries(seriesId) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`FRED request failed for ${seriesId}`);
  const csv = await response.text();
  const rows = csv.trim().split("\n").slice(1).reverse();
  const latest = rows.find((row) => {
    const value = row.split(",")[1];
    return value && value !== ".";
  });
  return latest?.split(",")[1];
}

async function fetchStooq(symbol) {
  const response = await fetch(`https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`);
  if (!response.ok) throw new Error(`Stock request failed for ${symbol}`);
  const csv = await response.text();
  const row = csv.trim().split("\n")[1]?.split(",");
  return row?.[6];
}

async function fetchExchangeRate() {
  const response = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD");
  if (!response.ok) throw new Error("Exchange rate request failed");
  const data = await response.json();
  return data.rates?.USD;
}

function applyFallback() {
  setText("sp500", fallbackData.sp500.value);
  setText("sp500-note", fallbackData.sp500.note);
  setText("nasdaq", fallbackData.nasdaq.value);
  setText("nasdaq-note", fallbackData.nasdaq.note);
  setText("inflation", fallbackData.inflation);
  setText("cpi", fallbackData.cpi);
  setText("housing", fallbackData.housing);
  setText("eurusd", fallbackData.eurusd.value);
  setText("fx-note", fallbackData.eurusd.note);
}

async function refreshDashboard() {
  applyFallback();

  try {
    const [sp500, nasdaq, inflation, cpi, housing, eurusd] = await Promise.all([
      fetchStooq("^spx"),
      fetchStooq("^ndq"),
      fetchFredSeries(fredSeries.inflation),
      fetchFredSeries(fredSeries.cpi),
      fetchFredSeries(fredSeries.housing),
      fetchExchangeRate()
    ]);

    if (sp500) {
      setText("sp500", formatNumber(sp500, { maximumFractionDigits: 2 }));
      setText("sp500-note", "Latest Stooq quote for S&P 500");
    }
    if (nasdaq) {
      setText("nasdaq", formatNumber(nasdaq, { maximumFractionDigits: 2 }));
      setText("nasdaq-note", "Latest Stooq quote for NASDAQ");
    }
    if (inflation) setText("inflation", `${formatNumber(inflation, { maximumFractionDigits: 1 })}%`);
    if (cpi) setText("cpi", formatNumber(cpi, { maximumFractionDigits: 2 }));
    if (housing) setText("housing", `${formatNumber(Number(housing) / 1000, { maximumFractionDigits: 2 })}M`);
    if (eurusd) {
      setText("eurusd", formatNumber(eurusd, { minimumFractionDigits: 4, maximumFractionDigits: 4 }));
      setText("fx-note", "Live EUR to USD rate");
    }
  } catch (error) {
    console.warn(error);
  } finally {
    setText("updated-at", `Last updated: ${new Date().toLocaleString()}`);
  }
}

document.getElementById("refresh-data")?.addEventListener("click", refreshDashboard);
refreshDashboard();
