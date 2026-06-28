import { getAggregatedBtcPrice } from "../data/cryptoPriceClient.js";
import { estimateBtcReachability } from "../agents/reachabilityEngine.js";
import { calculateMispricing } from "../agents/mispricingEngine.js";
import {
  createPaperTrade,
  getPaperTrades,
  LIVE_STRATEGY_NAME,
  PAPER_TRADE_SOURCES,
} from "./paperTradingEngine.js";
import {
  evaluateKalshiTradeRisk,
  summarizePaperRiskState,
  defaultKalshiRiskLimits,
} from "../risk/kalshiRiskEngine.js";
import { evaluateTargetDistanceGuard } from "../risk/targetDistanceGuard.js";
import { evaluateDisagreementGuard } from "../risk/disagreementGuard.js";
import {
  evaluateStrategyZoneGuard,
  getStrategyZoneConfig,
} from "../risk/strategyZoneGuard.js";
import { evaluateNoSideShadow } from "../shadow/noSideShadowAudit.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getEntryProbabilityForSide({ side, mispricing }) {
  if (side === "YES") return mispricing?.yes?.ask;
  if (side === "NO") return mispricing?.no?.ask;
  return null;
}

function getUtcDateKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function buildDailyLossKillSwitch({ currentState, riskLimits }) {
  const maxDailyLossUsd = safeNumber(riskLimits?.maxDailyLossUsd, 15);
  const dailyLossUsd = safeNumber(currentState?.dailyLossUsd, 0);
  const triggered = dailyLossUsd >= maxDailyLossUsd;

  return {
    triggered,
    date: getUtcDateKey(),
    dailyLossUsd: Number(dailyLossUsd.toFixed(2)),
    maxDailyLossUsd: Number(maxDailyLossUsd.toFixed(2)),
  };
}

