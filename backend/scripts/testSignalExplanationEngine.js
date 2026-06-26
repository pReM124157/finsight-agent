import { getAggregatedBtcPrice } from "../src/kalshi/data/cryptoPriceClient.js";
import { runPaperDecisionFlow } from "../src/kalshi/execution/paperDecisionFlow.js";
import { buildSignalFromDecisionFlowResult } from "../src/kalshi/agents/signalExplanationEngine.js";

async function main() {
  console.log("=== Kalshi Signal Explanation Engine Test ===");

  const btc = await getAggregatedBtcPrice();
  console.log("\n[LIVE BTC]");
  console.log(JSON.stringify(btc, null, 2));

  if (!btc.ok || !Number.isFinite(btc.price)) {
    throw new Error(`BTC fetch failed: ${btc.reason || "UNKNOWN_ERROR"}`);
  }

  const targetPrice = Math.round(btc.price + 100);

  const decision = await runPaperDecisionFlow({
    marketTicker: `SIGNAL-TEST-BTC-${Date.now()}`,
    targetPrice,
    minutesRemaining: 15,
    marketProbability: 15,
    yesBidPrice: 14,
    yesAskPrice: 16,
    noBidPrice: 83,
    noAskPrice: 86,
    annualizedVolatility: 0.55,
    momentumBps: 0,
    feeBps: 20,
    minEdgePct: 5,
    strongEdgePct: 10,
    maxAllowedSpreadPct: 8,
    riskLimits: {
      killSwitchEnabled: false,
    },
    notes: "Signal explanation engine test",
  });

  const signal = buildSignalFromDecisionFlowResult(decision);

  console.log("\n[SIGNAL SUMMARY]");
  console.log(JSON.stringify({
    signalType: signal.signalType,
    headline: signal.headline,
    action: signal.action,
  }, null, 2));

  console.log("\n[STRUCTURED SIGNAL]");
  console.log(JSON.stringify(signal, null, 2));

  console.log("\n[HUMAN MESSAGE]");
  console.log(signal.humanMessage);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
