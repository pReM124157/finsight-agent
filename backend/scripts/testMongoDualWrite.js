import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import { getMongoStats } from "../src/kalshi/storage/mongoPersistence.js";
import { createPaperTrade } from "../src/kalshi/execution/paperTradingEngine.js";
import { saveMarketSnapshot } from "../src/kalshi/data/snapshotStore.js";
import { appendFeatureSnapshot } from "../src/kalshi/data/featureSnapshotStore.js";
import { addLabeledSnapshot } from "../src/kalshi/dataset/labeledSnapshotDataset.js";
import { appendNoSideShadowAudit } from "../src/kalshi/shadow/noSideShadowAudit.js";
import { saveStrategyGuardDailyReport } from "../src/kalshi/reporting/strategyReportStore.js";
import { saveNoSideShadowReport } from "../src/kalshi/reporting/noSideShadowReportStore.js";

async function main() {
  const stamp = Date.now();
  const baseId = `MONGO_DUAL_WRITE_TEST_${stamp}`;
  const connected = await connectMongo();
  console.log("[mongo:dual-write] connect", JSON.stringify(connected, null, 2));

  const paperTrade = createPaperTrade({
    marketTicker: `${baseId}_BTC`,
    side: "YES",
    entryProbability: 40,
    modelProbability: 55,
    marketProbability: 39,
    adjustedEdge: 12,
    rawEdge: 13,
    btcPrice: 60000,
    targetPrice: 60050,
    minutesRemaining: 5,
    confidenceScore: 80,
    sizeUsd: 5,
    source: "MONGO_DUAL_WRITE_TEST",
    notes: baseId,
    tradeSource: "MONGO_DUAL_WRITE_TEST",
    strategyName: "MONGO_DUAL_WRITE_TEST",
    isStrategyTrade: false,
  });

  const marketSnapshot = saveMarketSnapshot({
    id: `${baseId}_SNAP`,
    marketTicker: `${baseId}_BTC`,
    createdAt: new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    decision: { action: "TEST" },
  });

  const featureSnapshot = appendFeatureSnapshot({
    id: `${baseId}_FEAT`,
    snapshot_id: marketSnapshot.id,
    market_ticker: `${baseId}_BTC`,
    pipeline_version: "dual-write-test-v1",
    captured_at: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  const labeledSnapshot = addLabeledSnapshot({
    id: `${baseId}_LABEL`,
    snapshotId: featureSnapshot.snapshot_id,
    marketTicker: `${baseId}_BTC`,
    timestamp: new Date().toISOString(),
    label: "YES",
  });

  const shadowAudit = appendNoSideShadowAudit({
    id: `${baseId}_AUDIT`,
    marketTicker: `${baseId}_BTC`,
    candidate: false,
    rejectionReason: "MONGO_DUAL_WRITE_TEST",
    capturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  const strategyReport = saveStrategyGuardDailyReport({
    date: new Date().toISOString().slice(0, 10),
    reportDate: new Date().toISOString().slice(0, 10),
    sessionId: `${baseId}_SESSION`,
    strategyName: "MONGO_DUAL_WRITE_TEST",
    generatedAt: new Date().toISOString(),
    verdict: "TEST",
  });

  const noSideShadowReport = saveNoSideShadowReport({
    reportDate: new Date().toISOString().slice(0, 10),
    generatedAt: new Date(Date.now() + 1).toISOString(),
    verdict: "TEST",
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const stats = await getMongoStats();
  console.log("[mongo:dual-write] results", JSON.stringify({
    paperTrade,
    marketSnapshot,
    featureSnapshot,
    labeledSnapshot,
    shadowAudit,
    strategyReport,
    noSideShadowReport,
    stats,
  }, null, 2));

  const disconnected = await disconnectMongo();
  console.log("[mongo:dual-write] disconnect", JSON.stringify(disconnected, null, 2));
}

main().catch(async (error) => {
  console.error("[mongo:dual-write] fatal", error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
