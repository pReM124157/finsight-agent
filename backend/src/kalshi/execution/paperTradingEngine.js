import fs from "node:fs";
import path from "node:path";

const PAPER_LEDGER_PATH =
  process.env.KALSHI_PAPER_LEDGER_PATH ||
  path.resolve("data/kalshi-paper-trades.json");

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
    return JSON.parse(fs.readFileSync(PAPER_LEDGER_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeLedger(trades) {
  ensureLedgerDir();
  fs.writeFileSync(PAPER_LEDGER_PATH, JSON.stringify(trades, null, 2) + "\n");
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
  };

  const ledger = readLedger();
  ledger.push(trade);
  writeLedger(ledger);

  return {
    ok: true,
    trade,
  };
}

export function settlePaperTrade({ tradeId, won, settlementPrice = null } = {}) {
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

  const updated = {
    ...trade,
    status: isWin ? "WON" : "LOST",
    closedAt: new Date().toISOString(),
    settlement: {
      won: isWin,
      settlementPrice,
    },
    pnlUsd: Number(pnlUsd.toFixed(2)),
    returnPct: returnPct === null ? null : Number(returnPct.toFixed(2)),
  };

  ledger[index] = updated;
  writeLedger(ledger);

  return {
    ok: true,
    trade: updated,
  };
}

export function getPaperTrades({ status = null, limit = 50 } = {}) {
  const ledger = readLedger();

  const filtered = status
    ? ledger.filter((trade) => trade.status === status)
    : ledger;

  return filtered.slice(-limit).reverse();
}

export function getPaperTradingStats() {
  const trades = readLedger();
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
