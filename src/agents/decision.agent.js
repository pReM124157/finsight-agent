export async function runDecisionAgent({
  riskLevel,
  riskScore,
  companyOverview,
  portfolioHealth = 5,
  learningBoost = 0
}) {
  try {
    let score = 0;

    const marketCap = parseFloat(
      companyOverview?.MarketCapitalization || 0
    );

    const peRatio = parseFloat(
      companyOverview?.PERatio || 0
    );

    const profitMargin = parseFloat(
      companyOverview?.ProfitMargin || 0
    );

    const hasFinancialData =
      marketCap > 0 || peRatio > 0 || profitMargin > 0;

    if (!hasFinancialData) {
      return {
        finalAction: "HOLD",
        confidenceScore: 4,
        reasoning:
          "Limited financial data available. Defaulting to HOLD until stronger conviction signals are available."
      };
    }

    // Risk Scoring
    if (riskLevel === "LOW") score += 3;
    if (riskLevel === "MEDIUM") score += 2;
    if (riskLevel === "HIGH") score -= 2;

    if (riskScore <= 3) score += 2;
    if (riskScore >= 7) score -= 2;

    // Large cap quality boost
    if (marketCap > 100000000000) score += 3;
    else if (marketCap > 10000000000) score += 2;
    else score -= 1;

    // PE valuation scoring
    if (peRatio > 0 && peRatio < 25) score += 3;
    else if (peRatio < 40) score += 1;
    else if (peRatio > 60) score -= 2;

    // Profitability
    if (profitMargin > 0.15) score += 2;
    else if (profitMargin > 0.08) score += 1;
    else score -= 1;

    // Portfolio fit
    if (portfolioHealth >= 7) score += 1;
    if (portfolioHealth <= 3) score -= 1;

    // Learning system
    score += learningBoost;

    let finalAction = "HOLD";

    const confidenceScore = Math.min(
      Math.max(score, 1),
      10
    );

    if (score >= 9) {
      finalAction = "STRONG BUY";
    } else if (score >= 6) {
      finalAction = "BUY";
    } else if (score >= 4) {
      finalAction = "HOLD";
    } else if (score >= 2) {
      finalAction = "REDUCE";
    } else {
      finalAction = "SELL";
    }

    return {
      finalAction,
      confidenceScore,
      reasoning: `${companyOverview?.Name || "This company"} shows a ${finalAction} profile based on financial strength, valuation quality, risk profile, and historical learning performance.`
    };

  } catch (error) {
    console.error(error.message);

    return {
      finalAction: "HOLD",
      confidenceScore: 4,
      reasoning:
        "Fallback decision due to insufficient data."
    };
  }
}

export async function decisionAgent(stockData) {
  const result = await runDecisionAgent({
    riskLevel: stockData.riskLevel,
    riskScore: stockData.riskScore || 5,
    companyOverview: stockData,
    portfolioHealth: stockData.portfolioHealth || 5,
    learningBoost: stockData.learningBoost || 0
  });

  return {
    finalDecision: result.finalAction,
    finalConfidenceScore: result.confidenceScore,
    reason: result.reasoning
  };
}