import fs from "node:fs";
import path from "node:path";

import { LabeledSnapshot } from "../models/LabeledSnapshot.model.js";
import { FeatureSnapshot } from "../models/FeatureSnapshot.model.js";

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function toFraction(value) {
  const n = safeNumber(value);
  if (n === null) return null;
  if (n >= 0 && n <= 1) return n;
  if (n >= 0 && n <= 100) return n / 100;
  return null;
}

function normalizeOutcome(value) {
  const text = String(value || "").trim().toUpperCase();
  if (["YES", "YES_WIN", "WIN", "TRUE", "1"].includes(text)) return "YES";
  if (["NO", "YES_LOSS", "LOSS", "FALSE", "0"].includes(text)) return "NO";
  return null;
}

function getField(row, keys = [], fallback = null) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      return row[key];
    }
  }
  return fallback;
}

function readJsonFile(filePath, fallback = []) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readJsonlFile(filePath) {
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
  } catch {
    return [];
  }
}

function mergeLabeledWithFeatures(labeledRows = [], featureRows = []) {
  const bySnapshotId = new Map(
    featureRows.map((row) => [getField(row, ["snapshotId", "snapshot_id"]), row]).filter(([key]) => key)
  );

  return labeledRows.map((row) => {
    const feature = bySnapshotId.get(getField(row, ["snapshotId", "snapshot_id"])) || null;
    return feature ? { ...feature, ...row, _featureJoin: true } : row;
  });
}

function isTestRecord(row = {}) {
  return row?.pipeline_version === "mongo-test-v1" ||
    row?.pipelineVersion === "mongo-test-v1" ||
    String(row?.market_ticker || row?.marketTicker || "").startsWith("MONGO_TEST");
}

function deriveCalibrationRowsFromFeatures(featureRows = []) {
  return featureRows.map((row) => ({
    ...row,
    snapshotId: getField(row, ["snapshotId", "snapshot_id"]),
    marketTicker: getField(row, ["marketTicker", "market_ticker"]),
    timestamp: getField(row, ["timestamp", "capturedAt", "captured_at", "createdAt"]),
    modelYesProbability: getField(row, ["model_prob_yes", "modelProb"]),
    bestAdjustedEdge: getField(row, ["bestAdjustedEdge", "adjustedEdge", "adjusted_edge"]),
    minutesRemaining: getField(row, ["minutesRemaining", "minutes_remaining"]),
    pipeline_version: getField(row, ["pipeline_version", "pipelineVersion"]),
    label: normalizeOutcome(getField(row, ["label", "settlementOutcome", "settlement_outcome"])),
  }));
}

function normalizeCalibrationRow(row = {}) {
  const modelProbability = toFraction(
    getField(row, [
      "model_prob_yes",
      "modelYesProbability",
      "modelProb",
    ])
  );

  const adjustedEdge = toFraction(
    getField(row, [
      "adjustedEdge",
      "adjusted_edge",
      "bestAdjustedEdge",
      "edgeYes",
      "edge_yes",
    ])
  );

  const outcome = normalizeOutcome(
    getField(row, [
      "settlementOutcome",
      "settlement_outcome",
      "outcome",
      "label",
      "yesWon",
      "settled_outcome",
    ])
  );

  return {
    raw: row,
    snapshotId: getField(row, ["snapshotId", "snapshot_id", "id"]),
    marketTicker: getField(row, ["marketTicker", "market_ticker"]),
    timestamp: getField(row, ["timestamp", "capturedAt", "captured_at", "createdAt"]),
    minutesRemaining: safeNumber(getField(row, ["minutesRemaining", "minutes_remaining"])),
    modelProbability,
    adjustedEdge,
    yesAsk: safeNumber(getField(row, ["yes_ask", "yesAsk"])),
    yesBid: safeNumber(getField(row, ["yes_bid", "yesBid"])),
    outcome,
    pipelineVersion: getField(row, ["pipeline_version", "pipelineVersion"], "UNKNOWN"),
  };
}

