import { getPaperTrades } from "../execution/paperTradingEngine.js";

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  return Number(safeNumber(value).toFixed(digits));
}

function average(values = []) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + safeNumber(value), 0);
  return total / values.length;
}

function getBucketLabel(modelProbability) {
  const probability = safeNumber(modelProbability, null);

  if (probability === null) return null;
  if (probability >= 55 && probability < 65) return "55-65%";
  if (probability >= 65 && probability < 75) return "65-75%";
  if (probability >= 75 && probability < 85) return "75-85%";
  if (probability >= 85 && probability < 95) return "85-95%";
  if (probability >= 95) return "95%+";

  return null;
}

function buildEmptyBucket() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnlUsd: 0,
    totalRiskedUsd: 0,
    roiPct: 0,
  };
}

function computeMaxDrawdown(trades = []) {
  let cumulativePnl = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;

  for (const trade of trades) {
    cumulativePnl += safeNumber(trade.pnlUsd);
    peak = Math.max(peak, cumulativePnl);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - cumulativePnl);
  }

  return round(maxDrawdownUsd);
}

function getTradeDate(trade) {
  const timestamp = trade?.closedAt || trade?.openedAt || trade?.timestamp || null;
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildDaySummary(trades = []) {
  const closedTrades = trades.filter((trade) => ["WON", "LOST"].includes(trade.status));
  const winners = closedTrades.filter((trade) => trade.status === "WON");
  const losers = closedTrades.filter((trade) => trade.status === "LOST");
  const totalPnlUsd = closedTrades.reduce((sum, trade) => sum + safeNumber(trade.pnlUsd), 0);
  const totalRiskedUsd = closedTrades.reduce((sum, trade) => sum + safeNumber(trade.costUsd), 0);

  return {
    trades: closedTrades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: closedTrades.length ? round((winners.length / closedTrades.length) * 100) : 0,
    totalPnlUsd: round(totalPnlUsd),
    totalRiskedUsd: round(totalRiskedUsd),
    roiPct: totalRiskedUsd ? round((totalPnlUsd / totalRiskedUsd) * 100) : 0,
  };
}

export function buildKalshiPerformanceReport({
  limit = 10000,
  date = null,
  tradeSource = null,
  isStrategyTrade = null,
  strategyName = null,
  strategySessionId = null,
} = {}) {
  const allTrades = getPaperTrades({
    limit,
    status: null,
    tradeSource,
    isStrategyTrade,
    strategyName,
    strategySessionId,
  }).reverse();
  const filteredTrades = date
    ? allTrades.filter((trade) => getTradeDate(trade) === date)
    : allTrades;
  const closedTrades = filteredTrades.filter((trade) => ["WON", "LOST"].includes(trade.status));
  const openTrades = filteredTrades.filter((trade) => trade.status === "OPEN");
  const winners = closedTrades.filter((trade) => trade.status === "WON");
  const losers = closedTrades.filter((trade) => trade.status === "LOST");

  const sortedClosedTrades = [...closedTrades].sort((a, b) => {
    const aTime = new Date(a.closedAt || a.openedAt || 0).getTime();
    const bTime = new Date(b.closedAt || b.openedAt || 0).getTime();
    return aTime - bTime;
  });

  const totalPnlUsd = closedTrades.reduce((sum, trade) => sum + safeNumber(trade.pnlUsd), 0);
  const totalRiskedUsd = closedTrades.reduce((sum, trade) => sum + safeNumber(trade.costUsd), 0);
  const totalWinnersPnl = winners.reduce((sum, trade) => sum + safeNumber(trade.pnlUsd), 0);
  const totalLosersPnl = losers.reduce((sum, trade) => sum + safeNumber(trade.pnlUsd), 0);

  const probabilityBuckets = {
    "55-65%": buildEmptyBucket(),
    "65-75%": buildEmptyBucket(),
    "75-85%": buildEmptyBucket(),
    "85-95%": buildEmptyBucket(),
    "95%+": buildEmptyBucket(),
  };

  let outsideBucketTrades = 0;

  for (const trade of closedTrades) {
    const bucketLabel = getBucketLabel(trade.modelProbability);

    if (!bucketLabel) {
      outsideBucketTrades += 1;
      continue;
    }

    const bucket = probabilityBuckets[bucketLabel];
    bucket.trades += 1;
    bucket.totalPnlUsd = round(bucket.totalPnlUsd + safeNumber(trade.pnlUsd));
    bucket.totalRiskedUsd = round(bucket.totalRiskedUsd + safeNumber(trade.costUsd));

    if (trade.status === "WON") bucket.wins += 1;
    if (trade.status === "LOST") bucket.losses += 1;
  }

  for (const bucket of Object.values(probabilityBuckets)) {
    bucket.winRate = bucket.trades ? round((bucket.wins / bucket.trades) * 100) : 0;
    bucket.roiPct = bucket.totalRiskedUsd
      ? round((bucket.totalPnlUsd / bucket.totalRiskedUsd) * 100)
      : 0;
  }

  const tradesByDay = {};
  for (const trade of closedTrades) {
    const day = getTradeDate(trade);
    if (!day) continue;
    tradesByDay[day] = tradesByDay[day] || [];
    tradesByDay[day].push(trade);
  }

  const dailyTable = Object.entries(tradesByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, trades]) => ({
      date: day,
      ...buildDaySummary(trades),
    }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    reportDate: date,
    summary: {
      totalTrades: filteredTrades.length,
      openTrades: openTrades.length,
      closedTrades: closedTrades.length,
      wins: winners.length,
      losses: losers.length,
      winRate: closedTrades.length ? round((winners.length / closedTrades.length) * 100) : 0,
      averageWinnerUsd: winners.length ? round(average(winners.map((trade) => trade.pnlUsd))) : 0,
      averageLoserUsd: losers.length ? round(average(losers.map((trade) => trade.pnlUsd))) : 0,
      totalPnlUsd: round(totalPnlUsd),
      totalRiskedUsd: round(totalRiskedUsd),
      roiPct: totalRiskedUsd ? round((totalPnlUsd / totalRiskedUsd) * 100) : 0,
      maxDrawdownUsd: computeMaxDrawdown(sortedClosedTrades),
      totalWinnerPnlUsd: round(totalWinnersPnl),
      totalLoserPnlUsd: round(totalLosersPnl),
    },
    dailyTable,
    probabilityBuckets,
    outsideTrackedBuckets: {
      trades: outsideBucketTrades,
    },
    latestClosedTradeAt: sortedClosedTrades.at(-1)?.closedAt || null,
  };
}
