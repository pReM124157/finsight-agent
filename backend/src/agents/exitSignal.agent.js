/**
 * agents/exitSignal.agent.js
 * Decides on position management: HOLD, TRIM, BOOK PROFITS, or EXIT.
 */

export async function analyzeExitSignal({
    stock,
    currentPrice,
    entryPrice,
    stopLoss,
    target,
    trailingStop,
    technicalData = {},
    marketData = {},
    companyData = {},
    valuationScore = 5
}) {
    try {
        const symbol = (stock || "UNKNOWN").toUpperCase();
        const price = Number(currentPrice) || 0;
        const entry = Number(entryPrice) || 0;
        const sl = Number(stopLoss) || 0;
        const tp = Number(target) || 0;
        const trail = Number(trailingStop) || 0;

        let signal = "HOLD";
        let urgency = "LOW";
        let action = "Continue holding for original target";
        let reason = "No significant exit triggers detected. Position remains within risk parameters.";

        // 1. CRITICAL: Stop Loss Check
        if (price > 0 && sl > 0 && price <= sl) {
            signal = "STOP LOSS EXIT";
            urgency = "CRITICAL";
            action = "Exit position immediately";
            reason = `Price reached defined stop loss of ₹${sl}. Disciplined risk management required.`;
            return { signal, urgency, action, reason };
        }

        // 2. Trailing Stop Check
        if (price > 0 && trail > 0 && price <= trail) {
            signal = "FULL EXIT";
            urgency = "HIGH";
            action = "Close entire position";
            reason = `Price breached trailing stop level of ₹${trail}. Locking in gains/minimizing drawdown.`;
            return { signal, urgency, action, reason };
        }

        // 3. Target Reached / Profit Booking
        if (price > 0 && tp > 0 && price >= tp) {
            signal = "PARTIAL PROFIT BOOKING";
            urgency = "HIGH";
            action = "Book 30–50% profits";
            reason = `Primary target zone of ₹${tp} reached. Reducing exposure to lock in gains.`;
            
            // Check for overextension
            if (technicalData?.rsi > 75) {
                signal = "FULL EXIT";
                action = "Close position entirely";
                reason = `Target reached and RSI is overbought (${technicalData.rsi.toFixed(1)}). Major reversal risk detected.`;
            }
            return { signal, urgency, action, reason };
        }

        // 4. Technical Breakdown (Trend/Volume)
        const priceBelow50DMA = technicalData?.sma50 > 0 && price < technicalData.sma50;
        const weakVolume = marketData?.volume < (marketData?.averageVolume * 0.7);
        const trendBreak = technicalData?.trend === "BEARISH";

        if (priceBelow50DMA && trendBreak) {
            signal = "TRIM POSITION";
            urgency = "MEDIUM";
            action = "Reduce position size by 25–30%";
            reason = "Technical trend breakdown and breach of 50-day moving average. Structural weakness detected.";
        } 
        else if (valuationScore <= 3 && technicalData?.rsi > 70) {
            signal = "TRIM POSITION";
            urgency = "MEDIUM";
            action = "Trim exposure";
            reason = "Valuation is significantly stretched alongside overbought technical conditions.";
        }

        // 5. Earnings/Fundamental Deterioration (if data available)
        if (companyData?.QuarterlyEarningsGrowthYOY < -0.15) {
            signal = "TRIM POSITION";
            urgency = "HIGH";
            action = "Reduce exposure aggressively";
            reason = "Significant earnings deterioration detected in recent quarterly data.";
        }

        return {
            stock: symbol,
            currentPrice: price,
            signal,
            urgency,
            action,
            reason
        };

    } catch (error) {
        console.error("Exit Signal Agent Error:", error.message);
        return {
            signal: "HOLD",
            urgency: "LOW",
            action: "Monitor price action manually",
            reason: "Internal logic error in exit signal generation."
        };
    }
}
