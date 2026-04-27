import { getRecommendationHistory } from "../services/history.service.js";
import { getCompanyOverview } from "../services/marketData.service.js";

export const runPerformanceAgent = async (symbol) => {
  try {
    const history = await getRecommendationHistory();

    const pendingRecommendations = history.filter(
      (item) =>
        item.symbol &&
        item.symbol.toLowerCase() === symbol.toLowerCase() &&
        item.isValidated === false
    );

    if (!pendingRecommendations.length) {
      return {
        performanceInsight:
          "No pending recommendations to validate.",
        performanceScore: 0
      };
    }

    // Get latest market price
    const companyData = await getCompanyOverview(symbol);

    const currentPrice =
      parseFloat(companyData?.currentPrice) || 0;

    if (!currentPrice) {
      return {
        performanceInsight:
          "Unable to fetch latest market price.",
        performanceScore: 0
      };
    }

    let totalScore = 0;

    pendingRecommendations.forEach((item) => {
      const entryPrice = parseFloat(item.entryPrice) || 0;

      if (!entryPrice) return;

      const changePercent =
        ((currentPrice - entryPrice) / entryPrice) * 100;

      if (
        item.verdict === "BUY" &&
        changePercent > 0
      ) {
        totalScore += 1;
      }

      if (
        item.verdict === "SELL" &&
        changePercent < 0
      ) {
        totalScore += 1;
      }
    });

    return {
      performanceScore: totalScore,
      performanceInsight: `
Validated Recommendations: ${pendingRecommendations.length}
Current Price: ${currentPrice}
Performance Score: ${totalScore}
      `.trim()
    };
  } catch (error) {
    console.error(
      "❌ Performance Agent Error:",
      error.message
    );

    return {
      performanceInsight:
        "Performance validation unavailable.",
      performanceScore: 0
    };
  }
};