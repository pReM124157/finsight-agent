/**
 * eventRisk.agent.js
 * Analyzes upcoming corporate and macro events to determine event-based risk.
 * Even strong BUY setups may be paused if high-impact events are imminent.
 */
export async function analyzeEventRisk({
    symbol,
    earningsDate, // Date object or timestamp
    macroEvents = [] // Future placeholder for macro integration
}) {
    try {
        if (!earningsDate) {
            return {
                eventRisk: "LOW",
                eventType: "NONE",
                daysRemaining: 99,
                action: "No major imminent events detected.",
                reason: "Normal market conditions apply. No upcoming earnings in the immediate window."
            };
        }

        const now = new Date();
        const eventDate = new Date(earningsDate);
        const timeDiff = eventDate - now;
        const daysRemaining = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        let eventRisk = "LOW";
        let action = "Monitor as usual";
        let reason = `Upcoming earnings in ${daysRemaining} days.`;

        // RULE: High risk if event is within 3 days
        if (daysRemaining >= 0 && daysRemaining <= 3) {
            eventRisk = "HIGH";
            action = "Avoid fresh entry before event clarity";
            reason = `Quarterly earnings in ${daysRemaining} days may create major volatility and gap risk. Focus on protection.`;
        } 
        // RULE: Medium risk if within 7 days
        else if (daysRemaining > 3 && daysRemaining <= 7) {
            eventRisk = "MEDIUM";
            action = "Cautious entry only. Small sizing.";
            reason = `Earnings approaching in ${daysRemaining} days. Expect volatility expansion.`;
        }

        // Handle past events (same day or very recent)
        if (daysRemaining === 0) {
            eventRisk = "CRITICAL";
            action = "Wait for post-event guidance";
            reason = "Earnings event today. Market awaiting management commentary. Extreme volatility expected.";
        }

        return {
            eventRisk,
            eventType: "EARNINGS RESULT",
            daysRemaining,
            action,
            reason
        };

    } catch (error) {
        console.error("Event Risk Agent Error:", error.message);
        return {
            eventRisk: "LOW",
            eventType: "UNKNOWN",
            daysRemaining: 99,
            action: "Normal monitoring",
            reason: "Insufficient event data."
        };
    }
}
