import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import {
  savePaperTradeMongo,
  updatePaperTradeMongo,
  saveMarketSnapshotMongo,
  saveFeatureSnapshotMongo,
  saveLabeledSnapshotMongo,
  saveStrategyGuardReportMongo,
  saveNoSideShadowAuditMongo,
  saveNoSideShadowReportMongo,
  saveSystemSessionMongo,
  updateSystemSessionMongo,
  getMongoStats,
} from "../src/kalshi/storage/mongoPersistence.js";

async function main() {
  const stamp = Date.now();
  const sessionId = `MONGO_TEST_SESSION_${stamp}`;
  const tradeId = `MONGO_TEST_TRADE_${stamp}`;
  const snapshotId = `MONGO_TEST_SNAPSHOT_${stamp}`;
  const featureId = `MONGO_TEST_FEATURE_${stamp}`;
  const labelId = `MONGO_TEST_LABEL_${stamp}`;
  const reportDate = new Date().toISOString().slice(0, 10);
  const generatedAt = new Date().toISOString();
  const auditId = `MONGO_TEST_AUDIT_${stamp}`;
  const shadowReportGeneratedAt = new Date(Date.now() + 1).toISOString();

  const connection = await connectMongo();
  console.log("[mongo:test] connect", JSON.stringify(connection, null, 2));

  const results = [];
  results.push(await savePaperTradeMongo({
    id: tradeId,
    marketTicker: "MONGO_TEST_BTC",
    tradeSource: "MONGO_TEST",
    isStrategyTrade: false,
    status: "CLOSED",
    pnlUsd: 0,
    createdAt: generatedAt,
  }));
  results.push(await updatePaperTradeMongo(tradeId, {
    status: "WON",
    updatedBy: "MONGO_TEST",
  }));
  results.push(await saveMarketSnapshotMongo({
    id: snapshotId,
    marketTicker: "MONGO_TEST_BTC",
    pipelineVersion: "mongo-test-v1",
    createdAt: generatedAt,
    capturedAt: generatedAt,
    sessionId,
  }));
  results.push(await saveFeatureSnapshotMongo({
    id: featureId,
    snapshot_id: snapshotId,
    market_ticker: "MONGO_TEST_BTC",
    pipeline_version: "mongo-test-v1",
    createdAt: generatedAt,
    captured_at: generatedAt,
  }));
  results.push(await saveLabeledSnapshotMongo({
    id: labelId,
    snapshotId,
    marketTicker: "MONGO_TEST_BTC",
    timestamp: generatedAt,
    label: "YES",
    strategyName: "MONGO_TEST",
  }));
  results.push(await saveStrategyGuardReportMongo({
    reportDate,
    sessionId,
    strategyName: "MONGO_TEST",
    generatedAt,
    verdict: "TEST",
  }));
  results.push(await saveNoSideShadowAuditMongo({
    id: auditId,
    marketTicker: "MONGO_TEST_BTC",
    candidate: false,
    rejectionReason: "MONGO_TEST",
    capturedAt: generatedAt,
    createdAt: generatedAt,
  }));
  results.push(await saveNoSideShadowReportMongo({
    reportDate,
    generatedAt: shadowReportGeneratedAt,
    verdict: "INSUFFICIENT_DATA",
  }));
  results.push(await saveSystemSessionMongo({
    sessionId,
    pid: 99999,
    status: "TESTING",
    startedAt: generatedAt,
  }));
  results.push(await updateSystemSessionMongo(sessionId, {
    status: "COMPLETE",
    endedAt: new Date().toISOString(),
  }));

  console.log("[mongo:test] writes", JSON.stringify(results, null, 2));

  const stats = await getMongoStats();
  console.log("[mongo:test] stats", JSON.stringify(stats, null, 2));

  const disconnected = await disconnectMongo();
  console.log("[mongo:test] disconnect", JSON.stringify(disconnected, null, 2));
}

main().catch(async (error) => {
  console.error("[mongo:test] fatal", error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
