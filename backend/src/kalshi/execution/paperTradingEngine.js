import fs from "node:fs";
import path from "node:path";
import { logPaperTradeLesson } from "../learning/lessonLogger.js";
import {
  isMongoDualWriteEnabled,
  savePaperTradeMongo,
  updatePaperTradeMongo,
} from "../storage/mongoPersistence.js";

const PAPER_LEDGER_PATH =
  process.env.KALSHI_PAPER_LEDGER_PATH ||
  path.resolve("data/kalshi-paper-trades.json");

export const PAPER_TRADE_SOURCES = {
  LEGACY_TEST: "LEGACY_TEST",
  MANUAL_TEST: "MANUAL_TEST",
  LIVE_GUARDED_STRATEGY: "LIVE_STRATEGY",
};

export const LIVE_STRATEGY_NAME = "zone-v3-60c-floor";

function ensureLedgerDir() {
  const dir = path.dirname(PAPER_LEDGER_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readLedger() {
  ensureLedgerDir();

  if (!fs.existsSync(PAPER_LEDGER_PATH)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PAPER_LEDGER_PATH, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : [];
    return rows.map(normalizeTradeRecord);
  } catch {
    return [];
  }
}

function writeLedger(trades) {
  ensureLedgerDir();
  fs.writeFileSync(PAPER_LEDGER_PATH, JSON.stringify(trades, null, 2) + "\n");
}

function dualWritePaperTrade(trade) {
  if (!isMongoDualWriteEnabled()) {
    return;
  }

  savePaperTradeMongo(trade).catch((error) => {
    console.warn("[mongo] paper trade dual-write failed:", error.message);
  });
}

function dualWritePaperTradeUpdate(trade) {
  if (!isMongoDualWriteEnabled()) {
    return;
  }

  updatePaperTradeMongo(trade?.id || trade?.tradeId, trade).catch((error) => {
    console.warn("[mongo] paper trade update dual-write failed:", error.message);
  });
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inferTradeSource(trade = {}) {
  const explicit = normalizeString(trade.tradeSource);
  if (explicit) return explicit;

  if (trade.isStrategyTrade === true || normalizeString(trade.strategyName) || trade.strategy?.name) {
    return PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY;
  }

  const noteText = `${trade.notes || ""} ${trade.marketTicker || ""} ${trade.source || ""}`.toLowerCase();
  if (noteText.includes("manual")) {
    return PAPER_TRADE_SOURCES.MANUAL_TEST;
  }

  return PAPER_TRADE_SOURCES.LEGACY_TEST;
}

function normalizeTradeRecord(trade = {}) {
  const strategyName =
    normalizeString(trade.strategyName) ||
    normalizeString(trade.strategy?.name) ||
    (trade.isStrategyTrade ? LIVE_STRATEGY_NAME : null);
  const isStrategyTrade =
    trade.isStrategyTrade === true ||
    inferTradeSource(trade) === PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY;

  return {
    ...trade,
    tradeSource: inferTradeSource(trade),
    strategySessionId:
      normalizeString(trade.strategySessionId) ||
      normalizeString(trade.strategy?.sessionId) ||
      null,
    strategyName,
    isStrategyTrade,
  };
}

function tradeMatchesFilters(trade, filters = {}) {
  const normalized = normalizeTradeRecord(trade);

  if (filters.status && normalized.status !== filters.status) {
    return false;
  }

  if (filters.tradeSource && normalized.tradeSource !== filters.tradeSource) {
    return false;
  }

  if (filters.isStrategyTrade === true && normalized.isStrategyTrade !== true) {
    return false;
  }

  if (filters.isStrategyTrade === false && normalized.isStrategyTrade !== false) {
    return false;
  }

  if (filters.strategyName && normalized.strategyName !== filters.strategyName) {
    return false;
  }

  if (filters.strategySessionId && normalized.strategySessionId !== filters.strategySessionId) {
    return false;
  }

  if (filters.date) {
    const timestamp = normalized.closedAt || normalized.openedAt || "";
    if (!timestamp.startsWith(String(filters.date))) {
      return false;
    }
  }

  return true;
}

function generateTradeId() {
  return `PAPER-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

export function calculatePaperTradeSize({
  adjustedEdgePct,
  confidenceScore,
  baseSizeUsd = 25,
  maxSizeUsd = 500,
} = {}) {
  const edge = safeNumber(adjustedEdgePct, 0);
  const confidence = safeNumber(confidenceScore, 50);

  let size = baseSizeUsd;

  if (edge >= 25) {
    size = 500;
  } else if (edge >= 20) {
    size = 250;
  } else if (edge >= 15) {
    size = 100;
  } else if (edge >= 10) {
    size = 50;
  } else if (edge >= 5) {
    size = 25;
  }

  if (confidence < 60) {
    size *= 0.5;
  }
  if (confidence >= 80) {
    size *= 1.25;
  }

  return Math.min(maxSizeUsd, Math.max(5, Number(size.toFixed(2))));
}

export function createPaperTrade({
  marketTicker,
  side,
  entryProbability,
  modelProbability,
  marketProbability,
  adjustedEdge,
  rawEdge,
  btcPrice,
  targetPrice,
  minutesRemaining,
  confidenceScore,
  sizeUsd = null,
  source = "MISPRICING_ENGINE",
  notes = "",
  strategy = null,
  tradeSource = null,
  strategySessionId = null,
  strategyName = null,
  isStrategyTrade = null,
} = {}) {
  const entryProb = safeNumber(entryProbability);

  if (!marketTicker) {
    return { ok: false, reason: "MISSING_MARKET_TICKER" };
  }

  if (!["YES", "NO"].includes(side)) {
    return { ok: false, reason: "INVALID_SIDE" };
  }

  if (entryProb === null || entryProb <= 0 || entryProb >= 100) {
    return { ok: false, reason: "INVALID_ENTRY_PROBABILITY" };
  }

  const finalSizeUsd =
    sizeUsd !== null
      ? safeNumber(sizeUsd, 0)
      : calculatePaperTradeSize({
          adjustedEdgePct: adjustedEdge,
          confidenceScore,
        });

  const contracts = Math.floor(finalSizeUsd / (entryProb / 100));

  if (contracts <= 0) {
    return { ok: false, reason: "SIZE_TOO_SMALL" };
  }

  const costUsd = Number(((contracts * entryProb) / 100).toFixed(2));
  const maxPayoutUsd = Number(contracts.toFixed(2));
  const maxProfitUsd = Number((maxPayoutUsd - costUsd).toFixed(2));
  const maxLossUsd = costUsd;

  const trade = {
    id: generateTradeId(),
    marketTicker,
    side,
    status: "OPEN",
    source,

    entryProbability: Number(entryProb.toFixed(2)),
    modelProbability: safeNumber(modelProbability),
    marketProbability: safeNumber(marketProbability),
    adjustedEdge: safeNumber(adjustedEdge),
    rawEdge: safeNumber(rawEdge),
    confidenceScore: safeNumber(confidenceScore),

    btcPrice: safeNumber(btcPrice),
    targetPrice: safeNumber(targetPrice),
    minutesRemaining: safeNumber(minutesRemaining),

    sizeUsd: finalSizeUsd,
    contracts,
    costUsd,
    maxPayoutUsd,
    maxProfitUsd,
    maxLossUsd,

    openedAt: new Date().toISOString(),
    closedAt: null,
    settlement: null,
    pnlUsd: null,
    returnPct: null,
    notes,
    strategy: strategy && typeof strategy === "object" ? strategy : null,
    tradeSource: normalizeString(tradeSource),
    strategySessionId: normalizeString(strategySessionId),
    strategyName: normalizeString(strategyName),
    isStrategyTrade: isStrategyTrade === null ? null : Boolean(isStrategyTrade),
  };

  const ledger = readLedger();
  ledger.push(normalizeTradeRecord(trade));
  writeLedger(ledger);
  dualWritePaperTrade(trade);

  return {
    ok: true,
    trade: normalizeTradeRecord(trade),
  };
}

export function settlePaperTrade({
  tradeId,
  won,
  settlementPrice = null,
  settlementBtcPrice = null,
  actualOutcome = null,
} = {}) {
  const ledger = readLedger();
  const index = ledger.findIndex((trade) => trade.id === tradeId);

  if (index === -1) {
    return { ok: false, reason: "TRADE_NOT_FOUND" };
  }

  const trade = ledger[index];

  if (trade.status !== "OPEN") {
    return { ok: false, reason: "TRADE_ALREADY_CLOSED", trade };
  }

  const isWin = Boolean(won);
  const pnlUsd = isWin ? trade.maxProfitUsd : -trade.maxLossUsd;
  const returnPct = trade.costUsd > 0 ? (pnlUsd / trade.costUsd) * 100 : null;

  const updated = normalizeTradeRecord({
    ...trade,
    status: isWin ? "WON" : "LOST",
    closedAt: new Date().toISOString(),
    settlement: {
      won: isWin,
      settlementPrice,
      settlementBtcPrice: safeNumber(settlementBtcPrice),
      actualOutcome: actualOutcome || null,
    },
    pnlUsd: Number(pnlUsd.toFixed(2)),
    returnPct: returnPct === null ? null : Number(returnPct.toFixed(2)),
  });

  ledger[index] = updated;
  writeLedger(ledger);
  dualWritePaperTradeUpdate(updated);

  let lesson = {
    ok: false,
    reason: "LESSON_LOGGER_NOT_RUN",
  };

  try {
    lesson = logPaperTradeLesson(updated);
  } catch (error) {
    lesson = {
      ok: false,
      reason: "LESSON_LOGGER_FAILED",
      error: error.message,
    };
  }

  return {
    ok: true,
    trade: updated,
    lesson,
  };
}

export function hasTradeBeenSettled(tradeId) {
  const ledger = readLedger();
  const trade = ledger.find((t) => t.id === tradeId);

  if (!trade) {
    return {
      exists: false,
      settled: false,
      trade: null,
    };
  }

  return {
    exists: true,
    settled: trade.status !== "OPEN",
    trade,
  };
}

export function getPaperTrades({
  status = null,
  limit = 50,
  tradeSource = null,
  isStrategyTrade = null,
  strategyName = null,
  strategySessionId = null,
  date = null,
} = {}) {
  const ledger = readLedger();

  const filtered = ledger.filter((trade) =>
    tradeMatchesFilters(trade, {
      status,
      tradeSource,
      isStrategyTrade,
      strategyName,
      strategySessionId,
      date,
    })
  );

  return filtered.slice(-limit).reverse();
}

export function getPaperTradingStats(filters = {}) {
  const trades = readLedger().filter((trade) => tradeMatchesFilters(trade, filters));
  const closed = trades.filter((trade) => ["WON", "LOST"].includes(trade.status));
  const open = trades.filter((trade) => trade.status === "OPEN");

  const wins = closed.filter((trade) => trade.status === "WON").length;
  const losses = closed.filter((trade) => trade.status === "LOST").length;
  const totalPnl = closed.reduce((sum, trade) => sum + (trade.pnlUsd || 0), 0);
  const totalRisked = closed.reduce((sum, trade) => sum + (trade.costUsd || 0), 0);

  return {
    totalTrades: trades.length,
    openTrades: open.length,
    closedTrades: closed.length,
    wins,
    losses,
    winRate: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
    totalPnlUsd: Number(totalPnl.toFixed(2)),
    totalRiskedUsd: Number(totalRisked.toFixed(2)),
    roiPct: totalRisked ? Number(((totalPnl / totalRisked) * 100).toFixed(2)) : 0,
  };
}
