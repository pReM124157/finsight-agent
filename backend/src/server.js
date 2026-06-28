import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializePortfolioDefenseAgent } from "./agents/portfolioDefense.agent.js";
import { initializeInfrastructure } from "./services/infrastructure.service.js";
import { startInstitutionalWorkers } from "./workers/index.js";
import { warmupYahooSession } from "./services/marketData.service.js";
import { startBot } from "./services/telegram.service.js";
import {
  getKalshiScannerSchedulerStatus,
  runKalshiScannerOnce,
  startKalshiScannerScheduler,
} from "./kalshi/scheduler/kalshiScannerScheduler.js";
import {
  getPaperSettlementSchedulerStatus,
  runPaperSettlementOnce,
  startPaperSettlementScheduler,
} from "./kalshi/scheduler/paperSettlementScheduler.js";
import { connectMongo } from "./db/mongoClient.js";
import { startDailyHook } from "./scheduler/dailyHook.scheduler.js";
import { startSpikeHook } from "./scheduler/spikeHook.scheduler.js";
import { startPortfolioScheduler } from "./scheduler/portfolio.scheduler.js";
import { startAdaptiveIntelligenceScheduler } from "./scheduler/adaptiveIntelligence.scheduler.js";
import { startRecommendationTrackingScheduler } from "./scheduler/recommendationTracking.scheduler.js";
import { startRecommendationDeliveryScheduler } from "./scheduler/recommendationDelivery.scheduler.js";
import { startPriceAlertScheduler } from "./scheduler/priceAlert.scheduler.js";
import { startSubscriptionLifecycleScheduler } from "./scheduler/subscriptionLifecycle.scheduler.js";
import { startSubscriptionReconciliationScheduler } from "./scheduler/subscriptionReconciliation.scheduler.js";
import { startPublicAnalyticsScheduler } from "./scheduler/publicAnalytics.scheduler.js";
import { startStatisticalValidationScheduler } from "./scheduler/statisticalValidation.scheduler.js";
import { startBacktestingScheduler } from "./scheduler/backtesting.scheduler.js";
import { startMacroReportScheduler } from "./scheduler/macroReport.scheduler.js";
import { buildKalshiPerformanceReport } from "./kalshi/backtest/performanceReportEngine.js";
import {
  getPaperTradingStats,
  LIVE_STRATEGY_NAME,
  PAPER_TRADE_SOURCES,
} from "./kalshi/execution/paperTradingEngine.js";
import { buildPaperRiskLimits, getPaperTradingConfig } from "./kalshi/execution/paperTradingConfig.js";
import { hasSupabaseConfig } from "./services/supabase.service.js";
import app from "./app.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const PORT = process.env.PORT || 5000;
const RENDER_DEMO_MODE = String(process.env.RENDER_DEMO_MODE || "")
  .trim()
  .toLowerCase() === "true";
const paperTradingConfig = getPaperTradingConfig();
const requestedSizeUsd = paperTradingConfig.requestedSizeUsd;
const statusPath = path.resolve(repoRoot, "artifacts", "today-kalshi-paper-session-status.json");
const riskLimits = buildPaperRiskLimits();

console.log("[BOOT CONFIG]", {
  nodeEnv: process.env.NODE_ENV || null,
  renderDemoMode: RENDER_DEMO_MODE,
  rawRenderDemoMode: process.env.RENDER_DEMO_MODE || null
});
let backgroundServicesInitialized = false;
let statusInterval = null;

