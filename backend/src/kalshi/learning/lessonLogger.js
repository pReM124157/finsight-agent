import fs from "node:fs";
import path from "node:path";

const LESSONS_MARKDOWN_PATH =
  process.env.KALSHI_LESSONS_MARKDOWN_PATH ||
  path.resolve("lessons.md");

const LESSONS_JSONL_PATH =
  process.env.KALSHI_LESSONS_JSONL_PATH ||
  path.resolve("data/kalshi-trade-lessons.jsonl");

const MARKET_SNAPSHOT_PATH =
  process.env.KALSHI_SNAPSHOT_PATH ||
  path.resolve("data/kalshi-market-snapshots.json");

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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

function readMarketSnapshots() {
  ensureDir(MARKET_SNAPSHOT_PATH);
  if (!fs.existsSync(MARKET_SNAPSHOT_PATH)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(MARKET_SNAPSHOT_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findSnapshotForTrade(trade) {
  const snapshots = readMarketSnapshots();
  const directMatch = snapshots.find(
    (snapshot) => snapshot?.decision?.paperTradeId === trade?.id
  );

  if (directMatch) {
    return directMatch;
  }

  const tradeOpenedAtMs = new Date(trade?.openedAt || 0).getTime();
  if (!trade?.marketTicker || !Number.isFinite(tradeOpenedAtMs)) {
    return null;
  }

  const candidates = snapshots
    .filter((snapshot) => snapshot?.marketTicker === trade.marketTicker)
    .map((snapshot) => ({
      snapshot,
      snapshotMs: new Date(snapshot?.createdAt || 0).getTime(),
    }))
    .filter(({ snapshotMs }) => Number.isFinite(snapshotMs))
    .sort(
      (a, b) =>
        Math.abs(a.snapshotMs - tradeOpenedAtMs) -
        Math.abs(b.snapshotMs - tradeOpenedAtMs)
    );

  return candidates[0]?.snapshot || null;
}

function getActualOutcome(trade) {
  const actualOutcome = String(trade?.settlement?.actualOutcome || "").trim().toUpperCase();
  if (actualOutcome === "YES" || actualOutcome === "NO") {
    return actualOutcome;
  }

  const side = String(trade?.side || "").trim().toUpperCase();
  if (trade?.status === "WON" && (side === "YES" || side === "NO")) {
    return side;
  }
  if (trade?.status === "LOST" && side === "YES") {
    return "NO";
  }
  if (trade?.status === "LOST" && side === "NO") {
    return "YES";
  }

  return null;
}

function buildPrimaryLesson({
  modelWasWrong,
  confidenceInPredictedSide,
  expectedStdPrice,
  actualMoveUsd,
  momentumBps,
}) {
  if (!modelWasWrong) {
    return {
      category: "MODEL_DIRECTION_CORRECT",
      hypothesis: "No directional failure to learn from on this trade.",
      suggestedAdjustment: "No model change from this record alone.",
    };
  }

  if (confidenceInPredictedSide !== null && confidenceInPredictedSide >= 80) {
    return {
      category: "EXTREME_CONFIDENCE_REVERSAL",
      hypothesis: "The model expressed very high conviction and still missed the realized side.",
      suggestedAdjustment: "Review confidence compression or tail handling for extreme probability outputs.",
    };
  }

  if (
    expectedStdPrice !== null &&
    actualMoveUsd !== null &&
    Math.abs(actualMoveUsd) > expectedStdPrice * 1.5
  ) {
    return {
      category: "VOLATILITY_REGIME_SHIFT",
      hypothesis: "Realized movement exceeded the model's expected short-horizon volatility budget.",
      suggestedAdjustment: "Revisit short-window volatility scaling or add a regime-sensitive volatility input.",
    };
  }

  if (
    momentumBps !== null &&
    actualMoveUsd !== null &&
    Math.abs(momentumBps) >= 5 &&
    Math.sign(momentumBps) !== Math.sign(actualMoveUsd)
  ) {
    return {
      category: "MOMENTUM_REVERSAL",
      hypothesis: "Recent momentum pointed one way, but settlement finished the other way.",
      suggestedAdjustment: "Revisit momentum weighting and whether reversal risk should downweight trend signals.",
    };
  }

  return {
    category: "CALIBRATION_MISS",
    hypothesis: "The model probability was directionally wrong without an obvious extreme-confidence or volatility explanation.",
    suggestedAdjustment: "Recalibrate the probability mapping around this feature regime before changing trading thresholds.",
  };
}

function buildTags({
  modelWasWrong,
  modelProbability,
  marketProbability,
  predictedOutcome,
  actualOutcome,
}) {
  const tags = [];
  if (modelWasWrong) tags.push("model_wrong");
  else tags.push("model_right");

  if (marketProbability !== null && predictedOutcome && actualOutcome) {
    const marketOutcome = marketProbability >= 50 ? "YES" : "NO";
    if (marketOutcome === actualOutcome) tags.push("market_right");
    else tags.push("market_wrong");
    if (predictedOutcome !== marketOutcome) tags.push("model_disagreed_with_market");
  }

  if (modelProbability !== null) {
    const confidence = predictedOutcome === "YES"
      ? modelProbability
      : 100 - modelProbability;
    if (confidence >= 80) tags.push("high_confidence");
    if (confidence <= 55) tags.push("near_threshold");
  }

  return tags;
}

function formatMarkdownLesson(lesson) {
  const predicted = lesson.predictedOutcome || "UNKNOWN";
  const actual = lesson.actualOutcome || "UNKNOWN";
  const confidenceText =
    lesson.confidenceInPredictedSide === null
      ? "n/a"
      : `${lesson.confidenceInPredictedSide}%`;
  const marketText =
    lesson.marketProbability === null ? "n/a" : `${lesson.marketProbability}%`;

  return [
    `## ${lesson.loggedAt} - ${lesson.category}`,
    `- Trade: \`${lesson.tradeId}\` on \`${lesson.marketTicker || "UNKNOWN"}\``,
    `- Market: ${lesson.marketTitle || "Unknown title"}`,
    `- Outcome: predicted ${predicted}, actual ${actual}, status ${lesson.tradeStatus || "UNKNOWN"}`,
    `- Model YES probability: ${lesson.modelProbability === null ? "n/a" : `${lesson.modelProbability}%`} | confidence in predicted side: ${confidenceText}`,
    `- Market YES probability at entry: ${marketText} | edge: ${lesson.edgeAtEntry === null ? "n/a" : `${lesson.edgeAtEntry}%`}`,
    `- Entry BTC: ${lesson.entryBtcPrice === null ? "n/a" : lesson.entryBtcPrice} | target: ${lesson.targetPrice === null ? "n/a" : lesson.targetPrice} | settlement BTC: ${lesson.settlementBtcPrice === null ? "n/a" : lesson.settlementBtcPrice}`,
    `- Hypothesis: ${lesson.hypothesis}`,
    `- Suggested adjustment: ${lesson.suggestedAdjustment}`,
    `- Tags: ${lesson.tags.join(", ")}`,
    "",
  ].join("\n");
}

function appendMarkdownLesson(lesson) {
  ensureDir(LESSONS_MARKDOWN_PATH);

  if (!fs.existsSync(LESSONS_MARKDOWN_PATH)) {
    fs.writeFileSync(
      LESSONS_MARKDOWN_PATH,
      "# Kalshi Lessons\n\nAppend-only trade lessons for post-settlement review.\n\n",
      "utf8"
    );
  }

  fs.appendFileSync(LESSONS_MARKDOWN_PATH, formatMarkdownLesson(lesson), "utf8");
}

function appendJsonlLesson(lesson) {
  ensureDir(LESSONS_JSONL_PATH);
  fs.appendFileSync(LESSONS_JSONL_PATH, `${JSON.stringify(lesson)}\n`, "utf8");
}

export function logPaperTradeLesson(trade = {}) {
  const actualOutcome = getActualOutcome(trade);
  const snapshot = findSnapshotForTrade(trade);
  const modelProbability =
    safeNumber(snapshot?.reachability?.modelProbability) ??
    safeNumber(trade?.modelProbability);
  const marketProbability =
    safeNumber(snapshot?.mispricing?.marketProbability) ??
    safeNumber(snapshot?.decision?.marketProbability) ??
    safeNumber(trade?.marketProbability);
  const predictedOutcome =
    modelProbability === null ? null : modelProbability >= 50 ? "YES" : "NO";
  const modelWasWrong =
    Boolean(predictedOutcome && actualOutcome && predictedOutcome !== actualOutcome);
  const confidenceInPredictedSide =
    modelProbability === null || !predictedOutcome
      ? null
      : predictedOutcome === "YES"
        ? round(modelProbability)
        : round(100 - modelProbability);
  const settlementBtcPrice = safeNumber(trade?.settlement?.settlementBtcPrice);
  const entryBtcPrice =
    safeNumber(snapshot?.btcPrice) ??
    safeNumber(trade?.btcPrice);
  const targetPrice =
    safeNumber(snapshot?.targetPrice) ??
    safeNumber(trade?.targetPrice);
  const actualMoveUsd =
    settlementBtcPrice !== null && entryBtcPrice !== null
      ? settlementBtcPrice - entryBtcPrice
      : null;
  const expectedStdPrice = safeNumber(snapshot?.reachability?.expectedStdPrice);
  const momentumBps =
    safeNumber(snapshot?.reachability?.momentumBps) ??
    safeNumber(snapshot?.momentumBps);
  const lessonCore = buildPrimaryLesson({
    modelWasWrong,
    confidenceInPredictedSide,
    expectedStdPrice,
    actualMoveUsd,
    momentumBps,
  });
  const lesson = {
    loggedAt: new Date().toISOString(),
    tradeId: trade?.id || null,
    marketTicker: trade?.marketTicker || snapshot?.marketTicker || null,
    marketTitle: snapshot?.marketTitle || snapshot?.rawMarket?.title || null,
    tradeStatus: trade?.status || null,
    sideTaken: trade?.side || null,
    predictedOutcome,
    actualOutcome,
    modelWasWrong,
    category: lessonCore.category,
    hypothesis: lessonCore.hypothesis,
    suggestedAdjustment: lessonCore.suggestedAdjustment,
    modelProbability: round(modelProbability),
    marketProbability: round(marketProbability),
    edgeAtEntry:
      modelProbability !== null && marketProbability !== null
        ? round(modelProbability - marketProbability)
        : null,
    confidenceInPredictedSide,
    entryBtcPrice: round(entryBtcPrice),
    targetPrice: round(targetPrice),
    settlementBtcPrice: round(settlementBtcPrice),
    expectedStdPrice: round(expectedStdPrice),
    actualMoveUsd: round(actualMoveUsd),
    momentumBps: round(momentumBps),
    pnlUsd: round(trade?.pnlUsd),
    returnPct: round(trade?.returnPct),
    snapshotId: snapshot?.id || null,
    tags: buildTags({
      modelWasWrong,
      modelProbability,
      marketProbability,
      predictedOutcome,
      actualOutcome,
    }),
  };

  appendMarkdownLesson(lesson);
  appendJsonlLesson(lesson);

  return {
    ok: true,
    lesson,
  };
}
