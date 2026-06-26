import dotenv from "dotenv";

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import { getMongoStats } from "../src/kalshi/storage/mongoPersistence.js";

dotenv.config();

function latestId(record) {
  return record?.id || record?._id?.toString() || "none";
}

async function main() {
  const connection = await connectMongo();

  if (!connection.ok) {
    console.log(`MongoDB connected: no`);
    console.log(`Reason: ${connection.reason || connection.error || "UNKNOWN"}`);
    process.exit(1);
  }

  const stats = await getMongoStats();
  if (!stats.ok) {
    console.log(`MongoDB connected: no`);
    console.log(`Reason: ${stats.reason || stats.error || "UNKNOWN"}`);
    await disconnectMongo();
    process.exit(1);
  }

  console.log("MongoDB connected: yes");
  console.log(`Database: ${stats.state.dbName || "unknown"}`);
  console.log("Counts:");
  console.log(`paper_trades: ${stats.counts.paperTrades}`);
  console.log(`market_snapshots: ${stats.counts.marketSnapshots}`);
  console.log(`feature_snapshots: ${stats.counts.featureSnapshots}`);
  console.log(`labeled_snapshots: ${stats.counts.labeledSnapshots}`);
  console.log(`strategy_guard_reports: ${stats.counts.strategyGuardReports}`);
  console.log(`no_side_shadow_audits: ${stats.counts.noSideShadowAudits}`);
  console.log(`no_side_shadow_reports: ${stats.counts.noSideShadowReports}`);
  console.log(`system_sessions: ${stats.counts.systemSessions}`);
  console.log("Latest:");
  console.log(`paper_trade: ${latestId(stats.latest.paperTrade)}`);
  console.log(`feature_snapshot: ${latestId(stats.latest.featureSnapshot)}`);
  console.log(`strategy_guard_report: ${latestId(stats.latest.strategyGuardReport)}`);
  console.log(`no_side_shadow_audit: ${latestId(stats.latest.noSideShadowAudit)}`);

  await disconnectMongo();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
