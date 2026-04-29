/**
 * agents/portfolioHealth.agent.js
 * Calculates the overall health and risk score of a financial portfolio.
 */

export async function analyzePortfolioHealth(portfolio = []) {
    try {
        if (!portfolio || portfolio.length === 0) {
            return {
                score: 0,
                status: "EMPTY",
                riskLevel: "N/A",
                diversification: "N/A",
                concentrationRisk: "N/A",
                action: "Please add stocks to your portfolio to see health metrics."
            };
        }

        const totalValue = portfolio.reduce((sum, item) => sum + (Number(item.allocation) || 0), 0);
        const stockCount = portfolio.length;

        // 1. Diversification Score (Ideal 10-20 stocks)
        let divScore = 0;
        if (stockCount >= 12) divScore = 10;
        else if (stockCount >= 8) divScore = 8;
        else if (stockCount >= 5) divScore = 5;
        else divScore = 3;

        // 2. Concentration Risk (Check highest allocation)
        const highestAllocation = Math.max(...portfolio.map(item => Number(item.allocation) || 0));
        let concentrationScore = 10;
        if (highestAllocation > 30) concentrationScore = 3;
        else if (highestAllocation > 20) concentrationScore = 6;
        else if (highestAllocation > 15) concentrationScore = 8;

        // 3. Sector Diversification (Simplified - counting sectors if provided)
        const sectors = new Set(portfolio.map(item => item.sector || "Unknown"));
        let sectorScore = (sectors.size / Math.max(stockCount, 1)) * 10;
        if (sectors.size >= 5) sectorScore = 10;
        else if (sectors.size >= 3) sectorScore = 7;

        // 4. Weight Alignment (Are allocations roughly balanced?)
        const avgAllocation = totalValue / stockCount;
        const variances = portfolio.map(item => Math.abs((Number(item.allocation) || 0) - avgAllocation));
        const avgVariance = variances.reduce((a, b) => a + b, 0) / stockCount;
        let alignmentScore = Math.max(0, 10 - (avgVariance / 5));

        // 5. Final Calculation
        const finalScore = (
            (divScore * 0.3) +
            (concentrationScore * 0.3) +
            (sectorScore * 0.2) +
            (alignmentScore * 0.2)
        ).toFixed(1);

        let status = "MODERATE";
        let action = "Continue monitoring and diversify further.";
        let riskLevel = "MEDIUM";

        if (finalScore >= 8) {
            status = "STRONG";
            riskLevel = "LOW";
            action = "Healthy portfolio structure. Maintain discipline.";
        } else if (finalScore < 5) {
            status = "CRITICAL";
            riskLevel = "HIGH";
            action = "Portfolio is overconcentrated or poorly diversified. Immediate rebalancing recommended.";
        }

        return {
            score: Number(finalScore),
            status,
            riskLevel,
            diversification: stockCount >= 10 ? "EXCELLENT" : stockCount >= 6 ? "GOOD" : "POOR",
            concentrationRisk: highestAllocation > 25 ? "HIGH" : highestAllocation > 15 ? "MEDIUM" : "LOW",
            action,
            details: {
                stockCount,
                highestAllocation: `${highestAllocation.toFixed(1)}%`,
                uniqueSectors: sectors.size
            }
        };

    } catch (error) {
        console.error("Portfolio Health Agent Error:", error.message);
        return {
            score: 5.0,
            status: "MODERATE",
            riskLevel: "MEDIUM",
            diversification: "UNKNOWN",
            concentrationRisk: "UNKNOWN",
            action: "System error calculating health. Monitor manually."
        };
    }
}
