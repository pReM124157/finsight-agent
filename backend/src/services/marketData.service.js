import axios from 'axios';
import YahooFinance from "yahoo-finance2";
import { fetchIndianHolidays } from "./holiday.service.js";
import { safeString, safeSubstring } from "../core/safety.js";

const yahooFinance = new YahooFinance();

// --- Institutional Data Layer (Observability & Safety) ---
export const dataMetrics = {
  yahooSuccess: 0,
  yahooFail: 0,
  alphaSuccess: 0,
  cacheHit: 0,
  lastGlobalCall: 0
};

const dataCache = new Map();
const CACHE_TTL_HIGH = 5 * 60 * 1000; // 5 mins (Yahoo/Live)
const CACHE_TTL_LOW = 60 * 1000;      // 1 min (Fallback/Degraded)

// --- Circuit Breaker State ---
let yahooFailureCount = 0;
let yahooCooldownUntil = 0;
const MAX_YAHOO_FAILURES = 5;
const YAHOO_COOLDOWN_MS = 60000;

function getCached(key) {
  const entry = dataCache.get(key);
  if (!entry) return null;
  
  const ttl = entry.quality === "HIGH" ? CACHE_TTL_HIGH : CACHE_TTL_LOW;
  if (Date.now() - entry.timestamp > ttl) {
    dataCache.delete(key);
    return null;
  }
  dataMetrics.cacheHit++;
  return entry.data;
}

function setCached(key, data, quality = "HIGH") {
  dataCache.set(key, { data, timestamp: Date.now(), quality });
}

function reportYahooStatus(success) {
  if (success) {
    yahooFailureCount = 0;
    dataMetrics.yahooSuccess++;
  } else {
    yahooFailureCount++;
    dataMetrics.yahooFail++;
    if (yahooFailureCount >= MAX_YAHOO_FAILURES) {
      console.warn(`[CIRCUIT BREAKER] Yahoo tripped. Cooldown active.`);
      yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
    }
  }
}

async function withTimeout(promise, ms = 5000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Institutional Timeout")), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function normalizeSymbol(symbol) {
  if (!symbol || typeof symbol !== "string") return "";
  return symbol
    .replace(/\//g, "") // Remove ALL slashes to prevent double-slash API errors
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ""); // Remove spaces
}

export async function checkSymbolExists(symbol) {
  try {
    const upper = normalizeSymbol(symbol);
    if (!upper || upper.length < 3) return false;

    // Direct check with .NS
    const res = await yahooFinance.quote(upper + ".NS");
    if (res && (res.regularMarketPrice || res.currentPrice)) return true;

    // Fallback to .BO
    const res2 = await yahooFinance.quote(upper + ".BO");
    if (res2 && (res2.regularMarketPrice || res2.currentPrice)) return true;

    return false;
  } catch (err) {
    console.log("API failed, allowing:", symbol);
    return true; // 🔥 NEVER BLOCK USER
  }
}

async function fetchWithRetry(fn, retries = 2) {
  try {
    return await fn();
  } catch (e) {
    if (retries === 0) throw e;
    console.warn(`[RETRY] API call failed. Retries left: ${retries}. Error: ${e.message}`);
    await new Promise(r => setTimeout(r, 500));
    return fetchWithRetry(fn, retries - 1);
  }
}

/**
 * Fetches Nifty 50 and Sensex current quotes.
 */
export async function getIndianIndices() {
  try {
    const symbols = ["^NSEI", "^BSESN"]; // Nifty 50 and Sensex
    const results = await yahooFinance.quote(symbols);
    
    const nifty = results.find(r => r.symbol === "^NSEI") || {};
    const sensex = results.find(r => r.symbol === "^BSESN") || {};

    return {
      nifty: {
        price: nifty.regularMarketPrice,
        change: nifty.regularMarketChangePercent,
        changeRaw: nifty.regularMarketChange
      },
      sensex: {
        price: sensex.regularMarketPrice,
        change: sensex.regularMarketChangePercent,
        changeRaw: sensex.regularMarketChange
      }
    };
  } catch (error) {
    console.warn("Failed to fetch indices:", error.message);
    return {
      nifty: { price: 0, change: 0 },
      sensex: { price: 0, change: 0 }
    };
  }
}

/**
 * Fetches recent news for Indian market.
 */
export async function getIndianMarketNews() {
  try {
    const result = await yahooFinance.search("India stock market", { newsCount: 5 });
    return result.news.map(n => n.title);
  } catch (error) {
    console.warn("Failed to fetch news:", error.message);
    return ["No recent news available."];
  }
}
/**
 * Fetches performance for key Indian sectors.
 */
