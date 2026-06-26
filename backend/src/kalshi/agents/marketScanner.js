import fs from "node:fs";
import path from "node:path";
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
import { buildFeatureSnapshot } from "../data/featureSnapshot.js";
import { appendFeatureSnapshot } from "../data/featureSnapshotStore.js";
import {
  addLabeledSnapshot,
  buildFeatureRowFromSnapshot,
} from "../dataset/labeledSnapshotDataset.js";
import { appendNoSideShadowAudit } from "../shadow/noSideShadowAudit.js";

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
  const structuredTarget =
    safeNumber(market?.floor_strike) ??
    safeNumber(market?.target_price) ??
    safeNumber(market?.strike_price);

  if (structuredTarget && structuredTarget > 1000) {
    return structuredTarget;
  }

  const labeledText = [
    market?.yes_sub_title,
    market?.no_sub_title,
    market?.subtitle,
    market?.title,
  ]
    .filter(Boolean)
    .join(" ");

  const labeledMatch = labeledText.match(/target price:\s*\$?\s*([0-9]{2,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]{4,6}(?:\.\d+)?)/i);
  if (labeledMatch) {
    const parsed = safeNumber(String(labeledMatch[1]).replace(/,/g, ""));
    if (parsed && parsed > 1000) {
      return parsed;
    }
  }

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

function buildClassificationDebug({ allMarkets, btcMarkets, maxCandidates }) {
  return {
    scannedMarketCount: allMarkets.length,
    btcMatchCount: btcMarkets.length,
    maxCandidates,
    sample: allMarkets.slice(0, 10).map(explainMarketClassification),
    btcMatchSample: btcMarkets.slice(0, 5).map(explainMarketClassification),
  };
}

function getBtcSeriesTicker() {
  return process.env.KALSHI_BTC_SERIES_TICKER || "KXBTC15M";
}

const REJECTION_LOG_PATH = path.resolve("backend/data/kalshi-scan-rejections.jsonl");

