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

    const result = await yahooFinance.quote(fetchSymbol);

    console.log("RAW YAHOO RESULT:", result);

    const companyOverview = {
      Symbol: formattedSymbol,
      Name:
        result?.longName ||
        result?.shortName ||
        formattedSymbol,

      MarketCapitalization: result?.marketCap || 0,
      PERatio: result?.trailingPE || 0,
      ProfitMargin: result?.profitMargins || 0.12,
      ReturnOnEquityTTM: result?.returnOnEquity || 0,
      DebtToEquityRatio: result?.debtToEquity || 0.5,
      QuarterlyEarningsGrowthYOY: result?.earningsQuarterlyGrowth || 0,
      QuarterlyRevenueGrowthYOY: result?.revenueQuarterlyGrowth || 0,
      PriceToBookRatio: result?.priceToBook || 0,
      Beta: result?.beta || 1.0,
      Sector: result?.sector || "Unknown"
    };

    console.log(
      "COMPANY OVERVIEW:",
      companyOverview
    );

    return companyOverview;

  } catch (error) {
    console.error(
      "Yahoo Finance Error:",
      error.message
    );

    return {};
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
    
    const currentPrice = 
      result?.regularMarketPrice ||
      result?.currentPrice ||
      result?.previousClose ||
      0;

    console.log("LIVE PRICE:", currentPrice);
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
    console.log(
      "LIVE MARKET DATA:",
      liveMarketData
    );
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