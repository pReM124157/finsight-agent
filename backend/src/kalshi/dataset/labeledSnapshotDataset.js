import fs from "node:fs";
import path from "node:path";

const LABELED_SNAPSHOT_DATASET_PATH =
  process.env.KALSHI_LABELED_SNAPSHOT_DATASET_PATH ||
  path.resolve("data/kalshi-labeled-snapshots.json");

function ensureDatasetDir() {
  const dir = path.dirname(LABELED_SNAPSHOT_DATASET_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readDataset() {
  ensureDatasetDir();

  if (!fs.existsSync(LABELED_SNAPSHOT_DATASET_PATH)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(LABELED_SNAPSHOT_DATASET_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDataset(records) {
  ensureDatasetDir();
  fs.writeFileSync(LABELED_SNAPSHOT_DATASET_PATH, JSON.stringify(records, null, 2) + "\n");
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toFixedNumber(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function generateId() {
  return `LABEL-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

function normalizeLabel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "YES" || normalized === "NO" ? normalized : null;
}

function buildSession(timestamp) {
  const date = new Date(timestamp || Date.now());
  const hour = date.getUTCHours();

  if (hour < 6) return "UTC_OVERNIGHT";
  if (hour < 12) return "UTC_MORNING";
  if (hour < 18) return "UTC_AFTERNOON";
  return "UTC_EVENING";
}

function buildProbabilityBucket(probability) {
  const prob = safeNumber(probability);
  if (prob === null) return "unknown";
  if (prob < 25) return "0-25";
  if (prob < 50) return "25-50";
  if (prob < 75) return "50-75";
  return "75-100";
}

function inferLabelFromSettlement({ targetPrice, settlementBtcPrice, settledSide }) {
  const normalizedSide = normalizeLabel(settledSide);
  if (normalizedSide) return normalizedSide;

  const target = safeNumber(targetPrice);
  const settlement = safeNumber(settlementBtcPrice);

  if (target === null || settlement === null) {
    return null;
  }

  return settlement >= target ? "YES" : "NO";
}

export function buildFeatureRowFromSnapshot(snapshot = {}) {
  const timestamp = snapshot.timestamp || snapshot.createdAt || new Date().toISOString();
  const btcPrice = safeNumber(snapshot.btcPrice);
  const targetPrice = safeNumber(snapshot.targetPrice);
  const distanceUsd =
    btcPrice !== null && targetPrice !== null
      ? Number((targetPrice - btcPrice).toFixed(2))
      : null;
  const distanceBps =
    btcPrice && distanceUsd !== null
      ? Number((Math.abs(distanceUsd) / btcPrice * 10000).toFixed(2))
      : null;

  const marketProbability =
    safeNumber(snapshot?.implied?.marketProbability) ??
    safeNumber(snapshot.marketProbability);
  const yesBid = safeNumber(snapshot?.implied?.yesBid) ?? safeNumber(snapshot.yesBid);
  const yesAsk = safeNumber(snapshot?.implied?.yesAsk) ?? safeNumber(snapshot.yesAsk);
  const noBid = safeNumber(snapshot?.implied?.noBid) ?? safeNumber(snapshot.noBid);
  const noAsk = safeNumber(snapshot?.implied?.noAsk) ?? safeNumber(snapshot.noAsk);
  const yesSpread =
    safeNumber(snapshot?.mispricing?.yes?.spread) ??
    (yesBid !== null && yesAsk !== null ? Number((yesAsk - yesBid).toFixed(2)) : null);
  const noSpread =
    safeNumber(snapshot?.mispricing?.no?.spread) ??
    (noBid !== null && noAsk !== null ? Number((noAsk - noBid).toFixed(2)) : null);
  const modelYesProbability =
    safeNumber(snapshot?.reachability?.modelProbability) ??
    safeNumber(snapshot.modelYesProbability);
  const modelNoProbability =
    modelYesProbability !== null
      ? Number((100 - modelYesProbability).toFixed(2))
      : safeNumber(snapshot.modelNoProbability);
  const bestSide = snapshot?.decision?.bestSide || snapshot.bestSide || null;
  const bestAdjustedEdge =
    safeNumber(snapshot?.decision?.bestAdjustedEdge) ??
    safeNumber(snapshot.bestAdjustedEdge);

  return {
    id: snapshot.id && String(snapshot.id).startsWith("LABEL-") ? snapshot.id : generateId(),
    snapshotId: snapshot.snapshotId || snapshot.id || null,
    marketTicker: snapshot.marketTicker || null,
    timestamp,
    targetPrice: toFixedNumber(targetPrice),
    btcPrice: toFixedNumber(btcPrice),
    distanceUsd,
    distanceBps,
    minutesRemaining:
      safeNumber(snapshot.minutesRemaining) ??
      safeNumber(snapshot?.reachability?.minutesRemaining),
    yesMarketProbability: toFixedNumber(marketProbability),
    noMarketProbability: marketProbability !== null ? Number((100 - marketProbability).toFixed(2)) : null,
    marketProbability: toFixedNumber(marketProbability),
    modelYesProbability: toFixedNumber(modelYesProbability),
    modelNoProbability: toFixedNumber(modelNoProbability),
    edgeYes:
      safeNumber(snapshot?.mispricing?.yes?.adjustedEdge) ??
      safeNumber(snapshot.edgeYes),
    edgeNo:
      safeNumber(snapshot?.mispricing?.no?.adjustedEdge) ??
      safeNumber(snapshot.edgeNo),
    bestSide,
    bestAdjustedEdge: toFixedNumber(bestAdjustedEdge),
    yesBid: toFixedNumber(yesBid),
    yesAsk: toFixedNumber(yesAsk),
    noBid: toFixedNumber(noBid),
    noAsk: toFixedNumber(noAsk),
    spreadYes: toFixedNumber(yesSpread),
    spreadNo: toFixedNumber(noSpread),
    volatilityEstimate:
      safeNumber(snapshot.volatilityEstimate) ??
      safeNumber(snapshot.annualizedVolatility) ??
      safeNumber(snapshot?.reachability?.annualizedVolatility),
    momentumBps:
      safeNumber(snapshot.momentumBps) ??
      safeNumber(snapshot?.reachability?.momentumBps),
    timeOfDayUtc: new Date(timestamp).toISOString().slice(11, 16),
    session: buildSession(timestamp),
    label: normalizeLabel(snapshot.label),
    settlementBtcPrice: toFixedNumber(snapshot.settlementBtcPrice),
    settlementTime: snapshot.settlementTime || null,
    createdAt: snapshot.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function addLabeledSnapshot(record = {}) {
  const dataset = readDataset();
  const normalized = buildFeatureRowFromSnapshot(record);

  if (!normalized.marketTicker) {
    return {
      ok: false,
      reason: "MISSING_MARKET_TICKER",
    };
  }

  const index = dataset.findIndex((row) => {
    if (normalized.snapshotId && row.snapshotId === normalized.snapshotId) return true;
    return row.id === normalized.id;
  });

  if (index >= 0) {
    dataset[index] = {
      ...dataset[index],
      ...normalized,
      id: dataset[index].id || normalized.id,
      createdAt: dataset[index].createdAt || normalized.createdAt,
      updatedAt: new Date().toISOString(),
    };
  } else {
    dataset.push(normalized);
  }

  writeDataset(dataset);

  return {
    ok: true,
    snapshot: index >= 0 ? dataset[index] : normalized,
  };
}

export function getLabeledSnapshots({ limit = 100, label = null } = {}) {
  const dataset = readDataset();
  const normalizedLabel = label ? normalizeLabel(label) : null;

  const filtered = dataset.filter((row) => {
    if (!normalizedLabel) return true;
    return row.label === normalizedLabel;
  });

  return filtered.slice(-Number(limit || 100)).reverse();
}

export function labelSnapshot({ snapshotId = null, id = null, settledSide = null, settlementBtcPrice = null, settlementTime = null } = {}) {
  const dataset = readDataset();
  const index = dataset.findIndex((row) => {
    if (snapshotId && row.snapshotId === snapshotId) return true;
    if (id && row.id === id) return true;
    return false;
  });

  if (index === -1) {
    return {
      ok: false,
      reason: "SNAPSHOT_NOT_FOUND",
    };
  }

  const row = dataset[index];
  const label = inferLabelFromSettlement({
    targetPrice: row.targetPrice,
    settlementBtcPrice,
    settledSide,
  });

  if (!label) {
    return {
      ok: false,
      reason: "LABEL_NOT_RESOLVED",
    };
  }

  dataset[index] = {
    ...row,
    label,
    settlementBtcPrice: toFixedNumber(settlementBtcPrice) ?? row.settlementBtcPrice,
    settlementTime: settlementTime || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeDataset(dataset);

  return {
    ok: true,
    snapshot: dataset[index],
  };
}

export function getLabeledSnapshotStats() {
  const dataset = readDataset();
  const labeledRows = dataset.filter((row) => row.label === "YES" || row.label === "NO");
  const yesLabels = labeledRows.filter((row) => row.label === "YES").length;
  const noLabels = labeledRows.filter((row) => row.label === "NO").length;
  const averageDistanceBps =
    dataset.length > 0
      ? Number((dataset.reduce((sum, row) => sum + Math.abs(row.distanceBps || 0), 0) / dataset.length).toFixed(2))
      : 0;

  const byProbabilityBucket = dataset.reduce((acc, row) => {
    const bucket = buildProbabilityBucket(row.marketProbability);
    if (!acc[bucket]) {
      acc[bucket] = {
        totalRows: 0,
        labeledRows: 0,
        yesLabels: 0,
        noLabels: 0,
      };
    }

    acc[bucket].totalRows += 1;
    if (row.label === "YES" || row.label === "NO") {
      acc[bucket].labeledRows += 1;
      if (row.label === "YES") acc[bucket].yesLabels += 1;
      if (row.label === "NO") acc[bucket].noLabels += 1;
    }

    return acc;
  }, {
    "0-25": { totalRows: 0, labeledRows: 0, yesLabels: 0, noLabels: 0 },
    "25-50": { totalRows: 0, labeledRows: 0, yesLabels: 0, noLabels: 0 },
    "50-75": { totalRows: 0, labeledRows: 0, yesLabels: 0, noLabels: 0 },
    "75-100": { totalRows: 0, labeledRows: 0, yesLabels: 0, noLabels: 0 },
  });

  return {
    totalRows: dataset.length,
    labeledRows: labeledRows.length,
    unlabeledRows: dataset.length - labeledRows.length,
    yesLabels,
    noLabels,
    labelRate: dataset.length ? Number(((labeledRows.length / dataset.length) * 100).toFixed(2)) : 0,
    averageDistanceBps,
    byProbabilityBucket,
  };
}
