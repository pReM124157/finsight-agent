import { getAggregatedBtcPrice } from "../data/cryptoPriceClient.js";
import {
  getKalshiMarkets,
  getKalshiMarketOrderbook,
} from "../data/kalshiClient.js";
import {
  extractMarketProbabilityFromOrderbook,
} from "./mispricingEngine.js";
import { runPaperDecisionFlow } from "../execution/paperDecisionFlow.js";
import {
  saveMarketSnapshot,
  getSnapshotStats,
} from "../data/snapshotStore.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function textOfMarket(market) {
  return [
    market?.ticker,
    market?.title,
    market?.subtitle,
    market?.yes_sub_title,
    market?.no_sub_title,
    market?.rules_primary,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isBtcMarket(market) {
  const text = textOfMarket(market).toLowerCase();

  return (
    text.includes("bitcoin") ||
    text.includes("btc") ||
    text.includes("xbt")
  );
}

export function parseBtcTargetPrice(market) {
  const text = textOfMarket(market);

  const dollarMatches = [...text.matchAll(/\$?\s*([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]{4,6}(?:\.\d+)?)/g)]
    .map((match) => safeNumber(String(match[1]).replace(/,/g, "")))
    .filter((value) => value && value > 1000);

  if (dollarMatches.length === 0) return null;

  return dollarMatches[0];
}

export function inferMinutesRemaining(market) {
  const closeTime =
    market?.close_time ||
    market?.expiration_time ||
    market?.latest_expiration_time ||
    market?.expected_expiration_time;

  if (!closeTime) return 15;

  const diffMs = new Date(closeTime).getTime() - Date.now();
  const minutes = Math.ceil(diffMs / 60000);

  if (!Number.isFinite(minutes) || minutes <= 0) return 15;

  return Math.min(minutes, 60);
}

export async function scanKalshiBtcMarkets({
  limit = 25,
  maxCandidates = 5,
  status = "open",
  dryRun = false,
  riskLimits = null,
} = {}) {
  const startedAt = new Date().toISOString();

  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    return {
      ok: false,
      reason: "BTC_PRICE_UNAVAILABLE",
      btc,
      scannedAt: startedAt,
    };
  }

  const marketsResponse = await getKalshiMarkets({
    status,
    limit,
  });

  const allMarkets = marketsResponse.markets || [];
  const btcMarkets = allMarkets.filter(isBtcMarket).slice(0, maxCandidates);

  const snapshots = [];
  const decisions = [];
  const errors = [];

  for (const market of btcMarkets) {
    const marketTicker = market.ticker;
    const targetPrice = parseBtcTargetPrice(market);
    const minutesRemaining = inferMinutesRemaining(market);

    if (!marketTicker || !targetPrice) {
      const snapshot = saveMarketSnapshot({
        marketTicker,
        marketTitle: market.title || null,
        btcPrice: btc.price,
        targetPrice,
        minutesRemaining,
        decision: {
          action: "SKIPPED",
          reason: "TARGET_PRICE_NOT_PARSED",
        },
        rawMarket: market,
      });

      snapshots.push(snapshot);
      continue;
    }

    try {
      const orderbook = await getKalshiMarketOrderbook(marketTicker);
      const implied = extractMarketProbabilityFromOrderbook(orderbook);

      if (!implied.marketProbability) {
        const snapshot = saveMarketSnapshot({
          marketTicker,
          marketTitle: market.title || null,
          btcPrice: btc.price,
          targetPrice,
          minutesRemaining,
          orderbook: {
            yesLevels: orderbook.yes?.length || 0,
            noLevels: orderbook.no?.length || 0,
          },
          implied,
          decision: {
            action: "SKIPPED",
            reason: "MARKET_PROBABILITY_NOT_AVAILABLE",
          },
          rawMarket: market,
        });

        snapshots.push(snapshot);
        continue;
      }

      let decision = null;

      if (!dryRun) {
        decision = await runPaperDecisionFlow({
          marketTicker,
          targetPrice,
          minutesRemaining,
          marketProbability: implied.marketProbability,
          yesBidPrice: implied.yesBid,
          yesAskPrice: implied.yesAsk,
          noBidPrice: implied.noBid,
          noAskPrice: implied.noAsk,
          annualizedVolatility: 0.55,
          momentumBps: 0,
          feeBps: 20,
          minEdgePct: 5,
          strongEdgePct: 10,
          maxAllowedSpreadPct: 8,
          riskLimits: riskLimits || undefined,
          notes: "Created by Kalshi BTC market scanner",
        });
      }

      const snapshot = saveMarketSnapshot({
        marketTicker,
        marketTitle: market.title || null,
        btcPrice: btc.price,
        targetPrice,
        minutesRemaining,
        orderbook: {
          yesLevels: orderbook.yes?.length || 0,
          noLevels: orderbook.no?.length || 0,
          yesTop: orderbook.yes?.[0] || null,
          noTop: orderbook.no?.[0] || null,
        },
        implied,
        decision: dryRun
          ? {
              action: "DRY_RUN",
              reason: "SCAN_ONLY",
            }
          : {
              ok: decision?.ok,
              stage: decision?.stage,
              action: decision?.action,
              reason: decision?.reason,
              bestSide: decision?.mispricing?.bestSide || null,
              bestAdjustedEdge: decision?.mispricing?.bestAdjustedEdge || null,
              paperTradeId: decision?.paperTrade?.trade?.id || null,
            },
        rawMarket: {
          ticker: market.ticker,
          title: market.title,
          status: market.status,
          close_time: market.close_time,
        },
      });

      snapshots.push(snapshot);
      decisions.push(decision);
    } catch (error) {
      errors.push({
        marketTicker,
        message: error.message,
        status: error.status || null,
        body: error.body || null,
      });
    }
  }

  return {
    ok: true,
    scannedAt: startedAt,
    btc: {
      price: btc.price,
      providerCount: btc.providerCount,
      timestamp: btc.timestamp,
    },
    totalMarketsFetched: allMarkets.length,
    btcMarketsFound: btcMarkets.length,
    snapshotsCreated: snapshots.length,
    paperDecisions: decisions.length,
    errors,
    snapshotStats: getSnapshotStats(),
    snapshots,
  };
}
