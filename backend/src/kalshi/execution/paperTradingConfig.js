function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getPaperTradingConfig() {
  const requestedSizeUsd = Math.max(1, safeNumber(process.env.KALSHI_FIXED_TRADE_SIZE_USD, 5));
  const paperBankrollUsd = Math.max(requestedSizeUsd, safeNumber(process.env.PAPER_BANKROLL_USD, 50));
  const maxPositionSizeUsd = Math.max(
    requestedSizeUsd,
    safeNumber(process.env.PAPER_MAX_POSITION_SIZE_USD, requestedSizeUsd)
  );
  const maxOpenPositions = Math.max(1, Math.floor(safeNumber(process.env.PAPER_MAX_OPEN_POSITIONS, 3)));
  const maxDailyLossUsd = Math.max(1, safeNumber(process.env.PAPER_MAX_DAILY_LOSS_USD, 15));

  return {
    requestedSizeUsd: Number(requestedSizeUsd.toFixed(2)),
    paperBankrollUsd: Number(paperBankrollUsd.toFixed(2)),
    maxPositionSizeUsd: Number(maxPositionSizeUsd.toFixed(2)),
    maxOpenPositions,
    maxDailyLossUsd: Number(maxDailyLossUsd.toFixed(2)),
    maxOpenExposureUsd: Number((maxPositionSizeUsd * maxOpenPositions).toFixed(2)),
  };
}

export function buildPaperRiskLimits(overrides = {}) {
  const config = getPaperTradingConfig();

  return {
    killSwitchEnabled: false,
    allowLiveExecution: false,
    maxTradeSizeUsd: config.maxPositionSizeUsd,
    maxOpenExposureUsd: config.maxOpenExposureUsd,
    maxDailyLossUsd: config.maxDailyLossUsd,
    maxOpenPositions: config.maxOpenPositions,
    ...overrides,
  };
}