export async function getIndianSectors() {
  try {
    const symbols = ["^NSEBANK", "^CNXIT"]; // Nifty Bank and Nifty IT
    const results = await yahooFinance.quote(symbols);
    
    const bank = results.find(r => r.symbol === "^NSEBANK") || {};
    const it = results.find(r => r.symbol === "^CNXIT") || {};

    return {
      bank: bank.regularMarketChangePercent || 0,
      it: it.regularMarketChangePercent || 0
    };
  } catch (error) {
    console.warn("Failed to fetch sectors:", error.message);
    return { bank: 0, it: 0 };
  }
}


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
    const upperSymbol = normalizeSymbol(symbol);

    const symbolsToTry = upperSymbol.includes(".")
      ? [upperSymbol]
      : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];

    let result = null;
    let fetchSymbol = "";

    for (const sym of symbolsToTry) {
        try {
            console.log(`FETCH ATTEMPT (Overview): ${sym}`);
            const tempResult = await retry(() => yahooFinance.quoteSummary(sym, {
                modules: ["financialData", "defaultKeyStatistics", "assetProfile", "summaryDetail", "calendarEvents"]
            }), 2, 500);
            if (tempResult && tempResult.assetProfile) {
                result = tempResult;
                fetchSymbol = sym;
                break;
            }
        } catch (e) {
            console.warn(`[RETRY FAIL] Overview fetch failed for ${sym}:`, e.message);
        }
    }

    if (!result) {
        throw new Error(`Failed to fetch data for ${upperSymbol} after trying: ${symbolsToTry.join(", ")}`);
    }

    console.log("FETCH SUCCESS (Overview):", fetchSymbol);
    const safeRaw = safeString(JSON.stringify(result));
    console.log("RAW YAHOO SUMMARY RESULT:", safeSubstring(safeRaw, 500));

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
    const upperSymbol = safeString(symbol).toUpperCase().replace(/\s+/g, "");
    return {
      Symbol: upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`
    };
  }
}

const priceCache = new Map();

async function getMarketStatusIST() {
    const now = new Date();
    const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const year = ist.getFullYear();
    
    // Fix: Safe IST date string conversion
    const dateStr = ist.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    
    const holidays = await fetchIndianHolidays(year);
    const safeHolidays = holidays && holidays.size > 0 ? holidays : new Set();
    
    const day = ist.getDay(); 
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    
    const time = hours * 60 + minutes;
    const open = 9 * 60 + 15;   // 9:15 AM
    const close = 15 * 60 + 30; // 3:30 PM
    
    const isWeekend = day === 0 || day === 6;
    const isHoliday = safeHolidays.has(dateStr);
    
    // Explicit Phase Classification
    const isPreMarket = !isWeekend && !isHoliday && time < open;
    const isLive = !isWeekend && !isHoliday && time >= open && time <= close;
    const isPostMarket = !isWeekend && !isHoliday && time > close;

    // Fix: Consecutive holiday / weekend aware next session logic
    function getNextTradingDay(currentIst, holidaySet) {
        const next = new Date(currentIst);
        while (true) {
            next.setDate(next.getDate() + 1);
            const d = next.getDay();
            const dStr = next.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
            const isWknd = d === 0 || d === 6;
            const isHolid = holidaySet.has(dStr);
            if (!isWknd && !isHolid) break;
        }
        // Force 9:15 AM
        next.setHours(9, 15, 0, 0);
        return next;
    }
    // Fix: Accurate last trading day logic
    function getLastTradingDay(currentIst, holidaySet) {
        const prev = new Date(currentIst);
        while (true) {
            prev.setDate(prev.getDate() - 1);
            const d = prev.getDay();
            const dStr = prev.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
            const isWknd = d === 0 || d === 6;
            const isHolid = holidaySet.has(dStr);
            if (!isWknd && !isHolid) break;
        }
        return prev;
    }

    const nextTradingDay = getNextTradingDay(ist, safeHolidays);
    const lastTradingDay = getLastTradingDay(ist, safeHolidays);
    
    return {
        isMarketOpen: isLive,
        isPreMarket,
        isLive,
        isPostMarket,
        isWeekend,
        isHoliday,
        nextTradingDay,
        lastTradingDay,
        istTime: ist
    };
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

async function alphaFetch(symbol) {
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return null;
    
    const avSymbol = symbol.replace(".NS", ".NSE").replace(".BO", ".BSE");
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${avSymbol}&apikey=${apiKey}`;
    
    const response = await axios.get(url, { timeout: 3000 });
    const quote = response.data["Global Quote"];
    
    if (!quote || !quote["05. price"]) return null;
    
    return {
      symbol: symbol,
      regularMarketPrice: parseFloat(quote["05. price"]),
      regularMarketChangePercent: parseFloat(quote["10. change percent"].replace("%", "")),
      regularMarketPreviousClose: parseFloat(quote["08. previous close"]),
      source: "FALLBACK"
    };
  } catch (err) {
    console.warn(`[FALLBACK FAIL] ${symbol}: ${err.message}`);
    return null;
  }
}

