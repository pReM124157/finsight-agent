import fs from "node:fs";
import path from "node:path";

import {
  getNoSideShadowReportPath,
  saveNoSideShadowReport,
} from "./noSideShadowReportStore.js";

const NO_SHADOW_AUDIT_PATH =
  process.env.KALSHI_NO_SIDE_SHADOW_AUDIT_PATH ||
  path.resolve("data/kalshi-no-side-shadow-audit.jsonl");

const STAKE_USD = 5;

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function getField(row, keys = [], fallback = null) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key];
    }
  }
  return fallback;
}

function normalizeReason(reason) {
  const text = String(reason || "").trim().toUpperCase();
  if (!text) return "MISSING_DATA";
  if (text.includes("EXPENSIVE") || text.includes("PRICE")) return "PRICE_TOO_EXPENSIVE";
  if (text.includes("EDGE")) return "ADJUSTED_EDGE_FLOOR";
  if (text.includes("BTC") && text.includes("BELOW")) return "BTC_NOT_BELOW_TARGET";
  if (text.includes("MOMENTUM")) return "MOMENTUM_NOT_SUPPORTIVE";
  if (text.includes("SPREAD")) return "SPREAD_TOO_WIDE";
  return text;
}

function readJsonl(filePath) {
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
}

function resolveReportDate(rows = [], requestedDate = null) {
  if (requestedDate) return requestedDate;
  const latest = rows
    .map((row) => String(getField(row, ["capturedAt", "captured_at", "createdAt", "created_at"], "")))
    .filter(Boolean)
    .sort()
    .at(-1);
  return latest ? latest.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function isSettledOutcome(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "YES" || normalized === "NO";
}

function calculateHypotheticalTrade(row) {
  const noAsk = safeNumber(getField(row, ["noAsk", "no_ask"]));
  const outcome = String(getField(row, ["settlementOutcome", "settlement_outcome"], "")).trim().toUpperCase();

  if (noAsk === null || noAsk <= 0 || noAsk >= 100) {
    return {
      executable: false,
      invalidPrice: true,
      won: null,
      pnlUsd: null,
      riskedUsd: 0,
    };
  }

  if (!isSettledOutcome(outcome)) {
    return {
      executable: true,
      invalidPrice: false,
      won: null,
      pnlUsd: null,
      riskedUsd: STAKE_USD,
    };
  }

  const entryPricePct = noAsk / 100;
  const won = outcome === "NO";
  const pnlUsd = won ? STAKE_USD * (1 / entryPricePct - 1) : -STAKE_USD;

  return {
    executable: true,
    invalidPrice: false,
    won,
    pnlUsd: round(pnlUsd),
    riskedUsd: STAKE_USD,
  };
}

function computeMaxDrawdown(rows = []) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const row of rows) {
    equity += safeNumber(row?.pnlUsd, 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return round(maxDrawdown) || 0;
}

function computePerformance(rows = []) {
  const settled = rows.filter((row) => row.executable && typeof row.won === "boolean");
  const wins = settled.filter((row) => row.won);
  const losses = settled.filter((row) => row.won === false);
  const totalRiskedUsd = round(settled.reduce((sum, row) => sum + safeNumber(row.riskedUsd, 0), 0)) || 0;
  const totalPnlUsd = round(settled.reduce((sum, row) => sum + safeNumber(row.pnlUsd, 0), 0)) || 0;
  const grossProfit = wins.reduce((sum, row) => sum + Math.max(0, safeNumber(row.pnlUsd, 0)), 0);
  const grossLoss = Math.abs(losses.reduce((sum, row) => sum + Math.min(0, safeNumber(row.pnlUsd, 0)), 0));
  const averageWinUsd = wins.length ? round(grossProfit / wins.length) : 0;
  const averageLossUsd = losses.length ? round(losses.reduce((sum, row) => sum + safeNumber(row.pnlUsd, 0), 0) / losses.length) : 0;
  const expectancyUsd = settled.length ? round(totalPnlUsd / settled.length) : 0;

  return {
    trades: settled.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? round((wins.length / settled.length) * 100) : 0,
    totalRiskedUsd,
    totalPnlUsd,
    roiPct: totalRiskedUsd > 0 ? round((totalPnlUsd / totalRiskedUsd) * 100) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : grossProfit > 0 ? null : 0,
    averageWinUsd,
    averageLossUsd,
    expectancyUsd,
    maxDrawdownUsd: computeMaxDrawdown(settled),
  };
}

function createBandStats(label, rows = []) {
  const performance = computePerformance(rows);
  return {
    band: label,
    rows: rows.length,
    settled: rows.filter((row) => row.settled).length,
    executable: rows.filter((row) => row.executable).length,
    wins: performance.wins,
    losses: performance.losses,
    winRate: performance.winRate,
    totalPnlUsd: performance.totalPnlUsd,
    roiPct: performance.roiPct,
    profitFactor: performance.profitFactor,
  };
}

function bandByPrice(value) {
  const n = safeNumber(value);
  if (n === null) return "unknown";
  if (n < 50) return "NO ask 0-50";
  if (n < 65) return "NO ask 50-65";
  if (n < 75) return "NO ask 65-75";
  if (n < 85) return "NO ask 75-85";
  if (n < 90) return "NO ask 85-90";
  if (n < 95) return "NO ask 90-95";
  return "NO ask 95-100";
}

function bandByEdge(value) {
  const n = safeNumber(value);
  if (n === null) return "edge unknown";
  if (n < 0) return "edge negative";
  if (n < 5) return "edge 0-5";
  if (n < 10) return "edge 5-10";
  if (n < 15) return "edge 10-15";
  if (n < 20) return "edge 15-20";
  return "edge 20+";
}

function bandByMinutes(value) {
  const n = safeNumber(value);
  if (n === null) return "minutes unknown";
  if (n < 3) return "minutes 0-3";
  if (n < 5) return "minutes 3-5";
  if (n < 8) return "minutes 5-8";
  if (n < 12) return "minutes 8-12";
  return "minutes 12-15";
}

function bandByDistance(value) {
  const n = Math.abs(safeNumber(value, NaN));
  if (!Number.isFinite(n)) return "distance unknown";
  if (n < 5) return "distance 0-5 bps";
  if (n < 10) return "distance 5-10 bps";
  if (n < 20) return "distance 10-20 bps";
  if (n < 50) return "distance 20-50 bps";
  return "distance 50+ bps";
}

function bandByMomentum(value) {
  const n = safeNumber(value);
  if (n === null) return "momentum unknown";
  if (n < -5) return "momentum strong_down < -5";
  if (n < 0) return "momentum slight_down -5 to 0";
  if (n === 0) return "momentum flat around 0";
  if (n <= 5) return "momentum slight_up 0 to 5";
  return "momentum strong_up > 5";
}

function groupBands(rows, selector) {
  const buckets = new Map();
  for (const row of rows) {
    const band = selector(row);
    if (!buckets.has(band)) buckets.set(band, []);
    buckets.get(band).push(row);
  }
  return Array.from(buckets.entries()).map(([band, bucketRows]) => createBandStats(band, bucketRows));
}

function buildReasonBreakdown(rejectedRows = []) {
  const counts = new Map();
  for (const row of rejectedRows) {
    const reasons = Array.isArray(row.reasonCodes) && row.reasonCodes.length > 0
      ? row.reasonCodes
      : [normalizeReason(getField(row, ["rejectionReason", "rejection_reason"], "MISSING_DATA"))];
    for (const reason of reasons) {
      const normalized = normalizeReason(reason);
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([reason, rows]) => ({ reason, rows }))
    .sort((a, b) => b.rows - a.rows);
}

function buildZoneLists(...bandSets) {
  const all = bandSets.flat().filter((band) => band.executable >= 5);
  const bestZones = all.filter((band) => band.roiPct > 0).sort((a, b) => b.roiPct - a.roiPct).slice(0, 10);
  const worstZones = all.filter((band) => band.roiPct < 0).sort((a, b) => a.roiPct - b.roiPct).slice(0, 10);
  return { bestZones, worstZones };
}

function buildRejectedAudit(rejectedRows = []) {
  const settledRejected = rejectedRows.filter((row) => row.settled);
  const rejectedWouldHaveWon = settledRejected.filter((row) => row.won).length;
  const rejectedWouldHaveLost = settledRejected.filter((row) => row.won === false).length;
  const pnl = round(settledRejected.reduce((sum, row) => sum + safeNumber(row.pnlUsd, 0), 0)) || 0;
  const risked = round(settledRejected.reduce((sum, row) => sum + safeNumber(row.riskedUsd, 0), 0)) || 0;
  const byReasonSeed = {
    ADJUSTED_EDGE_FLOOR: 0,
    PRICE_TOO_EXPENSIVE: 0,
    BTC_NOT_BELOW_TARGET: 0,
    MOMENTUM_NOT_SUPPORTIVE: 0,
    SPREAD_TOO_WIDE: 0,
    MISSING_DATA: 0,
  };

  for (const item of buildReasonBreakdown(rejectedRows)) {
    if (byReasonSeed[item.reason] === undefined) {
      byReasonSeed[item.reason] = 0;
    }
    byReasonSeed[item.reason] += item.rows;
  }

  return {
    totalRejected: rejectedRows.length,
    settledRejected: settledRejected.length,
    rejectedWouldHaveWon,
    rejectedWouldHaveLost,
    rejectedHypotheticalPnlUsd: pnl,
    rejectedHypotheticalRoiPct: risked > 0 ? round((pnl / risked) * 100) : 0,
    byReason: byReasonSeed,
  };
}

function buildVerdict(performance, bestZones) {
  if (performance.trades < 20) {
    return {
      verdict: "INSUFFICIENT_DATA",
      recommendation: "Keep NO blocked. Shadow sample is still too small.",
    };
  }

  if (performance.roiPct < -10) {
    return {
      verdict: "NO_SIDE_BROKEN",
      recommendation: "Keep NO disabled. Shadow candidates are losing.",
    };
  }

  if (performance.roiPct >= -10 && performance.roiPct <= 5) {
    return {
      verdict: "KEEP_NO_BLOCKED",
      recommendation: "No clear edge. Keep NO blocked.",
    };
  }

  if (
    performance.roiPct > 5 &&
    safeNumber(performance.profitFactor, 0) > 1.2 &&
    performance.maxDrawdownUsd <= STAKE_USD * 5 &&
    bestZones.length > 0
  ) {
    return {
      verdict: "PROMISING_SHADOW_ZONE",
      recommendation: "Do not enable broadly. Consider a narrow NO strategy zone only after more data.",
    };
  }

  return {
    verdict: "NEEDS_MORE_DATA",
    recommendation: "Data exists, but the NO shadow edge is not yet conclusive.",
  };
}

function normalizeRow(row = {}) {
  const hypothetical = calculateHypotheticalTrade(row);
  return {
    ...row,
    candidate: Boolean(getField(row, ["candidate"], false)),
    settled: isSettledOutcome(getField(row, ["settlementOutcome", "settlement_outcome"])),
    executable: hypothetical.executable,
    invalidPrice: hypothetical.invalidPrice,
    won: hypothetical.won,
    pnlUsd: hypothetical.pnlUsd,
    riskedUsd: hypothetical.riskedUsd,
    reasonCodes:
      Array.isArray(getField(row, ["reasonCodes", "reason_codes"], []))
        ? getField(row, ["reasonCodes", "reason_codes"], [])
        : [],
    noAsk: safeNumber(getField(row, ["noAsk", "no_ask"])),
    adjustedEdge: safeNumber(getField(row, ["noAdjustedEdge", "adjustedEdge", "adjusted_edge"])),
    minutesRemaining: safeNumber(getField(row, ["minutesRemaining", "minutes_remaining"])),
    distanceBps: safeNumber(getField(row, ["distanceBps", "distance_bps"])),
    btcBelowTarget: Boolean(getField(row, ["btcBelowTarget", "btc_below_target"], false)),
    momentumBps: safeNumber(getField(row, ["momentum1mBps", "momentum_1m_bps", "momentum5mBps", "momentum_5m_bps", "momentumBps", "momentum_bps"])),
  };
}

export function generateNoSideShadowReport(options = {}) {
  const warnings = [];
  const sourceFile = NO_SHADOW_AUDIT_PATH;

  if (!fs.existsSync(sourceFile)) {
    return {
      ok: false,
      reason: "NO_SHADOW_AUDIT_FILE_MISSING",
      totalRows: 0,
    };
  }

  const rawRows = readJsonl(sourceFile);
  if (rawRows.length === 0) {
    return {
      ok: true,
      verdict: "INSUFFICIENT_DATA",
      totalRows: 0,
    };
  }

  const rows = rawRows.map(normalizeRow);
  const reportDate = resolveReportDate(rows, options.date || null);
  const candidateRows = rows.filter((row) => row.candidate);
  const rejectedRows = rows.filter((row) => !row.candidate);
  const settledRows = rows.filter((row) => row.settled);
  const settledCandidates = candidateRows.filter((row) => row.settled);
  const executableSettledCandidates = settledCandidates.filter((row) => row.executable && !row.invalidPrice);
  const invalidPriceRows = rows.filter((row) => row.invalidPrice).length;
  const pendingRows = rows.filter((row) => !row.settled).length;

  const candidatePerformance = computePerformance(executableSettledCandidates);
  const rejectedAudit = buildRejectedAudit(rejectedRows);
  const priceBands = groupBands(executableSettledCandidates, (row) => bandByPrice(row.noAsk));
  const edgeBands = groupBands(executableSettledCandidates, (row) => bandByEdge(row.adjustedEdge));
  const minutesBands = groupBands(executableSettledCandidates, (row) => bandByMinutes(row.minutesRemaining));
  const distanceBands = groupBands(executableSettledCandidates, (row) => bandByDistance(row.distanceBps));
  const momentumBands = groupBands(executableSettledCandidates, (row) => bandByMomentum(row.momentumBps));
  const reasonBreakdown = buildReasonBreakdown(rejectedRows);
  const { bestZones, worstZones } = buildZoneLists(
    priceBands,
    edgeBands,
    minutesBands,
    distanceBands,
    momentumBands
  );
  const verdictBundle = buildVerdict(candidatePerformance, bestZones);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    reportDate,
    sourceFile,
    summary: {
      totalRows: rows.length,
      candidateRows: candidateRows.length,
      rejectedRows: rejectedRows.length,
      settledRows: settledRows.length,
      settledCandidates: settledCandidates.length,
      executableSettledCandidates: executableSettledCandidates.length,
      pendingRows,
      invalidPriceRows,
    },
    candidatePerformance,
    rejectedAudit,
    priceBands,
    edgeBands,
    minutesBands,
    distanceBands,
    momentumBands,
    reasonBreakdown,
    bestZones,
    worstZones,
    verdict: verdictBundle.verdict,
    recommendation: verdictBundle.recommendation,
    warnings,
  };
}

export function generateAndSaveNoSideShadowReport(options = {}) {
  const report = generateNoSideShadowReport(options);
  if (!report.ok) {
    return report;
  }

  saveNoSideShadowReport(report);
  return {
    ok: true,
    report,
    savedTo: getNoSideShadowReportPath(),
  };
}
