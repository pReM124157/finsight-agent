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

import { runPaperDecisionFlow } from "../execution/paperDecisionFlow.js";
import {
  getPaperTrades,
  getPaperTradingStats,
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
  getMarketSnapshots,
  getSnapshotStats,
} from "../data/snapshotStore.js";

const router = express.Router();

router.get("/status", async (req, res) => {
  try {
    const btc = await getAggregatedBtcPrice();

    res.json({
      ok: true,
      system: "Probability OS",
      mode: "PAPER",
      kalshi: getKalshiStatus(),
      btc,
      paperStats: getPaperTradingStats(),
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
      stats: getPaperTradingStats(),
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

export default router;
