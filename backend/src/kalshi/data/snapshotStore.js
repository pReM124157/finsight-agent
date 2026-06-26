import fs from "node:fs";
import path from "node:path";
import {
  isMongoDualWriteEnabled,
  saveMarketSnapshotMongo,
} from "../storage/mongoPersistence.js";

const SNAPSHOT_PATH =
  process.env.KALSHI_SNAPSHOT_PATH ||
  path.resolve("data/kalshi-market-snapshots.json");

function ensureDir() {
  const dir = path.dirname(SNAPSHOT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readSnapshots() {
  ensureDir();

  if (!fs.existsSync(SNAPSHOT_PATH)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSnapshots(snapshots) {
  ensureDir();
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshots, null, 2) + "\n");
}

export function saveMarketSnapshot(snapshot) {
  const snapshots = readSnapshots();

  const enriched = {
    id: snapshot.id || `SNAP-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    ...snapshot,
  };

  snapshots.push(enriched);

  const maxSnapshots = Number(process.env.KALSHI_MAX_SNAPSHOTS || 5000);
  const trimmed = snapshots.slice(-maxSnapshots);

  writeSnapshots(trimmed);

  if (isMongoDualWriteEnabled()) {
    saveMarketSnapshotMongo(enriched).catch((error) => {
      console.warn("[mongo] market snapshot dual-write failed:", error.message);
    });
  }

  return enriched;
}

export function getMarketSnapshots({ limit = 100, marketTicker = null } = {}) {
  const snapshots = readSnapshots();

  const filtered = marketTicker
    ? snapshots.filter((snapshot) => snapshot.marketTicker === marketTicker)
    : snapshots;

  return filtered.slice(-Number(limit || 100)).reverse();
}

export function getSnapshotStats() {
  const snapshots = readSnapshots();

  const decisions = snapshots.reduce((acc, snapshot) => {
    const action = snapshot?.decision?.action || snapshot?.decision?.reason || "UNKNOWN";
    acc[action] = (acc[action] || 0) + 1;
    return acc;
  }, {});

  return {
    totalSnapshots: snapshots.length,
    latestSnapshotAt: snapshots.at(-1)?.createdAt || null,
    decisions,
  };
}