function writeRuntimeStatus(payload = {}) {
  const dir = path.dirname(statusPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    statusPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        owner: "backend_api",
        pid: process.pid,
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

function buildKalshiRuntimePayload() {
  const today = new Date().toISOString().slice(0, 10);
  const todayStrategyReport = buildKalshiPerformanceReport({
    limit: 10000,
    date: today,
    isStrategyTrade: true,
    tradeSource: PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY,
    strategyName: LIVE_STRATEGY_NAME,
  });

  return {
    stage: "RUNNING",
    today,
    strategySessionId: `PID-${process.pid}`,
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
}

function startRuntimeStatusLoop() {
  const write = () => writeRuntimeStatus(buildKalshiRuntimePayload());

  write();

  if (statusInterval) {
    clearInterval(statusInterval);
  }

  statusInterval = setInterval(write, 60 * 1000);
}

async function startSchedulerSafely(name, starter) {
  try {
    await starter();
    console.log(`✅ Scheduler started: ${name}`);
  } catch (error) {
    console.error(`❌ Scheduler failed to start: ${name}`, error);
  }
}

async function initializeBackgroundServices() {
  if (backgroundServicesInitialized) {
    console.log("[BOOT] Background services already initialized, skipping duplicate startup.");
    return;
  }

  backgroundServicesInitialized = true;

  try {
    const infra = await initializeInfrastructure();
    console.log("[BOOT] Infrastructure initialized", infra);
  } catch (error) {
    console.warn("[BOOT] Infrastructure initialization failed", error?.message || error);
  }

  initializePortfolioDefenseAgent();

  if (!hasSupabaseConfig) {
    console.warn("[BOOT] Supabase env missing, skipping non-Kalshi schedulers and Telegram-dependent background services.");
    return;
  }

  try {
    startInstitutionalWorkers();
    console.log("[BOOT] Institutional workers started");
  } catch (error) {
    console.error("[BOOT] Institutional workers failed to start", error);
  }

  await startSchedulerSafely("daily_hook", startDailyHook);
  await startSchedulerSafely("spike_hook", startSpikeHook);
  await startSchedulerSafely("portfolio", startPortfolioScheduler);
  await startSchedulerSafely("adaptive_intelligence", startAdaptiveIntelligenceScheduler);
  await startSchedulerSafely("recommendation_tracking", startRecommendationTrackingScheduler);
  await startSchedulerSafely("recommendation_delivery", startRecommendationDeliveryScheduler);
  await startSchedulerSafely("price_alert", startPriceAlertScheduler);
  await startSchedulerSafely("subscription_lifecycle", startSubscriptionLifecycleScheduler);
  await startSchedulerSafely("subscription_reconciliation", startSubscriptionReconciliationScheduler);
  await startSchedulerSafely("public_analytics", startPublicAnalyticsScheduler);
  await startSchedulerSafely("statistical_validation", startStatisticalValidationScheduler);
  await startSchedulerSafely("backtesting", startBacktestingScheduler);
  await startSchedulerSafely("macro_report", startMacroReportScheduler);
}

async function warmKalshiRuntime() {
  try {
    const settlementWarmup = await runPaperSettlementOnce();
    console.log("[BOOT] Initial Kalshi settlement complete", {
      reason: settlementWarmup.reason,
      settledTrades: settlementWarmup.settledTrades,
      openTrades: settlementWarmup.openTrades,
    });
  } catch (error) {
    console.error("[BOOT] Initial Kalshi settlement failed", {
      message: error.message,
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

    console.log("[BOOT] Initial Kalshi scan complete", {
      ok: initialScan.ok,
      snapshotsCreated: initialScan.snapshotsCreated,
      paperDecisions: initialScan.paperDecisions,
      errors: initialScan.errors?.length || 0,
    });
  } catch (error) {
    console.error("[BOOT] Initial Kalshi scan failed", {
      message: error.message,
    });
  }
}

async function startServer() {
  try {
    await connectMongo();
  } catch (error) {
    console.warn("[mongo] startup connection failed, continuing without MongoDB:", error.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
    console.log("✅ Health check path / is now responsive.");

    warmKalshiRuntime()
      .finally(() => {
        startKalshiScannerScheduler({
          enabled: true,
          requestedSizeUsd,
          riskLimits,
        });
        startPaperSettlementScheduler({
          enabled: true,
        });
        startRuntimeStatusLoop();
      });

    initializeBackgroundServices().catch((error) => {
      console.error("[BOOT] Background service initialization failed", error);
    });

    if (hasSupabaseConfig && process.env.TELEGRAM_BOT_TOKEN) {
      startBot();
    } else {
      console.warn("[BOOT] Telegram bot skipped: missing Supabase config or TELEGRAM_BOT_TOKEN.");
    }

    warmupYahooSession()
      .then(() => {
        console.log("[BOOT] Yahoo session warmup completed");
      })
      .catch((error) => {
        console.error("[BOOT] Yahoo session warmup failed:", error?.message || error);
      });
  });
}

startServer().catch((error) => {
  console.error("[BOOT] Fatal startup error", error);
  process.exit(1);
});
