import dotenv from "dotenv";
dotenv.config();

import {
  runKalshiScannerOnce,
  getKalshiScannerSchedulerStatus,
} from "../src/kalshi/scheduler/kalshiScannerScheduler.js";
import {
  getSnapshotStats,
  getMarketSnapshots,
} from "../src/kalshi/data/snapshotStore.js";

async function main() {
  console.log("=== Probability OS Scanner Scheduler Test ===");

  console.log("\n[BEFORE STATUS]");
  console.log(JSON.stringify(getKalshiScannerSchedulerStatus(), null, 2));

  const result = await runKalshiScannerOnce({
    limit: 50,
    maxCandidates: 5,
    status: "open",
    dryRun: true,
  });

  console.log("\n[RUN ONCE RESULT]");
  console.log(JSON.stringify({
    ok: result.ok,
    scannedAt: result.scannedAt,
    btc: result.btc,
    totalMarketsFetched: result.totalMarketsFetched,
    btcMarketsFound: result.btcMarketsFound,
    snapshotsCreated: result.snapshotsCreated,
    paperDecisions: result.paperDecisions,
    errors: result.errors,
  }, null, 2));

  console.log("\n[AFTER STATUS]");
  console.log(JSON.stringify(getKalshiScannerSchedulerStatus(), null, 2));

  console.log("\n[SNAPSHOT STATS]");
  console.log(JSON.stringify(getSnapshotStats(), null, 2));

  console.log("\n[LATEST SNAPSHOTS]");
  console.log(JSON.stringify(getMarketSnapshots({ limit: 3 }), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
