import fs from "node:fs";
import path from "node:path";

import { FeatureSnapshot } from "../models/FeatureSnapshot.model.js";
import { LabeledSnapshot } from "../models/LabeledSnapshot.model.js";

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
  if (text === "YES") return "YES";
  if (text === "NO") return "NO";
  return null;
}

function formatPct(value, digits = 1) {
  return value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(digits)}%`;
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

function detectPriceFormat(rows = []) {
  const sample = rows.find((row) => {
    const ask = safeNumber(getField(row, ["yesAsk", "yes_ask"]));
    const bid = safeNumber(getField(row, ["yesBid", "yes_bid"]));
    return ask !== null && bid !== null;
  });

  const ask = safeNumber(getField(sample, ["yesAsk", "yes_ask"]));
  const bid = safeNumber(getField(sample, ["yesBid", "yes_bid"]));
  const centsLike = (ask !== null && ask > 1) || (bid !== null && bid > 1);

  return {
    sample,
    mode: centsLike ? "CENTS_0_TO_100" : "DECIMAL_0_TO_1",
    scale: centsLike ? 100 : 1,
  };
}

function toPriceFraction(value, scale) {
  const n = safeNumber(value);
  if (n === null) return null;
  return scale === 100 ? n / 100 : n;
}

function buildCurrentEdge(row) {
  const explicit = getField(row, ["currentEdge", "adjustedEdge", "adjusted_edge", "bestAdjustedEdge"]);
  if (explicit !== null && explicit !== undefined) {
    return toFraction(explicit);
  }

  const model = toFraction(getField(row, ["modelProbability", "modelYesProbability", "model_prob_yes"]));
  const market = toFraction(getField(row, ["marketProbability", "marketProbabilityYes", "market_prob_yes"]));

  if (model === null || market === null) return null;
  return round(model - market, 4);
}

function spreadBand(spread) {
  if (spread === null) return "unknown";
  if (spread < 0.03) return "0-3c";
  if (spread < 0.06) return "3-6c";
  if (spread < 0.10) return "6-10c";
  return "10c+";
}

function mean(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function summarizeOutcomes(rows = []) {
  const settled = rows.filter((row) => row.outcome);
  const wins = settled.filter((row) => row.outcome === "YES").length;
  return {
    count: settled.length,
    actualWinRate: settled.length ? round(wins / settled.length, 4) : null,
  };
}

function getCanonicalModelProbability(row = {}) {
  const canonicalValue =
    row?.model_prob_yes !== undefined && row?.model_prob_yes !== null
      ? row.model_prob_yes
      : row?.modelProb !== undefined && row?.modelProb !== null
        ? row.modelProb
        : null;
  return toFraction(canonicalValue);
}

function isTestRecord(row = {}) {
  return row?.pipeline_version === "mongo-test-v1" ||
    row?.pipelineVersion === "mongo-test-v1" ||
    String(row?.market_ticker || row?.marketTicker || "").startsWith("MONGO_TEST");
}

async function loadSourceRows() {
  const labeledPath = path.resolve("backend/data/kalshi-labeled-snapshots.json");
  const featurePath = path.resolve("backend/data/kalshi-feature-snapshots.jsonl");

  try {
    const featureRows = await FeatureSnapshot.find({}).lean();
    if (featureRows.length > 0) {
      const labeledRows = await LabeledSnapshot.find({}).lean();
      return {
        source: "MONGO_FEATURE_SNAPSHOTS",
        featureRows,
        labeledRows,
      };
    }
  } catch {}

  return {
    source: "LOCAL_FEATURE_SNAPSHOTS",
    featureRows: readJsonlFile(featurePath),
    labeledRows: readJsonFile(labeledPath, []),
  };
}

function normalizeRows(featureRows = [], labeledRows = [], scale = 100) {
  const labeledBySnapshot = new Map(
    labeledRows
      .map((row) => [getField(row, ["snapshotId", "snapshot_id"]), row])
      .filter(([key]) => key)
  );

  const stats = {
    skippedNoModelProbability: 0,
    skippedLocked: 0,
    skippedOpenArtifacts: 0,
    skippedNoAsk: 0,
  };

  const records = featureRows
    .map((row) => {
      const snapshotId = getField(row, ["snapshotId", "snapshot_id", "id"]);
      const labeled = labeledBySnapshot.get(snapshotId) || null;
      const modelProbability = getCanonicalModelProbability(row);
      const yesAsk = toPriceFraction(getField(row, ["yesAsk", "yes_ask"]), scale);
      const yesBid = toPriceFraction(getField(row, ["yesBid", "yes_bid"]), scale);
      const minutesRemaining = safeNumber(getField(row, ["minutesRemaining", "minutes_remaining"]));
      const currentEdge = buildCurrentEdge({
        ...row,
        currentEdge: labeled ? getField(labeled, ["bestAdjustedEdge", "adjustedEdge", "edgeYes"]) : undefined,
      });
      const isLocked = safeNumber(getField(row, ["yes_ask", "yesAsk"])) >= 99 &&
        safeNumber(getField(row, ["yes_bid", "yesBid"])) <= 1;
      const hasOpenArtifact = minutesRemaining !== null && minutesRemaining >= 15;
      const hasNoAsk = yesAsk === null || yesBid === null || yesAsk <= 0.01;

      if (hasOpenArtifact) {
        stats.skippedOpenArtifacts += 1;
        return null;
      }

      if (hasNoAsk) {
        stats.skippedNoAsk += 1;
        return null;
      }

      if (isLocked) {
        stats.skippedLocked += 1;
        return null;
      }

      if (modelProbability === null) {
        stats.skippedNoModelProbability += 1;
        return null;
      }

      if (yesAsk === null || yesBid === null || minutesRemaining === null) {
        return null;
      }

      const spread = round(Math.max(0, yesAsk - yesBid), 4);
      const halfSpread = round(spread / 2, 4);
      const vigAdjustedEdge = round(modelProbability - yesAsk, 4);
      const outcome = normalizeOutcome(
        getField(row, ["settlementOutcome", "settlement_outcome"]) ??
        getField(labeled, ["label", "settlementOutcome", "settlement_outcome"])
      );
      const currentStrategyZone =
        currentEdge !== null &&
        currentEdge >= 0.06 &&
        currentEdge <= 0.22 &&
        yesAsk >= 0.6 &&
        yesAsk < 0.95 &&
        minutesRemaining >= 8 &&
        minutesRemaining <= 12;

      return {
        snapshotId,
        marketTicker: getField(row, ["marketTicker", "market_ticker"]),
        timestamp: getField(row, ["capturedAt", "captured_at", "createdAt"]),
        modelProbability,
        marketProbability: toFraction(getField(row, ["marketProbability", "market_prob_yes"])),
        yesAsk,
        yesBid,
        minutesRemaining,
        spread,
        halfSpread,
        currentEdge,
        vigAdjustedEdge,
        edgeDelta: currentEdge === null ? null : round(vigAdjustedEdge - currentEdge, 4),
        isCurrentlyAccepted: currentStrategyZone,
        isVigPositive: vigAdjustedEdge !== null ? vigAdjustedEdge > 0 : false,
        isVigEdgeMet: vigAdjustedEdge !== null ? vigAdjustedEdge >= 0.06 : false,
        outcome,
      };
    })
    .filter(Boolean);

  return {
    rows: records,
    stats,
  };
}

function buildSpreadBreakdown(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const band = spreadBand(row.spread);
    if (!groups.has(band)) groups.set(band, []);
    groups.get(band).push(row);
  }

  const order = ["0-3c", "3-6c", "6-10c", "10c+", "unknown"];
  return order
    .filter((band) => groups.has(band))
    .map((band) => {
      const bucket = groups.get(band);
      const positive = bucket.filter((row) => row.isVigPositive).length;
      return {
        spreadBand: band,
        count: bucket.length,
        avgVigAdjustedEdge: round(mean(bucket.map((row) => row.vigAdjustedEdge)), 4),
        pctPositive: bucket.length ? round(positive / bucket.length, 4) : null,
      };
    });
}

export async function generateVigAuditReport() {
  const loaded = await loadSourceRows();
  const skippedTestRecords = loaded.featureRows.filter(isTestRecord).length;
  const filteredFeatureRows = loaded.featureRows.filter((row) => !isTestRecord(row));
  const preview = filteredFeatureRows.slice(0, 3);
  const priceFormat = detectPriceFormat(filteredFeatureRows);
  const canonicalModelCount = filteredFeatureRows.filter(
    (row) => row?.model_prob_yes !== null && row?.model_prob_yes !== undefined
      || row?.modelProb !== null && row?.modelProb !== undefined
  ).length;
  const lockedRawCount = filteredFeatureRows.filter(
    (row) => safeNumber(getField(row, ["yes_ask", "yesAsk"])) >= 99 &&
      safeNumber(getField(row, ["yes_bid", "yesBid"])) <= 1
  ).length;

  if (canonicalModelCount === 0) {
    return {
      ok: true,
      reportType: "VIG_ADJUSTED_EDGE_AUDIT",
      generatedAt: new Date().toISOString(),
      source: loaded.source,
      samplePreview: preview,
      detectedPriceFormat: priceFormat.mode,
      totals: {
        totalSnapshots: filteredFeatureRows.length,
        validSnapshots: 0,
        skippedNoModelProbability: filteredFeatureRows.length - lockedRawCount,
        skippedLocked: lockedRawCount,
        skippedOpenArtifacts: 0,
        skippedNoAsk: 0,
        skippedTestRecords,
        currentStrategyZone: 0,
        vigPositiveCount: 0,
        vigEdgeMetCount: 0,
        avgSpread: null,
        avgHalfSpread: null,
        avgCurrentEdge: null,
        avgVigAdjustedEdge: null,
        avgEdgeDelta: null,
        pctCurrentZoneStillPositive: null,
        pctCurrentZoneStillMeetsFloor: null,
      },
      spreadBreakdown: [],
      outcomeValidation: {
        vigEdgeMet: { count: 0, actualWinRate: null },
        vigEdgeNotMet: { count: 0, actualWinRate: null },
      },
      verdict: "INSUFFICIENT_DATA",
      recommendation:
        `0 valid snapshots had canonical model_prob_yes populated. Fix the feature snapshot pipeline first, then re-run the vig audit.`,
      suggestedChange: null,
    };
  }

  const normalized = normalizeRows(filteredFeatureRows, loaded.labeledRows, priceFormat.scale);
  const rows = normalized.rows;
  const strategyZoneRows = rows.filter((row) => row.isCurrentlyAccepted);

  const totalSnapshots = filteredFeatureRows.length;
  const validSnapshots = rows.length;
  const vigPositiveCount = strategyZoneRows.filter((row) => row.isVigPositive).length;
  const vigEdgeMetCount = strategyZoneRows.filter((row) => row.isVigEdgeMet).length;
  const outcomeMet = summarizeOutcomes(rows.filter((row) => row.isVigEdgeMet));
  const outcomeNotMet = summarizeOutcomes(rows.filter((row) => !row.isVigEdgeMet));

  const avgVigAdjustedEdge = mean(strategyZoneRows.map((row) => row.vigAdjustedEdge));
  let verdict = "INSUFFICIENT_DATA";
  if (validSnapshots >= 20 && strategyZoneRows.length > 0 && avgVigAdjustedEdge !== null) {
    if (avgVigAdjustedEdge >= 0.06) {
      verdict = "VIG_FLOOR_INTACT";
    } else if (avgVigAdjustedEdge >= 0.05) {
      verdict = "VIG_ERODES_EDGE";
    } else {
      verdict = "VIG_KILLS_EDGE";
    }
  }

  let recommendation = "Not enough data to audit the live strategy zone.";
  if (validSnapshots === 0) {
    recommendation =
      "0 valid snapshots had canonical model_prob_yes populated. Fix the feature snapshot pipeline first, then re-run the vig audit.";
  }
  if (verdict === "VIG_FLOOR_INTACT") {
    recommendation = "Current 6% edge floor is meaningful after vig. No change needed.";
  } else if (verdict === "VIG_ERODES_EDGE") {
    recommendation =
      "Raise the YES strategy floor modestly if needed. The live zone definition is currently in backend/src/kalshi/risk/strategyZoneGuard.js at minEdgePct default 6.";
  } else if (verdict === "VIG_KILLS_EDGE") {
    recommendation =
      "Current strategy zone has negative or near-zero EV after vig. Do not go live until the entry filter is recalibrated.";
  }

  return {
    ok: true,
    reportType: "VIG_ADJUSTED_EDGE_AUDIT",
    generatedAt: new Date().toISOString(),
    source: loaded.source,
    samplePreview: preview,
    detectedPriceFormat: priceFormat.mode,
    totals: {
      totalSnapshots,
      validSnapshots,
      skippedNoModelProbability: normalized.stats.skippedNoModelProbability,
      skippedLocked: normalized.stats.skippedLocked,
      skippedOpenArtifacts: normalized.stats.skippedOpenArtifacts,
      skippedNoAsk: normalized.stats.skippedNoAsk,
      skippedTestRecords,
      currentStrategyZone: strategyZoneRows.length,
      vigPositiveCount,
      vigEdgeMetCount,
      avgSpread: round(mean(rows.map((row) => row.spread)), 4),
      avgHalfSpread: round(mean(rows.map((row) => row.halfSpread)), 4),
      avgCurrentEdge: round(mean(strategyZoneRows.map((row) => row.currentEdge)), 4),
      avgVigAdjustedEdge: round(avgVigAdjustedEdge, 4),
      avgEdgeDelta: round(mean(strategyZoneRows.map((row) => row.edgeDelta)), 4),
      pctCurrentZoneStillPositive: strategyZoneRows.length ? round(vigPositiveCount / strategyZoneRows.length, 4) : null,
      pctCurrentZoneStillMeetsFloor: strategyZoneRows.length ? round(vigEdgeMetCount / strategyZoneRows.length, 4) : null,
    },
    spreadBreakdown: buildSpreadBreakdown(strategyZoneRows.length > 0 ? strategyZoneRows : rows),
    outcomeValidation: {
      vigEdgeMet: outcomeMet,
      vigEdgeNotMet: outcomeNotMet,
    },
    verdict,
    recommendation,
    suggestedChange:
      verdict === "VIG_ERODES_EDGE"
        ? 'backend/src/kalshi/risk/strategyZoneGuard.js -> minEdgePct: safeNumber(..., 6) // consider small upward adjustment only if new data supports it'
        : null,
  };
}

export function printVigAuditReport(report) {
  console.log("=== VIG-ADJUSTED EDGE AUDIT ===");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Source: ${report.source}`);
  console.log(`Detected price format: ${report.detectedPriceFormat}`);
  console.log("");
  console.log("Sample records:");
  console.log(JSON.stringify(report.samplePreview, null, 2));
  console.log("");
  console.log(`Total snapshots analyzed: ${report.totals.totalSnapshots}`);
  console.log(`Skipped test records: ${report.totals.skippedTestRecords}`);
  console.log(`Valid snapshots: ${report.totals.validSnapshots}`);
  console.log(`Skipped missing model prob: ${report.totals.skippedNoModelProbability}`);
  console.log(`Skipped locked markets: ${report.totals.skippedLocked}`);
  console.log(`Skipped open artifacts: ${report.totals.skippedOpenArtifacts}`);
  console.log(`Skipped no ask/one-sided books: ${report.totals.skippedNoAsk}`);
  console.log(`Avg spread (vig): ${formatPct(report.totals.avgSpread, 2)}`);
  console.log(`Avg half-spread: ${formatPct(report.totals.avgHalfSpread, 2)}`);
  console.log("");
  console.log("--- Strategy Zone (current: edge 6-22%, 8-12 min) ---");
  console.log(`Snapshots in zone: ${report.totals.currentStrategyZone}`);
  console.log(`Avg stored/current edge: ${formatPct(report.totals.avgCurrentEdge)}`);
  console.log(`Avg vig-adjusted edge: ${formatPct(report.totals.avgVigAdjustedEdge)}`);
  console.log(`Avg edge eaten by vig: ${formatPct(report.totals.avgEdgeDelta)}`);
  console.log(`Still vig-positive: ${report.totals.vigPositiveCount} (${formatPct(report.totals.pctCurrentZoneStillPositive, 0)})`);
  console.log(`Still meets 6% floor after vig: ${report.totals.vigEdgeMetCount} (${formatPct(report.totals.pctCurrentZoneStillMeetsFloor, 0)})`);
  console.log("");
  console.log("--- Spread Band Breakdown ---");
  console.log("Spread band | Count | Avg vig-edge | % Positive");
  for (const row of report.spreadBreakdown) {
    console.log(
      `${String(row.spreadBand).padEnd(10)} | ${String(row.count).padStart(5)} | ${String(formatPct(row.avgVigAdjustedEdge)).padStart(12)} | ${String(formatPct(row.pctPositive, 0)).padStart(10)}`
    );
  }
  console.log("");
  console.log("--- Outcome Validation (where available) ---");
  console.log(`Vig-floor-met trades: ${report.outcomeValidation.vigEdgeMet.count} -> actual win rate ${formatPct(report.outcomeValidation.vigEdgeMet.actualWinRate)}`);
  console.log(`Below-vig-floor trades: ${report.outcomeValidation.vigEdgeNotMet.count} -> actual win rate ${formatPct(report.outcomeValidation.vigEdgeNotMet.actualWinRate)}`);
  console.log("");
  console.log(`VERDICT: ${report.verdict}`);
  console.log(`RECOMMENDATION: ${report.recommendation}`);
  if (report.suggestedChange) {
    console.log(`SUGGESTED CHANGE: ${report.suggestedChange}`);
  }
}

export function writeVigAuditReport(report) {
  const targetPath =
    process.env.KALSHI_VIG_AUDIT_REPORT_PATH ||
    path.resolve("backend/data/kalshi-vig-audit-report.json");
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return targetPath;
}
