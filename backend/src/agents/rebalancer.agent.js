/**
 * agents/rebalancer.agent.js
 * Sophisticated portfolio rebalancing agent that manages weight adjustments
 * based on conviction, target drift, and risk concentration.
 */

export async function analyzeRebalancing({
    stock,
    actualAllocation = 0,    // Current % in portfolio
    targetAllocation = 0,    // Conviction-adjusted target %
    sectorExposure = 0,      // Current % in this sector
    convictionScore = 5,     // 1-10
    exitSignal = "HOLD",     // From exitSignal agent
    riskConcentration = 5    // 1-10
}) {
    try {
        const symbol = (stock || "UNKNOWN").toUpperCase();
        const actual = Number(actualAllocation) || 0;
        const target = Number(targetAllocation) || 0;
        const drift = actual - target;

        let action = "HOLD";
        let adjustment = "0%";
        let urgency = "LOW";
        let reason = "Current allocation is aligned with target weight.";

        // 1. Critical Exit Check
        if (exitSignal === "STOP LOSS EXIT" || exitSignal === "FULL EXIT") {
            action = "EXIT COMPLETELY";
            adjustment = `-${actual}%`;
            urgency = "CRITICAL";
            reason = `Exit signal triggered (${exitSignal}). Immediate full liquidation required.`;
            return { action, adjustment, urgency, reason };
        }

        // 2. Significant Overweight / Target Drift Down
        if (drift > 5) {
            action = "REDUCE POSITION";
            adjustment = `-${Math.round(drift)}%`;
            urgency = "HIGH";
            reason = `Position is significantly overweight by ${drift.toFixed(1)}%. Trimming to target weight.`;
        }
        // 3. Significant Underweight / Target Drift Up
        else if (drift < -3 && exitSignal === "HOLD") {
            action = "INCREASE POSITION";
            adjustment = `+${Math.round(Math.abs(drift))}%`;
            urgency = "MEDIUM";
            reason = `Position is underweight relative to high-conviction target of ${target}%.`;
        }
        // 4. Sector Concentration Rebalance
        else if (sectorExposure > 30 && actual > 10) {
            action = "SECTOR REBALANCE";
            adjustment = "-3%";
            urgency = "MEDIUM";
            reason = `Sector exposure (${sectorExposure}%) is nearing institutional limits. Trimming to reduce systemic risk.`;
        }
        // 5. Tactical Trim (Partial Profit Booking)
        else if (exitSignal === "PARTIAL PROFIT BOOKING" || exitSignal === "TRIM POSITION") {
            action = "TRIM POSITION";
            adjustment = `-${Math.round(actual * 0.25)}%`;
            urgency = "HIGH";
            reason = `Tactical trim initiated by ${exitSignal} to secure gains or reduce exposure.`;
        }
        // 6. Maintenance
        else if (Math.abs(drift) > 1 && Math.abs(drift) <= 3) {
            action = "MAINTAIN CURRENT ALLOCATION";
            adjustment = "0%";
            urgency = "LOW";
            reason = "Minor drift detected, but remains within acceptable tolerance levels.";
        }

        return {
            stock: symbol,
            action,
            adjustment,
            urgency,
            reason,
            targetWeight: `${target}%`,
            actualWeight: `${actual}%`
        };

    } catch (error) {
        console.error("Rebalancer Agent Error:", error.message);
        return {
            action: "HOLD",
            adjustment: "0%",
            urgency: "LOW",
            reason: "Standard maintenance due to internal rebalancing logic error."
        };
    }
}
