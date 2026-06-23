import dotenv from "dotenv";
dotenv.config();

import {
  addRealTrade,
  getRealTrades,
  getRealTradeStats,
} from "../src/kalshi/dataset/realTradeDataset.js";

async function main() {
  const added = addRealTrade({
    source: "MANUAL",
    marketTicker: "DEMO-REAL-BTC-15MIN",
    contractTitle: "BTC 15 min - $63099.69 target",
    targetPrice: 63099.69,
    entryBtcPrice: 62980.5,
    entryTime: new Date().toISOString(),
    settlementTime: new Date().toISOString(),
    minutesRemainingAtEntry: 4,
    sideTaken: "NO",
    marketProbabilityAtEntry: 75,
    noPriceAtEntry: 75,
    yesPriceAtEntry: 25,
    costUsd: 14.92,
    payoutUsd: 19.43,
    outcome: "WON",
    settledSide: "NO",
    notes: "Demo manual real-trade dataset record",
  });

  console.log("[ADDED REAL TRADE]");
  console.log(JSON.stringify(added, null, 2));

  console.log("\n[LATEST REAL TRADES]");
  console.log(JSON.stringify(getRealTrades({ limit: 5 }), null, 2));

  console.log("\n[REAL TRADE STATS]");
  console.log(JSON.stringify(getRealTradeStats(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
