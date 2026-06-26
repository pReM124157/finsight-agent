import fs from "node:fs";
import path from "node:path";

import { evaluateStrategyZoneGuard } from "../risk/strategyZoneGuard.js";
import { getStrategyGuardReportPath, saveStrategyGuardDailyReport } from "./strategyReportStore.js";

const PAPER_LEDGER_PATH =
  process.env.KALSHI_PAPER_LEDGER_PATH ||
  path.resolve("data/kalshi-paper-trades.json");
const FEATURE_SNAPSHOT_PATH =
  process.env.KALSHI_FEATURE_SNAPSHOT_PATH ||
  path.resolve("data/kalshi-feature-snapshots.jsonl");
const LABELED_SNAPSHOT_DATASET_PATH =
  process.env.KALSHI_LABELED_SNAPSHOT_DATASET_PATH ||
  path.resolve("data/kalshi-labeled-snapshots.json");
const SNAPSHOT_PATH =
  process.env.KALSHI_SNAPSHOT_PATH ||
  path.resolve("data/kalshi-market-snapshots.json");
const SESSION_STATUS_PATH = path.resolve("artifacts/today-kalshi-paper-session-status.json");

export const STRATEGY_NAME = "YES_EDGE_10_20_MIN_8_12_PRICE_LT_94";

export const STRATEGY_GUARD_REASONS = [
  "STRATEGY_ZONE_SIDE_BLOCKED",
  "STRATEGY_ZONE_MISSING_SIDE",
  "STRATEGY_ZONE_MISSING_EDGE",
  "STRATEGY_ZONE_HIGH_EDGE_DANGER",
  "STRATEGY_ZONE_EDGE_OUT_OF_RANGE",
  "STRATEGY_ZONE_MISSING_MINUTES_REMAINING",
  "STRATEGY_ZONE_TIME_BUCKET_BLOCKED",
  "STRATEGY_ZONE_MISSING_ENTRY_PRICE",
  "STRATEGY_ZONE_CROSSED_TARGET_OVERPRICED",
  "STRATEGY_ZONE_ENTRY_TOO_EXPENSIVE",
];

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function readJsonArray(filePath, warnings, label) {
  if (!fs.existsSync(filePath)) {
    warnings.push(`${label}_MISSING`);
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      warnings.push(`${label}_NOT_ARRAY`);
      return [];
    }
    return parsed;
  } catch (error) {
    warnings.push(`${label}_READ_FAILED:${error.message}`);
    return [];
  }
}

function readJsonl(filePath, warnings, label) {
  if (!fs.existsSync(filePath)) {
    warnings.push(`${label}_MISSING`);
    return [];
  }

  try {
    return fs
      .readFileSync(filePath, "utf8")
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
  } catch (error) {
    warnings.push(`${label}_READ_FAILED:${error.message}`);
    return [];
  }
}

function readJsonObject(filePath, warnings, label) {
  if (!fs.existsSync(filePath)) {
    warnings.push(`${label}_MISSING`);
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    warnings.push(`${label}_READ_FAILED:${error.message}`);
    return null;
  }
}

function getDateOnly(value) {
  return String(value || "").slice(0, 10);
}

function buildEmptyAccepted() {
  return {
    trades: 0,
    settledTrades: 0,
    openTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalRiskedUsd: 0,
    pnlUsd: 0,
    roiPct: 0,
    maxDrawdownUsd: 0,
    avgEntryPrice: 0,
    avgAdjustedEdge: 0,
    avgMinutesRemaining: 0,
  };
}

function buildEmptyRejected() {
  return {
    totalRejected: 0,
    byReason: Object.fromEntries(STRATEGY_GUARD_REASONS.map((reason) => [reason, 0])),
  };
}

function buildEmptyRejectedOutcomeAudit() {
  return {
    settledRejectedCandidates: 0,
    pendingRejectedCandidates: 0,
    wouldHaveWon: 0,
    wouldHaveLost: 0,
    hypotheticalPnlUsd: 0,
    hypotheticalRiskedUsd: 0,
    hypotheticalRoiPct: 0,
  };
}

function computeMaxDrawdown(trades = []) {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    cumulative += safeNumber(trade.pnlUsd, 0);
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  return round(maxDrawdown, 2) || 0;
}

