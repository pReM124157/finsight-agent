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

    const fetchSymbol = upperSymbol.includes(".")
      ? upperSymbol
      : `${upperSymbol}.NS`;

    console.log("FETCH SYMBOL (Overview):", fetchSymbol);

    // Fetch deep fundamentals using quoteSummary modules
    const result = await yahooFinance.quoteSummary(fetchSymbol, {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "assetProfile",
        "summaryDetail",
        "calendarEvents"
      ]
    });

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
    console.error("Yahoo Finance Error:", error.message);
    
    // Return at least the symbol to prevent downstream "UNKNOWN" errors
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    return {
      Symbol: upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`
    };
  }
}

export async function getLiveMarketData(symbol) {
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    
    const fetchSymbol = upperSymbol.includes(".")
      ? upperSymbol
      : `${upperSymbol}.NS`;

    console.log("FETCH SYMBOL (Live):", fetchSymbol);

    const result = await yahooFinance.quote(fetchSymbol);
    console.log("RAW YAHOO RESULT (Live):", JSON.stringify(result).substring(0, 500));
    
    const currentPrice = 
      result?.regularMarketPrice ||
      result?.currentPrice ||
      result?.regularMarketPreviousClose ||
      result?.previousClose ||
      0;

    console.log("EXTRACTED PRICE:", currentPrice);
    
    const liveMarketData = {
      symbol: fetchSymbol,
      currentPrice: currentPrice,
      previousClose:
        result?.regularMarketPreviousClose ||
        result?.previousClose ||
        0,
      open: result?.regularMarketOpen || 0,
      dayHigh: result?.regularMarketDayHigh || 0,
      dayLow: result?.regularMarketDayLow || 0,
      fiftyTwoWeekHigh: result?.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: result?.fiftyTwoWeekLow || 0,
      volume: result?.regularMarketVolume || 0,
      averageVolume: result?.averageDailyVolume3Month || 0,
      marketCap: result?.marketCap || 0,
      currency: result?.currency || "INR"
    };
    console.log("FINAL LIVE DATA:", liveMarketData);
    console.log("DEBUG LIVE FIELDS:", {
        Symbol: liveMarketData.symbol,
        currentPrice: liveMarketData.currentPrice,
        regularMarketPrice: result?.regularMarketPrice,
        regularMarketPreviousClose: result?.regularMarketPreviousClose
    });

    return liveMarketData;
  } catch (error) {
    console.error(
      "Live Market Data Error:",
      error.message
    );
    return {
      currentPrice: 0
    };
  }
}