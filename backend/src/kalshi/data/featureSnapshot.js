import { getAggregatedBtcPrice } from "./cryptoPriceClient.js";
import { getMarketSnapshots } from "./snapshotStore.js";
import { inferBtcMarketDirectionWithFallback } from "../utils/btcMarketDirection.js";

export const CURRENT_FEATURE_PIPELINE_VERSION = "v2-orderbook-fix";

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundNumber(value, digits = 4) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function buildSessionBucket(timestamp) {
  const date = new Date(timestamp || Date.now());
  const hour = date.getUTCHours();

  if (hour < 6) return "UTC_OVERNIGHT";
  if (hour < 12) return "UTC_MORNING";
  if (hour < 18) return "UTC_AFTERNOON";
  return "UTC_EVENING";
}

function getPriceSeries({ marketTicker = null, fallbackLimit = 500 } = {}) {
  const sameMarket = marketTicker
    ? getMarketSnapshots({ marketTicker, limit: fallbackLimit }).reverse()
    : [];

  if (sameMarket.length >= 2) {
    return sameMarket;
  }

  return getMarketSnapshots({ limit: fallbackLimit }).reverse();
}

function getWindowPrices(series, minutesWindow) {
  const nowMs = Date.now();
  return series.filter((snapshot) => {
    const createdAtMs = new Date(snapshot.createdAt || snapshot.timestamp || 0).getTime();
    if (!Number.isFinite(createdAtMs)) return false;
    return nowMs - createdAtMs <= minutesWindow * 60 * 1000;
  });
}

function calculateRealizedVolPct(series, minutesWindow) {
  const window = getWindowPrices(series, minutesWindow)
    .map((snapshot) => safeNumber(snapshot.btcPrice))
    .filter((price) => price && price > 0);

  if (window.length < 2) {
    return null;
  }

  const mean = window.reduce((sum, price) => sum + price, 0) / window.length;
  if (!mean) return null;

  const variance =
    window.reduce((sum, price) => sum + ((price - mean) ** 2), 0) / window.length;

  return roundNumber((Math.sqrt(variance) / mean) * 100, 6);
}

function calculateMomentumBps(series, minutesWindow, currentPrice) {
  const current = safeNumber(currentPrice);
  if (!current || current <= 0) return null;

  const window = getWindowPrices(series, minutesWindow)
    .map((snapshot) => ({
      btcPrice: safeNumber(snapshot.btcPrice),
      createdAt: snapshot.createdAt || snapshot.timestamp || null,
    }))
    .filter((snapshot) => snapshot.btcPrice && snapshot.createdAt)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const oldest = window[0]?.btcPrice || null;
  if (!oldest || oldest <= 0) return null;

  return roundNumber(((current - oldest) / oldest) * 10000, 2);
}

function calculateOrderbookImbalance(orderbook = {}) {
  const yesQty = (orderbook.yes || []).reduce((sum, level) => sum + safeNumber(level?.[1], 0), 0);
  const noQty = (orderbook.no || []).reduce((sum, level) => sum + safeNumber(level?.[1], 0), 0);
  const totalQty = yesQty + noQty;

  if (!totalQty) return null;
  return roundNumber((yesQty - noQty) / totalQty, 6);
}

function buildDataQualityFlags({
  btcReference,
  targetPrice,
  minutesRemaining,
  implied,
  orderbookImbalance,
  historySeries,
}) {
  const flags = [];

  if (!btcReference?.ok) flags.push("BTC_REFERENCE_UNAVAILABLE");
  if (safeNumber(targetPrice) === null) flags.push("TARGET_PRICE_MISSING");
  if (safeNumber(minutesRemaining) === null) flags.push("MINUTES_REMAINING_MISSING");
  if (safeNumber(implied?.marketProbability) === null) flags.push("MARKET_PROBABILITY_MISSING");
  if (orderbookImbalance === null) flags.push("ORDERBOOK_IMBALANCE_MISSING");
  if ((historySeries || []).length < 2) flags.push("LIMITED_HISTORY");

  return flags;
}

