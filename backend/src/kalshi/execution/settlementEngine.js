import {
  getPaperTrades,
  settlePaperTrade,
  getPaperTradingStats,
  hasTradeBeenSettled,
} from "./paperTradingEngine.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveBtcTargetOutcome({
  direction = "UP",
  targetPrice,
  settlementBtcPrice,
} = {}) {
  const target = safeNumber(targetPrice);
  const settlement = safeNumber(settlementBtcPrice);

  if (!target || !settlement) {
    return {
      ok: false,
      reason: "INVALID_SETTLEMENT_INPUT",
      actualOutcome: null,
    };
  }

  const normalizedDirection = String(direction || "UP").toUpperCase();

  if (normalizedDirection === "UP") {
    return {
      ok: true,
      direction: "UP",
      targetPrice: target,
      settlementBtcPrice: settlement,
      actualOutcome: settlement >= target ? "YES" : "NO",
    };
  }

  if (normalizedDirection === "DOWN") {
    return {
      ok: true,
      direction: "DOWN",
      targetPrice: target,
      settlementBtcPrice: settlement,
      actualOutcome: settlement <= target ? "YES" : "NO",
    };
  }

  return {
    ok: false,
    reason: "INVALID_DIRECTION",
    actualOutcome: null,
  };
}

export function settleOpenPaperTradesByBtcPrice({
  settlementBtcPrice,
  marketTicker = null,
  tradeId = null,
} = {}) {
  const openTrades = getPaperTrades({ status: "OPEN", limit: 1000 });

  const candidates = tradeId
    ? openTrades.filter((trade) => trade.id === tradeId)
    : marketTicker
      ? openTrades.filter((trade) => trade.marketTicker === marketTicker)
      : openTrades;

  const settled = [];
  const skipped = [];
  const processedTradeIds = new Set();

  for (const trade of candidates) {
    if (processedTradeIds.has(trade.id)) {
      skipped.push({
        tradeId: trade.id,
        marketTicker: trade.marketTicker,
        reason: "TRADE_ALREADY_PROCESSED_IN_RUN",
      });
      continue;
    }

    processedTradeIds.add(trade.id);

    const currentState = hasTradeBeenSettled(trade.id);

    if (!currentState.exists) {
      skipped.push({
        tradeId: trade.id,
        marketTicker: trade.marketTicker,
        reason: "TRADE_NOT_FOUND",
      });
      continue;
    }

    if (currentState.settled) {
      skipped.push({
        tradeId: trade.id,
        marketTicker: trade.marketTicker,
        reason: "TRADE_ALREADY_CLOSED",
      });
      continue;
    }

    const direction =
      safeNumber(trade.targetPrice) >= safeNumber(trade.btcPrice)
        ? "UP"
        : "DOWN";

    const outcome = resolveBtcTargetOutcome({
      direction,
      targetPrice: trade.targetPrice,
      settlementBtcPrice,
    });

    if (!outcome.ok) {
      skipped.push({
        tradeId: trade.id,
        marketTicker: trade.marketTicker,
        reason: outcome.reason,
      });
      continue;
    }

    const won = trade.side === outcome.actualOutcome;

    const result = settlePaperTrade({
      tradeId: trade.id,
      won,
      settlementPrice: won ? 100 : 0,
    });

    if (!result.ok) {
      skipped.push({
        tradeId: trade.id,
        marketTicker: trade.marketTicker,
        reason: result.reason || "SETTLEMENT_FAILED",
      });
      continue;
    }

    settled.push({
      tradeId: trade.id,
      marketTicker: trade.marketTicker,
      side: trade.side,
      direction,
      targetPrice: trade.targetPrice,
      entryBtcPrice: trade.btcPrice,
      settlementBtcPrice,
      actualOutcome: outcome.actualOutcome,
      result: result.trade.status,
      pnlUsd: result.trade?.pnlUsd ?? null,
      ok: true,
      reason: null,
    });
  }

  return {
    ok: true,
    scope: tradeId ? "TRADE_ID" : marketTicker ? "MARKET_TICKER" : "ALL_OPEN_TRADES",
    checked: candidates.length,
    settled: settled.length,
    skipped: skipped.length,
    settledTrades: settled,
    skippedTrades: skipped,
    stats: getPaperTradingStats(),
  };
}
