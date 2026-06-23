import { getAggregatedBtcPrice } from "../data/cryptoPriceClient.js";
import {
  getKalshiMarkets,
  getKalshiMarketOrderbook,
} from "../data/kalshiClient.js";
import { estimateBtcReachability } from "./reachabilityEngine.js";
import {
  calculateMispricing,
  extractMarketProbabilityFromOrderbook,
} from "./mispricingEngine.js";
import { runPaperDecisionFlow } from "../execution/paperDecisionFlow.js";
import {
  saveMarketSnapshot,
  getSnapshotStats,
} from "../data/snapshotStore.js";
import {
  addLabeledSnapshot,
  buildFeatureRowFromSnapshot,
} from "../dataset/labeledSnapshotDataset.js";

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
  const matchedTerms = [
    "bitcoin",
    "btc",
    "xbt",
    "crypto",
    "cryptocurrency",
    "bitcoin price",
    "btc price",
  ].filter((term) => text.includes(term));

  const hasStrongCryptoKeyword =
    matchedTerms.includes("bitcoin") ||
    matchedTerms.includes("btc") ||
    matchedTerms.includes("xbt") ||
    matchedTerms.includes("bitcoin price") ||
    matchedTerms.includes("btc price");

  const hasCryptoContext =
    (matchedTerms.includes("crypto") || matchedTerms.includes("cryptocurrency")) &&
    (text.includes("price") || text.includes("bitcoin") || text.includes("btc") || text.includes("xbt"));

  return hasStrongCryptoKeyword || hasCryptoContext;
}

export function explainMarketClassification(market) {
  const text = textOfMarket(market);
  const lower = text.toLowerCase();

  const matchedTerms = [
    "bitcoin",
    "btc",
    "xbt",
    "crypto",
    "cryptocurrency",
    "bitcoin price",
    "btc price",
  ].filter((term) => lower.includes(term));

  const targetPrice = parseBtcTargetPrice(market);
  const minutesRemaining = inferMinutesRemaining(market);

  return {
    ticker: market?.ticker || null,
    title: market?.title || null,
    textPreview: text.slice(0, 300),
    isBtcMarket: isBtcMarket(market),
    matchedTerms,
    targetPrice,
    minutesRemaining,
    status: market?.status || null,
    close_time: market?.close_time || null,
  };
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

function buildObservationDecision({ reachability, mispricing }) {
  return {
    ok: true,
    stage: "OBSERVATION_ONLY",
    action: "OBSERVATION_ONLY",
    reason: "DRY_RUN_SCAN_ONLY",
    bestSide: mispricing?.bestSide || null,
    bestAdjustedEdge: mispricing?.bestAdjustedEdge || null,
    confidenceScore: mispricing?.confidenceScore || null,
    modelProbability: reachability?.modelProbability || null,
    marketProbability: mispricing?.marketProbability || null,
  };
}

export async function scanKalshiBtcMarkets({
  limit = 25,
  maxCandidates = 5,
  status = "open",
  dryRun = false,
  riskLimits = null,
  annualizedVolatility = 0.55,
  momentumBps = 0,
  feeBps = 20,
  minEdgePct = 5,
  strongEdgePct = 10,
  maxAllowedSpreadPct = 8,
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
  const marketClassificationSample = allMarkets
    .slice(0, 10)
    .map(explainMarketClassification);
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

      const reachability = estimateBtcReachability({
        currentPrice: btc.price,
        targetPrice,
        minutesRemaining,
        annualizedVolatility,
        momentumBps,
        marketProbability: implied.marketProbability,
      });
      const mispricing = reachability.ok
        ? calculateMispricing({
            marketProbability: implied.marketProbability,
            modelProbability: reachability.modelProbability,
            yesBidPrice: implied.yesBid,
            yesAskPrice: implied.yesAsk,
            noBidPrice: implied.noBid,
            noAskPrice: implied.noAsk,
            feeBps,
            minEdgePct,
            strongEdgePct,
            maxAllowedSpreadPct,
          })
        : {
            ok: false,
            reason: reachability.reason,
            decision: "NO_TRADE",
          };

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
          annualizedVolatility,
          momentumBps,
          feeBps,
          minEdgePct,
          strongEdgePct,
          maxAllowedSpreadPct,
          riskLimits: riskLimits || undefined,
          notes: "Created by Kalshi BTC market scanner",
        });
      } else {
        decision = buildObservationDecision({ reachability, mispricing });
      }

      const snapshot = saveMarketSnapshot({
        marketTicker,
        marketTitle: market.title || null,
        btcPrice: btc.price,
        targetPrice,
        minutesRemaining,
        annualizedVolatility,
        momentumBps,
        orderbook: {
          yesLevels: orderbook.yes?.length || 0,
          noLevels: orderbook.no?.length || 0,
          yesTop: orderbook.yes?.[0] || null,
          noTop: orderbook.no?.[0] || null,
        },
        implied,
        reachability,
        mispricing,
        decision: dryRun
          ? decision
          : {
              ok: decision?.ok,
              stage: decision?.stage,
              action: decision?.action,
              reason: decision?.reason,
              bestSide: decision?.mispricing?.bestSide || null,
              bestAdjustedEdge: decision?.mispricing?.bestAdjustedEdge || null,
              confidenceScore: decision?.mispricing?.confidenceScore || null,
              modelProbability: decision?.reachability?.modelProbability || null,
              marketProbability: decision?.mispricing?.marketProbability || null,
              paperTradeId: decision?.paperTrade?.trade?.id || null,
            },
        rawMarket: {
          ticker: market.ticker,
          title: market.title,
          status: market.status,
          close_time: market.close_time,
        },
      });

      if (dryRun) {
        addLabeledSnapshot(buildFeatureRowFromSnapshot(snapshot));
      }

      snapshots.push(snapshot);
      if (!dryRun) {
        decisions.push(decision);
      }
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
    mode: dryRun ? "OBSERVATION_ONLY" : "PAPER",
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
    marketClassificationSample,
    snapshotStats: getSnapshotStats(),
    snapshots,
  };
}
