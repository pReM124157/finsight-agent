import fs from "node:fs";
import path from "node:path";

import { estimateBtcReachability } from "../src/kalshi/agents/reachabilityEngine.js";
import { calculateMispricing } from "../src/kalshi/agents/mispricingEngine.js";
import {
  evaluateStrategyZoneGuard,
  getStrategyZoneConfig,
} from "../src/kalshi/risk/strategyZoneGuard.js";

const FEATURE_SNAPSHOT_PATH =
  process.env.KALSHI_FEATURE_SNAPSHOT_PATH ||
  path.resolve("data/kalshi-feature-snapshots.jsonl");

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function readFeatureSnapshots() {
  if (!fs.existsSync(FEATURE_SNAPSHOT_PATH)) {
    return [];
  }

  return fs
    .readFileSync(FEATURE_SNAPSHOT_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function calculateTradePnl({ side, entryProbability, actualOutcome, sizeUsd }) {
  const entryProb = safeNumber(entryProbability);
  const size = safeNumber(sizeUsd, 0);

  if (!["YES", "NO"].includes(side) || !["YES", "NO"].includes(actualOutcome)) {
    return { ok: false, reason: "INVALID_SIDE_OR_OUTCOME" };
  }
  if (!entryProb || entryProb <= 0 || entryProb >= 100) {
    return { ok: false, reason: "INVALID_ENTRY_PROBABILITY" };
  }

  const contracts = Math.floor(size / (entryProb / 100));
  if (contracts <= 0) {
    return { ok: false, reason: "SIZE_TOO_SMALL" };
  }

  const costUsd = (contracts * entryProb) / 100;
  const maxPayoutUsd = contracts;
  const pnlUsd = side === actualOutcome ? maxPayoutUsd - costUsd : -costUsd;
  const returnPct = costUsd > 0 ? (pnlUsd / costUsd) * 100 : 0;

  return {
    ok: true,
    contracts,
    costUsd: round(costUsd),
    maxPayoutUsd: round(maxPayoutUsd),
    pnlUsd: round(pnlUsd),
    returnPct: round(returnPct),
    result: side === actualOutcome ? "WON" : "LOST",
  };
}

function computeMaxDrawdown(trades = []) {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    cumulative += safeNumber(trade.pnlUsd, 0);
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  return round(maxDrawdown);
}

function buildEmptySummary() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    totalPnlUsd: 0,
    totalRiskedUsd: 0,
    roiPct: 0,
    winRate: 0,
    avgPnlUsd: 0,
    maxDrawdownUsd: 0,
  };
}

function summarizeTrades(trades = []) {
  const wins = trades.filter((trade) => trade.result === "WON");
  const losses = trades.filter((trade) => trade.result === "LOST");
  const totalPnlUsd = trades.reduce((sum, trade) => sum + safeNumber(trade.pnlUsd, 0), 0);
  const totalRiskedUsd = trades.reduce((sum, trade) => sum + safeNumber(trade.costUsd, 0), 0);

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100) : 0,
    totalPnlUsd: round(totalPnlUsd),
    totalRiskedUsd: round(totalRiskedUsd),
    roiPct: totalRiskedUsd ? round((totalPnlUsd / totalRiskedUsd) * 100) : 0,
    avgPnlUsd: trades.length ? round(totalPnlUsd / trades.length) : 0,
    maxDrawdownUsd: computeMaxDrawdown(trades),
  };
}

