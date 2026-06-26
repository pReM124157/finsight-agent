import express from "express";

import { getAggregatedBtcPrice } from "../data/cryptoPriceClient.js";
import {
  getKalshiStatus,
  getKalshiMarkets,
  getKalshiMarketOrderbook,
} from "../data/kalshiClient.js";

import { estimateBtcReachability } from "../agents/reachabilityEngine.js";
import {
  calculateMispricing,
  extractMarketProbabilityFromOrderbook,
} from "../agents/mispricingEngine.js";
import {
  buildHumanSignalExplanation,
  buildSignalFromDecisionFlowResult,
} from "../agents/signalExplanationEngine.js";

import { runPaperDecisionFlow } from "../execution/paperDecisionFlow.js";
import {
  getPaperTrades,
  getPaperTradingStats,
  LIVE_STRATEGY_NAME,
  PAPER_TRADE_SOURCES,
} from "../execution/paperTradingEngine.js";
import {
  settleOpenPaperTradesByBtcPrice,
  resolveBtcTargetOutcome,
} from "../execution/settlementEngine.js";
import {
  evaluateKalshiTradeRisk,
  summarizePaperRiskState,
  defaultKalshiRiskLimits,
} from "../risk/kalshiRiskEngine.js";
import {
  getKalshiScannerSchedulerStatus,
  runKalshiScannerOnce,
} from "../scheduler/kalshiScannerScheduler.js";
import {
  getPaperSettlementSchedulerStatus,
  runPaperSettlementOnce,
} from "../scheduler/paperSettlementScheduler.js";
import {
  getMarketSnapshots,
  getSnapshotStats,
} from "../data/snapshotStore.js";
import { buildKalshiPerformanceReport } from "../backtest/performanceReportEngine.js";
import {
  addRealTrade,
  getRealTrades,
  getRealTradeStats,
} from "../dataset/realTradeDataset.js";
import {
  addLabeledSnapshot,
  getLabeledSnapshots,
  getLabeledSnapshotStats,
  labelSnapshot,
} from "../dataset/labeledSnapshotDataset.js";
import {
  generateAndSaveStrategyGuardDailyReport,
} from "../reporting/strategyGuardDailyReport.js";
import {
  getLatestStrategyGuardDailyReport,
  readStrategyGuardDailyReports,
} from "../reporting/strategyReportStore.js";
import {
  generateAndSaveNoSideShadowReport,
} from "../reporting/noSideShadowReport.js";
import {
  getLatestNoSideShadowReport,
  readNoSideShadowReports,
} from "../reporting/noSideShadowReportStore.js";
import {
  getMongoStatus,
  getMongoHealth,
  getLatestMongoRecords,
  listPaperTradesMongo,
  listMarketSnapshotsMongo,
  listFeatureSnapshotsMongo,
  listLabeledSnapshotsMongo,
  listStrategyReportsMongo,
  listNoSideShadowAuditsMongo,
  listNoSideShadowReportsMongo,
  listSystemSessionsMongo,
} from "../storage/mongoQueryService.js";

const router = express.Router();

function parseBooleanQuery(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function buildMongoFilters(query = {}) {
  return {
    limit: query.limit ? Number(query.limit) : undefined,
    skip: query.skip ? Number(query.skip) : undefined,
    marketTicker: query.marketTicker || undefined,
    strategySessionId: query.strategySessionId || undefined,
    strategyName: query.strategyName || undefined,
    tradeSource: query.tradeSource || undefined,
    isStrategyTrade: parseBooleanQuery(query.isStrategyTrade),
    status: query.status || undefined,
    candidate: parseBooleanQuery(query.candidate),
    rejectionReason: query.rejectionReason || undefined,
    verdict: query.verdict || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
  };
}

router.get("/status", async (req, res) => {
  try {
    const btc = await getAggregatedBtcPrice();

    res.json({
      ok: true,
      system: "Probability OS",
      mode: "PAPER",
      kalshi: getKalshiStatus(),
      btc,
      paperStats: {
        lifetimeLedger: getPaperTradingStats(),
        legacyTest: getPaperTradingStats({ tradeSource: PAPER_TRADE_SOURCES.LEGACY_TEST }),
        manualTest: getPaperTradingStats({ tradeSource: PAPER_TRADE_SOURCES.MANUAL_TEST }),
        liveGuardedStrategy: getPaperTradingStats({
          isStrategyTrade: true,
          tradeSource: PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY,
          strategyName: LIVE_STRATEGY_NAME,
        }),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "STATUS_FAILED",
      error: error.message,
    });
  }
});

router.get("/btc", async (req, res) => {
  try {
    const btc = await getAggregatedBtcPrice();
    res.json(btc);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "BTC_FETCH_FAILED",
      error: error.message,
    });
  }
});

