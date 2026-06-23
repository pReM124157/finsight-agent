import dotenv from "dotenv";
dotenv.config();

import { scanKalshiBtcMarkets } from "../src/kalshi/agents/marketScanner.js";
import {
  getMarketSnapshots,
  getSnapshotStats,
} from "../src/kalshi/data/snapshotStore.js";
import { getPaperTradingStats } from "../src/kalshi/execution/paperTradingEngine.js";

async function main() {
  console.log("=== Probability OS Market Scanner Test ===");

  const result = await scanKalshiBtcMarkets({
    limit: 50,
    maxCandidates: 5,
    status: "open",
    dryRun: true,
  });

  console.log("\n[SCAN RESULT]");
  console.log(JSON.stringify({
    ok: result.ok,
    mode: result.mode,
    scannedAt: result.scannedAt,
    btc: result.btc,
    totalMarketsFetched: result.totalMarketsFetched,
    btcMarketsFound: result.btcMarketsFound,
    snapshotsCreated: result.snapshotsCreated,
    paperDecisions: result.paperDecisions,
    errors: result.errors,
    marketClassificationSample: result.marketClassificationSample,
    classificationDebug: result.classificationDebug,
  }, null, 2));

  console.log("\n[SNAPSHOT STATS]");
  console.log(JSON.stringify(getSnapshotStats(), null, 2));

  console.log("\n[LATEST SNAPSHOTS]");
  console.log(JSON.stringify(getMarketSnapshots({ limit: 5 }), null, 2));

  console.log("\n[PAPER STATS]");
  console.log(JSON.stringify(getPaperTradingStats(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