function toBucketLabel(start) {
  const end = Math.min(1, start + 0.05);
  return `${start.toFixed(2)}-${end.toFixed(2)}`;
}

function bucketMidpoint(start) {
  return round(start + 0.025, 4);
}

function assignBucket(probability) {
  if (!Number.isFinite(probability) || probability < 0.5 || probability > 1) {
    return null;
  }

  if (probability === 1) return 0.95;
  return Math.floor((probability - 0.5) / 0.05) * 0.05 + 0.5;
}

function buildBucketStats(rows = []) {
  const buckets = [];

  for (let start = 0.5; start < 1; start += 0.05) {
    const bucketStart = Number(start.toFixed(2));
    const bucketRows = rows.filter((row) => assignBucket(row.modelProbability) === bucketStart);
    const wins = bucketRows.filter((row) => row.outcome === "YES").length;
    const count = bucketRows.length;
    const actualWinRate = count ? wins / count : null;
    const expectedWinRate = bucketMidpoint(bucketStart);
    const calibrationError = actualWinRate === null ? null : Math.abs(actualWinRate - expectedWinRate);

    buckets.push({
      bucket: toBucketLabel(bucketStart),
      start: bucketStart,
      end: round(Math.min(1, bucketStart + 0.05), 2),
      midpoint: expectedWinRate,
      count,
      wins,
      actualWinRate: actualWinRate === null ? null : round(actualWinRate, 4),
      expectedWinRate,
      calibrationError: calibrationError === null ? null : round(calibrationError, 4),
      isWellCalibrated: calibrationError !== null ? calibrationError < 0.08 : null,
    });
  }

  return buckets;
}

function buildSummary(loadedRows = [], eligibleRows = [], buckets = []) {
  const populatedBuckets = buckets.filter((bucket) => bucket.count >= 5 && bucket.calibrationError !== null);
  const wins = eligibleRows.filter((row) => row.outcome === "YES").length;
  const meanCalibrationError = populatedBuckets.length
    ? populatedBuckets.reduce((sum, bucket) => sum + bucket.calibrationError, 0) / populatedBuckets.length
    : null;
  const worstBucket = populatedBuckets.length
    ? populatedBuckets.reduce((worst, bucket) => (bucket.calibrationError > worst.calibrationError ? bucket : worst))
    : null;
  const bestBucket = populatedBuckets.length
    ? populatedBuckets.reduce((best, bucket) => (bucket.calibrationError < best.calibrationError ? bucket : best))
    : null;

  let systemCalibrationVerdict = "INSUFFICIENT_DATA";
  if (eligibleRows.length >= 30 && meanCalibrationError !== null) {
    if (meanCalibrationError < 0.08) {
      systemCalibrationVerdict = "WELL_CALIBRATED";
    } else if (meanCalibrationError < 0.15) {
      systemCalibrationVerdict = "ACCEPTABLE";
    } else {
      systemCalibrationVerdict = "MISCALIBRATED";
    }
  }

  return {
    totalSnapshots: loadedRows.length,
    eligibleSnapshots: eligibleRows.length,
    overallActualWinRate: eligibleRows.length ? round(wins / eligibleRows.length, 4) : null,
    meanCalibrationError: meanCalibrationError === null ? null : round(meanCalibrationError, 4),
    worstBucket,
    bestBucket,
    systemCalibrationVerdict,
  };
}

