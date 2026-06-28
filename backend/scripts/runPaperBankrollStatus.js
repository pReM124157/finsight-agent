import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectMongo, disconnectMongo } from "../src/db/mongoClient.js";
import { FeatureSnapshot, MarketSnapshot, PaperTrade } from "../src/kalshi/models/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const CLEAN_PIPELINE_START = "2026-06-26T00:00:00.000Z";

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatUsd(value) {
  const numeric = safeNumber(value, 0);
  const prefix = numeric < 0 ? "-" : "";
  return `${prefix}$${Math.abs(numeric).toFixed(2)}`;
}

function formatPct(value) {
  return `${safeNumber(value, 0).toFixed(1)}%`;
}

function formatSignedUsd(value) {
  const numeric = safeNumber(value, 0);
  const sign = numeric > 0 ? "+" : numeric < 0 ? "-" : "";
  return `${sign}$${Math.abs(numeric).toFixed(2)}`;
}

function getUtcDayRange(date = new Date()) {
  const isoDate = new Date(date).toISOString().slice(0, 10);
  return {
    start: new Date(`${isoDate}T00:00:00.000Z`),
    end: new Date(`${isoDate}T23:59:59.999Z`),
  };
}

function buildSummary(trades = [], startingBankrollUsd = 50) {
  const settledTrades = trades.filter((trade) => trade.status === "WON" || trade.status === "LOST");
  const openTrades = trades.filter((trade) => trade.status === "OPEN");
  const wins = settledTrades.filter((trade) => trade.status === "WON").length;
  const losses = settledTrades.filter((trade) => trade.status === "LOST").length;
  const totalStaked = trades.reduce((sum, trade) => sum + safeNumber(trade.costUsd), 0);
  const netPnl = settledTrades.reduce((sum, trade) => sum + safeNumber(trade.pnlUsd), 0);
  const winRate = settledTrades.length ? (wins / settledTrades.length) * 100 : 0;

  return {
    startingBankrollUsd,
    totalTrades: trades.length,
    openTrades: openTrades.length,
    settledTrades: settledTrades.length,
    wins,
    losses,
    netPnl,
    currentBankroll: startingBankrollUsd + netPnl,
    winRate,
  };
}

function printBankrollSection(title, summary) {
  console.log(title);
  console.log(`Starting bankroll:   ${formatUsd(summary.startingBankrollUsd)}`);
  console.log(`Trades:              ${summary.settledTrades} settled, ${summary.openTrades} open`);
  console.log(`Win rate:            ${formatPct(summary.winRate)}`);
  console.log(`Net P&L:             ${formatSignedUsd(summary.netPnl)}`);
  console.log(`Current bankroll:    ${formatUsd(summary.currentBankroll)}`);
}

async function main() {
  const startingBankrollUsd = Math.max(1, safeNumber(process.env.PAPER_BANKROLL_USD, 50));
  const connection = await connectMongo();
  const cleanPipelineStart = new Date(CLEAN_PIPELINE_START);
  const todayRange = getUtcDayRange();

  console.log("=== PAPER BANKROLL STATUS ===");

  if (!connection.ok) {
    console.log(`MongoDB unavailable: ${connection.reason || connection.error || "UNKNOWN"}`);
    process.exit(1);
  }

  const [allTrades, cleanTrades, cleanStrategyTrades, legacyTradeCount, scansToday, strategyZoneHitsToday, todayTrades] =
    await Promise.all([
      PaperTrade.find({}).sort({ openedAt: 1, createdAt: 1 }).lean(),
      PaperTrade.find({ createdAt: { $gte: cleanPipelineStart } }).sort({ openedAt: 1, createdAt: 1 }).lean(),
      PaperTrade.find({
        createdAt: { $gte: cleanPipelineStart },
        isStrategyTrade: true,
      }).sort({ openedAt: 1, createdAt: 1 }).lean(),
      PaperTrade.countDocuments({ createdAt: { $lt: cleanPipelineStart } }),
      MarketSnapshot.countDocuments({
        createdAt: { $gte: todayRange.start, $lte: todayRange.end },
      }),
      FeatureSnapshot.countDocuments({
        createdAt: { $gte: todayRange.start.toISOString(), $lte: todayRange.end.toISOString() },
        minutes_remaining: { $gte: 8, $lte: 12 },
        yes_ask: { $gte: 60, $lt: 95 },
        adjustedYesEdge: { $gte: 6, $lte: 10 },
      }),
      PaperTrade.find({
        createdAt: { $gte: todayRange.start, $lte: todayRange.end },
      }).lean(),
    ]);

  const cleanSummary = buildSummary(cleanTrades, startingBankrollUsd);
  const cleanStrategySummary = buildSummary(cleanStrategyTrades, startingBankrollUsd);
  const todaySettledTrades = todayTrades.filter((trade) => trade.status === "WON" || trade.status === "LOST");
  const todayWins = todaySettledTrades.filter((trade) => trade.status === "WON").length;
  const todayLosses = todaySettledTrades.filter((trade) => trade.status === "LOST").length;

  printBankrollSection(`--- Since clean pipeline (${CLEAN_PIPELINE_START.slice(0, 10)}+) ---`, cleanSummary);
  console.log("");
  console.log(`--- Strategy zone only (60-95c, isStrategyTrade=true, ${CLEAN_PIPELINE_START.slice(0, 10)}+) ---`);
  console.log(`Trades:              ${cleanStrategySummary.settledTrades} settled, ${cleanStrategySummary.openTrades} open`);
  console.log(`Win rate:            ${formatPct(cleanStrategySummary.winRate)}`);
  console.log(`Net P&L:             ${formatSignedUsd(cleanStrategySummary.netPnl)}`);
  console.log("");
  console.log(`--- Legacy trades (before ${CLEAN_PIPELINE_START.slice(0, 10)}, excluded from bankroll) ---`);
  console.log(`Count:               ${legacyTradeCount} trades`);
  console.log("Note:                excluded from bankroll calculation");
  console.log("");
  console.log("--- All time ---");
  console.log(`Trades:              ${buildSummary(allTrades, startingBankrollUsd).settledTrades} settled, ${buildSummary(allTrades, startingBankrollUsd).openTrades} open`);
  console.log(`Win rate:            ${formatPct(buildSummary(allTrades, startingBankrollUsd).winRate)}`);
  console.log(`Net P&L:             ${formatSignedUsd(buildSummary(allTrades, startingBankrollUsd).netPnl)}`);
  console.log(`Current bankroll:    ${formatUsd(buildSummary(allTrades, startingBankrollUsd).currentBankroll)}`);
  console.log("");
  console.log("--- Today's activity ---");
  console.log(`Scans today:         ${scansToday}`);
  console.log(`Strategy zone hits:  ${strategyZoneHitsToday}`);
  console.log(`Trades entered:      ${todayTrades.length}`);
  console.log(`Trades settled:      ${todaySettledTrades.length} (${todayWins} wins, ${todayLosses} losses)`);

  await disconnectMongo();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
