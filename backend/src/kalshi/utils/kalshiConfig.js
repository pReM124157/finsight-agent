export const kalshiConfig = {
  enabled: process.env.KALSHI_ENABLED === "true",

  // Keep base URL configurable because Kalshi may use prod/demo environments.
  baseUrl: process.env.KALSHI_BASE_URL || "https://api.elections.kalshi.com/trade-api/v2",

  apiKeyId: process.env.KALSHI_API_KEY_ID || "",
  privateKey: process.env.KALSHI_PRIVATE_KEY || "",

  defaultSeriesTicker: process.env.KALSHI_BTC_SERIES_TICKER || "KXBTC15M",
  requestTimeoutMs: Number(process.env.KALSHI_REQUEST_TIMEOUT_MS || 8000),

  paperTradingOnly: process.env.KALSHI_PAPER_TRADING_ONLY !== "false",
};

export function getKalshiConfigSummary() {
  return {
    enabled: kalshiConfig.enabled,
    hasApiKeyId: Boolean(kalshiConfig.apiKeyId),
    hasPrivateKey: Boolean(kalshiConfig.privateKey),
    hasDefaultSeriesTicker: Boolean(kalshiConfig.defaultSeriesTicker),
    baseUrl: kalshiConfig.baseUrl,
    paperTradingOnly: kalshiConfig.paperTradingOnly,
  };
}
