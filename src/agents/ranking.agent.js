export async function rankingAgent(stockData) {
  try {
    const {
      ticker,
      confidenceScore = 0,
      riskScore = 5,
      financialScore = 8,
      technicalScore = 7
    } = stockData;
    let rankScore =
      (confidenceScore * 0.40) +
      (financialScore * 0.25) +
      (technicalScore * 0.20) +
      ((10 - riskScore) * 0.15);
    let priority = "LOW";
    if (rankScore >= 8) {
      priority = "HIGH";
    } else if (rankScore >= 6) {
      priority = "MEDIUM";
    }
    return {
      ticker,
      rankScore: Number(rankScore.toFixed(1)),
      priority,
      summary: `${ticker} ranked as ${priority} priority opportunity`
    };
  } catch (error) {
    console.error("Ranking Agent Error:", error.message);
    return {
      ticker: stockData?.ticker || "UNKNOWN",
      rankScore: 0,
      priority: "LOW",
      summary: "Ranking failed"
    };
  }
}