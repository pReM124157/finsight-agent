import {
  getPaperTrades,
  settlePaperTrade,
  getPaperTradingStats,
  hasTradeBeenSettled,
} from "./paperTradingEngine.js";
import {
  backfillSettlementOutcome,
  inferBtcMarketDirection,
} from "../data/featureSnapshot.js";
import {
  findUnsettledSnapshotsByTicker,
  updateSnapshots,
} from "../data/featureSnapshotStore.js";
import { recordLesson } from "../learning/lessonExtractor.js";
import { settleNoSideShadowAudits } from "../shadow/noSideShadowAudit.js";

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

    const direction = inferBtcMarketDirection(trade);

    const outcome = direction
      ? resolveBtcTargetOutcome({
          direction,
          targetPrice: trade.targetPrice,
          settlementBtcPrice,
        })
      : {
          ok: false,
          reason: "INVALID_DIRECTION",
          actualOutcome: null,
        };

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
      settlementBtcPrice,
      actualOutcome: outcome.actualOutcome,
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
      lessonCategory: result.lesson?.lesson?.category || null,
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

export function settleFeatureSnapshotsByBtcPrice({
  marketTicker = null,
  settlementBtcPrice,
  settlementTime = new Date().toISOString(),
} = {}) {
  if (!marketTicker) {
    return {
      ok: false,
      reason: "MARKET_TICKER_REQUIRED",
      checked: 0,
      settled: 0,
    };
  }

  const unsettledRows = findUnsettledSnapshotsByTicker(marketTicker);

  if (unsettledRows.length === 0) {
    return {
      ok: true,
      checked: 0,
      settled: 0,
      marketTicker,
      reason: "NO_UNSETTLED_FEATURE_SNAPSHOTS",
    };
  }

  const updates = {};
  const lessons = [];
  const lessonErrors = [];

  for (const row of unsettledRows) {
    const labeled = backfillSettlementOutcome(row, {
      settlementPrice: settlementBtcPrice,
      targetPrice: row?.target_price,
      settlementTime,
    });

    const key = row?.snapshot_id || row?.id;
    if (key) {
      updates[key] = labeled;
    }

    try {
      lessons.push(recordLesson(labeled));
    } catch (error) {
      lessonErrors.push({
        snapshotId: key || null,
        marketTicker: row?.market_ticker || null,
        message: error.message,
      });
    }
  }

  const result = updateSnapshots(updates);
  const firstOutcome = unsettledRows[0]?.settlement_outcome || Object.values(updates)[0]?.settlement_outcome || null;
  const shadowAuditSettlement = settleNoSideShadowAudits({
    marketTicker,
    settlementOutcome: firstOutcome,
    settlementBtcPrice,
    settlementTime,
  });

  return {
    ok: true,
    marketTicker,
    checked: unsettledRows.length,
    settled: result.updated || 0,
    shadowAuditsUpdated: shadowAuditSettlement.updated || 0,
    lessonsRecorded: lessons.length,
    lessonErrors,
    reason:
      result.updated > 0
        ? "FEATURE_SNAPSHOTS_BACKFILLED"
        : "NO_FEATURE_SNAPSHOT_UPDATES_APPLIED",
  };
}

export function settleMarketArtifactsByBtcPrice({
  marketTicker = null,
  settlementBtcPrice,
  settlementTime = new Date().toISOString(),
} = {}) {
  const snapshotSettlement = settleFeatureSnapshotsByBtcPrice({
    marketTicker,
    settlementBtcPrice,
    settlementTime,
  });

  const tradeSettlement = settleOpenPaperTradesByBtcPrice({
    marketTicker,
    settlementBtcPrice,
  });

  return {
    ok: snapshotSettlement.ok && tradeSettlement.ok,
    marketTicker,
    settlementBtcPrice,
    settlementTime,
    featureSnapshots: snapshotSettlement,
    paperTrades: tradeSettlement,
    stats: getPaperTradingStats(),
  };
}
