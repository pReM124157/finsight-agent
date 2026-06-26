import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(moduleDir, "../../../data");
const LESSONS_JSONL = path.join(DATA_DIR, "lessons.jsonl");
const LESSONS_MD = path.join(DATA_DIR, "lessons.md");
const DEFAULT_HIGH_DISAGREEMENT_THRESHOLD = 20;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function pickValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function normalizeOutcome(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "YES" || normalized === "NO" ? normalized : null;
}

function normalizeSnapshot(snapshot = {}) {
  const modelProbabilityYes = safeNumber(
    pickValue(
      snapshot.model_probability_yes,
      snapshot.model_prob_yes,
      snapshot.modelProbabilityYes,
      snapshot.modelProbability
    )
  );
  const marketProbabilityYes = safeNumber(
    pickValue(
      snapshot.market_probability_yes,
      snapshot.market_prob_yes,
      snapshot.marketProbabilityYes,
      snapshot.marketProbability
    )
  );
  const disagreementPoints =
    safeNumber(
      pickValue(
        snapshot.model_market_disagreement_points,
        snapshot.model_market_disagreement_pts,
        snapshot.disagreementPoints
      )
    ) ??
    (modelProbabilityYes !== null && marketProbabilityYes !== null
      ? round(Math.abs(modelProbabilityYes - marketProbabilityYes), 2)
      : null);

  return {
    snapshotId: pickValue(snapshot.snapshot_id, snapshot.snapshotId, snapshot.id),
    marketTicker: pickValue(snapshot.market_ticker, snapshot.marketTicker),
    modelProbabilityYes,
    marketProbabilityYes,
    settlementOutcome: normalizeOutcome(
      pickValue(snapshot.settlement_outcome, snapshot.settlementOutcome)
    ),
    minutesRemaining: safeNumber(
      pickValue(snapshot.minutes_remaining, snapshot.minutesRemaining)
    ),
    momentum5minBps: safeNumber(
      pickValue(snapshot.momentum_5min_bps, snapshot.momentum5minBps)
    ),
    realizedVol15min: safeNumber(
      pickValue(snapshot.realized_vol_15min, snapshot.realizedVol15min)
    ),
    distanceBps: safeNumber(
      pickValue(snapshot.distance_bps, snapshot.distanceBps)
    ),
    disagreementPoints,
  };
}

function buildTrackingCategories(normalized) {
  const tags = [];

  if (
    normalized.disagreementPoints !== null &&
    normalized.disagreementPoints >= DEFAULT_HIGH_DISAGREEMENT_THRESHOLD
  ) {
    tags.push("HIGH_DISAGREEMENT");
  }

  return tags;
}

export function classifyLesson(snapshot = {}) {
  const normalized = normalizeSnapshot(snapshot);
  const trackingCategories = buildTrackingCategories(normalized);

  if (
    normalized.modelProbabilityYes === null ||
    normalized.settlementOutcome === null
  ) {
    return {
      category: "INSUFFICIENT_DATA",
      wasModelCorrect: null,
      wasMarketCorrect: null,
      trackingCategories,
      detail: "Missing model probability or settlement outcome - cannot classify.",
    };
  }

  const modelPredictedYes = normalized.modelProbabilityYes >= 50;
  const actualYes = normalized.settlementOutcome === "YES";
  const wasModelCorrect = modelPredictedYes === actualYes;
  const wasMarketCorrect =
    normalized.marketProbabilityYes !== null
      ? (normalized.marketProbabilityYes >= 50) === actualYes
      : null;

  if (wasModelCorrect) {
    return {
      category: "CORRECT",
      wasModelCorrect: true,
      wasMarketCorrect,
      trackingCategories,
      detail: `Model predicted ${modelPredictedYes ? "YES" : "NO"} at ${normalized.modelProbabilityYes.toFixed(1)}%, outcome was ${normalized.settlementOutcome}.`,
    };
  }

  if (
    normalized.minutesRemaining !== null &&
    normalized.minutesRemaining <= 3 &&
    (normalized.modelProbabilityYes >= 90 || normalized.modelProbabilityYes <= 10)
  ) {
    return {
      category: "LATE_WINDOW_EXTREME_REVERSAL",
      wasModelCorrect: false,
      wasMarketCorrect,
      trackingCategories,
      detail: `Model was ${normalized.modelProbabilityYes.toFixed(1)}% with only ${normalized.minutesRemaining} min left, then settlement flipped the other way. Check whether late-window confidence is overconfident relative to remaining time-for-reversal.`,
    };
  }

  if (Math.abs(normalized.momentum5minBps ?? 0) >= 20) {
    return {
      category: "MOMENTUM_REVERSED",
      wasModelCorrect: false,
      wasMarketCorrect,
      trackingCategories,
      detail: `5-min momentum was ${normalized.momentum5minBps?.toFixed(1)} bps right before a miss. Possible momentum-decay or mean-reversion effect near expiry that the model underweights.`,
    };
  }

  if ((normalized.realizedVol15min ?? 0) >= 0.15) {
    return {
      category: "HIGH_VOLATILITY_REGIME",
      wasModelCorrect: false,
      wasMarketCorrect,
      trackingCategories,
      detail: `Realized 15-min volatility was ${(normalized.realizedVol15min * 100).toFixed(1)}%, well above typical. Model's volatility input may have been stale or the regime shifted faster than the rolling window captured.`,
    };
  }

  if (Math.abs(normalized.distanceBps ?? 999) <= 2) {
    return {
      category: "NEAR_STRIKE_COINFLIP",
      wasModelCorrect: false,
      wasMarketCorrect,
      trackingCategories,
      detail: `Distance to target was only ${normalized.distanceBps?.toFixed(2)} bps - this was close to a coin flip. A miss here is expected noise, not necessarily a model deficiency.`,
    };
  }

  return {
    category: "UNCATEGORIZED_MISS",
    wasModelCorrect: false,
    wasMarketCorrect,
    trackingCategories,
    detail: `Model predicted ${modelPredictedYes ? "YES" : "NO"} at ${normalized.modelProbabilityYes.toFixed(1)}%, outcome was ${normalized.settlementOutcome}. Did not match a known failure pattern - review manually.`,
  };
}

