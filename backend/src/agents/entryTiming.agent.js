// agents/entryTiming.agent.js
import { getLiveMarketData } from "../services/marketData.service.js";
import { safeString, safeSubstring } from "../core/safety.js";

export async function analyzeEntryTiming({
    stock,
    currentPrice,
    confidenceScore,
    riskLevel,
    valuationScore,
    momentumScore,
    technicalData,
    marketData,
    companyData
}) {
    console.log(`[Entry Timing Agent] Received Price for ${stock}: ₹${currentPrice}`);
    
    try {
        // Fix for missing .NS suffix and price fetch fallback
        let activePrice = Number(currentPrice) || 0;
        let fetchSymbol = (stock || "UNKNOWN").toUpperCase();

        if (!fetchSymbol.includes(".NS") && fetchSymbol !== "UNKNOWN") {
            fetchSymbol = `${fetchSymbol}.NS`;
        }

        if (activePrice <= 0 && fetchSymbol !== "UNKNOWN") {
            console.log("Price is 0, attempting recovery fetch for:", fetchSymbol);
            try {
                const liveData = await getLiveMarketData(fetchSymbol);
                activePrice = liveData?.currentPrice || 0;

                if (activePrice <= 0) {
                    console.log("Price fetch failed for:", fetchSymbol);
                }
            } catch (err) {
                console.log("Price fetch failed for:", fetchSymbol);
            }
        }

        // CRITICAL GUARD: Hard block if price is 0
        if (!activePrice || activePrice <= 0) {
          return {
            stock: stock || "UNKNOWN",
            currentPrice: 0,
            strategy: "NO TRADE",
            idealEntryZone: "N/A",
            stopLoss: "-",
            initialTarget: "-",
            rewardRiskRatio: "-",
            entryUrgency: "LOW",
            reasoning: "⚠ Data Unavailable — Skipping technical execution",
            finalExecutionAdvice: "Market data unavailable. Skipping trade setup."
          };
        }

        // Initialize variables
        let strategy = "AVOID ENTRY";
        let idealEntryZone = "Avoid";
        let stopLoss = "-";
        let initialTarget = "-";
        let rewardRiskRatio = "-";
        let entryUrgency = "VERY LOW";
        let reasoning = "Unable to generate reliable entry signal due to missing or invalid market data.";
        let finalExecutionAdvice = "Maintain caution and monitor price action.";

        // Success path safety check
        const generateReasoning = (strategyType) => {
            let reasons = [];
            
            // Technical Reasons
            if (technicalData?.trend === "BULLISH") reasons.push("bullish price structure");
            if (technicalData?.rsi < 40) reasons.push("oversold conditions suggesting a bounce");
            if (technicalData?.rsi > 60) reasons.push("strong relative strength");
            if (activePrice > technicalData?.sma50) reasons.push("trading above 50-day support");
            
            // Market/Volume Reasons
            if (marketData?.volume > marketData?.averageVolume * 1.5) reasons.push("high volume accumulation");
            if (marketData?.fiftyTwoWeekHigh > 0 && activePrice > marketData.fiftyTwoWeekHigh * 0.95) reasons.push("proximity to multi-month breakout");
            
            // Fundamental/Valuation Reasons
            if (valuationScore !== null && valuationScore >= 7) reasons.push("attractive valuation metrics");
            if (companyData?.ProfitMargin !== null && companyData?.ProfitMargin > 0.15) reasons.push("healthy institutional-grade margins");
            if (companyData?.PERatio !== null && companyData?.PERatio > 0 && companyData?.PERatio < 25) reasons.push("reasonable P/E ratio");

            if (reasons.length === 0) {
                return strategyType === "STRONG ENTRY" 
                    ? "High conviction setup based on overall technical alignment."
                    : strategyType === "CAUTIOUS ENTRY"
                    ? "Moderate conviction setup awaiting clearer volume confirmation."
                    : "Balanced setup with limited directional conviction.";
            }

            // Shuffle and pick top 3 for variety
            const selectedReasons = reasons.slice(0, 3);
            const prefix = strategyType === "STRONG ENTRY" ? "Strong setup supported by " : "Strategic entry based on ";
            
            return `${prefix}${selectedReasons.join(", ")}.`.replace(/, ([^,]*)$/, " and $1");
        };

        if (activePrice > 0) {
            if (confidenceScore <= 4) {
                strategy = "AVOID ENTRY";
                entryUrgency = "VERY LOW";
                idealEntryZone = "Avoid";
                reasoning = "Weak setup with poor conviction and elevated uncertainty.";
                finalExecutionAdvice = "Avoid entry. Look for better opportunities elsewhere.";
            }
            else if (confidenceScore <= 6) {
                strategy = "CAUTIOUS ENTRY";
                entryUrgency = "MEDIUM";

                const lower = Math.round(activePrice * 0.97);
                const upper = Math.round(activePrice * 1.01);

                idealEntryZone = `₹${lower} – ₹${upper}`;
                stopLoss = `₹${Math.round(activePrice * 0.94)}`;
                initialTarget = `₹${Math.round(activePrice * 1.10)}`;
                
                const reward = Math.round(activePrice * 1.10) - activePrice;
                const risk = activePrice - Math.round(activePrice * 0.94);
                if (risk > 0) rewardRiskRatio = (reward / risk).toFixed(2);

                reasoning = generateReasoning("CAUTIOUS ENTRY");
                finalExecutionAdvice = `Accumulate gradually near ${idealEntryZone} with strict stop loss.`;
            }
            else {
                strategy = "STRONG ENTRY";
                entryUrgency = "HIGH";

                const lower = Math.round(activePrice * 0.98);
                const upper = Math.round(activePrice * 1.02);

                idealEntryZone = `₹${lower} – ₹${upper}`;
                stopLoss = `₹${Math.round(activePrice * 0.95)}`;
                initialTarget = `₹${Math.round(activePrice * 1.15)}`;

                const reward = Math.round(activePrice * 1.15) - activePrice;
                const risk = activePrice - Math.round(activePrice * 0.95);
                if (risk > 0) rewardRiskRatio = (reward / risk).toFixed(2);

                reasoning = generateReasoning("STRONG ENTRY");
                finalExecutionAdvice = `Strong buy opportunity. Consider entry within ${idealEntryZone}.`;
            }
        }

        console.log("--- ENTRY TIMING DEBUG ---");
        console.log("SYMBOL:", fetchSymbol);
        console.log("CURRENT PRICE:", activePrice);
        const safeMarket = safeString(JSON.stringify(marketData));
        console.log("MARKET DATA:", safeSubstring(safeMarket, 200));
        console.log("--------------------------");

        return {
            stock: stock || "UNKNOWN",
            currentPrice: activePrice,
            strategy,
            idealEntryZone,
            stopLoss,
            initialTarget,
            rewardRiskRatio,
            entryUrgency,
            reasoning,
            finalExecutionAdvice
        };

    } catch (error) {
        console.error("Entry Timing Agent Error:", error.message);
        return {
            stock: stock || "UNKNOWN",
            strategy: "AVOID ENTRY",
            currentPrice: 0,
            idealEntryZone: "Avoid",
            stopLoss: "-",
            initialTarget: "-",
            rewardRiskRatio: "-",
            entryUrgency: "VERY LOW",
            reasoning: "Unable to generate reliable entry signal due to internal agent error.",
            finalExecutionAdvice: "Maintain caution and monitor price action."
        };
    }
}
