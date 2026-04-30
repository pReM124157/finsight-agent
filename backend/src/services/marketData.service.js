import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

const indianStocks = [
  "TCS",
  "INFY",
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "ITC",
  "LT",
  "ASIANPAINT",
  "SUNPHARMA",
  "WIPRO",
  "HCLTECH",
  "TECHM",
  "TATAMOTORS",
  "BAJFINANCE"
];

export async function getCompanyOverview(symbol) {
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");

    const symbolsToTry = upperSymbol.includes(".")
      ? [upperSymbol]
      : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];

    let result = null;
    let fetchSymbol = "";

    for (const sym of symbolsToTry) {
        try {
            console.log(`FETCH ATTEMPT (Overview): ${sym}`);
            const tempResult = await yahooFinance.quoteSummary(sym, {
                modules: ["financialData", "defaultKeyStatistics", "assetProfile", "summaryDetail", "calendarEvents"]
            });
            if (tempResult && tempResult.assetProfile) {
                result = tempResult;
                fetchSymbol = sym;
                break;
            }
        } catch (e) {
            console.warn(`[FAIL] quoteSummary for ${sym}: ${e.message}`);
        }
    }

    if (!result) {
        throw new Error(`Failed to fetch data for ${upperSymbol} after trying: ${symbolsToTry.join(", ")}`);
    }

    console.log("FETCH SUCCESS (Overview):", fetchSymbol);

    console.log("RAW YAHOO SUMMARY RESULT:", JSON.stringify(result).substring(0, 500));

    const {
      financialData = {},
      defaultKeyStatistics = {},
      assetProfile = {},
      summaryDetail = {},
      calendarEvents = {}
    } = result;

    const companyOverview = {
      Symbol: fetchSymbol,
      Name: assetProfile.longName || fetchSymbol,
      
      MarketCapitalization: summaryDetail.marketCap ?? null,
      PERatio: summaryDetail.trailingPE ?? null,
      ProfitMargin: financialData.profitMargins ?? null,
      ReturnOnEquityTTM: financialData.returnOnEquity ?? null,
      DebtToEquityRatio: financialData.debtToEquity ?? null,
      QuarterlyEarningsGrowthYOY: financialData.earningsGrowth ?? null,
      QuarterlyRevenueGrowthYOY: financialData.revenueGrowth ?? null,
      PriceToBookRatio: defaultKeyStatistics.priceToBook ?? null,
      Beta: defaultKeyStatistics.beta ?? null,
      Sector: assetProfile.sector ?? null,
      Industry: assetProfile.industry ?? null,
      BusinessSummary: assetProfile.longBusinessSummary ?? null,
      EarningsDate: calendarEvents?.earnings?.earningsDate?.[0] ?? null
    };

    console.log("FINAL OVERVIEW:", companyOverview);
    console.log("DEBUG OVERVIEW FIELDS:", {
        Symbol: companyOverview.Symbol,
        PERatio: companyOverview.PERatio,
        ROE: companyOverview.ReturnOnEquityTTM,
        RevenueGrowth: companyOverview.QuarterlyRevenueGrowthYOY,
        EarningsGrowth: companyOverview.QuarterlyEarningsGrowthYOY,
        Sector: companyOverview.Sector
    });

    return companyOverview;

  } catch (error) {
    console.error("--- YAHOO OVERVIEW FAILURE ---");
    console.error(`SYMBOL: ${symbol}`);
    console.error(`ERROR: ${error.message}`);
    console.error(`STACK: ${error.stack}`);
    
    // Return at least the symbol to prevent downstream "UNKNOWN" errors
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    return {
      Symbol: upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`
    };
  }
}

const priceCache = new Map();

function getHolidays(year) {
    // NSE/BSE Holiday List Placeholder
    // In production, this can be fetched from an API or a JSON config
    const holidayMap = {
        2026: [
            "01-26", // Republic Day
            "03-13", // Holi
            "04-01", // Annual Bank Closing
            "04-02", // Good Friday
            "05-01", // Maharashtra Day
            "08-15", // Independence Day
            "10-02", // Gandhi Jayanti
            "10-23", // Dussehra
            "11-12", // Diwali
            "12-25"  // Christmas
        ],
        2027: [
            "01-26", "08-15", "10-02", "12-25" // Minimal 2027 placeholders
        ]
    };
    return holidayMap[year] || [];
}

function checkIsMarketOpen() {
    const now = new Date();
    // IST is UTC+5.5
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    
    const day = istDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
    const hours = istDate.getUTCHours();
    const minutes = istDate.getUTCMinutes();
    
    const year = istDate.getUTCFullYear();
    const month = (istDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const date = istDate.getUTCDate().toString().padStart(2, '0');
    const dayMonth = `${month}-${date}`;
    
    const holidays = getHolidays(year);

    if (day === 0 || day === 6 || holidays.includes(dayMonth)) {
        return false;
    }
    
    // Market open: Mon-Fri, 9:15 AM to 3:30 PM IST
    const timeInMinutes = hours * 60 + minutes;
    const isOpenTime = timeInMinutes >= (9 * 60 + 15) && timeInMinutes <= (15 * 60 + 30);
    
    return isOpenTime;
}

async function retry(fn, retries = 3, initialDelay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            const delay = initialDelay * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

export async function getLiveMarketData(symbol) {
  const startTime = Date.now();
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    const symbolsToTry = upperSymbol.includes(".")
        ? [upperSymbol]
        : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];

    let result = null;
    let fetchSymbol = "";
    let priceSource = "NONE";
    const isMarketOpen = checkIsMarketOpen();

    // 1. ATTEMPT LIVE FETCH
    for (const sym of symbolsToTry) {
        try {
            console.log(`FETCH ATTEMPT (Live): ${sym}`);
            const tempResult = await retry(() => yahooFinance.quote(sym), 3, 500);
            if (tempResult && (tempResult.regularMarketPrice || tempResult.currentPrice)) {
                result = tempResult;
                fetchSymbol = sym;
                priceSource = "LIVE";
                break;
            }
        } catch (e) {
            console.warn(`[FAIL] quote for ${sym}: ${e.message}`);
        }
    }

    const fetchDuration = Date.now() - startTime;
    let currentPrice = 0;
    let previousClose = result?.regularMarketPreviousClose || result?.previousClose || 0;
    let isStale = false;
    
    // Fix 1: Strict Latency Threshold (Execution Risk > 2s)
    const latencyBlocked = fetchDuration > 2000;

    // 2. EXTRACTION & LIQUIDITY-BASED CACHING
    if (result) {
        currentPrice = result.regularMarketPrice || result.currentPrice || previousClose || 0;
        if (currentPrice > 0) {
            priceCache.set(upperSymbol, {
                price: currentPrice,
                timestamp: Date.now(),
                volume: result.regularMarketVolume || 0,
                avgVolume: result.averageDailyVolume3Month || 1 // Avoid div by zero
            });
        }
    }

    // 3. MULTI-LAYER FALLBACK & TTL
    if (currentPrice === 0 || !isMarketOpen) {
        if (!isMarketOpen && priceSource === "LIVE") {
            console.log(`[MARKET CLOSED] Live data received outside hours for ${upperSymbol}. Semantically PREVIOUS_CLOSE.`);
            priceSource = "PREVIOUS_CLOSE";
        }
        
        if (currentPrice === 0) {
            if (previousClose > 0) {
                currentPrice = previousClose;
                priceSource = "PREVIOUS_CLOSE";
            } else if (priceCache.has(upperSymbol)) {
                const cached = priceCache.get(upperSymbol);
                currentPrice = cached.price;
                const ageSeconds = Math.floor((Date.now() - cached.timestamp) / 1000);
                
                // Liquidity-based TTL
                const liquidity = cached.volume / (cached.avgVolume || 1);
                const ttl = liquidity > 1 ? 5 * 60 : 10 * 60;
                
                if (ageSeconds > ttl) isStale = true;
                priceSource = isStale ? "CACHE_STALE" : "CACHE_FRESH";
            }
        }
    }

    if (!currentPrice || currentPrice === 0 || priceSource === "NONE" || priceSource === "FAILED") {
        throw new Error(`Critical data failure: Valid price or source could not be established for ${upperSymbol}`);
    }

    return {
      symbol: fetchSymbol || upperSymbol,
      currentPrice: currentPrice,
      priceSource: priceSource,
      dataAge: result ? 0 : Math.floor((Date.now() - (priceCache.get(upperSymbol)?.timestamp || Date.now())) / 1000),
      isStale: isStale || !isMarketOpen || latencyBlocked,
      latencyBlocked: latencyBlocked,
      fetchDuration: fetchDuration,
      isMarketOpen: isMarketOpen,
      previousClose: previousClose || (priceCache.get(upperSymbol)?.price) || 0,
      volume: result?.regularMarketVolume || 0,
      averageVolume: result?.averageDailyVolume3Month || 0,
      marketCap: result?.marketCap || 0,
      currency: result?.currency || "INR"
    };

  } catch (error) {
    return {
      error: true,
      message: error.message,
      currentPrice: 0,
      priceSource: "FAILED",
      isStale: true
    };
  }
}