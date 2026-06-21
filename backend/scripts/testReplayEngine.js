import dotenv from "dotenv";
dotenv.config();

import { runReplayBacktest } from "../src/kalshi/backtest/replayEngine.js";

function buildDemoSnapshots() {
  const base = 64250;

  return [
    {
      id: "S1",
      marketTicker: "DEMO-BTC-15M-1",
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      btcPrice: base,
      targetPrice: base + 100,
      minutesRemaining: 15,
      marketProbability: 15,
      yesBidPrice: 14,
      yesAskPrice: 16,
      noBidPrice: 83,
      noAskPrice: 86,
      actualOutcome: "YES",
    },
    {
      id: "S2",
      marketTicker: "DEMO-BTC-15M-2",
      timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      btcPrice: base,
      targetPrice: base + 750,
      minutesRemaining: 15,
      marketProbability: 20,
      yesBidPrice: 19,
      yesAskPrice: 21,
      noBidPrice: 78,
      noAskPrice: 81,
      actualOutcome: "NO",
    },
    {
      id: "S3",
      marketTicker: "DEMO-BTC-15M-3",
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      btcPrice: base,
      targetPrice: base - 100,
      minutesRemaining: 15,
      marketProbability: 70,
      yesBidPrice: 69,
      yesAskPrice: 71,
      noBidPrice: 28,
      noAskPrice: 31,
      actualOutcome: "NO",
    },
    {
      id: "S4",
      marketTicker: "DEMO-BTC-15M-4",
      timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      btcPrice: base,
      targetPrice: base + 100,
      minutesRemaining: 15,
      marketProbability: 30,
      yesBidPrice: 29,
      yesAskPrice: 31,
      noBidPrice: 68,
      noAskPrice: 71,
      actualOutcome: "YES",
    },
  ];
}

async function main() {
  console.log("=== Probability OS Replay Backtest Test ===");

  const snapshots = buildDemoSnapshots();

  const result = runReplayBacktest({
    snapshots,
    annualizedVolatility: 0.55,
    feeBps: 20,
    minEdgePct: 5,
    strongEdgePct: 10,
    maxAllowedSpreadPct: 8,
    defaultSizeUsd: 25,
    tradeOnly: true,
  });

  console.log("\n[STATS]");
  console.log(JSON.stringify(result.stats, null, 2));

  console.log("\n[TRADES]");
  console.log(JSON.stringify(result.trades, null, 2));

  console.log("\n[DECISION SUMMARY]");
  console.log(JSON.stringify(
    result.decisions.map((d) => ({
      snapshotId: d.snapshotId,
      ticker: d.marketTicker,
      modelProbability: d.reachability?.modelProbability,
      marketProbability: d.mispricing?.marketProbability,
      bestSide: d.mispricing?.bestSide,
      adjustedEdge: d.mispricing?.bestAdjustedEdge,
      decision: d.mispricing?.decision,
      actualOutcome: d.actualOutcome,
    })),
    null,
    2
  ));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
