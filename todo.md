# Portfolio Website To-Do

**1. Design & Professionalism**

- [x] **Standardize navigation and footer across all pages**
  Brief description: Consistent page framing makes the site feel intentional and prevents brand, link, and footer text from drifting between pages.

- [x] **Audit layout, typography, spacing, and color palette**
  Brief description: A visual audit will catch inconsistent font sizes, uneven spacing, and color choices that weaken the professional presentation.

- [x] **Update the visual theme to black and grey backgrounds with light blue accents**
  Brief description: A focused dark neutral palette with light blue accents will create a cleaner, more modern visual identity across the portfolio and dashboard pages.

- [x] **Make the site fully responsive for mobile and tablet**
  Brief description: The portfolio should remain readable and easy to navigate on smaller screens used by recruiters, classmates, and professional contacts.

- [x] **Add favicon and proper page title/meta tags**
  Brief description: Browser tabs, search previews, and shared links should identify the site clearly and professionally.

- [x] **Add an About/Bio section with a professional headshot placeholder**
  Brief description: A concise bio gives visitors context before they review projects, resume details, or financial dashboards.

- [x] **Add smooth scroll behavior and subtle animations**
  Brief description: Small interaction polish can make the site feel more refined when used carefully and without distracting from the content.

**2. Content & Information Accuracy**

- [x] **Ensure the CV page matches Resume 2026.docx exactly and flag unclear items**
  Brief description: The resume page should stay faithful to the source file, and any incomplete, ambiguous, or oddly formatted resume items should be reviewed before publishing.

- [x] **Review all text for grammar, spelling, and clarity**
  Brief description: Clean writing improves credibility and prevents avoidable errors from distracting from the portfolio.

- [x] **Add clearly visible contact information or a contact form**
  Brief description: Visitors need an obvious way to follow up after reviewing the resume, projects, or dashboard work.

- [x] **Add real project descriptions, links, and tech stack tags**
  Brief description: Concrete project details make the work verifiable and help visitors understand scope, tools, and outcomes.

**3. Startup Financial Dashboard: AI, Tech & Communications Sector**

- [x] **Add data source labels and last-updated timestamps for every sector metric**
  Brief description: Dashboard users need to know where each value came from and whether it is current enough to trust.

- [x] **Track sector ETF performance for QQQ, XLC, BOTZ, and related benchmarks**
  Brief description: ETF performance gives a fast read on AI, technology, and communications market sentiment.

- [x] **Display AI and technology funding trends using public sources**
  Brief description: Use SEC Form D filings, NVCA reports, company press releases, and manually curated monthly funding data to show private-market appetite from public information.

- [x] **Display SaaS and AI valuation multiple benchmarks from public-company data**
  Brief description: Calculate P/S ratio benchmarks from public filings, company revenue disclosures, and free delayed market data to contextualize startup valuation pressure.

- [x] **Display IPO pipeline and recent technology IPOs from public filings and calendars**
  Brief description: Use SEC S-1 filings, Nasdaq IPO Calendar pages, and exchange press releases to indicate exit-market health and investor demand for growth companies.

- [x] **Display AI compute cost trends from public cloud and retail GPU pricing**
  Brief description: Track AWS, Azure, Google Cloud GPU instance prices and manually sampled retail GPU prices because compute costs affect AI startup margins and infrastructure strategy.

**4. Broad Market & Economic Tracker**

- [x] **Add data source labels and last-updated timestamps for every broad-market metric**
  Brief description: Every economic and market value should be traceable to a source and timestamped for credibility.

- [x] **Show last reading, previous reading, and directional change for all metrics**
  Brief description: Up/down indicators make the dashboard easier to scan and reveal trend direction without requiring manual comparison.

- [x] **Track broad market indices: S&P 500, Dow Jones, Nasdaq Composite, Russell 2000, and VIX**
  Brief description: These indices provide a broad snapshot of equity-market performance, breadth, and volatility.

- [x] **Add inflation data from FRED: headline CPI, core CPI, PCE, year-over-year change, and month-over-month change**
  Brief description: Inflation readings are central to rate expectations, purchasing power, and market valuation context.

- [x] **Add housing data from FRED: 30-year mortgage rate, 15-year mortgage rate, Case-Shiller Home Price Index, housing starts, existing home sales, and median home price**
  Brief description: Housing indicators show affordability, construction demand, and consumer balance-sheet pressure.

- [x] **Add 10-year Treasury yield, federal funds rate, unemployment rate, and University of Michigan consumer sentiment**
  Brief description: These indicators round out the macro view across rates, labor, and household confidence.

**5. Technical & Infrastructure**

- [x] **Add error handling and stale data warnings to the dashboard**
  Brief description: Users should see when a data source fails or when a displayed value may no longer be current.

- [x] **Add a visible last-updated timestamp on every financial page**
  Brief description: A persistent timestamp helps visitors quickly judge whether the dashboard has refreshed recently.

- [x] **Set up a GitHub Actions workflow for daily financial data refresh**
  Brief description: Scheduled refreshes reduce manual maintenance and keep the dashboard current after deployment.

- [x] **Prioritize public no-key data sources and store optional free-tier keys as GitHub Secrets**
  Brief description: The dashboard should use public no-key sources where possible, while any optional free-tier credentials should stay out of the repository and client-side code.

- [x] **Test the site on Chrome, Firefox, and Safari**
  Brief description: Browser testing catches layout, JavaScript, and rendering differences before the site is shared publicly.

## Free Data Source Plan

- [x] **AI and technology funding trends**
  Brief description: Use SEC Form D filings, NVCA reports, company press releases, and manually curated monthly funding totals.

- [x] **SaaS and AI valuation multiple benchmarks**
  Brief description: Calculate public-company P/S ratios from SEC filings, company investor relations pages, and free delayed market prices.

- [x] **IPO pipeline and recent technology IPO data**
  Brief description: Use Nasdaq IPO Calendar pages, SEC S-1 filings, exchange press releases, and manually maintained recent IPO entries.

- [x] **GPU pricing index and AI compute cost trends**
  Brief description: Track public GPU instance prices from AWS, Azure, Google Cloud, spot-price pages, and manually sampled retail GPU prices.

- [x] **Stock, ETF, and index prices**
  Brief description: Use delayed quotes from Yahoo Finance (query1.finance.yahoo.com/v8/finance/chart) — no API key required for browser and server-side fetches.

## Discovered During Review

- [x] **Fix education order in resume.html to match Resume 2026.docx**
  Brief description: The .docx lists Bachelor's degree (May 2025) before Master's degree (May 2026); the original HTML had them reversed.

- [x] **Fix misleading "Core CPI (YoY)" label — CPILFESL is the raw index, not a YoY rate**
  Brief description: CPILFESL tracks the all-items-less-food-and-energy CPI index level, not the annual rate. Label corrected to "Core CPI Level" to avoid misrepresenting the data.

- [x] **Replace Stooq historical endpoint with Yahoo Finance for server-side fetch script**
  Brief description: Stooq's historical CSV endpoint (stooq.com/q/d/l/) requires an API key for server-side requests. Updated scripts/fetch-data.js to use Yahoo Finance's no-key /v8/finance/chart endpoint, which works from GitHub Actions.

- [x] **Seed snapshot.json with real stock data so dashboard loads values immediately**
  Brief description: Ran scripts/fetch-data.js locally to populate data/snapshot.json with current Yahoo Finance prices for all 8 symbols (S&P 500, Dow, Nasdaq, Russell 2000, VIX, QQQ, XLC, BOTZ) and EUR/USD. FRED data populates automatically on first GitHub Actions run.
