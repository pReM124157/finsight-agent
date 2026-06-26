import cron from "node-cron";

import { getAggregatedBtcPrice } from "../data/cryptoPriceClient.js";
import { getValidSnapshots } from "../data/featureSnapshotStore.js";
import {
  getPaperTrades,
  getPaperTradingStats,
} from "../execution/paperTradingEngine.js";
import { settleMarketArtifactsByBtcPrice } from "../execution/settlementEngine.js";

let schedulerTask = null;
let isRunning = false;
let lastRun = null;
let lastResult = null;
let lastError = null;

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isTradeExpired(trade) {
  return isRecordExpired(trade?.openedAt, trade?.minutesRemaining, 15);
}

function isRecordExpired(timestamp, minutes, fallbackMinutes = 15) {
  const openedAtMs = new Date(timestamp).getTime();
  const resolvedMinutes = safeNumber(minutes, fallbackMinutes);

  if (!Number.isFinite(openedAtMs)) {
    return false;
  }

  const expiryMs = openedAtMs + Math.max(1, resolvedMinutes) * 60 * 1000;
  return Date.now() >= expiryMs;
}

function getExpiredFeatureMarkets() {
  const validSnapshots = getValidSnapshots(undefined, { limit: 1000000 });
  const expiredByTicker = new Map();

  for (const snapshot of validSnapshots) {
    if (snapshot?.settlement_outcome || !snapshot?.market_ticker) {
      continue;
    }

    const capturedAt = snapshot?.captured_at || snapshot?.createdAt;
    if (!isRecordExpired(capturedAt, snapshot?.minutes_remaining, 15)) {
      continue;
    }

    if (!expiredByTicker.has(snapshot.market_ticker)) {
      expiredByTicker.set(snapshot.market_ticker, snapshot);
    }
  }

  return Array.from(expiredByTicker.values());
}

function buildIdleResult(reason, openTrades, expiredTrades = []) {
  return {
    ok: true,
    reason,
    openTrades,
    expiredTrades: expiredTrades.length,
    settledTrades: 0,
    results: [],
    stats: getPaperTradingStats(),
    timestamp: new Date().toISOString(),
  };
}

export async function runPaperSettlementOnce() {
  if (isRunning) {
    return {
      ok: false,
      reason: "SETTLEMENT_ALREADY_RUNNING",
      stats: getPaperTradingStats(),
      timestamp: new Date().toISOString(),
    };
  }

  isRunning = true;
  lastRun = new Date().toISOString();

  try {
    const openTrades = getPaperTrades({ status: "OPEN", limit: 1000 });
    const expiredTrades = openTrades.filter(isTradeExpired);
    const expiredFeatureMarkets = getExpiredFeatureMarkets();

    if (expiredTrades.length === 0 && expiredFeatureMarkets.length === 0) {
      const result = buildIdleResult(
        "NO_EXPIRED_OPEN_TRADES_OR_SNAPSHOTS",
        openTrades.length,
        expiredTrades
      );
      lastResult = result;
      lastError = null;
      return result;
    }

    const btc = await getAggregatedBtcPrice();

    if (!btc.ok || !Number.isFinite(btc.price)) {
      throw new Error(btc.reason || "BTC_PRICE_UNAVAILABLE");
    }

    const results = [];
    let settledTrades = 0;
    let settledSnapshots = 0;
    const settlementTargets = new Map();

    for (const trade of expiredTrades) {
      if (trade?.marketTicker) {
        settlementTargets.set(trade.marketTicker, {
          marketTicker: trade.marketTicker,
          openedAt: trade.openedAt,
          minutesRemaining: trade.minutesRemaining,
        });
      }
    }

    for (const snapshot of expiredFeatureMarkets) {
      settlementTargets.set(snapshot.market_ticker, {
        marketTicker: snapshot.market_ticker,
        openedAt: snapshot.captured_at || snapshot.createdAt,
        minutesRemaining: snapshot.minutes_remaining,
      });
    }

    for (const target of settlementTargets.values()) {
      const settlement = settleMarketArtifactsByBtcPrice({
        marketTicker: target.marketTicker,
        settlementBtcPrice: btc.price,
      });

      settledTrades += settlement.paperTrades?.settled || 0;
      settledSnapshots += settlement.featureSnapshots?.settled || 0;
      results.push({
        marketTicker: target.marketTicker,
        openedAt: target.openedAt,
        minutesRemaining: target.minutesRemaining,
        result: settlement,
      });
    }

    const finalResult = {
      ok: true,
      reason: "SETTLEMENT_RUN_COMPLETE",
      settlementBtcPrice: btc.price,
      openTrades: openTrades.length,
      expiredTrades: expiredTrades.length,
      expiredSnapshotMarkets: expiredFeatureMarkets.length,
      settledTrades,
      settledSnapshots,
      results,
      stats: getPaperTradingStats(),
      timestamp: new Date().toISOString(),
    };

    lastResult = finalResult;
    lastError = null;

    return finalResult;
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

export function startPaperSettlementScheduler({
  cronExpression = process.env.KALSHI_SETTLEMENT_CRON || "* * * * *",
  enabled = process.env.KALSHI_SETTLEMENT_SCHEDULER_ENABLED === "true",
} = {}) {
  if (!enabled) {
    console.log("[KALSHI PAPER SETTLEMENT SCHEDULER] Disabled");
    return {
      started: false,
      reason: "DISABLED",
    };
  }

  if (schedulerTask) {
    return {
      started: false,
      reason: "ALREADY_RUNNING",
    };
  }

  schedulerTask = cron.schedule(cronExpression, async () => {
    if (isRunning) {
      console.log("[KALSHI PAPER SETTLEMENT SCHEDULER] Previous run still active, skipping");
      return;
    }

    try {
      console.log("[KALSHI PAPER SETTLEMENT SCHEDULER] Run started");
      const result = await runPaperSettlementOnce();
      console.log("[KALSHI PAPER SETTLEMENT SCHEDULER] Run completed", {
        reason: result.reason,
        expiredTrades: result.expiredTrades,
        settledTrades: result.settledTrades,
      });
    } catch (error) {
      console.error("[KALSHI PAPER SETTLEMENT SCHEDULER] Run failed", {
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  console.log("[KALSHI PAPER SETTLEMENT SCHEDULER] Started", {
    cronExpression,
  });

  return {
    started: true,
    cronExpression,
  };
}

export function stopPaperSettlementScheduler() {
  if (!schedulerTask) {
    return {
      stopped: false,
      reason: "NOT_RUNNING",
    };
  }

  schedulerTask.stop();
  schedulerTask = null;

  return {
    stopped: true,
  };
}

export function getPaperSettlementSchedulerStatus() {
  return {
    enabled: Boolean(schedulerTask),
    isRunning,
    lastRun,
    lastResult,
    lastError,
    cron: process.env.KALSHI_SETTLEMENT_CRON || "* * * * *",
  };
}
