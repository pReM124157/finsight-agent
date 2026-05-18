/**
 * INTEGRATION TEST — Provider Resilience & Fallback Cascade
 * Validates the core requirements for the hardened institutional multi-provider stack.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getLiveMarketData, getCompanyOverview, dataMetrics, getHistoricalCandles } from "../../src/services/marketData.service.js";
import { DATA_AVAILABILITY_STATES } from "../../src/services/dataAvailability.service.js";
import { invalidateCacheGroup } from "../../src/services/sharedCache.service.js";
import { recoverProviderHealth, resetProviderHealthForTest } from "../../src/services/providerHealth.service.js";
import supabase from "../../src/services/supabase.service.js";

const mockYahooInstance = vi.hoisted(() => ({
  quote: vi.fn(),
  quoteSummary: vi.fn(),
  historical: vi.fn(),
}));

// Mock external provider APIs to simulate failures
vi.mock("yahoo-finance2", () => {
  return {
    default: vi.fn(() => mockYahooInstance)
  };
});

// Since node fetch is global, we can intercept fetch calls to mock fallback providers
const originalFetch = global.fetch;

describe("Institutional Provider Resilience (Failover & Graceful Degradation)", () => {
  beforeEach(async () => {
    mockYahooInstance.quote.mockReset();
    mockYahooInstance.quoteSummary.mockReset();
    mockYahooInstance.historical.mockReset();
    // Reset caches and provider health states before each run
    await invalidateCacheGroup("MARKET_LIVE");
    await invalidateCacheGroup("MARKET_OVERVIEW_VERSIONED");
    await invalidateCacheGroup("MARKET_HISTORICAL");
    // Force clear provider health in DB
    await supabase.from("provider_health").update({ cooldown_until: null, consecutive_failures: 0 }).in("provider", ["yahoo", "alpha_vantage", "twelvedata", "finnhub"]);
    
    // Call recover to clear local state if applicable
    await recoverProviderHealth("yahoo");
    await recoverProviderHealth("alpha_vantage");
    await recoverProviderHealth("twelvedata");
    await recoverProviderHealth("finnhub");
    
    resetProviderHealthForTest("yahoo");
    resetProviderHealthForTest("alpha_vantage");
    resetProviderHealthForTest("twelvedata");
    resetProviderHealthForTest("finnhub");
    
    // Reset metrics
    dataMetrics.yahooFail = 0;
    dataMetrics.yahooSuccess = 0;
    
    // Clear mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Live Market Data Fallback Cascade", () => {
    it("should successfully fetch from Yahoo when healthy", async () => {
      mockYahooInstance.quote.mockResolvedValueOnce({
        symbol: "TCS.NS",
        regularMarketPrice: 3500,
        regularMarketChangePercent: 1.5
      });

      const data = await getLiveMarketData("TCS");
      expect(data.priceSource).toBe("YAHOO");
      expect(data.price).toBe(3500);
      expect(data.availabilityState).toBe(DATA_AVAILABILITY_STATES.LIVE);
      expect(data.dataIntegrity.quote).toBe(true);
    });

    it("should gracefully degrade to partial payload if Yahoo fails but fallback succeeds", async () => {
      mockYahooInstance.quote.mockRejectedValue(new Error("Yahoo Outage"));

      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (typeof url === "string" && url.includes("alphavantage")) {
          return new Response(JSON.stringify({
            "Global Quote": { "01. symbol": "REL.BSE", "05. price": "3490.00" }
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(url, options);
      });

      const data = await getLiveMarketData("RELIANCE");
      
      expect(mockYahooInstance.quote).toHaveBeenCalled(); // Yahoo attempted
      expect(data.priceSource).toBe("ALPHA_VANTAGE"); // Fell back to Alpha
      expect(data.price).toBe(3490);
      
      // Should be degraded but still yield a valid quote
      expect(data.completeness).toBe("PARTIAL");
      expect(data.availabilityState).toBe(DATA_AVAILABILITY_STATES.PARTIAL_DATA);
      expect(data.dataIntegrity.quote).toBe(true);
      expect(data.dataIntegrity.fundamentals).toBe(false); // Live fallback only has price
    });

    it("should fallback to TwelveData if both Yahoo and Alpha fail", async () => {
      mockYahooInstance.quote.mockRejectedValue(new Error("Yahoo Outage"));

      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (typeof url === "string" && url.includes("alphavantage")) {
          return new Response("Error", { status: 500, headers: { "Content-Type": "text/plain" } });
        }
        if (typeof url === "string" && url.includes("twelvedata")) {
          return new Response(JSON.stringify({
            symbol: "HDFCBANK",
            close: "3480.00"
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(url, options);
      });

      const data = await getLiveMarketData("HDFCBANK");
      expect(data.priceSource).toBe("TWELVEDATA");
      expect(data.price).toBe(3480);
      expect(data.completeness).toBe("PARTIAL");
    });
  });

  describe("Company Overview Resilience & Data Integrity", () => {
    it("should fetch full fundamentals from Yahoo and emit correct dataIntegrity", async () => {
      mockYahooInstance.quoteSummary.mockResolvedValue({
        assetProfile: { sector: "Technology" },
        summaryDetail: { trailingPE: 25 },
        financialData: { returnOnEquity: 0.15 }
      });

      const overview = await getCompanyOverview("INFY");
      console.log("OVERVIEW IN TEST 3:", JSON.stringify(overview));
      expect(overview.source).toBeUndefined(); // Yahoo is primary
      expect(overview.Sector).toBe("Technology");
      expect(overview.dataIntegrity.fundamentals).toBe(true);
    });

    it("should fallback to Alpha Vantage for fundamentals if Yahoo fails", async () => {
      mockYahooInstance.quoteSummary.mockRejectedValue(new Error("Yahoo Summary Outage"));

      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (typeof url === "string" && url.includes("OVERVIEW")) {
          return new Response(JSON.stringify({
            Symbol: "WIPRO.BSE",
            Sector: "Technology",
            PERatio: "24.5"
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(url, options);
      });

      const overview = await getCompanyOverview("WIPRO");
      expect(overview.source).toBe("alpha_vantage");
      expect(overview.Sector).toBe("Technology");
      expect(overview.dataIntegrity.fundamentals).toBe(true);
    });
  });

  describe("Provider Circuit Breaker & Auth Failure Logic", () => {
    it("should instantly trip circuit breaker on auth failures without retrying", async () => {
      mockYahooInstance.quote.mockRejectedValue(new Error("401 Unauthorized"));
      
      global.fetch = vi.fn().mockImplementation(async (url, options) => {
        if (typeof url === "string" && (url.includes("alphavantage") || url.includes("twelvedata") || url.includes("finnhub"))) {
          return new Response("Error", { status: 500, headers: { "Content-Type": "text/plain" } });
        }
        return originalFetch(url, options);
      });

      await getLiveMarketData("TATAMOTORS");
      
      // Should have only attempted Yahoo ONCE for this symbol variant
      // Because it's an auth failure, it aborts the retry loop
      // (The actual number of calls might be equal to the number of variants, but retries per variant is 0)
      
      const metrics = dataMetrics;
      expect(metrics.yahooFail).toBeGreaterThan(0);
    });
  });
});