export async function runPaperDecisionFlow({
  marketTicker,
  targetPrice,
  minutesRemaining = 15,
  marketProbability,
  yesBidPrice,
  yesAskPrice,
  noBidPrice,
  noAskPrice,
  requestedSizeUsd = null,
  annualizedVolatility = 0.55,
  momentumBps = 0,
  feeBps = 20,
  minEdgePct = 5,
  strongEdgePct = 10,
  maxAllowedSpreadPct = 8,
  riskLimits = defaultKalshiRiskLimits,
  notes = "",
} = {}) {
  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    return {
      ok: false,
      stage: "BTC_PRICE",
      reason: btc.reason || "BTC_PRICE_UNAVAILABLE",
      btc,
    };
  }

  const currentPrice = btc.price;
  const target = safeNumber(targetPrice);

  if (!marketTicker) {
    return {
      ok: false,
      stage: "INPUT_VALIDATION",
      reason: "MISSING_MARKET_TICKER",
    };
  }

  if (!target) {
    return {
      ok: false,
      stage: "INPUT_VALIDATION",
      reason: "MISSING_TARGET_PRICE",
    };
  }

  const reachability = estimateBtcReachability({
    currentPrice,
    targetPrice: target,
    minutesRemaining,
    annualizedVolatility,
    momentumBps,
    marketProbability,
    marketTicker,
  });

  if (!reachability.ok) {
    return {
      ok: false,
      stage: "REACHABILITY",
      reason: reachability.reason,
      btc,
      reachability,
    };
  }

  const distanceGuard = evaluateTargetDistanceGuard({
    currentPrice,
    targetPrice: target,
    minutesRemaining,
  });

  if (distanceGuard.status === "REJECTED") {
    return {
      ok: true,
      stage: "TARGET_DISTANCE",
      action: "NO_PAPER_TRADE",
      reason: distanceGuard.reason,
      btc,
      reachability,
      distanceGuard,
      mispricing: null,
      risk: null,
      paperTrade: null,
    };
  }

  const mispricing = calculateMispricing({
    marketProbability,
    modelProbability: reachability.modelProbability,
    yesBidPrice,
    yesAskPrice,
    noBidPrice,
    noAskPrice,
    feeBps,
    minEdgePct,
    strongEdgePct,
    maxAllowedSpreadPct,
  });

  if (!mispricing.ok) {
    return {
      ok: false,
      stage: "MISPRICING",
      reason: mispricing.reason,
      btc,
      reachability,
      mispricing,
    };
  }

  const shadowNoTrade = evaluateNoSideShadow({
    marketTicker,
    snapshotId: null,
    targetPrice: target,
    btcPrice: currentPrice,
    minutesRemaining,
    momentumBps,
    mispricing,
    reachability,
    requestedSizeUsd,
  });

  if (distanceGuard.status === "WATCH_ONLY") {
    return {
      ok: true,
      stage: "TARGET_DISTANCE",
      action: "NO_PAPER_TRADE",
      reason: distanceGuard.reason,
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      risk: null,
      paperTrade: null,
    };
  }

  const side = mispricing.bestSide;

  if (side === "NO") {
    return {
      ok: true,
      stage: "NO_SIDE_SHADOW_MODE",
      action: "NO_PAPER_TRADE",
      reason: shadowNoTrade.candidate
        ? "NO_SIDE_SHADOW_CANDIDATE_RECORDED"
        : "NO_SIDE_SHADOW_ONLY",
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      risk: null,
      paperTrade: null,
    };
  }

  const entryProbability = getEntryProbabilityForSide({ side, mispricing });
  // Strategy zone updated 2026-06-27:
  // keep 6-10% edge and 8-12 min window, but require 60c <= YES ask < 95c.
  // Settled-trade review showed sub-50c entries losing while 60c+ entries
  // behaved like continuation bets and won materially more often.
  const strategyZoneGuard = evaluateStrategyZoneGuard({
    side,
    adjustedEdge: mispricing.bestAdjustedEdge,
    minutesRemaining,
    entryProbability,
  });

  if (!strategyZoneGuard.ok) {
    return {
      ok: true,
      stage: "STRATEGY_ZONE_GUARD",
      action: "NO_PAPER_TRADE",
      reason: strategyZoneGuard.reason,
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      strategyZoneGuard,
      risk: null,
      paperTrade: null,
    };
  }

  if (mispricing.decision !== "TRADE") {
    return {
      ok: true,
      stage: "DECISION",
      action: "NO_PAPER_TRADE",
      reason: `MISPRICING_DECISION_${mispricing.decision}`,
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      strategyZoneGuard,
      risk: null,
      paperTrade: null,
    };
  }

  const openTrades = getPaperTrades({ status: "OPEN", limit: 500 });
  const allRecentTrades = getPaperTrades({ limit: 1000 });
  const currentState = summarizePaperRiskState(allRecentTrades);
  const maxOpenPositions = safeNumber(riskLimits?.maxOpenPositions, null);
  const paperKillSwitch = buildDailyLossKillSwitch({ currentState, riskLimits });

  if (paperKillSwitch.triggered) {
    console.log("[paper] daily loss limit hit — no new trades today", paperKillSwitch);
    return {
      ok: true,
      stage: "PAPER_DAILY_LOSS_LIMIT",
      action: "NO_PAPER_TRADE",
      reason: "PAPER_DAILY_LOSS_LIMIT_HIT",
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      strategyZoneGuard,
      risk: null,
      paperKillSwitch,
      paperTrade: null,
    };
  }

  if (maxOpenPositions !== null && openTrades.length >= maxOpenPositions) {
    return {
      ok: true,
      stage: "PAPER_OPEN_POSITION_LIMIT",
      action: "NO_PAPER_TRADE",
      reason: "PAPER_MAX_OPEN_POSITIONS_REACHED",
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      strategyZoneGuard,
      risk: null,
      paperKillSwitch,
      paperTrade: null,
    };
  }

  const autoSizeUsd =
    mispricing.bestAdjustedEdge >= 25 ? 500 :
    mispricing.bestAdjustedEdge >= 20 ? 250 :
    mispricing.bestAdjustedEdge >= 15 ? 100 :
    mispricing.bestAdjustedEdge >= 10 ? 50 :
    25;

  const estimatedSizeUsd =
    Number.isFinite(Number(requestedSizeUsd)) && Number(requestedSizeUsd) > 0
      ? Number(requestedSizeUsd)
      : autoSizeUsd;

  const disagreementGuard = evaluateDisagreementGuard({
    modelProbabilityYes: reachability.modelProbability,
    marketProbabilityYes: mispricing.marketProbability,
    requestedSizeUsd: estimatedSizeUsd,
    disagreementStats: null,
  });

  if (disagreementGuard.adjustedSizeUsd <= 0) {
    return {
      ok: true,
      stage: "DISAGREEMENT_GUARD",
      action: "NO_PAPER_TRADE",
      reason: "DISAGREEMENT_GUARD_BLOCKED",
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      strategyZoneGuard,
      disagreementGuard,
      risk: null,
      paperKillSwitch,
      paperTrade: null,
    };
  }

  const risk = evaluateKalshiTradeRisk({
    tradeCandidate: {
      mode: "PAPER",
      side,
      sizeUsd: disagreementGuard.adjustedSizeUsd,
      adjustedEdge: mispricing.bestAdjustedEdge,
      confidenceScore: mispricing.confidenceScore,
      marketTicker,
    },
    currentState: {
      ...currentState,
      openExposureUsd: currentState.openExposureUsd,
      openTrades: openTrades.length,
    },
    recentTrades: allRecentTrades,
    limits: riskLimits,
  });

  if (!risk.approved) {
    return {
      ok: true,
      stage: "RISK",
      action: "RISK_REJECTED",
      reason: risk.reason,
      btc,
      reachability,
      distanceGuard,
      mispricing,
      shadowNoTrade,
      strategyZoneGuard,
      risk,
      paperKillSwitch,
      paperTrade: null,
    };
  }

  const paperTrade = createPaperTrade({
    marketTicker,
    side,
    entryProbability,
    modelProbability: reachability.modelProbability,
    marketProbability: mispricing.marketProbability,
    adjustedEdge: mispricing.bestAdjustedEdge,
    rawEdge: mispricing.bestRawEdge,
    btcPrice: currentPrice,
    targetPrice: target,
    minutesRemaining,
    confidenceScore: mispricing.confidenceScore,
    sizeUsd: disagreementGuard.adjustedSizeUsd,
    source: "PAPER_DECISION_FLOW",
    notes,
    strategy: {
      name: LIVE_STRATEGY_NAME,
      guardStatus: strategyZoneGuard.status,
      guardReason: strategyZoneGuard.reason,
      guardTags: strategyZoneGuard.tags,
      config: getStrategyZoneConfig(),
      acceptedAt: new Date().toISOString(),
      sessionId: process.env.KALSHI_ACTIVE_SESSION_ID || null,
    },
    tradeSource: PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY,
    strategySessionId: process.env.KALSHI_ACTIVE_SESSION_ID || null,
    strategyName: LIVE_STRATEGY_NAME,
    isStrategyTrade: true,
  });

  return {
    ok: Boolean(paperTrade.ok),
    stage: paperTrade.ok ? "PAPER_TRADE_CREATED" : "PAPER_TRADE_FAILED",
    action: paperTrade.ok ? "PAPER_TRADE_CREATED" : "NO_PAPER_TRADE",
    reason: paperTrade.ok ? "TRADE_CREATED" : paperTrade.reason,
    btc,
    reachability,
    distanceGuard,
    mispricing,
    shadowNoTrade,
    strategyZoneGuard,
    disagreementGuard,
    risk,
    paperKillSwitch,
    paperTrade,
  };
}