function calculateHypotheticalPnl({ side, entryProbability, actualOutcome, sizeUsd = 5 }) {
  const entryProb = safeNumber(entryProbability);
  const size = safeNumber(sizeUsd, 0);

  if (!["YES", "NO"].includes(side) || !["YES", "NO"].includes(actualOutcome)) {
    return { ok: false, reason: "INVALID_SIDE_OR_OUTCOME" };
  }

  if (entryProb === null || entryProb <= 0 || entryProb >= 100) {
    return { ok: false, reason: "INVALID_ENTRY_PROBABILITY" };
  }

  const contracts = Math.floor(size / (entryProb / 100));
  if (contracts <= 0) {
    return { ok: false, reason: "SIZE_TOO_SMALL" };
  }

  const costUsd = (contracts * entryProb) / 100;
  const maxPayoutUsd = contracts;
  const pnlUsd = side === actualOutcome ? maxPayoutUsd - costUsd : -costUsd;

  return {
    ok: true,
    costUsd: round(costUsd),
    pnlUsd: round(pnlUsd),
    returnPct: costUsd > 0 ? round((pnlUsd / costUsd) * 100) : 0,
    result: side === actualOutcome ? "WON" : "LOST",
  };
}

function resolveStrategyReason(snapshot) {
  const mispricing = snapshot?.mispricing || {};
  const bestSide = snapshot?.decision?.bestSide || mispricing?.bestSide || null;
  const entryProbability =
    bestSide === "YES"
      ? safeNumber(snapshot?.implied?.yesAsk ?? mispricing?.yes?.ask)
      : bestSide === "NO"
        ? safeNumber(snapshot?.implied?.noAsk ?? mispricing?.no?.ask)
        : null;
  const adjustedEdge =
    safeNumber(snapshot?.decision?.bestAdjustedEdge) ??
    safeNumber(mispricing?.bestAdjustedEdge);
  const evaluated = evaluateStrategyZoneGuard({
    side: bestSide,
    adjustedEdge,
    minutesRemaining: safeNumber(snapshot?.minutesRemaining),
    entryProbability,
  });

  return {
    evaluated,
    bestSide,
    entryProbability,
    adjustedEdge,
    snapshotReason: snapshot?.decision?.reason || null,
  };
}

function isStrategyAuditCandidate(snapshot) {
  const stage = snapshot?.decision?.stage || null;
  const reason = snapshot?.decision?.reason || null;

  if (stage === "TARGET_DISTANCE") {
    return false;
  }

  if (reason === "MARKET_PROBABILITY_NOT_AVAILABLE") {
    return false;
  }

  return true;
}

function isAcceptedTrade(trade) {
  if (!trade || getDateOnly(trade.openedAt) === "") {
    return false;
  }

  if (trade?.strategy?.name === STRATEGY_NAME) {
    return true;
  }

  const inferred = evaluateStrategyZoneGuard({
    side: trade.side,
    adjustedEdge: trade.adjustedEdge,
    minutesRemaining: trade.minutesRemaining,
    entryProbability: trade.entryProbability,
  });

  return Boolean(inferred.ok && trade.source === "PAPER_DECISION_FLOW");
}

function summarizeAcceptedTrades(trades = []) {
  if (trades.length === 0) {
    return buildEmptyAccepted();
  }

  const settled = trades.filter((trade) => trade.status !== "OPEN");
  const wins = settled.filter((trade) => trade.status === "WON");
  const losses = settled.filter((trade) => trade.status === "LOST");
  const totalRiskedUsd = trades.reduce((sum, trade) => sum + safeNumber(trade.costUsd, 0), 0);
  const pnlUsd = settled.reduce((sum, trade) => sum + safeNumber(trade.pnlUsd, 0), 0);
  const avgEntryPrice =
    trades.reduce((sum, trade) => sum + safeNumber(trade.entryProbability, 0), 0) / trades.length;
  const avgAdjustedEdge =
    trades.reduce((sum, trade) => sum + safeNumber(trade.adjustedEdge, 0), 0) / trades.length;
  const avgMinutesRemaining =
    trades.reduce((sum, trade) => sum + safeNumber(trade.minutesRemaining, 0), 0) / trades.length;

  return {
    trades: trades.length,
    settledTrades: settled.length,
    openTrades: trades.length - settled.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? round((wins.length / settled.length) * 100) : 0,
    totalRiskedUsd: round(totalRiskedUsd) || 0,
    pnlUsd: round(pnlUsd) || 0,
    roiPct: totalRiskedUsd > 0 ? round((pnlUsd / totalRiskedUsd) * 100) : 0,
    maxDrawdownUsd: computeMaxDrawdown(
      settled
        .slice()
        .sort((a, b) => new Date(a.closedAt || a.openedAt || 0) - new Date(b.closedAt || b.openedAt || 0))
    ),
    avgEntryPrice: round(avgEntryPrice) || 0,
    avgAdjustedEdge: round(avgAdjustedEdge) || 0,
    avgMinutesRemaining: round(avgMinutesRemaining) || 0,
  };
}

