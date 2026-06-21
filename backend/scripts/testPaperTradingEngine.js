import dotenv from "dotenv";
dotenv.config();

import { getAggregatedBtcPrice } from "../src/kalshi/data/cryptoPriceClient.js";
import { estimateBtcReachability } from "../src/kalshi/agents/reachabilityEngine.js";
import { calculateMispricing } from "../src/kalshi/agents/mispricingEngine.js";
import {
  createPaperTrade,
  settlePaperTrade,
  getPaperTrades,
  getPaperTradingStats,
} from "../src/kalshi/execution/paperTradingEngine.js";

async function main() {
  console.log("=== Probability OS Paper Trading Test ===");

  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    console.log("BTC aggregator failed:");
    console.log(JSON.stringify(btc, null, 2));
    process.exit(1);
  }

  const current = btc.price;
  const target = current + 100;

  const reachability = estimateBtcReachability({
    currentPrice: current,
    targetPrice: target,
    minutesRemaining: 15,
    annualizedVolatility: 0.55,
    momentumBps: 0,
    marketProbability: 15,
  });

  const mispricing = calculateMispricing({
    marketProbability: 15,
    modelProbability: reachability.modelProbability,
    yesBidPrice: 14,
    yesAskPrice: 16,
    noBidPrice: 83,
    noAskPrice: 86,
    feeBps: 20,
    minEdgePct: 5,
    strongEdgePct: 10,
    maxAllowedSpreadPct: 8,
  });

  console.log("\n[BTC]");
  console.log(JSON.stringify({
    price: current,
    providerCount: btc.providerCount,
  }, null, 2));

  console.log("\n[REACHABILITY]");
  console.log(JSON.stringify(reachability, null, 2));

  console.log("\n[MISPRICING]");
  console.log(JSON.stringify(mispricing, null, 2));

  if (mispricing.decision !== "TRADE") {
    console.log("\n[NO PAPER TRADE CREATED]");
    console.log(`Decision was ${mispricing.decision}, not TRADE.`);
    console.log(JSON.stringify(getPaperTradingStats(), null, 2));
    return;
  }

  const entryProbability =
    mispricing.bestSide === "YES"
      ? mispricing.yes.ask
      : mispricing.no.ask;

  const paperTrade = createPaperTrade({
    marketTicker: "DEMO-BTC-15MIN",
    side: mispricing.bestSide,
    entryProbability,
    modelProbability: reachability.modelProbability,
    marketProbability: mispricing.marketProbability,
    adjustedEdge: mispricing.bestAdjustedEdge,
    rawEdge: mispricing.bestRawEdge,
    btcPrice: current,
    targetPrice: target,
    minutesRemaining: 15,
    confidenceScore: mispricing.confidenceScore,
    notes: "Step 5 validation trade",
  });

  console.log("\n[PAPER TRADE CREATED]");
  console.log(JSON.stringify(paperTrade, null, 2));

  if (paperTrade.ok) {
    const settled = settlePaperTrade({
      tradeId: paperTrade.trade.id,
      won: true,
      settlementPrice: 100,
    });

    console.log("\n[PAPER TRADE SETTLED]");
    console.log(JSON.stringify(settled, null, 2));
  }

  console.log("\n[LATEST PAPER TRADES]");
  console.log(JSON.stringify(getPaperTrades({ limit: 5 }), null, 2));

  console.log("\n[PAPER TRADING STATS]");
  console.log(JSON.stringify(getPaperTradingStats(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
