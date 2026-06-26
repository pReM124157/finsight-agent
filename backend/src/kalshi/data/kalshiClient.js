import { kalshiConfig, getKalshiConfigSummary } from "../utils/kalshiConfig.js";
import { fetchJson } from "../utils/http.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOrderbookLevels(levels = []) {
  return (Array.isArray(levels) ? levels : [])
    .map((level) => {
      if (!Array.isArray(level) || level.length < 2) return null;

      const rawPrice = safeNumber(level[0]);
      const rawSize = safeNumber(level[1]);

      if (rawPrice === null || rawSize === null) return null;

      // Kalshi orderbook_fp prices are returned in dollar units from 0.0000 to 1.0000.
      // The rest of the scanner stack expects 0-100 probability-style price units.
      const normalizedPrice = rawPrice <= 1 ? rawPrice * 100 : rawPrice;

      return [
        Number(normalizedPrice.toFixed(3)),
        Number(rawSize.toFixed(2)),
      ];
    })
    .filter(Boolean)
    .sort((a, b) => b[0] - a[0]);
}

function buildUrl(path, params = {}) {
  const url = new URL(`${kalshiConfig.baseUrl}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export function getKalshiStatus() {
  return getKalshiConfigSummary();
}

export async function getKalshiMarkets({
  seriesTicker = kalshiConfig.defaultSeriesTicker,
  status = "open",
  limit = 100,
} = {}) {
  const url = buildUrl("/markets", {
    series_ticker: seriesTicker || undefined,
    status,
    limit,
  });

  const data = await fetchJson(url, {
    timeoutMs: kalshiConfig.requestTimeoutMs,
  });

  return {
    ok: true,
    source: "KALSHI",
    type: "markets",
    count: Array.isArray(data?.markets) ? data.markets.length : 0,
    markets: data?.markets || [],
    raw: data,
  };
}

export async function getKalshiMarketOrderbook(ticker) {
  if (!ticker) {
    return {
      ok: false,
      reason: "MISSING_MARKET_TICKER",
    };
  }

  const url = buildUrl(`/markets/${encodeURIComponent(ticker)}/orderbook`);

  const data = await fetchJson(url, {
    timeoutMs: kalshiConfig.requestTimeoutMs,
  });

  const yes = normalizeOrderbookLevels(
    data?.orderbook?.yes ||
    data?.orderbook_fp?.yes_dollars ||
    []
  );
  const no = normalizeOrderbookLevels(
    data?.orderbook?.no ||
    data?.orderbook_fp?.no_dollars ||
    []
  );

  return {
    ok: true,
    source: "KALSHI",
    type: "orderbook",
    ticker,
    yes,
    no,
    raw: data,
  };
}
