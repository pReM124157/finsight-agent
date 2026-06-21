import { estimateBtcReachability } from "../agents/reachabilityEngine.js";
import { calculateMispricing } from "../agents/mispricingEngine.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveOutcome({ side, actualOutcome }) {
  if (!["YES", "NO"].includes(side)) {
    return null;
  }
  if (!["YES", "NO"].includes(actualOutcome)) {
    return null;
  }
  return side === actualOutcome ? "WON" : "LOST";
}

function calculateTradePnl({ side, entryProbability, actualOutcome, sizeUsd }) {
  const entryProb = safeNumber(entryProbability);
  const size = safeNumber(sizeUsd, 0);

  if (!entryProb || entryProb <= 0 || entryProb >= 100) {
    return { ok: false, reason: "INVALID_ENTRY_PROBABILITY" };
  }

  const contracts = Math.floor(size / (entryProb / 100));
  const costUsd = (contracts * entryProb) / 100;
  const maxPayoutUsd = contracts;
  const maxProfitUsd = maxPayoutUsd - costUsd;

  const result = resolveOutcome({ side, actualOutcome });

  if (!result) {
    return { ok: false, reason: "INVALID_OUTCOME" };
  }

  const pnlUsd = result === "WON" ? maxProfitUsd : -costUsd;
  const returnPct = costUsd > 0 ? (pnlUsd / costUsd) * 100 : 0;

  return {
    ok: true,
    result,
    contracts,
    costUsd: Number(costUsd.toFixed(2)),
    maxPayoutUsd: Number(maxPayoutUsd.toFixed(2)),
    pnlUsd: Number(pnlUsd.toFixed(2)),
    returnPct: Number(returnPct.toFixed(2)),
  };
}

export function runReplayBacktest({
  snapshots = [],
  annualizedVolatility = 0.55,
  feeBps = 20,
  minEdgePct = 5,
  strongEdgePct = 10,
  maxAllowedSpreadPct = 8,
  defaultSizeUsd = 25,
  tradeOnly = true,
} = {}) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return {
      ok: false,
      reason: "NO_SNAPSHOTS",
      trades: [],
      stats: null,
    };
  }

  const decisions = [];
  const trades = [];

  for (const snapshot of snapshots) {
    const reachability = estimateBtcReachability({
      currentPrice: snapshot.btcPrice,
      targetPrice: snapshot.targetPrice,
      minutesRemaining: snapshot.minutesRemaining,
      annualizedVolatility: snapshot.annualizedVolatility || annualizedVolatility,
      momentumBps: snapshot.momentumBps || 0,
      marketProbability: snapshot.marketProbability,
    });

    if (!reachability.ok) {
      decisions.push({
        snapshotId: snapshot.id,
        ok: false,
        reason: reachability.reason,
      });
      continue;
    }

    const mispricing = calculateMispricing({
      marketProbability: snapshot.marketProbability,
      modelProbability: reachability.modelProbability,
      yesBidPrice: snapshot.yesBidPrice,
      yesAskPrice: snapshot.yesAskPrice,
      noBidPrice: snapshot.noBidPrice,
      noAskPrice: snapshot.noAskPrice,
      feeBps,
      minEdgePct,
      strongEdgePct,
      maxAllowedSpreadPct,
    });

    const decision = {
      snapshotId: snapshot.id,
      marketTicker: snapshot.marketTicker,
      timestamp: snapshot.timestamp,
      btcPrice: snapshot.btcPrice,
      targetPrice: snapshot.targetPrice,
      actualOutcome: snapshot.actualOutcome,
      reachability,
      mispricing,
    };

    decisions.push(decision);

    if (!mispricing.ok) {
      continue;
    }
    if (tradeOnly && mispricing.decision !== "TRADE") {
      continue;
    }

    const side = mispricing.bestSide;
    const entryProbability =
      side === "YES" ? snapshot.yesAskPrice : snapshot.noAskPrice;

    const pnl = calculateTradePnl({
      side,
      entryProbability,
      actualOutcome: snapshot.actualOutcome,
      sizeUsd: snapshot.sizeUsd || defaultSizeUsd,
    });

    if (!pnl.ok) {
      trades.push({
        snapshotId: snapshot.id,
        marketTicker: snapshot.marketTicker,
        ok: false,
        reason: pnl.reason,
      });
      continue;
    }

    trades.push({
      ok: true,
      snapshotId: snapshot.id,
      marketTicker: snapshot.marketTicker,
      timestamp: snapshot.timestamp,
      side,
      entryProbability,
      modelProbability: reachability.modelProbability,
      marketProbability: snapshot.marketProbability,
      adjustedEdge: mispricing.bestAdjustedEdge,
      decision: mispricing.decision,
      actualOutcome: snapshot.actualOutcome,
      result: pnl.result,
      contracts: pnl.contracts,
      costUsd: pnl.costUsd,
      pnlUsd: pnl.pnlUsd,
      returnPct: pnl.returnPct,
    });
  }

  const validTrades = trades.filter((trade) => trade.ok);
  const wins = validTrades.filter((trade) => trade.result === "WON").length;
  const losses = validTrades.filter((trade) => trade.result === "LOST").length;
  const totalPnlUsd = validTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const totalRiskedUsd = validTrades.reduce((sum, trade) => sum + trade.costUsd, 0);

  const stats = {
    snapshots: snapshots.length,
    decisions: decisions.length,
    trades: validTrades.length,
    wins,
    losses,
    winRate: validTrades.length
      ? Number(((wins / validTrades.length) * 100).toFixed(2))
      : 0,
    totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
    totalRiskedUsd: Number(totalRiskedUsd.toFixed(2)),
    roiPct: totalRiskedUsd
      ? Number(((totalPnlUsd / totalRiskedUsd) * 100).toFixed(2))
      : 0,
    avgPnlUsd: validTrades.length
      ? Number((totalPnlUsd / validTrades.length).toFixed(2))
      : 0,
  };

  return {
    ok: true,
    stats,
    trades,
    decisions,
  };
}
