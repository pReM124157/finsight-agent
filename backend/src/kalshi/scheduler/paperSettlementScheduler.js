import cron from "node-cron";

import { getAggregatedBtcPrice } from "../data/cryptoPriceClient.js";
import {
  getPaperTrades,
  getPaperTradingStats,
} from "../execution/paperTradingEngine.js";
import { settleOpenPaperTradesByBtcPrice } from "../execution/settlementEngine.js";

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
  const openedAtMs = new Date(trade?.openedAt).getTime();
  const minutes = safeNumber(trade?.minutesRemaining, 15);

  if (!Number.isFinite(openedAtMs)) {
    return false;
  }

  const expiryMs = openedAtMs + Math.max(1, minutes) * 60 * 1000;
  return Date.now() >= expiryMs;
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

    if (expiredTrades.length === 0) {
      const result = buildIdleResult(
        "NO_EXPIRED_OPEN_TRADES",
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

    for (const trade of expiredTrades) {
      const settlement = settleOpenPaperTradesByBtcPrice({
        tradeId: trade.id,
        settlementBtcPrice: btc.price,
      });

      settledTrades += settlement.settled || 0;
      results.push({
        marketTicker: trade.marketTicker,
        tradeId: trade.id,
        openedAt: trade.openedAt,
        minutesRemaining: trade.minutesRemaining,
        result: settlement,
      });
    }

    const finalResult = {
      ok: true,
      reason: "SETTLEMENT_RUN_COMPLETE",
      settlementBtcPrice: btc.price,
      openTrades: openTrades.length,
      expiredTrades: expiredTrades.length,
      settledTrades,
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
