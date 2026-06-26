import fs from "node:fs";
import path from "node:path";

import { inferBtcMarketDirectionWithFallback } from "../utils/btcMarketDirection.js";
import {
  isMongoDualWriteEnabled,
  saveNoSideShadowAuditMongo,
} from "../storage/mongoPersistence.js";

const NO_SIDE_SHADOW_AUDIT_PATH =
  process.env.KALSHI_NO_SIDE_SHADOW_AUDIT_PATH ||
  path.resolve("data/kalshi-no-side-shadow-audit.jsonl");

function ensureDir() {
  const dir = path.dirname(NO_SIDE_SHADOW_AUDIT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundNumber(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function parseEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  return fallback;
}

function buildAuditId() {
  return `NO-SHADOW-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

function readRows() {
  ensureDir();

  if (!fs.existsSync(NO_SIDE_SHADOW_AUDIT_PATH)) {
    return [];
  }

  return fs
    .readFileSync(NO_SIDE_SHADOW_AUDIT_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeRows(rows = []) {
  ensureDir();
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(NO_SIDE_SHADOW_AUDIT_PATH, payload ? `${payload}\n` : "", "utf8");
}

export function getNoSideShadowConfig() {
  return {
    enabled: parseEnabled(process.env.KALSHI_NO_SHADOW_ENABLED, true),
    maxNoAskPrice: safeNumber(process.env.KALSHI_NO_SHADOW_MAX_NO_PRICE, 85),
    minModelNoProbability: safeNumber(process.env.KALSHI_NO_SHADOW_MIN_MODEL_NO_PROB, 65),
    minAdjustedEdgePct: safeNumber(process.env.KALSHI_NO_SHADOW_MIN_EDGE_PCT, 10),
    maxAdjustedEdgePct: safeNumber(process.env.KALSHI_NO_SHADOW_MAX_EDGE_PCT, 20),
    minMinutesRemaining: safeNumber(process.env.KALSHI_NO_SHADOW_MIN_MINUTES, 3),
    maxMinutesRemaining: safeNumber(process.env.KALSHI_NO_SHADOW_MAX_MINUTES, 8),
    maxMomentumBps: safeNumber(process.env.KALSHI_NO_SHADOW_MAX_MOMENTUM_BPS, 0),
    maxSpreadPct: safeNumber(process.env.KALSHI_NO_SHADOW_MAX_SPREAD_PCT, 6),
    blockedExpensiveFloor: safeNumber(process.env.KALSHI_NO_SHADOW_BLOCK_EXPENSIVE_FLOOR, 95),
    blockedExpensiveCeiling: safeNumber(process.env.KALSHI_NO_SHADOW_BLOCK_EXPENSIVE_CEILING, 99),
  };
}

function inferAwayFromTarget({
  direction,
  btcPrice,
  targetPrice,
  momentumBps,
}) {
  const btc = safeNumber(btcPrice);
  const target = safeNumber(targetPrice);
  const momentum = safeNumber(momentumBps);

  if (btc === null || target === null || momentum === null) {
    return null;
  }

  if (direction === "DOWN") {
    return btc > target && momentum >= 0;
  }

  return btc < target && momentum <= 0;
}

function buildReasonCodes(checks = {}) {
  return Object.entries(checks)
    .filter(([, passed]) => passed === false)
    .map(([key]) => key.toUpperCase());
}

export function evaluateNoSideShadow({
  marketTicker = null,
  marketTitle = null,
  snapshotId = null,
  targetPrice = null,
  btcPrice = null,
  minutesRemaining = null,
  momentumBps = null,
  mispricing = null,
  reachability = null,
  requestedSizeUsd = null,
  capturedAt = new Date().toISOString(),
} = {}) {
  const config = getNoSideShadowConfig();
  const noAsk = safeNumber(mispricing?.no?.ask);
  const noBid = safeNumber(mispricing?.no?.bid);
  const noSpread = safeNumber(mispricing?.no?.spread);
  const modelNoProbability =
    safeNumber(reachability?.modelProbability) !== null
      ? 100 - safeNumber(reachability.modelProbability)
      : null;
  const noAdjustedEdge = safeNumber(mispricing?.no?.adjustedEdge);
  const noRawEdge = safeNumber(mispricing?.no?.rawEdge);
  const minutes = safeNumber(minutesRemaining);
  const btc = safeNumber(btcPrice);
  const target = safeNumber(targetPrice);
  const momentum = safeNumber(momentumBps, 0);
  const direction = inferBtcMarketDirectionWithFallback({
    market_ticker: marketTicker,
    market_title: marketTitle,
    btc_price: btc,
    target_price: target,
  });
  const btcBelowTarget =
    btc !== null && target !== null ? btc < target : null;
  const awayFromTarget = inferAwayFromTarget({
    direction,
    btcPrice: btc,
    targetPrice: target,
    momentumBps: momentum,
  });
  const candidateSizeUsd = safeNumber(requestedSizeUsd, 5);
  const contracts =
    noAsk !== null && noAsk > 0 && noAsk < 100
      ? Math.floor(candidateSizeUsd / (noAsk / 100))
      : 0;
  const costUsd =
    contracts > 0 && noAsk !== null
      ? roundNumber((contracts * noAsk) / 100, 2)
      : null;
  const maxProfitUsd =
    contracts > 0 && costUsd !== null
      ? roundNumber(contracts - costUsd, 2)
      : null;
  const expensiveNoBandBlocked =
    noAsk !== null &&
    noAsk >= config.blockedExpensiveFloor &&
    noAsk <= config.blockedExpensiveCeiling;

  const checks = {
    enabled: config.enabled,
    no_price_cap: noAsk !== null ? noAsk <= config.maxNoAskPrice : false,
    model_no_probability:
      modelNoProbability !== null ? modelNoProbability >= config.minModelNoProbability : false,
    adjusted_edge_floor:
      noAdjustedEdge !== null ? noAdjustedEdge >= config.minAdjustedEdgePct : false,
    adjusted_edge_ceiling:
      noAdjustedEdge !== null ? noAdjustedEdge <= config.maxAdjustedEdgePct : false,
    minutes_floor: minutes !== null ? minutes >= config.minMinutesRemaining : false,
    minutes_ceiling: minutes !== null ? minutes <= config.maxMinutesRemaining : false,
    btc_below_target: btcBelowTarget === true,
    momentum_flat_or_down: momentum <= config.maxMomentumBps,
    spread_ok: noSpread !== null ? noSpread <= config.maxSpreadPct : false,
    expensive_no_band_blocked: !expensiveNoBandBlocked,
    away_from_target: awayFromTarget === true,
    tradable_entry: contracts > 0,
  };

  const candidate = Object.values(checks).every(Boolean);
  const reasonCodes = buildReasonCodes(checks);

  return {
    id: buildAuditId(),
    snapshotId,
    marketTicker,
    marketTitle,
    capturedAt,
    shadowMode: true,
    side: "NO",
    strategyName: "NO_SIDE_SHADOW_CALIBRATION_STEP_21",
    config,
    candidate,
    reasonCodes,
    direction,
    btcPrice: roundNumber(btc, 2),
    targetPrice: roundNumber(target, 2),
    btcBelowTarget,
    minutesRemaining: minutes,
    momentumBps: roundNumber(momentum, 2),
    awayFromTarget,
    noBid: roundNumber(noBid, 2),
    noAsk: roundNumber(noAsk, 2),
    noSpread: roundNumber(noSpread, 2),
    modelNoProbability: roundNumber(modelNoProbability, 2),
    marketNoProbability:
      safeNumber(mispricing?.marketProbability) !== null
        ? roundNumber(100 - mispricing.marketProbability, 2)
        : null,
    noAdjustedEdge: roundNumber(noAdjustedEdge, 2),
    noRawEdge: roundNumber(noRawEdge, 2),
    requestedSizeUsd: roundNumber(candidateSizeUsd, 2),
    hypotheticalContracts: contracts,
    hypotheticalCostUsd: costUsd,
    hypotheticalMaxProfitUsd: maxProfitUsd,
    settlementTime: null,
    settlementBtcPrice: null,
    settlementOutcome: null,
    hypotheticalWon: null,
    hypotheticalPnlUsd: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function appendNoSideShadowAudit(entry = {}) {
  const rows = readRows();
  const record = {
    id: entry.id || buildAuditId(),
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...entry,
  };
  rows.push(record);
  writeRows(rows);

  if (isMongoDualWriteEnabled()) {
    saveNoSideShadowAuditMongo(record).catch((error) => {
      console.warn("[mongo] NO-side shadow audit dual-write failed:", error.message);
    });
  }

  return record;
}

export function settleNoSideShadowAudits({
  marketTicker = null,
  settlementOutcome = null,
  settlementBtcPrice = null,
  settlementTime = new Date().toISOString(),
} = {}) {
  if (!marketTicker || !settlementOutcome) {
    return {
      ok: false,
      reason: "MARKET_TICKER_AND_OUTCOME_REQUIRED",
      updated: 0,
    };
  }

  const normalizedOutcome = String(settlementOutcome).trim().toUpperCase();
  if (!["YES", "NO"].includes(normalizedOutcome)) {
    return {
      ok: false,
      reason: "INVALID_SETTLEMENT_OUTCOME",
      updated: 0,
    };
  }

  const rows = readRows();
  let updated = 0;

  const rewritten = rows.map((row) => {
    if (row?.marketTicker !== marketTicker || row?.settlementOutcome) {
      return row;
    }

    updated += 1;
    const won = normalizedOutcome === "NO";
    const costUsd = safeNumber(row?.hypotheticalCostUsd, 0);
    const maxProfitUsd = safeNumber(row?.hypotheticalMaxProfitUsd, 0);

    return {
      ...row,
      settlementOutcome: normalizedOutcome,
      settlementBtcPrice: roundNumber(settlementBtcPrice, 2),
      settlementTime,
      hypotheticalWon: won,
      hypotheticalPnlUsd: won ? maxProfitUsd : roundNumber(-costUsd, 2),
      updatedAt: new Date().toISOString(),
    };
  });

  writeRows(rewritten);

  if (isMongoDualWriteEnabled()) {
    for (const row of rewritten) {
      if (row?.marketTicker !== marketTicker || row?.settlementOutcome !== normalizedOutcome) {
        continue;
      }

      saveNoSideShadowAuditMongo(row).catch((error) => {
        console.warn("[mongo] NO-side shadow audit dual-write failed:", error.message);
      });
    }
  }

  return {
    ok: true,
    updated,
    marketTicker,
    settlementOutcome: normalizedOutcome,
  };
}

export function getNoSideShadowAudits({ limit = 100 } = {}) {
  return readRows().slice(-Number(limit || 100)).reverse();
}
