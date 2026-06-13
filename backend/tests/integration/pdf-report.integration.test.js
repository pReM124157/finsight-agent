import { describe, expect, it } from "vitest";
import { generateStockReportPDF } from "../../src/services/pdfReport.service.js";

describe("generateStockReportPDF", () => {
  it("returns a PDF buffer for a valid report payload", async () => {
    const buffer = await generateStockReportPDF({
      symbol: "TCS",
      stockData: {
        currentPrice: 3899.45,
        Sector: "Information Technology"
      },
      analysisData: {
        decision: {
          finalDecision: "BUY",
          finalConfidenceScore: 7.8,
          reason: "Structure remains constructive with healthy risk-reward."
        },
        risk: {
          riskLevel: "MEDIUM",
          riskScore: 5,
          majorRisks: ["Index weakness", "Earnings volatility"]
        },
        entryTiming: {
          strategy: "Accumulate on shallow pullbacks",
          stopLoss: "Rs 3740",
          initialTarget: "Rs 4125"
        },
        exitSignal: {
          signal: "No active exit signal"
        },
        analysis: {
          stockFundamentals: "TCS maintains resilient margins, strong cash generation, and a durable order pipeline."
        },
        learning: {
          confidenceBoost: 1,
          learningInsight: "Recent IT leadership has remained sticky."
        },
        performance: {
          performanceScore: 7,
          performanceInsight: "Historical follow-through is above baseline."
        },
        rebalancing: {
          rebalancingAdvice: "Keep position sizing disciplined against sector concentration."
        },
        portfolio: {
          healthScore: 7,
          dominantSector: "Information Technology"
        }
      },
      performanceStats: {
        total_recommendations: 161,
        closed_recommendations: 34,
        win_rate: 58.82,
        avg_return_pct: 4.91,
        expectancy: 1.86,
        sharpe_ratio: 1.27
      }
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
