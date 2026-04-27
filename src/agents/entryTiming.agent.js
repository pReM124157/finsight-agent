// agents/entryTiming.agent.js

export async function analyzeEntryTiming({
    stock,
    currentPrice,
    confidenceScore,
    riskLevel,
    valuationScore,
    momentumScore
}) {
    try {
        let strategy = "WAIT";
        let entryZone = "";
        let stopLoss = 0;
        let target = 0;
        let rewardRiskRatio = 0;
        let urgency = "LOW";
        let reason = "";

        /*
        Strategy Logic
        */

        if (
            confidenceScore >= 9 &&
            momentumScore >= 9 &&
            valuationScore >= 8 &&
            currentPrice > 0
        ) {
            strategy = "IMMEDIATE BUY";
            urgency = "VERY HIGH";

            entryZone = `₹${currentPrice}`;
            stopLoss = Math.round(currentPrice * 0.94);
            target = Math.round(currentPrice * 1.12);

            reason =
                "Exceptional conviction with strong momentum and attractive valuation.";
        }

        else if (
            confidenceScore >= 8 &&
            valuationScore >= 7
        ) {
            strategy = "BUY ON DIP";
            urgency = "HIGH";

            const lower = Math.round(currentPrice * 0.97);
            const upper = Math.round(currentPrice * 0.99);

            entryZone = `₹${lower} – ₹${upper}`;
            stopLoss = Math.round(currentPrice * 0.93);
            target = Math.round(currentPrice * 1.10);

            reason =
                "Strong stock but better accumulation expected near support levels.";
        }

        else if (
            confidenceScore >= 7 &&
            momentumScore >= 8
        ) {
            strategy = "BREAKOUT BUY";
            urgency = "MEDIUM";

            const breakout = Math.round(currentPrice * 1.02);

            entryZone = `Above ₹${breakout}`;
            stopLoss = Math.round(currentPrice * 0.95);
            target = Math.round(currentPrice * 1.11);

            reason =
                "Wait for price confirmation before aggressive entry.";
        }

        else if (
            confidenceScore >= 5
        ) {
            strategy = "WAIT FOR CONFIRMATION";
            urgency = "LOW";

            const watchEntry = Math.round(currentPrice * 0.98);
            entryZone = `Watch near ₹${watchEntry}`;
            stopLoss = Math.round(currentPrice * 0.94);
            target = Math.round(currentPrice * 1.08);

            reason =
                "Good stock, but wait for stronger confirmation before aggressive capital deployment.";
        }

        else {
            strategy = "AVOID ENTRY";
            urgency = "VERY LOW";

            entryZone = "Avoid";
            stopLoss = 0;
            target = 0;

            reason =
                "Weak setup with poor conviction and elevated uncertainty.";
        }

        /*
        Reward Risk Calculation
        */

        if (stopLoss > 0 && target > 0) {
            const reward = target - currentPrice;
            const risk = currentPrice - stopLoss;

            if (risk > 0) {
                rewardRiskRatio = (reward / risk).toFixed(2);
            }
        }

        return {
            stock,
            currentPrice,
            strategy,
            entryZone,
            stopLoss,
            target,
            rewardRiskRatio,
            urgency,
            reason
        };
    } catch (error) {
        console.error("Entry Timing Agent Error:", error.message);

        return {
            stock,
            strategy: "ERROR",
            reason: error.message
        };
    }
}