export function recordLesson(snapshot = {}) {
  ensureDataDir();
  const normalized = normalizeSnapshot(snapshot);
  const lesson = classifyLesson(snapshot);
  const row = {
    recorded_at: new Date().toISOString(),
    snapshot_id: normalized.snapshotId,
    market_ticker: normalized.marketTicker,
    ...lesson,
    raw: {
      modelProbabilityYes: normalized.modelProbabilityYes,
      marketProbabilityYes: normalized.marketProbabilityYes,
      settlementOutcome: normalized.settlementOutcome,
      minutesRemaining: normalized.minutesRemaining,
      momentum5minBps: normalized.momentum5minBps,
      realizedVol15min: normalized.realizedVol15min,
      distanceBps: normalized.distanceBps,
      disagreementPoints: normalized.disagreementPoints,
    },
  };

  fs.appendFileSync(LESSONS_JSONL, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

function readLessons() {
  ensureDataDir();

  if (!fs.existsSync(LESSONS_JSONL)) {
    return [];
  }

  return fs
    .readFileSync(LESSONS_JSONL, "utf8")
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

export function summarizeLessonsForTrackingCategory(category) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  const rows = readLessons().filter((row) =>
    Array.isArray(row.trackingCategories) &&
    row.trackingCategories.includes(normalizedCategory)
  );
  const graded = rows.filter((row) => row.wasModelCorrect === true || row.wasModelCorrect === false);
  const wins = graded.filter((row) => row.wasModelCorrect === true).length;

  return {
    category: normalizedCategory,
    labeledCount: graded.length,
    hitRate: graded.length ? wins / graded.length : null,
  };
}

export function regenerateLessonsMarkdown() {
  ensureDataDir();
  const rows = readLessons();

  if (rows.length === 0) {
    fs.writeFileSync(LESSONS_MD, "# Lessons\n\nNo lessons recorded yet.\n", "utf8");
    return { totalLessons: 0, totalMisses: 0, totalCorrect: 0, categories: [] };
  }

  const byCategory = {};
  for (const row of rows) {
    byCategory[row.category] = byCategory[row.category] || [];
    byCategory[row.category].push(row);
  }

  const totalMisses = rows.filter((row) => row.wasModelCorrect === false).length;
  const totalCorrect = rows.filter((row) => row.wasModelCorrect === true).length;
  const totalGraded = totalMisses + totalCorrect;
  const highDisagreement = summarizeLessonsForTrackingCategory("HIGH_DISAGREEMENT");

  let md = "# Lessons Log\n\n";
  md += `_Regenerated: ${new Date().toISOString()}_\n\n`;
  md += "**Honest framing:** this file groups why predictions missed so we can review repeatable patterns at volume before changing model code. ";
  md += "It does not automatically update probabilities, and it does not give the model memory between calls.\n\n";
  md += "## Summary\n\n";
  md += `- Total graded predictions: ${totalGraded}\n`;
  md += `- Correct: ${totalCorrect} (${totalGraded ? ((100 * totalCorrect) / totalGraded).toFixed(1) : "0"}%)\n`;
  md += `- Missed: ${totalMisses} (${totalGraded ? ((100 * totalMisses) / totalGraded).toFixed(1) : "0"}%)\n`;
  md += `- High disagreement subset: ${highDisagreement.labeledCount} graded`;
  md += highDisagreement.hitRate === null
    ? " (hit rate n/a)\n\n"
    : ` (${(highDisagreement.hitRate * 100).toFixed(1)}% hit rate)\n\n`;

  md += "## Miss categories\n\n";
  const missCategories = Object.entries(byCategory)
    .filter(([category]) => category !== "CORRECT" && category !== "INSUFFICIENT_DATA")
    .sort((a, b) => b[1].length - a[1].length);

  if (missCategories.length === 0) {
    md += "No misses recorded yet.\n\n";
  }

  for (const [category, categoryRows] of missCategories) {
    md += `### ${category} (${categoryRows.length})\n\n`;
    md += categoryRows.length >= 20
      ? "**Status: enough examples to review for a possible model change.**\n\n"
      : `**Status: only ${categoryRows.length} examples so far - not enough to act on yet. Need ~20+ before drawing conclusions.**\n\n`;

    md += "Recent examples:\n\n";
    for (const row of categoryRows.slice(-3)) {
      md += `- \`${row.market_ticker || "UNKNOWN"}\` (${row.recorded_at}): ${row.detail}\n`;
    }
    md += "\n";
  }

  fs.writeFileSync(LESSONS_MD, md, "utf8");
  return {
    totalLessons: rows.length,
    totalMisses,
    totalCorrect,
    categories: Object.keys(byCategory),
    highDisagreement,
  };
}

export const lessonExtractorPaths = {
  DATA_DIR,
  LESSONS_JSONL,
  LESSONS_MD,
};