export async function getLiveMarketData(symbol) {
  const startTime = Date.now();
  const upperSymbol = normalizeSymbol(symbol);
  
  // 1. CHECK CACHE (Institutional Guard)
  const cached = getCached(`LIVE_${upperSymbol}`);
  if (cached) {
    const age = Math.floor((Date.now() - cached.timestamp) / 1000);
    console.log(`[CACHE] hit symbol=${upperSymbol} age=${age}s`);
    return { ...cached, dataAge: age, dataConfidence: "CACHED" };
  }

  try {
    const symbolsToTry = upperSymbol.includes(".")
        ? [upperSymbol]
        : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];

    let result = null;
    let fetchSymbol = "";
    let priceSource = "FAILED";
    let dataConfidence = "LIVE_VERIFIED";
    let completeness = "FULL";

    const marketStatus = await getMarketStatusIST();

    // 2. PRIMARY FETCH (Yahoo) with Circuit Breaker
    const yahooAvailable = Date.now() >= yahooCooldownUntil;
    if (yahooAvailable) {
      for (const sym of symbolsToTry) {
          try {
              console.log(`[DATA] attempt=yahoo symbol=${sym}`);
              const tempResult = await withTimeout(retry(() => yahooFinance.quote(sym), 1, 500), 3500);
              if (tempResult && (tempResult.regularMarketPrice || tempResult.currentPrice)) {
                  result = tempResult;
                  fetchSymbol = sym;
                  priceSource = "YAHOO";
                  reportYahooStatus(true);
                  break;
              }
          } catch (e) {
              console.warn(`[DATA] source=yahoo symbol=${sym} status=fail error="${e.message}"`);
          }
      }
    } else {
      console.warn(`[CIRCUIT BREAKER] Skipping Yahoo for ${upperSymbol} (cooling down)`);
    }

    if (!result) reportYahooStatus(false);

    // 3. FALLBACK FETCH (Alpha Vantage)
    if (!result) {
      console.log(`[DATA] attempt=alpha symbol=${upperSymbol}`);
      result = await alphaFetch(upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`);
      if (result) {
        priceSource = "ALPHA_VANTAGE";
        dataConfidence = "DEGRADED_SOURCE";
        completeness = "PARTIAL";
        fetchSymbol = result.symbol;
        dataMetrics.alphaSuccess++;
        console.log(`[DATA] source=alpha symbol=${upperSymbol} status=fallback`);
      }
    }

    const fetchDuration = Date.now() - startTime;
    let currentPrice = result?.regularMarketPrice || result?.currentPrice || 0;
    let previousClose = result?.regularMarketPreviousClose || result?.previousClose || 0;
    const latencyBlocked = fetchDuration > 2500;

    if (!currentPrice && previousClose) {
        currentPrice = previousClose;
        priceSource = "PREVIOUS_CLOSE";
    }

    if (!currentPrice || currentPrice === 0) {
        throw new Error(`Data extraction failed for ${upperSymbol}`);
    }

    const finalData = {
        symbol: fetchSymbol || upperSymbol,
        price: currentPrice,
        currentPrice: currentPrice,
        previousClose: previousClose,
        change: result?.regularMarketChangePercent || 0,
        changeRaw: result?.regularMarketChange || 0,
        isMarketOpen: marketStatus.isMarketOpen,
        marketStatus,
        priceSource,
        dataConfidence,
        completeness,
        latencyBlocked,
        fetchDuration,
        dataAge: 0,
        timestamp: Date.now(),
        status: "success"
    };

    // 5. SELECTIVE CACHING
    setCached(`LIVE_${upperSymbol}`, finalData, priceSource === "YAHOO" ? "HIGH" : "LOW");
    
    console.log(`[DATA] source=${priceSource.toLowerCase()} symbol=${upperSymbol} status=success latency=${fetchDuration}ms`);
    return finalData;

  } catch (error) {
    console.error(`[ERROR] layer=data symbol=${symbol} type=critical error="${error.message}"`);
    return {
      error: true,
      message: error.message,
      priceSource: "FAILED",
      dataConfidence: "NONE",
      status: "error"
    };
  }
}

// --- Warm Cache Strategy (Institutional Boot) ---
const POPULAR_SYMBOLS = ["TCS", "RELIANCE", "INFY", "HDFCBANK", "ICICIBANK"];
setTimeout(() => {
  console.log(`[BOOT] Warming up data cache for ${POPULAR_SYMBOLS.length} symbols...`);
  POPULAR_SYMBOLS.forEach(async (symbol) => {
    try {
      await getLiveMarketData(symbol);
    } catch (err) {
      // Silent fail for warm boot
    }
  });
}, 5000);