function main() {
  const sizeUsd = safeNumber(process.env.KALSHI_BACKTEST_SIZE_USD, 5);
  const annualizedVolatility = safeNumber(process.env.KALSHI_BACKTEST_ANNUALIZED_VOL, 0.55);
  const feeBps = safeNumber(process.env.KALSHI_BACKTEST_FEE_BPS, 20);
  const minEdgePct = safeNumber(process.env.KALSHI_BACKTEST_MIN_EDGE_PCT, 5);
  const strongEdgePct = safeNumber(process.env.KALSHI_BACKTEST_STRONG_EDGE_PCT, 10);
  const maxAllowedSpreadPct = safeNumber(process.env.KALSHI_BACKTEST_MAX_SPREAD_PCT, 8);
  const strategyZoneConfig = getStrategyZoneConfig();
  const rows = readFeatureSnapshots()
    .filter((row) => row?.settlement_outcome === "YES" || row?.settlement_outcome === "NO")
    .sort((a, b) => new Date(a.captured_at || a.createdAt || 0) - new Date(b.captured_at || b.createdAt || 0));

  const trades = [];
  const blocked = {};

  for (const row of rows) {
    const reachability = estimateBtcReachability({
      currentPrice: row.btc_price,
      targetPrice: row.target_price,
      minutesRemaining: row.minutes_remaining,
      annualizedVolatility,
      momentumBps: 0,
      marketProbability: row.market_prob_yes,
      marketTicker: row.market_ticker,
      marketTitle: row.market_title,
    });

    if (!reachability.ok || reachability.modelProbability === null) {
      continue;
    }

    const mispricing = calculateMispricing({
      marketProbability: row.market_prob_yes,
      modelProbability: reachability.modelProbability,
      yesBidPrice: row.yes_bid,
      yesAskPrice: row.yes_ask,
      noBidPrice: row.no_bid,
      noAskPrice: row.no_ask,
      feeBps,
      minEdgePct,
      strongEdgePct,
      maxAllowedSpreadPct,
    });

    if (!mispricing.ok || mispricing.decision !== "TRADE") {
      const key = mispricing.reason || `MISPRICING_DECISION_${mispricing.decision}`;
      blocked[key] = (blocked[key] || 0) + 1;
      continue;
    }

    const side = mispricing.bestSide;
    const entryProbability = side === "YES" ? row.yes_ask : row.no_ask;
    const strategyZoneGuard = evaluateStrategyZoneGuard({
      side,
      adjustedEdge: mispricing.bestAdjustedEdge,
      minutesRemaining: row.minutes_remaining,
      entryProbability,
      config: strategyZoneConfig,
    });

    if (!strategyZoneGuard.ok) {
      blocked[strategyZoneGuard.reason] = (blocked[strategyZoneGuard.reason] || 0) + 1;
      continue;
    }

    const pnl = calculateTradePnl({
      side,
      entryProbability,
      actualOutcome: row.settlement_outcome,
      sizeUsd,
    });

    if (!pnl.ok) {
      continue;
    }

    trades.push({
      capturedAt: row.captured_at || row.createdAt || null,
      marketTicker: row.market_ticker,
      marketTitle: row.market_title,
      side,
      modelProbability: round(reachability.modelProbability),
      marketProbability: round(mispricing.marketProbability),
      entryProbability: round(entryProbability),
      adjustedEdge: round(mispricing.bestAdjustedEdge),
      rawEdge: round(mispricing.bestRawEdge),
      edgeGrade: mispricing.edgeGrade,
      strategyTags: strategyZoneGuard.tags,
      actualOutcome: row.settlement_outcome,
      settlementBtcPrice: round(row.settlement_btc_price),
      targetPrice: round(row.target_price),
      minutesRemaining: safeNumber(row.minutes_remaining),
      costUsd: pnl.costUsd,
      pnlUsd: pnl.pnlUsd,
      result: pnl.result,
      returnPct: pnl.returnPct,
    });
  }

  const stats = summarizeTrades(trades);
  const byDay = {};
  const bySide = {
    YES: [],
    NO: [],
  };

  for (const trade of trades) {
    const day = String(trade.capturedAt || "").slice(0, 10);
    if (!day) continue;
    byDay[day] = byDay[day] || { trades: 0, wins: 0, losses: 0, pnlUsd: 0, riskedUsd: 0 };
    byDay[day].trades += 1;
    if (trade.result === "WON") byDay[day].wins += 1;
    if (trade.result === "LOST") byDay[day].losses += 1;
    byDay[day].pnlUsd += safeNumber(trade.pnlUsd, 0);
    byDay[day].riskedUsd += safeNumber(trade.costUsd, 0);
    if (bySide[trade.side]) {
      bySide[trade.side].push(trade);
    }
  }

  const dailyTable = Object.entries(byDay).map(([date, stats]) => ({
    date,
    trades: stats.trades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.trades ? round((stats.wins / stats.trades) * 100) : 0,
    pnlUsd: round(stats.pnlUsd),
    riskedUsd: round(stats.riskedUsd),
    roiPct: stats.riskedUsd ? round((stats.pnlUsd / stats.riskedUsd) * 100) : 0,
  }));

  console.log(JSON.stringify({
    ok: true,
    assumptions: {
      sizeUsd,
      exitRule: "Hold to settlement",
      sideRule: "Mispricing best side gated by strategy zone guard",
      feeBps,
      minEdgePct,
      strongEdgePct,
      maxAllowedSpreadPct,
      strategyZoneConfig,
      sourceRows: rows.length,
    },
    stats,
    blocked,
    sideStats: {
      YES: bySide.YES.length ? summarizeTrades(bySide.YES) : buildEmptySummary(),
      NO: bySide.NO.length ? summarizeTrades(bySide.NO) : buildEmptySummary(),
    },
    dailyTable,
    sampleTrades: trades.slice(0, 10),
  }, null, 2));
}

main();