function ensureRejectionLogDir() {
  const dir = path.dirname(REJECTION_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendScanRejection(entry) {
  ensureRejectionLogDir();
  fs.appendFileSync(REJECTION_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

function buildReasonBucket({
  primaryReason,
  minutesRemaining,
  bestAdjustedEdge,
  yesAsk,
  yesBid,
  side,
  decision,
} = {}) {
  const reasons = [];
  const edge = safeNumber(bestAdjustedEdge);
  const minutes = safeNumber(minutesRemaining);
  const ask = safeNumber(yesAsk);
  const bid = safeNumber(yesBid);
  const hasBookSignal = yesAsk !== undefined || yesBid !== undefined;
  const normalizedSide = typeof side === "string" ? side.trim().toUpperCase() : null;
  const zoneReason = decision?.strategyZoneGuard?.reason || primaryReason;

  if (hasBookSignal && (ask === null || bid === null || ask <= 1)) {
    reasons.push("ONE_SIDED_BOOK");
  }

  if (normalizedSide && normalizedSide !== "YES") {
    reasons.push("WRONG_SIDE");
  }

  if (zoneReason === "STRATEGY_ZONE_SIDE_BLOCKED" || primaryReason === "NO_SIDE_SHADOW_ONLY" || primaryReason === "NO_SIDE_SHADOW_CANDIDATE_RECORDED") {
    reasons.push("WRONG_SIDE");
  }

  if (zoneReason === "STRATEGY_ZONE_TIME_BUCKET_BLOCKED" || primaryReason === "MARKET_OPEN_ARTIFACT") {
    reasons.push("TIME_OUTSIDE_WINDOW");
  }

  if (zoneReason === "STRATEGY_ZONE_ENTRY_TOO_EXPENSIVE" || zoneReason === "STRATEGY_ZONE_CROSSED_TARGET_OVERPRICED") {
    reasons.push("PRICE_TOO_HIGH");
  }

  if (zoneReason === "STRATEGY_ZONE_HIGH_EDGE_DANGER") {
    reasons.push("EDGE_TOO_HIGH");
  }

  if (zoneReason === "STRATEGY_ZONE_EDGE_OUT_OF_RANGE") {
    if (edge !== null) {
      if (edge < 10) reasons.push("EDGE_TOO_LOW");
      if (edge > 20) reasons.push("EDGE_TOO_HIGH");
    }
  }

  if (primaryReason === "MISPRICING_DECISION_NO_TRADE" && edge !== null && edge < 10) {
    reasons.push("EDGE_TOO_LOW");
  }

  if (primaryReason === "MARKET_PROBABILITY_NOT_AVAILABLE") {
    reasons.push("ONE_SIDED_BOOK");
  }

  if (
    primaryReason === "BTC_PRICE_UNAVAILABLE" ||
    primaryReason === "TARGET_PRICE_NOT_PARSED" ||
    primaryReason === "MISSING_TARGET_PRICE" ||
    primaryReason === "MISSING_MARKET_TICKER" ||
    primaryReason === "INVALID_DISTANCE_INPUT" ||
    primaryReason === "MISSING_MODEL_OUTPUT" ||
    primaryReason === "REACHABILITY_FAILED" ||
    primaryReason === "MISPRICING_FAILED"
  ) {
    reasons.push("NO_MODEL_OUTPUT");
  }

  if (primaryReason === "TARGET_TOO_FAR_HARD_REJECT" || primaryReason === "TARGET_TOO_FAR_WATCH_ONLY") {
    reasons.push("TIME_OUTSIDE_WINDOW");
  }

  if (reasons.length === 0 && edge !== null) {
    if (edge < 10) reasons.push("EDGE_TOO_LOW");
    else if (edge > 20) reasons.push("EDGE_TOO_HIGH");
  }

  if (reasons.length === 0 && minutes !== null && (minutes < 8 || minutes > 12)) {
    reasons.push("TIME_OUTSIDE_WINDOW");
  }

  return [...new Set(reasons)];
}

function buildPrimaryRejection(reasons = [], fallback = "MULTIPLE") {
  if (reasons.length === 1) return reasons[0];
  if (reasons.length > 1) return "MULTIPLE";
  return fallback;
}

function logScanRejection({
  ts = new Date().toISOString(),
  marketTicker,
  minutesRemaining,
  bestAdjustedEdge = null,
  modelProbYes = null,
  yesAsk = null,
  yesBid = null,
  marketProbYes = null,
  side = null,
  primaryReason,
  decision = null,
} = {}) {
  const rejectionReasons = buildReasonBucket({
    primaryReason,
    minutesRemaining,
    bestAdjustedEdge,
    yesAsk,
    yesBid,
    side,
    decision,
  });
  const normalizedPrimary = buildPrimaryRejection(rejectionReasons, primaryReason || "MULTIPLE");
  const entry = {
    ts,
    market_ticker: marketTicker || null,
    minutes_remaining: safeNumber(minutesRemaining),
    best_adjusted_edge: safeNumber(bestAdjustedEdge),
    model_prob_yes: safeNumber(modelProbYes),
    yes_ask: safeNumber(yesAsk),
    market_prob_yes: safeNumber(marketProbYes),
    rejection_reasons: rejectionReasons.length ? rejectionReasons : ["MULTIPLE"],
    primary_rejection: normalizedPrimary,
    would_have_been_close:
      safeNumber(bestAdjustedEdge) !== null &&
      safeNumber(minutesRemaining) !== null &&
      safeNumber(bestAdjustedEdge) >= 8 &&
      safeNumber(minutesRemaining) >= 6,
  };

  appendScanRejection(entry);
  console.log(
    `[scanner] REJECTED ${marketTicker || "UNKNOWN"} | edge: ${
      entry.best_adjusted_edge !== null ? `${entry.best_adjusted_edge.toFixed(2)}%` : "n/a"
    } | mins: ${entry.minutes_remaining ?? "n/a"} | reason: ${entry.primary_rejection}`
  );
}

export async function scanKalshiBtcMarkets({
  limit = 25,
  maxCandidates = 5,
  status = "open",
  dryRun = false,
  requestedSizeUsd = null,
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
    seriesTicker: getBtcSeriesTicker(),
    status,
    limit,
  });

  const allMarkets = marketsResponse.markets || [];
  const btcMarkets = allMarkets.filter(isBtcMarket).slice(0, maxCandidates);
  const classificationDebug = buildClassificationDebug({
    allMarkets,
    btcMarkets,
    maxCandidates,
  });

  const snapshots = [];
  const decisions = [];
  const errors = [];

  for (const market of btcMarkets) {
    const marketTicker = market.ticker;
    const targetPrice = parseBtcTargetPrice(market);
    const minutesRemaining = inferMinutesRemaining(market);

    if (!marketTicker || !targetPrice) {
      logScanRejection({
        ts: startedAt,
        marketTicker,
        minutesRemaining,
        primaryReason: "TARGET_PRICE_NOT_PARSED",
      });
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

    if (minutesRemaining >= 15) {
      console.log("[scanner] skipping market-open snapshot (mins=15, orderbook unreliable)", {
        marketTicker,
        minutesRemaining,
      });
      logScanRejection({
        ts: new Date().toISOString(),
        marketTicker,
        minutesRemaining,
        primaryReason: "MARKET_OPEN_ARTIFACT",
      });
      continue;
    }

    try {
      const orderbook = await getKalshiMarketOrderbook(marketTicker);
      const implied = extractMarketProbabilityFromOrderbook(orderbook);

      if (implied.yesAsk === null || implied.yesAsk === undefined || implied.yesBid === null || implied.yesBid === undefined) {
        console.log("[scanner] skipping one-sided orderbook (missing ask or bid)", {
          marketTicker,
          minutesRemaining,
          yesAsk: implied.yesAsk,
          yesBid: implied.yesBid,
        });
        logScanRejection({
          ts: new Date().toISOString(),
          marketTicker,
          minutesRemaining,
          yesAsk: implied.yesAsk,
          yesBid: implied.yesBid,
          marketProbYes: implied.marketProbability,
          primaryReason: "MARKET_PROBABILITY_NOT_AVAILABLE",
        });
        continue;
      }

      if (implied.yesAsk <= 1) {
        console.log("[scanner] skipping ghost ask price (yes_ask <= 1c)", {
          marketTicker,
          minutesRemaining,
          yesAsk: implied.yesAsk,
          yesBid: implied.yesBid,
        });
        logScanRejection({
          ts: new Date().toISOString(),
          marketTicker,
          minutesRemaining,
          yesAsk: implied.yesAsk,
          yesBid: implied.yesBid,
          marketProbYes: implied.marketProbability,
          primaryReason: "MARKET_PROBABILITY_NOT_AVAILABLE",
        });
        continue;
      }

      if (!implied.marketProbability) {
        logScanRejection({
          ts: new Date().toISOString(),
          marketTicker,
          minutesRemaining,
          yesAsk: implied.yesAsk,
          yesBid: implied.yesBid,
          marketProbYes: implied.marketProbability,
          primaryReason: "MARKET_PROBABILITY_NOT_AVAILABLE",
        });
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
        marketTicker,
        marketTitle: market.title || null,
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
          requestedSizeUsd,
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

      const shadowNoTradeSummary =
        !dryRun && decision?.shadowNoTrade
          ? {
              candidate: decision.shadowNoTrade.candidate,
              reasonCodes: decision.shadowNoTrade.reasonCodes,
              noAsk: decision.shadowNoTrade.noAsk,
              modelNoProbability: decision.shadowNoTrade.modelNoProbability,
              noAdjustedEdge: decision.shadowNoTrade.noAdjustedEdge,
              momentumBps: decision.shadowNoTrade.momentumBps,
              awayFromTarget: decision.shadowNoTrade.awayFromTarget,
              hypotheticalCostUsd: decision.shadowNoTrade.hypotheticalCostUsd,
              hypotheticalMaxProfitUsd: decision.shadowNoTrade.hypotheticalMaxProfitUsd,
            }
          : null;

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
              shadowNoTrade: shadowNoTradeSummary,
            },
        rawMarket: {
          ticker: market.ticker,
          title: market.title,
          status: market.status,
          close_time: market.close_time,
        },
      });

      const featureRow = await buildFeatureSnapshot(
        {
          marketTicker: market.ticker,
          targetPrice,
          minutesRemaining,
          market,
          orderbook,
          implied,
          reachability,
          snapshotId: snapshot.id,
          btcReference: btc,
        },
        {
          modelYesProbability: reachability?.modelProbability ?? null,
          modelNoProbability:
            reachability?.modelProbability !== null && reachability?.modelProbability !== undefined
              ? Number((100 - reachability.modelProbability).toFixed(2))
              : null,
          mispricing,
        }
      );

      appendFeatureSnapshot(featureRow);

      if (!dryRun && decision?.shadowNoTrade) {
        appendNoSideShadowAudit({
          ...decision.shadowNoTrade,
          snapshotId: featureRow.snapshot_id || featureRow.id,
          marketTitle: market.title || null,
          capturedAt: featureRow.captured_at || featureRow.createdAt,
        });
      }

      if (dryRun) {
        addLabeledSnapshot(buildFeatureRowFromSnapshot(snapshot));
      }

      if (!decision?.paperTrade?.ok) {
        logScanRejection({
          ts: new Date().toISOString(),
          marketTicker,
          minutesRemaining,
          bestAdjustedEdge: decision?.mispricing?.bestAdjustedEdge ?? mispricing?.bestAdjustedEdge ?? null,
          modelProbYes: decision?.reachability?.modelProbability ?? reachability?.modelProbability ?? null,
          yesAsk: implied.yesAsk,
          yesBid: implied.yesBid,
          marketProbYes: implied.marketProbability,
          side: decision?.mispricing?.bestSide ?? mispricing?.bestSide ?? null,
          primaryReason:
            decision?.stage === "REACHABILITY"
              ? "REACHABILITY_FAILED"
              : decision?.stage === "MISPRICING"
                ? "MISPRICING_FAILED"
                : decision?.reason || "MULTIPLE",
          decision,
        });
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
    seriesTicker: getBtcSeriesTicker(),
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
    marketClassificationSample: classificationDebug.sample,
    classificationDebug,
    snapshotStats: getSnapshotStats(),
    snapshots,
  };
}
