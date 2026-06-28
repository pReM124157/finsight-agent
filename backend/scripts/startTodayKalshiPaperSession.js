import dotenv from "dotenv";
import {
  runKalshiScannerOnce,
  startKalshiScannerScheduler,
  getKalshiScannerSchedulerStatus,
} from "../src/kalshi/scheduler/kalshiScannerScheduler.js";
import {
  runPaperSettlementOnce,
  startPaperSettlementScheduler,
  getPaperSettlementSchedulerStatus,
} from "../src/kalshi/scheduler/paperSettlementScheduler.js";
import { buildKalshiPerformanceReport } from "../src/kalshi/backtest/performanceReportEngine.js";
import {
  getPaperTradingStats,
  LIVE_STRATEGY_NAME,
  PAPER_TRADE_SOURCES,
} from "../src/kalshi/execution/paperTradingEngine.js";
import { buildPaperRiskLimits, getPaperTradingConfig } from "../src/kalshi/execution/paperTradingConfig.js";
import { connectMongo } from "../src/db/mongoClient.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const paperTradingConfig = getPaperTradingConfig();
const requestedSizeUsd = paperTradingConfig.requestedSizeUsd;
const strategySessionId = process.env.KALSHI_ACTIVE_SESSION_ID || `PID-${process.pid}`;
const riskLimits = buildPaperRiskLimits();
const statusPath = path.resolve(repoRoot, "artifacts", "today-kalshi-paper-session-status.json");

function writeStatus(payload = {}) {
  const dir = path.dirname(statusPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    statusPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        requestedSizeUsd,
        paperTradingConfig,
        ...payload,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  console.log("[TODAY PAPER SESSION] Starting", {
    today,
    requestedSizeUsd,
    strategySessionId,
    strategyName: LIVE_STRATEGY_NAME,
    scannerCron: process.env.KALSHI_SCANNER_CRON || "*/5 * * * *",
    settlementCron: process.env.KALSHI_SETTLEMENT_CRON || "* * * * *",
  });
  writeStatus({
    stage: "STARTING",
    today,
    strategySessionId,
    strategyName: LIVE_STRATEGY_NAME,
  });

  try {
    const mongoResult = await connectMongo();
    console.log("[TODAY PAPER SESSION] Mongo startup", mongoResult);
  } catch (error) {
    console.warn("[TODAY PAPER SESSION] Mongo startup failed, continuing without MongoDB", {
      message: error.message,
    });
  }

  try {
    const settlementWarmup = await runPaperSettlementOnce();
    console.log("[TODAY PAPER SESSION] Initial settlement run complete", {
      reason: settlementWarmup.reason,
      settledTrades: settlementWarmup.settledTrades,
      openTrades: settlementWarmup.openTrades,
    });
  } catch (error) {
    console.error("[TODAY PAPER SESSION] Initial settlement run failed", {
      message: error.message,
    });
    writeStatus({
      stage: "SETTLEMENT_WARMUP_FAILED",
      today,
      error: error.message,
    });
  }

  try {
    const initialScan = await runKalshiScannerOnce({
      limit: Number(process.env.KALSHI_SCANNER_MARKET_LIMIT || 50),
      maxCandidates: Number(process.env.KALSHI_SCANNER_MAX_CANDIDATES || 5),
      status: "open",
      dryRun: false,
      requestedSizeUsd,
      riskLimits,
    });

    console.log("[TODAY PAPER SESSION] Initial scan complete", {
      ok: initialScan.ok,
      snapshotsCreated: initialScan.snapshotsCreated,
      paperDecisions: initialScan.paperDecisions,
      errors: initialScan.errors?.length || 0,
    });
  } catch (error) {
    console.error("[TODAY PAPER SESSION] Initial scan failed", {
      message: error.message,
    });
    writeStatus({
      stage: "INITIAL_SCAN_FAILED",
      today,
      error: error.message,
    });
  }

  const scanner = startKalshiScannerScheduler({
    enabled: true,
    requestedSizeUsd,
    riskLimits,
  });

  const settlement = startPaperSettlementScheduler({
    enabled: true,
  });

  console.log("[TODAY PAPER SESSION] Schedulers", {
    scanner,
    settlement,
    scannerStatus: getKalshiScannerSchedulerStatus(),
    settlementStatus: getPaperSettlementSchedulerStatus(),
  });

  const logSummary = () => {
    const todayStrategyReport = buildKalshiPerformanceReport({
      limit: 10000,
      date: today,
      isStrategyTrade: true,
      tradeSource: PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY,
      strategyName: LIVE_STRATEGY_NAME,
    });
    const payload = {
      timestamp: new Date().toISOString(),
      strategySessionId,
      strategyName: LIVE_STRATEGY_NAME,
      stats: getPaperTradingStats({
        isStrategyTrade: true,
        tradeSource: PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY,
        strategyName: LIVE_STRATEGY_NAME,
      }),
      lifetimeLedgerStats: getPaperTradingStats(),
      legacyTestStats: getPaperTradingStats({
        tradeSource: PAPER_TRADE_SOURCES.LEGACY_TEST,
      }),
      manualTestStats: getPaperTradingStats({
        tradeSource: PAPER_TRADE_SOURCES.MANUAL_TEST,
      }),
      liveGuardedStrategyStats: getPaperTradingStats({
        isStrategyTrade: true,
        tradeSource: PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY,
        strategyName: LIVE_STRATEGY_NAME,
      }),
      todaySummary: todayStrategyReport.summary,
      dailyTable: todayStrategyReport.dailyTable,
      scannerStatus: getKalshiScannerSchedulerStatus(),
      settlementStatus: getPaperSettlementSchedulerStatus(),
    };
    console.log("[TODAY PAPER SESSION] Progress", payload);
    writeStatus({
      stage: "RUNNING",
      today,
      ...payload,
    });
  };

  logSummary();
  setInterval(logSummary, 60 * 1000);
}

process.on("uncaughtException", (error) => {
  console.error("[TODAY PAPER SESSION] Uncaught exception", error);
  writeStatus({
    stage: "CRASHED",
    error: error.message,
  });
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[TODAY PAPER SESSION] Unhandled rejection", error);
  writeStatus({
    stage: "CRASHED",
    error: message,
  });
  process.exit(1);
});

main().catch((error) => {
  console.error("[TODAY PAPER SESSION] Fatal error", error);
  writeStatus({
    stage: "FATAL",
    error: error.message,
  });
  process.exit(1);
});