function buildPipelineBreakdown(rows = []) {
  const counts = new Map();
  for (const row of rows) {
    const version = row.pipelineVersion || "UNKNOWN";
    counts.set(version, (counts.get(version) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([pipelineVersion, count]) => ({ pipelineVersion, count }))
    .sort((a, b) => b.count - a.count);
}

function analyzeSubset(loadedRows = []) {
  const eligibleRows = loadedRows.filter(
    (row) =>
      row.modelProbability !== null &&
      row.modelProbability !== undefined &&
      row.modelProbability >= 0.5 &&
      row.outcome
  );
  const buckets = buildBucketStats(eligibleRows);
  const summary = buildSummary(loadedRows, eligibleRows, buckets);
  return {
    summary,
    buckets,
  };
}

function countEligibleCalibrationRows(rows = []) {
  return rows.filter(
    (row) =>
      row.modelProbability !== null &&
      row.modelProbability !== undefined &&
      row.modelProbability >= 0.5 &&
      row.outcome
  ).length;
}

function countRowsWithModelProbability(rows = []) {
  return rows.filter((row) => row.modelProbability !== null && row.modelProbability !== undefined).length;
}

async function loadCalibrationSource() {
  const featurePath = path.resolve("backend/data/kalshi-feature-snapshots.jsonl");

  try {
    const mongoFeatures = await FeatureSnapshot.find({}).lean();
    if (mongoFeatures.length > 0) {
      const canonicalCount = mongoFeatures.filter(
        (row) => row?.model_prob_yes !== null && row?.model_prob_yes !== undefined
          || row?.modelProb !== null && row?.modelProb !== undefined
      ).length;

      if (canonicalCount > 0) {
        return {
          source: "MONGO_FEATURE_SNAPSHOTS",
          rawRows: mongoFeatures,
        };
      };

      return {
        source: "MONGO_FEATURE_SNAPSHOTS",
        rawRows: mongoFeatures,
      };
    }
  } catch {}

  const featureRows = readJsonlFile(featurePath);

  return {
    source: "LOCAL_FEATURE_SNAPSHOTS",
    rawRows: featureRows,
  };
}

export async function generateCalibrationReport() {
  const source = await loadCalibrationSource();
  const skippedTestRecords = source.rawRows.filter(isTestRecord).length;
  const filteredRows = source.rawRows.filter((row) => !isTestRecord(row));
  const preview = filteredRows.slice(0, 3);
  const normalizedRows = filteredRows.map(normalizeCalibrationRow);
  let skippedOpenArtifacts = 0;
  let skippedNoAsk = 0;
  const eligibleSourceRows = normalizedRows.filter((row) => {
    if (Number.isFinite(row.minutesRemaining) && row.minutesRemaining >= 15) {
      skippedOpenArtifacts += 1;
      return false;
    }

    if (row.yesAsk === null || row.yesAsk === undefined || row.yesBid === null || row.yesBid === undefined || row.yesAsk <= 1) {
      skippedNoAsk += 1;
      return false;
    }

    return true;
  });
  const rowsWithModelProbability = countRowsWithModelProbability(eligibleSourceRows);
  const skippedMissingModelProbability = eligibleSourceRows.length - rowsWithModelProbability;
  const baseAnalysis = analyzeSubset(eligibleSourceRows);

  const strategyRows = eligibleSourceRows.filter((row) => {
    return row.adjustedEdge !== null &&
      row.adjustedEdge >= 0.10 &&
      row.adjustedEdge <= 0.20 &&
      Number.isFinite(row.minutesRemaining) &&
      row.minutesRemaining >= 8 &&
      row.minutesRemaining <= 12;
  });

  const strategyZoneCalibration = analyzeSubset(strategyRows);
  const pipelineBreakdown = buildPipelineBreakdown(eligibleSourceRows);
  const latestTimestamp = eligibleSourceRows
    .map((row) => String(row.timestamp || ""))
    .filter(Boolean)
    .sort()
    .at(-1);

  const pipelineBug = rowsWithModelProbability === 0;

  return {
    ok: true,
    reportType: "CALIBRATION_ANALYSIS",
    reportDate: latestTimestamp ? latestTimestamp.slice(0, 10) : new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    source: source.source,
    blockedReason: pipelineBug
      ? `CALIBRATION_BLOCKED: 0 of ${eligibleSourceRows.length} filtered snapshots have model_prob_yes populated. Fix the feature snapshot pipeline first, then re-run calibration.`
      : null,
    samplePreview: preview,
    skippedTestRecords,
    skippedOpenArtifacts,
    skippedNoAsk,
    rowsWithModelProbability,
    skippedMissingModelProbability,
    summary: baseAnalysis.summary,
    buckets: baseAnalysis.buckets,
    strategyZoneCalibration: {
      summary: strategyZoneCalibration.summary,
      buckets: strategyZoneCalibration.buckets,
    },
    pipelineBreakdown,
    verdict: pipelineBug ? "PIPELINE_BUG" : baseAnalysis.summary.systemCalibrationVerdict,
  };
}

function formatPct(value, digits = 1) {
  return value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(digits)}%`;
}

function pad(value, width, align = "left") {
  const text = String(value);
  return align === "right" ? text.padStart(width, " ") : text.padEnd(width, " ");
}

export function printCalibrationReport(report) {
  console.log("=== CALIBRATION ANALYSIS REPORT ===");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Source: ${report.source}`);
  if (report.blockedReason) {
    console.log(report.blockedReason);
  }
  console.log(`Total labeled snapshots: ${report.summary.totalSnapshots}`);
  console.log(`Skipped test records: ${report.skippedTestRecords}`);
  console.log(`Skipped open artifacts: ${report.skippedOpenArtifacts}`);
  console.log(`Skipped no ask/one-sided books: ${report.skippedNoAsk}`);
  console.log(`Has model_prob_yes: ${report.rowsWithModelProbability}`);
  console.log(`Skipped missing model prob: ${report.skippedMissingModelProbability}`);
  console.log(`Eligible (model prob >= 50%): ${report.summary.eligibleSnapshots}`);
  console.log(`Overall actual win rate: ${formatPct(report.summary.overallActualWinRate)}`);
  console.log(`Mean calibration error: ${formatPct(report.summary.meanCalibrationError)}`);
  console.log(`System verdict: ${report.verdict}`);
  console.log("");
  console.log("Sample records:");
  console.log(JSON.stringify(report.samplePreview, null, 2));
  console.log("");
  console.log("--- Bucket Breakdown ---");
  console.log("Bucket        | Count | Expected | Actual  | Error   | Status");
  for (const bucket of report.buckets) {
    console.log(
      [
        pad(bucket.bucket.replace("-", "\u2013"), 12),
        pad(bucket.count, 5, "right"),
        pad(formatPct(bucket.expectedWinRate), 8, "right"),
        pad(formatPct(bucket.actualWinRate), 7, "right"),
        pad(formatPct(bucket.calibrationError), 7, "right"),
        bucket.count === 0 ? "-" : bucket.isWellCalibrated ? "✓ OK" : "⚠ OFF",
      ].join(" | ")
    );
  }
  console.log("");
  console.log("--- Strategy Zone (edge 10-20%, 8-12 min) ---");
  console.log("Bucket        | Count | Expected | Actual  | Error   | Status");
  for (const bucket of report.strategyZoneCalibration.buckets) {
    console.log(
      [
        pad(bucket.bucket.replace("-", "\u2013"), 12),
        pad(bucket.count, 5, "right"),
        pad(formatPct(bucket.expectedWinRate), 8, "right"),
        pad(formatPct(bucket.actualWinRate), 7, "right"),
        pad(formatPct(bucket.calibrationError), 7, "right"),
        bucket.count === 0 ? "-" : bucket.isWellCalibrated ? "✓ OK" : "⚠ OFF",
      ].join(" | ")
    );
  }
  console.log("");
  console.log("--- Pipeline Version Breakdown ---");
  for (const row of report.pipelineBreakdown) {
    console.log(`${row.pipelineVersion}: ${row.count}`);
  }
}