router.get("/markets", async (req, res) => {
  try {
    const markets = await getKalshiMarkets({
      seriesTicker: req.query.seriesTicker,
      status: req.query.status || "open",
      limit: req.query.limit || 20,
    });

    res.json(markets);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "KALSHI_MARKETS_FAILED",
      error: error.message,
      status: error.status || null,
      body: error.body || null,
    });
  }
});

router.get("/markets/:ticker/orderbook", async (req, res) => {
  try {
    const orderbook = await getKalshiMarketOrderbook(req.params.ticker);
    const implied = extractMarketProbabilityFromOrderbook(orderbook);

    res.json({
      ...orderbook,
      implied,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "KALSHI_ORDERBOOK_FAILED",
      error: error.message,
      status: error.status || null,
      body: error.body || null,
    });
  }
});

router.post("/reachability", async (req, res) => {
  try {
    const result = estimateBtcReachability(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "REACHABILITY_FAILED",
      error: error.message,
    });
  }
});

router.post("/mispricing", async (req, res) => {
  try {
    const result = calculateMispricing(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MISPRICING_FAILED",
      error: error.message,
    });
  }
});

router.post("/risk/check", async (req, res) => {
  try {
    const result = evaluateKalshiTradeRisk({
      tradeCandidate: req.body?.tradeCandidate,
      currentState: req.body?.currentState,
      recentTrades: req.body?.recentTrades || [],
      limits: {
        ...defaultKalshiRiskLimits,
        ...(req.body?.limits || {}),
      },
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "RISK_CHECK_FAILED",
      error: error.message,
    });
  }
});

router.get("/paper/trades", async (req, res) => {
  try {
    res.json({
      ok: true,
      trades: getPaperTrades({
        status: req.query.status || null,
        limit: req.query.limit || 50,
      }),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "PAPER_TRADES_FAILED",
      error: error.message,
    });
  }
});

router.get("/paper/stats", async (req, res) => {
  try {
    const trades = getPaperTrades({ limit: 1000 });

    res.json({
      ok: true,
      stats: {
        lifetimeLedger: getPaperTradingStats(),
        legacyTest: getPaperTradingStats({ tradeSource: PAPER_TRADE_SOURCES.LEGACY_TEST }),
        manualTest: getPaperTradingStats({ tradeSource: PAPER_TRADE_SOURCES.MANUAL_TEST }),
        liveGuardedStrategy: getPaperTradingStats({
          isStrategyTrade: true,
          tradeSource: PAPER_TRADE_SOURCES.LIVE_GUARDED_STRATEGY,
          strategyName: LIVE_STRATEGY_NAME,
        }),
      },
      riskState: summarizePaperRiskState(trades),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "PAPER_STATS_FAILED",
      error: error.message,
    });
  }
});

router.get("/paper/performance", async (req, res) => {
  try {
    const report = buildKalshiPerformanceReport({
      limit: req.query.limit || 10000,
      date: req.query.date || null,
    });

    res.json(report);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "PAPER_PERFORMANCE_FAILED",
      error: error.message,
    });
  }
});

