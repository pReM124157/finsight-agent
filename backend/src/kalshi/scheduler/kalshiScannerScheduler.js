import cron from "node-cron";
import { scanKalshiBtcMarkets } from "../agents/marketScanner.js";

let scannerTask = null;
let isRunning = false;
let lastRun = null;
let lastResult = null;
let lastError = null;

export function startKalshiScannerScheduler({
  cronExpression = process.env.KALSHI_SCANNER_CRON || "*/5 * * * *",
  enabled = process.env.KALSHI_SCANNER_ENABLED === "true",
  requestedSizeUsd = Number(process.env.KALSHI_FIXED_TRADE_SIZE_USD || 5),
  riskLimits = null,
} = {}) {
  if (!enabled) {
    console.log("[KALSHI SCANNER SCHEDULER] Disabled");
    return {
      started: false,
      reason: "DISABLED",
    };
  }

  if (scannerTask) {
    return {
      started: false,
      reason: "ALREADY_RUNNING",
    };
  }

  scannerTask = cron.schedule(cronExpression, async () => {
    if (isRunning) {
      console.log("[KALSHI SCANNER SCHEDULER] Previous run still active, skipping");
      return;
    }

    isRunning = true;
    lastRun = new Date().toISOString();

    try {
      console.log("[KALSHI SCANNER SCHEDULER] Scan started");

      const result = await scanKalshiBtcMarkets({
        limit: Number(process.env.KALSHI_SCANNER_MARKET_LIMIT || 50),
        maxCandidates: Number(process.env.KALSHI_SCANNER_MAX_CANDIDATES || 5),
        status: "open",
        dryRun: process.env.KALSHI_SCANNER_DRY_RUN === "true",
        requestedSizeUsd,
        riskLimits,
      });

      lastResult = {
        ok: result.ok,
        scannedAt: result.scannedAt,
        btc: result.btc,
        totalMarketsFetched: result.totalMarketsFetched,
        btcMarketsFound: result.btcMarketsFound,
        snapshotsCreated: result.snapshotsCreated,
        paperDecisions: result.paperDecisions,
        errors: result.errors,
      };
      lastError = null;

      console.log("[KALSHI SCANNER SCHEDULER] Scan completed", lastResult);
    } catch (error) {
      lastError = {
        message: error.message,
        timestamp: new Date().toISOString(),
      };

      console.error("[KALSHI SCANNER SCHEDULER] Scan failed", lastError);
    } finally {
      isRunning = false;
    }
  });

  console.log("[KALSHI SCANNER SCHEDULER] Started", {
    cronExpression,
  });

  return {
    started: true,
    cronExpression,
  };
}

export function stopKalshiScannerScheduler() {
  if (!scannerTask) {
    return {
      stopped: false,
      reason: "NOT_RUNNING",
    };
  }

  scannerTask.stop();
  scannerTask = null;

  return {
    stopped: true,
  };
}

export async function runKalshiScannerOnce(options = {}) {
  if (isRunning) {
    return {
      ok: false,
      reason: "SCAN_ALREADY_RUNNING",
    };
  }

  isRunning = true;
  lastRun = new Date().toISOString();

  try {
    const result = await scanKalshiBtcMarkets(options);

    lastResult = {
      ok: result.ok,
      scannedAt: result.scannedAt,
      btc: result.btc,
      totalMarketsFetched: result.totalMarketsFetched,
      btcMarketsFound: result.btcMarketsFound,
      snapshotsCreated: result.snapshotsCreated,
      paperDecisions: result.paperDecisions,
      errors: result.errors,
    };
    lastError = null;

    return result;
  } catch (error) {
    lastError = {
      message: error.message,
      timestamp: new Date().toISOString(),
    };

    throw error;
  } finally {
    isRunning = false;
  }
}

export function getKalshiScannerSchedulerStatus() {
  return {
    enabled: Boolean(scannerTask),
    isRunning,
    lastRun,
    lastResult,
    lastError,
    cron: process.env.KALSHI_SCANNER_CRON || "*/5 * * * *",
  };
}
