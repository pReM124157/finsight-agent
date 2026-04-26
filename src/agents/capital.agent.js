export async function capitalAgent(stockData) {
  try {
    const {
      ticker,
      priority = "LOW",
      confidenceScore = 0,
      riskLevel = "HIGH"
    } = stockData;

    let allocation = 5;

    if (priority === "HIGH" && confidenceScore >= 8) {
      allocation = 20;
    } else if (priority === "MEDIUM") {
      allocation = 10;
    }

    if (riskLevel === "HIGH") {
      allocation -= 5;
    }

    allocation = Math.max(allocation, 2);

    return {
      ticker,
      suggestedAllocation: `${allocation}%`,
      summary: `Recommended portfolio allocation: ${allocation}%`
    };
  } catch (error) {
    console.error("Capital Agent Error:", error.message);

    return {
      ticker: stockData?.ticker || "UNKNOWN",
      suggestedAllocation: "0%",
      summary: "Allocation failed"
    };
  }
}