router.get("/reports/strategy-guard/daily", async (req, res) => {
  try {
    res.json({
      ok: true,
      reports: readStrategyGuardDailyReports(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "STRATEGY_GUARD_REPORTS_FETCH_FAILED",
      error: error.message,
    });
  }
});

router.get("/reports/strategy-guard/latest", async (req, res) => {
  try {
    res.json({
      ok: true,
      report: getLatestStrategyGuardDailyReport(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "STRATEGY_GUARD_REPORT_LATEST_FAILED",
      error: error.message,
    });
  }
});

router.post("/reports/strategy-guard/run", async (req, res) => {
  try {
    const result = generateAndSaveStrategyGuardDailyReport({
      date: req.body?.date || new Date().toISOString().slice(0, 10),
      sessionId: req.body?.sessionId || process.env.KALSHI_ACTIVE_SESSION_ID || null,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "STRATEGY_GUARD_REPORT_RUN_FAILED",
      error: error.message,
    });
  }
});

router.get("/reports/no-shadow/all", async (req, res) => {
  try {
    res.json({
      ok: true,
      reports: readNoSideShadowReports(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "NO_SHADOW_REPORTS_FETCH_FAILED",
      error: error.message,
    });
  }
});

router.get("/reports/no-shadow/latest", async (req, res) => {
  try {
    res.json({
      ok: true,
      report: getLatestNoSideShadowReport(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "NO_SHADOW_REPORT_LATEST_FAILED",
      error: error.message,
    });
  }
});

router.post("/reports/no-shadow/run", async (req, res) => {
  try {
    const result = generateAndSaveNoSideShadowReport({
      date: req.body?.date || null,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "NO_SHADOW_REPORT_RUN_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/status", async (req, res) => {
  try {
    res.json(getMongoStatus());
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_STATUS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/health", async (req, res) => {
  try {
    res.json(await getMongoHealth());
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_HEALTH_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/paper-trades", async (req, res) => {
  try {
    res.json(await listPaperTradesMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_PAPER_TRADES_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/market-snapshots", async (req, res) => {
  try {
    res.json(await listMarketSnapshotsMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_MARKET_SNAPSHOTS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/feature-snapshots", async (req, res) => {
  try {
    res.json(await listFeatureSnapshotsMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_FEATURE_SNAPSHOTS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/labeled-snapshots", async (req, res) => {
  try {
    res.json(await listLabeledSnapshotsMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_LABELED_SNAPSHOTS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/strategy-reports", async (req, res) => {
  try {
    res.json(await listStrategyReportsMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_STRATEGY_REPORTS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/no-shadow-audits", async (req, res) => {
  try {
    res.json(await listNoSideShadowAuditsMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_NO_SHADOW_AUDITS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/no-shadow-reports", async (req, res) => {
  try {
    res.json(await listNoSideShadowReportsMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_NO_SHADOW_REPORTS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/system-sessions", async (req, res) => {
  try {
    res.json(await listSystemSessionsMongo(buildMongoFilters(req.query)));
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_SYSTEM_SESSIONS_FAILED",
      error: error.message,
    });
  }
});

router.get("/mongo/latest", async (req, res) => {
  try {
    res.json(await getLatestMongoRecords());
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "MONGO_LATEST_FAILED",
      error: error.message,
    });
  }
});

router.post("/paper/decision", async (req, res) => {
  try {
    const result = await runPaperDecisionFlow(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "PAPER_DECISION_FAILED",
      error: error.message,
    });
  }
});

router.post("/signal/explain", async (req, res) => {
  try {
    const result = await runPaperDecisionFlow(req.body || {});

    res.json({
      ok: true,
      decision: result,
      signal: buildSignalFromDecisionFlowResult({
        ...result,
        marketTicker: req.body?.marketTicker || result.paperTrade?.trade?.marketTicker || null,
        targetPrice: req.body?.targetPrice ?? result.targetPrice,
        minutesRemaining: req.body?.minutesRemaining ?? result.minutesRemaining,
      }),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "SIGNAL_EXPLAIN_FAILED",
      error: error.message,
    });
  }
});

router.post("/signal/from-decision", async (req, res) => {
  try {
    res.json({
      ok: true,
      signal: buildSignalFromDecisionFlowResult(req.body || {}),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "SIGNAL_FROM_DECISION_FAILED",
      error: error.message,
    });
  }
});

router.post("/paper/settle", async (req, res) => {
  try {
    const result = settleOpenPaperTradesByBtcPrice({
      settlementBtcPrice: req.body?.settlementBtcPrice,
      marketTicker: req.body?.marketTicker || null,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "PAPER_SETTLEMENT_FAILED",
      error: error.message,
    });
  }
});

router.post("/paper/resolve-outcome", async (req, res) => {
  try {
    const result = resolveBtcTargetOutcome(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "OUTCOME_RESOLUTION_FAILED",
      error: error.message,
    });
  }
});

router.get("/settlement-scheduler/status", async (req, res) => {
  try {
    res.json({
      ok: true,
      scheduler: getPaperSettlementSchedulerStatus(),
      stats: getPaperTradingStats(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "SETTLEMENT_SCHEDULER_STATUS_FAILED",
      error: error.message,
    });
  }
});

router.post("/settlement-scheduler/run", async (req, res) => {
  try {
    const result = await runPaperSettlementOnce();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "SETTLEMENT_SCHEDULER_RUN_FAILED",
      error: error.message,
    });
  }
});

router.get("/scanner/status", async (req, res) => {
  try {
    res.json({
      ok: true,
      scheduler: getKalshiScannerSchedulerStatus(),
      snapshotStats: getSnapshotStats(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "SCANNER_STATUS_FAILED",
      error: error.message,
    });
  }
});

router.post("/scanner/run", async (req, res) => {
  try {
    const result = await runKalshiScannerOnce({
      limit: req.body?.limit || 50,
      maxCandidates: req.body?.maxCandidates || 5,
      status: req.body?.status || "open",
      dryRun: Boolean(req.body?.dryRun),
      requestedSizeUsd:
        Number.isFinite(Number(req.body?.requestedSizeUsd)) && Number(req.body?.requestedSizeUsd) > 0
          ? Number(req.body.requestedSizeUsd)
          : 5,
      riskLimits: req.body?.riskLimits || null,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "SCANNER_RUN_FAILED",
      error: error.message,
    });
  }
});

router.get("/snapshots", async (req, res) => {
  try {
    res.json({
      ok: true,
      stats: getSnapshotStats(),
      snapshots: getMarketSnapshots({
        limit: req.query.limit || 50,
        marketTicker: req.query.marketTicker || null,
      }),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "SNAPSHOTS_FAILED",
      error: error.message,
    });
  }
});

router.post("/dataset/real-trades", async (req, res) => {
  try {
    const result = addRealTrade(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "REAL_TRADE_INSERT_FAILED",
      error: error.message,
    });
  }
});

router.get("/dataset/real-trades", async (req, res) => {
  try {
    res.json({
      ok: true,
      trades: getRealTrades({
        limit: req.query.limit || 100,
        side: req.query.side || null,
        outcome: req.query.outcome || null,
      }),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "REAL_TRADES_FETCH_FAILED",
      error: error.message,
    });
  }
});

router.get("/dataset/real-trades/stats", async (req, res) => {
  try {
    res.json({
      ok: true,
      stats: getRealTradeStats(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "REAL_TRADES_STATS_FAILED",
      error: error.message,
    });
  }
});

router.post("/dataset/labeled-snapshots", async (req, res) => {
  try {
    const result = addLabeledSnapshot(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "LABELED_SNAPSHOT_INSERT_FAILED",
      error: error.message,
    });
  }
});

router.get("/dataset/labeled-snapshots", async (req, res) => {
  try {
    res.json({
      ok: true,
      snapshots: getLabeledSnapshots({
        limit: req.query.limit || 100,
        label: req.query.label || null,
      }),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "LABELED_SNAPSHOTS_FETCH_FAILED",
      error: error.message,
    });
  }
});

router.post("/dataset/labeled-snapshots/label", async (req, res) => {
  try {
    const result = labelSnapshot(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "LABELED_SNAPSHOT_LABEL_FAILED",
      error: error.message,
    });
  }
});

router.get("/dataset/labeled-snapshots/stats", async (req, res) => {
  try {
    res.json({
      ok: true,
      stats: getLabeledSnapshotStats(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: "LABELED_SNAPSHOT_STATS_FAILED",
      error: error.message,
    });
  }
});

export default router;
