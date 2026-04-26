export async function explainDecision({
  stock,
  financialData,
  valuationData,
  riskData,
  technicalData,
  sentimentData,
  finalDecision,
  confidenceScore,
  portfolioImpact
}) {
  try {
    const positives = [];
    const negatives = [];
    const warnings = [];

    /*
    =========================
    FINANCIAL FACTORS
    =========================
    */

    if (financialData?.roe > 15)
      positives.push("Strong Return on Equity");

    if (financialData?.debtToEquity < 0.5)
      positives.push("Low debt burden");

    if (financialData?.profitGrowth > 10)
      positives.push("Healthy profit growth");

    if (financialData?.revenueGrowth < 5)
      negatives.push("Weak revenue growth");

    /*
    =========================
    VALUATION FACTORS
    =========================
    */

    if (valuationData?.pe < 20)
      positives.push("Reasonable valuation");

    if (valuationData?.pe > 40)
      negatives.push("Expensive valuation");

    if (valuationData?.pb > 8)
      warnings.push("High price-to-book ratio");

    /*
    =========================
    RISK FACTORS
    =========================
    */

    if (riskData?.beta > 1.5)
      warnings.push("High volatility risk");

    if (riskData?.riskLevel === "HIGH")
      negatives.push("High investment risk");

    /*
    =========================
    TECHNICAL FACTORS
    =========================
    */

    if (technicalData?.rsi < 35)
      positives.push("Potential reversal zone");

    if (technicalData?.rsi > 75)
      negatives.push("Overbought zone");

    if (technicalData?.trend === "BULLISH")
      positives.push("Positive technical momentum");

    if (technicalData?.trend === "BEARISH")
      negatives.push("Negative technical momentum");

    /*
    =========================
    SENTIMENT FACTORS
    =========================
    */

    if (sentimentData?.score > 7)
      positives.push("Strong positive market sentiment");

    if (sentimentData?.score < 4)
      negatives.push("Weak market sentiment");

    /*
    =========================
    PORTFOLIO IMPACT
    =========================
    */

    if (portfolioImpact?.sectorConflict)
      warnings.push("May increase sector concentration");

    if (portfolioImpact?.allocationTooHigh)
      warnings.push("Portfolio allocation already high");

    /*
    =========================
    DECISION EXPLANATION
    =========================
    */

    let summary = "";

    if (finalDecision.includes("BUY")) {
      summary =
        "The stock demonstrates strong fundamentals, acceptable risk, and supportive momentum, making it suitable for accumulation.";
    }

    if (finalDecision.includes("HOLD")) {
      summary =
        "The stock has mixed signals with moderate conviction. Monitoring is preferred over aggressive action.";
    }

    if (finalDecision.includes("SELL")) {
      summary =
        "The stock shows elevated risk, weak conviction, or deteriorating conditions, making capital protection the priority.";
    }

    return {
      stock,
      finalDecision,
      confidenceScore,
      summary,
      positives,
      negatives,
      warnings
    };
  } catch (error) {
    console.error("Explainability Agent Error:", error.message);

    return {
      stock,
      finalDecision,
      confidenceScore,
      summary: "Unable to generate explanation.",
      positives: [],
      negatives: [],
      warnings: []
    };
  }
}