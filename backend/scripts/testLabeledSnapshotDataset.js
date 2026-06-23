import dotenv from "dotenv";
dotenv.config();

import {
  addLabeledSnapshot,
  buildFeatureRowFromSnapshot,
  getLabeledSnapshotStats,
  labelSnapshot,
} from "../src/kalshi/dataset/labeledSnapshotDataset.js";

async function main() {
  const fakeSnapshot = {
    id: `SNAP-DEMO-${Date.now()}`,
    marketTicker: "DEMO-SNAPSHOT-BTC-15MIN",
    createdAt: new Date().toISOString(),
    btcPrice: 62980.5,
    targetPrice: 63099.69,
    minutesRemaining: 4,
    implied: {
      marketProbability: 75,
      yesBid: 24,
      yesAsk: 26,
      noBid: 74,
      noAsk: 76,
    },
    reachability: {
      modelProbability: 22,
      annualizedVolatility: 0.55,
      momentumBps: 0,
    },
    mispricing: {
      yes: { adjustedEdge: -3, spread: 2 },
      no: { adjustedEdge: 3, spread: 2 },
      bestSide: "NO",
      bestAdjustedEdge: 3,
    },
    decision: {
      bestSide: "NO",
      bestAdjustedEdge: 3,
      action: "OBSERVATION_ONLY",
    },
  };

  const featureRow = buildFeatureRowFromSnapshot(fakeSnapshot);
  console.log("[FEATURE ROW]");
  console.log(JSON.stringify(featureRow, null, 2));

  const added = addLabeledSnapshot(featureRow);
  console.log("\n[ADDED LABELED SNAPSHOT]");
  console.log(JSON.stringify(added, null, 2));

  const labeled = labelSnapshot({
    snapshotId: featureRow.snapshotId,
    settlementBtcPrice: 63110.12,
    settlementTime: new Date().toISOString(),
  });
  console.log("\n[LABELED SNAPSHOT]");
  console.log(JSON.stringify(labeled, null, 2));

  console.log("\n[LABELED SNAPSHOT STATS]");
  console.log(JSON.stringify(getLabeledSnapshotStats(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
