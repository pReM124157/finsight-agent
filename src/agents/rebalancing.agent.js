export async function rebalancingAgent({ finalDecision, suggestedAllocation }) {
  try {
    let action = "Hold Position";
    let rebalancingAction = "No rebalancing required";

    if (finalDecision.includes("BUY")) {
      action = "Accumulate aggressively";
      rebalancingAction = `Increase position to target ${suggestedAllocation} allocation`;
    } else if (finalDecision.includes("SELL")) {
      action = "Reduce exposure";
      rebalancingAction = "Exit or trim position to protect capital";
    } else {
      action = "Monitor closely";
      rebalancingAction = `Maintain current position with ${suggestedAllocation} target`;
    }

    return {
      rebalancingAction,
      action
    };
  } catch (error) {
    console.error("Rebalancing Agent Error:", error.message);
    return {
      rebalancingAction: "Unable to calculate rebalancing",
      action: "Hold"
    };
  }
}

export function runRebalancingAgent(portfolio) {
  let suggestions = [];

  if (portfolio.healthScore < 5) {
    suggestions.push("Reduce concentration in dominant sector");
  }

  if (portfolio.dominantSector === "IT") {
    suggestions.push("Add Banking, Pharma, FMCG for diversification");
  }

  if (portfolio.topAllocation > 40) {
    suggestions.push("Trim highest allocation stock below 25%");
  }

  if (suggestions.length === 0) {
    suggestions.push("Portfolio is well balanced");
  }

  return {
    rebalancingAdvice: suggestions
  };
}