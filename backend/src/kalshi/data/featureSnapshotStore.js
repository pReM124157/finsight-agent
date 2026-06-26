import fs from "node:fs";
import path from "node:path";
import { CURRENT_FEATURE_PIPELINE_VERSION } from "./featureSnapshot.js";
import {
  isMongoDualWriteEnabled,
  saveFeatureSnapshotMongo,
} from "../storage/mongoPersistence.js";

const FEATURE_SNAPSHOT_PATH =
  process.env.KALSHI_FEATURE_SNAPSHOT_PATH ||
  path.resolve("data/kalshi-feature-snapshots.jsonl");

function ensureDir() {
  const dir = path.dirname(FEATURE_SNAPSHOT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function getPipelineVersionNumber(version) {
  const match = String(version || "").trim().match(/^v(\d+)/i);
  return match ? Number(match[1]) : null;
}

function comparePipelineVersions(a, b) {
  const aNum = getPipelineVersionNumber(a);
  const bNum = getPipelineVersionNumber(b);

  if (aNum !== null && bNum !== null && aNum !== bNum) {
    return aNum - bNum;
  }

  return String(a || "").localeCompare(String(b || ""));
}

function isSnapshotValid(snapshot, minPipelineVersion = CURRENT_FEATURE_PIPELINE_VERSION) {
  const snapshotVersion = snapshot?.pipeline_version || null;
  if (!snapshotVersion) return false;
  return comparePipelineVersions(snapshotVersion, minPipelineVersion) >= 0;
}

export function appendFeatureSnapshot(snapshot = {}) {
  ensureDir();
  const record = {
    id: snapshot.id || `FEAT-${Date.now()}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
    createdAt: snapshot.createdAt || new Date().toISOString(),
    ...snapshot,
  };

  fs.appendFileSync(
    FEATURE_SNAPSHOT_PATH,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );

  if (isMongoDualWriteEnabled()) {
    saveFeatureSnapshotMongo(record).catch((error) => {
      console.warn("[mongo] feature snapshot dual-write failed:", error.message);
    });
  }

  return record;
}

export function getFeatureSnapshots({ limit = 100 } = {}) {
  const rows = readFeatureSnapshots();
  return rows.slice(-Number(limit || 100)).reverse();
}

function readFeatureSnapshots() {
  ensureDir();

  if (!fs.existsSync(FEATURE_SNAPSHOT_PATH)) {
    return [];
  }

  const rows = fs
    .readFileSync(FEATURE_SNAPSHOT_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(safeJsonParse)
    .filter(Boolean);

  return rows;
}

function writeFeatureSnapshots(rows = []) {
  ensureDir();
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(
    FEATURE_SNAPSHOT_PATH,
    payload ? `${payload}\n` : "",
    "utf8"
  );
}

export function getValidSnapshots(minPipelineVersion = CURRENT_FEATURE_PIPELINE_VERSION, { limit = 100 } = {}) {
  return getFeatureSnapshots({ limit: 1000000 })
    .filter((snapshot) => isSnapshotValid(snapshot, minPipelineVersion))
    .slice(0, Number(limit || 100));
}

export function findUnsettledSnapshotsByTicker(
  marketTicker,
  minPipelineVersion = CURRENT_FEATURE_PIPELINE_VERSION
) {
  if (!marketTicker) {
    return [];
  }

  return readFeatureSnapshots().filter(
    (row) =>
      row?.market_ticker === marketTicker &&
      !row?.settlement_outcome &&
      isSnapshotValid(row, minPipelineVersion)
  );
}

export function updateSnapshots(updates = {}) {
  const updateEntries = Object.entries(updates || {}).filter(
    ([, value]) => value && typeof value === "object"
  );

  if (updateEntries.length === 0) {
    return {
      ok: true,
      updated: 0,
    };
  }

  const updatesByKey = new Map(updateEntries);
  const rows = readFeatureSnapshots();
  let updated = 0;

  const rewritten = rows.map((row) => {
    const keys = [row?.snapshot_id, row?.id].filter(Boolean);
    const matchKey = keys.find((key) => updatesByKey.has(key));

    if (!matchKey) {
      return row;
    }

    updated += 1;
    return {
      ...row,
      ...updatesByKey.get(matchKey),
    };
  });

  writeFeatureSnapshots(rewritten);

  if (isMongoDualWriteEnabled()) {
    for (const row of rewritten) {
      const keys = [row?.snapshot_id, row?.id].filter(Boolean);
      const shouldSync = keys.some((key) => updatesByKey.has(key));
      if (!shouldSync) continue;

      saveFeatureSnapshotMongo(row).catch((error) => {
        console.warn("[mongo] feature snapshot dual-write failed:", error.message);
      });
    }
  }

  return {
    ok: true,
    updated,
  };
}

export function getFeatureSnapshotProgress(minPipelineVersion = CURRENT_FEATURE_PIPELINE_VERSION) {
  const rows = getFeatureSnapshots({ limit: 1000000 });
  const validRows = rows.filter((row) => isSnapshotValid(row, minPipelineVersion));
  const contaminatedRows = rows.filter((row) => !isSnapshotValid(row, minPipelineVersion));
  const settledRows = validRows.filter((row) => row.settlement_outcome);
  const unlabeledRows = validRows.filter((row) => !row.settlement_outcome);
  const bySession = validRows.reduce((acc, row) => {
    const bucket = row.session_bucket || "UNKNOWN";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});

  return {
    filePath: FEATURE_SNAPSHOT_PATH,
    minPipelineVersion,
    totalRows: rows.length,
    validRows: validRows.length,
    contaminatedRows: contaminatedRows.length,
    settledRows: settledRows.length,
    unlabeledRows: unlabeledRows.length,
    latestSnapshotAt: rows[0]?.createdAt || null,
    latestMarketTicker: rows[0]?.market_ticker || null,
    latestValidSnapshotAt: validRows[0]?.createdAt || null,
    latestValidMarketTicker: validRows[0]?.market_ticker || null,
    bySession,
  };
}