function determineVerdict({ accepted, rejectedOutcomeAudit }) {
  if ((accepted.settledTrades || 0) < 20) {
    return "INSUFFICIENT_DATA";
  }

  const acceptedRoi = safeNumber(accepted.roiPct, 0);
  const rejectedRoi = safeNumber(rejectedOutcomeAudit.hypotheticalRoiPct, 0);
  const controlledDrawdown = safeNumber(accepted.maxDrawdownUsd, 0) <= Math.max(safeNumber(accepted.totalRiskedUsd, 0), 1);

  if (acceptedRoi > 0 && acceptedRoi > rejectedRoi && controlledDrawdown) {
    return "PROMISING";
  }

  if (acceptedRoi > 0 && rejectedRoi >= acceptedRoi) {
    return "OVERFIT_WARNING";
  }

  if (acceptedRoi < 0 && rejectedRoi > acceptedRoi) {
    return "BAD_GUARD";
  }

  if (acceptedRoi <= 0 && rejectedRoi <= 0) {
    return "NO_EDGE";
  }

  return "OVERFIT_WARNING";
}

export function generateStrategyGuardDailyReport({
  date = new Date().toISOString().slice(0, 10),
  sessionId = process.env.KALSHI_ACTIVE_SESSION_ID || null,
  hypotheticalSizeUsd = 5,
} = {}) {
  const notes = [];
  const warnings = [];

  const paperTrades = readJsonArray(PAPER_LEDGER_PATH, warnings, "PAPER_LEDGER");
  const featureSnapshots = readJsonl(FEATURE_SNAPSHOT_PATH, warnings, "FEATURE_SNAPSHOTS");
  const labeledSnapshots = readJsonArray(LABELED_SNAPSHOT_DATASET_PATH, warnings, "LABELED_SNAPSHOTS");
  const marketSnapshots = readJsonArray(SNAPSHOT_PATH, warnings, "MARKET_SNAPSHOTS");
  const sessionStatus = readJsonObject(SESSION_STATUS_PATH, warnings, "SESSION_STATUS");

  if (warnings.length > 0) {
    notes.push(...warnings);
  }

  const featureBySnapshotId = new Map(
    featureSnapshots
      .filter((row) => row?.snapshot_id)
      .map((row) => [row.snapshot_id, row])
  );
  const labeledBySnapshotId = new Map(
    labeledSnapshots
      .filter((row) => row?.snapshotId)
      .map((row) => [row.snapshotId, row])
  );

  const acceptedTrades = paperTrades.filter(
    (trade) => getDateOnly(trade?.openedAt) === date && isAcceptedTrade(trade)
  );
  if (acceptedTrades.length > 0 && acceptedTrades.some((trade) => !trade?.strategy?.name)) {
    notes.push("ACCEPTED_TRADES_INFERRED_FROM_TRADE_SHAPE");
  }
  const accepted = summarizeAcceptedTrades(acceptedTrades);

  const dailySnapshots = marketSnapshots.filter((snapshot) => getDateOnly(snapshot?.createdAt) === date);
  const rejected = buildEmptyRejected();
  const rejectedOutcomeAudit = buildEmptyRejectedOutcomeAudit();
  let upstreamExcludedCount = 0;

  for (const snapshot of dailySnapshots) {
    if (!isStrategyAuditCandidate(snapshot)) {
      upstreamExcludedCount += 1;
      continue;
    }

    const resolution = resolveStrategyReason(snapshot);
    if (resolution.evaluated.ok) {
      continue;
    }

    const reason = resolution.evaluated.reason;
    if (!rejected.byReason[reason]) {
      rejected.byReason[reason] = 0;
    }
    rejected.byReason[reason] += 1;
    rejected.totalRejected += 1;

    if (resolution.snapshotReason && resolution.snapshotReason !== reason) {
      notes.push(`INFERRED_GUARD_REASON:${snapshot.id}:${resolution.snapshotReason}->${reason}`);
    }

    const featureRow = featureBySnapshotId.get(snapshot.id);
    const labeledRow = labeledBySnapshotId.get(snapshot.id);
    const settlementOutcome =
      featureRow?.settlement_outcome ||
      labeledRow?.label ||
      null;

    if (!settlementOutcome) {
      rejectedOutcomeAudit.pendingRejectedCandidates += 1;
      continue;
    }

    const hypothetical = calculateHypotheticalPnl({
      side: resolution.bestSide,
      entryProbability: resolution.entryProbability,
      actualOutcome: settlementOutcome,
      sizeUsd: hypotheticalSizeUsd,
    });

    if (!hypothetical.ok) {
      notes.push(`REJECTED_HYPOTHETICAL_SKIPPED:${snapshot.id}:${hypothetical.reason}`);
      continue;
    }

    rejectedOutcomeAudit.settledRejectedCandidates += 1;
    rejectedOutcomeAudit.hypotheticalPnlUsd += safeNumber(hypothetical.pnlUsd, 0);
    rejectedOutcomeAudit.hypotheticalRiskedUsd += safeNumber(hypothetical.costUsd, 0);

    if (hypothetical.result === "WON") {
      rejectedOutcomeAudit.wouldHaveWon += 1;
    } else {
      rejectedOutcomeAudit.wouldHaveLost += 1;
    }
  }

  rejectedOutcomeAudit.hypotheticalPnlUsd = round(rejectedOutcomeAudit.hypotheticalPnlUsd) || 0;
  rejectedOutcomeAudit.hypotheticalRiskedUsd = round(rejectedOutcomeAudit.hypotheticalRiskedUsd) || 0;
  rejectedOutcomeAudit.hypotheticalRoiPct =
    rejectedOutcomeAudit.hypotheticalRiskedUsd > 0
      ? round((rejectedOutcomeAudit.hypotheticalPnlUsd / rejectedOutcomeAudit.hypotheticalRiskedUsd) * 100) || 0
      : 0;

  if (upstreamExcludedCount > 0) {
    notes.push(`UPSTREAM_BLOCKED_SNAPSHOTS_EXCLUDED:${upstreamExcludedCount}`);
  }

  const scannerHealth = {
    latestScannerRunAt:
      sessionStatus?.scannerStatus?.lastRun ||
      dailySnapshots.at(-1)?.createdAt ||
      null,
    btcMarketsScanned:
      safeNumber(sessionStatus?.scannerStatus?.lastResult?.btcMarketsFound) ||
      0,
    snapshotsCreated:
      safeNumber(sessionStatus?.scannerStatus?.lastResult?.snapshotsCreated) ||
      dailySnapshots.length,
    errors:
      Array.isArray(sessionStatus?.scannerStatus?.lastResult?.errors)
        ? sessionStatus.scannerStatus.lastResult.errors.length
        : 0,
  };

  const verdict = determineVerdict({ accepted, rejectedOutcomeAudit });
  const report = {
    date,
    sessionId: sessionId || sessionStatus?.sessionId || null,
    strategyName: STRATEGY_NAME,
    generatedAt: new Date().toISOString(),
    scannerHealth,
    accepted,
    rejected,
    rejectedOutcomeAudit,
    comparison: {
      acceptedRoiPct: accepted.roiPct,
      rejectedHypotheticalRoiPct: rejectedOutcomeAudit.hypotheticalRoiPct,
      guardValue: verdict,
    },
    verdict,
    notes,
  };

  return {
    ok: true,
    report,
    filePath: getStrategyGuardReportPath(),
  };
}

export function generateAndSaveStrategyGuardDailyReport(options = {}) {
  const result = generateStrategyGuardDailyReport(options);
  saveStrategyGuardDailyReport(result.report);
  return result;
}
