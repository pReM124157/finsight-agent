import fs from "node:fs";
import path from "node:path";

const REAL_TRADE_DATASET_PATH =
  process.env.KALSHI_REAL_TRADE_DATASET_PATH ||
  path.resolve("data/kalshi-real-trades.json");

function ensureDatasetDir() {
  const dir = path.dirname(REAL_TRADE_DATASET_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readDataset() {
  ensureDatasetDir();

  if (!fs.existsSync(REAL_TRADE_DATASET_PATH)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(REAL_TRADE_DATASET_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDataset(records) {
  ensureDatasetDir();
  fs.writeFileSync(REAL_TRADE_DATASET_PATH, JSON.stringify(records, null, 2) + "\n");
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side) {
  const normalized = String(side || "").trim().toUpperCase();
  if (normalized === "UP") return "YES";
  if (normalized === "DOWN") return "NO";
  if (normalized === "YES" || normalized === "NO") return normalized;
  return null;
}

function normalizeOutcome(outcome) {
  const normalized = String(outcome || "").trim().toUpperCase();
  return normalized === "WON" || normalized === "LOST" ? normalized : null;
}

function normalizeSettledSide(side) {
  if (side === null || side === undefined || side === "") return null;
  return normalizeSide(side);
}

function generateId() {
  return `REAL-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

function toFixedNumber(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function buildSideStats(trades, side) {
  const sideTrades = trades.filter((trade) => trade.sideTaken === side);
  const wins = sideTrades.filter((trade) => trade.outcome === "WON").length;
  const losses = sideTrades.filter((trade) => trade.outcome === "LOST").length;
  const totalCostUsd = sideTrades.reduce((sum, trade) => sum + (trade.costUsd || 0), 0);
  const totalPayoutUsd = sideTrades.reduce((sum, trade) => sum + (trade.payoutUsd || 0), 0);
  const totalPnlUsd = sideTrades.reduce((sum, trade) => sum + (trade.pnlUsd || 0), 0);

  return {
    totalTrades: sideTrades.length,
    wins,
    losses,
    winRate: sideTrades.length ? Number(((wins / sideTrades.length) * 100).toFixed(2)) : 0,
    totalCostUsd: Number(totalCostUsd.toFixed(2)),
    totalPayoutUsd: Number(totalPayoutUsd.toFixed(2)),
    totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
    roiPct: totalCostUsd ? Number(((totalPnlUsd / totalCostUsd) * 100).toFixed(2)) : 0,
  };
}

export function validateRealTrade(record = {}) {
  const errors = [];

  const targetPrice = safeNumber(record.targetPrice);
  const entryBtcPrice = safeNumber(record.entryBtcPrice);
  const minutesRemainingAtEntry = safeNumber(record.minutesRemainingAtEntry);
  const marketProbabilityAtEntry = safeNumber(record.marketProbabilityAtEntry);
  const yesPriceAtEntry = safeNumber(record.yesPriceAtEntry);
  const noPriceAtEntry = safeNumber(record.noPriceAtEntry);
  const costUsd = safeNumber(record.costUsd);
  const payoutUsd = safeNumber(record.payoutUsd);
  const normalizedSideTaken = normalizeSide(record.sideTaken);
  const normalizedOutcome = normalizeOutcome(record.outcome);
  const normalizedSettledSide = normalizeSettledSide(record.settledSide);

  if (targetPrice === null) errors.push("targetPrice is required");
  if (!record.entryTime) errors.push("entryTime is required");
  if (!normalizedSideTaken) errors.push("sideTaken is required");
  if (costUsd === null) errors.push("costUsd is required");
  if (!normalizedOutcome) errors.push("outcome is required");

  const pnlUsd =
    payoutUsd !== null && costUsd !== null
      ? Number((payoutUsd - costUsd).toFixed(2))
      : toFixedNumber(record.pnlUsd);
  const roiPct =
    costUsd && pnlUsd !== null
      ? Number(((pnlUsd / costUsd) * 100).toFixed(2))
      : toFixedNumber(record.roiPct);

  const normalized = {
    id: record.id || generateId(),
    source: record.source || "MANUAL",
    marketTicker: record.marketTicker || null,
    contractTitle: record.contractTitle || null,
    targetPrice,
    entryBtcPrice,
    entryTime: record.entryTime || null,
    settlementTime: record.settlementTime || null,
    minutesRemainingAtEntry,
    sideTaken: normalizedSideTaken,
    marketProbabilityAtEntry: toFixedNumber(marketProbabilityAtEntry),
    yesPriceAtEntry: toFixedNumber(yesPriceAtEntry),
    noPriceAtEntry: toFixedNumber(noPriceAtEntry),
    costUsd: toFixedNumber(costUsd),
    payoutUsd: toFixedNumber(payoutUsd),
    outcome: normalizedOutcome,
    settledSide: normalizedSettledSide,
    pnlUsd,
    roiPct,
    notes: record.notes || "",
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    ok: errors.length === 0,
    errors,
    record: normalized,
  };
}

export function addRealTrade(record = {}) {
  const validation = validateRealTrade(record);

  if (!validation.ok) {
    return {
      ok: false,
      reason: "INVALID_REAL_TRADE",
      errors: validation.errors,
    };
  }

  const records = readDataset();
  const index = records.findIndex((entry) => entry.id === validation.record.id);

  if (index >= 0) {
    records[index] = {
      ...records[index],
      ...validation.record,
      createdAt: records[index].createdAt || validation.record.createdAt,
      updatedAt: new Date().toISOString(),
    };
  } else {
    records.push(validation.record);
  }

  writeDataset(records);

  return {
    ok: true,
    trade: index >= 0 ? records[index] : validation.record,
  };
}

export function getRealTrades({ limit = 100, side = null, outcome = null } = {}) {
  const records = readDataset();
  const normalizedSide = side ? normalizeSide(side) : null;
  const normalizedOutcome = outcome ? normalizeOutcome(outcome) : null;

  const filtered = records.filter((trade) => {
    if (normalizedSide && trade.sideTaken !== normalizedSide) return false;
    if (normalizedOutcome && trade.outcome !== normalizedOutcome) return false;
    return true;
  });

  return filtered.slice(-Number(limit || 100)).reverse();
}

export function getRealTradeStats() {
  const trades = readDataset();
  const wins = trades.filter((trade) => trade.outcome === "WON");
  const losses = trades.filter((trade) => trade.outcome === "LOST");
  const totalCostUsd = trades.reduce((sum, trade) => sum + (trade.costUsd || 0), 0);
  const totalPayoutUsd = trades.reduce((sum, trade) => sum + (trade.payoutUsd || 0), 0);
  const totalPnlUsd = trades.reduce((sum, trade) => sum + (trade.pnlUsd || 0), 0);
  const averageWinnerUsd =
    wins.length > 0
      ? Number((wins.reduce((sum, trade) => sum + (trade.pnlUsd || 0), 0) / wins.length).toFixed(2))
      : 0;
  const averageLoserUsd =
    losses.length > 0
      ? Number((losses.reduce((sum, trade) => sum + (trade.pnlUsd || 0), 0) / losses.length).toFixed(2))
      : 0;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
    totalCostUsd: Number(totalCostUsd.toFixed(2)),
    totalPayoutUsd: Number(totalPayoutUsd.toFixed(2)),
    totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
    roiPct: totalCostUsd ? Number(((totalPnlUsd / totalCostUsd) * 100).toFixed(2)) : 0,
    averageWinnerUsd,
    averageLoserUsd,
    bySide: {
      YES: buildSideStats(trades, "YES"),
      NO: buildSideStats(trades, "NO"),
    },
  };
}