export async function buildFeatureSnapshot(
  {
    marketTicker,
    targetPrice,
    minutesRemaining,
    market = null,
    orderbook = null,
    implied = null,
    reachability = null,
    snapshotId = null,
    btcReference = null,
  } = {},
  modelOutputs = {}
) {
  const btcRef = btcReference || await getAggregatedBtcPrice().catch(() => null);
  const btcPrice = safeNumber(btcRef?.price);
  const target = safeNumber(targetPrice);
  const minutes = safeNumber(minutesRemaining);
  const distanceUsd =
    btcPrice !== null && target !== null
      ? roundNumber(target - btcPrice, 2)
      : null;
  const distanceBps =
    btcPrice && distanceUsd !== null
      ? roundNumber((Math.abs(distanceUsd) / btcPrice) * 10000, 2)
      : null;

  const historySeries = getPriceSeries({ marketTicker });
  const orderbookImbalance = calculateOrderbookImbalance(orderbook);
  const now = new Date().toISOString();
  const modelProbabilityYes = safeNumber(reachability?.modelProbability);
  const marketProbabilityYes = safeNumber(implied?.marketProbability);
  const modelProbabilityNo =
    modelProbabilityYes !== null
      ? roundNumber(100 - modelProbabilityYes, 2)
      : safeNumber(modelOutputs?.modelNoProbability);
  const yesRawEdge = safeNumber(modelOutputs?.mispricing?.yes?.rawEdge);
  const noRawEdge = safeNumber(modelOutputs?.mispricing?.no?.rawEdge);
  const yesAdjustedEdge = safeNumber(modelOutputs?.mispricing?.yes?.adjustedEdge);
  const noAdjustedEdge = safeNumber(modelOutputs?.mispricing?.no?.adjustedEdge);
  const yesSpread = safeNumber(modelOutputs?.mispricing?.yes?.spread);
  const noSpread = safeNumber(modelOutputs?.mispricing?.no?.spread);
  const bestAdjustedEdge = safeNumber(modelOutputs?.mispricing?.bestAdjustedEdge);
  const bestRawEdge = safeNumber(modelOutputs?.mispricing?.bestRawEdge);
  const modelMarketDisagreementPts =
    modelProbabilityYes !== null && marketProbabilityYes !== null
      ? roundNumber(Math.abs(modelProbabilityYes - marketProbabilityYes), 2)
      : null;

  const featureRow = {
    id: `FEAT-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
    pipeline_version: CURRENT_FEATURE_PIPELINE_VERSION,
    snapshot_id: snapshotId || null,
    market_ticker: marketTicker || null,
    market_title: market?.title || null,
    captured_at: now,
    createdAt: now,

    btc_price: roundNumber(btcPrice, 2),
    target_price: roundNumber(target, 2),
    minutes_remaining: minutes,
    distance_usd: distanceUsd,
    distance_bps: distanceBps,

    realized_vol_5min: calculateRealizedVolPct(historySeries, 5),
    realized_vol_15min: calculateRealizedVolPct(historySeries, 15),
    realized_vol_30min: calculateRealizedVolPct(historySeries, 30),

    momentum_1min_bps: calculateMomentumBps(historySeries, 1, btcPrice),
    momentum_5min_bps: calculateMomentumBps(historySeries, 5, btcPrice),
    momentum_15min_bps: calculateMomentumBps(historySeries, 15, btcPrice),

    orderbook_imbalance: orderbookImbalance,
    market_prob_yes: roundNumber(implied?.marketProbability, 2),
    market_prob_no:
      safeNumber(implied?.marketProbability) !== null
        ? roundNumber(100 - implied.marketProbability, 2)
        : null,
    modelYesProbability: roundNumber(modelProbabilityYes, 2),
    modelNoProbability: roundNumber(modelProbabilityNo, 2),
    model_prob_yes: roundNumber(modelProbabilityYes, 2),
    model_prob_no:
      modelProbabilityYes !== null
        ? roundNumber(100 - modelProbabilityYes, 2)
        : null,
    reachabilityRaw: reachability || null,
    model_market_disagreement_pts: modelMarketDisagreementPts,
    yes_bid: roundNumber(implied?.yesBid, 2),
    yes_ask: roundNumber(implied?.yesAsk, 2),
    no_bid: roundNumber(implied?.noBid, 2),
    no_ask: roundNumber(implied?.noAsk, 2),
    marketProb: roundNumber(marketProbabilityYes, 2),
    rawYesEdge: roundNumber(yesRawEdge, 2),
    rawNoEdge: roundNumber(noRawEdge, 2),
    adjustedYesEdge: roundNumber(yesAdjustedEdge, 2),
    adjustedNoEdge: roundNumber(noAdjustedEdge, 2),
    bestAdjustedEdge: roundNumber(bestAdjustedEdge, 2),
    bestRawEdge: roundNumber(bestRawEdge, 2),
    mispricingDecision: modelOutputs?.mispricing?.decision || null,
    edgeGrade: modelOutputs?.mispricing?.edgeGrade || null,
    yesSpread: roundNumber(yesSpread, 2),
    noSpread: roundNumber(noSpread, 2),
    best_adjusted_edge: roundNumber(bestAdjustedEdge ?? yesAdjustedEdge, 2),
    raw_yes_edge: roundNumber(yesRawEdge, 2),
    yes_spread: roundNumber(yesSpread, 2),
    edge_grade: modelOutputs?.mispricing?.edgeGrade || null,
    mispricing_decision: modelOutputs?.mispricing?.decision || null,

    session_bucket: buildSessionBucket(now),
    provider_quotes: Array.isArray(btcRef?.quotes)
      ? btcRef.quotes.map((quote) => ({
          provider: quote.provider || null,
          symbol: quote.symbol || null,
          price: roundNumber(quote.price, 2),
          bid: roundNumber(quote.bid, 2),
          ask: roundNumber(quote.ask, 2),
          time: quote.time || null,
          error: quote.error || null,
        }))
      : [],

    settlement_outcome: null,
    settlement_btc_price: null,
    settlement_time: null,
    data_quality_flags: buildDataQualityFlags({
      btcReference: btcRef,
      targetPrice: target,
      minutesRemaining: minutes,
      implied,
      orderbookImbalance,
      historySeries,
    }),
  };

  return featureRow;
}

export function inferBtcMarketDirection(snapshot = {}) {
  return inferBtcMarketDirectionWithFallback(snapshot);
}

export function backfillSettlementOutcome(
  snapshot,
  {
    settlementPrice = null,
    targetPrice = null,
    settlementTime = new Date().toISOString(),
  } = {}
) {
  const target = safeNumber(targetPrice ?? snapshot?.target_price);
  const settlement = safeNumber(settlementPrice);
  const direction = inferBtcMarketDirection(snapshot);

  if (target === null || settlement === null || !direction) {
    return {
      ...snapshot,
      settlement_time: settlementTime || new Date().toISOString(),
      settlement_btc_price: settlement,
      settlement_outcome: null,
    };
  }

  const settlementOutcome =
    direction === "UP"
      ? settlement >= target
        ? "YES"
        : "NO"
      : settlement <= target
        ? "YES"
        : "NO";

  return {
    ...snapshot,
    settlement_time: settlementTime || new Date().toISOString(),
    settlement_btc_price: roundNumber(settlement, 2),
    settlement_outcome: settlementOutcome,
  };
}
