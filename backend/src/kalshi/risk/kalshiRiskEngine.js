function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveKillSwitchEnabled(value = process.env.KALSHI_KILL_SWITCH_ENABLED) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "false" || normalized === "0" || normalized === "off") {
      return false;
    }
    if (normalized === "true" || normalized === "1" || normalized === "on") {
      return true;
    }
  }

  return true;
}

export const defaultKalshiRiskLimits = {
  paperTradingOnly: true,
  killSwitchEnabled: resolveKillSwitchEnabled(),

  maxTradeSizeUsd: 250,
  maxOpenExposureUsd: 1000,
  maxDailyLossUsd: 250,
  maxTradesPerDay: 20,

  minAdjustedEdgePct: 5,
  minConfidenceScore: 60,

  allowLiveExecution: false,
};

export { resolveKillSwitchEnabled };

export function evaluateKalshiTradeRisk({
  tradeCandidate,
  currentState = {},
  limits = defaultKalshiRiskLimits,
} = {}) {
  if (!tradeCandidate) {
    return {
      approved: false,
      status: "REJECTED",
      reason: "MISSING_TRADE_CANDIDATE",
    };
  }

  const mergedLimits = {
    ...defaultKalshiRiskLimits,
    ...(limits || {}),
  };

  const checks = [];

  function reject(code, message, extra = {}) {
    checks.push({
      code,
      passed: false,
      message,
      ...extra,
    });
  }

  function pass(code, message, extra = {}) {
    checks.push({
      code,
      passed: true,
      message,
      ...extra,
    });
  }

  if (mergedLimits.killSwitchEnabled) {
    reject("KILL_SWITCH_ENABLED", "Trading is blocked because kill switch is enabled.");
  } else {
    pass("KILL_SWITCH_CLEAR", "Kill switch is not enabled.");
  }

  if (!mergedLimits.allowLiveExecution && tradeCandidate.mode === "LIVE") {
    reject("LIVE_EXECUTION_DISABLED", "Live execution is disabled.");
  } else {
    pass("EXECUTION_MODE_ALLOWED", "Execution mode is allowed.");
  }

  const tradeSize = safeNumber(tradeCandidate.sizeUsd);
  const adjustedEdge = safeNumber(tradeCandidate.adjustedEdge);
  const confidence = safeNumber(tradeCandidate.confidenceScore);
  const openExposure = safeNumber(currentState.openExposureUsd);
  const dailyLoss = safeNumber(currentState.dailyLossUsd);
  const tradesToday = safeNumber(currentState.tradesToday);

  if (tradeSize <= 0) {
    reject("INVALID_TRADE_SIZE", "Trade size must be greater than zero.", { tradeSize });
  } else if (tradeSize > mergedLimits.maxTradeSizeUsd) {
    reject("MAX_TRADE_SIZE_EXCEEDED", "Trade size exceeds max allowed size.", {
      tradeSize,
      maxTradeSizeUsd: mergedLimits.maxTradeSizeUsd,
    });
  } else {
    pass("TRADE_SIZE_OK", "Trade size is within limit.", {
      tradeSize,
      maxTradeSizeUsd: mergedLimits.maxTradeSizeUsd,
    });
  }

  if (openExposure + tradeSize > mergedLimits.maxOpenExposureUsd) {
    reject("MAX_OPEN_EXPOSURE_EXCEEDED", "Open exposure would exceed limit.", {
      openExposure,
      tradeSize,
      maxOpenExposureUsd: mergedLimits.maxOpenExposureUsd,
    });
  } else {
    pass("OPEN_EXPOSURE_OK", "Open exposure is within limit.", {
      openExposure,
      tradeSize,
      maxOpenExposureUsd: mergedLimits.maxOpenExposureUsd,
    });
  }

  if (Math.abs(dailyLoss) >= mergedLimits.maxDailyLossUsd) {
    reject("MAX_DAILY_LOSS_EXCEEDED", "Daily loss limit has been reached.", {
      dailyLoss,
      maxDailyLossUsd: mergedLimits.maxDailyLossUsd,
    });
  } else {
    pass("DAILY_LOSS_OK", "Daily loss is within limit.", {
      dailyLoss,
      maxDailyLossUsd: mergedLimits.maxDailyLossUsd,
    });
  }

  if (tradesToday >= mergedLimits.maxTradesPerDay) {
    reject("MAX_TRADES_PER_DAY_EXCEEDED", "Maximum trades per day reached.", {
      tradesToday,
      maxTradesPerDay: mergedLimits.maxTradesPerDay,
    });
  } else {
    pass("TRADE_COUNT_OK", "Trade count is within limit.", {
      tradesToday,
      maxTradesPerDay: mergedLimits.maxTradesPerDay,
    });
  }

  if (adjustedEdge < mergedLimits.minAdjustedEdgePct) {
    reject("EDGE_TOO_LOW", "Adjusted edge is below minimum threshold.", {
      adjustedEdge,
      minAdjustedEdgePct: mergedLimits.minAdjustedEdgePct,
    });
  } else {
    pass("EDGE_OK", "Adjusted edge is above threshold.", {
      adjustedEdge,
      minAdjustedEdgePct: mergedLimits.minAdjustedEdgePct,
    });
  }

  if (confidence < mergedLimits.minConfidenceScore) {
    reject("CONFIDENCE_TOO_LOW", "Confidence score is below minimum threshold.", {
      confidence,
      minConfidenceScore: mergedLimits.minConfidenceScore,
    });
  } else {
    pass("CONFIDENCE_OK", "Confidence score is above threshold.", {
      confidence,
      minConfidenceScore: mergedLimits.minConfidenceScore,
    });
  }

  const failedChecks = checks.filter((check) => !check.passed);

  return {
    approved: failedChecks.length === 0,
    status: failedChecks.length === 0 ? "APPROVED" : "REJECTED",
    reason: failedChecks.length === 0 ? "RISK_CHECK_PASSED" : failedChecks[0].code,
    failedChecks,
    checks,
    limits: mergedLimits,
  };
}

export function summarizePaperRiskState(trades = []) {
  const openTrades = trades.filter((trade) => trade.status === "OPEN");
  const today = new Date().toISOString().slice(0, 10);

  const todayTrades = trades.filter((trade) =>
    String(trade.openedAt || trade.timestamp || "").startsWith(today)
  );

  const closedToday = todayTrades.filter((trade) =>
    ["WON", "LOST"].includes(trade.status)
  );

  const openExposureUsd = openTrades.reduce(
    (sum, trade) => sum + safeNumber(trade.costUsd),
    0
  );

  const dailyPnlUsd = closedToday.reduce(
    (sum, trade) => sum + safeNumber(trade.pnlUsd),
    0
  );

  const dailyLossUsd = dailyPnlUsd < 0 ? Math.abs(dailyPnlUsd) : 0;

  return {
    openTrades: openTrades.length,
    openExposureUsd: Number(openExposureUsd.toFixed(2)),
    tradesToday: todayTrades.length,
    dailyPnlUsd: Number(dailyPnlUsd.toFixed(2)),
    dailyLossUsd: Number(dailyLossUsd.toFixed(2)),
  };
}
